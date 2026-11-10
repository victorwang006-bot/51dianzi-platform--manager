// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const mocks = vi.hoisted(() => ({
  orderList: vi.fn(), orderStats: vi.fn(), orderDetail: vi.fn(),
  logList: vi.fn(), logStats: vi.fn(),
  listRefetch: vi.fn(), statsRefetch: vi.fn(), navigate: vi.fn(),
  route: null as null | { id: string },
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  order: { list: { useQuery: mocks.orderList }, stats: { useQuery: mocks.orderStats }, detail: { useQuery: mocks.orderDetail } },
  exceptionLogs: { list: { useQuery: mocks.logList }, stats: { useQuery: mocks.logStats } },
} }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wouter", () => ({
  useLocation: () => ["/orders", mocks.navigate],
  useRoute: () => [Boolean(mocks.route), mocks.route],
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props, children),
}));
import Orders from "./Orders";
import ExceptionLogs from "./ExceptionLogs";

let root: Root;
let host: HTMLDivElement;
const order = { id: 101, orderNo: "SYNTHETIC-001", batchNo: null, batchSeq: 1, buyerId: 1, buyerName: "合成买家", buyerUsername: "synthetic", buyerCompanyName: null, buyerSalesOwner: null, sellerName: "合成供应商", totalAmount: 12, createdAt: "2026-11-01T01:00:00Z", status: "cancel" };
const orderStats = { totalOrders: 41, todayOrders: 1, grossAmount: 12, sevenDayOrders: 5, buyerCount: 2, sellerCount: 1, statusCounts: { cancel: 1 } };
const logStats = { last24h: [{ category: "attack_probe", count: 3 }], topIps: [{ ipAddress: "192.0.2.9", count: 7, ipOrigin: "合成来源" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.route = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  const blocked = () => { throw new Error("OFFLINE_TEST_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(blocked));
  vi.stubGlobal("XMLHttpRequest", vi.fn(blocked));
  vi.stubGlobal("WebSocket", vi.fn(blocked));
  mocks.orderList.mockReturnValue({ data: { total: 41, rows: [order] }, isLoading: false, isFetching: false, error: null, refetch: mocks.listRefetch });
  mocks.orderStats.mockReturnValue({ data: orderStats, isFetching: false, error: null, refetch: mocks.statsRefetch });
  mocks.orderDetail.mockReturnValue({ data: undefined, isLoading: true, error: null });
  mocks.logList.mockReturnValue({ data: { total: 101, data: [] }, isLoading: false, isFetching: false, error: null, refetch: mocks.listRefetch });
  mocks.logStats.mockReturnValue({ data: logStats, isFetching: false, error: null, refetch: mocks.statsRefetch });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
  expect(globalThis.WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
const render = async (component: typeof Orders | typeof ExceptionLogs) => { await act(async () => root.render(createElement(component))); };
const click = async (button: HTMLElement) => { await act(async () => button.click()); };
function button(label: string, container: ParentNode = host): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  if (!found) throw new Error(`missing button: ${label}`);
  return found;
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enter(input: HTMLInputElement) {
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}
const lastOrderInput = () => mocks.orderList.mock.calls.at(-1)?.[0];
const lastLogInput = () => mocks.logList.mock.calls.at(-1)?.[0];
function orderRoot() { return host.querySelector('[data-admin-page-family="platform-orders-list"]')!; }
function logsRoot() { return host.querySelector('[data-admin-header-family="exception-logs-inline-heading"]')!; }
function regions(page: Element) {
  return [...page.children].map(child => child.getAttribute("data-admin-header") === "primary" ? "header"
    : child.getAttribute("data-admin-filterbar") === "primary" ? "filters"
    : child.getAttribute("data-admin-header-region") || (child.querySelector("table") ? "table" : "pagination"));
}

describe("OrderList 精确展示例外（离线）", () => {
  it("唯一原筛选紧接header，完整六区域按约定顺序，四张统计和八个状态按钮仍在", async () => {
    await render(Orders);
    expect(regions(orderRoot())).toEqual(["header", "filters", "summary", "status", "table", "pagination"]);
    expect(host.querySelectorAll('input[placeholder="订单号、买家、供应商、收货人或手机号"]')).toHaveLength(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(orderRoot().querySelector('[data-admin-header-region="summary"]')?.children).toHaveLength(4);
    expect(orderRoot().querySelectorAll('[data-admin-header-region="status"] button')).toHaveLength(8);
    expect(host.textContent).toContain("含取消、退款订单；非实收金额");
    expect(host.textContent).toContain("最近7×24小时");
    expect(host.textContent).toContain("不随下方列表筛选条件改变");
    const controls = [...host.querySelectorAll("button,input")];
    expect(controls.indexOf(button("搜索"))).toBeLessThan(controls.indexOf(button("全部状态")));
  });
  it("草稿和应用关键词仍分离，分页后Enter回第一页，输入节点/焦点/草稿不丢", async () => {
    await render(Orders);
    const input = host.querySelector("input")!;
    input.focus();
    await type(input, "  合成订单  ");
    expect(lastOrderInput().keyword).toBeUndefined();
    await click(button("下一页"));
    expect(lastOrderInput().page).toBe(2);
    expect(host.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("  合成订单  ");
    await enter(input);
    expect(lastOrderInput()).toEqual({ page: 1, pageSize: 20, keyword: "合成订单", status: undefined });
    await click(button("已取消 1"));
    expect(lastOrderInput().status).toBe("cancel");
    expect(host.querySelector('[data-slot="select-trigger"]')?.textContent).toContain("已取消");
    await click(button("重置筛选"));
    expect(input.value).toBe("");
    expect(lastOrderInput()).toEqual({ page: 1, pageSize: 20, keyword: undefined, status: undefined });
  });
  it("统计错误仍在status，列表错误/重试不变，重渲染保草稿且不复制控件", async () => {
    await render(Orders);
    const input = host.querySelector("input")!;
    await type(input, "未提交草稿");
    mocks.orderStats.mockReturnValue({ data: undefined, isFetching: false, error: { message: "合成统计错误" }, refetch: mocks.statsRefetch });
    mocks.orderList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: { message: "合成列表错误" }, refetch: mocks.listRefetch });
    await render(Orders);
    expect(orderRoot().querySelector('[data-admin-header-region="status"]')?.textContent).toContain("统计暂不可用：合成统计错误");
    expect(host.textContent).toContain("商城订单服务暂不可用");
    expect(host.textContent).not.toContain("没有符合条件的真实订单");
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("未提交草稿");
    expect(lastOrderInput().keyword).toBeUndefined();
    await click(button("重试"));
    expect(mocks.listRefetch).toHaveBeenCalledOnce();
  });
  it("刷新仍调用两个原refetch，忙态与分页disabled边界不变", async () => {
    await render(Orders);
    expect(button("上一页").disabled).toBe(true);
    await click(button("刷新"));
    expect(mocks.listRefetch).toHaveBeenCalledOnce();
    expect(mocks.statsRefetch).toHaveBeenCalledOnce();
    await click(button("下一页"));
    await click(button("下一页"));
    expect(button("下一页").disabled).toBe(true);
    mocks.orderStats.mockReturnValue({ data: orderStats, isFetching: true, error: null, refetch: mocks.statsRefetch });
    await render(Orders);
    expect(button("刷新").disabled).toBe(true);
  });
  it("OrderDetail loading分支没有列表markers或列表查询，详情接口输入未变", async () => {
    mocks.route = { id: "101" };
    await render(Orders);
    expect(host.querySelector("[data-admin-page-family]")).toBeNull();
    expect(host.querySelector("[data-admin-filterbar]")).toBeNull();
    expect(mocks.orderList).not.toHaveBeenCalled();
    expect(mocks.orderStats).not.toHaveBeenCalled();
    expect(mocks.orderDetail).toHaveBeenCalledWith({ orderId: 101 }, { retry: 1 });
  });
});

describe("ExceptionLogs 精确展示例外（离线）", () => {
  it("header/heading/description唯一，筛选后为五张summary、条件攻击源、table、分页，30天说明保留", async () => {
    await render(ExceptionLogs);
    expect(regions(logsRoot())).toEqual(["header", "filters", "summary", "attack-sources", "table", "pagination"]);
    expect(host.querySelectorAll(".aui-page-heading")).toHaveLength(1);
    expect(host.querySelectorAll(".aui-page-description")).toHaveLength(1);
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector(".aui-page-description")?.textContent).toContain("日志保留 30 天，超期自动清理。");
    const summary = logsRoot().querySelector('[data-admin-header-region="summary"]')!;
    expect(summary.children).toHaveLength(5);
    expect(summary.textContent?.match(/近 24 小时/g)).toHaveLength(5);
    expect(host.textContent).toContain("近 7 天高频攻击来源");
    expect(host.textContent).toContain("合成来源");
    const controls = [...host.querySelectorAll("button,input,select")];
    expect(controls.indexOf(button("搜索"))).toBeLessThan(controls.indexOf(host.querySelector('button[title="点击查看该 IP 的全部行为"]')!));
  });
  it("草稿不发应用关键词，Enter修剪提交并回第一页，category/range输入仍即时且不丢草稿", async () => {
    await render(ExceptionLogs);
    const input = host.querySelector("input")!;
    input.focus();
    await type(input, "  合成摘要  ");
    expect(lastLogInput().search).toBeUndefined();
    const paging = logsRoot().lastElementChild!;
    await click(paging.querySelectorAll("button")[1]);
    expect(lastLogInput().page).toBe(2);
    expect(host.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    await enter(input);
    expect(lastLogInput().search).toBe("合成摘要");
    expect(lastLogInput().page).toBe(1);
    const selects = host.querySelectorAll("select");
    await act(async () => { selects[0].value = "server_error"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { selects[1].value = "1"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(lastLogInput()).toEqual({ page: 1, pageSize: 50, category: "server_error", withinHours: 1, search: "合成摘要", ipAddress: undefined });
    expect(input.value).toBe("  合成摘要  ");
    await click(button("清除筛选"));
    expect(input.value).toBe("");
    expect(lastLogInput()).toEqual({ page: 1, pageSize: 50, category: undefined, withinHours: 24, search: undefined, ipAddress: undefined });
  });
  it("攻击来源IP原点击仍设置IP/7天/清分类/回第一页，保留未应用草稿；清IP与全清语义不变", async () => {
    await render(ExceptionLogs);
    const input = host.querySelector("input")!;
    await type(input, "IP筛选时保留草稿");
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "server_error"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(logsRoot().lastElementChild!.querySelectorAll("button")[1]);
    await click(host.querySelector('button[title="点击查看该 IP 的全部行为"]')!);
    expect(lastLogInput()).toEqual({ page: 1, pageSize: 50, category: undefined, withinHours: 168, search: undefined, ipAddress: "192.0.2.9" });
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("IP筛选时保留草稿");
    const badge = logsRoot().querySelector('[data-admin-header-region="filters"] [data-slot="badge"]')!;
    expect(badge.textContent).toContain("192.0.2.9");
    await click(badge.querySelector("button")!);
    expect(lastLogInput().ipAddress).toBeUndefined();
    expect(lastLogInput().withinHours).toBe(168);
    await click(button("清除筛选"));
    expect(lastLogInput().withinHours).toBe(24);
    expect(input.value).toBe("");
  });
  it("攻击源为空和summary更新时保持筛选节点/焦点/草稿，条件缺席时只省原条件区域", async () => {
    await render(ExceptionLogs);
    const input = host.querySelector("input")!;
    input.focus();
    await type(input, "未应用");
    mocks.logStats.mockReturnValue({ data: { last24h: [], topIps: [] }, isFetching: false, error: null, refetch: mocks.statsRefetch });
    await render(ExceptionLogs);
    expect(regions(logsRoot())).toEqual(["header", "filters", "summary", "table", "pagination"]);
    expect(host.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("未应用");
    expect(lastLogInput().search).toBeUndefined();
  });
  it("刷新仍分别调用两个refetch，忙态disabled；总数/分页边界及原空态保留", async () => {
    await render(ExceptionLogs);
    await click(button("刷新"));
    expect(mocks.listRefetch).toHaveBeenCalledOnce();
    expect(mocks.statsRefetch).toHaveBeenCalledOnce();
    const paging = logsRoot().lastElementChild!;
    expect(paging.querySelectorAll("button")[0].disabled).toBe(true);
    await click(paging.querySelectorAll("button")[1]);
    await click(paging.querySelectorAll("button")[1]);
    expect(paging.querySelectorAll("button")[1].disabled).toBe(true);
    expect(host.textContent).toContain("第 3 / 3 页");
    expect(host.textContent).toContain("共 101 条");
    expect(host.textContent).toContain("所选范围内没有异常记录");
    mocks.logStats.mockReturnValue({ data: logStats, isFetching: true, error: null, refetch: mocks.statsRefetch });
    await render(ExceptionLogs);
    expect(button("刷新").disabled).toBe(true);
  });
});
