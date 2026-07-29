import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  adminUsers,
  InsertMaterial,
  InsertUser,
  materials,
  merchants,
  messages,
  messageThreads,
  passwordResetCodes,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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
  return { data, total: Number(count) };
}

export async function getMaterialById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(materials).where(eq(materials.id, id)).limit(1);
  return result[0] ?? null;
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
          like(materials.partNumber, `%${keyword}%`),
          like(materials.name, `%${keyword}%`),
          like(materials.brand, `%${keyword}%`),
        ),
      ),
    )
    .orderBy(materials.partNumber)
    .limit(20);
  return rows;
}

/**
 * 获取指定型号的完整参数（公开 API，供前台搜索结果页展示参数）
 * 精确匹配 partNumber，返回 specs JSON 及基础信息
 */
export async function getMaterialSpecsByPartNumber(partNumber: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
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
        eq(materials.partNumber, partNumber),
      ),
    )
    .limit(1);
  return result[0] ?? null;
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
        like(materials.partNumber, `%${keyword}%`),
        like(materials.name, `%${keyword}%`),
        like(materials.brand, `%${keyword}%`),
        like(materials.description, `%${keyword}%`),
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
  return { data, total: Number(count) };
}

/**
 * 物料编号规则：51E-{分类码}-{4位序列号}
 *
 * 分类码（3位大写字母）对照表：
 *   MCU  微控制器/单片机
 *   MEM  存储器（Flash/RAM/EEPROM）
 *   AMP  放大器/运算放大器
 *   WLS  无线模组（WiFi/BT/Zigbee）
 *   CAP  电容（MLCC/电解/钽）
 *   DIS  分立器件（MOSFET/BJT/二极管）
 *   PWR  电源管理（LDO/DCDC/PMU）
 *   CLK  时钟与定时器
 *   IFC  接口芯片（UART/SPI/I2C/RS232）
 *   LOG  逻辑芯片（门电路/移位寄存器）
 *   SEN  传感器
 *   CON  连接器/接插件
 *   IND  电感/磁性元件
 *   RES  电阻
 *   OTH  其他/未分类
 *
 * 序列号在同一分类码下全局递增，不随年份重置，删除后不复用。
 * 示例：51E-MCU-00001（第1颗微控制器）、51E-MEM-00003（第3颗存储器）
 *
 * 容量：每个分类码最多 99999 条，15 个分类码合计上限约 150 万条。
 */
const CATEGORY_CODE_MAP: Record<string, string> = {
  微控制器: "MCU",
  单片机: "MCU",
  存储器: "MEM",
  存储芯片: "MEM",
  Flash: "MEM",
  放大器: "AMP",
  运算放大器: "AMP",
  无线模组: "WLS",
  无线模块: "WLS",
  电容: "CAP",
  分立器件: "DIS",
  功率器件: "DIS",
  电源管理: "PWR",
  时钟与定时: "CLK",
  接口芯片: "IFC",
  逻辑芯片: "LOG",
  传感器: "SEN",
  连接器: "CON",
  接插件: "CON",
  电感: "IND",
  电阻: "RES",
};

function getCategoryCode(category?: string | null): string {
  if (!category) return "OTH";
  return CATEGORY_CODE_MAP[category.trim()] ?? "OTH";
}

