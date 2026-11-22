import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  CancelledError,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ADMIN_NEW_INFORMATION_MODULES,
  ADMIN_NEW_INFORMATION_REFRESH_MS,
} from "@shared/adminNewInformationConstants";
import type {
  AdminNewInformationInspection,
  AdminNewInformationModule,
  AdminNewInformationSummary,
  AdminNewInformationModuleSummary,
} from "@shared/adminNewInformation";

export type AdminNewInformationAccountKey = string | number | null | undefined;
export type AdminNewInformationRequestOptions = { signal?: AbortSignal };
/** Inject the ORIGINAL admin tRPC client, not the front/business chat client.
 * Example: summary: options => rpc.newInformation.summary.query(undefined, options).
 * markDisplayed MUST reject a rejected/invalid receipt (never silently resolve it).
 */
export interface AdminNewInformationClient {
  summary(
    options?: AdminNewInformationRequestOptions
  ): Promise<AdminNewInformationSummary>;
  inspect(
    input: {
      module: AdminNewInformationModule;
      refs: string[];
      scope?: string;
    },
    options?: AdminNewInformationRequestOptions
  ): Promise<AdminNewInformationInspection>;
  markDisplayed(
    input: { receipts: string[] },
    options?: AdminNewInformationRequestOptions
  ): Promise<unknown>;
  /** Optional capability; absence is unavailable, NEVER an empty unread set. */
  unreadRefs?(
    input: { module: "customers"; scope?: string },
    options?: AdminNewInformationRequestOptions
  ): Promise<{ refs: string[]; available: true }>;
}
export interface AdminNewInformationAccess {
  accountKey: AdminNewInformationAccountKey;
  canRead: boolean;
}
export interface AdminNewInformationRowsOptions
  extends AdminNewInformationAccess {
  module: AdminNewInformationModule;
  /** Canonical SERVER source IDs, not presentation keys or locally invented versions. */
  refs: readonly string[];
  /** Use one identical server-defined scope in every presentation of a source. */
  scope?: string;
  /** Required: original list query.isSuccess && !query.isError && !query.isFetching.
   * Never supply IDs from pending/error/placeholder data. Existing list actions stay unchanged.
   */
  listReady: boolean;
  /** Default true for legacy modules; customer lists only inspect. */
  acknowledgeOnVisible?: boolean;
  /** Default true for legacy lists; detail removes its marker on native acceptance. */
  retainUnreadWhileVisible?: boolean;
  /** Business binding must match the ORIGINAL admin provider, never a front actor. */
  expectedAccountKey?: AdminNewInformationAccountKey;
}
function accountToken(account: AdminNewInformationAccountKey): string | null {
  return account === null || account === undefined || account === ""
    ? null
    : `${typeof account}:${account}`;
}
export const adminNewInformationKeys = {
  root: ["adminNewInformation"] as const,
  account: (account: AdminNewInformationAccountKey) =>
    ["adminNewInformation", accountToken(account)] as const,
  summary: (account: AdminNewInformationAccountKey) =>
    [...adminNewInformationKeys.account(account), "summary"] as const,
  rows: (
    account: AdminNewInformationAccountKey,
    module: AdminNewInformationModule,
    scope?: string
  ) =>
    [
      ...adminNewInformationKeys.account(account),
      "inspect",
      module,
      scope || "",
    ] as const,
  unreadRefs: (account: AdminNewInformationAccountKey, module: "customers", scope?: string) =>
    [...adminNewInformationKeys.account(account), "unreadRefs", module, scope || ""] as const,
  inspect: (
    account: AdminNewInformationAccountKey,
    module: AdminNewInformationModule,
    refs: readonly string[],
    scope?: string
  ) =>
    [
      ...adminNewInformationKeys.rows(account, module, scope),
      normalizeAdminNewInformationRefs(refs),
    ] as const,
};
export function normalizeAdminNewInformationRefs(
  refs: readonly string[]
): string[] {
  if (refs.some(id => !id || id.length > 180))
    throw new Error("新信息引用必须为服务器提供的 1–180 字符 ID");
  return Array.from(new Set(refs)).sort();
}
/** Presentation IDs can differ; server source id + version + scope remain the dedup key. */
export function adminNewInformationRefKey(
  module: AdminNewInformationModule,
  id: string,
  version: string,
  scope?: string
): string {
  return JSON.stringify([module, scope || "", id, version]);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function authorizationError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const data = isRecord(error.data) ? error.data : error;
  return (
    data.code === "FORBIDDEN" ||
    data.code === "UNAUTHORIZED" ||
    data.httpStatus === 401 ||
    data.httpStatus === 403
  );
}
function rejectedMark(value: unknown, expectedAccepted: number): boolean {
  // Positive native contract only. marked counts expanded facts (possibly 0 or
  // greater than input length); accepted proves ALL deduplicated row receipts.
  return !(
    isRecord(value) &&
    Number.isSafeInteger(value.marked) &&
    (value.marked as number) >= 0 &&
    Number.isSafeInteger(value.accepted) &&
    value.accepted === expectedAccepted
  );
}

