import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const chunksSource = readFileSync("client/src/lib/adminRouteChunks.ts", "utf8");
const dashboardSource = readFileSync(
  "client/src/components/DashboardLayout.tsx",
  "utf8"
);

const pages = [
  "Login",
  "Materials",
  "Merchants",
  "MerchantDetail",
  "Messages",
  "PortalUsers",
  "Admins",
  "Orders",
  "Profile",
  "ExceptionLogs",
  "Reviews",
  "Analytics",
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
  });

  it("未认证门卫不挂载或预取后台页面，权限判断仍在懒加载页面之前", () => {
    expect(appSource).toMatch(/if\s*\(!user\)\s*return\s*<RouteFallback\s*\/>/);
    expect(appSource).toContain(
      "if (hasAdminPermission(role, permission, permissions))"
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
    expect(dashboardSource).toMatch(
      /group\.items\s*\.filter\(item\s*=>\s*hasAdminPermission/
    );
    expect(dashboardSource).toMatch(
      /onPointerEnter=\{\(\)\s*=>\s*preloadAdminRoute\(item\.chunk\)\s*\}/
    );
    expect(dashboardSource).toMatch(
      /onFocus=\{\(\)\s*=>\s*preloadAdminRoute\(item\.chunk\)\}/
    );
    expect(dashboardSource).not.toContain("requestIdleCallback");
  });
});
