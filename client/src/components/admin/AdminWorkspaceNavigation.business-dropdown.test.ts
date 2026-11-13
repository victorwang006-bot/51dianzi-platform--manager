// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { AdminWorkspaceTabs, ADMIN_SYSTEM_RELEASE } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(g => g.paths).map(path => Object.freeze({ path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path, merchantContext: Object.freeze({ merchantId: 31 }) }));
let host: HTMLDivElement, root: Root; const onNavigate = vi.fn(), onPreload = vi.fn();
beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true }); onNavigate.mockReset(); onPreload.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(location = "/materials", visible = items) { await act(async () => root.render(createElement(AdminWorkspaceTabs, { items: visible, location, onNavigate, onPreload, renderItem: (item, state) => createElement("span", { "data-active-render": String(state.isActive), "data-business-context": state.workspaceId }, item.label), renderBadge: () => createElement("span", { "data-badge": "original" }, "2") }))); }
function button(t: string) { const n = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${t}"]`); if (!n) throw Error(t); return n; }
async function click(t: string) { await act(async () => button(t).click()); }
const panel = () => host.querySelector<HTMLDivElement>('[data-workspace-dropdown="panel"]');
describe("原业务子项移至一级管理菜单的回归", () => {
  it.each([["inventory-management", "/workbench/inbound"], ["procurement-management", "/workbench/procurement-demands"], ["procurement-management", "/workbench/procurement-orders"]])
    ("%s → %s保留业务上下文、badge与原对象", async (parent, path) => {
      await render(path); await click(parent); const original = items.find(i => i.path === path)!;
      expect(button(path).querySelector('[data-business-context="business"]')).not.toBeNull(); expect(button(path).querySelector('[data-active-render="true"]')).not.toBeNull(); expect(button(path).querySelector('[data-badge="original"]')).not.toBeNull();
      await act(async () => button(path).focus()); expect(onPreload).toHaveBeenCalledWith(original); await click(path); expect(onNavigate.mock.calls).toEqual([[original]]); expect(onNavigate.mock.calls[0][0]).toBe(original); expect(panel()).toBeNull();
    });
  it("单商城授权提升一级销售，保留badge、preload与原seller对象，不生成库存重复项", async () => {
    const original = items.find(item => item.path === "/workbench/outbound")!;
    await render(original.path, [original]); expect(button("sales-orders").querySelector('[data-badge="original"]')).not.toBeNull();
    expect(button("sales-orders").getAttribute("aria-current")).toBe("location"); expect(host.querySelector('[data-workspace-nav-target="inventory-management"]')).toBeNull();
    await act(async () => button("sales-orders").focus()); expect(onPreload).toHaveBeenCalledWith(original);
    await click("sales-orders"); expect(onNavigate).not.toHaveBeenCalled();
    await click(original.path); expect(onNavigate.mock.calls).toEqual([[original, undefined, undefined, "mall"]]); expect(onNavigate.mock.calls[0][0]).toBe(original);
  });
  it("仅一个入库许可仍保留原对象，不合成出库或采购入口", async () => {
    await render("/workbench/inbound", items.filter(i => i.path === "/workbench/inbound")); await click("inventory-management"); expect(host.querySelectorAll('[data-workspace-dropdown-item]')).toHaveLength(1); expect(host.querySelector('[data-workspace-nav-target="procurement-management"]')).toBeNull(); expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
  });
  it("公司信息历史条目不生成新一级菜单", async () => { await render("/workbench/company", items.filter(i => i.path === "/workbench/company-info")); expect(host.querySelector("nav")).toBeNull(); expect(onNavigate).not.toHaveBeenCalled(); });
  it("ops页打开库存菜单不把高亮改为库存", async () => { await render(); await click("inventory-management"); expect(button("operations").getAttribute("aria-current")).toBe("location"); expect(button("inventory-management").hasAttribute("aria-current")).toBe(false); });
  it("已移除DOM的内部点击原composedPath仍保留菜单", async () => {
    await render(); await click("inventory-management"); const nav = host.querySelector("nav")!; const removed = document.createElement("button"); const event = new MouseEvent("click", { bubbles: true }); Object.defineProperty(event, "target", { value: removed }); Object.defineProperty(event, "composedPath", { value: () => [removed, nav, document] }); await act(async () => document.dispatchEvent(event)); expect(panel()).not.toBeNull(); await act(async () => document.body.click()); expect(panel()).toBeNull();
  });
  it("发布标记更新而原布局和位置CSS字节保留，无全局选择器", () => {
    expect(ADMIN_SYSTEM_RELEASE).toBe("20261113-primary-menu-reminders-v1"); const css = readFileSync(`${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`, "utf8"); expect(css).toContain("Business primary dropdown only."); expect(css).toContain('data-admin-navigation="unified-dropdown"'); expect(css).toContain("gap: clamp(8px, 1vw, 14px)"); expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
  });
});
