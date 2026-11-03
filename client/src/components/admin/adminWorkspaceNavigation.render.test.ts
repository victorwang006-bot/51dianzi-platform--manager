// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import {
  AdminModuleTabs,
  AdminWorkspaceNavigation,
  AdminWorkspaceTabs,
} from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS } from "./adminWorkbenchNavigationModel";

const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(
  group => group.paths
).map(path => ({ path, label: path }));
let host: HTMLDivElement;
let root: Root;
const onNavigate = vi.fn();
const onPreload = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  onNavigate.mockReset();
  onPreload.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(location: string, visibleItems = items) {
  await act(async () =>
    root.render(
      createElement(AdminWorkspaceNavigation, {
        items: visibleItems,
        location,
        onNavigate,
        onPreload,
      })
    )
  );
}

function button(target: string) {
  const result = Array.from(
    host.querySelectorAll<HTMLButtonElement>("button")
  ).find(candidate => candidate.dataset.workspaceNavTarget === target);
  if (!result) throw new Error(`Missing button ${target}`);
  return result;
}

describe("两行正式导航组件", () => {
  it("顶层切换只调用父导航首个可见条目，不先修改本地选中态", async () => {
    const subset = items.filter(item =>
      ["/workbench/company-info", "/analytics", "/staff"].includes(item.path)
    );
    await render("/staff", subset);
    await act(async () => button("business").click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      subset.find(item => item.path === "/workbench/company-info")
    );
    expect(button("organization").getAttribute("aria-current")).toBe(
      "location"
    );
    expect(button("business").hasAttribute("aria-current")).toBe(false);
    await render("/workbench/company-info?merchantId=8", subset);
    expect(button("business").getAttribute("aria-current")).toBe("location");
    expect(button("/workbench/company-info").getAttribute("aria-current")).toBe(
      "page"
    );
  });

  it("没有许可的工作区不显示，完全无菜单不渲染导航按钮", async () => {
    await render(
      "/analytics",
      items.filter(item => item.path === "/analytics")
    );
    expect(
      host.querySelectorAll('[data-admin-navigation="workspace-tabs"] button')
    ).toHaveLength(1);
    expect(button("operations").disabled).toBe(false);
    expect(host.textContent).not.toContain("组织与权限");
    await render("/profile", []);
    expect(host.querySelectorAll("nav, button")).toHaveLength(0);
  });

  it("深层真实业务路由更新选中态；组织别名和个人资料不创建假模块", async () => {
    await render("/workbench/procurement-orders/accepted?merchantId=3");
    expect(
      button("/workbench/procurement-orders").getAttribute("aria-current")
    ).toBe("page");
    await render("/admins/8");
    expect(button("/staff").getAttribute("aria-current")).toBe("page");
    expect(
      host.querySelector('[data-workspace-nav-target="/admins"]')
    ).toBeNull();
    await render("/profile");
    expect(button("organization").getAttribute("aria-current")).toBe(
      "location"
    );
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(
      host.querySelectorAll('[data-admin-navigation="module-tabs"] button')
    ).toHaveLength(5);
    expect(
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          '[data-admin-navigation="module-tabs"] button'
        )
      ).map(node => node.dataset.workspaceNavTarget)
    ).toEqual([
      "/staff",
      "/teams",
      "/role-templates",
      "/permission-audit",
      "/workbench/user-records",
    ]);
  });

  it.each(["/teams", "/role-templates", "/permission-audit"])(
    "%s 真实组织路由严格选中对应模块并尊重过滤后权限",
    async path => {
      await render(`${path}?tab=details`);
      expect(button("organization").getAttribute("aria-current")).toBe(
        "location"
      );
      expect(button(path).getAttribute("aria-current")).toBe("page");
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      await act(async () => button(path).click());
      expect(onNavigate).toHaveBeenCalledWith(
        items.find(item => item.path === path)
      );
      await render(
        path,
        items.filter(item => item.path === "/staff")
      );
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
      expect(
        host.querySelector(`[data-workspace-nav-target="${path}"]`)
      ).toBeNull();
    }
  );

  it("详情路径传给原renderItem的isActive仍严格命中原模块", async () => {
    await act(async () =>
      root.render(
        createElement(AdminModuleTabs, {
          items,
          location: "/workbench/customers/88?merchantId=3",
          onNavigate,
          renderItem: (item, state) =>
            createElement(
              "span",
              {
                "data-is-module-active": String(state.isActive),
              },
              item.label
            ),
        })
      )
    );
    expect(
      button("/workbench/customers")
        .querySelector("[data-is-module-active]")
        ?.getAttribute("data-is-module-active")
    ).toBe("true");
    expect(
      button("/workbench/orders")
        .querySelector("[data-is-module-active]")
        ?.getAttribute("data-is-module-active")
    ).toBe("false");
    expect(
      host.querySelectorAll('[data-is-module-active="true"]')
    ).toHaveLength(1);
  });

  it("二级菜单复用父回调原条目，保留徽标、预加载并提供内容 renderItem", async () => {
    await act(async () =>
      root.render(
        createElement(AdminModuleTabs, {
          items,
          location: "/messages",
          onNavigate,
          onPreload,
          renderItem: (item, state) =>
            createElement(
              "span",
              { "data-active-label": String(state.isActive) },
              item.label
            ),
          renderBadge: item =>
            item.path === "/messages"
              ? createElement("span", { "data-unread": true }, "8")
              : null,
        })
      )
    );
    const message = button("/messages");
    expect(message.querySelector("[data-unread]")?.textContent).toBe("8");
    expect(
      message
        .querySelector("[data-active-label]")
        ?.getAttribute("data-active-label")
    ).toBe("true");
    expect(message.querySelector("button, a")).toBeNull();
    await act(async () => {
      message.focus();
      message.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      items.find(item => item.path === "/messages")
    );
    expect(onPreload).toHaveBeenCalledWith(
      items.find(item => item.path === "/messages")
    );
  });

  it("首层可独立置于 header，方向键/Home/End 仅移动焦点不导航", async () => {
    await act(async () =>
      root.render(
        createElement(AdminWorkspaceTabs, {
          items,
          location: "/staff",
          onNavigate,
        })
      )
    );
    await act(async () => {
      button("business").focus();
      button("business").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });
    expect(document.activeElement).toBe(button("operations"));
    await act(async () =>
      button("operations").dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(button("organization"));
    await act(async () =>
      button("organization").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(button("business"));
    await act(async () =>
      button("business").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(button("business"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("权限撤回后移除原工作区和模块，不将其他菜单错误设为当前页", async () => {
    await render("/staff");
    expect(button("organization").getAttribute("aria-current")).toBe(
      "location"
    );
    await render(
      "/staff",
      items.filter(item => item.path === "/analytics")
    );
    expect(
      host.querySelector('[data-workspace-nav-target="organization"]')
    ).toBeNull();
    expect(
      host.querySelector('[data-admin-navigation="module-tabs"]')
    ).toBeNull();
    expect(host.querySelector("[aria-current]")).toBeNull();
  });

  it("当前工作区点击不重置详情或 query，切换其他工作区才导航首个可见模块", async () => {
    await render("/workbench/customers/88?merchantId=3");
    await act(async () => button("business").click());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(button("/workbench/customers").getAttribute("aria-current")).toBe(
      "page"
    );
    await act(async () => button("operations").click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      items.find(item => item.path === "/merchants")
    );
  });

  it("CSS 仅限定新导航，保持原模块文字、蓝线和局部横滚契约", () => {
    const css = readFileSync(
      `${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`,
      "utf8"
    );
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("max-width: 100%");
    expect(css).toContain("min-width: 0");
    expect(css).toMatch(
      /\.admin-workspace-nav__module\s*\{[^}]*font-size: 13px;[^}]*font-weight: 400;[^}]*line-height: 40px;/
    );
    expect(css).toMatch(
      /\.admin-workspace-nav__module\[data-active="true"\]\s*\{\s*font-weight: 500;/
    );
    expect(css).toContain("border-bottom-color: #185fa5");
    expect(css).toContain(":focus-visible");
  });
});
