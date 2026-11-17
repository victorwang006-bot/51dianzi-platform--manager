// @vitest-environment jsdom
import * as React from "react";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboundDocuments, InboundDocumentDetails } from "./InboundDocuments";
import { INBOUND_DOCUMENT_MAX_BYTES, inboundDocumentFileError, stableInboundDocuments, useInboundDocumentDraft, type AuthorizedInboundDocument, type InboundDocumentReference, type InboundDocumentUploadInput } from "./inboundDocumentDraft";

const contract: AuthorizedInboundDocument = { kind: "contract", key: "private/synthetic-contract", name: "合成合同.pdf", mimeType: "application/pdf", size: 64, url: "https://files.invalid/current-contract?signature=old" };
const receipt: AuthorizedInboundDocument = { kind: "bank_receipt", key: "private/synthetic-receipt", name: "合成水单.png", mimeType: "image/png", size: 32, url: "https://files.invalid/current-receipt?signature=old" };
const synthetic = (name = "synthetic.pdf", type = "application/pdf") => new File(["synthetic test file; not a real document"], name, { type });
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
let host: HTMLDivElement, root: Root;
let draft: ReturnType<typeof useInboundDocumentDraft>;
const upload = vi.fn<(input: InboundDocumentUploadInput) => Promise<InboundDocumentReference>>();
function Harness({ owner = "account-a:enterprise-a:draft-a", fence = "buyer-a:verified", enabled = true, initial, bulk = false }: { owner?: string; fence?: string; enabled?: boolean; initial?: InboundDocumentReference[]; bulk?: boolean }) {
  draft = useInboundDocumentDraft({ ownerScope: owner, responseFence: fence, clientRequestId: "synthetic-create-request-0001", enabled, upload });
  useEffect(() => { if (initial) draft.reset(initial); }, [initial]);
  return createElement(React.Fragment, null,
    createElement(InboundDocuments, { draft, disabled: !enabled, bulk }),
    createElement("button", { "data-testid": "submit", disabled: !enabled || draft.blocked }, "提交"));
}
async function render(props: React.ComponentProps<typeof Harness> = {}) { await act(async () => root.render(createElement(Harness, props))); }
async function choose(label: string, files: File[]) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="选择${label}"]`)!;
  await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: files }); input.dispatchEvent(new Event("change", { bubbles: true })); await wait(); });
}
async function click(label: string) { await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); await wait(); }); }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  upload.mockImplementation(async input => ({ kind: input.kind, key: `private/${input.clientRequestId}/${input.fileName}`, name: input.fileName, mimeType: input.mimeType, size: 64 }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("synthetic attachment validation", () => {
  it.each([
    ["file.pdf", "application/pdf", ""], ["file.jpg", "image/jpeg", ""], ["file.jpeg", "image/jpeg", ""], ["file.png", "image/png", ""], ["file.webp", "image/webp", ""],
    ["file.exe", "application/octet-stream", "仅支持"], ["file.docx", "application/pdf", "扩展名"], ["file.pdf", "", "仅支持"],
  ])("validates MIME and extension %s %s", (name, type, expected) => { expect(inboundDocumentFileError({ name, type, size: 16 })).toContain(expected); });
  it("accepts exact 5MiB, rejects empty and 5MiB+1", () => {
    expect(inboundDocumentFileError({ name: "test.pdf", type: "application/pdf", size: INBOUND_DOCUMENT_MAX_BYTES })).toBe("");
    expect(inboundDocumentFileError({ name: "test.pdf", type: "application/pdf", size: INBOUND_DOCUMENT_MAX_BYTES + 1 })).toContain("5MiB");
    expect(inboundDocumentFileError({ name: "test.pdf", type: "application/pdf", size: 0 })).toContain("空文件");
  });
  it("whitelists stable metadata and never spreads temporary signed URLs", () => {
    expect(stableInboundDocuments([contract, receipt])).toEqual([
      { kind: contract.kind, key: contract.key, name: contract.name, mimeType: contract.mimeType, size: contract.size },
      { kind: receipt.kind, key: receipt.key, name: receipt.name, mimeType: receipt.mimeType, size: receipt.size },
    ]);
  });
});

describe("real shared document UI and hook", () => {
  it("sends each selected file with its explicit kind; optional empty draft can submit", async () => {
    await render(); expect(host.querySelector<HTMLButtonElement>('[data-testid="submit"]')!.disabled).toBe(false);
    await choose("合同", [synthetic("contract.pdf")]); await choose("银行付款水单", [synthetic("receipt.png", "image/png")]);
    expect(upload.mock.calls.map(([input]) => input.kind)).toEqual(["contract", "bank_receipt"]);
    expect(draft.documents.map(item => item.kind)).toEqual(["contract", "bank_receipt"]);
    expect(host.textContent).not.toContain("上传水单不改变付款状态或金额");
    expect(host.querySelectorAll('[aria-label="单据附件"]')).toHaveLength(1);
  });
  it("rejects oversize/type/count before transport; classes each get their own five slots", async () => {
    await render({ initial: Array.from({ length: 5 }, (_, i) => ({ ...contract, key: `private/contract-${i}` })) });
    await choose("合同", [synthetic()]); expect(upload).not.toHaveBeenCalled(); expect(host.textContent).toContain("最多 5 份");
    await choose("银行付款水单", [synthetic("receipt.png", "image/png")]); expect(upload).toHaveBeenCalledOnce();
    await choose("银行付款水单", [synthetic("bad.svg", "image/svg+xml")]); expect(upload).toHaveBeenCalledOnce(); expect(host.textContent).toContain("仅支持");
    const huge = synthetic(); Object.defineProperty(huge, "size", { value: INBOUND_DOCUMENT_MAX_BYTES + 1 });
    await choose("银行付款水单", [huge]); expect(upload).toHaveBeenCalledOnce(); expect(host.textContent).toContain("5MiB");
  });
  it("blocks submit while reading/uploading and failures; explicit retry retains the upload clientRequestId", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementationOnce(() => pending.promise);
    await render(); await choose("合同", [synthetic()]);
    expect(draft.busy).toBe(true); expect(host.querySelector<HTMLButtonElement>('[data-testid="submit"]')!.disabled).toBe(true);
    await act(async () => pending.reject(new Error("合成网络失败")));
    expect(draft.busy).toBe(false); expect(draft.blocked).toBe(true); expect(host.textContent).toContain("合成网络失败");
    const original = upload.mock.calls[0][0]; await click("重试合同 synthetic.pdf");
    expect(upload.mock.calls[1][0].clientRequestId).toBe(original.clientRequestId); expect(upload.mock.calls[1][0].kind).toBe(original.kind);
    expect(draft.documents).toHaveLength(1); expect(draft.blocked).toBe(false);
    await click("删除合同 synthetic.pdf"); expect(draft.documents).toHaveLength(0); expect(upload).toHaveBeenCalledTimes(2);
  });
  it("delete during upload drops only the reference, ignores its late response and frees submit", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render(); await choose("合同", [synthetic()]); await click("删除合同 synthetic.pdf");
    expect(draft.isBlocked()).toBe(false);
    await act(async () => pending.resolve(contract)); expect(draft.documents).toHaveLength(0);
  });
  it("reserves uploading/failed slots to prevent >5 concurrent selections", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render(); await choose("合同", Array.from({ length: 5 }, (_, i) => synthetic(`test-${i}.pdf`)));
    expect(upload).toHaveBeenCalledTimes(5);
    await choose("合同", [synthetic("sixth.pdf")]); expect(upload).toHaveBeenCalledTimes(5); expect(host.textContent).toContain("最多 5 份");
  });
  it("buyer change/revalidation preserves ready draft refs but fences late uploading refs", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render({ initial: [contract] }); await choose("银行付款水单", [synthetic("receipt.png", "image/png")]);
    await render({ fence: "buyer-b:verified" });
    await act(async () => pending.resolve(receipt)); expect(draft.documents.map(item => item.key)).toEqual([contract.key]);
    expect(draft.uploads).toHaveLength(0); expect(host.textContent).toContain("未完成的附件未关联");
    await render({ fence: "buyer-b:revalidating", enabled: false }); expect(draft.documents).toHaveLength(1);
  });
  it.each(["account-b:enterprise-a:draft-a", "account-a:enterprise-b:draft-a", "account-a:enterprise-a:draft-b"])("new owner/batch %s clears old references and late uploads", async owner => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render({ initial: [contract], bulk: true }); await choose("银行付款水单", [synthetic("receipt.png", "image/png")]);
    expect(host.textContent).toContain("本批共享");
    await render({ owner, bulk: true }); await act(async () => pending.resolve(receipt));
    expect(draft.documents).toEqual([]); expect(draft.uploads).toEqual([]);
  });
  it("closed/unmounted draft never applies a late upload to a reopened draft", async () => {
    const pending = deferred<InboundDocumentReference>(); upload.mockImplementation(() => pending.promise);
    await render(); await choose("合同", [synthetic()]);
    await act(async () => root.render(createElement("div"))); await render();
    await act(async () => pending.resolve(contract)); expect(draft.documents).toEqual([]);
  });
});

describe("private document reread and download", () => {
  const load = vi.fn<(id: number) => Promise<AuthorizedInboundDocument[]>>();
  const access = vi.fn<(id: number, key: string) => Promise<AuthorizedInboundDocument>>();
  async function details(id = 1, scope = "account-a:enterprise-a", enabled = true) { await act(async () => root.render(createElement(InboundDocumentDetails, { id, scope, enabled, load, access }))); }
  it("reopens old references and obtains a fresh authorization for every download", async () => {
    load.mockReset().mockResolvedValue([contract, receipt]);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await details(); expect(load).toHaveBeenCalledWith(1); expect(host.textContent).toContain(contract.name); expect(host.querySelector('a[href]')).toBeNull();
    access.mockReset().mockImplementation(async (_id, key) => ({ ...(key === contract.key ? contract : receipt), url: "https://files.invalid/current?signature=new" }));
    await click(`下载合同 ${contract.name}`); expect(access).toHaveBeenCalledWith(1, contract.key, "download"); expect(anchorClick).toHaveBeenCalledOnce();
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement; expect(anchor.href).toContain("signature=new");
    await click(`下载银行付款水单 ${receipt.name}`); expect(access).toHaveBeenCalledTimes(2);
    await act(async () => root.render(createElement("div"))); await details(); expect(load).toHaveBeenCalledTimes(2);
  });
  it("read failure is explicit/retryable and does not claim there are no attachments", async () => {
    load.mockReset().mockRejectedValueOnce(new Error("合成鉴权读取失败")).mockResolvedValue([contract]);
    await details(); expect(host.textContent).toContain("合成鉴权读取失败"); expect(host.textContent).not.toContain("未上传");
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "重新获取")!.click());
    expect(host.textContent).toContain(contract.name);
  });
  it("revalidation prevents reads and late scope-switched authorization does not open download", async () => {
    load.mockReset().mockResolvedValue([contract]); const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await details(); const pending = deferred<AuthorizedInboundDocument>(); access.mockReset().mockImplementationOnce(() => pending.promise);
    await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="下载合同 ${contract.name}"]`)!.click());
    await details(1, "account-b:enterprise-b", false); await act(async () => pending.resolve(contract));
    expect(anchorClick).not.toHaveBeenCalled(); expect(host.textContent).not.toContain(contract.name); expect(host.querySelector("iframe,img")).toBeNull();
  });
});
