// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import {
  ADMIN_SYSTEM_RELEASE,
  AdminModuleTabs,
  AdminWorkspaceTabs,
  type AdminModuleTabsProps,
} from "./AdminWorkspaceNavigation";
import {
  ADMIN_WORKBENCH_NAVIGATION_GROUPS,
  getAdminWorkbenchNavigationRoute,
} from "./adminWorkbenchNavigationModel";

const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(
  path => Object.freeze({
    path,
    label: getAdminWorkbenchNavigationRoute(path)?.label ?? path,
    permission: `permission:${path}`,
    chunk: `chunk:${path}`,
    merchantContext: Object.freeze({ merchantId: 31, returnTo: "/orders" }),
  })
);
type Item = (typeof items)[number];
const businessPaths = [
  "/workbench/channel-inventory",
  "/workbench/customers",
  "/workbench/customer-demands",
  "/workbench/inquiries",
  "/workbench/orders",
  "/workbench/inventory",
  "/workbench/publish",
  "/workbench/inbound",
  "/workbench/outbound",
  "/workbench/procurement-demands",
  "/workbench/procurement-orders",
  "/workbench/company-info",
];
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

async function render(
  location = "/workbench/orders?merchantId=31",
  overrides: Partial<AdminModuleTabsProps<Item>> = {},
  withModuleTabs = false
) {
  const props: AdminModuleTabsProps<Item> = {
    items,
    location,
    onNavigate,
    onPreload,
    ...overrides,
  };
  await act(async () => root.render(createElement(
    React.Fragment,
    null,
    createElement(AdminWorkspaceTabs<Item>, props),
    withModuleTabs ? createElement(AdminModuleTabs<Item>, props) : null
  )));
}

function button(target: string) {
  const node = host.querySelector<HTMLButtonElement>(
    `button[data-workspace-nav-target="${target}"]`
  );
  if (!node) throw new Error(`Missing navigation button: ${target}`);
  return node;
}

function panel() {
  return host.querySelector<HTMLDivElement>(
    '[data-admin-navigation="business-dropdown"]'
  );
}

function itemPaths() {
  return Array.from(panel()?.querySelectorAll<HTMLButtonElement>(
    "[data-business-dropdown-item]"
  ) ?? []).map(node => node.dataset.businessDropdownItem);
}

async function click(target: string) {
  await act(async () => button(target).click());
}

async function key(target: string, value: string) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => button(target).dispatchEvent(event));
  return event;
}

function subset(paths: string[]) {
  return items.filter(item => paths.includes(item.path));
}

