import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  SALES_ORDER_DRAFT_MAX_REVISION, salesOrderDraftGetSchema, salesOrderDraftSaveSchema,
  salesOrderDraftDeleteSchema, salesOrderDraftPayloadSchema,
  type SalesOrderDraftSaveInput, type SalesOrderDraftDeleteInput,
  type SalesOrderDraftMutationResult, type SalesOrderDraftResult,
} from "../../../shared/crmSalesOrderDrafts";
import type { StaffDelegation } from "../_core/context";

export type SalesOrderDraftScope = { enterpriseId: number; actorUserId: number; staffDelegation?: StaffDelegation };
export type SalesOrderDraftExecutor = { execute(query: SQL): Promise<unknown> };
export type SalesOrderDraftDatabase = SalesOrderDraftExecutor & { transaction<T>(fn: (tx: SalesOrderDraftExecutor) => Promise<T>): Promise<T> };
export type SalesOrderDraftDeps = {
  getDb(): Promise<SalesOrderDraftDatabase | null>;
  requireAccess(tx: SalesOrderDraftExecutor, scope: SalesOrderDraftScope, lock: boolean): Promise<unknown>;
};
type Row = { id: number; revision: number | string; updatedAt: Date | string; payload: unknown };
const NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;
function rows<T>(result: unknown): T[] { return (result as [T[], unknown])[0]; }
function changed(result: unknown) {
  if (Number((result as [{ affectedRows?: number }])[0]?.affectedRows) !== 1) conflict();
}
function conflict(): never { throw new TRPCError({ code: "CONFLICT", message: "草稿已在其他页面更新，请重新读取并保留当前表单，不能自动覆盖" }); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "草稿参数无效" });
  return parsed.data;
}
function accountId(scope: SalesOrderDraftScope) {
  for (const value of [scope.enterpriseId, scope.actorUserId]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "草稿账号公司范围无效" });
  }
  if (!scope.staffDelegation) return 0;
  const delegation = scope.staffDelegation;
  if (delegation.kind !== "business_bff" || delegation.enterpriseId !== scope.enterpriseId || delegation.staffUserId !== scope.actorUserId
    || !Number.isSafeInteger(delegation.adminAccountId) || delegation.adminAccountId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "草稿受信后台账号范围无效" });
  }
  return delegation.adminAccountId;
}
function revision(row: Row) {
  const value = Number(row.revision);
  if (!Number.isSafeInteger(value) || value < 0 || value >= SALES_ORDER_DRAFT_MAX_REVISION) {
    throw new TRPCError({ code: "CONFLICT", message: "草稿版本异常或已达上限，请人工检查" });
  }
  return value;
}
function result(row: Row): SalesOrderDraftMutationResult {
  return { revision: revision(row), updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt) };
}
export function createSalesOrderDraftService(deps: SalesOrderDraftDeps) {
  async function db() {
    const value = await deps.getDb();
    if (!value) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    return value;
  }
  async function read(tx: SalesOrderDraftExecutor, scope: SalesOrderDraftScope, account: number, lock = false) {
    return rows<Row>(await tx.execute(sql`SELECT id, revision, updatedAt, payload FROM crm_sales_order_drafts
      WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND adminAccountId = ${account}
      LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`))[0];
  }
  async function get(scope: SalesOrderDraftScope, rawInput: unknown = {}): Promise<SalesOrderDraftResult> {
    parse(salesOrderDraftGetSchema, rawInput);
    const account = accountId(scope), database = await db();
    await deps.requireAccess(database, scope, false);
    const row = await read(database, scope, account);
    if (!row) return null;
    // Empty payload is a versioned tombstone, not the never-created revision-0 state.
    if (row.payload == null) return { draftId: Number(row.id), ...result(row), payload: null };
    let payload: unknown;
    try { payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; }
    catch { throw new TRPCError({ code: "CONFLICT", message: "已存草稿结构异常，请人工检查" }); }
    const checked = salesOrderDraftPayloadSchema.safeParse(payload);
    if (!checked.success) throw new TRPCError({ code: "CONFLICT", message: "已存草稿结构异常或超限，请人工检查" });
    return { draftId: Number(row.id), ...result(row), payload: checked.data };
  }
  async function save(scope: SalesOrderDraftScope, rawInput: SalesOrderDraftSaveInput): Promise<SalesOrderDraftMutationResult> {
    const input: SalesOrderDraftSaveInput = parse(salesOrderDraftSaveSchema, rawInput), account = accountId(scope);
    return (await db()).transaction(async tx => {
      // The unchanged native member/module policy is locked before any draft DML.
      await deps.requireAccess(tx, scope, true);
      let row = await read(tx, scope, account, true);
      if (!row) {
        if (input.expectedRevision !== 0) conflict();
        // No blind upsert of a payload. Unique-key races fail CAS, never replace another draft.
        await tx.execute(sql`INSERT INTO crm_sales_order_drafts (enterpriseId, actorUserId, adminAccountId, revision, payload, createdAt, updatedAt)
          VALUES (${scope.enterpriseId}, ${scope.actorUserId}, ${account}, 0, NULL, ${NOW}, ${NOW}) ON DUPLICATE KEY UPDATE id = id`);
        row = await read(tx, scope, account, true);
      }
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "草稿初始化失败" });
      const current = revision(row);
      if (current !== input.expectedRevision) conflict();
      changed(await tx.execute(sql`UPDATE crm_sales_order_drafts SET payload = ${JSON.stringify(input.payload)}, revision = revision + 1, updatedAt = ${NOW}
        WHERE id = ${row.id} AND enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId}
          AND adminAccountId = ${account} AND revision = ${current} ${row.payload == null ? sql`AND payload IS NULL` : sql`AND payload IS NOT NULL`}`));
      return result((await read(tx, scope, account))!);
    });
  }
  async function remove(scope: SalesOrderDraftScope, rawInput: SalesOrderDraftDeleteInput): Promise<SalesOrderDraftMutationResult> {
    const input: SalesOrderDraftDeleteInput = parse(salesOrderDraftDeleteSchema, rawInput), account = accountId(scope);
    return (await db()).transaction(async tx => {
      await deps.requireAccess(tx, scope, true);
      const row = await read(tx, scope, account, true);
      if (!row || row.payload == null || input.expectedRevision <= 0 || revision(row) !== input.expectedRevision) conflict();
      changed(await tx.execute(sql`UPDATE crm_sales_order_drafts SET payload = NULL, revision = revision + 1, updatedAt = ${NOW}
        WHERE id = ${row.id} AND enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId}
          AND adminAccountId = ${account} AND revision = ${input.expectedRevision} AND payload IS NOT NULL`));
      return result((await read(tx, scope, account))!);
    });
  }
  return { get, save, remove };
}
