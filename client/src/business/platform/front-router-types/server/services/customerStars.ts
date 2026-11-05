import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  customerSetStarSchema, customerSetStarResultSchema,
  customerStarStateInputSchema, customerStarStateSchema,
  type CustomerStarStateInput, type CustomerStarState,
  type CustomerSetStarInput, type CustomerSetStarResult, type CustomerStarContext,
} from "../../../shared/customerStars";
import { getDb } from "../db";
import { businessBoolean } from "./businessModuleAccess";
import {
  CRM_NOW, crmCustomerPolicyWhere, displayName, resolveCrmCustomerPolicy,
  type CrmAccessIdentity, type CrmModulePolicy, type CrmSqlExecutor,
} from "./crmCustomers";

type Member = { id: number; userId: number; name: string | null; status: string; loginDisabled: unknown };
type TeamMember = { id: number; userId: number; teamId: number; teamRole: string };
type Team = { id: number; status: string };
type LockedState = { members: Map<number, Member>; teamMembers: TeamMember[]; teams: Map<number, Team>; actorPolicy: CrmModulePolicy };
export type CustomerStarAccess = { actorPolicy: CrmModulePolicy; targetPolicy: CrmModulePolicy; targetUserId: number };
function rows<T>(result: unknown): T[] { return ((result as [T[], unknown])?.[0] ?? []); }
function fail(code: "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | "BAD_REQUEST", message: string): never { throw new TRPCError({ code, message }); }
function positive(value: number) { if (!Number.isSafeInteger(value) || value < 1) fail("FORBIDDEN", "当前企业或账号无效"); }
async function database() { const db = await getDb(); if (!db) fail("SERVICE_UNAVAILABLE", "个人星标数据库不可用"); return db; }
async function closed<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    // Missing sidecars/unknown SQL failures never fall back to browser storage or guessed permissions.
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "个人星标结构尚未就绪或操作失败" });
  }
}

/**
 * Independent personal-preference lock chain, read policy only. Enterprise first serializes
 * organization/member changes and native customer reassignments using the existing enterprise lock.
 * Then active memberships/users in membership id order -> team memberships -> teams -> current policies.
 * No canManageAll/admin/owner label is consulted for delegation and no permissions are written.
 */
