// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ChannelInventoryManagementPanel, useMaterialDeletion } from "./ChannelInventoryManagementPanel";
import type { DeleteMaterialRow, InventoryManagementClient, UploadBatchRecord } from "./management";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const context = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const batch: UploadBatchRecord = { id: 81, batchCode: "BATCH-81", name: null, fileName: "synthetic.xlsx", channelId: 11, channelName: "授权渠道", uploadedByName: "测试员工", createdAt: "2026-11-04T00:00:00Z", totalRows: 8, successCount: 6, remainingCount: 5, revision: 3, archived: false };
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20, pageCount: 1 });
let root: Root; let container: HTMLDivElement; let client: InventoryManagementClient; let complete: ReturnType<typeof vi.fn>; let authorization: ReturnType<typeof vi.fn>; let view: ReturnType<typeof vi.fn>;
const fn = (value: unknown) => vi.fn().mockResolvedValue(value);
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function change(element: HTMLInputElement | HTMLSelectElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function renderPanel(overrides: Partial<React.ComponentProps<typeof ChannelInventoryManagementPanel>> = {}) {
  act(() => root.render(React.createElement(ChannelInventoryManagementPanel, { mode: "batches", client, context, canWrite: true, isCurrent: () => true, onViewBatch: view, onComplete: complete, onAuthorizationError: authorization, ...overrides })));
}
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  complete = fn(undefined); authorization = vi.fn(); view = vi.fn();
  client = {
    createUploadBatch: { mutate: fn({ id: 81, batchCode: "BATCH-81", revision: 1 }) },
    listUploadBatches: { query: fn(page([batch])) }, listDeletedMaterials: { query: fn(page([{ id: 4, partNumber: "RESTORE-ONE", brand: "TI", revision: 12, deletedAt: batch.createdAt, uploadBatchId: 81, canRestore: true }, { id: 5, partNumber: "READ-ONLY", brand: "TI", revision: 1, deletedAt: batch.createdAt, uploadBatchId: null, canRestore: false }])) },
    previewDeleteUploadBatch: { query: fn({ total: 5, eligibleCount: 3, conflictCount: 2, revision: 19 }) },
    deleteUploadBatch: { mutate: fn({ deletedCount: 3, skippedCount: 2 }) }, updateUploadBatch: { mutate: fn({ id: 81, revision: 4 }) }, restoreMaterial: { mutate: fn({ id: 4, restored: true }) },
    deleteMaterials: { mutate: fn({ deletedCount: 2, skippedCount: 0, results: [{ id: 1, success: true }, { id: 2, success: true }] }) },
  };
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("batch/trash management local interactions", () => {
  it("uses the authenticated context, keeps existing table classes and views the exact batch", async () => {
    renderPanel(); await settle();
    expect(client.listUploadBatches.query).toHaveBeenCalledWith({ ...context, page: 1, pageSize: 20, archived: false, channelId: undefined }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.querySelector("table")?.className).toContain("ci-table admin-table-readable");
    expect(document.querySelector("tbody")?.textContent).toContain("6 / 5");
    click(button("查看库存")); expect(view).toHaveBeenCalledWith(81);
  });
  it("does not render management writes for ordinary read-only users", async () => {
    renderPanel({ canWrite: false }); await settle();
    expect(Array.from(document.querySelectorAll("button")).some(control => control.textContent === "整批删除")).toBe(false); expect(document.querySelectorAll(".ci-management-actions button")).toHaveLength(1);
    expect(client.updateUploadBatch.mutate).not.toHaveBeenCalled();
  });
  it("honors server list and row write-denial flags", async () => {
    vi.mocked(client.listUploadBatches.query).mockResolvedValue(page([{ ...batch, canEdit: false, canDelete: false }])); renderPanel(); await settle();
    expect(document.querySelectorAll(".ci-management-actions button")).toHaveLength(1);
    vi.mocked(client.listUploadBatches.query).mockResolvedValue({ ...page([batch]), canWrite: false }); click(button("刷新")); await settle();
    expect(document.querySelectorAll(".ci-management-actions button")).toHaveLength(1);
  });
  it("previews before confirming and submits the preview revision, not the list revision", async () => {
    renderPanel(); await settle(); click(button("整批删除")); await settle();
    expect(client.previewDeleteUploadBatch.query).toHaveBeenCalledWith({ ...context, id: 81 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(client.deleteUploadBatch.mutate).not.toHaveBeenCalled();
    const dialog = required(document.querySelector('[role="dialog"]'));
    expect(dialog.textContent).toContain("可删除 3 条"); expect(dialog.textContent).toContain("冲突 / 无权删除 2 条"); expect(dialog.textContent).toContain("不删除渠道");
    click(button("确认整批删除")); await settle();
    expect(client.deleteUploadBatch.mutate).toHaveBeenCalledWith({ ...context, id: 81, expectedRevision: 19, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(complete).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("跳过 2 条");
  });
  it("allows an explicitly confirmed zero-eligible batch to close its upload queue", async () => {
    vi.mocked(client.previewDeleteUploadBatch.query).mockResolvedValue({ total: 5, eligibleCount: 0, conflictCount: 5, revision: 20 });
    renderPanel(); await settle(); click(button("整批删除")); await settle();
    expect(button("确认整批删除").disabled).toBe(false);
    expect(document.body.textContent).toContain("关闭本批后续上传");
    click(button("确认整批删除")); await settle();
    expect(client.deleteUploadBatch.mutate).toHaveBeenCalledWith({ ...context, id: 81, expectedRevision: 20, requestId: expect.any(String) });
  });
  it("does not open a confirmation on preview failure", async () => {
    vi.mocked(client.previewDeleteUploadBatch.query).mockRejectedValue(new Error("preview denied"));
    renderPanel(); await settle(); click(button("整批删除")); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(client.deleteUploadBatch.mutate).not.toHaveBeenCalled(); expect(authorization).toHaveBeenCalledTimes(1);
  });
  it("retries uncertain whole-batch deletion with exactly the same UUID and revision", async () => {
    vi.mocked(client.deleteUploadBatch.mutate).mockRejectedValueOnce(new Error("network unknown"));
    renderPanel(); await settle(); click(button("整批删除")); await settle(); click(button("确认整批删除")); await settle();
    const original = vi.mocked(client.deleteUploadBatch.mutate).mock.calls[0][0];
    expect(button("取消").disabled).toBe(true); click(button("按原请求重试")); await settle();
    expect(vi.mocked(client.deleteUploadBatch.mutate).mock.calls[1][0]).toEqual(original);
    expect(client.previewDeleteUploadBatch.query).toHaveBeenCalledTimes(1);
  });
  it("renames and archives only historical organization, never invokes inventory deletion", async () => {
    renderPanel(); await settle(); click(button("命名"));
    change(required(document.querySelector<HTMLInputElement>('[aria-label="批次名称"]')), "  新的采购批次  "); click(button("保存")); await settle();
    expect(client.updateUploadBatch.mutate).toHaveBeenCalledWith({ ...context, id: 81, expectedRevision: 3, name: "新的采购批次", requestId: expect.any(String) });
    click(button("归档")); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("不删除库存"); click(button("保存")); await settle();
    expect(client.updateUploadBatch.mutate).toHaveBeenLastCalledWith({ ...context, id: 81, expectedRevision: 3, archived: true, requestId: expect.any(String) });
    expect(client.deleteMaterials.mutate).not.toHaveBeenCalled(); expect(client.deleteUploadBatch.mutate).not.toHaveBeenCalled();
  });
  it("requires confirmation to restore only server-approved rows and does not re-enable sharing", async () => {
    renderPanel({ mode: "trash" }); await settle();
    expect(document.querySelectorAll("tbody button")).toHaveLength(1); click(button("恢复"));
    expect(client.restoreMaterial.mutate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("不会自动恢复被禁用的共享");
    click(button("确认恢复")); await settle();
    expect(client.restoreMaterial.mutate).toHaveBeenCalledWith({ ...context, id: 4, expectedRevision: 12, requestId: expect.any(String) });
  });
  it("discards an in-flight preview after the authenticated context is no longer current", async () => {
    let finish!: (value: { total: number; eligibleCount: number; conflictCount: number; revision: number }) => void;
    vi.mocked(client.previewDeleteUploadBatch.query).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let valid = true; renderPanel({ isCurrent: () => valid }); await settle(); click(button("整批删除")); valid = false;
    await act(async () => finish({ total: 5, eligibleCount: 3, conflictCount: 2, revision: 1 }));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(client.deleteUploadBatch.mutate).not.toHaveBeenCalled();
  });
  it("keeps local CSS free from new font/size rules", () => {
    const css = readFileSync(`${process.cwd()}/client/src/business/platform/client/src/components/channelInventory/management.css`, "utf8");
    expect(css).not.toMatch(/font(?:-family|-size)?\s*:|line-height\s*:|letter-spacing\s*:/);
  });
});
const materialRows: DeleteMaterialRow[] = [{ id: 1, revision: 4, partNumber: "ONE", qty: 9, canDelete: true }, { id: 2, revision: 8, partNumber: "TWO", qty: null, canDelete: true }, { id: 3, revision: 2, partNumber: "READ-ONLY", qty: 1, canDelete: true, readOnly: true }, { id: 4, revision: 1, partNumber: "NO-HINT", qty: 0 }];
function SelectionHarness({ scopeKey = "context:page:1", canWrite = true }: { scopeKey?: string; canWrite?: boolean }) {
  const deletion = useMaterialDeletion({ client, context, rows: materialRows, scopeKey, canWrite, isCurrent: () => true, onComplete: complete, onAuthorizationError: authorization });
  return React.createElement("section", null,
    React.createElement("button", { onClick: deletion.selectAll }, "全选"),
    React.createElement("div", { "data-testid": "selected" }, deletion.selected.map(row => row.id).join(",")),
    deletion.toolbar, deletion.feedback, deletion.dialog);
}
function renderSelection(props: { scopeKey?: string; canWrite?: boolean } = {}) { act(() => root.render(React.createElement(SelectionHarness, props))); }
describe("current-page material deletion", () => {
  it("selects only explicitly server-deletable rows, with confirmation listing models and quantity", async () => {
    renderSelection(); expect(document.body.textContent).not.toContain("已选"); click(button("全选"));
    expect(document.querySelector('[data-testid="selected"]')?.textContent).toBe("1,2"); click(button("批量删除"));
    const dialog = required(document.querySelector('[role="dialog"]'));
    expect(dialog.textContent).toContain("ONE · 可供数量：9"); expect(dialog.textContent).toContain("TWO · 可供数量：待确认"); expect(dialog.textContent).toContain("不会删除关联渠道");
    expect(client.deleteMaterials.mutate).not.toHaveBeenCalled(); click(button("移入回收站 2 条")); await settle();
    expect(client.deleteMaterials.mutate).toHaveBeenCalledWith({ ...context, items: [{ id: 1, expectedRevision: 4 }, { id: 2, expectedRevision: 8 }], requestId: expect.any(String) });
    expect(document.querySelector('[data-testid="selected"]')?.textContent).toBe("");
  });
  it.each(["context:page:2", "other-context:page:1", "context:new-filter:1"])("clears selection on %s", scopeKey => {
    renderSelection(); click(button("全选")); renderSelection({ scopeKey });
    expect(document.querySelector('[data-testid="selected"]')?.textContent).toBe(""); expect(document.querySelector('[aria-label="当前页批量删除"]')).toBeNull();
  });
  it("does not select or render management write actions in read-only mode", () => {
    renderSelection({ canWrite: false }); click(button("全选"));
    expect(document.querySelector('[data-testid="selected"]')?.textContent).toBe(""); expect(document.querySelector('[aria-label="当前页批量删除"]')).toBeNull();
  });
  it("freezes the original CAS request when a material delete result is uncertain", async () => {
    vi.mocked(client.deleteMaterials.mutate).mockRejectedValueOnce(new Error("unknown response")); renderSelection(); click(button("全选")); click(button("批量删除")); click(button("移入回收站 2 条")); await settle();
    const original = vi.mocked(client.deleteMaterials.mutate).mock.calls[0][0]; click(button("按原请求重试")); await settle();
    expect(vi.mocked(client.deleteMaterials.mutate).mock.calls[1][0]).toEqual(original);
  });
});
