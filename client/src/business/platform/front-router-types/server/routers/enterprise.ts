import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ERP_PERMISSION_KEYS } from "../../../shared/erpPermissions";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getEnterpriseCompany,
  listEnterpriseOwnerTransfers,
  requestEnterpriseOwnershipTransfer,
  sendEnterpriseOwnershipTransferCode,
  verifyEnterpriseOwnershipTransferCode,
} from "../services/enterpriseAccess";
import {
  acceptEnterpriseInvitation,
  createEnterpriseInvitation,
  listEnterpriseInvitations,
  listEnterpriseMembersWithPermissions,
  listMyEnterpriseInvitations,
  rejectEnterpriseInvitation,
  revokeEnterpriseInvitation,
  setEnterpriseMemberStatusV2,
} from "../services/enterpriseInvitations";
import {
  replaceEnterpriseMemberPermissions,
  resolveEnterprisePermissionScope,
  updateEnterpriseMemberInventoryScope,
} from "../services/enterprisePermissions";
import { listEnterprisesForCurrentUser } from "../services/enterpriseListForCurrentUser";
import {
  handoffEnterpriseMemberBusiness,
  previewEnterpriseMemberHandoff,
} from "../services/enterpriseMemberHandoff";
import {
  ENTERPRISE_USER_RECORD_EVENT_TYPES,
  listEnterpriseUserRecords,
} from "../services/enterpriseUserRecords";
import {
  previewEnterpriseBusinessHandoff,
  executeEnterpriseBusinessHandoff,
  getEnterpriseBusinessHandoffState,
  listEnterpriseInquiryInbox,
} from "../services/enterpriseBusinessHandoff";
import { previewEnterpriseMemberArchive, archiveEnterpriseMember } from "../services/enterpriseMemberArchive";

const permissionSchema = z.enum(ERP_PERMISSION_KEYS);
const requestIdSchema = z.string().min(8).max(64).default(() => randomUUID());
const businessHandoffScopeSchema = z.object({
  kind: z.enum(["inquiry", "inventory"]),
  scope: z.enum(["enterprise", "selected"]),
  inventoryIds: z.array(z.number().int().positive()).max(500).optional(),
});
function validBusinessHandoffScope(input: z.infer<typeof businessHandoffScopeSchema>) {
  const ids = input.inventoryIds ?? [];
  return new Set(ids).size === ids.length
    && (input.scope === "selected" ? ids.length > 0 : ids.length === 0);
}

