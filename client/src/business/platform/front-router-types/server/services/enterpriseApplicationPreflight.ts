import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  companies,
  enterpriseMembers,
  enterprises,
  type Company,
  type Enterprise,
  type EnterpriseMember,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { canRepairEnterpriseCreditCode } from "./enterpriseAccess";
import { normalizeHkEnterpriseRegistrationIdentifier } from "./enterpriseRegistrationIdentity";

/** Keep duplicate responses deliberately non-enumerating across CN and HK applications. */
export const DUPLICATE_ENTERPRISE_OPENING_MESSAGE = "该公司名称或营业执照已申请／开通，请勿重复开通";

type ApplicationIdentity =
  | { kind: "CN"; creditCode: string }
  | { kind: "HK"; registrationIdentifier: string };

type CompanyCandidate = Pick<Company,
  "id" | "userId" | "enterpriseId" | "companyName" | "creditCode" | "registrationRegion"
  | "registrationIdentifier" | "licenseObjectKey" | "registrationData"
  | "pendingDraft" | "reviewStatus"
>;

export type EnterpriseApplicationPreflightInput = {
  userId: number;
  companyName: string;
  /** HK's registered Chinese name participates verbatim; no translation or transliteration is attempted. */
  chineseName?: string | null;
  creditCode?: string | null;
  registrationIdentifier?: string | null;
  /** A private object key is a stable document reference, never OCR-derived evidence. */
  privateLicenseObjectKey?: string | null;
  /** Opening must not treat an already-approved own company as a successful new opening. */
  purpose: "opening" | "review-update";
};

function duplicateOpeningConflict(): never {
  throw new TRPCError({ code: "CONFLICT", message: DUPLICATE_ENTERPRISE_OPENING_MESSAGE });
}

/**
 * Canonical comparison only prevents visual/simple input variants. It deliberately does not
 * convert traditional Chinese, transliterate pinyin, drop arbitrary punctuation, or fuzzy-match.
 */
export function normalizeEnterpriseApplicationName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\u3000]+/g, "");
}

function normalizeCnIdentity(value: string | null | undefined) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\s\u3000]+/g, "").toUpperCase();
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized) ? normalized : null;
}

function normalizeHkIdentity(value: string | null | undefined) {
  try {
    return normalizeHkEnterpriseRegistrationIdentifier(String(value ?? "").normalize("NFKC"));
  } catch {
    return null;
  }
}

function requestIdentity(input: EnterpriseApplicationPreflightInput): ApplicationIdentity {
  const creditCode = normalizeCnIdentity(input.creditCode);
  const registrationIdentifier = normalizeHkIdentity(input.registrationIdentifier);
  if (Boolean(creditCode) === Boolean(registrationIdentifier)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能提供有效营业执照代码或香港登记标识" });
  }
  return creditCode
    ? { kind: "CN", creditCode }
    : { kind: "HK", registrationIdentifier: registrationIdentifier! };
}

function identityOfCompany(company: Pick<Company, "creditCode" | "registrationRegion" | "registrationIdentifier">): ApplicationIdentity | null {
  if (company.registrationRegion === "HK") {
    const registrationIdentifier = normalizeHkIdentity(company.registrationIdentifier);
    return registrationIdentifier ? { kind: "HK", registrationIdentifier } : null;
  }
  const creditCode = normalizeCnIdentity(company.creditCode);
  return creditCode ? { kind: "CN", creditCode } : null;
}

function identityOfEnterprise(enterprise: Pick<Enterprise, "creditCode" | "registrationRegion" | "registrationIdentifier">): ApplicationIdentity | null {
  if (enterprise.registrationRegion === "HK") {
    const registrationIdentifier = normalizeHkIdentity(enterprise.registrationIdentifier);
    return registrationIdentifier ? { kind: "HK", registrationIdentifier } : null;
  }
  const creditCode = normalizeCnIdentity(enterprise.creditCode);
  return creditCode ? { kind: "CN", creditCode } : null;
}

function sameIdentity(left: ApplicationIdentity | null, right: ApplicationIdentity) {
  return Boolean(left)
    && left!.kind === right.kind
    && (left!.kind === "CN"
      ? left!.creditCode === (right as Extract<ApplicationIdentity, { kind: "CN" }>).creditCode
      : left!.registrationIdentifier === (right as Extract<ApplicationIdentity, { kind: "HK" }>).registrationIdentifier);
}

function companyChineseName(company: Pick<CompanyCandidate, "registrationData">) {
  const registrationData = company.registrationData as { chineseName?: unknown } | null;
  return typeof registrationData?.chineseName === "string" ? registrationData.chineseName : null;
}

function pendingDraftNames(company: Pick<CompanyCandidate, "pendingDraft">) {
  if (!company.pendingDraft) return [];
  try {
    const draft = JSON.parse(company.pendingDraft) as {
      companyName?: unknown;
      registrationData?: { companyName?: unknown; chineseName?: unknown };
    };
    return [
      typeof draft.companyName === "string" ? draft.companyName : null,
      typeof draft.registrationData?.companyName === "string" ? draft.registrationData.companyName : null,
      typeof draft.registrationData?.chineseName === "string" ? draft.registrationData.chineseName : null,
    ];
  } catch {
    return [];
  }
}

