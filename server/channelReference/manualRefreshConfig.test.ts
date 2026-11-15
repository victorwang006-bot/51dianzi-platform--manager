import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertNativeReferenceWorker, fetchNativeReferenceEvidence } from "./nativeWorker";
import { createFileConfiguredChannelReferenceService, loadManualReferenceFileConfig, MANUAL_REFERENCE_CONFIG_DESCRIPTOR } from "./manualRefreshConfig";
import { emptyReferenceQuote } from "./worker";
import type { ChannelReferenceLookupResult } from "../../shared/channelReference";

// Fixed production paths are remapped only at the test OS boundary. Production
// factories accept no configurable config/worker path. All files/flocks are real
// temporary fixtures; the public-producer boundary is inert and never browses.
const fixture = vi.hoisted(() => ({ root: "", workerPath: "", unsafeWorkerAncestor: "", wrongOwner: "" }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  const mapped = (path: unknown) => typeof path === "string" && path.startsWith("/var/lib/51dianzi") ? fixture.root + "/data" + path.slice("/var/lib/51dianzi".length) : path === fixture.workerPath ? fixture.root + "/worker.mjs" : path;
  return { ...fs,
    lstat: vi.fn(async (path: string, ...args: unknown[]) => {
      if (path === fixture.unsafeWorkerAncestor) return fs.lstat(fixture.root + "/ancestor-link");
      const stat = await (fs.lstat as Function)(mapped(path), ...args);
      return path === fixture.wrongOwner ? Object.assign(stat, { uid: process.getuid!() + 1 }) : stat;
    }),
    open: vi.fn(async (path: string, ...args: unknown[]) => {
      const file = await (fs.open as Function)(mapped(path), ...args);
      if (path === fixture.wrongOwner || path.startsWith("/proc/self/fd/") && fixture.wrongOwner === MANUAL_REFERENCE_CONFIG_DESCRIPTOR.path) {
        const originalStat = file.stat.bind(file); file.stat = async () => Object.assign(await originalStat(), { uid: process.getuid!() + 1 });
      }
      return file;
    }),
    rename: vi.fn((from: string, to: string) => fs.rename(mapped(from) as string, mapped(to) as string)),
    unlink: vi.fn((path: string) => fs.unlink(mapped(path) as string)),
  };
});
vi.mock("node:child_process", async original => {
  const children = await original<typeof import("node:child_process")>();
  return { ...children, spawn: vi.fn((command: string, args: string[], options: object) => children.spawn(command, args.map(a => a.startsWith("/var/lib/51dianzi/") ? fixture.root + "/data/" + a.slice("/var/lib/51dianzi/".length) : a), options)) };
});
vi.mock("./nativeWorker", async original => ({ ...await original<typeof import("./nativeWorker")>(), fetchNativeReferenceEvidence: vi.fn(async () => null) }));

const descriptor = MANUAL_REFERENCE_CONFIG_DESCRIPTOR;
const directory = "/var/lib/51dianzi/channel-reference-manual-v1";
const bytes = Buffer.from("// Synthetic inert worker fixture, not live-producer proof.\n");
const digest = createHash("sha256").update(bytes).digest("hex");
const config = { version: 1, enabled: true, cacheDirectory: directory, workerSha256: digest };
const materials = [{ materialId: 1, partNumber: "P-1-TR/NOPB", brand: "ST" }];
const baseLookup = async (list: typeof materials): Promise<ChannelReferenceLookupResult> => ({ items: list.map(({ materialId, partNumber, brand }) => ({ materialId, partNumber, brand, references: { lcsc: emptyReferenceQuote("lcsc", "not_found"), ickey: emptyReferenceQuote("ickey", "unavailable") } })) });
const services: ReturnType<typeof createFileConfiguredChannelReferenceService>[] = [];
const actualDirectory = () => fixture.root + "/data/channel-reference-manual-v1";
const actualConfig = () => actualDirectory() + "/manual-refresh-config.json";
async function put(value: unknown = config) { await writeFile(actualConfig(), typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 }); }
function service(now?: () => number) { const result = createFileConfiguredChannelReferenceService({ baseLookup, now }); services.push(result); return result; }

beforeEach(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), "manual-config-test-"));
  fixture.workerPath = fileURLToPath(new URL("./channel-reference-worker.mjs", import.meta.url));
  fixture.unsafeWorkerAncestor = ""; fixture.wrongOwner = "";
  await mkdir(actualDirectory(), { recursive: true, mode: 0o700 }); await chmod(fixture.root + "/data", 0o700);
  await writeFile(fixture.root + "/worker.mjs", bytes, { mode: 0o600 });
  await symlink(fixture.root, fixture.root + "/ancestor-link");
  vi.clearAllMocks();
});
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.idle())); await rm(fixture.root, { recursive: true, force: true }); });

