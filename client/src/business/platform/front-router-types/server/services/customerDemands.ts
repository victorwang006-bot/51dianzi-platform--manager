import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  customerDemandIdSchema,
  customerDemandListSchema,
  customerDemandRevisionListSchema,
  customerDemandSaveSchema,
  deriveCustomerDemandWorkflow,
  procurementDemandListSchema,
  salesDemandListSchema,
  type CustomerDemandData,
  type CustomerDemandDetail,
  type CustomerDemandItem,
  type CustomerDemandRevision,
  type CustomerDemandSaveInput,
  type CustomerDemandSaveResult,
  type CustomerDemandStatus,
  type CustomerDemandSummary,
  type DemandPage,
  type ProcurementDemandDetail,
  type ProcurementDemandSummary,
  type SalesDemandPage,
  type SalesDemandSummary,
} from "../../../shared/customerDemands";
import type { z } from "zod";
import { getDb } from "../db";
import { resolveBusinessModuleAccess } from "./businessModuleAccess";
import { crmCustomerPolicyWhere, resolveCrmCustomerPolicy, type CrmModulePolicy } from "./crmCustomers";

export type CrmDemandPolicy = { customers: CrmModulePolicy; demands: CrmModulePolicy };
/** Demands always inherit the native parent customer boundary, intersected with the demands module. */
export async function resolveCrmDemandPolicy(executor: SqlExecutor, scope: CustomerDemandScope, write = false): Promise<CrmDemandPolicy> {
  const customers = await resolveCrmCustomerPolicy(executor, scope, write);
  const demands = await resolveBusinessModuleAccess(scope.actorUserId, scope.enterpriseId, "demands", executor);
  if (!demands.read || (write && !demands.write)) throw new TRPCError({ code: "FORBIDDEN", message: write ? "您没有需求写入权限" : "您没有需求读取权限" });
  return { customers, demands };
}
export function crmDemandCustomerWhere(scope: CustomerDemandScope, policy: CrmDemandPolicy, customerAlias = "c", write = false) {
  return sql`(${crmCustomerPolicyWhere(scope, policy.customers, customerAlias, write)})
    AND (${crmCustomerPolicyWhere(scope, policy.demands, customerAlias, write)})`;
}
export async function assertCrmDemandCustomer(executor: SqlExecutor, scope: CustomerDemandScope, policy: CrmDemandPolicy, customerId: number, write = false) {
  const row = resultRows<{ id: number }>(await executor.execute(sql`
    SELECT c.id FROM crm_customers c WHERE c.id = ${customerId} AND ${crmDemandCustomerWhere(scope, policy, "c", write)} LIMIT 1
  `))[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "客户需求不存在" });
}
/** Procurement cannot use its ERP permission as an enterprise-wide CRM bypass. */
export function crmProcurementDemandWhere(scope: CustomerDemandScope, policy: CrmDemandPolicy, demandAlias = "d", write = false) {
  const d = sql.raw(demandAlias);
  // An explicit enterprise policy (including the verified owner/legacy manage_all resolver path) is the only unassigned cross-team path.
  const enterprise = policy.customers.scope === "enterprise" && policy.demands.scope === "enterprise";
  const frozenTeam = enterprise ? sql`TRUE` : policy.demands.teamId ? sql`EXISTS (
    SELECT 1 FROM enterprise_team_record_assignments procurement_assignment
    INNER JOIN enterprise_team_members procurement_member
      ON procurement_member.enterpriseId = procurement_assignment.enterpriseId
      AND procurement_member.teamId = procurement_assignment.teamId AND procurement_member.userId = ${scope.actorUserId}
    INNER JOIN enterprise_teams procurement_team ON procurement_team.id = procurement_assignment.teamId
      AND procurement_team.enterpriseId = procurement_assignment.enterpriseId AND procurement_team.status = 'active'
    WHERE procurement_assignment.enterpriseId = ${d}.enterpriseId AND procurement_assignment.recordType = 'customer'
      AND procurement_assignment.recordId = ${d}.customerId AND procurement_assignment.teamId = ${policy.demands.teamId}
  )` : sql`FALSE`;
  return sql`EXISTS (SELECT 1 FROM crm_customers procurement_customer
    WHERE procurement_customer.enterpriseId = ${d}.enterpriseId AND procurement_customer.id = ${d}.customerId
      AND (${crmDemandCustomerWhere(scope, policy, "procurement_customer", write)}) AND (${frozenTeam}))`;
}
export async function assertCrmProcurementDemand(executor: SqlExecutor, scope: CustomerDemandScope, demandId: number, write = false) {
  const policy = await resolveCrmDemandPolicy(executor, scope, write);
  const found = resultRows<{ id: number }>(await executor.execute(sql`SELECT d.id FROM crm_customer_demands d
    WHERE d.enterpriseId = ${scope.enterpriseId} AND d.id = ${demandId} AND ${crmProcurementDemandWhere(scope, policy, "d", write)} LIMIT 1`))[0];
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
  return policy;
}

/** The router supplies identity only; all permissions are read again from MySQL. */
export type CustomerDemandScope = { enterpriseId: number; actorUserId: number };

type SqlExecutor = { execute: (query: SQLWrapper) => Promise<unknown> };
type MembershipRow = {
  id: number; userId: number; role: "super_admin" | "admin" | "member";
  status: "active" | "suspended"; loginDisabled: number | boolean;
};
type Access = { canManageAll: boolean; actor: MembershipRow; ownerUserId: number; policy: CrmDemandPolicy };
type CustomerRow = { id: number; assignedUserId: number; archivedAt: Date | string | null; name: string };
type DemandRow = {
  id: number; enterpriseId: number; customerId: number; demandNo: string; projectName: string;
  priority: "normal" | "urgent"; status: CustomerDemandStatus; note: string;
  replyDueAt: Date | string | null; submittedAt: Date | string | null;
  createdByUserId: number; updatedByUserId: number; procurementUserId: number | null;
  claimedAt: Date | string | null; version: number; createdAt: Date | string; updatedAt: Date | string;
  revision: number;
  customerName?: string | null; salesName?: string | null; procurementName?: string | null; itemCount?: number | string;
  firstPartNumber?: string | null; firstBrand?: string | null; firstQty?: number | string | null; firstQtyUnit?: string | null;
  firstDeliveryRequirement?: string | null; myActiveQuoteCount?: number | string; mySupplierCount?: number | string; myQuoteRoundCount?: number | string;
};
type SalesDemandRow = DemandRow & {
  assignedUserId: number;
  assignedName: string | null;
  currentQuoteCount: number | string;
  acceptedQuoteCount: number | string;
  activeOrderCount: number | string;
  firstPartNumber: string | null;
  totalQty: number | string;
  qtyUnit: string | null;
  qtyUnitCount: number | string;
  activityAt: Date | string;
  overdue: number | boolean;
};
type DemandItemRow = {
  id?: number; sortOrder: number; partNumber: string; brand: string; pkg: string; qty: number | null;
  qtyUnit: CustomerDemandItem["qtyUnit"]; deliveryRequirement: string; note: string;
};
type RequestRow = {
  payloadHash: string; demandId: number; resultStatus: CustomerDemandStatus | null; resultVersion: number | null;
  resultDemandRevision: number | null;
};

const CUSTOMER_PERMISSION = "customers.manage";
const CUSTOMER_ALL_PERMISSION = "customers.manage_all";
const PROCUREMENT_PERMISSION = "procurement.demands";
const BEIJING_TIME_ZONE = "Asia/Shanghai";
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

function displayName(value: string | null | undefined, userId: number | null) {
  return value?.trim() || (userId == null ? "" : `用户${userId}`);
}

/** CRM DATETIME is Beijing wall-clock text, so never rely on the host timezone to serialize it. */
function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? new Date(`${raw.replace(" ", "T")}+08:00`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toBeijingSqlDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "时间格式无效" });
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: BEIJING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date).replace("T", " ");
}

/** Beijing-date XQ series; sequence is tenant/day-local and allocated transactionally. */
export function formatCustomerDemandNo(beijingDay: string, sequence: number) {
  return `XQ${beijingDay}-${String(sequence).padStart(4, "0")}`;
}

