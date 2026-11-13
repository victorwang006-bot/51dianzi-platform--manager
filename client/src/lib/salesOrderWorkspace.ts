export type SalesOrderSource = "mall" | "business";
export type SalesOrderSourceAccess = Readonly<Record<SalesOrderSource, boolean>>;

export const SALES_ORDER_SOURCES = [
  { value: "mall", label: "商城订单", capability: "marketplace.seller" },
  { value: "business", label: "业务订单", capability: "crm.sales_orders" },
] as const;

export type SalesOrderSourceSelection =
  | { source: SalesOrderSource; explicit: boolean; allowed: boolean }
  | { source: null; explicit: boolean; allowed: false };

export function isSalesOrderSource(value: unknown): value is SalesOrderSource {
  return value === "mall" || value === "business";
}

function locationParts(location: string) {
  const hashIndex = location.indexOf("#");
  const beforeHash = hashIndex < 0 ? location : location.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  return {
    pathname: queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex),
    search: queryIndex < 0 ? "" : beforeHash.slice(queryIndex + 1),
    hash: hashIndex < 0 ? "" : location.slice(hashIndex),
  };
}

/** Read current-identity UI intent only; explicit invalid/denied intent never falls back. */
export function resolveSalesOrderSource(
  location: string,
  access: SalesOrderSourceAccess,
  remembered?: unknown,
): SalesOrderSourceSelection {
  const { pathname, search } = locationParts(location);
  const params = new URLSearchParams(search);
  const explicit = params.getAll("orderSource");
  if (explicit.length) {
    const source = explicit.length === 1 && isSalesOrderSource(explicit[0]) ? explicit[0] : null;
    return source ? { source, explicit: true, allowed: access[source] }
      : { source: null, explicit: true, allowed: false };
  }
  // Pre-consolidation CRM URLs must not be redirected to seller flow, even if
  // both grants are present or the remembered page is mall.
  if (/(?:^|\/)sales-orders(?:\/|$)/.test(pathname) || params.has("demandNo") || params.has("keyword")) {
    return { source: "business", explicit: false, allowed: access.business };
  }
  const source = isSalesOrderSource(remembered) && access[remembered] ? remembered
    : access.mall ? "mall" : access.business ? "business" : null;
  return source ? { source, explicit: false, allowed: true }
    : { source: null, explicit: false, allowed: false };
}

/** Preserve every unrelated query (including duplicate merchant candidates) and hash. */
export function salesOrderSourceTarget(location: string, source: SalesOrderSource, targetPath = "/orders"): string {
  const { search, hash } = locationParts(location);
  // Keep raw query encoding/order intact; only the display-intent field changes.
  const fields = search.split("&").filter(field => {
    if (!field) return false;
    return !new URLSearchParams(field).has("orderSource");
  });
  fields.push(`orderSource=${source}`);
  return `${targetPath}?${fields.join("&")}${hash}`;
}

export function salesOrderSourceStorageKey(identity: string): string {
  return `d51:sales-order-source:v1:${identity}`;
}

/** Storage is a preference, never a permission proof. Blocked storage is harmless. */
export function readRememberedSalesOrderSource(identity: string): SalesOrderSource | null {
  if (!identity || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(salesOrderSourceStorageKey(identity));
    return isSalesOrderSource(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberSalesOrderSource(identity: string, source: SalesOrderSource): void {
  if (!identity || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(salesOrderSourceStorageKey(identity), source);
  } catch {
    // Browser privacy settings must not prevent authorized navigation.
  }
}

/** Authorized navigation objects determine visibility only, not BFF route grants. */
export function getSalesOrderNavigationContext<T extends { path: string }>(items: readonly T[], location: string) {
  const { pathname } = locationParts(location);
  const isSales = /^\/workbench\/(?:orders|sales-orders|outbound)(?:\/|$)/.test(pathname);
  const mallItem = items.find(item => item.path === "/workbench/outbound");
  const businessItem = items.find(item => item.path === "/workbench/orders");
  const item = businessItem ?? mallItem;
  if (!isSales) return { item, active: false, label: null };
  const selection = pathname === "/workbench/outbound" || pathname.startsWith("/workbench/outbound/")
    ? { source: "mall" as const, allowed: !!mallItem }
    : resolveSalesOrderSource(location, { mall: !!mallItem, business: !!businessItem });
  return { item, active: selection.allowed,
    label: selection.allowed ? SALES_ORDER_SOURCES.find(entry => entry.value === selection.source)!.label : null };
}
