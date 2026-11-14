// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelInventoryColumnsStorageKey } from "./channelInventoryColumns";
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    scope: { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      officialInventoryPermissions: { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" },
      contextVerification: { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    enterprise: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false },
    loading: false, fetching: false, error: false, enterpriseLoading: false, enterpriseError: false, placeholder: false, wrongPage: false, rowCount: 1,
    lookup: vi.fn(), createClient: vi.fn(), mutation: vi.fn(), refetch: vi.fn().mockResolvedValue(undefined), inputs: [] as Record<string, unknown>[], invalidate,
    utils: { client: { channelInventory: {} }, channelInventory: Object.fromEntries(["listTeamMaterials", "listTeamSourceOptions", "listChannels", "notesList", "collaborationNotesList"].map(name => [name, { invalidate: () => invalidate(name) }])) },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: (merchantId: number, options: unknown) => { runtime.createClient(merchantId, options); return { channelReference: { lookup: { query: runtime.lookup } } }; },
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: { me: { useQuery: () => ({ data: runtime.enterprise, isLoading: runtime.enterpriseLoading, isError: runtime.enterpriseError, error: new Error("原企业真实权限错误") }) } },
    channelInventory: {
      listChannels: { useQuery: () => ({ data: { items: [], total: 0, pageCount: 1 }, isLoading: false, isError: false }) },
      listTeamMaterials: { useQuery: (input: Record<string, unknown>) => {
        runtime.inputs.push(input); const page = Number(input.page);
        const items = Array.from({ length: runtime.rowCount }, (_, index) => ({ id: (page - 1) * 20 + index + 1, revision: 1,
          partNumber: input.partNumber ? String(input.partNumber) : `PART-${page}-${index + 1}`, brand: "TI", qty: 9, price: "1.234567890123", taxIncluded: false, leadTime: "现货", updatedAt: "2026-11-10 12:34:56",
          canEdit: false, readOnly: true, canViewSource: false, isMine: false, noteCount: 0, industryCode: null }));
        return { data: { items, total: 40, page: runtime.wrongPage ? 99 : page, pageSize: 20, pageCount: 2, canWrite: false, canFilterSource: false }, isLoading: runtime.loading, isFetching: runtime.fetching,
          isError: runtime.error, isPlaceholderData: runtime.placeholder, error: new Error("原库存真实权限错误"), refetch: runtime.refetch };
      } },
      ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: runtime.mutation }) }])),
    },
  },
}));
import ChannelInventoryHost from "./ChannelInventoryHost";
import { ChannelReferenceCell } from "./ChannelReferenceCell";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing reference fixture element"); return value; }
function button(name: string) { return required([...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === name)); }
async function render() { await act(async () => root.render(React.createElement(ChannelInventoryHost))); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
async function inputValue(label: string, value: string) {
  const input = required(document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function referenceCells() { return [...document.querySelectorAll<HTMLElement>("tbody td[data-reference-source]")]; }
function columnOption(label: string) { return required([...document.querySelectorAll<HTMLLabelElement>(".ci-columns-options label")].find(item => item.querySelector("span")?.firstChild?.textContent === label)?.querySelector<HTMLInputElement>("input")); }
function hidePreferences(actor = 7, enterprise = 31) { localStorage.setItem(required(channelInventoryColumnsStorageKey(actor, enterprise)), JSON.stringify(["partNumber", "brand", "qty", "price", "actions"])); }
function assertNoReferenceIO() {
  expect(runtime.createClient).not.toHaveBeenCalled();
  expect(runtime.lookup).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(runtime.mutation).not.toHaveBeenCalled();
}
function assertStaticReferences(count = 2) {
  const cells = referenceCells();
  expect(cells).toHaveLength(count);
  for (const cell of cells) {
    expect(cell.textContent).toBe("暂无报价");
    expect(cell.querySelectorAll(".ci-reference-placeholder[data-reference-status=disabled]")).toHaveLength(1);
    expect(cell.querySelector("button, a, [role=status], [role=dialog]")).toBeNull();
  }
  expect(document.querySelector(".ci-reference-spinner, .ci-reference-popover, .ci-reference-cell, [aria-label=正在读取参考]")).toBeNull();
  expect([...document.querySelectorAll("button")].some(item => /更新参考|参考读取中|参考详情/.test(item.textContent ?? ""))).toBe(false);
  expect(document.body.textContent).not.toContain("参考读取失败");
  assertNoReferenceIO();
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  runtime.scope.merchantId = 55; runtime.scope.frontUser.id = 7; runtime.scope.frontUser.role = "user"; runtime.scope.staffPrincipal = { frontendUserId: 7, enterpriseId: 31 }; runtime.scope.storageScope = "scope-7-31";
  runtime.scope.contextVerification = { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" };
  runtime.scope.officialInventoryPermissions = { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" };
  runtime.enterprise = { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false };
  runtime.loading = false; runtime.fetching = false; runtime.error = false; runtime.enterpriseLoading = false; runtime.enterpriseError = false; runtime.placeholder = false; runtime.wrongPage = false; runtime.rowCount = 1;
  runtime.inputs = []; runtime.lookup.mockReset(); runtime.createClient.mockClear(); runtime.mutation.mockClear(); runtime.invalidate.mockClear(); runtime.refetch.mockClear(); runtime.scope.onAuthorizationError.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network or production writes allowed in UI fixtures"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  assertNoReferenceIO(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("phase-one reference columns: static placeholders and no reference IO", () => {
  it.each(["lcsc", "ickey"] as const)("renders %s as a noninteractive disabled placeholder with only the source prop", async source => {
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source })));
    const cell = required(host.querySelector("span.ci-reference-placeholder"));
    expect(cell.textContent).toBe("暂无报价");
    expect(cell.getAttribute("data-reference-status")).toBe("disabled");
    expect(cell.getAttribute("data-source")).toBe(source);
    expect(host.querySelector("button, a, [role=status], [role=dialog]")).toBeNull();
    await click(cell); expect(host.textContent).toBe("暂无报价"); assertNoReferenceIO();
  });

  it("keeps the two columns immediately after the original quote and preserves original scoped input, quantity, quote and tax", async () => {
    await render();
    expect([...document.querySelectorAll("thead th")].map(cell => cell.textContent)).toEqual(["型号", "品牌", "负责人", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]);
    expect([...document.querySelectorAll("colgroup col")].map(cell => cell.getAttribute("data-column"))).toEqual(["partNumber", "brand", "recorder", "qty", "price", "refLcsc", "refIckey", "leadTime", "updatedAt", "source", "actions"]);
    expect(referenceCells().map(cell => cell.getAttribute("data-reference-source"))).toEqual(["lcsc", "ickey"]);
    expect(document.querySelector("tbody tr")?.querySelectorAll("td")).toHaveLength(11);
    expect(runtime.inputs.at(-1)).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1, pageSize: 20 });
    expect(runtime.inputs.at(-1)?.customerId).toBeUndefined(); expect(runtime.inputs.at(-1)?.channelId).toBeUndefined();
    expect(document.querySelector("td.ci-material-price-col")?.textContent).toBe("¥1.234567890123未税");
    expect(document.querySelector("td.ci-material-qty-col")?.textContent).toBe("9");
    expect(document.querySelector(".ci-source-link")).toBeNull(); expect(runtime.invalidate).not.toHaveBeenCalled();
    assertStaticReferences();
  });

  it("page changes update only the original inventory input/rows and retain two static placeholders", async () => {
    await render(); assertStaticReferences();
    await click(button("下一页")); expect(runtime.inputs.at(-1)).toMatchObject({ page: 2, pageSize: 20 });
    expect(document.body.textContent).toContain("PART-2-1"); expect(document.body.textContent).not.toContain("PART-1-1"); assertStaticReferences();
    await click(button("上一页")); expect(runtime.inputs.at(-1)?.page).toBe(1); assertStaticReferences();
    expect(runtime.invalidate).not.toHaveBeenCalled();
  });

  it("confirmed filters keep original normalization, reset pagination and retain the original same-query refetch", async () => {
    await render(); await click(button("下一页"));
    await inputValue("筛选库存型号", "  EXACT-PART-SUFFIX  "); await inputValue("筛选库存品牌", " TI ");
    expect(runtime.inputs.at(-1)?.partNumber).toBeUndefined(); expect(runtime.inputs.at(-1)?.page).toBe(2); assertStaticReferences();
    await click(button("搜索")); expect(runtime.inputs.at(-1)).toMatchObject({ partNumber: "EXACT-PART-SUFFIX", brand: "TI", page: 1 });
    expect(document.body.textContent).toContain("EXACT-PART-SUFFIX"); expect(runtime.refetch).not.toHaveBeenCalled(); assertStaticReferences();
    await click(button("搜索")); expect(runtime.refetch).toHaveBeenCalledTimes(1); assertStaticReferences();
  });

  it("the original refresh still invalidates exactly the four original inventory queries, never references or mutations", async () => {
    await render(); await click(button("刷新"));
    expect(runtime.invalidate.mock.calls).toEqual([["listTeamMaterials"], ["listTeamSourceOptions"], ["notesList"], ["collaborationNotesList"]]);
    expect(runtime.refetch).not.toHaveBeenCalled(); assertStaticReferences();
  });

  it("preferences hide and show either column independently without reference refresh, spinner, popover or IO", async () => {
    await render(); await click(button("显示列"));
    await click(columnOption("渠道参考一")); assertStaticReferences(1);
    expect(referenceCells()[0].getAttribute("data-reference-source")).toBe("ickey");
    await click(columnOption("渠道参考二")); assertStaticReferences(0);
    expect(document.querySelectorAll("thead .ci-material-reference-col")).toHaveLength(0);
    await click(columnOption("渠道参考一")); assertStaticReferences(1);
    await click(columnOption("渠道参考二")); assertStaticReferences();
    expect(document.querySelectorAll("thead .ci-material-reference-col")).toHaveLength(2);
    await click(referenceCells()[0]); assertStaticReferences();
    expect(runtime.invalidate).not.toHaveBeenCalled();
  });

  it("saved hidden preferences remain hidden until explicitly shown, including host remount", async () => {
    hidePreferences(); await render(); assertStaticReferences(0);
    await click(button("显示列")); await click(columnOption("渠道参考一")); await click(columnOption("渠道参考二")); assertStaticReferences();
    await act(async () => root.render(null)); assertNoReferenceIO(); await render(); assertStaticReferences();
  });

  it.each(["merchant", "actor", "enterprise", "authorizationVersion", "readVersion", "nativeGrantVersion", "role", "writePermission"] as const)("%s changes never create a reference client, request or polling effect", async dimension => {
    await render(); assertStaticReferences();
    if (dimension === "merchant") runtime.scope.merchantId = 56;
    if (dimension === "actor") {
      runtime.scope.frontUser.id = 8; runtime.scope.staffPrincipal.frontendUserId = 8; runtime.enterprise.currentUserId = 8;
      runtime.scope.storageScope = "scope-8-31"; runtime.scope.contextVerification.identity = "scope-8-31";
    }
    if (dimension === "enterprise") {
      runtime.scope.staffPrincipal.enterpriseId = 32; runtime.enterprise.enterprise.id = 32;
      runtime.scope.storageScope = "scope-7-32"; runtime.scope.contextVerification.identity = "scope-7-32";
    }
    if (dimension === "authorizationVersion") runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    if (dimension === "readVersion") runtime.scope.contextVerification.readVersion = "read-v2";
    if (dimension === "nativeGrantVersion") runtime.scope.officialInventoryPermissions.authorizationVersion = "native-v2";
    if (dimension === "role") runtime.scope.frontUser.role = "admin";
    if (dimension === "writePermission") runtime.scope.officialInventoryPermissions.write = true;
    await render(); assertStaticReferences();
    expect(runtime.inputs.at(-1)).toMatchObject({ expectedActorUserId: runtime.enterprise.currentUserId, expectedEnterpriseId: runtime.enterprise.enterprise.id });
    expect(runtime.invalidate).not.toHaveBeenCalled();
  });

  it.each(["actorMismatch", "enterpriseMismatch", "revalidating", "identityMismatch"] as const)("%s preserves the original disabled preference guard and cannot trigger reference IO", async dimension => {
    await render();
    if (dimension === "actorMismatch") runtime.scope.staffPrincipal.frontendUserId = 999;
    if (dimension === "enterpriseMismatch") runtime.scope.staffPrincipal.enterpriseId = 999;
    if (dimension === "revalidating") runtime.scope.contextVerification.state = "revalidating";
    if (dimension === "identityMismatch") runtime.scope.contextVerification.identity = "other-scope";
    await render(); expect(button("显示列").disabled).toBe(true); assertNoReferenceIO();
    expect(document.querySelector(".ci-reference-spinner, .ci-reference-popover")).toBeNull();
  });

  it("revoked original read permission hides stock and restoring it restores only static references", async () => {
    await render(); runtime.scope.officialInventoryPermissions.read = false; await render();
    expect(document.body.textContent).toContain("当前账号没有渠道库存查看权限"); assertStaticReferences(0);
    runtime.scope.officialInventoryPermissions.read = true; await render(); assertStaticReferences();
  });

  it.each(["loading", "fetching", "placeholder", "wrongPage", "error", "enterpriseLoading", "enterpriseError"] as const)("original %s state and its recovery never trigger reference IO or replace original errors", async field => {
    await render(); runtime[field] = true; await render(); assertNoReferenceIO();
    if (field === "loading") expect(document.body.textContent).toContain("正在加载渠道库存");
    if (field === "error") expect(document.body.textContent).toContain("原库存真实权限错误");
    if (field === "enterpriseLoading") expect(document.body.textContent).toContain("正在核对官方工作台权限");
    if (field === "enterpriseError") expect(document.body.textContent).toContain("原企业真实权限错误");
    assertStaticReferences(["error", "enterpriseLoading", "enterpriseError"].includes(field) ? 0 : 2);
    runtime[field] = false; await render(); assertStaticReferences();
  });

  it.each([0, 20, 21])("%s native rows retain original table behavior without reference IO", async count => {
    runtime.rowCount = count; await render(); assertStaticReferences(count * 2);
    if (!count) expect(document.body.textContent).toContain("暂无符合筛选条件的渠道库存");
  });

  it("elapsed time and actual host unmount cannot start automatic/manual reference work", async () => {
    vi.useFakeTimers(); await render(); assertStaticReferences();
    await act(async () => { await vi.advanceTimersByTimeAsync(240000); }); assertStaticReferences();
    await act(async () => root.render(null)); assertStaticReferences(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(240000); }); assertNoReferenceIO();
    expect(runtime.scope.onAuthorizationError).not.toHaveBeenCalled();
  });

  it("source contract removes reference IO rather than hiding it behind a flag", () => {
    const pageSource = readFileSync("client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx", "utf8");
    const cellSource = readFileSync("client/src/business/platform/client/src/pages/ChannelReferenceCell.tsx", "utf8");
    expect(pageSource).not.toMatch(/createBusinessScopeTrpcClient|startChannelReferenceLookup|ChannelReferenceView|channelReferenceModel|referenceClient|referenceKey|referenceState|referenceRevision|referenceBusy|referenceRefresh|referenceRows|refreshReferences|更新参考/);
    expect(pageSource).toContain('<ChannelReferenceCell source="lcsc" />'); expect(pageSource).toContain('<ChannelReferenceCell source="ickey" />');
    expect(cellSource).toContain('source: "lcsc" | "ickey"');
    expect(cellSource).not.toMatch(/useState|useEffect|useMemo|useRef|setTimeout|setInterval|Popover|spinner|channelReferenceModel|@shared|quote|loading|stopped|https?:|href=/);
  });
});
