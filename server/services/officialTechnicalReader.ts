import { Worker } from "node:worker_threads";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { technicalPathVersion } from "./officialTechnicalReaderDocument";
import { unavailableOfficialTechnicalResource, type OfficialTechnicalIdentity, type OfficialTechnicalResource } from "./officialTechnicalResource";

declare const __OFFICIAL_TECHNICAL_READER_WORKER_FILE__: string;
export type OfficialTechnicalReaderOptions = { workerPath?: string | URL };
export type OfficialTechnicalWarmState = { version: string; entries: number; loads: number; storeSha256: string; sourceTicketsDigest: string };
type Pending = { path: string; version: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const pools = new Map<string, ReaderWorker>();
const failure = () => Error("自营技术参数读取不可用");
class ReaderWorker {
  worker?: Worker;
  pending = new Map<number, Pending>();
  nextId = 0;
  constructor(readonly url: URL) {}
  stop() {
    const old = this.worker; this.worker = undefined;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(failure()); }
    this.pending.clear();
    if (old) void old.terminate();
  }
  start() {
    if (this.worker) return this.worker;
    // A bundled .mjs worker does not depend on tsx/vitest loaders or production node_modules.
    const worker = new Worker(this.url, { execArgv: [] });
    this.worker = worker;
    worker.on("message", message => {
      if (this.worker !== worker) return;
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timer);
      if (message.ok && message.path === task.path && message.version === task.version) task.resolve(message.result);
      else task.reject(failure());
      if (!this.pending.size) {
        // Keep the prewarmed index across arbitrarily quiet periods. An idle timeout
        // would make the next user's first screen cold/unavailable again. The single
        // bounded shared worker is unref'ed and explicitly stoppable at process teardown.
        worker.unref();
      }
    });
    worker.on("error", () => { if (this.worker === worker) this.stop(); });
    worker.on("exit", () => { if (this.worker === worker) this.stop(); });
    return worker;
  }
  request(path: string, version: string, items?: readonly OfficialTechnicalIdentity[]) {
    if (this.pending.size >= 1024) return Promise.reject(failure());
    let worker: Worker;
    try { worker = this.start(); } catch { return Promise.reject(failure()); }
    worker.ref();
    return new Promise<any>((resolve, reject) => {
      const id = ++this.nextId;
      // Bound stuck workers and release every waiter; no orphaned promises or referenced threads.
      const timer = setTimeout(() => this.stop(), 30_000); timer.unref();
      this.pending.set(id, { path, version, resolve, reject, timer });
      try { worker.postMessage({ id, path, version, items }); }
      catch { this.stop(); }
    });
  }
}
function workerPool(options: OfficialTechnicalReaderOptions): ReaderWorker {
  const location = options.workerPath ?? process.env.OFFICIAL_TECHNICAL_READER_WORKER_PATH
    ?? (typeof __OFFICIAL_TECHNICAL_READER_WORKER_FILE__ !== "undefined" ? __OFFICIAL_TECHNICAL_READER_WORKER_FILE__ : "./officialTechnicalReader.worker.mjs");
  const url = location instanceof URL ? location : isAbsolute(location) ? pathToFileURL(location) : new URL(location, import.meta.url);
  let pool = pools.get(url.href);
  if (!pool) { pool = new ReaderWorker(url); pools.set(url.href, pool); }
  return pool;
}
/** Explicit process/test shutdown; the bounded shared idle worker is unref'ed, not discarded. */
export function closeOfficialTechnicalReaderWorkers() {
  for (const pool of pools.values()) pool.stop();
  pools.clear();
}
export function createOfficialTechnicalReader(path: string, options: OfficialTechnicalReaderOptions = {}) {
  let closed = false;
  const warming = new Map<string, Promise<OfficialTechnicalWarmState>>();
  async function fenced<T>(version: string, items?: readonly OfficialTechnicalIdentity[]): Promise<T> {
    if (closed) throw failure();
    const result = await workerPool(options).request(path, version, items);
    // Main-side final path fence protects the worker reply transit and atomic rename races.
    if (closed || await technicalPathVersion(path) !== version) throw failure();
    return result;
  }
  async function warmUp(): Promise<OfficialTechnicalWarmState> {
    if (closed) throw failure();
    const version = await technicalPathVersion(path);
    let pending = warming.get(version);
    if (!pending) {
      pending = fenced<OfficialTechnicalWarmState>(version);
      warming.set(version, pending);
      void pending.finally(() => { if (warming.get(version) === pending) warming.delete(version); }).catch(() => {});
    }
    return pending;
  }
  async function lookup(items: readonly OfficialTechnicalIdentity[]): Promise<OfficialTechnicalResource[]> {
    if (!items.length) return [];
    try { return await fenced<OfficialTechnicalResource[]>(await technicalPathVersion(path), items); }
    catch { return items.map(unavailableOfficialTechnicalResource); }
  }
  return { warmUp, lookup, close() { closed = true; warming.clear(); } };
}
