// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  context: null as unknown, current: true, navigate: vi.fn(), close: vi.fn(), complete: vi.fn(),
  readContext: vi.fn(), create: vi.fn(), listChannels: vi.fn(), getChannel: vi.fn(), onAuthorizationError: vi.fn(),
  native: { read: true, write: true, note: true, authorizationVersion: "v1" },
  authorityOptions: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", runtime.navigate] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: "real-bound-test", contextVerification: { identity: "real-bound-test", authorizationVersion: "v1", readVersion: "v1" },
  officialInventoryPermissions: runtime.native, onAuthorizationError: runtime.onAuthorizationError,
}) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  enterprise: { me: { useQuery: (_: unknown, options: unknown) => { runtime.authorityOptions(options); return { data: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], member: { status: "active", permissionVersion: 1 } }, isError: false, refetch: vi.fn() }; } } },
  useUtils: () => ({ client: { channelInventory: {
    customerSupplyContext: { query: runtime.readContext }, createCustomerMaterial: { mutate: runtime.create },
    listChannels: { query: runtime.listChannels }, getChannel: { query: runtime.getChannel },
  } } }),
} }));
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { CustomerSupplyCell } from "./CustomerSupplyCell";
import { customerMaterialInput, customerSupplySessionSuffix, completedSupplyChannel, parseSupplyLocation, supplyReceipt, useCustomerSupplyAuthority,
  type SupplyContext, type SupplyIdentity, type SupplySummary } from "./customerSupply";
import { runBatch, type BatchEntry } from "../channelInventory/queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity: SupplyIdentity = { enterpriseId: 31, actorUserId: 7, key: "account7:binding1:auth1:enterprise31" };
const payload = { channelId: 801, partNumber: "ONE", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY" as const, taxIncluded: null, leadTime: null, note: null };
const channel = { id: 411, enterpriseId: 31, name: "同名渠道", type: "agent", industryCode: "electronic_components", active: true, revision: 1, canEdit: true, readOnly: false };
function context(): SupplyContext {
  return { customer: { id: 801, name: "同名客户", industryCode: "electronic_components", version: 4, contactName: "联系人", phone: "13800138000", archivedAt: null }, channel: null, canUpload: true, disabledReason: null };
}
function receipt(customerId = 801, channelId = 411) { return { item: { id: 901, partNumber: "ONE" }, idempotent: false, channelId, customerId }; }
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
  runtime.create.mockReset().mockImplementation(() => {
    runtime.context = { ...(runtime.context as SupplyContext), channel };
    return Promise.resolve(receipt());
  });
  runtime.listChannels.mockReset().mockResolvedValue({ items: [channel], canWrite: true, page: 1, total: 1 });
  runtime.getChannel.mockReset().mockResolvedValue(channel);
  runtime.navigate.mockReset(); runtime.close.mockReset(); runtime.complete.mockReset(); runtime.onAuthorizationError.mockReset();
  runtime.authorityOptions.mockReset();
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
    expect(runtime.create).toHaveBeenCalledTimes(3); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=channels");
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
    click(button("查看已上传结果 / 完成")); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=channels"); expect(sessionStorage.length).toBe(1);
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
