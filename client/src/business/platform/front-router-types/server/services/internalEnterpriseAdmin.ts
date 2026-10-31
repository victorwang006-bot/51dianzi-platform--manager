import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  enterpriseAdminMemberAudits,
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprises,
  userModerationAudits,
  users,
} from "../../drizzle/schema";
import {
  ERP_PERMISSION_KEYS,
  isErpPermissionKey,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "../../../shared/erpPermissions";
import { getDb } from "../db";
import { normalizeEnterpriseCreditCode } from "./enterpriseAccess";
import {
  normalizeHkEnterpriseRegistrationIdentifier,
  type EnterpriseRegistrationIdentity,
} from "./enterpriseRegistrationIdentity";

export type InternalEnterpriseOperator = {
  id: string | number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

type CommonMemberMutationInput = {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedOwnerUserId: number;
  targetUserId: number;
  reason: string;
  requestId: string;
  operator: InternalEnterpriseOperator;
};

type AdminAuditAction =
  | "member_suspended"
  | "member_activated"
  | "permissions_updated"
  | "inventory_scope_updated"
  | "login_disabled"
  | "login_restored";

type AuditValue = Record<string, unknown>;
type AuditRow = {
  enterpriseId: number;
  targetUserId: number;
  action: string;
  afterValue: unknown;
  payloadHash: string;
};

type OperationResult =
  | { success: true; idempotent: boolean; status: "active" | "suspended" }
  | { success: true; idempotent: boolean; permissionKeys: ErpPermissionKey[] }
  | { success: true; idempotent: boolean; inventoryDataScope: "own" | "enterprise" }
  | { success: true; idempotent: boolean; loginDisabled: boolean };

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  }
  return db;
}

function maskPhone(phone: string | null | undefined): string | null {
  const normalized = String(phone ?? "").replace(/[\s-]/g, "");
  if (!normalized) return null;
  if (normalized.length <= 7) return "****";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function displayName(name: string | null, username: string | null, userId: number) {
  return String(name ?? username ?? "").trim() || `用户${userId}`;
}

function assertExpectedOwner(actualOwnerUserId: number, expectedOwnerUserId?: number) {
  if (expectedOwnerUserId !== undefined && actualOwnerUserId !== expectedOwnerUserId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "企业所有者已变化，请刷新后重试",
    });
  }
}

function assertMutableMember(member: { userId: number; role: string }, ownerUserId: number) {
  if (member.userId === ownerUserId || member.role === "super_admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "企业所有者不能通过后台成员接口修改",
    });
  }
}

function canMutateEnterpriseOwner(allowOwnerForSuperAdmin: boolean | undefined, operatorRole: string) {
  return allowOwnerForSuperAdmin === true && operatorRole.trim() === "super_admin";
}

function normalizeOperator(operator: InternalEnterpriseOperator) {
  return {
    id: String(operator.id).trim(),
    name: operator.name.trim(),
    role: operator.role.trim(),
    ipAddress: operator.ipAddress?.trim() || null,
    userAgent: operator.userAgent?.trim() || null,
  };
}

function normalizeEnterpriseIdentity(input: Pick<CommonMemberMutationInput, "creditCode" | "registrationIdentifier">): EnterpriseRegistrationIdentity {
  const creditCode = input.creditCode?.trim();
  const registrationIdentifier = input.registrationIdentifier?.trim();
  if (Boolean(creditCode) === Boolean(registrationIdentifier)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能提供统一社会信用代码或香港企业标识" });
  }
  if (creditCode) return { kind: "CN", creditCode: normalizeEnterpriseCreditCode(creditCode) };
  try {
    return { kind: "HK", registrationIdentifier: normalizeHkEnterpriseRegistrationIdentifier(registrationIdentifier!) };
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN" });
  }
}

function enterpriseIdentityCondition(identity: EnterpriseRegistrationIdentity) {
  // Keep the established CN predicate independent of HK rows.
  return identity.kind === "CN"
    ? eq(enterprises.creditCode, identity.creditCode)
    : and(
        eq(enterprises.registrationRegion, "HK"),
        eq(enterprises.registrationIdentifier, identity.registrationIdentifier),
      );
}

