import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  demandQuoteAcceptSchema,
  demandQuoteHistorySchema,
  demandQuoteListSchema,
  demandQuoteSaveSchema,
  demandQuoteWithdrawSchema,
  type DemandQuoteAcceptInput,
  type DemandQuoteAcceptResult,
  type DemandQuote,
  type DemandQuoteHistoryInput,
  type DemandQuoteListInput,
  type DemandQuotePage,
  type DemandQuoteRevisionPage,
  type DemandQuoteSaveInput,
  type DemandQuoteSaveResult,
  type DemandQuoteWithdrawInput,
  type DemandQuoteWithdrawResult,
} from "../../../shared/customerDemandQuotes";
import type { CustomerDemandScope } from "./customerDemands";
import { getDb } from "../db";

/** Quote authorization is deliberately implemented here rather than trusting router/UI state. */
type SqlExecutor = { execute: (query: string | SQLWrapper) => Promise<unknown> };
type MembershipRow = { id: number; userId: number; role: "super_admin" | "admin" | "member"; status: "active" | "suspended"; loginDisabled: number | boolean };
type AccessState = { actor: MembershipRow; owner: boolean; ownerUserId: number };
type DemandIdentity = { id: number; customerId: number; status: "draft" | "submitted" | "processing"; procurementUserId: number | null; revision: number };
type CustomerLock = { id: number; assignedUserId: number; archivedAt: Date | string | null };
type QuoteRow = { id: number; enterpriseId: number; customerId: number; demandId: number; procurementUserId: number; supplierName: string; note: string; status: "active" | "withdrawn"; withdrawnAt?: Date | string | null; version: number; demandRevision: number; currentDemandRevision?: number; createdAt: Date | string; updatedAt: Date | string; procurementName?: string | null; acceptanceId?: number | null; acceptedByName?: string | null; acceptedAt?: Date | string | null; acceptanceHistoryCount?: number | string };
type QuoteItemRow = { demandItemId: number; partNumber: string; brand: string; pkg: string; qtyUnit: string; qty: number | string; unitPrice: string; leadTime: string; note: string; sortOrder: number; demandQty?: number | string | null; acceptedQty?: number | string | null; otherAcceptedQty?: number | string | null };
type SourceItem = { id: number; sortOrder: number; partNumber: string; brand: string; pkg: string; qtyUnit: string };
type RequestRow = { payloadHash: string; quoteId: number; resultVersion: number | null };

const CUSTOMER_PERMISSION = "customers.manage";
const CUSTOMER_ALL_PERMISSION = "customers.manage_all";
const PROCUREMENT_PERMISSION = "procurement.demands";
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

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? new Date(`${raw.replace(" ", "T")}+08:00`) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function displayName(value: string | null | undefined, userId: number) {
  return value?.trim() || `用户${userId}`;
}

function checkedSave(rawInput: DemandQuoteSaveInput): DemandQuoteSaveInput {
  const checked = demandQuoteSaveSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "请检查报价内容", cause: checked.error });
  return checked.data;
}

function checkedList(rawInput: DemandQuoteListInput): DemandQuoteListInput {
  const checked = demandQuoteListSchema.safeParse(rawInput);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "分页参数无效", cause: checked.error });
  return checked.data;
}

/** String pricing is canonicalized without numeric conversion; DECIMAL(19,4) remains exact end-to-end. */
function canonicalUnitPrice(value: string) {
  const [whole, fractional = ""] = value.trim().split(".");
  return `${whole}.${fractional.padEnd(4, "0")}`;
}

function quotePayloadHash(input: DemandQuoteSaveInput) {
  return createHash("sha256").update(JSON.stringify({
    demandId: input.demandId, id: input.id ?? null, version: input.version ?? null,
    ...(input.demandRevision === undefined ? {} : { demandRevision: input.demandRevision }),
    supplierName: input.supplierName.trim(), note: input.note.trim(),
    items: input.items.map(item => ({
      demandItemId: item.demandItemId, qty: item.qty, unitPrice: canonicalUnitPrice(item.unitPrice),
      leadTime: item.leadTime.trim(), note: item.note.trim(),
    })),
  })).digest("hex");
}

function quoteAcceptancePayloadHash(input: DemandQuoteAcceptInput) {
  return createHash("sha256").update(JSON.stringify({
    demandId: input.demandId,
    quoteId: input.quoteId,
    quoteVersion: input.quoteVersion,
    demandRevision: input.demandRevision,
    note: input.note.trim(),
    items: [...input.items].sort((left, right) => left.demandItemId - right.demandItemId),
  })).digest("hex");
}

/** Lock enterprise then all members before customer/demand/quote rows to match CRM handoff ordering. */
async function lockedEnterpriseMembers(tx: SqlExecutor, scope: CustomerDemandScope): Promise<AccessState> {
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
  return { actor, owner: actor.role === "super_admin" || Number(enterprise.superAdminUserId) === scope.actorUserId, ownerUserId: Number(enterprise.superAdminUserId) };
}

async function freshMembership(executor: SqlExecutor, scope: CustomerDemandScope): Promise<AccessState> {
  const row = resultRows<MembershipRow & { superAdminUserId: number }>(await executor.execute(sql`
    SELECT em.id, em.userId, em.role, em.status, u.loginDisabled, e.superAdminUserId
      FROM enterprises e INNER JOIN enterprise_members em ON em.enterpriseId = e.id
      INNER JOIN users u ON u.id = em.userId
     WHERE e.id = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId} LIMIT 1
  `))[0];
  if (!row || row.status !== "active" || Boolean(row.loginDisabled)) throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员不可用" });
  return { actor: row, owner: row.role === "super_admin" || Number(row.superAdminUserId) === scope.actorUserId, ownerUserId: Number(row.superAdminUserId) };
}

