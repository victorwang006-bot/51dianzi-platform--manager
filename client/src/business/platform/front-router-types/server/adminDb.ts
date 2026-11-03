/**
 * 后台管理站（51电子网后台）物料数据字典直连层
 * 通过 ADMIN_DB_URL 直连后台数据库的 materials 表（只读）。
 * 依据后台《前台直连RDS读取物料数据——对接说明》（2026-07-25）：
 * - 只读查询，禁止任何写操作；所有查询必须带 status='enabled'
 * - 优先 TLS 连接；生产阿里云 RDS 实例 SSL 为 DISABLED（have_ssl=DISABLED）时，
 *   自动回退为 VPC 内网明文连接（ECS↔RDS 同 VPC 内网，不经公网）
 */
import mysql from "mysql2/promise";
import { parseReferencePrice } from "../../shared/referencePriceRange";
import {
  containsCompetitorDisplayName,
  sanitizeCompetitorDisplayText,
} from "../../shared/competitorDisplayPolicy";
import { packagingAppearanceLookupKeys } from "../../shared/partNumber";
import {
  isMarketPackagingBrandCompatible,
  MARKET_PACKAGING_RULE_VERSION,
  normalizeMarketPartNumber,
  resolveMarketPackagingGroup,
} from "../../shared/marketPackaging";

const MATERIAL_PUBLIC_SAFE_SQL = `
  LOWER(COALESCE(name, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(brand, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(category, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(description, '')) NOT LIKE '%立创%'
  AND LOWER(CONCAT_WS(' ', name, brand, category, description)) NOT REGEXP 'szlcsc|lcsc|jlcpcb|jlcsmt|jlc3dp|jlcmc|jlceda'
`;

const MATERIAL_ALIAS_PUBLIC_SAFE_SQL = `
  LOWER(COALESCE(m.name, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(m.brand, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(m.category, '')) NOT LIKE '%立创%'
  AND LOWER(COALESCE(m.description, '')) NOT LIKE '%立创%'
  AND LOWER(CONCAT_WS(' ', m.name, m.brand, m.category, m.description)) NOT REGEXP 'szlcsc|lcsc|jlcpcb|jlcsmt|jlc3dp|jlcmc|jlceda'
`;

export type DictLookupItem = {
  id: number;
  partNumber: string;
  name: string;
  brand: string;
  category: string;
  package: string;
};

export type DictSpecsResult = {
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
  /** 后台字典的物料封面图（完整可访问 URL） */
  coverImageUrl?: string;
} | null;

let pool: mysql.Pool | null = null;
let poolFailed = false;
/** 当前池是否为 TLS 连接（用于 SSL 不支持时降级重建） */
let poolUsesSsl = true;
/** 已确认服务端不支持 SSL（如阿里云 RDS 未开 SSL），后续直接用明文池 */
let sslUnsupported = false;

/**
 * Production connections always begin with certificate verification enabled.
 * The only opt-out is the dedicated local test harness: its loopback MySQL
 * deliberately uses a self-signed certificate and the isolated test env sets
 * both NODE_ENV=test and ADMIN_DB_SSL=false. A production value of false is
 * intentionally ignored rather than weakening RDS certificate validation.
 */
export function shouldUseAdminDbTls(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !(env.NODE_ENV === "test" && env.ADMIN_DB_SSL === "false");
}

function createPool(useSsl: boolean): mysql.Pool | null {
  const url = process.env.ADMIN_DB_URL;
  if (!url) return null;
  try {
    const u = new URL(url.split("?")[0]);
    return mysql.createPool({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
      connectionLimit: process.env.DIANZI51_RECOMMENDATION_WORKER === "1" ? 1 : 5,
      connectTimeout: 10000,
      ...(useSsl ? { ssl: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } } : {}),
    });
  } catch (err) {
    console.error("[adminDb] failed to create pool:", err);
    poolFailed = true;
    return null;
  }
}

function getAdminPool(): mysql.Pool | null {
  if (poolFailed) return null;
  if (pool) return pool;
  poolUsesSsl = !sslUnsupported && shouldUseAdminDbTls();
  pool = createPool(poolUsesSsl);
  return pool;
}

/** 仅供一次性维护命令在完成后释放连接池；常驻 HTTP 进程无需调用。 */
export async function closeAdminDb(): Promise<void> {
  const current = pool;
  pool = null;
  sslDowngradePromise = null;
  if (!current) return;
  await current.end();
}

/** 服务端不支持 SSL（阿里云 RDS have_ssl=DISABLED）时的报错特征 */
export function isSslUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /secure connection|SSL is required|HANDSHAKE_NO_SSL_SUPPORT/i.test(msg);
}

/** 池已被并发降级流程关闭时的报错特征 */
function isPoolClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /pool is closed/i.test(msg);
}

/** SSL 降级单飞锁：并发请求只允许一个执行池重建，其余等待 */
let sslDowngradePromise: Promise<void> | null = null;

async function downgradeToPlainPool(oldPool: mysql.Pool): Promise<void> {
  if (!sslDowngradePromise) {
    sslDowngradePromise = (async () => {
      console.warn("[adminDb] server does not support SSL, falling back to plain VPC connection");
      sslUnsupported = true;
      if (pool === oldPool) pool = null;
      try {
        await oldPool.end();
      } catch {
        /* ignore */
      }
    })();
  }
  await sslDowngradePromise;
}

/**
 * 执行只读查询：优先 TLS，遇到服务端不支持 SSL 时降级重建明文池并重试一次。
 * 降级只发生一次（并发请求经单飞锁等待同一次重建），此后进程内直接使用明文内网连接。
 * 若请求恰好持有已被关闭的旧池（Pool is closed），换新池重试一次。
 */
async function adminQuery<T>(sql: string, params: unknown[]): Promise<T> {
  const p = getAdminPool();
  if (!p) throw new Error("ADMIN_DB_URL not configured");
  const worker = process.env.DIANZI51_RECOMMENDATION_WORKER === "1";
  const query = worker
    ? { sql: sql.replace(/^\s*SELECT\s+/i, "SELECT /*+ MAX_EXECUTION_TIME(8000) */ "), timeout: 9000 }
    : { sql };
  try {
    const [rows] = await p.query(query, params);
    return rows as T;
  } catch (err) {
    if (poolUsesSsl && isSslUnsupportedError(err)) {
      await downgradeToPlainPool(p);
      const plain = getAdminPool();
      if (!plain) throw err;
      const [rows] = await plain.query(query, params);
      return rows as T;
    }
    if (isPoolClosedError(err)) {
      // 旧池被并发降级流程关闭：等降级完成后用新池重试一次
      if (sslDowngradePromise) await sslDowngradePromise;
      // 若拿到的仍是同一个已关闭池（降级流程尚未清空引用），强制重建
      let fresh = getAdminPool();
      if (fresh === p) {
        pool = null;
        fresh = getAdminPool();
      }
      if (!fresh) throw err;
      const [rows] = await fresh.query(query, params);
      return rows as T;
    }
    throw err;
  }
}

/**
 * 池预热：进程启动时主动完成一次连接（含 SSL 探测降级），
 * 消除 pm2 reload 后首批并发请求触发 "Pool is closed" 竞态窗口。
 * 失败静默（不影响启动），实际请求仍有降级与重试兜底。
 */
export function warmupAdminDb(): void {
  if (!process.env.ADMIN_DB_URL) return;
  adminQuery<Array<{ ok: number }>>("SELECT 1 AS ok", [])
    .then(async () => {
      console.log("[adminDb] pool warmed up");
      await warmupMaterialThumbnailIndex();
    })
    .catch(err => console.warn("[adminDb] warmup failed (will retry on demand):", err?.message ?? err));
}

/** 是否已配置后台库直连 */
export function adminDbAvailable(): boolean {
  return Boolean(process.env.ADMIN_DB_URL) && !poolFailed;
}

type MaterialRow = {
  id: number;
  partNumber: string;
  name: string;
  brand: string | null;
  category: string | null;
  package: string | null;
  description: string | null;
  specs: Record<string, string> | string | null;
  datasheetUrl: string | null;
  lifecycle: string | null;
  rohs: string | null;
  coverImageUrl?: string | null;
  images?: string | Array<{ key?: string; url?: string; name?: string }> | null;
  updatedAt?: Date | string | null;
};

function parseSpecs(raw: MaterialRow["specs"]): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return raw;
}

/** 物料行 → 对外输出项。 */
function toDictLookupItem(r: MaterialRow): DictLookupItem {
  return {
    id: r.id,
    partNumber: r.partNumber,
    name: sanitizeCompetitorDisplayText(r.name),
    brand: sanitizeCompetitorDisplayText(r.brand),
    category: sanitizeCompetitorDisplayText(r.category),
    package: r.package ?? "",
  };
}

