import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { candidateDraft, canonicalConfirmationPayload, confirmationIssueResolutions, downloadedFile, fileInput, originalReview, parseResult, recoveryEntries, resultSubmission, validateFile, type HistoryIssue, type OriginalSheets, type Version } from "./customerUploadHistory";
const ids = () => randomUUID();
const manifest: OriginalSheets = [{ sheetIndex: 0, sheetName: "原库存", rows: [{ rowNumber: 1, originalRowHash: "a".repeat(64), originalContent: "表头证据", cells: ["型号"] }, { rowNumber: 8, originalRowHash: "b".repeat(64), originalContent: "完整原文1", cells: ["ONE", "TI"] }] }, { sheetIndex: 1, sheetName: "第二原表", rows: [{ rowNumber: 3, originalRowHash: "c".repeat(64), originalContent: "完整原文2", cells: ["TWO"] }] }];
function workbook(rows: (string | number)[][], second = false) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "整理结果"); if (second) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "第二结果"); return new File([XLSX.write(book, { type: "array", bookType: "xlsx" })], "整理.xlsx"); }
const headers = ["型号", "品牌", "可供数量", "报价（CNY）", "币种", "税务口径", "原工作表", "原行号", "原内容"];
function row(extra: (string | number)[] = []) { return ["ONE", "TI", "100", "123456789012345.123456789012", "CNY", "含税", "原库存", "8", "完整原文1", ...extra]; }
function canonical() { return { channelId: 411, customerId: 801, expectedCustomerVersion: 4, expectedEnterpriseId: 31, expectedActorUserId: 7, sourceProfile: { type: "agent" as const, existingChannelId: 411 }, uploadBatchId: 501, requestId: ids(), partNumber: "ONE", brand: "TI", qty: null, price: "1.234567890123", currency: "CNY" as const, taxIncluded: null, dateCode: null, leadTime: null, note: null }; }
describe("customer history immutable source and explicit candidates", () => {
  it("maps real sheet/row/content rather than result-row indexes and preserves exact decimal strings", async () => { const result = await parseResult(workbook([headers, row()]), manifest); expect(result.rows[0].sourceRefs).toEqual([{ sheetIndex: 0, sheetName: "原库存", rowNumber: 8, originalRowHash: "b".repeat(64) }]); expect(result.rows[0].candidate.price).toBe("123456789012345.123456789012"); expect(result.rows[0].disposition).toBe("pending"); });
  it("uses all manifest sheets when source points to second original worksheet", async () => { const line = row(); line[6] = "第二原表"; line[7] = "3"; line[8] = "完整原文2"; const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].sourceRefs[0].sheetIndex).toBe(1); });
  it("rejects missing source columns without guessing source by row index", async () => { await expect(parseResult(workbook([["型号", "品牌"], ["ONE", "TI"]]), manifest)).rejects.toThrow("来源列"); });
  it("rejects different original content even when worksheet/row match", async () => { const line = row(); line[8] = "猜测内容"; await expect(parseResult(workbook([headers, line]), manifest)).rejects.toThrow("无法唯一匹配"); });
  it("rejects multiple result worksheets explicitly rather than dropping second sheet", async () => { await expect(parseResult(workbook([headers, row()], true), manifest)).rejects.toThrow("一张结果"); });
  it("keeps absent currency null with a required human confirmation issue", async () => { const line = row(); line[4] = ""; const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].candidate.currency).toBeNull(); expect(candidateDraft(result.rows[0].candidate).currency).toBe(""); expect(result.issues.some(issue => issue.field === "currency" && !issue.resolved)).toBe(true); });
  it("keeps USD unresolved and never silently converts foreign currency to CNY", async () => { const line = row(); line[4] = "USD"; const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].candidate.currency).toBe("USD"); expect(result.issues.some(issue => issue.field === "currency")).toBe(true); });
  it("retains unclear price/quantity/tax as null plus issues", async () => { const line = row(); line[2] = "约1万"; line[3] = "待议"; line[5] = "未知"; const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].candidate).toMatchObject({ qty: null, price: null, taxIncluded: null }); for (const field of ["qty", "price", "taxIncluded"]) expect(result.issues.some(issue => issue.field === field)).toBe(true); });
  it("retains long numeric model precision source issue", async () => { const line = row(); line[0] = 1234567890123456; const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].issues.some(issue => issue.field === "source")).toBe(true); });
  it("bounds invalid long candidate without discarding raw evidence or entire result", async () => { const line = row(); line[0] = "X".repeat(129); line[1] = "B".repeat(65); const result = await parseResult(workbook([headers, line]), manifest); expect(result.rows[0].candidate.partNumber).toBeNull(); expect(result.rows[0].candidate.brand).toBeNull(); expect(result.rows[0].sourceRefs[0].originalRowHash).toBe("b".repeat(64)); expect(result.issues.length).toBeGreaterThan(0); });
  it("preserves true original row number after sparse rows", () => { const rows = originalReview(manifest); expect(rows[0].row).toBe(8); expect(rows[0].sourceRefs[0].rowNumber).toBe(8); });
});
describe("private original uploads and canonical receipts", () => {
  it("validates parse10MiB while standard callers retain5MiB", () => { const file = new File([new Uint8Array(6 * 1024 * 1024)], "big.csv"); expect(() => validateFile(file)).not.toThrow(); expect(() => validateFile(file, 5 * 1024 * 1024)).toThrow("5MiB"); });
  it("rejects control/path filenames using the actual shared schema", async () => { await expect(fileInput(new File(["X"], "../source.csv"))).rejects.toThrow(); });
  it("uses full persisted payload identity/CAS/source during recovery", () => { const payload = canonical(); const result = recoveryEntries({ confirmationId: ids(), batchRequestId: ids(), batch: { id: 501, batchCode: ids(), revision: 1, channelId: 411, customerId: 801 }, entries: [{ logicalRowId: ids(), rowId: ids(), rowRequestId: payload.requestId, uploadBatchId: 501, payload, status: "unknown" }] }); expect(result[0].payload).toEqual(payload); expect(result[0].requestId).toBe(payload.requestId); expect(result[0].status).toBe("unknown"); });
  it("rejects generic fields payload missing server CAS and creator identity", () => { const { customerId, expectedCustomerVersion, ...payload } = canonical(); expect(() => canonicalConfirmationPayload(payload)).toThrow(); });
  it("rejects success without a real server receipt", () => { const payload = canonical(); expect(() => recoveryEntries({ confirmationId: ids(), batchRequestId: ids(), batch: { id: 501, batchCode: ids(), revision: 1, channelId: 411, customerId: 801 }, entries: [{ logicalRowId: ids(), rowId: ids(), rowRequestId: payload.requestId, uploadBatchId: 501, payload, status: "success" }] })).toThrow("回执"); });
  it("rejects mismatched original row UUID/batch membership", () => { const payload = canonical(); expect(() => recoveryEntries({ confirmationId: ids(), batchRequestId: ids(), batch: { id: 501, batchCode: ids(), revision: 1, channelId: 411, customerId: 801 }, entries: [{ logicalRowId: ids(), rowId: ids(), rowRequestId: ids(), uploadBatchId: 501, payload, status: "unknown" }] })).toThrow("UUID"); });
  it("private downloads return File bytes rather than public URLs and reject size mismatch", async () => { const file = downloadedFile({ fileName: "private.csv", mimeType: "text/csv", byteSize: 3, base64: btoa("abc") }); expect(await file.text()).toBe("abc"); expect(() => downloadedFile({ fileName: "private.csv", mimeType: "text/csv", byteSize: 4, base64: btoa("abc") })).toThrow("大小不匹配"); });
});

