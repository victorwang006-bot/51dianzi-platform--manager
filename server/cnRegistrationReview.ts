import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { auditLogs, merchants } from "../drizzle/schema";
import { getDb, type MaterialAuditActor } from "./db";
import {
  cnReviewMerchantStateEligible,
  cnReviewOwnerInScope,
  platformDatabaseIdentifier,
} from "./cnRegistrationPolicy";
import { assertCurrentCnRegistrationDocumentReferences } from "./cnRegistrationDocumentPolicy";

const PLATFORM_DB = platformDatabaseIdentifier();
const VERSION_PREFIX = "cn-registration-review-v1";
const AUDIT_ACTION = "merchant.cn-registration.review";
const EFFECTIVE_KEYS = new Set([
  "companyName", "creditCode", "companyType", "legalPerson", "companyRole",
  "bankAccountName", "bankAccountNumber", "bankName", "regAddress", "establishedAt",
  "salesOwner", "salesOwnerCode",
  "licenseUrl", "licenseObjectKey", "licenseFileName",
  "bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName",
]);
const DRAFT_KEYS = new Set([
  "companyName", "creditCode", "companyType", "legalPerson", "companyRole",
  "bankAccountName", "bankAccountNumber", "bankName", "regAddress", "establishedAt",
  "salesOwner", "salesOwnerCode",
  "licenseUrl", "licenseObjectKey", "licenseFileName",
  "bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName",
]);

type Candidate = {
  companyName: string;
  creditCode: string;
  companyType: string;
  legalPerson: string;
  companyRole: string | null;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  regAddress: string;
  establishedAt: string | null;
  salesOwner: string | null;
  salesOwnerCode: string | null;
  licenseUrl: string | null;
  licenseObjectKey: string | null;
  licenseFileName: string | null;
  bankLicenseUrl: string | null;
  bankLicenseObjectKey: string | null;
  bankLicenseFileName: string | null;
};

type PlatformRow = Candidate & {
  companyId: number;
  enterpriseId: number;
  companyRegistrationRegion: string | null;
  enterpriseRegistrationRegion: string | null;
  enterpriseCreditCode: string | null;
  superAdminUserId: string | null;
  dataOwnerUserId: string | null;
  companyUserId: string | null;
  memberStatus: string | null;
  memberRole: string | null;
  ownerLoginDisabled: number | string | null;
  pendingDraft: unknown;
  pendingDraftJsonValid: number | string | null;
  reviewStatus: string | null;
  certLevel: string | null;
  rejectReason: string | null;
  reviewedAt: Date | string | null;
  submittedAt: Date | string | null;
  expectedVersion: string;
};

type MerchantReviewRow = Pick<typeof merchants.$inferSelect,
  "id" | "registrationRegion" | "businessLicense" | "status" | "crmStatus" | "crmOwnerPortalUserId">;
type Executor = { execute(statement: SQL): Promise<unknown> };

function text(value: unknown, max: number, required = false) {
  if (value == null) {
    if (required) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    return null;
  }
  if (typeof value !== "string") throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  return normalized || null;
}

function dateOnly(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return value;
}

function creditCode(value: unknown) {
  const normalized = text(value, 32, true)?.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized ?? "")) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  return normalized!;
}

function cnIdentity(merchant: Pick<typeof merchants.$inferSelect, "registrationRegion" | "businessLicense">) {
  if (merchant.registrationRegion !== "CN") return null;
  const normalized = merchant.businessLicense?.replace(/\s/g, "").toUpperCase() ?? "";
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized) ? `CN:${normalized}` : null;
}

