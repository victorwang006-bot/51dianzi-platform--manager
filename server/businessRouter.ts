import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { BusinessFailureCause } from "../shared/businessFailure";
import { router, publicProcedure } from "./_core/trpc";
import { readonlyQueryCorrelation } from "./_core/readonlyQueryTiming";
import {
  assertBusinessMerchantAccess,
  currentOfficialInventoryPermissions,
  officialRecorderNames,
  businessEnterpriseBindingFromMerchant,
  businessMerchantIdFromContext,
  businessScopeAllows,
  BUSINESS_ADMIN_PERMISSIONS,
  getBusinessWorkbenchMerchantIds,
  requireBusinessAdminAccount,
  requireBusinessBindingManager,
  toBusinessMerchantChoice,
  type BusinessAccessMode,
  type BusinessModule,
} from "./businessAccess";
import * as db from "./db";
import {
  callPlatformBusinessCommand,
  getPlatformBusinessContext,
  PlatformBusinessPublicError,
  PlatformBusinessServiceError,
  type PlatformBusinessUpstreamTiming,
  type OfficialInventoryPermissions,
  validatePlatformBusinessStaffCandidate,
} from "./platformBusinessApi";
import type { TrpcContext } from "./_core/context";
import {
  projectBusinessSessionCapabilities,
  projectBusinessWorkbenchCapabilities,
  type BusinessWorkbenchProjection,
} from "./businessWorkbenchProjection";
import {
  contactsAddSchema,
  contactsEditSchema,
  contactsListSchema,
  contactsSetPrimarySchema,
  contactsStopSchema,
  contactsSummarySchema,
  createMultiSchema,
  updateBasicSchema,
} from "../client/src/business/platform/shared/customerContacts";

import { teamMaterialForEditSchema, teamMaterialUpdateSchema, collaborationNotesListSchema, collaborationNotesAddSchema, collaborationNotesEditSchema } from "../client/src/business/platform/shared/channelInventoryCollaboration";
import { teamMaterialSourceSchema } from "../client/src/business/platform/shared/channelInventorySource";
import { CUSTOMER_SUPPLY_BUSINESS_INPUT_SCHEMAS, isCustomerSupplyBusinessMethod } from "./customerSupplyBusinessInput";
import { customerStarContextInputSchema, customerSetStarSchema, customerStarStateInputSchema } from "../client/src/business/platform/shared/customerStars";
import { customerListInputSchema as customerListSchema } from "../client/src/business/platform/front-router-types/server/customerListInput";
import { CHANNEL_MANAGEMENT_BUSINESS_INPUT_SCHEMAS } from "../client/src/business/platform/shared/channelInventoryManagement";
import { channelInventoryListBusinessInputSchema } from "./channelInventoryListBusinessInput";
import { publishFactoryMaterialInputSchema, previewFactoryMaterialReceptionInputSchema, previewFactoryMaterialReceptionResultSchema } from "../client/src/business/platform/shared/channelFactoryPublication";
import { withOfficialChannelProfileRead } from "./services/officialChannelProfileRead";
import { applyBusinessTestOrderArchives } from "./services/businessTestOrderArchive";
const merchantListInput = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(128).optional(),
});
const requestIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const bindingMutationInput = z.object({
  adminUserId: z.number().int().positive(),
  frontUserId: z.number().int().positive(),
  expectedVersion: z.number().int().min(0),
  requestId: requestIdSchema,
});
const bindingRevokeInput = z.object({
  adminUserId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  requestId: requestIdSchema,
});
const businessScopePermissionsInput = z
  .array(z.enum(BUSINESS_ADMIN_PERMISSIONS))
  .min(1)
  .max(BUSINESS_ADMIN_PERMISSIONS.length);
const merchantScopeMutationInput = z.object({
  adminUserId: z.number().int().positive(),
  merchantId: z.number().int().positive(),
  modulePermissions: businessScopePermissionsInput,
  expectedVersion: z.number().int().min(0),
  requestId: requestIdSchema,
});
const merchantScopeRevokeInput = z.object({
  adminUserId: z.number().int().positive(),
  merchantId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  requestId: requestIdSchema,
});

/** CR01: req.ip is the Express-trusted proxy result. x-forwarded-for is never trusted directly. */
function businessAuditActor(ctx: TrpcContext) {
  if (!ctx.adminAccount) throw new Error("BUSINESS_ADMIN_ACCOUNT_REQUIRED");
  const userAgent = ctx.req.headers["user-agent"];
  return {
    operatorId: ctx.adminAccount.id,
    operatorName: ctx.adminAccount.displayName || ctx.adminAccount.username,
    operatorRole: ctx.adminAccount.adminRole,
    ipAddress: ctx.req.ip || null,
    userAgent: Array.isArray(userAgent) ? userAgent[0] ?? null : userAgent ?? null,
  };
}

export type BusinessMethodCapability = {
  method: string;
  module: BusinessModule;
  mode: BusinessAccessMode;
};

/** Auditable, source-controlled BFF capabilities; no browser-supplied method selector exists. */
export const BUSINESS_METHOD_CAPABILITIES = [
  { method: "inventory.*", module: "inventory", mode: "read" },
  { method: "inventory.manage.*", module: "inventory", mode: "write" },
  { method: "channelInventory.listChannels", module: "inventory", mode: "read" },
  { method: "channelInventory.getChannel", module: "inventory", mode: "read" },
  { method: "channelInventory.createChannel", module: "inventory", mode: "write" },
  { method: "channelInventory.updateChannel", module: "inventory", mode: "write" },
  { method: "channelInventory.setChannelActive", module: "inventory", mode: "write" },
  { method: "channelInventory.listMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.listTeamMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.listTeamSourceOptions", module: "inventory", mode: "read" },
  { method: "channelInventory.getTeamMaterialSource", module: "inventory", mode: "read" },
  { method: "channelInventory.getTeamMaterialForEdit", module: "inventory", mode: "write" },
  { method: "channelInventory.updateTeamMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.collaborationNotesList", module: "inventory", mode: "read" },
  { method: "channelInventory.collaborationNotesAdd", module: "inventory", mode: "read" },
  { method: "channelInventory.collaborationNotesEdit", module: "inventory", mode: "read" },

  { method: "channelInventory.exportChannelMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.getMaterial", module: "inventory", mode: "read" },
  { method: "channelInventory.createMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.customerSupplySummary", module: "inventory", mode: "read" },
  { method: "channelInventory.customerSupplyContext", module: "inventory", mode: "read" },
  { method: "channelInventory.createCustomerUploadBatch", module: "inventory", mode: "write" },
  { method: "channelInventory.createCustomerMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.updateMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.listSharedMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.notesList", module: "inventory", mode: "read" },
  { method: "channelInventory.notesAdd", module: "inventory", mode: "write" },
  { method: "channelInventory.notesEdit", module: "inventory", mode: "write" },
  { method: "channelInventory.setMaterialShare", module: "inventory", mode: "write" },
  { method: "channelInventory.deleteMaterials", module: "inventory", mode: "write" },
  { method: "channelInventory.listDeletedMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.restoreMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.createUploadBatch", module: "inventory", mode: "write" },
  { method: "channelInventory.listUploadBatches", module: "inventory", mode: "read" },
  { method: "channelInventory.updateUploadBatch", module: "inventory", mode: "write" },
  { method: "channelInventory.previewDeleteUploadBatch", module: "inventory", mode: "write" },
  { method: "channelInventory.deleteUploadBatch", module: "inventory", mode: "write" },
  { method: "organization.overview", module: "context", mode: "read" },
  { method: "organization.audit", module: "users", mode: "read" },
  { method: "organization.createTeam", module: "users", mode: "write" },
  { method: "organization.updateTeam", module: "users", mode: "write" },
  { method: "organization.setMember", module: "users", mode: "write" },
  { method: "organization.updateMemberAccess", module: "users", mode: "write" },
  { method: "importInventory.*", module: "inventory", mode: "write" },
  { method: "inbound.*", module: "inventory", mode: "write" },
  { method: "customer.starContext", module: "customers", mode: "read" },
  { method: "customer.starState", module: "customers", mode: "read" },
  // A fixed personal-preference command, NOT a grant to all customer writes.
  { method: "customer.setStar", module: "customers", mode: "read" },
  { method: "customer.*", module: "customers", mode: "write" },
  { method: "customerDemand.sales.*", module: "customers", mode: "write" },
  { method: "customerDemand.procurement.*", module: "procurement", mode: "write" },
  { method: "crmSalesOrder.*", module: "orders", mode: "write" },
  { method: "purchaseOrder.*", module: "procurement", mode: "write" },
  { method: "enterprise.me", module: "context", mode: "read" },
  { method: "enterprise.inquiryInbox", module: "inquiries", mode: "read" },
  { method: "enterprise.*", module: "users", mode: "write" },
  { method: "company.read.*", module: "context", mode: "read" },
  { method: "company.write.*", module: "users", mode: "write" },
  { method: "order.seller.read.*", module: "orders", mode: "read" },
  { method: "order.seller.write.*", module: "orders", mode: "write" },
  { method: "material.lookup", module: "inventory", mode: "read" },
  { method: "demand.receivedQuotes", module: "procurement", mode: "read" },
  { method: "chat.read.*", module: "inquiries", mode: "read" },
  { method: "chat.write.*", module: "inquiries", mode: "write" },
] as const satisfies readonly BusinessMethodCapability[];

