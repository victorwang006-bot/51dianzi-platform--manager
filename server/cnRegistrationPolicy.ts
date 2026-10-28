/**
 * CN registration review uses this module from both the review service and db.ts.
 * Keep it dependency-free: importing db.ts here would create a review/db cycle.
 */
const DEFAULT_PLATFORM_DB_NAME = "dianzi51";
const SAFE_MYSQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * sql.raw() is only safe for a deliberately constrained identifier.  An unset
 * variable keeps the long-standing default; a present-but-empty or malformed
 * value is configuration failure, never something to interpolate.
 */
export function platformDatabaseIdentifier(configured = process.env.PLATFORM_DB_NAME): string {
  if (configured === undefined) return DEFAULT_PLATFORM_DB_NAME;
  if (!SAFE_MYSQL_IDENTIFIER.test(configured)) {
    throw new Error("PLATFORM_DB_NAME_INVALID");
  }
  return configured;
}

export function cnReviewMerchantStateEligible(
  merchantStatus: string | null | undefined,
  reviewKind: "initial" | "resubmission" | null,
) {
  return (reviewKind === "initial" && merchantStatus === "pending")
    || (reviewKind === "resubmission" && merchantStatus === "approved");
}

/** Formal sales owner scope only: collaborators remain read-only. */
export function cnReviewOwnerInScope(
  salesOwnerCode: string | null | undefined,
  allowedSalesStaffCodes: string[] | undefined,
) {
  if (allowedSalesStaffCodes === undefined) return true;
  const owner = salesOwnerCode?.trim() || "";
  return Boolean(owner) && allowedSalesStaffCodes.includes(owner);
}
