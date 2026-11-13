import { describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import {
  businessSalesOrderMetadataOrders as orders, businessSalesOrderReceivers as receivers,
  businessSalesOrderAfterSales as cases, businessSalesOrderMetadataRequests as requests,
  businessSalesOrderMetadataAudits as audits,
} from "../drizzle/businessSalesOrderMetadataSchema";

const indexes = (table: typeof orders) => getTableConfig(table).indexes.map(index => ({
  name: index.config.name, unique: index.config.unique,
  columns: index.config.columns.map(column => "name" in column ? column.name : ""),
}));
describe("independent business sales metadata schema", () => {
  it("uses only native-admin table prefixes, clear provenance and no original FKs/financial fields", () => {
    for (const table of [orders, receivers, cases, requests, audits]) {
      const config = getTableConfig(table);
      expect(config.name.startsWith("business_sales_order_")).toBe(true);
      expect(config.foreignKeys).toEqual([]);
      expect(config.columns.map(column => column.name)).toEqual(expect.arrayContaining(["merchantId", "orderId", "orderNumber", "customerId"]));
      expect(config.columns.some(column => /amount|payment|refundEvidence|stock|inventory|enterprise/i.test(column.name))).toBe(false);
    }
  });
  it("ensures per-merchant order/id and order-number collision guards; receiver only one per order", () => {
    expect(indexes(orders)).toEqual([
      { name: "bsomo_order_unique", unique: true, columns: ["merchantId", "orderId"] },
      { name: "bsomo_number_unique", unique: true, columns: ["merchantId", "orderNumber"] },
    ]);
    expect(getTableConfig(receivers).indexes[0].config.columns.map(column => "name" in column ? column.name : "")).toEqual(["merchantId", "orderId"]);
    expect(receivers.version.default).toBe(1);
  });
  it("case defaults are intent-only open v1, with nullable record-close time", () => {
    expect(cases.kind.enumValues).toEqual(["consultation", "repair", "exchange", "return_request", "refund_request"]);
    expect(cases.status.enumValues).toEqual(["open", "processing", "closed"]);
    expect(cases.status.default).toBe("open"); expect(cases.resolution.default).toBe("");
    expect(cases.version.default).toBe(1); expect(cases.closedAt.notNull).toBe(false);
  });
  it("request and append audit have same unique scoped request identity; no auto-update audit", () => {
    for (const table of [requests, audits]) {
      const unique = getTableConfig(table).indexes.find(index => index.config.unique);
      expect(unique?.config.columns.map(column => "name" in column ? column.name : "")).toEqual(["merchantId", "orderId", "actorAdminId", "requestId"]);
    }
    expect(requests.payloadSha256.notNull).toBe(true);
    expect(requests.resultJson.notNull).toBe(false);
    expect(audits.actorFrontUserId.notNull).toBe(true);
    expect(audits.beforeJson.notNull).toBe(false);
    expect(audits.afterJson.notNull).toBe(true);
    expect(getTableConfig(audits).columns.every(column => column.onUpdateFn === undefined)).toBe(true);
  });
  it("all defaults use fsp3 CURRENT_TIMESTAMP(3), with receiver field limits", () => {
    for (const table of [orders, receivers, cases, requests, audits]) {
      const created = getTableConfig(table).columns.find(column => column.name === "createdAt")!;
      expect(created.getSQLType()).toBe("timestamp(3)");
      expect(new MySqlDialect().sqlToQuery(created.default as SQL).sql).toBe("CURRENT_TIMESTAMP(3)");
    }
    expect(receivers.receiver.getSQLType()).toBe("varchar(64)");
    expect(receivers.receiverPhone.getSQLType()).toBe("varchar(40)");
    expect(receivers.receiverAddress.getSQLType()).toBe("varchar(500)");
    expect(receivers.note.getSQLType()).toBe("varchar(500)");
  });
});

/** Tests the project's installed Drizzle driver with inert clients, not mysql.createPool/socket access. */
describe("Drizzle mysql2 same-connection transaction compatibility (no DB)", () => {
  it.each(["callback-Pool", "PromisePool"])("%s leases one connection, binds SQL data and commits/releases", async kind => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (query: { sql: string }, params: unknown[]) => {
      statements.push({ sql: query.sql, params });
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
    const connection = { query, release: vi.fn() };
    const promisePool = { getConnection: vi.fn(async () => connection), query: vi.fn(() => { throw new Error("pool-query-forbidden"); }) };
    const callbackPool = { promise: vi.fn(() => promisePool), getConnection: vi.fn(() => { throw new Error("callback-acquisition-forbidden"); }) };
    const client = kind === "callback-Pool" ? callbackPool : promisePool;
    const db = drizzle(client as Parameters<typeof drizzle>[0]);
    await db.transaction(async tx => {
      await tx.execute(sql`UPDATE fictional_metadata SET note = ${"hostile ' sql text"} WHERE id = ${991001}`);
      await tx.execute(sql`INSERT INTO fictional_audit (note) VALUES (${JSON.stringify({ safelyBound: true })})`);
    });
    expect(promisePool.getConnection).toHaveBeenCalledTimes(1);
    expect(promisePool.query).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(statements.map(row => row.sql)).toEqual(["begin", "UPDATE fictional_metadata SET note = ? WHERE id = ?", "INSERT INTO fictional_audit (note) VALUES (?)", "commit"]);
    expect(statements[1].params).toEqual(["hostile ' sql text", 991001]);
    if (kind === "callback-Pool") {
      expect(callbackPool.promise).toHaveBeenCalledTimes(1);
      expect(callbackPool.getConnection).not.toHaveBeenCalled();
    }
  });
  it.each(["callback-Pool", "PromisePool"])("%s rolls back on callback/CAS failure and releases the same lease", async kind => {
    const statements: string[] = [];
    const connection = {
      query: vi.fn(async (query: { sql: string }) => { statements.push(query.sql); return [{ affectedRows: 1 }, []]; }), release: vi.fn(),
    };
    const promisePool = { getConnection: vi.fn(async () => connection) };
    const callbackPool = { promise: vi.fn(() => promisePool) };
    const db = drizzle((kind === "callback-Pool" ? callbackPool : promisePool) as Parameters<typeof drizzle>[0]);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO fictional_request (requestId) VALUES (${"fixture_request"})`);
      throw new Error("fictional-CAS-conflict");
    })).rejects.toThrow("fictional-CAS-conflict");
    expect(statements).toEqual(["begin", "INSERT INTO fictional_request (requestId) VALUES (?)", "rollback"]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
