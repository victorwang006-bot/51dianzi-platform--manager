import { and, asc, desc, eq, gte, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  adminUsers,
  adminUserSalesScopes,
  auditLogs,
  crmOwnerRebindLogs,
  exceptionLogs,
  InsertMaterial,
  InsertUser,
  materialNumberSequences,
  materials,
  merchants,
  messages,
  messageThreads,
  passwordResetCodes,
  salesStaff,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  formatMaterialNo,
  PLATFORM_MATERIAL_SEQUENCE_KEY,
} from "./materialCode";
import { getBeijingDateParts } from "../shared/beijingTime";
import {
  expandShortPartNumber,
  isPackageSuffixExpansion,
} from "../shared/partNumberFallback";
import {
  LOG_RETENTION_DAYS,
  type ExceptionCategory,
  type ExceptionSeverity,
} from "../shared/exceptionRules";
import {
  assertMerchantCrmStatusTransition,
  crmStatusAction,
  decideMerchantCrmGrant,
  isEquivalentEnabledBinding,
  normalizeCrmPortalUserId,
  type MerchantCrmStatus,
} from "./crmGrantPolicy";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** 兼容 TiDB 返回对象与 MariaDB 返回 JSON 字符串的差异。 */
function decodeJsonValue<T>(value: unknown, fallback: T | null = null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeMaterialJson<T extends object>(row: T): T {
  const normalized = { ...row } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(normalized, "specs")) {
    normalized.specs = decodeJsonValue<Record<string, string>>(normalized.specs);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "images")) {
    normalized.images = decodeJsonValue<{ url: string; key: string; name?: string }[]>(normalized.images);
  }
  return normalized as T;
}

function normalizeMessageThreadJson<T extends object>(row: T): T {
  const normalized = { ...row } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(normalized, "companyProfile")) {
    normalized.companyProfile = decodeJsonValue<Record<string, string | null>>(normalized.companyProfile);
  }
  return normalized as T;
}

function normalizeCreditCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizePortalUserId(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const CRM_COMPANY_ALREADY_ENABLED_MESSAGE = "该公司已经开通ERP,请联系管理员";

export function getCrmCompanyConflictMessage(
  crmStatus: string,
  fallbackMessage: string,
) {
  if (crmStatus === "pending") return "该企业的 ERP 开通申请正在审核中";
  if (crmStatus === "enabled") return CRM_COMPANY_ALREADY_ENABLED_MESSAGE;
  return fallbackMessage;
}

export type MaterialAuditActor = {
  operatorId?: number | null;
  operatorName?: string | null;
  operatorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type MaterialMutationAudit = MaterialAuditActor & {
  action?: string;
  note?: string | null;
};

// ─── 用户 ─────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── 物料数据库 ───────────────────────────────────────────────────────────────

export async function getMaterials(params: {
  search?: string;
  category?: string;
  brand?: string;
  lifecycle?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { search, category, brand, lifecycle, status, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (search) {
    conditions.push(
      or(
        like(materials.partNumber, `%${search}%`),
        like(materials.name, `%${search}%`),
        like(materials.materialNo, `%${search}%`),
        like(materials.brand, `%${search}%`),
        sql`EXISTS (
          SELECT 1
          FROM material_code_aliases AS material_alias
          WHERE material_alias.materialId = ${materials.id}
            AND material_alias.aliasCode LIKE ${`%${search}%`}
        )`,
      ),
    );
  }
  if (category) conditions.push(eq(materials.category, category));
  if (brand) conditions.push(eq(materials.brand, brand));
  if (lifecycle) conditions.push(eq(materials.lifecycle, lifecycle as any));
  if (status) conditions.push(eq(materials.status, status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(materials).where(where);
  const data = await db
    .select()
    .from(materials)
    .where(where)
    .orderBy(desc(materials.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { data: data.map(normalizeMaterialJson), total: Number(count) };
}

export async function getMaterialById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(materials).where(eq(materials.id, id)).limit(1);
  return result[0] ? normalizeMaterialJson(result[0]) : null;
}

export async function getMaterialCategories() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ category: materials.category })
    .from(materials)
    .where(sql`${materials.category} IS NOT NULL AND ${materials.category} != ''`);
  return rows.map(r => r.category).filter(Boolean) as string[];
}

export async function getMaterialBrands() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ brand: materials.brand })
    .from(materials)
    .where(sql`${materials.brand} IS NOT NULL AND ${materials.brand} != ''`);
  return rows.map(r => r.brand).filter(Boolean) as string[];
}

/**
 * 型号模糊搜索（公开 API，供前台商户上传商品时输入型号触发）
 * 返回匹配的候选列表，最多 20 条，仅返回 enabled 状态的物料
 */
export async function lookupMaterials(keyword: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: materials.id,
      materialNo: materials.materialNo,
      partNumber: materials.partNumber,
      name: materials.name,
      brand: materials.brand,
      category: materials.category,
      package: materials.package,
      coverImageUrl: materials.coverImageUrl,
    })
    .from(materials)
    .where(
      and(
        eq(materials.status, "enabled"),
        or(
          like(materials.materialNo, `%${keyword}%`),
          like(materials.partNumber, `%${keyword}%`),
          like(materials.name, `%${keyword}%`),
          like(materials.brand, `%${keyword}%`),
          sql`EXISTS (
            SELECT 1
            FROM material_code_aliases AS material_alias
            WHERE material_alias.materialId = ${materials.id}
              AND material_alias.aliasCode LIKE ${`%${keyword}%`}
          )`,
        ),
      ),
    )
    .orderBy(materials.partNumber)
    .limit(20);
  return rows;
}

/**
 * 获取指定型号的完整参数（公开 API，供前台搜索结果页展示参数）
 * 按制造商型号、正式平台码或历史旧码精确匹配，返回统一主档。
 */
export async function getMaterialSpecsByPartNumber(partNumber: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
      materialNo: materials.materialNo,
      partNumber: materials.partNumber,
      name: materials.name,
      brand: materials.brand,
      category: materials.category,
      package: materials.package,
      description: materials.description,
      specs: materials.specs,
      datasheetUrl: materials.datasheetUrl,
      datasheetFileKey: materials.datasheetFileKey,
      datasheetFileName: materials.datasheetFileName,
      coverImageUrl: materials.coverImageUrl,
      images: materials.images,
      lifecycle: materials.lifecycle,
      rohs: materials.rohs,
    })
    .from(materials)
    .where(
      and(
        eq(materials.status, "enabled"),
        or(
          sql`UPPER(${materials.partNumber}) = UPPER(${partNumber.trim()})`,
          sql`UPPER(${materials.materialNo}) = UPPER(${partNumber.trim()})`,
          sql`EXISTS (
            SELECT 1
            FROM material_code_aliases AS material_alias
            WHERE material_alias.materialId = ${materials.id}
              AND UPPER(material_alias.aliasCode) = UPPER(${partNumber.trim()})
          )`,
        ),
      ),
    )
    .limit(1);
  return result[0] ? normalizeMaterialJson(result[0]) : null;
}

/**
 * 前台综合搜索（公开 API）：按关键词 + 分类/品牌 + 参数值筛选，分页返回
 * 返回参数、封面图、图集与 PDF 规格书 URL，供前台搜索结果页与详情页直接调用
 */
export async function searchMaterialsPublic(params: {
  keyword?: string;
  category?: string;
  brand?: string;
  /** 参数筛选：如 { "CPU内核": "ARM Cortex-M0+" }，基于 specs JSON 匹配 */
  specFilters?: Record<string, string>;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { keyword, category, brand, specFilters, page = 1, pageSize = 20 } = params;
  const conditions = [eq(materials.status, "enabled")];
  if (keyword) {
    conditions.push(
      or(
        like(materials.materialNo, `%${keyword}%`),
        like(materials.partNumber, `%${keyword}%`),
        like(materials.name, `%${keyword}%`),
        like(materials.brand, `%${keyword}%`),
        like(materials.description, `%${keyword}%`),
        sql`EXISTS (
          SELECT 1
          FROM material_code_aliases AS material_alias
          WHERE material_alias.materialId = ${materials.id}
            AND material_alias.aliasCode LIKE ${`%${keyword}%`}
        )`,
      )!,
    );
  }
  if (category) conditions.push(eq(materials.category, category));
  if (brand) conditions.push(eq(materials.brand, brand));
  if (specFilters) {
    for (const [key, value] of Object.entries(specFilters)) {
      // JSON_EXTRACT 按键取值后模糊匹配，键名通过 JSON_QUOTE 防注入
      conditions.push(
        sql`JSON_UNQUOTE(JSON_EXTRACT(${materials.specs}, CONCAT('$.', JSON_QUOTE(${key})))) LIKE ${`%${value}%`}`,
      );
    }
  }
  const where = and(...conditions);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(materials).where(where);
  const data = await db
    .select({
      id: materials.id,
      materialNo: materials.materialNo,
      partNumber: materials.partNumber,
      name: materials.name,
      brand: materials.brand,
      category: materials.category,
      package: materials.package,
      description: materials.description,
      specs: materials.specs,
      coverImageUrl: materials.coverImageUrl,
      images: materials.images,
      datasheetUrl: materials.datasheetUrl,
      datasheetFileKey: materials.datasheetFileKey,
      datasheetFileName: materials.datasheetFileName,
      lifecycle: materials.lifecycle,
      rohs: materials.rohs,
    })
    .from(materials)
    .where(where)
    .orderBy(materials.partNumber)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { data: data.map(normalizeMaterialJson), total: Number(count) };
}

export async function createMaterial(
  data: Omit<InsertMaterial, "materialNo">,
  actor: MaterialAuditActor = {},
) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  return db.transaction(async tx => {
    // 新库自动从 1 起步；生产迁移会把 nextValue 初始化为历史物料数 + 1。
    await tx
      .insert(materialNumberSequences)
      .values({ sequenceKey: PLATFORM_MATERIAL_SEQUENCE_KEY, nextValue: 1 })
      .onDuplicateKeyUpdate({ set: { sequenceKey: PLATFORM_MATERIAL_SEQUENCE_KEY } });

    const [sequenceRow] = await tx
      .select({ nextValue: materialNumberSequences.nextValue })
      .from(materialNumberSequences)
      .where(eq(materialNumberSequences.sequenceKey, PLATFORM_MATERIAL_SEQUENCE_KEY))
      .for("update");
    if (!sequenceRow) throw new Error("MATERIAL_SEQUENCE_NOT_INITIALIZED");

    const materialNo = formatMaterialNo(sequenceRow.nextValue);
    await tx
      .update(materialNumberSequences)
      .set({ nextValue: sequenceRow.nextValue + 1 })
      .where(eq(materialNumberSequences.sequenceKey, PLATFORM_MATERIAL_SEQUENCE_KEY));

    await tx.insert(materials).values({ ...data, materialNo });
    const result = await tx.select().from(materials).where(eq(materials.materialNo, materialNo)).limit(1);
    const material = result[0] ?? null;
    if (material) {
      await tx.insert(auditLogs).values({
        operatorId: actor.operatorId ?? null,
        operatorName: actor.operatorName ?? "system",
        operatorRole: actor.operatorRole ?? "system",
        action: "material.create",
        module: "materials",
        targetType: "material",
        targetId: String(material.id),
        beforeValue: null,
        afterValue: material,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        result: "success",
        note: "平台物料码由全局序列自动分配，分配后不可修改或复用",
      });
    }
    return material;
  });
}

