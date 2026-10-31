import {
  INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
  INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
  INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
  type InventoryFlexibleImportFieldKey,
  type InventoryImportFixedValues,
} from "../../../shared/inventoryUploadLimits";
import {
  COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  containsCompetitorDisplayName,
} from "../../../shared/competitorDisplayPolicy";
import { detectForbiddenContent } from "../../../shared/contentModeration";

export type InventoryImportFieldKey =
  | "partNumber"
  | "brand"
  | "category"
  | "pkg"
  | "dateCode"
  | "qtyOnSale"
  | "priceEx"
  | "moq"
  | "spq"
  | "leadTime"
  | "rohs"
  | "warehouseAddress"
  | "note";

export type InventoryColumnMapping = Record<
  InventoryImportFieldKey,
  number | null
>;

export type InventoryImportRow = {
  /** 原 Excel 工作表行号（第一行是表头，因此数据从 2 开始）。 */
  sourceRowNumber?: number;
  partNumber: string;
  brand: string;
  category?: string;
  pkg?: string;
  /** 生产周期（Date Code）：自 2026-08 起必填（与单条新增同口径） */
  dateCode: string;
  qtyOnSale: number;
  priceEx?: number;
  /** true=含税价；false=未税价且前台仅允许询价 */
  taxIncluded: boolean;
  moq?: number;
  spq?: number;
  leadTime: string;
  rohs?: boolean;
  warehouseAddress?: string;
  note?: string;
};

/**
 * 浏览器无法按旧规则解析的非空 Excel 行。字段刻意保留显示文本，
 * 由后台将其作为拒绝行暂存，以便一次性导出并修正；不要在此转换数字。
 */
export type InventoryRejectedImportRow = {
  sourceRowNumber: number;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string;
  dateCode: string;
  qtyOnSale: string;
  priceEx: string;
  taxIncluded: boolean;
  moq: string;
  spq: string;
  leadTime: string;
  rohs: string;
  warehouseAddress: string;
  note: string;
  validationError: string;
};

/** 已被历史浏览器解析通过、但后台仍会拒绝的行级预览提示。 */
export type InventoryImportValidationError = {
  sourceRowNumber: number;
  message: string;
};

export type InventoryImportParseResult = {
  /** 历史成功解析结果：为断点续传保持字节级字段口径，不因新校验过滤。 */
  rows: InventoryImportRow[];
  /** 历史上被浏览器跳过的非空行，按显示文本交给后台记录失败原因。 */
  rejectedRows: InventoryRejectedImportRow[];
  /** rows 中后台会拒绝的行，供诚实预览；这些行必须继续留在 rows。 */
  validationErrors: InventoryImportValidationError[];
  /** 保留既有逐行提示，兼容已有界面和调用方。 */
  errors: string[];
};

/** 导出文件保持可再次映射的导入列，末两列在重新导入时会自然忽略。 */
export const INVENTORY_FAILED_ROW_EXPORT_HEADERS = [
  "型号 / 料号",
  "品牌",
  "生产周期（Date Code）",
  "上架数量",
  "单价",
  "交期",
  "仓库地址",
  "物料备注",
  "分类",
  "封装",
  "MOQ",
  "SPQ",
  "RoHS",
  "未导入原因",
  "原Excel行号",
] as const;

export type InventoryFailedRowForExport = {
  rowNumber: number;
  partNumber: unknown;
  brand: unknown;
  category: unknown;
  pkg: unknown;
  dateCode: unknown;
  qtyOnSale: unknown;
  priceEx: unknown;
  taxIncluded?: unknown;
  moq: unknown;
  spq: unknown;
  leadTime: unknown;
  warehouseAddress: unknown;
  rohs: unknown;
  note: unknown;
  errorMessage: unknown;
};

/**
 * Excel 会把 =/+/-/@ 开头的用户文本当作公式。始终输出字符串，并在
 * 危险前缀前加文本标记；不把原始无效数字转换成 Number，以便修正后重传。
 */
