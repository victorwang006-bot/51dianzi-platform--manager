// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPageHeader } from "./UnifiedAdminPage";
import { PageHeader } from "./shared";
import { AdminWorkspaceLocation } from "./AdminWorkspaceNavigation";

const css = readFileSync("client/src/components/admin/AdminListPage.css", "utf8");
const items = [{ path: "/merchants", label: "商户管理" }];
let host: HTMLDivElement, root: Root, style: HTMLStyleElement;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  style = document.createElement("style"); style.textContent = css; document.head.append(style);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); style.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
function shell(header: React.ReactNode, breadcrumb = true) {
  return createElement("main", { className: "admin-workspace-shell__main" },
    breadcrumb ? createElement(AdminWorkspaceLocation, { items, location: "/merchants" }) : null,
    createElement("section", { "data-admin-list-page": "true" }, header,
      createElement("input", { "aria-label": "搜索商户", defaultValue: "原筛选草稿" }),
      createElement("p", { role: "alert" }, "加载失败，请重试")));
}
describe("普通列表紧凑页头（显式opt-in且有真实当前位置）", () => {
  it.each([PageHeader, AdminPageHeader])("%s无操作页头取消标题横条与空白，H1仍在可访问树且定位完整", async Header => {
    await render(shell(createElement(Header, { title: "商户管理", list: true })));
    const heading = host.querySelector("h1")!;
    const header = host.querySelector('[data-admin-list-header="true"]')!;
    expect(host.querySelectorAll("h1")).toHaveLength(1); expect(heading.textContent).toBe("商户管理");
    expect(heading.closest('[aria-hidden="true"], [hidden]')).toBeNull();
    expect(getComputedStyle(header).height).toBe("0px"); expect(getComputedStyle(header).marginBottom).toBe("0px");
    expect(getComputedStyle(header).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(heading.parentElement!).position).toBe("absolute");
    expect(getComputedStyle(heading.parentElement!).clipPath).toBe("inset(50%)");
    expect([...host.querySelectorAll("li")].map(node => node.lastElementChild?.textContent)).toEqual(["平台运营", "基础资料", "商户管理"]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("加载失败，请重试");
  });
  it.each([PageHeader, AdminPageHeader])("%s原动作及disabled保持，路由定位改动不替换输入和焦点", async Header => {
    const action = vi.fn();
    const header = createElement(Header, { title: "商户管理", list: true, actions: createElement("div", null,
      createElement("button", { type: "button", onClick: action }, "刷新"), createElement("button", { disabled: true, onClick: action }, "不可编辑")) });
    await render(shell(header));
    const input = host.querySelector<HTMLInputElement>("input")!; await act(async () => input.focus());
    await render(shell(header)); expect(host.querySelector("input")).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.value).toBe("原筛选草稿");
    const buttons = host.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => { buttons[0].click(); buttons[1].click(); }); expect(action).toHaveBeenCalledOnce();
    expect(buttons[1].disabled).toBe(true);
    expect(getComputedStyle(host.querySelector('[data-admin-list-header="true"]')!).marginBottom).toBe("8px");
  });
  it("无已授权面包屑的独立页面以及默认详情页头不匹配紧凑选择器", async () => {
    await render(shell(createElement(AdminPageHeader, { title: "独立采购列表", list: true }), false));
    expect(getComputedStyle(host.querySelector("h1")!.parentElement!).position).not.toBe("absolute");
    expect(getComputedStyle(host.querySelector("header")!).height).not.toBe("0px");
    await render(shell(createElement(AdminPageHeader, { title: "商户详情" })));
    expect(host.querySelector('[data-admin-list-header]')).toBeNull();
    expect(getComputedStyle(host.querySelector("h1")!.parentElement!).position).not.toBe("absolute");
  });
  it("body外挂弹窗即使复用带标记页头也不受main内样式影响", async () => {
    await render(createElement(React.Fragment, null, shell(createElement(PageHeader, { title: "商户管理", list: true })),
      createElement("div", { role: "dialog" }, createElement(PageHeader, { title: "审批确认", list: true }))));
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(getComputedStyle(dialog.querySelector("h1")!.parentElement!).position).not.toBe("absolute");
    expect(getComputedStyle(dialog.querySelector("header")!).height).not.toBe("0px");
  });
  it("每条CSS均要求main和真实当前位置且只作用显式列表标记，不改全局详情或字号", () => {
    postcss.parse(css).walkRules(rule => {
      expect(rule.selector).toContain('.admin-workspace-shell__main:has(> [data-admin-navigation="current-location"])');
      expect(rule.selector).toMatch(/data-admin-list-(?:header|page)/);
      expect(rule.selector).not.toMatch(/(?:^|,)\s*(?:body|html|\*|:root)(?:\s|$)/);
    });
    expect(css).not.toMatch(/font-size|font-family|zoom:|scale\(|!important|display:\s*none/);
  });
});