function canonicalData(data: CustomerDemandData) {
  return {
    projectName: data.projectName.trim(), priority: data.priority, replyDueAt: data.replyDueAt,
    note: data.note.trim(),
    items: data.items.map(item => ({
      ...(item.id == null ? {} : { id: item.id }),
      partNumber: item.partNumber.trim(), brand: item.brand.trim(), pkg: item.pkg.trim(), qty: item.qty,
      qtyUnit: item.qtyUnit, deliveryRequirement: item.deliveryRequirement.trim(), note: item.note.trim(),
    })),
  };
}

/** Stable hash includes the original optimistic version so one request cannot mask a later intentional save. */
export function customerDemandSavePayloadHash(input: CustomerDemandSaveInput) {
  return createHash("sha256").update(JSON.stringify({
    customerId: input.customerId, id: input.id ?? null, version: input.version ?? null,
    intent: input.intent,
    ...(input.changeReason === undefined ? {} : { changeReason: input.changeReason.trim() }),
    data: canonicalData(input.data),
  })).digest("hex");
}

function checkedSave(input: CustomerDemandSaveInput): CustomerDemandSaveInput {
  const checked = customerDemandSaveSchema.safeParse(input);
  if (!checked.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "请检查需求内容", cause: checked.error });
  }
  return checked.data;
}

function checkedList(input: unknown) {
  const checked = customerDemandListSchema.safeParse(input);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "分页参数无效" });
  return checked.data;
}

function checkedProcurementList(input: unknown) {
  const checked = procurementDemandListSchema.safeParse(input);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "分页参数无效" });
  return checked.data;
}

function checkedSalesList(input: unknown) {
  const checked = salesDemandListSchema.safeParse(input);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "分页参数无效" });
  return checked.data;
}

async function actorMembership(executor: SqlExecutor, scope: CustomerDemandScope, lock: boolean) {
  const rows = resultRows<MembershipRow & { superAdminUserId: number }>(await executor.execute(sql`
    SELECT em.id, em.userId, em.role, em.status, u.loginDisabled, e.superAdminUserId
      FROM enterprises e
      INNER JOIN enterprise_members em ON em.enterpriseId = e.id
      INNER JOIN users u ON u.id = em.userId
     WHERE e.id = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId}
     LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `));
  const actor = rows[0];
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员不可用" });
  }
  return {
    actor,
    owner: actor.role === "super_admin" && Number(actor.superAdminUserId) === scope.actorUserId,
    ownerUserId: Number(actor.superAdminUserId),
  };
}

async function lockedEnterpriseMembers(tx: SqlExecutor, scope: CustomerDemandScope) {
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
  return { actor, owner: actor.role === "super_admin" && Number(enterprise.superAdminUserId) === scope.actorUserId, ownerUserId: Number(enterprise.superAdminUserId) };
}

async function permissionKeys(executor: SqlExecutor, memberId: number, lock: boolean) {
  return resultRows<{ permissionKey: string }>(await executor.execute(sql`
    SELECT permissionKey FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${memberId} ${lock ? sql`FOR UPDATE` : sql``}
  `)).map(row => row.permissionKey);
}

/** Fresh sales authorization for each operation; never trusts a UI/router capability snapshot. */
async function requireSalesAccess(executor: SqlExecutor, scope: CustomerDemandScope, lock = false): Promise<Access> {
  const state = lock ? await lockedEnterpriseMembers(executor, scope) : await actorMembership(executor, scope, false);
  const policy = await resolveCrmDemandPolicy(executor, scope, lock);
  const canManageAll = policy.customers.scope === "enterprise" && policy.demands.scope === "enterprise";
  return { canManageAll, actor: state.actor, ownerUserId: state.ownerUserId ?? scope.actorUserId, policy };
}

/** Procurement is deliberately independent of CRM/sales grants; enterprise owners retain inherited access only. */
async function requireProcurementAccess(executor: SqlExecutor, scope: CustomerDemandScope, lock = false) {
  const state = lock ? await lockedEnterpriseMembers(executor, scope) : await actorMembership(executor, scope, false);
  if (!state.owner) {
    const permissions = await permissionKeys(executor, state.actor.id, lock);
    if (!permissions.includes(PROCUREMENT_PERMISSION)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您没有采购需求权限" });
    }
  }
  const policy = await resolveCrmDemandPolicy(executor, scope, lock);
  return { actor: state.actor, ownerUserId: state.ownerUserId ?? scope.actorUserId, policy };
}