async function permissionKeys(executor: SqlExecutor, memberId: number, lock: boolean) {
  return resultRows<{ permissionKey: string }>(await executor.execute(sql`
    SELECT permissionKey FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${memberId} ${lock ? sql`FOR UPDATE` : sql``}
  `)).map(row => row.permissionKey);
}

async function requireProcurementAccess(executor: SqlExecutor, scope: CustomerDemandScope, lock: boolean) {
  const state = lock ? await lockedEnterpriseMembers(executor, scope) : await freshMembership(executor, scope);
  if (!state.owner && !(await permissionKeys(executor, state.actor.id, lock)).includes(PROCUREMENT_PERMISSION)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有采购需求权限" });
  }
  return state;
}

async function requireSalesAccess(executor: SqlExecutor, scope: CustomerDemandScope, lock: boolean) {
  const state = lock ? await lockedEnterpriseMembers(executor, scope) : await freshMembership(executor, scope);
  const permissions = state.owner ? [] : await permissionKeys(executor, state.actor.id, lock);
  const canManageAll = state.owner || permissions.includes(CUSTOMER_ALL_PERMISSION);
  if (!canManageAll && !permissions.includes(CUSTOMER_PERMISSION)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有客户管理权限" });
  }
  return { ...state, canManageAll };
}

