import { z } from "zod";
import type { calculateSalesProfit } from "./salesProfit";

export const CRM_SALES_ORDER_STATUSES = ["confirmed", "cancelled"] as const;
export type CrmSalesOrderStatus = (typeof CRM_SALES_ORDER_STATUSES)[number];
export const CRM_SALES_ORDER_STATUS_LABELS: Record<CrmSalesOrderStatus, string> = {
  confirmed: "待交付",
  cancelled: "已取消",
};

export const CRM_SALES_ORDER_CURRENCY_LABEL = "人民币（含税）";
export const CRM_SALES_PAYMENT_METHODS = ["bank", "cash", "monthly"] as const;
export type CrmSalesPaymentMethod = (typeof CRM_SALES_PAYMENT_METHODS)[number];
export const CRM_SALES_PAYMENT_METHOD_LABELS: Record<CrmSalesPaymentMethod, string> = {
  bank: "对公转账",
  cash: "现金",
  monthly: "月结",
};
export const CRM_SALES_PAYMENT_STATUSES = ["unpaid", "partial", "paid", "monthly"] as const;
export type CrmSalesPaymentStatus = (typeof CRM_SALES_PAYMENT_STATUSES)[number];
export const CRM_SALES_PAYMENT_STATUS_LABELS: Record<CrmSalesPaymentStatus, string> = {
  unpaid: "未收款",
  partial: "部分收款",
  paid: "已收款",
  monthly: "月结",
};
export const CRM_SALES_SHIPMENT_STATUSES = ["unshipped", "partial", "shipped"] as const;
export type CrmSalesShipmentStatus = (typeof CRM_SALES_SHIPMENT_STATUSES)[number];
export const CRM_SALES_SHIPMENT_STATUS_LABELS: Record<CrmSalesShipmentStatus, string> = {
  unshipped: "未出货",
  partial: "部分出货",
  shipped: "已出货",
};

export const CRM_SALES_ORDER_PRICE_SCALE = 4;
export const CRM_SALES_ORDER_MAX_ITEMS = 100;
const MAX_AMOUNT_SCALED = BigInt("999999999999999999999999999999");

const id = z.number().int().positive().max(2147483647);
const page = z.number().int().min(1).max(100000).default(1);
const pageSize = z.number().int().min(1).max(50).default(20);
const requestId = z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/, "请求标识格式无效");
const price = z.string().trim().regex(
  /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
  "单价最多 4 位小数，且不能为负数",
);

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const salesOrderItemCreateSchema = z.object({
  demandItemId: id,
  qty: z.number().int().positive("确认数量须为正整数").max(2147483647),
  agreedUnitPrice: price,
});

export const salesOrderCreateSchema = z.object({
  demandId: id,
  /** Required after demand revision 1; legacy clients remain compatible with revision 1. */
  demandRevision: id.optional(),
  requestId,
  items: z.array(salesOrderItemCreateSchema).min(1, "请至少确认一行订单物料").max(CRM_SALES_ORDER_MAX_ITEMS),
  dueDate: z.string().trim().refine(isCalendarDate, "交付日期无效").nullable().default(null),
  confirmationNote: z.string().trim().min(1, "请填写客户确认说明").max(500),
  customerConfirmed: z.boolean().refine(value => value, "请确认已与客户确认订单"),
}).superRefine((input, ctx) => {
  const ids = new Set<number>();
  input.items.forEach((item, index) => {
    if (ids.has(item.demandItemId)) {
      ctx.addIssue({ code: "custom", path: ["items", index, "demandItemId"], message: "同一需求物料只能录入一次" });
    }
    ids.add(item.demandItemId);
  });
  try { calculateSalesOrderAmounts(input.items); }
  catch { ctx.addIssue({ code: "custom", path: ["items"], message: "数量、价格无效或订单金额超出允许范围" }); }
});

export const salesOrderListSchema = z.object({
  customerId: id.optional(),
  keyword: z.string().trim().max(128).default(""),
  status: z.enum(CRM_SALES_ORDER_STATUSES).optional(),
  page,
  pageSize,
});

export const salesOrderCandidateListSchema = z.object({
  customerId: id.optional(),
  keyword: z.string().trim().max(128).default(""),
  page,
  pageSize: z.number().int().min(1).max(20).default(10),
});