export function inventoryFailedRowToExportValues(
  row: InventoryFailedRowForExport
): string[] {
  const textCell = (value: unknown) => {
    const text =
      value == null
        ? ""
        : typeof value === "boolean"
          ? value
            ? "是"
            : "否"
          : String(value);
    return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  };

  return [
    textCell(row.partNumber),
    textCell(row.brand),
    textCell(row.dateCode),
    textCell(row.qtyOnSale),
    textCell(row.priceEx),
    textCell(row.leadTime),
    textCell(row.warehouseAddress),
    textCell(row.note),
    textCell(row.category),
    textCell(row.pkg),
    textCell(row.moq),
    textCell(row.spq),
    textCell(row.rohs),
    textCell(row.errorMessage || "未导入"),
    textCell(row.rowNumber),
  ];
}

export type InventoryImportField = {
  key: InventoryImportFieldKey;
  label: string;
  required?: boolean;
  description: string;
  aliases: readonly string[];
};

export const INVENTORY_IMPORT_FIELDS: readonly InventoryImportField[] = [
  {
    key: "partNumber",
    label: "型号 / 料号",
    required: true,
    description: "原样保留单元格显示内容，不自动纠错",
    aliases: [
      "型号",
      "料号",
      "物料编码",
      "物料号",
      "产品型号",
      "part number",
      "part no",
      "partnumber",
      "pn",
      "p/n",
      "mpn",
    ],
  },
  {
    key: "brand",
    label: "品牌",
    required: true,
    description: "品牌、厂牌或制造商，必填",
    aliases: [
      "品牌",
      "厂牌",
      "制造商",
      "生产商",
      "brand",
      "manufacturer",
      "mfr",
    ],
  },
  {
    key: "dateCode",
    label: "生产周期（Date Code）",
    required: true,
    description: "批号、周期或 Date Code，必填（如 2335、26+）",
    aliases: [
      "批号",
      "周期",
      "生产批号",
      "生产周期",
      "date code",
      "datecode",
      "dc",
      "lot",
      "lot no",
    ],
  },
  {
    key: "qtyOnSale",
    label: "上架数量",
    required: true,
    description: "对外发布的可售数量，必须为正整数",
    aliases: [
      "上架数量",
      "发布数量",
      "可售数量",
      "销售数量",
      "在售数量",
      "qty on sale",
      "sale qty",
      "available qty",
    ],
  },
  {
    key: "priceEx",
    label: "单价",
    description: "价格口径由本批“含税价/未税价”选项决定；留空表示价格面议",
    aliases: [
      "含税单价",
      "含税价",
      "单价",
      "价格",
      "未税单价",
      "未税价",
      "不含税单价",
      "不含税价",
      "不含税价格",
      "税前单价",
      "税前价",
      "unit price",
      "price incl",
      "price ex",
      "unit price ex",
      "excluding tax",
      "excl tax",
      "price",
    ],
  },
  {
    key: "leadTime",
    label: "交期",
    required: true,
    description: `选择 Excel 列或统一填写，必填（最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}个字符）`,
    aliases: ["交期", "交货期", "发货期", "货期", "lead time", "delivery time"],
  },
  {
    key: "warehouseAddress",
    label: "仓库地址",
    description: `选择 Excel 列或统一填写（最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}个字符）`,
    aliases: [
      "仓库地址",
      "仓库",
      "库存地",
      "库存地址",
      "所在地",
      "发货地",
      "发货地址",
      "warehouse",
      "warehouse address",
      "location",
    ],
  },
  {
    key: "note",
    label: "物料备注",
    description: `选择 Excel 列或统一填写（最多${INVENTORY_UPLOAD_NOTE_MAX_LENGTH}个字符）`,
    aliases: ["物料备注", "备注", "说明", "描述", "note", "remark", "comments"],
  },
  {
    key: "category",
    label: "分类",
    description: "平台品类；未提供时按“其他”导入",
    aliases: ["分类", "品类", "产品分类", "category", "type"],
  },
  {
    key: "pkg",
    label: "封装",
    description: "元器件封装形式",
    aliases: ["封装", "封装形式", "package", "pkg"],
  },
  {
    key: "moq",
    label: "MOQ",
    description: "最小起订量",
    aliases: ["moq", "最小起订量", "起订量", "minimum order quantity"],
  },
  {
    key: "spq",
    label: "SPQ",
    description: "整包数量",
    aliases: ["spq", "整包数量", "包装数量", "standard pack quantity"],
  },
  {
    key: "rohs",
    label: "RoHS",
    description: "是/否、true/false 或 1/0",
    aliases: ["rohs", "rohs合规", "环保", "环保标准"],
  },
] as const;

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·,，。:：;；/\\()[\]（）【】*]+/g, "");

