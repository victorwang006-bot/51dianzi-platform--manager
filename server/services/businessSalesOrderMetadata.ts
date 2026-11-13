import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import {
  businessSalesOrderMetadataGetSchema, businessSalesOrderSaveReceiverSchema,
  businessSalesOrderAddAfterSaleSchema, businessSalesOrderUpdateAfterSaleSchema,
  businessSalesOrderReceiverDtoSchema, businessSalesOrderAfterSaleDtoSchema,
  businessSalesOrderMetadataDtoSchema,
  type BusinessSalesOrderMetadataGetInput, type BusinessSalesOrderSaveReceiverInput,
  type BusinessSalesOrderAddAfterSaleInput, type BusinessSalesOrderUpdateAfterSaleInput,
  type BusinessSalesOrderReceiverDto, type BusinessSalesOrderAfterSaleDto, type BusinessSalesOrderMetadataDto,
} from "../../shared/businessSalesOrderMetadata";

const positiveId = z.number().int().positive().max(2147483647);
const provenanceSchema = z.object({
  merchantId: positiveId, orderId: positiveId, orderNumber: z.string().min(1).max(128), customerId: positiveId,
}).strict();
const actorSchema = z.object({
  adminUserId: positiveId, frontUserId: positiveId, bindingVersion: positiveId, scopeVersion: positiveId,
}).strict();
export type BusinessSalesOrderMetadataProvenance = z.infer<typeof provenanceSchema>;
/** Supplied exclusively by the original current-authorization callback, not browser input. */
export type BusinessSalesOrderMetadataActor = z.infer<typeof actorSchema>;
type Executor = { execute: (query: SQL) => Promise<unknown> };
type Row = Record<string, unknown>;
type Action = "save_receiver" | "add_after_sale" | "update_after_sale";

