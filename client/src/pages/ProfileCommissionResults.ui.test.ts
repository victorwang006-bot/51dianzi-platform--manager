// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personalCommissionResultSchema, type PersonalCommissionResult } from "@shared/personalCommission";
import { personalPerformanceResultSchema } from "@shared/personalPerformance";

const rpc = vi.hoisted(() => ({ businessCompanies: { query: vi.fn() }, performance: { query: vi.fn() }, commission: { query: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { personalCenter: rpc } }) } }));
import { ProfileCommissionResults } from "./ProfileCommissionResults";
import ProfileBusinessPanel from "./ProfileBusinessPanel";

type Result = Extract<PersonalCommissionResult, { status: "available" }>;
type Input = { month: string; page: number; pageSize: number; merchantId: number };
const version = "20261117-per-order-whole-margin87-after-expenses";
const companyA = { merchantId: 9101, label: "合成公司甲" };
const companyB = { merchantId: 9102, label: "合成公司乙" };
function fixture(patch: Partial<Result> = {}): Result {
  return personalCommissionResultSchema.parse({ status: "available", month: "2026-09", currency: "CNY",
    currencyLabel: "人民币（按订单原税务口径）", timezone: "Asia/Shanghai", amount: null,
    payoutStatus: "unavailable", payoutReason: "合成发放来源：未接通真实发放证据。", refundAmount: null, refundStatus: "unavailable",
    basis: "合成原始统计口径：订单创建月与累计银行现金回款。", orderCount: 12, readyCount: 12, pendingCount: 0,
    estimatedAmount: "114.81", earnedAmount: "0.00", verifiedEstimatedAmount: "114.81", verifiedEarnedAmount: "0.00",
    total: 12, page: 1, pageSize: 10, items: [{ id: 7101, orderNumber: "SYNTHETIC-COMMISSION-A", createdAt: "2026-09-02T03:04:00Z",
      status: "confirmed", totalAmount: "1234.567890", bankCashPaidAmount: "345.670000", monthlyBookedAmount: "8888.880000",
      collectionGap: "888.897890", collectionStatus: "partial", policyVersion: version, financialAuditId: 8101,
      calculationStatus: "ready", pendingReason: null, salesTaxMode: "tax_included", costAmount: "333.123456", expenseAmount: "44.555555",
      netProfit: "765.432100", rate: 15, estimatedAmount: "114.81", earnedAmount: "0.00" }], ...patch }) as Result;
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const onPage = vi.fn();
const isCurrent = () => true;
function text(node: Node = container) { return node.textContent ?? ""; }
function button(label: string, parent: ParentNode = document.body) {
  const found = Array.from(parent.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === label || item.textContent === label);
  if (!found) throw new Error(`MISSING_SYNTHETIC_BUTTON:${label}`);
  return found;
}
function drawer() { return document.querySelector('.pc-business-commission-drawer[role="dialog"]'); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function click(label: string) { await act(async () => button(label).click()); await settle(); }
async function renderResult(result = fixture(), fetching = false) {
  await act(async () => root.render(createElement("div", { className: "personal-center" }, createElement(ProfileCommissionResults, { result, fetching, onPage }))));
  await settle();
}
async function renderPanel(prefix: readonly unknown[] = ["synthetic-identity", 1]) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement("div", { className: "personal-center" }, createElement(ProfileBusinessPanel, { prefix, isCurrent })))));
  await settle(); await settle();
}
async function changeCompany(value: number) {
  const select = container.querySelector("#pc-company") as HTMLSelectElement;
  await act(async () => { select.value = String(value); select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
async function changeMonth(value: string) {
  const input = container.querySelector("#pc-month") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rpc.businessCompanies.query.mockResolvedValue([companyA]);
  rpc.commission.query.mockImplementation(async (input: Input) => fixture({ month: input.month, page: input.page, pageSize: input.pageSize }));
  rpc.performance.query.mockImplementation(async (input: Input) => personalPerformanceResultSchema.parse({ status: "available", month: input.month,
    currency: "CNY", currencyLabel: "人民币（按订单原税务口径）", timezone: "Asia/Shanghai", orderCount: 0,
    orderAmount: "0.0000", collectedAmount: "0.0000", monthlyBookedAmount: "0.0000", refundAmount: null, refundStatus: "unavailable",
    basis: "合成业绩口径", items: [], total: 0, page: input.page, pageSize: input.pageSize }));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); });

describe("simple commission results with native Radix Dialog", () => {
  it("renders exactly two cards and six columns, one currency unit, and no habitual caveats", async () => {
    await renderResult();
    expect(container.querySelectorAll(".pc-stat")).toHaveLength(2);
    expect(Array.from(container.querySelectorAll("th")).map(node => text(node))).toEqual(["订单", "销售额", "已回款", "待回款", "预计提成", "回款状态"]);
    expect(container.querySelectorAll("tbody tr:first-child td")).toHaveLength(6);
    expect(text()).toContain("提成明细");
    expect(text().match(/人民币（元）/g)).toHaveLength(1);
    expect(text()).toContain("1,234.57"); expect(text()).toContain("345.67"); expect(text()).toContain("888.90");
    expect(text()).toContain("部分回款"); expect(text()).toContain("114.81");
    expect(container.querySelector("td small")?.textContent).toContain("2026/09/02");
    expect(text()).not.toMatch(/已有可核实预览|服务器全量|已发放提成|来源未接通|规则\/权益|规则与核验|账期|达标预览/);
    expect(text()).not.toContain(version); expect(text()).not.toContain("8888.88");
    expect(container.querySelectorAll(".pc-stat small")).toHaveLength(0);
    expect(drawer()).toBeNull();
  });
  it("keeps screenshot caveats out of the DOM and formats every visible monetary cell to two decimals", async () => {
    const base = fixture();
    await renderResult(fixture({ estimatedAmount: "70700.00", earnedAmount: "0.00", items: [{ ...base.items[0],
      totalAmount: "70700.000000", bankCashPaidAmount: "70000.100000", collectionGap: "699.900000", estimatedAmount: "70700.00" }] }));
    expect(Array.from(container.querySelectorAll(".pc-stat strong")).map(node => text(node))).toEqual(["70,700.00", "0.00"]);
    expect(Array.from(container.querySelectorAll("tbody td")).slice(1, 5).map(node => text(node)))
      .toEqual(["70,700.00", "70,000.10", "699.90", "70,700.00"]);
    expect(text()).toContain("预计提成"); expect(text()).toContain("部分回款");
    expect(text()).not.toMatch(/预计按订单创建月归属|截至当前累计银行\/现金回款|不是当月结算或工资到账|服务器全量|非已发放|仅足额银行\/现金回款订单|非已结算|可核\s*\d+\s*笔|金额未知|无真实发放证据|账期登记不计入现金回款|版本：|含税·规则\/权益待确认|预计及达标预览不代表个人权益审批|提成口径与来源/);
    expect(text()).not.toContain(version);
    expect(container.querySelector("details")).toBeNull();
  });
  it("shows the earned clarification only after help, with an accessible toggle", async () => {
    await renderResult();
    const phrase = "足额回款订单的提成预估，不代表已发放";
    expect(text()).not.toContain(phrase);
    expect(button("回款达标提成说明").getAttribute("aria-expanded")).toBe("false");
    await click("回款达标提成说明");
    expect(text()).toContain(phrase);
    const toggle = button("回款达标提成说明");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toBe(phrase);
    await click("回款达标提成说明"); expect(text()).not.toContain(phrase);
  });
  it("keeps null full totals unknown, exposes verified subtotals only as exceptions, and uses the real pending reason", async () => {
    const base = fixture();
    await renderResult(fixture({ pendingCount: 1, readyCount: 11, estimatedAmount: null, earnedAmount: null,
      verifiedEstimatedAmount: "21.34", verifiedEarnedAmount: "12.34", items: [{ ...base.items[0], calculationStatus: "pending",
        pendingReason: "missing_cost", costAmount: null, netProfit: null, rate: null, estimatedAmount: null, earnedAmount: null }] }));
    expect(Array.from(container.querySelectorAll(".pc-stat strong")).map(node => text(node))).toEqual(["待核", "待核"]);
    expect(text()).toContain("已核小计 21.34"); expect(text()).toContain("已核小计 12.34");
    expect(text(container.querySelector("tbody td:nth-child(5)")!)).toBe("成本待核");
    await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    expect(text(drawer()!)).toContain("成本待核"); expect(text(drawer()!)).toContain("净利润待核");
    expect(Array.from(drawer()!.querySelectorAll("dt")).find(node => text(node) === "采购成本")?.nextElementSibling?.textContent).toBe("成本待核");
  });
  it("shows server fields without recomputing and moves technical/source text into a closed disclosure", async () => {
    await renderResult();
    const trigger = button("查看订单 SYNTHETIC-COMMISSION-A 的提成详情"); trigger.focus();
    await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    const dialog = drawer()!;
    expect(dialog).not.toBeNull(); expect(container.contains(dialog)).toBe(false);
    expect(text(dialog)).toContain("333.12"); expect(text(dialog)).toContain("44.56");
    expect(text(dialog)).toContain("765.43"); expect(text(dialog)).toContain("15%");
    expect(text(dialog)).toContain("114.81"); expect(text(dialog)).not.toContain("1500%");
    expect(text(dialog)).toContain("× 87% − 费用");
    const disclosure = dialog.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(text(disclosure)).toContain(version); expect(text(disclosure)).toContain("8101");
    expect(text(disclosure)).toContain("合成原始统计口径"); expect(text(disclosure)).toContain("合成发放来源");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => trigger.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    await click("关闭订单提成详情"); expect(drawer()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("supports native Escape and preserves focus return without a Sheet dependency", async () => {
    await renderResult(); const trigger = button("查看订单 SYNTHETIC-COMMISSION-A 的提成详情"); trigger.focus();
    await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle(); expect(drawer()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("does not explain the current formula for an unknown saved version or fabricate a zero cost", async () => {
    const base = fixture();
    await renderResult(fixture({ items: [{ ...base.items[0], policyVersion: "synthetic-unknown-old-version", calculationStatus: "pending",
      pendingReason: "unknown_policy", costAmount: null, expenseAmount: null, netProfit: null, rate: null, estimatedAmount: null, earnedAmount: null }] }));
    expect(text()).toContain("历史规则版本待确认"); expect(text()).not.toContain("synthetic-unknown-old-version");
    await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    const formula = drawer()!.querySelector('[aria-label="计算公式"]')!;
    expect(text(formula)).toContain("暂不解释计算公式"); expect(text(formula)).not.toMatch(/87%|15%|净利润 =/);
    expect(text(drawer()!)).toContain("成本待核"); expect(text(drawer()!)).toContain("费用待核");
  });
  it("closes immediately when a result is replaced even if the same order ID is reused", async () => {
    const first = fixture(); await renderResult(first); await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    await renderResult(fixture({ items: [{ ...first.items[0], orderNumber: "SYNTHETIC-COMMISSION-REPLACEMENT", costAmount: "999.000000" }] }));
    expect(drawer()).toBeNull(); expect(document.body.textContent).not.toContain("333.12");
    await click("查看订单 SYNTHETIC-COMMISSION-REPLACEMENT 的提成详情"); expect(text(drawer()!)).toContain("999.00");
  });
  it("hides a selection while fetching and supports empty success without implying a payout", async () => {
    const result = fixture(); await renderResult(result); await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    await renderResult(result, true); expect(drawer()).toBeNull();
    await renderResult(result, false); expect(drawer()).toBeNull();
    await renderResult(fixture({ items: [], total: 0, orderCount: 0, readyCount: 0, estimatedAmount: "0.00", earnedAmount: "0.00" }));
    expect(text()).toContain("该月暂无本人已确认订单");
    expect(container.querySelector("tbody td")?.getAttribute("colspan")).toBe("6");
    expect(Array.from(container.querySelectorAll(".pc-stat strong")).map(node => text(node))).toEqual(["0.00", "0.00"]);
    expect(text()).not.toContain("已发放");
  });
  it("retains the partial and fully collected statuses with estimated commission always present", async () => {
    const first = fixture(); await renderResult(fixture({ earnedAmount: "114.81", items: [{ ...first.items[0], collectionStatus: "collected",
      bankCashPaidAmount: "1234.567890", collectionGap: "0.000000", earnedAmount: "114.81" }] }));
    expect(text()).toContain("足额回款"); expect(text(container.querySelector("tbody td:nth-child(5)")!)).toBe("114.81");
    await click("提成下一页"); expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe("commission presentation scoped to the existing business query fences", () => {
  it("hides a zero pending badge and places a nonzero badge by the title, not in a stat", async () => {
    await renderPanel(); expect(container.querySelector(".pc-business-commission-title .pc-business-status")).toBeNull();
    rpc.commission.query.mockImplementation(async (input: Input) => fixture({ month: input.month, page: input.page, pageSize: input.pageSize, pendingCount: 3, readyCount: 9 }));
    await changeMonth("2026-08");
    expect(container.querySelector(".pc-business-commission-title .pc-business-status")?.textContent).toBe("待核 3 笔");
    expect(container.querySelectorAll('.pc-results[aria-label="我的提成"] .pc-stat')).toHaveLength(2);
  });
  it.each(["page", "month", "company", "identity", "epoch"])("closes the drawer on %s context change without a detail request", async kind => {
    rpc.businessCompanies.query.mockResolvedValue([companyA, companyB]);
    await renderPanel(); await changeCompany(companyA.merchantId);
    await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情"); expect(drawer()).not.toBeNull();
    const previousCalls = rpc.commission.query.mock.calls.length;
    if (kind === "page") await click("提成下一页");
    if (kind === "month") await changeMonth("2026-08");
    if (kind === "company") await changeCompany(companyB.merchantId);
    if (kind === "identity") await renderPanel(["synthetic-new-identity", 1]);
    if (kind === "epoch") await renderPanel(["synthetic-identity", 2]);
    expect(drawer()).toBeNull();
    expect(rpc.commission.query.mock.calls.length).toBeLessThanOrEqual(previousCalls + 1);
    expect(rpc.commission.query.mock.calls.at(-1)?.[0]).not.toHaveProperty("orderId");
  });
  it("hides old drawer and rows during a slow next-month response and never mixes late data", async () => {
    await renderPanel(); await click("查看订单 SYNTHETIC-COMMISSION-A 的提成详情");
    const delayed = deferred<Result>(); rpc.commission.query.mockReturnValueOnce(delayed.promise);
    await changeMonth("2026-08");
    expect(drawer()).toBeNull(); expect(document.body.textContent).not.toContain("333.12");
    expect(container.querySelector('.pc-results[aria-label="我的提成"] [role="status"]')).not.toBeNull();
    await changeMonth("2026-07");
    await act(async () => delayed.resolve(fixture({ month: "2026-08", estimatedAmount: "999999.99" }))); await settle();
    expect(drawer()).toBeNull(); expect(text()).not.toContain("999,999.99");
    expect(text()).toContain("114.81");
  });
});
