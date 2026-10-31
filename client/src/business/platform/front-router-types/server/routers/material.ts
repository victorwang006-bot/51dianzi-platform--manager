import { z } from "zod";
import {
  createCrmPermissionProcedure,
  dataViewProcedure,
  quotaProcedure,
  router,
} from "../_core/trpc";
import {
  adminDbAvailable,
  dictFieldSuggestions,
  dictFindAlternatives,
  dictGetSpecs,
  dictGetSpecsBatch,
  dictLookup,
} from "../adminDb";
import { queryAiAlternatives } from "../services/aiAlternativeQuery";
import { recordSuccessfulPopularSearch } from "../services/searchHeat";

const inventoryPublishProcedure = createCrmPermissionProcedure("inventory.publish");

const ADMIN_API_BASE =
  process.env.ADMIN_API_BASE || "http://47.97.108.147/admin";

/** 参数结果内存缓存（10 分钟），减少对后台的重复请求 */
const SPECS_CACHE_TTL = 10 * 60 * 1000;
const specsCache = new Map<string, { at: number; value: unknown }>();
function cacheGet<T>(key: string): T | undefined {
  const hit = specsCache.get(key);
  if (hit && Date.now() - hit.at < SPECS_CACHE_TTL) return hit.value as T;
  if (hit) specsCache.delete(key);
  return undefined;
}
function cacheSet(key: string, value: unknown) {
  if (specsCache.size > 2000) specsCache.clear();
  specsCache.set(key, { at: Date.now(), value });
}

