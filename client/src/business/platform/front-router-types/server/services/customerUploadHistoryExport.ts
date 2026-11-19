import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { CUSTOMER_UPLOAD_FILE_BYTES_MAX, type CandidateFields, type ConfirmationDto, type CustomerUploadProblemsExportOutput, type HistoryDto, type SourceRef, type VersionDto } from "../../../shared/customerUploadHistory";
import { ChannelInventoryError } from "./channelInventory";
import { customerUploadIsSkippedProblem } from "./customerUploadHistoryValidation";

/** Pure renderer: callers must authorize the history and load its exact persisted tuple first.
 * No browser status/receipt, private locator, new request ID or stock write is accepted here.
 * There is no durable terminal-failure receipt in the current model; unknown is NOT failed.
 */
export function customerUploadProblemsWorkbook(history: HistoryDto, version: VersionDto | null, confirmation: ConfirmationDto | null): CustomerUploadProblemsExportOutput {
  const columns = ["逻辑行编号", "结果行编号", "状态", "问题或排除原因", "型号", "品牌", "数量", "批次日期", "价格", "币种", "含税", "交期", "备注", "原请求号", "原行来源证据(JSON)"];
  const problems: (string | number | boolean | null)[][] = [columns];
  const verification: (string | number | boolean | null)[][] = [columns];
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
    }
  }
  const summary: (string | number)[][] = [
    ["项目", "值"], ["历史编号", history.historyId], ["历史修订", history.revision], ["客户", history.customerName], ["原文件SHA256", history.originalFile.sha256],
    ["原正式批次编号", confirmation?.batch.id ?? ""], ["原批次业务编号", confirmation?.batch.batchCode ?? ""], ["批次状态", history.batchClosed === undefined ? "未获当前批次读取授权或尚无批次" : history.batchClosed ? "closed" : "open"],
    ["问题行数", problems.length - 1], ["待核实请求行数", verification.length - 1], ["服务端核实的终态失败行数", 0],
    ["安全说明", "问题行包含待确认或明确排除行，不等同正式入库失败。unknown必须核实原请求；成功行不导出为失败，删除不撤销成功证据。此工作簿不是可直接重导入的补发模板。"],
    ["原表覆盖说明", history.sourceCoverageWarning ?? ""],
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
  const workbook = XLSX.utils.book_new();
  for (const [name, data] of [["说明", summary], ["问题行", problems], ["待核实原请求", verification], ["版本级问题", globalIssues]] as const) {
    if (data.some(r => r.some(c => typeof c === "string" && c.length > 32767))) throw new ChannelInventoryError("PRECONDITION_FAILED", "问题内容超过Excel单元格上限，不能截断原证据");
    // aoa_to_sheet preserves strings (including =/+/-/@) as t:s, never formulas;
    // prices/request IDs/hashes keep exact text and no links/macros are generated.
    const sheet = XLSX.utils.aoa_to_sheet(data as (string | number | boolean | null)[][]);
    sheet["!cols"] = data[0].map((_, index) => ({ wch: index === 3 ? 70 : 24 }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  const bytes = Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }));
  if (bytes.length > CUSTOMER_UPLOAD_FILE_BYTES_MAX) throw new ChannelInventoryError("PRECONDITION_FAILED", "问题Excel超过10MiB安全上限");
  return { historyId: history.historyId, revision: history.revision, fileName: `customer-upload-problems-${history.historyId}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64"), problemCount: problems.length - 1, verificationCount: verification.length - 1, definitiveFailedCount: 0 };
}
