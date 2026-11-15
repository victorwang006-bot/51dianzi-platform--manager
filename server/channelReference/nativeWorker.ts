import { constants } from "node:fs";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { referenceCacheKey, validCachedReference } from "./quoteValidation";
import { allowedReferencePageUrl } from "./publicPage";
export type PublicReferenceEvidence = { quote: ChannelReferenceQuote; sourceSha256: string | null; sourcePageUrl: string | null };
export const NATIVE_REFERENCE_WORKER_BASENAME = "channel-reference-worker.mjs";
const fixedWorkerPath = () => fileURLToPath(new URL("./" + NATIVE_REFERENCE_WORKER_BASENAME, import.meta.url));
/** Only the compiled service's actual sibling, never a configured path/URL.
 * Read-only, bounded validation; safe ancestors prevent untrusted replacement. */
export async function assertNativeReferenceWorker(workerSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(workerSha256)) throw new Error("Invalid reference worker digest");
  const worker = fixedWorkerPath();
  for (let path = dirname(worker); ; path = dirname(path)) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 && stat.uid !== process.getuid?.() || (stat.mode & 0o022) && !(stat.uid === 0 && (stat.mode & 0o1000))) throw new Error("Unsafe reference worker ancestor");
    if (path === "/") break;
  }
  const file = await open(worker, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(), maximum = 5 * 1024 * 1024;
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 && stat.uid !== process.getuid?.() || stat.size <= 0 || stat.size > maximum || (stat.mode & 0o022)) throw new Error("Unvalidated reference worker");
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) { const r = await file.read(bytes, length, bytes.length - length, length); if (!r.bytesRead) break; length += r.bytesRead; }
    const after = await file.stat();
    if (length !== stat.size || length > maximum || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || createHash("sha256").update(bytes.subarray(0, length)).digest("hex") !== workerSha256) throw new Error("Unvalidated reference worker");
  } finally { await file.close(); }
}
async function runNative(directory: string, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }, workerSha256?: string): Promise<PublicReferenceEvidence | null> {
  const key = referenceCacheKey(source, expected.partNumber, expected.brand);
  const worker = fixedWorkerPath();
  if (workerSha256) await assertNativeReferenceWorker(workerSha256);
  return new Promise((resolve, reject) => {
    // Kernel locks release on process exit. All sources share ONE browser lock.
    const args = ["-n", "-E", "75", join(directory, key + ".job.lock"), "/usr/bin/flock", "-n", "-E", "75", join(directory, "browser.global.lock"), process.execPath, worker, "--public-reference-page", source, expected.partNumber, expected.brand];
    if (workerSha256) args.push("--evidence");
    const child = spawn("/usr/bin/flock", args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), LANG: "C.UTF-8" } });
    const ownedBrowsers: Array<{ pid: number; profile: string }> = [];
    async function terminateOwnedChildren(killWorker = true) {
      if (killWorker && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      for (const b of ownedBrowsers) {
        const command = await readFile("/proc/" + b.pid + "/cmdline", "utf8").catch(() => "");
        if (command.split("\u0000").includes("--user-data-dir=" + b.profile)) { try { process.kill(-b.pid, "SIGKILL"); } catch {} }
        await rm(b.profile, { recursive: true, force: true }).catch(() => {});
      }
    }
    let text = "", excessive = false, settled = false;
    const timer = setTimeout(() => { settled = true; void terminateOwnedChildren().finally(() => reject(new Error("Reference child timeout"))); }, 75_000);
    child.stdout.on("data", (b: Buffer) => { text += b.toString("utf8"); if (text.length > 32_000) { excessive = true; text = ""; void terminateOwnedChildren(); } });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString("utf8")).slice(-8000);
      for (const line of stderr.split("\n")) if (line.startsWith("CHREF_BROWSER ")) {
        try { const value = JSON.parse(line.slice(14)); if (Number.isSafeInteger(value.pid) && value.pid > 1 && typeof value.profile === "string" && /^\/tmp\/51-public-reference-[A-Za-z0-9]+$/.test(value.profile) && !ownedBrowsers.some(x => x.pid === value.pid)) ownedBrowsers.push(value); } catch {}
      }
    });
    child.once("error", e => { clearTimeout(timer); if (!settled) { settled = true; void terminateOwnedChildren(false).finally(() => reject(e)); } });
    child.once("exit", code => {
      clearTimeout(timer);
      if (settled) return; settled = true;
      void (async () => {
        // Worker is gone: only cmdline-verified reported browsers may be killed.
        await terminateOwnedChildren(false);
        if (code === 75) { resolve(null); return; }
        if (code !== 0 || excessive) throw new Error("Reference child unavailable");
        const raw: unknown = JSON.parse(text);
        let evidence: PublicReferenceEvidence;
        if (workerSha256) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "quote,sourcePageUrl,sourceSha256") throw new Error("Invalid worker proof envelope");
          evidence = raw as PublicReferenceEvidence;
          if (!(evidence.sourceSha256 === null || typeof evidence.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(evidence.sourceSha256)) || !(evidence.sourcePageUrl === null || typeof evidence.sourcePageUrl === "string" && allowedReferencePageUrl(source, evidence.sourcePageUrl))) throw new Error("Invalid worker source proof");
        } else evidence = { quote: raw as ChannelReferenceQuote, sourceSha256: null, sourcePageUrl: null };
        if (!validCachedReference(evidence.quote, source, expected) || workerSha256 && evidence.quote.status === "ok" && (!evidence.sourceSha256 || !evidence.sourcePageUrl)) throw new Error("Invalid reference child result");
        resolve(evidence);
      })().catch(reject);
    });
  });
}
export async function fetchNativeReferenceQuote(directory: string, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }): Promise<ChannelReferenceQuote | null> {
  return (await runNative(directory, source, expected))?.quote ?? null;
}
export const fetchNativeReferenceEvidence = (directory: string, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }, workerSha256: string) => runNative(directory, source, expected, workerSha256);
