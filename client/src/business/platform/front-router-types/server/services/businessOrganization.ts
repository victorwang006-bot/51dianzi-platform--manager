import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import {
  BUSINESS_ACCESS_TEMPLATES, BUSINESS_MODULES, BUSINESS_TEMPLATE_VERSION,
  businessAuditSchema, businessCreateTeamSchema, businessSetMemberSchema,
  businessUpdateMemberAccessSchema, businessUpdateTeamSchema,
  type BusinessCreateTeamInput, type BusinessModule, type BusinessOrganizationOverview,
  type BusinessSetMemberInput, type BusinessUpdateAccessResult, type BusinessUpdateMemberAccessInput,
  type BusinessUpdateTeamInput,
} from "../../../shared/businessOrganization";
import { normalizeErpPermissions } from "../../../shared/erpPermissions";
import { getDb } from "../db";
import {
  businessBoolean, businessIsOwner, businessModuleEntitled, businessRows,
  resolveBusinessModuleAccess, type BusinessSqlExecutor,
} from "./businessModuleAccess";

export interface BusinessOrganizationDatabase extends BusinessSqlExecutor {
  transaction<T>(work: (tx: BusinessSqlExecutor) => Promise<T>): Promise<T>;
}
type Dependencies = { getDb: () => Promise<BusinessOrganizationDatabase | null> };
type Row = Record<string, any>;
type Context = { actorUserId: number; enterpriseId: number; enterprise: Row; member: Row; isOwner: boolean };
function fail(code: "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "SERVICE_UNAVAILABLE", message: string): never { throw new TRPCError({ code, message }); }
export function canonicalBusinessPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalBusinessPayload);
  return Object.fromEntries(Object.entries(value as object).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalBusinessPayload(v)]));
}
export function businessPayloadHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonicalBusinessPayload(value))).digest("hex"); }
function json(value: unknown): string { return JSON.stringify(value); }
function parseJson(value: any): any { return typeof value === "string" ? JSON.parse(value) : value; }
function header(result: unknown): Row { return (Array.isArray(result) ? result[0] : result) as Row; }
async function one(tx: BusinessSqlExecutor, query: SQL): Promise<Row | undefined> { return businessRows(await tx.execute(query))[0]; }
function cas(actual: unknown, expected: number): void { if (Number(actual) !== expected) fail("CONFLICT", "数据版本已变化，请刷新后重试"); }
function positive(value: number): void { if (!Number.isSafeInteger(value) || value < 1) fail("FORBIDDEN", "企业或账号无效"); }
function safeTeamRole(value: unknown): "leader" | "member" | null { return value === "leader" || value === "member" ? value : null; }

