import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  approveSpotVerificationReview,
  cancelActiveSpotVerification,
  listEnterpriseActiveSpotVerifications,
  listEnterpriseSpotVerificationReviews,
  rejectSpotVerificationReview,
  type SpotVerificationReviewOperator,
} from "../services/spotVerificationReview";

function readHeader(headers: Record<string, unknown> | undefined, name: string) {
  const value = headers?.[name];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function readOperatorHeader(headers: Record<string, unknown> | undefined, name: string) {
  const value = readHeader(headers, name).trim();
  if (!value.startsWith("b64.")) return value;
  try {
    return Buffer.from(value.slice(4), "base64url").toString("utf8").trim();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "后台操作人请求头编码无效" });
  }
}

function requirePortalKey(headers: Record<string, unknown> | undefined) {
  const expected = process.env.PORTAL_API_KEY?.trim() ?? "";
  const provided = readHeader(headers, "x-portal-key").trim();
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const authenticated = expectedBuffer.length > 0
    && providedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
  if (!authenticated) throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败" });
}

function requireOperator(headers: Record<string, unknown> | undefined): SpotVerificationReviewOperator {
  const id = Number(readOperatorHeader(headers, "x-internal-operator-id"));
  const name = readOperatorHeader(headers, "x-internal-operator-name");
  const role = readOperatorHeader(headers, "x-internal-operator-role");
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !role) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "后台操作人上下文缺失" });
  }
  return {
    id,
    name: name.slice(0, 128),
    role: role.slice(0, 64),
    ipAddress: readOperatorHeader(headers, "x-internal-operator-ip").slice(0, 64) || null,
    userAgent: readOperatorHeader(headers, "x-internal-operator-user-agent").slice(0, 512) || null,
  };
}

const bindingInput = z.object({
  creditCode: z.string().trim().min(1).max(64),
  expectedOwnerUserId: z.number().int().positive(),
});

export const internalSpotVerificationRouter = router({
  listReviews: publicProcedure
    .input(bindingInput.extend({
      status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return listEnterpriseSpotVerificationReviews(input);
    }),

  listActive: publicProcedure
    .input(bindingInput)
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return listEnterpriseActiveSpotVerifications(input);
    }),

  approve: publicProcedure
    .input(bindingInput.extend({ reviewId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requirePortalKey(headers);
      return approveSpotVerificationReview({ ...input, operator: requireOperator(headers) });
    }),

  reject: publicProcedure
    .input(bindingInput.extend({ reviewId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requirePortalKey(headers);
      return rejectSpotVerificationReview({ ...input, operator: requireOperator(headers) });
    }),

  cancel: publicProcedure
    .input(bindingInput.extend({ verificationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requirePortalKey(headers);
      return cancelActiveSpotVerification({ ...input, operator: requireOperator(headers) });
    }),
});
