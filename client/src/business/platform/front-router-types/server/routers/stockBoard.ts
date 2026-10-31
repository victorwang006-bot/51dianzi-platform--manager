import { z } from "zod";
import { sql } from "drizzle-orm";
import { createCrmAnyPermissionProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { CNY_TAX_INCLUDED } from "../../../shared/inboundPricing";
import {
  classifyInboundPayment,
  inboundMoneyCents,
  inboundMoneyStringFromCents,
  inboundPayableCents,
  inboundPaymentPercentage,
} from "../../../shared/inboundPayment";

/** 独立页面已下线；只读旧调用兼容历史看板权限及整合后的入库权限。 */
const inventoryDashboardProcedure = createCrmAnyPermissionProcedure([
  "inventory.dashboard",
  "inventory.inbound",
]);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" ,
    });
  return db;
}

type LedgerSummaryRow = {
  partNumber: string;
  brand: string | null;
  totalQtyIn: number;
  totalQtyOut: number;
  currentQty: number;
  avgCost: string | null;
};

type BoardStatsRow = {
  totalValue: string | null;
  totalQty: number;
  totalProfit: string | null;
  unknownValueRows: number;
  unknownProfitRows: number;
};

const timeRangeSchema = z.enum(["today", "week", "month", "quarter", "year", "all",
]);

function rangeStart(range: z.infer<typeof timeRangeSchema>): string | null {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  switch (range) {
    case "today":
      return fmt(now);
    case "week": {
      const day = now.getDay() || 7;
      const d = new Date(now);
      d.setDate(now.getDate() - day + 1);
      return fmt(d);
    }
    case "month":
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    case "quarter": {
      const qm = Math.floor(now.getMonth() / 3) * 3;
      return `${now.getFullYear()}-${pad(qm + 1)}-01`;
    }
    case "year":
      return `${now.getFullYear()}-01-01`;
    default:
      return null;
  }
}

