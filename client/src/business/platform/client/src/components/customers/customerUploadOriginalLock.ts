// Customer-original uploads only. Never infer rollback from HTTP status or text codes.
export const ORIGINAL_NOT_SAVED_PREFIX = "原文件未保存：";
export type OriginalLock = { requestId: string; hash: string; mode: "standard" | "parse"; fileName: string; customerVersion: number };
export type OriginalLockSnapshot = { raw: string; lock: OriginalLock };
type LockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const requestUUID = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sameLock = (a: OriginalLock, b: OriginalLock) => a.requestId === b.requestId && a.hash === b.hash && a.mode === b.mode && a.fileName === b.fileName && a.customerVersion === b.customerVersion;
export function readOriginalLock(storage: LockStorage, key: string): OriginalLockSnapshot | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const lock = JSON.parse(raw) as OriginalLock;
  if (!lock || typeof lock !== "object" || !requestUUID(lock.requestId) || !/^[0-9a-f]{64}$/.test(lock.hash)
    || !["standard", "parse"].includes(lock.mode) || typeof lock.fileName !== "string" || !lock.fileName.trim()
    || !Number.isSafeInteger(lock.customerVersion) || lock.customerVersion < 0) throw new Error("原文件恢复记录无效，不能重建上传；请核实原请求。");
  return { raw, lock };
}
export function saveOriginalLock(storage: LockStorage, key: string, lock: OriginalLock): OriginalLockSnapshot {
  const snapshot = { raw: JSON.stringify(lock), lock };
  storage.setItem(key, snapshot.raw);
  const saved = readOriginalLock(storage, key);
  if (!saved || saved.raw !== snapshot.raw || !sameLock(saved.lock, lock)) throw new Error("无法确认原文件恢复记录已保存，已阻止提交。");
  return snapshot;
}
// All checks/removal are synchronous. Any malformed, changed, inaccessible or
// undeletable storage leaves the in-memory operation locked at the caller.
export function clearOriginalLock(storage: LockStorage, key: string, snapshot: OriginalLockSnapshot, ownsRequest: () => boolean): boolean {
  try {
    if (!ownsRequest()) return false;
    const stored = readOriginalLock(storage, key);
    if (!stored || stored.raw !== snapshot.raw || !sameLock(stored.lock, snapshot.lock) || !ownsRequest()) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null && ownsRequest();
  } catch { return false; }
}
export function isOriginalNotSavedResponse(error: unknown): error is { message: string; data: { code: "BAD_REQUEST" } } {
  if (!error || typeof error !== "object") return false;
  const response = error as { message?: unknown; data?: { code?: unknown } };
  return response.data?.code === "BAD_REQUEST" && typeof response.message === "string"
    && response.message.startsWith(ORIGINAL_NOT_SAVED_PREFIX)
    && response.message.slice(ORIGINAL_NOT_SAVED_PREFIX.length).trim().length > 0;
}
// Only the parent, AFTER successful CAS cleanup, creates this internal signal.
// A lookalike object, status, string or even a raw tRPC rejection cannot unlock UI.
const releasedRejections = new WeakSet<object>();
export function originalNotSavedAfterRelease(error: { message: string }): Error {
  const released = new Error(error.message);
  releasedRejections.add(released);
  return released;
}
export function isReleasedOriginalRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && releasedRejections.has(error);
}
