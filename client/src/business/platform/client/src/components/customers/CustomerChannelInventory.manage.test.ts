// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => {
  const list = vi.fn(), batches = vi.fn(), detail = vi.fn(), update = vi.fn(), remove = vi.fn(), invalidate = vi.fn(), lookup = vi.fn();
  return { list, batches, detail, update, remove, invalidate, lookup, rows: [] as any[], total: 0, canWrite: true,
    scope: { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" },
      staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      contextVerification: { identity: "scope-7-31", state: "verified", authorizationVersion: "auth-1", readVersion: "read-1" },
      officialInventoryPermissions: { read: true, write: true, note: true, publish: true, authorizationVersion: "native-1" } },
    utils: { client: { channelInventory: { listUploadBatches: { query: batches }, listTeamMaterials: { query: list }, getTeamMaterialForEdit: { query: detail } } },
      channelInventory: { listTeamMaterials: { invalidate } } } };
});
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: () => ({ channelReference: { lookup: { query: runtime.lookup } } }),
  trpc: { useUtils: () => runtime.utils, channelInventory: {
    updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.update }) },
    deleteMaterials: { useMutation: () => ({ mutateAsync: runtime.remove }) } } },
}));
vi.mock("../channelInventory/FactoryMaterialPublish", () => ({ useFactoryMaterialPublish: () => ({ dialog: null, action: () => React.createElement(React.Fragment) }) }));
import { CustomerChannelInventory, type CustomerChannelInventoryProps } from "./CustomerChannelInventory";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-A" };
function stock(id = 101, extra: Record<string, any> = {}) {
  return { id, revision: 999, partNumber: `MODEL-${id}`, brand: "TI", qty: 10, dateCode: "2601", leadTime: "现货", price: "0", currency: "CNY", taxIncluded: false,
    canDelete: true, canEditMaterial: true, canEdit: true, canViewSource: true, readOnly: false, isMine: true,
    company: { id: 801, name: "客户" }, channelSource: { id: 11, name: "服务端渠道" }, noteCount: 0, canAddNote: true, canPublish: false,
    originalRecorderName: "真实负责人", ...extra };
}
function page(input: any) { return { customerId: input.customerId, customerVersion: 4, bindingCount: 2, items: runtime.rows,
  total: runtime.total || runtime.rows.length, page: input.page, pageSize: input.pageSize,
  pageCount: Math.ceil((runtime.total || runtime.rows.length) / input.pageSize), canWrite: runtime.canWrite }; }
function detail(id: number, extra = {}) { return { ...stock(id), channelId: 11, revision: id + 1000, ...extra }; }
function response(ids: number[], failed: Record<number, string> = {}) { return { deletedCount: ids.filter(id => !failed[id]).length,
  skippedCount: ids.filter(id => failed[id]).length, results: ids.map(id => failed[id] ? { id, success: false, reason: failed[id] } : { id, success: true }) }; }