function candidateFrom(source: unknown, fromDraft = false): Candidate {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  const draft = source as Record<string, unknown>;
  const allowedKeys = fromDraft ? DRAFT_KEYS : EFFECTIVE_KEYS;
  if (Object.keys(draft).some(key => !allowedKeys.has(key))) throw new Error("CN_REVIEW_UNSUPPORTED_DRAFT_FIELD");
  const candidate: Candidate = {
    companyName: text(draft.companyName, 128, true)!,
    creditCode: creditCode(draft.creditCode),
    companyType: text(draft.companyType, 128, true)!,
    legalPerson: text(draft.legalPerson, 64, true)!,
    companyRole: text(draft.companyRole, 64),
    bankAccountName: text(draft.bankAccountName, 128, true)!,
    bankAccountNumber: text(draft.bankAccountNumber, 64, true)!,
    bankName: text(draft.bankName, 128, true)!,
    regAddress: text(draft.regAddress, 255, true)!,
    establishedAt: dateOnly(draft.establishedAt),
    salesOwner: text(draft.salesOwner, 64),
    salesOwnerCode: text(draft.salesOwnerCode, 64),
    licenseUrl: text(draft.licenseUrl, 1024),
    licenseObjectKey: text(draft.licenseObjectKey, 512),
    licenseFileName: text(draft.licenseFileName, 255),
    bankLicenseUrl: text(draft.bankLicenseUrl, 1024),
    bankLicenseObjectKey: text(draft.bankLicenseObjectKey, 512),
    bankLicenseFileName: text(draft.bankLicenseFileName, 255),
  };
  const owns = Object.prototype.hasOwnProperty;
  const licenseChanged = ["licenseUrl", "licenseObjectKey", "licenseFileName"].some(key => owns.call(draft, key));
  const bankLicenseChanged = ["bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName"].some(key => owns.call(draft, key));
  if (fromDraft && ((licenseChanged && (!candidate.licenseObjectKey || !candidate.licenseFileName))
    || (bankLicenseChanged && (!candidate.bankLicenseObjectKey || !candidate.bankLicenseFileName)))) {
    throw new Error("CN_REVIEW_CANDIDATE_INVALID");
  }
  return candidate;
}

function decodeDraft(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (typeof value !== "string") throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    try {
      return decodeDraft(JSON.parse(value));
    } catch {
      throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    }
  }
  return value as Record<string, unknown>;
}

function maskAccount(value: string | null) {
  if (!value) return null;
  return value.length <= 4 ? "****" : `${"*".repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-4)}`;
}

function documents(row: Pick<Candidate, "licenseObjectKey" | "licenseUrl" | "licenseFileName" | "bankLicenseObjectKey" | "bankLicenseFileName">, candidate: Candidate | null = null) {
  const licenseKey = candidate?.licenseObjectKey ?? row.licenseObjectKey;
  const licenseUrl = candidate?.licenseUrl ?? row.licenseUrl;
  const licenseName = candidate?.licenseFileName ?? row.licenseFileName;
  const bankKey = candidate?.bankLicenseObjectKey ?? row.bankLicenseObjectKey;
  const bankName = candidate?.bankLicenseFileName ?? row.bankLicenseFileName;
  return {
    BUSINESS_LICENSE: { available: Boolean(licenseKey || licenseUrl), fileName: text(licenseName, 255) },
    BANK_LICENSE: { available: Boolean(bankKey), fileName: text(bankName, 255) },
  };
}

function summary(candidate: Candidate, row: PlatformRow) {
  return {
    companyName: candidate.companyName,
    unifiedSocialCreditCode: candidate.creditCode,
    legalRepresentative: candidate.legalPerson,
    registeredAddress: candidate.regAddress,
    bankAccountName: candidate.bankAccountName,
    bankName: candidate.bankName,
    bankAccountNumberMasked: maskAccount(candidate.bankAccountNumber),
    documents: documents(row, candidate),
  };
}

function difference(field: string, label: string, before: unknown, after: unknown) {
  return (before ?? null) === (after ?? null) ? null : { field, label, before: before ?? null, after: after ?? null, changed: true as const };
}

