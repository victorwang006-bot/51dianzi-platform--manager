import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprises,
  inventories,
  inventoryImportBatches,
  inventoryImportJobs,
  inventoryImportRejected,
  inventoryImportResults,
  inventoryImportRowVersions,
  inventoryImportStaging,
  type Inventory,
  type InventoryImportJob,
  type InsertInventoryImportStagingRow,
} from "../../drizzle/schema";
import {
  INVENTORY_IMPORT_EMPTY_STAGING_TTL_MS,
  INVENTORY_IMPORT_JOB_ROW_LIMIT,
  INVENTORY_IMPORT_ERROR_PAGE_SIZE,
  INVENTORY_IMPORT_PARTIAL_STAGING_TTL_MS,
  INVENTORY_IMPORT_STAGE_BATCH_SIZE,
  INVENTORY_IMPORT_WORKER_BATCH_SIZE,
} from "../../../shared/inventoryImport";
import { inventoryImportV3StageRowSchema } from "../../../shared/inventoryImportPreview";
import { importRowSchema } from "../../../shared/inventoryImportValidation";
import { canPublishInventoryAvailability } from "../../../shared/inventoryAvailability";
import { hasInventoryLeadTime } from "../../../shared/inventoryLeadTime";
import { getDb, withInventoryPublisherLock } from "../db";
import {
  assertInventoryQuotaDeploymentReady,
  getInventoryQuota,
  inventoryPublishedLimitMessage,
  isInventoryQuotaDeploymentBusy,
  isInventoryQuotaExceeded,
} from "./inventoryQuota";
import {
  decideWorkerAction,
  existingImportRowGuardMatches,
  inventoryImportFingerprint,
  makeExistingImportRowGuard,
  makeNewImportRowGuard,
  resolveImportGuardCandidate,
  stalePreviewMessage,
  type ImportRowVersionGuard,
} from "./inventoryImportVersionGuard";

export type AsyncInventoryImportRow = {
  sourceRowNumber?: number;
  partNumber: string;
  brand: string;
  category?: string;
  pkg?: string;
  dateCode: string;
  qtyOnSale: number;
  qtyStock?: number;
  priceEx?: number;
  taxIncluded: boolean;
  moq?: number;
  spq?: number;
  leadTime: string;
  warehouseAddress?: string;
  rohs?: boolean;
  note?: string;
};

type ClassifiedInventoryImportRows = {
  valid: Array<{
    rowNumber: number;
    row: AsyncInventoryImportRow;
    raw: Record<string, unknown>;
    rawRow: string;
  }>;
  rejected: Array<{ rowNumber: number; rawRow: string; errorMessage: string }>;
};

type CreateJobInput = {
  enterpriseId: number;
  dataOwnerUserId: number;
  createdByUserId: number;
  ownerUserId: number;
  clientRequestId: string;
  fileName: string;
  fileHash?: string;
  manifestHash: string;
  totalRows: number;
  saveAs: "draft" | "published";
};

type StageBatchInput = {
  jobId: string;
  enterpriseId: number;
  actorUserId: number;
  batchIndex: number;
  startRow: number;
  rows: unknown[];
};

const ACTIVE_STATUSES = ["staging", "queued", "running", "paused"] as const;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MIN_AVAILABLE_MEMORY_BYTES = 1_500 * 1024 * 1024;
const workerInstanceId = `${hostname().slice(0, 32)}:${process.pid}`;

function requireDatabase<T>(value: T | null): asserts value is T {
  if (!value) throw new Error("数据库不可用");
}

function activeImportLeaseCondition(jobId: string, workerId: string, now = new Date()) {
  return and(
    eq(inventoryImportJobs.id, jobId),
    eq(inventoryImportJobs.status, "running"),
    eq(inventoryImportJobs.leaseOwner, workerId),
    gt(inventoryImportJobs.leaseExpiresAt, now),
  );
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function normalizePartNumber(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

function payloadHash(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/**
 * New source stages snapshot the exact published candidate while holding its
 * row lock. Legacy already-staged rows have no side-table entry and are not
 * retroactively frozen. Repair child tasks receive the same snapshot so a
 * newly-created competing candidate is never silently accepted; their worker
 * branch still retains the existing no-overwrite behavior.
 */
async function makeStageVersionGuards(
  tx: any,
  job: InventoryImportJob,
  values: readonly InsertInventoryImportStagingRow[],
): Promise<ImportRowVersionGuard[]> {
  if (
    values.length === 0
    || job.saveAs !== "published"
  ) return [];
  const keys = Array.from(new Set(values.map(value => value.partNumberNormalized)));
  // V3 guards snapshot every exact same-enterprise candidate.  Do not scope
  // this query by status or owner: a draft or another owner created after
  // stage must make the later worker action stale rather than invisible.
  const candidates: Inventory[] = await tx
    .select()
    .from(inventories)
    .where(and(
      eq(inventories.enterpriseId, job.enterpriseId),
      inArray(inventories.partNumberNormalized, keys),
    ))
    .for("update");
  const byPart = new Map<string, Inventory[]>();
  for (const candidate of candidates) {
    const key = String(candidate.partNumberNormalized ?? "");
    const list = byPart.get(key) ?? [];
    list.push(candidate);
    byPart.set(key, list);
  }
  const guards: ImportRowVersionGuard[] = [];
  const scope = {
    enterpriseId: job.enterpriseId,
    userId: job.dataOwnerUserId,
    ownerUserId: job.ownerUserId,
  };
  for (const value of values) {
    const matches = byPart.get(value.partNumberNormalized) ?? [];
    const resolution = resolveImportGuardCandidate(matches, {
      ...scope,
      partNumberNormalized: value.partNumberNormalized,
    });
    if (resolution.action === "update" && resolution.inventory) {
      guards.push(makeExistingImportRowGuard({
        jobId: job.id,
        rowNumber: value.rowNumber,
        inventory: resolution.inventory,
      }));
    } else {
      // A conflict is recorded as a new guard too.  It can never validate as
      // new, so it is safely reported as STALE_PREVIEW instead of falling back
      // to a legacy write path without the complete candidate snapshot.
      guards.push(makeNewImportRowGuard({
        jobId: job.id,
        rowNumber: value.rowNumber,
        scope: { ...scope, partNumberNormalized: value.partNumberNormalized },
        candidates: matches,
      }));
    }
  }
  return guards;
}

async function insertStageVersionGuards(
  tx: any,
  job: InventoryImportJob,
  values: readonly InsertInventoryImportStagingRow[],
) {
  const guards = await makeStageVersionGuards(tx, job, values);
  if (guards.length > 0) await tx.insert(inventoryImportRowVersions).values(guards);
}

const IMPORT_FIELD_LABELS: Record<string, string> = {
  partNumber: "型号", brand: "品牌", category: "分类", pkg: "封装", dateCode: "生产周期",
  qtyOnSale: "上架数量", qtyStock: "实际库存", priceEx: "单价", taxIncluded: "价格类型",
  moq: "MOQ", spq: "SPQ", leadTime: "交期", warehouseAddress: "仓库地址", rohs: "RoHS", note: "物料备注",
};

function beginningOfToday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+08:00`);
}

function toPublicJob(job: InventoryImportJob) {
  return {
    id: job.id,
    fileName: job.fileName,
    fileHash: job.fileHash,
    manifestHash: job.manifestHash,
    saveAs: job.saveAs,
    status: job.status,
    totalRows: job.totalRows,
    stagedRows: job.stagedRows,
    processedRows: job.processedRows,
    successRows: job.successRows,
    errorRows: job.errorRows,
    skippedRows: job.skippedRows,
    duplicateRows: job.duplicateRows,
    updatedRows: job.updatedRows,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function createInventoryImportJob(input: CreateJobInput) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  if (input.totalRows < 1 || input.totalRows > INVENTORY_IMPORT_JOB_ROW_LIMIT) {
    throw new Error(`单个导入任务最多支持 ${INVENTORY_IMPORT_JOB_ROW_LIMIT.toLocaleString()} 条`);
  }

  try {
    return await database.transaction(async tx => {
    // Lock the exact enterprise row before SUM so concurrent createJob calls cannot bypass the
    // daily quota. The service validates enterpriseId + stable CRM owner before any exception.
    const quota = await getInventoryQuota(tx, {
      enterpriseId: input.enterpriseId,
      dataOwnerUserId: input.dataOwnerUserId,
    }, { lockEnterprise: true });
    const existingRequest = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
            eq(inventoryImportJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
    )[0];
    if (existingRequest) {
      if (
        existingRequest.totalRows !== input.totalRows
        || existingRequest.fileName !== input.fileName
        || existingRequest.saveAs !== input.saveAs
        || (existingRequest.fileHash ?? null) !== (input.fileHash ?? null)
        || existingRequest.manifestHash !== input.manifestHash
      ) {
        throw new Error("请求号已用于其他导入任务，请重新选择文件");
      }
      return { job: toPublicJob(existingRequest), idempotent: true } as const;
    }

    const active = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(eq(inventoryImportJobs.activeEnterpriseId, input.enterpriseId))
        .limit(1)
        .for("update")
    )[0];
    if (active) {
      const sameFile = active.status === "staging"
        && active.fileHash != null
        && active.fileHash === (input.fileHash ?? null)
        && active.manifestHash === input.manifestHash
        && active.totalRows === input.totalRows
        && active.saveAs === input.saveAs;
      if (sameFile) {
        return { job: toPublicJob(active), idempotent: true } as const;
      }

      const emptyStagingExpired = active.status === "staging"
        && active.stagedRows === 0
        && active.updatedAt.getTime() <= Date.now() - INVENTORY_IMPORT_EMPTY_STAGING_TTL_MS;
      if (!emptyStagingExpired) {
        throw new Error("当前企业已有库存导入任务，请继续上传原文件，或在任务卡中取消后上传新文件");
      }
      await tx
        .update(inventoryImportJobs)
        .set({
          status: "cancelled",
          activeEnterpriseId: null,
          errorMessage: "创建后15分钟未收到数据，任务已自动取消",
          finishedAt: new Date(),
        })
        .where(eq(inventoryImportJobs.id, active.id));
    }

    const [daily] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${inventoryImportJobs.totalRows}), 0)` })
      .from(inventoryImportJobs)
      .where(
        and(
          eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          eq(inventoryImportJobs.dataOwnerUserId, input.dataOwnerUserId),
          gte(inventoryImportJobs.createdAt, beginningOfToday()),
          ne(inventoryImportJobs.status, "cancelled"),
        ),
      );
    if (isInventoryQuotaExceeded(Number(daily?.total ?? 0), quota.dailyImportRowLimit, input.totalRows)) {
      throw new Error(
        `今日库存导入总量最多${quota.dailyImportRowLimit.toLocaleString()}条，请明日再试或联系平台管理员`,
      );
    }

    const id = randomUUID();
    await tx.insert(inventoryImportJobs).values({
      id,
      enterpriseId: input.enterpriseId,
      activeEnterpriseId: input.enterpriseId,
      dataOwnerUserId: input.dataOwnerUserId,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      clientRequestId: input.clientRequestId,
      fileName: input.fileName,
      fileHash: input.fileHash ?? null,
      manifestHash: input.manifestHash,
      totalRows: input.totalRows,
      saveAs: input.saveAs,
      status: "staging",
    });
    const created = (
      await tx.select().from(inventoryImportJobs).where(eq(inventoryImportJobs.id, id)).limit(1)
    )[0];
    if (!created) throw new Error("导入任务创建失败");
      return { job: toPublicJob(created), idempotent: false } as const;
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code !== "ER_DUP_ENTRY") throw error;
    const sameRequest = (
      await database
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
            eq(inventoryImportJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
    )[0];
    if (sameRequest) {
      if (
        sameRequest.totalRows !== input.totalRows
        || sameRequest.fileName !== input.fileName
        || sameRequest.saveAs !== input.saveAs
        || (sameRequest.fileHash ?? null) !== (input.fileHash ?? null)
        || sameRequest.manifestHash !== input.manifestHash
      ) {
        throw new Error("请求号已用于其他导入任务，请重新选择文件");
      }
      return { job: toPublicJob(sameRequest), idempotent: true } as const;
    }
    throw new Error("当前企业已有库存导入任务，请等待完成或先取消该任务");
  }
}

