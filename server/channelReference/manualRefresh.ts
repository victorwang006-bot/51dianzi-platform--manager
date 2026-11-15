import { createHash, randomUUID } from "node:crypto";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import type { ChannelReferenceRefreshDiagnostic } from "../../shared/channelReferenceRefresh";
import { emptyReferenceQuote } from "./worker";
import { referenceCacheKey, validCachedReference } from "./quoteValidation";
import { fetchNativeReferenceEvidence, type PublicReferenceEvidence } from "./nativeWorker";
import { allowedReferencePageUrl } from "./publicPage";
import { acquireReferenceLock, assertPrivateReferenceDirectory, prepareReferenceLock, readReferenceState, withReferenceStateLock, writeReferenceState } from "./referenceStore";

const SOURCES: ChannelReferenceSource[] = ["lcsc", "ickey"];
const IDENTITY_COOLDOWN = 20 * 60_000;
const SOURCE_COOLDOWN = 60_000;
const QUEUE_LIFETIME = 10 * 60_000;
const ATTEMPT_TIMEOUT = 80_000;
const MAX_QUEUE = 20;
const MAX_RECORDS = 1000;
type PublicIdentity = { partNumber: string; brand: string };
type ApprovedMaterial = PublicIdentity & { materialId: number };
type RecordState = {
  source: ChannelReferenceSource; partNumber: string; brand: string;
  state: "queued" | "running" | "completed";
  queuedAt: number; startedAt: number | null; finishedAt: number | null;
  attemptId: string; quote: ChannelReferenceQuote | null;
  sourceSha256: string | null; sourcePageUrl: string | null; version: string | null;
};
type State = { schemaVersion: 1; providers: Record<ChannelReferenceSource, { nextAllowedAt: number; blocked: boolean }>; records: Record<string, RecordState> };
export type ManualReferenceLookupResult = ChannelReferenceLookupResult & { refreshDiagnostics?: ChannelReferenceRefreshDiagnostic[] };
const timestamp = (value: number | null) => value === null ? null : new Date(value).toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(v);
const emptyState = (): State => ({ schemaVersion: 1, providers: { lcsc: { nextAllowedAt: 0, blocked: false }, ickey: { nextAllowedAt: 0, blocked: false } }, records: {} });
function validateState(raw: unknown): State {
  if (raw === null) return emptyState();
  if (!keys(raw, ["schemaVersion", "providers", "records"]) || raw.schemaVersion !== 1 || !keys(raw.providers, SOURCES) || !object(raw.records) || Object.keys(raw.records).length > MAX_RECORDS) throw new Error("Invalid manual reference state");
  for (const source of SOURCES) {
    const p = raw.providers[source];
    if (!keys(p, ["nextAllowedAt", "blocked"]) || !time(p.nextAllowedAt) || typeof p.blocked !== "boolean") throw new Error("Invalid provider state");
  }
  for (const [key, r] of Object.entries(raw.records)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !keys(r, ["source", "partNumber", "brand", "state", "queuedAt", "startedAt", "finishedAt", "attemptId", "quote", "sourceSha256", "sourcePageUrl", "version"]) || !SOURCES.includes(r.source as ChannelReferenceSource) || !text(r.partNumber, 128) || !text(r.brand, 64) || !["queued", "running", "completed"].includes(r.state as string) || !time(r.queuedAt) || !(r.startedAt === null || time(r.startedAt)) || !(r.finishedAt === null || time(r.finishedAt)) || typeof r.attemptId !== "string" || !/^[a-f0-9-]{36}$/.test(r.attemptId) || referenceCacheKey(r.source as ChannelReferenceSource, r.partNumber, r.brand) !== key) throw new Error("Invalid public identity state");
    if (r.quote !== null && !validCachedReference(r.quote, r.source as ChannelReferenceSource, { partNumber: r.partNumber, brand: r.brand })) throw new Error("Invalid saved public quote");
    if (!(r.sourceSha256 === null || typeof r.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(r.sourceSha256)) || !(r.version === null || typeof r.version === "string" && /^[a-f0-9]{64}$/.test(r.version)) || !(r.sourcePageUrl === null || typeof r.sourcePageUrl === "string" && allowedReferencePageUrl(r.source as ChannelReferenceSource, r.sourcePageUrl))) throw new Error("Invalid reference evidence state");
    if (r.quote && r.version !== hash(JSON.stringify({ quote: r.quote, sourceSha256: r.sourceSha256, sourcePageUrl: r.sourcePageUrl }))) throw new Error("Invalid public reference version digest");
    if ((r.quote as ChannelReferenceQuote | null)?.status === "ok" && (!r.sourceSha256 || !r.sourcePageUrl)) throw new Error("Missing saved exact source proof");
  }
  return raw as unknown as State;
}
function failedQuote(source: ChannelReferenceSource, now: number): ChannelReferenceQuote {
  return { ...emptyReferenceQuote(source, "unavailable"), fetchedAt: timestamp(now), expiresAt: timestamp(now + IDENTITY_COOLDOWN) };
}
function expireAbandoned(state: State, now: number) {
  for (const r of Object.values(state.records)) {
    if (r.state === "queued" && now - r.queuedAt > QUEUE_LIFETIME || r.state === "running" && now - (r.startedAt ?? r.queuedAt) > ATTEMPT_TIMEOUT + 5000) {
      r.state = "completed"; r.finishedAt = now;
      // A never-started queue expiry is not a fabricated fetch attempt.
      if (r.startedAt !== null && r.quote?.status !== "ok") {
        r.quote = failedQuote(r.source, r.startedAt); r.sourceSha256 = null; r.sourcePageUrl = null;
        r.version = hash(JSON.stringify({ quote: r.quote, sourceSha256: null, sourcePageUrl: null }));
      }
    }
  }
}
/** Constructing/reading this service never visits a supplier. Only an explicit
 * true queues approved FAILED sources; ordinary authorized polls only read. */
