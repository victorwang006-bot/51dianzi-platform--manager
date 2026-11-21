// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "@shared/channelReference";
import { channelInventoryListBusinessInputSchema } from "../../../../../../../../server/channelInventoryListBusinessInput";

const runtime = vi.hoisted(() => {
  const list = vi.fn(), batches = vi.fn(), detail = vi.fn(), update = vi.fn(), remove = vi.fn(), lookup = vi.fn(), invalidate = vi.fn(), authError = vi.fn();
  return {
    list, batches, detail, update, remove, lookup, invalidate, authError,
    rows: [] as Record<string, any>[], canWrite: true, bindingCount: 2, panel: null as any, publish: null as any,
    scope: { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" },
      staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      contextVerification: { identity: "scope-7-31", state: "verified", authorizationVersion: "auth-v1", readVersion: "read-v1" },
      officialInventoryPermissions: { read: true, write: true, note: true, publish: true, authorizationVersion: "native-v1" } },
    utils: { client: { channelInventory: { listUploadBatches: { query: batches }, listTeamMaterials: { query: list }, getTeamMaterialForEdit: { query: detail } } },
      channelInventory: { listTeamMaterials: { invalidate } } },
  };
});
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: (merchantId: number) => {
    expect(merchantId).toBe(runtime.scope.merchantId);
    return { channelReference: { lookup: { query: runtime.lookup } } };
  },
  trpc: { useUtils: () => runtime.utils, channelInventory: { updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.update }) }, deleteMaterials: { useMutation: () => ({ mutateAsync: runtime.remove }) } } },
}));
vi.mock("../channelInventory/FactoryMaterialPublish", () => ({ useFactoryMaterialPublish: (props: any) => {
  runtime.publish = props;
  return { dialog: null, action: (row: any) => React.createElement(React.Fragment, null,
    React.createElement("button", { className: "ci-inline-link", disabled: !props.available || !props.authorized || row.canPublish !== true }, "发布")) };
} }));
vi.mock("../channelInventory/ChannelInventorySourcePanel", async importOriginal => ({
  ...await importOriginal<typeof import("../channelInventory/ChannelInventorySourcePanel")>(),
  ChannelInventorySourcePanel: (props: any) => { runtime.panel = props; return React.createElement("div", { role: "dialog", "aria-label": "授权来源" }, "SOURCE"); },
}));
vi.mock("../channelInventory/CollaborationNotesPanel", () => ({ CollaborationNotesPanel: (props: any) => {
  runtime.panel = props; return React.createElement("div", { role: "dialog", "aria-label": "协作备注" }, "NOTES");
} }));
import { CustomerChannelInventory, customerInventoryInput, verifiedCustomerInventory, type CustomerChannelInventoryProps } from "./CustomerChannelInventory";
import { DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnLayout } from "../../pages/channelInventoryColumns";
import { MaterialEditPanel } from "../../pages/ChannelInventoryHost";
import { MaterialEditPanel as SharedMaterialEditPanel } from "../../pages/ChannelInventoryMaterialEditPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-A" };
function stock(extra: Record<string, unknown> = {}) {
  return { id: 101, revision: 4, partNumber: "MODEL-SUFFIX/EXACT", brand: "TI", qty: 0, price: "0.000000000001", currency: "CNY", taxIncluded: false,
    updatedAt: "2026-11-10 12:34:56", originalRecorderName: "授权负责人", leadTime: "现货", dateCode: "2601",
    canViewSource: true, canEditMaterial: true, canEdit: true, readOnly: false, isMine: true, canAddNote: true, noteCount: 3,
    canPublish: true, publicationStatus: "unpublished", company: { id: 801, name: "服务端授权 CRM 客户" },
    channelSource: { id: 11, name: "LEGACY-CHANNEL-MUST-NOT-SUBSTITUTE" }, ...extra };
}
function page(input: any, items = runtime.rows) {
  return { customerId: input.customerId, customerVersion: 4, bindingCount: runtime.bindingCount, items,
    total: items.length, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(items.length / input.pageSize), canWrite: runtime.canWrite, canFilterSource: false };
}
function quote(source: ChannelReferenceSource, priced = false): ChannelReferenceQuote {
  return { source, status: priced ? "ok" : "not_found", matchedPartNumber: priced ? "MODEL-SUFFIX/EXACT" : null, matchedBrand: priced ? "TI" : null,
    productCode: priced ? "C123" : null, pageUrl: priced ? "https://item.szlcsc.com/123.html" : null,
    stockQuantity: priced ? 120 : null, unitPrice: priced ? "1.230000000001" : null, tierQuantity: priced ? 10 : null,
    tiers: [], currency: priced ? "CNY" : null, unit: priced ? "个" : null, taxStatus: priced ? "included" : "unknown",
    packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
function referencePage() { return { items: runtime.rows.map(row => ({ materialId: row.id, partNumber: row.partNumber, brand: row.brand, references: { lcsc: quote("lcsc", true), ickey: quote("ickey") } })) }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: Root, host: HTMLDivElement, props: CustomerChannelInventoryProps;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(overrides: Partial<CustomerChannelInventoryProps> = {}) {
  props = { customerId: 801, customerVersion: 4, identity, enabled: true, onAuthorizationError: runtime.authError, ...overrides };
  await act(async () => { root.render(React.createElement(CustomerChannelInventory, props)); }); await settle();
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing unified customer inventory fixture control"); return value; }
function named(name: string) { return required([...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(item => item.textContent?.trim() === name)); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await settle(); }
async function more(index = 0) {
  const trigger = required(host.querySelectorAll<HTMLButtonElement>('[aria-label^="更多库存操作："]')[index]);
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))); await settle();
}
function editButton(index = 0) { return required(host.querySelectorAll<HTMLButtonElement>('[aria-label^="编辑库存："]')[index]); }
function field(label: string) { return required([...host.querySelectorAll<HTMLInputElement>('.ci-customer-inline-editor input')].find(input => input.closest("label")?.textContent?.includes(label))); }
function manual(label: "一" | "二") { return required(host.querySelector<HTMLInputElement>(`[aria-label="渠道参考价${label}（CNY）"]`)); }
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function escapeMenu() { await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle(); }
function sourceCell(index = 0) { return required(host.querySelectorAll("tbody .ci-material-source-col")[index]); }

function handlers(element: Element): Record<string, (...args: any[]) => void> {
  return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!];
}
beforeEach(() => {
  runtime.scope = { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
    contextVerification: { identity: "scope-7-31", state: "verified", authorizationVersion: "auth-v1", readVersion: "read-v1" },
    officialInventoryPermissions: { read: true, write: true, note: true, publish: true, authorizationVersion: "native-v1" } };
  runtime.rows = [stock()]; runtime.canWrite = true; runtime.bindingCount = 2; runtime.panel = null; runtime.publish = null;
  runtime.list.mockReset().mockImplementation(input => Promise.resolve(page(input)));
  runtime.batches.mockReset().mockImplementation(input => Promise.resolve({ items: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 }));
  runtime.detail.mockReset().mockImplementation(({ id }) => Promise.resolve({ ...stock({ id }), channelId: 11, revision: 12, manualReferenceLcsc: "0", manualReferenceIckey: "2.340000000001",
    channelName: "PRIVATE-CHANNEL-NEVER-RENDER", note: "PRIVATE-NOTE-NEVER-RENDER", responsibleUserId: 999 }));
  runtime.update.mockReset().mockResolvedValue({}); runtime.invalidate.mockReset().mockResolvedValue(undefined);
  runtime.lookup.mockReset().mockImplementation(() => Promise.resolve(referencePage())); runtime.authError.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network in unified customer inventory fixtures"); }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("customer inventory uses the main Host's compact defaults", () => {
  it("the actual strict reference listInput schema supports customerId and both expected identity assertions without a global fallback", () => {
    const input = customerInventoryInput(identity, 801, { partNumber: "LM358", brand: "TI" }, 1);
    expect(channelInventoryListBusinessInputSchema.parse(input)).toEqual(input);
    expect(channelInventoryListBusinessInputSchema.safeParse({ ...input, customerId: 0 }).success).toBe(false);
    expect(channelInventoryListBusinessInputSchema.safeParse({ ...input, canManageAll: true }).success).toBe(false);
  });
  it("has the same nine columns, widths, copy model, price precision and compact edit/more actions", async () => {
    await render();
    expect([...host.querySelectorAll("th")].map(cell => cell.textContent)).toEqual(["", "型号", "品牌", "负责人", "来源客户", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "操作"]);
    expect([...host.querySelectorAll<HTMLTableColElement>("col")].map(col => col.dataset.column)).toEqual(["selection", ...DEFAULT_CHANNEL_INVENTORY_COLUMNS]);
    const layout = channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false);
    expect([...host.querySelectorAll<HTMLTableColElement>("col")].map(col => col.style.width)).toEqual(["36px", ...layout.visible.map(col => `${col.width}px`)]);
    expect(host.querySelector<HTMLTableElement>("table")?.style.getPropertyValue("--ci-stock-min-width")).toBe(`${layout.minWidth + 36}px`);
    expect(host.querySelectorAll("tbody tr td")).toHaveLength(10);
    expect(host.querySelector(".ci-material-qty-col.ci-number")?.textContent).toBe("0");
    expect(host.querySelector("td.ci-material-price-col")?.textContent).toBe("¥0.000000000001未税");
    expect(host.querySelector('.ci-part-copy-button[aria-label="复制完整型号：MODEL-SUFFIX/EXACT"]')).not.toBeNull();
    expect(host.querySelector("td.ci-material-lead-col, td.ci-material-date-col")).toBeNull();
    expect([...host.querySelectorAll(".ci-col-actions .ci-row-actions button")].map(button => button.textContent)).toEqual(["编辑", "删除", "更多"]);
    expect(host.querySelector(".ci-flat-view .ci-compact-stock-table")).not.toBeNull();
    expect(MaterialEditPanel).toBe(SharedMaterialEditPanel);
    const css = readFileSync("client/src/business/platform/client/src/components/customers/CustomerChannelInventory.css", "utf8");
    expect(css).not.toMatch(/--ci-stock-min-width|\.ci-row-actions\s*\{|\.ci-material-part-col\s*\{/);
  });
  it("keeps authorized CRM customer independent from both marketplace references and legacy channel hints", async () => {
    await render();
    expect(sourceCell().textContent).toBe("服务端授权 CRM 客户");
    expect(host.innerHTML).not.toContain("LEGACY-CHANNEL");
    expect(host.querySelector('[data-reference-source="lcsc"] .ci-reference-text')?.textContent).toBe("1.230000000001，库存120");
    expect(host.querySelector('[aria-label="查看立创商城参考来源"]')).not.toBeNull();
    expect(host.querySelector('[data-reference-source="ickey"] .ci-reference-text')?.textContent).toBe("暂未匹配");
    expect(runtime.list).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, partNumber: undefined, brand: undefined, page: 1, pageSize: 20 }, { signal: expect.any(AbortSignal) });
    expect(runtime.lookup).toHaveBeenCalledWith({ listInput: runtime.list.mock.calls[0][0], materialIds: [101], refresh: false }, { signal: expect.any(AbortSignal) });
  });
  it("read-only rows may show exact manual references without revealing CRM/source access", async () => {
    runtime.rows = [stock({ canEditMaterial: false, manualReferenceLcsc: "0", manualReferenceIckey: "999999999999999.999999999999" })];
    await render();
    expect(editButton().disabled).toBe(true); expect(sourceCell().textContent).toBe("客户不可查看");
    expect(host.innerHTML).not.toContain("服务端授权 CRM 客户");
    expect(host.querySelector('[data-reference-source="lcsc"]')?.textContent).toBe("¥0手填");
    expect(host.querySelector('[data-reference-source="ickey"]')?.textContent).toBe("¥999999999999999.999999999999手填");
    expect(host.querySelectorAll('[data-reference-source] button, [data-reference-source] a')).toHaveLength(0);
    await more(); expect(document.body.textContent).not.toContain("查看来源");
    await click(editButton()); expect(runtime.detail).not.toHaveBeenCalled();
  });
  it("does not infer an unlinked customer from a channel name", async () => {
    runtime.rows = [stock({ company: null })]; await render(); expect(sourceCell().textContent).toBe("未关联客户");
    expect(host.innerHTML).not.toContain("LEGACY-CHANNEL");
  });
  it.each(["unbound", "empty", "error", "loading", "disabled"])("retains all native columns and confirmed compact empty states for %s", async state => {
    if (state === "unbound") { runtime.bindingCount = 0; runtime.rows = []; }
    if (state === "empty") runtime.rows = [];
    if (state === "error") runtime.list.mockRejectedValueOnce(new Error("synthetic list failure"));
    if (state === "loading") runtime.list.mockImplementationOnce(() => new Promise(() => undefined));
    await render({ enabled: state !== "disabled" });
    expect(host.querySelectorAll("thead th")).toHaveLength(10); expect(host.querySelectorAll("col")).toHaveLength(10);
    expect(host.querySelector<HTMLTableCellElement>("tbody .ci-empty")?.colSpan).toBe(10);
    expect(Boolean(host.querySelector(".customer-stock-empty"))).toBe(state === "unbound" || state === "empty");
    expect(runtime.lookup).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="客户渠道库存分页"]')?.parentElement?.querySelector(".ci-tablewrap nav")).toBeFalsy();
  });
});