function differences(effective: Candidate | null, candidate: Candidate) {
  const baseline: Candidate = effective ?? {
    companyName: "", creditCode: "", companyType: "", legalPerson: "", companyRole: null,
    bankAccountName: "", bankAccountNumber: "", bankName: "", regAddress: "", establishedAt: null,
    salesOwner: null, salesOwnerCode: null, licenseUrl: null, licenseObjectKey: null, licenseFileName: null,
    bankLicenseUrl: null, bankLicenseObjectKey: null, bankLicenseFileName: null,
  };
  const rows = [
    difference("companyName", "企业名称", baseline.companyName, candidate.companyName),
    difference("creditCode", "统一社会信用代码", baseline.creditCode, candidate.creditCode),
    difference("legalPerson", "法定代表人", baseline.legalPerson, candidate.legalPerson),
    difference("companyType", "企业类型", baseline.companyType, candidate.companyType),
    difference("companyRole", "企业角色", baseline.companyRole, candidate.companyRole),
    difference("regAddress", "注册地址", baseline.regAddress, candidate.regAddress),
    difference("bankAccountName", "账户名称", baseline.bankAccountName, candidate.bankAccountName),
    difference("bankName", "开户行", baseline.bankName, candidate.bankName),
    difference("establishedAt", "成立日期", baseline.establishedAt, candidate.establishedAt),
    difference("salesOwner", "销售负责人", baseline.salesOwner, candidate.salesOwner),
    difference("salesOwnerCode", "销售负责人工号", baseline.salesOwnerCode, candidate.salesOwnerCode),
  ].filter((row): row is NonNullable<typeof row> => row !== null);
  if (baseline.bankAccountNumber !== candidate.bankAccountNumber) {
    rows.push({ field: "bankAccountNumber", label: "账户号码", before: maskAccount(baseline.bankAccountNumber), after: maskAccount(candidate.bankAccountNumber), changed: true });
  }
  if (baseline.licenseObjectKey !== candidate.licenseObjectKey || baseline.licenseUrl !== candidate.licenseUrl || baseline.licenseFileName !== candidate.licenseFileName) {
    rows.push({ field: "documents.BUSINESS_LICENSE", label: "营业执照", before: baseline.licenseFileName || "已上传", after: candidate.licenseFileName || "已更换", changed: true });
  }
  if (baseline.bankLicenseObjectKey !== candidate.bankLicenseObjectKey || baseline.bankLicenseFileName !== candidate.bankLicenseFileName) {
    rows.push({ field: "documents.BANK_LICENSE", label: "银行许可证", before: baseline.bankLicenseFileName || "已上传", after: candidate.bankLicenseFileName || "已更换", changed: true });
  }
  return rows;
}

function versionSql(merchant: MerchantReviewRow) {
  return sql`SHA2(CONCAT_WS(CHAR(10),
    ${VERSION_PREFIX}, CAST(company.id AS CHAR), COALESCE(CAST(company.pendingDraft AS CHAR), ''),
    COALESCE(company.companyName, ''), COALESCE(company.creditCode, ''), COALESCE(company.companyType, ''), COALESCE(company.legalPerson, ''), COALESCE(company.companyRole, ''),
    COALESCE(company.bankAccountName, ''), COALESCE(company.bankAccountNumber, ''), COALESCE(company.bankName, ''), COALESCE(company.regAddress, ''), COALESCE(CAST(company.establishedAt AS CHAR), ''),
    COALESCE(company.salesOwner, ''), COALESCE(company.salesOwnerCode, ''), COALESCE(company.licenseUrl, ''), COALESCE(company.licenseObjectKey, ''), COALESCE(company.licenseFileName, ''),
    COALESCE(company.bankLicenseUrl, ''), COALESCE(company.bankLicenseObjectKey, ''), COALESCE(company.bankLicenseFileName, ''), COALESCE(CAST(company.submittedAt AS CHAR), ''), COALESCE(company.reviewStatus, ''),
    CAST(${merchant.id} AS CHAR), COALESCE(${merchant.registrationRegion}, ''), COALESCE(${merchant.businessLicense}, ''), COALESCE(${merchant.status}, ''), COALESCE(${merchant.crmStatus}, ''), COALESCE(CAST(${merchant.crmOwnerPortalUserId} AS CHAR), '')
  ), 256)`;
}

