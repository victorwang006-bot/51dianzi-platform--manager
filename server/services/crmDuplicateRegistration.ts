import mysql from "mysql2/promise";
import { merchants } from "../../drizzle/schema";

/**
 * The public duplicate response is deliberately reason-free. In particular it
 * must never reveal a private object key, another enterprise owner, or whether
 * the matching record is an unpublished HK draft.
 */
export const CRM_DUPLICATE_OPENING_CODE = "CRM_DUPLICATE_OPENING";
export const CRM_DUPLICATE_OPENING_MESSAGE = "该公司名称或营业执照已申请／开通，请勿重复开通";
export const CRM_LICENSE_REQUIRED_CODE = "CRM_LICENSE_REQUIRED";
export const CRM_LICENSE_REQUIRED_MESSAGE = "请先上传营业执照后再提交开通申请";

const CRM_DUPLICATE_REGISTRATION_LOCK = "crm_duplicate_registration_v1";
const CRM_DUPLICATE_REGISTRATION_LOCK_TIMEOUT_SECONDS = 5;

type LockConnection = {
  query(statement: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
};

type LockConnectionFactory = (databaseUrl: string) => Promise<LockConnection>;

export type CrmDuplicateRegistrationLockOptions = {
  /** Test-only injection; production deliberately uses DATABASE_URL unchanged. */
  databaseUrl?: string;
  createConnection?: LockConnectionFactory;
};

/**
 * Serializes the create/open critical section through MySQL itself rather than
 * an in-process mutex. The carrier connection holds the advisory lock until
 * the caller's *entire* transaction has committed or rolled back.
 */
export async function withCrmDuplicateRegistrationLock<T>(
  operation: () => Promise<T>,
  options: CrmDuplicateRegistrationLockOptions = {},
): Promise<T> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_NOT_AVAILABLE");

  // Passing the original URI through untouched retains its TLS, timeout and
  // connection parameters. This is a dedicated carrier, never a pool handle.
  const createConnection = options.createConnection
    ?? (mysql.createConnection as unknown as LockConnectionFactory);
  const carrier = await createConnection(databaseUrl);
  let acquired = false;
  try {
    const [result] = await carrier.query(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [CRM_DUPLICATE_REGISTRATION_LOCK, CRM_DUPLICATE_REGISTRATION_LOCK_TIMEOUT_SECONDS],
    );
    const first = Array.isArray(result) ? result[0] as { acquired?: unknown } | undefined : undefined;
    acquired = Number(first?.acquired) === 1;
    if (!acquired) throw new Error("CRM_DUPLICATE_LOCK_UNAVAILABLE");
    return await operation();
  } finally {
    try {
      if (acquired) {
        await carrier.query("SELECT RELEASE_LOCK(?) AS released", [CRM_DUPLICATE_REGISTRATION_LOCK]);
      }
    } finally {
      await carrier.end();
    }
  }
}

export type CrmDuplicateRegistrationCandidate = {
  /** CN identities are `CN:<normalized 18-character USCC>`; HK is `HK:<BRN>`. */
  identity: string | null;
  companyNames: readonly string[];
  crmOwnerPortalUserId: string | null;
  licenseObjectKey?: string | null;
  /** The current row may be updated, but every other historical duplicate still blocks enablement. */
  currentMerchantId?: number;
};

type DuplicateRegistrationRow = {
  id: number;
  companyName: string | null;
  registrationRegion: "CN" | "HK" | string | null;
  registrationIdentifier: string | null;
  businessLicense: string | null;
  licenseObjectKey: string | null;
  crmOwnerPortalUserId: string | null;
  crmStatus: string | null;
  registrationData: unknown;
  registrationPendingData: unknown;
};

export type CrmDuplicateConflict = {
  /** Kept internal: callers must return only the generic duplicate message. */
  reason: "identity" | "companyName" | "licenseObjectKey" | "owner";
  merchantId: number;
};

function normalizeOwner(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizedCnIdentity(value: string | null | undefined) {
  const code = value?.replace(/\s+/g, "").toUpperCase() || "";
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code) ? `CN:${code}` : null;
}

function normalizedHkIdentity(value: string | null | undefined) {
  const identity = value?.trim().toUpperCase() || "";
  return /^HK:\d{8}$/.test(identity) ? identity : null;
}

function rowIdentity(row: DuplicateRegistrationRow) {
  return row.registrationRegion === "HK"
    ? normalizedHkIdentity(row.registrationIdentifier)
    : normalizedCnIdentity(row.businessLicense);
}

/** NFKC + case + whitespace + parenthesis normalization only; never fuzzy-match or translate. */
export function normalizeCrmCompanyName(value: string | null | undefined) {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\uFF08\uFF09]/g, character => character === "（" ? "(" : ")")
    .replace(/\s+/g, "");
}

function decodeJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Extracts the English and optional Chinese HK registered-name aliases from effective and pending JSON. */
export function crmDuplicateNamesFromMerchant(row: Pick<DuplicateRegistrationRow,
  "companyName" | "registrationData" | "registrationPendingData">) {
  const names = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = normalizeCrmCompanyName(value);
    if (normalized) names.add(normalized);
  };
  add(row.companyName);
  for (const json of [row.registrationData, row.registrationPendingData]) {
    const record = decodeJsonRecord(json);
    const registration = record?.registration && typeof record.registration === "object"
      ? record.registration as Record<string, unknown>
      : record;
    add(registration?.companyName);
    add(registration?.chineseName);
  }
  return Array.from(names);
}

