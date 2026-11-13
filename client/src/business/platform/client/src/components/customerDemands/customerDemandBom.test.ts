import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  appendDemandBomItems, assertDemandBomFile, createDemandBomTemplate,
  DEMAND_BOM_MAX_BYTES, DEMAND_BOM_MAX_COLUMNS, DEMAND_BOM_MAX_ROWS,
  demandBomDuplicateParts, demandBomMappingError, demandBomRemainingCapacity,
  mapDemandBomRows, readDemandBomSheet, readDemandBomSheetNames,
  suggestDemandBomHeader, suggestDemandBomMapping, validateDemandBomDraft,
  type DemandBomDraft,
} from "./customerDemandBom";
import { customerDemandSaveSchema, emptyCustomerDemandItem } from "../../../../shared/customerDemands";

function bytes(rows: unknown[][], bookType: XLSX.BookType = "xlsx") {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "BOM");
  return XLSX.write(book, { type: "array", bookType }) as ArrayBuffer;
}
function parse(rows: unknown[][], bookType: XLSX.BookType = "xlsx") {
  const sheet = readDemandBomSheet(XLSX, bytes(rows, bookType), "BOM");
  const header = suggestDemandBomHeader(sheet);
  return mapDemandBomRows(sheet, header, suggestDemandBomMapping(sheet.rows[header].map(cell => cell.text)));
}
function draft(values: Partial<DemandBomDraft["values"]> = {}): DemandBomDraft {
  return { sourceRow: 2, formulaFields: [], values: { partNumber: "SYNTHETIC", brand: "", pkg: "", qty: "1", qtyUnit: "片", deliveryRequirement: "", note: "", ...values } };
}

