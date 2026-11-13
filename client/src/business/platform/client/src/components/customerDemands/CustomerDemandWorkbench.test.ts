// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { CustomerDemandHistory } from "./CustomerDemandHistory";
import { CustomerDemandDialog } from "./CustomerDemandDialog";
import { customerDemandOrderPath, matchesCustomerDemand } from "./customerDemandWorkbench";
import { DemandQuoteList } from "./DemandQuoteList";
import { ReadOnlyDemandQuotes } from "./ReadOnlyDemandQuotes";

const runtime = vi.hoisted(() => ({
  identity: "actor:7:enterprise:31",
  quotePending: false,
  list: undefined as any,
  detail: undefined as any,
  quotes: undefined as any,
  rounds: undefined as any,
  enterprise: undefined as any,
  listQuery: vi.fn(), detailQuery: vi.fn(), quoteQuery: vi.fn(), historyQuery: vi.fn(),
  save: vi.fn(), accept: vi.fn(), acceptHook: vi.fn(), withdrawHook: vi.fn(),
  withdraw: vi.fn(),
  navigate: vi.fn(), invalidate: vi.fn().mockResolvedValue(undefined),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../hooks/usePageIdentity", () => ({ usePageIdentity: () => runtime.identity }));
vi.mock("./useDemandQuotePending", async importOriginal => {
  const original = await importOriginal<typeof import("./useDemandQuotePending")>();
  return { ...original, useDemandQuotePending: (demandId?: number, session?: object) => original.useDemandQuotePending(demandId, session) || runtime.quotePending };
});
vi.mock("wouter", () => ({ useLocation: () => ["/customers/12", runtime.navigate] }));
vi.mock("sonner", () => ({ toast: runtime.toast }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ customerDemand: Object.fromEntries(["list", "get", "quoteList", "quoteHistory", "procurementList", "procurementGet", "revisionHistory", "salesList"].map(key => [key, { invalidate: runtime.invalidate }])), crmSalesOrder: { candidates: { invalidate: runtime.invalidate } } }),
  customer: { context: { useQuery: () => ({ data: { actorUserId: 7, members: [{ userId: 7, name: "合成销售" }] } }) } },
  enterprise: { me: { useQuery: () => runtime.enterprise } },
  customerDemand: {
    list: { useQuery: (input: any, options: any) => { runtime.listQuery(input, options); return runtime.list; } },
    get: { useQuery: (input: any, options: any) => { if (options?.enabled) runtime.detailQuery(input, options); return options?.enabled ? runtime.detail : state(undefined); } },
    save: { useMutation: () => ({ mutateAsync: runtime.save }) },
    suggestPartNumbers: { useQuery: () => state([]) },
    revisionHistory: { useQuery: () => state({ items: [], total: 0, page: 1, pageSize: 5 }) },
    quoteList: { useQuery: (input: any) => { runtime.quoteQuery(input); return runtime.quotes; } },
    quoteHistory: { useQuery: (input: any, options: any) => { if (options?.enabled) runtime.historyQuery(input); return runtime.rounds; } },
    quoteAccept: { useMutation: (options: any) => { runtime.acceptHook(options); return { isPending: false, mutate: (input: any) => { const context = options?.onMutate?.(input); return runtime.accept(input).then((result: any) => options?.onSuccess?.(result, input, context)).catch((error: any) => options?.onError?.(error, input, context)).finally(() => options?.onSettled?.(undefined, null, input, context)); } }; } },
    quoteWithdraw: { useMutation: (options: any) => { runtime.withdrawHook(options); return { isPending: false, mutate: (input: any) => { const context = options?.onMutate?.(input); return runtime.withdraw(input).then((result: any) => options?.onSuccess?.(result, input, context)).catch((error: any) => options?.onError?.(error, input, context)).finally(() => options?.onSettled?.(undefined, null, input, context)); } }; } },
  },
} }));
vi.mock("../ui/dialog", () => ({ Dialog: ({ children }: any) => h(React.Fragment, null, children), DialogContent: ({ children }: any) => h("div", { role: "dialog" }, children), DialogTitle: ({ children }: any) => h("h2", null, children), DialogDescription: ({ children }: any) => h("p", null, children) }));
vi.mock("../ui/button", () => ({ Button: ({ children, size: _size, variant: _variant, ...props }: any) => h("button", props, children) }));
vi.mock("../customers/BeijingDateTimePicker", () => ({ BeijingDateTimePicker: ({ onChange, ...props }: any) => h("input", { ...props, onChange: (event: any) => onChange(event.target.value) }) }));
vi.mock("../customers/ConfirmDialog", () => ({ ConfirmDialog: ({ title, confirmLabel, onConfirm, onCancel }: any) => h("div", { role: "alertdialog" }, h("p", null, title), h("button", { onClick: onConfirm }, confirmLabel), h("button", { onClick: onCancel }, "取消确认")) }));

