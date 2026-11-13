import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/** Only server-proven authorization fields may supply this scope. */
export type BusinessTestOrderArchiveScope = {
  merchantId: number;
  sellerUserId: number;
};

/** Minimal metadata; backup locations and audit/confirmation details stay private. */
export type BusinessTestOrderArchiveTuple = BusinessTestOrderArchiveScope & {
  orderId: number;
  orderNo: string;
  originalStatus: string;
  isTest: number;
  state: "archived" | "restored";
};

function unavailable() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "订单归档核验服务暂时不可用，请稍后重试",
  });
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function assertScope(scope: BusinessTestOrderArchiveScope) {
  if (!scope || !positiveId(scope.merchantId) || !positiveId(scope.sellerUserId)) {
    throw unavailable();
  }
}

function isArchiveTuple(value: unknown): value is BusinessTestOrderArchiveTuple {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return positiveId(row.merchantId) && positiveId(row.sellerUserId) && positiveId(row.orderId)
    && typeof row.orderNo === "string" && row.orderNo.length > 0 && row.orderNo.length <= 128
    && typeof row.originalStatus === "string" && row.originalStatus.length > 0
    && typeof row.isTest === "number" && Number.isSafeInteger(row.isTest) && row.isTest >= 0
    && (row.state === "archived" || row.state === "restored");
}

function assertArchiveTuples(rows: unknown): asserts rows is BusinessTestOrderArchiveTuple[] {
  if (!Array.isArray(rows) || !rows.every(isArchiveTuple)) throw unavailable();
}

/**
 * Pure, non-mutating filter. No ID allowlist, status rewrites, DTO projection,
 * coercion or authorization fallback. All retained objects and their order stay
 * exactly as returned by the original seller procedure.
 */
export function filterBusinessTestOrderArchives<T>(
  rows: T[],
  scope: BusinessTestOrderArchiveScope,
  archives: readonly BusinessTestOrderArchiveTuple[],
): T[] {
  assertScope(scope);
  if (!Array.isArray(rows)) throw unavailable();
  assertArchiveTuples(archives);
  const active = new Map<number, Set<string>>();
  for (const archive of archives) {
    if (archive.merchantId !== scope.merchantId || archive.sellerUserId !== scope.sellerUserId
      || archive.state !== "archived" || archive.isTest !== 1 || archive.originalStatus !== "cancel") continue;
    const numbers = active.get(archive.orderId) ?? new Set<string>();
    numbers.add(archive.orderNo);
    active.set(archive.orderId, numbers);
  }
  const filtered = rows.filter(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
    const row = value as Record<string, unknown>;
    // The original DTO has no merchantId; if a future DTO supplies one, it must
    // agree too. Never substitute owner, handler, browser params or order aliases.
    if ("merchantId" in row && row.merchantId !== scope.merchantId) return true;
    return !(positiveId(row.id) && row.sellerId === scope.sellerUserId
      && row.status === "cancel" && typeof row.orderNo === "string"
      && active.get(row.id)?.has(row.orderNo));
  });
  return filtered.length === rows.length ? rows : filtered;
}

/**
 * One scoped, parameterized admin DB SELECT. mysql2/Drizzle execute returns
 * [RowDataPacket[], FieldPacket[]]; an absent/malformed result is NOT an empty
 * registry. No cache, fallback, DDL, archive audit DML or original-orders query.
 */
export async function loadActiveBusinessTestOrderArchives(
  scope: BusinessTestOrderArchiveScope,
): Promise<BusinessTestOrderArchiveTuple[]> {
  assertScope(scope);
  try {
    const db = await getDb();
    if (!db) throw unavailable();
    const result: unknown = await db.execute(sql`
      SELECT merchantId, sellerUserId, orderId, orderNo, originalStatus, isTest, state
      FROM business_test_order_archives
      WHERE merchantId = ${scope.merchantId}
        AND sellerUserId = ${scope.sellerUserId}
        AND state = 'archived' AND isTest = 1 AND originalStatus = 'cancel'
    `);
    if (!Array.isArray(result) || result.length !== 2
      || !Array.isArray(result[0]) || !Array.isArray(result[1])) throw unavailable();
    const archives: unknown = result[0];
    assertArchiveTuples(archives);
    return archives;
  } catch {
    // Do not include SQL, connection errors, backup paths or unfiltered DTOs in
    // public error causes/logs. A metadata failure must never look like success.
    throw unavailable();
  }
}

/** Call only after the original seller command succeeds, within its auth fence. */
export async function applyBusinessTestOrderArchives(
  result: unknown,
  scope: BusinessTestOrderArchiveScope,
): Promise<unknown[]> {
  assertScope(scope);
  if (!Array.isArray(result)) throw unavailable();
  const archives = await loadActiveBusinessTestOrderArchives(scope);
  return filterBusinessTestOrderArchives(result, scope, archives);
}