export async function updateMaterial(
  id: number,
  data: Partial<InsertMaterial>,
  audit: MaterialMutationAudit = {},
) {
  const db = await getDb();
  if (!db) return;
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(materials).where(eq(materials.id, id)).limit(1);
    if (!existing) throw new Error("MATERIAL_NOT_FOUND");
    if (Object.prototype.hasOwnProperty.call(data, "materialNo")) {
      throw new Error("MATERIAL_CODE_IMMUTABLE");
    }
    await tx.update(materials).set(data).where(eq(materials.id, id));
    const [updated] = await tx.select().from(materials).where(eq(materials.id, id)).limit(1);
    await tx.insert(auditLogs).values({
      operatorId: audit.operatorId ?? null,
      operatorName: audit.operatorName ?? "system",
      operatorRole: audit.operatorRole ?? "system",
      action: audit.action ?? "material.update",
      module: "materials",
      targetType: "material",
      targetId: String(id),
      beforeValue: existing,
      afterValue: updated ?? null,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      result: "success",
      note: audit.note ?? null,
    });
    return updated;
  });
}

/** 对外“移除”只能软归档；主档行和平台码永久保留，避免历史业务引用失效。 */
export async function archiveMaterial(id: number, actor: MaterialAuditActor = {}) {
  return updateMaterial(id, { status: "disabled" }, {
    ...actor,
    action: "material.archive",
    note: "物料已停用归档；平台物料码永久保留且不可复用",
  });
}

/** 生产代码无条件禁止物理删除物料主档。 */
export async function deleteMaterial(_id: number): Promise<never> {
  throw new Error("MATERIAL_PHYSICAL_DELETE_FORBIDDEN");
}

/** 仅供 Vitest 隔离数据库清理夹具，部署进程无法调用。 */
export async function deleteMaterialFixture(id: number) {
  if (process.env.VITEST !== "true") throw new Error("MATERIAL_FIXTURE_PURGE_FORBIDDEN");
  const db = await getDb();
  if (!db) return;
  const existing = await getMaterialById(id);
  if (!existing) throw new Error("MATERIAL_NOT_FOUND");
  await db.delete(materials).where(eq(materials.id, id));
}

/**
 * 按制造商型号精确匹配物料（大小写不敏感），供图片上传接口按文件名回写。
 *
 * 精确匹配失败时会回退尝试「库内短号」写法，详见 shared/partNumberFallback.ts。
 * 背景：2026-08 将 464 条 ST 物料的 partNumber 由短号补全为完整型号，
 * 而图片上传 API 文档长期记载「库内型号不含封装后缀」，运营脚本按短号上传。
 * 若无回退，补全后全部上传都会报「型号不存在」，图片链路中断。
 */
export async function getMaterialByPartNumber(partNumber: string) {
  const db = await getDb();
  if (!db) return null;
  const columns = {
    id: materials.id,
    partNumber: materials.partNumber,
    coverImageUrl: materials.coverImageUrl,
    images: materials.images,
  };
  const result = await db
    .select(columns)
    .from(materials)
    .where(sql`UPPER(${materials.partNumber}) = UPPER(${partNumber.trim()})`)
    .limit(1);
  if (result[0]) return normalizeMaterialJson(result[0]);

  const candidates = expandShortPartNumber(partNumber);
  if (candidates.length === 0) return null;

  /**
   * 安全约束：必须【唯一命中】才采用。
   * 命中多条时宁可返回 null 让运营收到「型号不存在」去人工确认，
   * 也绝不猜测——否则可能把图片挂到另一颗真实存在的料上，造成错图。
   */
  const fallback = await db
    .select(columns)
    .from(materials)
    .where(inArray(sql`UPPER(${materials.partNumber})`, candidates))
    .limit(2);
  if (fallback.length !== 1) return null;
  if (!isPackageSuffixExpansion(partNumber, fallback[0].partNumber)) return null;
  return normalizeMaterialJson(fallback[0]);
}

/**
 * 向物料图集追加一张图片并按需设置封面
 * - images 按 URL 去重，最多保留 9 张（超出时丢弃最旧的）
 * - asCover=true 时设为封面；asCover=false 时仅当封面为空才设
 */