function emptyMapping(): InventoryColumnMapping {
  return Object.fromEntries(
    INVENTORY_IMPORT_FIELDS.map(field => [field.key, null])
  ) as InventoryColumnMapping;
}

function headerMatchScore(header: string, alias: string) {
  const normalizedHeader = normalizeHeader(header);
  const normalizedAlias = normalizeHeader(alias);
  if (!normalizedHeader || !normalizedAlias) return 0;
  if (normalizedHeader === normalizedAlias) return 100;
  if (
    normalizedHeader.startsWith(normalizedAlias) ||
    normalizedHeader.endsWith(normalizedAlias)
  ) {
    return 78;
  }
  if (normalizedAlias.length >= 3 && normalizedHeader.includes(normalizedAlias))
    return 62;
  return 0;
}

/**
 * 根据稳定别名词典给出可解释的初始映射。每个用户列只会自动匹配一次；
 * 未识别或冲突字段留给用户在界面中确认，不使用 AI 猜测。
 */
export function suggestInventoryColumnMapping(
  headers: readonly string[]
): InventoryColumnMapping {
  const mapping = emptyMapping();
  const usedColumns = new Set<number>();

  for (const field of INVENTORY_IMPORT_FIELDS) {
    let bestIndex: number | null = null;
    let bestScore = 0;
    headers.forEach((header, index) => {
      if (usedColumns.has(index)) return;
      const score = Math.max(
        ...field.aliases.map(alias => headerMatchScore(header, alias))
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex !== null && bestScore >= 62) {
      mapping[field.key] = bestIndex;
      usedColumns.add(bestIndex);
    }
  }

  return mapping;
}

/**
 * 根据已经映射为“单价”的用户表头给出整批价格口径建议。
 * 未税/不含税/税前/price ex 明确判为未税；其余情况保持历史默认含税。
 */
export function suggestInventoryTaxIncluded(
  headers: readonly string[],
  mapping: InventoryColumnMapping
): boolean {
  const priceColumn = mapping.priceEx;
  if (priceColumn === null || priceColumn < 0 || priceColumn >= headers.length)
    return true;
  const normalized = normalizeHeader(headers[priceColumn]);
  if (
    normalized.includes("未税") ||
    normalized.includes("不含税") ||
    normalized.includes("税前") ||
    normalized.includes("priceex") ||
    normalized.includes("excludingtax") ||
    normalized.includes("excltax")
  ) {
    return false;
  }
  return true;
}

export function validateInventoryColumnMapping(
  mapping: InventoryColumnMapping,
  headers: readonly string[],
  fixedValues: InventoryImportFixedValues = {}
): string[] {
  const issues: string[] = [];
  // 必填项在映射阶段统一拦截，避免商家上传后才发现整批数据失败。
  const requiredKeys: InventoryImportFieldKey[] = [
    "partNumber",
    "brand",
    "dateCode",
    "qtyOnSale",
    "leadTime",
  ];
  for (const key of requiredKeys) {
    const hasFixedValue =
      key === "leadTime" && Boolean(fixedValues.leadTime?.trim());
    if (mapping[key] === null && !hasFixedValue) {
      const field = INVENTORY_IMPORT_FIELDS.find(item => item.key === key)!;
      issues.push(
        key === "leadTime"
          ? "请为“交期”选择用户表头或统一填写"
          : `请为“${field.label}”选择用户表头`
      );
    }
  }

  const fixedLimits: Record<InventoryFlexibleImportFieldKey, number> = {
    leadTime: INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
    warehouseAddress: INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
    note: INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
  };
  const fixedLabels: Record<InventoryFlexibleImportFieldKey, string> = {
    leadTime: "交期",
    warehouseAddress: "仓库地址",
    note: "物料备注",
  };
  (Object.keys(fixedLimits) as InventoryFlexibleImportFieldKey[]).forEach(
    key => {
      const value = fixedValues[key]?.trim() ?? "";
      if (value && mapping[key] !== null) {
        issues.push(
          `“${fixedLabels[key]}”只能选择 Excel 列或统一填写，不能同时使用`
        );
      }
      if (value.length > fixedLimits[key]) {
        issues.push(
          `“${fixedLabels[key]}”统一填写最多${fixedLimits[key]}个字符`
        );
      }
    }
  );

  const used = new Map<number, string[]>();
  for (const field of INVENTORY_IMPORT_FIELDS) {
    const columnIndex = mapping[field.key];
    if (columnIndex === null) continue;
    if (columnIndex < 0 || columnIndex >= headers.length) {
      issues.push(`“${field.label}”选择了无效列`);
      continue;
    }
    const labels = used.get(columnIndex) ?? [];
    labels.push(field.label);
    used.set(columnIndex, labels);
  }
  used.forEach((labels, columnIndex) => {
    if (labels.length > 1) {
      issues.push(
        `用户列“${headers[columnIndex]}”被重复映射到：${labels.join("、")}`
      );
    }
  });
  return issues;
}

const cellText = (row: readonly unknown[], index: number | null) =>
  index === null ? "" : String(row[index] ?? "").trim();

/** 保留 Excel 的显示字符串，用于失败行导出；正常导入仍沿用历史 trim 行为。 */
const displayedCellText = (row: readonly unknown[], index: number | null) =>
  index === null ? "" : String(row[index] ?? "");

function numberText(value: string) {
  return value.replace(/[,，\s]/g, "");
}

function parsePositiveInteger(value: string) {
  const parsed = Number(numberText(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveNumber(value: string) {
  const parsed = Number(numberText(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value: string): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (["是", "有", "可", "true", "yes", "y", "1", "合规"].includes(normalized))
    return true;
  if (
    ["否", "无", "不可", "false", "no", "n", "0", "不合规"].includes(normalized)
  )
    return false;
  return undefined;
}

function optionalText(value: string) {
  return value || undefined;
}

function rawRejectedRow(
  rawRow: readonly unknown[],
  mapping: InventoryColumnMapping,
  sourceRowNumber: number,
  fixedValues: InventoryImportFixedValues,
  taxIncluded: boolean,
  validationError: string
): InventoryRejectedImportRow {
  const fixedText = (
    key: InventoryFlexibleImportFieldKey,
    column: number | null
  ) => fixedValues[key]?.trim() || displayedCellText(rawRow, column);

  return {
    sourceRowNumber,
    partNumber: displayedCellText(rawRow, mapping.partNumber),
    brand: displayedCellText(rawRow, mapping.brand),
    category: displayedCellText(rawRow, mapping.category),
    pkg: displayedCellText(rawRow, mapping.pkg),
    dateCode: displayedCellText(rawRow, mapping.dateCode),
    qtyOnSale: displayedCellText(rawRow, mapping.qtyOnSale),
    priceEx: displayedCellText(rawRow, mapping.priceEx),
    taxIncluded,
    moq: displayedCellText(rawRow, mapping.moq),
    spq: displayedCellText(rawRow, mapping.spq),
    leadTime: fixedText("leadTime", mapping.leadTime),
    rohs: displayedCellText(rawRow, mapping.rohs),
    warehouseAddress: fixedText("warehouseAddress", mapping.warehouseAddress),
    note: fixedText("note", mapping.note),
    validationError,
  };
}

/**
 * Keep this separate from legacy parsing. These fields were historically allowed
 * into `rows`, and must remain there so an old staging job retains its manifest
 * and 500-row boundaries. The messages make the preview honest for new jobs.
 */
function serverValidationErrors(
  row: InventoryImportRow
): InventoryImportValidationError[] {
  const sourceRowNumber = row.sourceRowNumber ?? 0;
  const errors: InventoryImportValidationError[] = [];
  const add = (message: string) =>
    errors.push({
      sourceRowNumber,
      message: `第${sourceRowNumber}行：${message}`,
    });

  if (row.partNumber.length > 128)
    add("型号/料号填写过长（最多128个字符），后台将跳过");
  if (row.category && row.category.length > 32)
    add("分类填写过长（最多32个字符），后台将跳过");
  if (row.pkg && row.pkg.length > 32)
    add("封装填写过长（最多32个字符），后台将跳过");
  if (containsCompetitorDisplayName(row.brand))
    add(`品牌${COMPETITOR_DISPLAY_VALIDATION_MESSAGE}，后台将跳过`);
  if (containsCompetitorDisplayName(row.category))
    add(`分类${COMPETITOR_DISPLAY_VALIDATION_MESSAGE}，后台将跳过`);
  const noteVerdict = detectForbiddenContent(row.note);
  if (!noteVerdict.ok) add(`物料备注${noteVerdict.message}，后台将跳过`);
  return errors;
}

export function parseInventoryRowsWithMapping(
  rawRows: readonly (readonly unknown[])[],
  mapping: InventoryColumnMapping,
  headers: readonly string[],
  maxRows?: number,
  fixedValues: InventoryImportFixedValues = {},
  taxIncluded = true,
  /**
   * Optional original worksheet line numbers for callers that removed blank
   * rows before parsing. Omit this to preserve the historical dataIndex + 2
   * behavior needed by resumable legacy staging jobs.
   */
  sourceRowNumbers?: readonly number[]
): InventoryImportParseResult {
  const mappingIssues = validateInventoryColumnMapping(
    mapping,
    headers,
    fixedValues
  );
  if (mappingIssues.length > 0) {
    return {
      rows: [],
      rejectedRows: [],
      validationErrors: [],
      errors: mappingIssues,
    };
  }

  const rows: InventoryImportRow[] = [];
  const rejectedRows: InventoryRejectedImportRow[] = [];
  const validationErrors: InventoryImportValidationError[] = [];
  const errors: string[] = [];
  const hasExplicitLimit = Number.isInteger(maxRows) && Number(maxRows) > 0;
  const dataRows = hasExplicitLimit ? rawRows.slice(0, maxRows) : rawRows;
  if (hasExplicitLimit && rawRows.length > Number(maxRows)) {
    errors.push(`文件共有 ${rawRows.length} 行数据，仅处理前 ${maxRows} 行`);
  }

  dataRows.forEach((rawRow, dataIndex) => {
    const excelRow = sourceRowNumbers?.[dataIndex] ?? dataIndex + 2;
    if (!rawRow || rawRow.every(cell => String(cell ?? "").trim() === ""))
      return;
    const reject = (message: string, validationError: string) => {
      errors.push(message);
      rejectedRows.push(
        rawRejectedRow(
          rawRow,
          mapping,
          excelRow,
          fixedValues,
          taxIncluded,
          validationError
        )
      );
    };

    const partNumber = cellText(rawRow, mapping.partNumber);
    if (!partNumber) {
      reject(`第${excelRow}行：缺少型号，未导入`, "缺少型号");
      return;
    }

    const brandText = cellText(rawRow, mapping.brand);
    if (!brandText) {
      reject(`第${excelRow}行：缺少品牌，未导入`, "缺少品牌");
      return;
    }
    if (brandText.length > 64) {
      reject(
        `第${excelRow}行：品牌名称过长，未导入`,
        "品牌名称过长（最多64个字符）"
      );
      return;
    }

    // 批号必填：与单条新增（inventoryCreateSchema）保持同一口径
    const dateCodeText = cellText(rawRow, mapping.dateCode);
    if (!dateCodeText) {
      reject(
        `第${excelRow}行：缺少生产周期，未导入`,
        "缺少生产周期（Date Code）"
      );
      return;
    }
    if (dateCodeText.length > 32) {
      reject(
        `第${excelRow}行：生产周期过长，未导入`,
        "生产周期（Date Code）过长（最多32个字符）"
      );
      return;
    }

    const saleText = cellText(rawRow, mapping.qtyOnSale);
    const qtyOnSale = parsePositiveInteger(saleText);
    if (qtyOnSale === null) {
      reject(`第${excelRow}行：数量格式不对，未导入`, "上架数量须为正整数");
      return;
    }

    const leadTimeText =
      fixedValues.leadTime?.trim() || cellText(rawRow, mapping.leadTime);
    if (!leadTimeText) {
      reject(`第${excelRow}行：缺少交期，未导入`, "缺少交期");
      return;
    }
    if (leadTimeText.length > INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH) {
      reject(
        `第${excelRow}行：交期填写过长（最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}字），未导入`,
        `交期填写过长（最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}个字符）`
      );
      return;
    }

    const priceText = cellText(rawRow, mapping.priceEx);
    const priceEx = priceText ? parsePositiveNumber(priceText) : undefined;
    if (priceText && priceEx === null) {
      reject(`第${excelRow}行：单价格式不对，未导入`, "单价格式不正确");
      return;
    }
    if (!taxIncluded && priceEx === undefined) {
      reject(
        `第${excelRow}行：选择未税价时必须填写单价，未导入`,
        "选择未税价时必须填写单价"
      );
      return;
    }

    const moqText = cellText(rawRow, mapping.moq);
    const moq = moqText ? parsePositiveInteger(moqText) : undefined;
    if (moqText && moq === null) {
      reject(`第${excelRow}行：MOQ 格式不对，未导入`, "MOQ 须为正整数");
      return;
    }

    const spqText = cellText(rawRow, mapping.spq);
    const spq = spqText ? parsePositiveInteger(spqText) : undefined;
    if (spqText && spq === null) {
      reject(`第${excelRow}行：SPQ 格式不对，未导入`, "SPQ 须为正整数");
      return;
    }

    const rohsText = cellText(rawRow, mapping.rohs);
    const rohs = parseBoolean(rohsText);
    if (rohsText && rohs === undefined) {
      reject(`第${excelRow}行：RoHS 填写无法识别，未导入`, "RoHS 填写无法识别");
      return;
    }

    const warehouseAddressText =
      fixedValues.warehouseAddress?.trim() ||
      cellText(rawRow, mapping.warehouseAddress);
    if (warehouseAddressText.length > INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH) {
      reject(
        `第${excelRow}行：仓库地址过长（最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}字），未导入`,
        `仓库地址填写过长（最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}个字符）`
      );
      return;
    }
    /* 备注为选填：历史行为是超长自动截断；分类/封装绝不在这里截断。 */
    const rawNoteText =
      fixedValues.note?.trim() || cellText(rawRow, mapping.note);
    let noteText = rawNoteText;
    if (rawNoteText.length > INVENTORY_UPLOAD_NOTE_MAX_LENGTH) {
      noteText = rawNoteText.slice(0, INVENTORY_UPLOAD_NOTE_MAX_LENGTH);
      errors.push(`第${excelRow}行：备注超长，已自动截断`);
    }

    const row: InventoryImportRow = {
      sourceRowNumber: excelRow,
      partNumber,
      brand: brandText,
      category: optionalText(cellText(rawRow, mapping.category)),
      pkg: optionalText(cellText(rawRow, mapping.pkg)),
      dateCode: dateCodeText,
      qtyOnSale,
      priceEx: priceEx ?? undefined,
      taxIncluded,
      moq: moq ?? undefined,
      spq: spq ?? undefined,
      leadTime: leadTimeText,
      rohs,
      warehouseAddress: optionalText(warehouseAddressText),
      note: optionalText(noteText),
    };
    // Do not remove this row: legacy resumptions depend on its former membership/order.
    rows.push(row);
    validationErrors.push(...serverValidationErrors(row));
  });

  if (rows.length === 0 && rejectedRows.length === 0)
    errors.push("没有可导入的有效数据行");
  return { rows, rejectedRows, validationErrors, errors };
}
