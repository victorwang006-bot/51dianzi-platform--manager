import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  CRM_SALES_ORDER_CURRENCY_LABEL,
  canonicalSalesOrderCreatePayload,
  calculateSalesOrderAmounts,
  decimalToScaled,
  salesOrderCandidateListSchema,
  salesOrderCreateSchema,
  salesOrderCustomerSummarySchema,
  salesOrderCustomerMaterialsSchema,
  salesOrderIdSchema,
  salesOrderListSchema,
  salesOrderPaymentSchema,
  salesOrderShipSchema,
  salesPaymentStatus,
  salesShipmentStatus,
  scaledToDecimal,
  type SalesOrderCandidateListInput,
  type SalesOrderCreateInput,
  type SalesOrderCustomerSummaryInput,
  type SalesOrderCustomerSummary,
  type SalesOrderCustomerMaterialsInput,
  type SalesOrderCustomerMaterial,
  type SalesOrderDetail,
  type SalesOrderIdInput,
  type SalesOrderItem,
  type SalesOrderListInput,
  type SalesOrderPage,
  type SalesOrderPaymentInput,
  type SalesOrderShipInput,
  type SalesOrderSummary,
  type SalesOrderDemandCandidate,
} from "../../../shared/crmSalesOrders";
import { getDb } from "../db";
import { assertCrmDemandCustomer, crmDemandCustomerWhere, resolveCrmDemandPolicy, type CrmDemandPolicy } from "./customerDemands";

/** Identity is always the independently authenticated employee, never effectiveUserId. */
export type CrmSalesOrderScope = { enterpriseId: number; actorUserId: number };
type SqlExecutor = { execute: (query: SQLWrapper) => Promise<unknown> };
type MembershipRow = {
  id: number; userId: number; role: "super_admin" | "admin" | "member";
  status: "active" | "suspended"; loginDisabled: number | boolean;
};
type SalesAccess = { canManageAll: boolean; actor: MembershipRow; policy: CrmDemandPolicy };
type CustomerRow = { id: number; assignedUserId: number; name: string; archivedAt: Date | string | null };
type DemandRow = {
  id: number; customerId: number; demandNo: string; projectName: string; status: "draft" | "submitted" | "processing";
  revision: number;
  customerName?: string | null;
};
type DemandItemRow = {
  id: number; sortOrder: number; partNumber: string; brand: string; pkg: string; qty: number | null;
  qtyUnit: string; deliveryRequirement: string; note: string;
};
type OrderRow = {
  id: number; enterpriseId: number; customerId: number; customerName: string; demandId: number; demandNo: string;
  projectName: string; orderNumber: string; status: "confirmed" | "cancelled"; totalAmount: string | number;
  dueDate: string | null; confirmationNote: string; createdByUserId: number; cancelledReason: string | null;
  cancelledAt: Date | string | null; createdAt: Date | string; updatedAt: Date | string; version: number;
  createdByName?: string | null;
  paidAmount?: string | number; monthlyAmount?: string | number; orderedQty?: number | string; shippedQty?: number | string;
};
type RequestAction = "create" | "payment" | "shipment";

const SALES_ORDER_PERMISSION = "sales.business_orders";
const CUSTOMER_PERMISSION = "customers.manage";
const CUSTOMER_ALL_PERMISSION = "customers.manage_all";
const CRM_NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;

function resultRows<T>(result: unknown): T[] {
  return ((result as [T[], unknown] | undefined)?.[0] ?? []) as T[];
}
function resultHeader(result: unknown): { affectedRows?: number; insertId?: number } {
  return ((result as [{ affectedRows?: number; insertId?: number }, unknown] | undefined)?.[0] ?? {});
}
async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}
function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? new Date(`${raw.replace(" ", "T")}+08:00`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function displayName(value: string | null | undefined, userId: number) {
  return value?.trim() || `用户${userId}`;
}
function money(value: string | number | null | undefined) {
  const raw = String(value ?? "0").trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return "0.0000";
  const [integerPart, fractionalPart = ""] = raw.split(".");
  return `${integerPart}.${(fractionalPart + "0000").slice(0, 4)}`;
}
function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function checkedCreate(rawInput: SalesOrderCreateInput): SalesOrderCreateInput {
  const checked = salesOrderCreateSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "请检查订单内容", cause: checked.error });
  return checked.data;
}

