// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const user = { id: 101, username: "alice", openId: "local:101", hasNativeAdminAccount: true, loginMethod: "password" as string | null };
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
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) =>
  createElement("div", { "data-dashboard-layout": true }, createElement("nav", { "aria-label": "面包屑" }, "Dashboard / 个人中心"), children) }));
vi.mock("wouter", () => ({ useLocation: () => ["/profile", state.navigate] }));
vi.mock("sonner", () => ({ toast: { success: state.success } }));
// Deliberately use the actual repository Dialog / Radix portal and focus handling.
import Profile from "./Profile";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const phoneTicket = { success: true, ticketId: "ticket-1", maskedPhone: "139****9000", expiresInSeconds: 300, retryAfterSeconds: 60 };
const changed = { success: true, requiresRelogin: true };
function text() { return document.body.textContent ?? ""; }
function input(id: string) { return document.getElementById(id) as HTMLInputElement | null; }
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function renderPage() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Profile))));
  await settle();
}
function button(label: string, within: ParentNode = document.body): HTMLButtonElement {
  const element = Array.from(within.querySelectorAll("button")).find(item => item.textContent === label);
  if (!element) throw new Error(`BUTTON_NOT_FOUND:${label}`);
  return element;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
async function fill(id: string, value: string) {
  const element = input(id);
  if (!element) throw new Error(`INPUT_NOT_FOUND:${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(inputId: string) {
  const form = input(inputId)?.closest("form");
  if (!form) throw new Error("FORM_NOT_FOUND");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}
async function key(element: Element, value: string, shiftKey = false) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
  await settle();
}
async function fillPassword() {
  await fill("pc-old-password", "old-password");
  await fill("pc-new-password", "new-password");
  await fill("pc-confirm-password", "new-password");
}
async function fillPhone(phone = "13900139000") {
  await fill("pc-phone-password", "old-password");
  await fill("pc-phone", phone);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function secondSubject() {
  state.user = { id: 202, username: "bob", openId: "local:202", hasNativeAdminAccount: true, loginMethod: "password" };
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { id: 101, username: "alice", openId: "local:101", hasNativeAdminAccount: true, loginMethod: "password" };
  state.authError = null;
  state.refresh.mockResolvedValue({ data: state.user, error: null });
  state.logout.mockResolvedValue(undefined);
  state.rpc.profile.query.mockImplementation(async () => ({ ...state.profile, username: state.user?.username,
    displayName: state.user?.id === 101 ? "本人甲" : "本人乙" }));
  state.rpc.updateProfile.mutate.mockImplementation(async (value: { displayName: string; email: string }) => ({ ...state.profile, ...value }));
  state.rpc.changePassword.mutate.mockResolvedValue(changed);
  state.rpc.requestPhoneCode.mutate.mockResolvedValue(phoneTicket);
  state.rpc.bindPhone.mutate.mockResolvedValue({ ...changed, phone: "13900139000" });
  state.rpc.performance.query.mockImplementation(async (value: { month: string; page: number }) => ({ ...state.performance,
    month: value.month, page: value.page, items: [{ ...state.performance.items[0], orderNumber: `SELF-00${value.page}` }] }));
  state.rpc.commission.query.mockImplementation(async (value: { month: string }) => ({ status: "unconfigured", month: value.month,
    amount: null, currency: "CNY", reason: "未配置可核实的提成规则与结算来源" }));
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
  it("shows two compact tabs, source-only identity fields and edits only permitted profile fields", async () => {
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(button("个人资料").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll(".pc-details")).toHaveLength(1);
    expect(text()).toContain("审计人员");
    expect(text()).toContain("真实姓名未设置");
    expect(text()).toContain("所属公司未设置");
    expect(text()).toContain("岗位未设置");
    expect(text()).toContain("账号密码登录");
    expect(container.querySelector('[aria-label="账号安全状态"]')?.textContent).toContain("未验证");
    expect(container.querySelector(".pc-page-header")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector('[aria-label="面包屑"]')?.textContent).toBe("Dashboard / 个人中心");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("编辑资料");
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    await fill("pc-display-name", " 新名称 ");
    await fill("pc-email", "me@example.test");
    await submit("pc-display-name");
    expect(state.rpc.updateProfile.mutate).toHaveBeenCalledWith({ displayName: "新名称", email: "me@example.test" });
    expect(text()).toContain("新名称");
    expect(state.rpc.updateProfile.mutate.mock.calls[0][0]).not.toHaveProperty("phone");
  });

  it("renders profile failures with a genuine retry action", async () => {
    state.rpc.profile.query.mockRejectedValueOnce(new Error("资料读取失败"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["personal-center-self"] }); });
    await settle();
    expect(text()).toContain("资料读取失败");
    await click("重试");
    expect(text()).toContain("本人甲");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("requires matching passwords and clears secrets, logs out and routes to native login on success", async () => {
    await click("修改密码");
    await fillPassword();
    await fill("pc-confirm-password", "mismatch-password");
    await submit("pc-old-password");
    expect(state.rpc.changePassword.mutate).not.toHaveBeenCalled();
    expect(text()).toContain("不一致");
    await fill("pc-confirm-password", "new-password");
    await submit("pc-old-password");
    expect(state.rpc.changePassword.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", newPassword: "new-password" });
    expect(input("pc-old-password")?.value).toBe("");
    expect(input("pc-new-password")?.value).toBe("");
    expect(state.logout).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("surfaces server password errors without claiming success or logging out", async () => {
    state.rpc.changePassword.mutate.mockRejectedValueOnce(new Error("原密码错误"));
    await click("修改密码");
    await fillPassword();
    await submit("pc-old-password");
    expect(text()).toContain("原密码错误");
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("never fakes SMS success when the real request fails or SMS is unconfigured", async () => {
    state.rpc.requestPhoneCode.mutate.mockRejectedValueOnce(new Error("短信服务尚未配置"));
    await click("验证与绑定手机");
    expect(button("获取验证码").disabled).toBe(true);
    await fillPhone("+8613900139000");
    await click("获取验证码");
    expect(state.rpc.requestPhoneCode.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13900139000" });
    expect(text()).toContain("短信服务尚未配置");
    expect(text()).not.toContain("验证码已发送");
    expect(button("验证并更换").disabled).toBe(true);
    expect(state.success).not.toHaveBeenCalled();
  });

  it("uses a real one-time phone ticket, cooldown and code then relogs in after binding", async () => {
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    expect(button("60秒后重发").disabled).toBe(true);
    expect(text()).toContain("验证码已发送至 139****9000");
    await fill("pc-phone-code", "123456");
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13900139000", ticketId: "ticket-1", code: "123456" });
    expect(state.logout).toHaveBeenCalledOnce();
    expect(input("pc-phone-code")?.value).toBe("");
  });

  it("invalidates a ticket when the target phone or identity password changes without bypassing cooldown", async () => {
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    await fill("pc-phone", "13700137000");
    expect(input("pc-phone-code")?.value).toBe("");
    expect(button("验证并更换").disabled).toBe(true);
    expect(button("60秒后重发").disabled).toBe(true);
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).not.toHaveBeenCalled();
  });

  it("renders server-wide performance summaries, personal paginated rows and resets page on month change", async () => {
    expect(state.rpc.performance.query).not.toHaveBeenCalled();
    expect(state.rpc.commission.query).not.toHaveBeenCalled();
    await click("业绩与提成");
    expect(text()).toContain("9,000.0000");
    expect(text()).toContain("3,000.0000");
    expect(text()).toContain("不计入现金回款");
    expect(text()).toContain("退款：暂无可核实账本，不以0代替。");
    expect(text()).toContain("SELF-001");
    expect(text()).toContain("共 27 笔");
    expect(text()).toContain("尚未配置");
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0]).toEqual({ month: input("pc-month")?.value });
    expect(document.querySelectorAll('input[type="month"]')).toHaveLength(1);
    await click("下一页");
    expect(text()).toContain("SELF-002");
    expect(text()).not.toContain("SELF-001");
    const nextInput = state.rpc.performance.query.mock.calls.at(-1)?.[0];
    expect(nextInput).toMatchObject({ page: 2, pageSize: 10 });
    expect(nextInput).not.toHaveProperty("adminUserId");
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
    await fill("pc-month", "2026-10");
    await settle();
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0]).toEqual({ month: "2026-10", page: 1, pageSize: 10 });
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0]).toEqual({ month: "2026-10" });
  });

  it("shows unavailable performance rather than zeros and unconfigured commission rather than settled zero", async () => {
    state.rpc.performance.query.mockResolvedValueOnce({ status: "unavailable", reason: "尚未关联有效业务员工" });
    await click("业绩与提成");
    expect(text()).toContain("尚未关联有效业务员工");
    expect(document.querySelector(".pc-stat-grid")).toBeNull();
    expect(text()).toContain("尚未配置");
    expect(text()).not.toContain("已结算");
    expect(text()).not.toContain("0.0000");
  });

  it("remounts synchronously on subject changes and clears passwords, tickets, drafts and former self-cache", async () => {
    await click("编辑资料");
    await fill("pc-display-name", "不应带到乙账号的草稿");
    await click("修改密码");
    await fill("pc-old-password", "alice-secret");
    await click("关闭");
    await click("验证与绑定手机");
    await fill("pc-phone-password", "alice-secret");
    await fill("pc-phone", "13900139000");
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    secondSubject();
    await renderPage();
    expect(text()).toContain("本人乙");
    expect(text()).not.toContain("本人甲");
    expect(text()).not.toContain("不应带到乙账号");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("修改密码");
    expect(input("pc-old-password")?.value).toBe("");
    await click("关闭");
    await click("验证与绑定手机");
    expect(input("pc-phone-code")?.value).toBe("");
    expect(button("获取验证码").textContent).toBe("获取验证码");
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain("alice");
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("alice-secret");
  });

  it("does not let a late old-account mutation log out a newly mounted account", async () => {
    const pending = deferred<typeof changed>();
    state.rpc.changePassword.mutate.mockReturnValueOnce(pending.promise);
    await click("修改密码");
    await fillPassword();
    await submit("pc-old-password");
    secondSubject();
    await renderPage();
    await act(async () => pending.resolve(changed));
    await settle();
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(text()).toContain("本人乙");
  });

  it("guards a late mutation in the same event turn before the session-clear unmount commits", async () => {
    const pending = deferred<typeof changed>();
    const freshAuth = deferred<{ data: typeof state.user; error: null }>();
    state.rpc.changePassword.mutate.mockReturnValueOnce(pending.promise);
    state.refresh.mockReturnValueOnce(freshAuth.promise);
    await click("修改密码");
    await fillPassword();
    await submit("pc-old-password");
    await act(async () => {
      window.dispatchEvent(new Event("51dianzi:auth-session-cleared"));
      pending.resolve(changed);
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
    await click("修改密码");
    await fill("pc-old-password", "old-account-secret");
    await act(async () => window.dispatchEvent(new Event("51dianzi:auth-session-cleared")));
    expect(input("pc-old-password")).toBeNull();
    expect(text()).toContain("登录状态已失效");
    await act(async () => freshAuth.resolve({ data: state.user, error: null }));
    await settle();
    await click("修改密码");
    expect(input("pc-old-password")?.value).toBe("");
  });

  it("supports two-tab arrow, Home and End navigation with matching panels and focus", async () => {
    await key(button("个人资料"), "ArrowLeft");
    expect(button("业绩与提成").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(button("业绩与提成"));
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("pc-tab-performance");
    await key(button("业绩与提成"), "ArrowRight");
    expect(button("个人资料").getAttribute("aria-selected")).toBe("true");
    await key(button("个人资料"), "End");
    expect(document.activeElement).toBe(button("业绩与提成"));
    await key(button("业绩与提成"), "Home");
    expect(document.activeElement).toBe(button("个人资料"));
  });

  it("uses a titled native portal dialog with initial focus, Tab trapping, Escape and close focus restoration", async () => {
    const trigger = button("修改密码");
    await click("修改密码");
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal).not.toBeNull();
    expect(container.contains(modal)).toBe(false);
    expect(modal.classList.contains("personal-center")).toBe(true);
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(modal.getAttribute("aria-labelledby")!)?.textContent).toBe("修改密码");
    expect(document.getElementById(modal.getAttribute("aria-describedby")!)?.textContent).toContain("退出");
    expect(document.activeElement).toBe(input("pc-old-password"));
    await fillPassword();
    await act(async () => button("修改并重新登录").focus());
    await key(button("修改并重新登录"), "Tab");
    expect(document.activeElement).toBe(input("pc-old-password"));
    await key(input("pc-old-password")!, "Tab", true);
    expect(document.activeElement).toBe(button("修改并重新登录"));
    await key(button("修改并重新登录"), "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await click("修改密码");
    expect(input("pc-old-password")?.value).toBe("");
    expect(input("pc-new-password")?.value).toBe("");
    expect(input("pc-confirm-password")?.value).toBe("");
    await click("关闭");
    expect(document.activeElement).toBe(trigger);
  });

  it("clears phone secrets, ticket and mutation cache on close while preserving genuine cooldown", async () => {
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    await click("关闭");
    expect(input("pc-phone-code")).toBeNull();
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("old-password");
    await click("验证与绑定手机");
    expect(input("pc-phone-password")?.value).toBe("");
    expect(input("pc-phone")?.value).toBe("");
    expect(input("pc-phone-code")?.value).toBe("");
    expect(input("pc-phone-code")?.disabled).toBe(true);
    expect(text()).not.toContain("验证码已发送");
    expect(button("60秒后重发").disabled).toBe(true);
  });

  it("allows the same legacy phone to request and consume SMS proof, without marking it verified early", async () => {
    await click("验证与绑定手机");
    await fillPhone("+8613800138000");
    await click("获取验证码");
    expect(state.rpc.requestPhoneCode.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13800138000" });
    expect(document.querySelector('[aria-label="账号安全状态"]')?.textContent).toContain("未验证");
    await fill("pc-phone-code", "123456");
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).toHaveBeenCalledWith({ oldPassword: "old-password", phone: "13800138000", ticketId: "ticket-1", code: "123456" });
    expect(state.logout).toHaveBeenCalledOnce();
  });

  it("reflects source-only unbound and verified phone states and unknown password status", async () => {
    state.user!.loginMethod = null;
    state.rpc.profile.query.mockResolvedValueOnce({ ...state.profile, phone: "", phoneBinding: "legacy_unverified" });
    await act(async () => client.invalidateQueries({ queryKey: ["personal-center-self"] }));
    await renderPage();
    expect(text()).toContain("密码状态暂不可核实");
    expect(text()).not.toContain("密码已设置");
    expect(document.querySelector('[aria-label="账号安全状态"]')?.textContent).toContain("未绑定");
    state.rpc.profile.query.mockResolvedValueOnce({ ...state.profile, phoneBinding: "verified_by_current_ticket" });
    await act(async () => client.invalidateQueries({ queryKey: ["personal-center-self"] }));
    await settle();
    expect(document.querySelector('[aria-label="账号安全状态"]')?.textContent).toContain("已验证");
    await click("更换手机号");
    expect(input("pc-phone")?.placeholder).toBe("中国大陆新手机号");
  });

  it("starts both month queries together and keeps performance visible when commission fails and retries", async () => {
    const commission = deferred<{ status: string; amount: null }>();
    state.rpc.commission.query.mockReturnValueOnce(commission.promise);
    await click("业绩与提成");
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="我的业绩"]')?.textContent).toContain("SELF-001");
    expect(document.querySelector('[aria-label="我的提成"] [role="status"]')).not.toBeNull();
    await act(async () => commission.reject(new Error("提成来源暂不可用")));
    await settle();
    expect(document.querySelector('[aria-label="我的提成"]')?.textContent).toContain("提成来源暂不可用");
    expect(document.querySelector('[aria-label="我的业绩"]')?.textContent).toContain("9,000.0000");
    await click("重试");
    expect(text()).toContain("尚未配置");
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
    expect(text()).toContain("SELF-001");
  });

  it("keeps commission visible when performance independently loads, fails and retries", async () => {
    const performance = deferred<typeof state.performance>();
    state.rpc.performance.query.mockReturnValueOnce(performance.promise);
    await click("业绩与提成");
    expect(document.querySelector('[aria-label="我的业绩"] [role="status"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="我的提成"]')?.textContent).toContain("尚未配置");
    await act(async () => performance.reject(new Error("业绩读取失败")));
    await settle();
    expect(document.querySelector('[aria-label="我的业绩"]')?.textContent).toContain("业绩读取失败");
    expect(document.querySelector('[aria-label="我的提成"]')?.textContent).toContain("尚未配置");
    await click("重试");
    expect(text()).toContain("SELF-001");
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
  });

  it("does not show previous-month data while new shared-month queries are pending", async () => {
    await click("业绩与提成");
    const performance = deferred<typeof state.performance>();
    const commission = deferred<{ status: string; month: string; amount: null; reason: string }>();
    state.rpc.performance.query.mockReturnValueOnce(performance.promise);
    state.rpc.commission.query.mockReturnValueOnce(commission.promise);
    await fill("pc-month", "2026-10");
    await settle();
    expect(text()).not.toContain("SELF-001");
    expect(text()).not.toContain("9,000.0000");
    expect(document.querySelectorAll(".pc-results [role='status']")).toHaveLength(2);
    await act(async () => {
      performance.resolve({ ...state.performance, month: "2026-10" });
      commission.resolve({ status: "unconfigured", month: "2026-10", amount: null, reason: "十月规则尚未配置" });
    });
    await settle();
    expect(text()).toContain("十月规则尚未配置");
  });

  it("blocks synchronous duplicate password submits and pending close/reopen cannot bypass the in-flight guard", async () => {
    const pending = deferred<typeof changed>();
    state.rpc.changePassword.mutate.mockReturnValueOnce(pending.promise);
    await click("修改密码");
    await fillPassword();
    const form = input("pc-old-password")!.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(state.rpc.changePassword.mutate).toHaveBeenCalledOnce();
    expect(button("修改并重新登录").disabled).toBe(true);
    expect(button("关闭").disabled).toBe(false);
    await click("关闭");
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("old-password");
    await click("修改密码");
    expect(input("pc-old-password")?.value).toBe("");
    expect(button("修改并重新登录").disabled).toBe(true);
    await submit("pc-old-password");
    expect(state.rpc.changePassword.mutate).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("旧弹窗的密码错误")));
    await settle();
    expect(text()).not.toContain("旧弹窗的密码错误");
    expect(button("修改并重新登录").disabled).toBe(false);
  });

  it("drops a pending SMS success after close/reopen even for the same phone, without writing ticket or wiping new code", async () => {
    const pending = deferred<typeof phoneTicket>();
    state.rpc.requestPhoneCode.mutate.mockReturnValueOnce(pending.promise);
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await click("关闭");
    await click("验证与绑定手机");
    expect(input("pc-phone-password")?.value).toBe("");
    expect(input("pc-phone")?.value).toBe("");
    expect(input("pc-phone-code")?.value).toBe("");
    // Programmatic input is a stress test; ordinary pending inputs remain disabled.
    await fillPhone();
    await fill("pc-phone-code", "654321");
    await act(async () => pending.resolve(phoneTicket));
    await settle();
    expect(input("pc-phone-code")?.value).toBe("654321");
    expect(input("pc-phone-code")?.disabled).toBe(true);
    expect(text()).not.toContain("验证码已发送");
    expect(button("验证并更换").disabled).toBe(true);
    await submit("pc-phone");
    expect(state.rpc.bindPhone.mutate).not.toHaveBeenCalled();
  });

  it("rejects a late SMS ticket when the phone revision changed, including editing away and back", async () => {
    const pending = deferred<typeof phoneTicket>();
    state.rpc.requestPhoneCode.mutate.mockReturnValueOnce(pending.promise);
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await fill("pc-phone", "13700137000");
    await fill("pc-phone", "13900139000");
    await act(async () => pending.resolve(phoneTicket));
    await settle();
    expect(text()).not.toContain("验证码已发送");
    expect(input("pc-phone-code")?.disabled).toBe(true);
    expect(button("验证并更换").disabled).toBe(true);
  });

  it("drops a pending SMS error from an old opening rather than contaminating a new target form", async () => {
    const pending = deferred<typeof phoneTicket>();
    state.rpc.requestPhoneCode.mutate.mockReturnValueOnce(pending.promise);
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await click("关闭");
    await click("验证与绑定手机");
    await fillPhone("13700137000");
    await act(async () => pending.reject(new Error("旧号码发送失败")));
    await settle();
    expect(input("pc-phone")?.value).toBe("13700137000");
    expect(text()).not.toContain("旧号码发送失败");
    expect(state.logout).not.toHaveBeenCalled();
    expect(button("获取验证码").disabled).toBe(false);
  });

  it("blocks duplicate bind submits and never logs out a new subject on late old bind success", async () => {
    const pending = deferred<{ success: boolean; requiresRelogin: boolean; phone: string }>();
    state.rpc.bindPhone.mutate.mockReturnValueOnce(pending.promise);
    await click("验证与绑定手机");
    await fillPhone();
    await click("获取验证码");
    await fill("pc-phone-code", "123456");
    const form = input("pc-phone")!.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(state.rpc.bindPhone.mutate).toHaveBeenCalledOnce();
    secondSubject();
    await renderPage();
    await act(async () => pending.resolve({ ...changed, phone: "13900139000" }));
    await settle();
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(text()).toContain("本人乙");
  });

  it("does not redirect a newly mounted subject when an already-started logout finishes late", async () => {
    const logout = deferred<void>();
    state.logout.mockReturnValueOnce(logout.promise);
    await click("修改密码");
    await fillPassword();
    await submit("pc-old-password");
    expect(state.logout).toHaveBeenCalledOnce();
    secondSubject();
    await renderPage();
    await act(async () => logout.resolve());
    await settle();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(text()).toContain("本人乙");
  });

  it("still routes to login after its own native logout clears and unmounts the session", async () => {
    const freshAuth = deferred<{ data: typeof state.user; error: null }>();
    state.refresh.mockReturnValueOnce(freshAuth.promise);
    state.logout.mockImplementationOnce(async () => {
      window.dispatchEvent(new Event("51dianzi:auth-session-cleared"));
      await Promise.resolve();
    });
    await click("修改密码");
    await fillPassword();
    await submit("pc-old-password");
    expect(state.navigate).toHaveBeenCalledWith("/login", { replace: true });
    await act(async () => freshAuth.resolve({ data: null, error: null }));
  });
});
