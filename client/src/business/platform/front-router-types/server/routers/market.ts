import {
  MARKET_PACKAGING_RULE_VERSION,
  resolveMarketPackagingGroup,
  marketPackagingLookupKeys,
  marketPackagingReferenceKeys,
  isMarketPackagingBrandCompatible,
  isMarketPackagingPackageCompatible,
  normalizeMarketPartNumber,
} from "../../../shared/marketPackaging";
import type { UnifiedReferencePrice } from "../services/unifiedReferencePrice";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  dataViewProcedure,
  protectedProcedure,
  publicProcedure,
  quotaProcedure,
  router,
} from "../_core/trpc";
import {
  adminDbAvailable,
  dictAppearanceList,
  dictReferencePrice,
} from "../adminDb";
import { queryAiMarketPrice } from "../services/aiPriceQuery";
import { getDb, listPublishedInventoryPriceCandidates } from "../db";
import { buildUnifiedReferencePrice } from "../services/unifiedReferencePrice";
import {
  getAppearanceArchives,
  getPublishedMarketReports,
} from "../services/dataTongContent";
import {
  getMarketDetail,
  searchMarketModels,
} from "../services/marketRecommendation";
import {
  getHotSearchModels,
  getSearchHeatTrend,
  normalizeSearchHeatPartNumber,
  validPartNumber,
  issueMaterialExposureToken,
  materialExposureAudience,
  recordMaterialExposureBatch,
  recordSuccessfulPopularSearch,
} from "../services/searchHeat";
import { ShortQueryCache } from "../services/shortQueryCache";
import { mergeApprovedMaterialGeneratedImages } from "../services/materialGeneratedImages";

const APPEARANCE_CACHE_TTL = 10 * 60 * 1000;
type DictionaryAppearance = Awaited<ReturnType<typeof dictAppearanceList>>;
type AppearanceWithGenerated = Omit<DictionaryAppearance, "items"> & {
  items: Array<
    DictionaryAppearance["items"][number] & {
      coverImageSource: "dictionary" | "generated" | "none";
    }
  >;
};
const appearanceCache = new Map<
  string,
  { at: number; data: AppearanceWithGenerated }
>();
const dataHubSearchActionInput = z.object({
  eventId: z.string().trim().min(8).max(64),
  source: z.enum(["home", "data_hub"]),
});

// Ten-second authenticated reference-price cache + in-flight coalescing. Exposure tokens remain per request.
const referencePriceCache = new ShortQueryCache<PackagingReferencePrice>(
  10_000
);
// Heat widgets poll every five seconds. Their price-presence gate need not re-read prices on every poll.
const searchHeatReferenceCache = new ShortQueryCache<
  ReturnType<typeof buildUnifiedReferencePrice>
>(60_000);
type PackagingReferencePrice = UnifiedReferencePrice & {
  packagingGroup: ReturnType<typeof resolveMarketPackagingGroup>;
  packagingPrices: Array<{
    partNumber: string;
    packaging: string;
    referencePrice: UnifiedReferencePrice;
  }>;
};
/** Shared read helper; original market.referencePrice still owns its login quota contract. */
export async function resolveUnifiedReferencePrice(
  partNumber: string
): Promise<PackagingReferencePrice> {
  const queriedPartNumber = normalizeMarketPartNumber(partNumber);
  const referencePartNumber = resolveMarketPackagingGroup(queriedPartNumber)?.basePartNumber ?? queriedPartNumber;
  const result = await referencePriceCache.get(
    `${MARKET_PACKAGING_RULE_VERSION}:${referencePartNumber}`,
    async () => {
      let cacheable = true;
      const packagingGroup = resolveMarketPackagingGroup(referencePartNumber);
      const keys = marketPackagingReferenceKeys(referencePartNumber);
      const [inventoryCandidates, databasePrices] = await Promise.all([
        listPublishedInventoryPriceCandidates(referencePartNumber).catch(err => {
          cacheable = false;
          console.error("[market.referencePrice] inventory db error:", err);
          return [];
        }),
        Promise.all(
          keys.map(key =>
            adminDbAvailable()
              ? dictReferencePrice(key, {
                  packagingFallback: !packagingGroup,
                }).catch(err => {
                  cacheable = false;
                  console.error("[market.referencePrice] admin db error:", err);
                  return null;
                })
              : Promise.resolve(null)
          )
        ),
      ]);
      const packagingPrices = keys.map((key, index) => {
        const raw = databasePrices[index];
        const databasePrice =
          raw &&
          (!packagingGroup ||
            (normalizeMarketPartNumber(raw.partNumber) === key &&
              isMarketPackagingBrandCompatible(key, raw.brand) &&
              isMarketPackagingPackageCompatible(key, raw.package)))
            ? raw
            : null;
        return {
          partNumber: key,
          packaging:
            packagingGroup?.variants.find(v => v.partNumber === key)
              ?.packaging ?? "包装待确认",
          referencePrice: buildUnifiedReferencePrice({
            queriedPartNumber: key,
            inventoryCandidates: inventoryCandidates.filter(
              row => normalizeMarketPartNumber(row.partNumber) === key
            ),
            databasePrice,
          }),
        };
      });
      const exact = packagingPrices[0].referencePrice;
      const chosen = exact.ok
        ? exact
        : (packagingPrices.find(row => row.referencePrice.ok)?.referencePrice ??
          exact);
      return {
        value: {
          ...chosen,
          queriedPartNumber: referencePartNumber,
          packagingGroup,
          // These are shared material-market references, not rewritten supplier offers.
          packagingPrices: packagingGroup ? packagingPrices.map(row => ({ ...row, referencePrice: chosen })) : [],
        },
        cacheable,
      };
    }
  );
  // Keep the input identity and existing exact-first display order outside the shared cache.
  const keys = marketPackagingLookupKeys(queriedPartNumber);
  return {
    ...result,
    queriedPartNumber,
    packagingPrices: keys.flatMap(key => result.packagingPrices.filter(row => row.partNumber === key)),
  };
}

