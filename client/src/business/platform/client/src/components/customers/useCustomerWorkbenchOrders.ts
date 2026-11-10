import { trpc } from "../../../../../api/business-trpc";
import type { CustomerContactScope } from "./customerContacts";

/** UI query gate only; each order procedure still rechecks fresh permissions. */
export function useCustomerWorkbenchOrders(scope: CustomerContactScope | null, scopeReady: boolean) {
  const query = trpc.enterprise.me.useQuery(undefined, {
    enabled: scopeReady && Boolean(scope), retry: false, staleTime: 0,
    placeholderData: undefined, refetchOnMount: "always",
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const data = query.data;
  const permissionKeys: readonly string[] = data?.permissionKeys ?? [];
  const verified = scopeReady && Boolean(scope) && !query.isError && !query.isFetching
    && query.isFetchedAfterMount !== false && !query.isPlaceholderData
    && data?.enterprise?.id === scope?.enterpriseId && data?.currentUserId === scope?.actorUserId
    && (!data?.member || data.member.status === "active");
  return { canRead: Boolean(verified && (data?.isOwner || permissionKeys.includes("sales.business_orders"))),
    failed: query.isError, pending: query.isPending, refresh: () => query.refetch() };
}