/** Outer batch errors are protocol errors; per-row business errors are safely isolated. */
export function classifyInventoryImportRows(rows: readonly unknown[], startRow: number): ClassifiedInventoryImportRows {
  const valid: ClassifiedInventoryImportRows["valid"] = [];
  const rejected: Array<{ rowNumber: number; rawRow: string; errorMessage: string }> = [];
  let previousRow = 1;
  for (let index = 0; index < rows.length; index++) {
    const item = rows[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("批次包含无效的 Excel 行对象");
    }
    const raw = item as Record<string, unknown>;
    const rowNumber = raw.sourceRowNumber === undefined ? startRow + index : raw.sourceRowNumber;
    if (typeof rowNumber !== "number" || !Number.isSafeInteger(rowNumber) || rowNumber < 2 || rowNumber <= previousRow) {
      throw new Error("批次包含无效或重复的 Excel 原始行号");
    }
    previousRow = rowNumber;
    const rawRow = JSON.stringify(raw);
    if (!rawRow || Buffer.byteLength(rawRow, "utf8") > 8192) {
      throw new Error("单行原始数据超过安全上限，请检查列映射或附件内容");
    }
    const explicitError = typeof raw.validationError === "string" ? raw.validationError.trim() : "";
    if (explicitError) {
      rejected.push({ rowNumber, rawRow, errorMessage: explicitError.slice(0, 255) });
      continue;
    }
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const message = issues.length > 0
        ? issues.slice(0, 3).map(issue => {
          const label = IMPORT_FIELD_LABELS[String(issue.path[0] ?? "")] ?? "数据";
          if (issue.code === "too_big" && typeof issue.maximum === "number") {
            const numeric = ["qtyOnSale", "qtyStock", "priceEx", "moq", "spq"].includes(String(issue.path[0] ?? ""));
            return numeric ? `${label}不能超过${issue.maximum}` : `${label}最多${issue.maximum}个字符`;
            }
            if (issue.code === "invalid_type") return `${label}格式有误`;
            return `${label}：${issue.message}`;
          }).join("；")
        : explicitError;
      rejected.push({ rowNumber, rawRow, errorMessage: message.slice(0, 255) || "单行校验失败" });
      continue;
    }
    // Keep the exact request object until the task lock has checked V3 control
    // fields. `importRowSchema` intentionally strips unknown fields, so using
    // only parsed.data here would silently lose expectedFingerprint.
    valid.push({ rowNumber, row: parsed.data, raw, rawRow });
  }
  return { valid, rejected };
}

const V3_STAGE_CONTROL_FIELDS = [
  "importPolicyVersion",
  "expectedFingerprint",
  "preserveBlankFields",
  "clearFields",
] as const;

function carriesV3StageControl(raw: Record<string, unknown>) {
  return V3_STAGE_CONTROL_FIELDS.some(field =>
    Object.prototype.hasOwnProperty.call(raw, field),
  );
}

function rejectV3StageRow(
  classified: ClassifiedInventoryImportRows,
  entry: ClassifiedInventoryImportRows["valid"][number],
  errorMessage: string,
) {
  classified.rejected.push({
    rowNumber: entry.rowNumber,
    rawRow: entry.rawRow,
    errorMessage: errorMessage.slice(0, 255),
  });
}

/**
 * A V3 row has to retain both its original protocol marker and the exact token
 * returned by previewRows. This runs after the job `FOR UPDATE` lock and locks
 * the complete same-enterprise candidate set before any staging write. Legacy
 * and repair rows have no V3 controls and deliberately keep their old path.
 */
export async function validateInventoryImportV3StageRows(
  tx: any,
  job: InventoryImportJob,
  classified: ClassifiedInventoryImportRows,
) {
  const guarded = classified.valid.filter(entry => carriesV3StageControl(entry.raw));
  if (guarded.length === 0) return;

  const controlsByRow = new Map<number, ReturnType<typeof inventoryImportV3StageRowSchema.safeParse>>();
  const keys = new Set<string>();
  for (const entry of guarded) {
    const controls = inventoryImportV3StageRowSchema.safeParse(entry.raw);
    controlsByRow.set(entry.rowNumber, controls);
    if (controls.success) keys.add(normalizePartNumber(controls.data.partNumber));
  }

  const candidates: Inventory[] = keys.size === 0
    ? []
    : await tx
      .select()
      .from(inventories)
      .where(and(
        eq(inventories.enterpriseId, job.enterpriseId),
        inArray(inventories.partNumberNormalized, Array.from(keys)),
      ))
      .for("update");
  const candidatesByPart = new Map<string, Inventory[]>();
  for (const candidate of candidates) {
    const key = String(candidate.partNumberNormalized ?? "");
    const matching = candidatesByPart.get(key) ?? [];
    matching.push(candidate);
    candidatesByPart.set(key, matching);
  }

  const accepted: ClassifiedInventoryImportRows["valid"] = [];
  const seenV3Parts = new Set<string>();
  for (const entry of classified.valid) {
    if (!carriesV3StageControl(entry.raw)) {
      accepted.push(entry);
      continue;
    }
    const controls = controlsByRow.get(entry.rowNumber);
    if (!controls?.success) {
      rejectV3StageRow(classified, entry, "上传前预览数据不完整，请重新预览后上传");
      continue;
    }
    const partNumberNormalized = normalizePartNumber(controls.data.partNumber);
    if (seenV3Parts.has(partNumberNormalized)) {
      rejectV3StageRow(classified, entry, "文件内型号重复，已保留到待发布");
      continue;
    }
    seenV3Parts.add(partNumberNormalized);
    const resolution = resolveImportGuardCandidate(
      candidatesByPart.get(partNumberNormalized) ?? [],
      {
        enterpriseId: job.enterpriseId,
        userId: job.dataOwnerUserId,
        ownerUserId: job.ownerUserId,
        partNumberNormalized,
      },
    );
    if (resolution.action === "conflict") {
      rejectV3StageRow(classified, entry, "当前库存匹配冲突，已保留到待发布");
      continue;
    }
    const expectedFingerprint = resolution.action === "new"
      ? "new"
      : inventoryImportFingerprint(resolution.inventory);
    if (controls.data.expectedFingerprint !== expectedFingerprint) {
      rejectV3StageRow(classified, entry, stalePreviewMessage());
      continue;
    }
    accepted.push(entry);
  }
  classified.valid = accepted;
  // Both stage paths use the first rejected row for their cross-batch source
  // order guard. V3 rejections are appended after local field failures, so
  // restore source order before either path reads that first row.
  classified.rejected.sort((left, right) => left.rowNumber - right.rowNumber);
}

