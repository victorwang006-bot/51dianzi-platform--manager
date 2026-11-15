import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { normalizeErpPermissions } from "../../../shared/erpPermissions";
import type { InboundProcurementBuyers, InboundProcurementBuyerOption } from "../../../shared/inboundProcurement";
import { acquireFactoryReceptionAdminLease } from "../adminDb";

export interface InboundProcurementExecutor { execute(query: SQL): Promise<unknown> }
export type InboundProcurementIdentity = {
  enterpriseId: number; ownerUserId: number; actorUserId: number;
  /** Only extracted from server-created staffDelegation, never input DTOs. */
  adminAccountId?: number; bindingVersion?: number;
};
type BoundStaff = InboundProcurementBuyerOption & { adminUserId: number; staffTeamId: number; role: "leader" | "member"; bindingVersion: number };
export type InboundProcurementAccess = InboundProcurementIdentity & {
  scope: "self" | "team" | "enterprise"; teamId: number | null;
  staffTeamId: number; actorAdminUserId: number; staffRoster: BoundStaff[]; canReadLegacy: boolean;
};
type Membership = InboundProcurementBuyerOption & { teamId: number | null; teamRole: string | null; memberRole: string; adminUserId?: number; staffTeamId?: number };
const rows = (value: unknown): Record<string, any>[] => {
  if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error("Invalid procurement SQL response");
  return value[0];
};
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const unavailable = (cause: unknown) => new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "采购入库权限结构尚未就绪，请联系管理员", cause });
const missing = () => new TRPCError({ code: "NOT_FOUND", message: "入库单不存在" });

/** Reuse the ACTUAL CRM permission context. Only server-created delegation carries admin identity. */
export function inboundProcurementIdentity(ctx: {
  user: { id: number }; effectiveUserId?: number;
  enterprisePermissionScope?: { enterprise: { id: number }; dataOwnerUserId: number };
  staffDelegation?: { kind: string; staffUserId: number; enterpriseId: number; adminAccountId: number; bindingVersion: number };
}): InboundProcurementIdentity {
  const permission = ctx.enterprisePermissionScope;
  if (!permission || !positiveId(permission.enterprise.id) || !positiveId(permission.dataOwnerUserId)
    || !positiveId(ctx.user.id) || ctx.effectiveUserId !== permission.dataOwnerUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "采购入库企业归属无法确认" });
  }
  const delegation = ctx.staffDelegation;
  if (delegation && (delegation.kind !== "business_bff" || delegation.staffUserId !== ctx.user.id || delegation.enterpriseId !== permission.enterprise.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "采购入库后台员工绑定主体不一致" });
  }
  return { enterpriseId: permission.enterprise.id, ownerUserId: permission.dataOwnerUserId, actorUserId: ctx.user.id,
    ...(delegation ? { adminAccountId: delegation.adminAccountId, bindingVersion: delegation.bindingVersion } : {}) };
}

/** SELECT-only current staff snapshot. No name search, no ID equality across team namespaces,
 * no relationship writes and no added personnel grant. The BFF already holds its actor/binding
 * fence across this native call: taking a second cross-DB actor lock would self-deadlock it.
 * Target front membership is independently revalidated/locked in the ORIGINAL inbound tx. */
