import { createHash } from "node:crypto";

/**
 * The fingerprint projection mirrors deployed iuUpgradeV1FingerprintInventory.
 * Never use updatedAt alone: timestamp precision is not a concurrency token.
 */
export type GuardableInventory = {
  id: number;
  enterpriseId: number | null;
  userId: number;
  ownerUserId: number | null;
  ownershipVersion: number;
  partNumberNormalized: string | null;
  status: "draft" | "published" | "offshelf";
  partNumber: string;
  brand: string;
  dateCode: string | null;
  qtyOnSale: number;
  qtyStock: number;
  leadTime: string | null;
  taxIncluded: boolean | number | string;
  updatedAt: Date | string;
  category: string;
  pkg: string | null;
  priceEx: unknown;
  priceIncl: unknown;
  moq: number | null;
  spq: number | null;
  warehouseAddress: string | null;
  rohs: boolean | number | string;
  note: string | null;
};

export type GuardScope = {
  enterpriseId: number;
  userId: number;
  ownerUserId: number;
  partNumberNormalized: string;
};

export type ImportRowVersionGuard = {
  jobId: string;
  rowNumber: number;
  guardKind: "existing" | "new";
  inventoryId: number | null;
  expectedFingerprint: string | null;
  expectedRevision: number | null;
  expectedUpdatedAt: string | null;
  snapshotJson: string;
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const OFFSET_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/i;

type TimestampToken = string | null;

function pad(value: number, width = 2) { return String(value).padStart(width, "0"); }

function requireValidDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new Error("invalid inventory guard timestamp");
  return value;
}

function parseNumber(part: string) { return Number.parseInt(part, 10); }

/** Parse an offset-free SQL wall clock only when every component is exact. */
function parseBeijingWallClock(raw: string): Date | null {
  const match = raw.match(WALL_CLOCK);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, fractionRaw = ""] = match;
  const year = parseNumber(yearRaw);
  const month = parseNumber(monthRaw);
  const day = parseNumber(dayRaw);
  const hour = parseNumber(hourRaw);
  const minute = parseNumber(minuteRaw);
  const second = parseNumber(secondRaw);
  const millisecond = parseNumber(fractionRaw.padEnd(3, "0") || "0");
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - BEIJING_OFFSET_MS;
  const local = new Date(epoch + BEIJING_OFFSET_MS);
  if (
    local.getUTCFullYear() !== year
    || local.getUTCMonth() + 1 !== month
    || local.getUTCDate() !== day
    || local.getUTCHours() !== hour
    || local.getUTCMinutes() !== minute
    || local.getUTCSeconds() !== second
    || local.getUTCMilliseconds() !== millisecond
  ) return null;
  return new Date(epoch);
}

/** Parse only a complete ISO datetime with an explicit UTC/offset suffix. */
function parseOffsetIso(raw: string): Date | null {
  const match = raw.match(OFFSET_ISO);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, fractionRaw = "", offsetRaw] = match;
  const year = parseNumber(yearRaw);
  const month = parseNumber(monthRaw);
  const day = parseNumber(dayRaw);
  const hour = parseNumber(hourRaw);
  const minute = parseNumber(minuteRaw);
  const second = parseNumber(secondRaw);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  if (offsetRaw.toUpperCase() !== "Z") {
    const sign = offsetRaw[0];
    const digits = offsetRaw.slice(1).replace(":", "");
    const offsetHour = parseNumber(digits.slice(0, 2));
    const offsetMinute = parseNumber(digits.slice(2, 4));
    if ((sign !== "+" && sign !== "-") || offsetHour > 23 || offsetMinute > 59) return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatBeijing(date: Date): string {
  const shifted = new Date(requireValidDate(date).getTime() + BEIJING_OFFSET_MS);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
    + `.${pad(shifted.getUTCMilliseconds(), 3)}+08:00`;
}

/**
 * Canonical guard timestamp. Raw SQL wall-clock strings are explicitly Beijing;
 * Date/Z/offset input preserves its absolute instant then displays it at +08:00.
 * Invalid or ambiguous strings are deliberately returned raw so equality fails
 * against an independently computed valid token; invalid Dates throw and abort
 * the guarded write rather than guessing.
 */
export function beijingTimestampToken(value: Date | string | null | undefined): TimestampToken {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return formatBeijing(value);
  const raw = String(value).trim();
  const parsed = parseBeijingWallClock(raw) ?? parseOffsetIso(raw);
  return parsed ? formatBeijing(parsed) : raw;
}

/**
 * Exact legacy defect reproduction for a currently locked row only. Do not use
 * this to migrate data or normalize historical stored guards.
 */
export function legacyInventoryImportTimestampToken(value: Date | string | null | undefined): TimestampToken {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return formatBeijing(value).replace(/\+08:00$/, "Z");
  const raw = String(value).trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const parsed = new Date(zoned);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return requireValidDate(value).toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [
      key,
      canonical((value as Record<string, unknown>)[key]),
    ]));
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function inventoryImportCanonicalJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

