import { TRPCError } from "@trpc/server";
import { NATIVE_TEAM_READ_METHODS, NATIVE_FACTORY_PUBLISH_METHODS, officialInventoryMethodRequirement, type SignedOfficialInventoryGrant } from "../../../shared/internalBusinessOfficialInventory";
import { bindOfficialInventoryGrant, verifyOfficialInventoryGrant } from "./internalBusinessOfficialGrant";
import type { Request, Response } from "express";
import type { ErpPermissionKey } from "../../../shared/erpPermissions";
import type { TrpcContext, StaffDelegation } from "../_core/context";
import { inventoryRouter } from "../routers/inventory";
import { channelInventoryRouter } from "../routers/channelInventoryRuntime";
import { importInventoryRouter } from "../routers/importInventory";
import { inboundRouter } from "../routers/inbound";
import { customerRouter } from "../routers/customer";
import { customerDemandRouter } from "../routers/customerDemand";
import { crmSalesOrderRouter } from "../routers/crmSalesOrder";
import { personalPerformanceRouter } from "../routers/personalPerformance";
import { purchaseOrderRouter } from "../routers/purchaseOrder";
import { enterpriseRouter } from "../routers/enterprise";
import { companyRouter } from "../routers/company";
import { orderRouter } from "../routers/order";
import { pickupPointRouter } from "../routers/pickupPoint";
import { publicReviewRouter } from "../routers/publicReview";
import { materialRouter } from "../routers/material";
import { demandRouter } from "../routers/demand";
import { chatRouter } from "../routers/chat";
import { cartRouter } from "../routers/cart";
import { businessOrganizationRouter } from "../routers/businessOrganization";
import {
  requireBusinessConversation,
} from "./businessConversationScope";
import { executeBusinessChatMethod } from "./businessChat";
import {
  BUSINESS_CHAT_METHOD_IDS,
  BUSINESS_CHAT_METHOD_POLICIES,
  isBusinessChatMethodId,
  type BusinessChatMethodId,
} from "../../../shared/businessChat";
import {
  CHANNEL_INVENTORY_BUSINESS_METHOD_IDS,
  CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES,
} from "../../../shared/channelInventoryBusinessPolicy";
import {
  requireInternalBusinessStaffPrincipal,
  runWithBoundBusinessStaffActor,
  type InternalBusinessBinding,
  type InternalBusinessStaffPrincipal,
} from "./internalBusinessAccess";

export type BusinessMethodCapability = {
  mode: "read" | "write";
  /** First-line recheck; the real route repeats its own more specific check. */
  permission?: ErpPermissionKey | readonly ErpPermissionKey[];
};

/**
 * This is deliberately a source-controlled list, not a root AppRouter method
 * name supplied by a browser. Every delegated function enters its original
 * router, preserving its input parser, transactions, version checks,
 * idempotency and original permission checks. Methods that would create an
 * arbitrary/private chat or initiate a financial channel action are absent.
 */
