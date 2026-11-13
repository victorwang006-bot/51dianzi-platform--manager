// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router, Route, Link, useLocation } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  identity: "", ready: true, contextError: false, detailError: false,
  enterpriseId: 31, detail: null as any, getOptions: [] as any[],
  authorizationVersion: "auth-A", contextFetched: true, detailFetched: true, contextFetching: false, detailFetching: false,
  contextPlaceholder: false, detailPlaceholder: false, contactsDirty: false, contactsBusy: false, contactsProps: null as any,
  canManageAll: false,
  mutations: Object.fromEntries(["updateBasic", "addFollowUp", "transfer", "archive", "restore"].map(name => [name, { isPending: false, mutateAsync: vi.fn() }])),
  getInvalidate: vi.fn(), listInvalidate: vi.fn(), contactError: vi.fn((error: Error) => error.message),
  orderSummaryInvalidate: vi.fn(), orderMaterialsInvalidate: vi.fn(),
  canReadOrders: false, ordersDirty: false, demandsDirty: false, demandProps: null as any, orderProps: null as any,
  supplyProps: null as any,
}));
vi.mock("../hooks/usePageIdentity", () => ({ usePageIdentity: () => runtime.identity }));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => ({ contextVerification: { authorizationVersion: runtime.authorizationVersion } }) }));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: any) => children }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../components/customers/CustomerContactsManager", () => ({ CustomerContactsManager: (props: any) => {
  runtime.contactsProps = props;
  React.useEffect(() => { props.onDirtyChange?.(runtime.contactsDirty); props.onBusyChange?.(runtime.contactsBusy); }, [runtime.contactsDirty, runtime.contactsBusy, props.onDirtyChange, props.onBusyChange]);
  return props.open ? React.createElement("p", {}, "synthetic-contact-editor") : null;
} }));
vi.mock("../components/customerDemands/CustomerDemandHistory", () => ({ CustomerDemandHistory: (props: any) => {
  runtime.demandProps = props;
  React.useEffect(() => { props.onDirtyChange?.(runtime.demandsDirty); }, [runtime.demandsDirty, props.onDirtyChange]);
  return React.createElement("button", { onClick: () => props.onCreateOrder?.({ demandId: 901, demandNo: "D-SYNTHETIC" }) }, "synthetic-create-order");
} }));
vi.mock("../components/customerDemands/CustomerDemandDialog", () => ({ CustomerDemandDialog: () => null }));
vi.mock("../components/customers/CustomerWorkbenchOverview", () => ({ CustomerWorkbenchOverview: () => null }));
vi.mock("../components/customers/CustomerWorkbenchContacts", () => ({ CustomerWorkbenchContacts: () => null }));
vi.mock("../components/customers/CustomerWorkbenchSupply", () => ({ CustomerWorkbenchSupply: (props: any) => {
  runtime.supplyProps = props;
  const [, navigate] = useLocation();
  return React.createElement(React.Fragment, {},
    React.createElement("button", { onClick: () => props.onAction(() => props.onOpenChange(true)) }, "synthetic-open-supply"),
    React.createElement("button", { onClick: () => { props.onOpenChange(false); navigate("/channel-inventory?supplyChannelId=411&supplyTab=materials"); } }, "synthetic-finish-supply"));
} }));
vi.mock("../components/customers/useCustomerWorkbenchOrders", () => ({ useCustomerWorkbenchOrders: () => ({ canRead: runtime.canReadOrders, failed: false }) }));
vi.mock("./CrmSalesOrders", () => ({ CustomerSalesOrders: (props: any) => {
  runtime.orderProps = props;
  React.useEffect(() => { props.onDirtyChange?.(runtime.ordersDirty); }, [runtime.ordersDirty, props.onDirtyChange]);
  return React.createElement("p", { "data-order-read": props.canRead, "data-order-write": props.canWrite }, "synthetic-orders");
} }));
vi.mock("../components/customers/CustomerFields", () => ({ CustomerFields: ({ value, onChange }: any) => React.createElement("div", {},
  React.createElement("span", { "data-editor-name": true }, value.name),
  React.createElement("button", { onClick: () => onChange({ ...value, name: "PRIVATE UNSAVED DRAFT" }) }, "synthetic-edit")) }));
