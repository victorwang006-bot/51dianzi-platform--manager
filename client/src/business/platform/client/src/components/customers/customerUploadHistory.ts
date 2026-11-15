import { fields, mapGrid, suggestMapping, type Draft, type Payload } from "../channelInventory/import";
import { inventoryRequestId } from "../channelInventory/management";
import type { BatchEntry } from "../channelInventory/queue";

import { z } from "zod";
import { createCustomerMaterialSchema } from "../../../../shared/customerSupply";
import { customerUploadFileInputSchema } from "../../../../shared/customerUploadHistory";
import type { HistoryState, FileDto, SourceRef, ConfirmationEntry, CandidateFields, Issue, ResultRow, HistoryDto, VersionDto, OriginalWorkbookManifest, ConfirmationDto, CustomerUploadHistoryOutputs } from "../../../../shared/customerUploadHistory";
export type { HistoryState, SourceRef, ResultRow };
export type HistoryFile = FileDto;
export type Candidate = CandidateFields;
export type HistoryIssue = Issue;
export type History = HistoryDto;
export type Version = VersionDto;
export type OriginalSheets = OriginalWorkbookManifest["sheets"];
export type Confirmation = ConfirmationDto;
export type HistoryDetail = CustomerUploadHistoryOutputs["channelInventory.customerUploadHistoryGet"];
export const historyStates: Record<HistoryState, string> = { pending_parse: "待解析", parsing: "解析中", awaiting_confirmation: "待确认", partially_imported: "部分入库", imported: "已入库", parse_failed: "解析失败", cancelled: "已取消" };
export type HistorySession = { historyId: string; revision: number; versionId?: string; originalFile: HistoryFile; confirmationId?: string; prepareRequestId: string; sourceExclusions?: { logicalRowId: string; reason: string; sourceRefs: SourceRef[] }[]; otherSheetCount?: number; sourceScopeConfirmed?: boolean };
export type ReviewRow = { row: number; draft: Draft; rowId: string; logicalRowId: string; sourceRefs: SourceRef[]; issues: HistoryIssue[] };
export function canonicalConfirmationPayload(value: unknown): ConfirmationEntry["payload"] {
  if (!value || typeof value !== "object" || !("currency" in value) || value.currency !== "CNY") throw new Error("服务端冻结payload缺少明确币种。");
  return createCustomerMaterialSchema.extend({ channelId: z.number().int().safe().positive() }).parse(value);
}
export const uuid = inventoryRequestId;
export const isUUID = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export function historySession(history: History): HistorySession { return { historyId: history.historyId, revision: history.revision, originalFile: history.originalFile, ...(history.latestVersionId ? { versionId: history.latestVersionId } : {}), prepareRequestId: uuid() }; }
export function validateFile(file: File, limit = 10 * 1024 * 1024) {
  if (!file.name.trim() || file.name.trim().length > 255 || !/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("请选择文件名不超过255字的 .xlsx/.xls/.csv 表格。");
  if (!file.size || file.size > limit) throw new Error(`文件须非空且不超过${limit / 1024 / 1024}MiB；请拆分后上传。`);
}
export async function fileInput(file: File) {
  validateFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length !== file.size || bytes.length > 10485760) throw new Error("文件字节大小异常。");
  let text = ""; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...Array.from(bytes.subarray(i, i + 32768)));
  const extension = file.name.split(".").pop()?.toLowerCase();
  return customerUploadFileInputSchema.parse({ fileName: file.name.trim(), mimeType: extension === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : extension === "xls" ? "application/vnd.ms-excel" : "text/csv", base64: btoa(text) });
}
export function downloadedFile(data: { fileName: string; mimeType: string; base64: string; byteSize: number }): File {
  if (data.byteSize > 10485760 || data.base64.length > 13981016) throw new Error("下载超限，请按20份且总10MiB分批。");
  const raw = atob(data.base64); if (raw.length !== data.byteSize) throw new Error("下载文件大小不匹配。");
  return new File([Uint8Array.from(raw, char => char.charCodeAt(0))], data.fileName.replace(/[\\/\r\n]/g, "_"), { type: data.mimeType });
}
export function savePrivateFile(data: Parameters<typeof downloadedFile>[0]) {
  const file = downloadedFile(data); const url = URL.createObjectURL(file); const link = document.createElement("a");
  try { link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function candidateDraft(candidate: Candidate): Draft { return { partNumber: candidate.partNumber ?? "", brand: candidate.brand ?? "", qty: candidate.qty == null ? "" : String(candidate.qty), price: candidate.price ?? "", currency: candidate.currency ?? "", dateCode: candidate.dateCode ?? "", taxIncluded: candidate.taxIncluded == null ? "unknown" : String(candidate.taxIncluded), leadTime: candidate.leadTime ?? "", note: candidate.note ?? "" }; }
export function resultReview(version: Version): ReviewRow[] { return version.rows.map((r, i) => ({ row: i + 2, draft: { ...candidateDraft(r.candidate), ...(r.issues.some(issue => issue.field === "source" && !issue.resolved) ? { sourceIssue: r.issues.filter(issue => issue.field === "source" && !issue.resolved).map(issue => issue.message).join("；") } : {}) }, rowId: r.rowId, logicalRowId: r.logicalRowId, sourceRefs: r.sourceRefs, issues: r.issues })); }
export function originalReview(manifest: OriginalSheets): ReviewRow[] {
  const sheet = manifest[0]; if (!sheet) throw new Error("服务端没有原工作表证据，不能按索引猜行。");
  return sheet.rows.filter(r => r.rowNumber > 1).map(r => ({ row: r.rowNumber, draft: {} as Draft, rowId: uuid(), logicalRowId: uuid(), sourceRefs: [{ sheetIndex: sheet.sheetIndex, sheetName: sheet.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash }], issues: [] }));
}
export function recoveryEntries(confirmation: Pick<Confirmation, "confirmationId" | "batchRequestId" | "batch" | "entries">): (BatchEntry & { uploadBatchId: number })[] {
  if (!isUUID(confirmation.batchRequestId) || !confirmation.batch?.id || !confirmation.entries.length) throw new Error("服务端确认批次尚未完整持久化，请核实原批次，不能新建。");
  return confirmation.entries.map((entry, i) => {
    if (!isUUID(entry.rowRequestId) || entry.uploadBatchId !== confirmation.batch.id || entry.payload.channelId !== confirmation.batch.channelId) throw new Error("持久确认行归属不匹配，已阻断恢复。");
    const canonical = canonicalConfirmationPayload(entry.payload);
    if (canonical.requestId !== entry.rowRequestId || canonical.uploadBatchId !== entry.uploadBatchId) throw new Error("持久payload与原UUID/batch不匹配。");
    const receipt = entry.status === "success" && entry.receipt?.status === "success" ? { item: { id: entry.receipt.materialId, revision: entry.receipt.materialRevision, channelId: entry.receipt.channelId, uploadBatchId: entry.receipt.uploadBatchId }, idempotent: true, channelId: entry.receipt.channelId, customerId: entry.receipt.customerId, uploadBatchId: entry.receipt.uploadBatchId } : undefined;
    if (entry.status === "success" && !receipt) throw new Error("已成功行缺少真实服务端回执，请核实而非重建。");
    return { row: i + 2, requestId: entry.rowRequestId, payload: canonical, status: entry.status, uploadBatchId: entry.uploadBatchId, ...(receipt ? { receipt } : {}) };
  });
}
export async function parseResult(file: File, manifest: OriginalSheets): Promise<{ rows: ResultRow[]; issues: HistoryIssue[] }> {
  validateFile(file); const XLSX = await import("xlsx"); const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: false, cellHTML: false, cellDates: false, raw: /\.csv$/i.test(file.name), sheetRows: 1002 });
  if (workbook.SheetNames.length !== 1) throw new Error("整理结果只接受一张结果工作表；请合并所有结果，不能静默遗漏第二张表。原表任务包保留全部工作表。");
  const sheet = workbook.Sheets[workbook.SheetNames[0]]; const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
  if (range.e.r > 1000 || range.e.c > 39) throw new Error("整理结果最多1000行、40列，不会截断。");
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, range: 0, raw: false, defval: "", blankrows: true });
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, range: 0, raw: true, defval: "", blankrows: true });
  const headers = (grid[0] ?? []).map(value => String(value).trim()); const sourceColumns = ["原工作表", "原行号", "原内容"].map(h => headers.indexOf(h));
  if (sourceColumns.some(c => c < 0)) throw new Error("缺少【原工作表】【原行号】【原内容】来源列；请按任务UUID整理模板并完整保留原证据，不按结果行号猜测。");
  const mapping = suggestMapping(headers); const issues: HistoryIssue[] = [];
  const rows = mapGrid(grid, mapping, raw).map(mapped => {
    const line = grid[mapped.row - 1]; const sheetName = String(line[sourceColumns[0]] ?? ""); const rowText = String(line[sourceColumns[1]] ?? ""); const content = String(line[sourceColumns[2]] ?? "");
    const matches = manifest.filter(s => s.sheetName === sheetName).flatMap(s => s.rows.filter(r => /^\d+$/.test(rowText) && r.rowNumber === Number(rowText) && r.originalContent === content).map(r => ({ sheetIndex: s.sheetIndex, sheetName: s.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash })));
    if (matches.length !== 1) throw new Error(`结果第${mapped.row}行来源无法唯一匹配真实原表/行/内容；不接受猜测来源。`);
    const rowId = uuid(); const draft = mapped.draft; const currency = mapping.currency < 0 ? null : String(line[mapping.currency] ?? "").trim() || null;
    const candidate: Candidate = { partNumber: draft.partNumber || null, brand: draft.brand || null, qty: /^\d+$/.test(draft.qty) && BigInt(draft.qty) <= BigInt("2147483647") ? Number(draft.qty) : null, price: /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(draft.price) && draft.price.length <= 32 ? draft.price : null, currency: currency && ["CNY", "RMB", "人民币", "元"].includes(currency) ? "CNY" : currency, taxIncluded: draft.taxIncluded === "true" ? true : draft.taxIncluded === "false" ? false : null, dateCode: draft.dateCode || null, leadTime: draft.leadTime || null, note: draft.note || null };
    const rowIssues: HistoryIssue[] = []; const add = (field: HistoryIssue["field"], message: string) => rowIssues.push({ issueId: uuid(), rowId, field, message, resolved: false, resolution: null });
    for (const field of ["partNumber", "brand", "qty", "price", "taxIncluded"] as const) if (candidate[field] == null) add(field, `${field}缺失或不明确，须人工核对，不猜填。`);
    if (candidate.currency !== "CNY") add("currency", "币种未知或为外币，须上传员工明确核对为CNY；不自动换算。");
    for (const error of mapped.errors) add(draft.sourceIssue === error ? "source" : "other", error);
    issues.push(...rowIssues); return { rowId, logicalRowId: uuid(), sourceRefs: matches, candidate, disposition: "pending" as const, excludeReason: null, issues: rowIssues };
  });
  if (!rows.length) throw new Error("整理结果至少需要一行候选物料。");
  // Oversized/invalid candidate values remain in the immutable source evidence,
  // while bounded candidate fields become null and an explicit issue is retained.
  for (const row of rows) {
    const limits = { partNumber: 128, brand: 64, dateCode: 32, leadTime: 64, note: 2000, price: 32, currency: 16 } as const;
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const value = row.candidate[key];
      if (value && value.length > limits[key]) {
        row.candidate[key] = null;
        const issue: HistoryIssue = { issueId: uuid(), rowId: row.rowId, field: key === "partNumber" || key === "brand" || key === "price" || key === "currency" ? key : "other", message: `${key}超出字段长度限制，候选留空；原内容完整保存在来源，须人工核实。`, resolved: false, resolution: null };
        row.issues.push(issue); issues.push(issue);
      }
    }
  }
  return { rows, issues };
}
export const resultGuide = { version: 1, taskBinding: "使用选中的historyId/任务UUID回传，不凭文件名猜任务", sourceColumns: ["原工作表", "原行号", "原内容"], candidateColumns: fields.map(f => f.label), rules: ["所有原工作表与原行证据完整保留", "结果仅一张表，最多1000行", "所有候选先pending；型号/品牌缺失人工补全", "数量与价格使用精确文本；币种/含税未知不得猜", "问题字段issueId,rowId,field,message,resolved,resolution；排除必须写原因", "已确认/unknown/成功批次先完成或核实，不回传新版本"] };
