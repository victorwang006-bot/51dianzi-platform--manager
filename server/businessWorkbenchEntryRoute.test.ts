import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8"
);
const workbench = readFileSync(
  new URL("../client/src/business/BusinessWorkbenchPage.tsx", import.meta.url),
  "utf8"
);
const chunks = readFileSync(
  new URL("../client/src/lib/adminRouteChunks.ts", import.meta.url),
  "utf8"
);
const layout = readFileSync(
  new URL("../client/src/components/DashboardLayout.tsx", import.meta.url),
  "utf8"
);

describe("原工作台根入口路由完整性", () => {
  it("/workbench 真实注册且位于原 AuthGate 内，不能仅有子页面而让根入口掉入404", () => {
    const gate = app.indexOf("<AuthGate>");
    const root = app.indexOf(
      '<Route path={"/workbench"} component={BusinessWorkbenchRoute} />'
    );
    const child = app.search(
      /<Route\s+path=\{"\/workbench\/inventory"\}\s+component=\{BusinessWorkbenchRoute\}\s*\/>/
    );
    const fallback = app.indexOf("<Route component={NotFoundRoute} />");
    const close = app.indexOf("</AuthGate>", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(gate);
    expect(child).toBeGreaterThan(root);
    expect(fallback).toBeGreaterThan(child);
    expect(close).toBeGreaterThan(fallback);
    expect(app).toContain('<LazyBusinessWorkbench routeBase="/workbench" />');
    expect(workbench).toContain('path="/"');
  });

  it.each(["/teams", "/role-templates", "/permission-audit"])(
    "%s 注册真实Organization页面、组织chunk且保留原AuthGate和admins.manage保护",
    path => {
      const gate = app.indexOf("<AuthGate>");
      const route = app.indexOf(
        `<Route path={"${path}"} component={OrganizationRoute} />`
      );
      const fallback = app.indexOf("<Route component={NotFoundRoute} />");
      const close = app.indexOf("</AuthGate>", gate);
      expect(gate).toBeGreaterThan(-1);
      expect(route).toBeGreaterThan(gate);
      expect(fallback).toBeGreaterThan(route);
      expect(close).toBeGreaterThan(fallback);
      expect(app).toMatch(
        /const OrganizationRoute = \(\) => \(\s*<PermissionGate permission="admins.manage">\s*<LazyScreen>\s*<LazyOrganization\s*\/>\s*<\/LazyScreen>\s*<\/PermissionGate>/
      );
      expect(chunks).toContain(
        'organization: () => import("@/pages/Organization")'
      );
      expect(chunks).toContain(
        "export const LazyOrganization = lazy(pageLoaders.organization)"
      );
      expect(layout).toMatch(
        new RegExp(
          `path: "${path}", permission: "admins.manage", chunk: "organization"`
        )
      );
    }
  );
});