/** Optional context is for read-only get; write schemas deliberately remain unchanged. */
export const salesOrderIdSchema = z.object({ id, customerId: id.optional() });
export const salesOrderCustomerSummarySchema = z.object({ customerId: id });
export const salesOrderCustomerMaterialsSchema = z.object({ customerId: id, page, pageSize });
export const salesOrderCancelSchema = z.object({
  id,
  version: id,
  reason: z.string().trim().min(1, "请填写取消原因").max(500),
});

export type SalesOrderCreateInput = z.infer<typeof salesOrderCreateSchema>;
export const salesOrderPaymentSchema = z.object({
  id,
  version: id,
  requestId,
  method: z.enum(CRM_SALES_PAYMENT_METHODS),
  amount: price,
  paymentDate: z.string().trim().refine(isCalendarDate, "收款日期无效"),
  note: z.string().trim().max(255).default(""),
});
export const salesOrderShipSchema = z.object({
  id,
  version: id,
  requestId,
  deliveryMethod: z.enum(["express", "pickup"]),
  expressCo: z.string().trim().max(64).default(""),
  expressNo: z.string().trim().max(64).default(""),
  note: z.string().trim().max(255).default(""),
  items: z.array(z.object({
    orderItemId: id,
    inventoryId: id,
    qty: z.number().int().positive("出货数量须为正整数").max(2147483647),
  })).min(1, "请至少选择一行库存出货").max(CRM_SALES_ORDER_MAX_ITEMS),
}).superRefine((input, ctx) => {
  if (input.deliveryMethod === "express") {
    if (!input.expressCo.trim()) ctx.addIssue({ code: "custom", path: ["expressCo"], message: "请填写快递公司" });
    if (!input.expressNo.trim()) ctx.addIssue({ code: "custom", path: ["expressNo"], message: "请填写快递单号" });
  }
  const keys = new Set<string>();
  input.items.forEach((item, index) => {
    const key = `${item.orderItemId}:${item.inventoryId}`;
    if (keys.has(key)) ctx.addIssue({ code: "custom", path: ["items", index, "inventoryId"], message: "同一物料库存不能重复出货" });
    keys.add(key);
  });
});
export type SalesOrderPaymentInput = z.infer<typeof salesOrderPaymentSchema>;
export type SalesOrderShipInput = z.infer<typeof salesOrderShipSchema>;

export type SalesOrderListInput = z.infer<typeof salesOrderListSchema>;
export type SalesOrderCandidateListInput = z.infer<typeof salesOrderCandidateListSchema>;

export type SalesOrderIdInput = z.infer<typeof salesOrderIdSchema>;
export type SalesOrderCustomerSummaryInput = z.infer<typeof salesOrderCustomerSummarySchema>;
export type SalesOrderCustomerMaterialsInput = z.infer<typeof salesOrderCustomerMaterialsSchema>;
/** Counts cover all authorized orders of this customer, not a displayed page. */
export type SalesOrderCustomerSummary = {
  customerId: number;
  totalOrders: number;
  confirmedOrders: number;
  cancelledOrders: number;
  awaitingPaymentOrders: number;
  awaitingShipmentOrders: number;
  monthlyOrders: number;
};

export type SalesOrderDemandItemCandidate = {
  id: number;
  partNumber: string;
  brand: string;
  pkg: string;
  qtyUnit: string;
  demandQty: number;
  remainingQty: number;
  deliveryRequirement: string;
  note: string;
};

export type SalesOrderDemandCandidate = {
  id: number;
  demandRevision?: number;
  demandNo: string;
  customerId: number;
  customerName: string;
  projectName: string;
  status: "submitted" | "processing";
  items: SalesOrderDemandItemCandidate[];
};

