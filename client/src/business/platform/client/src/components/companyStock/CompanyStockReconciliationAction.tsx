import { trpc } from "../../../../../api/business-trpc";
import type { CompanyStockReconciliationCandidate } from "../../../../shared/companyStock";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
export function CompanyStockReconciliationAction(
  props: Parameters<typeof CompanyStockReconciliationActionSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <CompanyStockReconciliationActionSession
      key={`${scope.identityKey}:${props.row.id}`}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function CompanyStockReconciliationActionSession({
  row,
  enabled,
  onSelect,
}: {
  row: { id: number; partNumber: string; status: string };
  enabled: boolean;
  onSelect: (candidate: CompanyStockReconciliationCandidate) => void;
}) {
  const scope = useCompanyStockScope();
  const session = useCompanyStockSession(enabled);
  enabled = enabled && scope.ready;
  const query = trpc.inbound.companyStockReconciliationCandidates.useQuery(
    { partNumber: row.partNumber, limit: 100 },
    {
      enabled: enabled && row.status === "received",
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const fresh =
    enabled &&
    row.status === "received" &&
    query.isSuccess &&
    !query.isError &&
    !query.isFetching &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount !== false;
  const candidate = fresh
    ? query.data?.find(
        item =>
          item.id === row.id &&
          item.partNumber === row.partNumber &&
          item.status === "pending_reconciliation" &&
          Number.isSafeInteger(item.expectedMovementVersion)
      )
    : undefined;
  return candidate ? (
    <button
      type="button"
      role="menuitem"
      className="erp-menu-item"
      onClick={() => {
        if (session.isWritable() && fresh) onSelect(candidate);
      }}
    >
      核对库存
    </button>
  ) : null;
}
