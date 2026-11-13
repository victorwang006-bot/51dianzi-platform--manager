// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";
import { getAdminWorkspaceDropdownWidth } from "@/lib/adminWorkspaceDropdownWidth";

// Navigation-only fictional fixtures; no order/customer data.
const items = ["/workbench/outbound", "/workbench/orders", "/workbench/inbound", "/workbench/procurement-orders", "/messages", "/staff"]
  .map(path => Object.freeze({ path, label: "fixture navigation", fixture: true }));
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); onNavigate.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(createElement(AdminWorkspaceTabs, { items, location: "/unknown", onNavigate }))); }
function button(target: string) { return host.querySelector<HTMLButtonElement>(`[data-workspace-nav-target="${target}"]`)!; }
const panel = (level = 2) => host.querySelector<HTMLDivElement>(`[data-workspace-dropdown="panel"][data-navigation-level="${level}"]`)!;
async function click(target: string) { await act(async () => button(target).click()); }
function setBounds(target: string, left: number) {
  vi.spyOn(button(target), "getBoundingClientRect").mockReturnValue({ left, right: left + 64, top: 16, bottom: 56, width: 64, height: 40, x: left, y: 16, toJSON() {} });
}

describe("紧凑菜单源码布局与实际定位", () => {
  it.each(["sales-orders", "inventory-management", "procurement-management", "operations", "organization"])("%s inline width 与 helper 同步且右缘不溢出", async id => {
    await render(); setBounds(id, 1240); await click(id);
    const width = getAdminWorkspaceDropdownWidth(id);
    expect(panel().style.width).toBe(`${width}px`);
    expect(Number.parseFloat(panel().style.left)).toBe(window.innerWidth - width - 8);
    expect(panel().style.top).toBe("60px"); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("运营168父层右侧可容176子层时，child精确贴parentRight，不沿用旧212宽度", async () => {
    await render(); setBounds("operations", 920); await click("operations"); await click("group:transactions-services");
    expect(panel().style.width).toBe("168px"); expect(panel(3).style.width).toBe("176px");
    expect(panel(3).dataset.submenuSide).toBe("right");
    expect(Number.parseFloat(panel(3).style.left)).toBe(Number.parseFloat(panel().style.left) + 168);
    expect(Number.parseFloat(panel(3).style.left) + 176).toBeLessThanOrEqual(window.innerWidth - 8);
  });
  it("右缘不足时，176子层左展开并精确贴父层left", async () => {
    await render(); setBounds("operations", 1240); await click("operations"); await click("group:transactions-services");
    expect(panel(3).dataset.submenuSide).toBe("left"); expect(panel(3).style.width).toBe("176px");
    expect(Number.parseFloat(panel(3).style.left) + 176).toBe(Number.parseFloat(panel().style.left));
  });
  it("CSS 保留桌面不同宽度、40高/12留白与 mobile 360 important，不添加全局规则", () => {
    const css = readFileSync(`${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`, "utf8");
    expect(css).toMatch(/\[data-admin-navigation="unified-dropdown"\] \.admin-workspace-nav__workspace-panel\s*\{[^}]*width: 176px;/);
    expect(css).toMatch(/\[data-workspace="sales-orders"\][\s\S]*?\[data-workspace="inventory-management"\][\s\S]*?\[data-workspace="procurement-management"\]\s*\{\s*width: 160px;/);
    expect(css).toMatch(/\[data-workspace="operations"\]\[data-navigation-level="2"\]\s*\{\s*width: 168px;/);
    expect(css).toMatch(/workspace-panel \.admin-workspace-nav__dropdown-item\s*\{\s*min-height: 40px;\s*padding: 0 12px;/);
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/workspace-panel\s*\{[^}]*width: 360px !important;/);
    expect(mobile).toContain("max-width: calc(100vw - 24px)");
    expect(mobile).toContain("left: auto !important");
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
  });
});
