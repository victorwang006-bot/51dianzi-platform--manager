// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffArchiveDialog from "./StaffArchiveDialog";
let root: Root, host: HTMLDivElement;
const preview = { archived: false, adminOnly: false, pending: null, expectedSessionVersion: 4, expectedBindingVersion: 3,
  preview: { enterpriseId: 701, target: { userId: 202, displayName: "私有目标A" }, revision: "a".repeat(64), inventory: { total: 1 }, inquiries: { total: 0 }, customers: { total: 2 }, limits: { exceeded: false }, unsupported: [],
    candidates: [{ userId: 303, displayName: "私有接替人A", eligible: true, unavailableReason: null }, { userId: 404, displayName: "不可接替", eligible: false, unavailableReason: "权限不足" }] } };
const completed = { success: true, state: "completed", idempotent: false, requestId: "staff_test_request", backendAccessClosed: true, membershipRequired: true, enterpriseRemoved: true, message: "用户已删除，历史数据保留。" };
let props: any;
function action() { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => /^(交接并删除用户|删除用户|重试原请求|处理中…)$/.test(b.textContent ?? ""))!; }
async function render(changes: any = {}) { Object.assign(props, changes); await act(async () => root.render(React.createElement(StaffArchiveDialog, props))); }
async function submit() { await act(async () => action().click()); }
async function select(value: string) { await act(async () => { const s = document.querySelector<HTMLSelectElement>("select")!; s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); }); }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { open: true, actorKey: "actorA:v1", id: 20, merchantId: 61, name: "员工甲", onOpenChange: vi.fn(), loadPreview: vi.fn().mockResolvedValue(preview), archive: vi.fn().mockResolvedValue(completed), onChanged: vi.fn().mockResolvedValue(undefined) };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("StaffArchiveDialog verified retirement", () => {
  it("requires a legally eligible handoff recipient and sends real versioned preview", async () => {
    await render(); expect(action().disabled).toBe(true);
    await select("404"); expect(action().disabled).toBe(true); await submit(); expect(props.archive).not.toHaveBeenCalled();
    await select("303"); expect(action().disabled).toBe(false); await submit();
    expect(props.archive).toHaveBeenCalledWith(expect.objectContaining({ id: 20, merchantId: 61, nextOwnerUserId: 303, expectedRevision: "a".repeat(64), expectedBindingVersion: 3, expectedSessionVersion: 4 }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("deletes a proven never-bound admin without fabricating a front identity", async () => {
    props.loadPreview.mockResolvedValue({ ...preview, adminOnly: true, preview: null, expectedBindingVersion: 0 });
    props.archive.mockResolvedValue({ ...completed, membershipRequired: false, enterpriseRemoved: null });
    await render({ merchantId: null }); expect(action().disabled).toBe(false); await submit();
    expect(props.archive).toHaveBeenCalledWith(expect.objectContaining({ merchantId: null, expectedBindingVersion: 0, expectedRevision: null }));
    expect(props.archive.mock.calls[0][0]).not.toHaveProperty("nextOwnerUserId");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("replays an existing pending request with its original payload", async () => {
    const pending = { requestId: "staff_original_request", expectedSessionVersion: 4, expectedBindingVersion: 3, expectedRevision: "b".repeat(64), nextOwnerUserId: 303, state: "retryable", message: "后台访问已关闭，企业离职待处理" };
    props.loadPreview.mockResolvedValue({ ...preview, archived: true, preview: null, pending });
    await render(); expect(action().textContent).toBe("重试原请求"); await submit();
    expect(props.archive.mock.calls[0][0]).toEqual({ id: 20, merchantId: 61, expectedSessionVersion: 4, expectedBindingVersion: 3, expectedRevision: pending.expectedRevision, requestId: pending.requestId, nextOwnerUserId: 303 });
  });
  it("keeps noncompleted results open and freezes a retry payload after transport error", async () => {
    props.archive.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({ ...completed, success: false, state: "retryable", enterpriseRemoved: false, message: "后台访问已关闭，企业离职待处理" });
    await render(); await select("303"); await submit(); const original = props.archive.mock.calls[0][0];
    expect(document.body.textContent).toContain("结果未确认"); expect(document.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
    await select("404"); await submit(); expect(props.archive.mock.calls[1][0]).toEqual(original);
    expect(props.onOpenChange).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("企业离职待处理");
  });
  it.each(["unsupported", "limit", "error"])("blocks %s rather than claiming success", async kind => {
    if (kind === "error") props.loadPreview.mockRejectedValue(new Error("权限已变化"));
    else props.loadPreview.mockResolvedValue({ ...preview, preview: { ...preview.preview, limits: { exceeded: kind === "limit" }, unsupported: kind === "unsupported" ? [{ key: "unknown", label: "未知责任", reason: "未核验", blocking: true }] : [] } });
    await render(); expect(action().disabled).toBe(true); await submit(); expect(props.archive).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
  });
  it("clears private data on actor/enterprise changes and ignores stale preview responses", async () => {
    await render(); expect(document.body.textContent).toContain("私有接替人A");
    let finish!: (value: any) => void; props.loadPreview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render({ actorKey: "actorB:v2", merchantId: 62 }); expect(document.body.textContent).not.toContain("私有接替人A"); expect(action().disabled).toBe(true);
    await render({ open: false }); await act(async () => finish(preview));
    await render({ open: true, loadPreview: vi.fn().mockRejectedValue(new Error("权限已收回")) });
    expect(document.body.textContent).not.toContain("私有接替人A"); expect(action().disabled).toBe(true);
  });
  it("ignores stale mutation completion after authorization changes", async () => {
    let finish!: (value: any) => void; props.archive.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render(); await select("303"); await act(async () => { action().click(); action().click(); }); expect(props.archive).toHaveBeenCalledTimes(1);
    await render({ actorKey: "actorB:v2", open: false }); await act(async () => finish(completed));
    expect(props.onChanged).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
  });
  it("does not permit a second mutation for an already-completed archive", async () => {
    props.loadPreview.mockResolvedValue({ ...preview, archived: true, preview: null, pending: { state: "completed", message: "已删除" } });
    await render(); expect(action().disabled).toBe(true); await submit(); expect(props.archive).not.toHaveBeenCalled();
  });
});
