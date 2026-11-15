// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "@shared/channelReference";
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const getEdit = vi.fn(), update = vi.fn(), source = vi.fn(), lookup = vi.fn();
  return {
    scope: { merchantId: 0, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      officialInventoryPermissions: { read: true, write: true, note: false, publish: false, authorizationVersion: "native-v1" },
      contextVerification: { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    enterprise: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [] as string[], isOwner: false },
    rows: [] as Record<string, unknown>[], canWrite: true, error: false, inputs: [] as Record<string, unknown>[],
    getEdit, update, source, lookup, invalidate,
    utils: { client: { channelInventory: { getTeamMaterialForEdit: { query: getEdit }, getTeamMaterialSource: { query: source } } },
      channelInventory: Object.fromEntries(["listTeamMaterials", "listTeamSourceOptions", "listChannels", "notesList", "collaborationNotesList"].map(name => [name, { invalidate: () => invalidate(name) }])) },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: () => ({ channelReference: { lookup: { query: runtime.lookup } } }),
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: { me: { useQuery: () => ({ data: runtime.enterprise, isLoading: false, isFetching: false, isError: false }) } },
    channelInventory: {
      listChannels: { useQuery: () => ({ data: { items: [], total: 0, pageCount: 1, canWrite: false }, isLoading: false, isError: false }) },
      listTeamMaterials: { useQuery: (input: Record<string, unknown>) => {
        runtime.inputs.push(input);
        return { data: { items: runtime.rows, total: runtime.rows.length, page: input.page, pageSize: 20, pageCount: 1, canWrite: runtime.canWrite, canFilterSource: false },
          isLoading: false, isFetching: false, isError: runtime.error, refetch: vi.fn() };
      } },
      ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: vi.fn() }) }])),
      updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.update }) },
    },
  },
}));
import ChannelInventoryHost from "./ChannelInventoryHost";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const row = { id: 101, uploadBatchId: null, revision: 4, partNumber: "ORIGINAL", brand: "TI", qty: 9, dateCode: "2601", price: "0", currency: "CNY", taxIncluded: false, leadTime: "现货", industryCode: null,
  updatedAt: "2026-11-10 12:34:56", canEdit: true, canDelete: false, readOnly: false, isMine: false, noteCount: 0, canViewSource: true, channelSource: { id: 11, name: "LEGACY-CHANNEL-NEVER-CUSTOMER" }, company: { id: 111, name: "授权真实客户" } };
