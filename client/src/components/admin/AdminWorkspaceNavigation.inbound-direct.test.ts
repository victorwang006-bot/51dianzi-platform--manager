// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceLocation, AdminWorkspaceTabs, type AdminModuleTabsProps } from "./AdminWorkspaceNavigation";

// Explicitly fictional navigation-only fixtures; no business records.
const context = Object.freeze({ fixture: "inbound-nav-only", merchantId: 900001 });
const inbound = Object.freeze({ path: "/workbench/inbound", label: "原入库标签", context, chunk: "fixture-inbound", permission: "fixture-only" });
const messages = Object.freeze({ path: "/messages", label: "虚构消息中心", context, chunk: "fixture-messages", permission: "fixture-only" });
const channel = Object.freeze({ path: "/workbench/channel-inventory", label: "虚构库存列表", context, chunk: "fixture-channel", permission: "fixture-only" });
const items = Object.freeze([inbound, messages, channel]);
type Item = typeof items[number];
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NAV_TEST"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  onNavigate.mockReset(); onPreload.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(location = "/workbench/inbound", props: Partial<AdminModuleTabsProps<Item>> = {}) {
  const visible = props.items ?? items;
  await act(async () => root.render(createElement(React.Fragment, null,
    createElement(AdminWorkspaceTabs<Item>, { items: visible, location, onNavigate, onPreload, renderBadge: item => createElement("span", { "data-fixture-badge": item.path }, "2"), ...props }),
    createElement(AdminWorkspaceLocation<Item>, { items: visible, location }),
    createElement("article", { "data-retained-page": true }, createElement("h1", null, "原页面标题"), createElement("button", { "data-original-action": true }, "原页面操作")),
  )));
}
function button(target: string) { return host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`)!; }
async function click(target: string) { await act(async () => button(target).click()); }
async function key(target: string, value: string) {
  const e = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(async () => button(target).dispatchEvent(e)); return e;
}
async function pointer(target: Element, type: "pointerover" | "pointerout", relatedTarget: EventTarget | null = null) {
  const e = new MouseEvent(type, { bubbles: true, relatedTarget }); Object.defineProperty(e, "pointerType", { value: "mouse" });
  await act(async () => target.dispatchEvent(e));
}
const panels = () => host.querySelectorAll('[data-workspace-dropdown="panel"]');

describe("仅入库子页提升为一级直达", () => {
  it.each([1280, 390])("%spx原身份单参直达、回调前同步隐藏所有旧层，徽章与页面保留", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    const navigate = vi.fn((item: Item) => {
      expect(item).toBe(inbound); expect(item.context).toBe(context);
      expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true);
      expect(button("operations").getAttribute("aria-expanded")).toBe("false");
    });
    await render("/messages", { onNavigate: navigate });
    const page = host.querySelector("article"), action = host.querySelector('[data-original-action]');
    await click("operations"); await click("group:transactions-services"); expect(panels()).toHaveLength(2);
    await click("inventory-management"); expect(navigate.mock.calls).toEqual([[inbound]]); expect(panels()).toHaveLength(0);
    expect(button("inventory-management").dataset.workspaceDirectItem).toBe(inbound.path);
    expect(button("inventory-management").textContent).toBe("入库管理2");
    expect(button("inventory-management").hasAttribute("aria-expanded")).toBe(false);
    expect(button("inventory-management").hasAttribute("aria-controls")).toBe(false);
    expect(button("inventory-management").querySelector(".admin-workspace-nav__chevron")).toBeNull();
    expect(button("operations").dataset.active).toBe("true");
    await render("/workbench/inbound/fixture-detail?fixture=true#entry", { onNavigate: navigate });
    expect(button("inventory-management").getAttribute("aria-current")).toBe("page");
    expect(Array.from(host.querySelectorAll('[data-admin-navigation="current-location"] li')).map(li => li.textContent)).toEqual(["入库管理"]);
    expect(host.querySelector("article")).toBe(page); expect(host.querySelector('[data-original-action]')).toBe(action);
  });
  it("hover只预加载原对象，关闭旧菜单并取消180ms任务，不导航或生成下拉", async () => {
    vi.useFakeTimers(); await render(); await pointer(button("operations"), "pointerover");
    await pointer(button("operations"), "pointerout", document.body);
    await pointer(button("inventory-management"), "pointerover");
    expect(panels()).toHaveLength(0); expect(onPreload).toHaveBeenCalledWith(inbound); expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300)); expect(panels()).toHaveLength(0);
    await pointer(button("operations"), "pointerover"); await act(async () => vi.advanceTimersByTime(300)); expect(panels()).toHaveLength(1);
  });
  it("普通按钮Enter/Space交给原生激活，方向键只移动一级焦点", async () => {
    await render(); await act(async () => button("inventory-management").focus()); expect(onPreload).toHaveBeenCalledWith(inbound);
    for (const value of ["Enter", " ", "ArrowDown", "ArrowUp", "Tab"]) expect((await key("inventory-management", value)).defaultPrevented).toBe(false);
    expect(panels()).toHaveLength(0); expect(onNavigate).not.toHaveBeenCalled();
    await key("inventory-management", "ArrowRight"); expect(document.activeElement).toBe(button("operations"));
    await click("inventory-management"); expect(onNavigate.mock.calls).toEqual([[inbound]]);
  });
  it("库存列表独立仍回传materials/flat参数，不混入入库菜单", async () => {
    await render(); expect(button("inventory").dataset.workspaceDirectItem).toBeUndefined();
    await click("inventory"); expect(onNavigate.mock.calls).toEqual([[channel, "materials", "flat"]]); expect(onNavigate.mock.calls[0][0]).toBe(channel);
    expect(button("inventory-management").dataset.active).toBe("true");
  });
  it("撤销入库原对象同时去入口/面包屑，未知路径不伪造active", async () => {
    await render(); await click("operations");
    await render("/workbench/inbound", { items: [messages, channel] }); expect(panels()).toHaveLength(0);
    expect(button("inventory-management")).toBeNull(); expect(host.querySelector('[data-admin-navigation="current-location"]')).toBeNull();
    expect(host.querySelector('[data-active="true"]')).toBeNull();
    await render("/unknown", { items: [inbound] }); expect(button("inventory-management").hasAttribute("aria-current")).toBe(false);
    await render("/workbench/inbound", { items: [] }); expect(host.querySelector("nav")).toBeNull(); expect(host.querySelector('[data-original-action]')).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