async function readPlatformCompany(executor: Executor, merchant: MerchantReviewRow, forUpdate = false) {
  const identity = cnIdentity(merchant);
  if (!identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
  const lock = forUpdate ? sql`FOR UPDATE` : sql``;
  const result = await executor.execute(sql`
    SELECT company.id AS companyId, company.enterpriseId AS enterpriseId, company.registrationRegion AS companyRegistrationRegion,
           company.companyName, company.creditCode, company.companyType, company.legalPerson, company.companyRole, company.bankAccountName, company.bankAccountNumber, company.bankName, company.regAddress,
           DATE_FORMAT(company.establishedAt, '%Y-%m-%d') AS establishedAt, company.salesOwner, company.salesOwnerCode,
           company.licenseUrl, company.licenseObjectKey, company.licenseFileName, company.bankLicenseUrl, company.bankLicenseObjectKey, company.bankLicenseFileName,
           company.pendingDraft, JSON_VALID(company.pendingDraft) AS pendingDraftJsonValid, company.reviewStatus, company.certLevel, company.rejectReason, company.reviewedAt, company.submittedAt,
           ${versionSql(merchant)} AS expectedVersion, enterprise.registrationRegion AS enterpriseRegistrationRegion, enterprise.creditCode AS enterpriseCreditCode,
           CAST(enterprise.superAdminUserId AS CHAR) AS superAdminUserId, CAST(enterprise.crmDataOwnerUserId AS CHAR) AS dataOwnerUserId, CAST(company.userId AS CHAR) AS companyUserId,
           member.status AS memberStatus, member.role AS memberRole, ownerAccount.loginDisabled AS ownerLoginDisabled
      FROM ${sql.raw(PLATFORM_DB)}.companies AS company
      INNER JOIN ${sql.raw(PLATFORM_DB)}.enterprises AS enterprise ON enterprise.id = company.enterpriseId
      LEFT JOIN ${sql.raw(PLATFORM_DB)}.enterprise_members AS member ON member.enterpriseId = enterprise.id AND member.userId = enterprise.crmDataOwnerUserId
      LEFT JOIN ${sql.raw(PLATFORM_DB)}.users AS ownerAccount ON ownerAccount.id = enterprise.crmDataOwnerUserId
     WHERE company.registrationRegion = 'CN' AND enterprise.registrationRegion = 'CN'
       AND UPPER(REPLACE(company.creditCode, ' ', '')) = ${identity.slice(3)}
     LIMIT 2 ${lock}
  `) as [PlatformRow[], unknown];
  if (result[0]?.length !== 1 || !result[0][0]) throw new Error("CN_REVIEW_PLATFORM_SUBJECT_NOT_FOUND");
  return result[0][0];
}

function effectiveCandidate(row: PlatformRow) {
  return candidateFrom({
    companyName: row.companyName, creditCode: row.creditCode, companyType: row.companyType, legalPerson: row.legalPerson, companyRole: row.companyRole,
    bankAccountName: row.bankAccountName, bankAccountNumber: row.bankAccountNumber, bankName: row.bankName, regAddress: row.regAddress, establishedAt: row.establishedAt,
    salesOwner: row.salesOwner, salesOwnerCode: row.salesOwnerCode, licenseUrl: row.licenseUrl, licenseObjectKey: row.licenseObjectKey, licenseFileName: row.licenseFileName,
    bankLicenseUrl: row.bankLicenseUrl, bankLicenseObjectKey: row.bankLicenseObjectKey, bankLicenseFileName: row.bankLicenseFileName,
  });
}

function resolveDocuments(candidate: Candidate, row: PlatformRow): Candidate {
  return {
    ...candidate,
    // Registration review is not a sales-owner assignment workflow. Pending
    // drafts may retain only an equal historical snapshot; keep the effective owner.
    salesOwner: row.salesOwner,
    salesOwnerCode: row.salesOwnerCode,
    licenseUrl: candidate.licenseUrl ?? row.licenseUrl,
    licenseObjectKey: candidate.licenseObjectKey ?? row.licenseObjectKey,
    licenseFileName: candidate.licenseFileName ?? row.licenseFileName,
    bankLicenseUrl: candidate.bankLicenseUrl ?? row.bankLicenseUrl,
    bankLicenseObjectKey: candidate.bankLicenseObjectKey ?? row.bankLicenseObjectKey,
    bankLicenseFileName: candidate.bankLicenseFileName ?? row.bankLicenseFileName,
  };
}

function assertDraftOwnerFieldsRetained(draft: Record<string, unknown>, candidate: Candidate, row: PlatformRow) {
  const owns = Object.prototype.hasOwnProperty;
  // Legacy platform drafts can contain a snapshot of the routing owner. It is
  // compatible only when it exactly retains the current effective owner; the
  // review path never applies either value to a platform or local write.
  if ((owns.call(draft, "salesOwner") && candidate.salesOwner !== text(row.salesOwner, 64))
    || (owns.call(draft, "salesOwnerCode") && candidate.salesOwnerCode !== text(row.salesOwnerCode, 64))) {
    throw new Error("CN_REVIEW_UNSUPPORTED_DRAFT_FIELD");
  }
}

function draftDocumentChanged(draft: Record<string, unknown>, candidate: Candidate, row: PlatformRow) {
  const owns = Object.prototype.hasOwnProperty;
  const documentFields: Array<keyof Pick<Candidate,
    "licenseUrl" | "licenseObjectKey" | "licenseFileName"
    | "bankLicenseUrl" | "bankLicenseObjectKey" | "bankLicenseFileName">> = [
      "licenseUrl", "licenseObjectKey", "licenseFileName",
      "bankLicenseUrl", "bankLicenseObjectKey", "bankLicenseFileName",
    ];
  return documentFields.some(field => owns.call(draft, field)
    && (candidate[field] ?? row[field]) !== row[field]);
}

/**
 * The current CN submit schema never carries document fields in pendingDraft:
 * protected upload mutations persist their private keys on the effective row
 * first, and the locked expectedVersion binds that row to review. A draft that
 * tries to replace a key therefore has no existing producer path to certify.
 */
function assertDraftDocumentReferences(draft: Record<string, unknown>, candidate: Candidate, row: PlatformRow) {
  if (draftDocumentChanged(draft, candidate, row)) {
    throw new Error("CN_REVIEW_DOCUMENT_MIGRATION_REQUIRED");
  }
}

function reviewState(row: PlatformRow) {
  if (row.reviewStatus !== "pending") return { candidate: null, effective: null, reviewKind: null };
  if (row.pendingDraft != null) {
    if (Number(row.pendingDraftJsonValid) !== 1) throw new Error("CN_REVIEW_CANDIDATE_INVALID");
    const draft = decodeDraft(row.pendingDraft);
    const candidate = candidateFrom(draft, true);
    assertDraftOwnerFieldsRetained(draft, candidate, row);
    const resolved = resolveDocuments(candidate, row);
    assertCurrentCnRegistrationDocumentReferences({ dataOwnerUserId: row.dataOwnerUserId, documents: resolved });
    assertDraftDocumentReferences(draft, candidate, row);
    return { candidate: resolved, effective: effectiveCandidate(row), reviewKind: "resubmission" as const };
  }
  const candidate = effectiveCandidate(row);
  assertCurrentCnRegistrationDocumentReferences({ dataOwnerUserId: row.dataOwnerUserId, documents: candidate });
  return { candidate, effective: null, reviewKind: "initial" as const };
}

function assertSubject(merchant: Pick<typeof merchants.$inferSelect, "registrationRegion" | "businessLicense" | "crmOwnerPortalUserId">, row: PlatformRow, candidate: Candidate) {
  const identity = cnIdentity(merchant);
  const companyIdentity = row.companyRegistrationRegion === "CN" ? `CN:${String(row.creditCode ?? "").replace(/\s/g, "").toUpperCase()}` : null;
  const enterpriseIdentity = row.enterpriseRegistrationRegion === "CN" ? `CN:${String(row.enterpriseCreditCode ?? "").replace(/\s/g, "").toUpperCase()}` : null;
  if (!identity || companyIdentity !== identity || enterpriseIdentity !== identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
  if (candidate.creditCode !== identity.slice(3)
    || String(row.companyUserId ?? "") !== String(row.dataOwnerUserId ?? "")
    || String(row.superAdminUserId ?? "") !== String(row.dataOwnerUserId ?? "")
    || row.memberStatus !== "active" || row.memberRole !== "super_admin"
    || row.ownerLoginDisabled == null || Number(row.ownerLoginDisabled) !== 0) {
    throw new Error("CN_REVIEW_OWNER_OR_SUBJECT_INVALID");
  }
  const crmOwner = merchant.crmOwnerPortalUserId?.trim() || null;
  if (crmOwner && crmOwner !== String(row.dataOwnerUserId ?? "")) throw new Error("CN_REVIEW_OWNER_OR_SUBJECT_INVALID");
}

function changeNotice(row: PlatformRow, candidate: Candidate | null, reviewKind: "initial" | "resubmission" | null) {
  if (!candidate || reviewKind !== "resubmission") return null;
  const nameChanged = candidate.companyName !== text(row.companyName, 128, true);
  const personChanged = candidate.legalPerson !== text(row.legalPerson, 64, true);
  if (nameChanged && personChanged) return "企业名称和法人信息有变更，请核对资料后审核。";
  if (nameChanged) return "企业名称有变更，请核对资料后审核。";
  if (personChanged) return "法人信息有变更，请核对资料后审核。";
  return null;
}

function companyGuard(identity: string, merchant: MerchantReviewRow, expectedVersion: string) {
  return sql`company.registrationRegion = 'CN' AND UPPER(REPLACE(company.creditCode, ' ', '')) = ${identity.slice(3)} AND company.reviewStatus = 'pending' AND ${versionSql(merchant)} = ${expectedVersion}`;
}

async function priorDecision(tx: Executor, merchantId: number, expectedVersion: string) {
  const result = await tx.execute(sql`
    SELECT JSON_UNQUOTE(JSON_EXTRACT(afterValue, '$.expectedVersion')) AS expectedVersion,
           JSON_UNQUOTE(JSON_EXTRACT(afterValue, '$.decision')) AS decision
      FROM audit_logs WHERE targetType = 'merchant' AND targetId = ${String(merchantId)} AND action = ${AUDIT_ACTION}
     ORDER BY id DESC LIMIT 3 FOR UPDATE
  `) as [{ expectedVersion: string | null; decision: "approved" | "rejected" | null }[], unknown];
  return (result[0] ?? []).find(row => row.expectedVersion === expectedVersion) ?? null;
}

export async function getCnRegistrationReviewDetail(merchantId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  if (merchant.registrationRegion !== "CN") throw new Error("CN_REGISTRATION_REQUIRED");
  const row = await readPlatformCompany(db as unknown as Executor, merchant);
  const state = reviewState(row);
  if (state.candidate) assertSubject(merchant, row, state.candidate);
  return {
    merchantId: merchant.id,
    region: "CN" as const,
    reviewKind: state.reviewKind,
    effective: state.effective ? summary(state.effective, row) : null,
    candidate: state.candidate ? {
      expectedVersion: String(row.expectedVersion),
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
      summary: summary(state.candidate, row),
    } : null,
    differences: differences(state.effective, state.candidate ?? effectiveCandidate(row)),
    reviewStatus: row.reviewStatus ?? "none",
    reviewBlockedReason: null,
    reviewBlockedCode: null,
    reviewNotice: changeNotice(row, state.candidate, state.reviewKind),
    canReview: Boolean(state.candidate && cnReviewMerchantStateEligible(merchant.status, state.reviewKind)),
  };
}

export async function reviewCnRegistrationDraft(input: {
  merchantId: number;
  decision: "approved" | "rejected";
  expectedVersion: string;
  note?: string | null;
  confirmed?: boolean;
  actor?: MaterialAuditActor;
  /** undefined means super-admin; a concrete array is formal-owner scope only. */
  allowedSalesStaffCodes?: string[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_NOT_AVAILABLE");
  const note = input.note?.trim() || null;
  if (input.decision === "rejected" && !note) throw new Error("CN_REVIEW_NOTE_REQUIRED");
  if (input.decision === "approved" && input.confirmed !== true) throw new Error("CN_REVIEW_CONFIRMATION_REQUIRED");
  return db.transaction(async tx => {
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1).for("update");
    if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
    if (merchant.registrationRegion !== "CN") throw new Error("CN_REGISTRATION_REQUIRED");
    if (!cnReviewOwnerInScope(merchant.salesOwnerCode, input.allowedSalesStaffCodes)) throw new Error("MERCHANT_NOT_FOUND");
    const identity = cnIdentity(merchant);
    if (!identity) throw new Error("CN_REVIEW_SUBJECT_MISMATCH");
    const row = await readPlatformCompany(tx as unknown as Executor, merchant, true);
    const state = reviewState(row);
    if (!state.candidate) {
      const prior = await priorDecision(tx as unknown as Executor, merchant.id, input.expectedVersion);
      if (!prior) throw new Error("CN_REVIEW_CANDIDATE_NOT_FOUND");
      if (prior.decision !== input.decision) throw new Error("CN_REVIEW_ALREADY_DECIDED");
      return { success: true as const, decision: input.decision, merchantId: merchant.id, expectedVersion: input.expectedVersion, idempotent: true as const, reviewStatus: row.reviewStatus, retainedEffectiveAccess: true as const };
    }
    if (!cnReviewMerchantStateEligible(merchant.status, state.reviewKind)) {
      throw new Error("CN_REVIEW_MERCHANT_STATE_INVALID");
    }
    if (String(row.expectedVersion) !== input.expectedVersion) throw new Error("CN_REVIEW_VERSION_CHANGED");
    assertSubject(merchant, row, state.candidate);
    const isResubmission = state.reviewKind === "resubmission";
    const before = {
      merchantStatus: merchant.status,
      merchantCrmStatus: merchant.crmStatus,
      companyReviewStatus: row.reviewStatus,
      companyCertification: row.certLevel,
      reviewKind: state.reviewKind,
      expectedVersion: input.expectedVersion,
    };
    const guard = companyGuard(identity, merchant, input.expectedVersion);
    let reviewStatus: "approved" | "rejected";
    if (input.decision === "approved") {
      const candidate = state.candidate;
      const companyUpdate = await tx.execute(sql`
        UPDATE ${sql.raw(PLATFORM_DB)}.companies AS company
           SET company.companyName = ${candidate.companyName}, company.creditCode = ${candidate.creditCode}, company.companyType = ${candidate.companyType}, company.legalPerson = ${candidate.legalPerson}, company.companyRole = ${candidate.companyRole},
               company.bankAccountName = ${candidate.bankAccountName}, company.bankAccountNumber = ${candidate.bankAccountNumber}, company.bankName = ${candidate.bankName}, company.regAddress = ${candidate.regAddress}, company.establishedAt = ${candidate.establishedAt},
               company.licenseUrl = ${candidate.licenseUrl}, company.licenseObjectKey = ${candidate.licenseObjectKey}, company.licenseFileName = ${candidate.licenseFileName}, company.bankLicenseUrl = ${candidate.bankLicenseUrl}, company.bankLicenseObjectKey = ${candidate.bankLicenseObjectKey}, company.bankLicenseFileName = ${candidate.bankLicenseFileName},
               company.pendingDraft = NULL, company.reviewStatus = 'approved', company.certLevel = CASE WHEN company.certLevel = 'premium' THEN 'premium' ELSE 'certified' END, company.rejectReason = NULL, company.reviewedAt = NOW(), company.merchantSinceAt = COALESCE(company.merchantSinceAt, NOW())
         WHERE ${guard}
      `) as unknown as [{ affectedRows?: number }, unknown];
      if (Number(companyUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_VERSION_CHANGED");
      const enterpriseUpdate = await tx.execute(sql`
        UPDATE ${sql.raw(PLATFORM_DB)}.enterprises AS enterprise SET enterprise.companyName = ${candidate.companyName}
         WHERE enterprise.id = ${row.enterpriseId} AND enterprise.registrationRegion = 'CN'
           AND UPPER(REPLACE(enterprise.creditCode, ' ', '')) = ${identity.slice(3)}
           AND CAST(enterprise.superAdminUserId AS CHAR) = CAST(enterprise.crmDataOwnerUserId AS CHAR)
      `) as unknown as [{ affectedRows?: number }, unknown];
      if (candidate.companyName !== text(row.companyName, 128, true) && Number(enterpriseUpdate[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("CN_REVIEW_VERSION_CHANGED");
      }
      const merchantUpdate = await tx.update(merchants).set({
        companyName: candidate.companyName,
        legalPersonName: candidate.legalPerson,
        companyType: candidate.companyType,
        companyRole: candidate.companyRole,
        registeredAddress: candidate.regAddress,
        establishedDate: candidate.establishedAt ? new Date(`${candidate.establishedAt}T00:00:00+08:00`) : null,
        settlementAccountName: candidate.bankAccountName,
        settlementAccount: candidate.bankAccountNumber,
        settlementBank: candidate.bankName,
        licenseObjectKey: candidate.licenseObjectKey,
        licenseImageUrl: candidate.licenseUrl,
        bankDocumentObjectKey: candidate.bankLicenseObjectKey,
        status: merchant.status === "pending" ? "approved" : merchant.status,
        reviewNote: note,
        reviewedBy: input.actor?.operatorId ?? null,
        reviewedAt: new Date(),
      }).where(and(eq(merchants.id, merchant.id), eq(merchants.status, merchant.status), eq(merchants.crmStatus, merchant.crmStatus)));
      if (Number(merchantUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_MERCHANT_UPDATE_FAILED");
      reviewStatus = "approved";
    } else {
      const nextStatus = isResubmission ? "approved" : "rejected";
      const companyUpdate = await tx.execute(sql`
        UPDATE ${sql.raw(PLATFORM_DB)}.companies AS company
           SET company.pendingDraft = NULL, company.reviewStatus = ${nextStatus}, company.certLevel = CASE WHEN ${isResubmission} THEN company.certLevel ELSE 'pending' END, company.rejectReason = ${note}, company.reviewedAt = NOW()
         WHERE ${guard}
      `) as unknown as [{ affectedRows?: number }, unknown];
      if (Number(companyUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_VERSION_CHANGED");
      const merchantUpdate = await tx.update(merchants).set({
        status: !isResubmission && merchant.status === "pending" ? "supplement" : merchant.status,
        reviewNote: note,
        reviewedBy: input.actor?.operatorId ?? null,
        reviewedAt: new Date(),
      }).where(and(eq(merchants.id, merchant.id), eq(merchants.status, merchant.status), eq(merchants.crmStatus, merchant.crmStatus)));
      if (Number(merchantUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_MERCHANT_UPDATE_FAILED");
      reviewStatus = nextStatus;
    }
    await tx.insert(auditLogs).values({
      operatorId: input.actor?.operatorId ?? null,
      operatorName: input.actor?.operatorName ?? "system",
      operatorRole: input.actor?.operatorRole ?? "system",
      action: AUDIT_ACTION,
      module: "merchants",
      targetType: "merchant",
      targetId: String(merchant.id),
      beforeValue: before,
      afterValue: {
        decision: input.decision,
        expectedVersion: input.expectedVersion,
        companyReviewStatus: reviewStatus,
        merchantStatus: input.decision === "approved" && merchant.status === "pending" ? "approved" : !isResubmission && merchant.status === "pending" ? "supplement" : merchant.status,
        reviewKind: state.reviewKind,
        retainedEffectiveAccess: isResubmission,
      },
      ipAddress: input.actor?.ipAddress ?? null,
      userAgent: input.actor?.userAgent ?? null,
      result: "success",
      note,
    });
    return { success: true as const, decision: input.decision, merchantId: merchant.id, expectedVersion: input.expectedVersion, idempotent: false as const, reviewStatus, retainedEffectiveAccess: isResubmission };
  });
}

function readScope(salesStaffCodes?: string[]) {
  if (salesStaffCodes === undefined) return undefined;
  if (salesStaffCodes.length === 0) return sql`1 = 0`;
  return inArray(merchants.salesOwnerCode, salesStaffCodes);
}

export async function getCnRegistrationReviewQueue(params: { page?: number; pageSize?: number }, salesStaffCodes?: string[]) {
  const db = await getDb();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 20)));
  if (!db || (salesStaffCodes !== undefined && salesStaffCodes.length === 0)) return { items: [], total: 0 };
  const scope = salesStaffCodes === undefined ? sql`` : sql`AND ${readScope(salesStaffCodes)}`;
  const predicate = sql`
    merchants.registrationRegion = 'CN' AND company.registrationRegion = 'CN' AND company.reviewStatus = 'pending'
    AND UPPER(REPLACE(company.creditCode, ' ', '')) = UPPER(REPLACE(merchants.businessLicense, ' ', ''))
    AND ((merchants.status = 'pending' AND company.pendingDraft IS NULL)
      OR (merchants.status = 'approved' AND company.pendingDraft IS NOT NULL AND JSON_VALID(company.pendingDraft) = 1)) ${scope}
  `;
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total FROM merchants INNER JOIN ${sql.raw(PLATFORM_DB)}.companies AS company
      ON company.registrationRegion = 'CN' AND UPPER(REPLACE(company.creditCode, ' ', '')) = UPPER(REPLACE(merchants.businessLicense, ' ', '')) WHERE ${predicate}
  `) as unknown as [{ total?: number | string }[], unknown];
  const result = await db.execute(sql`
    SELECT merchants.id AS merchantId, merchants.merchantNo, company.companyName, company.submittedAt,
           CASE WHEN company.pendingDraft IS NULL THEN 'initial' ELSE 'resubmission' END AS reviewKind
      FROM merchants INNER JOIN ${sql.raw(PLATFORM_DB)}.companies AS company
        ON company.registrationRegion = 'CN' AND UPPER(REPLACE(company.creditCode, ' ', '')) = UPPER(REPLACE(merchants.businessLicense, ' ', ''))
     WHERE ${predicate} ORDER BY company.submittedAt ASC, merchants.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `) as unknown as [Array<{ merchantId: number | string; merchantNo: string | null; companyName: string | null; submittedAt: Date | string | null; reviewKind: string | null }>, unknown];
  return {
    items: (result[0] ?? []).map(row => ({
      merchantId: Number(row.merchantId),
      merchantNo: row.merchantNo ?? null,
      companyName: row.companyName ?? null,
      region: "CN" as const,
      reviewKind: row.reviewKind === "resubmission" ? "resubmission" as const : "initial" as const,
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
    })),
    total: Number(countResult[0]?.[0]?.total ?? 0),
  };
}