describe("fixed private manual-refresh config (real temporary files, no supplier)", () => {
  it("publishes immutable builder metadata without IO when constructed", () => {
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(descriptor).toMatchObject({ path: directory + "/manual-refresh-config.json", maxBytes: 4096, directoryMode: 0o700, fileMode: 0o600, revalidateAfterMs: 30_000, workerBasename: "channel-reference-worker.mjs" });
    service(); expect(lstat).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("absence disables true and false without fetching or writing a cache", async () => {
    const s = service();
    expect(await s.lookup(materials)).toEqual(await baseLookup(materials));
    expect((await s.lookup(materials, { refresh: true })).refreshDiagnostics?.every(d => d.state === "disabled")).toBe(true);
    expect(await readdir(actualDirectory())).toEqual([]); expect(fetchNativeReferenceEvidence).not.toHaveBeenCalled();
  });
  it("validates the actual fixed sibling bytes and never needs the three ENV settings", async () => {
    const envBefore = { ...process.env }; await put();
    expect(await loadManualReferenceFileConfig()).toEqual(config);
    const s = service(); const first = await s.lookup(materials, { refresh: false });
    expect(first.items).toEqual((await baseLookup(materials)).items);
    expect(await readdir(actualDirectory())).toEqual(["manual-refresh-config.json"]);
    expect(fetchNativeReferenceEvidence).not.toHaveBeenCalled(); expect(process.env).toEqual(envBefore);
    await s.lookup(materials, { refresh: true }); await s.idle();
    expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetchNativeReferenceEvidence).mock.calls) expect(call).toMatchObject([directory, expect.stringMatching(/^(lcsc|ickey)$/), { partNumber: materials[0].partNumber, brand: "ST" }, digest]);
    const state = await readFile(actualDirectory() + "/state.json", "utf8");
    expect(state).not.toContain("materialId"); expect(state).not.toContain("workerSha256");
    await s.lookup(materials, { refresh: false }); expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(2);
  });
  it("memoizes absence/changes for only 30 seconds and coalesces concurrent validation", async () => {
    let now = Date.now(); const s = service(() => now);
    await Promise.all([s.lookup(materials), s.lookup(materials), s.lookup(materials)]);
    const initialReads = vi.mocked(lstat).mock.calls.length; expect(initialReads).toBeGreaterThan(0);
    await put(); await s.lookup(materials, { refresh: true }); expect(fetchNativeReferenceEvidence).not.toHaveBeenCalled();
    expect(lstat).toHaveBeenCalledTimes(initialReads);
    now += descriptor.revalidateAfterMs;
    const pending = await s.lookup(materials, { refresh: true }); expect(pending.items[0].references.lcsc.status).toBe("pending");
    await s.idle(); expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(2);
    await put({ ...config, enabled: false }); now += descriptor.revalidateAfterMs;
    expect((await s.lookup([{ ...materials[0], partNumber: "P-2" }], { refresh: true })).refreshDiagnostics?.every(d => d.state === "disabled")).toBe(true);
    expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(2);
  });
  it("retires a changed config without starting the remaining queue; an in-flight attempt may finish", async () => {
    let now = Date.now(), release!: () => void; await put();
    vi.mocked(fetchNativeReferenceEvidence).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return null; });
    const s = service(() => now);
    try {
      await s.lookup(materials, { refresh: true }); await vi.waitFor(() => expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(1));
      await put({ ...config, enabled: false }); now += descriptor.revalidateAfterMs;
      expect(await s.lookup(materials, { refresh: false })).toEqual(await baseLookup(materials));
      release(); await s.idle(); expect(fetchNativeReferenceEvidence).toHaveBeenCalledTimes(1);
      expect((await s.lookup(materials, { refresh: true })).refreshDiagnostics?.every(d => d.state === "disabled")).toBe(true);
    } finally { release?.(); await s.idle(); }
  });
  it("revalidates sibling bytes after memo expiry and fails closed on a changed binary", async () => {
    let now = Date.now(); await put(); const s = service(() => now); await s.lookup(materials);
    await writeFile(fixture.root + "/worker.mjs", "// changed sibling\n"); now += descriptor.revalidateAfterMs;
    expect((await s.lookup(materials, { refresh: true })).refreshDiagnostics?.every(d => d.state === "disabled")).toBe(true);
    expect(fetchNativeReferenceEvidence).not.toHaveBeenCalled(); expect(await readdir(actualDirectory())).toEqual(["manual-refresh-config.json"]);
  });
  it("base validation runs before config IO and rejects invalid approved input", async () => {
    const base = vi.fn(async () => { throw new Error("Invalid approved reference materials"); });
    const s = createFileConfiguredChannelReferenceService({ baseLookup: base }); services.push(s);
    await expect(s.lookup([])).rejects.toThrow("Invalid approved"); expect(open).not.toHaveBeenCalled(); expect(lstat).not.toHaveBeenCalled();
  });
  it.each([
    {}, [], null, { ...config, version: 2 }, { ...config, version: "1" }, { ...config, enabled: "true" }, { ...config, enabled: 1 },
    { ...config, workerSha256: digest.toUpperCase() }, { ...config, workerSha256: "a" },
    { ...config, url: "https://evil.example" }, { ...config, workerPath: "/tmp/worker.mjs" }, { ...config, path: "/tmp/config.json" },
    { ...config, cacheDirectory: "/opt/ops/cache" }, { ...config, cacheDirectory: "/tmp/cache" }, { ...config, cacheDirectory: "relative" },
    { ...config, cacheDirectory: directory + "/../other" }, { ...config, cacheDirectory: directory + "/" },
    { ...config, cacheDirectory: directory + "\u0000" },
    "not JSON", '{"version":1,"enabled":false,"enabled":true,"cacheDirectory":"' + directory + '","workerSha256":"' + digest + '"}',
    '{"version":1,"enabled":false,"\\u0065nabled":true,"cacheDirectory":"' + directory + '","workerSha256":"' + digest + '"}',
  ])("fails closed for strict invalid config %j", async value => { await put(value); expect(await loadManualReferenceFileConfig()).toBeNull(); expect(fetchNativeReferenceEvidence).not.toHaveBeenCalled(); });
  it("valid explicit disabled config does not validate or run any worker", async () => {
    await put({ ...config, enabled: false }); await rm(fixture.root + "/worker.mjs");
    expect(await loadManualReferenceFileConfig()).toBeNull(); expect(vi.mocked(open).mock.calls.some(([p]) => p === fixture.workerPath)).toBe(false);
  });
  it.each([0o644, 0o640, 0o666, 0o400, 0o1600])("rejects config permissions %o", async mode => { await put(); await chmod(actualConfig(), mode); expect(await loadManualReferenceFileConfig()).toBeNull(); });
  it.each([0o755, 0o770, 0o777, 0o1700])("rejects config-directory permissions %o", async mode => { await put(); await chmod(actualDirectory(), mode); expect(await loadManualReferenceFileConfig()).toBeNull(); });
  it("rejects a writable ancestor", async () => { await put(); await chmod(fixture.root + "/data", 0o777); expect(await loadManualReferenceFileConfig()).toBeNull(); });
  it("rejects a symlink config directory or cache directory", async () => {
    await put(); await symlink(actualDirectory(), fixture.root + "/data/cache-link");
    await put({ ...config, cacheDirectory: "/var/lib/51dianzi/cache-link" }); expect(await loadManualReferenceFileConfig()).toBeNull();
    await rm(actualDirectory(), { recursive: true }); await symlink(fixture.root + "/data", actualDirectory()); expect(await loadManualReferenceFileConfig()).toBeNull();
  });
  it("rejects a symlink or hardlink config file", async () => {
    await put(); await link(actualConfig(), actualConfig() + ".link"); expect(await loadManualReferenceFileConfig()).toBeNull();
    await rm(actualConfig()); await symlink(actualConfig() + ".link", actualConfig()); expect(await loadManualReferenceFileConfig()).toBeNull();
  });
  it.each([descriptor.path, directory, "/var/lib/51dianzi"])("rejects wrong owner %s", async path => { await put(); fixture.wrongOwner = path; expect(await loadManualReferenceFileConfig()).toBeNull(); });
  it("rejects over-limit, empty, invalid UTF8 and nonregular config bytes", async () => {
    for (const value of [Buffer.alloc(descriptor.maxBytes + 1, 32), Buffer.alloc(0), Buffer.from([0xff])]) { await writeFile(actualConfig(), value, { mode: 0o600 }); expect(await loadManualReferenceFileConfig()).toBeNull(); }
    await rm(actualConfig()); await mkdir(actualConfig(), { mode: 0o600 }); expect(await loadManualReferenceFileConfig()).toBeNull();
  });
});

describe("fixed sibling integrity checker reused by config and native runner", () => {
  it("accepts only its actual fixed sibling SHA", async () => { await expect(assertNativeReferenceWorker(digest)).resolves.toBeUndefined(); await expect(assertNativeReferenceWorker("f".repeat(64))).rejects.toThrow(); });
  it.each(["", "invalid", "A".repeat(64)])("rejects malformed digest before FS IO %s", async sha => { await expect(assertNativeReferenceWorker(sha)).rejects.toThrow(); expect(open).not.toHaveBeenCalled(); expect(lstat).not.toHaveBeenCalled(); });
  it("rejects missing, symlink, multiply-linked and writable siblings", async () => {
    const worker = fixture.root + "/worker.mjs"; await chmod(worker, 0o666); await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
    await chmod(worker, 0o600); await link(worker, worker + ".link"); await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
    await rm(worker); await symlink(worker + ".link", worker); await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
    await rm(worker); await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
  });
  it("rejects wrong sibling owner and unsafe/symlink ancestors", async () => {
    fixture.wrongOwner = fixture.workerPath; await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
    fixture.wrongOwner = ""; fixture.unsafeWorkerAncestor = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
    await expect(assertNativeReferenceWorker(digest)).rejects.toThrow();
  });
});