async function quoteDemandIdentity(executor: SqlExecutor, scope: CustomerDemandScope, demandId: number, lock = false) {
  const row = resultRows<DemandIdentity>(await executor.execute(sql`
    SELECT id, customerId, status, procurementUserId, revision FROM crm_customer_demands
     WHERE enterpriseId = ${scope.enterpriseId} AND id = ${demandId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
  return row;
}

async function lockedCustomer(tx: SqlExecutor, scope: CustomerDemandScope, customerId: number) {
  const row = resultRows<CustomerLock>(await tx.execute(sql`
    SELECT id, assignedUserId, archivedAt FROM crm_customers
     WHERE enterpriseId = ${scope.enterpriseId} AND id = ${customerId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
  return row;
}

async function accessibleSalesDemand(executor: SqlExecutor, scope: CustomerDemandScope, demandId: number) {
  const access = await requireSalesAccess(executor, scope, false);
  const row = resultRows<DemandIdentity & CustomerLock>(await executor.execute(sql`
    SELECT d.id, d.customerId, d.status, d.procurementUserId, d.revision, c.assignedUserId, c.archivedAt
      FROM crm_customer_demands d INNER JOIN crm_customers c ON c.id = d.customerId AND c.enterpriseId = d.enterpriseId
     WHERE d.enterpriseId = ${scope.enterpriseId} AND d.id = ${demandId} LIMIT 1
  `))[0];
  if (!row || (!access.canManageAll && Number(row.assignedUserId) !== scope.actorUserId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
  }
  return { ...row, canManageAll: access.canManageAll };
}

async function reserveRequest(tx: SqlExecutor, scope: CustomerDemandScope, requestId: string, payloadHash: string) {
  const existing = resultRows<RequestRow>(await tx.execute(sql`
    SELECT payloadHash, quoteId, resultVersion FROM crm_customer_demand_quote_requests
     WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${requestId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new TRPCError({ code: "CONFLICT", message: "请求号已用于不同内容" });
    if (!Number(existing.quoteId) || !existing.resultVersion) throw new TRPCError({ code: "CONFLICT", message: "请求正在处理中，请稍后重试" });
    return { replayed: true as const, existing };
  }
  await tx.execute(sql`
    INSERT INTO crm_customer_demand_quote_requests
      (enterpriseId, actorUserId, requestId, payloadHash, quoteId, resultVersion, createdAt)
    VALUES (${scope.enterpriseId}, ${scope.actorUserId}, ${requestId}, ${payloadHash}, 0, NULL, ${CRM_NOW})
  `);
  return { replayed: false as const, existing: null };
}

function mapQuote(row: QuoteRow, itemRows: QuoteItemRow[]): DemandQuote {
  const isAccepted = Number(row.acceptanceId ?? 0) > 0;
  return {
    id: Number(row.id), demandId: Number(row.demandId), procurementUserId: Number(row.procurementUserId),
    procurementName: displayName(row.procurementName, Number(row.procurementUserId)),
    supplierName: row.supplierName ?? "", note: row.note ?? "", status: row.status ?? "active", withdrawnAt: row.withdrawnAt ? iso(row.withdrawnAt) : null, version: Number(row.version),
    demandRevision: Number(row.demandRevision ?? 1), currentDemandRevision: Number(row.currentDemandRevision ?? row.demandRevision ?? 1),
    needsReconfirmation: Number(row.demandRevision ?? 1) !== Number(row.currentDemandRevision ?? row.demandRevision ?? 1),
    isAccepted,
    acceptanceStale: !isAccepted && Number(row.acceptanceHistoryCount ?? 0) > 0,
    acceptedByName: isAccepted ? (row.acceptedByName?.trim() || "销售人员") : "",
    acceptedAt: isAccepted ? iso(row.acceptedAt) : null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    items: itemRows.map(item => ({
      demandItemId: Number(item.demandItemId), partNumber: item.partNumber ?? "", brand: item.brand ?? "", pkg: item.pkg ?? "",
      qtyUnit: item.qtyUnit ?? "", qty: Number(item.qty), unitPrice: String(item.unitPrice), leadTime: item.leadTime ?? "", note: item.note ?? "",
      ...(item.demandQty == null ? {} : { demandQty: Number(item.demandQty) }),
      ...(item.acceptedQty == null ? {} : { acceptedQty: Number(item.acceptedQty) }),
      ...(item.demandQty == null || item.otherAcceptedQty == null ? {} : { availableToAcceptQty: Math.max(0, Number(item.demandQty) - Number(item.otherAcceptedQty)) }),
    })),
  };
}

async function insertCurrentItems(tx: SqlExecutor, input: { quoteId: number; enterpriseId: number; demandId: number; source: Map<number, SourceItem>; items: DemandQuoteSaveInput["items"] }) {
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!;
    const source = input.source.get(item.demandItemId);
    if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "报价物料不属于当前需求" });
    await tx.execute(sql`
      INSERT INTO crm_customer_demand_quote_items
        (enterpriseId, demandId, quoteId, demandItemId, sortOrder, partNumber, brand, pkg, qty, qtyUnit, unitPrice, leadTime, note, createdAt)
      VALUES (${input.enterpriseId}, ${input.demandId}, ${input.quoteId}, ${item.demandItemId}, ${index + 1},
        ${source.partNumber}, ${source.brand}, ${source.pkg}, ${item.qty}, ${source.qtyUnit}, ${canonicalUnitPrice(item.unitPrice)},
        ${item.leadTime.trim()}, ${item.note.trim()}, ${CRM_NOW})
    `);
  }
}

async function insertAuditSnapshot(tx: SqlExecutor, input: { quoteId: number; version: number; demandRevision: number; action: "created" | "updated"; scope: CustomerDemandScope; customerId: number; demandId: number; requestId: string; supplierName: string; note: string; source: Map<number, SourceItem>; items: DemandQuoteSaveInput["items"] }) {
  const inserted = resultHeader(await tx.execute(sql`
    INSERT INTO crm_customer_demand_quote_audits
      (enterpriseId, customerId, demandId, quoteId, procurementUserId, version, demandRevision, action, requestId, supplierName, note, createdAt)
    VALUES (${input.scope.enterpriseId}, ${input.customerId}, ${input.demandId}, ${input.quoteId}, ${input.scope.actorUserId},
      ${input.version}, ${input.demandRevision}, ${input.action}, ${input.requestId}, ${input.supplierName}, ${input.note}, ${CRM_NOW})
  `));
  const auditId = Number(inserted.insertId ?? 0);
  if (!auditId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "报价审计保存失败" });
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!;
    const source = input.source.get(item.demandItemId);
    if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "报价物料不属于当前需求" });
    await tx.execute(sql`
      INSERT INTO crm_customer_demand_quote_audit_items
        (enterpriseId, auditId, demandItemId, sortOrder, partNumber, brand, pkg, qty, qtyUnit, unitPrice, leadTime, note, createdAt)
      VALUES (${input.scope.enterpriseId}, ${auditId}, ${item.demandItemId}, ${index + 1}, ${source.partNumber}, ${source.brand}, ${source.pkg},
        ${item.qty}, ${source.qtyUnit}, ${canonicalUnitPrice(item.unitPrice)}, ${item.leadTime.trim()}, ${item.note.trim()}, ${CRM_NOW})
    `);
  }
}

/** Creates another supplier option or appends a new round to one caller-owned active option. */
export async function saveDemandQuote(scope: CustomerDemandScope, rawInput: DemandQuoteSaveInput): Promise<DemandQuoteSaveResult> {
  const input = checkedSave(rawInput);
  const payloadHash = quotePayloadHash(input);
  const db = await requireDb();
  return db.transaction(async tx => {
    // Lock order: enterprise/members -> customer -> demand -> caller's quote.
    await requireProcurementAccess(tx, scope, true);
    const looseIdentity = await quoteDemandIdentity(tx, scope, input.demandId);
    const customer = await lockedCustomer(tx, scope, Number(looseIdentity.customerId));
    const demand = await quoteDemandIdentity(tx, scope, input.demandId, true);
    if (Number(demand.customerId) !== Number(customer.id)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
    }
    if (demand.status === "draft") throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
    const currentDemandRevision = Number(demand.revision ?? 1);

    const reservation = await reserveRequest(tx, scope, input.requestId, payloadHash);
    if (reservation.replayed) {
      const replayQuote = resultRows<QuoteRow>(await tx.execute(sql`
        SELECT id, enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, version, demandRevision, createdAt, updatedAt
          FROM crm_customer_demand_quotes
         WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId}
           AND procurementUserId = ${scope.actorUserId} AND id = ${reservation.existing.quoteId} LIMIT 1 FOR UPDATE
      `))[0];
      if (!replayQuote) throw new TRPCError({ code: "CONFLICT", message: "请求记录不完整，请刷新后重试" });
      return { id: Number(reservation.existing.quoteId), version: Number(reservation.existing.resultVersion), replayed: true };
    }
    // A response lost before archival is still safely acknowledged by the replay branch above.
    if (Number(input.demandRevision ?? 1) !== currentDemandRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "需求已更新，报价需刷新后重新确认" });
    }
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可报价" });

    const existing = input.id ? resultRows<QuoteRow>(await tx.execute(sql`
      SELECT id, enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, version, demandRevision, createdAt, updatedAt
        FROM crm_customer_demand_quotes
       WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId}
         AND procurementUserId = ${scope.actorUserId} AND id = ${input.id}
       LIMIT 1 FOR UPDATE
    `))[0] : undefined;
    if (input.id && !existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "报价不存在或不属于当前采购人员" });
    }
    if (existing?.status === "withdrawn") throw new TRPCError({ code: "CONFLICT", message: "已撤回报价不可修改，请新增供应商报价" });
    if (existing && Number(existing.version) !== input.version) {
      throw new TRPCError({ code: "CONFLICT", message: "报价已被更新，请刷新后重试" });
    }
    const duplicateSupplier = resultRows<{ id: number }>(await tx.execute(sql`
      SELECT id FROM crm_customer_demand_quotes
       WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId}
         AND procurementUserId = ${scope.actorUserId} AND demandRevision = ${currentDemandRevision}
         AND status = 'active' AND LOWER(TRIM(supplierName)) = LOWER(${input.supplierName.trim()})
         ${existing ? sql`AND id <> ${Number(existing.id)}` : sql``}
       ORDER BY id LIMIT 1 FOR UPDATE
    `))[0];
    if (duplicateSupplier) {
      throw new TRPCError({ code: "CONFLICT", message: "该供应商已有有效报价，请在原方案中提交新一轮" });
    }

    const sourceRows = resultRows<SourceItem>(await tx.execute(sql`
      SELECT id, sortOrder, partNumber, brand, pkg, qtyUnit FROM crm_customer_demand_items
       WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId}
       ORDER BY sortOrder ASC, id ASC
    `));
    const source = new Map(sourceRows.map(row => [Number(row.id), { ...row, id: Number(row.id), sortOrder: Number(row.sortOrder) }]));
    if (source.size === 0 || input.items.some(item => !source.has(item.demandItemId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "报价物料不属于当前需求" });
    }

    let quoteId: number;
    let version: number;
    let action: "created" | "updated";
    if (existing) {
      quoteId = Number(existing.id);
      version = Number(existing.version) + 1;
      action = "updated";
      const update = resultHeader(await tx.execute(sql`
        UPDATE crm_customer_demand_quotes
           SET supplierName = ${input.supplierName.trim()}, note = ${input.note.trim()}, demandRevision = ${currentDemandRevision}, version = version + 1, updatedAt = ${CRM_NOW}
         WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId} AND procurementUserId = ${scope.actorUserId}
           AND id = ${quoteId} AND status = 'active' AND version = ${input.version}
      `));
      if (Number(update.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "报价已被更新，请刷新后重试" });
      await tx.execute(sql`DELETE FROM crm_customer_demand_quote_items WHERE enterpriseId = ${scope.enterpriseId} AND quoteId = ${quoteId}`);
    } else {
      action = "created";
      const inserted = resultHeader(await tx.execute(sql`
        INSERT INTO crm_customer_demand_quotes
          (enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, withdrawnByUserId, version, demandRevision, createdAt, updatedAt)
        VALUES (${scope.enterpriseId}, ${Number(demand.customerId)}, ${input.demandId}, ${scope.actorUserId},
          ${input.supplierName.trim()}, ${input.note.trim()}, 'active', NULL, NULL, 1, ${currentDemandRevision}, ${CRM_NOW}, ${CRM_NOW})
      `));
      quoteId = Number(inserted.insertId ?? 0);
      if (!quoteId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "报价保存失败" });
      version = 1;
    }
    await insertCurrentItems(tx, { quoteId, enterpriseId: scope.enterpriseId, demandId: input.demandId, source, items: input.items });
    await insertAuditSnapshot(tx, {
      quoteId, version, action, scope, customerId: Number(demand.customerId), demandId: input.demandId,
      requestId: input.requestId, demandRevision: currentDemandRevision, supplierName: input.supplierName.trim(), note: input.note.trim(), source, items: input.items,
    });
    // First quote moves a submitted demand to processing without assigning/clearing legacy claim fields.
    if (demand.status === "submitted") {
      await tx.execute(sql`
        UPDATE crm_customer_demands SET status = 'processing', version = version + 1, updatedAt = ${CRM_NOW}
         WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${Number(demand.customerId)} AND id = ${input.demandId} AND status = 'submitted'
      `);
    }
    await tx.execute(sql`
      UPDATE crm_customer_demand_quote_requests SET quoteId = ${quoteId}, resultVersion = ${version}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    return { id: quoteId, version, replayed: false };
  });
}

