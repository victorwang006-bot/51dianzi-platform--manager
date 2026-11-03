// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  total: 21,
  isLoading: false,
  isFetching: false,
  pendingRevoke: false,
  list: vi.fn(),
  history: vi.fn(),
  staff: vi.fn(),
  refetch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  revoke: vi.fn(),
  invalidateAdmins: vi.fn(),
  invalidateStaff: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));
vi.mock("sonner", () => ({ toast: { error: runtime.toastError, success: runtime.toastSuccess } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      adminUser: { list: { invalidate: runtime.invalidateAdmins } },
      salesStaff: { list: { invalidate: runtime.invalidateStaff } },
    }),
    adminUser: {
      list: { useQuery: (input: unknown) => {
        runtime.list(input);
        return { data: { data: runtime.rows, total: runtime.total }, isLoading: runtime.isLoading, isFetching: runtime.isFetching, refetch: runtime.refetch };
      } },
      loginHistory: { useQuery: (input: unknown, options: unknown) => {
        runtime.history(input, options);
        return { data: [], isLoading: false, error: null };
      } },
      create: { useMutation: () => ({ mutate: runtime.create, isPending: false }) },
      update: { useMutation: () => ({ mutate: runtime.update, isPending: false }) },
      toggleStatus: { useMutation: () => ({ mutate: runtime.toggle, isPending: false }) },
      remove: { useMutation: () => ({ mutate: runtime.remove, isPending: false }) },
      revokeSessions: { useMutation: () => ({ mutate: runtime.revoke, isPending: runtime.pendingRevoke }) },
    },
    salesStaff: { list: { useQuery: (input: unknown) => {
      runtime.staff(input);
      return { data: [{ staffCode: "S002", displayName: "历史员工", status: "disabled" }] };
    } } },
  },
}));

import Admins from "@/pages/Admins";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;

function render() {
  act(() => root.render(React.createElement(Admins)));
}

