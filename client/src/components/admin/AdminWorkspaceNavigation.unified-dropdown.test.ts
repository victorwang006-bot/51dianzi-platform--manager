// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import {
  ADMIN_SYSTEM_RELEASE,
  AdminWorkspaceNavigation,
  AdminWorkspaceTabs,
  type AdminModuleTabsProps,
} from "./AdminWorkspaceNavigation";
import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  getAdminWorkbenchNavigationRoute,
} from "./adminWorkbenchNavigationModel";
import { getAdminWorkspaceNavigationState } from "./adminWorkspaceNavigationModel";
import {
  CHANNEL_INVENTORY_ROUTE,
  CHANNEL_INVENTORY_TABS,
} from "@/lib/channelInventoryNavigation";

const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(path =>
  Object.freeze({
    path,
    label: getAdminWorkbenchNavigationRoute(path)?.label ?? path,
    permission: `permission:${path}`,
    chunk: `chunk:${path}`,
    merchantContext: Object.freeze({ merchantId: 31, returnTo: "/orders" }),
  })
);
type Item = (typeof items)[number];
const topIds = ["customers", "inventory", "inquiries", "business", "operations", "organization"];
const dropdownIds = ["business", "operations", "organization"];
const groupedPaths = {
  customers: ["/workbench/orders"],
  inventory: ["/workbench/inbound", "/workbench/outbound"],
  procurement: ["/workbench/procurement-demands", "/workbench/procurement-orders"],
};
const operationsPaths = {
  "basic-data": ["/merchants", "/materials", "/portal-users"],
  "transactions-services": ["/orders", "/messages", "/reviews"],
  "data-monitoring": ["/analytics", "/exception-logs"],
};
let host: HTMLDivElement;
let root: Root;
const onNavigate = vi.fn();
const onPreload = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  onNavigate.mockReset();
  onPreload.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(location = "/workbench/orders?merchantId=31", overrides: Partial<AdminModuleTabsProps<Item>> = {}) {
  await act(async () => root.render(createElement(AdminWorkspaceTabs<Item>, {
    items, location, onNavigate, onPreload, ...overrides,
  })));
}

