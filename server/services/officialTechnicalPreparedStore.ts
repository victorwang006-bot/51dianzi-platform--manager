import { createOfficialTechnicalReader, type OfficialTechnicalReaderOptions } from "./officialTechnicalReader";
import { MAX_TECHNICAL_STORE_BYTES, technicalDocumentSchema, type TechnicalDocument } from "./officialTechnicalReaderDocument";
import { constants } from "node:fs";
import { open, mkdir, rename, unlink, rmdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  OFFICIAL_TECHNICAL_PROJECTION_VERSION, officialTechnicalIdentitySchema,
  officialTechnicalSourceKey,
  projectPreparedOfficialTechnical, type OfficialTechnicalIdentity, type OfficialTechnicalResource, type OfficialTechnicalDictionaryReader,
} from "./officialTechnicalResource";

/** Server-private, outside static/dist trees. Provision owner/group before deployment; no import-time IO. */
export const DEFAULT_OFFICIAL_TECHNICAL_STORE_PATH = "/var/lib/dianzi51-private/official-technical/prepared-v1.json";
const MAX_BYTES = MAX_TECHNICAL_STORE_BYTES;
const documentSchema = technicalDocumentSchema;
type Document = TechnicalDocument;
const hex = z.string().regex(/^[0-9a-f]{64}$/);
export type OfficialTechnicalPreparationTicket = Record<string, string>;
const ticketSchema = z.record(hex, z.string().uuid());
export type OfficialTechnicalLookup = (items: readonly OfficialTechnicalIdentity[]) => Promise<OfficialTechnicalResource[]>;
export class OfficialTechnicalPreparationError extends Error {
  constructor() { super("自营技术参数准备失败"); }
}
const empty = (): Document => ({ schemaVersion: 1, generation: 0, sources: {}, entries: [] });

