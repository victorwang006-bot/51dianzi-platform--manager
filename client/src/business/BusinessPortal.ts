const BUSINESS_PORTAL_ROOT_ID = "business-native-portals";

/**
 * Returns a portal target only while the business frame is mounted. Radix falls
 * back to document.body during SSR/initial non-browser rendering.
 */
export function businessPortalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById(BUSINESS_PORTAL_ROOT_ID) ?? undefined;
}

export { BUSINESS_PORTAL_ROOT_ID };
