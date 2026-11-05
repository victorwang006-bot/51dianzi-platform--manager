import {
  type Company,
  type Enterprise,
} from "../../drizzle/schema";
import { normalizeHkEnterpriseRegistrationIdentifier } from "./enterpriseRegistrationIdentity";

function normalizeCreditCodeForComparison(creditCode: string | null | undefined) {
  return String(creditCode ?? "").replace(/\s/g, "").toUpperCase();
}

function hasActualCnCreditCode(value: string | null | undefined) {
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalizeCreditCodeForComparison(value));
}

function hasActualHkRegistrationIdentifier(value: string | null | undefined) {
  try {
    return Boolean(normalizeHkEnterpriseRegistrationIdentifier(String(value ?? "").trim()));
  } catch {
    return false;
  }
}

export function companyMatchesEnterpriseIdentity(company: Company, enterprise: Enterprise) {
  if (enterprise.registrationRegion === "HK") {
    return company.registrationRegion === "HK"
      && hasActualHkRegistrationIdentifier(enterprise.registrationIdentifier)
      && hasActualHkRegistrationIdentifier(company.registrationIdentifier)
      && company.registrationIdentifier!.trim().toUpperCase() === enterprise.registrationIdentifier!.trim().toUpperCase();
  }
  return company.registrationRegion !== "HK"
    && hasActualCnCreditCode(enterprise.creditCode)
    && hasActualCnCreditCode(company.creditCode)
    && normalizeCreditCodeForComparison(company.creditCode) === normalizeCreditCodeForComparison(enterprise.creditCode);
}

function companyHasAnotherActualIdentity(company: Company, enterprise: Enterprise) {
  if (company.registrationRegion === "HK") {
    return hasActualHkRegistrationIdentifier(company.registrationIdentifier)
      && !companyMatchesEnterpriseIdentity(company, enterprise);
  }
  return hasActualCnCreditCode(company.creditCode)
    && !companyMatchesEnterpriseIdentity(company, enterprise);
}

function companySelectionScore(company: Company, enterprise: Enterprise) {
  const identity = companyMatchesEnterpriseIdentity(company, enterprise) ? 10_000 : 0;
  const linked = company.enterpriseId === enterprise.id ? 1_000 : 0;
  const stableDataOwner = company.userId === enterprise.crmDataOwnerUserId ? 100 : 0;
  // Status is only a tie-breaker. The returned row's actual review status is retained; a pending
  // or rejected row is never upgraded to approved by selection.
  const review = company.reviewStatus === "approved" ? 10 : company.reviewStatus === "pending" ? 1 : 0;
  const named = company.companyName?.trim() ? 1 : 0;
  return identity + linked + stableDataOwner + review + named;
}

function companySelectionTime(company: Company) {
  return Math.max(company.submittedAt?.getTime() ?? 0, company.reviewedAt?.getTime() ?? 0, company.createdAt?.getTime() ?? 0);
}

/**
 * Pick a company record by stable enterprise identity rather than physical row order. Records
 * linked to another enterprise or carrying a valid mismatched identity are excluded outright;
 * intentionally blank new drafts remain eligible as a last resort.
 */
export function selectEnterpriseCompanyRecord(enterprise: Enterprise, rows: Company[]) {
  const seenIds: Record<number, boolean> = {};
  const uniqueRows = rows.filter(row => {
    if (seenIds[row.id]) return false;
    seenIds[row.id] = true;
    return true;
  });
  const eligible = uniqueRows.filter(company =>
    (company.enterpriseId === null || company.enterpriseId === enterprise.id)
    && !companyHasAnotherActualIdentity(company, enterprise),
  );
  return eligible.sort((left, right) =>
    companySelectionScore(right, enterprise) - companySelectionScore(left, enterprise)
    || companySelectionTime(right) - companySelectionTime(left)
    || right.id - left.id,
  )[0];
}

/** Deterministic personal-draft fallback; a linked row is never another tenant's fallback. */
export function selectPersonalCompanyRecord(userId: number, rows: Company[]) {
  const score = (company: Company) =>
    (company.companyName?.trim() ? 10 : 0)
    + (company.registrationRegion === "HK"
      ? (hasActualHkRegistrationIdentifier(company.registrationIdentifier) ? 100 : 0)
      : (hasActualCnCreditCode(company.creditCode) ? 100 : 0))
    + (company.submittedAt ? 2 : 0) + (company.reviewStatus === "approved" ? 1 : 0);
  return rows.filter(row => row.userId === userId && row.enterpriseId === null)
    .sort((left, right) => score(right) - score(left)
      || companySelectionTime(right) - companySelectionTime(left) || right.id - left.id)[0];
}
