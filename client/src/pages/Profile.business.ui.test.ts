// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personalCommissionResultSchema, type PersonalCommissionResult } from "@shared/personalCommission";
import { personalPerformanceResultSchema, type PersonalPerformanceResult } from "@shared/personalPerformance";

const state = vi.hoisted(() => ({
  user: { id: 501, username: "fixture-user-a", openId: "local:501", hasNativeAdminAccount: true, loginMethod: "password" },
  refresh: vi.fn(), logout: vi.fn(), navigate: vi.fn(),
  rpc: { profile: { query: vi.fn() }, updateProfile: { mutate: vi.fn() }, changePassword: { mutate: vi.fn() },
    requestPhoneCode: { mutate: vi.fn() }, bindPhone: { mutate: vi.fn() }, businessCompanies: { query: vi.fn() },
    performance: { query: vi.fn() }, commission: { query: vi.fn() } },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user, loading: false, error: null,
  refresh: state.refresh, logout: state.logout }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { personalCenter: state.rpc } }) } }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => createElement("div", null, children) }));
vi.mock("wouter", () => ({ useLocation: () => ["/profile", state.navigate] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import Profile from "./Profile";

type Input = { month: string; merchantId: number; page: number; pageSize: number };
type Commission = Extract<PersonalCommissionResult, { status: "available" }>;
type Performance = Extract<PersonalPerformanceResult, { status: "available" }>;
const firstCompany = { merchantId: 601, label: "合成授权公司A" };
const secondCompany = { merchantId: 602, label: "合成授权公司B" };
function performanceFixture(input: Input, patch: Partial<Performance> = {}): Performance {
  return personalPerformanceResultSchema.parse({ status: "available", month: input.month, currency: "CNY",
    currencyLabel: "人民币（按订单原税务口径）", timezone: "Asia/Shanghai", orderCount: 23, orderAmount: "12800.0000",
    collectedAmount: "9200.0000", monthlyBookedAmount: "900.0000", refundAmount: null, refundStatus: "unavailable",
    basis: "本人已确认订单按创建月统计；现金回款按付款日期月统计；服务器全量合计不随分页改变。",
    total: 23, page: input.page, pageSize: input.pageSize,
    items: [{ id: input.page, orderNumber: `PERF-${input.merchantId}-${input.month}-${input.page}`, createdAt: `${input.month}-01T03:00:00Z`, status: "confirmed",
      totalAmount: "100.0000", currencyLabel: "人民币（按订单原税务口径）" }], ...patch }) as Performance;
}
function commissionFixture(input: Input, patch: Partial<Commission> = {}): Commission {
  return personalCommissionResultSchema.parse({ status: "available", month: input.month, currency: "CNY", currencyLabel: "人民币（按订单原税务口径）",
    timezone: "Asia/Shanghai", amount: null, payoutStatus: "unavailable", payoutReason: "未接通可审计的个人结算与发放来源；预览非权益审批。退款金额未知。",
    refundAmount: null, refundStatus: "unavailable", basis: "预计按订单创建月；达标按该月订单截至当前累计现金回款；服务器全量合计。",
    orderCount: 23, readyCount: 23, pendingCount: 0, estimatedAmount: "485.17", earnedAmount: "0.00",
    verifiedEstimatedAmount: "485.17", verifiedEarnedAmount: "0.00", total: 23, page: input.page, pageSize: input.pageSize,
    items: [{ id: input.page, orderNumber: `COMM-${input.merchantId}-${input.month}-${input.page}`, createdAt: `${input.month}-01T03:00:00Z`, status: "confirmed",
      totalAmount: "12800.000000", bankCashPaidAmount: "9200.000000", monthlyBookedAmount: "3600.000000", collectionGap: "3600.000000", collectionStatus: "partial",
      policyVersion: "synthetic-policy-v1", financialAuditId: 801, calculationStatus: "ready", pendingReason: null, salesTaxMode: "tax_included",
      costAmount: "7000.000000", expenseAmount: "1918.640000", netProfit: "3881.360000", rate: 0.125,
      estimatedAmount: "485.17", earnedAmount: "0.00" }], ...patch }) as Commission;
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
function section(label: "我的业绩" | "我的提成") { return container.querySelector(`[aria-label="${label}"]`)!; }
function text(node: Node = document.body) { return node.textContent ?? ""; }
function button(label: string, within: ParentNode = document.body) {
  const found = Array.from(within.querySelectorAll("button")).find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  if (!found) throw new Error(`BUTTON_NOT_FOUND:${label}`);
  return found;
}
function stat(label: string, within: ParentNode = section("我的提成")) {
  const found = Array.from(within.querySelectorAll(".pc-stat")).find(item => item.querySelector("span")?.textContent === label);
  if (!found) throw new Error(`STAT_NOT_FOUND:${label}`);
  return found;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(label: string, within?: ParentNode) { await act(async () => button(label, within).click()); await settle(); }
async function month(value: string) {
  const element = document.getElementById("pc-month") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }); await settle();
}
async function company(value: number) {
  const element = document.getElementById("pc-company") as HTMLSelectElement;
  await act(async () => { element.value = String(value); element.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Profile))));
  await settle();
}
beforeEach(async () => {
  vi.resetAllMocks();
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { id: 501, username: "fixture-user-a", openId: "local:501", hasNativeAdminAccount: true, loginMethod: "password" };
  state.refresh.mockResolvedValue({ data: state.user, error: null });
  state.rpc.profile.query.mockResolvedValue({ username: "fixture-user-a", displayName: "合成测试用户A", email: "fixture-a@example.test", phone: "15500000000", adminRole: "auditor", phoneBinding: "legacy_unverified" });
  state.rpc.businessCompanies.query.mockResolvedValue([firstCompany]);
  state.rpc.performance.query.mockImplementation(async (input: Input) => performanceFixture(input));
  state.rpc.commission.query.mockImplementation(async (input: Input) => commissionFixture(input));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); });

