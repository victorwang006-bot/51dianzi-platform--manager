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

async function generateMaterialNo(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  const prefix = `MAT${year}`;
  if (!db) return `${prefix}0001`;
  // 基于当前同年最大编号顺延，避免删除记录后编号复用导致唯一键冲突
  const [row] = await db
    .select({ maxNo: sql<string | null>`MAX(materialNo)` })
    .from(materials)
    .where(like(materials.materialNo, `${prefix}%`));
  const maxNo = row?.maxNo;
  const nextSeq = maxNo ? parseInt(maxNo.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

export async function createMaterial(data: Omit<InsertMaterial, "materialNo">) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  // 冲突重试：并发创建时编号可能撞车，最多重试 3 次
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const materialNo = await generateMaterialNo();
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
