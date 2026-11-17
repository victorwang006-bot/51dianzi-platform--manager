import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { createMallNewInformationReader } from "./mall";
import { createOfficialMallService } from "../officialMall";
import { assertOfficialRecordAction, loadOfficialAccess, officialActorFromContext, officialTeamPredicate } from "../officialChannelAccess";
import { ADMIN_NEW_INFORMATION_ACTIVATED_AT } from "../../../../51dianzi-platform/shared/adminNewInformationFacts";

const actor = { adminUserId: 71, sessionVersion: 4 };
const dialect = new MySqlDialect();
type Row = Record<string, any>;
/** ONLY an in-memory executor of actual Drizzle predicates. No db-module import,
 * DB connection, business write or claim to exercise MySQL physical lock semantics. */
function fixture() {
  const state: Record<string, Row[]> = {
    admin_users: [{ id: 71, adminRole: "merchant_mgr", status: "active", sessionVersion: 4 }],
    admin_user_permissions: [{ id: 1, adminUserId: 71, permission: "officialInventory.read" }],
    official_channel_teams: [{ id: 11, status: "active" }, { id: 12, status: "active" }],
    official_channel_team_members: [{ id: 1, adminUserId: 71, teamId: 11, role: "member" }],
    official_mall_materials: [
      { id: 1, teamId: 11, createdAt: new Date("2026-11-17T00:43:46.000Z"), createdByAdminUserId: 72 },
      { id: 2, teamId: 11, createdAt: new Date(ADMIN_NEW_INFORMATION_ACTIVATED_AT), createdByAdminUserId: 71 },
      { id: 3, teamId: 12, createdAt: new Date("2026-11-17T00:43:48.000Z"), createdByAdminUserId: 73 },
      { id: 4, teamId: null, createdAt: new Date("2026-11-17T00:43:49.000Z"), createdByAdminUserId: 74 },
    ],
  };
  const traces: { table: string; sql: string; params: unknown[]; fields: string[]; lock: string | undefined }[] = [];
  const configs: any[] = [];
  let snapshots = 0;
  function matches(predicate: any, ctx: Row): boolean {
    if (!predicate) return true;
    const compiled = dialect.sqlToQuery(predicate);
    const tokens = compiled.sql.match(/`[^`]+`\.`[^`]+`|\?|\(|\)|,|\b(?:and|or|in)\b|=|\d+/gi) ?? [];
    let at = 0, param = 0;
    const operand = (): any => {
      const token = tokens[at++];
      if (token === "?") return compiled.params[param++];
      const column = /^`([^`]+)`\.`([^`]+)`$/.exec(token);
      if (column) return ctx[column[1]]?.[column[2]];
      if (/^\d+$/.test(token)) return Number(token);
      throw new Error(`UNSUPPORTED:${token}:${compiled.sql}`);
    };
    const atom = (): boolean => {
      if (tokens[at] === "(") { at++; const value = expression(); if (tokens[at++] !== ")") throw new Error("PAREN"); return value; }
      const left = operand(); const op = tokens[at++]?.toLowerCase();
      if (op === "=") return left === operand();
      if (op === "in") {
        if (tokens[at++] !== "(") throw new Error("IN_PAREN");
        const values = [operand()];
        while (tokens[at] === ",") { at++; values.push(operand()); }
        if (tokens[at++] !== ")") throw new Error("IN_END");
        return values.includes(left);
      }
      throw new Error(`UNSUPPORTED_OPERATOR:${op}:${compiled.sql}`);
    };
    const conjunction = (): boolean => {
      let result = atom();
      while (tokens[at]?.toLowerCase() === "and") { at++; const next = atom(); result = result && next; }
      return result;
    };
    const expression = (): boolean => {
      let result = conjunction();
      while (tokens[at]?.toLowerCase() === "or") { at++; const next = conjunction(); result = result || next; }
      return result;
    };
    return expression();
  }
  function executor(snapshot: Record<string, Row[]>) {
    return {
      insert() { throw new Error("NO_WRITES"); }, update() { throw new Error("NO_WRITES"); }, delete() { throw new Error("NO_WRITES"); },
      select(fields: Row) {
        let table: any, where: any, limit = Infinity, lock: string | undefined;
        const joins: { table: any; on: any }[] = [];
        const q: any = {
          from(t: any) { table = t; return q; }, where(p: any) { where = p; return q; },
          limit(n: number) { limit = n; return q; }, for(mode: string) { lock = mode; return q; }, orderBy() { return q; },
          innerJoin(t: any, on: any) { joins.push({ table: t, on }); return q; },
          then(resolve: any, reject: any) {
            try {
              const name = getTableName(table);
              const compiled = where ? dialect.sqlToQuery(where) : { sql: "", params: [] };
              traces.push({ table: name, ...compiled, fields: Object.keys(fields), lock });
              let contexts: Row[] = (snapshot[name] ?? []).map(row => ({ [name]: row }));
              for (const join of joins) {
                const joinName = getTableName(join.table);
                contexts = contexts.flatMap(ctx => (snapshot[joinName] ?? []).map(row => ({ ...ctx, [joinName]: row })).filter(ctx => matches(join.on, ctx)));
              }
              const rows = contexts.filter(ctx => matches(where, ctx)).slice(0, limit).map(ctx => Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, ctx[getTableName(column.table)]?.[column.name]])));
              return Promise.resolve(rows).then(resolve, reject);
            } catch (error) { return Promise.reject(error).then(resolve, reject); }
          },
        };
        return q;
      },
    };
  }
  const getDb = vi.fn(async () => ({ transaction: async (run: any, config: any) => {
    configs.push(config); snapshots++;
    return run(executor(structuredClone(state)));
  } }));
  const deps = { getDb, loadOfficialAccess, assertOfficialRecordAction, officialTeamPredicate };
  return { state, traces, configs, getDb, deps, reader: createMallNewInformationReader(deps), snapshots: () => snapshots };
}

