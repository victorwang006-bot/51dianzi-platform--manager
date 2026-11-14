import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const isolated = vi.hoisted(() => ({ engine: null as any, facade: { transaction: (run: any) => isolated.engine.transaction(run) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => isolated.facade }));
// Defense in depth: even accidental fence use must never make a MySQL connection.
vi.mock("./businessAuthorizationFence", () => ({ withBusinessAuthorizationFence: (_: any, run: any) => run() }));
import { toggleAdminUserStatus, updateAdminUser } from "./db";

const dialect = new MySqlDialect();
const originalUrl = process.env.DATABASE_URL;
const account = (id: number, overrides: any = {}) => ({ id, userId: id, username: `native-${id}`, displayName: `后台${id}`, adminRole: "merchant_mgr", status: "active", sessionVersion: 7, passwordHash: "unchanged-hash", email: null, phone: null, ...overrides });
class MemoryTransactions {
  rows: Record<string, any[]> = {
    admin_users: [account(10, { adminRole: "super_admin" }), account(20), account(30, { adminRole: "super_admin" })],
    admin_staff_archives: [],
    admin_user_permissions: [{ id: 1, adminUserId: 20, permission: "merchants.read" }, { id: 2, adminUserId: 10, permission: "officialInventory.read" }],
    admin_user_sales_scopes: [{ id: 1, adminUserId: 20, staffCode: "native-20" }],
    sales_staff: [{ id: 1, adminUserId: 20, staffCode: "native-20", displayName: "后台20", status: "active" }],
    audit_logs: [], admin_user_permission_audits: [],
  };
  events: string[] = [];
  failAudit = false;
  forcedAffectedRows: number | undefined;
  casQueries: Array<{ sql: string; params: unknown[] }> = [];
  tail = Promise.resolve();
  async transaction(run: any) {
    // All real updates take the complete super set first, so their critical
    // sections serialize. This mutex models that lock and transactional rollback.
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    const before = structuredClone(this.rows);
    try { return await run(this); }
    catch (error) { this.rows = before; throw error; }
    finally { release(); }
  }
  matches(table: string, where: any, row: any) {
    if (!where) return true;
    const query = dialect.sqlToQuery(where);
    if (table === "admin_users" && query.sql.includes("NOT EXISTS"))
      return row.adminRole === "super_admin" && row.status === "active" && !this.rows.admin_staff_archives.some(a => a.adminUserId === row.id);
    if (table === "admin_user_permissions" && query.sql.includes(" in (")) {
      const inList = query.params.slice(1);
      return row.adminUserId === query.params[0] && (query.sql.includes("not in (") ? !inList.includes(row.permission) : inList.includes(row.permission));
    }
    const inField = query.sql.match(/`(?:\w+)`\.`(\w+)` in \(/);
    if (inField) return query.params.includes(row[inField[1]]);
    const field = query.sql.match(/`(?:\w+)`\.`(\w+)` = \?/);
    if (!field) throw new Error(`Unexpected mock SQL ${query.sql}`);
    if (table === "admin_users" && query.sql.includes("`sessionVersion` = ?"))
      return row.id === query.params[0] && row.status === query.params[1] && row.sessionVersion === query.params[2];
    return row[field[1]] === query.params[0];
  }
  select(projection?: any) {
    let table = "", where: any;
    const read = () => {
      const rows = this.rows[table].filter(row => this.matches(table, where, row)).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      return rows.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, column]: [string, any]) => [key, row[column.name]])) : { ...row });
    };
    const query: any = {
      from: (value: any) => { table = getTableName(value); return query; },
      where: (value: any) => { where = value; return query; },
      orderBy: () => query, limit: () => query, innerJoin: () => query,
      for: (kind: string) => { this.events.push(`lock:${table}:${kind}`); return Promise.resolve(read()); },
      then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject),
    };
    return query;
  }
  update(value: any) {
    const table = getTableName(value);
    return { set: (values: any) => ({ where: async (where: any) => {
      this.events.push(`update:${table}`);
      const matching = this.rows[table].filter(row => this.matches(table, where, row));
      if (table === "admin_users" && dialect.sqlToQuery(where).sql.includes("`sessionVersion` = ?"))
        this.casQueries.push(dialect.sqlToQuery(where));
      if (table === "admin_users" && this.forcedAffectedRows === 0) return [{ affectedRows: 0 }];
      for (const row of matching) {
        for (const [key, value] of Object.entries(values)) {
          if (value instanceof SQL) {
            expect(key).toBe("sessionVersion");
            expect(dialect.sqlToQuery(value).sql).toContain(" + 1");
            row[key] += 1;
          } else row[key] = value;
        }
      }
      return [{ affectedRows: table === "admin_users" && this.forcedAffectedRows !== undefined ? this.forcedAffectedRows : matching.length }];
    } }) };
  }
  insert(value: any) {
    const table = getTableName(value);
    return { values: async (values: any) => {
      this.events.push(`insert:${table}`);
      if (table === "audit_logs" && this.failAudit) throw new Error("AUDIT_WRITE_FAILED");
      this.rows[table].push(...structuredClone(Array.isArray(values) ? values : [values]));
      return [{ insertId: this.rows[table].length }];
    } };
  }
  delete(value: any) {
    const table = getTableName(value);
    return { where: async (where: any) => {
      this.events.push(`delete:${table}`);
      this.rows[table] = this.rows[table].filter(row => !this.matches(table, where, row));
    } };
  }
}
const options = (overrides: any = {}) => ({ expectedStatus: "active" as const, reason: "实际后台启停原因", actorSessionVersion: 7, statusAudit: { operatorId: 10, operatorName: "不可信显示名", operatorRole: "不可信角色", ipAddress: "127.0.0.1", userAgent: "mock-only" }, ...overrides });
const updateStatus = (id: number, status: "active" | "disabled" | "locked", overrides: any = {}) => updateAdminUser(id, { status, actorAdminUserId: 10, ...options(overrides) });
beforeEach(() => { process.env.DATABASE_URL = "mock://no-network-staff-status"; isolated.engine = new MemoryTransactions(); });
afterAll(() => { if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl; });

