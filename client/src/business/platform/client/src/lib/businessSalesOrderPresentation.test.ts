import { describe, expect, it, vi } from "vitest";
import type { SalesOrderDetail } from "../../../shared/crmSalesOrders";
import {
  assertBusinessOrderDetail,
  buildBusinessOrdersCsv,
  businessCsvCell,
  businessMapLimited,
  collectBusinessOrderDetails,
  collectBusinessOrderSummaries,
  sumBusinessOrderAmounts,
  type BusinessOrderReaders,
} from "./businessSalesOrderPresentation";

import { fixtureOrder } from "./businessSalesOrderPresentation.fixtures";
const guard = () => ({
  signal: new AbortController().signal,
  isCurrent: () => true,
});
const fakeReaders = (count: number): BusinessOrderReaders => {
  const rows = Array.from({ length: count }, (_, index) =>
    fixtureOrder(index + 1)
  );
  return {
    list: vi.fn(async input => ({
      items: rows.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize
      ),
      total: count,
    })),
    get: vi.fn(async input => rows.find(row => row.id === input.id)!),
  };
};
describe("business-order read-only presentation and export scope", () => {
  it("reads every applied-filter page with exact binding, not only the visible page", async () => {
    const readers = fakeReaders(101);
    const filters = {
      keyword: "虚构筛选",
      customerId: 7,
      status: "confirmed" as const,
    };
    const rows = await collectBusinessOrderSummaries(
      readers,
      filters,
      guard(),
      101
    );
    expect(rows).toHaveLength(101);
    expect(vi.mocked(readers.list).mock.calls.map(call => call[0])).toEqual(
      [1, 2, 3].map(page => ({ ...filters, page, pageSize: 50 }))
    );
  });
  it("retains all four decimal places without a Number conversion", () => {
    expect(
      sumBusinessOrderAmounts([fixtureOrder(), { totalAmount: "0.0001" }])
    ).toBe("9007199254740993.1235");
    expect(sumBusinessOrderAmounts([])).toBe("0.0000");
    expect(buildBusinessOrdersCsv([fixtureOrder()])).toContain(
      '"9007199254740993.1234"'
    );
  });
  it.each([
    "=1+1",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    "  =HYPERLINK(1)",
    "\t=1",
    "\rtest",
  ])("neutralizes CSV spreadsheet payload %j", value => {
    expect(businessCsvCell(value)).toBe(`"'${value}"`);
  });
  it("quotes multiline data and does not invent receiver, address or aftersale state", () => {
    const order = fixtureOrder();
    order.customerName = '虚构"客户,\n第二行';
    const csv = buildBusinessOrdersCsv([order]);
    expect(csv).toContain('"虚构""客户,\n第二行"');
    expect(csv).toContain("FIXTURE-LM358");
    expect(csv).toContain("TEST-ONLY-001");
    expect(csv).toContain("未录入");
    expect(csv).toContain("尚未接入售后记录");
    expect(csv).not.toMatch(/无售后|待退款/);
  });
  it("requests only each order's own get with its exact customer id", async () => {
    const readers = fakeReaders(2);
    const details = await collectBusinessOrderDetails(
      readers,
      [fixtureOrder(2)],
      guard()
    );
    expect(details[0].id).toBe(2);
    expect(vi.mocked(readers.get).mock.calls[0][0]).toEqual({
      id: 2,
      customerId: 7,
    });
  });
  it.each([fixtureOrder(99), fixtureOrder(1, 8)])(
    "rejects mismatched detail snapshot %j",
    detail => {
      expect(() => assertBusinessOrderDetail(detail, fixtureOrder())).toThrow(
        "不一致"
      );
    }
  );
  it("rejects mixed-customer or wrong-status results rather than trimming foreign rows", async () => {
    const readers = fakeReaders(1);
    readers.list = vi.fn(async () => ({
      items: [fixtureOrder(1, 8)],
      total: 1,
    }));
    await expect(
      collectBusinessOrderSummaries(
        readers,
        { keyword: "", customerId: 7 },
        guard()
      )
    ).rejects.toThrow("不一致");
    readers.list = vi.fn(async () => ({
      items: [{ ...fixtureOrder(), status: "cancelled" }],
      total: 1,
    }));
    await expect(
      collectBusinessOrderSummaries(
        readers,
        { keyword: "", status: "confirmed" },
        guard()
      )
    ).rejects.toThrow("不一致");
  });
  it("fails the whole collection on any page failure, drift, duplicate, or malformed amount", async () => {
    const base = fakeReaders(51);
    const broken = {
      ...base,
      list: vi.fn(async (input: any, signal: AbortSignal) => {
        if (input.page === 2) throw new Error("fixture read failure");
        return base.list(input, signal);
      }),
    };
    await expect(
      collectBusinessOrderSummaries(broken, { keyword: "" }, guard())
    ).rejects.toThrow("fixture read failure");
    await expect(
      collectBusinessOrderSummaries(base, { keyword: "" }, guard(), 52)
    ).rejects.toThrow("数量已变化");
    const duplicate = {
      ...base,
      list: vi.fn(async (input: any, signal: AbortSignal) =>
        input.page === 2
          ? { items: [fixtureOrder(1)], total: 51 }
          : base.list(input, signal)
      ),
    };
    await expect(
      collectBusinessOrderSummaries(duplicate, { keyword: "" }, guard())
    ).rejects.toThrow("重复订单");
    const malformed = {
      ...base,
      list: vi.fn(async () => ({
        items: [{ ...fixtureOrder(), totalAmount: "0.00001" }],
        total: 1,
      })),
    };
    await expect(
      collectBusinessOrderSummaries(malformed, { keyword: "" }, guard())
    ).rejects.toThrow("precision");
  });
  it("ignores an old promise after identity replacement even if transport does not abort", async () => {
    let identityCurrent = true;
    let resolve!: (value: any) => void;
    const readers = fakeReaders(1);
    readers.list = vi.fn(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const result = collectBusinessOrderSummaries(
      readers,
      { keyword: "" },
      { signal: new AbortController().signal, isCurrent: () => identityCurrent }
    );
    identityCurrent = false;
    resolve({ items: [fixtureOrder()], total: 1 });
    await expect(result).rejects.toThrow("身份已变化");
  });
  it("keeps read concurrency bounded at three", async () => {
    let active = 0,
      peak = 0;
    const result = await businessMapLimited(
      Array.from({ length: 12 }, (_, index) => index),
      async value => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(done => setTimeout(done, 1));
        active--;
        return value;
      },
      guard()
    );
    expect(peak).toBe(3);
    expect(result).toHaveLength(12);
  });
});

describe("optional real metadata CSV fields", () => {
  it("uses independent receiver and aftersale records without invented financial state", () => {
    const csv = buildBusinessOrdersCsv([fixtureOrder()], new Map([[1, { receiver: "虚构订单收货人", receiverPhone: "TEST-PHONE", receiverAddress: "虚构订单地址", afterSales: "售后申请：已结案；仅记录，不自动退款或退库" }]]));
    expect(csv).toContain("虚构订单收货人"); expect(csv).toContain("虚构订单地址"); expect(csv).toContain("已结案");
    expect(csv).not.toContain("尚未接入售后记录"); expect(csv).not.toContain("已退款");
  });
  it("rejects an incomplete metadata map before constructing a partial CSV", () => {
    expect(() => buildBusinessOrdersCsv([fixtureOrder()], new Map())).toThrow("读取不完整");
  });
});
