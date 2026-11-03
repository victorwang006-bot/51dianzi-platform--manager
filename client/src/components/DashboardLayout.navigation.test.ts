// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const runtime = vi.hoisted(() => ({
  user: {
    id: 6001,
    role: "admin",
    name: "真实员工",
    adminRole: "operation",
    hasNativeAdminAccount: true,
    permissions: ["materials.read", "messages.read"],
  } as Record<string, unknown>,
  capabilities: [] as string[],
  location: "/materials",
  status: "ready",
  refetch: vi.fn(async () => ({})),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: runtime.user, loading: false, logout: () => {} }),
}));
vi.mock("wouter", () => ({ useLocation: () => [runtime.location, () => {}] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        business: { navigation: { query: () => Promise.resolve({}) } },
      },
      moduleNotification: {
        summary: {
          cancel: async () => {},
          getData: () => undefined,
          setData: () => {},
          invalidate: async () => {},
        },
      },
    }),
    message: { unreadCount: { useQuery: () => ({ data: { total: 7 } }) } },
    moduleNotification: {
      summary: {
        useQuery: () => ({
          data: {
            counts: { merchants: 0, orders: 0, reviews: 0, portalUsers: 0 },
          },
        }),
      },
      markSeen: { useMutation: () => ({ mutate: () => {} }) },
    },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isPending: false,
    isSuccess: true,
    isError: false,
    data: {},
    isFetching: false,
    refetch: runtime.refetch,
  }),
}));
vi.mock("@/lib/businessNavigationQuery", () => ({
  getBusinessNavigationQueryKey: (id: unknown) => ["business-navigation", id],
  shouldRetryBusinessNavigation: () => false,
  getBusinessNavigationDisplayState: () => ({
    status: runtime.status,
    workbenchCapabilities: runtime.capabilities,
  }),
}));
vi.mock("@/lib/adminRouteChunks", () => ({ preloadAdminRoute: () => {} }));
vi.mock("./Logo", () => ({ Logo: () => createElement("span", null, "Logo") }));

import DashboardLayout from "./DashboardLayout";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

function renderLayout() {
  return renderToStaticMarkup(
    createElement(
      DashboardLayout,
      null,
      createElement("article", { "data-real-content": "yes" }, "真实业务页面")
    )
  );
}

const source = readFileSync(
  path.resolve(process.cwd(), "client/src/components/DashboardLayout.tsx"),
  "utf8"
);
const shellCss = readFileSync(
  path.resolve(process.cwd(), "client/src/components/DashboardLayout.css"),
  "utf8"
);

describe("正式后台顶部布局集成", () => {
  beforeEach(() => {
    runtime.location = "/materials";
    runtime.status = "ready";
    runtime.refetch.mockClear();
  });

  it.each(["/", "/materials", "/workbench", "/staff"])(
    "retains a working global retry at %s and removes only the error after recovery",
    async location => {
      runtime.location = location;
      runtime.status = "error";
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const content = () =>
        createElement(
          DashboardLayout,
          null,
          createElement(
            "article",
            { "data-real-content": "yes" },
            "真实业务页面"
          )
        );
      try {
        await act(async () => root.render(content()));
        const button = container.querySelector<HTMLButtonElement>(
          'button[aria-label="只读重新获取业务导航"]'
        );
        expect(button).not.toBeNull();
        const retained = container.querySelector("[data-real-content]");
        await act(async () => button!.click());
        expect(runtime.refetch).toHaveBeenCalledTimes(1);
        runtime.status = "ready";
        await act(async () => root.render(content()));
        expect(
          container.querySelector('[data-business-navigation-state="error"]')
        ).toBeNull();
        expect(container.querySelector("[data-real-content]")).toBe(retained);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    }
  );
  it("renders the original real page full-width without sidebar DOM", () => {
    const html = renderLayout();
    expect(html).toContain('data-admin-layout="top-two-level-v1"');
    expect(html).toContain("真实业务页面");
    expect(html).toContain('aria-label="工作区切换"');
    expect(html).not.toContain("data-sidebar=");
    expect(html).not.toContain("切换示例身份");
  });

  it("does not invent business or organization access for an operations-only account", () => {
    const html = renderLayout();
    expect(html).toContain("平台运营");
    expect(html).toContain("物料数据库");
    expect(html).toContain('data-workspace-nav-target="/materials"');
    expect(html).not.toContain('data-workspace-nav-target="/"');
    expect(html).not.toContain(">业务工作台<");
    expect(html).not.toContain(">组织与权限<");
    expect(html).not.toContain(">员工与权限<");
  });

  it("keeps real notification badges", () => {
    expect(renderLayout()).toContain("7 条未读");
    expect(renderLayout()).toContain("消息中心");
  });

  it("retains native admin and staff capability filtering rather than demo authorization", () => {
    expect(source).toContain(
      "hasAdminPermission(adminRole, item.permission, adminPermissions)"
    );
    expect(source).toContain("user?.hasNativeAdminAccount !== true");
    expect(source).toContain("hasBusinessWorkbenchCapability(");
    expect(source).toContain("hasFallbackWorkbenchPermission");
    expect(source).not.toContain("createInitialState");
    expect(source).not.toContain("PreviewSessionBoundary");
  });

  it("reuses merchant-aware navigation and the existing explicit official-channel boundary", () => {
    expect(source).toContain("buildBusinessNavigationTarget(");
    expect(source).toContain(
      "`${window.location.pathname}${window.location.search}`"
    );
    expect(source).toContain('item.path === "/workbench/channel-inventory"');
    expect(source).toContain(
      "if (navigationTarget !== null) setLocation(navigationTarget)"
    );
  });

  it("does not add keys or replace the existing content element on navigation", () => {
    expect(source).toContain("{children}");
    expect(source).not.toMatch(/<main[^>]*\bkey=/);
    expect(source).not.toContain("window.location.reload");
    expect(source).not.toContain("setSidebarWidth");
  });

  it("keeps the original content typography untouched", () => {
    expect(shellCss).not.toMatch(
      /font(?:-family|-size|-weight)?\s*:|line-height\s*:/
    );
    expect(shellCss).toContain("min-width: 0");
    expect(shellCss).toContain("width: 100%");
  });

  it("uses a top-navigation loading skeleton without a sidebar placeholder", () => {
    const html = renderToStaticMarkup(createElement(DashboardLayoutSkeleton));
    expect(html).toContain("正在加载后台");
    expect(html).not.toContain("w-[280px]");
    expect(html).not.toContain("border-r");
  });
});
