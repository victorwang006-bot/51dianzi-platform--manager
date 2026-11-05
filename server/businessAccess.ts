import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { adminUsers } from "../drizzle/schema";
import type { OfficialInventoryPermissions } from "./platformBusinessApi";
import type { Merchant } from "../drizzle/schema";
import { hasAdminPermission, type AdminPermission } from "../shared/adminPermissions";
import { BusinessFailureCause } from "../shared/businessFailure";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import type { BusinessWorkbenchProjection } from "./businessWorkbenchProjection";

/**
 * Historical compatibility names, stored only in the independent BFF scope
 * record. They are never copied to admin_user_permissions or used as native
 * dashboard grants; original front staff permissions remain authoritative.
 */
export const BUSINESS_ADMIN_PERMISSIONS = [
  "business.context.read",
  "business.inventory.read",
  "business.inventory.write",
  "business.customers.read",
  "business.customers.write",
  "business.procurement.read",
  "business.procurement.write",
  "business.users.read",
  "business.users.write",
  "business.orders.read",
  "business.orders.write",
] as const satisfies readonly AdminPermission[];

export type BusinessModule = "context" | "inventory" | "customers" | "procurement" | "users" | "orders";
export type BusinessAccessMode = "read" | "write";

export function businessScopePermission(
  module: BusinessModule,
  mode: BusinessAccessMode,
): (typeof BUSINESS_ADMIN_PERMISSIONS)[number] {
  return `business.${module}.${mode}` as (typeof BUSINESS_ADMIN_PERMISSIONS)[number];
}

export function businessScopeAllows(
  scope: { modulePermissions: readonly string[] } | null | undefined,
  module: BusinessModule,
  mode: BusinessAccessMode,
) {
  return scope?.modulePermissions.includes(businessScopePermission(module, mode)) ?? false;
}

export type BusinessEnterpriseBinding = {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedOwnerUserId: number;
};

type BusinessMerchantBindingSource = Pick<Merchant,
  | "id"
  | "merchantNo"
  | "companyName"
  | "crmStatus"
  | "registrationRegion"
  | "registrationIdentifier"
  | "businessLicense"
  | "crmOwnerPortalUserId"
>;

/**
 * No OAuth compatibility account may operate the business BFF.  Unlike legacy
 * dashboard procedures, this boundary needs a concrete active admin_users record
 * because it is forwarded as the auditable staff identity to internal services.
 */
export function requireBusinessAdminAccount(ctx: TrpcContext) {
  if (!ctx.user || ctx.user.role !== "admin" || !ctx.adminAccount) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请使用有效的后台工作人员账号登录后访问业务服务",
      cause: new BusinessFailureCause("AUTH_SESSION_INVALID"),
    });
  }
  if (ctx.adminAccount.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "后台工作人员账号已不可用", cause: new BusinessFailureCause("AUTH_SESSION_INVALID") });
  }
  return ctx.adminAccount;
}

/** Staff-to-front-user binding is an account-administration operation, never a business-module grant. */
export function requireBusinessBindingManager(ctx: TrpcContext) {
  const account = requireBusinessAdminAccount(ctx);
  if (!hasAdminPermission(account.adminRole, "admins.manage", ctx.adminPermissions)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅获授管理员管理权限的后台账号可维护业务员工绑定" });
  }
  return account;
}

/**
 * Exact trusted tenant scope. This is intentionally independent from native
 * backend sales scopes: a real bound front staff member must not be blocked
 * from their own enterprise merely because their backend sales code differs.
 *
 * Deployment must set BUSINESS_WORKBENCH_MERCHANT_IDS. Empty/malformed values
 * fail closed. Production additionally admits exactly merchant 30061.
 */
export function getBusinessWorkbenchMerchantIds(
  env: { BUSINESS_WORKBENCH_MERCHANT_IDS?: string; NODE_ENV?: string } = process.env as {
    BUSINESS_WORKBENCH_MERCHANT_IDS?: string;
    NODE_ENV?: string;
  },
): number[] {
  const raw = env.BUSINESS_WORKBENCH_MERCHANT_IDS?.trim() ?? "";
  if (!raw) return [];
  const parts = raw.split(",").map(value => value.trim());
  if (parts.length === 0 || parts.length > 32 || parts.some(value => !/^[1-9]\d{0,9}$/.test(value))) {
    return [];
  }
  const ids = parts.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    return [];
  }
  if (env.NODE_ENV === "production" && (ids.length !== 1 || ids[0] !== 30061)) {
    return [];
  }
  return ids;
}

/**
 * Browser input is only the numeric merchant header.  Arrays and comma-joined values
 * are rejected, so a proxy cannot cause an ambiguous tenant selection.
 */
export function parseBusinessMerchantId(value: unknown): number {
  if (Array.isArray(value) || typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value.trim())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请在请求头提供有效的业务商户标识" });
  }
  const merchantId = Number(value.trim());
  if (!Number.isSafeInteger(merchantId) || merchantId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "业务商户标识无效" });
  }
  return merchantId;
}

export function businessMerchantIdFromContext(ctx: TrpcContext) {
  return parseBusinessMerchantId(ctx.req.headers["x-business-merchant-id"]);
}