async function resolveSearchHeatReferencePrice(partNumber: string) {
  const queriedPartNumber = partNumber.normalize("NFKC").trim().toUpperCase();
  return searchHeatReferenceCache.get(queriedPartNumber, async () => ({
    value: await resolveUnifiedReferencePrice(queriedPartNumber),
  }));
}

function publicMarketReport(
  report: Awaited<ReturnType<typeof getPublishedMarketReports>>[number]
) {
  return {
    id: report.id,
    slug: report.slug,
    category: report.category,
    title: report.title,
    summary: report.summary,
    coverTone: report.coverTone,
    coverImageUrl: report.coverImageUrl,
    publishedAt: report.publishedAt,
    // Published editorial prose remains crawlable, but numeric ranking/fact tables do not.
    sections: report.sections.map(section => ({
      heading: section.heading,
      paragraphs: section.paragraphs,
    })),
    sources: report.sources.map(source => ({
      name: source.name,
      url: source.url,
    })),
  };
}

/*
 * 报告和规格档案继续用 dataViewProcedure，保留公开 SEO 入口及匿名限频。
 *
 * 精确行情、报价、AI 价格使用 quotaProcedure（登录 + 每日配额），并在
 * handler 前拒绝匿名调用。热度与热榜只是登录态浏览所需的高频轮询，使用
 * protectedProcedure，避免五秒刷新消耗精确报价配额。
 *
 * 公开报告响应严格白名单，游客不会得到排名数值、编辑状态或内部时间字段。
 */
