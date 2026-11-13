import type * as XLSX from "xlsx";
import {
  CUSTOMER_DEMAND_MAX_ITEMS,
  CUSTOMER_DEMAND_UNITS,
  customerDemandItemSchema,
  type CustomerDemandItem,
} from "../../../../shared/customerDemands";

export const DEMAND_BOM_MAX_BYTES = 5 * 1024 * 1024;
export const DEMAND_BOM_MAX_ROWS = 1000;
export const DEMAND_BOM_MAX_COLUMNS = 64;
export const DEMAND_BOM_MAX_SHEETS = 20;
export const DEMAND_BOM_FIELDS = [
  { key: "partNumber", label: "型号", maxLength: 128, aliases: ["型号", "料号", "物料型号", "物料编码", "零件编号", "partnumber", "mpn", "manufacturerpartnumber", "pn"] },
  { key: "brand", label: "品牌", maxLength: 64, aliases: ["品牌", "厂牌", "制造商", "厂家", "brand", "manufacturer", "mfr"] },
  { key: "pkg", label: "封装", maxLength: 64, aliases: ["封装", "封装形式", "package", "pkg", "footprint"] },
  { key: "qty", label: "数量", aliases: ["数量", "需求数量", "用量", "qty", "quantity", "requiredquantity"] },
  { key: "qtyUnit", label: "单位", aliases: ["单位", "数量单位", "unit", "uom"] },
  { key: "deliveryRequirement", label: "要求交期", maxLength: 80, aliases: ["要求交期", "交期", "要求交货日期", "交货日期", "delivery", "deliverydate", "leadtime", "requireddate"] },
  { key: "note", label: "备注", maxLength: 500, aliases: ["备注", "物料备注", "note", "notes", "remark", "remarks"] },
] as const;
export type DemandBomField = typeof DEMAND_BOM_FIELDS[number]["key"];
export type DemandBomMapping = Record<DemandBomField, number | null>;
export type DemandBomCell = { text: string; formula?: boolean; number?: number };
export type DemandBomSheet = { name: string; rows: DemandBomCell[][] };
export type DemandBomDraft = { sourceRow: number; values: Record<DemandBomField, string>; formulaFields: DemandBomField[] };
export type DemandBomValidation = { item: CustomerDemandItem | null; errors: Partial<Record<DemandBomField, string>> };

export function assertDemandBomFile(file: Pick<File, "name" | "size">) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("仅支持 .xlsx 或 .xls 文件");
  if (file.size <= 0) throw new Error("文件为空，请选择含物料的 Excel 文件");
  if (file.size > DEMAND_BOM_MAX_BYTES) throw new Error("BOM 文件不能超过 5MB，请拆分后导入");
}

function assertDemandBomBytes(bytes: ArrayBuffer) {
  if (!bytes.byteLength || bytes.byteLength > DEMAND_BOM_MAX_BYTES) throw new Error("Excel 文件为空或超过 5MB");
  const data = new Uint8Array(bytes);
  const isOle = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => data[index] === value);
  const isBiff = data[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(data[1]);
  const isZip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (!isOle && !isBiff && !isZip) throw new Error("不是有效的 .xlsx / .xls Excel 文件，请勿仅修改文件扩展名");
  if (!isZip) return;
  // Bound ZIP expansion before SheetJS decompresses any XML (no extra dependency).
  const view = new DataView(bytes);
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === data.length) { end = offset; break; }
  }
  if (end < 0) throw new Error("Excel 压缩文件不完整");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (count > 2048 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || offset + size > end) throw new Error("Excel 压缩结构过大或不受支持，请精简文件");
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Excel 压缩文件结构无效");
    const entrySize = view.getUint32(offset + 24, true);
    expanded += entrySize;
    if (entrySize > 16 * 1024 * 1024 || expanded > 32 * 1024 * 1024) throw new Error("Excel 解压内容过大，请拆分或精简文件");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset > end) throw new Error("Excel 压缩文件结构无效");
}

/** Read metadata first; only the selected sheet is parsed, with a bounded row count. */
export function readDemandBomSheetNames(xlsx: typeof XLSX, bytes: ArrayBuffer): string[] {
  assertDemandBomBytes(bytes);
  const workbook = xlsx.read(bytes, { type: "array", bookSheets: true, bookProps: false });
  if (!workbook.SheetNames.length) throw new Error("文件中没有工作表");
  if (workbook.SheetNames.length > DEMAND_BOM_MAX_SHEETS) throw new Error(`文件最多支持 ${DEMAND_BOM_MAX_SHEETS} 张工作表，请精简文件`);
  return workbook.SheetNames;
}

