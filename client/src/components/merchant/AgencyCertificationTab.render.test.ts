// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ items: [] as any[], save: vi.fn(), review: vi.fn(), cancel: vi.fn(), document: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ merchant: { agencyCertifications: { invalidate: runtime.invalidate } } }),
  merchant: {
    agencyCertifications: { useQuery: () => ({ data: { items: runtime.items }, isLoading: false, error: null, refetch: vi.fn() }) },
    saveAgencyCertification: { useMutation: () => ({ mutateAsync: runtime.save, isPending: false }) },
    reviewAgencyCertification: { useMutation: () => ({ mutateAsync: runtime.review, isPending: false }) },
    cancelAgencyCertification: { useMutation: () => ({ mutateAsync: runtime.cancel, isPending: false }) },
    agencyCertificationDocument: { useMutation: () => ({ mutateAsync: runtime.document, isPending: false }) },
  },
} }));
vi.mock("sonner", () => ({ toast: { success: runtime.success, error: runtime.error } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? React.createElement("section", { "data-dialog": true }, children) : null,
  useDialogComposition: () => ({ justEndedComposing: () => false, setComposing: vi.fn(), markCompositionEnd: vi.fn() }),
  ...Object.fromEntries(["DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, ({ children }: any) => React.createElement("div", null, children)])),
}));
import AgencyCertificationTab, { agencyCertificationStatusLabel, effectiveAgencyCertificationItems } from "./AgencyCertificationTab";
(globalThis as any).React = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const item = { id: 81, revision: 3, brands: ["TI"], fileName: "proof.pdf", status: "pending" as const, updatedAt: "2026-11-01T00:00:00Z", validFrom: null, validUntil: null };
const render = async (merchantId = 31, canWrite = true, identityKey = String(merchantId)) => {
  await act(async () => { root.render(React.createElement(AgencyCertificationTab, { key: identityKey, merchantId, canWrite, identityKey })); });
};
function button(label: string) { const result = [...container.querySelectorAll("button")].find(button => button.textContent === label); if (!result) throw new Error(`缺少按钮 ${label}`); return result; }
async function click(label: string) { await act(async () => { button(label).click(); }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); runtime.items = [item];
  runtime.save.mockResolvedValue({ success: true, id: 99 }); runtime.review.mockResolvedValue({ success: true, id: 81 }); runtime.cancel.mockResolvedValue({ success: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe("代理认证React隔离mock", () => {
  it("read用户看状态/原因但无原件、审核或人工认定按钮", async () => {
    runtime.items = [item, { ...item, id: 82, status: "rejected", reviewReason: "授权不符" }, { ...item, id: 83, status: "cancelled" }];
    await render(31, false);
    expect(container.textContent).toContain("待审核"); expect(container.textContent).toContain("已驳回"); expect(container.textContent).toContain("驳回原因：授权不符"); expect(container.textContent).toContain("已撤销");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(runtime.document).not.toHaveBeenCalled();
  });
  it("申请单独审核：驳回空白不能确认，通过绑定冻结revision和requestId", async () => {
    await render(); await click("审核申请"); await click("驳回");
    expect(button("确认驳回").disabled).toBe(true);
    expect(runtime.review).not.toHaveBeenCalled();
    await click("通过"); await click("确认通过");
    expect(runtime.review).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 31, id: 81, expectedRevision: 3, decision: "approve", reviewReason: "", requestId: expect.any(String) }));
    expect(runtime.save).not.toHaveBeenCalled();
  });
  it("驳回理由实际输入后方可提交，并携带trim后的reason而非修改manual认定", async () => {
    await render(); await click("审核申请"); await click("驳回");
    const textarea = container.querySelector<HTMLTextAreaElement>("#agency-review-reason")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "  授权范围不符  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("确认驳回").disabled).toBe(false);
    await click("确认驳回");
    expect(runtime.review).toHaveBeenCalledWith(expect.objectContaining({ decision: "reject", reviewReason: "授权范围不符", id: 81, expectedRevision: 3 }));
    expect(runtime.save).not.toHaveBeenCalled();
  });
  it("审核失败保留对话框并使用同一个requestId重试；记录刷新变更不可审批旧版本", async () => {
    runtime.review.mockRejectedValueOnce(new Error("暂时失败"));
    await render(); await click("审核申请"); await click("确认通过");
    expect(container.querySelector('[data-dialog]')).not.toBeNull();
    await click("确认通过");
    expect(runtime.review.mock.calls[0][0].requestId).toBe(runtime.review.mock.calls[1][0].requestId);
    await click("审核申请"); runtime.items = [{ ...item, revision: 4 }]; await render();
    expect(button("确认通过").disabled).toBe(true);
    expect(container.textContent).toContain("记录已变化");
  });
  it("manual编辑保留原件并接受平台新id，撤销确认不删除旧材料", async () => {
    runtime.items = [{ ...item, status: "active" }]; await render(); await click("编辑认定"); await click("人工认定并生效");
    expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 31, id: 81, expectedRevision: 3, file: undefined }));
    expect(runtime.success).toHaveBeenCalledWith("人工认定新版本已生效，旧记录保留");
    await click("撤销认证"); expect(runtime.cancel).not.toHaveBeenCalled(); await click("确认撤销");
    expect(runtime.cancel).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 31, id: 81, expectedRevision: 3 }));
  });
  it("旧审核响应晚回不得清空新商户页面、弹成功或刷新新商户", async () => {
    const late = deferred<any>(); runtime.review.mockReturnValue(late.promise);
    await render(); await click("审核申请"); await click("确认通过");
    runtime.items = [{ ...item, id: 91, brands: ["NXP"] }]; await render(32, true);
    await act(async () => late.resolve({ success: true, id: 81 }));
    expect(container.textContent).toContain("NXP"); expect(runtime.success).not.toHaveBeenCalled(); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it("原件获取过程中切merchant立即关预览，晚回URL绝不导航", async () => {
    const late = deferred<any>(); runtime.document.mockReturnValue(late.promise);
    const preview = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(preview as any);
    await render(); await click("查看原件");
    expect(preview.opener).toBeNull();
    await render(32, true);
    expect(preview.close).toHaveBeenCalled();
    await act(async () => late.resolve({ url: "https://private.invalid/old", expiresAt: Date.now() + 100000, fileName: "proof.pdf" }));
    expect(preview.location.replace).not.toHaveBeenCalled();
  });
  it("原件正常查看但关闭组件仍关闭已导航窗口，不长期存储URL", async () => {
    const preview = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(preview as any);
    runtime.document.mockResolvedValue({ url: "https://private.invalid/short" });
    await render(); await click("查看原件"); expect(preview.location.replace).toHaveBeenCalledWith("https://private.invalid/short");
    await render(32); expect(preview.close).toHaveBeenCalled();
  });
  it("待审/拒绝不替代旧通过，过期/撤销不回退旧版，多品牌部分替代准确", () => {
    const records = effectiveAgencyCertificationItems([
      { ...item, id: 70, brands: ["TI", "NXP"], status: "active" },
      { ...item, id: 71, status: "active", validUntil: "2026-11-09" },
      { ...item, id: 72, status: "pending" }, { ...item, id: 73, status: "rejected" },
    ], "2026-11-11");
    expect(records[0].effectiveBrands).toEqual(["NXP"]); expect(records[1].effectiveBrands).toEqual([]);
    expect(agencyCertificationStatusLabel(records[1], "2026-11-11")).toBe("已过期");
    expect(agencyCertificationStatusLabel({ ...item, status: "active", validFrom: "2026-11-12" }, "2026-11-11")).toBe("尚未生效");
    expect(agencyCertificationStatusLabel({ ...item, status: "active", validUntil: "2026-11-11" }, "2026-11-11")).toBe("已通过");
    const cancelled = effectiveAgencyCertificationItems([{ ...item, id: 70, status: "active" }, { ...item, id: 71, status: "cancelled" }], "2026-11-11");
    expect(agencyCertificationStatusLabel(cancelled[0], "2026-11-11")).toBe("已替代");
  });
});
