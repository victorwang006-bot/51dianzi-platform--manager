import { createRequire } from "node:module";
import { sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCustomerDemand, listCustomerDemands } from "./customerDemands";

// Vitest 2's static builtin list predates node:sqlite; native require avoids a production dependency.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const runtime = vi.hoisted(() => ({ executor: undefined as any, write: true, read: true }));
vi.mock("../db", () => ({ getDb: async () => runtime.executor }));
vi.mock("./businessModuleAccess", () => ({ resolveBusinessModuleAccess: async () => ({ read: runtime.read, write: runtime.write, scope: "personal" }) }));
vi.mock("./crmCustomers", () => ({
  resolveCrmCustomerPolicy: async () => ({ read: runtime.read, write: runtime.write, scope: "personal" }),
  crmCustomerPolicyWhere: (scope: { enterpriseId: number; actorUserId: number }, _policy: unknown, alias: string) => sql`${sql.raw(alias)}.enterpriseId = ${scope.enterpriseId} AND ${sql.raw(alias)}.assignedUserId = ${scope.actorUserId}`,
}));

let local: InstanceType<typeof DatabaseSync>;
const scope = { enterpriseId: 31, actorUserId: 7 };
const dialect = new MySqlDialect();
const seen: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  runtime.read = true; runtime.write = true; seen.length = 0;
  local = new DatabaseSync(":memory:");
  local.function("CONCAT", { varargs: true }, (...values) => values.join(""));
  // Only synthetic in-memory fixtures are written. The service executor below allows SELECT only.
  local.exec(`
    CREATE TABLE enterprises (id INTEGER, superAdminUserId INTEGER);
    CREATE TABLE enterprise_members (id INTEGER, enterpriseId INTEGER, userId INTEGER, role TEXT, status TEXT);
    CREATE TABLE users (id INTEGER, name TEXT, username TEXT, loginDisabled INTEGER);
    CREATE TABLE crm_customers (id INTEGER, enterpriseId INTEGER, assignedUserId INTEGER, archivedAt TEXT, name TEXT);
    CREATE TABLE crm_customer_demands (id INTEGER, enterpriseId INTEGER, customerId INTEGER, demandNo TEXT, projectName TEXT, priority TEXT, status TEXT, note TEXT,
      replyDueAt TEXT, submittedAt TEXT, createdByUserId INTEGER, updatedByUserId INTEGER, procurementUserId INTEGER, claimedAt TEXT,
      version INTEGER, revision INTEGER, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE crm_customer_demand_items (id INTEGER, enterpriseId INTEGER, demandId INTEGER, sortOrder INTEGER, partNumber TEXT, brand TEXT, pkg TEXT,
      qty INTEGER, qtyUnit TEXT, deliveryRequirement TEXT, note TEXT);
    CREATE TABLE crm_customer_demand_quotes (id INTEGER, enterpriseId INTEGER, customerId INTEGER, demandId INTEGER, version INTEGER, demandRevision INTEGER, status TEXT);
    CREATE TABLE crm_customer_demand_quote_items (enterpriseId INTEGER, demandId INTEGER, quoteId INTEGER, demandItemId INTEGER, qty INTEGER);
    CREATE TABLE crm_customer_demand_quote_acceptances (id INTEGER, enterpriseId INTEGER, customerId INTEGER, demandId INTEGER, quoteId INTEGER, quoteVersion INTEGER, demandRevision INTEGER);
    CREATE TABLE crm_customer_demand_quote_acceptance_items (enterpriseId INTEGER, demandId INTEGER, acceptanceId INTEGER, demandItemId INTEGER, qty INTEGER);
    CREATE TABLE crm_sales_orders (id INTEGER, enterpriseId INTEGER, customerId INTEGER, demandId INTEGER, status TEXT);
    CREATE TABLE crm_sales_order_items (enterpriseId INTEGER, orderId INTEGER, sourceDemandItemId INTEGER);
    INSERT INTO enterprises VALUES (31, 7);
    INSERT INTO enterprise_members VALUES (71, 31, 7, 'super_admin', 'active');
    INSERT INTO users VALUES (7, '合成销售', 'test7', 0);
    INSERT INTO crm_customers VALUES (12, 31, 7, NULL, '合成客户');
    INSERT INTO crm_customer_demands VALUES (41, 31, 12, 'XQ-41', '合成项目', 'normal', 'processing', '',
      NULL, NULL, 7, 7, NULL, NULL, 3, 2, '2026-11-01 08:00:00', '2026-11-01 08:00:00');
    INSERT INTO crm_customer_demand_items VALUES (401, 31, 41, 1, 'SYNTHETIC-401', 'TEST', 'TEST', 100, '片', '', '');
  `);
  runtime.executor = { execute: vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    expect(compiled.sql.trim()).toMatch(/^SELECT\b/i);
    seen.push(compiled);
    return [local.prepare(compiled.sql).all(...compiled.params as any[]), []];
  }) };
});
afterEach(() => local.close());