export function readDemandBomSheet(xlsx: typeof XLSX, bytes: ArrayBuffer, name: string): DemandBomSheet {
  assertDemandBomBytes(bytes);
  const workbook = xlsx.read(bytes, {
    type: "array", sheets: [name], sheetRows: DEMAND_BOM_MAX_ROWS + 2,
    cellFormula: true, cellHTML: false, cellDates: false, cellStyles: false,
  });
  const sheet = workbook.Sheets[name];
  if (!sheet?.["!ref"]) throw new Error("工作表为空，请选择含表头和数据的工作表");
  const range = xlsx.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
  if (range.e.r > DEMAND_BOM_MAX_ROWS || range.e.c >= DEMAND_BOM_MAX_COLUMNS) {
    throw new Error(`工作表范围过大：最多 ${DEMAND_BOM_MAX_ROWS + 1} 行（含表头）、${DEMAND_BOM_MAX_COLUMNS} 列，请删除多余行列或拆分文件`);
  }
  const rows: DemandBomCell[][] = [];
  // Keep actual Excel row numbers, blank/title rows, formatted part numbers and dates.
  for (let r = 0; r <= range.e.r; r += 1) {
    const row: DemandBomCell[] = [];
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = sheet[xlsx.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const text = cell ? String(cell.w ?? xlsx.utils.format_cell(cell) ?? cell.v ?? "").trim() : "";
      if (text.length > 10000) throw new Error(`第 ${r + 1} 行内容过长，请精简文件`);
      row.push({ text, ...(cell?.f ? { formula: true } : {}), ...(cell?.t === "n" ? { number: Number(cell.v) } : {}) });
    }
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("工作表须包含表头和至少一行物料");
  return { name, rows };
}

const normalizedHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_\-./()（）:*：＊]+/g, "");
export function suggestDemandBomMapping(headers: string[]): DemandBomMapping {
  const normalized = headers.map(normalizedHeader);
  return Object.fromEntries(DEMAND_BOM_FIELDS.map(field => {
    const matches = normalized.flatMap((header, index) => (field.aliases as readonly string[]).includes(header) ? [index] : []);
    // Ambiguous repeated headers are deliberately left for manual mapping.
    return [field.key, matches.length === 1 ? matches[0] : null];
  })) as DemandBomMapping;
}

export function suggestDemandBomHeader(sheet: DemandBomSheet): number {
  let best = 0, score = 0;
  sheet.rows.slice(0, 20).forEach((row, index) => {
    const mapping = suggestDemandBomMapping(row.map(cell => cell.text));
    const next = Object.values(mapping).filter(value => value !== null).length;
    if (mapping.partNumber !== null && mapping.qty !== null && next > score) { best = index; score = next; }
  });
  return best;
}

export function demandBomMappingError(mapping: DemandBomMapping): string {
  if (mapping.partNumber === null || mapping.qty === null) return "请先映射型号和数量列（草稿行也须明确来源列）";
  const columns = Object.values(mapping).filter((value): value is number => value !== null);
  if (columns.some(value => !Number.isInteger(value) || value < 0 || value >= DEMAND_BOM_MAX_COLUMNS)) return "列映射无效，请重新选择";
  if (new Set(columns).size !== columns.length) return "同一来源列不能映射到多个字段";
  return "";
}

export function mapDemandBomRows(sheet: DemandBomSheet, headerIndex: number, mapping: DemandBomMapping): DemandBomDraft[] {
  const error = demandBomMappingError(mapping);
  if (error) throw new Error(error);
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= sheet.rows.length - 1) throw new Error("请选择有效的表头行");
  return sheet.rows.slice(headerIndex + 1).flatMap((row, index) => {
    const values = {} as DemandBomDraft["values"];
    const formulaFields: DemandBomField[] = [];
    DEMAND_BOM_FIELDS.forEach(field => {
      const column = mapping[field.key];
      const cell = column === null ? undefined : row[column];
      values[field.key] = field.key === "qty" && cell?.number !== undefined ? String(cell.number) : cell?.text ?? "";
      if (cell?.formula) formulaFields.push(field.key);
    });
    // Whitelist only material fields. Rows containing only contact/phone/extra columns are ignored.
    if (!Object.values(values).some(value => value.trim()) && !formulaFields.length) return [];
    if (!values.qtyUnit) values.qtyUnit = "片";
    return [{ sourceRow: headerIndex + index + 2, values, formulaFields }];
  });
}