export async function appendMaterialImage(
  id: number,
  image: { url: string; name?: string; asCover: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("DB_NOT_AVAILABLE");
  const existing = await getMaterialById(id);
  if (!existing) throw new Error("MATERIAL_NOT_FOUND");
  const list = Array.isArray(existing.images) ? [...existing.images] : [];
  if (!list.some(item => item.url === image.url)) {
    list.push({ url: image.url, key: image.url, name: image.name });
  }
  while (list.length > 9) list.shift();
  const coverImageUrl = image.asCover || !existing.coverImageUrl ? image.url : existing.coverImageUrl;
  await db.update(materials).set({ images: list, coverImageUrl }).where(eq(materials.id, id));
  return { coverImageUrl, imageCount: list.length };
}

// ─── 商户 ─────────────────────────────────────────────────────────────────────

/**
 * 生成商户编号 `M` + 年月 + 时间戳后 6 位。
 *
 * 年月必须取北京时间：若用 `now.getFullYear()` 等本地时区方法，
 * 一旦服务器时区被误改或应用迁移到非 UTC+8 环境，
 * 跨月边界生成的编号会落到错误月份，影响按编号归档与对账。
 */
function genMerchantNo(now: Date): string {
  const parts = getBeijingDateParts(now);
  const ym = parts
    ? `${parts.year}${String(parts.month).padStart(2, "0")}`
    : "000000";
  return `M${ym}${String(Date.now()).slice(-6)}`;
}

/** 权威ERP用户集合：仅统计已开通且已绑定前台账号的不同用户ID。 */
export async function getEnabledErpPortalUserIds() {
  const db = await getDb();
  if (!db) return [] as string[];
  const rows = await db
    .selectDistinct({ portalUserId: merchants.crmOwnerPortalUserId })
    .from(merchants)
    .where(and(
      eq(merchants.crmStatus, "enabled"),
      sql`${merchants.crmOwnerPortalUserId} IS NOT NULL`,
      sql`TRIM(${merchants.crmOwnerPortalUserId}) <> ''`,
    ));
  return rows
    .map(row => row.portalUserId?.trim() ?? "")
    .filter((value): value is string => value.length > 0);
}

/**
 * 商户分页列表，支持销售数据范围隔离。
 *
 * ⚠️ `salesStaffCodes` 三态语义不可简化：
 *   - `undefined` → 超级管理员，不过滤
 *   - `[]`        → 无任何范围，直接返回空结果（不查库）
 *   - `[...]`     → 仅返回 salesOwnerCode 在范围内的商户
 * 若将 undefined 与 [] 混同处理，无范围的普通用户将看到全部商户，权限完全反转。
 */
export async function getMerchants(
  params: { status?: string; search?: string; page?: number; pageSize?: number },
  salesStaffCodes?: string[],
) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  if (salesStaffCodes !== undefined && salesStaffCodes.length === 0) return { data: [], total: 0 };
  const { status, search, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(merchants.status, status as any));
  if (search) conditions.push(or(like(merchants.companyName, `%${search}%`), like(merchants.merchantNo, `%${search}%`)));
  if (salesStaffCodes !== undefined) conditions.push(inArray(merchants.salesOwnerCode, salesStaffCodes));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(merchants).where(where);
  const data = await db.select().from(merchants).where(where).orderBy(desc(merchants.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

/** 按 ID 取商户；三态语义同 getMerchants，越出范围时返回 null（而非泄露数据） */
export async function getMerchantById(id: number, salesStaffCodes?: string[]) {
  const db = await getDb();
  if (!db) return null;
  if (salesStaffCodes !== undefined && salesStaffCodes.length === 0) return null;
  const conditions = [eq(merchants.id, id)];
  if (salesStaffCodes !== undefined) conditions.push(inArray(merchants.salesOwnerCode, salesStaffCodes));
  const result = await db.select().from(merchants).where(and(...conditions)).limit(1);
  return result[0] ?? null;
}

/**
 * 超级管理员分配或更换商户销售负责人。
 * 商户后台与前台企业资料位于同一 RDS，必须在同一事务内同步，任一侧失败整体回滚。
 */
export async function setMerchantSalesOwner(input: {
  merchantId: number;
  expectedSalesOwnerCode: string | null;
  salesOwnerCode: string | null;
  actor?: MaterialAuditActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const expectedCode = input.expectedSalesOwnerCode?.trim().toLowerCase() || null;
  const requestedCode = input.salesOwnerCode?.trim().toLowerCase() || null;

  return db.transaction(async tx => {
    const [merchant] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, input.merchantId))
      .limit(1)
      .for("update");
    if (!merchant) throw new Error("MERCHANT_NOT_FOUND");

    const currentCode = merchant.salesOwnerCode?.trim().toLowerCase() || null;
    if (currentCode !== expectedCode) throw new Error("SALES_OWNER_CHANGED");

    let nextCode: string | null = null;
    let nextName: string | null = null;
    if (requestedCode) {
      const [staff] = await tx
        .select()
        .from(salesStaff)
        .where(and(eq(salesStaff.staffCode, requestedCode), eq(salesStaff.status, "active")))
        .limit(1);
      if (!staff) throw new Error("INVALID_SALES_STAFF_CODE");
      nextCode = staff.staffCode;
      nextName = staff.displayName;
    }

    if (currentCode === nextCode && (merchant.salesOwner?.trim() || null) === nextName) {
      return {
        success: true as const,
        idempotent: true as const,
        merchantId: merchant.id,
        salesOwner: nextName,
        salesOwnerCode: nextCode,
        platformRowsUpdated: 0,
      };
    }

    await tx
      .update(merchants)
      .set({ salesOwner: nextName, salesOwnerCode: nextCode })
      .where(eq(merchants.id, merchant.id));

    let platformRowsUpdated = 0;
    const creditCode = merchant.businessLicense?.trim();
    if (creditCode) {
      const result = (await tx.execute(sql`
        UPDATE ${sql.raw(PLATFORM_DB)}.companies
        SET salesOwner = ${nextName}, salesOwnerCode = ${nextCode}
        WHERE UPPER(REPLACE(creditCode, ' ', '')) = ${normalizeCreditCode(creditCode)}
      `)) as unknown as [{ affectedRows?: number }, unknown];
      platformRowsUpdated = Number(result[0]?.affectedRows ?? 0);
    }

    await tx.insert(auditLogs).values({
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      action: "merchant.sales-owner.assign",
      module: "merchants",
      targetType: "merchant",
      targetId: String(merchant.id),
      beforeValue: {
        salesOwner: merchant.salesOwner,
        salesOwnerCode: currentCode,
      },
      afterValue: {
        salesOwner: nextName,
        salesOwnerCode: nextCode,
        platformRowsUpdated,
      },
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
      result: "success",
    });

    return {
      success: true as const,
      idempotent: false as const,
      merchantId: merchant.id,
      salesOwner: nextName,
      salesOwnerCode: nextCode,
      platformRowsUpdated,
    };
  });
}

export async function updateMerchantStatus(id: number, status: string, reviewNote?: string, reviewedBy?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(merchants).set({ status: status as any, reviewNote, reviewedBy, reviewedAt: new Date() }).where(eq(merchants.id, id));
}

/** 前台商家提交的入驻资料字段 */
export interface PortalMerchantSubmission {
  companyName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  businessLicense: string;
  licenseImageUrl?: string | null;
  licenseExpiry?: Date | null;
  agreementFileUrl?: string | null;
  agreementSigned?: boolean;
  registeredCapital?: string | null;
  registeredAddress?: string | null;
  businessScope?: string | null;
  establishedDate?: Date | null;
  legalPersonName?: string | null;
  legalPersonIdNo?: string | null;
  legalPersonPhone?: string | null;
  salesOwner?: string | null;
}

/**
 * 前台商家提交入驻资料：按营业执照号幂等 upsert。
 * 已存在 → 更新资料并将状态重置为 pending 重新进入审核（除非已 approved，approved 时仅更新资料）；
 * 不存在 → 创建新商户记录，生成商户编号，status=pending。
 */
export async function upsertPortalMerchant(input: PortalMerchantSubmission) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");

  const now = new Date();
  const baseFields = {
    companyName: input.companyName,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    licenseImageUrl: input.licenseImageUrl ?? null,
    licenseExpiry: input.licenseExpiry ?? null,
    agreementFileUrl: input.agreementFileUrl ?? null,
    agreementStatus: (input.agreementSigned ? "signed" : "unsigned") as "signed" | "unsigned",
    registeredCapital: input.registeredCapital ?? null,
    registeredAddress: input.registeredAddress ?? null,
    businessScope: input.businessScope ?? null,
    establishedDate: input.establishedDate ?? null,
    legalPersonName: input.legalPersonName ?? null,
    legalPersonIdNo: input.legalPersonIdNo ?? null,
    legalPersonPhone: input.legalPersonPhone ?? null,
    ...(input.salesOwner !== undefined ? { salesOwner: input.salesOwner ?? null } : {}),
    submittedAt: now,
    source: "portal",
  };

  const existing = await db
    .select()
    .from(merchants)
    .where(eq(merchants.businessLicense, input.businessLicense))
    .limit(1);

  if (existing.length > 0) {
    const m = existing[0];
    // 已入驻商户资料变更仅更新资料；其余状态重置为 pending 重新审核
    const nextStatus = m.status === "approved" ? m.status : ("pending" as const);
    await db.update(merchants).set({ ...baseFields, status: nextStatus }).where(eq(merchants.id, m.id));
    return { merchantId: m.id, merchantNo: m.merchantNo, created: false, status: nextStatus };
  }

  const merchantNo = genMerchantNo(now);
  const result = await db.insert(merchants).values({
    merchantNo,
    businessLicense: input.businessLicense,
    status: "pending",
    ...baseFields,
  });
  const insertId = (result as unknown as [{ insertId: number }])[0]?.insertId ?? 0;
  return { merchantId: insertId, merchantNo, created: true, status: "pending" as const };
}

/** 前台企业开通 ERP 申请入参 */
export interface CrmApplicationInput {
  companyName: string;
  creditCode: string;
  companyType: string;
  companyRole: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  legalPersonName: string;
  registeredAddress: string;
  settlementAccountName: string;
  settlementAccount: string;
  settlementBank: string;
  businessScope?: string | null;
  licenseImageUrl?: string | null;
  portalUserId?: string | null;
  note?: string | null;
  /**
   * 销售负责人姓名（展示用）与工号（归属唯一依据）。
   *
   * 必须由调用方先经 `resolvePortalSalesOwner()` 校验，本层不再修正。
   * 两者均为 undefined 时不改动现有归属；为 null 时显式清空。
   * 注意：历史上本接口缺失这两个字段，导致前台 ERP 开通时选的销售
   * 无法写入 merchants.salesOwnerCode，销售在自己后台看不到名下客户。
   */
  salesOwner?: string | null;
  salesOwnerCode?: string | null;
}

/**
 * 前台企业开通 ERP 申请：按统一社会信用代码（businessLicense）幂等 upsert 商户记录。
 * 已存在商户 → 补充资料并将 crmStatus 置为 pending（已开通 enabled 的不降级）；
 * 不存在 → 创建新商户记录（source=portal，status=pending，crmStatus=pending）。
 */
export async function submitCrmApplication(input: CrmApplicationInput, retryAttempt = 0) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");

  const creditCode = normalizeCreditCode(input.creditCode);
  const portalUserId = normalizePortalUserId(input.portalUserId);
  if (!portalUserId) {
    return {
      accepted: false,
      created: false,
      code: "CRM_ACCOUNT_REQUIRED" as const,
      crmStatus: "none" as const,
      message: "请先登录前台账号后再提交企业开通申请",
    };
  }

  const now = new Date();
  const profileFields = {
    companyName: input.companyName,
    companyType: input.companyType,
    companyRole: input.companyRole,
    legalPersonName: input.legalPersonName,
    registeredAddress: input.registeredAddress,
    settlementAccountName: input.settlementAccountName,
    settlementAccount: input.settlementAccount,
    settlementBank: input.settlementBank,
    ...(input.contactName ? { contactName: input.contactName } : {}),
    ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
    ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
    ...(input.businessScope ? { businessScope: input.businessScope } : {}),
    ...(input.licenseImageUrl ? { licenseImageUrl: input.licenseImageUrl } : {}),
    /**
     * 销售归属。用 `!== undefined` 而非真值判定，
     * 否则无法表达「显式清空归属」（null）与「本次不改动」（undefined）的差别。
     */
    ...(input.salesOwner !== undefined ? { salesOwner: input.salesOwner } : {}),
    ...(input.salesOwnerCode !== undefined ? { salesOwnerCode: input.salesOwnerCode } : {}),
  };
  try {
    return await db.transaction(async tx => {
      const existing = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.businessLicense, creditCode))
        .limit(1)
        .for("update");

      if (existing.length > 0) {
        const merchant = existing[0];
        const owner = normalizePortalUserId(merchant.crmOwnerPortalUserId);

        if (!owner) {
          if (merchant.crmStatus !== "none") {
            return {
              accepted: false,
              created: false,
              code: "CRM_BINDING_REQUIRED" as const,
              crmStatus: merchant.crmStatus,
              message: "该企业需要平台核验绑定关系，请联系客服",
            };
          }

          const claimResult = await tx.update(merchants).set({
            ...profileFields,
            crmOwnerPortalUserId: portalUserId,
            crmStatus: "pending",
            crmAppliedAt: now,
            ...(input.note ? { crmNote: input.note } : {}),
          }).where(and(
            eq(merchants.id, merchant.id),
            isNull(merchants.crmOwnerPortalUserId),
            eq(merchants.crmStatus, "none"),
          ));
          const affectedRows = (claimResult as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
          if (affectedRows !== 1) {
            return {
              accepted: false,
              created: false,
              code: "CRM_COMPANY_APPLICATION_PENDING" as const,
              crmStatus: "pending" as const,
              message: "该企业的 ERP 开通申请正在审核中",
            };
          }
          return {
            accepted: true,
            created: false,
            code: "CRM_APPLICATION_ACCEPTED" as const,
            crmStatus: "pending" as const,
            merchantId: merchant.id,
            merchantNo: merchant.merchantNo,
          };
        }

        if (owner !== portalUserId) {
          const code = merchant.crmStatus === "pending"
            ? "CRM_COMPANY_APPLICATION_PENDING"
            : merchant.crmStatus === "enabled"
              ? "CRM_COMPANY_ALREADY_ENABLED"
              : "CRM_COMPANY_ALREADY_BOUND";
          return {
            accepted: false,
            created: false,
            code,
            crmStatus: merchant.crmStatus,
            message: getCrmCompanyConflictMessage(
              merchant.crmStatus,
              "该企业已绑定其他前台账号，请联系企业管理员或平台客服",
            ),
          };
        }

        if (merchant.crmStatus === "rejected" || merchant.crmStatus === "none") {
          await tx.update(merchants).set({
            ...profileFields,
            crmStatus: "pending",
            crmAppliedAt: now,
            ...(input.note ? { crmNote: input.note } : {}),
          }).where(eq(merchants.id, merchant.id));
          return {
            accepted: true,
            created: false,
            code: merchant.crmStatus === "rejected"
              ? "CRM_APPLICATION_REAPPLIED" as const
              : "CRM_APPLICATION_ACCEPTED" as const,
            crmStatus: "pending" as const,
            merchantId: merchant.id,
            merchantNo: merchant.merchantNo,
          };
        }

        await tx.update(merchants).set(profileFields).where(eq(merchants.id, merchant.id));

        return {
          accepted: false,
          created: false,
          code: merchant.crmStatus === "enabled"
            ? "CRM_ALREADY_ENABLED" as const
            : merchant.crmStatus === "pending"
              ? "CRM_APPLICATION_PENDING" as const
              : "CRM_ACCESS_DISABLED" as const,
          crmStatus: merchant.crmStatus,
          merchantId: merchant.id,
          merchantNo: merchant.merchantNo,
        };
      }

      const merchantNo = genMerchantNo(now);
      const result = await tx.insert(merchants).values({
        merchantNo,
        ...profileFields,
        businessLicense: creditCode,
        crmOwnerPortalUserId: portalUserId,
        status: "pending",
        source: "portal",
        submittedAt: now,
        crmStatus: "pending",
        crmAppliedAt: now,
        crmNote: input.note ?? null,
      });
      const insertId = (result as unknown as [{ insertId: number }])[0]?.insertId ?? 0;
      return {
        accepted: true,
        created: true,
        code: "CRM_APPLICATION_ACCEPTED" as const,
        crmStatus: "pending" as const,
        merchantId: insertId,
        merchantNo,
      };
    });
  } catch (error) {
    const mysqlError = error as {
      errno?: number;
      code?: string;
      sqlState?: string;
      cause?: { errno?: number; code?: string; sqlState?: string };
    };
    const retryableConflict = mysqlError.errno === 1213
      || mysqlError.code === "ER_LOCK_DEADLOCK"
      || mysqlError.sqlState === "40001"
      || mysqlError.cause?.errno === 1213
      || mysqlError.cause?.code === "ER_LOCK_DEADLOCK"
      || mysqlError.cause?.sqlState === "40001";
    if (retryableConflict && retryAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 15 * (retryAttempt + 1)));
      return submitCrmApplication({ ...input, creditCode, portalUserId }, retryAttempt + 1);
    }
    const duplicate = mysqlError.errno === 1062
      || mysqlError.code === "ER_DUP_ENTRY"
      || mysqlError.cause?.errno === 1062
      || mysqlError.cause?.code === "ER_DUP_ENTRY";
    if (!duplicate) throw error;

    const rows = await db.select().from(merchants)
      .where(eq(merchants.businessLicense, creditCode)).limit(1);
    const merchant = rows[0];
    if (!merchant) throw error;
    const sameOwner = normalizePortalUserId(merchant.crmOwnerPortalUserId) === portalUserId;
    return sameOwner
      ? {
          accepted: false,
          created: false,
          code: "CRM_APPLICATION_PENDING" as const,
          crmStatus: merchant.crmStatus,
          merchantId: merchant.id,
          merchantNo: merchant.merchantNo,
        }
      : {
          accepted: false,
          created: false,
          code: "CRM_COMPANY_APPLICATION_PENDING" as const,
          crmStatus: merchant.crmStatus,
          message: "该企业的 ERP 开通申请正在审核中",
        };
  }
}