describe("customer source/edit grants are the same fail-closed gate", () => {
  it.each([false, undefined, null, "true", 1])("explicit canEditMaterial=%s overrides positive legacy/owner/admin hints", async grant => {
    runtime.scope.frontUser.role = "admin"; runtime.rows = [stock({ canEditMaterial: grant })]; await render();
    expect(editButton().disabled).toBe(true); expect(sourceCell().textContent).toBe("客户不可查看");
    await more(); expect(document.body.textContent).not.toContain("查看来源");
    await click(editButton()); expect(runtime.detail).not.toHaveBeenCalled();
  });
  it.each([true, undefined, null, "false", 0])("readOnly=%s never becomes a writable/customer grant", async readOnly => {
    runtime.rows = [stock({ readOnly })]; await render(); expect(editButton().disabled).toBe(true);
    expect(sourceCell().textContent).toBe("客户不可查看"); await more(); expect(document.body.textContent).not.toContain("查看来源");
  });
  it("accepts the explicit new grant instead of requiring legacy canEdit", async () => {
    runtime.rows = [stock({ canEdit: false, canEditMaterial: true })]; await render(); expect(editButton().disabled).toBe(false);
    await more(); expect(document.body.textContent).toContain("查看来源");
  });
  it.each(["native-write", "native-read", "list-write", "pending-context", "actor", "enterprise", "binding"])("denies source and edit on current %s failure", async failure => {
    if (failure === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (failure === "native-read") runtime.scope.officialInventoryPermissions.read = false;
    if (failure === "list-write") runtime.canWrite = false;
    if (failure === "pending-context") runtime.scope.contextVerification.state = "revalidating";
    if (failure === "actor") runtime.scope.frontUser.id = 8;
    if (failure === "enterprise") runtime.scope.staffPrincipal.enterpriseId = 32;
    if (failure === "binding") runtime.scope.contextVerification.identity = "old-binding";
    await render(); expect(editButton().disabled).toBe(true); expect(sourceCell().textContent).toBe("客户不可查看");
    await more(); expect(document.body.textContent).not.toContain("查看来源");
    await click(editButton()); expect(runtime.detail).not.toHaveBeenCalled(); expect(runtime.update).not.toHaveBeenCalled();
  });
  it("checks the row grant again inside a deferred source open and preserves parent modal notifications", async () => {
    let pending!: () => void; const onOpenChange = vi.fn(), onAction = vi.fn((action: () => void) => { pending = action; });
    await render({ onAction, onOpenChange }); await more(); await click(named("查看来源"));
    expect(onAction).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
    runtime.rows[0].canEditMaterial = false; await act(async () => pending()); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
    runtime.rows[0].canEditMaterial = true; await more(); await click(named("查看来源")); await act(async () => pending());
    const source = runtime.panel; expect(source.materialId).toBe(101); expect(source.enterpriseId).toBe(31); expect(source.actorUserId).toBe(7);
    expect(source.isCurrent()).toBe(true); expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await render({ enabled: false, onOpenChange }); expect(source.isCurrent()).toBe(false); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it("rejects delayed edit actions after customer or authorization generation changes", async () => {
    let pending!: () => void; const onAction = (action: () => void) => { pending = action; };
    await render({ onAction }); await click(editButton()); await render({ identity: { ...identity, key: "AUTH-B" }, onAction });
    await act(async () => pending()); expect(runtime.detail).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
  });
  it("keeps notes/native publish boundaries independent without broadening inventory edit", async () => {
    runtime.scope.officialInventoryPermissions.note = false; runtime.scope.officialInventoryPermissions.publish = false;
    await render(); await more(); expect(document.body.textContent).not.toContain("本人备注");
    expect(runtime.publish.available).toBe(false); expect(required(document.querySelector<HTMLButtonElement>('[role="menu"] button')).disabled).toBe(true);
    await click(named("备注（3）")); expect(runtime.panel.canWriteNote).toBe(false); expect(runtime.panel.canAddNote).toBe(false);
  });
});

describe("customer public edit uses a compact inline panel and unchanged manual transaction", () => {
  it("reads fresh public detail, focuses model/brand, and submits exact identity/CAS/UUID plus only public fields", async () => {
    const onOpenChange = vi.fn(); await render({ onOpenChange }); await click(editButton());
    expect(runtime.detail).toHaveBeenCalledWith({ id: 101, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(manual("一").value).toBe("0"); expect(manual("二").value).toBe("2.340000000001"); expect(document.activeElement).toBe(field("型号"));
    expect([...host.querySelectorAll("fieldset label > span")].slice(0, 2).map(span => span.textContent)).toEqual(["型号 *", "品牌 *"]);
    expect(host.querySelector(".ci-customer-inline-editor")?.closest("tr")?.previousElementSibling?.querySelector(".ci-material-part-col")).not.toBeNull();
    expect(host.querySelector(".ci-modal-backdrop")).toBeNull();
    expect(host.querySelector('[aria-label="关联渠道"]')).toBeNull();
    expect(host.querySelector('.ci-customer-inline-editor textarea')).toBeNull(); expect(host.innerHTML).not.toMatch(/PRIVATE-CHANNEL|PRIVATE-NOTE|responsibleUserId/);
    await input(field("可供数量"), "10"); await click(named("保存"));
    const payload = runtime.update.mock.calls[0][0];
    expect(payload).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 101, expectedRevision: 12, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i),
      partNumber: "MODEL-SUFFIX/EXACT", brand: "TI", qty: 10, price: "0.000000000001", dateCode: "2601", taxIncluded: false, leadTime: "现货" });
    expect(runtime.invalidate).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(runtime.list).toHaveBeenCalledTimes(2); expect(runtime.list.mock.calls.every(([input]) => input.customerId === 801)).toBe(true);
    expect(runtime.lookup.mock.calls.every(([input]) => input.listInput.customerId === 801 && input.refresh === false)).toBe(true);
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it("requires manual retention confirmation on each new model/brand and keeps zero/decimal strings exact", async () => {
    await render(); await click(editButton()); await input(field("型号"), "NEW-MODEL"); await click(named("保存"));
    expect(runtime.update).not.toHaveBeenCalled();
    let confirm = required(host.querySelector<HTMLInputElement>('[aria-label="确认保留已有手填参考价"]'));
    await click(confirm); await input(field("品牌"), "ADI"); confirm = required(host.querySelector<HTMLInputElement>('[aria-label="确认保留已有手填参考价"]'));
    expect(confirm.checked).toBe(false); await click(named("保存")); expect(runtime.update).not.toHaveBeenCalled();
    await click(required(host.querySelector('[aria-label="渠道参考价一恢复自动价"]'))); await input(manual("二"), "999999999999999.999999999999");
    expect(host.querySelector('[aria-label="确认保留已有手填参考价"]')).toBeNull(); await click(named("保存"));
    expect(runtime.update.mock.calls[0][0]).toMatchObject({ partNumber: "NEW-MODEL", brand: "ADI", manualReferenceLcsc: null, manualReferenceIckey: "999999999999999.999999999999" });
  });
  it.each(["01", "-1", "1e3", "1000000000000000", "0.1234567890123"])("rejects invalid hand-entered %s without an API call", async value => {
    await render(); await click(editButton()); await input(manual("一"), value); await click(named("保存"));
    expect(runtime.update).not.toHaveBeenCalled(); expect(host.querySelector('.ci-customer-inline-editor [role="alert"]')?.textContent).toContain("渠道参考价一须为非负十进制");
  });
  it("locks controls and retries an unknown receipt with the exact same manual payload/UUID; duplicate submits send once", async () => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    await render(); await click(editButton()); await input(manual("一"), "0.000000000001");
    const save = named("保存"); await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(runtime.update).toHaveBeenCalledTimes(1); const payload = runtime.update.mock.calls[0][0];
    expect(manual("一").disabled).toBe(true); expect(editButton().disabled).toBe(true);
    await input(manual("一"), "7"); await act(async () => pending.reject(new Error("unknown receipt"))); await settle();
    expect(manual("一").value).toBe("0.000000000001"); expect((named("取消") as HTMLButtonElement).disabled).toBe(true);
    await click(named("按原请求重试")); expect(runtime.update.mock.calls[1][0]).toEqual(payload);
    expect(payload.manualReferenceLcsc).toBe("0.000000000001"); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
  });
  it.each(["wrong-id", "denied", "readonly"])("does not open public edit fields for fresh %s detail", async failure => {
    const detail = { ...stock(), channelId: 11, revision: 12 };
    if (failure === "wrong-id") detail.id = 999;
    if (failure === "denied") detail.canEditMaterial = false;
    if (failure === "readonly") detail.readOnly = true;
    runtime.detail.mockResolvedValueOnce(detail); await render(); await click(editButton());
    expect(host.querySelector("fieldset")).toBeNull(); expect(runtime.update).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("库存编辑范围或写权限未能确认");
  });
  it.each(["other-channel", "other-customer", "missing-source"])("rejects fresh detail moved to %s even when edit grants remain true", async failure => {
    if (failure === "missing-source") runtime.rows = [stock({ channelSource: null })];
    runtime.detail.mockResolvedValueOnce({ ...stock(), channelId: failure === "other-channel" ? 22 : 11,
      company: { id: failure === "other-customer" ? 802 : 801, name: "不可按同名授权" }, revision: 12 });
    await render(); await click(editButton());
    expect(host.querySelector("fieldset")).toBeNull(); expect(runtime.update).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("库存编辑范围或写权限未能确认");
  });
  it("aborts late edit detail on disable and never resurrects it when the old read resolves", async () => {
    const pending = deferred<any>(); runtime.detail.mockReturnValueOnce(pending.promise);
    await render(); await click(editButton()); const signal = runtime.detail.mock.calls[0][1].signal;
    await render({ enabled: false }); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ ...stock(), channelId: 11 })); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(runtime.update).not.toHaveBeenCalled();
  });
  it("masks an open edit and ignores late write receipts after actor/enterprise changes without invalidating the new cache", async () => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise);
    await render(); await click(editButton()); await click(named("保存"));
    runtime.scope.storageScope = "scope-8-32"; runtime.scope.contextVerification.identity = "scope-8-32";
    runtime.scope.frontUser.id = 8; runtime.scope.staffPrincipal = { frontendUserId: 8, enterpriseId: 32 };
    await render({ identity: { key: "AUTH-B", actorUserId: 8, enterpriseId: 32 } });
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); await act(async () => pending.resolve({}));
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(runtime.list).toHaveBeenCalledTimes(2);
  });
  it("refreshes exact customer and saved references against the new model after success", async () => {
    runtime.detail.mockResolvedValueOnce({ ...stock(), channelId: 11, revision: 12 });
    runtime.update.mockImplementationOnce(async payload => { runtime.rows = [stock({ partNumber: payload.partNumber, brand: payload.brand, canEditMaterial: false })]; return {}; });
    await render(); await click(editButton()); await input(field("型号"), "NEW-MODEL"); await input(field("品牌"), "ADI"); await click(named("保存"));
    expect(host.querySelector(".ci-part-number-text")?.textContent).toBe("NEW-MODEL"); expect(editButton().disabled).toBe(true); expect(sourceCell().textContent).toBe("客户不可查看");
    expect(runtime.lookup).toHaveBeenCalledTimes(2); expect(runtime.lookup.mock.calls[1][0]).toEqual({ listInput: runtime.list.mock.calls[1][0], materialIds: [101], refresh: false });
  });
});

