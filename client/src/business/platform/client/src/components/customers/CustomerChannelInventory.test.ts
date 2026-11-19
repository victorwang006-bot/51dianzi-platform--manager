// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const runtime = vi.hoisted(() => ({
  query: vi.fn(), detail: vi.fn(), update: vi.fn(), remove: vi.fn(), lookup: vi.fn(), invalidate: vi.fn(),
  authError: vi.fn(), panel: null as any, publish: null as any,
  native: { read: true, write: true, note: true, publish: true, authorizationVersion: "native-v1" }, role: "user",
  scope: { merchantId: 55, storageScope: "scope-7-31", staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
    contextVerification: { identity: "scope-7-31", state: "verified", authorizationVersion: "auth-v1", readVersion: "read-v1" } },
}));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ ...runtime.scope, frontUser: { id: 7, role: runtime.role }, officialInventoryPermissions: runtime.native }) }));
vi.mock("../../../../../api/business-trpc", () => {
  const utils = { client: { channelInventory: { listTeamMaterials: { query: runtime.query }, getTeamMaterialForEdit: { query: runtime.detail } } },
    channelInventory: { listTeamMaterials: { invalidate: runtime.invalidate } } };
  return {
    createBusinessScopeTrpcClient: (merchantId: number) => {
      expect(merchantId).toBe(runtime.scope.merchantId);
      return { channelReference: { lookup: { query: runtime.lookup } } };
    },
    trpc: { useUtils: () => utils, channelInventory: { updateTeamMaterial: { useMutation: () => ({ mutateAsync: runtime.update }) }, deleteMaterials: { useMutation: () => ({ mutateAsync: runtime.remove }) } } },
  };
});
// Keep materialFormFrom, the shared editor and copy-model helpers real; only
// replace the private modal boundary, not the Host's production exports.
vi.mock("../../pages/ChannelInventoryHost", async importOriginal => ({
  ...await importOriginal<typeof import("../../pages/ChannelInventoryHost")>(),
  PrivateNotesPanel: (props: any) => { runtime.panel = props; return React.createElement("div", { role: "dialog" }, "PRIVATE"); },
}));
vi.mock("../channelInventory/ChannelInventorySourcePanel", async importOriginal => ({
  ...await importOriginal<typeof import("../channelInventory/ChannelInventorySourcePanel")>(),
  ChannelInventorySourcePanel: (props: any) => { runtime.panel = props; return React.createElement("div", { role: "dialog" }, "SOURCE"); },
}));
vi.mock("../channelInventory/CollaborationNotesPanel", () => ({ CollaborationNotesPanel: (props: any) => { runtime.panel = props; return React.createElement("div", { role: "dialog" }, "NOTES"); } }));
vi.mock("../channelInventory/FactoryMaterialPublish", () => ({ useFactoryMaterialPublish: (props: any) => {
  runtime.publish = props;
  return { dialog: null, action: (row: any) => React.createElement("button", { disabled: !props.authorized || !props.available || row.canPublish !== true }, "发布") };
} }));
import { CustomerChannelInventory, customerInventoryInput, verifiedCustomerInventory, type CustomerChannelInventoryProps } from "./CustomerChannelInventory";
import { inventoryCompanyLabel } from "../channelInventory/company";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-A" };
function row(id = 101, partNumber = "SAME-MODEL") { return { id, revision: 1, partNumber, brand: "TI", qty: 0, price: "0", currency: "CNY", taxIncluded: false,
  updatedAt: "2026-11-10 12:34:56", originalRecorderName: "授权负责人", leadTime: null,
  canViewSource: true, canEditMaterial: true, canEdit: true, readOnly: false, isMine: true, canAddNote: true, noteCount: 3, canPublish: true, publicationStatus: "unpublished", company: { id: 801, name: "客户公司" } }; }
function result(input: any, items = [row()], total = items.length, bindingCount = 2) { return { customerId: input.customerId, customerVersion: 4, bindingCount, items,
  total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize), canWrite: true, canFilterSource: false }; }
