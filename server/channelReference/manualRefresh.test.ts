import { describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createManualChannelReferenceService } from "./manualRefresh";
import { emptyReferenceQuote } from "./worker";
import { assertPrivateReferenceDirectory } from "./referenceStore";
import { referenceCacheKey } from "./quoteValidation";
import type { PublicReferenceEvidence } from "./nativeWorker";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";

const materials = [{ materialId: 1, partNumber: "P-1-TR/NOPB", brand: "ST" }];
const sourceSha256 = createHash("sha256").update("synthetic offline evidence only").digest("hex");
const positive = (source: ChannelReferenceSource, now: number, partNumber = materials[0].partNumber): ChannelReferenceQuote => ({ ...emptyReferenceQuote(source, "ok"), matchedPartNumber: partNumber, matchedBrand: "ST(意法半导体)", productCode: "C123", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/123.html" : "https://www.ickey.cn/detail/123/P-1.html", stockQuantity: null, unitPrice: "0.0010901", tierQuantity: 100, tiers: [{ minQuantity: 1, unitPrice: "0.01" }, { minQuantity: 100, unitPrice: "0.0010901" }], currency: "CNY", unit: "个", fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(), stockInsufficientForTier: false });
const evidence = (source: ChannelReferenceSource, now: number, partNumber?: string): PublicReferenceEvidence => ({ quote: positive(source, now, partNumber), sourceSha256, sourcePageUrl: source === "lcsc" ? "https://so.szlcsc.com/global.html?k=P-1" : "https://search.ickey.cn/?keyword=P-1" });
const baseLookup = async (list: typeof materials): Promise<ChannelReferenceLookupResult> => ({ items: list.map(m => ({ materialId: m.materialId, partNumber: m.partNumber, brand: m.brand, references: { lcsc: emptyReferenceQuote("lcsc", "unavailable"), ickey: emptyReferenceQuote("ickey", "not_found") } })) });
async function directory() { const dir = await mkdtemp(join(tmpdir(), "manual-reference-test-")); await chmod(dir, 0o700); return dir; }

describe("explicit administrator reference refresh only (offline suppliers, real temporary FS/flock)", () => {
  it("does not initialize a cache or fetch on normal missing/default reads, including disabled explicit refresh", async () => {
    const fetchEvidence = vi.fn(), dir = join(tmpdir(), "must-not-create-reference-" + Date.now());
    const service = createManualChannelReferenceService({ baseLookup, cacheDirectory: dir, fetchEvidence });
    expect(await service.lookup(materials)).toEqual(await baseLookup(materials));
    expect((await service.lookup(materials, { refresh: true })).refreshDiagnostics?.every(d => d.state === "disabled")).toBe(true);
    expect(fetchEvidence).not.toHaveBeenCalled(); await expect(readdir(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("queues once, preserves suffixes, coalesces duplicate current rows, then false polls observe durable results without fetching", async () => {
    const dir = await directory(); let now = Date.now();
    const fetchEvidence = vi.fn(async (source: ChannelReferenceSource, expected: typeof materials[0]) => evidence(source, now, expected.partNumber));
    const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence, now: () => now });
    try {
      const duplicate = [...materials, { ...materials[0], materialId: 2 }];
      expect((await service.lookup(duplicate)).items[0].references.lcsc.status).toBe("unavailable"); expect(fetchEvidence).not.toHaveBeenCalled();
      const initial = await service.lookup(duplicate, { refresh: true });
      expect(initial.items.every(m => m.references.lcsc.status === "pending")).toBe(true);
      expect(initial.refreshDiagnostics?.every(d => d.state === "queued")).toBe(true);
      await service.lookup(duplicate, { refresh: true }); await service.idle();
      expect(fetchEvidence).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 3; i++) {
        const result = await service.lookup(duplicate, { refresh: false });
        expect(result.items[0].references.lcsc).toMatchObject({ status: "ok", unitPrice: "0.0010901", stockQuantity: null, matchedPartNumber: materials[0].partNumber });
        expect(result.refreshDiagnostics?.[0]).toMatchObject({ state: "cooldown", sourceSha256, lastAttemptStatus: "ok" });
      }
      now += 24 * 60 * 60_000;
      await service.lookup(duplicate, { refresh: true }); await service.idle(); expect(fetchEvidence).toHaveBeenCalledTimes(2); // Existing successful reference versions never refreshed.
      const stored = await readFile(join(dir, "state.json"), "utf8");
      for (const forbidden of ["materialId", "actor", "tenant", "customer", "nativePrice", "originalStock"]) expect(stored).not.toContain(forbidden);
      expect(stored).toContain(sourceSha256);
    } finally { await service.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it("never fetches/replaces immutable base successes and preserves a successful manual quote across later attempts", async () => {
    const dir = await directory(), now = Date.now();
    const withBaseSuccess = async (list: typeof materials) => { const base = await baseLookup(list); for (const m of base.items) m.references.lcsc = positive("lcsc", now, m.partNumber); return base; };
    const fetchEvidence = vi.fn(async (_source: ChannelReferenceSource) => { throw new Error("Synthetic supplier failure"); });
    const service = createManualChannelReferenceService({ baseLookup: withBaseSuccess, enabled: true, cacheDirectory: dir, fetchEvidence });
    try {
      const initial = await service.lookup(materials, { refresh: true }); expect(initial.items[0].references.lcsc.status).toBe("ok"); expect(initial.items[0].references.ickey.status).toBe("pending");
      await service.idle(); expect(fetchEvidence).toHaveBeenCalledTimes(1); expect(fetchEvidence.mock.calls[0][0]).toBe("ickey");
      const result = await service.lookup(materials); expect(result.items[0].references.lcsc).toEqual(positive("lcsc", now)); expect(result.items[0].references.ickey.status).toBe("unavailable");
      await service.lookup(materials, { refresh: true }); await service.idle(); expect(fetchEvidence).toHaveBeenCalledTimes(1);
    } finally { await service.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it("coalesces duplicate work across two administrators and globally serializes both providers", async () => {
    const dir = await directory(); const now = Date.now(); let active = 0, maximum = 0;
    const calls: string[] = []; const releases: Array<() => void> = [];
    const fetchEvidence = vi.fn(async (source: ChannelReferenceSource) => { calls.push(source); maximum = Math.max(maximum, ++active); await new Promise<void>(resolve => releases.push(resolve)); active--; return evidence(source, now); });
    const first = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence });
    const second = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence });
    try {
      await Promise.all([first.lookup(materials, { refresh: true }), second.lookup(materials, { refresh: true })]);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const pending = await second.lookup(materials); expect(pending.items[0].references.lcsc.status).toBe("pending");
      releases.shift()!(); await vi.waitFor(() => expect(calls).toHaveLength(2)); expect(maximum).toBe(1);
      releases.shift()!(); await Promise.all([first.idle(), second.idle()]); expect(fetchEvidence).toHaveBeenCalledTimes(2);
      expect((await second.lookup(materials)).items[0].references.lcsc.status).toBe("ok");
    } finally { releases.forEach(release => release()); await Promise.all([first.idle(), second.idle()]); await rm(dir, { recursive: true, force: true }); }
  });
  it("stops a challenged source without retry, including after cooldown and across instances", async () => {
    const dir = await directory(); let now = Date.now();
    const fetchEvidence = vi.fn(async (source: ChannelReferenceSource) => source === "lcsc" ? { quote: { ...emptyReferenceQuote(source, "access_restricted"), fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString() }, sourceSha256: null, sourcePageUrl: null } : evidence(source, now));
    const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence, now: () => now });
    try {
      await service.lookup(materials, { refresh: true }); await service.idle();
      expect((await service.lookup(materials)).refreshDiagnostics?.[0]).toMatchObject({ state: "blocked", lastAttemptStatus: "access_restricted" });
      now += 24 * 60 * 60_000;
      const other = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence, now: () => now });
      await other.lookup(materials, { refresh: true }); await other.idle(); expect(fetchEvidence).toHaveBeenCalledTimes(2);
    } finally { await service.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it.each([{ matchedPartNumber: "P-1" }, { matchedBrand: "ST(先科)" }, { tiers: [null] }, { actorUserId: 88 }])("rejects current producer output with wrong identity/schema %j", async change => {
    const dir = await directory(), now = Date.now();
    const fetchEvidence = vi.fn(async (source: ChannelReferenceSource) => ({ ...evidence(source, now), quote: { ...positive(source, now), ...change } as ChannelReferenceQuote }));
    const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence });
    try { await service.lookup(materials, { refresh: true }); await service.idle(); const result = await service.lookup(materials); expect(result.items[0].references.lcsc.status).toBe("unavailable"); expect(result.items[0].references.lcsc.stockQuantity).toBeNull(); }
    finally { await service.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it("enforces queue cap across current pages without admitting unapproved identities", async () => {
    const dir = await directory(); let now = Date.now(); let releaseFirst!: () => void; let call = 0;
    const withOneFailure = async (list: typeof materials) => { const result = await baseLookup(list); for (const m of result.items) m.references.ickey = positive("ickey", now, m.partNumber); return result; };
    const fetchEvidence = vi.fn(async (source: ChannelReferenceSource, expected: { partNumber: string }) => { if (++call === 1) await new Promise<void>(resolve => { releaseFirst = resolve; }); now += 60_001; return evidence(source, now, expected.partNumber); });
    const service = createManualChannelReferenceService({ baseLookup: withOneFailure, enabled: true, cacheDirectory: dir, fetchEvidence, now: () => now });
    try {
      const list = Array.from({ length: 20 }, (_, i) => ({ ...materials[0], materialId: i + 1, partNumber: "P-" + i }));
      await service.lookup(list, { refresh: true }); await vi.waitFor(() => expect(call).toBe(1));
      const overflow = await service.lookup([{ ...materials[0], materialId: 21, partNumber: "P-21" }], { refresh: true });
      expect(overflow.refreshDiagnostics?.[0].state).toBe("queue_full"); expect(overflow.items[0].references.lcsc.status).toBe("unavailable");
      releaseFirst(); await service.idle(); expect(fetchEvidence.mock.calls.length).toBeLessThanOrEqual(20);
    } finally { releaseFirst?.(); await service.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it("refuses symlink/permissive/OPS cache paths and keeps valid base results", async () => {
    const dir = await directory(), alias = dir + "-link", fetchEvidence = vi.fn();
    try {
      await symlink(dir, alias); await expect(assertPrivateReferenceDirectory(alias)).rejects.toThrow();
      await expect(assertPrivateReferenceDirectory("/opt/ops/new-cache")).rejects.toThrow();
      await chmod(dir, 0o755); const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence });
      expect((await service.lookup(materials, { refresh: true })).refreshDiagnostics?.[0].state).toBe("unavailable"); expect(fetchEvidence).not.toHaveBeenCalled();
      await chmod(dir, 0o700); await symlink(join(dir, "missing"), join(dir, "state.json"));
      expect((await service.lookup(materials, { refresh: true })).refreshDiagnostics?.[0].state).toBe("unavailable"); expect(fetchEvidence).not.toHaveBeenCalled();
    } finally { await rm(alias, { force: true }); await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects corrupted or unexpected persisted fields, without default live fallback", async () => {
    const dir = await directory(), fetchEvidence = vi.fn();
    try {
      await writeFile(join(dir, "state.json"), JSON.stringify({ schemaVersion: 1, actorUserId: 99 }), { mode: 0o600 });
      const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence });
      expect((await service.lookup(materials)).items[0].references.lcsc.status).toBe("unavailable"); expect(fetchEvidence).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reports abandoned running attempts as failed, and never-started queue expiry without an invented attempt time", async () => {
    const dir = await directory(), now = Date.now(), fetchEvidence = vi.fn();
    const key = referenceCacheKey("lcsc", materials[0].partNumber, materials[0].brand);
    const record = { source: "lcsc", partNumber: materials[0].partNumber, brand: materials[0].brand, state: "running", queuedAt: now - 100_000, startedAt: (now - 100_000) as number | null, finishedAt: null, attemptId: "11111111-1111-1111-1111-111111111111", quote: null, sourceSha256: null, sourcePageUrl: null, version: null };
    const state = { schemaVersion: 1, providers: { lcsc: { nextAllowedAt: 0, blocked: false }, ickey: { nextAllowedAt: 0, blocked: false } }, records: { [key]: record } };
    const service = createManualChannelReferenceService({ baseLookup, enabled: true, cacheDirectory: dir, fetchEvidence, now: () => now });
    try {
      await writeFile(join(dir, "state.json"), JSON.stringify(state), { mode: 0o600 });
      const failed = await service.lookup(materials);
      expect(failed.items[0].references.lcsc.status).toBe("unavailable");
      expect(failed.refreshDiagnostics?.[0]).toMatchObject({ lastAttemptStatus: "unavailable", lastAttemptAt: new Date(now - 100_000).toISOString() });
      record.state = "queued"; record.queuedAt = now - 11 * 60_000; record.startedAt = null;
      await writeFile(join(dir, "state.json"), JSON.stringify(state), { mode: 0o600 });
      const unstarted = await service.lookup(materials);
      expect(unstarted.refreshDiagnostics?.[0]).toMatchObject({ state: "completed", lastAttemptStatus: null, lastAttemptAt: null });
      expect(fetchEvidence).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