/** Resolve the mutable local binding for every BFF entry; revoked history is unusable. */
async function requireCurrentBusinessStaffBinding(adminUserId: number) {
  const staffBinding = await db.getActiveBusinessStaffBinding(adminUserId);
  if (!staffBinding) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前后台账号尚未绑定有效的前台业务员工主体",
      cause: new BusinessFailureCause("STAFF_BINDING_INVALID"),
    });
  }
  return staffBinding;
}

function intersectOfficialInventoryPermissions(native: OfficialInventoryPermissions | undefined, front: OfficialInventoryPermissions | undefined) {
  return native ? { ...native, read: native.read && front?.read === true,
    write: native.read && native.write && front?.write === true,
    publish: native.read && native.publish === true && front?.publish === true,
    note: native.read && native.note && front?.note === true } : undefined;
}

function merchantCanEnterWorkbench(
  context: Awaited<ReturnType<typeof getPlatformBusinessContext>>,
  projection: BusinessWorkbenchProjection,
) {
  return context.staffPrincipal.status === "ready" && projection.workbenchCapabilities.length > 0;
}

type NavigationCandidateResult = "AVAILABLE" | "INELIGIBLE" | "RATE_LIMITED" | "UNAVAILABLE";

const NAVIGATION_INELIGIBLE_TRPC_CODES = new Set(["FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED"]);

function navigationCandidateResult(error: unknown): Exclude<NavigationCandidateResult, "AVAILABLE"> {
  if (error instanceof PlatformBusinessPublicError) {
    if (error.code === "TOO_MANY_REQUESTS") return "RATE_LIMITED";
    if (NAVIGATION_INELIGIBLE_TRPC_CODES.has(error.code)) return "INELIGIBLE";
    // TIMEOUT, BAD_REQUEST and CONFLICT do not prove a candidate is unauthorized.
    return "UNAVAILABLE";
  }
  if (error instanceof TRPCError) {
    if (error.code === "TOO_MANY_REQUESTS") return "RATE_LIMITED";
    if (NAVIGATION_INELIGIBLE_TRPC_CODES.has(error.code)) return "INELIGIBLE";
    return "UNAVAILABLE";
  }
  if (error instanceof PlatformBusinessServiceError) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

function navigationFailure(result: Exclude<NavigationCandidateResult, "AVAILABLE" | "INELIGIBLE">) {
  if (result === "RATE_LIMITED") {
    return new TRPCError({ code: "TOO_MANY_REQUESTS", message: "业务导航请求过于频繁，请稍后重试" });
  }
  return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务导航暂时不可用，请稍后重试" });
}

function logNavigationCandidate(input: {
  correlationId: string;
  adminAccountId: number;
  candidateCount: number;
  candidateOrdinal: number;
  result: NavigationCandidateResult;
  totalMs: number;
  scopeLookupMs?: number;
  upstreamTiming?: PlatformBusinessUpstreamTiming;
}) {
  // Deliberately no merchant identifier, error name/message/stack, request URL,
  // portal key, Cookie, profile, or SQL. The numeric admin identity is an audit
  // principal, not a user profile, and the correlation id is request-local.
  try {
    const upstreamMs = input.upstreamTiming
      ? input.upstreamTiming.configMs + input.upstreamTiming.requestMs + input.upstreamTiming.decodeMs : 0;
    console.info("[businessBff] navigation candidate", {
      correlationId: input.correlationId,
      identity: { adminAccountId: input.adminAccountId },
      candidateCount: input.candidateCount,
      candidateOrdinal: input.candidateOrdinal,
      result: input.result,
      totalMs: input.totalMs,
      scopeLookupMs: input.scopeLookupMs ?? 0,
      authorizationMs: Math.max(0, input.totalMs - upstreamMs),
      upstreamTiming: input.upstreamTiming ?? null,
    });
  } catch {
    // Observability cannot change authorization or the availability result.
  }
}

type CurrentBusinessAuthorization = {
  account: ReturnType<typeof requireBusinessAdminAccount>;
  staffBinding: Awaited<ReturnType<typeof requireCurrentBusinessStaffBinding>>;
  scope: NonNullable<Awaited<ReturnType<typeof db.getActiveBusinessMerchantScope>>>;
  merchant: Awaited<ReturnType<typeof assertBusinessMerchantAccess>>;
  officialInventoryPermissions?: OfficialInventoryPermissions;
};

/**
 * The authorization linearization point covers fresh binding/scope reads and
 * one remote front call. Binding mutations take the same account lock; scope
 * mutations take the account then merchant lock in this identical order.
 */
async function withCurrentBusinessAuthorization<T>(
  ctx: TrpcContext,
  merchantId: number,
  capability: { module: BusinessModule; mode: BusinessAccessMode; method?: string },
  operation: (authorization: CurrentBusinessAuthorization) => Promise<T>,
) {
  const account = requireBusinessAdminAccount(ctx);
  return db.withBusinessAuthorizationFence({ adminUserId: account.id, merchantId }, async () => {
    const staffBinding = await requireCurrentBusinessStaffBinding(account.id);
    const channel = capability.method?.startsWith("channelInventory.") === true;
    const contextProjection = capability.module === "context" && capability.method === undefined;
    const officialInventoryPermissions = channel || contextProjection ? await currentOfficialInventoryPermissions(ctx) : undefined;
    // These fixed management SELECT/export paths have no independent export grant.
    // Preserve their public read contract, but require official management write.
    const managementRead = ["channelInventory.listMaterials", "channelInventory.getMaterial", "channelInventory.listSharedMaterials", "channelInventory.exportChannelMaterials"].includes(capability.method ?? "");
    if (channel) {
      const notes = ["channelInventory.collaborationNotesList", "channelInventory.collaborationNotesAdd", "channelInventory.collaborationNotesEdit", "channelInventory.notesList", "channelInventory.notesAdd", "channelInventory.notesEdit"].includes(capability.method!);
      const publishing = capability.method === "channelInventory.publishFactoryMaterial";
      const receptionPreview = capability.method === "channelInventory.previewFactoryMaterialReception";
      const requirement = publishing ? "publish" : receptionPreview ? "publish" : notes ? "note" : capability.mode === "write" || managementRead ? "write" : "read";
      if (!officialInventoryPermissions?.read || !officialInventoryPermissions[requirement]) throw new TRPCError({ code: "FORBIDDEN", message: "未获渠道库存对应官方权限" });
    }
    const profileRead = ["channelInventory.listChannels", "channelInventory.getChannel"].includes(capability.method ?? "");
    // The same fresh official-team proof must reach exact stock/source, editor,
    // batch and export paths; ERP leader labels alone are never official scope.
    // Keep unassigned ordinary public-stock reads compatible (no proof), while
    // the original profile endpoints still require a configured official team.
    const withProfileRead = (run: (projection: OfficialInventoryPermissions["channelProfileTeamRead"]) => Promise<T>) =>
      channel ? withOfficialChannelProfileRead(ctx, staffBinding.frontUserId, run, !profileRead) : run(undefined);
    return withProfileRead(async channelProfileTeamRead => {
    const nativeReadMethods = ["channelInventory.listTeamMaterials", "channelInventory.listTeamSourceOptions", "channelInventory.getTeamMaterialSource", "channelInventory.collaborationNotesList", "channelInventory.collaborationNotesAdd", "channelInventory.collaborationNotesEdit", "channelInventory.listDeletedMaterials", "channelInventory.listUploadBatches"];
    const officialReadProjection = officialInventoryPermissions?.read === true && capability.mode === "read"
      && (contextProjection || profileRead || nativeReadMethods.includes(capability.method ?? ""));
    const merchant = await assertBusinessMerchantAccess(ctx, merchantId, capability.module, capability.mode, officialReadProjection);
    // This read occurs while the fence is held and supplies the actual scope
    // version persisted in the generic audit record for a forwarded command.
    const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);
    if (!scope) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的业务工作台范围授权", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
    }
    if (!businessScopeAllows(scope, capability.module, capability.mode) && !officialReadProjection) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的业务工作台范围授权" });
    }
    if (managementRead && !businessScopeAllows(scope, "inventory", "write")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的库存管理范围授权" });
    }
    if (capability.method === "channelInventory.previewFactoryMaterialReception"
      && (!businessScopeAllows(scope, "context", "read") || !businessScopeAllows(scope, "inventory", "write"))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的库存发布范围授权" });
    }
    // Customer supply is the intersection of current inventory and CRM scope.
    // It is deliberately absent from nativeReadMethods: an official inventory
    // read grant never creates a CRM entry point or grants missing local scope.
    // The front repeats real CRM record visibility checks with the bound staff.
    if (isCustomerSupplyBusinessMethod(capability.method) && !businessScopeAllows(scope, "customers", "read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的客户读取范围授权" });
    }
    // Request-local merchant overlay, never a native user grant. All channel
    // commands and signed context projections use this final in-fence snapshot.
    // Standalone channel rules remain unchanged; front linked-company readers
    // additionally require this bit AND their actual current CRM record policy.
    const requestOfficialInventoryPermissions = officialInventoryPermissions ? {
      ...officialInventoryPermissions,
      customerScopeRead: businessScopeAllows(scope, "customers", "read"),
      ...(channelProfileTeamRead ? { channelProfileTeamRead } : {}),
    } : undefined;
    return operation({ account, staffBinding, scope, merchant, officialInventoryPermissions: requestOfficialInventoryPermissions });
    });
  });
}

