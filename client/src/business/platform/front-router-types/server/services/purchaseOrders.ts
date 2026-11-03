import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  purchaseOrderItemSchema, purchaseOrderMoneySchema,
  type PurchaseOrderCreateInput, type PurchaseOrderListInput, type PurchaseOrderShippingInput,
} from "../../../shared/purchaseOrders";
import { currentBeijingDate, getDb } from "../db";
import { assertCrmProcurementDemand, crmProcurementDemandWhere, resolveCrmDemandPolicy } from "./customerDemands";
import {
  centsString, decimalUnits, invoiceProgress, normalizePurchasePartNumber,
  normalizePurchaseSupplierName, progressStatus, purchaseOrderTotal, receiptProgress,
} from "./purchaseOrderMath";

export type PurchaseOrderScope = { enterpriseId: number; ownerUserId: number; actorUserId: number };
type Executor = { execute: (statement: SQLWrapper) => Promise<unknown> };
type Order = {
  id: number; enterpriseId: number; ownerUserId: number; orderNo: string;
  createdByUserId: number; sourceAcceptanceId: number | null; sourceQuoteVersion: number | null;
  supplierName: string; supplierOrderNo: string; expectedDeliveryDate: string | Date | null; note: string | null;
  totalAmount: string; paymentStatus: "pending" | "partial" | "paid"; paymentNote: string;
  paymentUpdatedAt: Date | string | null; carrier: string; trackingNo: string;
  lifecycle: "active" | "cancelled"; cancelledAt: Date | string | null; cancelReason: string | null;
  version: number; createdAt: Date | string; updatedAt: Date | string;
};
type Item = {
  id: number; enterpriseId: number; orderId: number; demandItemId: number | null;
  partNumber: string; brand: string; pkg: string; qtyUnit: string; qty: number;
  unitPrice: string; shippedQty: number;
};
type Aggregate = Order & { firstPartNumber: string; itemCount: number | string; totalQty: number | string;
  shippedQty: number | string; receivedQty: number | string; invoiceAmount: string };
const NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;

