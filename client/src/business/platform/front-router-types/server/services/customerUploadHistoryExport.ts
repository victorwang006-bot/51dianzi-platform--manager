import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { CUSTOMER_UPLOAD_FILE_BYTES_MAX, type CandidateFields, type ConfirmationDto, type CustomerUploadProblemsExportOutput, type HistoryDto, type OriginalWorkbookManifest, type SourceRef, type VersionDto } from "../../../shared/customerUploadHistory";
import { ChannelInventoryError } from "./channelInventory";
import { customerUploadIsSkippedProblem } from "./customerUploadHistoryValidation";

/** Pure renderer: callers must authorize the history and load its exact persisted tuple first.
 * No browser status/receipt, private locator, new request ID or stock write is accepted here.
 * There is no durable terminal-failure receipt in the current model; unknown is NOT failed.
 */
export function customerUploadProblemsWorkbook(history: HistoryDto, version: VersionDto | null, confirmation: ConfirmationDto | null, originalSheets: OriginalWorkbookManifest["sheets"] = []): CustomerUploadProblemsExportOutput {
  const columns = ["逻辑行编号", "结果行编号", "状态", "问题或排除原因", "型号", "品牌", "数量", "批次日期", "价格", "币种", "含税", "交期", "备注", "原请求号", "原行来源证据(JSON)"];
  const problems: (string | number | boolean | null)[][] = [columns];
  const verification: (string | number | boolean | null)[][] = [columns];
  const originalProblems = new Map<number, { sheetName: string; rows: Map<number, { cells: (string | number | null)[]; reason: string }> }>();
  const preserveOriginal = (refs: SourceRef[], reason: string) => {
    for (const ref of refs) {
      const sheets = originalSheets.filter(sheet => sheet.sheetIndex === ref.sheetIndex && sheet.sheetName === ref.sheetName);
      const sources = sheets.length === 1 ? sheets[0].rows.filter(source => source.rowNumber === ref.rowNumber) : [];
      if (!originalSheets.length) continue; // Old records use the explicit normalized audit template.
      if (sources.length !== 1 || sources[0].originalRowHash !== ref.originalRowHash
        || createHash("sha256").update(sources[0].originalContent).digest("hex") !== ref.originalRowHash) {
        throw new ChannelInventoryError("PRECONDITION_FAILED", "原行证据缺失或存在歧义，请下载原文件核对");
      }
      let group = originalProblems.get(ref.sheetIndex);
      if (!group) { group = { sheetName: ref.sheetName, rows: new Map() }; originalProblems.set(ref.sheetIndex, group); }
      const old = group.rows.get(ref.rowNumber);
      if (old && old.reason !== reason) throw new ChannelInventoryError("PRECONDITION_FAILED", "同一原行对应多个问题记录，请下载原文件核对");
      group.rows.set(ref.rowNumber, { cells: sources[0].cells, reason });
    }
  };
  const row = (logicalId: string, rowId: string | null, status: string, reason: string, fields: CandidateFields | null, requestId: string | null, refs: SourceRef[]) => [
    logicalId, rowId, status, reason, fields?.partNumber ?? null, fields?.brand ?? null, fields?.qty ?? null, fields?.dateCode ?? null,
    fields?.price ?? null, fields?.currency ?? null, fields?.taxIncluded ?? null, fields?.leadTime ?? null, fields?.note ?? null, requestId, JSON.stringify(refs),
  ];
  if (version && confirmation && confirmation.versionId !== version.versionId) throw new ChannelInventoryError("CONFLICT", "导出版本不属于原确认批次");
  if (confirmation) {
    for (const excluded of confirmation.excludedRows) {
      if (!customerUploadIsSkippedProblem(excluded) || confirmation.entries.some(e => e.logicalRowId === excluded.logicalRowId)) continue;
      const candidate = version?.rows.find(r => r.logicalRowId === excluded.logicalRowId);
      problems.push(row(excluded.logicalRowId, candidate?.rowId ?? null, "excluded", excluded.reason, candidate?.candidate ?? null, null, excluded.sourceRefs ?? candidate?.sourceRefs ?? []));
      preserveOriginal(excluded.sourceRefs ?? candidate?.sourceRefs ?? [], excluded.reason);
    }
    for (const entry of confirmation.entries) {
      if (entry.status === "success") continue; // Success stays successful even after stock deletion.
      const candidate = version?.rows.find(r => r.logicalRowId === entry.logicalRowId);
      // Standard-mode frozen entries also carry refs, although the public entry type
      // intentionally does not require them for older clients.
      const refs = candidate?.sourceRefs ?? (entry as typeof entry & { sourceRefs?: SourceRef[] }).sourceRefs ?? [];
      verification.push(row(entry.logicalRowId, entry.rowId, entry.status, "尚未核实原请求结果；缺少回执不证明失败。只能核实或重试同一原请求及原内容，不能换请求号补发。", entry.payload, entry.rowRequestId, refs));
    }
  } else if (version) {
    for (const candidate of version.rows) {
      const unresolved = candidate.issues.filter(i => !i.resolved);
      if (candidate.disposition === "excluded" && !customerUploadIsSkippedProblem({ reason: candidate.excludeReason ?? "" })) continue;
      if (candidate.disposition === "ready" && unresolved.length === 0) continue;
      const reason = [candidate.excludeReason, ...unresolved.map(i => `${i.field}: ${i.message}`)].filter(Boolean).join("；") || "尚待人工明确确认，不是已核实的入库失败";
      problems.push(row(candidate.logicalRowId, candidate.rowId, candidate.disposition, reason, candidate.candidate, null, candidate.sourceRefs));
      preserveOriginal(candidate.sourceRefs, reason);
    }
  }
  const summary: (string | number)[][] = [
    ["项目", "值"], ["历史编号", history.historyId], ["历史修订", history.revision], ["客户", history.customerName], ["原文件SHA256", history.originalFile.sha256],
    ["原正式批次编号", confirmation?.batch.id ?? ""], ["原批次业务编号", confirmation?.batch.batchCode ?? ""], ["批次状态", history.batchClosed === undefined ? "未获当前批次读取授权或尚无批次" : history.batchClosed ? "closed" : "open"],
    ["问题行数", problems.length - 1], ["待核实请求行数", verification.length - 1], ["服务端核实的终态失败行数", 0],
    ["安全说明", "问题行包含待确认或明确排除行，不等同正式入库失败。unknown必须核实原请求；成功行不导出为失败，删除不撤销成功证据。此工作簿不是可直接重导入的补发模板。"],
    ["原表覆盖说明", history.sourceCoverageWarning ?? ""],
    ["原列证据", originalSheets.length ? "原表问题行保留原始单元格顺序与非映射字段；当前已持久化的标准字段另见问题行。" : "旧记录无原列证据，仅提供明确的标准字段模板；请下载原文件核对。"],
  ];
  for (const excluded of confirmation?.excludedRows ?? []) {
    if (!customerUploadIsSkippedProblem(excluded)) summary.push(["明确范围排除（不计问题行）", JSON.stringify(excluded)]);
  }
  if (!confirmation) for (const excluded of version?.rows ?? []) {
    if (excluded.disposition === "excluded" && !customerUploadIsSkippedProblem({ reason: excluded.excludeReason ?? "" })) summary.push(["明确范围排除（不计问题行）", JSON.stringify({ logicalRowId: excluded.logicalRowId, reason: excluded.excludeReason, sourceRefs: excluded.sourceRefs })]);
  }
  const globalIssues: (string | boolean | null)[][] = [["问题编号", "结果行编号", "字段", "说明", "已人工解决", "解决理由"]];
  for (const issue of version?.issues ?? []) {
    const resolution = confirmation?.resolvedIssues?.find(r => r.issueId === issue.issueId)?.resolution ?? issue.resolution;
    if (!issue.resolved && !resolution) globalIssues.push([issue.issueId, issue.rowId, issue.field, issue.message, false, null]);
  }
  const originalTables: [string, (string | number | boolean | null)[][]][] = [];
  const knownDataRefs = [...(version?.rows.flatMap(r => r.sourceRefs) ?? []), ...(confirmation?.entries.flatMap(r => r.sourceRefs ?? []) ?? []), ...(confirmation?.excludedRows.flatMap(r => r.sourceRefs ?? []) ?? [])];
  for (const [sheetIndex, group] of Array.from(originalProblems).sort((a, b) => a[0] - b[0])) {
    const sheet = originalSheets.find(s => s.sheetIndex === sheetIndex && s.sheetName === group.sheetName)!;
    // A referenced first row may be data, so never pretend it proves a header.
    const first = sheet.rows.find(r => r.rowNumber === 1);
    const ordered = Array.from(group.rows).sort((a, b) => a[0] - b[0]);
    const width = Math.max(first?.cells.length ?? 0, ...ordered.map(([, r]) => r.cells.length));
    const firstIsData = knownDataRefs.some(r => r.sheetIndex === sheetIndex && r.sheetName === group.sheetName && r.rowNumber === 1);
    const header = first && !firstIsData ? first.cells : Array.from({ length: width }, (_, i) => `原列${i + 1}`);
    const table = [[...Array.from({ length: width }, (_, i) => header[i] ?? null), "失败原因"],
      ...ordered.map(([, r]) => [...Array.from({ length: width }, (_, i) => r.cells[i] ?? null), r.reason])];
    originalTables.push([`原表问题行${sheetIndex + 1}`, table]);
  }
  const workbook = XLSX.utils.book_new();
  for (const [name, data] of [["说明", summary], ["问题行", problems], ["待核实原请求", verification], ["版本级问题", globalIssues], ...originalTables] as const) {
    if (data.some(r => r.some(c => typeof c === "string" && c.length > 32767))) throw new ChannelInventoryError("PRECONDITION_FAILED", "问题内容超过Excel单元格上限，不能截断原证据");
    // aoa_to_sheet preserves strings (including =/+/-/@) as t:s, never formulas;
    // prices/request IDs/hashes keep exact text and no links/macros are generated.
    const sheet = XLSX.utils.aoa_to_sheet(data as (string | number | boolean | null)[][]);
    sheet["!cols"] = data[0].map((_, index) => ({ wch: index === 3 ? 70 : 24 }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  const bytes = Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }));
  if (bytes.length > CUSTOMER_UPLOAD_FILE_BYTES_MAX) throw new ChannelInventoryError("PRECONDITION_FAILED", "问题Excel超过10MiB安全上限");
  const stamp = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1_$2");
  return { historyId: history.historyId, revision: history.revision, fileName: `库存_失败记录_${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64"), problemCount: problems.length - 1, verificationCount: verification.length - 1, definitiveFailedCount: 0 };
}