// Shared ONLY with the existing React Query singleton; no additional provider/client/store.
type EventRecord = {
  state: "pending" | "seen" | "failed";
  error?: unknown;
  controller?: AbortController;
};
type Runtime = {
  events: Map<string, Map<string, EventRecord>>;
  subscribers: Set<() => void>;
  invalidations: Map<string, number>;
  summaryRequests: Map<string, number>;
  summaryCompleted: Map<string, number>;
  summarySubscribers: Set<() => void>;
};
const runtimes = new WeakMap<QueryClient, Runtime>();
function runtimeFor(client: QueryClient): Runtime {
  let runtime = runtimes.get(client);
  if (!runtime) {
    runtime = { events: new Map(), subscribers: new Set(), invalidations: new Map(), summaryRequests: new Map(), summaryCompleted: new Map(), summarySubscribers: new Set() };
    runtimes.set(client, runtime);
  }
  return runtime;
}
function eventsFor(runtime: Runtime, token: string): Map<string, EventRecord> {
  let events = runtime.events.get(token);
  if (!events) {
    events = new Map();
    runtime.events.set(token, events);
  }
  return events;
}
function notify(runtime: Runtime) {
  runtime.subscribers.forEach(callback => callback());
  runtime.summarySubscribers.forEach(callback => callback());
}
function purgeEvents(
  runtime: Runtime,
  token: string,
  module?: AdminNewInformationModule
) {
  const events = runtime.events.get(token);
  if (!events) return;
  for (const [key, event] of Array.from(events)) {
    if (!module || (JSON.parse(key) as unknown[])[0] === module) {
      event.controller?.abort();
      events.delete(key);
    }
  }
  if (!events.size) runtime.events.delete(token);
  notify(runtime);
}

/** Explicit same-page notification boundaries, not a merged business QueryClient.
 * Only mounted, currently permitted account/module/scope registrations participate.
 * BroadcastChannel supplements this registry across tabs; it is not the local bus. */
const CHANNEL = "51dianzi-admin-new-information-v1";
type NotificationBoundary = {
  client: QueryClient;
  token: string;
  module?: AdminNewInformationModule;
  scope?: string;
  valid: () => boolean;
};
const notificationBoundaries = new Set<NotificationBoundary>();
let tabChannel: BroadcastChannel | undefined;
const invalidationKey = (token: string, module?: AdminNewInformationModule, scope?: string) =>
  JSON.stringify([token, module ?? "summary", scope || ""]);
