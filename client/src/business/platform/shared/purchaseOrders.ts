import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
const version = z.number().int().positive().max(2147483647);
const requestId = z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择有效日期").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "请选择有效日期");
export const purchaseOrderMoneySchema = z.string().trim().regex(
  /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/,
  "请输入非负含税单价，最多4位小数",
);
export const purchaseOrderInvoiceAmountSchema = z.string().trim().regex(
  /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/,
  "发票金额最多保留2位小数",
).refine(value => Number(value) > 0, "发票金额须大于0");

export const purchaseOrderItemSchema = z.object({
  partNumber: z.string().trim().min(1, "请填写型号").max(128),
  brand: z.string().trim().max(64).default(""),
  pkg: z.string().trim().max(64).default(""),
  qtyUnit: z.string().trim().min(1).max(8).default("片"),
  qty: z.number().int().positive().max(10000000),
  unitPrice: purchaseOrderMoneySchema,
});
const createBase = {
  requestId,
  supplierOrderNo: z.string().trim().max(64).default(""),
  expectedDeliveryDate: date.optional(),
  note: z.string().trim().max(1000).default(""),
};
export const purchaseOrderCreateSchema = z.discriminatedUnion("source", [
  z.object({ ...createBase, source: z.literal("manual"),
    supplierName: z.string().trim().min(1, "请填写供应商").max(128),
    items: z.array(purchaseOrderItemSchema).min(1, "请至少录入一行物料").max(50),
  }),
  z.object({ ...createBase, source: z.literal("accepted_quote"), acceptanceId: id }),
]);
export const purchaseOrderListSchema = z.object({
  keyword: z.string().trim().max(128).default(""),
  paymentStatus: z.enum(["pending", "partial", "paid"]).optional(),
  shippingStatus: z.enum(["pending", "partial", "shipped"]).optional(),
  invoiceStatus: z.enum(["pending", "partial", "received"]).optional(),
  lifecycle: z.enum(["active", "cancelled", "all"]).default("active"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export const purchaseOrderIdSchema = z.object({ id });
export const acceptedQuoteOptionsSchema = z.object({
  keyword: z.string().trim().max(128).default(""),
  limit: z.number().int().min(1).max(30).default(20),
});
export const purchaseOrderPaymentSchema = z.object({
  id, version, requestId,
  status: z.enum(["pending", "partial", "paid"]),
  note: z.string().trim().max(500).default(""),
});
export const purchaseOrderShippingSchema = z.object({
  id, version, requestId,
  lines: z.array(z.object({ itemId: id, shippedQty: z.number().int().min(0).max(10000000) })).min(1).max(50),
  carrier: z.string().trim().max(100).default(""),
  trackingNo: z.string().trim().max(128).default(""),
  note: z.string().trim().max(500).default(""),
}).superRefine((input, ctx) => {
  if (new Set(input.lines.map(line => line.itemId)).size !== input.lines.length) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "同一物料不能重复登记" });
  }
});
export const purchaseOrderInboundCandidatesSchema = z.object({
  id, keyword: z.string().trim().max(128).default(""), limit: z.number().int().min(1).max(30).default(20),
});
export const purchaseOrderLinkInboundSchema = z.object({
  id, version, requestId, itemId: id, inboundOrderId: id,
});
export const purchaseOrderInvoiceSchema = z.object({
  id, version, requestId,
  invoiceNo: z.string().trim().min(1, "请输入发票号码").max(64),
  kind: z.enum(["special", "normal", "other"]),
  amount: purchaseOrderInvoiceAmountSchema,
  issuedDate: date,
  note: z.string().trim().max(500).default(""),
});
export const purchaseOrderVoidInvoiceSchema = z.object({
  id, invoiceId: id, version, requestId, reason: z.string().trim().min(4, "请填写作废原因").max(500),
});
export const purchaseOrderCancelSchema = z.object({
  id, version, requestId, reason: z.string().trim().min(4, "请填写取消原因").max(500),
});

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderListInput = z.infer<typeof purchaseOrderListSchema>;
export type PurchaseOrderShippingInput = z.infer<typeof purchaseOrderShippingSchema>;
export const PURCHASE_PAYMENT_LABELS = { pending: "待付款", partial: "部分付款", paid: "已付清" } as const;
export const PURCHASE_SHIPPING_LABELS = { pending: "待发货", partial: "部分发货", shipped: "已发货" } as const;
export const PURCHASE_RECEIPT_LABELS = { pending: "待入库", partial: "部分入库", received: "已入库", over_received: "超量待核对" } as const;
export const PURCHASE_INVOICE_LABELS = { pending: "待收票", partial: "部分收票", received: "已收票" } as const;
