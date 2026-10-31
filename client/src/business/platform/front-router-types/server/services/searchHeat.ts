import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import type { Request } from "express";
import { MINI_PROGRAM_HEADER, isMiniProgramClient } from "../../../shared/miniProgramClient";
import {
  popularSearchActorDaily,
  popularSearchDaily,
  popularSearchNetworkActorDaily,
  popularSearchNetworkDaily,
  searchHeatDaily,
} from "../../drizzle/schema";
import { clientIp } from "../antiScrape";
import { getDb } from "../db";
import { getRateLimitStore } from "../rateLimitStore";
import { rollingDailyTotals, rollingSearchHeatQuery, type RollingSearchHeatRow } from "./rollingSearchHeat";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DISPLAY_CACHE_TTL_MS = 1_000;
const HOT_MODELS_CACHE_TTL_MS = 1_000;
const HOT_MODELS_FAILURE_CACHE_TTL_MS = 1_000;
const HOT_MODEL_MIN_SEARCH_COUNT = 1;
const HOT_MODEL_LIMIT = 12;
const SEARCH_HEAT_INDEX_BASE_MIN = 70;
const SEARCH_HEAT_INDEX_BASE_MAX = 100;
export const SEARCH_HEAT_INDEX_MULTIPLIER = 11;
const POPULAR_SEARCH_SCORE_MILLI = 1_000;
const POPULAR_SEARCH_LIMIT_PER_MINUTE = 20;
const POPULAR_SEARCH_LIMIT_PER_DAY = 500;
const POPULAR_SEARCH_NETWORK_LIMIT_PER_MINUTE = 120;
const POPULAR_SEARCH_NETWORK_LIMIT_PER_DAY = 3_000;
const POPULAR_SEARCH_ACTOR_MODEL_LIMIT_PER_DAY = 20;
const POPULAR_SEARCH_NETWORK_MODEL_LIMIT_PER_DAY = 60;
const RAW_EVENT_RETENTION_DAYS = 8;
const EXPOSURE_TOKEN_TTL_MS = 10 * 60_000;
const EXPOSURE_BATCH_LIMIT_PER_MINUTE = 30;
const EXPOSURE_CANDIDATE_LIMIT_PER_DAY = 3_000;
const EXPOSURE_NETWORK_BATCH_LIMIT_PER_MINUTE = 120;
const EXPOSURE_NETWORK_CANDIDATE_LIMIT_PER_DAY = 12_000;
const SYNTHETIC_ENABLED = process.env.SEARCH_HEAT_SYNTHETIC_ENABLED !== "false";

export const SEARCH_HEAT_SOURCES = [
  "data_hub",
  "search_page",
  "search_suggest",
  "product_detail",
  "related_model",
  "recommendation",
  "demand_center",
  "company_inventory",
  "forum_material",
] as const;
export type SearchHeatSource = typeof SEARCH_HEAT_SOURCES[number];
export type SearchHeatChannel = "web" | "weapp";
export const POPULAR_SEARCH_SOURCES = ["home", "search_page", "data_hub", "demand_center"] as const;
export type PopularSearchSource = typeof POPULAR_SEARCH_SOURCES[number];

export function materialExposureAudience(req: Request, viewerUserId?: number | null) {
  const visitorHeader = String(req.headers["x-51dianzi-visitor"] || "").trim();
  return {
    viewerUserId,
    viewerIp: clientIp(req),
    visitorId: visitorHeader.length >= 8 && visitorHeader.length <= 128 ? visitorHeader : "",
    channel: isMiniProgramClient(req.headers[MINI_PROGRAM_HEADER]) ? "weapp" as const : "web" as const,
  };
}

type ExposureTokenPayload = {
  v: 1;
  exp: number;
  nonce: string;
  audience: string;
  channel: SearchHeatChannel;
  source: SearchHeatSource;
  partNumbers: string[];
};

const trendCache = new Map<string, { at: number; value: SearchHeatTrend }>();
let hotModelsCache: { at: number; ttlMs: number; value: HotSearchModels } | null = null;
let hotModelsInFlight: { generation: number; promise: Promise<HotSearchModels> } | null = null;
let heatCacheGeneration = 0;
let lastRetentionCleanupAt = 0;

function secret() {
  const value = (process.env.SITE_ANALYTICS_SECRET || process.env.JWT_SECRET || "").trim();
  if (!value) throw new Error("SITE_ANALYTICS_SECRET/JWT_SECRET 未配置");
  return value;
}

function hmac(kind: string, value: string) {
  return createHmac("sha256", secret()).update(`${kind}:${value}`).digest("hex");
}

export function validPartNumber(partNumber: string) {
  return partNumber.length >= 3
    && /\d/.test(partNumber)
    && /^[A-Z0-9._/+,-]+$/.test(partNumber);
}

export function normalizeSearchHeatPartNumber(raw: string) {
  return raw.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "").slice(0, 128);
}

