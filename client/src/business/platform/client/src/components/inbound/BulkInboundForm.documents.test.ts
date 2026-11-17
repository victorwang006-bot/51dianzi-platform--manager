// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcurementBuyerScope } from "./procurementBuyerSelection";
import type { InboundDocumentReference, InboundDocumentUploadInput } from "./inboundDocumentDraft";
const fixture = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn(), onSuccess: vi.fn(), onDirty: vi.fn(), onBusy: vi.fn() }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ inbound: { list: { invalidate: fixture.invalidate }, overview: { invalidate: fixture.invalidate } } }), inbound: { bulkCreate: { useMutation: () => ({ mutate: fixture.mutate }) } } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { BulkInboundForm } from "./BulkInboundForm";
const team: ProcurementBuyerScope = { actorUserId: 7002, canChooseBuyer: true, teamId: 9, scope: "team", options: [{ userId: 7002, name: "采购甲", username: "buyer-a" }, { userId: 7003, name: "采购乙", username: "buyer-b" }] };
const reference = (input: InboundDocumentUploadInput) => ({ kind: input.kind, key: `synthetic-private/${input.clientRequestId}/${input.fileName}`, name: input.fileName, mimeType: input.mimeType, size: 64, url: "https://files.invalid/private?signature=not-submitted" });
const upload = vi.fn<(input: InboundDocumentUploadInput) => Promise<InboundDocumentReference>>();
let host: HTMLDivElement, root: Root;
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred<T>() { let resolve!: (result: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); upload.mockImplementation(async input => reference(input)); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(owner = "account-a:enterprise-a:batch-a", scope = team, enabled = true) { await act(async () => root.render(createElement(BulkInboundForm, { buyerScope: scope, documentOwnerScope: owner, documentResponseFence: "verified", documentEnabled: enabled, uploadDocument: upload, onSuccess: fixture.onSuccess, onDirtyChange: fixture.onDirty, onBusyChange: fixture.onBusy }))); }
function button(text: string) { const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text); if (!result) throw new Error(`Missing ${text}`); return result; }
async function click(text: string) { await act(async () => { button(text).click(); await wait(); }); }
async function fill(label: string, value: string) { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; await act(async () => { const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function select(label: string, value: string) { await act(async () => { const input = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function manualRow(price = "2.26") { await click("新增行"); await fill("第2行料号", "stm32"); await fill("第2行数量", "50"); await fill("第2行年份/DC", "2026"); await fill("第2行采购单价", price); await fill("第2行供应商", "供应商甲"); }
async function choose(kind: "合同" | "银行付款水单", name: string, type: string) { await act(async () => { const input = host.querySelector<HTMLInputElement>(`[aria-label="选择${kind}"]`)!; Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic only"], name, { type })] }); input.dispatchEvent(new Event("change", { bubbles: true })); await wait(); }); }

describe("real bulk documents without transport/DB", () => {
  it("shares optional batch docs at top-level and preserves upload-bound UUID through quantity and buyer edits", async () => {
    await render(); await manualRow(); await choose("合同", "contract.pdf", "application/pdf"); await fill("第2行数量", "51"); await select("第2行采购员", "7003"); await choose("银行付款水单", "receipt.png", "image/png"); await click("确认录入");
    const payload = fixture.mutate.mock.calls[0][0];
    expect(payload.clientRequestId).toBe(upload.mock.calls[0][0].clientRequestId); expect(payload.clientRequestId).toBe(upload.mock.calls[1][0].clientRequestId);
    expect(payload.documents.map((item: any) => item.kind)).toEqual(["contract", "bank_receipt"]); expect(payload.documents[0]).not.toHaveProperty("url");
    expect(payload.rows[0]).toMatchObject({ qty: 51, unitCost: 2.26, buyerUserId: 7003, operator: "采购乙" }); expect(payload.rows[0]).not.toHaveProperty("documents");
    expect(payload).not.toHaveProperty("payment"); expect(host.textContent).toContain("本批共享");
  });
  it("blocks submission and parent closing while upload is outstanding, then permits explicit remove", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render(); await manualRow(); await choose("合同", "contract.pdf", "application/pdf");
    expect(button("确认录入").disabled).toBe(true); expect(fixture.onBusy).toHaveBeenCalledWith(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除合同 contract.pdf"]')!.click()); expect(button("确认录入").disabled).toBe(false);
    await act(async () => pending.resolve(reference(upload.mock.calls[0][0]))); await click("确认录入"); expect(fixture.mutate.mock.calls[0][0].documents).toEqual([]);
  });
  it("unknown result freezes documents and retries exact original UUID/payload without another upload", async () => {
    fixture.mutate.mockImplementation((_payload, callbacks) => callbacks.onError({ message: "synthetic timeout" }));
    await render(); await manualRow(); await choose("合同", "contract.pdf", "application/pdf"); await click("确认录入");
    const original = fixture.mutate.mock.calls[0][0]; expect(host.textContent).toContain("结果未确认"); expect(host.querySelector<HTMLButtonElement>('[aria-label="删除合同 contract.pdf"]')!.disabled).toBe(true);
    await render("account-a:enterprise-a:batch-a", { ...team, options: [team.options[0]] }); await click("重试原请求");
    expect(fixture.mutate.mock.calls[1][0]).toBe(original); expect(upload).toHaveBeenCalledOnce();
    await render("account-a:enterprise-a:batch-a", team, false); expect(button("重试原请求").disabled).toBe(true);
  });
  it("replacing the import source starts a new batch without old documents, preserving original paste parser", async () => {
    await render(); await manualRow(); await choose("合同", "old-contract.pdf", "application/pdf");
    await click("粘贴表格"); await fill("Excel TSV", "料号\t数量\t年份/DC\t采购单价\t采购员\t供应商\nNEWPART\t3\t2026\t1.25\tbuyer-a\t新供应商"); await click("读取粘贴"); await click("预览"); await click("确认录入");
    const payload = fixture.mutate.mock.calls[0][0]; expect(payload.documents).toEqual([]); expect(payload.clientRequestId).not.toBe(upload.mock.calls[0][0].clientRequestId); expect(payload.rows[0]).toMatchObject({ partNumber: "NEWPART", qty: 3, unitCost: 1.25 });
  });
  it("missing price acceptance includes only current batch documents and original 0-price confirmation", async () => {
    await render(); await manualRow(""); await choose("合同", "contract.pdf", "application/pdf"); await click("确认录入"); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull(); await click("按 0 元录入");
    const payload = fixture.mutate.mock.calls[0][0]; expect(payload.acceptMissingPrices).toBe(true); expect(payload.rows[0].unitCost).toBeNull(); expect(payload.documents).toHaveLength(1); expect(payload.clientRequestId).toBe(upload.mock.calls[0][0].clientRequestId);
  });
  it("a changed owner/batch fences late uploads and never puts an old contract in a different batch", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render(); await manualRow(); await choose("合同", "contract.pdf", "application/pdf"); await render("account-b:enterprise-b:batch-b");
    await act(async () => pending.resolve(reference(upload.mock.calls[0][0]))); await click("确认录入"); expect(fixture.mutate.mock.calls[0][0].documents).toEqual([]);
  });
});
