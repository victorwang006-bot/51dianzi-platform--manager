import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  adminUsers,
  alerts,
  auditLogs,
  categories,
  inventoryLogs,
  InsertUser,
  merchants,
  orderStatusLogs,
  orders,
  paymentFlows,
  products,
  refunds,
  riskAnalyses,
  settlementBills,
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

// ─── 仪表盘统计 ───────────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const [totalOrders] = await db.select({ count: sql<number>`count(*)` }).from(orders);
  const [totalMerchants] = await db.select({ count: sql<number>`count(*)` }).from(merchants);
  const [pendingReviews] = await db.select({ count: sql<number>`count(*)` }).from(products).where(eq(products.status, "pending_review"));
  const [openAlerts] = await db.select({ count: sql<number>`count(*)` }).from(alerts).where(eq(alerts.status, "open"));
  const [pendingRefunds] = await db.select({ count: sql<number>`count(*)` }).from(refunds).where(eq(refunds.status, "pending"));
  const [pendingMerchants] = await db.select({ count: sql<number>`count(*)` }).from(merchants).where(eq(merchants.status, "pending"));
  const [totalRevenue] = await db.select({ total: sql<string>`COALESCE(sum(totalAmount), 0)` }).from(orders).where(eq(orders.status, "completed"));
  return {
    totalOrders: Number(totalOrders?.count ?? 0),
    totalMerchants: Number(totalMerchants?.count ?? 0),
    pendingReviews: Number(pendingReviews?.count ?? 0),
    openAlerts: Number(openAlerts?.count ?? 0),
    pendingRefunds: Number(pendingRefunds?.count ?? 0),
    pendingMerchants: Number(pendingMerchants?.count ?? 0),
    totalRevenue: parseFloat(totalRevenue?.total ?? "0"),
  };
}

