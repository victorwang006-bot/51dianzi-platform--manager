import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { createCrmPermissionProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const salesOrdersProcedure = createCrmPermissionProcedure("sales_orders.manage");

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function beijingDateKey(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function affectedRows(result: unknown) {
  return Number((result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}
function insertId(result: unknown) {
  return Number((result as [{ insertId?: number }])[0]?.insertId ?? 0);
}
/** 原子生成 CK + 北京日期 + 4位流水号。 */
async function generateSlipNo(tx: any): Promise<string> {
  const businessDate = beijingDateKey();
  await tx.execute(sql`
    INSERT INTO business_slip_sequences (scope, businessDate, currentValue)
    VALUES ('CK', ${businessDate}, 1)
    ON DUPLICATE KEY UPDATE currentValue = currentValue + 1
  `);
  const result = await tx.execute(sql`
    SELECT currentValue FROM business_slip_sequences
     WHERE scope = 'CK' AND businessDate = ${businessDate}
     LIMIT 1 FOR UPDATE
  `);
  const sequence = Number((result as unknown as [[{ currentValue: number }], unknown])[0][0]?.currentValue ?? 0);
  if (!sequence || sequence > 9999) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "今日出库单流水号已达上限" });
  return `CK${businessDate.replace(/-/g, "")}${String(sequence).padStart(4, "0")}`;
}

const outboundDataObject = z.object({
  partNumber: z.string().min(1, "请输入型号").max(128),
  brand: z.string().max(64).optional(),
  qty: z.number().int().positive("出库数量须为正整数"),
  unitPrice: z.number().positive().optional(),
  unitPriceBasis: z.literal("CNY_TAX_INCLUDED").optional(),
  prodYear: z.string().max(16).optional(),
  salesName: z.string().max(64).optional(),
  customerName: z.string().max(128).optional(),
  customerContact: z.string().max(64).optional(),
  customerPhone: z.string().max(32).optional(),
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式须为 YYYY-MM-DD"),
  note: z.string().max(500).optional(),
});
function validatePriceBasis(data: { unitPrice?: number; unitPriceBasis?: "CNY_TAX_INCLUDED" }, ctx: z.RefinementCtx) {
  if (data.unitPrice != null && data.unitPriceBasis !== "CNY_TAX_INCLUDED") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unitPriceBasis"], message: "销售单价必须明确为人民币含税口径" });
  }
}
const outboundDataSchema = outboundDataObject.superRefine(validatePriceBasis);
const outboundCreateSchema = outboundDataObject.extend({
  clientRequestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "请求标识无效"),
}).superRefine(validatePriceBasis);

const outboundFilterSchema = z
  .object({
    partNumber: z.string().optional(),
    customerName: z.string().optional(),
    salesName: z.string().optional(),
    slipNo: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  })
  .optional();

type OutboundRow = {
  id: number;
  slipNo: string;
  userId: number;
  partNumber: string;
  brand: string | null;
  qty: number;
  unitPrice: string | null;
  unitPriceBasis: string | null;
  unitCost: string | null;
  unitCostBasis: string | null;
  prodYear: string | null;
  salesName: string | null;
  customerName: string | null;
  customerContact: string | null;
  customerPhone: string | null;
  outboundDate: string;
  note: string | null;
  createdAt: Date;
};

type LedgerRow = {
  currentQty: number;
  avgCost?: string | null;
  costBasis?: string | null;
};

export function planOutboundUpdate(
  existing: Pick<OutboundRow, "partNumber" | "qty" | "unitCost">,
  next: Pick<z.infer<typeof outboundDataSchema>, "partNumber" | "qty">,
) {
  const oldQty = Number(existing.qty);
  const newQty = next.qty;
  const qtyDiff = newQty - oldQty;
  const partChanged = next.partNumber !== existing.partNumber;

  return {
    oldQty,
    newQty,
    qtyDiff,
    partChanged,
    requiredQty: partChanged ? newQty : Math.max(qtyDiff, 0),
    existingUnitCost: existing.unitCost != null ? Number(existing.unitCost) : null,
  };
}