export function createOfficialTechnicalPreparedStore(path = DEFAULT_OFFICIAL_TECHNICAL_STORE_PATH, options: OfficialTechnicalReaderOptions = {}) {
  if (!isAbsolute(path)) throw new Error("Technical prepared store requires an absolute private path");
  const read = createOfficialTechnicalReader(path, options);
  async function load(allowMissing: boolean): Promise<Document> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new OfficialTechnicalPreparationError();
      const content = await handle.readFile({ encoding: "utf8" });
      if (Buffer.byteLength(content) > MAX_BYTES) throw new OfficialTechnicalPreparationError();
      const document = documentSchema.parse(JSON.parse(content));
      if (new Set(document.entries.map(entry => entry.identity.publicId)).size !== document.entries.length) throw new OfficialTechnicalPreparationError();
      return document;
    } catch (error: any) {
      if (allowMissing && error?.code === "ENOENT") return empty();
      throw new OfficialTechnicalPreparationError();
    } finally { await handle?.close(); }
  }
  async function save(document: Document) {
    document.generation++;
    const json = JSON.stringify(documentSchema.parse(document));
    if (Buffer.byteLength(json) > MAX_BYTES) throw new OfficialTechnicalPreparationError();
    const temp = `${path}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(json + "\n", "utf8"); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temp, path);
      const directory = await open(dirname(path), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await handle?.close(); await unlink(temp).catch(() => {}); }
  }
  async function mutate<T>(run: (document: Document) => T): Promise<T> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lock = `${path}.lock`;
    let acquired = false;
    // No unsafe stale-lock stealing. Dead writer tickets require explicit operator recovery;
    // neither maintenance nor another process may silently remove someone else's pending writer.
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await mkdir(lock, { mode: 0o700 }); acquired = true; break; }
      catch (error: any) { if (error?.code !== "EEXIST") throw new OfficialTechnicalPreparationError(); await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    if (!acquired) throw new OfficialTechnicalPreparationError();
    try { const document = await load(true); const result = run(document); await save(document); return result; }
    finally { await rmdir(lock).catch(() => {}); }
  }
  const { lookup, warmUp, close } = read;
  async function invalidateSources(partNumbers: readonly string[], writer: boolean): Promise<OfficialTechnicalPreparationTicket> {
    const keys = new Set(partNumbers.map(officialTechnicalSourceKey));
    if (!keys.size) return {};
    return mutate(document => {
      const tickets: OfficialTechnicalPreparationTicket = {};
      for (const key of Array.from(keys).sort()) {
        const ticket = randomUUID();
        const pendingWriterTickets = [...(document.sources[key]?.pendingWriterTickets ?? [])];
        if (writer) pendingWriterTickets.push(ticket);
        document.sources[key] = { ticket, version: null, pendingWriterTickets }; tickets[key] = ticket;
      }
      document.entries = document.entries.filter(entry => !keys.has(entry.sourceKey));
      return tickets;
    });
  }
  /** Maintenance/publication invalidation is NOT a DB writer; preserve all actual pending writers. */
  async function invalidate(partNumbers: readonly string[]) { return invalidateSources(partNumbers, false); }
  /** Must finish successfully under the existing native row lock BEFORE the DB write. */
  async function beginSourceMutation(partNumbers: readonly string[]) { return invalidateSources(partNumbers, true); }
  /** DB transaction rejection (or postcommit read failure): release only this writer, never publish. */
  async function abortSourceMutation(rawTickets: OfficialTechnicalPreparationTicket) {
    const tickets = ticketSchema.parse(rawTickets); const keys = new Set(Object.keys(tickets));
    if (!keys.size) return;
    await mutate(document => {
      for (const key of Array.from(keys)) {
        const source = document.sources[key];
        if (!source) continue;
        source.pendingWriterTickets = source.pendingWriterTickets.filter(ticket => ticket !== tickets[key]);
        source.version = null;
        // Fence even newer maintenance readers that could have captured data while this writer was pending.
        source.ticket = randomUUID();
      }
      document.entries = document.entries.filter(entry => !keys.has(entry.sourceKey));
    });
  }
  async function complete(items: readonly OfficialTechnicalIdentity[], rawTickets: OfficialTechnicalPreparationTicket, reader: OfficialTechnicalDictionaryReader) {
    const tickets = ticketSchema.parse(rawTickets);
    let identities: OfficialTechnicalIdentity[] = [];
    let reads: Awaited<ReturnType<OfficialTechnicalDictionaryReader>> = [];
    let resources: OfficialTechnicalResource[] = [];
    let sourceKeys: string[] = [];
    const sourceVersions = new Map<string, string>();
    let failed = false;
    // Even a failed reader/projection must settle this committed writer. Persist failure below.
    try {
      identities = items.map(item => officialTechnicalIdentitySchema.parse(item));
      if (new Set(identities.map(item => item.publicId)).size !== identities.length) throw new OfficialTechnicalPreparationError();
      reads = await reader(identities);
      sourceKeys = identities.map(identity => officialTechnicalSourceKey(identity.partNumber));
      if (reads.length !== identities.length || reads.some(read => !/^[0-9a-f]{64}$/.test(read.sourceVersion))) throw new OfficialTechnicalPreparationError();
      resources = reads.map((read, index) => projectPreparedOfficialTechnical(identities[index], read));
      if (resources.some(resource => resource.state === "unavailable")) throw new OfficialTechnicalPreparationError();
      for (let index = 0; index < identities.length; index++) {
        const key = sourceKeys[index]; const version = reads[index].sourceVersion;
        if (sourceVersions.has(key) && sourceVersions.get(key) !== version) throw new OfficialTechnicalPreparationError();
        sourceVersions.set(key, version);
      }
    } catch { failed = true; }
    // Reader/identity failure must still evict every affected source, including ticket-only old source keys.
    if (sourceKeys.length !== identities.length) sourceKeys = identities.map(identity => officialTechnicalSourceKey(identity.partNumber));
    const keySet = new Set([...Object.keys(tickets), ...sourceKeys]);
    const keys = Array.from(keySet);
    const stale = await mutate(document => {
      let stale = failed;
      for (const key of keys) {
        const source = document.sources[key];
        if (source) source.pendingWriterTickets = source.pendingWriterTickets.filter(ticket => ticket !== tickets[key]);
        if (!source || source.ticket !== tickets[key] || source.pendingWriterTickets.length) stale = true;
      }
      // A stale ticket is not commit-order proof. It must invalidate, not leave newer but stale ready data.
      document.entries = document.entries.filter(entry => !keySet.has(entry.sourceKey));
      for (const key of keys) if (document.sources[key]) document.sources[key].version = null;
      if (stale) {
        // A read begun while a writer was pending cannot become publishable merely because it settled.
        for (const key of keys) if (document.sources[key]) document.sources[key].ticket = randomUUID();
        return true;
      }
      const targetPublicIds = new Set(identities.map(identity => identity.publicId));
      document.entries = document.entries.filter(entry => !targetPublicIds.has(entry.identity.publicId));
      sourceVersions.forEach((version, key) => { document.sources[key].version = version; });
      for (let index = 0; index < identities.length; index++) {
        const identity = identities[index]; const sourceKey = sourceKeys[index];
        document.entries.push({ identity, sourceKey, sourceVersion: reads[index].sourceVersion, projectionVersion: OFFICIAL_TECHNICAL_PROJECTION_VERSION, preparedAt: new Date().toISOString(), technicalResource: resources[index] });
      }
      return false;
    });
    if (stale) throw new OfficialTechnicalPreparationError();
    return resources;
  }
  async function prepare(items: readonly OfficialTechnicalIdentity[], reader: OfficialTechnicalDictionaryReader) {
    const identities = items.map(item => officialTechnicalIdentitySchema.parse(item));
    return complete(identities, await invalidate(identities.map(item => item.partNumber)), reader);
  }
  return { path, lookup, warmUp, close, invalidate, beginSourceMutation, abortSourceMutation, complete, prepare };
}
