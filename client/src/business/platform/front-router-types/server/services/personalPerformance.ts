import { sql, type SQLWrapper } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  crmDemandCustomerWhere,
  resolveCrmDemandPolicy,
} from "./customerDemands";
import {
  personalPerformanceInputSchema,
  personalPerformanceResultSchema,
  type PersonalPerformanceResult,
} from "../../../shared/personalPerformance";
export type PersonalPerformanceScope = {
  enterpriseId: number;
  actorUserId: number;
};
export type PersonalPerformanceExecutor = {
  execute(query: SQLWrapper): Promise<unknown>;
};
const rows = <T>(result: unknown) => (result as [T[], unknown])[0];
export function personalMonthBounds(month: string) {
  personalPerformanceInputSchema.parse({ month });
  const [year, m] = month.split("-").map(Number);
  const next =
    m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  return { start: `${month}-01`, end: `${next}-01` };
}
export function personalPerformanceDecimal(value: unknown) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,4})?$/.test(text))
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "业绩金额格式无法核实",
    });
  const [integer, fraction = ""] = text.split(".");
  return `${integer}.${fraction.padEnd(4, "0")}`;
}
export const PERSONAL_PERFORMANCE_BASIS =
  "仅当前已验证业务员工在当前企业创建的人民币订单（crm_sales_orders.createdByUserId=本人，currency=CNY），同时受现行客户/需求真实可见scope限制；所有角色都不得统计其他创建人或其他币种。订单数及含税订单额：status=confirmed，createdAt为北京时间，按所选自然月[start,end)全量SQL聚合，不含cancelled；分页items来自同一SQL快照，分页不会改变全量汇总。实际回款：本人confirmed人民币订单的crm_sales_order_payments中method=bank/cash，按paymentDate落月；不要求订单创建于当月，也不按收款操作人归属。monthlyBookedAmount仅method=monthly的账期登记，绝非现金回款。币种为CRM人民币含税口径，不跨币种换算。未发现可核实销售退款账本，refundAmount=null，不能视为零退款；订单after-sale文本不作为退款现金。";
