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
  setLocation: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: runtime.user, loading: false, logout: () => {} }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [runtime.location.split("?", 1)[0], runtime.setLocation],
  useSearch: () => runtime.location.includes("?") ? runtime.location.slice(runtime.location.indexOf("?") + 1) : "",
}));
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

async function withMountedLayout(action: (container: HTMLDivElement) => Promise<void>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DashboardLayout, null,
      createElement("article", { "data-real-content": "yes" }, "真实业务页面"))));
    await action(container);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
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
    runtime.setLocation.mockReset();
    runtime.capabilities = [];
    runtime.user = { id: 6001, role: "admin", name: "真实员工", adminRole: "operation", hasNativeAdminAccount: true, permissions: ["materials.read", "messages.read"] };
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
    expect(html).toContain('data-workspace-nav-target="operations"');
    expect(html).not.toContain('data-workspace-nav-target="business"');
    expect(html).not.toContain('data-workspace-nav-target="channel"');
    expect(html).not.toContain('data-workspace-nav-target="organization"');
    expect(html).not.toContain('data-workspace-nav-target="/"');
    expect(html).not.toContain(">业务工作台<");
    expect(html).not.toContain(">组织与权限<");
    expect(html).not.toContain(">员工与权限<");
  });

  it("keeps real notification badges inside the operations dropdown", async () => {
    await withMountedLayout(async container => {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-workspace-nav-target="operations"]')!.click());
      expect(container.querySelector('[aria-label="7 条未读"]')?.textContent).toBe("7");
      expect(container.textContent).toContain("消息中心");
      expect(container.querySelector('[data-workspace-dropdown-item="/materials"]')).not.toBeNull();
      expect(container.querySelector('[data-admin-navigation="module-tabs"]')).toBeNull();
    });
  });

  it("shows native staff channel entry in the dropdown only with exact native read and the bound route capability", async () => {
    runtime.location = "/workbench/channel-inventory";
    runtime.capabilities = ["inventory.channel"];
    runtime.user.permissions = ["materials.read", "messages.read", "officialInventory.read"];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    try {
      await act(async () => root.render(createElement(DashboardLayout, null, createElement("article", { "data-real-content": "yes" }, "渠道库存与渠道档案"))));
      expect(container.querySelector('[data-admin-navigation="module-tabs"]')).toBeNull();
      const trigger = container.querySelector<HTMLButtonElement>('[data-workspace-nav-target="channel"]')!;
      expect(trigger.getAttribute("aria-current")).toBe("location");
      expect(container.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
      await act(async () => trigger.click());
      const item = container.querySelector<HTMLButtonElement>('[data-channel-tab="materials"]')!;
      expect(item).not.toBeNull();
      expect(item.getAttribute("aria-current")).toBe("page");
      expect(container.querySelectorAll('[data-channel-tab]')).toHaveLength(4);
      await act(async () => container.querySelector<HTMLButtonElement>('[data-channel-tab="trash"]')!.click());
      expect(runtime.setLocation).toHaveBeenCalledWith("/workbench/channel-inventory?ciTab=trash");
      expect(container.querySelector("[data-real-content]")?.textContent).toBe("渠道库存与渠道档案");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(runtime.user.permissions).toEqual(["materials.read", "messages.read", "officialInventory.read"]);
    expect(source).toMatch(/path: "\/workbench\/channel-inventory",\s*workbenchCapability: "inventory.channel"/);
    expect(source).not.toContain('permission: "officialInventory.write"');
  });

  it.each([{ permissions: ["materials.read"] }, { permissions: ["officialInventory.write"] }])("rejects route capability without independent native read $permissions", ({ permissions }) => {
    runtime.location = "/workbench/channel-inventory";
    runtime.capabilities = ["inventory.channel"];
    runtime.user.permissions = permissions;
    expect(renderLayout()).not.toContain('data-workspace-nav-target="channel"');
  });

  it.each([[], ["inventory.read"], ["inventory.publish"]])("does not substitute another business capability %j for inventory.channel", capabilities => {
    runtime.location = "/workbench/channel-inventory";
    runtime.capabilities = capabilities;
    runtime.user.permissions = ["officialInventory.read"];
    expect(renderLayout()).not.toContain('data-workspace-nav-target="channel"');
  });

  it("does not treat a platform official inventory permission as a bound business capability", () => {
    runtime.location = "/workbench/channel-inventory";
    runtime.user.permissions = ["officialInventory.read", "officialInventory.write"];
    expect(renderLayout()).not.toContain('data-workspace-nav-target="channel"');
  });

  it("still requires a native active backend login before displaying the staff channel entry", () => {
    runtime.location = "/workbench/channel-inventory";
    runtime.capabilities = ["inventory.channel"];
    runtime.user.hasNativeAdminAccount = false;
    expect(renderLayout()).not.toContain('data-workspace-nav-target="channel"');
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

  it("keeps workspace tabs immediately after the original brand and the account at the far right", () => {
    const element = document.createElement("div");
    element.innerHTML = renderLayout();
    const header = element.querySelector(".admin-workspace-shell__header")!;
    const brand = header.querySelector(".admin-workspace-shell__brand")!;
    expect(brand.textContent).toContain("51电子网");
    expect(brand.textContent).toContain("后台管理系统");
    expect(brand.nextElementSibling?.classList.contains("admin-workspace-nav__tabs--workspaces")).toBe(true);
    expect(header.lastElementChild?.classList.contains("admin-workspace-shell__account")).toBe(true);
    expect(shellCss).toMatch(/\.admin-workspace-shell__header\s*\{[^}]*display: flex;/);
    expect(shellCss).toMatch(/\.admin-workspace-shell__account\s*\{\s*margin-left: auto;/);
    expect(shellCss).not.toContain("justify-content: center");
    const moduleCss = readFileSync(path.resolve(process.cwd(), "client/src/components/admin/AdminWorkspaceNavigation.css"), "utf8");
    expect(moduleCss).toMatch(/\.admin-workspace-nav__tabs--modules\s*\{[^}]*padding: 0 24px;/);
    expect(moduleCss).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.admin-workspace-nav__tabs--modules\s*\{\s*padding: 0 16px;/);
    expect(shellCss).toMatch(/\.admin-workspace-shell__header\s*\{[^}]*padding: 0 24px;/);
    expect(shellCss).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.admin-workspace-shell__header\s*\{[^}]*padding: 0 16px;/);
  });

  it("makes the original Logo a keyboard-accessible home link and navigates to channel inventory", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    runtime.setLocation.mockClear();
    act(() => root.render(createElement(DashboardLayout, null, createElement("article", null, "业务内容"))));
    const brand = host.querySelector<HTMLAnchorElement>("a.admin-workspace-shell__brand")!;
    expect(brand.getAttribute("href")).toBe("/workbench/channel-inventory");
    expect(brand.getAttribute("aria-label")).toContain("渠道库存");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => brand.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(runtime.setLocation).toHaveBeenCalledWith("/workbench/channel-inventory");
    runtime.setLocation.mockClear();
    const alternateClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    act(() => brand.dispatchEvent(alternateClick));
    expect(alternateClick.defaultPrevented).toBe(false);
    expect(runtime.setLocation).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it("uses a top-navigation loading skeleton without a sidebar placeholder", () => {
    const html = renderToStaticMarkup(createElement(DashboardLayoutSkeleton));
    expect(html).toContain("正在加载后台");
    expect(html).not.toContain("w-[280px]");
    expect(html).not.toContain("border-r");
  });
});
