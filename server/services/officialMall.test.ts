import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("../db", () => ({
  getDb: vi.fn(() => {
    throw new Error("NO_SQL_ALLOWED");
  }),
}));
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  assertOfficialRecordAction,
  loadOfficialAccess,
  officialActorFromContext,
  officialTeamPredicate,
} from "./officialChannelAccess";
import { createOfficialMallRouters } from "../routers/officialMall";
import {
  createOfficialMallService as sourceCreateOfficialMallService,
  officialMallTestUtils,
  publicProjection,
  validateOfficialMallMaterial,
} from "./officialMall";
import { adminUsers, adminUserPermissions, materials as catalog } from "../../drizzle/schema";
import { officialChannelTeams, officialChannelTeamMembers } from "../../drizzle/officialChannelSchema";
const createOfficialMallService = process.env.MALL_REPAIR_RUNTIME
  ? (await import(process.env.MALL_REPAIR_RUNTIME)).createOfficialMallRuntime({
      router, adminProcedure, publicProcedure, getDb: async () => { throw Error("NO_REAL_SQL_ALLOWED"); },
      loadOfficialAccess, assertOfficialRecordAction, officialTeamPredicate, officialActorFromContext,
      adminUsers, adminUserPermissions, materials: catalog, officialChannelTeams, officialChannelTeamMembers,
    }).createService as typeof sourceCreateOfficialMallService
  : sourceCreateOfficialMallService;

const actor = { adminUserId: 71, sessionVersion: 4 };
const base = () =>
  validateOfficialMallMaterial({
    partNumber: "LOCAL_TEST_PART",
    brand: "LOCAL_TEST_BRAND",
  });
const full = () =>
  validateOfficialMallMaterial({
    ...base(),
    qtyOnSale: 100,
    qtyStock: 100,
    leadTime: "3-5个工作日",
    priceEx: "10.123456",
    taxIncluded: true,
    moq: 10,
    spq: 10,
    ladderPrices: [
      { minQty: 10, price: "10.123456" },
      { minQty: 100, price: "9.000001" },
    ],
  });
const dialect = new MySqlDialect();

/** Small in-memory executor of actual Drizzle predicates. It is NOT a SQL database
 * or evidence of MySQL lock semantics. It exercises service flow/rollback/replays
 * with a deterministic transaction mutex, and rejects unsupported predicates. */
