// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcurementDemandDetail, ProcurementDemandSummary } from "../../../shared/customerDemands";

const runtime = vi.hoisted(() => ({
  list: undefined as { items: ProcurementDemandSummary[]; total: number; page: number; pageSize: number } | undefined,
  detail: undefined as ProcurementDemandDetail | undefined,
  detailError: null as Error | null,
  listQuery: vi.fn(), detailQuery: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined),
  quoteList: vi.fn(), quoteDialog: vi.fn(),
}));
vi.mock("../hooks/usePageMemory", async () => {
  const React = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: (_key: string, initial: unknown) => React.useState(initial),
    freshListOptions: (options: object) => options,
    useRestoringListQuery: (query: unknown) => query,
    returnToPageSource: vi.fn(),
  };
});
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: React.PropsWithChildren) => h(React.Fragment, null, children) }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: { customerDemand: {
  procurementList: { useQuery: (input: object) => {
    runtime.listQuery(input);
    return { data: runtime.list, isLoading: false, isFetching: false, error: null, refetch: runtime.refresh };
  } },
  procurementGet: { useQuery: (input: object) => {
    runtime.detailQuery(input);
    return { data: runtime.detail, isLoading: false, error: runtime.detailError };
  } },
} } }));
vi.mock("../components/ui/dialog", () => ({
  Dialog: ({ children }: React.PropsWithChildren) => h(React.Fragment, null, children),
  DialogContent: ({ children }: React.PropsWithChildren) => h("section", { role: "dialog" }, children),
  DialogTitle: ({ children }: React.PropsWithChildren) => h("h2", null, children),
  DialogDescription: ({ children }: React.PropsWithChildren) => h("p", null, children),
  useDialogComposition: () => null,
}));
vi.mock("../components/customerDemands/DemandQuoteList", () => ({ DemandQuoteList: (props: { demandId: number; audience: string; onCreate: () => void; onEdit: (id: number) => void }) => {
  runtime.quoteList(props);
  return h("div", null, h("button", { onClick: props.onCreate }, "合成新增报价"), h("button", { onClick: () => props.onEdit(501) }, "合成编辑报价"));
} }));
vi.mock("../components/customerDemands/DemandQuoteDialog", () => ({ DemandQuoteDialog: (props: { demandId: number; quoteId?: number; onSaved: () => void; onClose: () => void }) => {
  runtime.quoteDialog(props);
  return h("section", { "data-test-quote-dialog": true }, h("button", { onClick: props.onSaved }, "合成保存报价"), h("button", { onClick: props.onClose }, "合成关闭报价"));
} }));
import ProcurementDemands from "./ProcurementDemands";