function normalizedUniquePartNumbers(rawPartNumbers: string[]) {
  return Array.from(new Set(rawPartNumbers.map(normalizeSearchHeatPartNumber).filter(validPartNumber))).slice(0, 100);
}

type HotModelCandidate = {
  partNumber: string;
  searchCount: number;
  weightedScore: number;
  rollingWeightedScoreMilli?: number;
};

/** 同一主体当天搜索同一型号的边际分逐次下降，超过10次不再增加热度。 */
export function popularSearchUserPointsForOrdinal(ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) return 0;
  if (ordinal === 1) return 11;
  if (ordinal === 2) return 5;
  if (ordinal === 3) return 3;
  if (ordinal <= 10) return 1;
  return 0;
}

/** 同网络前3个匿名主体正常计分，之后只在异常集中时分级降权。 */
export function popularSearchNetworkFactorPermille(distinctActors: number) {
  if (!Number.isSafeInteger(distinctActors) || distinctActors < 1) return 0;
  if (distinctActors <= 3) return 1_000;
  if (distinctActors <= 10) return 500;
  if (distinctActors <= 20) return 200;
  return 0;
}

export function popularSearchWeightedScoreMilli(userOrdinal: number, networkDistinctActors: number) {
  return popularSearchUserPointsForOrdinal(userOrdinal)
    * popularSearchNetworkFactorPermille(networkDistinctActors);
}

export type HotSearchModelItem = {
  partNumber: string;
  heatIndex: number;
};

export type HotSearchModels = {
  models: string[];
  items: HotSearchModelItem[];
  dynamicCount: number;
  source: "dynamic" | "empty" | "unavailable";
  windowDays: 7;
  updatedAt: string;
};

function hotModelFamilyKey(partNumber: string) {
  return partNumber.match(/^([A-Z]{1,8}\d{1,4})/)?.[1] ?? partNumber.slice(0, 8);
}