/** Result identity is server-derived. Only the original action's request key is
 * admitted from params; never persist arbitrary DTOs or expected actor fields. */
function channelCommandResource(method: string, params: unknown, result: unknown) {
  const types: Record<string, "channel" | "channel_material" | "channel_note"> = {
    "channelInventory.createChannel": "channel", "channelInventory.updateChannel": "channel",
    "channelInventory.setChannelActive": "channel", "channelInventory.createMaterial": "channel_material",
    "channelInventory.createCustomerMaterial": "channel_material",
    "channelInventory.updateMaterial": "channel_material", "channelInventory.updateTeamMaterial": "channel_material",
    "channelInventory.setMaterialShare": "channel_material", "channelInventory.notesAdd": "channel_note",
    "channelInventory.notesEdit": "channel_note", "channelInventory.collaborationNotesAdd": "channel_note",
    "channelInventory.collaborationNotesEdit": "channel_note",
  };
  const resourceType = types[method];
  if (!resourceType || !result || typeof result !== "object") return undefined;
  const outer = result as Record<string, unknown>;
  const item = outer.item && typeof outer.item === "object" ? outer.item as Record<string, unknown> : outer;
  const resourceId = method === "channelInventory.createCustomerMaterial"
    ? (outer.item && typeof outer.item === "object" ? item.id : undefined)
    : item.id ?? item.materialId;
  // Do not invent creator/owner identities or coerce browser-like string IDs.
  if (typeof resourceId !== "number" || !Number.isSafeInteger(resourceId) || resourceId <= 0) return undefined;
  const key = params && typeof params === "object" ? (params as Record<string, unknown>).requestId : undefined;
  const actionRequestId = typeof key === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : null;
  if (method === "channelInventory.createCustomerMaterial" && actionRequestId === null) return undefined;
  return { schemaVersion: 1 as const, resourceType, resourceId, actionRequestId };
}

async function forwardBusinessMethod(
  ctx: TrpcContext,
  params: unknown,
  capability: { method: string; module: BusinessModule; mode: BusinessAccessMode },
) {
  // Native backend business.* grants and sales scopes are not a second
  // workbench authorization system. The portal rechecks its original staff
  // permissions for the fixed method below on every request.
  const merchantId = businessMerchantIdFromContext(ctx);
  return withCurrentBusinessAuthorization(ctx, merchantId, capability, async ({ staffBinding, scope, merchant, officialInventoryPermissions }) => {
    const binding = businessEnterpriseBindingFromMerchant(merchant);
    const actor = businessAuditActor(ctx);
    const requestId = randomUUID();
    let result: unknown;
    try {
      result = await callPlatformBusinessCommand({
        binding,
        staffUserId: staffBinding.frontUserId,
        bindingVersion: staffBinding.bindingVersion,
        adminActor: { id: actor.operatorId, name: actor.operatorName, role: actor.operatorRole },
        requestId,
        method: capability.method,
        params,
        officialInventoryPermissions: officialInventoryPermissions ? { ...officialInventoryPermissions,
          write: officialInventoryPermissions.write && businessScopeAllows(scope, "inventory", "write"),
          publish: officialInventoryPermissions.publish === true && businessScopeAllows(scope, "inventory", "write") } : undefined,
      });
    } catch (error) {
      if (error instanceof PlatformBusinessPublicError) {
        // The platform client admits only explicitly allow-listed domain codes and
        // a bounded message; preserve original zod/CAS/permission feedback.
        throw new TRPCError({ code: error.code, message: error.message, cause: error });
      }
      console.error("[businessBff] fixed business command unavailable", {
        method: capability.method,
        merchantId: merchant.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务服务暂时不可用，请稍后重试" });
    }
    if (capability.method === "order.sellerOrders") {
      result = await applyBusinessTestOrderArchives(result, {
        merchantId: merchant.id,
        sellerUserId: staffBinding.frontUserId,
      });
    }
    if (capability.method === "channelInventory.listTeamMaterials" && result && typeof result === "object") {
      const page = result as { items?: Record<string, unknown>[] };
      if (!Array.isArray(page.items) || page.items.length > 100) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "库存列表结果无效" });
      const names = await officialRecorderNames(page.items.map(item => item.recorderAdminAccountId).filter((id): id is number => typeof id === "number"));
      result = { ...page, items: page.items.map(({ recorderAdminAccountId, originalRecorderName: _untrustedName, ...item }) => ({ ...item,
        originalRecorderName: typeof recorderAdminAccountId === "number" ? names.get(recorderAdminAccountId) ?? null : null })) };
    }
    // The new logical read-only source query retains the complete binding/scope
    // fence, but adds no production command-audit DML. Other methods are unchanged.
    if (capability.method === "channelInventory.previewFactoryMaterialReception") {
      const parsed = previewFactoryMaterialReceptionResultSchema.safeParse(result);
      if (!parsed.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "接待预览结果无效，请重新核验" });
      return parsed.data;
    }
    if (capability.method === "channelInventory.getTeamMaterialSource" || capability.method === "customer.starContext"
      || capability.method === "crmSalesOrder.customerSummary" || capability.method === "crmSalesOrder.customerMaterials") return result;
    await db.recordBusinessCommandAccess({
      merchantId: merchant.id,
      staffUserId: staffBinding.frontUserId,
      bindingVersion: staffBinding.bindingVersion,
      scopeVersion: scope.scopeVersion,
      method: capability.method,
      requestId,
      actor,
      resourceCorrelation: channelCommandResource(capability.method, params, result),
    });
    return result;
  });
}

