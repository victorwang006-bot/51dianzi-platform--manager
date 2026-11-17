// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => ({
  provider: true, loading: false, fetching: false, error: false, placeholder: false, success: true,
  enterpriseFetching: false, enterpriseError: false, enterpriseSuccess: true, wrongPage: false,
  scope: { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
    officialInventoryPermissions: { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" },
    contextVerification: { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
  enterprise: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false },
  useRows: vi.fn(), rows: new Map<string, HTMLElement>(), mutation: vi.fn(), inputs: [] as Record<string, unknown>[],
  invalidate: vi.fn(), refetch: vi.fn(),
}));
vi.mock("../../../../../lib/adminNewInformation", () => ({
  useAdminNewInformationContext: () => {
    if (!runtime.provider) throw new Error("新信息组件须在 AdminNewInformationProvider 内使用");
    return { accountKey: 44 };
  },
  useAdminNewInformationContextRows: (options: { module: string; refs: string[]; scope?: string; listReady: boolean }) => {
    runtime.useRows(options);
    return { getRow: (id: string) => ({ isNew: options.listReady && id.endsWith(":2"), ref: (node: HTMLElement | null) => { if (node) runtime.rows.set(id, node); else runtime.rows.delete(id); } }) };
  },
  useAdminNewInformationRowContext: () => undefined,
}));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: () => { throw new Error("No preview/background/network IO in inventory reminder tests"); },
  trpc: {
    useUtils: () => ({ client: { channelInventory: {} }, channelInventory: Object.fromEntries(["listTeamMaterials", "listTeamSourceOptions", "listChannels", "notesList", "collaborationNotesList"].map(name => [name, { invalidate: runtime.invalidate }])) }),
    enterprise: { me: { useQuery: () => ({ data: runtime.enterprise, isSuccess: runtime.enterpriseSuccess, isLoading: false, isFetching: runtime.enterpriseFetching, isError: runtime.enterpriseError, error: new Error("fixture enterprise denied") }) } },
    channelInventory: {
      listChannels: { useQuery: () => ({ data: { items: [], total: 0, pageCount: 1 }, isLoading: false, isError: false }) },
      listTeamMaterials: { useQuery: (input: Record<string, unknown>) => {
        runtime.inputs.push(input); const page = Number(input.page);
        const items = [1, 2].map(id => ({ id: (page - 1) * 20 + id, revision: 1, partNumber: `PART-${(page - 1) * 20 + id}`, brand: "TI", qty: 9, price: "1.23", taxIncluded: false,
          leadTime: "现货", updatedAt: "2026-11-10 12:34:56", canEdit: false, readOnly: true, canViewSource: false, isMine: false, noteCount: 0, industryCode: null }));
        return { data: { items, total: 40, page: runtime.wrongPage ? 99 : page, pageSize: 20, pageCount: 2, canWrite: false, canFilterSource: false }, isSuccess: runtime.success, isLoading: runtime.loading,
          isFetching: runtime.fetching, isError: runtime.error, isPlaceholderData: runtime.placeholder, error: new Error("fixture inventory denied"), refetch: runtime.refetch };
      } },
      ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: runtime.mutation }) }])),
    },
  },
}));
import ChannelInventoryHost from "./ChannelInventoryHost";
import { channelInventoryColumnsStorageKey } from "./channelInventoryColumns";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
async function render() { await act(async () => root.render(React.createElement(ChannelInventoryHost))); }
const source = readFileSync("client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx", "utf8");
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  runtime.provider = true; runtime.loading = false; runtime.fetching = false; runtime.error = false; runtime.placeholder = false; runtime.success = true;
  runtime.enterpriseFetching = false; runtime.enterpriseError = false; runtime.enterpriseSuccess = true; runtime.wrongPage = false;
  runtime.scope.contextVerification.state = "verified"; runtime.scope.contextVerification.identity = "scope-7-31";
  runtime.scope.officialInventoryPermissions.read = true; runtime.scope.merchantId = 55;
  runtime.useRows.mockClear(); runtime.rows.clear(); runtime.mutation.mockClear(); runtime.inputs = [];
  vi.stubGlobal("React", React); // repository Vitest uses classic JSX for shared TSX.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production requests"); }));
  // Hide optional public reference columns; reminder must remain independent.
  localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify(["brand", "qty"]));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(runtime.mutation).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
