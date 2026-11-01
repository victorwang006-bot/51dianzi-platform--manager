import { TRPCError } from "@trpc/server";
import { eq, getTableName, sql, type SQL, type Table } from "drizzle-orm";
import { adminUserPermissions, adminUsers } from "../../drizzle/schema";
import {
  officialChannelTeamMembers,
  officialChannelTeams,
} from "../../drizzle/officialChannelSchema";
import {
  resolveAdminPermissions,
  type AdminPermission,
} from "../../shared/adminPermissions";
import type { TrpcContext } from "../_core/context";

export const OFFICIAL_INVENTORY_PERMISSIONS = [
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
] as const satisfies readonly AdminPermission[];

export type OfficialInventoryPermission =
  (typeof OFFICIAL_INVENTORY_PERMISSIONS)[number];
export type OfficialPermission =
  | OfficialInventoryPermission
  | "officialTeams.manage";
export type OfficialRecordAction = "read" | "manage" | "publish" | "note";

export type OfficialActor = {
  /** Only derived from ctx.adminAccount; browser-provided IDs are never accepted. */
  adminUserId: number;
  /** Only derived from ctx.adminAccount's signed local-session snapshot. */
  sessionVersion: number;
};

export type OfficialAccess = {
  adminUserId: number;
  isSuperAdmin: boolean;
  teamId: number | null;
  teamRole: "member" | "leader" | null;
  permissions: readonly AdminPermission[];
};

export type OfficialScopedRecord = {
  /** NULL is a legacy/unassigned official record and is visible only to a real super_admin. */
  teamId: number | null;
  ownerAdminUserId: number | null;
};

/** Minimum Drizzle executor surface; db and transaction objects both satisfy it. */
export type OfficialDbExecutor = any;

function forbidden(message: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}

/**
 * The official domain intentionally has no OAuth compatibility path. Existing broad
 * dashboard routes may retain it, but an auditable official actor must be a current
 * local admin_users row whose session version is carried by its local JWT.
 */
export function requireOfficialAdminAccount(ctx: TrpcContext) {
  if (!ctx.user || ctx.user.role !== "admin" || !ctx.adminAccount) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请使用有效的后台工作人员账号访问官方渠道模块",
    });
  }
  if (ctx.adminAccount.status !== "active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "后台工作人员账号已不可用",
    });
  }
  if (!Number.isSafeInteger(ctx.adminAccount.id) || ctx.adminAccount.id <= 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "后台工作人员身份无效",
    });
  }
  if (
    !Number.isSafeInteger(ctx.adminAccount.sessionVersion) ||
    ctx.adminAccount.sessionVersion < 1
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "后台工作人员会话版本无效",
    });
  }
  return ctx.adminAccount;
}

/** Construct the actor only at the tRPC boundary from the trusted local account. */
export function officialActorFromContext(ctx: TrpcContext): OfficialActor {
  const account = requireOfficialAdminAccount(ctx);
  return { adminUserId: account.id, sessionVersion: account.sessionVersion };
}

/**
 * Reload the actual account while it is locked. All official writes call this inside
 * their transaction, so a disabled account, a revoked JWT or an altered native grant
 * cannot complete using a stale ctx.adminAccount snapshot.
 */