function namesOfCompany(company: CompanyCandidate) {
  return [company.companyName, companyChineseName(company)].concat(pendingDraftNames(company))
    .map(normalizeEnterpriseApplicationName)
    .filter(Boolean);
}

function namesOfEnterprise(enterprise: Enterprise) {
  const name = normalizeEnterpriseApplicationName(enterprise.companyName);
  return name ? [name] : [];
}

function hasNameMatch(existingNames: string[], requestedNames: Set<string>) {
  return existingNames.some(name => requestedNames.has(name));
}

function normalizedPrivateKey(value: string | null | undefined) {
  const key = String(value ?? "").trim();
  return key || null;
}

/** The CN uploader owns this namespace; do not accept arbitrary storage keys from a form post. */
export function isValidPrivateMainlandLicenseObjectKey(value: string | null | undefined) {
  const key = normalizedPrivateKey(value);
  return Boolean(key && /^licenses\/user-\d+-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key));
}

/**
 * CN applications must supply a previously persisted private licence. A historical public URL
 * is accepted only when it belongs to the same existing CN identity; it is compatibility data,
 * not a new-upload bypass and never depends on crmAccess or OCR output.
 */
export function assertMainlandApplicationLicense(input: {
  company: Pick<Company, "creditCode" | "registrationRegion" | "registrationIdentifier" | "licenseObjectKey" | "licenseUrl"> | null | undefined;
  requestedCreditCode: string;
}) {
  if (isValidPrivateMainlandLicenseObjectKey(input.company?.licenseObjectKey)) return;
  const existingIdentity = input.company ? identityOfCompany(input.company) : null;
  const requestedIdentity = normalizeCnIdentity(input.requestedCreditCode);
  const legacyUrl = String(input.company?.licenseUrl ?? "").trim();
  if (
    requestedIdentity
    && legacyUrl.startsWith("https://")
    && sameIdentity(existingIdentity, { kind: "CN", creditCode: requestedIdentity })
  ) {
    return;
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "请先上传有效营业执照" });
}

function isApprovedIdentityEvidence(
  company: CompanyCandidate,
  identity: ApplicationIdentity,
  enterpriseId: number,
  dataOwnerUserId: number,
) {
  return company.userId === dataOwnerUserId
    && company.reviewStatus === "approved"
    && (company.enterpriseId === null || company.enterpriseId === enterpriseId)
    && sameIdentity(identityOfCompany(company), identity);
}

function isPermittedLegacyCreditCodeRepair(input: {
  identity: ApplicationIdentity;
  userId: number;
  memberships: EnterpriseMember[];
  enterpriseById: Map<number, Enterprise>;
  companies: CompanyCandidate[];
}) {
  if (input.identity.kind !== "CN") return new Set<number>();
  const repairableEnterpriseIds = new Set<number>();
  for (const membership of input.memberships) {
    const enterprise = input.enterpriseById.get(membership.enterpriseId);
    if (
      !enterprise
      || membership.status !== "active"
      || membership.role !== "super_admin"
      || enterprise.superAdminUserId !== input.userId
      || enterprise.registrationRegion === "HK"
    ) {
      continue;
    }
    const approvedCompanyCreditCode = input.companies.find(company =>
      isApprovedIdentityEvidence(company, input.identity, enterprise.id, enterprise.crmDataOwnerUserId),
    )?.creditCode ?? null;
    if (approvedCompanyCreditCode && canRepairEnterpriseCreditCode({
      currentEnterpriseCreditCode: enterprise.creditCode,
      requestedCreditCode: input.identity.creditCode,
      approvedCompanyCreditCode,
    })) {
      repairableEnterpriseIds.add(enterprise.id);
    }
  }
  return repairableEnterpriseIds;
}

/**
 * Read-only local guard placed before agreement evidence, ledger writes, and remote CRM creation.
 * Database unique constraints remain the final arbitration for enterprise identity claim; this
 * protects names/private document references that cannot be safely merged or auto-repaired.
 */
