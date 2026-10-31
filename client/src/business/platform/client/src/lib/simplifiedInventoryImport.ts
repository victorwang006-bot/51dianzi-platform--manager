import { businessStorageScope } from "../../../../BusinessScope";
import {
  INVENTORY_IMPORT_FIELDS,
  parseInventoryRowsWithMapping,
  suggestInventoryColumnMapping,
  type InventoryColumnMapping,
  type InventoryImportField,
  type InventoryImportParseResult,
  type InventoryImportRow,
  type InventoryRejectedImportRow,
} from "./inventoryExcelMapping";
import type { InventoryImportFixedValues } from "../../../shared/inventoryUploadLimits";

export const INVENTORY_SIMPLE_IMPORT_POLICY_VERSION = 3;
export const INVENTORY_SIMPLE_IMPORT_MAPPING_MEMORY_KEY =
  "inventory-simple-import-mapping-v1";
const MAX_INVENTORY_QUANTITY = 2_147_483_647;

/**
 * `qtyStock` remains in the mapping shape only to read pre-existing local
 * preferences safely. The simplified flow always resets it to null and never
 * reads a physical-stock column.
 */
export type SimplifiedInventoryColumnMapping = InventoryColumnMapping & {
  qtyStock: number | null;
};

type QuantityField = "qtyOnSale" | "moq" | "spq";

type SimplifiedQuantityParseResult =
  | { ok: true; value: number; normalized: boolean; rule: "integer" | "k" | "wan" }
  | { ok: false; message: string };

export type SimplifiedImportIssue = {
  sourceRowNumber: number;
  field: string;
  message: string;
};

export type SimplifiedInventoryImportRow = InventoryImportRow & {
  /** Explicitly keep physical stock equal to the selected sellable quantity. */
  qtyStock: number;
};

/**
 * `stageBatch` retains an opaque rejected object.  Keep an explicitly mapped
 * stock cell alongside the legacy rejected-row fields so the original visible
 * value remains available to the repair queue without altering its API shape.
 */
export type SimplifiedRejectedInventoryImportRow = InventoryRejectedImportRow & {
  qtyStock?: string;
};

/**
 * Display-only cells captured before quantity normalization or the legacy
 * parser can trim/coerce them. This is intentionally excluded from every
 * stage payload; preview conflicts rebuild their rejected row from it.
 */
export type SimplifiedImportRawDisplaySnapshot = Omit<
  SimplifiedRejectedInventoryImportRow,
  "validationError"
>;

export type SimplifiedImportPreparedRows = {
  rows: SimplifiedInventoryImportRow[];
  rejectedRows: SimplifiedRejectedInventoryImportRow[];
  payloadRows: (SimplifiedInventoryImportRow | SimplifiedRejectedInventoryImportRow)[];
  /** Non-payload raw display cells, keyed by original worksheet row number. */
  rawDisplayBySourceRow: ReadonlyMap<number, SimplifiedImportRawDisplaySnapshot>;
  issues: SimplifiedImportIssue[];
  normalizedCount: number;
  conversions: Array<{
    sourceRowNumber: number;
    field: QuantityField;
    original: string;
    value: number;
    rule: "k" | "wan";
  }>;
};

export type SimplifiedImportMappingMemory = {
  mapping: SimplifiedInventoryColumnMapping;
  fixedValues: InventoryImportFixedValues;
  taxIncluded: boolean;
};

const OPTIONAL_FIELD_KEYS = new Set<string>([
  "category",
  "pkg",
  "priceEx",
  "moq",
  "spq",
  "warehouseAddress",
  "note",
  "rohs",
]);

function normalizedHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·,，。:：;；/\\()[\]（）【】*]+/g, "");
}

function hasExactAlias(field: InventoryImportField, header: string) {
  const normalized = normalizedHeader(header);
  return field.aliases.some(alias => normalizedHeader(alias) === normalized);
}

/**
 * The bare word “数量” is intentionally a sellable quantity, never SPQ.  This
 * protects a common inventory-column heading from being silently reinterpreted
 * as a package size.
 */
export function isExplicitSpqHeader(header: unknown) {
  const value = normalizedHeader(header);
  return value === "spq" || value === "整包数量" || value === "包装数量" || value === "standardpackquantity";
}

/**
 * Start with the established mandatory-field dictionary, then make optional
 * guesses deliberately conservative.  The user can still manually map every
 * field in the advanced section.
 */