function rows<T>(result: unknown): T[] { return (result as [T[], unknown])[0] ?? []; }
function header(result: unknown): { insertId?: number | string; affectedRows?: number } {
  return (result as [{ insertId?: number | string; affectedRows?: number }, unknown])[0] ?? {};
}
async function dbOrFail() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用" });
  return db;
}
function conflict(message: string): never { throw new TRPCError({ code: "CONFLICT", message }); }
function missing(): never { throw new TRPCError({ code: "NOT_FOUND", message: "采购订单或关联单据不存在" }); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function dateText(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
  return String(value).slice(0, 10);
}
function timeText(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium", hour12: false,
  }).format(value);
  return String(value).replace("T", " ").slice(0, 19);
}
function detailsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function serviceError(error: unknown) {
  if (error instanceof TRPCError) return error;
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    if ((cause as { code?: string }).code === "ER_DUP_ENTRY") {
      return new TRPCError({ code: "CONFLICT", message: "该采购单、采用报价、发票或请求号已登记，请刷新后重试" });
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  // Drizzle's wrapped query exception contains SQL parameters, possibly including supplier details.
  // Never expose those parameters in a tRPC client error.
  console.error("[purchaseOrder] unexpected database failure", (cause as { code?: string } | null)?.code ?? "query_failure");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "采购订单暂不可用，请稍后再试" });
}
function normalizeItem(input: { partNumber: string; brand: string; pkg: string; qtyUnit: string; qty: number; unitPrice: string; demandItemId?: number | null }) {
  const parsed = purchaseOrderItemSchema.safeParse(input);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "物料明细不完整" });
  return { ...parsed.data, partNumber: normalizePurchasePartNumber(parsed.data.partNumber), demandItemId: input.demandItemId ?? null };
}
function summary(row: Aggregate) {
  const totalQty = Number(row.totalQty ?? 0);
  return {
    id: Number(row.id), orderNo: row.orderNo, supplierName: row.supplierName,
    supplierOrderNo: row.supplierOrderNo, expectedDeliveryDate: dateText(row.expectedDeliveryDate),
    totalAmount: String(row.totalAmount), paymentStatus: row.paymentStatus,
    shippingStatus: progressStatus(Number(row.shippedQty ?? 0), totalQty, "shipped"),
    receiptStatus: receiptProgress(Number(row.receivedQty ?? 0), totalQty),
    invoiceStatus: invoiceProgress(String(row.invoiceAmount ?? "0.00"), String(row.totalAmount)),
    lifecycle: row.lifecycle, createdAt: timeText(row.createdAt) ?? "",
    firstPartNumber: row.firstPartNumber ?? "", itemCount: Number(row.itemCount ?? 0), totalQty,
    version: Number(row.version),
  };
}
function expectedVersion(actual: number | string, requested: number) {
  if (Number(actual) !== requested) conflict("采购订单已被其他人更新，请刷新后重试");
}
async function lockedOrder(tx: Executor, scope: PurchaseOrderScope, id: number) {
  const row = rows<Order>(await tx.execute(sql`
    SELECT * FROM crm_purchase_orders WHERE id = ${id} AND enterpriseId = ${scope.enterpriseId}
      AND ownerUserId = ${scope.ownerUserId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!row) missing();
  return row;
}
/** Old inbound_orders has a userId but no enterpriseId. The indexed owner range is locked
 * for the candidate/link transaction; if shared by several enterprises, fail closed. */
async function assertExclusiveLegacyInboundOwner(tx: Executor, scope: PurchaseOrderScope) {
  const owners = rows<{ id: number }>(await tx.execute(sql`
    SELECT id FROM enterprises WHERE crmDataOwnerUserId=${scope.ownerUserId}
      ORDER BY id FOR UPDATE
  `));
  if (owners.length !== 1 || Number(owners[0].id) !== scope.enterpriseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "旧入库单企业归属无法确认，暂不能关联采购订单" });
  }
}
/** An existing link must become unreadable if the legacy owner is later shared. */
async function guardLinkedLegacyInboundReads(tx: Executor, scope: PurchaseOrderScope) {
  const linked = rows<{ id: number }>(await tx.execute(sql`
    SELECT id FROM crm_purchase_order_inbounds WHERE enterpriseId=${scope.enterpriseId}
      AND ownerUserId=${scope.ownerUserId} LIMIT 1
  `));
  if (linked.length) await assertExclusiveLegacyInboundOwner(tx, scope);
}
async function eventReplay(tx: Executor, scope: PurchaseOrderScope, id: number, requestId: string, action: string, payloadHash: string) {
  const event = rows<{ orderId: number; action: string; details: unknown }>(await tx.execute(sql`
    SELECT orderId, action, details FROM crm_purchase_order_events
     WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId}
       AND requestId = ${requestId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!event) return null;
  const details = detailsObject(event.details);
  if (Number(event.orderId) !== id || event.action !== action || details.payloadHash !== payloadHash) {
    conflict("同一请求标识已用于不同的采购订单操作");
  }
  return { id, version: Number(details.afterVersion), replayed: true };
}
async function audit(tx: Executor, scope: PurchaseOrderScope, id: number, requestId: string,
  action: string, payloadHash: string, beforeVersion: number, details: Record<string, unknown> = {}) {
  await tx.execute(sql`
    INSERT INTO crm_purchase_order_events (enterpriseId, orderId, actorUserId, requestId, action, details, createdAt)
    VALUES (${scope.enterpriseId}, ${id}, ${scope.actorUserId}, ${requestId}, ${action},
      ${JSON.stringify({ ...details, payloadHash, afterVersion: beforeVersion + 1 })}, ${NOW})
  `);
}

/** 仅展示当前、有效且尚未生成采购单的已采用报价。无权人员不可调用。 */
export async function acceptedQuoteOptions(scope: PurchaseOrderScope, input: { keyword: string; limit: number }) {
  const db = await dbOrFail();
  const policy = await resolveCrmDemandPolicy(db, scope);
  const match = input.keyword.trim();
  const result = rows<{ acceptanceId: number; supplierName: string; demandId: number;
    quoteId: number; quoteVersion: number; demandRevision: number; partSummary: string;
    acceptedQty: number | string; createdAt: Date | string }>(await db.execute(sql`
    SELECT acc.id AS acceptanceId, qa.supplierName, acc.demandId, acc.quoteId, acc.quoteVersion,
      acc.demandRevision, GROUP_CONCAT(DISTINCT ai_snapshot.partNumber ORDER BY ai_snapshot.sortOrder SEPARATOR ' / ') AS partSummary,
      SUM(ai.qty) AS acceptedQty, acc.createdAt
      FROM crm_customer_demand_quote_acceptances acc
      INNER JOIN crm_customer_demand_quotes q ON q.enterpriseId=acc.enterpriseId AND q.id=acc.quoteId
        AND q.demandId=acc.demandId AND q.version=acc.quoteVersion AND q.demandRevision=acc.demandRevision AND q.status='active'
      INNER JOIN crm_customer_demands d ON d.enterpriseId=acc.enterpriseId AND d.id=acc.demandId
        AND d.revision=acc.demandRevision AND d.status<>'draft'
      INNER JOIN crm_customer_demand_quote_audits qa ON qa.enterpriseId=acc.enterpriseId
        AND qa.quoteId=acc.quoteId AND qa.version=acc.quoteVersion AND qa.demandRevision=acc.demandRevision
      INNER JOIN crm_customer_demand_quote_acceptance_items ai ON ai.enterpriseId=acc.enterpriseId AND ai.acceptanceId=acc.id
      INNER JOIN crm_customer_demand_quote_audit_items ai_snapshot ON ai_snapshot.enterpriseId=acc.enterpriseId
        AND ai_snapshot.auditId=qa.id AND ai_snapshot.demandItemId=ai.demandItemId
        AND ai_snapshot.alternateNo=ai.alternateNo
      LEFT JOIN crm_purchase_orders po ON po.enterpriseId=acc.enterpriseId AND po.sourceAcceptanceId=acc.id
     WHERE acc.enterpriseId=${scope.enterpriseId} AND po.id IS NULL AND ${crmProcurementDemandWhere(scope, policy)}
       AND (${match}='' OR LOCATE(${match}, qa.supplierName)>0 OR LOCATE(${match}, ai_snapshot.partNumber)>0
         OR LOCATE(${match}, d.demandNo)>0)
     GROUP BY acc.id, qa.supplierName, acc.demandId, acc.quoteId, acc.quoteVersion, acc.demandRevision, acc.createdAt
     ORDER BY acc.id DESC LIMIT ${input.limit}
  `));
  return { items: result.map(row => ({
    acceptanceId: Number(row.acceptanceId), supplierName: row.supplierName,
    demandId: Number(row.demandId), quoteId: Number(row.quoteId), quoteVersion: Number(row.quoteVersion),
    demandRevision: Number(row.demandRevision), partSummary: String(row.partSummary ?? "").slice(0, 180),
    acceptedQty: Number(row.acceptedQty ?? 0), createdAt: timeText(row.createdAt) ?? "",
  })) };
}

type QuoteSource = { acceptanceId: number; quoteVersion: number; supplierName: string;
  items: ReturnType<typeof normalizeItem>[] };
async function verifiedQuoteSource(tx: Executor, scope: PurchaseOrderScope, acceptanceId: number): Promise<QuoteSource> {
  const identity = rows<{ customerId: number; demandId: number; quoteId: number }>(await tx.execute(sql`
    SELECT d.customerId, acc.demandId, acc.quoteId FROM crm_customer_demand_quote_acceptances acc
    INNER JOIN crm_customer_demands d ON d.enterpriseId = acc.enterpriseId AND d.id = acc.demandId
    WHERE acc.enterpriseId = ${scope.enterpriseId} AND acc.id = ${acceptanceId} LIMIT 1`))[0];
  if (!identity) missing();
  await assertCrmProcurementDemand(tx, scope, Number(identity.demandId));
  await tx.execute(sql`SELECT id FROM crm_customers WHERE enterpriseId = ${scope.enterpriseId} AND id = ${Number(identity.customerId)} LIMIT 1 FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM crm_customer_demands WHERE enterpriseId = ${scope.enterpriseId} AND id = ${Number(identity.demandId)} LIMIT 1 FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM crm_customer_demand_quotes WHERE enterpriseId = ${scope.enterpriseId} AND id = ${Number(identity.quoteId)} LIMIT 1 FOR UPDATE`);
  const policy = await assertCrmProcurementDemand(tx, scope, Number(identity.demandId));
  const accepted = rows<{ id: number; demandId: number; quoteId: number; quoteVersion: number;
    demandRevision: number; currentDemandRevision: number; currentQuoteVersion: number;
    currentQuoteRevision: number; quoteStatus: string; demandStatus: string;
    supplierName: string; auditId: number }>(await tx.execute(sql`
    SELECT acc.id, acc.demandId, acc.quoteId, acc.quoteVersion, acc.demandRevision,
      d.revision AS currentDemandRevision, d.status AS demandStatus,
      q.version AS currentQuoteVersion, q.demandRevision AS currentQuoteRevision, q.status AS quoteStatus,
      qa.supplierName, qa.id AS auditId
      FROM crm_customer_demand_quote_acceptances acc
      INNER JOIN crm_customer_demand_quotes q ON q.enterpriseId=acc.enterpriseId AND q.id=acc.quoteId
        AND q.demandId=acc.demandId
      INNER JOIN crm_customer_demands d ON d.enterpriseId=acc.enterpriseId AND d.id=acc.demandId
      INNER JOIN crm_customer_demand_quote_audits qa ON qa.enterpriseId=acc.enterpriseId
        AND qa.quoteId=acc.quoteId AND qa.version=acc.quoteVersion AND qa.demandRevision=acc.demandRevision
     WHERE acc.enterpriseId=${scope.enterpriseId} AND acc.id=${acceptanceId} AND ${crmProcurementDemandWhere(scope, policy)}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!accepted) missing();
  if (accepted.quoteStatus !== "active" || accepted.demandStatus === "draft" ||
    Number(accepted.currentQuoteVersion) !== Number(accepted.quoteVersion) ||
    Number(accepted.currentQuoteRevision) !== Number(accepted.demandRevision) ||
    Number(accepted.currentDemandRevision) !== Number(accepted.demandRevision)) {
    conflict("原需求或报价已有新版本，请重新确认后生成采购单");
  }
  if (!accepted.supplierName?.trim()) conflict("原报价缺少供应商名称，暂不能生成采购单");
  const sourceItems = rows<{ demandItemId: number; qty: number | string; quoteQty: number | string; partNumber: string;
    brand: string; pkg: string; qtyUnit: string; unitPrice: string | number }>(await tx.execute(sql`
    SELECT ai.demandItemId, ai.qty, source.qty AS quoteQty, source.partNumber, source.brand, source.pkg, source.qtyUnit,
      source.unitPrice
      FROM crm_customer_demand_quote_acceptance_items ai
      INNER JOIN crm_customer_demand_quote_audit_items source ON source.enterpriseId=ai.enterpriseId
        AND source.auditId=${Number(accepted.auditId)} AND source.demandItemId=ai.demandItemId
        AND source.alternateNo=ai.alternateNo
     WHERE ai.enterpriseId=${scope.enterpriseId} AND ai.acceptanceId=${acceptanceId}
     ORDER BY source.sortOrder ASC, ai.id ASC FOR UPDATE
  `));
  if (!sourceItems.length || sourceItems.length > 50) conflict("原采用报价没有可复制的有效物料");
  if (sourceItems.some(item => Number(item.qty) > Number(item.quoteQty))) {
    conflict("采纳数量超过原报价快照数量，请重新核对");
  }
  const items = sourceItems.map(item => normalizeItem({
    demandItemId: Number(item.demandItemId), partNumber: item.partNumber,
    brand: item.brand ?? "", pkg: item.pkg ?? "", qtyUnit: item.qtyUnit || "片",
    qty: Number(item.qty), unitPrice: String(item.unitPrice),
  }));
  return { acceptanceId, quoteVersion: Number(accepted.quoteVersion), supplierName: accepted.supplierName, items };
}

export async function createPurchaseOrder(scope: PurchaseOrderScope, input: PurchaseOrderCreateInput) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try {
    return await db.transaction(async tx => {
      if (input.source === "accepted_quote") {
        // Same enterprise -> ordered members -> customer -> demand -> quote -> acceptance lock order as CRM writers.
        await tx.execute(sql`SELECT id FROM enterprises WHERE id = ${scope.enterpriseId} LIMIT 1 FOR UPDATE`);
        await tx.execute(sql`SELECT userId FROM enterprise_members WHERE enterpriseId = ${scope.enterpriseId} ORDER BY userId FOR UPDATE`);
        const identity = rows<{ demandId: number }>(await tx.execute(sql`SELECT demandId FROM crm_customer_demand_quote_acceptances
          WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.acceptanceId} LIMIT 1`))[0];
        if (!identity) missing();
        await assertCrmProcurementDemand(tx, scope, Number(identity.demandId));
      }
      const previous = rows<{ id: number; orderNo: string; createPayloadHash: string; version: number }>(await tx.execute(sql`
        SELECT id, orderNo, createPayloadHash, version FROM crm_purchase_orders
         WHERE enterpriseId=${scope.enterpriseId} AND createdByUserId=${scope.actorUserId}
           AND createRequestId=${input.requestId} LIMIT 1 FOR UPDATE
      `))[0];
      if (previous) {
        if (previous.createPayloadHash !== payloadHash) conflict("同一请求号对应不同的采购单内容");
        return { id: Number(previous.id), orderNo: previous.orderNo, version: Number(previous.version), replayed: true };
      }
      const quote = input.source === "accepted_quote"
        ? await verifiedQuoteSource(tx, scope, input.acceptanceId) : null;
      const supplierName = (quote?.supplierName ?? (input.source === "manual" ? input.supplierName : "")).normalize("NFKC").trim();
      const items = quote?.items ?? (input.source === "manual" ? input.items.map(item => normalizeItem(item)) : []);
      if (!supplierName || !items.length) conflict("供应商和物料明细不能为空");
      let totalAmount: string;
      try { totalAmount = purchaseOrderTotal(items); }
      catch { throw new TRPCError({ code: "BAD_REQUEST", message: "采购订单金额超出可登记范围" }); }
      const tempNumber = `CG-TMP-${randomBytes(12).toString("hex")}`;
      const inserted = header(await tx.execute(sql`
        INSERT INTO crm_purchase_orders (enterpriseId, ownerUserId, orderNo, createdByUserId,
          createRequestId, createPayloadHash, sourceAcceptanceId, sourceQuoteVersion, supplierName,
          supplierOrderNo, expectedDeliveryDate, note, totalAmount, paymentStatus,
          lifecycle, version, createdAt, updatedAt)
        VALUES (${scope.enterpriseId}, ${scope.ownerUserId}, ${tempNumber}, ${scope.actorUserId},
          ${input.requestId}, ${payloadHash}, ${quote?.acceptanceId ?? null}, ${quote?.quoteVersion ?? null},
          ${supplierName}, ${input.supplierOrderNo}, ${input.expectedDeliveryDate ?? null}, ${input.note},
          ${totalAmount}, 'pending', 'active', 1, ${NOW}, ${NOW})
      `));
      const id = Number(inserted.insertId ?? 0);
      if (!id) throw new Error("采购订单号生成失败");
      const orderNo = `CG${currentBeijingDate().replaceAll("-", "")}-${String(id).padStart(6, "0")}`;
      await tx.execute(sql`
        UPDATE crm_purchase_orders SET orderNo=${orderNo} WHERE id=${id} AND enterpriseId=${scope.enterpriseId}
      `);
      for (const item of items) {
        await tx.execute(sql`
          INSERT INTO crm_purchase_order_items
            (enterpriseId, orderId, demandItemId, partNumber, brand, pkg, qtyUnit, qty, unitPrice, shippedQty, createdAt)
          VALUES (${scope.enterpriseId}, ${id}, ${item.demandItemId}, ${item.partNumber}, ${item.brand},
            ${item.pkg}, ${item.qtyUnit}, ${item.qty}, ${item.unitPrice}, 0, ${NOW})
        `);
      }
      await tx.execute(sql`
        INSERT INTO crm_purchase_order_events
          (enterpriseId, orderId, actorUserId, requestId, action, details, createdAt)
        VALUES (${scope.enterpriseId}, ${id}, ${scope.actorUserId}, ${input.requestId}, 'created',
          ${JSON.stringify({ source: input.source, sourceAcceptanceId: quote?.acceptanceId ?? null,
            totalAmount, payloadHash, afterVersion: 1 })}, ${NOW})
      `);
      return { id, orderNo, version: 1, replayed: false };
    });
  } catch (error) { throw serviceError(error); }
}

/** 订单进度只写新台账，不实际转款、不触碰原入库付款记录。 */
export async function updatePurchasePayment(scope: PurchaseOrderScope, input: {
  id: number; version: number; requestId: string; status: "pending" | "partial" | "paid"; note: string;
}) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "payment", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("已取消的采购单不可更新付款状态");
    if (order.paymentStatus === input.status && order.paymentNote === input.note) conflict("付款进度没有变化");
    if (order.paymentStatus === "paid" && input.status !== "paid" && input.note.length < 4) {
      conflict("撤销已付清状态请注明原因");
    }
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`
      UPDATE crm_purchase_orders SET paymentStatus=${input.status}, paymentNote=${input.note},
        paymentUpdatedAt=${NOW}, version=${nextVersion}, updatedAt=${NOW}
       WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId} AND ownerUserId=${scope.ownerUserId}
         AND version=${input.version} AND lifecycle='active'
    `);
    await audit(tx, scope, input.id, input.requestId, "payment", payloadHash, input.version,
      { previous: order.paymentStatus, current: input.status, note: input.note });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

export async function updatePurchaseShipping(scope: PurchaseOrderScope, input: PurchaseOrderShippingInput) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "shipping", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("已取消的采购单不可登记发货");
    const current = rows<Item>(await tx.execute(sql`
      SELECT * FROM crm_purchase_order_items WHERE enterpriseId=${scope.enterpriseId}
        AND orderId=${input.id} ORDER BY id ASC FOR UPDATE
    `));
    if (input.lines.length !== current.length || current.some(item => !input.lines.some(line => line.itemId === Number(item.id)))) {
      conflict("请同时确认采购单所有物料的累计发货数量");
    }
    let changed = order.carrier !== input.carrier || order.trackingNo !== input.trackingNo;
    for (const item of current) {
      const line = input.lines.find(row => row.itemId === Number(item.id))!;
      if (line.shippedQty > Number(item.qty)) conflict("已发数量不能超过采购数量");
      if (line.shippedQty < Number(item.shippedQty) && input.note.length < 4) {
        conflict("减少已发货数量请注明更正原因");
      }
      changed ||= line.shippedQty !== Number(item.shippedQty);
    }
    if (!changed) conflict("发货进度没有变化");
    for (const line of input.lines) {
      await tx.execute(sql`UPDATE crm_purchase_order_items SET shippedQty=${line.shippedQty}
        WHERE id=${line.itemId} AND enterpriseId=${scope.enterpriseId} AND orderId=${input.id}`);
    }
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`UPDATE crm_purchase_orders SET carrier=${input.carrier}, trackingNo=${input.trackingNo},
      version=${nextVersion}, updatedAt=${NOW} WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId}
      AND ownerUserId=${scope.ownerUserId} AND version=${input.version} AND lifecycle='active'`);
    await audit(tx, scope, input.id, input.requestId, "shipping", payloadHash, input.version,
      { previous: current.map(row => ({ itemId: Number(row.id), shippedQty: Number(row.shippedQty) })),
        current: input.lines, carrier: input.carrier, trackingNo: input.trackingNo, note: input.note });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

export async function linkPurchaseInbound(scope: PurchaseOrderScope, input: {
  id: number; version: number; requestId: string; itemId: number; inboundOrderId: number;
}) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "link_inbound", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("已取消的采购单不可关联入库");
    await assertExclusiveLegacyInboundOwner(tx, scope);
    const item = rows<Item>(await tx.execute(sql`
      SELECT * FROM crm_purchase_order_items WHERE enterpriseId=${scope.enterpriseId}
       AND orderId=${input.id} AND id=${input.itemId} LIMIT 1 FOR UPDATE
    `))[0];
    if (!item) missing();
    const inbound = rows<{ id: number; userId: number; partNumber: string;
      supplierName: string | null; qty: number; actualQty: number | null; status: string }>(await tx.execute(sql`
      SELECT inbound.id, inbound.userId, inbound.partNumber, inbound.supplierName,
        inbound.qty, inbound.actualQty, inbound.status
        FROM inbound_orders inbound
        INNER JOIN enterprises legacy_owner ON legacy_owner.id=${scope.enterpriseId}
          AND legacy_owner.crmDataOwnerUserId=inbound.userId
          AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
            WHERE another_owner.crmDataOwnerUserId=inbound.userId
              AND another_owner.id<>${scope.enterpriseId})
       WHERE inbound.id=${input.inboundOrderId} AND inbound.userId=${scope.ownerUserId}
        LIMIT 1 FOR UPDATE
    `))[0];
    if (!inbound) missing();
    if (inbound.status === "cancelled") conflict("已作废的入库单不可关联采购单");
    if (normalizePurchasePartNumber(inbound.partNumber) !== item.partNumber ||
      normalizePurchaseSupplierName(inbound.supplierName ?? "") !== normalizePurchaseSupplierName(order.supplierName)) {
      conflict("入库单的型号或供应商与本采购单不一致");
    }
    const candidateQty = Number(inbound.status === "received" ? inbound.actualQty ?? inbound.qty : inbound.qty);
    const used = rows<{ qty: number | string }>(await tx.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN inbound.status='cancelled' THEN 0
        WHEN inbound.status='received' THEN COALESCE(inbound.actualQty, inbound.qty)
        ELSE inbound.qty END), 0) AS qty
        FROM crm_purchase_order_inbounds link
        INNER JOIN inbound_orders inbound ON inbound.id=link.inboundOrderId
          AND inbound.userId=link.ownerUserId
        INNER JOIN enterprises legacy_owner ON legacy_owner.id=link.enterpriseId
          AND legacy_owner.crmDataOwnerUserId=link.ownerUserId
          AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
            WHERE another_owner.crmDataOwnerUserId=link.ownerUserId
              AND another_owner.id<>link.enterpriseId)
       WHERE link.enterpriseId=${scope.enterpriseId} AND link.orderId=${input.id}
         AND link.orderItemId=${input.itemId} AND link.ownerUserId=${scope.ownerUserId}
    `))[0];
    if (!Number.isSafeInteger(candidateQty) || candidateQty < 1 ||
      candidateQty + Number(used?.qty ?? 0) > Number(item.qty)) conflict("关联入库数量不得超过此物料采购数量");
    const existed = rows<{ orderId: number }>(await tx.execute(sql`
      SELECT orderId FROM crm_purchase_order_inbounds
       WHERE ownerUserId=${scope.ownerUserId} AND inboundOrderId=${input.inboundOrderId} LIMIT 1 FOR UPDATE
    `))[0];
    if (existed) conflict("该入库单已关联采购订单");
    const inserted = header(await tx.execute(sql`
      INSERT INTO crm_purchase_order_inbounds
        (enterpriseId, ownerUserId, orderId, orderItemId, inboundOrderId, linkedByUserId, createdAt)
      SELECT ${scope.enterpriseId}, ${scope.ownerUserId}, ${input.id}, ${input.itemId},
        inbound.id, ${scope.actorUserId}, ${NOW}
        FROM inbound_orders inbound
        INNER JOIN enterprises legacy_owner ON legacy_owner.id=${scope.enterpriseId}
          AND legacy_owner.crmDataOwnerUserId=inbound.userId
          AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
            WHERE another_owner.crmDataOwnerUserId=inbound.userId
              AND another_owner.id<>${scope.enterpriseId})
       WHERE inbound.id=${input.inboundOrderId} AND inbound.userId=${scope.ownerUserId}
         AND inbound.status<>'cancelled'
    `));
    if (inserted.affectedRows !== 1) missing();
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`UPDATE crm_purchase_orders SET version=${nextVersion}, updatedAt=${NOW}
      WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId} AND ownerUserId=${scope.ownerUserId}
       AND version=${input.version} AND lifecycle='active'`);
    await audit(tx, scope, input.id, input.requestId, "link_inbound", payloadHash, input.version,
      { inboundOrderId: input.inboundOrderId, itemId: input.itemId, plannedQty: candidateQty });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

