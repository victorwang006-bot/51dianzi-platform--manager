import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BYTES = 4 * 1024 * 1024;
/** Pre-provisioned app-owned data, never a release/OPS directory. No recursive
 * mkdir through symlinks, no links/FIFOs, no permissive files or private DTOs. */
export async function assertPrivateReferenceDirectory(directory: string) {
  if (!isAbsolute(directory) || resolve(directory) !== directory || directory === "/" || directory === "/opt/ops" || directory.startsWith("/opt/ops/")) throw new Error("Invalid reference data directory");
  const components: string[] = [];
  for (let path = directory; path !== "/"; path = dirname(path)) components.unshift(path);
  for (const path of components) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe reference data ancestor");
    if (stat.uid !== 0 && stat.uid !== process.getuid?.()) throw new Error("Untrusted reference data ancestor owner");
    // Root-owned system ancestors or sticky /tmp are safe; an unrelated writable
    // ancestor could replace our checked directory after the check.
    if (path !== directory && (stat.mode & 0o022) && !(stat.uid === 0 && (stat.mode & 0o1000))) throw new Error("Writable reference data ancestor");
    if (path === directory && ((stat.mode & 0o7777) !== 0o700 || stat.uid !== process.getuid?.())) throw new Error("Reference directory must be owned private0700");
  }
}
function safeName(name: string) {
  if (!/^(?:state\.json|state\.lock|work\.lock|browser\.global\.lock|[a-f0-9]{64}\.job\.lock)$/.test(name)) throw new Error("Invalid reference filename");
}
async function safeFile(directory: string, name: string, create = false) {
  safeName(name);
  await assertPrivateReferenceDirectory(directory);
  const file = await open(join(directory, name), constants.O_NOFOLLOW | constants.O_NONBLOCK | (create ? constants.O_RDWR | constants.O_CREAT : constants.O_RDONLY), 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new Error("Unsafe reference file");
    return file;
  } catch (e) { await file.close(); throw e; }
}
export async function readReferenceState(directory: string): Promise<unknown | null> {
  let file;
  try { file = await safeFile(directory, "state.json"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  try {
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) { const r = await file.read(bytes, length, bytes.length - length, length); if (!r.bytesRead) break; length += r.bytesRead; }
    if (!length || length > MAX_BYTES) throw new Error("Reference state size limit");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await file.close(); }
}
export async function writeReferenceState(directory: string, state: unknown) {
  await assertPrivateReferenceDirectory(directory);
  const bytes = Buffer.from(JSON.stringify(state) + "\n");
  if (bytes.length > MAX_BYTES) throw new Error("Reference state size limit");
  // Verify an existing destination too: do not silently replace hostile links.
  try { const existing = await safeFile(directory, "state.json"); await existing.close(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const temporary = join(directory, ".state-" + randomUUID() + ".tmp");
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  try {
    await rename(temporary, join(directory, "state.json"));
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function prepareReferenceLock(directory: string, name: string) {
  const file = await safeFile(directory, name, true); await file.close();
}
/** flock releases automatically on parent crash/pipe EOF. Static shell only:
 * identities, URLs and business fields are never shell commands. */
export async function acquireReferenceLock(directory: string, name: "state.lock" | "work.lock", waitSeconds = 2): Promise<(() => Promise<void>) | null> {
  await prepareReferenceLock(directory, name);
  return new Promise((resolveLock, reject) => {
    const child = spawn("/usr/bin/flock", ["-w", String(waitSeconds), "-E", "75", join(directory, name), "/bin/sh", "-c", "printf 'LOCKED\\n'; cat >/dev/null"], { stdio: ["pipe", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } });
    let locked = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Reference lock timeout")); }, (waitSeconds + 2) * 1000);
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("exit", code => { clearTimeout(timer); if (!locked) code === 75 ? resolveLock(null) : reject(new Error("Reference lock failed")); });
    child.stdout.on("data", chunk => {
      if (locked || !String(chunk).includes("LOCKED\n")) return;
      locked = true; clearTimeout(timer);
      resolveLock(() => new Promise<void>(release => {
        if (child.exitCode !== null || child.signalCode !== null) { release(); return; }
        const deadline = setTimeout(() => { child.kill("SIGKILL"); release(); }, 2000);
        child.once("exit", () => { clearTimeout(deadline); release(); }); child.stdin.end();
      }));
    });
  });
}
export async function withReferenceStateLock<T>(directory: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireReferenceLock(directory, "state.lock");
  if (!release) throw new Error("Reference state busy");
  try { return await fn(); } finally { await release(); }
}