export async function readBoundInboundStaff(identity: InboundProcurementIdentity): Promise<{ actor: BoundStaff; roster: BoundStaff[] }> {
  const lease = await acquireFactoryReceptionAdminLease();
  try {
    const select = `SELECT a.id AS adminUserId, b.frontUserId AS userId, b.bindingVersion,
      COALESCE(NULLIF(TRIM(a.displayName), ''), a.username) AS name, a.username,
      m.teamId AS staffTeamId, m.role
      FROM admin_users a
      INNER JOIN admin_business_staff_bindings b ON b.adminUserId = a.id AND b.status = 'active'
      INNER JOIN admin_organization_members m ON m.adminUserId = a.id AND m.role IN ('leader', 'member')
      INNER JOIN admin_organization_teams t ON t.id = m.teamId AND t.status = 'active'
      WHERE a.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM admin_staff_archives archived WHERE archived.adminUserId = a.id)
        AND NOT EXISTS (SELECT 1 FROM admin_business_staff_bindings duplicate_b
          WHERE duplicate_b.status = 'active' AND duplicate_b.id <> b.id
            AND (duplicate_b.adminUserId = b.adminUserId OR duplicate_b.frontUserId = b.frontUserId))`;
    const actorRows = await lease.query(select + " AND b.frontUserId = ? LIMIT 2", [identity.actorUserId]);
    const decode = (row: Record<string, unknown>): BoundStaff => {
      const staff = { adminUserId: Number(row.adminUserId), userId: Number(row.userId), staffTeamId: Number(row.staffTeamId), bindingVersion: Number(row.bindingVersion), role: row.role as "leader" | "member", name: String(row.name ?? "").trim(), username: String(row.username ?? "") };
      if (![staff.adminUserId, staff.userId, staff.staffTeamId, staff.bindingVersion].every(positiveId)
        || !["leader", "member"].includes(staff.role) || !staff.name || staff.name.length > 64) throw new Error("Invalid bound inbound staff");
      return staff;
    };
    if (actorRows.length !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "不是当前在职且有唯一业务组绑定的后台员工" });
    const actor = decode(actorRows[0]);
    if (identity.adminAccountId !== undefined && identity.adminAccountId !== actor.adminUserId
      || identity.bindingVersion !== undefined && identity.bindingVersion !== actor.bindingVersion) {
      throw new TRPCError({ code: "FORBIDDEN", message: "采购入库后台员工绑定已变化" });
    }
    const peerRows = await lease.query(select + " AND m.teamId = ? ORDER BY b.frontUserId LIMIT 501", [actor.staffTeamId]);
    if (peerRows.length > 500) throw new Error("Inbound staff team exceeds safe read cap");
    const roster = peerRows.map(decode);
    if (!roster.some(peer => peer.userId === actor.userId && peer.adminUserId === actor.adminUserId && peer.bindingVersion === actor.bindingVersion && peer.staffTeamId === actor.staffTeamId && peer.role === actor.role)
      || new Set(roster.map(peer => peer.userId)).size !== roster.length) throw new TRPCError({ code: "FORBIDDEN", message: "采购入库团队或员工绑定已变化" });
    return { actor, roster };
  } finally { await lease.release(); }
}

async function loadMembership(executor: InboundProcurementExecutor, identity: InboundProcurementIdentity, userId: number, lock: boolean): Promise<Membership | null> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const members = rows(await executor.execute(sql`
    SELECT em.id, em.role AS memberRole, u.id AS userId, u.name, u.username
    FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
    WHERE em.enterpriseId = ${identity.enterpriseId} AND em.userId = ${userId}
      AND em.status = 'active' AND COALESCE(u.loginDisabled, 0) = 0${suffix}
  `));
  if (members.length !== 1) return null;
  const memberships = rows(await executor.execute(sql`
    SELECT tm.teamId, tm.teamRole FROM enterprise_team_members tm
    WHERE tm.enterpriseId = ${identity.enterpriseId} AND tm.userId = ${userId}${suffix}
  `));
  if (memberships.length > 1) throw new TRPCError({ code: "FORBIDDEN", message: "采购员团队归属不唯一" });
  let teamId: number | null = null, teamRole: string | null = null;
  if (memberships.length === 1) {
    const candidate = Number(memberships[0].teamId);
    const teams = rows(await executor.execute(sql`
      SELECT id FROM enterprise_teams WHERE enterpriseId = ${identity.enterpriseId}
        AND id = ${candidate} AND status = 'active'${suffix}
    `));
    if (positiveId(candidate) && teams.length === 1 && ["leader", "member"].includes(memberships[0].teamRole)) {
      teamId = candidate; teamRole = memberships[0].teamRole;
    }
  }
  const member = members[0];
  return { userId, name: String(member.name || member.username || ""), ...(member.username ? { username: String(member.username) } : {}), teamId, teamRole, memberRole: String(member.memberRole) };
}

