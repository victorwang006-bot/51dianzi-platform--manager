import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  ERP_COFFEE_CAMPAIGN_CODE,
  resendCoffeeVoucherNotification,
} from "../services/coffeeVoucherCampaign";

type CampaignSummaryRow = {
  id: number;
  code: string;
  title: string;
  status: "draft" | "active" | "paused" | "exhausted" | "ended";
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  totalCount: number | string;
  availableCount: number | string;
  assignedCount: number | string;
  voidCount: number | string;
  sentCount: number | string;
  failedCount: number | string;
};

type AssignmentRow = {
  id: number;
  companyName: string | null;
  maskedCreditCode: string;
  username: string | null;
  userName: string | null;
  notificationStatus: "pending" | "sent" | "failed";
  erpActivatedAt: Date | string;
  assignedAt: Date | string;
  notifiedAt: Date | string | null;
  lastError: string | null;
};

function rowsOf<T>(value: unknown): T[] {
  return (value as [T[], unknown])[0] ?? [];
}

async function getCampaignId(): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const result = await db.execute(sql`
    SELECT id
      FROM coffee_voucher_campaigns
     WHERE code = ${ERP_COFFEE_CAMPAIGN_CODE}
     LIMIT 1
  `);
  return Number(rowsOf<{ id: number }>(result)[0]?.id ?? 0) || null;
}

export const coffeeVoucherRouter = router({
  status: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const result = await db.execute(sql`
      SELECT
        c.id,
        c.code,
        c.title,
        c.status,
        c.startsAt,
        c.endsAt,
        COUNT(v.id) AS totalCount,
        SUM(CASE WHEN v.status = 'available' THEN 1 ELSE 0 END) AS availableCount,
        SUM(CASE WHEN v.status = 'assigned' THEN 1 ELSE 0 END) AS assignedCount,
        SUM(CASE WHEN v.status = 'void' THEN 1 ELSE 0 END) AS voidCount,
        (SELECT COUNT(*) FROM coffee_voucher_assignments a
          WHERE a.campaignId = c.id AND a.notificationStatus = 'sent') AS sentCount,
        (SELECT COUNT(*) FROM coffee_voucher_assignments a
          WHERE a.campaignId = c.id AND a.notificationStatus = 'failed') AS failedCount
      FROM coffee_voucher_campaigns c
      LEFT JOIN coffee_vouchers v ON v.campaignId = c.id
      WHERE c.code = ${ERP_COFFEE_CAMPAIGN_CODE}
      GROUP BY c.id, c.code, c.title, c.status, c.startsAt, c.endsAt
      LIMIT 1
    `);
    const row = rowsOf<CampaignSummaryRow>(result)[0];
    if (!row) return null;
    return {
      ...row,
      id: Number(row.id),
      totalCount: Number(row.totalCount ?? 0),
      availableCount: Number(row.availableCount ?? 0),
      assignedCount: Number(row.assignedCount ?? 0),
      voidCount: Number(row.voidCount ?? 0),
      sentCount: Number(row.sentCount ?? 0),
      failedCount: Number(row.failedCount ?? 0),
    };
  }),

  listAssignments: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(["pending", "sent", "failed"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const campaignId = await getCampaignId();
      if (!campaignId) return [];
      const result = await db.execute(sql`
        SELECT
          a.id,
          c.companyName,
          CONCAT(
            LEFT(COALESCE(c.creditCode, ''), 4),
            '********',
            RIGHT(COALESCE(c.creditCode, ''), 4)
          ) AS maskedCreditCode,
          u.username,
          u.name AS userName,
          a.notificationStatus,
          a.erpActivatedAt,
          a.assignedAt,
          a.notifiedAt,
          a.lastError
        FROM coffee_voucher_assignments a
        INNER JOIN users u ON u.id = a.userId
        INNER JOIN companies c ON c.id = a.companyId
        WHERE a.campaignId = ${campaignId}
          ${input.status ? sql`AND a.notificationStatus = ${input.status}` : sql``}
        ORDER BY a.assignedAt DESC, a.id DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      return rowsOf<AssignmentRow>(result).map(row => ({
        ...row,
        id: Number(row.id),
      }));
    }),

  activate: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const campaignId = await getCampaignId();
    if (!campaignId) throw new TRPCError({ code: "NOT_FOUND", message: "活动尚未导入" });
    const countResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
        FROM coffee_vouchers
       WHERE campaignId = ${campaignId} AND status = 'available'
    `);
    const available = Number(rowsOf<{ cnt: number | string }>(countResult)[0]?.cnt ?? 0);
    if (available <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "没有可发放的咖啡券" });
    }
    await db.execute(sql`
      UPDATE coffee_voucher_campaigns
         SET status = 'active',
             startsAt = COALESCE(startsAt, NOW()),
             endsAt = NULL,
             createdByUserId = COALESCE(createdByUserId, ${ctx.user.id}),
             updatedAt = NOW()
       WHERE id = ${campaignId} AND status IN ('draft', 'paused', 'exhausted')
    `);
    return { success: true } as const;
  }),

  pause: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const campaignId = await getCampaignId();
    if (!campaignId) throw new TRPCError({ code: "NOT_FOUND", message: "活动尚未导入" });
    await db.execute(sql`
      UPDATE coffee_voucher_campaigns
         SET status = 'paused', updatedAt = NOW()
       WHERE id = ${campaignId} AND status = 'active'
    `);
    return { success: true } as const;
  }),

  retryNotification: adminProcedure
    .input(z.object({ assignmentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const result = await resendCoffeeVoucherNotification(input.assignmentId);
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "发放记录不存在" });
      }
      return result;
    }),
});