async function lockState(tx: CrmSqlExecutor, scope: CrmAccessIdentity): Promise<LockedState> {
  positive(scope.enterpriseId); positive(scope.actorUserId);
  const enterprise = rows<{ id: number }>(await tx.execute(sql`
    SELECT id FROM enterprises WHERE id = ${scope.enterpriseId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!enterprise) fail("FORBIDDEN", "当前企业不可用");
  const members = rows<Member>(await tx.execute(sql`
    SELECT em.id, em.userId, em.status, u.loginDisabled,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS name
      FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
     WHERE em.enterpriseId = ${scope.enterpriseId} AND em.status = 'active'
     ORDER BY em.id FOR UPDATE
  `));
  const available = members.filter(member => member.status === "active" && !businessBoolean(member.loginDisabled));
  const memberMap = new Map(available.map(member => [Number(member.userId), member]));
  if (!memberMap.has(scope.actorUserId)) fail("FORBIDDEN", "当前企业成员不可用");
  const teamMembers = rows<TeamMember>(await tx.execute(sql`
    SELECT id, userId, teamId, teamRole FROM enterprise_team_members
     WHERE enterpriseId = ${scope.enterpriseId} ORDER BY id FOR UPDATE
  `));
  const teams = rows<Team>(await tx.execute(sql`
    SELECT id, status FROM enterprise_teams WHERE enterpriseId = ${scope.enterpriseId} ORDER BY id FOR UPDATE
  `));
  const actorPolicy = await resolveCrmCustomerPolicy(tx, scope, false);
  return { members: memberMap, teamMembers, teams: new Map(teams.map(team => [Number(team.id), team])), actorPolicy };
}
function uniqueTeam(state: LockedState, userId: number): TeamMember | undefined {
  const memberships = state.teamMembers.filter(member => Number(member.userId) === userId);
  if (memberships.length !== 1) return undefined;
  const membership = memberships[0];
  if (state.teams.get(Number(membership.teamId))?.status !== "active") return undefined;
  return membership;
}
function assertDelegation(state: LockedState, scope: CrmAccessIdentity, targetUserId: number) {
  positive(targetUserId);
  if (!state.members.has(targetUserId)) fail("FORBIDDEN", "星标目标不是当前企业的有效成员");
  if (targetUserId === scope.actorUserId) return;
  const actor = uniqueTeam(state, scope.actorUserId);
  const target = uniqueTeam(state, targetUserId);
  if (!actor || actor.teamRole !== "leader" || !target || target.teamRole !== "member" || Number(actor.teamId) !== Number(target.teamId)) {
    fail("FORBIDDEN", "仅本组当前显式组长可为本组组员设置个人星标");
  }
}
async function targetAccess(tx: CrmSqlExecutor, state: LockedState, scope: CrmAccessIdentity, targetUserId: number): Promise<CustomerStarAccess> {
  assertDelegation(state, scope, targetUserId);
  const targetPolicy = targetUserId === scope.actorUserId ? state.actorPolicy
    : await resolveCrmCustomerPolicy(tx, { enterpriseId: scope.enterpriseId, actorUserId: targetUserId }, false);
  return { actorPolicy: state.actorPolicy, targetPolicy, targetUserId };
}
/** For list: one locked authorization snapshot, before any sidecar is joined or data returned. */
export async function withCustomerStarAccess<T>(scope: CrmAccessIdentity, targetUserId: number,
  run: (tx: CrmSqlExecutor, access: CustomerStarAccess) => Promise<T>): Promise<T> {
  return closed(async () => (await database()).transaction(async tx => {
    const state = await lockState(tx, scope);
    return run(tx, await targetAccess(tx, state, scope, targetUserId));
  }));
}
/** Eligible target policies in one locked snapshot, never enterprise-write authority. */
export async function withCustomerAssigneeStarAccess<T>(scope: CrmAccessIdentity,
  run: (tx: CrmSqlExecutor, access: { actorPolicy: CrmModulePolicy; targets: CustomerStarAccess[] }) => Promise<T>): Promise<T> {
  return closed(async () => (await database()).transaction(async tx => {
    const state = await lockState(tx, scope);
    const targets: CustomerStarAccess[] = [];
    for (const userId of Array.from(state.members.keys()).sort((a, b) => a - b)) {
      try { targets.push(await targetAccess(tx, state, scope, userId)); }
      catch (error) { if (!(error instanceof TRPCError && error.code === "FORBIDDEN")) throw error; }
    }
    return run(tx, { actorPolicy: state.actorPolicy, targets });
  }));
}
/** Shared by projection, filtering and exact reads: both people's current read policy. */
export function customerAssigneeStarWhere(scope: CrmAccessIdentity, targets: CustomerStarAccess[]) {
  if (!targets.length) return sql`FALSE`;
  return sql`(${sql.join(targets.map(access => sql`(c.assignedUserId = ${access.targetUserId}
    AND ${crmCustomerPolicyWhere({ enterpriseId: scope.enterpriseId, actorUserId: access.targetUserId }, access.targetPolicy)})`), sql` OR `)})`;
}
export async function getCustomerStarState(scope: CrmAccessIdentity, raw: CustomerStarStateInput): Promise<CustomerStarState> {
  const checked = customerStarStateInputSchema.safeParse(raw);
  if (!checked.success) fail("BAD_REQUEST", "重点客户状态请求格式无效");
  const input = checked.data;
  if (input.expectedEnterpriseId !== scope.enterpriseId || input.expectedActorUserId !== scope.actorUserId) {
    fail("FORBIDDEN", "账号或企业已切换，请刷新后重试");
  }
  return withCustomerAssigneeStarAccess(scope, async (tx, access) => {
    const permitted = customerAssigneeStarWhere(scope, access.targets);
    const row = rows<{ id: number; assignedUserId: number | null; isStarred: unknown; starRevision: number; canSetStar: unknown }>(await tx.execute(sql`
      SELECT c.id, c.assignedUserId, COALESCE(star_pref.starred, 0) AS isStarred,
        COALESCE(star_pref.revision, 0) AS starRevision, (${permitted}) AS canSetStar
      FROM crm_customers c LEFT JOIN crm_customer_star_preferences star_pref
        ON star_pref.enterpriseId = c.enterpriseId AND star_pref.customerId = c.id
        AND star_pref.userId = c.assignedUserId AND ${permitted}
      WHERE c.id = ${input.customerId} AND ${crmCustomerPolicyWhere(scope, access.actorPolicy)} LIMIT 1
    `))[0];
    if (!row) fail("NOT_FOUND", "客户不存在");
    const assignedUserId = Number.isSafeInteger(Number(row.assignedUserId)) && Number(row.assignedUserId) > 0 ? Number(row.assignedUserId) : null;
    const canSetStar = assignedUserId !== null && businessBoolean(row.canSetStar);
    return customerStarStateSchema.parse({ enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId,
      customerId: Number(row.id), assignedUserId, starUserId: assignedUserId,
      isStarred: canSetStar && businessBoolean(row.isStarred), starRevision: canSetStar ? Number(row.starRevision ?? 0) : 0, canSetStar });
  });
}
export async function getCustomerStarContext(scope: CrmAccessIdentity): Promise<CustomerStarContext> {
  return closed(async () => (await database()).transaction(async tx => {
    const state = await lockState(tx, scope);
    const actor = state.members.get(scope.actorUserId)!;
    const targets = [{ userId: scope.actorUserId, name: displayName(actor.name, scope.actorUserId) }];
    const actorTeam = uniqueTeam(state, scope.actorUserId);
    if (actorTeam?.teamRole === "leader") {
      const candidates = Array.from(state.members.keys()).filter(userId => userId !== scope.actorUserId).sort((a, b) => a - b);
      for (const userId of candidates) {
        const team = uniqueTeam(state, userId);
        if (team?.teamRole !== "member" || Number(team.teamId) !== Number(actorTeam.teamId)) continue;
        const policy = await resolveCrmCustomerPolicy(tx, { enterpriseId: scope.enterpriseId, actorUserId: userId }, false).catch(error => {
          if (error instanceof TRPCError && error.code === "FORBIDDEN") return null;
          throw error;
        });
        if (policy?.read) targets.push({ userId, name: displayName(state.members.get(userId)!.name, userId) });
      }
    }
    return { enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, targets };
  }));
}
export function customerStarPayloadHash(input: CustomerSetStarInput): string {
  const payload = {
    customerId: input.customerId, targetUserId: input.targetUserId, starred: input.starred,
    expectedRevision: input.expectedRevision, requestId: input.requestId,
    expectedEnterpriseId: input.expectedEnterpriseId, expectedActorUserId: input.expectedActorUserId,
    ...(input.starMode ? { starMode: input.starMode } : {}),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
export async function setCustomerStar(scope: CrmAccessIdentity, raw: CustomerSetStarInput): Promise<CustomerSetStarResult> {
  const checked = customerSetStarSchema.safeParse(raw);
  if (!checked.success) fail("BAD_REQUEST", "个人星标请求格式无效");
  const input = checked.data;
  // Expected context is a stale-tab guard, not the authenticated authority.
  if (input.expectedEnterpriseId !== scope.enterpriseId || input.expectedActorUserId !== scope.actorUserId) {
    fail("FORBIDDEN", "账号或企业已切换，请刷新后重试");
  }
  const payloadHash = customerStarPayloadHash(input);
  return withCustomerStarAccess(scope, input.targetUserId, async (tx, access) => {
    // Policy -> customer -> preference/request. Current native assignee + frozen record team
    // are evaluated for BOTH people on every write AND replay, before receipt access.
    const customer = rows<{ id: number }>(await tx.execute(sql`
      SELECT c.id FROM crm_customers c WHERE c.enterpriseId = ${scope.enterpriseId} AND c.id = ${input.customerId}
        AND ${crmCustomerPolicyWhere(scope, access.actorPolicy)}
        AND ${crmCustomerPolicyWhere({ enterpriseId: scope.enterpriseId, actorUserId: input.targetUserId }, access.targetPolicy)}
        ${input.starMode === "assignee" ? sql`AND c.assignedUserId = ${input.targetUserId}` : sql``}
      LIMIT 1 FOR UPDATE
    `))[0];
    if (!customer) fail("NOT_FOUND", "客户不存在");
    const preference = rows<{ starred: unknown; revision: number }>(await tx.execute(sql`
      SELECT starred, revision FROM crm_customer_star_preferences
       WHERE enterpriseId = ${scope.enterpriseId} AND userId = ${input.targetUserId} AND customerId = ${input.customerId}
       LIMIT 1 FOR UPDATE
    `))[0];
    const previous = rows<{ payloadHash: string; targetUserId: number; customerId: number; resultJson: string }>(await tx.execute(sql`
      SELECT payloadHash, targetUserId, customerId, resultJson FROM crm_customer_star_requests
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
       LIMIT 1 FOR UPDATE
    `))[0];
    if (previous) {
      if (previous.payloadHash !== payloadHash || Number(previous.targetUserId) !== input.targetUserId || Number(previous.customerId) !== input.customerId) {
        fail("CONFLICT", "请求号已用于不同的星标内容");
      }
      const saved = customerSetStarResultSchema.parse(JSON.parse(previous.resultJson));
      if (saved.customerId !== input.customerId || saved.targetUserId !== input.targetUserId || saved.requestId !== input.requestId) fail("SERVICE_UNAVAILABLE", "星标回执结构无效");
      return { ...saved, idempotent: true };
    }
    const actualRevision = Number(preference?.revision ?? 0);
    if (actualRevision !== input.expectedRevision || actualRevision >= 2147483647) fail("CONFLICT", "星标已被更新，请刷新后重试");
    const nextRevision = actualRevision + 1;
    if (!preference) {
      await tx.execute(sql`INSERT INTO crm_customer_star_preferences (enterpriseId, userId, customerId, starred, revision, updatedAt)
        VALUES (${scope.enterpriseId}, ${input.targetUserId}, ${input.customerId}, ${input.starred}, ${nextRevision}, ${CRM_NOW})`);
    } else {
      const result = await tx.execute(sql`UPDATE crm_customer_star_preferences SET starred = ${input.starred}, revision = ${nextRevision}, updatedAt = ${CRM_NOW}
        WHERE enterpriseId = ${scope.enterpriseId} AND userId = ${input.targetUserId} AND customerId = ${input.customerId} AND revision = ${input.expectedRevision}`);
      if (Number((result as [{ affectedRows?: number }, unknown])[0]?.affectedRows) !== 1) fail("CONFLICT", "星标已被更新，请刷新后重试");
    }
    const result: CustomerSetStarResult = {
      customerId: input.customerId, targetUserId: input.targetUserId, isStarred: input.starred,
      starRevision: nextRevision, requestId: input.requestId, idempotent: false,
    };
    // Sidecar receipt is also the durable audit; no generic audit/platform table or customer DML.
    const auditPayload = JSON.stringify({
      actorUserId: scope.actorUserId, enterpriseId: scope.enterpriseId, targetUserId: input.targetUserId,
      customerId: input.customerId, input, before: { isStarred: businessBoolean(preference?.starred), starRevision: actualRevision }, result,
    });
    await tx.execute(sql`INSERT INTO crm_customer_star_requests
      (enterpriseId, actorUserId, requestId, targetUserId, customerId, payloadHash, auditPayload, resultJson, completedAt)
      VALUES (${scope.enterpriseId}, ${scope.actorUserId}, ${input.requestId}, ${input.targetUserId}, ${input.customerId}, ${payloadHash}, ${auditPayload}, ${JSON.stringify(result)}, ${CRM_NOW})`);
    return result;
  });
}
