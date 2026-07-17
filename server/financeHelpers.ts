import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { orders, paymentFlows, settlementBills } from "../drizzle/schema";
import { getDb } from "./db";

// ─── 财务汇总 ─────────────────────────────────────────────────────────────────

export async function getFinanceSummary() {
  const db = await getDb();
  if (!db) return null;
  const [payment] = await db
    .select({ total: sql<string>`COALESCE(sum(amount), 0)` })
    .from(paymentFlows)
    .where(and(eq(paymentFlows.flowType, "payment"), eq(paymentFlows.status, "success")));
  const [fee] = await db
    .select({ total: sql<string>`COALESCE(sum(amount), 0)` })
    .from(paymentFlows)
    .where(and(eq(paymentFlows.flowType, "platform_fee"), eq(paymentFlows.status, "success")));
  const [refund] = await db
    .select({ total: sql<string>`COALESCE(sum(amount), 0)` })
    .from(paymentFlows)
    .where(and(eq(paymentFlows.flowType, "refund"), eq(paymentFlows.status, "success")));
  // 商户应结余额 = 已完成未结算订单的（总额 - 平台服务费）
  const [pending] = await db
    .select({ total: sql<string>`COALESCE(sum(totalAmount - platformFee), 0)` })
    .from(orders)
    .where(and(eq(orders.status, "completed"), isNull(orders.settlementBillId)));
  return {
    totalPayment: parseFloat(payment?.total ?? "0"),
    totalPlatformFee: parseFloat(fee?.total ?? "0"),
    totalRefund: parseFloat(refund?.total ?? "0"),
    pendingSettlement: parseFloat(pending?.total ?? "0"),
  };
}

// ─── 结算单生成 ───────────────────────────────────────────────────────────────

export async function generateSettlementBill(merchantId: number, createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 查询该商户所有已完成且未结算的订单
  const unsettled = await db
    .select()
    .from(orders)
    .where(and(eq(orders.merchantId, merchantId), eq(orders.status, "completed"), isNull(orders.settlementBillId)));

  if (unsettled.length === 0) {
    throw new Error("该商户暂无可结算的已完成订单");
  }

  const totalOrderAmount = unsettled.reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const platformFeeTotal = unsettled.reduce((s, o) => s + parseFloat(o.platformFee ?? "0"), 0);
  const settlementAmount = totalOrderAmount - platformFeeTotal;

  const dates = unsettled.map(o => o.createdAt.getTime());
  const periodStart = new Date(Math.min(...dates));
  const periodEnd = new Date(Math.max(...dates));

  const billNo = `JS${Date.now()}${String(merchantId).padStart(4, "0")}`;

  const [result] = await db.insert(settlementBills).values({
    billNo,
    merchantId,
    periodStart,
    periodEnd,
    totalOrderAmount: totalOrderAmount.toFixed(4),
    platformFeeTotal: platformFeeTotal.toFixed(4),
    refundTotal: "0.0000",
    settlementAmount: settlementAmount.toFixed(4),
    status: "draft",
    createdBy,
  });

  const billId = result.insertId;

  // 关联订单到结算单
  for (const o of unsettled) {
    await db.update(orders).set({ settlementBillId: billId }).where(eq(orders.id, o.id));
  }

  return {
    id: billId,
    settlementNo: billNo,
    orderCount: unsettled.length,
    totalAmount: totalOrderAmount,
    feeAmount: platformFeeTotal,
    netAmount: settlementAmount,
  };
}

export async function updateSettlementStatus(id: number, action: "confirm" | "pay" | "paid" | "fail", failReason?: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const statusMap: Record<string, "confirmed" | "paying" | "paid" | "failed"> = {
    confirm: "confirmed",
    pay: "paying",
    paid: "paid",
    fail: "failed",
  };
  const updates: Record<string, unknown> = { status: statusMap[action] };
  if (action === "paid") updates.paidAt = new Date();
  if (action === "fail" && failReason) updates.failReason = failReason;
  await db.update(settlementBills).set(updates).where(eq(settlementBills.id, id));
  const [bill] = await db.select().from(settlementBills).where(eq(settlementBills.id, id)).limit(1);
  return bill ?? null;
}

// ─── 结算单列表（带商户名）────────────────────────────────────────────────────

export async function getSettlementBillsWithMerchant(params: { merchantId?: number; status?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const { merchantId, status, page = 1, pageSize = 20 } = params;
  const conditions = [];
  if (merchantId) conditions.push(eq(settlementBills.merchantId, merchantId));
  if (status) conditions.push(eq(settlementBills.status, status as "draft" | "confirmed" | "paying" | "paid" | "failed"));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(settlementBills).where(where);
  const bills = await db
    .select()
    .from(settlementBills)
    .where(where)
    .orderBy(desc(settlementBills.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // 统计每个结算单的订单数并查商户名
  const { merchants } = await import("../drizzle/schema");
  const data = [];
  for (const bill of bills) {
    const [m] = await db.select({ companyName: merchants.companyName }).from(merchants).where(eq(merchants.id, bill.merchantId)).limit(1);
    const [{ orderCount }] = await db.select({ orderCount: sql<number>`count(*)` }).from(orders).where(eq(orders.settlementBillId, bill.id));
    data.push({
      id: bill.id,
      settlementNo: bill.billNo,
      merchantId: bill.merchantId,
      merchantName: m?.companyName ?? null,
      orderCount: Number(orderCount ?? 0),
      totalAmount: bill.totalOrderAmount ?? "0",
      feeAmount: bill.platformFeeTotal ?? "0",
      netAmount: bill.settlementAmount,
      status: bill.status,
      paidAt: bill.paidAt,
      failReason: bill.failReason,
      createdAt: bill.createdAt,
    });
  }
  return { data, total: Number(count) };
}