describe("客户需求BOM有界本地解析", () => {
  it.each(["xlsx", "xls"] as const)("reads real %s bytes, Chinese/English aliases, blank/title rows and whitelist only", type => {
    const rows = parse([
      ["客户提供的BOM"],
      ["Part Number", "Manufacturer", "Package", "Qty", "UOM", "Required Date", "Notes", "联系人", "电话"],
      ["000123", "TEST", "QFN", 1000, "PCS", "2026-12-01", "仅物料信息", "不应导入", "13800000000"],
      [],
      ["", "", "", "", "", "", "", "仅额外信息", "13900000000"],
      ["TEST-2", "", "", 2, "", "", ""],
    ], type);
    expect(rows.map(row => row.sourceRow)).toEqual([3, 6]);
    const result = validateDemandBomDraft(rows[0]);
    expect(result.item).toEqual({ partNumber: "000123", brand: "TEST", pkg: "QFN", qty: 1000, qtyUnit: "片", deliveryRequirement: "2026-12-01", note: "仅物料信息" });
    expect(JSON.stringify(rows)).not.toContain("13800000000"); expect(JSON.stringify(rows)).not.toContain("不应导入");
    expect(validateDemandBomDraft(rows[1]).item?.qtyUnit).toBe("片");
  });
  it("preserves Excel formatted numeric part numbers and date delivery requirements", () => {
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([["料号", "数量", "要求交期"], [123, 12, 46357]]);
    sheet.A2.z = "000000"; sheet.C2.z = "yyyy-mm-dd";
    XLSX.utils.book_append_sheet(book, sheet, "BOM");
    const parsed = readDemandBomSheet(XLSX, XLSX.write(book, { type: "array", bookType: "xlsx" }), "BOM");
    const rows = mapDemandBomRows(parsed, 0, suggestDemandBomMapping(["料号", "数量", "要求交期"]));
    expect(rows[0].values.partNumber).toBe("000123"); expect(rows[0].values.deliveryRequirement).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("supports manual non-standard columns and rejects ambiguous or reused mappings", () => {
    const mapping = suggestDemandBomMapping(["料号", "数量", "Qty", "电话"]);
    expect(mapping.qty).toBeNull(); expect(demandBomMappingError(mapping)).toContain("型号和数量");
    expect(demandBomMappingError({ ...mapping, qty: 0 })).toContain("同一来源列");
    const sheet = readDemandBomSheet(XLSX, bytes([["客户编码", "申请量", "电话"], ["CUSTOM-1", 5, "13800000000"]]), "BOM");
    const rows = mapDemandBomRows(sheet, 0, { ...suggestDemandBomMapping([]), partNumber: 0, qty: 1 });
    expect(validateDemandBomDraft(rows[0]).item?.partNumber).toBe("CUSTOM-1"); expect(rows[0].values.note).toBe("");
  });
  it("does not evaluate formulas, even formulas with cached values; correction clears the error", () => {
    const rows = parse([["型号", "数量", "备注"], ["TEST", { t: "n", f: "1+1", v: 2 }, { t: "s", f: '"TEST"', v: "TEST" }]]);
    expect(validateDemandBomDraft(rows[0]).errors).toMatchObject({ qty: expect.stringContaining("公式"), note: expect.stringContaining("公式") });
    expect(validateDemandBomDraft({ ...rows[0], formulaFields: [] }).item?.qty).toBe(2);
  });
  it("rejects invalid, empty, oversized files before parsing", () => {
    expect(() => assertDemandBomFile({ name: "BOM.csv", size: 1 })).toThrow("仅支持");
    expect(() => assertDemandBomFile({ name: "BOM.xlsx", size: 0 })).toThrow("为空");
    expect(() => assertDemandBomFile({ name: "BOM.XLS", size: DEMAND_BOM_MAX_BYTES + 1 })).toThrow("5MB");
    expect(() => readDemandBomSheetNames(XLSX, new ArrayBuffer(0))).toThrow();
  });
  it("rejects renamed text, malformed ZIP and excessive declared expansion before XML parsing", () => {
    expect(() => readDemandBomSheetNames(XLSX, new TextEncoder().encode("型号,数量\nTEST,1").buffer)).toThrow("不是有效的");
    expect(() => readDemandBomSheetNames(XLSX, new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)).toThrow("不完整");
    const payload = bytes([["型号", "数量"], ["TEST", 1]]);
    const view = new DataView(payload);
    let directory = -1;
    for (let offset = 0; offset < payload.byteLength - 46; offset++) if (view.getUint32(offset, true) === 0x02014b50) { directory = offset; break; }
    expect(directory).toBeGreaterThanOrEqual(0);
    view.setUint32(directory + 24, 17 * 1024 * 1024, true);
    expect(() => readDemandBomSheetNames(XLSX, payload)).toThrow("解压内容过大");
  });
  it("rejects the declared full range beyond the row/column limits instead of silently truncating", () => {
    const oversizedRows = [["型号", "数量"], ...Array.from({ length: DEMAND_BOM_MAX_ROWS + 1 }, (_, index) => [`S-${index}`, 1])];
    expect(() => readDemandBomSheet(XLSX, bytes(oversizedRows), "BOM")).toThrow("工作表范围过大");
    const oversizedColumns = [Array.from({ length: DEMAND_BOM_MAX_COLUMNS + 1 }, (_, index) => `列${index}`), ["TEST", 1]];
    expect(() => readDemandBomSheet(XLSX, bytes(oversizedColumns), "BOM")).toThrow("工作表范围过大");
    expect(parse([["型号", "数量"], ...Array.from({ length: DEMAND_BOM_MAX_ROWS }, (_, index) => [`S-${index}`, 1])])).toHaveLength(DEMAND_BOM_MAX_ROWS);
  });
  it("limits worksheet count and parses only the selected sheet", () => {
    const book = XLSX.utils.book_new();
    for (let index = 0; index < 21; index++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "数量"], [`S-${index}`, 1]]), `S${index}`);
    expect(() => readDemandBomSheetNames(XLSX, XLSX.write(book, { type: "array", bookType: "xlsx" }))).toThrow("20");
    expect(readDemandBomSheet(XLSX, XLSX.write(book, { type: "array", bookType: "xls" }), "S2").rows[1][0].text).toBe("S-2");
  });
  it("creates a round-trippable 7-field template with separate instructions", () => {
    const book = createDemandBomTemplate(XLSX);
    expect(book.SheetNames).toEqual(["客户需求BOM", "填写说明"]);
    const parsed = readDemandBomSheet(XLSX, XLSX.write(book, { type: "array", bookType: "xlsx" }), "客户需求BOM");
    expect(parsed.rows[0].map(cell => cell.text)).toEqual(["型号", "品牌", "封装", "数量", "单位", "要求交期", "备注"]);
    expect(parsed.rows[1][0].text).toContain("请删除此行");
  });
});

