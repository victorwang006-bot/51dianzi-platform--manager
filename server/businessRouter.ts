import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./_core/trpc";
import {
  assertBusinessMerchantAccess,
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
  validatePlatformBusinessStaffCandidate,
} from "./platformBusinessApi";
import type { TrpcContext } from "./_core/context";
import {
  projectBusinessSessionCapabilities,
  projectBusinessWorkbenchCapabilities,
  type BusinessWorkbenchProjection,
} from "./businessWorkbenchProjection";

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
  { method: "channelInventory.getMaterial", module: "inventory", mode: "read" },
  { method: "channelInventory.createMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.updateMaterial", module: "inventory", mode: "write" },
  { method: "channelInventory.listSharedMaterials", module: "inventory", mode: "read" },
  { method: "channelInventory.notesList", module: "inventory", mode: "read" },
  { method: "channelInventory.notesAdd", module: "inventory", mode: "write" },
  { method: "channelInventory.notesEdit", module: "inventory", mode: "write" },
  { method: "importInventory.*", module: "inventory", mode: "write" },
  { method: "inbound.*", module: "inventory", mode: "write" },
  { method: "customer.*", module: "customers", mode: "write" },
  { method: "customerDemand.sales.*", module: "customers", mode: "write" },
  { method: "customerDemand.procurement.*", module: "procurement", mode: "write" },
  { method: "crmSalesOrder.*", module: "orders", mode: "write" },
  { method: "purchaseOrder.*", module: "procurement", mode: "write" },
  { method: "enterprise.me", module: "context", mode: "read" },
  { method: "enterprise.inquiryInbox", module: "inventory", mode: "read" },
  { method: "enterprise.*", module: "users", mode: "write" },
  { method: "company.read.*", module: "context", mode: "read" },
  { method: "company.write.*", module: "users", mode: "write" },
  { method: "order.seller.read.*", module: "orders", mode: "read" },
  { method: "order.seller.write.*", module: "orders", mode: "write" },
  { method: "material.lookup", module: "inventory", mode: "read" },
  { method: "demand.receivedQuotes", module: "procurement", mode: "read" },
  { method: "chat.read.*", module: "inventory", mode: "read" },
  { method: "chat.write.*", module: "inventory", mode: "write" },
] as const satisfies readonly BusinessMethodCapability[];

/** Resolve the mutable local binding for every BFF entry; revoked history is unusable. */
async function requireCurrentBusinessStaffBinding(adminUserId: number) {
  const staffBinding = await db.getActiveBusinessStaffBinding(adminUserId);
  if (!staffBinding) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前后台账号尚未绑定有效的前台业务员工主体",
    });
  }
  return staffBinding;
}

function merchantCanEnterWorkbench(
  context: Awaited<ReturnType<typeof getPlatformBusinessContext>>,
  projection: BusinessWorkbenchProjection,
) {
  return context.staffPrincipal.status === "ready" && projection.workbenchCapabilities.length > 0;
}

type CurrentBusinessAuthorization = {
  account: ReturnType<typeof requireBusinessAdminAccount>;
  staffBinding: Awaited<ReturnType<typeof requireCurrentBusinessStaffBinding>>;
  scope: NonNullable<Awaited<ReturnType<typeof db.getActiveBusinessMerchantScope>>>;
  merchant: Awaited<ReturnType<typeof assertBusinessMerchantAccess>>;
};

/**
 * The authorization linearization point covers fresh binding/scope reads and
 * one remote front call. Binding mutations take the same account lock; scope
 * mutations take the account then merchant lock in this identical order.
 */
