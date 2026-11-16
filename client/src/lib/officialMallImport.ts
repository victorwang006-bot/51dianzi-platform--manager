import * as XLSX from "xlsx";
import { officialMallMaterialInputSchema } from "@shared/officialMall";
import type { OfficialMallMaterialInput, OfficialMallSuggestion, OfficialMallTier } from "@shared/officialMall";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const IMPORT_BATCH_SIZE = 100;
export type Tier = { minQty: string; price: string };
export type Form = Omit<OfficialMallMaterialInput, "qtyOnSale" | "qtyStock" | "qtyOrder" | "priceEx" | "moq" | "spq" | "ladderPrices"> & {
  qtyOnSale: string; qtyStock: string; qtyOrder: string; priceEx: string; moq: string; spq: string; tiers: Tier[];
};
export const emptyForm = (): Form => ({ partNumber: "", brand: "", pkg: "", dateCode: "", qtyOnSale: "", qtyStock: "", qtyOrder: "", leadTime: "", priceEx: "", taxIncluded: null, moq: "", spq: "", note: "", tiers: [] });
const decimalPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
function integer(value: string, name: string, positive = false): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 2147483647) throw new Error(`${name}须为${positive ? "正" : "非负"}整数且不超过2147483647`);
  return n;
}
function decimal(value: string, name: string): string | null {
  const text = value.trim();
  if (!text || /^(面议|询价|待定|未知|—|-|null)$/i.test(text)) return null;
  if (!decimalPattern.test(text)) throw new Error(`${name}须为精确十进制，最多12位整数、6位小数；面议请留空`);
  return text;
}
export function parseTiers(tiers: Tier[]): OfficialMallTier[] {
  if (tiers.length > 10) throw new Error("阶梯价最多10档");
  const result: OfficialMallTier[] = [];
  tiers.forEach((tier, index) => {
    if (!tier.minQty.trim() && !tier.price.trim()) return;
    if (!tier.minQty.trim() || !tier.price.trim()) throw new Error(`第${index + 1}档请同时填写数量和单价`);
    const minQty = integer(tier.minQty, `第${index + 1}档数量`, true);
    const price = decimal(tier.price, `第${index + 1}档单价`);
    if (minQty == null || price == null || Number(price) <= 0) throw new Error(`第${index + 1}档数量及单价须大于0`);
    if (result.length && minQty <= result[result.length - 1].minQty) throw new Error("梯度数量须严格递增且不能重复");
    result.push({ minQty, price });
  });
  return result;
}
export function formData(form: Form): OfficialMallMaterialInput {
  const data = { partNumber: form.partNumber.trim(), brand: form.brand.trim(), pkg: form.pkg.trim(), dateCode: form.dateCode.trim(), qtyOnSale: integer(form.qtyOnSale, "可售数量"), qtyStock: integer(form.qtyStock, "实际库存"), qtyOrder: integer(form.qtyOrder, "订货数量"), leadTime: form.leadTime.trim(), priceEx: decimal(form.priceEx, "基础单价"), taxIncluded: form.taxIncluded, moq: integer(form.moq, "MOQ", true), spq: integer(form.spq, "包装倍数", true), ladderPrices: parseTiers(form.tiers), note: form.note.trim() };
  const result = officialMallMaterialInputSchema.safeParse(data);
  if (!result.success) throw new Error(result.error.issues.map(i => i.message).join("；"));
  return result.data;
}
export function formFor(data: OfficialMallMaterialInput): Form {
  return { ...data, qtyOnSale: data.qtyOnSale == null ? "" : String(data.qtyOnSale), qtyStock: data.qtyStock == null ? "" : String(data.qtyStock), qtyOrder: data.qtyOrder == null ? "" : String(data.qtyOrder), moq: data.moq == null ? "" : String(data.moq), spq: data.spq == null ? "" : String(data.spq), priceEx: data.priceEx ?? "", tiers: data.ladderPrices.map(t => ({ minQty: String(t.minQty), price: t.price })) };
}
/** A metadata match must never import trading fields from its source. */
export function applySuggestion(form: Form, item: OfficialMallSuggestion): Form {
  return { ...form, partNumber: item.partNumber, brand: item.brand, pkg: item.pkg };
}
export function validQuoteTiers(row: Pick<OfficialMallMaterialInput, "ladderPrices">): OfficialMallTier[] {
  const tiers = row.ladderPrices;
  if (!Array.isArray(tiers) || tiers.length > 10) return [];
  if (tiers.some((t, i) => !Number.isInteger(t.minQty) || t.minQty < 1 || t.minQty > 2147483647 || !decimalPattern.test(t.price) || Number(t.price) <= 0 || (i > 0 && t.minQty <= tiers[i - 1].minQty))) return [];
  return tiers;
}
export function firstEligibleQuote(row: Pick<OfficialMallMaterialInput, "ladderPrices" | "moq" | "spq"> & { priceEx?: string | null }, requestedQuantity = 1): { quantity: number; price: string | null } | null {
  const tiers = validQuoteTiers(row);
  if (tiers.length !== row.ladderPrices.length) return null;
  const moq = row.moq ?? 1, spq = row.spq ?? 1;
  if (![moq, spq, requestedQuantity].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  const quantity = Math.ceil(Math.max(moq, requestedQuantity) / spq) * spq;
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647) return null;
  let price = row.priceEx ?? null;
  for (const tier of tiers) if (quantity >= tier.minQty) price = tier.price;
  return { quantity, price };
}
export function publishProblem(data: OfficialMallMaterialInput): string | null {
  let input: OfficialMallMaterialInput;
  try { input = formData(formFor(data)); } catch (cause) { return errorMessage(cause); }
  if (!(input.qtyOnSale != null && input.qtyOnSale > 0) && !(input.qtyOrder != null && input.qtyOrder > 0)) return "上架须明确填写大于0的可售数量或订货数量";
  if (!input.leadTime.trim()) return "上架须填写明确货期";
  return null;
}

