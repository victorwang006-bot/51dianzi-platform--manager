import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useSyncExternalStore } from "react";
import { trpc as adminTrpc } from "../lib/trpc";
import { CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT } from "./BusinessScope";
import { AUTH_SESSION_CLEARED_EVENT } from "./platform/client/src/lib/authSessionEvents";

/** A short UI lease, never a server authorization or a persisted login. */
export const BUSINESS_CONTEXT_FRESH_MS = 30_000;
export const BUSINESS_FOCUS_DEBOUNCE_MS = 1_000;
const authKey = getQueryKey(adminTrpc.auth.me, undefined, "query");

/** AbortSignal.any-compatible composition with explicit request-lifetime cleanup. */
export function createBusinessRequestCancellation(
  domainAbort: AbortController,
  upstreamSignal?: AbortSignal | null
) {
  if (!upstreamSignal || upstreamSignal === domainAbort.signal)
    return { controller: domainAbort, cleanup: () => {} };
  const controller = new AbortController();
  const signals = [domainAbort.signal, upstreamSignal];
  const cleanup = () => {
    signals.forEach(signal => signal.removeEventListener("abort", onAbort));
  };
  const onAbort = () => {
    controller.abort(signals.find(signal => signal.aborted)?.reason);
    cleanup();
  };
  if (signals.some(signal => signal.aborted)) onAbort();
  else
    signals.forEach(signal =>
      signal.addEventListener("abort", onAbort, { once: true })
    );
  return { controller, cleanup };
}

export function isBusinessAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } })
    .data;
  return (
    data?.code === "UNAUTHORIZED" ||
    data?.code === "FORBIDDEN" ||
    data?.httpStatus === 401 ||
    data?.httpStatus === 403
  );
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
}

function discard(client: QueryClient) {
  void client.cancelQueries();
  client.clear();
}

export class BusinessWorkbenchSession {
  readonly discovery = newQueryClient();
  readonly context = newQueryClient();
  authorization: string | null = null;
  denied = false;
  private domain: {
    key: string;
    client: QueryClient;
    abort: AbortController;
  } | null = null;

  constructor(
    readonly adminAccountId: number,
    private notify: () => void
  ) {}

  domainResources(key: string) {
    if (this.domain?.key !== key) {
      this.clearDomain();
      const client = newQueryClient();
      const revokeOnError = (error: unknown) => {
        if (
          this.domain?.client === client &&
          !this.denied &&
          isBusinessAuthorizationError(error)
        )
          this.revoke();
      };
      client.getQueryCache().subscribe(event => {
        if (event.type === "updated" && event.action.type === "error")
          revokeOnError(event.query.state.error);
      });
      client.getMutationCache().subscribe(event => {
        if (event.type === "updated" && event.action.type === "error")
          revokeOnError(event.mutation.state.error);
      });
      this.domain = { key, client, abort: new AbortController() };
    }
    return this.domain!;
  }

  clearDomain() {
    const domain = this.domain;
    this.domain = null;
    if (domain) {
      domain.abort.abort();
      discard(domain.client);
    }
  }

  invalidateAuthorization(invalidateDrafts = true) {
    this.clearDomain();
    if (invalidateDrafts && this.authorization !== null)
      window.dispatchEvent(new Event(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT));
    // A transport failure closes the domain, but keeps the old fingerprint as
    // draft provenance only. A later different identity still must clear it.
    if (invalidateDrafts) this.authorization = null;
  }

  confirmAuthorization(key: string) {
    if (this.authorization !== null && this.authorization !== key) {
      if (this.domain?.key !== key) this.clearDomain();
      window.dispatchEvent(new Event(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT));
    }
    this.authorization = key;
  }

  revoke() {
    this.denied = true;
    this.invalidateAuthorization();
    discard(this.context);
    discard(this.discovery);
    this.notify();
  }

  dispose() {
    this.invalidateAuthorization();
    discard(this.context);
    discard(this.discovery);
  }
}

type Snapshot = { session: BusinessWorkbenchSession | null };
const stores = new WeakMap<QueryClient, ReturnType<typeof createStore>>();
const disposers = new Set<() => void>();

function createStore(root: QueryClient) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { session: null };
  // A clear event must not re-authorize from the old auth.me cache. Only a new
  // successful auth result may establish a new session, including the same ID.
  let awaitingFreshAuth = false;
  const notify = () => {
    snapshot = { session: snapshot.session };
    listeners.forEach(listener => listener());
  };
  const read = () => {
    const state = root.getQueryState<{ id?: unknown } | null>(authKey);
    const id = Number(state?.data?.id);
    const confirmed =
      state?.status === "success" &&
      !awaitingFreshAuth &&
      Number.isSafeInteger(id) &&
      id > 0
        ? id
        : null;
    if (snapshot.session?.adminAccountId === confirmed) return;
    snapshot.session?.dispose();
    snapshot = {
      session:
        confirmed === null
          ? null
          : new BusinessWorkbenchSession(confirmed, notify),
    };
    listeners.forEach(listener => listener());
  };
  const unsubscribe = root.getQueryCache().subscribe(event => {
    // Subscribe beyond workbench unmount: account changes/logout elsewhere must
    // cancel and clear retained business data before a later route can reuse it.
    if (event.query.queryHash !== JSON.stringify(authKey)) return;
    if (event.type === "updated" && event.action.type === "success")
      awaitingFreshAuth = false;
    read();
  });
  const clear = () => {
    awaitingFreshAuth = true;
    snapshot.session?.dispose();
    snapshot = { session: null };
    listeners.forEach(listener => listener());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === "51dianzi:auth-session-cleared:v1" && event.newValue)
      clear();
  };
  window.addEventListener(AUTH_SESSION_CLEARED_EVENT, clear);
  window.addEventListener("storage", onStorage);
  read();
  const dispose = () => {
    unsubscribe();
    window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, clear);
    window.removeEventListener("storage", onStorage);
    snapshot.session?.dispose();
    stores.delete(root);
    disposers.delete(dispose);
  };
  disposers.add(dispose);
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    retry: () => {
      const id = snapshot.session?.adminAccountId;
      snapshot.session?.dispose();
      snapshot = {
        session: id ? new BusinessWorkbenchSession(id, notify) : null,
      };
      listeners.forEach(listener => listener());
    },
    dispose,
  };
}

/** Reads only live auth.me query state, never localStorage/sessionStorage JSON. */
export function useBusinessWorkbenchSession() {
  const root = useQueryClient();
  let store = stores.get(root);
  if (!store) {
    store = createStore(root);
    stores.set(root, store);
  }
  const { session } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return { session, retrySession: store.retry };
}

export function resetBusinessWorkbenchSessionsForTests() {
  Array.from(disposers).forEach(dispose => dispose());
}
