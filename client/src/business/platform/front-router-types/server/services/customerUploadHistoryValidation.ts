import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash } from "node:crypto";
import { customerUploadSourceRefSchema, type ConfirmationDto, type ConfirmationEntry, type SourceRef, type OriginalWorkbookManifest } from "../../../shared/customerUploadHistory";
import { createCustomerMaterialSchema } from "../../../shared/customerSupply";
import { ChannelInventoryError, channelInventoryPayloadHash, type ChannelInventoryScope, type SqlExecutor, type SqlResultRow } from "./channelInventory";

export type CustomerUploadFrozenEntry = ConfirmationEntry & { sourceRefs: SourceRef[]; createPayloadHash: string };
export type CustomerUploadFrozen = Omit<ConfirmationDto, "entries"> & { entries: CustomerUploadFrozenEntry[]; originalFileHash: string; eligibleComplete: boolean; batchCreatePayloadHash: string };
export type CustomerUploadRepairEntry = CustomerUploadFrozenEntry & { sourceRowKeys: string[] };
export type CustomerUploadRepairRecord = { schemaVersion: 1; historyId: string; confirmationId: string; originalFileHash: string; revision: number; batch: ConfirmationDto["batch"]; entries: CustomerUploadRepairEntry[] };
type Tuple = { history_id: string; enterprise_id: unknown; data_owner_user_id: unknown; customer_id: unknown; uploaded_by_user_id: unknown };
const rows = (r: unknown): SqlResultRow[] => Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) as SqlResultRow[] : [];
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const reject = (message: string): never => { throw new ChannelInventoryError("PRECONDITION_FAILED", message); };
/** Entire physical row is the identity. Cell ranges and altered hashes never make a new source row. */
export const customerUploadSourceRowKey = (r: SourceRef) => `${r.sheetIndex}:${r.rowNumber}`;
export const customerUploadIsSkippedProblem = (r: { reason: string }) => r.reason.startsWith("跳过问题行：") && r.reason.slice("跳过问题行：".length).trim().length > 0;
export function customerUploadSourceKeys(refs: SourceRef[] | undefined, manifest?: OriginalWorkbookManifest | null): string[] {
  const parsed = z.array(customerUploadSourceRefSchema).min(1).max(100).safeParse(refs);
  if (!parsed.success) return reject("原行来源不完整，不能补发或猜测来源");
  const keys: string[] = [];
  for (const ref of parsed.data) {
    const key = customerUploadSourceRowKey(ref);
    if (keys.includes(key)) reject("同一物理原行来源重复或存在歧义，不能补发");
    keys.push(key);
    if (manifest !== undefined) {
      const sheets = manifest?.sheets.filter(s => s.sheetIndex === ref.sheetIndex && s.sheetName === ref.sheetName);
      const originalRows = sheets?.length === 1 ? sheets[0].rows.filter(r => r.rowNumber === ref.rowNumber) : [];
      if (originalRows.length !== 1 || originalRows[0].originalRowHash !== ref.originalRowHash || createHash("sha256").update(originalRows[0].originalContent).digest("hex") !== ref.originalRowHash) reject("原行证据缺失或存在歧义，不能补发");
    }
  }
  return keys;
}
/** Called while the ORIGINAL history is locked. Requests are append-only; receipts remain separate. */
export async function readCustomerUploadRepairEntries(tx: SqlExecutor, h: Tuple, frozen: CustomerUploadFrozen): Promise<CustomerUploadRepairEntry[]> {
  const requests = rows(await tx.execute(sql`SELECT r.actor_user_id,r.result_data FROM customer_upload_requests r
    WHERE r.enterprise_id = ${Number(h.enterprise_id)} AND r.data_owner_user_id = ${Number(h.data_owner_user_id)}
      AND r.history_id = ${h.history_id} AND r.operation = 'repair_prepare' ORDER BY r.created_at,r.request_id FOR UPDATE`));
  if (requests.length > 1000) reject("补发映射超过安全上限");
  const entries: CustomerUploadRepairEntry[] = [];
  const logicalIds = new Set(frozen.entries.map(e => e.logicalRowId));
  const requestIds = new Set(frozen.entries.map(e => e.rowRequestId));
  const usedSource = new Set(frozen.entries.flatMap(e => e.sourceRefs.map(customerUploadSourceRowKey)));
  for (const request of requests) {
    const record = json<CustomerUploadRepairRecord>(request.result_data);
    if (!record || record.schemaVersion !== 1 || record.historyId !== h.history_id || record.confirmationId !== frozen.confirmationId || record.originalFileHash !== frozen.originalFileHash
      || Number(request.actor_user_id) !== Number(h.uploaded_by_user_id) || record.batch.id !== frozen.batch.id || record.batch.channelId !== frozen.batch.channelId
      || record.batch.customerId !== Number(h.customer_id) || record.batch.batchCode !== frozen.batch.batchCode || !Array.isArray(record.entries) || record.entries.length < 1) reject("原补发映射证据不完整，请保留原请求号核实");
    for (const entry of record.entries) {
      const excluded = frozen.excludedRows.filter(e => e.logicalRowId === entry.logicalRowId);
      const { channelId, ...payload } = entry.payload;
      const keys = customerUploadSourceKeys(entry.sourceRefs);
      if (excluded.length !== 1 || !customerUploadIsSkippedProblem(excluded[0]) || channelInventoryPayloadHash(entry.sourceRefs) !== channelInventoryPayloadHash(excluded[0].sourceRefs)
        || channelInventoryPayloadHash(keys) !== channelInventoryPayloadHash(entry.sourceRowKeys) || logicalIds.has(entry.logicalRowId) || requestIds.has(entry.rowRequestId)
        || keys.some(key => usedSource.has(key)) || entry.status !== "pending" || !/^[a-f0-9]{64}$/.test(entry.createPayloadHash)
        || !z.string().uuid().safeParse(entry.rowId).success || entry.uploadBatchId !== frozen.batch.id || entry.payload.uploadBatchId !== frozen.batch.id
        || entry.payload.requestId !== entry.rowRequestId || channelId !== frozen.batch.channelId || payload.customerId !== Number(h.customer_id)
        || payload.currency !== "CNY" || !createCustomerMaterialSchema.safeParse(payload).success) reject("补发行与原确认或正式字段不匹配，不能提交");
      logicalIds.add(entry.logicalRowId); requestIds.add(entry.rowRequestId); keys.forEach(key => usedSource.add(key)); entries.push(entry);
    }
  }
  if (entries.length + frozen.entries.length > 1000) reject("同批次累计确认行超过1000条上限");
  return entries;
}
/** A whole-history source fence: no excluded physical row may overlap ANY original canonical row. */
export function assertCustomerUploadRepairSources(frozen: CustomerUploadFrozen, repairs: CustomerUploadRepairEntry[], manifest: OriginalWorkbookManifest | null) {
  const canonicalKeys = new Set<string>();
  for (const entry of frozen.entries) {
    for (const key of customerUploadSourceKeys(entry.sourceRefs, manifest)) {
      if (canonicalKeys.has(key)) reject("原正式确认集合包含重复原行，不能安全补发");
      canonicalKeys.add(key);
    }
  }
  const excludedKeys = new Set<string>(); const excludedIds = new Set<string>();
  for (const excluded of frozen.excludedRows) {
    if (excludedIds.has(excluded.logicalRowId)) reject("原排除行标识存在歧义，不能安全补发");
    excludedIds.add(excluded.logicalRowId);
    for (const key of customerUploadSourceKeys(excluded.sourceRefs, manifest)) {
      if (canonicalKeys.has(key) || excludedKeys.has(key)) reject("排除来源与原正式确认或其他排除行重叠，不能补发");
      excludedKeys.add(key);
    }
  }
  for (const entry of repairs) customerUploadSourceKeys(entry.sourceRefs, manifest);
}
/** Must run before the batch lock and before ANY original row replay, including generic/native create.
 * A claimed request cannot evade the fence by omitting/changing uploadBatchId or customer context.
 * Unmapped rows cannot consume capacity newly reserved for repairs. No state implies terminal failure.
 */