function payloadHash(
  action: AdminAuditAction,
  input: CommonMemberMutationInput,
  identity: EnterpriseRegistrationIdentity,
  value: AuditValue,
) {
  return createHash("sha256").update(JSON.stringify({
    action,
    // CN records retain the historical serialized field so existing replay
    // hashes remain valid; HK uses its own non-null stable identity key.
    ...(identity.kind === "CN"
      ? { creditCode: identity.creditCode }
      : { registrationIdentifier: identity.registrationIdentifier }),
    expectedOwnerUserId: input.expectedOwnerUserId,
    targetUserId: input.targetUserId,
    reason: input.reason.trim(),
    requestId: input.requestId.trim(),
    operator: normalizeOperator(input.operator),
    value,
  })).digest("hex");
}

function asAuditValue(value: unknown): AuditValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AuditValue;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as AuditValue;
      }
    } catch {
      // Invalid historic JSON cannot satisfy an idempotent replay.
    }
  }
  return {};
}

function resultFromAudit(audit: AuditRow, expectedPayloadHash: string): OperationResult {
  if (audit.payloadHash !== expectedPayloadHash) {
    throw new TRPCError({ code: "CONFLICT", message: "requestId 已用于不同的企业成员操作" });
  }
  const after = asAuditValue(audit.afterValue);
  if (audit.action === "member_suspended" || audit.action === "member_activated") {
    const status = after.status;
    if (status !== "active" && status !== "suspended") {
      throw new TRPCError({ code: "CONFLICT", message: "requestId 对应的状态审计无效" });
    }
    return { success: true, idempotent: true, status };
  }
  if (audit.action === "permissions_updated") {
    const raw = Array.isArray(after.permissionKeys) ? after.permissionKeys : [];
    const permissionKeys = normalizeErpPermissions(raw.filter((item): item is string => typeof item === "string"));
    return { success: true, idempotent: true, permissionKeys };
  }
  if (audit.action === "inventory_scope_updated") {
    const inventoryDataScope = after.inventoryDataScope;
    if (inventoryDataScope !== "own" && inventoryDataScope !== "enterprise") {
      throw new TRPCError({ code: "CONFLICT", message: "requestId 对应的数据范围审计无效" });
    }
    return { success: true, idempotent: true, inventoryDataScope };
  }
  if (audit.action === "login_disabled" || audit.action === "login_restored") {
    if (typeof after.loginDisabled !== "boolean") {
      throw new TRPCError({ code: "CONFLICT", message: "requestId 对应的登录状态审计无效" });
    }
    return { success: true, idempotent: true, loginDisabled: after.loginDisabled };
  }
  throw new TRPCError({ code: "CONFLICT", message: "requestId 已用于其他操作" });
}

function normalizePermissionInput(values: readonly string[]): ErpPermissionKey[] {
  const normalized = normalizeErpPermissions(values);
  if (
    normalized.length === 0
    || normalized.length !== values.length
    || values.some(value => !isErpPermissionKey(value))
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请至少设置一项且不得包含重复或无效的ERP权限" });
  }
  return normalized;
}