export function createBusinessOrganizationService(deps: Dependencies = { getDb }) {
  async function database(): Promise<BusinessOrganizationDatabase> {
    const db = await deps.getDb();
    if (!db) fail("SERVICE_UNAVAILABLE", "业务组织数据库不可用");
    return db;
  }
  async function authority(tx: BusinessSqlExecutor, actorUserId: number, enterpriseId: number, ownerOnly: boolean, lock: boolean): Promise<Context> {
    positive(actorUserId); positive(enterpriseId);
    const suffix = lock ? sql` FOR UPDATE` : sql``;
    // Global lock order: enterprise -> actor/target enterprise membership -> team membership -> teams -> module rows.
    const enterprise = await one(tx, sql`SELECT id, companyName, superAdminUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1${suffix}`);
    const member = await one(tx, sql`SELECT em.id, em.userId, em.role, em.status, em.permissionVersion, u.loginDisabled FROM enterprise_members em INNER JOIN users u ON u.id = em.userId WHERE em.enterpriseId = ${enterpriseId} AND em.userId = ${actorUserId} LIMIT 1${suffix}`);
    if (!enterprise || !member || member.status !== "active" || businessBoolean(member.loginDisabled)) fail("FORBIDDEN", "不是当前企业的有效成员");
    const isOwner = businessIsOwner(member, enterprise);
    if (ownerOnly && !isOwner) fail("FORBIDDEN", "仅当前前台企业所有者可管理业务组织");
    return { actorUserId, enterpriseId, enterprise, member, isOwner };
  }
  async function target(tx: BusinessSqlExecutor, enterpriseId: number, userId: number): Promise<Row> {
    const member = await one(tx, sql`SELECT em.id, em.userId, em.role, em.status, em.permissionVersion, u.loginDisabled FROM enterprise_members em INNER JOIN users u ON u.id = em.userId WHERE em.enterpriseId = ${enterpriseId} AND em.userId = ${userId} LIMIT 1 FOR UPDATE`);
    if (!member || member.status !== "active" || businessBoolean(member.loginDisabled)) fail("FORBIDDEN", "目标不是当前企业的有效成员");
    return member;
  }
  async function membership(tx: BusinessSqlExecutor, enterpriseId: number, userId: number): Promise<Row | undefined> {
    return one(tx, sql`SELECT id, teamId, teamRole, dataScope FROM enterprise_team_members WHERE enterpriseId = ${enterpriseId} AND userId = ${userId} LIMIT 1 FOR UPDATE`);
  }
  async function team(tx: BusinessSqlExecutor, enterpriseId: number, teamId: number): Promise<Row> {
    const row = await one(tx, sql`SELECT id, enterpriseId, name, notes, status, revision, leaderUserId FROM enterprise_teams WHERE enterpriseId = ${enterpriseId} AND id = ${teamId} LIMIT 1 FOR UPDATE`);
    if (!row || row.status !== "active") fail("FORBIDDEN", "团队不是当前企业的有效团队");
    return row;
  }
  async function event(tx: BusinessSqlExecutor, c: Context, action: string, requestId: string, payloadHash: string, detail: { targetUserId?: number; teamId?: number | null; module?: BusinessModule; before: unknown; after: unknown; templateId?: string }) {
    await tx.execute(sql`INSERT INTO enterprise_business_organization_audit (enterpriseId, actorUserId, targetUserId, teamId, module, action, requestId, payloadHash, templateId, templateVersion, beforeData, afterData) VALUES (${c.enterpriseId}, ${c.actorUserId}, ${detail.targetUserId ?? null}, ${detail.teamId ?? null}, ${detail.module ?? null}, ${action}, ${requestId}, ${payloadHash}, ${detail.templateId ?? null}, ${detail.templateId ? BUSINESS_TEMPLATE_VERSION : null}, ${json(detail.before)}, ${json(detail.after)})`);
  }
  async function mutate<T extends { success: true; idempotent: boolean }>(actorUserId: number, enterpriseId: number, action: string, input: { requestId: string }, work: (tx: BusinessSqlExecutor, c: Context, hash: string) => Promise<T>): Promise<T> {
    const db = await database();
    const hash = businessPayloadHash({ action, input });
    return db.transaction(async tx => {
      const c = await authority(tx, actorUserId, enterpriseId, true, true);
      const previous = await one(tx, sql`SELECT action, payloadHash, result FROM enterprise_business_organization_requests WHERE enterpriseId = ${enterpriseId} AND actorUserId = ${actorUserId} AND requestId = ${input.requestId} LIMIT 1 FOR UPDATE`);
      if (previous) {
        if (previous.action !== action || previous.payloadHash !== hash) fail("CONFLICT", "请求号已用于不同操作或不同内容");
        return { ...parseJson(previous.result), idempotent: true } as T;
      }
      const result = await work(tx, c, hash);
      await tx.execute(sql`INSERT INTO enterprise_business_organization_requests (enterpriseId, actorUserId, requestId, payloadHash, action, result) VALUES (${enterpriseId}, ${actorUserId}, ${input.requestId}, ${hash}, ${action}, ${json(result)})`);
      return result;
    });
  }

  async function overview(actorUserId: number, enterpriseId: number): Promise<BusinessOrganizationOverview> {
    const db = await database();
    // One snapshot, not a cached permission projection; no coworker PII is selected for non-owners.
    return db.transaction(async tx => {
      const c = await authority(tx, actorUserId, enterpriseId, false, true);
      const memberFilter = c.isOwner ? sql`` : sql` AND em.userId = ${actorUserId}`;
      const memberRows = businessRows(await tx.execute(sql`SELECT em.userId, em.role, em.status, em.permissionVersion, u.username, u.name, u.loginDisabled, tm.teamId, tm.teamRole, t.revision AS teamRevision, t.status AS teamStatus FROM enterprise_members em INNER JOIN users u ON u.id = em.userId LEFT JOIN enterprise_team_members tm ON tm.enterpriseId = em.enterpriseId AND tm.userId = em.userId LEFT JOIN enterprise_teams t ON t.enterpriseId = tm.enterpriseId AND t.id = tm.teamId WHERE em.enterpriseId = ${enterpriseId}${memberFilter} ORDER BY em.userId`));
      const ownTeamId = memberRows.find(row => Number(row.userId) === actorUserId && row.teamStatus === "active")?.teamId;
      const teamFilter = c.isOwner ? sql`` : ownTeamId ? sql` AND id = ${Number(ownTeamId)} AND status = 'active'` : sql` AND 1 = 0`;
      const teams = businessRows(await tx.execute(sql`SELECT id, name, status, revision FROM enterprise_teams WHERE enterpriseId = ${enterpriseId}${teamFilter} ORDER BY id`)).map(row => ({ id: Number(row.id), name: String(row.name), status: String(row.status), revision: Number(row.revision) }));
      const members: BusinessOrganizationOverview["members"] = [];
      for (const row of memberRows) {
        const userId = Number(row.userId);
        const settings = businessRows(await tx.execute(sql`SELECT module, revision FROM enterprise_member_module_access WHERE enterpriseId = ${enterpriseId} AND userId = ${userId}`));
        const moduleAccess: BusinessOrganizationOverview["members"][number]["moduleAccess"] = [];
        for (const module of BUSINESS_MODULES) {
          const saved = settings.find(setting => setting.module === module);
          const effective = row.status === "active" && !businessBoolean(row.loginDisabled)
            ? await resolveBusinessModuleAccess(userId, enterpriseId, module, tx)
            : { read: false, write: false, scope: "self" as const, explicit: Boolean(saved) };
          moduleAccess.push({ module, read: effective.read, write: effective.write, scope: effective.scope, revision: Number(saved?.revision ?? 0), explicit: effective.explicit });
        }
        const activeTeam = row.teamStatus === "active";
        members.push({ userId, username: row.username ?? null, name: row.name ?? null, status: String(row.status), enterpriseRole: String(row.role), teamId: activeTeam ? Number(row.teamId) : null, teamRole: activeTeam ? safeTeamRole(row.teamRole) : null, revision: Number(row.permissionVersion), moduleAccess });
      }
      return { enterprise: { id: enterpriseId, name: String(c.enterprise.companyName) }, actorUserId, canManage: c.isOwner, teams, members, templates: structuredClone(BUSINESS_ACCESS_TEMPLATES) };
    });
  }

  async function createTeam(actorUserId: number, enterpriseId: number, raw: BusinessCreateTeamInput) {
    const input = businessCreateTeamSchema.parse(raw);
    return mutate(actorUserId, enterpriseId, "createTeam", input, async (tx, c, hash) => {
      // The NOT NULL legacy primary pointer is retained for compatibility, not used to infer membership or ERP keys.
      const result = header(await tx.execute(sql`INSERT INTO enterprise_teams (enterpriseId, name, notes, createdByUserId, leaderUserId, status, revision) VALUES (${enterpriseId}, ${input.name}, ${input.notes || null}, ${actorUserId}, ${actorUserId}, 'active', 1)`));
      const id = Number(result.insertId); positive(id);
      await event(tx, c, "createTeam", input.requestId, hash, { teamId: id, before: null, after: { id, name: input.name, notes: input.notes || null, status: "active", revision: 1, leaderUserId: actorUserId } });
      return { success: true as const, idempotent: false, teamId: id, revision: 1 };
    });
  }

  async function updateTeam(actorUserId: number, enterpriseId: number, raw: BusinessUpdateTeamInput) {
    const input = businessUpdateTeamSchema.parse(raw);
    return mutate(actorUserId, enterpriseId, "updateTeam", input, async (tx, c, hash) => {
      const before = await team(tx, enterpriseId, input.id); cas(before.revision, input.expectedRevision);
      const notes = input.notes === undefined ? before.notes : input.notes || null;
      const result = header(await tx.execute(sql`UPDATE enterprise_teams SET name = ${input.name}, notes = ${notes}, revision = revision + 1 WHERE enterpriseId = ${enterpriseId} AND id = ${input.id} AND revision = ${input.expectedRevision}`));
      if (Number(result.affectedRows) !== 1) fail("CONFLICT", "团队版本已变化");
      const after = { ...before, name: input.name, notes, revision: Number(before.revision) + 1 };
      await event(tx, c, "updateTeam", input.requestId, hash, { teamId: input.id, before, after });
      return { success: true as const, idempotent: false, teamId: input.id, revision: after.revision };
    });
  }

  async function setMember(actorUserId: number, enterpriseId: number, raw: BusinessSetMemberInput) {
    const input = businessSetMemberSchema.parse(raw);
    return mutate(actorUserId, enterpriseId, "setMember", input, async (tx, c, hash) => {
      const member = await target(tx, enterpriseId, input.userId);
      const current = await membership(tx, enterpriseId, input.userId);
      const teamIds = Array.from(new Set([current ? Number(current.teamId) : null, input.teamId].filter((id): id is number => id !== null))).sort((a, b) => a - b);
      const locked = new Map<number, Row>();
      for (const id of teamIds) locked.set(id, await team(tx, enterpriseId, id));
      const source = current ? locked.get(Number(current.teamId))! : null;
      // Membership CAS must survive moves and remove/rejoin cycles; team counters are unrelated.
      cas(member.permissionVersion, input.expectedRevision);
      const changing = !current || Number(current.teamId) !== input.teamId || current.teamRole !== input.role;
      if (input.userId === Number(c.enterprise.superAdminUserId) && current && changing) fail("FORBIDDEN", "企业所有者的当前主团队与组长岗位须保留");
      if (source && Number(source.leaderUserId) === input.userId && changing) fail("FORBIDDEN", "不能移动或降级兼容主组长，请先通过受控流程转移主组长");
      const before = current ? { ...current, revision: Number(member.permissionVersion) } : { teamId: null, teamRole: null, revision: Number(member.permissionVersion) };
      const nextDataScope = current && Number(current.teamId) === input.teamId ? current.dataScope : "self";
      if (current && input.teamId === null) {
        await tx.execute(sql`DELETE FROM enterprise_team_members WHERE enterpriseId = ${enterpriseId} AND userId = ${input.userId} AND teamId = ${Number(current.teamId)}`);
      } else if (current) {
        // A move resets only legacy member scope to safe self. Frozen record team assignments are NEVER updated.
        await tx.execute(sql`UPDATE enterprise_team_members SET teamId = ${input.teamId}, teamRole = ${input.role}, dataScope = ${nextDataScope} WHERE enterpriseId = ${enterpriseId} AND userId = ${input.userId}`);
      } else if (input.teamId !== null) {
        await tx.execute(sql`INSERT INTO enterprise_team_members (enterpriseId, teamId, userId, teamRole, dataScope, joinedByUserId) VALUES (${enterpriseId}, ${input.teamId}, ${input.userId}, ${input.role}, 'self', ${actorUserId})`);
      }
      for (const id of teamIds) {
        const rev = Number(locked.get(id)!.revision);
        const result = header(await tx.execute(sql`UPDATE enterprise_teams SET revision = revision + 1 WHERE enterpriseId = ${enterpriseId} AND id = ${id} AND revision = ${rev}`));
        if (Number(result.affectedRows) !== 1) fail("CONFLICT", "团队版本已变化");
      }
      await tx.execute(sql`UPDATE enterprise_members SET permissionVersion = permissionVersion + 1 WHERE enterpriseId = ${enterpriseId} AND id = ${Number(member.id)}`);
      const revision = Number(member.permissionVersion) + 1;
      const after = { userId: input.userId, teamId: input.teamId, teamRole: input.role, revision, dataScope: nextDataScope, historicalRecordTeamsUnchanged: true };
      await event(tx, c, "setMember", input.requestId, hash, { targetUserId: input.userId, teamId: input.teamId, before, after });
      return { success: true as const, idempotent: false, ...after };
    });
  }

  async function updateMemberAccess(actorUserId: number, enterpriseId: number, raw: BusinessUpdateMemberAccessInput): Promise<BusinessUpdateAccessResult> {
    const parsed = businessUpdateMemberAccessSchema.parse(raw);
    const input = { ...parsed, modules: [...parsed.modules].sort((a, b) => BUSINESS_MODULES.indexOf(a.module) - BUSINESS_MODULES.indexOf(b.module)) };
    return mutate(actorUserId, enterpriseId, "updateMemberAccess", input, async (tx, c, hash) => {
      const member = await target(tx, enterpriseId, input.userId);
      // The system-owner identity/capabilities are not editable by a business template.
      if (input.userId === Number(c.enterprise.superAdminUserId) || businessIsOwner(member, c.enterprise)) fail("FORBIDDEN", "系统所有者权限不能通过业务模板降低或替换");
      const currentTeam = await membership(tx, enterpriseId, input.userId);
      const activeTeam = currentTeam ? await team(tx, enterpriseId, Number(currentTeam.teamId)) : null;
      const permissions = businessRows(await tx.execute(sql`SELECT permissionKey FROM enterprise_member_permissions WHERE enterpriseMemberId = ${Number(member.id)} FOR UPDATE`)).map(row => String(row.permissionKey));
      const normalized = normalizeErpPermissions(permissions);
      const saved = businessRows(await tx.execute(sql`SELECT id, module, readAllowed, writeAllowed, dataScope, revision, templateId, templateVersion, updatedByUserId, updatedAt FROM enterprise_member_module_access WHERE enterpriseId = ${enterpriseId} AND userId = ${input.userId} ORDER BY module FOR UPDATE`));
      // Validate the full set before any write; any stale module aborts all four updates.
      for (const setting of input.modules) {
        const previous = saved.find(row => row.module === setting.module);
        cas(previous?.revision ?? 0, setting.expectedRevision);
        if (setting.scope === "team" && (!activeTeam || ((setting.module === "customers" || setting.module === "demands") && currentTeam?.teamRole !== "leader"))) fail("BAD_REQUEST", "团队范围要求有效团队；客户与需求还要求显式组长岗位");
        if (setting.scope === "enterprise" && (!(["customers", "demands"] as string[]).includes(setting.module) || !normalized.includes("customers.manage_all"))) fail("BAD_REQUEST", "企业范围仅可保留已有全部客户ERP授权，不能由模块配置扩大");
      }
      for (const setting of input.modules) {
        const previous = saved.find(row => row.module === setting.module);
        if (previous) {
          const result = header(await tx.execute(sql`UPDATE enterprise_member_module_access SET readAllowed = ${setting.read}, writeAllowed = ${setting.write}, dataScope = ${setting.scope}, revision = revision + 1, templateId = ${input.templateId ?? null}, templateVersion = ${input.templateId ? BUSINESS_TEMPLATE_VERSION : null}, updatedByUserId = ${actorUserId}, updatedAt = CURRENT_TIMESTAMP WHERE enterpriseId = ${enterpriseId} AND userId = ${input.userId} AND module = ${setting.module} AND revision = ${setting.expectedRevision}`));
          if (Number(result.affectedRows) !== 1) fail("CONFLICT", "模块权限版本已变化");
        } else {
          await tx.execute(sql`INSERT INTO enterprise_member_module_access (enterpriseId, userId, module, readAllowed, writeAllowed, dataScope, revision, templateId, templateVersion, updatedByUserId) VALUES (${enterpriseId}, ${input.userId}, ${setting.module}, ${setting.read}, ${setting.write}, ${setting.scope}, 1, ${input.templateId ?? null}, ${input.templateId ? BUSINESS_TEMPLATE_VERSION : null}, ${actorUserId})`);
        }
      }
      // Bump revocation-aware readers, but preserve every existing explicit ERP grant byte-for-byte.
      await tx.execute(sql`UPDATE enterprise_members SET permissionVersion = permissionVersion + 1 WHERE enterpriseId = ${enterpriseId} AND id = ${Number(member.id)}`);
      const modules: BusinessUpdateAccessResult["modules"] = [];
      for (const setting of input.modules) {
        const previous = saved.find(row => row.module === setting.module);
        const persisted = await one(tx, sql`SELECT id, module, readAllowed, writeAllowed, dataScope, revision, templateId, templateVersion, updatedByUserId, updatedAt FROM enterprise_member_module_access WHERE enterpriseId = ${enterpriseId} AND userId = ${input.userId} AND module = ${setting.module} LIMIT 1 FOR UPDATE`);
        const effective = await resolveBusinessModuleAccess(input.userId, enterpriseId, setting.module, tx);
        const entitled = businessModuleEntitled(setting.module, false, normalized);
        const requested = { module: setting.module, read: setting.read, write: setting.write, scope: setting.scope };
        const item = { module: setting.module, read: effective.read, write: effective.write, scope: effective.scope, revision: setting.expectedRevision + 1, explicit: true, entitled, requested, notEntitled: !entitled && (setting.read || setting.write) };
        modules.push(item);
        await event(tx, c, "updateMemberAccess", input.requestId, hash, { targetUserId: input.userId, teamId: activeTeam ? Number(activeTeam.id) : null, module: setting.module, templateId: input.templateId, before: previous ?? { id: null, revision: 0, explicit: false, templateId: null, templateVersion: null }, after: { ...persisted, effective: item, erpGrantsChanged: false } });
      }
      return { success: true as const, idempotent: false, erpGrantsChanged: false as const, modules };
    });
  }

  async function audit(actorUserId: number, enterpriseId: number, raw: { page?: number; pageSize?: number } = {}) {
    const input = businessAuditSchema.parse(raw);
    const db = await database();
    return db.transaction(async tx => {
      await authority(tx, actorUserId, enterpriseId, true, true);
      const count = await one(tx, sql`SELECT COUNT(*) AS total FROM enterprise_business_organization_audit WHERE enterpriseId = ${enterpriseId}`);
      const rows = businessRows(await tx.execute(sql`SELECT id, enterpriseId, actorUserId, targetUserId, teamId, module, action, requestId, payloadHash, templateId, templateVersion, beforeData, afterData, createdAt FROM enterprise_business_organization_audit WHERE enterpriseId = ${enterpriseId} ORDER BY id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`));
      return { items: rows.map(row => ({ ...row, id: Number(row.id), enterpriseId: Number(row.enterpriseId), actorUserId: Number(row.actorUserId), beforeData: parseJson(row.beforeData), afterData: parseJson(row.afterData) })), total: Number(count?.total ?? 0) };
    });
  }
  return { overview, createTeam, updateTeam, setMember, updateMemberAccess, audit };
}

export const businessOrganizationService = createBusinessOrganizationService();
