import { mkdir, readFile, rename, writeFile, lstat, readdir, unlink, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { allowedReferencePageUrl } from "./publicPage";
import { emptyReferenceQuote } from "./worker";
import { matchesLcscBrand, normalizeLcscBrand, normalizeLcscPartNumber } from "./lcscPage";
import { matchChannelReferenceBrand } from "../../shared/channelReferenceBrand";

export type ReferenceMaterial = { materialId: number; partNumber: string; brand: string };
const CACHE_TTL = 20 * 60_000;
const SOURCES: ChannelReferenceSource[] = ["lcsc", "ickey"];
export function referenceCacheKey(source: ChannelReferenceSource, partNumber: string, brand: string): string {
  // Raw trimmed identities are never broader than either provider's matching.
  // Isolate old NFKC-folded cache entries, even in a caller-supplied directory.
  return createHash("sha256").update(JSON.stringify(["page-reference-v2", source, partNumber.trim(), brand.trim()])).digest("hex");
}
function matchesReferenceIdentity(source: ChannelReferenceSource, partNumber: string, brand: string, expected: { partNumber: string; brand: string }): boolean {
  if (source === "lcsc") {
    return !!normalizeLcscPartNumber(expected.partNumber) && !!normalizeLcscBrand(expected.brand)
      && normalizeLcscPartNumber(partNumber) === normalizeLcscPartNumber(expected.partNumber)
      && matchesLcscBrand(expected.brand, brand);
  }
  // Conservative subset of ickeyPage's clean+toUpperCase exact comparison:
  // no NFKC, entity decoding, zero-width or suffix removal. Only approved brand edges.
  const exact = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
  return !!exact(expected.partNumber) && !!exact(expected.brand)
    && exact(partNumber) === exact(expected.partNumber)
    && matchChannelReferenceBrand(expected.brand, brand, { profile: "ickey", normalize: exact }) !== null;
}
export function validCachedReference(value: unknown, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }): value is ChannelReferenceQuote {
  if (!value || typeof value !== "object") return false;
  const q = value as ChannelReferenceQuote;
  if (q.source !== source || !["ok", "not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"].includes(q.status)) return false;
  if (!q.fetchedAt || !q.expiresAt || !Number.isFinite(Date.parse(q.fetchedAt)) || !Number.isFinite(Date.parse(q.expiresAt)) || Date.parse(q.expiresAt) - Date.parse(q.fetchedAt) !== CACHE_TTL) return false;
  if (q.stockQuantity !== null && (!Number.isSafeInteger(q.stockQuantity) || q.stockQuantity < 0)) return false;
  if (!Array.isArray(q.tiers) || q.tiers.length > 50) return false;
  let previous = 0;
  for (const t of q.tiers) {
    if (!Number.isSafeInteger(t.minQuantity) || t.minQuantity <= previous || typeof t.unitPrice !== "string" || t.unitPrice.length > 64 || !/^\d+(?:\.\d+)?$/.test(t.unitPrice) || !/[1-9]/.test(t.unitPrice)) return false;
    previous = t.minQuantity;
  }
  if (q.pageUrl !== null && (typeof q.pageUrl !== "string" || !allowedReferencePageUrl(source, q.pageUrl))) return false;
  for (const key of ["matchedPartNumber", "matchedBrand", "productCode", "packaging", "unit"] as const) if (q[key] !== null && (typeof q[key] !== "string" || q[key]!.length > 256 || /[\u0000-\u001f\u007f]/.test(q[key]!))) return false;
  // Matched identities also accompany price_unavailable: never reuse another
  // product's stock/metadata. Identity-free negative quotes remain cacheable.
  if (q.matchedPartNumber !== null || q.matchedBrand !== null) {
    if (!q.matchedPartNumber || !q.matchedBrand || !matchesReferenceIdentity(source, q.matchedPartNumber, q.matchedBrand, expected)) return false;
  }
  if (!["included", "excluded", "unknown"].includes(q.taxStatus) || ![null, "CNY", "USD", "HKD"].includes(q.currency) || typeof q.stockInsufficientForTier !== "boolean" || q.message !== null) return false;
  if (q.status === "ok") {
    const max = q.tiers.at(-1);
    if (!max || q.unitPrice !== max.unitPrice || q.tierQuantity !== max.minQuantity || !q.pageUrl || !q.currency || !q.matchedPartNumber || !q.matchedBrand || q.stockInsufficientForTier !== (q.stockQuantity !== null && q.stockQuantity < max.minQuantity)) return false;
  } else if (q.unitPrice !== null || q.tierQuantity !== null) return false;
  return true;
}

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
  async function nativeFetch(source: ChannelReferenceSource, expected: { partNumber: string; brand: string }): Promise<ChannelReferenceQuote | null> {
    const key = referenceCacheKey(source, expected.partNumber, expected.brand);
    const worker = fileURLToPath(new URL("./channel-reference-worker.mjs", import.meta.url));
    return new Promise((resolve, reject) => {
      // Kernel locks release on process exit, including admin reload/crash. There
      // are at most two public browser children globally (one per provider).
      const child = spawn("/usr/bin/flock", ["-n", "-E", "75", join(directory, key + ".job.lock"), "/usr/bin/flock", "-n", "-E", "75", join(directory, source + ".provider.lock"), process.execPath, worker, "--public-reference-page", source, expected.partNumber, expected.brand], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), LANG: "C.UTF-8" } });
      const ownedBrowsers: Array<{ pid: number; profile: string }> = [];
      async function terminateOwnedChildren(killWorker = true) {
        if (killWorker && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
        for (const b of ownedBrowsers) {
          const command = await readFile("/proc/" + b.pid + "/cmdline", "utf8").catch(() => "");
          if (command.split("\u0000").includes("--user-data-dir=" + b.profile)) { try { process.kill(-b.pid, "SIGKILL"); } catch {} }
          await rm(b.profile, { recursive: true, force: true }).catch(() => {});
        }
      }
      let text = "", excessive = false;
      const timer = setTimeout(() => { void terminateOwnedChildren(); reject(new Error("Reference child timeout")); }, 75_000);
      child.stdout.on("data", (b: Buffer) => { text += b.toString("utf8"); if (text.length > 32_000) { excessive = true; void terminateOwnedChildren(); } });
      let stderr = "";
      child.stderr.on("data", (b: Buffer) => {
        stderr = (stderr + b.toString("utf8")).slice(-8000);
        for (const line of stderr.split("\n")) if (line.startsWith("CHREF_BROWSER ")) {
          try { const value = JSON.parse(line.slice(14)); if (Number.isSafeInteger(value.pid) && value.pid > 1 && typeof value.profile === "string" && /^\/tmp\/51-public-reference-[A-Za-z0-9]+$/.test(value.profile) && !ownedBrowsers.some(x => x.pid === value.pid)) ownedBrowsers.push(value); } catch {}
        }
      });
      child.once("error", e => { clearTimeout(timer); void terminateOwnedChildren(false).finally(() => reject(e)); });
      child.once("exit", code => {
        clearTimeout(timer);
        void (async () => {
          // The worker is gone: never kill a potentially reused worker PID.
          // Only its explicitly reported, cmdline-verified browser can remain.
          await terminateOwnedChildren(false);
          if (code === 75) { resolve(null); return; }
          if (code !== 0 || excessive) throw new Error("Reference child unavailable");
          const quote: unknown = JSON.parse(text);
          if (!validCachedReference(quote, source, expected)) throw new Error("Invalid reference child result");
          resolve(quote);
        })().catch(reject);
      });
    });
  }
  const fetchQuote = options.fetchQuote ?? nativeFetch;
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
import { createChannelReferenceSnapshotService } from "./snapshot";
const service = createChannelReferenceSnapshotService();
export const lookupChannelReferences = service.lookup;
