export type Draft = {
  partNumber: string;
  brand: string;
  qty: string;
  dateCode: string;
  price: string;
  currency: string;
  taxIncluded: string;
  leadTime: string;
  note: string;
};

export type Payload = {
  channelId: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  note: string | null;
};

export type Mapping = Record<keyof Draft, number>;

export type MappedRow = {
  /** One-based source row number; row 1 is the header. */
  row: number;
  draft: Draft;
  errors: string[];
};

export const fields: { key: keyof Draft; label: string; required: boolean }[] =
  [
    { key: "partNumber", label: "型号", required: true },
    { key: "brand", label: "品牌", required: true },
    { key: "qty", label: "可供数量", required: false },
    { key: "dateCode", label: "Date Code", required: false },
    { key: "price", label: "报价（CNY）", required: false },
    { key: "currency", label: "币种", required: false },
    { key: "taxIncluded", label: "税务口径", required: false },
    { key: "leadTime", label: "交期", required: false },
    { key: "note", label: "备注", required: false },
  ];

export const emptyDraft: Draft = {
  partNumber: "",
  brand: "",
  qty: "",
  dateCode: "",
  price: "",
  currency: "CNY",
  taxIncluded: "unknown",
  leadTime: "",
  note: "",
};

const draftKeys = fields.map(({ key }) => key) as (keyof Draft)[];
// Equivalent to the archived numeric boundary without requiring an ES2020
// BigInt literal target in the candidate project's tsconfig.
const MAX_QTY = BigInt("2147483647");
const pricePattern = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/;

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function trim(value: unknown): string {
  return asText(value).trim();
}

/** Strip separators only from complete, unambiguous thousands groups. */
function normalizeQuantity(value: string): string {
  const text = value.normalize("NFKC").trim();
  return /^\d{1,3}(?:,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text;
}

/** Keep the exact decimal text; never coerce prices through floating point. */
function normalizePrice(value: string): string {
  const text = value.normalize("NFKC").trim();
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{1,12})?$/.test(text)
    ? text.replace(/,/g, "")
    : text;
}

function normalizeCurrency(value: string): string {
  if (
    value === "" ||
    value === "CNY" ||
    value === "元" ||
    value === "人民币" ||
    value === "RMB"
  ) {
    return "CNY";
  }
  return value;
}

function normalizeTaxIncluded(value: string): string {
  const canonical = value.toLowerCase();
  if (value === "" || value === "待确认" || canonical === "unknown")
    return "unknown";
  if (value === "含税" || canonical === "true") return "true";
  if (value === "未税" || value === "不含税" || canonical === "false")
    return "false";
  return value;
}

/** Matches the material-create schema's NFKC treatment for part number and trims all UI inputs. */
export function normalizeDraft(draft: Draft): Draft {
  const normalized = { ...emptyDraft };
  for (const key of draftKeys) normalized[key] = trim(draft[key]);
  normalized.partNumber = normalized.partNumber.normalize("NFKC").trim();
  normalized.qty = normalizeQuantity(normalized.qty);
  normalized.price = normalizePrice(normalized.price);
  normalized.currency = normalizeCurrency(normalized.currency);
  normalized.taxIncluded = normalizeTaxIncluded(normalized.taxIncluded);
  return normalized;
}

/** Validates the front-end strings against the material create input schema. */
export function validateDraft(draft: Draft): string[] {
  const value = normalizeDraft(draft);
  const errors: string[] = [];

  if (value.partNumber.length === 0) errors.push("型号不能为空");
  else if (value.partNumber.length > 128) errors.push("型号不能超过128个字符");

  if (value.brand.length === 0) errors.push("品牌不能为空");
  else if (value.brand.length > 64) errors.push("品牌不能超过64个字符");

  if (value.qty !== "") {
    if (!/^\d+$/.test(value.qty))
      errors.push(
        "数量格式无效：须为0到2147483647之间的整数或规范千分位（如4,000）；不接受小数、负数、单位或错误分组"
      );
    else if (BigInt(value.qty) > MAX_QTY) errors.push("数量不能超过2147483647");
  }

  if (value.dateCode.length > 32) errors.push("Date Code不能超过32个字符");
  if (
    value.price !== "" &&
    (value.price.length > 32 || !pricePattern.test(value.price))
  ) {
    errors.push("价格格式无效（最多15位整数和12位小数）");
  }
  if (value.currency !== "CNY") errors.push("币种仅支持CNY，不能换算其他币种");
  if (
    value.taxIncluded !== "true" &&
    value.taxIncluded !== "false" &&
    value.taxIncluded !== "unknown"
  ) {
    errors.push("税务口径仅支持含税、未税/不含税或待确认");
  }
  if (value.leadTime.length > 64) errors.push("交期不能超过64个字符");
  if (value.note.length > 2_000) errors.push("备注不能超过2000个字符");

  return errors;
}

function headerToken(value: unknown): string {
  return asText(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–/\\()（）\[\]【】.:：]/g, "");
}