export const BUSINESS_METHOD_IDS = [
  "inventory.list", "inventory.listPaged", "inventory.refreshStatus", "inventory.refreshPublished",
  "inventory.get", "inventory.uploadPhoto", "inventory.labelOcrAvailability", "inventory.recognizeLabel",
  "inventory.spotVerificationList", "inventory.prepareSpotStockVerification", "inventory.confirmSpotStockVerification",
  "inventory.verifySpotStock", "inventory.recognizeText", "inventory.create", "inventory.update", "inventory.publish",
  "inventory.publishAll", "inventory.listPublishJobs", "inventory.getPublishJob", "inventory.listPublishJobErrors",
  "inventory.pausePublishJob", "inventory.resumePublishJob", "inventory.retryPublishJob", "inventory.cancelPublishJob",
  "inventory.setCompanyCatalogVisibility", "inventory.setAllCompanyCatalogVisibility", "inventory.bulkSetCompanyCatalogVisibility",
  "inventory.offshelf", "inventory.bulkOffshelf", "inventory.offshelfAllPublished", "inventory.remove",
  "inventory.bulkRemove", "inventory.removeManyDrafts", "inventory.clearDrafts", "inventory.assignmentOptions", "inventory.reassign",
  "importInventory.batchImport", "importInventory.previewRows", "importInventory.createJob", "importInventory.stageBatch", "importInventory.finalizeJob",
  "importInventory.listJobs", "importInventory.getJob", "importInventory.getUploadPlan", "importInventory.listErrors",
  "importInventory.listFailedRows", "importInventory.pauseJob", "importInventory.resumeJob", "importInventory.retryFailedJob",
  "importInventory.cancelJob", "importInventory.repairList", "importInventory.repairClear",
  "importInventory.repairSave", "importInventory.repairSubmit",
  "inbound.uploadPhoto", "inbound.photos", "inbound.suggestPartNumbers", "inbound.overview", "inbound.list",
  "inbound.bulkCreate", "inbound.create", "inbound.update", "inbound.updateDetails", "inbound.paymentHistory",
  "inbound.markPaymentUnpaid", "inbound.recordPayment", "inbound.voidPayment", "inbound.receive", "inbound.cancelPreview",
  "inbound.cancelMany", "inbound.cancel", "inbound.remove",
  "customer.context", "customer.list", "customer.get", "customer.ownershipSearch", "customer.checkDuplicate",
  "customer.starContext", "customer.starState", "customer.setStar",
  "customerDemand.quoteAccept", "customer.create", "customer.update", "customer.addFollowUp", "customer.archive", "customer.restore", "customer.transfer",
  "customer.createMulti", "customer.contactsList", "customer.contactsSummary", "customer.contactsAdd",
  "customer.contactsEdit", "customer.contactsStop", "customer.contactsSetPrimary", "customer.updateBasic",
  "customerDemand.suggestPartNumbers", "customerDemand.quoteSave", "customerDemand.quoteWithdraw", "customerDemand.quoteList",
  "customerDemand.quoteHistory", "customerDemand.quoteAccept", "customerDemand.save", "customerDemand.list", "customerDemand.salesList",
  "customerDemand.get", "customerDemand.revisionHistory", "customerDemand.procurementList", "customerDemand.procurementGet", "customerDemand.claim",
  "crmSalesOrder.list", "crmSalesOrder.candidates", "crmSalesOrder.get", "crmSalesOrder.create", "crmSalesOrder.cancel",
  "crmSalesOrder.recordPayment", "crmSalesOrder.ship",
  "crmSalesOrder.customerSummary", "crmSalesOrder.customerMaterials",
  "personalPerformance.summary",
  "purchaseOrder.list", "purchaseOrder.get", "purchaseOrder.acceptedQuoteOptions", "purchaseOrder.inboundCandidates",
  "purchaseOrder.create", "purchaseOrder.updatePayment", "purchaseOrder.updateShipping", "purchaseOrder.linkInbound",
  "purchaseOrder.recordInvoice", "purchaseOrder.voidInvoice", "purchaseOrder.cancel",
  "enterprise.me", "enterprise.members", "enterprise.invitations", "enterprise.myInvitations", "enterprise.userRecords",
  "enterprise.archivePreview", "enterprise.archiveMember",
  "enterprise.businessHandoffPreview", "enterprise.businessHandoffState", "enterprise.inquiryInbox", "enterprise.handoffPreview",
  "enterprise.invite", "enterprise.revokeInvitation", "enterprise.updatePermissions", "enterprise.updateInventoryScope", "enterprise.setStatus",
  "enterprise.handoffMemberBusiness", "enterprise.businessHandoff", "enterprise.sendOwnershipTransferCode",
  "enterprise.verifyOwnershipTransferCode", "enterprise.transferOwnership", "enterprise.ownerTransfers",
  "company.get", "company.profilePhotos", "company.enterpriseAgreementStatus", "company.hkCapabilities", "company.hkDraft", "company.salesStaff",
  "company.save", "company.submitCrmApplication", "company.uploadLicense", "company.uploadBankLicense", "company.uploadProfilePhoto",
  "company.deleteProfilePhoto", "company.setProfileAvatar", "company.setProfileHomeCover", "company.uploadHkDocument", "company.submitHkApplication",
  "order.sellerOrders", "order.tracks", "order.expressCos", "order.logistics", "order.refundDetail",
  "order.sellerConfirmPay", "order.ship", "order.rejectRefund", "order.agreeReturn", "order.confirmOfflineRefund", "order.sellerCancel", "order.approveRefund",
  "pickupPoint.mine", "pickupPoint.save", "pickupPoint.remove",
  "publicReview.unreadCount", "publicReview.inbox", "publicReview.reply", "publicReview.markInboxRead",
  "material.lookup", "demand.receivedQuotes",
  ...CHANNEL_INVENTORY_BUSINESS_METHOD_IDS,
  ...BUSINESS_CHAT_METHOD_IDS,
  "publicReview.state", "publicReview.create",
  "cart.count",
  "organization.overview", "organization.audit", "organization.createTeam", "organization.updateTeam",
  "organization.setMember", "organization.updateMemberAccess",
] as const;

