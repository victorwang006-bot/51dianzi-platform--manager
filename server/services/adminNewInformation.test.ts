import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAdminNewInformationService,
  type AdminNewInformationEvent,
  type AdminNewInformationListRead,
  type AdminNewInformationScope,
  type AdminNewInformationSource,
  type AdminNewInformationState,
  type AdminNewInformationStore,
  type AdminNewInformationViewer,
} from "./adminNewInformation";
import {
  ADMIN_NEW_INFORMATION_MODULES,
  type AdminNewInformationModule,
} from "../../shared/adminNewInformation";
import { createAdminNewInformationRouter } from "../routers/adminNewInformation";
import type { TrpcContext } from "../_core/context";

// No real database module, connection, source business rows or business DML.
vi.mock("../db", () => ({
  getDb: vi.fn(() => {
    throw new Error("REAL_DATABASE_FORBIDDEN_IN_UNIT_TEST");
  }),
  withBusinessAuthorizationFence: vi.fn((_key, run) => run()),
}));
const a: AdminNewInformationViewer = { adminUserId: 1, sessionVersion: 1 };
const b: AdminNewInformationViewer = { adminUserId: 2, sessionVersion: 1 };
const event = (
  id: string,
  version = "created:1",
  extra: Partial<AdminNewInformationEvent> = {}
): AdminNewInformationEvent => ({
  id,
  version,
  occurredAt: "2026-11-17T00:00:00.000Z",
  actorKey: "employee:other",
  ...extra,
});
class MemoryStore implements AdminNewInformationStore {
  states = new Map<string, AdminNewInformationState>();
  private locks = new Map<string, Promise<void>>();
  key(viewer: AdminNewInformationViewer, module: AdminNewInformationModule) {
    return `${viewer.adminUserId}:${module}`;
  }
  async withModule<T>(
    viewer: AdminNewInformationViewer,
    module: AdminNewInformationModule,
    run: (state: AdminNewInformationState) => Promise<T>
  ): Promise<T> {
    return this.withModules(viewer, [module], states =>
      run(states.get(module)!)
    );
  }
  async withModules<T>(
    viewer: AdminNewInformationViewer,
    modules: readonly AdminNewInformationModule[],
    run: (
      states: Map<AdminNewInformationModule, AdminNewInformationState>
    ) => Promise<T>
  ): Promise<T> {
    const lockKey = String(viewer.adminUserId);
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(
      lockKey,
      previous.then(() => wait)
    );
    await previous;
    const states = new Map<
      AdminNewInformationModule,
      AdminNewInformationState
    >();
    for (const module of modules) {
      const old = this.states.get(this.key(viewer, module));
      states.set(module, {
        initialized: old?.initialized ?? false,
        seen: new Set(old?.seen ?? []),
        lastSummary: {
          ...(old?.lastSummary ?? { count: 0, available: true }),
          ...(old?.lastSummary.children
            ? { children: { ...old.lastSummary.children } }
            : {}),
        },
      });
    }
    try {
      const result = await run(states);
      for (const [module, state] of states)
        this.states.set(this.key(viewer, module), state);
      return result;
    } finally {
      release();
    }
  }
}
class Source implements AdminNewInformationSource {
  rows = new Map<AdminNewInformationModule, AdminNewInformationEvent[]>(
    ADMIN_NEW_INFORMATION_MODULES.map(m => [m, []])
  );
  scope: AdminNewInformationScope = {
    identity: "merchant:17",
    version: "grants:1/binding:1",
    actorKey: "employee:self",
  };
  failList = new Set<AdminNewInformationModule>();
  failLookup = false;
  denied = false;
  pageSize = 50;
  mutateSnapshot = false;
  onPage?: (module: AdminNewInformationModule, page: number) => void;
  onLookup?: () => void;
  snapshots = new Map<string, AdminNewInformationEvent[]>();
  listCalls: Parameters<AdminNewInformationSource["list"]>[0][] = [];
  lookupCalls: Parameters<AdminNewInformationSource["lookup"]>[0][] = [];
  private serial = 0;
  set(module: AdminNewInformationModule, rows: AdminNewInformationEvent[]) {
    this.rows.set(module, rows);
  }
  async list(
    input: Parameters<AdminNewInformationSource["list"]>[0]
  ): Promise<AdminNewInformationListRead> {
    this.listCalls.push(input);
    if (this.failList.has(input.module))
      throw new Error("private DSN must not escape");
    if (this.denied) return { available: false };
    let snapshot = input.snapshot;
    if (!snapshot) {
      snapshot = `snapshot:${++this.serial}`;
      this.snapshots.set(snapshot, [...(this.rows.get(input.module) ?? [])]);
    }
    const offset = Number(input.cursor ?? 0);
    const frozen = this.snapshots.get(snapshot)!;
    this.onPage?.(input.module, offset / this.pageSize);
    const items = frozen.slice(offset, offset + this.pageSize);
    return {
      available: true,
      scope: { ...this.scope },
      items,
      snapshot: this.mutateSnapshot && input.cursor ? "inconsistent" : snapshot,
      ...(offset + this.pageSize < frozen.length
        ? { nextCursor: String(offset + this.pageSize) }
        : {}),
    };
  }
  async lookup(input: Parameters<AdminNewInformationSource["lookup"]>[0]) {
    this.lookupCalls.push(input);
    this.onLookup?.();
    if (this.failLookup) throw new Error("sensitive upstream credential");
    if (this.denied) return { available: false } as const;
    return {
      available: true,
      scope: { ...this.scope },
      items: (this.rows.get(input.module) ?? []).filter(row =>
        input.refs.includes(row.id)
      ),
    } as const;
  }
}
function fixture(
  extra: Partial<Parameters<typeof createAdminNewInformationService>[0]> = {}
) {
  const source = new Source();
  const store = new MemoryStore();
  let time = Date.parse("2026-11-17T00:01:00Z");
  const service = createAdminNewInformationService({
    source,
    store,
    secret: "server-only-unit-test-key",
    now: () => time,
    withViewerFence: (_viewer, run) => run(),
    ...extra,
  });
  return {
    source,
    store,
    service,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
async function inspect(
  f: ReturnType<typeof fixture>,
  ids: string[],
  scope?: string
) {
  return f.service.inspect(a, { module: "sales", refs: ids, scope });
}
async function receipt(
  f: ReturnType<typeof fixture>,
  id: string,
  scope?: string
) {
  return (await inspect(f, [id], scope)).items[0].receipt!;
}

describe("admin new information exact display receipts", () => {
  it("baselines all seven modules only after successful complete source snapshots", async () => {
    const f = fixture();
    for (const module of ADMIN_NEW_INFORMATION_MODULES)
      f.source.set(module, [event(`${module}:old`)]);
    const result = await f.service.summary(a);
    for (const module of ADMIN_NEW_INFORMATION_MODULES) {
      expect(result.modules[module]).toEqual({ count: 0, available: true });
      expect(f.store.states.get(f.store.key(a, module))?.initialized).toBe(
        true
      );
    }
    expect(
      f.source.listCalls.every(call => call.baseline?.initialized === false)
    ).toBe(true);
    f.source.set("sales", [event("sales:old"), event("sales:new")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    expect(
      (await inspect(f, ["sales:old", "sales:new"])).items.map(row => row.isNew)
    ).toEqual([false, true]);
  });

  it("initial inspect baselines the whole source, not only the submitted UI page", async () => {
    const f = fixture();
    f.source.pageSize = 1;
    f.source.set("sales", [event("old:1"), event("old:2"), event("old:3")]);
    expect((await inspect(f, ["old:1"])).items[0].isNew).toBe(false);
    f.source.set("sales", [...f.source.rows.get("sales")!, event("new:1")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
  });

  it("does not lose events arriving between baseline pages/commit or concurrent initializers", async () => {
    const f = fixture();
    f.source.pageSize = 1;
    f.source.set("sales", [event("old:1"), event("old:2")]);
    let inserted = false;
    f.source.onPage = (module, page) => {
      if (module === "sales" && page === 0 && !inserted) {
        inserted = true;
        // Equal occurredAt is intentional: no timestamp high-water mark is used.
        f.source.set("sales", [
          event("old:1"),
          event("old:2"),
          event("new:during-baseline"),
        ]);
      }
    };
    await Promise.all([f.service.summary(a), f.service.summary(a)]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    expect((await inspect(f, ["new:during-baseline"])).items[0].isNew).toBe(
      true
    );
  });

  it("deduplicates by immutable scoped record/event version and counts unique header/subroute records", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [
      event("r1", "created:1", { children: ["orders"] }),
      event("r1", "created:1", { children: ["outbound", "orders"] }),
      event("r1", "assigned:2", { children: ["orders"] }),
      event("r2", "created:1", { children: ["outbound"] }),
    ]);
    expect((await f.service.summary(a)).modules.sales).toEqual({
      count: 2,
      available: true,
      children: { orders: 1, outbound: 2 },
    });
    const first = await inspect(f, ["r1", "r1"]);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].version).toMatch(/^compound:[a-f0-9]{64}$/);
    f.source.set("sales", [...f.source.rows.get("sales")!].reverse());
    expect((await inspect(f, ["r1"])).items[0].version).toBe(
      first.items[0].version
    );
    expect((await f.service.summary(a)).modules.sales.count).toBe(2);
    expect(
      await f.service.markDisplayed(a, { receipts: [first.items[0].receipt!] })
    ).toEqual({ marked: 2, accepted: 1 });
    expect(f.store.states.get(f.store.key(a, "sales"))?.seen.size).toBe(2);
    expect((await f.service.summary(a)).modules.sales).toEqual({
      count: 1,
      available: true,
      children: { orders: 0, outbound: 1 },
    });
  });

  it("acknowledges displayed events only, leaving off-page and omitted records new", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("page:1"), event("page:2"), event("page:3")]);
    const result = await inspect(f, ["page:1", "page:2"]);
    expect(result.items.every(row => row.isNew)).toBe(true);
    const token = result.items[0].receipt!;
    expect(
      await f.service.markDisplayed(a, { receipts: [token, token] })
    ).toEqual({ marked: 1, accepted: 2 });
    expect(await f.service.markDisplayed(a, { receipts: [token] })).toEqual({
      marked: 0,
      accepted: 1,
    });
    expect((await f.service.summary(a)).modules.sales.count).toBe(2);
    expect(
      (await inspect(f, ["page:2", "page:3"])).items.every(row => row.isNew)
    ).toBe(true);
  });

  it("self actor metadata suppresses only own new indication, never another employee or source row", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [
      event("mine", "created:1", { actorKey: "employee:self" }),
      event("colleague"),
    ]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    const rows = (await inspect(f, ["mine", "colleague"])).items;
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.isNew)).toEqual([false, true]);
    expect(
      await f.service.markDisplayed(a, { receipts: [rows[0].receipt!] })
    ).toEqual({ marked: 1, accepted: 1 });
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
  });

  it("isolates first baselines, seen records and receipts for separate local admin accounts", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("new-for-a")]);
    expect((await f.service.summary(b)).modules.sales.count).toBe(0);
    const token = await receipt(f, "new-for-a");
    await expect(
      f.service.markDisplayed(b, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    await f.service.markDisplayed(a, { receipts: [token] });
    f.source.set("sales", [event("new-for-a"), event("new-for-both")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    expect((await f.service.summary(b)).modules.sales.count).toBe(1);
  });

  it("does not clear a new assignment version with an old creation receipt", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("record", "created:1")]);
    const old = await receipt(f, "record");
    f.source.set("sales", [event("record", "assignment:2")]);
    await expect(
      f.service.markDisplayed(a, { receipts: [old] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((await inspect(f, ["record"])).items[0].isNew).toBe(true);
    const current = await receipt(f, "record");
    expect(await f.service.markDisplayed(a, { receipts: [current] })).toEqual({
      marked: 1,
      accepted: 1,
    });
    f.source.set("sales", [event("record", "assignment:3")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
  });

  it("rejects tampered signature, wrong server secret, wrong viewer/session and expired receipts", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("r")]);
    const token = await receipt(f, "r");
    const [payload, sig] = token.split(".");
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        a: 2,
      })
    ).toString("base64url");
    await expect(
      f.service.markDisplayed(a, {
        receipts: [
          `${changed}.${sig}`,
          `${payload}.${sig.slice(1)}`,
          "not-signed",
        ],
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      f.service.markDisplayed(
        { ...a, sessionVersion: 2 },
        { receipts: [token] }
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const other = createAdminNewInformationService({
      source: f.source,
      store: f.store,
      secret: "different-secret",
      withViewerFence: (_v, run) => run(),
    });
    await expect(
      other.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.advance(120_000);
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
  });

  it("rechecks current scope identity/version/filter and live authorization on display", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("r")]);
    const token = await receipt(f, "r", "outbound");
    f.source.scope = { ...f.source.scope, version: "grants:2/binding:1" };
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.source.scope = {
      ...f.source.scope,
      version: "grants:1/binding:1",
      identity: "merchant:changed",
    };
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.source.scope = { ...f.source.scope, identity: "merchant:17" };
    f.source.denied = true;
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.source.lookupCalls.at(-1)?.scope).toBe("outbound");
    f.source.denied = false;
    expect((await inspect(f, ["r"])).items[0].isNew).toBe(true);
    f.source.set("sales", []); // Record-level revocation/deletion.
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((await inspect(f, ["r"])).items).toEqual([]);
  });

  it("refuses expired receipts after slow live lookup, not merely at request entry", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("r")]);
    const token = await receipt(f, "r");
    f.source.onLookup = () => f.advance(120_001);
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("preserves the last proven count on source failure and never baselines failed initial sources", async () => {
    const f = fixture();
    f.source.failList.add("sales");
    expect((await f.service.summary(a)).modules.sales).toEqual({
      count: 0,
      available: false,
      reason: "temporary",
      lastKnown: false,
    });
    expect(f.store.states.has(f.store.key(a, "sales"))).toBe(false);
    f.source.failList.delete("sales");
    f.source.set("sales", [event("historical")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(0);
    f.source.set("sales", [event("historical"), event("new")]);
    expect((await f.service.summary(a)).modules.sales.count).toBe(1);
    const token = await receipt(f, "new");
    f.source.failList.add("sales");
    expect((await f.service.summary(a)).modules.sales).toEqual({
      count: 1,
      available: false,
      reason: "temporary",
      lastKnown: true,
    });
    f.source.failLookup = true;
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ message: "新增信息核验暂不可用，请稍后重试" });
    f.source.failLookup = false;
    f.source.failList.delete("sales");
    expect((await inspect(f, ["new"])).items[0].isNew).toBe(true);
  });

  it.each(["temporary", "denied", undefined] as const)("preserves count/children/state but distinguishes unavailable reason %s", async reason => {
    const f = fixture();
    f.source.set("sales", [event("new", "v1", { historical: false, children: ["business"] })]);
    expect((await f.service.summary(a)).modules.sales).toEqual({ count: 1, available: true, children: { business: 1 } });
    const before = f.store.states.get(f.store.key(a, "sales"))!;
    const originalList = f.source.list.bind(f.source);
    vi.spyOn(f.source, "list").mockImplementation(input => input.module === "sales"
      ? Promise.resolve({ available: false, ...(reason ? { reason } : {}) }) : originalList(input));
    const result = (await f.service.summary(a)).modules;
    expect(result.sales).toEqual({ count: 1, available: false, children: { business: 1 },
      lastKnown: reason !== "denied", ...(reason ? { reason } : {}) });
    expect(result.customers).toEqual({ count: 0, available: true });
    expect(f.store.states.get(f.store.key(a, "sales"))).toBe(before);
    expect(before.lastSummary).toEqual({ count: 1, available: true, children: { business: 1 } });
    expect(before.seen.size).toBe(0);
  });

  it("storage failure before state access is temporary unknown, not a proven zero", async () => {
    const f = fixture();
    vi.spyOn(f.store, "withModule").mockRejectedValue(new Error("offline storage"));
    const result = await f.service.summary(a);
    expect(Object.values(result.modules).every(item => item.available === false &&
      item.reason === "temporary" && item.lastKnown === false)).toBe(true);
    expect(f.source.listCalls).toHaveLength(0);
    expect(f.store.states.size).toBe(0);
  });

  it("rolls back initial baseline when the following lookup fails", async () => {
    const f = fixture();
    f.source.set("sales", [event("historical")]);
    f.source.failLookup = true;
    await expect(inspect(f, ["historical"])).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(f.store.states.has(f.store.key(a, "sales"))).toBe(false);
  });

  it("rolls back the entire displayed batch if another module lookup fails", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("customers", [event("customer:new")]);
    f.source.set("sales", [event("order:new")]);
    const customer = await f.service.inspect(a, {
      module: "customers",
      refs: ["customer:new"],
    });
    const order = await receipt(f, "order:new");
    let lookup = 0;
    f.source.onLookup = () => {
      if (++lookup === 2) f.source.failLookup = true;
    };
    await expect(
      f.service.markDisplayed(a, {
        receipts: [customer.items[0].receipt!, order],
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.source.onLookup = undefined;
    f.source.failLookup = false;
    expect(
      (
        await f.service.inspect(a, {
          module: "customers",
          refs: ["customer:new"],
        })
      ).items[0].isNew
    ).toBe(true);
    expect((await inspect(f, ["order:new"])).items[0].isNew).toBe(true);
  });

  it("rechecks early-group receipt expiry at the final atomic batch commit", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("r1"), event("r2")]);
    const first = await receipt(f, "r1", "orders");
    const second = await receipt(f, "r2", "outbound");
    let lookups = 0;
    f.source.onLookup = () => {
      if (++lookups === 2) f.advance(120_001);
    };
    await expect(
      f.service.markDisplayed(a, { receipts: [first, second] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("does not baseline partial/inconsistent snapshots or malformed event metadata", async () => {
    const f = fixture();
    f.source.pageSize = 1;
    f.source.mutateSnapshot = true;
    f.source.set("sales", [event("old1"), event("old2")]);
    expect((await f.service.summary(a)).modules.sales.available).toBe(false);
    expect(f.store.states.has(f.store.key(a, "sales"))).toBe(false);
    f.source.mutateSnapshot = false;
    f.source.set("sales", [
      event("bad", "created:1", { occurredAt: "not-a-date" }),
    ]);
    expect((await f.service.summary(a)).modules.sales.available).toBe(false);
    expect(f.store.states.has(f.store.key(a, "sales"))).toBe(false);
  });

  it("fails closed without a server secret and enforces 100-ref/receipt limits", async () => {
    const f = fixture({ secret: "" });
    expect(
      Object.values((await f.service.summary(a)).modules).every(
        row => !row.available
      )
    ).toBe(true);
    expect(f.store.states.size).toBe(0);
    await expect(inspect(f, ["r"])).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(
      f.service.markDisplayed(a, { receipts: [] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const g = fixture();
    await expect(
      inspect(
        g,
        Array.from({ length: 101 }, (_, i) => `r${i}`)
      )
    ).rejects.toThrow();
    await expect(
      g.service.markDisplayed(a, { receipts: Array(101).fill("receipt") })
    ).rejects.toThrow();
    await expect(
      g.service.summary({ adminUserId: 0, sessionVersion: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("supports native adminProcedure ABI but rejects OAuth/front actors without a local admin account", async () => {
    const f = fixture();
    const calls = vi.spyOn(f.service, "summary");
    const r = createAdminNewInformationRouter(f.service);
    const base = {
      req: { headers: {} },
      res: {},
      user: { id: 99, role: "admin", openId: "oauth:front" },
      adminAccount: null,
    } as unknown as TrpcContext;
    await expect(r.createCaller(base).summary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(calls).not.toHaveBeenCalled();
    const local = {
      ...base,
      user: { id: 1, role: "admin", openId: "local_admin:1" },
      adminAccount: { id: 1, status: "active", sessionVersion: 4 },
    } as unknown as TrpcContext;
    await r.createCaller(local).summary();
    expect(calls).toHaveBeenCalledWith({ adminUserId: 1, sessionVersion: 4 });
  });
});

describe("admin new information compatibility increment", () => {
  it("preserves explicit post-activation events in both initial summary and inspect baselines", async () => {
    const rows = [
      event("legacy"),
      event("historical", "created:1", { historical: true }),
      event("after-activation", "created:1", {
        occurredAt: "2026-11-17T00:43:47.001Z",
        historical: false,
      }),
    ];
    for (const initial of ["summary", "inspect"] as const) {
      const f = fixture();
      f.source.pageSize = 1;
      f.source.set("sales", rows);
      if (initial === "summary")
        expect((await f.service.summary(a)).modules.sales.count).toBe(1);
      const result = await inspect(
        f,
        rows.map(row => row.id)
      );
      expect(result.items.map(row => row.isNew)).toEqual([false, false, true]);
      expect(f.store.states.get(f.store.key(a, "sales"))?.seen.size).toBe(2);
      expect(
        result.items.every(
          row => !("historical" in row) && !("countKey" in row)
        )
      ).toBe(true);
      // Historical records entering a later authorized scope must still stay non-new.
      f.source.set("sales", [
        ...rows,
        event("late-history", "created:1", { historical: true }),
      ]);
      expect((await f.service.summary(a)).modules.sales.count).toBe(1);
      expect((await inspect(f, ["late-history"])).items[0].isNew).toBe(false);
    }
  });

  it("rejects conflicting or malformed historical/countKey metadata across snapshot pages", async () => {
    const cases: AdminNewInformationEvent[][] = [
      [
        event("same", "v1", { historical: true }),
        event("same", "v1", { historical: false }),
      ],
      [event("same", "v1"), event("same", "v1", { historical: false })],
      [
        event("same", "v1", { countKey: "c1" }),
        event("same", "v1", { countKey: "c2" }),
      ],
      [event("bad", "v1", { historical: "false" as unknown as boolean })],
      [event("bad", "v1", { countKey: "" })],
    ];
    for (const rows of cases) {
      const f = fixture();
      f.source.pageSize = 1;
      f.source.set("sales", rows);
      expect((await f.service.summary(a)).modules.sales.available).toBe(false);
      expect(f.store.states.has(f.store.key(a, "sales"))).toBe(false);
    }
    const f = fixture();
    f.source.pageSize = 1;
    f.source.set("sales", [
      event("same", "v1", {
        historical: false,
        countKey: "c1",
        children: ["orders"],
      }),
      event("same", "v1", {
        historical: false,
        countKey: "c1",
        children: ["outbound"],
      }),
    ]);
    expect((await f.service.summary(a)).modules.sales).toEqual({
      count: 1,
      available: true,
      children: { orders: 1, outbound: 1 },
    });
  });

  it("deduplicates reception conversation counts and children but sees only exact physical events", async () => {
    const f = fixture();
    const message = (id: string, version = "received:1") =>
      event(id, version, {
        historical: false,
        countKey: "conversation:1",
        children: ["messages"],
      });
    f.source.set("reception", [
      message("message:1"),
      message("message:2"),
      event("message:3", "received:1", {
        historical: false,
        countKey: "conversation:2",
        children: ["messages"],
      }),
      event("conversation:1", "received:1", {
        historical: false,
        children: ["messages"],
      }),
    ]);
    expect((await f.service.summary(a)).modules.reception).toEqual({
      count: 3,
      available: true,
      children: { messages: 3 },
    });
    const read = async (refs: string[]) =>
      f.service.inspect(a, { module: "reception", refs });
    const first = (await read(["message:1"])).items[0];
    await f.service.markDisplayed(a, { receipts: [first.receipt!] });
    expect((await f.service.summary(a)).modules.reception.count).toBe(3);
    expect((await read(["message:2"])).items[0].isNew).toBe(true);
    const rest = await read(["message:2", "message:3", "conversation:1"]);
    await f.service.markDisplayed(a, {
      receipts: rest.items.map(row => row.receipt!),
    });
    expect((await f.service.summary(a)).modules.reception).toEqual({
      count: 0,
      available: true,
      children: { messages: 0 },
    });
    f.source.set("reception", [
      message("message:1", "received:2"),
      message("message:4"),
    ]);
    expect((await f.service.summary(a)).modules.reception.count).toBe(1);
    expect(
      (await read(["message:1", "message:4"])).items.map(row => row.isNew)
    ).toEqual([true, true]);
    await expect(
      f.service.markDisplayed(a, { receipts: [first.receipt!] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("returns full accepted input length through the native router including already-seen duplicates", async () => {
    const f = fixture();
    const r = createAdminNewInformationRouter(f.service);
    const ctx = {
      req: { headers: {} },
      res: {},
      user: { id: 1, role: "admin", openId: "local_admin:1" },
      adminAccount: { id: 1, status: "active", sessionVersion: 1 },
    } as unknown as TrpcContext;
    const caller = r.createCaller(ctx);
    f.source.set("sales", [event("new", "created:1", { historical: false })]);
    const token = (await caller.inspect({ module: "sales", refs: ["new"] }))
      .items[0].receipt!;
    expect(
      await caller.markDisplayed({ receipts: [token, token, token] })
    ).toEqual({ marked: 1, accepted: 3 });
    expect(await caller.markDisplayed({ receipts: [token, token] })).toEqual({
      marked: 0,
      accepted: 2,
    });
    expect(await caller.markDisplayed({ receipts: [] })).toEqual({
      marked: 0,
      accepted: 0,
    });
    // Already-seen does not bypass the live resource authorization check.
    f.source.set("sales", []);
    await expect(
      caller.markDisplayed({ receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects whole mixed batches for invalid receipts or changed live source without partial seen writes", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("customers", [event("customer")]);
    f.source.set("sales", [event("order")]);
    const customer = (
      await f.service.inspect(a, { module: "customers", refs: ["customer"] })
    ).items[0].receipt!;
    const order = await receipt(f, "order");
    const before = f.source.lookupCalls.length;
    await expect(
      f.service.markDisplayed(a, { receipts: [customer, "invalid", order] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.source.lookupCalls).toHaveLength(before);
    f.source.set("sales", [event("order", "assignment:2")]);
    await expect(
      f.service.markDisplayed(a, { receipts: [customer, order] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "customers"))?.seen.size).toBe(0);
    expect(f.store.states.get(f.store.key(a, "sales"))?.seen.size).toBe(0);
    f.source.set("sales", [event("order")]);
    let lookups = 0;
    f.source.onLookup = () => {
      if (++lookups === 2)
        f.source.scope = { ...f.source.scope, version: "revoked:2" };
    };
    await expect(
      f.service.markDisplayed(a, { receipts: [customer, order] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "customers"))?.seen.size).toBe(0);
    expect(f.store.states.get(f.store.key(a, "sales"))?.seen.size).toBe(0);
  });

  it("rejects atomic commit when an early already-seen receipt expires even if fresh receipts remain valid", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("sales", [event("seen"), event("fresh")]);
    const old = await receipt(f, "seen", "orders");
    await f.service.markDisplayed(a, { receipts: [old] });
    f.advance(10);
    const fresh = await receipt(f, "fresh", "outbound");
    let lookups = 0;
    f.source.onLookup = () => {
      if (++lookups === 2) f.advance(119_995);
    };
    await expect(
      f.service.markDisplayed(a, { receipts: [old, fresh] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "sales"))?.seen.size).toBe(1);
    f.source.onLookup = undefined;
    expect(
      (await inspect(f, ["seen", "fresh"])).items.map(row => row.isNew)
    ).toEqual([false, true]);
  });
});

// Decode/sign only inside offline tests, using the fixture's known secret. No production tokens.
function receiptPayload(token: string): Record<string, any> {
  return JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8")
  );
}
function signedTestReceipt(payload: Record<string, unknown>) {
  const key = createHmac("sha256", "server-only-unit-test-key")
    .update("51dianzi/admin-new-information/receipt/v1")
    .digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", key).update(encoded).digest("base64url")}`;
}
const inquiryFact = (id: string, version: string) =>
  event(id, version, {
    historical: false,
    countKey: "conversation:1",
    children: ["messages"],
  });
const readInquiry = (
  f: ReturnType<typeof fixture>,
  refs = ["inquiry:1"],
  scope?: string
) => f.service.inspect(a, { module: "reception", refs, scope });

describe("physical inquiry presentation and signed multi-fact receipts", () => {
  it("merges one unseen and one seen version in either order without losing the unseen fact or another inquiry", async () => {
    for (const seenVersion of ["created:1", "latestMessage:1"]) {
      const f = fixture();
      await f.service.summary(a);
      f.source.set("reception", [inquiryFact("inquiry:1", seenVersion)]);
      const seenToken = (await readInquiry(f)).items[0].receipt!;
      expect(receiptPayload(seenToken).v).toBe(1); // Legacy single-version ABI.
      await f.service.markDisplayed(a, { receipts: [seenToken] });
      const unseenVersion =
        seenVersion === "created:1" ? "latestMessage:1" : "created:1";
      // Intentionally put the seen fact last: the previous UI Map-last-wins lost this new row.
      f.source.set("reception", [
        inquiryFact("inquiry:1", unseenVersion),
        inquiryFact("inquiry:1", seenVersion),
        inquiryFact("inquiry:2", "created:1"),
      ]);
      expect((await f.service.summary(a)).modules.reception.count).toBe(1);
      const rows = (await readInquiry(f, ["inquiry:1", "inquiry:2"])).items;
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.isNew)).toBe(true);
      expect(receiptPayload(rows[0].receipt!)).toMatchObject({
        v: 1,
        id: "inquiry:1",
        ev: unseenVersion,
      });
      expect(
        await f.service.markDisplayed(a, { receipts: [rows[0].receipt!] })
      ).toEqual({ marked: 1, accepted: 1 });
      expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(
        2
      );
      expect(
        (await readInquiry(f, ["inquiry:1", "inquiry:2"])).items.map(
          row => row.isNew
        )
      ).toEqual([false, true]);
      expect((await f.service.summary(a)).modules.reception.count).toBe(1);
    }
  });

  it("rejects the entire old compound receipt after latestMessage changes, without clearing creation, the new message or another module", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("reception", [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:1", "latestMessage:1"),
    ]);
    f.source.set("customers", [
      event("customer:new", "created:1", { historical: false }),
    ]);
    const old = (await readInquiry(f, undefined, "messages")).items[0].receipt!;
    expect(receiptPayload(old)).toMatchObject({
      v: 2,
      id: "inquiry:1",
      events: ["created:1", "latestMessage:1"],
      filter: "messages",
    });
    const customer = (
      await f.service.inspect(a, {
        module: "customers",
        refs: ["customer:new"],
      })
    ).items[0].receipt!;
    f.source.set("reception", [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:1", "latestMessage:2"),
    ]);
    await expect(
      f.service.markDisplayed(a, { receipts: [customer, old] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(0);
    expect(f.store.states.get(f.store.key(a, "customers"))?.seen.size).toBe(0);
    expect(f.source.lookupCalls.at(-1)?.scope).toBe("messages");
    const fresh = (await readInquiry(f, undefined, "messages")).items[0]
      .receipt!;
    expect(
      await f.service.markDisplayed(a, { receipts: [fresh, fresh] })
    ).toEqual({ marked: 2, accepted: 2 });
    expect(await f.service.markDisplayed(a, { receipts: [fresh] })).toEqual({
      marked: 0,
      accepted: 1,
    });
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(2);
  });

  it("rejects a compound token with one tampered or missing fact all-or-throw, never partially clearing valid receipts", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("reception", [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:1", "latestMessage:1"),
      inquiryFact("inquiry:2", "created:1"),
    ]);
    const rows = (await readInquiry(f, ["inquiry:1", "inquiry:2"])).items;
    const compound = rows[0].receipt!;
    const [encoded, signature] = compound.split(".");
    const payload = receiptPayload(compound);
    const changed = Buffer.from(
      JSON.stringify({ ...payload, events: ["created:1", "forged:message"] })
    ).toString("base64url");
    const before = f.source.lookupCalls.length;
    await expect(
      f.service.markDisplayed(a, {
        receipts: [rows[1].receipt!, `${changed}.${signature}`],
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.source.lookupCalls).toHaveLength(before);
    expect(encoded).not.toBe(changed);
    // Even a correctly signed receipt cannot accept one no-longer-current fact.
    f.source.set("reception", [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:2", "created:1"),
    ]);
    await expect(
      f.service.markDisplayed(a, { receipts: [rows[1].receipt!, compound] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(0);
  });

  it("enforces bounded flat event arrays and 4096-byte receipts on issue/verify without recursion or partial writes", async () => {
    const f = fixture();
    await f.service.summary(a);
    f.source.set("reception", [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:1", "latestMessage:1"),
      inquiryFact("inquiry:2", "created:1"),
    ]);
    const rows = (await readInquiry(f, ["inquiry:1", "inquiry:2"])).items;
    const payload = receiptPayload(rows[0].receipt!);
    const malformed = [
      [],
      ["created:1"],
      ["created:1", "created:1"],
      ["created:1", "x".repeat(181)],
      ["created:1", { events: ["latestMessage:1"] }],
      Array.from({ length: 9 }, (_, i) => `version:${i}`),
    ];
    for (const events of malformed) {
      await expect(
        f.service.markDisplayed(a, {
          receipts: [
            rows[1].receipt!,
            signedTestReceipt({ ...payload, events }),
          ],
        })
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
    await expect(
      f.service.markDisplayed(a, {
        receipts: [rows[1].receipt!, "x".repeat(4097)],
      })
    ).rejects.toThrow();
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(0);
    f.source.set(
      "reception",
      Array.from({ length: 9 }, (_, i) =>
        inquiryFact("inquiry:1", `version:${i}`)
      )
    );
    await expect(readInquiry(f)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(0);
    // Boundary itself is supported and every expanded fact is accepted atomically.
    f.source.set(
      "reception",
      Array.from({ length: 8 }, (_, i) =>
        inquiryFact("inquiry:1", `version:${i}`)
      )
    );
    const boundary = (await readInquiry(f)).items[0].receipt!;
    expect(boundary.length).toBeLessThanOrEqual(4096);
    expect(await f.service.markDisplayed(a, { receipts: [boundary] })).toEqual({
      marked: 8,
      accepted: 1,
    });
  });

  it("retains compound viewer/session, current scope, permission, no-data and expiry fences for every signed fact", async () => {
    const f = fixture();
    await f.service.summary(a);
    const facts = [
      inquiryFact("inquiry:1", "created:1"),
      inquiryFact("inquiry:1", "latestMessage:1"),
    ];
    f.source.set("reception", facts);
    const token = (await readInquiry(f)).items[0].receipt!;
    for (const viewer of [b, { ...a, sessionVersion: 2 }]) {
      await expect(
        f.service.markDisplayed(viewer, { receipts: [token] })
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
    const original = { ...f.source.scope };
    for (const changed of [
      { ...original, identity: "other:scope" },
      { ...original, version: "grant:revoked" },
    ]) {
      f.source.scope = changed;
      await expect(
        f.service.markDisplayed(a, { receipts: [token] })
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
    f.source.scope = original;
    f.source.denied = true;
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.source.denied = false;
    f.source.set("reception", []);
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    f.source.set("reception", facts);
    // Expiry is rechecked after live source IO for a compound receipt as well.
    f.source.onLookup = () => f.advance(120_001);
    await expect(
      f.service.markDisplayed(a, { receipts: [token] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.store.states.get(f.store.key(a, "reception"))?.seen.size).toBe(0);
  });
});