const aliases: Record<keyof Draft, readonly string[]> = {
  partNumber: [
    "型号",
    "料号",
    "型号料号",
    "partnumber",
    "partno",
    "pn",
    "mpn",
    "materialnumber",
    "物料编码",
  ],
  brand: ["品牌", "厂牌", "brand", "manufacturer", "mfr", "制造商"],
  qty: [
    "可供数量",
    "数量",
    "库存",
    "库存数量",
    "qty",
    "quantity",
    "availablequantity",
    "availableqty",
    "stock",
  ],
  dateCode: ["datecode", "dc", "日期码", "生产日期", "批号", "批次"],
  price: [
    "报价cny",
    "人民币报价",
    "报价",
    "价格",
    "单价",
    "price",
    "unitprice",
    "offerprice",
    "quotation",
    "quote",
    "cnyprice",
  ],
  currency: ["币种", "货币", "币别", "currency", "currencycny", "报价币种"],
  taxIncluded: [
    "税务口径",
    "税务",
    "税别",
    "是否含税",
    "含税",
    "taxincluded",
    "tax",
    "vat",
    "taxstatus",
  ],
  leadTime: ["交期", "货期", "交货期", "leadtime", "delivery"],
  note: ["备注", "说明", "note", "remark", "remarks", "comment", "comments"],
};

/** Suggests one source column for each known header; unmapped fields remain -1. */
export function suggestMapping(headers: readonly unknown[]): Mapping {
  const tokens = headers.map(headerToken);
  const mapping = Object.fromEntries(
    draftKeys.map(key => [key, -1])
  ) as Mapping;
  for (const key of draftKeys) {
    const index = tokens.findIndex(token => aliases[key].includes(token));
    if (index >= 0) mapping[key] = index;
  }
  return mapping;
}

/** Ensures source column selections are usable before mapping rows. */
export function validateMapping(mapping: Mapping): string[] {
  const errors: string[] = [];
  const used = new Map<number, keyof Draft>();

  for (const field of fields) {
    const column = mapping[field.key];
    if (!Number.isInteger(column) || column < -1) {
      errors.push(`${field.label}的列映射无效`);
      continue;
    }
    if (field.required && column === -1)
      errors.push(`${field.label}为必填字段，必须映射列`);
    if (column >= 0) {
      const previous = used.get(column);
      if (previous !== undefined) {
        const previousLabel =
          fields.find(item => item.key === previous)?.label ?? previous;
        errors.push(
          `列${column + 1}重复映射到${previousLabel}和${field.label}`
        );
      } else {
        used.set(column, field.key);
      }
    }
  }
  return errors;
}

function isEmptySourceRow(row: readonly unknown[]): boolean {
  return row.every(cell => trim(cell) === "");
}

/**
 * Maps a raw grid whose first row is the header. Source row identity is preserved
 * as a one-based sheet row number even when empty rows are skipped.
 */
export function mapGrid(
  rows: readonly (readonly unknown[])[],
  mapping: Mapping,
  rawRows?: readonly (readonly unknown[])[]
): MappedRow[] {
  const mapped: MappedRow[] = [];
  for (let sourceIndex = 1; sourceIndex < rows.length; sourceIndex += 1) {
    const source = rows[sourceIndex] ?? [];
    if (isEmptySourceRow(source)) continue;

    const draft = { ...emptyDraft };
    for (const key of draftKeys) {
      const column = mapping[key];
      if (Number.isInteger(column) && column >= 0) {
        const raw = rawRows?.[sourceIndex]?.[column];
        // Raw numeric quantity avoids display commas and rounding; other fields
        // retain their text format, including leading-zero part numbers and DC.
        draft[key] = asText(
          key === "qty" && typeof raw === "number" ? raw : source[column]
        );
      }
    }
    const normalized = normalizeDraft(draft);
    mapped.push({
      row: sourceIndex + 1,
      draft: normalized,
      errors: validateDraft(normalized),
    });
  }
  return mapped;
}

/** A header-only template: examples are intentionally omitted for real inventory entry. */
export function templateGrid(): string[][] {
  return [fields.map(field => field.label)];
}

/** Converts a validated draft to the exact createMaterial payload, without owner/team wrapper fields. */
export function toPayload(draft: Draft, channelId: number): Payload {
  const value = normalizeDraft(draft);
  const errors = validateDraft(value);
  if (errors.length) throw new Error(errors.join("；"));
  if (!Number.isSafeInteger(channelId) || channelId <= 0)
    throw new Error("请选择有效的关联渠道");
  return {
    channelId,
    partNumber: value.partNumber,
    brand: value.brand,
    qty: value.qty === "" ? null : Number(value.qty),
    dateCode: value.dateCode || null,
    price: value.price || null,
    currency: "CNY",
    taxIncluded:
      value.taxIncluded === "true"
        ? true
        : value.taxIncluded === "false"
          ? false
          : null,
    leadTime: value.leadTime || null,
    note: value.note || null,
  };
}