async function withCurrentBusinessAuthorization<T>(
  ctx: TrpcContext,
  merchantId: number,
  capability: { module: BusinessModule; mode: BusinessAccessMode },
  operation: (authorization: CurrentBusinessAuthorization) => Promise<T>,
) {
  const account = requireBusinessAdminAccount(ctx);
  return db.withBusinessAuthorizationFence({ adminUserId: account.id, merchantId }, async () => {
    const staffBinding = await requireCurrentBusinessStaffBinding(account.id);
    const merchant = await assertBusinessMerchantAccess(ctx, merchantId, capability.module, capability.mode);
    // This read occurs while the fence is held and supplies the actual scope
    // version persisted in the generic audit record for a forwarded command.
    const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);
    if (!scope || !businessScopeAllows(scope, capability.module, capability.mode)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未获该商户的业务工作台范围授权" });
    }
    return operation({ account, staffBinding, scope, merchant });
  });
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
  return withCurrentBusinessAuthorization(ctx, merchantId, capability, async ({ staffBinding, scope, merchant }) => {
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
      });
    } catch (error) {
      if (error instanceof PlatformBusinessPublicError) {
        // The platform client admits only explicitly allow-listed domain codes and
        // a bounded message; preserve original zod/CAS/permission feedback.
        throw new TRPCError({ code: error.code, message: error.message });
      }
      console.error("[businessBff] fixed business command unavailable", {
        method: capability.method,
        merchantId: merchant.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务服务暂时不可用，请稍后重试" });
    }
    await db.recordBusinessCommandAccess({
      merchantId: merchant.id,
      staffUserId: staffBinding.frontUserId,
      bindingVersion: staffBinding.bindingVersion,
      scopeVersion: scope.scopeVersion,
      method: capability.method,
      requestId,
      actor,
    });
    return result;
  });
}

function businessQuery(method: string, module: BusinessModule, mode: BusinessAccessMode = "read") {
  return publicProcedure.input(z.unknown()).query(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method, module, mode }));
}

function businessMutation(method: string, module: BusinessModule) {
  return publicProcedure.input(z.unknown()).mutation(({ ctx, input }) =>
    forwardBusinessMethod(ctx, input, { method, module, mode: "write" }));
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
  listChannels: businessQuery("channelInventory.listChannels", "inventory"),
  getChannel: businessQuery("channelInventory.getChannel", "inventory"),
  createChannel: businessMutation("channelInventory.createChannel", "inventory"),
  updateChannel: businessMutation("channelInventory.updateChannel", "inventory"),
  setChannelActive: businessMutation("channelInventory.setChannelActive", "inventory"),
  listMaterials: businessQuery("channelInventory.listMaterials", "inventory"),
  getMaterial: businessQuery("channelInventory.getMaterial", "inventory"),
  createMaterial: businessMutation("channelInventory.createMaterial", "inventory"),
  updateMaterial: businessMutation("channelInventory.updateMaterial", "inventory"),
  listSharedMaterials: businessQuery("channelInventory.listSharedMaterials", "inventory"),
  notesList: businessQuery("channelInventory.notesList", "inventory"),
  notesAdd: businessMutation("channelInventory.notesAdd", "inventory"),
  notesEdit: businessMutation("channelInventory.notesEdit", "inventory"),
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
  list: businessQuery("customer.list", "customers"),
  get: businessQuery("customer.get", "customers"),
  ownershipSearch: businessQuery("customer.ownershipSearch", "customers"),
  checkDuplicate: businessQuery("customer.checkDuplicate", "customers"),
  create: businessMutation("customer.create", "customers"),
  update: businessMutation("customer.update", "customers"),
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
  inquiryInbox: businessQuery("enterprise.inquiryInbox", "inventory"),
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
  state: businessQuery("publicReview.state", "inventory"),
  create: businessMutation("publicReview.create", "inventory"),
});

/**
 * Only existing inquiry conversations may cross this boundary. The front
 * service verifies enterpriseId + current assignee + conversation participant
 * before it calls every original chat procedure in this fixed list.
 */
