import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminNewInformationService, type AdminNewInformationStore } from "./adminNewInformation";
import { createAdminNewInformationSourceForContext } from "./adminNewInformationSources";
import { getPlatformOrderNewInformationFacts, listPlatformOrders } from "../platformOrderApi";
import {
  runAdminNewInformationDiagnostic, withAdminNewInformationDiagnosticSink,
  adminNewInformationDiagnosticStage, recordAdminNewInformationDiagnostic,
  safeAdminNewInformationError, type AdminNewInformationDiagnosticRecord,
} from "./adminNewInformationDiagnostics";
vi.mock("../db", () => ({
  getDb: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getAdminUserById: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getAdminUserPermissions: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getActiveBusinessStaffBinding: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getActiveBusinessMerchantScope: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getBusinessWorkbenchMerchantById: () => { throw Error("REAL_DB_FORBIDDEN"); },
  getAdminUserSalesScopeCodes: () => { throw Error("REAL_DB_FORBIDDEN"); },
  // Intentionally original two-argument native ABI: ignores extra source hooks.
  withBusinessAuthorizationFence: (_key: unknown, run: () => unknown) => run(),
}));
const CANARY = "PII_CANARY_ACCOUNT_MERCHANT_CUSTOMER_REF_SIGNED_TOKEN_SECRET_SQL";
const viewer = { adminUserId: 7, sessionVersion: 3 };
const facts = (items: unknown[] = []) => ({ available: true, scope: { identity: "synthetic", version: "v1" }, items, snapshot: "snapshot1" });
function fixture(opts: { native?: (input: any) => Promise<unknown>; business?: (method: string, input: any) => Promise<unknown>; initialized?: boolean; fence?: any; commitError?: unknown } = {}) {
  const account: any = { id: 7, sessionVersion: 3, status: "active", adminRole: "super_admin" };
  const context: any = { adminAccount: account, user: { id: 7, openId: "local_admin:7", role: "admin" }, req: { headers: {} }, res: {} };
  const source = createAdminNewInformationSourceForContext(context, {
    getDb: async () => ({} as any), getAdminUserById: async () => account,
    getAdminUserPermissions: async () => ["orders.read"], isAccountArchived: async () => false,
    getActiveBusinessStaffBinding: async () => ({ adminUserId: 7, frontUserId: 70, bindingVersion: 1 } as any),
    configuredMerchantIds: () => [11, 12],
    getActiveBusinessMerchantScope: async (_id, merchantId) => ({ adminUserId: 7, merchantId, scopeVersion: 1, modulePermissions: ["business.orders.read", "business.customers.read"] } as any),
    getBusinessWorkbenchMerchantById: async id => ({ id, crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "700", status: "approved" } as any),
    getAdminSalesStaffCodes: async () => undefined,
    nativeOrderFacts: opts.native ?? (async () => facts()),
    nativeMallFacts: async () => facts(),
    readBusinessFacts: async (_ctx, _merchant, method, input) => opts.business ? opts.business(method, input) : facts(),
  });
  const state = { initialized: opts.initialized ?? true, seen: new Set<string>(), lastSummary: { count: 7, available: true } };
  const store: AdminNewInformationStore = {
    async withModule(_v, _m, run) { const result = await run(state); if (opts.commitError) throw opts.commitError; return result; },
    async withModules(_v, modules, run) { const result = await run(new Map(modules.map(m => [m, state]))); if (opts.commitError) throw opts.commitError; return result; },
  };
  const service = createAdminNewInformationService({ source, store, secret: CANARY, ...(opts.fence ? { withViewerFence: opts.fence } : {}) });
  return { service, source, state };
}
async function capture<T>(run: () => Promise<T>) {
  const records: AdminNewInformationDiagnosticRecord[] = [];
  const value = await withAdminNewInformationDiagnosticSink(r => records.push(r as AdminNewInformationDiagnosticRecord), run);
  return { value, records };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("bounded request-only notification diagnostics", () => {
  it("success emits only a limited end, not identities, facts, secret or stages", async () => {
    const f = fixture();
    const { value, records } = await capture(() => f.service.inspect(viewer, { module: "sales", refs: ["order:1"], scope: "11" }));
    expect(value).toEqual({ items: [] }); expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ procedure: "inspect", phase: "request", outcome: "ok", module: "sales" });
    expect(JSON.stringify(records)).not.toContain(CANARY);
  });
  it("concurrent requests have distinct random traces and entry contexts retain the core lookup stage", async () => {
    const a = deferred(), b = deferred();
    const f1 = fixture({ native: async () => { await a.promise; throw Object.assign(Error(CANARY), { code: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22" }); } });
    const f2 = fixture({ native: async () => { await b.promise; throw { kind: "http", httpStatus: 503, upstreamTrpcCode: "UNAUTHORIZED", message: CANARY }; } });
    const output: AdminNewInformationDiagnosticRecord[] = [];
    const p1 = withAdminNewInformationDiagnosticSink(r => output.push(r as any), () => f1.service.inspect(viewer, { module: "sales", refs: ["order:1"] }).catch(e => e));
    const p2 = withAdminNewInformationDiagnosticSink(r => output.push(r as any), () => f2.service.unreadRefs(viewer, { module: "customers" }).catch(e => e));
    // customers has no native orders; use a dedicated concurrent diagnostic span.
    const p3 = withAdminNewInformationDiagnosticSink(r => output.push(r as any), () => runAdminNewInformationDiagnostic("inspect", "sales", () => adminNewInformationDiagnosticStage("lookup", () => f2.source.lookup({ viewer, module: "sales", refs: ["order:2"] }))));
    b.resolve(); await p2; await p3; a.resolve(); await p1;
    const ends = output.filter(r => r.phase === "request" && r.sourceKind === "core" && r.coreStage === "request");
    expect(new Set(ends.map(r => r.traceId)).size).toBe(3);
    const entryErrors = output.filter(r => r.phase === "entryRead" && r.outcome === "error");
    expect(entryErrors).toHaveLength(2); expect(entryErrors.every(r => r.coreStage === "lookup")).toBe(true);
    const db = entryErrors.find(r => r.error?.mysqlCode)!;
    expect(output.filter(r => r.traceId === db.traceId).some(r => r.error?.upstreamTrpcCode === "UNAUTHORIZED")).toBe(false);
    expect(JSON.stringify(output)).not.toContain(CANARY);
  });
  it("sink exceptions do not change successful or unavailable public replies", async () => {
    const sink = () => { throw Error(CANARY); };
    const good = fixture();
    expect(await withAdminNewInformationDiagnosticSink(sink, () => good.service.unreadRefs(viewer, { module: "sales" }))).toEqual({ refs: [], available: true });
    const bad = fixture({ native: async () => { throw Error(CANARY); } });
    await expect(withAdminNewInformationDiagnosticSink(sink, () => bad.service.inspect(viewer, { module: "sales", refs: ["order:1"] }))).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "新增信息核验暂不可用，请稍后重试" });
  });
  it("error allowlist never reads message/stack/cause/SQL and drops canary-shaped values", () => {
    const error: any = { code: CANARY, errno: CANARY, sqlState: CANARY, kind: CANARY, timing: CANARY, httpStatus: CANARY, upstreamTrpcCode: CANARY, fenceClass: CANARY };
    for (const key of ["message", "stack", "cause", "sql", "params", "secret"]) Object.defineProperty(error, key, { get() { throw Error("MUST_NOT_READ"); } });
    expect(safeAdminNewInformationError(error)).toEqual({});
    expect(safeAdminNewInformationError({ code: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22", kind: "http", timing: 12.5, httpStatus: 503, upstreamTrpcCode: "UNAUTHORIZED", fenceClass: "BUSY" })).toEqual({ mysqlCode: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22", kind: "http", timing: 13, httpStatus: 503, upstreamTrpcCode: "UNAUTHORIZED", fenceClass: "BUSY" });
    expect(safeAdminNewInformationError({ kind: "UPSTREAM_5XX", timing: { configMs: 1, requestMs: 12.5, decodeMs: 2, message: CANARY, sql: CANARY } })).toEqual({ kind: "UPSTREAM_5XX", timing: { configMs: 1, requestMs: 13, decodeMs: 2 } });
    expect(safeAdminNewInformationError({ timing: { configMs: CANARY, requestMs: Infinity, decodeMs: -1, secret: CANARY } })).toEqual({});
  });
  it("buffers at most 160 records and ignores abandoned descendants after trace completion", async () => {
    const late = deferred(); const records: any[] = [];
    await withAdminNewInformationDiagnosticSink(r => records.push(r), () => runAdminNewInformationDiagnostic("inspect", "sales", async () => {
      for (let i = 0; i < 3000; i++) recordAdminNewInformationDiagnostic("events", "ok");
      void late.promise.then(() => recordAdminNewInformationDiagnostic("events", "error", undefined, Error(CANARY)));
      recordAdminNewInformationDiagnostic("events", "error", undefined, Error(CANARY));
    }));
    expect(records.length).toBeLessThanOrEqual(161); expect(records[0].truncated).toBe(true);
    const size = records.length; late.resolve(); await Promise.resolve(); expect(records).toHaveLength(size);
  });
  it("limits successful and failed output per process minute without a registry", async () => {
    vi.resetModules();
    const diag = await import("./adminNewInformationDiagnostics");
    const output: any[] = [];
    await diag.withAdminNewInformationDiagnosticSink(r => output.push(r), async () => {
      for (let i = 0; i < 100; i++) await diag.runAdminNewInformationDiagnostic("inspect", "sales", async () => 1);
      expect(output).toHaveLength(60);
      output.length = 0;
      for (let i = 0; i < 700; i++) await diag.runAdminNewInformationDiagnostic("inspect", "sales", async () => {
        diag.recordAdminNewInformationDiagnostic("events", "error", undefined, Error(CANARY));
      });
      expect(output).toHaveLength(1200);
      expect(JSON.stringify(output)).not.toContain(CANARY);
    });
  });
  it("does not release the fence while any issued reader remains pending after another fails", async () => {
    const wait = deferred(), entered = deferred(); let released = false;
    const f = fixture({ native: async () => { throw Error(CANARY); }, business: async method => { if (method === "crmSalesOrder.newInformationFacts") { entered.resolve(); await wait.promise; } return facts(); }, fence: async (_v: any, run: any) => { try { return await run(); } finally { released = true; } } });
    const records: any[] = [];
    const result = withAdminNewInformationDiagnosticSink(r => records.push(r), () => f.service.inspect(viewer, { module: "sales", refs: ["crm-sales:1"], scope: "11" }).catch(e => e));
    await entered.promise; await new Promise(r => setImmediate(r)); expect(released).toBe(false); expect(records).toHaveLength(0);
    wait.resolve(); const error = await result; expect(released).toBe(true); expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(records.some(r => r.phase === "allSettled" && r.outcome === "error")).toBe(true);
    expect(records.some(r => r.sourceKind === "crmSales" && r.phase === "validFacts")).toBe(true);
    expect(JSON.stringify(records)).not.toContain(CANARY);
  });
  it("logs actual validFacts failure with its fixed method and still returns the original 503", async () => {
    const f = fixture({ business: async method => method === "crmSalesOrder.newInformationFacts" ? facts([{ id: "crm-sales:1", version: CANARY, occurredAt: "invalid", historical: false }]) : facts() });
    const records: any[] = [];
    const e = await withAdminNewInformationDiagnosticSink(r => records.push(r), () => f.service.inspect(viewer, { module: "sales", refs: ["order:1"] }).catch(e => e));
    expect(e).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "新增信息核验暂不可用，请稍后重试" });
    expect(records.some(r => r.phase === "validFacts" && r.outcome === "error" && r.sourceKind === "crmSales" && r.method === "crmSalesOrder.newInformationFacts" && r.coreStage === "lookup")).toBe(true);
    expect(JSON.stringify(records)).not.toContain(CANARY);
  });
  it("original FORBIDDEN entry remains ignored, while upstreamTrpcCode alone and portal UNAUTHORIZED never become denied", async () => {
    const denied = fixture({ native: async () => { throw { code: "FORBIDDEN", message: CANARY }; } });
    const good = await capture(() => denied.service.inspect(viewer, { module: "sales", refs: ["order:1"] }));
    expect(good.value).toEqual({ items: [] }); expect(good.records).toHaveLength(1); expect(good.records[0].outcome).toBe("ok");
    for (const code of ["FORBIDDEN", "UNAUTHORIZED"]) {
      const bad = fixture({ native: async () => { throw { upstreamTrpcCode: code, httpStatus: 403, kind: "http" }; } });
      await expect(capture(() => bad.service.inspect(viewer, { module: "sales", refs: ["order:1"] }))).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  });
  it("observes post-callback store commit and original native fence cleanup separately", async () => {
    const records: any[] = [];
    const commit = fixture({ commitError: { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001", message: CANARY } });
    await withAdminNewInformationDiagnosticSink(r => records.push(r), () => commit.service.inspect(viewer, { module: "sales", refs: ["order:1"] }).catch(e => e));
    expect(records.some(r => r.phase === "commit" && r.outcome === "error" && r.error.mysqlCode === "ER_LOCK_DEADLOCK")).toBe(true);
    const clean = fixture({ fence: async (_v: any, run: any) => { await run(); throw { code: "ECONNRESET", message: CANARY }; } });
    await withAdminNewInformationDiagnosticSink(r => records.push(r), () => clean.service.inspect(viewer, { module: "sales", refs: ["order:1"] }).catch(e => e));
    expect(records.some(r => r.phase === "cleanup" && r.outcome === "error" && r.error.mysqlCode === "ECONNRESET")).toBe(true);
    expect(JSON.stringify(records)).not.toContain(CANARY);
  });
  it("marks establishment only when the real inspect establishment path runs", async () => {
    const f = fixture({ initialized: false, native: async () => { throw Error(CANARY); } });
    const records: any[] = [];
    await withAdminNewInformationDiagnosticSink(r => records.push(r), () => f.service.inspect(viewer, { module: "sales", refs: ["order:1"] }).catch(e => e));
    expect(records.some(r => r.phase === "establish" && r.outcome === "error")).toBe(true);
    expect(records.some(r => r.sourceKind === "nativeOrders" && r.coreStage === "list" && r.outcome === "error")).toBe(true);
    expect(records.some(r => r.phase === "commit")).toBe(false);
  });
});

describe("dedicated private notification transport; ordinary order API unchanged", () => {
  function env() { vi.stubEnv("PLATFORM_API_BASE", "http://mock.invalid"); vi.stubEnv("PORTAL_API_KEY", CANARY); }
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "INTERNAL_SERVER_ERROR"])("retains safe upstream %s without .code/message/cause and preserves 10s timeout", async code => {
    env(); const mock = vi.fn(async () => new Response(JSON.stringify([{ error: { json: { message: CANARY, data: { code } } } }]), { status: 503 })); vi.stubGlobal("fetch", mock);
    const e = await getPlatformOrderNewInformationFacts({ refs: ["order:1"] }, []).catch(e => e);
    expect(e).toMatchObject({ kind: "http", httpStatus: 503, upstreamTrpcCode: code }); expect(e.code).toBeUndefined(); expect(e.cause).toBeUndefined(); expect(e.message).not.toContain(CANARY);
    const [url, init] = mock.mock.calls[0] as any; expect(url).toContain("internalOrder.newInformationFacts"); expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(new URL(url).searchParams.get("input")!); expect(payload["0"].json.salesStaffCodes).toEqual([]);
  });
  it("three-state codes and exact refs are transmitted unchanged (mock only)", async () => {
    env(); const calls: any[] = []; vi.stubGlobal("fetch", async (url: string) => { calls.push(JSON.parse(new URL(url).searchParams.get("input")!)["0"].json); return new Response(JSON.stringify([{ result: { data: { json: facts() } } }])); });
    for (const codes of [undefined, [], ["synthetic_code"]]) expect(await getPlatformOrderNewInformationFacts({ refs: [] }, codes)).toEqual(facts());
    expect(calls).toEqual([{ refs: [] }, { refs: [], salesStaffCodes: [] }, { refs: [], salesStaffCodes: ["synthetic_code"] }]);
  });
  it("config/network/decode/empty cases have only closed safe errors", async () => {
    vi.stubEnv("PLATFORM_API_BASE", ""); vi.stubEnv("PORTAL_API_KEY", ""); vi.stubEnv("NODE_ENV", "test");
    expect(await getPlatformOrderNewInformationFacts({}).catch(e => e.kind)).toBe("config"); env();
    vi.stubGlobal("fetch", async () => { throw Error(CANARY); }); expect(await getPlatformOrderNewInformationFacts({}).catch(e => e.kind)).toBe("network");
    vi.stubGlobal("fetch", async () => new Response("not json")); expect(await getPlatformOrderNewInformationFacts({}).catch(e => e.kind)).toBe("decode");
    vi.stubGlobal("fetch", async () => new Response("[]")); expect(await getPlatformOrderNewInformationFacts({}).catch(e => e.kind)).toBe("empty");
  });
  it("existing public orders still preserve the old upstream error message and no new code", async () => {
    env(); vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ error: { json: { message: "legacy public order error", data: { code: "FORBIDDEN" } } } }]), { status: 403 }));
    const e = await listPlatformOrders({ page: 1, pageSize: 20 }).catch(e => e); expect(e.message).toBe("legacy public order error"); expect(e.code).toBeUndefined(); expect(e.kind).toBeUndefined();
  });
});
