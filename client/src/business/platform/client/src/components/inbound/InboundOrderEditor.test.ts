// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ calls: [] as string[], mutations: {} as Record<string, ReturnType<typeof vi.fn>>, fees: [] as any[] }));
vi.mock("../../../../../api/business-trpc", () => {
  const api = new Proxy({}, { get: (_, name: string) => ({
    useQuery: () => ({ data: name === "costs" ? { order: { revision: 2, costTotal: "1234.00" }, costs: runtime.fees } : name === "history" ? { events: [] } : [], isError: false, refetch: vi.fn().mockResolvedValue({}) }),
    useMutation: () => ({ mutateAsync: runtime.mutations[name] ??= vi.fn().mockImplementation(async () => { runtime.calls.push(name); return name === "bulkCreate" ? { count: 2, items: [{ id: 1, sourceRow: 1 }, { id: 2, sourceRow: 2 }] } : { status: "in_transit", slipNo: "SYNTHETIC-ONLY" }; }), isPending: false }),
    invalidate: vi.fn().mockResolvedValue({}),
  }) });
  return { trpc: { inbound: api, useUtils: () => ({ inbound: api }) } };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { InboundOrderEditor } from "./InboundOrderEditor";
import { emptyForm } from "../../lib/inboundOrderEditorModel";
const formSeed = () => ({ ...emptyForm(), supplierName: "合成供应商", supplierContact: "合成联系人", buyerUserId: "7", operator: "合成采购员", partNumber: "PN", brand: "TI", qty: "100", unitCost: "12.34", prodYear: "2026", location: "A-01" });
const rowSeed = (status = "received") => ({ ...formSeed(), id: 1, slipNo: "SYNTHETIC-ONLY", status, qty: 100, actualQty: 100, paidAmount: "0", paymentCategory: "unpaid", unitCostTaxIncluded: "12.34", costTotal: "1234.00" });
let root: Root, host: HTMLDivElement, done: ReturnType<typeof vi.fn>;
function Host({ row, enabled = true }: any) {
  const [form, setForm] = React.useState({ ...formSeed(), ...(row ? { status: row.status } : {}) });
  const draft = { documents: [], busy: false, documentsOnly: false, isBlocked: () => false, isDocumentsOnly: () => false };
  return createElement(InboundOrderEditor, { form, setForm, row, draft, buyerScope: { actorUserId: 7, canChooseBuyer: true, options: [{ userId: 7, name: "合成采购员" }] }, buyerError: "", enabled, isCurrentScope: () => enabled, requestId: "fixed-synthetic-request", onClose: vi.fn(), onDone: done, photoBusy: false });
}
beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); runtime.calls = []; runtime.mutations = {}; runtime.fees = []; done = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(row: any = null, enabled = true) { await act(async () => root.render(createElement(Host, { row, enabled }))); }
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === name)!;
async function click(name: string) { await act(async () => button(name).click()); }
async function fill(label: string, value: string) { const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function confirm() { await click("保存修改"); await fill("修改原因", "合成修订原因"); await click("确认保存"); }
describe("采购 v2 实际编辑器保存路径（合成 API）", () => {
  it("单条 create 附费用与稳定请求号，付款仅按原货款协议", async () => {
    await render(); await fill("费用1 金额", "10.25"); await click("保存为在途");
    expect(runtime.mutations.create.mock.calls[0][0]).toMatchObject({ clientRequestId: "fixed-synthetic-request", costs: [{ title: "运费", amount: "10.25", payee: "supplier" }], payment: { mode: "unpaid" } }); expect(done).toHaveBeenCalledOnce();
  });
  it("多物料新建使用 bulkCreate，不逐行 create", async () => {
    await render(); await click("＋ 添加物料"); await fill("物料2 料号/型号", "PN2"); await fill("物料2 数量", "30"); await fill("物料2 单价", "0.38"); await click("保存为在途");
    expect(runtime.mutations.bulkCreate.mock.calls[0][0].rows).toHaveLength(2); expect(runtime.mutations.create).not.toHaveBeenCalled();
  });
  it("在途费用未改变时一次 update 且省略 costs", async () => {
    await render(rowSeed("in_transit")); await fill("供应商联系人", "新合成联系人"); await click("保存修改");
    expect(runtime.calls).toEqual(["update"]); expect(runtime.mutations.update.mock.calls[0][0]).not.toHaveProperty("costs");
  });
  it("在途删除全部费用传 costs=[] 并保持一次原子 update", async () => {
    runtime.fees = [{ title: "运费", amount: "10.25", payee: "supplier", note: "" }]; await render(rowSeed("in_transit"));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除费用1"]')!.click()); await confirm();
    expect(runtime.calls).toEqual(["update"]); expect(runtime.mutations.update.mock.calls[0][0].costs).toEqual([]); expect(runtime.mutations.revise).not.toHaveBeenCalled();
  });
  it("已入库先 revise 后 updateDetails", async () => {
    await render(rowSeed()); await fill("物料1 数量", "120"); await fill("供应商联系人", "新合成联系人"); await confirm();
    expect(runtime.calls).toEqual(["revise", "updateDetails"]); expect(runtime.mutations.revise.mock.calls[0][0]).toMatchObject({ id: 1, revision: 2, qty: 120, reason: "合成修订原因" });
  });
  it("已入库资料第二步失败明确修订已成功，禁用重复保存", async () => {
    runtime.mutations.updateDetails = vi.fn().mockRejectedValue(new Error("模拟资料失败")); await render(rowSeed()); await fill("物料1 数量", "120"); await fill("供应商联系人", "新合成联系人"); await confirm();
    expect(host.textContent).toContain("修订已成功，但供应商等资料未保存"); expect(runtime.mutations.revise).toHaveBeenCalledOnce(); expect(button("保存修改").disabled).toBe(true); expect(done).not.toHaveBeenCalled();
  });
  it("无成本字段时隐藏整块成本与费用，不用零成本占位", async () => {
    const row: any = rowSeed(); delete row.unitCostTaxIncluded; delete row.costTotal; await render(row);
    expect(host.textContent).not.toContain("成本汇总"); expect(host.textContent).not.toContain("采购费用"); expect(host.querySelector('[aria-label="物料1 单价"]')).toBeNull();
  });
});