export type BusinessMethodId = (typeof BUSINESS_METHOD_IDS)[number];

const READ: BusinessMethodCapability = { mode: "read" };
const INVENTORY_READ: BusinessMethodCapability = { mode: "read", permission: ["inventory.manage", "inventory.publish"] };
const INVENTORY_MANAGE: BusinessMethodCapability = { mode: "write", permission: "inventory.manage" };
const INVENTORY_PUBLISH_READ: BusinessMethodCapability = { mode: "read", permission: "inventory.publish" };
const INVENTORY_PUBLISH: BusinessMethodCapability = { mode: "write", permission: "inventory.publish" };
const INVENTORY_INBOUND_READ: BusinessMethodCapability = { mode: "read", permission: "inventory.inbound" };
const INVENTORY_INBOUND: BusinessMethodCapability = { mode: "write", permission: "inventory.inbound" };
const CUSTOMER_READ: BusinessMethodCapability = { mode: "read", permission: ["customers.manage", "customers.manage_all"] };
const CUSTOMER: BusinessMethodCapability = { mode: "write", permission: ["customers.manage", "customers.manage_all"] };
const PROCUREMENT_DEMAND_READ: BusinessMethodCapability = { mode: "read", permission: "procurement.demands" };
const PROCUREMENT_DEMAND: BusinessMethodCapability = { mode: "write", permission: "procurement.demands" };
const DEMAND_QUOTE_READ: BusinessMethodCapability = { mode: "read", permission: ["customers.manage", "customers.manage_all", "procurement.demands"] };
const SALES_ORDER_READ: BusinessMethodCapability = { mode: "read", permission: "sales.business_orders" };
const SALES_ORDER: BusinessMethodCapability = { mode: "write", permission: "sales.business_orders" };
const PROCUREMENT_ORDER_READ: BusinessMethodCapability = { mode: "read", permission: "procurement.orders" };
const PROCUREMENT_ORDER: BusinessMethodCapability = { mode: "write", permission: "procurement.orders" };
const MEMBER_MANAGE_READ: BusinessMethodCapability = { mode: "read", permission: "enterprise.members.manage" };
const MEMBER_MANAGE: BusinessMethodCapability = { mode: "write", permission: "enterprise.members.manage" };

const INQUIRY_RECEIVE_READ: BusinessMethodCapability = { mode: "read", permission: "inquiry.receive" };
const INQUIRY_RECEIVE: BusinessMethodCapability = { mode: "write", permission: "inquiry.receive" };

export const BUSINESS_METHOD_CAPABILITIES: Record<BusinessMethodId, BusinessMethodCapability> = Object.fromEntries(
  BUSINESS_METHOD_IDS.map(method => [method, READ]),
) as Record<BusinessMethodId, BusinessMethodCapability>;

