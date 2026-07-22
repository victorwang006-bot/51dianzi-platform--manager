import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  adminUsers,
  InsertMaterial,
  InsertUser,
  materials,
  merchants,
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

// ─── 管理员 ───────────────────────────────────────────────────────────────────

export async function getAdminUsers(params: { page?: number; pageSize?: number } = {}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { page = 1, pageSize = 20 } = params;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(adminUsers);
  const data = await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function createAdminUser(input: {
  username: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminRole: "super_admin" | "operation" | "merchant_mgr" | "customer_svc" | "risk_control" | "finance" | "auditor";
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
