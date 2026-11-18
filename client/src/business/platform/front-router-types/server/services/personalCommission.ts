import { sql, type SQLWrapper } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { resolveCrmDemandPolicy, crmDemandCustomerWhere } from "./customerDemands";
import { personalMonthBounds, type PersonalPerformanceScope } from "./personalPerformance";
import { calculateSalesProfit, type SalesCommissionPolicy } from "../../../shared/salesProfit";
import { decimalToScaled, scaledToDecimal } from "../../../shared/crmSalesOrders";
import {
  personalCommissionInputSchema, personalCommissionResultSchema,
  PERSONAL_COMMISSION_PAYOUT_REASON, type PersonalCommissionOrder,
  type PersonalCommissionPendingReason, type PersonalCommissionResult,
} from "../../../shared/personalCommission";

export type PersonalCommissionExecutor = { execute(query: SQLWrapper): Promise<unknown> };
const rows = <T>(result: unknown): T[] => (result as [T[], unknown])[0];
/** Immutable historical mapping. Never fall back to SALES_COMMISSION_POLICY. */
export function personalCommissionPolicy(savedVersion: string | null): SalesCommissionPolicy | null {
  if (savedVersion === "20261117-per-order-whole-margin87-after-expenses")
    return { version: savedVersion, bandMode: "whole", taxMode: "margin_deduct13" };
  return null;
}
const micro = (value: unknown) => {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Invalid decimal evidence");
  return decimalToScaled(value, 6);
};
const precise = (value: unknown) => scaledToDecimal(micro(value), 6);
const cents = (value: bigint) => scaledToDecimal(value, 2);
const json = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
export type PersonalCommissionSourceOrder = {
  id: number; orderNumber: string; createdAt: string; totalAmount: string;
  salesTaxMode: "tax_included" | "tax_excluded" | null; salesExpenses: string | null;
  profitPolicyVersion: string | null; bankCashPaidAmount: string; monthlyBookedAmount: string;
  audits: unknown; orderItems: unknown;
};
/** Financial records only: shipment without profit must never displace a ready snapshot. */
function financialEvidence(audit: any): any {
  const raw = json(audit.financialSnapshot);
  if (!raw || typeof raw !== "object") return null;
  if (audit.action === "payment" || audit.action === "expenses")
    return raw.after?.financials ?? raw.after;
  if (audit.action === "created" || audit.action === "stock_allocated")
    return raw.financials ?? raw;
  return null;
}
export function personalCommissionOrder(source: PersonalCommissionSourceOrder): PersonalCommissionOrder {
  const sales = micro(source.totalAmount), paid = micro(source.bankCashPaidAmount);
  const status = paid <= BigInt(0) ? "uncollected" : sales > BigInt(0) && paid >= sales ? "collected" : "partial";
  const item: PersonalCommissionOrder = {
    id: Number(source.id), orderNumber: source.orderNumber,
    createdAt: new Date(`${source.createdAt}+08:00`).toISOString(), status: "confirmed",
    totalAmount: precise(source.totalAmount), bankCashPaidAmount: precise(source.bankCashPaidAmount),
    monthlyBookedAmount: precise(source.monthlyBookedAmount),
    collectionGap: scaledToDecimal(sales > paid ? sales - paid : BigInt(0), 6), collectionStatus: status,
    policyVersion: source.profitPolicyVersion, financialAuditId: null,
    calculationStatus: "pending", pendingReason: null, salesTaxMode: source.salesTaxMode,
    costAmount: null, expenseAmount: null, netProfit: null, rate: null, estimatedAmount: null, earnedAmount: null,
  };
  const pending = (reason: PersonalCommissionPendingReason) => ({ ...item, pendingReason: reason });
  const policy = personalCommissionPolicy(source.profitPolicyVersion);
  if (!policy) return pending("unknown_policy");
  if (source.salesTaxMode !== "tax_included" && source.salesTaxMode !== "tax_excluded") return pending("unknown_tax_basis");
  try {
    const audits = json(source.audits);
    if (!Array.isArray(audits)) return pending("invalid_financial_evidence");
    const matching = audits.filter(a => a.policyVersion === source.profitPolicyVersion &&
      ["created", "stock_allocated", "payment", "expenses"].includes(a.action));
    matching.sort((a, b) => Number(b.id) - Number(a.id));
    // Do not skip a newer corrupt matching financial event to reuse an older ready result.
    const audit = matching[0];
    if (!audit) return pending("missing_financial_audit");
    item.financialAuditId = Number(audit.id);
    const evidence = financialEvidence(audit), cost = evidence?.costSnapshot, profit = evidence?.profitBreakdown;
    if (!cost || !profit) return pending("missing_cost");
    if (evidence.policyVersion !== source.profitPolicyVersion || profit.policyVersion !== source.profitPolicyVersion ||
        cost.schemaVersion !== 1 || cost.salesTaxMode !== source.salesTaxMode || profit.salesTaxMode !== source.salesTaxMode ||
        micro(profit.salesAmount) !== sales || source.salesExpenses == null ||
        micro(profit.expenseAmount) !== micro(source.salesExpenses)) return pending("audit_mismatch");
    if (cost.allocationsComplete !== true) return pending("incomplete_allocations");
    if (cost.costsComplete !== true || cost.costAmount == null || profit.costAmount == null) return pending("missing_cost");
    if (!Array.isArray(cost.allocations) || !cost.allocations.length || !Array.isArray(cost.lotCosts) ||
        !Array.isArray(cost.missingLotIds) || cost.missingLotIds.length) return pending("missing_cost");
    const orderItems = json(source.orderItems);
    if (!Array.isArray(orderItems) || !orderItems.length) return pending("incomplete_allocations");
    const quantities = new Map<number, number>();
    const unitKey = source.salesTaxMode === "tax_included" ? "unitCostTaxIncluded" : "unitCostTaxExcluded";
    const lotCosts = new Map<number, any>();
    for (const lot of cost.lotCosts) {
      if (lotCosts.has(Number(lot.lotId))) return pending("invalid_financial_evidence");
      lotCosts.set(Number(lot.lotId), lot);
    }
    let calculatedCost = BigInt(0);
    for (const allocation of cost.allocations) {
      const qty = Number(allocation.qty), released = Number(allocation.releasedQty), consumed = Number(allocation.consumedQty);
      if (![qty, released, consumed].every(Number.isSafeInteger) || qty <= 0 || released < 0 || consumed < 0 || released + consumed > qty)
        return pending("incomplete_allocations");
      const id = Number(allocation.orderItemId);
      if (!orderItems.some(i => Number(i.id) === id)) return pending("incomplete_allocations");
      quantities.set(id, (quantities.get(id) ?? 0) + qty - released);
      const lot = lotCosts.get(Number(allocation.lotId));
      if (lot?.[unitKey] == null) return pending("missing_cost");
      calculatedCost += micro(lot[unitKey]) * BigInt(qty - released);
    }
    if (orderItems.some(i => !Number.isSafeInteger(Number(i.orderedQty)) || Number(i.orderedQty) <= 0 ||
        quantities.get(Number(i.id)) !== Number(i.orderedQty))) return pending("incomplete_allocations");
    if (micro(cost.costAmount) !== calculatedCost || micro(profit.costAmount) !== calculatedCost || profit.status !== "ready")
      return pending("audit_mismatch");
    const result = calculateSalesProfit({ salesAmount: source.totalAmount, costAmount: scaledToDecimal(calculatedCost, 6),
      expenseAmount: source.salesExpenses, salesTaxMode: source.salesTaxMode, bankCashPaidAmount: source.bankCashPaidAmount }, policy);
    return { ...item, calculationStatus: "ready", pendingReason: null,
      costAmount: result.profitBreakdown.costAmount, expenseAmount: result.profitBreakdown.expenseAmount,
      netProfit: result.profitBreakdown.netProfit, rate: result.commissionPreview.rate,
      estimatedAmount: result.commissionPreview.estimatedAmount, earnedAmount: result.commissionPreview.earnedAmount };
  } catch {
    return pending("invalid_financial_evidence");
  }
}
export const PERSONAL_COMMISSION_BASIS = "按所选订单创建自然月（北京时间[start,end)）展示本人在当前企业创建、confirmed且CNY并满足当前客户/需求可见范围的全部订单。汇总基于全量，不是当前页求和。每笔预计与回款达标预览按订单保存的profitPolicyVersion显式解析及最新匹配版本金融审计的实际成本/分配/费用/税务口径计算；未知历史版本、缺成本或分配证据待核，不能按现行规则或零成本推算。bank/cash为该订单整个生命期累计真实回款，monthly仅账期登记；足额条件使用当前订单额与生命周期回款，绝非回款月份结算。费用调整取最新匹配审计且须与当前订单一致；不把出货无利润快照覆盖金融证据。回款达标仅预览，不证明退款、已结算、已发放或员工权益审批。";
export async function summarizePersonalCommission(scope: PersonalPerformanceScope,
  input: { month: string; page?: number; pageSize?: number }, injected?: PersonalCommissionExecutor): Promise<PersonalCommissionResult> {
  const parsed = personalCommissionInputSchema.parse(input);
  const database = injected ?? await getDb();
  if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "提成数据源暂不可用" });
  const actor = rows<{ id: number; role: string; status: string; loginDisabled: boolean | number; superAdminUserId: number }>(
    await database.execute(sql`SELECT em.id, em.role, em.status, u.loginDisabled, e.superAdminUserId FROM enterprises e
      INNER JOIN enterprise_members em ON em.enterpriseId = e.id INNER JOIN users u ON u.id = em.userId
      WHERE e.id = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId} LIMIT 1`))[0];
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) throw new TRPCError({ code: "FORBIDDEN", message: "当前企业员工不可用" });
  if (!(actor.role === "super_admin" && Number(actor.superAdminUserId) === scope.actorUserId)) {
    const permissions = rows<{ permissionKey: string }>(await database.execute(sql`SELECT permissionKey FROM enterprise_member_permissions WHERE enterpriseMemberId = ${actor.id}`));
    if (!permissions.some(p => p.permissionKey === "sales.business_orders")) throw new TRPCError({ code: "FORBIDDEN", message: "您没有本人销售订单读取权限" });
  }
  const policy = await resolveCrmDemandPolicy(database, scope);
  const { start, end } = personalMonthBounds(parsed.month);
  // One SELECT snapshot includes all eligible orders, lifetime collections, original items and audit evidence.
  const source = rows<PersonalCommissionSourceOrder>(await database.execute(sql`
    SELECT o.id, o.orderNumber, DATE_FORMAT(o.createdAt, '%Y-%m-%dT%H:%i:%s') AS createdAt,
      CAST(o.totalAmount AS CHAR) AS totalAmount, o.salesTaxMode, CAST(o.salesExpenses AS CHAR) AS salesExpenses, o.profitPolicyVersion,
      (SELECT CAST(COALESCE(SUM(p.amount), 0) AS CHAR) FROM crm_sales_order_payments p WHERE p.enterpriseId = o.enterpriseId
        AND p.orderId = o.id AND p.method IN ('bank', 'cash')) AS bankCashPaidAmount,
      (SELECT CAST(COALESCE(SUM(p.amount), 0) AS CHAR) FROM crm_sales_order_payments p WHERE p.enterpriseId = o.enterpriseId
        AND p.orderId = o.id AND p.method = 'monthly') AS monthlyBookedAmount,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'action', a.action, 'policyVersion', a.policyVersion,
        'financialSnapshot', a.financialSnapshot)) FROM crm_sales_order_audits a WHERE a.enterpriseId = o.enterpriseId AND a.orderId = o.id
        AND a.action IN ('created', 'stock_allocated', 'payment', 'expenses') AND a.policyVersion = o.profitPolicyVersion), JSON_ARRAY()) AS audits,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', i.id, 'orderedQty', i.orderedQty)) FROM crm_sales_order_items i
        WHERE i.enterpriseId = o.enterpriseId AND i.orderId = o.id), JSON_ARRAY()) AS orderItems
    FROM crm_sales_orders o WHERE o.enterpriseId = ${scope.enterpriseId} AND o.createdByUserId = ${scope.actorUserId}
      AND o.status = 'confirmed' AND o.currency = 'CNY' AND o.createdAt >= ${`${start} 00:00:00`} AND o.createdAt < ${`${end} 00:00:00`}
      AND EXISTS (SELECT 1 FROM crm_customers c WHERE c.enterpriseId = o.enterpriseId AND c.id = o.customerId AND ${crmDemandCustomerWhere(scope, policy)})
    ORDER BY o.createdAt DESC, o.id DESC`));
  if (!Array.isArray(source)) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "提成数据源返回无效" });
  const all = source.map(personalCommissionOrder);
  const pendingCount = all.filter(i => i.calculationStatus === "pending").length;
  const estimated = all.reduce((sum, i) => sum + (i.estimatedAmount == null ? BigInt(0) : decimalToScaled(i.estimatedAmount, 2)), BigInt(0));
  const earned = all.reduce((sum, i) => sum + (i.earnedAmount == null ? BigInt(0) : decimalToScaled(i.earnedAmount, 2)), BigInt(0));
  return personalCommissionResultSchema.parse({ status: "available", month: parsed.month, currency: "CNY",
    currencyLabel: "人民币（按订单原税务口径）", timezone: "Asia/Shanghai", amount: null, payoutStatus: "unavailable",
    payoutReason: PERSONAL_COMMISSION_PAYOUT_REASON, refundAmount: null, refundStatus: "unavailable", basis: PERSONAL_COMMISSION_BASIS,
    orderCount: all.length, total: all.length, readyCount: all.length - pendingCount, pendingCount,
    estimatedAmount: pendingCount ? null : cents(estimated), earnedAmount: pendingCount ? null : cents(earned),
    verifiedEstimatedAmount: cents(estimated), verifiedEarnedAmount: cents(earned),
    items: all.slice((parsed.page - 1) * parsed.pageSize, parsed.page * parsed.pageSize), page: parsed.page, pageSize: parsed.pageSize });
}