/** Fixed mirrored DTOs for the only added customer-contact BFF methods. */
const CUSTOMER_CONTACT_BUSINESS_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "customer.createMulti": createMultiSchema,
  "customer.contactsList": contactsListSchema,
  "customer.contactsSummary": contactsSummarySchema,
  "customer.contactsAdd": contactsAddSchema,
  "customer.contactsEdit": contactsEditSchema,
  "customer.contactsStop": contactsStopSchema,
  "customer.contactsSetPrimary": contactsSetPrimarySchema,
  "customer.updateBasic": updateBasicSchema,
};

const CHANNEL_COLLABORATION_BUSINESS_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "channelInventory.getTeamMaterialSource": teamMaterialSourceSchema,
  "channelInventory.getTeamMaterialForEdit": teamMaterialForEditSchema,
  "channelInventory.updateTeamMaterial": teamMaterialUpdateSchema,
  "channelInventory.collaborationNotesList": collaborationNotesListSchema,
  "channelInventory.collaborationNotesAdd": collaborationNotesAddSchema,
  "channelInventory.collaborationNotesEdit": collaborationNotesEditSchema,
};
function businessInputSchema(method: string): z.ZodTypeAny {
  if (method === "customer.starContext") return customerStarContextInputSchema;
  if (method === "customer.setStar") return customerSetStarSchema;
  if (method === "customer.starState") return customerStarStateInputSchema;
  if (method === "customer.list") return customerListSchema;
  if (method === "channelInventory.listTeamMaterials") return channelInventoryListBusinessInputSchema;
  if (method === "channelInventory.publishFactoryMaterial") return publishFactoryMaterialInputSchema;
  if (method === "channelInventory.previewFactoryMaterialReception") return previewFactoryMaterialReceptionInputSchema;
  if (isCustomerSupplyBusinessMethod(method)) return CUSTOMER_SUPPLY_BUSINESS_INPUT_SCHEMAS[method];
  if (CHANNEL_MANAGEMENT_BUSINESS_INPUT_SCHEMAS[method]) return CHANNEL_MANAGEMENT_BUSINESS_INPUT_SCHEMAS[method];
  return CUSTOMER_CONTACT_BUSINESS_INPUT_SCHEMAS[method] ?? CHANNEL_COLLABORATION_BUSINESS_INPUT_SCHEMAS[method]
    ?? z.unknown();
}

function businessQuery(method: string, module: BusinessModule, mode: BusinessAccessMode = "read") {
  return publicProcedure.input(businessInputSchema(method)).query(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method, module, mode }));
}

function businessMutation(method: string, module: BusinessModule) {
  return publicProcedure.input(businessInputSchema(method)).mutation(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method, module, mode: "write" }));
}

/** Only these two fixed collaboration commands use read authorization, but remain real
 * tRPC mutations and traverse the unchanged binding/scope fence and command audit. */
function collaborationMutation(method: "channelInventory.collaborationNotesAdd" | "channelInventory.collaborationNotesEdit") {
  return publicProcedure.input(businessInputSchema(method)).mutation(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method, module: "inventory", mode: "read" }));
}

const inventoryBusinessRouter = router({
  list: businessQuery("inventory.list", "inventory"),
  listPaged: businessQuery("inventory.listPaged", "inventory"),
  refreshStatus: businessQuery("inventory.refreshStatus", "inventory"),
  refreshPublished: businessMutation("inventory.refreshPublished", "inventory"),
  get: businessQuery("inventory.get", "inventory"),
  uploadPhoto: businessMutation("inventory.uploadPhoto", "inventory"),
  labelOcrAvailability: businessQuery("inventory.labelOcrAvailability", "inventory"),
  recognizeLabel: businessMutation("inventory.recognizeLabel", "inventory"),
  spotVerificationList: businessQuery("inventory.spotVerificationList", "inventory"),
  prepareSpotStockVerification: businessMutation("inventory.prepareSpotStockVerification", "inventory"),
  confirmSpotStockVerification: businessMutation("inventory.confirmSpotStockVerification", "inventory"),
  verifySpotStock: businessMutation("inventory.verifySpotStock", "inventory"),
  recognizeText: businessMutation("inventory.recognizeText", "inventory"),
  create: businessMutation("inventory.create", "inventory"),
  update: businessMutation("inventory.update", "inventory"),
  publish: businessMutation("inventory.publish", "inventory"),
  publishAll: businessMutation("inventory.publishAll", "inventory"),
  listPublishJobs: businessQuery("inventory.listPublishJobs", "inventory"),
  getPublishJob: businessQuery("inventory.getPublishJob", "inventory"),
  listPublishJobErrors: businessQuery("inventory.listPublishJobErrors", "inventory"),
  pausePublishJob: businessMutation("inventory.pausePublishJob", "inventory"),
  resumePublishJob: businessMutation("inventory.resumePublishJob", "inventory"),
  retryPublishJob: businessMutation("inventory.retryPublishJob", "inventory"),
  cancelPublishJob: businessMutation("inventory.cancelPublishJob", "inventory"),
  setCompanyCatalogVisibility: businessMutation("inventory.setCompanyCatalogVisibility", "inventory"),
  setAllCompanyCatalogVisibility: businessMutation("inventory.setAllCompanyCatalogVisibility", "inventory"),
  bulkSetCompanyCatalogVisibility: businessMutation("inventory.bulkSetCompanyCatalogVisibility", "inventory"),
  offshelf: businessMutation("inventory.offshelf", "inventory"),
  bulkOffshelf: businessMutation("inventory.bulkOffshelf", "inventory"),
  offshelfAllPublished: businessMutation("inventory.offshelfAllPublished", "inventory"),
  remove: businessMutation("inventory.remove", "inventory"),
  bulkRemove: businessMutation("inventory.bulkRemove", "inventory"),
  removeManyDrafts: businessMutation("inventory.removeManyDrafts", "inventory"),
  clearDrafts: businessMutation("inventory.clearDrafts", "inventory"),
  assignmentOptions: businessQuery("inventory.assignmentOptions", "inventory"),
  reassign: businessMutation("inventory.reassign", "inventory"),
});

/**
 * Closed Channel Inventory BFF surface.  Each member names one original front
 * procedure; no browser input can select a namespace or procedure dynamically.
 * Front rechecks `inventory.manage`, enterprise/own scope, revisions and request
 * idempotency with the bound real staff actor before invoking its CPI service.
 */