describe("Staff native status transaction (mock-only; no DB fixtures)", () => {
  it("toggles only backend status/version plus existing sales identity and commits authentic generic audit", async () => {
    const memory = isolated.engine as MemoryTransactions;
    const permissions = structuredClone(memory.rows.admin_user_permissions);
    const scopes = structuredClone(memory.rows.admin_user_sales_scopes);
    await toggleAdminUserStatus(20, "disabled", 10, options());
    expect(memory.rows.admin_users.find(a => a.id === 20)).toMatchObject({ status: "disabled", sessionVersion: 8, passwordHash: "unchanged-hash", adminRole: "merchant_mgr", phone: null });
    expect(memory.rows.sales_staff[0].status).toBe("inactive");
    expect(memory.rows.admin_user_permissions).toEqual(permissions);
    expect(memory.rows.admin_user_sales_scopes).toEqual(scopes);
    expect(memory.rows.admin_user_permission_audits).toEqual([]);
    expect(memory.rows.audit_logs).toHaveLength(1);
    expect(memory.rows.audit_logs[0]).toMatchObject({ operatorId: 10, operatorName: "后台10", operatorRole: "super_admin", action: "admin.status.update", targetId: "20", beforeValue: { status: "active", sessionVersion: 7, actorAdminUserId: 10 }, afterValue: { status: "disabled", sessionVersion: 8 }, note: "实际后台启停原因", result: "success" });
    expect(memory.rows.audit_logs[0].createdAt).toBeInstanceOf(Date);
    expect(memory.events.slice(0, 2)).toEqual(["lock:admin_users:update", "lock:admin_users:update"]);
    expect(memory.events).not.toContain("delete:admin_user_permissions");
    expect(memory.events).not.toContain("delete:admin_user_sales_scopes");
  });
  it.each([0, 2])("actual state CAS returning affectedRows=%s conflicts and rolls back without any success audit or projection", async affected => {
    const memory = isolated.engine as MemoryTransactions;
    const before = structuredClone(memory.rows);
    memory.forcedAffectedRows = affected;
    await expect(toggleAdminUserStatus(20, "disabled", 10, options())).rejects.toThrow("ADMIN_STATUS_CONFLICT");
    expect(memory.rows).toEqual(before);
    expect(memory.events).not.toContain("insert:audit_logs");
    expect(memory.events).not.toContain("update:sales_staff");
    expect(memory.casQueries).toHaveLength(1);
    expect(memory.casQueries[0].sql).toContain("`status` = ?");
    expect(memory.casQueries[0].sql).toContain("`sessionVersion` = ?");
    expect(memory.casQueries[0].params).toEqual([20, "active", 7]);
  });
  it("increments session version on re-enable without resurrecting the old epoch", async () => {
    await updateStatus(20, "disabled");
    await updateStatus(20, "active", { expectedStatus: "disabled" });
    expect(isolated.engine.rows.admin_users.find((a: any) => a.id === 20).sessionVersion).toBe(9);
    expect(isolated.engine.rows.sales_staff[0].status).toBe("active");
    expect(isolated.engine.rows.audit_logs).toHaveLength(2);
  });
  it("does not clean up super permissions or scopes on a status-only command", async () => {
    const memory = isolated.engine as MemoryTransactions;
    const before = structuredClone(memory.rows.admin_user_permissions);
    await toggleAdminUserStatus(30, "disabled", 10, options());
    expect(memory.rows.admin_user_permissions).toEqual(before);
    expect(memory.events).not.toContain("delete:admin_user_permissions");
    expect(memory.rows.admin_user_permission_audits).toEqual([]);
  });
  it("same-state command is a true no-op (no audit/version/grant/projection writes)", async () => {
    const before = structuredClone(isolated.engine.rows);
    await updateStatus(20, "active");
    expect(isolated.engine.rows).toEqual(before);
    expect(isolated.engine.events.some((event: string) => /^(update|insert|delete):/.test(event))).toBe(false);
  });
  it.each(["toggle", "generic"])("%s rejects stale baseline and both locked-to-active and locked-to-disabled unlock bypass", async route => {
    const memory = isolated.engine as MemoryTransactions;
    const run = (status: "active" | "disabled", expectedStatus: any) => route === "toggle" ? toggleAdminUserStatus(20, status, 10, options({ expectedStatus })) : updateStatus(20, status, { expectedStatus });
    await expect(run("disabled", "disabled")).rejects.toThrow("ADMIN_STATUS_CONFLICT");
    memory.rows.admin_users.find(a => a.id === 20).status = "locked";
    await expect(run("active", "locked")).rejects.toThrow("ADMIN_USER_LOCKED");
    await expect(run("disabled", "locked")).rejects.toThrow("ADMIN_USER_LOCKED");
    expect(memory.rows.audit_logs).toHaveLength(0);
  });
  it.each(["toggle", "generic"])("%s cannot disable self or the final effective non-archived super", async route => {
    const memory = isolated.engine as MemoryTransactions;
    const run = (id: number) => route === "toggle" ? toggleAdminUserStatus(id, "disabled", 10, options()) : updateStatus(id, "disabled");
    await expect(run(10)).rejects.toThrow("ADMIN_SELF_DISABLE_FORBIDDEN");
    memory.rows.admin_staff_archives.push({ id: 1, adminUserId: 10 });
    // Actor's archive is independently rejected; use a manually granted manager
    // to isolate continuity while archived active super rows remain excluded.
    memory.rows.admin_user_permissions.push({ id: 9, adminUserId: 20, permission: "admins.manage" });
    await expect(updateAdminUser(30, { status: "disabled", actorAdminUserId: 20, ...options({ statusAudit: { operatorId: 20 } }) })).rejects.toThrow("LAST_SUPER_ADMIN_FORBIDDEN");
  });
  it.each(["active", "disabled"] as const)("archive forbids status %s even with correct baseline", async status => {
    isolated.engine.rows.admin_staff_archives.push({ id: 1, adminUserId: 20 });
    await expect(updateStatus(20, status)).rejects.toThrow("ADMIN_USER_ARCHIVED");
  });
  it.each(["disabled", "archived", "demoted", "revoked-session"])("rejects an old request after actor is %s", async kind => {
    const memory = isolated.engine as MemoryTransactions;
    const actor = memory.rows.admin_users.find(a => a.id === 10);
    if (kind === "disabled") actor.status = "disabled";
    if (kind === "archived") memory.rows.admin_staff_archives.push({ id: 1, adminUserId: 10 });
    if (kind === "demoted") actor.adminRole = "merchant_mgr";
    if (kind === "revoked-session") actor.sessionVersion += 1;
    await expect(updateStatus(20, "disabled")).rejects.toThrow(kind === "revoked-session" ? "ADMIN_ACTOR_SESSION_STALE" : "ADMIN_ACTOR_FORBIDDEN");
    expect(memory.rows.admin_users.find(a => a.id === 20).status).toBe("active");
    expect(memory.rows.audit_logs).toHaveLength(0);
  });
  it("revoked explicit admins.manage grant cannot be reused by a captured old request", async () => {
    const memory = isolated.engine as MemoryTransactions;
    memory.rows.admin_users.find(a => a.id === 10).adminRole = "merchant_mgr";
    memory.rows.admin_user_permissions.push({ id: 9, adminUserId: 10, permission: "admins.manage" });
    memory.rows.admin_user_permissions = memory.rows.admin_user_permissions.filter(p => p.permission !== "admins.manage");
    await expect(updateStatus(20, "disabled")).rejects.toThrow("ADMIN_ACTOR_FORBIDDEN");
  });
  it("parallel same-baseline toggles produce one success, one conflict and one audit/version increment", async () => {
    const results = await Promise.allSettled([updateStatus(20, "disabled"), toggleAdminUserStatus(20, "disabled", 10, options())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("ADMIN_STATUS_CONFLICT");
    expect(isolated.engine.rows.admin_users.find((a: any) => a.id === 20).sessionVersion).toBe(8);
    expect(isolated.engine.rows.audit_logs).toHaveLength(1);
  });
  it("competing removals of two effective supers retain one and reject the loser under the shared super-set lock", async () => {
    isolated.engine.rows.admin_user_permissions.push({ id: 9, adminUserId: 20, permission: "admins.manage" });
    const run = (id: number) => updateAdminUser(id, { status: "disabled", actorAdminUserId: 20, ...options({ statusAudit: { operatorId: 20 } }) });
    const results = await Promise.allSettled([run(10), run(30)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("LAST_SUPER_ADMIN_FORBIDDEN");
    expect(isolated.engine.rows.admin_users.filter((a: any) => a.adminRole === "super_admin" && a.status === "active")).toHaveLength(1);
  });
  it("real generic role/grant revocation winning the transaction fence invalidates a captured old status request", async () => {
    const results = await Promise.allSettled([
      updateAdminUser(10, { adminRole: "merchant_mgr", permissions: ["merchants.read"], actorAdminUserId: 30, actorSessionVersion: 7 }),
      updateStatus(20, "disabled"),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("ADMIN_ACTOR_SESSION_STALE");
    expect(isolated.engine.rows.admin_users.find((a: any) => a.id === 20).status).toBe("active");
    expect(isolated.engine.rows.audit_logs).toHaveLength(0);
  });
  it("role/permission/password-only path retains original super permission cleanup, official grants and password revocation", async () => {
    isolated.engine.rows.admin_user_permissions.push({ id: 8, adminUserId: 10, permission: "merchants.read" });
    await updateAdminUser(10, { adminRole: "super_admin", permissions: [], passwordHash: "replacement-hash", actorAdminUserId: 30, actorSessionVersion: 7 });
    expect(isolated.engine.rows.admin_user_permissions.filter((p: any) => p.adminUserId === 10)).toEqual([{ id: 2, adminUserId: 10, permission: "officialInventory.read" }]);
    expect(isolated.engine.rows.admin_users.find((a: any) => a.id === 10)).toMatchObject({ passwordHash: "replacement-hash", sessionVersion: 8, status: "active" });
    expect(isolated.engine.rows.admin_user_permission_audits).toHaveLength(1);
    expect(isolated.engine.rows.audit_logs).toHaveLength(0);
  });
  it("audit failure rolls back status, revocation and all projections", async () => {
    const before = structuredClone(isolated.engine.rows);
    isolated.engine.failAudit = true;
    await expect(updateStatus(20, "disabled")).rejects.toThrow("AUDIT_WRITE_FAILED");
    expect(isolated.engine.rows).toEqual(before);
  });
  it("no actor, absent baseline and absent reason cannot use direct DB status bypass", async () => {
    await expect(updateAdminUser(20, { status: "disabled" })).rejects.toThrow("ADMIN_STATUS_EXPECTED_REQUIRED");
    await expect(updateStatus(20, "disabled", { reason: undefined })).rejects.toThrow("ADMIN_STATUS_REASON_REQUIRED");
    await expect(toggleAdminUserStatus(20, "disabled", undefined, options())).rejects.toThrow("ADMIN_ACTOR_FORBIDDEN");
  });
});