function button(target: string) {
  const node = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`);
  if (!node) throw new Error(`Missing navigation button: ${target}`);
  return node;
}

function panel(level = 2) {
  return host.querySelector<HTMLDivElement>(`[data-admin-navigation="workspace-dropdown"][data-navigation-level="${level}"]`);
}

function leaves(level: number) {
  return Array.from(panel(level)?.querySelectorAll<HTMLButtonElement>("[data-workspace-dropdown-item]") ?? [])
    .map(node => node.dataset.workspaceDropdownItem);
}

function activeTop() {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"][data-active="true"]'))
    .map(node => node.dataset.workspaceNavTarget);
}

async function click(target: string) {
  await act(async () => button(target).click());
}

async function key(target: string, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(async () => button(target).dispatchEvent(event));
  return event;
}

function subset(paths: string[]) {
  return items.filter(item => paths.includes(item.path));
}

function bounds(left: number, top: number, width = 80, height = 56) {
  return { x: left, y: top, top, left, width, height, right: left + width, bottom: top + height,
    toJSON: () => ({}) } as DOMRect;
}

async function pointer(node: Element, type: "pointerover" | "pointerout", pointerType = "mouse", relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  await act(async () => node.dispatchEvent(event));
}

describe("统一导航下拉（new focused contract）", () => {
  it("六个一级先客户列表/库存列表/询价接待，业务/运营/组织保留不导航的下拉按钮", async () => {
    await render();
    expect(Array.from(host.querySelectorAll('[data-navigation-level="1"]')).map(node => node.getAttribute("data-workspace-nav-target")))
      .toEqual(topIds);
    expect(Array.from(host.querySelectorAll('[data-navigation-level="1"]')).map(node => node.textContent))
      .toEqual(["客户列表", "库存列表", "询价接待", "业务工作台▾", "平台运营▾", "组织与权限▾"]);
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector('[data-admin-navigation="unified-dropdown"]')).not.toBeNull();
    for (const id of dropdownIds) {
      await click(id);
      expect(panel()?.dataset.workspace).toBe(id);
      expect(button(id).getAttribute("aria-expanded")).toBe("true");
      expect(panel()?.id).toBe(button(id).getAttribute("aria-controls"));
      expect(panel()?.getAttribute("aria-labelledby")).toBe(button(id).id);
      expect(host.querySelectorAll('[data-workspace-dropdown="layer"]')).toHaveLength(1);
      expect(host.querySelectorAll('[data-navigation-level="1"][aria-expanded="true"]')).toHaveLength(1);
      await click(id);
      expect(panel()).toBeNull();
      expect(button(id).getAttribute("aria-expanded")).toBe("false");
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-system-version]")?.getAttribute("data-system-version")).toBe(ADMIN_SYSTEM_RELEASE);
  });

  it("进入/切换真实页面不自动展开；仅焦点与预加载也不展开", async () => {
    for (const location of ["/materials", "/workbench/orders", `${CHANNEL_INVENTORY_ROUTE}?ciTab=channels`, "/staff"]) {
      await render(location);
      expect(panel()).toBeNull();
      await act(async () => button("business").focus());
      expect(panel()).toBeNull();
      expect(panel(3)).toBeNull();
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("桌面业务/运营/组织鼠标自动展开，客户与库存直接入口不展开、不抢焦点", async () => {
    await render("/workbench/orders");
    await act(async () => button("business").focus());
    for (const id of dropdownIds) {
      await pointer(button(id), "pointerover");
      expect(panel()?.dataset.workspace).toBe(id);
      expect(panel(3)).toBeNull();
      expect(activeTop()).toEqual(["business"]);
      expect(document.activeElement).toBe(button("business"));
      expect(host.querySelectorAll('[data-navigation-level="1"][aria-expanded="true"]')).toHaveLength(1);
    }
    for (const id of ["customers", "inventory", "inquiries"]) {
      await pointer(button(id), "pointerover");
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(button("business"));
      expect(button(id).hasAttribute("aria-expanded")).toBe(false);
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onPreload).toHaveBeenCalled();
  });

  it.each(["customers", "inventory", "procurement"] as const)("%s 鼠标展开旁侧三级，悬停后一次叶子点击即可导航", async id => {
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button(`group:${id}`), "pointerover");
    expect(leaves(3)).toEqual(groupedPaths[id]);
    expect(panel(3)?.dataset.submenuSide).toBe("right");
    expect(onNavigate).not.toHaveBeenCalled();
    await click(`group:${id}`);
    expect(leaves(3)).toEqual(groupedPaths[id]);
    expect(button(`group:${id}`).getAttribute("aria-expanded")).toBe("true");
    expect(onNavigate).not.toHaveBeenCalled();
    await click(groupedPaths[id][0]);
    expect(onNavigate.mock.calls).toEqual([[items.find(item => item.path === groupedPaths[id][0])]]);
    expect(panel()).toBeNull();
  });

  it("移到同层另一组替换子面板，返回一级不重置子组，切换工作区清理旧子组", async () => {
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button("group:customers"), "pointerover");
    await pointer(button("group:inventory"), "pointerover");
    expect(leaves(3)).toEqual(groupedPaths.inventory);
    expect(button("group:customers").getAttribute("aria-expanded")).toBe("false");
    await pointer(button("business"), "pointerover");
    expect(leaves(3)).toEqual(groupedPaths.inventory);
    await pointer(button("operations"), "pointerover");
    expect(panel(3)).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("鼠标从一级经过短空隙进入二级、再进三级不闪退；真正离开180ms才关闭", async () => {
    vi.useFakeTimers();
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button("business"), "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(179));
    expect(panel()).not.toBeNull();
    await pointer(panel()!, "pointerover");
    await act(async () => vi.advanceTimersByTime(200));
    expect(panel()).not.toBeNull();
    await pointer(button("group:customers"), "pointerover");
    await pointer(panel()!, "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(100));
    await pointer(panel(3)!, "pointerover");
    await act(async () => vi.advanceTimersByTime(200));
    expect(leaves(3)).toEqual(groupedPaths.customers);
    // A direct parent-to-child transition is also safe without a timer.
    await pointer(panel()!, "pointerout", "mouse", panel(3));
    await act(async () => vi.advanceTimersByTime(200));
    expect(panel(3)).not.toBeNull();
    await pointer(panel(3)!, "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(179));
    expect(panel(3)).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(panel()).toBeNull();
    expect(panel(3)).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(["touch", "pen"])("桌面%s不启用鼠标悬停，仍可点击逐级进入", async type => {
    await render();
    await pointer(button("business"), "pointerover", type);
    expect(panel()).toBeNull();
    await click("business");
    await pointer(button("group:customers"), "pointerover", type);
    expect(panel(3)).toBeNull();
    await click("group:customers");
    await click("/workbench/orders");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("移动即使收到mouse事件也不悬停，点击、逐级返回保持可用且不延迟关闭", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await render();
    await pointer(button("business"), "pointerover");
    expect(panel()).toBeNull();
    await click("business");
    await pointer(button("group:customers"), "pointerover");
    expect(panel(3)).toBeNull();
    await click("group:customers");
    await pointer(panel(3)!, "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(300));
    expect(panel(3)).not.toBeNull();
    await act(async () => panel(3)!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!.click());
    expect(panel(3)).toBeNull();
    expect(panel()?.hidden).toBe(false);
  });

  it.each(["URL", "items"])("等待关闭时%s变化取消旧计时器，新菜单不被迟到关闭", async change => {
    vi.useFakeTimers();
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button("business"), "pointerout", "mouse", document.body);
    const overrides = change === "items" ? { items: [...items] } : {};
    const location = change === "URL" ? "/workbench/orders?merchantId=32" : undefined;
    await render(location, overrides);
    expect(panel()).toBeNull();
    await click("operations");
    await act(async () => vi.advanceTimersByTime(300));
    expect(panel()?.dataset.workspace).toBe("operations");
  });

  it.each(["outside", "Escape", "leaf"])("有悬停关闭计时器时%s仍立即关闭所有层", async action => {
    vi.useFakeTimers();
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button("group:customers"), "pointerover");
    await pointer(panel(3)!, "pointerout", "mouse", document.body);
    if (action === "outside") await act(async () => document.body.click());
    else if (action === "Escape") await key("/workbench/orders", "Escape");
    else await click("/workbench/orders");
    expect(panel()).toBeNull();
    await click("operations");
    await act(async () => vi.advanceTimersByTime(300));
    expect(panel()?.dataset.workspace).toBe("operations");
    expect(onNavigate).toHaveBeenCalledTimes(action === "leaf" ? 1 : 0);
  });

  it("卸载取消未到期的悬停工作", async () => {
    vi.useFakeTimers();
    await render();
    await pointer(button("business"), "pointerover");
    await pointer(button("business"), "pointerout", "mouse", document.body);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("业务二级仅三分组，桌面悬停自动展开三级且分组不导航", async () => {
    await render("/workbench/sales-orders/8?merchantId=31#detail");
    await click("business");
    expect(Array.from(panel()!.querySelectorAll("button[data-navigation-choice]")).map(node => node.getAttribute("data-workspace-nav-target")))
      .toEqual(["group:customers", "group:inventory", "group:procurement"]);
    expect(leaves(2)).toEqual([]);
    expect(panel(3)).toBeNull();
    expect(host.querySelector(`[data-workspace-nav-target="${CHANNEL_INVENTORY_ROUTE}"]`)).toBeNull();
    await pointer(button("group:customers"), "pointerover");
    expect(leaves(3)).toEqual(groupedPaths.customers);
    expect(button("group:customers").textContent).toBe("销售管理›");
    await click("group:customers");
    expect(leaves(3)).toEqual(groupedPaths.customers);
    expect(button("group:customers").getAttribute("data-active")).toBe("true");
    expect(button("/workbench/orders").getAttribute("aria-current")).toBe("page");
    await click("group:inventory");
    expect(leaves(3)).toEqual(groupedPaths.inventory);
    expect(button("group:customers").getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-workspace-nav-target="/workbench/orders"]')).toBeNull();
    await click("group:procurement");
    expect(leaves(3)).toEqual(groupedPaths.procurement);
    expect(host.querySelectorAll('[data-navigation-level="3"][data-workspace-dropdown="panel"]')).toHaveLength(1);
    await click("group:procurement");
    expect(panel(3)).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(Object.entries(groupedPaths).flatMap(([id, paths]) => paths.map(path => [id, path])))
    ("%s 三级 %s 保留原对象、preload、回调一次并同步隐藏", async (id, path) => {
      const original = items.find(item => item.path === path)!;
      const navigate = vi.fn((item: Item) => {
        expect(item).toBe(original);
        expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true);
        expect(button("business").getAttribute("aria-expanded")).toBe("false");
      });
      await render(undefined, { onNavigate: navigate });
      await click("business");
      await click(`group:${id}`);
      onPreload.mockClear();
      await act(async () => button(path).focus());
      await act(async () => button(path).dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
      expect(onPreload.mock.calls).toEqual([[original], [original]]);
      await click(path);
      expect(navigate.mock.calls).toEqual([[original]]);
      expect(navigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext);
      expect(panel()).toBeNull();
      expect(panel(3)).toBeNull();
    });

  it("独立询价保留原三级测试的同一对象、preload和父回调前同步隐藏边界", async () => {
    const original = items.find(item => item.path === "/workbench/inquiries")!;
    const navigate = vi.fn((item: Item) => {
      expect(item).toBe(original);
      expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true);
      expect(button("business").getAttribute("aria-expanded")).toBe("false");
    });
    await render(undefined, { onNavigate: navigate });
    await click("business"); await click("group:customers");
    expect(leaves(3)).toEqual(["/workbench/orders"]);
    expect(host.querySelector('[data-workspace-nav-target="/workbench/inquiries"]')).toBeNull();
    onPreload.mockClear(); await act(async () => button("inquiries").focus());
    await act(async () => button("inquiries").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(onPreload.mock.calls).toEqual([[original], [original]]);
    await click("inquiries"); expect(navigate.mock.calls).toEqual([[original]]);
    expect(navigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext);
    expect(panel()).toBeNull(); expect(panel(3)).toBeNull();
  });

  it("公司信息及其别名不显示入口，仅有公司许可时不制造空业务工作区", async () => {
    await render();
    await click("business");
    expect(host.querySelector('[data-workspace-nav-target="/workbench/company-info"]')).toBeNull();
    expect(panel()?.textContent).not.toContain("公司信息");
    await render("/workbench/company", { items: subset(["/workbench/company-info"]) });
    expect(host.querySelector("nav, button")).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(["operations", "organization"] as const)("%s 完整沿用旧 workspace 项目，renderItem/renderBadge/preload 和导航原对象", async id => {
    const workspace = getAdminWorkspaceNavigationState(items, "/materials").workspaces.find(entry => entry.id === id)!;
    for (const original of workspace.items) {
      const intent = vi.fn();
      await render(`${original.path}/8?tab=details`, {
        onPreload: undefined,
        onItemIntent: intent,
        renderItem: (item, state) => createElement("span", {
          "data-render-workspace": state.workspaceId,
          "data-render-active": String(state.isActive),
        }, item.label),
        renderBadge: item => createElement("span", { "data-original-badge": item.path }, "3"),
      });
      await click(id);
      if (id === "operations") {
        expect(leaves(2)).toEqual([]);
        const groupId = Object.entries(operationsPaths).find(([, paths]) => paths.includes(original.path))![0];
        await click(`group:${groupId}`);
        expect(leaves(3)).toEqual(operationsPaths[groupId as keyof typeof operationsPaths]);
        expect(button(`group:${groupId}`).getAttribute("aria-current")).toBe("location");
        expect(panel(3)?.dataset.workspace).toBe("operations");
        expect(panel(3)?.getAttribute("aria-labelledby")).toBe(button(`group:${groupId}`).id);
      } else expect(leaves(2)).toEqual(workspace.items.map(item => item.path));
      const leaf = button(original.path);
      expect(leaf.querySelector("[data-render-workspace]")?.getAttribute("data-render-workspace")).toBe(id);
      expect(leaf.querySelector("[data-render-active]")?.getAttribute("data-render-active")).toBe("true");
      expect(leaf.querySelector("[data-original-badge]")?.getAttribute("data-original-badge")).toBe(original.path);
      expect(leaf.querySelector("button, a")).toBeNull();
      await act(async () => leaf.focus());
      expect(intent).toHaveBeenCalledWith(original);
      onNavigate.mockClear();
      await click(original.path);
      expect(onNavigate.mock.calls).toEqual([[original]]);
      expect(panel()).toBeNull();
    }
  });

  it("平台运营桌面悬停复用三级菜单，八个叶子各只出现一次且不混业务订单", async () => {
    await render("/orders/8?tab=details");
    await pointer(button("operations"), "pointerover");
    expect(Array.from(panel()!.querySelectorAll('[data-workspace-group]')).map(node => node.textContent))
      .toEqual(["基础资料›", "交易与服务›", "数据与监控›"]);
    const seen: string[] = [];
    for (const [id, paths] of Object.entries(operationsPaths)) {
      await pointer(button(`group:${id}`), "pointerover");
      expect(leaves(3)).toEqual(paths);
      expect(host.querySelectorAll('[data-navigation-level="3"][data-workspace-dropdown="panel"]')).toHaveLength(1);
      seen.push(...leaves(3) as string[]);
      expect(activeTop()).toEqual(["operations"]);
    }
    expect(new Set(seen).size).toBe(8);
    expect(seen).not.toContain("/workbench/orders");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("平台运营键盘进入、循环、返回、Esc及移动抽屉均沿用工作台交互", async () => {
    await render("/orders/8");
    await key("operations", "ArrowDown");
    expect(document.activeElement).toBe(button("group:basic-data"));
    await key("group:basic-data", "ArrowDown");
    await key("group:transactions-services", "ArrowRight");
    expect(document.activeElement).toBe(button("/orders"));
    expect(button("/orders").getAttribute("aria-current")).toBe("page");
    await key("/orders", "End");
    expect(document.activeElement).toBe(button("/reviews"));
    await key("/reviews", "ArrowDown");
    expect(document.activeElement).toBe(button("/orders"));
    await key("/orders", "ArrowLeft");
    expect(document.activeElement).toBe(button("group:transactions-services"));
    await key("group:transactions-services", "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("operations"));

    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await click("operations");
    await click("group:data-monitoring");
    expect(panel()?.hidden).toBe(true);
    expect(document.activeElement).toBe(button("/analytics"));
    const back = panel(3)!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!;
    expect(back.getAttribute("aria-label")).toBe("返回平台运营菜单");
    await act(async () => back.click());
    expect(panel(3)).toBeNull();
    expect(panel()?.hidden).toBe(false);
    expect(document.activeElement).toBe(button("group:data-monitoring"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("平台运营仅分组原角色可见叶，撤权关闭旧三级且不补权限", async () => {
    await render("/orders/8", { items: subset(["/orders", "/portal-users", "/workbench/orders"]) });
    await click("operations");
    expect(Array.from(panel()!.querySelectorAll('[data-workspace-group]')).map(node => node.getAttribute('data-workspace-group')))
      .toEqual(["basic-data", "transactions-services"]);
    await click("group:transactions-services");
    expect(leaves(3)).toEqual(["/orders"]);
    await render("/orders/8", { items: subset(["/portal-users", "/workbench/orders"]) });
    expect(panel()).toBeNull();
    expect(panel(3)).toBeNull();
    await click("operations");
    expect(host.querySelector('[data-workspace-group="transactions-services"]')).toBeNull();
    await click("group:basic-data");
    expect(leaves(3)).toEqual(["/portal-users"]);
    expect(panel(3)?.querySelector('[aria-current="page"]')).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="/orders"]')).toBeNull();
  });

  it.each(CHANNEL_INVENTORY_TABS)("历史 $id 均归库存一级，单入口仅复用原授权 channel 对象", async tab => {
    const original = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE)!;
    await render(`${CHANNEL_INVENTORY_ROUTE}?merchantId=31&ciTab=${tab.id}#detail`);
    expect(activeTop()).toEqual(["inventory"]);
    expect(button("business").getAttribute("data-active")).toBe("false");
    expect(host.querySelector('[data-workspace-nav-target="channel"]')).toBeNull();
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    for (const [target, view] of [["inventory", "flat"]]) {
      onPreload.mockClear();
      onNavigate.mockClear();
      await act(async () => button(target).focus());
      expect(onPreload.mock.calls).toEqual([[original]]);
      expect(button(target).hasAttribute("aria-expanded")).toBe(false);
      expect(button(target).hasAttribute("aria-controls")).toBe(false);
      await click(target);
      expect(onNavigate.mock.calls).toEqual([[original, "materials", view]]);
      expect(onNavigate.mock.calls[0][0]).toBe(original);
      expect(onNavigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext);
      expect(panel()).toBeNull();
      expect(host.querySelectorAll('[data-channel-tab]')).toHaveLength(0);
    }
  });

  it.each([
    ["?ciTab=invalid", "inventory"],
    ["?supplyChannelId=22&supplyTab=materials", "inventory"],
    ["?supplyChannelId=22&supplyTab=details", "inventory"],
    ["?supplyChannelId=0&supplyTab=materials", "inventory"],
    ["?ciTab=materials&ciView=flat", "inventory"],
    ["?ciTab=materials&ciView=channels", "inventory"],
    ["?ciTab=materials&ciView=invalid", "inventory"],
    ["?ciTab=batches&ciView=channels", "inventory"],
    ["?ciTab=trash&ciView=channels", "inventory"],
    ["?ciTab=channels&ciView=flat", "inventory"],
  ])("渠道查询 %s 沿用 helper 并唯一高亮 %s", async (query, target) => {
    await render(`${CHANNEL_INVENTORY_ROUTE}${query}`);
    expect(host.querySelector('[data-workspace-nav-target="channel"]')).toBeNull();
    expect(activeTop()).toEqual([target]);
    expect(button(target).getAttribute("aria-current")).toBe("page");
    expect(panel()).toBeNull();
  });

  it.each([
    [CHANNEL_INVENTORY_ROUTE, "inventory"],
    ["/workbench/inventory", "inventory"],
    ["/workbench/sales-orders/8", "business"],
    ["/workbench/chat/8", "inquiries"],
    ["/materials/8", "operations"],
    ["/admins/8", "organization"],
    ["/profile", "organization"],
    ["/not-a-real-page?ciTab=trash", null],
    ["/workbench/channel-inventory-other?ciTab=trash", null],
  ])("%s 的一级 active 唯一且不依赖打开菜单", async (location, expected) => {
    await render(location);
    expect(activeTop()).toEqual(expected ? [expected] : []);
    for (const id of dropdownIds) {
      await click(id);
      expect(activeTop()).toEqual(expected ? [expected] : []);
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("profile 保留组织上下文但不编造 profile item；unknown URL 没有任何 item 高亮", async () => {
    await render("/profile");
    await click("organization");
    expect(activeTop()).toEqual(["organization"]);
    expect(panel()?.querySelector("[aria-current]")).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="/profile"]')).toBeNull();
    await render("/unknown");
    await click("business");
    await click("group:customers");
    expect(activeTop()).toEqual([]);
    expect(panel()?.querySelector("[aria-current]")).toBeNull();
    expect(panel(3)?.querySelector("[aria-current]")).toBeNull();
  });

  it("权限交集：空一级/二级不显示，channel 唯一来源必须为准确原 path", async () => {
    const visible = subset(["/workbench/inbound", "/materials"]);
    await render(CHANNEL_INVENTORY_ROUTE, { items: visible });
    expect(activeTop()).toEqual([]);
    expect(host.querySelector('[data-workspace-nav-target="channel"]')).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="inventory"]')).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="organization"]')).toBeNull();
    await click("business");
    expect(panel()?.querySelectorAll("[data-business-group]")).toHaveLength(1);
    expect(button("group:inventory").textContent).toBe("库存管理›");
    await click("group:inventory");
    expect(leaves(3)).toEqual(["/workbench/inbound"]);
    await render("/workbench/orders", { items: subset([CHANNEL_INVENTORY_ROUTE]) });
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    expect(activeTop()).toEqual([]);
    expect(host.querySelectorAll('[data-navigation-level="1"]')).toHaveLength(1);
    await render(CHANNEL_INVENTORY_ROUTE, { items: [{ ...items[0], path: `${CHANNEL_INVENTORY_ROUTE}?ciTab=trash` }] });
    expect(host.querySelector("nav")).toBeNull();
    await render(undefined, { items: [] });
    expect(host.querySelectorAll("nav, button")).toHaveLength(0);
  });

  it("换一级关闭旧三级，只保留一个一级 panel", async () => {
    await render();
    await click("business");
    await click("group:inventory");
    await click("operations");
    expect(panel(3)).toBeNull();
    expect(panel()?.dataset.workspace).toBe("operations");
    await click("business");
    expect(panel(3)).toBeNull();
  });

  it.each(["/workbench/orders?merchantId=32", "/workbench/orders?merchantId=31#detail", "/materials"])
    ("URL %s 变化关闭所有层，返回旧 URL 不重开", async location => {
      await render();
      await click("business");
      await key("group:customers", "ArrowRight");
      await render(location);
      expect(panel()).toBeNull();
      expect(panel(3)).toBeNull();
      await render();
      expect(panel()).toBeNull();
    });

  it("同权限的新 items 引用和撤权都关闭；旧引用返回不迟到重开", async () => {
    await render();
    await key("business", "Enter");
    await key("group:customers", "ArrowRight");
    await render(undefined, { items: [...items] });
    expect(panel()).toBeNull();
    await render();
    expect(panel()).toBeNull();
    await click("business");
    await click("group:customers");
    await render(undefined, { items: subset(["/workbench/company-info", "/analytics"]) });
    expect(panel()).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    await click("operations");
    await click("group:data-monitoring");
    expect(leaves(3)).toEqual(["/analytics"]);
    expect(panel()?.querySelector("[data-business-group]")).toBeNull();
  });

  it("批量键盘打开紧接撤权，不执行迟到焦点或显示未授权 item", async () => {
    await render();
    await click("business");
    await act(async () => {
      button("group:customers").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      root.render(createElement(AdminWorkspaceTabs<Item>, {
        items: subset(["/materials"]), location: "/materials", onNavigate, onPreload,
      }));
    });
    expect(panel()).toBeNull();
    expect(panel(3)).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="/workbench/inquiries"]')).toBeNull();
    await act(async () => Promise.resolve());
    expect(panel()).toBeNull();
    expect(activeTop()).toEqual(["operations"]);
  });

  it("键盘一级进入、二级进入三级、上下/Home/End、返回、Esc 与原生 Tab", async () => {
    await render();
    await act(async () => button("inventory").focus());
    await key("inventory", "ArrowRight");
    expect(document.activeElement).toBe(button("inquiries"));
    await key("inquiries", "ArrowRight");
    expect(document.activeElement).toBe(button("business"));
    expect((await key("business", "ArrowDown")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("group:customers"));
    await key("group:customers", "End");
    expect(document.activeElement).toBe(button("group:procurement"));
    await key("group:procurement", "Home");
    expect(document.activeElement).toBe(button("group:customers"));
    await key("group:customers", "ArrowDown");
    expect(document.activeElement).toBe(button("group:inventory"));
    await key("group:inventory", "ArrowRight");
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "ArrowDown");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    await key("/workbench/inbound", "End");
    expect(document.activeElement).toBe(button("/workbench/outbound"));
    expect((await key("/workbench/outbound", "Tab")).defaultPrevented).toBe(false);
    await key("/workbench/outbound", "ArrowLeft");
    expect(panel(3)).toBeNull();
    expect(document.activeElement).toBe(button("group:inventory"));
    await key("group:inventory", "Enter");
    await key("/workbench/inbound", "Escape");
    expect(panel()).toBeNull();
    expect(panel(3)).toBeNull();
    expect(document.activeElement).toBe(button("business"));
    await key("business", "ArrowUp");
    expect(document.activeElement).toBe(button("group:procurement"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("mobile 选择组后只显示对应三级，返回恢复二级焦点，close/backdrop/Esc 关闭", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await render();
    await key("business", "Enter");
    expect(host.querySelector('[data-workspace-dropdown="layer"]')?.getAttribute("data-drawer")).toBe("true");
    await click("group:inventory");
    expect(panel()?.hidden).toBe(true);
    expect(panel(3)?.hidden).toBe(false);
    expect(leaves(3)).toEqual(groupedPaths.inventory);
    expect(document.activeElement).toBe(button("/workbench/inbound"));
    await act(async () => panel(3)!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!.click());
    expect(panel(3)).toBeNull();
    expect(panel()?.hidden).toBe(false);
    expect(document.activeElement).toBe(button("group:inventory"));
    await click("group:customers");
    await key("/workbench/orders", "ArrowLeft");
    expect(document.activeElement).toBe(button("group:customers"));
    await act(async () => panel()!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="close"]')!.click());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("business"));
    await click("operations");
    await act(async () => host.querySelector<HTMLDivElement>('[data-workspace-dropdown="backdrop"]')!.click());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("operations"));
    await key("organization", "Enter");
    await key("/staff", "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("organization"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each([1280, 390])("%s 宽度的库存入口原生 Enter/Space 可达，点击关闭旧两层并仅回调一次", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    await render();
    const original = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE)!;
    for (const [target, view] of [["inventory", "flat"]]) {
      await click("business");
      await click("group:customers");
      const navigate = vi.fn((item: Item) => {
        expect(item).toBe(original);
        expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true);
      });
      await render(undefined, { onNavigate: navigate });
      for (const value of ["Enter", " "]) expect((await key(target, value)).defaultPrevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      await click(target);
      expect(navigate.mock.calls).toEqual([[original, "materials", view]]);
      expect(panel()).toBeNull();
      expect(panel(3)).toBeNull();
    }
  });

  it.each(["click", "pointerdown", "focus"])("external %s 关闭两层且不抢外部焦点", async action => {
    await render();
    await click("business");
    await click("group:customers");
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      await act(async () => {
        if (action === "focus") outside.focus();
        else outside.dispatchEvent(new Event(action, { bubbles: true }));
      });
      expect(panel()).toBeNull();
      expect(panel(3)).toBeNull();
      if (action === "focus") expect(document.activeElement).toBe(outside);
    } finally { outside.remove(); }
  });

  it.each([[120, "right"], [1100, "left"]] as const)("desktop %s 边界使用 %s 三级弹出且低高度 panel 各自滚动", async (left, side) => {
    Object.defineProperty(window, "innerHeight", { value: 180, configurable: true });
    await render();
    vi.spyOn(button("business"), "getBoundingClientRect").mockReturnValue(bounds(left, 0));
    await click("business");
    const primary = panel()!;
    expect(Number.parseFloat(primary.style.top)).toBe(60);
    expect(Number.parseFloat(primary.style.maxHeight)).toBe(112);
    vi.spyOn(button("group:customers"), "getBoundingClientRect").mockReturnValue(bounds(left, 68, 202, 40));
    await click("group:customers");
    const children = panel(3)!;
    expect(children.dataset.submenuSide).toBe(side);
    expect(Number.parseFloat(children.style.left)).toBe(Number.parseFloat(primary.style.left) + (side === "right" ? 212 : -212));
    expect(Number.parseFloat(children.style.top) + Number.parseFloat(children.style.maxHeight)).toBeLessThanOrEqual(172);
    for (const region of [primary, children]) {
      await act(async () => region.querySelector('[data-workspace-dropdown="content"]')!.dispatchEvent(new Event("scroll")));
      expect(panel()).not.toBeNull();
      expect(panel(3)).not.toBeNull();
    }
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(panel()).toBeNull();
  });

  it("wrapper 不重新引入 module 二级行；追加 CSS 仅 scoped nav 且不改字号/全局/header", async () => {
    await act(async () => root.render(createElement(AdminWorkspaceNavigation<Item>, { items, location: "/materials", onNavigate })));
    expect(host.querySelectorAll("nav")).toHaveLength(1);
    expect(host.querySelector('[data-admin-navigation="module-tabs"]')).toBeNull();
    const base = `${process.cwd()}/client/src/components/admin/`;
    const css = readFileSync(`${base}AdminWorkspaceNavigation.css`, "utf8");
    const appended = css.split("/* Unified dropdown selections override.")[1];
    expect(appended).toBeDefined();
    expect(appended).toContain('width: 212px');
    expect(appended).toContain('overflow-y: auto');
    expect(appended).toContain('position: fixed');
    expect(appended).toContain('@media (max-width: 767px)');
    expect(appended).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
    // Approved unread badge typography is confined to the inquiry badge, not
    // the prior dropdown text or the global header/content.
    const [dropdownCss, badgeCss] = appended.split("/* Inquiry-only unread,");
    const rules = dropdownCss.replace(/\/\*[\s\S]*?\*\//g, "").split("*/").at(-1)!;
    expect(rules).not.toMatch(/font-(?:size|family)|line-height|admin-workspace-shell|Logo/);
    expect(badgeCss).toContain(".admin-workspace-nav .inquiry-reception-nav-badge {");
    expect(badgeCss).not.toMatch(/admin-workspace-shell|Logo|(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
    const source = readFileSync(`${base}AdminWorkspaceNavigation.tsx`, "utf8");
    expect(source).not.toMatch(/from ["']react-dom|createPortal|flushSync/);
  });
});