function unavailable() {
  return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "业务订单信息服务暂时不可用，请稍后重试" });
}
function conflict(message = "订单信息已变化，请刷新后重试") {
  return new TRPCError({ code: "CONFLICT", message });
}
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "订单信息输入无效，请检查字段长度和版本" });
  return parsed.data;
}
function assertProvenance(value: BusinessSalesOrderMetadataProvenance) {
  if (!provenanceSchema.safeParse(value).success || value.orderNumber.trim() !== value.orderNumber) throw unavailable();
}
function assertActor(value: BusinessSalesOrderMetadataActor) {
  if (!actorSchema.safeParse(value).success) throw unavailable();
}
/** Strict numeric identity only: never coerce an alias, enterprise id or owner identity. */
export function deriveBusinessSalesOrderMetadataProvenance(
  merchant: unknown, input: BusinessSalesOrderMetadataGetInput, original: unknown,
): BusinessSalesOrderMetadataProvenance {
  const requested = parseInput(businessSalesOrderMetadataGetSchema, input);
  if (!merchant || typeof merchant !== "object" || Array.isArray(merchant)
    || !original || typeof original !== "object" || Array.isArray(original)) throw unavailable();
  const order = original as Row;
  const parsed = provenanceSchema.safeParse({
    merchantId: (merchant as Row).id, orderId: order.id, orderNumber: order.orderNumber, customerId: order.customerId,
  });
  if (!parsed.success || parsed.data.orderId !== requested.id
    || (requested.customerId !== undefined && requested.customerId !== parsed.data.customerId)
    || ("merchantId" in order && order.merchantId !== parsed.data.merchantId)) throw unavailable();
  assertProvenance(parsed.data);
  return parsed.data;
}
function assertInputTuple(p: BusinessSalesOrderMetadataProvenance, input: BusinessSalesOrderMetadataGetInput) {
  assertProvenance(p);
  if (input.id !== p.orderId || (input.customerId !== undefined && input.customerId !== p.customerId)) throw unavailable();
}
function assertRowTuple(row: Row, p: BusinessSalesOrderMetadataProvenance) {
  if (row.merchantId !== p.merchantId || row.orderId !== p.orderId
    || row.customerId !== p.customerId || row.orderNumber !== p.orderNumber) {
    throw conflict("订单信息归属核验不一致，请重新核验订单");
  }
}
function resultRows(result: unknown): Row[] {
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])
    || !result[0].every(row => row && typeof row === "object" && !Array.isArray(row))) throw unavailable();
  return result[0] as Row[];
}
function resultHeader(result: unknown): { affectedRows: number; insertId?: number } {
  if (!Array.isArray(result) || result.length !== 2 || !result[0] || typeof result[0] !== "object" || Array.isArray(result[0])) throw unavailable();
  const row = result[0] as Row;
  if (typeof row.affectedRows !== "number" || !Number.isSafeInteger(row.affectedRows) || row.affectedRows < 0) throw unavailable();
  if (row.insertId !== undefined && (typeof row.insertId !== "number" || !Number.isSafeInteger(row.insertId) || row.insertId < 0)) throw unavailable();
  return row as { affectedRows: number; insertId?: number };
}
function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z)?$/.test(value)) {
    const parsed = new Date(value.replace(" ", "T").replace(/Z$/, "") + "Z");
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  throw unavailable();
}
function receiverDto(row: Row, p: BusinessSalesOrderMetadataProvenance): BusinessSalesOrderReceiverDto {
  assertRowTuple(row, p);
  const parsed = businessSalesOrderReceiverDtoSchema.safeParse({
    receiver: row.receiver, receiverPhone: row.receiverPhone, receiverAddress: row.receiverAddress, note: row.note,
    version: row.version, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  });
  if (!parsed.success || ![parsed.data.receiver, parsed.data.receiverPhone, parsed.data.receiverAddress, parsed.data.note].some(Boolean)) throw unavailable();
  return parsed.data;
}
function afterSaleDto(row: Row, p: BusinessSalesOrderMetadataProvenance): BusinessSalesOrderAfterSaleDto {
  assertRowTuple(row, p);
  const parsed = businessSalesOrderAfterSaleDtoSchema.safeParse({
    id: row.id, kind: row.kind, reason: row.reason, status: row.status, resolution: row.resolution, version: row.version,
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    closedAt: row.closedAt === null ? null : timestamp(row.closedAt),
  });
  if (!parsed.success || (parsed.data.status === "closed") !== (parsed.data.closedAt !== null)) throw unavailable();
  return parsed.data;
}
/** Drizzle normalizes callback Pool to promise() internally and leases one connection
 * per transaction, with commit/rollback/release. Never manually BEGIN on pooled execute
 * or use $client (which can still be the unnormalized callback Pool). */