async function actorMembership(executor: SqlExecutor, scope: CrmSalesOrderScope, lock: boolean) {
  const actor = resultRows<MembershipRow & { superAdminUserId: number }>(await executor.execute(sql`
    SELECT em.id, em.userId, em.role, em.status, u.loginDisabled, e.superAdminUserId
      FROM enterprises e
      INNER JOIN enterprise_members em ON em.enterpriseId = e.id
      INNER JOIN users u ON u.id = em.userId
     WHERE e.id = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId}
     LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员不可用" });
  }
  return { actor, owner: actor.role === "super_admin" && Number(actor.superAdminUserId) === scope.actorUserId };
}

/** Member locks precede customer/demand/order locks, matching customer transfer and demand writes. */
async function lockedEnterpriseMembers(tx: SqlExecutor, scope: CrmSalesOrderScope) {
  const enterprise = resultRows<{ id: number; superAdminUserId: number }>(await tx.execute(sql`
    SELECT id, superAdminUserId FROM enterprises WHERE id = ${scope.enterpriseId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!enterprise) throw new TRPCError({ code: "FORBIDDEN", message: "企业归属已变化，请重新登录" });
  const members = resultRows<MembershipRow>(await tx.execute(sql`
    SELECT em.id, em.userId, em.role, em.status, u.loginDisabled
      FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
     WHERE em.enterpriseId = ${scope.enterpriseId}
     ORDER BY em.userId FOR UPDATE
  `));
  const actor = members.find(member => Number(member.userId) === scope.actorUserId);
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员不可用" });
  }
  return { actor, owner: actor.role === "super_admin" && Number(enterprise.superAdminUserId) === scope.actorUserId };
}
async function permissionKeys(executor: SqlExecutor, memberId: number, lock: boolean) {
  return resultRows<{ permissionKey: string }>(await executor.execute(sql`
    SELECT permissionKey FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${memberId} ${lock ? sql`FOR UPDATE` : sql``}
  `)).map(row => row.permissionKey);
}

/** Every call checks both permissions fresh; router permission middleware is defense in depth only. */
async function requireSalesOrderAccess(executor: SqlExecutor, scope: CrmSalesOrderScope, lock = false): Promise<SalesAccess> {
  const state = lock ? await lockedEnterpriseMembers(executor, scope) : await actorMembership(executor, scope, false);
  const permissions = state.owner ? [] : await permissionKeys(executor, state.actor.id, lock);
  if (!state.owner && !permissions.includes(SALES_ORDER_PERMISSION)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有销售订单权限" });
  }
  const policy = await resolveCrmDemandPolicy(executor, scope, lock);
  return { canManageAll: policy.customers.scope === "enterprise" && policy.demands.scope === "enterprise", actor: state.actor, policy };
}

async function accessibleCustomer(executor: SqlExecutor, scope: CrmSalesOrderScope, canManageAll: boolean, customerId: number, lock = false) {
  const customer = resultRows<CustomerRow>(await executor.execute(sql`
    SELECT id, assignedUserId, name, archivedAt FROM crm_customers
     WHERE enterpriseId = ${scope.enterpriseId} AND id = ${customerId}
     LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  if (!customer) {
    throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
  }
  const policy = await resolveCrmDemandPolicy(executor, scope, lock);
  await assertCrmDemandCustomer(executor, scope, policy, customerId, lock);
  return customer;
}
async function lockDemand(tx: SqlExecutor, scope: CrmSalesOrderScope, customerId: number, demandId: number) {
  const demand = resultRows<DemandRow>(await tx.execute(sql`
    SELECT id, customerId, demandNo, projectName, status, revision FROM crm_customer_demands
     WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customerId} AND id = ${demandId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!demand) throw new TRPCError({ code: "NOT_FOUND", message: "客户需求不存在" });
  if (demand.status !== "submitted" && demand.status !== "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "仅已提交或采购处理中的客户需求可生成订单" });
  }
  return demand;
}
async function lockedDemandItems(tx: SqlExecutor, scope: CrmSalesOrderScope, demandId: number) {
  return resultRows<DemandItemRow>(await tx.execute(sql`
    SELECT id, sortOrder, partNumber, brand, pkg, qty, qtyUnit, deliveryRequirement, note
      FROM crm_customer_demand_items
     WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${demandId}
     ORDER BY sortOrder ASC, id ASC FOR UPDATE
  `));
}
async function reserveRequest(tx: SqlExecutor, input: { enterpriseId: number; actorUserId: number; requestId: string; payloadHash: string; action: RequestAction }) {
  const existing = resultRows<{ action: string; payloadHash: string; orderId: number }>(await tx.execute(sql`
    SELECT action, payloadHash, orderId FROM crm_sales_order_requests
     WHERE enterpriseId = ${input.enterpriseId} AND actorUserId = ${input.actorUserId} AND requestId = ${input.requestId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (existing) {
    if (existing.action !== input.action || existing.payloadHash !== input.payloadHash) {
      throw new TRPCError({ code: "CONFLICT", message: "请求号已用于不同内容" });
    }
    if (Number(existing.orderId) > 0) return { replayed: true as const, orderId: Number(existing.orderId) };
    throw new TRPCError({ code: "CONFLICT", message: "请求正在处理中，请稍后重试" });
  }
  await tx.execute(sql`
    INSERT INTO crm_sales_order_requests (enterpriseId, actorUserId, requestId, action, payloadHash, orderId, createdAt)
    VALUES (${input.enterpriseId}, ${input.actorUserId}, ${input.requestId}, ${input.action}, ${input.payloadHash}, 0, ${CRM_NOW})
  `);
  return { replayed: false as const, orderId: 0 };
}
async function insertAudit(tx: SqlExecutor, input: {
  enterpriseId: number; customerId: number; orderId: number; actorUserId: number;
  action: "created" | "cancelled" | "payment" | "shipment"; note: string; requestId?: string | null;
}) {
  await tx.execute(sql`
    INSERT INTO crm_sales_order_audits
      (enterpriseId, customerId, orderId, actorUserId, action, note, requestId, createdAt)
    VALUES (${input.enterpriseId}, ${input.customerId}, ${input.orderId}, ${input.actorUserId}, ${input.action},
      ${input.note.slice(0, 500)}, ${input.requestId ?? null}, ${CRM_NOW})
  `);
}

function orderSelect() {
  return sql`
    SELECT o.id, o.enterpriseId, o.customerId, o.customerName, o.demandId, o.demandNo, o.projectName, o.orderNumber,
           o.status, o.totalAmount, DATE_FORMAT(o.dueDate, '%Y-%m-%d') AS dueDate, o.confirmationNote, o.createdByUserId, o.cancelledReason, o.cancelledAt,
           o.createdAt, o.updatedAt, o.version,
           COALESCE(creator.name, creator.username, CONCAT('用户', creator.id)) AS createdByName,
           ${FULFILLMENT_SELECT}
      FROM crm_sales_orders o LEFT JOIN users creator ON creator.id = o.createdByUserId
  `;
}
function fulfillmentOf(row: OrderRow) {
  const paidAmount = money(row.paidAmount);
  const monthlyAmount = money(row.monthlyAmount);
  const totalAmount = money(row.totalAmount);
  const orderedQty = Number(row.orderedQty ?? 0);
  const shippedQty = Number(row.shippedQty ?? 0);
  return {
    paidAmount, monthlyAmount,
    paymentStatus: salesPaymentStatus({ totalAmount, paidAmount, monthlyAmount }),
    orderedQty, shippedQty, shipmentStatus: salesShipmentStatus(shippedQty, orderedQty),
  };
}
function mapSummary(row: OrderRow): SalesOrderSummary {
  return {
    id: Number(row.id), orderNumber: row.orderNumber, customerId: Number(row.customerId), customerName: row.customerName,
    demandId: Number(row.demandId), demandNo: row.demandNo, projectName: row.projectName ?? "", status: row.status,
    totalAmount: money(row.totalAmount), currencyLabel: CRM_SALES_ORDER_CURRENCY_LABEL, itemCount: 0,
    ...fulfillmentOf(row),
    dueDate: row.dueDate ?? null, createdByName: displayName(row.createdByName, Number(row.createdByUserId)),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(), updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    version: Number(row.version),
  };
}
const FULFILLMENT_SELECT = sql`
  COALESCE((SELECT SUM(CASE WHEN pay.method = 'monthly' THEN 0 ELSE pay.amount END) FROM crm_sales_order_payments pay
            WHERE pay.enterpriseId = o.enterpriseId AND pay.orderId = o.id), 0) AS paidAmount,
  COALESCE((SELECT SUM(CASE WHEN pay.method = 'monthly' THEN pay.amount ELSE 0 END) FROM crm_sales_order_payments pay
            WHERE pay.enterpriseId = o.enterpriseId AND pay.orderId = o.id), 0) AS monthlyAmount,
  COALESCE((SELECT SUM(soi.orderedQty) FROM crm_sales_order_items soi WHERE soi.enterpriseId = o.enterpriseId AND soi.orderId = o.id), 0) AS orderedQty,
  COALESCE((SELECT SUM(si.qty) FROM crm_sales_order_shipment_items si WHERE si.enterpriseId = o.enterpriseId AND si.orderId = o.id), 0) AS shippedQty
`;
function orderScopeWhere(scope: CrmSalesOrderScope, policy: CrmDemandPolicy) {
  return sql`o.enterpriseId = ${scope.enterpriseId} AND ${crmDemandCustomerWhere(scope, policy)}`;
}
/** Eligible submitted demand candidates include customer identity only after dual sales+customer authorization. */
export async function listSalesOrderCandidates(scope: CrmSalesOrderScope, rawInput: SalesOrderCandidateListInput): Promise<SalesOrderPage<SalesOrderDemandCandidate>> {
  const parsed = salesOrderCandidateListSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "候选需求查询参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  const access = await requireSalesOrderAccess(db, scope);
  if (input.customerId !== undefined) {
    await assertCrmDemandCustomer(db, scope, access.policy, input.customerId);
  }
  const conditions = [
    sql`d.enterpriseId = ${scope.enterpriseId}`,
    sql`d.status IN ('submitted', 'processing')`,
    sql`c.archivedAt IS NULL`,
    sql`EXISTS (
      SELECT 1 FROM crm_customer_demand_quote_acceptances accepted
        INNER JOIN crm_customer_demand_quotes source_quote
          ON source_quote.enterpriseId = accepted.enterpriseId AND source_quote.id = accepted.quoteId
         AND source_quote.demandId = accepted.demandId AND source_quote.version = accepted.quoteVersion
         AND source_quote.demandRevision = accepted.demandRevision AND source_quote.status = 'active'
       WHERE accepted.enterpriseId = d.enterpriseId AND accepted.demandId = d.id
         AND accepted.demandRevision = d.revision
    )`,
  ];
  conditions.push(crmDemandCustomerWhere(scope, access.policy));
  if (input.customerId !== undefined) conditions.push(sql`d.customerId = ${input.customerId}`);
  if (input.keyword) {
    const keyword = `%${input.keyword}%`;
    conditions.push(sql`(d.demandNo LIKE ${keyword} OR d.projectName LIKE ${keyword} OR EXISTS (
      SELECT 1 FROM crm_customer_demand_items matching_item
       WHERE matching_item.enterpriseId = d.enterpriseId AND matching_item.demandId = d.id AND matching_item.partNumber LIKE ${keyword}
    ))`);
  }
  const where = sql.join(conditions, sql` AND `);
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE ${where}
  `))[0];
  const rows = resultRows<DemandRow>(await db.execute(sql`
    SELECT d.id, d.customerId, d.demandNo, d.projectName, d.status, d.revision, c.name AS customerName
      FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE ${where}
     ORDER BY d.updatedAt DESC, d.id DESC
     LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  `));
  if (!rows.length) return { items: [], total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
  const demandIds = rows.map(row => Number(row.id));
  type CandidateItemRow = DemandItemRow & { demandId: number; orderedQty: number | string | null; acceptedQty: number | string | null };
  const itemRows = resultRows<CandidateItemRow>(await db.execute(sql`
    SELECT i.id, i.demandId, i.sortOrder, i.partNumber, i.brand, i.pkg, i.qty, i.qtyUnit, i.deliveryRequirement, i.note,
           COALESCE((SELECT SUM(accepted_item.qty) FROM crm_customer_demand_quote_acceptances accepted
             INNER JOIN crm_customer_demand_quotes source_quote
               ON source_quote.enterpriseId = accepted.enterpriseId AND source_quote.id = accepted.quoteId
              AND source_quote.demandId = accepted.demandId AND source_quote.version = accepted.quoteVersion
              AND source_quote.demandRevision = accepted.demandRevision AND source_quote.status = 'active'
             INNER JOIN crm_customer_demand_quote_acceptance_items accepted_item
               ON accepted_item.enterpriseId = accepted.enterpriseId AND accepted_item.acceptanceId = accepted.id
              AND accepted_item.demandItemId = i.id
            WHERE accepted.enterpriseId = i.enterpriseId AND accepted.demandId = i.demandId
              AND accepted.demandRevision = d.revision), 0) AS acceptedQty,
           COALESCE((SELECT SUM(soi.orderedQty) FROM crm_sales_order_items soi
             INNER JOIN crm_sales_orders o ON o.enterpriseId = soi.enterpriseId AND o.id = soi.orderId
             WHERE soi.enterpriseId = i.enterpriseId AND soi.sourceDemandItemId = i.id AND o.status = 'confirmed'), 0) AS orderedQty
      FROM crm_customer_demand_items i
      INNER JOIN crm_customer_demands d ON d.enterpriseId = i.enterpriseId AND d.id = i.demandId
     WHERE i.enterpriseId = ${scope.enterpriseId} AND i.demandId IN (${sql.join(demandIds.map(id => sql`${id}`), sql`, `)})
     ORDER BY i.demandId ASC, i.sortOrder ASC, i.id ASC
  `));
  const byDemand = new Map<number, CandidateItemRow[]>();
  for (const item of itemRows) {
    const list = byDemand.get(Number(item.demandId)) ?? [];
    list.push(item);
    byDemand.set(Number(item.demandId), list);
  }
  return {
    items: rows.map(row => ({
      id: Number(row.id), demandRevision: Number(row.revision ?? 1), demandNo: row.demandNo, customerId: Number(row.customerId), customerName: row.customerName ?? "",
      projectName: row.projectName ?? "", status: row.status as "submitted" | "processing",
      items: (byDemand.get(Number(row.id)) ?? []).flatMap(item => {
        const demandQty = item.qty == null ? 0 : Number(item.qty);
        const acceptedQty = Math.min(demandQty, Number(item.acceptedQty ?? 0));
        const remainingQty = Math.max(0, acceptedQty - Number(item.orderedQty ?? 0));
        return demandQty > 0 && acceptedQty > 0 ? [{
          id: Number(item.id), partNumber: item.partNumber ?? "", brand: item.brand ?? "", pkg: item.pkg ?? "", qtyUnit: item.qtyUnit,
          demandQty, remainingQty, deliveryRequirement: item.deliveryRequirement ?? "", note: item.note ?? "",
        }] : [];
      }),
    })),
    total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize,
  };
}

export async function createSalesOrder(scope: CrmSalesOrderScope, rawInput: SalesOrderCreateInput) {
  const input = checkedCreate(rawInput);
  const canonical = canonicalSalesOrderCreatePayload(input);
  const payloadHash = hashPayload(canonical);
  const amounts = calculateSalesOrderAmounts(input.items);
  const db = await requireDb();
  return db.transaction(async tx => {
    // Lock order is invariant: enterprise/members/permissions -> customer -> demand -> order/items.
    // Authorization intentionally precedes replay, so a departed or revoked user cannot replay an old request.
    const access = await requireSalesOrderAccess(tx, scope, true);
    const identity = resultRows<{ customerId: number }>(await tx.execute(sql`
      SELECT customerId FROM crm_customer_demands WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.demandId} LIMIT 1
    `))[0];
    if (!identity) throw new TRPCError({ code: "NOT_FOUND", message: "客户需求不存在" });
    const customer = await accessibleCustomer(tx, scope, access.canManageAll, Number(identity.customerId), true);
    const demand = await lockDemand(tx, scope, Number(customer.id), input.demandId);
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, payloadHash, action: "create",
    });
    if (reservation.replayed) {
      const replay = resultRows<{ orderNumber: string }>(await tx.execute(sql`
        SELECT orderNumber FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND id = ${reservation.orderId} LIMIT 1 FOR UPDATE
      `))[0];
      if (!replay) throw new TRPCError({ code: "CONFLICT", message: "请求记录不完整，请联系管理员" });
      return { id: reservation.orderId, orderNumber: replay.orderNumber, replayed: true as const };
    }
    if (Number(input.demandRevision ?? 1) !== Number(demand.revision ?? 1)) {
      throw new TRPCError({ code: "CONFLICT", message: "需求已更新，请刷新后重新确认订单物料和数量" });
    }
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可录入销售订单" });
    const sourceItems = await lockedDemandItems(tx, scope, Number(demand.id));
    const byId = new Map(sourceItems.map(item => [Number(item.id), item]));
    for (const item of input.items) {
      const source = byId.get(item.demandItemId);
      if (!source || source.qty == null || Number(source.qty) <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "订单物料必须来自该需求且有有效需求数量" });
      }
    }
    const requestedIds = input.items.map(item => item.demandItemId);
    const acceptedRows = resultRows<{ demandItemId: number; qty: number | string }>(await tx.execute(sql`
      SELECT accepted_item.demandItemId, accepted_item.qty
        FROM crm_customer_demand_quote_acceptances accepted
        INNER JOIN crm_customer_demand_quotes source_quote
          ON source_quote.enterpriseId = accepted.enterpriseId AND source_quote.id = accepted.quoteId
         AND source_quote.demandId = accepted.demandId AND source_quote.version = accepted.quoteVersion
         AND source_quote.demandRevision = accepted.demandRevision AND source_quote.status = 'active'
        INNER JOIN crm_customer_demand_quote_acceptance_items accepted_item
          ON accepted_item.enterpriseId = accepted.enterpriseId AND accepted_item.acceptanceId = accepted.id
       WHERE accepted.enterpriseId = ${scope.enterpriseId} AND accepted.demandId = ${input.demandId}
         AND accepted.demandRevision = ${Number(demand.revision ?? 1)}
         AND accepted_item.demandItemId IN (${sql.join(requestedIds.map(id => sql`${id}`), sql`, `)})
       ORDER BY accepted.quoteId ASC, accepted_item.id ASC
       FOR UPDATE
    `));
    const acceptedById = new Map<number, number>();
    for (const row of acceptedRows) {
      const itemId = Number(row.demandItemId);
      acceptedById.set(itemId, (acceptedById.get(itemId) ?? 0) + Number(row.qty ?? 0));
    }
    const usageRows = resultRows<{ sourceDemandItemId: number; orderedQty: number | string }>(await tx.execute(sql`
      SELECT soi.sourceDemandItemId, COALESCE(SUM(soi.orderedQty), 0) AS orderedQty
        FROM crm_sales_order_items soi
        INNER JOIN crm_sales_orders o ON o.enterpriseId = soi.enterpriseId AND o.id = soi.orderId
       WHERE soi.enterpriseId = ${scope.enterpriseId} AND soi.sourceDemandItemId IN (${sql.join(requestedIds.map(id => sql`${id}`), sql`, `)})
         AND o.status = 'confirmed'
       GROUP BY soi.sourceDemandItemId
    `));
    const usedById = new Map(usageRows.map(row => [Number(row.sourceDemandItemId), Number(row.orderedQty)]));
    for (const item of input.items) {
      const source = byId.get(item.demandItemId)!;
      const acceptedQty = Math.min(Number(source.qty), acceptedById.get(item.demandItemId) ?? 0);
      if (acceptedQty <= 0) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${source.partNumber || "未命名物料"} 尚未采用采购报价` });
      }
      if (Number(item.qty) + (usedById.get(item.demandItemId) ?? 0) > acceptedQty) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${source.partNumber || "未命名物料"} 的可确认数量不足，请刷新需求后重试` });
      }
    }
    const provisional = `P-${randomUUID()}`;
    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO crm_sales_orders
        (enterpriseId, customerId, customerName, demandId, demandNo, projectName, orderNumber, status, currency, totalAmount,
         dueDate, confirmationNote, createdByUserId, cancelledByUserId, cancelledAt, cancelledReason, version, createdAt, updatedAt)
      VALUES (${scope.enterpriseId}, ${customer.id}, ${customer.name}, ${demand.id}, ${demand.demandNo}, ${demand.projectName ?? ""},
        ${provisional}, 'confirmed', 'CNY', ${amounts.totalAmount}, ${input.dueDate}, ${input.confirmationNote.trim()}, ${scope.actorUserId},
        NULL, NULL, NULL, 1, ${CRM_NOW}, ${CRM_NOW})
    `));
    const orderId = Number(inserted.insertId ?? 0);
    if (!orderId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "销售订单创建失败" });
    const day = resultRows<{ day: string }>(await tx.execute(sql`SELECT DATE_FORMAT(${CRM_NOW}, '%Y%m%d') AS day`))[0]?.day;
    if (!/^\d{8}$/.test(String(day))) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "订单编号日期生成失败" });
    // AUTO_INCREMENT id is the server-assigned global sequence; no MAX scan or client number is used.
    const orderNumber = `XS${day}-${orderId}`;
    await tx.execute(sql`UPDATE crm_sales_orders SET orderNumber = ${orderNumber} WHERE enterpriseId = ${scope.enterpriseId} AND id = ${orderId}`);
    for (let index = 0; index < input.items.length; index += 1) {
      const selected = input.items[index]!;
      const source = byId.get(selected.demandItemId)!;
      const amount = amounts.lines[index]!;
      await tx.execute(sql`
        INSERT INTO crm_sales_order_items
          (enterpriseId, orderId, sourceDemandItemId, sortOrder, partNumber, brand, pkg, qtyUnit, demandQty, orderedQty,
           unitPrice, lineAmount, deliveryRequirement, note, createdAt)
        VALUES (${scope.enterpriseId}, ${orderId}, ${source.id}, ${index + 1}, ${source.partNumber}, ${source.brand ?? ""}, ${source.pkg ?? ""},
          ${source.qtyUnit}, ${source.qty}, ${selected.qty}, ${amount.unitPrice}, ${amount.lineAmount},
          ${source.deliveryRequirement ?? ""}, ${source.note ?? ""}, ${CRM_NOW})
      `);
    }
    await tx.execute(sql`
      UPDATE crm_sales_order_requests SET orderId = ${orderId}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: Number(customer.id), orderId, actorUserId: scope.actorUserId,
      action: "created", note: `已与客户确认后录入；确认说明：${input.confirmationNote.trim()}`, requestId: input.requestId,
    });
    return { id: orderId, orderNumber, replayed: false as const };
  });
}

