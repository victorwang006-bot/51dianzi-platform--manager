// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { History, HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => {
  const list = vi.fn(), get = vi.fn(), preview = vi.fn(), remove = vi.fn(), download = vi.fn(), forbidden = vi.fn();
  const routes = { customerUploadHistoryList: { query: list }, customerUploadHistoryGet: { query: get }, previewDeleteUploadBatch: { query: preview },
    deleteUploadBatch: { mutate: remove }, customerUploadDownload: { mutate: download } };
  return { list, get, preview, remove, download, forbidden, current: true, close: vi.fn(), complete: vi.fn(), auth: vi.fn(), view: vi.fn(),
    utils: { client: { channelInventory: new Proxy(routes, { get(target, key) {
      if (Object.hasOwn(target, key)) return target[key as keyof typeof target];
      forbidden(key); throw new Error(`UNEXPECTED_OFFLINE_RPC:${String(key)}`);
    } }) } } };
});
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => rt.utils } }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "31:7:history", officialInventoryPermissions: { read: true, write: true, note: true } }) }));
import { CustomerUploadHistoryDialog } from "./CustomerUploadHistoryDialog";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const identity = { enterpriseId: 31, actorUserId: 7, key: "verified-actions" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function history(n = 1, changes: Partial<History> = {}): History { return { historyId: uuid(n), customerId: 801, customerName: "当前客户", mode: "standard", state: "partially_imported", revision: 4,
  uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "本人" }, createdAt: `2026-11-${n === 1 ? "19" : "18"}T08:00:00Z`,
  originalFile: { fileId: uuid(1000 + n), kind: "original", fileName: `批次-${n}.csv`, mimeType: "text/csv", byteSize: 3, sha256: "a".repeat(64), createdAt: "2026-11-19T08:00:00Z" },
  latestVersionId: null, latestVersionNo: 0, access: "self", batchClosed: false,
  uploadBatch: { id: n === 1 ? 501 : 502, customerId: 801, channelId: 11, batchCode: `B-${n}`, revision: 2 },
  stats: { sourceRowCount: 10, resultRowCount: 10, pendingCount: 1, excludedCount: 2, successCount: 4, unknownCount: 1, failedCount: 2, repairableCount: 2, remainingMaterialCount: 4 },
  capabilities: { canDownload: true, canManage: true, canUploadResult: true, canConfirm: true, canCancel: true }, ...changes }; }
function detail(h = history(), batchId = 501): HistoryDetail { return { history: h, versions: [], selectedVersion: null, originalSheets: [{ sheetIndex: 0, sheetName: "原表", rows: [{ rowNumber: 8, cells: ["ONE", "TI"], originalRowHash: "b".repeat(64), originalContent: "ONE,TI" }] }],
  confirmation: { confirmationId: uuid(2001), batchRequestId: uuid(2002), versionId: null, createdAt: h.createdAt,
    batch: { id: batchId, customerId: h.customerId, channelId: 11, batchCode: `B-${batchId}`, revision: 2 }, entries: [], excludedRows: [] } }; }
