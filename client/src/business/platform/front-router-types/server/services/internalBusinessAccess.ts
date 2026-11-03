import { TRPCError } from "@trpc/server";
import type { OfficialInventoryPermissions } from "../../../shared/internalBusinessOfficialInventory";
import { BusinessFailureCause } from "../../../shared/businessFailure";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { enterpriseMembers, enterprises, type User } from "../../drizzle/schema";
import type { ErpPermissionKey } from "../../../shared/erpPermissions";
import { customerListSchema } from "../../../shared/crmCustomers";
import { purchaseOrderListSchema } from "../../../shared/purchaseOrders";
import { salesOrderListSchema } from "../../../shared/crmSalesOrders";
import { toPublicAuthUser, type PublicAuthUser } from "../publicAuthUser";
import { getAdminCrmAccess, getAdminHkCrmAccess } from "../adminCrmGateway";
import { getDb, getOrdersBySeller, getUserById } from "../db";
import { requireCrmEnterpriseAccess } from "./enterpriseAccess";
import { runWithEnterpriseRequestContext } from "./enterpriseRequestContext";
import {
  requireActiveEnterpriseScope,
  requireAnyEnterprisePermission,
  requireEnterprisePermission,
  type EnterprisePermissionScope,
} from "./enterprisePermissions";
import { listCustomers } from "./crmCustomers";
import { listPurchaseOrders } from "./purchaseOrders";
import { listSalesOrders } from "./crmSalesOrders";
import { normalizeEnterpriseCreditCode } from "./enterpriseAccess";
import { normalizeHkEnterpriseRegistrationIdentifier } from "./enterpriseRegistrationIdentity";
import { BUSINESS_MODULES } from "../../../shared/businessOrganization";
import { businessRows, resolveBusinessModuleAccess } from "./businessModuleAccess";
import { effectiveBusinessTeam, internalBusinessAuthorizationVersion } from "./internalBusinessAuthorization";
import {
  BUSINESS_CHAT_METHOD_IDS,
  BUSINESS_CHAT_METHOD_POLICIES,
} from "../../../shared/businessChat";

export type InternalBusinessBinding = {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedOwnerUserId: number;
};

type InternalBusinessEnterpriseContext = {
  enterpriseId: number;
  companyName: string;
  dataOwnerUserId: number;
  ownerUserId: number;
  identity: { kind: "CN"; creditCode: string } | { kind: "HK"; registrationIdentifier: string };
};

export type InternalBusinessStaffPrincipalDto = {
  status: "ready";
  frontendUserId: number;
  user: PublicAuthUser;
  adminAccountId: number;
  enterpriseId: number;
  bindingVersion: number;
};

export const INTERNAL_BUSINESS_WORKBENCH_CAPABILITIES = [
  "inventory.read",
  "inventory.publish",
  "inventory.inbound",
  "inventory.channel",
  "customers.manage",
  "crm.sales_orders",
  "procurement.demands",
  "procurement.orders",
  "inquiry.receive",
  "enterprise.members.manage",
  "company.read",
  // Marketplace seller operations are original actor-local sellerId operations,
  // not the ERP sales_orders.manage/outbound permission.
  "marketplace.seller",
] as const;

export type InternalBusinessWorkbenchCapability =
  (typeof INTERNAL_BUSINESS_WORKBENCH_CAPABILITIES)[number];

export type InternalBusinessContextDto = Omit<InternalBusinessEnterpriseContext, "identity"> & {
  staffPrincipal: InternalBusinessStaffPrincipalDto;
  officialInventoryPermissions?: OfficialInventoryPermissions;
  /** Stable server authorization fingerprint; not a clock or a browser revision. */
  authorizationVersion: string;
  /** Compatibility projection; authoritative only for conservative UI display. */
  enabledModules: readonly InternalBusinessWorkbenchCapability[];
  /** Derived from the current real staff membership and original front permissions. */
  workbenchCapabilities: readonly InternalBusinessWorkbenchCapability[];
  /** `chat` remains the unavailable full personal-chat capability. */
  sessionCapabilities: Readonly<{
    chat: false;
    /** Narrow enterprise reception UI: distinct from the personal chat capability. */
    receptionReady: boolean;
  }>;
};