export function suggestSimplifiedInventoryColumnMapping(
  headers: readonly string[],
): SimplifiedInventoryColumnMapping {
  const proposed = suggestInventoryColumnMapping(headers);
  const next: SimplifiedInventoryColumnMapping = { ...proposed, qtyStock: null };
  const used = new Set<number>();

  for (const field of INVENTORY_IMPORT_FIELDS) {
    const index = next[field.key];
    if (index === null || index === undefined) continue;
    if (
      OPTIONAL_FIELD_KEYS.has(field.key) &&
      !hasExactAlias(field, headers[index])
    ) {
      next[field.key] = null;
      continue;
    }
    if (field.key === "spq" && !isExplicitSpqHeader(headers[index])) {
      next[field.key] = null;
      continue;
    }
    used.add(index);
  }

  // “数量” is an industry-standard explicit sellable quantity but was not in
  // the legacy alias list.  It is never borrowed for an optional field.
  if (next.qtyOnSale === null) {
    const quantityIndex = headers.findIndex(header =>
      ["数量", "qty", "quantity"].includes(normalizedHeader(header)),
    );
    if (quantityIndex >= 0 && !used.has(quantityIndex)) {
      next.qtyOnSale = quantityIndex;
    }
  }
  return next;
}

/**
 * Deterministic quantity parser: commas, explicit K and explicit 万 are safe;
 * approximate ranges, trays/reels and other packaging expressions are not.
 */
export function parseExplicitInventoryQuantity(
  input: unknown,
): SimplifiedQuantityParseResult {
  const original = String(input ?? "").normalize("NFKC").trim();
  if (!original) return { ok: false, message: "须填写正整数" };
  if (
    /(?:约|大约|左右|上下|~|～|至|—|－|\-|\+|±|盘|卷|reel|tray|tube|箱|包)/i.test(
      original,
    )
  ) {
    return {
      ok: false,
      message: "包含约数、区间或包装单位，不能自动猜测数量",
    };
  }
  /*
   * Spaces are permitted only around a trailing explicit multiplier/unit.
   * Commas must be standard three-digit groups.  In particular, never turn
   * “1,70” or “1 2” into a different quantity by deleting separators.
   */
  const matched = original.match(
    /^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*)(k|万)?(?:\s*)(pcs?|片|个|只)?$/i,
  );
  if (!matched) return { ok: false, message: "仅支持整数、明确 K 或 万" };
  const numberText = matched[1];
  const amount = Number(numberText.replace(/,/g, ""));
  const multiplier = matched[2]?.toLowerCase();
  const value = amount * (multiplier === "k" ? 1_000 : multiplier === "万" ? 10_000 : 1);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_INVENTORY_QUANTITY) {
    return { ok: false, message: `须为 1 至 ${MAX_INVENTORY_QUANTITY} 的正整数` };
  }
  if (!multiplier && (!/^\d+$/.test(numberText) || numberText.includes(","))) {
    /* A grouped integer is valid but normalizes to an integer string. */
    if (/^\d{1,3}(?:,\d{3})+$/.test(numberText)) {
      return { ok: true, value, normalized: true, rule: "integer" };
    }
    return { ok: false, message: "小数必须明确带 K 或 万" };
  }
  return {
    ok: true,
    value,
    normalized: original !== String(value),
    rule: multiplier === "k" ? "k" : multiplier === "万" ? "wan" : "integer",
  };
}

function displayCell(row: readonly unknown[], index: number | null) {
  return index === null ? "" : String(row[index] ?? "");
}

function fixedOrCell(
  key: keyof InventoryImportFixedValues,
  row: readonly unknown[],
  mapping: InventoryColumnMapping,
  fixedValues: InventoryImportFixedValues,
) {
  return fixedValues[key]?.trim() || displayCell(row, mapping[key as keyof InventoryColumnMapping]);
}

type RawDisplayInput = {
  rawRow: readonly unknown[];
  sourceRowNumber: number;
  mapping: SimplifiedInventoryColumnMapping;
  fixedValues: InventoryImportFixedValues;
  taxIncluded: boolean;
};

function rawDisplaySnapshot(
  input: RawDisplayInput,
): SimplifiedImportRawDisplaySnapshot {
  const { rawRow, sourceRowNumber, mapping, fixedValues, taxIncluded } = input;
  return {
    sourceRowNumber,
    partNumber: displayCell(rawRow, mapping.partNumber),
    brand: displayCell(rawRow, mapping.brand),
    category: displayCell(rawRow, mapping.category),
    pkg: displayCell(rawRow, mapping.pkg),
    dateCode: displayCell(rawRow, mapping.dateCode),
    qtyOnSale: displayCell(rawRow, mapping.qtyOnSale),
    priceEx: displayCell(rawRow, mapping.priceEx),
    taxIncluded,
    moq: displayCell(rawRow, mapping.moq),
    spq: displayCell(rawRow, mapping.spq),
    leadTime: fixedOrCell("leadTime", rawRow, mapping, fixedValues),
    rohs: displayCell(rawRow, mapping.rohs),
    warehouseAddress: fixedOrCell("warehouseAddress", rawRow, mapping, fixedValues),
    note: fixedOrCell("note", rawRow, mapping, fixedValues),
  };
}