const DICT_LOOKUP_COLUMNS = "id, partNumber, name, brand, category, `package`";

/**
 * 历史料号编码→物料的精确反查。
 *
 * material_code_aliases 存着每条物料的历史编码（1.1 万条 MAT 老编码 +
 * 59.9 万条 EXT-4-N 外部导入编码）。用户手上的采购单/BOM 常写旧编码，
 * 若只查 partNumber 会出现「明明库里有却搜不到」。
 *
 * 刻意用等号精确匹配而非 LIKE，两个原因：
 * 1. 性能：aliasCode 有唯一索引，等号是索引命中（亚毫秒）；
 *    而把别名写成 EXISTS 子查询挂在主查询上，需对 61 万行逐行探测，
 *    实测使联想接口从 ~600ms 退化到 ~1700ms，而这是用户每敲一个字符
 *    都触发的高频路径，不能接受。
 * 2. 语义：旧编码是用户从单据上抄下的完整串，不存在“只记得一半”的场景；
 *    而 EXT-4-2 作为前缀会命中 EXT-4-2xxxxx 一大片无关物料，反而淹没目标。
 */
async function lookupByAliasCode(code: string): Promise<MaterialRow[]> {
  if (!code) return [];
  return adminQuery<MaterialRow[]>(
    `SELECT ${DICT_LOOKUP_COLUMNS.split(", ").map(c => `m.${c}`).join(", ")}
     FROM material_code_aliases a
     JOIN materials m ON m.id = a.materialId
     WHERE a.aliasCode = ? AND m.status = 'enabled' AND ${MATERIAL_ALIAS_PUBLIC_SAFE_SQL}
     LIMIT 5`,
    [code],
  );
}

/**
 * 联想结果缓存（5 分钟）。
 *
 * 用户逐字输入型号时会对同一前缀反复触发查询（敲 STM32F103 产生 9 次请求，
 * 且删字重敲会再次命中相同前缀），缓存可让重复关键词直接返回，不打数据库。
 * 物料主数据变更频率低（按天计），5 分钟内的轻微滞后可接受。
 */
const LOOKUP_CACHE_TTL = 5 * 60 * 1000;
const LOOKUP_CACHE_MAX = 3000;
const lookupCache = new Map<string, { at: number; rows: DictLookupItem[] }>();

function lookupCacheGet(key: string): DictLookupItem[] | undefined {
  const hit = lookupCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= LOOKUP_CACHE_TTL) {
    lookupCache.delete(key);
    return undefined;
  }
  return hit.rows;
}

function lookupCacheSet(key: string, rows: DictLookupItem[]): void {
  if (lookupCache.size >= LOOKUP_CACHE_MAX) lookupCache.clear();
  lookupCache.set(key, { at: Date.now(), rows });
}

/** 供测试重置缓存，避免用例之间互相污染。 */
export function __clearDictLookupCache(): void {
  lookupCache.clear();
}

/**
 * 型号模糊搜索（前缀优先，仅启用状态物料）。
 *
 * -- 性能设计（2026-08-16 重构，实测基线 653ms -> 前缀支 5ms）--
 *
 * 原写法把前缀与中缀塞进一条 SQL 的 OR 里，并用表达式排序保证前缀优先：
 *   WHERE partNumber LIKE 'kw%' OR partNumber LIKE '%kw%'
 *   ORDER BY (partNumber LIKE 'kw%') DESC, partNumber ASC
 * EXPLAIN 实测暴露两个问题：
 *   1. OR 中含前导 % 的条件，优化器放弃 partNumber 索引（区分度 584944），
 *      改用毫无区分度的 status 索引（enabled 占 610476/610721），预估扫 302547 行；
 *   2. ORDER BY 首项是表达式而非字段，无法用索引排序，产生 Using filesort,
 *      需把命中行全部载入内存再排。这是约 650ms 的主要来源。
 *
 * 前缀支和中缀支以独立 SQL 并行发起：前缀支继续使用索引并在合并时排在前面；
 * 中缀支仅对 4 位以上输入发起，并排除前缀已覆盖的范围，避免结果重复。并行可避免
 * “无前缀命中时先等待前缀再等待中缀”的串行尾延迟，同时仍保留 `103C8` 等中段召回。
 * 历史别名反查始终只在两支型号查询均为空后进行，不能把 61 万条别名表并入主查询。
 */
