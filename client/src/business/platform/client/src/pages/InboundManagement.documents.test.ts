// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  rows: [] as any[], buyers: {} as any, verified: true, storage: "account-a:enterprise-a", activeStorage: "account-a:enterprise-a", location: "/inbound",
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>, photoRead: vi.fn(), documentsRead: vi.fn(), access: vi.fn(), upload: vi.fn(), onAuthError: vi.fn(),
}));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: any) => children }));
vi.mock("../../../../BusinessScope", () => ({ businessStorageScope: () => runtime.activeStorage, useBusinessScope: () => ({ frontUser: { id: 201 }, merchantId: 301, staffPrincipal: { frontendUserId: 201 }, storageScope: runtime.storage, contextVerification: { state: runtime.verified ? "verified" : "revalidating", identity: runtime.storage, authorizationVersion: "synthetic-proof-1" }, onAuthorizationError: runtime.onAuthError }) }));
vi.mock("../../../../../lib/adminNewInformation", async importOriginal => ({ ...(await importOriginal<any>()), useAdminNewInformationContextRows: () => ({ getRow: () => ({ isNew: false, ref: undefined }) }) }));
vi.mock("wouter", () => ({ useLocation: () => [runtime.location, vi.fn()] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../api/business-trpc", () => {
  const query = (name: string) => ({
    useQuery: () => ({ data: name === "list" ? runtime.rows : name === "procurementBuyers" ? runtime.buyers : name === "photos" ? [] : undefined, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: vi.fn() }),
    useMutation: () => ({ mutate: runtime.mutations[name] ??= vi.fn(), mutateAsync: name === "uploadDocument" ? runtime.upload : vi.fn(), isPending: false }),
    invalidate: vi.fn(), cancel: vi.fn(),
    fetch: name === "photos" ? runtime.photoRead : name === "documents" ? runtime.documentsRead : name === "documentAccess" ? runtime.access : vi.fn(),
  });
  const domain = new Proxy({}, { get: (_target, name: string) => query(name) });
  const utils = new Proxy({}, { get: () => domain });
  return { trpc: new Proxy({ useUtils: () => utils }, { get: (target, name: string) => name === "useUtils" ? target.useUtils : domain }) };
});
import InboundManagement from "./InboundManagement";
const contract = { kind: "contract", key: "synthetic-private/contract", name: "合成旧合同.pdf", mimeType: "application/pdf", size: 64, url: "https://files.invalid/private?signature=old", expiresIn: 300 };
const receipt = { kind: "bank_receipt", key: "synthetic-private/receipt", name: "合成旧水单.png", mimeType: "image/png", size: 32, url: "https://files.invalid/private?signature=old", expiresIn: 300 };
let host: HTMLDivElement, root: Root;
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); runtime.mutations = {};
  runtime.storage = "account-a:enterprise-a"; runtime.activeStorage = runtime.storage; runtime.verified = true; runtime.location = "/inbound";
  runtime.buyers = { actorUserId: 201, canChooseBuyer: true, teamId: 9, scope: "team", options: [{ userId: 201, name: "采购甲", username: "buyer-a" }, { userId: 202, name: "采购乙", username: "buyer-b" }] };
  runtime.rows = [{ id: 1, slipNo: "SYNTHETIC-ONLY-1", partNumber: "STM32", qty: 3, prodYear: "2026", status: "in_transit", unitCost: "2.26", taxRate: "13", unitCostBasis: "CNY_TAX_INCLUDED", supplierName: "合成供应商", location: "A-01", inboundDate: "2026-11-17", operator: "采购甲", buyerUserId: 201, paymentCategory: "unpaid", paidAmount: "0.00", paymentTracked: true, paymentPercentage: null }];
  runtime.photoRead.mockResolvedValue([]); runtime.documentsRead.mockResolvedValue([contract, receipt]);
  runtime.access.mockImplementation(async ({ key }) => ({ ...(key === contract.key ? contract : receipt), url: "https://files.invalid/private?signature=current" }));
  runtime.upload.mockImplementation(async input => ({ kind: input.kind, key: `synthetic-private/${input.fileName}`, name: input.fileName, mimeType: input.mimeType, size: 64, url: "https://files.invalid/private?signature=upload", expiresIn: 300 }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(createElement(InboundManagement))); }
