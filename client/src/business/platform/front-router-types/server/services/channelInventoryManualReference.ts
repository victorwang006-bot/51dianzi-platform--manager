import { sql, type SQL } from "drizzle-orm";
import { ChannelInventoryError, type ChannelInventoryScope, type SqlExecutor, type SqlResultRow } from "./channelInventory";

export type ChannelInventoryManualReferenceValues = {
  manualReferenceLcsc: string | null;
  manualReferenceIckey: string | null;
};
export type ChannelInventoryManualReferencePatch = Partial<ChannelInventoryManualReferenceValues>;

/** Strict string projection: never convert a decimal through a JS number.
 * Missing rows/old audit receipts expose explicit null, not automatic prices.
 */
export function channelInventoryManualReferenceValuesFrom(row: SqlResultRow): ChannelInventoryManualReferenceValues {
  const value = (raw: unknown): string | null => {
    if (raw == null) return null;
    if (typeof raw !== "string" || raw.length > 32 || !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(raw)) {
      throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "手填渠道参考价格式无效");
    }
    return raw;
  };
  return { manualReferenceLcsc: value(row.manualReferenceLcsc), manualReferenceIckey: value(row.manualReferenceIckey) };
}

/** Internal enrichment ONLY after the caller's live material visibility/permission
 * check. IDs must be the actual authorized result IDs, never a browser shortlist.
 * Scope+exact IDs remain bound even when another employee can read the prices.
 * Locking reads avoid stale RR snapshots during CAS/audit; no cache/helper/DDL.
 */
export async function readChannelInventoryManualReferences(
  tx: SqlExecutor, scope: ChannelInventoryScope, visibleMaterialIds: number[],
): Promise<Map<number, ChannelInventoryManualReferenceValues>> {
  const ids = Array.from(new Set(visibleMaterialIds));
  const result = new Map<number, ChannelInventoryManualReferenceValues>();
  if (!ids.length) return result;
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "已授权库存标识无效");
  }
  for (const id of ids) result.set(id, { manualReferenceLcsc: null, manualReferenceIckey: null });
  const raw = await tx.execute(sql`SELECT materialId, manualReferenceLcsc, manualReferenceIckey
    FROM channel_inventory_manual_references
    WHERE enterpriseId = ${scope.enterpriseId} AND dataOwnerUserId = ${scope.dataOwnerUserId}
      AND materialId IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) FOR UPDATE`);
  const found: SqlResultRow[] = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) as SqlResultRow[]
    : raw && typeof raw === "object" && "rows" in raw && Array.isArray(raw.rows) ? raw.rows as SqlResultRow[] : [];
  for (const row of found) {
    const id = Number(row.materialId);
    if (result.has(id)) result.set(id, channelInventoryManualReferenceValuesFrom(row));
  }
  return result;
}

/** Called only inside the original authorized material CAS transaction, AFTER
 * the main stock revision succeeds. Omitted fields never enter duplicate-key
 * assignments; null explicitly clears. Actor metadata is server-derived only.
 */
export async function upsertChannelInventoryManualReferences(
  tx: SqlExecutor, scope: ChannelInventoryScope, materialId: number, patch: ChannelInventoryManualReferencePatch,
): Promise<void> {
  const assignments: SQL[] = [];
  if (patch.manualReferenceLcsc !== undefined) assignments.push(sql`manualReferenceLcsc = VALUES(manualReferenceLcsc)`);
  if (patch.manualReferenceIckey !== undefined) assignments.push(sql`manualReferenceIckey = VALUES(manualReferenceIckey)`);
  if (!assignments.length) return;
  // Validate again for internal callers; no widening of the public update schema.
  const values = channelInventoryManualReferenceValuesFrom(patch);
  assignments.push(sql`updatedByUserId = VALUES(updatedByUserId)`, sql`updatedByAdminAccountId = VALUES(updatedByAdminAccountId)`, sql`updatedAt = CURRENT_TIMESTAMP(3)`);
  await tx.execute(sql`INSERT INTO channel_inventory_manual_references
    (enterpriseId, dataOwnerUserId, materialId, manualReferenceLcsc, manualReferenceIckey,
      updatedByUserId, updatedByAdminAccountId, updatedAt)
    VALUES (${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${materialId}, ${values.manualReferenceLcsc}, ${values.manualReferenceIckey},
      ${scope.actorUserId}, ${scope.officialActor?.adminAccountId ?? null}, CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE ${sql.join(assignments, sql`, `)}`);
}