describe("BOM字段校验、草稿与不覆盖追加", () => {
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e3", "10片", "1,00", "2147483648"])("rejects quantity %s even in draft mode", qty => {
    expect(validateDemandBomDraft(draft({ qty }), true).item).toBeNull();
    expect(validateDemandBomDraft(draft({ qty }), true).errors.qty).toBeTruthy();
  });
  it.each([["1,000", 1000], ["2.00", 2], ["2147483647", 2147483647], [" 5 ", 5]] as const)("accepts positive integer quantity %s", (qty, expected) => {
    expect(validateDemandBomDraft(draft({ qty })).item?.qty).toBe(expected);
  });
  it("requires model/quantity unless explicitly importing incomplete drafts; shared submission rules remain authoritative", () => {
    const incomplete = draft({ partNumber: "", qty: "", brand: "TEST" });
    expect(validateDemandBomDraft(incomplete).errors).toMatchObject({ partNumber: expect.any(String), qty: expect.any(String) });
    const item = validateDemandBomDraft(incomplete, true).item!; expect(item).not.toBeNull();
    const candidate = { customerId: 12, requestId: "synthetic-test-id", data: { projectName: "", priority: "normal", replyDueAt: null, note: "", items: [item] } };
    expect(customerDemandSaveSchema.safeParse({ ...candidate, intent: "draft" }).success).toBe(true);
    expect(customerDemandSaveSchema.safeParse({ ...candidate, intent: "submit" }).success).toBe(false);
    expect(validateDemandBomDraft(draft({ partNumber: "", qty: "" }), true).item).toBeNull();
  });
  it("enforces lengths and units without truncating data", () => {
    expect(validateDemandBomDraft(draft({ partNumber: "X".repeat(129), brand: "X".repeat(65), pkg: "X".repeat(65), deliveryRequirement: "X".repeat(81), note: "X".repeat(501), qtyUnit: "公斤" })).errors).toEqual({ partNumber: expect.any(String), brand: expect.any(String), pkg: expect.any(String), deliveryRequirement: expect.any(String), note: expect.any(String), qtyUnit: expect.any(String) });
    expect(validateDemandBomDraft(draft({ qtyUnit: "EA" })).item?.qtyUnit).toBe("个");
  });
  it("warns for duplicate models but retains all rows and stable IDs unchanged", () => {
    const existing = [{ ...emptyCustomerDemandItem(), id: 401, partNumber: "TEST", qty: 1 }];
    const imported = [{ ...emptyCustomerDemandItem(), partNumber: "test", qty: 2 }, { ...emptyCustomerDemandItem(), partNumber: "test", qty: 3 }];
    const merged = appendDemandBomItems(existing, imported);
    expect(merged).toHaveLength(3); expect(merged[0]).toBe(existing[0]); expect(merged[0].id).toBe(401);
    expect(demandBomDuplicateParts(imported, existing)).toEqual(["test"]);
  });
  it("replaces only a lone unsaved default blank, never persisted/partially filled rows", () => {
    const imported = [{ ...emptyCustomerDemandItem(), partNumber: "TEST", qty: 2 }];
    expect(appendDemandBomItems([emptyCustomerDemandItem()], imported)).toEqual(imported);
    expect(demandBomRemainingCapacity([emptyCustomerDemandItem()])).toBe(100);
    for (const row of [{ ...emptyCustomerDemandItem(), id: 1 }, { ...emptyCustomerDemandItem(), note: "保留" }, { ...emptyCustomerDemandItem(), qtyUnit: "颗" as const }]) expect(appendDemandBomItems([row], imported)).toHaveLength(2);
    expect(appendDemandBomItems([emptyCustomerDemandItem(), emptyCustomerDemandItem()], imported)).toHaveLength(3);
  });
  it("enforces 100 final rows, including existing rows, and never imports nothing", () => {
    const imported = Array.from({ length: 100 }, () => ({ ...emptyCustomerDemandItem(), partNumber: "TEST", qty: 2 }));
    expect(appendDemandBomItems([emptyCustomerDemandItem()], imported)).toHaveLength(100);
    expect(() => appendDemandBomItems([{ ...emptyCustomerDemandItem(), id: 401 }], imported)).toThrow("最多 100 行");
    expect(() => appendDemandBomItems([emptyCustomerDemandItem()], [])).toThrow("至少");
  });
});