export async function stageInventoryImportBatch(input: StageBatchInput) {
  const database = await getDb();
  requireDatabase(database);
  if (input.rows.length < 1 || input.rows.length > INVENTORY_IMPORT_STAGE_BATCH_SIZE) {
    throw new Error(`每批最多暂存 ${INVENTORY_IMPORT_STAGE_BATCH_SIZE} 条`);
  }
  const endRow = input.startRow + input.rows.length - 1;
  const hash = payloadHash(input.rows);
  const classified = classifyInventoryImportRows(input.rows, input.startRow);

  return database.transaction(async tx => {
    const job = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.id, input.jobId),
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!job) throw new Error("导入任务不存在");
    if (job.createdByUserId !== input.actorUserId) throw new Error("只有任务创建人可以上传该任务数据");
    if (job.status !== "staging") throw new Error("当前任务已结束暂存，不能继续上传数据");
    if (input.startRow < 1 || endRow > job.totalRows) throw new Error("批次位置超出任务总行数");

    const existingBatch = (
      await tx
        .select()
        .from(inventoryImportBatches)
        .where(
          and(
            eq(inventoryImportBatches.jobId, input.jobId),
            eq(inventoryImportBatches.batchIndex, input.batchIndex),
          ),
        )
        .limit(1)
    )[0];
    if (existingBatch) {
      if (
        existingBatch.startRow !== input.startRow
        || existingBatch.rowCount !== input.rows.length
        || existingBatch.payloadHash !== hash
      ) {
        throw new Error("该批次编号已用于不同数据，请重新创建导入任务");
      }
      return { stagedRows: job.stagedRows, idempotent: true } as const;
    }

    const lastBatch = (
      await tx
        .select({ batchIndex: inventoryImportBatches.batchIndex })
        .from(inventoryImportBatches)
        .where(eq(inventoryImportBatches.jobId, input.jobId))
        .orderBy(desc(inventoryImportBatches.batchIndex))
        .limit(1)
    )[0];
    // A pre-audit legacy job can have stagedRows but no batch rows. Preserve
    // that resume path; normal jobs require the exact next recorded index.
    const nextBatchIndex = lastBatch
      ? lastBatch.batchIndex + 1
      : job.stagedRows === 0 ? 0 : input.batchIndex;
    if (input.batchIndex !== nextBatchIndex || input.startRow !== job.stagedRows + 1) {
      throw new Error("上传批次顺序异常，请读取上传计划后按原批次边界继续");
    }

    await validateInventoryImportV3StageRows(tx, job, classified);
    const values: InsertInventoryImportStagingRow[] = classified.valid.map(({ row, rowNumber }) => {
      const qtyStock = row.qtyStock ?? row.qtyOnSale;
      const price = typeof row.priceEx === "number" && row.priceEx > 0
        ? row.priceEx.toFixed(4)
        : null;
      return {
        jobId: input.jobId,
        enterpriseId: input.enterpriseId,
        rowNumber,
        partNumber: row.partNumber.normalize("NFKC").trim(),
        partNumberNormalized: normalizePartNumber(row.partNumber),
        brand: row.brand.trim(),
        category: row.category?.trim() || "其他",
        pkg: row.pkg?.trim() || null,
        dateCode: row.dateCode.trim(),
        qtyOnSale: row.qtyOnSale,
        qtyStock,
        priceEx: price,
        priceIncl: price,
        taxIncluded: row.taxIncluded,
        moq: row.moq ?? null,
        spq: row.spq ?? null,
        leadTime: row.leadTime.trim(),
        warehouseAddress: row.warehouseAddress?.trim() || null,
        rohs: row.rohs ?? true,
        note: row.note?.trim() || null,
      };
    });

    const previousGood = await tx.select({ rowNumber: inventoryImportStaging.rowNumber })
      .from(inventoryImportStaging).where(eq(inventoryImportStaging.jobId, input.jobId))
      .orderBy(desc(inventoryImportStaging.rowNumber)).limit(1);
    const previousBad = await tx.select({ rowNumber: inventoryImportRejected.rowNumber })
      .from(inventoryImportRejected).where(eq(inventoryImportRejected.jobId, input.jobId))
      .orderBy(desc(inventoryImportRejected.rowNumber)).limit(1);
    const previousRowNumber = Math.max(previousGood[0]?.rowNumber ?? 1, previousBad[0]?.rowNumber ?? 1);
    const currentFirstRow = Math.min(
      classified.valid[0]?.rowNumber ?? Infinity,
      classified.rejected[0]?.rowNumber ?? Infinity,
    );
    if (input.batchIndex > 0 && currentFirstRow <= previousRowNumber) {
      throw new Error("Excel 原始行号顺序异常，请继续上传原文件");
    }
    if (values.length > 0) await tx.insert(inventoryImportStaging).values(values);
    // This side-table insert shares the staging transaction; no new source
    // stage can commit without its exact optimistic-concurrency snapshot.
    await insertStageVersionGuards(tx, job, values);
    if (classified.rejected.length > 0) {
      await tx.insert(inventoryImportRejected).values(classified.rejected.map(row => ({
        jobId: input.jobId,
        enterpriseId: input.enterpriseId,
        ...row,
      })));
    }
    await tx.insert(inventoryImportBatches).values({
      jobId: input.jobId,
      batchIndex: input.batchIndex,
      startRow: input.startRow,
      rowCount: input.rows.length,
      payloadHash: hash,
    });
    await tx
      .update(inventoryImportJobs)
      .set({
        stagedRows: sql`${inventoryImportJobs.stagedRows} + ${input.rows.length}`,
        errorRows: sql`${inventoryImportJobs.errorRows} + ${classified.rejected.length}`,
        skippedRows: sql`${inventoryImportJobs.skippedRows} + ${classified.rejected.length}`,
      })
      .where(eq(inventoryImportJobs.id, input.jobId));

    return { stagedRows: job.stagedRows + input.rows.length, skippedRows: job.skippedRows + classified.rejected.length, idempotent: false } as const;
  });
}

export async function finalizeInventoryImportJob(input: {
  jobId: string;
  enterpriseId: number;
  actorUserId: number;
}) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  return database.transaction(async tx => {
    const job = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.id, input.jobId),
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!job) throw new Error("导入任务不存在");
    if (job.createdByUserId !== input.actorUserId) throw new Error("只有任务创建人可以提交该任务");
    if (job.status !== "staging") return { job: toPublicJob(job), idempotent: true } as const;

    const [countRow] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventoryImportStaging)
      .where(eq(inventoryImportStaging.jobId, input.jobId));
    const [rejectedCountRow] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventoryImportRejected)
      .where(eq(inventoryImportRejected.jobId, input.jobId));
    const rejectedCount = Number(rejectedCountRow?.count ?? 0);
    const count = Number(countRow?.count ?? 0) + rejectedCount;
    if (rejectedCount !== job.skippedRows) throw new Error("暂存错误行数量异常，请勿重复发布");
    if (count !== job.totalRows || job.stagedRows !== job.totalRows) {
      throw new Error(`暂存数据不完整：应有${job.totalRows}条，实际${count}条`);
    }

    await tx
      .update(inventoryImportJobs)
      .set({ status: "queued", errorMessage: null })
      .where(eq(inventoryImportJobs.id, input.jobId));
    const queued = { ...job, status: "queued" as const, errorMessage: null };
    return { job: toPublicJob(queued), idempotent: false } as const;
  });
}

export async function listInventoryImportJobs(
  enterpriseId: number,
  limit = 10,
  viewerUserId?: number,
  canAccessEnterpriseJobs = true,
) {
  const database = await getDb();
  requireDatabase(database);
  const jobs = await database
    .select()
    .from(inventoryImportJobs)
    .where(
      and(
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        !canAccessEnterpriseJobs && viewerUserId
          ? eq(inventoryImportJobs.createdByUserId, viewerUserId)
          : undefined,
      ),
    )
    .orderBy(desc(inventoryImportJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 30));
  return jobs.map(toPublicJob);
}

export async function assertInventoryImportJobAccess(input: {
  jobId: string;
  enterpriseId: number;
  viewerUserId: number;
  canAccessEnterpriseJobs: boolean;
}) {
  const database = await getDb();
  requireDatabase(database);
  const job = (
    await database
      .select({ createdByUserId: inventoryImportJobs.createdByUserId })
      .from(inventoryImportJobs)
      .where(
        and(
          eq(inventoryImportJobs.id, input.jobId),
          eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          input.canAccessEnterpriseJobs
            ? undefined
            : eq(inventoryImportJobs.createdByUserId, input.viewerUserId),
        ),
      )
      .limit(1)
  )[0];
  if (!job) throw new Error("导入任务不存在");
}

export async function getInventoryImportJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  const job = (
    await database
      .select()
      .from(inventoryImportJobs)
      .where(
        and(
          eq(inventoryImportJobs.id, jobId),
          eq(inventoryImportJobs.enterpriseId, enterpriseId),
        ),
      )
      .limit(1)
  )[0];
  if (!job) throw new Error("导入任务不存在");
  return toPublicJob(job);
}

/**
 * Read-only recovery metadata. Batch records are returned exactly as stored:
 * callers must never reconstruct old boundaries from stagedRows / 500.
 */