export async function getRecentOrders(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
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

// ─── 商品 ─────────────────────────────────────────────────────────────────────

export async function getProducts(params: { status?: string; search?: string; merchantId?: number; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { status, search, merchantId, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(products.status, status as any));
  if (merchantId) conditions.push(eq(products.merchantId, merchantId));
  if (search) conditions.push(or(like(products.name, `%${search}%`), like(products.model, `%${search}%`), like(products.brand, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(products).where(where);
  const data = await db.select().from(products).where(where).orderBy(desc(products.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function getProductsGroupedByMerchant(params: { status?: string; search?: string }) {
  const db = await getDb();
  if (!db) return [];
  const { status, search } = params;
  const conditions = [];
  if (status) conditions.push(eq(products.status, status as any));
  if (search) conditions.push(or(like(products.name, `%${search}%`), like(products.model, `%${search}%`), like(products.brand, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({
      product: products,
      merchantId: merchants.id,
      merchantNo: merchants.merchantNo,
      companyName: merchants.companyName,
      merchantStatus: merchants.status,
    })
    .from(products)
    .leftJoin(merchants, eq(products.merchantId, merchants.id))
    .where(where)
    .orderBy(merchants.id, desc(products.createdAt));
  const groups: {
    merchantId: number | null;
    merchantNo: string | null;
    companyName: string | null;
    merchantStatus: string | null;
    products: (typeof rows)[number]["product"][];
  }[] = [];
  const groupMap = new Map<number | null, (typeof groups)[number]>();
  for (const row of rows) {
    let group = groupMap.get(row.merchantId);
    if (!group) {
      group = {
        merchantId: row.merchantId,
        merchantNo: row.merchantNo,
        companyName: row.companyName,
        merchantStatus: row.merchantStatus,
        products: [],
      };
      groupMap.set(row.merchantId, group);
      groups.push(group);
    }
    group.products.push(row.product);
  }
  return groups;
}

export async function updateProductStatus(id: number, status: string, reviewNote?: string, banReason?: string, reviewedBy?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(products).set({ status: status as any, reviewNote, banReason, reviewedBy, reviewedAt: new Date() }).where(eq(products.id, id));
}

export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).orderBy(categories.sortOrder);
}

// ─── 订单 ─────────────────────────────────────────────────────────────────────

export async function getOrders(params: { status?: string; search?: string; merchantId?: number; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { status, search, merchantId, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(orders.status, status as any));
  if (merchantId) conditions.push(eq(orders.merchantId, merchantId));
  if (search) conditions.push(or(like(orders.orderNo, `%${search}%`), like(orders.buyerName, `%${search}%`), like(orders.productName, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(where);
  const data = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function getOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getOrderStatusLogs(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orderStatusLogs).where(eq(orderStatusLogs.orderId, orderId)).orderBy(desc(orderStatusLogs.createdAt));
}

export async function updateOrderStatus(id: number, toStatus: string, operatorId: number, operatorName: string, note?: string) {
  const db = await getDb();
  if (!db) return;
  const order = await getOrderById(id);
  if (!order) return;
  await db.update(orders).set({ status: toStatus as any, note, updatedAt: new Date() }).where(eq(orders.id, id));
  await db.insert(orderStatusLogs).values({ orderId: id, orderNo: order.orderNo, fromStatus: order.status, toStatus, operatorId, operatorName, note });
}

// ─── 退款 ─────────────────────────────────────────────────────────────────────

export async function getRefunds(params: { status?: string; search?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { status, search, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(refunds.status, status as any));
  if (search) conditions.push(or(like(refunds.refundNo, `%${search}%`), like(refunds.orderNo, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(refunds).where(where);
  const data = await db.select().from(refunds).where(where).orderBy(desc(refunds.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function updateRefundStatus(id: number, status: string, reviewNote?: string, reviewedBy?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(refunds).set({ status: status as any, reviewNote, reviewedBy, reviewedAt: new Date() }).where(eq(refunds.id, id));
}

// ─── 财务 ─────────────────────────────────────────────────────────────────────

export async function getPaymentFlows(params: { flowType?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { flowType, status, search, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (flowType) conditions.push(eq(paymentFlows.flowType, flowType as any));
  if (status) conditions.push(eq(paymentFlows.status, status as any));
  if (search) conditions.push(or(like(paymentFlows.flowNo, `%${search}%`), like(paymentFlows.orderNo, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(paymentFlows).where(where);
  const data = await db.select().from(paymentFlows).where(where).orderBy(desc(paymentFlows.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function getSettlementBills(params: { merchantId?: number; status?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { merchantId, status, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (merchantId) conditions.push(eq(settlementBills.merchantId, merchantId));
  if (status) conditions.push(eq(settlementBills.status, status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(settlementBills).where(where);
  const data = await db.select().from(settlementBills).where(where).orderBy(desc(settlementBills.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

// ─── 审计日志 ─────────────────────────────────────────────────────────────────

export async function addAuditLog(entry: {
  operatorId?: number; operatorName?: string; operatorRole?: string;
  action: string; module?: string; targetType?: string; targetId?: string;
  beforeValue?: unknown; afterValue?: unknown; ipAddress?: string; userAgent?: string;
  result?: "success" | "failed" | "blocked"; note?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values(entry as any);
}

export async function getAuditLogs(params: { module?: string; operatorId?: number; search?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { module, operatorId, search, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (module) conditions.push(eq(auditLogs.module, module));
  if (operatorId) conditions.push(eq(auditLogs.operatorId, operatorId));
  if (search) conditions.push(or(like(auditLogs.action, `%${search}%`), like(auditLogs.operatorName, `%${search}%`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where);
  const data = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

// ─── 告警 ─────────────────────────────────────────────────────────────────────

export async function getAlerts(params: { status?: string; severity?: string; alertType?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { status, severity, alertType, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (status) conditions.push(eq(alerts.status, status as any));
  if (severity) conditions.push(eq(alerts.severity, severity as any));
  if (alertType) conditions.push(eq(alerts.alertType, alertType as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(alerts).where(where);
  const data = await db.select().from(alerts).where(where).orderBy(desc(alerts.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function createAlert(entry: {
  alertType: string; severity?: string; title: string; content?: string;
  relatedType?: string; relatedId?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(alerts).values(entry as any);
}

// 卡单扫描：已支付超过指定小时数仍未发货的订单
export async function getStuckOrders(hoursThreshold: number) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - hoursThreshold * 3600000);
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "paid"), lte(orders.paidAt, cutoff)));
}

// 资质到期扫描：营业执照在指定天数内到期的非清退商户
export async function getExpiringMerchants(daysAhead: number) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() + daysAhead * 86400000);
  return db
    .select()
    .from(merchants)
    .where(
      and(
        lte(merchants.licenseExpiry, cutoff),
        gte(merchants.licenseExpiry, new Date(0)),
        sql`${merchants.status} != 'terminated'`,
      ),
    );
}

// 查询是否已存在同类未处理告警，避免重复告警
export async function hasOpenAlert(alertType: string, relatedType: string, relatedId: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.alertType, alertType as any),
        eq(alerts.relatedType, relatedType),
        eq(alerts.relatedId, relatedId),
        or(eq(alerts.status, "open"), eq(alerts.status, "acknowledged")),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function updateAlertStatus(id: number, status: string, resolvedBy?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ status: status as any, resolvedBy, resolvedAt: status === "resolved" ? new Date() : undefined }).where(eq(alerts.id, id));
}

// ─── 风控分析 ─────────────────────────────────────────────────────────────────

export async function getRiskAnalyses(params: { targetType?: string; riskLevel?: string; status?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { targetType, riskLevel, status, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (targetType) conditions.push(eq(riskAnalyses.targetType, targetType as any));
  if (riskLevel) conditions.push(eq(riskAnalyses.riskLevel, riskLevel as any));
  if (status) conditions.push(eq(riskAnalyses.status, status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(riskAnalyses).where(where);
  const data = await db.select().from(riskAnalyses).where(where).orderBy(desc(riskAnalyses.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { data, total: Number(count) };
}

export async function saveRiskAnalysis(entry: {
  targetType: string; targetId: string; riskLevel: string;
  riskSummary: string; suggestions: string; rawData?: unknown;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(riskAnalyses).values(entry as any);
  return result;
}

export async function updateRiskAnalysisStatus(id: number, status: string, reviewedBy?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(riskAnalyses).set({ status: status as any, reviewedBy, reviewedAt: new Date() }).where(eq(riskAnalyses.id, id));
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
