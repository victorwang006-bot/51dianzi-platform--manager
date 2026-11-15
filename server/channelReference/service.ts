import { mkdir, readFile, rename, writeFile, lstat, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { emptyReferenceQuote } from "./worker";
import { referenceCacheKey, validCachedReference } from "./quoteValidation";
import { fetchNativeReferenceQuote } from "./nativeWorker";
import { createChannelReferenceSnapshotService } from "./snapshot";
import { createFileConfiguredChannelReferenceService } from "./manualRefreshConfig";
export { referenceCacheKey, validCachedReference } from "./quoteValidation";

export type ReferenceMaterial = { materialId: number; partNumber: string; brand: string };
const CACHE_TTL = 20 * 60_000;
const SOURCES: ChannelReferenceSource[] = ["lcsc", "ickey"];

/** Existing explicit adapter/cache factory, retained for compatible offline callers.
 * Production uses the fixed-file snapshot-first coordinator below, never this
 * cache-miss-triggered adapter. No construction/import-time IO occurs here. */
export function createChannelReferenceService(options: {
  cacheDirectory?: string;
  fetchQuote?: (source: ChannelReferenceSource, expected: { partNumber: string; brand: string }) => Promise<ChannelReferenceQuote | null>;
  now?: () => number;
} = {}) {
  const directory = options.cacheDirectory ?? join(tmpdir(), "51-channel-reference-cache-v2");
  const now = options.now ?? Date.now;
  const jobs = new Map<string, Promise<void>>();
  const chains: Record<ChannelReferenceSource, Promise<void>> = { lcsc: Promise.resolve(), ickey: Promise.resolve() };
  let pruneAt = 0;
  async function ensureDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new Error("Untrusted reference cache");
  }
  const fetchQuote = options.fetchQuote ?? ((source, expected) => fetchNativeReferenceQuote(directory, source, expected));
  async function cached(key: string, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }) {
    try { const value: unknown = JSON.parse(await readFile(join(directory, key + ".json"), "utf8")); return validCachedReference(value, source, expected) ? value : null; } catch { return null; }
  }
  function schedule(source: ChannelReferenceSource, key: string, expected: { partNumber: string; brand: string }, force: boolean) {
    if (jobs.has(key)) return;
    const run = chains[source].catch(() => {}).then(async () => {
      const current = await cached(key, source, expected);
      if (current && Date.parse(current.expiresAt!) > now() && (!force || now() - Date.parse(current.fetchedAt!) < 60_000)) return;
      let quote: ChannelReferenceQuote | null;
      try { quote = await fetchQuote(source, expected); } catch { const fetchedAt = now(); quote = emptyReferenceQuote(source, "unavailable"); quote.fetchedAt = new Date(fetchedAt).toISOString(); quote.expiresAt = new Date(fetchedAt + CACHE_TTL).toISOString(); }
      if (!quote) return; // A different native admin instance owns this job.
      if (!validCachedReference(quote, source, expected)) throw new Error("Invalid public quote");
      const tmp = join(directory, key + "." + randomUUID() + ".tmp");
      await writeFile(tmp, JSON.stringify(quote) + "\n", { mode: 0o600, flag: "wx" });
      await rename(tmp, join(directory, key + ".json"));
    }).catch(() => {}).finally(() => { jobs.delete(key); });
    chains[source] = run; jobs.set(key, run);
  }
  async function lookup(materials: ReferenceMaterial[], settings: { refresh?: boolean } = {}): Promise<ChannelReferenceLookupResult> {
    if (!materials.length || materials.length > 20 || new Set(materials.map(m => m.materialId)).size !== materials.length || materials.some(m => !Number.isSafeInteger(m.materialId) || m.materialId <= 0 || typeof m.partNumber !== "string" || typeof m.brand !== "string" || m.partNumber.length > 128 || m.brand.length > 64 || /[\u0000-\u001f\u007f]/.test(m.partNumber + m.brand))) throw new Error("Invalid approved reference materials");
    await ensureDirectory();
    // Only hashes and public quote JSON belong in this dedicated cache; no actor,
    // tenant/customer/source identifiers, original stock or native quotation data.
    if (now() - pruneAt > CACHE_TTL) { pruneAt = now(); void readdir(directory).then(async files => { for (const f of files) if (/^[a-f0-9]{64}\.json$/.test(f)) { const p = join(directory, f); const stat = await lstat(p); if (now() - stat.mtimeMs > 24 * 60 * 60_000 && !stat.isSymbolicLink()) await unlink(p); } }).catch(() => {}); }
    const items = await Promise.all(materials.map(async material => {
      const references = {} as Record<ChannelReferenceSource, ChannelReferenceQuote>;
      for (const source of SOURCES) {
        if (!material.partNumber.trim() || !material.brand.trim()) { references[source] = emptyReferenceQuote(source, "not_found"); continue; }
        const expected = { partNumber: material.partNumber.trim(), brand: material.brand.trim() };
        const key = referenceCacheKey(source, expected.partNumber, expected.brand), old = await cached(key, source, expected);
        const refresh = !!settings.refresh && !!old && now() - Date.parse(old.fetchedAt!) >= 60_000;
        if (old && Date.parse(old.expiresAt!) > now() && !refresh) references[source] = old;
        else { references[source] = emptyReferenceQuote(source); schedule(source, key, expected, refresh); }
      }
      return { ...material, references };
    }));
    return { items };
  }
  return { lookup, idle: async () => { await Promise.all(Array.from(jobs.values())); } };
}

// The only production entry. File loading is lazy after approved snapshot input
// validation; absent/invalid/disabled configuration is safely snapshot-only.
// No ENV fallback, configurable path, timer, watcher or import-time IO.
const snapshot = createChannelReferenceSnapshotService();
const service = createFileConfiguredChannelReferenceService({ baseLookup: snapshot.lookup });
export const lookupChannelReferences = service.lookup;
