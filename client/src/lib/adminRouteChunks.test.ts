import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const chunksSource = readFileSync("client/src/lib/adminRouteChunks.ts", "utf8");
const dashboardSource = readFileSync(
  "client/src/components/DashboardLayout.tsx",
  "utf8"
);
const navigationSource = readFileSync("client/src/components/admin/AdminWorkspaceNavigation.tsx", "utf8");

const pages = [
  "Login",
  "Materials",
  "Merchants",
  "MerchantDetail",
  "Messages",
  "PortalUsers",
  "Admins",
  "Staff",
  "Orders",
  "Profile",
  "ExceptionLogs",
  "Reviews",
  "Analytics",
  "OfficialChannelInventory",
  "NotFound",
] as const;

describe("后台首屏分片契约", () => {
  it("登录页和每个后台路由都使用动态导入，App 不再静态导入页面", () => {
    for (const page of pages) {
      expect(chunksSource).toContain(`import("@/pages/${page}")`);
      expect(appSource).toContain(`Lazy${page}`);
      expect(appSource).not.toContain(`from "./pages/${page}"`);
      expect(appSource).not.toContain(`from "@/pages/${page}"`);
    }
    expect(appSource).toContain("Suspense");
    expect(appSource).toMatch(/<LazyLogin\s*\/>/);
    expect(chunksSource).toContain(
      'import("@/business/BusinessWorkbenchPage")'
    );
    expect(appSource).toContain("LazyBusinessWorkbench");
  });

  it("统一注册工作台业务路径，且不从浏览器侧推断商户身份", () => {
    const normalizedAppSource = appSource.replace(/\s+/g, "");
    const workbenchRoutes = [
      ["/workbench/inbound", "BusinessWorkbenchRoute"],
      ["/workbench/channel-inventory", "BusinessWorkbenchRoute"],
      ["/workbench/customers/:id", "BusinessWorkbenchRoute"],
      ["/workbench/customers", "BusinessWorkbenchRoute"],
      ["/workbench/customer-demands", "BusinessWorkbenchRoute"],
      ["/workbench/orders", "BusinessWorkbenchRoute"],
      ["/workbench/outbound", "BusinessWorkbenchRoute"],
      ["/workbench/inquiries", "BusinessWorkbenchRoute"],
      ["/workbench/chat", "BusinessWorkbenchRoute"],
      ["/workbench/procurement-demands", "BusinessWorkbenchRoute"],
      ["/workbench/procurement-orders/quote", "BusinessWorkbenchRoute"],
      ["/workbench/procurement-orders/accepted", "BusinessWorkbenchRoute"],
      ["/workbench/procurement-orders/create", "BusinessWorkbenchRoute"],
      ["/workbench/procurement-orders", "BusinessWorkbenchRoute"],
      ["/workbench/add-user", "BusinessWorkbenchRoute"],
      ["/workbench/user-records", "BusinessWorkbenchRoute"],
      ["/workbench/company-info", "BusinessWorkbenchRoute"],
      ["/workbench/demand-quotes", "BusinessWorkbenchRoute"],
      ["/workbench/procurement/demands", "BusinessWorkbenchRoute"],
    ] as const;

    for (const [path, component] of workbenchRoutes) {
      expect(normalizedAppSource).toContain(
        `<Routepath={"${path}"}component={${component}}/>`
      );
    }
    expect(appSource).toContain("getClosedAdminEntryNavigationTarget(");
    expect(appSource).toContain("if (closedEntryTarget)");
    expect(normalizedAppSource).not.toContain('<Routepath={"/workbench"}component={BusinessWorkbenchRoute}/>');
    expect(dashboardSource).not.toContain('path: "/workbench/customer-demands"');
    expect(appSource).toContain('routeBase="/workbench"');
    expect(appSource).toContain("merchantId is intentionally not inferred");
    // B01: independent BFF scope/binding, not auth.me native permission keys,
    // decides every workbench route. An approved merchant_mgr has no business.*
    // native key, while a native super_admin with no scope still fails in BFF.
    expect(appSource).toContain("function BusinessWorkbenchRoute()");
    expect(appSource).toContain("selected merchant's scope/binding/context");
    expect(appSource).not.toContain("BusinessInventoryRoute");
    expect(appSource).not.toContain("BusinessCustomersRoute");
    expect(appSource).not.toContain("BusinessOrdersRoute");
    expect(appSource).not.toContain("BusinessProcurementRoute");
    expect(appSource).not.toContain("BusinessUsersRoute");
    expect(appSource).not.toContain('permission="business.inventory.read"');
    expect(appSource).not.toContain('permission="business.customers.read"');
    expect(appSource).not.toContain('permission="business.orders.read"');
    expect(appSource).not.toContain('permission="business.procurement.read"');
    expect(appSource).not.toContain('permission="business.users.read"');
    expect(appSource).toContain('<PermissionGate permission="materials.read">');
    expect(appSource).toContain('<PermissionGate permission="admins.manage">');
    expect(appSource).toContain(
      '<PermissionGate permission="officialInventory.read">'
    );
    expect(normalizedAppSource).toContain(
      'path={"/workbench/channel-inventory"}component={BusinessWorkbenchRoute}'
    );
    expect(normalizedAppSource).not.toContain(
      'path={"/workbench/channel-inventory"}component={OfficialChannelInventoryRoute}'
    );
  });

  it("未认证门卫不挂载或预取后台页面，权限判断仍在懒加载页面之前", () => {
    expect(appSource).toMatch(/if\s*\(!user\)\s*return\s*<RouteFallback\s*\/>/);
    expect(appSource).toMatch(
      /if\s*\(\s*hasRequiredNativeAccount\s*&&\s*hasAdminPermission\(\s*role,\s*permission,\s*permissions\s*\)\s*\)/
    );
    expect(appSource).toMatch(
      /!permission\.startsWith\("official"\)\s*\|\|\s*user\?\.hasNativeAdminAccount\s*===\s*true/
    );
    expect(appSource).toMatch(
      /return\s*\(\s*<LazyScreen>\s*<LazyForbidden\s*\/>\s*<\/LazyScreen>\s*\)/
    );
    expect(appSource).toContain("业务页面不会在未认证状态下挂载或预加载");
  });

  it("预取仅由已授权菜单的指针或键盘意图触发，且有硬上限", () => {
    expect(chunksSource).toContain("MAX_ADMIN_ROUTE_PREFETCHES = 2");
    expect(chunksSource).toContain(
      "prefetchedNavigationChunks.size >= MAX_ADMIN_ROUTE_PREFETCHES"
    );
    // Native operation/system entries retain their old authorization source;
    // workbench navigation deliberately stays on the separate BFF projection.
    const normalizedDashboard = dashboardSource.replace(/\s+/g, "");
    expect(normalizedDashboard).toContain(
      "hasAdminPermission(adminRole,item.permission,adminPermissions)"
    );
    expect(normalizedDashboard).toContain(
      "hasBusinessWorkbenchCapability(workbenchCapabilities,item.workbenchCapability)"
    );
    expect(normalizedDashboard).toContain(
      "hasBusinessWorkbenchCapability(workbenchCapabilities,item.fallbackWorkbenchCapability)"
    );
    expect(normalizedDashboard).toContain(
      "hasNativeAdminPermission||hasWorkbenchPermission||hasFallbackWorkbenchPermission"
    );
    expect(dashboardSource).toContain('path: "/staff"');
    expect(dashboardSource).toContain('chunk: "staff"');
    expect(dashboardSource).toContain("if (item.chunk) preloadAdminRoute(item.chunk)");
    expect(dashboardSource).toContain("items={visibleMenuItems}");
    expect(dashboardSource).toContain("onPreload={preloadItem}");
    expect(navigationSource).toContain("onPointerEnter=");
    expect(navigationSource).toContain("onFocus={() => (onPreload ?? onItemIntent)?.(item)}");
    expect(navigationSource).toContain("(onPreload ?? onItemIntent)?.(item)");
    expect(dashboardSource).not.toContain("requestIdleCallback");
  });
});