export async function loadOfficialAccess(
  tx: OfficialDbExecutor,
  actor: OfficialActor,
  permission: OfficialPermission
): Promise<OfficialAccess> {
  if (!Number.isSafeInteger(actor.adminUserId) || actor.adminUserId <= 0) {
    forbidden("官方渠道后台主体无效");
  }
  if (!Number.isSafeInteger(actor.sessionVersion) || actor.sessionVersion < 1) {
    forbidden("官方渠道后台会话无效");
  }

  const [account] = await tx
    .select({
      id: adminUsers.id,
      adminRole: adminUsers.adminRole,
      status: adminUsers.status,
      sessionVersion: adminUsers.sessionVersion,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, actor.adminUserId))
    .limit(1)
    .for("update");
  if (
    !account ||
    account.status !== "active" ||
    account.sessionVersion !== actor.sessionVersion
  ) {
    forbidden("后台账号状态或会话已变化，请重新登录");
  }

  const permissionRows = await tx
    .select({ permission: adminUserPermissions.permission })
    .from(adminUserPermissions)
    .where(eq(adminUserPermissions.adminUserId, account.id))
    .orderBy(adminUserPermissions.id)
    .for("update");
  const permissions = resolveAdminPermissions(
    account.adminRole,
    permissionRows.map((row: { permission: string }) => row.permission)
  );
  const isSuperAdmin = account.adminRole === "super_admin";

  // Membership in an archived team is not usable scope. Super admins retain their
  // official-domain authority but normal staff fail closed until assigned to an active team.
  const [membership] = await tx
    .select({
      teamId: officialChannelTeamMembers.teamId,
      role: officialChannelTeamMembers.role,
      teamStatus: officialChannelTeams.status,
    })
    .from(officialChannelTeamMembers)
    .innerJoin(
      officialChannelTeams,
      eq(officialChannelTeams.id, officialChannelTeamMembers.teamId)
    )
    .where(eq(officialChannelTeamMembers.adminUserId, account.id))
    .limit(1)
    .for("update");
  const activeMembership =
    membership?.teamStatus === "active" ? membership : null;
  const access: OfficialAccess = {
    adminUserId: account.id,
    isSuperAdmin,
    teamId: activeMembership?.teamId ?? null,
    teamRole: activeMembership?.role ?? null,
    permissions,
  };

  if (permission === "officialTeams.manage") {
    if (!access.isSuperAdmin)
      forbidden("只有真实后台超级管理员可以配置官方团队");
  } else if (!access.permissions.includes(permission)) {
    forbidden("当前后台账号未获官方渠道模块权限");
  }
  return access;
}

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`OFFICIAL_SQL_IDENTIFIER_INVALID_${label}`);
  }
  return sql.raw(`\`${value}\``);
}

/**
 * Builds a database-side predicate for every official source/stock read. It must be
 * combined into the query before rows are selected; callers must never fetch first
 * and filter in application memory. A no-team non-super user is explicitly rejected
 * rather than receiving an unscoped list.
 */
export function officialTeamPredicate(
  access: OfficialAccess,
  alias: string | Table,
  teamColumn = "teamId"
): SQL {
  if (access.isSuperAdmin) return sql`1 = 1`;
  if (!access.teamId) forbidden("当前后台账号未配置有效官方团队");
  const table = safeIdentifier(
    typeof alias === "string" ? alias : getTableName(alias),
    "ALIAS"
  );
  const column = safeIdentifier(teamColumn, "COLUMN");
  return sql`${table}.${column} = ${access.teamId}`;
}

/**
 * Enforce module grant and team scope together. Team position is data scope, never a
 * replacement for a native grant: leader-only/owner-only actions must still carry the
 * appropriate officialInventory permission. Same-team non-owner members may append a
 * private note when they hold officialInventory.note, but cannot alter public fields.
 */
export function assertOfficialRecordAction(
  access: OfficialAccess,
  record: OfficialScopedRecord,
  action: OfficialRecordAction
): void {
  const permissionByAction: Record<
    OfficialRecordAction,
    OfficialInventoryPermission
  > = {
    read: "officialInventory.read",
    manage: "officialInventory.write",
    publish: "officialInventory.publish",
    note: "officialInventory.note",
  };
  if (!access.permissions.includes(permissionByAction[action])) {
    forbidden("当前后台账号未获官方渠道模块权限");
  }
  if (access.isSuperAdmin) return;
  if (!access.teamId || !record.teamId || access.teamId !== record.teamId) {
    // Deliberately non-enumerating: a different/unassigned record has the same result.
    forbidden("官方记录不存在或不在当前团队范围内");
  }
  if (action === "read" || action === "note") return;
  const isLeader = access.teamRole === "leader";
  const isOwner = record.ownerAdminUserId === access.adminUserId;
  if (!isLeader && !isOwner) {
    forbidden("仅本组组长或当前负责人可修改或发布该官方记录");
  }
}

/** Helps source/stock services state their action requirement without role-only checks. */
export function officialPermissionForAction(
  action: OfficialRecordAction
): OfficialInventoryPermission {
  const permissions: Record<OfficialRecordAction, OfficialInventoryPermission> =
    {
      read: "officialInventory.read",
      manage: "officialInventory.write",
      publish: "officialInventory.publish",
      note: "officialInventory.note",
    };
  return permissions[action];
}

export const officialChannelAccessTestUtils = {
  officialPermissionForAction,
};