async function issueVersion(): Promise<Version> {
  const line = row(); line[4] = "";
  const parsed = await parseResult(workbook([headers, line]), manifest);
  return { versionId: ids(), versionNo: 1, parentVersionId: null, createdAt: new Date().toISOString(), normalizedFile: null, issuesFile: null, rows: parsed.rows, issues: [] };
}
describe("unique issue ownership and complete human disposition", () => {
  it("retains the UI aggregate and transmits edited row issues only within their row plus independent global issues", async () => {
    const v = await issueVersion(); const aggregate = v.rows.flatMap(r => r.issues);
    const global: HistoryIssue = { issueId: ids(), rowId: null, field: "other", message: "全表需核实", resolved: false, resolution: null };
    const edited = aggregate.map(issue => ({ ...issue, resolved: true, resolution: "管理员已人工核对原文件" }));
    const input = resultSubmission(v.rows, [...edited, global]);
    expect(input.issues).toEqual([global]); expect(input.rows[0].issues).toEqual(edited);
    expect(new Set([...input.issues, ...input.rows.flatMap(r => r.issues)].map(issue => issue.issueId)).size).toBe(edited.length + 1);
    expect(aggregate.every(issue => !issue.resolved)).toBe(true); expect(v.rows[0].candidate.currency).toBeNull();
  });
  it("rejects orphan row issues instead of silently discarding them", async () => {
    const v = await issueVersion();
    expect(() => resultSubmission(v.rows, [{ ...v.rows[0].issues[0], rowId: ids() }])).toThrow("不能丢弃");
  });
  it("records each issue of an explicitly excluded row without changing unknown fields or the immutable issue", async () => {
    const v = await issueVersion(); const before = structuredClone(v);
    const output = confirmationIssueResolutions(v, [], [{ logicalRowId: v.rows[0].logicalRowId, reason: "原币种无法核实，本次不入库" }]);
    expect(output).toEqual(v.rows[0].issues.map(issue => ({ issueId: issue.issueId, resolution: "明确排除此行：原币种无法核实，本次不入库" })));
    expect(v).toEqual(before);
  });
  it("includes version-original excluded rows even when excluded metadata is absent", async () => {
    const v = await issueVersion(); v.rows[0].disposition = "excluded"; v.rows[0].excludeReason = "人工确认非供货报价";
    expect(confirmationIssueResolutions(v, [], [{ logicalRowId: v.rows[0].logicalRowId, reason: v.rows[0].excludeReason }])).toEqual(v.rows[0].issues.map(issue => ({ issueId: issue.issueId, resolution: "明确排除此行：人工确认非供货报价" })));
  });
  it("preserves original and locally edited manual resolutions rather than replacing them with exclusion text", async () => {
    const v = await issueVersion(); const issue = v.rows[0].issues[0];
    issue.resolved = true; issue.resolution = "原版本人工核对依据";
    const output = confirmationIssueResolutions(v, [{ issues: [{ ...issue }] }], [{ logicalRowId: v.rows[0].logicalRowId, reason: "本次不入库" }]);
    expect(output).toEqual([{ issueId: issue.issueId, resolution: "原版本人工核对依据" }]);
    issue.resolved = false; issue.resolution = null;
    expect(confirmationIssueResolutions(v, [{ issues: [{ ...issue, resolved: true, resolution: "员工已核对为外币" }] }], [{ logicalRowId: v.rows[0].logicalRowId, reason: "本次不入库" }])).toEqual([{ issueId: issue.issueId, resolution: "员工已核对为外币" }]);
  });
  it("never resolves an unknown global issue using an excluded row reason", async () => {
    const v = await issueVersion(); const global: HistoryIssue = { issueId: ids(), rowId: null, field: "other", message: "全表范围待确认", resolved: false, resolution: null }; v.issues = [global];
    const excluded = [{ logicalRowId: v.rows[0].logicalRowId, reason: "本行不入库" }];
    expect(() => confirmationIssueResolutions(v, [], excluded)).toThrow("全局");
    const output = confirmationIssueResolutions(v, [], excluded, [{ issueId: global.issueId, resolution: "员工核对全部来源与本次范围" }]);
    expect(output).toContainEqual({ issueId: global.issueId, resolution: "员工核对全部来源与本次范围" });
  });
  it("deduplicates the same ID/reason and rejects differing evidence or foreign IDs", async () => {
    const v = await issueVersion(); const issue = { ...v.rows[0].issues[0], resolved: true, resolution: "员工人工依据" };
    expect(confirmationIssueResolutions(v, [{ issues: [issue, { ...issue }] }], [])).toEqual([{ issueId: issue.issueId, resolution: "员工人工依据" }]);
    expect(() => confirmationIssueResolutions(v, [{ issues: [issue, { ...issue, resolution: "另一依据" }] }], [])).toThrow("不同处置依据");
    expect(() => confirmationIssueResolutions(v, [], [], [{ issueId: ids(), resolution: "外部ID" }])).toThrow("不属于");
    expect(() => confirmationIssueResolutions(v, [], [])).toThrow("所有待确认");
  });
  it("rejects blank or oversized exclusions without truncating evidence", async () => {
    const v = await issueVersion();
    for (const reason of [" ", "X".repeat(1001)]) expect(() => confirmationIssueResolutions(v, [], [{ logicalRowId: v.rows[0].logicalRowId, reason }])).toThrow();
    const reason = "员工明确排除：".padEnd(1000, "据");
    expect(confirmationIssueResolutions(v, [], [{ logicalRowId: v.rows[0].logicalRowId, reason }])).toEqual(v.rows[0].issues.map(issue => ({ issueId: issue.issueId, resolution: reason })));
  });
});