export type SalesOrderSummary = {
  id: number;
  orderNumber: string;
  customerId: number;
  customerName: string;
  sourceType: "demand" | "company_stock";
  demandId: number | null;
  demandNo: string | null;
  /** Legacy demand orders have no tax evidence; null must never imply tax-included. */
  salesTaxMode: SalesTaxMode | null;
  salesExpenses: string;
  companyStockAllocated: boolean;
  projectName: string;
  status: CrmSalesOrderStatus;
  totalAmount: string;
  currencyLabel: string;
  itemCount: number;
  paidAmount: string;
  monthlyAmount: string;
  paymentStatus: CrmSalesPaymentStatus;
  orderedQty: number;
  shippedQty: number;
  shipmentStatus: CrmSalesShipmentStatus;
  dueDate: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SalesOrderItem = {
  id: number;
  sourceDemandItemId: number | null;
  partNumber: string;
  brand: string;
  pkg: string;
  dc?: string;
  qtyUnit: string;
  demandQty: number | null;
  orderedQty: number;
  unitPrice: string;
  lineAmount: string;
  deliveryRequirement: string;
  note: string;
  shippedQty: number;
};

/** Order snapshots only: not procurement quotes or customer supply-channel inventory. */
export type SalesOrderCustomerMaterial = SalesOrderItem & {
  orderId: number;
  orderNumber: string;
  customerId: number;
  sourceType: "demand" | "company_stock";
  demandId: number | null;
  demandNo: string | null;
  projectName: string;
  status: CrmSalesOrderStatus;
  dueDate: string | null;
  remainingQty: number;
};

export type SalesOrderAudit = {
  id: number;
  action: "created" | "cancelled" | "payment" | "shipment" | "stock_allocated" | "expenses";
  actorUserId: number;
  actorName: string;
  note: string;
  createdAt: string;
};

export type SalesOrderDetail = SalesOrderSummary & {
  confirmationNote: string;
  cancelledReason: string | null;
  cancelledAt: string | null;
  items: SalesOrderItem[];
  audits: SalesOrderAudit[];
  payments: SalesOrderPayment[];
  shipments: SalesOrderShipment[];
  stockCandidates: SalesOrderStockCandidate[];
  companyStockAllocations: CompanyStockSalesAllocation[];
  salesExpenseHistory: SalesExpenseEvent[];
  profitBreakdown: SalesProfitBreakdown;
  commissionPreview: SalesCommissionPreview;
};

export type SalesOrderPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

function scaledFactor(scale: number) {
  let factor = BigInt(1);
  for (let index = 0; index < scale; index += 1) factor *= BigInt(10);
  return factor;
}

/** Converts a non-negative plain decimal to an exact fixed-point integer. */
export function decimalToScaled(value: string, scale = CRM_SALES_ORDER_PRICE_SCALE): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || scale < 0 || !Number.isInteger(scale)) {
    throw new Error("invalid decimal");
  }
  const [integerPart, fractionalPart = ""] = trimmed.split(".");
  if (fractionalPart.length > scale) throw new Error("decimal precision exceeds scale");
  const factor = scaledFactor(scale);
  const fractional = (fractionalPart + "0".repeat(scale)).slice(0, scale);
  return BigInt(integerPart) * factor + BigInt(fractional || "0");
}

