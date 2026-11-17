import { z } from "zod";

/** Server-derived only. Never accept ownerUserId from browser input. */
export type CompanyStockScope = { enterpriseId: number; actorUserId: number; ownerUserId: number };
export const companyStockLotsFilterSchema = z.object({
  partNumber: z.string().max(128).optional(), brand: z.string().max(64).optional(),
  pkg: z.string().max(64).optional(), dc: z.string().max(16).optional(),
  location: z.string().max(64).optional(), limit: z.number().int().min(1).max(200).default(100),
}).strict();
export type CompanyStockLotsFilter = z.input<typeof companyStockLotsFilterSchema>;
/** Sale-safe projection: no supplier, contact, payment, or purchasing cost. */
export type CompanyStockLotCandidate = {
  lotId: number; inboundOrderId: number; partNumber: string; brand: string; pkg: string;
  dc: string; lotNumber: string; location: string; availableQty: number; version: number;
};
export const companyStockLotsPageSchema = z.object({
  keyword: z.string().trim().max(128).default(""),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
}).strict();
export type CompanyStockLotsPageInput = z.input<typeof companyStockLotsPageSchema>;
export type CompanyStockLotsPage = { items: CompanyStockLotCandidate[]; total: number; page: number; pageSize: number; bounded: false };
export type CompanyStockLotCostSnapshot = {
  lotId: number; partNumber: string; unitCostTaxIncluded: string | null;
  unitCostTaxExcluded: string | null; unitCostBasis: string | null; taxRate: string | null;
};
export type CompanyStockItemIdentity = { partNumber: string; brand: string; pkg: string; dc: string };
export type CompanyStockAllocation = {
  orderItemId: number; lotId: number; qty: number;
  /** Optional defense-in-depth expectation; native service always rechecks stored CRM item. */
  expected?: CompanyStockItemIdentity;
};
export type CompanyStockReserveInput = { orderId: number; items: CompanyStockAllocation[] };
export type CompanyStockConsumeInput = CompanyStockReserveInput & { shipmentId: number; outboundDate?: string; note?: string };
export type CompanyStockConsumption = CompanyStockLotCostSnapshot & { orderItemId: number; qty: number; outboundOrderId: number; slipNo: string };
export type CompanyStockInboundSnapshot = {
  inboundOrderId: number;
  /** New physical receipt only: stock_ledger/effect already written in same transaction. */
  receiptKind: "new_receipt";
};
export type CompanyStockReleaseResult = { releasedQty: number };
export type CompanyStockConsumeResult = { items: CompanyStockConsumption[]; replayed: boolean };

export const companyStockReconciliationCandidatesSchema = z.object({
  partNumber: z.string().max(128).optional(), beforeId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const companyStockReconcileSchema = z.object({
  id: z.number().int().positive(), remainingQty: z.number().int().min(0).max(999999999),
  reason: z.string().trim().min(5, "请填写真实盘点和归属核对说明").max(500),
  ownershipConfirmed: z.literal(true), clientRequestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  expectedMovementVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CompanyStockReconcileInput = z.infer<typeof companyStockReconcileSchema>;
export type CompanyStockReconciliationCandidate = {
  id: number; slipNo: string; partNumber: string; brand: string; pkg: string; dc: string;
  lotNumber: string; location: string; currentQty: number; assignedRemainingQty: number;
  expectedMovementVersion: number; hasProcurementOwnership: boolean; status: "pending_reconciliation";
};