describe("the original customer proof and lifecycle never become global filtering", () => {
  it.each(["foreign-customer", "foreign-company", "missing-proof", "source-denied", "wrong-version"])("fails closed on %s, with no reference or edit IO", async failure => {
    runtime.list.mockImplementationOnce(input => { const value: any = page(input, [stock()]);
      if (failure === "foreign-customer") value.customerId = 802;
      if (failure === "foreign-company") value.items[0].company.id = 802;
      if (failure === "missing-proof") delete value.customerId;
      if (failure === "source-denied") value.items[0].canViewSource = false;
      if (failure === "wrong-version") value.customerVersion = 5;
      return Promise.resolve(value);
    });
    await render(); expect(host.textContent).not.toContain("MODEL-SUFFIX/EXACT"); expect(runtime.lookup).not.toHaveBeenCalled(); expect(runtime.detail).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("客户库存范围未能确认"); expect(runtime.authError).toHaveBeenCalledTimes(1);
  });
  it("keeps list abort/generation and ignores old-customer and old-reference results", async () => {
    const pendingList = deferred<any>(); runtime.list.mockReturnValueOnce(pendingList.promise);
    await render(); const oldInput = runtime.list.mock.calls[0][0], signal = runtime.list.mock.calls[0][1].signal;
    runtime.rows = [stock({ company: { id: 802, name: "当前客户" }, partNumber: "CURRENT-CUSTOMER" })];
    await render({ customerId: 802 }); expect(signal.aborted).toBe(true);
    await act(async () => pendingList.resolve(page(oldInput, [stock({ partNumber: "LATE-OTHER-CUSTOMER" })])));
    expect(host.textContent).toContain("CURRENT-CUSTOMER"); expect(host.textContent).not.toContain("LATE-OTHER-CUSTOMER");
    expect(runtime.list.mock.calls.every(([input]) => input.customerId === 801 || input.customerId === 802)).toBe(true);
  });
  it("does not query when disabled/isCurrent=false and retains the original verifier contract", async () => {
    await render({ enabled: false }); expect(runtime.list).not.toHaveBeenCalled();
    await render({ isCurrent: () => false }); expect(runtime.list).not.toHaveBeenCalled(); expect(runtime.lookup).not.toHaveBeenCalled();
    const input = customerInventoryInput(identity, 801, { partNumber: " ＬＭ３５８ ", brand: " TI " }, 1);
    expect(input).toMatchObject({ customerId: 801, partNumber: "LM358", brand: "TI" });
    expect(() => verifiedCustomerInventory(page(input) as any, input, 4)).not.toThrow();
  });
});

