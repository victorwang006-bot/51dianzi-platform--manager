import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, sql, type SQL } from "drizzle-orm";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT,
  newInformationFactsInputSchema,
  type NewInformationFact,
  type NewInformationFactsResult,
} from "../../../../shared/adminNewInformationFacts";
import { getDb, buildAdminOrderConditions, sellerOrderReadWhere } from "../../db";
import { crmSalesOrderNewInformationAccess, type CrmSalesOrderScope } from "../crmSalesOrders";
import { trustedCustomerAdminAccountId } from "../crmCustomerAssignments";

export type SalesFactsInput = { refs?: string[] };
/** Server-only dependencies. Never accept these helpers/identities from RPC input. */
export type SalesFactsDependencies = {
  getDb?: typeof getDb;
  crmAccess?: typeof crmSalesOrderNewInformationAccess;
  sellerWhere?: typeof sellerOrderReadWhere;
  adminOrderConditions?: typeof buildAdminOrderConditions;
};
type StoredCreation = { id: number | string; createdAt: Date | string; originAdminAccountId?: number | null };
const READ_SNAPSHOT = {
  isolationLevel: "repeatable read" as const,
  accessMode: "read only" as const,
};
const activatedAt = Date.parse(ADMIN_NEW_INFORMATION_ACTIVATED_AT);
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function inputOf(raw: SalesFactsInput): SalesFactsInput {
  const checked = newInformationFactsInputSchema.safeParse(raw);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: "新信息查询参数无效" });
  return checked.data;
}
function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "销售读取身份无效" });
  return value;
}
/** Wrong physical namespace/invalid canonical IDs can never match another source. */
function referenceWhere(input: SalesFactsInput, namespace: "crm-sales" | "order", idColumn: SQL): SQL {
  if (input.refs === undefined) return sql`TRUE`;
  const ids = Array.from(new Set(input.refs.flatMap(ref => {
    const match = new RegExp(`^${namespace}:([1-9][0-9]*)$`).exec(ref);
    const id = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  })));
  return ids.length ? sql`${idColumn} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})` : sql`FALSE`;
}
function factsOf(rows: StoredCreation[], namespace: "crm-sales" | "order", child: "business" | "mall"): NewInformationFact[] {
  const facts = new Map<string, NewInformationFact>();
  for (const row of rows) {
    const id = positiveId(Number(row.id));
    // The exact original service +08:00 string / driver Date normalization.
    const occurredAt = crmSalesOrderNewInformationAccess.normalizeCreatedAt(row.createdAt);
    if (!occurredAt) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "订单创建时间不可用" });
    const fact: NewInformationFact = {
      id: `${namespace}:${id}`,
      version: `created:${occurredAt}`,
      occurredAt,
      historical: Date.parse(occurredAt) < activatedAt,
      children: [child],
      // Only the CRM exact-event JOIN supplies evidence; seller/native never infer creators.
      ...(namespace === "crm-sales" && row.originAdminAccountId != null
        ? { actorKey: `admin:${positiveId(Number(row.originAdminAccountId))}` } : {}),
    };
    facts.set(fact.id, fact);
  }
  return Array.from(facts.values()).sort((a, b) => a.id.localeCompare(b.id));
}
function resultOf(identity: string, authority: unknown, items: NewInformationFact[], actorKey?: string): NewInformationFactsResult {
  const scope = { identity, version: digest(authority), ...(actorKey === undefined ? {} : { actorKey }) };
  return { available: true, scope, items, snapshot: digest({ scope, items }) };
}
function storedRows(result: unknown): StoredCreation[] {
  return ((result as [StoredCreation[], unknown])[0] ?? []);
}
async function requireDatabase(deps: SalesFactsDependencies) {
  const db = await (deps.getDb ?? getDb)();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

/** Bind to salesOrderProcedure; scope is scopeFor(ctx), never client enterprise/actor. */
export function createCrmSalesNewInformationReader(deps: SalesFactsDependencies = {}) {
  return async (scope: CrmSalesOrderScope, raw: SalesFactsInput = {}): Promise<NewInformationFactsResult> => {
    const input = inputOf(raw);
    positiveId(scope.enterpriseId);
    positiveId(scope.actorUserId);
    const db = await requireDatabase(deps);
    const accessHelpers = deps.crmAccess ?? crmSalesOrderNewInformationAccess;
    return db.transaction(async tx => {
      // Every membership/module/customer/demand authorization read shares this snapshot.
      const access = await accessHelpers.requireAccess(tx, scope);
      const rows = storedRows(await tx.execute(sql`
        SELECT o.id, DATE_FORMAT(o.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
               origin.adminAccountId AS originAdminAccountId
          FROM crm_sales_orders o
          INNER JOIN crm_customers c ON c.enterpriseId = o.enterpriseId AND c.id = o.customerId
          LEFT JOIN admin_new_information_origins origin
            ON origin.resourceKind = 'crm-sales' AND origin.resourceId = o.id AND origin.enterpriseId = o.enterpriseId
            AND origin.eventRef = CONCAT('created:', DATE_FORMAT(DATE_SUB(o.createdAt, INTERVAL 8 HOUR), '%Y-%m-%dT%H:%i:%s.000Z'))
            AND origin.staffUserId = o.createdByUserId
         WHERE ${accessHelpers.scopeWhere(scope, access.policy)}
           AND ${referenceWhere(input, "crm-sales", sql`o.id`)}
         ORDER BY o.id ASC
      `));
      const adminAccountId = trustedCustomerAdminAccountId(scope);
      // Delegation nonce is provenance, not permission scope/version material.
      const identityScope = { enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId };
      return resultOf(`crm-sales:${scope.enterpriseId}:${scope.actorUserId}`, { scope: identityScope, policy: access.policy },
        factsOf(rows, "crm-sales", "business"), adminAccountId == null ? undefined : `admin:${adminAccountId}`);
    }, READ_SNAPSHOT);
  };
}

/** Bind to protectedProcedure and the existing marketplace.seller / orders-read BFF fence. */
export function createSellerSalesNewInformationReader(deps: SalesFactsDependencies = {}) {
  return async (sellerId: number, raw: SalesFactsInput = {}): Promise<NewInformationFactsResult> => {
    const input = inputOf(raw);
    positiveId(sellerId);
    const db = await requireDatabase(deps);
    return db.transaction(async tx => {
      const rows = storedRows(await tx.execute(sql`
        SELECT orders.id, orders.createdAt FROM orders
         WHERE ${(deps.sellerWhere ?? sellerOrderReadWhere)(sellerId)}
           AND ${referenceWhere(input, "order", sql`orders.id`)}
         ORDER BY orders.id ASC
      `));
      return resultOf(`seller-orders:${sellerId}`, { sellerId }, factsOf(rows, "order", "mall"));
    }, READ_SNAPSHOT);
  };
}

/** INTERNAL ONLY: the admin caller must prove local account + orders.read and derive
 * getAdminSalesStaffCodes(ctx) server-side. undefined / [] / codes retain original semantics.
 * No frontend DTO, merchant selection, handler or invented OAuth fallback grants scope.
 */
export function createNativeSalesNewInformationReader(deps: SalesFactsDependencies = {}) {
  return async (salesStaffCodes: string[] | undefined, raw: SalesFactsInput = {}): Promise<NewInformationFactsResult> => {
    const input = inputOf(raw);
    if (salesStaffCodes !== undefined && (!Array.isArray(salesStaffCodes) || salesStaffCodes.some(code => typeof code !== "string" || !code.trim() || code.length > 64))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "销售工号范围无效" });
    }
    const db = await requireDatabase(deps);
    return db.transaction(async tx => {
      // The ORIGINAL predicate intentionally leaves [] to its caller; fail closed BEFORE SELECT.
      if (salesStaffCodes !== undefined && salesStaffCodes.length === 0) {
        return resultOf("native-orders", { salesStaffCodes: [] }, []);
      }
      const conditions = (deps.adminOrderConditions ?? buildAdminOrderConditions)({ salesStaffCodes });
      const rows = storedRows(await tx.execute(sql`
        SELECT orders.id, orders.createdAt FROM orders
          LEFT JOIN companies ON companies.userId = orders.buyerId
         WHERE ${and(...conditions) ?? sql`TRUE`}
           AND ${referenceWhere(input, "order", sql`orders.id`)}
         ORDER BY orders.id ASC
      `));
      return resultOf("native-orders", { salesStaffCodes: salesStaffCodes === undefined ? null : [...salesStaffCodes].sort() }, factsOf(rows, "order", "mall"));
    }, READ_SNAPSHOT);
  };
}

export const readCrmSalesNewInformationFacts = createCrmSalesNewInformationReader();
export const readSellerSalesNewInformationFacts = createSellerSalesNewInformationReader();
export const readNativeSalesNewInformationFacts = createNativeSalesNewInformationReader();