const chatBusinessRouter = router({
  listConversations: businessQuery("chat.listConversations", "inventory"),
  listGroups: businessQuery("chat.listGroups", "inventory"),
  listTrashedGroups: businessQuery("chat.listTrashedGroups", "inventory"),
  getMessages: businessQuery("chat.getMessages", "inventory"),
  getAttachmentUrl: businessQuery("chat.getAttachmentUrl", "inventory"),
  getTotalUnread: businessQuery("chat.getTotalUnread", "inventory"),
  uploadAttachment: businessMutation("chat.uploadAttachment", "inventory"),
  sendMessage: businessMutation("chat.sendMessage", "inventory"),
  recallMessage: businessMutation("chat.recallMessage", "inventory"),
  deleteMessageForMe: businessMutation("chat.deleteMessageForMe", "inventory"),
  markRead: businessMutation("chat.markRead", "inventory"),
  pinConversation: businessMutation("chat.pinConversation", "inventory"),
  setRemarkName: businessMutation("chat.setRemarkName", "inventory"),
  deleteConversation: businessMutation("chat.deleteConversation", "inventory"),
  createGroup: businessMutation("chat.createGroup", "inventory"),
  setGroupMembership: businessMutation("chat.setGroupMembership", "inventory"),
  dissolveGroup: businessMutation("chat.dissolveGroup", "inventory"),
  renameGroup: businessMutation("chat.renameGroup", "inventory"),
  mergeGroups: businessMutation("chat.mergeGroups", "inventory"),
  trashGroup: businessMutation("chat.trashGroup", "inventory"),
  restoreGroup: businessMutation("chat.restoreGroup", "inventory"),
  contactProfile: businessQuery("chat.contactProfile", "inventory"),
  contactInventory: businessQuery("chat.contactInventory", "inventory"),
  blockContact: businessMutation("chat.blockContact", "inventory"),
  unblockContact: businessMutation("chat.unblockContact", "inventory"),
  reportContact: businessMutation("chat.reportContact", "inventory"),
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
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "前台业务员工主体当前不可用" });
          }
          return context.staffPrincipal.user;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof PlatformBusinessPublicError) {
            throw new TRPCError({ code: error.code, message: error.message });
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
    const configuredMerchantIds = new Set(getBusinessWorkbenchMerchantIds());
    const scopedMerchantIds = (await db.listActiveBusinessMerchantScopes(account.id))
      .filter(scope => configuredMerchantIds.has(scope.merchantId) && businessScopeAllows(scope, "context", "read"))
      .map(scope => scope.merchantId);
    const merchants = (await Promise.all(scopedMerchantIds.map(async merchantId => {
      try {
        return await withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account: currentAccount, staffBinding, scope, merchant }) => {
          const context = await getPlatformBusinessContext(businessEnterpriseBindingFromMerchant(merchant), {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: currentAccount.id,
            bindingVersion: staffBinding.bindingVersion,
          });
          const projection = projectBusinessWorkbenchCapabilities({
            scope,
            frontWorkbenchCapabilities: context.workbenchCapabilities,
          });
          return merchantCanEnterWorkbench(context, projection)
            ? toBusinessMerchantChoice(merchant, projection)
            : null;
        });
      } catch {
        // A stale/disabled ERP tenant, revoked binding or scope is hidden. It
        // is never represented by a permissive display capability.
        return null;
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
    const configuredMerchantIds = new Set(getBusinessWorkbenchMerchantIds());
    const merchantIds = (await db.listActiveBusinessMerchantScopes(account.id))
      .filter(scope => configuredMerchantIds.has(scope.merchantId) && businessScopeAllows(scope, "context", "read"))
      .map(scope => scope.merchantId);
    const result = await db.getBusinessWorkbenchMerchants(
      { page: input.page, pageSize: input.pageSize, search: input.search },
      merchantIds,
    );
    const data = (await Promise.all(result.data.map(async ({ id: merchantId }) => {
      try {
        return await withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account: currentAccount, staffBinding, scope, merchant }) => {
          const context = await getPlatformBusinessContext(businessEnterpriseBindingFromMerchant(merchant), {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: currentAccount.id,
            bindingVersion: staffBinding.bindingVersion,
          });
          const projection = projectBusinessWorkbenchCapabilities({
            scope,
            frontWorkbenchCapabilities: context.workbenchCapabilities,
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
    return withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }, async ({ account, staffBinding, scope, merchant }) => {
      const binding = businessEnterpriseBindingFromMerchant(merchant);
      let context;
      try {
        context = await getPlatformBusinessContext(
          binding,
          {
            staffUserId: staffBinding.frontUserId,
            adminAccountId: account.id,
            bindingVersion: staffBinding.bindingVersion,
          },
        );
      } catch (error) {
        if (error instanceof PlatformBusinessPublicError) {
          throw new TRPCError({ code: error.code, message: error.message });
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
      });
      if (!merchantCanEnterWorkbench(context, projection)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "前台业务员工主体当前不可用" });
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