describe("Profile real-component business previews", () => {
  it("shows performance money with grouping and two decimals, keeps integer counts and removes redundant notes from the DOM", async () => {
    state.rpc.performance.query.mockImplementation(async (input: Input) => {
      const result = performanceFixture(input);
      return performanceFixture(input, { orderAmount: "70700.0000", collectedAmount: "7123.4567",
        items: [{ ...result.items[0], totalAmount: "70700.1250" }] });
    });
    await click("业绩与提成");
    const performance = section("我的业绩");
    expect(stat("销售额", performance).querySelector("strong")?.textContent).toBe("70,700.00");
    expect(stat("该月登记现金回款", performance).querySelector("strong")?.textContent).toBe("7,123.46");
    expect(performance.querySelector("tbody tr td:last-child")?.textContent).toBe("70,700.13");
    expect(stat("本人订单数", performance).querySelector("strong")?.textContent).toBe("23");
    expect(stat("本人订单数", performance).querySelector("small")?.textContent).toBe("该月创建 · 笔");
    expect(performance.querySelector("tbody tr td:nth-child(3)")?.textContent).toBe("已确认");
    expect(stat("销售额", performance).querySelector("small")).toBeNull();
    expect(stat("该月登记现金回款", performance).querySelector("small")).toBeNull();
    expect(performance.querySelector("details")).toBeNull();
    expect(text(performance)).not.toMatch(/订单及销售额按订单创建月|现金回款按付款日期月统计|累计回款达标预览|人民币（按订单原税务口径）|CNY|按付款日期|非提成发放|统计口径与不可用数据|账期登记|退款：|服务器全量合计/);
    await expect(state.rpc.performance.query.mock.results[0].value).resolves.toMatchObject({ orderAmount: "70700.0000", collectedAmount: "7123.4567" });
  });

  it("shows authoritative estimated/partial/gap values and never promotes them to payroll", async () => {
    expect(state.rpc.businessCompanies.query).not.toHaveBeenCalled();
    await click("业绩与提成");
    expect(Array.from(section("我的提成").querySelectorAll(".pc-stat")).map(item => item.querySelector("span")?.textContent))
      .toEqual(["预计提成", "回款达标提成"]);
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("0.00");
    expect(Array.from(section("我的提成").querySelectorAll("th")).map(item => item.textContent))
      .toEqual(["订单", "销售额", "已回款", "待回款", "预计提成", "回款状态"]);
    const cells = section("我的提成").querySelectorAll("tbody tr td");
    expect(cells).toHaveLength(6);
    expect(Array.from(cells).slice(1).map(item => item.textContent)).toEqual(["12,800.00", "9,200.00", "3,600.00", "485.17", "部分回款"]);
    const currentMonth = (document.getElementById("pc-month") as HTMLInputElement).value;
    expect(cells[0].querySelector("small")?.textContent).toBe(`${currentMonth.replace("-", "/")}/01 11:00`);
    expect(section("我的提成").querySelector("h2 .pc-business-status")).toBeNull();
    expect(text(section("我的提成"))).not.toMatch(/已发放提成|发放来源|无真实发放证据|规则\/权益待确认|synthetic-policy-v1/);
    expect(text(section("我的提成"))).not.toContain("预计按订单创建月");
    expect(text(section("我的提成"))).not.toContain("足额回款订单的提成预估，不代表已发放");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).not.toContain("尚未配置");
    expect(state.rpc.performance.query.mock.calls[0][0]).toEqual({ month: (document.getElementById("pc-month") as HTMLInputElement).value, merchantId: 601, page: 1, pageSize: 10 });
    expect(state.rpc.commission.query.mock.calls[0][0]).not.toHaveProperty("actorUserId");
    await click(`COMM-601-${currentMonth}-1`, section("我的提成"));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    const audit = dialog.querySelector<HTMLDetailsElement>("details")!;
    expect(audit.open).toBe(false);
    expect(audit.querySelector("summary")?.textContent).toBe("规则与来源详情");
    expect(text(audit)).toContain("synthetic-policy-v1");
    expect(Array.from(dialog.querySelectorAll("dd")).filter(item => item.textContent === "synthetic-policy-v1")).toHaveLength(1);
    expect(audit.contains(Array.from(dialog.querySelectorAll("dd")).find(item => item.textContent === "synthetic-policy-v1")!)).toBe(true);
    await act(async () => audit.querySelector("summary")!.click()); await settle();
    expect(audit.open).toBe(true);
    expect(text(audit)).toContain("未接通可审计的个人结算与发放来源；预览非权益审批。退款金额未知。");
    await click("关闭订单提成详情", dialog);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows ready and fully collected earned preview without claiming settlement or payout", async () => {
    state.rpc.commission.query.mockImplementation(async (input: Input) => {
      const result = commissionFixture(input); const order = result.items[0];
      return commissionFixture(input, { earnedAmount: "485.17", verifiedEarnedAmount: "485.17",
        items: [{ ...order, bankCashPaidAmount: "12800.000000", collectionGap: "0.000000", collectionStatus: "collected", earnedAmount: "485.17" }] });
    });
    await click("业绩与提成");
    expect(text(section("我的提成"))).toContain("足额回款");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(section("我的提成").querySelectorAll(".pc-stat")).toHaveLength(2);
    expect(text(section("我的提成"))).not.toContain("已发放提成");
    expect(text(section("我的提成"))).not.toContain("已到账");
    const help = button("回款达标提成说明", section("我的提成"));
    expect(help.getAttribute("aria-expanded")).toBe("false");
    expect(text(section("我的提成"))).not.toContain("足额回款订单的提成预估，不代表已发放");
    await click("回款达标提成说明", section("我的提成"));
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(help.getAttribute("aria-controls")!)?.textContent).toBe("足额回款订单的提成预估，不代表已发放");
    await click("回款达标提成说明", section("我的提成"));
    expect(help.getAttribute("aria-expanded")).toBe("false");
    expect(text(section("我的提成"))).not.toContain("足额回款订单的提成预估，不代表已发放");
  });

  it("shows pending complete totals as unknown and server-wide verified subtotals as subtotals", async () => {
    state.rpc.commission.query.mockImplementation(async (input: Input) => {
      const result = commissionFixture(input);
      return commissionFixture(input, { orderCount: 24, readyCount: 23, pendingCount: 1, total: 24,
        estimatedAmount: null, earnedAmount: null, verifiedEstimatedAmount: "1350.75", verifiedEarnedAmount: "275.25",
        items: [{ ...result.items[0], calculationStatus: "pending", pendingReason: "missing_cost", costAmount: null,
          estimatedAmount: null, earnedAmount: null }] });
    });
    await click("业绩与提成");
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("待核");
    expect(stat("预计提成").querySelector("small")?.textContent).toBe("已核小计 1,350.75");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("待核");
    expect(stat("回款达标提成").querySelector("small")?.textContent).toBe("已核小计 275.25");
    expect(section("我的提成").querySelectorAll("tbody tr td")[4].textContent).toBe("成本待核");
    expect(text(section("我的提成"))).not.toContain("485.17");
    expect(section("我的提成").querySelector("h2 .pc-business-status")?.textContent).toBe("待核 1 笔");
    expect(section("我的提成").querySelectorAll(".pc-stat")).toHaveLength(2);
  });

  it("does not label missing historical policy as zero or recalculate it in the browser", async () => {
    state.rpc.commission.query.mockImplementation(async (input: Input) => {
      const result = commissionFixture(input);
      return commissionFixture(input, { readyCount: 0, pendingCount: 23, estimatedAmount: null, earnedAmount: null,
        verifiedEstimatedAmount: "0.00", verifiedEarnedAmount: "0.00", items: [{ ...result.items[0], policyVersion: "synthetic-unsupported-v0",
          calculationStatus: "pending", pendingReason: "unknown_policy", estimatedAmount: null, earnedAmount: null }] });
    });
    await click("业绩与提成");
    expect(section("我的提成").querySelectorAll("tbody tr td")[4].textContent).toBe("历史规则版本待确认");
    expect(text(section("我的提成"))).not.toContain("synthetic-unsupported-v0");
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("待核");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("待核");
    expect(stat("预计提成").querySelector("small")?.textContent).toBe("已核小计 0.00");
    expect(stat("回款达标提成").querySelector("small")?.textContent).toBe("已核小计 0.00");
    expect(section("我的提成").querySelector("h2 .pc-business-status")?.textContent).toBe("待核 23 笔");
    const currentMonth = (document.getElementById("pc-month") as HTMLInputElement).value;
    await click(`COMM-601-${currentMonth}-1`, section("我的提成"));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const audit = dialog.querySelector<HTMLDetailsElement>("details")!;
    expect(audit.open).toBe(false);
    expect(audit.querySelector("summary")?.textContent).toBe("规则与来源详情");
    await act(async () => audit.querySelector("summary")!.click()); await settle();
    expect(audit.open).toBe(true);
    expect(text(audit)).toContain("synthetic-unsupported-v0");
    const formula = dialog.querySelector('[aria-label="计算公式"]')!;
    expect(Array.from(formula.querySelectorAll("p")).map(item => item.textContent)).toEqual(["历史规则版本待确认，暂不解释计算公式。"]);
    expect(text(formula)).not.toMatch(/87%|15%|18%|20%|净利润 =|正净利润/);
    expect(dialog.querySelector(".pc-business-drawer-values > div:last-child dd")?.textContent).toBe("历史规则版本待确认");
    expect(text(dialog)).not.toContain("485.17");
    await click("关闭订单提成详情", dialog);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("distinguishes a successful empty month from unavailable data and keeps payout unknown", async () => {
    state.rpc.performance.query.mockImplementation(async (input: Input) => performanceFixture(input, { orderCount: 0,
      orderAmount: "0.0000", collectedAmount: "0.0000", monthlyBookedAmount: "0.0000", items: [], total: 0 }));
    state.rpc.commission.query.mockImplementation(async (input: Input) => commissionFixture(input, { orderCount: 0, readyCount: 0,
      pendingCount: 0, estimatedAmount: "0.00", earnedAmount: "0.00", verifiedEstimatedAmount: "0.00", verifiedEarnedAmount: "0.00", items: [], total: 0 }));
    await click("业绩与提成");
    expect(section("我的提成").querySelector("tbody td")?.textContent).toBe("该月暂无本人已确认订单。");
    expect(section("我的提成").querySelector("tbody td")?.getAttribute("colspan")).toBe("6");
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("0.00");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("0.00");
    expect(text(section("我的业绩"))).toContain("该月暂无本人已确认订单");
    expect(stat("本人订单数", section("我的业绩")).querySelector("strong")?.textContent).toBe("0");
    expect(stat("销售额", section("我的业绩")).querySelector("strong")?.textContent).toBe("0.00");
    expect(stat("该月登记现金回款", section("我的业绩")).querySelector("strong")?.textContent).toBe("0.00");
    expect(section("我的提成").querySelectorAll(".pc-stat")).toHaveLength(2);
    expect(section("我的提成").querySelector("h2 .pc-business-status")).toBeNull();
    expect(text(section("我的提成"))).not.toMatch(/已发放提成|已到账|发放来源/);
    await click("回款达标提成说明", section("我的提成"));
    expect(text(stat("回款达标提成"))).toContain("足额回款订单的提成预估，不代表已发放");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps payment-month bank cash, creation-month cumulative cash and booked credit separate", async () => {
    state.rpc.performance.query.mockImplementation(async (input: Input) => performanceFixture(input, { collectedAmount: "2222.0000", monthlyBookedAmount: "99999.0000" }));
    state.rpc.commission.query.mockImplementation(async (input: Input) => {
      const result = commissionFixture(input);
      return commissionFixture(input, { items: [{ ...result.items[0], monthlyBookedAmount: "77777.000000" }] });
    });
    await click("业绩与提成");
    expect(text(stat("该月登记现金回款", section("我的业绩")))).toContain("2,222.00");
    expect(section("我的提成").querySelectorAll("tbody tr td")[2].textContent).toBe("9,200.00");
    expect(text(section("我的提成"))).not.toContain("2,222.00");
    expect(text(section("我的提成"))).not.toMatch(/2,222|99,999|77,777/);
    expect(section("我的提成").querySelectorAll("tbody tr td")[3].textContent).toBe("3,600.00");
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(stat("回款达标提成").querySelector("strong")?.textContent).toBe("0.00");
    expect(text(stat("回款达标提成"))).not.toMatch(/9,200|2,222|99,999|77,777/);
    expect(text(section("我的提成"))).not.toMatch(/已发放提成|账期登记不计入现金回款/);
  });

  it("uses only backend company options and requires a choice when more than one is authorized", async () => {
    state.rpc.businessCompanies.query.mockResolvedValue([firstCompany, secondCompany]);
    await click("业绩与提成");
    expect(text()).toContain("请选择已有授权业务公司后查看");
    expect(state.rpc.performance.query).not.toHaveBeenCalled();
    expect(state.rpc.commission.query).not.toHaveBeenCalled();
    await company(secondCompany.merchantId);
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0].merchantId).toBe(secondCompany.merchantId);
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0].merchantId).toBe(secondCompany.merchantId);
    expect(Array.from((document.getElementById("pc-company") as HTMLSelectElement).options).map(item => item.text)).toEqual([firstCompany.label, secondCompany.label]);
    await company(999999);
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
  });

  it("shows zero authorized companies as unavailable instead of fetching a broader default scope", async () => {
    state.rpc.businessCompanies.query.mockResolvedValue([]);
    await click("业绩与提成");
    expect(text()).toContain("暂无可用的授权业务公司");
    expect((document.getElementById("pc-company") as HTMLSelectElement).disabled).toBe(true);
    expect(state.rpc.performance.query).not.toHaveBeenCalled();
    expect(state.rpc.commission.query).not.toHaveBeenCalled();
    expect(container.querySelector(".pc-stat-grid")).toBeNull();
  });

  it("shows a company-list error safely and only retries that authorized-list query", async () => {
    state.rpc.businessCompanies.query.mockRejectedValueOnce(new Error("SELECT private_token FROM secrets"));
    await click("业绩与提成");
    expect(text()).toContain("授权公司查询失败");
    expect(text()).not.toContain("private_token");
    expect(state.rpc.performance.query).not.toHaveBeenCalled();
    await click("重试");
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
    expect(text(section("我的提成"))).toContain("485.17");
  });

  it("renders classified unavailability and correlation without presenting monetary zeros", async () => {
    const id = "8b9c6ad7-3cb8-47fc-b244-32fc7f953c8a";
    state.rpc.commission.query.mockImplementationOnce(async (input: Input) => personalCommissionResultSchema.parse({
      status: "unavailable", month: input.month, currency: "CNY", currencyLabel: "人民币（按订单原税务口径）", timezone: "Asia/Shanghai",
      amount: null, payoutStatus: "unavailable", payoutReason: "未接通发放来源", refundAmount: null, refundStatus: "unavailable",
      reason: "统计读取通道未接通", errorCategory: "delegation_unavailable", correlationId: id }));
    await click("业绩与提成");
    expect(text(section("我的提成"))).toContain("个人统计读取通道暂不可用");
    expect(text(section("我的提成"))).toContain(id);
    expect(section("我的提成").querySelector(".pc-stat-grid")).toBeNull();
    expect(text(section("我的业绩"))).toContain("12,800.00");
    await click("重试", section("我的提成"));
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
  });

  it("has independent pagination and server-wide totals unchanged by either current page", async () => {
    await click("业绩与提成");
    await click("业绩下一页");
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0].page).toBe(2);
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
    expect(text(stat("销售额", section("我的业绩")))).toContain("12,800.00");
    await click("提成下一页");
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0].page).toBe(2);
    expect(state.rpc.performance.query).toHaveBeenCalledTimes(2);
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    await month("2026-10");
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0]).toMatchObject({ month: "2026-10", page: 1 });
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0]).toMatchObject({ month: "2026-10", page: 1 });
  });

  it("hides a previous commission page while the next page is slow or fails without clearing performance", async () => {
    await click("业绩与提成");
    const pending = deferred<Commission>();
    state.rpc.commission.query.mockReturnValueOnce(pending.promise);
    await click("提成下一页");
    expect(text(section("我的提成"))).not.toContain("COMM-601-");
    expect(text(section("我的提成"))).not.toContain("485.17");
    expect(section("我的提成").querySelector('[role="status"]')).not.toBeNull();
    expect(text(section("我的业绩"))).toContain("12,800.00");
    await act(async () => pending.reject(new Error("SYNTHETIC_PAGE_FAILURE")));
    await settle();
    expect(text(section("我的提成"))).toContain("提成查询失败");
    expect(text(section("我的提成"))).not.toContain("485.17");
    await click("重试", section("我的提成"));
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0].page).toBe(2);
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(state.rpc.performance.query).toHaveBeenCalledOnce();
  });

  it("hides a previous performance page on slow or failed paging without replacing commission", async () => {
    await click("业绩与提成");
    const pending = deferred<Performance>();
    state.rpc.performance.query.mockReturnValueOnce(pending.promise);
    await click("业绩下一页");
    expect(text(section("我的业绩"))).not.toContain("PERF-601-");
    expect(text(section("我的业绩"))).not.toContain("12,800.00");
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    await act(async () => pending.reject(new Error("SYNTHETIC_PAGE_FAILURE")));
    await settle();
    expect(text(section("我的业绩"))).toContain("业绩查询失败");
    expect(text(section("我的业绩"))).not.toContain("12,800.00");
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
  });

  it("does not cancel or fail pending commission when only performance page changes", async () => {
    const pending = deferred<Commission>(); let original!: Input;
    state.rpc.commission.query.mockImplementationOnce((input: Input) => { original = input; return pending.promise; });
    await click("业绩与提成");
    await click("业绩下一页");
    await act(async () => pending.resolve(commissionFixture(original)));
    await settle();
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(section("我的提成").querySelector('[role="alert"]')).toBeNull();
    expect(state.rpc.commission.query).toHaveBeenCalledOnce();
  });

  it("does not mix late previous-month success into the newly selected month", async () => {
    const oldPerf = deferred<Performance>(); const oldComm = deferred<Commission>();
    let originalPerf!: Input; let originalComm!: Input;
    state.rpc.performance.query.mockImplementationOnce((input: Input) => { originalPerf = input; return oldPerf.promise; });
    state.rpc.commission.query.mockImplementationOnce((input: Input) => { originalComm = input; return oldComm.promise; });
    await click("业绩与提成");
    await month("2026-10");
    expect(text(section("我的提成"))).toContain("COMM-601-2026-10-1");
    await act(async () => { oldPerf.resolve(performanceFixture(originalPerf, { orderAmount: "999999.0000" }));
      oldComm.resolve(commissionFixture(originalComm, { estimatedAmount: "999999.99" })); });
    await settle();
    expect(text()).not.toContain("999,999");
    expect(text()).not.toContain(`COMM-601-${originalComm.month}-1`);
    expect(text()).toContain("COMM-601-2026-10-1");
  });

  it("hides old month money while new requests load or fail and ignores late old errors", async () => {
    await click("业绩与提成");
    const nextPerf = deferred<Performance>(); const nextComm = deferred<Commission>();
    state.rpc.performance.query.mockReturnValueOnce(nextPerf.promise); state.rpc.commission.query.mockReturnValueOnce(nextComm.promise);
    await month("2026-10");
    expect(text()).not.toContain("485.17");
    expect(text()).not.toContain("12,800.00");
    expect(container.querySelectorAll('.pc-results [role="status"]')).toHaveLength(2);
    await month("2026-09");
    await act(async () => { nextPerf.reject(new Error("OLD_SQL_ERROR")); nextComm.reject(new Error("OLD_COMPANY_FAILURE")); });
    await settle();
    expect(text()).toContain("COMM-601-2026-09-1");
    expect(text()).not.toContain("OLD_SQL_ERROR");
    expect(text()).not.toContain("OLD_COMPANY_FAILURE");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("blocks old-company values and errors after a company change and resets both pages", async () => {
    state.rpc.businessCompanies.query.mockResolvedValue([firstCompany, secondCompany]);
    await click("业绩与提成"); await company(firstCompany.merchantId);
    await click("业绩下一页"); await click("提成下一页");
    const pendingPerf = deferred<Performance>(); const pendingComm = deferred<Commission>(); let original!: Input;
    state.rpc.performance.query.mockImplementationOnce((input: Input) => { original = input; return pendingPerf.promise; });
    state.rpc.commission.query.mockReturnValueOnce(pendingComm.promise);
    await click("业绩下一页"); await click("提成下一页");
    await company(secondCompany.merchantId);
    expect(state.rpc.performance.query.mock.calls.at(-1)?.[0]).toMatchObject({ merchantId: 602, page: 1 });
    expect(state.rpc.commission.query.mock.calls.at(-1)?.[0]).toMatchObject({ merchantId: 602, page: 1 });
    await act(async () => { pendingPerf.resolve(performanceFixture(original, { orderAmount: "999999.0000" })); pendingComm.reject(new Error("OLD_COMPANY_FAILURE")); });
    await settle();
    expect(text()).toContain("COMM-602-");
    expect(text()).not.toContain("COMM-601-");
    expect(text()).not.toContain("999,999");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a failed new company free of the old company's rows and money", async () => {
    state.rpc.businessCompanies.query.mockResolvedValue([firstCompany, secondCompany]);
    await click("业绩与提成"); await company(firstCompany.merchantId);
    state.rpc.performance.query.mockRejectedValueOnce(new Error("NEW_SECRET"));
    state.rpc.commission.query.mockRejectedValueOnce(new Error("NEW_SQL"));
    await company(secondCompany.merchantId);
    expect(text()).not.toContain("COMM-601-");
    expect(text()).not.toContain("485.17");
    expect(text()).not.toContain("12,800.00");
    expect(text()).not.toContain("NEW_SECRET");
    expect(text()).not.toContain("NEW_SQL");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });

  it("rejects a successful response labelled with a different source month", async () => {
    state.rpc.commission.query.mockImplementationOnce(async (input: Input) => commissionFixture({ ...input, month: "2025-01" }));
    await click("业绩与提成");
    expect(text(section("我的提成"))).toContain("提成查询失败");
    expect(text(section("我的提成"))).not.toContain("485.17");
    expect(text(section("我的业绩"))).toContain("12,800.00");
  });

  it("does not revive an old query when the user switches month away and back", async () => {
    const old = deferred<Commission>(); let input!: Input;
    state.rpc.commission.query.mockImplementationOnce((value: Input) => { input = value; return old.promise; });
    await click("业绩与提成"); await month("2026-10"); await month(input.month);
    await act(async () => old.resolve(commissionFixture(input, { estimatedAmount: "999999.99" })));
    await settle();
    expect(stat("预计提成").querySelector("strong")?.textContent).toBe("485.17");
    expect(text()).not.toContain("999,999.99");
  });
});