const baseFields = [
  ["partNumber", "型号", ["料号", "品名型号", "物料型号", "model", "mpn", "partnumber", "partno", "p/n"]],
  ["brand", "品牌", ["制造商", "厂家", "厂牌", "brand", "manufacturer", "mfr"]],
  ["pkg", "封装", ["package", "pkg", "封装规格"]],
  ["dateCode", "批次", ["生产周期", "生产周期/dc", "dc", "datecode", "年份", "批号"]],
  ["qtyOnSale", "可售数量", ["可售", "现货上架量", "qtyonsale", "available", "可供数量"]],
  ["qtyStock", "实际库存", ["库存", "库存数量", "数量", "stock", "qtystock", "qty", "quantity"]],
  ["qtyOrder", "订货数量", ["订货", "qtyorder", "orderqty"]],
  ["leadTime", "货期", ["交期", "交货期", "leadtime", "delivery"]],
  ["taxIncluded", "含税", ["税口径", "是否含税", "taxincluded", "tax"]],
  ["priceEx", "基础价", ["基础单价", "单价", "售价", "价格", "price", "priceex", "unitprice"]],
  ["moq", "MOQ", ["起订量", "最小起订量"]],
  ["spq", "包装倍数", ["spq", "包装数量", "最小包装量"]],
  ["note", "备注", ["note", "notes"]],
] as const;
export type ImportField = keyof OfficialMallMaterialInput | `tierQty${number}` | `tierPrice${number}`;
export const IMPORT_COLUMNS: { key: ImportField; label: string; aliases: readonly string[] }[] = baseFields.map(([key, label, aliases]) => ({ key, label, aliases }));
for (let i = 1; i <= 10; i++) {
  IMPORT_COLUMNS.push({ key: `tierQty${i}`, label: `阶梯数量${i}`, aliases: [`梯度数量${i}`, `数量${i}`, `起订数量${i}`, `tierqty${i}`, `minqty${i}`] });
  IMPORT_COLUMNS.push({ key: `tierPrice${i}`, label: `阶梯单价${i}`, aliases: [`梯度单价${i}`, `单价${i}`, `价格${i}`, `tierprice${i}`] });
}
// The template's fixed business columns are followed by ten quantity/price pairs.
export const TEMPLATE_COLUMNS = IMPORT_COLUMNS.filter(c => c.key !== "note");
const normalizeHeader = (s: string) => s.trim().toLowerCase().replace(/[\s_()（）:：-]/g, "");
export function matchHeader(header: string): ImportField | null {
  const text = normalizeHeader(header);
  return IMPORT_COLUMNS.find(c => [c.label, c.key, ...c.aliases].some(a => normalizeHeader(a) === text))?.key ?? null;
}
export interface ParsedTable {
  headers: string[]; matrix: string[][]; rowNumbers: number[];
  mapping: (ImportField | null)[]; rowErrors: Record<number, string[]>;
}
export interface ParsedImportRow { rowNumber: number; rawData: Record<string, unknown>; data?: OfficialMallMaterialInput; errors: string[]; form: Form; }
function tableFromMatrix(matrix: string[][], rowErrors: Record<number, string[]> = {}): ParsedTable {
  const nonempty = matrix.map((row, i) => ({ row, number: i + 1 })).filter(r => r.row.some(c => c.trim()));
  if (!nonempty.length) throw new Error("文件或文本没有可识别的数据行");
  const first = nonempty[0].row;
  const inferred = first.map(matchHeader);
  const hasHeader = inferred.filter(Boolean).length >= 2 || inferred.includes("partNumber");
  const entries = hasHeader ? nonempty.slice(1) : nonempty;
  if (entries.length > MAX_IMPORT_ROWS) throw new Error(`最多${MAX_IMPORT_ROWS}行；请拆分文件后导入`);
  if (!entries.length) throw new Error("只有表头，没有数据行");
  const width = Math.max(first.length, ...entries.map(r => r.row.length));
  if (width > 100) throw new Error("最多100列，请删除无关列后重新导入");
  return { headers: Array.from({ length: width }, (_, i) => hasHeader ? first[i] || `第${i + 1}列` : `第${i + 1}列（待映射）`), matrix: entries.map(r => r.row), rowNumbers: entries.map(r => r.number), mapping: Array.from({ length: width }, (_, i) => hasHeader ? inferred[i] ?? null : null), rowErrors };
}
/** RFC-style CSV/TSV parser, including quoted delimiters and embedded line breaks. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || value === "") quoted = !quoted;
      else value += char;
    } else if (!quoted && char === delimiter) { row.push(value); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value); rows.push(row); row = []; value = "";
      if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`最多${MAX_IMPORT_ROWS}行`);
    } else value += char;
  }
  if (quoted) throw new Error("引号未闭合，请检查CSV格式");
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
function byteCheck(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error("文件或粘贴文本不得超过5MiB");
}
export function parseImportText(text: string): ParsedTable {
  byteCheck(text);
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("请粘贴表格或供应商文本");
  const first = source.split(/\r?\n/)[0];
  const firstLabel = first.match(/^\s*([^:：=]+)[:：=]/);
  const labelledStart = !!firstLabel && !!matchHeader(firstLabel[1]);
  if (!labelledStart && first.includes("\t")) return tableFromMatrix(parseDelimited(source, "\t"));
  if (!labelledStart && first.includes(",")) return tableFromMatrix(parseDelimited(source, ","));
  if (!labelledStart && first.includes(";")) return tableFromMatrix(parseDelimited(source, ";"));
  if (!labelledStart && first.includes("|")) return tableFromMatrix(parseDelimited(source, "|"));
  // Only explicit header columns or labelled fields are recognized. Free prose is not guessed.
  const words = first.split(/\s+/);
  if (words.length > 1 && words.every(w => matchHeader(w))) return tableFromMatrix(source.split(/\r?\n/).map(line => line.trim().split(/\s+/)));
  const blocks = source.split(/\n\s*\n/);
  const labelled = blocks.map(block => {
    const pairs = block.split(/[\n;；]/).map(line => line.match(/^\s*([^:：=]+)\s*[:：=]\s*(.*?)\s*$/));
    if (!pairs.length || pairs.some(pair => !pair || !matchHeader(pair[1]))) return null;
    return pairs.filter((pair): pair is RegExpMatchArray => pair !== null).map(pair => ({ key: matchHeader(pair[1])!, value: pair[2] }));
  });
  if (labelled.every((block): block is NonNullable<typeof block> => block !== null)) {
    if (labelled.some(block => new Set(block.map(p => p.key)).size !== block.length)) throw new Error("同一条供应商文本出现重复字段，请人工核对");
    const fields = Array.from(new Set(labelled.flatMap(block => block.map(pair => pair.key))));
    return tableFromMatrix([fields.map(key => IMPORT_COLUMNS.find(c => c.key === key)!.label), ...labelled.map(block => fields.map(key => block.find(p => p.key === key)?.value ?? ""))]);
  }
  const lines = source.split(/\r?\n/).map(line => line.split(/\s{2,}/));
  return tableFromMatrix(lines); // Unlabelled columns remain unmapped and produce explicit row errors.
}
export const fromExcel = parseImportText;
export function parseImportFile(name: string, buffer: ArrayBuffer): ParsedTable {
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw new Error("文件不得超过5MiB");
  if (/\.csv$/i.test(name)) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new Error("CSV编码无效，请另存为UTF-8 CSV后上传"); }
    return parseImportText(text);
  }
  if (!/\.xlsx$/i.test(name)) throw new Error("仅支持.xlsx或UTF-8 .csv；不支持宏工作簿");
  const workbook = XLSX.read(buffer, { type: "array", cellFormula: true, cellHTML: false, cellText: false, bookVBA: true, sheetRows: MAX_IMPORT_ROWS + 2 });
  if (workbook.vbaraw) throw new Error("不支持含宏工作簿");
  if (workbook.SheetNames.length !== 1) throw new Error("请只保留一个待导入工作表，避免遗漏其他表数据");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
  if (range.e.r >= MAX_IMPORT_ROWS + 1) throw new Error(`最多${MAX_IMPORT_ROWS}数据行`);
  if (range.e.c >= 100) throw new Error("最多100列，请删除无关列");
  const matrix: string[][] = [], errors: Record<number, string[]> = {};
  for (let r = 0; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell?.f) (errors[r + 1] ??= []).push(`第${c + 1}列包含公式，须粘贴为值后人工确认；不执行公式或外部引用`);
      row.push(cell?.f ? "[公式待转值]" : cell?.v == null ? "" : String(cell.v));
    }
    matrix.push(row);
  }
  if (errors[1]) throw new Error(errors[1].join("；"));
  return tableFromMatrix(matrix, errors);
}
function parseTax(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (!text || /^(未知|待定|—|-|null)$/.test(text)) return null;
  if (["true", "1", "是", "含税", "含税价", "yes"].includes(text)) return true;
  if (["false", "0", "否", "未税", "不含税", "未税价", "no"].includes(text)) return false;
  throw new Error("含税列须明确为是/否、含税/未税；不能猜测税口径");
}
export function rowsFromTable(table: ParsedTable, mapping = table.mapping): ParsedImportRow[] {
  const repeated = mapping.filter((key, i) => key && mapping.indexOf(key) !== i);
  return table.matrix.map((cells, index) => {
    const rowNumber = table.rowNumbers[index], errors = [...(table.rowErrors[rowNumber] ?? [])];
    const form = emptyForm(); const rawData: Record<string, unknown> = {};
    if (!mapping.includes("partNumber")) errors.push("无法确定型号列，请人工映射");
    if (!mapping.includes("brand")) errors.push("无法确定品牌列，请人工映射；不会猜测品牌");
    if (repeated.length) errors.push("同一字段映射了多列，请消除重复映射");
    mapping.forEach((key, col) => {
      if (!key || mapping.indexOf(key) !== col) return;
      const value = (cells[col] ?? "").trim();
      rawData[key] = value;
      if (key.startsWith("tierQty") || key.startsWith("tierPrice")) return;
      if (key === "taxIncluded") { try { form.taxIncluded = parseTax(value); } catch (error) { errors.push(errorMessage(error)); } }
      else if (key !== "ladderPrices") Object.assign(form, { [key]: value });
    });
    for (let i = 1; i <= 10; i++) {
      const qtyCol = mapping.indexOf(`tierQty${i}`), priceCol = mapping.indexOf(`tierPrice${i}`);
      const minQty = qtyCol < 0 ? "" : (cells[qtyCol] ?? "").trim(), price = priceCol < 0 ? "" : (cells[priceCol] ?? "").trim();
      if (minQty || price) form.tiers.push({ minQty, price });
    }
    let data: OfficialMallMaterialInput | undefined;
    try { data = formData(form); } catch (error) { errors.push(errorMessage(error)); }
    return { rowNumber, rawData, data, form, errors: Array.from(new Set(errors)) };
  });
}
export function safeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function csvString(rows: unknown[][]): string { return "\uFEFF" + rows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n"; }
export function templateCsv(): string { return csvString([TEMPLATE_COLUMNS.map(c => c.label)]); }
export function errorRowsCsv(rows: { rowNumber: number; form: Form; errors: string[] }[]): string {
  return csvString([["原行号", ...TEMPLATE_COLUMNS.map(c => c.label), "错误"], ...rows.map(row => [row.rowNumber, ...TEMPLATE_COLUMNS.map(col => {
    const qty = col.key.match(/^tierQty(\d+)$/), price = col.key.match(/^tierPrice(\d+)$/);
    if (qty) return row.form.tiers[Number(qty[1]) - 1]?.minQty ?? "";
    if (price) return row.form.tiers[Number(price[1]) - 1]?.price ?? "";
    if (col.key === "taxIncluded") return row.form.taxIncluded == null ? "" : row.form.taxIncluded ? "是" : "否";
    return row.form[col.key as keyof Form] ?? "";
  }), row.errors.join("；")])]);
}
export function chunks<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("分批大小无效");
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : typeof error === "string" ? error : "操作结果未知，请核对原请求"; }
export function isBusinessRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { data?: { code?: unknown }; shape?: { data?: { code?: unknown } } };
  return ["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(String(e.data?.code ?? e.shape?.data?.code));
}
export interface RequestHold { requestId: string; kind: "create" | "update" | "publish" | "offshelf" | "bulk" | "import"; rowNumbers?: number[]; bulkIds?: number[]; expectedId?: number; proof?: true; originalTeamId?: number | null; scopeKey: string; }
const actorKey = (scopeKey: string) => scopeKey.split(":")[0];
const holdKey = (scopeKey: string) => `official-mall:request:actor:${actorKey(scopeKey)}`;
const legacyKeys = (scopeKey: string) => Object.keys(sessionStorage).filter(key => key.startsWith(`official-mall:request:${actorKey(scopeKey)}:`));
/** Only receipt metadata is stored; never supplier content or prices. */
export function storeRequestHold(hold: RequestHold): void { try { sessionStorage.setItem(holdKey(hold.scopeKey), JSON.stringify(hold)); } catch { /* In-memory hold still blocks this mounted page. */ } }
export function readRequestHold(scopeKey: string): RequestHold | null {
  try {
    for (const key of [holdKey(scopeKey), ...legacyKeys(scopeKey)]) {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (parsed && typeof parsed === "object") {
        const h = parsed as Partial<RequestHold>;
        if (typeof h.scopeKey === "string" && actorKey(h.scopeKey) === actorKey(scopeKey) && typeof h.requestId === "string" && typeof h.kind === "string" && ["create", "update", "publish", "offshelf", "bulk", "import"].includes(h.kind)) { storeRequestHold(h as RequestHold); return h as RequestHold; }
      }
    }
  } catch { /* Storage can be unavailable. */ }
  return null;
}
export function clearRequestHold(scopeKey: string): void {
  try {
    const current = readRequestHold(scopeKey);
    sessionStorage.removeItem(holdKey(scopeKey));
    for (const key of legacyKeys(scopeKey)) {
      try { if (JSON.parse(sessionStorage.getItem(key) ?? "null")?.requestId === current?.requestId) sessionStorage.removeItem(key); } catch { /* Do not discard other unknown holds. */ }
    }
  } catch { /* See storeRequestHold. */ }
}