function form() { return host.querySelector<HTMLElement>('[aria-label="新建采购入库单"],[aria-label="编辑入库单"]')!; }
function visibleSingle() { return form().querySelector<HTMLElement>('.inbound-form-controls')!; }
function button(text: string, within: ParentNode = host) { const found = Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text); if (!found) throw new Error(`Missing ${text}`); return found; }
async function click(text: string, within: ParentNode = host) { await act(async () => { button(text, within).click(); await wait(); }); }
async function fill(label: string, value: string) {
  const field = Array.from(form().querySelectorAll<HTMLElement>(".inbound-field")).find(node => node.querySelector("label")?.textContent?.replace(/\*/g, "").trim() === label)!;
  const input = field.querySelector<HTMLInputElement>("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function choose(kind: string, name: string, type: string) {
  // Both entry modes stay mounted by original design. Select only the single panel.
  const input = Array.from(form().querySelectorAll<HTMLInputElement>(`[aria-label="选择${kind}"]`)).find(node => !node.closest('[hidden]'))!;
  await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic only"], name, { type })] }); input.dispatchEvent(new Event("change", { bubbles: true })); await wait(); });
}
async function openCreate() { await render(); await click("新建采购入库"); }
async function validCreate() { await fill("料号/型号", "stm32"); await fill("计划到货数量", "3"); await fill("供应商名称", "合成供应商"); }
async function openEdit() { await render(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="操作 SYNTHETIC-ONLY-1"]')!.click()); await click("编辑"); }

describe("actual inbound documents UI, synthetic provider/transport only", () => {
  it("new create uploads bind the original UUID and submit stable refs without changing unpaid/amount fields", async () => {
    await openCreate(); await validCreate(); await choose("合同", "contract.pdf", "application/pdf"); await choose("银行付款水单", "receipt.png", "image/png"); await click("保存为在途", form());
    const payload = runtime.mutations.create.mock.calls[0][0]; expect(payload.clientRequestId).toBe(runtime.upload.mock.calls[0][0].clientRequestId); expect(payload.clientRequestId).toBe(runtime.upload.mock.calls[1][0].clientRequestId);
    expect(payload.documents.map((item: any) => item.kind)).toEqual(["contract", "bank_receipt"]); expect(payload.documents[0]).not.toHaveProperty("url"); expect(payload.photos).toEqual([]);
    expect(payload.payment).toMatchObject({ mode: "unpaid", amount: undefined, paymentDate: undefined }); expect(runtime.mutations.recordPayment).not.toHaveBeenCalled();
    expect(form().querySelectorAll('.inbound-entry-header')).toHaveLength(1);
  });
  it("optional attachments allow ordinary create, and a failed/unknown create retains its UUID", async () => {
    await openCreate(); await validCreate(); await click("保存为在途", form()); await click("保存为在途", form());
    const [first, second] = runtime.mutations.create.mock.calls; expect(first[0].documents).toEqual([]); expect(first[0].clientRequestId).toBe(second[0].clientRequestId); expect(runtime.mutations.create).toHaveBeenCalledTimes(2);
  });
  it("editing rereads old refs with photos, supplies orderId on new upload, and updates stable documents only", async () => {
    await openEdit(); expect(runtime.photoRead).toHaveBeenCalledWith({ id: 1 }); expect(runtime.documentsRead).toHaveBeenCalledWith({ id: 1 }, { staleTime: 0 }); expect(form().textContent).toContain(contract.name);
    await choose("银行付款水单", "new-receipt.png", "image/png"); expect(runtime.upload.mock.calls[0][0].orderId).toBe(1);
    await click("保存修改", form()); const payload = runtime.mutations.update.mock.calls[0][0]; expect(payload.id).toBe(1); expect(payload.data.documents).toHaveLength(3); expect(payload.data.documents.every((item: any) => !("url" in item))).toBe(true); expect(runtime.mutations.create).not.toHaveBeenCalled();
  });
  it("received-order edit keeps immutable fields and supports clearing document references via updateDetails", async () => {
    runtime.rows[0].status = "received"; await openEdit(); expect(form().textContent).toContain("不能直接修改");
    await act(async () => { form().querySelector<HTMLButtonElement>(`[aria-label="删除合同 ${contract.name}"]`)!.click(); form().querySelector<HTMLButtonElement>(`[aria-label="删除银行付款水单 ${receipt.name}"]`)!.click(); });
    await click("保存修改", form()); expect(runtime.mutations.updateDetails.mock.calls[0][0]).toMatchObject({ id: 1, documents: [], photos: [], location: "A-01" }); expect(runtime.mutations.update).not.toHaveBeenCalled();
  });
  it("detail reopen rereads old refs and each class downloads only by id/key documentAccess", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render(); await click("SYNTHETIC-ONLY-1"); expect(runtime.documentsRead).toHaveBeenCalledWith({ id: 1 }, { staleTime: 0 });
    await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="下载合同 ${contract.name}"]`)!.click(); await wait(); }); expect(runtime.access).toHaveBeenCalledWith({ id: 1, key: contract.key }, { staleTime: 0 });
    await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="下载银行付款水单 ${receipt.name}"]`)!.click(); await wait(); }); expect(runtime.access).toHaveBeenCalledWith({ id: 1, key: receipt.key }, { staleTime: 0 }); expect(anchorClick).toHaveBeenCalledTimes(2);
    await click("关闭", host.querySelector('[aria-label="入库单详情"]')!); await click("SYNTHETIC-ONLY-1"); expect(runtime.documentsRead).toHaveBeenCalledTimes(2);
  });
  it("late upload after buyer/enterprise changes never associates the wrong draft; upload prevents submit/close", async () => {
    const pending = deferred<any>(); runtime.upload.mockImplementation(() => pending.promise);
    await openCreate(); await validCreate(); await choose("合同", "contract.pdf", "application/pdf"); expect(button("保存为在途", form()).disabled).toBe(true); expect(form().querySelector<HTMLButtonElement>('[aria-label="关闭新建采购入库单"]')!.disabled).toBe(true);
    await act(async () => { const buyer = form().querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!; buyer.value = "202"; buyer.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => pending.resolve({ ...contract, name: "contract.pdf" })); expect(form().textContent).not.toContain("contract.pdf");
    runtime.activeStorage = "account-b:enterprise-b"; await render(); expect(button("保存为在途", form()).disabled).toBe(true);
  });
  it("late old edit read cannot replace a newly opened create draft", async () => {
    const pending = deferred<any[]>(); runtime.documentsRead.mockImplementation(() => pending.promise);
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="操作 SYNTHETIC-ONLY-1"]')!.click()); await click("编辑"); await click("新建采购入库");
    await act(async () => pending.resolve([contract])); expect(form().getAttribute("aria-label")).toBe("新建采购入库单"); expect(form().textContent).not.toContain(contract.name);
  });
});
