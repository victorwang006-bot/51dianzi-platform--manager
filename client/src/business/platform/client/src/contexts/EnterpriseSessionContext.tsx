import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../api/business-trpc";

export type EnterpriseAccessStatus = "enabled" | "pending" | "rejected" | "disabled";

export type EnterpriseChoice = {
  enterpriseId: number;
  companyName: string;
  registrationRegion: "CN" | "HK" | string;
  role: string;
  isOwner: boolean;
  memberStatus: string;
  accessStatus: EnterpriseAccessStatus;
  permissionKeys: string[];
};

export type EnterpriseListResponse = {
  items: EnterpriseChoice[];
  selectionRequired: boolean;
};

type EnterpriseSwitchGuard = {
  isDirty: () => boolean;
  isBusy?: () => boolean;
  discard?: () => void;
};

type EnterpriseSession = {
  items: EnterpriseChoice[];
  isLoading: boolean;
  /** A chat/forum route is waiting for its account-scoped selection restoration. */
  isRestoringSelection: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  accountId: number | null;
  error: Error | null;
  selectionRequired: boolean;
  activeEnterprise: EnterpriseChoice | null;
  /** True only after this account explicitly chose the current legal enterprise. */
  hasExplicitSelection: boolean;
  invalidUrlEnterpriseId: string | null;
  selectEnterprise: (enterpriseId: number) => "selected" | "busy" | "dirty" | "invalid";
  /** Only a scoped workbench enterprise.me verification may invoke this URL-entry confirmation. */
  recordVerifiedWorkspaceSelection: (enterpriseId: number) => void;
  refreshEnterprises: () => Promise<void>;
  beginNewApplication: () => string;
  registerSwitchGuard: (id: string, guard: EnterpriseSwitchGuard) => () => void;
};

const EnterpriseSessionContext = createContext<EnterpriseSession | null>(null);
const UnsubscribedEnterpriseSessionContext = createContext<EnterpriseSession | null>(null);

const TAB_SELECTION_KEY = "51dianzi:enterprise:tab-selection:v2";
const EXPLICIT_TAB_SELECTION_KEY = "51dianzi:enterprise:explicit-tab-selection:v1";
const EXPLICIT_SELECTION_KEY = "51dianzi:enterprise:explicit-selection:v1";
const RECENT_SELECTION_KEY = "51dianzi:enterprise:recent-selection:v1";

function browserStorage(name: "sessionStorage" | "localStorage"): Storage | null {
  try {
    return window[name];
  } catch {
    return null;
  }
}

function safeStorage(storage: Storage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | null | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage being unavailable must not make a legal, current-tab selection fail.
  }
}

function safeRemove(storage: Storage | null | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // A denied browser storage API must not leave a stale in-memory identity active.
  }
}

/** Selections belong to both a browser tab and an authenticated account. */
export function enterpriseTabSelectionStorageKey(accountId: number) {
  return `${TAB_SELECTION_KEY}:user:${accountId}`;
}

/** A user action, unlike a chat fallback, is safe to reuse as a forum author identity. */
export function enterpriseExplicitTabSelectionStorageKey(accountId: number) {
  return `${EXPLICIT_TAB_SELECTION_KEY}:user:${accountId}`;
}

/** A confirmed manual/workbench identity can restore in a new tab for the same account. */
export function enterpriseExplicitSelectionStorageKey(accountId: number) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
  return `${EXPLICIT_SELECTION_KEY}:user:${accountId}`;
}

/** Chat/forum remembers an account-scoped selection across tabs, never across accounts. */
export function enterpriseRecentSelectionStorageKey(accountId: number) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
  return `${RECENT_SELECTION_KEY}:user:${accountId}`;
}

export function validEnterpriseId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** A paused member or disabled enterprise is never a legal operating target. */
export function isSelectableEnterprise(item: EnterpriseChoice | undefined): item is EnterpriseChoice {
  return Boolean(item && item.memberStatus === "active" && item.accessStatus !== "disabled");
}