async function generateMaterialNo(category?: string | null): Promise<string> {
  const db = await getDb();
  const catCode = getCategoryCode(category);
  const prefix = `51E-${catCode}-`;
  if (!db) return `${prefix}00001`;
  // 基于同分类码最大序列号顺延，避免删除记录后编号复用
  const [row] = await db
    .select({ maxNo: sql<string | null>`MAX(materialNo)` })
    .from(materials)
    .where(like(materials.materialNo, `${prefix}%`));
  const maxNo = row?.maxNo;
  const nextSeq = maxNo ? parseInt(maxNo.slice(-5), 10) + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

export async function createMaterial(data: Omit<InsertMaterial, "materialNo">) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  // 冲突重试：并发创建时编号可能撞车，最多重试 3 次
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const materialNo = await generateMaterialNo(data.category);
    try {
      await db.insert(materials).values({ ...data, materialNo });
      const result = await db.select().from(materials).where(eq(materials.materialNo, materialNo)).limit(1);
      return result[0] ?? null;
    } catch (error: unknown) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      if (code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw lastError ?? new Error("物料编号生成失败");
}

export async function updateMaterial(id: number, data: Partial<InsertMaterial>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getMaterialById(id);
  if (!existing) throw new Error("MATERIAL_NOT_FOUND");
  await db.update(materials).set(data).where(eq(materials.id, id));
}

export async function deleteMaterial(id: number) {
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
  return result[0] ?? null;
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
export async function submitCrmApplication(input: CrmApplicationInput) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");

  const now = new Date();
  const existing = await db
    .select()
    .from(merchants)
    .where(eq(merchants.businessLicense, input.creditCode))
    .limit(1);

  if (existing.length > 0) {
    const m = existing[0];
    const nextCrmStatus = m.crmStatus === "enabled" ? m.crmStatus : ("pending" as const);
    await db.update(merchants).set({
      ...(input.contactName ? { contactName: input.contactName } : {}),
      ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
      ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      ...(input.legalPersonName ? { legalPersonName: input.legalPersonName } : {}),
      ...(input.registeredAddress ? { registeredAddress: input.registeredAddress } : {}),
      ...(input.businessScope ? { businessScope: input.businessScope } : {}),
      ...(input.licenseImageUrl ? { licenseImageUrl: input.licenseImageUrl } : {}),
      crmStatus: nextCrmStatus,
      crmAppliedAt: now,
      ...(input.note ? { crmNote: input.note } : {}),
    }).where(eq(merchants.id, m.id));
    return { merchantId: m.id, merchantNo: m.merchantNo, created: false, crmStatus: nextCrmStatus };
  }

  const merchantNo = `M${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(Date.now()).slice(-6)}`;
  const result = await db.insert(merchants).values({
    merchantNo,
    companyName: input.companyName,
    businessLicense: input.creditCode,
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
  return { merchantId: insertId, merchantNo, created: true, crmStatus: "pending" as const };
}

/** 后台：设置商户 CRM 开通状态（enabled=通过 rejected=拒绝 disabled=暂停） */
export async function setMerchantCrmStatus(input: {
  merchantId: number;
  crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected";
  note?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1);
  if (!rows[0]) throw new Error("商户不存在");
  await db.update(merchants).set({
    crmStatus: input.crmStatus,
    ...(input.crmStatus === "enabled" ? { crmEnabledAt: new Date() } : {}),
    ...(input.note !== undefined ? { crmNote: input.note } : {}),
  }).where(eq(merchants.id, input.merchantId));
  return { success: true };
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
export async function getCrmAccessByCreditCode(creditCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(merchants)
    .where(eq(merchants.businessLicense, creditCode)).limit(1);
  const merchant = rows[0];
  if (!merchant) {
    return { allowed: false, crmStatus: "none" as const, message: "您尚未开通CRM，请先提交企业开通申请" };
  }
  const crmStatus = merchant.crmStatus;
  if (crmStatus === "enabled") {
    return { allowed: true, crmStatus, message: null, merchantNo: merchant.merchantNo, crmThreadNo: merchant.crmThreadNo ?? null };
  }
  const messageMap: Record<string, string> = {
    disabled: "您的CRM权限已经被暂停，请联系客服",
    pending: "您的CRM开通申请正在审核中，请耐心等待",
    rejected: "您的CRM开通申请未通过，如有疑问请联系客服",
    none: "您尚未开通CRM，请先提交企业开通申请",
  };
  return {
    allowed: false,
    crmStatus,
    message: messageMap[crmStatus] ?? messageMap.none,
    merchantNo: merchant.merchantNo,
    crmThreadNo: merchant.crmThreadNo ?? null,
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
  const [result] = await db.insert(adminUsers).values({
    userId: 0,
    username: input.username,
    displayName: input.displayName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    adminRole: input.adminRole,
    passwordHash: input.passwordHash ?? null,
    status: "active",
  });
  return result;
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
  return { items, total: Number(totalRows[0]?.count ?? 0) };
}

/** 后台：会话详情与消息列表（并清零后台未读数） */
export async function getMessageThreadDetail(threadId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messageThreads)
    .where(eq(messageThreads.id, threadId)).limit(1);
  const thread = rows[0];
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
