import { useQuery, type QueryKey } from "@tanstack/react-query";

/** A query result is valid only for the session and selection that started it. */
export function useProfileBusinessQuery<T>({ queryKey, enabled, isCurrent, read }: {
  queryKey: QueryKey;
  enabled: boolean;
  isCurrent(): boolean;
  read(signal: AbortSignal): Promise<T>;
}) {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (signal.aborted || !isCurrent()) throw new Error("查询范围已变化，请重新加载");
      const result = await read(signal);
      // Some transports cannot abort work already delegated to another service.
      // Never admit that late result into the current subject/selection's cache.
      if (signal.aborted || !isCurrent()) throw new Error("查询范围已变化，请重新加载");
      return result;
    },
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    placeholderData: undefined,
    refetchOnWindowFocus: false,
  });
}