function decimal(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : String(value);
}
function boolean(value: unknown) { return value === true || value === 1 || value === "1"; }

/** Exact field order and normalization of the browser-visible V3 fingerprint. */
export function inventoryImportFingerprintPayload(
  inventory: GuardableInventory,
  timestamp: (value: GuardableInventory["updatedAt"]) => TimestampToken = beijingTimestampToken,
) {
  return {
    id: inventory.id,
    enterpriseId: inventory.enterpriseId,
    userId: inventory.userId,
    ownerUserId: inventory.ownerUserId,
    partNumberNormalized: inventory.partNumberNormalized,
    status: inventory.status,
    partNumber: inventory.partNumber,
    brand: inventory.brand,
    dateCode: inventory.dateCode,
    qtyOnSale: inventory.qtyOnSale,
    qtyStock: inventory.qtyStock,
    leadTime: inventory.leadTime,
    taxIncluded: boolean(inventory.taxIncluded),
    updatedAt: timestamp(inventory.updatedAt),
    category: inventory.category,
    pkg: inventory.pkg,
    priceEx: decimal(inventory.priceEx),
    priceIncl: decimal(inventory.priceIncl),
    moq: inventory.moq,
    spq: inventory.spq,
    warehouseAddress: inventory.warehouseAddress,
    rohs: boolean(inventory.rohs),
    note: inventory.note,
  };
}

export function inventoryImportFingerprint(
  inventory: GuardableInventory,
  timestamp: (value: GuardableInventory["updatedAt"]) => TimestampToken = beijingTimestampToken,
) {
  return createHash("sha256")
    .update(inventoryImportCanonicalJson(inventoryImportFingerprintPayload(inventory, timestamp)))
    .digest("hex");
}

function revision(inventory: GuardableInventory) {
  const value = Number(inventory.ownershipVersion);
  return Number.isSafeInteger(value) ? value : null;
}
function existingSnapshotJson(
  inventory: GuardableInventory,
  timestamp: (value: GuardableInventory["updatedAt"]) => TimestampToken = beijingTimestampToken,
) {
  return inventoryImportCanonicalJson({
    fingerprintPayload: inventoryImportFingerprintPayload(inventory, timestamp),
    ownershipVersion: revision(inventory),
  });
}

export type ImportCandidateResolution =
  | { action: "new"; inventory: null; restore: false }
  | { action: "update"; inventory: GuardableInventory; restore: boolean }
  | { action: "conflict"; inventory: null; restore: false };

/**
 * Same stage/worker selection rule. A single published record wins even with
 * historical offshelf rows. With no published record, exactly one same-scope
 * draft or offshelf record is a recovery target; no arbitrary first-row choice.
 */
export function resolveImportGuardCandidate(
  candidates: readonly GuardableInventory[],
  scope: GuardScope,
): ImportCandidateResolution {
  if (candidates.length === 0) return { action: "new", inventory: null, restore: false };
  const visible = (candidate: GuardableInventory) =>
    Number(candidate.enterpriseId) === scope.enterpriseId
    && Number(candidate.userId) === scope.userId
    && Number(candidate.ownerUserId) === scope.ownerUserId;
  if (candidates.some(candidate => !visible(candidate))) return { action: "conflict", inventory: null, restore: false };
  const published = candidates.filter(candidate => candidate.status === "published");
  if (published.length === 1) return { action: "update", inventory: published[0], restore: false };
  if (published.length > 1) return { action: "conflict", inventory: null, restore: false };
  const recoverable = candidates.filter(candidate => candidate.status === "draft" || candidate.status === "offshelf");
  if (candidates.length === 1 && recoverable.length === 1) {
    return { action: "update", inventory: recoverable[0], restore: true };
  }
  return { action: "conflict", inventory: null, restore: false };
}

function candidateSnapshot(candidates: readonly GuardableInventory[]) {
  return candidates
    .map(candidate => ({ id: candidate.id, fingerprint: inventoryImportFingerprint(candidate) }))
    .sort((left, right) => left.id - right.id);
}
function newSnapshotJson(scope: GuardScope, candidates: readonly GuardableInventory[]) {
  return inventoryImportCanonicalJson({ kind: "new", ...scope, candidates: candidateSnapshot(candidates) });
}