const channelInventoryBusinessRouter = router({
  publishFactoryMaterial: businessMutation("channelInventory.publishFactoryMaterial", "inventory"),
  previewFactoryMaterialReception: businessQuery("channelInventory.previewFactoryMaterialReception", "inventory"),
  listChannels: businessQuery("channelInventory.listChannels", "inventory"),
  getChannel: businessQuery("channelInventory.getChannel", "inventory"),
  createChannel: businessMutation("channelInventory.createChannel", "inventory"),
  updateChannel: businessMutation("channelInventory.updateChannel", "inventory"),
  setChannelActive: businessMutation("channelInventory.setChannelActive", "inventory"),
  listMaterials: businessQuery("channelInventory.listMaterials", "inventory"),
  listTeamMaterials: businessQuery("channelInventory.listTeamMaterials", "inventory"),
  listTeamSourceOptions: businessQuery("channelInventory.listTeamSourceOptions", "inventory"),
  getTeamMaterialSource: businessQuery("channelInventory.getTeamMaterialSource", "inventory"),
  getTeamMaterialForEdit: businessQuery("channelInventory.getTeamMaterialForEdit", "inventory", "write"),
  updateTeamMaterial: businessMutation("channelInventory.updateTeamMaterial", "inventory"),
  collaborationNotesList: businessQuery("channelInventory.collaborationNotesList", "inventory"),
  collaborationNotesAdd: collaborationMutation("channelInventory.collaborationNotesAdd"),
  collaborationNotesEdit: collaborationMutation("channelInventory.collaborationNotesEdit"),
  exportChannelMaterials: businessQuery("channelInventory.exportChannelMaterials", "inventory"),
  getMaterial: businessQuery("channelInventory.getMaterial", "inventory"),
  createMaterial: businessMutation("channelInventory.createMaterial", "inventory"),
  customerSupplySummary: businessQuery("channelInventory.customerSupplySummary", "inventory"),
  customerSupplyContext: businessQuery("channelInventory.customerSupplyContext", "inventory"),
  createCustomerUploadBatch: businessMutation("channelInventory.createCustomerUploadBatch", "inventory"),
  createCustomerMaterial: businessMutation("channelInventory.createCustomerMaterial", "inventory"),
  updateMaterial: businessMutation("channelInventory.updateMaterial", "inventory"),
  listSharedMaterials: businessQuery("channelInventory.listSharedMaterials", "inventory"),
  notesList: businessQuery("channelInventory.notesList", "inventory"),
  notesAdd: businessMutation("channelInventory.notesAdd", "inventory"),
  notesEdit: businessMutation("channelInventory.notesEdit", "inventory"),
  setMaterialShare: businessMutation("channelInventory.setMaterialShare", "inventory"),
  deleteMaterials: businessMutation("channelInventory.deleteMaterials", "inventory"),
  listDeletedMaterials: businessQuery("channelInventory.listDeletedMaterials", "inventory"),
  restoreMaterial: businessMutation("channelInventory.restoreMaterial", "inventory"),
  createUploadBatch: businessMutation("channelInventory.createUploadBatch", "inventory"),
  listUploadBatches: businessQuery("channelInventory.listUploadBatches", "inventory"),
  updateUploadBatch: businessMutation("channelInventory.updateUploadBatch", "inventory"),
  previewDeleteUploadBatch: businessQuery("channelInventory.previewDeleteUploadBatch", "inventory", "write"),
  deleteUploadBatch: businessMutation("channelInventory.deleteUploadBatch", "inventory"),
});

const importInventoryBusinessRouter = router({
  previewRows: businessMutation("importInventory.previewRows", "inventory"),
  batchImport: businessMutation("importInventory.batchImport", "inventory"),
  createJob: businessMutation("importInventory.createJob", "inventory"),
  stageBatch: businessMutation("importInventory.stageBatch", "inventory"),
  finalizeJob: businessMutation("importInventory.finalizeJob", "inventory"),
  listJobs: businessQuery("importInventory.listJobs", "inventory"),
  getJob: businessQuery("importInventory.getJob", "inventory"),
  getUploadPlan: businessQuery("importInventory.getUploadPlan", "inventory"),
  listErrors: businessQuery("importInventory.listErrors", "inventory"),
  listFailedRows: businessQuery("importInventory.listFailedRows", "inventory"),
  pauseJob: businessMutation("importInventory.pauseJob", "inventory"),
  resumeJob: businessMutation("importInventory.resumeJob", "inventory"),
  retryFailedJob: businessMutation("importInventory.retryFailedJob", "inventory"),
  cancelJob: businessMutation("importInventory.cancelJob", "inventory"),
  repairList: businessQuery("importInventory.repairList", "inventory"),
  repairClear: businessMutation("importInventory.repairClear", "inventory"),
  repairSave: businessMutation("importInventory.repairSave", "inventory"),
  repairSubmit: businessMutation("importInventory.repairSubmit", "inventory"),
});

const inboundBusinessRouter = router({
  uploadPhoto: businessMutation("inbound.uploadPhoto", "inventory"),
  photos: businessQuery("inbound.photos", "inventory"),
  suggestPartNumbers: businessQuery("inbound.suggestPartNumbers", "inventory"),
  overview: businessQuery("inbound.overview", "inventory"),
  list: businessQuery("inbound.list", "inventory"),
  bulkCreate: businessMutation("inbound.bulkCreate", "inventory"),
  create: businessMutation("inbound.create", "inventory"),
  update: businessMutation("inbound.update", "inventory"),
  updateDetails: businessMutation("inbound.updateDetails", "inventory"),
  paymentHistory: businessQuery("inbound.paymentHistory", "inventory"),
  markPaymentUnpaid: businessMutation("inbound.markPaymentUnpaid", "inventory"),
  recordPayment: businessMutation("inbound.recordPayment", "inventory"),
  voidPayment: businessMutation("inbound.voidPayment", "inventory"),
  receive: businessMutation("inbound.receive", "inventory"),
  cancelPreview: businessQuery("inbound.cancelPreview", "inventory"),
  cancelMany: businessMutation("inbound.cancelMany", "inventory"),
  cancel: businessMutation("inbound.cancel", "inventory"),
  remove: businessMutation("inbound.remove", "inventory"),
});

const customerBusinessRouter = router({
  context: businessQuery("customer.context", "customers"),
  starContext: businessQuery("customer.starContext", "customers"),
  starState: businessQuery("customer.starState", "customers"),
  // Native front resolves current record visibility and valid same-team targets.
  // Only this closed personal-preference mutation needs read, not module write.
  setStar: publicProcedure.input(customerSetStarSchema).mutation(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method: "customer.setStar", module: "customers", mode: "read" })),
  list: businessQuery("customer.list", "customers"),
  get: businessQuery("customer.get", "customers"),
  ownershipSearch: businessQuery("customer.ownershipSearch", "customers"),
  checkDuplicate: businessQuery("customer.checkDuplicate", "customers"),
  create: businessMutation("customer.create", "customers"),
  createMulti: businessMutation("customer.createMulti", "customers"),
  update: businessMutation("customer.update", "customers"),
  updateBasic: businessMutation("customer.updateBasic", "customers"),
  contactsList: businessQuery("customer.contactsList", "customers"),
  contactsSummary: businessQuery("customer.contactsSummary", "customers"),
  contactsAdd: businessMutation("customer.contactsAdd", "customers"),
  contactsEdit: businessMutation("customer.contactsEdit", "customers"),
  contactsStop: businessMutation("customer.contactsStop", "customers"),
  contactsSetPrimary: businessMutation("customer.contactsSetPrimary", "customers"),
  addFollowUp: businessMutation("customer.addFollowUp", "customers"),
  archive: businessMutation("customer.archive", "customers"),
  restore: businessMutation("customer.restore", "customers"),
  transfer: businessMutation("customer.transfer", "customers"),
});