function state(data: any, extra: any = {}) { return { data, isLoading: false, isPending: false, isFetching: false, isFetchedAfterMount: true, isPlaceholderData: false, error: null, refetch: vi.fn().mockResolvedValue(undefined), ...extra }; }
const customer = { id: 12, name: "合成客户" };
function row(extra: any = {}) { return { id: 41, customerId: 12, demandNo: "XQ-41", projectName: "合成项目", status: "submitted", revision: 2, version: 3, quoteCount: 4, itemCount: 1, createdAt: "2026-11-01T00:00:00Z", hasActiveOrders: true, ...extra }; }
function detail(extra: any = {}) { return { ...row(), canEdit: true, note: "仅合成数据", priority: "normal", replyDueAt: null, items: [{ id: 401, partNumber: "SYNTHETIC-401", brand: "TEST", pkg: "TEST", qty: 100, qtyUnit: "片", deliveryRequirement: "现货", note: "" }], lockedItemIds: [], ...extra }; }
function quote(extra: any = {}) { return { id: 501, demandId: 41, version: 3, demandRevision: 2, currentDemandRevision: 2, procurementName: "合成采购", status: "active", updatedAt: "2026-11-01T00:00:00Z", isAccepted: false, items: [{ demandItemId: 401, alternateNo: 1, partNumber: "SYNTHETIC-401", brand: "TEST", pkg: "TEST", qty: 100, qtyUnit: "片", unitPrice: "0.1234", leadTime: "现货", note: "", availableToAcceptQty: 100 }], ...extra }; }
let host: HTMLDivElement;
let root: Root;
function render(element: React.ReactNode) { act(() => root.render(element)); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
function button(text: string) { const node = Array.from(host.querySelectorAll("button")).find(node => node.getAttribute("aria-label") === text || node.textContent?.replace(/\s/g, "") === text.replace(/\s/g, "")); if (!node) throw new Error(`missing button ${text}`); return node; }
async function click(text: string) { await act(async () => button(text).click()); }
function change(selector: string, value: string) { const node = host.querySelector<HTMLInputElement>(selector)!; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks();
  runtime.identity = "actor:7:enterprise:31";
  runtime.quotePending = false;
  runtime.enterprise = state({ isOwner: false, permissionKeys: [] });
  runtime.list = state({ items: [row()], total: 41, page: 1, pageSize: 20 });
  runtime.detail = state(detail());
  runtime.quotes = state({ items: [quote()], total: 1, page: 1, pageSize: 10 });
  runtime.rounds = state({ items: [{ id: 801, quoteId: 501, version: 1, demandRevision: 1, createdAt: "2026-11-01T00:00:00Z", items: quote().items }], total: 1, page: 1, pageSize: 10 });
  runtime.save.mockReset().mockResolvedValue({ id: 41, demandNo: "XQ-41", version: 4, revision: 3, status: "submitted", replayed: false });
  runtime.accept.mockReset().mockResolvedValue({ acceptedQty: 50, replayed: false });
  runtime.withdraw.mockReset().mockResolvedValue({ quoteId: 501, replayed: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("客户集中需求与采购报价", () => {
  it("only lists the exact customer and renders authoritative counts without N+1 detail or quote reads", () => {
    render(h(CustomerDemandHistory, { customer }));
    expect(runtime.listQuery).toHaveBeenCalledWith({ customerId: 12, page: 1, pageSize: 20 }, expect.anything());
    expect(host.textContent).toContain("共 41 条"); expect(host.textContent).toContain("4 份");
    expect(runtime.detailQuery).not.toHaveBeenCalled(); expect(runtime.quoteQuery).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("客户已确认");
  });
  it("does not fabricate zero counts while loading and fails closed on cross-customer lists", () => {
    runtime.list = state(undefined, { isLoading: true }); render(h(CustomerDemandHistory, { customer }));
    expect(host.textContent).not.toContain("共 0 条");
    runtime.list = state({ items: [row({ customerId: 13, projectName: "不能泄露项目" })], total: 1, page: 1 }); render(h(CustomerDemandHistory, { customer }));
    expect(host.textContent).toContain("需求上下文不一致"); expect(host.textContent).not.toContain("不能泄露项目");
  });
  it("does not query when canRead=false", () => {
    render(h(CustomerDemandHistory, { customer, canRead: false, createRequestToken: 1 }));
    expect(runtime.listQuery).not.toHaveBeenCalled(); expect(runtime.detailQuery).not.toHaveBeenCalled();
  });
  it("external create is consumed once and does not replace an open dirty draft", async () => {
    render(h(CustomerDemandHistory, { customer, createRequestToken: 1 }));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    change("#demand-project", "保留本地输入");
    render(h(CustomerDemandHistory, { customer, createRequestToken: 2 }));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("保留本地输入");
    await click("取消"); await click("放弃并关闭");
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("");
    await click("取消"); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("demand intents are consumed once and verify detail ownership before displaying materials or quotes", async () => {
    runtime.detail = state(detail({ customerId: 13, projectName: "隐藏他客数据" }));
    const handled = vi.fn(); render(h(CustomerDemandHistory, { customer, initialDemandIntent: { demandId: 41, token: "open:1", section: "quotes" }, onDemandIntentHandled: handled }));
    expect(handled).toHaveBeenCalledWith("open:1"); expect(host.textContent).toContain("不属于当前客户");
    expect(host.textContent).not.toContain("隐藏他客数据"); expect(host.textContent).not.toContain("SYNTHETIC-401"); expect(runtime.quoteQuery).not.toHaveBeenCalled();
    await click("关闭"); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("materials and quote entry points lazily reuse real detail and sales quote APIs", async () => {
    render(h(CustomerDemandHistory, { customer, canManageOrders: false })); await click("采购报价");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 41 }, expect.objectContaining({ enabled: true }));
    expect(runtime.quoteQuery).toHaveBeenCalledWith({ demandId: 41, audience: "sales", page: 1, pageSize: 10 });
    expect(host.textContent).toContain("SYNTHETIC-401"); expect(host.textContent).toContain("0.1234"); expect(host.textContent).toContain("第3轮");
  });
  it("uses embedded order callbacks carrying exact demand ID and number instead of navigation", async () => {
    const create = vi.fn(), view = vi.fn();
    const props = { customer, demandId: 41, mode: "view" as const, canManageOrders: true, onClose: vi.fn(), onCreateOrder: create, onViewOrders: view };
    render(h(CustomerDemandDialog, props)); await click("填写成交报价 / 生成订单");
    expect(create).toHaveBeenCalledWith({ demandId: 41, demandNo: "XQ-41" }); expect(runtime.navigate).not.toHaveBeenCalled();
    render(h(CustomerDemandDialog, props)); await click("查看销售订单");
    expect(view).toHaveBeenCalledWith({ demandId: 41, demandNo: "XQ-41" });
  });
  it("standalone callbacks remain optional and retain old route parameters under real order permission", async () => {
    runtime.enterprise = state({ isOwner: false, permissionKeys: ["sales.business_orders"] });
    render(h(CustomerDemandDialog, { customer, demandId: 41, mode: "view", onClose: vi.fn() }));
    await click("填写成交报价 / 生成订单"); expect(runtime.navigate).toHaveBeenCalledWith("/orders?orderSource=business&demandNo=XQ-41");
    await click("查看销售订单"); expect(runtime.navigate).toHaveBeenCalledWith("/orders?orderSource=business&keyword=XQ-41");
  });
  it("customer permission does not expose order actions or query orders", () => {
    render(h(CustomerDemandDialog, { customer, demandId: 41, canManageOrders: false, onClose: vi.fn() }));
    expect(host.textContent).toContain("无销售订单权限"); expect(host.textContent).not.toContain("填写成交报价 / 生成订单"); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("archived customers cannot create/save/accept and retain readonly real quote rounds/history", async () => {
    render(h(CustomerDemandHistory, { customer: { ...customer, archivedAt: "2026-11-01" }, createRequestToken: 1, canManageOrders: true }));
    expect(button("新增需求").disabled).toBe(true); expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click("采购报价"); expect(host.textContent).toContain("采购报价（只读）");
    expect(host.textContent).not.toContain("采用报价"); expect(host.textContent).not.toContain("填写成交报价 / 生成订单");
    expect(runtime.acceptHook).not.toHaveBeenCalled(); expect(runtime.withdrawHook).not.toHaveBeenCalled();
    await click("历史轮次（3）"); expect(runtime.historyQuery).toHaveBeenCalledWith({ quoteId: 501, audience: "sales", page: 1, pageSize: 10 }); expect(host.textContent).toContain("第1轮");
    expect(runtime.save).not.toHaveBeenCalled(); expect(runtime.accept).not.toHaveBeenCalled();
  });
  it("quote acceptance remains sales adoption, preserving exact quantity, revision, version and idempotency", async () => {
    render(h(CustomerDemandDialog, { customer, demandId: 41, mode: "view", canManageOrders: false, onClose: vi.fn() }));
    await click("采用报价"); change('input[aria-label="SYNTHETIC-401采用数量"]', "50"); await click("确认采用");
    expect(runtime.accept).toHaveBeenCalledWith(expect.objectContaining({ demandId: 41, quoteId: 501, quoteVersion: 3, demandRevision: 2, requestId: expect.any(String), items: [{ demandItemId: 401, alternateNo: 1, qty: 50 }] }));
    expect(host.textContent).toContain("不代表已向客户发送或客户已确认销售价格"); expect(runtime.save).not.toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("old stale quote revisions remain visible but cannot be adopted", () => {
    runtime.quotes = state({ items: [quote({ needsReconfirmation: true, demandRevision: 1, acceptanceStale: true })], total: 1, page: 1 });
    render(h(CustomerDemandDialog, { customer, demandId: 41, canManageOrders: false, onClose: vi.fn() }));
    expect(host.textContent).toContain("旧版报价"); expect(host.textContent).toContain("原采用已失效"); expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent?.trim() === "采用报价")).toBe(false);
  });
  it("submitted revision edits retain stable source IDs and same-payload idempotent retries", async () => {
    runtime.detail = state(detail({ hasActiveOrders: false }));
    runtime.save.mockRejectedValueOnce(new Error("synthetic network timeout")).mockResolvedValueOnce({ id: 41, demandNo: "XQ-41", status: "submitted", version: 4, revision: 3 });
    render(h(CustomerDemandDialog, { customer, demandId: 41, onClose: vi.fn(), canManageOrders: false }));
    change("#demand-project", "更新项目"); change("#demand-change-reason", "客户修改项目名"); await click("保存变更");
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.disabled).toBe(true); await click("重试保存");
    expect(runtime.save).toHaveBeenCalledTimes(2); expect(runtime.save.mock.calls[0][0]).toEqual(runtime.save.mock.calls[1][0]);
    expect(runtime.save.mock.calls[0][0]).toMatchObject({ customerId: 12, id: 41, version: 3, intent: "update", changeReason: "客户修改项目名", data: { items: [{ id: 401 }] } });
  });
  it("identity and customer switches reset page/dialog immediately and ignore an old save completion", async () => {
    let finish!: (value: any) => void;
    runtime.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const oldClose = vi.fn(), oldSaved = vi.fn();
    render(h(CustomerDemandDialog, { customer, onClose: oldClose, onSaved: oldSaved, canManageOrders: false }));
    change("#demand-project", "旧身份草稿"); await click("提交采购");
    // Submission requires a part and quantity, so use draft for this synthetic pending request.
    await click("保存草稿");
    runtime.identity = "actor:8:enterprise:32";
    render(h(CustomerDemandDialog, { customer: { id: 13, name: "新客户" }, onClose: vi.fn(), canManageOrders: false }));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("");
    await act(async () => finish({ id: 41, demandNo: "OLD-NO", version: 1, status: "draft" }));
    expect(host.textContent).not.toContain("OLD-NO"); expect(oldClose).not.toHaveBeenCalled(); expect(oldSaved).not.toHaveBeenCalled();
    render(h(CustomerDemandHistory, { customer })); await click("下一页"); await click("物料");
    runtime.list = state({ items: [row({ customerId: 13 })], total: 1, page: 1 });
    render(h(CustomerDemandHistory, { customer: { id: 13, name: "新客户" } }));
    expect(runtime.listQuery.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 13, page: 1 }); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("History reports unsaved demand and uncertain pending/replay to shell, and clears immediately on access loss", async () => {
    const dirty = vi.fn();
    runtime.save.mockRejectedValueOnce(new Error("synthetic uncertain save"));
    render(h(CustomerDemandHistory, { customer, createRequestToken: 1, onDirtyChange: dirty }));
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    change("#demand-project", "本地待保存");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    await click("保存草稿"); expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    expect(host.textContent).toContain("保存结果尚未确认");
    render(h(CustomerDemandHistory, { customer, canRead: false, onDirtyChange: dirty }));
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false); expect(host.textContent).not.toContain("本地待保存");
  });
  it("existing quoteAccept pending blocks close and reports dirty without replacing its mutation flow", async () => {
    runtime.quotePending = true;
    const dirty = vi.fn(), close = vi.fn();
    render(h(CustomerDemandDialog, { customer, demandId: 41, mode: "view", canManageOrders: true, onClose: close, onDirtyChange: dirty }));
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true); expect(button("关闭").disabled).toBe(true);
    expect(button("填写成交报价 / 生成订单").disabled).toBe(true); await click("关闭"); expect(close).not.toHaveBeenCalled();
    runtime.quotePending = false;
    render(h(CustomerDemandDialog, { customer, demandId: 41, mode: "view", canManageOrders: true, onClose: close, onDirtyChange: dirty }));
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false); await click("关闭"); expect(close).toHaveBeenCalledOnce();
  });
  it("unsaved edits block order intent and confirmed save/discard clears shell dirty", async () => {
    const dirty = vi.fn(), create = vi.fn();
    render(h(CustomerDemandDialog, { customer, demandId: 41, canManageOrders: true, onClose: vi.fn(), onDirtyChange: dirty, onCreateOrder: create }));
    change("#demand-project", "未保存的变更");
    expect(button("填写成交报价 / 生成订单").disabled).toBe(true); await click("填写成交报价 / 生成订单"); expect(create).not.toHaveBeenCalled();
    change("#demand-change-reason", "说明修改"); await click("保存变更"); expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
  });
  it("read-only quote history fails closed on a late mismatched quote response", async () => {
    runtime.rounds = state({ items: [{ id: 801, quoteId: 502, version: 1, demandRevision: 1, createdAt: "2026-11-01T00:00:00Z", items: [{ ...quote().items[0], partNumber: "另一报价内容" }] }], total: 1, page: 1 });
    render(h(CustomerDemandDialog, { customer: { ...customer, archivedAt: "2026-11-01" }, demandId: 41, onClose: vi.fn(), canManageOrders: false }));
    await click("历史轮次（3）"); expect(host.textContent).toContain("报价历史上下文不一致"); expect(host.textContent).not.toContain("另一报价内容");
  });
  it("binding helpers are ID-based and preserve encoded standalone routes; quoteSave remains absent here", () => {
    expect(matchesCustomerDemand(detail(), 12, 41)).toBe(true); expect(matchesCustomerDemand(detail(), 13, 41)).toBe(false); expect(matchesCustomerDemand(detail(), 12, 42)).toBe(false);
    expect(customerDemandOrderPath({ demandId: 41, demandNo: "XQ / 41" }, "create")).toBe("/orders?orderSource=business&demandNo=XQ%20%2F%2041");
    const source = readFileSync(new NodeURL("./CustomerDemandDialog.tsx", import.meta.url), "utf8"); expect(source).not.toContain("quoteSave.useMutation"); expect(source).toContain("aliveRef.current");
  });
});

describe("采购报价简洁呈现保留业务状态", () => {
  it("removes permanent explanations but preserves totals, rounds and edit context", async () => {
    const edit = vi.fn(), create = vi.fn();
    render(h(DemandQuoteList, { demandId: 41, audience: "procurement", onEdit: edit, onCreate: create }));
    expect(host.textContent).not.toContain("每家供应商独立报价");
    expect(host.textContent).not.toContain("修改报价将生成下一轮");
    expect(host.textContent).toContain("1 份");
    expect(host.textContent).toContain("第3轮");
    expect(button("新一轮").title).toContain("修改报价将生成下一轮");
    await click("新一轮"); expect(edit).toHaveBeenCalledWith(501);
    await click("新增供应商报价"); expect(create).toHaveBeenCalledOnce();
  });
  it.each([
    ["withdrawn", { status: "withdrawn" }, "已撤回"],
    ["stale", { needsReconfirmation: true, demandRevision: 1 }, "旧版报价不能采用，请采购重新确认"],
    ["accepted", { isAccepted: true, acceptedByName: "合成销售", acceptedAt: "2026-11-01T00:00:00Z" }, "已采用"],
  ])("preserves important %s status", (_name, flags, label) => {
    runtime.quotes = state({ items: [quote(flags)], total: 1, page: 1 });
    render(h(DemandQuoteList, { demandId: 41, audience: _name === "accepted" ? "sales" : "procurement", onEdit: vi.fn() }));
    expect(host.textContent).toContain(label);
    if (_name === "withdrawn") expect(host.textContent).not.toContain("新一轮");
  });
  it("withdraw still requires explicit confirmation and retains the original quote version", async () => {
    render(h(DemandQuoteList, { demandId: 41, audience: "procurement" }));
    await click("撤回");
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("撤回此报价？");
    expect(runtime.withdraw).not.toHaveBeenCalled();
    await click("取消确认"); expect(runtime.withdraw).not.toHaveBeenCalled();
    await click("撤回"); await click("确认撤回");
    expect(runtime.withdraw).toHaveBeenCalledWith({ quoteId: 501, version: 3 });
  });
});

describe("R1/R4 服务端首读证明与会话回执", () => {
  const cachedFirstRead = { isFetching: true, isFetchedAfterMount: false, status: "success" };
  it.each([
    cachedFirstRead,
    { isFetching: false, isFetchedAfterMount: false, status: "success" },
    { isPending: true, isFetchedAfterMount: false, status: "pending" },
    { isFetching: true, isFetchedAfterMount: true, status: "success" },
    { isPlaceholderData: true, isFetchedAfterMount: true, status: "success" },
  ])("syntheticcache-before-firstread hides list and total for %j", flags => {
    runtime.list = state({ items: [row({ projectName: "缓存不可展示" })], total: 987, page: 1 }, flags);
    render(h(CustomerDemandHistory, { customer }));
    expect(host.textContent).toContain("正在加载需求");
    expect(host.textContent).not.toContain("缓存不可展示");
    expect(host.textContent).not.toContain("共 987 条");
    expect(host.querySelector("tbody")).toBeNull();
    expect(runtime.detailQuery).not.toHaveBeenCalled();
    runtime.list = state({ items: [row({ projectName: "当前服务端项目" })], total: 2, page: 1 });
    render(h(CustomerDemandHistory, { customer }));
    expect(host.textContent).toContain("当前服务端项目");
    expect(host.textContent).toContain("共 2 条");
  });

  it("cached get cannot hydrate canEdit or mount quoteAccept until its first fresh proof", () => {
    runtime.detail = state(detail({ projectName: "缓存编辑权" }), cachedFirstRead);
    const dirty = vi.fn();
    const props = { customer, demandId: 41, onClose: vi.fn(), canManageOrders: false, onDirtyChange: dirty };
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector("#demand-project")).toBeNull();
    expect(host.textContent).not.toContain("XQ-41");
    expect(host.textContent).not.toContain("缓存编辑权");
    expect(host.textContent).not.toContain("SYNTHETIC-401");
    expect(runtime.quoteQuery).not.toHaveBeenCalled();
    expect(runtime.acceptHook).not.toHaveBeenCalled();
    expect(runtime.save).not.toHaveBeenCalled();
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    runtime.detail = state(detail({ projectName: "新鲜编辑权" }));
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("新鲜编辑权");
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.disabled).toBe(false);
    expect(runtime.acceptHook).toHaveBeenCalled();
  });

  it.each(["writable", "readonly"])("cached %s quoteList does not display totals/cards or mount write hooks", branch => {
    runtime.quotes = state({ items: [quote({ note: "缓存报价不显示" })], total: 987, page: 1 }, cachedFirstRead);
    const element = () => branch === "writable" ? h(DemandQuoteList, { demandId: 41, customerId: 12, audience: "sales" }) : h(ReadOnlyDemandQuotes, { demandId: 41, customerId: 12 });
    render(element());
    expect(host.textContent).toContain("正在加载");
    expect(host.textContent).not.toContain("987 份");
    expect(host.textContent).not.toContain("缓存报价不显示");
    expect(host.textContent).not.toContain("SYNTHETIC-401");
    expect(runtime.acceptHook).not.toHaveBeenCalled();
    expect(runtime.withdrawHook).not.toHaveBeenCalled();
    runtime.quotes = state({ items: [quote({ note: "服务端当前报价" })], total: 1, page: 1 });
    render(element());
    expect(host.textContent).toContain("服务端当前报价");
    if (branch === "readonly") expect(runtime.acceptHook).not.toHaveBeenCalled();
    else expect(runtime.acceptHook).toHaveBeenCalled();
  });

  it("cached quote history is hidden until the current quote/page server read completes", async () => {
    runtime.rounds = state({ items: [{ id: 801, quoteId: 501, version: 1, demandRevision: 1, createdAt: "2026-11-01T00:00:00Z", items: [{ ...quote().items[0], partNumber: "缓存历史型号" }] }], total: 88, page: 1 }, cachedFirstRead);
    render(h(ReadOnlyDemandQuotes, { demandId: 41 }));
    await click("历史轮次（3）");
    expect(host.textContent).not.toContain("缓存历史型号");
    expect(host.textContent).not.toContain("共 88 条");
    runtime.rounds = state(runtime.rounds.data);
    render(h(ReadOnlyDemandQuotes, { demandId: 41 }));
    expect(host.textContent).toContain("缓存历史型号");
  });

  it("afterfreshregularrefetchretain keeps demand dirty DOM, quote editor, original revision/version and draft", async () => {
    const props = { customer, demandId: 41, onClose: vi.fn(), canManageOrders: false, onDirtyChange: vi.fn() };
    render(h(CustomerDemandDialog, props));
    const projectNode = host.querySelector("#demand-project");
    change("#demand-project", "服务端刷新不得覆盖草稿");
    change("#demand-change-reason", "本地变更说明");
    await click("采用报价");
    change('input[aria-label="SYNTHETIC-401采用数量"]', "37");
    const quantityNode = host.querySelector('input[aria-label="SYNTHETIC-401采用数量"]');
    runtime.detail = state(detail({ projectName: "刷新缓存", version: 4 }), { isFetching: true });
    runtime.quotes = state(runtime.quotes.data, { isFetching: true });
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector("#demand-project")).toBe(projectNode);
    expect(host.querySelector('input[aria-label="SYNTHETIC-401采用数量"]')).toBe(quantityNode);
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("服务端刷新不得覆盖草稿");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="SYNTHETIC-401采用数量"]')?.value).toBe("37");
    expect(props.onDirtyChange.mock.calls.at(-1)?.[0]).toBe(true);
    runtime.detail = state(detail({ projectName: "当前新版本", version: 4 }));
    runtime.quotes = state(runtime.quotes.data);
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("服务端刷新不得覆盖草稿");
    await click("确认采用");
    expect(runtime.accept).toHaveBeenCalledWith(expect.objectContaining({ quoteVersion: 3, demandRevision: 2, items: [{ demandItemId: 401, alternateNo: 1, qty: 37 }] }));
    await click("保存变更");
    expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({ version: 3, data: expect.objectContaining({ projectName: "服务端刷新不得覆盖草稿" }) }));
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "mismatched"])("fresh session fails closed on %s without discard confirmation", reason => {
    const dirty = vi.fn();
    const props = { customer, demandId: 41, onClose: vi.fn(), canManageOrders: false, onDirtyChange: dirty };
    render(h(CustomerDemandDialog, props));
    change("#demand-project", "必须清除的旧草稿");
    runtime.detail = reason === "mismatched" ? state(detail({ customerId: 13 })) : state(detail(), { error: { message: reason, data: { code: reason } } });
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector("#demand-project")).toBeNull();
    expect(host.textContent).not.toContain("XQ-41");
    expect(host.textContent).not.toContain("SYNTHETIC-401");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    runtime.detail = state(detail({ projectName: "重新服务端核验" }));
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("重新服务端核验");
  });

  it("fresh canEdit revocation clears dirty draft and switches to read-only without writes", () => {
    const props = { customer, demandId: 41, onClose: vi.fn(), canManageOrders: false, onDirtyChange: vi.fn() };
    render(h(CustomerDemandDialog, props));
    change("#demand-project", "撤权后不得保留的草稿");
    runtime.acceptHook.mockClear(); runtime.withdrawHook.mockClear();
    runtime.detail = state(detail({ canEdit: false, projectName: "只读服务端数据" }));
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.value).toBe("只读服务端数据");
    expect(host.querySelector<HTMLInputElement>("#demand-project")?.disabled).toBe(true);
    expect(host.textContent).toContain("采购报价（只读）");
    expect(props.onDirtyChange.mock.calls.at(-1)?.[0]).toBe(false);
    expect(runtime.acceptHook).not.toHaveBeenCalled();
    expect(runtime.withdrawHook).not.toHaveBeenCalled();
  });

  it("identity reset requires new first-read proof even for the same cached demand/customer", () => {
    const props = { customer, demandId: 41, contextIdentityKey: "permission:1", onClose: vi.fn(), canManageOrders: false };
    render(h(CustomerDemandDialog, props));
    change("#demand-project", "旧身份草稿");
    runtime.detail = state(detail(), cachedFirstRead);
    runtime.identity = "actor:8:enterprise:32";
    runtime.acceptHook.mockClear();
    render(h(CustomerDemandDialog, { ...props, contextIdentityKey: "permission:2" }));
    expect(host.querySelector("#demand-project")).toBeNull();
    expect(host.textContent).not.toContain("XQ-41");
    expect(runtime.acceptHook).not.toHaveBeenCalled();
  });

  it.each([
    ["accept", "success", "unmount"], ["accept", "error", "unmount"],
    ["withdraw", "success", "unmount"], ["withdraw", "error", "unmount"],
    ["accept", "success", "actor"], ["withdraw", "error", "actor"],
    ["accept", "error", "customer"], ["withdraw", "success", "demand"],
    ["accept", "success", "permissionABA"], ["withdraw", "error", "permissionABA"],
    ["accept", "error", "readFailureABA"], ["withdraw", "success", "readFailureABA"],
  ])("lateoldpromises %s/%s after %s cannot toast/refetch/invalidate or alter a new editor", async (operation, outcome, transition) => {
    let finish!: (value: any) => void, fail!: (value: any) => void;
    const mutation = operation === "accept" ? runtime.accept : runtime.withdraw;
    mutation.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const props = { demandId: 41, customerId: 12, contextIdentityKey: "authorization:1", audience: operation === "accept" ? "sales" as const : "procurement" as const };
    render(h(DemandQuoteList, props));
    if (operation === "accept") { await click("采用报价"); await click("确认采用"); }
    else { await click("撤回"); await click("确认撤回"); }
    const oldQuery = runtime.quotes;
    if (transition === "unmount") render(null);
    if (transition === "actor") { runtime.identity = "actor:8:enterprise:32"; render(h(DemandQuoteList, props)); }
    if (transition === "customer") render(h(DemandQuoteList, { ...props, customerId: 13 }));
    if (transition === "demand") { runtime.quotes = state({ items: [quote({ demandId: 42 })], total: 1, page: 1 }); render(h(DemandQuoteList, { ...props, demandId: 42 })); }
    if (transition === "permissionABA") {
      render(h(DemandQuoteList, { ...props, canWrite: false, contextIdentityKey: "authorization:2" }));
      expect(host.textContent).toBe("");
      render(h(DemandQuoteList, props));
    }
    if (transition === "readFailureABA") {
      runtime.quotes = state(runtime.quotes.data, { error: { message: "FORBIDDEN" } }); render(h(DemandQuoteList, props));
      runtime.quotes = state(oldQuery.data); render(h(DemandQuoteList, props));
    }
    runtime.toast.success.mockClear(); runtime.toast.error.mockClear(); runtime.invalidate.mockClear();
    const before = host.textContent;
    await act(async () => { if (outcome === "success") finish({ quoteId: 501, acceptedQty: 100, replayed: false }); else fail(new Error("旧请求错误不能显示")); });
    expect(runtime.toast.success).not.toHaveBeenCalled();
    expect(runtime.toast.error).not.toHaveBeenCalled();
    expect(runtime.invalidate).not.toHaveBeenCalled();
    expect(oldQuery.refetch).not.toHaveBeenCalled();
    expect(host.textContent).toBe(before);
    expect(host.textContent).not.toContain("旧请求错误不能显示");
  });

  it("ordinary refetch during a live accept does not cancel its current receipt or local quantity editor", async () => {
    let finish!: (value: any) => void;
    runtime.accept.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = { demandId: 41, customerId: 12, audience: "sales" as const };
    render(h(DemandQuoteList, props)); await click("采用报价");
    change('input[aria-label="SYNTHETIC-401采用数量"]', "45"); await click("确认采用");
    runtime.quotes = state(runtime.quotes.data, { isFetching: true });
    render(h(DemandQuoteList, props));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="SYNTHETIC-401采用数量"]')?.value).toBe("45");
    await act(async () => finish({ acceptedQty: 45, replayed: false }));
    expect(runtime.toast.success).toHaveBeenCalledWith("已采用 45 片");
    expect(runtime.invalidate).toHaveBeenCalled();
  });
});

