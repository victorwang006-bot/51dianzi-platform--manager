import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  CNY_TAX_EXCLUDED,
  CNY_TAX_INCLUDED,
  INBOUND_PRICE_BASES,
  MAX_INBOUND_TAX_RATE,
  MAX_INBOUND_UNIT_COST,
  normalizeInboundPricing,
  roundInboundPrice,
  type InboundPriceBasis,
  weightedInboundAverageCost,
} from "../../../shared/inboundPricing";
import {
  INBOUND_PAYMENT_MODES,
  INBOUND_PAYMENT_PAID,
  INBOUND_PAYMENT_PARTIAL,
  INBOUND_PAYMENT_UNPAID,
  MAX_INBOUND_QTY,
  classifyInboundPayment,
  inboundMoneyCents,
  inboundMoneyStringFromCents,
  inboundPayableCents,
  inboundPayableString,
  inboundPaymentPercentage,
  normalizeInboundMoney,
  type InboundPaymentMode,
} from "../../../shared/inboundPayment";
import {
  inboundBulkCreateSchema,
  type InboundBulkCreateInput,
  type InboundBulkCreateResult,
} from "../../../shared/inboundBulk";
import { createCrmPermissionProcedure, router } from "../_core/trpc";
import { adminDbAvailable, dictLookup } from "../adminDb";
import { getDb } from "../db";
import { storageGetAccessUrl, storagePutPrivate } from "../storage";

const inventoryInboundProcedure = createCrmPermissionProcedure("inventory.inbound");
const inboundStatusSchema = z.enum(["in_transit", "received", "cancelled"]);
type InboundStatus = z.infer<typeof inboundStatusSchema>;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function affectedRows(result: unknown) {
  return Number((result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}
function insertId(result: unknown) {
  return Number((result as [{ insertId?: number }])[0]?.insertId ?? 0);
}
function isDuplicateEntryError(error: unknown) {
  let value = error as { errno?: number; code?: string; cause?: unknown } | null;
  for (let depth = 0; value && depth < 3; depth += 1) {
    if (value.errno === 1062 || value.code === "ER_DUP_ENTRY") return true;
    value = value.cause as { errno?: number; code?: string; cause?: unknown } | null;
  }
  return false;
}
function beijingDateKey(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 原子生成 RK + 北京日期 + 4位流水号；删除/作废后不复用。 */
async function generateSlipNo(tx: any): Promise<string> {
  const businessDate = beijingDateKey();
  await tx.execute(sql`
    INSERT INTO business_slip_sequences (scope, businessDate, currentValue)
    VALUES ('RK', ${businessDate}, 1)
    ON DUPLICATE KEY UPDATE
      currentValue = currentValue + 1
  `);
  const current = await tx.execute(sql`
    SELECT currentValue FROM business_slip_sequences
    WHERE scope = 'RK' AND businessDate = ${businessDate}
    LIMIT 1 FOR UPDATE
  `);
  const sequence = Number((current as unknown as [[{ currentValue: number }], unknown])[0][0]?.currentValue ?? 0);
  if (!sequence || sequence > 9999) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "今日入库单流水号已达上限，请联系平台处理" });
  }
  return `RK${businessDate.replace(/-/g, "")}${String(sequence).padStart(4, "0")}`;
}

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();
const inboundPriceBasisSchema = z.enum(INBOUND_PRICE_BASES);
const MAX_INBOUND_PHOTOS = 5;
const MAX_INBOUND_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_INBOUND_CANCEL_ROWS = 200;
const inboundCancelReasonSchema = z.string().trim().min(2, "请填写作废原因").max(255);
const inboundCancelIdsSchema = z.array(z.number().int().positive()).min(1, "请选择入库单").max(MAX_INBOUND_CANCEL_ROWS)
  .refine(ids => new Set(ids).size === ids.length, "入库单不能重复选择");
const inboundCancelSelectionSchema = z.object({
  ids: inboundCancelIdsSchema.optional(),
  bulkBatchId: z.number().int().positive().optional(),
}).refine(value => Boolean(value.ids) !== Boolean(value.bulkBatchId), "请选择一种作废范围");
const inboundCancelManySchema = z.object({
  ids: inboundCancelIdsSchema.optional(),
  bulkBatchId: z.number().int().positive().optional(),
  reason: inboundCancelReasonSchema,
  refundConfirmed: z.boolean().default(false),
  paymentFingerprint: z.string().regex(/^[a-f0-9]{64}$/, "付款确认已失效"),
}).refine(value => Boolean(value.ids) !== Boolean(value.bulkBatchId), "请选择一种作废范围");
const inboundPhotoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const inboundPhotoRefSchema = z.object({
  key: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
  mimeType: inboundPhotoMimeSchema,
  size: z.number().int().positive().max(MAX_INBOUND_PHOTO_BYTES),
});
const inboundMoneyInputSchema = z.string().trim().min(1)
  .transform((value, ctx) => {
    try {
      return normalizeInboundMoney(value);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "付款金额无效" });
      return z.NEVER;
    }
  });
const inboundInitialPaymentSchema = z.object({
  mode: z.enum(INBOUND_PAYMENT_MODES),
  amount: inboundMoneyInputSchema.optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "付款日期格式须为 YYYY-MM-DD").optional(),
  note: optionalTrimmed(255),
});
type InboundPhotoRef = z.infer<typeof inboundPhotoRefSchema>;
export const inboundPartNumberSchema = z.string()
  .max(128)
  .transform(value => value.normalize("NFKC").trim().toUpperCase())
  .pipe(z.string().min(1, "请输入型号").max(128));
const inboundDataObject = z.object({
  status: z.enum(["in_transit", "received"]).default("received"),
  partNumber: inboundPartNumberSchema,
  brand: optionalTrimmed(64),
  qty: z.number().int().positive("数量须为正整数").max(MAX_INBOUND_QTY, "数量最多999,999,999"),
  unitCost: z.number().nonnegative().max(MAX_INBOUND_UNIT_COST).optional(),
  unitCostBasis: inboundPriceBasisSchema.optional(),
  taxRate: z.number().min(0).max(MAX_INBOUND_TAX_RATE).multipleOf(0.1).optional(),
  prodYear: z.string().trim().min(1, "请输入年份/DC").max(16),
  supplierName: z.string().trim().min(1, "请输入供应商名称").max(128),
  supplierContact: optionalTrimmed(64),
  supplierPhone: optionalTrimmed(32),
  packageType: optionalTrimmed(64),
  lotNumber: optionalTrimmed(64),
  supplierOrderNo: optionalTrimmed(64),
  inboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式须为 YYYY-MM-DD"),
  operator: z.string().trim().min(1, "请输入采购员").max(64),
  location: optionalTrimmed(64),
  /** Excel 批量导入的仓库地址；与实际仓位 location 分开保存。 */
  warehouseAddress: optionalTrimmed(255),
  /** Excel 批量导入的采购地区；不复用仓库地址或仓位。 */
  procurementRegion: optionalTrimmed(128),
  /** 编辑时可显式保留/清除批量缺价审计标记；旧客户端省略时服务端安全保留。 */
  priceMissing: z.boolean().optional(),
  note: optionalTrimmed(500),
  photos: z.array(inboundPhotoRefSchema).max(MAX_INBOUND_PHOTOS, "入库照片最多5张").optional(),
});
function validateCostBasis(data: { unitCost?: number; unitCostBasis?: InboundPriceBasis; taxRate?: number }, ctx: z.RefinementCtx) {
  if (data.unitCost != null && data.unitCostBasis == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unitCostBasis"], message: "请选择采购单价为含税或未税" });
  }
  if (data.unitCost != null && data.taxRate == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxRate"], message: "请选择采购税率" });
  }
  if (data.unitCost == null && (data.unitCostBasis != null || data.taxRate != null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unitCost"], message: "请先填写采购单价" });
  }
}
const inboundDataSchema = inboundDataObject;
export const inboundCreateSchema = inboundDataObject.extend({
  clientRequestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "请求标识无效"),
  payment: inboundInitialPaymentSchema,
}).superRefine((data, ctx) => {
  validateCostBasis(data, ctx);
  if (data.priceMissing === true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceMissing"], message: "缺价标记仅由批量入库生成" });
  }
  if (data.payment.mode !== INBOUND_PAYMENT_UNPAID && data.unitCost == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payment", "mode"], message: "登记付款前请填写采购单价" });
  }
  if (data.payment.mode === INBOUND_PAYMENT_PARTIAL && (!data.payment.amount || inboundMoneyCents(data.payment.amount) <= BigInt(0))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payment", "amount"], message: "请输入已付款金额" });
  }
  if (data.payment.mode !== INBOUND_PAYMENT_PARTIAL && data.payment.amount != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payment", "amount"], message: "仅部分付款需要填写付款金额" });
  }
  if (data.payment.mode !== INBOUND_PAYMENT_UNPAID && !data.payment.paymentDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payment", "paymentDate"], message: "请选择付款日期" });
  }
});

const receiveInputSchema = z.object({
  id: z.number().int().positive(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "请求标识无效"),
  actualInboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式须为 YYYY-MM-DD"),
  actualQty: z.number().int().positive("入库数量须为正整数").max(MAX_INBOUND_QTY, "数量最多999,999,999"),
  location: z.string().trim().min(1, "请输入存放仓位").max(64),
});

const inboundPaymentCategorySchema = z.enum([
  "untracked", "unpaid", "partial", "paid", "overpaid", "refunded", "cancelled_pending",
]);
const inboundListStatusSchema = z.enum(["all", "in_transit", "received", "cancelled"]);
const recordPaymentInputSchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "请求标识无效"),
  amount: inboundMoneyInputSchema,
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "付款日期格式须为 YYYY-MM-DD"),
  note: optionalTrimmed(255),
});
const voidPaymentInputSchema = z.object({
  paymentId: z.number().int().positive(),
  reason: z.string().trim().min(2, "请填写至少2个字的作废原因").max(255),
});