function summary(): ProcurementDemandSummary {
  return { id: 41, demandNo: "SYNTHETIC-XQ-41", projectName: "合成项目", priority: "normal", status: "submitted", createdByUserId: 7, salesName: "合成销售", procurementUserId: null, procurementName: "", itemCount: 4, version: 3, revision: 2, replyDueAt: "2026-11-16T00:00:00Z", submittedAt: "2026-11-14T01:04:00Z", createdAt: "2026-11-14T01:04:00Z", updatedAt: "2026-11-14T01:04:00Z", firstPartNumber: "SYNTHETIC-401", firstBrand: "TEST1", firstQty: 100, firstQtyUnit: "片", firstDeliveryRequirement: "2天", myActiveQuoteCount: 1, mySupplierCount: 1, myQuoteRoundCount: 2, currentQuoteCount: 1 };
}
function detail(): ProcurementDemandDetail {
  return { ...summary(), note: "合成需求说明第一行\n第二行", items: [
    { id: 401, partNumber: "SYNTHETIC-401", brand: "TEST1", pkg: "PKG1", qty: 100, qtyUnit: "片", deliveryRequirement: "2天", note: "第一项备注" },
    { id: 402, partNumber: "SYNTHETIC-402", brand: "TEST2", pkg: "PKG2", qty: 2500, qtyUnit: "个", deliveryRequirement: "5天", note: "第二项备注\n保留换行" },
    { id: 403, partNumber: "SYNTHETIC-403", brand: "TEST3", pkg: "PKG3", qty: null, qtyUnit: "片", deliveryRequirement: "待确认", note: "第三项备注" },
    { id: 404, partNumber: "SYNTHETIC-404", brand: "TEST4", pkg: "PKG4", qty: 9, qtyUnit: "套", deliveryRequirement: "一周", note: "第四项备注" },
  ] };
}
let root: Root; let host: HTMLDivElement;
function render() { act(() => root.render(h(ProcurementDemands))); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Missing procurement button ${label}`);
  await act(async () => button.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks(); runtime.detailError = null;
  runtime.list = { items: [summary()], total: 22, page: 2, pageSize: 20 }; runtime.detail = detail();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production network forbidden in synthetic procurement fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("采购需求摘要与完整物料详情", () => {
  it("keeps first-item summary, original metadata and actual total/page without N+1 detail reads", () => {
    render();
    expect(runtime.listQuery).toHaveBeenLastCalledWith({ view: "all", keyword: "", page: 2, pageSize: 20 });
    expect(runtime.detailQuery).not.toHaveBeenCalled();
    expect(host.textContent).toContain("共 22 条 · 第 2/2 页");
    for (const value of ["SYNTHETIC-401", "TEST1", "100片", "2天", "合成销售", "1家 · 累计2轮", "09:04"]) expect(host.textContent).toContain(value);
    expect(host.textContent).not.toContain("SYNTHETIC-402");
    expect(host.textContent).toContain("共4项 · 查看全部物料");
  });
  it("opens every persisted material with project, quantities, delivery, package, row notes and demand notes", async () => {
    render(); await click("共4项 · 查看全部物料");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 41 });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("物料明细（共4项）");
    expect(dialog?.textContent).toContain("合成项目");
    expect(dialog?.textContent).toContain("2026-11-16 08:00");
    const rows = [...(dialog?.querySelectorAll(".procurement-demand-items tbody tr") ?? [])];
    expect(rows).toHaveLength(4);
    for (const [index, item] of detail().items.entries()) {
      const cells = [...rows[index].querySelectorAll("td")].map(cell => cell.textContent);
      expect(cells).toEqual([item.partNumber, item.brand, item.pkg, item.qty == null ? "待确认" : item.qty.toLocaleString("zh-CN"), item.qtyUnit, item.deliveryRequirement, item.note]);
    }
    expect(rows[1].querySelector("td:last-child")?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(dialog?.textContent).toContain("合成需求说明第一行\n第二行");
    expect(runtime.quoteList).toHaveBeenCalledWith(expect.objectContaining({ demandId: 41, audience: "procurement" }));
  });
  it("the existing 查看 action uses the same full-detail API and closes without mutations", async () => {
    render(); await click("查看");
    expect(host.querySelectorAll(".procurement-demand-items tbody tr")).toHaveLength(4);
    await click("关闭"); expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.refresh).not.toHaveBeenCalled(); expect(runtime.quoteDialog).not.toHaveBeenCalled();
  });
  it("keeps quote create/edit binding to the selected demand and refreshes the list on save", async () => {
    render(); await click("共4项 · 查看全部物料"); await click("合成编辑报价");
    expect(runtime.quoteDialog).toHaveBeenLastCalledWith(expect.objectContaining({ demandId: 41, quoteId: 501 }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click("合成保存报价"); expect(runtime.refresh).toHaveBeenCalledTimes(1);
    await click("合成关闭报价"); await click("新增报价");
    expect(runtime.quoteDialog).toHaveBeenLastCalledWith(expect.objectContaining({ demandId: 41 }));
    expect(runtime.quoteDialog.mock.calls.at(-1)?.[0].quoteId).toBeUndefined();
  });
  it("does not fabricate full material data from a list summary when the detail read fails", async () => {
    runtime.detail = undefined; runtime.detailError = new Error("合成权限拒绝");
    render(); await click("共4项 · 查看全部物料");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("合成权限拒绝");
    expect(host.querySelector(".procurement-demand-items")).toBeNull(); expect(runtime.quoteList).not.toHaveBeenCalled();
  });
  it("does not expose multi-material shortcut for a single item and still preserves the 查看 entry", async () => {
    runtime.list!.items = [{ ...summary(), itemCount: 1 }];
    render(); expect(host.textContent).not.toContain("查看全部物料"); await click("查看");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 41 });
  });
});
