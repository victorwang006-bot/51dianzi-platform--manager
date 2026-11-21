import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAdminNewInformationSourceForContext,
  type AdminNewInformationSourceDependencies,
} from "./adminNewInformationSources";
import {
  createAdminNewInformationService,
  type AdminNewInformationState,
  type AdminNewInformationStore,
} from "./adminNewInformation";
import type { NewInformationFact, NewInformationFactsResult } from "../../shared/adminNewInformationFacts";
import type { AdminNewInformationModule } from "../../shared/adminNewInformation";
import type { TrpcContext } from "../_core/context";

const native = vi.hoisted(() => ({
  business: vi.fn(), mall: vi.fn(), order: vi.fn(), mallFactory: vi.fn(), salesCodes: vi.fn(),
}));
// Every default database call is forbidden. Fixtures inject only in-memory callbacks.
vi.mock("../db", () => ({
  getDb: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getAdminUserById: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getAdminUserPermissions: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getActiveBusinessStaffBinding: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getActiveBusinessMerchantScope: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getBusinessWorkbenchMerchantById: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); },
  getAdminUserSalesScopeCodes: (id: number) => native.salesCodes(id),
  withBusinessAuthorizationFence: () => { throw new Error("REGISTRY_MUST_NOT_LOCK_AGAIN"); },
}));
vi.mock("../businessRouter", () => ({ readBusinessNewInformationFacts: native.business }));
vi.mock("../platformOrderApi", () => ({ getPlatformOrderNewInformationFacts: native.order }));
vi.mock("./adminNewInformationSources/mall", () => ({
  createMallNewInformationReader: (deps: unknown) => { native.mallFactory(deps); return { read: native.mall }; },
}));
vi.mock("./officialChannelAccess", () => ({
  officialActorFromContext: (ctx: TrpcContext) => ({
    adminUserId: ctx.adminAccount!.id, sessionVersion: ctx.adminAccount!.sessionVersion,
  }),
  loadOfficialAccess: vi.fn(), assertOfficialRecordAction: vi.fn(), officialTeamPredicate: vi.fn(),
}));