describe("customer search and authorization generation regression", () => {
  it("searches and pages only on the exact server-bound customer, including an explicit refresh", async () => {
    runtime.list.mockImplementation(input => Promise.resolve({ ...page(input, [stock({ partNumber: input.page === 1 ? "FIRST-PAGE" : "SECOND-PAGE" })]), total: 40, pageCount: 2 }));
    await render();
    await input(required(host.querySelector<HTMLInputElement>('[aria-label="筛选客户库存型号"]')), "  ＬＭ３５８  ");
    await input(required(host.querySelector<HTMLInputElement>('[aria-label="筛选客户库存品牌"]')), " TI ");
    expect(runtime.list).toHaveBeenCalledTimes(1);
    await act(async () => required(host.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(runtime.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, partNumber: "LM358", brand: "TI", page: 1 });
    await click(named("下一页")); expect(runtime.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, partNumber: "LM358", brand: "TI", page: 2 });
    expect(host.textContent).toContain("SECOND-PAGE"); expect(host.textContent).not.toContain("FIRST-PAGE");
    await click(named("刷新库存")); expect(runtime.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, page: 2 });
    expect(runtime.list.mock.calls.every(([input]) => input.customerId === 801 && input.pageSize === 20 && !input.channelId && !input.customerName)).toBe(true);
  });
  it("aborts saved-reference reads and cannot paint a late old-customer quote", async () => {
    const pending = deferred<any>(); runtime.lookup.mockReturnValueOnce(pending.promise);
    await render(); const oldReferences = referencePage(), signal = runtime.lookup.mock.calls[0][1].signal;
    runtime.rows = [stock({ company: { id: 802, name: "当前客户" }, partNumber: "NEW-CUSTOMER-MODEL", manualReferenceLcsc: "8.000000000001" })];
    await render({ customerId: 802 }); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(oldReferences)); await settle();
    expect(host.querySelector('[data-reference-source="lcsc"]')?.textContent).toBe("¥8.000000000001手填");
    expect(runtime.lookup.mock.calls.at(-1)?.[0].listInput.customerId).toBe(802);
    expect(runtime.lookup.mock.calls.every(([input]) => input.refresh === false)).toBe(true);
  });
  it("aborts an edit read on native write revocation and invalidates a source modal's current guard immediately", async () => {
    await render(); await more(); await click(named("查看来源")); const source = runtime.panel;
    expect(source.isCurrent()).toBe(true); await act(async () => source.onClose());
    const pending = deferred<any>(); runtime.detail.mockReturnValueOnce(pending.promise);
    await click(editButton()); const signal = runtime.detail.mock.calls[0][1].signal;
    runtime.scope.officialInventoryPermissions.write = false; await render(); expect(signal.aborted).toBe(true); expect(source.isCurrent()).toBe(false);
    await act(async () => pending.resolve({ ...stock(), channelId: 11 })); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(editButton().disabled).toBe(true);
    expect(runtime.update).not.toHaveBeenCalled(); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
});

