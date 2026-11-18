import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  officialMallImportSchema,
  officialMallTestUtils,
  validateOfficialMallMaterial,
} from "../../server/services/officialMall";
import type { OfficialMallMaterialInput, OfficialMallImportRow } from "../../shared/officialMall";

export const SCOPE = "official-material-import-20261118";
export const ACTOR_ID = 30004;
export const TEAM_ID = 1;
export const EXPECTED_PRODUCTS = 20000;
export const EXPECTED_TIERS = 77881;
export const EXPECTED_ZERO_STOCK = 12004;
export const canonical = officialMallTestUtils.canonicalJson;
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const fileHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const stockSchema = z.number().int().min(0).max(2147483647);
const moqSchema = z.number().int().min(1).max(2147483647);
const productSchema = z.object({
  partNumber: z.string(), brand: z.string(), pkg: z.string().default(""),
  mallStock: stockSchema, moq: moqSchema,
  unit: z.string().min(1).max(8).refine(value => value.trim().length > 0),
  sourceProductCode: z.string().min(1).max(128),
  ladderPrices: z.array(z.object({ minQty: moqSchema, price: z.union([z.string(), z.number()]) }).strict()).min(1).max(10),
  privatePayload: z.unknown().optional(),
}).passthrough();

/** Only format an already exact two-decimal quote; never round or adjust a price here. */
export function centsPrice(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") throw Error("PRICE_NOT_EXACT_CENTS");
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(text)) throw Error("PRICE_NOT_EXACT_CENTS");
  const [whole, fraction = ""] = text.split(".");
  const price = `${whole}.${fraction.padEnd(2, "0")}`;
  if (officialMallTestUtils.exactPrice(price) <= 0n) throw Error("PRICE_NOT_POSITIVE");
  return price;
}

export interface AdaptedProduct {
  data: OfficialMallMaterialInput;
  unit: string;
  sourceProductCode: string;
  /** Deliberately never supplied to the strict native service or put in note. */
  privatePayload: unknown;
}
export type InputAdapter = (raw: unknown, index: number) => AdaptedProduct;

/** Stable interface: accepts producer original_fields/adjusted_tiers or canonical products. */
export const adaptProduct: InputAdapter = (raw, index) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error(`INPUT_ROW_${index + 1}_NOT_OBJECT`);
  const record = raw as Record<string, any>;
  let product: z.infer<typeof productSchema>;
  if (record.original_fields && Array.isArray(record.adjusted_tiers)) {
    const fields = record.original_fields;
    product = productSchema.parse({
      partNumber: fields["型号"], brand: fields["品牌"], pkg: fields["封装"] ?? "",
      mallStock: fields["商城库存"], moq: fields["起订量"],
      unit: fields["销售单位"], sourceProductCode: fields["商品编号"],
      ladderPrices: record.adjusted_tiers.map((tier: Record<string, unknown>) => ({
        minQty: tier["起购数量（含）"], price: tier["单价"],
      })),
    });
  } else {
    product = productSchema.parse(record);
  }
  const ladderPrices = product.ladderPrices.map(tier => ({ minQty: tier.minQty, price: centsPrice(tier.price) }));
  const data = validateOfficialMallMaterial({
    partNumber: product.partNumber, brand: product.brand, pkg: product.pkg,
    dateCode: "", qtyOnSale: product.mallStock, qtyStock: product.mallStock,
    qtyOrder: null, leadTime: "", priceEx: ladderPrices[0].price,
    taxIncluded: true, moq: product.moq, spq: null, ladderPrices, note: "",
  });
  return { data, unit: product.unit, sourceProductCode: product.sourceProductCode, privatePayload: raw };
};

export function parseInput(text: string): unknown[] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) throw Error("INPUT_EMPTY");
  // JSONL also starts with '{'; only attempt full JSON, then parse nonempty lines.
  let parsed: unknown;
  try { parsed = JSON.parse(clean); } catch {
    return clean.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch { throw Error(`INPUT_JSONL_LINE_${index + 1}_INVALID`); }
    });
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).products)) return (parsed as any).products;
  return [parsed];
}

export interface ImportPlan {
  scope: typeof SCOPE;
  datasetHash: string;
  rows: OfficialMallImportRow[];
  privatePayloads: unknown[];
  sourceMetadata: { unit: string; sourceProductCode: string }[];
  tierCount: number;
  zeroStockCount: number;
}
export function preparePlan(rawRows: unknown[], adapter = adaptProduct, expected = {
  products: EXPECTED_PRODUCTS, tiers: EXPECTED_TIERS, zeroStock: EXPECTED_ZERO_STOCK,
}): ImportPlan {
  if (rawRows.length !== expected.products) throw Error(`PRODUCT_COUNT_EXPECTED_${expected.products}_GOT_${rawRows.length}`);
  // All rows validated before even creating a database pool. Do not deduplicate source SKUs.
  const adapted = rawRows.map(adapter);
  const rows: OfficialMallImportRow[] = adapted.map((product, index) => ({
    rowNumber: index + 1, data: product.data, duplicatePolicy: "new",
  }));
  const tierCount = rows.reduce((count, row) => count + row.data.ladderPrices.length, 0);
  const zeroStockCount = rows.filter(row => row.data.qtyStock === 0).length;
  if (tierCount !== expected.tiers) throw Error(`TIER_COUNT_EXPECTED_${expected.tiers}_GOT_${tierCount}`);
  if (zeroStockCount !== expected.zeroStock) throw Error(`ZERO_STOCK_COUNT_EXPECTED_${expected.zeroStock}_GOT_${zeroStockCount}`);
  for (let start = 0; start < rows.length; start += 500) {
    officialMallImportSchema.parse({ requestId: "offline-schema-validation", rows: rows.slice(start, start + 500), teamId: TEAM_ID });
  }
  return {
    scope: SCOPE,
    datasetHash: hash({ scope: SCOPE, actor: ACTOR_ID, team: TEAM_ID, rows, privatePayloads: adapted.map(product => product.privatePayload) }),
    rows, privatePayloads: adapted.map(product => product.privatePayload),
    sourceMetadata: adapted.map(({ unit, sourceProductCode }) => ({ unit, sourceProductCode })), tierCount, zeroStockCount,
  };
}
export async function readPlan(path: string) {
  const bytes = await readFile(path);
  return { plan: preparePlan(parseInput(bytes.toString("utf8"))), bytes, sourceHash: fileHash(bytes) };
}
export function requestId(plan: ImportPlan, phase: "import" | "publish", index: number, payload: unknown) {
  return hash({ scope: SCOPE, dataset: plan.datasetHash, actor: ACTOR_ID, team: TEAM_ID, phase, index, payload });
}