const inboundFilterSchema = z.object({
  partNumber: z.string().optional(),
  supplierName: z.string().optional(),
  operator: z.string().optional(),
  slipNo: z.string().optional(),
  status: inboundListStatusSchema.optional(),
  paymentCategory: inboundPaymentCategorySchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).optional();

export type InboundRow = {
  id: number;
  slipNo: string;
  userId: number;
  partNumber: string;
  brand: string | null;
  qty: number;
  unitCost: string | null;
  unitCostBasis: string | null;
  taxRate: string | null;
  unitCostTaxIncluded: string | null;
  unitCostTaxExcluded: string | null;
  prodYear: string | null;
  supplierName: string | null;
  supplierContact: string | null;
  supplierPhone: string | null;
  packageType: string | null;
  lotNumber: string | null;
  supplierOrderNo: string | null;
  status: InboundStatus;
  inboundDate: string;
  actualInboundDate: string | null;
  actualQty: number | null;
  operator: string | null;
  location: string | null;
  note: string | null;
  photos: unknown;
  paymentTrackedAt: Date | null;
  paymentTrackedByUserId: number | null;
  warehouseAddress?: string | null;
  procurementRegion?: string | null;
  priceMissing?: boolean | number;
  bulkBatchId?: number | null;
  bulkSourceRow?: number | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  receiveRequestId: string | null;
  receivePayloadHash: string | null;
  createdAt: Date;
  paidAmount?: string | number;
  refundedPaymentCount?: number | string;
};

function receivePayloadHash(input: z.infer<typeof receiveInputSchema>) {
  return createHash("sha256").update(JSON.stringify({
    id: input.id,
    actualInboundDate: input.actualInboundDate,
    actualQty: input.actualQty,
    location: input.location,
  })).digest("hex");
}

function pricingForInboundCreate(input: Pick<z.infer<typeof inboundDataSchema>, "unitCost" | "unitCostBasis" | "taxRate">) {
  if (input.unitCost == null || input.unitCostBasis == null || input.taxRate == null) return null;
  return normalizeInboundPricing(input.unitCost, input.unitCostBasis, input.taxRate);
}

function inboundSnapshot(input: z.infer<typeof inboundDataSchema>) {
  const pricing = pricingForInboundCreate(input);
  const snapshot: Record<string, unknown> = {
    status: input.status,
    partNumber: input.partNumber,
    brand: input.brand ?? null,
    qty: input.qty,
    unitCost: pricing?.unitCost ?? null,
    unitCostBasis: pricing?.unitCostBasis ?? null,
    taxRate: pricing?.taxRate ?? null,
    unitCostTaxIncluded: pricing?.unitCostTaxIncluded ?? null,
    unitCostTaxExcluded: pricing?.unitCostTaxExcluded ?? null,
    prodYear: input.prodYear,
    supplierName: input.supplierName,
    supplierContact: input.supplierContact ?? null,
    supplierPhone: input.supplierPhone ?? null,
    packageType: input.packageType ?? null,
    lotNumber: input.lotNumber ?? null,
    supplierOrderNo: input.supplierOrderNo ?? null,
    inboundDate: input.inboundDate,
    operator: input.operator ?? null,
    location: input.location ?? null,
    note: input.note ?? null,
    photos: input.photos ?? [],
  };
  /* Keep legacy single-create payload fingerprints exactly compatible. */
  if (input.warehouseAddress) snapshot.warehouseAddress = input.warehouseAddress;
  if (input.procurementRegion) snapshot.procurementRegion = input.procurementRegion;
  if (input.priceMissing === true) snapshot.priceMissing = true;
  return snapshot;
}

function inboundPayloadHash(input: z.infer<typeof inboundCreateSchema>) {
  return createHash("sha256").update(JSON.stringify({
    ...inboundSnapshot(input),
    payment: input.payment,
  })).digest("hex");
}

function includedUnitCostFromInbound(row: Pick<InboundRow, "unitCost" | "unitCostBasis" | "unitCostTaxIncluded">) {
  if (row.unitCostTaxIncluded != null) return row.unitCostTaxIncluded;
  return row.unitCost != null && row.unitCostBasis === CNY_TAX_INCLUDED ? row.unitCost : null;
}

function payableAmountForInbound(row: Pick<InboundRow, "qty" | "actualQty" | "unitCost" | "unitCostBasis" | "unitCostTaxIncluded">) {
  const included = includedUnitCostFromInbound(row);
  return included == null ? null : inboundPayableString(included, Number(row.actualQty ?? row.qty));
}

function initialPaymentForCreate(input: z.infer<typeof inboundCreateSchema>, pricing: ReturnType<typeof pricingForInboundCreate>) {
  const payableAmount = pricing ? inboundPayableString(pricing.unitCostTaxIncluded, input.qty) : null;
  if (input.payment.mode === INBOUND_PAYMENT_UNPAID) {
    return { payableAmount, paidAmount: "0.00", payment: null };
  }
  if (payableAmount == null || inboundMoneyCents(payableAmount) <= BigInt(0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "当前采购货款为零或未知，不能登记付款" });
  }
  if (input.payment.paymentDate! > beijingDateKey()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "付款日期不能晚于今天" });
  }
  const paidAmount = input.payment.mode === INBOUND_PAYMENT_PAID
    ? payableAmount
    : normalizeInboundMoney(input.payment.amount ?? "0");
  const paidCents = inboundMoneyCents(paidAmount);
  const payableCents = inboundMoneyCents(payableAmount);
  if (paidCents <= BigInt(0) || paidCents > payableCents) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已付款金额必须大于0且不能超过采购货款" });
  }
  if (input.payment.mode === INBOUND_PAYMENT_PARTIAL && paidCents >= payableCents) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "付款金额等于全款时请选择“已付全款”" });
  }
  return {
    payableAmount,
    paidAmount,
    payment: {
      amount: paidAmount,
      paymentDate: input.payment.paymentDate!,
      note: input.payment.note ?? null,
    },
  };
}

function paymentPayloadHash(input: { inboundOrderId: number; actorUserId: number; amount: string; paymentDate: string; note: string | null }) {
  return createHash("sha256").update(JSON.stringify({ entryType: "payment", ...input })).digest("hex");
}

function withInboundPaymentSummary(row: InboundRow) {
  const payableAmount = payableAmountForInbound(row);
  const paidAmount = normalizeInboundMoney(row.paidAmount ?? "0");
  const paymentTracked = row.paymentTrackedAt != null;
  const outstandingAmount = payableAmount == null
    ? null
    : inboundMoneyStringFromCents(
        inboundMoneyCents(payableAmount) > inboundMoneyCents(paidAmount)
          ? inboundMoneyCents(payableAmount) - inboundMoneyCents(paidAmount)
          : BigInt(0),
      );
  return {
    ...row,
    payableAmount,
    paidAmount,
    paymentTracked,
    paymentCategory: classifyInboundPayment({
      tracked: paymentTracked,
      cancelled: row.status === "cancelled",
      refunded: Number(row.refundedPaymentCount ?? 0) > 0,
      payableAmount,
      paidAmount,
    }),
    paymentPercentage: inboundPaymentPercentage(paidAmount, payableAmount),
    outstandingAmount,
  };
}

function decodeInboundPhotoBase64(base64: string, mimeType: z.infer<typeof inboundPhotoMimeSchema>) {
  const encoded = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片内容无效" });
  }
  const data = Buffer.from(encoded, "base64");
  if (data.length === 0 || data.length > MAX_INBOUND_PHOTO_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "单张图片不能超过5MB" });
  }
  const matches = mimeType === "image/jpeg"
    ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : mimeType === "image/png"
      ? data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  if (!matches) throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式与文件内容不一致" });
  return data;
}

function parseInboundPhotoRefs(value: unknown): InboundPhotoRef[] {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    const parsed = z.array(inboundPhotoRefSchema).max(MAX_INBOUND_PHOTOS).safeParse(raw ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function assertOwnedInboundPhotos(photos: InboundPhotoRef[] | undefined, ownerUserId: number) {
  const prefix = `inbound-photos/${ownerUserId}/`;
  if ((photos ?? []).some(photo => !photo.key.startsWith(prefix))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "入库照片引用无效" });
  }
}

function pricingForInboundUpdate(input: z.infer<typeof inboundDataSchema>, existing: InboundRow) {
  /*
   * A blank Excel price is stored as normalized 0 plus priceMissing.  Older
   * transit forms may round-trip it as absent or 0; neither may erase the
   * provenance.  A positive, fully validated replacement below is an actual
   * price and the UPDATE path then clears the marker.
   */
  if (existing.priceMissing && (input.unitCost == null || input.unitCost === 0)) {
    const existingBasis = existing.unitCostBasis === CNY_TAX_EXCLUDED ? CNY_TAX_EXCLUDED : CNY_TAX_INCLUDED;
    return {
      unitCost: Number(existing.unitCost ?? 0),
      unitCostBasis: existingBasis,
      taxRate: existing.taxRate != null ? Number(existing.taxRate) : 0,
      unitCostTaxIncluded: existing.unitCostTaxIncluded != null
        ? Number(existing.unitCostTaxIncluded)
        : existingBasis === CNY_TAX_INCLUDED ? Number(existing.unitCost ?? 0) : 0,
      unitCostTaxExcluded: existing.unitCostTaxExcluded != null
        ? Number(existing.unitCostTaxExcluded)
        : existingBasis === CNY_TAX_EXCLUDED ? Number(existing.unitCost ?? 0) : 0,
    };
  }
  if (input.unitCost == null) {
    if (input.unitCostBasis != null || input.taxRate != null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "请先填写采购单价" });
    }
    return null;
  }
  if (input.unitCostBasis != null && input.taxRate != null) {
    return normalizeInboundPricing(input.unitCost, input.unitCostBasis, input.taxRate);
  }

  const existingBasis = existing.unitCostBasis === CNY_TAX_EXCLUDED ? CNY_TAX_EXCLUDED : CNY_TAX_INCLUDED;
  const unchangedLegacyPrice = existing.unitCost != null
    && existing.taxRate == null
    && Math.abs(Number(existing.unitCost) - input.unitCost) < 0.0000005
    && input.unitCostBasis === existingBasis;
  if (!unchangedLegacyPrice) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "历史单价未记录税率；修改价格前请先确认税率" });
  }
  return {
    unitCost: Number(existing.unitCost),
    unitCostBasis: existingBasis,
    taxRate: null,
    unitCostTaxIncluded: existing.unitCostTaxIncluded != null
      ? Number(existing.unitCostTaxIncluded)
      : existingBasis === CNY_TAX_INCLUDED ? Number(existing.unitCost) : null,
    unitCostTaxExcluded: existing.unitCostTaxExcluded != null ? Number(existing.unitCostTaxExcluded) : null,
  };
}

