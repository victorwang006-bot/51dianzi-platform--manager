import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  adminUsers,
  auditLogs,
  crmOwnerRebindLogs,
  InsertMaterial,
  InsertUser,
  materialNumberSequences,
  materials,
  merchants,
  messages,
  messageThreads,
  passwordResetCodes,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  formatMaterialNo,
  PLATFORM_MATERIAL_SEQUENCE_KEY,
} from "./materialCode";
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

/** 按制造商型号精确匹配物料（大小写不敏感），供图片上传接口按文件名回写 */
export async function getMaterialByPartNumber(partNumber: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
      id: materials.id,
      partNumber: materials.partNumber,
      coverImageUrl: materials.coverImageUrl,
      images: materials.images,
    })
    .from(materials)
    .where(sql`UPPER(${materials.partNumber}) = UPPER(${partNumber.trim()})`)
    .limit(1);
  return result[0] ? normalizeMaterialJson(result[0]) : null;
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

export async function getMerchants(params: { status?: string; search?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { status, search, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(merchants.status, status as any));
  if (search) conditions.push(or(like(merchants.companyName, `%${search}%`), like(merchants.merchantNo, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(merchants).where(where);
  const data = await db.select().from(merchants).where(where).orderBy(desc(merchants.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function getMerchantById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(merchants).where(eq(merchants.id, id)).limit(1);
  return result[0] ?? null;
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

  const merchantNo = `M${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(Date.now()).slice(-6)}`;
  const result = await db.insert(merchants).values({
    merchantNo,
    businessLicense: input.businessLicense,
    status: "pending",
    ...baseFields,
  });
  const insertId = (result as unknown as [{ insertId: number }])[0]?.insertId ?? 0;
  return { merchantId: insertId, merchantNo, created: true, status: "pending" as const };
}

/** 前台企业开通 CRM 申请入参 */
export interface CrmApplicationInput {
  companyName: string;
  creditCode: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  legalPersonName?: string | null;
  registeredAddress?: string | null;
  businessScope?: string | null;
  licenseImageUrl?: string | null;
  portalUserId?: string | null;
  note?: string | null;
}

/**
 * 前台企业开通 CRM 申请：按统一社会信用代码（businessLicense）幂等 upsert 商户记录。
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
              message: "该企业的 CRM 开通申请正在审核中",
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
            message: merchant.crmStatus === "pending"
              ? "该企业的 CRM 开通申请正在审核中"
              : "该企业已绑定其他前台账号，请联系企业管理员或平台客服",
          };
        }

        if (merchant.crmStatus === "rejected" || merchant.crmStatus === "none") {
          await tx.update(merchants).set({
            ...(input.contactName ? { contactName: input.contactName } : {}),
            ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
            ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
            ...(input.legalPersonName ? { legalPersonName: input.legalPersonName } : {}),
            ...(input.registeredAddress ? { registeredAddress: input.registeredAddress } : {}),
            ...(input.businessScope ? { businessScope: input.businessScope } : {}),
            ...(input.licenseImageUrl ? { licenseImageUrl: input.licenseImageUrl } : {}),
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

      const merchantNo = `M${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(Date.now()).slice(-6)}`;
      const result = await tx.insert(merchants).values({
        merchantNo,
        companyName: input.companyName,
        businessLicense: creditCode,
        crmOwnerPortalUserId: portalUserId,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        legalPersonName: input.legalPersonName ?? null,
        registeredAddress: input.registeredAddress ?? null,
        businessScope: input.businessScope ?? null,
        licenseImageUrl: input.licenseImageUrl ?? null,
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
          message: "该企业的 CRM 开通申请正在审核中",
        };
  }
}

/** 后台：设置商户 CRM 开通状态（enabled=通过 rejected=拒绝 disabled=暂停） */
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
    throw new Error(input.crmStatus === "disabled" ? "暂停 CRM 必须填写原因" : "拒绝 CRM 申请必须填写原因");
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
        throw new Error("商户 CRM 状态已变化，请刷新页面后重试");
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

/** 后台专用：CRM 超级管理员换绑。普通开通/恢复接口永远不能修改既有 owner。 */
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
      throw new Error("只有已开通或已暂停的 CRM 企业可以换绑超级管理员");
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
      throw new Error("商户 CRM 绑定状态已变化，请刷新页面后重试");
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
 * 前台：按统一社会信用代码校验 CRM 访问权限。
 * enabled → allowed=true；disabled → 提示"您的CRM权限已经被暂停，请联系客服"；
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
      message: "请先登录前台账号后再访问 CRM",
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
      message: "您尚未开通CRM，请先提交企业开通申请",
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
      message: merchant.crmStatus === "pending"
        ? "该企业的 CRM 开通申请正在审核中"
        : "该企业已绑定其他前台账号",
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
    disabled: "您的CRM权限已经被暂停，请联系客服",
    pending: "您的CRM开通申请正在审核中，请耐心等待",
    rejected: "您的CRM开通申请未通过，如有疑问请联系客服",
    none: "您尚未开通CRM，请先提交企业开通申请",
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

/** 服务端对账：返回统一社会信用代码对应的权威 CRM owner；仅由 portal-key 路由暴露。 */
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

export async function getAdminUsers(params: { page?: number; pageSize?: number } = {}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { page = 1, pageSize = 20 } = params;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(adminUsers);
  const data = await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
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
export async function createAdminUser(input: {
  username: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminRole: "super_admin" | "operation" | "merchant_mgr" | "customer_svc" | "risk_control" | "finance" | "auditor";
  passwordHash?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(adminUsers).values({
    userId: 0,
    username: input.username,
    displayName: input.displayName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    adminRole: input.adminRole,
    passwordHash: input.passwordHash ?? null,
    status: "active",
  });
  const created = await getAdminUserByUsername(input.username);
  if (!created) throw new Error("ADMIN_USER_CREATE_FAILED");
  return created;
}

export async function updateAdminUser(id: number, input: {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminRole?: "super_admin" | "operation" | "merchant_mgr" | "customer_svc" | "risk_control" | "finance" | "auditor";
  status?: "active" | "disabled" | "locked";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const set: Record<string, unknown> = {};
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.email !== undefined) set.email = input.email;
  if (input.phone !== undefined) set.phone = input.phone;
  if (input.adminRole !== undefined) set.adminRole = input.adminRole;
  if (input.status !== undefined) set.status = input.status;
  if (Object.keys(set).length > 0) {
    await db.update(adminUsers).set(set).where(eq(adminUsers.id, id));
  }
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

function genThreadNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
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

/** 前台提交"联系我们"留言：新建会话或在已有会话追加消息 */
export async function createPortalMessage(input: {
  threadNo?: string | null;
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

  let thread: typeof messageThreads.$inferSelect | undefined;
  if (input.threadNo) {
    const rows = await db.select().from(messageThreads)
      .where(eq(messageThreads.threadNo, input.threadNo)).limit(1);
    thread = rows[0];
  }

  const preview = input.content.slice(0, 200);
  if (!thread) {
    const threadNo = genThreadNo();
    await db.insert(messageThreads).values({
      threadNo,
      subject: input.subject ?? preview.slice(0, 100),
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      portalUserId: input.portalUserId ?? null,
      threadType: input.threadType ?? "general",
      companyProfile: input.companyProfile ?? null,
      adminUnreadCount: 1,
      lastMessagePreview: preview,
      lastMessageAt: new Date(),
    });
    const rows = await db.select().from(messageThreads)
      .where(eq(messageThreads.threadNo, threadNo)).limit(1);
    thread = rows[0];
  } else {
    await db.update(messageThreads).set({
      status: "open",
      adminUnreadCount: sql`${messageThreads.adminUnreadCount} + 1`,
      lastMessagePreview: preview,
      lastMessageAt: new Date(),
      ...(input.contactName ? { contactName: input.contactName } : {}),
      ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
      ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      ...(input.companyProfile ? { companyProfile: input.companyProfile } : {}),
    }).where(eq(messageThreads.id, thread.id));
  }

  await db.insert(messages).values({
    threadId: thread!.id,
    senderType: "portal",
    senderName: input.contactName ?? null,
    content: input.content,
  });

  return { threadNo: thread!.threadNo, threadId: thread!.id };
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
  threadType?: "general" | "inquiry" | "service";
  keyword?: string;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conds = [];
  // 企业开通申请直接落商户管理，不在消息中心展示
  conds.push(sql`${messageThreads.threadType} <> 'crm_apply'`);
  if (input.status) conds.push(eq(messageThreads.status, input.status));
  if (input.threadType) conds.push(eq(messageThreads.threadType, input.threadType));
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
    items: items.map(normalizeMessageThreadJson),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

/** 后台：会话详情与消息列表（并清零后台未读数） */
export async function getMessageThreadDetail(threadId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messageThreads)
    .where(eq(messageThreads.id, threadId)).limit(1);
  const thread = rows[0] ? normalizeMessageThreadJson(rows[0]) : null;
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
  const rows = await db.select({ total: sql<number>`COALESCE(SUM(${messageThreads.adminUnreadCount}), 0)` })
    .from(messageThreads)
    .where(and(eq(messageThreads.status, "open"), sql`${messageThreads.threadType} <> 'crm_apply'`));
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