export const enterpriseRouter = router({
  /**
   * Existing enterprise-session data source. It only reports actual membership
   * relations; choosing an operating target is handled by the restored session.
   */
  listForCurrentUser: protectedProcedure.query(({ ctx }) =>
    listEnterprisesForCurrentUser(ctx.user.id)),

  me: protectedProcedure.query(async ({ ctx }) => {
    const scope = await resolveEnterprisePermissionScope(ctx.user.id);
    if (!scope) {
      return {
        currentUserId: ctx.user.id,
        enterprise: null,
        member: null,
        company: null,
        isOwner: false,
        permissionKeys: [],
        permissionVersion: 0,
        permissions: { manageMembers: false, inviteAdmins: false },
      } as const;
    }
    if (ctx.user.role !== "admin" && scope.member.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业成员已停用，不能查看企业资料" });
    }
    const manageMembers =
      scope.member.status === "active"
      && (scope.isOwner || scope.permissionKeys.includes("enterprise.members.manage"));
    const company = await getEnterpriseCompany(scope.enterprise);
    // The general enterprise summary is available to every active member. Never include
    // sensitive document locations here; owner/admin-only routes issue access URLs separately.
    const canAccessSensitiveCompanyData = scope.isOwner || ctx.user.role === "admin";
    let safeCompany = company
      ? (({
          licenseObjectKey: _licenseObjectKey,
          bankLicenseObjectKey: _bankLicenseObjectKey,
          licenseUrl: _licenseUrl,
          bankLicenseUrl: _bankLicenseUrl,
          ...safe
        }) => ({
          ...safe,
          pendingDraft: canAccessSensitiveCompanyData ? company.pendingDraft : null,
          registrationData: canAccessSensitiveCompanyData ? company.registrationData : null,
          registrationIdentifier: canAccessSensitiveCompanyData ? company.registrationIdentifier : null,
          registrationSubmissionId: canAccessSensitiveCompanyData ? company.registrationSubmissionId : null,
          registrationPayloadHash: canAccessSensitiveCompanyData ? company.registrationPayloadHash : null,
          creditCode: canAccessSensitiveCompanyData ? company.creditCode : null,
          legalPerson: canAccessSensitiveCompanyData ? company.legalPerson : null,
          bankInfo: canAccessSensitiveCompanyData ? company.bankInfo : null,
          bankAccountName: canAccessSensitiveCompanyData ? company.bankAccountName : null,
          bankAccountNumber: canAccessSensitiveCompanyData ? company.bankAccountNumber : null,
          bankName: canAccessSensitiveCompanyData ? company.bankName : null,
          licenseFileName: canAccessSensitiveCompanyData ? company.licenseFileName : null,
          bankLicenseFileName: canAccessSensitiveCompanyData ? company.bankLicenseFileName : null,
        }))(company)
      : company;
    if (company?.registrationRegion === "HK") {
      safeCompany = { ...safeCompany!, pendingDraft: null, registrationData: null,
        bankAccountName: canAccessSensitiveCompanyData ? company.bankAccountName : null,
        bankAccountNumber: canAccessSensitiveCompanyData ? company.bankAccountNumber : null,
        bankName: canAccessSensitiveCompanyData ? company.bankName : null,
        registrationIdentifier: canAccessSensitiveCompanyData ? company.registrationIdentifier : null,
        licenseFileName: null, bankLicenseFileName: null };
    }
    return {
      currentUserId: ctx.user.id,
      isSubUser: false,
      enterprise: scope.enterprise.registrationRegion === "HK" && !scope.isOwner && ctx.user.role !== "admin"
        ? { ...scope.enterprise, registrationIdentifier: null }
        : scope.enterprise,
      member: scope.member,
      company: safeCompany,
      isOwner: scope.isOwner,
      permissionKeys: scope.permissionKeys,
      permissionVersion: scope.member.permissionVersion,
      permissions: { manageMembers, inviteAdmins: scope.isOwner },
    } as const;
  }),

  members: protectedProcedure.query(({ ctx }) =>
    listEnterpriseMembersWithPermissions(ctx.user.id)),

  archivePreview: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(({ ctx, input }) => previewEnterpriseMemberArchive({ actorUserId: ctx.user.id, targetUserId: input.userId })),

  archiveMember: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(), nextOwnerUserId: z.number().int().positive().optional(),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    }))
    .mutation(({ ctx, input }) => archiveEnterpriseMember({ actorUserId: ctx.user.id, targetUserId: input.userId,
      nextOwnerUserId: input.nextOwnerUserId, requestId: input.requestId, expectedRevision: input.expectedRevision })),

  businessHandoffPreview: protectedProcedure
    .input(businessHandoffScopeSchema.refine(validBusinessHandoffScope, "请选择有效的库存交接范围"))
    .query(({ ctx, input }) => previewEnterpriseBusinessHandoff({ actorUserId: ctx.user.id, ...input })),

  businessHandoff: protectedProcedure
    .input(businessHandoffScopeSchema.extend({
      nextUserId: z.number().int().positive(),
      transferFuture: z.boolean(),
      transferPending: z.boolean(),
      requestId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
      expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    }).refine(validBusinessHandoffScope, "请选择有效的库存交接范围")
      .refine(input => input.kind !== "inquiry" || input.transferFuture || input.transferPending,
        "请至少选择后续新询价或已有未结询价")
      .refine(input => input.kind !== "inventory" || !input.transferFuture,
        "库存交接不能同时设置未来询价负责人"))
    .mutation(({ ctx, input }) => executeEnterpriseBusinessHandoff({ actorUserId: ctx.user.id, ...input })),

  businessHandoffState: protectedProcedure.query(({ ctx }) =>
    getEnterpriseBusinessHandoffState({ actorUserId: ctx.user.id })),

  inquiryInbox: protectedProcedure
    .input(z.object({
      status: z.enum(["all", "open", "replied", "closed"]).default("all"),
      page: z.number().int().min(1).max(100000).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }).default({ status: "all", page: 1, pageSize: 20 }))
    .query(({ ctx, input }) => listEnterpriseInquiryInbox({ actorUserId: ctx.user.id, ...input })),

  invitations: protectedProcedure.query(({ ctx }) =>
    listEnterpriseInvitations(ctx.user.id)),

  myInvitations: protectedProcedure.query(({ ctx }) =>
    listMyEnterpriseInvitations(ctx.user.id)),

  invite: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(1).max(32),
        permissionKeys: z.array(permissionSchema).min(1).max(ERP_PERMISSION_KEYS.length),
        inventoryDataScope: z.enum(["own", "enterprise"]).default("own"),
        requestId: requestIdSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      createEnterpriseInvitation({ actorUserId: ctx.user.id, ...input })),

  revokeInvitation: protectedProcedure
    .input(z.object({ invitationId: z.number().int().positive(), requestId: requestIdSchema }))
    .mutation(({ ctx, input }) =>
      revokeEnterpriseInvitation({ actorUserId: ctx.user.id, ...input })),

  acceptInvitation: protectedProcedure
    .input(z.object({ invitationId: z.number().int().positive(), requestId: requestIdSchema }))
    .mutation(({ ctx, input }) =>
      acceptEnterpriseInvitation({ userId: ctx.user.id, ...input })),

  rejectInvitation: protectedProcedure
    .input(z.object({ invitationId: z.number().int().positive(), requestId: requestIdSchema }))
    .mutation(({ ctx, input }) =>
      rejectEnterpriseInvitation({ userId: ctx.user.id, ...input })),

  updatePermissions: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        permissionKeys: z.array(permissionSchema).min(1).max(ERP_PERMISSION_KEYS.length),
        requestId: requestIdSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      replaceEnterpriseMemberPermissions({ actorUserId: ctx.user.id, targetUserId: input.userId, ...input })),

  updateInventoryScope: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        inventoryDataScope: z.enum(["own", "enterprise"]),
        requestId: requestIdSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      updateEnterpriseMemberInventoryScope({
        actorUserId: ctx.user.id,
        targetUserId: input.userId,
        inventoryDataScope: input.inventoryDataScope,
        requestId: input.requestId,
      })),

  setStatus: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        status: z.enum(["active", "suspended"]),
        requestId: requestIdSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      setEnterpriseMemberStatusV2({ actorUserId: ctx.user.id, targetUserId: input.userId, ...input })),

  handoffPreview: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      mode: z.enum(["handoff_only", "handoff_remove"]).default("handoff_only"),
    }))
    .query(({ ctx, input }) =>
      previewEnterpriseMemberHandoff({
        actorUserId: ctx.user.id,
        targetUserId: input.userId,
        mode: input.mode,
      })),

  handoffMemberBusiness: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        nextOwnerUserId: z.number().int().positive().optional(),
        mode: z.enum(["handoff_only", "handoff_remove"]),
        requestId: requestIdSchema,
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      handoffEnterpriseMemberBusiness({
        actorUserId: ctx.user.id,
        targetUserId: input.userId,
        nextOwnerUserId: input.nextOwnerUserId,
        mode: input.mode,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
      })),

  sendOwnershipTransferCode: protectedProcedure
    .input(z.object({
      targetUserId: z.number().int().positive(),
      requestId: requestIdSchema,
    }))
    .mutation(({ ctx, input }) =>
      sendEnterpriseOwnershipTransferCode({ actorUserId: ctx.user.id, ...input })),

  verifyOwnershipTransferCode: protectedProcedure
    .input(z.object({
      targetUserId: z.number().int().positive(),
      requestId: requestIdSchema,
      code: z.string().trim().regex(/^\d{6}$/, "请输入6位验证码"),
    }))
    .mutation(({ ctx, input }) =>
      verifyEnterpriseOwnershipTransferCode({ actorUserId: ctx.user.id, ...input })),

  transferOwnership: protectedProcedure
    .input(z.object({
      targetUserId: z.number().int().positive(),
      reason: z.string().trim().min(2).max(500),
      requestId: requestIdSchema,
      verificationTicket: z.string().trim().min(1).max(2048),
    }))
    .mutation(({ ctx, input }) =>
      requestEnterpriseOwnershipTransfer({
        actorUserId: ctx.user.id,
        targetUserId: input.targetUserId,
        reason: input.reason,
        requestId: input.requestId,
        verificationTicket: input.verificationTicket,
        actorName: ctx.user.name || ctx.user.username || undefined,
      })),

  userRecords: protectedProcedure
    .input(z.object({
      keyword: z.string().trim().max(64).optional(),
      eventType: z.enum(ENTERPRISE_USER_RECORD_EVENT_TYPES).default("all"),
      timeRange: z.enum(["all", "7d", "30d"]).default("all"),
    }).default({ eventType: "all", timeRange: "all" }))
    .query(({ ctx, input }) => listEnterpriseUserRecords({
      actorUserId: ctx.user.id,
      keyword: input.keyword,
      eventType: input.eventType,
      timeRange: input.timeRange,
    })),

  ownerTransfers: protectedProcedure.query(({ ctx }) => listEnterpriseOwnerTransfers(ctx)),
});