const customerDemandBusinessRouter = router({
  suggestPartNumbers: businessQuery("customerDemand.suggestPartNumbers", "customers"),
  quoteSave: businessMutation("customerDemand.quoteSave", "procurement"),
  quoteWithdraw: businessMutation("customerDemand.quoteWithdraw", "procurement"),
  quoteList: businessQuery("customerDemand.quoteList", "customers"),
  quoteHistory: businessQuery("customerDemand.quoteHistory", "customers"),
  quoteAccept: businessMutation("customerDemand.quoteAccept", "customers"),
  save: businessMutation("customerDemand.save", "customers"),
  list: businessQuery("customerDemand.list", "customers"),
  salesList: businessQuery("customerDemand.salesList", "customers"),
  get: businessQuery("customerDemand.get", "customers"),
  revisionHistory: businessQuery("customerDemand.revisionHistory", "customers"),
  procurementList: businessQuery("customerDemand.procurementList", "procurement"),
  procurementGet: businessQuery("customerDemand.procurementGet", "procurement"),
  claim: businessMutation("customerDemand.claim", "procurement"),
});

const crmSalesOrderBusinessRouter = router({
  list: businessQuery("crmSalesOrder.list", "orders"),
  candidates: businessQuery("crmSalesOrder.candidates", "orders"),
  get: businessQuery("crmSalesOrder.get", "orders"),
  customerSummary: businessQuery("crmSalesOrder.customerSummary", "orders"),
  customerMaterials: businessQuery("crmSalesOrder.customerMaterials", "orders"),
  create: businessMutation("crmSalesOrder.create", "orders"),
  cancel: businessMutation("crmSalesOrder.cancel", "orders"),
  recordPayment: businessMutation("crmSalesOrder.recordPayment", "orders"),
  ship: businessMutation("crmSalesOrder.ship", "orders"),
});

const purchaseOrderBusinessRouter = router({
  list: businessQuery("purchaseOrder.list", "procurement"),
  get: businessQuery("purchaseOrder.get", "procurement"),
  acceptedQuoteOptions: businessQuery("purchaseOrder.acceptedQuoteOptions", "procurement"),
  inboundCandidates: businessQuery("purchaseOrder.inboundCandidates", "procurement"),
  create: businessMutation("purchaseOrder.create", "procurement"),
  updatePayment: businessMutation("purchaseOrder.updatePayment", "procurement"),
  updateShipping: businessMutation("purchaseOrder.updateShipping", "procurement"),
  linkInbound: businessMutation("purchaseOrder.linkInbound", "procurement"),
  recordInvoice: businessMutation("purchaseOrder.recordInvoice", "procurement"),
  voidInvoice: businessMutation("purchaseOrder.voidInvoice", "procurement"),
  cancel: businessMutation("purchaseOrder.cancel", "procurement"),
});

const enterpriseBusinessRouter = router({
  me: businessQuery("enterprise.me", "context"),
  members: businessQuery("enterprise.members", "users"),
  invitations: businessQuery("enterprise.invitations", "users"),
  myInvitations: businessQuery("enterprise.myInvitations", "users"),
  userRecords: businessQuery("enterprise.userRecords", "users"),
  businessHandoffPreview: businessQuery("enterprise.businessHandoffPreview", "users"),
  businessHandoffState: businessQuery("enterprise.businessHandoffState", "users"),
  inquiryInbox: businessQuery("enterprise.inquiryInbox", "inquiries"),
  handoffPreview: businessQuery("enterprise.handoffPreview", "users"),
  invite: businessMutation("enterprise.invite", "users"),
  revokeInvitation: businessMutation("enterprise.revokeInvitation", "users"),
  updatePermissions: businessMutation("enterprise.updatePermissions", "users"),
  updateInventoryScope: businessMutation("enterprise.updateInventoryScope", "users"),
  setStatus: businessMutation("enterprise.setStatus", "users"),
  handoffMemberBusiness: businessMutation("enterprise.handoffMemberBusiness", "users"),
  businessHandoff: businessMutation("enterprise.businessHandoff", "users"),
  sendOwnershipTransferCode: businessMutation("enterprise.sendOwnershipTransferCode", "users"),
  verifyOwnershipTransferCode: businessMutation("enterprise.verifyOwnershipTransferCode", "users"),
  transferOwnership: businessMutation("enterprise.transferOwnership", "users"),
  ownerTransfers: businessQuery("enterprise.ownerTransfers", "users"),
});

const companyBusinessRouter = router({
  get: businessQuery("company.get", "context"),
  profilePhotos: businessQuery("company.profilePhotos", "context"),
  enterpriseAgreementStatus: businessQuery("company.enterpriseAgreementStatus", "context"),
  hkCapabilities: businessQuery("company.hkCapabilities", "context"),
  hkDraft: businessQuery("company.hkDraft", "context"),
  salesStaff: businessQuery("company.salesStaff", "context"),
  save: businessMutation("company.save", "users"),
  submitCrmApplication: businessMutation("company.submitCrmApplication", "users"),
  uploadLicense: businessMutation("company.uploadLicense", "users"),
  uploadBankLicense: businessMutation("company.uploadBankLicense", "users"),
  uploadProfilePhoto: businessMutation("company.uploadProfilePhoto", "users"),
  deleteProfilePhoto: businessMutation("company.deleteProfilePhoto", "users"),
  setProfileAvatar: businessMutation("company.setProfileAvatar", "users"),
  setProfileHomeCover: businessMutation("company.setProfileHomeCover", "users"),
  uploadHkDocument: businessMutation("company.uploadHkDocument", "users"),
  submitHkApplication: businessMutation("company.submitHkApplication", "users"),
});

const orderBusinessRouter = router({
  sellerOrders: businessQuery("order.sellerOrders", "orders"),
  tracks: businessQuery("order.tracks", "orders"),
  expressCos: businessQuery("order.expressCos", "orders"),
  logistics: businessQuery("order.logistics", "orders"),
  refundDetail: businessQuery("order.refundDetail", "orders"),
  // Existing seller-local operations only. The original route still checks the
  // real bound staff user is the seller; no owner/data-owner impersonation is
  // introduced. Original cancellation/refund validation remains in the seller router;
  // registering a capability does not grant seller identity or trigger a provider.
  sellerConfirmPay: businessMutation("order.sellerConfirmPay", "orders"),
  sellerCancel: businessMutation("order.sellerCancel", "orders"),
  approveRefund: businessMutation("order.approveRefund", "orders"),
  ship: businessMutation("order.ship", "orders"),
  rejectRefund: businessMutation("order.rejectRefund", "orders"),
  agreeReturn: businessMutation("order.agreeReturn", "orders"),
  confirmOfflineRefund: businessMutation("order.confirmOfflineRefund", "orders"),
});

const materialBusinessRouter = router({
  lookup: businessQuery("material.lookup", "inventory"),
});

const demandBusinessRouter = router({
  receivedQuotes: businessQuery("demand.receivedQuotes", "procurement"),
});

const pickupPointBusinessRouter = router({
  mine: businessQuery("pickupPoint.mine", "context"),
  save: businessMutation("pickupPoint.save", "users"),
  remove: businessMutation("pickupPoint.remove", "users"),
});

const publicReviewBusinessRouter = router({
  unreadCount: businessQuery("publicReview.unreadCount", "context"),
  inbox: businessQuery("publicReview.inbox", "context"),
  reply: businessMutation("publicReview.reply", "users"),
  markInboxRead: businessMutation("publicReview.markInboxRead", "users"),
  // These two reception-page methods are independently conversation-gated by
  // front internalBusiness before the original publicReview router is invoked.
  state: businessQuery("publicReview.state", "inquiries"),
  create: businessMutation("publicReview.create", "inquiries"),
});

/**
 * Only existing inquiry conversations may cross this boundary. The front
 * service verifies enterpriseId + current assignee + conversation participant
 * before it calls every original chat procedure in this fixed list.
 */
