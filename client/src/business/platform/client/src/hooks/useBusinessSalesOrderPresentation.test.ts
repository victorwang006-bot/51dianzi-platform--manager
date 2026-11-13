// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useBusinessSalesOrderPresentation,
  type BusinessPresentationInput,
} from "./useBusinessSalesOrderPresentation";
import type { SalesOrderDetail } from "../../../shared/crmSalesOrders";
import { fixtureOrder } from "../lib/businessSalesOrderPresentation.fixtures";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let input: BusinessPresentationInput;
let view: ReturnType<typeof useBusinessSalesOrderPresentation>;
let downloads: ReturnType<typeof vi.fn>;
let blobs: Blob[];
function Harness() {
  view = useBusinessSalesOrderPresentation(input);
  return React.createElement(
    "div",
    null,
    view.aggregate?.amount,
    view.exportMessage
  );
}
async function render(change: Partial<BusinessPresentationInput> = {}) {
  input = { ...input, ...change };
  await act(async () => {
    root.render(React.createElement(Harness));
  });
}
async function run(callback: () => unknown) {
  await act(async () => {
    await callback();
  });
}
const rows = Array.from({ length: 51 }, (_, i) => ({
  ...fixtureOrder(i + 1),
  totalAmount: "0.0001",
}));
beforeEach(() => {
  blobs = [];
  downloads = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:fixture";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(downloads);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No real transport permitted");
    })
  );
  input = {
    identity: "verified-fixture:enterprise7:actor3:v1",
    verified: true,
    page: 1,
    filters: { keyword: "虚构", customerId: 7 },
    rows: rows.slice(0, 20),
    total: rows.length,
    readers: {
      list: vi.fn(async page => ({
        items: rows.slice(
          (page.page - 1) * page.pageSize,
          page.page * page.pageSize
        ),
        total: rows.length,
      })),
      get: vi.fn(async request => rows.find(row => row.id === request.id)!),
    },
    onReadError: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("business presentation hook (only fictional transport)", () => {
  it("shows full-filter exact total and exports all 51 orders by default", async () => {
    await render();
    expect(view.aggregate).toEqual({ total: 51, amount: "0.0051" });
    vi.mocked(input.readers.get).mockClear();
    await run(view.exportOrders);
    expect(input.readers.get).toHaveBeenCalledTimes(51);
    expect(downloads).toHaveBeenCalledTimes(1);
    expect(view.exportMessage).toContain("51 条当前筛选订单");
  });
  it("exports selected N only with their exact get binding", async () => {
    await render();
    await run(() => view.toggle(2));
    await run(() => view.toggle(5));
    expect([...view.selectedIds]).toEqual([2, 5]);
    vi.mocked(input.readers.get).mockClear();
    vi.mocked(input.readers.list).mockClear();
    await run(view.exportOrders);
    expect(input.readers.list).not.toHaveBeenCalled();
    expect(
      vi.mocked(input.readers.get).mock.calls.map(call => call[0])
    ).toEqual([
      { id: 2, customerId: 7 },
      { id: 5, customerId: 7 },
    ]);
    expect(view.exportMessage).toContain("2 条选中订单");
    expect(downloads).toHaveBeenCalledTimes(1);
  });
  it.each(["page", "filter", "identity", "permission"])(
    "synchronously clears selection on %s change",
    async change => {
      await render();
      await run(() => view.toggleAll());
      expect(view.selectedIds.size).toBe(20);
      await render(
        change === "page"
          ? { page: 2, rows: rows.slice(20, 40) }
          : change === "filter"
            ? { filters: { keyword: "另一筛选", customerId: 7 } }
            : change === "identity"
              ? { identity: "verified-fixture:v2" }
              : { verified: false }
      );
      expect(view.selectedIds.size).toBe(0);
    }
  );
  it("performs no reads from unverified context or unproven list/cache", async () => {
    await render({ verified: false });
    expect(input.readers.get).not.toHaveBeenCalled();
    expect(input.readers.list).not.toHaveBeenCalled();
    await render({ verified: true, rows: undefined });
    expect(input.readers.get).not.toHaveBeenCalled();
    await run(view.exportOrders);
    expect(downloads).not.toHaveBeenCalled();
  });
  it("creates no partial file after any detail read fails", async () => {
    await render();
    input.readers.get = vi.fn(async request => {
      if (request.id === 25) throw new Error("fixture failed");
      return rows[request.id - 1];
    });
    await render();
    await run(view.exportOrders);
    expect(downloads).not.toHaveBeenCalled();
    expect(blobs).toHaveLength(0);
    expect(view.exportMessage).toContain("导出失败，未生成文件");
  });
  it.each(["cancel", "identity", "filter"])(
    "does not leak old export completion after %s",
    async change => {
      await render();
      let resolve!: (row: SalesOrderDetail) => void;
      const waiting = new Promise<SalesOrderDetail>(done => {
        resolve = done;
      });
      input.readers.get = vi.fn(async request =>
        request.id === 1 ? waiting : rows[request.id - 1]
      );
      await render();
      let completion!: Promise<void>;
      await run(() => {
        completion = view.exportOrders();
      });
      expect(view.exportBusy).toBe(true);
      if (change === "cancel") await run(view.cancelExport);
      else
        await render(
          change === "identity"
            ? { identity: "verified-fixture:new-actor", verified: false }
            : {
                filters: { keyword: "不同筛选", customerId: 7 },
                rows: undefined,
              }
        );
      await run(async () => {
        resolve(rows[0]);
        await completion;
      });
      expect(downloads).not.toHaveBeenCalled();
      expect(blobs).toHaveLength(0);
      expect(view.exportBusy).toBe(false);
    }
  );
  it("rejects foreign/mismatched row detail without showing cached merchandise", async () => {
    input.readers.get = vi.fn(async () => ({
      ...fixtureOrder(99, 8),
      items: [{ ...fixtureOrder().items[0], partNumber: "FOREIGN-SECRET" }],
    }));
    await render();
    expect(view.details).toBeUndefined();
    expect(view.detailsError).toContain("不一致");
    expect(host.textContent).not.toContain("FOREIGN-SECRET");
  });
});

describe("optional metadata export reader boundary", () => {
  it("reads real metadata for the full export range before any file exists", async () => {
    const readExportMetadata = vi.fn(async (orders: readonly SalesOrderDetail[], guard: { signal: AbortSignal; isCurrent: () => boolean }) => {
      expect(downloads).not.toHaveBeenCalled();
      expect(guard.isCurrent()).toBe(true);
      expect(guard.signal.aborted).toBe(false);
      return new Map(orders.map(order => [order.id, { receiver: "虚构收货人", receiverPhone: "TEST-PHONE", receiverAddress: "虚构测试地址", afterSales: "售后申请：处理中；仅记录，不自动退款或退库" }]));
    });
    await render({ readExportMetadata }); await run(view.exportOrders);
    expect(readExportMetadata).toHaveBeenCalledTimes(1);
    expect(readExportMetadata.mock.calls[0][0]).toHaveLength(51);
    expect(downloads).toHaveBeenCalledTimes(1);
  });
  it.each(["failure", "missing"])("does not download on metadata %s", async mode => {
    await render({ readExportMetadata: async () => { if (mode === "failure") throw new Error("fixture metadata read failed"); return new Map(); } });
    await run(view.exportOrders);
    expect(downloads).not.toHaveBeenCalled(); expect(blobs).toHaveLength(0);
    expect(view.exportMessage).toContain("导出失败，未生成文件");
  });
});