function messageWithoutRowPrefix(message: string) {
  return message.replace(/^第\d+行[：:]?/, "").trim() || "后台校验未通过";
}

function sourceNumberFor(index: number, sourceRowNumbers?: readonly number[]) {
  return sourceRowNumbers?.[index] ?? index + 2;
}

function normalizedRows(input: {
  rawRows: readonly (readonly unknown[])[];
  mapping: SimplifiedInventoryColumnMapping;
  sourceRowNumbers?: readonly number[];
}) {
  const rows = input.rawRows.map(row => [...row]);
  const issues = new Map<number, SimplifiedImportIssue>();
  const conversions: SimplifiedImportPreparedRows["conversions"] = [];
  const fields: QuantityField[] = ["qtyOnSale", "moq", "spq"];

  input.rawRows.forEach((rawRow, rowIndex) => {
    const sourceRowNumber = sourceNumberFor(rowIndex, input.sourceRowNumbers);
    for (const field of fields) {
      const column = input.mapping[field];
      if (column === null) continue;
      const original = String(rawRow[column] ?? "");
      if (!original.trim() && field !== "qtyOnSale") continue;
      const parsed = parseExplicitInventoryQuantity(original);
      if (!parsed.ok) {
        // Keep the first field-specific reason for a row.  The raw row itself
        // will be staged with validationError rather than silently discarded.
        if (!issues.has(sourceRowNumber)) {
          issues.set(sourceRowNumber, {
            sourceRowNumber,
            field,
            message: `${field === "spq" ? "SPQ" : field === "moq" ? "MOQ" : "数量"}${parsed.message}`,
          });
        }
        continue;
      }
      rows[rowIndex][column] = String(parsed.value);
      if (parsed.rule !== "integer") {
        conversions.push({
          sourceRowNumber,
          field,
          original,
          value: parsed.value,
          rule: parsed.rule,
        });
      }
    }
  });
  return { rows, issues, conversions };
}

/**
 * Produces a single stageable set: valid V3 rows first, and every local/backend
 * issue as the original visible row plus validationError.  Nothing is guessed
 * and no problem row is dropped before the server can persist it for repair.
 */
export function prepareSimplifiedInventoryImportRows(input: {
  rawRows: readonly (readonly unknown[])[];
  headers: readonly string[];
  mapping: SimplifiedInventoryColumnMapping;
  fixedValues: InventoryImportFixedValues;
  taxIncluded: boolean;
  sourceRowNumbers?: readonly number[];
  baseParse?: typeof parseInventoryRowsWithMapping;
}): SimplifiedImportPreparedRows {
  const baseParse = input.baseParse ?? parseInventoryRowsWithMapping;
  const normalized = normalizedRows(input);
  const parsed: InventoryImportParseResult = baseParse(
    normalized.rows,
    input.mapping,
    input.headers,
    undefined,
    input.fixedValues,
    input.taxIncluded,
    input.sourceRowNumbers,
  );
  const rawDisplayBySourceRow = new Map<
    number,
    SimplifiedImportRawDisplaySnapshot
  >();
  input.rawRows.forEach((rawRow, index) => {
    const sourceRowNumber = sourceNumberFor(index, input.sourceRowNumbers);
    rawDisplayBySourceRow.set(
      sourceRowNumber,
      rawDisplaySnapshot({
        rawRow,
        sourceRowNumber,
        mapping: input.mapping,
        fixedValues: input.fixedValues,
        taxIncluded: input.taxIncluded,
      }),
    );
  });
  const rejected = new Map<number, SimplifiedRejectedInventoryImportRow>();
  const issues: SimplifiedImportIssue[] = [];
  const markRejected = (sourceRowNumber: number, field: string, message: string) => {
    const rawDisplay = rawDisplayBySourceRow.get(sourceRowNumber);
    if (!rawDisplay || rejected.has(sourceRowNumber)) return;
    rejected.set(
      sourceRowNumber,
      { ...rawDisplay, validationError: message.slice(0, 255) },
    );
    issues.push({ sourceRowNumber, field, message });
  };

  // Rebuild even legacy parser rejections from raw displayed cells.  The base
  // parser may trim or coerce fields; a repair task must retain what was read.
  for (const row of parsed.rejectedRows) {
    markRejected(row.sourceRowNumber, "row", row.validationError);
  }
  for (const [sourceRowNumber, issue] of Array.from(normalized.issues.entries())) {
    markRejected(sourceRowNumber, issue.field, issue.message);
  }
  for (const error of parsed.validationErrors) {
    markRejected(
      error.sourceRowNumber,
      "row",
      messageWithoutRowPrefix(error.message),
    );
  }

  // Do not let the same part number make a second optimistic V3 update in one
  // file.  The second original row remains available in the repair queue.
  const seenParts = new Map<string, number>();
  for (const row of parsed.rows) {
    const sourceRowNumber = row.sourceRowNumber ?? 0;
    const normalizedPart = row.partNumber.normalize("NFKC").trim().toUpperCase();
    const firstRow = seenParts.get(normalizedPart);
    if (firstRow !== undefined) {
      markRejected(
        sourceRowNumber,
        "partNumber",
        `文件内型号重复，与第${firstRow}行相同；未自动合并数量`,
      );
    } else {
      seenParts.set(normalizedPart, sourceRowNumber);
    }
  }

  const normalizedBySource = new Map<number, readonly unknown[]>();
  normalized.rows.forEach((row, index) =>
    normalizedBySource.set(sourceNumberFor(index, input.sourceRowNumbers), row),
  );
  const rows: SimplifiedInventoryImportRow[] = [];
  for (const row of parsed.rows) {
    const sourceRowNumber = row.sourceRowNumber ?? 0;
    if (rejected.has(sourceRowNumber)) continue;
    // Keep the schema-compatible physical field, but derive it from the only
    // user-entered quantity. Never let an old Excel stock column override it.
    rows.push({ ...row, qtyStock: row.qtyOnSale });
  }
  const rejectedRows = Array.from(rejected.values()).sort(
    (left, right) => left.sourceRowNumber - right.sourceRowNumber,
  );
  const payloadRows = [...rows, ...rejectedRows].sort(
    (left, right) => (left.sourceRowNumber ?? 0) - (right.sourceRowNumber ?? 0),
  );

  return {
    rows,
    rejectedRows,
    payloadRows,
    rawDisplayBySourceRow,
    issues,
    normalizedCount: normalized.conversions.length,
    conversions: normalized.conversions,
  };
}