function memoryDb() {
  type Row = Record<string, any>;
  type State = Record<string, Row[]>;
  let state: State = {
    admin_users: [
      {
        id: 71,
        adminRole: "merchant_mgr",
        status: "active",
        sessionVersion: 4,
      },
    ],
    admin_user_permissions: [
      "officialInventory.read",
      "officialInventory.write",
      "officialInventory.publish",
    ].map((permission, id) => ({ id: id + 1, adminUserId: 71, permission })),
    official_channel_teams: [
      { id: 11, name: "LOCAL_TEST_TEAM", status: "active" },
      { id: 12, name: "OTHER_LOCAL_TEAM", status: "active" },
    ],
    official_channel_team_members: [
      { id: 1, adminUserId: 71, teamId: 11, role: "member" },
    ],
    official_mall_materials: [],
    official_mall_publications: [],
    official_mall_requests: [],
    materials: [],
  };
  const traces: {
    table: string;
    sql: string;
    params: unknown[];
    lock: boolean;
    fields?: string[];
    inTransaction: boolean;
    limit: number;
    grouped: boolean;
    indexHint?: any;
  }[] = [];
  const transactions: any[] = [];
  let tail = Promise.resolve();
  let catalogBarrier: (() => Promise<void>) | undefined;
  function fieldValue(field: any, context: Row) {
    return context[getTableName(field.table)]?.[field.name];
  }
  function matches(predicate: any, context: Row): boolean {
    if (!predicate) return true;
    const compiled = dialect.sqlToQuery(predicate);
    let param = 0;
    const tokens =
      compiled.sql.match(
        /`[^`]+`\.`[^`]+`|\?|\(|\)|\b(?:and|or|like|is|not|null)\b|<>|=|\d+/gi
      ) ?? [];
    let at = 0;
    function operand(): any {
      const token = tokens[at++];
      if (token === "?") return compiled.params[param++];
      const found = /^`([^`]+)`\.`([^`]+)`$/.exec(token);
      if (found) return context[found[1]]?.[found[2]];
      if (/^\d+$/.test(token)) return Number(token);
      throw new Error(`UNSUPPORTED_OPERAND:${token}:${compiled.sql}`);
    }
    function atom(): boolean {
      if (tokens[at] === "(") {
        at++;
        const value = expression();
        if (tokens[at++] !== ")") throw new Error("PAREN");
        return value;
      }
      const left = operand();
      const op = tokens[at++];
      if (op?.toLowerCase() === "is") {
        if (
          tokens[at++]?.toLowerCase() !== "not" ||
          tokens[at++]?.toLowerCase() !== "null"
        )
          throw new Error("UNSUPPORTED_NULL_PREDICATE");
        return left !== null && left !== undefined;
      }
      const right = operand();
      if (op === "=") return left === right;
      if (op === "<>") return left != null && left !== right;
      if (op?.toLowerCase() === "like") {
        const pattern = String(right), literal = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let regex = "^";
        for (let i = 0; i < pattern.length; i++) {
          const char = pattern[i];
          regex += char === "\\" && i + 1 < pattern.length ? literal(pattern[++i]) : char === "%" ? ".*" : char === "_" ? "." : literal(char);
        }
        return new RegExp(regex + "$", "iu").test(String(left ?? ""));
      }
      throw new Error(`UNSUPPORTED_OPERATOR:${op}`);
    }
    function conjunction(): boolean {
      let value = atom();
      while (tokens[at]?.toLowerCase() === "and") {
        at++;
        const next = atom();
        value = value && next;
      }
      return value;
    }
    function expression(): boolean {
      let value = conjunction();
      while (tokens[at]?.toLowerCase() === "or") {
        at++;
        const next = conjunction();
        value = value || next;
      }
      return value;
    }
    return expression();
  }
  function executor(local: State, inTransaction = false): any {
    return {
      select(fields?: Row) {
        let table: any;
        let indexHint: any;
        let where: any;
        let limit = Infinity;
        let offset = 0;
        let lock = false;
        let grouped = false;
        const joins: { table: any; on: any }[] = [];
        const q: any = {
          from(t: any, hint?: any) {
            table = t;
            indexHint = hint;
            return q;
          },
          where(p: any) {
            where = p;
            return q;
          },
          limit(n: number) {
            limit = n;
            return q;
          },
          offset(n: number) {
            offset = n;
            return q;
          },
          for(mode: string) {
            if (mode !== "update") throw new Error("LOCK_MODE");
            lock = true;
            return q;
          },
          orderBy() {
            return q;
          },
          groupBy() {
            grouped = true;
            return q;
          },
          innerJoin(t: any, on: any) {
            joins.push({ table: t, on });
            return q;
          },
          async then(resolve: any, reject: any) {
            try {
              const name = getTableName(table);
              if (name === "materials" && catalogBarrier) await catalogBarrier();
              const compiled = where
                ? dialect.sqlToQuery(where)
                : { sql: "", params: [] };
              traces.push({
                table: name,
                ...compiled,
                lock,
                inTransaction, limit, grouped, indexHint,
                fields:
                  fields && Object.values(fields).map(field => field.name),
              });
              let contexts: Row[] = (local[name] ?? []).map(row => ({
                [name]: row,
              }));
              for (const join of joins) {
                const joinName = getTableName(join.table);
                contexts = contexts.flatMap(context =>
                  (local[joinName] ?? [])
                    .map(row => ({ ...context, [joinName]: row }))
                    .filter(context => matches(join.on, context))
                );
              }
              contexts = contexts.filter(context => matches(where, context));
              if (fields?.total)
                return Promise.resolve([{ total: contexts.length }]).then(
                  resolve,
                  reject
                );
              let rows = contexts.map(context =>
                fields
                  ? Object.fromEntries(
                      Object.entries(fields).map(([key, field]) => [
                        key,
                        fieldValue(field, context),
                      ])
                    )
                  : { ...context[name] }
              );
              if (grouped)
                rows = Array.from(
                  new Map(rows.map(row => [JSON.stringify(row), row])).values()
                );
              return Promise.resolve(rows.slice(offset, offset + limit)).then(
                resolve,
                reject
              );
            } catch (error) {
              return Promise.reject(error).then(resolve, reject);
            }
          },
        };
        return q;
      },
      insert(table: any) {
        const name = getTableName(table);
        return {
          values(value: Row) {
            const id = Math.max(0, ...local[name].map(row => row.id ?? 0)) + 1;
            const row =
              name === "official_mall_materials"
                ? { createdAt: new Date(), updatedAt: new Date(), ...value, id }
                : { ...value, id };
            const insert = () => {
              if (
                name === "official_mall_requests" &&
                local[name].some(
                  r =>
                    r.actorAdminUserId === row.actorAdminUserId &&
                    r.requestId === row.requestId
                )
              )
                throw new Error("DUPLICATE_LEDGER");
              local[name].push(row);
            };
            return {
              $returningId: async () => {
                insert();
                return [{ id }];
              },
              then(resolve: any, reject: any) {
                try {
                  insert();
                  return Promise.resolve().then(resolve, reject);
                } catch (e) {
                  return Promise.reject(e).then(resolve, reject);
                }
              },
            };
          },
        };
      },
      update(table: any) {
        const name = getTableName(table);
        return {
          set(value: Row) {
            return {
              where: async (where: any) => {
                for (const row of local[name])
                  if (matches(where, { [name]: row }))
                    Object.assign(row, value);
              },
            };
          },
        };
      },
      delete(table: any) {
        const name = getTableName(table);
        return {
          where: async (where: any) => {
            local[name] = local[name].filter(
              row => !matches(where, { [name]: row })
            );
          },
        };
      },
    };
  }
  const db: any = {
    select(...args: any[]) {
      return executor(state).select(...args);
    },
    transaction(run: (tx: any) => Promise<any>, config: any) {
      transactions.push(config);
      const task = tail.then(async () => {
        const local = structuredClone(state);
        const result = await run(executor(local, true));
        state = local;
        return result;
      });
      tail = task.then(
        () => undefined,
        () => undefined
      );
      return task;
    },
  };
  const deps = {
    getDb: async () => db,
    loadOfficialAccess,
    assertOfficialRecordAction,
    officialTeamPredicate,
  };
  return {
    service: createOfficialMallService(deps),
    deps,
    rows: (name: string) => state[name],
    traces,
    transactions,
    setCatalogBarrier: (barrier?: () => Promise<void>) => { catalogBarrier = barrier; },
  };
}
function seed(
  memory: ReturnType<typeof memoryDb>,
  changes: Record<string, unknown> = {}
) {
  const rows = memory.rows("official_mall_materials");
  const id = rows.length + 1;
  rows.push({
    ...base(),
    id,
    publicId: `OM_00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    teamId: 11,
    ownerAdminUserId: 71,
    createdByAdminUserId: 71,
    updatedByAdminUserId: 71,
    publishedByAdminUserId: null,
    status: "draft",
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    ...changes,
  });
  return id;
}

describe("officialMall final gate and safe projection (offline only)", () => {
  it("defaults preserve unknown quantities/prices and never guess date code", () => {
    expect(base()).toMatchObject({
      qtyOnSale: null,
      qtyStock: null,
      qtyOrder: null,
      priceEx: null,
      taxIncluded: null,
      moq: null,
      spq: null,
      dateCode: "",
      ladderPrices: [],
    });
  });
  it("rejects malformed/unsafe quantities, prices, tier order, invalid MOQ/SPQ and impossible lead time with clear errors", () => {
    for (const patch of [
      { qtyOnSale: -1 },
      { qtyOrder: 1.5 },
      { qtyStock: 2147483648 },
      { qtyStock: 3, qtyOnSale: 4 },
      { priceEx: "1e2" },
      { priceEx: "0" },
      { priceEx: "1.1234567" },
      { moq: 0 },
      { spq: 0 },
      { moq: 2147483648 },
      { spq: 1.5 },
      {
        ladderPrices: [
          { minQty: 2, price: "1" },
          { minQty: 2, price: "1" },
        ],
      },
      { priceEx: "1", ladderPrices: [{ minQty: 1, price: "2" }] },
      { ladderPrices: [{ minQty: 0, price: "2" }] },
      { ladderPrices: [{ minQty: 1, price: "0" }] },
      { ladderPrices: [{ minQty: 1.5, price: "2" }] },
      { ladderPrices: [{ minQty: 2147483648, price: "2" }] },
      {
        ladderPrices: [
          { minQty: 10, price: "2" },
          { minQty: 9, price: "1" },
        ],
      },
      {
        ladderPrices: [
          { minQty: 10, price: "1" },
          { minQty: 20, price: "2" },
        ],
      },
      { leadTime: "现货立发", qtyStock: 0, qtyOnSale: 0 },
    ])
      expect(() =>
        validateOfficialMallMaterial({ ...base(), ...patch })
      ).toThrow();
    expect(() =>
      validateOfficialMallMaterial({ ...base(), leadTime: "现货" })
    ).toThrow("数量未确认");
    expect(full().priceEx).toBe("10.123456");
    expect(
      officialMallTestUtils.exactPrice("999999999999.999999") -
        officialMallTestUtils.exactPrice("999999999999.999998")
    ).toBe(BigInt(1));
  });
  it("preserves MOQ 999/SPQ 250 and thresholds below MOQ or outside packaging multiples", () => {
    const input = {
      ...base(),
      moq: 999,
      spq: 250,
      priceEx: "3",
      ladderPrices: [
        { minQty: 100, price: "2" },
        { minQty: 1000, price: "1" },
      ],
    };
    const data = validateOfficialMallMaterial(input);
    expect(data).toEqual(input);
    const minimumPurchase = Math.ceil(data.moq! / data.spq!) * data.spq!;
    expect(minimumPurchase).toBe(1000);
    expect(
      data.ladderPrices.filter(tier => tier.minQty <= minimumPurchase).at(-1)
        ?.price
    ).toBe("1");
    expect(
      validateOfficialMallMaterial({
        ...input,
        ladderPrices: [{ minQty: 101, price: "2" }],
      }).ladderPrices
    ).toEqual([{ minQty: 101, price: "2" }]);
  });
  it("public whitelist strips private fields without hiding real inquiry quotes", () => {
    const projected = publicProjection(
      {
        ...full(),
        publicId: "OM_00000000-0000-4000-8000-000000000001",
        revision: 2,
        teamId: 11,
        ownerAdminUserId: 71,
        note: "PRIVATE",
        supplierId: 7,
        importRows: ["PRIVATE"],
      } as any,
      new Date().toISOString()
    );
    expect(projected.priceEx).toBe("10.123456");
    for (const key of [
      "id",
      "teamId",
      "ownerAdminUserId",
      "note",
      "supplierId",
      "importRows",
    ])
      expect(projected).not.toHaveProperty(key);
    expect(
      publicProjection(
        {
          ...full(),
          taxIncluded: null,
          publicId: projected.publicId,
          revision: 2,
        },
        projected.publishedAt
      )
    ).toMatchObject({
      priceEx: full().priceEx,
      taxIncluded: null,
      ladderPrices: full().ladderPrices,
    });
  });
  it("public projection preserves a complete ladder with no base price", () => {
    const data = { ...full(), priceEx: null };
    const projected = publicProjection(
      {
        ...data,
        publicId: "OM_00000000-0000-4000-8000-000000000001",
        revision: 2,
      },
      new Date().toISOString()
    );
    expect(projected).toMatchObject({
      priceEx: null,
      taxIncluded: true,
      ladderPrices: data.ladderPrices,
    });
    expect(Object.keys(projected)).not.toEqual(
      expect.arrayContaining(["purchasable", "canPurchase", "purchaseFlag"])
    );
  });
  it("unknown tax preserves base and all ladder prices exactly, including excluded-tax state", () => {
    for (const taxIncluded of [null, false]) {
      const projected = publicProjection(
        {
          ...full(),
          taxIncluded,
          publicId: "OM_00000000-0000-4000-8000-000000000001",
          revision: 2,
        },
        new Date().toISOString()
      );
      expect(projected.priceEx).toBe(full().priceEx);
      expect(projected.taxIncluded).toBe(taxIncluded);
      expect(projected.ladderPrices).toEqual(full().ladderPrices);
      expect(projected).not.toHaveProperty("purchasable");
    }
  });
  it("payload hashes bind actor, action and original body but tolerate object-key order", () => {
    const hash = officialMallTestUtils.payloadHash("create", actor, {
      a: 1,
      b: 2,
    });
    expect(hash).toBe(
      officialMallTestUtils.payloadHash("create", actor, { b: 2, a: 1 })
    );
    expect(hash).not.toBe(
      officialMallTestUtils.payloadHash("update", actor, { a: 1, b: 2 })
    );
    expect(hash).not.toBe(
      officialMallTestUtils.payloadHash(
        "create",
        { ...actor, adminUserId: 72 },
        { a: 1, b: 2 }
      )
    );
  });
  it("suggestion match status distinguishes exact / multiple / unmatched without filling missing data", () => {
    expect(
      officialMallTestUtils.matchStatus(base(), [
        { partNumber: base().partNumber, brand: base().brand, pkg: "" },
      ])
    ).toBe("exact");
    expect(
      officialMallTestUtils.matchStatus(base(), [
        { partNumber: base().partNumber, brand: base().brand, pkg: "A" },
        { partNumber: base().partNumber, brand: base().brand, pkg: "B" },
      ])
    ).toBe("multiple");
    expect(officialMallTestUtils.matchStatus(base(), [])).toBe("unmatched");
    expect(base().pkg).toBe("");
  });
});

describe("officialMall native transaction flow (in-memory executor, no SQL)", () => {
  it("uses real local identity guards: OAuth, stale session, disabled account and absent grants fail closed", async () => {
    const memory = memoryDb();
    expect(() =>
      officialActorFromContext({
        user: { role: "admin" },
        adminAccount: null,
      } as any)
    ).toThrow();
    await expect(
      memory.service.create(
        { ...actor, sessionVersion: 3 },
        { requestId: "local-test-stale", data: base() }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    memory.rows("admin_users")[0].status = "disabled";
    await expect(
      memory.service.create(actor, {
        requestId: "local-test-disabled",
        data: base(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    memory.rows("admin_users")[0].status = "active";
    memory.rows("admin_user_permissions").splice(0);
    expect(await memory.service.status(actor)).toMatchObject({
      available: false,
      permissions: { write: false, publish: false },
    });
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
  });
  it("creates trusted-owner draft only, locks local account/grants/team and uses local RR", async () => {
    const memory = memoryDb();
    const result = await memory.service.create(actor, {
      requestId: "local-test-create",
      data: base(),
    });
    expect(result).toMatchObject({
      success: true,
      revision: 1,
      status: "draft",
    });
    expect(memory.rows("official_mall_materials")[0]).toMatchObject({
      teamId: 11,
      ownerAdminUserId: 71,
      status: "draft",
    });
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
    for (const table of [
      "admin_users",
      "admin_user_permissions",
      "official_channel_team_members",
      "official_channel_teams",
    ])
      expect(
        memory.traces.some(trace => trace.table === table && trace.lock)
      ).toBe(true);
    expect(memory.transactions[0]).toEqual({
      isolationLevel: "repeatable read",
    });
    await expect(
      memory.service.create(actor, {
        requestId: "local-test-other-team",
        teamId: 12,
        data: base(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("same original UUID concurrent create yields one ID/receipt; different body conflicts", async () => {
    const memory = memoryDb();
    const input = { requestId: "local-test-concurrent", data: base() };
    const [a, b] = await Promise.all([
      memory.service.create(actor, input),
      memory.service.create(actor, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(b.idempotent).toBe(true);
    expect(memory.rows("official_mall_materials")).toHaveLength(1);
    expect(memory.rows("official_mall_requests")).toHaveLength(1);
    expect(memory.rows("official_mall_requests")[0]).toMatchObject({
      state: "completed",
      result: a,
    });
    await expect(
      memory.service.create(actor, {
        ...input,
        data: { ...base(), note: "different" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await memory.service.requestStatus(actor, { requestId: input.requestId })
    ).toMatchObject({ state: "completed", result: { id: a.id } });
    expect(
      await memory.service.requestStatus(actor, {
        requestId: "unknown-original-uuid",
      })
    ).toEqual({ state: "not_found", result: null });
  });
  it("cross-team/private-owner scope is checked in SQL; revoked session blocks even UUID replay", async () => {
    const memory = memoryDb();
    seed(memory, { teamId: 12, note: "OTHER_TEAM_SECRET" });
    seed(memory, { ownerAdminUserId: 72 });
    const list = await memory.service.list(actor, {});
    expect(list.items).toHaveLength(1);
    expect(
      memory.traces
        .filter(trace => trace.table === "official_mall_materials")
        .every(trace => trace.sql.includes("`teamId` = ?"))
    ).toBe(true);
    await expect(
      memory.service.update(actor, {
        id: 1,
        expectedRevision: 1,
        requestId: "local-test-cross",
        data: base(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      memory.service.update(actor, {
        id: 2,
        expectedRevision: 1,
        requestId: "local-test-owner",
        data: base(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    memory.rows("official_channel_team_members")[0].role = "leader";
    expect(
      await memory.service.update(actor, {
        id: 2,
        expectedRevision: 1,
        requestId: "local-test-leader",
        data: base(),
      })
    ).toMatchObject({ revision: 2 });
    memory.rows("admin_users")[0].sessionVersion = 5;
    await expect(
      memory.service.update(actor, {
        id: 2,
        expectedRevision: 1,
        requestId: "local-test-leader",
        data: base(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("published edit requires explicit offshelf; public join rejects stale revision and disappears on offshelf", async () => {
    const memory = memoryDb();
    const id = seed(memory, full());
    const published = await memory.service.publish(actor, {
      id,
      expectedRevision: 1,
      requestId: "local-test-publish",
    });
    expect(published).toMatchObject({ revision: 2, status: "published" });
    expect((await memory.service.publicList({})).items).toHaveLength(1);
    const publicId = memory.rows("official_mall_materials")[0].publicId;
    expect(
      (await memory.service.publicDetail({ publicId })).item
    ).not.toBeNull();
    await expect(
      memory.service.update(actor, {
        id,
        expectedRevision: 2,
        requestId: "local-test-edit-published",
        data: base(),
      })
    ).rejects.toThrow("先显式下架");
    memory.rows("official_mall_publications")[0].revision = 1;
    expect((await memory.service.publicDetail({ publicId })).item).toBeNull();
    memory.rows("official_mall_publications")[0].revision = 2;
    await memory.service.offshelf(actor, {
      id,
      expectedRevision: 2,
      requestId: "local-test-offshelf",
    });
    expect((await memory.service.publicList({})).items).toHaveLength(0);
    expect((await memory.service.publicDetail({ publicId })).item).toBeNull();
    expect(
      await memory.service.update(actor, {
        id,
        expectedRevision: 3,
        requestId: "local-test-edit-draft",
        data: base(),
      })
    ).toMatchObject({ status: "draft", revision: 4 });
  });
  it("bulk role/scope failure rolls back all; revision errors are explicit per-row", async () => {
    const memory = memoryDb();
    const own = seed(memory, full());
    const other = seed(memory, { ...full(), ownerAdminUserId: 72 });
    await expect(
      memory.service.bulkAction(actor, {
        action: "publish",
        requestId: "local-test-bulk-denied",
        items: [
          { id: own, expectedRevision: 1 },
          { id: other, expectedRevision: 1 },
        ],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      memory
        .rows("official_mall_materials")
        .every(row => row.status === "draft")
    ).toBe(true);
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
    memory.rows("official_channel_team_members")[0].role = "leader";
    const result = await memory.service.bulkAction(actor, {
      action: "publish",
      requestId: "local-test-bulk-revision",
      items: [
        { id: own, expectedRevision: 2 },
        { id: other, expectedRevision: 1 },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      successful: 1,
      errors: [{ id: own, message: expect.stringContaining("版本已变化") }],
    });
  });
  it("preview validates each row, identifies file duplicates, hides other-team duplicates and suggests metadata only", async () => {
    const memory = memoryDb();
    seed(memory);
    seed(memory, { teamId: 12 });
    const result = await memory.service.importPreview(actor, {
      rows: [
        { rowNumber: 1, data: base() },
        { rowNumber: 2, data: base() },
        { rowNumber: 3, data: { partNumber: "" } },
      ],
    });
    expect(result.rows[0]).toMatchObject({
      duplicates: [{ id: 1, revision: 1 }],
      matchStatus: "exact",
    });
    expect(result.rows[1].errors[0]).toContain("第 1 行");
    expect(result.rows[2].errors.length).toBeGreaterThan(0);
    expect(
      await memory.service.suggest(actor, { query: "LOCAL_TEST" })
    ).toEqual({
      items: [{ partNumber: base().partNumber, brand: base().brand, pkg: "" }],
    });
    for (const trace of memory.traces.filter(
      trace => trace.table === "official_mall_materials"
    ))
      expect(trace.sql).toContain("`teamId` = ?");
  });
  it("enabled catalog fills an empty official table with metadata-only suggestions and exact preview, never quantities/prices", async () => {
    const memory = memoryDb();
    const catalog = {
      id: 901,
      materialNo: "LOCAL_PRIVATE_MATERIAL_NO",
      partNumber: base().partNumber,
      brand: base().brand,
      package: "SOT23",
      status: "enabled",
      description: "CATALOG_PRIVATE_DESCRIPTION",
      referencePrice: "999",
      images: [{ url: "CATALOG_PRIVATE_PHOTO" }],
      qtyStock: 999,
      notes: "CATALOG_PRIVATE_NOTES",
      customerId: 999,
    };
    memory.rows("materials").push(catalog);
    const candidate = {
      partNumber: catalog.partNumber,
      brand: catalog.brand,
      pkg: "SOT23",
    };
    expect(
      await memory.service.suggest(actor, { query: base().partNumber })
    ).toEqual({ items: [candidate] });
    const data = base();
    const preview = await memory.service.importPreview(actor, {
      rows: [{ rowNumber: 1, data }],
    });
    expect(preview.rows[0]).toMatchObject({
      data,
      duplicates: [],
      matches: [candidate],
      matchStatus: "exact",
      errors: [],
    });
    expect(preview.rows[0].data).toEqual(data);
    expect(preview.rows[0].data).toMatchObject({
      qtyStock: null,
      priceEx: null,
      pkg: "",
      dateCode: "",
    });
    expect(memory.rows("official_mall_materials")).toEqual([]);
    expect(memory.rows("official_mall_requests")).toEqual([]);
    expect(memory.rows("materials")).toEqual([catalog]);
    const traces = memory.traces.filter(trace => trace.table === "materials");
    expect(traces).toHaveLength(2);
    for (const trace of traces) {
      expect(trace.fields).toEqual(["partNumber", "brand", "package", "status"]);
      expect(trace.params).not.toContain("enabled");
      expect(trace.limit).toBe(80);
      expect(trace.indexHint).toEqual({ forceIndex: ["idx_materials_partNumber"] });
      expect(trace.lock).toBe(false);
    }
  });
  it("disabled catalog and null/empty brands never become candidates or guessed import brands", async () => {
    const memory = memoryDb();
    memory
      .rows("materials")
      .push(
        {
          partNumber: base().partNumber,
          brand: base().brand,
          package: "DISABLED",
          status: "disabled",
        },
        {
          partNumber: base().partNumber,
          brand: null,
          package: "NULL_BRAND",
          status: "enabled",
        },
        {
          partNumber: base().partNumber,
          brand: "",
          package: "EMPTY_BRAND",
          status: "enabled",
        },
        {
          partNumber: base().partNumber,
          brand: "   ",
          package: "BLANK_BRAND",
          status: "enabled",
        }
      );
    expect(
      await memory.service.suggest(actor, { query: base().partNumber })
    ).toEqual({ items: [] });
    const preview = await memory.service.importPreview(actor, {
      rows: [{ rowNumber: 1, data: base() }],
    });
    expect(preview.rows[0]).toMatchObject({
      data: base(),
      matches: [],
      matchStatus: "unmatched",
    });
    expect(preview.rows[0].data).toEqual(base());
    memory
      .rows("materials")
      .push({
        partNumber: base().partNumber,
        brand: base().brand,
        package: null,
        status: "enabled",
      });
    expect(
      await memory.service.suggest(actor, { query: base().partNumber })
    ).toEqual({
      items: [{ partNumber: base().partNumber, brand: base().brand, pkg: "" }],
    });
  });
  it("merges team-scoped official metadata and catalog, deduplicates identities and caps total at 20", async () => {
    const memory = memoryDb();
    seed(memory);
    seed(memory, { teamId: 12, partNumber: "LOCAL_TEST_OTHER_TEAM_SECRET" });
    memory
      .rows("materials")
      .push(
        {
          partNumber: base().partNumber.toLowerCase(),
          brand: base().brand.toLowerCase(),
          package: "",
          status: "enabled",
        },
        ...Array.from({ length: 25 }, (_, id) => ({
          id,
          partNumber: `LOCAL_TEST_CATALOG_${id}`,
          brand: base().brand,
          package: "PKG",
          status: "enabled",
        }))
      );
    const result = await memory.service.suggest(actor, { query: "LOCAL_TEST" });
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toEqual({
      partNumber: base().partNumber,
      brand: base().brand,
      pkg: "",
    });
    expect(
      result.items.filter(
        item =>
          item.partNumber.toLowerCase() === base().partNumber.toLowerCase()
      )
    ).toHaveLength(1);
    expect(
      result.items.some(
        item => item.partNumber === "LOCAL_TEST_OTHER_TEAM_SECRET"
      )
    ).toBe(false);
    for (const trace of memory.traces.filter(
      trace => trace.table === "official_mall_materials"
    )) {
      expect(trace.sql).toContain("`teamId` = ?");
      expect(trace.fields).toEqual(["partNumber", "brand", "pkg"]);
    }
  });
  it("catalog preview and suggest share multiple/unmatched matching without rewriting SKU, package, quantities or prices", async () => {
    const memory = memoryDb();
    memory
      .rows("materials")
      .push(
        {
          partNumber: base().partNumber,
          brand: base().brand,
          package: "A",
          status: "enabled",
        },
        {
          partNumber: base().partNumber,
          brand: base().brand,
          package: "B",
          status: "enabled",
        }
      );
    const data = {
      ...full(),
      pkg: "USER_PACKAGE",
      qtyOnSale: 7,
      qtyStock: 8,
      note: "USER_NOTE",
    };
    const unmatched = { ...data, partNumber: "USER_UNMATCHED_SKU" };
    const preview = await memory.service.importPreview(actor, {
      rows: [
        { rowNumber: 1, data },
        { rowNumber: 2, data: unmatched },
      ],
    });
    expect(preview.rows[0].matchStatus).toBe("multiple");
    expect(preview.rows[0].matches).toEqual(
      (
        await memory.service.suggest(actor, {
          query: data.partNumber,
          brand: data.brand,
        })
      ).items
    );
    expect(preview.rows[0].data).toEqual(data);
    expect(preview.rows[1]).toMatchObject({
      data: unmatched,
      matches: [],
      matchStatus: "unmatched",
    });
    expect(preview.rows[1].data).toEqual(unmatched);
  });
  it("catalog suggestions remain behind native grants and effective team scope", async () => {
    const memory = memoryDb();
    memory
      .rows("materials")
      .push({
        partNumber: base().partNumber,
        brand: base().brand,
        package: "A",
        status: "enabled",
      });
    memory.rows("official_channel_team_members").splice(0);
    await expect(
      memory.service.suggest(actor, { query: base().partNumber })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.traces.some(trace => trace.table === "materials")).toBe(
      false
    );
    memory.rows("admin_user_permissions").splice(0);
    await expect(
      memory.service.importPreview(actor, {
        rows: [{ rowNumber: 1, data: base() }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.traces.some(trace => trace.table === "materials")).toBe(
      false
    );
  });
  it("three duplicate policies are explicit: skip, CAS real-ID update, new identical tuple with new ID; original import UUID replays", async () => {
    const memory = memoryDb();
    const id = seed(memory);
    const input = {
      requestId: "local-test-three-policies",
      rows: [
        { rowNumber: 1, data: base(), duplicatePolicy: "skip" as const },
        {
          rowNumber: 2,
          data: { ...base(), note: "changed" },
          duplicatePolicy: "update" as const,
          duplicateId: id,
          expectedRevision: 1,
        },
        { rowNumber: 3, data: base(), duplicatePolicy: "new" as const },
      ],
    };
    const result = await memory.service.importRows(actor, input);
    expect(result).toMatchObject({
      success: true,
      imported: 1,
      updated: 1,
      skipped: 1,
      ids: [1, 2],
    });
    expect(memory.rows("official_mall_materials")[1]).toMatchObject({
      ...base(),
      id: 2,
      status: "draft",
      dateCode: "",
    });
    expect(await memory.service.importRows(actor, input)).toMatchObject({
      ...result,
      idempotent: true,
    });
    expect(memory.rows("official_mall_materials")).toHaveLength(2);
    const mismatch = await memory.service.importRows(actor, {
      requestId: "local-test-mismatch",
      rows: [
        {
          rowNumber: 1,
          data: { ...base(), dateCode: "NOT_GUESSED" },
          duplicatePolicy: "update",
          duplicateId: id,
          expectedRevision: 2,
        },
      ],
    });
    expect(mismatch.errors[0].message).toContain("必须一致");
  });
  it("import unauthorized update target cannot commit earlier new rows", async () => {
    const memory = memoryDb();
    const id = seed(memory, { ownerAdminUserId: 72 });
    await expect(
      memory.service.importRows(actor, {
        requestId: "local-test-import-denied",
        rows: [
          { rowNumber: 1, data: base(), duplicatePolicy: "new" },
          {
            rowNumber: 2,
            data: base(),
            duplicatePolicy: "update",
            duplicateId: id,
            expectedRevision: 1,
          },
        ],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.rows("official_mall_materials")).toHaveLength(1);
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
  });
  it("concurrent original import UUID applies real-ID CAS update and new creation once only", async () => {
    const memory = memoryDb();
    const id = seed(memory);
    const input = {
      requestId: "local-test-import-concurrent",
      rows: [
        {
          rowNumber: 1,
          data: { ...base(), note: "changed once" },
          duplicatePolicy: "update" as const,
          duplicateId: id,
          expectedRevision: 1,
        },
        { rowNumber: 2, data: base(), duplicatePolicy: "new" as const },
      ],
    };
    const [a, b] = await Promise.all([
      memory.service.importRows(actor, input),
      memory.service.importRows(actor, input),
    ]);
    expect(b).toMatchObject({ ...a, idempotent: true });
    expect(memory.rows("official_mall_materials")).toHaveLength(2);
    expect(memory.rows("official_mall_materials")[0].revision).toBe(2);
    expect(memory.rows("official_mall_requests")).toHaveLength(1);
  });
  it("request status is current-actor-only and pending receipts never expose a result", async () => {
    const memory = memoryDb();
    memory.rows("official_mall_requests").push({
      id: 1,
      actorAdminUserId: 72,
      requestId: "local-test-other-ledger",
      state: "completed",
      result: { privateId: 99 },
    });
    expect(
      await memory.service.requestStatus(actor, {
        requestId: "local-test-other-ledger",
      })
    ).toEqual({ state: "not_found", result: null });
    memory.rows("official_mall_requests").push({
      id: 2,
      actorAdminUserId: 71,
      requestId: "local-test-pending-ledger",
      state: "pending",
      result: { mustNotExpose: true },
    });
    expect(
      await memory.service.requestStatus(actor, {
        requestId: "local-test-pending-ledger",
      })
    ).toEqual({ state: "pending", result: null });
  });
  it("super administrator must lock the actual active record team, not rely on role", async () => {
    const memory = memoryDb();
    const id = seed(memory, { teamId: 12 });
    memory.rows("admin_users")[0].adminRole = "super_admin";
    memory.rows("official_channel_teams")[1].status = "archived";
    await expect(
      memory.service.publish(actor, {
        id,
        expectedRevision: 1,
        requestId: "local-test-archived-team",
      })
    ).rejects.toThrow("已归档");
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
  });
  it("bulk/import limits and stale import revisions return clear errors without writes", async () => {
    const memory = memoryDb();
    const id = seed(memory);
    await expect(
      memory.service.bulkAction(actor, {
        action: "publish",
        requestId: "local-test-too-many-bulk",
        items: Array.from({ length: 101 }, (_, i) => ({
          id: i + 1,
          expectedRevision: 1,
        })),
      })
    ).rejects.toThrow();
    await expect(
      memory.service.importPreview(actor, {
        rows: Array.from({ length: 501 }, (_, i) => ({
          rowNumber: i + 1,
          data: base(),
        })),
      })
    ).rejects.toThrow();
    const result = await memory.service.importRows(actor, {
      requestId: "local-test-import-stale",
      rows: [
        {
          rowNumber: 1,
          data: base(),
          duplicatePolicy: "update",
          duplicateId: id,
          expectedRevision: 2,
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      updated: 0,
      errors: [
        { rowNumber: 1, message: expect.stringContaining("版本已变化") },
      ],
    });
    expect(memory.rows("official_mall_materials")[0].revision).toBe(1);
  });
  it("management caller stays adminProcedure + signed native account, rejects forged owner and front inventory IDs", async () => {
    const memory = memoryDb();
    const routes = createOfficialMallRouters({
      ...memory.deps,
      adminProcedure,
      publicProcedure,
      router,
      officialActorFromContext,
    });
    const ctx = {
      user: { role: "admin" },
      adminAccount: { ...actor, id: actor.adminUserId, status: "active" },
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    } as any;
    await expect(
      routes.officialMall.createCaller({ ...ctx, user: null }).status()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      routes.officialMall.createCaller({ ...ctx, adminAccount: null }).status()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      routes.officialMall.createCaller(ctx).create({
        requestId: "local-test-forged",
        data: base(),
        ownerAdminUserId: 72,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      routes.officialMallPublic
        .createCaller({ user: null, req: { headers: {} }, res: { setHeader: vi.fn() } } as any)
        .detail({ publicId: "inventory_123" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await routes.officialMallPublic
        .createCaller({ user: null, req: { headers: {} }, res: { setHeader: vi.fn() } } as any)
        .list({})
    ).toMatchObject({ items: [], total: 0 });
  });
  it("DDL is create-empty-only and service has no front/legacy publishing dependencies", () => {
    const ddl = readFileSync(
      "drizzle/migrations/20261117_official_mall_native.sql",
      "utf8"
    ).replace(/^--.*$/gm, "");
    expect(ddl.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    expect(ddl).not.toMatch(/\b(?:ALTER|INSERT|UPDATE|DELETE|DROP)\b/i);
    const source = readFileSync("server/services/officialMall.ts", "utf8");
    expect(source).not.toMatch(
      /getInternalBusinessContext|enterpriseMembers|publishDraftInventoryWithGuard|official_channel_stocks|platformBusiness|merchantBinding/
    );
  });
});


describe("official mall publish-only final gate", () => {
  it("allows unknown draft but rejects unknown supply on direct publish before any snapshot", async () => {
    const memory = memoryDb(); const id = seed(memory, base());
    await expect(memory.service.publish(actor, {id,expectedRevision:1,requestId:"publish-unknown-qty-final"})).rejects.toThrow("大于0");
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
    expect(memory.rows("official_mall_materials")[0].status).toBe("draft");
  });
  it.each([0, 100])("publishes confirmed stock %i with blank lead time, preserving quotes and native audit", async quantity => {
    const memory = memoryDb();
    const data = { ...full(), qtyOnSale: quantity, qtyStock: quantity, qtyOrder: null, leadTime: "", note: "" };
    const id = seed(memory, data);
    const input = { id, expectedRevision: 1, requestId: `publish-confirmed-${quantity}` };
    expect(await memory.service.publish(actor, input)).toMatchObject({ status: "published", revision: 2 });
    const snapshot = memory.rows("official_mall_publications")[0].snapshot;
    expect(snapshot).toMatchObject({ qtyOnSale: quantity, qtyStock: quantity, qtyOrder: null, leadTime: "", priceEx: data.priceEx, ladderPrices: data.ladderPrices });
    expect(snapshot).not.toHaveProperty("note");
    expect(memory.rows("official_mall_requests")[0]).toMatchObject({ state: "completed", before: [{ qtyStock: quantity, revision: 1 }], after: [{ qtyStock: quantity, revision: 2 }] });
    expect(await memory.service.publish(actor, input)).toMatchObject({ idempotent: true });
    expect(memory.rows("official_mall_publications")).toHaveLength(1);
  });
  it.each([
    { priceEx: "0.01", ladderPrices: [] },
    { priceEx: null, ladderPrices: [{ minQty: 1, price: "0.01" }] },
  ])("allows either a positive base quote or a nonempty real ladder at confirmed zero stock", async quote => {
    const memory = memoryDb();
    const id = seed(memory, { ...base(), ...quote, qtyOnSale: 0, qtyStock: 0 });
    expect(await memory.service.publish(actor, { id, expectedRevision: 1, requestId: `publish-quote-${quote.priceEx === null ? "ladder" : "base"}` })).toMatchObject({ status: "published" });
  });
  it.each([
    { qtyOnSale: null, qtyStock: null },
    { qtyOnSale: 0, qtyStock: null },
    { qtyOnSale: 1, qtyStock: null },
    { qtyOnSale: null, qtyStock: 10 },
  ])("does not turn partly or wholly unknown stock into confirmed catalog stock", async quantities => {
    const memory = memoryDb();
    const id = seed(memory, { ...full(), ...quantities, qtyOrder: null });
    await expect(memory.service.publish(actor, { id, expectedRevision: 1, requestId: "publish-partly-unknown" })).rejects.toThrow("大于0");
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
  });
  it("does not publish a confirmed-stock catalog without any real quote", async () => {
    const memory = memoryDb();
    const id = seed(memory, { ...base(), qtyOnSale: 0, qtyStock: 0 });
    await expect(memory.service.publish(actor, { id, expectedRevision: 1, requestId: "publish-no-real-quote" })).rejects.toThrow("大于0");
  });
  it("retains genuine positive-order supply with real lead time, but rejects blank lead time or zero orders", async () => {
    const memory = memoryDb();
    const id = seed(memory, { ...base(), qtyOrder: 100, leadTime: "6-8周" });
    expect(await memory.service.publish(actor, { id, expectedRevision: 1, requestId: "publish-real-order" })).toMatchObject({ status: "published" });
    expect(memory.rows("official_mall_publications")[0].snapshot).toMatchObject({ qtyOnSale: null, qtyStock: null, qtyOrder: 100, leadTime: "6-8周" });
    for (const changes of [{ qtyOrder: 100, leadTime: "" }, { qtyOrder: 0, leadTime: "6-8周" }]) {
      const m = memoryDb(); const other = seed(m, { ...base(), ...changes });
      await expect(m.service.publish(actor, { id: other, expectedRevision: 1, requestId: "publish-invalid-order" })).rejects.toThrow();
      expect(m.rows("official_mall_publications")).toHaveLength(0);
    }
  });
  it("offshelf/edit/republish records a genuine inventory change to zero without fabricating availability", async () => {
    const memory = memoryDb(); const id = seed(memory, full());
    await memory.service.publish(actor, { id, expectedRevision: 1, requestId: "stock-change-first-publish" });
    await memory.service.offshelf(actor, { id, expectedRevision: 2, requestId: "stock-change-offshelf" });
    const data = { ...full(), qtyOnSale: 0, qtyStock: 0, qtyOrder: null, leadTime: "" };
    await memory.service.update(actor, { id, expectedRevision: 3, requestId: "stock-change-real-zero", data });
    await memory.service.publish(actor, { id, expectedRevision: 4, requestId: "stock-change-republish" });
    expect(memory.rows("official_mall_publications")[0].snapshot).toMatchObject({ qtyOnSale: 0, qtyStock: 0, qtyOrder: null, leadTime: "", revision: 5 });
    const update = memory.rows("official_mall_requests").find(r => r.requestId === "stock-change-real-zero");
    expect(update.before[0].qtyStock).toBe(100);
    expect(update.after[0].qtyStock).toBe(0);
    await expect(memory.service.update(actor, { id, expectedRevision: 5, requestId: "stock-change-no-hidden-edit", data })).rejects.toThrow("先显式下架");
    expect(() => validateOfficialMallMaterial({ ...data, leadTime: "现货立发" })).toThrow("零库存");
  });
  it("bulk publish applies the same final gate and reports authoritative row errors", async () => {
    const memory = memoryDb(); const id = seed(memory, base());
    const result = await memory.service.bulkAction(actor, {action:"publish",requestId:"bulk-unknown-supply-final",items:[{id,expectedRevision:1}]});
    expect(result).toMatchObject({success:false,successful:0,errors:[{id,message:expect.stringContaining("大于0")}]});
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
  });
  it("bulk publishes confirmed zero and positive stock identically while leaving unknown stock untouched", async () => {
    const memory = memoryDb();
    const zero = seed(memory, { ...full(), qtyOnSale: 0, qtyStock: 0, leadTime: "" });
    const positive = seed(memory, { ...full(), leadTime: "" });
    const unknown = seed(memory, { ...full(), qtyOnSale: null, qtyStock: null });
    const input = { action: "publish" as const, requestId: "bulk-confirmed-catalog-stock", items: [zero, positive, unknown].map(id => ({ id, expectedRevision: 1 })) };
    const result = await memory.service.bulkAction(actor, input);
    expect(result).toMatchObject({ success: false, successful: 2, errors: [{ id: unknown }] });
    expect(memory.rows("official_mall_publications").map(row => row.snapshot.qtyStock)).toEqual([0, 100]);
    expect(memory.rows("official_mall_materials")[2]).toMatchObject({ status: "draft", qtyStock: null });
    expect(await memory.service.bulkAction(actor, input)).toMatchObject({ ...result, idempotent: true });
  });
});


describe("mall repair bounded suggestions + short native fences", () => {
  it("rejects short catalog scans but still checks current identity", async () => {
    const m = memoryDb();
    expect(await m.service.suggest(actor, {query: "ST"})).toEqual({items: []});
    expect(m.traces.some(t => t.table === "materials" || t.table === "official_mall_materials")).toBe(false);
    m.rows("admin_users")[0].sessionVersion++;
    await expect(m.service.suggest(actor, {query: "S"})).rejects.toMatchObject({code: "FORBIDDEN"});
  });
  it("exact model wins without a prefix query; neither brand contains nor mid-model substring matches", async () => {
    const m = memoryDb();
    m.rows("materials").push(...["STM32", "STM32F103", "XSTM32", "OTHER"].map((partNumber,id) => ({id, partNumber, brand: partNumber === "OTHER" ? "STM32" : "ST", package: "QFN", status: "enabled"})));
    expect((await m.service.suggest(actor, {query:"STM32"})).items.map(x=>x.partNumber)).toEqual(["STM32"]);
    expect(m.traces.filter(t=>t.table==="materials").every(t=>!t.sql.includes("like") && !t.grouped && t.limit===80 && !t.inTransaction)).toBe(true);
    m.rows("materials").splice(0,1);m.traces.splice(0);
    expect((await m.service.suggest(actor, {query:"STM32"})).items.map(x=>x.partNumber)).toEqual(["STM32F103"]);
    expect(m.traces.filter(t=>t.table==="materials").map(t=>t.params[0])).toEqual(["STM32", "STM32%"]);
  });
  it("uses a raw indexed window before catalog status/brand filters and escapes user wildcards", async () => {
    const m = memoryDb();
    m.rows("materials").push(...Array.from({length:81},(_,id)=>({id,partNumber:`ABC${id}`,brand:"ST",package:"QFN",status:id<80?"disabled":"enabled"})));
    expect(await m.service.suggest(actor,{query:"ABC"})).toEqual({items:[]});
    m.rows("materials").splice(0);m.rows("materials").push({partNumber:"A_B123",brand:"ST",status:"enabled"},{partNumber:"AXB123",brand:"ST",status:"enabled"});
    expect((await m.service.suggest(actor,{query:"A_B"})).items.map(x=>x.partNumber)).toEqual(["A_B123"]);
    expect(m.traces.at(-4)?.lock ?? false).toBe(false);
  });
  it("slow catalog SQL does not retain the write mutex/account transaction", async () => {
    const m=memoryDb();let release!:()=>void, entered!:()=>void;
    const wait=new Promise<void>(r=>{release=r}), reached=new Promise<void>(r=>{entered=r});
    m.rows("materials").push({partNumber:base().partNumber,brand:base().brand,status:"enabled"});
    m.setCatalogBarrier(async()=>{entered();await wait});
    const read=m.service.suggest(actor,{query:base().partNumber});await reached;
    try {
      const write=await Promise.race([m.service.create(actor,{requestId:"short-lock-write-test",data:base()}),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("WRITE_BLOCKED_BY_SUGGEST")),500))]);
      expect(write.status).toBe("draft");
    } finally {release();}
    await read;
    expect(m.traces.filter(t=>t.table==="materials").every(t=>!t.inTransaction && !t.lock)).toBe(true);
  });
  it.each(["disabled", "session", "grant", "team", "archive", "role"])("discards candidates when %s changes during SQL", async change=>{
    const m=memoryDb();let release!:()=>void, entered!:()=>void;
    const wait=new Promise<void>(r=>{release=r}), reached=new Promise<void>(r=>{entered=r});
    m.rows("materials").push({partNumber:base().partNumber,brand:base().brand,status:"enabled"});
    m.setCatalogBarrier(async()=>{entered();await wait});
    const read=m.service.suggest(actor,{query:base().partNumber});const rejected=expect(read).rejects.toMatchObject({code:"FORBIDDEN"});await reached;
    if(change==="disabled")m.rows("admin_users")[0].status="disabled";
    if(change==="session")m.rows("admin_users")[0].sessionVersion++;
    if(change==="grant")m.rows("admin_user_permissions").splice(0);
    if(change==="team")m.rows("official_channel_team_members")[0].teamId=12;
    if(change==="archive")m.rows("official_channel_teams")[0].status="archived";
    if(change==="role")m.rows("official_channel_team_members")[0].role="leader";
    release();await rejected;
  });
  it("super admin sole active team auto-selects; none/multiple/archived fail and explicit active team stays draft",async()=>{
    const m=memoryDb();m.rows("admin_users")[0].adminRole="super_admin";m.rows("official_channel_team_members").splice(0);
    await expect(m.service.create(actor,{requestId:"multi-without-selection",data:base()})).rejects.toThrow("多个官方团队");
    expect(m.rows("official_mall_requests")).toHaveLength(0);
    m.rows("official_channel_teams").splice(1);
    expect(await m.service.create(actor,{requestId:"single-team-auto",data:base()})).toMatchObject({status:"draft"});
    expect(m.rows("official_mall_materials")[0].teamId).toBe(11);
    m.rows("official_channel_teams")[0].status="archived";
    await expect(m.service.create(actor,{requestId:"no-active-team",data:base()})).rejects.toThrow("没有有效官方团队");
    await expect(m.service.create(actor,{requestId:"explicit-archived-team",teamId:11,data:base()})).rejects.toThrow("已归档");
    m.rows("official_channel_teams")[0].status="active";m.rows("official_channel_teams").push({id:12,name:"OTHER",status:"active"});
    expect(await m.service.create(actor,{requestId:"explicit-active-team",teamId:12,data:base()})).toMatchObject({status:"draft"});
    expect(m.rows("official_mall_publications")).toHaveLength(0);
  });
});

describe("official mall existing depleted stock read mode (offline only)", () => {
  it("only exact true bypasses the new stock claim gate, never Zod transform context", () => {
    const data = { ...full(), qtyOnSale: 0, qtyStock: 0, leadTime: "现货" };
    expect(validateOfficialMallMaterial(data, true)).toEqual(data);
    for (const allow of [undefined, false, 1, "true", {}, { allowExistingStockState: true }]) {
      expect(() => validateOfficialMallMaterial(data, allow as any)).toThrow("零库存");
    }
    expect(() => z.unknown().transform(validateOfficialMallMaterial as any).parse(data)).toThrow("零库存");
    expect(() => validateOfficialMallMaterial({ ...data, qtyOnSale: null, qtyStock: null })).toThrow("数量未确认");
  });

  it("read mode retains structural, nonnegative, stock relationship and exact price validation", () => {
    const data = { ...full(), qtyOnSale: 0, qtyStock: 0, leadTime: "现货" };
    for (const patch of [
      { partNumber: "" },
      { qtyOnSale: -1 },
      { qtyStock: 1.5 },
      { qtyStock: 2147483648 },
      { qtyOnSale: 1, qtyStock: 0 },
      { priceEx: "0" },
      { priceEx: "1e2" },
      { priceEx: "1.1234567" },
      { ladderPrices: [{ minQty: 1, price: "11" }] },
      { moq: 0 },
      { spq: 0 },
    ]) {
      expect(() => validateOfficialMallMaterial({ ...data, ...patch }, true)).toThrow();
      expect(() => publicProjection({ ...data, ...patch, publicId: "OM_00000000-0000-4000-8000-000000000001", revision: 3 }, new Date().toISOString())).toThrow();
    }
  });

  it.each(["single", "bulk"])("depleted genuine stock stays readable and can be explicitly taken off shelf via %s without restoring itself", async mode => {
    const memory = memoryDb();
    const data = validateOfficialMallMaterial({ ...full(), qtyOnSale: 1, qtyStock: 1, leadTime: "现货" });
    const id = seed(memory, data);
    await memory.service.publish(actor, { id, expectedRevision: 1, requestId: `depleted-${mode}-publish` });

    // Simulate an external stock/snapshot delta, not a service edit or real DB hook.
    const row = memory.rows("official_mall_materials")[0];
    const publication = memory.rows("official_mall_publications")[0];
    Object.assign(row, { qtyOnSale: 0, qtyStock: 0, revision: 3 });
    publication.revision = 3;
    Object.assign(publication.snapshot, { qtyOnSale: 0, qtyStock: 0, revision: 3 });
    const depleted = structuredClone(row);
    const expected = { qtyOnSale: 0, qtyStock: 0, leadTime: "现货", priceEx: data.priceEx, ladderPrices: data.ladderPrices, revision: 3 };
    expect((await memory.service.publicList({})).items).toEqual([expect.objectContaining(expected)]);
    expect((await memory.service.publicDetail({ publicId: row.publicId })).item).toMatchObject(expected);
    expect((await memory.service.list(actor, {})).items).toEqual([expect.objectContaining({ ...expected, status: "published" })]);
    expect(memory.rows("official_mall_materials")[0]).toEqual(depleted);

    const input = { id, expectedRevision: 3, requestId: `depleted-${mode}-offshelf` };
    if (mode === "single") {
      expect(await memory.service.offshelf(actor, input)).toMatchObject({ status: "offshelf", revision: 4 });
    } else {
      expect(await memory.service.bulkAction(actor, { action: "offshelf", requestId: input.requestId, items: [{ id, expectedRevision: 3 }] })).toMatchObject({ success: true, successful: 1, errors: [] });
    }
    const after = memory.rows("official_mall_materials")[0];
    expect(after).toMatchObject({ ...expected, status: "offshelf", revision: 4 });
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
    const audit = memory.rows("official_mall_requests").find(r => r.requestId === input.requestId);
    expect(audit.before[0]).toEqual(depleted);
    expect(audit.after[0]).toMatchObject({ ...expected, status: "offshelf", revision: 4 });
    expect((await memory.service.publicList({})).items).toHaveLength(0);
    expect((await memory.service.publicDetail({ publicId: after.publicId })).item).toBeNull();
    expect((await memory.service.list(actor, {})).items[0]).toMatchObject({ ...expected, status: "offshelf", revision: 4 });
    await expect(memory.service.publish(actor, { id, expectedRevision: 4, requestId: `depleted-${mode}-reject-republish` })).rejects.toThrow("零库存");
    expect(memory.rows("official_mall_materials")[0]).toMatchObject({ status: "offshelf", leadTime: "现货", qtyOnSale: 0, qtyStock: 0, revision: 4 });

    // Explicit replenishment is still a strict write to draft, never an automatic publish.
    expect(await memory.service.update(actor, { id, expectedRevision: 4, requestId: `depleted-${mode}-replenish`, data })).toMatchObject({ status: "draft", revision: 5 });
    expect(memory.rows("official_mall_materials")[0]).toMatchObject({ status: "draft", leadTime: "现货", qtyOnSale: 1, qtyStock: 1, revision: 5 });
    expect((await memory.service.publicList({})).items).toHaveLength(0);
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
  });

  it.each([
    { qtyOnSale: 0, qtyStock: 0 },
    { qtyOnSale: null, qtyStock: null },
    { qtyOnSale: 0, qtyStock: null },
  ])("single and bulk publish still reject new immediate-stock claims for $qtyOnSale/$qtyStock", async quantities => {
    const memory = memoryDb();
    const data = { ...full(), ...quantities, qtyOrder: 100, leadTime: "现货" };
    const id = seed(memory, data);
    const original = structuredClone(memory.rows("official_mall_materials")[0]);
    await expect(memory.service.publish(actor, { id, expectedRevision: 1, requestId: "new-claim-single-reject" })).rejects.toThrow("零库存或数量未确认");
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
    expect(await memory.service.bulkAction(actor, { action: "publish", requestId: "new-claim-bulk-reject", items: [{ id, expectedRevision: 1 }] })).toMatchObject({ success: false, successful: 0, errors: [{ id, message: expect.stringContaining("零库存或数量未确认") }] });
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
    expect(memory.rows("official_mall_materials")[0]).toEqual(original);
  });

  it("create, update, preview and both import write policies remain strict for zero immediate-stock claims", async () => {
    const memory = memoryDb();
    const data = { ...full(), qtyOnSale: 0, qtyStock: 0, leadTime: "现货" };
    const id = seed(memory, full());
    const original = structuredClone(memory.rows("official_mall_materials")[0]);
    await expect(memory.service.create(actor, { requestId: "new-zero-stock-create", data })).rejects.toThrow("零库存");
    await expect(memory.service.update(actor, { id, expectedRevision: 1, requestId: "new-zero-stock-update", data })).rejects.toThrow("零库存");
    expect(memory.rows("official_mall_requests")).toHaveLength(0);
    const preview = await memory.service.importPreview(actor, { rows: [{ rowNumber: 1, data }] });
    expect(preview.rows[0].errors).toEqual([expect.stringContaining("零库存")]);
    expect(preview.rows[0].data).toBeUndefined();
    const imported = await memory.service.importRows(actor, {
      requestId: "new-zero-stock-import",
      rows: [
        { rowNumber: 1, data, duplicatePolicy: "new" },
        { rowNumber: 2, data, duplicatePolicy: "update", duplicateId: id, expectedRevision: 1 },
      ],
    });
    expect(imported).toMatchObject({ success: false, imported: 0, updated: 0, ids: [], errors: [
      { rowNumber: 1, message: expect.stringContaining("零库存") },
      { rowNumber: 2, message: expect.stringContaining("零库存") },
    ] });
    expect(memory.rows("official_mall_materials")).toEqual([original]);
    expect(memory.rows("official_mall_publications")).toHaveLength(0);
  });
});
