// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const mocks = vi.hoisted(() => ({ list: vi.fn(), stats: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { order: { list: { useQuery: mocks.list }, stats: { useQuery: mocks.stats } } } }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: ReactNode }) => children }));
import Orders from "./Orders";

let root: Root;
let host: HTMLDivElement;
const order = { id: 1, orderNo: "UNIT-ORDER-001", batchNo: null, batchSeq: 1, buyerId: 1, buyerName: "测试买家", buyerUsername: "test", buyerCompanyName: null, buyerSalesOwner: null, sellerName: "测试供应商", totalAmount: 12, createdAt: "2026-11-01T01:00:00Z", status: "cancel" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  window.history.replaceState({}, "", "/orders");
  vi.clearAllMocks();
  mocks.list.mockReturnValue({ data: { total: 1, rows: [order] }, isLoading: false, isFetching: false, error: null, refetch: mocks.refetch });
  mocks.stats.mockReturnValue({ data: { totalOrders: 1, todayOrders: 1, grossAmount: 12, sevenDayOrders: 1, buyerCount: 1, sellerCount: 1, statusCounts: { cancel: 1 } }, isFetching: false, error: null, refetch: mocks.refetch });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() { await act(async () => root.render(createElement(Orders))); }
function button(label: string) { const result = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label); if (!result) throw new Error(`button not found: ${label}`); return result; }

describe("原站平台订单优化", () => {
  it("明确平台订单与内部业务订单的区别，并保留含取消的金额口径", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("平台订单");
    expect(host.textContent).toContain("销售订单");
    expect(host.textContent).toContain("采购订单");
    expect(host.textContent).toContain("含取消、退款订单；非实收金额");
    expect(host.textContent).toContain("不随下方列表筛选条件改变");
    expect(host.textContent).toContain("¥12.00");
  });
  it("横向滚动时保留订单识别列和详情操作列", async () => {
    await render();
    const headers = host.querySelectorAll("thead th");
    const cells = host.querySelectorAll("tbody td");
    expect(headers[0].classList.contains("sticky")).toBe(true);
    expect(headers[0].classList.contains("left-0")).toBe(true);
    expect(headers[headers.length - 1].classList.contains("right-0")).toBe(true);
    expect(cells[0].classList.contains("left-0")).toBe(true);
    expect(cells[cells.length - 1].classList.contains("right-0")).toBe(true);
  });
  it("点击状态后可一键清空筛选，并恢复第一页的真实查询参数", async () => {
    await render();
    const canceled = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "已取消 1")!;
    await act(async () => canceled.click());
    expect(mocks.list.mock.calls.at(-1)?.[0].status).toBe("cancel");
    await act(async () => button("重置筛选").click());
    expect(mocks.list.mock.calls.at(-1)?.[0]).toEqual({ page: 1, pageSize: 20, keyword: undefined, status: undefined });
  });
  it("查询失败时显示真实错误并提供重试，不将错误当作空订单", async () => {
    mocks.list.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: { message: "测试服务暂不可用" }, refetch: mocks.refetch });
    await render();
    expect(host.textContent).toContain("测试服务暂不可用");
    expect(host.textContent).not.toContain("没有符合条件的真实订单");
    await act(async () => button("重试").click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
