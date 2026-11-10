import { useLayoutEffect, useRef } from "react";

/** Force a server read on every new observer; cached success is not mount proof. */
export const demandFreshReadOptions = {
  placeholderData: undefined,
  staleTime: 0,
  refetchOnMount: "always" as const,
};

type ReadState<T> = {
  data: T | undefined;
  error?: unknown;
  isError?: boolean;
  isPending?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
  isFetchedAfterMount?: boolean;
};

/**
 * Proof belongs to this mounted identity/record/page, not the QueryClient cache.
 * Once proven, keep the last server-verified snapshot during ordinary refetches.
 * A read failure or mismatched response immediately revokes it; never fall back
 * to an old success after an authorization failure.
 */
export function useDemandServerRead<T>(query: ReadState<T>, readKey: string, mismatched = false) {
  const proof = useRef<{ key: string; data: T | undefined }>({ key: readKey, data: undefined });
  if (proof.current.key !== readKey) proof.current = { key: readKey, data: undefined };
  const failed = Boolean(query.error || query.isError || mismatched);
  if (failed) proof.current.data = undefined;
  else if (query.data !== undefined && query.isFetchedAfterMount === true &&
    !query.isFetching && !query.isPending && !query.isLoading && !query.isPlaceholderData) {
    proof.current.data = query.data;
  }
  const data = failed ? undefined : proof.current.data;
  return { data, failed, waiting: !failed && data === undefined };
}

/** Captured receipts cannot revive after A → B → A, capability loss, or unmount. */
export function useDemandReceiptGuard(identityKey: string, writable: boolean) {
  const state = useRef({ identityKey, writable, mounted: true, generation: 0 });
  if (state.current.identityKey !== identityKey || state.current.writable !== writable) {
    state.current = { ...state.current, identityKey, writable, generation: state.current.generation + 1 };
  }
  useLayoutEffect(() => {
    state.current.mounted = true;
    return () => { state.current.mounted = false; state.current.generation += 1; };
  }, []);
  const capture = () => {
    const generation = state.current.generation;
    return () => state.current.mounted && state.current.writable && state.current.generation === generation;
  };
  return { capture, isCurrent: () => state.current.mounted && state.current.writable };
}