async function transaction<T>(operation: (tx: Executor) => Promise<T>): Promise<T> {
  try {
    const db = await getDb();
    if (!db || typeof db.transaction !== "function") throw unavailable();
    return await db.transaction(tx => operation(tx));
  } catch (error) {
    // Only local bounded errors can escape. No DB SQL/path/cause or binding details.
    if (error instanceof TRPCError) throw error;
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    if (code === "ER_DUP_ENTRY") throw conflict("订单信息标识冲突，请刷新并重新核验");
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") throw conflict("订单信息正在更新，请稍后使用相同请求标识重试");
    throw unavailable();
  }
}
async function loadOrderTuple(tx: Executor, p: BusinessSalesOrderMetadataProvenance, lock: boolean): Promise<Row | null> {
  const rows = resultRows(await tx.execute(sql`
    SELECT merchantId, orderId, orderNumber, customerId
      FROM business_sales_order_metadata_orders
     WHERE merchantId = ${p.merchantId} AND (orderId = ${p.orderId} OR orderNumber = ${p.orderNumber})
     LIMIT 2 ${lock ? sql`FOR UPDATE` : sql``}
  `));
  if (rows.length > 1) throw unavailable();
  if (rows[0]) assertRowTuple(rows[0], p);
  return rows[0] ?? null;
}
async function lockOrderTuple(tx: Executor, p: BusinessSalesOrderMetadataProvenance) {
  // An order-number collision MUST NOT overwrite provenance. The unique order
  // key is the write serialization point for all receiver/case/request/audit work.
  resultHeader(await tx.execute(sql`
    INSERT INTO business_sales_order_metadata_orders (merchantId, orderId, orderNumber, customerId)
    VALUES (${p.merchantId}, ${p.orderId}, ${p.orderNumber}, ${p.customerId})
    ON DUPLICATE KEY UPDATE orderId = orderId
  `));
  if (!await loadOrderTuple(tx, p, true)) throw conflict("订单信息标识冲突，请重新核验订单");
}
async function loadReceiver(tx: Executor, p: BusinessSalesOrderMetadataProvenance): Promise<BusinessSalesOrderReceiverDto | null> {
  const rows = resultRows(await tx.execute(sql`
    SELECT merchantId, orderId, orderNumber, customerId, receiver, receiverPhone, receiverAddress, note, version, createdAt, updatedAt
      FROM business_sales_order_receivers WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} LIMIT 1
  `));
  if (rows.length > 1) throw unavailable();
  return rows[0] ? receiverDto(rows[0], p) : null;
}
async function loadCase(tx: Executor, p: BusinessSalesOrderMetadataProvenance, caseId: number): Promise<BusinessSalesOrderAfterSaleDto> {
  const rows = resultRows(await tx.execute(sql`
    SELECT id, merchantId, orderId, orderNumber, customerId, kind, reason, status, resolution, version, createdAt, updatedAt, closedAt
      FROM business_sales_order_after_sales
     WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} AND id = ${caseId} LIMIT 1
  `));
  if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "该订单的售后记录不存在" });
  if (rows.length !== 1 || rows[0].id !== caseId) throw unavailable();
  return afterSaleDto(rows[0], p);
}
export async function getBusinessSalesOrderMetadata(p: BusinessSalesOrderMetadataProvenance): Promise<BusinessSalesOrderMetadataDto> {
  assertProvenance(p);
  return transaction(async tx => {
    const base = await loadOrderTuple(tx, p, false);
    const receiver = await loadReceiver(tx, p);
    const rows = resultRows(await tx.execute(sql`
      SELECT id, merchantId, orderId, orderNumber, customerId, kind, reason, status, resolution, version, createdAt, updatedAt, closedAt
        FROM business_sales_order_after_sales
       WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} ORDER BY id ASC
    `));
    if (!base && (receiver || rows.length > 0)) throw unavailable();
    const afterSales = rows.map(row => afterSaleDto(row, p));
    if (new Set(afterSales.map(row => row.id)).size !== afterSales.length) throw unavailable();
    return businessSalesOrderMetadataDtoSchema.parse({ ...p, receiver, afterSales });
  });
}