const detail = { ...row, channelId: 11, revision: 12, channelName: "PRIVATE-CHANNEL-NOT-EDITABLE", note: "PRIVATE-NOTE-NOT-EDITABLE", responsibleUserId: 999 };
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing flat-edit fixture control"); return value; }
function button(name: string) { return required([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === name)); }
function edit(index = 0) { return required(document.querySelectorAll("tbody tr")[index]?.querySelector<HTMLButtonElement>('[aria-label^="编辑库存："]')); }
async function render() { await act(async () => root.render(React.createElement(ChannelInventoryHost))); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function field(label: string) { return required([...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].find(input => input.closest("label")?.textContent?.includes(label))); }
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function quote(source: ChannelReferenceSource): ChannelReferenceQuote {
  return { source, status: "not_found", matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null,
    tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  runtime.scope.merchantId = 0; runtime.scope.frontUser = { id: 7, role: "user" }; runtime.scope.staffPrincipal = { frontendUserId: 7, enterpriseId: 31 };
  runtime.scope.storageScope = "scope-7-31"; runtime.scope.contextVerification = { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" };
  runtime.scope.officialInventoryPermissions = { read: true, write: true, note: false, publish: false, authorizationVersion: "native-v1" };
  runtime.enterprise = { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false };
  runtime.rows = [{ ...row }]; runtime.canWrite = true; runtime.error = false; runtime.inputs = [];
  runtime.getEdit.mockReset().mockResolvedValue(detail); runtime.update.mockReset().mockResolvedValue({}); runtime.source.mockReset().mockResolvedValue({ name: "再次核验的真实渠道" });
  runtime.invalidate.mockReset().mockResolvedValue(undefined); runtime.lookup.mockReset().mockImplementation(async (input: { materialIds: number[] }) => ({ items: input.materialIds.map(id => {
    const item = required(runtime.rows.find(row => row.id === id));
    return { materialId: id, partNumber: item.partNumber, brand: item.brand, references: { lcsc: quote("lcsc"), ickey: quote("ickey") } };
  }) }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network or API writes in flat-edit fixtures"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("flat direct edit preserves the existing public transaction", () => {
  it("uses only server row grants for owners/leaders and never derives editing from admin role or team visibility", async () => {
    runtime.scope.frontUser.role = "admin";
    runtime.rows = [{ ...row, isMine: true }, { ...row, id: 202, isMine: false }, { ...row, id: 303, canEdit: false }, { ...row, id: 404, readOnly: true }];
    await render();
    expect(document.querySelectorAll('[aria-label^="编辑库存："]')).toHaveLength(4);
    expect(edit(0).disabled).toBe(false); expect(edit(1).disabled).toBe(false); expect(edit(2).disabled).toBe(true); expect(edit(3).disabled).toBe(true);
    expect(edit(2).title).toContain("只读"); expect(edit(3).title).toContain("只读");
    expect(document.querySelectorAll('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]')).toHaveLength(4);
    await click(edit(2)); await click(edit(3)); expect(runtime.getEdit).not.toHaveBeenCalled();
    await click(edit(1)); expect(runtime.getEdit).toHaveBeenCalledWith({ id: 202, expectedActorUserId: 7, expectedEnterpriseId: 31 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // Detail id 101 cannot open row 202.
  });
  it("disables the entrance for native/global/context failures and never sends an edit read", async () => {
    await render(); runtime.scope.officialInventoryPermissions.write = false; await render(); expect(edit().disabled).toBe(true); await click(edit());
    runtime.scope.officialInventoryPermissions.write = true; runtime.canWrite = false; await render(); expect(edit().disabled).toBe(true); await click(edit());
    runtime.canWrite = true; runtime.scope.contextVerification.state = "revalidating"; await render(); expect(edit().disabled).toBe(true); await click(edit());
    expect(runtime.getEdit).not.toHaveBeenCalled(); expect(runtime.update).not.toHaveBeenCalled();
  });
  it.each([false, undefined, null, "true"])("returned canEditMaterial=%s supersedes legacy positive edit/owner/admin hints for both capabilities", async grant => {
    runtime.scope.frontUser.role = "admin";
    runtime.rows = [{ ...row, canEditMaterial: grant, isMine: true, recorderAdminAccountId: 7, originalRecorderName: "当前员工" }];
    await render(); expect(edit().disabled).toBe(true);
    expect(document.querySelector("td.ci-material-source-col")?.textContent).toBe("客户不可查看");
    await click(edit()); expect(runtime.getEdit).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("授权真实客户");
  });
  it("authorizes only from the new explicit grant and rechecks fresh detail grant before opening", async () => {
    runtime.rows = [{ ...row, canEdit: false, canEditMaterial: true }];
    runtime.getEdit.mockResolvedValueOnce({ ...detail, canEditMaterial: false });
    await render(); expect(edit().disabled).toBe(false); await click(edit());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    runtime.getEdit.mockResolvedValueOnce({ ...detail, canEdit: false, canEditMaterial: true });
    await click(edit()); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    runtime.rows = [{ ...row, canEditMaterial: false }]; await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("授权真实客户");
    expect(runtime.update).not.toHaveBeenCalled();
  });
  it("focuses model then brand and saves only unchanged public-field permissions with exact CAS/identity/UUID", async () => {
    await render(); await click(edit());
    const labels = [...document.querySelectorAll('fieldset label > span')].map(label => label.textContent);
    expect(labels.slice(0, 2)).toEqual(["型号 *", "品牌 *"]); expect(document.activeElement).toBe(field("型号"));
    expect(field("关联渠道").readOnly).toBe(true); expect(field("关联渠道").disabled).toBe(true);
    expect(document.querySelector('[role="dialog"] textarea')).toBeNull(); expect(document.body.innerHTML).not.toMatch(/PRIVATE-CHANNEL|PRIVATE-NOTE|responsibleUserId/);
    await input(field("型号"), " UPDATED-MODEL "); await input(field("品牌"), " ADI "); await click(button("保存修改"));
    expect(runtime.update).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 101, expectedRevision: 12, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i),
      partNumber: "UPDATED-MODEL", brand: "ADI", qty: 9, dateCode: "2601", price: "0", taxIncluded: false, leadTime: "现货" });
    for (const key of ["channelId", "channelName", "responsibleUserId", "ownerUserId", "teamId", "note", "channelSource", "references", "currency"]) expect(runtime.update.mock.calls[0][0]).not.toHaveProperty(key);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.invalidate).toHaveBeenCalledWith("listTeamMaterials");
    await click(edit()); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); // Success releases the synchronous submit lock.
  });
  it("locks an unknown result and retries exactly the same payload, while synchronous duplicate clicks send once", async () => {
    const pending = deferred<unknown>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    await render(); await click(edit()); await input(field("型号"), "FROZEN");
    const save = button("保存修改");
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(runtime.update).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(Promise.reject(new Error("lost receipt"))));
    const payload = runtime.update.mock.calls[0][0];
    expect(document.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true); expect(button("取消").disabled).toBe(true);
    await click(button("按原请求重试")); expect(runtime.update.mock.calls[1][0]).toEqual(payload); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("cancels late detail and write receipts after permission/context changes without refreshing the new actor", async () => {
    const pendingRead = deferred<unknown>(); runtime.getEdit.mockReturnValueOnce(pendingRead.promise);
    await render(); await click(edit()); const signal = runtime.getEdit.mock.calls[0][1].signal as AbortSignal;
    runtime.scope.officialInventoryPermissions.write = false; await render(); expect(signal.aborted).toBe(true);
    await act(async () => pendingRead.resolve(detail)); expect(document.querySelector('[role="dialog"]')).toBeNull();
    runtime.scope.officialInventoryPermissions.write = true; await render(); await click(edit());
    const pendingWrite = deferred<unknown>(); runtime.update.mockReturnValueOnce(pendingWrite.promise); await click(button("保存修改"));
    runtime.enterprise.currentUserId = 8; runtime.enterprise.enterprise.id = 32; await render(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => pendingWrite.resolve({})); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it("shows the customer source only from the authenticated list and never calls the legacy channel-source API", async () => {
    await render(); expect(document.querySelector("td.ci-material-source-col")?.textContent).toBe("授权真实客户");
    expect(runtime.source).not.toHaveBeenCalled(); expect(document.querySelector(".ci-source-link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("LEGACY-CHANNEL-NEVER-CUSTOMER");
  });
  it("masks source immediately when a fresh server row revokes edit/readOnly, regardless of old source/native/admin hints", async () => {
    await render(); runtime.scope.frontUser.role = "admin";
    runtime.rows = [{ ...row, canEdit: false, canViewSource: true }]; await render();
    expect(edit().disabled).toBe(true); expect(edit().title).toContain("只读");
    expect(document.querySelector("td.ci-material-source-col")?.textContent).toBe("客户不可查看");
    await click(edit()); expect(runtime.getEdit).not.toHaveBeenCalled(); expect(runtime.source).not.toHaveBeenCalled();
    runtime.rows = [{ ...row, readOnly: true }]; await render();
    expect(document.body.innerHTML).not.toContain("授权真实客户");
    expect(edit().disabled).toBe(true); expect(runtime.source).not.toHaveBeenCalled();
  });
  it("refreshes the real list after save and binds saved-reference reread to fresh id/model/brand with refresh:false", async () => {
    runtime.scope.merchantId = 55; await render(); expect(runtime.lookup).toHaveBeenCalledTimes(1);
    await click(edit()); await input(field("型号"), "NEW-MODEL"); await input(field("品牌"), "ADI");
    runtime.invalidate.mockImplementation(async name => { if (name === "listTeamMaterials") runtime.rows = [{ ...row, revision: 13, partNumber: "NEW-MODEL", brand: "ADI", company: null, canViewSource: false, canEdit: false }]; });
    await click(button("保存修改")); await render();
    expect(runtime.lookup).toHaveBeenCalledTimes(2);
    expect(runtime.lookup.mock.calls.map(([input]) => input.refresh)).toEqual([false, false]);
    expect(runtime.lookup.mock.calls[1][0]).toEqual({ listInput: runtime.inputs.at(-1), materialIds: [101], refresh: false });
    expect(document.querySelector("td.ci-material-brand-col")?.textContent).toBe("ADI");
    expect(document.querySelector(".ci-part-number-text")?.textContent).toBe("NEW-MODEL");
    expect(document.querySelector("td.ci-material-source-col")?.textContent).toBe("客户不可查看"); expect(edit().disabled).toBe(true);
    expect(runtime.source).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("保存记录（非实时）");
  });
});


describe("manual references in the existing edit transaction", () => {
  function manual(label: "一" | "二") { return required(document.querySelector<HTMLInputElement>(`[aria-label="渠道参考价${label}（CNY）"]`)); }
  function reset(label: "一" | "二") { return required(document.querySelector<HTMLButtonElement>(`[aria-label="渠道参考价${label}恢复自动价"]`)); }
  function confirm() { return required(document.querySelector<HTMLInputElement>('[aria-label="确认保留已有手填参考价"]')); }
  it("reads manual fields from fresh edit detail, not the list or automatic display; untouched references are omitted", async () => {
    runtime.rows = [{ ...row, manualReferenceLcsc: "8", manualReferenceIckey: "9" }];
    runtime.getEdit.mockResolvedValueOnce({ ...detail, manualReferenceLcsc: "0", manualReferenceIckey: "2.340000000001" });
    await render(); await click(edit());
    expect(manual("一").value).toBe("0"); expect(manual("二").value).toBe("2.340000000001");
    expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).toBeNull();
    await input(field("可供数量"), "10"); await click(button("保存修改"));
    expect(runtime.update.mock.calls[0][0]).toMatchObject({ qty: 10, expectedRevision: 12 });
    expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceLcsc");
    expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceIckey");
  });
  it("keeps empty inputs while automatic reference is available and never stores it implicitly", async () => {
    runtime.scope.merchantId = 55;
    runtime.lookup.mockImplementation(async () => ({ items: [{ materialId: row.id, partNumber: row.partNumber, brand: row.brand, references: {
      lcsc: { ...quote("lcsc"), status: "ok", matchedPartNumber: row.partNumber, matchedBrand: row.brand, currency: "CNY", unitPrice: "1.230000000001", tierQuantity: 10, stockQuantity: 50 }, ickey: quote("ickey"),
    } }] }));
    await render(); await click(edit());
    expect(manual("一").value).toBe(""); expect(manual("二").value).toBe("");
    expect(manual("一").placeholder).toContain("自动参考价"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1.230000000001，库存50");
    await click(button("保存修改")); expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceLcsc");
    expect(runtime.lookup.mock.calls.every(([input]) => input.refresh === false)).toBe(true);
  });
  it.each([["一", "manualReferenceLcsc", "0"], ["二", "manualReferenceIckey", "999999999999999.999999999999"]] as const)("saves only changed reference %s together with public fields and exact strings", async (label, key, value) => {
    await render(); await click(edit()); await input(manual(label), value); await input(field("Date Code"), "2602"); await click(button("保存修改"));
    expect(runtime.update).toHaveBeenCalledTimes(1);
    const payload = runtime.update.mock.calls[0][0];
    expect(payload).toMatchObject({ [key]: value, id: 101, expectedRevision: 12, expectedActorUserId: 7, expectedEnterpriseId: 31, dateCode: "2602", price: "0", partNumber: "ORIGINAL", brand: "TI" });
    expect(payload).not.toHaveProperty(key === "manualReferenceLcsc" ? "manualReferenceIckey" : "manualReferenceLcsc");
    for (const forbidden of ["channelId", "note", "responsibleUserId", "company", "references", "currency", "channelSource"]) expect(payload).not.toHaveProperty(forbidden);
  });
  it.each(["-1", "1e3", "1000000000000000", "0.1234567890123", "01"])("rejects %s in the dialog without any request", async value => {
    await render(); await click(edit()); await input(manual("二"), value); await click(button("保存修改"));
    expect(runtime.update).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("渠道参考价二须为非负十进制");
  });
  it("explicit clearing and restore-auto each submit null; unchanged partner is omitted", async () => {
    runtime.getEdit.mockResolvedValue({ ...detail, manualReferenceLcsc: "0", manualReferenceIckey: "2" });
    await render(); await click(edit()); await input(manual("一"), ""); await click(button("保存修改"));
    expect(runtime.update.mock.calls[0][0]).toMatchObject({ manualReferenceLcsc: null }); expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceIckey");
    await click(edit()); await click(reset("二")); expect(manual("二").value).toBe(""); await click(button("保存修改"));
    expect(runtime.update.mock.calls[1][0]).toMatchObject({ manualReferenceIckey: null }); expect(runtime.update.mock.calls[1][0]).not.toHaveProperty("manualReferenceLcsc");
    runtime.getEdit.mockResolvedValue(detail); await click(edit()); await click(reset("一")); await click(button("保存修改"));
    expect(runtime.update.mock.calls[2][0]).toMatchObject({ manualReferenceLcsc: null });
  });
  it("requires in-dialog confirmation for model/brand changes retaining manual zero, resets confirmation on further identity change", async () => {
    runtime.getEdit.mockResolvedValueOnce({ ...detail, manualReferenceLcsc: "0", manualReferenceIckey: "2" });
    await render(); await click(edit()); await input(field("型号"), "NEW-MODEL");
    expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')?.textContent).toContain("重填或恢复自动价");
    await click(button("保存修改")); expect(runtime.update).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
    await click(confirm()); expect(confirm().checked).toBe(true);
    await input(field("品牌"), "ADI"); expect(confirm().checked).toBe(false); await click(button("保存修改")); expect(runtime.update).not.toHaveBeenCalled();
    await click(confirm()); await click(button("保存修改")); expect(runtime.update.mock.calls[0][0]).toMatchObject({ partNumber: "NEW-MODEL", brand: "ADI" });
    expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceLcsc"); expect(runtime.update.mock.calls[0][0]).not.toHaveProperty("manualReferenceIckey");
  });
  it("allows re-entry/restore instead of retaining, but still requires confirmation while any existing manual reference is kept", async () => {
    runtime.getEdit.mockResolvedValueOnce({ ...detail, manualReferenceLcsc: "0", manualReferenceIckey: "2" });
    await render(); await click(edit()); await input(field("品牌"), "ADI"); await click(reset("一"));
    expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).not.toBeNull();
    await input(manual("二"), "3.000000000001"); expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).toBeNull();
    await click(button("保存修改")); expect(runtime.update.mock.calls[0][0]).toMatchObject({ brand: "ADI", manualReferenceLcsc: null, manualReferenceIckey: "3.000000000001" });
  });
  it("does not warn for qty/date/price edits, new manual values, or model reverted to original", async () => {
    runtime.getEdit.mockResolvedValueOnce({ ...detail, manualReferenceLcsc: "2" });
    await render(); await click(edit()); await input(field("可供数量"), "3"); await input(field("报价"), "4");
    expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).toBeNull();
    await input(field("型号"), "OTHER"); expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).not.toBeNull();
    await input(field("型号"), "ORIGINAL"); expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).toBeNull();
    await click(button("取消")); await click(edit()); await input(field("型号"), "NEW"); await input(manual("一"), "1");
    expect(document.querySelector('[aria-label="手填参考价型号品牌确认"]')).toBeNull(); await click(button("保存修改")); expect(runtime.update).toHaveBeenCalledTimes(1);
  });
  it("freezes manual payload and UUID while busy/unknown-result locked; input/reset cannot mutate retry", async () => {
    const pending = deferred<unknown>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    await render(); await click(edit()); await input(manual("一"), "0.000000000001");
    await click(button("保存修改")); expect(manual("一").disabled).toBe(true); expect(reset("一").disabled).toBe(true);
    const payload = runtime.update.mock.calls[0][0];
    await input(manual("一"), "7"); await click(reset("一")); await input(manual("二"), "8");
    await act(async () => pending.resolve(Promise.reject(new Error("lost receipt"))));
    expect(manual("一").value).toBe("0.000000000001"); expect(manual("二").value).toBe(""); expect(reset("二").disabled).toBe(true);
    await input(manual("一"), "9"); await click(reset("一")); expect(manual("一").value).toBe("0.000000000001");
    await click(button("按原请求重试")); expect(runtime.update.mock.calls[1][0]).toEqual(payload);
    expect(payload).toMatchObject({ manualReferenceLcsc: "0.000000000001", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
    expect(payload).not.toHaveProperty("manualReferenceIckey");
  });
  it("read-only visible rows display manual reference prices without source or evidence disclosure", async () => {
    runtime.rows = [{ ...row, canEditMaterial: false, canViewSource: false, manualReferenceLcsc: "0", manualReferenceIckey: "999999999999999.999999999999" }];
    await render(); expect(edit().disabled).toBe(true);
    expect(document.querySelector('[data-reference-source="lcsc"]')?.textContent).toBe("¥0手填");
    expect(document.querySelector('[data-reference-source="ickey"]')?.textContent).toBe("¥999999999999999.999999999999手填");
    expect(document.querySelectorAll('[data-reference-source] button, [data-reference-source] a')).toHaveLength(0);
    expect(document.querySelector("td.ci-material-source-col")?.textContent).toBe("客户不可查看");
    expect(document.body.innerHTML).not.toContain("授权真实客户"); await click(edit()); expect(runtime.getEdit).not.toHaveBeenCalled(); expect(runtime.source).not.toHaveBeenCalled();
  });
});


describe("manual reference detail binding and locked retention", () => {
  it("does not present old list auto evidence as the current automatic reference for changed fresh detail identity", async () => {
    runtime.scope.merchantId = 55;
    runtime.lookup.mockImplementation(async () => ({ items: [{ materialId: row.id, partNumber: row.partNumber, brand: row.brand, references: {
      lcsc: { ...quote("lcsc"), status: "ok", matchedPartNumber: row.partNumber, matchedBrand: row.brand, currency: "CNY", unitPrice: "7.123000000001", tierQuantity: 10, stockQuantity: 50 }, ickey: quote("ickey"),
    } }] }));
    runtime.getEdit.mockResolvedValueOnce({ ...detail, partNumber: "FRESH-MODEL", brand: "ADI", manualReferenceLcsc: "0" });
    await render(); expect(document.querySelector('[data-reference-source="lcsc"]')?.textContent).toContain("7.123000000001"); await click(edit());
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("7.123000000001");
    expect(document.querySelector<HTMLInputElement>('[aria-label="渠道参考价一（CNY）"]')?.value).toBe("0");
    expect(document.querySelector('[role="dialog"] .ci-reference-evidence-button')).toBeNull();
  });
  it("locks explicit retention checkbox throughout busy and unknown-result retry without changing the frozen request", async () => {
    const pending = deferred<unknown>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    runtime.getEdit.mockResolvedValueOnce({ ...detail, manualReferenceLcsc: "0" });
    await render(); await click(edit()); await input(field("品牌"), "ADI");
    const checkbox = required(document.querySelector<HTMLInputElement>('[aria-label="确认保留已有手填参考价"]'));
    await click(checkbox); await click(button("保存修改")); expect(checkbox.disabled).toBe(true);
    const payload = runtime.update.mock.calls[0][0]; await click(checkbox);
    await act(async () => pending.resolve(Promise.reject(new Error("unknown write receipt"))));
    expect(checkbox.disabled).toBe(true); expect(checkbox.checked).toBe(true); await click(checkbox); expect(checkbox.checked).toBe(true);
    await click(button("按原请求重试")); expect(runtime.update.mock.calls[1][0]).toEqual(payload);
    expect(payload).not.toHaveProperty("manualReferenceLcsc");
  });
});