/** Formats a fixed-point amount without a floating-point conversion. */
export function scaledToDecimal(value: bigint, scale = CRM_SALES_ORDER_PRICE_SCALE): string {
  if (scale < 0 || !Number.isInteger(scale)) throw new Error("invalid scale");
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const factor = scaledFactor(scale);
  const integerPart = absolute / factor;
  const fractionalPart = (absolute % factor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${integerPart.toString()}.${fractionalPart}`;
}

/**
 * Exact arithmetic for CNY prices (tax basis is separate evidence): values are stored at 1/10,000 yuan,
 * never converted through JavaScript Number or a database floating type.
 */
export function calculateSalesOrderAmounts(items: ReadonlyArray<{ qty: number; agreedUnitPrice: string }>) {
  let totalScaled = BigInt(0);
  const lines = items.map(item => {
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0) throw new Error("invalid quantity");
    const unitPriceScaled = decimalToScaled(item.agreedUnitPrice);
    const lineAmountScaled = unitPriceScaled * BigInt(item.qty);
    totalScaled += lineAmountScaled;
    if (totalScaled > MAX_AMOUNT_SCALED) throw new Error("订单金额超出允许范围");
    return {
      unitPrice: scaledToDecimal(unitPriceScaled),
      lineAmount: scaledToDecimal(lineAmountScaled),
    };
  });
  return { lines, totalAmount: scaledToDecimal(totalScaled) };
}

/** Stable payload form used for replay detection; it deliberately contains no customer-supplied snapshots. */
export function canonicalSalesOrderCreatePayload(input: SalesOrderCreateInput) {
  const amounts = calculateSalesOrderAmounts(input.items);
  return {
    demandId: input.demandId,
    ...(input.demandRevision === undefined ? {} : { demandRevision: input.demandRevision }),
    items: input.items
      .map((item, index) => ({
        demandItemId: item.demandItemId,
        qty: item.qty,
        agreedUnitPrice: amounts.lines[index].unitPrice,
      }))
      .sort((left, right) => left.demandItemId - right.demandItemId),
    dueDate: input.dueDate,
    confirmationNote: input.confirmationNote.trim(),
    customerConfirmed: true,
  };
}

export function formatSalesOrderAmount(value: string) {
  const [rawIntegerPart, fractionalPart = "0000"] = String(value).split(".");
  const integerPart = rawIntegerPart.replace(/^0+(?=\d)/, "") || "0";
  const trimmedFraction = fractionalPart.replace(/0+$/, "");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${groupedInteger}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

export function salesPaymentStatus(input: { totalAmount: string; paidAmount: string; monthlyAmount: string }): CrmSalesPaymentStatus {
  const total = decimalToScaled(input.totalAmount);
  const paid = decimalToScaled(input.paidAmount);
  const monthly = decimalToScaled(input.monthlyAmount);
  if (paid + monthly <= BigInt(0)) return "unpaid";
  if (monthly > BigInt(0) && paid <= BigInt(0) && paid + monthly >= total) return "monthly";
  if (paid + monthly >= total) return "paid";
  return "partial";
}
export function salesShipmentStatus(shippedQty: number, orderedQty: number): CrmSalesShipmentStatus {
  if (shippedQty <= 0) return "unshipped";
  if (shippedQty >= orderedQty) return "shipped";
  return "partial";
}

export type SalesOrderPayment = {
  id: number;
  method: CrmSalesPaymentMethod;
  amount: string;
  paymentDate: string;
  note: string;
  actorName: string;
  createdAt: string;
};
export type SalesOrderShipment = {
  id: number;
  deliveryMethod: "express" | "pickup";
  expressCo: string;
  expressNo: string;
  note: string;
  actorName: string;
  createdAt: string;
  sourceType?: "legacy_inventory" | "company_stock";
  items: Array<{ orderItemId: number; inventoryId: number | null; lotId?: number | null; consumptionId?: number | null; outboundOrderId?: number | null; slipNo?: string | null; partNumber: string; qty: number }>;
};
export type SalesOrderStockCandidate = {
  inventoryId: number;
  orderItemId: number;
  partNumber: string;
  brand: string;
  pkg: string;
  qtyStock: number;
  qtyOnSale: number;
  availableQty: number;
  ownerName: string;
};

export const CRM_SALES_ORDER_TABLES = [
  "crm_sales_orders",
  "crm_sales_order_items",
  "crm_sales_order_requests",
  "crm_sales_order_audits",
  "crm_sales_order_payments",
  "crm_sales_order_shipments",
  "crm_sales_order_shipment_items",
  "crm_sales_order_expenses",
] as const;

/** Additive company-stock contract: no fake demand/inventory identities. */
export const CRM_SALES_SOURCE_TYPES = ["demand", "company_stock"] as const;
export const CRM_SALES_TAX_MODES = ["tax_included", "tax_excluded"] as const;
export type SalesTaxMode = (typeof CRM_SALES_TAX_MODES)[number];
export const CRM_COMPANY_STOCK_MAX_ALLOCATIONS = 200;
export const CRM_COMPANY_STOCK_MAX_QTY = 999999999;
const salesQty = z.number().int().positive().max(CRM_COMPANY_STOCK_MAX_QTY);
export const companyStockSalesAllocationSchema = z.object({ lotId: id, qty: salesQty }).strict();
const allocationsSchema = z.array(companyStockSalesAllocationSchema).min(1).max(CRM_COMPANY_STOCK_MAX_ALLOCATIONS).superRefine((rows, ctx) => {
  const seen = new Set<number>();
  rows.forEach((row, index) => {
    if (seen.has(row.lotId)) ctx.addIssue({ code: "custom", path: [index, "lotId"], message: "同一物料不可重复选择同一批次" });
    seen.add(row.lotId);
  });
});
export const companyStockSalesItemSchema = z.object({
  // Identity bytes must agree with stock's exact comparison; never normalize a submitted lot identity.
  partNumber: z.string().min(1).max(128).refine(value => value.trim().length > 0, "型号不可空白"),
  brand: z.string().max(64).default(""),
  pkg: z.string().max(64).default(""),
  dc: z.string().max(16).default(""),
  qtyUnit: z.string().trim().min(1).max(8).default("个"),
  qty: salesQty,
  agreedUnitPrice: price,
  allocations: allocationsSchema,
  deliveryRequirement: z.string().trim().max(80).default(""),
  note: z.string().trim().max(500).default(""),
}).strict().superRefine((row, ctx) => {
  if (row.allocations.reduce((sum, allocation) => sum + BigInt(allocation.qty), BigInt(0)) !== BigInt(row.qty)) {
    ctx.addIssue({ code: "custom", path: ["allocations"], message: "本行分配批次数量必须等于客户确认数量" });
  }
});
const companyStockOrderShape = {
  customerId: id,
  items: z.array(companyStockSalesItemSchema).min(1).max(CRM_SALES_ORDER_MAX_ITEMS),
  salesTaxMode: z.enum(CRM_SALES_TAX_MODES),
  dueDate: z.string().trim().refine(isCalendarDate, "交付日期无效").nullable().default(null),
  confirmationNote: z.string().trim().min(1).max(500),
  customerConfirmed: z.literal(true),
};
function companyAllocationValidation(items: Array<{ allocations: Array<{ lotId: number; qty: number }> }>, ctx: z.RefinementCtx) {
  const lines = items.flatMap(item => item.allocations);
  if (lines.length > CRM_COMPANY_STOCK_MAX_ALLOCATIONS) ctx.addIssue({ code: "custom", path: ["items"], message: "全单最多200项批次分配" });
  const lots = new Map<number, bigint>();
  for (const item of items) {
    if (item.allocations.reduce((sum, row) => sum + BigInt(row.qty), BigInt(0)) > BigInt(CRM_COMPANY_STOCK_MAX_QTY)) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "单行分配合量超过库存数量上限" });
    }
    for (const row of item.allocations) lots.set(row.lotId, (lots.get(row.lotId) ?? BigInt(0)) + BigInt(row.qty));
  }
  if (Array.from(lots.values()).some(qty => qty > BigInt(CRM_COMPANY_STOCK_MAX_QTY))) ctx.addIssue({ code: "custom", path: ["items"], message: "同批次全单合量超过库存数量上限" });
}
function companyAmountsValidation(input: { items: Array<{ qty: number; agreedUnitPrice: string; allocations: Array<{ lotId: number; qty: number }> }> }, ctx: z.RefinementCtx) {
  companyAllocationValidation(input.items, ctx);
  try { calculateSalesOrderAmounts(input.items); }
  catch { ctx.addIssue({ code: "custom", path: ["items"], message: "订单金额超出允许范围" }); }
}
export const salesOrderCompanyStockCreateSchema = z.object({ ...companyStockOrderShape, requestId }).strict().superRefine(companyAmountsValidation);
export const salesOrderCompanyStockPreviewSchema = z.object({ ...companyStockOrderShape, requestId: requestId.optional() }).strict().superRefine(companyAmountsValidation);
export const salesOrderCompanyStockCandidatesSchema = z.object({
  customerId: id, keyword: z.string().trim().max(128).default(""), page, pageSize,
  selectedLotIds: z.array(id).max(CRM_COMPANY_STOCK_MAX_ALLOCATIONS).optional(),
}).strict();
export const salesOrderCompanyStockAllocateSchema = z.object({
  id, version: id, requestId,
  items: z.array(z.object({ orderItemId: id, allocations: allocationsSchema }).strict()).min(1).max(CRM_SALES_ORDER_MAX_ITEMS),
}).strict().superRefine((input, ctx) => {
  companyAllocationValidation(input.items, ctx);
  const seen = new Set<number>();
  input.items.forEach((row, index) => {
    if (seen.has(row.orderItemId)) ctx.addIssue({ code: "custom", path: ["items", index, "orderItemId"], message: "订单物料不能重复分配" });
    seen.add(row.orderItemId);
  });
});
export const salesOrderCompanyStockShipSchema = z.object({
  id, version: id, requestId,
  deliveryMethod: z.enum(["express", "pickup"]),
  expressCo: z.string().trim().max(64).default(""),
  expressNo: z.string().trim().max(64).default(""),
  note: z.string().trim().max(255).default(""),
  items: z.array(z.object({ orderItemId: id, lotId: id, qty: salesQty }).strict()).min(1).max(CRM_COMPANY_STOCK_MAX_ALLOCATIONS),
}).strict().superRefine((input, ctx) => {
  companyAllocationValidation(input.items.map(row => ({ allocations: [row] })), ctx);
  const quantities = new Map<number, bigint>();
  for (const row of input.items) quantities.set(row.orderItemId, (quantities.get(row.orderItemId) ?? BigInt(0)) + BigInt(row.qty));
  if (Array.from(quantities.values()).some(qty => qty > BigInt(CRM_COMPANY_STOCK_MAX_QTY))) ctx.addIssue({ code: "custom", path: ["items"], message: "单行出货合量超过库存数量上限" });
  if (input.deliveryMethod === "express" && (!input.expressCo || !input.expressNo)) {
    ctx.addIssue({ code: "custom", path: ["expressNo"], message: "快递出货须填写快递公司与单号" });
  }
  const seen = new Set<string>();
  input.items.forEach((row, index) => {
    const key = `${row.orderItemId}:${row.lotId}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", index, "lotId"], message: "同一物料批次不能重复出货" });
    seen.add(key);
  });
});
export const salesOrderExpensesSchema = z.object({ id, version: id, requestId, amount: price, note: z.string().trim().min(1).max(500) }).strict();
export type SalesOrderCompanyStockCreateInput = z.infer<typeof salesOrderCompanyStockCreateSchema>;
export type SalesOrderCompanyStockPreviewInput = z.infer<typeof salesOrderCompanyStockPreviewSchema>;
export type SalesOrderCompanyStockCandidatesInput = z.infer<typeof salesOrderCompanyStockCandidatesSchema>;
export type SalesOrderCompanyStockAllocateInput = z.infer<typeof salesOrderCompanyStockAllocateSchema>;
export type SalesOrderCompanyStockShipInput = z.infer<typeof salesOrderCompanyStockShipSchema>;
export type SalesOrderExpensesInput = z.infer<typeof salesOrderExpensesSchema>;