describe("inventory native row reminder integration", () => {
  it("inspects only actual current materialRows, binds actual tr, badges and sorts new within that page", async () => {
    await render();
    const readyCalls = runtime.useRows.mock.calls.map(call => call[0]).filter(call => call.listReady);
    expect(readyCalls.length).toBeGreaterThan(0);
    expect(readyCalls.at(-1)).toEqual({ module: "inventory", refs: ["channel-material:1", "channel-material:2"], scope: "55", listReady: true });
    expect(Array.from(host.querySelectorAll("tbody tr td.ci-material-part-col")).map(td => td.textContent)).toEqual(["PART-2新", "PART-1"]);
    expect(runtime.rows.get("channel-material:2")?.tagName).toBe("TR");
    expect(runtime.rows.get("channel-material:2")?.querySelector('[aria-label="新信息，已在当前列表展示后会记录为已展示"]')?.textContent).toBe("新");
    expect(runtime.inputs.every(input => input.pageSize === 20)).toBe(true);
    expect(runtime.inputs.every(input => input.page === 1)).toBe(true);
  });
  it("native pagination switches only current page refs and never prefetches or clears hidden pages", async () => {
    await render(); runtime.useRows.mockClear(); runtime.inputs = [];
    const next = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "下一页");
    expect(next).toBeDefined();
    await act(async () => next!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const settled = runtime.useRows.mock.calls.map(call => call[0]).filter(call => call.listReady);
    expect(settled.at(-1)?.refs).toEqual(["channel-material:21", "channel-material:22"]);
    expect(runtime.inputs.every(input => input.page === 2 && input.pageSize === 20)).toBe(true);
    expect(Array.from(host.querySelectorAll("tbody tr td.ci-material-part-col")).map(td => td.textContent)).toEqual(["PART-21", "PART-22"]);
  });
  it("without admin provider keeps original rows/actions and makes no reminder calls or errors", async () => {
    runtime.provider = false;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await render();
      expect(runtime.useRows).not.toHaveBeenCalled();
      expect(Array.from(host.querySelectorAll("tbody tr td.ci-material-part-col")).map(td => td.textContent)).toEqual(["PART-1", "PART-2"]);
      expect(host.querySelectorAll("button.ci-edit-entry")).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
  it.each(["loading", "fetching", "error", "placeholder", "enterpriseFetching", "enterpriseError", "wrongPage"] as const)("%s cannot authorize display receipts/new row state", async flag => {
    runtime[flag] = true; if (flag === "loading") runtime.success = false; await render();
    expect(runtime.useRows.mock.calls.some(call => call[0].listReady)).toBe(false);
    expect(host.querySelector('tbody [aria-label="新信息，已在当前列表展示后会记录为已展示"]')).toBeNull();
  });
  it("non-success lists or enterprise identity do not authorize reminders", async () => {
    runtime.success = false; runtime.enterpriseSuccess = false; await render();
    expect(runtime.useRows.mock.calls.some(call => call[0].listReady)).toBe(false);
  });
  it("verifying/stale native identity cannot authorize reminders", async () => {
    runtime.scope.contextVerification.state = "verifying"; runtime.scope.contextVerification.identity = "old-scope";
    await render(); expect(runtime.useRows.mock.calls.some(call => call[0].listReady)).toBe(false);
  });
  it("source contract excludes probe pages, keeps native filters/page size and uses original admin shared core", () => {
    expect(source).toContain('tab === "materials" && !browsingChannelsOnly && Boolean(materialResult)');
    expect(source).toContain('const inventoryInformationRefs = materialRows.map(row => `channel-material:${row.id}`)');
    expect(source).toContain('key={identity} refs={inventoryInformationRefs}');
    expect(source).toContain('ref={newInformationRow?.ref}');
    expect(source).toContain('from "../../../../../lib/adminNewInformation"');
    expect(source).not.toContain('module: "reception"');
    expect(source).not.toContain('pageSize: 1000');
  });
});
