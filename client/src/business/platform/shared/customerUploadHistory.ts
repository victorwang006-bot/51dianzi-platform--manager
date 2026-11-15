import { z } from "zod";
import { channelMaterialCreateFields, type CreateCustomerMaterialInput } from "./customerSupply";
export const CUSTOMER_UPLOAD_FILE_BYTES_MAX = 10 * 1024 * 1024;
export const CUSTOMER_UPLOAD_HISTORY_STATES = ["pending_parse", "parsing", "awaiting_confirmation", "partially_imported", "imported", "parse_failed", "cancelled"] as const;
export type HistoryState = typeof CUSTOMER_UPLOAD_HISTORY_STATES[number];
export type UploadMode = "standard" | "parse";
export type HistoryAccess = "self" | "current_team_leader" | "enterprise_manager";
const id = z.number().int().safe().positive();
const uuid = z.string().uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = (n: number) => z.string().trim().max(n);
const expected = { expectedEnterpriseId: id, expectedActorUserId: id };
const fence = { historyId: uuid, expectedRevision: id, requestId: uuid };
export const customerUploadFileInputSchema = z.object({ fileName: text(255).min(1).refine(s => !/[\x00-\x1f\x7f/\\]/.test(s), "文件名无效"), mimeType: text(128).min(1), base64: z.string().min(4).max(Math.ceil(CUSTOMER_UPLOAD_FILE_BYTES_MAX / 3) * 4).refine(s => { if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s)) return false; const p = s.indexOf("="); return p === -1 || p >= s.length - 2 && /^={1,2}$/.test(s.slice(p)); }, "文件编码无效") }).strict();
export type FileInput = z.output<typeof customerUploadFileInputSchema>;
export type OriginalWorkbookManifest = { sheets: { sheetIndex: number; sheetName: string; rows: { rowNumber: number; originalRowHash: string; originalContent: string; cells: (string | number | null)[] }[] }[] };
export const customerUploadSourceRefSchema = z.object({ sheetIndex: z.number().int().safe().min(0), sheetName: text(128).min(1), rowNumber: id, cellRange: z.string().max(64).regex(/^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/).optional(), originalRowHash: sha }).strict();
export type SourceRef = z.output<typeof customerUploadSourceRefSchema>;
export const customerUploadCandidateFieldsSchema = z.object({ partNumber: text(128).nullable(), brand: text(64).nullable(), qty: z.number().int().safe().min(0).max(2147483647).nullable(), dateCode: text(32).nullable(), price: text(32).regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/).nullable(), currency: text(16).nullable(), taxIncluded: z.boolean().nullable(), leadTime: text(64).nullable(), note: z.string().max(2000).nullable() }).strict();
export type CandidateFields = z.output<typeof customerUploadCandidateFieldsSchema>;
export const customerUploadIssueSchema = z.object({ issueId: uuid, rowId: uuid.nullable(), field: z.enum(["partNumber", "brand", "qty", "price", "currency", "taxIncluded", "source", "other"]), message: text(1000).min(1), resolved: z.boolean(), resolution: text(1000).nullable() }).strict().refine(v => !v.resolved || Boolean(v.resolution), "解决问题需填写理由");
export type Issue = z.output<typeof customerUploadIssueSchema>;
export const customerUploadResultRowSchema = z.object({ rowId: uuid, logicalRowId: uuid, sourceRefs: z.array(customerUploadSourceRefSchema).min(1).max(100), candidate: customerUploadCandidateFieldsSchema, disposition: z.enum(["pending", "ready", "excluded"]), excludeReason: text(1000).nullable(), issues: z.array(customerUploadIssueSchema).max(100) }).strict().refine(v => v.disposition !== "excluded" || Boolean(v.excludeReason), "排除行需填写理由").refine(v => v.disposition !== "ready" || v.candidate.currency === "CNY" && z.object(channelMaterialCreateFields).strict().safeParse(v.candidate).success && v.issues.every(i => i.resolved), "ready行必须通过原正式字段校验并明确解决问题；未知字段请保留pending");
export type ResultRow = z.output<typeof customerUploadResultRowSchema>;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00+08:00`); return !isNaN(d.valueOf()) && new Date(d.valueOf()+8*3600000).toISOString().slice(0,10) === v; });
export const customerUploadHistoryListSchema = z.object({ ...expected, customerId: id.optional(), view: z.enum(["mine", "management"]).default("mine"), uploadedByFrontUserId: id.optional(), mode: z.enum(["standard", "parse"]).optional(), states: z.array(z.enum(CUSTOMER_UPLOAD_HISTORY_STATES)).min(1).max(7).optional(), dateFrom: date.optional(), dateTo: date.optional(), cursor: z.string().max(512).optional(), pageSize: id.max(50).default(20) }).strict().refine(v => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, "日期范围无效");
export const customerUploadHistoryGetSchema = z.object({ ...expected, historyId: uuid, versionId: uuid.optional() }).strict();
export const customerUploadOriginalSchema = z.object({ ...expected, customerId: id, mode: z.enum(["standard", "parse"]), file: customerUploadFileInputSchema, requestId: uuid, expectedCustomerVersion: id.optional(), standardSourceRefs: z.array(customerUploadSourceRefSchema).max(1000).optional() }).strict();
export const customerUploadManageMarkSchema = z.object({ ...expected, ...fence, action: z.enum(["start_parsing", "return_for_supplement", "fail_parse", "cancel"]), reason: text(1000).nullable() }).strict().refine(v => v.action === "start_parsing" || Boolean(v.reason), "请填写操作原因");
export const customerUploadResultSchema = z.object({ ...expected, ...fence, parentVersionId: uuid.nullable(), normalizedFile: customerUploadFileInputSchema, issuesFile: customerUploadFileInputSchema.optional(), rows: z.array(customerUploadResultRowSchema).min(1).max(1000), issues: z.array(customerUploadIssueSchema).max(1000) }).strict().refine(v => v.issues.length + v.rows.reduce((n, r) => n + r.issues.length, 0) <= 1000, "本次问题总数超过1000条上限");
export const customerUploadDownloadSchema = z.object({ ...expected, files: z.array(z.object({ historyId: uuid, fileId: uuid }).strict()).min(1).max(20), includeManifest: z.boolean().default(false) }).strict();
export const customerUploadPrepareConfirmationSchema = z.object({ ...expected, ...fence, versionId: uuid.optional(), batchRequestId: uuid, expectedCustomerVersion: id, expectedChannelId: id.optional(), expectedChannelRevision: id.optional(), sourceProfile: z.object({ type: z.enum(["factory", "agent", "trade", "other"]), existingChannelId: id.optional() }).strict().optional(), confirmedRows: z.array(z.object({ logicalRowId: uuid, rowId: uuid, rowRequestId: uuid, sourceRefs: z.array(customerUploadSourceRefSchema).min(1).max(100), fields: customerUploadCandidateFieldsSchema }).strict()).min(1).max(1000), excludedRows: z.array(z.object({ logicalRowId: uuid, reason: text(1000).min(1), sourceRefs: z.array(customerUploadSourceRefSchema).min(1).max(100).optional() }).strict()).max(1000), resolvedIssues: z.array(z.object({ issueId: uuid, resolution: text(1000).min(1) }).strict()).max(1000).optional() }).strict();
export const customerUploadReconcileBatchSchema = z.object({ ...expected, historyId: uuid, confirmationId: uuid, requestId: uuid }).strict();
export const CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS = {
  "channelInventory.customerUploadHistoryList": customerUploadHistoryListSchema,
  "channelInventory.customerUploadHistoryGet": customerUploadHistoryGetSchema,
  "channelInventory.customerUploadOriginal": customerUploadOriginalSchema,
  "channelInventory.customerUploadManageMark": customerUploadManageMarkSchema,
  "channelInventory.customerUploadResult": customerUploadResultSchema,
  "channelInventory.customerUploadDownload": customerUploadDownloadSchema,
  "channelInventory.customerUploadPrepareConfirmation": customerUploadPrepareConfirmationSchema,
  "channelInventory.customerUploadReconcileBatch": customerUploadReconcileBatchSchema,
} as const;
export type CustomerUploadHistoryMethod = keyof typeof CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS;
export function isCustomerUploadHistoryMethod(method: string): method is CustomerUploadHistoryMethod { return Object.prototype.hasOwnProperty.call(CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS, method); }
export type CustomerUploadHistoryInputs = { [K in CustomerUploadHistoryMethod]: z.input<typeof CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS[K]> };
export type FileDto = { fileId: string; kind: "original" | "normalized" | "issues"; fileName: string; mimeType: string; byteSize: number; sha256: string; createdAt: string };
export type Statistics = { sourceRowCount: number | null; resultRowCount: number; pendingCount: number; excludedCount: number; successCount: number; unknownCount: number; failedCount: number; remainingMaterialCount: number | null; unprocessedSourceRowCount?: number };
export type HistoryDto = { historyId: string; customerId: number; customerName: string; mode: UploadMode; state: HistoryState; revision: number; uploadedBy: { adminAccountId: number | null; frontUserId: number; displayName: string }; createdAt: string; originalFile: FileDto; latestVersionId: string | null; latestVersionNo: number; stats: Statistics; sourceCoverageWarning?: string; access: HistoryAccess; capabilities: { canDownload: boolean; canManage: boolean; canUploadResult: boolean; canConfirm: boolean; canCancel: boolean } };
export type VersionDto = { versionId: string; versionNo: number; parentVersionId: string | null; createdAt: string; normalizedFile: FileDto | null; issuesFile: FileDto | null; rows: ResultRow[]; issues: Issue[] };
export type FormalBatchReceipt = { id: number; batchCode: string; revision: number; channelId: number; customerId: number };
export type VerifiedRowReceipt = { logicalRowId: string; rowRequestId: string; uploadBatchId: number; channelId: number; customerId: number; materialId: number; materialRevision: number; status: "success" };
export type ConfirmationEntry = { logicalRowId: string; rowId: string; rowRequestId: string; uploadBatchId: number; payload: CreateCustomerMaterialInput & { channelId: number }; status: "pending" | "unknown" | "success"; receipt?: VerifiedRowReceipt };
export type ConfirmationDto = { confirmationId: string; versionId: string | null; batchRequestId: string; batch: FormalBatchReceipt; entries: ConfirmationEntry[]; excludedRows: { logicalRowId: string; reason: string; sourceRefs?: SourceRef[] }[]; resolvedIssues?: { issueId: string; resolution: string }[]; sourceCoverage?: { unprocessedSourceRefs: SourceRef[]; warning: string | null }; createdAt: string };
export type VersionSummary = Omit<VersionDto, "rows" | "issues">;
export type CustomerUploadHistoryOutputs = {
  "channelInventory.customerUploadHistoryList": { items: HistoryDto[]; nextCursor: string | null; canManage: boolean };
  "channelInventory.customerUploadHistoryGet": { history: HistoryDto; versions: VersionSummary[]; selectedVersion: VersionDto | null; confirmation: ConfirmationDto | null; originalSheets: OriginalWorkbookManifest["sheets"] };
  "channelInventory.customerUploadOriginal": { history: HistoryDto; idempotent: boolean; duplicateWarning: boolean; submissionMessage: string };
  "channelInventory.customerUploadManageMark": { history: HistoryDto; idempotent: boolean };
  "channelInventory.customerUploadResult": { history: HistoryDto; version: VersionDto; idempotent: boolean };
  "channelInventory.customerUploadDownload": { fileName: string; mimeType: string; byteSize: number; sha256: string; base64: string };
  "channelInventory.customerUploadPrepareConfirmation": { historyId: string; revision: number; confirmationId: string; batch: FormalBatchReceipt; entries: ConfirmationEntry[] };
  "channelInventory.customerUploadReconcileBatch": { history: HistoryDto; entries: Pick<ConfirmationEntry, "logicalRowId" | "rowRequestId" | "status" | "receipt">[]; batch: FormalBatchReceipt };
};
export type CustomerUploadHistoryListInput = z.input<typeof customerUploadHistoryListSchema>;
export type CustomerUploadHistoryGetInput = z.input<typeof customerUploadHistoryGetSchema>;
export type CustomerUploadOriginalInput = z.input<typeof customerUploadOriginalSchema>;
export type CustomerUploadManageMarkInput = z.input<typeof customerUploadManageMarkSchema>;
export type CustomerUploadResultInput = z.input<typeof customerUploadResultSchema>;
export type CustomerUploadDownloadInput = z.input<typeof customerUploadDownloadSchema>;
export type CustomerUploadPrepareConfirmationInput = z.input<typeof customerUploadPrepareConfirmationSchema>;
export type CustomerUploadReconcileBatchInput = z.input<typeof customerUploadReconcileBatchSchema>;