/** Authoritative dual identity intersected with the selected enterprise; no owner/admin-role group expansion. */
export async function resolveInboundProcurementAccess(executor: InboundProcurementExecutor, identity: InboundProcurementIdentity | undefined, lock = false): Promise<InboundProcurementAccess> {
  if (!identity || !positiveId(identity.enterpriseId) || !positiveId(identity.ownerUserId) || !positiveId(identity.actorUserId)) throw new TRPCError({ code: "FORBIDDEN", message: "采购入库企业归属无法确认" });
  try {
    const suffix = lock ? sql` FOR UPDATE` : sql``;
    await executor.execute(sql`SELECT inboundOrderId, enterpriseId, ownerUserId, buyerUserId, teamId, recordedByUserId, staffTeamId, buyerAdminUserId, recordedByAdminUserId, createdAt FROM inbound_procurement_owners WHERE 1 = 0`);
    const enterprises = rows(await executor.execute(sql`
      SELECT id, superAdminUserId, crmDataOwnerUserId FROM enterprises
      WHERE crmDataOwnerUserId = ${identity.ownerUserId} ORDER BY id${suffix}
    `));
    if (enterprises.length !== 1 || Number(enterprises[0].id) !== identity.enterpriseId) throw new TRPCError({ code: "FORBIDDEN", message: "采购入库企业数据归属不唯一或已变化" });
    const actor = await loadMembership(executor, identity, identity.actorUserId, lock);
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "不是当前企业的在职有效员工" });
    const isOwner = actor.memberRole === "super_admin" && Number(enterprises[0].superAdminUserId) === identity.actorUserId;
    const permissions = rows(await executor.execute(sql`
      SELECT p.permissionKey FROM enterprise_member_permissions p
      INNER JOIN enterprise_members em ON em.id = p.enterpriseMemberId
      WHERE em.enterpriseId = ${identity.enterpriseId} AND em.userId = ${identity.actorUserId}${suffix}
    `)).map(row => String(row.permissionKey));
    if (!isOwner && !normalizeErpPermissions(permissions).includes("inventory.inbound")) throw new TRPCError({ code: "FORBIDDEN", message: "您没有采购入库权限" });
    const staff = await readBoundInboundStaff(identity);
    return { ...identity, teamId: actor.teamId, scope: actor.teamId && staff.actor.role === "leader" ? "team" : "self",
      staffTeamId: staff.actor.staffTeamId, actorAdminUserId: staff.actor.adminUserId, staffRoster: staff.roster, canReadLegacy: isOwner };
  } catch (error) { if (error instanceof TRPCError) throw error; throw unavailable(error); }
}