/** 有效发票票面不得超出订单总金额；作废保留原件元数据和完整审计。 */
export async function recordPurchaseInvoice(scope: PurchaseOrderScope, input: {
  id: number; version: number; requestId: string; invoiceNo: string;
  kind: "special" | "normal" | "other"; amount: string; issuedDate: string; note: string;
}) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "invoice", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("已取消的采购单不可登记发票");
    const invoices = rows<{ invoiceNo: string; amount: string }>(await tx.execute(sql`
      SELECT invoiceNo, amount FROM crm_purchase_order_invoices
       WHERE enterpriseId=${scope.enterpriseId} AND orderId=${input.id} AND voidedAt IS NULL
       ORDER BY id FOR UPDATE
    `));
    if (invoices.some(invoice => invoice.invoiceNo.toLocaleLowerCase() === input.invoiceNo.toLocaleLowerCase())) {
      conflict("该采购单已登记同号发票");
    }
    const total = invoices.reduce((sum, invoice) => sum + decimalUnits(String(invoice.amount), 2), BigInt(0));
    if (total + decimalUnits(input.amount, 2) > decimalUnits(String(order.totalAmount), 2)) {
      conflict("供应商发票金额合计不能超过采购订单金额");
    }
    await tx.execute(sql`
      INSERT INTO crm_purchase_order_invoices
        (enterpriseId, orderId, actorUserId, requestId, invoiceNo, kind, amount, issuedDate, note, createdAt)
      VALUES (${scope.enterpriseId}, ${input.id}, ${scope.actorUserId}, ${input.requestId},
        ${input.invoiceNo}, ${input.kind}, ${input.amount}, ${input.issuedDate}, ${input.note}, ${NOW})
    `);
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`UPDATE crm_purchase_orders SET version=${nextVersion}, updatedAt=${NOW}
      WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId} AND ownerUserId=${scope.ownerUserId}
       AND version=${input.version} AND lifecycle='active'`);
    await audit(tx, scope, input.id, input.requestId, "invoice", payloadHash, input.version,
      { invoiceNo: input.invoiceNo, kind: input.kind, amount: input.amount, issuedDate: input.issuedDate });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