for (const method of [
  "inventory.list", "inventory.listPaged", "inventory.get", "inventory.spotVerificationList", "inventory.assignmentOptions",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_READ;
for (const method of [
  "inventory.labelOcrAvailability", "inventory.listPublishJobs", "inventory.getPublishJob", "inventory.listPublishJobErrors",
  "importInventory.listJobs", "importInventory.getJob", "importInventory.getUploadPlan", "importInventory.listErrors",
  "importInventory.listFailedRows", "importInventory.repairList", "material.lookup",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_PUBLISH_READ;
for (const method of [
  "inventory.refreshStatus", "inventory.refreshPublished", "inventory.setCompanyCatalogVisibility", "inventory.setAllCompanyCatalogVisibility",
  "inventory.bulkSetCompanyCatalogVisibility", "inventory.offshelf", "inventory.bulkOffshelf", "inventory.offshelfAllPublished",
  "inventory.remove", "inventory.bulkRemove", "inventory.prepareSpotStockVerification", "inventory.confirmSpotStockVerification",
  "inventory.verifySpotStock",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_MANAGE;
for (const method of [
  "inventory.uploadPhoto", "inventory.recognizeLabel", "inventory.recognizeText", "inventory.create", "inventory.update", "inventory.publish",
  "inventory.publishAll", "inventory.pausePublishJob", "inventory.resumePublishJob", "inventory.retryPublishJob",
  "inventory.cancelPublishJob", "inventory.removeManyDrafts", "inventory.clearDrafts", "importInventory.batchImport", "importInventory.previewRows",
  "importInventory.createJob", "importInventory.stageBatch", "importInventory.finalizeJob", "importInventory.pauseJob",
  "importInventory.resumeJob", "importInventory.retryFailedJob", "importInventory.cancelJob", "importInventory.repairClear",
  "importInventory.repairSave", "importInventory.repairSubmit",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_PUBLISH;
BUSINESS_METHOD_CAPABILITIES["inventory.reassign"] = MEMBER_MANAGE;
for (const method of [
  "inbound.photos", "inbound.suggestPartNumbers", "inbound.overview", "inbound.list", "inbound.paymentHistory", "inbound.cancelPreview",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_INBOUND_READ;
for (const method of [
  "inbound.uploadPhoto", "inbound.bulkCreate", "inbound.create", "inbound.update", "inbound.updateDetails", "inbound.markPaymentUnpaid",
  "inbound.recordPayment", "inbound.voidPayment", "inbound.receive", "inbound.cancelMany", "inbound.cancel", "inbound.remove",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = INVENTORY_INBOUND;
for (const method of [
  "customer.context", "customer.list", "customer.get", "customer.ownershipSearch", "customer.checkDuplicate", "customerDemand.suggestPartNumbers",
  "customer.starContext", "customer.starState", "customer.setStar",
  "customer.contactsList", "customer.contactsSummary",
  "customerDemand.list", "customerDemand.salesList", "customerDemand.get", "customerDemand.revisionHistory",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = CUSTOMER_READ;
for (const method of [
  "customerDemand.quoteAccept", "customer.create", "customer.update", "customer.addFollowUp", "customer.archive", "customer.restore", "customer.transfer", "customerDemand.save",
  "customer.createMulti", "customer.contactsAdd", "customer.contactsEdit", "customer.contactsStop",
  "customer.contactsSetPrimary", "customer.updateBasic",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = CUSTOMER;
for (const method of ["customerDemand.procurementList", "customerDemand.procurementGet", "demand.receivedQuotes"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = PROCUREMENT_DEMAND_READ;
}
for (const method of ["customerDemand.quoteSave", "customerDemand.quoteWithdraw", "customerDemand.claim"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = PROCUREMENT_DEMAND;
}
for (const method of ["customerDemand.quoteList", "customerDemand.quoteHistory"] as const) BUSINESS_METHOD_CAPABILITIES[method] = DEMAND_QUOTE_READ;
for (const method of ["crmSalesOrder.list", "crmSalesOrder.candidates", "crmSalesOrder.get", "crmSalesOrder.customerSummary", "crmSalesOrder.customerMaterials"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = SALES_ORDER_READ;
}
BUSINESS_METHOD_CAPABILITIES["personalPerformance.summary"] = SALES_ORDER_READ;
for (const method of ["crmSalesOrder.create", "crmSalesOrder.cancel", "crmSalesOrder.recordPayment", "crmSalesOrder.ship"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = SALES_ORDER;
}
for (const method of ["purchaseOrder.list", "purchaseOrder.get", "purchaseOrder.acceptedQuoteOptions", "purchaseOrder.inboundCandidates"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = PROCUREMENT_ORDER_READ;
}
for (const method of ["purchaseOrder.create", "purchaseOrder.updatePayment", "purchaseOrder.updateShipping", "purchaseOrder.linkInbound", "purchaseOrder.recordInvoice", "purchaseOrder.voidInvoice", "purchaseOrder.cancel"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = PROCUREMENT_ORDER;
}
for (const method of [
  "enterprise.members", "enterprise.invitations", "enterprise.myInvitations", "enterprise.userRecords", "enterprise.businessHandoffPreview",
  "enterprise.businessHandoffState", "enterprise.handoffPreview",
  "enterprise.archivePreview",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = MEMBER_MANAGE_READ;
for (const method of [
  "enterprise.invite", "enterprise.revokeInvitation", "enterprise.updatePermissions", "enterprise.updateInventoryScope", "enterprise.setStatus",
  "enterprise.archiveMember",
  "enterprise.handoffMemberBusiness", "enterprise.businessHandoff", "enterprise.sendOwnershipTransferCode", "enterprise.verifyOwnershipTransferCode",
  "enterprise.transferOwnership",
] as const) BUSINESS_METHOD_CAPABILITIES[method] = MEMBER_MANAGE;
BUSINESS_METHOD_CAPABILITIES["enterprise.inquiryInbox"] = INQUIRY_RECEIVE_READ;
BUSINESS_METHOD_CAPABILITIES["organization.overview"] = READ;
BUSINESS_METHOD_CAPABILITIES["organization.audit"] = MEMBER_MANAGE_READ;
for (const method of ["organization.createTeam", "organization.updateTeam", "organization.setMember", "organization.updateMemberAccess"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = MEMBER_MANAGE;
}

// Marketplace seller orders are not ERP outbound orders. The original order
// router authorizes each read/mutation with order.sellerId === ctx.user.id;
// therefore this bridge must not invent a sales_orders.manage prerequisite or
// substitute an enterprise owner/data owner for the real bound staff actor.
for (const method of ["order.sellerOrders", "order.tracks", "order.expressCos", "order.logistics", "order.refundDetail"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = READ;
}
for (const method of ["order.sellerConfirmPay", "order.ship", "order.rejectRefund", "order.agreeReturn", "order.confirmOfflineRefund", "order.sellerCancel", "order.approveRefund"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = { mode: "write" };
}
for (const method of ["pickupPoint.mine", "publicReview.unreadCount", "publicReview.inbox"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = READ;
}
for (const method of ["pickupPoint.save", "pickupPoint.remove", "publicReview.reply", "publicReview.markInboxRead"] as const) {
  BUSINESS_METHOD_CAPABILITIES[method] = { mode: "write" };
}
for (const method of CHANNEL_INVENTORY_BUSINESS_METHOD_IDS) {
  BUSINESS_METHOD_CAPABILITIES[method] = CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES[method];
}
for (const method of BUSINESS_CHAT_METHOD_IDS) {
  BUSINESS_METHOD_CAPABILITIES[method] = BUSINESS_CHAT_METHOD_POLICIES[method].mode === "read"
    ? INQUIRY_RECEIVE_READ
    : INQUIRY_RECEIVE;
}
BUSINESS_METHOD_CAPABILITIES["publicReview.state"] = INQUIRY_RECEIVE_READ;
BUSINESS_METHOD_CAPABILITIES["publicReview.create"] = INQUIRY_RECEIVE;
BUSINESS_METHOD_CAPABILITIES["cart.count"] = INQUIRY_RECEIVE_READ;

export function isBusinessMethodId(value: string): value is BusinessMethodId {
  return (BUSINESS_METHOD_IDS as readonly string[]).includes(value);
}

type RawBusinessProcedure = (input: unknown) => Promise<unknown>;
type DelegatedBusinessCallers = {
  inventory: Record<string, RawBusinessProcedure>;
  importInventory: Record<string, RawBusinessProcedure>;
  inbound: Record<string, RawBusinessProcedure>;
  customer: Record<string, RawBusinessProcedure>;
  customerDemand: Record<string, RawBusinessProcedure>;
  crmSalesOrder: Record<string, RawBusinessProcedure>;
  personalPerformance: Record<string, RawBusinessProcedure>;
  purchaseOrder: Record<string, RawBusinessProcedure>;
  enterprise: Record<string, RawBusinessProcedure>;
  company: Record<string, RawBusinessProcedure>;
  order: Record<string, RawBusinessProcedure>;
  pickupPoint: Record<string, RawBusinessProcedure>;
  publicReview: Record<string, RawBusinessProcedure>;
  material: Record<string, RawBusinessProcedure>;
  demand: Record<string, RawBusinessProcedure>;
  channelInventory: Record<string, RawBusinessProcedure>;
  organization: Record<string, RawBusinessProcedure>;
  chat: Record<string, RawBusinessProcedure>;
};

/** tRPC callers keep each original procedure's zod parsing and middleware. */
function asFixedCaller(value: unknown): Record<string, RawBusinessProcedure> {
  return value as Record<string, RawBusinessProcedure>;
}

function buildCallers(context: TrpcContext): DelegatedBusinessCallers {
  return {
    inventory: asFixedCaller(inventoryRouter.createCaller(context)),
    importInventory: asFixedCaller(importInventoryRouter.createCaller(context)),
    inbound: asFixedCaller(inboundRouter.createCaller(context)),
    customer: asFixedCaller(customerRouter.createCaller(context)),
    customerDemand: asFixedCaller(customerDemandRouter.createCaller(context)),
    crmSalesOrder: asFixedCaller(crmSalesOrderRouter.createCaller(context)),
    personalPerformance: asFixedCaller(personalPerformanceRouter.createCaller(context)),
    purchaseOrder: asFixedCaller(purchaseOrderRouter.createCaller(context)),
    enterprise: asFixedCaller(enterpriseRouter.createCaller(context)),
    company: asFixedCaller(companyRouter.createCaller(context)),
    order: asFixedCaller(orderRouter.createCaller(context)),
    pickupPoint: asFixedCaller(pickupPointRouter.createCaller(context)),
    publicReview: asFixedCaller(publicReviewRouter.createCaller(context)),
    material: asFixedCaller(materialRouter.createCaller(context)),
    demand: asFixedCaller(demandRouter.createCaller(context)),
    channelInventory: asFixedCaller(channelInventoryRouter.createCaller(context)),
    organization: asFixedCaller(businessOrganizationRouter.createCaller(context)),
    chat: asFixedCaller(chatRouter.createCaller(context)),
  };
}

type ReceptionReviewMethodId = "publicReview.state" | "publicReview.create";
type DirectBusinessMethodId = Exclude<BusinessMethodId, BusinessChatMethodId | ReceptionReviewMethodId | "cart.count">;

function splitMethod(method: DirectBusinessMethodId): [keyof DelegatedBusinessCallers, string] {
  const [namespace, procedure] = method.split(".", 2);
  return [namespace as keyof DelegatedBusinessCallers, procedure];
}

function positiveIntegerProperty(params: unknown, key: string, label: string) {
  const value = params && typeof params === "object" ? (params as Record<string, unknown>)[key] : undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}无效` });
  }
  return value as number;
}

function scopedConversationId(params: unknown) {
  return positiveIntegerProperty(params, "conversationId", "聊天会话标识");
}

async function callScopedChatMethod(input: {
  method: BusinessChatMethodId;
  params: unknown;
  principal: InternalBusinessStaffPrincipal;
  callers: DelegatedBusinessCallers;
}) {
  const scope = {
    enterpriseId: input.principal.enterprise.enterpriseId,
    staffUserId: input.principal.actorUserId,
  };
  return executeBusinessChatMethod({
    method: input.method,
    params: input.params,
    scope,
    callOriginal: async (procedure, params) => {
      const target = input.callers.chat[procedure];
      if (!target) throw new Error("INTERNAL_BUSINESS_CHAT_DISPATCH_MISSING");
      return target(params);
    },
  });
}

async function callScopedReceptionReviewMethod(input: {
  method: ReceptionReviewMethodId;
  params: unknown;
  principal: InternalBusinessStaffPrincipal;
  callers: DelegatedBusinessCallers;
}) {
  const [, procedure] = input.method.split(".", 2);
  const target = input.callers.publicReview[procedure];
  if (!target) throw new Error("INTERNAL_BUSINESS_REVIEW_DISPATCH_MISSING");
  await requireBusinessConversation({
    enterpriseId: input.principal.enterprise.enterpriseId,
    staffUserId: input.principal.actorUserId,
  }, scopedConversationId(input.params));
  return target(input.params);
}

export async function executeInternalBusinessMethod(input: {
  method: BusinessMethodId;
  params: unknown;
  binding: InternalBusinessBinding;
  staffUserId: number;
  adminActor: { id: number; name: string; role: string };
  bindingVersion: number;
  requestId: string;
  officialInventoryGrant?: SignedOfficialInventoryGrant;
  req: Request;
  res: Response;
}) {
  if (!isBusinessMethodId(input.method)) throw new TRPCError({ code: "BAD_REQUEST", message: "不支持的内部业务方法" });
  const capability = BUSINESS_METHOD_CAPABILITIES[input.method];
  const requirement = officialInventoryMethodRequirement(input.method);
  const grant = requirement ? verifyOfficialInventoryGrant(input.officialInventoryGrant, {
    ...input.binding, staffUserId: input.staffUserId, adminAccountId: input.adminActor.id,
    bindingVersion: input.bindingVersion, method: input.method, requestId: input.requestId,
  }) : undefined;
  if (grant && (!grant.read || !grant[requirement!])) throw new TRPCError({ code: "FORBIDDEN", message: "未获渠道库存对应官方权限" });
  const principal = await requireInternalBusinessStaffPrincipal({
    binding: input.binding,
    staffUserId: input.staffUserId,
    // Native publish is independent of the legacy seller ERP manage/publish role.
    // Real enterprise/member/stocks read and current owner/team boundaries remain locked in the route service.
    permission: grant?.read && (NATIVE_TEAM_READ_METHODS.includes(input.method)
      || (grant.publish === true && NATIVE_FACTORY_PUBLISH_METHODS.includes(input.method))) ? undefined : capability.permission,
  });
  return runWithBoundBusinessStaffActor({
    enterpriseId: principal.enterprise.enterpriseId,
    actorUserId: principal.actorUserId,
    action: async () => {
      const delegation: StaffDelegation = {
        kind: "business_bff",
        adminAccountId: input.adminActor.id,
        adminActorName: input.adminActor.name,
        adminActorRole: input.adminActor.role,
        staffUserId: principal.actorUserId,
        bindingVersion: input.bindingVersion,
        requestId: input.requestId,
        enterpriseId: principal.enterprise.enterpriseId,
      };
      if (grant) bindOfficialInventoryGrant(delegation, grant);
      const context: TrpcContext = {
        req: input.req,
        res: input.res,
        user: principal.user,
        effectiveUserId: principal.user.id,
        staffDelegation: delegation,
      };
      const callers = buildCallers(context);
      if (isBusinessChatMethodId(input.method)) {
        return callScopedChatMethod({ method: input.method, params: input.params, principal, callers });
      }
      if (input.method === "publicReview.state" || input.method === "publicReview.create") {
        return callScopedReceptionReviewMethod({ method: input.method, params: input.params, principal, callers });
      }
      if (input.method === "cart.count") {
        // A cart has no enterprise relation. This is deliberately the bound real
        // staff member's own original protected caller, never an owner/data-owner
        // projection and never selected by the merchant ID.
        return cartRouter.createCaller(context).count();
      }
      const [namespace, procedure] = splitMethod(input.method);
      const target = callers[namespace][procedure];
      // This remains a fail-closed guard if the source-controlled manifest changes.
      if (!target) throw new Error("INTERNAL_BUSINESS_METHOD_DISPATCH_MISSING");
      return target(input.params);
    },
  });
}
