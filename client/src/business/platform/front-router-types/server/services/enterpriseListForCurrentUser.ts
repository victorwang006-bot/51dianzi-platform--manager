import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import {
  enterpriseMembers,
  enterprises,
  type Enterprise,
  type EnterpriseMember,
} from "../../drizzle/schema";
import { ERP_PERMISSION_KEYS, type ErpPermissionKey } from "../../../shared/erpPermissions";
import { getDb } from "../db";
import { getAdminCrmAccess, getAdminHkCrmAccess } from "./customerService";
import { listPermissionKeysByMemberIds } from "./enterprisePermissions";

export type EnterpriseAccessStatus = "enabled" | "pending" | "rejected" | "disabled";
export type EnterpriseMembershipRow = { enterprise: Enterprise; member: EnterpriseMember };
export type EnterpriseListItem = {
  enterpriseId: number;
  companyName: string;
  registrationRegion: string;
  role: string;
  isOwner: boolean;
  memberStatus: string;
  accessStatus: EnterpriseAccessStatus;
  permissionKeys: ErpPermissionKey[];
};

type AdminAccessStatus = { allowed?: boolean; crmStatus?: string | null };

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

/** Exact production normalization: unknown authority responses are disabled, never enabled. */
export function enterpriseAccessStatus(status: AdminAccessStatus): EnterpriseAccessStatus {
  if (status.allowed || status.crmStatus === "enabled") return "enabled";
  if (status.crmStatus === "pending") return "pending";
  if (status.crmStatus === "rejected") return "rejected";
  return "disabled";
}

/** Read the administration system authority; service failure is fail-closed rather than guessed. */
export async function readAuthoritativeEnterpriseAccessStatus(enterprise: Enterprise): Promise<EnterpriseAccessStatus> {
  if (enterprise.registrationRegion === "HK") {
    if (!enterprise.registrationIdentifier?.trim()) return "disabled";
    try {
      return enterpriseAccessStatus(await getAdminHkCrmAccess({
        registrationIdentifier: enterprise.registrationIdentifier,
        portalUserId: enterprise.superAdminUserId,
      }));
    } catch (cause) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "企业ERP权威状态暂时无法确认，请稍后重试",
        cause,
      });
    }
  }
  if (!enterprise.creditCode?.trim()) return "disabled";
  try {
    return enterpriseAccessStatus(await getAdminCrmAccess({
      creditCode: enterprise.creditCode,
      portalUserId: enterprise.superAdminUserId,
    }));
  } catch (cause) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "企业ERP权威状态暂时无法确认，请稍后重试",
      cause,
    });
  }
}

/** Pure projection retained for zero-DB contract tests. */
export function projectEnterpriseListForCurrentUser(input: {
  userId: number;
  memberships: readonly EnterpriseMembershipRow[];
  accessStatuses: readonly EnterpriseAccessStatus[];
  permissionKeysByMember: ReadonlyMap<number, readonly ErpPermissionKey[]>;
}): { items: EnterpriseListItem[]; selectionRequired: boolean } {
  if (input.memberships.length !== input.accessStatuses.length) {
    throw new Error("enterprise access status count must match memberships");
  }
  return {
    items: input.memberships.map(({ enterprise, member }, index) => {
      const isOwner = member.status === "active"
        && member.role === "super_admin"
        && enterprise.superAdminUserId === input.userId;
      return {
        enterpriseId: enterprise.id,
        companyName: enterprise.companyName,
        registrationRegion: enterprise.registrationRegion,
        role: member.role,
        isOwner,
        memberStatus: member.status,
        accessStatus: input.accessStatuses[index],
        permissionKeys: isOwner
          ? [...ERP_PERMISSION_KEYS]
          : [...(input.permissionKeysByMember.get(member.id) ?? [])],
      };
    }),
    selectionRequired: input.memberships.length > 1,
  };
}

/**
 * Data source for the existing enterprise switcher. It reads only actual membership
 * relations and never creates, changes, invites, or switches any user/company data.
 */
export async function listEnterprisesForCurrentUser(userId: number) {
  const db = await requireDb();
  const memberships = await db
    .select({ enterprise: enterprises, member: enterpriseMembers })
    .from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterpriseMembers.enterpriseId, enterprises.id))
    .where(eq(enterpriseMembers.userId, userId))
    .orderBy(asc(enterpriseMembers.enterpriseId));
  const permissionKeysByMember = await listPermissionKeysByMemberIds(
    memberships.map(row => row.member.id),
  );
  const accessStatuses = await Promise.all(
    memberships.map(row => readAuthoritativeEnterpriseAccessStatus(row.enterprise)),
  );
  return projectEnterpriseListForCurrentUser({
    userId,
    memberships,
    accessStatuses,
    permissionKeysByMember,
  });
}