/** 调用后台数据字典 API 的通用 fetch 工具 */
export async function fetchAdminTrpc<T>(
  procedure: string,
  input: Record<string, unknown>
): Promise<T> {
  const encodedInput = encodeURIComponent(
    JSON.stringify({ "0": { json: input } })
  );
  const url = `${ADMIN_API_BASE}/api/trpc/${procedure}?batch=1&input=${encodedInput}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Admin API error: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as Array<{ result: { data: { json: T } } }>;
  return body[0].result.data.json;
}

export const materialRouter = router({
  /**
   * 型号模糊搜索（下拉候选）
   * 代理到后台 material.lookup
   */
  lookup: dataViewProcedure
    .input(
      z.object({
        keyword: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(30).default(10),
      })
    )
    .query(async ({ input }) => {
      type LookupItem = {
        id: number;
        partNumber: string;
        name: string;
        brand: string;
        category: string;
        package: string;
      };
      // 优先直连后台数据库（更快且不受网络出口 TLS 限制）
      if (adminDbAvailable()) {
        try {
          return (await dictLookup(input.keyword, input.limit)) as LookupItem[];
        } catch (err) {
          console.error("[material.lookup] admin db error, fallback to http:", err);
        }
      }
      try {
        return await fetchAdminTrpc<LookupItem[]>("material.lookup", {
          keyword: input.keyword,
          limit: input.limit,
        });
      } catch (err) {
        console.error("[material.lookup] proxy error:", err);
        return [] as LookupItem[];
      }
    }),

  /** 分类/封装数据库联想；数据库不可用时安全降级为空数组。 */
  fieldSuggestions: inventoryPublishProcedure
    .input(
      z.object({
        field: z.enum(["category", "package"]),
        keyword: z.string().max(32).default(""),
        limit: z.number().int().min(1).max(30).default(12),
      }),
    )
    .query(async ({ input }) => {
      if (!adminDbAvailable()) return [];
      try {
        return await dictFieldSuggestions(input.field, input.keyword, input.limit);
      } catch (err) {
        console.error("[material.fieldSuggestions] admin db error:", err);
        return [];
      }
    }),

  /**
   * 获取完整参数（商品详情页 / 发布库存自动填充）
   * 代理到后台 material.getSpecs
   */
  getSpecs: dataViewProcedure
    .input(
      z.object({
        partNumber: z.string().min(1).max(100),
      })
    )
    .query(async ({ input }) => {
      type SpecsResult = {
        partNumber: string;
        name: string;
        brand: string;
        category: string;
        package: string;
        description: string;
        specs: Record<string, string>;
        datasheetUrl?: string;
        lifecycle?: string;
        rohs?: string;
        coverImageUrl?: string;
      } | null;
      const cacheKey = `spec:${input.partNumber.toUpperCase()}`;
      const cached = cacheGet<SpecsResult>(cacheKey);
      if (cached !== undefined) return cached;
      if (adminDbAvailable()) {
        try {
          const result = (await dictGetSpecs(input.partNumber)) as SpecsResult;
          cacheSet(cacheKey, result);
          return result;
        } catch (err) {
          console.error("[material.getSpecs] admin db error, fallback to http:", err);
        }
      }
      try {
        const result = await fetchAdminTrpc<SpecsResult>("material.getSpecs", {
          partNumber: input.partNumber,
        });
        cacheSet(cacheKey, result);
        return result;
      } catch (err) {
        console.error("[material.getSpecs] proxy error:", err);
        return null;
      }
    }),

  /**
   * 批量获取参数（搜索结果页每张卡片展示参数）
   * 后台暂无批量接口，由前台服务端并发代理单条 getSpecs（带并发上限与去重）
   */
  getSpecsBatch: dataViewProcedure
    .input(
      z.object({
        partNumbers: z.array(z.string().min(1).max(100)).min(1).max(20),
      })
    )
    .query(async ({ input }) => {
      type SpecsResult = {
        partNumber: string;
        name: string;
        brand: string;
        category: string;
        package: string;
        description: string;
        specs: Record<string, string>;
        datasheetUrl?: string;
        lifecycle?: string;
        rohs?: string;
        coverImageUrl?: string;
      } | null;

      const unique = Array.from(new Set(input.partNumbers));
      const results: Record<string, SpecsResult> = {};

      // 先取缓存，仅对未命中的型号发起查询
      const missSet: string[] = [];
      for (const pn of unique) {
        const cached = cacheGet<SpecsResult>(`spec:${pn.toUpperCase()}`);
        if (cached !== undefined) results[pn] = cached;
        else missSet.push(pn);
      }
      if (missSet.length === 0) return results;

      // 优先直连后台数据库：单条 SQL 批量取参
      if (adminDbAvailable()) {
        try {
          const fetched = (await dictGetSpecsBatch(missSet)) as Record<string, SpecsResult>;
          for (const [pn, value] of Object.entries(fetched)) {
            results[pn] = value;
            cacheSet(`spec:${pn.toUpperCase()}`, value);
          }
          return results;
        } catch (err) {
          console.error("[material.getSpecsBatch] admin db error, fallback to http:", err);
        }
      }
      // HTTP 降级：并发代理单条 getSpecs
      const misses = missSet;
      const CONCURRENCY = 5;
      for (let i = 0; i < misses.length; i += CONCURRENCY) {
        const chunk = misses.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          chunk.map((pn) =>
            fetchAdminTrpc<SpecsResult>("material.getSpecs", { partNumber: pn })
          )
        );
        settled.forEach((s, idx) => {
          const value = s.status === "fulfilled" ? s.value : null;
          results[chunk[idx]] = value;
          if (s.status === "fulfilled") {
            cacheSet(`spec:${chunk[idx].toUpperCase()}`, value);
          }
        });
      }
      return results;
    }),

  /**
   * AI 型号替代结果：调用独立百炼Agent 1.0应用并原样返回最终文本。
   * 网站保持单次请求，不新增联网搜索、工具动作、二次打分或内容重排。
   */
  alternativeReport: quotaProcedure
    .input(
      z.object({
        partNumber: z.string().min(2).max(100),
        popularSearchAction: z.object({
          eventId: z.string().trim().min(8).max(64),
          source: z.enum(["home", "search_page"]),
        }).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await queryAiAlternatives(input.partNumber);
      if (result?.ok) {
        await recordSuccessfulPopularSearch({
          action: input.popularSearchAction,
          keyword: input.partNumber,
          req: ctx.req,
          viewerUserId: ctx.user?.id,
        });
      }
      return result;
    }),

  /**
   * 替代查询：输入型号，基于字典参数相似度推荐替代型号
   * （同品类候选加权打分：内核/主频/Flash/RAM/封装等关键参数权重更高）
   */
  alternatives: dataViewProcedure
    .input(
      z.object({
        partNumber: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(20).default(8),
      })
    )
    .query(async ({ input }) => {
      const pn = input.partNumber.trim();
      const cacheKey = `alt:${pn.toUpperCase()}:${input.limit}`;
      const cached = cacheGet<Awaited<ReturnType<typeof dictFindAlternatives>>>(cacheKey);
      if (cached !== undefined) return cached;
      if (!adminDbAvailable()) return null;
      try {
        const result = await dictFindAlternatives(pn, input.limit);
        cacheSet(cacheKey, result);
        return result;
      } catch (err) {
        console.error("[material.alternatives] admin db error:", err);
        return null;
      }
    }),
});