const viewer = { adminUserId: 7, sessionVersion: 3 };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const event = (id: string, extra: Partial<NewInformationFact> = {}): NewInformationFact => ({
  id, version: "created:2026-11-17T01:00:00.000Z", occurredAt: "2026-11-17T01:00:00.000Z",
  historical: false, ...extra,
});
const result = (identity: string, rows: NewInformationFact[], version = "authority:1"): NewInformationFactsResult => ({
  available: true, scope: { identity, version }, items: rows,
  snapshot: hash([identity, version, rows]),
});
const methods = {
  customers: "customer.newInformationFacts",
  inventory: "channelInventory.newInformationFacts",
  reception: "enterprise.inquiryNewInformationFacts",
  procurement: "customerDemand.procurementNewInformationFacts",
  inbound: "inbound.newInformationFacts",
  crm: "crmSalesOrder.newInformationFacts",
  seller: "order.sellerNewInformationFacts",
};
function fixture() {
  const account: any = { id: 7, sessionVersion: 3, status: "active", adminRole: "merchant_mgr" };
  const context: TrpcContext = {
    adminAccount: { ...account },
    user: { id: 7, role: "admin", openId: "local_admin:7" } as any,
    adminPermissions: ["orders.read", "officialInventory.read"],
    req: { headers: { "x-business-merchant-id": "999" } } as any,
    res: {} as any,
  };
  let permissions = ["profile.manage"];
  let configured = [11, 12];
  let binding: any = { adminUserId: 7, frontUserId: 70, bindingVersion: 1, id: 1 };
  let archived = false;
  let storageAvailable = true;
  const scopes = new Map<number, any>([11, 12].map(id => [id, {
    id, adminUserId: 7, merchantId: id, scopeVersion: 1,
    modulePermissions: ["business.customers.read"],
  }]));
  const merchants = new Map<number, any>([11, 12].map(id => [id, {
    id, crmStatus: "enabled", registrationRegion: "CN", businessLicense: `CREDIT${id}`,
    crmOwnerPortalUserId: "700", status: "approved",
  }]));
  const facts = new Map<string, NewInformationFactsResult>();
  const failures = new Map<string, unknown>();
  const key = (merchant: number, method: string) => `${merchant}/${method}`;
  const read = async (key: string, refs: string[] | undefined) => {
    if (failures.has(key)) throw failures.get(key);
    const source = facts.get(key) ?? result(key, []);
    return { ...source, items: refs === undefined ? source.items : source.items.filter(row => refs.includes(row.id)) };
  };
  const local = {
    getDb: vi.fn(async () => storageAvailable ? {} as any : null),
    getAdminUserById: vi.fn(async () => account),
    getAdminUserPermissions: vi.fn(async () => [...permissions]),
    isAccountArchived: vi.fn(async () => archived),
    getActiveBusinessStaffBinding: vi.fn(async () => binding),
    getActiveBusinessMerchantScope: vi.fn(async (_adminId, merchantId) => scopes.get(merchantId) ?? null),
    getBusinessWorkbenchMerchantById: vi.fn(async merchantId => merchants.get(merchantId) ?? null),
    configuredMerchantIds: () => [...configured],
  } satisfies AdminNewInformationSourceDependencies;
  const reads = {
    readBusinessFacts: vi.fn(async (_ctx, merchantId, method, input) => read(key(merchantId, method), input.refs)),
    nativeMallFacts: vi.fn(async (_ctx, input) => read("native:mall", input.refs)),
    nativeOrderFacts: vi.fn(async (input, _codes) => read("native:orders", input.refs)),
    getAdminSalesStaffCodes: vi.fn(async () => [] as string[] | undefined),
  } satisfies AdminNewInformationSourceDependencies;
  const deps: AdminNewInformationSourceDependencies = { ...local, ...reads };
  const source = createAdminNewInformationSourceForContext(context, deps);
  const set = (merchant: number, method: string, rows: NewInformationFact[], authority = "authority:1") =>
    facts.set(key(merchant, method), result(key(merchant, method), rows, authority));
  const grant = (module: string, write = false) => {
    for (const scope of scopes.values()) scope.modulePermissions = [`business.${module}.read`, ...(write ? [`business.${module}.write`] : [])];
  };
  return {
    source, context, account, scopes, merchants, facts, failures, local, reads, deps, key, set, grant,
    permissions: (value: string[]) => { permissions = value; },
    configured: (value: number[]) => { configured = value; },
    binding: (value: any) => { binding = value; },
    archive: () => { archived = true; },
    storage: (value: boolean) => { storageAvailable = value; },
    list: (module: AdminNewInformationModule = "customers") => source.list({ viewer, module }),
    lookup: (refs: string[], scope?: string, module: AdminNewInformationModule = "customers") => source.lookup({ viewer, module, refs, scope }),
  };
}
async function available<T extends { available: boolean }>(value: Promise<T>): Promise<Extract<T, { available: true }>> {
  const resolved = await value;
  expect(resolved.available).toBe(true);
  if (resolved.available !== true) throw new Error("EXPECTED_AVAILABLE");
  return resolved as Extract<T, { available: true }>;
}