export async function summarizePersonalPerformance(
  scope: PersonalPerformanceScope,
  input: { month: string; page?: number; pageSize?: number },
  injected?: PersonalPerformanceExecutor
): Promise<PersonalPerformanceResult> {
  const parsed = personalPerformanceInputSchema.parse(input);
  const database = injected ?? (await getDb());
  if (!database)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "业绩数据源暂不可用",
    });
  const actor = rows<{
    id: number;
    role: string;
    status: string;
    loginDisabled: number | boolean;
    superAdminUserId: number;
  }>(
    await database.execute(sql`
    SELECT em.id, em.role, em.status, u.loginDisabled, e.superAdminUserId FROM enterprises e
    INNER JOIN enterprise_members em ON em.enterpriseId = e.id INNER JOIN users u ON u.id = em.userId
    WHERE e.id = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId} LIMIT 1`)
  )[0];
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled))
    throw new TRPCError({ code: "FORBIDDEN", message: "当前企业员工不可用" });
  const owner =
    actor.role === "super_admin" &&
    Number(actor.superAdminUserId) === scope.actorUserId;
  if (!owner) {
    const permissions = rows<{ permissionKey: string }>(
      await database.execute(
        sql`SELECT permissionKey FROM enterprise_member_permissions WHERE enterpriseMemberId = ${actor.id}`
      )
    );
    if (!permissions.some(row => row.permissionKey === "sales.business_orders"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "您没有本人销售订单读取权限",
      });
  }
  const policy = await resolveCrmDemandPolicy(database, scope);
  const { start, end } = personalMonthBounds(parsed.month);
  const ownWhere = sql`o.enterpriseId = ${scope.enterpriseId} AND o.createdByUserId = ${scope.actorUserId}
    AND o.status = 'confirmed' AND o.currency = 'CNY' AND EXISTS (SELECT 1 FROM crm_customers c
      WHERE c.enterpriseId = o.enterpriseId AND c.id = o.customerId AND ${crmDemandCustomerWhere(scope, policy)})`;
  // Separate scalar aggregates are evaluated in one SQL snapshot. Payments cannot multiply order totals.
  const summary = rows<{
    orderCount: number | string;
    orderAmount: string;
    collectedAmount: string;
    monthlyBookedAmount: string;
    items: unknown;
  }>(
    await database.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM crm_sales_orders o WHERE ${ownWhere}
        AND o.createdAt >= ${`${start} 00:00:00`} AND o.createdAt < ${`${end} 00:00:00`}) AS orderCount,
      (SELECT COALESCE(SUM(o.totalAmount), 0) FROM crm_sales_orders o WHERE ${ownWhere}
        AND o.createdAt >= ${`${start} 00:00:00`} AND o.createdAt < ${`${end} 00:00:00`}) AS orderAmount,
      (SELECT COALESCE(SUM(p.amount), 0) FROM crm_sales_order_payments p
        INNER JOIN crm_sales_orders o ON o.id = p.orderId AND o.enterpriseId = p.enterpriseId
        WHERE ${ownWhere} AND p.method IN ('bank', 'cash') AND p.paymentDate >= ${start} AND p.paymentDate < ${end}) AS collectedAmount,
      (SELECT COALESCE(SUM(p.amount), 0) FROM crm_sales_order_payments p
        INNER JOIN crm_sales_orders o ON o.id = p.orderId AND o.enterpriseId = p.enterpriseId
        WHERE ${ownWhere} AND p.method = 'monthly' AND p.paymentDate >= ${start} AND p.paymentDate < ${end}) AS monthlyBookedAmount,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', order_page.id, 'orderNumber', order_page.orderNumber,
          'totalAmount', order_page.totalAmount, 'createdAt', order_page.createdAt)) FROM (
        SELECT o.id, o.orderNumber, CAST(o.totalAmount AS CHAR) AS totalAmount,
          DATE_FORMAT(o.createdAt, '%Y-%m-%dT%H:%i:%s') AS createdAt FROM crm_sales_orders o WHERE ${ownWhere}
          AND o.createdAt >= ${`${start} 00:00:00`} AND o.createdAt < ${`${end} 00:00:00`}
          ORDER BY o.createdAt DESC, o.id DESC LIMIT ${parsed.pageSize} OFFSET ${(parsed.page - 1) * parsed.pageSize}
        ) order_page), JSON_ARRAY()) AS items`)
  )[0];
  if (!summary)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "业绩数据源未返回完整汇总",
    });
  const rawItems: unknown =
    typeof summary.items === "string"
      ? JSON.parse(summary.items)
      : summary.items;
  if (!Array.isArray(rawItems))
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "订单分页来源无法核实",
    });
  const items = rawItems
    .map(
      (item: {
        id: number;
        orderNumber: string;
        totalAmount: unknown;
        createdAt: string;
      }) => ({
        id: Number(item.id),
        orderNumber: item.orderNumber,
        totalAmount: personalPerformanceDecimal(item.totalAmount),
        createdAt: new Date(`${item.createdAt}+08:00`).toISOString(),
        status: "confirmed" as const,
        currencyLabel: "人民币（含税）" as const,
      })
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return personalPerformanceResultSchema.parse({
    status: "available",
    month: parsed.month,
    currency: "CNY",
    currencyLabel: "人民币（含税）",
    timezone: "Asia/Shanghai",
    orderCount: Number(summary.orderCount),
    orderAmount: personalPerformanceDecimal(summary.orderAmount),
    collectedAmount: personalPerformanceDecimal(summary.collectedAmount),
    monthlyBookedAmount: personalPerformanceDecimal(
      summary.monthlyBookedAmount
    ),
    refundAmount: null,
    refundStatus: "unavailable",
    basis: PERSONAL_PERFORMANCE_BASIS,
    items,
    total: Number(summary.orderCount),
    page: parsed.page,
    pageSize: parsed.pageSize,
  });
}