/** Chat/forum only operates against an enterprise that is fully ERP-enabled. */
export function isOperatingEnterprise(item: EnterpriseChoice | undefined): item is EnterpriseChoice {
  return Boolean(item && item.memberStatus === "active" && item.accessStatus === "enabled");
}

export function isForumPath(location: string) {
  return location.split(/[?#]/, 1)[0] === "/forum";
}

export function isChatOperatingOnlyPath(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return pathname === "/chat" || isForumPath(location);
}

/** Keep a refreshed pending/disabled item out of a chat/forum render before effects reconcile selection. */
export function activeEnterpriseForRoute(
  items: EnterpriseChoice[],
  enterpriseId: number | null,
  chatOperatingOnly: boolean,
) {
  const targetIsLegal = chatOperatingOnly ? isOperatingEnterprise : isSelectableEnterprise;
  return items.find(item => item.enterpriseId === enterpriseId && targetIsLegal(item)) ?? null;
}

/** An account with no enterprise at all may retain the legacy personal forum identity. */
export function canUsePersonalForumIdentity(input: {
  items: EnterpriseChoice[];
  activeEnterprise: EnterpriseChoice | null;
  isLoading: boolean;
  isRestoringSelection: boolean;
  hasError: boolean;
  invalidUrlEnterpriseId: string | null;
}) {
  return input.items.length === 0
    && input.activeEnterprise === null
    && !input.isLoading
    && !input.isRestoringSelection
    && !input.hasError
    && input.invalidUrlEnterpriseId === null;
}

/**
 * Resolve the only legal target without defaulting an invalid URL to a first list item.
 * Chat/forum uses the stricter enabled-only predicate and may restore an account-scoped
 * recent selection while its route is active. Forum sends additionally require a user
 * action, verified workbench selection, or an explicit URL, so it never consumes the
 * legacy automatic memory.
 */
export function chooseEnterprise(input: {
  items: EnterpriseChoice[];
  selectionRequired: boolean;
  urlEnterpriseId?: string | null;
  tabEnterpriseId?: string | null;
  explicitTabEnterpriseId?: string | null;
  explicitRememberedEnterpriseId?: string | null;
  rememberedEnterpriseId?: string | null;
  chatOperatingOnly?: boolean;
  requireExplicitSelection?: boolean;
}): { enterpriseId: number | null; invalidUrlEnterpriseId: string | null } {
  const byId = new Map(input.items.map(item => [item.enterpriseId, item]));
  const selectable = input.chatOperatingOnly ? isOperatingEnterprise : isSelectableEnterprise;
  const urlRaw = input.urlEnterpriseId ?? null;
  if (urlRaw !== null) {
    const urlId = validEnterpriseId(urlRaw);
    if (!urlId || !selectable(byId.get(urlId))) {
      return { enterpriseId: null, invalidUrlEnterpriseId: urlRaw };
    }
    return { enterpriseId: urlId, invalidUrlEnterpriseId: null };
  }

  const tabEnterpriseId = validEnterpriseId(
    input.requireExplicitSelection ? input.explicitTabEnterpriseId : input.tabEnterpriseId,
  );
  if (tabEnterpriseId && selectable(byId.get(tabEnterpriseId))) {
    return { enterpriseId: tabEnterpriseId, invalidUrlEnterpriseId: null };
  }

  const explicitRememberedEnterpriseId = validEnterpriseId(input.explicitRememberedEnterpriseId);
  if (input.requireExplicitSelection && explicitRememberedEnterpriseId && selectable(byId.get(explicitRememberedEnterpriseId))) {
    return { enterpriseId: explicitRememberedEnterpriseId, invalidUrlEnterpriseId: null };
  }

  const rememberedEnterpriseId = validEnterpriseId(input.rememberedEnterpriseId);
  if (!input.requireExplicitSelection && rememberedEnterpriseId && selectable(byId.get(rememberedEnterpriseId))) {
    return { enterpriseId: rememberedEnterpriseId, invalidUrlEnterpriseId: null };
  }

  const eligible = input.items.filter(selectable);
  // Chat/inquiry never guesses the first or sole enterprise. Non-chat business
  // routes retain their existing verified single-enterprise behavior.
  if (!input.chatOperatingOnly && !input.requireExplicitSelection && !input.selectionRequired && eligible.length === 1) {
    return { enterpriseId: eligible[0].enterpriseId, invalidUrlEnterpriseId: null };
  }
  return { enterpriseId: null, invalidUrlEnterpriseId: null };
}

export function isValidApplicationId(value: string | null | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{16,64}$/.test(value));
}

export function EnterpriseSessionProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const guards = useRef(new Map<string, EnterpriseSwitchGuard>());
  // This account query remains on the root client. Anonymous visitors never invoke
  // the protected enterprise list endpoint.
  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const isAuthenticated = Boolean(authQuery.data);
  const listQuery = trpc.enterprise.listForCurrentUser.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const response = listQuery.data;
  const items = response?.items ?? [];
  const [activeSelection, setActiveSelection] = useState<{
    accountId: number | null;
    enterpriseId: number | null;
    explicitlySelected: boolean;
  }>({
    accountId: null,
    enterpriseId: null,
    explicitlySelected: false,
  });
  const [invalidUrlEnterpriseId, setInvalidUrlEnterpriseId] = useState<string | null>(null);
  const initializedFor = useRef<string | null>(null);
  const accountId = authQuery.data?.id ?? null;
  const chatOperatingOnly = isChatOperatingOnlyPath(location);
  const forumRequiresExplicitSelection = isForumPath(location);
  const activeEnterpriseId = activeSelection.accountId === accountId ? activeSelection.enterpriseId : null;
  const urlEnterpriseId = useMemo(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search;
    return new URLSearchParams(query).get("enterpriseId");
  }, [location]);
  const explicitForumTabEnterpriseId = accountId !== null
    ? validEnterpriseId(safeStorage(browserStorage("sessionStorage"), enterpriseExplicitTabSelectionStorageKey(accountId)))
    : null;
  const explicitForumRememberedEnterpriseId = accountId !== null
    ? validEnterpriseId(safeStorage(browserStorage("localStorage"), enterpriseExplicitSelectionStorageKey(accountId) ?? ""))
    : null;

  // Permission changes are part of an identity change: the current selection must
  // be reconsidered before an old capability can be treated as current.
  const itemKey = items.map(item =>
    `${item.enterpriseId}:${item.accessStatus}:${item.memberStatus}:${item.permissionKeys.join(",")}`,
  ).join("|");
  const restoringKey = accountId === null
    ? ""
    : `${accountId}::${itemKey}::${response?.selectionRequired ?? "loading"}::${urlEnterpriseId ?? ""}::${chatOperatingOnly}::${forumRequiresExplicitSelection}`;
  const isRestoringSelection = Boolean(
    chatOperatingOnly
      && accountId !== null
      && !listQuery.error
      && (!response || initializedFor.current !== restoringKey),
  );

  useEffect(() => {
    if (!response || accountId === null) return;
    const initializationKey = `${accountId}::${itemKey}::${response.selectionRequired}::${urlEnterpriseId ?? ""}::${chatOperatingOnly}::${forumRequiresExplicitSelection}`;
    if (initializedFor.current === initializationKey) return;
    initializedFor.current = initializationKey;

    const choice = chooseEnterprise({
      items,
      selectionRequired: response.selectionRequired,
      urlEnterpriseId,
      tabEnterpriseId: forumRequiresExplicitSelection
        ? null
        : safeStorage(browserStorage("sessionStorage"), enterpriseTabSelectionStorageKey(accountId)),
      explicitTabEnterpriseId: chatOperatingOnly
        ? safeStorage(browserStorage("sessionStorage"), enterpriseExplicitTabSelectionStorageKey(accountId))
        : null,
      explicitRememberedEnterpriseId: chatOperatingOnly
        ? safeStorage(browserStorage("localStorage"), enterpriseExplicitSelectionStorageKey(accountId) ?? "")
        : null,
      rememberedEnterpriseId: chatOperatingOnly && !forumRequiresExplicitSelection
        ? safeStorage(browserStorage("localStorage"), enterpriseRecentSelectionStorageKey(accountId) ?? "")
        : null,
      chatOperatingOnly,
      requireExplicitSelection: chatOperatingOnly,
    });
    const targetIsLegal = chatOperatingOnly ? isOperatingEnterprise : isSelectableEnterprise;
    // A valid active target remains stable when a later membership appears; an invalid
    // explicit URL never falls back to the previous enterprise. A forum must not retain
    // an identity that originally came from chat's automatic first-row fallback.
    const currentEnterpriseStillSelectable = urlEnterpriseId === null
      && activeEnterpriseId !== null
      && targetIsLegal(items.find(item => item.enterpriseId === activeEnterpriseId))
      && (!forumRequiresExplicitSelection
        || activeSelection.explicitlySelected
        || activeEnterpriseId === explicitForumTabEnterpriseId
        || activeEnterpriseId === explicitForumRememberedEnterpriseId
        || (!response.selectionRequired && items.filter(isOperatingEnterprise).length === 1));
    const nextEnterpriseId = currentEnterpriseStillSelectable ? activeEnterpriseId : choice.enterpriseId;
    const nextSelectionWasExplicit = nextEnterpriseId !== null && (
      (activeSelection.accountId === accountId
        && activeSelection.enterpriseId === nextEnterpriseId
        && activeSelection.explicitlySelected)
      || nextEnterpriseId === explicitForumTabEnterpriseId
      || nextEnterpriseId === explicitForumRememberedEnterpriseId
      || (currentEnterpriseStillSelectable
        ? activeSelection.explicitlySelected
          || activeEnterpriseId === explicitForumTabEnterpriseId
          || activeEnterpriseId === explicitForumRememberedEnterpriseId
        : forumRequiresExplicitSelection
          && (urlEnterpriseId !== null
            || choice.enterpriseId === explicitForumTabEnterpriseId
            || choice.enterpriseId === explicitForumRememberedEnterpriseId))
    );
    setActiveSelection({ accountId, enterpriseId: nextEnterpriseId, explicitlySelected: nextSelectionWasExplicit });
    if (chatOperatingOnly && !forumRequiresExplicitSelection && !listQuery.error && nextEnterpriseId !== null) {
      safeSet(browserStorage("sessionStorage"), enterpriseTabSelectionStorageKey(accountId), String(nextEnterpriseId));
      const recentKey = enterpriseRecentSelectionStorageKey(accountId);
      if (recentKey) safeSet(browserStorage("localStorage"), recentKey, String(nextEnterpriseId));
    }
    if (!forumRequiresExplicitSelection && urlEnterpriseId === null && nextEnterpriseId === null) {
      safeRemove(browserStorage("sessionStorage"), enterpriseTabSelectionStorageKey(accountId));
    }
    setInvalidUrlEnterpriseId(choice.invalidUrlEnterpriseId);
  }, [
    accountId,
    activeEnterpriseId,
    activeSelection.explicitlySelected,
    chatOperatingOnly,
    explicitForumTabEnterpriseId,
    explicitForumRememberedEnterpriseId,
    forumRequiresExplicitSelection,
    itemKey,
    items,
    listQuery.error,
    response,
    urlEnterpriseId,
  ]);

  useEffect(() => {
    if (accountId !== null) return;
    initializedFor.current = null;
    setActiveSelection(current => current.accountId === null && current.enterpriseId === null && !current.explicitlySelected
      ? current
      : { accountId: null, enterpriseId: null, explicitlySelected: false });
    setInvalidUrlEnterpriseId(null);
  }, [accountId]);

  const activeEnterprise = useMemo(() => {
    const active = activeEnterpriseForRoute(items, activeEnterpriseId, chatOperatingOnly);
    if (!active || !forumRequiresExplicitSelection) return active;
    // Keep an invalid forum URL from exposing a prior chat identity during the render
    // before the selection effect clears it.
    if (urlEnterpriseId !== null) {
      return validEnterpriseId(urlEnterpriseId) === active.enterpriseId ? active : null;
    }
    if (
      activeSelection.explicitlySelected
      || active.enterpriseId === explicitForumTabEnterpriseId
      || active.enterpriseId === explicitForumRememberedEnterpriseId
    ) return active;
    return !response?.selectionRequired && items.filter(isOperatingEnterprise).length === 1 ? active : null;
  }, [
    activeEnterpriseId,
    activeSelection.explicitlySelected,
    chatOperatingOnly,
    explicitForumTabEnterpriseId,
    explicitForumRememberedEnterpriseId,
    forumRequiresExplicitSelection,
    items,
    response?.selectionRequired,
    urlEnterpriseId,
  ]);

  const hasExplicitSelection = Boolean(
    activeEnterprise
    && activeSelection.accountId === accountId
    && activeSelection.enterpriseId === activeEnterprise.enterpriseId
    && activeSelection.explicitlySelected,
  );

  const updateCurrentUrl = useCallback((enterpriseId: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("enterpriseId", String(enterpriseId));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const selectEnterprise = useCallback((enterpriseId: number) => {
    if (accountId === null) return "invalid" as const;
    const item = items.find(candidate => candidate.enterpriseId === enterpriseId);
    const targetIsLegal = chatOperatingOnly ? isOperatingEnterprise : isSelectableEnterprise;
    if (!targetIsLegal(item)) return "invalid" as const;
    for (const guard of Array.from(guards.current.values())) {
      if (guard.isBusy?.()) return "busy" as const;
    }
    const dirtyGuards = Array.from(guards.current.values()).filter(guard => guard.isDirty());
    if (dirtyGuards.length && !window.confirm("当前页面有未保存内容，确定放弃并切换企业吗？")) {
      return "dirty" as const;
    }
    dirtyGuards.forEach(guard => guard.discard?.());
    setInvalidUrlEnterpriseId(null);
    setActiveSelection({ accountId, enterpriseId, explicitlySelected: true });
    safeSet(browserStorage("sessionStorage"), enterpriseTabSelectionStorageKey(accountId), String(enterpriseId));
    safeSet(browserStorage("sessionStorage"), enterpriseExplicitTabSelectionStorageKey(accountId), String(enterpriseId));
    const explicitSelectionKey = enterpriseExplicitSelectionStorageKey(accountId);
    if (explicitSelectionKey) {
      if (isOperatingEnterprise(item)) safeSet(browserStorage("localStorage"), explicitSelectionKey, String(enterpriseId));
      else safeRemove(browserStorage("localStorage"), explicitSelectionKey);
    }
    const recentKey = enterpriseRecentSelectionStorageKey(accountId);
    if (chatOperatingOnly && recentKey) safeSet(browserStorage("localStorage"), recentKey, String(enterpriseId));
    updateCurrentUrl(enterpriseId);
    return "selected" as const;
  }, [accountId, chatOperatingOnly, items, updateCurrentUrl]);

  const recordVerifiedWorkspaceSelection = useCallback((enterpriseId: number) => {
    if (accountId === null) return;
    const item = items.find(candidate => candidate.enterpriseId === enterpriseId);
    // The scoped EnterpriseWorkspaceSelectionVerifier already proved enterprise.me for
    // this immutable request snapshot. Recheck the root account list before storing it.
    if (
      !isOperatingEnterprise(item)
      || activeSelection.accountId !== accountId
      || activeSelection.enterpriseId !== enterpriseId
    ) return;
    safeSet(browserStorage("sessionStorage"), enterpriseTabSelectionStorageKey(accountId), String(enterpriseId));
    safeSet(browserStorage("sessionStorage"), enterpriseExplicitTabSelectionStorageKey(accountId), String(enterpriseId));
    const explicitSelectionKey = enterpriseExplicitSelectionStorageKey(accountId);
    if (explicitSelectionKey) safeSet(browserStorage("localStorage"), explicitSelectionKey, String(enterpriseId));
    if (!activeSelection.explicitlySelected) {
      setActiveSelection({ accountId, enterpriseId, explicitlySelected: true });
    }
  }, [accountId, activeSelection, items]);

  const refreshEnterprises = useCallback(async () => {
    const result = await listQuery.refetch();
    if (result.error) throw result.error;
  }, [listQuery.refetch]);

  const beginNewApplication = useCallback(() => {
    const currentGuards = Array.from(guards.current.values());
    if (currentGuards.some(guard => guard.isBusy?.())) {
      window.alert("当前企业仍有上传或提交任务，请等待完成后再开通新企业");
      return "";
    }
    const dirty = currentGuards.filter(guard => guard.isDirty());
    if (dirty.length && !window.confirm("当前页面有未保存内容，确定放弃并开通新企业吗？")) return "";
    dirty.forEach(guard => guard.discard?.());
    navigate("/crm-apply?new=1");
    return "";
  }, [navigate]);

  const registerSwitchGuard = useCallback((id: string, guard: EnterpriseSwitchGuard) => {
    guards.current.set(id, guard);
    return () => guards.current.delete(id);
  }, []);

  const value = useMemo<EnterpriseSession>(() => ({
    items,
    isLoading: isAuthenticated && listQuery.isLoading,
    isRestoringSelection,
    authLoading: authQuery.isLoading,
    isAuthenticated,
    accountId,
    error: listQuery.error ? new Error(listQuery.error.message) : null,
    selectionRequired: response?.selectionRequired ?? false,
    activeEnterprise,
    hasExplicitSelection,
    invalidUrlEnterpriseId,
    selectEnterprise,
    recordVerifiedWorkspaceSelection,
    refreshEnterprises,
    beginNewApplication,
    registerSwitchGuard,
  }), [
    activeEnterprise,
    beginNewApplication,
    hasExplicitSelection,
    invalidUrlEnterpriseId,
    isRestoringSelection,
    items,
    authQuery.isLoading,
    accountId,
    isAuthenticated,
    listQuery.error,
    listQuery.isLoading,
    registerSwitchGuard,
    response?.selectionRequired,
    selectEnterprise,
    recordVerifiedWorkspaceSelection,
    refreshEnterprises,
  ]);

  return <EnterpriseSessionContext.Provider value={value}>{children}</EnterpriseSessionContext.Provider>;
}

export function useEnterpriseSession() {
  const context = useContext(EnterpriseSessionContext);
  if (!context) throw new Error("useEnterpriseSession must be used within EnterpriseSessionProvider");
  return context;
}

/** Personal account pages may show the existing selected-company navigation without requiring a company. */
export function useOptionalEnterpriseSession(enabled = true) {
  // Other enterprise pages already use their immutable scoped client's authority;
  // do not subscribe their layout to an unrelated selection initialization render.
  return useContext(enabled ? EnterpriseSessionContext : UnsubscribedEnterpriseSessionContext);
}

/** Forms can run alone in unit tests; without the app provider this is intentionally a no-op. */
export function useEnterpriseSwitchGuard(id: string, guard: EnterpriseSwitchGuard) {
  const context = useContext(EnterpriseSessionContext);
  useEffect(() => {
    if (!context) return;
    return context.registerSwitchGuard(id, guard);
  }, [context, guard, id]);
}

export function enterpriseReturnUrl(enterpriseId: number | null | undefined) {
  return enterpriseId ? `/publish?enterpriseId=${encodeURIComponent(String(enterpriseId))}` : "/";
}
