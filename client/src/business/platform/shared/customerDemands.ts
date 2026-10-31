import { z } from "zod";

export const CUSTOMER_DEMAND_MAX_ITEMS = 100;
export const CUSTOMER_DEMAND_STATUSES = ["draft", "submitted", "processing"] as const;
export type CustomerDemandStatus = typeof CUSTOMER_DEMAND_STATUSES[number];
export const CUSTOMER_DEMAND_STATUS_LABELS: Record<CustomerDemandStatus, string> = {
  draft: "草稿", submitted: "待采购", processing: "采购处理中",
};
export const CUSTOMER_DEMAND_WORKFLOW_STAGES = [
  "draft",
  "inquiring",
  "quote_selection",
  "quote_confirmed",
  "customer_confirmed",
] as const;
export type CustomerDemandWorkflowStage = typeof CUSTOMER_DEMAND_WORKFLOW_STAGES[number];
export const CUSTOMER_DEMAND_WORKFLOW_LABELS: Record<CustomerDemandWorkflowStage, string> = {
  draft: "草稿",
  inquiring: "询价中",
  quote_selection: "待选择报价",
  quote_confirmed: "报价已确认",
  customer_confirmed: "客户已确认",
};
export const CUSTOMER_DEMAND_UNITS = ["片", "只", "颗", "套", "盘", "个"] as const;
const id = z.number().int().positive().max(2147483647);
const text = (max: number) => z.string().trim().max(max).default("");
export const customerDemandItemSchema = z.object({
  /** Existing rows carry their server-issued source ID; new rows intentionally omit it. */
  id: id.optional(),
  partNumber: text(128), brand: text(64), pkg: text(64),
  qty: z.number().int().positive("数量须为正整数").max(2147483647).nullable().default(null),
  qtyUnit: z.enum(CUSTOMER_DEMAND_UNITS).default("片"),
  deliveryRequirement: text(80), note: text(500),
});
export const customerDemandDataSchema = z.object({
  projectName: text(128), priority: z.enum(["normal", "urgent"]).default("normal"),
  replyDueAt: z.string().datetime({ offset: true }).nullable().default(null),
  note: text(2000),
  items: z.array(customerDemandItemSchema).min(1, "请添加至少一行物料").max(CUSTOMER_DEMAND_MAX_ITEMS),
});
export type CustomerDemandItem = z.infer<typeof customerDemandItemSchema>;
export type CustomerDemandData = z.infer<typeof customerDemandDataSchema>;
export const customerDemandSaveSchema = z.object({
  customerId: id, id: id.optional(), version: id.optional(),
  requestId: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  intent: z.enum(["draft", "submit", "update"]),
  /** Recorded with a submitted-demand revision when the salesperson provides one. */
  changeReason: z.string().trim().max(500).optional(),
  data: customerDemandDataSchema,
}).superRefine((input, ctx) => {
  if (Boolean(input.id) !== Boolean(input.version)) ctx.addIssue({ code: "custom", path: ["version"], message: "编辑需求必须提供当前版本" });
  if (input.intent === "update" && !input.id) ctx.addIssue({ code: "custom", path: ["id"], message: "更新已提交需求必须提供需求编号" });
  if (input.intent === "submit" || input.intent === "update") {
    input.data.items.forEach((item, index) => {
      if (!item.partNumber) ctx.addIssue({ code: "custom", path: ["data", "items", index, "partNumber"], message: `第${index + 1}行请输入型号` });
      if (item.qty == null) ctx.addIssue({ code: "custom", path: ["data", "items", index, "qty"], message: `第${index + 1}行请输入数量` });
    });
  } else if (!input.data.projectName && !input.data.note && !input.data.items.some(item => item.partNumber || item.brand || item.pkg || item.qty != null || item.deliveryRequirement || item.note)) {
    ctx.addIssue({ code: "custom", path: ["data", "items"], message: "请至少填写一项需求内容后保存草稿" });
  }
});
export type CustomerDemandSaveInput = z.infer<typeof customerDemandSaveSchema>;
export const customerDemandListSchema = z.object({ customerId: id, page: id.default(1), pageSize: z.number().int().min(1).max(100).default(20) });
export const customerDemandIdSchema = z.object({ id });
export const customerDemandRevisionListSchema = z.object({
  id,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(20).default(5),
});
export const procurementDemandListSchema = z.object({
  // mine/unassigned remain accepted for old browsers: they are quote-state aliases, not claim state.
  view: z.enum(["all", "quoted", "unquoted", "mine", "unassigned"]).default("all"),
  keyword: text(128), page: id.default(1), pageSize: z.number().int().min(1).max(100).default(20),
});
export const salesDemandListSchema = z.object({
  keyword: text(128),
  stage: z.enum(CUSTOMER_DEMAND_WORKFLOW_STAGES).optional(),
  scope: z.enum(["mine", "all"]).default("mine"),
  assignedUserId: id.optional(),
  due: z.enum(["all", "overdue"]).default("all"),
  page: id.default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const procurementDemandClaimSchema = z.object({ id, version: id });

export type CustomerDemandSummary = {
  id: number; demandNo: string; customerId: number; customerName: string;
  projectName: string; priority: "normal" | "urgent"; status: CustomerDemandStatus;
  createdByUserId: number; salesName: string; procurementUserId: number | null; procurementName: string;
  itemCount: number; version: number; replyDueAt: string | null; submittedAt: string | null;
  /** Business revision, independent from the optimistic mutation version. */
  revision?: number;
  /** All procurement quote headers, including stale quote revisions. */
  quoteCount?: number;
  /** Authoritative current actor capability; restrictions are described on the detail DTO. */
  canEdit?: boolean;
  hasActiveOrders?: boolean;
  createdAt: string; updatedAt: string;
};
export type CustomerDemandDetail = CustomerDemandSummary & {
  note: string;
  /** Every persisted source row includes its stable ID. */
  items: CustomerDemandItem[];
  canEdit: boolean;
  lockedItemIds?: number[];
  requiresQuoteReconfirmation?: boolean;
  editRestriction?: string;
};
export type ProcurementDemandSummary = Omit<CustomerDemandSummary, "customerId" | "customerName"> & {
  /** Quote metadata only; pricing and other users' quote contents are never in the procurement queue. */
  quoteCount?: number;
  currentQuoteCount?: number;
  myQuoteId?: number | null;
  myQuoteVersion?: number | null;
  /** A stale personal quote remains editable but is not a current confirmed quote. */
  myQuoteNeedsReconfirmation?: boolean;
  firstPartNumber: string;
  firstBrand: string;
  firstQty: number | null;
  firstQtyUnit: string;
  firstDeliveryRequirement: string;
  myActiveQuoteCount: number;
  mySupplierCount: number;
  myQuoteRoundCount: number;
};
export type ProcurementDemandDetail = ProcurementDemandSummary & {
  note: string;
  /** Source material IDs are exposed to procurement only after submission, for quote line binding. */
  items: Array<CustomerDemandItem & { id: number }>;
};
export type SalesDemandSummary = CustomerDemandSummary & {
  assignedUserId: number;
  assignedName: string;
  currentQuoteCount: number;
  acceptedQuoteCount: number;
  activeOrderCount: number;
  firstPartNumber: string;
  totalQty: number;
  qtyUnit: string;
  workflowStage: CustomerDemandWorkflowStage;
  nextAction: string;
  overdue: boolean;
  activityAt: string;
};
export type SalesDemandStageCounts = Record<CustomerDemandWorkflowStage, number> & { all: number; overdue: number };
export type SalesDemandPage = DemandPage<SalesDemandSummary> & { counts: SalesDemandStageCounts };
export type CustomerDemandSaveResult = { id: number; demandNo: string; status: CustomerDemandStatus; version: number; revision?: number; replayed: boolean };
export type DemandPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type CustomerDemandRevision = {
  id: number;
  revision: number;
  actorName: string;
  createdAt: string;
  changeReason: string;
  snapshot: CustomerDemandData;
};

export function deriveCustomerDemandWorkflow(input: {
  status: CustomerDemandStatus;
  currentQuoteCount: number;
  acceptedQuoteCount: number;
  activeOrderCount: number;
}): { stage: CustomerDemandWorkflowStage; nextAction: string } {
  if (input.status === "draft") return { stage: "draft", nextAction: "继续录入" };
  if (input.activeOrderCount > 0) return { stage: "customer_confirmed", nextAction: "查看销售订单" };
  if (input.acceptedQuoteCount > 0) return { stage: "quote_confirmed", nextAction: "与客户确认" };
  if (input.currentQuoteCount > 0) return { stage: "quote_selection", nextAction: "选择报价" };
  return { stage: "inquiring", nextAction: "等待采购报价" };
}

export function emptyCustomerDemandItem(): CustomerDemandItem {
  return { partNumber: "", brand: "", pkg: "", qty: null, qtyUnit: "片", deliveryRequirement: "", note: "" };
}
export function emptyCustomerDemandData(): CustomerDemandData {
  return { projectName: "", priority: "normal", replyDueAt: null, note: "", items: [emptyCustomerDemandItem()] };
}
