// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applySuggestion, chunks, clearRequestHold, csvString, emptyForm, errorRowsCsv, firstEligibleQuote, formData, formFor, fromExcel, IMPORT_BATCH_SIZE, isBusinessRejection, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseDelimited, parseImportFile, parseImportText, parseTiers, publishProblem, readRequestHold, rowsFromTable, safeCsvCell, storeRequestHold, TEMPLATE_COLUMNS, templateCsv, validMutationResult } from "./officialMallImport";
import type { Form } from "./officialMallImport";
import type { OfficialMallMaterialInput } from "@shared/officialMall";
const form = (overrides: Partial<Form> = {}): Form => ({ ...emptyForm(), partNumber: "LOCAL-ONLY", brand: "LOCAL-BRAND", ...overrides });
const data = (overrides: Partial<OfficialMallMaterialInput> = {}) => formData(formFor({ ...formData(form()), ...overrides }));
function workbookBuffer(matrix: unknown[][], change?: (sheet: XLSX.WorkSheet) => void): ArrayBuffer {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(matrix);
  change?.(sheet); XLSX.utils.book_append_sheet(book, sheet, "物料");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
beforeEach(() => sessionStorage.clear());
describe("native official mall exact form and price", () => {
  it("keeps all unknown numbers, tax and price null; draft only requires metadata", () => {
    expect(formData(form())).toMatchObject({ qtyStock: null, qtyOnSale: null, qtyOrder: null, priceEx: null, taxIncluded: null, moq: null, spq: null, ladderPrices: [] });
  });
  it("never fills actual inventory from on-sale quantity", () => expect(formData(form({ qtyOnSale: "40" })).qtyStock).toBeNull());
  it("preserves exact string prices and trailing zeros in both directions", () => {
    const input = form({ priceEx: "123456789012.123400", tiers: [{ minQty: "1", price: "0.123450" }] });
    expect(formData(input).priceEx).toBe("123456789012.123400"); expect(formFor(formData(input)).tiers).toEqual(input.tiers);
  });
  it.each(["1e2", "-1", "1.1234567", "1,200", "NaN", "Infinity", "1234567890123", ".5"])("rejects ambiguous or overprecision price %s", priceEx => expect(() => formData(form({ priceEx }))).toThrow("精确十进制"));
  it.each(["-1", "1.2", "1e2", "2147483648"])("rejects invalid quantities %s", qtyStock => expect(() => formData(form({ qtyStock }))).toThrow("整数"));
  it("validates explicit real stock boundary", () => expect(() => formData(form({ qtyStock: "10", qtyOnSale: "11" }))).toThrow("实际库存"));
  it("keeps zero stock distinguishable from unknown", () => expect(formData(form({ qtyStock: "0" })).qtyStock).toBe(0));
  it("validates pairs, order, positive prices and ten-tier limit", () => {
    expect(() => parseTiers([{ minQty: "1", price: "" }])).toThrow("同时填写");
    expect(() => parseTiers([{ minQty: "1", price: "1" }, { minQty: "1", price: ".1" }])).toThrow();
    expect(() => parseTiers([{ minQty: "10", price: "1" }, { minQty: "2", price: "1" }])).toThrow("递增");
    expect(() => parseTiers([{ minQty: "1", price: "0" }])).toThrow("大于0");
    expect(() => parseTiers(Array.from({ length: 11 }, () => ({ minQty: "1", price: "1" })))).toThrow("10档");
    expect(parseTiers([{ minQty: "", price: "" }])).toEqual([]);
  });
  it("adapts default order by MOQ/SPQ, then picks the actual threshold (not cheapest)", () => {
    expect(firstEligibleQuote(data({ moq: 101, spq: 50, priceEx: "9.000000", ladderPrices: [{ minQty: 1, price: "8" }, { minQty: 100, price: "5.120000" }, { minQty: 200, price: "2" }] }))).toEqual({ quantity: 150, price: "5.120000" });
  });
  it("accepts MOQ999/SPQ250 and threshold quantities below MOQ or not divisible by SPQ", () => {
    const row = data({ moq: 999, spq: 250, ladderPrices: [{ minQty: 7, price: "5" }, { minQty: 999, price: "1.230000" }] });
    expect(row.ladderPrices.map(t => t.minQty)).toEqual([7, 999]); expect(firstEligibleQuote(row)).toEqual({ quantity: 1000, price: "1.230000" });
  });
  it("does not pretend default order qualifies for the first ladder", () => {
    expect(firstEligibleQuote(data({ priceEx: "7", ladderPrices: [{ minQty: 100, price: "1" }] }))).toEqual({ quantity: 1, price: "7" });
    expect(firstEligibleQuote(data({ ladderPrices: [{ minQty: 100, price: "1" }] }))).toEqual({ quantity: 1, price: null });
  });
  it("validates publish quantity and lead time while preserving unknown stock/tax for inquiry", () => {
    expect(publishProblem(data())).toContain("数量");
    expect(publishProblem(data({ qtyOnSale: 1 }))).toContain("货期");
    expect(publishProblem(data({ qtyOrder: 1, leadTime: "人工确认7天", taxIncluded: null, priceEx: "0.120000" }))).toBeNull();
    expect(publishProblem(data({ qtyOnSale: 1, qtyStock: null, leadTime: "现货", taxIncluded: false }))).toBeNull();
  });
  it("suggestions fill exactly metadata, never quantities, tax, prices or lead time", () => {
    const original = form({ qtyStock: "42", qtyOnSale: "9", priceEx: "1.234500", leadTime: "7天", taxIncluded: false, tiers: [{ minQty: "10", price: "1.230000" }] });
    const result = applySuggestion(original, { partNumber: "CHOSEN", brand: "CHOSEN-BRAND", pkg: "QFN" });
    expect(result).toEqual({ ...original, partNumber: "CHOSEN", brand: "CHOSEN-BRAND", pkg: "QFN" });
  });
});
describe("deterministic CSV / XLSX / supplier recognition", () => {
  it("matches English/Chinese headers and retains precise prices without auto sale", () => {
    const [row] = rowsFromTable(parseImportText('MPN,Manufacturer,package,库存,单价,含税\r\nLOCAL,BRAND,QFN,40,1.234500,否'));
    expect(row.errors).toEqual([]); expect(row.data).toMatchObject({ partNumber: "LOCAL", brand: "BRAND", pkg: "QFN", qtyStock: 40, qtyOnSale: null, priceEx: "1.234500", taxIncluded: false });
  });
  it("supports quoted commas, escaped quotes and embedded newlines", () => {
    expect(parseDelimited('型号,品牌,备注\r\nLOCAL,"B,R","one""two\nthree"')).toEqual([["型号", "品牌", "备注"], ["LOCAL", "B,R", 'one"two\nthree']]);
  });
  it("supports multirow Excel paste and full paired ladders", () => {
    const rows = rowsFromTable(fromExcel("型号\t品牌\t阶梯数量1\t阶梯单价1\t阶梯数量2\t阶梯单价2\nA\tB\t1\t1.230000\t20\t0.900001\nC\tD\t10\t0.01\t\t"));
    expect(rows).toHaveLength(2); expect(rows[0].data?.ladderPrices).toEqual([{ minQty: 1, price: "1.230000" }, { minQty: 20, price: "0.900001" }]);
  });
  it("recognizes only explicit labelled supplier fields, with manual unknowns", () => {
    const rows = rowsFromTable(parseImportText("型号：LOCAL-A\n品牌：LOCAL-B\n库存：200\n单价：面议\n\n型号：LOCAL-C\n品牌：LOCAL-D\n库存：0\n单价：0.120000"));
    expect(rows).toHaveLength(2); expect(rows[0].data).toMatchObject({ qtyStock: 200, qtyOnSale: null, priceEx: null, leadTime: "", taxIncluded: null });
  });
  it("recognizes explicit supplier fields separated by semicolons without guessing values", () => {
    const [row] = rowsFromTable(parseImportText("型号:LOCAL;品牌:BRAND;库存:0;单价:0.000123;含税:否"));
    expect(row.errors).toEqual([]); expect(row.data).toMatchObject({ partNumber: "LOCAL", brand: "BRAND", qtyStock: 0, qtyOnSale: null, priceEx: "0.000123", taxIncluded: false });
  });
  it("reports non-UTF8 CSV clearly rather than guessing source encoding", () => {
    expect(() => parseImportFile("local.csv", new Uint8Array([0xff, 0xff]).buffer)).toThrow("UTF-8");
  });
  it("marks undetermined prose fields instead of guessing SKU/brand/stock/prices", () => {
    const [row] = rowsFromTable(parseImportText("LOCAL-PART   未知来源   10K   特价"));
    expect(row.errors.join("；")).toContain("无法确定型号列"); expect(row.errors.join("；")).toContain("不会猜测品牌"); expect(row.form.qtyStock).toBe(""); expect(row.form.priceEx).toBe("");
  });
  it("allows explicit mapping of headerless rows", () => {
    const table = parseImportText("LOCAL\tBRAND\tQFN\t200\nLOCAL2\tBRAND2\tSOT\t0");
    expect(table.mapping).toEqual([null, null, null, null]);
    expect(rowsFromTable(table, ["partNumber", "brand", "pkg", "qtyStock"])[0].data?.qtyStock).toBe(200);
  });
  it("rejects duplicate mappings, unknown taxes and half-price ladders", () => {
    expect(rowsFromTable(parseImportText("型号,品牌,税口径\nA,B,大概含税"))[0].errors.join("；")).toContain("不能猜测");
    expect(rowsFromTable(parseImportText("型号,品牌,阶梯数量1\nA,B,10"))[0].errors.join("；")).toContain("同时填写");
    const table = parseImportText("型号,品牌,单价\nA,B,1"); expect(rowsFromTable(table, ["partNumber", "brand", "partNumber"])[0].errors.join("；")).toContain("重复映射");
  });
  it("never accepts quantity abbreviations or currency guesses", () => expect(rowsFromTable(parseImportText("型号,品牌,库存,单价\nA,B,10K,USD1"))[0].errors.length).toBeGreaterThan(0));
  it("reads XLSX values without evaluating formulas or using cached formula results", () => {
    const buffer = workbookBuffer([["型号", "品牌", "库存", "单价"], ["A", "B", 100, 5]], sheet => { sheet.D2 = { t: "n", v: 5, f: "2+3" }; });
    const [row] = rowsFromTable(parseImportFile("local.xlsx", buffer));
    expect(row.errors.join("；")).toContain("包含公式"); expect(row.data).toBeUndefined(); expect(row.form.priceEx).not.toBe("5");
  });
  it("retains all-formula rows as errors rather than silently omitting them", () => {
    const buffer = workbookBuffer([["型号", "品牌"], ["", ""]], sheet => { sheet.A2 = { t: "n", v: 1, f: "1+0" }; sheet.B2 = { t: "n", v: 2, f: "1+1" }; });
    expect(rowsFromTable(parseImportFile("local.xlsx", buffer))[0].errors.join("；")).toContain("公式");
  });
  it("reads string decimals and actual-zero XLSX values accurately", () => {
    const [row] = rowsFromTable(parseImportFile("local.xlsx", workbookBuffer([["型号", "品牌", "实际库存", "基础价"], ["A", "B", 0, "0.000123"]])));
    expect(row.data).toMatchObject({ qtyStock: 0, priceEx: "0.000123" });
  });
  it("rejects macro extensions and over-5MiB files", () => {
    expect(() => parseImportFile("local.xlsm", new ArrayBuffer(10))).toThrow("宏");
    expect(() => parseImportFile("local.csv", new ArrayBuffer(MAX_IMPORT_BYTES + 1))).toThrow("5MiB");
  });
  it("enforces 2000-row file/text bound without truncation", () => {
    const text = "型号,品牌\n" + Array.from({ length: MAX_IMPORT_ROWS }, () => "A,B").join("\n");
    expect(rowsFromTable(parseImportText(text))).toHaveLength(2000);
    expect(() => parseImportText(text + "\nA,B")).toThrow("2000");
    expect(() => parseImportFile("local.xlsx", workbookBuffer([["型号", "品牌"], ...Array.from({ length: 2001 }, () => ["A", "B"])]))).toThrow("2000");
  });
  it("rejects empty/unclosed inputs and more than one worksheet", () => {
    expect(() => parseImportText("  ")).toThrow("粘贴"); expect(() => parseImportText("型号,品牌")).toThrow("表头");
    expect(() => parseDelimited('型号,品牌\nA,"B')).toThrow("引号");
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["A", "B"]]), "one"); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["A"]]), "two");
    expect(() => parseImportFile("local.xlsx", XLSX.write(book, { type: "array", bookType: "xlsx" }))).toThrow("一个");
  });
  it("CSV exports quote safely and prevent formula injection, including leading whitespace", () => {
    expect(safeCsvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(safeCsvCell("  +1")).toBe('"\'  +1"'); expect(safeCsvCell("@cmd")).toBe('"\'@cmd"');
    expect(csvString([["a,b", 'a"b', "a\nb"]])).toBe('\uFEFF"a,b","a""b","a\nb"\r\n');
  });
  it("downloads an empty fixed full template with 10 paired ladders, no demo row", () => {
    const template = parseDelimited(templateCsv()); expect(template).toHaveLength(1); expect(TEMPLATE_COLUMNS).toHaveLength(32); expect(template[0].slice(-2)).toEqual(["阶梯数量10", "阶梯单价10"]);
  });
  it("exports only provided error rows and safely handles malicious metadata", () => {
    const text = errorRowsCsv([{ rowNumber: 2, form: form({ partNumber: "=BAD", tiers: [{ minQty: "10", price: "0.120000" }] }), errors: ['err "quote"'] }]);
    expect(text).toContain("'=BAD"); expect(text).toContain("0.120000"); expect(parseDelimited(text)).toHaveLength(2);
  });
});
describe("native failure and receipt discipline", () => {
  it("chunks preview and import without duplicating data", () => { expect(IMPORT_BATCH_SIZE).toBe(100); expect(chunks(Array.from({ length: 501 }, (_, i) => i), 500).map(r => r.length)).toEqual([500, 1]); expect(chunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]); expect(() => chunks([1], 0)).toThrow(); });
  it.each(["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"])("recognizes explicit native business refusal %s", code => expect(isBusinessRejection(Object.assign(new Error("specific original"), { data: { code } }))).toBe(true));
  it("does not treat network/5xx/auth ambiguity as safe to resend", () => { expect(isBusinessRejection(new Error("timeout"))).toBe(false); expect(isBusinessRejection({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false); expect(isBusinessRejection({ data: { code: "UNAUTHORIZED" } })).toBe(false); });
  it("keeps UUID scoped by local admin across teams without storing imported content", () => {
    const hold = { requestId: "local-request-uuid", kind: "import" as const, scopeKey: "7:3", rowNumbers: [2, 3] };
    storeRequestHold(hold); expect(readRequestHold("7:3")).toEqual(hold); expect(readRequestHold("7:4")).toEqual(hold); expect(readRequestHold("8:3")).toBeNull(); expect(sessionStorage.getItem("official-mall:request:actor:7")).not.toContain("price"); clearRequestHold("7:3"); expect(readRequestHold("7:3")).toBeNull();
  });
});

describe("P1 request proof receipt guard", () => {
  const request = { requestId: "uuid", kind: "import" as const, scopeKey: "7:3", proof: true as const, rowNumbers: [2, 3] };
  const result = { success: true, imported: 1, updated: 0, skipped: 1, errors: [], ids: [1000] };
  it.each([
    { imported: 0, skipped: 0, ids: [] }, { imported: -1 }, { imported: 0.5 }, { imported: Number.MAX_SAFE_INTEGER + 1 },
    { ids: [0] }, { ids: [1000, 1000] }, { ids: [] }, { success: false },
    { success: false, imported: 0, skipped: 0, ids: [], errors: [{ rowNumber: 2, message: "x" }, { rowNumber: 2, message: "x" }] },
    { success: false, skipped: 0, errors: [{ rowNumber: 99, message: "x" }] }, { success: false, skipped: 0, errors: [null] },
  ])("rejects incomplete or malformed import coverage %j", override => expect(validMutationResult({ ...result, ...override }, request)).toBe(false));
  it("accepts real import counts, skip without IDs and unique known row errors", () => {
    expect(validMutationResult(result, request)).toBe(true);
    expect(validMutationResult({ success: false, imported: 1, updated: 0, skipped: 0, ids: [1000], errors: [{ rowNumber: 3, message: "conflict" }] }, request)).toBe(true);
    expect(validMutationResult(result, { ...request, proof: undefined })).toBe(false);
  });
  it.each([
    { success: true, successful: -1, errors: [] }, { success: true, successful: 0, errors: [] },
    { success: false, successful: 1, errors: [{ id: 99, message: "x" }] },
    { success: false, successful: 0, errors: [{ id: 101, message: "x" }, { id: 101, message: "x" }] },
  ])("rejects malformed bulk coverage %j", value => expect(validMutationResult(value, { ...request, kind: "bulk", bulkIds: [101, 102] })).toBe(false));
  it("validates successful single ID/revision/status and refuses incomplete success:false", () => {
    const expected = { ...request, kind: "update" as const, expectedId: 101 };
    expect(validMutationResult({ success: true, id: 101, revision: 2, status: "draft" }, expected)).toBe(true);
    for (const value of [{ success: false }, { success: true, id: 102, revision: 2, status: "draft" }, { success: true, id: 101, revision: 0, status: "draft" }, { success: true, id: 101, revision: 2, status: "unknown" }]) expect(validMutationResult(value, expected)).toBe(false);
  });
  it("migrates old actor/team keys without leaking actors or discarding other unknown UUIDs", () => {
    const first = { requestId: "old-team3", kind: "bulk" as const, scopeKey: "7:3" };
    const second = { ...first, requestId: "old-team4", scopeKey: "7:4" };
    sessionStorage.setItem("official-mall:request:7:3", JSON.stringify(first)); sessionStorage.setItem("official-mall:request:7:4", JSON.stringify(second));
    expect(readRequestHold("8:4")).toBeNull(); expect(readRequestHold("7:5")).toEqual(first); clearRequestHold("7:5"); expect(readRequestHold("7:5")).toEqual(second); clearRequestHold("7:5"); expect(readRequestHold("7:3")).toBeNull();
  });
});