/** Withdrawal preserves the option and every round for audit; it never deletes prices. */
export async function withdrawDemandQuote(scope: CustomerDemandScope, rawInput: DemandQuoteWithdrawInput): Promise<DemandQuoteWithdrawResult> {
  const parsed = demandQuoteWithdrawSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "报价参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  return db.transaction(async tx => {
    await requireProcurementAccess(tx, scope, true);
    const quote = resultRows<QuoteRow>(await tx.execute(sql`
      SELECT id, enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, version,
             demandRevision, createdAt, updatedAt
        FROM crm_customer_demand_quotes
       WHERE enterpriseId = ${scope.enterpriseId} AND procurementUserId = ${scope.actorUserId} AND id = ${input.quoteId}
       LIMIT 1 FOR UPDATE
    `))[0];
    if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "报价不存在或不属于当前采购人员" });
    if (Number(quote.version) !== input.version) throw new TRPCError({ code: "CONFLICT", message: "报价已更新，请刷新后重试" });
    if (quote.status === "withdrawn") return { quoteId: input.quoteId, replayed: true };
    const updated = resultHeader(await tx.execute(sql`
      UPDATE crm_customer_demand_quotes
         SET status = 'withdrawn', withdrawnAt = ${CRM_NOW}, withdrawnByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND procurementUserId = ${scope.actorUserId}
         AND id = ${input.quoteId} AND status = 'active' AND version = ${input.version}
    `));
    if (Number(updated.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "报价状态已变化，请刷新后重试" });
    return { quoteId: input.quoteId, replayed: false };
  });
}