describe("local admin provider registry: authorized complete facts, no module reader", () => {
  it("unions all configured active merchants, ignoring browser merchant selection and stale ctx grants", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    f.set(12, methods.customers, [event("customer:2")]);
    const all = await available(f.list());
    expect(all.items.map(row => row.id)).toEqual(["customer:1", "customer:2"]);
    expect(all.scope.actorKey).toBe("admin:7");
    expect(f.reads.readBusinessFacts.mock.calls.map(call => call[1])).toEqual([11, 12]);
    expect(all.nextCursor).toBeNull();
  });
  it("deduplicates same physical id/version aliases but not same numeric id across tables", async () => {
    const f = fixture();
    f.grant("orders");
    f.permissions(["orders.read"]);
    const order = event("order:17", { children: ["mall"] });
    f.set(11, methods.crm, [event("crm-sales:17", { children: ["business"] })]);
    f.set(11, methods.seller, [order]);
    f.set(12, methods.seller, [{ ...order, children: ["outbound"] }]);
    f.facts.set("native:orders", result("native-orders", [order]));
    const all = await available(f.list("sales"));
    expect(all.items.map(row => row.id)).toEqual(["crm-sales:17", "order:17"]);
    expect(all.items.find(row => row.id === "order:17")?.children).toEqual(["mall", "outbound"]);
  });
  it("keeps several immutable inquiry events for one presentation record, never Map-last-wins", async () => {
    const f = fixture();
    f.grant("inquiries");
    const rows = [event("inquiry:1", { version: "created:1", countKey: "conversation:5" }),
      event("inquiry:1", { version: "message:2", countKey: "conversation:5" })];
    f.set(11, methods.reception, rows);
    expect((await available(f.list("reception"))).items.map(row => row.version)).toEqual(["created:1", "message:2"]);
    expect((await available(f.lookup(["inquiry:1"], "merchant:11", "reception"))).items).toHaveLength(2);
  });
  it.each(["actorKey", "historical", "occurredAt", "countKey"] as const)("fails closed on contradictory alias %s", async field => {
    const f = fixture();
    const base = event("customer:1", { actorKey: "admin:9", countKey: "customer:1" });
    f.set(11, methods.customers, [base]);
    const conflicting = { ...base, [field]: field === "historical" ? true : field === "occurredAt" ? "2026-11-17T01:01:00.000Z" : "other" };
    f.set(12, methods.customers, [conflicting]);
    expect(await f.list()).toEqual({ available: false, reason: "temporary" });
    expect(await f.lookup(["customer:1"], "merchant:11")).toEqual({ available: false, reason: "temporary" });
  });
  it("stable complete snapshot sorts 205 rows and is unaffected by response ordering", async () => {
    const f = fixture();
    const rows = Array.from({ length: 205 }, (_, i) => event(`customer:${i + 1}`));
    f.set(11, methods.customers, rows);
    const first = await available(f.list());
    f.set(11, methods.customers, [...rows].reverse());
    f.facts.get(f.key(11, methods.customers))!.snapshot = hash([f.key(11, methods.customers), "authority:1", rows]);
    const second = await available(f.list());
    // Real reader snapshot is itself stable across row order; emulate that ABI.
    expect(first.items).toHaveLength(205);
    expect(second.items).toEqual(first.items);
    expect(second.snapshot).toBe(first.snapshot);
    const repeated = await available(f.list());
    expect(repeated.snapshot).toBe(second.snapshot);
    expect(repeated.scope).toEqual(first.scope);
    expect(await f.source.list({ viewer, module: "customers", cursor: "page:2" })).toEqual({ available: false, reason: "temporary" });
  });
  it("snapshot changes when a new event arrives but unchanged authority does not", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    const first = await available(f.list());
    f.set(11, methods.customers, [event("customer:1"), event("customer:2")]);
    const second = await available(f.list());
    expect(second.snapshot).not.toBe(first.snapshot);
    expect(second.scope).toEqual(first.scope);
  });
  it("lookup short merchant filter rechecks ALL scopes and returns the full summary fingerprint", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    f.set(12, methods.customers, [event("customer:2")]);
    const all = await available(f.list());
    f.reads.readBusinessFacts.mockClear();
    const lookup = await available(f.lookup(["customer:1", "customer:2"], "11"));
    expect(lookup.items.map(row => row.id)).toEqual(["customer:1"]);
    expect(lookup.scope).toEqual(all.scope);
    expect(f.reads.readBusinessFacts.mock.calls.map(call => [call[1], call[3]])).toEqual([
      [11, { refs: ["customer:1", "customer:2"] }], [12, { refs: ["customer:1", "customer:2"] }],
    ]);
    expect((await available(f.lookup(["customer:1"], "merchant:11"))).scope).toEqual(all.scope);
  });
  it("canonical server scope strings are filters, not credentials", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    f.set(12, methods.customers, [event("customer:2")]);
    const all = await available(f.list());
    const canonical = await available(f.lookup(["customer:1", "customer:2"], f.key(11, methods.customers)));
    expect(canonical.items.map(row => row.id)).toEqual(["customer:1"]);
    expect(canonical.scope).toEqual(all.scope);
    expect((await available(f.lookup(["customer:1"], "merchant:999"))).items).toEqual([]);
    expect((await available(f.lookup(["customer:1", "customer:2"], all.scope.identity))).items).toHaveLength(2);
  });
  it("rechecks local session/account/grants/scope on every list and lookup without persistent cache", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    const before = await available(f.list());
    f.scopes.get(12)!.scopeVersion++;
    const after = await available(f.lookup(["customer:1"], "merchant:11"));
    expect(after.scope.identity).toEqual(before.scope.identity);
    expect(after.scope.version).not.toBe(before.scope.version);
    expect(f.local.getAdminUserById).toHaveBeenCalledTimes(2);
    expect(f.local.getAdminUserPermissions).toHaveBeenCalledTimes(2);
    expect(f.local.getActiveBusinessStaffBinding).toHaveBeenCalledTimes(2);
    expect(f.local.getActiveBusinessMerchantScope).toHaveBeenCalledTimes(4);
    f.account.sessionVersion++;
    expect(await f.lookup(["customer:1"])).toEqual({ available: false, reason: "denied" });
  });
  it("scope identities stay stable on binding revisions but change when the real staff is rebound", async () => {
    const f = fixture();
    const before = await available(f.list());
    f.binding({ adminUserId: 7, frontUserId: 70, bindingVersion: 2 });
    const revision = await available(f.list());
    expect(revision.scope.identity).toEqual(before.scope.identity);
    expect(revision.scope.version).not.toBe(before.scope.version);
    f.binding({ adminUserId: 7, frontUserId: 71, bindingVersion: 3 });
    const rebound = await available(f.list());
    expect(rebound.scope.identity).not.toBe(before.scope.identity);
  });
  it("explicit 403 only removes that source; does not lend another merchant's permissions", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    f.set(12, methods.customers, [event("customer:2")]);
    f.failures.set(f.key(11, methods.customers), { code: "FORBIDDEN" });
    const all = await available(f.list());
    expect(all.items.map(row => row.id)).toEqual(["customer:2"]);
    const revoked = await available(f.lookup(["customer:1", "customer:2"], "merchant:11"));
    expect(revoked.items).toEqual([]);
    expect(revoked.scope).toEqual(all.scope);
    f.scopes.get(12)!.modulePermissions = [];
    expect(await f.list()).toEqual({ available: false, reason: "denied" });
  });
  it.each([new Error("network contains secret"), { code: "NOT_FOUND" }, { code: "TOO_MANY_REQUESTS" }, { code: "UNAUTHORIZED" }])("unknown/failure cannot become partial counts or empty authority", async error => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1")]);
    f.failures.set(f.key(12, methods.customers), error);
    expect(await f.list()).toEqual({ available: false, reason: "temporary" });
    expect(await f.lookup(["customer:1"], "merchant:11")).toEqual({ available: false, reason: "temporary" });
  });
  it("no DB, archived local account, OAuth and cross-viewer inputs fail before fact reads", async () => {
    const cases: Array<["temporary" | "denied", (f: ReturnType<typeof fixture>) => void]> = [
      ["temporary", f => f.storage(false)],
      ["denied", f => f.archive()],
      ["denied", f => { f.context.user!.openId = "oauth:7"; }],
      ["denied", f => { f.account.status = "disabled"; }],
      ["denied", f => { f.context.adminAccount = null; }],
      ["denied", f => { f.account.sessionVersion++; }],
      ["denied", f => { f.context.adminAccount!.sessionVersion++; }],
    ];
    for (const [reason, mutate] of cases) {
      const f = fixture(); mutate(f);
      expect(await f.list()).toEqual({ available: false, reason });
      expect(await f.lookup([])).toEqual({ available: false, reason });
      expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
      expect(f.reads.nativeOrderFacts).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect(await f.source.list({ viewer: { ...viewer, adminUserId: 8 }, module: "customers" })).toEqual({ available: false, reason: "denied" });
  });
  it("all explicitly FORBIDDEN entries or no legitimate scope are known denied, not unknown", async () => {
    const f = fixture();
    for (const id of [11, 12]) f.failures.set(f.key(id, methods.customers), { code: "FORBIDDEN" });
    expect(await f.list()).toEqual({ available: false, reason: "denied" });
    expect(await f.lookup([])).toEqual({ available: false, reason: "denied" });
    for (const mutate of [
      (current: ReturnType<typeof fixture>) => current.binding(null),
      (current: ReturnType<typeof fixture>) => current.scopes.clear(),
      (current: ReturnType<typeof fixture>) => current.configured([]),
      (current: ReturnType<typeof fixture>) => current.binding({ adminUserId: 8, frontUserId: 70, bindingVersion: 1 }),
    ]) {
      const current = fixture(); mutate(current);
      expect(await current.list()).toEqual({ available: false, reason: "denied" });
      expect(current.reads.readBusinessFacts).not.toHaveBeenCalled();
    }
  });
  it("fresh native account inactive/archived/session mismatch/context invalid is known denied before native reads", async () => {
    for (const module of ["mall", "sales"] as const) {
      for (const mutate of [
        (f: ReturnType<typeof fixture>) => { f.account.status = "disabled"; },
        (f: ReturnType<typeof fixture>) => f.archive(),
        (f: ReturnType<typeof fixture>) => { f.account.sessionVersion++; },
        (f: ReturnType<typeof fixture>) => { f.context.user!.openId = "oauth:7"; },
      ]) {
        const f = fixture(); f.permissions(["orders.read", "officialInventory.read"]); mutate(f);
        expect(await f.list(module)).toEqual({ available: false, reason: "denied" });
        expect(await f.lookup([], undefined, module)).toEqual({ available: false, reason: "denied" });
        expect(f.reads.nativeMallFacts).not.toHaveBeenCalled();
        expect(f.reads.nativeOrderFacts).not.toHaveBeenCalled();
      }
    }
  });
  it("database helper exceptions are temporary even in account/archive/scope checks; do not infer revocation", async () => {
    const callbacks = ["getDb", "getAdminUserById", "getAdminUserPermissions", "isAccountArchived",
      "getActiveBusinessStaffBinding", "getActiveBusinessMerchantScope", "getBusinessWorkbenchMerchantById"] as const;
    for (const callback of callbacks) {
      const f = fixture();
      f.local[callback].mockRejectedValue(new Error("offline private database"));
      expect(await f.list()).toEqual({ available: false, reason: "temporary" });
      expect(await f.lookup([])).toEqual({ available: false, reason: "temporary" });
      expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
    }
  });
  it("mall is native-only and ignores merchant/binding/front inventory grants", async () => {
    const f = fixture();
    f.permissions(["officialInventory.read"]);
    f.binding(null);
    f.facts.set("native:mall", result("admin:7", [event("mall-material:1", { actorKey: "admin:7" })]));
    const mall = await available(f.list("mall"));
    expect(mall.items.map(row => row.id)).toEqual(["mall-material:1"]);
    expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
    expect(f.local.getActiveBusinessStaffBinding).not.toHaveBeenCalled();
    expect(f.local.getActiveBusinessMerchantScope).not.toHaveBeenCalled();
    f.permissions(["materials.read", "business.inventory.read"]);
    expect(await f.list("mall")).toEqual({ available: false, reason: "denied" });
  });
  it("inventory preserves independent official read projection without borrowing mall/source namespaces", async () => {
    const f = fixture();
    f.permissions(["officialInventory.read"]);
    f.grant("customers");
    f.set(11, methods.inventory, [event("channel-material:1")]);
    const stock = await available(f.list("inventory"));
    expect(stock.items[0].id).toBe("channel-material:1");
    f.permissions(["materials.read"]);
    expect(await f.list("inventory")).toEqual({ available: false, reason: "denied" });
    f.permissions(["officialInventory.read"]);
    f.set(11, methods.inventory, [event("mall-material:1")]);
    expect(await f.list("inventory")).toEqual({ available: false, reason: "temporary" });
  });
  it("inbound retains original page's exact merchant write entry, read RPC stays fixed", async () => {
    const f = fixture();
    f.grant("inventory");
    f.permissions(["officialInventory.read"]);
    expect(await f.list("inbound")).toEqual({ available: false, reason: "denied" });
    expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
    f.scopes.get(11)!.modulePermissions.push("business.inventory.write");
    f.set(11, methods.inbound, [event("inbound:3")]);
    const inbound = await available(f.list("inbound"));
    expect(inbound.items.map(row => row.id)).toEqual(["inbound:3"]);
    expect(f.reads.readBusinessFacts.mock.calls.map(call => [call[1], call[2]])).toEqual([[11, methods.inbound]]);
  });
  it.each([undefined, [], ["staff-a", "staff-b"]])("native orders preserves three-state sales scope %j independently of business scopes", async codes => {
    const f = fixture();
    f.binding(null);
    f.permissions(["orders.read"]);
    f.reads.getAdminSalesStaffCodes.mockResolvedValue(codes);
    f.facts.set("native:orders", result("native-orders", [event("order:8")]));
    const sales = await available(f.list("sales"));
    expect(sales.items.map(row => row.id)).toEqual(["order:8"]);
    expect(f.reads.nativeOrderFacts).toHaveBeenCalledWith({}, codes);
    expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
    const lookup = await available(f.lookup(["order:8"], "native:orders", "sales"));
    expect(lookup.scope).toEqual(sales.scope);
  });
  it("business sales does not require native orders.read and native denial never leaks rows to merchant pages", async () => {
    const f = fixture();
    f.grant("orders");
    f.set(11, methods.seller, [event("order:1")]);
    const businessOnly = await available(f.list("sales"));
    expect(businessOnly.items.map(row => row.id)).toEqual(["order:1"]);
    expect(f.reads.nativeOrderFacts).not.toHaveBeenCalled();
    f.permissions(["orders.read"]);
    f.facts.set("native:orders", result("native-orders", [event("order:2")]));
    const all = await available(f.list("sales"));
    const scoped = await available(f.lookup(["order:1", "order:2"], "merchant:11", "sales"));
    expect(scoped.items.map(row => row.id)).toEqual(["order:1"]);
    expect(scoped.scope).toEqual(all.scope);
    f.failures.set("native:orders", { code: "FORBIDDEN" });
    expect((await available(f.list("sales"))).items.map(row => row.id)).toEqual(["order:1"]);
  });
  it("all source facts remain metadata-only; frontend creator is never inferred as local admin", async () => {
    const f = fixture();
    f.set(11, methods.customers, [event("customer:1", { actorKey: "front:7" }), event("customer:2", { actorKey: "admin:7" })]);
    const all = await available(f.list());
    expect(all.items[0].actorKey).toBe("front:7");
    expect(all.items[1].actorKey).toBe("admin:7");
    f.facts.set(f.key(12, methods.customers), { ...result("bad", []), items: [{ ...event("customer:3"), buyerName: "PII" }] } as any);
    expect(await f.list()).toEqual({ available: false, reason: "temporary" });
  });
  it("strict refs max100, exact output intersection and no complete:false/next-page claims", async () => {
    const f = fixture();
    expect(await f.lookup(Array.from({ length: 101 }, (_, i) => `customer:${i + 1}`))).toEqual({ available: false, reason: "temporary" });
    expect(f.reads.readBusinessFacts).not.toHaveBeenCalled();
    f.reads.readBusinessFacts.mockResolvedValue(result("malicious-reader", [event("customer:1"), event("customer:2")]));
    expect((await available(f.lookup(["customer:1"]))).items.map(row => row.id)).toEqual(["customer:1"]);
    f.reads.readBusinessFacts.mockResolvedValue({ ...result("partial", []), nextCursor: "second-page" } as any);
    expect(await f.list()).toEqual({ available: false, reason: "temporary" });
  });
  it("reception countKey is preserved without ever querying/marking chat", async () => {
    const f = fixture();
    f.grant("inquiries");
    f.set(11, methods.reception, [event("inquiry:1", { countKey: "conversation:5" }), event("inquiry:2", { countKey: "conversation:5" })]);
    const all = await available(f.list("reception"));
    expect(all.items.map(row => row.countKey)).toEqual(["conversation:5", "conversation:5"]);
    expect(f.reads.readBusinessFacts.mock.calls.every(call => call[2] === methods.reception)).toBe(true);
  });
  it("waits for every in-flight reader before returning unavailable and releasing caller's fence", async () => {
    const f = fixture();
    let release!: () => void;
    let finished = false;
    f.reads.readBusinessFacts.mockImplementation(async (_ctx, id) => {
      if (id === 11) throw new Error("first failed");
      await new Promise<void>(resolve => { release = resolve; });
      finished = true;
      return result("slow-second", []);
    });
    let returned = false;
    const pending = f.list().then(value => { returned = true; return value; });
    await vi.waitFor(() => expect(typeof release).toBe("function"));
    expect(returned).toBe(false);
    release();
    expect(await pending).toEqual({ available: false, reason: "temporary" });
    expect(finished).toBe(true);
  });
  it("production defaults wire only the existing no-nested-fence business and native safe helpers", async () => {
    const f = fixture();
    native.business.mockResolvedValue(result("business-default", [event("customer:1")]));
    native.mall.mockResolvedValue(result("admin:7", [event("mall-material:2")]));
    native.order.mockResolvedValue(result("native-orders", [event("order:3")]));
    native.salesCodes.mockResolvedValue(["local-7"]);
    expect((await import("../businessRouter")).readBusinessNewInformationFacts).toBe(native.business);
    const source = createAdminNewInformationSourceForContext(f.context, f.local);
    const initial = await source.list({ viewer, module: "customers" });
    expect(f.local.getActiveBusinessMerchantScope).toHaveBeenCalledTimes(2);
    expect(native.business).toHaveBeenCalledTimes(2);
    expect((await available(Promise.resolve(initial))).items).toHaveLength(1);
    expect(native.business).toHaveBeenCalledWith(expect.objectContaining({ adminAccount: f.account }), 11, methods.customers, {});
    f.permissions(["officialInventory.read"]);
    expect((await available(source.list({ viewer, module: "mall" }))).items[0].id).toBe("mall-material:2");
    expect(native.mall).toHaveBeenCalledWith({ adminUserId: 7, sessionVersion: 3 }, {});
    expect(Object.keys(native.mallFactory.mock.calls.at(-1)![0]).sort()).toEqual(["assertOfficialRecordAction", "getDb", "loadOfficialAccess", "officialTeamPredicate"]);
    f.permissions(["orders.read"]);
    await available(source.list({ viewer, module: "sales" }));
    expect(native.salesCodes).toHaveBeenCalledWith(7);
    expect(native.order).toHaveBeenCalledWith({}, ["local-7"]);
    f.account.adminRole = "super_admin";
    await available(source.list({ viewer, module: "sales" }));
    expect(native.order).toHaveBeenLastCalledWith({}, undefined);
  });
});