export type CompanyStockSalesAllocation = {
  id: number; orderId: number; orderItemId: number; lotId: number; qty: number;
  reservedQty: number; consumedQty: number; releasedQty: number;
  unitCost: string | null; costTaxMode: string; [key: string]: unknown;
};
export type SalesExpenseEvent = {
  id: number; previousAmount: string; amount: string; note: string; actorUserId: number;
  requestId: string; version: number; createdAt: string;
};
type ConfirmedTaxProfitResult = ReturnType<typeof calculateSalesProfit>;
/** CRM extends only the read result for unknown legacy evidence; pure policy stays strict. */
export type CompanyStockSalesProfitResult = Omit<ConfirmedTaxProfitResult, "profitBreakdown"> & {
  profitBreakdown: Omit<ConfirmedTaxProfitResult["profitBreakdown"], "salesTaxMode"> & { salesTaxMode: SalesTaxMode | null };
};
export type SalesProfitBreakdown = CompanyStockSalesProfitResult["profitBreakdown"];
export type SalesCommissionPreview = CompanyStockSalesProfitResult["commissionPreview"];

export function canonicalCompanyStockCreatePayload(input: SalesOrderCompanyStockCreateInput | SalesOrderCompanyStockPreviewInput) {
  return {
    customerId: input.customerId, salesTaxMode: input.salesTaxMode, dueDate: input.dueDate,
    confirmationNote: input.confirmationNote, customerConfirmed: true,
    items: input.items.map(item => ({ ...item, agreedUnitPrice: scaledToDecimal(decimalToScaled(item.agreedUnitPrice)),
      allocations: [...item.allocations].sort((a, b) => a.lotId - b.lotId) })),
  };
}