describe("业务一级分组下拉（focused component tests）", () => {
  it("当前business也可重复开关，trigger不导航且悬停只预加载", async () => {
    await render();
    const trigger = button("business");
    expect(trigger.getAttribute("aria-current")).toBe("location");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.dispatchEvent(new MouseEvent("pointerover", {
      bubbles: true,
    })));
    expect(panel()).toBeNull();
    expect(onPreload).toHaveBeenCalledWith(items.find(item => item.path === businessPaths[0]));
    await click("business");
    expect(panel()?.id).toBe(trigger.getAttribute("aria-controls"));
    expect(panel()?.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await click("business");
    expect(panel()).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-system-version]")?.getAttribute("data-system-version"))
      .toBe(ADMIN_SYSTEM_RELEASE);
  });

  it("direct/group顺序固定且所有授权子项一次平铺，没有连续多层弹出", async () => {
    await render("/workbench/sales-orders/8?merchantId=31#detail");
    await click("business");
    const content = panel()!.querySelector('[data-business-dropdown="content"]')!;
    expect(Array.from(content.children).map(node =>
      node.getAttribute("data-business-direct") ?? node.getAttribute("data-business-group")
    )).toEqual([
      "/workbench/channel-inventory", "customers", "inventory", "procurement", "/workbench/company-info",
    ]);
    expect(itemPaths()).toEqual(businessPaths);
    expect(panel()!.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(host.querySelectorAll('[data-admin-navigation="business-dropdown"]')).toHaveLength(1);
    expect(Array.from(panel()!.querySelectorAll("[data-business-group]")).map(node => node.textContent))
      .toEqual([
        "客户与销售客户列表客户需求询价接待销售订单",
        "库存管理我的库存发布库存入库管理出库管理",
        "采购管理采购需求采购订单",
      ]);
    expect(button("/workbench/orders").getAttribute("aria-current")).toBe("page");
    expect(panel()!.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(panel()!.querySelector('[data-business-group="customers"]')?.getAttribute("data-active"))
      .toBe("true");
  });

  it("权限严格取items交集，空组/隐藏direct不显示且隐藏canonical别名不高亮", async () => {
    const visible = subset(["/workbench/inbound", "/workbench/company-info", "/analytics"]);
    await render("/workbench/sales-orders/8", { items: visible });
    await click("business");
    expect(itemPaths()).toEqual(["/workbench/inbound", "/workbench/company-info"]);
    expect(panel()!.querySelectorAll("[data-business-group]")).toHaveLength(1);
    expect(panel()!.textContent).not.toContain("客户与销售");
    expect(panel()!.textContent).not.toContain("采购管理");
    expect(panel()!.querySelector("[aria-current]")).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="/workbench/channel-inventory"]')).toBeNull();
    await render("/analytics", { items: subset(["/analytics"]) });
    expect(button("operations").getAttribute("aria-current")).toBe("location");
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    expect(panel()).toBeNull();
    await render("/workbench/orders", { items: [] });
    expect(host.querySelectorAll("nav, button")).toHaveLength(0);
  });

  it("ops页可打开business，但高亮和原运营二级菜单仍严格跟实际route", async () => {
    await render("/materials/8?tab=details", {}, true);
    expect(button("operations").getAttribute("aria-current")).toBe("location");
    expect(button("/materials").getAttribute("aria-current")).toBe("page");
    await click("business");
    expect(itemPaths()).toEqual(businessPaths);
    expect(panel()!.querySelector("[aria-current]")).toBeNull();
    expect(button("business").hasAttribute("aria-current")).toBe(false);
    await click("/workbench/inventory");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
    expect(button("operations").getAttribute("aria-current")).toBe("location");
    expect(button("/materials").getAttribute("aria-current")).toBe("page");
    await render("/workbench/inventory");
    await click("business");
    expect(button("/workbench/inventory").getAttribute("aria-current")).toBe("page");
  });

  it.each(businessPaths)("%s只回传父原条目一次，先收起、保留preload完整参数", async path => {
    const original = items.find(item => item.path === path)!;
    const intent = vi.fn();
    const navigate = vi.fn((item: Item) => {
      expect(host.querySelector<HTMLDivElement>('[data-business-dropdown="layer"]')?.hidden).toBe(true);
      expect(button("business").getAttribute("aria-expanded")).toBe("false");
      expect(item).toBe(original);
    });
    await render("/workbench/orders?merchantId=31&returnTo=%2Forders", {
      onNavigate: navigate,
      onItemIntent: intent,
    });
    await click("business");
    await act(async () => button(path).focus());
    await act(async () => button(path).dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(onPreload.mock.calls.every(call => call.length === 1 && call[0] === original)).toBe(true);
    expect(onPreload).toHaveBeenCalledWith(original);
    expect(intent).not.toHaveBeenCalled();
    await click(path);
    expect(navigate.mock.calls).toEqual([[original]]);
    expect(navigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext);
    expect(panel()).toBeNull();
    expect(button("business").getAttribute("aria-current")).toBe("location");
  });

  it("onItemIntent作为preload别名保留；renderItem/badge只是内容且状态来自route", async () => {
    const intent = vi.fn();
    await render("/workbench/chat/8", {
      onPreload: undefined,
      onItemIntent: intent,
      renderItem: (item, state) => createElement("span", {
        "data-render-active": String(state.isActive),
        "data-render-workspace": state.workspaceId,
      }, item.label),
      renderBadge: item => item.path === "/workbench/inquiries"
        ? createElement("span", { "data-business-unread": true }, "3") : null,
    });
    await click("business");
    const inquiry = button("/workbench/inquiries");
    expect(inquiry.querySelector("[data-business-unread]")?.textContent).toBe("3");
    expect(inquiry.querySelector("[data-render-active]")?.getAttribute("data-render-active")).toBe("true");
    expect(inquiry.querySelector("[data-render-workspace]")?.getAttribute("data-render-workspace")).toBe("business");
    expect(inquiry.querySelector("button, a")).toBeNull();
    await act(async () => inquiry.focus());
    expect(intent).toHaveBeenCalledWith(items.find(item => item.path === "/workbench/inquiries"));
  });

  it.each(["Enter", " "])("%s开关，上下/Home/End跨组遍历；Esc恢复trigger焦点", async activation => {
    await render();
    await act(async () => button("business").focus());
    expect((await key("business", activation)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button(businessPaths[0]));
    await key(businessPaths[0], "ArrowDown");
    expect(document.activeElement).toBe(button(businessPaths[1]));
    await key(businessPaths[1], "End");
    expect(document.activeElement).toBe(button(businessPaths.at(-1)!));
    await key(businessPaths.at(-1)!, "ArrowDown");
    expect(document.activeElement).toBe(button(businessPaths[0]));
    await key(businessPaths[0], "ArrowUp");
    expect(document.activeElement).toBe(button(businessPaths.at(-1)!));
    await key(businessPaths.at(-1)!, "Home");
    expect(document.activeElement).toBe(button(businessPaths[0]));
    await key(businessPaths[0], "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("business"));
    await key("business", "ArrowUp");
    expect(document.activeElement).toBe(button(businessPaths.at(-1)!));
    await act(async () => button("business").focus());
    await key("business", activation);
    expect(panel()).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(["click", "pointerdown", "focus"])("外部%s收起且不抢外部焦点", async action => {
    await render();
    await click("business");
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      await act(async () => {
        if (action === "focus") outside.focus();
        else outside.dispatchEvent(new Event(action, { bubbles: true }));
      });
      expect(panel()).toBeNull();
      if (action === "focus") expect(document.activeElement).toBe(outside);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it("移动抽屉关闭按钮/遮罩关闭并恢复焦点，同一面板包含相同条目", async () => {
    await render();
    await click("business");
    expect(itemPaths()).toEqual(businessPaths);
    await act(async () => panel()!.querySelector<HTMLButtonElement>('[data-business-dropdown="close"]')!.click());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("business"));
    await click("business");
    await act(async () => host.querySelector<HTMLDivElement>('[data-business-dropdown="backdrop"]')!.click());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button("business"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("location/query/hash变化即时收起，返回旧location不迟到重开", async () => {
    await render("/workbench/orders?merchantId=31");
    await click("business");
    await render("/workbench/orders?merchantId=32");
    expect(panel()).toBeNull();
    await render("/workbench/orders?merchantId=31");
    expect(panel()).toBeNull();
    await key("business", "Enter");
    await render("/materials");
    expect(panel()).toBeNull();
    await render("/workbench/orders?merchantId=31");
    expect(panel()).toBeNull();
    await click("business");
    await render("/workbench/orders?merchantId=31#detail");
    expect(panel()).toBeNull();
  });

  it("items引用变更（包括相同授权）立即收起，恢复旧items不会迟到显示", async () => {
    await render();
    await key("business", "Enter");
    await render(undefined, { items: [...items] });
    expect(panel()).toBeNull();
    await render();
    expect(panel()).toBeNull();
    await click("business");
    await render(undefined, { items: subset(["/workbench/company-info", "/analytics"]) });
    expect(panel()).toBeNull();
    await click("business");
    expect(itemPaths()).toEqual(["/workbench/company-info"]);
  });

  it("批量open后紧接更新route/items不保留待执行焦点或延迟弹出", async () => {
    await render();
    await act(async () => {
      button("business").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      root.render(createElement(AdminWorkspaceTabs<Item>, {
        items: subset(["/workbench/company-info", "/analytics"]),
        location: "/analytics",
        onNavigate,
        onPreload,
      }));
    });
    expect(panel()).toBeNull();
    await act(async () => Promise.resolve());
    expect(panel()).toBeNull();
    expect(button("operations").getAttribute("aria-current")).toBe("location");
  });

  it("Tab保持原生行为，panel内部滚动不关；resize/导航滚动收起", async () => {
    await render();
    await key("business", "ArrowDown");
    expect((await key(businessPaths[0], "Tab")).defaultPrevented).toBe(false);
    await act(async () => panel()!.querySelector('[data-business-dropdown="content"]')!.dispatchEvent(new Event("scroll")));
    expect(panel()).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(panel()).toBeNull();
    await click("business");
    await act(async () => host.querySelector('[data-admin-navigation="workspace-tabs"]')!.dispatchEvent(new Event("scroll")));
    expect(panel()).toBeNull();
  });

  it("运营/组织一级按钮原行为保持：当前项不导航，其他项只导航首个授权原对象", async () => {
    const visible = subset(["/workbench/company-info", "/materials", "/staff"]);
    await render("/materials/8", { items: visible }, true);
    await click("operations");
    expect(onNavigate).not.toHaveBeenCalled();
    await click("business");
    expect(panel()).not.toBeNull();
    await click("organization");
    expect(panel()).toBeNull();
    expect(onNavigate.mock.calls).toEqual([[visible.find(item => item.path === "/staff")]]);
    expect(button("operations").getAttribute("aria-current")).toBe("location");
    await render("/staff", { items: visible }, true);
    expect(button("/staff").getAttribute("aria-current")).toBe("page");
    await click("organization");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    await click("operations");
    expect(onNavigate.mock.calls[1]).toEqual([visible.find(item => item.path === "/materials")]);
  });

  it("追加CSS只限定新business面板：fixed/内部滚动/767px抽屉，保留原字号色彩契约", () => {
    const css = readFileSync(`${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`, "utf8");
    const appended = css.split("/* Business primary dropdown only.")[1];
    expect(appended).toBeDefined();
    expect(appended).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
    expect(appended).toContain(".admin-workspace-nav__business-panel");
    expect(appended).toContain("position: fixed");
    expect(appended).toContain("overflow-y: auto");
    expect(appended).toContain("@media (max-width: 767px)");
    expect(appended).not.toContain("admin-workspace-shell__header");
    expect(appended).not.toContain("admin-workspace-nav__workspace {");
    expect(css).toContain("font-size: var(--admin-font-label)");
    expect(css).toContain("border-bottom-color: var(--admin-color-brand)");
  });
});
