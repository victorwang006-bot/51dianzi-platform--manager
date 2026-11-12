// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    // Optional inert snapshots of the actual component/body portal, synthetic only.
    // No production queries, writes, authentication or browser measurements here.
    if (process.env.STAFF_FONT_FIXTURE_DIR) {
      mkdirSync(process.env.STAFF_FONT_FIXTURE_DIR, { recursive: true });
      for (const [label, id] of [["员工资料", "basic"], ["平台权限", "admin"], ["渠道库存", "official-team"], ["业务ERP", "erp"], ["账号与安全", "status"]]) {
        await click(label);
        expect(visiblePanel()).toHaveLength(1);
        expect(visiblePanel()[0].id).toBe(`staff-panel-${id}`);
        writeFileSync(join(process.env.STAFF_FONT_FIXTURE_DIR, `staff-permission-${id}.html`),
          `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual StaffPermissionSheet synthetic ${id}</title></head><body data-admin-readability="true">${document.body.innerHTML}</body></html>\n`);
      }
    }
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

async function selectTemplate(id: string, value: string) {
  await act(async () => {
    const select = document.getElementById(id) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
describe("权限简化回归（本地草稿，不写真实账号）", () => {
  it("角色只读，选模板不自动修改/保存，显式应用只生成当前平台操作草稿", async () => {
    props.initialSection = "admin";
    props.row = { ...row, admin: { ...row.admin!, adminRole: "operation" } };
    await render();
    expect(document.getElementById("staff-admin-role")).toBeNull();
    expect(visiblePanel()[0].textContent).toContain("平台运营（只读）");
    await selectTemplate("staff-admin-template", "sales");
    expect(button("保存当前页").disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    await click("应用平台模板到草稿");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(button("保存当前页").disabled).toBe(false);
    await click("保存当前页");
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      adminRole: "operation",
      inventoryDataScope: "own",
      erpPermissionKeys: ["inventory.manage"],
    });
    expect(mocks.nativeSave).not.toHaveBeenCalled();
  });
  it("业务模板不按组长身份扩全量，勾选范围与原native授权保持独立", async () => {
    props.initialSection = "erp";
    props.row = { ...row, member: { ...row.member!, role: "leader" } };
    props.enterpriseAccess.grantableKeys = [
      "inventory.manage",
      "inventory.publish",
      "inventory.inbound",
      "customers.manage_all",
      "customers.manage",
      "enterprise.members.manage",
    ];
    await render();
    await selectTemplate("staff-erp-template", "inventory");
    const impact = document.querySelector('[aria-label="库存管理授权影响"]')!;
    expect(impact.textContent).toContain("也可能允许渠道导出");
    expect(impact.textContent).toContain("原生读取、业务范围和渠道授权");
    expect(impact.textContent).toContain("当前没有独立的导出或来源开关");
    expect(button("保存当前页").disabled).toBe(true);
    await click("添加业务模板到草稿");
    expect(check("发布库存").getAttribute("aria-checked")).toBe("true");
    expect(check("全部客户管理").getAttribute("aria-checked")).toBe("false");
    expect(check("用户与权限").getAttribute("aria-checked")).toBe("false");
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="staff-business-scope"]'
      )!.checked
    ).toBe(true);
    expect(mocks.nativeSave).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      document.querySelectorAll('input[name="staff-business-scope"]')
    ).toHaveLength(2);
  });
  it("高风险项默认折叠，隐藏看板不混入日常矩阵，已授权数量仍可见", async () => {
    props.initialSection = "erp";
    props.row = {
      ...row,
      member: {
        ...row.member!,
        permissionKeys: [
          "inventory.manage",
          "customers.manage",
          "customers.manage_all",
        ],
      },
    };
    props.enterpriseAccess.grantableKeys = [
      "inventory.manage",
      "customers.manage",
      "customers.manage_all",
    ];
    await render();
    const advanced =
      visiblePanel()[0].querySelector<HTMLDetailsElement>("details")!;
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector("summary")!.textContent).toContain(
      "已选 1 项"
    );
    expect(advanced.contains(check("全部客户管理"))).toBe(true);
    expect(
      document.querySelector('[role="checkbox"][aria-label="库存看板"]')
    ).toBeNull();
  });
  it("超级管理员所有配置只读，不能选择角色或套用模板", async () => {
    props.row = { ...row, admin: { ...row.admin!, adminRole: "super_admin" } };
    props.initialSection = "admin";
    await render();
    expect(document.getElementById("staff-admin-role")).toBeNull();
    expect(document.getElementById("staff-admin-template")).toBeNull();
    expect(button("保存当前页").disabled).toBe(true);
    await click("业务ERP");
    expect(
      (document.getElementById("staff-erp-template") as HTMLSelectElement)
        .disabled
    ).toBe(true);
    expect(check("我的库存").disabled).toBe(true);
    await click("渠道库存");
    expect(visiblePanel()[0].textContent).toContain("由系统固定授予");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.nativeSave).not.toHaveBeenCalled();
  });
  it("目标自己不可改平台/ERP/渠道配置，系统或未知native键不能从平台草稿误删", async () => {
    props.initialSection = "admin";
    props.enterpriseAccess.currentUserId = 88;
    await render();
    expect(check("数据物料库查看").disabled).toBe(true);
    await click("业务ERP");
    expect(check("我的库存").disabled).toBe(true);
    await click("渠道库存");
    expect(check("查看渠道库存").disabled).toBe(true);
    expect(visiblePanel()[0].textContent).toContain("不能修改自己的");
    props.enterpriseAccess.currentUserId = 20;
    props.row = {
      ...row,
      admin: {
        ...row.admin!,
        permissions: [
          ...row.admin!.permissions,
          "officialInventory.sourceRead",
          "officialInventory.export",
          "logs.read",
        ],
      },
    };
    await render("actor1:protected");
    await click("平台权限");
    expect(check("数据物料库查看").disabled).toBe(true);
    expect(button("应用平台模板到草稿").disabled).toBe(true);
    expect(visiblePanel()[0].textContent).toContain(
      "officialInventory.sourceRead"
    );
    expect(visiblePanel()[0].textContent).toContain("officialInventory.export");
    await click("渠道库存");
    expect(check("查看渠道库存").disabled).toBe(true);
    expect(visiblePanel()[0].textContent).toContain("只读以防整包更新误删");
    await toggle("查看渠道库存");
    await click("保存当前页");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.nativeSave).not.toHaveBeenCalled();
  });
});