export async function listSalesOrders(scope: CrmSalesOrderScope, rawInput: SalesOrderListInput): Promise<SalesOrderPage<SalesOrderSummary>> {
  const parsed = salesOrderListSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "订单查询参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  const access = await requireSalesOrderAccess(db, scope);
  if (input.customerId !== undefined) {
    await assertCrmDemandCustomer(db, scope, access.policy, input.customerId);
  }
  const conditions = [orderScopeWhere(scope, access.policy)];
  if (input.customerId !== undefined) conditions.push(sql`o.customerId = ${input.customerId}`);
  if (input.status) conditions.push(sql`o.status = ${input.status}`);
  if (input.keyword) {
    const keyword = `%${input.keyword}%`;
    conditions.push(sql`(o.orderNumber LIKE ${keyword} OR o.demandNo LIKE ${keyword} OR o.customerName LIKE ${keyword}
      OR o.projectName LIKE ${keyword} OR EXISTS (
        SELECT 1 FROM crm_sales_order_items keyword_item
         WHERE keyword_item.enterpriseId = o.enterpriseId AND keyword_item.orderId = o.id AND keyword_item.partNumber LIKE ${keyword}
      ))`);
  }
  const where = sql.join(conditions, sql` AND `);
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_sales_orders o
      INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
     WHERE ${where}
  `))[0];
  const rows = resultRows<OrderRow & { itemCount: number | string }>(await db.execute(sql`
    SELECT o.id, o.enterpriseId, o.customerId, o.customerName, o.demandId, o.demandNo, o.projectName, o.orderNumber,
           o.status, o.totalAmount, DATE_FORMAT(o.dueDate, '%Y-%m-%d') AS dueDate, o.confirmationNote, o.createdByUserId, o.cancelledReason, o.cancelledAt,
           o.createdAt, o.updatedAt, o.version,
           COALESCE(creator.name, creator.username, CONCAT('用户', creator.id)) AS createdByName,
           (SELECT COUNT(*) FROM crm_sales_order_items soi WHERE soi.enterpriseId = o.enterpriseId AND soi.orderId = o.id) AS itemCount,
           ${FULFILLMENT_SELECT}
      FROM crm_sales_orders o LEFT JOIN users creator ON creator.id = o.createdByUserId
      INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
     WHERE ${where}
     ORDER BY o.updatedAt DESC, o.id DESC
     LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  `));
  return {
    items: rows.map(row => ({ ...mapSummary(row), itemCount: Number(row.itemCount ?? 0) })),
    total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize,
  };
}

/** Full customer totals are computed in SQL, never from a list page or a keyword match. */
export async function getSalesOrderCustomerSummary(scope: CrmSalesOrderScope, rawInput: SalesOrderCustomerSummaryInput): Promise<SalesOrderCustomerSummary> {
  const parsed = salesOrderCustomerSummarySchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "客户订单汇总参数无效" });
  const { customerId } = parsed.data;
  const db = await requireDb();
  const access = await requireSalesOrderAccess(db, scope);
  await assertCrmDemandCustomer(db, scope, access.policy, customerId);
  const row = resultRows<Omit<SalesOrderCustomerSummary, "customerId">>(await db.execute(sql`
    SELECT COUNT(*) AS totalOrders,
           COALESCE(SUM(CASE WHEN scoped.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmedOrders,
           COALESCE(SUM(CASE WHEN scoped.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelledOrders,
           COALESCE(SUM(CASE WHEN scoped.status = 'confirmed'
             AND (scoped.paidAmount + scoped.monthlyAmount <= 0
               OR scoped.paidAmount + scoped.monthlyAmount < scoped.totalAmount) THEN 1 ELSE 0 END), 0) AS awaitingPaymentOrders,
           COALESCE(SUM(CASE WHEN scoped.status = 'confirmed'
             AND scoped.shippedQty < scoped.orderedQty THEN 1 ELSE 0 END), 0) AS awaitingShipmentOrders,
           COALESCE(SUM(CASE WHEN scoped.status = 'confirmed' AND scoped.monthlyAmount > 0 AND scoped.paidAmount <= 0
             AND scoped.paidAmount + scoped.monthlyAmount >= scoped.totalAmount THEN 1 ELSE 0 END), 0) AS monthlyOrders
      FROM (
        SELECT o.id, o.status, o.totalAmount, ${FULFILLMENT_SELECT}
          FROM crm_sales_orders o
          INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
         WHERE ${orderScopeWhere(scope, access.policy)} AND o.customerId = ${customerId}
      ) scoped
  `))[0];
  return {
    customerId, totalOrders: Number(row?.totalOrders ?? 0), confirmedOrders: Number(row?.confirmedOrders ?? 0),
    cancelledOrders: Number(row?.cancelledOrders ?? 0), awaitingPaymentOrders: Number(row?.awaitingPaymentOrders ?? 0),
    awaitingShipmentOrders: Number(row?.awaitingShipmentOrders ?? 0), monthlyOrders: Number(row?.monthlyOrders ?? 0),
  };
}

/** Paginated order snapshots do not read or grant access to quote or channel inventory modules. */
export async function listSalesOrderCustomerMaterials(scope: CrmSalesOrderScope, rawInput: SalesOrderCustomerMaterialsInput): Promise<SalesOrderPage<SalesOrderCustomerMaterial>> {
  const parsed = salesOrderCustomerMaterialsSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "客户订单物料参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  const access = await requireSalesOrderAccess(db, scope);
  await assertCrmDemandCustomer(db, scope, access.policy, input.customerId);
  const where = sql`${orderScopeWhere(scope, access.policy)} AND o.customerId = ${input.customerId}`;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_sales_order_items i
      INNER JOIN crm_sales_orders o ON o.enterpriseId = i.enterpriseId AND o.id = i.orderId
      INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
     WHERE ${where}
  `))[0];
  const rows = resultRows<Omit<SalesOrderCustomerMaterial, "remainingQty">>(await db.execute(sql`
    SELECT i.id, i.sourceDemandItemId, i.partNumber, i.brand, i.pkg, i.qtyUnit, i.demandQty, i.orderedQty,
           i.unitPrice, i.lineAmount, i.deliveryRequirement, i.note,
           o.id AS orderId, o.orderNumber, o.customerId, o.demandId, o.demandNo, o.projectName, o.status,
           DATE_FORMAT(o.dueDate, '%Y-%m-%d') AS dueDate,
           COALESCE((SELECT SUM(si.qty) FROM crm_sales_order_shipment_items si
             WHERE si.enterpriseId = i.enterpriseId AND si.orderId = i.orderId AND si.orderItemId = i.id), 0) AS shippedQty
      FROM crm_sales_order_items i
      INNER JOIN crm_sales_orders o ON o.enterpriseId = i.enterpriseId AND o.id = i.orderId
      INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
     WHERE ${where}
     ORDER BY o.updatedAt DESC, o.id DESC, i.sortOrder ASC, i.id ASC
     LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  `));
  return {
    items: rows.map(row => ({
      ...row, id: Number(row.id), sourceDemandItemId: Number(row.sourceDemandItemId), orderId: Number(row.orderId),
      customerId: Number(row.customerId), demandId: Number(row.demandId), demandQty: Number(row.demandQty),
      orderedQty: Number(row.orderedQty), shippedQty: Number(row.shippedQty),
      remainingQty: row.status === "confirmed" ? Math.max(0, Number(row.orderedQty) - Number(row.shippedQty)) : 0,
      unitPrice: money(row.unitPrice), lineAmount: money(row.lineAmount), dueDate: row.dueDate ?? null,
    })),
    total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize,
  };
}

export async function getSalesOrder(scope: CrmSalesOrderScope, rawInput: SalesOrderIdInput): Promise<SalesOrderDetail> {
  const parsed = salesOrderIdSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "订单编号无效" });
  const db = await requireDb();
  const access = await requireSalesOrderAccess(db, scope);
  const conditions = [orderScopeWhere(scope, access.policy), sql`o.id = ${parsed.data.id}`];
  if (parsed.data.customerId !== undefined) {
    await assertCrmDemandCustomer(db, scope, access.policy, parsed.data.customerId);
    conditions.push(sql`o.customerId = ${parsed.data.customerId}`);
  }
  const row = resultRows<OrderRow>(await db.execute(sql`
    ${orderSelect()}
      INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
     WHERE ${sql.join(conditions, sql` AND `)}
     LIMIT 1
  `))[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
  if (parsed.data.customerId !== undefined && Number(row.customerId) !== parsed.data.customerId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
  }
  const items = resultRows<SalesOrderItem>(await db.execute(sql`
    SELECT id, sourceDemandItemId, partNumber, brand, pkg, qtyUnit, demandQty, orderedQty, unitPrice, lineAmount, deliveryRequirement, note,
           COALESCE((SELECT SUM(si.qty) FROM crm_sales_order_shipment_items si WHERE si.enterpriseId = ${scope.enterpriseId} AND si.orderItemId = crm_sales_order_items.id), 0) AS shippedQty
      FROM crm_sales_order_items WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${row.id}
     ORDER BY sortOrder ASC, id ASC
  `));
  const audits = resultRows<{ id: number; action: "created" | "cancelled" | "payment" | "shipment"; actorUserId: number; actorName: string | null; note: string; createdAt: Date | string }>(await db.execute(sql`
    SELECT a.id, a.action, a.actorUserId, COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS actorName, a.note, a.createdAt
      FROM crm_sales_order_audits a LEFT JOIN users u ON u.id = a.actorUserId
     WHERE a.enterpriseId = ${scope.enterpriseId} AND a.orderId = ${row.id}
     ORDER BY a.createdAt ASC, a.id ASC
  `));
  const payments = resultRows<{ id: number; method: "bank" | "cash" | "monthly"; amount: string | number; paymentDate: string; note: string; actorName: string | null; actorUserId: number; createdAt: Date | string }>(await db.execute(sql`
    SELECT p.id, p.method, p.amount, DATE_FORMAT(p.paymentDate, '%Y-%m-%d') AS paymentDate, p.note, p.actorUserId, p.createdAt,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS actorName
      FROM crm_sales_order_payments p LEFT JOIN users u ON u.id = p.actorUserId
     WHERE p.enterpriseId = ${scope.enterpriseId} AND p.orderId = ${row.id}
     ORDER BY p.id ASC
  `));
  const shipments = resultRows<{ id: number; deliveryMethod: "express" | "pickup"; expressCo: string; expressNo: string; note: string; actorUserId: number; actorName: string | null; createdAt: Date | string }>(await db.execute(sql`
    SELECT s.id, s.deliveryMethod, s.expressCo, s.expressNo, s.note, s.actorUserId, s.createdAt,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS actorName
      FROM crm_sales_order_shipments s LEFT JOIN users u ON u.id = s.actorUserId
     WHERE s.enterpriseId = ${scope.enterpriseId} AND s.orderId = ${row.id}
     ORDER BY s.id ASC
  `));
  const shipmentItems = resultRows<{ shipmentId: number; orderItemId: number; inventoryId: number; partNumber: string; qty: number }>(await db.execute(sql`
    SELECT shipmentId, orderItemId, inventoryId, partNumber, qty
      FROM crm_sales_order_shipment_items WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${row.id}
     ORDER BY id ASC
  `));
  const stockCandidates = await listStockCandidates(db, scope, items.map(item => ({ id: Number(item.id), partNumber: String(item.partNumber) })));
  return {
    ...mapSummary(row), itemCount: items.length, confirmationNote: row.confirmationNote, cancelledReason: row.cancelledReason ?? null,
    cancelledAt: iso(row.cancelledAt),
    items: items.map(item => ({ ...item, id: Number(item.id), sourceDemandItemId: Number(item.sourceDemandItemId), demandQty: Number(item.demandQty), orderedQty: Number(item.orderedQty), shippedQty: Number((item as SalesOrderItem).shippedQty ?? 0), unitPrice: money(item.unitPrice), lineAmount: money(item.lineAmount) })),
    audits: audits.map(audit => ({ id: Number(audit.id), action: audit.action, actorUserId: Number(audit.actorUserId), actorName: displayName(audit.actorName, Number(audit.actorUserId)), note: audit.note, createdAt: iso(audit.createdAt) ?? new Date(0).toISOString() })),
    payments: payments.map(payment => ({ id: Number(payment.id), method: payment.method, amount: money(payment.amount), paymentDate: payment.paymentDate, note: payment.note, actorName: displayName(payment.actorName, Number(payment.actorUserId)), createdAt: iso(payment.createdAt) ?? new Date(0).toISOString() })),
    shipments: shipments.map(shipment => ({
      id: Number(shipment.id), deliveryMethod: shipment.deliveryMethod, expressCo: shipment.expressCo, expressNo: shipment.expressNo, note: shipment.note,
      actorName: displayName(shipment.actorName, Number(shipment.actorUserId)), createdAt: iso(shipment.createdAt) ?? new Date(0).toISOString(),
      items: shipmentItems.filter(item => Number(item.shipmentId) === Number(shipment.id)).map(item => ({ orderItemId: Number(item.orderItemId), inventoryId: Number(item.inventoryId), partNumber: item.partNumber, qty: Number(item.qty) })),
    })),
    stockCandidates,
  };
}

export async function cancelSalesOrder(scope: CrmSalesOrderScope, rawInput: { id: number; version: number; reason: string }) {
  const parsed = (await import("../../../shared/crmSalesOrders")).salesOrderCancelSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "取消参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await requireSalesOrderAccess(tx, scope, true);
    // Non-locking identity lookup only establishes the parent row for the mandated lock order.
    const identity = resultRows<{ customerId: number; demandId: number }>(await tx.execute(sql`
      SELECT customerId, demandId FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id} LIMIT 1
    `))[0];
    if (!identity) throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
    const customer = await accessibleCustomer(tx, scope, access.canManageAll, Number(identity.customerId), true);
    await lockDemand(tx, scope, Number(customer.id), Number(identity.demandId));
    const order = resultRows<OrderRow>(await tx.execute(sql`
      SELECT * FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customer.id} AND id = ${input.id} LIMIT 1 FOR UPDATE
    `))[0];
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
    if (order.status === "cancelled") throw new TRPCError({ code: "CONFLICT", message: "订单已取消，请刷新页面" });
    if (Number(order.version) !== input.version) throw new TRPCError({ code: "CONFLICT", message: "订单已被其他人更新，请刷新后重试" });
    const paid = resultRows<{ paid: string | number; shipped: number | string }>(await tx.execute(sql`
      SELECT
        COALESCE((SELECT SUM(amount) FROM crm_sales_order_payments WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.id}), 0) AS paid,
        COALESCE((SELECT SUM(qty) FROM crm_sales_order_shipment_items WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.id}), 0) AS shipped
    `))[0];
    if (decimalToScaled(money(paid?.paid)) > BigInt(0) || Number(paid?.shipped ?? 0) > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "已收款或已出货的订单不能直接取消" });
    }
    const updated = resultHeader(await tx.execute(sql`
      UPDATE crm_sales_orders
         SET status = 'cancelled', cancelledByUserId = ${scope.actorUserId}, cancelledAt = ${CRM_NOW}, cancelledReason = ${input.reason.trim()},
             version = version + 1, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id} AND status = 'confirmed' AND version = ${input.version}
    `));
    if (Number(updated.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "订单已被其他人更新，请刷新后重试" });
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: Number(customer.id), orderId: input.id, actorUserId: scope.actorUserId,
      action: "cancelled", note: input.reason.trim(),
    });
    // Cancellation is blocked after payment or shipment, so it never rolls back stock or marketplace orders.
    return { id: input.id, version: input.version + 1, status: "cancelled" as const };
  });
}