function addQuote(id = 501, revision = 2, version = 3, status = "active", customerId = 12, qty = 100) {
  local.prepare("INSERT INTO crm_customer_demand_quotes VALUES (?, 31, ?, 41, ?, ?, ?)").run(id, customerId, version, revision, status);
  local.prepare("INSERT INTO crm_customer_demand_quote_items VALUES (31, 41, ?, 401, ?)").run(id, qty);
}
function addAcceptance(id = 801, quoteId = 501, revision = 2, version = 3, qty = 50, customerId = 12) {
  local.prepare("INSERT INTO crm_customer_demand_quote_acceptances VALUES (?, 31, ?, 41, ?, ?, ?)").run(id, customerId, quoteId, version, revision);
  local.prepare("INSERT INTO crm_customer_demand_quote_acceptance_items VALUES (31, 41, ?, 401, ?)").run(id, qty);
}
async function summary() { return (await listCustomerDemands(scope, { customerId: 12, page: 1, pageSize: 20 })).items[0]; }

describe("客户需求权威当前报价汇总（真实 SQL，仅内存，无外部 DB）", () => {
  it("reports no quotes without fabricating a quoted stage and keeps exact source scope", async () => {
    expect(await summary()).toMatchObject({ customerId: 12, status: "processing", currentQuoteCount: 0, acceptedQuoteCount: 0, confirmableQuoteCount: 0, workflowStage: "inquiring", canEdit: true });
    const projection = seen.find(query => query.sql.includes("AS confirmableQuoteCount"))!;
    expect(projection.params).toContain(31); expect(projection.params).toContain(12); expect(projection.params).toContain(7);
    expect(projection.sql).toContain("d.customerId = ?");
  });
  it("counts active current quote headers, not quote rounds or withdrawn/stale headers", async () => {
    addQuote(); addQuote(502, 1, 9); addQuote(503, 2, 8, "withdrawn");
    expect(await summary()).toMatchObject({ quoteCount: 2, currentQuoteCount: 1, acceptedQuoteCount: 0, confirmableQuoteCount: 1, workflowStage: "quote_selection" });
  });
  it.each([
    ["quote version changed", 2, 2, "active", 12],
    ["old demand revision", 1, 3, "active", 12],
    ["withdrawn source", 2, 3, "withdrawn", 12],
    ["wrong acceptance customer", 2, 3, "active", 13],
  ])("ignores an obsolete adoption: %s", async (_reason, revision, version, status, acceptedCustomer) => {
    addQuote(501, 2, 3, status); addAcceptance(801, 501, revision, version, 100, acceptedCustomer);
    expect(await summary()).toMatchObject({ acceptedQuoteCount: 0, confirmableQuoteCount: status === "active" ? 1 : 0 });
  });
  it("marks unchanged current adoption confirmed and excludes that already adopted quote", async () => {
    addQuote(); addAcceptance();
    expect(await summary()).toMatchObject({ currentQuoteCount: 1, acceptedQuoteCount: 1, confirmableQuoteCount: 0, workflowStage: "quote_confirmed" });
    const detail = await getCustomerDemand(scope, { id: 41 });
    expect(detail).toMatchObject({ currentQuoteCount: 1, acceptedQuoteCount: 1, confirmableQuoteCount: 0, workflowStage: "quote_confirmed", canEdit: true });
    expect(detail.items[0]).toMatchObject({ id: 401, qty: 100 });
  });
  it("allows another current quote only while source material quantity remains", async () => {
    addQuote(); addQuote(502); addAcceptance();
    expect(await summary()).toMatchObject({ currentQuoteCount: 2, acceptedQuoteCount: 1, confirmableQuoteCount: 1 });
    local.exec("UPDATE crm_customer_demand_quote_acceptance_items SET qty = 100");
    expect(await summary()).toMatchObject({ currentQuoteCount: 2, acceptedQuoteCount: 1, confirmableQuoteCount: 0 });
  });
  it("released withdrawn/old-version adoption does not consume current remaining quantity", async () => {
    addQuote(); addQuote(502, 2, 4); addAcceptance(801, 502, 2, 3, 100);
    expect(await summary()).toMatchObject({ acceptedQuoteCount: 0, confirmableQuoteCount: 2 });
  });
  it("excludes orphan material bindings, zero quote quantity and wrong-customer quote from confirmability", async () => {
    addQuote(501, 2, 3, "active", 12, 0); addQuote(502, 2, 3, "active", 13); addQuote(503);
    local.exec("UPDATE crm_customer_demand_quote_items SET demandItemId = 999 WHERE quoteId = 503");
    expect(await summary()).toMatchObject({ currentQuoteCount: 2, acceptedQuoteCount: 0, confirmableQuoteCount: 0 });
  });
  it("confirmed orders retain the independent higher stage even when old adoption becomes stale", async () => {
    addQuote(501, 1); addAcceptance(801, 501, 1);
    local.exec("INSERT INTO crm_sales_orders VALUES (901, 31, 12, 41, 'confirmed'); INSERT INTO crm_sales_order_items VALUES (31, 901, 401)");
    expect(await summary()).toMatchObject({ acceptedQuoteCount: 0, activeOrderCount: 1, hasActiveOrders: true, workflowStage: "customer_confirmed" });
    expect(await getCustomerDemand(scope, { id: 41 })).toMatchObject({ lockedItemIds: [401], hasActiveOrders: true });
  });
  it("list and detail fail closed on write revocation/archive while reads remain available", async () => {
    addQuote(); runtime.write = false;
    expect(await summary()).toMatchObject({ canEdit: false, confirmableQuoteCount: 1 });
    expect(await getCustomerDemand(scope, { id: 41 })).toMatchObject({ canEdit: false });
    runtime.write = true; local.exec("UPDATE crm_customers SET archivedAt = '2026-11-01 08:00:00'");
    expect(await summary()).toMatchObject({ canEdit: false });
    expect(await getCustomerDemand(scope, { id: 41 })).toMatchObject({ canEdit: false, editRestriction: "已归档客户不可编辑需求" });
  });
  it("never exposes another assignee, customer or suspended member's demand", async () => {
    local.exec("UPDATE crm_customers SET assignedUserId = 8");
    await expect(summary()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCustomerDemand(scope, { id: 41 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    local.exec("UPDATE crm_customers SET assignedUserId = 7; UPDATE enterprise_members SET status = 'suspended'");
    await expect(summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("read revocation stops before reading business details", async () => {
    runtime.read = false;
    await expect(summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(seen.some(query => query.sql.includes("AS confirmableQuoteCount"))).toBe(false);
  });
});
