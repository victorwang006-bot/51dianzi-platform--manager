import { useAuth } from "@/_core/hooks/useAuth";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import {
  flushPagePosition, pageMemoryContext, pageMemoryEpoch, pageMemoryScope,
  readPageSlot, restorePagePosition, returnToPageSource, setPageMemoryScope,
  sourcePageEntry, subscribePageMemory, writePageSlot,
} from "@/lib/adminPageMemory";

export function adminScope(auth: { user?: any; loading?: boolean; isAuthenticated?: boolean; error?: unknown }): string | null {
  const user = auth.user, id = Number(user?.id);
  if (auth.loading || auth.error || !auth.isAuthenticated || !Number.isSafeInteger(id) || id <= 0 || typeof user.adminRole !== "string" || !user.adminRole) return null;
  const permissions = Array.isArray(user.permissions) ? [...user.permissions].filter(x => typeof x === "string").sort() : [];
  return `admin:${id}:role:${user.adminRole}:permissions:${JSON.stringify(permissions)}`;
}
export function useAdminPageMemory() {
  const auth = useAuth();
  useSyncExternalStore(subscribePageMemory, pageMemoryEpoch, () => 0);
  const identity = adminScope(auth);
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
export function useAdminRememberedState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef<{value: T} | null>(null);
  if (!fallback.current) {
    const value = typeof initial === "function" ? (initial as () => T)() : initial;
    fallback.current = { value: name === "searchInput" ? urlValue("search", value) : value };
  }
  const context = pageMemoryContext();
  const [box, setBox] = useState(() => ({ context, value: readPageSlot(name, fallback.current!.value) }));
  const latest = useRef(box);
  if (box.context !== context) {
    latest.current = { context, value: readPageSlot(name, fallback.current.value) };
    setBox(latest.current);
  } else latest.current = box;
  const setter = useCallback<Dispatch<SetStateAction<T>>>(update => {
    if (latest.current.context !== pageMemoryContext()) return;
    const value = typeof update === "function" ? (update as (old: T) => T)(latest.current.value) : update;
    latest.current = { context: latest.current.context, value };
    writePageSlot(name, value); setBox(latest.current);
  }, [name]);
  return [latest.current.value, setter];
}
function urlValue<T>(name: string, fallback: T): T {
  const p = new URLSearchParams(window.location.search);
  if (name === "page" || name === "pageSize") {
    const n = p.get(name);
    if (n && /^\d{1,7}$/.test(n) && Number(n) > 0 && (name !== "pageSize" || [20, 50, 100].includes(Number(n)))) return Number(n) as T;
  }
  if (name === "search" && p.has("search")) return p.get("search")!.slice(0, 200) as T;
  if (name === "salesOwnerFilter" && p.has("salesOwnerCode")) return p.get("salesOwnerCode")!.slice(0, 100) as T;
  if (name === "createdAtFilter" && p.has("createdAtPreset")) {
    const preset = p.get("createdAtPreset")!;
    const valid = ["all", "today", "last7Days", "last30Days", "thisMonth", "custom"];
    if (valid.includes(preset)) return { preset, ...(preset === "custom" ? { from: p.get("createdFrom") ?? "", to: p.get("createdTo") ?? "" } : {}) } as T;
  }
  return fallback;
}
export function useAdminUrlState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [remembered, setRemembered] = useAdminRememberedState(name, urlValue(name, initial));
  const context = pageMemoryContext();
  const seen = useRef("");
  // URL is authoritative for shared links, refresh and browser back/forward.
  useEffect(() => {
    if (seen.current === context || !pageMemoryScope() || window.location.pathname.replace(/\/$/, "") !== "/merchants") return;
    seen.current = context;
    setRemembered(urlValue(name, remembered));
  }, [context, name]);
  const setter = useCallback<Dispatch<SetStateAction<T>>>(update => {
    if (!pageMemoryScope() || !/^\/merchants\/?$/.test(window.location.pathname)) return;
    const value = typeof update === "function" ? (update as (v: T) => T)(remembered) : update;
    setRemembered(value);
    const p = new URLSearchParams(window.location.search);
    const put = (key: string, v: unknown, empty: unknown) => { if (v === empty || v === undefined || v === null || v === "") p.delete(key); else p.set(key, String(v)); };
    if (name === "page") put("page", value, 1);
    if (name === "pageSize") put("pageSize", value, 20);
    if (name === "search") put("search", value, "");
    if (name === "salesOwnerFilter") put("salesOwnerCode", value, "all");
    if (name === "createdAtFilter") {
      const f = value as { preset: string; from?: string; to?: string };
      put("createdAtPreset", f.preset, "all");
      put("createdFrom", f.preset === "custom" ? f.from : "", "");
      put("createdTo", f.preset === "custom" ? f.to : "", "");
    }
    const next = window.location.pathname + (p.size ? "?" + p.toString() : "") + window.location.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) history.replaceState(history.state, "", next);
  }, [name, remembered, setRemembered]);
  return [remembered, setter];
}

type ListQuery = { data?: unknown; dataUpdatedAt?: number; isFetching?: boolean; isLoading?: boolean; isPending?: boolean; isError?: boolean; isFetchedAfterMount?: boolean };
export function freshAdminListOptions<T extends object>(options: T, ready: boolean) {
  return { ...options, enabled: ready && (options as { enabled?: boolean }).enabled !== false, staleTime: 0, refetchOnMount: "always" as const };
}
export function useAdminRestoringQuery<T extends ListQuery>(query: T): T {
  const context = pageMemoryContext();
  useEffect(() => {
    if (!pageMemoryScope() || query.data === undefined || query.isFetching || query.isLoading || query.isPending || query.isError || query.isFetchedAfterMount === false) return;
    return restorePagePosition();
  }, [context, query.dataUpdatedAt, query.isFetching, query.isLoading, query.isPending, query.isError, query.isFetchedAfterMount]);
  return query;
}
export function useAdminPageBounds(page: number, pageSize: number, query: any, setPage: (p: number) => void) {
  useEffect(() => {
    if (!query.data || query.isFetching || query.isLoading || query.isError || query.isFetchedAfterMount === false) return;
    const last = Math.max(1, Math.ceil(query.data.total / pageSize));
    if (page > last) setPage(last);
  }, [page, pageSize, query.data?.total, query.isFetching, query.isLoading, query.isError, query.isFetchedAfterMount]);
}
export { returnToPageSource, sourcePageEntry };

export function useAdminBoundQuery<T extends ListQuery>(query: T, page: number, pageSize: number, setPage: (p: number) => void): T {
  useAdminPageBounds(page, pageSize, query, setPage);
  return useAdminRestoringQuery(query);
}