async function upsertStockLedgerInTx(
  tx: any,
  inboundOrderId: number,
  userId: number,
  partNumber: string,
  brand: string | null,
  qty: number,
  unitCost: number | null,
  unitCostBasis: "CNY_TAX_INCLUDED" | null,
) {
  await tx.execute(sql`
    INSERT INTO stock_ledger (userId, partNumber, brand, totalQtyIn, totalQtyOut, currentQty, avgCost, costBasis, movementVersion)
    VALUES (${userId}, ${partNumber}, ${brand}, 0, 0, 0, NULL, NULL, 0)
    ON DUPLICATE KEY UPDATE id = id
  `);
  const ledgerResult = await tx.execute(sql`
    SELECT totalQtyIn, currentQty, avgCost, costBasis, movementVersion
      FROM stock_ledger
     WHERE userId = ${userId} AND partNumber = ${partNumber}
     LIMIT 1 FOR UPDATE
  `);
  const ledger = (ledgerResult as unknown as [[{
    totalQtyIn: number; currentQty: number; avgCost: string | null; costBasis: string | null; movementVersion: number;
  }], unknown])[0][0];
  if (!ledger) throw new Error("库存台账初始化失败");
  const beforeTotalQtyIn = Number(ledger.totalQtyIn);
  const beforeCurrentQty = Number(ledger.currentQty);
  const beforeAvgCost = ledger.avgCost != null ? Number(ledger.avgCost) : null;
  const beforeCostBasis = ledger.costBasis;
  const beforeMovementVersion = Number(ledger.movementVersion);
  const afterTotalQtyIn = beforeTotalQtyIn + qty;
  const afterCurrentQty = beforeCurrentQty + qty;
  let afterAvgCost: number | null = null;
  let afterCostBasis: string | null = null;
  if (beforeCurrentQty === 0) {
    afterAvgCost = unitCost;
    afterCostBasis = unitCost != null ? unitCostBasis : null;
  } else if (beforeAvgCost != null && beforeCostBasis === unitCostBasis && unitCost != null && unitCostBasis != null) {
    afterAvgCost = weightedInboundAverageCost(ledger.avgCost!, beforeCurrentQty, unitCost, qty);
    afterCostBasis = unitCostBasis;
  }
  const afterMovementVersion = beforeMovementVersion + 1;
  await tx.execute(sql`
    UPDATE stock_ledger
       SET totalQtyIn = ${afterTotalQtyIn}, currentQty = ${afterCurrentQty}, avgCost = ${afterAvgCost},
           costBasis = ${afterCostBasis}, movementVersion = ${afterMovementVersion}, brand = COALESCE(${brand}, brand)
     WHERE userId = ${userId} AND partNumber = ${partNumber}
  `);
  await tx.execute(sql`
    INSERT INTO inbound_ledger_effects
      (inboundOrderId, ownerUserId, partNumber, qty, unitCost, unitCostBasis,
       beforeTotalQtyIn, beforeCurrentQty, beforeAvgCost, beforeCostBasis, beforeMovementVersion,
       afterTotalQtyIn, afterCurrentQty, afterAvgCost, afterCostBasis, afterMovementVersion)
    VALUES
      (${inboundOrderId}, ${userId}, ${partNumber}, ${qty}, ${unitCost}, ${unitCostBasis},
       ${beforeTotalQtyIn}, ${beforeCurrentQty}, ${beforeAvgCost}, ${beforeCostBasis}, ${beforeMovementVersion},
       ${afterTotalQtyIn}, ${afterCurrentQty}, ${afterAvgCost}, ${afterCostBasis}, ${afterMovementVersion})
  `);
}

async function reverseReceivedInboundTx(
  tx: any,
  userId: number,
  actorUserId: number,
  reason: string,
  row: InboundRow,
  expectedMovementVersion?: number,
) {
  const ledgerResult = await tx.execute(sql`
    SELECT totalQtyIn, currentQty, avgCost, costBasis, movementVersion
      FROM stock_ledger
     WHERE userId = ${userId} AND partNumber = ${row.partNumber}
     LIMIT 1 FOR UPDATE
  `);
  const ledger = (ledgerResult as unknown as [[{
    totalQtyIn: number; currentQty: number; avgCost: string | null; costBasis: string | null; movementVersion: number;
  }], unknown])[0][0];
  const effectResult = await tx.execute(sql`
    SELECT * FROM inbound_ledger_effects
     WHERE inboundOrderId = ${row.id} AND ownerUserId = ${userId}
     LIMIT 1 FOR UPDATE
  `);
  const effect = (effectResult as unknown as [[{
    id: number; reversedAt: Date | null; beforeTotalQtyIn: number; beforeCurrentQty: number; beforeAvgCost: string | null;
    beforeCostBasis: string | null; beforeMovementVersion: number;
    afterTotalQtyIn: number; afterCurrentQty: number; afterAvgCost: string | null;
    afterCostBasis: string | null; afterMovementVersion: number;
  }], unknown])[0][0];
  if (!ledger || !effect) throw new TRPCError({ code: "CONFLICT", message: "该历史入库单缺少可逆台账凭证，已阻止自动冲销，请联系平台核对。" });
  if (effect.reversedAt) throw new TRPCError({ code: "CONFLICT", message: "库存凭证已冲销，请刷新后核对" });
  const requiredMovementVersion = expectedMovementVersion ?? Number(effect.afterMovementVersion);
  const sameCost = ledger.avgCost == null && effect.afterAvgCost == null
    || ledger.avgCost != null && effect.afterAvgCost != null
      && roundInboundPrice(Number(ledger.avgCost)) === roundInboundPrice(Number(effect.afterAvgCost));
  if (Number(ledger.totalQtyIn) !== Number(effect.afterTotalQtyIn)
      || Number(ledger.currentQty) !== Number(effect.afterCurrentQty)
      || ledger.costBasis !== effect.afterCostBasis
      || Number(ledger.movementVersion) !== requiredMovementVersion
      || !sameCost) {
    throw new TRPCError({ code: "CONFLICT", message: "该型号在本次入库后已有库存变动，不能直接作废；请先处理后续业务单。" });
  }
  const result = await tx.execute(sql`
    UPDATE stock_ledger
       SET totalQtyIn = ${effect.beforeTotalQtyIn},
           currentQty = ${effect.beforeCurrentQty},
           avgCost = ${effect.beforeAvgCost != null ? Number(effect.beforeAvgCost) : null},
           costBasis = ${effect.beforeCostBasis},
           movementVersion = movementVersion + 1
     WHERE userId = ${userId}
       AND partNumber = ${row.partNumber}
       AND totalQtyIn = ${effect.afterTotalQtyIn}
       AND currentQty = ${effect.afterCurrentQty}
       AND movementVersion = ${requiredMovementVersion}
  `);
  if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "库存刚刚发生变化，请刷新后重试作废。" });
  await tx.execute(sql`
    UPDATE inbound_ledger_effects
       SET reversedAt = NOW(), reversedByUserId = ${actorUserId}, reverseReason = ${reason}
     WHERE id = ${effect.id} AND reversedAt IS NULL
  `);
  return requiredMovementVersion + 1;
}

async function addEvent(tx: any, rowId: number, ownerUserId: number, actorUserId: number, eventType: string, reason: string | null, snapshot: unknown) {
  await tx.execute(sql`
    INSERT INTO inbound_order_events (inboundOrderId, ownerUserId, actorUserId, eventType, reason, snapshot)
    VALUES (${rowId}, ${ownerUserId}, ${actorUserId}, ${eventType}, ${reason}, ${JSON.stringify(snapshot)})
  `);
}

async function paidCentsForInboundInTx(tx: any, inboundOrderId: number, ownerUserId: number) {
  const result = await tx.execute(sql`
    SELECT amount FROM inbound_payment_entries
     WHERE inboundOrderId = ${inboundOrderId} AND ownerUserId = ${ownerUserId} AND voidedAt IS NULL
     ORDER BY id FOR UPDATE
  `);
  const rows = (result as unknown as [[{ amount: string }], unknown])[0];
  return rows.reduce((sum, row) => sum + inboundMoneyCents(row.amount), BigInt(0));
}

type ActiveInboundPayment = { id: number; inboundOrderId: number; amount: string; paymentDate: string };

function inboundPaymentFingerprint(entries: ActiveInboundPayment[]) {
  return createHash("sha256").update(JSON.stringify(entries.map(entry => ({
    id: Number(entry.id),
    inboundOrderId: Number(entry.inboundOrderId),
    amount: normalizeInboundMoney(entry.amount),
    paymentDate: String(entry.paymentDate),
  })))).digest("hex");
}

