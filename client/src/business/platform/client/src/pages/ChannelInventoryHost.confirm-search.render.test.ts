// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => ({
  requests: [] as Record<string, unknown>[],
  scope: {
    officialInventoryPermissions: { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" },
    storageScope: "scope-31", frontUser: { role: "user" },
    contextVerification: { state: "verified", identity: "scope-31", authorizationVersion: "auth-v1", readVersion: "read-v1" },
    onAuthorizationError: vi.fn(),
  },
}));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ client: { channelInventory: {} } }),
  enterprise: { me: { useQuery: () => ({
    data: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false },
    isLoading: false, isError: false,
  }) } },
  channelInventory: {
    listChannels: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
    listTeamMaterials: { useQuery: (input: Record<string, unknown>, options: { enabled?: boolean; staleTime?: number }) => useQuery({
      queryKey: ["channelInventory", "listTeamMaterials", input],
      enabled: options.enabled,
      staleTime: options.staleTime,
      queryFn: async () => {
        runtime.requests.push({ ...input });
        return {
          items: [{ id: 1, revision: 1, partNumber: "SYNTHETIC-PART", brand: "TI", qty: 100,
            industryCode: null, dateCode: null, price: null, taxIncluded: null, leadTime: null,
            updatedAt: "2026-11-05", canEdit: false, readOnly: true, canViewSource: false,
            isMine: true, noteCount: 0, canPublish: false, publicationStatus: "unpublished" }],
          total: 45, page: input.page, pageSize: 20, pageCount: 3, canWrite: false, canFilterSource: false,
        };
      },
    }) },
    ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"]
      .map(name => [name, { useMutation: () => ({ mutateAsync: vi.fn() }) }])),
  },
} }));
import ChannelInventoryHost from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
function renderHost() {
  act(() => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(ChannelInventoryHost))));
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic fixture control");
  return value;
}
function button(label: string) {
  return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find(item => item.textContent?.trim() === label || item.getAttribute("aria-label") === label));
}
function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}
function setInput(label: string, value: string) {
  const input = required(document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`));
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
beforeEach(async () => {
  vi.clearAllMocks(); runtime.requests = []; runtime.scope.officialInventoryPermissions.read = true;
  sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Production network forbidden in real query-cache fixture"); }));
  renderHost(); await settle();
  expect(runtime.requests).toHaveLength(1);
});
afterEach(() => {
  act(() => root.unmount()); client.clear(); container.remove();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
describe("confirmed inventory search with the real TanStack Query cache", () => {
  it("executes an empty first-page Confirm and repeated same-key searches", async () => {
    click(button("搜索")); await settle(); expect(runtime.requests).toHaveLength(2);
    click(button("搜索")); await settle(); expect(runtime.requests).toHaveLength(3);
    expect(runtime.requests.every(input => input.page === 1 && input.brand === undefined)).toBe(true);
  });
  it("queries changed filters only after confirmation, never the old key, and re-searches normalized whitespace", async () => {
    setInput("筛选库存品牌", " TI "); expect(runtime.requests).toHaveLength(1);
    click(button("搜索")); await settle(); expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests.at(-1)).toMatchObject({ brand: "TI", page: 1 });
    setInput("筛选库存品牌", "TI   "); expect(runtime.requests).toHaveLength(2);
    click(button("搜索")); await settle(); expect(runtime.requests).toHaveLength(3);
    expect(runtime.requests.at(-1)).toMatchObject({ brand: "TI", page: 1 });
  });
  it("uses Enter for a same-key search, ignores composing Enter, and queries page one only on pagination reset", async () => {
    const input = setInput("筛选库存型号", "");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    await settle(); expect(runtime.requests).toHaveLength(1);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle(); expect(runtime.requests).toHaveLength(2);
    click(button("下一页")); await settle(); expect(runtime.requests.at(-1)?.page).toBe(2);
    const before = runtime.requests.length;
    click(button("搜索")); await settle();
    // Confirm must request the cached first page too, never the old page two.
    expect(runtime.requests).toHaveLength(before + 1);
    expect(runtime.requests.slice(before).every(item => item.page === 1)).toBe(true);
    expect(runtime.requests.at(-1)?.page).toBe(1);
  });
  it("does not explicitly refetch invalid batch drafts or after native read revocation", async () => {
    click(button("高级库存筛选"));
    setInput("筛选上传批次 ID", "invalid"); click(button("应用筛选")); await settle();
    expect(runtime.requests).toHaveLength(1); expect(container.textContent).toContain("上传批次 ID 须为正整数");
    click(button("高级库存筛选"));
    setInput("筛选上传批次 ID", ""); runtime.scope.officialInventoryPermissions.read = false; renderHost();
    await settle(); expect(runtime.requests).toHaveLength(1);
    expect(container.textContent).not.toContain("SYNTHETIC-PART");
  });
});
