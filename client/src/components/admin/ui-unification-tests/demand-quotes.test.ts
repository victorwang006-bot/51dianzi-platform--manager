// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemandQuotes from "@/business/platform/client/src/pages/DemandQuotes";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  receivedQuotes: vi.fn(),
  refetch: vi.fn(),
  enterprise: vi.fn(),
}));

vi.mock("@/business/api/business-trpc", () => ({
  trpc: {
    demand: { receivedQuotes: { useQuery: mocks.receivedQuotes } },
    enterprise: { me: { useQuery: mocks.enterprise } },
  },
}));

vi.mock("@/business/BusinessContentFrame", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("wouter", async importOriginal => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useLocation: () => ["/demand-quotes", mocks.navigate],
}));

function quote(id: number) {
  return {
    id,
    demandId: id + 100,
    supplierId: id + 200,
    price: "12.30",
    qtyAvailable: 2300,
    leadTime: id === 1 ? null : "7天",
    note: id === 1 ? "原装，可拆包" : null,
    createdAt: new Date("2026-11-03T10:20:00"),
    partNumber: `PART-${id}`,
    brand: id === 1 ? "品牌甲" : null,
    category: "芯片",
    demandQty: 1200,
    demandQtyUnit: "个",
    targetPrice: id === 1 ? "11.20" : null,
    demandStatus: id === 1 ? "open" : "closed",
    supplierName: `Supplier ${id}`,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks();
  mocks.receivedQuotes.mockReturnValue({
    data: Array.from({ length: 12 }, (_, index) => quote(index + 1)),
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
  });
  mocks.enterprise.mockReturnValue({ data: { isOwner: true } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => root.render(createElement(DemandQuotes)));
}

function button(label: string) {
  const result = Array.from(host.querySelectorAll("button")).find(
    node => node.textContent?.trim() === label
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function typeSearch(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rows() {
  return Array.from(host.querySelectorAll("tbody tr"));
}

describe("收到的报价：统一呈现与原业务行为", () => {
  it("复用公共筛选及数据容器，不重复大标题和页签，保留所有报价字段", async () => {
    await render();
    expect(
      host.querySelector('section.aui-page[aria-label="收到的报价"]')
    ).not.toBeNull();
    expect(host.querySelector(".aui-filterbar input")).not.toBeNull();
    expect(host.querySelector(".aui-data-panel table")).not.toBeNull();
    expect(host.querySelector("h1")).toBeNull();
    expect(host.querySelectorAll("nav")).toHaveLength(0);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.querySelectorAll("thead th")).toHaveLength(12);
    expect(host.querySelectorAll('thead th[scope="col"]')).toHaveLength(12);
    expect(rows()).toHaveLength(10);
    const cells = rows()[0].querySelectorAll("td");
    expect(Array.from(cells).map(cell => cell.textContent)).toEqual([
      "2026-11-03 10:20",
      "PART-1",
      "品牌甲",
      "1,200 个",
      "￥11.20",
      "Supplier 1",
      "￥12.30",
      "2,300",
      "—",
      "原装，可拆包",
      "询价中",
      "聊一聊",
    ]);
    expect(cells[9].title).toBe("原装，可拆包");
    for (const index of [3, 4, 6, 7, 11]) {
      expect(cells[index].style.textAlign).toBe("right");
      expect(
        host.querySelectorAll("thead th")[index].getAttribute("style")
      ).toContain("text-align: right");
    }
    expect(rows()[1].textContent).toContain("面议");
    expect(rows()[1].textContent).toContain("已关闭");
    expect(host.querySelectorAll("[data-chat-action]")).toHaveLength(10);
    expect(
      mocks.receivedQuotes.mock.calls.every(args => args.length === 0)
    ).toBe(true);
  });

  it("保留草稿搜索、点击筛选、分页边界和重置回第一页", async () => {
    await render();
    expect(button("上一页").disabled).toBe(true);
    expect(button("下一页").disabled).toBe(false);
    await click("下一页");
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("PART-11");
    expect(button("下一页").disabled).toBe(true);
    await typeSearch(" part-1 ");
    expect(rows()).toHaveLength(2);
    await click("筛选");
    expect(rows()).toHaveLength(4);
    expect(rows()[0].textContent).toContain("PART-1");
    expect(button("上一页").disabled).toBe(true);
    expect(host.textContent).toContain("共 4 条报价");
    await click("重置");
    expect(host.querySelector("input")?.value).toBe("");
    expect(rows()).toHaveLength(10);
    expect(host.textContent).toContain("共 12 条报价");
    expect(button("上一页").disabled).toBe(true);
  });

  it("Enter 保留按供应商忽略大小写和两端空白的筛选，聊天保留原查询参数", async () => {
    await render();
    await click("下一页");
    await typeSearch(" SUPPLIER 12 ");
    await act(async () =>
      host
        .querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("PART-12");
    expect(button("上一页").disabled).toBe(true);
    expect(button("下一页").disabled).toBe(true);
    await click("聊一聊");
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/chat?userId=212");
  });

  it("无内部需求权限时也不新增或替换业务入口", async () => {
    mocks.enterprise.mockReturnValue({
      data: { isOwner: false, permissionKeys: [] },
    });
    await render();
    expect(host.querySelectorAll("nav, a")).toHaveLength(0);
    expect(mocks.enterprise).not.toHaveBeenCalled();
  });

  it("保留加载、空态、失败与重新加载状态，跨全部12列展示", async () => {
    const state = {
      data: [],
      isLoading: true,
      isError: false,
      error: null as null | { message: string },
      refetch: mocks.refetch,
    };
    mocks.receivedQuotes.mockImplementation(() => state);
    await render();
    expect(rows()[0].textContent).toContain("加载中...");
    expect(rows()[0].querySelector("td")?.colSpan).toBe(12);
    expect(host.querySelector(".aui-pagination")).toBeNull();
    state.isLoading = false;
    await render();
    expect(rows()[0].textContent).toContain(
      "暂无收到的报价，先到「发布需求」发布采购需求"
    );
    state.isError = true;
    state.error = { message: "请求失败" };
    await render();
    expect(rows()[0].textContent).toContain("报价数据加载失败：请求失败");
    await click("重新加载");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