const positiveId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const uniqueIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.every(positiveId) && new Set(ids).size === ids.length;
/** Both direct writes and requestStatus use exactly this expected-request proof. */
export function validMutationResult(value: unknown, request: RequestHold): boolean {
  if (request.proof !== true || !value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.success !== "boolean") return false;
  if (request.kind === "import" || request.kind === "bulk") {
    const expected = request.kind === "import" ? request.rowNumbers : request.bulkIds;
    if (!uniqueIds(expected) || !expected.length || expected.length > IMPORT_BATCH_SIZE || !Array.isArray(r.errors)) return false;
    const errorIds: number[] = [];
    for (const error of r.errors) {
      if (!error || typeof error !== "object") return false;
      const id = request.kind === "import" ? error.rowNumber : error.id;
      if (!positiveId(id) || !expected.includes(id) || typeof error.message !== "string") return false;
      errorIds.push(id);
    }
    if (new Set(errorIds).size !== errorIds.length || r.success !== (errorIds.length === 0)) return false;
    const validCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= expected.length;
    if (request.kind === "bulk") return validCount(r.successful) && r.successful + errorIds.length === expected.length;
    if (!validCount(r.imported) || !validCount(r.updated) || !validCount(r.skipped) || !uniqueIds(r.ids)) return false;
    return r.imported + r.updated + r.skipped + errorIds.length === expected.length && r.ids.length === r.imported + r.updated;
  }
  const matchesId = request.kind === "create" ? request.expectedId === undefined : positiveId(request.expectedId) && r.id === request.expectedId;
  return r.success === true && positiveId(r.id) && matchesId && positiveId(r.revision) && typeof r.status === "string" && ["draft", "published", "offshelf"].includes(r.status);
}
