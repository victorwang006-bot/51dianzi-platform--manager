import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  emptyDraft,
  fields,
  mapGrid,
  normalizeDraft,
  suggestMapping,
  templateGrid,
  toPayload,
  validateDraft,
  validateMapping,
  type Draft,
} from "./import";

function draft(overrides: Partial<Draft> = {}): Draft {
  return { ...emptyDraft, partNumber: "P1", brand: "Brand", ...overrides };
}

describe("channel inventory import contract", () => {
  it("has CNY and unknown tax defaults while blank optional fields remain legal", () => {
    expect(emptyDraft.currency).toBe("CNY");
    expect(emptyDraft.taxIncluded).toBe("unknown");
    expect(validateDraft(draft())).toEqual([]);
    expect(toPayload(draft(), 9)).toMatchObject({
      qty: null,
      price: null,
      taxIncluded: null,
      currency: "CNY",
    });
  });

  it("accepts quantity zero but rejects non-integers and values over backend maximum", () => {
    expect(validateDraft(draft({ qty: "0" }))).toEqual([]);
    expect(validateDraft(draft({ qty: "1.0" })).join("；")).toContain(
      "数量格式无效"
    );
    expect(validateDraft(draft({ qty: "2147483648" }))).toContain(
      "数量不能超过2147483647"
    );
  });

  it("canonicalizes only allowed CNY aliases and never converts USD", () => {
    for (const currency of ["元", "人民币", "RMB", "CNY"]) {
      expect(normalizeDraft(draft({ currency })).currency).toBe("CNY");
      expect(validateDraft(draft({ currency }))).toEqual([]);
    }
    expect(validateDraft(draft({ currency: "USD" }))).toContain(
      "币种仅支持CNY，不能换算其他币种"
    );
    expect(() => toPayload(draft({ currency: "USD" }), 1)).toThrow(
      "币种仅支持CNY"
    );
  });

  it("maps tax aliases to explicit true, false, and unknown values", () => {
    expect(normalizeDraft(draft({ taxIncluded: "含税" })).taxIncluded).toBe(
      "true"
    );
    expect(normalizeDraft(draft({ taxIncluded: "未税" })).taxIncluded).toBe(
      "false"
    );
    expect(normalizeDraft(draft({ taxIncluded: "不含税" })).taxIncluded).toBe(
      "false"
    );
    expect(normalizeDraft(draft({ taxIncluded: "待确认" })).taxIncluded).toBe(
      "unknown"
    );
    expect(toPayload(draft({ taxIncluded: "true" }), 1).taxIncluded).toBe(true);
    expect(toPayload(draft({ taxIncluded: "false" }), 1).taxIncluded).toBe(
      false
    );
    expect(validateDraft(draft({ taxIncluded: "免税" }))).toContain(
      "税务口径仅支持含税、未税/不含税或待确认"
    );
  });

  it("suggests Chinese and English aliases, including quoted CNY, tax, and available quantity columns", () => {
    const mapping = suggestMapping([
      "型号",
      "品牌",
      "可供数量",
      "报价（CNY）",
      "税务口径",
      "unrelated",
    ]);
    expect(mapping).toMatchObject({
      partNumber: 0,
      brand: 1,
      qty: 2,
      price: 3,
      taxIncluded: 4,
    });
    expect(mapping.note).toBe(-1);
    expect(validateMapping({ ...mapping, partNumber: -1 }).join(" ")).toContain(
      "型号为必填字段"
    );
    expect(validateMapping({ ...mapping, brand: 0 }).join(" ")).toContain(
      "重复映射"
    );
  });

  it("keeps physical data row identity, skips only truly empty rows, and ignores unmapped extra columns", () => {
    const grid = [
      ["extra", "型号", "品牌", "数量", "报价（CNY）", "税务口径"],
      ["ignore me", " ＡＢＣ ", " MiXeD ", "0", "10.50", "含税"],
      ["", "", "", "", "", ""],
      ["also ignored", "P2", "Brand2", "", "", "待确认"],
    ];
    const mapped = mapGrid(grid, suggestMapping(grid[0]));
    expect(mapped.map(item => item.row)).toEqual([2, 4]);
    expect(mapped[0]).toMatchObject({
      draft: {
        partNumber: "ABC",
        brand: "MiXeD",
        qty: "0",
        taxIncluded: "true",
      },
      errors: [],
    });
    expect(mapped[1].errors).toEqual([]);
    expect(toPayload(mapped[1].draft, 7)).toMatchObject({
      qty: null,
      price: null,
      taxIncluded: null,
    });
  });

  it("enforces backend price precision without converting decimal strings", () => {
    const valid = "123456789012345.123456789012";
    expect(validateDraft(draft({ price: valid }))).toEqual([]);
    expect(toPayload(draft({ price: valid }), 1).price).toBe(valid);
    expect(validateDraft(draft({ price: "1234567890123456" }))).toContain(
      "价格格式无效（最多15位整数和12位小数）"
    );
    expect(validateDraft(draft({ price: "1.1234567890123" }))).toContain(
      "价格格式无效（最多15位整数和12位小数）"
    );
  });

  it("emits a header-only template with every field", () => {
    expect(templateGrid()).toEqual([fields.map(field => field.label)]);
  });
});