export async function voidPurchaseInvoice(scope: PurchaseOrderScope, input: {
  id: number; version: number; invoiceId: number; requestId: string; reason: string;
}) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "void_invoice", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("已取消的采购单不可更正发票");
    const invoice = rows<{ id: number; invoiceNo: string; voidedAt: Date | null }>(await tx.execute(sql`
      SELECT id, invoiceNo, voidedAt FROM crm_purchase_order_invoices
       WHERE id=${input.invoiceId} AND enterpriseId=${scope.enterpriseId} AND orderId=${input.id}
       LIMIT 1 FOR UPDATE
    `))[0];
    if (!invoice) missing();
    if (invoice.voidedAt) conflict("该供应商发票已作废");
    await tx.execute(sql`UPDATE crm_purchase_order_invoices
       SET voidedAt=${NOW}, voidedByUserId=${scope.actorUserId}, voidReason=${input.reason}
       WHERE id=${input.invoiceId} AND enterpriseId=${scope.enterpriseId} AND orderId=${input.id} AND voidedAt IS NULL`);
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`UPDATE crm_purchase_orders SET version=${nextVersion}, updatedAt=${NOW}
      WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId} AND ownerUserId=${scope.ownerUserId}
       AND version=${input.version} AND lifecycle='active'`);
    await audit(tx, scope, input.id, input.requestId, "void_invoice", payloadHash, input.version,
      { invoiceId: input.invoiceId, invoiceNo: invoice.invoiceNo, reason: input.reason });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

