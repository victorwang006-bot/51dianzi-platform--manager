// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostNavigate, selectHostTab, setHostTestLocation } from "./ChannelInventoryHost.router-test-helper";
import { getChannelInventoryNavigationTab } from "../../../../../lib/channelInventoryNavigation";

vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue(undefined) });
  const client = {
    getChannel: { query: vi.fn() }, listTeamMaterials: { query: vi.fn() }, getTeamMaterialForEdit: { query: vi.fn() },
    listTeamSourceOptions: { query: vi.fn() },
    listUploadBatches: { query: vi.fn() }, listDeletedMaterials: { query: vi.fn() },
    deleteMaterials: { mutate: vi.fn() }, restoreMaterial: { mutate: vi.fn() },
    createUploadBatch: { mutate: vi.fn() }, updateUploadBatch: { mutate: vi.fn() },
    previewDeleteUploadBatch: { query: vi.fn() }, deleteUploadBatch: { mutate: vi.fn() },
  };
  return {
    query, client, mutations: { createChannel: vi.fn(), updateChannel: vi.fn(), setChannelActive: vi.fn(), createMaterial: vi.fn(), updateTeamMaterial: vi.fn() },
    enterprise: null as unknown, team: null as unknown, channels: null as unknown,
    inputs: [] as Record<string, unknown>[], channelInputs: [] as Record<string, unknown>[],
    scope: { officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: "native-v1" }, storageScope: "scope-31", frontUser: { role: "user" }, contextVerification: { state: "verified", identity: "scope-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    utils: { client: { channelInventory: client }, channelInventory: { listChannels: { invalidate }, listTeamMaterials: { invalidate }, listTeamSourceOptions: { invalidate }, notesList: { invalidate }, collaborationNotesList: { invalidate } } },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils,
  enterprise: { me: { useQuery: () => runtime.enterprise } },
  channelInventory: {
    listTeamMaterials: { useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => { if (options?.enabled) runtime.inputs.push(input); return runtime.team; } },
    listChannels: { useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => { if (options?.enabled) runtime.channelInputs.push(input); return runtime.channels; } },
    createChannel: { useMutation: () => ({ mutateAsync: runtime.mutations.createChannel }) },
    updateChannel: { useMutation: () => ({ mutateAsync: runtime.mutations.updateChannel }) },
    setChannelActive: { useMutation: () => ({ mutateAsync: runtime.mutations.setChannelActive }) },
    createMaterial: { useMutation: () => ({ mutateAsync: runtime.mutations.createMaterial }) },
    updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.mutations.updateTeamMaterial }) },
  },
} }));
import ChannelInventoryHost from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const row = { id: 1, revision: 4, partNumber: "NAV-ONE", brand: "TI", qty: 9, dateCode: null, price: null, currency: "CNY", taxIncluded: null, leadTime: null, industryCode: null, updatedAt: "2026-11-04T00:00:00Z", canDelete: true, canEdit: true, readOnly: false, canViewSource: false, isMine: true, noteCount: 0 };
const channel = { id: 11, name: "授权渠道", enterpriseId: 31, active: true, canEdit: true, readOnly: false, type: "factory", revision: 2 };
const deleted = { id: 1, revision: 8, partNumber: "DELETED-NAV-ONE", brand: "TI", deletedAt: "2026-11-04T00:00:00Z", uploadBatchId: 81, canRestore: true };
const batch = { id: 81, batchCode: "BATCH-81", name: null, fileName: "synthetic.xlsx", channelId: 11, channelName: "授权渠道", uploadedByName: "员工", createdAt: "2026-11-04T00:00:00Z", totalRows: 1, successCount: 1, remainingCount: 1, revision: 3, archived: false };
const page = <T,>(items: T[], extra: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, pageSize: 20, pageCount: 1, ...extra });
let root: Root;
let container: HTMLDivElement;
function renderHost() { act(() => root.render(React.createElement(ChannelInventoryHost))); }
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function materialMenuItem(name: string) {
  const trigger = required(document.querySelector<HTMLElement>('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]'));
  act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  const menu = required(document.querySelector<HTMLElement>('.ci-channel-actions-menu[role="menu"]'));
  expect(menu.closest("table,.ci-tablewrap,.ci-host")).toBeNull();
  return required(Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.trim() === name));
}
function selectCurrentPageForDeletion() {
  expect(document.querySelector('[aria-label="全选当前页可删除库存"]')).toBeNull();
  const select = button("选择");
  expect(select.disabled).toBe(false);
  click(select);
  expect(button("取消选择").getAttribute("aria-pressed")).toBe("true");
  click(required(document.querySelector('[aria-label="全选当前页可删除库存"]')));
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function historyTravel(direction: "back" | "forward") {
  await act(async () => { window.history[direction](); await new Promise(resolve => setTimeout(resolve, 30)); });
}
function assertView(tab: "materials" | "channels" | "batches" | "trash") {
  const selector = { materials: ".ci-stock-edit-table", channels: '[aria-label="渠道管理列表"]', batches: '[aria-label="上传批次管理列表"]', trash: '[aria-label="回收站管理列表"]' }[tab];
  expect(document.querySelector(selector)).not.toBeNull();
  expect(getChannelInventoryNavigationTab(window.location.search)).toBe(tab);
}
function teamWrite(canWrite: boolean) { runtime.team = runtime.query(page([row], { canWrite, canFilterSource: false })); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState(null, "", "/workbench/channel-inventory");
  runtime.inputs = []; runtime.channelInputs = [];
  runtime.scope.officialInventoryPermissions.read = true; runtime.scope.officialInventoryPermissions.write = true;
  runtime.scope.contextVerification.authorizationVersion = "auth-v1";
  runtime.enterprise = runtime.query({ enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: false });
  teamWrite(true); runtime.channels = runtime.query(page([channel], { canWrite: true }));
  runtime.client.getChannel.query.mockReset().mockResolvedValue(channel);
  runtime.client.listTeamMaterials.query.mockReset().mockResolvedValue(page([{ ...row, canViewSource: true }], { canWrite: true, canFilterSource: false }));
  runtime.client.getTeamMaterialForEdit.query.mockReset().mockResolvedValue({ ...row, channelId: 11, channelName: "授权渠道" });
  runtime.client.listTeamSourceOptions.query.mockReset().mockResolvedValue({ items: [], canFilterSource: false });
  runtime.client.listUploadBatches.query.mockReset().mockResolvedValue(page([batch], { canWrite: true }));
  runtime.client.listDeletedMaterials.query.mockReset().mockResolvedValue(page([deleted], { canWrite: true }));
  runtime.client.deleteMaterials.mutate.mockReset().mockResolvedValue({ deletedCount: 1, skippedCount: 0, results: [{ id: 1, success: true }] });
  runtime.client.restoreMaterial.mutate.mockReset().mockResolvedValue({ id: 1, restored: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production network forbidden in Host fixtures"); }));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("ChannelInventoryHost top-dropdown URL intent", () => {
  it.each(["materials", "channels", "batches", "trash"] as const)("initial ciTab=%s mounts the real panel without local tabs or synthetic target", async tab => {
    setHostTestLocation(`/workbench/channel-inventory?ciTab=${tab}`, "replace"); renderHost(); await settle();
    assertView(tab); expect(document.querySelector('[role="tablist"], .ci-tabs')).toBeNull();
    if (tab === "batches" || tab === "trash") expect(document.querySelector(".ci-tabbar, .ci-heading-actions")).toBeNull();
    else expect(document.querySelector(".ci-heading-actions")?.textContent).toContain(tab === "channels" ? "+ 新增渠道" : "上传库存单条上传");
    expect(hostNavigate).not.toHaveBeenCalled(); expect(runtime.client.getChannel.query).not.toHaveBeenCalled();
    expect(runtime.client.listTeamSourceOptions.query).not.toHaveBeenCalled();
    if (tab === "batches") expect(runtime.client.listUploadBatches.query).toHaveBeenCalledWith({ ...context, page: 1, pageSize: 20, channelId: undefined, archived: false }, { signal: expect.any(AbortSignal) });
    if (tab === "trash") expect(runtime.client.listDeletedMaterials.query).toHaveBeenCalledWith({ ...context, page: 1, pageSize: 20 }, { signal: expect.any(AbortSignal) });
  });

  it.each(["materials", "channels", "batches", "trash"] as const)("legal ciTab=%s suppresses stale supply parameters initially and on authorization changes", async tab => {
    setHostTestLocation(`/workbench/channel-inventory?ciTab=${tab}&supplyChannelId=11&supplyTab=channels`, "replace");
    renderHost(); await settle(); assertView(tab);
    expect(runtime.client.getChannel.query).not.toHaveBeenCalled();
    expect(document.querySelector(".ci-supply-location")).toBeNull();
    runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    renderHost(); await settle(); assertView(tab);
    expect(runtime.client.getChannel.query).not.toHaveBeenCalled();
    expect(hostNavigate).not.toHaveBeenCalled();
  });

  it("switching from legacy supply to an explicit tab cancels old targeting and does not restart it on scope changes", async () => {
    setHostTestLocation("/workbench/channel-inventory?supplyChannelId=11&supplyTab=channels", "replace");
    renderHost(); await settle(); expect(runtime.client.getChannel.query).toHaveBeenCalledTimes(1);
    setHostTestLocation("/workbench/channel-inventory?ciTab=trash&supplyChannelId=11&supplyTab=channels");
    await settle(); assertView("trash"); expect(document.querySelector(".ci-supply-location")).toBeNull();
    runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    renderHost(); await settle(); assertView("trash");
    expect(runtime.client.getChannel.query).toHaveBeenCalledTimes(1);
  });

  it("an invalid ciTab does not suppress the original legacy parser or exact server proof", async () => {
    setHostTestLocation("/workbench/channel-inventory?ciTab=invalid&supplyChannelId=11&supplyTab=channels", "replace");
    renderHost(); await settle(); assertView("channels");
    expect(runtime.client.getChannel.query).toHaveBeenCalledWith({ ...context, id: 11 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-supply-location")).not.toBeNull();
  });

  it("follows real back/forward, restores materials on bare home and does not push an effect loop", async () => {
    renderHost(); selectHostTab("channels"); selectHostTab("batches"); await settle(); assertView("batches");
    await historyTravel("back"); assertView("channels");
    await historyTravel("back"); assertView("materials"); expect(window.location.search).toBe("");
    await historyTravel("forward"); assertView("channels");
    await historyTravel("forward"); await settle(); assertView("batches");
    expect(hostNavigate).not.toHaveBeenCalled();
  });

  it("does not discard an editor on the same tab intent, but URL tab changes invalidate and abort an old editor request", async () => {
    selectHostTab("materials"); renderHost(); click(button("单条上传"));
    const editor = required(document.querySelector('[role="dialog"]'));
    setHostTestLocation("/workbench/channel-inventory?ciTab=materials&uiHint=1");
    expect(document.querySelector('[role="dialog"]')).toBe(editor);
    selectHostTab("channels"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    selectHostTab("materials");
    let finish!: (result: unknown) => void;
    runtime.client.getTeamMaterialForEdit.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    click(materialMenuItem("编辑")); const signal = runtime.client.getTeamMaterialForEdit.query.mock.calls[0][1].signal as AbortSignal;
    selectHostTab("trash"); await settle(); expect(signal.aborted).toBe(true);
    await act(async () => { finish({ ...row, channelId: 11 }); });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); assertView("trash");
    expect(hostNavigate).not.toHaveBeenCalled();
  });

  it("viewBatch enters materials with exact uploadBatchId and emits one workbench-relative callback for top highlight", async () => {
    selectHostTab("batches"); renderHost(); await settle(); click(button("查看库存")); await settle();
    assertView("materials"); expect(hostNavigate.mock.calls).toEqual([["/channel-inventory?ciTab=materials"]]);
    expect(window.location.pathname).toBe("/workbench/channel-inventory");
    expect(window.location.search).toBe("?ciTab=materials");
    expect(runtime.inputs.at(-1)).toMatchObject({ ...context, uploadBatchId: 81, page: 1 });
    expect(required(document.querySelector<HTMLInputElement>('[aria-label="筛选上传批次 ID"]')).value).toBe("81");
    expect(required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')).disabled).toBe(true);
    renderHost(); await settle(); expect(hostNavigate).toHaveBeenCalledTimes(1);
  });

  it("an internal same-target view action does not push again or lose the newly opened upload", async () => {
    selectHostTab("materials"); renderHost(); click(button("上传库存")); await settle();
    expect(document.querySelector('[aria-label="上传库存表格"]')).not.toBeNull();
    expect(hostNavigate).not.toHaveBeenCalled();
  });

  it("generic channel view synchronizes materials but never invents a supply target or source grant", async () => {
    selectHostTab("channels"); renderHost();
    const trigger = required(document.querySelector<HTMLElement>('.ci-channel-table [data-slot="dropdown-menu-trigger"]'));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    click(required(Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === "查看库存"))); await settle();
    assertView("materials"); expect(hostNavigate.mock.calls).toEqual([["/channel-inventory?ciTab=materials"]]);
    expect(window.location.search).not.toContain("supply");
    expect(runtime.inputs.at(-1)).toMatchObject({ ...context, channelId: undefined });
    expect(runtime.client.getChannel.query).not.toHaveBeenCalled();
    expect(runtime.client.listTeamSourceOptions.query).not.toHaveBeenCalled();
  });

  it("returning from a generic ciTab to an exact supply URL retains strict server target proof without generic navigation", async () => {
    selectHostTab("trash"); renderHost(); await settle();
    setHostTestLocation("/workbench/channel-inventory?supplyChannelId=11&supplyTab=channels"); await settle();
    assertView("channels"); expect(document.querySelector('.ci-supply-target')?.getAttribute("data-channel-id")).toBe("11");
    expect(runtime.client.getChannel.query).toHaveBeenCalledWith({ ...context, id: 11 }, { signal: expect.any(AbortSignal) });
    expect(runtime.channelInputs).toHaveLength(0); expect(hostNavigate).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?supplyChannelId=11&supplyTab=channels");
  });

  it("legacy supply view uses the original relative bridge and independent source proof, without writing ciTab", async () => {
    setHostTestLocation("/workbench/channel-inventory?supplyChannelId=11&supplyTab=channels", "replace"); renderHost(); await settle();
    const trigger = required(document.querySelector<HTMLElement>('.ci-channel-table [data-slot="dropdown-menu-trigger"]'));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    click(required(Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === "查看库存"))); await settle();
    expect(hostNavigate.mock.calls).toEqual([["/channel-inventory?supplyChannelId=11&supplyTab=materials"]]);
    expect(window.location.search).not.toContain("ciTab");
    expect(runtime.client.listTeamMaterials.query).toHaveBeenCalledWith({ ...context, channelId: 11, page: 1, pageSize: 1 }, { signal: expect.any(AbortSignal) });
    // Generic team result denies source identity; precise proof must still fail closed.
    expect(document.body.textContent).toContain("来源权限已改变");
    expect(document.querySelector('.ci-stock-edit-table tbody')?.textContent).not.toContain("NAV-ONE");
  });

  it("invalid legacy supply parameters remain errors rather than falling back to generic channels", async () => {
    selectHostTab("batches"); renderHost(); await settle();
    setHostTestLocation("/workbench/channel-inventory?supplyChannelId=not-an-id&supplyTab=materials"); await settle();
    expect(document.body.textContent).toContain("库存跳转参数无效");
    expect(document.querySelector('.ci-channel-table tbody')?.textContent).not.toContain("授权渠道");
    expect(runtime.client.getChannel.query).not.toHaveBeenCalled();
    expect(runtime.channelInputs).toHaveLength(0); expect(hostNavigate).not.toHaveBeenCalled();
  });

  it("generic tab intent cannot grant native read authorization", async () => {
    runtime.scope.officialInventoryPermissions.read = false; selectHostTab("trash"); renderHost(); await settle();
    expect(document.body.textContent).toContain("没有渠道库存查看权限");
    expect(runtime.inputs).toHaveLength(0); expect(runtime.client.listDeletedMaterials.query).not.toHaveBeenCalled();
  });
});

describe("URL-selected Host deletion/restore retains real management bridge", () => {
  it("deletes with original CAS and identity, then restores via the real trash clientquery and CAS", async () => {
    renderHost(); selectCurrentPageForDeletion(); click(button("批量删除"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("NAV-ONE");
    click(button("移入回收站 1 条")); await settle();
    expect(runtime.client.deleteMaterials.mutate).toHaveBeenCalledWith({ ...context, items: [{ id: 1, expectedRevision: 4 }], requestId: expect.any(String) });
    selectHostTab("trash"); await settle(); click(button("恢复"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("DELETED-NAV-ONE");
    click(button("确认恢复")); await settle();
    expect(runtime.client.listDeletedMaterials.query).toHaveBeenCalledWith({ ...context, page: 1, pageSize: 20 }, { signal: expect.any(AbortSignal) });
    expect(runtime.client.restoreMaterial.mutate).toHaveBeenCalledWith({ ...context, id: 1, expectedRevision: 8, requestId: expect.any(String) });
    expect(hostNavigate).not.toHaveBeenCalled();
  });

  it.each(["native", "server", "row", "list"])("URL-selected trash respects %s write denial", async denial => {
    if (denial === "native") runtime.scope.officialInventoryPermissions.write = false;
    if (denial === "server") teamWrite(false);
    if (denial === "row") runtime.client.listDeletedMaterials.query.mockResolvedValue(page([{ ...deleted, canRestore: false }], { canWrite: true }));
    if (denial === "list") runtime.client.listDeletedMaterials.query.mockResolvedValue(page([deleted], { canWrite: false, readOnly: true }));
    renderHost(); if (denial === "native" || denial === "server") expect(document.querySelector('[aria-label="全选当前页可删除库存"]')).toBeNull();
    selectHostTab("trash"); await settle();
    expect(document.querySelector('.ci-trash-table')?.textContent).toContain("DELETED-NAV-ONE");
    expect(Array.from(document.querySelectorAll("button")).find(item => item.textContent === "恢复")).toBeUndefined();
    expect(runtime.client.restoreMaterial.mutate).not.toHaveBeenCalled(); expect(runtime.client.deleteMaterials.mutate).not.toHaveBeenCalled();
  });

  it("URL tab change closes delete confirmation and native revocation closes restore confirmation before write", async () => {
    renderHost(); selectCurrentPageForDeletion(); click(button("批量删除"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    selectHostTab("trash"); await settle(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(button("恢复")); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    runtime.scope.officialInventoryPermissions.write = false; renderHost(); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.client.restoreMaterial.mutate).not.toHaveBeenCalled(); expect(runtime.client.deleteMaterials.mutate).not.toHaveBeenCalled();
  });
});
