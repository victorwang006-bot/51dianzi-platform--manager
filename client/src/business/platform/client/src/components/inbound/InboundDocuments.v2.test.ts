// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboundDocuments, InboundDocumentDetails } from "./InboundDocuments";
import { stableInboundDocuments, useInboundDocumentDraft, type AuthorizedInboundDocument, type InboundDocumentReference } from "./inboundDocumentDraft";
const file = (name = "同名合同.pdf", type = "application/pdf") => new File(["synthetic"], name, { type });
const contract: AuthorizedInboundDocument = { kind: "contract", key: "synthetic-private/key-a", name: "同名合同.pdf", mimeType: "application/pdf", size: 9, url: "https://private.invalid/upload-stale", expiresIn: 300 };
const image: AuthorizedInboundDocument = { ...contract, kind: "bank_receipt", key: "synthetic-private/key-b", name: "水单.png", mimeType: "image/png" };
const wait = () => new Promise(r => setTimeout(r, 10));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let host: HTMLDivElement, root: Root, draft: ReturnType<typeof useInboundDocumentDraft>, activeScope: boolean;
const access = vi.fn(), upload = vi.fn(), load = vi.fn();
function Harness({ scope = "a", enabled = true, bulk = false, orderId, existing = false }: { scope?: string; enabled?: boolean; bulk?: boolean; orderId?: number; existing?: boolean }) {
  draft = useInboundDocumentDraft({ ownerScope: scope, responseFence: `${scope}:verified`, clientRequestId: "synthetic-request-0001", orderId, enabled, upload, access, isCurrentScope: () => activeScope });
  React.useEffect(() => { if (existing) draft.reset([contract, image]); }, [existing]);
  return createElement(InboundDocuments, { draft, bulk, disabled: !enabled });
}
async function render(props: React.ComponentProps<typeof Harness> = {}) { await act(async () => root.render(createElement(Harness, props))); }
async function click(label: string) { await act(async () => { const b = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ?? Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label); if (!b) throw Error(`missing ${label}`); b.click(); await wait(); }); }
async function select(files: File[], kind = "合同") { await act(async () => { const input = host.querySelector<HTMLInputElement>(`[aria-label="选择${kind}"]`)!; Object.defineProperty(input, "files", { configurable: true, value: files }); input.dispatchEvent(new Event("change", { bubbles: true })); await wait(); }); }
async function detail(id = 7, scope = "a", enabled = true) { await act(async () => root.render(createElement(InboundDocumentDetails, { id, scope, enabled, load, access: (id, key, mode) => access({ id, key, mode }), isCurrentScope: () => activeScope }))); }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); activeScope = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  upload.mockReset().mockImplementation(async input => ({ ...contract, key: `synthetic-private/${upload.mock.calls.length}`, name: input.fileName, kind: input.kind, mimeType: input.mimeType, documentsOnly: false }));
  access.mockReset().mockImplementation(async input => ({ ...(input.key === image.key ? image : contract), key: input.key, url: `https://private.invalid/fresh-${input.mode}-${access.mock.calls.length}` }));
  load.mockReset().mockResolvedValue([contract, image]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("v2 real attachment DOM / fresh scoped access", () => {
  it.each([false, true])("manual/bulk=%s pending PDF preview and download use exact request scope, no upload URL or save", async bulk => {
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render({ bulk }); await select([file()]); const key = draft.documents[0].key;
    await click(`预览合同 ${contract.name}`); expect(access).toHaveBeenLastCalledWith({ key, clientRequestId: "synthetic-request-0001", mode: "preview" });
    const frame = host.querySelector<HTMLIFrameElement>("iframe")!; expect(frame.src).toContain("fresh-preview-1"); expect(frame.title).toContain("PDF预览"); expect(host.querySelector("img")).toBeNull();
    await click("关闭预览"); expect(host.querySelector("iframe")).toBeNull();
    await click(`下载合同 ${contract.name}`); expect(access).toHaveBeenLastCalledWith({ key, clientRequestId: "synthetic-request-0001", mode: "download" }); expect(anchor).toHaveBeenCalledOnce();
    const a = anchor.mock.instances[0] as HTMLAnchorElement; expect(a.href).toContain("fresh-download-2"); expect(a.download).toBe(""); expect(a.target).toBe(""); expect(a.rel).toContain("noopener");
    expect(stableInboundDocuments(draft.documents)[0]).toEqual({ kind: "contract", key, name: contract.name, mimeType: "application/pdf", size: 9 }); expect(host.innerHTML).not.toContain("upload-stale");
  });
  it("existing edit and newly uploaded edit use linked id versus original target pending scope", async () => {
    await render({ orderId: 7, existing: true }); await click(`预览合同 ${contract.name}`); expect(access).toHaveBeenLastCalledWith({ id: 7, key: contract.key, mode: "preview" }); await click("关闭预览");
    await select([file()]); const key = draft.documents.at(-1)!.key;
    const buttons = host.querySelectorAll<HTMLButtonElement>(`[aria-label="预览合同 ${contract.name}"]`); await act(async () => { buttons[1].click(); await wait(); });
    expect(access).toHaveBeenLastCalledWith({ key, clientRequestId: "synthetic-request-0001", orderId: 7, mode: "preview" });
  });
  it("same filenames are independent keyed rows and are never overwritten", async () => {
    await render(); await select([file(), file()]); expect(draft.documents).toHaveLength(2); expect(new Set(draft.documents.map(d => d.key)).size).toBe(2); expect(host.querySelectorAll('[aria-label="预览合同 同名合同.pdf"]')).toHaveLength(2);
    const firstKey = draft.documents[0].key; await act(async () => draft.remove(firstKey)); expect(draft.documents).toHaveLength(1); expect(draft.documents[0].key).not.toBe(firstKey);
  });
  it("details image and PDF reauthorize separately on every mode and reopening", async () => {
    await detail(); await click(`预览银行付款水单 ${image.name}`); expect(host.querySelector<HTMLImageElement>("img")!.src).toContain("fresh-preview-1"); expect(access).toHaveBeenLastCalledWith({ id: 7, key: image.key, mode: "preview" }); await click("关闭预览");
    await click(`预览合同 ${contract.name}`); expect(host.querySelector<HTMLIFrameElement>("iframe")!.src).toContain("fresh-preview-2"); await click("关闭预览");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); await click(`下载合同 ${contract.name}`); expect(access).toHaveBeenLastCalledWith({ id: 7, key: contract.key, mode: "download" });
    await act(async () => root.render(createElement("div"))); await detail(); expect(load).toHaveBeenCalledTimes(2); await click(`预览合同 ${contract.name}`); expect(access).toHaveBeenCalledTimes(4);
  });
  it.each(["javascript:alert(1)", "data:text/html,<script>1</script>", "blob:https://private.invalid/test", "/relative", "http://private.invalid/a", "https://user:password@private.invalid/a"])("rejects unsafe URL %s", async url => {
    await detail(); access.mockResolvedValue({ ...contract, url }); await click(`预览合同 ${contract.name}`); expect(host.querySelector("iframe,img")).toBeNull(); expect(host.textContent).toContain("地址");
  });
  it.each([ ["key", "other"], ["kind", "bank_receipt"], ["name", "other.pdf"], ["mimeType", "text/html"], ["size", 10] ])("rejects changed authorized metadata %s", async (field, value) => {
    await detail(); access.mockResolvedValue({ ...contract, [field]: value }); await click(`预览合同 ${contract.name}`); expect(host.querySelector("iframe,img")).toBeNull(); expect(host.textContent).toContain("附件已变化");
  });
  it("closed preview ignores late URL and explicit reopen fetches again", async () => {
    await detail(); const pending = deferred<AuthorizedInboundDocument>(); access.mockReturnValueOnce(pending.promise);
    await click(`预览合同 ${contract.name}`); await click("关闭预览"); await act(async () => pending.resolve(contract)); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.innerHTML).not.toContain(contract.url);
    await click(`预览合同 ${contract.name}`); expect(access).toHaveBeenCalledTimes(2);
  });
  it("download cancellation never navigates a late authorization response", async () => {
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); await detail(); const pending = deferred<AuthorizedInboundDocument>(); access.mockReturnValueOnce(pending.promise);
    await click(`下载合同 ${contract.name}`); await click("取消"); await act(async () => pending.resolve(contract)); expect(anchor).not.toHaveBeenCalled(); expect(access).toHaveBeenCalledOnce();
  });
  it("scope switch/logout closes and clears preview, including late URL and stale current-scope singleton", async () => {
    await detail(); await click(`预览合同 ${contract.name}`); expect(host.querySelector("iframe")).not.toBeNull(); await detail(7, "b", false); expect(host.querySelector('[role="dialog"],iframe,img')).toBeNull(); expect(host.textContent).not.toContain(contract.name);
    await detail(); const pending = deferred<AuthorizedInboundDocument>(); access.mockReturnValueOnce(pending.promise); await click(`预览合同 ${contract.name}`); activeScope = false; await detail(); await act(async () => pending.resolve(contract)); expect(host.querySelector("iframe")).toBeNull();
  });
  it("deleting a draft reference closes its active preview and cancels late URLs", async () => {
    await render(); await select([file()]); await click(`预览合同 ${contract.name}`); await click(`删除合同 ${contract.name}`); expect(host.querySelector('[role="dialog"],iframe,img')).toBeNull(); expect(draft.documents).toEqual([]);
  });
  it("expired order authorization closes preview and leaves short retryable error, no URL", async () => {
    await detail(); access.mockRejectedValue(Object.assign(new Error("单据已失效"), { data: { code: "NOT_FOUND" } })); await click(`预览合同 ${contract.name}`); expect(host.querySelector('[role="dialog"],iframe,img')).toBeNull(); expect(host.textContent).toContain("单据已失效");
  });
  it("short empty attachment UI has labels/count but no placeholders or duplicated guidance", async () => {
    await render(); expect(host.textContent).toContain("合同上传（0/5）"); expect(host.textContent).toContain("银行付款水单上传（0/5）"); for (const text of ["未上传", "PDF、JPG", "上传水单不改变", "请重试失败附件", "附件上传中，请完成后提交"]) expect(host.textContent).not.toContain(text);
  });
});
