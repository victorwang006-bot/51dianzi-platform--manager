import { parentPort } from "node:worker_threads";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MAX_TECHNICAL_STORE_BYTES, technicalDocumentSchema, technicalFileVersion, technicalPathVersion, type TechnicalDocument } from "./officialTechnicalReaderDocument";
import { officialTechnicalIdentitySchema, officialTechnicalResponseSchema, officialTechnicalSourceKey, officialTechnicalDigest, sameOfficialTechnicalIdentity, unavailableOfficialTechnicalResource, type OfficialTechnicalIdentity } from "./officialTechnicalResource";

type Entry = TechnicalDocument["entries"][number];
type Snapshot = { version: string; byId: ReadonlyMap<string, Entry>; sources: TechnicalDocument["sources"]; storeSha256: string; sourceTicketsDigest: string };
type State = { version: string; promise: Promise<Snapshot>; loads: number };
// Encapsulated maps never escape or mutate after publication. Only small selected DTOs cross the port.
const states = new Map<string, State>();
let loads = 0;
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
async function snapshot(path: string, version: string): Promise<Snapshot> {
  if (await technicalPathVersion(path) !== version) throw Error("Changed technical store");
  const existing = states.get(path);
  if (existing?.version === version) return existing.promise;
  // Evict first: an invalid/new file can never fall back to the old snapshot.
  states.delete(path);
  const state: State = { version, loads: ++loads, promise: undefined! };
  states.set(path, state);
  // Bound the worker's lifetime memory even if many ephemeral store instances are constructed.
  while (states.size > 2) states.delete(states.keys().next().value!);
  state.promise = (async () => {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (technicalFileVersion(await handle.stat({ bigint: true })) !== version) throw Error("Changed technical store");
      const content = await handle.readFile({ encoding: "utf8" });
      if (Buffer.byteLength(content) > MAX_TECHNICAL_STORE_BYTES) throw Error("Oversized technical store");
      const document = technicalDocumentSchema.parse(JSON.parse(content));
      const byId = new Map<string, Entry>();
      for (const entry of document.entries) {
        if (byId.has(entry.identity.publicId)) throw Error("Duplicate technical identity");
        byId.set(entry.identity.publicId, freezeDeep(entry));
      }
      if (technicalFileVersion(await handle.stat({ bigint: true })) !== version || await technicalPathVersion(path) !== version) throw Error("Changed technical store");
      const storeSha256 = createHash("sha256").update(content).digest("hex");
      // Canonical full source map: includes every ticket, pending writer list AND settled version.
      const sourceTicketsDigest = officialTechnicalDigest(document.sources);
      return Object.freeze({ version, byId, sources: freezeDeep(document.sources), storeSha256, sourceTicketsDigest });
    } finally { await handle?.close(); }
  })();
  return state.promise;
}
function selected(snapshot: Snapshot, items: readonly OfficialTechnicalIdentity[]) {
  return items.map(item => {
    if (!officialTechnicalIdentitySchema.safeParse(item).success) return unavailableOfficialTechnicalResource();
    const entry = snapshot.byId.get(item.publicId);
    const original = entry?.identity;
    const source = entry && snapshot.sources[entry.sourceKey];
    if (!entry || !original || item.revision < original.revision
      || !sameOfficialTechnicalIdentity(original, { ...item, revision: original.revision })
      || entry.sourceKey !== officialTechnicalSourceKey(original.partNumber)
      || !source || source.pendingWriterTickets.length || source.version !== entry.sourceVersion) return unavailableOfficialTechnicalResource();
    const response = entry.technicalResource;
    if (response.state === "unavailable" || !response.resource
      || !sameOfficialTechnicalIdentity(response.resource, original)
      || response.parameterVersion !== `tp1_${officialTechnicalDigest({ identity: original, sourceVersion: entry.sourceVersion, projectionVersion: entry.projectionVersion, resource: response.resource })}`) return unavailableOfficialTechnicalResource();
    const resource = { ...response.resource, revision: item.revision, parameters: response.resource.parameters.map(parameter => ({ ...parameter })) };
    return officialTechnicalResponseSchema.parse({ state: response.state, resource, parameterVersion: `tp1_${officialTechnicalDigest({ identity: item, sourceVersion: entry.sourceVersion, projectionVersion: entry.projectionVersion, resource })}` });
  });
}
if (!parentPort) throw Error("Technical reader must run in a worker");
parentPort.on("message", async (request: { id: number; path: string; version: string; items?: OfficialTechnicalIdentity[] }) => {
  const { id, path, version } = request;
  try {
    const current = await snapshot(path, version);
    const result = request.items ? selected(current, request.items) : { version, entries: current.byId.size, loads: states.get(path)?.loads ?? loads, storeSha256: current.storeSha256, sourceTicketsDigest: current.sourceTicketsDigest };
    // Repeat after selected work: never return a snapshot superseded during JSON/Zod/rebinding.
    if (await technicalPathVersion(path) !== version) throw Error("Changed technical store");
    parentPort!.postMessage({ id, path, version, ok: true, result });
  } catch {
    // Keep the rejected promise for this exact invalid version (single-flight negative caching).
    parentPort!.postMessage({ id, path, version, ok: false });
  }
});