/** Every saved round is an immutable audit snapshot, visible only through the same sales/procurement scope as the option. */
export async function listDemandQuoteHistory(scope: CustomerDemandScope, rawInput: DemandQuoteHistoryInput): Promise<DemandQuoteRevisionPage> {
  const parsed = demandQuoteHistorySchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "报价历史参数无效" });
  const input = parsed.data;
  const db = await requireDb();
  const quote = resultRows<QuoteRow>(await db.execute(sql`
    SELECT id, enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, version,
           demandRevision, createdAt, updatedAt
      FROM crm_customer_demand_quotes
     WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.quoteId} LIMIT 1
  `))[0];
  if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "报价不存在" });
  let salesCanManageAll = false;
  if (input.audience === "procurement") {
    await requireProcurementAccess(db, scope, false);
    if (Number(quote.procurementUserId) !== scope.actorUserId) throw new TRPCError({ code: "NOT_FOUND", message: "报价不存在" });
  } else {
    salesCanManageAll = (await accessibleSalesDemand(db, scope, Number(quote.demandId))).canManageAll;
  }
  const historyOwnerJoin = input.audience === "sales" ? sql`
    INNER JOIN crm_customer_demand_quotes guarded_quote
      ON guarded_quote.enterpriseId = qa.enterpriseId AND guarded_quote.id = qa.quoteId
    INNER JOIN crm_customer_demands guarded_demand
      ON guarded_demand.enterpriseId = guarded_quote.enterpriseId AND guarded_demand.id = guarded_quote.demandId
    INNER JOIN crm_customers guarded_customer
      ON guarded_customer.enterpriseId = guarded_demand.enterpriseId AND guarded_customer.id = guarded_demand.customerId
  ` : sql``;
  const historyOwnerGuard = input.audience === "sales" && !salesCanManageAll
    ? sql` AND guarded_customer.assignedUserId = ${scope.actorUserId}` : sql``;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demand_quote_audits qa ${historyOwnerJoin}
     WHERE qa.enterpriseId = ${scope.enterpriseId} AND qa.quoteId = ${input.quoteId} ${historyOwnerGuard}
  `))[0];
  const audits = resultRows<{
    id: number; quoteId: number; version: number; demandRevision: number; action: "created" | "updated";
    supplierName: string; note: string; createdAt: Date | string;
  }>(await db.execute(sql`
    SELECT qa.id, qa.quoteId, qa.version, qa.demandRevision, qa.action, qa.supplierName, qa.note, qa.createdAt
      FROM crm_customer_demand_quote_audits qa ${historyOwnerJoin}
     WHERE qa.enterpriseId = ${scope.enterpriseId} AND qa.quoteId = ${input.quoteId} ${historyOwnerGuard}
     ORDER BY qa.version DESC, qa.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  `));
  if (!audits.length) return { items: [], total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
  const auditIds = audits.map(audit => Number(audit.id));
  const itemRows = resultRows<QuoteItemRow & { auditId: number }>(await db.execute(sql`
    SELECT auditId, demandItemId, partNumber, brand, pkg, qtyUnit, qty, unitPrice, leadTime, note, sortOrder
      FROM crm_customer_demand_quote_audit_items
     WHERE enterpriseId = ${scope.enterpriseId} AND auditId IN (${sql.join(auditIds.map(id => sql`${id}`), sql`, `)})
     ORDER BY auditId ASC, sortOrder ASC, id ASC
  `));
  const groups = new Map<number, QuoteItemRow[]>();
  for (const item of itemRows) {
    const group = groups.get(Number(item.auditId)) ?? [];
    group.push(item);
    groups.set(Number(item.auditId), group);
  }
  return {
    items: audits.map(audit => ({
      id: Number(audit.id), quoteId: Number(audit.quoteId), version: Number(audit.version), demandRevision: Number(audit.demandRevision ?? 1),
      action: audit.action, supplierName: input.audience === "sales" ? "" : (audit.supplierName ?? ""), note: audit.note ?? "", createdAt: iso(audit.createdAt),
      items: (groups.get(Number(audit.id)) ?? []).map(item => ({
        demandItemId: Number(item.demandItemId), partNumber: item.partNumber ?? "", brand: item.brand ?? "", pkg: item.pkg ?? "",
        qtyUnit: item.qtyUnit ?? "", qty: Number(item.qty), unitPrice: String(item.unitPrice), leadTime: item.leadTime ?? "", note: item.note ?? "",
      })),
    })),
    total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize,
  };
}

/**
 * Sales accepts one immutable quote snapshot. A later procurement update or
 * demand revision leaves the old decision as history and requires a new accept.
 */
export async function acceptDemandQuote(scope: CustomerDemandScope, rawInput: DemandQuoteAcceptInput): Promise<DemandQuoteAcceptResult> {
  const parsed = demandQuoteAcceptSchema.safeParse(rawInput);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "确认报价参数无效", cause: parsed.error });
  const input = parsed.data;
  const payloadHash = quoteAcceptancePayloadHash(input);
  const db = await requireDb();
  try {
    return await db.transaction(async tx => {
    const access = await requireSalesAccess(tx, scope, true);
    const looseDemand = await quoteDemandIdentity(tx, scope, input.demandId);
    const customer = await lockedCustomer(tx, scope, Number(looseDemand.customerId));
    if (!access.canManageAll && Number(customer.assignedUserId) !== scope.actorUserId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
    }
    const demand = await quoteDemandIdentity(tx, scope, input.demandId, true);
    if (Number(demand.customerId) !== Number(customer.id)) throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可采用报价" });

    const quote = resultRows<QuoteRow>(await tx.execute(sql`
      SELECT id, enterpriseId, customerId, demandId, procurementUserId, supplierName, note, status, withdrawnAt, version, demandRevision, createdAt, updatedAt
        FROM crm_customer_demand_quotes
       WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${Number(customer.id)}
         AND demandId = ${input.demandId} AND id = ${input.quoteId}
       LIMIT 1 FOR UPDATE
    `))[0];
    if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "采购报价不存在" });

    const request = resultRows<{ id: number; payloadHash: string; quoteId: number }>(await tx.execute(sql`
      SELECT id, payloadHash, quoteId FROM crm_customer_demand_quote_acceptances
       WHERE enterpriseId = ${scope.enterpriseId} AND acceptedByUserId = ${scope.actorUserId}
         AND requestId = ${input.requestId} LIMIT 1 FOR UPDATE
    `))[0];
    if (request) {
      if (request.payloadHash !== payloadHash) throw new TRPCError({ code: "CONFLICT", message: "请求号已用于不同报价" });
      const acceptedQty = resultRows<{ qty: number | string }>(await tx.execute(sql`
        SELECT COALESCE(SUM(qty), 0) AS qty FROM crm_customer_demand_quote_acceptance_items
         WHERE enterpriseId = ${scope.enterpriseId} AND acceptanceId = ${Number(request.id)}
      `))[0];
      return { id: Number(request.id), quoteId: Number(request.quoteId), acceptedQty: Number(acceptedQty?.qty ?? 0), replayed: true };
    }
    if (Number(demand.revision ?? 1) !== input.demandRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "需求已更新，请刷新后重新选择报价" });
    }
    if (Number(quote.version) !== input.quoteVersion || Number(quote.demandRevision ?? 1) !== input.demandRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "采购报价已更新，请刷新后重新确认" });
    }
    if (quote.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "该报价已撤回，请选择其他报价" });

    const existing = resultRows<{ id: number; quoteId: number; payloadHash: string }>(await tx.execute(sql`
      SELECT id, quoteId, payloadHash FROM crm_customer_demand_quote_acceptances
       WHERE enterpriseId = ${scope.enterpriseId} AND demandId = ${input.demandId}
         AND demandRevision = ${input.demandRevision} AND quoteId = ${input.quoteId}
         AND quoteVersion = ${input.quoteVersion} LIMIT 1 FOR UPDATE
    `))[0];
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new TRPCError({ code: "CONFLICT", message: "该报价轮次已采用，采用数量不可修改；请让采购提交新一轮报价" });
      }
      const acceptedQty = resultRows<{ qty: number | string }>(await tx.execute(sql`
        SELECT COALESCE(SUM(qty), 0) AS qty FROM crm_customer_demand_quote_acceptance_items
         WHERE enterpriseId = ${scope.enterpriseId} AND acceptanceId = ${Number(existing.id)}
      `))[0];
      return { id: Number(existing.id), quoteId: Number(existing.quoteId), acceptedQty: Number(acceptedQty?.qty ?? 0), replayed: true };
    }

    const quoteItems = resultRows<{ demandItemId: number; quoteQty: number | string; demandQty: number | string | null; partNumber: string }>(await tx.execute(sql`
      SELECT qi.demandItemId, qi.qty AS quoteQty, di.qty AS demandQty, qi.partNumber
        FROM crm_customer_demand_quote_items qi
        INNER JOIN crm_customer_demand_items di
          ON di.enterpriseId = qi.enterpriseId AND di.demandId = qi.demandId AND di.id = qi.demandItemId
       WHERE qi.enterpriseId = ${scope.enterpriseId} AND qi.demandId = ${input.demandId} AND qi.quoteId = ${input.quoteId}
       ORDER BY qi.demandItemId ASC FOR UPDATE
    `));
    const quoteByItem = new Map(quoteItems.map(item => [Number(item.demandItemId), item]));
    const inputIds = input.items.map(item => item.demandItemId);
    if (input.items.some(item => !quoteByItem.has(item.demandItemId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "采用物料不属于该报价" });
    }
    const alreadyAccepted = resultRows<{ demandItemId: number; qty: number | string }>(await tx.execute(sql`
      SELECT accepted_item.demandItemId, accepted_item.qty
        FROM crm_customer_demand_quote_acceptance_items accepted_item
        INNER JOIN crm_customer_demand_quote_acceptances accepted
          ON accepted.enterpriseId = accepted_item.enterpriseId AND accepted.id = accepted_item.acceptanceId
        INNER JOIN crm_customer_demand_quotes accepted_quote
          ON accepted_quote.enterpriseId = accepted.enterpriseId AND accepted_quote.id = accepted.quoteId
         AND accepted_quote.demandId = accepted.demandId AND accepted_quote.version = accepted.quoteVersion
         AND accepted_quote.demandRevision = accepted.demandRevision AND accepted_quote.status = 'active'
       WHERE accepted_item.enterpriseId = ${scope.enterpriseId} AND accepted_item.demandId = ${input.demandId}
         AND accepted.demandRevision = ${input.demandRevision}
         AND accepted_item.demandItemId IN (${sql.join(inputIds.map(id => sql`${id}`), sql`, `)})
       ORDER BY accepted_item.demandItemId ASC, accepted_item.id ASC FOR UPDATE
    `));
    const acceptedByItem = new Map<number, number>();
    for (const item of alreadyAccepted) {
      const itemId = Number(item.demandItemId);
      acceptedByItem.set(itemId, (acceptedByItem.get(itemId) ?? 0) + Number(item.qty));
    }
    for (const selected of input.items) {
      const source = quoteByItem.get(selected.demandItemId)!;
      const demandQty = Number(source.demandQty ?? 0);
      const quoteQty = Number(source.quoteQty ?? 0);
      if (selected.qty > quoteQty) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${source.partNumber || "未命名物料"} 的采用数量不能超过本报价数量` });
      }
      if (demandQty <= 0 || selected.qty + (acceptedByItem.get(selected.demandItemId) ?? 0) > demandQty) {
        throw new TRPCError({ code: "CONFLICT", message: `型号 ${source.partNumber || "未命名物料"} 的累计采用数量不能超过需求数量` });
      }
    }

    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO crm_customer_demand_quote_acceptances
        (enterpriseId, customerId, demandId, demandRevision, quoteId, quoteVersion, acceptedByUserId, note, requestId, payloadHash, createdAt)
      VALUES (${scope.enterpriseId}, ${Number(customer.id)}, ${input.demandId}, ${input.demandRevision}, ${input.quoteId},
        ${input.quoteVersion}, ${scope.actorUserId}, ${input.note.trim()}, ${input.requestId}, ${payloadHash}, ${CRM_NOW})
    `));
    const acceptanceId = Number(inserted.insertId ?? 0);
    if (!acceptanceId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "采用报价失败" });
    for (const item of input.items) {
      await tx.execute(sql`
        INSERT INTO crm_customer_demand_quote_acceptance_items
          (enterpriseId, acceptanceId, demandId, demandItemId, qty, createdAt)
        VALUES (${scope.enterpriseId}, ${acceptanceId}, ${input.demandId}, ${item.demandItemId}, ${item.qty}, ${CRM_NOW})
      `);
    }
    const acceptedQty = input.items.reduce((sum, item) => sum + item.qty, 0);
    const auditNote = `采用报价 #${input.quoteId} 第${input.quoteVersion}轮，共${acceptedQty}片${input.note.trim() ? `；${input.note.trim()}` : ""}`.slice(0, 500);
    await tx.execute(sql`
      INSERT INTO crm_customer_demand_audits
        (enterpriseId, customerId, demandId, actorUserId, action, note, requestId, createdAt)
      VALUES (${scope.enterpriseId}, ${Number(customer.id)}, ${input.demandId}, ${scope.actorUserId}, 'quote_accepted',
        ${auditNote}, ${input.requestId}, ${CRM_NOW})
    `);
      return { id: acceptanceId, quoteId: input.quoteId, acceptedQty, replayed: false };
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[customerDemand.quoteAccept] failed", error);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "采用报价失败，请稍后重试" });
  }
}