async function accessibleCustomer(executor: SqlExecutor, scope: CustomerDemandScope, canManageAll: boolean, customerId: number, lock = false) {
  const customer = resultRows<CustomerRow>(await executor.execute(sql`
    SELECT id, assignedUserId, archivedAt, name FROM crm_customers
     WHERE enterpriseId = ${scope.enterpriseId} AND id = ${customerId}
     LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  const policy = await resolveCrmDemandPolicy(executor, scope, lock);
  if (!customer) {
    throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
  }
  await assertCrmDemandCustomer(executor, scope, policy, customerId, lock);
  return customer;
}

async function lockDemandForCustomer(tx: SqlExecutor, scope: CustomerDemandScope, customerId: number, demandId: number) {
  const row = resultRows<DemandRow>(await tx.execute(sql`
    SELECT d.* FROM crm_customer_demands d
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.customerId = ${customerId} AND d.id = ${demandId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
  return row;
}

async function reserveRequest(tx: SqlExecutor, input: {
  enterpriseId: number; actorUserId: number; requestId: string; payloadHash: string;
}) {
  const existing = resultRows<RequestRow>(await tx.execute(sql`
    SELECT payloadHash, demandId, resultStatus, resultVersion
           , resultDemandRevision
      FROM crm_customer_demand_requests
     WHERE enterpriseId = ${input.enterpriseId} AND actorUserId = ${input.actorUserId} AND requestId = ${input.requestId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (existing) {
    if (existing.payloadHash !== input.payloadHash) {
      throw new TRPCError({ code: "CONFLICT", message: "请求号已用于不同内容" });
    }
    if (!Number(existing.demandId) || !existing.resultStatus || !existing.resultVersion) {
      throw new TRPCError({ code: "CONFLICT", message: "请求正在处理中，请稍后重试" });
    }
    return { replayed: true as const, existing };
  }
  await tx.execute(sql`
    INSERT INTO crm_customer_demand_requests
      (enterpriseId, actorUserId, requestId, payloadHash, demandId, resultStatus, resultVersion, resultDemandRevision, createdAt)
    VALUES (${input.enterpriseId}, ${input.actorUserId}, ${input.requestId}, ${input.payloadHash}, 0, NULL, NULL, NULL, ${CRM_NOW})
  `);
  return { replayed: false as const, existing: null };
}

async function insertAudit(tx: SqlExecutor, input: {
  enterpriseId: number; customerId: number; demandId: number; actorUserId: number;
  action: string; note: string; requestId?: string | null;
}) {
  await tx.execute(sql`
    INSERT INTO crm_customer_demand_audits
      (enterpriseId, customerId, demandId, actorUserId, action, note, requestId, createdAt)
    VALUES (${input.enterpriseId}, ${input.customerId}, ${input.demandId}, ${input.actorUserId},
      ${input.action}, ${input.note.slice(0, 500)}, ${input.requestId ?? null}, ${CRM_NOW})
  `);
}

async function allocateDemandNo(tx: SqlExecutor, enterpriseId: number) {
  const dateRow = resultRows<{ demandDay: string }>(await tx.execute(sql`
    SELECT DATE_FORMAT(${CRM_NOW}, '%Y%m%d') AS demandDay
  `))[0];
  const demandDay = String(dateRow?.demandDay ?? "");
  if (!/^\d{8}$/.test(demandDay)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求编号日期生成失败" });
  const mysqlDay = `${demandDay.slice(0, 4)}-${demandDay.slice(4, 6)}-${demandDay.slice(6, 8)}`;
  await tx.execute(sql`
    INSERT IGNORE INTO crm_customer_demand_sequences (enterpriseId, demandDay, nextSequence, updatedAt)
    VALUES (${enterpriseId}, ${mysqlDay}, 1, ${CRM_NOW})
  `);
  const sequenceRow = resultRows<{ nextSequence: number }>(await tx.execute(sql`
    SELECT nextSequence FROM crm_customer_demand_sequences
     WHERE enterpriseId = ${enterpriseId} AND demandDay = ${mysqlDay}
     LIMIT 1 FOR UPDATE
  `))[0];
  const sequence = Number(sequenceRow?.nextSequence ?? 0);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求编号序列异常" });
  }
  await tx.execute(sql`
    UPDATE crm_customer_demand_sequences SET nextSequence = ${sequence + 1}, updatedAt = ${CRM_NOW}
     WHERE enterpriseId = ${enterpriseId} AND demandDay = ${mysqlDay}
  `);
  return formatCustomerDemandNo(demandDay, sequence);
}

async function lockedDemandItems(tx: SqlExecutor, enterpriseId: number, demandId: number) {
  return resultRows<DemandItemRow>(await tx.execute(sql`
    SELECT id, sortOrder, partNumber, brand, pkg, qty, qtyUnit, deliveryRequirement, note
      FROM crm_customer_demand_items
     WHERE enterpriseId = ${enterpriseId} AND demandId = ${demandId}
     ORDER BY sortOrder ASC, id ASC FOR UPDATE
  `));
}

type ActiveOrderItem = {
  sourceDemandItemId: number; partNumber: string; brand: string; pkg: string; demandQty: number;
  qtyUnit: string; deliveryRequirement: string; note: string;
};

/** Locks confirmed order rows after demand items, preserving the global mutation lock order. */
async function lockedActiveOrderItems(tx: SqlExecutor, scope: CustomerDemandScope, customerId: number, demandId: number) {
  return resultRows<ActiveOrderItem>(await tx.execute(sql`
    SELECT soi.sourceDemandItemId, soi.partNumber, soi.brand, soi.pkg, soi.demandQty, soi.qtyUnit, soi.deliveryRequirement, soi.note
      FROM crm_sales_orders o
      INNER JOIN crm_sales_order_items soi ON soi.enterpriseId = o.enterpriseId AND soi.orderId = o.id
     WHERE o.enterpriseId = ${scope.enterpriseId} AND o.customerId = ${customerId} AND o.demandId = ${demandId}
       AND o.status = 'confirmed'
     ORDER BY o.id, soi.id FOR UPDATE
  `));
}

function itemPayloadEqual(left: CustomerDemandItem, right: CustomerDemandItem) {
  return left.partNumber === right.partNumber && left.brand === right.brand && left.pkg === right.pkg
    && left.qty === right.qty && left.qtyUnit === right.qtyUnit
    && left.deliveryRequirement === right.deliveryRequirement && left.note === right.note;
}

function sourceItem(row: DemandItemRow): CustomerDemandItem {
  return {
    id: Number(row.id), partNumber: row.partNumber ?? "", brand: row.brand ?? "", pkg: row.pkg ?? "",
    qty: row.qty == null ? null : Number(row.qty), qtyUnit: row.qtyUnit,
    deliveryRequirement: row.deliveryRequirement ?? "", note: row.note ?? "",
  };
}

/**
 * Updates/inserts/deletes individual source rows only. Submitted rows must retain
 * explicit IDs for existing rows; a client can never invent or duplicate an ID.
 */
async function synchronizeItems(tx: SqlExecutor, input: {
  enterpriseId: number; demandId: number; submittedEdit: boolean; items: CustomerDemandItem[];
  existing: DemandItemRow[]; ordered: ActiveOrderItem[]; write?: boolean;
}) {
  // Drafts retain backwards compatibility with clients written before stable IDs:
  // omitted identities are bound by their current position, never regenerated.
  const normalizedItems = !input.submittedEdit && input.items.every(item => item.id == null)
    ? input.items.map((item, index) => item.id == null && input.existing[index]
      ? { ...item, id: Number(input.existing[index]!.id) }
      : item)
    : input.items;
  const inputIds = normalizedItems.flatMap(item => item.id == null ? [] : [Number(item.id)]);
  if (new Set(inputIds).size !== inputIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "需求物料编号不能重复" });
  const existingById = new Map(input.existing.map(row => [Number(row.id), row]));
  if (inputIds.some(value => !existingById.has(value))) throw new TRPCError({ code: "BAD_REQUEST", message: "需求物料编号不属于当前需求" });
  if (input.submittedEdit && input.existing.length > 0 && inputIds.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "编辑已提交需求必须携带现有物料编号，请刷新后重试" });
  }
  const orderedById = new Map(input.ordered.map(row => [Number(row.sourceDemandItemId), row]));
  if (orderedById.size > 0 && normalizedItems.some(item => item.id == null)) {
    throw new TRPCError({ code: "CONFLICT", message: "该需求已有确认订单，不能新增物料；请新建需求承载新增需求" });
  }
  const providedById = new Map(normalizedItems.filter(item => item.id != null).map(item => [Number(item.id), item]));
  for (const [itemId, ordered] of Array.from(orderedById.entries())) {
    const proposed = providedById.get(itemId);
    if (!proposed) throw new TRPCError({ code: "CONFLICT", message: "已确认订单的物料不可删除" });
    const snapshot: CustomerDemandItem = {
      id: itemId, partNumber: ordered.partNumber ?? "", brand: ordered.brand ?? "", pkg: ordered.pkg ?? "",
      qty: Number(ordered.demandQty), qtyUnit: ordered.qtyUnit as CustomerDemandItem["qtyUnit"],
      deliveryRequirement: ordered.deliveryRequirement ?? "", note: ordered.note ?? "",
    };
    if (!itemPayloadEqual(proposed, snapshot)) {
      throw new TRPCError({ code: "CONFLICT", message: "已确认订单的物料及数量不可修改" });
    }
  }
  if (input.write === false) return input.existing;
  // Move source rows out of their unique sort-order slots before reordering/inserting.
  if (input.existing.length) await tx.execute(sql`
    UPDATE crm_customer_demand_items SET sortOrder = sortOrder + 1000000
     WHERE enterpriseId = ${input.enterpriseId} AND demandId = ${input.demandId}
  `);
  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index]!;
    const sortOrder = index + 1;
    if (item.id != null) {
      const result = resultHeader(await tx.execute(sql`
        UPDATE crm_customer_demand_items
           SET sortOrder = ${sortOrder}, partNumber = ${item.partNumber}, brand = ${item.brand}, pkg = ${item.pkg}, qty = ${item.qty},
               qtyUnit = ${item.qtyUnit}, deliveryRequirement = ${item.deliveryRequirement}, note = ${item.note}, updatedAt = ${CRM_NOW}
         WHERE enterpriseId = ${input.enterpriseId} AND demandId = ${input.demandId} AND id = ${item.id}
      `));
      if (Number(result.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "需求物料已被其他人修改，请刷新后重试" });
    } else {
      await tx.execute(sql`
        INSERT INTO crm_customer_demand_items
          (enterpriseId, demandId, sortOrder, partNumber, brand, pkg, qty, qtyUnit, deliveryRequirement, note, createdAt, updatedAt)
        VALUES (${input.enterpriseId}, ${input.demandId}, ${sortOrder}, ${item.partNumber}, ${item.brand}, ${item.pkg},
          ${item.qty}, ${item.qtyUnit}, ${item.deliveryRequirement}, ${item.note}, ${CRM_NOW}, ${CRM_NOW})
      `);
    }
  }
  const retained = new Set(inputIds);
  for (const row of input.existing) {
    const itemId = Number(row.id);
    if (!retained.has(itemId)) {
      if (orderedById.has(itemId)) throw new TRPCError({ code: "CONFLICT", message: "已确认订单的物料不可删除" });
      await tx.execute(sql`DELETE FROM crm_customer_demand_items WHERE enterpriseId = ${input.enterpriseId} AND demandId = ${input.demandId} AND id = ${itemId}`);
    }
  }
  return lockedDemandItems(tx, input.enterpriseId, input.demandId);
}

function snapshotData(demand: Pick<DemandRow, "projectName" | "priority" | "replyDueAt" | "note">, items: DemandItemRow[]): CustomerDemandData {
  return {
    projectName: demand.projectName ?? "", priority: demand.priority, replyDueAt: iso(demand.replyDueAt), note: demand.note ?? "",
    items: items.map(sourceItem),
  };
}

async function ensureRevisionSnapshot(tx: SqlExecutor, input: {
  scope: CustomerDemandScope; demand: DemandRow; items: DemandItemRow[]; actorUserId: number; changeReason: string;
}) {
  const exists = resultRows<{ id: number }>(await tx.execute(sql`
    SELECT id FROM crm_customer_demand_revisions
     WHERE enterpriseId = ${input.scope.enterpriseId} AND demandId = ${input.demand.id} AND revision = ${input.demand.revision}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (exists) return;
  await tx.execute(sql`
    INSERT INTO crm_customer_demand_revisions
      (enterpriseId, customerId, demandId, revision, actorUserId, changeReason, snapshot, createdAt)
    VALUES (${input.scope.enterpriseId}, ${input.demand.customerId}, ${input.demand.id}, ${input.demand.revision}, ${input.actorUserId},
      ${input.changeReason.slice(0, 500)}, ${JSON.stringify(snapshotData(input.demand, input.items))}, ${CRM_NOW})
  `);
}

function mapItem(row: DemandItemRow): CustomerDemandItem {
  return {
    ...(row.id == null ? {} : { id: Number(row.id) }),
    partNumber: row.partNumber ?? "", brand: row.brand ?? "", pkg: row.pkg ?? "",
    qty: row.qty == null ? null : Number(row.qty), qtyUnit: row.qtyUnit,
    deliveryRequirement: row.deliveryRequirement ?? "", note: row.note ?? "",
  };
}

function mapCustomerSummary(row: DemandRow): CustomerDemandSummary {
  return {
    id: Number(row.id), demandNo: row.demandNo, customerId: Number(row.customerId), customerName: row.customerName ?? "",
    projectName: row.projectName ?? "", priority: row.priority, status: row.status,
    createdByUserId: Number(row.createdByUserId), salesName: displayName(row.salesName, Number(row.createdByUserId)),
    procurementUserId: row.procurementUserId == null ? null : Number(row.procurementUserId),
    procurementName: displayName(row.procurementName, row.procurementUserId == null ? null : Number(row.procurementUserId)),
    itemCount: Number(row.itemCount ?? 0), version: Number(row.version), revision: Number(row.revision ?? 1),
    quoteCount: Number((row as DemandRow & { quoteCount?: number | string }).quoteCount ?? 0),
    hasActiveOrders: Boolean(Number((row as DemandRow & { activeOrderCount?: number | string }).activeOrderCount ?? 0)),
    replyDueAt: iso(row.replyDueAt), submittedAt: iso(row.submittedAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(), updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

function mapProcurementSummary(row: DemandRow): ProcurementDemandSummary {
  return {
    id: Number(row.id), demandNo: row.demandNo, projectName: row.projectName ?? "", priority: row.priority,
    status: row.status, createdByUserId: Number(row.createdByUserId),
    salesName: displayName(row.salesName, Number(row.createdByUserId)),
    procurementUserId: row.procurementUserId == null ? null : Number(row.procurementUserId),
    procurementName: displayName(row.procurementName, row.procurementUserId == null ? null : Number(row.procurementUserId)),
    itemCount: Number(row.itemCount ?? 0), version: Number(row.version), revision: Number(row.revision ?? 1), replyDueAt: iso(row.replyDueAt),
    submittedAt: iso(row.submittedAt), createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    quoteCount: Number((row as DemandRow & { quoteCount?: number | string }).quoteCount ?? 0),
    currentQuoteCount: Number((row as DemandRow & { currentQuoteCount?: number | string }).currentQuoteCount ?? 0),
    myQuoteId: (row as DemandRow & { myQuoteId?: number | null }).myQuoteId == null ? null : Number((row as DemandRow & { myQuoteId?: number }).myQuoteId),
    myQuoteVersion: (row as DemandRow & { myQuoteVersion?: number | null }).myQuoteVersion == null ? null : Number((row as DemandRow & { myQuoteVersion?: number }).myQuoteVersion),
    myQuoteNeedsReconfirmation: Boolean(Number((row as DemandRow & { myQuoteNeedsReconfirmation?: number | string }).myQuoteNeedsReconfirmation ?? 0)),
    firstPartNumber: row.firstPartNumber?.trim() ?? "",
    firstBrand: row.firstBrand?.trim() ?? "",
    firstQty: row.firstQty == null ? null : Number(row.firstQty),
    firstQtyUnit: row.firstQtyUnit?.trim() ?? "",
    firstDeliveryRequirement: row.firstDeliveryRequirement?.trim() ?? "",
    myActiveQuoteCount: Number(row.myActiveQuoteCount ?? 0),
    mySupplierCount: Number(row.mySupplierCount ?? 0),
    myQuoteRoundCount: Number(row.myQuoteRoundCount ?? 0),
  };
}

function mapSalesDemandSummary(row: SalesDemandRow): SalesDemandSummary {
  const currentQuoteCount = Number(row.currentQuoteCount ?? 0);
  const acceptedQuoteCount = Number(row.acceptedQuoteCount ?? 0);
  const activeOrderCount = Number(row.activeOrderCount ?? 0);
  const workflow = deriveCustomerDemandWorkflow({
    status: row.status,
    currentQuoteCount,
    acceptedQuoteCount,
    activeOrderCount,
  });
  const qtyUnitCount = Number(row.qtyUnitCount ?? 0);
  return {
    ...mapCustomerSummary(row),
    assignedUserId: Number(row.assignedUserId),
    assignedName: displayName(row.assignedName, Number(row.assignedUserId)),
    currentQuoteCount,
    acceptedQuoteCount,
    activeOrderCount,
    firstPartNumber: row.firstPartNumber?.trim() ?? "",
    totalQty: Number(row.totalQty ?? 0),
    qtyUnit: qtyUnitCount > 1 ? "多单位" : (row.qtyUnit?.trim() ?? ""),
    workflowStage: workflow.stage,
    nextAction: workflow.nextAction,
    overdue: Boolean(Number(row.overdue ?? 0)),
    activityAt: iso(row.activityAt) ?? new Date(0).toISOString(),
  };
}

function mapProcurementItem(row: DemandItemRow): ProcurementDemandDetail["items"][number] {
  if (!Number.isInteger(row.id) || Number(row.id) <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求物料编号异常" });
  return { id: Number(row.id), ...mapItem(row) };
}

function salesSummarySelect() {
  return sql`
    SELECT d.id, d.enterpriseId, d.customerId, d.demandNo, d.projectName, d.priority, d.status, d.note,
           d.replyDueAt, d.submittedAt, d.createdByUserId, d.updatedByUserId, d.procurementUserId, d.claimedAt,
           d.version, d.revision, d.createdAt, d.updatedAt, c.name AS customerName,
           COALESCE(sales.name, sales.username, CONCAT('用户', sales.id)) AS salesName,
           COALESCE(procurement.name, procurement.username, CONCAT('用户', procurement.id)) AS procurementName,
           (SELECT COUNT(*) FROM crm_customer_demand_items counted_item
             WHERE counted_item.enterpriseId = d.enterpriseId AND counted_item.demandId = d.id) AS itemCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.status = 'active') AS quoteCount,
           (SELECT COUNT(*) FROM crm_sales_orders active_order
             WHERE active_order.enterpriseId = d.enterpriseId AND active_order.customerId = d.customerId
               AND active_order.demandId = d.id AND active_order.status = 'confirmed') AS activeOrderCount
      FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
      LEFT JOIN users sales ON sales.id = d.createdByUserId
      LEFT JOIN users procurement ON procurement.id = d.procurementUserId
  `;
}

/** Sales-wide workflow projection; every row remains tenant- and assignee-scoped. */
function salesWorkflowSelect() {
  return sql`
    SELECT d.id, d.enterpriseId, d.customerId, d.demandNo, d.projectName, d.priority, d.status, d.note,
           d.replyDueAt, d.submittedAt, d.createdByUserId, d.updatedByUserId, d.procurementUserId, d.claimedAt,
           d.version, d.revision, d.createdAt, d.updatedAt, c.name AS customerName, c.assignedUserId,
           COALESCE(sales.name, sales.username, CONCAT('用户', sales.id)) AS salesName,
           COALESCE(assigned.name, assigned.username, CONCAT('用户', assigned.id)) AS assignedName,
           COALESCE(procurement.name, procurement.username, CONCAT('用户', procurement.id)) AS procurementName,
           (SELECT COUNT(*) FROM crm_customer_demand_items counted_item
             WHERE counted_item.enterpriseId = d.enterpriseId AND counted_item.demandId = d.id) AS itemCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.status = 'active') AS quoteCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes current_quote
             WHERE current_quote.enterpriseId = d.enterpriseId AND current_quote.demandId = d.id
               AND current_quote.demandRevision = d.revision AND current_quote.status = 'active') AS currentQuoteCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quote_acceptances accepted_quote
             INNER JOIN crm_customer_demand_quotes accepted_source
              ON accepted_source.enterpriseId = accepted_quote.enterpriseId AND accepted_source.id = accepted_quote.quoteId
              AND accepted_source.demandId = accepted_quote.demandId AND accepted_source.version = accepted_quote.quoteVersion
              AND accepted_source.demandRevision = accepted_quote.demandRevision AND accepted_source.status = 'active'
            WHERE accepted_quote.enterpriseId = d.enterpriseId AND accepted_quote.demandId = d.id
              AND accepted_quote.demandRevision = d.revision) AS acceptedQuoteCount,
           (SELECT COUNT(*) FROM crm_sales_orders active_order
             WHERE active_order.enterpriseId = d.enterpriseId AND active_order.customerId = d.customerId
               AND active_order.demandId = d.id AND active_order.status = 'confirmed') AS activeOrderCount,
           (SELECT first_item.partNumber FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstPartNumber,
           (SELECT COALESCE(SUM(quantity_item.qty), 0) FROM crm_customer_demand_items quantity_item
             WHERE quantity_item.enterpriseId = d.enterpriseId AND quantity_item.demandId = d.id) AS totalQty,
           (SELECT unit_item.qtyUnit FROM crm_customer_demand_items unit_item
             WHERE unit_item.enterpriseId = d.enterpriseId AND unit_item.demandId = d.id AND unit_item.qty IS NOT NULL
             ORDER BY unit_item.sortOrder ASC, unit_item.id ASC LIMIT 1) AS qtyUnit,
           (SELECT COUNT(DISTINCT unit_count.qtyUnit) FROM crm_customer_demand_items unit_count
             WHERE unit_count.enterpriseId = d.enterpriseId AND unit_count.demandId = d.id AND unit_count.qty IS NOT NULL) AS qtyUnitCount,
           GREATEST(d.updatedAt,
             COALESCE((SELECT MAX(activity_quote.updatedAt) FROM crm_customer_demand_quotes activity_quote
               WHERE activity_quote.enterpriseId = d.enterpriseId AND activity_quote.demandId = d.id), d.updatedAt),
             COALESCE((SELECT MAX(activity_accept.createdAt) FROM crm_customer_demand_quote_acceptances activity_accept
               WHERE activity_accept.enterpriseId = d.enterpriseId AND activity_accept.demandId = d.id), d.updatedAt),
             COALESCE((SELECT MAX(activity_order.updatedAt) FROM crm_sales_orders activity_order
               WHERE activity_order.enterpriseId = d.enterpriseId AND activity_order.demandId = d.id), d.updatedAt)
           ) AS activityAt,
           (d.replyDueAt IS NOT NULL AND d.replyDueAt < ${CRM_NOW} AND NOT ${activeSalesOrderExists("d")}) AS overdue
      FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
      LEFT JOIN users sales ON sales.id = d.createdByUserId
      LEFT JOIN users assigned ON assigned.id = c.assignedUserId
      LEFT JOIN users procurement ON procurement.id = d.procurementUserId
  `;
}

/** This deliberately has no customer table join or customer identity field. */
function procurementSummarySelect(actorUserId: number) {
  return sql`
    SELECT d.id, d.enterpriseId, d.demandNo, d.projectName, d.priority, d.status, d.note,
           d.replyDueAt, d.submittedAt, d.createdByUserId, d.updatedByUserId, d.procurementUserId, d.claimedAt,
           d.version, d.revision, d.createdAt, d.updatedAt,
           COALESCE(sales.name, sales.username, CONCAT('用户', sales.id)) AS salesName,
           COALESCE(procurement.name, procurement.username, CONCAT('用户', procurement.id)) AS procurementName,
           (SELECT COUNT(*) FROM crm_customer_demand_items counted_item
             WHERE counted_item.enterpriseId = d.enterpriseId AND counted_item.demandId = d.id) AS itemCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.status = 'active') AS quoteCount,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes current_quote
             WHERE current_quote.enterpriseId = d.enterpriseId AND current_quote.demandId = d.id AND current_quote.demandRevision = d.revision
               AND current_quote.status = 'active') AS currentQuoteCount,
           (SELECT quoted.id FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.procurementUserId = ${actorUserId}
               AND quoted.status = 'active' ORDER BY quoted.updatedAt DESC, quoted.id DESC LIMIT 1) AS myQuoteId,
           (SELECT quoted.version FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.procurementUserId = ${actorUserId}
               AND quoted.status = 'active' ORDER BY quoted.updatedAt DESC, quoted.id DESC LIMIT 1) AS myQuoteVersion,
           EXISTS(SELECT 1 FROM crm_customer_demand_quotes quoted
             WHERE quoted.enterpriseId = d.enterpriseId AND quoted.demandId = d.id AND quoted.procurementUserId = ${actorUserId}
               AND quoted.status = 'active' AND quoted.demandRevision <> d.revision) AS myQuoteNeedsReconfirmation,
           (SELECT first_item.partNumber FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstPartNumber,
           (SELECT first_item.brand FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstBrand,
           (SELECT first_item.qty FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstQty,
           (SELECT first_item.qtyUnit FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstQtyUnit,
           (SELECT first_item.deliveryRequirement FROM crm_customer_demand_items first_item
             WHERE first_item.enterpriseId = d.enterpriseId AND first_item.demandId = d.id
             ORDER BY first_item.sortOrder ASC, first_item.id ASC LIMIT 1) AS firstDeliveryRequirement,
           (SELECT COUNT(*) FROM crm_customer_demand_quotes mine
             WHERE mine.enterpriseId = d.enterpriseId AND mine.demandId = d.id AND mine.procurementUserId = ${actorUserId}
               AND mine.status = 'active' AND mine.demandRevision = d.revision) AS myActiveQuoteCount,
           (SELECT COUNT(DISTINCT mine.supplierName) FROM crm_customer_demand_quotes mine
             WHERE mine.enterpriseId = d.enterpriseId AND mine.demandId = d.id AND mine.procurementUserId = ${actorUserId}
               AND mine.status = 'active' AND mine.demandRevision = d.revision) AS mySupplierCount,
           (SELECT COALESCE(SUM(mine.version), 0) FROM crm_customer_demand_quotes mine
             WHERE mine.enterpriseId = d.enterpriseId AND mine.demandId = d.id AND mine.procurementUserId = ${actorUserId}
               AND mine.status = 'active' AND mine.demandRevision = d.revision) AS myQuoteRoundCount
      FROM crm_customer_demands d
      LEFT JOIN users sales ON sales.id = d.createdByUserId
      LEFT JOIN users procurement ON procurement.id = d.procurementUserId
  `;
}

function procurementTenantDemandExists(alias = "d") {
  return sql`EXISTS (
    SELECT 1 FROM crm_customers verified_customer
     WHERE verified_customer.id = ${sql.raw(alias)}.customerId
       AND verified_customer.enterpriseId = ${sql.raw(alias)}.enterpriseId
  )`;
}

function currentQuoteExists(alias = "d") {
  return sql`EXISTS (
    SELECT 1 FROM crm_customer_demand_quotes current_quote
     WHERE current_quote.enterpriseId = ${sql.raw(alias)}.enterpriseId
       AND current_quote.demandId = ${sql.raw(alias)}.id
       AND current_quote.demandRevision = ${sql.raw(alias)}.revision
       AND current_quote.status = 'active'
  )`;
}

function acceptedCurrentQuoteExists(alias = "d") {
  return sql`EXISTS (
    SELECT 1 FROM crm_customer_demand_quote_acceptances accepted_quote
      INNER JOIN crm_customer_demand_quotes accepted_source
        ON accepted_source.enterpriseId = accepted_quote.enterpriseId
       AND accepted_source.id = accepted_quote.quoteId
       AND accepted_source.demandId = accepted_quote.demandId
       AND accepted_source.version = accepted_quote.quoteVersion
       AND accepted_source.demandRevision = accepted_quote.demandRevision
       AND accepted_source.status = 'active'
     WHERE accepted_quote.enterpriseId = ${sql.raw(alias)}.enterpriseId
       AND accepted_quote.demandId = ${sql.raw(alias)}.id
       AND accepted_quote.demandRevision = ${sql.raw(alias)}.revision
  )`;
}

function activeSalesOrderExists(alias = "d") {
  return sql`EXISTS (
    SELECT 1 FROM crm_sales_orders workflow_order
     WHERE workflow_order.enterpriseId = ${sql.raw(alias)}.enterpriseId
       AND workflow_order.customerId = ${sql.raw(alias)}.customerId
       AND workflow_order.demandId = ${sql.raw(alias)}.id
       AND workflow_order.status = 'confirmed'
  )`;
}

function salesWorkflowStageCondition(stage: import("../../../shared/customerDemands").CustomerDemandWorkflowStage) {
  if (stage === "draft") return sql`d.status = 'draft'`;
  if (stage === "customer_confirmed") return sql`d.status <> 'draft' AND ${activeSalesOrderExists("d")}`;
  if (stage === "quote_confirmed") return sql`d.status <> 'draft' AND NOT ${activeSalesOrderExists("d")} AND ${acceptedCurrentQuoteExists("d")}`;
  if (stage === "quote_selection") return sql`d.status <> 'draft' AND NOT ${activeSalesOrderExists("d")} AND NOT ${acceptedCurrentQuoteExists("d")} AND ${currentQuoteExists("d")}`;
  return sql`d.status <> 'draft' AND NOT ${activeSalesOrderExists("d")} AND NOT ${acceptedCurrentQuoteExists("d")} AND NOT ${currentQuoteExists("d")}`;
}

/**
 * Creates/updates a sales-owned draft or moves a draft to procurement. Request mapping,
 * business row, items and audit are committed together, so a retry cannot duplicate work.
 */
export async function saveCustomerDemand(scope: CustomerDemandScope, rawInput: CustomerDemandSaveInput): Promise<CustomerDemandSaveResult> {
  const input = checkedSave(rawInput);
  const data = canonicalData(input.data);
  const payloadHash = customerDemandSavePayloadHash(input);
  const db = await requireDb();
  return db.transaction(async tx => {
    // Write lock order: enterprise/member -> customer -> demand. It matches CRM handoff/transfer.
    const access = await requireSalesAccess(tx, scope, true);
    const customer = await accessibleCustomer(tx, scope, access.canManageAll, input.customerId, true);
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, payloadHash,
    });
    if (reservation.replayed) {
      const replay = resultRows<{ demandNo: string; customerId: number; revision: number }>(await tx.execute(sql`
        SELECT demandNo, customerId, revision FROM crm_customer_demands
         WHERE enterpriseId = ${scope.enterpriseId} AND id = ${reservation.existing.demandId}
         LIMIT 1 FOR UPDATE
      `))[0];
      if (!replay || Number(replay.customerId) !== input.customerId) {
        throw new TRPCError({ code: "CONFLICT", message: "请求记录不完整，请联系管理员" });
      }
      return {
        id: Number(reservation.existing.demandId), demandNo: replay.demandNo,
        status: reservation.existing.resultStatus!, version: Number(reservation.existing.resultVersion),
        revision: Number(reservation.existing.resultDemandRevision ?? replay.revision ?? 1), replayed: true,
      };
    }
    if (customer.archivedAt) {
      throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可新建或编辑需求，请先恢复" });
    }

    let demandId: number;
    let demandNo: string;
    let status: CustomerDemandStatus;
    let version: number;
    let revision: number;
    let action: string;
    if (input.id) {
      const demand = await lockDemandForCustomer(tx, scope, input.customerId, input.id);
      if (Number(demand.version) !== input.version) {
        throw new TRPCError({ code: "CONFLICT", message: "需求已被其他人更新，请刷新后重试" });
      }
      demandId = Number(demand.id);
      demandNo = demand.demandNo;
      const existingItems = await lockedDemandItems(tx, scope.enterpriseId, demandId);
      const activeOrderItems = await lockedActiveOrderItems(tx, scope, input.customerId, demandId);
      const submittedEdit = demand.status !== "draft";
      if (submittedEdit && input.intent !== "update") {
        throw new TRPCError({ code: "CONFLICT", message: "已提交需求请使用更新操作" });
      }
      if (!submittedEdit && input.intent === "update") {
        throw new TRPCError({ code: "CONFLICT", message: "草稿需求请使用保存草稿或提交操作" });
      }
      const sameItems = existingItems.length === data.items.length && existingItems.every((row, index) => {
        const candidate = data.items[index]!;
        // Submitted updates require an identity for each existing source row. Drafts retain legacy positional compatibility.
        if (submittedEdit && Number(candidate.id) !== Number(row.id)) return false;
        if (candidate.id != null && Number(candidate.id) !== Number(row.id)) return false;
        return itemPayloadEqual(sourceItem(row), candidate);
      });
      const sameHeader = demand.projectName === data.projectName && demand.priority === data.priority && demand.note === data.note
        && iso(demand.replyDueAt) === data.replyDueAt;
      const statusAfter = demand.status === "draft" && input.intent === "submit" ? "submitted" : demand.status;
      const meaningful = !sameHeader || !sameItems || statusAfter !== demand.status;
      status = statusAfter;
      revision = Number(demand.revision ?? 1);
      if (meaningful) {
        if (submittedEdit) {
          // Lazily backfill legacy baseline before any mutation, then save the new revision after item sync.
          await ensureRevisionSnapshot(tx, { scope, demand, items: existingItems, actorUserId: Number(demand.updatedByUserId), changeReason: "" });
          revision += 1;
          action = "revised";
        } else action = status === "submitted" ? "submitted" : "updated";
        const result = resultHeader(await tx.execute(sql`
          UPDATE crm_customer_demands
             SET projectName = ${data.projectName}, priority = ${data.priority}, status = ${status}, note = ${data.note},
                 replyDueAt = ${data.replyDueAt ? toBeijingSqlDate(data.replyDueAt) : null},
                 submittedAt = ${status === "submitted" && demand.status === "draft" ? CRM_NOW : demand.submittedAt},
                 updatedByUserId = ${scope.actorUserId}, version = version + 1, revision = ${revision}, updatedAt = ${CRM_NOW}
           WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId} AND id = ${input.id}
             AND version = ${input.version}
        `));
        if (Number(result.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "需求已被其他人更新，请刷新后重试" });
        const synced = await synchronizeItems(tx, { enterpriseId: scope.enterpriseId, demandId, submittedEdit, items: data.items, existing: existingItems, ordered: activeOrderItems });
        if (status !== "draft") {
          const after: DemandRow = { ...demand, projectName: data.projectName, priority: data.priority, note: data.note, replyDueAt: data.replyDueAt, status, revision };
          await ensureRevisionSnapshot(tx, { scope, demand: after, items: synced, actorUserId: scope.actorUserId, changeReason: submittedEdit ? (input.changeReason?.trim() ?? "") : "" });
        }
        version = Number(demand.version) + 1;
      } else {
        action = "unchanged";
        version = Number(demand.version);
        // Check all stable IDs and ordered locks even for a semantic no-op; no DML is required.
        await synchronizeItems(tx, { enterpriseId: scope.enterpriseId, demandId, submittedEdit, items: data.items, existing: existingItems, ordered: activeOrderItems, write: false });
      }
    } else {
      if (input.intent === "update") throw new TRPCError({ code: "BAD_REQUEST", message: "更新已提交需求必须提供需求编号" });
      demandNo = await allocateDemandNo(tx, scope.enterpriseId);
      status = input.intent === "submit" ? "submitted" : "draft";
      action = status === "submitted" ? "submitted" : "created";
      const inserted = resultHeader(await tx.execute(sql`
        INSERT INTO crm_customer_demands
          (enterpriseId, customerId, demandNo, projectName, priority, status, note, replyDueAt, submittedAt,
           createdByUserId, updatedByUserId, procurementUserId, claimedAt, version, revision, createdAt, updatedAt)
        VALUES (${scope.enterpriseId}, ${input.customerId}, ${demandNo}, ${data.projectName}, ${data.priority}, ${status},
          ${data.note}, ${data.replyDueAt ? toBeijingSqlDate(data.replyDueAt) : null}, ${status === "submitted" ? CRM_NOW : null},
          ${scope.actorUserId}, ${scope.actorUserId}, NULL, NULL, 1, 1, ${CRM_NOW}, ${CRM_NOW})
      `));
      demandId = Number(inserted.insertId ?? 0);
      if (!demandId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求保存失败" });
      version = 1;
      revision = 1;
      const synced = await synchronizeItems(tx, { enterpriseId: scope.enterpriseId, demandId, submittedEdit: false, items: data.items, existing: [], ordered: [] });
      if (status === "submitted") {
        const createdDemand: DemandRow = {
          id: demandId, enterpriseId: scope.enterpriseId, customerId: input.customerId, demandNo, projectName: data.projectName,
          priority: data.priority, status, note: data.note, replyDueAt: data.replyDueAt, submittedAt: null,
          createdByUserId: scope.actorUserId, updatedByUserId: scope.actorUserId, procurementUserId: null, claimedAt: null,
          version, revision, createdAt: new Date(), updatedAt: new Date(),
        };
        await ensureRevisionSnapshot(tx, { scope, demand: createdDemand, items: synced, actorUserId: scope.actorUserId, changeReason: "" });
      }
    }
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: input.customerId, demandId, actorUserId: scope.actorUserId,
      action, note: action === "revised" ? (input.changeReason?.trim() || "更新已提交需求，采购报价需重新确认")
        : status === "submitted" ? "提交采购需求" : input.id ? "更新需求草稿" : "创建需求草稿", requestId: input.requestId,
    });
    await tx.execute(sql`
      UPDATE crm_customer_demand_requests
         SET demandId = ${demandId}, resultStatus = ${status}, resultVersion = ${version}, resultDemandRevision = ${revision}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    return { id: demandId, demandNo, status, version, revision, replayed: false };
  });
}

export async function listCustomerDemands(
  scope: CustomerDemandScope,
  rawInput: z.infer<typeof customerDemandListSchema>,
): Promise<DemandPage<CustomerDemandSummary>> {
  const input = checkedList(rawInput);
  const db = await requireDb();
  const access = await requireSalesAccess(db, scope);
  await accessibleCustomer(db, scope, access.canManageAll, input.customerId);
  const assigneeGuard = sql` AND ${crmDemandCustomerWhere(scope, access.policy)}`;
  const offset = (input.page - 1) * input.pageSize;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.customerId = ${input.customerId} ${assigneeGuard}
       AND ${procurementTenantDemandExists("d")}
  `))[0];
  const rows = resultRows<DemandRow>(await db.execute(sql`
    ${salesSummarySelect()}
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.customerId = ${input.customerId} ${assigneeGuard}
     ORDER BY d.updatedAt DESC, d.id DESC
     LIMIT ${input.pageSize} OFFSET ${offset}
  `));
  return { items: rows.map(mapCustomerSummary), total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}

export async function listSalesDemands(scope: CustomerDemandScope, rawInput: unknown): Promise<SalesDemandPage> {
  const input = checkedSalesList(rawInput);
  const db = await requireDb();
  const access = await requireSalesAccess(db, scope);
  const baseConditions: SQLWrapper[] = [
    sql`d.enterpriseId = ${scope.enterpriseId}`,
    sql`c.archivedAt IS NULL`,
    procurementTenantDemandExists("d"),
  ];
  baseConditions.push(crmDemandCustomerWhere(scope, access.policy));
  if (input.scope === "mine") {
    baseConditions.push(sql`c.assignedUserId = ${scope.actorUserId}`);
  } else if (input.assignedUserId) {
    baseConditions.push(sql`c.assignedUserId = ${input.assignedUserId}`);
  }
  if (input.keyword) {
    const keyword = `%${input.keyword.trim()}%`;
    baseConditions.push(sql`(
      d.demandNo LIKE ${keyword} OR d.projectName LIKE ${keyword} OR c.name LIKE ${keyword}
      OR EXISTS (
        SELECT 1 FROM crm_customer_demand_items keyword_item
         WHERE keyword_item.enterpriseId = d.enterpriseId AND keyword_item.demandId = d.id
           AND (keyword_item.partNumber LIKE ${keyword} OR keyword_item.brand LIKE ${keyword})
      )
    )`);
  }
  const listConditions = [...baseConditions];
  if (input.stage) listConditions.push(salesWorkflowStageCondition(input.stage));
  if (input.due === "overdue") {
    listConditions.push(sql`d.replyDueAt IS NOT NULL AND d.replyDueAt < ${CRM_NOW} AND NOT ${activeSalesOrderExists("d")}`);
  }
  const baseWhere = sql.join(baseConditions, sql` AND `);
  const listWhere = sql.join(listConditions, sql` AND `);
  const offset = (input.page - 1) * input.pageSize;

  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE ${listWhere}
  `))[0];
  const stageCounts = resultRows<{
    allCount: number | string; draftCount: number | string; inquiringCount: number | string;
    quoteSelectionCount: number | string; quoteConfirmedCount: number | string;
    customerConfirmedCount: number | string; overdueCount: number | string;
  }>(await db.execute(sql`
    SELECT COUNT(*) AS allCount,
           COALESCE(SUM(CASE WHEN ${salesWorkflowStageCondition("draft")} THEN 1 ELSE 0 END), 0) AS draftCount,
           COALESCE(SUM(CASE WHEN ${salesWorkflowStageCondition("inquiring")} THEN 1 ELSE 0 END), 0) AS inquiringCount,
           COALESCE(SUM(CASE WHEN ${salesWorkflowStageCondition("quote_selection")} THEN 1 ELSE 0 END), 0) AS quoteSelectionCount,
           COALESCE(SUM(CASE WHEN ${salesWorkflowStageCondition("quote_confirmed")} THEN 1 ELSE 0 END), 0) AS quoteConfirmedCount,
           COALESCE(SUM(CASE WHEN ${salesWorkflowStageCondition("customer_confirmed")} THEN 1 ELSE 0 END), 0) AS customerConfirmedCount,
           COALESCE(SUM(CASE WHEN d.replyDueAt IS NOT NULL AND d.replyDueAt < ${CRM_NOW}
             AND NOT ${activeSalesOrderExists("d")} THEN 1 ELSE 0 END), 0) AS overdueCount
      FROM crm_customer_demands d
      INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE ${baseWhere}
  `))[0];
  const rows = resultRows<SalesDemandRow>(await db.execute(sql`
    ${salesWorkflowSelect()}
     WHERE ${listWhere}
     ORDER BY overdue DESC, (d.priority = 'urgent') DESC, activityAt DESC, d.id DESC
     LIMIT ${input.pageSize} OFFSET ${offset}
  `));
  return {
    items: rows.map(mapSalesDemandSummary),
    total: Number(count?.total ?? 0),
    page: input.page,
    pageSize: input.pageSize,
    counts: {
      all: Number(stageCounts?.allCount ?? 0),
      draft: Number(stageCounts?.draftCount ?? 0),
      inquiring: Number(stageCounts?.inquiringCount ?? 0),
      quote_selection: Number(stageCounts?.quoteSelectionCount ?? 0),
      quote_confirmed: Number(stageCounts?.quoteConfirmedCount ?? 0),
      customer_confirmed: Number(stageCounts?.customerConfirmedCount ?? 0),
      overdue: Number(stageCounts?.overdueCount ?? 0),
    },
  };
}

export async function getCustomerDemand(scope: CustomerDemandScope, rawInput: { id: number }): Promise<CustomerDemandDetail> {
  const checked = customerDemandIdSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "需求编号无效" });
  const db = await requireDb();
  const access = await requireSalesAccess(db, scope);
  const assigneeGuard = sql` AND ${crmDemandCustomerWhere(scope, access.policy)}`;
  const rows = resultRows<DemandRow>(await db.execute(sql`
    ${salesSummarySelect()}
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.id = ${checked.data.id} ${assigneeGuard}
     LIMIT 1
  `));
  const demand = rows[0];
  if (!demand) {
    throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
  }
  const customer = await accessibleCustomer(db, scope, access.canManageAll, Number(demand.customerId));
  const items = resultRows<DemandItemRow>(await db.execute(sql`
    SELECT id, sortOrder, partNumber, brand, pkg, qty, qtyUnit, deliveryRequirement, note
      FROM crm_customer_demand_items
     WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${demand.id}
     ORDER BY sortOrder ASC, id ASC
  `));
  const activeOrders = resultRows<{ sourceDemandItemId: number }>(await db.execute(sql`
    SELECT soi.sourceDemandItemId FROM crm_sales_orders o
      INNER JOIN crm_sales_order_items soi ON soi.enterpriseId = o.enterpriseId AND soi.orderId = o.id
     WHERE o.enterpriseId = ${scope.enterpriseId} AND o.customerId = ${Number(demand.customerId)} AND o.demandId = ${demand.id}
       AND o.status = 'confirmed'
  `));
  const quoteCount = Number((demand as DemandRow & { quoteCount?: number | string }).quoteCount ?? 0);
  const canWrite = access.policy.customers.write && access.policy.demands.write;
  const canEdit = canWrite && !customer.archivedAt && (demand.status === "draft" || demand.status === "submitted" || demand.status === "processing");
  const hasActiveOrders = activeOrders.length > 0;
  return {
    ...mapCustomerSummary(demand), note: demand.note ?? "", items: items.map(mapItem), canEdit,
    lockedItemIds: Array.from(new Set(activeOrders.map(row => Number(row.sourceDemandItemId)))),
    requiresQuoteReconfirmation: quoteCount > 0,
    editRestriction: customer.archivedAt ? "已归档客户不可编辑需求"
      : hasActiveOrders ? "已确认订单的物料及数量不可修改；不能新增物料，请新建需求"
        : demand.status === "draft" ? undefined : "编辑已提交需求会生成新版本，现有报价需重新确认",
  };
}

/** Immutable revision history is customer-scoped and read only by the current customer owner. */
export async function listDemandRevisions(scope: CustomerDemandScope, rawInput: unknown): Promise<DemandPage<CustomerDemandRevision>> {
  const checked = customerDemandRevisionListSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "分页参数无效" });
  const input = checked.data;
  const db = await requireDb();
  const access = await requireSalesAccess(db, scope);
  const ownerGuard = sql` AND ${crmDemandCustomerWhere(scope, access.policy)}`;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demand_revisions r
      INNER JOIN crm_customer_demands d ON d.enterpriseId = r.enterpriseId AND d.id = r.demandId AND d.customerId = r.customerId
      INNER JOIN crm_customers c ON c.enterpriseId = d.enterpriseId AND c.id = d.customerId
     WHERE r.enterpriseId = ${scope.enterpriseId} AND r.demandId = ${input.id} ${ownerGuard}
  `))[0];
  const rows = resultRows<{
    id: number; revision: number; actorUserId: number; actorName: string | null; createdAt: Date | string;
    changeReason: string; snapshot: string;
  }>(await db.execute(sql`
    SELECT r.id, r.revision, r.actorUserId, COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS actorName,
           r.createdAt, r.changeReason, r.snapshot
      FROM crm_customer_demand_revisions r
      INNER JOIN crm_customer_demands d ON d.enterpriseId = r.enterpriseId AND d.id = r.demandId AND d.customerId = r.customerId
      INNER JOIN crm_customers c ON c.enterpriseId = d.enterpriseId AND c.id = d.customerId
      LEFT JOIN users u ON u.id = r.actorUserId
     WHERE r.enterpriseId = ${scope.enterpriseId} AND r.demandId = ${input.id} ${ownerGuard}
     ORDER BY r.revision DESC, r.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  `));
  const items = rows.map(row => {
    let snapshot: CustomerDemandData;
    try {
      const parsed = JSON.parse(row.snapshot);
      const checkedSnapshot = customerDemandSaveSchema.shape.data.safeParse(parsed);
      if (!checkedSnapshot.success) throw new Error("invalid snapshot");
      snapshot = checkedSnapshot.data;
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求修订快照损坏，请联系管理员" });
    }
    return {
      id: Number(row.id), revision: Number(row.revision), actorName: displayName(row.actorName, Number(row.actorUserId)),
      createdAt: iso(row.createdAt) ?? new Date(0).toISOString(), changeReason: row.changeReason ?? "", snapshot,
    };
  });
  return { items, total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}

export async function listProcurementDemands(
  scope: CustomerDemandScope,
  rawInput: z.infer<typeof procurementDemandListSchema>,
): Promise<DemandPage<ProcurementDemandSummary>> {
  const input = checkedProcurementList(rawInput);
  const db = await requireDb();
  const access = await requireProcurementAccess(db, scope);
  const conditions = [crmProcurementDemandWhere(scope, access.policy), sql`d.enterpriseId = ${scope.enterpriseId}`, sql`d.status IN ('submitted', 'processing')`, procurementTenantDemandExists("d")];
  // The queue is a personal quote workflow: old claim aliases remain supported but map to own quote existence.
  if (input.view === "quoted" || input.view === "mine") conditions.push(sql`EXISTS (
    SELECT 1 FROM crm_customer_demand_quotes mine
     WHERE mine.enterpriseId = d.enterpriseId AND mine.demandId = d.id AND mine.procurementUserId = ${scope.actorUserId}
       AND mine.demandRevision = d.revision AND mine.status = 'active'
  )`);
  if (input.view === "unquoted" || input.view === "unassigned") conditions.push(sql`NOT EXISTS (
    SELECT 1 FROM crm_customer_demand_quotes mine
     WHERE mine.enterpriseId = d.enterpriseId AND mine.demandId = d.id AND mine.procurementUserId = ${scope.actorUserId}
       AND mine.demandRevision = d.revision AND mine.status = 'active'
  )`);
  if (input.keyword) {
    const keyword = `%${input.keyword.trim()}%`;
    conditions.push(sql`(d.demandNo LIKE ${keyword} OR EXISTS (
      SELECT 1 FROM crm_customer_demand_items keyword_item
       WHERE keyword_item.enterpriseId = d.enterpriseId AND keyword_item.demandId = d.id AND keyword_item.partNumber LIKE ${keyword}
    ))`);
  }
  const where = sql.join(conditions, sql` AND `);
  const offset = (input.page - 1) * input.pageSize;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demands d WHERE ${where}
  `))[0];
  const rows = resultRows<DemandRow>(await db.execute(sql`
    ${procurementSummarySelect(scope.actorUserId)}
     WHERE ${where}
     ORDER BY (d.priority = 'urgent') DESC, d.submittedAt ASC, d.id ASC
     LIMIT ${input.pageSize} OFFSET ${offset}
  `));
  return { items: rows.map(mapProcurementSummary), total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}

export async function getProcurementDemand(scope: CustomerDemandScope, rawInput: { id: number }): Promise<ProcurementDemandDetail> {
  const checked = customerDemandIdSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "需求编号无效" });
  const db = await requireDb();
  const access = await requireProcurementAccess(db, scope);
  const demand = resultRows<DemandRow>(await db.execute(sql`
    ${procurementSummarySelect(scope.actorUserId)}
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.id = ${checked.data.id}
       AND d.status IN ('submitted', 'processing') AND ${procurementTenantDemandExists("d")}
       AND ${crmProcurementDemandWhere(scope, access.policy)}
     LIMIT 1
  `))[0];
  if (!demand) throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
  const items = resultRows<DemandItemRow>(await db.execute(sql`
    SELECT id, sortOrder, partNumber, brand, pkg, qty, qtyUnit, deliveryRequirement, note
      FROM crm_customer_demand_items
     WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${demand.id}
     ORDER BY sortOrder ASC, id ASC
  `));
  return { ...mapProcurementSummary(demand), note: demand.note ?? "", items: items.map(mapProcurementItem) };
}

export async function claimProcurementDemand(scope: CustomerDemandScope, rawInput: { id: number; version: number }): Promise<{ id: number; version: number }> {
  void scope;
  void rawInput;
  throw new TRPCError({ code: "CONFLICT", message: "需求无需领取；请刷新后直接填写并提交您的报价" });
}
