import { TRPCError } from "@trpc/server";
import { BusinessFailureCause } from "../../../shared/businessFailure";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprisePermissionAuditLogs,
  enterprises,
  type Enterprise,
  type EnterpriseMember,
} from "../../drizzle/schema";
import {
  ERP_PERMISSION_KEYS,
  isErpPermissionKey,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "../../../shared/erpPermissions";
import { getDb } from "../db";
import {
  enterpriseSelectionRequiredError,
  getEnterpriseBusinessRequestContext,
} from "./enterpriseRequestContext";

export type EnterprisePermissionScope = {
  enterprise: Enterprise;
  member: EnterpriseMember;
  permissionKeys: ErpPermissionKey[];
  isOwner: boolean;
  dataOwnerUserId: number;
  portalOwnerUserId: number;
};

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  }
  return db;
}

export function normalizePermissionInput(values: readonly string[]): ErpPermissionKey[] {
  if (values.length !== new Set(values).size || values.some(value => !isErpPermissionKey(value))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "包含无效的ERP权限" });
  }
  const normalized = normalizeErpPermissions(values);
  if (normalized.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请至少选择一项ERP权限" });
  }
  return normalized;
}

export async function getMemberPermissionKeys(memberId: number): Promise<ErpPermissionKey[]> {
  const db = await requireDb();
  const rows = await db
    .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
    .from(enterpriseMemberPermissions)
    .where(eq(enterpriseMemberPermissions.enterpriseMemberId, memberId));
  return normalizeErpPermissions(rows.map(row => row.permissionKey));
}

export async function listPermissionKeysByMemberIds(memberIds: number[]) {
  if (memberIds.length === 0) return new Map<number, ErpPermissionKey[]>();
  const db = await requireDb();
  const rows = await db
    .select({
      memberId: enterpriseMemberPermissions.enterpriseMemberId,
      permissionKey: enterpriseMemberPermissions.permissionKey,
    })
    .from(enterpriseMemberPermissions)
    .where(inArray(enterpriseMemberPermissions.enterpriseMemberId, memberIds));
  const result = new Map<number, ErpPermissionKey[]>();
  for (const memberId of memberIds) result.set(memberId, []);
  for (const row of rows) {
    const current = result.get(row.memberId) ?? [];
    current.push(row.permissionKey);
    result.set(row.memberId, current);
  }
  result.forEach((values, memberId) => {
    result.set(memberId, normalizeErpPermissions(values));
  });
  return result;
}

export async function resolveEnterprisePermissionScope(
  userId: number,
): Promise<EnterprisePermissionScope | null> {
  const db = await requireDb();
  const request = getEnterpriseBusinessRequestContext(userId);
  const contexts = await db
    .select({ enterprise: enterprises, member: enterpriseMembers })
    .from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterpriseMembers.enterpriseId, enterprises.id))
    .where(request?.enterpriseId
      ? and(
          eq(enterpriseMembers.userId, userId),
          eq(enterpriseMembers.enterpriseId, request.enterpriseId),
        )
      : eq(enterpriseMembers.userId, userId))
    .orderBy(asc(enterpriseMembers.enterpriseId))
    // Existing one-enterprise accounts remain compatible; two rows prove that
    // an implicit first member would be an unsafe cross-enterprise selection.
    .limit(request?.enterpriseId ? 1 : 2);
  if (!request?.enterpriseId && contexts.length > 1) throw enterpriseSelectionRequiredError();
  const context = contexts[0];
  if (!context) return null;
  const isOwner =
    context.member.status === "active"
    && context.member.role === "super_admin"
    && context.enterprise.superAdminUserId === userId;
  const permissionKeys = isOwner
    ? [...ERP_PERMISSION_KEYS]
    : await getMemberPermissionKeys(context.member.id);
  return {
    ...context,
    permissionKeys,
    isOwner,
    dataOwnerUserId: context.enterprise.crmDataOwnerUserId,
    portalOwnerUserId: context.enterprise.superAdminUserId,
  };
}

export async function requireActiveEnterpriseScope(userId: number) {
  const scope = await resolveEnterprisePermissionScope(userId);
  if (!scope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号尚未加入企业", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  if (scope.member.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业成员身份已暂停", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  return scope;
}

export async function requireEnterprisePermission(
  userId: number,
  permissionKey: ErpPermissionKey,
) {
  const scope = await requireActiveEnterpriseScope(userId);
  if (!scope.isOwner && !scope.permissionKeys.includes(permissionKey)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有该ERP功能权限" });
  }
  return scope;
}

export async function requireAnyEnterprisePermission(
  userId: number,
  permissionKeys: readonly ErpPermissionKey[],
) {
  const scope = await requireActiveEnterpriseScope(userId);
  if (
    permissionKeys.length === 0
    || (!scope.isOwner && !permissionKeys.some(key => scope.permissionKeys.includes(key)))
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有该ERP功能权限" });
  }
  return scope;
}

export async function requireEnterprisePermissionManager(userId: number) {
  return requireEnterprisePermission(userId, "enterprise.members.manage");
}

export function assertGrantSubset(
  actor: EnterprisePermissionScope,
  targetPermissions: readonly ErpPermissionKey[],
) {
  if (actor.isOwner) return;
  const actorSet = new Set(actor.permissionKeys);
  if (targetPermissions.some(permission => !actorSet.has(permission))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只能授予您自己已拥有的ERP权限",
    });
  }
}

