// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";
import { getAdminWorkspaceDropdownWidth } from "@/lib/adminWorkspaceDropdownWidth";

// Fictional navigation labels only; layout mocks do not contact application APIs.
const items = ["/workbench/outbound", "/workbench/orders", "/workbench/inbound", "/workbench/procurement-orders", "/messages", "/staff"]
  .map(path => Object.freeze({ path, label: "虚构测试菜单", fixture: true }));
let host: HTMLDivElement, root: Root;
let widths: Record<string, number>;
const onNavigate = vi.fn();
const observers = new Set<() => void>();
const disconnected = vi.fn();
function bounds(left: number, width: number) {
  return { left, right: left + width, top: 16, bottom: 56, width, height: 40, x: left, y: 16, toJSON() {} };
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  widths = { "sales-orders:2": 91.5, "procurement-management:2": 136, "operations:2": 106, "operations:3": 92, "organization:2": 142 };
  observers.clear(); disconnected.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NAVIGATION_TEST"); }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) { observers.add(callback); }
    observe() {}
    disconnect() { observers.delete(this.callback); disconnected(); }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.dataset.workspaceDropdown === "panel") return bounds(Number.parseFloat(this.style.left) || 0, widths[`${this.dataset.workspace}:${this.dataset.navigationLevel}`] ?? 0);
    return bounds(0, 64);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); onNavigate.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render() { await act(async () => root.render(createElement(AdminWorkspaceTabs, { items, location: "/unknown", onNavigate }))); }
function button(target: string) { return host.querySelector<HTMLButtonElement>(`[data-workspace-nav-target="${target}"]`)!; }
const panel = (level = 2) => host.querySelector<HTMLDivElement>(`[data-workspace-dropdown="panel"][data-navigation-level="${level}"]`)!;
async function click(target: string) { await act(async () => button(target).click()); }
function setBounds(target: string, left: number) { vi.spyOn(button(target), "getBoundingClientRect").mockReturnValue(bounds(left, 64)); }

describe("内容自适应下拉：真实DOM宽度定位与CSS契约", () => {
  it.each(["sales-orders", "procurement-management", "operations", "organization"])("%s uses actual width, no fixed inline width and no right overflow", async id => {
    await render(); setBounds(id, 1240); await click(id);
    const width = widths[`${id}:2`];
    expect(panel().style.width).toBe("");
    expect(Number(panel().dataset.dropdownMeasuredWidth)).toBe(width);
    expect(Number.parseFloat(panel().style.left)).toBe(window.innerWidth - width - 8);
    expect(panel().style.top).toBe("60px"); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("narrow real parent/child fit right even where old 168/176 would wrongly flip", async () => {
    await render(); setBounds("operations", 1050); await click("operations"); await click("group:transactions-services");
    expect(panel(3).dataset.submenuSide).toBe("right");
    expect(Number.parseFloat(panel(3).style.left)).toBe(Number.parseFloat(panel().style.left) + widths["operations:2"]);
    expect(Number.parseFloat(panel(3).style.left) + widths["operations:3"]).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(1050 + 168 + 176).toBeGreaterThan(window.innerWidth - 8);
  });
  it("long rendered child independently flips left and exactly touches parentLeft", async () => {
    widths["operations:3"] = 240.25;
    await render(); setBounds("operations", 1100); await click("operations"); await click("group:transactions-services");
    expect(panel(3).dataset.submenuSide).toBe("left");
    expect(Number(panel(3).dataset.dropdownMeasuredWidth)).toBe(240.25);
    expect(Number.parseFloat(panel(3).style.left) + widths["operations:3"]).toBe(Number.parseFloat(panel().style.left));
  });
  it("observer remeasures badge/custom content growth before positioning, never steals focus or navigates", async () => {
    await render(); setBounds("operations", 1050); await click("operations"); await click("group:transactions-services");
    await act(async () => button("/messages").focus());
    const focused = document.activeElement;
    widths["operations:2"] = 152; widths["operations:3"] = 232;
    await act(async () => Array.from(observers).forEach(notify => notify()));
    expect(panel(3).dataset.submenuSide).toBe("left");
    expect(Number(panel().dataset.dropdownMeasuredWidth)).toBe(152);
    expect(Number.parseFloat(panel(3).style.left) + 232).toBe(Number.parseFloat(panel().style.left));
    expect(document.activeElement).toBe(focused); expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => root.render(null)); expect(observers.size).toBe(0); expect(disconnected).toHaveBeenCalled();
  });
  it("loadingdone font event remeasures when ResizeObserver is unavailable", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      await render(); setBounds("sales-orders", 1240); await click("sales-orders");
      widths["sales-orders:2"] = 144;
      await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
      expect(Number(panel().dataset.dropdownMeasuredWidth)).toBe(144);
      expect(Number.parseFloat(panel().style.left)).toBe(window.innerWidth - 144 - 8);
    } finally { Reflect.deleteProperty(document, "fonts"); }
  });
  it("zero layout dimensions use label fallback but CSS remains max-content", async () => {
    widths["sales-orders:2"] = 0;
    await render(); setBounds("sales-orders", 1240); await click("sales-orders");
    const fallback = getAdminWorkspaceDropdownWidth("sales-orders", 2, { labels: ["商城订单", "业务订单"], viewportWidth: window.innerWidth });
    expect(Number(panel().dataset.dropdownMeasuredWidth)).toBe(fallback);
    expect(panel().style.width).toBe(""); expect(Number.parseFloat(panel().style.left)).toBe(window.innerWidth - fallback - 8);
  });
  it("CSS intrinsic same-level grid, 12px padding/10px arrow gap, tokens and mobile360!important unchanged", () => {
    const css = readFileSync(`${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`, "utf8");
    const scoped = css.slice(css.indexOf("/* Unified dropdown selections override"));
    expect(scoped).toMatch(/workspace-panel\s*\{[^}]*width: max-content;/);
    expect(scoped).not.toMatch(/width:\s*(160|168|176)px/);
    expect(scoped).toMatch(/workspace-panel\[data-workspace\]\[data-navigation-level\]\s*\{\s*width: max-content;/);
    expect(scoped).toContain("max-width: calc(100vw - 16px)");
    expect(scoped).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(scoped).toMatch(/workspace-panel \.admin-workspace-nav__dropdown-item\s*\{\s*min-height: 40px;\s*padding: 0 12px;\s*gap: 10px;/);
    expect(scoped).not.toContain("margin-left: auto");
    expect(scoped).not.toMatch(/font-size:\s*(?:12|13)px/);
    const mobile = scoped.slice(scoped.indexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/workspace-panel\s*\{[^}]*width: 360px !important;/);
    expect(mobile).toContain("max-width: calc(100vw - 24px)"); expect(mobile).toContain("left: auto !important");
    expect(css).toContain("font-size: var(--admin-font-label)");
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
  });
});