async function lockConfirmedOrder(tx: SqlExecutor, scope: CrmSalesOrderScope, orderId: number, version: number) {
  const access = await requireSalesOrderAccess(tx, scope, true);
  const identity = resultRows<{ customerId: number; demandId: number }>(await tx.execute(sql`
    SELECT customerId, demandId FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND id = ${orderId} LIMIT 1
  `))[0];
  if (!identity) throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
  const customer = await accessibleCustomer(tx, scope, access.canManageAll, Number(identity.customerId), true);
  await lockDemand(tx, scope, Number(customer.id), Number(identity.demandId));
  const order = resultRows<OrderRow>(await tx.execute(sql`
    SELECT * FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${customer.id} AND id = ${orderId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "销售订单不存在" });
  if (order.status !== "confirmed") throw new TRPCError({ code: "CONFLICT", message: "仅待交付订单可登记收款或出货" });
  if (Number(order.version) !== version) throw new TRPCError({ code: "CONFLICT", message: "订单已被其他人更新，请刷新后重试" });
  return { access, customer, order };
}

async function listStockCandidates(executor: SqlExecutor, scope: CrmSalesOrderScope, items: Array<{ id: number; partNumber: string }>) {
  if (items.length === 0) return [];
  const partNumbers = Array.from(new Set(items.map(item => item.partNumber.trim()).filter(Boolean)));
  if (partNumbers.length === 0) return [];
  const rows = resultRows<{ id: number; partNumber: string; brand: string | null; pkg: string | null; qtyStock: number | string; qtyOnSale: number | string; ownerName: string | null; ownerUserId: number | null }>(await executor.execute(sql`
    SELECT i.id, i.partNumber, i.brand, i.pkg, i.qtyStock, i.qtyOnSale, i.ownerUserId,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS ownerName
      FROM inventories i LEFT JOIN users u ON u.id = i.ownerUserId
     WHERE i.enterpriseId = ${scope.enterpriseId} AND i.ownerUserId = ${scope.actorUserId}
       AND UPPER(TRIM(i.partNumber)) IN (${sql.join(partNumbers.map(partNumber => sql`${partNumber.toUpperCase()}`), sql`, `)})
       AND i.qtyStock > 0
     ORDER BY i.partNumber ASC, i.id ASC
  `));
  const result: SalesOrderDetail["stockCandidates"] = [];
  for (const item of items) {
    const needle = item.partNumber.trim().toUpperCase();
    for (const row of rows) {
      if (String(row.partNumber).trim().toUpperCase() !== needle) continue;
      result.push({
        inventoryId: Number(row.id), orderItemId: item.id, partNumber: row.partNumber, brand: row.brand ?? "", pkg: row.pkg ?? "",
        qtyStock: Number(row.qtyStock), qtyOnSale: Number(row.qtyOnSale), availableQty: Number(row.qtyStock),
        ownerName: displayName(row.ownerName, Number(row.ownerUserId ?? 0)),
      });
    }
  }
  return result;
}

function payloadHashFor(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function recordSalesOrderPayment(scope: CrmSalesOrderScope, rawInput: SalesOrderPaymentInput) {
  const parsed = salesOrderPaymentSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "收款参数无效" });
  const input = parsed.data;
  if (decimalToScaled(input.amount) <= BigInt(0)) throw new TRPCError({ code: "BAD_REQUEST", message: "收款金额须大于 0" });
  const db = await requireDb();
  const hash = payloadHashFor({ id: input.id, method: input.method, amount: scaledToDecimal(decimalToScaled(input.amount)), paymentDate: input.paymentDate, note: input.note.trim() });
  return db.transaction(async tx => {
    await requireSalesOrderAccess(tx, scope, true);
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, payloadHash: hash, action: "payment",
    });
    if (reservation.replayed) return { id: reservation.orderId, replayed: true as const, version: Number((await getSalesOrder(scope, { id: reservation.orderId })).version) };
    const { customer, order } = await lockConfirmedOrder(tx, scope, input.id, input.version);
    const totals = resultRows<{ paid: string | number }>(await tx.execute(sql`
      SELECT COALESCE(SUM(amount), 0) AS paid FROM crm_sales_order_payments
       WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.id}
    `))[0];
    const nextPaid = decimalToScaled(money(totals?.paid)) + decimalToScaled(input.amount);
    if (nextPaid > decimalToScaled(money(order.totalAmount))) {
      throw new TRPCError({ code: "CONFLICT", message: "累计收款不能超过订单含税金额" });
    }
    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO crm_sales_order_payments
        (enterpriseId, orderId, actorUserId, requestId, payloadHash, method, amount, paymentDate, note, createdAt)
      VALUES (${scope.enterpriseId}, ${input.id}, ${scope.actorUserId}, ${input.requestId}, ${hash}, ${input.method},
        ${scaledToDecimal(decimalToScaled(input.amount))}, ${input.paymentDate}, ${input.note.trim()}, ${CRM_NOW})
    `));
    if (!Number(inserted.insertId ?? 0)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "收款登记失败" });
    const bumped = resultHeader(await tx.execute(sql`
      UPDATE crm_sales_orders SET version = version + 1, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id} AND status = 'confirmed' AND version = ${input.version}
    `));
    if (Number(bumped.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "订单已被其他人更新，请刷新后重试" });
    await tx.execute(sql`
      UPDATE crm_sales_order_requests SET orderId = ${input.id}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: Number(customer.id), orderId: input.id, actorUserId: scope.actorUserId,
      action: "payment", note: `${input.method}:${scaledToDecimal(decimalToScaled(input.amount))}`, requestId: input.requestId,
    });
    return { id: input.id, replayed: false as const, version: input.version + 1 };
  });
}

export async function shipSalesOrder(scope: CrmSalesOrderScope, rawInput: SalesOrderShipInput) {
  const parsed = salesOrderShipSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "出货参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  const hash = payloadHashFor({
    id: input.id, deliveryMethod: input.deliveryMethod, expressCo: input.expressCo.trim(), expressNo: input.expressNo.trim(),
    note: input.note.trim(), items: [...input.items].sort((a, b) => a.orderItemId - b.orderItemId || a.inventoryId - b.inventoryId),
  });
  return db.transaction(async tx => {
    await requireSalesOrderAccess(tx, scope, true);
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, payloadHash: hash, action: "shipment",
    });
    if (reservation.replayed) return { id: reservation.orderId, replayed: true as const, version: Number((await getSalesOrder(scope, { id: reservation.orderId })).version) };
    const { customer } = await lockConfirmedOrder(tx, scope, input.id, input.version);
    const orderItems = resultRows<SalesOrderItem & { shippedQty?: number | string }>(await tx.execute(sql`
      SELECT id, sourceDemandItemId, partNumber, brand, pkg, qtyUnit, demandQty, orderedQty, unitPrice, lineAmount, deliveryRequirement, note,
             COALESCE((SELECT SUM(si.qty) FROM crm_sales_order_shipment_items si WHERE si.enterpriseId = ${scope.enterpriseId} AND si.orderItemId = crm_sales_order_items.id), 0) AS shippedQty
        FROM crm_sales_order_items WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.id}
       ORDER BY id ASC FOR UPDATE
    `));
    const byId = new Map(orderItems.map(item => [Number(item.id), item]));
    const requestedByItem = new Map<number, number>();
    for (const line of input.items) {
      const item = byId.get(line.orderItemId);
      if (!item) throw new TRPCError({ code: "BAD_REQUEST", message: "出货物料不属于本订单" });
      requestedByItem.set(line.orderItemId, (requestedByItem.get(line.orderItemId) ?? 0) + line.qty);
    }
    for (const [orderItemId, qty] of Array.from(requestedByItem.entries())) {
      const item = byId.get(orderItemId)!;
      if (Number(item.shippedQty ?? 0) + qty > Number(item.orderedQty)) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${item.partNumber} 累计出货不能超过销售数量` });
      }
    }
    const inventoryIds = Array.from(new Set(input.items.map(item => item.inventoryId))).sort((a, b) => a - b);
    const inventories = resultRows<{ id: number; partNumber: string; qtyStock: number | string; qtyOnSale: number | string; status: string }>(await tx.execute(sql`
      SELECT id, partNumber, qtyStock, qtyOnSale, status FROM inventories
       WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.actorUserId} AND id IN (${sql.join(inventoryIds.map(id => sql`${id}`), sql`, `)})
       ORDER BY id ASC FOR UPDATE
    `));
    if (inventories.length !== inventoryIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "所选库存不存在或不属于当前企业" });
    const inventoryById = new Map(inventories.map(row => [Number(row.id), row]));
    const deductByInventory = new Map<number, number>();
    for (const line of input.items) {
      const item = byId.get(line.orderItemId)!;
      const inventory = inventoryById.get(line.inventoryId)!;
      if (String(inventory.partNumber).trim().toUpperCase() !== String(item.partNumber).trim().toUpperCase()) {
        throw new TRPCError({ code: "CONFLICT", message: `库存 ${inventory.partNumber} 与订单型号 ${item.partNumber} 不一致` });
      }
      deductByInventory.set(line.inventoryId, (deductByInventory.get(line.inventoryId) ?? 0) + line.qty);
    }
    for (const [inventoryId, qty] of Array.from(deductByInventory.entries())) {
      const inventory = inventoryById.get(inventoryId)!;
      if (Number(inventory.qtyStock) < qty) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${inventory.partNumber} 当前可出 ${inventory.qtyStock}，请先入库` });
      }
      const result = await tx.execute(sql`
        UPDATE inventories
           SET qtyStock = qtyStock - ${qty},
               qtyOnSale = IF(qtyOnSale > ${qty}, qtyOnSale - ${qty}, 0),
               status = IF(qtyOnSale <= ${qty} AND status = 'published', 'offshelf', status),
               publishedAt = IF(qtyOnSale <= ${qty} AND status = 'published', NULL, publishedAt),
               offshelfBy = IF(qtyOnSale <= ${qty} AND status = 'published', 'system', offshelfBy),
               offshelfReason = IF(qtyOnSale <= ${qty} AND status = 'published', 'sold_out', offshelfReason)
         WHERE id = ${inventoryId} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.actorUserId} AND qtyStock >= ${qty}
      `);
      if (Number(resultHeader(result).affectedRows ?? 0) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${inventory.partNumber} 当前可出不足，请刷新后重试` });
      }
    }
    const shipment = resultHeader(await tx.execute(sql`
      INSERT INTO crm_sales_order_shipments
        (enterpriseId, orderId, actorUserId, requestId, payloadHash, deliveryMethod, expressCo, expressNo, note, createdAt)
      VALUES (${scope.enterpriseId}, ${input.id}, ${scope.actorUserId}, ${input.requestId}, ${hash}, ${input.deliveryMethod},
        ${input.deliveryMethod === "express" ? input.expressCo.trim() : ""}, ${input.deliveryMethod === "express" ? input.expressNo.trim() : ""},
        ${input.note.trim()}, ${CRM_NOW})
    `));
    const shipmentId = Number(shipment.insertId ?? 0);
    if (!shipmentId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "出货记录创建失败" });
    for (const line of input.items) {
      const item = byId.get(line.orderItemId)!;
      await tx.execute(sql`
        INSERT INTO crm_sales_order_shipment_items
          (enterpriseId, shipmentId, orderId, orderItemId, inventoryId, partNumber, qty, createdAt)
        VALUES (${scope.enterpriseId}, ${shipmentId}, ${input.id}, ${line.orderItemId}, ${line.inventoryId}, ${item.partNumber}, ${line.qty}, ${CRM_NOW})
      `);
    }
    const bumped = resultHeader(await tx.execute(sql`
      UPDATE crm_sales_orders SET version = version + 1, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id} AND status = 'confirmed' AND version = ${input.version}
    `));
    if (Number(bumped.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "订单已被其他人更新，请刷新后重试" });
    await tx.execute(sql`
      UPDATE crm_sales_order_requests SET orderId = ${input.id}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: Number(customer.id), orderId: input.id, actorUserId: scope.actorUserId,
      action: "shipment", note: input.deliveryMethod === "pickup" ? "自提出货" : `${input.expressCo.trim()} ${input.expressNo.trim()}`.trim(),
      requestId: input.requestId,
    });
    return { id: input.id, replayed: false as const, version: input.version + 1 };
  });
}

export const CRM_SALES_ORDER_SERVICE_TABLES = ["crm_sales_orders", "crm_sales_order_items", "crm_sales_order_requests", "crm_sales_order_audits", "crm_sales_order_payments", "crm_sales_order_shipments", "crm_sales_order_shipment_items"] as const;