export function createManualChannelReferenceService(options: {
  baseLookup: (materials: ApprovedMaterial[], settings?: { refresh?: boolean }) => Promise<ChannelReferenceLookupResult>;
  enabled?: boolean; cacheDirectory?: string; workerSha256?: string;
  fetchEvidence?: (source: ChannelReferenceSource, expected: PublicIdentity) => Promise<PublicReferenceEvidence | null>;
  now?: () => number;
  /** Internal file-config generation gate; never supplied by an API caller. */
  canStartWork?: () => boolean;
}) {
  const now = options.now ?? Date.now;
  const enabled = options.enabled === true && !!options.cacheDirectory && (!!options.fetchEvidence || /^[a-f0-9]{64}$/.test(options.workerSha256 ?? ""));
  const enabledNow = () => enabled && options.canStartWork?.() !== false;
  const directory = options.cacheDirectory ?? "";
  let draining: Promise<void> | null = null;
  const load = async () => { const state = validateState(await readReferenceState(directory)); expireAbandoned(state, now()); return state; };
  async function drain() {
    const end = now() + QUEUE_LIFETIME;
    while (now() < end && enabledNow()) {
      const release = await acquireReferenceLock(directory, "work.lock", 0);
      if (!release) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      let attempt: { key: string; record: RecordState } | null = null;
      let waiting = false;
      try {
        await withReferenceStateLock(directory, async () => {
          if (!enabledNow()) return;
          const state = await load();
          const queued = Object.entries(state.records).filter(([, r]) => r.state === "queued").sort((a, b) => a[1].queuedAt - b[1].queuedAt);
          for (const [key, r] of queued) {
            if (state.providers[r.source].blocked) { r.state = "completed"; r.finishedAt = now(); continue; }
            if (state.providers[r.source].nextAllowedAt > now()) { waiting = true; continue; }
            r.state = "running"; r.startedAt = now();
            state.providers[r.source].nextAllowedAt = now() + SOURCE_COOLDOWN;
            attempt = { key, record: structuredClone(r) }; break;
          }
          await writeReferenceState(directory, state);
        });
        if (attempt) {
          const { key, record: r } = attempt as { key: string; record: RecordState };
          let evidence: PublicReferenceEvidence | null = null;
          try {
            await prepareReferenceLock(directory, "browser.global.lock");
            await prepareReferenceLock(directory, key + ".job.lock");
            // Native runner kills its process group AND reported browser on its
            // 75s deadline. Injection exists for offline tests only.
            if (!enabledNow()) throw new Error("Reference configuration retired");
            evidence = await (options.fetchEvidence ? options.fetchEvidence(r.source, { partNumber: r.partNumber, brand: r.brand }) : fetchNativeReferenceEvidence(directory, r.source, { partNumber: r.partNumber, brand: r.brand }, options.workerSha256!));
            if (evidence && (!validCachedReference(evidence.quote, r.source, r) || Date.parse(evidence.quote.fetchedAt!) > now() + 30_000 || Date.parse(evidence.quote.fetchedAt!) < r.startedAt! - 30_000 || !(evidence.sourceSha256 === null || /^[a-f0-9]{64}$/.test(evidence.sourceSha256)) || !(evidence.sourcePageUrl === null || allowedReferencePageUrl(r.source, evidence.sourcePageUrl)))) throw new Error("Invalid current public producer proof");
            if (evidence?.quote.status === "ok" && (!evidence.sourceSha256 || !evidence.sourcePageUrl)) throw new Error("Missing exact source proof");
          } catch { evidence = null; }
          await withReferenceStateLock(directory, async () => {
            const state = await load(), current = state.records[key];
            if (!current || current.attemptId !== r.attemptId) return;
            const quote = evidence?.quote ?? failedQuote(r.source, r.startedAt!);
            // A valid saved success can never be replaced by a failure.
            if (current.quote?.status !== "ok" || quote.status === "ok") {
              current.quote = quote; current.sourceSha256 = evidence?.sourceSha256 ?? null;
              current.sourcePageUrl = evidence?.sourcePageUrl ?? null;
              current.version = hash(JSON.stringify({ quote, sourceSha256: current.sourceSha256, sourcePageUrl: current.sourcePageUrl }));
            }
            current.state = "completed"; current.finishedAt = now();
            if (quote.status === "access_restricted") state.providers[r.source].blocked = true; // No automatic or manual retry of challenges.
            await writeReferenceState(directory, state);
          });
        }
      } finally { await release(); }
      if (!attempt && !waiting) return;
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  function startDrain() {
    if (!draining) draining = drain().catch(() => {}).finally(() => { draining = null; });
  }
  async function lookup(materials: ApprovedMaterial[], settings: { refresh?: boolean } = {}): Promise<ManualReferenceLookupResult> {
    // Snapshot validation/sanitization is always first, including disabled mode.
    const base = await options.baseLookup(materials);
    if (!enabledNow()) {
      if (!settings.refresh) return base;
      return { ...base, refreshDiagnostics: base.items.flatMap(m => SOURCES.map(source => ({ materialId: m.materialId, source, state: m.references[source].status === "ok" ? "idle" as const : "disabled" as const, lastAttemptAt: null, lastAttemptStatus: null, nextAllowedAt: null, referenceVersion: null, sourceSha256: null }))) };
    }
    try {
      await assertPrivateReferenceDirectory(directory);
      const denied = new Set<string>();
      let queued = false;
      const state = settings.refresh ? await withReferenceStateLock(directory, async () => {
        const state = await load();
        if (!enabledNow()) return state;
        for (const material of base.items) for (const source of SOURCES) {
          if (material.references[source].status === "ok" || !material.partNumber.trim() || !material.brand.trim()) continue;
          const key = referenceCacheKey(source, material.partNumber, material.brand), previous = state.records[key];
          if (previous?.quote?.status === "ok" || previous?.state === "queued" || previous?.state === "running" || state.providers[source].blocked || previous?.startedAt !== null && previous?.startedAt !== undefined && now() < previous.startedAt + IDENTITY_COOLDOWN) continue;
          // Drop old negatives only; never prune successful public evidence.
          for (const [oldKey, r] of Object.entries(state.records)) if (r.state === "completed" && r.quote?.status !== "ok" && now() - (r.finishedAt ?? r.queuedAt) > 24 * 60 * 60_000) delete state.records[oldKey];
          if (Object.values(state.records).filter(r => r.state !== "completed").length >= MAX_QUEUE || !previous && Object.keys(state.records).length >= MAX_RECORDS) { denied.add(key); continue; }
          state.records[key] = { source, partNumber: material.partNumber.trim(), brand: material.brand.trim(), state: "queued", queuedAt: now(), startedAt: null, finishedAt: null, attemptId: randomUUID(), quote: previous?.quote ?? null, sourceSha256: previous?.sourceSha256 ?? null, sourcePageUrl: previous?.sourcePageUrl ?? null, version: previous?.version ?? null };
          queued = true;
        }
        await writeReferenceState(directory, state); return state;
      }) : await load();
      const diagnostics: ChannelReferenceRefreshDiagnostic[] = [];
      for (const material of base.items) for (const source of SOURCES) {
        const key = referenceCacheKey(source, material.partNumber, material.brand), r = state.records[key];
        const baseSuccess = material.references[source].status === "ok";
        const lastAttempt = r?.startedAt ?? (r?.quote?.fetchedAt ? Date.parse(r.quote.fetchedAt) : null);
        const next = lastAttempt === null ? null : lastAttempt + IDENTITY_COOLDOWN;
        let diagnosticState: ChannelReferenceRefreshDiagnostic["state"] = baseSuccess ? "idle" : state.providers[source].blocked ? "blocked" : denied.has(key) ? "queue_full" : r?.state ?? "idle";
        if (!baseSuccess && r?.state === "completed" && next !== null && next > now() && !state.providers[source].blocked) diagnosticState = "cooldown";
        if (!baseSuccess && r) {
          if (r.quote?.status === "ok") material.references[source] = structuredClone(r.quote);
          else if ((r.state === "queued" || r.state === "running") && !state.providers[source].blocked) material.references[source] = emptyReferenceQuote(source, "pending");
          else if (r.quote) material.references[source] = structuredClone(r.quote);
        }
        diagnostics.push({ materialId: material.materialId, source, state: diagnosticState, lastAttemptAt: timestamp(lastAttempt), lastAttemptStatus: r?.state === "running" ? "pending" : r?.quote?.status ?? null, nextAllowedAt: timestamp(next), referenceVersion: r?.version ?? null, sourceSha256: r?.sourceSha256 ?? null });
      }
      if (queued) startDrain();
      return { ...base, refreshDiagnostics: diagnostics };
    } catch {
      // Bad permissions/corrupt cache do not hide valid immutable base quotes.
      return { ...base, refreshDiagnostics: base.items.flatMap(m => SOURCES.map(source => ({ materialId: m.materialId, source, state: m.references[source].status === "ok" ? "idle" as const : "unavailable" as const, lastAttemptAt: null, lastAttemptStatus: null, nextAllowedAt: null, referenceVersion: null, sourceSha256: null }))) };
    }
  }
  return { lookup, idle: async () => { while (draining) await draining; } };
}