export async function preflightEnterpriseApplication(input: EnterpriseApplicationPreflightInput) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

  const identity = requestIdentity(input);
  const requestedNames = new Set(
    [input.companyName, input.chineseName]
      .map(normalizeEnterpriseApplicationName)
      .filter(Boolean),
  );
  const privateLicenseObjectKey = normalizedPrivateKey(input.privateLicenseObjectKey);

  // NFKC/bracket normalization is not expressible portably in MySQL. Applications are infrequent,
  // so compare the local identity registry in memory rather than weakening the match in SQL.
  const [memberships, allEnterprises, allCompanies] = await Promise.all([
    db.select().from(enterpriseMembers).where(eq(enterpriseMembers.userId, input.userId)),
    db.select().from(enterprises),
    db.select({
      id: companies.id,
      userId: companies.userId,
      enterpriseId: companies.enterpriseId,
      companyName: companies.companyName,
      creditCode: companies.creditCode,
      registrationRegion: companies.registrationRegion,
      registrationIdentifier: companies.registrationIdentifier,
      licenseObjectKey: companies.licenseObjectKey,
      registrationData: companies.registrationData,
      pendingDraft: companies.pendingDraft,
      reviewStatus: companies.reviewStatus,
    }).from(companies),
  ]);
  const enterpriseById = new Map(allEnterprises.map(enterprise => [enterprise.id, enterprise]));
  const exactRequesterEnterpriseIds = new Set(
    allEnterprises
      .filter(enterprise => enterprise.superAdminUserId === input.userId && sameIdentity(identityOfEnterprise(enterprise), identity))
      .map(enterprise => enterprise.id),
  );
  const repairableEnterpriseIds = isPermittedLegacyCreditCodeRepair({
    identity,
    userId: input.userId,
    memberships,
    enterpriseById,
    companies: allCompanies,
  });
  const permittedMembershipEnterpriseIds = new Set<number>(
    Array.from(exactRequesterEnterpriseIds).concat(Array.from(repairableEnterpriseIds)),
  );

  for (const membership of memberships) {
    if (permittedMembershipEnterpriseIds.has(membership.enterpriseId) && membership.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员身份已暂停，不能重复申请开通" });
    }
    const isCurrentExactOwner = permittedMembershipEnterpriseIds.has(membership.enterpriseId)
      && membership.status === "active"
      && membership.role === "super_admin"
      && enterpriseById.get(membership.enterpriseId)?.superAdminUserId === input.userId;
    // An active ordinary member must use its existing enterprise access, not submit an opening;
    // any membership in another enterprise is likewise a hard local boundary before remote CRM.
    if (!isCurrentExactOwner) {
      duplicateOpeningConflict();
    }
  }

  if (memberships.length && !memberships.some(membership =>
    permittedMembershipEnterpriseIds.has(membership.enterpriseId)
    && membership.status === "active"
    && membership.role === "super_admin"
    && enterpriseById.get(membership.enterpriseId)?.superAdminUserId === input.userId,
  )) {
    duplicateOpeningConflict();
  }

  const permittedDataOwners = new Set<number>([input.userId]);
  for (const enterpriseId of Array.from(permittedMembershipEnterpriseIds)) {
    const enterprise = enterpriseById.get(enterpriseId);
    if (enterprise) permittedDataOwners.add(enterprise.crmDataOwnerUserId);
  }
  const isSameApplicationCompanyOwner = (company: CompanyCandidate) =>
    permittedDataOwners.has(company.userId)
    && (company.enterpriseId === null || permittedMembershipEnterpriseIds.size === 0 || permittedMembershipEnterpriseIds.has(company.enterpriseId));

  for (const enterprise of allEnterprises) {
    const enterpriseIdentity = identityOfEnterprise(enterprise);
    const sameOwner = enterprise.superAdminUserId === input.userId;
    if (sameIdentity(enterpriseIdentity, identity) && !sameOwner) duplicateOpeningConflict();
    if (hasNameMatch(namesOfEnterprise(enterprise), requestedNames) && !sameOwner) duplicateOpeningConflict();
  }

  let hasOwnApprovedIdentity = false;
  for (const company of allCompanies) {
    const companyIdentity = identityOfCompany(company);
    const sameOwner = isSameApplicationCompanyOwner(company);
    const sameRequestedIdentity = sameIdentity(companyIdentity, identity);
    const nameMatches = hasNameMatch(namesOfCompany(company), requestedNames);
    const samePrivateLicense = Boolean(
      privateLicenseObjectKey
      && normalizedPrivateKey(company.licenseObjectKey) === privateLicenseObjectKey,
    );

    if (sameRequestedIdentity && !sameOwner) duplicateOpeningConflict();
    if (nameMatches && !sameOwner) duplicateOpeningConflict();
    if (samePrivateLicense && !sameOwner) duplicateOpeningConflict();

    if (!sameOwner) continue;
    if (sameRequestedIdentity && company.reviewStatus === "approved") hasOwnApprovedIdentity = true;

    // A current owner can update its same identity (or a truly blank draft), but may not turn a
    // pending/rejected/approved record for another actual identity into a new enterprise.
    if (companyIdentity && !sameRequestedIdentity && !repairableEnterpriseIds.size) duplicateOpeningConflict();
    if (!companyIdentity && namesOfCompany(company).length > 0 && !nameMatches) duplicateOpeningConflict();
    if (samePrivateLicense && !sameRequestedIdentity && companyIdentity) duplicateOpeningConflict();
  }

  if (input.purpose === "opening" && hasOwnApprovedIdentity) duplicateOpeningConflict();

  return {
    identity,
    existingEnterpriseId: Array.from(exactRequesterEnterpriseIds)[0] ?? null,
    legacyCreditCodeRepair: repairableEnterpriseIds.size > 0,
  } as const;
}