function deferred() { let resolve!: (value: any) => void, reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: Root, host: HTMLDivElement;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function render(customerId = 801, scope = identity) { await act(async () => root.render(React.createElement(CustomerUploadHistoryDialog, {
  customerId, identity: scope, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onViewBatch: rt.view, onAuthorizationError: rt.auth,
}))); await settle(); }
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error(`Missing history action control: ${document.body.textContent}`); return value; }
function row(n = 1) { return required(document.querySelector(`[aria-label="选择文件${uuid(n)}"]`)?.closest("tr")); }
function button(text: string, scope: ParentNode = document.body) { return required([...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text)); }
function review() { return required(document.querySelector('[role="alertdialog"]')); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await settle(); }
function handlers(element: Element) { return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!]; }
async function prepare() { await click(button("删除整批", row())); }
async function confirm() { await click(button("删除", review())); }
async function escape() { await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); await settle(); }
beforeEach(() => {
  for (const value of Object.values(rt)) if (typeof value === "function" && "mockReset" in value) value.mockReset();
  rt.current = true; rt.list.mockResolvedValue({ items: [history(), history(2)], nextCursor: null });
  rt.get.mockImplementation(({ historyId }) => Promise.resolve(detail(history(historyId === uuid(1) ? 1 : 2), historyId === uuid(1) ? 501 : 502)));
  rt.preview.mockResolvedValue({ total: 4, eligibleCount: 3, conflictCount: 1, revision: 19 });
  rt.remove.mockResolvedValue({ deletedCount: 3, skippedCount: 1 });
  rt.download.mockImplementation(() => { throw new Error("Unexpected download in batch write tests"); });
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => { throw new Error("REAL_XHR_FORBIDDEN"); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled(); expect(rt.forbidden).not.toHaveBeenCalled();
  expect(rt.download).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("history batch actions: actual portal and exact original request", () => {
  it("shows true success/repairable counts, not explicit user exclusions or unknown as confirmed failures", async () => {
    await render(); expect(row().querySelector('.history-size')?.textContent).toBe("4 / 2待确认 1");
    expect([...row().querySelectorAll("button")].map(item => item.textContent)).toEqual(["批次-1.csv", "查看物料", "处理失败", "删除整批"]);
    expect(rt.remove).not.toHaveBeenCalled(); expect(rt.preview).not.toHaveBeenCalled();
  });
  it("reads fresh detail then previews only its confirmed batch, sends preview revision (not stale history/batch revisions) with a UUID", async () => {
    await render(); await prepare(); expect(rt.remove).not.toHaveBeenCalled();
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: uuid(1) }); expect(rt.preview.mock.calls[0][0]).toEqual({ ...expected, id: 501 });
    expect(review().textContent).toContain("将删除 3 条物料，关闭 4 条待处理记录"); expect(review().textContent).toContain("1 条已变更，不会删除");
    expect(review().querySelector("input, textarea")).toBeNull(); await confirm();
    expect(rt.remove.mock.calls[0][0]).toEqual({ ...expected, id: 501, expectedRevision: 19, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
    expect(rt.complete).toHaveBeenCalledTimes(1); expect(rt.remove).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("已删除 3 条，1 条已变更，未删除");
  });
  it("cancels an unsubmitted review without any write and preserves both batch rows", async () => {
    await render(); await prepare(); await click(button("取消", review()));
    expect(rt.remove).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(row(1)).toBeTruthy(); expect(row(2)).toBeTruthy();
  });
  it("view materials forwards the real confirmed batch ID to onViewBatch and never mutates/reconciles", async () => {
    await render(); await click(button("查看物料", row(2)));
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: uuid(2) }); expect(rt.view).toHaveBeenCalledTimes(1); expect(rt.view).toHaveBeenCalledWith(502);
    expect(rt.preview).not.toHaveBeenCalled(); expect(rt.remove).not.toHaveBeenCalled(); expect(rt.complete).not.toHaveBeenCalled();
  });
  it("pending duplicate submit and unknown retry cannot close, change batches, regenerate request ID or affect another batch", async () => {
    const pending = deferred(); rt.remove.mockReturnValueOnce(pending.promise); await render(); await prepare();
    const viewOther = handlers(button("查看物料", row(2))).onClick;
    const removeOther = handlers(button("删除整批", row(2))).onClick;
    const submit = button("删除", review()); await act(async () => { submit.click(); submit.click(); }); await settle();
    expect(rt.remove).toHaveBeenCalledTimes(1); const payload = structuredClone(rt.remove.mock.calls[0][0]);
    await click(button("Close")); await escape(); await act(async () => { viewOther(); removeOther(); });
    expect(rt.close).not.toHaveBeenCalled(); expect(rt.preview).toHaveBeenCalledTimes(1); expect(rt.view).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("response lost"))); await settle();
    expect(document.body.textContent).toContain("删除结果待确认"); expect(button("取消", review()).disabled).toBe(true);
    await click(button("Close")); await escape(); await act(async () => { viewOther(); removeOther(); });
    expect(rt.close).not.toHaveBeenCalled(); expect(rt.get).toHaveBeenCalledTimes(1); expect(rt.view).not.toHaveBeenCalled(); expect(rt.complete).not.toHaveBeenCalled();
    await click(button("按原请求重试", review())); expect(rt.remove.mock.calls[1][0]).toEqual(payload);
    expect(rt.remove.mock.calls.every(([input]) => input.id === 501)).toBe(true); expect(rt.complete).toHaveBeenCalledTimes(1); expect(row(2)).toBeTruthy();
  });
  it("a cancel callback captured before submission cannot unlock an unknown batch request", async () => {
    rt.remove.mockRejectedValueOnce(new Error("lost receipt")); await render(); await prepare();
    const staleCancel = handlers(button("取消", review())).onClick; await confirm();
    await act(async () => staleCancel()); await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); expect(button("取消", review()).disabled).toBe(true);
    await click(button("Close")); expect(rt.close).not.toHaveBeenCalled();
  });
  it("successful whole-batch deletion refreshes only history, retains other batch and never invents optimistic deletion of it", async () => {
    rt.preview.mockResolvedValue({ total: 4, eligibleCount: 4, conflictCount: 0, revision: 19 }); rt.remove.mockResolvedValue({ deletedCount: 4, skippedCount: 0 });
    await render(); await prepare(); rt.list.mockResolvedValue({ items: [history(2)], nextCursor: null }); await confirm();
    expect(rt.remove).toHaveBeenCalledTimes(1); expect(rt.remove.mock.calls[0][0].id).toBe(501); expect(rt.list).toHaveBeenCalledTimes(2);
    expect(document.querySelector(`[aria-label="选择文件${uuid(1)}"]`)).toBeNull(); expect(row(2).textContent).toContain("批次-2.csv"); expect(rt.view).not.toHaveBeenCalled();
  });
  it.each(["CONFLICT", "FORBIDDEN", "PRECONDITION_FAILED", "NOT_FOUND"])("definitive %s keeps all rows and releases review without automatic retry", async code => {
    rt.remove.mockRejectedValueOnce(Object.assign(new Error("明确拒绝"), { data: { code } }));
    await render(); await prepare(); await confirm(); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(rt.complete).not.toHaveBeenCalled();
    expect(row(1)).toBeTruthy(); expect(row(2)).toBeTruthy(); expect(rt.remove).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("明确拒绝");
  });
  it.each(["negative", "fractional", "inconsistent", "missing-revision"])("invalid %s delete preview cannot produce a confirmation or write", async kind => {
    const value: any = { total: 4, eligibleCount: 3, conflictCount: 1, revision: 19 };
    if (kind === "negative") value.eligibleCount = -1; if (kind === "fractional") value.total = 4.5;
    if (kind === "inconsistent") value.total = 5; if (kind === "missing-revision") delete value.revision;
    rt.preview.mockResolvedValue(value); await render(); await prepare();
    expect(rt.remove).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.body.textContent).toContain("删除范围未能确认");
  });
  it.each(["negative", "fractional", "incomplete"])("malformed %s 2xx delete receipt remains unknown with the same CAS/UUID", async kind => {
    const value = kind === "negative" ? { deletedCount: -1, skippedCount: 5 } : kind === "fractional" ? { deletedCount: 2.5, skippedCount: 1.5 } : { deletedCount: 3, skippedCount: 0 };
    rt.remove.mockResolvedValueOnce(value); await render(); await prepare(); await confirm(); const payload = structuredClone(rt.remove.mock.calls[0][0]);
    expect(document.body.textContent).toContain("删除结果待确认"); expect(rt.complete).not.toHaveBeenCalled(); expect(row(1)).toBeTruthy(); expect(row(2)).toBeTruthy();
    await click(button("按原请求重试", review())); expect(rt.remove.mock.calls[1][0]).toEqual(payload);
  });
  it.each(["delete", "view"])("foreign-customer confirmation blocks %s before batch endpoint or callback", async action => {
    const d = detail(); d.confirmation!.batch.customerId = 802; rt.get.mockResolvedValue(d);
    await render(); await click(button(action === "delete" ? "删除整批" : "查看物料", row()));
    expect(rt.preview).not.toHaveBeenCalled(); expect(rt.remove).not.toHaveBeenCalled(); expect(rt.view).not.toHaveBeenCalled(); expect(rt.auth).toHaveBeenCalledTimes(1);
  });
  it("a fresh detail denial of canConfirm cannot borrow the list's old grant for whole-batch deletion", async () => {
    const h = history(); h.capabilities.canConfirm = false; rt.get.mockResolvedValue(detail(h));
    await render(); await prepare(); expect(rt.preview).not.toHaveBeenCalled(); expect(rt.remove).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("management/ownership hints do not expose delete or continue when canConfirm is false", async () => {
    const h = history(); h.capabilities.canConfirm = false; rt.list.mockResolvedValue({ items: [h], nextCursor: null });
    await render(); expect([...row().querySelectorAll("button")].map(item => item.textContent)).toEqual(["批次-1.csv", "查看物料"]);
    expect(rt.get).not.toHaveBeenCalled(); expect(rt.preview).not.toHaveBeenCalled(); expect(rt.remove).not.toHaveBeenCalled();
  });
  it.each(["preview", "pending", "unknown"])("cross-customer remount suppresses old %s deletion callbacks and receipts", async phase => {
    const pending = deferred(); if (phase === "preview") rt.preview.mockReturnValueOnce(pending.promise); else rt.remove.mockReturnValueOnce(pending.promise);
    await render(); await prepare(); let staleSubmit: (() => void) | undefined;
    if (phase !== "preview") { staleSubmit = handlers(button("删除", review())).onClick; await confirm(); }
    if (phase === "unknown") { await act(async () => pending.reject(new Error("unknown"))); await settle(); }
    rt.list.mockResolvedValue({ items: [history(2, { customerId: 802 })], nextCursor: null });
    await render(802, { ...identity, key: "AUTH-B" });
    await act(async () => { staleSubmit?.(); if (phase !== "unknown") pending.resolve(phase === "preview" ? { total: 4, eligibleCount: 3, conflictCount: 1, revision: 19 } : { deletedCount: 3, skippedCount: 1 }); }); await settle();
    expect(row(2).textContent).toContain("批次-2.csv"); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(rt.complete).not.toHaveBeenCalled(); expect(rt.auth).toHaveBeenCalledTimes(phase === "unknown" ? 1 : 0);
    expect(rt.remove).toHaveBeenCalledTimes(phase === "preview" ? 0 : 1);
  });
});