const unitAliases: Record<string, CustomerDemandItem["qtyUnit"]> = {
  pcs: "片", pc: "片", pieces: "片", piece: "片", ea: "个", each: "个", set: "套", sets: "套", reel: "盘", reels: "盘",
};
export function validateDemandBomDraft(draft: DemandBomDraft, allowIncomplete = false): DemandBomValidation {
  const values = Object.fromEntries(DEMAND_BOM_FIELDS.map(field => [field.key, draft.values[field.key].trim()])) as DemandBomDraft["values"];
  const errors: DemandBomValidation["errors"] = {};
  if (!allowIncomplete && !values.partNumber) errors.partNumber = "请输入型号";
  if (!allowIncomplete && !values.qty) errors.qty = "请输入数量";
  let qty: number | null = null;
  if (values.qty) {
    const numeric = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(values.qty) ? Number(values.qty.replace(/,/g, "")) : NaN;
    if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 2147483647) errors.qty = "数量须为 1～2147483647 的正整数";
    else qty = numeric;
  }
  const qtyUnit = unitAliases[values.qtyUnit.toLowerCase()] ?? (values.qtyUnit || "片");
  const parsed = customerDemandItemSchema.safeParse({ ...values, qty, qtyUnit });
  if (!parsed.success) parsed.error.issues.forEach(issue => {
    const key = issue.path[0] as DemandBomField;
    const field = DEMAND_BOM_FIELDS.find(field => field.key === key);
    errors[key] = key === "qtyUnit" ? `单位须为 ${CUSTOMER_DEMAND_UNITS.join(" / ")}` : `${field?.label ?? key}内容过长或无效`;
  });
  draft.formulaFields.forEach(field => { errors[field] = "公式不自动计算，请填写明确值"; });
  if (!Object.values(values).some((value, index) => DEMAND_BOM_FIELDS[index]?.key !== "qtyUnit" && value)) errors.partNumber = "空白行请取消勾选";
  return { item: !Object.keys(errors).length && parsed.success ? parsed.data : null, errors };
}

export function demandBomDuplicateParts(items: Pick<CustomerDemandItem, "partNumber">[], existing: Pick<CustomerDemandItem, "partNumber">[] = []): string[] {
  const seen = new Set(existing.map(item => item.partNumber.trim().toLowerCase()).filter(Boolean));
  const duplicates = new Set<string>();
  items.forEach(item => {
    const key = item.partNumber.trim().toLowerCase();
    if (key && seen.has(key)) duplicates.add(item.partNumber.trim());
    if (key) seen.add(key);
  });
  return Array.from(duplicates);
}

export function isReplaceableDemandBomBlank(item: CustomerDemandItem) {
  return !item.id && !item.partNumber.trim() && !item.brand.trim() && !item.pkg.trim() && item.qty === null &&
    item.qtyUnit === "片" && !item.deliveryRequirement.trim() && !item.note.trim();
}
export function demandBomRemainingCapacity(items: CustomerDemandItem[]) {
  return CUSTOMER_DEMAND_MAX_ITEMS - (items.length === 1 && isReplaceableDemandBomBlank(items[0]) ? 0 : items.length);
}
export function appendDemandBomItems<T extends CustomerDemandItem>(existing: T[], imported: T[]): T[] {
  if (!imported.length) throw new Error("请至少选择一行物料");
  if (imported.length > demandBomRemainingCapacity(existing)) throw new Error(`一张需求单最多 ${CUSTOMER_DEMAND_MAX_ITEMS} 行，请减少勾选行或另建需求`);
  return existing.length === 1 && isReplaceableDemandBomBlank(existing[0]) ? [...imported] : [...existing, ...imported];
}

export function createDemandBomTemplate(xlsx: typeof XLSX) {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([
    DEMAND_BOM_FIELDS.map(field => field.label),
    ["示例型号（导入前请删除此行）", "", "", 100, "片", "现货 / YYYY-MM-DD", "仅物料备注，请勿填写联系方式"],
  ]);
  sheet["!cols"] = [{ wch: 35 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 42 }];
  xlsx.utils.book_append_sheet(workbook, sheet, "客户需求BOM");
  const instructions = xlsx.utils.aoa_to_sheet([
    ["填写说明"],
    ["一份BOM导入一张需求单，最多100行；超出请分拆。"],
    ["提交时型号、数量必填，数量为正整数。单位：片 / 只 / 颗 / 套 / 盘 / 个，空白默认片。"],
    ["请删除示例行。型号建议设置为文本，保留前导零；公式请粘贴为值。"],
    ["导入只追加本地物料，不覆盖、不合并重复型号，也不会自动保存或提交采购。"],
    ["不要填写客户联系人、电话或其他敏感信息。非标准表头可在导入时手动映射。"],
  ]);
  instructions["!cols"] = [{ wch: 105 }];
  xlsx.utils.book_append_sheet(workbook, instructions, "填写说明");
  return workbook;
}