export async function cancelPurchaseOrder(scope: PurchaseOrderScope, input: {
  id: number; version: number; requestId: string; reason: string;
}) {
  const db = await dbOrFail();
  const payloadHash = hash(input);
  try { return await db.transaction(async tx => {
    const order = await lockedOrder(tx, scope, input.id);
    const replay = await eventReplay(tx, scope, input.id, input.requestId, "cancel", payloadHash);
    if (replay) return replay;
    expectedVersion(order.version, input.version);
    if (order.lifecycle !== "active") conflict("该采购单已取消");
    const progress = rows<{ shippedQty: number | string; links: number | string; invoices: number | string }>(await tx.execute(sql`
      SELECT (SELECT COALESCE(SUM(shippedQty),0) FROM crm_purchase_order_items
               WHERE enterpriseId=${scope.enterpriseId} AND orderId=${input.id}) AS shippedQty,
             (SELECT COUNT(*) FROM crm_purchase_order_inbounds
               WHERE enterpriseId=${scope.enterpriseId} AND orderId=${input.id}) AS links,
             (SELECT COUNT(*) FROM crm_purchase_order_invoices
               WHERE enterpriseId=${scope.enterpriseId} AND orderId=${input.id} AND voidedAt IS NULL) AS invoices
    `))[0];
    if (order.paymentStatus !== "pending" || Number(progress?.shippedQty ?? 0) ||
      Number(progress?.links ?? 0) || Number(progress?.invoices ?? 0)) {
      conflict("已有付款/发货/入库关联/有效发票记录，请先核对业务再取消");
    }
    const nextVersion = Number(order.version) + 1;
    await tx.execute(sql`UPDATE crm_purchase_orders SET lifecycle='cancelled', cancelledAt=${NOW},
      cancelReason=${input.reason}, version=${nextVersion}, updatedAt=${NOW}
      WHERE id=${input.id} AND enterpriseId=${scope.enterpriseId} AND ownerUserId=${scope.ownerUserId}
        AND version=${input.version} AND lifecycle='active'`);
    await audit(tx, scope, input.id, input.requestId, "cancel", payloadHash, input.version,
      { reason: input.reason });
    return { id: input.id, version: nextVersion, replayed: false };
  }); } catch (error) { throw serviceError(error); }
}