vi.mock("../components/customers/customerContacts", () => ({
  useCustomerContactScope: () => ({ ready: runtime.ready, scope: runtime.ready ? { actorUserId: 7, enterpriseId: runtime.enterpriseId, canManageAll: false } : null,
    identityKey: `${runtime.identity}:${runtime.enterpriseId}:${runtime.ready}` }),
  contactErrorMessage: runtime.contactError, customerContactBaseData: () => ({}),
  isDuplicateContactConflict: () => false, validateCustomerContactBase: () => ({}), withCustomerContactScope: (_scope: unknown, input: unknown) => input,
}));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ customer: { get: { invalidate: runtime.getInvalidate }, list: { invalidate: runtime.listInvalidate } }, crmSalesOrder: { customerSummary: { invalidate: runtime.orderSummaryInvalidate }, customerMaterials: { invalidate: runtime.orderMaterialsInvalidate } } }),
  customer: {
    context: { useQuery: () => ({ data: { actorUserId: 7, canManageAll: runtime.canManageAll, members: [{ userId: 7, name: "synthetic seller" }] }, isPending: false, isError: runtime.contextError, isFetchedAfterMount: runtime.contextFetched, isFetching: runtime.contextFetching, isPlaceholderData: runtime.contextPlaceholder, error: new Error("授权已撤销"), refetch: vi.fn() }) },
    get: { useQuery: (_input: unknown, options: any) => { runtime.getOptions.push(options); return { data: runtime.detail, isPending: false, isError: runtime.detailError, isFetchedAfterMount: runtime.detailFetched, isFetching: runtime.detailFetching, isPlaceholderData: runtime.detailPlaceholder, error: new Error("客户访问已撤销"), refetch: vi.fn() }; } },
    updateBasic: { useMutation: () => runtime.mutations.updateBasic }, addFollowUp: { useMutation: () => runtime.mutations.addFollowUp },
    transfer: { useMutation: () => runtime.mutations.transfer }, archive: { useMutation: () => runtime.mutations.archive }, restore: { useMutation: () => runtime.mutations.restore },
  },
} }));
import CustomerDetail from "./CustomerDetail";
import { toast } from "sonner";
import * as customerUtils from "../components/customers/customerUtils";
import * as memory from "../lib/pageMemory";
const nativeReplace = History.prototype.replaceState;
const META = "__d51PageMemory";
const defaults = { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false, starredOnly: false };
let root: Root;
let host: HTMLDivElement;
let serial = 0;
const record = (changes: any = {}) => ({ id: 801, enterpriseId: 31, name: "SYNTHETIC CURRENT CUSTOMER", contactName: "PRIVATE CONTACT", phone: "PRIVATE PHONE", email: "", address: "", province: "", city: "", district: "", source: "", scale: "unknown", grade: "A", stage: "following", industryCode: "electronic_components", nextFollowUpAt: null, version: 1, archivedAt: null, assignedUserId: 7, assignedName: "synthetic seller", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...changes });
function pop() { return new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true })); }
function NavigationHarness() {
  const [, navigate] = useLocation();
  return React.createElement(React.Fragment, {},
    React.createElement(Link, { href: "/outside", "data-side-link": true }, "Synthetic sideLink"),
    React.createElement("button", { onClick: () => navigate("/outside") }, "Synthetic navigate"),
    React.createElement(Route, { path: "/customers/:id", component: CustomerDetail }));
}
async function render() { await act(async () => root.render(React.createElement(Router, { base: "/workbench" }, React.createElement(NavigationHarness)))); }
function button(label: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label); if (!found) throw new Error(`missing ${label}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }
async function prepareSource() {
  nativeReplace.call(history, {}, "", "/workbench/customers?merchantId=30061&source=actual"); memory.setPageMemoryScope(runtime.identity);
  memory.writePageSlot("appliedFilters", { ...defaults, keyword: "applied UI", starredOnly: true }); memory.writePageSlot("page", 4);
  history.pushState({}, "", "/workbench/customers/801?merchantId=30061"); await render();
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.identity = `synthetic-detail:staff:7:admin:101:enterprise:31:merchant:30061:binding:${++serial}`;
  runtime.authorizationVersion = "auth-A"; runtime.contextFetched = true; runtime.detailFetched = true; runtime.contextFetching = false; runtime.detailFetching = false;
  runtime.contextPlaceholder = false; runtime.detailPlaceholder = false; runtime.contactsDirty = false; runtime.contactsBusy = false; runtime.contactsProps = null; runtime.canManageAll = false;
  vi.clearAllMocks();
  Object.values(runtime.mutations).forEach(mutation => { mutation.isPending = false; mutation.mutateAsync.mockReset(); mutation.mutateAsync.mockResolvedValue({ replayed: false }); });
  runtime.getInvalidate.mockReset(); runtime.listInvalidate.mockReset();
  runtime.ready = true; runtime.enterpriseId = 31; runtime.contextError = false; runtime.detailError = false; runtime.getOptions = [];
  runtime.detail = { customer: record(), followUps: [] };
  runtime.canReadOrders = false; runtime.ordersDirty = false; runtime.demandsDirty = false; runtime.demandProps = null; runtime.orderProps = null;
  runtime.supplyProps = null;
  memory.setPageMemoryScope(null); nativeReplace.call(history, {}, "", "/workbench/customers/801?merchantId=30061");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); memory.setPageMemoryScope(null); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.sequential("actual CustomerDetail memory and authorization rendering", () => {
  it("the detail back button and browser back restore the same exact page-4 starred source", async () => {
    await prepareSource(); const source = history.state[META].previous;
    const first = pop(); await click("返回上一页"); await act(async () => first);
    expect(history.state[META].id).toBe(source); expect(memory.readPageSlot("page", 1)).toBe(4);
    expect(memory.readPageSlot("appliedFilters", defaults)).toEqual({ ...defaults, keyword: "applied UI", starredOnly: true });
    await act(async () => history.pushState({}, "", "/workbench/customers/801?merchantId=30061")); await render();
    const second = pop(); await act(async () => { history.back(); await second; });
    expect(history.state[META].id).toBe(source); expect(memory.readPageSlot("page", 1)).toBe(4);
  });

  it("orphan detail back uses actual wouter /workbench+merchant bridge and the saved source URL snapshot", async () => {
    await prepareSource();
    memory.setPageMemoryScope(null);
    nativeReplace.call(history, { [META]: { id: "orphan-source", scope: runtime.identity } }, "", "/workbench/customers/801?merchantId=30061");
    const back = vi.spyOn(history, "back"); await render(); await click("返回上一页");
    expect(back).not.toHaveBeenCalled(); expect(window.location.pathname).toBe("/workbench/customers");
    expect(window.location.search).toBe("?merchantId=30061&source=actual"); expect(memory.readPageSlot("page", 1)).toBe(4);
  });

  it("does not render retained business data after context/get revocation or enterprise mismatch", async () => {
    await render(); expect(host.textContent).toContain("PRIVATE CONTACT");
    runtime.contextError = true; await render(); expect(host.textContent).not.toContain("PRIVATE CONTACT"); expect(host.textContent).toContain("授权已撤销");
    runtime.contextError = false; runtime.detailError = true; await render(); expect(host.textContent).not.toContain("PRIVATE CONTACT"); expect(host.textContent).toContain("客户访问已撤销");
    runtime.detailError = false; runtime.enterpriseId = 32; await render(); expect(host.textContent).not.toContain("SYNTHETIC CURRENT CUSTOMER");
  });

  it("binding/account identity changes cannot reuse a dirty editor for the same customer id", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit"); expect(host.textContent).toContain("PRIVATE UNSAVED DRAFT");
    runtime.identity += "-new-binding"; runtime.detail = { customer: record({ name: "NEW IDENTITY DATA" }), followUps: [] };
    await render(); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT"); await click("展开");
    expect(host.querySelector("[data-editor-name]")?.textContent).toBe("NEW IDENTITY DATA");
    const raw = sessionStorage.getItem("51dianzi:page-memory:v1:" + runtime.identity)!;
    expect(raw).not.toContain("PRIVATE"); expect(raw).not.toContain("NEW IDENTITY DATA");
  });

  it("blocks reads/display while current contact authority is unavailable and clears private drafts", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit");
    runtime.ready = false; await render(); expect(host.textContent).not.toContain("PRIVATE"); expect(runtime.getOptions.at(-1).enabled).toBe(false);
    runtime.ready = true; await render(); await click("展开"); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT");
    expect(runtime.getOptions.at(-1)).toMatchObject({ enabled: true, staleTime: 0, refetchOnMount: "always", placeholderData: undefined });
  });

  it("renders six deep-link tabs and normalizes an invalid tab to overview without losing merchant", async () => {
    nativeReplace.call(history, {}, "", "/workbench/customers/801?merchantId=30061&tab=bad&follow=1");
    await render();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(6);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("概览");
    expect(window.location.search).toBe("?merchantId=30061&tab=overview");
    await click("公司与联系人"); expect(window.location.search).toContain("tab=company");
  });

  it("legacy material bookmark opens only the replacement customer inventory and preserves merchant", async () => {
    nativeReplace.call(history, {}, "", "/workbench/customers/801?merchantId=30061&tab=materials&source=list");
    await render();
    expect(window.location.search).toBe("?merchantId=30061&tab=inventory&source=list");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(runtime.supplyProps.customerId).toBe(801);
    expect(runtime.supplyProps.scope.enterpriseId).toBe(31);
    expect(runtime.supplyProps.scopeReady).toBe(true);
    expect(host.textContent).not.toContain("客户需求物料");
    expect(host.textContent).not.toContain("客户订单物料快照");
  });

  it("top create reuses demand token and demand callbacks embed current-customer orders", async () => {
    runtime.canReadOrders = true; await render(); await click("新增需求");
    expect(runtime.demandProps.customer.id).toBe(801); expect(runtime.demandProps.createRequestToken).toBeGreaterThan(0);
    expect(runtime.demandProps.canManageOrders).toBe(true);
    await click("synthetic-create-order");
    expect(window.location.search).toContain("tab=orders"); expect(runtime.orderProps.customer.id).toBe(801);
    expect(runtime.orderProps.intent).toMatchObject({ mode: "create", demandId: 901, demandNo: "D-SYNTHETIC" });
    expect(runtime.orderProps.canRead).toBe(true); expect(runtime.orderProps.canWrite).toBe(true);
    await act(async () => runtime.orderProps.onIntentHandled(runtime.orderProps.intent.nonce));
    expect(runtime.orderProps.intent).toBeNull();
  });

  it("blocks tab/back/new actions while a demand or order draft/transaction is dirty", async () => {
    runtime.canReadOrders = true; await render(); await click("客户订单");
    runtime.ordersDirty = true; await render(); await click("概览");
    expect(window.location.search).toContain("tab=orders"); expect(document.body.textContent).toContain("当前需求或订单尚未完成");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "继续当前操作")!;
    await act(async () => confirm.click()); await click("返回上一页"); expect(window.location.search).toContain("tab=orders");
    runtime.ordersDirty = false; await render();
    const close = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "继续当前操作")!;
    await act(async () => close.click()); await click("概览"); expect(window.location.search).toContain("tab=overview");
    await click("需求与报价"); runtime.demandsDirty = true; await render(); await click("新增跟进"); expect(window.location.search).toContain("tab=demands");
  });

  it("archived customers and denied order grant cannot acquire order writes", async () => {
    runtime.detail = { customer: record({ archivedAt: "2026-11-01" }), followUps: [] };
    runtime.canReadOrders = true; await render(); await click("客户订单");
    expect(runtime.orderProps.readOnly).toBe(true); expect(runtime.orderProps.canWrite).toBe(false); expect(button("新增需求").disabled).toBe(true);
    runtime.canReadOrders = false; await render(); expect(runtime.orderProps.canRead).toBe(false); expect(runtime.orderProps.canWrite).toBe(false);
  });

  it("requires explicit discard for company draft tab changes and keeps the editor on cancel", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit");
    await click("概览"); expect(window.location.search).toContain("tab=company");
    expect(document.body.textContent).toContain("放弃未保存的客户修改");
    let cancel = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent === "取消")!;
    await act(async () => cancel.click()); expect(host.textContent).toContain("PRIVATE UNSAVED DRAFT");
    await click("概览");
    const discard = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "放弃并继续")!;
    await act(async () => discard.click()); expect(window.location.search).toContain("tab=overview"); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT");
  });
});

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function bodyClick(label: string) {
  const element = [...document.body.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(item => item.textContent?.trim() === label);
  if (!element) throw new Error(`missing body action ${label}`);
  await act(async () => element.click());
}
async function beginMutation(name: string) {
  if (name === "updateBasic") {
    await click("公司与联系人"); await click("展开"); await click("synthetic-edit"); await click("保存修改");
  } else if (name === "addFollowUp") {
    await click("新增跟进");
    await input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跟进内容"]')!, "SYNTHETIC FOLLOW DRAFT");
    await click("保存跟进");
  } else {
    await act(async () => button("更多").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await bodyClick(name === "transfer" ? "转移负责人" : name === "archive" ? "归档客户" : "恢复客户");
    if (name !== "restore") await input(document.body.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!, "SYNTHETIC REASON");
    await bodyClick(name === "transfer" ? "确认转移" : name === "archive" ? "确认归档" : "确认恢复");
  }
}

describe.sequential("CustomerDetail mount proof and asynchronous shell safety", () => {
  it("does not expose or hydrate same-ID retained context/get cache until each first-mount read succeeds", async () => {
    runtime.contextFetched = false; runtime.detailFetched = false; runtime.contextFetching = true; runtime.detailFetching = true;
    await render();
    expect(host.textContent).toContain("加载客户详情中"); expect(host.textContent).not.toContain("PRIVATE");
    expect(runtime.getOptions.at(-1).enabled).toBe(false); expect(host.querySelector('[data-editor-name]')).toBeNull();
    runtime.contextFetching = false; await render();
    expect(runtime.getOptions.at(-1).enabled).toBe(false); // cached status=success without mount proof is insufficient
    runtime.contextFetched = true; await render();
    expect(runtime.getOptions.at(-1).enabled).toBe(true); expect(host.textContent).not.toContain("PRIVATE");
    runtime.detailFetching = false; await render(); expect(host.textContent).not.toContain("PRIVATE");
    runtime.detailFetched = true; runtime.detail = { customer: record({ name: "FRESH VERIFIED CUSTOMER" }), followUps: [] }; await render();
    await click("公司与联系人"); await click("展开"); expect(host.querySelector('[data-editor-name]')?.textContent).toBe("FRESH VERIFIED CUSTOMER");
    expect(runtime.mutations.updateBasic.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(["context", "detail"])("fails closed on a first-mount %s read refusal even if successful cache is retained", async target => {
    runtime.contextFetched = false; runtime.detailFetched = false; runtime.contextFetching = true; runtime.detailFetching = true;
    await render();
    runtime.contextFetching = false; runtime.detailFetching = false; runtime.contextFetched = true;
    if (target === "context") runtime.contextError = true; else { runtime.detailFetched = true; runtime.detailError = true; }
    await render(); expect(host.textContent).not.toContain("PRIVATE"); expect(host.querySelector('[data-editor-name]')).toBeNull();
    expect(host.textContent).toContain(target === "context" ? "授权已撤销" : "客户访问已撤销");
  });

  it("keeps verified dirty company and follow editors mounted through ordinary context/detail refetch", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit");
    runtime.contextFetching = true; runtime.detailFetching = true; await render();
    const editor = host.querySelector('[data-editor-name]');
    expect(editor?.textContent).toBe("PRIVATE UNSAVED DRAFT"); expect(host.textContent).not.toContain("加载客户详情中");
    runtime.contextFetching = false; runtime.detailFetching = false; runtime.detail = { customer: record({ name: "SERVER NEW NAME", version: 2 }), followUps: [] }; await render();
    expect(host.querySelector('[data-editor-name]')).toBe(editor); expect(editor?.textContent).toBe("PRIVATE UNSAVED DRAFT");
    await click("新增跟进"); await bodyClick("放弃并继续");
    const follow = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跟进内容"]')!;
    await input(follow, "LOCAL FOLLOW DRAFT");
    runtime.contextFetching = true; runtime.detailFetching = true; await render();
    expect(host.querySelector('textarea[aria-label="跟进内容"]')).toBe(follow); expect(follow.value).toBe("LOCAL FOLLOW DRAFT");
  });

  it("clears a verified draft immediately on get denial and does not resurrect it on a later same-ID success", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit");
    runtime.detailError = true; await render(); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT");
    runtime.detailError = false; runtime.detailFetched = false; runtime.detailFetching = true; await render(); expect(host.textContent).not.toContain("PRIVATE");
    runtime.detailFetched = true; runtime.detailFetching = false; await render(); await click("展开");
    expect(host.querySelector('[data-editor-name]')?.textContent).toBe("SYNTHETIC CURRENT CUSTOMER");
  });

  it("new root authorization for the same actor/enterprise/customer requires new mount proof and clears drafts", async () => {
    await render(); await click("公司与联系人"); await click("展开"); await click("synthetic-edit");
    runtime.authorizationVersion = "auth-B"; runtime.contextFetched = false; runtime.detailFetched = false; runtime.contextFetching = true; await render();
    expect(host.textContent).not.toContain("PRIVATE"); expect(runtime.getOptions.at(-1).enabled).toBe(false);
  });

  it.each(["updateBasic", "addFollowUp", "transfer", "archive", "restore"])("current %s success still uses the original handler and precise customer invalidation", async name => {
    runtime.canManageAll = true;
    if (name === "restore") runtime.detail = { customer: record({ archivedAt: "2026-11-01" }), followUps: [] };
    await render(); await beginMutation(name);
    expect(runtime.mutations[name].mutateAsync).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledOnce(); expect(runtime.getInvalidate).toHaveBeenCalledWith({ id: 801 }); expect(runtime.listInvalidate).toHaveBeenCalledOnce();
  });

  it.each(["updateBasic", "addFollowUp", "transfer", "archive", "restore"].flatMap(name => ["success", "error"].map(outcome => ({ name, outcome }))))("suppresses old $name $outcome after root-auth A→B→A, without changing receipt business payload", async ({ name, outcome }) => {
    const receipt = deferred(); const message = vi.spyOn(customerUtils, "errorMessage");
    runtime.mutations[name].mutateAsync.mockReturnValue(receipt.promise); runtime.canManageAll = true;
    if (name === "restore") runtime.detail = { customer: record({ archivedAt: "2026-11-01" }), followUps: [] };
    await render(); await beginMutation(name); expect(runtime.mutations[name].mutateAsync).toHaveBeenCalledOnce();
    const submitted = runtime.mutations[name].mutateAsync.mock.calls[0][0];
    expect(submitted.customerId ?? submitted.id).toBe(801);
    if (name === "updateBasic" || name === "addFollowUp") expect(submitted.requestId).toEqual(expect.any(String));
    if (name !== "addFollowUp") expect(submitted.version).toBe(1);
    runtime.authorizationVersion = "auth-B"; await render(); runtime.authorizationVersion = "auth-A"; await render();
    vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); runtime.getInvalidate.mockClear(); runtime.listInvalidate.mockClear(); runtime.contactError.mockClear(); message.mockClear();
    await act(async () => { if (outcome === "success") receipt.resolve({ replayed: true }); else receipt.reject(new Error("OLD SYNTHETIC RECEIPT")); });
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(runtime.getInvalidate).not.toHaveBeenCalled(); expect(runtime.listInvalidate).not.toHaveBeenCalled();
    expect(runtime.contactError).not.toHaveBeenCalled(); expect(message).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("OLD SYNTHETIC RECEIPT");
  });

  it.each(["success", "error"])("suppresses follow %s after actual unmount", async outcome => {
    const receipt = deferred(); runtime.mutations.addFollowUp.mutateAsync.mockReturnValue(receipt.promise);
    await render(); await beginMutation("addFollowUp");
    await act(async () => root.render(React.createElement("p", {}, "OTHER SESSION")));
    await act(async () => { if (outcome === "success") receipt.resolve({ replayed: false }); else receipt.reject(new Error("OLD ABORT ERROR")); });
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(runtime.getInvalidate).not.toHaveBeenCalled(); expect(host.textContent).toBe("OTHER SESSION");
  });

  it("does not emit an old post-success refresh failure toast after identity changes", async () => {
    const refresh = deferred(); runtime.getInvalidate.mockReturnValue(refresh.promise);
    await render(); await beginMutation("addFollowUp"); expect(toast.success).toHaveBeenCalledOnce();
    runtime.identity += "-other-actor"; await render();
    await act(async () => refresh.reject(new Error("OLD REFRESH FAILURE")));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([{ dirty: true, busy: false }, { dirty: false, busy: true }, { dirty: true, busy: true }])("wires contact dirty=$dirty/busy=$busy into tab/top/back/unload protection without forced cancel", async ({ dirty, busy }) => {
    await render(); await click("公司与联系人"); await click("管理联系人");
    runtime.contactsDirty = dirty; runtime.contactsBusy = busy; await render();
    expect(runtime.contactsProps.onDirtyChange).toEqual(expect.any(Function)); expect(runtime.contactsProps.onBusyChange).toEqual(expect.any(Function));
    await click("概览"); expect(window.location.search).toContain("tab=company"); expect(runtime.contactsProps.open).toBe(true);
    await bodyClick("继续当前操作"); await click("新增需求"); expect(window.location.search).toContain("tab=company");
    await bodyClick("继续当前操作"); await click("返回上一页"); expect(window.location.pathname).toBe("/workbench/customers/801");
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(runtime.contactsProps.open).toBe(true); expect(host.textContent).toContain("synthetic-contact-editor");
    await bodyClick("继续当前操作"); runtime.contactsDirty = false; runtime.contactsBusy = false; await render(); await click("概览");
    expect(window.location.search).toContain("tab=overview");
  });
});

const nativeBack = History.prototype.back;
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function navigateOutside(method: "back" | "nativeBack" | "link" | "navigate") {
  await act(async () => {
    if (method === "back") history.back();
    else if (method === "nativeBack") nativeBack.call(history);
    else if (method === "link") host.querySelector<HTMLAnchorElement>('[data-side-link]')!.click();
    else button("Synthetic navigate").click();
    await delay(method === "nativeBack" ? 100 : 30);
  });
}
async function makeDraft(module: string) {
  if (module === "company") { await click("公司与联系人"); await click("展开"); await click("synthetic-edit"); }
  else if (module === "follow") {
    await click("新增跟进"); await input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跟进内容"]')!, "SPA FOLLOW DRAFT");
  } else if (module === "demand") { await click("需求与报价"); runtime.demandsDirty = true; await render(); }
  else if (module === "order") { runtime.canReadOrders = true; await render(); await click("客户订单"); runtime.ordersDirty = true; await render(); }
  else if (module === "contact") { await click("公司与联系人"); await click("管理联系人"); runtime.contactsDirty = true; await render(); }
  else if (module === "contactBusy") { await click("公司与联系人"); await click("管理联系人"); runtime.contactsBusy = true; await render(); }
  else { runtime.mutations[module].isPending = true; await render(); }
}

describe.sequential("CustomerDetail real SPA navigation integration", () => {
  it.each(["company", "follow"].flatMap(module => ["back", "nativeBack", "link", "navigate"].map(method => ({ module, method }))))("idle $module draft confirms $method and preserves draft/URL/source memory on refusal", async ({ module, method }) => {
    await prepareSource(); const source = history.state[META].previous;
    await makeDraft(module); const originalUrl = window.location.href;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await navigateOutside(method as any);
    expect(confirm).toHaveBeenCalledOnce(); expect(window.location.href).toBe(originalUrl);
    if (module === "company") expect(host.querySelector('[data-editor-name]')?.textContent).toBe("PRIVATE UNSAVED DRAFT");
    else expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跟进内容"]')?.value).toBe("SPA FOLLOW DRAFT");
    const sourceSlots = JSON.parse(sessionStorage.getItem("51dianzi:page-memory:v1:" + runtime.identity)!).entries[source].state;
    expect(sourceSlots.page).toBe(4); expect(sourceSlots.appliedFilters.starredOnly).toBe(true);
    confirm.mockReturnValue(true); await navigateOutside(method as any);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe(method === "back" || method === "nativeBack" ? "/workbench/customers" : "/workbench/outside");
    if (method === "back" || method === "nativeBack") {
      expect(history.state[META].id).toBe(source);
      expect(memory.readPageSlot("page", 1)).toBe(4); expect(memory.readPageSlot("appliedFilters", defaults).starredOnly).toBe(true);
    }
  });

  it.each(["demand", "order", "contact", "contactBusy", "updateBasic", "addFollowUp", "transfer", "archive", "restore"].flatMap(module => ["back", "link", "navigate"].map(method => ({ module, method }))))("$module conservative draft/pending refuses $method without confirming or unmounting", async ({ module, method }) => {
    await prepareSource(); await makeDraft(module); const originalUrl = window.location.href;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await navigateOutside(method as any);
    expect(confirm).not.toHaveBeenCalled(); expect(window.location.href).toBe(originalUrl); expect(host.textContent).toContain("SYNTHETIC CURRENT CUSTOMER");
    expect(document.body.textContent).toContain("执行中或结果待确认时不能离开");
    if (module.startsWith("contact")) expect(runtime.contactsProps.open).toBe(true);
  });

  it("refuses native browser popstate while demand transaction is unknown and restores the exact entry", async () => {
    await prepareSource(); await makeDraft("demand"); const originalUrl = window.location.href; const entry = history.state[META].id;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await navigateOutside("nativeBack"); expect(confirm).not.toHaveBeenCalled(); expect(window.location.href).toBe(originalUrl); expect(history.state[META].id).toBe(entry);
    expect(runtime.demandProps.customer.id).toBe(801); expect(window.location.search).toContain("tab=demands");
  });

  it("does not ask a second native confirmation after the shell explicitly discards a company draft", async () => {
    await render(); await makeDraft("company"); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("概览"); await bodyClick("放弃并继续"); expect(window.location.search).toContain("tab=overview"); expect(confirm).not.toHaveBeenCalled();
  });

  it("rechecks busy before executing a previously opened shell discard dialog", async () => {
    await render(); await makeDraft("company"); await click("概览");
    runtime.contactsBusy = true; await render(); await bodyClick("放弃并继续");
    expect(window.location.search).toContain("tab=company"); expect(host.querySelector('[data-editor-name]')?.textContent).toBe("PRIVATE UNSAVED DRAFT");
    expect(document.body.textContent).toContain("执行中或结果待确认时不能离开");
  });
});

describe.sequential("CustomerDetail completion and parent receipt safety", () => {
  it("checks follow submitting live until completion, then allows clean SPA navigation without a sticky busy closure", async () => {
    const receipt = deferred(); runtime.mutations.addFollowUp.mutateAsync.mockReturnValue(receipt.promise);
    await render(); await beginMutation("addFollowUp");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await navigateOutside("navigate"); expect(window.location.pathname).toBe("/workbench/customers/801"); expect(confirm).not.toHaveBeenCalled();
    await bodyClick("继续当前操作");
    await act(async () => receipt.resolve({ replayed: false }));
    await navigateOutside("navigate"); expect(window.location.pathname).toBe("/workbench/outside"); expect(confirm).not.toHaveBeenCalled();
  });

  it("guards parent order receipt invalidations through authorization A→B→A", async () => {
    runtime.canReadOrders = true; await render(); await click("客户订单");
    const old = runtime.orderProps.onOrderChanged;
    await act(async () => old());
    expect(runtime.orderSummaryInvalidate).toHaveBeenCalledWith({ customerId: 801 }); expect(runtime.orderMaterialsInvalidate).toHaveBeenCalledWith({ customerId: 801 });
    runtime.orderSummaryInvalidate.mockClear(); runtime.orderMaterialsInvalidate.mockClear();
    runtime.authorizationVersion = "auth-B"; await render(); runtime.authorizationVersion = "auth-A"; await render();
    await act(async () => old()); expect(runtime.orderSummaryInvalidate).not.toHaveBeenCalled(); expect(runtime.orderMaterialsInvalidate).not.toHaveBeenCalled();
  });
});

describe.sequential("CustomerDetail supply session parent guard integration", () => {
  it("passes only verified current customer/version/archive and keeps tab/top/back/SPA/unload blocked until importer close", async () => {
    await prepareSource(); await click("渠道库存");
    expect(runtime.supplyProps.customerVersion).toBe(1); expect(runtime.supplyProps.archived).toBe(false);
    expect(runtime.supplyProps.isCurrent()).toBe(true);
    await click("synthetic-open-supply"); const url = window.location.href;
    await click("概览"); expect(window.location.href).toBe(url);
    expect(document.body.textContent).toContain("供应库存上传"); await bodyClick("继续当前操作");
    await click("新增需求"); expect(window.location.href).toBe(url); await bodyClick("继续当前操作");
    await click("返回上一页"); expect(window.location.href).toBe(url); await bodyClick("继续当前操作");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await navigateOutside("navigate"); expect(window.location.href).toBe(url); expect(confirm).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await bodyClick("继续当前操作"); await act(async () => runtime.supplyProps.onOpenChange(false));
    await click("概览"); expect(window.location.search).toContain("tab=overview");
  });
  it("clears the live upload guard synchronously before the importer's completion navigate, without a sticky busy render", async () => {
    await render(); await click("渠道库存"); await click("synthetic-open-supply");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("synthetic-finish-supply");
    expect(window.location.pathname).toBe("/workbench/channel-inventory");
    expect(window.location.search).toBe("?supplyChannelId=411&supplyTab=materials"); expect(confirm).not.toHaveBeenCalled();
  });
  it("does not let an old A→B→A supply callback lock the new customer session or acquire a write from an archived URL", async () => {
    await render(); await click("渠道库存"); const old = runtime.supplyProps;
    runtime.authorizationVersion = "auth-B"; await render(); runtime.authorizationVersion = "auth-A"; await render();
    expect(old.isCurrent()).toBe(false); await act(async () => old.onOpenChange(true));
    await click("概览"); expect(window.location.search).toContain("tab=overview");
    runtime.detail = { customer: record({ archivedAt: "2026-11-01", version: 2 }), followUps: [] };
    await render(); await click("渠道库存"); expect(runtime.supplyProps.archived).toBe(true); expect(runtime.supplyProps.customerVersion).toBe(2);
  });
});