const chatBusinessRouter = router({
  listConversations: businessQuery("chat.listConversations", "inquiries"),
  listGroups: businessQuery("chat.listGroups", "inquiries"),
  listTrashedGroups: businessQuery("chat.listTrashedGroups", "inquiries"),
  getMessages: businessQuery("chat.getMessages", "inquiries"),
  getAttachmentUrl: businessQuery("chat.getAttachmentUrl", "inquiries"),
  getTotalUnread: businessQuery("chat.getTotalUnread", "inquiries"),
  uploadAttachment: businessMutation("chat.uploadAttachment", "inquiries"),
  sendMessage: businessMutation("chat.sendMessage", "inquiries"),
  recallMessage: businessMutation("chat.recallMessage", "inquiries"),
  deleteMessageForMe: businessMutation("chat.deleteMessageForMe", "inquiries"),
  markRead: businessMutation("chat.markRead", "inquiries"),
  pinConversation: businessMutation("chat.pinConversation", "inquiries"),
  setRemarkName: businessMutation("chat.setRemarkName", "inquiries"),
  deleteConversation: businessMutation("chat.deleteConversation", "inquiries"),
  createGroup: businessMutation("chat.createGroup", "inquiries"),
  setGroupMembership: businessMutation("chat.setGroupMembership", "inquiries"),
  dissolveGroup: businessMutation("chat.dissolveGroup", "inquiries"),
  renameGroup: businessMutation("chat.renameGroup", "inquiries"),
  mergeGroups: businessMutation("chat.mergeGroups", "inquiries"),
  trashGroup: businessMutation("chat.trashGroup", "inquiries"),
  restoreGroup: businessMutation("chat.restoreGroup", "inquiries"),
  contactProfile: businessQuery("chat.contactProfile", "inquiries"),
  contactInventory: businessQuery("chat.contactInventory", "inquiries"),
  blockContact: businessMutation("chat.blockContact", "inquiries"),
  unblockContact: businessMutation("chat.unblockContact", "inquiries"),
  reportContact: businessMutation("chat.reportContact", "inquiries"),
});

/** Separate from enterprise-chat scope: returns only the real bound staff's own cart count. */
const cartBusinessRouter = router({
  count: businessQuery("cart.count", "inventory"),
});