export async function listInternalEnterpriseMembers(input: {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedOwnerUserId?: number;
  status?: "all" | "active" | "suspended";
}) {
  const db = await requireDb();
  const identity = normalizeEnterpriseIdentity(input);
  const enterprise = (
    await db
      .select({
        id: enterprises.id,
        companyName: enterprises.companyName,
        superAdminUserId: enterprises.superAdminUserId,
        dataOwnerUserId: enterprises.crmDataOwnerUserId,
      })
      .from(enterprises)
      .where(enterpriseIdentityCondition(identity))
      .limit(1)
  )[0];
  if (!enterprise) {
    throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
  }
  assertExpectedOwner(enterprise.superAdminUserId, input.expectedOwnerUserId);

  const status = input.status ?? "all";
  const conditions = [eq(enterpriseMembers.enterpriseId, enterprise.id)];
  if (status !== "all") conditions.push(eq(enterpriseMembers.status, status));
  const rows = await db
    .select({
      memberId: enterpriseMembers.id,
      userId: enterpriseMembers.userId,
      name: users.name,
      username: users.username,
      phone: users.phone,
      role: enterpriseMembers.role,
      status: enterpriseMembers.status,
      inventoryDataScope: enterpriseMembers.inventoryDataScope,
      loginDisabled: users.loginDisabled,
      joinedAt: enterpriseMembers.joinedAt,
    })
    .from(enterpriseMembers)
    .innerJoin(users, eq(users.id, enterpriseMembers.userId))
    .where(and(...conditions))
    .orderBy(asc(enterpriseMembers.id));
  const memberIds = rows.map(row => row.memberId);
  const permissionRows = memberIds.length === 0
    ? []
    : await db
      .select({
        memberId: enterpriseMemberPermissions.enterpriseMemberId,
        permissionKey: enterpriseMemberPermissions.permissionKey,
      })
      .from(enterpriseMemberPermissions)
      .where(inArray(enterpriseMemberPermissions.enterpriseMemberId, memberIds));
  const permissionsByMember = new Map<number, ErpPermissionKey[]>();
  for (const row of permissionRows) {
    const values = permissionsByMember.get(row.memberId) ?? [];
    values.push(row.permissionKey);
    permissionsByMember.set(row.memberId, values);
  }

  return {
    enterpriseId: enterprise.id,
    companyName: enterprise.companyName,
    superAdminUserId: enterprise.superAdminUserId,
    dataOwnerUserId: enterprise.dataOwnerUserId,
    members: rows.map(row => {
      const isOwner = row.userId === enterprise.superAdminUserId || row.role === "super_admin";
      return {
        memberId: row.memberId,
        userId: row.userId,
        displayName: displayName(row.name, row.username, row.userId),
        maskedPhone: maskPhone(row.phone),
        role: row.role,
        status: row.status,
        inventoryDataScope: row.inventoryDataScope,
        permissionKeys: isOwner
          ? [...ERP_PERMISSION_KEYS]
          : normalizeErpPermissions(permissionsByMember.get(row.memberId) ?? []),
        isOwner,
        loginDisabled: Boolean(row.loginDisabled),
        joinedAt: row.joinedAt,
      };
    }),
  };
}

type MutationPlan = {
  action: AdminAuditAction;
  value: AuditValue;
  /** 仅网站登录管控可由平台超级管理员作用于企业所有者。 */
  allowOwnerForSuperAdmin?: boolean;
  apply: (tx: any, context: {
    enterpriseId: number;
    ownerUserId: number;
    member: {
      id: number;
      userId: number;
      role: string;
      accountRole: string;
      status: "active" | "suspended";
      inventoryDataScope: "own" | "enterprise";
      crmAccess: boolean;
      loginDisabled: boolean;
      loginDisabledAt: Date | null;
      loginDisabledReason: string | null;
    };
  }) => Promise<{ beforeValue: AuditValue; afterValue: AuditValue; result: OperationResult }>;
};