function digest(action: Action, p: BusinessSalesOrderMetadataProvenance, payload: unknown) {
  const provenance = { merchantId: p.merchantId, orderId: p.orderId, orderNumber: p.orderNumber, customerId: p.customerId };
  return createHash("sha256").update(JSON.stringify({ schemaVersion: 1, action, provenance, payload })).digest("hex");
}
async function withRequest<T extends BusinessSalesOrderReceiverDto | BusinessSalesOrderAfterSaleDto>(
  p: BusinessSalesOrderMetadataProvenance, actor: BusinessSalesOrderMetadataActor, requestId: string,
  action: Action, payload: unknown, dtoSchema: z.ZodType<T>,
  operation: (tx: Executor) => Promise<{ before: T | null; after: T; caseId: number | null }>,
): Promise<T> {
  assertProvenance(p);
  assertActor(actor);
  const hash = digest(action, p, payload);
  return transaction(async tx => {
    await lockOrderTuple(tx, p);
    resultHeader(await tx.execute(sql`
      INSERT INTO business_sales_order_metadata_requests
        (merchantId, orderId, orderNumber, customerId, actorAdminId, requestId, action, payloadSha256, resultJson)
      VALUES (${p.merchantId}, ${p.orderId}, ${p.orderNumber}, ${p.customerId}, ${actor.adminUserId}, ${requestId}, ${action}, ${hash}, NULL)
      ON DUPLICATE KEY UPDATE requestId = requestId
    `));
    const requests = resultRows(await tx.execute(sql`
      SELECT merchantId, orderId, orderNumber, customerId, actorAdminId, requestId, action, payloadSha256, resultJson
        FROM business_sales_order_metadata_requests
       WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} AND actorAdminId = ${actor.adminUserId} AND requestId = ${requestId}
       LIMIT 1 FOR UPDATE
    `));
    if (requests.length !== 1) throw unavailable();
    const request = requests[0];
    assertRowTuple(request, p);
    if (request.actorAdminId !== actor.adminUserId || request.requestId !== requestId
      || request.action !== action || request.payloadSha256 !== hash) throw conflict("请求标识已用于不同内容，请使用新的请求标识");
    if (request.resultJson !== null) {
      let stored: unknown = request.resultJson;
      if (typeof stored === "string") {
        if (stored.length > 16384) throw unavailable();
        try { stored = JSON.parse(stored); } catch { throw unavailable(); }
      }
      const parsed = dtoSchema.safeParse(stored);
      if (!parsed.success) throw unavailable();
      return parsed.data;
    }
    const result = await operation(tx);
    const after = dtoSchema.safeParse(result.after);
    if (!after.success) throw unavailable();
    const afterJson = JSON.stringify(after.data);
    const beforeJson = result.before === null ? null : JSON.stringify(result.before);
    const audit = resultHeader(await tx.execute(sql`
      INSERT INTO business_sales_order_metadata_audits
        (merchantId, orderId, orderNumber, customerId, caseId, action, actorAdminId, actorFrontUserId, bindingVersion, scopeVersion, requestId, beforeJson, afterJson)
      VALUES (${p.merchantId}, ${p.orderId}, ${p.orderNumber}, ${p.customerId}, ${result.caseId}, ${action},
        ${actor.adminUserId}, ${actor.frontUserId}, ${actor.bindingVersion}, ${actor.scopeVersion}, ${requestId}, ${beforeJson}, ${afterJson})
    `));
    if (audit.affectedRows !== 1) throw unavailable();
    const completion = resultHeader(await tx.execute(sql`
      UPDATE business_sales_order_metadata_requests SET resultJson = ${afterJson}
       WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} AND actorAdminId = ${actor.adminUserId}
         AND requestId = ${requestId} AND payloadSha256 = ${hash} AND resultJson IS NULL
    `));
    if (completion.affectedRows !== 1) throw conflict();
    return after.data;
  });
}

