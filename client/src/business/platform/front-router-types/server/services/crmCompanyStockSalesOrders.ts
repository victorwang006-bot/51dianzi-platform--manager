import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  calculateSalesOrderAmounts, canonicalCompanyStockCreatePayload, decimalToScaled, scaledToDecimal,
  salesOrderCompanyStockCreateSchema, salesOrderCompanyStockPreviewSchema,
  salesOrderCompanyStockCandidatesSchema, salesOrderCompanyStockAllocateSchema,
  salesOrderCompanyStockShipSchema, salesOrderExpensesSchema,
  type SalesOrderCompanyStockCreateInput, type SalesOrderCompanyStockPreviewInput,
  type SalesOrderCompanyStockCandidatesInput, type SalesOrderCompanyStockAllocateInput,
  type SalesOrderCompanyStockShipInput, type SalesOrderExpensesInput, type SalesOrderItem,
  type CompanyStockSalesAllocation, type CompanyStockSalesProfitResult, type SalesTaxMode, type SalesExpenseEvent,
} from "../../../shared/crmSalesOrders";
import type {
  CompanyStockScope, CompanyStockLotsFilter, CompanyStockLotCandidate, CompanyStockReserveInput,
  CompanyStockConsumeInput, CompanyStockConsumeResult, CompanyStockLotCostSnapshot,
} from "../../../shared/companyStock";
import { calculateSalesProfit, SALES_COMMISSION_POLICY, SALES_COMMISSION_THRESHOLDS, SALES_COMMISSION_RATES } from "../../../shared/salesProfit";