export type InternalBusinessTrustedBinding = {
  officialInventoryPermissions?: OfficialInventoryPermissions;
  staffUserId: number;
  adminAccountId: number;
  bindingVersion: number;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function normalizedBinding(input: InternalBusinessBinding) {
  const creditCode = input.creditCode?.trim();
  const registrationIdentifier = input.registrationIdentifier?.trim();
  if (Boolean(creditCode) === Boolean(registrationIdentifier)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能提供统一社会信用代码或香港企业标识" });
  }
  if (!Number.isSafeInteger(input.expectedOwnerUserId) || input.expectedOwnerUserId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "预期企业所有者无效" });
  }
  if (creditCode) {
    return { kind: "CN" as const, creditCode: normalizeEnterpriseCreditCode(creditCode) };
  }
  try {
    return { kind: "HK" as const, registrationIdentifier: normalizeHkEnterpriseRegistrationIdentifier(registrationIdentifier!) };
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN" });
  }
}

/** The ERP authority is remote and deliberately rechecked on every internal request. */
async function requireCurrentErpAuthority(
  identity: ReturnType<typeof normalizedBinding>,
  ownerUserId: number,
) {
  try {
    const access = identity.kind === "CN"
      ? await getAdminCrmAccess({ creditCode: identity.creditCode, portalUserId: String(ownerUserId) })
      : await getAdminHkCrmAccess({ registrationIdentifier: identity.registrationIdentifier, portalUserId: String(ownerUserId) });
    if (!access.allowed) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "企业ERP当前未开通或已停用", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[internalBusiness] ERP authority check failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "企业ERP状态暂时无法确认，请稍后重试" });
  }
}