export function resolveUpdatedUnitCost(
  partChanged: boolean,
  existingUnitCost: number | null,
  nextAverageCost: string | null | undefined,
) {
  if (!partChanged) return existingUnitCost;
  return nextAverageCost != null ? Number(nextAverageCost) : null;
}

function outboundPayloadHash(input: z.infer<typeof outboundCreateSchema>) {
  return createHash("sha256").update(JSON.stringify({
    partNumber: input.partNumber,
    brand: input.brand ?? null,
    qty: input.qty,
    unitPrice: input.unitPrice ?? null,
    unitPriceBasis: input.unitPriceBasis ?? null,
    prodYear: input.prodYear ?? null,
    salesName: input.salesName ?? null,
    customerName: input.customerName ?? null,
    customerContact: input.customerContact ?? null,
    customerPhone: input.customerPhone ?? null,
    outboundDate: input.outboundDate,
    note: input.note ?? null,
  })).digest("hex");
}

export const outboundRouter = router({
  /** 当前企业销售订单列表 */
  list: salesOrdersProcedure
    .input(outboundFilterSchema)
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.effectiveUserId!;
      const conditions = [sql`userId = ${userId}`];
      if (input?.partNumber) conditions.push(sql`partNumber LIKE ${`%${input.partNumber}%`}`);
      if (input?.customerName) conditions.push(sql`customerName LIKE ${`%${input.customerName}%`}`);
      if (input?.salesName) conditions.push(sql`salesName LIKE ${`%${input.salesName}%`}`);
      if (input?.slipNo) conditions.push(sql`slipNo LIKE ${`%${input.slipNo}%`}`);
      if (input?.dateFrom) conditions.push(sql`outboundDate >= ${input.dateFrom}`);
      if (input?.dateTo) conditions.push(sql`outboundDate <= ${input.dateTo}`);

      const result = await db.execute(sql`
        SELECT * FROM outbound_orders
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY createdAt DESC
      `);
      return (result as unknown as [OutboundRow[], unknown])[0];
    }),

  /** 新增出库单：请求键、出库单、库存扣减在同一事务内。 */
  create: salesOrdersProcedure
    .input(outboundCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.effectiveUserId!;
      const payloadHash = outboundPayloadHash(input);
      return db.transaction(async tx => {
        await tx.execute(sql`
          INSERT IGNORE INTO outbound_request_keys (ownerUserId, requestId, payloadHash)
          VALUES (${userId}, ${input.clientRequestId}, ${payloadHash})
        `);
        const requestResult = await tx.execute(sql`
          SELECT outboundOrderId, payloadHash FROM outbound_request_keys
           WHERE ownerUserId = ${userId} AND requestId = ${input.clientRequestId}
           LIMIT 1 FOR UPDATE
        `);
        const requestRow = (requestResult as unknown as [[{ outboundOrderId: number | null; payloadHash: string }], unknown])[0][0];
        if (!requestRow || requestRow.payloadHash !== payloadHash) {
          throw new TRPCError({ code: "CONFLICT", message: "同一请求标识的出库内容不一致，请刷新页面后重新提交" });
        }
        const existingOrderId = Number(requestRow.outboundOrderId ?? 0);
        if (existingOrderId > 0) {
          const priorResult = await tx.execute(sql`
            SELECT id, slipNo FROM outbound_orders WHERE id = ${existingOrderId} AND userId = ${userId} LIMIT 1
          `);
          const prior = (priorResult as unknown as [[{ id: number; slipNo: string }], unknown])[0][0];
          if (!prior) throw new TRPCError({ code: "CONFLICT", message: "重复请求对应的出库单不存在，请联系平台核对" });
          return { success: true, id: prior.id, slipNo: prior.slipNo, replayed: true } as const;
        }
        const ledgerResult = await tx.execute(sql`
          SELECT currentQty, avgCost, costBasis FROM stock_ledger
          WHERE userId = ${userId} AND partNumber = ${input.partNumber}
          LIMIT 1 FOR UPDATE
        `);
        const ledgerRows = (ledgerResult as unknown as [LedgerRow[], unknown])[0];
        const currentQty = Number(ledgerRows[0]?.currentQty ?? 0);
        const avgCost = ledgerRows[0]?.avgCost != null ? Number(ledgerRows[0].avgCost) : null;
        const costBasis = ledgerRows[0]?.costBasis ?? null;
        if (currentQty < input.qty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `库存不足！当前库存 ${currentQty} 件，出库数量 ${input.qty} 件，请先入库后再出库。` });
        }
        const slipNo = await generateSlipNo(tx);
        const inserted = await tx.execute(sql`
          INSERT INTO outbound_orders
            (slipNo, userId, partNumber, brand, qty, unitPrice, unitPriceBasis, unitCost, unitCostBasis,
             prodYear, salesName, customerName, customerContact, customerPhone, outboundDate, note)
          VALUES
            (${slipNo}, ${userId}, ${input.partNumber}, ${input.brand ?? null},
             ${input.qty}, ${input.unitPrice ?? null}, ${input.unitPriceBasis ?? null}, ${avgCost}, ${costBasis}, ${input.prodYear ?? null},
             ${input.salesName ?? null}, ${input.customerName ?? null},
             ${input.customerContact ?? null}, ${input.customerPhone ?? null}, ${input.outboundDate}, ${input.note ?? null})
        `);
        const id = insertId(inserted);
        if (!id) throw new Error("出库单写入失败");
        const deducted = await tx.execute(sql`
          UPDATE stock_ledger
             SET totalQtyOut = totalQtyOut + ${input.qty}, currentQty = currentQty - ${input.qty},
                 movementVersion = movementVersion + 1
           WHERE userId = ${userId} AND partNumber = ${input.partNumber} AND currentQty >= ${input.qty}
        `);
        if (affectedRows(deducted) !== 1) throw new TRPCError({ code: "CONFLICT", message: "库存刚刚发生变化，请刷新后重试" });
        const bound = await tx.execute(sql`
          UPDATE outbound_request_keys SET outboundOrderId = ${id}
           WHERE ownerUserId = ${userId} AND requestId = ${input.clientRequestId}
             AND payloadHash = ${payloadHash} AND outboundOrderId IS NULL
        `);
        if (affectedRows(bound) !== 1) throw new TRPCError({ code: "CONFLICT", message: "出库请求幂等绑定失败，请重试" });
        return { success: true, id, slipNo, replayed: false } as const;
      });
    }),

  /** 编辑出库单 */
  update: salesOrdersProcedure
    .input(z.object({ id: z.number().int(), data: outboundDataSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.effectiveUserId!;
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT * FROM outbound_orders WHERE id = ${input.id} AND userId = ${userId} LIMIT 1 FOR UPDATE
        `);
        const existing = (result as unknown as [OutboundRow[], unknown])[0][0];
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "出库单不存在" });
        const { oldQty, newQty, qtyDiff, partChanged, requiredQty, existingUnitCost } = planOutboundUpdate(existing, input.data);
        const parts = Array.from(new Set([existing.partNumber, input.data.partNumber])).sort();
        const ledgerByPart = new Map<string, LedgerRow>();
        for (const partNumber of parts) {
          const ledgerResult = await tx.execute(sql`
            SELECT currentQty, avgCost, costBasis FROM stock_ledger
             WHERE userId = ${userId} AND partNumber = ${partNumber}
             LIMIT 1 FOR UPDATE
          `);
          const ledger = (ledgerResult as unknown as [LedgerRow[], unknown])[0][0];
          if (ledger) ledgerByPart.set(partNumber, ledger);
        }
        const nextLedger = ledgerByPart.get(input.data.partNumber);
        const available = Number(nextLedger?.currentQty ?? 0);
        if (requiredQty > 0 && available < requiredQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `库存不足！当前可用库存 ${available} 件，本次需出库 ${requiredQty} 件。` });
        }
        const unitCost = resolveUpdatedUnitCost(partChanged, existingUnitCost, nextLedger?.avgCost);
        const unitCostBasis = partChanged ? nextLedger?.costBasis ?? null : existing.unitCostBasis;
        await tx.execute(sql`
          UPDATE outbound_orders SET
            partNumber = ${input.data.partNumber}, brand = ${input.data.brand ?? null}, qty = ${newQty},
            unitPrice = ${input.data.unitPrice ?? null}, unitPriceBasis = ${input.data.unitPriceBasis ?? null},
            unitCost = ${unitCost}, unitCostBasis = ${unitCostBasis}, prodYear = ${input.data.prodYear ?? null},
            salesName = ${input.data.salesName ?? null}, customerName = ${input.data.customerName ?? null},
            customerContact = ${input.data.customerContact ?? null}, customerPhone = ${input.data.customerPhone ?? null},
            outboundDate = ${input.data.outboundDate}, note = ${input.data.note ?? null}
          WHERE id = ${input.id} AND userId = ${userId}
        `);
        if (partChanged) {
          await tx.execute(sql`UPDATE stock_ledger SET totalQtyOut = GREATEST(0, totalQtyOut - ${oldQty}), currentQty = currentQty + ${oldQty}, movementVersion = movementVersion + 1 WHERE userId = ${userId} AND partNumber = ${existing.partNumber}`);
          const deducted = await tx.execute(sql`UPDATE stock_ledger SET totalQtyOut = totalQtyOut + ${newQty}, currentQty = currentQty - ${newQty}, movementVersion = movementVersion + 1 WHERE userId = ${userId} AND partNumber = ${input.data.partNumber} AND currentQty >= ${newQty}`);
          if (affectedRows(deducted) !== 1) throw new TRPCError({ code: "CONFLICT", message: "库存刚刚发生变化，请刷新后重试" });
        } else if (qtyDiff > 0) {
          const deducted = await tx.execute(sql`UPDATE stock_ledger SET totalQtyOut = totalQtyOut + ${qtyDiff}, currentQty = currentQty - ${qtyDiff}, movementVersion = movementVersion + 1 WHERE userId = ${userId} AND partNumber = ${input.data.partNumber} AND currentQty >= ${qtyDiff}`);
          if (affectedRows(deducted) !== 1) throw new TRPCError({ code: "CONFLICT", message: "库存刚刚发生变化，请刷新后重试" });
        } else if (qtyDiff < 0) {
          await tx.execute(sql`UPDATE stock_ledger SET totalQtyOut = GREATEST(0, totalQtyOut + ${qtyDiff}), currentQty = currentQty - ${qtyDiff}, movementVersion = movementVersion + 1 WHERE userId = ${userId} AND partNumber = ${input.data.partNumber}`);
        }
        return { success: true } as const;
      });
    }),

  /** 删除出库单 */
  remove: salesOrdersProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.effectiveUserId!;
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT * FROM outbound_orders WHERE id = ${input.id} AND userId = ${userId} LIMIT 1 FOR UPDATE
        `);
        const existing = (result as unknown as [OutboundRow[], unknown])[0][0];
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "出库单不存在" });
        await tx.execute(sql`SELECT currentQty FROM stock_ledger WHERE userId = ${userId} AND partNumber = ${existing.partNumber} LIMIT 1 FOR UPDATE`);
        await tx.execute(sql`DELETE FROM outbound_orders WHERE id = ${input.id} AND userId = ${userId}`);
        await tx.execute(sql`
          UPDATE stock_ledger
             SET totalQtyOut = GREATEST(0, totalQtyOut - ${Number(existing.qty)}),
                 currentQty = currentQty + ${Number(existing.qty)},
                 movementVersion = movementVersion + 1
           WHERE userId = ${userId} AND partNumber = ${existing.partNumber}
        `);
        return { success: true } as const;
      });
    }),
});