class Store implements AdminNewInformationStore {
  states = new Map<AdminNewInformationModule, AdminNewInformationState>();
  async withModules<T>(_viewer: typeof viewer, modules: readonly AdminNewInformationModule[], run: (states: Map<AdminNewInformationModule, AdminNewInformationState>) => Promise<T>): Promise<T> {
    const states = new Map(modules.map(module => {
      const old = this.states.get(module);
      return [module, { initialized: old?.initialized ?? false, seen: new Set(old?.seen ?? []), lastSummary: { ...(old?.lastSummary ?? { count: 0, available: true }) } }];
    }));
    const value = await run(states);
    for (const [module, state] of states) this.states.set(module, state);
    return value;
  }
  withModule<T>(current: typeof viewer, module: AdminNewInformationModule, run: (state: AdminNewInformationState) => Promise<T>) {
    return this.withModules(current, [module], states => run(states.get(module)!));
  }
}
function integration() {
  const f = fixture();
  const store = new Store();
  const service = createAdminNewInformationService({
    source: f.source, store, secret: "registry-offline-test-only", withViewerFence: (_viewer, run) => run(),
  });
  return { ...f, store, service };
}
describe("registry and notification core integration, no business writes", () => {
  it("errors preserve last proven count and baseline; lookup failures never clear seen state", async () => {
    const f = integration();
    f.set(11, methods.customers, [event("customer:1")]);
    expect((await f.service.summary(viewer)).modules.customers.count).toBe(1);
    const token = (await f.service.inspect(viewer, { module: "customers", refs: ["customer:1"], scope: "11" })).items[0].receipt!;
    const before = new Set(f.store.states.get("customers")!.seen);
    f.failures.set(f.key(12, methods.customers), new Error("unknown upstream"));
    const failed = (await f.service.summary(viewer)).modules.customers;
    expect(failed).toEqual({ count: 1, available: false, reason: "temporary", lastKnown: true });
    await expect(f.service.markDisplayed(viewer, { receipts: [token] })).rejects.toThrow();
    expect(f.store.states.get("customers")!.seen).toEqual(before);
    expect(f.store.states.get("customers")!.initialized).toBe(true);
  });
  it("source known denial reaches Core while retaining state without presenting a valid last-known proof", async () => {
    const f = integration();
    f.set(11, methods.customers, [event("customer:1")]);
    expect((await f.service.summary(viewer)).modules.customers.count).toBe(1);
    const state = f.store.states.get("customers")!;
    for (const id of [11, 12]) f.failures.set(f.key(id, methods.customers), { code: "FORBIDDEN" });
    expect((await f.service.summary(viewer)).modules.customers).toEqual({
      count: 1, available: false, reason: "denied", lastKnown: false,
    });
    expect(f.store.states.get("customers")).toBe(state);
    expect(state.seen.size).toBe(0);
    expect(state.initialized).toBe(true);
    f.failures.set(f.key(11, methods.customers), new Error("source unknown"));
    expect((await f.service.summary(viewer)).modules.customers).toEqual({
      count: 1, available: false, reason: "temporary", lastKnown: true,
    });
    expect(f.store.states.get("customers")).toBe(state);
  });
  it("revocation of unselected merchant invalidates the full-scope receipt without any seen writes", async () => {
    const f = integration();
    f.set(11, methods.customers, [event("customer:1")]);
    await f.service.summary(viewer);
    const token = (await f.service.inspect(viewer, { module: "customers", refs: ["customer:1"], scope: "merchant:11" })).items[0].receipt!;
    f.scopes.delete(12);
    await expect(f.service.markDisplayed(viewer, { receipts: [token] })).rejects.toThrow();
    expect(f.store.states.get("customers")!.seen.size).toBe(0);
  });
  it("historical rows are baseline; only proven native-admin creation is self-seen; new front creator is new", async () => {
    const f = integration();
    f.set(11, methods.customers, [
      event("customer:1", { version: "created:historical", occurredAt: "2026-11-16T00:00:00.000Z", historical: true }),
      event("customer:2", { actorKey: "admin:7" }),
      event("customer:3", { actorKey: "front:7" }),
      event("customer:4"),
    ]);
    expect((await f.service.summary(viewer)).modules.customers).toEqual({ count: 2, available: true });
    const inspect = await f.service.inspect(viewer, { module: "customers", refs: ["customer:1", "customer:2", "customer:3", "customer:4"] });
    expect(inspect.items.map(row => [row.id, row.isNew])).toEqual([
      ["customer:1", false], ["customer:2", false], ["customer:3", true], ["customer:4", true],
    ]);
  });
  it("same physical sales event seen through native path remains seen through authorized seller alias", async () => {
    const f = integration();
    f.grant("orders"); f.permissions(["orders.read"]);
    const order = event("order:1", { children: ["mall"] });
    f.set(11, methods.seller, [order]);
    f.facts.set("native:orders", result("native-orders", [order]));
    expect((await f.service.summary(viewer)).modules.sales.count).toBe(1);
    const token = (await f.service.inspect(viewer, { module: "sales", refs: ["order:1"], scope: "native:orders" })).items[0].receipt!;
    expect((await f.service.markDisplayed(viewer, { receipts: [token] })).marked).toBe(1);
    expect((await f.service.inspect(viewer, { module: "sales", refs: ["order:1"], scope: "merchant:11" })).items[0].isNew).toBe(false);
    expect((await f.service.summary(viewer)).modules.sales.count).toBe(0);
  });
});

