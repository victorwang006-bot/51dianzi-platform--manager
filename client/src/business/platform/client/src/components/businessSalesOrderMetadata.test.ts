// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  scope: {
    merchantId: 7,
    contextVerification: { state: "verified", identity: "actor-1", authorizationVersion: "auth-1", readVersion: "read-1" },
    onAuthorizationError: vi.fn(),
  },
  factory: vi.fn(), get: vi.fn(), metadataGet: vi.fn(),
  saveReceiver: vi.fn(), addAfterSale: vi.fn(), updateAfterSale: vi.fn(),
}));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: (merchantId: number) => {
    runtime.factory(merchantId);
    return { crmSalesOrder: {
      get: { query: runtime.get }, metadataGet: { query: runtime.metadataGet },
      saveReceiver: { mutate: runtime.saveReceiver }, addAfterSale: { mutate: runtime.addAfterSale },
      updateAfterSale: { mutate: runtime.updateAfterSale },
    } };
  },
}));
vi.mock("./ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? children : null,
  DialogContent: ({ children }: any) => React.createElement("div", { "data-metadata-dialog": true }, children),
  DialogHeader: ({ children }: any) => React.createElement("header", null, children),
  DialogTitle: ({ children }: any) => React.createElement("h2", null, children),
  DialogDescription: ({ children }: any) => React.createElement("p", null, children),
  DialogFooter: ({ children }: any) => React.createElement("footer", null, children),
  useDialogComposition: () => ({ isComposing: () => false, setComposing: () => {}, justEndedComposing: () => false, markCompositionEnd: () => {} }),
}));

