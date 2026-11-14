// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabs, AdminWorkspaceLocation } from "./AdminWorkspaceNavigation";
import { getAdminWorkspaceNavigationState, groupAdminWorkspaceNavigationItems } from "./adminWorkspaceNavigationModel";
vi.mock("./InquiryReceptionNavigationBadge", () => ({ default: () => null }));
const items = [
  { path: "/workbench/customers", label: "客户列表" },
  { path: "/analytics", label: "运营数据" },
  { path: "/profile", label: "个人中心" },
  { path: "/staff", label: "员工与权限" },
];
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("个人中心独立导航及客户详情紧凑位置", () => {
  it("个人中心位于平台运营右侧，保留原授权条目对象", async () => {
    const onNavigate = vi.fn();
    await act(async () => root.render(React.createElement(WorkspaceTabs, { items, location: "/profile", onNavigate })));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"]')];
    expect(buttons.map(button => button.textContent?.replace("▾", "").trim())).toEqual(["客户列表", "平台运营", "个人中心", "组织与权限"]);
    const personal = buttons.find(button => button.dataset.workspaceDirectItem === "/profile")!;
    expect(personal.getAttribute("aria-current")).toBe("page");
    expect(personal.hasAttribute("aria-expanded")).toBe(false);
    await act(async () => personal.click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(items[2]);
    expect(host.querySelector('[data-workspace-dropdown="layer"]')).toBeNull();
  });
  it("没有父条目时不伪造个人中心或业务授权", () => {
    expect(groupAdminWorkspaceNavigationItems(items.filter(item => item.path !== "/profile")).some(workspace => workspace.id === "personal")).toBe(false);
    const state = getAdminWorkspaceNavigationState([], "/profile");
    expect(state.route?.workspaceId).toBe("personal");
    expect(state.activeItem).toBeNull();
  });
  it("只移除客户详情位置整行，客户列表及其他模块仍保留", async () => {
    for (const location of ["/workbench/customers/19?tab=company", "/workbench/customers/19?tab=demands", "/workbench/customers/new/19"]) {
      await act(async () => root.render(React.createElement(AdminWorkspaceLocation, { items, location })));
      expect(host.querySelector('[data-admin-navigation="current-location"]')).toBeNull();
    }
    await act(async () => root.render(React.createElement(AdminWorkspaceLocation, { items, location: "/workbench/customers?kw=A" })));
    expect(host.querySelector('[data-admin-navigation="current-location"]')?.textContent).toContain("客户列表");
    await act(async () => root.render(React.createElement(AdminWorkspaceLocation, { items, location: "/analytics" })));
    expect(host.querySelector('[data-admin-navigation="current-location"]')?.textContent).toContain("平台运营");
  });
});
