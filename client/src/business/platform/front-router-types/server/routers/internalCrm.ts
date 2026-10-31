import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  completeEnterpriseSuperAdminTransferFromAdmin,
  validateEnterpriseRebindTarget,
} from "../services/enterpriseAccess";

function readPortalKey(headers: Record<string, unknown> | undefined) {
  const value = headers?.["x-portal-key"];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function requirePortalKey(headers: Record<string, unknown> | undefined) {
  const expected = process.env.PORTAL_API_KEY?.trim() ?? "";
  const provided = readPortalKey(headers).trim();
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const authenticated = expectedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);

  if (!authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败" });
  }
}

const enterpriseIdentityInput = {
  creditCode: z.string().trim().min(1).max(64).optional(),
  registrationIdentifier: z.string().trim().regex(/^HK:\d{8}$/, "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN").optional(),
};
function requireExactlyOneEnterpriseIdentity(value: { creditCode?: string; registrationIdentifier?: string }) {
  return Boolean(value.creditCode) !== Boolean(value.registrationIdentifier);
}

export const internalCrmRouter = router({
  validateRebindTarget: publicProcedure
    .input(z.object({
      ...enterpriseIdentityInput,
      expectedPortalUserId: z.string().min(1),
      newPortalUserId: z.string().min(1),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return validateEnterpriseRebindTarget(input);
    }),

  /** 后台本地换绑成功后确认；此单向调用负责平台企业超级管理员的原子切换。 */
  completeRebind: publicProcedure
    .input(z.object({
      ...enterpriseIdentityInput,
      expectedPortalUserId: z.string().trim().min(1).max(64),
      newPortalUserId: z.string().trim().min(1).max(64),
      reason: z.string().trim().min(2).max(1000),
      requestId: z.string().trim().min(8).max(64),
    }).refine(requireExactlyOneEnterpriseIdentity, "必须且只能提供统一社会信用代码或香港企业标识"))
    .mutation(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return completeEnterpriseSuperAdminTransferFromAdmin(input);
    }),
});
