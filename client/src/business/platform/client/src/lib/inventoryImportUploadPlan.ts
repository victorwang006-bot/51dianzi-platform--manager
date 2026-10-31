export const INVENTORY_IMPORT_REQUEST_BYTE_BUDGET = 900 * 1024;
export const INVENTORY_IMPORT_REQUEST_ROW_LIMIT = 500;

export type InventoryImportJobStatus =
  | "staging"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type InventoryImportUploadedBatch = {
  batchIndex: number;
  startRow: number;
  rowCount: number;
  payloadHash: string;
};

export type InventoryImportUploadPlan = {
  jobId: string;
  status: InventoryImportJobStatus;
  totalRows: number;
  stagedRows: number;
  uploadedBatches: InventoryImportUploadedBatch[];
  nextBatchIndex: number;
  nextStartRow: number;
};

export type InventoryImportStageBatch<T> = {
  batchIndex: number;
  startRow: number;
  rows: T[];
};

const JOB_STATUSES = new Set<InventoryImportJobStatus>([
  "staging",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** The tRPC JSON envelope is measured, not just the rows array. */
export function inventoryImportUtf8EnvelopeBytes(input: unknown) {
  return new TextEncoder().encode(JSON.stringify({ json: input })).byteLength;
}

/**
 * Accept only the read-only recovery shape promised by getUploadPlan.
 * A malformed or stale plan is deliberately rejected rather than guessed from
 * stagedRows / 500, because guessing can overwrite or duplicate old batches.
 */
export function readInventoryImportUploadPlan(
  value: unknown,
  expected: { jobId: string; totalRows: number },
): InventoryImportUploadPlan | null {
  if (!isRecord(value)) return null;
  const {
    jobId,
    status,
    totalRows,
    stagedRows,
    uploadedBatches,
    nextBatchIndex,
    nextStartRow,
  } = value;
  if (
    jobId !== expected.jobId ||
    typeof status !== "string" ||
    !JOB_STATUSES.has(status as InventoryImportJobStatus) ||
    totalRows !== expected.totalRows ||
    !isPositiveInteger(totalRows) ||
    !isNonNegativeInteger(stagedRows) ||
    stagedRows > totalRows ||
    !Array.isArray(uploadedBatches) ||
    !isNonNegativeInteger(nextBatchIndex) ||
    !isPositiveInteger(nextStartRow)
  ) {
    return null;
  }

  const batches: InventoryImportUploadedBatch[] = [];
  let expectedBatchIndex = 0;
  let expectedStartRow = 1;
  let countedRows = 0;
  for (const value of uploadedBatches) {
    if (!isRecord(value)) return null;
    const { batchIndex, startRow, rowCount, payloadHash } = value;
    if (
      batchIndex !== expectedBatchIndex ||
      startRow !== expectedStartRow ||
      !isPositiveInteger(rowCount) ||
      rowCount > INVENTORY_IMPORT_REQUEST_ROW_LIMIT ||
      typeof payloadHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(payloadHash)
    ) {
      return null;
    }
    batches.push({
      batchIndex,
      startRow,
      rowCount,
      payloadHash: payloadHash.toLowerCase(),
    });
    expectedBatchIndex += 1;
    expectedStartRow += rowCount;
    countedRows += rowCount;
  }

  if (
    countedRows !== stagedRows ||
    nextBatchIndex !== expectedBatchIndex ||
    nextStartRow !== expectedStartRow
  ) {
    return null;
  }

  return {
    jobId,
    status: status as InventoryImportJobStatus,
    totalRows,
    stagedRows,
    uploadedBatches: batches,
    nextBatchIndex,
    nextStartRow,
  };
}

/**
 * Verify every historical batch against the current parsed rows before any
 * resume request. The server-provided hash covers JSON.stringify(rows), not
 * the transport envelope.
 */
export async function verifyInventoryImportUploadPlanRows<T>(
  rows: readonly T[],
  plan: InventoryImportUploadPlan,
  sha256: (value: string) => Promise<string>,
) {
  if (rows.length !== plan.totalRows) return false;
  for (const batch of plan.uploadedBatches) {
    const batchRows = rows.slice(
      batch.startRow - 1,
      batch.startRow - 1 + batch.rowCount,
    );
    if (
      batchRows.length !== batch.rowCount ||
      (await sha256(JSON.stringify(batchRows))).toLowerCase() !== batch.payloadHash
    ) {
      return false;
    }
  }
  return plan.nextStartRow - 1 === plan.stagedRows;
}

/**
 * Split only the not-yet-uploaded suffix. Every candidate includes the actual
 * stageBatch input inside the JSON envelope used by the RPC client.
 */
export function splitInventoryImportStageBatches<T>(
  rows: readonly T[],
  jobId: string,
  firstBatchIndex: number,
  firstStartRow: number,
): InventoryImportStageBatch<T>[] {
  if (rows.length === 0) return [];
  if (
    !isNonNegativeInteger(firstBatchIndex) ||
    !isPositiveInteger(firstStartRow) ||
    !jobId
  ) {
    throw new Error("暂存任务批次计划不完整，请刷新任务状态后继续");
  }

  const batches: InventoryImportStageBatch<T>[] = [];
  let offset = 0;
  let batchIndex = firstBatchIndex;
  let startRow = firstStartRow;
  while (offset < rows.length) {
    const batch: T[] = [];
    while (
      offset + batch.length < rows.length &&
      batch.length < INVENTORY_IMPORT_REQUEST_ROW_LIMIT
    ) {
      const candidateRows = batch.concat(rows[offset + batch.length]);
      const bytes = inventoryImportUtf8EnvelopeBytes({
        jobId,
        batchIndex,
        startRow,
        rows: candidateRows,
      });
      if (bytes > INVENTORY_IMPORT_REQUEST_BYTE_BUDGET) {
        if (batch.length === 0) {
          throw new Error("单条库存信息超过安全上传大小，请缩短该行的文本内容后再试");
        }
        break;
      }
      batch.push(rows[offset + batch.length]);
    }
    if (batch.length === 0) {
      throw new Error("库存上传分批失败，请稍后重试");
    }
    batches.push({ batchIndex, startRow, rows: batch });
    offset += batch.length;
    batchIndex += 1;
    startRow += batch.length;
  }
  return batches;
}

/** Use the same gateway budget for previewRows requests. */
export function splitInventoryPreviewRowsByUtf8<T>(rows: readonly T[]): T[][] {
  if (rows.length === 0) return [];
  const batches: T[][] = [];
  let offset = 0;
  while (offset < rows.length) {
    const batch: T[] = [];
    while (
      offset + batch.length < rows.length &&
      batch.length < INVENTORY_IMPORT_REQUEST_ROW_LIMIT
    ) {
      const candidateRows = batch.concat(rows[offset + batch.length]);
      if (
        inventoryImportUtf8EnvelopeBytes({ rows: candidateRows }) >
        INVENTORY_IMPORT_REQUEST_BYTE_BUDGET
      ) {
        if (batch.length === 0) {
          throw new Error("单条库存信息超过安全预览大小，请缩短该行的文本内容后再试");
        }
        break;
      }
      batch.push(rows[offset + batch.length]);
    }
    if (batch.length === 0) throw new Error("差异预览分批失败，请稍后重试");
    batches.push(batch);
    offset += batch.length;
  }
  return batches;
}
