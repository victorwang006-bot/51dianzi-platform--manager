import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createManualChannelReferenceService } from "./manualRefresh";
import { assertNativeReferenceWorker, NATIVE_REFERENCE_WORKER_BASENAME } from "./nativeWorker";
import { assertPrivateReferenceDirectory } from "./referenceStore";

/** Build/provisioning metadata only. No import-time FS, environment or network IO. */
export const MANUAL_REFERENCE_CONFIG_DESCRIPTOR = Object.freeze({
  version: 1 as const,
  path: "/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json",
  directoryMode: 0o700,
  fileMode: 0o600,
  maxBytes: 4096,
  revalidateAfterMs: 30_000,
  workerBasename: NATIVE_REFERENCE_WORKER_BASENAME,
});
export type ManualReferenceFileConfig = Readonly<{
  version: 1; enabled: boolean; cacheDirectory: string; workerSha256: string;
}>;
export type EnabledManualReferenceFileConfig = ManualReferenceFileConfig & Readonly<{ enabled: true }>;
type ManualOptions = Parameters<typeof createManualChannelReferenceService>[0];
type ManualService = ReturnType<typeof createManualChannelReferenceService>;
export type FileConfiguredChannelReferenceServiceOptions = {
  baseLookup: ManualOptions["baseLookup"];
  now?: () => number;
};

function parseConfig(text: string): EnabledManualReferenceFileConfig | null {
  const value: unknown = JSON.parse(text);
  // JSON.parse alone accepts duplicate property names. Tokenize strings before
  // checking keys, so escaped names and colons inside string values are safe.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g) ?? [];
  const names = tokens.filter((_, i) => tokens[i + 1] === ":").map(t => JSON.parse(t) as string);
  if (new Set(names).size !== names.length || names.length !== 4 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid manual reference config");
  const config = value as Record<string, unknown>;
  if (Object.keys(config).sort().join(",") !== "cacheDirectory,enabled,version,workerSha256" || config.version !== 1 || typeof config.enabled !== "boolean" || typeof config.cacheDirectory !== "string" || !isAbsolute(config.cacheDirectory) || resolve(config.cacheDirectory) !== config.cacheDirectory || !config.cacheDirectory.startsWith("/var/lib/") || /[\u0000-\u001f\u007f]/.test(config.cacheDirectory) || typeof config.workerSha256 !== "string" || !/^[a-f0-9]{64}$/.test(config.workerSha256)) throw new Error("Invalid manual reference config");
  return config.enabled ? Object.freeze({ version: 1 as const, enabled: true as const, cacheDirectory: config.cacheDirectory, workerSha256: config.workerSha256 }) : null;
}

/** Fixed path only; absence, malformed data, unsafe paths and hash mismatch all
 * disable. Reads through the checked directory fd to avoid ancestor replacement.
 * No mkdir, lock, cache write, process launch or public request happens here. */
export async function loadManualReferenceFileConfig(): Promise<EnabledManualReferenceFileConfig | null> {
  const descriptor = MANUAL_REFERENCE_CONFIG_DESCRIPTOR;
  let parent: Awaited<ReturnType<typeof open>> | undefined;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const directory = dirname(descriptor.path);
    await assertPrivateReferenceDirectory(directory);
    parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parentStat = await parent.stat();
    if (!parentStat.isDirectory() || parentStat.uid !== process.getuid?.() || (parentStat.mode & 0o7777) !== descriptor.directoryMode) throw new Error("Unsafe config directory");
    file = await open(join("/proc/self/fd", String(parent.fd), "manual-refresh-config.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== descriptor.fileMode || stat.size <= 0 || stat.size > descriptor.maxBytes) throw new Error("Unsafe manual reference config");
    const bytes = Buffer.alloc(descriptor.maxBytes + 1); let length = 0;
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await file.stat();
    if (length !== stat.size || length > descriptor.maxBytes || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("Changed manual reference config");
    const config = parseConfig(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    if (!config) return null;
    await assertPrivateReferenceDirectory(config.cacheDirectory);
    await assertNativeReferenceWorker(config.workerSha256);
    return config;
  } catch { return null; }
  finally { await file?.close().catch(() => {}); await parent?.close().catch(() => {}); }
}

/** Production control contract: file-only, bounded lazy memo, no ENV mutation or
 * path/worker/fetch injection. Existing explicit manual factory remains usable
 * for authorized offline tests. Replaced generations stop starting queued work;
 * an already running attempt may finish under its existing native wall bound. */
export function createFileConfiguredChannelReferenceService(options: FileConfiguredChannelReferenceServiceOptions) {
  const now = options.now ?? Date.now;
  const disabled = createManualChannelReferenceService({ baseLookup: options.baseLookup });
  let current: { key: string; service: ManualService; retire: () => void } | null = null;
  let checkedAt: number | null = null;
  let loading: Promise<ManualService> | null = null;
  let retiredIdle: Promise<void> = Promise.resolve();
  async function configured(): Promise<ManualService> {
    if (loading) return loading;
    const time = now();
    if (checkedAt !== null && time >= checkedAt && time - checkedAt < MANUAL_REFERENCE_CONFIG_DESCRIPTOR.revalidateAfterMs) return current?.service ?? disabled;
    loading = (async () => {
      const config = await loadManualReferenceFileConfig();
      const key = config ? JSON.stringify(config) : null;
      if (key !== (current?.key ?? null)) {
        if (current) {
          current.retire();
          retiredIdle = Promise.all([retiredIdle, current.service.idle()]).then(() => {});
          current = null;
        }
        if (config) {
          let active = true;
          current = { key: key!, retire: () => { active = false; }, service: createManualChannelReferenceService({ baseLookup: options.baseLookup, ...config, now, canStartWork: () => active }) };
        }
      }
      checkedAt = now();
      return current?.service ?? disabled;
    })().finally(() => { loading = null; });
    return loading;
  }
  return {
    lookup: async (materials: Parameters<ManualService["lookup"]>[0], settings: { refresh?: boolean } = {}) => {
      // Validate and sanitize the approved snapshot input before lazy file IO.
      const base = await options.baseLookup(materials);
      const approved = base.items.map(({ materialId, partNumber, brand }) => ({ materialId, partNumber, brand }));
      return (await configured()).lookup(approved, settings);
    },
    idle: async () => { if (loading) await loading; await Promise.all([retiredIdle, current?.service.idle()]); },
  };
}
export type FileConfiguredChannelReferenceService = ReturnType<typeof createFileConfiguredChannelReferenceService>;
