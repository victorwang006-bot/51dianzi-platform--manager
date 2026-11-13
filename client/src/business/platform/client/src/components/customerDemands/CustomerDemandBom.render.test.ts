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
vi.mock("../ui/dialog", () => ({ Dialog: ({ children }: any) => h(React.Fragment, null, children), DialogContent: ({ children }: any) => h("section", { role: "dialog" }, children), DialogTitle: ({ children }: any) => h("h2", null, children), DialogDescription: ({ children }: any) => h("p", null, children) }));
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

describe("需求BOM本地导入交互", () => {
  it("keeps manual entry and downloads a seven-column template without any mutation", async () => {
    render(); expect(button("新增一行").disabled).toBe(false); await click("下载模板");
    expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledWith(expect.objectContaining({ SheetNames: ["客户需求BOM", "填写说明"] }), "客户需求BOM导入模板.xlsx", { bookType: "xlsx", compression: true });
    expect(runtime.save).not.toHaveBeenCalled();
  });
  it("previews errors, corrects in-place, retains duplicate rows and replaces the initial blank only on confirmation", async () => {
    const dirty = vi.fn(), close = vi.fn(); render({ onDirtyChange: dirty, onClose: close });
    await importPreview([["型号", "品牌", "封装", "数量", "单位", "要求交期", "备注", "电话"], ["TEST", "BRAND", "QFN", 2, "片", "现货", "仅物料", "13800000000"], ["TEST", "", "", 0, "", "", ""]]);
    expect(host.textContent).toContain("有效行 1 · 错误行 1"); expect(host.textContent).toContain("重复型号提示：TEST");
    expect(button("确认追加 2 行").disabled).toBe(true); expect(runtime.save).not.toHaveBeenCalled();
    change("BOM第3行数量", "3"); await click("确认追加 2 行");
    expect(host.querySelector('[aria-label="第1行型号"]')?.getAttribute("value")).toBe("TEST");
    expect(host.querySelector('[aria-label="第2行型号"]')?.getAttribute("value")).toBe("TEST");
    expect(host.querySelector('[aria-label="第3行型号"]')).toBeNull(); expect(dirty.mock.calls.at(-1)?.[0]).toBe(true);
    expect(runtime.save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    await click("保存草稿"); expect(runtime.save).toHaveBeenCalledOnce();
    const input = runtime.save.mock.calls[0][0]; expect(input.intent).toBe("draft"); expect(input.data.items.map((item: any) => item.qty)).toEqual([2, 3]);
    expect(JSON.stringify(input)).not.toContain("13800000000"); expect(input.data.items[0]).not.toHaveProperty("_localKey"); expect(input.data.items[0]).not.toHaveProperty("id");
  });
  it("appends after existing/locked material IDs without changing or merging them", async () => {
    setDetail(detail({ lockedItemIds: [401] })); render({ demandId: 41 });
    expect(host.querySelector<HTMLInputElement>('[aria-label="第1行型号"]')?.disabled).toBe(true);
    await importPreview([["型号", "数量"], ["EXISTING", 3]]); await click("确认追加 1 行"); await click("保存草稿");
    expect(runtime.save.mock.calls[0][0].data.items).toEqual([{ ...emptyCustomerDemandItem(), id: 401, partNumber: "EXISTING", qty: 1 }, { ...emptyCustomerDemandItem(), partNumber: "EXISTING", qty: 3 }]);
  });
  it("does not overwrite a partially filled local manual row", async () => {
    render(); change("第1行品牌", "手工品牌"); await importPreview([["型号", "数量"], ["IMPORTED", 5]]); await click("确认追加 1 行");
    expect(host.querySelector<HTMLInputElement>('[aria-label="第1行品牌"]')?.value).toBe("手工品牌"); expect(host.querySelector<HTMLInputElement>('[aria-label="第2行型号"]')?.value).toBe("IMPORTED");
  });
  it("submitted-demand imports still require explicit change reason and preserve version/source IDs", async () => {
    setDetail(detail({ status: "submitted" })); render({ demandId: 41 });
    await importPreview([["型号", "数量"], ["NEW", 2]]); await click("确认追加 1 行");
    expect(runtime.save).not.toHaveBeenCalled(); await click("保存变更"); expect(runtime.save).not.toHaveBeenCalled();
    const reason = host.querySelector<HTMLInputElement>("#demand-change-reason")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "客户追加BOM"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("保存变更");
    expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({ id: 41, version: 3, intent: "update", changeReason: "客户追加BOM", data: expect.objectContaining({ items: [expect.objectContaining({ id: 401 }), { ...emptyCustomerDemandItem(), partNumber: "NEW", qty: 2 }] }) }));
  });
  it("allows incomplete draft rows explicitly, still rejects zero quantity and requires completion for submission", async () => {
    render(); await importPreview([["型号", "数量", "品牌"], ["", "", "TEST"]]);
    expect(button("确认追加 1 行").disabled).toBe(true); await toggle("允许导入不完整草稿行");
    change("BOM第2行数量", "0"); expect(button("确认追加 1 行").disabled).toBe(true);
    change("BOM第2行数量", ""); await click("确认追加 1 行"); await click("提交采购"); expect(runtime.save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("请输入型号"); await click("保存草稿"); expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({ intent: "draft", data: expect.objectContaining({ items: [expect.objectContaining({ partNumber: "", qty: null, brand: "TEST" })] }) }));
  });
  it("filters invalid rows only on an explicit valid-row selection", async () => {
    render(); await importPreview([["型号", "数量"], ["GOOD", 1], ["BAD", -1]]); await click("仅选择有效行");
    expect(host.textContent).toContain("已选 1 行"); await click("确认追加 1 行"); expect(host.querySelector<HTMLInputElement>('[aria-label="第1行型号"]')?.value).toBe("GOOD");
  });
  it("supports nonstandard manual mapping but rejects reusing a source column", async () => {
    render(); await click("导入BOM"); await upload(file([["客户编码", "申请量", "电话"], ["CUSTOM", 4, "13800000000"]]));
    expect(button("生成预览").disabled).toBe(true); change("BOM映射型号", "0"); change("BOM映射数量", "0");
    expect(host.textContent).toContain("同一来源列不能映射"); change("BOM映射数量", "1"); await click("生成预览"); await click("确认追加 1 行");
    expect(host.querySelector<HTMLInputElement>('[aria-label="第1行型号"]')?.value).toBe("CUSTOM"); expect(host.querySelector<HTMLInputElement>('[aria-label="第1行备注"]')?.value).toBe("");
  });
  it("auto-detects a header after a title and supports choosing a different worksheet", async () => {
    render(); await click("导入BOM"); await upload(file([["测试标题"], ["料号", "Qty"], ["SHEET-1", 2]], [["型号", "数量"], ["SHEET-2", 3]]));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="BOM表头行"]')?.value).toBe("1");
    change("BOM工作表", "另一表"); await act(async () => { await Promise.resolve(); }); await click("生成预览"); await click("确认追加 1 行");
    expect(host.querySelector<HTMLInputElement>('[aria-label="第1行型号"]')?.value).toBe("SHEET-2");
  });
  it("asks before resetting corrected previews on mapping changes or replacement files", async () => {
    render(); await importPreview([["型号", "数量", "品牌"], ["TEST", 1, "BRAND"]]); change("BOM第2行型号", "CORRECTED");
    change("BOM映射品牌", ""); expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("放弃当前 BOM 预览"); await click("取消确认");
    expect(host.querySelector<HTMLInputElement>('[aria-label="BOM第2行型号"]')?.value).toBe("CORRECTED");
    await upload(file([["型号", "数量"], ["REPLACED", 2]])); await click("放弃预览"); await act(async () => { await Promise.resolve(); }); await click("生成预览");
    expect(host.querySelector<HTMLInputElement>('[aria-label="BOM第2行型号"]')?.value).toBe("REPLACED");
  });
  it("enforces remaining capacity and allows choosing only rows that fit", async () => {
    setDetail(detail({ items: Array.from({ length: 99 }, (_, index) => ({ ...emptyCustomerDemandItem(), id: index + 1, partNumber: `EX-${index}`, qty: 1 })) })); render({ demandId: 41 });
    await importPreview([["型号", "数量"], ["NEW-1", 1], ["NEW-2", 2]]);
    expect(host.textContent).toContain("超过剩余 1 行"); expect(button("确认追加 2 行").disabled).toBe(true);
    await toggle("选择BOM第3行"); await click("确认追加 1 行"); expect(host.querySelector('[aria-label="第100行型号"]')).not.toBeNull(); expect(button("导入BOM").disabled).toBe(true);
  });
  it("paginates preview rows while preserving edits and selection across pages", async () => {
    render(); await importPreview([["型号", "数量"], ...Array.from({ length: 26 }, (_, index) => [`S-${index}`, 1])]);
    expect(host.querySelector('[aria-label="BOM第27行型号"]')).toBeNull(); await click("下一页"); change("BOM第27行数量", "2"); await toggle("选择BOM第27行");
    await click("上一页"); expect(host.textContent).toContain("已选 25 行"); await click("下一页"); expect(host.querySelector<HTMLInputElement>('[aria-label="BOM第27行数量"]')?.value).toBe("2");
    await click("确认追加 25 行"); expect(host.querySelector('[aria-label="第26行型号"]')).toBeNull();
  });
  it("routes imported form data through existing dirty/discard and beforeunload guards", async () => {
    const dirty = vi.fn(), close = vi.fn(); render({ onDirtyChange: dirty, onClose: close }); await click("导入BOM");
    expect(dirty.mock.calls.at(-1)?.[0]).toBe(true); const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(button("保存草稿").disabled).toBe(true); await click("取消导入"); expect(dirty.mock.calls.at(-1)?.[0]).toBe(false);
    await importPreview([["型号", "数量"], ["TEST", 1]]); await click("确认追加 1 行"); await click("取消"); expect(close).not.toHaveBeenCalled(); await click("放弃并关闭"); expect(close).toHaveBeenCalledOnce();
  });
  it.each(["view", "readonly", "archived", "orders", "full", "quotePending", "failed", "firstRead"])("fails closed for %s and keeps locked/readonly materials unchanged", async restriction => {
    const props: Partial<CustomerDemandDialogProps> = { demandId: 41 };
    if (restriction === "view") props.mode = "view";
    if (restriction === "readonly") props.readOnly = true;
    if (restriction === "archived") props.customer = { ...customer, archivedAt: "2026-11-01" };
    if (restriction === "orders") setDetail(detail({ hasActiveOrders: true, lockedItemIds: [401] }));
    if (restriction === "full") setDetail(detail({ items: Array.from({ length: 100 }, (_, index) => ({ ...emptyCustomerDemandItem(), id: index + 1, partNumber: "TEST", qty: 1 })) }));
    if (restriction === "quotePending") runtime.quotePending = true;
    if (restriction === "failed") setDetail(detail(), { error: { message: "FORBIDDEN" } });
    if (restriction === "firstRead") setDetail(detail(), { isFetchedAfterMount: false });
    render(props); const entry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "导入BOM"); expect(!entry || entry.disabled).toBe(true);
    if (entry) await click("导入BOM"); expect(host.querySelector('[aria-label="选择客户需求BOM文件"]')).toBeNull(); expect(runtime.save).not.toHaveBeenCalled();
  });
  it("locks import after an uncertain save until the existing replay completes", async () => {
    runtime.save.mockRejectedValueOnce(new Error("timeout")); render(); change("第1行型号", "TEST"); await click("保存草稿");
    expect(host.textContent).toContain("保存结果尚未确认"); expect(button("导入BOM").disabled).toBe(true); await click("导入BOM"); expect(host.querySelector('[aria-label="选择客户需求BOM文件"]')).toBeNull();
  });
  it("rejects extension/size before reading bytes and displays corrupt workbook errors without mutation", async () => {
    render(); await click("导入BOM"); const badExtension = new File(["x"], "bad.csv"); const read = vi.fn(); Object.defineProperty(badExtension, "arrayBuffer", { value: read });
    await upload(badExtension); expect(host.textContent).toContain("仅支持 .xlsx 或 .xls"); expect(read).not.toHaveBeenCalled();
    const huge = new File(["x"], "big.xlsx"); Object.defineProperty(huge, "size", { value: 5 * 1024 * 1024 + 1 }); Object.defineProperty(huge, "arrayBuffer", { value: read });
    await upload(huge); expect(host.textContent).toContain("5MB"); expect(read).not.toHaveBeenCalled();
    const corrupt = new File(["renamed CSV"], "bad.xlsx"); Object.defineProperty(corrupt, "arrayBuffer", { value: async () => new TextEncoder().encode("renamed CSV").buffer }); await upload(corrupt);
    expect(host.textContent).toContain("不是有效的"); expect(runtime.save).not.toHaveBeenCalled();
  });
});