/** Sales sees active supplier options; procurement sees caller-owned options, including withdrawn history. */
export async function listDemandQuotes(scope: CustomerDemandScope, rawInput: DemandQuoteListInput): Promise<DemandQuotePage> {
  const input = checkedList(rawInput);
  const db = await requireDb();
  let salesCanManageAll = false;
  if (input.audience === "sales") {
    salesCanManageAll = (await accessibleSalesDemand(db, scope, input.demandId)).canManageAll;
  } else {
    await requireProcurementAccess(db, scope, false);
    const demand = await quoteDemandIdentity(db, scope, input.demandId);
    if (demand.status === "draft") throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
    const verifiedCustomer = resultRows<{ id: number }>(await db.execute(sql`
      SELECT id FROM crm_customers WHERE enterpriseId = ${scope.enterpriseId} AND id = ${Number(demand.customerId)} LIMIT 1
    `))[0];
    if (!verifiedCustomer) throw new TRPCError({ code: "NOT_FOUND", message: "采购需求不存在" });
  }
  const ownGuard = input.audience === "procurement" ? sql` AND q.procurementUserId = ${scope.actorUserId}` : sql``;
  const activeGuard = input.audience === "sales" ? sql` AND q.status = 'active'` : sql``;
  const quoteGuard = input.quoteId ? sql` AND q.id = ${input.quoteId}` : sql``;
  // Repeat tenant/current-owner enforcement on the final reads: a transfer after preflight cannot leak quotes.
  const salesJoin = input.audience === "sales" ? sql`
    INNER JOIN crm_customers c ON c.id = q.customerId AND c.enterpriseId = q.enterpriseId
  ` : sql``;
  const salesOwnerGuard = input.audience === "sales" && !salesCanManageAll
    ? sql` AND c.assignedUserId = ${scope.actorUserId}` : sql``;
  const acceptanceSelect = sql`,
    accepted.id AS acceptanceId, accepted.createdAt AS acceptedAt,
    COALESCE(accepted_user.name, accepted_user.username, CONCAT('用户', accepted_user.id)) AS acceptedByName,
    (SELECT COUNT(*) FROM crm_customer_demand_quote_acceptances acceptance_history
      WHERE acceptance_history.enterpriseId = q.enterpriseId AND acceptance_history.quoteId = q.id) AS acceptanceHistoryCount
  `;
  const acceptanceJoin = sql`
    LEFT JOIN crm_customer_demand_quote_acceptances accepted
      ON accepted.enterpriseId = q.enterpriseId AND accepted.demandId = q.demandId AND accepted.quoteId = q.id
     AND accepted.demandRevision = d.revision AND accepted.quoteVersion = q.version
    LEFT JOIN users accepted_user ON accepted_user.id = accepted.acceptedByUserId
  `;
  const offset = (input.page - 1) * input.pageSize;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customer_demand_quotes q
      INNER JOIN crm_customer_demands d ON d.enterpriseId = q.enterpriseId AND d.id = q.demandId ${salesJoin}
     WHERE q.enterpriseId = ${scope.enterpriseId} AND q.demandId = ${input.demandId} ${quoteGuard} ${ownGuard} ${activeGuard} ${salesOwnerGuard}
  `))[0];
  const quotes = resultRows<QuoteRow>(await db.execute(sql`
    SELECT q.id, q.enterpriseId, q.customerId, q.demandId, q.procurementUserId, q.supplierName, q.note, q.status, q.withdrawnAt, q.version, q.demandRevision,
           d.revision AS currentDemandRevision, q.createdAt, q.updatedAt,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS procurementName
           ${acceptanceSelect}
      FROM crm_customer_demand_quotes q
      INNER JOIN crm_customer_demands d ON d.enterpriseId = q.enterpriseId AND d.id = q.demandId
      ${salesJoin} LEFT JOIN users u ON u.id = q.procurementUserId
      ${acceptanceJoin}
     WHERE q.enterpriseId = ${scope.enterpriseId} AND q.demandId = ${input.demandId} ${quoteGuard} ${ownGuard} ${activeGuard} ${salesOwnerGuard}
     ORDER BY q.updatedAt DESC, q.id DESC LIMIT ${input.pageSize} OFFSET ${offset}
  `));
  if (!quotes.length) return { items: [], total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
  const ids = quotes.map(quote => Number(quote.id));
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const items = resultRows<QuoteItemRow>(await db.execute(sql`
    SELECT qi.demandItemId, qi.partNumber, qi.brand, qi.pkg, qi.qtyUnit, qi.qty, qi.unitPrice, qi.leadTime, qi.note, qi.sortOrder, qi.quoteId,
           di.qty AS demandQty,
           COALESCE((SELECT SUM(current_accept_item.qty)
             FROM crm_customer_demand_quote_acceptances current_accept
             INNER JOIN crm_customer_demand_quote_acceptance_items current_accept_item
               ON current_accept_item.enterpriseId = current_accept.enterpriseId AND current_accept_item.acceptanceId = current_accept.id
              AND current_accept_item.demandItemId = qi.demandItemId
            WHERE current_accept.enterpriseId = qi.enterpriseId AND current_accept.demandId = qi.demandId
              AND current_accept.quoteId = qi.quoteId AND current_accept.quoteVersion = q.version
              AND current_accept.demandRevision = d.revision), 0) AS acceptedQty,
           COALESCE((SELECT SUM(other_accept_item.qty)
             FROM crm_customer_demand_quote_acceptances other_accept
             INNER JOIN crm_customer_demand_quote_acceptance_items other_accept_item
               ON other_accept_item.enterpriseId = other_accept.enterpriseId AND other_accept_item.acceptanceId = other_accept.id
              AND other_accept_item.demandItemId = qi.demandItemId
             INNER JOIN crm_customer_demand_quotes other_quote
               ON other_quote.enterpriseId = other_accept.enterpriseId AND other_quote.id = other_accept.quoteId
              AND other_quote.version = other_accept.quoteVersion AND other_quote.demandRevision = other_accept.demandRevision
              AND other_quote.status = 'active'
            WHERE other_accept.enterpriseId = qi.enterpriseId AND other_accept.demandId = qi.demandId
              AND other_accept.demandRevision = d.revision
              AND NOT (other_accept.quoteId = qi.quoteId AND other_accept.quoteVersion = q.version)), 0) AS otherAcceptedQty
      FROM crm_customer_demand_quote_items qi
      INNER JOIN crm_customer_demand_quotes q ON q.enterpriseId = qi.enterpriseId AND q.id = qi.quoteId
      INNER JOIN crm_customer_demands d ON d.enterpriseId = q.enterpriseId AND d.id = q.demandId
      INNER JOIN crm_customer_demand_items di ON di.enterpriseId = qi.enterpriseId AND di.demandId = qi.demandId AND di.id = qi.demandItemId
     WHERE qi.enterpriseId = ${scope.enterpriseId} AND qi.quoteId IN (${placeholders})
     ORDER BY qi.quoteId ASC, qi.sortOrder ASC, qi.id ASC
  `)) as (QuoteItemRow & { quoteId: number })[];
  const itemGroups = new Map<number, QuoteItemRow[]>();
  for (const item of items) {
    const key = Number(item.quoteId);
    const group = itemGroups.get(key) ?? [];
    group.push(item);
    itemGroups.set(key, group);
  }
  return {
    items: quotes.map(quote => {
      const mapped = mapQuote(quote, itemGroups.get(Number(quote.id)) ?? []);
      return input.audience === "sales" ? { ...mapped, supplierName: "" } : mapped;
    }),
    total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize,
  };
}

export { quotePayloadHash };
