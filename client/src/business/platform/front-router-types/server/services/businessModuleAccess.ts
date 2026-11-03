import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { BUSINESS_MODULES, type BusinessModule, type BusinessModuleAccess, type BusinessDataScope } from "../../../shared/businessOrganization";
import { normalizeErpPermissions } from "../../../shared/erpPermissions";
import { getDb } from "../db";

/** Both a Drizzle database and transaction implement execute. A transaction additionally exposes rollback. */
export interface BusinessSqlExecutor { execute(query: SQL): Promise<unknown> }
export function businessRows(result: unknown): Record<string, any>[] {
  if (!Array.isArray(result)) throw new Error("Unexpected business SQL result");
  return (Array.isArray(result[0]) ? result[0] : result) as Record<string, any>[];
}
export function businessIsTransaction(db: BusinessSqlExecutor): boolean {
  return typeof (db as BusinessSqlExecutor & { rollback?: unknown }).rollback === "function";
}
export function businessBoolean(value: unknown): boolean { return value === true || value === 1 || value === "1"; }
export function businessIsOwner(member: { status?: unknown; role?: unknown; userId?: unknown }, enterprise: { superAdminUserId?: unknown }): boolean {
  return member.status === "active" && member.role === "super_admin" && Number(member.userId) === Number(enterprise.superAdminUserId);
}
export function businessModuleEntitled(module: BusinessModule, isOwner: boolean, permissionKeys: readonly string[]): boolean {
  const permissions = normalizeErpPermissions(permissionKeys);
  return isOwner || permissions.includes(module === "customers" || module === "demands" ? "customers.manage" : "inventory.manage");
}

/**
 * Authoritative per-call intersection; never uses legacy inventoryDataScope or leader NULL=>team fallback.
 * Pass the mutation's actual tx to recheck and lock enterprise/member/grants/team/module before writing.
 * stocks.team means eligible to check a share, NOT a share grant: callers MUST separately validate an
 * explicit live share and same current active team. Shared records are read-only, irrespective of write.
 * channels are always private, including for the enterprise owner.
 * Missing/malformed schema fails closed (SERVICE_UNAVAILABLE), never an authorization fallback.
 */
export async function resolveBusinessModuleAccess(
  actorUserId: number, enterpriseId: number, module: BusinessModule, dbOverride?: BusinessSqlExecutor,
  readProjection?: { officialInventoryRead: boolean },
): Promise<BusinessModuleAccess> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0 || !Number.isSafeInteger(enterpriseId) || enterpriseId <= 0 || !BUSINESS_MODULES.includes(module)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无效的企业或业务模块" });
  }
  const db = dbOverride ?? await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务权限数据库不可用" });
  const lock = businessIsTransaction(db) ? sql` FOR UPDATE` : sql``;
  try {
    const enterprise = businessRows(await db.execute(sql`SELECT id, superAdminUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1${lock}`))[0];
    const member = businessRows(await db.execute(sql`SELECT em.id, em.userId, em.status, em.role, u.loginDisabled FROM enterprise_members em INNER JOIN users u ON u.id = em.userId WHERE em.enterpriseId = ${enterpriseId} AND em.userId = ${actorUserId} LIMIT 1${lock}`))[0];
    if (!enterprise || !member || member.status !== "active" || businessBoolean(member.loginDisabled)) throw new TRPCError({ code: "FORBIDDEN", message: "不是当前企业的有效成员" });
    const permissionKeys = businessRows(await db.execute(sql`SELECT permissionKey FROM enterprise_member_permissions WHERE enterpriseMemberId = ${Number(member.id)}${lock}`)).map(row => String(row.permissionKey));
    const memberships = businessRows(await db.execute(sql`SELECT teamId, teamRole FROM enterprise_team_members WHERE enterpriseId = ${enterpriseId} AND userId = ${actorUserId}${lock}`));
    // Uniqueness is mandatory; ambiguous/unknown team memberships must never broaden scope.
    let teamId: number | null = null;
    let teamRole: "leader" | "member" | null = null;
    if (memberships.length === 1 && ["leader", "member"].includes(memberships[0].teamRole)) {
      const candidate = Number(memberships[0].teamId);
      const team = businessRows(await db.execute(sql`SELECT id, status FROM enterprise_teams WHERE enterpriseId = ${enterpriseId} AND id = ${candidate} LIMIT 1${lock}`))[0];
      if (team?.status === "active" && Number.isSafeInteger(candidate) && candidate > 0) { teamId = candidate; teamRole = memberships[0].teamRole; }
    }
    const settings = businessRows(await db.execute(sql`SELECT readAllowed, writeAllowed, dataScope, revision FROM enterprise_member_module_access WHERE enterpriseId = ${enterpriseId} AND userId = ${actorUserId} AND module = ${module} ORDER BY revision DESC, id DESC LIMIT 1${lock}`));
    const setting = settings[0];
    if (setting && (!["self", "team", "enterprise"].includes(setting.dataScope) || !Number.isSafeInteger(Number(setting.revision)) || Number(setting.revision) < 1)) throw new Error("Invalid business module configuration");
    const isOwner = businessIsOwner(member, enterprise);
    const entitled = businessModuleEntitled(module, isOwner, permissionKeys);
    const crm = module === "customers" || module === "demands";
    const enterpriseCapable = crm && (isOwner || normalizeErpPermissions(permissionKeys).includes("customers.manage_all"));
    let scope: BusinessDataScope = module === "stocks" ? (teamId ? "team" : "self") : enterpriseCapable ? "enterprise" : "self";
    if (setting) {
      scope = setting.dataScope as BusinessDataScope;
      if (scope === "enterprise" && !enterpriseCapable) scope = "self";
      if (scope === "team" && (!teamId || (crm && teamRole !== "leader"))) scope = "self";
    }
    if (module === "channels") scope = "self";
    // Only the trusted channel stocks read chain may omit ERP manage. It cannot
    // manufacture write, bypass explicit deny, or widen the current team scope.
    const nativeRead = module === "stocks" && readProjection?.officialInventoryRead === true;
    const read = (entitled || nativeRead) && (!setting || businessBoolean(setting.readAllowed));
    const write = entitled && read && (!setting || businessBoolean(setting.writeAllowed));
    return { read, write, scope, teamId, explicit: Boolean(setting), teamRole };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务权限结构尚未就绪或读取失败", cause: error });
  }
}
