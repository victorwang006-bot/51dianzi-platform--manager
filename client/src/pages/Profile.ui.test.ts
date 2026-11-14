// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const user = { id: 101, username: "alice", openId: "local:101", hasNativeAdminAccount: true };
  const profile = { username: "alice", displayName: "本人甲", email: "alice@example.test", phone: "13800138000", adminRole: "auditor", phoneBinding: "legacy_unverified" };
  const performance = {
    status: "available", month: "2026-11", currency: "CNY", currencyLabel: "人民币（含税）", timezone: "Asia/Shanghai",
    orderCount: 27, orderAmount: "9000.0000", collectedAmount: "3000.0000", monthlyBookedAmount: "6000.0000",
    refundAmount: null, refundStatus: "unavailable", basis: "本人已确认订单按下单月份统计，现金回款按付款日期统计，分页不影响总数。",
    items: [{ id: 1, orderNumber: "SELF-001", status: "confirmed", totalAmount: "100.0000", createdAt: "2026-11-01T03:00:00Z", currencyLabel: "人民币（含税）" }], total: 27, page: 1, pageSize: 10,
  };
  return {
    user: user as typeof user | null, profile, performance, authError: null as Error | null,
    refresh: vi.fn(), logout: vi.fn(), navigate: vi.fn(), success: vi.fn(),
    rpc: { profile: { query: vi.fn() }, updateProfile: { mutate: vi.fn() }, changePassword: { mutate: vi.fn() },
      requestPhoneCode: { mutate: vi.fn() }, bindPhone: { mutate: vi.fn() },
      performance: { query: vi.fn() }, commission: { query: vi.fn() } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user, loading: false, error: state.authError,
  refresh: state.refresh, logout: state.logout }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { personalCenter: state.rpc } }) } }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("wouter", () => ({ useLocation: () => ["/profile", state.navigate] }));
vi.mock("sonner", () => ({ toast: { success: state.success } }));
import Profile from "./Profile";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function renderPage() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Profile))));
  await settle();
}
function button(label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label);
  if (!element) throw new Error(`BUTTON_NOT_FOUND:${label}`);
  return element;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