describe("owned pending bridge 组件连接", () => {
  it("native callback registration locks the dialog/shell without a synthetic pending flag and ordinary refetch retains it", async () => {
    let finish!: (value: any) => void;
    runtime.accept.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const close = vi.fn(), dirty = vi.fn();
    const props = { customer, demandId: 41, mode: "view" as const, canManageOrders: true, onClose: close, onDirtyChange: dirty };
    render(h(CustomerDemandDialog, props));
    expect(runtime.quotePending).toBe(false);
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    await click("采用报价");
    change('input[aria-label="SYNTHETIC-401采用数量"]', "37");
    await click("确认采用");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    expect(button("关闭").disabled).toBe(true);
    expect(button("填写成交报价 / 生成订单").disabled).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await click("关闭"); expect(close).not.toHaveBeenCalled();
    const quantityNode = host.querySelector('input[aria-label="SYNTHETIC-401采用数量"]');
    runtime.detail = state(runtime.detail.data, { isFetching: true });
    runtime.quotes = state(runtime.quotes.data, { isFetching: true });
    render(h(CustomerDemandDialog, props));
    expect(host.querySelector('input[aria-label="SYNTHETIC-401采用数量"]')).toBe(quantityNode);
    expect((quantityNode as HTMLInputElement).value).toBe("37");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    expect(button("关闭").disabled).toBe(true);
    await act(async () => finish({ acceptedQty: 37, replayed: false })); await settle();
    expect(runtime.toast.success).toHaveBeenCalledWith("已采用 37 片");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    expect(button("关闭").disabled).toBe(false);
    await click("关闭"); expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["success", "actor"], ["error", "actor"],
    ["success", "readFailureABA"], ["error", "readFailureABA"],
    ["success", "demandABA"], ["error", "demandABA"],
  ])("old %s settlement after %s cannot release a new same-demand dialog lock", async (outcome, transition) => {
    let finishOld!: (value: any) => void, failOld!: (error: any) => void, finishFresh!: (value: any) => void;
    runtime.accept.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishFresh = resolve; }));
    const dirty = vi.fn();
    const props = { customer, demandId: 41, mode: "view" as const, onClose: vi.fn(), canManageOrders: true, onDirtyChange: dirty };
    render(h(CustomerDemandDialog, props)); await click("采用报价"); await click("确认采用");
    const oldSession = runtime.acceptHook.mock.calls.at(-1)?.[0].meta.customerDemandSession;
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    const oldQuery = runtime.quotes;
    if (transition === "actor") { runtime.identity = "actor:8:enterprise:32"; render(h(CustomerDemandDialog, props)); }
    if (transition === "readFailureABA") {
      runtime.detail = state(detail(), { error: { message: "FORBIDDEN" } }); render(h(CustomerDemandDialog, props));
      expect(host.querySelector("#demand-project")).toBeNull();
      runtime.detail = state(detail()); render(h(CustomerDemandDialog, props));
    }
    if (transition === "demandABA") {
      runtime.detail = state(detail({ id: 42 }));
      runtime.quotes = state({ items: [quote({ demandId: 42 })], total: 1, page: 1 });
      render(h(CustomerDemandDialog, { ...props, demandId: 42 }));
      runtime.detail = state(detail()); runtime.quotes = oldQuery;
      render(h(CustomerDemandDialog, props));
    }
    const freshSession = runtime.acceptHook.mock.calls.at(-1)?.[0].meta.customerDemandSession;
    expect(freshSession).not.toBe(oldSession);
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    expect(button("关闭").disabled).toBe(false);
    await click("采用报价"); await click("确认采用");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    runtime.toast.success.mockClear(); runtime.toast.error.mockClear(); runtime.invalidate.mockClear();
    await act(async () => { if (outcome === "success") finishOld({ acceptedQty: 100 }); else failOld(new Error("old result")); }); await settle();
    expect(runtime.toast.success).not.toHaveBeenCalled(); expect(runtime.toast.error).not.toHaveBeenCalled();
    expect(runtime.invalidate).not.toHaveBeenCalled(); expect(oldQuery.refetch).not.toHaveBeenCalled();
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    expect(button("关闭").disabled).toBe(true);
    expect(button("填写成交报价 / 生成订单").disabled).toBe(true);
    expect(host.textContent).not.toContain("old result");
    await act(async () => finishFresh({ acceptedQty: 100, replayed: false })); await settle();
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    expect(button("关闭").disabled).toBe(false);
    expect(runtime.accept).toHaveBeenCalledTimes(2);
    expect(runtime.accept.mock.calls.every(([input]) => !Object.hasOwn(input, "customerDemandSession") && !Object.hasOwn(input, "pendingToken"))).toBe(true);
  });

  it("quote unknown-result replay retains the original requestId/revision/version/quantity and releases only settled pending", async () => {
    runtime.accept.mockRejectedValueOnce(new Error("synthetic unknown result"));
    runtime.accept.mockResolvedValueOnce({ acceptedQty: 37, replayed: true });
    const dirty = vi.fn();
    render(h(CustomerDemandDialog, { customer, demandId: 41, mode: "view", onClose: vi.fn(), canManageOrders: false, onDirtyChange: dirty }));
    await click("采用报价"); change('input[aria-label="SYNTHETIC-401采用数量"]', "37");
    await click("确认采用"); await settle();
    expect(host.textContent).toContain("synthetic unknown result");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    expect(runtime.accept).toHaveBeenCalledTimes(1);
    await click("确认采用"); await settle();
    expect(runtime.accept).toHaveBeenCalledTimes(2);
    expect(runtime.accept.mock.calls[1][0]).toEqual(runtime.accept.mock.calls[0][0]);
    expect(runtime.accept.mock.calls[1][0]).toMatchObject({ demandId: 41, quoteId: 501, quoteVersion: 3, demandRevision: 2, requestId: expect.any(String), items: [{ demandItemId: 401, alternateNo: 1, qty: 37 }] });
    expect(runtime.toast.success).toHaveBeenCalledWith("该报价已采用");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
