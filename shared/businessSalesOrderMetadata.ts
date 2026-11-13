import { z } from "zod";

/** Native-admin information only: no refund, inventory, payment or shipment execution. */
export const BUSINESS_AFTER_SALE_KINDS = ["consultation", "repair", "exchange", "return_request", "refund_request"] as const;
export const BUSINESS_AFTER_SALE_STATUSES = ["open", "processing", "closed"] as const;
export const BUSINESS_AFTER_SALE_KIND_LABELS = {
  consultation: "咨询", repair: "维修", exchange: "换货", return_request: "退货申请", refund_request: "退款申请",
} as const;
export const BUSINESS_AFTER_SALE_STATUS_LABELS = { open: "登记", processing: "处理中", closed: "已结案" } as const;
export const BUSINESS_AFTER_SALE_NOTICE = "仅登记售后意向和跟进信息，不执行退款、退货入库或库存变更；关闭记录不代表退款或退货完成。";

const id = z.number().int().positive().max(2147483647);
const version = z.number().int().min(0).max(2147483646);
const requestId = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/, "请求标识格式无效");
const orderContext = { id, customerId: id.optional() };
const receiverFields = {
  receiver: z.string().trim().max(64),
  receiverPhone: z.string().trim().max(40),
  receiverAddress: z.string().trim().max(500),
  note: z.string().trim().max(500),
};
export const businessSalesOrderMetadataGetSchema = z.object(orderContext).strict();
/** Empty individual fields are legitimate drafts; a fully empty save is never a clear operation. */
export const businessSalesOrderSaveReceiverSchema = z.object({
  ...orderContext, ...receiverFields, version, requestId,
}).strict().refine(input => [input.receiver, input.receiverPhone, input.receiverAddress, input.note].some(Boolean), {
  message: "请至少填写一项收货信息或备注，不能保存全空信息", path: ["receiver"],
});
export const businessSalesOrderAddAfterSaleSchema = z.object({
  ...orderContext, kind: z.enum(BUSINESS_AFTER_SALE_KINDS),
  reason: z.string().trim().min(1, "请填写售后原因").max(500), requestId,
}).strict();
export const businessSalesOrderUpdateAfterSaleSchema = z.object({
  ...orderContext, caseId: id, version: version.refine(value => value > 0, "记录版本无效"),
  status: z.enum(BUSINESS_AFTER_SALE_STATUSES),
  resolution: z.string().trim().max(500), requestId,
}).strict();

export const businessSalesOrderReceiverDtoSchema = z.object({
  ...receiverFields, version: id, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const businessSalesOrderAfterSaleDtoSchema = z.object({
  id, kind: z.enum(BUSINESS_AFTER_SALE_KINDS), reason: z.string().min(1).max(500),
  status: z.enum(BUSINESS_AFTER_SALE_STATUSES), resolution: z.string().max(500), version: id,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), closedAt: z.string().datetime().nullable(),
}).strict();
export const businessSalesOrderMetadataDtoSchema = z.object({
  merchantId: id, orderId: id, orderNumber: z.string().min(1).max(128), customerId: id,
  receiver: businessSalesOrderReceiverDtoSchema.nullable(),
  afterSales: z.array(businessSalesOrderAfterSaleDtoSchema),
}).strict();

export type BusinessSalesOrderMetadataGetInput = z.infer<typeof businessSalesOrderMetadataGetSchema>;
export type BusinessSalesOrderSaveReceiverInput = z.infer<typeof businessSalesOrderSaveReceiverSchema>;
export type BusinessSalesOrderAddAfterSaleInput = z.infer<typeof businessSalesOrderAddAfterSaleSchema>;
export type BusinessSalesOrderUpdateAfterSaleInput = z.infer<typeof businessSalesOrderUpdateAfterSaleSchema>;
export type BusinessSalesOrderReceiverDto = z.infer<typeof businessSalesOrderReceiverDtoSchema>;
export type BusinessSalesOrderAfterSaleDto = z.infer<typeof businessSalesOrderAfterSaleDtoSchema>;
export type BusinessSalesOrderMetadataDto = z.infer<typeof businessSalesOrderMetadataDtoSchema>;
export type BusinessAfterSaleKind = (typeof BUSINESS_AFTER_SALE_KINDS)[number];
export type BusinessAfterSaleStatus = (typeof BUSINESS_AFTER_SALE_STATUSES)[number];
