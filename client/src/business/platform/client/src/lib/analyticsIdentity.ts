export const ANALYTICS_VISITOR_KEY = "d51_analytics_visitor";
export const ANALYTICS_SESSION_KEY = "d51_analytics_session";

export function createAnalyticsEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function storedId(storage: Storage, key: string) {
  try {
    const existing = storage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const created = createAnalyticsEventId();
    storage.setItem(key, created);
    return created;
  } catch {
    return createAnalyticsEventId();
  }
}

export function getAnalyticsVisitorId() {
  return storedId(localStorage, ANALYTICS_VISITOR_KEY);
}

export function getAnalyticsSessionId() {
  return storedId(sessionStorage, ANALYTICS_SESSION_KEY);
}
