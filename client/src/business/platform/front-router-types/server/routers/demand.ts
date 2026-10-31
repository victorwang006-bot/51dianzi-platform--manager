import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray, like, or, sql, type SQLWrapper } from "drizzle-orm";
import { crmProcedure, dataViewProcedure, previewOrQuotaProcedure, protectedProcedure, publicProcedure, quotaProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { companies, demandQuotes, demands, inventories, users } from "../../drizzle/schema";
import {
  classifyMatch,
  matchPackagingVariant,
  normalizePartNumber,
} from "../../../shared/partNumber";
import {
  resolveSupplierDisplayName,
  SUPPLIER_NAME_FALLBACK,
} from "../../../shared/supplierDisplayName";
import {
  COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  containsCompetitorDisplayName,
} from "../../../shared/competitorDisplayPolicy";
import { isVisibleDemandCategory } from "../../../shared/demandCategoryPolicy";
import { adminDbAvailable, dictCategories, dictReferencePrice } from "../adminDb";
import { resolveCrmTargetForUser } from "../services/enterpriseAccess";
import {
  DEMAND_TEXT_MAX_LENGTH,
  DemandTextRecognitionError,
  demandTextRecognitionRateLimited,
  recognizeDemandText,
} from "../services/demandTextRecognition";
import {
  issueMaterialExposureToken,
  materialExposureAudience,
  recordSuccessfulPopularSearch,
} from "../services/searchHeat";
import {
  approvedHongKongChineseNameSql,
  projectPublicCompanyName,
} from "../services/publicCompanyName";
import {
  demandPublisherIdentityConditions,
  resolveDemandPublisherIdentity,
} from "../services/demandPublisherIdentity";

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

const rowsOf = <T>(res: unknown) => (res as unknown as [T[], unknown])[0] ?? [];

function pickPublicOptionValues(rows: Array<Record<string, unknown>>, key: string) {
  return rows
    .map(row => String(row[key] ?? "").trim())
    .filter(value => Boolean(value) && !containsCompetitorDisplayName(value));
}

/**
 * 物料库品类词表缓存（1860 个品类，变动极低，缓存 30 分钟）。
 *
 * 必须缓存的原因：这是对 61 万行表的 GROUP BY 全表聚合，
 * 而 options 接口在需求中心与今日推荐每次加载都会调用，
 * 不缓存会反复扫全表，直接拖慢页面并给后台库施加无必要负载。
 */
const MATERIAL_CATEGORY_TTL = 30 * 60 * 1000;
let materialCategoryCache: {
  at: number;
  value: Array<{ name: string; count: number }>;
} | null = null;

async function getMaterialCategories(): Promise<Array<{ name: string; count: number }>> {
  if (
    materialCategoryCache &&
    Date.now() - materialCategoryCache.at < MATERIAL_CATEGORY_TTL
  ) {
    return materialCategoryCache.value;
  }
  if (!adminDbAvailable()) return [];
  try {
    const list = await dictCategories();
    materialCategoryCache = { at: Date.now(), value: list };
    return list;
  } catch (err) {
    // 后台库不可达时降级：仍返回旧缓存（如有），否则空数组，
    // 不能因为品类词表取不到就让整个需求中心不可用。
    console.error("[demand.options] 物料库品类词表读取失败:", err);
    return materialCategoryCache?.value ?? [];
  }
}

/**
 * 品类回退清单（仅当数据库无任何品类时使用）。
 *
 * 为什么不再用固定枚举校验：
 * 1. 该枚举实际上早已被绕过——生产库历史需求里存在「电源管理」「模拟器件」
 *    两个不在清单内的品类，说明 CRM 等其他入口本就在写入任意值，
 *    z.enum 只拦住了需求中心弹窗一个入口，形同虚设。
 * 2. demands.category 字段本身是 varchar(32)，数据库层无枚举约束。
 * 3. 更关键的是买卖脱节：需求侧词表（MCU/处理器、存储…）与库存侧词表
 *    （其他、微控制器、芯片IC…）零交集，按品类筛选永远匹配不到，
 *    直接损害「快速匹配供需」的核心价值。
 * 因此品类候选改为从真实数据动态汇总，校验放宽为长度约束。
 */
export const DEMAND_CATEGORY_FALLBACK = [
  "MCU/处理器",
  "存储",
  "被动件",
  "功率器件",
  "模组",
  "模拟IC",
] as const;

/** 原型交期选项（发布弹窗：3天内/1周内/2周内/1个月内/不限） */
export const DEMAND_LEAD_TIMES = [
  "3天内",
  "1周内",
  "2周内",
  "1个月内",
  "不限",
] as const;

/** 数量单位（原型：片/只/颗/套/盘） */
export const DEMAND_QTY_UNITS = ["片", "只", "颗", "套", "盘"] as const;

export const demandInputSchema = z.object({
  partNumber: z.string().min(1, "请输入需求型号").max(128),
  brand: z.string().max(64).optional().refine(
    value => !containsCompetitorDisplayName(value),
    COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  ),
  pkg: z.string().max(64).optional(),
  /**
   * 品类：与数据库 varchar(32) 对齐的长度校验，不再限定固定枚举。
   * 仍保留非空与长度上限，避免脏数据与超长写入。
   */
  category: z.string().min(1, "请选择或输入品类").max(32).refine(
    value => !containsCompetitorDisplayName(value),
    COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  ),
  qty: z.number().int().positive("需求数量须为正整数"),
  qtyUnit: z.enum(DEMAND_QTY_UNITS).default("片"),
  /** null / 不传 = 面议 */
  targetPrice: z.number().positive().optional().nullable(),
  leadTime: z.enum(DEMAND_LEAD_TIMES),
  note: z.string().max(500).optional(),
});

type EnterpriseDemandConditionColumns = {
  publisherCompanyId: SQLWrapper;
  publisherCompanyName: SQLWrapper;
  publisherCreditCode: SQLWrapper;
  publisherRegistrationRegion: SQLWrapper;
  publisherRegistrationIdentifier: SQLWrapper;
  companyId: SQLWrapper;
  companyRegistrationRegion: SQLWrapper;
  companyRegistrationIdentifier: SQLWrapper;
  companyCertLevel: SQLWrapper;
  crmAccess: SQLWrapper;
  companyReviewStatus: SQLWrapper;
};

/**
 * 公开需求必须来自已通过企业认证且 ERP 当前处于开通状态的企业账号。
 * 该条件复用于列表、候选词、库存匹配、报价和统计，避免只在页面层隐藏后仍可按 ID 访问。
 * 新的 CN/HK 快照匹配规则由 demandPublisherIdentityConditions 统一维护。
 */
export function enterpriseDemandConditions(
  columns: EnterpriseDemandConditionColumns = {
    publisherCompanyId: demands.publisherCompanyId,
    publisherCompanyName: demands.publisherCompanyName,
    publisherCreditCode: demands.publisherCreditCode,
    publisherRegistrationRegion: demands.publisherRegistrationRegion,
    publisherRegistrationIdentifier: demands.publisherRegistrationIdentifier,
    companyId: companies.id,
    companyRegistrationRegion: companies.registrationRegion,
    companyRegistrationIdentifier: companies.registrationIdentifier,
    companyCertLevel: companies.certLevel,
    crmAccess: users.crmAccess,
    companyReviewStatus: companies.reviewStatus,
  },
) {
  return [
    sql`${columns.publisherCompanyId} IS NOT NULL`,
    sql`NULLIF(TRIM(${columns.publisherCompanyName}), '') IS NOT NULL`,
    ...demandPublisherIdentityConditions(columns),
    sql`${columns.crmAccess} = 1`,
    sql`${columns.companyReviewStatus} = 'approved'`,
  ];
}

/** Raw d/u/c aliases are used by the two hand-written option queries. */
function enterpriseDemandConditionsForAliases() {
  return enterpriseDemandConditions({
    publisherCompanyId: sql.raw("d.publisherCompanyId"),
    publisherCompanyName: sql.raw("d.publisherCompanyName"),
    publisherCreditCode: sql.raw("d.publisherCreditCode"),
    publisherRegistrationRegion: sql.raw("d.publisherRegistrationRegion"),
    publisherRegistrationIdentifier: sql.raw("d.publisherRegistrationIdentifier"),
    companyId: sql.raw("c.id"),
    companyRegistrationRegion: sql.raw("c.registrationRegion"),
    companyRegistrationIdentifier: sql.raw("c.registrationIdentifier"),
    companyCertLevel: sql.raw("c.certLevel"),
    crmAccess: sql.raw("u.crmAccess"),
    companyReviewStatus: sql.raw("c.reviewStatus"),
  });
}

function demandPublisherIdentityConditionForAliases() {
  return enterpriseDemandConditionsForAliases()[2]!;
}

function demandPublisherCompanySelection() {
  return {
    companyId: companies.id,
    companyName: companies.companyName,
    creditCode: companies.creditCode,
    registrationRegion: companies.registrationRegion,
    registrationIdentifier: companies.registrationIdentifier,
    reviewStatus: companies.reviewStatus,
    certLevel: companies.certLevel,
    publicChineseName: approvedHongKongChineseNameSql({
      companyName: companies.companyName,
      registrationRegion: companies.registrationRegion,
      reviewStatus: companies.reviewStatus,
      registrationData: companies.registrationData,
      certLevel: companies.certLevel,
      reviewedAt: companies.reviewedAt,
    }),
  };
}

function resolveDemandPublisherCompany(company: {
  companyId?: unknown;
  companyName?: unknown;
  creditCode?: unknown;
  registrationRegion?: unknown;
  registrationIdentifier?: unknown;
  reviewStatus?: unknown;
  certLevel?: unknown;
  publicChineseName?: unknown;
} | undefined) {
  return resolveDemandPublisherIdentity({
    companyId: company?.companyId,
    companyName: company?.companyName,
    publisherCompanyName: projectPublicCompanyName({
      companyName: company?.companyName,
      registrationRegion: company?.registrationRegion,
      reviewStatus: company?.reviewStatus,
      certLevel: company?.certLevel,
      publicChineseName: company?.publicChineseName,
    }),
    creditCode: company?.creditCode,
    registrationRegion: company?.registrationRegion,
    registrationIdentifier: company?.registrationIdentifier,
    reviewStatus: company?.reviewStatus,
    certLevel: company?.certLevel,
  });
}

const quoteInputSchema = z.object({
  demandId: z.number().int().positive(),
  price: z.number().positive("请输入报价单价"),
  qtyAvailable: z.number().int().positive("请输入可供数量"),
  leadTime: z.string().max(32).optional(),
  note: z.string().max(500).optional(),
});

/**
 * 匿名需求列表只保留料号、品牌和“有需求”的粗粒度状态。
 * 不以零值或掩码字段伪装精确商业数据：字段本身不下发，防止客户端、日志或
 * 小程序分支重新把数量、目标价、买方身份或报价数当成公开信息使用。
 */
export function projectAnonymousDemandRows<T extends {
  partNumber: string;
  brand: string | null;
}>(rows: T[]) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const key = `${row.partNumber.normalize("NFKC").toUpperCase()}\u0000${(row.brand ?? "").normalize("NFKC").toUpperCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ partNumber: row.partNumber, brand: row.brand, availability: "有需求" as const }];
  });
}

type DemandListSort = "latest" | "qty" | "leadTime" | "quotes";

/** 匿名排序不得编码单条需求数量或收到报价数量的相对关系。 */
export function demandListSortForViewer(sort: DemandListSort, isAuthenticated: boolean): DemandListSort {
  return isAuthenticated ? sort : "latest";
}

/** 匿名首页不返回可被持续采样的需求/报价精确总数。 */
export function projectAnonymousDemandStats() {
  return { availability: "有需求" as const };
}

export const demandRouter = router({
  /**
   * 浏览列表首屏只需要当前公开需求实际使用的品类和品牌。
   * 不读取 34 万库存和 61 万物料词表，避免它与 auth.me 被批处理时阻塞需求行返回。
   * 完整发布候选仍由 options 提供，并仅在打开发布弹窗时加载。
   */
  listOptions: dataViewProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        categories: [...DEMAND_CATEGORY_FALLBACK],
        frontCategoryCount: DEMAND_CATEGORY_FALLBACK.length,
        brands: [] as string[],
        leadTimes: DEMAND_LEAD_TIMES,
        qtyUnits: DEMAND_QTY_UNITS,
      };
    }

    const [demandCats, demandBrands] = await Promise.all([
      db.execute(
        sql`SELECT DISTINCT d.category
            FROM demands d
            INNER JOIN users u ON u.id = d.userId
            INNER JOIN companies c ON c.userId = d.userId
            WHERE d.category IS NOT NULL AND d.category <> ''
              AND d.status = 'open'
              AND d.publisherCompanyId IS NOT NULL
              AND NULLIF(TRIM(d.publisherCompanyName), '') IS NOT NULL
              AND ${demandPublisherIdentityConditionForAliases()}
              AND u.crmAccess = 1 AND c.reviewStatus = 'approved'
            ORDER BY d.category`
      ),
      db.execute(
        sql`SELECT DISTINCT d.brand
            FROM demands d
            INNER JOIN users u ON u.id = d.userId
            INNER JOIN companies c ON c.userId = d.userId
            WHERE d.brand IS NOT NULL AND d.brand <> ''
              AND d.status = 'open'
              AND d.publisherCompanyId IS NOT NULL
              AND NULLIF(TRIM(d.publisherCompanyName), '') IS NOT NULL
              AND ${demandPublisherIdentityConditionForAliases()}
              AND u.crmAccess = 1 AND c.reviewStatus = 'approved'
            ORDER BY d.brand`
      ),
    ]);
    const categories = pickPublicOptionValues(
      rowsOf<Record<string, unknown>>(demandCats),
      "category",
    ).filter(isVisibleDemandCategory);
    const brands = pickPublicOptionValues(
      rowsOf<Record<string, unknown>>(demandBrands),
      "brand",
    );

    return {
      categories: categories.length ? categories : [...DEMAND_CATEGORY_FALLBACK],
      frontCategoryCount: categories.length,
      brands,
      leadTimes: DEMAND_LEAD_TIMES,
      qtyUnits: DEMAND_QTY_UNITS,
    };
  }),

  /**
   * 筛选/发布弹窗的候选项。
   *
   * 品类与品牌均从真实数据动态汇总，不再硬编码：
   * - 品类：库存表实际品类 ∪ 已发布需求品类（两侧词表零交集，
   *   必须合并展示，否则买家选不到卖家实际在用的品类）
   * - 品牌：已发布需求中实际出现的品牌，避免选了却零结果
   */
  options: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      // 数据库不可用时降级返回回退清单，保证发布弹窗仍可用
      return {
        categories: [...DEMAND_CATEGORY_FALLBACK],
        frontCategoryCount: DEMAND_CATEGORY_FALLBACK.length,
        brands: [] as string[],
        leadTimes: DEMAND_LEAD_TIMES,
        qtyUnits: DEMAND_QTY_UNITS,
      };
    }
    const [inventoryCats, demandCats, demandBrands, materialCats] = await Promise.all([
      db.execute(
        sql`SELECT DISTINCT category FROM inventories WHERE category IS NOT NULL AND category <> '' ORDER BY category`
      ),
      db.execute(
        sql`SELECT DISTINCT d.category
            FROM demands d
            INNER JOIN users u ON u.id = d.userId
            INNER JOIN companies c ON c.userId = d.userId
            WHERE d.category IS NOT NULL AND d.category <> ''
              AND d.publisherCompanyId IS NOT NULL
              AND NULLIF(TRIM(d.publisherCompanyName), '') IS NOT NULL
              AND ${demandPublisherIdentityConditionForAliases()}
              AND u.crmAccess = 1 AND c.reviewStatus = 'approved'
            ORDER BY d.category`
      ),
      db.execute(
        sql`SELECT DISTINCT d.brand
            FROM demands d
            INNER JOIN users u ON u.id = d.userId
            INNER JOIN companies c ON c.userId = d.userId
            WHERE d.brand IS NOT NULL AND d.brand <> ''
              AND d.publisherCompanyId IS NOT NULL
              AND NULLIF(TRIM(d.publisherCompanyName), '') IS NOT NULL
              AND ${demandPublisherIdentityConditionForAliases()}
              AND u.crmAccess = 1 AND c.reviewStatus = 'approved'
            ORDER BY d.brand`
      ),
      /*
       * 品类以物料库（61 万条）为唯一标准。后台库不可用时降级为空数组，
       * 不影响发布与筛选（仍有前台在用品类作候选）。
       */
      getMaterialCategories(),
    ]);
    const pickCategories = (rows: Array<Record<string, unknown>>, key: string) =>
      pickPublicOptionValues(rows, key).filter(isVisibleDemandCategory);

    /*
     * 候选排序策略：前台在用品类优先（排前），其后接物料库品类按物料数降序。
     *
     * 为何必须保留前台在用品类：生产实测 12 个前台品类中只有 4 个能在物料库
     * 找到（其他/NAND FLASH/电源管理/传感器）。若仅用物料库词表，
     * 464 条「微控制器」库存与 3 条「MCU/处理器」需求会筛不出来——
     * 用户在下拉里找不到这些品类，货等于静默消失。
     */
    const frontCats = Array.from(
      new Set([
        ...pickCategories(rowsOf<Record<string, unknown>>(inventoryCats), "category"),
        ...pickCategories(rowsOf<Record<string, unknown>>(demandCats), "category"),
      ])
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const frontSet = new Set(frontCats);
    const materialOnly = materialCats
      .map(c => c.name)
      .filter(name => name && isVisibleDemandCategory(name) && !frontSet.has(name));
    const categories = [...frontCats, ...materialOnly];

    return {
      categories: categories.length ? categories : [...DEMAND_CATEGORY_FALLBACK],
      /** 前台真实使用品类数量；前端仅用于保持高频候选在前，不显示内部来源标签。 */
      frontCategoryCount: frontCats.length,
      brands: pickPublicOptionValues(rowsOf<Record<string, unknown>>(demandBrands), "brand").sort(
        (a, b) => a.localeCompare(b, "zh-CN")
      ),
      leadTimes: DEMAND_LEAD_TIMES,
      qtyUnits: DEMAND_QTY_UNITS,
    };
  }),

  /**
   * 需求撑合：查找站内匹配该需求型号的在售库存。
   *
   * 为何不用品类撑合：生产库实测卖家库存 90%（4927/5454）品类填「其他」，
   * 且买卖两侧品类词表零交集，按品类匹配永远匹不到。型号才是钥匙。
   *
   * 分层返回：
   * - exact：归一化后完全相等（大写化 + 去分隔符），可直接报价
   * - packaging：同料不同包装（尾缀在包装白名单内），需人工核对规格书
   *
   * 不做前缀泛匹配：前缀相同不代表同料（如 STM32F103C8T6 vs T7 是不同
   * 温度等级），推错料会导致整批物料报废，代价远高于漏单。
   */
  matchedInventory: quotaProcedure
    .input(z.object({ demandId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { exact: [], packaging: [] };

      const demandRows = await db
        .select({ partNumber: demands.partNumber })
        .from(demands)
        .innerJoin(users, eq(users.id, demands.userId))
        .innerJoin(companies, eq(companies.userId, demands.userId))
        .where(and(eq(demands.id, input.demandId), ...enterpriseDemandConditions()))
        .limit(1);
      const target = demandRows[0]?.partNumber?.trim();
      if (!target) return { exact: [], packaging: [] };

      const normalizedTarget = normalizePartNumber(target);

      /*
       * 候选集策略：SQL 层做粗筛，应用层用归一化规则精判。
       *
       * 粗筛前缀取完整归一化型号的前 10 位（或全长，取较小者）。
       * 生产库实测：取前 6 位时 STM32F 会命中 465 条候选而精确匹配为 0，
       * 接近 limit 上限——一旦某前缀命中超过 limit，真正匹配的记录可能被
       * 截断掉，造成「明明有货却匹配不到」的静默漏单。加长前缀后
       * STM32F103C8 只会命中个位数候选。
       *
       * 同时保留 OR 归一化全等：当目标型号本身带包装后缀（如查
       * ...KT/R 而库存是 ...K）时，前缀方向相反，仅靠前缀会漏掉，
       * 故额外用短前缀兼容反方向匹配。
       */
      const coarsePrefix = normalizedTarget.slice(0, 10);
      const normalizedCol = sql`REPLACE(REPLACE(REPLACE(UPPER(${inventories.partNumber}),'-',''),' ',''),'_','')`;
      const CANDIDATE_LIMIT = 2000;
      const candidates = await db
        .select({
          id: inventories.id,
          partNumber: inventories.partNumber,
          brand: inventories.brand,
          pkg: inventories.pkg,
          qtyOnSale: inventories.qtyOnSale,
          priceEx: inventories.priceEx,
          taxIncluded: inventories.taxIncluded,
          leadTime: inventories.leadTime,
          supplierId: inventories.userId,
        })
        .from(inventories)
        .where(
          and(
            // 枚举为 draft | published | offshelf，在售对应 published
            eq(inventories.status, "published"),
            or(
              // 正向：库存型号以目标前缀开头（覆盖精确 + 库存带包装后缀）
              sql`${normalizedCol} LIKE ${`${coarsePrefix}%`}`,
              // 反向：目标型号带包装后缀而库存是基础型号
              sql`${normalizedTarget} LIKE CONCAT(${normalizedCol}, '%')`
            )
          )
        )
        .limit(CANDIDATE_LIMIT);

      if (candidates.length >= CANDIDATE_LIMIT) {
        // 触顶意味着可能有真实匹配被截断，必须留下痕迹以便定位漏单
        console.warn(
          `[demand.matchedInventory] 候选集触顶 ${CANDIDATE_LIMIT}，型号=${target}，可能存在漏单`
        );
      }

      const exact: typeof candidates = [];
      const packaging: Array<(typeof candidates)[number] & { suffix: string }> = [];
      for (const row of candidates) {
        const tier = classifyMatch(target, row.partNumber);
        if (tier === "exact") {
          exact.push(row);
        } else if (tier === "packaging") {
          const suffix =
            matchPackagingVariant(target, row.partNumber) ??
            matchPackagingVariant(row.partNumber, target) ??
            "";
          packaging.push({ ...row, suffix });
        }
      }

      // 附带卖家展示名（优先企业名），与平台其他列表保持一致
      const allRows = [...exact, ...packaging];
      const supplierIds = Array.from(new Set(allRows.map(r => r.supplierId)));
      const nameMap = new Map<number, string>();
      if (supplierIds.length) {
        const [userRows, companyRows] = await Promise.all([
          db
            .select({ id: users.id, name: users.name, username: users.username })
            .from(users)
            .where(inArray(users.id, supplierIds)),
          db
            .select({ userId: companies.userId, companyName: companies.companyName })
            .from(companies)
            .where(inArray(companies.userId, supplierIds)),
        ]);
        /* 供应商名统一口径（见 shared/supplierDisplayName.ts）：自营主体需显示「51电子网自营」，
           早期此处直接用企业名覆盖，自营库存会露出工商注册名。 */
        const companyNameByUserId = new Map(
          companyRows.map(c => [c.userId, c.companyName]),
        );
        for (const u of userRows) {
          nameMap.set(
            u.id,
            resolveSupplierDisplayName({
              companyName: companyNameByUserId.get(u.id),
              userName: u.name,
              username: u.username,
            }),
          );
        }
        /* 卖家可能只有 companies 记录而 users 行缺失（历史脏数据），补上避免漏名。 */
        for (const c of companyRows) {
          if (!nameMap.has(c.userId)) {
            nameMap.set(c.userId, resolveSupplierDisplayName({ companyName: c.companyName }));
          }
        }
      }
      const decorate = <T extends { supplierId: number }>(rows: T[]) =>
        rows.map(r => ({
          ...r,
          supplierName: nameMap.get(r.supplierId) ?? SUPPLIER_NAME_FALLBACK,
        }));

      return {
        exact: decorate(exact),
        packaging: decorate(packaging),
      };
    }),

  /**
   * 当前账号的企业需求发布资格。crmProcedure 会实时向后台确认 ERP 权限，
   * 成功即表示可发布；失败错误直接作为前端引导文案，不能由浏览器伪造。
   */
  publishEligibility: crmProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const company = (
      await db
        .select(demandPublisherCompanySelection())
        .from(companies)
        .where(eq(companies.userId, ctx.effectiveUserId))
        .limit(1)
    )[0];
    const publisher = resolveDemandPublisherCompany(company);
    if (!publisher.ok) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: publisher.message });
    }
    return {
      allowed: true as const,
      companyName: publisher.identity.publisherCompanyName,
      // HK identity is a namespaced BRN, never a fabricated CN credit code.
      creditCode: publisher.identity.publisherCreditCode ?? "",
      region: publisher.identity.publisherRegistrationRegion,
      identifier: publisher.identity.publisherRegistrationIdentifier,
    };
  }),

  /**
   * 将微信、邮件或询价文字识别为需求表单建议值。
   * 只返回建议，不直接写库；用户确认后仍通过 publish 的企业门禁与字段校验。
   */
  recognizeText: crmProcedure
    .input(z.object({ text: z.string().trim().min(2, "请粘贴需要识别的采购需求文字").max(DEMAND_TEXT_MAX_LENGTH) }))
    .mutation(async ({ ctx, input }) => {
      if (demandTextRecognitionRateLimited(ctx.user.id)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "智能识别使用过于频繁，请稍后再试" });
      }
      try {
        return await recognizeDemandText(input.text);
      } catch (error) {
        if (error instanceof DemandTextRecognitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        console.error("[demand.recognizeText] 识别失败:", error instanceof Error ? error.message : String(error));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "需求文字识别失败，请稍后重试或手工填写" });
      }
    }),

  /** 发布需求（CRM 发布需求页 / 需求中心页发布弹窗共用） */
  publish: crmProcedure
    .input(demandInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const company = (
        await db
          .select(demandPublisherCompanySelection())
          .from(companies)
          .where(eq(companies.userId, ctx.effectiveUserId))
          .limit(1)
      )[0];
      const publisher = resolveDemandPublisherCompany(company);
      if (!publisher.ok) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: publisher.message });
      }
      const inserted = await db.insert(demands).values({
        userId: ctx.effectiveUserId,
        publisherCompanyId: publisher.identity.publisherCompanyId,
        publisherCompanyName: publisher.identity.publisherCompanyName,
        publisherCreditCode: publisher.identity.publisherCreditCode,
        publisherRegistrationRegion: publisher.identity.publisherRegistrationRegion,
        publisherRegistrationIdentifier: publisher.identity.publisherRegistrationIdentifier,
        partNumber: input.partNumber.trim(),
        brand: input.brand?.trim() || null,
        pkg: input.pkg?.trim() || null,
        category: input.category,
        qty: input.qty,
        qtyUnit: input.qtyUnit,
        targetPrice:
          input.targetPrice == null ? null : String(input.targetPrice),
        leadTime: input.leadTime,
        note: input.note?.trim() || null,
      }).$returningId();
      const demandId = Number(inserted[0]?.id ?? 0);
      try {
        const validatedModel = adminDbAvailable()
          ? await dictReferencePrice(input.partNumber)
          : null;
        if (validatedModel && demandId > 0) {
          await recordSuccessfulPopularSearch({
            action: { eventId: `demand-${demandId}`, source: "demand_center" },
            keyword: validatedModel.partNumber,
            req: ctx.req,
            viewerUserId: ctx.effectiveUserId,
          });
        }
      } catch (error) {
        // 统计失败不得回滚已经成功发布的采购需求。
        console.error("[demand.publish] purchase-intent heat record failed:", error);
      }
      return { success: true } as const;
    }),

  /** 需求中心公开列表（原型：筛选品类/交期/排序/搜索 + 分页） */
  list: previewOrQuotaProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          brand: z.string().optional(),
          leadTime: z.string().optional(),
          keyword: z.string().optional(),
          sort: z
            .enum(["latest", "qty", "leadTime", "quotes"])
            .default("latest"),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(50).default(8),
        })
        .default({ sort: "latest", page: 1, pageSize: 8 })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user && /[\\%_]/.test(input.keyword ?? "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请输入具体型号或品牌" });
      }
      const db = await requireDb();
      const conds = [eq(demands.status, "open"), ...enterpriseDemandConditions()];
      if (input.category && input.category !== "全部")
        conds.push(eq(demands.category, input.category));
      if (input.brand && input.brand !== "全部")
        conds.push(eq(demands.brand, input.brand));
      if (input.leadTime && input.leadTime !== "不限")
        conds.push(eq(demands.leadTime, input.leadTime));
      if (input.keyword?.trim()) {
        const kw = `%${input.keyword.trim()}%`;
        conds.push(
          or(like(demands.partNumber, kw), like(demands.brand, kw))!
        );
      }
      const where = and(...conds);

      const totalRows = ctx.user ? await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(demands)
        .innerJoin(users, eq(users.id, demands.userId))
        .innerJoin(companies, eq(companies.userId, demands.userId))
        .where(where) : [];
      const total = Number(totalRows[0]?.cnt ?? 0);

      /** 报价数子查询 */
      const quoteCountSql = sql<number>`(SELECT COUNT(*) FROM demand_quotes dq WHERE dq.demandId = \`demands\`.\`id\`)`;

      // qty 与报价数排序本身会泄露相邻记录的相对商业规模；匿名请求一律按最新发布。
      const sort = demandListSortForViewer(input.sort, Boolean(ctx.user));
      let orderBy;
      switch (sort) {
        case "qty":
          orderBy = desc(demands.qty);
          break;
        case "leadTime":
          /** 交期最急：3天内 < 1周内 < 2周内 < 1个月内 < 不限 */
          orderBy = sql`FIELD(${demands.leadTime}, '3天内', '1周内', '2周内', '1个月内', '不限')`;
          break;
        case "quotes":
          /** 报价最少优先（更容易抢单） */
          orderBy = sql`(SELECT COUNT(*) FROM demand_quotes dq WHERE dq.demandId = \`demands\`.\`id\`) ASC`;
          break;
        default:
          orderBy = desc(demands.createdAt);
      }

      const rows = await db
        .select({
          id: demands.id,
          userId: demands.userId,
          partNumber: demands.partNumber,
          brand: demands.brand,
          pkg: demands.pkg,
          category: demands.category,
          qty: demands.qty,
          qtyUnit: demands.qtyUnit,
          targetPrice: demands.targetPrice,
          leadTime: demands.leadTime,
          note: demands.note,
          status: demands.status,
          createdAt: demands.createdAt,
          buyerName: demands.publisherCompanyName,
          quoteCount: quoteCountSql,
        })
        .from(demands)
        .innerJoin(users, eq(users.id, demands.userId))
        .innerJoin(companies, eq(companies.userId, demands.userId))
        .where(where)
        .orderBy(orderBy)
        .limit(ctx.user ? input.pageSize : 10)
        .offset(ctx.user ? (input.page - 1) * input.pageSize : 0);

      const authenticatedRows = rows.map(row => ({
          ...row,
          buyerName: row.buyerName || "企业采购方",
          buyerCity: "",
        }));
      const responseRows = ctx.user
        ? authenticatedRows
        : projectAnonymousDemandRows(rows) as unknown as typeof authenticatedRows;

      const response = {
        rows: responseRows,
        exposureToken: ctx.user
          ? issueMaterialExposureToken(
              rows.map(row => row.partNumber),
              "demand_center",
              materialExposureAudience(ctx.req, ctx.user.id),
            )
          : null,
      };
      // Keep anonymous list pagination opaque: exact result counts reveal commercial activity at scale.
      return ctx.user ? { ...response, total } : response as unknown as typeof response & { total: number };
    }),

  /** 我发布的需求（CRM 发布需求页下方列表 / 需求中心"我的需求"） */
  myDemands: crmProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const quoteCountSql = sql<number>`(SELECT COUNT(*) FROM demand_quotes dq WHERE dq.demandId = \`demands\`.\`id\`)`;
    const rows = await db
      .select({
        id: demands.id,
        userId: demands.userId,
        partNumber: demands.partNumber,
        brand: demands.brand,
        pkg: demands.pkg,
        category: demands.category,
        qty: demands.qty,
        qtyUnit: demands.qtyUnit,
        targetPrice: demands.targetPrice,
        leadTime: demands.leadTime,
        note: demands.note,
        status: demands.status,
        createdAt: demands.createdAt,
        quoteCount: quoteCountSql,
      })
      .from(demands)
      .where(and(
        eq(demands.userId, ctx.effectiveUserId),
        sql`${demands.publisherCompanyId} IS NOT NULL`,
      ))
      .orderBy(desc(demands.createdAt));
    return rows;
  }),

  /** 关闭需求（发布人操作） */
  close: crmProcedure
    .input(z.object({ demandId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          id: demands.id,
          userId: demands.userId,
          publisherCompanyId: demands.publisherCompanyId,
        })
        .from(demands)
        .where(eq(demands.id, input.demandId))
        .limit(1);
      if (!rows[0] || !rows[0].publisherCompanyId)
        throw new TRPCError({ code: "NOT_FOUND", message: "企业需求不存在" });
      if (rows[0].userId !== ctx.effectiveUserId)
        throw new TRPCError({ code: "FORBIDDEN", message: "只能关闭本企业发布的需求" });
      await db
        .update(demands)
        .set({ status: "closed" })
        .where(eq(demands.id, input.demandId));
      return { success: true } as const;
    }),

  /** 我要报价（供应商对需求报价） */
  quote: protectedProcedure
    .input(quoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select({ id: demands.id, userId: demands.userId, status: demands.status })
        .from(demands)
        .innerJoin(users, eq(users.id, demands.userId))
        .innerJoin(companies, eq(companies.userId, demands.userId))
        .where(and(eq(demands.id, input.demandId), ...enterpriseDemandConditions()))
        .limit(1);
      if (!rows[0])
        throw new TRPCError({ code: "NOT_FOUND", message: "需求不存在" });
      if (rows[0].status !== "open")
        throw new TRPCError({ code: "BAD_REQUEST", message: "该需求已关闭，无法报价" });
      const supplierEnterprise = await resolveCrmTargetForUser(ctx.user.id);
      if (rows[0].userId === supplierEnterprise.dataOwnerUserId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能对本企业发布的需求报价" });
      await db.insert(demandQuotes).values({
        demandId: input.demandId,
        supplierId: ctx.user.id,
        price: String(input.price),
        qtyAvailable: input.qtyAvailable,
        leadTime: input.leadTime?.trim() || null,
        note: input.note?.trim() || null,
      });
      return { success: true } as const;
    }),

  /** 收到的报价（我发布的需求收到的全部报价，含报价方信息，支持聊一聊） */
  receivedQuotes: crmProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: demandQuotes.id,
        demandId: demandQuotes.demandId,
        supplierId: demandQuotes.supplierId,
        price: demandQuotes.price,
        qtyAvailable: demandQuotes.qtyAvailable,
        leadTime: demandQuotes.leadTime,
        note: demandQuotes.note,
        createdAt: demandQuotes.createdAt,
        partNumber: demands.partNumber,
        brand: demands.brand,
        category: demands.category,
        demandQty: demands.qty,
        demandQtyUnit: demands.qtyUnit,
        targetPrice: demands.targetPrice,
        demandStatus: demands.status,
      })
      .from(demandQuotes)
      .innerJoin(demands, eq(demandQuotes.demandId, demands.id))
      .where(and(
        eq(demands.userId, ctx.effectiveUserId),
        sql`${demands.publisherCompanyId} IS NOT NULL`,
      ))
      .orderBy(desc(demandQuotes.createdAt));

    if (rows.length === 0) return [];
    /** 附加报价方展示名（企业名优先） */
    const supplierIds = Array.from(new Set(rows.map(r => r.supplierId)));
    const userRows = await db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(inArray(users.id, supplierIds));
    const companyRows = await db
      .select({ userId: companies.userId, companyName: companies.companyName })
      .from(companies)
      .where(inArray(companies.userId, supplierIds));
    const userMap = new Map(userRows.map(u => [u.id, u]));
    const companyMap = new Map(companyRows.map(c => [c.userId, c]));
    return rows.map(r => ({
      ...r,
      /* 供应商名统一口径（见 shared/supplierDisplayName.ts）；兜底文案不再各处自写。 */
      supplierName: resolveSupplierDisplayName({
        companyName: companyMap.get(r.supplierId)?.companyName,
        userName: userMap.get(r.supplierId)?.name,
        username: userMap.get(r.supplierId)?.username,
      }),
    }));
  }),

  /** 我发出的报价（供应商查看自己的报价记录） */
  myQuotes: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: demandQuotes.id,
        demandId: demandQuotes.demandId,
        price: demandQuotes.price,
        qtyAvailable: demandQuotes.qtyAvailable,
        leadTime: demandQuotes.leadTime,
        note: demandQuotes.note,
        createdAt: demandQuotes.createdAt,
        partNumber: demands.partNumber,
        brand: demands.brand,
        demandUserId: demands.userId,
        demandStatus: demands.status,
      })
      .from(demandQuotes)
      .innerJoin(demands, eq(demandQuotes.demandId, demands.id))
      .innerJoin(users, eq(users.id, demands.userId))
      .innerJoin(companies, eq(companies.userId, demands.userId))
      .where(and(
        eq(demandQuotes.supplierId, ctx.user.id),
        ...enterpriseDemandConditions(),
      ))
      .orderBy(desc(demandQuotes.createdAt));
    return rows;
  }),

  /** 平台统计（原型页头："10万+ 认证供应商在线报价，平均 18分钟 获得首个报价"下方数字） */
  stats: previewOrQuotaProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return projectAnonymousDemandStats() as unknown as {
        totalDemands: number;
        totalQuotes: number;
      };
    }
    const db = await requireDb();
    const demandCnt = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(demands)
      .innerJoin(users, eq(users.id, demands.userId))
      .innerJoin(companies, eq(companies.userId, demands.userId))
      .where(and(...enterpriseDemandConditions()));
    const quoteCnt = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(demandQuotes)
      .innerJoin(demands, eq(demands.id, demandQuotes.demandId))
      .innerJoin(users, eq(users.id, demands.userId))
      .innerJoin(companies, eq(companies.userId, demands.userId))
      .where(and(...enterpriseDemandConditions()));
    return {
      totalDemands: Number(demandCnt[0]?.cnt ?? 0),
      totalQuotes: Number(quoteCnt[0]?.cnt ?? 0),
    };
  }),
});
