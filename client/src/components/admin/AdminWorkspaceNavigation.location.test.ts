// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminWorkspaceLocation } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
import { CHANNEL_INVENTORY_ROUTE, CHANNEL_INVENTORY_TABS } from "@/lib/channelInventoryNavigation";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(path =>
  Object.freeze({ path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path })
);

function render(location: string, visibleItems = items) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(AdminWorkspaceLocation, { items: visibleItems, location }));
  return host;
}

function labels(host: Element) {
  return Array.from(host.querySelectorAll("li")).map(li => li.lastElementChild?.textContent);
}

function layout(host: Element) {
  return host.querySelector('nav[aria-label="当前位置"]')?.getAttribute("data-admin-list-location-layout");
}

describe("只读当前位置：不恢复第二行导航，不替代页面标题和操作", () => {
  it.each(CHANNEL_INVENTORY_TABS)("渠道 $id 位置来自实际ciTab而顶级标签固定", tab => {
    const host = render(`${CHANNEL_INVENTORY_ROUTE}?merchantId=31&ciTab=${tab.id}#detail`);
    expect(labels(host)).toEqual(tab.id === "materials" ? ["库存列表"]
      : ["库存列表", ...(tab.id === "channels" ? ["渠道库存"] : []), tab.label]);
    expect(host.querySelector('nav[aria-label="当前位置"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(tab.id === "materials" ? "库存列表" : tab.label);
    expect(host.querySelectorAll("button, a, h1, h2")).toHaveLength(0);
    expect(host.querySelector('[data-admin-navigation="module-tabs"]')).toBeNull();
    expect(layout(host)).toBe(tab.id === "materials" ? "root-hidden" : null);
  });

  it.each([
    ["?ciTab=invalid", ["库存列表"]],
    ["?supplyChannelId=22&supplyTab=materials", ["库存列表"]],
    ["?supplyChannelId=22&supplyTab=details", ["库存列表", "渠道库存", "渠道档案"]],
    ["?supplyChannelId=0&supplyTab=materials", ["库存列表", "渠道库存", "渠道档案"]],
    ["?supplyChannelId=0&supplyTab=materials&ciTab=trash", ["库存列表", "回收站"]],
    ["?ciTab=batches#ciTab=channels", ["库存列表", "上传批次"]],
    ["?ciTab=materials&ciView=flat", ["库存列表"]],
    ["?ciTab=materials&ciView=channels", ["库存列表", "渠道库存"]],
    ["?ciTab=materials&ciView=invalid", ["库存列表"]],
    ["?ciTab=materials&ciView=flat#ciView=channels", ["库存列表"]],
    ["?ciTab=trash&ciView=channels", ["库存列表", "回收站"]],
  ])("渠道查询%s严格复用既有解析", (query, expected) => {
    const host = render(`${CHANNEL_INVENTORY_ROUTE}${query}`);
    expect(labels(host)).toEqual(expected);
    expect(layout(host)).toBe(expected.length === 1 ? "root-hidden" : null);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(expected.at(-1));
    expect(host.querySelector('[aria-hidden="true"][aria-label="当前位置"]')).toBeNull();
  });

  it.each([
    "/workbench/customers", "/workbench/customers/?merchantId=31#entry", "/workbench/customers///",
    "/workbench", "/workbench/?ciTab=materials&ciView=flat", `${CHANNEL_INVENTORY_ROUTE}/?ciTab=materials`,
  ])("%s 只新增根布局 marker，保留原 nav 和当前名称", location => {
    const host = render(location);
    expect(layout(host)).toBe("root-hidden");
    expect(labels(host)).toEqual([location.startsWith("/workbench/customers") ? "客户列表" : "库存列表"]);
    expect(host.querySelectorAll('nav[data-admin-navigation="current-location"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('nav[hidden], nav[aria-hidden="true"]')).toBeNull();
  });

  it.each([
    ["/merchants/?page=2#lookup", ["平台运营", "基础资料", "商户管理"]],
    ["/staff/", ["组织与权限", "员工与权限"]],
    ["/admins/?status=active", ["组织与权限", "员工与权限"]],
  ])("%s 真实根页保持原 breadcrumb 名称", (location, expected) => {
    const host = render(location);
    expect(layout(host)).toBe("list-breadcrumb");
    expect(labels(host)).toEqual(expected);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(expected.at(-1));
  });

  it.each([
    "/workbench/customers/88", "/workbench/customers/88/?merchantId=31#detail",
    "/workbench/channel-inventory/88", "/merchants/88", "/staff/88", "/admins/88", "/workbench/add-user",
  ])("%s 的原详情/别名 context 保留且不带根布局 marker", location => {
    const host = render(location);
    expect(host.querySelector('nav[aria-label="当前位置"]')).not.toBeNull();
    expect(layout(host)).toBeNull();
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it.each([
    ["/workbench/customers/88?merchantId=31", ["客户列表"]],
    ["/workbench/sales-orders/8", ["业务工作台", "销售与询价", "销售订单"]],
    ["/workbench/chat/8", ["业务工作台", "销售与询价", "询价接待"]],
    ["/workbench", ["库存列表"]],
    ["/workbench/outbound", ["业务工作台", "库存管理", "出库管理"]],
    ["/workbench/procurement/orders/8", ["业务工作台", "采购管理", "采购订单"]],
    ["/materials/8", ["平台运营", "基础资料", "物料数据库"]],
    ["/portal-users/8", ["平台运营", "基础资料", "平台用户"]],
    ["/orders/8", ["平台运营", "交易与服务", "平台订单"]],
    ["/messages", ["平台运营", "交易与服务", "消息中心"]],
    ["/exception-logs/8", ["平台运营", "数据与监控", "异常日志"]],
    ["/admins/8", ["组织与权限", "员工与权限"]],
  ])("%s由真实canonical授权模块生成位置", (location, expected) => {
    expect(labels(render(location))).toEqual(expected);
  });

  it.each(["/unknown", "/profile", "/workbench/company", "/workbench/company-info", "/workbench/channel-inventory-other?ciTab=trash"])("%s没有合法已授权可见模块时不编造位置", location => {
    expect(render(location).children).toHaveLength(0);
  });

  it("隐藏canonical或渠道入口后不因路由/查询暴露名称", () => {
    const visible = items.filter(item => ["/materials", "/workbench/inbound"].includes(item.path));
    for (const location of ["/workbench/sales-orders/8", "/workbench/channel-inventory?ciTab=trash", "/staff"]) {
      expect(render(location, visible).children).toHaveLength(0);
    }
    expect(render("/materials", []).children).toHaveLength(0);
  });

  it.each(["owner", "admin", "staff", "restricted"])("%s 已授权 items 快照不含目标时仍 null，marker 不合成权限", () => {
    const restricted = items.filter(item => ["/materials", "/workbench/inbound"].includes(item.path));
    for (const location of ["/workbench", "/workbench/customers", "/workbench/customers/88", CHANNEL_INVENTORY_ROUTE, "/merchants", "/staff", "/admins"]) {
      expect(render(location, restricted).children).toHaveLength(0);
      expect(render(location, []).children).toHaveLength(0);
    }
  });

  it("URL/query/权限变化直接更新纯展示，无请求/历史写入/焦点变化，页面节点不被替换", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const fetch = vi.spyOn(globalThis, "fetch");
    const history = vi.spyOn(window.history, "pushState");
    const replaceHistory = vi.spyOn(window.history, "replaceState");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const view = (location: string, visible = items) => createElement(React.Fragment, null,
      createElement(AdminWorkspaceLocation, { items: visible, location }),
      createElement("article", { "data-page": "retained" },
        createElement("h1", null, "既有页面标题"),
        createElement("button", { "data-action": "retained" }, "既有操作")));
    try {
      await act(async () => root.render(view(`${CHANNEL_INVENTORY_ROUTE}?ciTab=channels`)));
      const page = host.querySelector("article");
      const action = host.querySelector<HTMLButtonElement>("[data-action]")!;
      await act(async () => action.focus());
      focus.mockClear();
      for (const location of [CHANNEL_INVENTORY_ROUTE, "/workbench", "/workbench/customers", "/workbench/customers/88", "/merchants", "/staff", "/admins"]) {
        await act(async () => root.render(view(location)));
        expect(document.activeElement).toBe(action);
        expect(host.querySelector("article")).toBe(page);
        expect(host.querySelector('nav[aria-label="当前位置"]')).not.toBeNull();
      }
      await act(async () => root.render(view(`${CHANNEL_INVENTORY_ROUTE}?ciTab=batches`)));
      expect(labels(host)).toEqual(["库存列表", "上传批次"]);
      expect(document.activeElement).toBe(action);
      expect(host.querySelector("article")).toBe(page);
      await act(async () => root.render(view("/workbench/sales-orders/8")));
      expect(labels(host)).toEqual(["业务工作台", "销售与询价", "销售订单"]);
      await act(async () => root.render(view("/workbench/sales-orders/8", [])));
      expect(host.querySelector('[data-admin-navigation="current-location"]')).toBeNull();
      expect(host.querySelector("article")).toBe(page);
      expect(host.querySelector("h1")?.textContent).toBe("既有页面标题");
      expect(fetch).not.toHaveBeenCalled();
      expect(history).not.toHaveBeenCalled();
      expect(replaceHistory).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.restoreAllMocks();
    }
  });
});
