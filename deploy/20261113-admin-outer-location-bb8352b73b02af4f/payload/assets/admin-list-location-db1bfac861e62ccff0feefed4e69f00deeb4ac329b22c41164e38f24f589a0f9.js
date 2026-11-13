// client/src/lib/channelInventoryNavigation.ts
var CHANNEL_INVENTORY_ROUTE = "/workbench/channel-inventory";

// client/src/components/admin/adminListLocationLayout.ts
function getAdminListLocationLayout(location, labels) {
  const pathname = location.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (!labels.length) return void 0;
  if (pathname === "/workbench/customers") return "root-hidden";
  if ((pathname === "/workbench" || pathname === CHANNEL_INVENTORY_ROUTE) && labels.length === 1) {
    return "root-hidden";
  }
  if (["/merchants", "/staff", "/admins"].includes(pathname)) return "list-breadcrumb";
  return void 0;
}
export {
  getAdminListLocationLayout
};