function referenceQuote(source: "lcsc" | "ickey") {
  return { source, status: "not_found", matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null,
    stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown",
    packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
let root: Root; let host: HTMLDivElement; let latestProps: CustomerChannelInventoryProps;
async function render(overrides: Partial<CustomerChannelInventoryProps> = {}) {
  latestProps = { customerId: 801, customerVersion: 4, identity, enabled: true, onAuthorizationError: runtime.authError, ...overrides };
  await act(async () => { root.render(React.createElement(CustomerChannelInventory, latestProps)); await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function named(text: string) { const found = [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(item => item.textContent?.trim() === text); if (!found) throw new Error(`Missing ${text}`); return found; }
function button(text: string) { const found = named(text); if (!(found instanceof HTMLButtonElement)) throw new Error(`Not a button: ${text}`); return found; }
async function click(text: string) { await act(async () => named(text).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await settle(); }
async function more() {
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label^="更多库存操作："]');
  if (!trigger) throw new Error("Missing customer inventory more-actions trigger");
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))); await settle();
}
function edit(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => {
  runtime.query.mockReset().mockImplementation(input => Promise.resolve(result(input)));
  runtime.detail.mockReset().mockImplementation(() => { throw new Error("Old lifecycle tests must not read edit details"); });
  runtime.update.mockReset().mockImplementation(() => { throw new Error("Old lifecycle tests must not write inventory"); });
  runtime.invalidate.mockReset().mockResolvedValue(undefined);
  runtime.lookup.mockReset().mockImplementation(async ({ listInput, materialIds, refresh }) => {
    expect(listInput.customerId).toBe(latestProps.customerId); expect(refresh).toBe(false);
    const index = runtime.query.mock.calls.findLastIndex(([input]) => JSON.stringify(input) === JSON.stringify(listInput));
    if (index < 0) throw new Error("References require an exact customer-scoped list first");
    const served = await runtime.query.mock.results[index].value;
    expect(served.customerId).toBe(listInput.customerId);
    return { items: materialIds.map((materialId: number) => {
      const item = served.items.find((stock: any) => stock.id === materialId);
      if (!item) throw new Error("Reference material is not in the served customer page");
      return { materialId, partNumber: item.partNumber, brand: item.brand,
        references: { lcsc: referenceQuote("lcsc"), ickey: referenceQuote("ickey") } };
    }) };
  });
  runtime.authError.mockReset(); runtime.panel = null; runtime.publish = null; runtime.role = "user";
  runtime.native = { read: true, write: true, note: true, publish: true, authorizationVersion: "native-v1" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network in offline inventory tests"); }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(runtime.detail).not.toHaveBeenCalled(); expect(runtime.update).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("customer-bound channel inventory", () => {
  it("queries exact customer ID on the existing server endpoint, no channel/name/demand filtering", async () => {
    await render();
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(runtime.query.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, partNumber: undefined, brand: undefined, page: 1, pageSize: 20 });
    expect(runtime.query.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });
    expect([...host.querySelectorAll("th")].map(th => th.textContent)).toEqual(["", "型号", "品牌", "负责人", "来源客户", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "操作"]);
    expect(host.textContent).toContain("共 1 条"); expect(host.textContent).toContain("SAME-MODEL"); expect(host.textContent).toContain("¥0"); expect(host.textContent).toContain("未税");
    expect(host.querySelector("td.ci-material-qty-col")?.textContent).toBe("0");
    expect(host.querySelector("td.ci-material-source-col")?.textContent).toBe("客户公司");
    expect([...host.querySelectorAll(".ci-row-actions button")].map(item => item.textContent)).toEqual(["编辑", "删除", "更多"]);
  });
  it("removes the fixed filter explanation node without losing search, refresh or pagination", async () => {
    await render();
    expect(host.querySelector(".ci-readonly")).toBeNull();
    expect(host.textContent).not.toContain("仅汇总本客户公司作为供货方的已确认绑定渠道库存；搜索不匹配采购需求，也不会展示其他公司的同型号库存。");
    expect(host.querySelector("form")?.nextElementSibling?.classList.contains("ci-tablewrap")).toBe(true);
    expect(button("搜索").disabled).toBe(false); expect(button("刷新库存").disabled).toBe(false);
    expect(host.querySelector('[aria-label="客户渠道库存分页"]')).not.toBeNull();
    await render({ enabled: false });
    expect(button("搜索").disabled).toBe(true); expect(button("刷新库存").disabled).toBe(true);
    expect(runtime.query).toHaveBeenCalledTimes(1); expect(host.textContent).not.toContain("SAME-MODEL");
  });
  it("uses server searches and paging, never fetches broad inventory to filter locally", async () => {
    runtime.query.mockImplementation(input => Promise.resolve(result(input, input.page === 1 ? [row()] : [row(102, "PAGE-TWO")], 40)));
    await render(); edit("筛选客户库存型号", "  ＬＭ３５８  "); edit("筛选客户库存品牌", " TI ");
    expect(runtime.query).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(runtime.query.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, partNumber: "LM358", brand: "TI", page: 1 });
    await click("下一页"); expect(runtime.query.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, partNumber: "LM358", brand: "TI", page: 2 });
    expect(host.textContent).toContain("PAGE-TWO"); expect(host.textContent).not.toContain("SAME-MODEL");
    await click("刷新库存"); expect(runtime.query.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, page: 2 });
  });
  it.each(["wrong-customer", "missing-proof", "foreign-company", "source-denied", "invalid-pagination", "wrong-version"])("fails closed on %s without showing any returned material", async kind => {
    runtime.query.mockImplementation(input => {
      const data: any = result(input, [row(999, "OTHER-COMPANY-STOCK")]);
      if (kind === "wrong-customer") data.customerId = 802;
      if (kind === "missing-proof") delete data.customerId;
      if (kind === "foreign-company") data.items[0].company.id = 802;
      if (kind === "source-denied") data.items[0].canViewSource = false;
      if (kind === "invalid-pagination") data.page = 2;
      if (kind === "wrong-version") data.customerVersion = 5;
      return Promise.resolve(data);
    });
    await render(); expect(host.textContent).not.toContain("OTHER-COMPANY-STOCK");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("客户库存范围未能确认");
    expect(runtime.query).toHaveBeenCalledTimes(1); expect(runtime.authError).toHaveBeenCalledTimes(1);
  });
  it("keeps errors retryable with the same fixed customer and no unscoped fallback", async () => {
    runtime.query.mockRejectedValueOnce(new Error("BAD_REQUEST: customerId unsupported")); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("customerId unsupported");
    expect(host.textContent).not.toContain("SAME-MODEL"); await click("刷新库存");
    expect(host.textContent).toContain("SAME-MODEL"); expect(runtime.query.mock.calls.every(([input]) => input.customerId === 801 && !input.channelId)).toBe(true);
  });
  it("renders no explanation or placeholder for zero bindings and retains bound-channel no-results after refresh", async () => {
    runtime.query.mockImplementation(input => Promise.resolve(result(input, [], 0, 0))); await render();
    expect(host.textContent).not.toContain("当前没有可读取的已确认渠道库存。可能尚未绑定、暂无活动库存或当前来源权限不足；请核对权限和库存表，在渠道设置中人工选择并确认供货渠道。不能按公司名或需求型号自动关联。");
    expect(host.textContent).not.toContain("人工选择并确认"); expect(host.textContent).not.toContain("不能按公司名或需求型号自动关联");
    expect(host.textContent).not.toContain("暂无活动库存或当前来源权限不足");
    expect(host.textContent).not.toContain("尚无已确认的供货渠道绑定");
    expect(host.textContent).not.toContain("SAME-MODEL"); expect(host.textContent).not.toContain("暂无库存");
    expect(host.querySelector("tbody")?.children).toHaveLength(0);
    expect(host.querySelector("tbody")?.textContent).toBe(""); expect(host.querySelector("tbody .ci-empty")).toBeNull();
    expect(host.textContent).toContain("共 0 条");
    expect(host.querySelectorAll("th")).toHaveLength(10);
    expect(button("搜索").disabled).toBe(false); expect(button("刷新库存").disabled).toBe(false);
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(runtime.query.mock.calls[0][0]).toMatchObject({ customerId: 801, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    runtime.query.mockImplementation(input => Promise.resolve(result(input, [], 0, 2))); await click("刷新库存");
    expect(host.textContent).toContain("已确认绑定渠道暂无符合筛选条件");
    expect(host.textContent).not.toContain("尚无已确认的供货渠道绑定");
    expect(host.textContent).not.toContain("SAME-MODEL"); expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.textContent).toContain("共 0 条");
    expect(runtime.query).toHaveBeenCalledTimes(2);
    expect(runtime.query.mock.calls.every(([input]) => input.customerId === 801 && !input.channelId && !input.customerName)).toBe(true);
    expect(runtime.authError).not.toHaveBeenCalled();
  });
  it("does not query or leak rows while customer/scope verification is pending or revoked", async () => {
    await render({ enabled: false }); expect(runtime.query).not.toHaveBeenCalled();
    await render(); expect(host.textContent).toContain("SAME-MODEL");
    await render({ isCurrent: () => false }); expect(host.textContent).not.toContain("SAME-MODEL");
    expect(runtime.query).toHaveBeenCalledTimes(1);
  });
  it("aborts stale customer requests and cannot resurrect late old-customer results", async () => {
    let finish!: (value: any) => void;
    runtime.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
    const oldInput = runtime.query.mock.calls[0][0]; const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    runtime.query.mockImplementation(input => Promise.resolve({ ...result(input, [row(102, "CURRENT-CUSTOMER")]), items: [{ ...row(102, "CURRENT-CUSTOMER"), company: { id: 802, name: "另公司" } }] }));
    await render({ customerId: 802 }); expect(signal.aborted).toBe(true);
    await act(async () => finish(result(oldInput, [row(101, "LATE-OLD-STOCK")]))); await settle();
    expect(host.textContent).toContain("CURRENT-CUSTOMER"); expect(host.textContent).not.toContain("LATE-OLD-STOCK");
  });
  it("reuses source and notes dialogs, preserving parent guards and native write-note boundaries", async () => {
    const onOpenChange = vi.fn(); await render({ onOpenChange }); await more(); await click("查看来源");
    const source = runtime.panel; expect(source.materialId).toBe(101); expect(source.isCurrent()).toBe(true);
    expect(source.enterpriseId).toBe(31); expect(source.actorUserId).toBe(7); expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await act(async () => source.onClose()); expect(onOpenChange).toHaveBeenLastCalledWith(false);
    runtime.native.note = false; await render({ onOpenChange }); await more();
    expect([...document.querySelectorAll("button, [role=menuitem]")].some(item => item.textContent === "本人备注")).toBe(false);
    await click("备注（3）");
    expect(runtime.panel.canWriteNote).toBe(false); expect(runtime.panel.canAddNote).toBe(false);
    expect([...document.querySelectorAll("button, [role=menuitem]")].some(item => item.textContent === "本人备注")).toBe(false);
    await render({ enabled: false }); expect(source.isCurrent()).toBe(false); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("rejects deferred source actions after customer/context changes", async () => {
    let pending!: () => void; const onAction = (action: () => void) => { pending = action; };
    await render({ onAction }); await more(); await click("查看来源"); expect(host.querySelector('[role="dialog"]')).toBeNull();
    await render({ identity: { ...identity, key: "AUTH-B" }, onAction });
    await act(async () => pending()); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not substitute inventory-edit or row ownership for native publish", async () => {
    runtime.native.publish = false; await render(); await more(); expect(runtime.publish.available).toBe(false); expect(button("发布").disabled).toBe(true);
    runtime.native.publish = true; runtime.role = "viewer"; await render(); await more(); expect(runtime.publish.authorized).toBe(false); expect(button("发布").disabled).toBe(true);
  });
});

it("company display never infers ownership from matching company/source names, part number or brand", () => {
  expect(inventoryCompanyLabel({ company: { id: 801, name: "精确公司" } })).toBe("精确公司");
  expect(inventoryCompanyLabel({ company: null })).toBe("未确认或不可查看");
  expect(inventoryCompanyLabel({ company: { id: 0, name: "同名来源" } })).toBe("未确认或不可查看");
  const input = customerInventoryInput(identity, 801, { partNumber: "", brand: "" }, 1);
  expect(() => verifiedCustomerInventory(result(input) as any, input, 4)).not.toThrow();
});

it("keeps inventory query/proof guards and all non-zero-binding status branches in source", () => {
  const source = readFileSync("client/src/business/platform/client/src/components/customers/CustomerChannelInventory.tsx", "utf8");
  expect(source).not.toContain('<p className="ci-readonly">');
  expect(source).not.toContain("当前没有可读取的已确认渠道库存。");
  expect(source).toContain("result.bindingCount === 0 ? null : !rows.length ? <tr>");
  expect(source).toContain("if (!readable) return;");
  expect(source).toContain("utils.client.channelInventory.listTeamMaterials.query(input, { signal: controller.signal })");
  expect(source).toContain("verifiedCustomerInventory(value, input, props.customerVersion)");
  expect(source).toContain("result.customerId !== input.customerId");
  expect(source).toContain("result.bindingCount === 0 && (result.total !== 0 || result.items.length !== 0)");
  expect(source).toContain("正在核验客户库存读取权限…"); expect(source).toContain("正在读取客户渠道库存…");
  expect(source).toContain('className="ci-empty ci-host-error" role="alert">{error}');
  expect(source).toContain("客户库存范围尚未确认。"); expect(source).toContain("已确认绑定渠道暂无符合筛选条件的库存。");
  expect(source).toContain('disabled={!readable || editBusy || retryLocked || deleteLocked}>搜索');
  expect(source).toContain('disabled={!readable || editBusy || retryLocked || deleteLocked} onClick={() => void refresh()}>刷新库存');
});
