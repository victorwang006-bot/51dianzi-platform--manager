import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createOfficialTechnicalPreparationHook } from "./officialTechnicalPreparation";
import { createOfficialTechnicalPreparedStore } from "./officialTechnicalPreparedStore";
import { officialTechnicalDigest, officialTechnicalResourceSchema, projectPreparedOfficialTechnical, unavailableOfficialTechnicalResource, type OfficialTechnicalIdentity } from "./officialTechnicalResource";
import { readOfficialTechnicalDictionaryRows } from "./officialTechnicalDictionary";
import { projectOfficialMaterialResource } from "./officialTechnicalSafety";
const identity = { publicId: "OM_00000000-0000-4000-8000-000000000001", revision: 2, partNumber: "SYNTHETIC-PART", brand: "ST", pkg: "LQFP48" };
const dictionary = { id: 1, partNumber: identity.partNumber, name: "SYNTHETIC", brand: "ST", package: "LQFP48", category: "MCU", description: "Synthetic only", specs: { Voltage: "3.3V", Current: "<1uA" }, datasheetUrl: null, updatedAt: "2026-11-19T00:00:00.000Z" };
const dialect = new MySqlDialect();
async function fixture(run: (hook: ReturnType<typeof createOfficialTechnicalPreparationHook>, db: any, queries: string[]) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "manager-technical-synthetic-")); const queries: string[] = [];
  const db = { dictionary: { ...dictionary }, dictionaryRows: null as unknown[] | null, broken: false, current: [identity], execute: async (query: any): Promise<any> => {
    const text = dialect.sqlToQuery(query).sql.replace(/\s+/g, " "); queries.push(text);
    if (db.broken) throw Error("PRIVATE SQL outage");
    if (text.startsWith("SELECT c.publicId")) return [db.current, []];
    if (text.startsWith("SELECT id")) return [db.dictionaryRows ?? [db.dictionary], []];
    throw Error("Unexpected SQL");
  } };
  try { await run(createOfficialTechnicalPreparationHook(join(directory, "prepared.json")), db, queries); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("manager actual native technical preparation adapter (no production DB)", () => {
  it("publication current-read locks exact dictionary, keeps sibling brand/package, and source update rebuild is recovered", async () => fixture(async (hook, db, queries) => {
    await hook.preparePublication(db, identity);
    expect((await hook.store.lookup([identity]))[0].state).toBe("ready");
    expect(queries.join("\n")).toContain("FOR SHARE");
    expect(queries.join("\n")).not.toMatch(/qtyStock|qtyOnSale|priceEx|sourceData|ownerAdminUser/);
    const old = (await hook.store.lookup([identity]))[0].parameterVersion;
    const ticket = await hook.beforeSourceMutation([identity.partNumber]);
    db.dictionary = { ...dictionary, specs: { Voltage: "5V" }, updatedAt: "2026-11-19T01:00:00.000Z" };
    await hook.afterSourceCommit(db, [identity.partNumber], ticket);
    const restarted = await createOfficialTechnicalPreparedStore(hook.store.path).lookup([identity]);
    expect(restarted[0].state).toBe("ready"); expect(restarted[0].parameterVersion).not.toBe(old);
    expect(restarted[0].resource?.parameters[0].value).toBe("5V");
  }));
  it("postcommit DB/preparation failure remains persistently unavailable, not old source or fake missing", async () => fixture(async (hook, db) => {
    await hook.preparePublication(db, identity); const ticket = await hook.beforeSourceMutation([identity.partNumber]); db.broken = true;
    await expect(hook.afterSourceCommit(db, [identity.partNumber], ticket)).rejects.toThrow();
    expect((await createOfficialTechnicalPreparedStore(hook.store.path).lookup([identity]))[0].state).toBe("unavailable");
  }));
  it("source-only DB update wrappers invoke mandatory prewrite invalidation and postcommit preparation", () => {
    const source = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
    for (const [start, end] of [["export async function createMaterial(", "export async function updateMaterial("], ["export async function updateMaterial(", "/** 对外“移除”"], ["export async function appendMaterialImage(", "// ─── 商户"]]) {
      const body = source.slice(source.indexOf(start), source.indexOf(end));
      expect(body).toContain("beforeSourceMutation"); expect(body).toContain("finishOfficialTechnicalSourceCommit");
      expect(body).toContain(".catch(async error =>"); expect(body).toContain("abortSourceMutation(preparationTicket)"); expect(body).toContain("throw error;");
      expect(body.indexOf("beforeSourceMutation")).toBeLessThan(body.indexOf(start.includes("create") ? "tx.insert(materials)" : "await tx\n      .update(materials)") >= 0 ? body.indexOf(start.includes("create") ? "tx.insert(materials)" : "await tx\n      .update(materials)") : body.indexOf("tx.update(materials)"));
      expect(body.lastIndexOf("finishOfficialTechnicalSourceCommit")).toBeGreaterThan(body.lastIndexOf("});"));
    }
    expect(source.slice(source.indexOf("export async function archiveMaterial("), source.indexOf("export async function deleteMaterial("))).toContain("return updateMaterial(");
  });
});

describe("actual manager hook pending writer lifecycle", () => {
  it("B1 two rows / same source / reverse commits never ready A3.3, then final A auto fresh repair reads A9", async () => fixture(async (hookA, db, queries) => {
    const B = { ...identity, publicId: "OM_00000000-0000-4000-8000-000000000002", brand: "TI", pkg: "QFN48" };
    db.current = [identity, B]; db.dictionaryRows = [dictionary, { ...dictionary, id: 2, brand: "TI", package: "QFN48", specs: { Voltage: "1.8V" } }];
    await hookA.preparePublication(db, identity);
    const hookB = createOfficialTechnicalPreparationHook(hookA.store.path);
    const ticketA = await hookA.beforeSourceMutation([identity.partNumber]);
    const ticketB = await hookB.beforeSourceMutation([identity.partNumber]);
    db.dictionaryRows = [db.dictionaryRows[0], { ...db.dictionaryRows[1], specs: { Voltage: "5V" } }]; // real committed visibility: B first
    const beforeB = queries.length;
    await expect(hookB.afterSourceCommit(db, [identity.partNumber], ticketB)).rejects.toThrow();
    expect(queries.slice(beforeB).filter(q => q.startsWith("SELECT id"))).toHaveLength(2); // initial + only one safe fresh attempt
    expect((await createOfficialTechnicalPreparedStore(hookA.store.path).lookup([identity, B])).map(item => item.state)).toEqual(["unavailable", "unavailable"]);
    const source = Object.values(JSON.parse(await readFile(hookA.store.path, "utf8")).sources)[0] as any;
    expect(source.pendingWriterTickets).toEqual(Object.values(ticketA)); expect(source.version).toBeNull();
    db.dictionaryRows = [{ ...db.dictionaryRows[0], specs: { Voltage: "9V" } }, db.dictionaryRows[1]]; // A LAST commit
    const beforeA = queries.length;
    await hookA.afterSourceCommit(db, [identity.partNumber], ticketA);
    expect(queries.slice(beforeA).filter(q => q.startsWith("SELECT id"))).toHaveLength(2);
    expect(queries.slice(beforeA).filter(q => q.startsWith("SELECT id")).every(q => q.includes("FOR SHARE"))).toBe(true);
    const served = await createOfficialTechnicalPreparedStore(hookA.store.path).lookup([identity, B]);
    expect(served.map(item => item.resource?.parameters[0].value)).toEqual(["9V", "5V"]);
    expect((Object.values(JSON.parse(await readFile(hookA.store.path, "utf8")).sources)[0] as any).pendingWriterTickets).toEqual([]);
  }));
  it("source query failure still releases committed writer and retries only once, never mislabels DB commit", async () => fixture(async (hook, db, queries) => {
    await hook.preparePublication(db, identity); const tickets = await hook.beforeSourceMutation([identity.partNumber]); db.broken = true;
    const before = queries.length; await expect(hook.afterSourceCommit(db, [identity.partNumber], tickets)).rejects.toThrow();
    expect(queries.length - before).toBe(2);
    expect((Object.values(JSON.parse(await readFile(hook.store.path, "utf8")).sources)[0] as any)).toMatchObject({ version: null, pendingWriterTickets: [] });
    db.broken = false; await hook.preparePublication(db, identity); expect((await hook.store.lookup([identity]))[0].state).toBe("ready");
  }));
  it("abort cleanup failure does not run a fresh reader or steal an outstanding pending writer", async () => fixture(async (hook, db) => {
    await hook.preparePublication(db, identity); const tickets = await hook.beforeSourceMutation([identity.partNumber]);
    const complete = vi.spyOn(hook.store, "complete").mockRejectedValue(Error("synthetic preparation failure"));
    const abort = vi.spyOn(hook.store, "abortSourceMutation").mockRejectedValue(Error("synthetic cleanup failure"));
    const prepare = vi.spyOn(hook.store, "prepare");
    await expect(hook.afterSourceCommit(db, [identity.partNumber], tickets)).rejects.toThrow("synthetic cleanup failure");
    expect(prepare).not.toHaveBeenCalled(); expect((await createOfficialTechnicalPreparedStore(hook.store.path).lookup([identity]))[0].state).toBe("unavailable");
    complete.mockRestore(); abort.mockRestore(); prepare.mockRestore();
  }));
});

describe("anonymous bulk store linear work (no DB, no real identities)", () => {
  const bulkItems = (count = 20002): OfficialTechnicalIdentity[] => Array.from({ length: count }, (_, index) => ({
    publicId: `OM_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: 1, partNumber: `ANONYMOUS-BULK-${String(index).padStart(5, "0")}`, brand: "ST", pkg: "LQFP48",
  }));
  const missingReader = async (items: readonly OfficialTechnicalIdentity[]) => items.map(item => ({
    state: "missing" as const, sourceVersion: officialTechnicalDigest(item.partNumber.normalize("NFKC").trim().toUpperCase()),
  }));
  const readyRead = (item: OfficialTechnicalIdentity) => ({
    state: "matched" as const, sourceVersion: officialTechnicalDigest(item.partNumber.normalize("NFKC").trim().toUpperCase()),
    dictionary: { partNumber: item.partNumber, name: "Anonymous", brand: item.brand, package: item.pkg, category: "Synthetic", description: "Anonymous only", specs: { Voltage: "3.3V" }, datasheetUrl: null },
  });
  async function bulkFixture(run: (path: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "anonymous-store-bulk-"));
    try { await run(join(directory, "prepared.json")); } finally { await rm(directory, { recursive: true, force: true }); }
  }
  it("20002 unique models prepare/restart/lookup and pending failure then fresh ready without weakening fences", async () => bulkFixture(async path => {
    const started = Date.now(); const stages: Record<string, number> = {}; const items = bulkItems();
    const store = createOfficialTechnicalPreparedStore(path); const reader = vi.fn(missingReader);
    const initial = await store.prepare(items, reader); stages.initialPrepareMs = Date.now() - started;
    expect(reader).toHaveBeenCalledTimes(1); expect(initial).toHaveLength(20002);
    expect(initial.every(resource => resource.state === "missing" && resource.resource?.parameters.length === 0)).toBe(true);
    const saved = await readFile(path, "utf8"); const initialBytes = Buffer.byteLength(saved); const initialDoc = JSON.parse(saved);
    expect(initialBytes).toBeLessThan(32 * 1024 * 1024); expect(initialDoc.entries).toHaveLength(20002);
    expect(Object.keys(initialDoc.sources)).toHaveLength(20002); expect(initialDoc.generation).toBe(2);
    expect(initialDoc.entries.map((entry: any) => entry.identity.publicId)).toEqual(items.map(item => item.publicId));
    const lookupStarted = Date.now(); const restarted = createOfficialTechnicalPreparedStore(path);
    const rebound = await restarted.lookup(items.map(item => ({ ...item, revision: 2 }))); stages.restartLookupMs = Date.now() - lookupStarted;
    expect(rebound.every(resource => resource.state === "missing" && resource.resource?.revision === 2)).toBe(true);
    expect(rebound[0].parameterVersion).toBe(`tp1_${officialTechnicalDigest({ identity: { ...items[0], revision: 2 }, sourceVersion: initialDoc.entries[0].sourceVersion, projectionVersion: initialDoc.entries[0].projectionVersion, resource: rebound[0].resource })}`);
    rebound[0].resource!.parameters.push({ name: "Anonymous mutation", value: "not persisted" });
    expect((await restarted.lookup([items[0]]))[0].resource?.parameters).toEqual([]); expect(await readFile(path, "utf8")).toBe(saved);
    const pendingStarted = Date.now(); const writer = await store.beginSourceMutation([items[0].partNumber]);
    await expect(store.prepare(items, reader)).rejects.toThrow("准备失败");
    const failedDoc = JSON.parse(await readFile(path, "utf8")); expect(failedDoc.entries).toHaveLength(0);
    expect(failedDoc.sources[Object.keys(writer)[0]]).toMatchObject({ version: null, pendingWriterTickets: Object.values(writer) });
    expect(Object.values(failedDoc.sources).every((source: any) => source.version === null)).toBe(true);
    await expect(store.complete([items[0]], writer, missingReader)).rejects.toThrow("准备失败");
    expect(JSON.parse(await readFile(path, "utf8")).sources[Object.keys(writer)[0]].pendingWriterTickets).toEqual([]);
    expect((await restarted.lookup([items[0], items[items.length - 1]])).every(resource => resource.state === "unavailable")).toBe(true);
    stages.pendingFailureAndSettlementMs = Date.now() - pendingStarted;
    const freshStarted = Date.now(); const fresh = await store.prepare(items, async current => {
      const reads = await missingReader(current); return reads.map((read, index) => index === 0 ? readyRead(current[index]) : read);
    });
    expect(fresh[0].state).toBe("ready"); expect(fresh[0].resource?.parameters).toEqual([{ name: "Voltage", value: "3.3V" }]);
    const final = await createOfficialTechnicalPreparedStore(path).lookup(items);
    expect(final[0]).toEqual(fresh[0]); expect(final.slice(1).every(resource => resource.state === "missing")).toBe(true);
    const finalSaved = await readFile(path, "utf8"); const finalDoc = JSON.parse(finalSaved);
    expect(finalDoc.entries).toHaveLength(20002); expect(Object.values(finalDoc.sources).every((source: any) => source.pendingWriterTickets.length === 0 && source.version !== null)).toBe(true);
    stages.freshPrepareAndLookupMs = Date.now() - freshStarted;
    console.info("ANONYMOUS_STORE_BULK_METRICS", JSON.stringify({ count: items.length, initialBytes, finalBytes: Buffer.byteLength(finalSaved), ...stages, elapsedMs: Date.now() - started }));
  }), 120_000);
  it("20002 reads reject nonadjacent normalized same-model inconsistent versions, settle only own writers, then fresh identical source is ready", async () => bulkFixture(async path => {
    const started = Date.now(); const items = bulkItems(); items[items.length - 1].partNumber = items[0].partNumber.toLowerCase();
    const store = createOfficialTechnicalPreparedStore(path); const tickets = await store.beginSourceMutation(items.map(item => item.partNumber));
    await expect(store.complete(items, tickets, async current => {
      const reads = await missingReader(current); reads[reads.length - 1].sourceVersion = officialTechnicalDigest("anonymous conflicting source version"); return reads;
    })).rejects.toThrow("准备失败");
    const doc = JSON.parse(await readFile(path, "utf8")); expect(doc.entries).toHaveLength(0); expect(Object.keys(doc.sources)).toHaveLength(20001);
    expect(Object.values(doc.sources).every((source: any) => source.version === null && source.pendingWriterTickets.length === 0)).toBe(true);
    const pair = [items[0], items[items.length - 1]];
    expect((await createOfficialTechnicalPreparedStore(path).lookup(pair)).map(resource => resource.state)).toEqual(["unavailable", "unavailable"]);
    await store.prepare(pair, async current => current.map(readyRead));
    expect((await createOfficialTechnicalPreparedStore(path).lookup(pair)).map(resource => resource.state)).toEqual(["ready", "ready"]);
    console.info("ANONYMOUS_STORE_INCONSISTENT_METRICS", JSON.stringify({ count: items.length, elapsedMs: Date.now() - started, failedEntries: doc.entries.length, sourceCount: Object.keys(doc.sources).length }));
  }), 120_000);
  it("target-ID replacement preserves survivor/incoming order and ticket-only source eviction removes every sibling", async () => bulkFixture(async path => {
    const items = bulkItems(5); items[1].partNumber = items[0].partNumber;
    const store = createOfficialTechnicalPreparedStore(path); await store.prepare(items, missingReader);
    const moved = { ...items[2], partNumber: "ANONYMOUS-MOVED-NEW" }; const incoming = [moved, items[0]];
    const tickets = await store.invalidate([moved.partNumber, items[0].partNumber, items[4].partNumber]);
    await store.complete(incoming, tickets, missingReader);
    const doc = JSON.parse(await readFile(path, "utf8"));
    expect(doc.entries.map((entry: any) => entry.identity.publicId)).toEqual([items[3].publicId, moved.publicId, items[0].publicId]);
    expect((await store.lookup([items[1], items[4], items[2]])).map(resource => resource.state)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(doc.sources[officialTechnicalDigest(items[4].partNumber)].version).toBeNull();
    expect((await store.lookup(incoming)).map(resource => resource.state)).toEqual(["missing", "missing"]);
  }));
});

describe("pure technical parameter boundary (exact canonical names, no inventory cache)", () => {
  const financialNames = [
    "price", "unitprice", "saleprice", "purchaseprice", "cost", "unitcost",
    "quote", "quoteprice", "quotation", "stock", "stockqty", "stockquantity", "inventory", "inventoryqty",
    "inventoryquantity", "quantity", "qty", "availablequantity", "价格", "单价", "售价", "采购价", "成本",
    "报价", "报价金额", "库存", "库存量", "库存数量", "数量",
  ];
  const boundaryRow = (specs: Record<string, string>) => ({ id: 1, partNumber: identity.partNumber, name: "Anonymous transistor", brand: identity.brand, package: identity.pkg, category: "Transistor", description: "Technical only", specs, datasheetUrl: null, updatedAt: "2026-11-19T00:00:00.000Z" });
  const boundaryRead = (specs: Record<string, string>) => readOfficialTechnicalDictionaryRows([identity], [boundaryRow(specs)])[0];
  const project = (specs: Record<string, string>) => projectPreparedOfficialTechnical(identity, boundaryRead(specs));
  const base = () => project({ Voltage: "3.3V" }).resource!;
  const fullwidth = (text: string) => text.replace(/[!-~]/g, char => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
  it.each(financialNames)("rejects every known exact financial name and canonical variants: %s", name => {
    const variants = [name, name.toUpperCase(), fullwidth(name.toUpperCase()), ` ${name} `, name.split("").join("_ .-")];
    for (const variant of variants) {
      for (const value of name === "数量" ? ["1", "1pcs"] : ["1", "1个N沟道"]) {
        expect(officialTechnicalResourceSchema.safeParse({ ...base(), parameters: [{ name: variant, value }] }).success).toBe(false);
        expect(project({ Voltage: "3.3V", [variant]: value })).toEqual(unavailableOfficialTechnicalResource());
      }
    }
  });
  it.each([1, 2, 64].flatMap(count => ["N沟道", "P沟道", "NPN", "PNP"].map(term => `${count}个${term}`)))("allows only a whole intrinsic transistor count: %s", value => {
    const result = project({ 数量: value, Voltage: "3.3V" });
    expect(result.state).toBe("ready");
    expect(result.resource?.parameters).toEqual([{ name: "数量", value }, { name: "Voltage", value: "3.3V" }]);
    expect(officialTechnicalResourceSchema.safeParse(result.resource).success).toBe(true);
  });
  it("normalizes the quantity exception without adding transformations beyond the legacy text projection", () => {
    const name = " 数_量 "; const value = " ６４个ＮＰＮ ";
    const result = project({ [name]: value });
    expect(result.state).toBe("ready"); expect(result.resource?.parameters).toEqual([{ name: name.trim(), value: value.trim() }]);
  });
  it.each([
    "0个N沟道", "65个N沟道", "01个N沟道", "3", "1pcs", "1个", "1个件", "1个包装", "1个库存", "1个销售",
    "1个price", "1个N沟道库存", "库存1个N沟道", "1个N沟道 销售", "1个n沟道", "1 个N沟道", "1个 NPN",
    "1个NPN\n库存", "<script>alert(1)</script>", "1个NPN https://example.com/a", "https%3A%2F%2Finternal.local%2Fstock",
  ])("does not exempt low/unknown/commerce/script/URL quantity values: %s", value => {
    expect(project({ 数量: value, Voltage: "3.3V" })).toEqual(unavailableOfficialTechnicalResource());
    expect(officialTechnicalResourceSchema.safeParse({ ...base(), parameters: [{ name: "数量", value }] }).success).toBe(false);
  });
  it.each(["通道数量", "芯片通道", "channel quantity", "stock voltage"])("does not substring-block a legitimate technical name: %s", name => {
    const result = project({ [name]: "4" });
    expect(result.state).toBe("ready"); expect(result.resource?.parameters).toEqual([{ name, value: "4" }]);
  });
  it("preserves all 1000 parameters, rejects 1001 as unavailable, and leaves legacy default 100 unchanged", () => {
    const specs = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`Technical ${index}`, `${index}V`]));
    const read = boundaryRead(specs); if (read.state !== "matched") throw Error("Anonymous fixture mismatch");
    expect(projectPreparedOfficialTechnical(identity, read).resource?.parameters).toHaveLength(1000);
    expect(projectOfficialMaterialResource(identity, read.dictionary).parameters).toHaveLength(100);
    expect(project({ ...specs, Overflow: "1V" })).toEqual(unavailableOfficialTechnicalResource());
  });
  async function boundaryStore(run: (path: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "technical-boundary-anonymous-"));
    try { await run(join(directory, "prepared.json")); } finally { await rm(directory, { recursive: true, force: true }); }
  }
  it("a native source update containing financial params settles fail-closed and never persists or silently drops them", async () => boundaryStore(async path => {
    const store = createOfficialTechnicalPreparedStore(path);
    await store.prepare([identity], async () => [boundaryRead({ Voltage: "3.3V" })]);
    for (const name of ["价格", "库存量", "quantity", "数量"]) {
      const tickets = await store.beginSourceMutation([identity.partNumber]);
      const invalid = boundaryRead({ Voltage: "5V", [name]: "BOUNDARY_FINANCIAL_DO_NOT_CACHE" });
      await expect(store.complete([identity], tickets, async () => [invalid])).rejects.toThrow("准备失败");
      const saved = await readFile(path, "utf8"); const document = JSON.parse(saved);
      expect(saved).not.toContain("BOUNDARY_FINANCIAL_DO_NOT_CACHE"); expect(document.entries).toEqual([]);
      expect(Object.values(document.sources).every((source: any) => source.version === null && source.pendingWriterTickets.length === 0)).toBe(true);
      expect(await createOfficialTechnicalPreparedStore(path).lookup([identity])).toEqual([unavailableOfficialTechnicalResource()]);
      await expect(store.prepare([identity], async () => [invalid])).rejects.toThrow("准备失败");
      expect(await createOfficialTechnicalPreparedStore(path).lookup([identity])).toEqual([unavailableOfficialTechnicalResource()]);
    }
  }));
  it("an extra raw source price contributes only to sourceVersion hashing and never to persisted projection", async () => boundaryStore(async path => {
    const raw = { ...boundaryRow({ Voltage: "3.3V" }), priceEx: "RAW_PRICE_DO_NOT_CACHE" };
    const read = readOfficialTechnicalDictionaryRows([identity], [raw])[0];
    expect(read.sourceVersion).not.toBe(boundaryRead({ Voltage: "3.3V" }).sourceVersion);
    const result = await createOfficialTechnicalPreparedStore(path).prepare([identity], async () => [read]);
    expect(result[0].state).toBe("ready"); expect(result[0].resource?.parameters).toEqual([{ name: "Voltage", value: "3.3V" }]);
    const saved = await readFile(path, "utf8"); expect(saved).not.toContain("RAW_PRICE_DO_NOT_CACHE"); expect(saved).not.toContain("priceEx");
  }));
});

describe("native technical update cannot bypass the pure-technical parameter boundary", () => {
  it("financial postcommit params cannot be cached even after the single native fresh repair", async () => fixture(async (hook, db, queries) => {
    await hook.preparePublication(db, identity);
    for (const name of ["价格", "库存量", "quantity", "数量"]) {
      const tickets = await hook.beforeSourceMutation([identity.partNumber]);
      db.dictionary = { ...dictionary, specs: { Voltage: "5V", [name]: "NATIVE_FINANCIAL_DO_NOT_CACHE" } };
      const beforeQueries = queries.length;
      await expect(hook.afterSourceCommit(db, [identity.partNumber], tickets)).rejects.toThrow("准备失败");
      expect(queries.slice(beforeQueries).filter(text => text.startsWith("SELECT id"))).toHaveLength(2);
      expect(queries.slice(beforeQueries).every(text => text.startsWith("SELECT"))).toBe(true);
      const saved = await readFile(hook.store.path, "utf8"); const document = JSON.parse(saved);
      expect(saved).not.toContain("NATIVE_FINANCIAL_DO_NOT_CACHE"); expect(document.entries).toEqual([]);
      expect(Object.values(document.sources).every((source: any) => source.version === null && source.pendingWriterTickets.length === 0)).toBe(true);
      expect(await createOfficialTechnicalPreparedStore(hook.store.path).lookup([identity])).toEqual([unavailableOfficialTechnicalResource()]);
    }
  }));
});
