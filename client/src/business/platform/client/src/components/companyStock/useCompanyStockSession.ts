import { useRef } from "react";
import {
  businessStorageScope,
  useBusinessScope,
} from "../../../../../BusinessScope";
import { useAuth } from "../../../../../api/business-auth";
import { useSalesOrderSession } from "../../hooks/useSalesOrderSession";

/** UI freshness only: reuse the BFF-bound staff/login proof; never grant native rights. */
export function useCompanyStockScope() {
  const scope = useBusinessScope();
  const auth = useAuth();
  const ready = Boolean(
    scope.contextVerification.state === "verified" &&
      scope.contextVerification.identity === scope.storageScope &&
      businessStorageScope() === scope.storageScope &&
      scope.staffPrincipal.status === "ready" &&
      scope.staffPrincipal.frontendUserId === scope.frontUser.id &&
      !auth.loading &&
      auth.isAuthenticated &&
      auth.user?.id === scope.frontUser.id &&
      !auth.user?.loginDisabled
  );
  // Background revalidation disables writes but does not abandon an in-memory draft.
  // Actual binding/access/login replacement remounts, including A -> B -> A.
  const identityKey = JSON.stringify([
    scope.storageScope,
    scope.contextVerification.identity,
    scope.contextVerification.authorizationVersion,
    scope.staffPrincipal.status,
    scope.staffPrincipal.frontendUserId,
    scope.frontUser.id,
    auth.user?.id,
    auth.isAuthenticated,
    Boolean(auth.user?.loginDisabled),
  ]);
  return { ready, identityKey, storageScope: scope.storageScope };
}

export function useCompanyStockSession(enabled: boolean) {
  const scope = useCompanyStockScope();
  const session = useSalesOrderSession(enabled && scope.ready);
  const live = useRef(scope);
  live.current = scope;
  const guarded = useRef({
    isWritable: () =>
      session.isWritable() &&
      live.current.ready &&
      businessStorageScope() === live.current.storageScope,
  });
  return guarded.current;
}