export const marketRouter = router({
  trackSearchHeat: publicProcedure
    .input(
      z.object({
        eventId: z.string().trim().min(8).max(64),
        visitorId: z.string().trim().min(8).max(128),
        partNumber: z.string().trim().min(2).max(128),
        source: z.enum(["data_hub", "search_page"]),
      })
    )
    .mutation(() => ({
      recorded: false,
      reason: "deprecated" as const,
      trend: null,
    })),
  trackMaterialExposures: publicProcedure
    .input(
      z.object({
        token: z.string().min(40).max(25_000),
        visitorId: z.string().trim().min(8).max(128),
        events: z
          .array(
            z.object({
              eventId: z.string().trim().min(8).max(64),
              partNumber: z.string().trim().min(2).max(128),
            })
          )
          .min(1)
          .max(40),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const audience = materialExposureAudience(ctx.req, ctx.user?.id);
      if (
        !ctx.user?.id &&
        (!audience.visitorId || audience.visitorId !== input.visitorId)
      ) {
        return {
          recorded: 0,
          duplicate: 0,
          rejected: input.events.length,
          reason: "visitor" as const,
        };
      }
      return await recordMaterialExposureBatch({
        ...input,
        ...audience,
        userAgent: String(ctx.req.headers["user-agent"] || "").slice(0, 512),
      });
    }),
  searchHeat: protectedProcedure
    .input(z.object({ partNumber: z.string().trim().min(2).max(128) }))
    .query(async ({ input }) => {
      const result = await resolveSearchHeatReferencePrice(input.partNumber);
      if (result.ok && resolveMarketPackagingGroup(input.partNumber))
        return getSearchHeatTrend(normalizeMarketPartNumber(input.partNumber));
      if (result.ok) return getSearchHeatTrend(result.partNumber);
      // 当前无可靠价格时，仍保留真实已入账的历史采购搜索；不创建新热度。
      const partNumber = normalizeSearchHeatPartNumber(input.partNumber);
      if (!validPartNumber(partNumber)) return null;
      const db = await getDb();
      if (!db) return null;
      const resultRows = await db.execute(sql`
        SELECT 1 AS found FROM popular_search_daily
         WHERE partNumberNormalized = ${partNumber}
           AND searchCount > 0
         LIMIT 1
      `);
      const rows = (
        resultRows as unknown as [Array<{ found: number }>, unknown]
      )[0];
      return Array.isArray(rows) && rows.length > 0
        ? getSearchHeatTrend(partNumber)
        : null;
    }),
  hotSearchModels: protectedProcedure.query(() => getHotSearchModels()),
  search: quotaProcedure
    .input(
      z.object({
        keyword: z
          .string()
          .trim()
          .min(2)
          .max(128)
          .refine(value => !/[\\%_]/.test(value), "请输入具体型号或品牌"),
        page: z.number().int().min(1).max(20).optional(),
        pageSize: z.number().int().min(1).max(20).optional(),
      })
    )
    .query(({ input }) => searchMarketModels(input.keyword, input)),
  detail: quotaProcedure
    .input(z.object({ partNumber: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const result = await getMarketDetail(input.partNumber);
      const hasDisplayableMarketData =
        result.supplierQuotes.length > 0 ||
        result.historyByPackaging.some(row => row.history.length > 0);
      return {
        ...result,
        exposureToken: hasDisplayableMarketData
          ? issueMaterialExposureToken(
              [input.partNumber],
              "data_hub",
              materialExposureAudience(ctx.req, ctx.user?.id)
            )
          : null,
      };
    }),
  /**
   * AI 市场参考价：千问联网搜索归纳型号价格区间。
   * 带 24h 缓存与每日调用上限，失败返回 ok:false 不抛错。
   */
  aiPrice: quotaProcedure
    .input(z.object({ partNumber: z.string().min(1).max(128) }))
    .query(({ input }) => queryAiMarketPrice(input.partNumber)),
  /**
   * 网站与小程序共用的统一市场参考价。
   *
   * 同时查询完整型号精确匹配的有效上架价格，以及后台最新 active 价格批次：
   * - 用户最低有效上架价低于数据库区间下限时，以用户价为下限生成 3%～5% 区间；
   * - 否则保留数据库现有 0.90～0.95 区间；
   * - 只有一类数据时使用该类数据；两类都没有时明确返回 no_reliable_data。
   * 所有对外金额统一保留两位小数，AI 联网结果不参与本接口数字价格。
   */
  referencePrice: quotaProcedure
    .input(
      z.object({
        partNumber: z.string().min(1).max(128),
        popularSearchAction: dataHubSearchActionInput.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const queried = input.partNumber.normalize("NFKC").trim().toUpperCase();
      const result = await resolveUnifiedReferencePrice(queried);
      if (result.ok) {
        await recordSuccessfulPopularSearch({
          action: input.popularSearchAction,
          keyword: queried,
          req: ctx.req,
          viewerUserId: ctx.user?.id,
        });
      }
      return {
        ...result,
        exposureToken: result.ok
          ? issueMaterialExposureToken(
              [queried],
              "data_hub",
              materialExposureAudience(ctx.req, ctx.user?.id)
            )
          : null,
      };
    }),
  reports: dataViewProcedure.query(async ({ ctx }) => {
    const reports = await getPublishedMarketReports();
    return ctx.user ? reports : reports.map(publicMarketReport);
  }),
  appearanceArchives: dataViewProcedure
    .input(z.object({ keyword: z.string().max(128).optional() }).optional())
    .query(({ input }) => getAppearanceArchives(input?.keyword)),
  /**
   * 外观档案（字典版）：直连后台 RDS 字典，返回丝印外观图(OSS)、
   * 完整中文参数与原厂规格书链接。带 10 分钟内存缓存。
   */
  appearanceDict: dataViewProcedure
    .input(
      z
        .object({
          keyword: z.string().max(128).optional(),
          page: z.number().int().min(1).max(200).optional(),
          pageSize: z.number().int().min(1).max(50).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const keyword = input?.keyword?.trim() || undefined;
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 10;
      const cacheKey = `${keyword ?? ""}|${page}|${pageSize}`;
      const cached = appearanceCache.get(cacheKey);
      if (cached && Date.now() - cached.at < APPEARANCE_CACHE_TTL)
        return cached.data;
      if (!adminDbAvailable())
        return { items: [], total: 0 } as AppearanceWithGenerated;
      try {
        const dictionaryData = await dictAppearanceList(
          keyword,
          pageSize,
          (page - 1) * pageSize
        );
        const data: AppearanceWithGenerated = {
          ...dictionaryData,
          items: await mergeApprovedMaterialGeneratedImages(
            dictionaryData.items,
            item => ({ partNumber: item.partNumber, displayPartNumber: item.displayPartNumber, brand: item.brand, dictionaryMaterialId: item.id }),
          ),
        };
        appearanceCache.set(cacheKey, { at: Date.now(), data });
        if (appearanceCache.size > 200) {
          const oldest = Array.from(appearanceCache.entries()).sort(
            (a, b) => a[1].at - b[1].at
          )[0];
          if (oldest) appearanceCache.delete(oldest[0]);
        }
        return data;
      } catch (err) {
        console.error("[market.appearanceDict] admin db error:", err);
        // 有陈旧缓存时返回陈旧数据，避免用户看到"共收录0个"
        if (cached) return cached.data;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "参数档案数据源暂时不可用，请点击重新加载",
        });
      }
    }),
});