/** No db/service/router import: safe to instantiate in incremental native bridges and pure fake tests. */
export type CrmCompanySqlExecutor = { execute(query: SQL): Promise<unknown> };
export type CrmCompanyDatabase = CrmCompanySqlExecutor & { transaction<T>(fn: (tx: CrmCompanySqlExecutor) => Promise<T>): Promise<T> };
export type CrmCompanyScope = { enterpriseId: number; actorUserId: number; staffDelegation?: any };
export type CrmCompanyOrder = {
  id: number; customerId: number; demandId: number | null; sourceType?: "demand" | "company_stock";
  totalAmount: string | number; salesTaxMode?: SalesTaxMode | null; salesExpenses?: string | number;
  status: "confirmed" | "cancelled"; version: number; companyStockAllocated?: number | boolean;
  profitPolicyVersion?: string | null;
};
export type CrmCompanyStockApi = {
  lockCompanyStockScopeInTx(tx: CrmCompanySqlExecutor, scope: CompanyStockScope): Promise<void>;
  listAvailableLots(scope: CompanyStockScope, filter?: CompanyStockLotsFilter): Promise<CompanyStockLotCandidate[]>;
  reserveLotsInTx(tx: CrmCompanySqlExecutor, scope: CompanyStockScope, input: CompanyStockReserveInput): Promise<CompanyStockLotCostSnapshot[]>;
  consumeReservedLotsInTx(tx: CrmCompanySqlExecutor, scope: CompanyStockScope, input: CompanyStockConsumeInput): Promise<CompanyStockConsumeResult>;
  releaseOrderReservationsInTx(tx: CrmCompanySqlExecutor, scope: CompanyStockScope, input: { orderId: number }): Promise<{ releasedQty: number }>;
  getLotCostSnapshotsInTx(tx: CrmCompanySqlExecutor, scope: CompanyStockScope, lotIds: number[]): Promise<CompanyStockLotCostSnapshot[]>;
};
export type CrmCompanyProfitInput = {
  salesAmount: string; salesTaxMode: SalesTaxMode | null; expenseAmount: string; paidAmount: string;
  monthlyAmount: string; costsComplete: boolean;
  cancelled?: boolean;
  costs: Array<CompanyStockLotCostSnapshot & { qty: number }>;
};
export type CrmCompanyDeps = {
  getDb(): Promise<CrmCompanyDatabase | null>;
  stock: CrmCompanyStockApi;
  requireAccess(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, lock?: boolean): Promise<{ canManageAll: boolean }>;
  accessibleCustomer(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, canManageAll: boolean, customerId: number, lock?: boolean): Promise<{ id: number; name: string; archivedAt: unknown }>;
  /** Locks authoritative customer before order; missing version means authorize replay before its CAS check. */
  lockOrder(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, id: number, version?: number): Promise<{ customer: { id: number }; order: CrmCompanyOrder }>;
  reserveRequest(tx: CrmCompanySqlExecutor, input: { enterpriseId: number; actorUserId: number; requestId: string; payloadHash: string; action: "create_company_stock" | "allocate_company_stock" | "shipment_company_stock" | "expenses" }): Promise<{ replayed: boolean; orderId: number }>;
  insertAudit(tx: CrmCompanySqlExecutor, input: { enterpriseId: number; customerId: number; orderId: number; actorUserId: number; action: "created" | "stock_allocated" | "shipment" | "expenses"; note: string; requestId?: string | null; policyVersion?: string | null; financialSnapshot?: unknown }): Promise<unknown>;
  recordCreationOrigin(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, input: { orderId: number; requestId: string }): Promise<unknown>;
  calculateProfit?: (input: CrmCompanyProfitInput) => CompanyStockSalesProfitResult;
};
const NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;
function rows<T>(result: unknown): T[] { return ((result as [T[], unknown])?.[0] ?? []) as T[]; }
function header(result: unknown): { insertId?: number; affectedRows?: number } { return (result as [{ insertId?: number; affectedRows?: number }, unknown])?.[0] ?? {}; }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const checked = schema.safeParse(input);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "订单参数无效" });
  return checked.data;
}
function assertVersion(order: CrmCompanyOrder, version: number) {
  if (Number(order.version) !== version) throw new TRPCError({ code: "CONFLICT", message: "订单已更新，请刷新重试" });
}
function assertLive(customer: { archivedAt: unknown }) {
  if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可录入销售订单" });
}
/** This marker only rejects a source transition; it never grants or caches access. */
export function assertOrderStockPrelocked(order: Pick<CrmCompanyOrder, "sourceType" | "companyStockAllocated">, prelocked: CompanyStockScope | null) {
  if ((order.sourceType === "company_stock" || Boolean(order.companyStockAllocated)) && !prelocked) {
    throw new TRPCError({ code: "CONFLICT", message: "订单公司库存来源已变化，请刷新重试" });
  }
}
/** Missing legacy evidence is unknown; a company-created order must carry its explicit tax basis. */
export function orderSalesTaxMode(order: Pick<CrmCompanyOrder, "sourceType" | "salesTaxMode">): SalesTaxMode | null {
  if (order.salesTaxMode === "tax_included" || order.salesTaxMode === "tax_excluded") return order.salesTaxMode;
  if (order.salesTaxMode == null && order.sourceType !== "company_stock") return null;
  throw new TRPCError({ code: "CONFLICT", message: "订单销售税务口径未确认，须核对原始证据" });
}
export function calculateCrmCompanyProfit(input: CrmCompanyProfitInput): CompanyStockSalesProfitResult {
  if (input.salesTaxMode == null) {
    // Do not call the strict pure-policy helper with null, nor pick either tax basis as a fallback.
    const sales = decimalToScaled(input.salesAmount, 6), paid = decimalToScaled(input.paidAmount, 6);
    return {
      profitBreakdown: { salesAmount: scaledToDecimal(sales, 6), costAmount: null,
        expenseAmount: scaledToDecimal(decimalToScaled(input.expenseAmount, 6), 6), grossProfit: null,
        taxDeductionAmount: null, netProfit: null, salesTaxMode: null, status: "unknown_cost", policyVersion: SALES_COMMISSION_POLICY?.version ?? null },
      commissionPreview: { estimatedAmount: null, earnedAmount: input.cancelled ? "0.00" : null,
        configPending: SALES_COMMISSION_POLICY === null,
        collectionStatus: paid <= BigInt(0) ? "uncollected" : sales > BigInt(0) && paid >= sales ? "collected" : "partial",
        reason: input.cancelled ? "订单已取消，不计提成" : "销售税务口径及匹配采购成本待核，不推定含税或零成本",
        rate: null, bandMode: SALES_COMMISSION_POLICY?.bandMode ?? null,
        thresholds: SALES_COMMISSION_THRESHOLDS, rates: SALES_COMMISSION_RATES, policyVersion: SALES_COMMISSION_POLICY?.version ?? null },
    };
  }
  if (input.salesTaxMode !== "tax_included" && input.salesTaxMode !== "tax_excluded") throw new TRPCError({ code: "CONFLICT", message: "销售税务口径无效" });
  const unitKey = input.salesTaxMode === "tax_excluded" ? "unitCostTaxExcluded" : "unitCostTaxIncluded";
  let cost: bigint | null = input.costsComplete ? BigInt(0) : null;
  for (const line of input.costs) {
    const value = line[unitKey];
    if (value == null) { cost = null; break; }
    if (cost !== null) cost += decimalToScaled(value, 6) * BigInt(line.qty);
  }
  return calculateSalesProfit({ salesAmount: input.salesAmount, costAmount: cost === null ? null : scaledToDecimal(cost, 6),
    expenseAmount: input.expenseAmount, salesTaxMode: input.salesTaxMode, bankCashPaidAmount: input.paidAmount, cancelled: input.cancelled });
}