async function fill(id: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`INPUT_NOT_FOUND:${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(inputId: string) {
  const form = container.querySelector(`#${inputId}`)?.closest("form");
  if (!form) throw new Error("FORM_NOT_FOUND");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { id: 101, username: "alice", openId: "local:101", hasNativeAdminAccount: true };
  state.authError = null;
  state.refresh.mockResolvedValue({ data: state.user, error: null });
  state.logout.mockResolvedValue(undefined);
  state.rpc.profile.query.mockImplementation(async () => ({ ...state.profile, username: state.user?.username,
    displayName: state.user?.id === 101 ? "本人甲" : "本人乙" }));
  state.rpc.updateProfile.mutate.mockImplementation(async (input: { displayName: string; email: string }) => ({ ...state.profile, ...input }));
  state.rpc.changePassword.mutate.mockResolvedValue({ success: true, requiresRelogin: true });
  state.rpc.requestPhoneCode.mutate.mockResolvedValue({ success: true, ticketId: "ticket-1", maskedPhone: "139****9000", expiresInSeconds: 300, retryAfterSeconds: 60 });
  state.rpc.bindPhone.mutate.mockResolvedValue({ success: true, phone: "13900139000", requiresRelogin: true });
  state.rpc.performance.query.mockImplementation(async (input: { month: string; page: number }) => ({ ...state.performance,
    month: input.month, page: input.page, items: [{ ...state.performance.items[0], orderNumber: `SELF-00${input.page}` }] }));
  state.rpc.commission.query.mockResolvedValue({ status: "unconfigured", month: "2026-11", amount: null, currency: "CNY", reason: "未配置可核实的提成规则与结算来源" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await renderPage();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
});

describe("Profile native self-service UI", () => {
  it("shows all four compact tabs, source-only identity fields and edits only permitted profile fields", async () => {
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(container.textContent).toContain("审计人员");
    expect(container.textContent).toContain("真实姓名未设置");
    expect(container.textContent).toContain("所属公司未设置");
    expect(container.textContent).toContain("岗位未设置");
    await click("编辑资料");
    expect(container.querySelector('input[type="tel"]')).toBeNull();
    await fill("pc-display-name", " 新名称 ");
    await fill("pc-email", "me@example.test");
    await submit("pc-display-name");
    expect(state.rpc.updateProfile.mutate).toHaveBeenCalledWith({ displayName: "新名称", email: "me@example.test" });
    expect(container.textContent).toContain("新名称");
    expect(state.rpc.updateProfile.mutate.mock.calls[0][0]).not.toHaveProperty("phone");
  });

  it("renders profile failures with a genuine retry action", async () => {
    state.rpc.profile.query.mockRejectedValueOnce(new Error("资料读取失败"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["personal-center-self"] }); });
    await settle();
    expect(container.textContent).toContain("资料读取失败");
    await click("重试");
    expect(container.textContent).toContain("本人甲");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("requires matching passwords and clears secrets, logs out and routes to native login on success", async () => {
    await click("账号安全");
    await fill("pc-old-password", "old-password");
    await fill("pc-new-password", "new-password");
    await fill("pc-confirm-password", "mismatch-password");
    await submit("pc-old-password");
    expect(state.rpc.changePassword.mutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("不一致");
    await fill("pc-confirm-password", "new-password");
    await submit("pc-old-password");
    expect(state.rpc.changePassword.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", newPassword: "new-password" });
    expect(container.querySelector<HTMLInputElement>("#pc-old-password")?.value).toBe("");
    expect(container.querySelector<HTMLInputElement>("#pc-new-password")?.value).toBe("");
    expect(state.logout).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("surfaces server password errors without claiming success or logging out", async () => {
    state.rpc.changePassword.mutate.mockRejectedValueOnce(new Error("原密码错误"));
    await click("账号安全");
    await fill("pc-old-password", "old-password");
    await fill("pc-new-password", "new-password");
    await fill("pc-confirm-password", "new-password");
    await submit("pc-old-password");
    expect(container.textContent).toContain("原密码错误");
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("never fakes SMS success when the real request fails or SMS is unconfigured", async () => {
    state.rpc.requestPhoneCode.mutate.mockRejectedValueOnce(new Error("短信服务尚未配置"));
    await click("账号安全");
    expect(button("获取验证码").disabled).toBe(true);
    await fill("pc-phone-password", "old-password");
    await fill("pc-phone", "+8613900139000");
    await click("获取验证码");
    expect(state.rpc.requestPhoneCode.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13900139000" });
    expect(container.textContent).toContain("短信服务尚未配置");
    expect(container.textContent).not.toContain("验证码已发送");
    expect(button("验证并更换").disabled).toBe(true);
    expect(state.success).not.toHaveBeenCalled();
  });

  it("uses a real one-time phone ticket, cooldown and code then relogs in after binding", async () => {
    await click("账号安全");
    await fill("pc-phone-password", "old-password");
    await fill("pc-phone", "13900139000");
    await click("获取验证码");
    expect(button("60秒后重发").disabled).toBe(true);
    expect(container.textContent).toContain("验证码已发送至 139****9000");
    await fill("pc-phone-code", "123456");
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13900139000", ticketId: "ticket-1", code: "123456" });
    expect(state.logout).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>("#pc-phone-code")?.value).toBe("");
  });

  it("invalidates a ticket when the target phone or identity password changes without bypassing cooldown", async () => {
    await click("账号安全");
    await fill("pc-phone-password", "old-password");
    await fill("pc-phone", "13900139000");
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    await fill("pc-phone", "13700137000");
    expect(container.querySelector<HTMLInputElement>("#pc-phone-code")?.value).toBe("");
    expect(button("验证并更换").disabled).toBe(true);
    expect(button("60秒后重发").disabled).toBe(true);
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).not.toHaveBeenCalled();
  });

  it("renders server-wide performance summaries, personal paginated rows and resets page on month change", async () => {
    await click("我的业绩");
    expect(container.textContent).toContain("9,000.0000");
    expect(container.textContent).toContain("3,000.0000");
    expect(container.textContent).toContain("不计入现金回款");
    expect(container.textContent).toContain("SELF-001");
    expect(container.textContent).toContain("共 27 笔");
    await click("下一页");
    expect(container.textContent).toContain("SELF-002");
    expect(container.textContent).not.toContain("SELF-001");
    const nextInput = state.rpc.performance.query.mock.calls.at(-1)?.[0];
    expect(nextInput).toMatchObject({ page: 2, pageSize: 10 });
    expect(nextInput).not.toHaveProperty("adminUserId");
    await fill("pc-month", "2026-10");
    await settle();
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0]).toEqual({ month: "2026-10", page: 1, pageSize: 10 });
  });

  it("shows unavailable performance rather than zeros and unconfigured commission rather than settled zero", async () => {
    state.rpc.performance.query.mockResolvedValueOnce({ status: "unavailable", reason: "尚未关联有效业务员工" });
    await click("我的业绩");
    expect(container.textContent).toContain("尚未关联有效业务员工");
    expect(container.querySelector(".pc-stat-grid")).toBeNull();
    await click("我的提成");
    expect(container.textContent).toContain("尚未配置");
    expect(container.textContent).not.toContain("已结算");
    expect(container.textContent).not.toContain("0.0000");
  });

  it("remounts synchronously on subject changes and clears passwords, tickets, drafts and former self-cache", async () => {
    await click("编辑资料");
    await fill("pc-display-name", "不应带到乙账号的草稿");
    await click("账号安全");
    await fill("pc-old-password", "alice-secret");
    await fill("pc-phone-password", "alice-secret");
    await fill("pc-phone", "13900139000");
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    state.user = { id: 202, username: "bob", openId: "local:202", hasNativeAdminAccount: true };
    await renderPage();
    expect(container.textContent).toContain("本人乙");
    expect(container.textContent).not.toContain("本人甲");
    expect(container.textContent).not.toContain("不应带到乙账号");
    await click("账号安全");
    expect(container.querySelector<HTMLInputElement>("#pc-old-password")?.value).toBe("");
    expect(container.querySelector<HTMLInputElement>("#pc-phone-code")?.value).toBe("");
    expect(button("获取验证码").textContent).toBe("获取验证码");
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain("alice");
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("alice-secret");
  });

  it("does not let a late old-account mutation log out a newly mounted account", async () => {
    const pending = deferred<{ success: boolean; requiresRelogin: boolean }>();
    state.rpc.changePassword.mutate.mockReturnValueOnce(pending.promise);
    await click("账号安全");
    await fill("pc-old-password", "old-password");
    await fill("pc-new-password", "new-password");
    await fill("pc-confirm-password", "new-password");
    await submit("pc-old-password");
    state.user = { id: 202, username: "bob", openId: "local:202", hasNativeAdminAccount: true };
    await renderPage();
    await act(async () => pending.resolve({ success: true, requiresRelogin: true }));
    await settle();
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("本人乙");
  });

  it("guards a late mutation in the same event turn before the session-clear unmount commits", async () => {
    const pending = deferred<{ success: boolean; requiresRelogin: boolean }>();
    const freshAuth = deferred<{ data: typeof state.user; error: null }>();
    state.rpc.changePassword.mutate.mockReturnValueOnce(pending.promise);
    state.refresh.mockReturnValueOnce(freshAuth.promise);
    await click("账号安全");
    await fill("pc-old-password", "old-password");
    await fill("pc-new-password", "new-password");
    await fill("pc-confirm-password", "new-password");
    await submit("pc-old-password");
    await act(async () => {
      window.dispatchEvent(new Event("51dianzi:auth-session-cleared"));
      pending.resolve({ success: true, requiresRelogin: true });
      await Promise.resolve();
    });
    await settle();
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    await act(async () => freshAuth.resolve({ data: null, error: null }));
  });

  it("clears secrets immediately on the shared session-reset event and waits for fresh auth confirmation", async () => {
    const freshAuth = deferred<{ data: typeof state.user; error: null }>();
    state.refresh.mockReturnValueOnce(freshAuth.promise);
    await click("账号安全");
    await fill("pc-old-password", "old-account-secret");
    await act(async () => window.dispatchEvent(new Event("51dianzi:auth-session-cleared")));
    expect(container.querySelector("#pc-old-password")).toBeNull();
    expect(container.textContent).toContain("登录状态已失效");
    await act(async () => freshAuth.resolve({ data: state.user, error: null }));
    await settle();
    await click("账号安全");
    expect(container.querySelector<HTMLInputElement>("#pc-old-password")?.value).toBe("");
  });
});