/** 同一系列最多两款，避免单一厂牌系列占满入口。 */
export function selectHotModelCandidates(rows: HotModelCandidate[], limit = HOT_MODEL_LIMIT) {
  const selected: string[] = [];
  const familyCounts = new Map<string, number>();
  for (const row of rows) {
    const partNumber = normalizeSearchHeatPartNumber(row.partNumber);
    if (!validPartNumber(partNumber) || row.searchCount < HOT_MODEL_MIN_SEARCH_COUNT) continue;
    const family = hotModelFamilyKey(partNumber);
    if ((familyCounts.get(family) ?? 0) >= 2) continue;
    selected.push(partNumber);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function rankHotModelCandidatesByDisplayedHeat(rows: HotModelCandidate[], dateKey: string) {
  return [...rows].sort((left, right) => {
    const leftPart = normalizeSearchHeatPartNumber(left.partNumber);
    const rightPart = normalizeSearchHeatPartNumber(right.partNumber);
    const heatDifference = searchHeatIndexForWeightedScore(rightPart, right.rollingWeightedScoreMilli ?? 0, dateKey)
      - searchHeatIndexForWeightedScore(leftPart, left.rollingWeightedScoreMilli ?? 0, dateKey);
    return heatDifference
      || right.weightedScore - left.weightedScore
      || right.searchCount - left.searchCount
      || leftPart.localeCompare(rightPart);
  });
}

/**
 * 精确累计最近168小时的原始行为权重；保留每日随机基础指数与全部准入规则。
 * 1秒短缓存仅合并瞬时请求，多进程即使没有本地失效也不会保留旧值10分钟。
 */
async function loadHotSearchModels(now: Date): Promise<HotSearchModels> {
  if (hotModelsCache && now.getTime() >= hotModelsCache.at
    && now.getTime() - hotModelsCache.at < hotModelsCache.ttlMs
    && searchHeatDateKey(now) === searchHeatDateKey(new Date(hotModelsCache.at))) {
    return hotModelsCache.value;
  }
  const generation = heatCacheGeneration;
  const updatedAt = now.toISOString();
  const result = (items: HotSearchModelItem[], source: HotSearchModels["source"]): HotSearchModels => ({
    models: items.map(item => item.partNumber),
    items,
    dynamicCount: items.length,
    source,
    windowDays: 7,
    updatedAt,
  });
  const cacheValue = (value: HotSearchModels, ttlMs = HOT_MODELS_CACHE_TTL_MS) => {
    if (generation === heatCacheGeneration) hotModelsCache = { at: now.getTime(), ttlMs, value };
    return value;
  };
  const db = await getDb();
  if (!db) return cacheValue(result([], "unavailable"), HOT_MODELS_FAILURE_CACHE_TTL_MS);

  const today = searchHeatDateKey(now);
  let rows: RollingSearchHeatRow[];
  try {
    const result = await db.execute(rollingSearchHeatQuery(now));
    rows = (result as unknown as [RollingSearchHeatRow[], unknown])[0];
  } catch (error) {
    console.error("[search-heat] hot models query failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return cacheValue(result([], "unavailable"), HOT_MODELS_FAILURE_CACHE_TTL_MS);
  }
  const rankedRows = rankHotModelCandidatesByDisplayedHeat(rows.map(row => ({
    partNumber: row.partNumber,
    searchCount: Number(row.searchCount),
    weightedScore: Number(row.weightedScore),
    rollingWeightedScoreMilli: Number(row.rollingWeightedScoreMilli),
  })), today);
  const dynamic = selectHotModelCandidates(rankedRows);
  const rowsByPart = new Map(rankedRows.map(row => [normalizeSearchHeatPartNumber(row.partNumber), row]));
  const items = dynamic.map(partNumber => {
    const row = rowsByPart.get(partNumber);
    const rollingScoreMilli = Math.max(0, Number(row?.rollingWeightedScoreMilli ?? 0));
    return {
      partNumber,
      heatIndex: searchHeatIndexForWeightedScore(partNumber, rollingScoreMilli, today),
    };
  });
  return cacheValue(result(items, items.length ? "dynamic" : "empty"));
}

/** 同一实例冷缓存只执行一次聚合，其他并发请求复用同一 Promise。 */
export async function getHotSearchModels(now = new Date()): Promise<HotSearchModels> {
  if (hotModelsCache && now.getTime() >= hotModelsCache.at
    && now.getTime() - hotModelsCache.at < hotModelsCache.ttlMs
    && searchHeatDateKey(now) === searchHeatDateKey(new Date(hotModelsCache.at))) {
    return hotModelsCache.value;
  }
  if (hotModelsInFlight?.generation === heatCacheGeneration) return hotModelsInFlight.promise;
  const task = loadHotSearchModels(now);
  hotModelsInFlight = { generation: heatCacheGeneration, promise: task };
  try {
    return await task;
  } finally {
    if (hotModelsInFlight?.promise === task) hotModelsInFlight = null;
  }
}

/**
 * 记录一次用户主动发起的型号搜索。
 *
 * 同一账号或设备的重复搜索保留真实次数，但热度贡献逐次下降；
 * 同一网络只有在异常集中搜索同一型号时才进一步降权，避免误伤企业共用网络。
 * 同一 eventId 的网络重试会被幂等忽略。
 */
export async function recordPopularSearch(input: {
  eventId: string;
  keyword: string;
  source: PopularSearchSource;
  viewerUserId?: number | null;
  viewerIp?: string;
  visitorId?: string;
  channel: SearchHeatChannel;
  userAgent?: string;
}) {
  if (looksLikeBot(input.userAgent ?? "")) return { recorded: false, reason: "bot" } as const;
  const eventId = String(input.eventId).trim();
  const partNumber = normalizeSearchHeatPartNumber(input.keyword);
  if (
    eventId.length < 8
    || eventId.length > 64
    || !validPartNumber(partNumber)
    || !POPULAR_SEARCH_SOURCES.includes(input.source)
  ) return { recorded: false, reason: "invalid" } as const;
  if ((!input.viewerUserId || input.viewerUserId <= 0) && (!input.visitorId || input.visitorId.length < 8)) {
    return { recorded: false, reason: "identity" } as const;
  }

  const now = new Date();
  const actorHash = input.viewerUserId && input.viewerUserId > 0
    ? hmac("popular-search-user", String(input.viewerUserId))
    : hmac("popular-search-visitor", input.visitorId!);
  const networkHash = hmac("popular-search-network", input.viewerIp || "unknown");
  const modelHash = hmac("popular-search-model", partNumber);
  const limiter = getRateLimitStore();
  const [actorMinute, actorDay, networkMinute, networkDay, actorModelDay, networkModelDay] = await Promise.all([
    limiter.increment(`popular-search:minute:${actorHash}`, 60_000, now.getTime()),
    limiter.increment(`popular-search:day:${actorHash}`, DAY_MS, now.getTime()),
    limiter.increment(`popular-search:net-minute:${networkHash}`, 60_000, now.getTime()),
    limiter.increment(`popular-search:net-day:${networkHash}`, DAY_MS, now.getTime()),
    limiter.increment(`popular-search:actor-model-day:${actorHash}:${modelHash}`, DAY_MS, now.getTime()),
    limiter.increment(`popular-search:network-model-day:${networkHash}:${modelHash}`, DAY_MS, now.getTime()),
  ]);
  if (
    actorMinute > POPULAR_SEARCH_LIMIT_PER_MINUTE
    || actorDay > POPULAR_SEARCH_LIMIT_PER_DAY
    || networkMinute > POPULAR_SEARCH_NETWORK_LIMIT_PER_MINUTE
    || networkDay > POPULAR_SEARCH_NETWORK_LIMIT_PER_DAY
    || actorModelDay > POPULAR_SEARCH_ACTOR_MODEL_LIMIT_PER_DAY
    || networkModelDay > POPULAR_SEARCH_NETWORK_MODEL_LIMIT_PER_DAY
  ) return { recorded: false, reason: "rate_limit" } as const;

  const db = await getDb();
  if (!db) return { recorded: false, reason: "database" } as const;
  // eventId 全局幂等：更换客户端访客标识也不能让同一搜索动作重复入账。
  const eventIdHash = hmac("popular-search-event", eventId);
  const searchDate = searchHeatDateKey(now);
  const dayBounds = dateKeyUtcBounds(searchDate);
  const outcome = await db.transaction(async tx => {
    const availability = await tx.execute(sql`
      SELECT 1 AS available
      WHERE EXISTS (
        SELECT 1 FROM inventories i
         WHERE i.partNumberNormalized = ${partNumber}
           AND i.status = 'published'
           AND i.qtyOnSale > 0
      ) OR EXISTS (
        SELECT 1 FROM appearance_archives a
         WHERE a.partNumber = ${partNumber}
      )
      LIMIT 1
    `) as unknown as [[{ available: number }] | [], unknown];
    if (!availability[0].length) return { recorded: false, reason: "not_model" } as const;

    const inserted = await tx.execute(sql`
      INSERT IGNORE INTO popular_search_events
        (eventIdHash, actorHash, networkHash, partNumberNormalized, source, channel, occurredAt)
      VALUES
        (${eventIdHash}, ${actorHash}, ${networkHash}, ${partNumber}, ${input.source}, ${input.channel}, ${now})
    `);
    if (affectedRows(inserted) !== 1) return { recorded: false, reason: "duplicate" } as const;

    await tx.execute(sql`
      INSERT INTO popular_search_actor_daily
        (partNumberNormalized, searchDate, actorHash, searchCount, createdAt, updatedAt)
      SELECT ${partNumber}, ${searchDate}, ${actorHash}, COUNT(*), MIN(occurredAt), MAX(occurredAt)
        FROM popular_search_events
       WHERE partNumberNormalized = ${partNumber}
         AND actorHash = ${actorHash}
         AND occurredAt >= ${dayBounds.start}
         AND occurredAt < ${dayBounds.end}
      ON DUPLICATE KEY UPDATE
        searchCount = searchCount + 1,
        updatedAt = VALUES(updatedAt)
    `);
    const actorRows = await tx.execute(sql`
      SELECT searchCount
        FROM popular_search_actor_daily
       WHERE partNumberNormalized = ${partNumber}
         AND searchDate = ${searchDate}
         AND actorHash = ${actorHash}
       LIMIT 1
       FOR UPDATE
    `) as unknown as [[{ searchCount: number }], unknown];
    const userOrdinal = Number(actorRows[0][0]?.searchCount ?? 0);

    const networkActorInserted = await tx.execute(sql`
      INSERT IGNORE INTO popular_search_network_actor_daily
        (partNumberNormalized, searchDate, networkHash, actorHash, createdAt)
      VALUES
        (${partNumber}, ${searchDate}, ${networkHash}, ${actorHash}, ${now})
    `);
    const networkActorEventRows = await tx.execute(sql`
      SELECT COUNT(*) AS eventCount
        FROM popular_search_events
       WHERE networkHash = ${networkHash}
         AND partNumberNormalized = ${partNumber}
         AND actorHash = ${actorHash}
         AND occurredAt >= ${dayBounds.start}
         AND occurredAt < ${dayBounds.end}
    `) as unknown as [[{ eventCount: number }], unknown];
    const networkActorEventCount = Number(networkActorEventRows[0][0]?.eventCount ?? 0);
    const newNetworkActor = affectedRows(networkActorInserted) === 1 && networkActorEventCount === 1 ? 1 : 0;
    await tx.execute(sql`
      INSERT INTO popular_search_network_daily
        (partNumberNormalized, searchDate, networkHash, distinctActorCount, createdAt, updatedAt)
      SELECT ${partNumber}, ${searchDate}, ${networkHash}, COUNT(DISTINCT actorHash), MIN(occurredAt), MAX(occurredAt)
        FROM popular_search_events
       WHERE networkHash = ${networkHash}
         AND partNumberNormalized = ${partNumber}
         AND occurredAt >= ${dayBounds.start}
         AND occurredAt < ${dayBounds.end}
      ON DUPLICATE KEY UPDATE
        distinctActorCount = distinctActorCount + ${newNetworkActor},
        updatedAt = VALUES(updatedAt)
    `);
    const networkRows = await tx.execute(sql`
      SELECT distinctActorCount AS distinctActors
        FROM popular_search_network_daily
       WHERE networkHash = ${networkHash}
         AND partNumberNormalized = ${partNumber}
         AND searchDate = ${searchDate}
       LIMIT 1
       FOR UPDATE
    `) as unknown as [[{ distinctActors: number }], unknown];
    const networkDistinctActors = Number(networkRows[0][0]?.distinctActors ?? 0);
    const weightedScoreMilli = popularSearchWeightedScoreMilli(userOrdinal, networkDistinctActors);
    const weightedSearchCount = weightedScoreMilli > 0 ? 1 : 0;
    // Persist the exact score, including zero; retries cannot add it twice.
    await tx.execute(sql`
      UPDATE popular_search_events SET weightedScoreMilli = ${weightedScoreMilli}
       WHERE eventIdHash = ${eventIdHash}
    `);

    await tx.execute(sql`
      INSERT INTO popular_search_daily
        (partNumberNormalized, searchDate, searchCount, weightedSearchCount, weightedScoreMilli, scoringVersion, createdAt, updatedAt)
      VALUES
        (${partNumber}, ${searchDate}, 1, ${weightedSearchCount}, ${weightedScoreMilli}, 1, ${now}, ${now})
      ON DUPLICATE KEY UPDATE
        weightedSearchCount = IF(scoringVersion = 1, weightedSearchCount, searchCount) + VALUES(weightedSearchCount),
        weightedScoreMilli = IF(scoringVersion = 1, weightedScoreMilli, searchCount * 11000) + VALUES(weightedScoreMilli),
        scoringVersion = VALUES(scoringVersion),
        searchCount = searchCount + 1,
        updatedAt = VALUES(updatedAt)
    `);
    return { recorded: true, reason: "recorded", weightedScoreMilli } as const;
  });
  if (outcome.recorded) {
    heatCacheGeneration += 1;
    trendCache.delete(partNumber);
    hotModelsCache = null;
  }
  return outcome;
}

export type PopularSearchAction = {
  eventId: string;
  source: PopularSearchSource;
};

/**
 * 只在真实搜索、查价或替代查询已经完成后由业务路由调用。
 * 客户端不能再通过独立公开接口直接提交任意型号计数。
 */
export async function recordSuccessfulPopularSearch(input: {
  action?: PopularSearchAction;
  keyword: string;
  req: Request;
  viewerUserId?: number | null;
}) {
  if (!input.action) return { recorded: false, reason: "no_action" } as const;
  const audience = materialExposureAudience(input.req, input.viewerUserId);
  const userAgentHeader = input.req.headers["user-agent"];
  try {
    return await recordPopularSearch({
      eventId: input.action.eventId,
      keyword: input.keyword,
      source: input.action.source,
      ...audience,
      userAgent: String(Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader || "").slice(0, 512),
    });
  } catch (error) {
    console.error("[popular-search] record failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return { recorded: false, reason: "error" } as const;
  }
}

/**
 * 服务端随业务结果签发短时凭证。客户端只能上报凭证内实际返回过的型号，
 * 避免公开接口被用于任意构造型号热度。
 */
export function issueMaterialExposureToken(
  rawPartNumbers: string[],
  source: SearchHeatSource,
  audience: { viewerUserId?: number | null; viewerIp?: string; visitorId?: string; channel: SearchHeatChannel },
  now = new Date(),
) {
  const partNumbers = normalizedUniquePartNumbers(rawPartNumbers);
  if (!partNumbers.length) return null;
  const payload: ExposureTokenPayload = {
    v: 1,
    exp: now.getTime() + EXPOSURE_TOKEN_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
    audience: exposureAudience(audience.viewerUserId, audience.viewerIp, audience.visitorId),
    channel: audience.channel,
    source,
    partNumbers,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac("material-exposure-token", body)}`;
}

function exposureAudience(viewerUserId?: number | null, viewerIp?: string, visitorId?: string) {
  return viewerUserId && viewerUserId > 0
    ? hmac("search-heat-user-audience", String(viewerUserId))
    : hmac("search-heat-anonymous-audience", `${visitorId || "missing"}:${viewerIp || "unknown"}`);
}

function verifyMaterialExposureToken(
  token: string,
  audience: { viewerUserId?: number | null; viewerIp?: string; visitorId?: string; channel: SearchHeatChannel },
  now = new Date(),
) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = hmac("material-exposure-token", body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ExposureTokenPayload>;
    if (parsed.v !== 1 || typeof parsed.exp !== "number" || parsed.exp <= now.getTime()) return null;
    if (typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    if (parsed.audience !== exposureAudience(audience.viewerUserId, audience.viewerIp, audience.visitorId)) return null;
    if (parsed.channel !== audience.channel) return null;
    if (!SEARCH_HEAT_SOURCES.includes(parsed.source as SearchHeatSource)) return null;
    if (!Array.isArray(parsed.partNumbers) || parsed.partNumbers.length > 100) return null;
    const partNumbers = normalizedUniquePartNumbers(parsed.partNumbers.map(String));
    if (!partNumbers.length || partNumbers.length !== parsed.partNumbers.length) return null;
    return { source: parsed.source as SearchHeatSource, partNumbers };
  } catch {
    return null;
  }
}

/** 北京时间自然日键，不依赖服务器或数据库会话时区。 */
export function searchHeatDateKey(date = new Date()) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function dateKeyOffset(today: Date, offset: number) {
  return searchHeatDateKey(new Date(today.getTime() + offset * DAY_MS));
}

function dateKeyUtcBounds(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 公开热度按“型号 + 北京日期”生成 70～100 的每日稳定基础指数。
 * 同一天刷新不跳数，不同日期自然变化；真实有效采购搜索在此基础上叠加。
 */
export function searchHeatIndexBase(partNumber: string, dateKey = searchHeatDateKey()) {
  const span = SEARCH_HEAT_INDEX_BASE_MAX - SEARCH_HEAT_INDEX_BASE_MIN + 1;
  return SEARCH_HEAT_INDEX_BASE_MIN
    + (stableHash(`${normalizeSearchHeatPartNumber(partNumber)}:${dateKey}:public-index-base`) % span);
}

export function searchHeatIndexForSearches(partNumber: string, realSearchCount: number, dateKey = searchHeatDateKey()) {
  const count = Number.isFinite(realSearchCount) ? Math.max(0, Math.trunc(realSearchCount)) : 0;
  return searchHeatIndexForWeightedScore(
    partNumber,
    count * SEARCH_HEAT_INDEX_MULTIPLIER * POPULAR_SEARCH_SCORE_MILLI,
    dateKey,
  );
}

export function searchHeatIndexForWeightedScore(
  partNumber: string,
  weightedScoreMilli: number,
  dateKey = searchHeatDateKey(),
) {
  const score = Number.isFinite(weightedScoreMilli)
    ? Math.max(0, Math.trunc(weightedScoreMilli))
    : 0;
  return searchHeatIndexBase(partNumber, dateKey)
    + Math.round(score / POPULAR_SEARCH_SCORE_MILLI);
}

/** 每个型号每天稳定在 20～25；同一天刷新、不同 PM2 进程均得到相同结果。 */
export function searchHeatBaselineForDate(partNumber: string, dateKey: string) {
  if (!SYNTHETIC_ENABLED) return 0;
  return 20 + (stableHash(`${normalizeSearchHeatPartNumber(partNumber)}:${dateKey}:baseline`) % 6);
}

function affectedRows(result: unknown) {
  if (!Array.isArray(result)) return 0;
  return Number((result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function looksLikeBot(userAgent: string) {
  return /bot|spider|crawler|slurp|headless|lighthouse|pagespeed|monitoring/i.test(userAgent);
}

function retryableExposureTransactionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT";
}

export async function recordMaterialExposureBatch(input: {
  token: string;
  visitorId: string;
  viewerUserId?: number | null;
  viewerIp?: string;
  channel: SearchHeatChannel;
  events: Array<{ eventId: string; partNumber: string }>;
  userAgent?: string;
}) {
  if (looksLikeBot(input.userAgent ?? "")) return { recorded: 0, duplicate: 0, rejected: input.events.length, reason: "bot" } as const;
  const now = new Date();
  const tokenPayload = verifyMaterialExposureToken(input.token, input, now);
  if (!tokenPayload) return { recorded: 0, duplicate: 0, rejected: input.events.length, reason: "token" } as const;
  const allowed = new Set(tokenPayload.partNumbers);
  const normalizedEvents = input.events.slice(0, 40).map(event => ({
    eventId: String(event.eventId).trim(),
    partNumber: normalizeSearchHeatPartNumber(event.partNumber),
  })).filter(event => event.eventId.length >= 8 && event.eventId.length <= 64 && allowed.has(event.partNumber));
  if (!normalizedEvents.length) {
    return { recorded: 0, duplicate: 0, rejected: input.events.length, reason: "invalid" } as const;
  }

  const subjectHash = input.viewerUserId && input.viewerUserId > 0
    ? hmac("search-heat-user", String(input.viewerUserId))
    : hmac("search-heat-visitor", input.visitorId);
  const networkHash = hmac("search-heat-network", input.viewerIp || "unknown");
  const limiter = getRateLimitStore();
  const [subjectMinute, subjectDay, networkMinute, networkDay] = await Promise.all([
    limiter.increment(`heat:minute:${subjectHash}`, 60_000, now.getTime()),
    limiter.increment(`heat:day:${subjectHash}`, DAY_MS, now.getTime(), normalizedEvents.length),
    limiter.increment(`heat:net-minute:${networkHash}`, 60_000, now.getTime()),
    limiter.increment(`heat:net-day:${networkHash}`, DAY_MS, now.getTime(), normalizedEvents.length),
  ]);
  if (
    subjectMinute > EXPOSURE_BATCH_LIMIT_PER_MINUTE
    || subjectDay > EXPOSURE_CANDIDATE_LIMIT_PER_DAY
    || networkMinute > EXPOSURE_NETWORK_BATCH_LIMIT_PER_MINUTE
    || networkDay > EXPOSURE_NETWORK_CANDIDATE_LIMIT_PER_DAY
  ) {
    return { recorded: 0, duplicate: 0, rejected: input.events.length, reason: "rate_limit" } as const;
  }
  const db = await getDb();
  if (!db) return { recorded: 0, duplicate: 0, rejected: input.events.length, reason: "database" } as const;

  const dateKey = searchHeatDateKey(now);
  const halfHourBucket = Math.floor(now.getTime() / (30 * 60_000));
  let recorded = 0;
  let duplicate = 0;
  let recordedByPart = new Map<string, number>();

  const orderedEvents = normalizedEvents.map(event => ({
    ...event,
    eventIdHash: hmac("search-heat-event", event.eventId),
    dedupeKey: hmac(
        "search-heat-dedupe",
        `${subjectHash}:${event.partNumber}:${input.channel}:${tokenPayload.source}:${halfHourBucket}`,
      ),
  })).sort((left, right) =>
    left.dedupeKey.localeCompare(right.dedupeKey) || left.eventIdHash.localeCompare(right.eventIdHash));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptRecordedByPart = new Map<string, number>();
    let attemptRecorded = 0;
    let attemptDuplicate = 0;
    try {
      await db.transaction(async tx => {
        for (const event of orderedEvents) {
          const inserted = await tx.execute(sql`
            INSERT IGNORE INTO search_heat_events
              (eventIdHash, dedupeKey, partNumberNormalized, source, channel, occurredAt)
            VALUES
              (${event.eventIdHash}, ${event.dedupeKey}, ${event.partNumber}, ${tokenPayload.source}, ${input.channel}, CURRENT_TIMESTAMP)
          `);
          if (affectedRows(inserted) < 1) {
            attemptDuplicate += 1;
            continue;
          }
          attemptRecorded += 1;
          attemptRecordedByPart.set(event.partNumber, (attemptRecordedByPart.get(event.partNumber) ?? 0) + 1);
        }
        if (!attemptRecordedByPart.size) return;

        const orderedParts = Array.from(attemptRecordedByPart.entries()).sort(([left], [right]) => left.localeCompare(right));
        const dailyValues = sql.join(orderedParts.map(([partNumber, count]) => sql`(
          ${partNumber}, ${dateKey}, ${count}, ${searchHeatBaselineForDate(partNumber, dateKey)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`), sql`, `);
        await tx.execute(sql`
          INSERT INTO search_heat_daily
            (partNumberNormalized, heatDate, actualCount, syntheticCount, createdAt, updatedAt)
          VALUES ${dailyValues}
          ON DUPLICATE KEY UPDATE
            actualCount = actualCount + VALUES(actualCount),
            syntheticCount = VALUES(syntheticCount),
            updatedAt = CURRENT_TIMESTAMP
        `);

        const sourceValues = sql.join(orderedParts.map(([partNumber, count]) => sql`(
          ${partNumber}, ${dateKey}, ${input.channel}, ${tokenPayload.source}, ${count},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`), sql`, `);
        await tx.execute(sql`
          INSERT INTO search_heat_daily_sources
            (partNumberNormalized, heatDate, channel, source, actualCount, createdAt, updatedAt)
          VALUES ${sourceValues}
          ON DUPLICATE KEY UPDATE
            actualCount = actualCount + VALUES(actualCount),
            updatedAt = CURRENT_TIMESTAMP
        `);
      });
      recorded = attemptRecorded;
      duplicate = attemptDuplicate;
      recordedByPart = attemptRecordedByPart;
      break;
    } catch (error) {
      if (attempt >= 3 || !retryableExposureTransactionError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 25 + Math.floor(Math.random() * 25)));
    }
  }

  if (recorded) {
    recordedByPart.forEach((_count, partNumber) => trendCache.delete(partNumber));
  }
  return {
    recorded,
    duplicate,
    rejected: input.events.length - normalizedEvents.length,
  } as const;
}

export type SearchHeatTrend = {
  partNumber: string;
  indexBase: number;
  indexMultiplier: number;
  today: { date: string; count: number; realSearchCount: number; finalized: boolean };
  daily: Array<{ date: string; label: string; count: number; realSearchCount: number; finalized: boolean }>;
  updatedAt: string;
};

export async function getSearchHeatTrend(rawPartNumber: string, now = new Date()): Promise<SearchHeatTrend> {
  const partNumber = normalizeSearchHeatPartNumber(rawPartNumber);
  const cached = trendCache.get(partNumber);
  if (cached && now.getTime() >= cached.at && now.getTime() - cached.at < DISPLAY_CACHE_TTL_MS
    && searchHeatDateKey(now) === cached.value.today.date) return cached.value;
  const generation = heatCacheGeneration;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const todayKey = searchHeatDateKey(now);
  const monthStartKey = `${todayKey.slice(0, 8)}01`;
  const weekStartKey = dateKeyOffset(now, -6);
  const rangeStartKey = weekStartKey < monthStartKey ? weekStartKey : monthStartKey;
  const historyStartKey = dateKeyOffset(new Date(`${rangeStartKey}T00:00:00+08:00`), -6);
  const dailyRows = await db
    .select({
      searchDate: popularSearchDaily.searchDate,
      searchCount: popularSearchDaily.searchCount,
      weightedSearchCount: sql<number>`CASE
        WHEN ${popularSearchDaily.scoringVersion} = 1 THEN ${popularSearchDaily.weightedSearchCount}
        ELSE ${popularSearchDaily.searchCount}
      END`,
      weightedScoreMilli: sql<number>`CASE
        WHEN ${popularSearchDaily.scoringVersion} = 1 THEN ${popularSearchDaily.weightedScoreMilli}
        ELSE ${popularSearchDaily.searchCount} * ${SEARCH_HEAT_INDEX_MULTIPLIER * POPULAR_SEARCH_SCORE_MILLI}
      END`,
      updatedAt: popularSearchDaily.updatedAt,
    })
    .from(popularSearchDaily)
    .where(and(
      eq(popularSearchDaily.partNumberNormalized, partNumber),
      gte(popularSearchDaily.searchDate, historyStartKey),
      lte(popularSearchDaily.searchDate, todayKey),
    ))
    .orderBy(asc(popularSearchDaily.searchDate));
  const rollingResult = await db.execute(rollingSearchHeatQuery(now, partNumber));
  const rollingToday = (rollingResult as unknown as [RollingSearchHeatRow[], unknown])[0][0];
  const dayOfMonth = Number(todayKey.slice(8, 10));
  const rangeDays = Math.max(7, dayOfMonth);
  const dateKeys = Array.from({ length: rangeDays }, (_, index) => dateKeyOffset(now, index - (rangeDays - 1)));
  const indexBase = searchHeatIndexBase(partNumber, todayKey);
  const daily = dateKeys.map(date => {
    const historical = rollingDailyTotals(dailyRows, date);
    const [, month, day] = date.split("-").map(Number);
    const realSearchCount = date === todayKey
      ? Math.max(0, Number(rollingToday?.weightedSearchCount ?? 0)) : historical.weightedSearchCount;
    const weightedScoreMilli = date === todayKey
      ? Math.max(0, Number(rollingToday?.rollingWeightedScoreMilli ?? 0)) : historical.weightedScoreMilli;
    return {
      date,
      label: `${month}/${day}`,
      count: searchHeatIndexForWeightedScore(partNumber, weightedScoreMilli, date),
      realSearchCount,
      finalized: date < todayKey,
    };
  });
  const today = daily[daily.length - 1] ?? {
    date: todayKey,
    count: indexBase,
    realSearchCount: 0,
    finalized: false,
  };
  const value: SearchHeatTrend = {
    partNumber,
    indexBase,
    indexMultiplier: SEARCH_HEAT_INDEX_MULTIPLIER,
    today: {
      date: today.date,
      count: today.count,
      realSearchCount: today.realSearchCount,
      finalized: today.finalized,
    },
    daily,
    updatedAt: dailyRows.reduce(
      (latest, row) => row.updatedAt > latest ? row.updatedAt : latest,
      now,
    ).toISOString(),
  };
  if (generation === heatCacheGeneration) trendCache.set(partNumber, { at: now.getTime(), value });
  if (trendCache.size > 500) {
    const oldest = Array.from(trendCache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) trendCache.delete(oldest[0]);
  }
  return value;
}

export async function finalizePreviousSearchHeatDays(now = new Date()) {
  const db = await getDb();
  if (!db) return { finalized: 0, cleaned: 0 };
  const todayKey = searchHeatDateKey(now);
  const finalizedResult = await db
    .update(searchHeatDaily)
    .set({ finalizedAt: new Date(), updatedAt: new Date() })
    .where(and(lt(searchHeatDaily.heatDate, todayKey), isNull(searchHeatDaily.finalizedAt)));

  let cleaned = 0;
  if (Date.now() - lastRetentionCleanupAt > DAY_MS) {
    const cutoff = new Date(Date.now() - RAW_EVENT_RETENTION_DAYS * DAY_MS);
    const cleanupResult = await db.execute(sql`
      DELETE FROM search_heat_events WHERE occurredAt < ${cutoff}
    `);
    const popularSearchCleanupResult = await db.execute(sql`
      DELETE FROM popular_search_events WHERE occurredAt < ${cutoff}
    `);
    const actorDailyCutoff = dateKeyOffset(now, -RAW_EVENT_RETENTION_DAYS);
    const actorDailyCleanupResult = await db
      .delete(popularSearchActorDaily)
      .where(lte(popularSearchActorDaily.searchDate, actorDailyCutoff));
    const networkActorDailyCleanupResult = await db
      .delete(popularSearchNetworkActorDaily)
      .where(lte(popularSearchNetworkActorDaily.searchDate, actorDailyCutoff));
    const networkDailyCleanupResult = await db
      .delete(popularSearchNetworkDaily)
      .where(lte(popularSearchNetworkDaily.searchDate, actorDailyCutoff));
    cleaned = affectedRows(cleanupResult)
      + affectedRows(popularSearchCleanupResult)
      + affectedRows(actorDailyCleanupResult)
      + affectedRows(networkActorDailyCleanupResult)
      + affectedRows(networkDailyCleanupResult);
    lastRetentionCleanupAt = Date.now();
  }
  return { finalized: affectedRows(finalizedResult), cleaned };
}
