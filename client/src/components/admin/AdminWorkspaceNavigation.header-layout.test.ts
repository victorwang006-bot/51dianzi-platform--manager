// @vitest-environment jsdom
import * as React from "react";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import * as ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";

// Local, frozen authorization fixtures only; not demo or production badge data.
const items = Object.freeze([
  ["/workbench/customers", "客户列表"], ["/workbench/channel-inventory", "库存列表"],
  ["/workbench/mall-materials", "商城物料"], ["/workbench/inquiries", "询价接待"],
  ["/workbench/procurement-demands", "采购需求"], ["/workbench/inbound", "采购入库"],
  ["/workbench/orders", "销售订单"], ["/orders", "平台订单"],
  ["/workbench/outbound", "出库管理"],
  ["/profile", "个人中心"], ["/messages", "消息管理"], ["/staff", "员工管理"],
].map(([path, label]) => Object.freeze({ path, label, context: Object.freeze({ fixture: true }) })));
type Item = typeof items[number];
const itemFor = (path: string) => items.find(item => item.path === path)!;
const primaryIds = ["customers", "inventory", "mall-materials", "inquiries", "procurement-management", "inventory-management", "sales-orders", "personal", "operations", "organization"];
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  onNavigate.mockReset(); onPreload.mockReset();
  Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_TEST_NO_NETWORK"); }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    left: 10, right: 130, top: 0, bottom: 52, width: 120, height: 52, x: 10, y: 0, toJSON() {},
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(visible: readonly Item[] = items, location = "/workbench/customers", badgeCount = 0) {
  await act(async () => root.render(h(AdminWorkspaceTabs, {
    items: visible, location, onNavigate, onPreload,
    renderBadge: (item: Item) => badgeCount > 0 ? h("span", { "data-test-badge": item.path }, badgeCount) : null,
  })));
}
const nav = () => host.querySelector<HTMLElement>('[data-admin-navigation="unified-dropdown"]')!;
const target = (id: string) => host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${id}"]`)!;
const primaryButtons = () => Array.from(nav().querySelectorAll<HTMLButtonElement>(':scope > button[data-navigation-level="1"]'));
const primaryTargets = () => primaryButtons().map(button => button.getAttribute("data-workspace-nav-target"));
async function click(id: string) { await act(async () => target(id).click()); }
async function key(element: HTMLElement, value: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}

const components = resolve(import.meta.dirname, "..");
const layoutSource = readFileSync(resolve(components, "DashboardLayout.tsx"), "utf8");
const navSource = readFileSync(resolve(import.meta.dirname, "AdminWorkspaceNavigation.tsx"), "utf8");
function parseSource(file: string, source: string) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNodes<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(current: ts.Node) { if (predicate(current)) found.push(current); ts.forEachChild(current, visit); }
  visit(node); return found;
}
function cssDeclarations(selector: string) {
  const declarations: Record<string, string> = {};
  postcss.parse(readFileSync(resolve(import.meta.dirname, "AdminWorkspaceNavigation.css"), "utf8"))
    .walkRules(rule => { if (rule.selector === selector) rule.walkDecls(decl => { declarations[decl.prop] = decl.value; }); });
  return declarations;
}

