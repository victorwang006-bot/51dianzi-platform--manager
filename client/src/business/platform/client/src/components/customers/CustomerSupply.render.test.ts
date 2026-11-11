// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  context: null as unknown, current: true, navigate: vi.fn(), close: vi.fn(), complete: vi.fn(),
  readContext: vi.fn(), create: vi.fn(), createBatch: vi.fn(), listChannels: vi.fn(), getChannel: vi.fn(), onAuthorizationError: vi.fn(),
  native: { read: true, write: true, note: true, authorizationVersion: "v1" },
  authorityOptions: vi.fn(),
  invalidateContext: vi.fn(), invalidateSummary: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", runtime.navigate] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: "real-bound-test", contextVerification: { identity: "real-bound-test", authorizationVersion: "v1", readVersion: "v1" },
  officialInventoryPermissions: runtime.native, onAuthorizationError: runtime.onAuthorizationError,
}) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  enterprise: { me: { useQuery: (_: unknown, options: unknown) => { runtime.authorityOptions(options); return { data: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], member: { status: "active", permissionVersion: 1 } }, isError: false, refetch: vi.fn() }; } } },
  channelInventory: {
    customerSupplyContext: { useQuery: () => ({ data: runtime.context, isError: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true, refetch: runtime.readContext }) },
    customerSupplySummary: { useQuery: () => ({ data: { items: [{ customerId: 801, channelId: null, canViewStock: false, materialCount: 0 }] }, isError: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true, refetch: vi.fn() }) },
  },
  useUtils: () => ({ channelInventory: { customerSupplyContext: { invalidate: runtime.invalidateContext }, customerSupplySummary: { invalidate: runtime.invalidateSummary } }, client: { channelInventory: {
    customerSupplyContext: { query: runtime.readContext }, createCustomerUploadBatch: { mutate: runtime.createBatch }, createCustomerMaterial: { mutate: runtime.create },
    listChannels: { query: runtime.listChannels }, getChannel: { query: runtime.getChannel },
  } } }),
} }));
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { CustomerSupplyCell } from "./CustomerSupplyCell";
import { CustomerWorkbenchSupply } from "./CustomerWorkbenchSupply";
import { customerMaterialInput, customerSupplySessionSuffix, completedSupplyChannel, parseSupplyLocation, supplyReceipt, useCustomerSupplyAuthority,
  supplyLocation, type SupplyContext, type SupplyIdentity, type SupplySummary } from "./customerSupply";
