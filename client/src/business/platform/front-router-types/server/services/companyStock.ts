import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { normalizeErpPermissions } from "../../../shared/erpPermissions";
import {
  companyStockLotsFilterSchema,
  companyStockLotsPageSchema, type CompanyStockLotsPageInput, type CompanyStockLotsPage,
  companyStockReconcileSchema, type CompanyStockReconcileInput,
  type CompanyStockScope, type CompanyStockLotsFilter, type CompanyStockLotCandidate,
  type CompanyStockLotCostSnapshot, type CompanyStockInboundSnapshot, type CompanyStockReserveInput,
  type CompanyStockConsumeInput, type CompanyStockConsumeResult, type CompanyStockConsumption,
  type CompanyStockAllocation, type CompanyStockItemIdentity,
} from "../../../shared/companyStock";

export interface CompanyStockExecutor { execute(query: SQL): Promise<unknown> }
export interface CompanyStockDatabase extends CompanyStockExecutor {
  transaction<T>(callback: (tx: CompanyStockExecutor) => Promise<T>): Promise<T>;
}
export type CompanyStockDeps = { getDb: () => Promise<CompanyStockDatabase | null> };
type Lot = CompanyStockLotCostSnapshot & CompanyStockItemIdentity & {
  id: number; enterpriseId: number; ownerUserId: number; inboundOrderId: number;
  receivedQty: number; remainingQty: number; reservedQty: number; version: number;
  verified: boolean | number; frozen: boolean | number; reversedAt: string | null;
  lotNumber: string; location: string; receiptHash: string;
};
type Reservation = { id: number; orderId: number; orderItemId: number; lotId: number; qty: number; consumedQty: number; releasedQty: number; version: number };
type Inbound = {
  id: number; userId: number; partNumber: string; brand: string | null; packageType: string | null; prodYear: string | null;
  lotNumber: string | null; location: string | null; qty: number; actualQty: number | null; status: string; priceMissing: number | boolean;
  unitCostTaxIncluded: string | null; unitCostTaxExcluded: string | null; unitCostBasis: string | null; taxRate: string | null;
};
const NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;
function rows<T>(value: unknown): T[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error("Invalid company stock SQL response");
  return value[0] as T[];
}
function header(value: unknown): { affectedRows?: number; insertId?: number } {
  return (value as [{ affectedRows?: number; insertId?: number }])[0] ?? {};
}
function conflict(message: string): never { throw new TRPCError({ code: "CONFLICT", message }); }
function forbidden(message: string): never { throw new TRPCError({ code: "FORBIDDEN", message }); }
function bad(message: string): never { throw new TRPCError({ code: "BAD_REQUEST", message }); }
function id(value: number) { if (!Number.isSafeInteger(value) || value <= 0) bad("库存标识无效"); return value; }
function quantity(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 999999999) bad("库存数量无效");
  return value;
}
function changed(result: unknown, message = "库存刚刚发生变化，请刷新后重试") {
  if (Number(header(result).affectedRows) !== 1) conflict(message);
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function binaryPartOrder(a: string, b: string) { return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")); }
function costString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) conflict("批次真实成本字段无效，需核对");
  const [a, b = ""] = raw.split(".");
  return `${a}.${b.padEnd(6, "0")}`;
}
function costSnapshot(lot: Lot): CompanyStockLotCostSnapshot {
  return { lotId: Number(lot.id), partNumber: lot.partNumber,
    unitCostTaxIncluded: costString(lot.unitCostTaxIncluded), unitCostTaxExcluded: costString(lot.unitCostTaxExcluded),
    unitCostBasis: lot.unitCostBasis ?? null, taxRate: lot.taxRate == null ? null : String(lot.taxRate) };
}
function safeIdentity(lot: Lot): CompanyStockItemIdentity {
  return { partNumber: lot.partNumber, brand: lot.brand, pkg: lot.pkg, dc: lot.dc };
}
function sameIdentity(a: CompanyStockItemIdentity, b: CompanyStockItemIdentity) {
  return a.partNumber === b.partNumber && (a.brand ?? "") === b.brand && (a.pkg ?? "") === b.pkg && (a.dc ?? "") === b.dc;
}
function allocations(input: CompanyStockAllocation[]) {
  if (!Array.isArray(input) || !input.length || input.length > 200) bad("请选择1至200项真实批次分配");
  const seen = new Set<string>();
  return input.map(item => {
    id(item.orderItemId); id(item.lotId); quantity(item.qty);
    const key = `${item.orderItemId}:${item.lotId}`;
    if (seen.has(key)) bad("同一订单行批次不能重复，请合并数量");
    seen.add(key);
    return item;
  }).sort((a, b) => a.lotId - b.lotId || a.orderItemId - b.orderItemId);
}
function sumBy<T>(items: T[], key: (item: T) => number | string, qty: (item: T) => number) {
  const result = new Map<number | string, number>();
  for (const item of items) {
    const k = key(item), total = (result.get(k) ?? 0) + qty(item);
    quantity(total, true); result.set(k, total);
  }
  return result;
}

