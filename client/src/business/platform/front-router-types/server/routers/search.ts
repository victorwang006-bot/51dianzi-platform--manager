import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  dataViewProcedure,
  protectedProcedure,
  publicProcedure,
  quotaProcedure,
  router,
} from "../_core/trpc";
import {
  aggregateBrands,
  aggregateCategories,
  followSupplier,
  getFollowedSupplierIds,
  getPublishedInventoryById,
  getRelatedInventories,
  listFollowedSuppliers,
  searchPublishedInventories,
  unfollowSupplier,
} from "../db";
import {
  clearSearchHistory,
  deleteSearchHistoryEntry,
  getPopularSearchTerms,
  getSearchHistory,
  recordSearchEvent,
} from "../services/marketRecommendation";
import { materialThumbnailUrls } from "../adminDb";
import { stripRankingInternalsFromList } from "../rankingPrivacy";
import {
  approvedMaterialGeneratedImageItemMap,
} from "../services/materialGeneratedImages";
import { attachProductCatalogImages } from "../services/productCatalogImages";
import {
  issueRelatedDetailReadToken,
  verifyRelatedDetailReadToken,
} from "../services/productDetailReadToken";
import { agencyBrandsForSuppliers } from "../services/agencyCertification";
import { searchApprovedVisualOnly } from "../services/searchApprovedVisualOnly";
import {
  issueMaterialExposureToken,
  materialExposureAudience,
  recordSuccessfulPopularSearch,
} from "../services/searchHeat";
import {
  getPublicCatalogPreviewDetail,
  hasPublicCatalogLikeMetacharacters,
  listPublicCatalogPreviews,
  suggestPublicCatalog,
} from "../services/publicCatalog";
import { getSearchSupplierQqsMap } from "../services/companyPublicProfile";
import { readSearchSpotVerificationPhoto } from "../services/searchSpotVerificationPhoto";

const safeAnonymousCatalogText = z
  .string()
  .trim()
  .max(100)
  .refine(value => !hasPublicCatalogLikeMetacharacters(value), {
    message: "搜索内容不能包含通配符",
  });

const meaningfulSearchCharacter = new RegExp("[\\p{L}\\p{N}]", "u");

const safeAnonymousSuggestText = safeAnonymousCatalogText
  .min(2)
  .refine(
    value =>
      Array.from(value).filter(char => meaningfulSearchCharacter.test(char)).length >= 2,
    {
      message: "请输入至少两个有效字符",
    }
  );

/**
 * 搜索路由（对照原型 51dianzi_search_v7.html）
 * - search/detail: 登录后精确报价与供应商资料，计入查询配额
 * - preview/suggest: 匿名可用的聚合型号目录，绝不下发库存行或报价数据
 */
