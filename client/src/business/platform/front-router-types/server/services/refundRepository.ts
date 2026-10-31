/**
 * 退款单仓储层：集中所有 order_refunds 的读写。
 *
 * 单独分层的原因：退款单承载真实资金，状态流转必须收口在一处。
 * 若让路由各自拼 SQL，很容易出现某个入口漏写 approvedAt、
 * 或把 succeeded 又改回 processing 这类难以追查的资金状态污染。
 */
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  orderRefunds,
  type InsertOrderRefund,
  type OrderRefund,
  type RefundStatus,
} from "../../drizzle/schema";

/** 视为"进行中"的退款状态：存在这些状态的退款单时不允许再次申请。 */
export const REFUND_ACTIVE_STATUSES: RefundStatus[] = [
  "requested",
  "awaiting_return",
  "approved",
  "processing",
  "pending_offline",
  "manual_review",
];

export async function createRefund(values: InsertOrderRefund): Promise<OrderRefund | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(orderRefunds).values(values);
  return getRefundByNo(values.refundNo);
}

export async function getRefundById(id: number): Promise<OrderRefund | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.id, id)).limit(1);
  return row ?? null;
}

export async function getRefundByNo(refundNo: string): Promise<OrderRefund | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orderRefunds)
    .where(eq(orderRefunds.refundNo, refundNo))
    .limit(1);
  return row ?? null;
}

export async function getRefundByOrderId(orderId: number): Promise<OrderRefund | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orderRefunds)
    .where(eq(orderRefunds.orderId, orderId))
    .limit(1);
  return row ?? null;
}

export async function getRefundsByOrderIds(orderIds: number[]): Promise<OrderRefund[]> {
  const db = await getDb();
  if (!db || orderIds.length === 0) return [];
  return db.select().from(orderRefunds).where(inArray(orderRefunds.orderId, orderIds));
}

export async function updateRefund(id: number, patch: Partial<InsertOrderRefund>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.update(orderRefunds).set(patch).where(eq(orderRefunds.id, id));
}

/**
 * 带前置状态校验的更新（乐观并发控制）。
 *
 * 只有当前状态仍是 expected 之一时才更新，返回是否成功。
 * 这是防重复退款的关键：卖家点"通过售后"与 Worker 24h 自动退款
 * 可能同时发生，两者都先把状态从 requested 抢到 approved，
 * 只有抢到的那一方才继续调用渠道，另一方直接放弃。
 */
export async function transitionRefund(
  id: number,
  expected: RefundStatus[],
  patch: Partial<InsertOrderRefund>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const res = await db
    .update(orderRefunds)
    .set(patch)
    .where(and(eq(orderRefunds.id, id), inArray(orderRefunds.status, expected)));
  const affected = (res as unknown as { rowsAffected?: number })?.rowsAffected ?? 0;
  return affected > 0;
}

/** 查某订单是否存在进行中的退款单 */
export async function findActiveRefundByOrderId(orderId: number): Promise<OrderRefund | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orderRefunds)
    .where(
      and(
        eq(orderRefunds.orderId, orderId),
        inArray(orderRefunds.status, REFUND_ACTIVE_STATUSES),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Worker 用：扫描已到自动通过时刻的未发货退款单。
 *
 * 只取 shippedWhenRequested = false 的单——已发货订单必须等买家寄回、
 * 卖家确认收货，绝不能自动放款，否则卖家货款两失。
 */
export async function listAutoApprovableRefunds(limit = 20): Promise<OrderRefund[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orderRefunds)
    .where(
      and(
        eq(orderRefunds.status, "requested"),
        eq(orderRefunds.shippedWhenRequested, false),
        isNotNull(orderRefunds.autoApproveAt),
        lte(orderRefunds.autoApproveAt, sql`NOW()`),
      ),
    )
    .orderBy(orderRefunds.autoApproveAt)
    .limit(limit);
}

/** Worker 用：待执行渠道退款（已通过但尚未提交渠道）与待查询结果的单 */
export async function listRefundsForChannel(limit = 20): Promise<OrderRefund[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orderRefunds)
    .where(inArray(orderRefunds.status, ["approved", "processing"]))
    .orderBy(orderRefunds.id)
    .limit(limit);
}

/** 买家/卖家的退款单列表 */
export async function listRefundsByUser(
  userId: number,
  role: "buyer" | "seller",
  limit = 50,
): Promise<OrderRefund[]> {
  const db = await getDb();
  if (!db) return [];
  const col = role === "buyer" ? orderRefunds.buyerId : orderRefunds.sellerId;
  return db
    .select()
    .from(orderRefunds)
    .where(eq(col, userId))
    .orderBy(desc(orderRefunds.createdAt))
    .limit(limit);
}