describe("unconfirmed customer edits freeze ordinary list refresh, never real authority changes", () => {
  it.each(["focus", "refresh", "search", "pagination", "refreshVersion"])("preserves pending -> lost response -> %s -> original UUID/payload retry, then releases one reread", async reason => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    runtime.list.mockImplementation(input => Promise.resolve({ ...page(input), total: 40, pageCount: 2 }));
    const onOpenChange = vi.fn(); await render({ onOpenChange, refreshVersion: 1 }); await click(editButton());
    await input(field("可供数量"), "10"); await input(manual("一"), "0.000000000001");
    const dialog = required(host.querySelector('[role="dialog"], .ci-customer-inline-editor'));
    const oldRefresh = handlers(named("刷新库存")).onClick, oldPage = handlers(named("下一页")).onClick;
    const oldSubmit = handlers(required(host.querySelector("form"))).onSubmit;
    const trigger = async (version: number) => {
      if (reason === "focus") await act(async () => window.dispatchEvent(new Event("focus")));
      if (reason === "refresh") { await click(named("刷新库存")); await act(async () => oldRefresh()); }
      if (reason === "search") {
        await input(required(host.querySelector<HTMLInputElement>('[aria-label="筛选客户库存型号"]')), "FILTER-CHANGED");
        await click(named("搜索"));
        await act(async () => {
          required(host.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          oldSubmit({ preventDefault: vi.fn() });
        });
      }
      if (reason === "pagination") { await click(named("下一页")); await act(async () => oldPage()); }
      if (reason === "refreshVersion") await render({ ...props, identity: { ...identity }, refreshVersion: version });
      await settle();
    };
    await click(named("保存")); const payload = runtime.update.mock.calls[0][0];
    expect(runtime.update).toHaveBeenCalledTimes(1); expect(field("可供数量").matches(":disabled")).toBe(true);
    await trigger(2);
    expect(runtime.list).toHaveBeenCalledTimes(1); expect(runtime.detail).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBe(dialog); expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await act(async () => pending.reject(new Error("response lost"))); await settle();
    await trigger(3);
    expect(runtime.list).toHaveBeenCalledTimes(1); expect(runtime.lookup).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBe(dialog); expect(manual("一").value).toBe("0.000000000001");
    expect((named("搜索") as HTMLButtonElement).disabled).toBe(true); expect((named("刷新库存") as HTMLButtonElement).disabled).toBe(true);
    expect((named("下一页") as HTMLButtonElement).disabled).toBe(true); expect((named("取消") as HTMLButtonElement).disabled).toBe(true);
    expect(field("可供数量").value).toBe("10"); expect(host.textContent).toContain("保存结果未确认");
    await click(named("按原请求重试"));
    expect(runtime.update).toHaveBeenCalledTimes(2); expect(runtime.update.mock.calls[1][0]).toBe(payload);
    expect(payload).toMatchObject({ qty: 10, manualReferenceLcsc: "0.000000000001", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
    expect(runtime.list).toHaveBeenCalledTimes(2); expect(runtime.list.mock.calls[1][0]).toMatchObject({ page: 1, partNumber: undefined });
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect((named("刷新库存") as HTMLButtonElement).disabled).toBe(false);
    if (reason === "refreshVersion") {
      await render({ ...props, identity: { ...identity }, refreshVersion: 3 });
      expect(runtime.list).toHaveBeenCalledTimes(2); // queued external version was consumed, not silently dropped
    }
  });

  it("keeps a pending write current through repeated focus and external revisions, and acknowledges it without a retry", async () => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise);
    await render({ refreshVersion: 1 }); await click(editButton()); await click(named("保存"));
    const dialog = host.querySelector('[role="dialog"], .ci-customer-inline-editor');
    for (const refreshVersion of [2, 3]) {
      await act(async () => window.dispatchEvent(new Event("focus")));
      await render({ ...props, identity: { ...identity }, refreshVersion });
      expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBe(dialog); expect(runtime.list).toHaveBeenCalledTimes(1);
    }
    await act(async () => pending.resolve({})); await settle();
    expect(runtime.update).toHaveBeenCalledTimes(1); expect(runtime.invalidate).toHaveBeenCalledTimes(1); expect(runtime.list).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(host.textContent).not.toContain("保存结果未确认");
    await act(async () => window.dispatchEvent(new Event("focus"))); await settle(); expect(runtime.list).toHaveBeenCalledTimes(3);
  });

  it.each(["pending", "unknown"])("immediately rejects a stale retry when isCurrent changes before rerender (%s)", async state => {
    let current = true; const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise);
    await render({ isCurrent: () => current }); await click(editButton());
    const staleSave = handlers(named("保存")).onClick; await click(named("保存"));
    if (state === "unknown") { await act(async () => pending.reject(new Error("response lost"))); await settle(); }
    current = false; await act(async () => { staleSave(); window.dispatchEvent(new Event("focus")); });
    expect(runtime.update).toHaveBeenCalledTimes(1); expect(runtime.list).toHaveBeenCalledTimes(1);
    await render({ ...props, refreshVersion: 2 });
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
    if (state === "pending") { await act(async () => pending.resolve({})); await settle(); }
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(runtime.update).toHaveBeenCalledTimes(1);
  });

  it("old close and row-action closures cannot abandon or replace a pending/unknown editor", async () => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
    await render(); await click(editButton());
    const oldClose = handlers(required(host.querySelector('[aria-label="关闭库存编辑"]'))).onClick;
    const oldEdit = handlers(editButton()).onClick, dialog = host.querySelector('[role="dialog"], .ci-customer-inline-editor');
    await click(named("保存"));
    for (const state of ["pending", "unknown"]) {
      if (state === "unknown") { await act(async () => pending.reject(new Error("response lost"))); await settle(); }
      await act(async () => { oldClose(); oldEdit(); }); await settle();
      expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBe(dialog); expect(runtime.detail).toHaveBeenCalledTimes(1);
      expect(runtime.update).toHaveBeenCalledTimes(1);
    }
    const payload = runtime.update.mock.calls[0][0]; await click(named("按原请求重试"));
    expect(runtime.update.mock.calls[1][0]).toBe(payload); expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull();
  });

  it.each(["authorization", "native-write", "customerVersion"])("does not freeze real %s invalidation during pending save or process its late acknowledgement", async change => {
    const pending = deferred<any>(); runtime.update.mockReturnValueOnce(pending.promise);
    await render({ refreshVersion: 1 }); await click(editButton());
    const staleSave = handlers(named("保存")).onClick; await click(named("保存"));
    const overrides = { ...props, refreshVersion: 2 };
    if (change === "authorization") runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    if (change === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (change === "customerVersion") overrides.customerVersion = 5;
    await render(overrides); await act(async () => { staleSave(); pending.resolve({}); }); await settle();
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(runtime.detail).toHaveBeenCalledTimes(1);
  });

  it.each(["actor", "enterprise", "identity-key", "customer", "customerVersion", "authorization", "readVersion", "native-write", "native-read", "context", "disabled"])("invalidates unknown payload on real %s change even alongside external refreshVersion", async change => {
    runtime.update.mockRejectedValueOnce(new Error("response lost"));
    await render({ refreshVersion: 1 }); await click(editButton()); await click(named("保存"));
    const staleRetry = handlers(named("按原请求重试")).onClick;
    const overrides: Partial<CustomerChannelInventoryProps> = { ...props, refreshVersion: 2 };
    if (change === "actor") { overrides.identity = { ...identity, actorUserId: 8 }; runtime.scope.frontUser.id = 8; runtime.scope.staffPrincipal.frontendUserId = 8; }
    if (change === "enterprise") { overrides.identity = { ...identity, enterpriseId: 32 }; runtime.scope.staffPrincipal.enterpriseId = 32; }
    if (change === "identity-key") overrides.identity = { ...identity, key: "AUTH-CHANGED" };
    if (change === "customer") { overrides.customerId = 802; runtime.rows = [stock({ company: { id: 802, name: "新客户" } })]; }
    if (change === "customerVersion") overrides.customerVersion = 5;
    if (change === "authorization") runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    if (change === "readVersion") runtime.scope.contextVerification.readVersion = "read-v2";
    if (change === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (change === "native-read") runtime.scope.officialInventoryPermissions.read = false;
    if (change === "context") runtime.scope.contextVerification.state = "revalidating";
    if (change === "disabled") overrides.enabled = false;
    await render(overrides); await act(async () => staleRetry());
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(runtime.detail).toHaveBeenCalledTimes(1);
  });
});