/**
 * Workbench tenant choice never reads native backend sales/owner scopes. All
 * roles, including super_admin, require the independently auditable exact scope
 * plus the approved BFF module; the portal then enforces original fine rights.
 */
export async function assertBusinessMerchantAccess(
  ctx: TrpcContext,
  merchantId: number,
  module: BusinessModule,
  mode: BusinessAccessMode,
  officialReadProjection = false,
): Promise<Merchant> {
  const account = requireBusinessAdminAccount(ctx);
  const allowedMerchantIds = getBusinessWorkbenchMerchantIds();
  if (!allowedMerchantIds.includes(merchantId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "商户不存在或不在工作台允许范围内", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);
  if (!scope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的业务工作台范围授权", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  if (!businessScopeAllows(scope, module, mode) && !(officialReadProjection && mode === "read" && (module === "context" || module === "inventory"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的业务工作台范围授权" });
  }
  const merchant = await db.getBusinessWorkbenchMerchantById(merchantId);
  if (!merchant) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "商户不存在或不在工作台允许范围内",
    });
  }
  return merchant;
}

/**
 * Only information from the range-checked local merchant record may cross the
 * service boundary.  The browser never supplies an enterprise, owner or actor.
 */
export function businessEnterpriseBindingFromMerchant(merchant: BusinessMerchantBindingSource): BusinessEnterpriseBinding {
  if (merchant.crmStatus !== "enabled") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该商户尚未启用ERP业务" });
  }
  const ownerText = merchant.crmOwnerPortalUserId?.trim() ?? "";
  const expectedOwnerUserId = Number(ownerText);
  if (!/^\d+$/.test(ownerText) || !Number.isSafeInteger(expectedOwnerUserId) || expectedOwnerUserId <= 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "商户ERP企业所有者绑定异常，请先核对" });
  }
  if (merchant.registrationRegion === "HK") {
    const registrationIdentifier = merchant.registrationIdentifier?.trim().toUpperCase() ?? "";
    if (!/^HK:\d{8}$/.test(registrationIdentifier)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "商户香港ERP企业绑定异常，请先核对" });
    }
    return { registrationIdentifier, expectedOwnerUserId };
  }
  const creditCode = merchant.businessLicense?.trim().replace(/\s+/g, "").toUpperCase() ?? "";
  if (!creditCode) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "商户缺少有效统一社会信用代码" });
  }
  return { creditCode, expectedOwnerUserId };
}

/**
 * This projection deliberately excludes license object keys, contacts and owner IDs.
 * Capability fields are the exact one-merchant scope/front intersection, never a
 * union across merchants or a native admin permission projection.
 */
export function toBusinessMerchantChoice(
  merchant: BusinessMerchantBindingSource,
  projection: BusinessWorkbenchProjection,
) {
  return {
    id: merchant.id,
    merchantNo: merchant.merchantNo,
    companyName: merchant.companyName,
    crmStatus: merchant.crmStatus,
    registrationRegion: merchant.registrationRegion,
    available: projection.workbenchCapabilities.length > 0,
    canWrite: projection.canWrite,
    workbenchCapabilities: projection.workbenchCapabilities,
    writeCapabilities: projection.writeCapabilities,
    moduleAvailability: projection.moduleAvailability,
    officialInventoryPermissions: projection.officialInventoryPermissions,
  };
}

/** Live native grants are never inferred from browser permission arrays or ERP manage. */
export async function currentOfficialInventoryPermissions(ctx: TrpcContext): Promise<OfficialInventoryPermissions> {
  const session = requireBusinessAdminAccount(ctx);
  const account = await db.getAdminUserById(session.id);
  if (!account || account.status !== "active") throw new TRPCError({ code: "UNAUTHORIZED", message: "后台工作人员账号已不可用", cause: new BusinessFailureCause("AUTH_SESSION_INVALID") });
  const permissions = await db.getAdminUserPermissions(account.id);
  const has = (key: string) => account.adminRole === "super_admin" || permissions.includes(key);
  const grant = { read: has("officialInventory.read"), write: has("officialInventory.write"), note: has("officialInventory.note"), publish: has("officialInventory.publish") };
  return { ...grant, authorizationVersion: `official-inventory-v1:${createHash("sha256").update(JSON.stringify({ id: account.id, role: account.adminRole, status: account.status, sessionVersion: account.sessionVersion, ...grant })).digest("hex")}` };
}
/** Only attested creation IDs from the internal list are admitted; no current binding/name inference. */
export async function officialRecorderNames(ids: readonly number[]) {
  const unique = Array.from(new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0)));
  if (unique.length > 100) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "库存负责人结果超出范围" });
  const names = new Map<number, string | null>();
  if (!unique.length) return names;
  const database = await db.getDb();
  if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "库存负责人暂时无法核实" });
  const accounts = await database.select({ id: adminUsers.id, displayName: adminUsers.displayName, username: adminUsers.username }).from(adminUsers).where(inArray(adminUsers.id, unique)).limit(100);
  for (const account of accounts) names.set(account.id, account.displayName?.trim() || account.username?.trim() || null);
  return names;
}

export const businessAccessTestUtils = {
  parseBusinessMerchantId,
  getBusinessWorkbenchMerchantIds,
  businessScopePermission,
  businessScopeAllows,
  businessEnterpriseBindingFromMerchant,
};
