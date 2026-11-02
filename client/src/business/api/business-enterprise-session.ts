import { useBusinessScope } from "../BusinessScope";

/**
 * UI-only compatibility for imported customer components. BusinessScope exists
 * only behind the current BFF merchant and active staff-binding gates. This
 * view cannot select an enterprise, grant a permission or replace server checks.
 */
export function useOptionalEnterpriseSession() {
  const { staffPrincipal, frontUser } = useBusinessScope();
  const ready = staffPrincipal.status === "ready"
    && staffPrincipal.frontendUserId === frontUser.id
    && Number.isSafeInteger(staffPrincipal.enterpriseId)
    && staffPrincipal.enterpriseId > 0;
  return {
    activeEnterprise: ready ? {
      enterpriseId: staffPrincipal.enterpriseId,
      memberStatus: "active" as const,
      accessStatus: "enabled" as const,
    } : null,
  };
}