/** 后台：设置商户 ERP 开通状态（enabled=通过 rejected=拒绝 disabled=暂停） */
export async function setMerchantCrmStatus(input: {
  merchantId: number;
  crmStatus: MerchantCrmStatus;
  portalUserId?: string | null;
  note?: string | null;
  actor?: MaterialAuditActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedNote = input.note?.trim() || null;
  if ((input.crmStatus === "disabled" || input.crmStatus === "rejected") && !normalizedNote) {
    throw new Error(input.crmStatus === "disabled" ? "暂停 ERP 必须填写原因" : "拒绝 ERP 申请必须填写原因");
  }

  return db.transaction(async tx => {
    const rows = await tx.select().from(merchants)
      .where(eq(merchants.id, input.merchantId)).limit(1).for("update");
    const merchant = rows[0];
    if (!merchant) throw new Error("商户不存在");

    const fromStatus = merchant.crmStatus as MerchantCrmStatus;
    assertMerchantCrmStatusTransition(fromStatus, input.crmStatus);
    const decision = decideMerchantCrmGrant(merchant, input);
    const ownerToKeep = decision.kind === "enable"
      ? decision.ownerToBind
      : decision.existingOwner;
    const ownerCondition = decision.kind === "enable"
      ? decision.expectedExistingOwner
        ? eq(merchants.crmOwnerPortalUserId, decision.expectedExistingOwner)
        : isNull(merchants.crmOwnerPortalUserId)
      : ownerToKeep
        ? eq(merchants.crmOwnerPortalUserId, ownerToKeep)
        : isNull(merchants.crmOwnerPortalUserId);

    const updateResult = await tx.update(merchants).set({
      ...(decision.kind === "enable" ? { crmOwnerPortalUserId: ownerToKeep } : {}),
      crmStatus: input.crmStatus,
      ...(input.crmStatus === "enabled" ? { crmEnabledAt: merchant.crmEnabledAt ?? new Date() } : {}),
      ...(input.note !== undefined ? { crmNote: normalizedNote } : {}),
    }).where(and(
      eq(merchants.id, input.merchantId),
      eq(merchants.crmStatus, fromStatus),
      ownerCondition,
    ));
    const affectedRows = (updateResult as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;

    if (affectedRows !== 1) {
      const latestRows = await tx.select().from(merchants)
        .where(eq(merchants.id, input.merchantId)).limit(1);
      if (
        input.crmStatus !== "enabled"
        || !isEquivalentEnabledBinding(latestRows[0], ownerToKeep ?? "")
      ) {
        throw new Error("商户 ERP 状态已变化，请刷新页面后重试");
      }
    }

    const latestRows = await tx.select().from(merchants)
      .where(eq(merchants.id, input.merchantId)).limit(1);
    const latest = latestRows[0];
    await tx.insert(auditLogs).values({
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      action: `merchant.crm.${crmStatusAction(fromStatus, input.crmStatus)}`,
      module: "merchants",
      targetType: "merchant",
      targetId: String(input.merchantId),
      beforeValue: {
        crmStatus: fromStatus,
        crmOwnerPortalUserId: normalizeCrmPortalUserId(merchant.crmOwnerPortalUserId),
        crmNote: merchant.crmNote,
      },
      afterValue: {
        crmStatus: latest?.crmStatus ?? input.crmStatus,
        crmOwnerPortalUserId: normalizeCrmPortalUserId(latest?.crmOwnerPortalUserId) ?? ownerToKeep,
        crmNote: latest?.crmNote ?? normalizedNote,
      },
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
      result: "success",
      note: normalizedNote,
    });

    return { success: true, crmOwnerPortalUserId: ownerToKeep };
  });
}

/** 后台专用：ERP 超级管理员换绑。普通开通/恢复接口永远不能修改既有 owner。 */
export async function rebindMerchantCrmOwner(input: {
  merchantId: number;
  expectedPortalUserId: string;
  newPortalUserId: string;
  reason: string;
  requestId: string;
  actor?: MaterialAuditActor;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const expectedOwner = normalizeCrmPortalUserId(input.expectedPortalUserId);
  const newOwner = normalizeCrmPortalUserId(input.newPortalUserId);
  const reason = input.reason.trim();
  const requestId = input.requestId.trim();
  if (!expectedOwner) throw new Error("当前超级管理员用户 ID 不能为空");
  if (!newOwner) throw new Error("新超级管理员用户 ID 不能为空");
  if (reason.length < 2) throw new Error("换绑原因至少需要 2 个字符");
  if (!requestId) throw new Error("换绑请求号不能为空");

  return db.transaction(async tx => {
    const existingRequest = (
      await tx.select().from(crmOwnerRebindLogs)
        .where(eq(crmOwnerRebindLogs.requestId, requestId)).limit(1)
    )[0];
    if (existingRequest) {
      if (
        existingRequest.merchantId !== input.merchantId
        || existingRequest.expectedOwnerPortalUserId !== expectedOwner
        || existingRequest.nextOwnerPortalUserId !== newOwner
      ) {
        throw new Error("换绑请求号已用于其他操作");
      }
      return {
        success: true,
        idempotent: true,
        requestId,
        merchantId: input.merchantId,
        previousPortalUserId: expectedOwner,
        crmOwnerPortalUserId: newOwner,
      };
    }

    const rows = await tx.select().from(merchants)
      .where(eq(merchants.id, input.merchantId)).limit(1).for("update");
    const merchant = rows[0];
    if (!merchant) throw new Error("商户不存在");
    if (merchant.crmStatus !== "enabled" && merchant.crmStatus !== "disabled") {
      throw new Error("只有已开通或已暂停的 ERP 企业可以换绑超级管理员");
    }
    const oldOwner = normalizeCrmPortalUserId(merchant.crmOwnerPortalUserId);
    if (!oldOwner) throw new Error("当前企业尚未绑定超级管理员，请先完成开通绑定");
    if (oldOwner !== expectedOwner) {
      throw new Error("当前超级管理员绑定已变化，请刷新页面后重试");
    }
    if (oldOwner === newOwner) throw new Error("新超级管理员不能与当前绑定账号相同");

    const updateResult = await tx.update(merchants).set({
      crmOwnerPortalUserId: newOwner,
      crmNote: reason,
    }).where(and(
      eq(merchants.id, input.merchantId),
      eq(merchants.crmOwnerPortalUserId, expectedOwner),
      eq(merchants.crmStatus, merchant.crmStatus),
    ));
    const affectedRows = (updateResult as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
    if (affectedRows !== 1) {
      throw new Error("商户 ERP 绑定状态已变化，请刷新页面后重试");
    }

    await tx.insert(crmOwnerRebindLogs).values({
      requestId,
      merchantId: input.merchantId,
      expectedOwnerPortalUserId: expectedOwner,
      nextOwnerPortalUserId: newOwner,
      reason,
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
    });

    await tx.insert(auditLogs).values({
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      action: "merchant.crm.rebind",
      module: "merchants",
      targetType: "merchant",
      targetId: String(input.merchantId),
      beforeValue: {
        crmStatus: merchant.crmStatus,
        crmOwnerPortalUserId: oldOwner,
      },
      afterValue: {
        crmStatus: merchant.crmStatus,
        crmOwnerPortalUserId: newOwner,
      },
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
      result: "success",
      note: reason,
    });

    return {
      success: true,
      idempotent: false,
      requestId,
      merchantId: merchant.id,
      crmStatus: merchant.crmStatus,
      previousPortalUserId: oldOwner,
      crmOwnerPortalUserId: newOwner,
    };
  });
}

/**
 * 后台：给商户"发信"。首次发信为该商户创建 service 客服会话（记录 crmThreadNo），
 * 后续复用同一会话追加消息；消息计入前台未读数（portalUnreadCount+1），
 * 前台"联系客服"按钮通过 portal.getUnread 轮询显示红点。
 */
export async function sendMerchantMessage(input: {
  merchantId: number;
  content: string;
  adminId: number;
  adminName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1);
  const merchant = rows[0];
  if (!merchant) throw new Error("商户不存在");

  // 复用已关联的会话
  let thread: typeof messageThreads.$inferSelect | undefined;
  if (merchant.crmThreadNo) {
    const tr = await db.select().from(messageThreads)
      .where(eq(messageThreads.threadNo, merchant.crmThreadNo)).limit(1);
    thread = tr[0];
  }

  const preview = input.content.slice(0, 200);
  if (!thread) {
    const threadNo = genThreadNo();
    await db.insert(messageThreads).values({
      threadNo,
      subject: `平台通知 - ${merchant.companyName}`,
      contactName: merchant.contactName ?? null,
      contactPhone: merchant.contactPhone ?? null,
      contactEmail: merchant.contactEmail ?? null,
      threadType: "service",
      status: "open",
      adminUnreadCount: 0,
      portalUnreadCount: 0,
      lastMessagePreview: preview,
      lastMessageAt: new Date(),
    });
    const tr = await db.select().from(messageThreads)
      .where(eq(messageThreads.threadNo, threadNo)).limit(1);
    thread = tr[0];
    await db.update(merchants).set({ crmThreadNo: threadNo }).where(eq(merchants.id, merchant.id));
  }

  await db.insert(messages).values({
    threadId: thread!.id,
    senderType: "admin",
    senderAdminId: input.adminId,
    senderName: input.adminName,
    content: input.content,
  });
  await db.update(messageThreads).set({
    status: "open",
    portalUnreadCount: sql`${messageThreads.portalUnreadCount} + 1`,
    lastMessagePreview: preview,
    lastMessageAt: new Date(),
  }).where(eq(messageThreads.id, thread!.id));

  return { success: true, threadNo: thread!.threadNo, threadId: thread!.id };
}

/**
 * 前台：按统一社会信用代码校验 ERP 访问权限。
 * enabled → allowed=true；disabled → 提示"您的ERP权限已经被暂停，请联系客服"；
 * 其余状态（none/pending/rejected/未找到商户）→ 未开通提示。
 */
export async function getCrmAccessByCreditCode(
  creditCodeInput: string,
  portalUserIdInput?: string | null,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const portalUserId = normalizePortalUserId(portalUserIdInput);
  if (!portalUserId) {
    return {
      allowed: false,
      code: "CRM_ACCOUNT_REQUIRED" as const,
      crmStatus: "none" as const,
      message: "请先登录前台账号后再访问 ERP",
    };
  }

  const creditCode = normalizeCreditCode(creditCodeInput);
  const rows = await db.select().from(merchants)
    .where(eq(merchants.businessLicense, creditCode)).limit(1);
  const merchant = rows[0];
  if (!merchant) {
    return {
      allowed: false,
      code: "CRM_NOT_ENABLED" as const,
      crmStatus: "none" as const,
      message: "您尚未开通ERP，请先提交企业开通申请",
    };
  }

  const owner = normalizePortalUserId(merchant.crmOwnerPortalUserId);
  if (!owner) {
    return {
      allowed: false,
      code: "CRM_BINDING_REQUIRED" as const,
      crmStatus: merchant.crmStatus,
      message: "该企业需要平台核验绑定关系，请联系客服",
    };
  }
  if (owner !== portalUserId) {
    return {
      allowed: false,
      code: merchant.crmStatus === "pending"
        ? "CRM_COMPANY_APPLICATION_PENDING" as const
        : merchant.crmStatus === "enabled"
          ? "CRM_COMPANY_ALREADY_ENABLED" as const
          : "CRM_COMPANY_ALREADY_BOUND" as const,
      crmStatus: merchant.crmStatus,
      message: getCrmCompanyConflictMessage(
        merchant.crmStatus,
        "该企业已绑定其他前台账号",
      ),
    };
  }

  const crmStatus = merchant.crmStatus;
  if (crmStatus === "enabled") {
    return {
      allowed: true,
      code: "CRM_ACCESS_GRANTED" as const,
      crmStatus,
      message: null,
      merchantNo: merchant.merchantNo,
      crmThreadNo: merchant.crmThreadNo ?? null,
    };
  }
  const messageMap: Record<string, string> = {
    disabled: "您的ERP权限已经被暂停，请联系客服",
    pending: "您的ERP开通申请正在审核中，请耐心等待",
    rejected: "您的ERP开通申请未通过，如有疑问请联系客服",
    none: "您尚未开通ERP，请先提交企业开通申请",
  };
  return {
    allowed: false,
    code: crmStatus === "pending"
      ? "CRM_APPLICATION_PENDING" as const
      : crmStatus === "rejected"
        ? "CRM_APPLICATION_REJECTED" as const
        : crmStatus === "disabled"
          ? "CRM_ACCESS_DISABLED" as const
          : "CRM_NOT_ENABLED" as const,
    crmStatus,
    message: messageMap[crmStatus] ?? messageMap.none,
    merchantNo: merchant.merchantNo,
    crmThreadNo: merchant.crmThreadNo ?? null,
  };
}

/** 服务端对账：返回统一社会信用代码对应的权威 ERP owner；仅由 portal-key 路由暴露。 */
export async function getCrmBindingByCreditCode(creditCodeInput: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const creditCode = normalizeCreditCode(creditCodeInput);
  const rows = await db.select({
    merchantId: merchants.id,
    merchantNo: merchants.merchantNo,
    companyName: merchants.companyName,
    creditCode: merchants.businessLicense,
    crmStatus: merchants.crmStatus,
    crmOwnerPortalUserId: merchants.crmOwnerPortalUserId,
  }).from(merchants).where(eq(merchants.businessLicense, creditCode)).limit(1);
  const merchant = rows[0];
  if (!merchant) {
    return {
      found: false as const,
      creditCode,
      crmStatus: "none" as const,
      crmOwnerPortalUserId: null,
    };
  }
  return {
    found: true as const,
    ...merchant,
    creditCode,
    crmOwnerPortalUserId: normalizeCrmPortalUserId(merchant.crmOwnerPortalUserId),
  };
}

// ─── 管理员 ───────────────────────────────────────────────────────────────────

/** 可传入事务对象或 db 实例，便于在事务内复用同一套销售身份逻辑 */
type DbHandle = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbExecutor = DbHandle | Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

/**
 * 销售身份列表（前台「销售负责人」下拉与后台只读列表均取此）。
 * 默认仅返回 active；排序 sortOrder ASC, id ASC。
 */
export async function listSalesStaff(options: { activeOnly?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const activeOnly = options.activeOnly ?? true;
  return db
    .select()
    .from(salesStaff)
    .where(activeOnly ? eq(salesStaff.status, "active") : undefined)
    .orderBy(asc(salesStaff.sortOrder), asc(salesStaff.id));
}

/** 按工号查销售身份（查询前统一 trim + 小写） */
export async function getSalesStaffByCode(staffCode: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(salesStaff)
    .where(eq(salesStaff.staffCode, staffCode.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * 校验并规范化一组销售工号。
 *
 * @param options.activeOnly 仅接受启用中的工号，默认 true
 * @param options.strict 默认 true；为 true 时只要存在无效工号就抛错。
 *   调用方应在「用户显式提交了工号列表」时用 strict，
 *   而在「沿用现有范围」时用宽松模式——否则现有范围里一旦含有
 *   后来被停用的工号，用户连改个手机号都会保存失败。
 */
export async function normalizeSalesStaffCodes(
  executor: DbExecutor,
  staffCodes: string[],
  options: { activeOnly?: boolean; strict?: boolean } = {},
) {
  const normalized = Array.from(
    new Set(staffCodes.map(code => code.trim().toLowerCase()).filter(Boolean)),
  );
  if (normalized.length === 0) return [];
  const activeOnly = options.activeOnly ?? true;
  const rows = await executor
    .select({ staffCode: salesStaff.staffCode })
    .from(salesStaff)
    .where(
      activeOnly
        ? and(inArray(salesStaff.staffCode, normalized), eq(salesStaff.status, "active"))
        : inArray(salesStaff.staffCode, normalized),
    );
  const valid = new Set(rows.map(row => row.staffCode));
  const invalid = normalized.filter(code => !valid.has(code));
  if ((options.strict ?? true) && invalid.length > 0) {
    throw new Error("INVALID_SALES_STAFF_CODE");
  }
  return normalized.filter(code => valid.has(code));
}

/**
 * 由用户名派生稳定工号：小写化、非 [a-z0-9_-] 换成 "-"、去首尾 "-"、截断 64。
 * 规范化后不足 2 位（如纯中文用户名）则回退为 user-{id}，保证工号始终可用。
 */
export function salesIdentityCode(username: string, adminUserId: number) {
  const normalized = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized.length >= 2 ? normalized : `user-${adminUserId}`;
}

/**
 * 同步后台用户对应的销售身份，返回其自身工号（超级管理员返回 null）。
 *
 * 销售身份表不开放独立的增删接口，全部由本函数驱动，以避免出现
 * 「销售身份存在但对应后台用户已停用」的幽灵记录。
 *
 * 工号冲突处理（不可简化为直接 insert，否则重名用户会撞唯一索引导致建号失败）：
 *   1. 工号已被他人占用 → 降级为 user-{id}
 *   2. 工号已存在但未绑定任何人 → 认领它
 *   3. 工号不存在 → 新建
 */
export async function syncAdminUserSalesIdentity(
  executor: DbExecutor,
  user: {
    id: number;
    username: string;
    displayName?: string | null;
    adminRole: string;
    status: string;
  },
): Promise<string | null> {
  const [linked] = await executor
    .select()
    .from(salesStaff)
    .where(eq(salesStaff.adminUserId, user.id))
    .limit(1);

  const shouldBeActive = user.adminRole !== "super_admin" && user.status === "active";
  const nextStatus: "active" | "inactive" = shouldBeActive ? "active" : "inactive";
  const displayName = user.displayName?.trim() || user.username;

  if (linked) {
    await executor
      .update(salesStaff)
      .set({ displayName, status: nextStatus })
      .where(eq(salesStaff.id, linked.id));
    return user.adminRole === "super_admin" ? null : linked.staffCode;
  }

  // 超级管理员不作为销售身份（不出现在前台销售负责人下拉中）
  if (user.adminRole === "super_admin") return null;

  let staffCode = salesIdentityCode(user.username, user.id);
  const [sameCode] = await executor
    .select()
    .from(salesStaff)
    .where(eq(salesStaff.staffCode, staffCode))
    .limit(1);

  if (sameCode?.adminUserId && sameCode.adminUserId !== user.id) {
    staffCode = `user-${user.id}`;
  } else if (sameCode) {
    await executor
      .update(salesStaff)
      .set({ adminUserId: user.id, displayName, status: nextStatus })
      .where(eq(salesStaff.id, sameCode.id));
    return staffCode;
  }

  await executor.insert(salesStaff).values({
    adminUserId: user.id,
    staffCode,
    displayName,
    status: nextStatus,
    // 自动创建的身份排在手工维护的销售之后
    sortOrder: 1000 + user.id,
  });
  return staffCode;
}

/**
 * 读取后台用户的销售可见范围工号。
 * 默认只返回启用中的工号；`includeInactive` 用于编辑回显（需连已停用的一并展示）。
 */
export async function getAdminUserSalesScopeCodes(
  adminUserId: number,
  options: { includeInactive?: boolean } = {},
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ staffCode: adminUserSalesScopes.staffCode })
    .from(adminUserSalesScopes)
    .innerJoin(salesStaff, eq(salesStaff.staffCode, adminUserSalesScopes.staffCode))
    .where(
      options.includeInactive
        ? eq(adminUserSalesScopes.adminUserId, adminUserId)
        : and(
            eq(adminUserSalesScopes.adminUserId, adminUserId),
            eq(salesStaff.status, "active"),
          ),
    )
    .orderBy(asc(adminUserSalesScopes.id));
  return rows.map(row => row.staffCode);
}

/** 整体替换某后台用户的销售范围（先全删再批插） */
export async function replaceAdminUserSalesScopes(
  executor: DbExecutor,
  adminUserId: number,
  staffCodes: string[],
) {
  await executor
    .delete(adminUserSalesScopes)
    .where(eq(adminUserSalesScopes.adminUserId, adminUserId));
  if (staffCodes.length > 0) {
    await executor
      .insert(adminUserSalesScopes)
      .values(staffCodes.map(staffCode => ({ adminUserId, staffCode })));
  }
}

/**
 * 根据销售范围取可见商户的统一社会信用代码集合。
 * 空范围 → 返回空数组（意为「一个都看不到」，而不是「不限制」）。
 */
export async function getScopedMerchantCreditCodes(salesStaffCodes: string[]) {
  const db = await getDb();
  if (!db || salesStaffCodes.length === 0) return [];
  const rows = await db
    .selectDistinct({ creditCode: merchants.businessLicense })
    .from(merchants)
    .where(
      and(
        inArray(merchants.salesOwnerCode, salesStaffCodes),
        sql`${merchants.businessLicense} IS NOT NULL`,
        sql`TRIM(${merchants.businessLicense}) <> ''`,
      ),
    );
  return rows.map(row => row.creditCode?.trim() ?? "").filter(value => value.length > 0);
}

/**
 * 后台用户分页列表，每行附带销售范围与自身工号。
 * scope / identity 均按页批量查询并在内存归集，避免 N+1。
 */
export async function getAdminUsers(params: { page?: number; pageSize?: number } = {}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { page = 1, pageSize = 20 } = params;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(adminUsers);
  const data = await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

  const userIds = data.map(user => user.id);
  const scopeRows = userIds.length > 0
    ? await db
        .select({
          adminUserId: adminUserSalesScopes.adminUserId,
          staffCode: adminUserSalesScopes.staffCode,
        })
        .from(adminUserSalesScopes)
        .where(inArray(adminUserSalesScopes.adminUserId, userIds))
        .orderBy(asc(adminUserSalesScopes.id))
    : [];
  const identityRows = userIds.length > 0
    ? await db
        .select({ adminUserId: salesStaff.adminUserId, staffCode: salesStaff.staffCode })
        .from(salesStaff)
        .where(inArray(salesStaff.adminUserId, userIds))
    : [];

  const scopeMap = new Map<number, string[]>();
  for (const row of scopeRows) {
    const values = scopeMap.get(row.adminUserId) ?? [];
    values.push(row.staffCode);
    scopeMap.set(row.adminUserId, values);
  }
  const identityMap = new Map<number, string>();
  for (const row of identityRows) {
    if (row.adminUserId !== null) identityMap.set(row.adminUserId, row.staffCode);
  }

  return {
    data: data.map(user => ({
      ...user,
      salesStaffCodes: scopeMap.get(user.id) ?? [],
      ownSalesStaffCode: identityMap.get(user.id) ?? null,
    })),
    total: Number(count),
  };
}

/** 按用户名查询后台账号（账号密码登录用，包含 passwordHash） */
export async function getAdminUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
  return rows[0] ?? null;
}

/** 按 ID 查询后台账号 */
export async function getAdminUserById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 按绑定手机号查询后台账号列表（找回用户名用） */
export async function getAdminUsersByPhone(phone: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adminUsers).where(eq(adminUsers.phone, phone));
}

/** 按绑定邮箱查询后台账号列表（找回用户名用） */
export async function getAdminUsersByEmail(email: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adminUsers).where(eq(adminUsers.email, email));
}

/** 设置账号密码哈希 */
export async function setAdminUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, id));
}