describe("confirmed saves are independent from refresh failures", () => {
  it.each(["reject", "throw"])("closes a confirmed save even when identity-scoped cache invalidation %s fails, and a later save uses a new UUID", async failure => {
    if (failure === "reject") runtime.invalidate.mockRejectedValue(new Error("cache refresh failed"));
    else runtime.invalidate.mockImplementation(() => { throw new Error("cache invalidation unavailable"); });
    const onOpenChange = vi.fn(); await render({ onOpenChange }); await click(editButton()); await click(named("保存"));
    expect(runtime.update).toHaveBeenCalledTimes(1); const firstId = runtime.update.mock.calls[0][0].requestId;
    expect(runtime.invalidate).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(host.textContent).not.toMatch(/保存结果未确认|按原请求重试/);
    expect(onOpenChange).toHaveBeenLastCalledWith(false); expect(editButton().disabled).toBe(false); expect(runtime.list).toHaveBeenCalledTimes(2);
    await click(editButton()); await click(named("保存"));
    expect(runtime.update).toHaveBeenCalledTimes(2); expect(runtime.update.mock.calls[1][0].requestId).not.toBe(firstId);
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(runtime.authError).not.toHaveBeenCalled();
  });
  it("shows a list reread error without freezing or retrying the confirmed write", async () => {
    await render(); await click(editButton()); runtime.list.mockRejectedValueOnce(new Error("customer list refresh failed")); await click(named("保存"));
    expect(runtime.update).toHaveBeenCalledTimes(1); const savedId = runtime.update.mock.calls[0][0].requestId;
    expect(host.querySelector('[role="dialog"], .ci-customer-inline-editor')).toBeNull(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("customer list refresh failed");
    expect(host.textContent).not.toMatch(/保存结果未确认|按原请求重试/);
    await click(named("刷新库存")); await click(editButton()); await click(named("保存"));
    expect(runtime.update).toHaveBeenCalledTimes(2); expect(runtime.update.mock.calls[1][0].requestId).not.toBe(savedId);
  });
});
