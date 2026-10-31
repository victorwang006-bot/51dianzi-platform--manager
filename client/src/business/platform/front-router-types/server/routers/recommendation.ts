import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, quotaProcedure, router } from "../_core/trpc";
import {
  generateRecommendationsForUser,
  getTodayRecommendations,
  toggleRecommendationFavorite,
} from "../services/marketRecommendation";
import { issueMaterialExposureToken, materialExposureAudience } from "../services/searchHeat";

const filtersSchema = z.object({
  category: z.string().optional(),
  brand: z.string().optional(),
  leadTime: z.enum(["spot", "3d", "7d", "15d"]).optional(),
  favoriteOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

function throwSafeRecommendationError(stage: string, error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "unknown")
    : "unknown";
  console.error("[recommendation] request failed", {
    stage,
    type: error instanceof Error ? error.name : typeof error,
    code,
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "推荐服务暂时不可用，请稍后重试",
  });
}

export const recommendationRouter = router({
  /**
   * 今日推荐包含逐条报价、库存和销售方信息；只能向已登录账号发放，
   * 并纳入每日查询配额，不能因客户端路由可达而匿名暴露。
   */
  today: quotaProcedure
    .input(filtersSchema.optional())
    .query(async ({ ctx, input }) => {
      try {
        const result = await getTodayRecommendations(ctx.user.id, input ?? {});
        return {
          ...result,
          exposureToken: issueMaterialExposureToken(
            result.items.map(item => item.partNumber),
            "recommendation",
            materialExposureAudience(ctx.req, ctx.user?.id),
          ),
        };
      } catch (error) {
        throwSafeRecommendationError("today", error);
      }
    }),
  refreshMine: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const count = await generateRecommendationsForUser(ctx.user.id);
      return { count };
    } catch (error) {
      throwSafeRecommendationError("refresh-mine", error);
    }
  }),
  toggleFavorite: protectedProcedure
    .input(z.object({ inventoryId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => toggleRecommendationFavorite(ctx.user.id, input.inventoryId)),
});
