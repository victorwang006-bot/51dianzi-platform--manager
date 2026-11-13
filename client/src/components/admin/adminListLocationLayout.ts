import { CHANNEL_INVENTORY_ROUTE } from "../../lib/channelInventoryNavigation";

/** Geometry only: the caller retains authorization, labels and route context.
 * Use the original pathname, never the canonical module path (details share it).
 * Existing inventory labels are the source of truth for tab/view context.
 */
export function getAdminListLocationLayout(
  location: string,
  labels: readonly string[],
): "root-hidden" | "list-breadcrumb" | undefined {
  const pathname = location.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (!labels.length) return undefined;
  if (pathname === "/workbench/customers") return "root-hidden";
  if ((pathname === "/workbench" || pathname === CHANNEL_INVENTORY_ROUTE) && labels.length === 1) {
    return "root-hidden";
  }
  if (["/merchants", "/staff", "/admins"].includes(pathname)) return "list-breadcrumb";
  return undefined;
}