import { runBatch, type BatchEntry } from "../channelInventory/queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity: SupplyIdentity = { enterpriseId: 31, actorUserId: 7, key: "account7:binding1:auth1:enterprise31" };
const payload = { channelId: 801, partNumber: "ONE", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY" as const, taxIncluded: null, leadTime: null, note: null };
const channel = { id: 411, enterpriseId: 31, name: "同名渠道", type: "agent", industryCode: "electronic_components", active: true, revision: 1, canEdit: true, readOnly: false };
function context(): SupplyContext {
  return { customer: { id: 801, name: "同名客户", industryCode: "electronic_components", version: 4, contactName: "联系人", phone: "13800138000", archivedAt: null }, channel: null, canUpload: true, disabledReason: null };
}
function receipt(customerId = 801, channelId = 411) { return { item: { id: 901, partNumber: "ONE", channelId, uploadBatchId: 501 }, idempotent: false, channelId, customerId }; }
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let generation = 0;
function required<T>(value: T | undefined | null): T { if (value == null) throw new Error("missing fixture control"); return value; }
function button(name: string) { return required(Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); }
function change(element: HTMLSelectElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => runtime.current,
    onClose: () => { runtime.close(); setOpen(false); }, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError }) : null;
}
function render(element: React.ReactElement = React.createElement(Harness, { key: String(++generation) })) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  act(() => root?.render(element));
}
async function setupUpload() {
  await settle();
  expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
  expect(document.body.textContent).not.toContain("继续选择物料表");
  expect(document.body.querySelector('[data-testid="channel-inventory-batch-dialog"]')).not.toBeNull();
  expect(container?.querySelector('[role="dialog"]')).toBeNull(); // real Radix portal, not a fake Dialog
}
async function upload(rows = [["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"], ["THREE", "TI"]]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "synthetic-customer.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const input = required(document.body.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  click(button("预览并校验"));
}
beforeEach(() => {
  runtime.current = true; runtime.context = context(); runtime.native = { read: true, write: true, note: true, authorizationVersion: "v1" };
  runtime.readContext.mockReset().mockImplementation(() => Promise.resolve(runtime.context));
  runtime.createBatch.mockReset().mockImplementation(dto => {
    runtime.context = { ...(runtime.context as SupplyContext), channel: { ...channel, type: dto.sourceProfile?.type ?? (runtime.context as SupplyContext).channel?.type ?? "factory" } };
    return Promise.resolve({ id: 501, batchCode: "BATCH-501", revision: 1, channelId: 411, customerId: 801 });
  });
  runtime.create.mockReset().mockImplementation(() => {
    runtime.context = { ...(runtime.context as SupplyContext), channel };
    return Promise.resolve(receipt());
  });
  runtime.listChannels.mockReset().mockResolvedValue({ items: [channel], canWrite: true, page: 1, total: 1 });
  runtime.getChannel.mockReset().mockResolvedValue(channel);
  runtime.navigate.mockReset(); runtime.close.mockReset(); runtime.complete.mockReset(); runtime.onAuthorizationError.mockReset();
  runtime.authorityOptions.mockReset();
  runtime.invalidateContext.mockReset(); runtime.invalidateSummary.mockReset();
  sessionStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("customer supply pure contracts", () => {
  it("drops local virtual channelId and all arbitrary owner/name/source fields from the wire", () => {
    const dto = customerMaterialInput({ ...payload, channelId: 999 }, "original-request", identity, 801, 4, { type: "agent" });
    expect(dto).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, expectedCustomerVersion: 4, sourceProfile: { type: "agent" },
      partNumber: "ONE", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY", taxIncluded: null, leadTime: null, note: null, requestId: "original-request" });
    expect(dto).not.toHaveProperty("channelId"); expect(dto).not.toHaveProperty("sourceId"); expect(dto).not.toHaveProperty("name");
  });
  it("isolates mode, enterprise, actor, customer, binding and authorization storage namespaces", () => {
    const suffix = customerSupplySessionSuffix(identity, 801);
    expect(suffix).toContain("customer-supply-v15:31:7:801:");
    for (const altered of [{ ...identity, enterpriseId: 32 }, { ...identity, actorUserId: 8 }, { ...identity, key: "auth-revoked-v2" }]) expect(customerSupplySessionSuffix(altered, 801)).not.toBe(suffix);
    expect(customerSupplySessionSuffix(identity, 802)).not.toBe(suffix);
    expect(suffix).not.toBe("d51-channel-inventory-batch-v1:7:31");
  });
  it("rejects absent/mismatched receipts and cannot navigate mixed real channel IDs", () => {
    expect(() => supplyReceipt(receipt(802), 801)).toThrow(); expect(() => supplyReceipt({ ...receipt(), channelId: 0 }, 801)).toThrow();
    const entries: BatchEntry[] = [{ row: 2, requestId: "a", payload, status: "success", receipt: receipt() }, { row: 3, requestId: "b", payload, status: "success", receipt: receipt(801, 412) }];
    expect(completedSupplyChannel(entries, 801)).toBeNull(); expect(completedSupplyChannel(entries.slice(0, 1), 801)).toBe(411);
  });
  it("parses numeric exact UI intents only, never customer/channel names", () => {
    expect(parseSupplyLocation("?supplyChannelId=411&supplyTab=materials")).toEqual({ channelId: 411, tab: "materials" });
    expect(parseSupplyLocation("?supplyChannelId=同名客户&supplyTab=channels")?.channelId).toBe(0);
    expect(parseSupplyLocation("?supplyChannelId=1e3&supplyTab=channels")?.channelId).toBe(0);
    expect(parseSupplyLocation("?name=同名客户")).toBeNull();
  });
  it("stops a stale queue without leaking the old receipt or sending a second row", async () => {
    let current = true; const submit = vi.fn(async () => { current = false; return receipt(); }); const onProgress = vi.fn();
    const entries: BatchEntry[] = [2, 3].map(row => ({ row, requestId: String(row), payload, status: "pending" }));
    const result = await runBatch(entries, { submit, onProgress, isCurrent: () => current, shouldStop: () => false, receiptFromResult: value => supplyReceipt(value, 801) });
    expect(submit).toHaveBeenCalledTimes(1); expect(onProgress).not.toHaveBeenCalled(); expect(result.reason).toBe("context-changed"); expect(result.entries[0].receipt).toBeUndefined();
  });
});

describe("customer supply row and independent permissions", () => {
  const summary: SupplySummary = { customerId: 801, channelId: 411, materialCount: 3, canUpload: true, canViewStock: true, disabledReason: null };
  it("renders lightweight upload and authorized linked stock buttons with legal count", () => {
    const onUpload = vi.fn(); const onViewStock = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: false, onUpload, onViewStock }));
    click(button("上传物料表")); click(button("查看库存（3）")); expect(onUpload).toHaveBeenCalledTimes(1); expect(onViewStock).toHaveBeenCalledWith(411);
  });
  it("fails closed on summary errors/archival and does not print an illegal count", () => {
    render(React.createElement(CustomerSupplyCell, { summary: { ...summary, materialCount: -1 }, canWrite: false, archived: true, loading: false, failed: false, onUpload: vi.fn(), onViewStock: vi.fn() }));
    expect(button("上传物料表").getAttribute("aria-disabled")).toBe("true"); expect(button("查看库存")).toBeTruthy();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: true, onUpload: vi.fn(), onViewStock: vi.fn() }));
    expect(button("上传物料表").getAttribute("aria-disabled")).toBe("true"); expect(document.body.textContent).not.toContain("查看库存");
  });
  it("does not treat inventory source-read permission as write permission or vice versa", () => {
    function Authority() { const authority = useCustomerSupplyAuthority({ enterpriseId: 31, actorUserId: 7, canManageAll: false }, true); return React.createElement("p", null, `${authority.canWrite}:${authority.canRead}`); }
    runtime.native.read = false; render(React.createElement(Authority)); expect(container?.textContent).toBe("true:false");
    runtime.native.read = true; runtime.native.write = false; render(React.createElement(Authority)); expect(container?.textContent).toBe("false:true");
  });
  it("shares once-per-identity authority caching without focus, reconnect, mount or interval refresh", () => {
    function Authority() { useCustomerSupplyAuthority({ enterpriseId: 31, actorUserId: 7, canManageAll: false }, true); return null; }
    render(React.createElement(Authority));
    expect(runtime.authorityOptions).toHaveBeenLastCalledWith({ enabled: true, retry: false, staleTime: Infinity,
      refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false });
  });
  it("keeps disabled upload keyboard-focusable, described and non-activating, with explicit retry", () => {
    const onUpload = vi.fn(); const onRetry = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: true, onUpload, onRetry, onViewStock: vi.fn() }));
    const action = button("上传物料表"); action.focus();
    expect(document.activeElement).toBe(action); expect(action.disabled).toBe(false);
    expect(document.getElementById(required(action.getAttribute("aria-describedby")))?.textContent).toContain("读取失败");
    click(action); expect(onUpload).not.toHaveBeenCalled(); click(button("重试供应库存")); expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("prompts for missing industry without guessed data and keeps profile completion reachable", () => {
    const completeProfile = vi.fn(); const onUpload = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: false, needsIndustry: true, onCompleteProfile: completeProfile, onUpload, onViewStock: vi.fn() }));
    click(button("上传物料表")); expect(onUpload).not.toHaveBeenCalled(); click(button("补全客户档案")); expect(completeProfile).toHaveBeenCalledTimes(1);
  });
});