describe("Excel raw numeric fidelity", () => {
  it("keeps zero, stored decimal precision and formatted Date Code without trusting wrapper columns", () => {
    const headers = ["型号", "品牌", "数量", "报价", "Date Code", "owner", "enterpriseId"];
    const mapped = mapGrid([headers, ["P1", "TI", "4,000", "1.23", "002601", "999", "999"], ["P2", "TI", "0", "0", ""]], suggestMapping(headers), [headers, ["P1", "TI", 4000, 1.23456789, 2601], ["P2", "TI", 0, 0, ""]]);
    expect(toPayload(mapped[0].draft, 11)).toMatchObject({ qty: 4000, price: "1.23456789", dateCode: "002601", channelId: 11 });
    expect(toPayload(mapped[1].draft, 11)).toMatchObject({ qty: 0, price: "0" });
    expect(toPayload(mapped[0].draft, 11)).not.toHaveProperty("owner");
    expect(toPayload(mapped[0].draft, 11)).not.toHaveProperty("enterpriseId");
  });
});

describe("numeric Excel price exponents", () => {
  it("expands valid small stored numbers without rounding to zero and rejects excess scale", () => {
    const headers = ["型号", "品牌", "报价"];
    const rows = mapGrid([headers, ["SMALL", "TI", "0.00"], ["TOO-SMALL", "TI", "0.00"]], suggestMapping(headers), [headers, ["SMALL", "TI", 1e-12], ["TOO-SMALL", "TI", 1e-13]]);
    expect(toPayload(rows[0].draft, 11).price).toBe("0.000000000001");
    expect(rows[1].errors.join(" ")).toContain("价格格式无效");
  });
});

describe("Excel numeric part number fidelity", () => {
  it("restores General 12/15 digits and lossy formats, preserves padded/text identifiers, and blocks over 15 numeric digits", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["型号", "品牌"], [123456789012, "TI"], [123456789012345, "TI"],
      [123, "TI"], ["000123", "TI"], ["12345678901234567890", "TI"],
      [1234567890123456, "TI"], [123.456, "TI"], ["1.23457E+11", "TI"],
    ]);
    sheet.A4.z = "000000";
    sheet.A8.z = "0.0";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "test");
    const parsed = XLSX.read(XLSX.write(book, { type: "array", bookType: "xlsx" }), { type: "array" });
    const stored = parsed.Sheets[parsed.SheetNames[0]];
    const display = XLSX.utils.sheet_to_json<unknown[]>(stored, { header: 1, raw: false, defval: "" });
    const raw = XLSX.utils.sheet_to_json<unknown[]>(stored, { header: 1, raw: true, defval: "" });
    expect(display[1][0]).toBe("1.23457E+11");
    expect(display[2][0]).toBe("1.23457E+14");
    const mapped = mapGrid(display, suggestMapping(display[0]), raw);
    expect(mapped.map(row => row.draft.partNumber)).toEqual([
      "123456789012", "123456789012345", "000123", "000123",
      "12345678901234567890", "1234567890123456", "123.456", "1.23457E+11",
    ]);
    for (const index of [0, 1, 2, 3, 4, 6, 7]) {
      expect(mapped[index].errors).toEqual([]);
      expect(toPayload(mapped[index].draft, 11)).not.toHaveProperty("sourceIssue");
    }
    expect(mapped[5].errors.join(" ")).toContain("请将型号列设为文本后重新上传");
    expect(validateDraft(normalizeDraft(mapped[5].draft))).toEqual(mapped[5].errors);
    expect(() => toPayload(mapped[5].draft, 11)).toThrow("超过15位");
  });
});
