const INTERNAL_NAVIGATION_ORIGIN = "https://business-navigation.invalid";

function parseInternalRelativeNavigation(value: string): URL | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const parsed = new URL(value, INTERNAL_NAVIGATION_ORIGIN);
  return parsed.origin === INTERNAL_NAVIGATION_ORIGIN ? parsed : null;
}

function isWorkbenchPath(pathname: string): boolean {
  return pathname === "/workbench" || pathname.startsWith("/workbench/");
}

function validMerchantId(value: string | undefined): value is string {
  if (!value || !/^\d+$/.test(value)) return false;
  const merchantId = Number(value);
  return Number.isSafeInteger(merchantId) && merchantId > 0;
}

function merchantIdFrom(url: URL): string | null {
  const merchantIds = url.searchParams.getAll("merchantId");
  return merchantIds.length === 1 && validMerchantId(merchantIds[0])
    ? merchantIds[0]
    : null;
}

function appendMerchantId(destination: string, merchantId: string): string {
  const hashIndex = destination.indexOf("#");
  const beforeHash = hashIndex === -1 ? destination : destination.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : destination.slice(hashIndex);
  const separator = beforeHash.includes("?")
    ? beforeHash.endsWith("?") || beforeHash.endsWith("&")
      ? ""
      : "&"
    : "?";

  return `${beforeHash}${separator}merchantId=${encodeURIComponent(merchantId)}${hash}`;
}

/**
 * Builds a same-site navigation target without granting access from the URL.
 * Merchant selection remains an untrusted BFF-verified recovery parameter.
 */
export function buildBusinessNavigationTarget(
  currentLocation: string,
  destination: string,
): string | null {
  const target = parseInternalRelativeNavigation(destination);
  if (!target) return null;

  const current = parseInternalRelativeNavigation(currentLocation);
  if (
    !current
    || !isWorkbenchPath(current.pathname)
    || !isWorkbenchPath(target.pathname)
    || target.searchParams.has("merchantId")
  ) {
    return destination;
  }

  const merchantId = merchantIdFrom(current);
  return merchantId === null ? destination : appendMerchantId(destination, merchantId);
}