export const stockBoardRouter = router({
  /** 看板汇总数据：总价值、总数量、达成利润（支持时间段） */
  summary: inventoryDashboardProcedure
    .input(z.object({ profitRange: timeRangeSchema.default("month") }).optional())
    .query(async ({ ctx, input }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;
    const start = rangeStart(input?.profitRange ?? "month");

    // 总库存价值 = SUM(currentQty * avgCost)
    // 达成利润 = SUM(出库数量 * (出库单价 - avgCost))
    const profitCondition = start
      ? sql`o.userId = ${userId} AND o.outboundDate >= ${start}`
      : sql`o.userId = ${userId}`;
    const statsResult = await db.execute(sql`
      SELECT
        SUM(CASE WHEN sl.avgCost IS NOT NULL AND sl.costBasis = 'CNY_TAX_INCLUDED'
                 THEN sl.currentQty * sl.avgCost ELSE 0 END) AS totalValue,
        SUM(sl.currentQty) AS totalQty,
        COALESCE((
          SELECT SUM(CASE WHEN o.unitPrice IS NOT NULL AND o.unitPriceBasis = 'CNY_TAX_INCLUDED'
                                AND o.unitCost IS NOT NULL AND o.unitCostBasis = 'CNY_TAX_INCLUDED'
                          THEN o.qty * (o.unitPrice - o.unitCost) ELSE 0 END)
          FROM outbound_orders o
          WHERE ${profitCondition}
        ), 0) AS totalProfit,
        SUM(CASE WHEN sl.currentQty > 0 AND (sl.avgCost IS NULL OR sl.costBasis IS NULL OR sl.costBasis <> 'CNY_TAX_INCLUDED') THEN 1 ELSE 0 END) AS unknownValueRows,
        (SELECT COUNT(*) FROM outbound_orders o WHERE ${profitCondition}
          AND (o.unitPrice IS NULL OR o.unitPriceBasis IS NULL OR o.unitPriceBasis <> 'CNY_TAX_INCLUDED'
            OR o.unitCost IS NULL OR o.unitCostBasis IS NULL OR o.unitCostBasis <> 'CNY_TAX_INCLUDED')) AS unknownProfitRows
      FROM stock_ledger sl
      WHERE sl.userId = ${userId}
    `);
    const statsRows = (statsResult as unknown as [BoardStatsRow[], unknown])[0];
    const stats = statsRows[0] ?? { totalValue: "0", totalQty: 0, totalProfit: "0", unknownValueRows: 0, unknownProfitRows: 0 ,
      };

    return {
      totalValue: Number(stats.totalValue ?? 0),
      totalQty: Number(stats.totalQty ?? 0),
      totalProfit: Number(stats.totalProfit ?? 0),
      totalValueComplete: Number(stats.unknownValueRows ?? 0) === 0,
      totalProfitComplete: Number(stats.unknownProfitRows ?? 0) === 0,
    };
  }),

  /** 采购付款看板：独立于库存资产估值，历史未登记单据不推断为未付款。 */
  purchasePayments: inventoryDashboardProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;
    const result = await db.execute(sql`
      SELECT io.id, io.slipNo, io.status, io.partNumber, io.supplierName,
             io.qty, io.actualQty, io.unitCost, io.unitCostBasis, io.unitCostTaxIncluded,
             io.inboundDate, io.actualInboundDate, io.paymentTrackedAt,
             (SELECT COALESCE(SUM(pe.amount), 0)
                FROM inbound_payment_entries pe
               WHERE pe.inboundOrderId = io.id AND pe.ownerUserId = io.userId AND pe.voidedAt IS NULL) AS paidAmount
        FROM inbound_orders io
       WHERE io.userId = ${userId}
       ORDER BY io.createdAt DESC
    `);
    const sourceRows = (result as unknown as [Array<{
      id: number; slipNo: string; status: "in_transit" | "received" | "cancelled";
      partNumber: string; supplierName: string | null; qty: number; actualQty: number | null;
      unitCost: string | null; unitCostBasis: string | null; unitCostTaxIncluded: string | null;
      inboundDate: string; actualInboundDate: string | null; paymentTrackedAt: Date | null; paidAmount: string;
    }>, unknown])[0];
    let inTransitPayableCents = BigInt(0);
    let inTransitPaidCents = BigInt(0);
    let receivedPaidCents = BigInt(0);
    let totalPaidCents = BigInt(0);
    let outstandingCents = BigInt(0);
    let cancelledPendingCents = BigInt(0);
    let untrackedCount = 0;
    const rows = sourceRows.map(row => {
      const unitCostTaxIncluded = row.unitCostTaxIncluded
        ?? (row.unitCost != null && row.unitCostBasis === CNY_TAX_INCLUDED ? row.unitCost : null);
      const effectiveQty = Number(row.actualQty ?? row.qty);
      const payableCents = unitCostTaxIncluded == null ? null : inboundPayableCents(unitCostTaxIncluded, effectiveQty);
      const paidCents = inboundMoneyCents(row.paidAmount ?? 0);
      const payableAmount = payableCents == null ? null : inboundMoneyStringFromCents(payableCents);
      const paidAmount = inboundMoneyStringFromCents(paidCents);
      const tracked = row.paymentTrackedAt != null;
      const paymentCategory = classifyInboundPayment({
        tracked,
        cancelled: row.status === "cancelled",
        payableAmount,
        paidAmount,
      });
      if (row.status === "in_transit" && payableCents != null) inTransitPayableCents += payableCents;
      if (row.status === "in_transit") inTransitPaidCents += paidCents;
      if (row.status === "received") receivedPaidCents += paidCents;
      totalPaidCents += paidCents;
      if (!tracked) untrackedCount += 1;
      if (tracked && row.status !== "cancelled" && payableCents != null && payableCents > paidCents) {
        outstandingCents += payableCents - paidCents;
      }
      if (row.status === "cancelled" && paidCents > BigInt(0)) cancelledPendingCents += paidCents;
      const outstanding = payableCents == null || paidCents >= payableCents
        ? BigInt(0)
        : payableCents - paidCents;
      const overpaid = payableCents == null || paidCents <= payableCents
        ? BigInt(0)
        : paidCents - payableCents;
      return {
        id: Number(row.id),
        slipNo: row.slipNo,
        status: row.status,
        partNumber: row.partNumber,
        supplierName: row.supplierName,
        qty: effectiveQty,
        unitCostTaxIncluded,
        bizDate: row.actualInboundDate ?? row.inboundDate,
        paymentTracked: tracked,
        paymentCategory,
        payableAmount,
        paidAmount,
        outstandingAmount: inboundMoneyStringFromCents(outstanding),
        overpaidAmount: inboundMoneyStringFromCents(overpaid),
        paymentPercentage: inboundPaymentPercentage(paidAmount, payableAmount),
      };
    });
    return {
      summary: {
        inTransitPayableAmount: inboundMoneyStringFromCents(inTransitPayableCents),
        inTransitPaidAmount: inboundMoneyStringFromCents(inTransitPaidCents),
        receivedPaidAmount: inboundMoneyStringFromCents(receivedPaidCents),
        totalPaidAmount: inboundMoneyStringFromCents(totalPaidCents),
        outstandingAmount: inboundMoneyStringFromCents(outstandingCents),
        cancelledPendingAmount: inboundMoneyStringFromCents(cancelledPendingCents),
        untrackedCount,
      },
      rows,
    };
  }),

  /** 按型号汇总的库存明细列表 */
  ledgerList: inventoryDashboardProcedure
    .input(z.object({ partNumber: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.effectiveUserId!;

      if (input?.partNumber) {
        const result = await db.execute(sql`
          SELECT partNumber, brand, totalQtyIn, totalQtyOut, currentQty, avgCost
          FROM stock_ledger
          WHERE userId = ${userId} AND partNumber LIKE ${`%${input.partNumber}%`}
          ORDER BY currentQty DESC
        `);
        return (result as unknown as [LedgerSummaryRow[], unknown])[0];
      }

      const result = await db.execute(sql`
        SELECT partNumber, brand, totalQtyIn, totalQtyOut, currentQty, avgCost
        FROM stock_ledger
        WHERE userId = ${userId}
        ORDER BY currentQty DESC
      `);
      return (result as unknown as [LedgerSummaryRow[], unknown])[0];
    }),

  /** 看板明细流水：所有入库+出库记录（含利润计算字段） */
  movements: inventoryDashboardProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;

    const inResult = await db.execute(sql`
      SELECT 'inbound' AS type, id, slipNo, partNumber, COALESCE(actualQty, qty) AS qty,
             CASE WHEN unitCostTaxIncluded IS NOT NULL THEN unitCostTaxIncluded
                  WHEN unitCostBasis = 'CNY_TAX_INCLUDED' OR unitCostBasis IS NULL THEN unitCost
                  ELSE NULL END AS price,
             NULL AS profit,
             COALESCE(actualInboundDate, inboundDate) AS bizDate, operator AS person, location, supplierName AS party, createdAt
      FROM inbound_orders WHERE userId = ${userId} AND status = 'received'
    `);
    const outResult = await db.execute(sql`
      SELECT 'outbound' AS type, o.id, o.slipNo, o.partNumber, o.qty, o.unitPrice AS price,
             CASE WHEN o.unitPrice IS NOT NULL AND o.unitPriceBasis = 'CNY_TAX_INCLUDED'
                        AND o.unitCost IS NOT NULL AND o.unitCostBasis = 'CNY_TAX_INCLUDED'
                  THEN o.qty * (o.unitPrice - o.unitCost) ELSE NULL END AS profit,
             o.outboundDate AS bizDate, o.salesName AS person,
             (SELECT i.location FROM inbound_orders i WHERE i.userId = o.userId AND i.partNumber = o.partNumber AND i.status = 'received' ORDER BY i.receivedAt DESC, i.createdAt DESC LIMIT 1) AS location,
             o.customerName AS party, o.createdAt
      FROM outbound_orders o WHERE o.userId = ${userId}
    `);

    const inRows = (inResult as unknown as [any[], unknown])[0];
    const outRows = (outResult as unknown as [any[], unknown])[0];
    return [...inRows, ...outRows].sort(
      (a, b) => new Date(b.bizDate).getTime() - new Date(a.bizDate).getTime()
    );
  }),

  /** 近期出入库动态（最近 20 条） */
  recentActivity: inventoryDashboardProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const userId = ctx.effectiveUserId!;

    const inResult = await db.execute(sql`
      SELECT 'in' AS type, slipNo, partNumber, COALESCE(actualQty, qty) AS qty,
             COALESCE(actualInboundDate, inboundDate) AS bizDate, operator, COALESCE(receivedAt, createdAt) AS activityAt, createdAt
      FROM inbound_orders WHERE userId = ${userId} AND status = 'received'
      ORDER BY receivedAt DESC, createdAt DESC LIMIT 10
    `);
    const outResult = await db.execute(sql`
      SELECT 'out' AS type, slipNo, partNumber, qty, outboundDate AS bizDate, salesName AS operator, createdAt AS activityAt, createdAt
      FROM outbound_orders WHERE userId = ${userId}
      ORDER BY createdAt DESC LIMIT 10
    `);

    const inRows = (inResult as unknown as [any[], unknown])[0];
    const outRows = (outResult as unknown as [any[], unknown])[0];
    const combined = [...inRows, ...outRows].sort(
      (a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
    );
    return combined.slice(0, 20);
  }),
});