function candidateNames(candidate: CrmDuplicateRegistrationCandidate) {
  return new Set(candidate.companyNames
    .map(normalizeCrmCompanyName)
    .filter((name): name is string => Boolean(name)));
}

function namesIntersect(left: ReadonlySet<string>, right: readonly string[]) {
  return right.some(name => left.has(name));
}

/**
 * Read-only conflict detector. The fixed MySQL advisory carrier lock already
 * serializes create/open decisions. This deliberately remains a plain snapshot
 * query: locking all merchants would block unrelated CRM and admin work.
 */
export async function findCrmDuplicateRegistrationConflict(
  tx: any,
  candidate: CrmDuplicateRegistrationCandidate,
): Promise<CrmDuplicateConflict | null> {
  const rows = await tx.select({
    id: merchants.id,
    companyName: merchants.companyName,
    registrationRegion: merchants.registrationRegion,
    registrationIdentifier: merchants.registrationIdentifier,
    businessLicense: merchants.businessLicense,
    licenseObjectKey: merchants.licenseObjectKey,
    crmOwnerPortalUserId: merchants.crmOwnerPortalUserId,
    crmStatus: merchants.crmStatus,
    registrationData: merchants.registrationData,
    registrationPendingData: merchants.registrationPendingData,
  }).from(merchants) as DuplicateRegistrationRow[];

  const names = candidateNames(candidate);
  const owner = normalizeOwner(candidate.crmOwnerPortalUserId);
  const candidateLicenseKey = candidate.licenseObjectKey?.trim() || null;
  for (const row of rows) {
    if (row.id === candidate.currentMerchantId) continue;
    const existingOwner = normalizeOwner(row.crmOwnerPortalUserId);
    const identityMatches = Boolean(candidate.identity && rowIdentity(row) === candidate.identity);

    // `currentMerchantId` is the sole exact-identity exception. Any *other*
    // historical copy, even with the same owner, remains a conflict so a bad
    // legacy duplicate can never be newly enabled or used to create a third.
    if (identityMatches) {
      return { reason: "identity", merchantId: row.id };
    }
    if (owner && existingOwner === owner && !identityMatches) {
      return { reason: "owner", merchantId: row.id };
    }
    if (candidateLicenseKey && row.licenseObjectKey?.trim() === candidateLicenseKey && !identityMatches) {
      return { reason: "licenseObjectKey", merchantId: row.id };
    }
    if (!identityMatches && names.size > 0 && namesIntersect(names, crmDuplicateNamesFromMerchant(row))) {
      return { reason: "companyName", merchantId: row.id };
    }
  }
  return null;
}

export function crmDuplicateOpeningResult(crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected") {
  return {
    accepted: false as const,
    created: false as const,
    code: CRM_DUPLICATE_OPENING_CODE,
    crmStatus,
    message: CRM_DUPLICATE_OPENING_MESSAGE,
  };
}

export function crmLicenseEvidenceError(message = CRM_LICENSE_REQUIRED_MESSAGE) {
  const error = new Error(message) as Error & { code?: string };
  error.code = CRM_LICENSE_REQUIRED_CODE;
  return error;
}

/**
 * CN CRM accepts a newly-uploaded private object key, or only the exact
 * applicant's pre-existing private/legacy evidence. Callers must not pass an
 * unrelated merchant's values into this assertion.
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isStoredLicenseObjectKey(value: string) {
  return /^licenses\/[A-Za-z0-9][A-Za-z0-9._/-]{0,510}$/.test(value)
    && !value.split("/").some(part => part === "." || part === "..");
}

/** New CN uploads must be an owner-scoped private key, never a caller URL. */
export function isSubmittedCrmLicenseObjectKey(value: string | null | undefined, portalUserId: string | null) {
  const key = value?.trim() || "";
  const owner = portalUserId?.trim() || "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) return false;
  return new RegExp(`^licenses/user-${escapeRegExp(owner)}-[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`).test(key);
}

export function assertCrmLicenseEvidence(evidence: {
  submittedPrivateLicenseObjectKey?: string | null;
  portalUserId?: string | null;
  /** Exact current merchant only; its saved compatibility evidence is trusted read-only. */
  storedPrivateLicenseObjectKey?: string | null;
  storedLegacyLicenseImageUrl?: string | null;
}, message = CRM_LICENSE_REQUIRED_MESSAGE): void {
  const submittedKey = evidence.submittedPrivateLicenseObjectKey?.trim() || "";
  const storedKey = evidence.storedPrivateLicenseObjectKey?.trim() || "";
  const storedLegacyUrl = evidence.storedLegacyLicenseImageUrl?.trim() || "";
  if (submittedKey && !isSubmittedCrmLicenseObjectKey(submittedKey, evidence.portalUserId ?? null)
    && !(storedKey === submittedKey && isStoredLicenseObjectKey(storedKey))) {
    throw crmLicenseEvidenceError(message);
  }
  if (isSubmittedCrmLicenseObjectKey(submittedKey, evidence.portalUserId ?? null)
    || ((!submittedKey || storedKey === submittedKey) && isStoredLicenseObjectKey(storedKey))
    || /^https:\/\/[^\s]+$/i.test(storedLegacyUrl)) return;
  throw crmLicenseEvidenceError(message);
}

export function crmLicenseRequiredResult() {
  return {
    accepted: false as const,
    created: false as const,
    code: CRM_LICENSE_REQUIRED_CODE,
    crmStatus: "none" as const,
    message: CRM_LICENSE_REQUIRED_MESSAGE,
  };
}
