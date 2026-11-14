// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { sharedMaterialFrom } from "../../../front-router-types/server/services/channelInventoryNotes";
import type { Pool } from "mysql2/promise";
import { CHANNEL_INVENTORY_COLUMNS, DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnsStorageKey, normalizeChannelInventoryColumns, readChannelInventoryColumns, saveChannelInventoryColumns, channelInventoryColumnLayout } from "./channelInventoryColumns";
// Exercise only the original pure DTO projection; authorization/DB are outside this test.
vi.mock("../../../front-router-types/server/services/channelInventory", () => ({ resolveChannelInventoryAuthority: vi.fn(), ChannelInventoryError: class extends Error {} }));
vi.mock("../../../front-router-types/server/services/businessModuleAccess", () => ({ resolveBusinessModuleAccess: vi.fn() }));
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    scope: { storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      officialInventoryPermissions: { read: true, write: true, note: true, publish: false, authorizationVersion: "native-v1" },
      contextVerification: { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    enterprise: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: true },
    loading: false, error: false, rows: [] as Record<string, unknown>[], inputs: [] as Record<string, unknown>[],
    utils: { client: { channelInventory: {} }, channelInventory: Object.fromEntries(["listTeamMaterials", "listTeamSourceOptions", "listChannels", "notesList", "collaborationNotesList"].map(name => [name, { invalidate }])) },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils,
  enterprise: { me: { useQuery: () => ({ data: runtime.enterprise, isLoading: false, isError: false }) } },
  channelInventory: {
    listChannels: { useQuery: () => ({ data: { items: [], total: 0, pageCount: 1 }, isLoading: false, isError: false }) },
    listTeamMaterials: { useQuery: (input: Record<string, unknown>) => {
      runtime.inputs.push(input);
      return { data: { items: runtime.rows, total: 40, page: input.page, pageSize: 20, pageCount: 2, canWrite: true, canFilterSource: false }, isLoading: runtime.loading, isError: runtime.error, error: new Error("synthetic error") };
    } },
    ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: vi.fn() }) }])),
  },
} }));
import ChannelInventoryHost, { channelInventoryUpdatedAt } from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
function renderHost() { act(() => root.render(React.createElement(ChannelInventoryHost))); }
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing inventory fixture element"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function option(label: string) { return required(Array.from(document.querySelectorAll<HTMLLabelElement>(".ci-columns-options label")).find(item => item.querySelector("span")?.firstChild?.textContent === label)?.querySelector<HTMLInputElement>("input")); }
function headers() { return Array.from(document.querySelectorAll(".ci-compact-stock-table thead th")).map(cell => cell.textContent); }
function firstCell(selector: string) { return required(document.querySelector<HTMLElement>(`.ci-compact-stock-table tbody tr ${selector}`)); }
function assertAligned() {
  const count = headers().length;
  expect(document.querySelectorAll(".ci-compact-stock-table col")).toHaveLength(count);
  for (const row of document.querySelectorAll(".ci-compact-stock-table tbody tr")) {
    if (row.querySelector(".ci-empty")) expect(row.querySelector("td")?.colSpan).toBe(count);
    else expect(row.querySelectorAll("td")).toHaveLength(count);
  }
}
function setIdentity(actor: number, enterprise: number, updateSummary = true) {
  runtime.scope.frontUser.id = actor; runtime.scope.staffPrincipal = { frontendUserId: actor, enterpriseId: enterprise };
  runtime.scope.storageScope = `scope-${actor}-${enterprise}`;
  runtime.scope.contextVerification.identity = runtime.scope.storageScope;
  if (updateSummary) runtime.enterprise = { ...runtime.enterprise, enterprise: { id: enterprise }, currentUserId: actor };
  renderHost();
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  runtime.scope.frontUser.id = 7; runtime.scope.staffPrincipal = { frontendUserId: 7, enterpriseId: 31 };
  runtime.scope.storageScope = "scope-7-31"; runtime.scope.contextVerification = { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" };
  runtime.enterprise = { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], isOwner: true };
  runtime.loading = false; runtime.error = false; runtime.inputs = [];
  runtime.rows = [{ id: 1, revision: 4, partNumber: "LONG-PART-".repeat(20), brand: "TI", qty: 9, dateCode: "  ORIGINAL DC: English / 24+  ", price: "0", taxIncluded: false, leadTime: "现货", industryCode: null,
    updatedAt: "2026-11-10 12:34:56.123", canDelete: true, canEdit: true, readOnly: false, canViewSource: false, isMine: true, noteCount: 0, originalRecorderName: "原负责人" }];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network in isolated column fixtures"); }));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("real inventory timestamp wire contract", () => {
  it("reproduces Drizzle raw typeCast -> original shared DTO -> internal superjson JSON -> manager JSON-only unwrapping", async () => {
    const literal = "2026-11-10 12:34:56.123";
    const query = vi.fn(async (options: { typeCast: (field: unknown, next: () => unknown) => unknown }) => [[{ currency: "CNY", id: 1, partNumber: "A", brand: "TI", revision: 1,
      updatedAt: options.typeCast({ type: "DATETIME", string: () => literal }, () => { throw new Error("Must retain SQL literal"); }) }], []]);
    // Promise-client stub only; no connection, credentials or real database.
    const db = drizzle({ client: { query } as unknown as Pool });
    const result = await db.execute(sql`SELECT m.updated_at AS updatedAt FROM channel_inventory_materials m`);
    const dto = sharedMaterialFrom((result[0] as Record<string, unknown>[])[0]);
    const wire = JSON.parse(JSON.stringify([{ result: { data: superjson.serialize({ items: [dto] }) } }]));
    const managerResult = wire[0].result.data.json;
    expect(managerResult.items[0].updatedAt).toBe(literal);
    expect(channelInventoryUpdatedAt(managerResult.items[0].updatedAt, new Date("2026-11-10T00:00:00Z")))
      .toEqual({ compact: "11-10 12:34", full: "2026-11-10 12:34:56（北京时间）" });
    const dateWire = JSON.parse(JSON.stringify(superjson.serialize({ updatedAt: new Date("2026-11-10T04:34:56Z") }))).json;
    expect(channelInventoryUpdatedAt(dateWire.updatedAt, new Date("2026-11-10T00:00:00Z"))).toEqual(channelInventoryUpdatedAt(literal, new Date("2026-11-10T00:00:00Z")));
  });
  it.each(["UTC", "America/Los_Angeles", "Asia/Shanghai"])("interprets proven SQL literals and explicit instants independently of %s", timezone => {
    const previous = process.env.TZ; process.env.TZ = timezone;
    try {
      const now = new Date("2026-11-10T00:00:00Z");
      for (const value of ["2026-11-10 12:34:56", "2026-11-10T12:34:56.123456", "2026-11-10T04:34:56Z", "2026-11-10T12:34:56+08:00", new Date("2026-11-10T04:34:56Z")])
        expect(channelInventoryUpdatedAt(value, now)).toEqual({ compact: "11-10 12:34", full: "2026-11-10 12:34:56（北京时间）" });
      expect(channelInventoryUpdatedAt("2025-12-31 23:59:59", new Date("2025-12-31T16:00:00Z"))?.compact).toBe("2025-12-31 23:59");
      expect(channelInventoryUpdatedAt("2026-01-01 00:00:01", new Date("2025-12-31T16:00:00Z"))?.compact).toBe("01-01 00:00");
      expect(channelInventoryUpdatedAt("2024-02-29 01:02:03", now)?.compact).toBe("2024-02-29 01:02");
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("rejects ambiguous, absent and invalid values without DC/current-time substitution", () => {
    const invalid = [null, undefined, "", " ", "DC2026", new Date(NaN), "2026-11-10", "2026-11-10 12:34", "2026/11/10 12:34:56", " 2026-11-10 12:34:56", "2026-11-10 12:34:56\n", "2026-02-30 12:34:56", "2026-02-29T00:00:00", "1900-02-29 01:02:03", "0000-01-01 00:00:00", "2026-01-01 24:00:00", "2026-11-10 12:60:00", "2026-11-10 12:34:60", "2026-11-10 12:34:56.1234567", "2026-11-10T00:00:00+24:00", "2026-11-10T00:00:00+08:60", "2026-11-10T00:00:00Z "];
    for (const value of invalid) {
      expect(channelInventoryUpdatedAt(value)).toBeNull();
      runtime.rows[0].updatedAt = value; renderHost();
      expect(firstCell("td.ci-material-date-col").textContent).toBe("");
      expect(firstCell("td.ci-material-date-col").querySelector("time, [role=button]")).toBeNull();
    }
  });
});

describe("inventory column preference and geometry", () => {
  it("defaults, fixed columns and normalization are bounded to this page and real actor/enterprise", () => {
    expect(DEFAULT_CHANNEL_INVENTORY_COLUMNS).toEqual(["partNumber", "brand", "recorder", "qty", "price", "refLcsc", "refIckey", "leadTime", "updatedAt", "source", "actions"]);
    expect(normalizeChannelInventoryColumns(["dateCode", "unknown", "dateCode"])).toEqual(["partNumber", "dateCode", "actions"]);
    expect(normalizeChannelInventoryColumns({ brand: false })).toEqual(DEFAULT_CHANNEL_INVENTORY_COLUMNS);
    for (const [actor, enterprise] of [[undefined, 31], [0, 31], [7, -1], [7, NaN]]) expect(channelInventoryColumnsStorageKey(actor, enterprise)).toBeNull();
    expect(channelInventoryColumnsStorageKey(7, 31)).not.toBe(channelInventoryColumnsStorageKey(8, 31));
    expect(channelInventoryColumnsStorageKey(7, 31)).not.toBe(channelInventoryColumnsStorageKey(7, 32));
  });
  it("migrates a v1 preference once, preserves all previous hidden columns and never reopens a later hidden reference", () => {
    const key = required(channelInventoryColumnsStorageKey(7, 31));
    expect(key).toContain("inventory-columns:v2:");
    const old = key.replace("inventory-columns:v2:", "inventory-columns:v1:");
    localStorage.setItem(old, JSON.stringify(["partNumber", "dateCode", "actions"]));
    expect(readChannelInventoryColumns(key)).toEqual(["partNumber", "refLcsc", "refIckey", "dateCode", "actions"]);
    expect(JSON.parse(localStorage.getItem(old)!)).toEqual(["partNumber", "dateCode", "actions"]);
    saveChannelInventoryColumns(key, ["partNumber", "dateCode", "actions"]);
    expect(readChannelInventoryColumns(key)).toEqual(["partNumber", "dateCode", "actions"]);
    renderHost(); expect(headers()).toEqual(["型号", "DC", "操作"]);
  });
  it("accounts for every visible subset and the non-hideable selection width without percentages", () => {
    const optional = CHANNEL_INVENTORY_COLUMNS.filter(column => !("fixed" in column));
    for (let mask = 0; mask < 1 << optional.length; mask++) {
      const ids = normalizeChannelInventoryColumns(optional.filter((_, index) => mask & (1 << index)).map(column => column.id));
      for (const selection of [false, true]) {
        const layout = channelInventoryColumnLayout(ids, selection);
        expect(layout.count).toBe(ids.length + Number(selection));
        expect(layout.minWidth).toBe(layout.visible.reduce((sum, column) => sum + column.width, selection ? 40 : 0));
        expect(layout.visible.filter(column => column.id === "partNumber")).toHaveLength(1);
      }
    }
  });
  it("renders defaults, synchronizes toggle/restore with cells/colgroup/empty/loading/error and keeps selection", () => {
    renderHost(); expect(headers()).toEqual(["型号", "品牌", "负责人", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]); assertAligned();
    click(button("显示列")); expect(option("型号").disabled).toBe(true); expect(option("操作").disabled).toBe(true);
    click(option("DC")); click(option("序号")); click(option("所属行业")); click(option("品牌")); assertAligned();
    expect(firstCell("td.ci-material-dc-col").textContent).toBe(runtime.rows[0].dateCode);
    expect(document.querySelector("td.ci-material-brand-col")).toBeNull();
    expect(document.querySelector<HTMLTableColElement>('col[data-column="partNumber"]')?.style.width).toBe("220px");
    expect(document.querySelector<HTMLTableColElement>('col[data-column="updatedAt"]')?.style.width).toBe("148px");
    click(button("恢复默认")); assertAligned(); expect(headers()).toHaveLength(11);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    click(button("批量操作")); click(required(document.querySelector('[aria-label="全选当前页可删除库存"]')));
    expect(document.querySelector('[aria-label="当前页批量删除"]')?.textContent).toContain("已选 1 条");
    click(button("显示列")); click(option("数量"));
    expect(document.querySelector('[aria-label="当前页批量删除"]')?.textContent).toContain("已选 1 条");
    expect(document.querySelectorAll(".ci-selection-col")).toHaveLength(2); assertAligned();
    runtime.rows = []; renderHost(); assertAligned(); expect(document.querySelector("thead .ci-selection-col input")?.hasAttribute("disabled")).toBe(true);
    runtime.loading = true; renderHost(); assertAligned(); runtime.loading = false; runtime.error = true; renderHost(); assertAligned();
  });
  it("loads only verified matching identities, does not overwrite saved preferences on first render or leak across actor/enterprise switches", () => {
    const keyA = required(channelInventoryColumnsStorageKey(7, 31)), keyB = required(channelInventoryColumnsStorageKey(8, 31)), keyC = required(channelInventoryColumnsStorageKey(8, 32));
    localStorage.setItem(keyA, JSON.stringify(["partNumber", "dateCode", "actions"]));
    localStorage.setItem(keyB, JSON.stringify(["partNumber", "brand", "actions"]));
    localStorage.setItem(keyC, JSON.stringify(["partNumber", "qty", "actions"]));
    const get = vi.spyOn(Storage.prototype, "getItem"), set = vi.spyOn(Storage.prototype, "setItem");
    runtime.scope.contextVerification.state = "revalidating"; renderHost();
    expect(get).not.toHaveBeenCalled(); expect(button("显示列").disabled).toBe(true); expect(headers()).toHaveLength(11);
    runtime.scope.contextVerification.state = "verified"; renderHost();
    expect(headers()).toEqual(["型号", "DC", "操作"]); expect(set).not.toHaveBeenCalled();
    click(button("显示列")); setIdentity(8, 31, false);
    expect(document.querySelector(".ci-columns-popover")).toBeNull(); expect(headers()).toHaveLength(11); expect(get).not.toHaveBeenCalledWith(keyB);
    runtime.enterprise.currentUserId = 8; renderHost(); expect(headers()).toEqual(["型号", "品牌", "操作"]);
    setIdentity(8, 32, false); expect(headers()).toHaveLength(11); expect(get).not.toHaveBeenCalledWith(keyC);
    runtime.enterprise.enterprise.id = 32; renderHost(); expect(headers()).toEqual(["型号", "可供数量", "操作"]);
    click(button("显示列")); click(option("DC")); expect(set).toHaveBeenLastCalledWith(keyC, JSON.stringify(["partNumber", "qty", "dateCode", "actions"]));
    setIdentity(7, 31); expect(headers()).toEqual(["型号", "DC", "操作"]);
    expect(JSON.parse(localStorage.getItem(keyA)!)).toEqual(["partNumber", "dateCode", "actions"]);
  });
  it("handles malformed, blocked getters, quota failures and still uses in-memory toggles", () => {
    const key = required(channelInventoryColumnsStorageKey(7, 31)); localStorage.setItem(key, "bad-json"); expect(readChannelInventoryColumns(key)).toEqual(DEFAULT_CHANNEL_INVENTORY_COLUMNS);
    const get = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("storage blocked"); });
    expect(readChannelInventoryColumns(key)).toEqual(DEFAULT_CHANNEL_INVENTORY_COLUMNS); expect(() => saveChannelInventoryColumns(key, [])).not.toThrow();
    renderHost(); click(button("显示列")); click(option("DC")); expect(headers()).toContain("DC"); get.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    click(option("品牌")); expect(headers()).not.toContain("品牌"); click(button("恢复默认")); expect(headers()).toHaveLength(11);
  });
  it("retains full DC/model/time Portals and closes on column/scope changes without altering sort/page/batch inputs", () => {
    renderHost(); click(button("显示列")); click(option("DC"));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const dc = firstCell(".ci-dc-trigger"); click(dc);
    expect(document.querySelector('[role=tooltip][aria-label="完整 DC"]')?.textContent).toBe(runtime.rows[0].dateCode);
    const time = firstCell(".ci-updated-at-trigger"); click(time);
    expect(document.querySelector(".ci-updated-at-popover")?.textContent).toBe("2026-11-10 12:34:56（北京时间）");
    expect(firstCell("time").getAttribute("datetime")).toBe("2026-11-10T12:34:56+08:00");
    click(button("显示列")); click(option("品牌")); expect(document.querySelector(".ci-updated-at-popover")).toBeNull();
    expect(firstCell(".ci-part-number-text").getAttribute("aria-label")).toBe(runtime.rows[0].partNumber);
    expect(firstCell(".ci-part-copy-button").getAttribute("aria-label")).toBe(`复制完整型号：${runtime.rows[0].partNumber}`);
    expect(document.querySelector('[aria-label="完整型号"]')).toBeNull();
    setIdentity(8, 31); expect(document.querySelector('[role=tooltip]')).toBeNull();
    click(button("显示列")); click(option("DC")); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    click(required(document.querySelector('[aria-label="按 Date Code 排序"]'))); expect(runtime.inputs.at(-1)).toMatchObject({ sortBy: "dateCode", sortDirection: "asc", page: 1 });
    click(button("下一页")); expect(runtime.inputs.at(-1)).toMatchObject({ page: 2, sortBy: "dateCode" });
    click(button("显示列")); click(option("DC")); expect(runtime.inputs.at(-1)).toMatchObject({ page: 2, sortBy: "dateCode" });
  });
  it("keeps the flat table budget and colgroup content-independent across page 1/2 while the footer stays outside the scroller", () => {
    renderHost();
    const widths = () => [...document.querySelectorAll<HTMLTableColElement>(".ci-compact-stock-table col")].map(col => col.style.width);
    const budget = () => required(document.querySelector<HTMLTableElement>(".ci-compact-stock-table")).style.getPropertyValue("--ci-stock-min-width");
    const firstWidths = widths(), firstBudget = budget();
    expect(firstWidths.every(Boolean)).toBe(true);
    expect(document.querySelector(".ci-flat-view")).not.toBeNull();
    expect(document.querySelector(".ci-tablewrap .ci-pagination")).toBeNull();
    expect(document.querySelector(".ci-pagination")?.previousElementSibling?.classList.contains("ci-tablewrap")).toBe(true);
    click(button("2"));
    runtime.rows[0] = { ...runtime.rows[0], id: 21, partNumber: "Short/Exact-Suffix", brand: "A".repeat(400), originalRecorderName: "负责人".repeat(100) };
    renderHost(); expect(runtime.inputs.at(-1)).toMatchObject({ page: 2, pageSize: 20, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(widths()).toEqual(firstWidths); expect(budget()).toBe(firstBudget);
    expect(document.querySelector('.ci-pagination [aria-current="page"]')?.textContent).toBe("2");
    expect(firstCell(".ci-part-number-text").textContent).toBe("Short/Exact-Suffix");
    runtime.loading = true; renderHost(); expect(widths()).toEqual(firstWidths); expect(budget()).toBe(firstBudget);
  });
});


it("shows only permitted source entries and never projects company names from the global list DTO", () => {
  runtime.rows = [
    { ...runtime.rows[0], id: 1, canViewSource: true, company: { id: 801, name: "已确认供货公司甲" } },
    { ...runtime.rows[0], id: 2, canViewSource: false, company: { id: 802, name: "已确认供货公司乙" }, channelName: "不能猜为所属公司的私有来源" },
    { ...runtime.rows[0], id: 3, canViewSource: undefined, company: null, channelName: "不能猜为所属公司的私有来源" },
  ];
  renderHost();
  expect(headers()).toContain("渠道来源");
  const sourceCells = [...document.querySelectorAll("tbody .ci-material-source-col")];
  expect(sourceCells.map(cell => cell.querySelector(".ci-source-link")?.textContent ?? "")).toEqual(["查看来源", "", ""]);
  expect(document.querySelectorAll(".ci-inventory-company, .ci-source-link-muted")).toHaveLength(0);
  expect(document.body.innerHTML).not.toContain("已确认供货公司甲");
  expect(document.body.innerHTML).not.toContain("已确认供货公司乙");
  expect(document.querySelector("thead")?.textContent).not.toContain("所属公司");
  expect(runtime.inputs.at(-1)?.customerId).toBeUndefined();
  expect(runtime.inputs.at(-1)?.channelId).toBeUndefined();
  expect(document.body.textContent).not.toContain("不能猜为所属公司的私有来源");
  assertAligned();
});
