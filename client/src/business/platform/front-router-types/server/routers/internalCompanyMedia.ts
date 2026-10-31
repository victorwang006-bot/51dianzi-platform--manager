import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getInternalCompanyHomepageFeatureStatus,
  setInternalCompanyHomepageFeatured,
  setInternalCompanyHomepageShowcased,
  type InternalCompanyHomepageOperator,
} from "../services/internalCompanyHomepageFeature";

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

/** 复用既有后台到主站的 PORTAL_API_KEY 安全通道，不另设生产密钥。 */
export function requireInternalCompanyMediaPortalKey(headers: Record<string, unknown> | undefined) {
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

/** 操作人由已认证后台服务注入，浏览器输入不能伪造。 */
function requireInternalCompanyMediaOperator(headers: Record<string, unknown> | undefined): InternalCompanyHomepageOperator {
  const id = readOperatorHeader(headers, "x-internal-operator-id");
  const name = readOperatorHeader(headers, "x-internal-operator-name");
  const role = readOperatorHeader(headers, "x-internal-operator-role");
  if (!id || !name || !role) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "后台操作人上下文缺失" });
  }
  return {
    id: id.slice(0, 128),
    name: name.slice(0, 128),
    role: role.slice(0, 64),
    ipAddress: readOperatorHeader(headers, "x-internal-operator-ip").slice(0, 64) || null,
    userAgent: readOperatorHeader(headers, "x-internal-operator-user-agent").slice(0, 512) || null,
  };
}

const creditCodeSchema = z.string().trim().min(1).max(64);
const expectedOwnerUserIdSchema = z.number().int().positive();
const mutationInput = z.object({
  creditCode: creditCodeSchema,
  expectedOwnerUserId: expectedOwnerUserIdSchema,
  reason: z.string().trim().min(1).max(500),
  requestId: z.string().trim().min(1).max(64),
});

export const internalCompanyMediaRouter = router({
  homepageFeatureStatus: publicProcedure
    .input(z.object({
      creditCode: creditCodeSchema,
      expectedOwnerUserId: expectedOwnerUserIdSchema,
    }))
    .query(async ({ ctx, input }) => {
      requireInternalCompanyMediaPortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return getInternalCompanyHomepageFeatureStatus(input);
    }),

  setHomepageFeatured: publicProcedure
    .input(mutationInput)
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requireInternalCompanyMediaPortalKey(headers);
      return setInternalCompanyHomepageFeatured({ ...input, featured: true, operator: requireInternalCompanyMediaOperator(headers) });
    }),

  clearHomepageFeatured: publicProcedure
    .input(mutationInput)
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requireInternalCompanyMediaPortalKey(headers);
      return setInternalCompanyHomepageFeatured({ ...input, featured: false, operator: requireInternalCompanyMediaOperator(headers) });
    }),

  setHomepageShowcased: publicProcedure
    .input(mutationInput)
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requireInternalCompanyMediaPortalKey(headers);
      return setInternalCompanyHomepageShowcased({ ...input, featured: true, operator: requireInternalCompanyMediaOperator(headers) });
    }),

  clearHomepageShowcased: publicProcedure
    .input(mutationInput)
    .mutation(async ({ ctx, input }) => {
      const headers = ctx.req?.headers as Record<string, unknown> | undefined;
      requireInternalCompanyMediaPortalKey(headers);
      return setInternalCompanyHomepageShowcased({ ...input, featured: false, operator: requireInternalCompanyMediaOperator(headers) });
    }),
});