async function loadActiveInboundPayments(executor: any, ownerUserId: number, inboundOrderIds: number[], lock = false) {
  if (!inboundOrderIds.length) return [] as ActiveInboundPayment[];
  const result = await executor.execute(sql`
    SELECT id, inboundOrderId, amount, paymentDate FROM inbound_payment_entries
     WHERE ownerUserId = ${ownerUserId} AND voidedAt IS NULL
       AND inboundOrderId IN (${sql.join(inboundOrderIds.map(id => sql`${id}`), sql`, `)})
     ORDER BY inboundOrderId, id
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return (result as unknown as [ActiveInboundPayment[], unknown])[0];
}

async function markInboundPaymentsRefundedInTx(
  tx: any,
  inboundOrderId: number,
  ownerUserId: number,
  actorUserId: number,
  reason: string,
  entries: ActiveInboundPayment[],
) {
  if (!entries.length) return { count: 0, amount: "0.00" };
  const paymentIds = entries.map(entry => entry.id);
  const refundReason = `线下退款：${reason}`;
  const updated = await tx.execute(sql`
    UPDATE inbound_payment_entries
       SET voidedAt = NOW(), voidedByUserId = ${actorUserId}, voidReason = ${refundReason}
     WHERE ownerUserId = ${ownerUserId} AND voidedAt IS NULL
       AND inboundOrderId = ${inboundOrderId}
       AND id IN (${sql.join(paymentIds.map(id => sql`${id}`), sql`, `)})
  `);
  if (affectedRows(updated) !== entries.length) {
    throw new TRPCError({ code: "CONFLICT", message: "付款记录已变化，请刷新后重试" });
  }
  const amountCents = entries.reduce((sum, entry) => sum + inboundMoneyCents(entry.amount), BigInt(0));
  await addEvent(tx, inboundOrderId, ownerUserId, actorUserId, "payments_refunded_offline", reason, {
    paymentIds,
    count: entries.length,
    amount: inboundMoneyStringFromCents(amountCents),
    payments: entries,
  });
  return { count: entries.length, amount: inboundMoneyStringFromCents(amountCents) };
}

function inboundBulkPayloadHash(input: InboundBulkCreateInput) {
  return createHash("sha256").update(JSON.stringify({
    status: input.status,
    inboundDate: input.inboundDate,
    unitCostBasis: input.unitCostBasis,
    taxRate: input.taxRate,
    acceptMissingPrices: input.acceptMissingPrices,
    rows: input.rows.map(row => ({
      sourceRow: row.sourceRow,
      partNumber: row.partNumber,
      brand: row.brand,
      qty: row.qty,
      prodYear: row.prodYear,
      unitCost: row.unitCost,
      warehouseAddress: row.warehouseAddress,
      operator: row.operator,
      supplierName: row.supplierName,
      supplierContact: row.supplierContact,
      procurementRegion: row.procurementRegion,
      location: row.location,
      note: row.note,
    })),
  })).digest("hex");
}

function decodeInboundBulkResult(value: unknown): InboundBulkCreateResult | null {
  try {
    const result = (typeof value === "string" ? JSON.parse(value) : value) as Partial<InboundBulkCreateResult> | null;
    if (!result || result.success !== true || typeof result.batchId !== "number" || typeof result.count !== "number"
        || typeof result.missingPriceCount !== "number" || !Array.isArray(result.items)) return null;
    if (result.items.some(item => !item || typeof item.sourceRow !== "number" || typeof item.id !== "number"
      || typeof item.slipNo !== "string" || (item.status !== "in_transit" && item.status !== "received"))) return null;
    return result as InboundBulkCreateResult;
  } catch {
    return null;
  }
}

/**
 * Database core of inbound.bulkCreate. The unique owner/request row serializes
 * concurrent submits; all rows, stock effects, events and the replay record
 * live inside one transaction, so an error on any row leaves no partial batch.
 */
export async function createInboundBulk(
  db: Awaited<ReturnType<typeof requireDb>>,
  ownerUserId: number,
  actorUserId: number,
  input: InboundBulkCreateInput,
): Promise<InboundBulkCreateResult> {
  input = inboundBulkCreateSchema.parse(input);
  const payloadHash = inboundBulkPayloadHash(input);
  return db.transaction(async tx => {
    let batchId = 0;
    try {
      const inserted = await tx.execute(sql`
        INSERT INTO inbound_bulk_requests (ownerUserId, requestId, payloadHash, actorUserId)
        VALUES (${ownerUserId}, ${input.clientRequestId}, ${payloadHash}, ${actorUserId})
      `);
      batchId = insertId(inserted);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
    }
    const requestResult = await tx.execute(sql`
      SELECT id, payloadHash, result FROM inbound_bulk_requests
       WHERE ownerUserId = ${ownerUserId} AND requestId = ${input.clientRequestId}
       LIMIT 1 FOR UPDATE
    `);
    const request = (requestResult as unknown as [[{ id: number; payloadHash: string; result: unknown }], unknown])[0][0];
    if (!request || request.payloadHash !== payloadHash) {
      throw new TRPCError({ code: "CONFLICT", message: "同一请求标识的批量入库内容不一致，请刷新页面后重新提交" });
    }
    if (!batchId) {
      const prior = decodeInboundBulkResult(request.result);
      if (!prior) throw new TRPCError({ code: "CONFLICT", message: "批量入库请求正在处理或结果缺失，请稍后重试" });
      return { ...prior, replayed: true };
    }
    if (Number(request.id) !== batchId) {
      throw new TRPCError({ code: "CONFLICT", message: "批量入库请求幂等绑定失败，请重试" });
    }

    const received = input.status === "received";
    const items: InboundBulkCreateResult["items"] = [];
    let missingPriceCount = 0;
    const rowsInWriteOrder = received
      ? [...input.rows].sort((left, right) => left.partNumber < right.partNumber ? -1 : left.partNumber > right.partNumber ? 1 : left.sourceRow - right.sourceRow)
      : input.rows;
    for (const row of rowsInWriteOrder) {
      const priceMissing = row.unitCost === null;
      if (priceMissing) missingPriceCount += 1;
      const pricing = normalizeInboundPricing(row.unitCost ?? 0, input.unitCostBasis, input.taxRate);
      const slipNo = await generateSlipNo(tx);
      const inserted = await tx.execute(sql`
        INSERT INTO inbound_orders
          (slipNo, userId, partNumber, brand, qty, unitCost, unitCostBasis, taxRate, unitCostTaxIncluded, unitCostTaxExcluded,
           prodYear, supplierName, supplierContact, supplierPhone, packageType, lotNumber, supplierOrderNo,
           status, inboundDate, actualInboundDate, actualQty, operator, location, warehouseAddress, procurementRegion,
           note, photos, receivedAt, receivedByUserId, writeVersion, paymentTrackedAt, paymentTrackedByUserId,
           priceMissing, bulkBatchId, bulkSourceRow)
        VALUES
          (${slipNo}, ${ownerUserId}, ${row.partNumber}, ${row.brand || null}, ${row.qty},
           ${pricing.unitCost}, ${pricing.unitCostBasis}, ${pricing.taxRate}, ${pricing.unitCostTaxIncluded}, ${pricing.unitCostTaxExcluded},
           ${row.prodYear}, ${row.supplierName}, ${row.supplierContact || null}, NULL, NULL, NULL, NULL,
           ${input.status}, ${input.inboundDate}, ${received ? input.inboundDate : null}, ${received ? row.qty : null},
           ${row.operator}, ${row.location || null}, ${row.warehouseAddress || null}, ${row.procurementRegion || null},
           ${row.note || null}, ${JSON.stringify([])}, ${received ? sql`NOW()` : null}, ${received ? actorUserId : null}, 4,
           NOW(), ${actorUserId}, ${priceMissing}, ${batchId}, ${row.sourceRow})
      `);
      const id = insertId(inserted);
      if (!id) throw new Error("批量入库单写入失败");
      if (received) {
        await upsertStockLedgerInTx(
          tx, id, ownerUserId, row.partNumber, row.brand || null, row.qty,
          pricing.unitCostTaxIncluded, CNY_TAX_INCLUDED,
        );
      }
      await addEvent(tx, id, ownerUserId, actorUserId, received ? "created_received" : "created_in_transit", null, {
        after: {
          status: input.status, partNumber: row.partNumber, brand: row.brand || null, qty: row.qty,
          unitCost: pricing.unitCost, unitCostBasis: pricing.unitCostBasis, taxRate: pricing.taxRate,
          unitCostTaxIncluded: pricing.unitCostTaxIncluded, unitCostTaxExcluded: pricing.unitCostTaxExcluded,
          prodYear: row.prodYear, supplierName: row.supplierName, supplierContact: row.supplierContact || null,
          inboundDate: input.inboundDate, operator: row.operator, location: row.location || null,
          warehouseAddress: row.warehouseAddress || null, procurementRegion: row.procurementRegion || null,
          note: row.note || null, priceMissing, bulkBatchId: batchId, bulkSourceRow: row.sourceRow,
        },
        /* No payment entry is created; payment tracking is explicitly started as unpaid. */
        payment: { mode: INBOUND_PAYMENT_UNPAID, payableAmount: inboundPayableString(pricing.unitCostTaxIncluded, row.qty), paidAmount: "0.00" },
      });
      items.push({ sourceRow: row.sourceRow, id, slipNo, status: input.status });
    }
    items.sort((left, right) => left.sourceRow - right.sourceRow);
    const result: InboundBulkCreateResult = {
      success: true, replayed: false, batchId, count: items.length, missingPriceCount, items,
    };
    const bound = await tx.execute(sql`
      UPDATE inbound_bulk_requests SET result = ${JSON.stringify(result)}
       WHERE id = ${batchId} AND ownerUserId = ${ownerUserId} AND payloadHash = ${payloadHash} AND result IS NULL
    `);
    if (affectedRows(bound) !== 1) throw new TRPCError({ code: "CONFLICT", message: "批量入库结果保存失败，请重试" });
    return result;
  });
}

async function cancelInboundOrderInTx(
  tx: any,
  ownerUserId: number,
  actorUserId: number,
  id: number,
  reason: string,
  allowReceived = true,
  refundConfirmed = false,
  expectedMovementVersion?: number,
  expectedPaymentFingerprint?: string,
) {
  const result = await tx.execute(sql`
    SELECT * FROM inbound_orders WHERE id = ${id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
  `);
  const existing = (result as unknown as [InboundRow[], unknown])[0][0];
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
  if (existing.status === "cancelled") return { success: true, alreadyCancelled: true, refundedPaymentCount: 0, refundedAmount: "0.00", nextMovementVersion: undefined } as const;
  const activePayments = await loadActiveInboundPayments(tx, ownerUserId, [existing.id], true);
  if (activePayments.length && !expectedPaymentFingerprint) {
    throw new TRPCError({ code: "CONFLICT", message: "付款记录已变化，请重新确认" });
  }
  if (expectedPaymentFingerprint && inboundPaymentFingerprint(activePayments) !== expectedPaymentFingerprint) {
    throw new TRPCError({ code: "CONFLICT", message: "付款记录已变化，请重新确认" });
  }
  const paidCents = activePayments.reduce((sum, entry) => sum + inboundMoneyCents(entry.amount), BigInt(0));
  if (paidCents > BigInt(0) && !refundConfirmed) throw new TRPCError({ code: "CONFLICT", message: "请确认线下退款" });
  if (existing.status === "received" && !allowReceived) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已入库单请刷新页面后填写原因并使用“作废”操作" });
  }
  const nextMovementVersion = existing.status === "received"
    ? await reverseReceivedInboundTx(tx, ownerUserId, actorUserId, reason, existing, expectedMovementVersion)
    : undefined;
  const refund = paidCents > BigInt(0)
    ? await markInboundPaymentsRefundedInTx(tx, existing.id, ownerUserId, actorUserId, reason, activePayments)
    : { count: 0, amount: "0.00" };
  const updated = await tx.execute(sql`
    UPDATE inbound_orders
       SET status = 'cancelled', cancelledAt = NOW(), cancelledByUserId = ${actorUserId}, cancelReason = ${reason}, writeVersion = 4
     WHERE id = ${id} AND userId = ${ownerUserId} AND status <> 'cancelled'
  `);
  if (affectedRows(updated) !== 1) throw new TRPCError({ code: "CONFLICT", message: "入库单状态已变化，请刷新后重试" });
  await addEvent(tx, id, ownerUserId, actorUserId, existing.status === "received" ? "cancelled_received" : "cancelled_in_transit", reason, {
    before: existing,
    after: { status: "cancelled", cancelReason: reason },
    reversedQty: existing.status === "received" ? Number(existing.actualQty ?? existing.qty) : 0,
    refund,
  });
  return { success: true, alreadyCancelled: false, refundedPaymentCount: refund.count, refundedAmount: refund.amount, nextMovementVersion } as const;
}

async function cancelInboundOrder(
  db: Awaited<ReturnType<typeof requireDb>>,
  ownerUserId: number,
  actorUserId: number,
  id: number,
  reason: string,
  allowReceived = true,
  refundConfirmed = false,
  expectedPaymentFingerprint?: string,
) {
  return db.transaction(tx => cancelInboundOrderInTx(tx, ownerUserId, actorUserId, id, reason, allowReceived, refundConfirmed, undefined, expectedPaymentFingerprint));
}

type InboundCancelSelection = z.infer<typeof inboundCancelSelectionSchema>;
type InboundCancelRow = Pick<InboundRow, "id" | "slipNo" | "partNumber" | "status" | "bulkBatchId">;

async function resolveInboundCancelRows(executor: any, ownerUserId: number, selection: InboundCancelSelection, lock = false) {
  const scope = selection.ids
    ? sql`io.id IN (${sql.join(selection.ids.map(id => sql`${id}`), sql`, `)})`
    : sql`io.bulkBatchId = ${selection.bulkBatchId!}`;
  const result = await executor.execute(sql`
    SELECT io.id, io.slipNo, io.partNumber, io.status, io.bulkBatchId
      FROM inbound_orders io
     WHERE io.userId = ${ownerUserId} AND ${scope}
     ORDER BY io.id DESC
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  const rows = (result as unknown as [InboundCancelRow[], unknown])[0];
  if (!rows.length || selection.ids && rows.length !== selection.ids.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
  }
  if (rows.length > MAX_INBOUND_CANCEL_ROWS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `每次最多作废${MAX_INBOUND_CANCEL_ROWS}单` });
  }
  return rows;
}

