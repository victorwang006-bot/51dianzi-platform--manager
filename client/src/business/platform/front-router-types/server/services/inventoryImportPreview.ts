import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { inventories, type Inventory } from "../../drizzle/schema";
import {
  inventoryImportPreviewRowSchema,
  type InventoryImportPreviewRow,
} from "../../../shared/inventoryImportPreview";
import { getDb } from "../db";
import {
  inventoryImportCanonicalJson,
  inventoryImportFingerprint,
  resolveImportGuardCandidate,
  type GuardableInventory,
} from "./inventoryImportVersionGuard";

const PREVIEW_REQUEST_BYTE_LIMIT = 900 * 1024;
const PREVIEW_ROW_BYTE_LIMIT = 8192;

export type InventoryImportPreviewScope = {
  enterpriseId: number;
  dataOwnerUserId: number;
  ownerUserId: number;
};

export type InventoryImportPreviewItem = {
  sourceRowNumber: number;
  action: "new" | "update" | "conflict";
  expectedFingerprint: string;
  reason?: string;
};

function normalizePartNumber(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}

function byteLength(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new Error("预览行数据无法序列化");
  }
}

function assertPositiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${field}无效`);
  }
}

/**
 * Preview has the same public request boundaries as stageBatch.  Do this in the
 * service as well as the route schema so direct callers cannot bypass the
 * source-row, field, or byte limits.
 */
export function validateInventoryImportPreviewRows(
  rows: readonly unknown[],
): InventoryImportPreviewRow[] {
  if (rows.length < 1 || rows.length > 500) {
    throw new Error("每批预览最多支持500条");
  }
  if (byteLength({ rows }) > PREVIEW_REQUEST_BYTE_LIMIT) {
    throw new Error("预览批次超过安全上限，请分批重试");
  }

  let previousRowNumber = 1;
  const parsedRows: InventoryImportPreviewRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("预览批次包含无效的 Excel 行对象");
    }
    if (byteLength(raw) > PREVIEW_ROW_BYTE_LIMIT) {
      throw new Error("单行原始数据超过安全上限，请检查列映射或附件内容");
    }
    const parsed = inventoryImportPreviewRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("预览行未通过库存字段校验，请检查 Excel 内容后重试");
    }
    const row = parsed.data;
    if (row.sourceRowNumber <= previousRowNumber) {
      throw new Error("预览批次包含无效或重复的 Excel 原始行号");
    }
    previousRowNumber = row.sourceRowNumber;
    parsedRows.push(row);
  }
  return parsedRows;
}

/**
 * Conflict tokens intentionally contain no candidate inventory fields.  They
 * are only an opaque shape token for the browser; stage never accepts a
 * conflict row as a V3 write candidate.
 */
export function inventoryImportPreviewConflictFingerprint(
  scope: InventoryImportPreviewScope,
  partNumberNormalized: string,
) {
  return createHash("sha256")
    .update(inventoryImportCanonicalJson({
      kind: "inventory-import-preview-conflict-v1",
      enterpriseId: scope.enterpriseId,
      dataOwnerUserId: scope.dataOwnerUserId,
      ownerUserId: scope.ownerUserId,
      partNumberNormalized,
    }))
    .digest("hex");
}

/**
 * Pure item builder exported for isolated tests.  It shares the exact V3
 * resolution rule with stage and the worker: all same-enterprise candidates
 * participate before owner/status selection.
 */
export function buildInventoryImportPreviewItems(
  input: {
    rows: readonly InventoryImportPreviewRow[];
    candidatesByPartNumber: ReadonlyMap<string, readonly GuardableInventory[]>;
    scope: InventoryImportPreviewScope;
  },
): InventoryImportPreviewItem[] {
  const { rows, candidatesByPartNumber, scope } = input;
  const seenParts = new Set<string>();
  return rows.map(row => {
    const partNumberNormalized = normalizePartNumber(row.partNumber);
    // The simplified browser normally catches this first.  Keep the server
    // fail-closed if a direct preview request contains the same model twice.
    if (seenParts.has(partNumberNormalized)) {
      return {
        sourceRowNumber: row.sourceRowNumber,
        action: "conflict",
        expectedFingerprint: inventoryImportPreviewConflictFingerprint(scope, partNumberNormalized),
        reason: "文件内型号重复，已保留到待发布",
      };
    }
    seenParts.add(partNumberNormalized);

    const resolution = resolveImportGuardCandidate(
      candidatesByPartNumber.get(partNumberNormalized) ?? [],
      {
        enterpriseId: scope.enterpriseId,
        userId: scope.dataOwnerUserId,
        ownerUserId: scope.ownerUserId,
        partNumberNormalized,
      },
    );
    if (resolution.action === "new") {
      return {
        sourceRowNumber: row.sourceRowNumber,
        action: "new",
        expectedFingerprint: "new",
      };
    }
    if (resolution.action === "update") {
      return {
        sourceRowNumber: row.sourceRowNumber,
        action: "update",
        expectedFingerprint: inventoryImportFingerprint(resolution.inventory),
      };
    }
    return {
      sourceRowNumber: row.sourceRowNumber,
      action: "conflict",
      expectedFingerprint: inventoryImportPreviewConflictFingerprint(scope, partNumberNormalized),
      reason: "当前库存匹配冲突，已保留到待发布",
    };
  });
}

/**
 * Read-only preview: it creates no job, staging, guard, or inventory records.
 * The later stage lock revalidates the returned fingerprint before writing.
 */
export async function previewInventoryImportRows(input: {
  rows: readonly unknown[];
} & InventoryImportPreviewScope) {
  assertPositiveInteger(input.enterpriseId, "企业上下文");
  assertPositiveInteger(input.dataOwnerUserId, "数据归属");
  assertPositiveInteger(input.ownerUserId, "库存负责人");
  const rows = validateInventoryImportPreviewRows(input.rows);
  const keys = Array.from(new Set(rows.map(row => normalizePartNumber(row.partNumber))));
  const database = await getDb();
  if (!database) throw new Error("数据库不可用");

  const candidates: Inventory[] = keys.length === 0
    ? []
    : await database
      .select()
      .from(inventories)
      .where(and(
        eq(inventories.enterpriseId, input.enterpriseId),
        inArray(inventories.partNumberNormalized, keys),
      ));
  const candidatesByPart = new Map<string, Inventory[]>();
  for (const candidate of candidates) {
    const key = String(candidate.partNumberNormalized ?? "");
    const matching = candidatesByPart.get(key) ?? [];
    matching.push(candidate);
    candidatesByPart.set(key, matching);
  }

  return {
    items: buildInventoryImportPreviewItems({
      rows,
      candidatesByPartNumber: candidatesByPart,
      scope: input,
    }),
  };
}