function button(text: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

function control<T extends Element>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing control: ${selector}`);
  return result;
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.rows = [{
    id: 7,
    username: "test-admin",
    displayName: "测试员工",
    email: "admin@example.test",
    phone: "13800000000",
    adminRole: "merchant_mgr",
    status: "active",
    permissions: ["merchants.read", "merchants.write", "orders.read"],
    salesStaffCodes: ["S001", "S002"],
    ownSalesStaffCode: "S001",
    securityRiskLevel: "attention",
    createdAt: "2026-10-01T00:00:00Z",
    lastLoginAt: null,
    lastLoginIpAddress: "192.0.2.1",
    lastLoginLocation: "测试归属地",
    lastLoginDevice: "桌面设备",
  }];
  runtime.total = 21;
  runtime.isLoading = false;
  runtime.isFetching = false;
  runtime.pendingRevoke = false;
  vi.spyOn(window, "confirm").mockReturnValue(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("管理员页面统一呈现与业务围栏", () => {
  it("uses shared page/header/toolbar/data panel and retains all account columns", () => {
    render();
    const page = control<HTMLElement>(".admins-page[data-admin-ui-system='channel-inventory']");
    expect(page.querySelector(".aui-page-title")?.textContent).toBe("用户管理");
    const toolbar = control<HTMLElement>(".aui-filterbar[aria-label='用户账户工具栏']");
    expect(toolbar.contains(button("刷新"))).toBe(true);
    expect(toolbar.contains(button("新建用户"))).toBe(true);
    expect(control<HTMLElement>(".aui-data-panel").getAttribute("aria-label")).toBe("用户账户列表");
    expect(Array.from(page.querySelectorAll("th")).map(item => item.textContent)).toEqual([
      "账号", "权限范围", "联系方式", "状态 / 登录安全", "时间", "操作",
    ]);
    for (const text of ["普通用户", "商户管理、订单管理", "S002", "admin@example.test", "13800000000", "需关注", "192.0.2.1"]) {
      expect(page.textContent).toContain(text);
    }
    expect(control<HTMLElement>("td[data-label='操作'] .admin-user-actions")).toBeTruthy();
    expect(runtime.history).toHaveBeenLastCalledWith({ id: 1, limit: 50 }, { enabled: false, retry: 1 });
    expect(runtime.staff).toHaveBeenLastCalledWith({ includeInactive: true });
  });

  it("keeps refresh availability and server pagination parameters", () => {
    render();
    click(button("刷新"));
    expect(runtime.refetch).toHaveBeenCalledTimes(1);
    click(button("下一页"));
    expect(runtime.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(button("下一页").disabled).toBe(true);
    click(button("上一页"));
    expect(runtime.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    runtime.isFetching = true;
    render();
    expect(button("刷新").disabled).toBe(true);
  });

  it("retains loading and empty account states", () => {
    runtime.isLoading = true;
    render();
    expect(document.querySelector("tbody")).toBeNull();
    runtime.isLoading = false;
    runtime.rows = [];
    render();
    expect(host.textContent).toContain("暂无用户账户");
    expect(button("新建用户").disabled).toBe(false);
  });

  it("requires a username and 8-character initial password before creating an account", () => {
    render();
    click(button("新建用户"));
    expect(control<HTMLElement>("[role='dialog']").classList.contains("admins-dialog")).toBe(true);
    click(button("创建用户"));
    expect(runtime.toastError).toHaveBeenLastCalledWith("用户名不能为空");
    change(control<HTMLInputElement>("input[placeholder='登录用户名（唯一）']"), "  new-admin  ");
    change(control<HTMLInputElement>("input[type='password']"), "short");
    click(button("创建用户"));
    expect(runtime.toastError).toHaveBeenLastCalledWith("初始密码至少 8 位");
    expect(runtime.create).not.toHaveBeenCalled();
    change(control<HTMLInputElement>("input[type='password']"), "12345678");
    click(button("创建用户"));
    expect(runtime.create).toHaveBeenCalledWith({
      username: "new-admin", displayName: null, email: null, phone: null,
      adminRole: "merchant_mgr", salesStaffCodes: [],
      permissions: ["merchants.read", "merchants.write", "orders.read"], password: "12345678",
    });
  });

  it("preserves edit identity, optional password reset and historical sales scope", () => {
    render();
    click(control("button[aria-label='编辑用户']"));
    expect(control<HTMLInputElement>("input[placeholder='登录用户名（唯一）']").disabled).toBe(true);
    expect(document.body.textContent).toContain("（已停用）");
    change(control<HTMLInputElement>("input[type='password']"), "short");
    click(button("保存修改"));
    expect(runtime.toastError).toHaveBeenLastCalledWith("重置密码至少 8 位");
    expect(runtime.update).not.toHaveBeenCalled();
    change(control<HTMLInputElement>("input[type='password']"), "");
    click(button("保存修改"));
    expect(runtime.update).toHaveBeenCalledWith({
      id: 7, username: "test-admin", displayName: "测试员工", email: "admin@example.test", phone: "13800000000",
      adminRole: "merchant_mgr", salesStaffCodes: ["S001", "S002"],
      permissions: ["merchants.read", "merchants.write", "orders.read"],
    });
  });

  it("retains dependent read permission and rejects empty business grants", () => {
    runtime.rows[0].permissions = ["materials.write", "profile.manage"];
    render();
    click(control("button[aria-label='编辑用户']"));
    const selected = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked"));
    expect(selected().map(item => item.closest("label")?.textContent?.trim())).toContain("查看");
    click(button("保存修改"));
    expect(runtime.update.mock.calls[0][0].permissions).toEqual(["materials.write", "materials.read"]);
    // Uncheck maintenance first, then its required read grant. Sales scope checkboxes are unrelated.
    const permissionArea = Array.from(document.querySelectorAll("label")).find(item => item.textContent === "模块权限")!.parentElement!.parentElement!;
    const grants = Array.from(permissionArea.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
    for (const item of [...grants].reverse()) if (item.checked) click(item);
    runtime.update.mockClear();
    click(button("保存修改"));
    expect(runtime.toastError).toHaveBeenLastCalledWith("普通用户至少需要一个业务模块权限");
    expect(runtime.update).not.toHaveBeenCalled();
  });

  it("keeps super-admin all-module display and clears irrelevant grants in edit payload", () => {
    runtime.rows[0].adminRole = "super_admin";
    render();
    expect(host.textContent).toContain("全部模块");
    expect(host.textContent).toContain("全部销售范围");
    click(control("button[aria-label='编辑用户']"));
    expect(document.querySelector("input[type='checkbox']")).toBeNull();
    click(button("保存修改"));
    expect(runtime.update.mock.calls[0][0]).toMatchObject({ id: 7, adminRole: "super_admin", permissions: [], salesStaffCodes: [] });
  });

  it("retains enable/disable and irreversible delete confirmation", () => {
    render();
    click(button("停用"));
    expect(runtime.toggle).toHaveBeenCalledWith({ id: 7, status: "disabled" });
    click(control("button[aria-label='删除用户']"));
    expect(window.confirm).toHaveBeenCalledWith("确认删除用户「test-admin」？此操作不可撤销。");
    expect(runtime.remove).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    click(control("button[aria-label='删除用户']"));
    expect(runtime.remove).toHaveBeenCalledWith({ id: 7 });
    runtime.rows[0].status = "disabled";
    render();
    click(button("启用"));
    expect(runtime.toggle).toHaveBeenLastCalledWith({ id: 7, status: "active" });
  });

  it("loads target login history and requires an audited reason before revoking sessions", () => {
    render();
    click(control("button[aria-label='登录安全']"));
    expect(runtime.history).toHaveBeenLastCalledWith({ id: 7, limit: 50 }, { enabled: true, retry: 1 });
    expect(document.body.textContent).toContain("暂无登录安全记录");
    click(button("强制退出全部设备"));
    expect(document.body.textContent).toContain("此操作会写入审计日志");
    expect(button("确认强制退出").disabled).toBe(true);
    const reason = control<HTMLTextAreaElement>("#revoke-reason");
    expect(reason.maxLength).toBe(500);
    change(reason, "a");
    expect(button("确认强制退出").disabled).toBe(true);
    change(reason, "  异常登录  ");
    expect(button("确认强制退出").disabled).toBe(false);
    click(button("确认强制退出"));
    expect(runtime.revoke).toHaveBeenCalledWith({ id: 7, reason: "异常登录" });
    runtime.pendingRevoke = true;
    render();
    expect(button("处理中...").disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
  });

  it("keeps page-specific responsive rules scoped and avoids forced scaling", () => {
    const css = readFileSync(resolve(process.cwd(), "client/src/pages/Admins.css"), "utf8");
    expect(css).toContain(".admins-page .admin-user-actions");
    expect(css).toContain("justify-content: flex-end");
    expect(css).toContain("@media (max-width: 1100px)");
    expect(css).toContain("content: attr(data-label)");
    expect(css).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:/);
  });
});
