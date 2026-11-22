import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../api/business-trpc";
import type { ProcurementDemandPage } from "../../../shared/customerDemands";

export function isDemandAuthorizationError(error: unknown): boolean {
  const value = error as {
    data?: { code?: string; httpStatus?: number };
    shape?: { data?: { code?: string } };
  } | null;
  const code = value?.data?.code ?? value?.shape?.data?.code;
  return (
    ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(code ?? "") ||
    [401, 403].includes(value?.data?.httpStatus ?? 0)
  );
}

type ReadQuery<T> = {
  data?: T;
  error?: unknown;
  isSuccess?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  isPlaceholderData?: boolean;
  isFetchedAfterMount?: boolean;
};
/** A proof belongs to one mounted authorization generation and one applied input.
 * Ordinary background failures retain that proof, never a cached first-read success.
 * Security failures erase it synchronously, including A → B → A transitions.
 */
export function useProcurementRead<T>(
  query: ReadQuery<T>,
  key: string,
  ready: boolean,
  denied = false
) {
  const proof = useRef<{ key: string; data?: T }>({ key });
  if (
    proof.current.key !== key ||
    !ready ||
    denied ||
    isDemandAuthorizationError(query.error)
  )
    proof.current = { key };
  const fresh =
    ready &&
    !denied &&
    query.isSuccess === true &&
    !query.error &&
    !query.isError &&
    !query.isFetching &&
    !query.isLoading &&
    !query.isPending &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount === true;
  if (fresh && query.data !== undefined) proof.current.data = query.data;
  return {
    data: proof.current.data,
    fresh,
    denied: denied || isDemandAuthorizationError(query.error),
  };
}

export function useDocumentVisible() {
  const [visible, setVisible] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState !== "hidden"
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

type SubmissionCursor = ProcurementDemandPage["latestSubmission"];
/** Local session state only; the existing workbench QueryClient is authorization-scoped. */
export function useProcurementArrivals(enabled: boolean, resetProof = false) {
  const visible = useDocumentVisible();
  const [baseline, setBaseline] = useState<SubmissionCursor | undefined>(
    undefined
  );
  const [count, setCount] = useState(0);
  const peek = trpc.customerDemand.procurementList.useQuery(
    {
      view: "all",
      keyword: "",
      sort: "latest",
      page: 1,
      pageSize: 1,
      ...(resetProof || baseline === undefined ? {} : { newSince: baseline }),
    },
    {
      enabled: enabled && visible,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: enabled && visible ? 30_000 : false,
      refetchIntervalInBackground: false,
      retry: false,
      placeholderData: undefined,
    }
  );
  const denied = isDemandAuthorizationError(peek.error);
  const valid =
    enabled &&
    visible &&
    peek.isSuccess === true &&
    !peek.error &&
    !peek.isError &&
    !peek.isFetching &&
    !peek.isPlaceholderData &&
    peek.isFetchedAfterMount === true;
  useEffect(() => {
    if (denied || resetProof) {
      setBaseline(undefined);
      setCount(0);
      return;
    }
    if (!valid || !peek.data || !("latestSubmission" in peek.data)) return;
    if (baseline === undefined) {
      setBaseline(peek.data.latestSubmission);
      setCount(0);
    } else if (typeof peek.data.newCount === "number")
      setCount(Math.max(0, peek.data.newCount));
  }, [valid, denied, resetProof, peek.data, peek.dataUpdatedAt, baseline]);
  return {
    count: denied || resetProof || !enabled ? 0 : count,
    denied,
    error: enabled && !denied ? peek.error : null,
    retry: () => peek.refetch(),
    acknowledge: (displayedCursor: SubmissionCursor) => {
      setCount(0);
      setBaseline(displayedCursor);
    },
  };
}