const aggregateSql = (scope: PurchaseOrderScope, keyword: string, lifecycle: string) => sql`
  SELECT po.*,
    (SELECT COUNT(*) FROM crm_purchase_order_items item WHERE item.enterpriseId=po.enterpriseId AND item.orderId=po.id) AS itemCount,
    (SELECT COALESCE(SUM(item.qty),0) FROM crm_purchase_order_items item
      WHERE item.enterpriseId=po.enterpriseId AND item.orderId=po.id) AS totalQty,
    (SELECT COALESCE(SUM(item.shippedQty),0) FROM crm_purchase_order_items item
      WHERE item.enterpriseId=po.enterpriseId AND item.orderId=po.id) AS shippedQty,
    (SELECT item.partNumber FROM crm_purchase_order_items item
      WHERE item.enterpriseId=po.enterpriseId AND item.orderId=po.id ORDER BY item.id LIMIT 1) AS firstPartNumber,
    (SELECT COALESCE(SUM(CASE WHEN inbound.status='received' THEN COALESCE(inbound.actualQty,inbound.qty) ELSE 0 END),0)
      FROM crm_purchase_order_inbounds linked
      INNER JOIN inbound_orders inbound ON inbound.id=linked.inboundOrderId
        AND inbound.userId=linked.ownerUserId
      INNER JOIN enterprises legacy_owner ON legacy_owner.id=linked.enterpriseId
        AND legacy_owner.crmDataOwnerUserId=linked.ownerUserId
        AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
          WHERE another_owner.crmDataOwnerUserId=linked.ownerUserId
            AND another_owner.id<>linked.enterpriseId)
      WHERE linked.enterpriseId=po.enterpriseId AND linked.ownerUserId=po.ownerUserId AND linked.orderId=po.id) AS receivedQty,
    (SELECT COALESCE(SUM(invoice.amount),0) FROM crm_purchase_order_invoices invoice
      WHERE invoice.enterpriseId=po.enterpriseId AND invoice.orderId=po.id AND invoice.voidedAt IS NULL) AS invoiceAmount
    FROM crm_purchase_orders po
   WHERE po.enterpriseId=${scope.enterpriseId} AND po.ownerUserId=${scope.ownerUserId}
     ${lifecycle === "all" ? sql`` : sql`AND po.lifecycle=${lifecycle}`}
     ${keyword ? sql`AND (LOCATE(${keyword},po.orderNo)>0 OR LOCATE(${keyword},po.supplierName)>0
         OR LOCATE(${keyword},po.supplierOrderNo)>0 OR EXISTS (
           SELECT 1 FROM crm_purchase_order_items item WHERE item.enterpriseId=po.enterpriseId
             AND item.orderId=po.id AND LOCATE(${keyword},item.partNumber)>0))` : sql``}
`;
function aggregateFilters(input: PurchaseOrderListInput) { return sql`
  ${input.paymentStatus ? sql`AND result.paymentStatus=${input.paymentStatus}` : sql``}
  ${input.shippingStatus ? sql`AND (CASE WHEN result.shippedQty<=0 THEN 'pending'
    WHEN result.shippedQty<result.totalQty THEN 'partial' ELSE 'shipped' END)=${input.shippingStatus}` : sql``}
  ${input.invoiceStatus ? sql`AND (CASE WHEN result.invoiceAmount<=0 THEN 'pending'
    WHEN result.invoiceAmount<result.totalAmount THEN 'partial' ELSE 'received' END)=${input.invoiceStatus}` : sql``}
`; }
export async function listPurchaseOrders(scope: PurchaseOrderScope, input: PurchaseOrderListInput) {
  const db = await dbOrFail();
  try { return await db.transaction(async tx => {
  await guardLinkedLegacyInboundReads(tx, scope);
  const inner = aggregateSql(scope, input.keyword.trim(), input.lifecycle);
  const filters = aggregateFilters(input);
  const count = rows<{ total: number | string }>(await tx.execute(sql`
    SELECT COUNT(*) AS total FROM (${inner}) result WHERE 1=1 ${filters}
  `))[0];
  const total = Number(count?.total ?? 0);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const results = rows<Aggregate>(await tx.execute(sql`
    SELECT * FROM (${inner}) result WHERE 1=1 ${filters}
     ORDER BY result.createdAt DESC, result.id DESC LIMIT ${input.pageSize}
     OFFSET ${(page - 1) * input.pageSize}
  `));
  return { items: results.map(summary), total, page, pageSize: input.pageSize };
  }); } catch (error) { throw serviceError(error); }
}