/** 记录登录时间 */
export async function touchAdminUserLogin(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, id));
}

// ─── 找回密码验证码 ─────────────────────────────────────────────────────────

/** 创建验证码记录（同时作废该账号旧的未使用验证码） */
export async function createPasswordResetCode(input: {
  adminUserId: number;
  channel: "sms" | "email";
  target: string;
  codeHash: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(passwordResetCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetCodes.adminUserId, input.adminUserId), isNull(passwordResetCodes.usedAt)));
  await db.insert(passwordResetCodes).values(input);
}

/** 查询账号最近一条有效（未使用未过期）验证码 */
export async function getActivePasswordResetCode(adminUserId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(passwordResetCodes)
    .where(and(eq(passwordResetCodes.adminUserId, adminUserId), isNull(passwordResetCodes.usedAt)))
    .orderBy(desc(passwordResetCodes.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/** 累加验证失败次数 */
export async function incrementResetCodeAttempts(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(passwordResetCodes)
    .set({ attempts: sql`${passwordResetCodes.attempts} + 1` })
    .where(eq(passwordResetCodes.id, id));
}

/** 标记验证码已使用 */
export async function markResetCodeUsed(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(passwordResetCodes).set({ usedAt: new Date() }).where(eq(passwordResetCodes.id, id));
}
/**
 * 创建后台用户，并在同一事务内同步销售身份与销售可见范围。
 *
 * merchant_mgr 必须至少拥有一个范围（至少含本人），否则抛 SALES_SCOPE_REQUIRED——
 * 零范围的用户登录后什么都看不到，会误以为系统故障。
 */
export async function createAdminUser(input: {
  username: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminRole: "super_admin" | "operation" | "merchant_mgr" | "customer_svc" | "risk_control" | "finance" | "auditor";
  salesStaffCodes?: string[];
  passwordHash?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let scopeCodes: string[] = [];
  let ownSalesStaffCode: string | null = null;

  await db.transaction(async tx => {
    await tx.insert(adminUsers).values({
      userId: 0,
      username: input.username,
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      adminRole: input.adminRole,
      passwordHash: input.passwordHash ?? null,
      status: "active",
    });
    const [created] = await tx
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, input.username))
      .limit(1);
    if (!created) throw new Error("ADMIN_USER_CREATE_FAILED");

    ownSalesStaffCode = await syncAdminUserSalesIdentity(tx, created);

    if (input.adminRole === "merchant_mgr") {
      const requestedCodes = await normalizeSalesStaffCodes(tx, input.salesStaffCodes ?? [], {
        activeOnly: true,
        strict: true,
      });
      scopeCodes = Array.from(new Set([ownSalesStaffCode, ...requestedCodes].filter(Boolean) as string[]));
      if (scopeCodes.length === 0) throw new Error("SALES_SCOPE_REQUIRED");
    }

    await replaceAdminUserSalesScopes(tx, created.id, scopeCodes);
  });

  const created = await getAdminUserByUsername(input.username);
  if (!created) throw new Error("ADMIN_USER_CREATE_FAILED");
  return { ...created, salesStaffCodes: scopeCodes, ownSalesStaffCode };
}

/**
 * 更新后台用户，并在同一事务内重算销售身份与可见范围。
 *
 * 两处宽严尺度必须保留：
 * - `strict: input.salesStaffCodes !== undefined`：仅当调用方显式传入工号列表时严格校验；
 *   否则沿用现有范围且宽松，避免「只想改手机号却因历史范围含停用工号而失败」。
 * - `activeOnly: nextStatus === "active"`：停用用户时放宽，停用操作不应被范围校验阻断。
 */
export async function updateAdminUser(id: number, input: {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminRole?: "super_admin" | "operation" | "merchant_mgr" | "customer_svc" | "risk_control" | "finance" | "auditor";
  salesStaffCodes?: string[];
  status?: "active" | "disabled" | "locked";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getAdminUserById(id);
  if (!existing) throw new Error("ADMIN_USER_NOT_FOUND");

  const nextRole = input.adminRole ?? (existing.adminRole === "super_admin" ? "super_admin" : "merchant_mgr");
  const nextStatus = input.status ?? existing.status;
  // 回显用：包含已停用工号，避免未传 salesStaffCodes 时错误清空历史范围
  const currentScopes = await getAdminUserSalesScopeCodes(id, { includeInactive: true });

  const set: Record<string, unknown> = {};
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.email !== undefined) set.email = input.email;
  if (input.phone !== undefined) set.phone = input.phone;
  if (input.adminRole !== undefined) set.adminRole = input.adminRole;
  if (input.status !== undefined) set.status = input.status;

  await db.transaction(async tx => {
    if (Object.keys(set).length > 0) {
      await tx.update(adminUsers).set(set).where(eq(adminUsers.id, id));
    }

    const ownSalesStaffCode = await syncAdminUserSalesIdentity(tx, {
      id,
      username: existing.username,
      displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
      adminRole: nextRole,
      status: nextStatus,
    });

    let nextScopes: string[] = [];
    if (nextRole === "merchant_mgr") {
      const requestedCodes = await normalizeSalesStaffCodes(tx, input.salesStaffCodes ?? currentScopes, {
        activeOnly: nextStatus === "active",
        strict: input.salesStaffCodes !== undefined,
      });
      nextScopes = Array.from(new Set([ownSalesStaffCode, ...requestedCodes].filter(Boolean) as string[]));
      if (nextScopes.length === 0) throw new Error("SALES_SCOPE_REQUIRED");
    }

    await replaceAdminUserSalesScopes(tx, id, nextScopes);
  });
}

export async function toggleAdminUserStatus(id: number, status: "active" | "disabled") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adminUsers).set({ status }).where(eq(adminUsers.id, id));
}