function refreshDisplayed(token: string, module?: AdminNewInformationModule, scope?: string) {
  const targets = new Map<QueryClient, NotificationBoundary[]>();
  for (const boundary of Array.from(notificationBoundaries)) {
    if (boundary.token !== token || !boundary.valid() ||
        (module && boundary.module && (boundary.module !== module || (boundary.scope || "") !== (scope || "")))) continue;
    const list = targets.get(boundary.client) ?? [];
    list.push(boundary);
    targets.set(boundary.client, list);
  }
  for (const [client, boundaries] of Array.from(targets)) {
    const runtime = runtimeFor(client);
    for (const key of Array.from(new Set(boundaries.map(boundary => invalidationKey(token, boundary.module, boundary.scope)))))
      runtime.invalidations.set(key, (runtime.invalidations.get(key) ?? 0) + 1);
    notify(runtime);
    const predicate = (query: { queryKey: readonly unknown[] }) => boundaries.some(boundary =>
      boundary.valid() && (boundary.module === undefined
        ? query.queryKey[2] === "summary"
        : (query.queryKey[2] === "inspect" || query.queryKey[2] === "unreadRefs") &&
          query.queryKey[3] === boundary.module && query.queryKey[4] === (boundary.scope || "")));
    const filter = { queryKey: ["adminNewInformation", token], predicate };
    // Invalidate alone does not cancel an initial in-flight fetch with no data.
    // Advance the epoch synchronously, then cancel before starting a fresh read.
    void client.cancelQueries(filter).then(() => {
      if (boundaries.some(boundary => boundary.valid())) return client.invalidateQueries(filter);
    }).catch(() => { /* Accepted receipts remain accepted; query status exposes read failures. */ });
  }
}
function useNotificationRegistration(boundary: Omit<NotificationBoundary, "token"> & { token: string | null }) {
  useEffect(() => {
    if (!boundary.token || !boundary.valid()) return;
    const registration = { ...boundary, token: boundary.token };
    notificationBoundaries.add(registration);
    if (!tabChannel && typeof window !== "undefined" && typeof window.BroadcastChannel === "function") {
      try {
        tabChannel = new window.BroadcastChannel(CHANNEL);
        tabChannel.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (isRecord(message) && message.type === "displayed" && typeof message.account === "string" &&
              (message.module === undefined || ADMIN_NEW_INFORMATION_MODULES.includes(message.module as AdminNewInformationModule)) &&
              (message.scope === undefined || typeof message.scope === "string")) {
            // Never echo a received invalidation, and never revive an old identity.
            refreshDisplayed(message.account, message.module as AdminNewInformationModule | undefined, message.scope as string | undefined);
          }
        };
      } catch { /* Local registrations still synchronize without broadcasting. */ }
    }
    return () => {
      notificationBoundaries.delete(registration);
      if (!notificationBoundaries.size) { tabChannel?.close(); tabChannel = undefined; }
    };
  }, [boundary.client, boundary.token, boundary.module, boundary.scope, boundary.valid]);
}
function invalidateDisplayed(token: string, module: AdminNewInformationModule, scope?: string) {
  refreshDisplayed(token, module, scope);
  try { tabChannel?.postMessage({ type: "displayed", account: token, module, scope }); }
  catch { /* Broadcasting cannot turn an accepted server mark into failure. */ }
}
export function useAdminNewInformationPageVisible(): boolean {
  const [visible, setVisible] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState !== "hidden"
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function useAccessBoundary(
  options: AdminNewInformationAccess,
  module?: AdminNewInformationModule,
  scope?: string
) {
  const queryClient = useQueryClient();
  const token = accountToken(options.accountKey);
  const allowed = token !== null && options.canRead;
  const identity = JSON.stringify([token, allowed, module, scope || ""]);
  const current = useRef({ identity, generation: 0, allowed });
  if (current.current.identity !== identity)
    current.current = {
      identity,
      generation: current.current.generation + 1,
      allowed,
    };
  const generation = current.current.generation;
  const [deniedGeneration, setDeniedGeneration] = useState<number | null>(null);
  const permitted = allowed && deniedGeneration !== generation;
  useEffect(() => {
    current.current.allowed = allowed && deniedGeneration !== generation;
    return () => {
      current.current.allowed = false;
    };
  }, [allowed, deniedGeneration, generation]);
  const prior = useRef<{ token: string | null; allowed: boolean }>({
    token: null,
    allowed: false,
  });
  useEffect(() => {
    const previous = prior.current;
    const purge = (target: string, onlyModule?: AdminNewInformationModule) => {
      const key = onlyModule
        ? ["adminNewInformation", target]
        : ["adminNewInformation", target];
      const predicate = onlyModule ? (query: { queryKey: readonly unknown[] }) => query.queryKey[3] === onlyModule : undefined;
      void queryClient.cancelQueries({ queryKey: key, predicate });
      queryClient.removeQueries({ queryKey: key, predicate });
      purgeEvents(runtimeFor(queryClient), target, onlyModule);
    };
    // A logout can unmount the entire layout rather than update the same hook.
    // Clean other accounts on remount too, not just on an in-place account change.
    const runtime = runtimeFor(queryClient);
    const cachedAccounts = queryClient
      .getQueryCache()
      .findAll({ queryKey: adminNewInformationKeys.root })
      .map(query => query.queryKey[1])
      .filter((value): value is string => typeof value === "string");
    for (const oldAccount of Array.from(
      new Set(cachedAccounts.concat(Array.from(runtime.events.keys())))
    )) {
      if (oldAccount !== token) purge(oldAccount);
    }
    if (previous.token && previous.token !== token) purge(previous.token);
    if (token && !permitted) purge(token, module);
    prior.current = { token, allowed: permitted };
  }, [queryClient, token, permitted, module]);
  const valid = useCallback(() => current.current.generation === generation &&
    current.current.allowed && deniedGeneration !== generation, [generation, deniedGeneration]);
  useNotificationRegistration({ client: queryClient, token, module, scope, valid });
  return {
    queryClient,
    token,
    permitted,
    generation,
    valid,
    deny: () => {
      if (current.current.generation === generation) {
        current.current.allowed = false;
        setDeniedGeneration(generation);
      }
    },
  };
}

export function useAdminNewInformationSummary(
  options: AdminNewInformationAccess & {
    client: AdminNewInformationClient;
    moduleCanRead?: Partial<Record<AdminNewInformationModule, boolean>>;
  }
) {
  const access = useAccessBoundary(options);
  const visible = useAdminNewInformationPageVisible();
  const runtime = runtimeFor(access.queryClient);
  const [, summaryRedraw] = useState(0);
  useEffect(() => {
    const redraw = () => summaryRedraw(value => value + 1);
    runtime.summarySubscribers.add(redraw);
    return () => { runtime.summarySubscribers.delete(redraw); };
  }, [runtime]);
  const query = useQuery({
    queryKey: adminNewInformationKeys.summary(options.accountKey),
    enabled: access.permitted && visible,
    queryFn: async ({ signal }) => {
      const token = access.token!;
      const key = invalidationKey(token);
      const epoch = runtime.invalidations.get(key) ?? 0;
      const sequence = (runtime.summaryRequests.get(token) ?? 0) + 1;
      runtime.summaryRequests.set(token, sequence);
      const data = await options.client.summary({ signal });
      if (signal.aborted || !access.valid() || epoch !== (runtime.invalidations.get(key) ?? 0) ||
          sequence !== runtime.summaryRequests.get(token))
        throw new CancelledError({ silent: true });
      runtime.summaryCompleted.set(key, epoch);
      return data;
    },
    retry: false,
    staleTime: 0,
    refetchInterval:
      access.permitted && visible ? ADMIN_NEW_INFORMATION_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const revoked = authorizationError(query.error);
  useEffect(() => {
    if (revoked) access.deny();
  }, [revoked, access.deny]);
  // Error without data is UNKNOWN, not a successfully confirmed zero.
  const summary = access.permitted && !revoked ? query.data : undefined;
  // In-memory, current-hook/account session only. Revocation invalidates the
  // proof until a NEW successful module read; a later temporary reply cannot
  // resurrect persisted counts from the previously revoked authority.
  const known = useRef({
    token: access.token,
    generation: access.generation,
    modules: {} as Partial<Record<AdminNewInformationModule, AdminNewInformationModuleSummary>>,
    verifiedAt: {} as Partial<Record<AdminNewInformationModule, number>>,
    blocked: new Set<AdminNewInformationModule>(),
    data: undefined as AdminNewInformationSummary | undefined,
    updatedAt: -1,
  });
  if (known.current.token !== access.token || known.current.generation !== access.generation) {
    known.current = {
      token: access.token, generation: access.generation, modules: {}, verifiedAt: {}, blocked: new Set(ADMIN_NEW_INFORMATION_MODULES), data: undefined, updatedAt: -1,
    };
  }
  const cache = known.current;
  if (!access.permitted || revoked) {
    cache.modules = {};
    cache.verifiedAt = {};
    cache.blocked = new Set(ADMIN_NEW_INFORMATION_MODULES);
    cache.data = query.data;
    cache.updatedAt = query.dataUpdatedAt;
  }
  const forget = (module: AdminNewInformationModule) => {
    delete cache.modules[module];
    delete cache.verifiedAt[module];
    cache.blocked.add(module);
  };
  const validCount = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  for (const module of ADMIN_NEW_INFORMATION_MODULES)
    if (options.moduleCanRead?.[module] === false) forget(module);
  if (summary && !query.isError &&
      (cache.data !== summary || cache.updatedAt !== query.dataUpdatedAt)) {
    cache.data = summary;
    cache.updatedAt = query.dataUpdatedAt;
    for (const module of ADMIN_NEW_INFORMATION_MODULES) {
      const item = summary.modules[module];
      if (options.moduleCanRead?.[module] === false || !item || item.reason === "denied" ||
          (!item.available && item.reason !== "temporary")) forget(module);
      else if (item.available && validCount(item.count)) {
        cache.modules[module] = { ...item, ...(item.children ? { children: { ...item.children } } : {}) };
        cache.verifiedAt[module] = query.dataUpdatedAt;
        cache.blocked.delete(module);
      } else if (item.reason === "temporary" && item.lastKnown === true && validCount(item.count) &&
          !cache.blocked.has(module)) {
        // This is the latest completed SERVER query in this boundary, not a
        // local decrement. A newer valid lastKnown replaces the older hook value.
        cache.modules[module] = { ...item, ...(item.children ? { children: { ...item.children } } : {}) };
        // The server supplied no timestamp for that historical value. Do not
        // attach our previous successful number's time to a replacement value.
        delete cache.verifiedAt[module];
      }
    }
  }
  const moduleSummary = (module: AdminNewInformationModule, canReadModule = true):
    AdminNewInformationModuleSummary | undefined => {
    if (!canReadModule || options.moduleCanRead?.[module] === false) {
      forget(module);
      return undefined;
    }
    const item = summary?.modules[module];
    if (!item || item.reason === "denied" || cache.blocked.has(module)) return undefined;
    if (item.available) return validCount(item.count) ? item : undefined;
    if (item.reason !== "temporary") return undefined;
    // Prefer this session's known successful number over an unknown count:0.
    const previous = cache.modules[module];
    return previous ? { ...previous, available: false, reason: "temporary", lastKnown: true } : undefined;
  };
  const isModuleLastKnown = (module: AdminNewInformationModule, canReadModule = true) => {
    const item = moduleSummary(module, canReadModule);
    return item !== undefined && (query.isError || item.lastKnown === true);
  };
  const syncState = (module: AdminNewInformationModule): "disabled" | "blocked" | "pending" | "failed" | "synced" => {
    if (!access.permitted || revoked || options.moduleCanRead?.[module] === false) return "disabled";
    const item = summary?.modules[module];
    // Keep an explicit source denial distinct from a transient read failure.
    // Only a fresh authorized snapshot may restore this module's proof.
    if (item?.reason === "denied") return "blocked";
    if (query.isFetching) return "pending";
    if (query.isError || (query.isSuccess && !item?.available)) return "failed";
    if (access.queryClient.getQueryState(adminNewInformationKeys.summary(options.accountKey))?.isInvalidated) return "pending";
    const key = invalidationKey(access.token!);
    if ((runtime.summaryCompleted.get(key) ?? -1) < (runtime.invalidations.get(key) ?? 0)) return "pending";
    return query.isSuccess && item?.available ? "synced" : "pending";
  };
  /** Presentation ONLY: ordinary fetch = polling/focus/manual read with a valid
   * successful module snapshot and no invalidation/new receipt epoch outstanding.
   * Never feed this into row/detail acknowledgement: syncState stays pending
   * throughout EVERY fetch. invalidateQueries and cross-QC/fresh-ack invalidations
   * remain genuinely pending until a fresh guarded summary completes. */
  const presentationState = (module: AdminNewInformationModule) => {
    const state = syncState(module);
    const key = access.token ? invalidationKey(access.token) : undefined;
    const invalidated = access.queryClient.getQueryState(adminNewInformationKeys.summary(options.accountKey))?.isInvalidated;
    const completed = key !== undefined && (runtime.summaryCompleted.get(key) ?? -1) >= (runtime.invalidations.get(key) ?? 0);
    return state === "pending" && query.isFetching && query.isSuccess && !query.isError &&
      !invalidated && completed && summary?.modules[module]?.available === true &&
      moduleSummary(module) !== undefined && !isModuleLastKnown(module)
      ? "refreshing" as const : state;
  };
  return {
    query,
    summary,
    moduleSummary,
    syncState,
    presentationState,
    moduleLastSuccessfulAt: (module: AdminNewInformationModule) =>
      moduleSummary(module) !== undefined ? cache.verifiedAt[module] : undefined,
    retrySummary: () => access.valid() && visible ? query.refetch({ cancelRefetch: true }) : Promise.resolve(undefined),
    isModuleLastKnown,
    lastKnown: ADMIN_NEW_INFORMATION_MODULES.some(module => isModuleLastKnown(module)),
    status:
      !access.permitted || revoked
        ? ("disabled" as const)
        : query.isError
          ? ("error" as const)
          : query.isSuccess
            ? ("success" as const)
            : ("pending" as const),
    count: (
      module: AdminNewInformationModule,
      canReadModule = true
    ): number | undefined => {
      return moduleSummary(module, canReadModule)?.count;
    },
  };
}

/** Conservative geometry check used WITH IntersectionObserver and as the fallback.
 * Includes scroll clipping, CSS/HTML hidden ancestors and hidden browser tabs.
 */
export function isAdminNewInformationRowVisible(element: HTMLElement): boolean {
  if (
    typeof document === "undefined" ||
    document.visibilityState === "hidden" ||
    !element.isConnected
  )
    return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(
    window.innerWidth || document.documentElement.clientWidth,
    rect.right
  );
  let bottom = Math.min(
    window.innerHeight || document.documentElement.clientHeight,
    rect.bottom
  );
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = window.getComputedStyle(node);
    if (
      node.hidden ||
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false;
    if (
      node !== element &&
      /hidden|clip|scroll|auto/.test(
        `${style.overflow} ${style.overflowX} ${style.overflowY}`
      )
    ) {
      const clip = node.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/.test(style.overflowX || style.overflow)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY || style.overflow)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
  }
  return right > left && bottom > top;
}

type RowBinding = {
  id: string;
  element: HTMLElement | null;
  intersecting: boolean;
  callback: RefCallback<HTMLElement>;
};
export interface AdminNewInformationRowPresentation {
  isNew: boolean;
  /** Attach to the ACTUAL existing row, not an invisible sentinel. */
  ref: RefCallback<HTMLElement>;
  markError: unknown;
  markState?: EventRecord["state"];
  verificationState: "blocked" | "checking" | "missing" | "failed" | "confirmed" | "pending" | "new";
}

export function useAdminNewInformationRows(
  options: AdminNewInformationRowsOptions & {
    client: AdminNewInformationClient;
  }
) {
  const access = useAccessBoundary(options, options.module, options.scope);
  const visible = useAdminNewInformationPageVisible();
  const normalizedRefs = normalizeAdminNewInformationRefs(options.refs);
  const refsKey = JSON.stringify(normalizedRefs);
  const scope = options.scope || undefined;
  const query = useQuery({
    queryKey: adminNewInformationKeys.inspect(
      options.accountKey,
      options.module,
      normalizedRefs,
      scope
    ),
    enabled:
      access.permitted &&
      visible &&
      options.listReady &&
      normalizedRefs.length > 0,
    queryFn: async ({ signal }) => {
      const readKey = invalidationKey(access.token!, options.module, scope);
      const epoch = runtimeFor(access.queryClient).invalidations.get(readKey) ?? 0;
      const items: AdminNewInformationInspection["items"] = [];
      // Large lists are inspected in schema-compliant batches. No truncation.
      for (let start = 0; start < normalizedRefs.length; start += 100) {
        const data = await options.client.inspect(
          {
            module: options.module,
            refs: normalizedRefs.slice(start, start + 100),
            scope,
          },
          { signal }
        );
        if (signal.aborted || !access.valid() || epoch !== (runtimeFor(access.queryClient).invalidations.get(readKey) ?? 0))
          throw new CancelledError({ silent: true });
        items.push(...data.items);
      }
      return { items };
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval:
      access.permitted && visible && options.listReady && normalizedRefs.length
        ? ADMIN_NEW_INFORMATION_REFRESH_MS
        : false,
    refetchIntervalInBackground: false,
  });
  const revoked = authorizationError(query.error);
  useEffect(() => {
    if (revoked) access.deny();
  }, [revoked, access.deny]);
  const runtime = runtimeFor(access.queryClient);
  const [, forceRender] = useState(0);
  const redraw = useCallback(() => forceRender(value => value + 1), []);
  useEffect(() => {
    runtime.subscribers.add(redraw);
    return () => {
      runtime.subscribers.delete(redraw);
      if (!runtime.subscribers.size) {
        // No rows remain to witness a queued/in-flight mark. Keep no pending
        // locks across a fresh page visit; the server owns durable read state.
        for (const token of Array.from(runtime.events.keys()))
          purgeEvents(runtime, token);
      }
    };
  }, [runtime, redraw]);
  const bindings = useRef(new Map<string, RowBinding>());
  const latched = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const scheduled = useRef<number | null>(null);
  const retrying = useRef(false);
  const ownedMarks = useRef(new Set<AbortController>());
  const items = new Map(
    query.data?.items
      .filter(item => normalizedRefs.includes(item.id))
      .map(item => [item.id, item])
  );
  const rowIdentity = JSON.stringify([
    access.token,
    options.module,
    scope,
    refsKey,
  ]);
  const identityRef = useRef(rowIdentity);
  if (identityRef.current !== rowIdentity) {
    latched.current.clear();
    identityRef.current = rowIdentity;
  }
  useEffect(() => () => {
    // This hook may unmount while another rows hook remains subscribed. Abort
    // only our queued/in-flight receipts, not the other page's legitimate work.
    const controllers = ownedMarks.current;
    controllers.forEach(controller => controller.abort());
    for (const events of Array.from(runtime.events.values()))
      for (const [key, event] of Array.from(events))
        if (event.controller && controllers.has(event.controller)) events.delete(key);
    controllers.clear();
    notify(runtime);
  }, [rowIdentity, runtime]);
  const priorScope = useRef({ token: access.token, module: options.module, scope });
  useEffect(() => {
    const previous = priorScope.current;
    if (previous.token && (previous.token !== access.token || previous.module !== options.module || previous.scope !== scope)) {
      const key = adminNewInformationKeys.rows(options.accountKey, previous.module, previous.scope);
      // Account-wide cleanup is owned by useAccessBoundary; scope swaps must
      // also forget inspection/seen evidence before returning to an old merchant.
      if (previous.token === access.token) {
        void access.queryClient.cancelQueries({ queryKey: key });
        access.queryClient.removeQueries({ queryKey: key });
      }
      const events = runtime.events.get(previous.token);
      for (const [key, event] of Array.from(events ?? [])) {
        const [module, eventScope] = JSON.parse(key) as string[];
        if (module === previous.module && eventScope === (previous.scope || "")) {
          event.controller?.abort(); events?.delete(key);
        }
      }
      notify(runtime);
    }
    priorScope.current = { token: access.token, module: options.module, scope };
  }, [access.token, options.accountKey, options.module, scope, runtime, access.queryClient]);
  const latest = useRef({
    access,
    options,
    query,
    items,
    revoked,
    scope,
    rowIdentity,
  });
  latest.current = {
    access,
    options,
    query,
    items,
    revoked,
    scope,
    rowIdentity,
  };

  const refresh = useCallback(() => {
    const state = latest.current;
    if (!state.access.token) return;
    const events = eventsFor(runtime, state.access.token);
    const visibleIds = new Set<string>();
    for (const binding of Array.from(bindings.current.values())) {
      if (
        binding.element &&
        (typeof window.IntersectionObserver !== "function" ||
          binding.intersecting) &&
        isAdminNewInformationRowVisible(binding.element)
      )
        visibleIds.add(binding.id);
    }
    let changed = false;
    for (const key of Array.from(latched.current)) {
      const sourceId = (JSON.parse(key) as string[])[2];
      if (!visibleIds.has(sourceId) && events.get(key)?.state === "seen") {
        latched.current.delete(key);
        changed = true;
      }
    }
    if (changed) redraw();
    if (
      !state.access.permitted ||
      !state.access.valid() ||
      state.revoked ||
      !state.options.listReady ||
      !state.query.isSuccess ||
      state.query.isFetching ||
      state.query.isError ||
      state.options.acknowledgeOnVisible === false ||
      retrying.current ||
      document.visibilityState === "hidden"
    )
      return;
    const pending: Array<{ key: string; receipt: string }> = [];
    for (const id of Array.from(visibleIds)) {
      const item = state.items.get(id);
      if (!item?.isNew || !item.receipt) continue;
      const key = adminNewInformationRefKey(
        state.options.module,
        item.id,
        item.version,
        state.scope
      );
      if (events.has(key)) continue; // Seen, pending AND failed events never auto-retry.
      pending.push({ key, receipt: item.receipt });
      latched.current.add(key);
    }
    for (let start = 0; start < pending.length; start += 100) {
      const batch = pending.slice(start, start + 100);
      const receipts = Array.from(new Set(batch.map(item => item.receipt)));
      const controller = new AbortController();
      ownedMarks.current.add(controller);
      batch.forEach(item =>
        events.set(item.key, { state: "pending", controller })
      );
      notify(runtime);
      // Promise.resolve also catches a synchronously throwing injected transport.
      void Promise.resolve()
        .then(() => {
          const current = latest.current;
          const stillVisible = batch.every(item => {
            const id = (JSON.parse(item.key) as string[])[2];
            return Array.from(bindings.current.values()).some(
              binding =>
                binding.id === id &&
                binding.element &&
                (typeof window.IntersectionObserver !== "function" ||
                  binding.intersecting) &&
                isAdminNewInformationRowVisible(binding.element)
            );
          });
          if (
            !state.access.valid() ||
            controller.signal.aborted ||
            current.rowIdentity !== state.rowIdentity ||
            !current.options.listReady ||
            !current.query.isSuccess ||
            current.query.isFetching ||
            current.query.isError ||
            current.options.acknowledgeOnVisible === false ||
            !stillVisible ||
            document.visibilityState === "hidden"
          )
            throw new CancelledError({ silent: true });
          return state.options.client.markDisplayed(
            { receipts },
            { signal: controller.signal }
          );
        })
        .then(result => {
          if (rejectedMark(result, receipts.length))
            throw new Error("服务器拒绝新信息展示确认");
          if (!state.access.valid() || controller.signal.aborted ||
              latest.current.rowIdentity !== state.rowIdentity) {
            batch.forEach(item => { if (events.get(item.key)?.controller === controller) events.delete(item.key); });
            return;
          }
          batch.forEach(item => events.set(item.key, { state: "seen" }));
          if (state.options.retainUnreadWhileVisible === false)
            batch.forEach(item => latched.current.delete(item.key));
          invalidateDisplayed(state.access.token!, state.options.module, state.scope);
        })
        .catch((error: unknown) => {
          if (!state.access.valid() || controller.signal.aborted) return;
          if (error instanceof CancelledError)
            batch.forEach(item => events.delete(item.key));
          else {
            batch.forEach(item =>
              events.set(item.key, { state: "failed", error })
            );
            if (authorizationError(error)) state.access.deny();
          }
        })
        .finally(() => { ownedMarks.current.delete(controller); notify(runtime); });
    }
  }, [runtime, redraw]);
  const schedule = useCallback(() => {
    if (scheduled.current !== null) return;
    // rAF itself runs BEFORE paint. Cross two frames so the committed badge/row
    // has had a paint opportunity; revalidate geometry/state before submitting.
    scheduled.current = window.requestAnimationFrame(() => {
      scheduled.current = window.requestAnimationFrame(() => {
        scheduled.current = null;
        refresh();
      });
    });
  }, [refresh]);

  useEffect(() => {
    const update = () => schedule();
    if (typeof window.IntersectionObserver === "function") {
      observer.current = new window.IntersectionObserver(entries => {
        for (const entry of entries)
          for (const binding of Array.from(bindings.current.values())) {
            if (binding.element === entry.target)
              binding.intersecting =
                entry.isIntersecting && entry.intersectionRatio > 0;
          }
        schedule();
      });
      bindings.current.forEach(binding => {
        binding.intersecting = false;
        if (binding.element) observer.current?.observe(binding.element);
      });
    }
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    // Also catches CSS/ancestor changes, including the no-IO fallback.
    const timer = window.setInterval(update, 1000);
    schedule();
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      window.clearInterval(timer);
      if (scheduled.current !== null) {
        window.cancelAnimationFrame(scheduled.current);
        scheduled.current = null;
      }
    };
  }, [schedule]);
  useEffect(() => {
    schedule();
  }, [
    query.dataUpdatedAt,
    query.fetchStatus,
    query.status,
    visible,
    options.listReady,
    options.acknowledgeOnVisible,
    access.permitted,
    rowIdentity,
    schedule,
  ]);
  useEffect(() => {
    // A list becoming pending/error cancels inspect work; old data may label rows,
    // but cannot issue receipts/clear anything while the list is not successful.
    if (!options.listReady)
      void access.queryClient.cancelQueries({
        queryKey: adminNewInformationKeys.rows(
          options.accountKey,
          options.module,
          scope
        ),
      });
  }, [
    options.listReady,
    options.accountKey,
    options.module,
    scope,
    access.queryClient,
  ]);

  const rowRef = useCallback(
    (id: string, presentationKey = id): RefCallback<HTMLElement> => {
      const bindingKey = JSON.stringify([id, presentationKey]);
      let binding = bindings.current.get(bindingKey);
      if (!binding) {
        const created: RowBinding = {
          id,
          element: null,
          intersecting: false,
          callback: element => {
            if (created.element) observer.current?.unobserve(created.element);
            created.element = element;
            created.intersecting = false;
            if (element) observer.current?.observe(element);
            schedule();
          },
        };
        binding = created;
        bindings.current.set(bindingKey, binding);
      }
      return binding.callback;
    },
    [schedule]
  );
  const getRow = (
    id: string,
    presentationKey = id
  ): AdminNewInformationRowPresentation => {
    const item = items.get(id);
    const key =
      item &&
      adminNewInformationRefKey(options.module, item.id, item.version, scope);
    const record =
      key && access.token
        ? runtime.events.get(access.token)?.get(key)
        : undefined;
    return {
      ref: rowRef(id, presentationKey),
      isNew: Boolean(
        access.permitted &&
          !revoked &&
          options.listReady &&
          key &&
          ((options.retainUnreadWhileVisible !== false && latched.current.has(key)) ||
            (item?.isNew && record?.state !== "seen"))
      ),
      markError: record?.state === "failed" && item?.isNew ? record.error : undefined,
      markState: record?.state,
      verificationState: !access.permitted || revoked || !access.valid() ? "blocked"
        : !options.listReady ? "checking"
        : record?.state === "failed" || query.isError ? "failed"
        : record?.state === "seen" ? "confirmed"
        : query.isFetching || !query.isSuccess ? "checking"
        : !item || (item.isNew && !item.receipt) ? "missing"
        : item.isNew === false ? "confirmed"
        : record?.state === "pending" ? "pending" : "new",
    };
  };
  return {
    query,
    getRow,
    rowRef,
    isNew: (id: string) => getRow(id).isNew,
    /** Explicit retry only. Current inspection must again be successful and the
     * row still visible; only fresh server receipts are submitted. No toast/UI.
     */
    retryDisplayed: async () => {
      const state = latest.current;
      if (!state.access.permitted || !state.access.token || !state.access.valid() ||
          !state.options.listReady || state.options.acknowledgeOnVisible === false || retrying.current) return;
      retrying.current = true;
      try {
        // A failed/expired signed token is never replayed. Keep failure locks
        // until a NEW successful inspection proves the current receipt/state.
        const fresh = await state.query.refetch({ cancelRefetch: true });
        const current = latest.current;
        if (!state.access.valid() || current.rowIdentity !== state.rowIdentity ||
            !current.options.listReady || fresh.isError || !fresh.isSuccess) return;
        const events = runtime.events.get(state.access.token);
        for (const [key, event] of Array.from(events ?? [])) {
          const [module, eventScope, sourceId] = JSON.parse(key) as string[];
          if (event.state === "failed" && module === state.options.module &&
              eventScope === (state.scope || "") && state.options.refs.includes(sourceId)) {
            events?.delete(key);
            latched.current.delete(key);
          }
        }
      } finally {
        retrying.current = false;
        notify(runtime);
        schedule();
      }
    },
  };
}

/** TWO integration surfaces. Bind once outside render to an explicit typed tRPC
 * adapter, then reuse both hooks under the EXISTING QueryClientProvider.
 * 1. Header/nav: useSummary({ accountKey, canRead }).count(module, moduleCanRead)
 * 2. Native list: useRows({ accountKey, canRead, module, refs, scope, listReady });
 *    const row = rows.getRow(sourceId, optionalPresentationId);
 *    <tr ref={row.ref}>…<AdminNewInformationRowBadge isNew={row.isNew}/></tr>
 * No BusinessScope, toast, sound, popover, new list route or local read persistence.
 */
export function createAdminNewInformationHooks(
  client: AdminNewInformationClient
) {
  return {
    useSummary: (options: AdminNewInformationAccess) =>
      useAdminNewInformationSummary({ ...options, client }),
    useRows: (options: AdminNewInformationRowsOptions) =>
      useAdminNewInformationRows({ ...options, client }),
  };
}

export type AdminNewInformationSummaryResult = ReturnType<
  typeof useAdminNewInformationSummary
>;
export type AdminNewInformationRowsResult = ReturnType<
  typeof useAdminNewInformationRows
>;
type AdminNewInformationContextValue = AdminNewInformationAccess & {
  client: AdminNewInformationClient;
  moduleCanRead?: Partial<Record<AdminNewInformationModule, boolean>>;
  summary: AdminNewInformationSummaryResult;
};
const AdminNewInformationContext =
  createContext<AdminNewInformationContextValue | null>(null);
/** Standalone legacy/front list pages have no admin notification context. Keep
 * the SAME hook order and a stable inert adapter; never create an empty provider.
 */
const disabledAdminNewInformationClient: AdminNewInformationClient = {
  summary: async () => ({
    modules: Object.fromEntries(
      ADMIN_NEW_INFORMATION_MODULES.map(module => [
        module,
        { count: 0, available: false },
      ])
    ) as AdminNewInformationSummary["modules"],
  }),
  inspect: async () => ({ items: [] }),
  markDisplayed: async () => ({ marked: 0, accepted: 0 }),
};
/** Mount ONCE in DashboardLayout, under its existing QueryClientProvider.
 * Leaf pages read this context instead of starting another summary observer.
 */
export function AdminNewInformationProvider(
  props: AdminNewInformationAccess & {
    client: AdminNewInformationClient;
    moduleCanRead?: Partial<Record<AdminNewInformationModule, boolean>>;
    children: ReactNode;
  }
) {
  const result = useAdminNewInformationSummary(props);
  const summary = {
    ...result,
    count: (module: AdminNewInformationModule, allowed = true) =>
      result.count(
        module,
        allowed && (props.moduleCanRead?.[module] ?? props.canRead)
      ),
  };
  return createElement(
    AdminNewInformationContext.Provider,
    { value: { ...props, summary } },
    props.children
  );
}
export function useAdminNewInformationContext() {
  const context = useContext(AdminNewInformationContext);
  if (!context)
    throw new Error("新信息组件须在 AdminNewInformationProvider 内使用");
  return context;
}
export function useAdminNewInformationContextRows(
  options: Omit<AdminNewInformationRowsOptions, "accountKey" | "canRead">
) {
  const context = useContext(AdminNewInformationContext);
  const rows = useAdminNewInformationRows({
    ...options,
    client: context?.client ?? disabledAdminNewInformationClient,
    accountKey: context?.accountKey ?? null,
    canRead: Boolean(
      context?.canRead && (context.moduleCanRead?.[options.module] ?? true) &&
      (options.expectedAccountKey === undefined || accountToken(options.expectedAccountKey) === accountToken(context.accountKey))
    ),
  });
  return { ...rows, summarySyncState: context?.summary.syncState(options.module) ?? "disabled",
    retrySummary: context?.summary.retrySummary ?? (() => Promise.resolve(undefined)) };
}

/** Entire authorized unread set, not a filter over one already-paginated page. */
export function customerIdsFromAdminUnreadRefs(refs: readonly string[]): number[] {
  if (refs.length > 2000) throw new Error("未读客户筛选暂不可用：超过2000条，请稍后重试");
  const ids = refs.map(ref => {
    const match = /^customer:([1-9]\d*)$/.exec(ref);
    const id = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("未读客户编号核验失败，请重试");
    return id;
  });
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export function useAdminNewInformationContextUnreadRefs(options: {
  module: "customers";
  scope?: string;
  enabled: boolean;
  listReady: boolean;
  expectedAccountKey?: AdminNewInformationAccountKey;
}) {
  const context = useContext(AdminNewInformationContext);
  const client = context?.client ?? disabledAdminNewInformationClient;
  const capability = client.unreadRefs;
  const accountKey = context?.accountKey ?? null;
  const access = useAccessBoundary({ accountKey, canRead: Boolean(context?.canRead &&
    (context.moduleCanRead?.customers ?? true) && (options.expectedAccountKey === undefined ||
      accountToken(options.expectedAccountKey) === accountToken(accountKey))) }, "customers", options.scope);
  const visible = useAdminNewInformationPageVisible();
  const enabled = options.enabled && options.listReady && access.permitted;
  const key = adminNewInformationKeys.unreadRefs(accountKey, options.module, options.scope);
  const keyText = JSON.stringify(key);
  const prior = useRef({ key, keyText, enabled });
  useEffect(() => {
    const previous = prior.current;
    if (previous.keyText !== keyText || !enabled) {
      void access.queryClient.cancelQueries({ queryKey: previous.key, exact: true });
      access.queryClient.removeQueries({ queryKey: previous.key, exact: true });
    }
    prior.current = { key, keyText, enabled };
  }, [keyText, enabled, access.queryClient]);
  const query = useQuery({
    queryKey: key,
    enabled: enabled && visible,
    queryFn: async ({ signal }) => {
      const readKey = invalidationKey(access.token!, options.module, options.scope);
      const epoch = runtimeFor(access.queryClient).invalidations.get(readKey) ?? 0;
      if (!capability) throw new Error("当前后台未支持未读客户筛选，请更新服务后重试");
      const data = await capability({ module: options.module, scope: options.scope }, { signal });
      if (signal.aborted || !access.valid() || epoch !== (runtimeFor(access.queryClient).invalidations.get(readKey) ?? 0)) throw new CancelledError({ silent: true });
      if (!isRecord(data) || data.available !== true || !Array.isArray(data.refs) ||
          data.refs.some(ref => typeof ref !== "string")) throw new Error("未读客户筛选暂不可用，请重试");
      return { refs: data.refs, customerIds: customerIdsFromAdminUnreadRefs(data.refs), available: true as const };
    },
    retry: false, staleTime: 0, placeholderData: undefined,
    refetchOnMount: "always", refetchOnWindowFocus: "always",
    refetchInterval: enabled && visible ? ADMIN_NEW_INFORMATION_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
  const revoked = authorizationError(query.error);
  useEffect(() => { if (revoked) access.deny(); }, [revoked, access.deny]);
  const available = enabled && !query.isError && query.isSuccess && !query.isFetching;
  const error = options.enabled && options.listReady && !access.permitted
    ? new Error("未读客户权限或后台账号核验失败，请重新核验后重试") : query.error;
  return { query, available, error, customerIds: available ? query.data?.customerIds : undefined,
    refs: available ? query.data?.refs : undefined, retry: () => query.refetch() };
}
type RowsContextValue = {
  module: AdminNewInformationModule;
  scope?: string;
  rows: AdminNewInformationRowsResult;
};
const RowsContext = createContext<RowsContextValue | null>(null);
/** Optional native-list wrapper. One batched inspect for the original successful
 * list, even if a source appears in several inquiry presentations. No extra panel.
 */
export function AdminNewInformationRowsProvider(
  props: Omit<AdminNewInformationRowsOptions, "accountKey" | "canRead"> & {
    children: ReactNode;
  }
) {
  const rows = useAdminNewInformationContextRows(props);
  return createElement(
    RowsContext.Provider,
    { value: { module: props.module, scope: props.scope, rows } },
    props.children
  );
}
/** Optional context lookup also keeps the pure/standalone badge usable in tests. */
export function useAdminNewInformationRowContext(
  id?: string,
  module?: AdminNewInformationModule,
  scope?: string,
  presentationKey?: string
): AdminNewInformationRowPresentation | undefined {
  const context = useContext(RowsContext);
  if (
    !context ||
    !id ||
    (module && module !== context.module) ||
    (scope !== undefined && (scope || "") !== (context.scope || ""))
  )
    return undefined;
  return context.rows.getRow(id, presentationKey);
}