export function makeExistingImportRowGuard(input: {
  jobId: string;
  rowNumber: number;
  inventory: GuardableInventory;
}): ImportRowVersionGuard {
  return {
    jobId: input.jobId,
    rowNumber: input.rowNumber,
    guardKind: "existing",
    inventoryId: input.inventory.id,
    expectedFingerprint: inventoryImportFingerprint(input.inventory),
    expectedRevision: revision(input.inventory),
    expectedUpdatedAt: beijingTimestampToken(input.inventory.updatedAt),
    snapshotJson: existingSnapshotJson(input.inventory),
  };
}

export function makeNewImportRowGuard(input: {
  jobId: string;
  rowNumber: number;
  scope: GuardScope;
  candidates: readonly GuardableInventory[];
}): ImportRowVersionGuard {
  return {
    jobId: input.jobId,
    rowNumber: input.rowNumber,
    guardKind: "new",
    inventoryId: null,
    expectedFingerprint: null,
    expectedRevision: null,
    expectedUpdatedAt: null,
    snapshotJson: newSnapshotJson(input.scope, input.candidates),
  };
}

function exactExistingGuardMatches(
  guard: ImportRowVersionGuard,
  current: GuardableInventory,
  timestamp: (value: GuardableInventory["updatedAt"]) => TimestampToken,
) {
  return guard.expectedFingerprint === inventoryImportFingerprint(current, timestamp)
    && guard.expectedRevision === revision(current)
    && guard.expectedUpdatedAt === timestamp(current.updatedAt)
    && guard.snapshotJson === existingSnapshotJson(current, timestamp);
}

/** Caller must already hold SELECT ... FOR UPDATE on current.id and all candidates. */
export function existingImportRowGuardMatches(
  guard: ImportRowVersionGuard,
  current: GuardableInventory | null | undefined,
  currentCandidates: readonly GuardableInventory[],
  scope: GuardScope,
) {
  const resolution = resolveImportGuardCandidate(currentCandidates, scope);
  if (!current || guard.guardKind !== "existing" || resolution.action !== "update"
    || resolution.inventory.id !== guard.inventoryId || guard.inventoryId !== current.id) return false;
  try {
    // New canonical mode first; the old mode is a strictly exact, full snapshot
    // reconstruction against this locked row only, never a bulk time migration.
    return exactExistingGuardMatches(guard, current, beijingTimestampToken)
      || exactExistingGuardMatches(guard, current, legacyInventoryImportTimestampToken);
  } catch {
    return false;
  }
}

export function newImportRowGuardMatches(
  guard: ImportRowVersionGuard,
  currentCandidates: readonly GuardableInventory[],
  scope: GuardScope,
) {
  try {
    return guard.guardKind === "new"
      && resolveImportGuardCandidate(currentCandidates, scope).action === "new"
      && guard.snapshotJson === newSnapshotJson(scope, currentCandidates);
  } catch {
    return false;
  }
}

/**
 * Decide a V3 action only after the caller has locked the complete
 * same-enterprise candidate set and the expected existing target (when any).
 * No side-table row means a pre-V3 stage and deliberately retains the legacy
 * current-owner/published lookup path.
 */
export function decideWorkerAction(input: {
  guard: ImportRowVersionGuard | undefined;
  candidateInventories: readonly GuardableInventory[];
  lockedInventoryById: ReadonlyMap<number, GuardableInventory>;
  scope: GuardScope;
}):
  | { action: "legacy" }
  | { action: "insert" }
  | { action: "update"; inventoryId: number; expectedRevision: number | null; expectedStatus: GuardableInventory["status"]; restore: boolean }
  | { action: "stale"; errorCode: "STALE_PREVIEW"; errorMessage: string } {
  const { guard, candidateInventories, lockedInventoryById, scope } = input;
  if (!guard) return { action: "legacy" };
  if (guard.guardKind === "new") {
    return newImportRowGuardMatches(guard, candidateInventories, scope)
      ? { action: "insert" }
      : { action: "stale", errorCode: "STALE_PREVIEW", errorMessage: stalePreviewMessage() };
  }
  const inventoryId = Number(guard.inventoryId);
  const current = lockedInventoryById.get(inventoryId);
  const resolution = resolveImportGuardCandidate(candidateInventories, scope);
  return existingImportRowGuardMatches(guard, current, candidateInventories, scope) && resolution.action === "update"
    ? {
        action: "update",
        inventoryId,
        expectedRevision: guard.expectedRevision,
        expectedStatus: resolution.inventory.status,
        restore: resolution.restore,
      }
    : { action: "stale", errorCode: "STALE_PREVIEW", errorMessage: stalePreviewMessage() };
}

export function stalePreviewMessage() { return "库存内容已变化，请重新预览后修正补发"; }