describe("customer supply real portal and reused importer", () => {
  it("opens the existing file window directly with factory default, never creates/selects before upload", async () => {
    render(); await setupUpload();
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
    expect(button("选择库存表格").disabled).toBe(false); click(button("取消")); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("requires CRM industry completion without providing a guessed industry", async () => {
    runtime.context = { ...context(), customer: { ...context().customer, industryCode: null }, canUpload: false };
    render(); await settle(); expect(document.body.textContent).toContain("客户缺少合法所属行业");
    expect(document.querySelector('[data-testid="channel-inventory-batch-dialog"]')).toBeNull(); expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
    click(button("补全客户档案")); expect(runtime.navigate).toHaveBeenCalledWith("/customers/801"); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("never closes/navigates on first success and only closes the portal after all rows pass", async () => {
    let finish!: (value: unknown) => void;
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(2); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(3); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(sessionStorage.length).toBe(0);
    for (const [dto] of runtime.create.mock.calls) { expect(dto).not.toHaveProperty("channelId"); expect(dto).toMatchObject({ customerId: 801, expectedCustomerVersion: 4, sourceProfile: { type: "factory" } }); }
  });
  it("retains partial/unknown failures and receipts, restores original metadata and retries the exact request", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("response lost"));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("response lost");
    const original = runtime.create.mock.calls[1][0]; const savedKey = required(sessionStorage.key(0));
    expect(savedKey).toContain(customerSupplySessionSuffix(identity, 801));
    const saved = JSON.parse(required(sessionStorage.getItem(savedKey)));
    expect(saved.entries[0].receipt).toMatchObject({ customerId: 801, channelId: 411 }); expect(saved.entries[1].status).toBe("unknown");
    click(button("取消")); render(); await setupUpload(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(runtime.create.mock.calls[2][0]).toEqual(original); expect(runtime.create.mock.calls.map(([dto]) => dto.partNumber)).toEqual(["ONE", "TWO", "TWO", "THREE"]);
    expect(runtime.navigate).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
  });
  it("requires explicit partial finish and leaves the failed original batch recoverable", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("unknown"));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    click(button("查看已上传结果 / 完成")); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials"); expect(sessionStorage.length).toBe(1);
  });
  it("all-fail and cancel cannot client-precreate or navigate an empty channel", async () => {
    runtime.create.mockRejectedValue(new Error("FORBIDDEN")); render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled(); expect(runtime.listChannels).not.toHaveBeenCalled();
    expect(Array.from(document.querySelectorAll("button")).some(item => item.textContent?.includes("查看已上传结果"))).toBe(false); click(button("取消")); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("cannot guess-bind an existing same-name channel; it needs manual ID selection and confirmation", async () => {
    render(); await setupUpload();
    required(document.querySelector<HTMLDetailsElement>(".customer-supply-existing")).open = true;
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    click(boxes()[0]); await settle();
    const select = required(document.querySelector<HTMLSelectElement>('[aria-label="人工选择现有渠道"]')); expect(select.value).toBe(""); change(select, "411");
    expect(runtime.getChannel).not.toHaveBeenCalled(); click(button("确认关联此渠道")); await settle();
    expect(runtime.getChannel).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 411 }, { signal: expect.any(AbortSignal) });
    await upload([["型号", "品牌"], ["ONE", "TI"]]); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0].sourceProfile).toEqual({ type: "agent", existingChannelId: 411 }); expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId");
  });
  it.each(["archive", "version", "active", "permission"])("rechecks and stops before submitting when fresh %s context changes", async kind => {
    render(); await setupUpload(); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    const data = context();
    runtime.context = kind === "archive" ? { ...data, customer: { ...data.customer, archivedAt: "2026-11-04" } }
      : kind === "version" ? { ...data, customer: { ...data.customer, version: 5 } }
      : kind === "active" ? { ...data, channel: { ...channel, active: false } } : { ...data, canUpload: false };
    click(button("确认上传 1 条")); await settle(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("does not poll upload context on focus or after 30 seconds, but explicitly retries an initial error", async () => {
    runtime.readContext.mockRejectedValueOnce(new Error("synthetic read failure")); render(); await settle();
    expect(document.body.textContent).toContain("synthetic read failure"); click(button("重试核验")); await setupUpload();
    expect(runtime.readContext).toHaveBeenCalledTimes(2); vi.useFakeTimers();
    act(() => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(90_000); });
    expect(runtime.readContext).toHaveBeenCalledTimes(2);
  });
  it.each(["agent", "trade", "other"])("keeps already-linked %s channel type without sending a factory override", async type => {
    runtime.context = { ...context(), channel: { ...channel, type } }; render(); await setupUpload();
    await upload([["型号", "品牌"], ["ONE", "TI"]]); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("sourceProfile"); expect(runtime.listChannels).not.toHaveBeenCalled();
  });
  it("recovers a historical explicitly confirmed agent batch with original metadata and request ID", async () => {
    runtime.create.mockRejectedValueOnce(new Error("unknown result")); render(); await setupUpload();
    await upload([["型号", "品牌"], ["ONE", "TI"]]); click(button("确认上传 1 条")); await settle();
    const key = required(sessionStorage.key(0)); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    saved.sessionData.sourceProfile = { type: "agent" }; sessionStorage.setItem(key, JSON.stringify(saved));
    const original = runtime.create.mock.calls[0][0]; click(button("取消")); render(); await setupUpload();
    click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(runtime.create.mock.calls[1][0]).toEqual({ ...original, sourceProfile: { type: "agent" } });
  });
  it("keeps same-window partial retry enabled without recreating the importer or losing its queue", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("unknown"));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    expect(button("按原批次继续 / 重试").disabled).toBe(false); const original = runtime.create.mock.calls[1][0];
    click(button("按原批次继续 / 重试")); await settle(); expect(runtime.create.mock.calls[2][0]).toEqual(original);
    expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("reports a pre-submit authorization error to the root and does not mutate any material", async () => {
    render(); await setupUpload(); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    const error = Object.assign(new Error("synthetic permission revoked"), { code: "FORBIDDEN" });
    runtime.readContext.mockRejectedValueOnce(error); click(button("确认上传 1 条")); await settle();
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.onAuthorizationError).toHaveBeenCalledWith(error);
    expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("suppresses a late context response after cancellation and aborts its real signal", async () => {
    let finish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(); click(button("取消"));
    const signal = runtime.readContext.mock.calls[0][1].signal as AbortSignal; expect(signal.aborted).toBe(true);
    await act(async () => { finish(context()); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("does not leak a late material result after actor/authorization invalidation", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    runtime.current = false; act(() => root?.render(React.createElement(Harness))); await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("v22 stable customer upload portal and concise copy", () => {
  it("keeps the exact Dialog and overlay nodes from real permission loading to ready with no duplicate portals", async () => {
    let finish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render();
    const dialog = required(document.querySelector('[role="dialog"]'));
    const overlay = required(document.querySelector('[data-slot="dialog-overlay"]'));
    const title = required(document.querySelector('[data-slot="dialog-title"]'));
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const style = dialog.getAttribute("style");
    expect(dialog.textContent).toContain("正在核验上传权限");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(next => records.push(...next));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    try {
      await act(async () => { finish(context()); }); await setupUpload();
      records.push(...observer.takeRecords());
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(overlay);
      expect(document.querySelector('[data-slot="dialog-title"]')).toBe(title);
      expect(dialog.getAttribute("aria-labelledby")).toBe(labelledBy);
      expect(dialog.getAttribute("style")).toBe(style);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1);
      for (const record of records) {
        for (const removed of record.removedNodes) {
          expect(removed === dialog || removed === overlay || removed.contains(dialog) || removed.contains(overlay)).toBe(false);
        }
        for (const added of record.addedNodes) {
          if (added instanceof Element) expect(added.matches('[role="dialog"], [data-slot="dialog-overlay"]') || added.querySelector('[role="dialog"], [data-slot="dialog-overlay"]')).toBeFalsy();
        }
        if (record.type === "attributes") expect(record.target === dialog || record.target === overlay).toBe(false);
      }
    } finally { observer.disconnect(); }
    const fixture = process.env.UPLOAD_DOM_FIXTURE;
    if (fixture) {
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>${document.body.outerHTML}</html>\n`);
    }
    expect(title.textContent).toBe("上传客户物料");
    expect(dialog.textContent?.split("同名客户")).toHaveLength(2);
    for (const copy of ["客户档案：", "首次默认工厂", "客户身份固定", "Excel / CSV", "确认前不提交", "首张 sheet", "沿用幂等逐行上传"]) expect(dialog.textContent).not.toContain(copy);
    const note = required(dialog.querySelector(".ci-batch-note"));
    expect(note.querySelector("summary")?.textContent).toBe("填写说明");
    expect(note.textContent).toContain("5MB内，最多1000条");
    expect(dialog.querySelector(".ci-batch-drop")?.textContent).not.toContain("5MB");
    click(button("单条上传"));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector(".customer-supply-single .ci-dialog-note")).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("keeps the same Dialog through a temporary network failure and explicit successful retry", async () => {
    const error = new Error("临时网络失败");
    runtime.readContext.mockRejectedValueOnce(error); render();
    const dialog = required(document.querySelector('[role="dialog"]'));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(error.message);
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(runtime.onAuthorizationError).toHaveBeenCalledWith(error);
    click(button("重试核验")); await setupUpload();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(runtime.readContext).toHaveBeenCalledTimes(2);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("shows the real denied permission instead of mounting usable upload controls", async () => {
    runtime.context = { ...context(), canUpload: false, disabledReason: "无上传授权" }; render();
    const dialog = required(document.querySelector('[role="dialog"]')); await settle();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("无上传授权");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(document.querySelector('[aria-label="客户物料上传方式"]')).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
    click(button("取消")); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("routes the outer close button through the single preview confirmation rather than bypassing it", async () => {
    await openSingle(); previewSingle();
    const dialog = required(document.querySelector('[role="dialog"]'));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click(required(dialog.querySelector('[data-slot="dialog-close"]')));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(runtime.close).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    click(required(dialog.querySelector('[data-slot="dialog-close"]')));
    expect(runtime.close).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("outer Escape stops a running queue without closing the Portal or submitting the next row", async () => {
    let finish!: (value: unknown) => void;
    runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload();
    const dialog = required(document.querySelector('[role="dialog"]'));
    click(button("确认上传 3 条")); await settle();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(runtime.close).not.toHaveBeenCalled();
    runtime.context = { ...context(), channel };
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(button("按原批次继续 / 重试").disabled).toBe(false); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("isolates a changed actor even when the caller reuses the component without a key", async () => {
    let oldFinish!: (value: SupplyContext) => void; let newFinish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newFinish = resolve; }));
    const props = { customerId: 801, identity, isCurrent: () => runtime.current, onClose: runtime.close, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError };
    render(React.createElement(CustomerSupplyUploadDialog, props));
    const oldSignal = runtime.readContext.mock.calls[0][1].signal as AbortSignal;
    render(React.createElement(CustomerSupplyUploadDialog, { ...props, identity: { ...identity, actorUserId: 8, key: "actor8-auth2" } }));
    expect(oldSignal.aborted).toBe(true);
    expect(runtime.readContext.mock.calls[1][0]).toMatchObject({ expectedActorUserId: 8 });
    await act(async () => { oldFinish({ ...context(), customer: { ...context().customer, name: "旧身份客户" } }); }); await settle();
    expect(document.body.textContent).not.toContain("旧身份客户");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    await act(async () => { newFinish({ ...context(), customer: { ...context().customer, name: "新身份客户" } }); }); await setupUpload();
    expect(document.body.textContent).toContain("新身份客户"); expect(document.body.textContent).not.toContain("旧身份客户");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(runtime.create).not.toHaveBeenCalled();
  });
});

function singleField(label: string) {
  return required(document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`));
}
function enterSingle(label: string, value: string) {
  const element = singleField(label);
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function openSingle(values: Record<string, string> = {}) {
  render(); await setupUpload(); click(button("单条上传"));
  enterSingle("单条型号", "ONE"); enterSingle("单条品牌", "TI");
  for (const [field, value] of Object.entries(values)) enterSingle(field, value);
}
function previewSingle() { click(button("预览单条物料")); }

describe("customer single material upload uses the customer batch transaction", () => {
  it("has explicit accessible table/single switches and defaults to unchanged file upload", async () => {
    render(); await setupUpload();
    expect(document.querySelector('[role="group"][aria-label="客户物料上传方式"]')).not.toBeNull();
    expect(button("表格上传").getAttribute("aria-pressed")).toBe("true");
    expect(button("单条上传").getAttribute("aria-pressed")).toBe("false");
    click(button("单条上传"));
    expect(button("单条上传").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(singleField("单条型号"));
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("previews all supplied values without writing, then sends exact customer DTO and locates receipt ID", async () => {
    await openSingle({ "单条型号": "  ＯＮＥ  ", "单条品牌": " TI ", "单条可供数量": "4,000", "单条报价 CNY": "1.123456789012", "单条税务口径": "true", "单条交期": "7天", "单条 Date Code": "0026+", "单条备注（仅本人）": "个人说明" });
    const fixture = process.env.CUSTOMER_SUPPLY_DOM_FIXTURE;
    if (fixture) {
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>${document.body.outerHTML}</html>\n`);
    }
    previewSingle();
    expect(runtime.create).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    const preview = required(document.querySelector(".ci-batch-preview"));
    for (const value of ["ONE", "TI", "4000", "1.123456789012", "含税", "7天", "0026+", "个人说明"]) expect(preview.textContent).toContain(value);
    click(button("确认上传 1 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.create.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, expectedCustomerVersion: 4, sourceProfile: { type: "factory" },
      partNumber: "ONE", brand: "TI", qty: 4000, price: "1.123456789012", currency: "CNY", taxIncluded: true, leadTime: "7天", dateCode: "0026+", note: "个人说明", requestId: expect.stringMatching(/^[-0-9a-f]{36}$/i), uploadBatchId: 501 });
    expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
    expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(sessionStorage.length).toBe(0);
  });
  it.each(["unknown", "true", "false"])("preserves %s tax including nullable blank qty/price", async tax => {
    await openSingle({ "单条税务口径": tax }); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ qty: null, price: null, dateCode: null, leadTime: null, note: null, taxIncluded: tax === "unknown" ? null : tax === "true" });
  });
  it("preserves zero quantity and zero decimal quote instead of converting them to blanks", async () => {
    await openSingle({ "单条可供数量": "0", "单条报价 CNY": "0.000000000001" }); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ qty: 0, price: "0.000000000001" });
  });
  it.each([
    ["单条型号", " ", "型号不能为空"], ["单条品牌", " ", "品牌不能为空"],
    ["单条可供数量", "1.5", "数量格式无效"], ["单条可供数量", "2147483648", "数量不能超过2147483647"],
    ["单条报价 CNY", "1.1234567890123", "价格格式无效"],
  ])("rejects invalid %s=%s before preview or any write", async (field, value, error) => {
    await openSingle({ [field]: value }); previewSingle();
    expect(document.body.textContent).toContain(error);
    expect(document.querySelector(".ci-batch-preview")).toBeNull(); expect(runtime.create).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it("retains manual draft on unsubmitted mode switches and back from preview", async () => {
    await openSingle({ "单条交期": "保留草稿" }); click(button("表格上传")); click(button("单条上传"));
    expect(singleField("单条型号").value).toBe("ONE"); expect(singleField("单条交期").value).toBe("保留草稿");
    previewSingle(); click(button("上一步")); expect(singleField("单条交期").value).toBe("保留草稿");
    previewSingle(); vi.mocked(window.confirm).mockReturnValueOnce(false); click(button("表格上传"));
    expect(button("确认上传 1 条")).toBeTruthy(); expect(button("单条上传").getAttribute("aria-pressed")).toBe("true");
    click(button("表格上传")); expect(button("选择库存表格")).toBeTruthy();
    click(button("单条上传")); expect(singleField("单条交期").value).toBe("保留草稿"); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("cancels manual draft or preview without creating a channel or material", async () => {
    await openSingle(); click(button("取消")); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.create).not.toHaveBeenCalled();
    await openSingle(); previewSingle(); click(button("取消")); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it("locks switching, duplicate preview and duplicate submits while a request is running", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(button("表格上传").disabled).toBe(true); expect(button("单条上传").disabled).toBe(true); expect(button("预览单条物料").disabled).toBe(true);
    click(button("表格上传")); click(button("按原批次继续 / 重试")); expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.navigate).not.toHaveBeenCalled();
    await act(async () => { finish(receipt()); }); await settle(); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("retains a committed-but-lost result, prohibits switching and retries the whole original customer request", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.reject(new Error("committed response lost")); });
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    const original = runtime.create.mock.calls[0][0]; const key = required(sessionStorage.key(0)); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    expect(saved.entryMode).toBe("single"); expect(saved.entries).toHaveLength(1); expect(saved.entries[0].status).toBe("unknown");
    expect(button("表格上传").disabled).toBe(true); click(button("表格上传"));
    expect(button("按原批次继续 / 重试").disabled).toBe(false); expect(runtime.navigate).not.toHaveBeenCalled();
    click(button("按原批次继续 / 重试")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("restores a single unknown request in the same recovery namespace and keeps modes blocked before restoration", async () => {
    runtime.create.mockRejectedValueOnce(new Error("unknown"));
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle(); const original = runtime.create.mock.calls[0][0];
    click(button("取消")); render(); await setupUpload();
    expect(button("单条上传").disabled).toBe(true); expect(button("表格上传").disabled).toBe(true); expect(button("选择库存表格").disabled).toBe(true);
    click(button("恢复原批次")); expect(button("单条上传").getAttribute("aria-pressed")).toBe("true");
    click(button("按原批次继续 / 重试")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original); expect(sessionStorage.length).toBe(0);
  });
  it("keeps all-failed requests recoverable after explicit real source/batch creation without success navigation", async () => {
    runtime.create.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect((runtime.context as SupplyContext).channel?.id).toBe(411); expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("FORBIDDEN"); expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
  });
  it.each(["agent", "trade", "other"])("uses a real linked %s channel without overriding factory type", async type => {
    runtime.context = { ...context(), channel: { ...channel, type } }; await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("sourceProfile"); expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId");
  });
  it("uses an explicitly verified existing channel in the same single upload transaction", async () => {
    await openSingle(); required(document.querySelector<HTMLDetailsElement>(".customer-supply-existing")).open = true;
    click(required(document.querySelector('input[type="checkbox"]'))); await settle();
    change(required(document.querySelector<HTMLSelectElement>('[aria-label="人工选择现有渠道"]')), "411");
    expect(button("预览单条物料").disabled).toBe(true); click(button("确认关联此渠道")); await settle();
    previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ customerId: 801, sourceProfile: { type: "agent", existingChannelId: 411 } });
  });
  it.each(["archive", "version", "permission", "active"])("rechecks fresh %s customer state before the single write", async kind => {
    await openSingle(); previewSingle(); const data = context();
    runtime.context = kind === "archive" ? { ...data, customer: { ...data.customer, archivedAt: "2026-11-04" } }
      : kind === "version" ? { ...data, customer: { ...data.customer, version: 5 } }
      : kind === "permission" ? { ...data, canUpload: false } : { ...data, channel: { ...channel, active: false } };
    click(button("确认上传 1 条")); await settle(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not offer manual private notes without the independent note permission", async () => {
    runtime.native.note = false; await openSingle();
    expect(document.querySelector('[aria-label="单条备注（仅本人）"]')).toBeNull();
    previewSingle(); click(button("确认上传 1 条")); await settle(); expect(runtime.create.mock.calls[0][0].note).toBeNull();
  });
  it("refuses a mismatched single receipt and keeps its exact original request instead of navigating", async () => {
    runtime.create.mockResolvedValueOnce(receipt(802)); await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(button("表格上传").disabled).toBe(true);
    const original = runtime.create.mock.calls[0][0]; click(button("按原批次继续 / 重试")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original);
  });
  it("does not leak a single result or navigate after identity/authorization invalidation", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    const signal = runtime.create.mock.calls[0][1].signal as AbortSignal;
    runtime.current = false; act(() => root?.render(React.createElement(Harness)));
    act(() => root?.render(React.createElement("div"))); expect(signal.aborted).toBe(true);
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    const saved = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(saved.entries[0].receipt).toBeUndefined(); expect(saved.entries[0].status).toBe("pending");
  });
  it.each(["enterprise", "actor", "customer", "authorization"])("never restores another %s single session", async kind => {
    runtime.create.mockRejectedValueOnce(new Error("unknown")); await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle(); click(button("取消"));
    const alternate = kind === "enterprise" ? { ...identity, enterpriseId: 32 } : kind === "actor" ? { ...identity, actorUserId: 8 }
      : kind === "authorization" ? { ...identity, key: "new-authorization" } : identity;
    const customerId = kind === "customer" ? 802 : 801;
    runtime.context = { ...context(), customer: { ...context().customer, id: customerId } };
    render(React.createElement(CustomerSupplyUploadDialog, { key: String(++generation), customerId, identity: alternate, isCurrent: () => runtime.current,
      onClose: runtime.close, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError })); await settle();
    expect(document.body.textContent).not.toContain("恢复原批次"); expect(button("单条上传").disabled).toBe(false);
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(1);
  });
});


describe("IR-01 directly mounted customer upload real batch regression", () => {
  it("uses the explicitly bound channel (never customer ID), creates one batch, and passes it to every table row", async () => {
    runtime.context = { ...context(), channel };
    render(); await setupUpload();
    expect(required(document.querySelector<HTMLSelectElement>('[aria-label="批量关联渠道"]')).value).toBe("411");
    await upload(); click(button("确认上传 3 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1);
    expect(runtime.createBatch.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7,
      customerId: 801, expectedCustomerVersion: 4, expectedChannelId: 411, expectedChannelRevision: 1,
      fileName: "synthetic-customer.xlsx · synthetic", totalRows: 3, requestId: expect.any(String) });
    expect(runtime.create).toHaveBeenCalledTimes(3);
    for (const [dto] of runtime.create.mock.calls) { expect(dto.uploadBatchId).toBe(501); expect(dto).not.toHaveProperty("channelId"); }
    expect(runtime.createBatch.mock.invocationCallOrder[0]).toBeLessThan(runtime.create.mock.invocationCallOrder[0]);
  });
  it("unbound first upload persists no fake channel/placeholder material before confirmed source-and-batch creation", async () => {
    let finish!: (value: unknown) => void;
    runtime.createBatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload();
    expect(document.querySelector('[aria-label="批量关联渠道"] option[value="801"]')).toBeNull();
    await upload(); expect(runtime.createBatch).not.toHaveBeenCalled();
    click(button("确认上传 3 条")); await settle();
    const pending = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(pending).toMatchObject({ phase: "customer-source", preparation: { rows: expect.any(Array), requestId: expect.any(String) } });
    expect(pending).not.toHaveProperty("channelId"); expect(pending).not.toHaveProperty("entries");
    expect(runtime.create).not.toHaveBeenCalled();
    runtime.context = { ...context(), channel: { ...channel, type: "factory" } };
    await act(async () => { finish({ id: 501, batchCode: "BATCH-501", revision: 1, channelId: 411, customerId: 801 }); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(3);
    for (const [dto] of runtime.create.mock.calls) expect(dto).toMatchObject({ uploadBatchId: 501, sourceProfile: { type: "factory" } });
  });
  it("batch response loss refresh restores the exact requestId without opening a second batch", async () => {
    runtime.createBatch.mockImplementationOnce(dto => {
      runtime.context = { ...context(), channel: { ...channel, type: dto.sourceProfile.type } };
      return Promise.reject(new Error("batch committed response lost"));
    });
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    const original = runtime.createBatch.mock.calls[0][0];
    expect(runtime.create).not.toHaveBeenCalled(); expect(button("表格上传").disabled).toBe(true);
    const pending = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    click(button("取消")); render(); await setupUpload(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(runtime.createBatch.mock.calls[1][0]).toEqual(original);
    expect(runtime.create.mock.calls.map(([dto]) => dto.requestId)).toEqual(pending.preparation.rows.map((row: { requestId: string }) => row.requestId));
    for (const [dto] of runtime.create.mock.calls) expect(dto.uploadBatchId).toBe(501);
  });
  it("partial per-row refresh retries retain batch and row request ID without recreating a batch", async () => {
    runtime.create.mockResolvedValueOnce(receipt()).mockRejectedValueOnce(new Error("row response lost"));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    const original = runtime.create.mock.calls[1][0];
    const saved = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(saved.channelId).toBe(411); expect(saved.uploadBatch.id).toBe(501);
    for (const row of saved.entries) expect(row.uploadBatchId).toBe(501);
    click(button("取消")); render(); await setupUpload(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[2][0]).toEqual(original);
  });
  it("single upload uses the same new real batch and ID allowlist", async () => {
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1);
    expect(runtime.createBatch.mock.calls[0][0]).toMatchObject({ fileName: "单条手工录入", totalRows: 1 });
    expect(runtime.create.mock.calls[0][0].uploadBatchId).toBe(501);
  });
  it("bound channel revision changes stop before creating a new batch", async () => {
    runtime.context = { ...context(), channel }; render(); await setupUpload(); await upload();
    runtime.context = { ...context(), channel: { ...channel, revision: 2 } };
    click(button("确认上传 3 条")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("a bound batch-creation response loss cannot restore under a changed channel revision", async () => {
    runtime.context = { ...context(), channel }; runtime.createBatch.mockRejectedValueOnce(new Error("batch unknown"));
    render(); await setupUpload(); await upload(); click(button("确认上传 3 条")); await settle();
    click(button("取消")); runtime.context = { ...context(), channel: { ...channel, revision: 2 } };
    render(); await setupUpload(); expect(button("选择库存表格").disabled).toBe(true);
    expect(document.body.textContent).toContain("阻止另起批次"); expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("saved successful receipts must carry matching material channel and batch evidence", () => {
    const valid = { ...receipt(), uploadBatchId: 501 };
    const entry = { row: 2, requestId: "original", payload: { ...payload, channelId: 411 }, uploadBatchId: 501, status: "success" as const, receipt: valid };
    expect(completedSupplyChannel([entry], 801)).toBe(411);
    expect(completedSupplyChannel([{ ...entry, receipt: { ...valid, item: { ...valid.item, uploadBatchId: 502 } } }], 801)).toBeNull();
  });
  it("lost upload permission fails before any source/batch or row write", async () => {
    render(); await setupUpload(); await upload(); runtime.context = { ...context(), canUpload: false };
    click(button("确认上传 3 条")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.close).toHaveBeenCalled();
  });
  it.each(["channel", "batch"])("rejects a real material receipt with wrong %s attribution", async kind => {
    const bad = receipt();
    runtime.create.mockResolvedValueOnce({ ...bad, item: { ...bad.item, ...(kind === "channel" ? { channelId: 801 } : { uploadBatchId: 502 }) } });
    await openSingle(); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("回执");
    const original = runtime.create.mock.calls[0][0]; click(button("按原批次继续 / 重试")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[1][0]).toEqual(original);
  });
  it("does not backfill legacy virtual customer queues with invented batch attribution", async () => {
    const key = `d51-channel-inventory-batch-v1:7:31:${customerSupplySessionSuffix(identity, 801)}`;
    sessionStorage.setItem(key, JSON.stringify({ version: 1, enterpriseId: 31, actorUserId: 7, channelId: 801,
      name: "legacy.xlsx", sessionData: { customerId: 801, customerVersion: 4, sourceProfile: { type: "factory" } },
      entries: [{ row: 2, requestId: "00000000-0000-4000-8000-000000000001", payload, status: "unknown" }] }));
    render(); await setupUpload(); expect(button("选择库存表格").disabled).toBe(true);
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
});

describe("customer-detail supply entry uses the real existing upload portal", () => {
  it("opens one existing portal from verified supply context and sends the original customer batch DTO", async () => {
    const onOpenChange = vi.fn();
    render(React.createElement(CustomerWorkbenchSupply, { customerId: 801, customerVersion: 4,
      scope: { enterpriseId: 31, actorUserId: 7, canManageAll: false }, scopeReady: true, onOpenChange }));
    click(button("上传物料表")); await setupUpload();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true); click(button("单条上传"));
    enterSingle("单条型号", "ONE"); enterSingle("单条品牌", "TI"); previewSingle(); click(button("确认上传 1 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[0][0]).toMatchObject({
      customerId: 801, expectedCustomerVersion: 4, expectedEnterpriseId: 31, expectedActorUserId: 7, uploadBatchId: 501,
    });
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId");
    expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(runtime.invalidateContext).toHaveBeenCalled(); expect(runtime.invalidateSummary).toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it("preserves exact legacy channel/settings links and does not append an unrelated old source or customer URL", () => {
    expect(supplyLocation(411, "channels")).toBe("/channel-inventory?supplyChannelId=411&supplyTab=channels");
    expect(supplyLocation(411, "materials")).toBe("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(parseSupplyLocation(supplyLocation(411, "channels").split("?")[1])).toEqual({ channelId: 411, tab: "channels" });
    expect(() => supplyLocation(0, "materials")).toThrow();
  });
});