describe("native mall new information facts", () => {
  it("scans all same-team rows without paging; strict minimal physical IDs and actor evidence", async () => {
    const f = fixture();
    f.state.official_mall_materials.push(...Array.from({ length: 130 }, (_, i) => ({ id: 10 + i, teamId: 11, createdAt: new Date("2026-11-17T00:45:00Z"), createdByAdminUserId: 72 })));
    const read = await f.reader.read(actor);
    expect(read.items).toHaveLength(132);
    expect(read.items[0]).toEqual({ id: "mall-material:1", version: "created:2026-11-17T00:43:46.000Z", occurredAt: "2026-11-17T00:43:46.000Z", historical: true, actorKey: "admin:72" });
    expect(read.items[1]).toMatchObject({ historical: false, actorKey: "admin:71" });
    expect(read.scope).toMatchObject({ identity: "admin:71", actorKey: "admin:71" });
    const trace = f.traces.find(t => t.table === "official_mall_materials")!;
    expect(trace.sql).toContain("`official_mall_materials`.`teamId` = ?");
    expect(trace.fields).toEqual(["id", "createdAt", "createdByAdminUserId"]);
    expect(trace.lock).toBeUndefined();
    expect(f.snapshots()).toBe(1);
    expect(f.getDb).toHaveBeenCalledOnce();
    expect(f.configs).toEqual([{ isolationLevel: "repeatable read" }]);
    expect(f.traces.filter(t => t.table === "official_mall_materials")).toHaveLength(1);
  });
  it("looks up SQL scope AND exact requested IDs, never foreign team or NULL legacy rows", async () => {
    const f = fixture();
    const read = await f.reader.read(actor, { refs: ["mall-material:2", "mall-material:3", "mall-material:4", "mall-material:2", "inventory:1"] });
    expect(read.items.map(i => i.id)).toEqual(["mall-material:2"]);
    const trace = f.traces.find(t => t.table === "official_mall_materials")!;
    expect(trace.sql).toMatch(/teamId.*and.*id.*in/);
    expect(trace.params).toEqual([11, 2, 3, 4]);
    expect(read.scope).toEqual((await f.reader.read(actor)).scope);
  });
  it("empty and malformed refs are an empty intersection, never an unbounded scan", async () => {
    for (const refs of [[], ["mall-material:01", "mall-material:-1", "mall-material:2147483648", "mall-material:2:fake", "official-mall:1"]]) {
      const f = fixture(); expect((await f.reader.read(actor, { refs })).items).toEqual([]);
      expect(f.traces.find(t => t.table === "official_mall_materials")!.sql).toContain("1 = 0");
    }
  });
  it.each(["since", "until", "actor", "adminUserId", "teamId", "merchantId", "scope"])("rejects client %s before any DB access", async key => {
    const f = fixture(); await expect(f.reader.read(actor, { [key]: "untrusted" } as any)).rejects.toThrow(); expect(f.getDb).not.toHaveBeenCalled();
  });
  it("rejects over-limit refs and non-array input before DB access", async () => {
    const f = fixture();
    await expect(f.reader.read(actor, { refs: Array.from({ length: 101 }, () => "mall-material:1") })).rejects.toThrow();
    await expect(f.reader.read(actor, { refs: "mall-material:1" } as any)).rejects.toThrow();
    expect(f.getDb).not.toHaveBeenCalled();
  });
  it.each(["disabled", "session", "permission", "no-team", "archived-team"])("original native authorization fails closed for %s before facts SELECT", async denial => {
    const f = fixture();
    if (denial === "disabled") f.state.admin_users[0].status = "disabled";
    if (denial === "session") f.state.admin_users[0].sessionVersion = 5;
    if (denial === "permission") f.state.admin_user_permissions = [];
    if (denial === "no-team") f.state.official_channel_team_members = [];
    if (denial === "archived-team") f.state.official_channel_teams[0].status = "archived";
    await expect(f.reader.read(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.traces.some(t => t.table === "official_mall_materials")).toBe(false);
  });
  it("real native super_admin reads teams and NULL rows; OAuth alone is never an actor", async () => {
    const f = fixture(); f.state.admin_users[0].adminRole = "super_admin";
    expect((await f.reader.read(actor)).items.map(i => i.id)).toEqual(["mall-material:1", "mall-material:2", "mall-material:3", "mall-material:4"]);
    expect(() => officialActorFromContext({ user: { id: 71, role: "admin" } } as any)).toThrow();
  });
  it("ordinary edit/updater/owner/publication/revision do not alter immutable events or snapshot", async () => {
    const f = fixture(); const first = await f.reader.read(actor);
    Object.assign(f.state.official_mall_materials[0], { revision: 55, updatedAt: new Date(), ownerAdminUserId: 71, updatedByAdminUserId: 71, publishedByAdminUserId: 71, publishedAt: new Date(), note: "NOT_EXPOSED", partNumber: "NOT_EXPOSED" });
    expect(await f.reader.read(actor)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("NOT_EXPOSED");
  });
  it("authority changes update scope; each call reloads current team and grants", async () => {
    const f = fixture(); const first = await f.reader.read(actor);
    f.state.official_channel_team_members[0].teamId = 12;
    const next = await f.reader.read(actor);
    expect(next.items.map(i => i.id)).toEqual(["mall-material:3"]);
    expect(next.scope.version).not.toBe(first.scope.version);
    expect(next.snapshot).not.toBe(first.snapshot);
  });
  it("uses a consistent transaction result even if new backing rows appear during access reload", async () => {
    const f = fixture();
    const reload = vi.fn(async (...args: Parameters<typeof loadOfficialAccess>) => {
      const access = await loadOfficialAccess(...args);
      f.state.official_mall_materials.push({ id: 99, teamId: 11, createdAt: new Date("2026-11-17T00:46:00Z"), createdByAdminUserId: 72 });
      return access;
    });
    const reader = createMallNewInformationReader({ ...f.deps, loadOfficialAccess: reload });
    expect((await reader.read(actor)).items.map(i => i.id)).toEqual(["mall-material:1", "mall-material:2"]);
    expect((await f.reader.read(actor)).items.map(i => i.id)).toContain("mall-material:99");
  });
  it("createdAt native +08 timestamp is normalized; malformed times fail instead of partial facts", async () => {
    const f = fixture(); f.state.official_mall_materials[0].createdAt = new Date("2026-11-17T08:43:47+08:00");
    expect((await f.reader.read(actor)).items[0]).toMatchObject({ occurredAt: ADMIN_NEW_INFORMATION_ACTIVATED_AT, historical: false });
    f.state.official_mall_materials[0].createdAt = "2026-11-17 08:43:47";
    await expect(f.reader.read(actor)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("does not guess creator from owner or updater if creator evidence is invalid", async () => {
    const f = fixture(); Object.assign(f.state.official_mall_materials[0], { createdByAdminUserId: 0, ownerAdminUserId: 71, updatedByAdminUserId: 71 });
    expect((await f.reader.read(actor)).items[0]).not.toHaveProperty("actorKey");
  });
  it("propagates missing DB rather than an available empty placeholder", async () => {
    const f = fixture(); const reader = createMallNewInformationReader({ ...f.deps, getDb: async () => null });
    await expect(reader.read(actor)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("internal service method validates native numeric IDs and keeps four-dependency ABI", async () => {
    const f = fixture(); const service = createOfficialMallService(f.deps);
    await expect(service.readNewInformationFacts(actor, [-1])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.getDb).not.toHaveBeenCalled();
    const source = readFileSync(new URL("./mall.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*\/db["']|business-trpc|list\.query|officialMallPublic/);
    const serviceSource = readFileSync(new URL("../officialMall.ts", import.meta.url), "utf8");
    const narrow = serviceSource.split("async readNewInformationFacts(")[1].split("async list(")[0];
    expect(narrow).not.toMatch(/\.limit\(|\.offset\(|\.insert\(|\.update\(|\.delete\(|count\(\*\)/);
  });
});