describe("complete unread refs real authorized merchant source integration", () => {
  it("returns global unread refs and scoped complete merchant intersection with <=100 ref RPCs and no seen writes", async () => {
    const f = integration();
    f.set(11, methods.customers, Array.from({ length: 105 }, (_, i) => event(`customer:${i + 1}`)));
    f.set(12, methods.customers, Array.from({ length: 100 }, (_, i) => event(`customer:${i + 106}`)));
    expect((await f.service.unreadRefs(viewer, { module: "customers" })).refs).toHaveLength(205);
    f.reads.readBusinessFacts.mockClear();
    const selected = await f.service.unreadRefs(viewer, { module: "customers", scope: "11" });
    expect(selected.available).toBe(true); expect(selected.refs).toHaveLength(105);
    expect(new Set(selected.refs)).toEqual(new Set(Array.from({ length: 105 }, (_, i) => `customer:${i + 1}`)));
    const lookups = f.reads.readBusinessFacts.mock.calls.filter(call => call[3].refs !== undefined);
    expect(lookups).toHaveLength(6);
    expect(lookups.every(call => call[3].refs!.length <= 100)).toBe(true);
    expect(f.store.states.get("customers")!.seen.size).toBe(0);
    expect(f.store.states.get("customers")!.initialized).toBe(false);
    expect(await f.service.unreadRefs(viewer, { module: "customers", scope: "merchant:999" })).toEqual({ refs: [], available: true });
  });

  it("does not borrow another merchant grant or bypass active local admin/account/session/module read", async () => {
    for (const mutate of [
      (f: ReturnType<typeof integration>) => { f.account.sessionVersion++; },
      (f: ReturnType<typeof integration>) => { f.account.status = "disabled"; },
      (f: ReturnType<typeof integration>) => { f.context.user!.openId = "oauth:7"; },
      (f: ReturnType<typeof integration>) => { for (const scope of f.scopes.values()) scope.modulePermissions = []; },
    ]) {
      const f = integration(); f.set(11, methods.customers, [event("customer:1")]); mutate(f);
      await expect(f.service.unreadRefs(viewer, { module: "customers", scope: "11" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(f.reads.readBusinessFacts).not.toHaveBeenCalled(); expect(f.store.states.size).toBe(0);
    }
    const f = integration();
    f.set(11, methods.customers, [event("customer:1")]); f.set(12, methods.customers, [event("customer:2")]);
    f.scopes.get(11)!.modulePermissions = [];
    expect(await f.service.unreadRefs(viewer, { module: "customers", scope: "11" })).toEqual({ refs: [], available: true });
    expect(await f.service.unreadRefs(viewer, { module: "customers" })).toEqual({ refs: ["customer:2"], available: true });
  });
});
