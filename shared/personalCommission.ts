import { z } from "zod";
import { personalMonthSchema, personalPerformanceInputSchema } from "./personalPerformance";

/** Order creation month, NOT a collection-month settlement or payroll ledger. */
export const personalCommissionInputSchema = personalPerformanceInputSchema;
export const personalCommissionCenterInputSchema = personalCommissionInputSchema.extend({
  merchantId: z.number().int().positive().optional(),
}).strict();
export const personalReadErrorCategorySchema = z.enum([
  "identity_scope", "delegation_unavailable", "source_invalid", "query_failed",
]);
const money = z.string().regex(/^\d+\.\d{2}$/);
const precise = z.string().regex(/^\d+\.\d{6}$/);
const signedPrecise = z.string().regex(/^-?\d+\.\d{6}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const personalCommissionPendingReasonSchema = z.enum([
  "unknown_policy", "missing_financial_audit", "audit_mismatch", "missing_cost",
  "incomplete_allocations", "unknown_tax_basis", "invalid_financial_evidence",
]);
export const personalCommissionOrderSchema = z.object({
  id: z.number().int().positive(), orderNumber: z.string().max(128),
  createdAt: z.iso.datetime(), status: z.literal("confirmed"),
  totalAmount: precise, bankCashPaidAmount: precise, monthlyBookedAmount: precise,
  collectionGap: precise, collectionStatus: z.enum(["uncollected", "partial", "collected"]),
  policyVersion: z.string().max(128).nullable(),
  financialAuditId: z.number().int().positive().nullable(),
  calculationStatus: z.enum(["ready", "pending"]),
  pendingReason: personalCommissionPendingReasonSchema.nullable(),
  salesTaxMode: z.enum(["tax_included", "tax_excluded"]).nullable(),
  costAmount: precise.nullable(), expenseAmount: precise.nullable(),
  netProfit: signedPrecise.nullable(), rate: z.number().nullable(),
  estimatedAmount: money.nullable(), earnedAmount: money.nullable(),
}).strict();
const base = {
  month: personalMonthSchema, currency: z.literal("CNY"),
  currencyLabel: z.literal("人民币（按订单原税务口径）"), timezone: z.literal("Asia/Shanghai"),
  amount: z.null(), payoutStatus: z.literal("unavailable"),
  payoutReason: z.string().max(500), refundAmount: z.null(), refundStatus: z.literal("unavailable"),
};
export const personalCommissionResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...base, status: z.literal("available"), basis: z.string().max(3000),
    orderCount: count, readyCount: count, pendingCount: count,
    /** Null means the complete total is not verifiable. Subtotals include ready orders ONLY. */
    estimatedAmount: money.nullable(), earnedAmount: money.nullable(),
    verifiedEstimatedAmount: money, verifiedEarnedAmount: money,
    items: z.array(personalCommissionOrderSchema).max(50), total: count,
    page: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(50),
  }).strict(),
  z.object({ ...base, status: z.literal("unavailable"), reason: z.string().max(500),
    errorCategory: personalReadErrorCategorySchema, correlationId: z.uuid(),
  }).strict(),
]);
export type PersonalCommissionResult = z.infer<typeof personalCommissionResultSchema>;
export type PersonalCommissionOrder = z.infer<typeof personalCommissionOrderSchema>;
export type PersonalCommissionPendingReason = z.infer<typeof personalCommissionPendingReasonSchema>;
export type PersonalReadErrorCategory = z.infer<typeof personalReadErrorCategorySchema>;
export const PERSONAL_COMMISSION_PAYOUT_REASON = "未接通可审计的个人结算与发放来源；预计及回款达标预览均不代表已结算、已发放或个人权益审批。退款账本不可核实，退款金额未知。";