export const searchRouter = router({
  search: quotaProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        brand: z.string().optional(),
        pkg: z.string().optional(),
        category: z.string().optional(),
        sort: z
          .enum([
            "default",
            "priceAsc",
            "priceDesc",
            "stockAsc",
            "stockDesc",
            "lead",
          ])
          .optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        /** 「我关注的供应商」筛选开关（仅登录用户生效） */
        followedOnly: z.boolean().optional(),
        popularSearchAction: z
          .object({
            eventId: z.string().trim().min(8).max(64),
            source: z.enum(["home", "search_page"]),
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { followedOnly, popularSearchAction, ...rest } = input;
      /*
       * 关注筛选的用户 ID 只能取自服务端会话，绡不能由客户端传入；
       * 否则任何人只需伪造 userId 就能窥探他人的关注关系。
       * 未登录时该开关静默失效（前端会先弹登录框，此处仅作服务端
       * 兼容保护，不报错以免阻断普通搜索）。
       */
      // Search reads committed ranking scores; only the isolated timer recomputes them.
      const result = await searchPublishedInventories({
        ...rest,
        followedByUserId: followedOnly && ctx.user ? ctx.user.id : undefined,
      });
      /*
       * 剔除排名内部字段再返回：不能把排序算法权重下发给客户端，
       * 否则商家可拓取结果逆推各因子占比并针对性刷分。
       * 详细理由见 server/rankingPrivacy.ts 模块注释。
       */
      const safeItems = stripRankingInternalsFromList(result.items);
      let supplierQqsMap = new Map<number, string[]>();
      try {
        supplierQqsMap = await getSearchSupplierQqsMap(
          safeItems.map(item => item.supplierId),
          Boolean(ctx.user),
        );
      } catch {
        // QQ 是可选的搜索增强；只记录固定错误码，不能泄露数据库、号码或其他联系人信息。
        console.warn("search_supplier_qq_lookup_failed");
      }
      const agencyBrandMap = await agencyBrandsForSuppliers(safeItems.map(item => item.supplierId));
      const thumbnailMap = materialThumbnailUrls(
        safeItems.map(item => item.partNumber)
      );
      const generatedThumbnailMap = await approvedMaterialGeneratedImageItemMap(
        safeItems.filter(item => !thumbnailMap[item.partNumber])
      );
      const visualOnlyMaterial = await searchApprovedVisualOnly({
        keyword: input.keyword,
        brand: input.brand,
        category: input.category,
        pkg: input.pkg,
        followedOnly: Boolean(followedOnly && ctx.user),
        page: input.page,
        total: result.total,
      });
      if (safeItems.length > 0 && input.keyword) {
        await recordSuccessfulPopularSearch({
          action: popularSearchAction,
          keyword: input.keyword,
          req: ctx.req,
          viewerUserId: ctx.user?.id,
        });
      }
      return {
        ...result,
        visualOnlyMaterial,
        items: safeItems.map(item => {
          const supplierQqs = supplierQqsMap.get(item.supplierId) ?? [];
          return {
            ...item,
            supplierQq: supplierQqs[0] ?? null,
            supplierQqs,
            agencyBrands: agencyBrandMap.get(item.supplierId ?? 0) ?? [],
          // 普通字典封面/供应商图不变；制作图只属于该行核验后的完整身份。
          thumbnailUrl:
            thumbnailMap[item.partNumber] ??
            generatedThumbnailMap.get(item)?.url ??
              null,
          };
        }),
        exposureToken: issueMaterialExposureToken(
          safeItems.map(item => item.partNumber),
          "search_page",
          materialExposureAudience(ctx.req, ctx.user?.id)
        ),
      };
    }),

  /** 批量查询当前用户已关注的供应商 ID（搜索结果星标回显，避免 N+1） */
  followedSupplierIds: protectedProcedure
    .input(
      z.object({
        supplierIds: z.array(z.number().int().positive()).max(200).optional(),
      })
    )
    .query(({ ctx, input }) =>
      getFollowedSupplierIds(ctx.user.id, input.supplierIds)
    ),

  /** 关注/取关供应商（幂等；重复关注不报错） */
  toggleFollowSupplier: protectedProcedure
    .input(
      z.object({ supplierId: z.number().int().positive(), follow: z.boolean() })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.supplierId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能关注自己" });
      }
      if (input.follow) {
        await followSupplier(ctx.user.id, input.supplierId);
      } else {
        await unfollowSupplier(ctx.user.id, input.supplierId);
      }
      return { ok: true as const, following: input.follow };
    }),

  /** 「我的关注」列表：已关注供应商及其在售概况 */
  followedSuppliers: protectedProcedure.query(({ ctx }) =>
    listFollowedSuppliers(ctx.user.id)
  ),

  /**
   * Hover-only private-photo preview. This is deliberately protected but does
   * not consume an exact-search quota: the service rechecks the inventory's
   * present public-search eligibility and returns no photo for stale records.
   */
  spotVerificationPhoto: protectedProcedure
    .input(z.object({
      inventoryId: z.number().int().positive(),
      // Client-only cache partition for account switches; never an authority input.
      scope: z.string().trim().max(128).optional(),
      partNumber: z.string().trim().min(1).max(128).optional(),
    }))
    .query(({ input }) => readSearchSpotVerificationPhoto({ inventoryId: input.inventoryId, partNumber: input.partNumber })),

  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(10) }))
    .query(({ ctx, input }) => getSearchHistory(ctx.user.id, input.limit)),

  recordHistory: protectedProcedure
    .input(z.object({ keyword: z.string().trim().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await recordSearchEvent(ctx.user.id, input.keyword);
      return { ok: true as const };
    }),

  deleteHistory: protectedProcedure
    .input(z.object({ keyword: z.string().trim().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await deleteSearchHistoryEntry(ctx.user.id, input.keyword);
      return { ok: true as const };
    }),

  clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
    await clearSearchHistory(ctx.user.id);
    return { ok: true as const };
  }),

  popular: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(12).default(8) }))
    .query(({ input }) => getPopularSearchTerms(input.limit)),

  brands: dataViewProcedure
    .input(z.object({ keyword: safeAnonymousCatalogText.optional() }))
    .query(async ({ input }) => {
      // Counts and count-derived ordering are inventory-volume side channels.
      const facets = await aggregateBrands(input.keyword);
      return facets
        .map(({ brand }) => ({ brand }))
        .sort((a, b) => a.brand.localeCompare(b.brand));
    }),

  /** 分类聚合（搜索页分类筛选栏） */
  categories: dataViewProcedure
    .input(z.object({ keyword: safeAnonymousCatalogText.optional() }))
    .query(async ({ input }) => {
      // Categories remain public labels, but neither totals nor their rank leak stock distribution.
      const facets = await aggregateCategories(input.keyword);
      return facets
        .map(({ category }) => ({ category }))
        .sort((a, b) => a.category.localeCompare(b.category));
    }),

  /**
   * 已登录商品详情：按库存 id 返回已发布库存详情 + 同品牌/同分类相关推荐
   * 未发布或不存在的库存返回 NOT_FOUND
   */
  detail: quotaProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        // Preserve the original eager item + related contract by default. The
        // first-screen caller may explicitly fetch related results afterward.
        deferRelated: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const item = await getPublishedInventoryById(input.id);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "商品不存在或已下架",
        });
      }

      const itemWithThumbnail = await attachProductCatalogImages([item]);
      if (input.deferRelated) {
        const related: typeof itemWithThumbnail = [];
        return {
          item: itemWithThumbnail[0],
          related,
          // Issued only after quotaProcedure and a successful published-detail
          // lookup; it can be replayed briefly only by this user for this id.
          relatedReadToken: issueRelatedDetailReadToken({
            userId: ctx.user.id,
            inventoryId: item.id,
          }),
          exposureToken: issueMaterialExposureToken(
            [item.partNumber],
            "product_detail",
            materialExposureAudience(ctx.req, ctx.user?.id)
          ),
          // Keep the legacy field even when no related rows have been delivered.
          relatedExposureToken: issueMaterialExposureToken(
            [],
            "related_model",
            materialExposureAudience(ctx.req, ctx.user?.id)
          ),
        };
      }

      const related = await getRelatedInventories({
        excludeId: item.id,
        brand: item.brand,
        category: item.category ?? "",
        limit: 6,
      });
      const relatedWithThumbnails = await attachProductCatalogImages(related);
      return {
        item: itemWithThumbnail[0],
        related: relatedWithThumbnails,
        exposureToken: issueMaterialExposureToken(
          [item.partNumber],
          "product_detail",
          materialExposureAudience(ctx.req, ctx.user?.id)
        ),
        relatedExposureToken: issueMaterialExposureToken(
          relatedWithThumbnails.map(row => row.partNumber),
          "related_model",
          materialExposureAudience(ctx.req, ctx.user?.id)
        ),
      };
    }),

  /**
   * Deferred related rows: protected but deliberately not quotaProcedure. The
   * signed token proves this exact user has just completed the paid detail read.
   */
  relatedDetail: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), token: z.string().min(1).max(2048) }))
    .query(async ({ ctx, input }) => {
      if (!verifyRelatedDetailReadToken({
        token: input.token,
        userId: ctx.user.id,
        inventoryId: input.id,
      })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "相关推荐读取凭证无效或已过期" });
      }

      // Check publication again: issuance does not allow an item delisted during
      // the five-minute token window to disclose its recommendation context.
      const item = await getPublishedInventoryById(input.id);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "商品不存在或已下架",
        });
      }
      const related = await getRelatedInventories({
        excludeId: item.id,
        brand: item.brand,
        category: item.category ?? "",
        limit: 6,
      });
      const relatedWithThumbnails = await attachProductCatalogImages(related);
      return {
        related: relatedWithThumbnails,
        relatedExposureToken: issueMaterialExposureToken(
          relatedWithThumbnails.map(row => row.partNumber),
          "related_model",
          materialExposureAudience(ctx.req, ctx.user?.id)
        ),
      };
    }),

  /**
   * 匿名型号预览：只返回按型号聚合后的公开目录字段。禁止 sort，避免
   * 价格、数量、供应商或内部推荐分数成为排序侧信道。
   */
  preview: dataViewProcedure
    .input(
      z.object({
        keyword: safeAnonymousCatalogText.optional(),
        brand: safeAnonymousCatalogText.max(64).optional(),
        page: z.number().int().min(1).max(50).default(1),
        pageSize: z.number().int().min(1).max(20).default(12),
      })
    )
    .query(({ input }) => listPublicCatalogPreviews(input)),

  /** Anonymous lookup by opaque legacy id; published catalog rows only. */
  previewDetail: dataViewProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const item = await getPublicCatalogPreviewDetail(input.id);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "商品不存在或已下架",
        });
      }
      return item;
    }),

  /**
   * 搜索框匿名联想：至少两个有效字符，且只返回聚合型号/品牌/粗略可用性。
   * dataViewProcedure 为未登录请求提供 IP 限频；精确库存/报价必须使用 search。
   */
  suggest: dataViewProcedure
    .input(
      z.object({
        keyword: safeAnonymousSuggestText,
        limit: z.number().int().min(1).max(12).default(8),
      })
    )
    .query(({ input }) => suggestPublicCatalog(input.keyword, input.limit)),
});