export async function saveBusinessSalesOrderReceiver(
  p: BusinessSalesOrderMetadataProvenance, actor: BusinessSalesOrderMetadataActor, raw: BusinessSalesOrderSaveReceiverInput,
): Promise<BusinessSalesOrderReceiverDto> {
  const input = parseInput(businessSalesOrderSaveReceiverSchema, raw);
  assertInputTuple(p, input);
  const { requestId, ...payload } = input;
  return withRequest(p, actor, requestId, "save_receiver", payload, businessSalesOrderReceiverDtoSchema, async tx => {
    const before = await loadReceiver(tx, p);
    if ((before?.version ?? 0) !== input.version) throw conflict();
    if (!before) {
      const inserted = resultHeader(await tx.execute(sql`
        INSERT INTO business_sales_order_receivers
          (merchantId, orderId, orderNumber, customerId, receiver, receiverPhone, receiverAddress, note, version)
        VALUES (${p.merchantId}, ${p.orderId}, ${p.orderNumber}, ${p.customerId}, ${input.receiver}, ${input.receiverPhone}, ${input.receiverAddress}, ${input.note}, 1)
      `));
      if (inserted.affectedRows !== 1) throw unavailable();
    } else {
      const updated = resultHeader(await tx.execute(sql`
        UPDATE business_sales_order_receivers
           SET receiver = ${input.receiver}, receiverPhone = ${input.receiverPhone}, receiverAddress = ${input.receiverAddress},
               note = ${input.note}, version = version + 1, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} AND orderNumber = ${p.orderNumber}
           AND customerId = ${p.customerId} AND version = ${input.version}
      `));
      if (updated.affectedRows !== 1) throw conflict();
    }
    const after = await loadReceiver(tx, p);
    if (!after || after.version !== input.version + 1) throw unavailable();
    return { before, after, caseId: null };
  });
}
export async function addBusinessSalesOrderAfterSale(
  p: BusinessSalesOrderMetadataProvenance, actor: BusinessSalesOrderMetadataActor, raw: BusinessSalesOrderAddAfterSaleInput,
): Promise<BusinessSalesOrderAfterSaleDto> {
  const input = parseInput(businessSalesOrderAddAfterSaleSchema, raw);
  assertInputTuple(p, input);
  const { requestId, ...payload } = input;
  return withRequest(p, actor, requestId, "add_after_sale", payload, businessSalesOrderAfterSaleDtoSchema, async tx => {
    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO business_sales_order_after_sales (merchantId, orderId, orderNumber, customerId, kind, reason, status, resolution, version)
      VALUES (${p.merchantId}, ${p.orderId}, ${p.orderNumber}, ${p.customerId}, ${input.kind}, ${input.reason}, 'open', '', 1)
    `));
    if (inserted.affectedRows !== 1 || !positiveId.safeParse(inserted.insertId).success) throw unavailable();
    const caseId = inserted.insertId!;
    const after = await loadCase(tx, p, caseId);
    if (after.version !== 1 || after.status !== "open" || after.kind !== input.kind || after.reason !== input.reason) throw unavailable();
    return { before: null, after, caseId };
  });
}
export async function updateBusinessSalesOrderAfterSale(
  p: BusinessSalesOrderMetadataProvenance, actor: BusinessSalesOrderMetadataActor, raw: BusinessSalesOrderUpdateAfterSaleInput,
): Promise<BusinessSalesOrderAfterSaleDto> {
  const input = parseInput(businessSalesOrderUpdateAfterSaleSchema, raw);
  assertInputTuple(p, input);
  const { requestId, ...payload } = input;
  return withRequest(p, actor, requestId, "update_after_sale", payload, businessSalesOrderAfterSaleDtoSchema, async tx => {
    const before = await loadCase(tx, p, input.caseId);
    if (before.version !== input.version) throw conflict();
    // Keeping a closed record closed preserves its original record-close time.
    // Reopening clears closedAt; closing again records this new close, not a refund.
    const closedAt = input.status === "closed"
      ? before.status === "closed" ? sql`closedAt` : sql`CURRENT_TIMESTAMP(3)` : sql`NULL`;
    const updated = resultHeader(await tx.execute(sql`
      UPDATE business_sales_order_after_sales
         SET status = ${input.status}, resolution = ${input.resolution}, version = version + 1,
             updatedAt = CURRENT_TIMESTAMP(3), closedAt = ${closedAt}
       WHERE merchantId = ${p.merchantId} AND orderId = ${p.orderId} AND orderNumber = ${p.orderNumber}
         AND customerId = ${p.customerId} AND id = ${input.caseId} AND version = ${input.version}
    `));
    if (updated.affectedRows !== 1) throw conflict();
    const after = await loadCase(tx, p, input.caseId);
    if (after.version !== input.version + 1 || after.status !== input.status || after.resolution !== input.resolution) throw unavailable();
    return { before, after, caseId: input.caseId };
  });
}
