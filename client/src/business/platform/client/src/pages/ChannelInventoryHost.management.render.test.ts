// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectHostTab } from "./ChannelInventoryHost.router-test-helper";
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue(undefined) });
  const mutations = { createChannel: vi.fn(), updateChannel: vi.fn(), setChannelActive: vi.fn(), createMaterial: vi.fn().mockResolvedValue({}), updateTeamMaterial: vi.fn(), publishFactoryMaterial: vi.fn() };
  const management = {
    createUploadBatch: { mutate: vi.fn().mockResolvedValue({ id: 81, batchCode: "BATCH-81", revision: 1 }) },
    deleteMaterials: { mutate: vi.fn().mockResolvedValue({ deletedCount: 1, skippedCount: 0, results: [{ id: 1, success: true }] }) },
    listDeletedMaterials: { query: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 }) },
    listUploadBatches: { query: vi.fn().mockResolvedValue({ items: [{ id: 81, batchCode: "BATCH-81", name: null, fileName: "synthetic.xlsx", channelId: 11, channelName: "渠道", uploadedByName: "员工", createdAt: "2026-11-04T00:00:00Z", totalRows: 1, successCount: 1, remainingCount: 1, revision: 1, archived: false }], total: 1, page: 1, pageSize: 20, pageCount: 1 }) },
    updateUploadBatch: { mutate: vi.fn() }, previewDeleteUploadBatch: { query: vi.fn() }, deleteUploadBatch: { mutate: vi.fn() }, restoreMaterial: { mutate: vi.fn() },
  };
  return { query, mutations, management, inventoryInputs: [] as Record<string, unknown>[],
    scope: { officialInventoryPermissions: { read: true, write: true, note: true, publish: true as boolean | undefined, authorizationVersion: "native-v1" }, storageScope: "scope-31", frontUser: { role: "user" }, contextVerification: { state: "verified", identity: "scope-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    enterprise: null as unknown, team: null as unknown, channels: null as unknown,
    utils: { client: { channelInventory: { ...management } }, channelInventory: { listChannels: { invalidate }, listTeamMaterials: { invalidate }, listTeamSourceOptions: { invalidate }, notesList: { invalidate }, collaborationNotesList: { invalidate } } },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils, enterprise: { me: { useQuery: () => runtime.enterprise } }, channelInventory: {
    listChannels: { useQuery: () => runtime.channels }, listTeamMaterials: { useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => { if (options?.enabled) runtime.inventoryInputs.push(input); return runtime.team; } },
    createChannel: { useMutation: () => ({ mutateAsync: runtime.mutations.createChannel }) }, updateChannel: { useMutation: () => ({ mutateAsync: runtime.mutations.updateChannel }) }, setChannelActive: { useMutation: () => ({ mutateAsync: runtime.mutations.setChannelActive }) }, createMaterial: { useMutation: () => ({ mutateAsync: runtime.mutations.createMaterial }) }, updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.mutations.updateTeamMaterial }) },
    publishFactoryMaterial: { useMutation: () => ({ mutateAsync: runtime.mutations.publishFactoryMaterial }) },
  },
} }));
import ChannelInventoryHost from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
const row = { id: 1, revision: 4, channelId: 11, partNumber: "ONE", brand: "TI", qty: 9, dateCode: null, price: null, taxIncluded: null, leadTime: null, industryCode: null, updatedAt: "2026-11-04T00:00:00Z", canDelete: true, canEdit: true, readOnly: false, canViewSource: false, isMine: true, noteCount: 0, originalRecorderName: "原负责人" };
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function renderHost() { act(() => root.render(React.createElement(ChannelInventoryHost))); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory"); runtime.inventoryInputs = []; runtime.scope.officialInventoryPermissions.write = true; runtime.scope.frontUser.role = "user";
  runtime.scope.officialInventoryPermissions.publish = true;
  runtime.mutations.createMaterial.mockReset().mockResolvedValue({});
  runtime.management.createUploadBatch.mutate.mockReset().mockResolvedValue({ id: 81, batchCode: "BATCH-81", revision: 1 });
  runtime.mutations.publishFactoryMaterial.mockReset().mockResolvedValue({ materialId: 1, publicId: "ocp_0123456789abcdef0123456789abcdef", status: "published", revision: row.revision });
  runtime.enterprise = runtime.query({ enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: true });
  runtime.team = runtime.query({ items: [row, { ...row, id: 2, partNumber: "READ-ONLY", canDelete: false, canEdit: false, readOnly: true }], total: 2, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
  runtime.channels = runtime.query({ items: [{ id: 11, name: "授权渠道", enterpriseId: 31, active: true, canEdit: true, readOnly: false, type: "factory", revision: 1 }], total: 1, page: 1, pageSize: 100, pageCount: 1, canWrite: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production network forbidden in management fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("manager Host inventory-management bridge", () => {
  it("adds batches/trash without replacing original inventory columns or readonly row actions", () => {
    renderHost(); expect(document.querySelector('[role="tablist"], .ci-tabs')).toBeNull();
    expect(Array.from(document.querySelectorAll("thead th")).map(cell => cell.textContent)).toEqual(["#", "型号", "品牌", "负责人", "所属行业", "可供数量", "报价 CNY", "交期", "DC / 更新", "渠道来源", "操作"]);
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(document.querySelectorAll('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]')).toHaveLength(1);
    const views = required(document.querySelector('.ci-toolbar[aria-label="材料筛选"] .ci-inventory-view-controls'));
    expect(views.previousElementSibling?.textContent).toBe("选择");
    expect(views.nextElementSibling?.className).toBe("ci-filter-count");
    click(button("选择")); expect(button("取消选择").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll("tbody input[type=checkbox]")).toHaveLength(1);
    expect(document.querySelectorAll("thead th")).toHaveLength(12);
    for (const row of document.querySelectorAll("tbody tr")) expect(row.querySelectorAll("td")).toHaveLength(12);
    runtime.team = { ...(runtime.team as object), isLoading: true };
    renderHost();
    expect(document.querySelectorAll("thead th")).toHaveLength(12);
    expect(document.querySelector("tbody td.ci-empty")?.getAttribute("colspan")).toBe("12");
  });
  it("sends single deletion through the existing bridge with the row revision and asserted identity", async () => {
    renderHost(); const trigger = required(document.querySelector<HTMLElement>('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]'));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    click(required(Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === "删除"))); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ONE · 可供数量：9"); expect(runtime.management.deleteMaterials.mutate).not.toHaveBeenCalled();
    click(button("移入回收站 1 条")); await settle();
    expect(runtime.management.deleteMaterials.mutate).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, items: [{ id: 1, expectedRevision: 4 }], requestId: expect.any(String) });
  });
  it("clears current-page selection when a filter changes", () => {
    renderHost(); click(button("选择")); click(required(document.querySelector('[aria-label="全选当前页可删除库存"]'))); expect(document.body.textContent).toContain("已选 1 条");
    const input = required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存品牌"]'));
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ADI"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelector('[aria-label="当前页批量删除"]')).toBeNull();
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(runtime.inventoryInputs.at(-1)?.brand).toBeUndefined();
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });
  it("cancel exits selection mode, clears IDs and retains single deletion in More", () => {
    renderHost(); click(button("选择")); click(required(document.querySelector('[aria-label="全选当前页可删除库存"]')));
    click(button("取消选择")); expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(document.querySelector('[aria-label="当前页批量删除"]')).toBeNull();
    click(button("选择")); expect(required(document.querySelector<HTMLInputElement>('[aria-label="全选当前页可删除库存"]')).checked).toBe(false);
    const trigger = required(document.querySelector<HTMLElement>('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]'));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["编辑", "删除"]);
  });
  it.each(["view", "actor", "enterprise", "permission"])("clears selection mode on %s change", async change => {
    renderHost(); click(button("选择")); click(required(document.querySelector('[aria-label="全选当前页可删除库存"]')));
    if (change === "view") { click(button("按渠道查看")); await settle(); }
    if (change === "actor") { runtime.enterprise = runtime.query({ enterprise: { id: 31 }, currentUserId: 8, permissionKeys: ["inventory.manage"], isOwner: true }); renderHost(); }
    if (change === "enterprise") { runtime.enterprise = runtime.query({ enterprise: { id: 32 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: true }); renderHost(); }
    if (change === "permission") { runtime.scope.officialInventoryPermissions.write = false; renderHost(); }
    expect(document.querySelector('[aria-label="当前页批量删除"]')).toBeNull(); expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });
  it("views a batch using exact uploadBatchId without granting source filtering", async () => {
    renderHost(); selectHostTab("batches"); await settle(); click(button("查看库存")); await settle();
    expect(required(document.querySelector<HTMLInputElement>('[aria-label="筛选上传批次 ID"]')).value).toBe("81");
    expect(runtime.inventoryInputs.at(-1)).toMatchObject({ uploadBatchId: 81, page: 1, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')).disabled).toBe(true);
  });
  it("creates one durable batch before the row create DTO and retains original workbook UI", async () => {
    renderHost(); click(button("上传库存")); await settle();
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["UPLOAD-ONE", "TI"]]), "synthetic");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "synthetic.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
    const input = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]')); Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
    const select = required(document.querySelector<HTMLSelectElement>('[aria-label="批量关联渠道"]'));
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "11"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    click(button("预览并校验")); click(button("确认上传 1 条")); await settle();
    expect(runtime.management.createUploadBatch.mutate).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 11, fileName: "synthetic.xlsx · synthetic", totalRows: 1, requestId: expect.any(String) });
    expect(runtime.mutations.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 11, uploadBatchId: 81, partNumber: "UPLOAD-ONE" }));
  });
  it("never displays the newly added delete/rename/archive/restore write entrances without native write grant", async () => {
    runtime.scope.officialInventoryPermissions.write = false; renderHost();
    expect(document.querySelector('[aria-label="全选当前页可删除库存"]')).toBeNull();
    const trigger = required(document.querySelector<HTMLElement>('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]'));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["编辑"]);
    expect(document.querySelector('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
    selectHostTab("batches"); await settle(); expect(document.querySelectorAll(".ci-management-actions button")).toHaveLength(1);
  });
  it.each(["user", "admin"])("%s publishes a server-authorized row only after final confirmation, without deriving authority from canEdit", async role => {
    runtime.scope.frontUser.role = role;
    runtime.team = runtime.query({ items: [{ ...row, canEdit: false, canDelete: false, readOnly: true, canPublish: true, publicationStatus: "unpublished", price: "2.50", note: "PRIVATE-INTEGRATION-NOTE", channelName: "PRIVATE-SOURCE" }], total: 1, page: 1, pageSize: 20, pageCount: 1, canWrite: false, canFilterSource: false });
    renderHost(); expect(button("发布").disabled).toBe(false); expect(document.querySelector('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]')).toBeNull();
    click(button("发布")); expect(runtime.mutations.publishFactoryMaterial).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ONE");
    expect(document.body.innerHTML).not.toContain("PRIVATE-INTEGRATION-NOTE"); expect(document.body.innerHTML).not.toContain("PRIVATE-SOURCE");
    click(button("确认发布")); await settle();
    expect(runtime.mutations.publishFactoryMaterial).toHaveBeenCalledWith({ materialId: 1, expectedRevision: 4, expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.any(String) });
    expect(button("已发布").disabled).toBe(true);
  });
  it.each(["authorized", "invalid-role"])("never enables server publish flags for unsupported business role %s", role => {
    runtime.scope.frontUser.role = role;
    runtime.team = runtime.query({ items: [{ ...row, canPublish: true, publicationStatus: "unpublished" }], total: 1, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
    renderHost(); expect(button("发布").disabled).toBe(true); click(button("发布")); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.mutations.publishFactoryMaterial).not.toHaveBeenCalled();
  });
  it.each([false, undefined])("does not substitute native edit permission for native publish=%s", publish => {
    runtime.scope.frontUser.role = "user"; runtime.scope.officialInventoryPermissions.publish = publish;
    runtime.team = runtime.query({ items: [{ ...row, canPublish: true, publicationStatus: "unpublished" }], total: 1, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
    renderHost(); expect(button("发布").disabled).toBe(true); click(button("发布")); expect(runtime.mutations.publishFactoryMaterial).not.toHaveBeenCalled();
  });
  it("clears a private publish snapshot immediately on native publish revocation", () => {
    runtime.scope.frontUser.role = "user";
    runtime.team = runtime.query({ items: [{ ...row, canPublish: true, publicationStatus: "unpublished" }], total: 1, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
    renderHost(); click(button("发布")); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    runtime.scope.officialInventoryPermissions.publish = false; renderHost(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.mutations.publishFactoryMaterial).not.toHaveBeenCalled();
  });
});

async function prepareSingleUpload() {
  renderHost(); click(button("单条上传")); await settle();
  const dialog = required(document.querySelector('[role="dialog"]'));
  for (const [label, value] of [["型号 *", "SINGLE-ONE"], ["品牌 *", "TI"]]) {
    const field = required(Array.from(dialog.querySelectorAll("label")).find(item => item.querySelector("span")?.textContent === label));
    const input = required(field.querySelector("input"));
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
}
function submitSingleUpload() { click(required(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(item => item.textContent === "上传库存"))); }
describe("single upload exact batch identity", () => {
  it("creates the durable single-entry batch before stock, without changing the material DTO", async () => {
    await prepareSingleUpload(); submitSingleUpload(); await settle();
    expect(runtime.management.createUploadBatch.mutate).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 11, fileName: "单条手工录入", totalRows: 1, requestId: expect.any(String) });
    expect(runtime.mutations.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ uploadBatchId: 81, channelId: 11, partNumber: "SINGLE-ONE", brand: "TI", requestId: expect.any(String) }));
    expect(runtime.management.createUploadBatch.mutate.mock.invocationCallOrder[0]).toBeLessThan(runtime.mutations.createMaterial.mock.invocationCallOrder[0]);
  });
  it("unknown batch creation reuses its original UUID and submits no row until the batch receipt is known", async () => {
    runtime.management.createUploadBatch.mutate.mockRejectedValueOnce(new Error("batch response lost"));
    await prepareSingleUpload(); submitSingleUpload(); await settle();
    expect(runtime.mutations.createMaterial).not.toHaveBeenCalled();
    const original = runtime.management.createUploadBatch.mutate.mock.calls[0][0];
    expect(required(document.querySelector<HTMLFieldSetElement>('[role="dialog"] fieldset')).disabled).toBe(true);
    click(button("按原请求重试")); await settle();
    expect(runtime.management.createUploadBatch.mutate.mock.calls[1][0]).toEqual(original);
    expect(runtime.mutations.createMaterial).toHaveBeenCalledTimes(1);
  });
  it("unknown row creation keeps its batch ID and exact row request without creating another batch", async () => {
    runtime.mutations.createMaterial.mockRejectedValueOnce(new Error("row response lost"));
    await prepareSingleUpload(); submitSingleUpload(); await settle();
    const original = { ...runtime.mutations.createMaterial.mock.calls[0][0] };
    click(button("按原请求重试")); await settle();
    expect(runtime.management.createUploadBatch.mutate).toHaveBeenCalledTimes(1);
    expect(runtime.mutations.createMaterial.mock.calls[1][0]).toEqual(original);
  });
  it("a stale actor cannot submit stock after an in-flight batch creation resolves", async () => {
    let finish!: (value: { id: number; batchCode: string; revision: number }) => void;
    runtime.management.createUploadBatch.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await prepareSingleUpload(); submitSingleUpload();
    runtime.enterprise = runtime.query({ enterprise: { id: 31 }, currentUserId: 8, permissionKeys: ["inventory.manage"], isOwner: true }); renderHost();
    await act(async () => { finish({ id: 81, batchCode: "BATCH-81", revision: 1 }); });
    expect(runtime.mutations.createMaterial).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