import {
  BusinessSalesOrderMetadataProvider,
  BusinessSalesOrderReceiverCell,
  BusinessSalesOrderAfterSaleCell,
  BusinessSalesOrderMetadataActionItems,
  getMetadataForExport,
  createBusinessSalesOrderMetadataExportReader,
  assertBusinessSalesOrderMetadataOrder,
  newBusinessSalesOrderMetadataRequestId,
  type BusinessSalesOrderMetadataProviderProps,
  type BusinessSalesOrderMetadataOrder,
} from "./businessSalesOrderMetadata";
import { BUSINESS_AFTER_SALE_KINDS, type BusinessSalesOrderMetadataDto } from "@shared/businessSalesOrderMetadata";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const order: BusinessSalesOrderMetadataOrder = { id: 11, orderNumber: "SO-11", customerId: 1 };
const iso = "2026-11-13T12:00:00.000Z";
const receiver = (version = 1) => ({ receiver: "独立收货人", receiverPhone: "13900000000", receiverAddress: "独立订单地址", note: "订单备注", version, createdAt: iso, updatedAt: iso });
const record = (version = 1) => ({ id: 21, kind: "refund_request" as const, reason: "客户申请核对", status: "closed" as const, resolution: "仅结案备注", version, createdAt: iso, updatedAt: iso, closedAt: iso });
let metadata: BusinessSalesOrderMetadataDto;
let root: Root;
let container: HTMLDivElement;
let props: Omit<BusinessSalesOrderMetadataProviderProps, "children">;
const metadataScope = { merchantId: 7, orderId: 11, orderNumber: "SO-11", customerId: 1 };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
async function render() {
  await act(async () => {
    root.render(React.createElement(BusinessSalesOrderMetadataProvider, props,
      ...props.rows.map(row => React.createElement("section", { key: `${row.id}-${row.orderNumber}-${row.customerId}`, "data-order": row.id },
        React.createElement(BusinessSalesOrderReceiverCell, { order: row }),
        React.createElement(BusinessSalesOrderAfterSaleCell, { order: row }),
        React.createElement(BusinessSalesOrderMetadataActionItems, { order: row, onClose: () => props.onDialogOpenChange?.(false) }),
      ))));
  });
  await flush();
}
function button(text: string) {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === text);
  expect(found, `button ${text}`).toBeTruthy();
  return found!;
}
async function click(text: string) { await act(async () => { button(text).click(); }); await flush(); }
async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  expect(field).toBeTruthy();
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  const field = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function submit(text: string) {
  await act(async () => { button(text).closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.scope = {
    merchantId: 7,
    contextVerification: { state: "verified", identity: "actor-1", authorizationVersion: "auth-1", readVersion: "read-1" },
    onAuthorizationError: vi.fn(),
  };
  metadata = { ...metadataScope, receiver: null, afterSales: [] };
  props = { rows: [order], ready: true, canWrite: true, identityKey: "page-scope-1", merchantId: 7, customerId: 1, onDialogOpenChange: vi.fn() };
  runtime.get.mockReset().mockImplementation(async (input: { id: number; customerId?: number }) => ({
    id: input.id, orderNumber: `SO-${input.id}`, customerId: input.customerId ?? 1,
  }));
  runtime.metadataGet.mockReset().mockImplementation(async (input: { id: number; customerId?: number }) => ({
    ...structuredClone(metadata), orderId: input.id, orderNumber: `SO-${input.id}`, customerId: input.customerId ?? 1,
  }));
  runtime.saveReceiver.mockReset().mockImplementation(async (value: any) => {
    metadata.receiver = { ...receiver(value.version + 1), receiver: value.receiver, receiverPhone: value.receiverPhone, receiverAddress: value.receiverAddress, note: value.note };
    return metadata.receiver;
  });
  runtime.addAfterSale.mockReset().mockImplementation(async (value: any) => {
    const added = { ...record(), id: 22, kind: value.kind, reason: value.reason, status: "open" as const, resolution: "", closedAt: null };
    metadata.afterSales.push(added);
    return added;
  });
  runtime.updateAfterSale.mockReset().mockImplementation(async (value: any) => {
    const index = metadata.afterSales.findIndex(item => item.id === value.caseId);
    metadata.afterSales[index] = { ...metadata.afterSales[index], version: value.version + 1, status: value.status, resolution: value.resolution };
    return metadata.afterSales[index];
  });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("测试禁止真实网络"); }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("business sales order metadata isolated native UI", () => {
  it("reads real saved receiver/after-sales in read-only mode and labels closed as 已结案", async () => {
    metadata = { ...metadataScope, receiver: receiver(), afterSales: [record()] }; props.canWrite = false;
    await render();
    expect(runtime.factory).toHaveBeenCalledWith(7);
    expect(runtime.get).toHaveBeenCalledWith({ id: 11, customerId: 1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("独立收货人 · 13900000000");
    expect(container.querySelector('[title="独立订单地址"]')).toBeTruthy();
    expect(container.textContent).toContain("1 条售后记录");
    expect(container.textContent).toContain("退款申请 · 已结案");
    await click("收货信息（查看）");
    expect(container.querySelector<HTMLInputElement>('[aria-label="收货人"]')?.readOnly).toBe(true);
    expect(container.textContent).toContain("售后仅登记，不自动退款或退库");
    expect(container.textContent).not.toContain("保存收货信息");
    await click("关闭"); await click("售后记录（查看）");
    expect(container.textContent).toContain("当前为只读，不能登记或更新售后记录");
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(runtime.saveReceiver).not.toHaveBeenCalled(); expect(runtime.addAfterSale).not.toHaveBeenCalled(); expect(runtime.updateAfterSale).not.toHaveBeenCalled();
  });

  it("distinguishes initial loading, successful missing and errors without false empty history", async () => {
    const wait = deferred<BusinessSalesOrderMetadataDto>(); runtime.metadataGet.mockReturnValueOnce(wait.promise);
    await render();
    expect(container.textContent).toContain("收货信息读取中"); expect(container.textContent).toContain("售后记录读取中");
    expect(container.textContent).not.toContain("未录入售后");
    await act(async () => { wait.resolve(metadata); }); await flush();
    expect(container.textContent).toContain("未录入收货信息"); expect(container.textContent).toContain("未录入售后");
    runtime.metadataGet.mockRejectedValueOnce(new Error("fixture read failure"));
    props.identityKey = "fresh-scope"; await render();
    expect(container.textContent).toContain("售后记录读取失败"); expect(container.textContent).not.toContain("未录入售后");
    expect(runtime.scope.onAuthorizationError).toHaveBeenCalled();
  });

  it("fails closed for nonverified scope, merchant mismatch, null identity or wrong customer tuple", async () => {
    props.ready = false; await render();
    props.ready = true; runtime.scope.contextVerification.state = "revalidating"; await render();
    runtime.scope.contextVerification.state = "verified"; props.merchantId = 8; await render();
    props.merchantId = 7; props.identityKey = null; await render();
    expect(runtime.factory).not.toHaveBeenCalled(); expect(runtime.get).not.toHaveBeenCalled();
    props.identityKey = "restored"; props.customerId = 2; await render();
    expect(runtime.get).not.toHaveBeenCalled(); expect(runtime.metadataGet).not.toHaveBeenCalled();
    expect(button("收货信息").disabled).toBe(true);
  });

  it("rejects mismatching native get order identity before metadata access", async () => {
    runtime.get.mockResolvedValueOnce({ ...order, orderNumber: "OTHER-ORDER" });
    await render();
    expect(runtime.metadataGet).not.toHaveBeenCalled(); expect(container.textContent).toContain("售后记录读取失败");
    expect(() => assertBusinessSalesOrderMetadataOrder(order, { ...order, customerId: 2 }, 1)).toThrow("订单身份核验不一致");
  });

  it("aborts stale reads and closes dialogs synchronously across identity/order/merchant changes", async () => {
    metadata.receiver = receiver(); await render(); await click("收货信息");
    expect(container.querySelector("[data-metadata-dialog]")).toBeTruthy();
    const wait = deferred<BusinessSalesOrderMetadataDto>(); runtime.metadataGet.mockReturnValueOnce(wait.promise);
    props.identityKey = "actor-2"; await render();
    expect(container.querySelector("[data-metadata-dialog]")).toBeNull(); expect(container.textContent).not.toContain("独立收货人");
    const oldSignal = runtime.metadataGet.mock.calls.at(-1)![1].signal as AbortSignal;
    props.rows = [{ id: 11, orderNumber: "SO-11", customerId: 2 }]; props.customerId = 2; await render();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { wait.resolve({ ...metadataScope, receiver: { ...receiver(), receiver: "OLD-PRIVATE" }, afterSales: [] }); }); await flush();
    expect(container.textContent).not.toContain("OLD-PRIVATE");
    props.merchantId = 8; await render(); expect(container.textContent).not.toContain("独立收货人");
    expect(container.textContent).toContain("业务范围尚未核验");
  });

  it("first receiver save uses version0/secure id and reloads metadata only", async () => {
    await render(); await click("收货信息"); await input("收货人", "新收货人"); await input("收货地址", "新地址");
    await submit("保存收货信息");
    const sent = runtime.saveReceiver.mock.calls[0][0];
    expect(sent).toMatchObject({ id: 11, customerId: 1, receiver: "新收货人", receiverAddress: "新地址", version: 0 });
    expect(sent.requestId.length).toBeGreaterThanOrEqual(16);
    expect(runtime.metadataGet).toHaveBeenCalledTimes(2);
    expect(runtime.get).toHaveBeenCalledTimes(2); // initial proof + immediate pre-write proof, no order CRUD refresh
    expect(container.textContent).toContain("新收货人"); expect(container.querySelector("[data-metadata-dialog]")).toBeNull();
    expect(runtime.addAfterSale).not.toHaveBeenCalled(); expect(runtime.updateAfterSale).not.toHaveBeenCalled();
  });

  it("receiver version conflict refresh keeps mounted unsaved inputs and requires explicit retry", async () => {
    metadata.receiver = receiver(1); await render(); await click("收货信息"); await input("收货人", "未提交草稿");
    runtime.saveReceiver.mockRejectedValueOnce(Object.assign(new Error("version conflict"), { data: { code: "CONFLICT" } }));
    await submit("保存收货信息");
    expect(button("保存收货信息").disabled).toBe(true);
    expect(container.textContent).toContain("未提交输入已保留");
    const field = container.querySelector<HTMLInputElement>('[aria-label="收货人"]')!;
    metadata.receiver = { ...receiver(4), receiver: "其他员工保存" };
    const wait = deferred<BusinessSalesOrderMetadataDto>(); runtime.metadataGet.mockReturnValueOnce(wait.promise);
    await click("刷新版本（保留输入）");
    expect(container.querySelector('[aria-label="收货人"]')).toBe(field); expect(field.value).toBe("未提交草稿");
    await act(async () => { wait.resolve(metadata); }); await flush();
    expect(field.value).toBe("未提交草稿"); expect(button("保存收货信息").disabled).toBe(false);
    await submit("保存收货信息"); expect(runtime.saveReceiver.mock.calls[1][0]).toMatchObject({ receiver: "未提交草稿", version: 4 });
  });

  it("network failure preserves same request id and payload for unchanged retry", async () => {
    await render(); await click("收货信息"); await input("收货人", "重试草稿");
    runtime.saveReceiver.mockRejectedValueOnce(new Error("fixture timeout"));
    await submit("保存收货信息"); await submit("保存收货信息");
    expect(runtime.saveReceiver.mock.calls[0][0]).toEqual(runtime.saveReceiver.mock.calls[1][0]);
  });

  it("adds request records and updates closed record using exact case/version without financial calls", async () => {
    metadata.afterSales = [record(3)]; await render(); await click("售后记录");
    const options = Array.from(container.querySelectorAll("option")).map(item => item.textContent);
    expect(options).toContain("退货申请"); expect(options).toContain("退款申请"); expect(options).toContain("已结案");
    expect(options).not.toContain("已退款"); expect(options).not.toContain("已退库");
    await select("售后类型", "refund_request"); await input("售后原因", "新增申请备注"); await submit("登记售后记录");
    expect(runtime.addAfterSale.mock.calls[0][0]).toMatchObject({ id: 11, customerId: 1, kind: "refund_request", reason: "新增申请备注" });
    expect(container.textContent).toContain("2 条售后记录");
    await select("记录 21 状态", "processing"); await input("记录 21 跟进说明", "仅处理中跟进");
    const updateButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.closest('form[aria-label="售后记录 21"]') && item.textContent === "更新售后记录")!;
    await act(async () => { updateButton.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
    expect(runtime.updateAfterSale.mock.calls[0][0]).toMatchObject({ id: 11, customerId: 1, caseId: 21, version: 3, status: "processing", resolution: "仅处理中跟进" });
    expect(container.textContent).toContain("记录已更新，不代表退款或退库完成"); expect(runtime.saveReceiver).not.toHaveBeenCalled();
    expect(BUSINESS_AFTER_SALE_KINDS.every(kind => kind !== ("refund" as string))).toBe(true);
  });

  it("after-sale version refresh also preserves resolution and status draft", async () => {
    metadata.afterSales = [record(1)]; await render(); await click("售后记录");
    await input("记录 21 跟进说明", "保留售后草稿"); await select("记录 21 状态", "processing");
    runtime.updateAfterSale.mockRejectedValueOnce(Object.assign(new Error("conflict"), { data: { code: "CONFLICT" } }));
    await submit("更新售后记录");
    metadata.afterSales = [{ ...record(6), resolution: "远端说明" }];
    await click("刷新版本（保留输入）");
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="记录 21 跟进说明"]')?.value).toBe("保留售后草稿");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="记录 21 状态"]')?.value).toBe("processing");
    await submit("更新售后记录");
    expect(runtime.updateAfterSale.mock.calls[1][0]).toMatchObject({ version: 6, status: "processing", resolution: "保留售后草稿" });
  });

  it("write authorization loss/unmount aborts pending mutation and discards its result", async () => {
    await render(); await click("收货信息"); await input("收货人", "待提交");
    const wait = deferred<any>(); runtime.saveReceiver.mockReturnValueOnce(wait.promise);
    await submit("保存收货信息");
    const signal = runtime.saveReceiver.mock.calls[0][1].signal as AbortSignal;
    props.canWrite = false; await render();
    expect(signal.aborted).toBe(true); expect(container.querySelector("[data-metadata-dialog]")).toBeNull();
    const reads = runtime.metadataGet.mock.calls.length;
    await act(async () => { wait.resolve(receiver()); }); await flush();
    expect(runtime.metadataGet).toHaveBeenCalledTimes(reads);
    expect(container.textContent).not.toContain("待提交");
  });

  it("visible-row metadata loads have bounded concurrency3", async () => {
    props.customerId = undefined; props.rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 11, orderNumber: `SO-${i + 11}`, customerId: 1 }));
    const pending: ReturnType<typeof deferred<BusinessSalesOrderMetadataDto>>[] = [];
    runtime.metadataGet.mockImplementation(() => { const wait = deferred<BusinessSalesOrderMetadataDto>(); pending.push(wait); return wait.promise; });
    await render(); expect(runtime.metadataGet).toHaveBeenCalledTimes(3);
    await act(async () => { pending.slice(0, 3).forEach(wait => wait.resolve(metadata)); }); await flush();
    expect(runtime.metadataGet).toHaveBeenCalledTimes(6);
    await act(async () => { pending.slice(3, 6).forEach(wait => wait.resolve(metadata)); }); await flush();
    expect(runtime.metadataGet).toHaveBeenCalledTimes(7);
    await act(async () => { pending[6].resolve(metadata); }); await flush();
  });

  it("rejects malformed metadata rather than fabricating missing state", async () => {
    runtime.metadataGet.mockResolvedValueOnce({ receiver: null, afterSales: [{ id: 21, status: "refunded" }] });
    await render(); expect(container.textContent).toContain("售后记录读取失败"); expect(container.textContent).not.toContain("未录入售后");
  });

  it("rejects metadata DTO merchant/order/customer tuple mismatch even after a matching order proof", async () => {
    runtime.metadataGet.mockResolvedValueOnce({ ...metadata, merchantId: 8, receiver: receiver() });
    await render(); expect(container.textContent).toContain("收货信息读取失败");
    expect(container.textContent).not.toContain("独立收货人");
    runtime.metadataGet.mockResolvedValueOnce({ ...metadata, orderId: 12 });
    await expect(getMetadataForExport(order, {
      ready: true, merchantId: 7, customerId: 1, identityKey: "export-scope", isCurrent: () => true,
    }, new AbortController().signal)).rejects.toThrow("元数据订单范围不一致");
  });

  it("switching metadata dialogs cancels the previous pending write result", async () => {
    await render(); await click("收货信息"); await input("收货人", "旧弹窗草稿");
    const wait = deferred<any>(); runtime.saveReceiver.mockReturnValueOnce(wait.promise);
    await submit("保存收货信息");
    const signal = runtime.saveReceiver.mock.calls[0][1].signal as AbortSignal;
    await click("售后记录"); expect(signal.aborted).toBe(true);
    const previousReads = runtime.metadataGet.mock.calls.length;
    await act(async () => { wait.resolve(receiver()); }); await flush();
    expect(runtime.metadataGet).toHaveBeenCalledTimes(previousReads);
    expect(container.textContent).toContain("订单售后记录"); expect(container.textContent).not.toContain("旧弹窗草稿");
  });

  it("export reader verifies snapshot, propagates failure and cancels stale result", async () => {
    let current = true;
    const scope = { ready: true, merchantId: 7, customerId: 1, identityKey: "verified-export", isCurrent: () => current };
    const controller = new AbortController();
    expect(await getMetadataForExport(order, scope, controller.signal)).toEqual(metadata);
    runtime.metadataGet.mockRejectedValueOnce(new Error("export fixture failure"));
    await expect(getMetadataForExport(order, scope, controller.signal)).rejects.toThrow("export fixture failure");
    const wait = deferred<BusinessSalesOrderMetadataDto>(); runtime.metadataGet.mockReturnValueOnce(wait.promise);
    const work = getMetadataForExport(order, scope, controller.signal); await flush();
    current = false; wait.resolve({ ...metadataScope, receiver: receiver(), afterSales: [] });
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    const previous = runtime.get.mock.calls.length;
    await expect(getMetadataForExport(order, { ...scope, ready: false }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.get).toHaveBeenCalledTimes(previous);
  });

  it("batch export reader covers every real order and rejects the whole batch on a failed sibling", async () => {
    metadata = { ...metadataScope, receiver: receiver(), afterSales: [record()] };
    const scope = { ready: true, merchantId: 7, customerId: 1, identityKey: "batch-export", isCurrent: () => true };
    const reader = createBusinessSalesOrderMetadataExportReader(scope);
    const rows = [order, { ...order, id: 12, orderNumber: "SO-12" }];
    const output = await reader(rows as any, { signal: new AbortController().signal, isCurrent: () => true });
    expect(output.size).toBe(2); expect(output.get(11)?.receiver).toBe("独立收货人");
    expect(output.get(12)?.afterSales).toContain("退款申请 · 已结案");
    const pending = deferred<BusinessSalesOrderMetadataDto>();
    runtime.metadataGet.mockRejectedValueOnce(new Error("one export order failed")).mockReturnValueOnce(pending.promise);
    await expect(reader(rows as any, { signal: new AbortController().signal, isCurrent: () => true })).rejects.toThrow("one export order failed");
    const signal = runtime.metadataGet.mock.calls.at(-1)![1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    pending.resolve({ ...metadata, orderId: 12, orderNumber: "SO-12" }); await flush();
  });

  it("secure request ids use crypto and never weak random fallback", () => {
    expect(newBusinessSalesOrderMetadataRequestId()).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    vi.stubGlobal("crypto", {});
    expect(() => newBusinessSalesOrderMetadataRequestId()).toThrow("安全请求标识");
  });
});