function rememberedMapping(value: unknown): SimplifiedInventoryColumnMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const mapping = {} as SimplifiedInventoryColumnMapping;
  for (const field of INVENTORY_IMPORT_FIELDS) {
    const mapped = source[field.key];
    if (mapped !== null && (!Number.isInteger(mapped) || Number(mapped) < 0)) {
      return null;
    }
    mapping[field.key] = mapped === null ? null : (mapped as number);
  }
  // Older saved mappings may contain a stock-column index. Deliberately ignore
  // it rather than rejecting the whole remembered mapping.
  mapping.qtyStock = null;
  return mapping;
}

function headerSignature(headers: readonly string[]) {
  return headers.map(normalizedHeader).join("|");
}

/** Only mapping metadata is remembered; no uploaded rows or prices are stored. */
export function loadSimplifiedInventoryImportMapping(
  headers: readonly string[],
): SimplifiedImportMappingMemory | null {
  if (typeof window === "undefined" || headers.length === 0) return null;
  try {
    const stored = window.localStorage.getItem(`${INVENTORY_SIMPLE_IMPORT_MAPPING_MEMORY_KEY}:${businessStorageScope() ?? "unresolved"}`);
    if (!stored) return null;
    const value = JSON.parse(stored) as Record<string, unknown>;
    if (value.headerSignature !== headerSignature(headers)) return null;
    const mapping = rememberedMapping(value.mapping);
    if (!mapping || typeof value.taxIncluded !== "boolean") return null;
    const fixedValues =
      value.fixedValues && typeof value.fixedValues === "object" && !Array.isArray(value.fixedValues)
        ? Object.fromEntries(
            Object.entries(value.fixedValues as Record<string, unknown>).filter(
              ([key, item]) =>
                ["leadTime", "warehouseAddress", "note"].includes(key) &&
                typeof item === "string",
            ),
          )
        : {};
    return { mapping, fixedValues, taxIncluded: value.taxIncluded };
  } catch {
    return null;
  }
}

export function saveSimplifiedInventoryImportMapping(
  headers: readonly string[],
  value: SimplifiedImportMappingMemory,
) {
  if (typeof window === "undefined" || headers.length === 0) return;
  try {
    window.localStorage.setItem(
      `${INVENTORY_SIMPLE_IMPORT_MAPPING_MEMORY_KEY}:${businessStorageScope() ?? "unresolved"}`,
      JSON.stringify({
        headerSignature: headerSignature(headers),
        mapping: value.mapping,
        fixedValues: value.fixedValues,
        taxIncluded: value.taxIncluded,
      }),
    );
  } catch {
    // Storage is a convenience only; private mode must never block import.
  }
}