export async function lockCustomerUploadFormalHistory(tx: SqlExecutor, scope: ChannelInventoryScope, input: { uploadBatchId?: number; requestId: string }) {
  const found = rows(await tx.execute(sql`SELECT h.*,cf.frozen_data FROM customer_upload_histories h
    INNER JOIN customer_upload_confirmations cf ON cf.history_id = h.history_id AND cf.enterprise_id = h.enterprise_id
      AND cf.data_owner_user_id = h.data_owner_user_id AND cf.customer_id = h.customer_id
    WHERE h.enterprise_id = ${scope.enterpriseId} AND h.data_owner_user_id = ${scope.dataOwnerUserId}
      AND (${input.uploadBatchId === undefined ? sql`FALSE` : sql`JSON_EXTRACT(cf.frozen_data,'$.batch.id') = ${input.uploadBatchId}`} OR EXISTS
        (SELECT 1 FROM customer_upload_requests claim WHERE claim.enterprise_id = h.enterprise_id AND claim.data_owner_user_id = h.data_owner_user_id
          AND claim.history_id = h.history_id AND claim.request_id = ${input.requestId} AND claim.operation IN ('row_claim','repair_row_claim')))
    LIMIT 2 FOR UPDATE`));
  if (!found.length) return null;
  if (found.length !== 1) reject("正式请求对应多个历史映射，不能提交");
  const h = found[0];
  if (Number(h.uploaded_by_user_id) !== scope.actorUserId || (scope.officialActor ? Number(h.uploaded_by_admin_account_id) !== scope.officialActor.adminAccountId : h.uploaded_by_admin_account_id != null)) throw new ChannelInventoryError("FORBIDDEN", "仅原上传身份可提交原正式映射");
  return h;
}
export async function lockCustomerUploadFormalCreate(tx: SqlExecutor, scope: ChannelInventoryScope, input: { uploadBatchId?: number; channelId: number; requestId: string }, payloadHash: string) {
  const h = await lockCustomerUploadFormalHistory(tx, scope, input);
  if (!h) return;
  const frozen = json<CustomerUploadFrozen>(h.frozen_data);
  const entries = [...frozen.entries, ...await readCustomerUploadRepairEntries(tx, h as Tuple, frozen)];
  const matching = entries.filter(e => e.rowRequestId === input.requestId);
  if (matching.length !== 1 || input.uploadBatchId !== frozen.batch.id || input.channelId !== frozen.batch.channelId || matching[0].createPayloadHash !== payloadHash) throw new ChannelInventoryError("CONFLICT", "正式批次只允许原确认或已持久化补发映射的原请求及原内容");
}
