/**
 * Private registration and banking evidence never follows ordinary enterprise-member access.
 * Mainland evidence remains bound to the legacy company owner; Hong Kong evidence follows the
 * current enterprise super administrator so an approved owner transfer does not strand it.
 */
export function canAccessCompanySensitiveDocuments(input: {
  actorUserId: number;
  actorRole?: string | null;
  registrationRegion?: string | null;
  companyOwnerUserId?: number | null;
  enterpriseSuperAdminUserId?: number | null;
}): boolean {
  if (input.actorRole === "admin") return true;
  if (input.registrationRegion === "HK") {
    return input.enterpriseSuperAdminUserId === input.actorUserId;
  }
  return input.companyOwnerUserId === input.actorUserId;
}