export async function getPurchaseOrder(scope: PurchaseOrderScope, id: number) {
  const db = await dbOrFail();
  try { return await db.transaction(async tx => {
  await guardLinkedLegacyInboundReads(tx, scope);
  const row = rows<Aggregate>(await tx.execute(sql`
    SELECT * FROM (${aggregateSql(scope, "", "all")}) result WHERE result.id=${id} LIMIT 1
  `))[0];
  if (!row) missing();
  const itemRows = rows<Item & { receivedQty: number | string }>(await tx.execute(sql`
    SELECT item.*,
      (SELECT COALESCE(SUM(CASE WHEN inbound.status='received' THEN COALESCE(inbound.actualQty,inbound.qty) ELSE 0 END),0)
         FROM crm_purchase_order_inbounds linked
         INNER JOIN inbound_orders inbound ON inbound.id=linked.inboundOrderId
           AND inbound.userId=linked.ownerUserId
         INNER JOIN enterprises legacy_owner ON legacy_owner.id=linked.enterpriseId
           AND legacy_owner.crmDataOwnerUserId=linked.ownerUserId
           AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
             WHERE another_owner.crmDataOwnerUserId=linked.ownerUserId
               AND another_owner.id<>linked.enterpriseId)
        WHERE linked.enterpriseId=item.enterpriseId AND linked.orderItemId=item.id
          AND linked.orderId=${id} AND linked.ownerUserId=${scope.ownerUserId}) AS receivedQty
      FROM crm_purchase_order_items item
     WHERE item.enterpriseId=${scope.enterpriseId} AND item.orderId=${id} ORDER BY item.id ASC
  `));
  const linked = rows<{ id: number; inboundOrderId: number; orderItemId: number; slipNo: string;
    partNumber: string; supplierName: string; qty: number; actualQty: number | null; status: string;
    paymentTrackedAt: Date | string | null; paidAmount: string }>(await tx.execute(sql`
    SELECT link.id, link.inboundOrderId, link.orderItemId, inbound.slipNo, inbound.partNumber,
       inbound.supplierName, inbound.qty, inbound.actualQty, inbound.status, inbound.paymentTrackedAt,
       (SELECT COALESCE(SUM(pay.amount),0) FROM inbound_payment_entries pay
         WHERE pay.inboundOrderId=inbound.id AND pay.ownerUserId=${scope.ownerUserId}
           AND pay.voidedAt IS NULL) AS paidAmount
      FROM crm_purchase_order_inbounds link
      INNER JOIN inbound_orders inbound ON inbound.id=link.inboundOrderId
        AND inbound.userId=link.ownerUserId
      INNER JOIN enterprises legacy_owner ON legacy_owner.id=link.enterpriseId
        AND legacy_owner.crmDataOwnerUserId=link.ownerUserId
        AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
          WHERE another_owner.crmDataOwnerUserId=link.ownerUserId
            AND another_owner.id<>link.enterpriseId)
     WHERE link.enterpriseId=${scope.enterpriseId} AND link.ownerUserId=${scope.ownerUserId}
       AND link.orderId=${id} ORDER BY link.id ASC
  `));
  const invoiceRows = rows<{ id: number; invoiceNo: string; kind: string; amount: string;
    issuedDate: string | Date; note: string; voidedAt: Date | string | null }>(await tx.execute(sql`
    SELECT id, invoiceNo, kind, amount, issuedDate, note, voidedAt
      FROM crm_purchase_order_invoices WHERE enterpriseId=${scope.enterpriseId}
        AND orderId=${id} ORDER BY id ASC
  `));
  const eventRows = rows<{ id: number; actorUserId: number; action: string; details: unknown;
    createdAt: Date | string }>(await tx.execute(sql`
    SELECT id, actorUserId, action, details, createdAt FROM crm_purchase_order_events
     WHERE enterpriseId=${scope.enterpriseId} AND orderId=${id}
     ORDER BY id DESC LIMIT 100
  `));
  const info = summary(row);
  return {
    ...info, createdByUserId: Number(row.createdByUserId),
    source: row.sourceAcceptanceId ? "accepted_quote" as const : "manual" as const,
    sourceAcceptanceId: row.sourceAcceptanceId ? Number(row.sourceAcceptanceId) : null,
    sourceQuoteVersion: row.sourceQuoteVersion ? Number(row.sourceQuoteVersion) : null,
    paymentNote: row.paymentNote ?? "", paymentUpdatedAt: timeText(row.paymentUpdatedAt),
    carrier: row.carrier ?? "", trackingNo: row.trackingNo ?? "", note: row.note ?? "",
    invoiceAmount: String(row.invoiceAmount ?? "0.00"), cancelReason: row.cancelReason ?? null,
    items: itemRows.map(item => ({
      id: Number(item.id), partNumber: item.partNumber, brand: item.brand, pkg: item.pkg,
      qtyUnit: item.qtyUnit, qty: Number(item.qty), unitPrice: String(item.unitPrice),
      shippedQty: Number(item.shippedQty), receivedQty: Number(item.receivedQty ?? 0),
    })),
    inbounds: linked.map(item => ({
      id: Number(item.id), inboundOrderId: Number(item.inboundOrderId), orderItemId: Number(item.orderItemId),
      slipNo: item.slipNo, partNumber: item.partNumber, supplierName: item.supplierName ?? "",
      qty: Number(item.qty), actualQty: item.actualQty === null ? null : Number(item.actualQty),
      status: item.status, paymentTrackedAt: timeText(item.paymentTrackedAt),
      paidAmount: item.paymentTrackedAt ? String(item.paidAmount ?? "0.00") : "",
    })),
    invoices: invoiceRows.map(invoice => ({ id: Number(invoice.id), invoiceNo: invoice.invoiceNo,
      kind: invoice.kind, amount: String(invoice.amount), issuedDate: dateText(invoice.issuedDate) ?? "",
      note: invoice.note ?? "", voidedAt: timeText(invoice.voidedAt) })),
    events: eventRows.map(event => {
      const { payloadHash: _privateHash, ...details } = detailsObject(event.details);
      return { id: Number(event.id), actorUserId: Number(event.actorUserId), action: event.action,
        details, createdAt: timeText(event.createdAt) ?? "" };
    }),
  };
  }); } catch (error) { throw serviceError(error); }
}