async function executeMemberMutation(input: CommonMemberMutationInput, plan: MutationPlan) {
  const db = await requireDb();
  const identity = normalizeEnterpriseIdentity(input);
  const requestId = input.requestId.trim();
  const operator = normalizeOperator(input.operator);
  const expectedPayloadHash = payloadHash(plan.action, input, identity, plan.value);

  const execute = async () => db.transaction(async tx => {
    const enterprise = (
      await tx
        .select({
          id: enterprises.id,
          superAdminUserId: enterprises.superAdminUserId,
        })
        .from(enterprises)
        .where(enterpriseIdentityCondition(identity))
        .limit(1)
        .for("update")
    )[0];
    if (!enterprise) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
    assertExpectedOwner(enterprise.superAdminUserId, input.expectedOwnerUserId);

    const member = (
      await tx
        .select({
          id: enterpriseMembers.id,
          userId: enterpriseMembers.userId,
          role: enterpriseMembers.role,
          accountRole: users.role,
          status: enterpriseMembers.status,
          inventoryDataScope: enterpriseMembers.inventoryDataScope,
          crmAccess: users.crmAccess,
          loginDisabled: users.loginDisabled,
          loginDisabledAt: users.loginDisabledAt,
          loginDisabledReason: users.loginDisabledReason,
        })
        .from(enterpriseMembers)
        .innerJoin(users, eq(users.id, enterpriseMembers.userId))
        .where(and(
          eq(enterpriseMembers.enterpriseId, enterprise.id),
          eq(enterpriseMembers.userId, input.targetUserId),
        ))
        .limit(1)
        .for("update")
    )[0];
    if (!member) {
      throw new TRPCError({ code: "NOT_FOUND", message: "目标用户不是该企业成员" });
    }
    const targetsOwner = member.userId === enterprise.superAdminUserId || member.role === "super_admin";
    if (targetsOwner && !canMutateEnterpriseOwner(plan.allowOwnerForSuperAdmin, operator.role)) {
      assertMutableMember(member, enterprise.superAdminUserId);
    }

    // Enterprise/member locks serialize retries for one target before idempotency is evaluated.
    const existingAudit = (
      await tx
        .select({
          enterpriseId: enterpriseAdminMemberAudits.enterpriseId,
          targetUserId: enterpriseAdminMemberAudits.targetUserId,
          action: enterpriseAdminMemberAudits.action,
          afterValue: enterpriseAdminMemberAudits.afterValue,
          payloadHash: enterpriseAdminMemberAudits.payloadHash,
        })
        .from(enterpriseAdminMemberAudits)
        .where(eq(enterpriseAdminMemberAudits.requestId, requestId))
        .limit(1)
        .for("update")
    )[0];
    if (existingAudit) return resultFromAudit(existingAudit, expectedPayloadHash);

    const applied = await plan.apply(tx, {
      enterpriseId: enterprise.id,
      ownerUserId: enterprise.superAdminUserId,
      member,
    });
    await tx.insert(enterpriseAdminMemberAudits).values({
      enterpriseId: enterprise.id,
      targetUserId: member.userId,
      action: plan.action,
      beforeValue: applied.beforeValue,
      afterValue: applied.afterValue,
      reason: input.reason.trim(),
      requestId,
      payloadHash: expectedPayloadHash,
      operatorId: operator.id,
      operatorName: operator.name,
      operatorRole: operator.role,
      ipAddress: operator.ipAddress,
      userAgent: operator.userAgent,
    });
    return applied.result;
  });

  try {
    return await execute();
  } catch (error) {
    const mysqlError = error as { code?: string; errno?: number };
    if (mysqlError?.code !== "ER_DUP_ENTRY" && mysqlError?.errno !== 1062) throw error;
    const audit = (
      await db
        .select({
          enterpriseId: enterpriseAdminMemberAudits.enterpriseId,
          targetUserId: enterpriseAdminMemberAudits.targetUserId,
          action: enterpriseAdminMemberAudits.action,
          afterValue: enterpriseAdminMemberAudits.afterValue,
          payloadHash: enterpriseAdminMemberAudits.payloadHash,
        })
        .from(enterpriseAdminMemberAudits)
        .where(eq(enterpriseAdminMemberAudits.requestId, requestId))
        .limit(1)
    )[0];
    if (!audit) throw error;
    return resultFromAudit(audit, expectedPayloadHash);
  }
}

export async function setInternalEnterpriseMemberStatus(
  input: CommonMemberMutationInput & { status: "active" | "suspended" },
) {
  const action = input.status === "suspended" ? "member_suspended" : "member_activated";
  const status = input.status;
  return executeMemberMutation(input, {
    action,
    value: { status },
    apply: async (tx, context) => {
      const beforeValue = { status: context.member.status, crmAccess: Boolean(context.member.crmAccess) };
      const owner = status === "active"
        ? (
          await tx
            .select({ crmAccess: users.crmAccess })
            .from(users)
            .where(eq(users.id, context.ownerUserId))
            .limit(1)
        )[0]
        : null;
      const nextCrmAccess = status === "active" ? Boolean(owner?.crmAccess) : false;
      const afterValue = { status, crmAccess: nextCrmAccess };
      await tx
        .update(enterpriseMembers)
        .set({
          status,
          suspendedAt: status === "suspended" ? new Date() : null,
          permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1`,
        })
        .where(eq(enterpriseMembers.id, context.member.id));
      await tx
        .update(users)
        .set({ crmAccess: nextCrmAccess })
        .where(eq(users.id, context.member.userId));
      return {
        beforeValue,
        afterValue,
        result: { success: true, idempotent: false, status },
      };
    },
  });
}

export async function setInternalEnterpriseMemberPermissions(
  input: CommonMemberMutationInput & { permissionKeys: readonly string[] },
) {
  const permissionKeys = normalizePermissionInput(input.permissionKeys);
  return executeMemberMutation(input, {
    action: "permissions_updated",
    value: { permissionKeys },
    apply: async (tx, context) => {
      const existing = await tx
        .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
        .from(enterpriseMemberPermissions)
        .where(eq(enterpriseMemberPermissions.enterpriseMemberId, context.member.id))
        .for("update");
      const beforeValue = {
        permissionKeys: normalizeErpPermissions(existing.map((row: { permissionKey: string }) => row.permissionKey)),
      };
      const afterValue = { permissionKeys };
      await tx
        .delete(enterpriseMemberPermissions)
        .where(eq(enterpriseMemberPermissions.enterpriseMemberId, context.member.id));
      await tx.insert(enterpriseMemberPermissions).values(permissionKeys.map(permissionKey => ({
        enterpriseMemberId: context.member.id,
        permissionKey,
        // This is a front-office owner id, never the external admin operator id.
        grantedByUserId: context.ownerUserId,
      })));
      await tx
        .update(enterpriseMembers)
        .set({ permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1` })
        .where(eq(enterpriseMembers.id, context.member.id));
      return {
        beforeValue,
        afterValue,
        result: { success: true, idempotent: false, permissionKeys },
      };
    },
  });
}

