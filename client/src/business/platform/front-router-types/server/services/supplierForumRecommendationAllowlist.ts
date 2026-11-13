/** Frozen current production tuples. Parent fills only after read-only verification.
 * This is NOT dynamic enrollment; DB JSON alone cannot authorize a new supplier.
 * Never add usernames, secrets, tokens, customerService or lazy-created identities.
 */
export type SupplierForumFrozenIdentity = Readonly<{
  enterpriseId: number;
  authorUserId: number;
  dataOwnerUserId: number;
  companyId: number;
}>;
// 2026-11-11 16:58 Beijing: current identity/eligible-material preflight only.
// This bounded three-supplier cohort is not all 420 eligible registered suppliers.
// DB policy remains disabled until independent currency proof and exact approval.
export const SUPPLIER_FORUM_CURRENT_ALLOWLIST: readonly SupplierForumFrozenIdentity[] = Object.freeze([
  Object.freeze({ enterpriseId: 20, authorUserId: 422246, dataOwnerUserId: 422246, companyId: 90023 }),
  Object.freeze({ enterpriseId: 112, authorUserId: 543233, dataOwnerUserId: 543233, companyId: 90132 }),
  Object.freeze({ enterpriseId: 129, authorUserId: 564175, dataOwnerUserId: 564175, companyId: 90148 }),
]);