/** One predicate for all read surfaces and original-transaction write fences. Legacy is read-only. */
export function inboundProcurementWhere(access: InboundProcurementAccess, alias = "io"): SQL {
  if (!["io", "inbound_orders"].includes(alias)) throw new Error("Invalid inbound alias");
  const id = sql.raw(`${alias}.id`), owner = sql.raw(`${alias}.userId`);
  const bound = sql`ipo.inboundOrderId = ${id} AND ipo.enterpriseId = ${access.enterpriseId} AND ipo.ownerUserId = ${access.ownerUserId}`;
  const liveActor = sql`EXISTS (SELECT 1 FROM enterprise_members actor_em
    INNER JOIN users actor_u ON actor_u.id = actor_em.userId AND COALESCE(actor_u.loginDisabled, 0) = 0
    WHERE actor_em.enterpriseId = ${access.enterpriseId} AND actor_em.userId = ${access.actorUserId} AND actor_em.status = 'active')`;
  const currentBindings = access.staffRoster.filter(peer => access.scope !== "self" || peer.userId === access.actorUserId);
  const pairs = currentBindings.length ? sql`(${sql.join(currentBindings.map(peer => sql`(ipo.buyerUserId = ${peer.userId} AND ipo.buyerAdminUserId = ${peer.adminUserId})`), sql` OR `)})` : sql`FALSE`;
  const uniqueOwner = sql`(SELECT COUNT(*) FROM inbound_procurement_owners unique_ipo WHERE unique_ipo.inboundOrderId = ${id}) = 1`;
  const buyer = access.scope === "self" ? sql`ipo.buyerUserId = ${access.actorUserId}` : sql`
    ipo.teamId = ${access.teamId} AND EXISTS (
      SELECT 1 FROM enterprise_team_members buyer_tm
      INNER JOIN enterprise_teams buyer_t ON buyer_t.id = buyer_tm.teamId AND buyer_t.enterpriseId = buyer_tm.enterpriseId AND buyer_t.status = 'active'
      INNER JOIN enterprise_members buyer_em ON buyer_em.enterpriseId = buyer_tm.enterpriseId AND buyer_em.userId = buyer_tm.userId AND buyer_em.status = 'active'
      INNER JOIN users buyer_u ON buyer_u.id = buyer_em.userId AND COALESCE(buyer_u.loginDisabled, 0) = 0
      WHERE buyer_tm.enterpriseId = ipo.enterpriseId AND buyer_tm.userId = ipo.buyerUserId AND buyer_tm.teamId = ipo.teamId AND buyer_tm.teamRole IN ('leader', 'member')
      AND NOT EXISTS (SELECT 1 FROM enterprise_team_members duplicate_tm WHERE duplicate_tm.enterpriseId = buyer_tm.enterpriseId AND duplicate_tm.userId = buyer_tm.userId AND duplicate_tm.id <> buyer_tm.id)
    ) AND EXISTS (SELECT 1 FROM enterprise_team_members actor_tm
      INNER JOIN enterprise_teams actor_t ON actor_t.id = actor_tm.teamId AND actor_t.enterpriseId = actor_tm.enterpriseId AND actor_t.status = 'active'
      WHERE actor_tm.enterpriseId = ${access.enterpriseId} AND actor_tm.userId = ${access.actorUserId} AND actor_tm.teamId = ${access.teamId})`;
  const owned = sql`${uniqueOwner} AND EXISTS (SELECT 1 FROM inbound_procurement_owners ipo WHERE ${bound} AND ipo.staffTeamId = ${access.staffTeamId} AND ${pairs} AND ${buyer})`;
  const legacy = access.canReadLegacy ? sql`NOT EXISTS (SELECT 1 FROM inbound_procurement_owners legacy_ipo WHERE legacy_ipo.inboundOrderId = ${id})
    AND EXISTS (SELECT 1 FROM enterprise_members legacy_em INNER JOIN enterprises legacy_e ON legacy_e.id = legacy_em.enterpriseId
      WHERE legacy_em.enterpriseId = ${access.enterpriseId} AND legacy_em.userId = ${access.actorUserId} AND legacy_em.status = 'active' AND legacy_em.role = 'super_admin' AND legacy_e.superAdminUserId = legacy_em.userId AND legacy_e.crmDataOwnerUserId = ${access.ownerUserId})` : sql`FALSE`;
  return sql`${owner} = ${access.ownerUserId} AND ${liveActor} AND ((${owned}) OR (${legacy}))`;
}

export async function resolveInboundBuyerInTx(executor: InboundProcurementExecutor, access: InboundProcurementAccess, buyerUserId?: number): Promise<Membership> {
  const id = buyerUserId ?? access.actorUserId;
  const staff = access.staffRoster.find(peer => peer.userId === id);
  if (!positiveId(id) || !access.teamId || !staff || access.scope === "self" && id !== access.actorUserId) throw new TRPCError({ code: "FORBIDDEN", message: "采购员必须是当前有效业务团队绑定员工，普通员工只能录入本人" });
  try {
    const buyer = await loadMembership(executor, access, id, true);
    if (!buyer?.teamId || buyer.teamId !== access.teamId || staff.staffTeamId !== access.staffTeamId) throw new TRPCError({ code: "FORBIDDEN", message: "采购员不在当前可录入的有效团队内" });
    return { ...buyer, name: staff.name, username: staff.username, adminUserId: staff.adminUserId, staffTeamId: staff.staffTeamId };
  } catch (error) { if (error instanceof TRPCError) throw error; throw unavailable(error); }
}