describe("BOM异步读取回执与身份/权限切换", () => {
  it("ignores a rejected old read after cancellation while a new BOM remains active", async () => {
    let fail!: (error: Error) => void;
    const old = file([["型号", "数量"], ["OLD", 1]]);
    Object.defineProperty(old, "arrayBuffer", { configurable: true, value: () => new Promise((_resolve, reject) => { fail = reject; }) });
    render(); await click("导入BOM"); await upload(old); await click("取消导入"); await click("放弃预览");
    await importPreview([["型号", "数量"], ["FRESH", 2]]);
    const before = host.textContent;
    await act(async () => fail(new Error("旧文件错误不得显示")));
    expect(host.textContent).toBe(before); expect(host.textContent).not.toContain("旧文件错误不得显示");
    await click("确认追加 1 行"); expect(host.querySelector<HTMLInputElement>('[aria-label="第1行型号"]')?.value).toBe("FRESH");
  });
  it.each(["close", "unmount", "customer", "actor", "context", "demand", "readOnly", "archive", "permissionABA", "readFailureABA", "orders", "quotePending"])("ignores old file completion after %s, never updates a new dialog or emits a toast", async transition => {
    let finish!: (bytes: ArrayBuffer) => void;
    const old = file([["型号", "数量"], ["OLD-MATERIAL", 1]]);
    Object.defineProperty(old, "arrayBuffer", { configurable: true, value: () => new Promise(resolve => { finish = resolve; }) });
    const props: Partial<CustomerDemandDialogProps> = { demandId: 41, contextIdentityKey: "permission:1", onDirtyChange: vi.fn() };
    render(props); await click("导入BOM"); await upload(old); expect(host.textContent).toContain("正在解析 BOM");
    if (transition === "close") { await click("取消导入"); await click("放弃预览"); }
    if (transition === "unmount") act(() => root.render(null));
    if (transition === "customer") { setDetail(detail({ customerId: 13 })); render({ ...props, customer: { id: 13, name: "另一客户" } }); }
    if (transition === "actor") { runtime.identity = "actor:8:enterprise:32"; render(props); }
    if (transition === "context") render({ ...props, contextIdentityKey: "permission:2" });
    if (transition === "demand") { setDetail(detail({ id: 42, demandNo: "XQ-42" })); render({ ...props, demandId: 42 }); }
    if (transition === "readOnly") render({ ...props, readOnly: true });
    if (transition === "archive") render({ ...props, customer: { ...customer, archivedAt: "2026-11-01" } });
    if (transition === "permissionABA") { setDetail(detail({ canEdit: false })); render(props); setDetail(detail()); render(props); }
    if (transition === "readFailureABA") { setDetail(detail(), { error: { message: "FORBIDDEN" } }); render(props); setDetail(detail()); render(props); }
    if (transition === "orders") { setDetail(detail({ hasActiveOrders: true })); render(props); }
    if (transition === "quotePending") { runtime.quotePending = true; render(props); runtime.quotePending = false; render(props); }
    runtime.toast.success.mockClear(); runtime.toast.error.mockClear(); runtime.toast.warning.mockClear();
    const before = host.textContent;
    await act(async () => finish(workbookBytes([["型号", "数量"], ["OLD-MATERIAL", 1]])));
    expect(host.textContent).toBe(before); expect(host.textContent).not.toContain("OLD-MATERIAL"); expect(runtime.save).not.toHaveBeenCalled(); expect(runtime.toast.success).not.toHaveBeenCalled(); expect(runtime.toast.error).not.toHaveBeenCalled();
    if (!["unmount", "readOnly", "archive", "orders"].includes(transition)) {
      await click("导入BOM"); await upload(file([["型号", "数量"], ["FRESH-MATERIAL", 2]])); await click("生成预览"); await click("确认追加 1 行");
      expect(host.querySelector<HTMLInputElement>('[aria-label="第2行型号"]')?.value).toBe("FRESH-MATERIAL");
    }
  });
});