/** 只返回同企业owner下、未关联其他采购订单、且供应商/型号可匹配的入库单。 */
export async function purchaseInboundCandidates(scope: PurchaseOrderScope, input: {
  id: number; keyword: string; limit: number;
}) {
  const order = await getPurchaseOrder(scope, input.id);
  if (order.lifecycle !== "active") return { items: [] };
  const db = await dbOrFail();
  const match = input.keyword.trim();
  try { return await db.transaction(async tx => {
  await assertExclusiveLegacyInboundOwner(tx, scope);
  const candidateRows = rows<{ id: number; slipNo: string; partNumber: string; supplierName: string;
    qty: number; actualQty: number | null; status: string; paymentTrackedAt: Date | string | null;
    paidAmount: string }>(await tx.execute(sql`
    SELECT inbound.id, inbound.slipNo, inbound.partNumber, inbound.supplierName, inbound.qty,
      inbound.actualQty, inbound.status, inbound.paymentTrackedAt,
      (SELECT COALESCE(SUM(pay.amount),0) FROM inbound_payment_entries pay
        WHERE pay.inboundOrderId=inbound.id AND pay.ownerUserId=${scope.ownerUserId} AND pay.voidedAt IS NULL) AS paidAmount
      FROM inbound_orders inbound
      INNER JOIN enterprises legacy_owner ON legacy_owner.id=${scope.enterpriseId}
        AND legacy_owner.crmDataOwnerUserId=inbound.userId
        AND NOT EXISTS (SELECT 1 FROM enterprises another_owner
          WHERE another_owner.crmDataOwnerUserId=inbound.userId
            AND another_owner.id<>${scope.enterpriseId})
     WHERE inbound.userId=${scope.ownerUserId}
       AND inbound.status<>'cancelled' AND NOT EXISTS (
         SELECT 1 FROM crm_purchase_order_inbounds link
          WHERE link.ownerUserId=${scope.ownerUserId} AND link.inboundOrderId=inbound.id)
       ${match ? sql`AND (LOCATE(${match},inbound.slipNo)>0 OR LOCATE(${match},inbound.partNumber)>0)` : sql``}
     ORDER BY inbound.id DESC LIMIT ${Math.min(input.limit * 5, 150)}
  `));
  const parts = new Set(order.items.map(item => item.partNumber));
  return { items: candidateRows.filter(item =>
    parts.has(normalizePurchasePartNumber(item.partNumber)) &&
    normalizePurchaseSupplierName(item.supplierName ?? "") === normalizePurchaseSupplierName(order.supplierName)
  ).slice(0, input.limit).map(item => ({
    id: Number(item.id), slipNo: item.slipNo, partNumber: item.partNumber,
    supplierName: item.supplierName ?? "", qty: Number(item.qty),
    actualQty: item.actualQty === null ? null : Number(item.actualQty), status: item.status,
    paymentTrackedAt: timeText(item.paymentTrackedAt),
    paidAmount: item.paymentTrackedAt ? String(item.paidAmount ?? "0.00") : "",
  })) };
  }); } catch (error) { throw serviceError(error); }
}
