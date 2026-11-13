import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useSyncExternalStore } from "react";
import { trpc as adminTrpc } from "../lib/trpc";
import { CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT } from "./BusinessScope";
import { AUTH_SESSION_CLEARED_EVENT } from "./platform/client/src/lib/authSessionEvents";

/** Verified once per authenticated identity in memory, never server authority
 * or a persisted login. Identity changes and explicit refusals discard it. */
export const BUSINESS_CONTEXT_STALE_TIME = Infinity;
const BUSINESS_RESTORE_DEBOUNCE_MS = 1_000;
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

export type BusinessFailure =
  | "session-invalid"
  | "resource-denied"
  | "security-unclassified"
  | "other";
/** Only server-owned closed markers classify a refusal. Never infer scope from
 * a message or procedure name. Unknown 403 stays fail-closed, not confirmed revoked. */
export function classifyBusinessFailure(error: unknown): BusinessFailure {
  if (!error || typeof error !== "object") return "other";
  const data = (
    error as {
      data?: {
        code?: unknown;
        httpStatus?: unknown;
        businessFailure?: unknown;
      };
    }
  ).data;
  if (
    data?.businessFailure === "AUTH_SESSION_INVALID" ||
    data?.businessFailure === "STAFF_BINDING_INVALID" ||
    data?.businessFailure === "TENANT_ACCESS_REVOKED" ||
    data?.code === "UNAUTHORIZED" ||
    data?.httpStatus === 401
  )
    return "session-invalid";
  if (data?.businessFailure === "BUSINESS_RESOURCE_FORBIDDEN")
    return "resource-denied";
  if (data?.code === "FORBIDDEN" || data?.httpStatus === 403)
    return "security-unclassified";
  return "other";
}
export function isBusinessAuthorizationError(error: unknown): boolean {
  return classifyBusinessFailure(error) === "session-invalid";
}
export function isBusinessSecurityError(error: unknown): boolean {
  const failure = classifyBusinessFailure(error);
  return failure === "session-invalid" || failure === "security-unclassified";
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

const businessQueryClientConsumers = new WeakMap<QueryClient, number>();
/** Navigation and content share the exact authorized cache. Ordinary unmount
 * cancels reads only when the final consumer leaves; revocation/dispose above
 * still abort and clear immediately, irrespective of this reference count. */
export function retainBusinessQueryClient(client: QueryClient): () => void {
  businessQueryClientConsumers.set(client, (businessQueryClientConsumers.get(client) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, (businessQueryClientConsumers.get(client) ?? 1) - 1);
    if (remaining) businessQueryClientConsumers.set(client, remaining);
    else {
      businessQueryClientConsumers.delete(client);
      void client.cancelQueries();
    }
  };
}

export class BusinessWorkbenchSession {
  readonly discovery = newQueryClient();
  readonly context = newQueryClient();
  authorization: string | null = null;
  denied = false;
  denialKind: "session-invalid" | "security-unclassified" | null = null;
  private lastRestore = -Infinity;
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
        if (this.domain?.client === client && !this.denied)
          this.onAuthorizationError(error);
      };
      client.getQueryCache().subscribe(event => {
        if (event.type === "updated" && event.action.type === "error") {
          // React Query retains old successful data after a refetch refusal.
          // Clear that one resource, not the other pages or their drafts.
          if (
            classifyBusinessFailure(event.query.state.error) ===
            "resource-denied"
          )
            event.query.setState({ data: undefined });
          revokeOnError(event.query.state.error);
        }
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

  /** Capture both revision and domain generation. Even A -> B -> A must not
   * let an old request's error revoke the newly established A domain. */
  authorizationErrorReporter(key: string) {
    const domain = this.domain;
    return (error: unknown) => {
      if (domain && this.domain === domain && this.authorization === key)
        this.onAuthorizationError(error);
    };
  }

  /** Direct tRPC reads do not pass through QueryCache; use this same handler. */
  readonly onAuthorizationError = (error: unknown) => {
    const failure = classifyBusinessFailure(error);
    if (failure === "session-invalid" || failure === "security-unclassified")
      this.revoke(failure);
  };

  /** BFCache restore is a security re-entry, not an ordinary window focus. */
  revalidateAfterRestore() {
    if (this.denied) return;
    const now = Date.now();
    if (now - this.lastRestore < BUSINESS_RESTORE_DEBOUNCE_MS) return;
    this.lastRestore = now;
    // One trigger fans out to two distinct proof procedures; join an already
    // running query instead of aborting and restarting it.
    for (const client of [this.discovery, this.context])
      void client.refetchQueries({ type: "active" }, { cancelRefetch: false });
  }

  revoke(
    kind: "session-invalid" | "security-unclassified" = "session-invalid"
  ) {
    if (this.denied) return;
    this.denied = true;
    this.denialKind = kind;
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
