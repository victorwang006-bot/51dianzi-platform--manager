import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getPortalForumMessages,
  getPortalErpUserIds,
  getPortalModerationHistory,
  getPortalUserStats,
  hidePortalForumMessage,
  listPortalUsers,
  setPortalUserForumMute,
  setPortalUserLoginDisabled,
} from "../db";

/** 内部接口：供后台（admin.51dianzi.com）读取并管控前台注册用户。 */
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
  // 长度先比对、内容再 timing-safe；expected 为空时绝不放行。
  const authenticated = expectedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
  if (!authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败" });
  }
}

const operatorSchema = z.object({
  id: z.union([
    z.number().int().positive().transform(value => String(value)),
    z.string().trim().min(1).max(128),
  ]),
  name: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(64),
  ipAddress: z.string().trim().max(64).nullable().optional(),
  userAgent: z.string().trim().max(512).nullable().optional(),
});

function moderationError(error: unknown): never {
  const message = error instanceof Error ? error.message : "内部管控操作失败";
  if (message.includes("不存在")) throw new TRPCError({ code: "NOT_FOUND", message });
  if (message.includes("禁止禁用") || message.includes("仅可管理前台注册用户")) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  throw error;
}

export const internalUserRouter = router({
  stats: publicProcedure.query(async ({ ctx }) => {
    requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
    return getPortalUserStats();
  }),

  erpUserIds: publicProcedure.query(async ({ ctx }) => {
    requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
    return getPortalErpUserIds();
  }),

  list: publicProcedure
    .input(z.object({
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
      keyword: z.string().trim().max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return listPortalUsers(input);
    }),

  setLoginDisabled: publicProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      disabled: z.boolean(),
      reason: z.string().trim().min(1).max(500),
      operator: operatorSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setPortalUserLoginDisabled(input).catch(moderationError);
    }),

  setForumMute: publicProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      durationHours: z.union([
        z.literal(3), z.literal(6), z.literal(24), z.literal(72), z.literal(168), z.null(),
      ]),
      reason: z.string().trim().min(1).max(500),
      operator: operatorSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return setPortalUserForumMute(input).catch(moderationError);
    }),

  moderationHistory: publicProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return getPortalModerationHistory(input.userId, input.limit).catch(moderationError);
    }),

  forumMessages: publicProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return getPortalForumMessages(input.userId, input.limit).catch(moderationError);
    }),

  hideForumMessage: publicProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      reason: z.string().trim().min(1).max(500),
      operator: operatorSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return hidePortalForumMessage(input).catch(moderationError);
    }),
});
