import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getOrderDetailForAdmin, getOrderStatsForAdmin, listOrdersForAdmin } from "../db";

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

// 与 drizzle/schema.ts 的 ORDER_STATUSES 同步；新增状态必须同时补在此处，
// 否则后台按该状态筛选会被 zod 拒绝为非法入参。
const orderStatus = z.enum([
  "pending",
  "paid",
  "shipped",
  "done",
  "refund",
  "cancel",
  "refunded",
]);

/**
 * 销售可见范围入参。
 *
 * ⚠️ 三态语义必须完整穿透到 db 层：
 *   字段缺失/undefined → 不限制（超级管理员）
 *   []                   → 什么都看不到
 *   [...]                → 仅这些销售名下客户
 * 切勿在此处用 `.default([])` 或 `?? []`：那会把「不限制」静默变成
 * 「什么都看不到」，超级管理员的订单页会直接变空；
 * 反之若把 [] 当 undefined 处理，则是全量越权。
 */
const salesStaffCodesInput = z.array(z.string().trim().min(1).max(64)).optional();

/** 统计与列表共用的筛选条件：两边入参不一致会导致统计与列表对不上。 */
const orderFilterShape = {
  keyword: z.string().trim().max(100).optional(),
  status: orderStatus.optional(),
  buyerId: z.number().int().positive().optional(),
  sellerId: z.number().int().positive().optional(),
  createdFrom: z.number().int().nonnegative().optional(),
  createdTo: z.number().int().nonnegative().optional(),
  salesStaffCodes: salesStaffCodesInput,
};

const createdRangeValid = (value: {
  createdFrom?: number;
  createdTo?: number;
}) => value.createdFrom === undefined
  || value.createdTo === undefined
  || value.createdFrom <= value.createdTo;

export const internalOrderRouter = router({
  /**
   * 后台订单统计。
   *
   * 之前本接口缺失，而管理端一直在调 internalOrder.stats，
   * 因此后台订单页的统计卡片自上线起就恒为「—」，
   * 并提示 No procedure found on path "internalOrder.stats"。
   */
  stats: publicProcedure
    .input(z.object(orderFilterShape).refine(createdRangeValid, {
      message: "开始时间不能晚于结束时间",
      path: ["createdTo"],
    }).optional())
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return getOrderStatsForAdmin(input ?? {});
    }),

  list: publicProcedure
    .input(z.object({
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
      ...orderFilterShape,
    }).refine(createdRangeValid, {
      message: "开始时间不能晚于结束时间",
      path: ["createdTo"],
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return listOrdersForAdmin(input);
    }),

  detail: publicProcedure
    .input(z.object({
      orderId: z.number().int().positive(),
      salesStaffCodes: salesStaffCodesInput,
    }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      // 详情同样校验范围，否则遍历 orderId 即可读到他人客户的订单详情
      const detail = await getOrderDetailForAdmin(input.orderId, input.salesStaffCodes);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
      return detail;
    }),
});
