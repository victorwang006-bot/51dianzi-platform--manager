import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { CandidateFields, ConfirmationDto, HistoryDto, OriginalWorkbookManifest, SourceRef, VersionDto } from "../client/src/business/platform/shared/customerUploadHistory";
vi.mock("../client/src/business/platform/front-router-types/server/services/channelInventory", () => ({
  ChannelInventoryError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
import { customerUploadProblemsWorkbook } from "../client/src/business/platform/front-router-types/server/services/customerUploadHistoryExport";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const file = { fileId: uuid(2), kind: "original" as const, fileName: "库存.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteSize: 50, sha256: "a".repeat(64), createdAt: "2026-11-19T00:00:00.000Z" };
const history = { historyId: uuid(1), customerId: 1, customerName: "测试客户", revision: 2, originalFile: file, stats: {}, capabilities: {} } as HistoryDto;
const fields: CandidateFields = { partNumber: "A", brand: "TI", qty: 2, dateCode: null, price: "0.000000000001", currency: "CNY", taxIncluded: null, leadTime: null, note: "修改后的备注" };
function source(rowNumber: number, cells: (string | number | null)[]) {
  const originalContent = JSON.stringify(cells);
  return { rowNumber, cells, originalContent, originalRowHash: createHash("sha256").update(originalContent).digest("hex") };
}
const first = source(1, ["品牌", "型号", "币种", "数量", "附注"]);
const bad = source(2, ["TI", "A", "USD", 2, "=HYPERLINK(\"unsafe\")"]);
const good = source(3, ["ST", "B", "CNY", 3, "成功行不导出"]);
const sheets: OriginalWorkbookManifest["sheets"] = [{ sheetIndex: 0, sheetName: "物料", rows: [first, bad, good] }];
const ref = (r: typeof bad): SourceRef => ({ sheetIndex: 0, sheetName: "物料", rowNumber: r.rowNumber, originalRowHash: r.originalRowHash });
const cf = (): ConfirmationDto => ({ confirmationId: uuid(3), versionId: null, batchRequestId: uuid(4), batch: { id: 7, channelId: 8, customerId: 1, batchCode: "original", revision: 1 }, entries: [], excludedRows: [{ logicalRowId: uuid(5), reason: "跳过问题行：币种仅支持CNY", sourceRefs: [ref(bad)] }], createdAt: "2026-11-19T00:00:00.000Z" });
const book = (out: ReturnType<typeof customerUploadProblemsWorkbook>) => XLSX.read(Buffer.from(out.base64, "base64"), { type: "buffer" });
const grid = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

describe("customer upload read-only problem export", () => {
  it("preserves standard upload material fields, non-mapped columns and exact original order without a version", () => {
    const confirmation = cf();
    confirmation.entries.push({ logicalRowId: uuid(6), rowId: uuid(7), rowRequestId: uuid(8), uploadBatchId: 7, status: "success", sourceRefs: [ref(good)], payload: { ...fields, partNumber: "B", brand: "ST", customerId: 1, channelId: 8, expectedCustomerVersion: 3, requestId: uuid(8) } as never });
    const out = customerUploadProblemsWorkbook(history, null, confirmation, sheets);
    expect(out).toMatchObject({ problemCount: 1, verificationCount: 0, definitiveFailedCount: 0 });
    expect(out.fileName).toMatch(/^库存_失败记录_\d{8}_\d{4}\.xlsx$/);
    const ws = book(out).Sheets["原表问题行1"];
    expect(grid(ws)).toEqual([["品牌", "型号", "币种", "数量", "附注", "失败原因"], ["TI", "A", "USD", 2, "=HYPERLINK(\"unsafe\")", "跳过问题行：币种仅支持CNY"]]);
    expect(ws.E2).toMatchObject({ t: "s", v: "=HYPERLINK(\"unsafe\")" });
    expect(ws.E2).not.toHaveProperty("f");
  });
  it("keeps already-persisted corrected fields in the audit sheet as well as original evidence", () => {
    const version = { versionId: uuid(9), rows: [{ rowId: uuid(10), logicalRowId: uuid(5), candidate: fields, disposition: "pending", excludeReason: null, sourceRefs: [ref(bad)], issues: [] }], issues: [] } as unknown as VersionDto;
    const out = customerUploadProblemsWorkbook(history, version, null, sheets);
    const wb = book(out);
    expect(wb.Sheets["问题行"].H2).toBeUndefined();
    expect(wb.Sheets["问题行"].I2.v).toBe("0.000000000001");
    expect(wb.Sheets["问题行"].M2.v).toBe("修改后的备注");
    expect(wb.Sheets["原表问题行1"].E2.v).toBe("=HYPERLINK(\"unsafe\")");
  });
  it("uses an explicit standard audit fallback when old records contain no original column evidence", () => {
    const out = customerUploadProblemsWorkbook(history, null, cf());
    const wb = book(out);
    expect(wb.SheetNames).not.toContain("原表问题行1");
    expect(JSON.stringify(grid(wb.Sheets["说明"]))).toContain("旧记录无原列证据");
    expect(out.problemCount).toBe(1);
  });
  it("rejects altered or ambiguous physical row evidence instead of guessing original fields", () => {
    const changed = structuredClone(sheets); changed[0].rows[1].originalContent = "altered";
    expect(() => customerUploadProblemsWorkbook(history, null, cf(), changed)).toThrow("原行证据缺失或存在歧义");
    const ambiguous = structuredClone(sheets); ambiguous[0].rows.push(bad);
    expect(() => customerUploadProblemsWorkbook(history, null, cf(), ambiguous)).toThrow("原行证据缺失或存在歧义");
  });
  it("separates unknown canonical requests from failed/problem rows and retains their original UUID", () => {
    const confirmation = cf();
    confirmation.entries.push({ logicalRowId: uuid(11), rowId: uuid(12), rowRequestId: uuid(13), uploadBatchId: 7, status: "unknown", sourceRefs: [ref(good)], payload: { ...fields, customerId: 1, channelId: 8, expectedCustomerVersion: 3, requestId: uuid(13) } as never });
    const out = customerUploadProblemsWorkbook(history, null, confirmation, sheets);
    const wb = book(out);
    expect(out.verificationCount).toBe(1);
    expect(wb.Sheets["待核实原请求"].N2.v).toBe(uuid(13));
    expect(grid(wb.Sheets["原表问题行1"])).toHaveLength(2);
    expect(out.definitiveFailedCount).toBe(0);
  });
  it("preserves each real worksheet independently without combining different column orders", () => {
    const another = source(2, ["C", "NXP", "USD", "额外字段"]);
    const all = [...sheets, { sheetIndex: 2, sheetName: "第二页", rows: [source(1, ["型号", "品牌", "币种", "自定义"]), another] }];
    const confirmation = cf();
    confirmation.excludedRows.push({ logicalRowId: uuid(14), reason: "跳过问题行：外币", sourceRefs: [{ sheetIndex: 2, sheetName: "第二页", rowNumber: 2, originalRowHash: another.originalRowHash }] });
    const wb = book(customerUploadProblemsWorkbook(history, null, confirmation, all));
    expect(grid(wb.Sheets["原表问题行3"])[0]).toEqual(["型号", "品牌", "币种", "自定义", "失败原因"]);
    expect(wb.Sheets["原表问题行3"].D2.v).toBe("额外字段");
  });
});