export async function previewInboundCancellation(db: Awaited<ReturnType<typeof requireDb>>, ownerUserId: number, selection: InboundCancelSelection) {
  const rows = await resolveInboundCancelRows(db, ownerUserId, selection);
  const activeRows = rows.filter(row => row.status !== "cancelled");
  const payments = await loadActiveInboundPayments(db, ownerUserId, activeRows.map(row => row.id));
  const paidByOrder = new Map<number, bigint>();
  for (const payment of payments) {
    paidByOrder.set(Number(payment.inboundOrderId), (paidByOrder.get(Number(payment.inboundOrderId)) ?? BigInt(0)) + inboundMoneyCents(payment.amount));
  }
  const paidRows = activeRows.filter(row => (paidByOrder.get(row.id) ?? BigInt(0)) > BigInt(0));
  const paidCents = payments.reduce((sum, row) => sum + inboundMoneyCents(row.amount), BigInt(0));
  return {
    count: activeRows.length,
    ignoredCount: rows.length - activeRows.length,
    paidCount: paidRows.length,
    paidAmount: inboundMoneyStringFromCents(paidCents),
    paymentFingerprint: inboundPaymentFingerprint(payments),
    rows: activeRows.map(row => ({
      id: row.id,
      slipNo: row.slipNo,
      partNumber: row.partNumber,
      status: row.status,
      bulkBatchId: row.bulkBatchId,
      paidAmount: inboundMoneyStringFromCents(paidByOrder.get(row.id) ?? BigInt(0)),
    })),
  };
}

export async function cancelInboundOrders(
  db: Awaited<ReturnType<typeof requireDb>>,
  ownerUserId: number,
  actorUserId: number,
  selection: InboundCancelSelection,
  reason: string,
  refundConfirmed: boolean,
  expectedPaymentFingerprint: string,
) {
  return db.transaction(async tx => {
    const rows = await resolveInboundCancelRows(tx, ownerUserId, selection, true);
    const activeRows = rows.filter(row => row.status !== "cancelled");
    if (!activeRows.length) return { success: true, count: 0, ignoredCount: rows.length, refundedPaymentCount: 0, refundedAmount: "0.00" } as const;
    const payments = await loadActiveInboundPayments(tx, ownerUserId, activeRows.map(row => row.id), true);
    if (inboundPaymentFingerprint(payments) !== expectedPaymentFingerprint) {
      throw new TRPCError({ code: "CONFLICT", message: "付款记录已变化，请重新确认" });
    }
    const paidCents = payments.reduce((sum, row) => sum + inboundMoneyCents(row.amount), BigInt(0));
    if (paidCents > BigInt(0) && !refundConfirmed) throw new TRPCError({ code: "CONFLICT", message: "请确认线下退款" });
    const paymentsByOrder = new Map<number, ActiveInboundPayment[]>();
    for (const payment of payments) {
      const orderId = Number(payment.inboundOrderId);
      paymentsByOrder.set(orderId, [...(paymentsByOrder.get(orderId) ?? []), payment]);
    }

    const receivedIds = activeRows.filter(row => row.status === "received").map(row => row.id);
    const effectIds = new Map<number, number>();
    if (receivedIds.length) {
      const partNumbers = Array.from(new Set(activeRows.filter(row => row.status === "received").map(row => row.partNumber))).sort();
      await tx.execute(sql`
        SELECT partNumber FROM stock_ledger
         WHERE userId = ${ownerUserId}
           AND partNumber IN (${sql.join(partNumbers.map(partNumber => sql`${partNumber}`), sql`, `)})
         ORDER BY BINARY partNumber FOR UPDATE
      `);
      const effectResult = await tx.execute(sql`
        SELECT id, inboundOrderId FROM inbound_ledger_effects
         WHERE ownerUserId = ${ownerUserId}
           AND inboundOrderId IN (${sql.join(receivedIds.map(id => sql`${id}`), sql`, `)})
         ORDER BY id DESC FOR UPDATE
      `);
      for (const effect of (effectResult as unknown as [[{ id: number; inboundOrderId: number }], unknown])[0]) {
        effectIds.set(Number(effect.inboundOrderId), Number(effect.id));
      }
      if (effectIds.size !== receivedIds.length) {
        throw new TRPCError({ code: "CONFLICT", message: "部分入库单缺少库存凭证" });
      }
    }

    const orderedRows = [...activeRows].sort((left, right) => {
      const partOrder = left.partNumber < right.partNumber ? -1 : left.partNumber > right.partNumber ? 1 : 0;
      if (partOrder !== 0) return partOrder;
      if (left.status === "received" && right.status === "received") return effectIds.get(right.id)! - effectIds.get(left.id)!;
      if (left.status === "received") return -1;
      if (right.status === "received") return 1;
      return right.id - left.id;
    });
    const movementVersions = new Map<string, number>();
    let refundedPaymentCount = 0;
    let refundedCents = BigInt(0);
    for (const row of orderedRows) {
      const result = await cancelInboundOrderInTx(
        tx,
        ownerUserId,
        actorUserId,
        row.id,
        reason,
        true,
        refundConfirmed,
        row.status === "received" ? movementVersions.get(row.partNumber) : undefined,
        inboundPaymentFingerprint(paymentsByOrder.get(row.id) ?? []),
      );
      refundedPaymentCount += result.refundedPaymentCount;
      refundedCents += inboundMoneyCents(result.refundedAmount);
      if (row.status === "received" && result.nextMovementVersion != null) {
        movementVersions.set(row.partNumber, result.nextMovementVersion);
      }
    }
    return {
      success: true,
      count: activeRows.length,
      ignoredCount: rows.length - activeRows.length,
      refundedPaymentCount,
      refundedAmount: inboundMoneyStringFromCents(refundedCents),
    } as const;
  });
}