/** Only native getDb and pure helpers. No adminDb, market inventory, HTTP, or route call. */
export function createCompanyStockService(deps: CompanyStockDeps) {
  async function db() { const value = await deps.getDb(); if (!value) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" }); return value; }
  async function scopeState(tx: CompanyStockExecutor, scope: CompanyStockScope, lock: boolean) {
    id(scope.enterpriseId); id(scope.ownerUserId); id(scope.actorUserId);
    // Existing non-unique owner index is a deployment prerequisite. FORCE INDEX
    // keeps the locking equality scan on this owner range (including its gaps),
    // not a full enterprise scan. Duplicate-owner rows remain locked and denied.
    const enterprises = rows<{ id: number; crmDataOwnerUserId: number; superAdminUserId: number }>(await tx.execute(sql`
      SELECT id, crmDataOwnerUserId, superAdminUserId FROM enterprises FORCE INDEX (enterprises_crm_data_owner_idx)
       WHERE crmDataOwnerUserId = ${scope.ownerUserId} ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}
    `));
    if (enterprises.length !== 1 || Number(enterprises[0].id) !== scope.enterpriseId) forbidden("公司库存企业owner归属不唯一或已变化");
    const members = rows<{ id: number; userId: number; role: string; status: string; loginDisabled: boolean | number }>(await tx.execute(sql`
      SELECT em.id, em.userId, em.role, em.status, u.loginDisabled FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
       WHERE em.enterpriseId = ${scope.enterpriseId} ${lock ? sql`` : sql`AND em.userId = ${scope.actorUserId}`}
       ORDER BY em.userId ${lock ? sql`FOR UPDATE` : sql``}
    `));
    const actor = members.find(member => Number(member.userId) === scope.actorUserId);
    if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) forbidden("当前企业成员不可用");
    const owner = actor.role === "super_admin" && Number(enterprises[0].superAdminUserId) === scope.actorUserId;
    const permissions = rows<{ enterpriseMemberId: number; permissionKey: string }>(await tx.execute(sql`
      SELECT p.enterpriseMemberId, p.permissionKey FROM enterprise_member_permissions p
       INNER JOIN enterprise_members em ON em.id = p.enterpriseMemberId
       WHERE em.enterpriseId = ${scope.enterpriseId} ${lock ? sql`` : sql`AND em.id = ${actor.id}`}
       ORDER BY p.enterpriseMemberId, p.permissionKey ${lock ? sql`FOR UPDATE` : sql``}
    `));
    // Fence the same native member/team authority used by procurement and CRM.
    // All company members precede team rows, including buyer/assignee rechecks.
    const memberships = rows<{ userId: number; teamId: number; teamRole: string }>(await tx.execute(sql`
      SELECT userId, teamId, teamRole FROM enterprise_team_members WHERE enterpriseId = ${scope.enterpriseId}
       ORDER BY userId, teamId ${lock ? sql`FOR UPDATE` : sql``}
    `));
    const teams = rows<{ id: number; status: string }>(await tx.execute(sql`
      SELECT id, status FROM enterprise_teams WHERE enterpriseId = ${scope.enterpriseId}
       ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}
    `));
    return { owner, actor, permissions: permissions.filter(p => Number(p.enterpriseMemberId) === Number(actor.id)),
      teams: memberships.filter(m => Number(m.userId) === scope.actorUserId && teams.some(t => Number(t.id) === Number(m.teamId) && t.status === "active")) };
  }
  /** FIRST in the caller's tx, before source/CRM/ledger writes or locks. Identity
   * fencing only: original procurement/CRM permissions and visibility still run.
   * No trust flag/cache: later access rechecks current authority under these locks. */
  async function lockCompanyStockScopeInTx(tx: CompanyStockExecutor, scope: CompanyStockScope): Promise<void> {
    await scopeState(tx, scope, true);
  }
  async function access(tx: CompanyStockExecutor, scope: CompanyStockScope, permission: "inventory.inbound" | "sales.business_orders" | "sales_orders.manage", lock = true) {
    const state = await scopeState(tx, scope, lock);
    if (!state.owner && !normalizeErpPermissions(state.permissions.map(p => p.permissionKey)).includes(permission)) forbidden("没有当前公司库存操作权限");
    return state;
  }
  async function lockLedgers(tx: CompanyStockExecutor, scope: CompanyStockScope, parts: string[]) {
    const result = new Map<string, { currentQty: number; movementVersion: number }>();
    for (const part of Array.from(new Set(parts)).sort(binaryPartOrder)) {
      const ledger = rows<{ partNumber: string; currentQty: number; movementVersion: number }>(await tx.execute(sql`
        SELECT partNumber, currentQty, movementVersion FROM stock_ledger
         WHERE userId = ${scope.ownerUserId} AND BINARY partNumber = BINARY ${part} LIMIT 1 FOR UPDATE
      `))[0];
      if (!ledger || ledger.partNumber !== part) conflict("公司型号账不存在或型号精确归属不一致");
      result.set(part, ledger);
    }
    return result;
  }
  async function readLots(tx: CompanyStockExecutor, scope: CompanyStockScope, lotIds: number[], lock = false) {
    const ids = Array.from(new Set(lotIds.map(id))).sort((a, b) => a - b);
    if (!ids.length) return [] as Lot[];
    const lots = rows<Lot>(await tx.execute(sql`
      SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId}
       AND id IN (${sql.join(ids.map(x => sql`${x}`), sql`, `)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}
    `));
    if (lots.length !== ids.length) forbidden("批次不属于当前公司或不存在");
    return lots;
  }
  async function assertReceived(tx: CompanyStockExecutor, scope: CompanyStockScope, lots: Lot[]) {
    // No inbound FOR UPDATE here: receipts/reversals lock inbound then ledger then lot.
    // With ledger/lot held, a reversal cannot change the physical source concurrently.
    for (const lot of lots) {
      const source = rows<{ id: number }>(await tx.execute(sql`
        SELECT io.id FROM inbound_orders io WHERE io.id = ${lot.inboundOrderId} AND io.userId = ${scope.ownerUserId}
         AND io.status = 'received' AND NOT EXISTS (SELECT 1 FROM inbound_ledger_effects e WHERE e.inboundOrderId = io.id AND e.reversedAt IS NOT NULL)
         LIMIT 1
      `))[0];
      if (!source || !lot.verified || lot.frozen || lot.reversedAt) conflict("批次尚未核对、已冻结或入库已冲销，不可销售");
    }
  }
  async function lockedAllocationLots(tx: CompanyStockExecutor, scope: CompanyStockScope, items: CompanyStockAllocation[]) {
    const preview = await readLots(tx, scope, items.map(x => x.lotId));
    await lockLedgers(tx, scope, preview.map(x => x.partNumber));
    const lots = await readLots(tx, scope, items.map(x => x.lotId), true);
    await assertReceived(tx, scope, lots);
    return lots;
  }
  async function orderItems(tx: CompanyStockExecutor, scope: CompanyStockScope, orderId: number, items: CompanyStockAllocation[], confirmed = true) {
    id(orderId);
    const order = rows<{ id: number; status: string }>(await tx.execute(sql`
      SELECT id, status FROM crm_sales_orders WHERE id = ${orderId} AND enterpriseId = ${scope.enterpriseId} LIMIT 1 FOR UPDATE
    `))[0];
    if (!order) forbidden("订单不属于当前公司");
    if (confirmed && order.status !== "confirmed") conflict("订单已取消，不可预留或出库");
    const ids = Array.from(new Set(items.map(x => x.orderItemId))).sort((a, b) => a - b);
    if (!ids.length) return [] as Array<CompanyStockItemIdentity & { id: number; orderedQty: number }>;
    const result = rows<CompanyStockItemIdentity & { id: number; orderedQty: number }>(await tx.execute(sql`
      SELECT id, partNumber, brand, pkg, dc, orderedQty FROM crm_sales_order_items
       WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${orderId}
         AND id IN (${sql.join(ids.map(x => sql`${x}`), sql`, `)}) ORDER BY id FOR UPDATE
    `));
    if (result.length !== ids.length) forbidden("订单行归属不匹配");
    return result;
  }
  function validateItems(items: CompanyStockAllocation[], stored: Array<CompanyStockItemIdentity & { id: number; orderedQty: number }>, lots: Lot[], fullReservation = false) {
    const totals = sumBy(items, x => x.orderItemId, x => x.qty);
    for (const item of items) {
      const line = stored.find(x => Number(x.id) === item.orderItemId)!;
      const lot = lots.find(x => Number(x.id) === item.lotId)!;
      if (!sameIdentity(line, safeIdentity(lot)) || item.expected && !sameIdentity(item.expected, safeIdentity(lot))) bad("型号、品牌、包装或DC与真实公司批次不一致");
      const total = totals.get(item.orderItemId)!;
      if (total > Number(line.orderedQty) || fullReservation && total !== Number(line.orderedQty)) bad("预留必须覆盖订单行全部数量，出库不能超过订单数量");
    }
  }
  async function reservations(tx: CompanyStockExecutor, scope: CompanyStockScope, orderId: number, lock = true) {
    return rows<Reservation>(await tx.execute(sql`
      SELECT id, orderId, orderItemId, lotId, qty, consumedQty, releasedQty, version FROM company_stock_reservations
       WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND orderId = ${orderId}
       ORDER BY lotId, orderItemId ${lock ? sql`FOR UPDATE` : sql``}
    `));
  }
  async function recordInboundLotInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, snapshot: CompanyStockInboundSnapshot) {
    await access(tx, scope, "inventory.inbound"); id(snapshot.inboundOrderId);
    if (snapshot.receiptKind !== "new_receipt") bad("历史库存必须通过人工盘点核对入口");
    const inbound = rows<Inbound>(await tx.execute(sql`
      SELECT io.* FROM inbound_orders io INNER JOIN inbound_procurement_owners ipo ON ipo.inboundOrderId = io.id
       AND ipo.enterpriseId = ${scope.enterpriseId} AND ipo.ownerUserId = ${scope.ownerUserId}
       WHERE io.id = ${snapshot.inboundOrderId} AND io.userId = ${scope.ownerUserId} AND io.status = 'received' LIMIT 1 FOR UPDATE
    `))[0];
    if (!inbound || inbound.actualQty == null) conflict("新实收入库或企业归属凭证缺失");
    const qty = quantity(Number(inbound.actualQty));
    await lockLedgers(tx, scope, [inbound.partNumber]);
    const effect = rows<{ qty: number; reversedAt: string | null }>(await tx.execute(sql`
      SELECT qty, reversedAt FROM inbound_ledger_effects WHERE inboundOrderId = ${inbound.id} AND ownerUserId = ${scope.ownerUserId} LIMIT 1
    `))[0];
    if (!effect || effect.reversedAt || Number(effect.qty) !== qty) conflict("新入库型号账凭证缺失或不一致");
    const receiptHash = hash({ source: inbound.id, qty, partNumber: inbound.partNumber, brand: inbound.brand ?? "", pkg: inbound.packageType ?? "", dc: inbound.prodYear ?? "" });
    const existing = rows<Lot>(await tx.execute(sql`SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND inboundOrderId = ${inbound.id} LIMIT 1 FOR UPDATE`))[0];
    if (existing) {
      if (existing.receiptHash !== receiptHash || existing.reversedAt) conflict("同一入库批次重复内容不一致");
      return costSnapshot(existing);
    }
    await assertAssignedWithinLedger(tx, scope, inbound.partNumber, qty);
    return insertInboundLot(tx, scope, inbound, qty, receiptHash);
  }
  async function assertAssignedWithinLedger(tx: CompanyStockExecutor, scope: CompanyStockScope, partNumber: string, added: number) {
    const ledger = (await lockLedgers(tx, scope, [partNumber])).get(partNumber)!;
    const assigned = rows<{ remaining: number }>(await tx.execute(sql`SELECT COALESCE(SUM(remainingQty), 0) AS remaining FROM company_stock_lots WHERE ownerUserId = ${scope.ownerUserId} AND BINARY partNumber = BINARY ${partNumber} AND reversedAt IS NULL`))[0];
    if (Number(assigned?.remaining ?? 0) + added > Number(ledger.currentQty)) conflict("已登记批次剩余加本次盘点分配超过公司型号账，不能自动修正真实库存");
    return ledger;
  }
  /** Caller must FIRST lockCompanyStockScopeInTx, then use original inboundProcurementWhere and lock the source row.
   * Native owner/member/team fences here are additional checks, not an expansion of visibility. */
  async function reconcileInboundLotInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, raw: CompanyStockReconcileInput) {
    const input = companyStockReconcileSchema.parse(raw), state = await access(tx, scope, "inventory.inbound");
    const source = rows<Inbound>(await tx.execute(sql`SELECT * FROM inbound_orders WHERE id = ${input.id} AND userId = ${scope.ownerUserId} AND status = 'received' LIMIT 1 FOR UPDATE`))[0];
    if (!source) forbidden("只能核对当前公司已实收入库记录");
    const ownership = rows<{ enterpriseId: number; ownerUserId: number; teamId: number | null }>(await tx.execute(sql`SELECT enterpriseId, ownerUserId, teamId FROM inbound_procurement_owners WHERE inboundOrderId = ${input.id} FOR UPDATE`));
    if (ownership.length > 1 || ownership.length === 1 && (Number(ownership[0].enterpriseId) !== scope.enterpriseId || Number(ownership[0].ownerUserId) !== scope.ownerUserId)) forbidden("原入库企业归属凭证冲突，必须人工排查");
    if (!state.owner) {
      if (ownership.length !== 1 || !ownership[0].teamId) forbidden("无归属历史仅现行公司owner可显式核验库存归属");
      const teams = state.teams.filter(team => team.teamRole === "leader");
      if (teams.length !== 1 || Number(teams[0].teamId) !== Number(ownership[0].teamId)) forbidden("仅当前业务组主管可核对可见采购库存");
    }
    const reversed = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM inbound_ledger_effects WHERE inboundOrderId = ${input.id} AND reversedAt IS NOT NULL LIMIT 1`))[0];
    if (reversed) conflict("已冲销凭证不能核对为可售库存");
    const ledger = (await lockLedgers(tx, scope, [source.partNumber])).get(source.partNumber)!;
    const receiptHash = hash({ kind: "manual_reconciliation", ...input, enterpriseId: scope.enterpriseId, ownerUserId: scope.ownerUserId, actorUserId: scope.actorUserId });
    const prior = rows<Lot>(await tx.execute(sql`SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND inboundOrderId = ${input.id} LIMIT 1 FOR UPDATE`))[0];
    if (prior) {
      if (prior.receiptHash !== receiptHash || prior.reversedAt) conflict("该入库已核对或请求内容不一致；不能再次盘增或重分配");
      return { success: true as const, replayed: true, lotId: Number(prior.id), remainingQty: Number(prior.remainingQty), verified: Boolean(prior.verified) };
    }
    const reused = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND reconciliationRequestId = ${input.clientRequestId} LIMIT 1`))[0];
    if (reused) conflict("同一核对请求标识已用于另一入库单，请刷新重试");
    if (Number(ledger.movementVersion) !== input.expectedMovementVersion) conflict("型号账已变化，请刷新后重新盘点确认");
    const receivedQty = quantity(Number(source.actualQty ?? source.qty));
    if (input.remainingQty > receivedQty) bad("核对剩余不能超过原实收记录；数量异常请走人工盘点差异处理");
    await assertAssignedWithinLedger(tx, scope, source.partNumber, input.remainingQty);
    const cost = await insertInboundLot(tx, scope, source, input.remainingQty, receiptHash, input.clientRequestId);
    await tx.execute(sql`INSERT INTO inbound_order_events (inboundOrderId, ownerUserId, actorUserId, eventType, reason, snapshot) VALUES (${input.id}, ${scope.ownerUserId}, ${scope.actorUserId}, 'company_stock_reconciled', ${input.reason}, ${JSON.stringify({ lotId: cost.lotId, remainingQty: input.remainingQty, ownershipConfirmed: true, hasProcurementOwnership: ownership.length === 1, requestId: input.clientRequestId, movementVersion: input.expectedMovementVersion, financialDataUnchanged: true })})`);
    return { success: true as const, replayed: false, lotId: cost.lotId, remainingQty: input.remainingQty, verified: true };
  }
  async function guardInboundDetailsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: { inboundOrderId: number; partNumber: string; pkg: string; lotNumber: string; location: string }) {
    await access(tx, scope, "inventory.inbound");
    id(input.inboundOrderId);
    const source = rows<{ partNumber: string }>(await tx.execute(sql`SELECT partNumber FROM inbound_orders WHERE id = ${input.inboundOrderId} AND userId = ${scope.ownerUserId} LIMIT 1 FOR UPDATE`))[0];
    if (!source) forbidden("入库不属于当前公司");
    if (source.partNumber !== input.partNumber) conflict("原入库型号已变化，请刷新后重试");
    const tracked = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND inboundOrderId = ${input.inboundOrderId} LIMIT 1`))[0];
    if (!tracked) return;
    await lockLedgers(tx, scope, [source.partNumber]);
    const lot = rows<Lot>(await tx.execute(sql`SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND inboundOrderId = ${input.inboundOrderId} LIMIT 1 FOR UPDATE`))[0];
    if (lot && (lot.pkg !== input.pkg || lot.lotNumber !== input.lotNumber || lot.location !== input.location)) conflict("已建立实物批次的包装、批号、仓位不能经旧安全编辑改写；请保持原值");
  }
  async function assertOutboundAccessInTx(tx: CompanyStockExecutor, scope: CompanyStockScope) { await access(tx, scope, "sales_orders.manage"); }
  async function insertInboundLot(tx: CompanyStockExecutor, scope: CompanyStockScope, inbound: Inbound, remaining: number, receiptHash: string, reconciliationRequestId?: string) {
    // Missing-price provenance MUST NOT be rewritten into a real zero cost.
    const included = inbound.priceMissing ? null : costString(inbound.unitCostTaxIncluded);
    const excluded = inbound.priceMissing ? null : costString(inbound.unitCostTaxExcluded);
    const basis = included == null && excluded == null ? null : inbound.unitCostBasis;
    const rate = included == null && excluded == null ? null : inbound.taxRate;
    const receivedQty = Number(inbound.actualQty ?? inbound.qty);
    quantity(receivedQty);
    const result = await tx.execute(sql`
      INSERT INTO company_stock_lots
       (enterpriseId, ownerUserId, inboundOrderId, partNumber, brand, pkg, dc, lotNumber, location, receivedQty, remainingQty, reservedQty,
        verified, frozen, version, unitCostTaxIncluded, unitCostTaxExcluded, unitCostBasis, taxRate, receiptHash, reconciliationRequestId, verifiedByUserId, verifiedAt, createdAt)
      VALUES (${scope.enterpriseId}, ${scope.ownerUserId}, ${inbound.id}, ${inbound.partNumber}, ${inbound.brand ?? ""}, ${inbound.packageType ?? ""},
       ${inbound.prodYear ?? ""}, ${inbound.lotNumber ?? ""}, ${inbound.location ?? ""}, ${receivedQty}, ${remaining}, 0, TRUE, FALSE, 1,
       ${included}, ${excluded}, ${basis}, ${rate}, ${receiptHash}, ${reconciliationRequestId ?? null}, ${scope.actorUserId}, ${NOW}, ${NOW})
    `);
    const lotId = Number(header(result).insertId); if (!lotId) throw new Error("公司实物批次写入失败");
    return { lotId, partNumber: inbound.partNumber, unitCostTaxIncluded: included, unitCostTaxExcluded: excluded, unitCostBasis: basis ?? null, taxRate: rate == null ? null : String(rate) };
  }
  async function listAvailableLots(scope: CompanyStockScope, rawFilters: CompanyStockLotsFilter = {}): Promise<CompanyStockLotCandidate[]> {
    const filters = companyStockLotsFilterSchema.parse(rawFilters), executor = await db();
    await access(executor, scope, "sales.business_orders", false);
    const conditions = availableLotConditions(scope);
    for (const key of ["partNumber", "brand", "pkg", "dc", "location"] as const) {
      if (filters[key] !== undefined) conditions.push(sql`BINARY ${sql.raw(`l.${key}`)} = BINARY ${filters[key]}`);
    }
    return rows<CompanyStockLotCandidate>(await executor.execute(sql`
      SELECT l.id AS lotId, l.inboundOrderId, l.partNumber, l.brand, l.pkg, l.dc, l.lotNumber, l.location,
       (l.remainingQty-l.reservedQty) AS availableQty, l.version FROM company_stock_lots l INNER JOIN inbound_orders io ON io.id = l.inboundOrderId
       WHERE ${sql.join(conditions, sql` AND `)}
       AND NOT EXISTS (SELECT 1 FROM inbound_ledger_effects e WHERE e.inboundOrderId = io.id AND e.reversedAt IS NOT NULL)
       ORDER BY l.id LIMIT ${filters.limit}
    `));
  }
  function availableLotConditions(scope: CompanyStockScope) {
    // Manual reconciliation is valid evidence; do NOT require procurement ownership.
    return [sql`l.enterpriseId = ${scope.enterpriseId}`, sql`l.ownerUserId = ${scope.ownerUserId}`,
      sql`l.verified = TRUE`, sql`l.frozen = FALSE`, sql`l.reversedAt IS NULL`,
      sql`l.remainingQty > l.reservedQty`, sql`l.reservedQty >= 0`, sql`l.remainingQty <= l.receivedQty`,
      sql`io.status = 'received'`, sql`io.userId = ${scope.ownerUserId}`,
      sql`NOT EXISTS (SELECT 1 FROM inbound_ledger_effects e WHERE e.inboundOrderId = io.id AND e.reversedAt IS NOT NULL)`];
  }
  async function listAvailableLotsPage(scope: CompanyStockScope, rawInput: CompanyStockLotsPageInput = {}): Promise<CompanyStockLotsPage> {
    const input = companyStockLotsPageSchema.parse(rawInput);
    return (await db()).transaction(async tx => {
      await access(tx, scope, "sales.business_orders", false);
      const conditions = availableLotConditions(scope);
      // Explicit '=' escape avoids sql_mode/backslash differences. Keep #, punctuation and spaces.
      const literal = input.keyword.replace(/[=%_]/g, character => `=${character}`);
      if (input.keyword) conditions.push(sql`l.partNumber LIKE ${`%${literal}%`} ESCAPE '='`);
      const where = sql.join(conditions, sql` AND `);
      const total = Number(rows<{ total: number | string }>(await tx.execute(sql`SELECT COUNT(*) AS total
        FROM company_stock_lots l INNER JOIN inbound_orders io ON io.id = l.inboundOrderId WHERE ${where}`))[0]?.total ?? 0);
      const items = rows<CompanyStockLotCandidate>(await tx.execute(sql`SELECT l.id AS lotId, l.inboundOrderId,
        l.partNumber, l.brand, l.pkg, l.dc, l.lotNumber, l.location, (l.remainingQty-l.reservedQty) AS availableQty, l.version
        FROM company_stock_lots l INNER JOIN inbound_orders io ON io.id = l.inboundOrderId WHERE ${where}
        ORDER BY ${input.keyword ? sql`(l.partNumber LIKE ${`${literal}%`} ESCAPE '=') DESC,` : sql``} l.id
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`));
      return { items, total, page: input.page, pageSize: input.pageSize, bounded: false };
    });
  }
  async function getAvailableLotsByIdsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, lotIds: number[]): Promise<CompanyStockLotCandidate[]> {
    await access(tx, scope, "sales.business_orders", false);
    if (!Array.isArray(lotIds) || lotIds.length > 200) bad("所选批次数量超限");
    const ids = Array.from(new Set(lotIds.map(id))).sort((a, b) => a - b);
    if (!ids.length) return [];
    const conditions = availableLotConditions(scope);
    conditions.push(sql`l.id IN (${sql.join(ids.map(value => sql`${value}`), sql`, `)})`);
    return rows<CompanyStockLotCandidate>(await tx.execute(sql`SELECT l.id AS lotId, l.inboundOrderId,
      l.partNumber, l.brand, l.pkg, l.dc, l.lotNumber, l.location, (l.remainingQty-l.reservedQty) AS availableQty, l.version
      FROM company_stock_lots l INNER JOIN inbound_orders io ON io.id = l.inboundOrderId
      WHERE ${sql.join(conditions, sql` AND `)} ORDER BY l.id`));
  }
  async function getLotCostSnapshotsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, lotIds: number[]) {
    await access(tx, scope, "sales.business_orders");
    if (lotIds.length > 200) bad("批次数量过多");
    return (await readLots(tx, scope, lotIds)).map(costSnapshot);
  }
  async function reserveLotsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: CompanyStockReserveInput) {
    await access(tx, scope, "sales.business_orders");
    const items = allocations(input.items), stored = await orderItems(tx, scope, input.orderId, items);
    const lots = await lockedAllocationLots(tx, scope, items); validateItems(items, stored, lots, true);
    const prior = await reservations(tx, scope, input.orderId);
    if (prior.length) {
      if (prior.length !== items.length || items.some(x => !prior.some(r => Number(r.orderItemId) === x.orderItemId && Number(r.lotId) === x.lotId && Number(r.qty) === x.qty && Number(r.releasedQty) === 0))) conflict("订单预留内容已变化或已释放，不能重复确认");
      return lots.map(costSnapshot);
    }
    const totals = sumBy(items, x => x.lotId, x => x.qty);
    for (const lot of lots) {
      const qty = totals.get(Number(lot.id))!;
      changed(await tx.execute(sql`
        UPDATE company_stock_lots SET reservedQty = reservedQty + ${qty}, version = version + 1
         WHERE id = ${lot.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId}
          AND version = ${lot.version} AND verified = TRUE AND frozen = FALSE AND reversedAt IS NULL AND remainingQty - reservedQty >= ${qty}
      `), "同批次多行合计可售数量不足或库存已变化");
    }
    for (const item of items) await tx.execute(sql`
      INSERT INTO company_stock_reservations (enterpriseId, ownerUserId, orderId, orderItemId, lotId, qty, consumedQty, releasedQty, version, createdByUserId, createdAt)
      VALUES (${scope.enterpriseId}, ${scope.ownerUserId}, ${input.orderId}, ${item.orderItemId}, ${item.lotId}, ${item.qty}, 0, 0, 1, ${scope.actorUserId}, ${NOW})
    `);
    return lots.map(costSnapshot);
  }
  async function generateSlipNo(tx: CompanyStockExecutor) {
    const businessDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    await tx.execute(sql`INSERT INTO business_slip_sequences (scope, businessDate, currentValue) VALUES ('CK', ${businessDate}, 1) ON DUPLICATE KEY UPDATE currentValue = currentValue + 1`);
    const row = rows<{ currentValue: number }>(await tx.execute(sql`SELECT currentValue FROM business_slip_sequences WHERE scope = 'CK' AND businessDate = ${businessDate} LIMIT 1 FOR UPDATE`))[0];
    const value = Number(row?.currentValue); if (!value || value > 9999) conflict("今日出库单流水号已达上限");
    return `CK${businessDate.replace(/-/g, "")}${String(value).padStart(4, "0")}`;
  }
  async function consumeReservedLotsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: CompanyStockConsumeInput): Promise<CompanyStockConsumeResult> {
    await access(tx, scope, "sales.business_orders"); id(input.shipmentId);
    const items = allocations(input.items), stored = await orderItems(tx, scope, input.orderId, items);
    const shipment = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM crm_sales_order_shipments WHERE id = ${input.shipmentId} AND enterpriseId = ${scope.enterpriseId} AND orderId = ${input.orderId} LIMIT 1 FOR UPDATE`))[0];
    if (!shipment) forbidden("出库发运不属于当前订单");
    const payloadHash = hash({ orderId: input.orderId, shipmentId: input.shipmentId, items: items.map(({ orderItemId, lotId, qty }) => ({ orderItemId, lotId, qty })), outboundDate: input.outboundDate ?? null, note: input.note ?? "" });
    const key = rows<{ payloadHash: string; completed: number; ownerUserId: number; orderId: number }>(await tx.execute(sql`SELECT payloadHash, completed, ownerUserId, orderId FROM company_stock_shipment_keys WHERE enterpriseId = ${scope.enterpriseId} AND shipmentId = ${input.shipmentId} LIMIT 1 FOR UPDATE`))[0];
    if (key) {
      if (key.payloadHash !== payloadHash || Number(key.ownerUserId) !== scope.ownerUserId || Number(key.orderId) !== input.orderId || !key.completed) conflict("相同发运的批次内容不一致或尚未完整完成");
      const replay = rows<CompanyStockConsumption>(await tx.execute(sql`
        SELECT c.orderItemId, c.lotId, l.partNumber, c.qty, c.outboundOrderId, o.slipNo,
          c.unitCostTaxIncluded, c.unitCostTaxExcluded, c.unitCostBasis, c.taxRate
         FROM company_stock_consumptions c INNER JOIN company_stock_lots l ON l.id = c.lotId INNER JOIN outbound_orders o ON o.id = c.outboundOrderId
         WHERE c.enterpriseId = ${scope.enterpriseId} AND c.ownerUserId = ${scope.ownerUserId} AND c.orderId = ${input.orderId} AND c.shipmentId = ${input.shipmentId} ORDER BY c.lotId, c.orderItemId
      `));
      if (replay.length !== items.length) conflict("公司出库关联记录不完整，需核对");
      return { items: replay, replayed: true };
    }
    const lots = await lockedAllocationLots(tx, scope, items); validateItems(items, stored, lots);
    const reserved = await reservations(tx, scope, input.orderId);
    for (const item of items) {
      const r = reserved.find(x => Number(x.orderItemId) === item.orderItemId && Number(x.lotId) === item.lotId);
      if (!r || Number(r.qty) - Number(r.consumedQty) - Number(r.releasedQty) < item.qty) conflict("本单该批次有效预留不足，不可借用其他订单库存");
    }
    await tx.execute(sql`INSERT INTO company_stock_shipment_keys (enterpriseId, ownerUserId, shipmentId, orderId, payloadHash, completed, createdAt) VALUES (${scope.enterpriseId}, ${scope.ownerUserId}, ${input.shipmentId}, ${input.orderId}, ${payloadHash}, FALSE, ${NOW})`);
    const totals = sumBy(items, x => x.lotId, x => x.qty);
    for (const lot of lots) {
      const qty = totals.get(Number(lot.id))!;
      changed(await tx.execute(sql`UPDATE company_stock_lots SET remainingQty = remainingQty - ${qty}, reservedQty = reservedQty - ${qty}, version = version + 1 WHERE id = ${lot.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${lot.version} AND verified = TRUE AND frozen = FALSE AND reversedAt IS NULL AND remainingQty >= ${qty} AND reservedQty >= ${qty}`));
    }
    const parts = sumBy(items, x => lots.find(l => Number(l.id) === x.lotId)!.partNumber, x => x.qty);
    for (const [part, qty] of Array.from(parts).sort(([a], [b]) => binaryPartOrder(String(a), String(b)))) changed(await tx.execute(sql`UPDATE stock_ledger SET currentQty = currentQty - ${qty}, totalQtyOut = totalQtyOut + ${qty}, movementVersion = movementVersion + 1 WHERE userId = ${scope.ownerUserId} AND BINARY partNumber = BINARY ${part} AND currentQty >= ${qty}`));
    const result: CompanyStockConsumption[] = [];
    const outboundDate = input.outboundDate ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(outboundDate)) bad("出库日期无效");
    for (const item of items) {
      const lot = lots.find(x => Number(x.id) === item.lotId)!, r = reserved.find(x => Number(x.orderItemId) === item.orderItemId && Number(x.lotId) === item.lotId)!;
      changed(await tx.execute(sql`UPDATE company_stock_reservations SET consumedQty = consumedQty + ${item.qty}, version = version + 1 WHERE id = ${r.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${r.version} AND qty - consumedQty - releasedQty >= ${item.qty}`));
      const slipNo = await generateSlipNo(tx), cost = costSnapshot(lot);
      const inserted = await tx.execute(sql`INSERT INTO outbound_orders (slipNo, userId, partNumber, brand, qty, unitCost, unitCostBasis, prodYear, outboundDate, note) VALUES (${slipNo}, ${scope.ownerUserId}, ${lot.partNumber}, ${lot.brand || null}, ${item.qty}, ${cost.unitCostTaxIncluded}, ${cost.unitCostTaxIncluded == null ? null : "CNY_TAX_INCLUDED"}, ${lot.dc || null}, ${outboundDate}, ${input.note ?? "公司库存销售出库"})`);
      const outboundOrderId = Number(header(inserted).insertId); if (!outboundOrderId) throw new Error("公司销售出库单写入失败");
      await insertConsumption(tx, scope, lot, item.qty, outboundOrderId, { orderId: input.orderId, shipmentId: input.shipmentId, orderItemId: item.orderItemId });
      result.push({ ...cost, orderItemId: item.orderItemId, qty: item.qty, outboundOrderId, slipNo });
    }
    changed(await tx.execute(sql`UPDATE company_stock_shipment_keys SET completed = TRUE WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND shipmentId = ${input.shipmentId} AND payloadHash = ${payloadHash} AND completed = FALSE`));
    return { items: result, replayed: false };
  }
  async function insertConsumption(tx: CompanyStockExecutor, scope: CompanyStockScope, lot: Lot, qty: number, outboundOrderId: number, sales?: { orderId: number; shipmentId: number; orderItemId: number }) {
    const cost = costSnapshot(lot);
    await tx.execute(sql`INSERT INTO company_stock_consumptions (enterpriseId, ownerUserId, orderId, shipmentId, orderItemId, lotId, outboundOrderId, qty, unitCostTaxIncluded, unitCostTaxExcluded, unitCostBasis, taxRate, actorUserId, createdAt) VALUES (${scope.enterpriseId}, ${scope.ownerUserId}, ${sales?.orderId ?? null}, ${sales?.shipmentId ?? null}, ${sales?.orderItemId ?? null}, ${lot.id}, ${outboundOrderId}, ${qty}, ${cost.unitCostTaxIncluded}, ${cost.unitCostTaxExcluded}, ${cost.unitCostBasis}, ${cost.taxRate}, ${scope.actorUserId}, ${NOW})`);
  }
  async function releaseOrderReservationsInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: { orderId: number }) {
    await access(tx, scope, "sales.business_orders"); await orderItems(tx, scope, input.orderId, [], false);
    // Cancellation may only release untouched reservations. Recheck the authoritative
    // consumption ledger too: missing CRM shipment projection must not legalize cancellation.
    const consumed = rows<{ qty: number | string }>(await tx.execute(sql`SELECT
      COALESCE((SELECT SUM(consumedQty) FROM company_stock_reservations WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.orderId}), 0)
      + COALESCE((SELECT SUM(qty) FROM company_stock_consumptions WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.orderId}), 0) AS qty`))[0];
    if (Number(consumed?.qty ?? 0) > 0) conflict("公司批次已有出库消耗，不可直接取消释放，须人工核对");
    const preview = await reservations(tx, scope, input.orderId, false);
    if (!preview.length) return { releasedQty: 0 };
    const lotsPreview = await readLots(tx, scope, preview.map(x => Number(x.lotId)));
    await lockLedgers(tx, scope, lotsPreview.map(x => x.partNumber));
    const lots = await readLots(tx, scope, preview.map(x => Number(x.lotId)), true), locked = await reservations(tx, scope, input.orderId);
    const totals = sumBy(locked, x => Number(x.lotId), x => Number(x.qty) - Number(x.consumedQty) - Number(x.releasedQty));
    let releasedQty = 0;
    for (const lot of lots) {
      const qty = totals.get(Number(lot.id)) ?? 0; if (!qty) continue;
      changed(await tx.execute(sql`UPDATE company_stock_lots SET reservedQty = reservedQty - ${qty}, version = version + 1 WHERE id = ${lot.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${lot.version} AND reservedQty >= ${qty}`)); releasedQty += qty;
    }
    for (const r of locked) {
      const qty = Number(r.qty) - Number(r.consumedQty) - Number(r.releasedQty); if (!qty) continue;
      changed(await tx.execute(sql`UPDATE company_stock_reservations SET releasedQty = releasedQty + ${qty}, version = version + 1 WHERE id = ${r.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${r.version} AND qty - consumedQty - releasedQty = ${qty}`));
    }
    return { releasedQty };
  }
  async function guardInboundLotInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: { inboundOrderId: number }) {
    await access(tx, scope, "inventory.inbound"); id(input.inboundOrderId);
    const source = rows<{ partNumber: string }>(await tx.execute(sql`SELECT partNumber FROM inbound_orders WHERE id = ${input.inboundOrderId} AND userId = ${scope.ownerUserId} LIMIT 1 FOR UPDATE`))[0];
    if (!source) forbidden("入库不属于当前公司");
    await lockLedgers(tx, scope, [source.partNumber]);
    const lot = rows<Lot>(await tx.execute(sql`SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND inboundOrderId = ${input.inboundOrderId} LIMIT 1 FOR UPDATE`))[0];
    if (!lot) {
      const tracked = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_lots WHERE ownerUserId = ${scope.ownerUserId} AND partNumber = ${source.partNumber} LIMIT 1`))[0];
      if (tracked) conflict("该型号已启用批次管理，历史入库消耗归属不明，禁止自动作废");
      return null;
    }
    if (lot.reversedAt) conflict("公司入库批次已冲销");
    if (Number(lot.reservedQty) > 0 || Number(lot.remainingQty) !== Number(lot.receivedQty)) conflict("入库批次已有销售预留或消耗，不能作废");
    return lot;
  }
  async function reverseInboundLotInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: { inboundOrderId: number }) {
    const lot = await guardInboundLotInTx(tx, scope, input); if (!lot) return { tracked: false };
    changed(await tx.execute(sql`UPDATE company_stock_lots SET frozen = TRUE, verified = FALSE, remainingQty = 0, reversedAt = ${NOW}, version = version + 1 WHERE id = ${lot.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${lot.version} AND reservedQty = 0 AND remainingQty = receivedQty AND reversedAt IS NULL`));
    return { tracked: true };
  }
  async function assertLegacyOutboundEditableInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, outboundOrderId: number, parts: string[]) {
    await access(tx, scope, "sales_orders.manage");
    await lockLedgers(tx, scope, parts);
    const linked = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_consumptions WHERE outboundOrderId = ${outboundOrderId} LIMIT 1`))[0];
    if (linked) conflict("公司库存/销售关联出库不能通过旧接口编辑或删除");
    for (const part of Array.from(new Set(parts)).sort(binaryPartOrder)) {
      const tracked = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_lots WHERE ownerUserId = ${scope.ownerUserId} AND partNumber = ${part} LIMIT 1`))[0];
      if (tracked) conflict("该型号已启用真实批次，历史出库不可安全回补，请人工核对");
    }
  }
  /** Called after legacy route ledger lock, before its INSERT. Deducts LOTS only; route deducts ledger exactly once. */
  async function planLegacyOutboundInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, input: CompanyStockItemIdentity & { qty: number }) {
    await access(tx, scope, "sales_orders.manage"); quantity(input.qty);
    await lockLedgers(tx, scope, [input.partNumber]);
    const tracked = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_lots WHERE ownerUserId = ${scope.ownerUserId} AND partNumber = ${input.partNumber} LIMIT 1`))[0];
    if (!tracked) return null;
    const lots = rows<Lot>(await tx.execute(sql`SELECT * FROM company_stock_lots WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND BINARY partNumber = BINARY ${input.partNumber} AND BINARY brand = BINARY ${input.brand} AND BINARY pkg = BINARY ${input.pkg} AND BINARY dc = BINARY ${input.dc} AND verified = TRUE AND frozen = FALSE AND reversedAt IS NULL AND remainingQty > reservedQty ORDER BY id FOR UPDATE`));
    await assertReceived(tx, scope, lots);
    let needed = input.qty; const selected: Array<{ lot: Lot; qty: number }> = [];
    for (const lot of lots) { const qty = Math.min(needed, Number(lot.remainingQty) - Number(lot.reservedQty)); if (qty) selected.push({ lot, qty }); needed -= qty; if (!needed) break; }
    if (needed) conflict("真实已核批次精确匹配可售库存不足，不能使用历史汇总量或其他订单预留");
    for (const { lot, qty } of selected) changed(await tx.execute(sql`UPDATE company_stock_lots SET remainingQty = remainingQty - ${qty}, version = version + 1 WHERE id = ${lot.id} AND enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND version = ${lot.version} AND verified = TRUE AND frozen = FALSE AND reversedAt IS NULL AND remainingQty - reservedQty >= ${qty}`));
    // Legacy has one unitCost field: use exact integer decimal weighting only when all selected real costs are known.
    let total = BigInt(0), known = true;
    for (const { lot, qty } of selected) { const cost = costSnapshot(lot).unitCostTaxIncluded; if (cost == null) { known = false; break; } total += BigInt(cost.replace(".", "")) * BigInt(qty); }
    const average = known ? (total + BigInt(input.qty) / BigInt(2)) / BigInt(input.qty) : null;
    const unitCost = average == null ? null : `${average / BigInt(1000000)}.${String(average % BigInt(1000000)).padStart(6, "0")}`;
    return { selected, unitCost, unitCostBasis: unitCost == null ? null : "CNY_TAX_INCLUDED" };
  }
  async function bindLegacyOutboundInTx(tx: CompanyStockExecutor, scope: CompanyStockScope, outboundOrderId: number, plan: NonNullable<Awaited<ReturnType<typeof planLegacyOutboundInTx>>>) {
    id(outboundOrderId);
    for (const { lot, qty } of plan.selected) await insertConsumption(tx, scope, lot, qty, outboundOrderId);
  }
  return { lockCompanyStockScopeInTx, recordInboundLotInTx, listAvailableLots, listAvailableLotsPage, getAvailableLotsByIdsInTx, getLotCostSnapshotsInTx, reserveLotsInTx, consumeReservedLotsInTx,
    releaseOrderReservationsInTx, guardInboundLotInTx, reverseInboundLotInTx, assertLegacyOutboundEditableInTx,
    planLegacyOutboundInTx, bindLegacyOutboundInTx, assertOutboundAccessInTx, guardInboundDetailsInTx, reconcileInboundLotInTx };
}
export const companyStockService = createCompanyStockService({ getDb });
export const { lockCompanyStockScopeInTx, recordInboundLotInTx, listAvailableLots, listAvailableLotsPage, getAvailableLotsByIdsInTx, getLotCostSnapshotsInTx, reserveLotsInTx, consumeReservedLotsInTx,
  releaseOrderReservationsInTx, guardInboundLotInTx, reverseInboundLotInTx, reconcileInboundLotInTx } = companyStockService;
