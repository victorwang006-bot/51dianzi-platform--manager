import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import * as schemas from "../../../shared/customerUploadHistory";
import type { FileInput, OriginalWorkbookManifest, HistoryDto, FileDto, VersionDto, ConfirmationDto, ConfirmationEntry, ResultRow, SourceRef, VerifiedRowReceipt, CustomerUploadHistoryOutputs, CustomerUploadHistoryMethod } from "../../../shared/customerUploadHistory";
import { createCustomerMaterialSchema } from "../../../shared/customerSupply";
import { ChannelInventoryError, channelInventoryPayloadHash, type ChannelInventoryScope, type ChannelInventoryServiceDependencies, type SqlDatabase, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { createCustomerSupplyService } from "./customerSupply";
import { customerSupplyCompletion } from "./customerSupplyCompany";
import { historyActorIsSelf, resolveCustomerUploadHistoryPolicy, type CustomerUploadHistoryPolicy, type CustomerUploadHistoryPolicyDependencies } from "./customerUploadHistoryPolicy";
import { inspectCustomerUploadFile } from "./customerUploadPrivateStorage";
/** Storage is injected. No generic storagePut/storageProxy/public URL capability. */
export type PrivateStoredFile = { locator: string; fileName: string; mimeType: string; byteSize: number; sha256: string; manifest: OriginalWorkbookManifest | null };
export type CustomerUploadPrivateStorage = { put(file: FileInput): Promise<PrivateStoredFile>; read(locator: string): Promise<Buffer> };
export type CustomerUploadHistoryDependencies = ChannelInventoryServiceDependencies & {
  storage: CustomerUploadPrivateStorage;
  policyDependencies?: CustomerUploadHistoryPolicyDependencies;
  /** Test/native bridge only; factory must join the supplied TRUE outer transaction adapter. */
  supplyFactory?: typeof createCustomerSupplyService;
};
type HistoryRow = SqlResultRow & { history_id: string; enterprise_id: number; data_owner_user_id: number; customer_id: number; uploaded_by_user_id: number; uploaded_by_admin_account_id: number | null; original_file_id: string; latest_version_id: string | null; latest_version_no: number; revision: number; mode: "standard" | "parse"; state: schemas.HistoryState; customer_name: string; created_at: Date | string; leader_access?: unknown };
type FileRow = SqlResultRow & { file_id: string; kind: FileDto["kind"]; locator: string; file_name: string; mime_type: string; byte_size: number; sha256: string; original_manifest: unknown; created_at: Date | string };
type Frozen = Omit<ConfirmationDto, "entries"> & { entries: (ConfirmationEntry & { createPayloadHash: string; sourceRefs: SourceRef[] })[]; originalFileHash: string; eligibleComplete: boolean; batchCreatePayloadHash: string };
type PersistedConfirmation = { frozen: Frozen; entries: ConfirmationEntry[]; remaining: number | null };
const rows = <T extends SqlResultRow = SqlResultRow>(r: unknown): T[] => {
  if (!Array.isArray(r)) throw new Error("SQL_RESULT_SHAPE");
  return (Array.isArray(r[0]) ? r[0] : r) as T[];
};
const fail = (code: ConstructorParameters<typeof ChannelInventoryError>[0], message: string): never => { throw new ChannelInventoryError(code, message); };
const hidden = (): never => fail("NOT_FOUND", "记录不存在或无权访问");
const conflict = (): never => fail("CONFLICT", "记录已变化，请刷新后重试");
const iso = (v: Date | string) => { const d = new Date(v); if (Number.isNaN(d.valueOf())) throw new Error("INVALID_TIMESTAMP"); return d.toISOString(); };
const json = <T>(v: unknown): T => { if (v == null) throw new Error("MISSING_JSON"); return (typeof v === "string" ? JSON.parse(v) : v) as T; };
const hash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const changed = (r: unknown) => { const h = (Array.isArray(r) ? r[0] : r) as SqlResultRow; return Number(h?.affectedRows) === 1; };
const exactTuple = (h: HistoryRow, alias: string): SQL => { const t = sql.raw(alias); return sql`${t}.enterprise_id = ${Number(h.enterprise_id)} AND ${t}.data_owner_user_id = ${Number(h.data_owner_user_id)} AND ${t}.customer_id = ${Number(h.customer_id)} AND ${t}.history_id = ${h.history_id}`; };
const safeFileName = (name: string) => name.normalize("NFKC").replace(/[\x00-\x1f\x7f/\\]/g, "_").replace(/^\.+/, "_").slice(0, 200) || "file.csv";
export const customerUploadCsvCell = (value: unknown) => { const v = String(value ?? ""); const safe = /^[\s]*[=+\-@\t\r]/.test(v) ? `'${v}` : v; return `"${safe.replace(/"/g, '""')}"`; };
export function assertCustomerUploadSourceRefs(manifest: OriginalWorkbookManifest | null, refs: SourceRef[]) {
  if (!manifest || refs.length === 0) fail("PRECONDITION_FAILED", "原表行证据不可用，请补充可验证原表，不能猜测来源");
  for (const ref of refs) {
    const sheet = manifest!.sheets.find(s => s.sheetIndex === ref.sheetIndex && s.sheetName === ref.sheetName);
    const row = sheet?.rows.find(r => r.rowNumber === ref.rowNumber);
    if (!row || row.originalRowHash !== ref.originalRowHash || hash(row.originalContent) !== row.originalRowHash) fail("BAD_REQUEST", "原工作表或原行证据不匹配");
    if (ref.cellRange) {
      const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref.cellRange)!;
      const col = (s: string) => Array.from(s).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      if (Number(match[2]) !== ref.rowNumber || Number(match[4] ?? match[2]) !== ref.rowNumber || col(match[1]) > col(match[3] ?? match[1]) || col(match[3] ?? match[1]) > row!.cells.length) fail("BAD_REQUEST", "单元格范围不属于原行");
    }
  }
}
export function customerUploadFormalCreateHash(payload: ConfirmationEntry["payload"], sourceType: "factory" | "agent" | "trade" | "other") {
  const { channelId, partNumber, brand, qty, dateCode, price, currency, taxIncluded, leadTime, note, uploadBatchId, customerId, expectedCustomerVersion } = payload;
  return channelInventoryPayloadHash({ channelId, partNumber, brand, qty, dateCode, price, currency, taxIncluded, leadTime, note, ...(uploadBatchId === undefined ? {} : { uploadBatchId }), customerSupply: { customerId, expectedCustomerVersion, sourceType } });
}
export function assertCustomerUploadRows(rowsData: ResultRow[], issues: schemas.Issue[], manifest: OriginalWorkbookManifest | null) {
  const ids = new Set<string>(); const logicalIds = new Set<string>(); const issueIds = new Set<string>();
  for (const row of rowsData) {
    if (ids.has(row.rowId) || logicalIds.has(row.logicalRowId)) fail("BAD_REQUEST", "候选行标识重复");
    ids.add(row.rowId); logicalIds.add(row.logicalRowId); assertCustomerUploadSourceRefs(manifest, row.sourceRefs);
  }
  for (const issue of [...issues, ...rowsData.flatMap(r => r.issues)]) {
    if (issueIds.has(issue.issueId) || (issue.rowId !== null && !ids.has(issue.rowId))) fail("BAD_REQUEST", "问题归属或标识无效");
    issueIds.add(issue.issueId);
  }
}
export function createCustomerUploadHistoryService(deps: CustomerUploadHistoryDependencies) {
  async function transaction<T>(scope: ChannelInventoryScope, write: boolean, fn: (tx: SqlExecutor, policy: CustomerUploadHistoryPolicy) => Promise<T>): Promise<T> {
    try {
      const db = await deps.getDb(); if (!db) return fail("SERVICE_UNAVAILABLE", "客户文件历史结构尚未就绪");
      return await db.transaction(async tx => fn(tx, await resolveCustomerUploadHistoryPolicy(tx, scope, write, deps.policyDependencies)));
    } catch (error) {
      if (error instanceof ChannelInventoryError || error instanceof TRPCError) throw error;
      return fail("SERVICE_UNAVAILABLE", "文件历史操作未确认成功，请保留原请求号刷新重试");
    }
  }
  function parse<S extends z.ZodType>(schema: S, scope: ChannelInventoryScope, raw: unknown): z.output<S> {
    const result = schema.safeParse(raw); if (!result.success) return fail("BAD_REQUEST", result.error.issues[0]?.message ?? "字段无效");
    const expected = result.data as { expectedEnterpriseId: number; expectedActorUserId: number };
    if (expected.expectedEnterpriseId !== scope.enterpriseId || expected.expectedActorUserId !== scope.actorUserId) fail("FORBIDDEN", "企业或账号上下文不匹配");
    return result.data;
  }
  async function history(tx: SqlExecutor, policy: CustomerUploadHistoryPolicy, historyId: string): Promise<HistoryRow> {
    const row = rows<HistoryRow>(await tx.execute(sql`SELECT h.*, c.name AS customer_name, ${policy.leaderWhere()} AS leader_access
      FROM customer_upload_histories h INNER JOIN crm_customers c ON c.enterpriseId = h.enterprise_id AND c.id = h.customer_id
      WHERE h.history_id = ${historyId} AND ${policy.where()} LIMIT 1 FOR UPDATE`))[0];
    return row ?? hidden();
  }
  async function file(tx: SqlExecutor, h: HistoryRow, fileId: string): Promise<FileRow> {
    const f = rows<FileRow>(await tx.execute(sql`SELECT f.* FROM customer_upload_files f WHERE f.file_id = ${fileId} AND ${exactTuple(h, "f")} LIMIT 1 FOR UPDATE`))[0];
    return f ?? hidden();
  }
  const fileDto = (f: FileRow): FileDto => ({ fileId: f.file_id, kind: f.kind, fileName: safeFileName(f.file_name), mimeType: f.mime_type, byteSize: Number(f.byte_size), sha256: f.sha256, createdAt: iso(f.created_at) });
  async function version(tx: SqlExecutor, h: HistoryRow, versionId: string): Promise<VersionDto> {
    const v = rows(await tx.execute(sql`SELECT v.* FROM customer_upload_versions v WHERE v.version_id = ${versionId} AND ${exactTuple(h, "v")} LIMIT 1 FOR UPDATE`))[0];
    if (!v) return hidden();
    return { versionId: String(v.version_id), versionNo: Number(v.version_no), parentVersionId: v.parent_version_id == null ? null : String(v.parent_version_id), createdAt: iso(v.created_at as Date | string),
      normalizedFile: fileDto(await file(tx, h, String(v.normalized_file_id))), issuesFile: v.issues_file_id == null ? null : fileDto(await file(tx, h, String(v.issues_file_id))), rows: json<ResultRow[]>(v.rows_data), issues: json<schemas.Issue[]>(v.issues_data) };
  }
  async function confirmation(tx: SqlExecutor, h: HistoryRow): Promise<PersistedConfirmation | null> {
    const c = rows(await tx.execute(sql`SELECT cf.* FROM customer_upload_confirmations cf WHERE ${exactTuple(h, "cf")} LIMIT 1 FOR UPDATE`))[0];
    if (!c) return null;
    const frozen = json<Frozen>(c.frozen_data); const stored = json<Pick<ConfirmationEntry, "logicalRowId" | "status" | "receipt">[]>(c.receipts_data);
    if (frozen.confirmationId !== String(c.confirmation_id) || frozen.batchRequestId !== String(c.batch_request_id) || frozen.entries.length < 1) throw new Error("CONFIRMATION_SHAPE");
    const entries = frozen.entries.map(({ createPayloadHash: _hash, ...entry }) => { const status = stored.find(r => r.logicalRowId === entry.logicalRowId); return { ...entry, status: status?.status ?? "pending", ...(status?.receipt ? { receipt: status.receipt } : {}) }; });
    return { frozen, entries, remaining: c.remaining_material_count == null ? null : Number(c.remaining_material_count) };
  }
  function confirmationDto(c: PersistedConfirmation): ConfirmationDto {
    const { confirmationId, versionId, batchRequestId, batch, excludedRows, resolvedIssues, sourceCoverage, createdAt } = c.frozen;
    return { confirmationId, versionId, batchRequestId, batch, entries: c.entries, excludedRows, resolvedIssues, sourceCoverage, createdAt };
  }
  async function dto(tx: SqlExecutor, policy: CustomerUploadHistoryPolicy, scope: ChannelInventoryScope, h: HistoryRow): Promise<HistoryDto> {
    const original = await file(tx, h, h.original_file_id);
    const manifest = original.original_manifest == null ? null : json<OriginalWorkbookManifest>(original.original_manifest);
    const v = h.latest_version_id ? await version(tx, h, h.latest_version_id) : null;
    const cf = await confirmation(tx, h); const access = policy.access(h); const self = historyActorIsSelf(scope, h);
    const successCount = cf?.entries.filter(e => e.status === "success").length ?? 0;
    const frozen = cf != null; const actionable = !frozen && !["cancelled", "imported", "partially_imported"].includes(h.state);
    return { historyId: h.history_id, customerId: Number(h.customer_id), customerName: h.customer_name, mode: h.mode, state: h.state, revision: Number(h.revision), uploadedBy: { adminAccountId: h.uploaded_by_admin_account_id == null ? null : Number(h.uploaded_by_admin_account_id), frontUserId: Number(h.uploaded_by_user_id), displayName: `用户 ${Number(h.uploaded_by_user_id)}` },
      createdAt: iso(h.created_at), originalFile: fileDto(original), latestVersionId: h.latest_version_id, latestVersionNo: Number(h.latest_version_no), access,
      stats: { sourceRowCount: manifest ? manifest.sheets.reduce((n, s) => n + s.rows.length, 0) : null, resultRowCount: v?.rows.length ?? 0,
        pendingCount: cf ? cf.entries.filter(e => e.status === "pending").length : v?.rows.filter(r => r.disposition === "pending" || r.issues.some(i => !i.resolved)).length ?? 0,
        excludedCount: cf?.frozen.excludedRows.length ?? v?.rows.filter(r => r.disposition === "excluded").length ?? 0, successCount, unknownCount: cf?.entries.filter(e => e.status === "unknown").length ?? 0, failedCount: 0, remainingMaterialCount: cf?.remaining ?? null, unprocessedSourceRowCount: cf?.frozen.sourceCoverage?.unprocessedSourceRefs.length ?? 0 },
      ...(cf?.frozen.sourceCoverage?.warning ? { sourceCoverageWarning: cf.frozen.sourceCoverage.warning } : {}),
      capabilities: { canDownload: true, canManage: policy.canManage, canUploadResult: policy.canManage && policy.crm.write && policy.channels.write && policy.stocks.write && actionable, canConfirm: self && policy.crm.write && policy.channels.write && policy.stocks.write && (actionable && h.state === "awaiting_confirmation" || frozen), canCancel: !frozen && successCount === 0 && (self || policy.canManage) && policy.crm.write && policy.channels.write && policy.stocks.write && h.state !== "cancelled" } };
  }
  async function appendFile(tx: SqlExecutor, h: HistoryRow, kind: FileDto["kind"], input: FileInput, fileId = randomUUID()): Promise<FileRow> {
    const decoded = Buffer.from(input.base64, "base64");
    if (decoded.toString("base64") !== input.base64 || decoded.length < 1 || decoded.length > schemas.CUSTOMER_UPLOAD_FILE_BYTES_MAX) fail("BAD_REQUEST", "文件编码或大小无效");
    try { inspectCustomerUploadFile(input); } catch { fail("BAD_REQUEST", "文件格式、工作簿结构或资源限制校验未通过，请使用无宏、无外部链接且未加密的有效表格"); }
    const stored = await deps.storage.put(input);
    if (stored.byteSize !== decoded.length || stored.sha256 !== hash(decoded)) throw new Error("STORAGE_INTEGRITY");
    if (stored.manifest && Buffer.byteLength(JSON.stringify(stored.manifest), "utf8") > 8 * 1024 * 1024) fail("BAD_REQUEST", "原表行证据超过8MiB安全上限");
    await tx.execute(sql`INSERT INTO customer_upload_files (file_id,enterprise_id,data_owner_user_id,customer_id,history_id,kind,locator,file_name,mime_type,byte_size,sha256,original_manifest)
      VALUES (${fileId},${Number(h.enterprise_id)},${Number(h.data_owner_user_id)},${Number(h.customer_id)},${h.history_id},${kind},${stored.locator},${stored.fileName},${stored.mimeType},${stored.byteSize},${stored.sha256},${stored.manifest == null ? null : JSON.stringify(stored.manifest)})`);
    return file(tx, h, fileId);
  }
  async function advance(tx: SqlExecutor, h: HistoryRow, state: schemas.HistoryState, latestVersionId = h.latest_version_id, latestVersionNo = Number(h.latest_version_no), reason: string | null = null) {
    if (!changed(await tx.execute(sql`UPDATE customer_upload_histories SET state = ${state},revision = revision + 1,latest_version_id = ${latestVersionId},latest_version_no = ${latestVersionNo},last_reason = ${reason},updated_at = CURRENT_TIMESTAMP(3)
      WHERE history_id = ${h.history_id} AND enterprise_id = ${Number(h.enterprise_id)} AND data_owner_user_id = ${Number(h.data_owner_user_id)} AND customer_id = ${Number(h.customer_id)} AND revision = ${Number(h.revision)}`))) conflict();
  }
  async function prior(tx: SqlExecutor, scope: ChannelInventoryScope, input: { requestId: string }, operation: string, payloadHash: string) {
    const p = rows(await tx.execute(sql`SELECT operation,history_id,payload_hash,result_data,data_owner_user_id FROM customer_upload_requests WHERE enterprise_id = ${scope.enterpriseId} AND actor_user_id = ${scope.actorUserId} AND request_id = ${input.requestId} LIMIT 1 FOR UPDATE`))[0];
    if (p && (p.operation !== operation || p.payload_hash !== payloadHash || Number(p.data_owner_user_id) !== scope.dataOwnerUserId)) fail("CONFLICT", "请求号已用于不同内容或归属");
    return p;
  }
  async function saveRequest(tx: SqlExecutor, scope: ChannelInventoryScope, requestId: string, operation: string, historyId: string, payloadHash: string, result: unknown) {
    await tx.execute(sql`INSERT INTO customer_upload_requests (enterprise_id,data_owner_user_id,actor_user_id,request_id,operation,history_id,payload_hash,result_data)
      VALUES (${scope.enterpriseId},${scope.dataOwnerUserId},${scope.actorUserId},${requestId},${operation},${historyId},${payloadHash},${JSON.stringify(result)})`);
  }
  async function mutation<K extends CustomerUploadHistoryMethod>(scope: ChannelInventoryScope, input: { requestId: string; historyId?: string }, operation: K,
    run: (tx: SqlExecutor, policy: CustomerUploadHistoryPolicy) => Promise<CustomerUploadHistoryOutputs[K]>, replayFence?: (tx: SqlExecutor, policy: CustomerUploadHistoryPolicy, h: HistoryRow, output: CustomerUploadHistoryOutputs[K]) => Promise<void>): Promise<CustomerUploadHistoryOutputs[K]> {
    const payloadHash = channelInventoryPayloadHash({ operation, input, officialAdminId: scope.officialActor?.adminAccountId ?? null });
    return transaction(scope, true, async (tx, policy) => {
      const p = await prior(tx, scope, input, operation, payloadHash);
      if (p) {
        const h = await history(tx, policy, String(p.history_id));
        if (input.historyId && input.historyId !== h.history_id) conflict();
        const output = json<CustomerUploadHistoryOutputs[K]>(p.result_data);
        if (replayFence) await replayFence(tx, policy, h, output);
        if (operation === "channelInventory.customerUploadPrepareConfirmation") {
          const cf = await confirmation(tx, h); if (!cf) return hidden();
          const prepared = output as CustomerUploadHistoryOutputs["channelInventory.customerUploadPrepareConfirmation"];
          if (prepared.confirmationId !== cf.frozen.confirmationId) return hidden();
          prepared.entries = cf.entries; prepared.revision = Number(h.revision);
        }
        if (operation === "channelInventory.customerUploadReconcileBatch") {
          const cf = await confirmation(tx, h); if (!cf) return hidden();
          const reconciled = output as CustomerUploadHistoryOutputs["channelInventory.customerUploadReconcileBatch"];
          reconciled.entries = cf.entries.map(e => ({ logicalRowId: e.logicalRowId, rowRequestId: e.rowRequestId, status: e.status, ...(e.receipt ? { receipt: e.receipt } : {}) }));
        }
        if ("history" in output) output.history = await dto(tx, policy, scope, h);
        if ("idempotent" in output) output.idempotent = true;
        return output;
      }
      const output = await run(tx, policy);
      const historyId = "history" in output ? output.history.historyId : "historyId" in output ? output.historyId : input.historyId;
      if (!historyId) throw new Error("MUTATION_HISTORY_REQUIRED");
      await saveRequest(tx, scope, input.requestId, operation, historyId, payloadHash, output);
      return output;
    });
  }
  async function forbidConfirmation(tx: SqlExecutor, h: HistoryRow) { if (await confirmation(tx, h)) fail("CONFLICT", "已有正式确认批次，请先完成原批次；不能重新解析、换版本或取消"); }
  function cas(h: HistoryRow, expectedRevision: number) { if (Number(h.revision) !== expectedRevision) conflict(); }
  const manifestOf = (f: FileRow) => f.original_manifest == null ? null : json<OriginalWorkbookManifest>(f.original_manifest);
  return {
    async customerUploadHistoryList(scope: ChannelInventoryScope, raw: schemas.CustomerUploadHistoryListInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadHistoryList"]> {
      const input = parse(schemas.customerUploadHistoryListSchema, scope, raw);
      return transaction(scope, false, async (tx, policy) => {
        if (input.view === "management" && !policy.canManage) fail("FORBIDDEN", "当前账号无解析管理权限");
        let cursor: { createdAt: string; historyId: string } | null = null;
        if (input.cursor) { try { cursor = z.object({ createdAt: z.string().datetime(), historyId: z.string().uuid() }).strict().parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))); } catch { fail("BAD_REQUEST", "分页游标无效"); } }
        const filters: SQL[] = [policy.where("h", input.view === "management")];
        if (input.view === "mine") filters.push(policy.selfWhere());
        if (input.customerId) filters.push(sql`h.customer_id = ${input.customerId}`);
        if (input.uploadedByFrontUserId) filters.push(sql`h.uploaded_by_user_id = ${input.uploadedByFrontUserId}`);
        if (input.mode) filters.push(sql`h.mode = ${input.mode}`);
        if (input.states) filters.push(sql`h.state IN (${sql.join(input.states.map(s => sql`${s}`), sql`,`)})`);
        if (input.dateFrom) filters.push(sql`h.created_at >= ${new Date(`${input.dateFrom}T00:00:00+08:00`)}`);
        if (input.dateTo) filters.push(sql`h.created_at < ${new Date(new Date(`${input.dateTo}T00:00:00+08:00`).valueOf() + 86400000)}`);
        if (cursor) filters.push(sql`(h.created_at < ${new Date(cursor.createdAt)} OR (h.created_at = ${new Date(cursor.createdAt)} AND h.history_id < ${cursor.historyId}))`);
        const found = rows<HistoryRow>(await tx.execute(sql`SELECT h.*,c.name AS customer_name,${policy.leaderWhere()} AS leader_access FROM customer_upload_histories h
          INNER JOIN crm_customers c ON c.enterpriseId = h.enterprise_id AND c.id = h.customer_id WHERE ${sql.join(filters, sql` AND `)} ORDER BY h.created_at DESC,h.history_id DESC LIMIT ${input.pageSize + 1} FOR UPDATE`));
        const page = found.slice(0, input.pageSize); const last = page.at(-1);
        const items: HistoryDto[] = []; for (const h of page) items.push(await dto(tx, policy, scope, h));
        return { items, nextCursor: found.length > input.pageSize && last ? Buffer.from(JSON.stringify({ createdAt: iso(last.created_at), historyId: last.history_id })).toString("base64url") : null, canManage: policy.canManage };
      });
    },
    async customerUploadHistoryGet(scope: ChannelInventoryScope, raw: schemas.CustomerUploadHistoryGetInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadHistoryGet"]> {
      const input = parse(schemas.customerUploadHistoryGetSchema, scope, raw);
      return transaction(scope, false, async (tx, policy) => {
        const h = await history(tx, policy, input.historyId); const f = await file(tx, h, h.original_file_id);
        const list = rows(await tx.execute(sql`SELECT v.version_id FROM customer_upload_versions v WHERE ${exactTuple(h, "v")} ORDER BY v.version_no DESC LIMIT 1001 FOR UPDATE`));
        if (list.length > 1000) fail("PRECONDITION_FAILED", "历史版本超过安全读取上限");
        const versions: schemas.VersionSummary[] = [];
        for (const item of list) { const { rows: _rows, issues: _issues, ...summary } = await version(tx, h, String(item.version_id)); versions.push(summary); }
        const cf = await confirmation(tx, h);
        return { history: await dto(tx, policy, scope, h), versions, selectedVersion: input.versionId ? await version(tx, h, input.versionId) : h.latest_version_id ? await version(tx, h, h.latest_version_id) : null, confirmation: cf ? confirmationDto(cf) : null, originalSheets: manifestOf(f)?.sheets ?? [] };
      });
    },
    async customerUploadOriginal(scope: ChannelInventoryScope, raw: schemas.CustomerUploadOriginalInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadOriginal"]> {
      const input = parse(schemas.customerUploadOriginalSchema, scope, raw);
      return mutation(scope, input, "channelInventory.customerUploadOriginal", async (tx, policy) => {
        const c = rows(await tx.execute(sql`SELECT c.id,c.name,c.version,c.industryCode,c.archivedAt FROM crm_customers c WHERE c.id = ${input.customerId} AND ${policy.customerWhere()} LIMIT 1 FOR UPDATE`))[0];
        if (!c) return hidden();
        if (input.expectedCustomerVersion !== undefined && Number(c.version) !== input.expectedCustomerVersion) conflict();
        const reason = customerSupplyCompletion(c); if (reason) fail("PRECONDITION_FAILED", reason);
        const historyId = randomUUID(); const originalFileId = randomUUID();
        await tx.execute(sql`INSERT INTO customer_upload_histories (history_id,enterprise_id,data_owner_user_id,customer_id,mode,state,revision,uploaded_by_user_id,uploaded_by_admin_account_id,original_file_id,latest_version_no)
          VALUES (${historyId},${scope.enterpriseId},${scope.dataOwnerUserId},${input.customerId},${input.mode},${input.mode === "parse" ? "pending_parse" : "awaiting_confirmation"},1,${scope.actorUserId},${scope.officialActor?.adminAccountId ?? null},${originalFileId},0)`);
        const h = await history(tx, policy, historyId); const saved = await appendFile(tx, h, "original", input.file, originalFileId);
        if (input.standardSourceRefs?.length) assertCustomerUploadSourceRefs(manifestOf(saved), input.standardSourceRefs);
        const current = await history(tx, policy, historyId);
        return { history: await dto(tx, policy, scope, current), idempotent: false, duplicateWarning: false, submissionMessage: input.mode === "parse" ? "已提交，等待解析" : "原文件已保存，请核对并上传" };
      });
    },
    async customerUploadManageMark(scope: ChannelInventoryScope, raw: schemas.CustomerUploadManageMarkInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadManageMark"]> {
      const input = parse(schemas.customerUploadManageMarkSchema, scope, raw);
      return mutation(scope, input, "channelInventory.customerUploadManageMark", async (tx, policy) => {
        const h = await history(tx, policy, input.historyId); cas(h, input.expectedRevision); await forbidConfirmation(tx, h);
        if (!(policy.canManage || input.action === "cancel" && historyActorIsSelf(scope, h))) fail("FORBIDDEN", "当前账号无此解析管理权限");
        const transitions: Record<typeof input.action, { from: schemas.HistoryState[]; to: schemas.HistoryState }> = {
          start_parsing: { from: ["pending_parse", "parse_failed", "awaiting_confirmation"], to: "parsing" }, return_for_supplement: { from: ["parsing"], to: "awaiting_confirmation" },
          fail_parse: { from: ["pending_parse", "parsing"], to: "parse_failed" }, cancel: { from: ["pending_parse", "parsing", "awaiting_confirmation", "parse_failed"], to: "cancelled" },
        };
        const transition = transitions[input.action]; if (!transition.from.includes(h.state)) fail("CONFLICT", "当前状态不允许此操作");
        await advance(tx, h, transition.to, h.latest_version_id, Number(h.latest_version_no), input.reason);
        return { history: await dto(tx, policy, scope, await history(tx, policy, h.history_id)), idempotent: false };
      });
    },
    async customerUploadResult(scope: ChannelInventoryScope, raw: schemas.CustomerUploadResultInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadResult"]> {
      const input = parse(schemas.customerUploadResultSchema, scope, raw);
      return mutation(scope, input, "channelInventory.customerUploadResult", async (tx, policy) => {
        if (!policy.canManage) fail("FORBIDDEN", "当前账号无解析结果管理权限");
        const h = await history(tx, policy, input.historyId); cas(h, input.expectedRevision); await forbidConfirmation(tx, h);
        if (!["pending_parse", "parsing", "awaiting_confirmation", "parse_failed"].includes(h.state) || input.parentVersionId !== h.latest_version_id) conflict();
        const original = await file(tx, h, h.original_file_id); assertCustomerUploadRows(input.rows, input.issues, manifestOf(original));
        const bytes = Buffer.from(input.normalizedFile.base64, "base64").length + (input.issuesFile ? Buffer.from(input.issuesFile.base64, "base64").length : 0);
        if (bytes > schemas.CUSTOMER_UPLOAD_FILE_BYTES_MAX) fail("BAD_REQUEST", "本次累计文件超过10MiB");
        if (Buffer.byteLength(JSON.stringify({ rows: input.rows, issues: input.issues }), "utf8") > 8 * 1024 * 1024) fail("BAD_REQUEST", "候选行及问题超过8MiB安全上限");
        const normalized = await appendFile(tx, h, "normalized", input.normalizedFile); const issuesFile = input.issuesFile ? await appendFile(tx, h, "issues", input.issuesFile) : null;
        const versionId = randomUUID(); const versionNo = Number(h.latest_version_no) + 1;
        await tx.execute(sql`INSERT INTO customer_upload_versions (version_id,enterprise_id,data_owner_user_id,customer_id,history_id,version_no,parent_version_id,normalized_file_id,issues_file_id,rows_data,issues_data,uploaded_by_user_id,uploaded_by_admin_account_id)
          VALUES (${versionId},${scope.enterpriseId},${scope.dataOwnerUserId},${Number(h.customer_id)},${h.history_id},${versionNo},${input.parentVersionId},${normalized.file_id},${issuesFile?.file_id ?? null},${JSON.stringify(input.rows)},${JSON.stringify(input.issues)},${scope.actorUserId},${scope.officialActor?.adminAccountId ?? null})`);
        await advance(tx, h, "awaiting_confirmation", versionId, versionNo);
        const current = await history(tx, policy, h.history_id);
        return { history: await dto(tx, policy, scope, current), version: await version(tx, current, versionId), idempotent: false };
      });
    },
    async customerUploadDownload(scope: ChannelInventoryScope, raw: schemas.CustomerUploadDownloadInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadDownload"]> {
      const input = parse(schemas.customerUploadDownloadSchema, scope, raw);
      return transaction(scope, false, async (tx, policy) => {
        const selected: { h: HistoryRow; f: FileRow }[] = []; const ids = new Set<string>(); let size = 0;
        // ALL exact ACL/tuple/size checks complete before ANY private bytes are read.
        for (const selection of input.files) {
          if (ids.has(selection.fileId)) fail("BAD_REQUEST", "下载文件重复"); ids.add(selection.fileId);
          const h = await history(tx, policy, selection.historyId); const f = await file(tx, h, selection.fileId);
          size += Number(f.byte_size); if (size > schemas.CUSTOMER_UPLOAD_FILE_BYTES_MAX) fail("BAD_REQUEST", "本次下载累计超过10MiB"); selected.push({ h, f });
        }
        const zipFiles: Record<string, Uint8Array> = {}; const manifest = [["任务编号", "原文件名", "客户", "上传人", "北京时间", "本次文件名", "文件SHA256"].map(customerUploadCsvCell).join(",")]; let decoded = 0;
        for (const { h, f } of selected) {
          const data = await deps.storage.read(f.locator); decoded += data.length;
          if (data.length !== Number(f.byte_size) || hash(data) !== f.sha256 || decoded > schemas.CUSTOMER_UPLOAD_FILE_BYTES_MAX) throw new Error("PRIVATE_FILE_INTEGRITY");
          if (selected.length === 1 && !input.includeManifest) return { fileName: safeFileName(f.file_name), mimeType: f.mime_type, byteSize: data.length, sha256: hash(data), base64: data.toString("base64") };
          const name = `${h.history_id}/${f.file_id}-${safeFileName(f.file_name)}`; zipFiles[name] = data;
          const original = await file(tx, h, h.original_file_id);
          const beijing = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date(h.created_at));
          manifest.push([h.history_id, original.file_name, h.customer_name, `用户 ${Number(h.uploaded_by_user_id)}`, beijing, f.file_name, f.sha256].map(customerUploadCsvCell).join(","));
        }
        zipFiles["manifest.csv"] = strToU8(`\uFEFF${manifest.join("\r\n")}\r\n`);
        const archive = Buffer.from(zipSync(zipFiles, { level: 6 })); if (archive.length > schemas.CUSTOMER_UPLOAD_FILE_BYTES_MAX) fail("BAD_REQUEST", "ZIP及清单超过10MiB");
        return { fileName: "customer-upload-history.zip", mimeType: "application/zip", byteSize: archive.length, sha256: hash(archive), base64: archive.toString("base64") };
      });
    },
    // Formal methods below use the original supply batch factory; prepare never creates materials.
    async customerUploadPrepareConfirmation(scope: ChannelInventoryScope, raw: schemas.CustomerUploadPrepareConfirmationInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadPrepareConfirmation"]> {
      const input = parse(schemas.customerUploadPrepareConfirmationSchema, scope, raw);
      return mutation(scope, input, "channelInventory.customerUploadPrepareConfirmation", async (tx, policy) => {
        const h = await history(tx, policy, input.historyId);
        if (!historyActorIsSelf(scope, h)) fail("FORBIDDEN", "仅原上传本人可执行正式入库确认");
        cas(h, input.expectedRevision); await forbidConfirmation(tx, h);
        if (h.state !== "awaiting_confirmation") fail("CONFLICT", "当前任务未处于待确认状态");
        if ((input.versionId ?? null) !== h.latest_version_id || h.mode === "parse" && !input.versionId) fail("CONFLICT", "请核对当前结果版本");
        const original = await file(tx, h, h.original_file_id); const manifest = manifestOf(original);
        const v = input.versionId ? await version(tx, h, input.versionId) : null;
        const allIds = new Set<string>(); const rowIds = new Set<string>(); const requestIds = new Set<string>();
        const resolutionIds = new Set<string>(); const resolvedIssues = input.resolvedIssues ?? [];
        const allIssues = v ? [...v.issues, ...v.rows.flatMap(r => r.issues)] : [];
        for (const resolution of resolvedIssues) {
          if (resolutionIds.has(resolution.issueId) || !allIssues.some(i => i.issueId === resolution.issueId)) fail("BAD_REQUEST", "问题解决标识重复或不属于当前版本");
          resolutionIds.add(resolution.issueId);
        }
        if (allIssues.some(i => !i.resolved && !resolutionIds.has(i.issueId))) fail("BAD_REQUEST", "所有待确认问题须明确填写人工解决说明");
        const confirmed: { row: typeof input.confirmedRows[number]; fields: z.output<typeof createCustomerMaterialSchema> }[] = [];
        for (const row of input.confirmedRows) {
          if (allIds.has(row.logicalRowId) || rowIds.has(row.rowId) || requestIds.has(row.rowRequestId) || row.rowRequestId === input.requestId || row.rowRequestId === input.batchRequestId) fail("BAD_REQUEST", "确认行或请求号重复");
          allIds.add(row.logicalRowId); rowIds.add(row.rowId); requestIds.add(row.rowRequestId);
          assertCustomerUploadSourceRefs(manifest, row.sourceRefs);
          if (row.fields.currency !== "CNY") fail("BAD_REQUEST", "币种必须人工明确确认为CNY，未知币种不能默认人民币");
          const result = createCustomerMaterialSchema.safeParse({ expectedEnterpriseId: scope.enterpriseId, expectedActorUserId: scope.actorUserId, customerId: Number(h.customer_id), expectedCustomerVersion: input.expectedCustomerVersion, ...row.fields, requestId: row.rowRequestId, ...(input.sourceProfile ? { sourceProfile: input.sourceProfile } : {}) });
          if (!result.success) fail("BAD_REQUEST", result.error.issues[0]?.message ?? "请按原正式库存字段校验补全");
          if (v) {
            const candidate = v.rows.find(r => r.logicalRowId === row.logicalRowId && r.rowId === row.rowId);
            if (!candidate || candidate.disposition === "excluded" || channelInventoryPayloadHash(candidate.sourceRefs) !== channelInventoryPayloadHash(row.sourceRefs)) fail("BAD_REQUEST", "候选行来源或确认映射不完整");
          }
          confirmed.push({ row, fields: result.data! });
        }
        for (const excluded of input.excludedRows) {
          if (allIds.has(excluded.logicalRowId)) fail("BAD_REQUEST", "确认与排除行重复");
          if (excluded.sourceRefs) assertCustomerUploadSourceRefs(manifest, excluded.sourceRefs);
          allIds.add(excluded.logicalRowId);
        }
        if (v && (v.rows.some(r => !allIds.has(r.logicalRowId)) || allIds.size !== v.rows.length || input.excludedRows.some(e => !v.rows.some(r => r.logicalRowId === e.logicalRowId)))) fail("BAD_REQUEST", "所有候选行须明确确认或填写排除理由");
        // imported concerns the nonempty human-confirmed eligible set, NOT a claim that every
        // original title/header/cell became inventory. Missing raw source coverage remains explicit.
        const accountedRefs = v ? v.rows.flatMap(r => r.sourceRefs) : [...input.confirmedRows.flatMap(r => r.sourceRefs), ...input.excludedRows.flatMap(r => r.sourceRefs ?? [])];
        const accounted = new Set(accountedRefs.map(r => `${r.sheetIndex}:${r.rowNumber}:${r.originalRowHash}`));
        const unprocessedSourceRefs = manifest!.sheets.flatMap(s => s.rows.filter(r => !r.cells.every(c => c == null || c === "") && !accounted.has(`${s.sheetIndex}:${r.rowNumber}:${r.originalRowHash}`)).map(r => ({ sheetIndex: s.sheetIndex, sheetName: s.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash })));
        const sourceCoverage = { unprocessedSourceRefs, warning: unprocessedSourceRefs.length ? `原表有${unprocessedSourceRefs.length}行未纳入本次明确确认集合（可能为表头或其他工作表）；已入库仅指本次确认行全部真实成功，不代表原表所有行已处理。` : null };
        const eligibleComplete = confirmed.length > 0 && (!v || v.rows.every(r => allIds.has(r.logicalRowId)));
        if (Buffer.byteLength(JSON.stringify({ confirmedRows: input.confirmedRows, excludedRows: input.excludedRows, resolvedIssues }), "utf8") > 8 * 1024 * 1024) fail("BAD_REQUEST", "确认内容超过8MiB安全上限");
        if (input.batchRequestId === input.requestId) fail("BAD_REQUEST", "本地操作与正式批次请求号必须独立");
        const batchClaimHash = channelInventoryPayloadHash({ historyId: h.history_id, batchRequestId: input.batchRequestId, officialAdminId: scope.officialActor?.adminAccountId ?? null });
        if (await prior(tx, scope, { requestId: input.batchRequestId }, "batch_claim", batchClaimHash)) fail("CONFLICT", "正式批次号已绑定其他确认");
        await saveRequest(tx, scope, input.batchRequestId, "batch_claim", h.history_id, batchClaimHash, {});
        for (const item of confirmed) {
          const rowHash = channelInventoryPayloadHash({ historyId: h.history_id, logicalRowId: item.row.logicalRowId, rowId: item.row.rowId, fields: item.fields, officialAdminId: scope.officialActor?.adminAccountId ?? null });
          if (await prior(tx, scope, { requestId: item.row.rowRequestId }, "row_claim", rowHash)) fail("CONFLICT", "正式行请求号已绑定其他确认");
          await saveRequest(tx, scope, item.row.rowRequestId, "row_claim", h.history_id, rowHash, {});
        }
        // This adapter joins the TRUE outer tx: source/batch/history/request claims commit together.
        const adapter: SqlDatabase = { execute: query => tx.execute(query), transaction: operation => operation(tx) };
        const supply = (deps.supplyFactory ?? createCustomerSupplyService)({ getDb: async () => adapter, registerTeamRecord: deps.registerTeamRecord });
        const batch = await supply.createCustomerUploadBatch(scope, { expectedEnterpriseId: scope.enterpriseId, expectedActorUserId: scope.actorUserId, customerId: Number(h.customer_id), expectedCustomerVersion: input.expectedCustomerVersion,
          ...(input.expectedChannelId === undefined ? {} : { expectedChannelId: input.expectedChannelId }), ...(input.expectedChannelRevision === undefined ? {} : { expectedChannelRevision: input.expectedChannelRevision }), ...(input.sourceProfile ? { sourceProfile: input.sourceProfile } : {}), fileName: original.file_name, totalRows: confirmed.length, requestId: input.batchRequestId });
        const source = rows(await tx.execute(sql`SELECT c.channel_type AS source_type FROM channel_inventory_channels c WHERE c.id = ${batch.channelId} AND c.enterprise_id = ${scope.enterpriseId} AND c.data_owner_user_id = ${scope.dataOwnerUserId} AND c.responsible_user_id = ${scope.actorUserId} LIMIT 1 FOR UPDATE`))[0];
        if (!source || !["factory", "agent", "trade", "other"].includes(String(source.source_type))) return hidden();
        const entries = confirmed.map(({ row, fields }) => {
          const payload: ConfirmationEntry["payload"] = { ...fields, channelId: batch.channelId, uploadBatchId: batch.id };
          return { logicalRowId: row.logicalRowId, rowId: row.rowId, rowRequestId: row.rowRequestId, uploadBatchId: batch.id, payload, sourceRefs: row.sourceRefs, status: "pending" as const, createPayloadHash: customerUploadFormalCreateHash(payload, String(source.source_type) as "factory" | "agent" | "trade" | "other") };
        });
        const batchCreatePayloadHash = channelInventoryPayloadHash({ action: "createUploadBatch", channelId: batch.channelId, fileName: original.file_name, totalRows: confirmed.length });
        const confirmationId = randomUUID(); const frozen: Frozen = { confirmationId, versionId: input.versionId ?? null, batchRequestId: input.batchRequestId, batch, entries, excludedRows: input.excludedRows, resolvedIssues, sourceCoverage, createdAt: new Date().toISOString(), originalFileHash: original.sha256, eligibleComplete, batchCreatePayloadHash };
        await tx.execute(sql`INSERT INTO customer_upload_confirmations (confirmation_id,enterprise_id,data_owner_user_id,customer_id,history_id,actor_user_id,batch_request_id,frozen_data,receipts_data)
          VALUES (${confirmationId},${scope.enterpriseId},${scope.dataOwnerUserId},${Number(h.customer_id)},${h.history_id},${scope.actorUserId},${input.batchRequestId},${JSON.stringify(frozen)},${JSON.stringify(entries.map(e => ({ logicalRowId: e.logicalRowId, status: e.status })))})`);
        await advance(tx, h, "awaiting_confirmation");
        return { historyId: h.history_id, revision: Number(h.revision) + 1, confirmationId, batch, entries: entries.map(({ createPayloadHash: _hash, ...entry }) => entry) };
      }, async (tx, policy, h) => {
        if (!historyActorIsSelf(scope, h)) fail("FORBIDDEN", "仅原上传本人可恢复正式确认");
        const cf = await confirmation(tx, h); if (!cf) return hidden(); await assertCurrentBatch(tx, scope, h, cf);
      });
    },
    async customerUploadReconcileBatch(scope: ChannelInventoryScope, raw: schemas.CustomerUploadReconcileBatchInput): Promise<CustomerUploadHistoryOutputs["channelInventory.customerUploadReconcileBatch"]> {
      const input = parse(schemas.customerUploadReconcileBatchSchema, scope, raw);
      return mutation(scope, input, "channelInventory.customerUploadReconcileBatch", async (tx, policy) => {
        const h = await history(tx, policy, input.historyId); const cf = await confirmation(tx, h);
        if (!cf || cf.frozen.confirmationId !== input.confirmationId) return hidden();
        await assertCurrentBatch(tx, scope, h, cf);
        const next: Pick<ConfirmationEntry, "logicalRowId" | "status" | "receipt">[] = []; let remaining = 0;
        for (const entry of cf.entries) {
          if (entry.status === "success" && entry.receipt) {
            const exists = rows(await tx.execute(sql`SELECT m.id FROM channel_inventory_materials m WHERE m.id = ${entry.receipt.materialId} AND m.enterprise_id = ${scope.enterpriseId} AND m.data_owner_user_id = ${scope.dataOwnerUserId}
              AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_management dm WHERE dm.enterprise_id = m.enterprise_id AND dm.material_id = m.id AND dm.deleted_at IS NOT NULL) LIMIT 1 FOR UPDATE`));
            remaining += exists.length ? 1 : 0; next.push({ logicalRowId: entry.logicalRowId, status: "success", receipt: entry.receipt }); continue;
          }
          const frozenEntry = cf.frozen.entries.find(e => e.logicalRowId === entry.logicalRowId)!;
          const evidence = rows(await tx.execute(sql`SELECT m.id AS material_id,m.revision AS material_revision,m.create_request_id,m.create_payload_hash,
            bm.initial_revision,bm.initial_channel_id,bm.initial_owner_user_id,ca.actor_user_id AS creator_user_id,ca.payload_hash AS audit_payload_hash,ca.after_data AS creation_data,
            dm.deleted_at FROM channel_inventory_upload_batch_materials bm
            INNER JOIN channel_inventory_materials m ON m.enterprise_id = bm.enterprise_id AND m.id = bm.material_id
            INNER JOIN channel_inventory_upload_batches b ON b.enterprise_id = bm.enterprise_id AND b.id = bm.batch_id AND b.data_owner_user_id = m.data_owner_user_id
            INNER JOIN channel_inventory_material_share_audits ca ON ca.enterprise_id = m.enterprise_id AND ca.material_id = m.id AND ca.request_id = m.create_request_id
            LEFT JOIN channel_inventory_material_management dm ON dm.enterprise_id = m.enterprise_id AND dm.material_id = m.id
            WHERE bm.enterprise_id = ${scope.enterpriseId} AND bm.batch_id = ${cf.frozen.batch.id} AND b.channel_id = ${cf.frozen.batch.channelId}
              AND b.uploaded_by_user_id = ${Number(h.uploaded_by_user_id)} AND ${h.uploaded_by_admin_account_id == null ? sql`b.uploaded_by_admin_account_id IS NULL` : sql`b.uploaded_by_admin_account_id = ${Number(h.uploaded_by_admin_account_id)}`}
              AND m.data_owner_user_id = ${scope.dataOwnerUserId} AND m.create_request_id = ${entry.rowRequestId} AND m.create_payload_hash = ${frozenEntry.createPayloadHash}
              AND bm.initial_channel_id = ${cf.frozen.batch.channelId} AND bm.initial_owner_user_id = ${Number(h.uploaded_by_user_id)}
              AND ca.actor_user_id = ${Number(h.uploaded_by_user_id)} LIMIT 2 FOR UPDATE`));
          const verified = evidence.length === 1 ? verifyEvidence(evidence[0], h, entry, frozenEntry.createPayloadHash) : null;
          if (verified) { next.push({ logicalRowId: entry.logicalRowId, status: "success", receipt: verified }); if (evidence[0].deleted_at == null) remaining++; }
          else next.push({ logicalRowId: entry.logicalRowId, status: "unknown" });
        }
        await tx.execute(sql`UPDATE customer_upload_confirmations SET receipts_data = ${JSON.stringify(next)},remaining_material_count = ${remaining} WHERE confirmation_id = ${input.confirmationId} AND ${exactTuple(h, "customer_upload_confirmations")}`);
        const success = next.filter(e => e.status === "success").length;
        const state = success === cf.entries.length && success > 0 && cf.frozen.eligibleComplete ? "imported" : success > 0 ? "partially_imported" : "awaiting_confirmation";
        await advance(tx, h, state);
        return { history: await dto(tx, policy, scope, await history(tx, policy, h.history_id)), entries: next.map(e => ({ ...e, rowRequestId: cf.entries.find(row => row.logicalRowId === e.logicalRowId)!.rowRequestId })), batch: cf.frozen.batch };
      }, async (tx, _policy, h) => { const cf = await confirmation(tx, h); if (!cf || cf.frozen.confirmationId !== input.confirmationId) return hidden(); await assertCurrentBatch(tx, scope, h, cf); });
    },
  };
}
/** Current original customer + batch/channel/member scope. Manager ACL alone never expands native own-batch read. */
async function assertCurrentBatch(tx: SqlExecutor, scope: ChannelInventoryScope, h: HistoryRow, cf: PersistedConfirmation) {
  if (!historyActorIsSelf(scope, h)) fail("FORBIDDEN", "请由原上传本人核实原正式批次");
  const b = rows(await tx.execute(sql`SELECT b.id,br.result_data AS batch_creation_receipt FROM channel_inventory_upload_batches b
    INNER JOIN channel_inventory_channels c ON c.id = b.channel_id AND c.enterprise_id = b.enterprise_id AND c.data_owner_user_id = b.data_owner_user_id
    INNER JOIN crm_customer_supply_channels sc ON sc.channelId = c.id AND sc.enterpriseId = c.enterprise_id AND sc.dataOwnerUserId = c.data_owner_user_id AND sc.inventoryResponsibleUserId = c.responsible_user_id
    INNER JOIN enterprise_team_members tm ON tm.enterpriseId = b.enterprise_id AND tm.userId = b.uploaded_by_user_id AND tm.teamId = b.team_id AND tm.id = b.owner_membership_id
    INNER JOIN enterprise_teams t ON t.enterpriseId = tm.enterpriseId AND t.id = tm.teamId AND t.status = 'active'
    INNER JOIN channel_inventory_management_requests br ON br.enterprise_id = b.enterprise_id AND br.data_owner_user_id = b.data_owner_user_id AND br.actor_user_id = b.uploaded_by_user_id
      AND br.request_id = ${cf.frozen.batchRequestId} AND br.action = 'createUploadBatch' AND br.payload_hash = ${cf.frozen.batchCreatePayloadHash}
    WHERE b.id = ${cf.frozen.batch.id} AND b.batch_code = ${cf.frozen.batch.batchCode} AND b.enterprise_id = ${scope.enterpriseId} AND b.data_owner_user_id = ${scope.dataOwnerUserId}
      AND b.channel_id = ${cf.frozen.batch.channelId} AND b.uploaded_by_user_id = ${scope.actorUserId} AND c.responsible_user_id = ${scope.actorUserId}
      AND sc.customerId = ${Number(h.customer_id)} AND tm.teamRole IN ('leader','member')
      AND ${scope.officialActor ? sql`b.uploaded_by_admin_account_id = ${scope.officialActor.adminAccountId}` : sql`b.uploaded_by_admin_account_id IS NULL`}
      AND (SELECT COUNT(*) FROM enterprise_team_members unique_batch_member WHERE unique_batch_member.enterpriseId = ${scope.enterpriseId} AND unique_batch_member.userId = ${scope.actorUserId}) = 1
    LIMIT 1 FOR UPDATE`));
  if (b.length !== 1) hidden();
  const receipt = json<{ id: number; batchCode: string; revision: number }>(b[0].batch_creation_receipt);
  if (receipt.id !== cf.frozen.batch.id || receipt.batchCode !== cf.frozen.batch.batchCode || receipt.revision !== cf.frozen.batch.revision) hidden();
}
function verifyEvidence(e: SqlResultRow, h: HistoryRow, entry: ConfirmationEntry, payloadHash: string): VerifiedRowReceipt | null {
  let event: SqlResultRow; try { event = json<SqlResultRow>(e.creation_data); } catch { return null; }
  const materialId = Number(e.material_id); const initialRevision = Number(e.initial_revision);
  if (!Number.isSafeInteger(materialId) || materialId < 1 || !Number.isSafeInteger(initialRevision) || initialRevision < 1 || Number(e.material_revision) < initialRevision
    || event.action !== "createDefaultShare" || Number(event.materialId) !== materialId || Number(event.revision) !== initialRevision || Number(e.creator_user_id) !== Number(h.uploaded_by_user_id)
    || String(e.create_request_id) !== entry.rowRequestId || String(e.create_payload_hash) !== payloadHash || Number(e.initial_channel_id) !== entry.payload.channelId || Number(e.initial_owner_user_id) !== Number(h.uploaded_by_user_id)
    || String(e.audit_payload_hash) !== channelInventoryPayloadHash({ action: "createDefaultShare", materialId, createPayloadHash: payloadHash })) return null;
  const official = event.officialActor as SqlResultRow | undefined;
  if (h.uploaded_by_admin_account_id == null ? official != null : !official || Number(official.schemaVersion) !== 1 || Number(official.adminAccountId) !== Number(h.uploaded_by_admin_account_id) || Number(official.staffUserId) !== Number(h.uploaded_by_user_id) || !Number.isSafeInteger(Number(official.bindingVersion)) || Number(official.bindingVersion) < 1 || !/^[A-Za-z0-9_-]{8,64}$/.test(String(official.requestId))) return null;
  return { logicalRowId: entry.logicalRowId, rowRequestId: entry.rowRequestId, uploadBatchId: entry.uploadBatchId, channelId: entry.payload.channelId, customerId: entry.payload.customerId, materialId, materialRevision: initialRevision, status: "success" };
}
export type CustomerUploadHistoryService = ReturnType<typeof createCustomerUploadHistoryService>;
