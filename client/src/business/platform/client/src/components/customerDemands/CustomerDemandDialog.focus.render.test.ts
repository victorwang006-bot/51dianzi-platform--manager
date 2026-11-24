// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { CustomerDemandDialog, type CustomerDemandDialogProps } from "./CustomerDemandDialog";
import { emptyCustomerDemandItem } from "../../../../shared/customerDemands";

const runtime = vi.hoisted(() => ({
  identity: "actor:7:enterprise:31", detail: undefined as any, quotePending: false,
  save: vi.fn(), invalidate: vi.fn().mockResolvedValue(undefined),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("xlsx", async original => ({ ...await original<typeof import("xlsx")>(), writeFile: vi.fn() }));
vi.mock("../../hooks/usePageIdentity", () => ({ usePageIdentity: () => runtime.identity }));
vi.mock("./useDemandQuotePending", () => ({ useDemandQuotePending: () => runtime.quotePending }));
vi.mock("wouter", () => ({ useLocation: () => ["/customers/12", vi.fn()] }));
vi.mock("sonner", () => ({ toast: runtime.toast }));
vi.mock("./DemandQuoteList", () => ({ DemandQuoteList: () => null }));
vi.mock("./ReadOnlyDemandQuotes", () => ({ ReadOnlyDemandQuotes: () => null }));
vi.mock("./DemandRevisionHistory", () => ({ DemandRevisionHistory: () => null }));
vi.mock("./DemandPartNumberInput", () => ({ DemandPartNumberInput: ({ value, disabled, rowIndex, onChange, className }: any) => h("input", { value, disabled, className, "aria-label": `第${rowIndex + 1}行型号`, onChange: (event: any) => onChange(event.target.value) }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ customerDemand: Object.fromEntries(["list", "get", "procurementList", "procurementGet", "quoteList", "revisionHistory"].map(key => [key, { invalidate: runtime.invalidate }])) }),
  customer: { context: { useQuery: () => ({ data: { actorUserId: 7, members: [{ userId: 7, name: "合成销售" }] } }) } },
  enterprise: { me: { useQuery: () => ({ data: { isOwner: false, permissionKeys: [] } }) } },
  customerDemand: {
    get: { useQuery: (_input: unknown, options: any) => options?.enabled ? runtime.detail : { data: undefined } },
    save: { useMutation: () => ({ mutateAsync: runtime.save }) },
  },
} }));
vi.mock("../ui/button", () => ({ Button: ({ children, size: _size, variant: _variant, ...props }: any) => h("button", props, children) }));
vi.mock("../customers/BeijingDateTimePicker", () => ({ BeijingDateTimePicker: ({ onChange, ...props }: any) => h("input", { ...props, onChange: (event: any) => onChange(event.target.value) }) }));
vi.mock("../customers/ConfirmDialog", () => ({ ConfirmDialog: ({ title, confirmLabel, onConfirm, onCancel }: any) => h("section", { role: "alertdialog" }, h("p", null, title), h("button", { onClick: onConfirm }, confirmLabel), h("button", { onClick: onCancel }, "取消确认")) }));

let host: HTMLDivElement, root: Root;
const customer = { id: 12, name: "合成客户" };
function render(props: Partial<CustomerDemandDialogProps> = {}) { act(() => root.render(h(CustomerDemandDialog, { customer, onClose: vi.fn(), canManageOrders: false, ...props }))); }
function button(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === text || node.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""));
  if (!node) throw new Error(`Missing button ${text}`); return node;
}
async function click(text: string) { await act(async () => button(text).click()); }
function change(label: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  if (!node) throw new Error(`Missing field ${label}`);
  act(() => { Object.getOwnPropertyDescriptor(node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
async function toggle(label: string) { await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click()); }
function workbookBytes(rows: unknown[][], secondSheet?: unknown[][]) {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "BOM");
  if (secondSheet) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(secondSheet), "另一表");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
function file(rows: unknown[][], secondSheet?: unknown[][]) {
  const bytes = workbookBytes(rows, secondSheet); const file = new File([bytes], "synthetic-demand.xlsx");
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: vi.fn().mockResolvedValue(bytes) }); return file;
}
async function upload(file: File) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="选择客户需求BOM文件"]')!;
  await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function importPreview(rows: unknown[][]) { await click("导入BOM"); await upload(file(rows)); await click("生成预览"); }
function detail(extra: any = {}) {
  return { id: 41, customerId: 12, demandNo: "XQ-41", projectName: "合成项目", priority: "normal", replyDueAt: null, note: "", status: "draft", revision: 1, version: 3,
    canEdit: true, hasActiveOrders: false, lockedItemIds: [], items: [{ ...emptyCustomerDemandItem(), id: 401, partNumber: "EXISTING", qty: 1 }], ...extra };
}
function setDetail(data: any, extra: any = {}) { runtime.detail = { data, error: null, isFetchedAfterMount: true, isFetching: false, ...extra }; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React }); vi.clearAllMocks();
  runtime.identity = "actor:7:enterprise:31"; runtime.quotePending = false; setDetail(detail());
  runtime.save.mockReset().mockResolvedValue({ id: 41, demandNo: "XQ-41", status: "draft", version: 4 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });


// Real Radix Dialog (not mocked): the BOM import is a separate portal; focus moving into it
// must not be treated as leaving the demand dialog.
beforeEach(() => {
  if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!HTMLElement.prototype.hasPointerCapture) Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, releasePointerCapture() {}, scrollIntoView() {} });
});
function doc(selector: string) { return document.querySelector<HTMLElement>(selector); }
function docButton(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(n => n.getAttribute("aria-label") === text || n.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""));
  if (!node) throw new Error(`Missing button ${text}`); return node;
}
const discardShown = () => [...document.querySelectorAll('[role="alertdialog"]')].some(n => n.textContent?.includes("放弃未保存的需求"));
describe("需求录入与 BOM 导入：真实弹窗焦点", () => {
  it("focusing 选择BOM文件 inside the separate BOM portal never asks to discard the demand", async () => {
    const close = vi.fn(); render({ onClose: close });
    await act(async () => docButton("导入BOM").click());
    const input = doc('[aria-label="选择客户需求BOM文件"]')!; expect(input).toBeTruthy();
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(discardShown()).toBe(false); expect(close).not.toHaveBeenCalled();
    await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: [file([["型号", "数量"], ["FOCUS-1", 2]])] }); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => docButton("生成预览").click());
    expect(discardShown()).toBe(false);
    await act(async () => docButton("确认追加 1 行").click());
    expect(discardShown()).toBe(false); expect(close).not.toHaveBeenCalled();
    expect([...document.querySelectorAll<HTMLInputElement>('input[aria-label="第2行型号"], input[aria-label="第1行型号"]')].some(n => n.value === "FOCUS-1")).toBe(true);
  });
  it("focus leaving to the page does not close; a real outside pointer press still asks before discarding", async () => {
    const close = vi.fn(); render({ onClose: close });
    const field = doc('[aria-label="第1行型号"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "DIRTY"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    const outside = document.createElement("button"); document.body.append(outside);
    await act(async () => { outside.focus(); outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(discardShown()).toBe(false);
    await act(async () => { outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); });
    expect(discardShown()).toBe(true); expect(close).not.toHaveBeenCalled();
    outside.remove();
  });
});