export async function saveInboundProcurementOwnerInTx(executor: InboundProcurementExecutor, access: InboundProcurementAccess, inboundOrderId: number, buyer: Membership) {
  if (!positiveId(buyer.adminUserId) || !positiveId(buyer.staffTeamId)) throw new TRPCError({ code: "FORBIDDEN", message: "采购员后台绑定快照无法确认" });
  await executor.execute(sql`INSERT INTO inbound_procurement_owners
    (inboundOrderId, enterpriseId, ownerUserId, buyerUserId, teamId, recordedByUserId, staffTeamId, buyerAdminUserId, recordedByAdminUserId)
    VALUES (${inboundOrderId}, ${access.enterpriseId}, ${access.ownerUserId}, ${buyer.userId}, ${buyer.teamId}, ${access.actorUserId}, ${buyer.staffTeamId}, ${buyer.adminUserId}, ${access.actorAdminUserId})`);
}

/** Lock order, immutable attribution and current target enterprise/team before original payment/ledger/CAS writes. */
export async function lockInboundProcurementOrder(executor: InboundProcurementExecutor, access: InboundProcurementAccess, id: number): Promise<{ buyerUserId: number | null }> {
  const result = rows(await executor.execute(sql`SELECT io.id FROM inbound_orders io WHERE io.id = ${id} AND ${inboundProcurementWhere(access)} LIMIT 1 FOR UPDATE`));
  if (result.length !== 1) throw missing();
  const owners = rows(await executor.execute(sql`SELECT buyerUserId, teamId, enterpriseId, ownerUserId, staffTeamId, buyerAdminUserId FROM inbound_procurement_owners WHERE inboundOrderId = ${id} FOR UPDATE`));
  if (owners.length !== 1) throw missing(); // no write/reassignment of unowned historical rows, even for an owner
  const owner = owners[0];
  const bound = access.staffRoster.find(peer => peer.userId === Number(owner.buyerUserId) && peer.adminUserId === Number(owner.buyerAdminUserId));
  if (!bound || Number(owner.staffTeamId) !== access.staffTeamId) throw missing();
  const buyer = await loadMembership(executor, access, Number(owner.buyerUserId), true);
  if (!buyer?.teamId || buyer.teamId !== access.teamId || access.scope === "team" && Number(owner.teamId) !== access.teamId) throw missing();
  const checked = rows(await executor.execute(sql`SELECT io.id FROM inbound_orders io WHERE io.id = ${id} AND ${inboundProcurementWhere(access)} LIMIT 1 FOR UPDATE`));
  if (checked.length !== 1) throw missing();
  return { buyerUserId: Number(owner.buyerUserId) };
}

export function assertInboundBuyerUnchanged(original: number | null, submitted?: number) {
  if (submitted !== undefined && submitted !== original) throw new TRPCError({ code: "BAD_REQUEST", message: "采购员创建后不可重新分配" });
}

export async function procurementBuyerOptions(executor: InboundProcurementExecutor, identity: InboundProcurementIdentity): Promise<InboundProcurementBuyers> {
  const access = await resolveInboundProcurementAccess(executor, identity);
  try {
    const options: InboundProcurementBuyerOption[] = [];
    for (const peer of access.staffRoster) {
      if (access.scope === "self" && peer.userId !== access.actorUserId) continue;
      const member = await loadMembership(executor, access, peer.userId, false);
      if (member?.teamId && member.teamId === access.teamId) options.push({ userId: peer.userId, name: peer.name, ...(peer.username ? { username: peer.username } : {}) });
    }
    return { actorUserId: access.actorUserId, canChooseBuyer: access.scope === "team", teamId: access.teamId, options, scope: access.scope };
  } catch (error) { if (error instanceof TRPCError) throw error; throw unavailable(error); }
}