/** Resolve the selected tenant, never turning its owner/data owner into an actor. */
export async function resolveInternalBusinessEnterprise(
  input: InternalBusinessBinding,
): Promise<InternalBusinessEnterpriseContext> {
  const db = await requireDb();
  const identity = normalizedBinding(input);
  const enterprise = (await db
    .select({
      id: enterprises.id,
      companyName: enterprises.companyName,
      superAdminUserId: enterprises.superAdminUserId,
      crmDataOwnerUserId: enterprises.crmDataOwnerUserId,
    })
    .from(enterprises)
    .where(identity.kind === "CN"
      ? eq(enterprises.creditCode, identity.creditCode)
      : and(
          eq(enterprises.registrationRegion, "HK"),
          eq(enterprises.registrationIdentifier, identity.registrationIdentifier),
        ))
    .limit(1))[0];
  if (!enterprise) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  if (enterprise.superAdminUserId !== input.expectedOwnerUserId) {
    throw new TRPCError({ code: "CONFLICT", message: "企业所有者已变化，请刷新后重试", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }

  const ownerMember = (await db
    .select({ id: enterpriseMembers.id, status: enterpriseMembers.status })
    .from(enterpriseMembers)
    .where(and(
      eq(enterpriseMembers.enterpriseId, enterprise.id),
      eq(enterpriseMembers.userId, enterprise.superAdminUserId),
    ))
    .limit(1))[0];
  if (!ownerMember || ownerMember.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "企业所有者成员身份不可用", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }

  await requireCurrentErpAuthority(identity, enterprise.superAdminUserId);
  return {
    enterpriseId: enterprise.id,
    companyName: enterprise.companyName,
    dataOwnerUserId: enterprise.crmDataOwnerUserId,
    ownerUserId: enterprise.superAdminUserId,
    identity,
  };
}

/** A binding candidate must be a real, enabled front account with a login record. */
async function requireEnabledFrontStaffUser(staffUserId: number): Promise<User> {
  if (!Number.isSafeInteger(staffUserId) || staffUserId <= 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "缺少经授权的企业员工业务主体", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
  }
  const user = await getUserById(staffUserId);
  if (!user || user.loginDisabled || !user.lastSignedIn) {
    throw new TRPCError({ code: "FORBIDDEN", message: "绑定的前台员工账号不存在、已停用或未完成登录", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
  }
  return user;
}

/** Used only by the backend binding registrar after portal-key authentication. */
export async function validateInternalBusinessStaffBindingCandidate(staffUserId: number) {
  const user = await requireEnabledFrontStaffUser(staffUserId);
  return { frontendUserId: user.id, user: toPublicAuthUser(user) };
}

export type InternalBusinessStaffPrincipal = {
  enterprise: InternalBusinessEnterpriseContext;
  permissionScope: EnterprisePermissionScope;
  actorUserId: number;
  user: User;
  publicUser: PublicAuthUser;
};

/**
 * The sole actor-isolation entry point for business BFF staff work. The tenant
 * comes from the server-resolved binding, not from any browser header, and the
 * data owner is never substituted for actorUserId.
 */
export function runWithBoundBusinessStaffActor<T>(input: {
  enterpriseId: number;
  actorUserId: number;
  action: () => T;
}): T {
  return runWithEnterpriseRequestContext({
    enterpriseId: input.enterpriseId,
    applicationId: null,
    newApplication: false,
    actorUserId: input.actorUserId,
  }, input.action);
}

/**
 * Creates an explicit delegated staff principal. It is intentionally based on
 * the real staff user record, never the enterprise owner, data owner, admin ID
 * or a front-browser cookie. It revalidates account, member, remote ERP and
 * data owner on each request.
 */
export async function requireInternalBusinessStaffPrincipal(input: {
  binding: InternalBusinessBinding;
  staffUserId: number;
  /** No value is only for fixed read-only profile/context routes; the target router still enforces its own module gate. */
  permission?: ErpPermissionKey | readonly ErpPermissionKey[];
}): Promise<InternalBusinessStaffPrincipal> {
  const user = await requireEnabledFrontStaffUser(input.staffUserId);
  const enterprise = await resolveInternalBusinessEnterprise(input.binding);
  return runWithBoundBusinessStaffActor({ enterpriseId: enterprise.enterpriseId, actorUserId: user.id, action: async () => {
    const crmAccess = await requireCrmEnterpriseAccess({ user });
    const permissionScope = input.permission === undefined
      ? await requireActiveEnterpriseScope(user.id)
      : typeof input.permission === "string"
        ? await requireEnterprisePermission(user.id, input.permission)
        : await requireAnyEnterprisePermission(user.id, input.permission);
    if (
      permissionScope.enterprise.id !== enterprise.enterpriseId
      || permissionScope.dataOwnerUserId !== enterprise.dataOwnerUserId
      || crmAccess.dataOwnerUserId !== enterprise.dataOwnerUserId
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "企业成员归属或数据所有者已变化，请刷新后重试", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
    }
    return {
      enterprise,
      permissionScope,
      actorUserId: user.id,
      user,
      publicUser: toPublicAuthUser(user),
    };
  }});
}

/** Context needs a live member and ERP account, but deliberately does not grant any module permission. */
async function requireInternalBusinessContextPrincipal(input: {
  binding: InternalBusinessBinding;
  trustedBinding: InternalBusinessTrustedBinding;
}) {
  const user = await requireEnabledFrontStaffUser(input.trustedBinding.staffUserId);
  const enterprise = await resolveInternalBusinessEnterprise(input.binding);
  return runWithBoundBusinessStaffActor({ enterpriseId: enterprise.enterpriseId, actorUserId: user.id, action: async () => {
    const crmAccess = await requireCrmEnterpriseAccess({ user });
    const scope = await requireActiveEnterpriseScope(user.id);
    if (
      scope.enterprise.id !== enterprise.enterpriseId
      || scope.dataOwnerUserId !== enterprise.dataOwnerUserId
      || crmAccess.dataOwnerUserId !== enterprise.dataOwnerUserId
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "绑定员工不再属于所选企业或数据所有者已变化", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
    }
    return { enterprise, user, scope };
  }});
}

async function workbenchCapabilitiesForPrincipal(input: {
  principal: Awaited<ReturnType<typeof requireInternalBusinessContextPrincipal>>;
}): Promise<InternalBusinessWorkbenchCapability[]> {
  const { scope, user } = input.principal;
  const permissions = new Set(scope.permissionKeys);
  const capabilities = new Set<InternalBusinessWorkbenchCapability>(["company.read"]);
  if (scope.isOwner || permissions.has("inventory.manage")) {
    capabilities.add("inventory.read");
    capabilities.add("inventory.channel");
  }
  if (scope.isOwner || permissions.has("inventory.publish")) {
    capabilities.add("inventory.read");
    capabilities.add("inventory.publish");
  }
  if (scope.isOwner || permissions.has("inventory.inbound")) capabilities.add("inventory.inbound");
  if (scope.isOwner || permissions.has("customers.manage") || permissions.has("customers.manage_all")) {
    capabilities.add("customers.manage");
  }
  if (scope.isOwner || permissions.has("sales.business_orders")) capabilities.add("crm.sales_orders");
  if (scope.isOwner || permissions.has("procurement.demands")) capabilities.add("procurement.demands");
  if (scope.isOwner || permissions.has("procurement.orders")) capabilities.add("procurement.orders");
  if (scope.isOwner || permissions.has("inquiry.receive")) capabilities.add("inquiry.receive");
  if (scope.isOwner || permissions.has("enterprise.members.manage")) capabilities.add("enterprise.members.manage");
  // `sales_orders.manage` is deliberately irrelevant here. The original
  // marketplace route allows only rows whose sellerId is the real bound staff.
  if ((await getOrdersBySeller(user.id)).length > 0) capabilities.add("marketplace.seller");
  return INTERNAL_BUSINESS_WORKBENCH_CAPABILITIES.filter(capability => capabilities.has(capability));
}

/**
 * This is intentionally separate from `sessionCapabilities.chat`: the latter
 * would advertise the staff member's full personal chat account. Reception is
 * ready only after the current request has revalidated the real bound actor,
 * selected enterprise and actual receive/owner permission. The source-controlled
 * business-chat policy must also remain a complete inquiry.receive-only closure.
 */
function isBusinessReceptionReady(input: {
  principal: Awaited<ReturnType<typeof requireInternalBusinessContextPrincipal>>;
  trustedBinding: InternalBusinessTrustedBinding;
}) {
  const { principal, trustedBinding } = input;
  const allowListClosed = BUSINESS_CHAT_METHOD_IDS.length > 0
    && Object.keys(BUSINESS_CHAT_METHOD_POLICIES).length === BUSINESS_CHAT_METHOD_IDS.length
    && BUSINESS_CHAT_METHOD_IDS.every(method => {
      const policy = BUSINESS_CHAT_METHOD_POLICIES[method];
      return policy?.permission === "inquiry.receive" && (policy.resource === "list" || policy.resource === "conversation" || policy.resource === "message" || policy.resource === "attachment" || policy.resource === "group");
    });
  const actualReceiveAuthority = principal.scope.isOwner
    || principal.scope.permissionKeys.includes("inquiry.receive");
  return allowListClosed
    && principal.user.id === trustedBinding.staffUserId
    && principal.scope.member.userId === trustedBinding.staffUserId
    && principal.scope.member.status === "active"
    && principal.scope.enterprise.id === principal.enterprise.enterpriseId
    && actualReceiveAuthority;
}

export async function getInternalBusinessContext(
  input: InternalBusinessBinding,
  trustedBinding: InternalBusinessTrustedBinding,
): Promise<InternalBusinessContextDto> {
  if (!Number.isSafeInteger(trustedBinding.adminAccountId) || trustedBinding.adminAccountId <= 0
    || !Number.isSafeInteger(trustedBinding.bindingVersion) || trustedBinding.bindingVersion <= 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "后台员工绑定元数据无效", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
  }
  const principal = await requireInternalBusinessContextPrincipal({ binding: input, trustedBinding });
  const { enterprise } = principal;
  const db = await requireDb();
  const memberships = businessRows(await db.execute(sql`SELECT tm.teamId, tm.teamRole
    FROM enterprise_team_members tm INNER JOIN enterprise_teams t
      ON t.enterpriseId = tm.enterpriseId AND t.id = tm.teamId AND t.status = 'active'
    WHERE tm.enterpriseId = ${enterprise.enterpriseId} AND tm.userId = ${principal.user.id}`));
  const team = effectiveBusinessTeam(memberships);
  const modules = await Promise.all(BUSINESS_MODULES.map(async module => {
    try {
      return { module, access: await resolveBusinessModuleAccess(principal.user.id, enterprise.enterpriseId, module, db) };
    } catch (error) {
      // Arguments are already validated server identities and a compiled module;
      // this helper's FORBIDDEN here means real membership/account loss, not a row denial.
      if (error instanceof TRPCError && error.code === "FORBIDDEN") {
        throw new TRPCError({ code: error.code, message: error.message, cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
      }
      throw error;
    }
  }));
  const workbenchCapabilities = await workbenchCapabilitiesForPrincipal({ principal });
  const native = trustedBinding.officialInventoryPermissions;
  const stockAccess = native ? await resolveBusinessModuleAccess(principal.user.id, enterprise.enterpriseId, "stocks", db, { officialInventoryRead: native.read }) : undefined;
  const originalStock = modules.find(item => item.module === "stocks")?.access;
  const officialInventoryPermissions = native ? { ...native, read: native.read && stockAccess?.read === true,
    write: native.read && native.write && originalStock?.write === true && (principal.scope.isOwner || principal.scope.permissionKeys.includes("inventory.manage")),
    note: native.read && native.note && stockAccess?.read === true } : undefined;
  if (native) {
    const index = workbenchCapabilities.indexOf("inventory.channel");
    if (index >= 0) workbenchCapabilities.splice(index, 1);
    if (officialInventoryPermissions?.read) workbenchCapabilities.push("inventory.channel");
  }
  return {
    enterpriseId: enterprise.enterpriseId,
    companyName: enterprise.companyName,
    dataOwnerUserId: enterprise.dataOwnerUserId,
    ownerUserId: enterprise.ownerUserId,
    officialInventoryPermissions,
    authorizationVersion: internalBusinessAuthorizationVersion({ scope: principal.scope, team, modules }),
    staffPrincipal: {
      status: "ready",
      frontendUserId: principal.user.id,
      user: toPublicAuthUser(principal.user),
      adminAccountId: trustedBinding.adminAccountId,
      enterpriseId: enterprise.enterpriseId,
      bindingVersion: trustedBinding.bindingVersion,
    },
    enabledModules: workbenchCapabilities,
    workbenchCapabilities,
    sessionCapabilities: {
      chat: false,
      receptionReady: isBusinessReceptionReady({ principal, trustedBinding }),
    },
  };
}

/* Kept as directly testable, fixed service bridges for existing callers. */
export async function listInternalBusinessCustomers(input: {
  binding: InternalBusinessBinding;
  staffUserId: number;
  filters: z.infer<typeof customerListSchema>;
}) {
  const principal = await requireInternalBusinessStaffPrincipal({
    binding: input.binding,
    staffUserId: input.staffUserId,
    permission: ["customers.manage", "customers.manage_all"],
  });
  return listCustomers({
    enterpriseId: principal.enterprise.enterpriseId,
    actorUserId: principal.actorUserId,
    canManageAll: principal.permissionScope.isOwner
      || principal.permissionScope.permissionKeys.includes("customers.manage_all"),
  }, input.filters);
}

export async function listInternalBusinessPurchaseOrders(input: {
  binding: InternalBusinessBinding;
  staffUserId: number;
  filters: z.infer<typeof purchaseOrderListSchema>;
}) {
  const principal = await requireInternalBusinessStaffPrincipal({
    binding: input.binding,
    staffUserId: input.staffUserId,
    permission: "procurement.orders",
  });
  return listPurchaseOrders({
    enterpriseId: principal.enterprise.enterpriseId,
    ownerUserId: principal.enterprise.dataOwnerUserId,
    actorUserId: principal.actorUserId,
  }, input.filters);
}

export async function listInternalBusinessSalesOrders(input: {
  binding: InternalBusinessBinding;
  staffUserId: number;
  filters: z.infer<typeof salesOrderListSchema>;
}) {
  const principal = await requireInternalBusinessStaffPrincipal({
    binding: input.binding,
    staffUserId: input.staffUserId,
    permission: "sales.business_orders",
  });
  return listSalesOrders({
    enterpriseId: principal.enterprise.enterpriseId,
    actorUserId: principal.actorUserId,
  }, input.filters);
}

export const internalBusinessAccessTestUtils = { normalizedBinding };