export async function replaceEnterpriseMemberPermissions(input: {
  actorUserId: number;
  targetUserId: number;
  permissionKeys: readonly string[];
  requestId: string;
}) {
  const actor = await requireEnterprisePermissionManager(input.actorUserId);
  const permissionKeys = normalizePermissionInput(input.permissionKeys);
  assertGrantSubset(actor, permissionKeys);
  if (input.targetUserId === input.actorUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的ERP权限" });
  }

  const db = await requireDb();
  return db.transaction(async tx => {
    const idempotent = (
      await tx
        .select({
          targetUserId: enterprisePermissionAuditLogs.targetUserId,
          action: enterprisePermissionAuditLogs.action,
          afterPermissions: enterprisePermissionAuditLogs.afterPermissions,
        })
        .from(enterprisePermissionAuditLogs)
        .where(eq(enterprisePermissionAuditLogs.requestId, input.requestId))
        .limit(1)
    )[0];
    if (idempotent) {
      if (idempotent.targetUserId !== input.targetUserId || idempotent.action !== "permissions_updated") {
        throw new TRPCError({ code: "CONFLICT", message: "请求号已用于其他权限操作" });
      }
      const applied = normalizeErpPermissions(idempotent.afterPermissions ?? []);
      if (JSON.stringify(applied) !== JSON.stringify(permissionKeys)) {
        throw new TRPCError({ code: "CONFLICT", message: "请求号对应的权限内容不一致" });
      }
      return { success: true, idempotent: true, permissionKeys: applied } as const;
    }

    const target = (
      await tx
        .select()
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
            eq(enterpriseMembers.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "企业成员不存在" });
    }
    if (target.role === "super_admin" || actor.enterprise.superAdminUserId === target.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者权限不能在此修改" });
    }

    const previous = await tx
      .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
      .from(enterpriseMemberPermissions)
      .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
    const beforePermissions = normalizeErpPermissions(previous.map(row => row.permissionKey));

    await tx
      .delete(enterpriseMemberPermissions)
      .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
    await tx.insert(enterpriseMemberPermissions).values(
      permissionKeys.map(permissionKey => ({
        enterpriseMemberId: target.id,
        permissionKey,
        grantedByUserId: input.actorUserId,
      })),
    );
    await tx
      .update(enterpriseMembers)
      .set({ permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1` })
      .where(eq(enterpriseMembers.id, target.id));
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: actor.enterprise.id,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "permissions_updated",
      beforePermissions,
      afterPermissions: permissionKeys,
      requestId: input.requestId,
    });

    return { success: true, idempotent: false, permissionKeys } as const;
  });
}

/** 调整成员可见业务范围；全企业范围属于高权限，只允许企业所有者授予。 */
export async function updateEnterpriseMemberInventoryScope(input: {
  actorUserId: number;
  targetUserId: number;
  inventoryDataScope: "own" | "enterprise";
  requestId: string;
}) {
  const actor = await requireEnterprisePermissionManager(input.actorUserId);
  if (input.inventoryDataScope === "enterprise" && !actor.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业所有者可授予全企业业务范围" });
  }
  if (input.targetUserId === input.actorUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的业务范围" });
  }
  const db = await requireDb();
  return db.transaction(async tx => {
    const target = (
      await tx
        .select()
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
            eq(enterpriseMembers.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "企业成员不存在" });
    if (target.role === "super_admin" || target.userId === actor.enterprise.superAdminUserId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者始终拥有全企业业务范围" });
    }
    if (target.inventoryDataScope === input.inventoryDataScope) {
      return { success: true as const, idempotent: true };
    }
    const permissionKeys = await tx
      .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
      .from(enterpriseMemberPermissions)
      .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
    const normalized = normalizeErpPermissions(permissionKeys.map(row => row.permissionKey));
    await tx
      .update(enterpriseMembers)
      .set({
        inventoryDataScope: input.inventoryDataScope,
        permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1`,
      })
      .where(eq(enterpriseMembers.id, target.id));
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: actor.enterprise.id,
      actorUserId: input.actorUserId,
      targetUserId: target.userId,
      action: "permissions_updated",
      beforePermissions: normalized,
      afterPermissions: normalized,
      requestId: input.requestId,
      note: `inventoryDataScope:${target.inventoryDataScope}->${input.inventoryDataScope}`,
    });
    return { success: true as const, idempotent: false };
  });
}