export async function getInventoryImportUploadPlan(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  // The job counters and batch ledger must be read from one explicit
  // repeatable-read, read-only snapshot.  This procedure intentionally takes
  // no row locks and performs no writes.
  return database.transaction(async tx => {
    const job = (
      await tx
      .select({
        id: inventoryImportJobs.id,
        status: inventoryImportJobs.status,
        stagedRows: inventoryImportJobs.stagedRows,
        totalRows: inventoryImportJobs.totalRows,
      })
      .from(inventoryImportJobs)
      .where(and(
        eq(inventoryImportJobs.id, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
      ))
        .limit(1)
    )[0];
    if (!job) throw new Error("导入任务不存在");
    const uploadedBatches = await tx
      .select({
        batchIndex: inventoryImportBatches.batchIndex,
        startRow: inventoryImportBatches.startRow,
        rowCount: inventoryImportBatches.rowCount,
        payloadHash: inventoryImportBatches.payloadHash,
      })
      .from(inventoryImportBatches)
      .where(eq(inventoryImportBatches.jobId, jobId))
      .orderBy(asc(inventoryImportBatches.batchIndex));

    let expectedBatchIndex = 0;
    let expectedStartRow = 1;
    let summedRows = 0;
    for (const batch of uploadedBatches) {
      const rowCount = Number(batch.rowCount);
      if (
        batch.batchIndex !== expectedBatchIndex
        || batch.startRow !== expectedStartRow
        || !Number.isSafeInteger(rowCount)
        || rowCount < 1
      ) {
        throw new Error("上传批次记录不连续，无法安全续传，请联系平台管理员");
      }
      expectedBatchIndex += 1;
      expectedStartRow += rowCount;
      summedRows += rowCount;
    }
    if (summedRows !== job.stagedRows) {
      throw new Error("上传批次记录与暂存进度不一致，无法安全续传，请联系平台管理员");
    }
    return {
      jobId: job.id,
      status: job.status,
      totalRows: job.totalRows,
      stagedRows: job.stagedRows,
      uploadedBatches,
      nextBatchIndex: expectedBatchIndex,
      nextStartRow: expectedStartRow,
    };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
    // In repeatable-read, the first non-locking SELECT establishes the snapshot.
    // Combining both flags generates invalid SQL in the deployed Drizzle version.
  });
}

export async function listInventoryImportErrors(jobId: string, enterpriseId: number, limit = 50) {
  const database = await getDb();
  requireDatabase(database);
  const pageSize = Math.min(Math.max(limit, 1), 200);
  const errors = await database
    .select({
      rowNumber: inventoryImportStaging.rowNumber,
      partNumber: inventoryImportStaging.partNumber,
      errorCode: inventoryImportStaging.errorCode,
      errorMessage: inventoryImportStaging.errorMessage,
    })
    .from(inventoryImportStaging)
    .innerJoin(inventoryImportJobs, eq(inventoryImportJobs.id, inventoryImportStaging.jobId))
    .where(
      and(
        eq(inventoryImportStaging.jobId, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        eq(inventoryImportStaging.status, "error"),
      ),
    )
    .orderBy(asc(inventoryImportStaging.rowNumber))
    .limit(pageSize);
  const rejected = await database
    .select({
      rowNumber: inventoryImportRejected.rowNumber,
      rawRow: inventoryImportRejected.rawRow,
      errorMessage: inventoryImportRejected.errorMessage,
    })
    .from(inventoryImportRejected)
    .innerJoin(inventoryImportJobs, eq(inventoryImportJobs.id, inventoryImportRejected.jobId))
    .where(and(
      eq(inventoryImportRejected.jobId, jobId),
      eq(inventoryImportJobs.enterpriseId, enterpriseId),
    ))
    .orderBy(asc(inventoryImportRejected.rowNumber))
    .limit(pageSize);
  return [
    ...errors,
    ...rejected.map(row => ({
      rowNumber: row.rowNumber,
      partNumber: String((JSON.parse(row.rawRow) as Record<string, unknown>).partNumber ?? ""),
      errorCode: "ROW_VALIDATION",
      errorMessage: row.errorMessage,
    })),
  ].sort((a, b) => a.rowNumber - b.rowNumber).slice(0, pageSize);
}

export async function listInventoryImportFailedRows(
  jobId: string,
  enterpriseId: number,
  afterRowNumber = 0,
  limit = INVENTORY_IMPORT_ERROR_PAGE_SIZE,
) {
  const database = await getDb();
  requireDatabase(database);
  const pageSize = Math.min(Math.max(limit, 1), INVENTORY_IMPORT_ERROR_PAGE_SIZE);
  const processed = await database
    .select({
      rowNumber: inventoryImportStaging.rowNumber,
      partNumber: inventoryImportStaging.partNumber,
      brand: inventoryImportStaging.brand,
      category: inventoryImportStaging.category,
      pkg: inventoryImportStaging.pkg,
      dateCode: inventoryImportStaging.dateCode,
      qtyOnSale: inventoryImportStaging.qtyOnSale,
      priceEx: inventoryImportStaging.priceEx,
      taxIncluded: inventoryImportStaging.taxIncluded,
      moq: inventoryImportStaging.moq,
      spq: inventoryImportStaging.spq,
      leadTime: inventoryImportStaging.leadTime,
      warehouseAddress: inventoryImportStaging.warehouseAddress,
      rohs: inventoryImportStaging.rohs,
      note: inventoryImportStaging.note,
      errorMessage: inventoryImportStaging.errorMessage,
    })
    .from(inventoryImportStaging)
    .innerJoin(inventoryImportJobs, eq(inventoryImportJobs.id, inventoryImportStaging.jobId))
    .where(
      and(
        eq(inventoryImportStaging.jobId, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        eq(inventoryImportStaging.status, "error"),
        gt(inventoryImportStaging.rowNumber, afterRowNumber),
      ),
    )
    .orderBy(asc(inventoryImportStaging.rowNumber))
    .limit(pageSize);
  const rejected = await database
    .select({
      rowNumber: inventoryImportRejected.rowNumber,
      rawRow: inventoryImportRejected.rawRow,
      errorMessage: inventoryImportRejected.errorMessage,
    })
    .from(inventoryImportRejected)
    .innerJoin(inventoryImportJobs, eq(inventoryImportJobs.id, inventoryImportRejected.jobId))
    .where(and(
      eq(inventoryImportRejected.jobId, jobId),
      eq(inventoryImportJobs.enterpriseId, enterpriseId),
      gt(inventoryImportRejected.rowNumber, afterRowNumber),
    ))
    .orderBy(asc(inventoryImportRejected.rowNumber))
    .limit(pageSize);
  const mergedRejected = rejected.map(({ rowNumber, rawRow, errorMessage }) => {
    const data = JSON.parse(rawRow) as Record<string, unknown>;
    const cell = (field: string) => data[field] == null ? "" : String(data[field]);
    return {
      rowNumber,
      partNumber: cell("partNumber"), brand: cell("brand"), category: cell("category"), pkg: cell("pkg"),
      dateCode: cell("dateCode"), qtyOnSale: cell("qtyOnSale"), priceEx: cell("priceEx"),
      taxIncluded: data.taxIncluded === true, moq: cell("moq"), spq: cell("spq"),
      leadTime: cell("leadTime"), warehouseAddress: cell("warehouseAddress"),
      rohs: data.rohs === true, note: cell("note"), errorMessage,
    };
  });
  return [...processed, ...mergedRejected].sort((a, b) => a.rowNumber - b.rowNumber).slice(0, pageSize);
}

export async function pauseInventoryImportJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryImportJobs)
    .set({ status: "paused", leaseOwner: null, leaseExpiresAt: null })
    .where(
      and(
        eq(inventoryImportJobs.id, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        inArray(inventoryImportJobs.status, ["queued", "running"]),
      ),
    );
  return getInventoryImportJob(jobId, enterpriseId);
}

export async function resumeInventoryImportJob(jobId: string, enterpriseId: number) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryImportJobs)
    .set({ status: "queued", leaseOwner: null, leaseExpiresAt: null, errorMessage: null })
    .where(
      and(
        eq(inventoryImportJobs.id, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        eq(inventoryImportJobs.status, "paused"),
      ),
    );
  return getInventoryImportJob(jobId, enterpriseId);
}

export async function retryFailedInventoryImportJob(jobId: string, enterpriseId: number) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  try {
    return await database.transaction(async tx => {
      const job = (
        await tx
          .select()
          .from(inventoryImportJobs)
          .where(
            and(
              eq(inventoryImportJobs.id, jobId),
              eq(inventoryImportJobs.enterpriseId, enterpriseId),
            ),
          )
          .limit(1)
          .for("update")
      )[0];
      if (!job) throw new Error("导入任务不存在");
      if (job.status !== "failed") throw new Error("只有处理失败的任务可以重试");

      const active = (
        await tx
          .select({ id: inventoryImportJobs.id })
          .from(inventoryImportJobs)
          .where(eq(inventoryImportJobs.activeEnterpriseId, enterpriseId))
          .limit(1)
      )[0];
      if (active) throw new Error("当前企业已有库存导入任务，请等待完成或先取消该任务");

      const [pending] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventoryImportStaging)
        .where(
          and(
            eq(inventoryImportStaging.jobId, jobId),
            eq(inventoryImportStaging.status, "pending"),
          ),
        );
      if (Number(pending?.count ?? 0) === 0) {
        throw new Error("该失败任务没有剩余待处理数据");
      }

      await tx
        .update(inventoryImportJobs)
        .set({
          activeEnterpriseId: enterpriseId,
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          errorMessage: null,
          attemptCount: 0,
          finishedAt: null,
        })
        .where(eq(inventoryImportJobs.id, jobId));
      return toPublicJob({
        ...job,
        activeEnterpriseId: enterpriseId,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: null,
        attemptCount: 0,
        finishedAt: null,
      });
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code === "ER_DUP_ENTRY") {
      throw new Error("当前企业已有库存导入任务，请等待完成或先取消该任务");
    }
    throw error;
  }
}

export async function cancelInventoryImportJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryImportJobs)
    .set({
      status: "cancelled",
      activeEnterpriseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryImportJobs.id, jobId),
        eq(inventoryImportJobs.enterpriseId, enterpriseId),
        inArray(inventoryImportJobs.status, [...ACTIVE_STATUSES]),
      ),
    );
  return getInventoryImportJob(jobId, enterpriseId);
}

