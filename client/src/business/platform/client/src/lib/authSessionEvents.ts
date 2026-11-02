import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const AUTH_SESSION_CLEARED_EVENT = "51dianzi:auth-session-cleared";
const AUTH_SESSION_CLEARED_STORAGE_KEY = "51dianzi:auth-session-cleared:v1";

/** Notify root and enterprise-scoped caches without broadcasting any identity data. */
export function signalAuthSessionCleared() {
  window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));
  try {
    localStorage.setItem(AUTH_SESSION_CLEARED_STORAGE_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Storage may be unavailable in a private browser.
  }
}

export function clearSessionQueryCache(client: QueryClient, authKey: QueryKey) {
  void client.cancelQueries();
  // Retain a null auth entry long enough for existing observers to see logout.
  client.setQueryData(authKey, null);
  const authQuery = client.getQueryCache().find({ queryKey: authKey, exact: true });
  client.removeQueries({ predicate: query => query !== authQuery });
  client.getMutationCache().clear();
}

export function installAuthSessionClearListener(clear: () => void): () => void {
  const onCleared = () => {
    try {
      sessionStorage.removeItem("manus-cookie");
    } catch {
      // Storage denied.
    }
    clear();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_SESSION_CLEARED_STORAGE_KEY && event.newValue) onCleared();
  };
  window.addEventListener(AUTH_SESSION_CLEARED_EVENT, onCleared);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, onCleared);
    window.removeEventListener("storage", onStorage);
  };
}