export async function setInternalEnterpriseMemberScope(
  input: CommonMemberMutationInput & { inventoryDataScope: "own" | "enterprise" },
) {
  const inventoryDataScope = input.inventoryDataScope;
  return executeMemberMutation(input, {
    action: "inventory_scope_updated",
    value: { inventoryDataScope },
    apply: async (tx, context) => {
      const beforeValue = { inventoryDataScope: context.member.inventoryDataScope };
      const afterValue = { inventoryDataScope };
      await tx
        .update(enterpriseMembers)
        .set({
          inventoryDataScope,
          permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1`,
        })
        .where(eq(enterpriseMembers.id, context.member.id));
      return {
        beforeValue,
        afterValue,
        result: { success: true, idempotent: false, inventoryDataScope },
      };
    },
  });
}

/**
 * 企业范围内启停网站登录。它与成员暂停是两条独立控制面：前者拦截整站登录，
 * 后者仅暂停企业成员身份。平台超级管理员可对企业所有者执行登录管控，但不能借此
 * 修改其企业权限、范围或成员状态；幂等审计与用户管控审计仍在同一事务内完成。
 */
export async function setInternalEnterpriseMemberLoginDisabled(
  input: CommonMemberMutationInput & { disabled: boolean },
) {
  const loginDisabled = input.disabled;
  const action: AdminAuditAction = loginDisabled ? "login_disabled" : "login_restored";
  return executeMemberMutation(input, {
    action,
    value: { loginDisabled },
    allowOwnerForSuperAdmin: true,
    apply: async (tx, context) => {
      if (loginDisabled && context.member.accountRole === "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "禁止禁用前台管理员账号" });
      }
      const now = new Date();
      const beforeValue = {
        loginDisabled: Boolean(context.member.loginDisabled),
        loginDisabledAt: context.member.loginDisabledAt,
        loginDisabledReason: context.member.loginDisabledReason,
      };
      const afterValue = {
        loginDisabled,
        loginDisabledAt: loginDisabled ? now : null,
        loginDisabledReason: loginDisabled ? input.reason.trim() : null,
      };
      await tx
        .update(users)
        .set({
          loginDisabled,
          loginDisabledAt: loginDisabled ? now : null,
          loginDisabledReason: loginDisabled ? input.reason.trim() : null,
        })
        .where(eq(users.id, context.member.userId));
      await tx.insert(userModerationAudits).values({
        targetUserId: context.member.userId,
        action,
        reason: input.reason.trim(),
        operatorId: String(input.operator.id).trim(),
        operatorName: input.operator.name.trim(),
        operatorRole: input.operator.role.trim(),
        ipAddress: input.operator.ipAddress?.trim() || null,
        userAgent: input.operator.userAgent?.trim() || null,
        metadata: {
          disabled: loginDisabled,
          enterpriseId: context.enterpriseId,
          requestId: input.requestId.trim(),
          source: "merchant_enterprise_users",
        },
      });
      return {
        beforeValue,
        afterValue,
        result: { success: true, idempotent: false, loginDisabled },
      };
    },
  });
}

export const internalEnterpriseAdminTestUtils = {
  assertExpectedOwner,
  assertMutableMember,
  canMutateEnterpriseOwner,
  normalizePermissionInput,
  resultFromAudit,
};