function deferred() { let resolve!: (value: any) => void, reject!: (error: any) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: Root, host: HTMLDivElement, props: CustomerChannelInventoryProps;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(overrides: Partial<CustomerChannelInventoryProps> = {}) {
  props = { customerId: 801, customerVersion: 4, identity, enabled: true, onAuthorizationError: vi.fn(), ...overrides };
  await act(async () => root.render(React.createElement(CustomerChannelInventory, props))); await settle();
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing management test control"); return value; }
function named(text: string, scope: ParentNode = host) { return required([...scope.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text)); }
function review() { return required(host.querySelector('[role="alertdialog"]')); }
function selector(label: string) { return required(host.querySelector<HTMLInputElement | HTMLButtonElement>(`[aria-label="${label}"]`)); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await settle(); }
function handlers(element: Element) { return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!]; }
async function confirm() { await click(named("删除", review())); }
async function prepare(id = 101) { await click(selector(`删除库存：MODEL-${id}`)); }
beforeEach(() => {
  runtime.scope = { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
    contextVerification: { identity: "scope-7-31", state: "verified", authorizationVersion: "auth-1", readVersion: "read-1" },
    officialInventoryPermissions: { read: true, write: true, note: true, publish: true, authorizationVersion: "native-1" } };
  runtime.rows = [stock()]; runtime.total = 0; runtime.canWrite = true;
  runtime.list.mockReset().mockImplementation(input => Promise.resolve(page(input)));
  runtime.batches.mockReset().mockImplementation(input => Promise.resolve({ items: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 }));
  runtime.detail.mockReset().mockImplementation(({ id }) => Promise.resolve(detail(id)));
  runtime.remove.mockReset().mockImplementation(({ items }) => Promise.resolve(response(items.map((item: any) => item.id))));
  runtime.update.mockReset().mockResolvedValue({}); runtime.invalidate.mockReset().mockResolvedValue(undefined);
  runtime.lookup.mockReset().mockResolvedValue({ items: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network in mock management tests"); }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("customer inventory management: original page, identity and server grants", () => {
  it.each([false, undefined, null, "true", 1])("denies non-boolean canDelete=%s without detail or mutation even for owner/admin", async canDelete => {
    runtime.rows = [stock(101, { canDelete })]; runtime.scope.frontUser.role = "admin"; await render();
    expect((selector("删除库存：MODEL-101") as HTMLButtonElement).disabled).toBe(true);
    expect((selector("选择库存：MODEL-101") as HTMLInputElement).disabled).toBe(true);
    await click(selector("删除库存：MODEL-101")); expect(runtime.detail).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("删除所选");
  });
  it.each(["row-readonly", "row-edit-denied", "native-write", "native-read", "list-write", "unverified", "wrong-actor"])("intersects actual delete grant with %s", async failure => {
    if (failure === "row-readonly") runtime.rows[0].readOnly = true;
    if (failure === "row-edit-denied") runtime.rows[0].canEditMaterial = false;
    if (failure === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (failure === "native-read") runtime.scope.officialInventoryPermissions.read = false;
    if (failure === "list-write") runtime.canWrite = false;
    if (failure === "unverified") runtime.scope.contextVerification.state = "revalidating";
    if (failure === "wrong-actor") runtime.scope.frontUser.id = 8;
    await render(); expect((selector("删除库存：MODEL-101") as HTMLButtonElement).disabled).toBe(true);
    await click(selector("选择本页可删除库存")); expect(runtime.detail).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });
  it("single deletion reads genuine fresh revision despite a list revision, confirms once and sends exact schema", async () => {
    await render(); await prepare(); expect(runtime.remove).not.toHaveBeenCalled();
    expect(runtime.detail).toHaveBeenCalledWith({ id: 101, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(review().textContent).toContain("删除选中的 1 条物料？"); expect(review().querySelector("input, textarea")).toBeNull();
    await confirm(); expect(runtime.remove).toHaveBeenCalledTimes(1);
    expect(runtime.remove.mock.calls[0][0]).toEqual({ items: [{ id: 101, expectedRevision: 1101 }], requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i), expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.textContent).not.toContain("MODEL-101");
    expect(host.querySelector('.ci-customer-delete-status [role="alert"]')?.textContent).toBe("已删除"); expect(runtime.invalidate).toHaveBeenCalledWith({ customerId: 801, expectedEnterpriseId: 31, expectedActorUserId: 7 });
  });
  it("cancel is write-free; re-selection has no reason field or extra confirmation", async () => {
    await render(); await prepare(); await click(named("取消", review()));
    expect(runtime.remove).not.toHaveBeenCalled(); expect(host.textContent).toContain("MODEL-101");
    await prepare(); await confirm(); expect(runtime.remove).toHaveBeenCalledTimes(1);
  });
  it("select-all covers only current verified deletable page; one bulk confirmation preserves partial failures", async () => {
    runtime.rows = [stock(101), stock(102), stock(103, { canDelete: false })]; runtime.total = 40;
    runtime.remove.mockResolvedValueOnce(response([101, 102], { 102: "版本冲突，未删除" }));
    await render(); expect(host.textContent).not.toContain("删除所选"); await click(selector("选择本页可删除库存"));
    expect(host.textContent).toContain("删除所选（2）"); await click(named("删除所选（2）"));
    expect(runtime.detail.mock.calls.map(([input]) => input.id)).toEqual([101, 102]); expect(runtime.remove).not.toHaveBeenCalled();
    expect(review().textContent).toContain("删除选中的 2 条物料？"); await confirm();
    expect(runtime.remove.mock.calls[0][0].items).toEqual([{ id: 101, expectedRevision: 1101 }, { id: 102, expectedRevision: 1102 }]);
    expect(host.querySelector('[aria-label="删除库存：MODEL-101"]')).toBeNull(); expect(host.textContent).toContain("MODEL-102"); expect(host.textContent).toContain("MODEL-103");
    expect(host.textContent).toContain("已删除 1 条，1 条未删除"); expect(host.textContent).toContain("版本冲突，未删除"); expect(host.textContent).toContain("删除所选（1）");
  });
  it.each(["wrong-id", "revision-missing", "revision-zero", "grant-denied", "readonly", "wrong-channel", "wrong-company", "missing-source"])("fails closed for fresh %s proof without mutation", async failure => {
    const extra: Record<string, any> = {};
    if (failure === "wrong-id") extra.id = 999;
    if (failure === "revision-missing") extra.revision = undefined;
    if (failure === "revision-zero") extra.revision = 0;
    if (failure === "grant-denied") extra.canEditMaterial = false;
    if (failure === "readonly") extra.readOnly = true;
    if (failure === "wrong-channel") extra.channelId = 22;
    if (failure === "wrong-company") extra.company = { id: 802, name: "同名客户" };
    if (failure === "missing-source") runtime.rows[0].channelSource = null;
    runtime.detail.mockResolvedValueOnce(detail(101, extra)); await render(); await prepare();
    expect(runtime.remove).not.toHaveBeenCalled(); expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.textContent).toContain("MODEL-101");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it.each(["page", "customer", "identity", "authorization", "refresh"])("clears current-page selection on %s change and rejects stale actions", async change => {
    runtime.total = 40; await render(); await click(selector("选择库存：MODEL-101"));
    const staleDelete = handlers(named("删除所选（1）")).onClick;
    if (change === "page") { runtime.rows = [stock(102)]; await click(named("下一页")); }
    if (change === "customer") { runtime.rows = [stock(102, { company: { id: 802, name: "新客户" } })]; await render({ customerId: 802 }); }
    if (change === "identity") await render({ identity: { ...identity, key: "AUTH-B" } });
    if (change === "authorization") { runtime.scope.contextVerification.authorizationVersion = "auth-2"; await render(); }
    if (change === "refresh") await click(named("刷新库存"));
    expect(host.textContent).not.toContain("删除所选"); await act(async () => staleDelete());
    expect(runtime.detail).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
  });
});

describe("delete write outcomes and immutable unknown recovery", () => {
  it.each(["CONFLICT", "FORBIDDEN", "PRECONDITION_FAILED", "NOT_FOUND"])("definitive %s releases lock without removing the row and permits a new request", async code => {
    runtime.remove.mockRejectedValueOnce(Object.assign(new Error("服务器明确拒绝"), { data: { code } }));
    await render(); await prepare(); await confirm(); const first = runtime.remove.mock.calls[0][0];
    expect(host.textContent).toContain("MODEL-101"); expect(host.textContent).toContain("服务器明确拒绝"); expect((named("搜索") as HTMLButtonElement).disabled).toBe(false);
    await prepare(); await confirm(); expect(runtime.remove.mock.calls[1][0].requestId).not.toBe(first.requestId);
  });
  it("a mocked server orderblocked/skip reason stays visible without asserting an actual backend order relationship", async () => {
    runtime.remove.mockResolvedValueOnce(response([101], { 101: "orderblocked：服务器拒绝此测试库存" }));
    await render(); await prepare(); await confirm();
    expect(host.textContent).toContain("MODEL-101"); expect(host.textContent).toContain("已删除 0 条，1 条未删除"); expect(host.textContent).toContain("orderblocked");
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("按原请求重试");
  });
  it.each(["wrong-id", "missing-result", "duplicate-id", "wrong-count", "nonboolean"])("treats malformed 2xx %s receipt as unknown rather than removing any row", async failure => {
    runtime.rows = [stock(101), stock(102)]; const receipt: any = response([101, 102]);
    if (failure === "wrong-id") receipt.results[0].id = 999;
    if (failure === "missing-result") receipt.results.pop();
    if (failure === "duplicate-id") receipt.results[1].id = 101;
    if (failure === "wrong-count") receipt.deletedCount = 0;
    if (failure === "nonboolean") receipt.results[0].success = "true";
    runtime.remove.mockResolvedValueOnce(receipt); await render(); await click(selector("选择本页可删除库存")); await click(named("删除所选（2）")); await confirm();
    expect(host.textContent).toContain("MODEL-101"); expect(host.textContent).toContain("MODEL-102"); expect(host.textContent).toContain("删除结果未确认"); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it.each(["focus", "refreshVersion", "stale-controls"])("pending and unknown %s freeze immutable UUID/items, including old cancel/edit callbacks", async trigger => {
    runtime.total = 40; const pending = deferred(); runtime.remove.mockReturnValueOnce(pending.promise);
    await render({ refreshVersion: 1 }); const oldEdit = handlers(selector("编辑库存：MODEL-101")).onClick;
    const oldPage = handlers(named("下一页")).onClick, oldRefresh = handlers(named("刷新库存")).onClick, oldSearch = handlers(required(host.querySelector("form"))).onSubmit;
    await prepare(); const oldCancel = handlers(named("取消", review())).onClick;
    const save = named("删除", review()); await act(async () => { save.click(); save.click(); }); await settle();
    expect(runtime.remove).toHaveBeenCalledTimes(1); const payload = runtime.remove.mock.calls[0][0];
    await act(async () => { oldCancel(); oldEdit(); oldPage(); oldRefresh(); oldSearch({ preventDefault: vi.fn() }); });
    await act(async () => pending.reject(new Error("response lost"))); await settle();
    if (trigger === "focus") await act(async () => window.dispatchEvent(new Event("focus")));
    if (trigger === "refreshVersion") await render({ ...props, refreshVersion: 2 });
    if (trigger === "stale-controls") await act(async () => { oldCancel(); oldPage(); oldRefresh(); oldSearch({ preventDefault: vi.fn() }); oldEdit(); });
    expect(runtime.list).toHaveBeenCalledTimes(1); expect(runtime.detail).toHaveBeenCalledTimes(1);
    expect((named("搜索") as HTMLButtonElement).disabled).toBe(true); expect((named("下一页") as HTMLButtonElement).disabled).toBe(true);
    expect((selector("筛选客户库存型号") as HTMLInputElement).disabled).toBe(true); expect((named("取消", review()) as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain("删除结果未确认"); await click(named("按原请求重试", review()));
    expect(runtime.remove.mock.calls[1][0]).toBe(payload); expect(payload.items).toEqual([{ id: 101, expectedRevision: 1101 }]);
    expect(host.textContent).not.toContain("按原请求重试");
  });
  it.each(["pending", "unknown"])("late old-identity %s write/retry cannot remove current rows or invalidate current cache", async state => {
    const pending = deferred(); runtime.remove.mockReturnValueOnce(pending.promise); await render(); await prepare(); const oldSubmit = handlers(named("删除", review())).onClick; await confirm();
    if (state === "unknown") { await act(async () => pending.reject(new Error("unknown"))); await settle(); }
    runtime.rows = [stock(102, { company: { id: 802, name: "新客户" } })]; await render({ customerId: 802, identity: { ...identity, key: "AUTH-B" } });
    await act(async () => { oldSubmit(); if (state === "pending") pending.resolve(response([101])); }); await settle();
    expect(host.textContent).toContain("MODEL-102"); expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(runtime.remove).toHaveBeenCalledTimes(1); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it("aborts stale detail proof when customer changes and cannot revive old confirmation", async () => {
    const pending = deferred(); runtime.detail.mockReturnValueOnce(pending.promise); await render(); await prepare();
    const signal = runtime.detail.mock.calls[0][1].signal as AbortSignal;
    runtime.rows = [stock(102, { company: { id: 802, name: "新客户" } })]; await render({ customerId: 802 }); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(detail(101))); expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(runtime.remove).not.toHaveBeenCalled();
  });
  it.each(["reject", "throw"])("a confirmed deletion is never retried for %s cache failure", async failure => {
    if (failure === "reject") runtime.invalidate.mockRejectedValue(new Error("cache failed")); else runtime.invalidate.mockImplementation(() => { throw new Error("cache failed"); });
    await render(); await prepare(); await confirm(); expect(host.textContent).not.toContain("MODEL-101"); expect(host.textContent).not.toContain("按原请求重试"); expect(runtime.remove).toHaveBeenCalledTimes(1);
  });
  it("deleting the only obsolete last-page row falls back to the valid prior page", async () => {
    runtime.total = 21; runtime.list.mockImplementation(input => Promise.resolve({ ...page(input), items: input.page === 1 ? [stock(102)] : [stock(101)] }));
    await render(); await click(named("下一页")); await prepare(); runtime.total = 20; await confirm();
    expect(runtime.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, page: 1, pageSize: 20 }); expect(host.textContent).toContain("MODEL-102");
  });

  it.each(["pending", "unknown"])("external selectedBatchId change during %s stays on applied batch and is applied exactly after the original write unlocks", async state => {
    runtime.batches.mockImplementation(input => Promise.resolve({ items: [501, 502].map(id => ({ id, fileName: `B-${id}.xlsx`, createdAt: "2026-11-19T08:00:00Z" })), total: 2, page: input.page, pageSize: 100, pageCount: 1 }));
    runtime.rows = [stock(101, { uploadBatchId: 501 })]; const pending = deferred(); runtime.remove.mockReturnValueOnce(pending.promise);
    await render({ selectedBatchId: 501 }); expect(runtime.list).toHaveBeenCalledTimes(1); await prepare(); await confirm();
    const original = runtime.remove.mock.calls[0][0];
    if (state === "unknown") { await act(async () => pending.reject(new Error("lost batch receipt"))); await settle(); }
    await render({ ...props, selectedBatchId: 502 });
    const filter = required(host.querySelector<HTMLSelectElement>('[aria-label="按上传批次查看"]'));
    expect(filter.value).toBe("501"); expect(filter.disabled).toBe(true); expect(runtime.list).toHaveBeenCalledTimes(1);
    runtime.rows = [stock(102, { uploadBatchId: 502 })];
    if (state === "pending") { await act(async () => pending.resolve(response([101]))); await settle(); }
    else { await click(named("按原请求重试", review())); expect(runtime.remove.mock.calls[1][0]).toBe(original); }
    expect(runtime.list).toHaveBeenCalledTimes(2); expect(runtime.list.mock.calls[1][0]).toMatchObject({ customerId: 801, uploadBatchId: 502, page: 1 });
    expect(filter.value).toBe("502"); expect(host.textContent).toContain("MODEL-102"); expect(host.textContent).not.toContain("MODEL-101");
  });
});
