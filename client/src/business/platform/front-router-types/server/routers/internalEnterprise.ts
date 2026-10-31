import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ERP_PERMISSION_KEYS } from "../../../shared/erpPermissions";
import { publicProcedure, router } from "../_core/trpc";
import {
  listInternalEnterpriseMembers,
  setInternalEnterpriseMemberLoginDisabled,
  setInternalEnterpriseMemberPermissions,
  setInternalEnterpriseMemberScope,
  setInternalEnterpriseMemberStatus,
} from "../services/internalEnterpriseAdmin";

function readPortalKey(headers: Record<string, unknown> | undefined) {
  const value = headers?.["x-portal-key"];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

/** Empty configured/provided keys never authenticate; equal-length secrets use constant-time comparison. */
export function requireInternalEnterprisePortalKey(headers: Record<string, unknown> | undefined) {
  const expected = process.env.PORTAL_API_KEY?.trim() ?? "";
  const provided = readPortalKey(headers).trim();
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const authenticated = expectedBuffer.length > 0
    && providedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
  if (!authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败" });
  }
}

const creditCodeSchema = z.string().trim().min(1).max(64);
const registrationIdentifierSchema = z.string().trim().regex(/^HK:\d{8}$/, "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN");
const expectedOwnerUserIdSchema = z.number().int().positive();
const operatorSchema = z.object({
  id: z.union([
    z.number().int().positive().transform(value => String(value)),
    z.string().trim().min(1).max(128),
  ]),
  name: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(64),
  ipAddress: z.string().trim().max(64).nullable(),
  userAgent: z.string().trim().max(512).nullable(),
});
const enterpriseIdentityInput = {
  creditCode: creditCodeSchema.optional(),
  registrationIdentifier: registrationIdentifierSchema.optional(),
};
function requireExactlyOneEnterpriseIdentity(value: { creditCode?: string; registrationIdentifier?: string }) {
  return Boolean(value.creditCode) !== Boolean(value.registrationIdentifier);
}
const commonMutationInput = {
  ...enterpriseIdentityInput,
  expectedOwnerUserId: expectedOwnerUserIdSchema,
  targetUserId: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  requestId: z.string().trim().min(1).max(64),
  operator: operatorSchema,
};

/** Internal API consumed by the independent administration backend. */
export const internalEnterpriseRouter = router({
  members: publicProcedure
    .input(z.object({
      ...enterpriseIdentityInput,
      expectedOwnerUserId: expectedOwnerUserIdSchema.optional(),
      status: z.enum(["all", "active", "suspended"]).optional().default("all"),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .query(async ({ ctx, input }) => {
      requireInternalEnterprisePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return listInternalEnterpriseMembers(input);
    }),

  setMemberStatus: publicProcedure
    .input(z.object({
      ...commonMutationInput,
      status: z.enum(["active", "suspended"]),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .mutation(async ({ ctx, input }) => {
      requireInternalEnterprisePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setInternalEnterpriseMemberStatus(input);
    }),

  setMemberPermissions: publicProcedure
    .input(z.object({
      ...commonMutationInput,
      permissionKeys: z.array(z.enum(ERP_PERMISSION_KEYS)).min(1).max(ERP_PERMISSION_KEYS.length)
        .refine(values => new Set(values).size === values.length, "ERP权限不能重复"),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .mutation(async ({ ctx, input }) => {
      requireInternalEnterprisePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setInternalEnterpriseMemberPermissions(input);
    }),

  setMemberScope: publicProcedure
    .input(z.object({
      ...commonMutationInput,
      inventoryDataScope: z.enum(["own", "enterprise"]),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .mutation(async ({ ctx, input }) => {
      requireInternalEnterprisePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setInternalEnterpriseMemberScope(input);
    }),

  setLoginDisabled: publicProcedure
    .input(z.object({
      ...commonMutationInput,
      disabled: z.boolean(),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .mutation(async ({ ctx, input }) => {
      requireInternalEnterprisePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setInternalEnterpriseMemberLoginDisabled(input);
    }),
});