export async function availableMemoryBytes(): Promise<number> {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const match = raw.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function claimNextInventoryImportJob(workerId = workerInstanceId) {
  if (isInventoryQuotaDeploymentBusy()) return null;
  const database = await getDb();
  requireDatabase(database);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  return database.transaction(async tx => {
    const candidate = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          or(
            eq(inventoryImportJobs.status, "queued"),
            and(
              eq(inventoryImportJobs.status, "running"),
              or(isNull(inventoryImportJobs.leaseExpiresAt), lte(inventoryImportJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .orderBy(asc(inventoryImportJobs.createdAt))
        .limit(1)
        .for("update")
    )[0];
    if (!candidate) return null;
    await tx
      .update(inventoryImportJobs)
      .set({
        status: "running",
        leaseOwner: workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        startedAt: candidate.startedAt ?? now,
        errorMessage: null,
      })
      .where(eq(inventoryImportJobs.id, candidate.id));
    return { ...candidate, status: "running" as const, leaseOwner: workerId, leaseExpiresAt };
  });
}

async function actorCanStillPublish(job: InventoryImportJob): Promise<boolean> {
  const database = await getDb();
  requireDatabase(database);
  const rows = await database
    .select({
      memberId: enterpriseMembers.id,
      role: enterpriseMembers.role,
      status: enterpriseMembers.status,
      superAdminUserId: enterprises.superAdminUserId,
      permissionKey: enterpriseMemberPermissions.permissionKey,
    })
    .from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
    .leftJoin(
      enterpriseMemberPermissions,
      eq(enterpriseMemberPermissions.enterpriseMemberId, enterpriseMembers.id),
    )
    .where(
      and(
        eq(enterpriseMembers.enterpriseId, job.enterpriseId),
        eq(enterpriseMembers.userId, job.createdByUserId),
      ),
    );
  if (rows.length === 0 || rows[0].status !== "active") return false;
  return rows[0].role === "super_admin"
    || rows[0].superAdminUserId === job.createdByUserId
    || rows.some(row => row.permissionKey === "inventory.publish");
}

function publicationRequestId(jobId: string, rowNumber: number): string {
  return `imp:${jobId}:${rowNumber}`;
}

export async function processInventoryImportBatch(
  claimedJob: InventoryImportJob,
  workerId = workerInstanceId,
  batchSize = INVENTORY_IMPORT_WORKER_BATCH_SIZE,
) {
  const database = await getDb();
  requireDatabase(database);
  if (await availableMemoryBytes() < MIN_AVAILABLE_MEMORY_BYTES) {
    const [pauseResult] = await database
      .update(inventoryImportJobs)
      .set({ status: "paused", leaseOwner: null, leaseExpiresAt: null, errorMessage: "服务器可用内存不足，任务已自动暂停" })
      .where(activeImportLeaseCondition(claimedJob.id, workerId));
    return { processed: 0, paused: affectedRows(pauseResult) === 1, completed: false } as const;
  }

  const current = (
    await database
      .select()
      .from(inventoryImportJobs)
      .where(activeImportLeaseCondition(claimedJob.id, workerId))
      .limit(1)
  )[0];
  if (!current || current.status !== "running" || current.leaseOwner !== workerId) {
    return { processed: 0, paused: false, completed: false } as const;
  }
  if (!(await actorCanStillPublish(current))) {
    const [permissionResult] = await database
      .update(inventoryImportJobs)
      .set({
        status: "failed",
        activeEnterpriseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: "任务创建人的库存发布权限已失效",
        finishedAt: new Date(),
      })
      .where(activeImportLeaseCondition(current.id, workerId));
    return { processed: 0, paused: false, completed: affectedRows(permissionResult) === 1 } as const;
  }

  const stagingRows = await database
    .select()
    .from(inventoryImportStaging)
    .where(
      and(
        eq(inventoryImportStaging.jobId, current.id),
        eq(inventoryImportStaging.status, "pending"),
      ),
    )
    .orderBy(asc(inventoryImportStaging.rowNumber))
    .limit(Math.min(Math.max(batchSize, 1), INVENTORY_IMPORT_STAGE_BATCH_SIZE));

  if (stagingRows.length === 0) {
    const [completionResult] = await database
      .update(inventoryImportJobs)
      .set({
        status: "completed",
        activeEnterpriseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        finishedAt: new Date(),
      })
      .where(activeImportLeaseCondition(current.id, workerId));
    return { processed: 0, paused: false, completed: affectedRows(completionResult) === 1 } as const;
  }

  const result = await withInventoryPublisherLock(
    current.dataOwnerUserId,
    current.enterpriseId,
    () => database.transaction(async tx => {
    const freshJob = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(eq(inventoryImportJobs.id, current.id))
        .limit(1)
        .for("update")
    )[0];
    if (
      !freshJob
      || freshJob.status !== "running"
      || freshJob.leaseOwner !== workerId
      || !freshJob.leaseExpiresAt
      || freshJob.leaseExpiresAt.getTime() <= Date.now()
    ) {
      return { processed: 0, success: 0, errors: 0, duplicates: 0, completed: false };
    }

    const enterprise = (
      await tx
        .select({ superAdminUserId: enterprises.superAdminUserId })
        .from(enterprises)
        .where(eq(enterprises.id, freshJob.enterpriseId))
        .limit(1)
        .for("update")
    )[0];
    const member = (
      await tx
        .select({
          id: enterpriseMembers.id,
          role: enterpriseMembers.role,
          status: enterpriseMembers.status,
        })
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, freshJob.enterpriseId),
            eq(enterpriseMembers.userId, freshJob.createdByUserId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    const isOwner = Boolean(
      member
      && (member.role === "super_admin" || enterprise?.superAdminUserId === freshJob.createdByUserId),
    );
    const permissionRows = member && member.role !== "super_admin"
      ? await tx
          .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
          .from(enterpriseMemberPermissions)
          .where(eq(enterpriseMemberPermissions.enterpriseMemberId, member.id))
          .for("update")
      : [];
    const permissionActive = Boolean(
      member
      && member.status === "active"
      && (
        isOwner
        || permissionRows.some(row => row.permissionKey === "inventory.publish")
      ),
    );
    if (!permissionActive) {
      const [permissionResult] = await tx
        .update(inventoryImportJobs)
        .set({
          status: "failed",
          activeEnterpriseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          errorMessage: "任务创建人的库存发布权限已失效",
          finishedAt: new Date(),
        })
        .where(activeImportLeaseCondition(freshJob.id, workerId));
      return {
        processed: 0,
        success: 0,
        errors: 0,
        duplicates: 0,
        completed: affectedRows(permissionResult) === 1,
      };
    }

    const quota = await getInventoryQuota(tx, {
      enterpriseId: freshJob.enterpriseId,
      dataOwnerUserId: freshJob.dataOwnerUserId,
    }, { lockEnterprise: true });
    const publishedLimitMessage = inventoryPublishedLimitMessage(quota.publishedRowLimit);

    // V3 rows carry an immutable side-table guard. Lock the side records and
    // every explicitly previewed existing target in this same short worker
    // transaction. A missing side row is the intentional legacy signal.
    const versionRows = stagingRows.length === 0 ? [] : await tx
      .select()
      .from(inventoryImportRowVersions)
      .where(and(
        eq(inventoryImportRowVersions.jobId, current.id),
        inArray(inventoryImportRowVersions.rowNumber, stagingRows.map(row => row.rowNumber)),
      ))
      .for("update");
    const versionByRow = new Map(versionRows.map(row => [row.rowNumber, row]));
    const guardedInventoryIds = Array.from(new Set(versionRows
      .filter(row => row.guardKind === "existing" && row.inventoryId != null)
      .map(row => row.inventoryId!)));
    const lockedGuardInventories = guardedInventoryIds.length === 0 ? [] : await tx
      .select()
      .from(inventories)
      .where(inArray(inventories.id, guardedInventoryIds))
      .for("update");
    const lockedInventoryById = new Map(lockedGuardInventories.map(row => [row.id, row]));

    const requestIds = stagingRows.map(row => publicationRequestId(current.id, row.rowNumber));
    const existingCreated = requestIds.length > 0
      ? await tx
          .select({ id: inventories.id, publishRequestId: inventories.publishRequestId })
          .from(inventories)
          .where(
            and(
              eq(inventories.userId, current.dataOwnerUserId),
            eq(inventories.enterpriseId, current.enterpriseId),
              inArray(inventories.publishRequestId, requestIds),
            ),
          )
      : [];
    const inventoryByRequest = new Map(
      existingCreated
        .filter(row => row.publishRequestId)
        .map(row => [row.publishRequestId!, row.id]),
    );

    const succeeded: Array<{ rowNumber: number; inventoryId: number; updated?: boolean }> = [];
    const duplicateRows: number[] = [];
    const ambiguousRows: number[] = [];
    const updateFailedRows: number[] = [];
    const candidates: typeof stagingRows = [];
    const seenInBatch = new Set<string>();
    for (const row of stagingRows) {
      const existingId = inventoryByRequest.get(publicationRequestId(current.id, row.rowNumber));
      if (existingId) {
        succeeded.push({ rowNumber: row.rowNumber, inventoryId: existingId });
        continue;
      }
      if (seenInBatch.has(row.partNumberNormalized)) {
        duplicateRows.push(row.rowNumber);
        continue;
      }
      seenInBatch.add(row.partNumberNormalized);
      candidates.push(row);
    }

    const previousSucceeded = candidates.length > 0
      ? await tx
          .select({ partNumberNormalized: inventoryImportStaging.partNumberNormalized })
          .from(inventoryImportStaging)
          .where(
            and(
              eq(inventoryImportStaging.jobId, current.id),
              eq(inventoryImportStaging.status, "success"),
              inArray(
                inventoryImportStaging.partNumberNormalized,
                candidates.map(row => row.partNumberNormalized),
              ),
            ),
          )
      : [];
    const previousTaskParts = new Set(previousSucceeded.map(row => row.partNumberNormalized));
    const taskUniqueCandidates = candidates.filter(row => {
      if (!previousTaskParts.has(row.partNumberNormalized)) return true;
      duplicateRows.push(row.rowNumber);
      return false;
    });

    // This V3-only candidate map intentionally mirrors stage: every exact
    // same-enterprise candidate is locked, including drafts and other owners.
    // The legacy map below remains scoped to its historical current owner and
    // published status behavior.
    const guardCandidatesByPart = new Map<string, Inventory[]>();
    const guardedPartNumbers = Array.from(new Set(taskUniqueCandidates
      .filter(row => versionByRow.has(row.rowNumber))
      .map(row => row.partNumberNormalized)));
    if (guardedPartNumbers.length > 0) {
      const guardedCandidates = await tx
        .select()
        .from(inventories)
        .where(and(
          eq(inventories.enterpriseId, freshJob.enterpriseId),
          inArray(inventories.partNumberNormalized, guardedPartNumbers),
        ))
        .for("update");
      for (const candidate of guardedCandidates) {
        const key = String(candidate.partNumberNormalized ?? "");
        const list = guardCandidatesByPart.get(key) ?? [];
        list.push(candidate);
        guardCandidatesByPart.set(key, list);
      }
    }

    const existingByPart = new Map<string, Array<{ id: number; partNumberNormalized: string }>>();
    if ((freshJob.saveAs === "published" || freshJob.clientRequestId.startsWith("repair_")) && taskUniqueCandidates.length > 0) {
      const existingPublished = await tx
        .select({
          id: inventories.id,
          partNumberNormalized: inventories.partNumberNormalized,
        })
        .from(inventories)
        .where(
          and(
            eq(inventories.userId, current.dataOwnerUserId),
            eq(inventories.enterpriseId, current.enterpriseId),
            freshJob.clientRequestId.startsWith("repair_") ? inArray(inventories.status, ["draft", "published"]) : eq(inventories.status, "published"),
            inArray(
              inventories.partNumberNormalized,
              taskUniqueCandidates.map(row => row.partNumberNormalized),
            ),
          ),
        )
        .for("update");
      for (const row of existingPublished) {
        const key = String(row.partNumberNormalized ?? "");
        const list = existingByPart.get(key) ?? [];
        list.push({ id: row.id, partNumberNormalized: key });
        existingByPart.set(key, list);
      }
    }

    const insertable: typeof stagingRows = [];
    const updatable: Array<{
      row: (typeof stagingRows)[number];
      inventoryId: number;
      expectedRevision?: number | null;
      expectedStatus?: Inventory["status"];
      restore?: boolean;
    }> = [];
    const stalePreviewRows: number[] = [];
    const repairExistingRows: number[] = [];
    for (const row of taskUniqueCandidates) {
      const guard = versionByRow.get(row.rowNumber);
      if (guard) {
        const decision = decideWorkerAction({
          guard,
          candidateInventories: guardCandidatesByPart.get(row.partNumberNormalized) ?? [],
          lockedInventoryById,
          scope: {
            enterpriseId: freshJob.enterpriseId,
            userId: freshJob.dataOwnerUserId,
            ownerUserId: freshJob.ownerUserId,
            partNumberNormalized: row.partNumberNormalized,
          },
        });
        if (decision.action === "stale") {
          stalePreviewRows.push(row.rowNumber);
          continue;
        }
        // Repair rows now have a V3 snapshot too, but a valid snapshot never
        // turns repair into an update. Reuse the original repair resolution so
        // existing draft/published inventory is still reported, not modified.
        if (freshJob.clientRequestId.startsWith("repair_")) {
          const repairMatches = existingByPart.get(row.partNumberNormalized) ?? [];
          if (repairMatches.length === 0 && decision.action === "insert") {
            insertable.push(row);
          } else if (repairMatches.length > 1) {
            ambiguousRows.push(row.rowNumber);
          } else {
            repairExistingRows.push(row.rowNumber);
          }
          continue;
        }
        if (decision.action === "insert") {
          insertable.push(row);
          continue;
        }
        if (decision.action === "update") {
          updatable.push({
            row,
            inventoryId: decision.inventoryId,
            expectedRevision: decision.expectedRevision,
            expectedStatus: decision.expectedStatus,
            restore: decision.restore,
          });
          continue;
        }
      }
      // No side guard means this row predates V3; retain the legacy lookup.
      const matches = existingByPart.get(row.partNumberNormalized) ?? [];
      if (matches.length === 0) {
        insertable.push(row);
        continue;
      }
      if (matches.length > 1) {
        ambiguousRows.push(row.rowNumber);
        continue;
      }
      if (freshJob.clientRequestId.startsWith("repair_")) {
        repairExistingRows.push(row.rowNumber);
        continue;
      }
      updatable.push({ row, inventoryId: matches[0].id });
    }

    // A recovery is a publication, not a normal published-record update.
    // Validate the projected availability against the locked row before it can
    // consume a published slot. Missing/invalid data remains fail-closed.
    const publishValidationFailedRows: number[] = [];
    const publishableUpdatable = updatable.filter(item => {
      if (!item.restore) return true;
      const locked = lockedInventoryById.get(item.inventoryId);
      const valid = Boolean(
        locked
        && hasInventoryLeadTime(item.row.leadTime)
        && canPublishInventoryAvailability({
          qtyOnSale: item.row.qtyOnSale,
          qtyOrder: locked.qtyOrder,
          leadTime: item.row.leadTime,
        }),
      );
      if (!valid) publishValidationFailedRows.push(item.row.rowNumber);
      return valid;
    });

    let capacityRejectedRows: number[] = [];
    let acceptedInsertable = insertable;
    let acceptedUpdatable = publishableUpdatable;
    const publicationConsumers = [
      ...insertable.map(row => ({ rowNumber: row.rowNumber })),
      ...publishableUpdatable.filter(item => item.restore).map(item => ({ rowNumber: item.row.rowNumber })),
    ].sort((left, right) => left.rowNumber - right.rowNumber);
    if (freshJob.saveAs === "published" && publicationConsumers.length > 0) {
      const [publishedSummary] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventories)
        .where(
          and(
            eq(inventories.userId, current.dataOwnerUserId),
            eq(inventories.enterpriseId, current.enterpriseId),
            eq(inventories.status, "published"),
          ),
        );
      const availableSlots = Math.max(
        0,
        quota.publishedRowLimit - Number(publishedSummary?.count ?? 0),
      );
      const acceptedRows = new Set(publicationConsumers.slice(0, availableSlots).map(item => item.rowNumber));
      acceptedInsertable = insertable.filter(row => acceptedRows.has(row.rowNumber));
      acceptedUpdatable = publishableUpdatable.filter(item => !item.restore || acceptedRows.has(item.row.rowNumber));
      capacityRejectedRows = publicationConsumers.slice(availableSlots).map(item => item.rowNumber);
    }

    if (acceptedInsertable.length > 0) {
      const now = new Date();
      await tx
        .insert(inventories)
        .values(
          acceptedInsertable.map(row => ({
          userId: current.dataOwnerUserId,
          enterpriseId: current.enterpriseId,
          ownerUserId: current.ownerUserId,
          createdByUserId: current.createdByUserId,
          updatedByUserId: current.createdByUserId,
          ownerAssignedAt: now,
          ownershipVersion: 1,
          partNumber: row.partNumber,
          brand: row.brand,
          category: row.category,
          pkg: row.pkg,
          dateCode: row.dateCode,
          qtyOnSale: row.qtyOnSale,
          qtyStock: row.qtyStock,
          priceEx: row.priceEx,
          priceIncl: row.priceIncl,
          taxIncluded: row.taxIncluded,
          invoice: true,
          ladderPrices: null,
          moq: row.moq,
          spq: row.spq,
          leadTime: row.leadTime,
          warehouseAddress: row.warehouseAddress,
          rohs: row.rohs,
          note: row.note,
          status: freshJob.saveAs,
          publishedAt: freshJob.saveAs === "published" ? now : null,
          publishRequestId: publicationRequestId(current.id, row.rowNumber),
          publishAttemptedByUserId: current.createdByUserId,
          publishAttemptCount: 0,
          })),
        )
        .onDuplicateKeyUpdate({ set: { id: sql`${inventories.id}` } });

      const inserted = await tx
        .select({ id: inventories.id, publishRequestId: inventories.publishRequestId })
        .from(inventories)
        .where(
          and(
            eq(inventories.userId, current.dataOwnerUserId),
            eq(inventories.enterpriseId, current.enterpriseId),
            inArray(
              inventories.publishRequestId,
              acceptedInsertable.map(row => publicationRequestId(current.id, row.rowNumber)),
            ),
          ),
        );
      const insertedByRequest = new Map(
        inserted
          .filter(row => row.publishRequestId)
          .map(row => [row.publishRequestId!, row.id]),
      );
      for (const row of acceptedInsertable) {
        const inventoryId = insertedByRequest.get(publicationRequestId(current.id, row.rowNumber));
        if (inventoryId) {
          succeeded.push({ rowNumber: row.rowNumber, inventoryId });
        } else {
          duplicateRows.push(row.rowNumber);
        }
      }
    }

    if (acceptedUpdatable.length > 0) {
      const now = new Date();
      for (const item of acceptedUpdatable) {
        const row = item.row;
        const patch: Partial<Inventory> = {
          brand: row.brand,
          dateCode: row.dateCode,
          qtyOnSale: row.qtyOnSale,
          qtyStock: row.qtyStock,
          leadTime: row.leadTime,
          taxIncluded: row.taxIncluded,
          rohs: row.rohs,
          updatedByUserId: current.createdByUserId,
          refreshedAt: now,
          publishAttemptedByUserId: current.createdByUserId,
          publishAttemptCount: 0,
          publishErrorCode: null,
          publishErrorMessage: null,
          publishErrorFields: null,
          publishFailedAt: null,
        };
        if (row.category && row.category !== "其他") patch.category = row.category;
        if (row.pkg) patch.pkg = row.pkg;
        if (row.priceEx != null) {
          patch.priceEx = row.priceEx;
          patch.priceIncl = row.priceIncl;
        }
        if (row.moq != null) patch.moq = row.moq;
        if (row.spq != null) patch.spq = row.spq;
        if (row.warehouseAddress) patch.warehouseAddress = row.warehouseAddress;
        if (row.note) patch.note = row.note;
        if (item.restore) {
          patch.status = "published";
          patch.publishedAt = now;
          patch.offshelfBy = null;
          patch.offshelfReason = null;
        }
        const [updateResult] = await tx
          .update(inventories)
          .set(patch)
          .where(
            and(
              eq(inventories.id, item.inventoryId),
              eq(inventories.userId, current.dataOwnerUserId),
            eq(inventories.enterpriseId, current.enterpriseId),
              eq(inventories.enterpriseId, current.enterpriseId),
              eq(inventories.status, item.expectedStatus ?? "published"),
              item.expectedRevision == null
                ? undefined
                : eq(inventories.ownershipVersion, item.expectedRevision),
            ),
          );
        if (Number(updateResult.affectedRows ?? 0) === 1) {
          succeeded.push({ rowNumber: row.rowNumber, inventoryId: item.inventoryId, updated: true });
        } else {
          updateFailedRows.push(row.rowNumber);
        }
      }
    }

    const createdSucceeded = succeeded.filter(item => !item.updated);
    const updatedSucceeded = succeeded.filter(item => item.updated);
    if (createdSucceeded.length > 0) {
      await tx
        .insert(inventoryImportResults)
        .values(
          createdSucceeded.map(item => ({
            jobId: current.id,
            rowNumber: item.rowNumber,
            inventoryId: item.inventoryId,
          })),
        )
        .onDuplicateKeyUpdate({ set: { jobId: sql`VALUES(${inventoryImportResults.jobId})` } });
    }
    if (succeeded.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({ status: "success", errorCode: null, errorMessage: null, processedAt: new Date() })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(
              inventoryImportStaging.rowNumber,
              succeeded.map(item => item.rowNumber),
            ),
          ),
        );
    }

    if (duplicateRows.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({
          status: "error",
          errorCode: "DUPLICATE_PART_NUMBER",
          errorMessage: "文件内型号重复，已按第一条处理",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(inventoryImportStaging.rowNumber, duplicateRows),
          ),
        );
    }

    if (updateFailedRows.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({
          status: "error",
          errorCode: "UPDATE_NOT_APPLIED",
          errorMessage: "该型号当前无法更新，请刷新后重试",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(inventoryImportStaging.rowNumber, updateFailedRows),
          ),
        );
    }

    if (ambiguousRows.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({
          status: "error",
          errorCode: "AMBIGUOUS_PART_NUMBER",
          errorMessage: "同型号有多条在售库存，请先合并后再导入",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(inventoryImportStaging.rowNumber, ambiguousRows),
          ),
        );
    }

    if (capacityRejectedRows.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({
          status: "error",
          errorCode: "PUBLISHED_LIMIT_REACHED",
          errorMessage: publishedLimitMessage,
          processedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(inventoryImportStaging.rowNumber, capacityRejectedRows),
          ),
        );
    }

    if (stalePreviewRows.length > 0) {
      await tx
        .update(inventoryImportStaging)
        .set({
          status: "error",
          errorCode: "STALE_PREVIEW",
          errorMessage: stalePreviewMessage(),
          processedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryImportStaging.jobId, current.id),
            inArray(inventoryImportStaging.rowNumber, stalePreviewRows),
          ),
        );
    }

    if (repairExistingRows.length > 0) {
      await tx.update(inventoryImportStaging).set({status: "error", errorCode: "REPAIR_EXISTING_INVENTORY", errorMessage: "该型号已有待发布或已发布库存，请在原库存中处理", processedAt: new Date()}).where(and(eq(inventoryImportStaging.jobId, current.id), inArray(inventoryImportStaging.rowNumber, repairExistingRows)));
    }
    const errorCount = duplicateRows.length + capacityRejectedRows.length + ambiguousRows.length + updateFailedRows.length + stalePreviewRows.length + repairExistingRows.length;
    const processed = succeeded.length + errorCount;
    const [progressResult] = await tx
      .update(inventoryImportJobs)
      .set({
        processedRows: sql`${inventoryImportJobs.processedRows} + ${processed}`,
        successRows: sql`${inventoryImportJobs.successRows} + ${succeeded.length}`,
        errorRows: sql`${inventoryImportJobs.errorRows} + ${errorCount}`,
        duplicateRows: sql`${inventoryImportJobs.duplicateRows} + ${duplicateRows.length}`,
        updatedRows: sql`${inventoryImportJobs.updatedRows} + ${updatedSucceeded.length}`,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        heartbeatAt: new Date(),
      })
      .where(activeImportLeaseCondition(freshJob.id, workerId));
    if (affectedRows(progressResult) !== 1) {
      throw new Error("库存导入任务租约已失效");
    }

    const [remaining] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventoryImportStaging)
      .where(
        and(
          eq(inventoryImportStaging.jobId, current.id),
          eq(inventoryImportStaging.status, "pending"),
        ),
      );
    const completed = Number(remaining?.count ?? 0) === 0;
    if (completed) {
      const [completionResult] = await tx
        .update(inventoryImportJobs)
        .set({
          status: "completed",
          activeEnterpriseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
        })
        .where(activeImportLeaseCondition(freshJob.id, workerId));
      if (affectedRows(completionResult) !== 1) {
        throw new Error("库存导入任务租约已失效");
      }
    }
    return {
      processed,
      success: succeeded.length,
      updated: updatedSucceeded.length,
      errors: errorCount,
      duplicates: duplicateRows.length,
      completed,
    };
    }),
  );

  return { ...result, paused: false } as const;
}