export async function dictLookup(keyword: string, limit: number): Promise<DictLookupItem[]> {
  const kw = keyword.trim();
  if (!kw) return [];

  const cacheKey = `${kw.toUpperCase()}|${limit}`;
  const cached = lookupCacheGet(cacheKey);
  if (cached) return cached;

  // 正常录入型号从开头输入，直接走 partNumber 索引。
  const prefixQuery = adminQuery<MaterialRow[]>(
    `SELECT ${DICT_LOOKUP_COLUMNS}
       FROM materials
      WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL} AND partNumber LIKE ?
      ORDER BY partNumber ASC
      LIMIT ?`,
    [`${kw}%`, limit],
  );

  // 中缀支保留部分型号召回，并排除前缀，保证合并时前缀永远优先。
  const infixQuery = kw.length >= 4
    ? adminQuery<MaterialRow[]>(
      `SELECT ${DICT_LOOKUP_COLUMNS}
         FROM materials
        WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
          AND partNumber LIKE ? AND partNumber NOT LIKE ?
        ORDER BY partNumber ASC
        LIMIT ?`,
      [`%${kw}%`, `${kw}%`, limit],
    ).catch(() => [] as MaterialRow[])
    : Promise.resolve([] as MaterialRow[]);
  const [prefixRows, infixRows] = await Promise.all([prefixQuery, infixQuery]);
  const seen = new Set<string>();
  const merged = [...prefixRows, ...infixRows].filter(row => {
    const key = String(row.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
  if (merged.length > 0) {
    const items = merged.map(toDictLookupItem);
    lookupCacheSet(cacheKey, items);
    return items;
  }

  // 型号无命中：关键词可能是旧料号编码（MAT20260001 / EXT-4-224923 / 51E-00010984）
  const aliasItems = (await lookupByAliasCode(kw)).map(toDictLookupItem);
  if (aliasItems.length > 0) lookupCacheSet(cacheKey, aliasItems);
  return aliasItems;
}

/**
 * 取物料库品类词表（按物料数降序）。
 *
 * 为何以物料库为唯一标准：平台原本并存三套品类词表（需求侧「MCU/处理器」/
 * 库存侧「微控制器」/物料库「单片机(MCU/MPU/SOC)」），互不相容，
 * 导致供需按品类永远匹配不到。物料库（61 万条）既是数据量最大的一套，
 * 也是发布时自动填充的数据源，以它为准可使填充值天然落在候选内。
 *
 * 不做 top N 截断：生产实测 1860 个品类分布极均匀（大多各约 1500 条），
 * top 50 仅覆盖 13.1%、top 300 也只覆盖 69.3%，任何截断都会大量丢失品类，
 * 故返回全量，由前端下拉配关键词搜索使用。
 */
export async function dictCategories(): Promise<Array<{ name: string; count: number }>> {
  const rows = await adminQuery<Array<{ category: string; cnt: number }>>(
    `SELECT category, COUNT(*) AS cnt
       FROM materials
      WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
        AND category IS NOT NULL AND category <> ''
      GROUP BY category
      ORDER BY cnt DESC, category ASC`,
    [],
  );
  return rows
    .map(r => ({ name: sanitizeCompetitorDisplayText(r.category), count: Number(r.cnt) }))
    .filter(row => Boolean(row.name));
}

export type DictFieldSuggestion = { value: string; count: number };
const FIELD_VOCABULARY_CACHE_TTL = 30 * 60 * 1000;
const fieldVocabularyCache = new Map<
  "category" | "package",
  { at: number; rows: DictFieldSuggestion[] }
>();

/** 供隔离测试清理字段词表缓存，避免删除fixture后返回陈旧候选。 */
export function __clearFieldVocabularyCache(): void {
  fieldVocabularyCache.clear();
}

async function loadFieldVocabulary(
  field: "category" | "package",
): Promise<DictFieldSuggestion[]> {
  const cached = fieldVocabularyCache.get(field);
  if (cached && Date.now() - cached.at < FIELD_VOCABULARY_CACHE_TTL) {
    return cached.rows;
  }
  const column = field === "package" ? "`package`" : "category";
  const rows = await adminQuery<Array<{ value: string; cnt: number }>>(
    `SELECT ${column} AS value, COUNT(*) AS cnt
       FROM materials
      WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
        AND ${column} IS NOT NULL AND ${column} <> ''
      GROUP BY ${column}
      ORDER BY cnt DESC, ${column} ASC`,
    [],
  );
  const vocabulary = rows
    .map(row => ({ value: String(row.value ?? "").trim(), count: Number(row.cnt) || 0 }))
    .filter(row => Boolean(row.value) && (field !== "category" || !containsCompetitorDisplayName(row.value)));
  fieldVocabularyCache.set(field, { at: Date.now(), rows: vocabulary });
  return vocabulary;
}

/**
 * 分类/封装数据库联想。
 * 字段名仅由枚举映射为固定 SQL 列，不能接收任意字符串，避免列名注入。
 * 数据库词表每 30 分钟聚合一次，逐字输入只在内存中过滤。
 */
export async function dictFieldSuggestions(
  field: "category" | "package",
  keyword: string,
  limit: number,
): Promise<DictFieldSuggestion[]> {
  const kw = keyword.trim().toLocaleLowerCase();
  const safeLimit = Math.max(1, Math.min(30, Math.trunc(limit)));
  const vocabulary = await loadFieldVocabulary(field);
  if (!kw) return vocabulary.slice(0, safeLimit);

  return vocabulary
    .filter(item => item.value.toLocaleLowerCase().includes(kw))
    .sort((a, b) => {
      const aPrefix = a.value.toLocaleLowerCase().startsWith(kw) ? 1 : 0;
      const bPrefix = b.value.toLocaleLowerCase().startsWith(kw) ? 1 : 0;
      return bPrefix - aPrefix || b.count - a.count || a.value.localeCompare(b.value);
    })
    .slice(0, safeLimit);
}

/** 精确取单个型号完整参数 */
export async function dictGetSpecs(partNumber: string): Promise<DictSpecsResult> {
  const map = await dictGetSpecsBatch([partNumber]);
  return map[partNumber] ?? null;
}

/**
 * 批量精确取参，不执行最长前缀兜底。
 *
 * 标签OCR需要同时检查“完整识别串”和“去三位业务码后的候选”。若直接调用
 * dictGetSpecsBatch，完整识别串未命中时会先进入百万级表的前缀兜底，既慢又
 * 不能处理业务码位于真正型号之前的情况。这里用一次索引精确查询完成候选判定；
 * 同一规范化型号若存在多行则返回 null，避免在歧义数据上自动替换。
 */
export async function dictGetSpecsExactBatch(
  partNumbers: string[],
): Promise<Record<string, DictSpecsResult>> {
  const unique = Array.from(new Set(partNumbers.map(s => s.trim()).filter(Boolean)));
  const results: Record<string, DictSpecsResult> = {};
  if (unique.length === 0) return results;

  const rows = await adminQuery<MaterialRow[]>(
    `SELECT id, partNumber, name, brand, category, \`package\`, description,
            specs, datasheetUrl, lifecycle, rohs, coverImageUrl
       FROM materials
      WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
        AND UPPER(partNumber) IN (${unique.map(() => "?").join(",")})`,
    unique.map(s => s.toUpperCase()),
  );
  const grouped = new Map<string, MaterialRow[]>();
  for (const row of rows) {
    const key = row.partNumber.toUpperCase();
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  for (const candidate of unique) {
    const rowsForCandidate = grouped.get(candidate.toUpperCase()) ?? [];
    results[candidate] = rowsForCandidate.length === 1
      ? rowToSpecsResult(rowsForCandidate[0])
      : null;
  }
  return results;
}

export type DictPinoutImage = {
  package: string;
  pinCount: number;
  imageUrl: string;
};

export type DictAppearanceItem = {
  id: number;
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
  /** 第二张图（引脚图/实物图），来自后台 images JSON 的第一项 */
  pinImageUrl?: string;
  /** 按型号前缀和物料封装匹配的官方引脚图 */
  pinoutImages: DictPinoutImage[];
  /** 展示型号：始终优先展示完整订购型号（如 STM32F103C8T6），基础型号仅作回退 */
  displayPartNumber?: string;
};

/** 解析后台 images JSON 字段，取第一张图 URL 作为引脚图 */
function parsePinImageUrl(raw: MaterialRow["images"]): string | undefined {
  if (!raw) return undefined;
  let arr: Array<{ url?: string; key?: string }>;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return undefined;
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr) || !arr.length) return undefined;
  const first = arr[0];
  return toFullImageUrl(first?.url || first?.key);
}

type PinoutRow = {
  partNumber: string;
  package: string;
  pinCount: number;
  imageUrl: string;
};

/** 封装名归一化：提取封装类型和引脚数，忽略空格、连字符与后续尺寸。 */
function normalizePackage(raw: string): string {
  const cleaned = (raw ?? "").toUpperCase().trim();
  const match = cleaned.match(/^([A-Z]+)[\s\-_]*(\d+)/);
  if (match) return `${match[1]}${match[2]}`;
  return cleaned.replace(/[\s\-_]/g, "");
}

/**
 * 仅按完整订货型号批量查询引脚图，再按物料自身封装过滤。
 * 不允许前缀或基础型号回退，避免把相近订货型号的引脚图误配给当前物料。
 */
async function pinoutImagesForParts(
  parts: Array<{ partNumber: string; pkg: string }>,
): Promise<Map<string, DictPinoutImage[]>> {
  const result = new Map<string, DictPinoutImage[]>();
  if (!parts.length) return result;
  const exactPartNumbers = Array.from(
    new Set(
      parts
        .map(part => part.partNumber.normalize("NFKC").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (!exactPartNumbers.length) return result;

  let rows: PinoutRow[] = [];
  try {
    rows = await adminQuery<PinoutRow[]>(
      `SELECT partNumber, \`package\`, pinCount, imageUrl
       FROM pinout_images
       WHERE UPPER(partNumber) IN (${exactPartNumbers.map(() => "?").join(",")})
       ORDER BY partNumber ASC, pinCount ASC`,
      exactPartNumbers,
    );
  } catch {
    return result;
  }

  for (const { partNumber, pkg } of parts) {
    const exactPartNumber = partNumber.normalize("NFKC").trim().toUpperCase();
    const candidates = rows.filter(
      row => row.partNumber.normalize("NFKC").trim().toUpperCase() === exactPartNumber,
    );
    if (!candidates.length) continue;
    const pkgKeys = (pkg ?? "")
      .split(/[\/,、]/)
      .map(normalizePackage)
      .filter(Boolean);
    const matched = pkgKeys.length
      ? candidates.filter(row => pkgKeys.includes(normalizePackage(row.package)))
      : [];
    const seen = new Set<string>();
    const images: DictPinoutImage[] = [];
    for (const row of matched) {
      if (seen.has(row.imageUrl)) continue;
      seen.add(row.imageUrl);
      images.push({ package: row.package, pinCount: row.pinCount, imageUrl: row.imageUrl });
      if (pkgKeys.length === 1) break;
    }
    if (images.length) result.set(partNumber, images);
  }
  return result;
}

/**
 * 从丝印图 URL 文件名推导完整订购型号。
 * 后台物料字典按基础型号维护（partNumber 如 STM32F103C8），而丝印图按录入约定
 * 以完整订购型号命名（如 STM32F103C8T6.png），且经核查全部 464 条有图记录
 * 均满足"文件名以基础型号为前缀且更长"。丝印上印的即完整料号，两者天然一致。
 */
export function deriveFullPartNumber(
  basePartNumber: string,
  coverImageUrl: string | null | undefined,
): string | undefined {
  if (!coverImageUrl) return undefined;
  const fileName = coverImageUrl
    .split("/")
    .pop()
    ?.split("?")[0]
    ?.replace(/\.(png|jpe?g|webp|gif)$/i, "")
    ?.trim();
  if (!fileName) return undefined;
  const upper = fileName.toUpperCase();
  const base = basePartNumber.toUpperCase();
  // 必须以基础型号为前缀且更长，且是合法料号字符，避免把无关文件名当成型号
  if (
    upper.startsWith(base) &&
    upper.length > base.length &&
    /^[0-9A-Z][0-9A-Z.\-/]*$/.test(upper)
  ) {
    return upper;
  }
  return undefined;
}

export function resolveAppearanceDisplayPartNumber(
  basePartNumber: string,
  coverImageUrl: string | null | undefined,
  keyword: string,
  prefixFallback: boolean,
): string {
  const normalizedBase = basePartNumber.normalize("NFKC").trim().toUpperCase();
  const normalizedKeyword = keyword.normalize("NFKC").trim().toUpperCase();
  if (prefixFallback && normalizedKeyword.startsWith(normalizedBase)) return normalizedKeyword;
  return deriveFullPartNumber(basePartNumber, coverImageUrl) ?? basePartNumber;
}

/**
 * 完整料号查询的索引候选：从完整输入到最短6位依次取前缀。
 *
 * 后台字典既可能保存完整订购型号，也可能只保存基础型号。把这些有限候选放入
 * `partNumber IN (...)`，可直接使用型号索引；不能再先执行四个前后通配符的
 * COUNT(*)，否则每个新关键词都会扫描整张materials表。
 */
export function appearancePartNumberCandidates(keyword: string): string[] {
  const normalized = keyword.normalize("NFKC").trim().toUpperCase();
  // 至少8位且同时含字母、数字才视为完整型号检索；品牌、封装和普通文本仍走模糊搜索。
  if (
    normalized.length < 8
    || !/^[0-9A-Z][0-9A-Z.\-/]*$/.test(normalized)
    || !/[A-Z]/.test(normalized)
    || !/\d/.test(normalized)
  ) return [];
  return Array.from(
    { length: normalized.length - 7 },
    (_, index) => normalized.slice(0, normalized.length - index),
  );
}

async function appearanceResultFromRows(
  rows: MaterialRow[],
  total: number,
  keyword: string,
  prefixFallback: boolean,
): Promise<{ items: DictAppearanceItem[]; total: number }> {
  const resolvedRows = rows.map(row => ({
    row,
    // 引脚图查询与页面展示共用同一个完整订货型号，禁止查询阶段退回基础型号。
    displayPartNumber: resolveAppearanceDisplayPartNumber(
      row.partNumber,
      row.coverImageUrl,
      keyword,
      prefixFallback,
    ),
  }));
  const pinoutMap = await pinoutImagesForParts(
    resolvedRows.map(({ row, displayPartNumber }) => ({
      partNumber: displayPartNumber,
      pkg: row.package ?? "",
    })),
  );
  return {
    items: resolvedRows.map(({ row: r, displayPartNumber }) => ({
      id: r.id,
      partNumber: r.partNumber,
      displayPartNumber,
      name: sanitizeCompetitorDisplayText(r.name),
      brand: sanitizeCompetitorDisplayText(r.brand),
      category: sanitizeCompetitorDisplayText(r.category),
      package: r.package ?? "",
      description: sanitizeCompetitorDisplayText(r.description),
      specs: parseSpecs(r.specs),
      datasheetUrl: r.datasheetUrl ?? undefined,
      lifecycle: r.lifecycle ?? undefined,
      rohs: r.rohs ?? undefined,
      coverImageUrl: toFullImageUrl(r.coverImageUrl),
      pinImageUrl: parsePinImageUrl(r.images),
      pinoutImages: pinoutMap.get(displayPartNumber) ?? [],
    })),
    total,
  };
}

/**
 * 外观档案列表：分页列出字典型号（有丝印图的优先），支持型号/品牌/封装关键字过滤。
 * 前缀退化：顶部统一搜索常传完整料号（如 STM32F103C8T6），而字典按基础型号
 * （如 STM32F103C8）维护，LIKE '%完整料号%' 会落空；此时回退为
 * “字典 partNumber 是关键词的前缀”（≥6 位）匹配。
 */
export async function dictAppearanceList(
  keyword: string | undefined,
  limit: number,
  offset: number,
): Promise<{ items: DictAppearanceItem[]; total: number }> {
  const kw = (keyword ?? "").trim();
  const partNumberCandidates = appearancePartNumberCandidates(kw);
  if (partNumberCandidates.length) {
    const candidateRows = await adminQuery<MaterialRow[]>(
      `SELECT id, partNumber, name, brand, category, \`package\`, description,
              specs, datasheetUrl, lifecycle, rohs, coverImageUrl, images
         FROM materials
        WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
          AND partNumber IN (${partNumberCandidates.map(() => "?").join(",")})
        ORDER BY CHAR_LENGTH(partNumber) DESC, (coverImageUrl IS NOT NULL) DESC, partNumber ASC`,
      partNumberCandidates,
    );
    if (candidateRows.length) {
      const normalizedKw = kw.normalize("NFKC").trim().toUpperCase();
      const exactRows = candidateRows.filter(
        row => row.partNumber.normalize("NFKC").trim().toUpperCase() === normalizedKw,
      );
      // 基础型号只有在字典封面文件名可明确推导出当前完整型号时才允许回退。
      // 不能仅凭“用户输入以基础型号开头”就绑定，否则错误后缀也会命中相似物料。
      const verifiedPrefixRows = exactRows.length
        ? []
        : candidateRows.filter(
            row => deriveFullPartNumber(row.partNumber, row.coverImageUrl) === normalizedKw,
          );
      const matchedRows = exactRows.length ? exactRows : verifiedPrefixRows;
      if (matchedRows.length) {
        const pageRows = matchedRows.slice(offset, offset + limit);
        return appearanceResultFromRows(
          pageRows,
          matchedRows.length,
          kw,
          exactRows.length === 0,
        );
      }
    }
    // 这是明确的完整型号输入；未命中即返回空，绝不再进入前后通配的大表扫描，
    // 也不把一个不存在的长型号强行绑定到任意更短的模糊结果。
    return { items: [], total: 0 };
  }

  let prefixFallback = false;
  let where = kw
    ? `status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL} AND (partNumber LIKE ? OR brand LIKE ? OR \`package\` LIKE ? OR category LIKE ?)`
    : `status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}`;
  let params: unknown[] = kw ? [`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`] : [];
  if (kw) {
    const [probe] = await adminQuery<Array<{ c: number }>>(
      `SELECT COUNT(*) c FROM materials WHERE ${where}`,
      params,
    );
    if (!(probe?.c > 0) && kw.length >= 6 && /^[0-9A-Za-z][0-9A-Za-z.\-/]*$/.test(kw)) {
      // 完整料号退化匹配：字典基础型号是关键词的前缀（不区分大小写）
      where = `status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL} AND UPPER(?) LIKE CONCAT(UPPER(partNumber), '%') AND CHAR_LENGTH(partNumber) >= 6`;
      params = [kw];
      prefixFallback = true;
    }
  }
  const [rows, countRows] = await Promise.all([
    adminQuery<MaterialRow[]>(
      `SELECT id, partNumber, name, brand, category, \`package\`, description,
              specs, datasheetUrl, lifecycle, rohs, coverImageUrl, images
       FROM materials
       WHERE ${where}
       ORDER BY (coverImageUrl IS NOT NULL) DESC, partNumber ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    adminQuery<Array<{ c: number }>>(
      `SELECT COUNT(*) c FROM materials WHERE ${where}`,
      params,
    ),
  ]);
  // 退化匹配时，只保留 partNumber 最长的那一条（最精确的前缀匹配）
  // 例如搜索 BQ24195LRGER，BQ24195L(8位) 比 BQ24195(7位) 更精确，只保留 BQ24195L
  const filteredRows =
    prefixFallback && rows.length > 1
      ? [rows.slice().sort((a, b) => b.partNumber.length - a.partNumber.length)[0]]
      : rows;
  // 退化匹配时 total 同步修正为过滤后的条数，避免前端显示"共收录 2 个型号档案"
  return appearanceResultFromRows(
    filteredRows,
    prefixFallback ? filteredRows.length : (countRows[0]?.c ?? 0),
    kw,
    prefixFallback,
  );
}

/** 字典图片基础地址：后台上传图片存的是相对路径（/uploads/...），需拼接可公网访问的域名 */
const ADMIN_ASSET_BASE = process.env.ADMIN_ASSET_BASE || "http://47.97.108.147";

/** 相对图片路径 → 完整可访问 URL */
export function toFullImageUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${ADMIN_ASSET_BASE}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

type MaterialThumbnailRow = {
  partNumber: string;
  coverImageUrl: string;
  updatedAt: Date | string | null;
};

const MATERIAL_THUMBNAIL_INDEX_TTL = 30 * 60 * 1000;
let materialThumbnailIndex = new Map<string, string>();
let materialThumbnailKeysByLength: string[] = [];
let materialThumbnailIndexAt = 0;
let materialThumbnailIndexPromise: Promise<void> | null = null;

function versionedMaterialImageUrl(row: MaterialThumbnailRow): string | undefined {
  const full = toFullImageUrl(row.coverImageUrl);
  if (!full) return undefined;
  try {
    const url = new URL(full);
    const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
    url.searchParams.set("v", String(Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 1));
    return url.toString();
  } catch {
    return full;
  }
}

/**
 * 预热物料封面索引。搜索请求只读内存映射，不再等待完整参数档案查询。
 * 刷新失败时保留上一次成功索引，避免后台字典短时不可用导致图片抖动。
 */
export async function warmupMaterialThumbnailIndex(): Promise<void> {
  if (materialThumbnailIndexPromise) return materialThumbnailIndexPromise;
  materialThumbnailIndexPromise = (async () => {
    try {
      const rows = await adminQuery<MaterialThumbnailRow[]>(
        `SELECT partNumber, coverImageUrl, updatedAt
         FROM materials
         WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
           AND coverImageUrl IS NOT NULL
           AND TRIM(coverImageUrl) <> ''
         ORDER BY updatedAt DESC`,
        [],
      );
      const next = new Map<string, string>();
      for (const row of rows) {
        const key = row.partNumber.trim().toUpperCase();
        if (!key || next.has(key)) continue;
        const url = versionedMaterialImageUrl(row);
        if (url) next.set(key, url);
      }
      materialThumbnailIndex = next;
      materialThumbnailKeysByLength = Array.from(next.keys()).sort((a, b) => b.length - a.length);
      materialThumbnailIndexAt = Date.now();
      console.log(`[adminDb] material thumbnail index warmed: ${next.size}`);
    } catch (err) {
      console.warn("[adminDb] material thumbnail index warmup failed:", err instanceof Error ? err.message : err);
    } finally {
      materialThumbnailIndexPromise = null;
    }
  })();
  return materialThumbnailIndexPromise;
}

/**
 * 从内存封面索引为搜索结果取图。精确订货型号优先；仅包装白名单后缀
 * （如 TR 卷带）可共用同料封面，不得回退到更短基础型号或温度等级。
 */
export function materialThumbnailUrls(partNumbers: string[]): Record<string, string> {
  if (Date.now() - materialThumbnailIndexAt > MATERIAL_THUMBNAIL_INDEX_TTL) {
    void warmupMaterialThumbnailIndex();
  }
  const result: Record<string, string> = {};
  for (const partNumber of partNumbers) {
    for (const key of packagingAppearanceLookupKeys(partNumber)) {
      const url = materialThumbnailIndex.get(key);
      if (url) {
        result[partNumber] = url;
        break;
      }
    }
  }
  return result;
}

function rowToSpecsResult(r: MaterialRow): DictSpecsResult {
  return {
    partNumber: r.partNumber,
    name: sanitizeCompetitorDisplayText(r.name),
    brand: sanitizeCompetitorDisplayText(r.brand),
    category: sanitizeCompetitorDisplayText(r.category),
    package: r.package ?? "",
    description: sanitizeCompetitorDisplayText(r.description),
    specs: parseSpecs(r.specs),
    datasheetUrl: r.datasheetUrl ?? undefined,
    lifecycle: r.lifecycle ?? undefined,
    rohs: r.rohs ?? undefined,
    coverImageUrl: toFullImageUrl(r.coverImageUrl),
  };
}

export type DictAlternativeItem = {
  id: number;
  partNumber: string;
  name: string;
  brand: string;
  category: string;
  package: string;
  specs: Record<string, string>;
  coverImageUrl?: string;
  datasheetUrl?: string;
  /** 相似度百分比（0-100） */
  similarity: number;
  /** 与目标型号一致的关键参数名列表 */
  matchedSpecs: string[];
  /** 与目标型号不一致的关键参数（名称 → 替代型号的值） */
  differentSpecs: Array<{ key: string; value: string; targetValue: string }>;
};

/** 替代查询中参与相似度计算的关键参数及权重（未列出的参数权重为 1） */
const ALT_SPEC_WEIGHTS: Record<string, number> = {
  "CPU内核": 5,
  "CPU位数": 3,
  "主频(MHz)": 3,
  "CPU最大主频": 3,
  "Flash容量(KB)": 4,
  "RAM容量(KB)": 4,
  "工作电压(V)": 2,
  "工作温度(℃)": 2,
  "封装": 3,
};

/**
 * 替代查询：输入型号（支持完整料号前缀退化），在字典中按参数相似度
 * 推荐同类替代型号。相似度 = 加权一致参数分 / 加权总分，
 * 同品类优先、跨品牌可替代（国产替代场景）。
 */
export async function dictFindAlternatives(
  partNumber: string,
  limit: number,
): Promise<{ target: DictSpecsResult; alternatives: DictAlternativeItem[] } | null> {
  // 1) 定位目标型号（含前缀兜底）
  const target = await dictGetSpecs(partNumber);
  if (!target) return null;

  // 2) 拉取同品类候选（排除自身），最多 300 条参与打分
  const rows = await adminQuery<MaterialRow[]>(
    `SELECT id, partNumber, name, brand, category, \`package\`, description,
            specs, datasheetUrl, lifecycle, rohs, coverImageUrl
     FROM materials
     WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL} AND partNumber <> ?
       AND (category = ? OR ? = '')
     LIMIT 300`,
    [target.partNumber, target.category ?? "", target.category ?? ""],
  );

  const targetSpecs = target.specs ?? {};
  const targetKeys = Object.keys(targetSpecs).filter(k => String(targetSpecs[k] ?? "").trim() !== "");
  if (targetKeys.length === 0) return { target, alternatives: [] };

  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  const scored: DictAlternativeItem[] = rows.map(r => {
    const specs = parseSpecs(r.specs);
    let gained = 0;
    let totalWeight = 0;
    const matchedSpecs: string[] = [];
    const differentSpecs: Array<{ key: string; value: string; targetValue: string }> = [];
    for (const key of targetKeys) {
      const weight = ALT_SPEC_WEIGHTS[key] ?? 1;
      totalWeight += weight;
      const candVal = specs[key];
      if (candVal != null && norm(candVal) === norm(targetSpecs[key])) {
        gained += weight;
        matchedSpecs.push(key);
      } else if (candVal != null && String(candVal).trim() !== "") {
        differentSpecs.push({ key, value: String(candVal), targetValue: String(targetSpecs[key]) });
      }
    }
    // 封装一致额外加分（若封装不在 specs 中）
    if (!("封装" in targetSpecs) && target.package && r.package && norm(target.package) === norm(r.package)) {
      gained += ALT_SPEC_WEIGHTS["封装"];
      totalWeight += ALT_SPEC_WEIGHTS["封装"];
      matchedSpecs.push("封装");
    } else if (!("封装" in targetSpecs) && target.package) {
      totalWeight += ALT_SPEC_WEIGHTS["封装"];
    }
    const similarity = totalWeight > 0 ? Math.round((gained / totalWeight) * 100) : 0;
    return {
      id: r.id,
      partNumber: r.partNumber,
      name: sanitizeCompetitorDisplayText(r.name),
      brand: sanitizeCompetitorDisplayText(r.brand),
      category: sanitizeCompetitorDisplayText(r.category),
      package: r.package ?? "",
      specs,
      coverImageUrl: toFullImageUrl(r.coverImageUrl),
      datasheetUrl: r.datasheetUrl ?? undefined,
      similarity,
      matchedSpecs,
      differentSpecs: differentSpecs.slice(0, 6),
    };
  });

  const alternatives = scored
    .filter(item => item.similarity >= 40)
    .sort((a, b) => b.similarity - a.similarity || a.partNumber.localeCompare(b.partNumber))
    .slice(0, limit);

  return { target, alternatives };
}

/**
 * 批量取参数（单条 SQL IN 查询，大小写不敏感精确匹配）。
 * 前缀兜底：字典按"基础型号"粒度维护（如 STM32F103C8），而库存常用完整料号
 * （如 STM32F103C8T6 = 基础型号 + 封装/温度后缀）。精确未命中时，
 * 回退为"字典型号是查询料号的前缀"的最长匹配（≥6位，避免过泛）。
 */
export async function dictGetSpecsBatch(
  partNumbers: string[],
): Promise<Record<string, DictSpecsResult>> {
  const unique = Array.from(new Set(partNumbers.map(s => s.trim()).filter(Boolean)));
  const results: Record<string, DictSpecsResult> = {};
  if (unique.length === 0) return results;
  const placeholders = unique.map(() => "?").join(",");
  const rows = await adminQuery<MaterialRow[]>(
    `SELECT id, partNumber, name, brand, category, \`package\`, description,
            specs, datasheetUrl, lifecycle, rohs, coverImageUrl
     FROM materials
     WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
       AND UPPER(partNumber) IN (${placeholders})`,
    unique.map(s => s.toUpperCase()),
  );
  const byUpper = new Map<string, MaterialRow>();
  for (const r of rows) byUpper.set(r.partNumber.toUpperCase(), r);

  // 精确未命中的料号 → 前缀匹配兜底（一次查询覆盖全部未命中项）
  const missed = unique.filter(pn => !byUpper.has(pn.toUpperCase()));
  const prefixHit = new Map<string, MaterialRow>();
  if (missed.length > 0) {
    const conds = missed.map(() => "? LIKE CONCAT(UPPER(partNumber), '%')").join(" OR ");
    const prefixRows = await adminQuery<MaterialRow[]>(
      `SELECT id, partNumber, name, brand, category, \`package\`, description,
              specs, datasheetUrl, lifecycle, rohs, coverImageUrl
       FROM materials
       WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
         AND CHAR_LENGTH(partNumber) >= 6 AND (${conds})`,
      missed.map(s => s.toUpperCase()),
    );
    // 每个查询料号取"最长前缀"的字典行
    for (const pn of missed) {
      const pnUpper = pn.toUpperCase();
      let best: MaterialRow | null = null;
      for (const r of prefixRows) {
        const dictUpper = r.partNumber.toUpperCase();
        if (pnUpper.startsWith(dictUpper)) {
          if (!best || dictUpper.length > best.partNumber.length) best = r;
        }
      }
      if (best) prefixHit.set(pnUpper, best);
    }
  }

  for (const pn of unique) {
    const r = byUpper.get(pn.toUpperCase()) ?? prefixHit.get(pn.toUpperCase()) ?? null;
    results[pn] = r ? rowToSpecsResult(r) : null;
  }
  return results;
}

/**
 * 市场参考价查询结果。
 *
 * 价格来源：用户定期上传的物料价格表（external_catalog_batches / entries）。
 * 始终取「最新 active 批次」的价格，用户上传新表后前台自动用上新价，无需改代码。
 */
export type DictReferencePriceBatchMeta = {
  batchId: number;
  status: string;
  activatedAt: Date | string | null;
};

export type DictReferencePrice = {
  /** 命中的型号（价格表内真实型号，可能与输入不同：别名反查/前缀回退） */
  partNumber: string;
  /** 市场参考价基准（元），来自最新 active 批次 */
  basePrice: number;
  brand: string;
  category: string;
  package: string;
  /** 命中方式，便于前端提示与排查 */
  matchedBy: "exact" | "compact" | "alias" | "material_alias";
  /** 价格所属批次号 */
  batchId: number;
  /** 该价格对应的数量档（用户当前数据统一为 1；保留以支持将来含多档的表） */
  quantityThreshold: number;
};

/**
 * 参考价查询缓存（10 分钟）。
 *
 * 价格表按天/周更新，而数据通查价是用户高频操作（切标签、刷新、比价），
 * 缓存可显著降低库压力。TTL 取 10 分钟，使新批次上传后最迟 10 分钟内生效。
 */
const REF_PRICE_CACHE_TTL = 10 * 60 * 1000;
const REF_PRICE_CACHE_MAX = 5000;
const refPriceCache = new Map<string, { at: number; data: DictReferencePrice | null }>();
const refPriceBatchMetaCache = new Map<
  number,
  { at: number; data: DictReferencePriceBatchMeta | null }
>();

export function __clearReferencePriceCache(): void {
  refPriceCache.clear();
  refPriceBatchMetaCache.clear();
  activeBatchCache = null;
}

/**
 * 最新 active 批次缓存（5 分钟）。
 *
 * 为何要缓存：每次查价都先查一次批次表属于固定开销，而批次变更只发生在
 * 用户上传新表时（按天/周计）。5 分钟 TTL 让新批次上传后自动生效，
 * 无需重启服务或手工清缓存——这是「定期上传即生效」的关键。
 */
const ACTIVE_BATCH_CACHE_TTL = 5 * 60 * 1000;
let activeBatchCache: { at: number; batchId: number | null } | null = null;

/**
 * 取最新 active 价格批次号。
 *
 * 判定依据（用户 2026-08-16 确认）：以上传日期为准，最新的 active 批次即当前价格依据。
 * 排序用 activatedAt 而非 id：id 只反映创建顺序，若某批先创建后激活，
 * 按 id 取会拿到错的批次；激活时间才真正代表「何时开始作为价格依据」。
 * activatedAt 相同时再按 id 兜底。
 */
async function getActivePriceBatchId(): Promise<number | null> {
  const now = Date.now();
  if (activeBatchCache && now - activeBatchCache.at < ACTIVE_BATCH_CACHE_TTL) {
    return activeBatchCache.batchId;
  }
  const rows = await adminQuery<Array<{ id: number }>>(
    `SELECT id FROM external_catalog_batches
      WHERE status = 'active'
      ORDER BY activatedAt DESC, id DESC
      LIMIT 1`,
    [],
  );
  const batchId = rows.length > 0 ? Number(rows[0].id) : null;
  activeBatchCache = { at: now, batchId };
  return batchId;
}

/** 推荐后台只读取批次号；仍复用 5 分钟缓存，避免每次页面访问都查询价格库。 */
export async function getActiveReferencePriceBatchId(): Promise<number | null> {
  return getActivePriceBatchId();
}

type CatalogPriceRow = {
  partNumberKey: string;
  partNumberCompactKey?: string | null;
  priceValue: string | number | null;
  quantityThresholdValue: number | null;
  brandRaw: string | null;
  categoryRaw: string | null;
  packageRaw: string | null;
};

const CATALOG_PRICE_COLUMNS =
  "partNumberKey, priceValue, quantityThresholdValue, brandRaw, categoryRaw, packageRaw";

/**
 * 价格表原始品牌/品类字段带括号注释（如 "ST(意法半导体)"），
 * 且生产库该字段存在字符集问题显示为 "ST(?????)"。
 * 取括号前的主名，既避免把乱码展示给用户，也让品牌更简洁。
 */
function cleanCatalogText(raw: string | null): string {
  if (!raw) return "";
  const text = String(raw).trim();
  const idx = text.search(/[（(]/);
  const main = idx > 0 ? text.slice(0, idx) : text;
  // 清掉导入时字符集损坏产生的连续问号
  return main.replace(/\?{2,}/g, "").trim();
}

function toCatalogRefPrice(
  rows: CatalogPriceRow[],
  matchedBy: DictReferencePrice["matchedBy"],
  batchId: number,
  queriedKey: string,
  strictUnique = false,
): DictReferencePrice | null {
  if (rows.length === 0) return null;

  // 用户明确约束：同一批次内一个型号只应有一个价格，出现多个即数据有问题。
  // 故此处不静默取值，先告警——静默会掩盖价格表的导入缺陷。
  if (rows.length > 1) {
    console.warn(
      `[dictReferencePrice] 同批次同型号出现多个价格，疑似价格表数据异常: ` +
        `batchId=${batchId} key=${queriedKey} rows=${rows.length} ` +
        `values=${rows.map(r => r.priceValue).join(",")}`,
    );
    if (strictUnique) return null;
  }

  // 兜底规则：若将来上传的表含多个数量档，取最大数量档作为市场参考价。
  // 当前批次为一型号一价，此排序不改变结果。
  const sorted = [...rows].sort(
    (a, b) => Number(b.quantityThresholdValue ?? 0) - Number(a.quantityThresholdValue ?? 0),
  );
  const row = sorted[0];
  const base = parseReferencePrice(row.priceValue as string | number | null);
  if (base === null) return null;

  return {
    partNumber: row.partNumberKey,
    basePrice: base,
    brand: sanitizeCompetitorDisplayText(cleanCatalogText(row.brandRaw)),
    category: sanitizeCompetitorDisplayText(cleanCatalogText(row.categoryRaw)),
    package: cleanCatalogText(row.packageRaw),
    matchedBy,
    batchId,
    quantityThreshold: Number(row.quantityThresholdValue ?? 1),
  };
}

/** 型号紧凑化：去掉连字符/下划线/空格，用于容错用户输入的分隔符差异 */
function compactPartKey(input: string): string {
  return input.toUpperCase().replace(/[\s\-_]/g, "");
}

/**
 * 明确包装同料组的另一个订购型号。未知型号绝不按字符串后缀猜测同料关系。
 * `packagingFallback=false` 用于需要逐包装展示独立价格的调用方。
 */
export function marketPackagingFallbackKeys(
  partNumber: string,
  packagingFallback = true,
): string[] {
  if (!packagingFallback) return [];
  const key = normalizeMarketPartNumber(partNumber);
  const group = resolveMarketPackagingGroup(key);
  if (!group) return [];
  return group.variants
    .map(variant => normalizeMarketPartNumber(variant.partNumber))
    .filter(variant => variant !== key);
}

/** 价格表封装必须完整等于组规范；空封装或相近封装都不能借用另一包装的价格。 */
function normalizeCatalogPackage(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]/g, "");
}

/**
 * 仅留下显式包装同料组中、品牌与完整封装均通过校验的价格表行。
 * 该纯过滤器也让批量查询可先一次 IN 取完候选后在内存关联，避免 N+1。
 */
export function filterMarketPackagingFallbackRows(
  partNumber: string,
  rows: CatalogPriceRow[],
): CatalogPriceRow[] {
  const group = resolveMarketPackagingGroup(partNumber);
  const candidateKeys = new Set(marketPackagingFallbackKeys(partNumber));
  const expectedPackage = normalizeCatalogPackage(group?.package);
  if (!group || candidateKeys.size === 0 || !expectedPackage) return [];

  return rows.filter(row =>
    candidateKeys.has(normalizeMarketPartNumber(row.partNumberKey))
    && isMarketPackagingBrandCompatible(partNumber, row.brandRaw ?? "")
    && normalizeCatalogPackage(row.packageRaw) === expectedPackage,
  );
}

/**
 * 按型号取市场参考价（数据通查价的数据源）。
 *
 * 数据依据（用户 2026-08-16 确认）：
 *   用户会定期上传物料价格表，最新 active 批次即实时价格依据。
 *   本函数始终读最新批次，用户上传新表后前台自动生效，无需改代码或配置。
 *
 * 生产实测（批次 4，2026-08-14 上传）：
 *   599,987 行 = 599,987 个唯一型号，严格一型号一价，价格异常 0 条；
 *   可覆盖 599,724 / 610,476 条启用物料（98.2%）。
 *   未覆盖的 10,752 条为平台自有 51E- 早期物料（不在价格表内），
 *   如实返回无价，不编造价格。
 *
 * 四级命中策略，顺序即优先级：
 *   1. 精确匹配 partNumberKey——走 (batchId, partNumberKey) 复合索引；
 *   2. 紧凑键匹配——容错用户输入的连字符/空格差异，走 compact 索引；
 *   3. 价格表内型号别名——用户可能输入旧编码，经 material_code_aliases
 *      找到物料真实型号后再查价，保持与搜索一致的可查性；
 *   4. 显式包装同料组回退——仅目录明确列出的同料不同包装型号可互借价格，
 *      且价格表品牌和完整封装必须与组规范相符。
 */
export async function dictReferencePrice(
  partNumber: string,
  options: { batchId?: number; strictUnique?: boolean; packagingFallback?: boolean } = {},
): Promise<DictReferencePrice | null> {
  const pn = partNumber.trim();
  if (!pn) return null;
  const key = pn.toUpperCase();
  const batchId = options.batchId ?? await getActivePriceBatchId();
  // 无 active 批次（如首次部署尚未上传价格表）：如实返回无价
  if (batchId === null) return null;
  const strictUnique = options.strictUnique === true;
  const packagingFallback = options.packagingFallback !== false;
  const cacheKey = `${strictUnique ? "strict" : "standard"}:packaging-${packagingFallback ? "on" : "off"}:${MARKET_PACKAGING_RULE_VERSION}:${batchId}:${key}`;

  const cached = refPriceCache.get(cacheKey);
  if (cached && Date.now() - cached.at < REF_PRICE_CACHE_TTL) return cached.data;

  const remember = (data: DictReferencePrice | null) => {
    if (refPriceCache.size >= REF_PRICE_CACHE_MAX) {
      const oldest = Array.from(refPriceCache.entries()).sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) refPriceCache.delete(oldest[0]);
    }
    refPriceCache.set(cacheKey, { at: Date.now(), data });
    return data;
  };

  // 1. 精确匹配
  const exact = await adminQuery<CatalogPriceRow[]>(
    `SELECT ${CATALOG_PRICE_COLUMNS}
       FROM external_catalog_entries
      WHERE batchId = ? AND partNumberKey = ?`,
    [batchId, key],
  );
  const exactHit = toCatalogRefPrice(exact, "exact", batchId, key, strictUnique);
  if (exactHit) return remember(exactHit);

  // 2. 紧凑键匹配（容错分隔符差异）
  const compact = compactPartKey(pn);
  if (compact !== key) {
    const compactRows = await adminQuery<CatalogPriceRow[]>(
      `SELECT ${CATALOG_PRICE_COLUMNS}
         FROM external_catalog_entries
        WHERE batchId = ? AND partNumberCompactKey = ?`,
      [batchId, compact],
    );
    const compactHit = toCatalogRefPrice(compactRows, "compact", batchId, compact, strictUnique);
    if (compactHit) return remember(compactHit);
  }

  // 3. 旧编码 → 物料真实型号 → 再查价
  const aliasRows = await adminQuery<Array<{ partNumber: string }>>(
    `SELECT m.partNumber
       FROM material_code_aliases a
       JOIN materials m ON m.id = a.materialId
      WHERE a.aliasCode = ? AND m.status = 'enabled' AND ${MATERIAL_ALIAS_PUBLIC_SAFE_SQL}
      LIMIT 1`,
    [pn],
  );
  if (aliasRows.length > 0) {
    const realKey = aliasRows[0].partNumber.toUpperCase();
    if (realKey !== key) {
      const aliasPriceRows = await adminQuery<CatalogPriceRow[]>(
        `SELECT ${CATALOG_PRICE_COLUMNS}
           FROM external_catalog_entries
          WHERE batchId = ? AND partNumberKey = ?`,
        [batchId, realKey],
      );
      const aliasHit = toCatalogRefPrice(aliasPriceRows, "alias", batchId, realKey, strictUnique);
      if (aliasHit) return remember(aliasHit);
    }
  }

  // 4. 仅显式目录中的同料不同包装可回退；不从型号字符串猜测后缀关系。
  const packagingKeys = marketPackagingFallbackKeys(key, packagingFallback);
  if (packagingKeys.length) {
    const packagingRows = await adminQuery<CatalogPriceRow[]>(
      `SELECT ${CATALOG_PRICE_COLUMNS}
         FROM external_catalog_entries
        WHERE batchId = ? AND partNumberKey IN (${packagingKeys.map(() => "?").join(",")})`,
      [batchId, ...packagingKeys],
    );
    const familyRows = filterMarketPackagingFallbackRows(key, packagingRows);
    const familyHit = toCatalogRefPrice(
      familyRows,
      "material_alias",
      batchId,
      packagingKeys.join(","),
      strictUnique,
    );
    if (familyHit) return remember(familyHit);
  }

  return remember(null);
}

/** BOM固定批次参考价；同一匹配键出现多价时返回无价并转询价。 */
export async function dictReferencePriceForBatch(
  partNumber: string,
  batchId: number,
): Promise<DictReferencePrice | null> {
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return null;
  return dictReferencePrice(partNumber, { batchId, strictUnique: true });
}

/**
 * 推荐任务批量查价。
 *
 * 与 dictReferencePrice 保持相同的四级匹配规则，但把几千次逐型号查询合并为
 * 每批最多 500 个键的 IN 查询。该函数只在后台价值快照重算时调用，页面请求
 * 仍然只读本地推荐快照。
 */
export async function dictReferencePricesForBatch(
  partNumbers: string[],
  batchId: number,
  options: { packagingFallback?: boolean } = {},
): Promise<Map<string, DictReferencePrice | null>> {
  if (process.env.DIANZI51_RECOMMENDATION_WORKER === "1" && partNumbers.length > 500) {
    throw Object.assign(new Error("REFERENCE_KEYS_LIMIT"), { code: "RECOMMENDATION_VALUE_REFERENCE_ROWS_LIMIT" });
  }
  const keys = Array.from(new Set(
    partNumbers.map(value => value.normalize("NFKC").trim().toUpperCase()).filter(Boolean),
  ));
  const result = new Map<string, DictReferencePrice | null>(keys.map(key => [key, null]));
  if (!Number.isSafeInteger(batchId) || batchId <= 0 || keys.length === 0) return result;

  const chunks = <T>(values: T[], size = 500) => {
    const output: T[][] = [];
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
    return output;
  };
  const rowsBy = (rows: CatalogPriceRow[], keyOf: (row: CatalogPriceRow) => string) => {
    const grouped = new Map<string, CatalogPriceRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const group = grouped.get(key);
      if (group) group.push(row);
      else grouped.set(key, [row]);
    }
    return grouped;
  };
  const workerBounded = process.env.DIANZI51_RECOMMENDATION_WORKER === "1";
  const rowLimit = 20_000;
  const overflow = () => Object.assign(new Error("REFERENCE_ROWS_LIMIT"), { code: "RECOMMENDATION_VALUE_REFERENCE_ROWS_LIMIT" });
  const lookupPriceRows = async (column: "partNumberKey" | "partNumberCompactKey", values: string[]) => {
    const rows: CatalogPriceRow[] = [];
    for (const batch of chunks(Array.from(new Set(values)))) {
      if (!batch.length) continue;
      const page = await adminQuery<CatalogPriceRow[]>(
        `SELECT ${CATALOG_PRICE_COLUMNS}, partNumberCompactKey
           FROM external_catalog_entries
          WHERE batchId = ? AND ${column} IN (${batch.map(() => "?").join(",")})
          ${workerBounded ? "LIMIT 20001" : ""}`,
        [batchId, ...batch],
      );
      if (workerBounded && rows.length + page.length > rowLimit) throw overflow();
      rows.push(...page);
    }
    return rows;
  };

  const exactRows = await lookupPriceRows("partNumberKey", keys);
  const exactByKey = rowsBy(exactRows, row => String(row.partNumberKey ?? "").toUpperCase());
  for (const key of keys) {
    const hit = toCatalogRefPrice(exactByKey.get(key) ?? [], "exact", batchId, key, true);
    if (hit) result.set(key, hit);
  }

  const unresolvedAfterExact = keys.filter(key => result.get(key) === null);
  const compactByOriginal = new Map(unresolvedAfterExact.map(key => [key, compactPartKey(key)]));
  const compactRows = await lookupPriceRows("partNumberCompactKey", Array.from(compactByOriginal.values()));
  const compactGroups = rowsBy(compactRows, row => compactPartKey(String((row as CatalogPriceRow & { partNumberCompactKey?: string }).partNumberCompactKey ?? row.partNumberKey ?? "")));
  for (const key of unresolvedAfterExact) {
    const compact = compactByOriginal.get(key) ?? "";
    const hit = toCatalogRefPrice(compactGroups.get(compact) ?? [], "compact", batchId, compact, true);
    if (hit) result.set(key, hit);
  }

  const unresolvedAfterCompact = keys.filter(key => result.get(key) === null);
  const aliasToMaterial = new Map<string, string>();
  for (const batch of chunks(unresolvedAfterCompact)) {
    if (!batch.length) continue;
    const aliasRows = await adminQuery<Array<{ aliasCode: string; partNumber: string }>>(
      `SELECT a.aliasCode, m.partNumber
         FROM material_code_aliases a
         JOIN materials m ON m.id = a.materialId
        WHERE a.aliasCode IN (${batch.map(() => "?").join(",")})
          AND m.status = 'enabled'
          AND ${MATERIAL_ALIAS_PUBLIC_SAFE_SQL}
          ${workerBounded ? "LIMIT 20001" : ""}`,
      batch,
    );
    if (workerBounded && aliasRows.length > rowLimit) throw overflow();
    for (const row of aliasRows) aliasToMaterial.set(String(row.aliasCode).toUpperCase(), String(row.partNumber).toUpperCase());
  }
  const aliasPriceRows = await lookupPriceRows("partNumberKey", Array.from(aliasToMaterial.values()));
  const aliasPriceGroups = rowsBy(aliasPriceRows, row => String(row.partNumberKey ?? "").toUpperCase());
  for (const key of unresolvedAfterCompact) {
    const materialKey = aliasToMaterial.get(key);
    if (!materialKey) continue;
    const hit = toCatalogRefPrice(aliasPriceGroups.get(materialKey) ?? [], "alias", batchId, materialKey, true);
    if (hit) result.set(key, hit);
  }

  // 一次有界 IN 查询取齐所有显式包装同料候选，再在内存按原始型号关联；不得 N+1。
  const packagingFallback = options.packagingFallback !== false;
  const unresolvedAfterAlias = keys.filter(key => result.get(key) === null);
  const packagingKeysByOriginal = new Map(
    unresolvedAfterAlias.map(key => [key, marketPackagingFallbackKeys(key, packagingFallback)]),
  );
  const packagingRows = await lookupPriceRows(
    "partNumberKey",
    Array.from(packagingKeysByOriginal.values()).flat(),
  );
  const packagingGroups = rowsBy(packagingRows, row => normalizeMarketPartNumber(row.partNumberKey));
  for (const key of unresolvedAfterAlias) {
    const candidateRows = (packagingKeysByOriginal.get(key) ?? [])
      .flatMap(candidateKey => packagingGroups.get(candidateKey) ?? []);
    const familyRows = filterMarketPackagingFallbackRows(key, candidateRows);
    const hit = toCatalogRefPrice(
      familyRows,
      "material_alias",
      batchId,
      (packagingKeysByOriginal.get(key) ?? []).join(","),
      true,
    );
    if (hit) result.set(key, hit);
  }

  return result;
}

/** 返回指定价格批次的公开元数据；不返回来源文件名等内部信息。 */
export async function dictReferencePriceBatchMeta(
  batchId: number,
): Promise<DictReferencePriceBatchMeta | null> {
  if (!Number.isSafeInteger(batchId) || batchId <= 0) return null;
  const cached = refPriceBatchMetaCache.get(batchId);
  if (cached && Date.now() - cached.at < REF_PRICE_CACHE_TTL) return cached.data;

  const rows = await adminQuery<Array<{
    id: number;
    status: string;
    activatedAt: Date | string | null;
  }>>(
    `SELECT id, status, activatedAt
       FROM external_catalog_batches
      WHERE id = ?
      LIMIT 1`,
    [batchId],
  );
  const row = rows[0];
  const data = row
    ? { batchId: Number(row.id), status: String(row.status), activatedAt: row.activatedAt }
    : null;
  refPriceBatchMetaCache.set(batchId, { at: Date.now(), data });
  return data;
}

/** Generated-art identity only. Does not change the ordinary dictionary image index. */
export async function readGeneratedImageDictionaryRows(
  inputs: ReadonlyArray<{ partNumber: string; dictionaryMaterialId: number | null }>,
): Promise<Array<{ id: number; partNumber: string; brand: string; status: string }>> {
  if (!inputs.length || inputs.length > 1000) return [];
  const parts = Array.from(new Set(inputs.map(item => item.partNumber)));
  const ids = Array.from(new Set(inputs.map(item => item.dictionaryMaterialId).filter((id): id is number => id != null)));
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (parts.length) { conditions.push(`partNumber IN (${parts.map(() => "?").join(",")})`); params.push(...parts); }
  if (ids.length) { conditions.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  if (!conditions.length) return [];
  const rows = await adminQuery<Array<{ id: number; partNumber: string; brand: string; status: string }>>(
    `SELECT /*+ MAX_EXECUTION_TIME(8000) */ id, partNumber, brand, status FROM materials
      WHERE status = 'enabled' AND ${MATERIAL_PUBLIC_SAFE_SQL}
        AND (${conditions.join(" OR ")}) LIMIT 10001`, params,
  );
  // A truncated candidate set must never be mistaken for a unique identity.
  return rows.length >= 10001 ? [] : rows;
}

/**
 * A deliberately narrow raw row for the factory-channel public projection.
 * The snapshot stays internal to the server: factoryChannelPublic validates and
 * maps it to its explicit public DTO, never returning this object to callers.
 */
export type OfficialChannelPublicationReadRow = {
  publicId: string;
  snapshot: unknown;
  publishedAt: Date | string;
};

/**
 * Read only currently eligible official factory-channel publications.
 *
 * This query intentionally has no caller-selected SQL, columns, joins, or
 * predicates. In particular it never reads regular merchant inventories and
 * selects neither stock/source IDs nor any source, owner, contact, note, or
 * attachment field. The public service must still validate the fixed snapshot
 * before exposing an allow-listed DTO.
 */
export async function readOfficialChannelPublications(): Promise<OfficialChannelPublicationReadRow[]> {
  const rows = await adminQuery<OfficialChannelPublicationReadRow[]>(
    `SELECT /*+ MAX_EXECUTION_TIME(2000) */ p.publicId AS publicId, p.snapshot AS snapshot, p.publishedAt AS publishedAt
       FROM official_channel_publications p
       INNER JOIN official_channel_stocks s ON p.stockId = s.id
       INNER JOIN official_channel_sources c ON s.sourceId = c.id
      WHERE s.status = 'published'
        AND c.active = 1
        AND c.publicationApproved = 1
      ORDER BY p.publishedAt DESC, p.publicId ASC
      LIMIT 10001`,
    [],
  );
  if (rows.length >= 10001) throw new Error("OFFICIAL_PUBLICATION_READ_CAP_EXCEEDED");
  return rows;
}
