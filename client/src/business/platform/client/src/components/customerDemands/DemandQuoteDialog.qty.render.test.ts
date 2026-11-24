// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemandQuoteDialog } from "./DemandQuoteDialog";
(globalThis as any).React = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
  save: vi.fn(),
  detail: {
    id: 41,
    demandNo: "XQ20261124-0001",
    revision: 1,
    items: [
      { id: 501, partNumber: "KF101M063G125A", brand: "CapXon", pkg: "", qty: 240000, qtyUnit: "片" },
      { id: 502, partNumber: "RXW470M1JBK-0811", brand: "Lelon", pkg: "", qty: 90000, qtyUnit: "片" },
    ],
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("../ui/button", () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => h("button", props, children),
}));
vi.mock("../customers/ConfirmDialog", () => ({
  ConfirmDialog: ({ title, confirmLabel, onConfirm }: any) =>
    h("section", { role: "alertdialog" }, h("p", null, title), h("button", { onClick: onConfirm }, confirmLabel)),
}));
vi.mock("../../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => ({
      customerDemand: new Proxy({}, { get: () => ({ invalidate: vi.fn().mockResolvedValue(undefined) }) }),
    }),
    customerDemand: {
      procurementGet: { useQuery: () => ({ data: runtime.detail, isLoading: false }) },
      quoteList: { useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }) },
      quoteSave: { useMutation: () => ({ mutateAsync: runtime.save }) },
    },
  },
}));

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
function input(label: string) {
  const node = q<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing ${label}`);
  return node;
}
function type(label: string, value: string) {
  const node = label === "供应商名称" ? q<HTMLInputElement>("#quote-supplier")! : input(label);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function clickText(text: string) {
  const node = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  if (!node) throw new Error(`Missing button ${text}`);
  await act(async () => node.click());
}

beforeEach(() => {
  runtime.save.mockReset().mockResolvedValue({ id: 9, version: 1, replayed: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(h(DemandQuoteDialog, { demandId: 41, onClose: vi.fn() })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DemandQuoteDialog supplier quantity", () => {
  it("drops explanatory copy and shows the demand number beside the title", () => {
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("可选择部分物料报价");
    expect(text).not.toContain("勾选物料后可添加多个备选方案");
    expect(text).not.toContain("· V1 ·");
    expect(text).toContain("新增供应商报价");
    expect(text).toContain("XQ20261124-0001");
  });

  it("does not pre-fill the demand quantity; it is only a placeholder", async () => {
    await act(async () => input("选择第2行报价").click());
    const qty = input("第2行报价数量");
    expect(qty.value).toBe("");
    expect(qty.placeholder).toBe("需求 90000");
    expect(qty.disabled).toBe(false);
  });

  it("accepts a supplier quantity below demand with a non-blocking hint", async () => {
    await act(async () => input("选择第2行报价").click());
    type("第2行报价数量", "30000");
    type("第2行含税单价", "0.12");
    type("第2行交期", "现货");
    type("供应商名称", "合成供应商");
    expect(document.body.textContent).toContain("少于需求 60000 片");
    await clickText("提交报价");
    expect(runtime.save).toHaveBeenCalledOnce();
    const payload = runtime.save.mock.calls[0][0];
    expect(payload.items).toEqual([
      expect.objectContaining({ demandItemId: 502, qty: 30000, unitPrice: "0.12" }),
    ]);
  });

  it("requires the supplier quantity instead of silently using demand quantity", async () => {
    await act(async () => input("选择第2行报价").click());
    type("第2行含税单价", "0.12");
    await clickText("提交报价");
    expect(runtime.save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请填写供应商可供数量");
  });
});