export const inboundRouter = router({
  /** 上传入库实拍照片至企业私有目录；单据保存时再次校验对象归属。 */
  uploadPhoto: inventoryInboundProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      mimeType: inboundPhotoMimeSchema,
      base64: z.string().min(1).max(Math.ceil(MAX_INBOUND_PHOTO_BYTES * 1.4) + 128),
    }))
    .mutation(async ({ ctx, input }) => {
      const data = decodeInboundPhotoBase64(input.base64, input.mimeType);
      const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1];
      const safeStem = input.fileName
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "inbound-photo";
      const key = `inbound-photos/${ctx.effectiveUserId!}/${Date.now()}-${randomUUID()}-${safeStem}.${extension}`;
      const stored = await storagePutPrivate(key, data, input.mimeType);
      return {
        key: stored.key,
        url: await storageGetAccessUrl(stored.key, 3600),
        name: input.fileName,
        mimeType: input.mimeType,
        size: data.length,
      };
    }),

  /** 照片只对本企业入库权限用户签发短时访问地址。 */
  photos: inventoryInboundProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const result = await db.execute(sql`
        SELECT photos FROM inbound_orders
         WHERE id = ${input.id} AND userId = ${ctx.effectiveUserId!}
         LIMIT 1
      `);
      const row = (result as unknown as [[{ photos: unknown }], unknown])[0][0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
      return Promise.all(parseInboundPhotoRefs(row.photos).map(async photo => ({
        ...photo,
        url: await storageGetAccessUrl(photo.key, 3600),
      })));
    }),

  /** 入库表单型号联想：沿用物料字典索引查询，并受 inventory.inbound 权限保护。 */
  suggestPartNumbers: inventoryInboundProcedure
    .input(z.object({
      keyword: z.string().max(100).transform(value => value.normalize("NFKC").trim().toUpperCase()),
      limit: z.number().int().min(1).max(12).default(8),
    }))
    .query(async ({ input }) => {
      if (input.keyword.length < 2 || !adminDbAvailable()) return [];
      try {
        return await dictLookup(input.keyword, input.limit);
      } catch (error) {
        console.error("[inbound.suggestPartNumbers] material dictionary unavailable", error);
        return [];
      }
    }),

  /** 入库页顶部概览：采购付款与现有库存价值分开展示，避免把在途货款混入库存资产。 */
  overview: inventoryInboundProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;
    const [stockResult, paymentResult] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN avgCost IS NOT NULL AND costBasis = 'CNY_TAX_INCLUDED'
                            THEN currentQty * avgCost ELSE 0 END), 0) AS totalValue,
          COALESCE(SUM(currentQty), 0) AS totalQty,
          COALESCE(SUM(CASE WHEN currentQty > 0 AND (avgCost IS NULL OR costBasis IS NULL OR costBasis <> 'CNY_TAX_INCLUDED')
                            THEN 1 ELSE 0 END), 0) AS unknownValueRows
        FROM stock_ledger
        WHERE userId = ${userId}
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(x.paidAmount), 0) AS totalPaidAmount,
          COALESCE(SUM(CASE WHEN x.status = 'in_transit' THEN x.paidAmount ELSE 0 END), 0) AS inTransitPaidAmount,
          COALESCE(SUM(CASE WHEN x.status = 'received' THEN x.paidAmount ELSE 0 END), 0) AS receivedPaidAmount,
          COALESCE(SUM(CASE WHEN x.status = 'cancelled' THEN x.paidAmount ELSE 0 END), 0) AS cancelledPaidAmount,
          COALESCE(SUM(CASE WHEN x.paymentTrackedAt IS NULL THEN 1 ELSE 0 END), 0) AS untrackedCount
        FROM (
          SELECT io.id, io.status, io.paymentTrackedAt,
                 COALESCE(SUM(CASE WHEN pe.voidedAt IS NULL THEN pe.amount ELSE 0 END), 0) AS paidAmount
          FROM inbound_orders io
          LEFT JOIN inbound_payment_entries pe
            ON pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId
          WHERE io.userId = ${userId}
          GROUP BY io.id, io.status, io.paymentTrackedAt
        ) x
      `),
    ]);
    const stock = (stockResult as unknown as [[{
      totalValue: string | null;
      totalQty: number | string;
      unknownValueRows: number | string;
    }], unknown])[0][0];
    const payment = (paymentResult as unknown as [[{
      totalPaidAmount: string | null;
      inTransitPaidAmount: string | null;
      receivedPaidAmount: string | null;
      cancelledPaidAmount: string | null;
      untrackedCount: number | string;
    }], unknown])[0][0];
    return {
      totalPaidAmount: inboundMoneyStringFromCents(inboundMoneyCents(payment?.totalPaidAmount ?? "0")),
      inTransitPaidAmount: inboundMoneyStringFromCents(inboundMoneyCents(payment?.inTransitPaidAmount ?? "0")),
      receivedPaidAmount: inboundMoneyStringFromCents(inboundMoneyCents(payment?.receivedPaidAmount ?? "0")),
      cancelledPaidAmount: inboundMoneyStringFromCents(inboundMoneyCents(payment?.cancelledPaidAmount ?? "0")),
      untrackedCount: Number(payment?.untrackedCount ?? 0),
      totalInventoryValue: inboundMoneyStringFromCents(inboundMoneyCents(stock?.totalValue ?? "0")),
      totalInventoryQty: Number(stock?.totalQty ?? 0),
      totalInventoryValueComplete: Number(stock?.unknownValueRows ?? 0) === 0,
    };
  }),

  list: inventoryInboundProcedure.input(inboundFilterSchema).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;
    const conditions = [sql`io.userId = ${userId}`];
    const cancelledPaymentFilter = input?.paymentCategory === "refunded" || input?.paymentCategory === "cancelled_pending";
    if (!input?.status && !cancelledPaymentFilter) conditions.push(sql`io.status <> 'cancelled'`);
    if (input?.partNumber) conditions.push(sql`io.partNumber LIKE ${`%${input.partNumber}%`}`);
    if (input?.supplierName) conditions.push(sql`io.supplierName LIKE ${`%${input.supplierName}%`}`);
    if (input?.operator) conditions.push(sql`io.operator LIKE ${`%${input.operator}%`}`);
    if (input?.slipNo) conditions.push(sql`io.slipNo LIKE ${`%${input.slipNo}%`}`);
    if (input?.status && input.status !== "all") conditions.push(sql`io.status = ${input.status}`);
    const effectiveDate = input?.status === "in_transit" ? sql`io.inboundDate` : sql`COALESCE(io.actualInboundDate, io.inboundDate)`;
    if (input?.dateFrom) conditions.push(sql`${effectiveDate} >= ${input.dateFrom}`);
    if (input?.dateTo) conditions.push(sql`${effectiveDate} <= ${input.dateTo}`);
    const result = await db.execute(sql`
      SELECT io.*,
             (SELECT COALESCE(SUM(pe.amount), 0)
                FROM inbound_payment_entries pe
               WHERE pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId AND pe.voidedAt IS NULL) AS paidAmount,
             (SELECT COUNT(*)
                FROM inbound_payment_entries pe
               WHERE pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId
                 AND pe.voidedAt IS NOT NULL AND pe.voidReason LIKE '线下退款：%') AS refundedPaymentCount
      FROM inbound_orders io
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY io.createdAt DESC
    `);
    const rows = (result as unknown as [InboundRow[], unknown])[0].map(withInboundPaymentSummary);
    return input?.paymentCategory
      ? rows.filter(row => row.paymentCategory === input.paymentCategory)
      : rows;
  }),

  /** Excel bulk submit is one transaction, never a client-side loop over create. */
  bulkCreate: inventoryInboundProcedure.input(inboundBulkCreateSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    return createInboundBulk(db, ctx.effectiveUserId!, ctx.user.id, input);
  }),

  create: inventoryInboundProcedure.input(inboundCreateSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const ownerUserId = ctx.effectiveUserId!;
    const actorUserId = ctx.user.id;
    assertOwnedInboundPhotos(input.photos, ownerUserId);
    const pricing = pricingForInboundCreate(input);
    const initialPayment = initialPaymentForCreate(input, pricing);
    const payloadHash = inboundPayloadHash(input);
    return db.transaction(async tx => {
      try {
        await tx.execute(sql`
          INSERT INTO inbound_request_keys (ownerUserId, requestId, payloadHash)
          VALUES (${ownerUserId}, ${input.clientRequestId}, ${payloadHash})
        `);
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
      }
      const requestResult = await tx.execute(sql`
        SELECT inboundOrderId, payloadHash FROM inbound_request_keys
         WHERE ownerUserId = ${ownerUserId} AND requestId = ${input.clientRequestId}
         LIMIT 1 FOR UPDATE
      `);
      const requestRow = (requestResult as unknown as [[{ inboundOrderId: number | null; payloadHash: string }], unknown])[0][0];
      if (!requestRow || requestRow.payloadHash !== payloadHash) {
        throw new TRPCError({ code: "CONFLICT", message: "同一请求标识的入库内容不一致，请刷新页面后重新提交" });
      }
      const existingOrderId = Number(requestRow.inboundOrderId ?? 0);
      if (existingOrderId > 0) {
        const priorResult = await tx.execute(sql`
          SELECT id, slipNo, status FROM inbound_orders
           WHERE id = ${existingOrderId} AND userId = ${ownerUserId} LIMIT 1
        `);
        const prior = (priorResult as unknown as [[{ id: number; slipNo: string; status: "in_transit" | "received" }], unknown])[0][0];
        if (!prior) throw new TRPCError({ code: "CONFLICT", message: "重复请求对应的入库单不存在，请联系平台核对" });
        return { success: true, id: prior.id, slipNo: prior.slipNo, status: prior.status, replayed: true } as const;
      }
      const slipNo = await generateSlipNo(tx);
      const received = input.status === "received";
      const inserted = await tx.execute(sql`
        INSERT INTO inbound_orders
          (slipNo, userId, partNumber, brand, qty, unitCost, unitCostBasis, taxRate, unitCostTaxIncluded, unitCostTaxExcluded,
           prodYear, supplierName, supplierContact, supplierPhone,
           packageType, lotNumber, supplierOrderNo, status, inboundDate, actualInboundDate,
           actualQty, operator, location, warehouseAddress, procurementRegion, priceMissing, note, photos,
           receivedAt, receivedByUserId, writeVersion, paymentTrackedAt, paymentTrackedByUserId)
        VALUES
          (${slipNo}, ${ownerUserId}, ${input.partNumber}, ${input.brand ?? null}, ${input.qty},
           ${pricing?.unitCost ?? null}, ${pricing?.unitCostBasis ?? null}, ${pricing?.taxRate ?? null},
           ${pricing?.unitCostTaxIncluded ?? null}, ${pricing?.unitCostTaxExcluded ?? null},
           ${input.prodYear ?? null}, ${input.supplierName ?? null}, ${input.supplierContact ?? null}, ${input.supplierPhone ?? null},
           ${input.packageType ?? null}, ${input.lotNumber ?? null}, ${input.supplierOrderNo ?? null},
           ${input.status}, ${input.inboundDate}, ${received ? input.inboundDate : null},
           ${received ? input.qty : null}, ${input.operator ?? null}, ${input.location ?? null},
           ${input.warehouseAddress ?? null}, ${input.procurementRegion ?? null}, false,
           ${input.note ?? null}, ${JSON.stringify(input.photos ?? [])},
           ${received ? sql`NOW()` : null}, ${received ? actorUserId : null}, 4, NOW(), ${actorUserId})
      `);
      const id = insertId(inserted);
      if (!id) throw new Error("入库单写入失败");
      if (initialPayment.payment) {
        const paymentHash = paymentPayloadHash({ inboundOrderId: id, actorUserId, ...initialPayment.payment });
        await tx.execute(sql`
          INSERT INTO inbound_payment_entries
            (inboundOrderId, ownerUserId, actorUserId, requestId, payloadHash, amount, paymentDate, note)
          VALUES
            (${id}, ${ownerUserId}, ${actorUserId}, ${input.clientRequestId}, ${paymentHash},
             ${initialPayment.payment.amount}, ${initialPayment.payment.paymentDate}, ${initialPayment.payment.note})
        `);
      }
      if (received) {
        await upsertStockLedgerInTx(
          tx, id, ownerUserId, input.partNumber, input.brand ?? null, input.qty,
          pricing?.unitCostTaxIncluded ?? null, pricing ? CNY_TAX_INCLUDED : null,
        );
      }
      await addEvent(tx, id, ownerUserId, actorUserId, received ? "created_received" : "created_in_transit", null, {
        after: inboundSnapshot(input),
        payment: { mode: input.payment.mode, payableAmount: initialPayment.payableAmount, paidAmount: initialPayment.paidAmount },
      });
      const bound = await tx.execute(sql`
        UPDATE inbound_request_keys SET inboundOrderId = ${id}
         WHERE ownerUserId = ${ownerUserId} AND requestId = ${input.clientRequestId}
           AND payloadHash = ${payloadHash} AND inboundOrderId IS NULL
      `);
      if (affectedRows(bound) !== 1) throw new TRPCError({ code: "CONFLICT", message: "入库请求幂等绑定失败，请重试" });
      return { success: true, id, slipNo, status: input.status, replayed: false } as const;
    });
  }),

  update: inventoryInboundProcedure
    .input(z.object({ id: z.number().int().positive(), data: inboundDataSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const ownerUserId = ctx.effectiveUserId!;
      const actorUserId = ctx.user.id;
      assertOwnedInboundPhotos(input.data.photos, ownerUserId);
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
        `);
        const existing = (result as unknown as [InboundRow[], unknown])[0][0];
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
        if (existing.status !== "in_transit") {
          throw new TRPCError({ code: "CONFLICT", message: "只有在途单可以修改；已入库记录请通过作废冲销处理。" });
        }
        if (input.data.status !== "in_transit") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "请使用“确认入库”完成在途转入库。" });
        }
        const pricing = pricingForInboundUpdate(input.data, existing);
        const nextPriceMissing = Boolean(existing.priceMissing)
          && !(input.data.unitCost != null && input.data.unitCost > 0);
        const paidCents = await paidCentsForInboundInTx(tx, existing.id, ownerUserId);
        const newPayableCents = pricing?.unitCostTaxIncluded != null
          ? inboundPayableCents(pricing.unitCostTaxIncluded, input.data.qty)
          : null;
        if (paidCents > BigInt(0) && (newPayableCents == null || paidCents > newPayableCents)) {
          throw new TRPCError({ code: "CONFLICT", message: "修改后的采购货款低于已付款金额，请先核对或作废相关付款记录" });
        }
        await tx.execute(sql`
          UPDATE inbound_orders SET
            partNumber = ${input.data.partNumber}, brand = ${input.data.brand ?? null}, qty = ${input.data.qty},
            unitCost = ${pricing?.unitCost ?? null}, unitCostBasis = ${pricing?.unitCostBasis ?? null},
            taxRate = ${pricing?.taxRate ?? null}, unitCostTaxIncluded = ${pricing?.unitCostTaxIncluded ?? null},
            unitCostTaxExcluded = ${pricing?.unitCostTaxExcluded ?? null},
            prodYear = ${input.data.prodYear ?? null}, supplierName = ${input.data.supplierName ?? null},
            supplierContact = ${input.data.supplierContact ?? null}, supplierPhone = ${input.data.supplierPhone ?? null},
            packageType = ${input.data.packageType ?? null}, lotNumber = ${input.data.lotNumber ?? null},
            supplierOrderNo = ${input.data.supplierOrderNo ?? null}, inboundDate = ${input.data.inboundDate},
            operator = ${input.data.operator ?? null}, location = ${input.data.location ?? null},
            warehouseAddress = ${input.data.warehouseAddress ?? existing.warehouseAddress ?? null},
            procurementRegion = ${input.data.procurementRegion ?? existing.procurementRegion ?? null},
            priceMissing = ${nextPriceMissing},
            note = ${input.data.note ?? null}, photos = ${JSON.stringify(input.data.photos ?? [])}, writeVersion = 4
          WHERE id = ${input.id} AND userId = ${ownerUserId} AND status = 'in_transit'
        `);
        await addEvent(tx, input.id, ownerUserId, actorUserId, "updated_in_transit", null, {
          before: existing,
          after: {
            ...inboundSnapshot(input.data),
            unitCost: pricing?.unitCost ?? null,
            unitCostBasis: pricing?.unitCostBasis ?? null,
            taxRate: pricing?.taxRate ?? null,
            unitCostTaxIncluded: pricing?.unitCostTaxIncluded ?? null,
            unitCostTaxExcluded: pricing?.unitCostTaxExcluded ?? null,
            warehouseAddress: input.data.warehouseAddress ?? existing.warehouseAddress ?? null,
            procurementRegion: input.data.procurementRegion ?? existing.procurementRegion ?? null,
            priceMissing: nextPriceMissing,
          },
        });
        return { success: true } as const;
      });
    }),

  /** 已入库单只允许修改不影响库存数量、型号和成本的业务说明及照片。 */
  updateDetails: inventoryInboundProcedure
    .input(z.object({
      id: z.number().int().positive(),
      supplierName: z.string().trim().min(1, "请输入供应商名称").max(128),
      supplierContact: z.string().trim().max(64),
      supplierPhone: z.string().trim().max(32),
      packageType: z.string().trim().max(64),
      lotNumber: z.string().trim().max(64),
      supplierOrderNo: z.string().trim().max(64),
      operator: z.string().trim().min(1, "请输入采购员").max(64),
      location: z.string().trim().min(1, "请输入存放仓位").max(64),
      note: z.string().trim().max(500),
      photos: z.array(inboundPhotoRefSchema).max(MAX_INBOUND_PHOTOS),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const ownerUserId = ctx.effectiveUserId!;
      const actorUserId = ctx.user.id;
      assertOwnedInboundPhotos(input.photos, ownerUserId);
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
        `);
        const existing = (result as unknown as [InboundRow[], unknown])[0][0];
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
        if (existing.status !== "received") {
          throw new TRPCError({ code: "CONFLICT", message: "只有已入库单可以使用安全编辑" });
        }
        await tx.execute(sql`
          UPDATE inbound_orders SET
            supplierName = ${input.supplierName || null}, supplierContact = ${input.supplierContact || null},
            supplierPhone = ${input.supplierPhone || null}, packageType = ${input.packageType || null},
            lotNumber = ${input.lotNumber || null}, supplierOrderNo = ${input.supplierOrderNo || null},
            operator = ${input.operator || null}, location = ${input.location || null}, note = ${input.note || null},
            photos = ${JSON.stringify(input.photos)}, writeVersion = 4
          WHERE id = ${input.id} AND userId = ${ownerUserId} AND status = 'received'
        `);
        await addEvent(tx, input.id, ownerUserId, actorUserId, "updated_received_details", null, {
          before: existing,
          after: {
            supplierName: input.supplierName || null,
            supplierContact: input.supplierContact || null,
            supplierPhone: input.supplierPhone || null,
            packageType: input.packageType || null,
            lotNumber: input.lotNumber || null,
            supplierOrderNo: input.supplierOrderNo || null,
            operator: input.operator || null,
            location: input.location || null,
            note: input.note || null,
            photos: input.photos,
          },
        });
        return { success: true } as const;
      });
    }),

  paymentHistory: inventoryInboundProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const ownerUserId = ctx.effectiveUserId!;
      const orderResult = await db.execute(sql`
        SELECT io.*,
               (SELECT COALESCE(SUM(pe.amount), 0) FROM inbound_payment_entries pe
                 WHERE pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId AND pe.voidedAt IS NULL) AS paidAmount,
               (SELECT COUNT(*) FROM inbound_payment_entries pe
                 WHERE pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId
                   AND pe.voidedAt IS NOT NULL AND pe.voidReason LIKE '线下退款：%') AS refundedPaymentCount
          FROM inbound_orders io
         WHERE io.id = ${input.id} AND io.userId = ${ownerUserId}
         LIMIT 1
      `);
      const order = (orderResult as unknown as [InboundRow[], unknown])[0][0];
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
      const entryResult = await db.execute(sql`
        SELECT pe.id, pe.amount, pe.paymentDate, pe.note, pe.actorUserId, pe.createdAt,
               pe.voidedAt, pe.voidedByUserId, pe.voidReason,
               COALESCE(NULLIF(u.name, ''), NULLIF(u.username, ''), CONCAT('用户', pe.actorUserId)) AS actorName
          FROM inbound_payment_entries pe
          LEFT JOIN users u ON u.id = pe.actorUserId
         WHERE pe.inboundOrderId = ${input.id} AND pe.ownerUserId = ${ownerUserId}
         ORDER BY pe.paymentDate DESC, pe.id DESC
      `);
      return { order: withInboundPaymentSummary(order), entries: (entryResult as unknown as [any[], unknown])[0] };
    }),

  markPaymentUnpaid: inventoryInboundProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const ownerUserId = ctx.effectiveUserId!;
      const actorUserId = ctx.user.id;
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
        `);
        const existing = (result as unknown as [InboundRow[], unknown])[0][0];
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
        if (existing.status === "cancelled") throw new TRPCError({ code: "CONFLICT", message: "已作废入库单不能登记付款状态" });
        if (existing.paymentTrackedAt) return { success: true, alreadyTracked: true } as const;
        await tx.execute(sql`
          UPDATE inbound_orders SET paymentTrackedAt = NOW(), paymentTrackedByUserId = ${actorUserId}, writeVersion = 4
           WHERE id = ${input.id} AND userId = ${ownerUserId} AND paymentTrackedAt IS NULL
        `);
        await addEvent(tx, input.id, ownerUserId, actorUserId, "payment_tracking_started", "确认未付款", {
          paidAmount: 0,
          paymentCategory: "unpaid",
        });
        return { success: true, alreadyTracked: false } as const;
      });
    }),

  recordPayment: inventoryInboundProcedure.input(recordPaymentInputSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const ownerUserId = ctx.effectiveUserId!;
    const actorUserId = ctx.user.id;
    if (input.paymentDate > beijingDateKey()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "付款日期不能晚于今天" });
    }
    const amount = input.amount;
    const amountCents = inboundMoneyCents(amount);
    if (amountCents <= BigInt(0)) throw new TRPCError({ code: "BAD_REQUEST", message: "付款金额须大于0" });
    return db.transaction(async tx => {
      const orderResult = await tx.execute(sql`
        SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
      `);
      const existing = (orderResult as unknown as [InboundRow[], unknown])[0][0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
      if (existing.status === "cancelled") throw new TRPCError({ code: "CONFLICT", message: "已作废入库单不能新增付款" });
      const payloadHash = paymentPayloadHash({
        inboundOrderId: existing.id,
        actorUserId,
        amount,
        paymentDate: input.paymentDate,
        note: input.note ?? null,
      });
      const priorResult = await tx.execute(sql`
        SELECT id, inboundOrderId, payloadHash FROM inbound_payment_entries
         WHERE ownerUserId = ${ownerUserId} AND requestId = ${input.requestId}
         LIMIT 1 FOR UPDATE
      `);
      const prior = (priorResult as unknown as [[{ id: number; inboundOrderId: number; payloadHash: string }], unknown])[0][0];
      if (prior) {
        if (Number(prior.inboundOrderId) !== existing.id || prior.payloadHash !== payloadHash) {
          throw new TRPCError({ code: "CONFLICT", message: "同一请求标识的付款内容不一致，请刷新后重试" });
        }
        return { success: true, paymentId: Number(prior.id), replayed: true } as const;
      }
      const payableAmount = payableAmountForInbound(existing);
      if (payableAmount == null || inboundMoneyCents(payableAmount) <= BigInt(0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该入库单缺少可计算的含税采购货款，暂不能登记付款" });
      }
      const payableCents = inboundMoneyCents(payableAmount);
      const paidBeforeCents = await paidCentsForInboundInTx(tx, existing.id, ownerUserId);
      if (paidBeforeCents + amountCents > payableCents) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `本次付款超过待付金额 ¥${inboundMoneyStringFromCents(payableCents > paidBeforeCents ? payableCents - paidBeforeCents : BigInt(0))}` });
      }
      let paymentId = 0;
      try {
        const inserted = await tx.execute(sql`
          INSERT INTO inbound_payment_entries
            (inboundOrderId, ownerUserId, actorUserId, requestId, payloadHash, amount, paymentDate, note)
          VALUES
            (${existing.id}, ${ownerUserId}, ${actorUserId}, ${input.requestId}, ${payloadHash},
             ${amount}, ${input.paymentDate}, ${input.note ?? null})
        `);
        paymentId = insertId(inserted);
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const duplicateResult = await tx.execute(sql`
          SELECT id, inboundOrderId, payloadHash FROM inbound_payment_entries
           WHERE ownerUserId = ${ownerUserId} AND requestId = ${input.requestId}
           LIMIT 1 FOR UPDATE
        `);
        const duplicate = (duplicateResult as unknown as [[{ id: number; inboundOrderId: number; payloadHash: string }], unknown])[0][0];
        if (duplicate && Number(duplicate.inboundOrderId) === existing.id && duplicate.payloadHash === payloadHash) {
          return { success: true, paymentId: Number(duplicate.id), replayed: true } as const;
        }
        throw new TRPCError({ code: "CONFLICT", message: "同一请求标识的付款内容不一致，请刷新后重试" });
      }
      if (!paymentId) throw new Error("付款流水写入失败");
      await tx.execute(sql`
        UPDATE inbound_orders
           SET paymentTrackedAt = COALESCE(paymentTrackedAt, NOW()),
               paymentTrackedByUserId = COALESCE(paymentTrackedByUserId, ${actorUserId}), writeVersion = 4
         WHERE id = ${existing.id} AND userId = ${ownerUserId}
      `);
      await addEvent(tx, existing.id, ownerUserId, actorUserId, "payment_recorded", null, {
        paymentId,
        amount,
        paymentDate: input.paymentDate,
        paidBefore: inboundMoneyStringFromCents(paidBeforeCents),
        paidAfter: inboundMoneyStringFromCents(paidBeforeCents + amountCents),
        payableAmount,
      });
      return { success: true, paymentId, replayed: false } as const;
    });
  }),

  voidPayment: inventoryInboundProcedure.input(voidPaymentInputSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const ownerUserId = ctx.effectiveUserId!;
    const actorUserId = ctx.user.id;
    return db.transaction(async tx => {
      const lookupResult = await tx.execute(sql`
        SELECT inboundOrderId FROM inbound_payment_entries
         WHERE id = ${input.paymentId} AND ownerUserId = ${ownerUserId} LIMIT 1
      `);
      const lookup = (lookupResult as unknown as [[{ inboundOrderId: number }], unknown])[0][0];
      if (!lookup) throw new TRPCError({ code: "NOT_FOUND", message: "付款记录不存在" });
      const orderResult = await tx.execute(sql`
        SELECT id FROM inbound_orders
         WHERE id = ${lookup.inboundOrderId} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
      `);
      if (!(orderResult as unknown as [[{ id: number }], unknown])[0][0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
      }
      const result = await tx.execute(sql`
        SELECT id, inboundOrderId, amount, paymentDate, voidedAt
          FROM inbound_payment_entries
         WHERE id = ${input.paymentId} AND ownerUserId = ${ownerUserId}
         LIMIT 1 FOR UPDATE
      `);
      const entry = (result as unknown as [[{ id: number; inboundOrderId: number; amount: string; paymentDate: string; voidedAt: Date | null }], unknown])[0][0];
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "付款记录不存在" });
      if (entry.voidedAt) return { success: true, alreadyVoided: true } as const;
      await tx.execute(sql`
        UPDATE inbound_payment_entries
           SET voidedAt = NOW(), voidedByUserId = ${actorUserId}, voidReason = ${input.reason}
         WHERE id = ${entry.id} AND ownerUserId = ${ownerUserId} AND voidedAt IS NULL
      `);
      await addEvent(tx, entry.inboundOrderId, ownerUserId, actorUserId, "payment_voided", input.reason, {
        paymentId: entry.id,
        amount: entry.amount,
        paymentDate: entry.paymentDate,
      });
      return { success: true, alreadyVoided: false } as const;
    });
  }),

  receive: inventoryInboundProcedure.input(receiveInputSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const ownerUserId = ctx.effectiveUserId!;
    const actorUserId = ctx.user.id;
    const payloadHash = receivePayloadHash(input);
    return db.transaction(async tx => {
      const result = await tx.execute(sql`
        SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${ownerUserId} LIMIT 1 FOR UPDATE
      `);
      const existing = (result as unknown as [InboundRow[], unknown])[0][0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });
      if (existing.status === "received") {
        if (existing.receiveRequestId === input.clientRequestId && existing.receivePayloadHash === payloadHash) {
          return { success: true, alreadyReceived: true, slipNo: existing.slipNo } as const;
        }
        throw new TRPCError({ code: "CONFLICT", message: "该入库单已由另一确认请求完成，请刷新查看入库结果" });
      }
      if (existing.status !== "in_transit") {
        throw new TRPCError({ code: "CONFLICT", message: "已作废的入库单不能再次入库" });
      }
      const paidCents = await paidCentsForInboundInTx(tx, existing.id, ownerUserId);
      const includedUnitCost = includedUnitCostFromInbound(existing);
      const payableCents = includedUnitCost == null ? null : inboundPayableCents(includedUnitCost, input.actualQty);
      const payableAmount = payableCents == null ? null : inboundMoneyStringFromCents(payableCents);
      const paidAmount = inboundMoneyStringFromCents(paidCents);
      const overpaidCents = payableCents == null || paidCents <= payableCents ? BigInt(0) : paidCents - payableCents;
      const overpaidAmount = inboundMoneyStringFromCents(overpaidCents);
      const updated = await tx.execute(sql`
        UPDATE inbound_orders
           SET status = 'received', actualInboundDate = ${input.actualInboundDate}, actualQty = ${input.actualQty},
               location = ${input.location}, receivedAt = NOW(), receivedByUserId = ${actorUserId}, writeVersion = 4,
               receiveRequestId = ${input.clientRequestId}, receivePayloadHash = ${payloadHash}
         WHERE id = ${input.id} AND userId = ${ownerUserId} AND status = 'in_transit'
      `);
      if (affectedRows(updated) !== 1) throw new TRPCError({ code: "CONFLICT", message: "入库单状态已变化，请刷新后重试" });
      await upsertStockLedgerInTx(
        tx, existing.id, ownerUserId, existing.partNumber, existing.brand, input.actualQty,
        existing.unitCostTaxIncluded != null
          ? Number(existing.unitCostTaxIncluded)
          : existing.unitCost != null && existing.unitCostBasis === CNY_TAX_INCLUDED
            ? Number(existing.unitCost)
            : null,
        existing.unitCostTaxIncluded != null || existing.unitCost != null && existing.unitCostBasis === CNY_TAX_INCLUDED
          ? CNY_TAX_INCLUDED
          : null,
      );
      await addEvent(tx, input.id, ownerUserId, actorUserId, "received", null, {
        before: existing,
        after: { status: "received", actualInboundDate: input.actualInboundDate, actualQty: input.actualQty, location: input.location },
        payment: { paidAmount, payableAmount, overpaidAmount },
      });
      if (overpaidCents > BigInt(0)) {
        await addEvent(tx, input.id, ownerUserId, actorUserId, "received_overpaid", "实际到货数量减少导致超付", {
          paidAmount,
          payableAmount,
          overpaidAmount,
        });
      }
      return { success: true, alreadyReceived: false, slipNo: existing.slipNo, overpaidAmount } as const;
    });
  }),

  cancelPreview: inventoryInboundProcedure
    .input(inboundCancelSelectionSchema)
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      return previewInboundCancellation(db, ctx.effectiveUserId!, input);
    }),

  cancelMany: inventoryInboundProcedure
    .input(inboundCancelManySchema)
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return cancelInboundOrders(db, ctx.effectiveUserId!, ctx.user.id, input, input.reason, input.refundConfirmed, input.paymentFingerprint);
    }),

  cancel: inventoryInboundProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: inboundCancelReasonSchema,
      refundConfirmed: z.boolean().default(false),
      paymentFingerprint: z.string().regex(/^[a-f0-9]{64}$/, "付款确认已失效").optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const ownerUserId = ctx.effectiveUserId!;
      const actorUserId = ctx.user.id;
      return cancelInboundOrder(db, ownerUserId, actorUserId, input.id, input.reason, true, input.refundConfirmed, input.paymentFingerprint);
    }),

  /** 旧页面兼容入口：不再物理删除，统一转换为可审计作废。 */
  remove: inventoryInboundProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return cancelInboundOrder(db, ctx.effectiveUserId!, ctx.user.id, input.id, "旧版页面取消在途单", false);
    }),
});
