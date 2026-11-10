// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS_INDUSTRY_OPTIONS } from "../../../shared/businessIndustry";
vi.mock("wouter", async importOriginal => ({ ...await importOriginal<typeof import("wouter")>(), ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks }));
const runtime = vi.hoisted(() => {
  const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue(undefined) });
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const sources = { items: [{ id: 11, name: "授权渠道", canViewSource: true }], canFilterSource: true };
  const channelResult = { items: [{ id: 11, name: "授权渠道", enterpriseId: 31, active: true, canEdit: true, readOnly: false, type: "factory", revision: 1 }], total: 1, page: 1, pageSize: 100, pageCount: 1, canWrite: true };
  return { query, invalidate, inputs: [] as Record<string, unknown>[], denied: false, loading: false,
    scope: { officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: "native-v1" }, storageScope: "scope-31", frontUser: { role: "user" }, contextVerification: { state: "verified", identity: "scope-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    channels: channelResult,
    utils: { client: { channelInventory: { listChannels: { query: vi.fn().mockResolvedValue(channelResult) }, listTeamSourceOptions: { query: vi.fn().mockResolvedValue(sources) } } }, channelInventory: { listChannels: { invalidate }, listTeamMaterials: { invalidate }, listTeamSourceOptions: { invalidate }, notesList: { invalidate }, collaborationNotesList: { invalidate } } },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils, enterprise: { me: { useQuery: () => runtime.query({ enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: true }) } }, channelInventory: {
    listChannels: { useQuery: () => runtime.query(runtime.channels) },
    listTeamMaterials: { useQuery: (input: Record<string, unknown>, options?: { enabled?: boolean }) => {
      if (options?.enabled) runtime.inputs.push(input);
      if (runtime.loading) return { data: undefined, isLoading: true, isFetching: true, isError: false, refetch: vi.fn() };
      return { ...runtime.query({ items: [
        { id: 1, revision: 1, partNumber: "SERVER-FIRST", brand: "TI", qty: null, industryCode: null, dateCode: null, price: null, taxIncluded: null, leadTime: null, updatedAt: "2026-11-04", canEdit: false, readOnly: true, canViewSource: true, isMine: false, noteCount: 0 },
        { id: 2, revision: 1, partNumber: "SERVER-SECOND", brand: "TI", qty: 100, industryCode: "automotive", dateCode: null, price: null, taxIncluded: null, leadTime: null, updatedAt: "2026-11-04", canEdit: false, readOnly: true, canViewSource: true, isMine: false, noteCount: 0 },
      ], total: 45, page: input.page, pageSize: 20, pageCount: 3, canWrite: false, canFilterSource: true }), isError: runtime.denied };
    } },
    ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: vi.fn() }) }])),
  },
} }));
import ChannelInventoryHost from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function setControl(label: string, value: string) {
  const el = required(container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`));
  act(() => { Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
beforeEach(() => {
  vi.clearAllMocks(); runtime.inputs = []; runtime.denied = false; runtime.loading = false; runtime.scope.officialInventoryPermissions.read = true;
  window.history.replaceState({}, "", "/channel-inventory"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root.render(React.createElement(ChannelInventoryHost)));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production network forbidden in filter fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("approved channel inventory filters and compact header (real component, mock transport)", () => {
  it("keeps title/uploads in the header and views after selection before inventory count in the filter row", () => {
    const header = required(container.querySelector(".ci-tabbar"));
    expect(header.querySelector("h1")?.textContent).toBe("渠道库存");
    for (const name of ["上传库存", "单条上传"]) expect(header.contains(button(name))).toBe(true);
    const toolbar = required(container.querySelector('.ci-toolbar[aria-label="材料筛选"]'));
    const views = required(toolbar.querySelector(".ci-inventory-view-controls"));
    for (const name of ["平铺查看", "按渠道查看"]) { expect(header.contains(button(name))).toBe(false); expect(views.contains(button(name))).toBe(true); }
    expect(views.nextElementSibling?.className).toBe("ci-filter-count");
    // This transport fixture is readonly, so the original selection permission guard omits Select.
    expect(views.previousElementSibling?.textContent).toBe("刷新");
    expect(container.querySelector(".ci-toolbar.ci-inventory-view-controls")).toBeNull();
    expect(header.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).find(item => item.textContent === "重置")).toBeUndefined();
    if (process.env.CHANNEL_GEOMETRY_DOM) writeFileSync(process.env.CHANNEL_GEOMETRY_DOM, container.innerHTML);
  });
  it("keeps the same view switch visible on the channel list and selected channel and returns to flat inventory", async () => {
    click(button("按渠道查看")); await settle();
    const views = required(container.querySelector('.ci-toolbar[aria-label="材料筛选"] .ci-inventory-view-controls'));
    expect(button("按渠道查看").getAttribute("aria-pressed")).toBe("true");
    expect(views.contains(button("平铺查看"))).toBe(true);
    click(button("查看该渠道库存")); await settle();
    expect(container.querySelector(".ci-supply-location")?.textContent).toContain("授权渠道");
    click(button("平铺查看")); await settle();
    expect(button("平铺查看").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".ci-supply-location")).toBeNull();
    expect(runtime.inputs.at(-1)).toMatchObject({ channelId: undefined, page: 1 });
    expect(container.querySelector("tbody")?.textContent).toContain("SERVER-FIRST");
  });
  it("lists exactly the customer industry enumeration plus all and unset", () => {
    const select = required(container.querySelector<HTMLSelectElement>('[aria-label="筛选库存行业"]'));
    expect(Array.from(select.options).map(option => ({ value: option.value, label: option.text }))).toEqual([{ value: "all", label: "全部行业" }, ...BUSINESS_INDUSTRY_OPTIONS, { value: "unset", label: "未设置" }]);
  });
  it("keeps drafts out of applied search, then intersects all filters on Confirm and returns to page one", async () => {
    click(button("下一页"));
    setControl("筛选库存型号", " ＡＢＣ "); setControl("筛选库存品牌", " TI "); setControl("筛选上传批次 ID", "81");
    const source = required(container.querySelector('[aria-label="筛选库存渠道来源"]'));
    act(() => source.dispatchEvent(new Event("pointerdown", { bubbles: true }))); await settle(); setControl("筛选库存渠道来源", "11");
    setControl("筛选库存行业", "automotive");
    expect(runtime.inputs.at(-1)).toMatchObject({ industryCode: undefined, partNumber: undefined, brand: undefined, uploadBatchId: undefined, channelId: undefined, page: 2 });
    click(button("确定"));
    expect(runtime.inputs.at(-1)).toMatchObject({ industryCode: "automotive", partNumber: "ABC", brand: "TI", uploadBatchId: 81, channelId: 11, page: 1, pageSize: 20 });
    setControl("筛选库存行业", "unset"); click(button("确定")); expect(runtime.inputs.at(-1)).toMatchObject({ industryCode: "unset", channelId: 11, uploadBatchId: 81 });
    setControl("筛选库存行业", "all"); click(button("确定")); expect(runtime.inputs.at(-1)?.industryCode).toBeUndefined();
  });
  it("applies input Enter but ignores composition Enter", () => {
    click(button("下一页")); setControl("筛选库存型号", "ENTER-MODEL");
    const model = required(container.querySelector('[aria-label="筛选库存型号"]'));
    act(() => model.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    expect(runtime.inputs.at(-1)).toMatchObject({ partNumber: undefined, page: 2 });
    act(() => model.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(runtime.inputs.at(-1)).toMatchObject({ partNumber: "ENTER-MODEL", page: 1 });
  });
  it("paginates, sorts and refreshes applied filters while retaining unapplied drafts", async () => {
    setControl("筛选库存品牌", "APPLIED"); click(button("确定"));
    setControl("筛选库存品牌", "DRAFT"); click(button("下一页"));
    expect(runtime.inputs.at(-1)).toMatchObject({ brand: "APPLIED", page: 2 });
    click(required(container.querySelector('[aria-label="按可供数量排序"]')));
    expect(runtime.inputs.at(-1)).toMatchObject({ brand: "APPLIED", sortBy: "qty", sortDirection: "desc", page: 1 });
    click(button("刷新")); await settle(); expect(runtime.invalidate).toHaveBeenCalled();
    act(() => root.render(React.createElement(ChannelInventoryHost)));
    expect(runtime.inputs.at(-1)?.brand).toBe("APPLIED"); expect(required(container.querySelector<HTMLInputElement>('[aria-label="筛选库存品牌"]')).value).toBe("DRAFT");
  });
  it("does not suppress applied data for an invalid batch draft until Confirm", () => {
    setControl("筛选上传批次 ID", "invalid"); expect(container.querySelector("tbody")?.textContent).toContain("SERVER-FIRST");
    click(button("确定")); expect(container.querySelector("tbody")?.textContent).not.toContain("SERVER-FIRST");
    expect(container.textContent).toContain("上传批次 ID 须为正整数");
  });
  it("retains totals for applied pagination and drafts but clears them on a confirmed new loading scope", () => {
    click(button("下一页")); runtime.loading = true; act(() => root.render(React.createElement(ChannelInventoryHost)));
    expect(container.querySelector(".ci-filter-count")?.textContent).toBe("45 条库存");
    setControl("筛选库存行业", "automotive"); expect(container.querySelector(".ci-filter-count")?.textContent).toBe("45 条库存");
    click(button("确定")); expect(container.querySelector(".ci-filter-count")?.textContent).toBe("正在读取库存条数…");
    expect(container.querySelector("tbody")?.textContent).not.toContain("SERVER-FIRST");
    expect(runtime.inputs.at(-1)).toMatchObject({ industryCode: "automotive", page: 1 });
  });
  it("always shows both quantity arrows and cycles desc, asc, default without locally sorting returned rows", () => {
    const sort = required(container.querySelector('[aria-label="按可供数量排序"]'));
    expect(sort.querySelectorAll("svg path")).toHaveLength(2); expect(sort.querySelectorAll(".ci-sort-active")).toHaveLength(0);
    click(button("下一页")); click(sort);
    expect(runtime.inputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "desc", page: 1 });
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending"); expect(sort.querySelectorAll(".ci-sort-active")).toHaveLength(1); expect(sort.getAttribute("title")).toContain("点击数量从少到多");
    expect(container.querySelector(".ci-sort-status")?.textContent).toContain("数量从多到少"); expect(container.querySelector("tbody tr")?.textContent).toContain("SERVER-FIRST");
    click(sort); expect(runtime.inputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "asc", page: 1 }); expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    click(sort); expect(runtime.inputs.at(-1)).toMatchObject({ sortBy: undefined, sortDirection: undefined, page: 1 }); expect(sort.querySelectorAll("svg path")).toHaveLength(2); expect(sort.querySelectorAll(".ci-sort-active")).toHaveLength(0);
  });
  it("uses the same confirmed industry and quantity API inside a server-readable channel", async () => {
    click(button("按渠道查看")); await settle(); click(button("查看该渠道库存"));
    setControl("筛选库存行业", "unset"); click(button("确定")); click(required(container.querySelector('[aria-label="按可供数量排序"]')));
    expect(runtime.inputs.at(-1)).toMatchObject({ channelId: 11, industryCode: "unset", sortBy: "qty", sortDirection: "desc", page: 1 });
    expect(required(container.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')).disabled).toBe(true);
  });
  it("clears current rows on read denial and never treats a draft as authority", () => {
    setControl("筛选库存行业", "automotive"); runtime.denied = true; act(() => root.render(React.createElement(ChannelInventoryHost)));
    expect(container.querySelector("tbody")?.textContent).not.toContain("SERVER-FIRST");
  });
});
