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
import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  getAdminWorkbenchNavigationRoute,
} from "./adminWorkbenchNavigationModel";

const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(
  group => group.paths
).map(path =>
  Object.freeze({
    path,
    label: getAdminWorkbenchNavigationRoute(path)?.label ?? path,
    permission: `permission:${path}`,
    chunk: `chunk:${path}`,
    merchantContext: { merchantId: 31, returnTo: "/orders" },
  })
);
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
      createElement(React.Fragment, null,
        createElement(AdminWorkspaceTabs, { items: visibleItems, location, onNavigate, onPreload }),
        createElement(AdminModuleTabs, { items: visibleItems, location, onNavigate, onPreload })
      )
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

async function click(target: string) {
  await act(async () => button(target).click());
}

async function key(target: string, value: string) {
  await act(async () =>
    button(target).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      })
    )
  );
}

function modulePaths() {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-admin-navigation="module-tabs"] button'
    )
  ).map(node => node.dataset.workspaceNavTarget);
}

describe("保留的ModuleTabs兼容API与新顶栏回归（正式布局不挂载第二行）", () => {
  it("业务兼容菜单三个入口按方案分组，不含公司信息且别名跟随canonical高亮", async () => {
    await render("/workbench/sales-orders?merchantId=31&returnTo=%2Forders");
    expect(modulePaths()).toEqual([
      "group:customers",
      "group:inventory",
      "group:procurement",
    ]);
    expect(button("group:customers").dataset.active).toBe("true");
    expect(button("group:customers").getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(host.querySelector("[data-workspace-nav-child]")).toBeNull();
    await click("group:customers");
    expect(modulePaths()).toEqual([
      "group:customers",
      "/workbench/orders",
      "group:inventory",
      "group:procurement",
    ]);
    expect(button("/workbench/orders").getAttribute("aria-current")).toBe(
      "page"
    );
    expect(onNavigate).not.toHaveBeenCalled();
    await click("group:inventory");
    expect(button("group:customers").getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(
      Array.from(
        host.querySelectorAll<HTMLButtonElement>("[data-workspace-nav-child]")
      ).map(node => node.dataset.workspaceNavTarget)
    ).toEqual([
      "/workbench/inbound",
      "/workbench/outbound",
    ]);
    await act(async () => {
      button("/workbench/inbound").focus();
      button("/workbench/inbound").click();
    });
    const original = items.find(item => item.path === "/workbench/inbound");
    expect(onNavigate.mock.calls[0][0]).toBe(original);
    expect(onPreload.mock.calls[0][0]).toBe(original);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0].merchantContext).toBe(
      original?.merchantContext
    );
    expect(host.querySelector("[data-workspace-nav-child]")).toBeNull();
    const subset = items.filter(item =>
      [
        "/workbench/inbound",
        "/workbench/orders",
        "/workbench/company-info",
      ].includes(item.path)
    );
    await render("/workbench/inbound?merchantId=31", subset);
    expect(modulePaths()).toEqual([
      "group:customers",
      "group:inventory",
    ]);
    expect(button("group:inventory").dataset.active).toBe("true");
    await click("group:inventory");
    expect(button("/workbench/inbound").getAttribute("aria-current")).toBe(
      "page"
    );
  });

  it("仅点击展开且一次只有一组，重复点击及外部点击关闭", async () => {
    await render("/workbench/orders");
    await act(async () =>
      button("group:customers").dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true })
      )
    );
    expect(button("group:customers").getAttribute("aria-expanded")).toBe(
      "false"
    );
    await click("group:customers");
    const controls = button("group:customers").getAttribute("aria-controls");
    expect(host.querySelector('[role="group"]')?.id).toBe(controls);
    await click("group:inventory");
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="group"]')).toHaveLength(1);
    await click("group:inventory");
    expect(host.querySelector('[role="group"]')).toBeNull();
    await click("group:procurement");
    await act(async () => document.body.click());
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("触屏原生按钮可点击，触屏外点关闭，不依赖悬停", async () => {
    await render("/workbench/inventory");
    await act(async () => {
      button("group:inventory").dispatchEvent(
        new Event("pointerdown", { bubbles: true })
      );
      button("group:inventory").click();
    });
    expect(button("group:inventory").getAttribute("aria-expanded")).toBe(
      "true"
    );
    await act(async () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    );
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("键盘可展开并在子项循环，Escape关闭恢复父焦点，方向键不导航", async () => {
    await render("/workbench/chat?merchantId=31");
    await act(async () => button("group:inventory").focus());
    await key("group:inventory", "ArrowDown");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "ArrowDown");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    await key("/workbench/inbound", "End");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    await key("/workbench/outbound", "ArrowDown");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "ArrowUp");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    await key("/workbench/outbound", "Home");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "Escape");
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(button("group:inventory"));
    await key("group:inventory", "ArrowUp");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    await key("/workbench/outbound", "Escape");
    await key("group:inventory", " ");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "Escape");
    await key("group:inventory", "Enter");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "Escape");
    await key("group:inventory", "ArrowRight");
    expect(document.activeElement).toBe(button("group:procurement"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Tab保持原生按钮可达，焦点离开导航关闭，不设置键盘陷阱", async () => {
    await render("/workbench/orders");
    await key("group:customers", "ArrowDown");
    expect(button("/workbench/orders").tabIndex).toBe(0);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button("/workbench/orders").dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      await act(async () => outside.focus());
      expect(host.querySelector('[role="group"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it("空组隐藏，隐藏canonical子项的别名不高亮父组或添加授权fallback", async () => {
    const subset = items.filter(item =>
      ["/workbench/inbound", "/workbench/company-info", "/analytics"].includes(
        item.path
      )
    );
    await render("/workbench/chat?merchantId=31", subset);
    expect(modulePaths()).toEqual([
      "group:inventory",
    ]);
    expect(
      host.querySelector(
        '[data-active="true"][data-workspace-nav-target^="group:"]'
      )
    ).toBeNull();
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    await click("group:inventory");
    expect(host.querySelectorAll("[data-workspace-nav-child]")).toHaveLength(1);
    expect(button("/workbench/inbound").disabled).toBe(false);
    await render(
      "/workbench/inbound",
      subset.filter(item => item.path !== "/workbench/inbound")
    );
    expect(modulePaths()).toEqual([]);
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    await render("/workbench/chat", []);
    expect(host.querySelectorAll("nav, button")).toHaveLength(0);
  });

  it.each([
    ["/workbench/chat/88", "inquiries", "/workbench/inquiries"],
    ["/workbench/sales-orders/88", "customers", "/workbench/orders"],
    [
      "/workbench/procurement/demands/8",
      "procurement",
      "/workbench/procurement-demands",
    ],
    [
      "/workbench/procurement/orders/8",
      "procurement",
      "/workbench/procurement-orders",
    ],
    [
      "/workbench/demand-quotes/8",
      "procurement",
      "/workbench/procurement-demands",
    ],
  ])("别名%s严格选中父组%s和原canonical子项", async (location, group, path) => {
    await render(`${location}?merchantId=31#detail`);
    if (group === "inquiries") {
      expect(button("inquiries").dataset.active).toBe("true");
      expect(button("inquiries").getAttribute("aria-current")).toBe("page");
      expect(host.querySelectorAll('[data-active="true"][data-workspace-nav-target^="group:"]')).toHaveLength(0);
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(host.querySelector('[data-workspace-nav-target="/workbench/inquiries"]')).toBeNull(); return;
    }
    expect(button(`group:${group}`).dataset.active).toBe("true");
    expect(
      host.querySelectorAll(
        '[data-active="true"][data-workspace-nav-target^="group:"]'
      )
    ).toHaveLength(1);
    await click(`group:${group}`);
    expect(button(path).getAttribute("aria-current")).toBe("page");
    // This legacy fixture mounts both rows; production uses only the primary.
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("渠道库存仍直达原回调、采购两项回传父原对象，公司信息不再显示", async () => {
    await render("/workbench/company?merchantId=31");
    expect(host.querySelector('[data-workspace-nav-target="/workbench/company-info"]')).toBeNull();
    await click("inventory");
    await click("group:procurement");
    expect(host.querySelectorAll("[data-workspace-nav-child]")).toHaveLength(2);
    await click("/workbench/procurement-demands");
    await click("group:procurement");
    await click("/workbench/procurement-orders");
    expect(onNavigate).toHaveBeenCalledTimes(3);
    [
      "/workbench/channel-inventory",
      "/workbench/procurement-demands",
      "/workbench/procurement-orders",
    ].forEach((path, index) => {
      expect(onNavigate.mock.calls[index][0]).toBe(
        items.find(item => item.path === path)
      );
    });
  });

  it.each([
    ["customers", "/workbench/inquiries"],
    ["customers", "/workbench/orders"],
    ["inventory", "/workbench/inbound"],
    ["inventory", "/workbench/outbound"],
    ["procurement", "/workbench/procurement-demands"],
    ["procurement", "/workbench/procurement-orders"],
  ])(
    "分组%s中的%s严格回调父原对象一次，保留预加载且不自行拼URL",
    async (group, path) => {
      await render("/workbench/orders?merchantId=31&returnTo=%2Forders");
      if (path === "/workbench/inquiries") {
        await act(async () => button("inquiries").focus()); await click("inquiries");
        const original = items.find(item => item.path === path);
        expect(onNavigate).toHaveBeenCalledTimes(1); expect(onNavigate.mock.calls[0][0]).toBe(original);
        expect(onPreload.mock.calls[0][0]).toBe(original);
        expect(button("group:customers").dataset.active).toBe("true");
        expect(host.querySelector('[data-workspace-nav-target="/workbench/inquiries"]')).toBeNull(); return;
      }
      await click(`group:${group}`);
      await act(async () => button(path).focus());
      await click(path);
      const original = items.find(item => item.path === path);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate.mock.calls[0][0]).toBe(original);
      expect(onPreload.mock.calls[0][0]).toBe(original);
      expect(button("group:customers").dataset.active).toBe("true");
      expect(button(`group:${group}`).getAttribute("aria-expanded")).toBe(
        "false"
      );
    }
  );

  it("销售子菜单保留renderItem、徽标和内容状态，没有嵌套交互控件", async () => {
    await act(async () =>
      root.render(
        createElement(AdminModuleTabs, {
          items,
          location: "/workbench/sales-orders?merchantId=31",
          onNavigate,
          onItemIntent: onPreload,
          renderItem: (item, state) =>
            createElement(
              "span",
              { "data-label-active": String(state.isActive) },
              item.label
            ),
          renderBadge: item =>
            item.path === "/workbench/orders"
              ? createElement("span", { "data-business-unread": true }, "3")
              : null,
        })
      )
    );
    await click("group:customers");
    const inquiry = button("/workbench/orders");
    expect(inquiry.querySelector("[data-business-unread]")?.textContent).toBe(
      "3"
    );
    expect(
      inquiry
        .querySelector("[data-label-active]")
        ?.getAttribute("data-label-active")
    ).toBe("true");
    expect(inquiry.querySelector("button, a")).toBeNull();
    await act(async () => inquiry.focus());
    expect(onPreload.mock.calls[0][0]).toBe(
      items.find(item => item.path === "/workbench/orders")
    );
  });

  it("路由与query变化关闭原下拉，窗口resize和导航滚动安全关闭", async () => {
    await render("/workbench/orders?merchantId=31");
    await click("group:customers");
    await render("/workbench/orders?merchantId=32");
    expect(host.querySelector('[role="group"]')).toBeNull();
    await click("group:customers");
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[role="group"]')).toBeNull();
    await click("group:inventory");
    await act(async () =>
      host
        .querySelector('[data-admin-navigation="module-tabs"]')!
        .dispatchEvent(new Event("scroll"))
    );
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it("入库顶层直达原条目，不先修改本地选中态；ModuleTabs兼容API保留", async () => {
    const subset = items.filter(item =>
      ["/workbench/inbound", "/workbench/company-info", "/analytics", "/staff"].includes(item.path)
    );
    await render("/staff", subset);
    await act(async () => button("inventory-management").click());
    expect(button("inventory-management").hasAttribute("aria-expanded")).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      subset.find(item => item.path === "/workbench/inbound")
    );
    expect(button("organization").getAttribute("aria-current")).toBe(
      "location"
    );
    expect(button("inventory-management").hasAttribute("aria-current")).toBe(false);
    await render("/workbench/inbound?merchantId=8", subset);
    expect(button("inventory-management").getAttribute("aria-current")).toBe("page");
    await click("group:inventory");
    expect(button("/workbench/inbound").getAttribute("aria-current")).toBe(
      "page"
    );
  });

  it("没有许可的工作区不显示，完全无菜单不渲染导航按钮", async () => {
    await render(
      "/analytics",
      items.filter(item => item.path === "/analytics")
    );
    expect(
      host.querySelectorAll('[data-admin-navigation="unified-dropdown"] button')
    ).toHaveLength(1);
    expect(button("operations").disabled).toBe(false);
    expect(host.textContent).not.toContain("组织与权限");
    await render("/profile", []);
    expect(host.querySelectorAll("nav, button")).toHaveLength(0);
  });

  it("物料数据库仅在真实运营路径选中，旧根地址不伪造当前模块", async () => {
    await render("/materials?merchantId=8");
    expect(button("operations").getAttribute("aria-current")).toBe("location");
    await click("group:basic-data");
    expect(button("/materials").getAttribute("aria-current")).toBe("page");
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    await act(async () => button("/materials").click());
    expect(onNavigate).toHaveBeenCalledWith(
      items.find(item => item.path === "/materials")
    );
    await render("/");
    expect(host.querySelector("[aria-current]")).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="/"]')).toBeNull();
    await render(
      "/materials",
      items.filter(item => item.path === "/staff")
    );
    expect(host.querySelector("[aria-current]")).toBeNull();
    expect(
      host.querySelector('[data-workspace-nav-target="/materials"]')
    ).toBeNull();
  });

  it("深层业务和组织别名选中真实模块；未授权个人入口不误选组织", async () => {
    await render("/workbench/procurement-orders/accepted?merchantId=3");
    expect(button("group:procurement").dataset.active).toBe("true");
    await click("group:procurement");
    expect(
      button("/workbench/procurement-orders").getAttribute("aria-current")
    ).toBe("page");
    await render("/admins/8");
    expect(button("/staff").getAttribute("aria-current")).toBe("page");
    expect(
      host.querySelector('[data-workspace-nav-target="/admins"]')
    ).toBeNull();
    await render("/profile");
    expect(button("organization").getAttribute("aria-current")).toBeNull();
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(
      host.querySelectorAll('[data-admin-navigation="module-tabs"] button')
    ).toHaveLength(0);
  });

  it.each(["/teams"])(
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
          location: "/workbench/sales-orders/88?merchantId=3",
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
    await click("group:customers");
    expect(
      button("/workbench/orders")
        .querySelector("[data-is-module-active]")
        ?.getAttribute("data-is-module-active")
    ).toBe("true");
    expect(
      button("group:inventory").dataset.active
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
    await click("group:transactions-services");
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
      button("procurement-management").focus();
      button("procurement-management").dispatchEvent(
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
    expect(document.activeElement).toBe(button("customers"));
    await act(async () =>
      button("procurement-management").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(button("customers"));
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

  it("点击工作区只展开不重置详情或query，选择原功能项才导航", async () => {
    await render("/workbench/sales-orders/88?merchantId=3");
    await act(async () => button("procurement-management").click());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(button("sales-orders").getAttribute("aria-current")).toBe("location");
    expect(button("group:customers").dataset.active).toBe("true");
    await click("group:customers");
    expect(button("/workbench/orders").getAttribute("aria-current")).toBe(
      "page"
    );
    await act(async () => button("operations").click());
    expect(onNavigate).not.toHaveBeenCalled();
    await click("group:basic-data");
    await click("/merchants");
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
      /\.admin-workspace-nav__module\s*\{[^}]*font-size: var\(--admin-font-label\);[^}]*font-weight: 400;[^}]*line-height: 40px;/
    );
    expect(css).toMatch(
      /\.admin-workspace-nav__module\[data-active="true"\]\s*\{\s*font-weight: 500;/
    );
    expect(css).toContain("border-bottom-color: var(--admin-color-brand)");
    expect(css).toContain(":focus-visible");
  });
});