const staffBindingsRouter = router({
  current: publicProcedure
    .input(z.object({ adminUserId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = requireBusinessBindingManager(ctx);
      const adminUserId = input?.adminUserId ?? actor.id;
      return db.getActiveBusinessStaffBinding(adminUserId);
    }),
  bind: publicProcedure.input(bindingMutationInput).mutation(async ({ ctx, input }) => {
    requireBusinessBindingManager(ctx);
    // Cross-service proof precedes the local write; it verifies a real, enabled front account.
    const candidate = await validatePlatformBusinessStaffCandidate(input.frontUserId);
    const binding = await db.bindBusinessStaffPrincipal({ ...input, actor: businessAuditActor(ctx) });
    return { ...binding, frontendUser: candidate.user };
  }),
  revoke: publicProcedure.input(bindingRevokeInput).mutation(async ({ ctx, input }) => {
    requireBusinessBindingManager(ctx);
    return db.revokeBusinessStaffPrincipal({ ...input, actor: businessAuditActor(ctx) });
  }),
});

/** BFF scope records are managed separately from native admin permissions. */
const merchantScopesRouter = router({
  current: publicProcedure
    .input(z.object({ adminUserId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = requireBusinessBindingManager(ctx);
      return db.listActiveBusinessMerchantScopes(input?.adminUserId ?? actor.id);
    }),
  grant: publicProcedure.input(merchantScopeMutationInput).mutation(async ({ ctx, input }) => {
    requireBusinessBindingManager(ctx);
    if (!getBusinessWorkbenchMerchantIds().includes(input.merchantId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "商户不在受信任工作台范围配置中" });
    }
    return db.grantBusinessMerchantScope({ ...input, actor: businessAuditActor(ctx) });
  }),
  revoke: publicProcedure.input(merchantScopeRevokeInput).mutation(async ({ ctx, input }) => {
    requireBusinessBindingManager(ctx);
    return db.revokeBusinessMerchantScope({ ...input, actor: businessAuditActor(ctx) });
  }),
});

/**
 * Browser contract: tenant selection is exclusively x-business-merchant-id.
 * Inputs never contain enterprise, owner, staff actor, bindingVersion or portal key.
 * Parent integration mounts this router at appRouter.business and /api/business-trpc.
 */
export const businessRouter = router({
  auth: router({
    me: publicProcedure.query(async ({ ctx }) => {
      const merchantId = businessMerchantIdFromContext(ctx);
      return withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account, staffBinding, merchant }) => {
        const binding = businessEnterpriseBindingFromMerchant(merchant);
        try {
          const context = await getPlatformBusinessContext(binding, {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: account.id,
            bindingVersion: staffBinding.bindingVersion,
          });
          if (context.staffPrincipal.status !== "ready") {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "前台业务员工主体当前不可用", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
          }
          return context.staffPrincipal.user;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof PlatformBusinessPublicError) {
            throw new TRPCError({ code: error.code, message: error.message, cause: error });
          }
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务员工资料暂不可用，请稍后重试" });
        }
      });
    }),
  }),
  /**
   * Navigation returns exact per-merchant projections. Its top-level arrays are
   * an intersection across available merchants for legacy callers; consumers
   * selecting a merchant must consume that merchant's own arrays below.
   */
  navigation: publicProcedure.query(async ({ ctx }) => {
    const account = requireBusinessAdminAccount(ctx);
    const correlationId = readonlyQueryCorrelation(ctx.req);
    const scopeLookupStartedAt = Date.now();
    const navigationNative = await currentOfficialInventoryPermissions(ctx);
    let scopedMerchantIds: number[];
    try {
      const configuredMerchantIds = new Set(getBusinessWorkbenchMerchantIds());
      scopedMerchantIds = (await db.listActiveBusinessMerchantScopes(account.id))
        .filter(scope => configuredMerchantIds.has(scope.merchantId) && (businessScopeAllows(scope, "context", "read") || navigationNative.read))
        .map(scope => scope.merchantId);
    } catch {
      const elapsed = Math.max(0, Date.now() - scopeLookupStartedAt);
      logNavigationCandidate({ correlationId, adminAccountId: account.id, candidateCount: 0,
        candidateOrdinal: 0, result: "UNAVAILABLE", totalMs: elapsed, scopeLookupMs: elapsed });
      throw navigationFailure("UNAVAILABLE");
    }
    const scopeLookupMs = Math.max(0, Date.now() - scopeLookupStartedAt);
    const merchants = (await Promise.all(scopedMerchantIds.map(async (merchantId, index) => {
      const candidateStartedAt = Date.now();
      let upstreamTiming: PlatformBusinessUpstreamTiming | undefined;
      try {
        const choice = await withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account: currentAccount, staffBinding, scope, merchant, officialInventoryPermissions }) => {
          const context = await getPlatformBusinessContext(businessEnterpriseBindingFromMerchant(merchant), {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: currentAccount.id,
            bindingVersion: staffBinding.bindingVersion,
            officialInventoryPermissions,
          }, {
            onUpstreamTiming: timing => {
              upstreamTiming = timing;
            },
          });
          const projection = projectBusinessWorkbenchCapabilities({
            scope,
            frontWorkbenchCapabilities: context.workbenchCapabilities,
            officialInventoryPermissions: intersectOfficialInventoryPermissions(officialInventoryPermissions, context.officialInventoryPermissions),
          });
          return merchantCanEnterWorkbench(context, projection)
            ? toBusinessMerchantChoice(merchant, projection)
            : null;
        });
        logNavigationCandidate({
          correlationId,
          adminAccountId: account.id,
          candidateCount: scopedMerchantIds.length,
          candidateOrdinal: index + 1,
          result: choice ? "AVAILABLE" : "INELIGIBLE",
          totalMs: Math.max(0, Date.now() - candidateStartedAt),
          scopeLookupMs,
          upstreamTiming,
        });
        return choice;
      } catch (error) {
        const result = navigationCandidateResult(error);
        logNavigationCandidate({
          correlationId,
          adminAccountId: account.id,
          candidateCount: scopedMerchantIds.length,
          candidateOrdinal: index + 1,
          result,
          totalMs: Math.max(0, Date.now() - candidateStartedAt),
          scopeLookupMs,
          upstreamTiming,
        });
        if (result === "INELIGIBLE") {
          // A verified revoked scope/binding, disabled ERP tenant or real
          // upstream authorization denial cannot create a permissive choice.
          // It may be omitted, but no other candidate failure may be omitted.
          return null;
        }
        // Network, timeout, 5xx, parsing/configuration and unknown failures
        // leave this candidate unverified. Do not calculate a wider intersection.
        throw navigationFailure(result);
      }
    }))).filter((merchant): merchant is NonNullable<typeof merchant> => merchant !== null);
    const sharedCapabilities = merchants.length === 0
      ? [] as string[]
      : merchants[0].workbenchCapabilities.filter(capability => merchants.every(merchant => merchant.workbenchCapabilities.includes(capability)));
    const sharedWriteCapabilities = merchants.length === 0
      ? [] as string[]
      : merchants[0].writeCapabilities.filter(capability => merchants.every(merchant => merchant.writeCapabilities.includes(capability)));
    return {
      merchants,
      workbenchCapabilities: sharedCapabilities,
      writeCapabilities: sharedWriteCapabilities,
    };
  }),
  merchants: publicProcedure.input(merchantListInput).query(async ({ ctx, input }) => {
    const account = requireBusinessAdminAccount(ctx);
    const navigationNative = await currentOfficialInventoryPermissions(ctx);
    const configuredMerchantIds = new Set(getBusinessWorkbenchMerchantIds());
    const merchantIds = (await db.listActiveBusinessMerchantScopes(account.id))
      .filter(scope => configuredMerchantIds.has(scope.merchantId) && (businessScopeAllows(scope, "context", "read") || navigationNative.read))
      .map(scope => scope.merchantId);
    const result = await db.getBusinessWorkbenchMerchants(
      { page: input.page, pageSize: input.pageSize, search: input.search },
      merchantIds,
    );
    const data = (await Promise.all(result.data.map(async ({ id: merchantId }) => {
      try {
        return await withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account: currentAccount, staffBinding, scope, merchant, officialInventoryPermissions }) => {
          const context = await getPlatformBusinessContext(businessEnterpriseBindingFromMerchant(merchant), {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: currentAccount.id,
            bindingVersion: staffBinding.bindingVersion,
            officialInventoryPermissions,
          });
          const projection = projectBusinessWorkbenchCapabilities({
            scope,
            frontWorkbenchCapabilities: context.workbenchCapabilities,
            officialInventoryPermissions: intersectOfficialInventoryPermissions(officialInventoryPermissions, context.officialInventoryPermissions),
          });
          return merchantCanEnterWorkbench(context, projection)
            ? toBusinessMerchantChoice(merchant, projection)
            : null;
        });
      } catch {
        // A stale/disabled ERP tenant or revoked front membership is not shown;
        // a later selected-command request independently repeats all checks.
        return null;
      }
    }))).filter((merchant): merchant is NonNullable<typeof merchant> => merchant !== null);
    return { data, pageAvailableCount: data.length, sourceTotal: result.total };
  }),

  context: publicProcedure.query(async ({ ctx }) => {
    const merchantId = businessMerchantIdFromContext(ctx);
    return withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account, staffBinding, scope, merchant, officialInventoryPermissions }) => {
      const binding = businessEnterpriseBindingFromMerchant(merchant);
      let context;
      try {
        context = await getPlatformBusinessContext(
          binding,
          {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: account.id,
            bindingVersion: staffBinding.bindingVersion,
            officialInventoryPermissions,
          },
        );
      } catch (error) {
        if (error instanceof PlatformBusinessPublicError) {
          throw new TRPCError({ code: error.code, message: error.message, cause: error });
        }
        console.error("[businessBff] internal business context unavailable", {
          merchantId: merchant.id,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务上下文暂时不可用，请稍后重试" });
      }
      const projection = projectBusinessWorkbenchCapabilities({
        scope,
        frontWorkbenchCapabilities: context.workbenchCapabilities,
            officialInventoryPermissions: intersectOfficialInventoryPermissions(officialInventoryPermissions, context.officialInventoryPermissions),
      });
      if (!merchantCanEnterWorkbench(context, projection)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "前台业务员工主体当前不可用", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
      }
      const requestId = randomUUID();
      await db.recordBusinessContextAccess(merchant.id, businessAuditActor(ctx), {
        requestId,
        bindingVersion: staffBinding.bindingVersion,
        scopeVersion: scope.scopeVersion,
      });
      return {
        merchant: toBusinessMerchantChoice(merchant, projection),
        enterprise: {
          id: context.enterpriseId,
          companyName: context.companyName,
          dataOwnerUserId: context.dataOwnerUserId,
        },
        staffPrincipal: context.staffPrincipal,
        authorizationVersion: context.authorizationVersion === undefined ? undefined : `business-bff-auth-v1:${createHash("sha256").update(JSON.stringify({
          front: context.authorizationVersion,
          officialInventoryPermissions: intersectOfficialInventoryPermissions(officialInventoryPermissions, context.officialInventoryPermissions),
          merchantId: merchant.id,
          staffUserId: staffBinding.frontUserId,
          bindingVersion: staffBinding.bindingVersion,
          scopeVersion: scope.scopeVersion,
          modulePermissions: Array.from(new Set(scope.modulePermissions)).sort(),
        })).digest("hex")}`,
        officialInventoryPermissions: projection.officialInventoryPermissions,
        enabledModules: projection.workbenchCapabilities,
        sessionCapabilities: projectBusinessSessionCapabilities({
          frontReceptionReady: context.sessionCapabilities.receptionReady,
          projection,
        }),
        workbenchCapabilities: projection.workbenchCapabilities,
        writeCapabilities: projection.writeCapabilities,
        moduleAvailability: projection.moduleAvailability,
        available: true,
      };
    });
  }),

  organization: router({
    overview: businessQuery("organization.overview", "context"),
    audit: businessQuery("organization.audit", "users"),
    createTeam: businessMutation("organization.createTeam", "users"),
    updateTeam: businessMutation("organization.updateTeam", "users"),
    setMember: businessMutation("organization.setMember", "users"),
    updateMemberAccess: businessMutation("organization.updateMemberAccess", "users"),
  }),
  staffBindings: staffBindingsRouter,
  merchantScopes: merchantScopesRouter,
  inventory: inventoryBusinessRouter,
  channelInventory: channelInventoryBusinessRouter,
  importInventory: importInventoryBusinessRouter,
  inbound: inboundBusinessRouter,
  customer: customerBusinessRouter,
  customerDemand: customerDemandBusinessRouter,
  crmSalesOrder: crmSalesOrderBusinessRouter,
  purchaseOrder: purchaseOrderBusinessRouter,
  enterprise: enterpriseBusinessRouter,
  company: companyBusinessRouter,
  order: orderBusinessRouter,
  material: materialBusinessRouter,
  demand: demandBusinessRouter,
  pickupPoint: pickupPointBusinessRouter,
  publicReview: publicReviewBusinessRouter,
  chat: chatBusinessRouter,
  cart: cartBusinessRouter,
});
export type BusinessRouter = typeof businessRouter;
export const businessRouterTestUtils = { channelCommandResource };
