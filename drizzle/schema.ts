import {
  bigint,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ─── 用户与权限 ──────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── 物料数据库 ────────────────────────────────────────────────────────────
export const materials = mysqlTable("materials", {
  id: int("id").autoincrement().primaryKey(),
  /** 物料编号，如 MAT20260001 */
  materialNo: varchar("materialNo", { length: 32 }).notNull().unique(),
  /** 元器件型号，如 STM32F103C8T6 */
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  /** 物料名称 */
  name: varchar("name", { length: 256 }).notNull(),
  /** 品牌/制造商 */
  brand: varchar("brand", { length: 128 }),
  /** 分类，如 微控制器/存储器/电阻/电容 */
  category: varchar("category", { length: 64 }),
  /** 封装，如 LQFP48 / SOP8 / 0402 */
  package: varchar("package", { length: 64 }),
  /** 参数描述 */
  description: text("description"),
  /** 结构化参数（JSON键值对），如 {"CPU内核":"ARM Cortex-M3","主频":"72MHz","Flash":"64KB"} */
  specs: json("specs").$type<Record<string, string>>(),
  /** 参考单价（元） */
  referencePrice: varchar("referencePrice", { length: 32 }),
  /** 库存单位，如 片/颗/只/个 */
  unit: varchar("unit", { length: 16 }).default("个"),
  /** 无铅/RoHS 状态 */
  rohs: mysqlEnum("rohs", ["compliant", "non_compliant", "unknown"]).default("unknown").notNull(),
  /** 生命周期状态 */
  lifecycle: mysqlEnum("lifecycle", ["active", "nrnd", "eol", "obsolete"]).default("active").notNull(),
  /** 数据手册链接 */
  datasheetUrl: varchar("datasheetUrl", { length: 512 }),
  /** PDF 规格书（平台存储）：S3 key */
  datasheetFileKey: varchar("datasheetFileKey", { length: 512 }),
  /** PDF 规格书文件名（原始文件名，用于展示与下载） */
  datasheetFileName: varchar("datasheetFileName", { length: 256 }),
  /** PDF 规格书文件大小（字节） */
  datasheetFileSize: int("datasheetFileSize"),
  /** 封面图 URL（/manus-storage/...，用于列表缩略图与前台展示） */
  coverImageUrl: varchar("coverImageUrl", { length: 512 }),
  /** 产品图集（JSON 数组，每项含 url/key/name），前台详情页轮播调用 */
  images: json("images").$type<{ url: string; key: string; name?: string }[]>(),
  /** 状态：启用/停用 */
  status: mysqlEnum("status", ["enabled", "disabled"]).default("enabled").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

// 管理员角色枚举
export const adminRoleEnum = mysqlEnum("adminRole", [
  "super_admin",   // 超级管理员
  "operation",     // 平台运营
  "merchant_mgr",  // 商户管理
  "customer_svc",  // 客服/售后
  "risk_control",  // 风控审核
  "finance",       // 财务结算
  "auditor",       // 审计人员
]);

export const adminUsers = mysqlTable("admin_users", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  displayName: varchar("displayName", { length: 128 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  adminRole: mysqlEnum("adminRole", [
    "super_admin", "operation", "merchant_mgr", "customer_svc",
    "risk_control", "finance", "auditor",
  ]).default("operation").notNull(),
  status: mysqlEnum("status", ["active", "disabled", "locked"]).default("active").notNull(),
  mfaEnabled: boolean("mfaEnabled").default(false),
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdminUser = typeof adminUsers.$inferSelect;

// ─── 商户管理 ─────────────────────────────────────────────────────────────────

export const merchants = mysqlTable("merchants", {
  id: int("id").autoincrement().primaryKey(),
  merchantNo: varchar("merchantNo", { length: 32 }).notNull().unique(),
  companyName: varchar("companyName", { length: 256 }).notNull(),
  contactName: varchar("contactName", { length: 64 }),
  contactPhone: varchar("contactPhone", { length: 20 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  businessLicense: varchar("businessLicense", { length: 64 }),
  licenseExpiry: timestamp("licenseExpiry"),
  licenseImageUrl: varchar("licenseImageUrl", { length: 512 }),
  registeredCapital: varchar("registeredCapital", { length: 64 }),
  registeredAddress: varchar("registeredAddress", { length: 512 }),
  businessScope: text("businessScope"),
  establishedDate: timestamp("establishedDate"),
  legalPersonName: varchar("legalPersonName", { length: 64 }),
  legalPersonIdNo: varchar("legalPersonIdNo", { length: 32 }),
  legalPersonPhone: varchar("legalPersonPhone", { length: 20 }),
  status: mysqlEnum("status", [
    "draft", "pending", "supplement", "approved", "suspended", "terminated",
  ]).default("pending").notNull(),
  agreementStatus: mysqlEnum("agreementStatus", [
    "unsigned", "signed", "expired",
  ]).default("unsigned").notNull(),
  settlementAccount: varchar("settlementAccount", { length: 64 }),
  settlementBank: varchar("settlementBank", { length: 128 }),
  settlementAccountName: varchar("settlementAccountName", { length: 128 }),
  commissionRate: decimal("commissionRate", { precision: 5, scale: 4 }).default("0.0300"),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Merchant = typeof merchants.$inferSelect;

// ─── 商品与库存 ───────────────────────────────────────────────────────────────

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  parentId: int("parentId"),
  level: int("level").default(1),
  sortOrder: int("sortOrder").default(0),
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  productNo: varchar("productNo", { length: 32 }).notNull().unique(),
  merchantId: int("merchantId").notNull(),
  categoryId: int("categoryId"),
  name: varchar("name", { length: 256 }).notNull(),
  brand: varchar("brand", { length: 64 }),
  model: varchar("model", { length: 128 }),
  packageType: varchar("packageType", { length: 64 }),
  spec: text("spec"),
  price: decimal("price", { precision: 12, scale: 4 }),
  stockQty: bigint("stockQty", { mode: "number" }).default(0),
  lockedQty: bigint("lockedQty", { mode: "number" }).default(0),
  unit: varchar("unit", { length: 16 }).default("片"),
  grade: mysqlEnum("grade", ["A", "B", "C", "unknown"]).default("A"),
  status: mysqlEnum("status", [
    "draft", "pending_review", "active", "inactive", "banned",
  ]).default("pending_review").notNull(),
  banReason: text("banReason"),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;

export const inventoryLogs = mysqlTable("inventory_logs", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  merchantId: int("merchantId").notNull(),
  changeType: mysqlEnum("changeType", [
    "inbound", "outbound", "lock", "unlock", "adjust", "return",
  ]).notNull(),
  changeQty: bigint("changeQty", { mode: "number" }).notNull(),
  beforeQty: bigint("beforeQty", { mode: "number" }).notNull(),
  afterQty: bigint("afterQty", { mode: "number" }).notNull(),
  relatedOrderNo: varchar("relatedOrderNo", { length: 64 }),
  note: text("note"),
  operatorId: int("operatorId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── 订单管理 ─────────────────────────────────────────────────────────────────

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNo: varchar("orderNo", { length: 64 }).notNull().unique(),
  buyerUserId: int("buyerUserId"),
  buyerName: varchar("buyerName", { length: 128 }),
  merchantId: int("merchantId").notNull(),
  productId: int("productId").notNull(),
  productName: varchar("productName", { length: 256 }),
  qty: bigint("qty", { mode: "number" }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 4 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 4 }).notNull(),
  platformFee: decimal("platformFee", { precision: 12, scale: 4 }).default("0.0000"),
  merchantAmount: decimal("merchantAmount", { precision: 12, scale: 4 }),
  status: mysqlEnum("status", [
    "pending_payment", "paid", "processing", "shipped",
    "completed", "cancelled", "refunding", "refunded", "abnormal",
  ]).default("pending_payment").notNull(),
  abnormalTag: varchar("abnormalTag", { length: 64 }),
  settlementBillId: int("settlementBillId"),
  cancelReason: text("cancelReason"),
  note: text("note"),
  paidAt: timestamp("paidAt"),
  shippedAt: timestamp("shippedAt"),
  completedAt: timestamp("completedAt"),
  cancelledAt: timestamp("cancelledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;

export const orderStatusLogs = mysqlTable("order_status_logs", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  orderNo: varchar("orderNo", { length: 64 }),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }).notNull(),
  operatorId: int("operatorId"),
  operatorName: varchar("operatorName", { length: 64 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── 退款管理 ─────────────────────────────────────────────────────────────────

export const refunds = mysqlTable("refunds", {
  id: int("id").autoincrement().primaryKey(),
  refundNo: varchar("refundNo", { length: 64 }).notNull().unique(),
  orderId: int("orderId").notNull(),
  orderNo: varchar("orderNo", { length: 64 }),
  merchantId: int("merchantId"),
  applicantUserId: int("applicantUserId"),
  refundAmount: decimal("refundAmount", { precision: 12, scale: 4 }).notNull(),
  refundReason: text("refundReason"),
  evidenceUrls: json("evidenceUrls").$type<string[]>(),
  status: mysqlEnum("status", [
    "pending", "reviewing", "approved", "rejected", "executing", "completed", "failed",
  ]).default("pending").notNull(),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  executedAt: timestamp("executedAt"),
  failReason: text("failReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Refund = typeof refunds.$inferSelect;

// ─── 财务账本 ─────────────────────────────────────────────────────────────────

export const paymentFlows = mysqlTable("payment_flows", {
  id: int("id").autoincrement().primaryKey(),
  flowNo: varchar("flowNo", { length: 64 }).notNull().unique(),
  orderId: int("orderId"),
  orderNo: varchar("orderNo", { length: 64 }),
  merchantId: int("merchantId"),
  flowType: mysqlEnum("flowType", [
    "payment", "refund", "platform_fee", "settlement", "adjustment",
  ]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 4 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("CNY"),
  channel: varchar("channel", { length: 32 }),
  channelFlowNo: varchar("channelFlowNo", { length: 128 }),
  status: mysqlEnum("status", [
    "pending", "success", "failed", "cancelled",
  ]).default("pending").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PaymentFlow = typeof paymentFlows.$inferSelect;

export const settlementBills = mysqlTable("settlement_bills", {
  id: int("id").autoincrement().primaryKey(),
  billNo: varchar("billNo", { length: 64 }).notNull().unique(),
  merchantId: int("merchantId").notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  totalOrderAmount: decimal("totalOrderAmount", { precision: 14, scale: 4 }).default("0.0000"),
  platformFeeTotal: decimal("platformFeeTotal", { precision: 12, scale: 4 }).default("0.0000"),
  refundTotal: decimal("refundTotal", { precision: 12, scale: 4 }).default("0.0000"),
  settlementAmount: decimal("settlementAmount", { precision: 14, scale: 4 }).notNull(),
  status: mysqlEnum("status", [
    "draft", "confirmed", "paying", "paid", "failed",
  ]).default("draft").notNull(),
  paidAt: timestamp("paidAt"),
  failReason: text("failReason"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SettlementBill = typeof settlementBills.$inferSelect;

// ─── 审计日志 ─────────────────────────────────────────────────────────────────

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  operatorId: int("operatorId"),
  operatorName: varchar("operatorName", { length: 64 }),
  operatorRole: varchar("operatorRole", { length: 32 }),
  action: varchar("action", { length: 128 }).notNull(),
  module: varchar("module", { length: 64 }),
  targetType: varchar("targetType", { length: 64 }),
  targetId: varchar("targetId", { length: 64 }),
  beforeValue: json("beforeValue"),
  afterValue: json("afterValue"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  result: mysqlEnum("result", ["success", "failed", "blocked"]).default("success"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ─── 告警与任务 ───────────────────────────────────────────────────────────────

export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  alertType: mysqlEnum("alertType", [
    "stuck_order", "refund_abnormal", "license_expiry",
    "settlement_failed", "risk_merchant", "system_error",
    "order_stuck", "task_failed",
  ]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("warning").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content"),
  relatedType: varchar("relatedType", { length: 64 }),
  relatedId: varchar("relatedId", { length: 64 }),
  status: mysqlEnum("status", ["open", "acknowledged", "resolved", "ignored"]).default("open").notNull(),
  assignedTo: int("assignedTo"),
  resolvedBy: int("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  notificationSent: boolean("notificationSent").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Alert = typeof alerts.$inferSelect;

// ─── 风控分析 ─────────────────────────────────────────────────────────────────

export const riskAnalyses = mysqlTable("risk_analyses", {
  id: int("id").autoincrement().primaryKey(),
  targetType: mysqlEnum("targetType", ["order", "merchant", "refund"]).notNull(),
  targetId: varchar("targetId", { length: 64 }).notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("low").notNull(),
  riskSummary: text("riskSummary"),
  suggestions: text("suggestions"),
  rawData: json("rawData"),
  analyzedBy: varchar("analyzedBy", { length: 32 }).default("llm"),
  status: mysqlEnum("status", ["pending", "reviewed", "actioned", "dismissed"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RiskAnalysis = typeof riskAnalyses.$inferSelect;