export async function recordInventoryImportFailure(
  jobId: string,
  workerId: string,
  error: unknown,
) {
  const database = await getDb();
  requireDatabase(database);
  const rawMessage = error instanceof Error ? error.message : "";
  const errorCode = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  const retryable = /库存发布操作繁忙/.test(rawMessage) || new Set([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ER_LOCK_DEADLOCK",
    "ER_LOCK_WAIT_TIMEOUT",
    "ER_SERVER_SHUTDOWN",
    "ER_TOO_MANY_USER_CONNECTIONS",
  ]).has(errorCode);
  await database.transaction(async tx => {
    const leaseCheckAt = new Date();
    const current = (
      await tx
        .select({ attemptCount: inventoryImportJobs.attemptCount })
        .from(inventoryImportJobs)
        .where(activeImportLeaseCondition(jobId, workerId, leaseCheckAt))
        .limit(1)
        .for("update")
    )[0];
    if (!current) return;
    const attempts = retryable ? current.attemptCount : current.attemptCount + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const [failureResult] = await tx
      .update(inventoryImportJobs)
      .set({
        attemptCount: attempts,
        status: terminal ? "failed" : "queued",
        activeEnterpriseId: terminal ? null : undefined,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: terminal
          ? "后台处理连续失败，请点击“重试剩余行”或联系平台管理员"
          : retryable
            ? "系统暂时繁忙，任务正在自动排队重试"
            : "任务处理失败，系统将自动重试",
        finishedAt: terminal ? new Date() : null,
      })
      .where(activeImportLeaseCondition(jobId, workerId, leaseCheckAt));
    if (affectedRows(failureResult) !== 1) {
      throw new Error("库存导入任务租约已失效");
    }
  });
}

