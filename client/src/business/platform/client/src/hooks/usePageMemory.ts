import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { usePageIdentity } from "./usePageIdentity";
import {
  flushPagePosition, pageMemoryContext, pageMemoryEpoch, pageMemoryScope,
  readPageSlot, restorePagePosition, returnToPageSource, setPageMemoryScope,
  subscribePageMemory, writePageSlot,
} from "../lib/pageMemory";

export function usePageMemory(): boolean {
  const identity = usePageIdentity();
  useSyncExternalStore(subscribePageMemory, pageMemoryEpoch, () => 0);
  setPageMemoryScope(identity);
  const context = pageMemoryContext();
  useEffect(() => {
    let frame = 0;
    const save = () => {
      if (context !== pageMemoryContext()) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (context === pageMemoryContext()) flushPagePosition(); });
    };
    window.addEventListener("scroll", save, { capture: true, passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", save, true); };
  }, [context]);
  return identity !== null;
}

export function useRememberedState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef<{ value: T } | null>(null);
  if (!fallback.current) fallback.current = { value: typeof initial === "function" ? (initial as () => T)() : initial };
  const context = pageMemoryContext();
  const [box, setBox] = useState(() => ({ context, value: readPageSlot(name, fallback.current!.value) }));
  const latest = useRef(box);
  if (box.context !== context) {
    const next = { context, value: readPageSlot(name, fallback.current.value) };
    latest.current = next;
    setBox(next);
  } else latest.current = box;
  const setter = useCallback<Dispatch<SetStateAction<T>>>(update => {
    const previous = latest.current;
    if (previous.context !== pageMemoryContext()) return;
    const value = typeof update === "function" ? (update as (old: T) => T)(previous.value) : update;
    latest.current = { context: previous.context, value };
    writePageSlot(name, value);
    setBox(latest.current);
  }, [name]);
  return [latest.current.value, setter];
}

export function freshListOptions<T extends object>(options: T, ready: boolean) {
  const enabled = (options as { enabled?: boolean }).enabled;
  return { ...options, enabled: ready && enabled !== false, staleTime: 0, refetchOnMount: "always" as const };
}

export type ListQuery = {
  data?: unknown; dataUpdatedAt?: number; isFetching?: boolean;
  isPending?: boolean; isLoading?: boolean; isError?: boolean; isFetchedAfterMount?: boolean;
};
/** active must prove the query's current authorized data is actually rendered. */
export function useListPositionRestore(query: ListQuery, active = true) {
  const context = pageMemoryContext();
  const restored = useRef("");
  useEffect(() => {
    if (!active || !pageMemoryScope() || restored.current === context || query.data === undefined || query.isFetching || query.isLoading || query.isPending || query.isError || query.isFetchedAfterMount === false) return;
    // Completion, not starting a frame, consumes the pending restore. If fresh
    // data becomes pending mid-layout, cleanup cancels but leaves it retryable.
    return restorePagePosition(() => { if (context === pageMemoryContext()) restored.current = context; });
  }, [active, context, query.dataUpdatedAt, query.isFetching, query.isLoading, query.isPending, query.isError, query.isFetchedAfterMount, query.data]);
}

export function useRestoringListQuery<T extends ListQuery>(query: T, active = true): T {
  useListPositionRestore(query, active);
  return query;
}

export function useSourceReturn(navigate: (url: string, options?: { replace?: boolean }) => void, fallback: string) {
  return useCallback(() => returnToPageSource(navigate, fallback), [navigate, fallback]);
}
export { returnToPageSource };