describe("原导航恢复合同：同级自然宽度、内部滚动、原对象与原层级", () => {
  it.each([1920, 1050, 390])("%spx 的全部授权一级入口直接同级，不新增 More 或固定业务/功能组", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    await render();
    expect(primaryTargets()).toEqual(primaryIds);
    expect(primaryButtons().every(button => button.parentElement === nav())).toBe(true);
    expect(target("more")).toBeNull();
    expect(host.querySelector('[data-admin-navigation-group]')).toBeNull();
    expect(host.querySelector('.admin-workspace-nav__primary-cell, .admin-workspace-nav__badge-slot, .admin-workspace-nav__arrow-slot')).toBeNull();
  });

  it("原 CSS 合同采用 nav 横向滚动和按钮自然宽度，而不是固定网格槽", () => {
    expect(cssDeclarations(".admin-workspace-nav__tabs")).toMatchObject({ display: "flex", "min-width": "0", "overflow-x": "auto", "overflow-y": "hidden" });
    const button = cssDeclarations(".admin-workspace-nav__tab");
    expect(button).toMatchObject({ "flex": "0 0 auto", "white-space": "nowrap" });
    expect(button).not.toHaveProperty("width");
    expect(button).not.toHaveProperty("grid-template-columns");
    expect(layoutSource).not.toContain('import "./admin/AdminHeaderNavigation.css"');
    expect(navSource).not.toMatch(/adminHeaderNavigationLayout|overflowIds|moreTriggerRef|accountMenu|admin-workspace-nav__(?:business|utilities|badge-slot|arrow-slot)/);
  });

  it.each([
    ["customers", "/workbench/customers"], ["mall-materials", "/workbench/mall-materials"],
    ["inquiries", "/workbench/inquiries"], ["procurement-management", "/workbench/procurement-demands"],
    ["inventory-management", "/workbench/inbound"], ["personal", "/profile"],
  ])("%s 点击仍以同一个父授权对象调用一次 onNavigate", async (id, path) => {
    await render(); await click(id);
    expect(onNavigate.mock.calls).toEqual([[itemFor(path)]]);
    expect(onNavigate.mock.calls[0][0]).toBe(itemFor(path));
  });

  it("库存入口保留原对象及 materials/flat 路由意图", async () => {
    await render(); await click("inventory");
    expect(onNavigate.mock.calls).toEqual([[itemFor("/workbench/channel-inventory"), "materials", "flat"]]);
    expect(onNavigate.mock.calls[0][0]).toBe(itemFor("/workbench/channel-inventory"));
  });

  it.each([["/workbench/orders", "business"], ["/workbench/outbound", "mall"]])("销售来源 %s 保留来源意图和真实授权对象", async (path, source) => {
    await render(); await click("sales-orders");
    const panel = host.querySelector<HTMLElement>('[data-workspace="sales-orders"][data-workspace-dropdown="panel"]')!;
    expect(panel.getAttribute("data-navigation-level")).toBe("2");
    const leaf = panel.querySelector<HTMLButtonElement>(`[data-order-source="${source}"]`)!;
    await act(async () => leaf.click());
    expect(onNavigate.mock.calls).toEqual([[itemFor(path), undefined, undefined, source]]);
    expect(onNavigate.mock.calls[0][0]).toBe(itemFor(path));
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
  });

  it("运营保留二/三级原菜单，Escape 回到运营入口焦点", async () => {
    await render(); await click("operations"); await click("group:transactions-services");
    expect(host.querySelector('[data-navigation-level="3"][data-workspace-dropdown="panel"]')).not.toBeNull();
    await key(document.body, "Escape");
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
    expect(document.activeElement).toBe(target("operations"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("运营三级消息叶仍传原对象，并同步关闭菜单", async () => {
    await render(); await click("operations"); await click("group:transactions-services"); await click("/messages");
    expect(onNavigate.mock.calls).toEqual([[itemFor("/messages")]]);
    expect(onNavigate.mock.calls[0][0]).toBe(itemFor("/messages"));
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
  });

  it("横向键只移动同级焦点；预加载也只收到原授权对象", async () => {
    await render();
    await act(async () => target("customers").focus());
    await key(target("customers"), "ArrowRight");
    expect(document.activeElement).toBe(target("inventory"));
    await key(target("inventory"), "End");
    expect(document.activeElement).toBe(target("organization"));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onPreload.mock.calls.every(([item]) => items.includes(item))).toBe(true);
  });

  it("原内部 scroller 滚动只重锚原桌面菜单，resize 不折叠入口", async () => {
    await render(); await click("operations");
    await act(async () => nav().dispatchEvent(new Event("scroll")));
    expect(host.querySelector('[data-workspace="operations"][data-workspace-dropdown="panel"]')).not.toBeNull();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
    expect(primaryTargets()).toEqual(primaryIds);
    expect(target("more")).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });

  it("移动端继续使用原菜单 drawer，不把授权入口搬进 More", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await render(); await click("operations"); await click("group:transactions-services");
    expect(host.querySelector('[data-workspace-dropdown="layer"]')?.getAttribute("data-drawer")).toBe("true");
    const back = host.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!;
    await act(async () => back.click());
    expect(host.querySelector('[data-navigation-level="3"][data-workspace-dropdown="panel"]')).toBeNull();
    expect(primaryTargets()).toEqual(primaryIds);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("撤权立即删除入口/旧菜单，空授权不合成业务入口", async () => {
    await render(); await click("sales-orders");
    await render(items.filter(item => item.path !== "/workbench/orders" && item.path !== "/workbench/outbound"));
    expect(target("sales-orders")).toBeNull();
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
    await render([]); expect(nav()).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });

  it("URL/query 驱动当前项与菜单关闭，不引入本地路由选择", async () => {
    await render(items, "/workbench/inquiries?filter=unread");
    expect(target("inquiries").getAttribute("aria-current")).toBe("page");
    await click("operations"); await render(items, "/workbench/customers?search=local");
    expect(target("customers").getAttribute("aria-current")).toBe("page");
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("动态真实角标回调继续直接渲染；零值没有永久空槽", async () => {
    await render(); expect(host.querySelector('[data-test-badge]')).toBeNull();
    const customer = target("customers");
    await render(items, "/workbench/customers", 1);
    expect(target("customers")).toBe(customer);
    expect(customer.querySelector('[data-test-badge]')?.textContent).toBe("1");
    await render(items, "/workbench/customers", 2);
    expect(customer.querySelector('[data-test-badge]')?.textContent).toBe("2");
    expect(primaryTargets()).toEqual(primaryIds);
    expect(host.querySelector('.admin-workspace-nav__badge-slot, .admin-workspace-nav__arrow-slot')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Dashboard header 只含 brand/Tabs/独立完整账号节点，账号不再是 Tabs prop", () => {
    const sourceFile = parseSource("DashboardLayout.tsx", layoutSource);
    const header = findNodes(sourceFile, (node): node is ts.JsxElement => ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === "header")[0];
    const children = header.children.filter(child => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
    expect(children.map(child => ts.isJsxElement(child) ? child.openingElement.tagName.getText(sourceFile) : (child as ts.JsxSelfClosingElement).tagName.getText(sourceFile))).toEqual(["a", "AdminWorkspaceTabs", "DropdownMenu"]);
    const tabs = children[1] as ts.JsxSelfClosingElement;
    expect(tabs.attributes.properties.map(attribute => ts.isJsxAttribute(attribute) ? attribute.name.getText(sourceFile) : "spread")).toEqual(["items", "location", "onNavigate", "onPreload", "renderBadge"]);
    const account = children[2].getText(sourceFile);
    expect(account).toContain("<DropdownMenuTrigger asChild>");
    expect(account).toContain('className="admin-workspace-shell__account');
    expect(account).toContain('if (canManageProfile) preloadAdminRoute("profile")');
    expect(account).toContain("{accountRoleLabel}");
    expect(account).toContain('onClick={() => setLocation("/profile")}');
    expect(account).toContain("onClick={logout}");
    expect(account).toContain("退出登录");
    expect(layoutSource).not.toContain("accountMenu={");
  });

  it("Status 仍删除；原 NIProvider、真实 badge 和未读修复保留，未恢复客户同步行", () => {
    expect(layoutSource).not.toContain("AdminNewInformationStatus");
    expect(existsSync(resolve(import.meta.dirname, "AdminNewInformationStatus.tsx"))).toBe(false);
    expect(existsSync(resolve(import.meta.dirname, "AdminNewInformationStatus.css"))).toBe(false);
    expect(layoutSource).toContain("<AdminNewInformationProvider client={newInformationClient}");
    expect(layoutSource).toContain("canRead={newInformationCanRead} moduleCanRead={newInformationModuleCanRead}");
    expect(layoutSource).toContain("<AdminNewInformationMenuBadge module={module} source={source");
    expect(layoutSource).toContain("getAdminMessageUnreadQueryOptions(canReadMessages)");
    expect(layoutSource).toContain("getAdminMessageUnreadTotal({");
    expect(layoutSource).toContain("if (!visibleMenuItems.includes(item)) return;");
    expect(layoutSource).not.toMatch(/客户同步|同步客户/);
    expect(layoutSource + navSource).not.toContain("HeaderNavigationRestoreDemo");
  });
});
