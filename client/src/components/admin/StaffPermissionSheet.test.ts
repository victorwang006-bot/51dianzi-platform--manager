// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffPermissionSheet from "./StaffPermissionSheet";
import type { StaffRow } from "@/lib/staffPermissionModel";
const mocks = vi.hoisted(() => ({
  nativeSave: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  retry: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    officialTeams: {
      setMember: { useMutation: () => ({ mutateAsync: mocks.nativeSave }) },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));
let root: Root;
let host: HTMLDivElement;
let props: React.ComponentProps<typeof StaffPermissionSheet>;
const row: StaffRow = {
  key: "admin:7",
  admin: {
    id: 7,
    username: "jack-synthetic",
    displayName: "Jack",
    phone: null,
    email: null,
    adminRole: "merchant_mgr",
    status: "active",
    permissions: ["materials.read", "profile.manage", "officialInventory.read"],
  },
  member: {
    memberId: 5,
    userId: 88,
    displayName: "业务Jack",
    phone: null,
    role: "member",
    status: "active",
    permissionKeys: ["inventory.manage"],
    inventoryDataScope: "own",
    isOwner: false,
  },
  binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 },
  bindingState: "bound",
  scopeState: "ready",
  bff: { state: "ready", missingPermissions: [], detail: "synthetic verified" },
};
async function render(key = "actor1:7") {
  await act(async () =>
    root.render(React.createElement(StaffPermissionSheet, { ...props, key }))
  );
}
function button(text: string) {
  const target = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => item.textContent === text);
  if (!target) throw new Error(`Missing button ${text}`);
  return target;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
function check(label: string) {
  const target = document.querySelector<HTMLButtonElement>(
    `[role="checkbox"][aria-label="${label}"]`
  );
  if (!target) throw new Error(`Missing checkbox ${label}`);
  return target;
}
async function toggle(label: string) {
  await act(async () => check(label).click());
}
function visiblePanel() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="tabpanel"]')
  ).filter(item => !item.hidden);
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false)
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    open: true,
    row,
    initialSection: "basic",
    canManageAdmin: true,
    saving: false,
    enterpriseAccess: {
      available: true,
      canManageMembers: true,
      actorIsOwner: true,
      currentUserId: 20,
      grantableKeys: ["inventory.manage", "inquiry.receive"],
      inviteHref: "/workbench/add-user?merchantId=30061",
    },
    officialTeamsOverview: {
      currentAccess: {
        adminUserId: 1,
        isSuperAdmin: true,
        teamId: null,
        teamRole: null,
        permissions: [],
      },
      teams: [],
      members: [],
      targets: [
        {
          adminUserId: 7,
          displayName: "Jack",
          officialPermissions: ["officialInventory.read"],
          accountVersion: 8,
        },
      ],
    },
    onRetryOfficialTeams: mocks.retry,
    onOpenChange: mocks.close,
    onSave: mocks.save,
  };
  mocks.save.mockResolvedValue({
    completed: { admin: true, erpPermissions: false, erpScope: false },
    errors: {},
  });
  mocks.nativeSave.mockImplementation(async () => ({
    member: null,
    officialPermissions: [],
    revision: 0,
    accountVersion: 9,
    requestId: "synthetic_sheet_receipt",
    idempotent: false,
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("员工五页签及统一保存当前页（仅本地合成）", () => {
  it("五真实页签仅显示当前页，员工资料合并关联，ERP含scope，安全含登录记录", async () => {
    props.securityLogs = [
      {
        id: 1,
        success: true,
        occurredAt: "2026-01-01T00:00:00Z",
        authMethod: "password",
      },
    ];
    await render();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(visiblePanel()).toHaveLength(1);
    expect(visiblePanel()[0].id).toBe("staff-panel-basic");
    expect(visiblePanel()[0].textContent).toContain("成员关联");
    await click("业务ERP");
    expect(visiblePanel()).toHaveLength(1);
    expect(visiblePanel()[0].textContent).toContain("ERP 数据范围");
    await click("账号与安全");
    expect(visiblePanel()[0].textContent).toContain("账号状态");
    expect(visiblePanel()[0].textContent).toContain("登录记录");
  });
  it("切tab保留各自草稿且平台页只保存平台修改，不提交ERP草稿也不自动关闭", async () => {
    await render();
    await click("平台权限");
    await toggle("数据物料库查看");
    await click("业务ERP");
    await toggle("询价接待");
    expect(check("询价接待").getAttribute("aria-checked")).toBe("true");
    await click("平台权限");
    expect(check("数据物料库查看").getAttribute("aria-checked")).toBe("false");
    await click("保存当前页");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].erpPermissionKeys).toEqual([
      "inventory.manage",
    ]);
    expect(mocks.save.mock.calls[0][0].adminPermissions).toEqual([]);
    expect(mocks.close).not.toHaveBeenCalled();
    await click("业务ERP");
    expect(check("询价接待").getAttribute("aria-checked")).toBe("true");
    expect(button("保存当前页").disabled).toBe(false);
  });
  it("只修改官方grant也启用统一footer并调用原生保存，绝不调用平台ERP回调", async () => {
    props.initialSection = "official-team";
    await render();
    expect(button("保存当前页").disabled).toBe(true);
    await toggle("查看渠道库存");
    expect(button("保存当前页").disabled).toBe(false);
    await click("保存当前页");
    expect(mocks.nativeSave).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(button("保存当前页").disabled).toBe(true);
  });
  it("任何页dirty关闭都确认，取消关闭保留草稿；确认才通知外层关闭", async () => {
    props.initialSection = "official-team";
    await render();
    await toggle("查看渠道库存");
    await click("员工资料");
    await click("关闭");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("关闭");
    expect(mocks.close).toHaveBeenCalledWith(false);
  });
  it("overview外部对象刷新不改变当前tab或dirty grant，切换员工的key清除旧草稿", async () => {
    await render();
    await click("渠道库存");
    await toggle("查看渠道库存");
    props = {
      ...props,
      row: { ...row },
      officialTeamsOverview: structuredClone(props.officialTeamsOverview),
    };
    await render();
    expect(visiblePanel()[0].id).toBe("staff-panel-official-team");
    expect(check("查看渠道库存").getAttribute("aria-checked")).toBe("false");
    props = {
      ...props,
      row: {
        ...row,
        key: "admin:9",
        admin: { ...row.admin!, id: 9, username: "other-synthetic" },
      },
      initialSection: "basic",
    };
    await render("actor1:9");
    expect(visiblePanel()[0].id).toBe("staff-panel-basic");
    expect(button("保存当前页").disabled).toBe(true);
  });
  it("保存失败不关闭也不清草稿，安全页及资料页不会误提交其他页", async () => {
    mocks.save.mockResolvedValue({
      completed: { admin: false, erpPermissions: false, erpScope: false },
      errors: { admin: "合成失败" },
    });
    await render();
    await click("平台权限");
    await toggle("数据物料库查看");
    await click("保存当前页");
    expect(button("保存当前页").disabled).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled();
    await click("账号与安全");
    expect(button("保存当前页").disabled).toBe(true);
    await click("员工资料");
    expect(button("保存当前页").disabled).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