type ReservationRow = { id: number; orderId: number; orderItemId: number; lotId: number; qty: number; consumedQty: number; releasedQty: number };
export function createCrmCompanyStockSalesOrderService(deps: CrmCompanyDeps) {
  const calculateProfit = deps.calculateProfit ?? calculateCrmCompanyProfit;
  async function db() {
    const database = await deps.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    return database;
  }
  async function stockScope(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope): Promise<CompanyStockScope> {
    const enterprise = rows<{ crmDataOwnerUserId: number | null }>(await tx.execute(sql`
      SELECT crmDataOwnerUserId FROM enterprises WHERE id = ${scope.enterpriseId} LIMIT 1
    `))[0];
    const ownerUserId = Number(enterprise?.crmDataOwnerUserId);
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "企业公司库存归属尚未确认" });
    return { enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, ownerUserId };
  }
  async function prelockStockScope(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope) {
    // Resolve owner as non-locking metadata only; the stock helper locks its indexed
    // owner range FIRST and verifies the current mapping and full authority scope.
    const scoped = await stockScope(tx, scope);
    await deps.stock.lockCompanyStockScopeInTx(tx, scoped);
    return scoped;
  }
  async function prelockOrderStockScope(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, orderId: number) {
    const source = rows<Pick<CrmCompanyOrder, "sourceType" | "companyStockAllocated">>(await tx.execute(sql`
      SELECT sourceType, companyStockAllocated FROM crm_sales_orders
      WHERE enterpriseId = ${scope.enterpriseId} AND id = ${orderId} LIMIT 1
    `))[0];
    // Missing/legacy rows must still pass the original access/lockOrder gate.
    // Never resolve company owner or touch sidecars for an unallocated demand.
    return source && (source.sourceType === "company_stock" || Boolean(source.companyStockAllocated))
      ? prelockStockScope(tx, scope) : null;
  }
  async function finishRequest(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, requestId: string, orderId: number) {
    await tx.execute(sql`UPDATE crm_sales_order_requests SET orderId = ${orderId}
      WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${requestId}`);
  }
  async function bump(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, id: number, version: number, extra = sql``) {
    const result = header(await tx.execute(sql`UPDATE crm_sales_orders SET version = version + 1, updatedAt = ${NOW} ${extra}
      WHERE enterpriseId = ${scope.enterpriseId} AND id = ${id} AND status = 'confirmed' AND version = ${version}`));
    if (Number(result.affectedRows) !== 1) throw new TRPCError({ code: "CONFLICT", message: "订单已更新，请刷新重试" });
  }
  async function orderItems(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, id: number) {
    return rows<SalesOrderItem>(await tx.execute(sql`SELECT i.id, i.sourceDemandItemId, i.partNumber, i.brand, i.pkg, i.dc, i.qtyUnit,
      i.demandQty, i.orderedQty, i.unitPrice, i.lineAmount, i.deliveryRequirement, i.note,
      COALESCE((SELECT SUM(si.qty) FROM crm_sales_order_shipment_items si WHERE si.enterpriseId = i.enterpriseId AND si.orderItemId = i.id), 0) AS shippedQty
      FROM crm_sales_order_items i WHERE i.enterpriseId = ${scope.enterpriseId} AND i.orderId = ${id} ORDER BY i.id FOR UPDATE`));
  }
  async function reservations(tx: CrmCompanySqlExecutor, scope: CompanyStockScope, id: number) {
    // Projection of the authoritative stock service ledger, never a second reservation writer.
    return rows<ReservationRow>(await tx.execute(sql`SELECT id, orderId, orderItemId, lotId, qty, consumedQty, releasedQty
      FROM company_stock_reservations WHERE enterpriseId = ${scope.enterpriseId} AND ownerUserId = ${scope.ownerUserId} AND orderId = ${id}
      ORDER BY orderItemId, lotId`));
  }
  function financialEvidence(order: CrmCompanyOrder, items: ReadonlyArray<{ id: number; orderedQty: number }>,
    allocations: ReservationRow[], snapshots: CompanyStockLotCostSnapshot[], paidAmount: string, monthlyAmount: string) {
    const lotIds = Array.from(new Set(allocations.map(row => Number(row.lotId)))).sort((a, b) => a - b);
    const costsById = new Map(snapshots.map(row => [Number(row.lotId), row]));
    const qtyByItem = new Map<number, number>();
    const costs = allocations.map(row => {
      const qty = Number(row.qty) - Number(row.releasedQty);
      qtyByItem.set(Number(row.orderItemId), (qtyByItem.get(Number(row.orderItemId)) ?? 0) + qty);
      return { ...(costsById.get(Number(row.lotId)) ?? { lotId: Number(row.lotId), partNumber: "", unitCostTaxIncluded: null, unitCostTaxExcluded: null, unitCostBasis: null, taxRate: null }), qty };
    });
    const totalsComplete = items.length > 0 && items.every(item => (qtyByItem.get(Number(item.id)) ?? 0) === Number(item.orderedQty));
    const salesTaxMode = orderSalesTaxMode(order);
    const profitInput = { salesAmount: String(order.totalAmount), salesTaxMode,
      expenseAmount: String(order.salesExpenses ?? "0.0000"), paidAmount, monthlyAmount, costs, costsComplete: totalsComplete, cancelled: order.status === "cancelled" };
    const result = salesTaxMode === null ? calculateCrmCompanyProfit(profitInput) : calculateProfit(profitInput);
    return { ...result, policyVersion: SALES_COMMISSION_POLICY?.version ?? null,
      costSnapshot: { schemaVersion: 1, salesTaxMode, allocationsComplete: totalsComplete,
        costsComplete: totalsComplete && result.profitBreakdown.costAmount !== null,
        allocations: allocations.map(row => ({ orderItemId: Number(row.orderItemId), lotId: Number(row.lotId), qty: Number(row.qty),
          consumedQty: Number(row.consumedQty), releasedQty: Number(row.releasedQty) })).sort((a, b) => a.orderItemId - b.orderItemId || a.lotId - b.lotId),
        lotCosts: snapshots.map(row => ({ ...row })).sort((a, b) => Number(a.lotId) - Number(b.lotId)),
        missingLotIds: lotIds.filter(id => !costsById.has(id)), costAmount: result.profitBreakdown.costAmount } };
  }
  async function readCostEvidence(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, order: CrmCompanyOrder,
    items: ReadonlyArray<{ id: number; orderedQty: number }>, paidAmount: string, monthlyAmount: string) {
    orderSalesTaxMode(order);
    // Unallocated legacy demand orders do not depend on company owner or the stock sidecar.
    if (order.sourceType !== "company_stock" && !order.companyStockAllocated) {
      return { allocations: [] as ReservationRow[], evidence: financialEvidence(order, items, [], [], paidAmount, monthlyAmount) };
    }
    const scoped = await stockScope(tx, scope);
    const allocations = await reservations(tx, scoped, Number(order.id));
    const lotIds = Array.from(new Set(allocations.map(row => Number(row.lotId)))).sort((a, b) => a - b);
    const snapshots = lotIds.length ? await deps.stock.getLotCostSnapshotsInTx(tx, scoped, lotIds) : [];
    return { allocations, evidence: financialEvidence(order, items, allocations, snapshots, paidAmount, monthlyAmount) };
  }
  async function collectionAmounts(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, orderId: number) {
    const totals = rows<{ paidAmount: string; monthlyAmount: string }>(await tx.execute(sql`SELECT
      COALESCE(SUM(CASE WHEN method IN ('bank', 'cash') THEN amount ELSE 0 END), 0) AS paidAmount,
      COALESCE(SUM(CASE WHEN method = 'monthly' THEN amount ELSE 0 END), 0) AS monthlyAmount
      FROM crm_sales_order_payments WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${orderId}`))[0];
    return { paidAmount: scaledToDecimal(decimalToScaled(String(totals?.paidAmount ?? "0"))), monthlyAmount: scaledToDecimal(decimalToScaled(String(totals?.monthlyAmount ?? "0"))) };
  }
  async function readPaymentFinancialSnapshots(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, order: CrmCompanyOrder,
    payment: { method: "bank" | "cash" | "monthly"; amount: string }) {
    const items = await orderItems(tx, scope, Number(order.id));
    const collection = await collectionAmounts(tx, scope, Number(order.id));
    const { allocations, evidence: before } = await readCostEvidence(tx, scope, order, items, collection.paidAmount, collection.monthlyAmount);
    const paidAmount = payment.method === "monthly" ? collection.paidAmount
      : scaledToDecimal(decimalToScaled(collection.paidAmount) + decimalToScaled(payment.amount));
    const monthlyAmount = payment.method !== "monthly" ? collection.monthlyAmount
      : scaledToDecimal(decimalToScaled(collection.monthlyAmount) + decimalToScaled(payment.amount));
    // Same immutable server-obtained costs on both sides; only collection changes.
    const after = financialEvidence(order, items, allocations, before.costSnapshot.lotCosts, paidAmount, monthlyAmount);
    return { before, after };
  }
  async function readFinancials(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, order: CrmCompanyOrder,
    items: ReadonlyArray<{ id: number; orderedQty: number }>, paidAmount: string, monthlyAmount: string) {
    const expenses = rows<SalesExpenseEvent>(await tx.execute(sql`SELECT id, previousAmount, amount, note, actorUserId, requestId, version, createdAt
      FROM crm_sales_order_expenses WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${order.id} ORDER BY id`));
    const { allocations, evidence } = await readCostEvidence(tx, scope, order, items, paidAmount, monthlyAmount);
    const displayAllocations: CompanyStockSalesAllocation[] = allocations.map(row => ({ ...row, id: Number(row.id), orderId: Number(row.orderId), orderItemId: Number(row.orderItemId),
      lotId: Number(row.lotId), qty: Number(row.qty), consumedQty: Number(row.consumedQty), releasedQty: Number(row.releasedQty),
      reservedQty: Number(row.qty) - Number(row.consumedQty) - Number(row.releasedQty), unitCost: null, costTaxMode: "server_only" }));
    return { profitBreakdown: evidence.profitBreakdown, commissionPreview: evidence.commissionPreview, companyStockAllocations: displayAllocations, salesExpenseHistory: expenses.map(row => ({ ...row, id: Number(row.id), actorUserId: Number(row.actorUserId), version: Number(row.version),
      previousAmount: scaledToDecimal(decimalToScaled(String(row.previousAmount))), amount: scaledToDecimal(decimalToScaled(String(row.amount))), createdAt: String(row.createdAt) })) };
  }
  async function companyStockCandidates(scope: CrmCompanyScope, rawInput: SalesOrderCompanyStockCandidatesInput) {
    const input = parse(salesOrderCompanyStockCandidatesSchema, rawInput);
    const database = await db();
    const access = await deps.requireAccess(database, scope, false);
    const customer = await deps.accessibleCustomer(database, scope, access.canManageAll, input.customerId, false);
    assertLive(customer);
    const scoped = await stockScope(database, scope);
    // The stock ABI has a bounded array rather than offset paging: never claim an exhaustive total.
    const candidates = await deps.stock.listAvailableLots(scoped, { partNumber: input.keyword || undefined, limit: 200 });
    return { items: candidates.slice((input.page - 1) * input.pageSize, input.page * input.pageSize), total: candidates.length,
      page: input.page, pageSize: input.pageSize, bounded: candidates.length === 200 };
  }
  async function previewCompanyStock(scope: CrmCompanyScope, rawInput: SalesOrderCompanyStockPreviewInput) {
    const input = parse(salesOrderCompanyStockPreviewSchema, rawInput);
    const amounts = calculateSalesOrderAmounts(input.items);
    const database = await db();
    return database.transaction(async tx => {
      const scoped = await prelockStockScope(tx, scope);
      const access = await deps.requireAccess(tx, scope, false);
      assertLive(await deps.accessibleCustomer(tx, scope, access.canManageAll, input.customerId, false));
      const requested = new Map<number, number>();
      const costs: CrmCompanyProfitInput["costs"] = [];
      for (const item of input.items) {
        const candidates = await deps.stock.listAvailableLots(scoped, { partNumber: item.partNumber, brand: item.brand, pkg: item.pkg, dc: item.dc, limit: 200 });
        for (const allocation of item.allocations) {
          const lot = candidates.find(row => Number(row.lotId) === allocation.lotId);
          if (!lot || !sameIdentity(lot, item)) throw new TRPCError({ code: "CONFLICT", message: "批次归属或型号/品牌/封装/DC已变化，请刷新" });
          const qty = (requested.get(allocation.lotId) ?? 0) + allocation.qty;
          if (qty > Number(lot.availableQty)) throw new TRPCError({ code: "CONFLICT", message: "批次可售数量不足，请刷新" });
          requested.set(allocation.lotId, qty);
        }
      }
      const snapshots = await deps.stock.getLotCostSnapshotsInTx(tx, scoped, Array.from(requested.keys()).sort((a, b) => a - b));
      const byId = new Map(snapshots.map(row => [Number(row.lotId), row]));
      for (const [lotId, qty] of Array.from(requested.entries())) costs.push({ ...(byId.get(lotId) ?? { lotId, partNumber: "", unitCostTaxIncluded: null, unitCostTaxExcluded: null, unitCostBasis: null, taxRate: null }), qty });
      return { totalAmount: amounts.totalAmount, currencyLabel: currencyLabel(input.salesTaxMode),
        ...calculateProfit({ salesAmount: amounts.totalAmount, salesTaxMode: input.salesTaxMode, expenseAmount: "0.0000", paidAmount: "0.0000", monthlyAmount: "0.0000", costsComplete: true, costs }) };
    });
  }
  async function createCompanyStock(scope: CrmCompanyScope, rawInput: SalesOrderCompanyStockCreateInput) {
    const input = parse(salesOrderCompanyStockCreateSchema, rawInput);
    const amounts = calculateSalesOrderAmounts(input.items);
    const payloadHash = hash(canonicalCompanyStockCreatePayload(input));
    return (await db()).transaction(async tx => {
      const scoped = await prelockStockScope(tx, scope);
      const access = await deps.requireAccess(tx, scope, true);
      const customer = await deps.accessibleCustomer(tx, scope, access.canManageAll, input.customerId, true);
      assertLive(customer);
      const request = await deps.reserveRequest(tx, { ...scope, requestId: input.requestId, payloadHash, action: "create_company_stock" });
      if (request.replayed) {
        const row = rows<{ orderNumber: string; customerId: number; salesTaxMode: SalesTaxMode | null }>(await tx.execute(sql`SELECT orderNumber, customerId, salesTaxMode FROM crm_sales_orders WHERE enterpriseId = ${scope.enterpriseId} AND id = ${request.orderId} LIMIT 1 FOR UPDATE`))[0];
        if (!row || Number(row.customerId) !== input.customerId) throw new TRPCError({ code: "CONFLICT", message: "订单请求记录不完整" });
        orderSalesTaxMode({ sourceType: "company_stock", salesTaxMode: row.salesTaxMode });
        return { id: request.orderId, orderNumber: row.orderNumber, replayed: true };
      }
      const inserted = header(await tx.execute(sql`INSERT INTO crm_sales_orders
        (enterpriseId, customerId, customerName, sourceType, demandId, demandNo, projectName, orderNumber, status, currency,
         totalAmount, salesTaxMode, salesExpenses, companyStockAllocated, profitPolicyVersion, dueDate, confirmationNote, createdByUserId, version, createdAt, updatedAt)
        VALUES (${scope.enterpriseId}, ${customer.id}, ${customer.name}, 'company_stock', NULL, NULL, '', ${`P-${randomUUID()}`}, 'confirmed', 'CNY',
          ${amounts.totalAmount}, ${input.salesTaxMode}, '0.0000', 1, ${SALES_COMMISSION_POLICY?.version ?? null}, ${input.dueDate}, ${input.confirmationNote}, ${scope.actorUserId}, 1, ${NOW}, ${NOW})`));
      const orderId = Number(inserted.insertId);
      if (!orderId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "订单创建失败" });
      const day = rows<{ day: string }>(await tx.execute(sql`SELECT DATE_FORMAT(${NOW}, '%Y%m%d') AS day`))[0]?.day;
      if (!/^\d{8}$/.test(day ?? "")) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "订单日期生成失败" });
      const orderNumber = `XS${day}-${orderId}`;
      await tx.execute(sql`UPDATE crm_sales_orders SET orderNumber = ${orderNumber} WHERE enterpriseId = ${scope.enterpriseId} AND id = ${orderId}`);
      const allocations: CompanyStockReserveInput["items"] = [];
      for (let index = 0; index < input.items.length; index++) {
        const item = input.items[index];
        const amount = amounts.lines[index];
        const insertedItem = header(await tx.execute(sql`INSERT INTO crm_sales_order_items
          (enterpriseId, orderId, sourceDemandItemId, sortOrder, partNumber, brand, pkg, dc, qtyUnit, demandQty, orderedQty, unitPrice, lineAmount, deliveryRequirement, note, createdAt)
          VALUES (${scope.enterpriseId}, ${orderId}, NULL, ${index + 1}, ${item.partNumber}, ${item.brand}, ${item.pkg}, ${item.dc}, ${item.qtyUnit}, NULL,
            ${item.qty}, ${amount.unitPrice}, ${amount.lineAmount}, ${item.deliveryRequirement}, ${item.note}, ${NOW})`));
        const orderItemId = Number(insertedItem.insertId);
        if (!orderItemId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "订单行创建失败" });
        allocations.push(...item.allocations.map(allocation => ({ ...allocation, orderItemId, expected: identity(item) })));
      }
      const snapshots = await deps.stock.reserveLotsInTx(tx, scoped, { orderId, items: allocations });
      const storedItems = await orderItems(tx, scope, orderId);
      const evidence = financialEvidence({ id: orderId, customerId: Number(customer.id), demandId: null, sourceType: "company_stock",
        totalAmount: amounts.totalAmount, salesTaxMode: input.salesTaxMode, salesExpenses: "0.0000", status: "confirmed", version: 1 }, storedItems,
        allocations.map((row, index) => ({ ...row, id: index + 1, orderId, consumedQty: 0, releasedQty: 0 })), snapshots, "0.0000", "0.0000");
      await finishRequest(tx, scope, input.requestId, orderId);
      await deps.insertAudit(tx, { ...scope, customerId: Number(customer.id), orderId, action: "created", note: `公司库存；客户确认：${input.confirmationNote}`, requestId: input.requestId,
        policyVersion: evidence.policyVersion, financialSnapshot: evidence });
      await deps.recordCreationOrigin(tx, scope, { orderId, requestId: input.requestId });
      return { id: orderId, orderNumber, replayed: false };
    });
  }
  async function allocateCompanyStock(scope: CrmCompanyScope, rawInput: SalesOrderCompanyStockAllocateInput) {
    const input = parse(salesOrderCompanyStockAllocateSchema, rawInput);
    const payloadHash = hash({ id: input.id, items: input.items.map(item => ({ ...item, allocations: [...item.allocations].sort((a, b) => a.lotId - b.lotId) })).sort((a, b) => a.orderItemId - b.orderItemId) });
    return (await db()).transaction(async tx => {
      const scoped = await prelockStockScope(tx, scope);
      const { customer, order } = await deps.lockOrder(tx, scope, input.id);
      const request = await deps.reserveRequest(tx, { ...scope, requestId: input.requestId, payloadHash, action: "allocate_company_stock" });
      if (request.replayed) return { id: request.orderId, version: Number(order.version), replayed: true };
      assertVersion(order, input.version);
      if (order.sourceType === "company_stock") throw new TRPCError({ code: "CONFLICT", message: "公司库存订单已在创建时分配，不可重复预留" });
      const storedItems = await orderItems(tx, scope, input.id);
      const byId = new Map(storedItems.map(row => [Number(row.id), row]));
      // The locked order fences all stock writers. Any prior reservation, even released
      // or carrying an inconsistent owner, must not be converted into a fresh allocation.
      const existing = rows<{ id: number }>(await tx.execute(sql`SELECT id FROM company_stock_reservations
        WHERE enterpriseId = ${scope.enterpriseId} AND orderId = ${input.id} ORDER BY id LIMIT 1`));
      if (existing.length || order.companyStockAllocated) throw new TRPCError({ code: "CONFLICT", message: "本单已有公司预留记录，不可增量或重新分配" });
      if (storedItems.some(item => Number(item.shippedQty ?? 0) > 0)) throw new TRPCError({ code: "CONFLICT", message: "旧需求订单已有个人库存出货，须待人工核对，不能转公司批次" });
      if (input.items.length !== storedItems.length || storedItems.some(item => !input.items.some(row => row.orderItemId === Number(item.id)))) {
        throw new TRPCError({ code: "CONFLICT", message: "须一次性分配本单全部物料的全部未出货数量" });
      }
      const allocations: CompanyStockReserveInput["items"] = [];
      for (const row of input.items) {
        const item = byId.get(row.orderItemId);
        if (!item) throw new TRPCError({ code: "BAD_REQUEST", message: "分配物料不属于本订单" });
        const qty = row.allocations.reduce((sum, allocation) => sum + BigInt(allocation.qty), BigInt(0));
        if (qty !== BigInt(Number(item.orderedQty))) throw new TRPCError({ code: "CONFLICT", message: "须一次性分配本行全部待出货数量" });
        allocations.push(...row.allocations.map(allocation => ({ ...allocation, orderItemId: row.orderItemId, expected: identity(item) })));
      }
      const snapshots = await deps.stock.reserveLotsInTx(tx, scoped, { orderId: input.id, items: allocations });
      const collection = await collectionAmounts(tx, scope, input.id);
      const evidence = financialEvidence(order, storedItems, allocations.map((row, index) => ({ ...row, id: index + 1, orderId: input.id, consumedQty: 0, releasedQty: 0 })), snapshots, collection.paidAmount, collection.monthlyAmount);
      await bump(tx, scope, input.id, input.version, sql`, companyStockAllocated = 1, profitPolicyVersion = ${evidence.policyVersion}`);
      await finishRequest(tx, scope, input.requestId, input.id);
      await deps.insertAudit(tx, { ...scope, customerId: Number(customer.id), orderId: input.id, action: "stock_allocated", note: "已选择真实公司批次并预留", requestId: input.requestId,
        policyVersion: evidence.policyVersion, financialSnapshot: evidence });
      return { id: input.id, version: input.version + 1, replayed: false };
    });
  }
  async function shipCompanyStock(scope: CrmCompanyScope, rawInput: SalesOrderCompanyStockShipInput) {
    const input = parse(salesOrderCompanyStockShipSchema, rawInput);
    const payloadHash = hash({ ...input, version: undefined, requestId: undefined, items: [...input.items].sort((a, b) => a.orderItemId - b.orderItemId || a.lotId - b.lotId) });
    return (await db()).transaction(async tx => {
      const scoped = await prelockStockScope(tx, scope);
      const { customer, order } = await deps.lockOrder(tx, scope, input.id);
      const salesTaxMode = orderSalesTaxMode(order);
      const request = await deps.reserveRequest(tx, { ...scope, requestId: input.requestId, payloadHash, action: "shipment_company_stock" });
      if (request.replayed) return { id: request.orderId, version: Number(order.version), replayed: true };
      assertVersion(order, input.version);
      if (order.sourceType !== "company_stock" && !order.companyStockAllocated) throw new TRPCError({ code: "CONFLICT", message: "需求订单须先显式分配公司批次" });
      const storedItems = await orderItems(tx, scope, input.id);
      const byId = new Map(storedItems.map(row => [Number(row.id), row]));
      const qtyById = new Map<number, number>();
      for (const line of input.items) {
        if (!byId.has(line.orderItemId)) throw new TRPCError({ code: "BAD_REQUEST", message: "出货物料不属于本订单" });
        qtyById.set(line.orderItemId, (qtyById.get(line.orderItemId) ?? 0) + line.qty);
      }
      for (const [id, qty] of Array.from(qtyById.entries())) {
        const item = byId.get(id)!;
        if (BigInt(Number(item.shippedQty ?? 0)) + BigInt(qty) > BigInt(Number(item.orderedQty))) throw new TRPCError({ code: "CONFLICT", message: "累计出货不得超过订单数量" });
      }
      const shipment = header(await tx.execute(sql`INSERT INTO crm_sales_order_shipments
        (enterpriseId, orderId, actorUserId, requestId, payloadHash, sourceType, deliveryMethod, expressCo, expressNo, note, createdAt)
        VALUES (${scope.enterpriseId}, ${input.id}, ${scope.actorUserId}, ${input.requestId}, ${payloadHash}, 'company_stock', ${input.deliveryMethod},
          ${input.deliveryMethod === "express" ? input.expressCo : ""}, ${input.deliveryMethod === "express" ? input.expressNo : ""}, ${input.note}, ${NOW})`));
      const shipmentId = Number(shipment.insertId);
      if (!shipmentId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "出货记录创建失败" });
      const consumption = await deps.stock.consumeReservedLotsInTx(tx, scoped, { orderId: input.id, shipmentId, items: input.items, note: input.note });
      if (consumption.items.length !== input.items.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "公司出货来源返回不完整" });
      for (const line of input.items) {
        const source = consumption.items.find(row => Number(row.orderItemId) === line.orderItemId && Number(row.lotId) === line.lotId);
        if (!source || Number(source.qty) !== line.qty || Number(source.outboundOrderId) <= 0 || !source.slipNo) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "公司出货关联返回不完整" });
        await tx.execute(sql`INSERT INTO crm_sales_order_shipment_items
          (enterpriseId, shipmentId, orderId, orderItemId, inventoryId, lotId, consumptionId, outboundOrderId, slipNo, partNumber, qty, createdAt)
          VALUES (${scope.enterpriseId}, ${shipmentId}, ${input.id}, ${line.orderItemId}, NULL, ${line.lotId}, NULL,
            ${source.outboundOrderId}, ${source.slipNo}, ${source.partNumber}, ${line.qty}, ${NOW})`);
      }
      await bump(tx, scope, input.id, input.version);
      await finishRequest(tx, scope, input.requestId, input.id);
      await deps.insertAudit(tx, { ...scope, customerId: Number(customer.id), orderId: input.id, action: "shipment", note: `公司库存出货；${input.deliveryMethod === "pickup" ? "自提" : `${input.expressCo} ${input.expressNo}`}`, requestId: input.requestId,
        policyVersion: order.profitPolicyVersion ?? SALES_COMMISSION_POLICY?.version ?? null,
        financialSnapshot: { schemaVersion: 1, shipmentId, salesTaxMode, consumedLots: consumption.items.map(row => ({ ...row })) } });
      return { id: input.id, version: input.version + 1, replayed: false, shipmentId };
    });
  }
  async function updateSalesExpenses(scope: CrmCompanyScope, rawInput: SalesOrderExpensesInput) {
    const input = parse(salesOrderExpensesSchema, rawInput);
    const amount = scaledToDecimal(decimalToScaled(input.amount));
    const payloadHash = hash({ id: input.id, amount, note: input.note });
    return (await db()).transaction(async tx => {
      const prelocked = await prelockOrderStockScope(tx, scope, input.id);
      const { customer, order } = await deps.lockOrder(tx, scope, input.id);
      assertOrderStockPrelocked(order, prelocked);
      const request = await deps.reserveRequest(tx, { ...scope, requestId: input.requestId, payloadHash, action: "expenses" });
      if (request.replayed) return { id: request.orderId, version: Number(order.version), replayed: true };
      assertVersion(order, input.version);
      const previousAmount = scaledToDecimal(decimalToScaled(String(order.salesExpenses ?? "0.0000")));
      const items = await orderItems(tx, scope, input.id);
      const collection = await collectionAmounts(tx, scope, input.id);
      const { allocations, evidence: before } = await readCostEvidence(tx, scope, order, items, collection.paidAmount, collection.monthlyAmount);
      // Derive both sides from the exact same server-obtained batch evidence in this original transaction.
      const after = financialEvidence({ ...order, salesExpenses: amount }, items, allocations, before.costSnapshot.lotCosts, collection.paidAmount, collection.monthlyAmount);
      await tx.execute(sql`INSERT INTO crm_sales_order_expenses
        (enterpriseId, orderId, actorUserId, requestId, payloadHash, previousAmount, amount, note, version, policyVersion, costSnapshot, createdAt)
        VALUES (${scope.enterpriseId}, ${input.id}, ${scope.actorUserId}, ${input.requestId}, ${payloadHash}, ${previousAmount}, ${amount}, ${input.note}, ${input.version + 1}, ${after.policyVersion}, ${JSON.stringify(after.costSnapshot)}, ${NOW})`);
      await bump(tx, scope, input.id, input.version, sql`, salesExpenses = ${amount}`);
      await finishRequest(tx, scope, input.requestId, input.id);
      await deps.insertAudit(tx, { ...scope, customerId: Number(customer.id), orderId: input.id, action: "expenses", note: `销售费用 ${previousAmount} → ${amount}；${input.note}`, requestId: input.requestId,
        policyVersion: after.policyVersion, financialSnapshot: { before, after, previousAmount, amount } });
      return { id: input.id, version: input.version + 1, replayed: false };
    });
  }
  async function releaseOrder(tx: CrmCompanySqlExecutor, scope: CrmCompanyScope, orderId: number) {
    return deps.stock.releaseOrderReservationsInTx(tx, await stockScope(tx, scope), { orderId });
  }
  return { companyStockCandidates, previewCompanyStock, createCompanyStock, allocateCompanyStock, shipCompanyStock,
    updateSalesExpenses, readFinancials, readPaymentFinancialSnapshots, releaseOrder, stockScope, prelockStockScope, prelockOrderStockScope };
}
function identity(item: { partNumber: string; brand: string; pkg: string; dc?: string }) {
  return { partNumber: item.partNumber, brand: item.brand, pkg: item.pkg, dc: item.dc ?? "" };
}
function sameIdentity(a: { partNumber: string; brand: string; pkg: string; dc: string }, b: { partNumber: string; brand: string; pkg: string; dc: string }) {
  return ["partNumber", "brand", "pkg", "dc"].every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
}
export function currencyLabel(mode: SalesTaxMode | null) {
  return mode === "tax_excluded" ? "人民币（未税）" : mode === "tax_included" ? "人民币（含税）" : "人民币（税口径待核）";
}