export async function deleteAdminUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(adminUsers).where(eq(adminUsers.id, id));
}

// ─── 消息中心（前后台互通）─────────────────────────────────────────────────────

/**
 * 会话编号的日期部分必须取北京时间。
 *
 * 若用 `d.getFullYear()` 等本地时区方法，一旦服务器时区被误改或
 * 应用迁移到非 UTC+8 环境，编号中的日期会与业务当天错位，
 * 导致运营按编号检索当日会话时遗漏记录。
 */
function genThreadNo() {
  const parts = getBeijingDateParts(new Date());
  const ymd = parts
    ? `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`
    : "00000000";
  return `MT${ymd}${Math.floor(1000 + Math.random() * 9000)}`;
}

/** 客户公司资料快照（前台提交时附带） */
export interface CompanyProfileSnapshot {
  companyName?: string | null;
  creditCode?: string | null;
  companyType?: string | null;
  legalPerson?: string | null;
  companyRole?: string | null;
  regAddress?: string | null;
  certLevel?: string | null;
  [key: string]: unknown;
}

type PortalMessageThreadType = "general" | "inquiry" | "service" | "crm_apply";
type EffectiveMessageThreadType = Exclude<PortalMessageThreadType, "general">;

/**
 * 消息中心只展示快速询价与在线客服。历史 general 是旧调用漏传类型的兼容值：
 * 询价主题归 inquiry、企业开通申请归 crm_apply，其余归在线客服。
 */
export function resolvePortalMessageThreadType(input: {
  threadType?: PortalMessageThreadType | null;
  subject?: string | null;
}): EffectiveMessageThreadType {
  if (input.threadType && input.threadType !== "general") return input.threadType;
  const subject = input.subject?.trim() ?? "";
  if (subject.includes("企业开通申请")) return "crm_apply";
  if (subject.includes("询价")) return "inquiry";
  return "service";
}