export function inventoryImportWorkerId(): string {
  return workerInstanceId;
}

export function isTerminalInventoryImportStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * 空任务15分钟自动取消；已收到部分数据的任务保留24小时供原文件断点续传。
 * 两类任务分开处理，避免刚创建但第一批未到达的空任务长期占位。
 */
export async function expireAbandonedInventoryImportJobs(now = new Date()) {
  const database = await getDb();
  requireDatabase(database);
  const emptyCutoff = new Date(now.getTime() - INVENTORY_IMPORT_EMPTY_STAGING_TTL_MS);
  const partialCutoff = new Date(now.getTime() - INVENTORY_IMPORT_PARTIAL_STAGING_TTL_MS);
  const [emptyResult] = await database
    .update(inventoryImportJobs)
    .set({
      status: "cancelled",
      activeEnterpriseId: null,
      errorMessage: "创建后15分钟未收到数据，任务已自动取消",
      finishedAt: now,
    })
    .where(
      and(
        eq(inventoryImportJobs.status, "staging"),
        eq(inventoryImportJobs.stagedRows, 0),
        lte(inventoryImportJobs.updatedAt, emptyCutoff),
      ),
    );
  const [partialResult] = await database
    .update(inventoryImportJobs)
    .set({
      status: "cancelled",
      activeEnterpriseId: null,
      errorMessage: "文件续传超过24小时未完成，任务已自动取消",
      finishedAt: now,
    })
    .where(
      and(
        eq(inventoryImportJobs.status, "staging"),
        gt(inventoryImportJobs.stagedRows, 0),
        lte(inventoryImportJobs.updatedAt, partialCutoff),
      ),
    );
  return Number(emptyResult.affectedRows ?? 0) + Number(partialResult.affectedRows ?? 0);
}

/** 终态任务保留30天供商家查错，之后按小批量清理暂存数据。 */
export async function cleanupExpiredInventoryImportHistory(now = new Date(), retentionDays = 30) {
  const database = await getDb();
  requireDatabase(database);
  const safeDays = Math.min(Math.max(Math.trunc(retentionDays), 7), 365);
  const cutoff = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const expired = await database
    .select({ id: inventoryImportJobs.id })
    .from(inventoryImportJobs)
    .where(
      and(
        inArray(inventoryImportJobs.status, [...TERMINAL_STATUSES]),
        lte(inventoryImportJobs.finishedAt, cutoff),
      ),
    )
    .orderBy(asc(inventoryImportJobs.finishedAt))
    .limit(20);
  const jobIds = expired.map(job => job.id);
  if (jobIds.length === 0) return 0;
  await database.transaction(async tx => {
    await tx.delete(inventoryImportRowVersions).where(inArray(inventoryImportRowVersions.jobId, jobIds));
    await tx.delete(inventoryImportResults).where(inArray(inventoryImportResults.jobId, jobIds));
    await tx.delete(inventoryImportStaging).where(inArray(inventoryImportStaging.jobId, jobIds));
    await tx.delete(inventoryImportRejected).where(inArray(inventoryImportRejected.jobId, jobIds));
    await tx.delete(inventoryImportBatches).where(inArray(inventoryImportBatches.jobId, jobIds));
    await tx.delete(inventoryImportJobs).where(inArray(inventoryImportJobs.id, jobIds));
  });
  return jobIds.length;
}

type InventoryRepairDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
function inventoryRepairTransactionDb(transactionDb: any): InventoryRepairDatabase {
  return new Proxy(transactionDb, {
    get(target, property) {
      if (property === "transaction") return async (callback: (tx: any) => Promise<any>) => callback(target);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as InventoryRepairDatabase;
}
export async function createInventoryImportJobInTransaction(input: CreateJobInput, transactionDb: any) {
  assertInventoryQuotaDeploymentReady();
  const database = inventoryRepairTransactionDb(transactionDb);
  requireDatabase(database);
  if (input.totalRows < 1 || input.totalRows > INVENTORY_IMPORT_JOB_ROW_LIMIT) {
    throw new Error(`单个导入任务最多支持 ${INVENTORY_IMPORT_JOB_ROW_LIMIT.toLocaleString()} 条`);
  }

  try {
    return await database.transaction(async tx => {
    // Lock the exact enterprise row before SUM so concurrent createJob calls cannot bypass the
    // daily quota. The service validates enterpriseId + stable CRM owner before any exception.
    const quota = await getInventoryQuota(tx, {
      enterpriseId: input.enterpriseId,
      dataOwnerUserId: input.dataOwnerUserId,
    }, { lockEnterprise: true });
    const existingRequest = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
            eq(inventoryImportJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
    )[0];
    if (existingRequest) {
      if (
        existingRequest.totalRows !== input.totalRows
        || existingRequest.fileName !== input.fileName
        || existingRequest.saveAs !== input.saveAs
        || (existingRequest.fileHash ?? null) !== (input.fileHash ?? null)
        || existingRequest.manifestHash !== input.manifestHash
      ) {
        throw new Error("请求号已用于其他导入任务，请重新选择文件");
      }
      return { job: toPublicJob(existingRequest), idempotent: true } as const;
    }

    const active = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(eq(inventoryImportJobs.activeEnterpriseId, input.enterpriseId))
        .limit(1)
        .for("update")
    )[0];
    if (active) {
      const sameFile = active.status === "staging"
        && active.fileHash != null
        && active.fileHash === (input.fileHash ?? null)
        && active.manifestHash === input.manifestHash
        && active.totalRows === input.totalRows
        && active.saveAs === input.saveAs;
      if (sameFile) {
        return { job: toPublicJob(active), idempotent: true } as const;
      }

      const emptyStagingExpired = active.status === "staging"
        && active.stagedRows === 0
        && active.updatedAt.getTime() <= Date.now() - INVENTORY_IMPORT_EMPTY_STAGING_TTL_MS;
      if (!emptyStagingExpired) {
        throw new Error("当前企业已有库存导入任务，请继续上传原文件，或在任务卡中取消后上传新文件");
      }
      await tx
        .update(inventoryImportJobs)
        .set({
          status: "cancelled",
          activeEnterpriseId: null,
          errorMessage: "创建后15分钟未收到数据，任务已自动取消",
          finishedAt: new Date(),
        })
        .where(eq(inventoryImportJobs.id, active.id));
    }

    const [daily] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${inventoryImportJobs.totalRows}), 0)` })
      .from(inventoryImportJobs)
      .where(
        and(
          eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          eq(inventoryImportJobs.dataOwnerUserId, input.dataOwnerUserId),
          gte(inventoryImportJobs.createdAt, beginningOfToday()),
          ne(inventoryImportJobs.status, "cancelled"),
        ),
      );
    if (isInventoryQuotaExceeded(Number(daily?.total ?? 0), quota.dailyImportRowLimit, input.totalRows)) {
      throw new Error(
        `今日库存导入总量最多${quota.dailyImportRowLimit.toLocaleString()}条，请明日再试或联系平台管理员`,
      );
    }

    const id = randomUUID();
    await tx.insert(inventoryImportJobs).values({
      id,
      enterpriseId: input.enterpriseId,
      activeEnterpriseId: input.enterpriseId,
      dataOwnerUserId: input.dataOwnerUserId,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      clientRequestId: input.clientRequestId,
      fileName: input.fileName,
      fileHash: input.fileHash ?? null,
      manifestHash: input.manifestHash,
      totalRows: input.totalRows,
      saveAs: input.saveAs,
      status: "staging",
    });
    const created = (
      await tx.select().from(inventoryImportJobs).where(eq(inventoryImportJobs.id, id)).limit(1)
    )[0];
    if (!created) throw new Error("导入任务创建失败");
      return { job: toPublicJob(created), idempotent: false } as const;
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code !== "ER_DUP_ENTRY") throw error;
    const sameRequest = (
      await database
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
            eq(inventoryImportJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
    )[0];
    if (sameRequest) {
      if (
        sameRequest.totalRows !== input.totalRows
        || sameRequest.fileName !== input.fileName
        || sameRequest.saveAs !== input.saveAs
        || (sameRequest.fileHash ?? null) !== (input.fileHash ?? null)
        || sameRequest.manifestHash !== input.manifestHash
      ) {
        throw new Error("请求号已用于其他导入任务，请重新选择文件");
      }
      return { job: toPublicJob(sameRequest), idempotent: true } as const;
    }
    throw new Error("当前企业已有库存导入任务，请等待完成或先取消该任务");
  }
}

export async function stageInventoryImportBatchInTransaction(input: StageBatchInput, transactionDb: any) {
  const database = inventoryRepairTransactionDb(transactionDb);
  requireDatabase(database);
  if (input.rows.length < 1 || input.rows.length > INVENTORY_IMPORT_STAGE_BATCH_SIZE) {
    throw new Error(`每批最多暂存 ${INVENTORY_IMPORT_STAGE_BATCH_SIZE} 条`);
  }
  const endRow = input.startRow + input.rows.length - 1;
  const hash = payloadHash(input.rows);
  const classified = classifyInventoryImportRows(input.rows, input.startRow);

  return database.transaction(async tx => {
    const job = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.id, input.jobId),
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!job) throw new Error("导入任务不存在");
    if (job.createdByUserId !== input.actorUserId) throw new Error("只有任务创建人可以上传该任务数据");
    if (job.status !== "staging") throw new Error("当前任务已结束暂存，不能继续上传数据");
    if (input.startRow < 1 || endRow > job.totalRows) throw new Error("批次位置超出任务总行数");

    const existingBatch = (
      await tx
        .select()
        .from(inventoryImportBatches)
        .where(
          and(
            eq(inventoryImportBatches.jobId, input.jobId),
            eq(inventoryImportBatches.batchIndex, input.batchIndex),
          ),
        )
        .limit(1)
    )[0];
    if (existingBatch) {
      if (
        existingBatch.startRow !== input.startRow
        || existingBatch.rowCount !== input.rows.length
        || existingBatch.payloadHash !== hash
      ) {
        throw new Error("该批次编号已用于不同数据，请重新创建导入任务");
      }
      return { stagedRows: job.stagedRows, idempotent: true } as const;
    }

    const lastBatch = (
      await tx
        .select({ batchIndex: inventoryImportBatches.batchIndex })
        .from(inventoryImportBatches)
        .where(eq(inventoryImportBatches.jobId, input.jobId))
        .orderBy(desc(inventoryImportBatches.batchIndex))
        .limit(1)
    )[0];
    const nextBatchIndex = lastBatch
      ? lastBatch.batchIndex + 1
      : job.stagedRows === 0 ? 0 : input.batchIndex;
    if (input.batchIndex !== nextBatchIndex || input.startRow !== job.stagedRows + 1) {
      throw new Error("上传批次顺序异常，请读取上传计划后按原批次边界继续");
    }

    await validateInventoryImportV3StageRows(tx, job, classified);
    const values: InsertInventoryImportStagingRow[] = classified.valid.map(({ row, rowNumber }) => {
      const qtyStock = row.qtyStock ?? row.qtyOnSale;
      const price = typeof row.priceEx === "number" && row.priceEx > 0
        ? row.priceEx.toFixed(4)
        : null;
      return {
        jobId: input.jobId,
        enterpriseId: input.enterpriseId,
        rowNumber,
        partNumber: row.partNumber.normalize("NFKC").trim(),
        partNumberNormalized: normalizePartNumber(row.partNumber),
        brand: row.brand.trim(),
        category: row.category?.trim() || "其他",
        pkg: row.pkg?.trim() || null,
        dateCode: row.dateCode.trim(),
        qtyOnSale: row.qtyOnSale,
        qtyStock,
        priceEx: price,
        priceIncl: price,
        taxIncluded: row.taxIncluded,
        moq: row.moq ?? null,
        spq: row.spq ?? null,
        leadTime: row.leadTime.trim(),
        warehouseAddress: row.warehouseAddress?.trim() || null,
        rohs: row.rohs ?? true,
        note: row.note?.trim() || null,
      };
    });

    const previousGood = await tx.select({ rowNumber: inventoryImportStaging.rowNumber })
      .from(inventoryImportStaging).where(eq(inventoryImportStaging.jobId, input.jobId))
      .orderBy(desc(inventoryImportStaging.rowNumber)).limit(1);
    const previousBad = await tx.select({ rowNumber: inventoryImportRejected.rowNumber })
      .from(inventoryImportRejected).where(eq(inventoryImportRejected.jobId, input.jobId))
      .orderBy(desc(inventoryImportRejected.rowNumber)).limit(1);
    const previousRowNumber = Math.max(previousGood[0]?.rowNumber ?? 1, previousBad[0]?.rowNumber ?? 1);
    const currentFirstRow = Math.min(
      classified.valid[0]?.rowNumber ?? Infinity,
      classified.rejected[0]?.rowNumber ?? Infinity,
    );
    if (input.batchIndex > 0 && currentFirstRow <= previousRowNumber) {
      throw new Error("Excel 原始行号顺序异常，请继续上传原文件");
    }
    if (values.length > 0) await tx.insert(inventoryImportStaging).values(values);
    await insertStageVersionGuards(tx, job, values);
    if (classified.rejected.length > 0) {
      await tx.insert(inventoryImportRejected).values(classified.rejected.map(row => ({
        jobId: input.jobId,
        enterpriseId: input.enterpriseId,
        ...row,
      })));
    }
    await tx.insert(inventoryImportBatches).values({
      jobId: input.jobId,
      batchIndex: input.batchIndex,
      startRow: input.startRow,
      rowCount: input.rows.length,
      payloadHash: hash,
    });
    await tx
      .update(inventoryImportJobs)
      .set({
        stagedRows: sql`${inventoryImportJobs.stagedRows} + ${input.rows.length}`,
        errorRows: sql`${inventoryImportJobs.errorRows} + ${classified.rejected.length}`,
        skippedRows: sql`${inventoryImportJobs.skippedRows} + ${classified.rejected.length}`,
      })
      .where(eq(inventoryImportJobs.id, input.jobId));

    return { stagedRows: job.stagedRows + input.rows.length, skippedRows: job.skippedRows + classified.rejected.length, idempotent: false } as const;
  });
}

export async function finalizeInventoryImportJobInTransaction(input: {
  jobId: string;
  enterpriseId: number;
  actorUserId: number;
}, transactionDb: any) {
  assertInventoryQuotaDeploymentReady();
  const database = inventoryRepairTransactionDb(transactionDb);
  requireDatabase(database);
  return database.transaction(async tx => {
    const job = (
      await tx
        .select()
        .from(inventoryImportJobs)
        .where(
          and(
            eq(inventoryImportJobs.id, input.jobId),
            eq(inventoryImportJobs.enterpriseId, input.enterpriseId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!job) throw new Error("导入任务不存在");
    if (job.createdByUserId !== input.actorUserId) throw new Error("只有任务创建人可以提交该任务");
    if (job.status !== "staging") return { job: toPublicJob(job), idempotent: true } as const;

    const [countRow] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventoryImportStaging)
      .where(eq(inventoryImportStaging.jobId, input.jobId));
    const [rejectedCountRow] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventoryImportRejected)
      .where(eq(inventoryImportRejected.jobId, input.jobId));
    const rejectedCount = Number(rejectedCountRow?.count ?? 0);
    const count = Number(countRow?.count ?? 0) + rejectedCount;
    if (rejectedCount !== job.skippedRows) throw new Error("暂存错误行数量异常，请勿重复发布");
    if (count !== job.totalRows || job.stagedRows !== job.totalRows) {
      throw new Error(`暂存数据不完整：应有${job.totalRows}条，实际${count}条`);
    }

    await tx
      .update(inventoryImportJobs)
      .set({ status: "queued", errorMessage: null })
      .where(eq(inventoryImportJobs.id, input.jobId));
    const queued = { ...job, status: "queued" as const, errorMessage: null };
    return { job: toPublicJob(queued), idempotent: false } as const;
  });
}