function effectiveMessageThreadTypeSql() {
  return sql<EffectiveMessageThreadType>`CASE
    WHEN ${messageThreads.threadType} IN ('inquiry', 'service', 'crm_apply')
      THEN ${messageThreads.threadType}
    WHEN ${messageThreads.subject} LIKE '%企业开通申请%'
      THEN 'crm_apply'
    WHEN ${messageThreads.subject} LIKE '%询价%'
      THEN 'inquiry'
    ELSE 'service'
  END`;
}

/** 前台提交消息：新建会话或在已有会话追加消息。 */
export async function createPortalMessage(input: {
  threadNo?: string | null;
  clientMessageId?: string | null;
  subject?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  portalUserId?: string | null;
  threadType?: "general" | "inquiry" | "service" | "crm_apply" | null;
  companyProfile?: CompanyProfileSnapshot | null;
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const validateExisting = (existing: {
    messageId: number;
    threadId: number;
    threadNo: string;
    content: string;
    portalUserId: string | null;
  }) => {
    if (existing.content !== input.content) {
      throw new Error("消息幂等键与原留言内容不一致");
    }
    if (
      input.portalUserId
      && existing.portalUserId
      && existing.portalUserId !== input.portalUserId
    ) {
      throw new Error("消息幂等键与原留言用户不一致");
    }
    return {
      threadNo: existing.threadNo,
      threadId: existing.threadId,
      messageId: existing.messageId,
      deduplicated: true,
    };
  };

  const findExisting = async () => {
    if (!input.clientMessageId) return undefined;
    const rows = await db
      .select({
        messageId: messages.id,
        threadId: messages.threadId,
        threadNo: messageThreads.threadNo,
        content: messages.content,
        portalUserId: messageThreads.portalUserId,
      })
      .from(messages)
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .where(eq(messages.clientMessageId, input.clientMessageId))
      .limit(1);
    return rows[0];
  };

  const existingBeforeTransaction = await findExisting();
  if (existingBeforeTransaction) return validateExisting(existingBeforeTransaction);

  try {
    return await db.transaction(async tx => {
      if (input.clientMessageId) {
        const existingRows = await tx
          .select({
            messageId: messages.id,
            threadId: messages.threadId,
            threadNo: messageThreads.threadNo,
            content: messages.content,
            portalUserId: messageThreads.portalUserId,
          })
          .from(messages)
          .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
          .where(eq(messages.clientMessageId, input.clientMessageId))
          .limit(1);
        if (existingRows[0]) return validateExisting(existingRows[0]);
      }

      let thread: { id: number; threadNo: string } | undefined;
      if (input.threadNo) {
        const rows = await tx
          .select({ id: messageThreads.id, threadNo: messageThreads.threadNo })
          .from(messageThreads)
          .where(eq(messageThreads.threadNo, input.threadNo))
          .limit(1);
        thread = rows[0];
      }

      const preview = input.content.slice(0, 200);
      if (!thread) {
        const threadNo = genThreadNo();
        await tx.insert(messageThreads).values({
          threadNo,
          subject: input.subject ?? preview.slice(0, 100),
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactEmail: input.contactEmail ?? null,
          portalUserId: input.portalUserId ?? null,
          threadType: resolvePortalMessageThreadType(input),
          companyProfile: input.companyProfile ?? null,
          adminUnreadCount: 1,
          lastMessagePreview: preview,
          lastMessageAt: new Date(),
        });
        const rows = await tx
          .select({ id: messageThreads.id, threadNo: messageThreads.threadNo })
          .from(messageThreads)
          .where(eq(messageThreads.threadNo, threadNo))
          .limit(1);
        thread = rows[0];
      } else {
        await tx.update(messageThreads).set({
          status: "open",
          adminUnreadCount: sql`${messageThreads.adminUnreadCount} + 1`,
          lastMessagePreview: preview,
          lastMessageAt: new Date(),
          ...(input.contactName ? { contactName: input.contactName } : {}),
          ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
          ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
          ...(input.companyProfile ? { companyProfile: input.companyProfile } : {}),
          ...(input.threadType ? { threadType: resolvePortalMessageThreadType(input) } : {}),
        }).where(eq(messageThreads.id, thread.id));
      }
      if (!thread) throw new Error("消息会话创建失败");

      await tx.insert(messages).values({
        threadId: thread.id,
        clientMessageId: input.clientMessageId ?? null,
        senderType: "portal",
        senderName: input.contactName ?? null,
        content: input.content,
      });
      const messageIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
      const messageIdRows = (messageIdResult as unknown as [Array<{ id: number }>, unknown])[0];
      const messageId = Number(messageIdRows[0]?.id);
      return {
        threadNo: thread.threadNo,
        threadId: thread.id,
        messageId,
        deduplicated: false,
      };
    });
  } catch (error) {
    const mysqlError = error as {
      errno?: number;
      code?: string;
      cause?: { errno?: number; code?: string };
    };
    const duplicate = mysqlError.errno === 1062
      || mysqlError.code === "ER_DUP_ENTRY"
      || mysqlError.cause?.errno === 1062
      || mysqlError.cause?.code === "ER_DUP_ENTRY";
    if (!duplicate || !input.clientMessageId) throw error;

    const existingAfterConflict = await findExisting();
    if (!existingAfterConflict) throw error;
    return validateExisting(existingAfterConflict);
  }
}

/** 前台拉取会话消息（并清零前台未读数） */
export async function getPortalThreadMessages(threadNo: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(messageThreads)
    .where(eq(messageThreads.threadNo, threadNo)).limit(1);
  const thread = rows[0];
  if (!thread) return null;
  const list = await db.select().from(messages)
    .where(eq(messages.threadId, thread.id)).orderBy(messages.createdAt);
  if (thread.portalUnreadCount > 0) {
    await db.update(messageThreads).set({ portalUnreadCount: 0 })
      .where(eq(messageThreads.id, thread.id));
  }
  return {
    threadNo: thread.threadNo,
    subject: thread.subject,
    status: thread.status,
    messages: list.map(m => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderType === "admin" ? (m.senderName ?? "平台客服") : m.senderName,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

/** 后台：会话列表（支持状态筛选与关键词搜索；企业开通申请不属于消息，始终排除 crm_apply） */
export async function getMessageThreads(input: {
  page: number;
  pageSize: number;
  status?: "open" | "closed";
  threadType?: "inquiry" | "service";
  keyword?: string;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conds = [];
  const effectiveThreadType = effectiveMessageThreadTypeSql();
  // 企业开通申请直接落商户管理，不在消息中心展示；旧 general 记录按主题归类。
  conds.push(sql`${effectiveThreadType} <> 'crm_apply'`);
  if (input.status) conds.push(eq(messageThreads.status, input.status));
  if (input.threadType) conds.push(sql`${effectiveThreadType} = ${input.threadType}`);
  if (input.keyword) {
    const kw = `%${input.keyword}%`;
    conds.push(or(
      like(messageThreads.subject, kw),
      like(messageThreads.contactName, kw),
      like(messageThreads.contactPhone, kw),
      like(messageThreads.contactEmail, kw),
      like(messageThreads.threadNo, kw),
    ));
  }
  const where = conds.length ? and(...conds) : undefined;
  const items = await db.select().from(messageThreads)
    .where(where)
    .orderBy(desc(messageThreads.lastMessageAt))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const totalRows = await db.select({ count: sql<number>`count(*)` })
    .from(messageThreads).where(where);
  return {
    items: items.map(row => ({
      ...normalizeMessageThreadJson(row),
      threadType: resolvePortalMessageThreadType(row),
    })),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

/** 后台：会话详情与消息列表（并清零后台未读数） */
export async function getMessageThreadDetail(threadId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messageThreads)
    .where(eq(messageThreads.id, threadId)).limit(1);
  const normalizedThread = rows[0] ? normalizeMessageThreadJson(rows[0]) : null;
  const thread = normalizedThread
    ? { ...normalizedThread, threadType: resolvePortalMessageThreadType(normalizedThread) }
    : null;
  if (!thread) return null;
  const list = await db.select().from(messages)
    .where(eq(messages.threadId, threadId)).orderBy(messages.createdAt);
  if (thread.adminUnreadCount > 0) {
    await db.update(messageThreads).set({ adminUnreadCount: 0 })
      .where(eq(messageThreads.id, threadId));
  }
  return { thread, messages: list };
}

/** 后台：回复会话 */
export async function replyMessageThread(input: {
  threadId: number;
  content: string;
  adminId: number;
  adminName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(messageThreads)
    .where(eq(messageThreads.id, input.threadId)).limit(1);
  if (!rows[0]) throw new Error("会话不存在");
  await db.insert(messages).values({
    threadId: input.threadId,
    senderType: "admin",
    senderAdminId: input.adminId,
    senderName: input.adminName,
    content: input.content,
  });
  await db.update(messageThreads).set({
    status: "open",
    portalUnreadCount: sql`${messageThreads.portalUnreadCount} + 1`,
    adminUnreadCount: 0,
    lastMessagePreview: input.content.slice(0, 200),
    lastMessageAt: new Date(),
  }).where(eq(messageThreads.id, input.threadId));
  return { success: true };
}

/** 后台：关闭/重开会话 */
export async function setMessageThreadStatus(threadId: number, status: "open" | "closed") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(messageThreads).set({ status }).where(eq(messageThreads.id, threadId));
  return { success: true };
}

/** 后台：全部未读消息总数（侧边栏角标，排除 crm_apply） */
export async function getAdminUnreadTotal() {
  const db = await getDb();
  if (!db) return 0;
  const effectiveThreadType = effectiveMessageThreadTypeSql();
  const rows = await db.select({ total: sql<number>`COALESCE(SUM(${messageThreads.adminUnreadCount}), 0)` })
    .from(messageThreads)
    .where(and(eq(messageThreads.status, "open"), sql`${effectiveThreadType} <> 'crm_apply'`));
  return Number(rows[0]?.total ?? 0);
}

/** 前台：查询会话未读回复数（不清零，供前台"联系客服"按钮角标轮询） */
export async function getPortalThreadUnread(threadNo: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({
    portalUnreadCount: messageThreads.portalUnreadCount,
    status: messageThreads.status,
    lastMessageAt: messageThreads.lastMessageAt,
  }).from(messageThreads).where(eq(messageThreads.threadNo, threadNo)).limit(1);
  if (!rows[0]) return null;
  return {
    threadNo,
    unreadCount: rows[0].portalUnreadCount,
    status: rows[0].status,
    lastMessageAt: rows[0].lastMessageAt,
  };
}

// ─── 客户物料管理（跨库查询前台 dianzi51 库）────────────────────────────────────
// 生产环境后台库(dianzi51_admin)与前台库(dianzi51)在同一 RDS 实例、同一账号，
// 可直接以 `dianzi51.表名` 跨库访问。开发环境（Manus TiDB）无该库，查询失败时
// 返回 available:false 供前端展示"生产环境可用"提示。

const PLATFORM_DB = process.env.PLATFORM_DB_NAME || "dianzi51";

export type PlatformInventoryRow = {
  id: number;
  userId: number;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  qtyOnSale: number;
  priceEx: string | null;
  priceIncl: string | null;
  status: "draft" | "published" | "offshelf";
  publishedAt: Date | null;
  createdAt: Date;
  companyName: string | null;
  creditCode: string | null;
  userName: string | null;
  userPhone: string | null;
  photos: { key?: string; url?: string; name?: string }[] | string | null;
  offshelfBy: "user" | "admin" | null;
  offshelfReason: string | null;
};

/** 后台：查询商户在前台发布的物料（JOIN companies 获取企业名/信用代码） */
export async function listMerchantInventories(params: {
  creditCode?: string;
  keyword?: string; // 型号/品牌/企业名 模糊搜索
  status?: "published" | "draft" | "offshelf" | "all";
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { available: false, items: [] as PlatformInventoryRow[], total: 0 };
  const { creditCode, keyword, status = "published", page = 1, pageSize = 20 } = params;
  const offset = (page - 1) * pageSize;
  const conds = [sql`1=1`];
  if (status !== "all") conds.push(sql`i.status = ${status}`);
  if (creditCode) conds.push(sql`c.creditCode = ${creditCode}`);
  if (keyword) {
    const kw = `%${keyword}%`;
    conds.push(sql`(i.partNumber LIKE ${kw} OR i.brand LIKE ${kw} OR c.companyName LIKE ${kw})`);
  }
  const whereSql = sql.join(conds, sql` AND `);
  try {
    const countRows = (await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM ${sql.raw(PLATFORM_DB)}.inventories i
      LEFT JOIN ${sql.raw(PLATFORM_DB)}.companies c ON c.userId = i.userId
      WHERE ${whereSql}
    `)) as unknown as [{ cnt: number }[], unknown];
    const total = Number((countRows[0]?.[0] as { cnt?: number } | undefined)?.cnt ?? 0);
    const rows = (await db.execute(sql`
      SELECT i.id, i.userId, i.partNumber, i.brand, i.category, i.pkg,
             i.qtyOnSale, i.priceEx, i.priceIncl, i.status, i.publishedAt, i.createdAt,
             i.photos, i.offshelfBy, i.offshelfReason,
             c.companyName, c.creditCode,
             u.name AS userName, u.phone AS userPhone
      FROM ${sql.raw(PLATFORM_DB)}.inventories i
      LEFT JOIN ${sql.raw(PLATFORM_DB)}.companies c ON c.userId = i.userId
      LEFT JOIN ${sql.raw(PLATFORM_DB)}.users u ON u.id = i.userId
      WHERE ${whereSql}
      ORDER BY i.publishedAt DESC, i.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `)) as unknown as [PlatformInventoryRow[], unknown];
    return { available: true, items: rows[0] ?? [], total };
  } catch (error) {
    console.warn("[Database] 跨库查询前台物料失败（开发环境无 dianzi51 库属正常）:", (error as Error).message);
    return { available: false, items: [] as PlatformInventoryRow[], total: 0 };
  }
}

/**
 * 后台：下架前台物料（回到前台"待发布"状态，用户依据下架原因修改后可重新发布）。
 * 按与前台的约定：status 置回 'draft'（非 offshelf），并写入 offshelfBy='admin' 与必填的 offshelfReason，
 * 前台"待发布清单"会对 offshelfBy=admin 的条目显示"平台下架：原因"红色标记。
 */
export async function offshelfPlatformInventory(id: number, reason: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = (await db.execute(sql`
      UPDATE ${sql.raw(PLATFORM_DB)}.inventories
      SET status = 'draft', publishedAt = NULL,
          offshelfBy = 'admin', offshelfReason = ${reason}
      WHERE id = ${id} AND status = 'published'
    `)) as unknown as [{ affectedRows?: number }, unknown];
    const affected = Number(result[0]?.affectedRows ?? 0);
    if (affected === 0) throw new Error("物料不存在或已不是发布状态");
    return { success: true };
  } catch (error) {
    const msg = (error as Error).message || "";
    if (msg.includes("不存在") || msg.includes("已不是")) throw error;
    console.error("[Database] 下架前台物料失败:", msg);
    throw new Error("下架失败：无法访问前台数据库（此功能仅在生产环境可用）");
  }
}

// ─── 异常日志 ────────────────────────────────────────────────────────────────

export type ExceptionLogInput = {
  category: ExceptionCategory;
  severity?: ExceptionSeverity;
  source: "portal" | "admin";
  summary: string;
  fingerprint: string;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ipAddress?: string | null;
  ipOrigin?: string | null;
  userAgent?: string | null;
  userId?: number | null;
  userName?: string | null;
  durationMs?: number | null;
  detail?: unknown;
};

/**
 * 写入一条异常日志。
 *
 * 刻意吞掉所有异常：日志写入失败绝不能影响主业务流程。
 * 若数据库不可用或表尚未建好，静默跳过并在控制台留痕即可。
 */
export async function writeExceptionLog(input: ExceptionLogInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(exceptionLogs).values({
      category: input.category,
      severity: input.severity ?? "warning",
      source: input.source,
      summary: input.summary.slice(0, 256),
      fingerprint: input.fingerprint.slice(0, 128),
      method: input.method?.slice(0, 8) ?? null,
      path: input.path?.slice(0, 512) ?? null,
      statusCode: input.statusCode ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      ipOrigin: input.ipOrigin?.slice(0, 128) ?? null,
      userAgent: input.userAgent ?? null,
      userId: input.userId ?? null,
      userName: input.userName?.slice(0, 128) ?? null,
      durationMs: input.durationMs ?? null,
      detail: (input.detail ?? null) as never,
    });
  } catch (error) {
    console.warn("[ExceptionLog] 写入失败（已忽略，不影响主流程）:", (error as Error).message);
  }
}

/** 批量写入，供前台按批上报使用。 */
export async function writeExceptionLogs(inputs: ExceptionLogInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  try {
    const db = await getDb();
    if (!db) return 0;
    await db.insert(exceptionLogs).values(
      inputs.map(input => ({
        category: input.category,
        severity: input.severity ?? "warning",
        source: input.source,
        summary: input.summary.slice(0, 256),
        fingerprint: input.fingerprint.slice(0, 128),
        method: input.method?.slice(0, 8) ?? null,
        path: input.path?.slice(0, 512) ?? null,
        statusCode: input.statusCode ?? null,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        ipOrigin: input.ipOrigin?.slice(0, 128) ?? null,
        userAgent: input.userAgent ?? null,
        userId: input.userId ?? null,
        userName: input.userName?.slice(0, 128) ?? null,
        durationMs: input.durationMs ?? null,
        detail: (input.detail ?? null) as never,
      })),
    );
    return inputs.length;
  } catch (error) {
    console.warn("[ExceptionLog] 批量写入失败（已忽略）:", (error as Error).message);
    return 0;
  }
}

/** 分页查询异常日志。 */
export async function listExceptionLogs(params: {
  category?: ExceptionCategory;
  severity?: ExceptionSeverity;
  source?: "portal" | "admin";
  /** 按 IP 精确追溯某个来源的全部行为 */
  ipAddress?: string;
  /** 关键词：匹配摘要或路径 */
  search?: string;
  /** 起始时间（含） */
  from?: Date;
  /** 结束时间（不含） */
  to?: Date;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { category, severity, source, ipAddress, search, from, to } = params;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

  const conditions = [];
  if (category) conditions.push(eq(exceptionLogs.category, category));
  if (severity) conditions.push(eq(exceptionLogs.severity, severity));
  if (source) conditions.push(eq(exceptionLogs.source, source));
  if (ipAddress) conditions.push(eq(exceptionLogs.ipAddress, ipAddress));
  if (from) conditions.push(gte(exceptionLogs.createdAt, from));
  if (to) conditions.push(lt(exceptionLogs.createdAt, to));
  if (search) {
    conditions.push(
      or(
        like(exceptionLogs.summary, `%${search}%`),
        like(exceptionLogs.path, `%${search}%`),
        like(exceptionLogs.ipAddress, `%${search}%`),
      )!,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(exceptionLogs)
    .where(where);
  const rows = await db
    .select()
    .from(exceptionLogs)
    .where(where)
    .orderBy(desc(exceptionLogs.createdAt), desc(exceptionLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    data: rows.map(row => ({
      ...row,
      detail: decodeJsonValue<Record<string, unknown>>(row.detail),
    })),
    total: Number(count),
  };
}

/**
 * 概览统计：近 24 小时与近 7 天的分类计数，以及最活跃的异常来源 IP。
 * 用于页面顶部的态势卡片，让管理员一眼看出「现在有没有事」。
 */
export async function getExceptionLogStats() {
  const db = await getDb();
  if (!db) {
    return { last24h: [], topIps: [], total: 0 };
  }
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const byCategory = await db
    .select({
      category: exceptionLogs.category,
      severity: exceptionLogs.severity,
      count: sql<number>`count(*)`,
    })
    .from(exceptionLogs)
    .where(gte(exceptionLogs.createdAt, since24h))
    .groupBy(exceptionLogs.category, exceptionLogs.severity);

  const topIps = await db
    .select({
      ipAddress: exceptionLogs.ipAddress,
      ipOrigin: exceptionLogs.ipOrigin,
      count: sql<number>`count(*)`,
    })
    .from(exceptionLogs)
    .where(
      and(
        gte(exceptionLogs.createdAt, since7d),
        eq(exceptionLogs.category, "attack_probe"),
      ),
    )
    .groupBy(exceptionLogs.ipAddress, exceptionLogs.ipOrigin)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(exceptionLogs);

  return {
    last24h: byCategory.map(r => ({
      category: r.category,
      severity: r.severity,
      count: Number(r.count),
    })),
    topIps: topIps
      .filter(r => r.ipAddress)
      .map(r => ({
        ipAddress: r.ipAddress as string,
        ipOrigin: r.ipOrigin,
        count: Number(r.count),
      })),
    total: Number(total),
  };
}

/**
 * 清理超过保留期的日志。
 * 返回删除条数，供定时任务记录。
 */
export async function purgeExpiredExceptionLogs(
  retentionDays: number = LOG_RETENTION_DAYS,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = (await db.execute(
    sql`DELETE FROM exception_logs WHERE createdAt < ${cutoff}`,
  )) as unknown as [{ affectedRows?: number }, unknown];
  return Number(result[0]?.affectedRows ?? 0);
}
