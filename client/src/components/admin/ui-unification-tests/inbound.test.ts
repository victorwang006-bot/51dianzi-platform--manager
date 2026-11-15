// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  listQuery: vi.fn(),
  navigate: vi.fn(),
  refetch: vi.fn(),
  preview: vi.fn(),
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  buyers: { data: undefined as unknown, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() },
  buyerQuery: vi.fn(),
  actorId: 7002,
  inventoryScopeAvailable: undefined as boolean | undefined,
  inventoryValue: "300.00",
}));

vi.mock("@/business/BusinessContentFrame", () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement("div", { className: "business-native-content" }, children),
}));
vi.mock("@/business/platform/client/src/components/inbound/BulkInboundForm", () => ({
  BulkInboundForm: () => createElement("div", { "data-testid": "bulk-form" }),
}));
vi.mock("@/business/BusinessScope", () => ({ useBusinessScope: () => ({ frontUser: { id: fixture.actorId } }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/inbound", fixture.navigate] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/business/api/business-trpc", () => {
  const utils = { inbound: {
    overview: { invalidate: vi.fn() },
    photos: { fetch: vi.fn(async () => []) },
    cancelPreview: { fetch: fixture.preview },
    suggestPartNumbers: { cancel: vi.fn() },
  } };
  const inbound = new Proxy({
    list: { useQuery: (input: unknown) => { fixture.listQuery(input); return { data: fixture.rows, isLoading: false, refetch: fixture.refetch }; } },
    overview: { useQuery: () => ({ data: { totalPaidAmount: "120.00", totalInventoryValue: fixture.inventoryValue, totalInventoryValueComplete: true, inventoryScopeAvailable: fixture.inventoryScopeAvailable, inTransitPaidAmount: "20.00", receivedPaidAmount: "100.00", cancelledPaidAmount: "0.00", untrackedCount: 0 } }) },
    procurementBuyers: { useQuery: (_input: unknown, options: unknown) => { fixture.buyerQuery(options); return fixture.buyers; } },
    photos: { useQuery: () => ({ data: [], isFetching: false }) },
    paymentHistory: { useQuery: () => ({ data: undefined, isFetching: false, refetch: fixture.refetch }) },
    suggestPartNumbers: { useQuery: () => ({ data: [], isFetching: false }) },
  }, {
    get(target, name: string) {
      if (name in target) return target[name as keyof typeof target];
      fixture.mutations[name] ??= vi.fn();
      return { useMutation: () => ({ isPending: false, mutate: fixture.mutations[name], mutateAsync: fixture.mutations[name] }) };
    },
  });
  return { trpc: { useUtils: () => utils, inbound, company: { get: { useQuery: () => ({ data: null }) } } } };
});

import InboundManagement from "@/business/platform/client/src/pages/InboundManagement";

let root: Root;
let host: HTMLDivElement;
const sourcePath = "client/src/business/platform/client/src/pages/InboundManagement";
const source = readFileSync(`${sourcePath}.tsx`, "utf8");
const css = readFileSync(`${sourcePath}.css`, "utf8");

function row(id: number, status = "in_transit") {
  return {
    id, slipNo: `RK-${id}`, partNumber: `STM32-${id}`, brand: "ST", qty: 50,
    actualQty: status === "received" ? 45 : null, prodYear: "2026", unitCost: "2.26",
    unitCostBasis: "CNY_TAX_INCLUDED", taxRate: "13", unitCostTaxIncluded: "2.26", unitCostTaxExcluded: "2.00",
    supplierName: "真实供应商", supplierContact: "联系人", supplierPhone: "13800000000", status,
    inboundDate: "2026-11-03", actualInboundDate: status === "received" ? "2026-11-03" : null,
    operator: "采购员甲", location: "A-01", warehouseAddress: "仓库地址", procurementRegion: "采购地区",
    paymentTracked: true, paymentCategory: "unpaid", payableAmount: "113.00", paidAmount: "0.00", outstandingAmount: "113.00", paymentPercentage: 0,
    photos: [], note: "原业务备注", bulkBatchId: null,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  fixture.actorId = 7002;
  fixture.inventoryScopeAvailable = undefined;
  fixture.inventoryValue = "300.00";
  fixture.buyers = { data: { actorUserId: 7002, canChooseBuyer: false, teamId: 9, scope: "self", options: [{ userId: 7002, name: "采购员甲", username: "buyer-a" }, { userId: 7003, name: "采购员乙", username: "buyer-b" }] }, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() };
  fixture.rows = [row(1), row(2, "received"), row(3, "cancelled")];
  fixture.preview.mockResolvedValue({ count: 2, ignoredCount: 0, paidCount: 0, paidAmount: "0.00", paymentFingerprint: "original-payment-fingerprint", rows: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount() { await act(async () => root.render(createElement(InboundManagement))); }
function button(text: string, scope: ParentNode = host) {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function field(label: string, scope: ParentNode = host) {
  const wrapper = Array.from(scope.querySelectorAll<HTMLElement>(".inbound-field")).find(node => node.querySelector("label")?.textContent?.replace("*", "").trim() === label);
  const input = wrapper?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`Missing input field: ${label}`);
  return input;
}
async function menu(id: number) {
  await click(host.querySelector<HTMLButtonElement>(`button[aria-label="操作 RK-${id}"]`)!);
  return host.querySelector<HTMLElement>('[role="menu"]')!;
}
function lastQuery() { return fixture.listQuery.mock.calls.at(-1)?.[0]; }

describe("inbound unified presentation and business regression", () => {
  it("does not present unavailable procurement-scope inventory as a zero or global valuation", async () => {
    fixture.inventoryScopeAvailable = false;
    fixture.inventoryValue = "0.00";
    await mount();
    const card = host.querySelector<HTMLButtonElement>('button[title="当前采购范围不提供库存估值"]');
    expect(card?.querySelector("strong")?.textContent).toBe("—");
    expect(card?.textContent).not.toContain("¥");
    expect(button("已付款项¥120.00")).toBeTruthy();
  });

  it("distinguishes an available real zero inventory valuation from an unavailable placeholder", async () => {
    fixture.inventoryScopeAvailable = true;
    fixture.inventoryValue = "0.00";
    await mount();
    const card = host.querySelector<HTMLButtonElement>('button[title="查看当前可用库存"]');
    expect(card?.querySelector("strong")?.textContent).toBe("¥0.00");
    expect(card?.querySelector("strong")?.textContent).not.toBe("—");
  });

  it("uses the shared compact header, filter and data panel without dropping list columns or real quantities", async () => {
    await mount();
    expect(host.querySelector("section.aui-page.inbound-management-page")).not.toBeNull();
    expect(host.querySelector(".aui-page-header h1")?.textContent).toBe("采购入库");
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector(".aui-filterbar.inbound-toolbar")).not.toBeNull();
    expect(host.querySelector(".aui-data-panel .inbound-list-table")).not.toBeNull();
    expect(Array.from(host.querySelectorAll("thead th")).map(node => node.textContent)).toEqual(["入库单 / 日期", "料号 / 品牌", "数量 / DC", "货物状态", "付款情况", "供应商", "采购员 / 仓位", "操作"]);
    const received = host.querySelector('tr[aria-label="查看入库单 RK-2"]')!;
    expect(received.querySelector(".inbound-numeric")?.textContent).toContain("45");
    expect(received.querySelector(".inbound-actions button")?.getAttribute("aria-label")).toBe("操作 RK-2");
  });

  it("keeps draft filters staged, including collapsed advanced fields, and resets the same query", async () => {
    await mount();
    await fill(host.querySelector('input[placeholder="搜索料号"]')!, "STM32");
    await click(button("更多筛选"));
    await fill(host.querySelector('input[placeholder="采购员"]')!, "采购员甲");
    await fill(host.querySelector('input[placeholder="入库单号"]')!, "RK-1");
    await fill(host.querySelector('input[aria-label="开始日期"]')!, "2026-11-01");
    await fill(host.querySelector('input[aria-label="结束日期"]')!, "2026-11-03");
    expect(lastQuery()).toBeUndefined();
    await click(button("更多筛选 · 已选"));
    expect(host.querySelector('[data-testid="inbound-advanced-filters"]')).toBeNull();
    await click(button("筛选"));
    expect(lastQuery()).toEqual({ partNumber: "STM32", operator: "采购员甲", slipNo: "RK-1", dateFrom: "2026-11-01", dateTo: "2026-11-03" });
    await click(button("重置"));
    expect(lastQuery()).toBeUndefined();
    expect((host.querySelector('input[placeholder="搜索料号"]') as HTMLInputElement).value).toBe("");
    expect(button("重置").disabled).toBe(true);
  });

  it("retains ten-row pagination and returns to page one when filters are applied", async () => {
    fixture.rows = Array.from({ length: 12 }, (_, index) => row(index + 1));
    await mount();
    expect(host.querySelectorAll(".inbound-list-table tbody tr")).toHaveLength(10);
    expect(button("上一页").disabled).toBe(true);
    await click(button("下一页"));
    expect(host.querySelectorAll(".inbound-list-table tbody tr")).toHaveLength(2);
    expect(host.textContent).toContain("第 2 / 2 页");
    expect(button("下一页").disabled).toBe(true);
    await fill(host.querySelector('input[placeholder="搜索料号"]')!, "STM32");
    await act(async () => host.querySelector('input[placeholder="搜索料号"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(lastQuery()).toEqual({ partNumber: "STM32" });
    expect(host.textContent).toContain("第 1 / 2 页");
  });

  it("keeps cancelled rows unselectable and previews only eligible selected ids", async () => {
    await mount();
    await click(button("批量操作"));
    expect(host.querySelector('button[aria-label="选择 RK-3"]')?.hasAttribute("disabled")).toBe(true);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="选择本页全部未作废单"]')!);
    expect(host.querySelector('button[aria-label="选择 RK-1"]')?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('button[aria-label="选择 RK-2"]')?.getAttribute("aria-checked")).toBe("true");
    await click(button("批量作废"));
    expect(fixture.preview).toHaveBeenCalledWith({ ids: [1, 2] });
    const dialog = host.querySelector('[role="dialog"][aria-label="批量作废"]')!;
    expect(dialog.textContent).toContain("将冲销库存；有后续变动时整批不作废。");
    expect(button("确认作废", dialog).disabled).toBe(true);
    expect(fixture.mutations.cancelMany).not.toHaveBeenCalled();
  });

  it("preserves status-specific row actions and the real inventory navigation target", async () => {
    await mount();
    let popup = await menu(1);
    expect(popup.textContent).toContain("确认入库");
    expect(popup.textContent).toContain("编辑");
    expect(popup.textContent).not.toContain("打印验收单");
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="关闭操作菜单"]')!);
    popup = await menu(2);
    expect(popup.textContent).toContain("打印验收单");
    expect(popup.textContent).not.toContain("确认入库");
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="关闭操作菜单"]')!);
    popup = await menu(3);
    expect(Array.from(popup.querySelectorAll("button")).map(node => node.textContent)).toEqual(["查看详情", "付款记录"]);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="关闭操作菜单"]')!);
    await click(host.querySelector<HTMLButtonElement>('button[title="查看当前可用库存"]')!);
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.navigate).toHaveBeenCalledWith("/inventory");
  });

  it("preserves receive validation, request identity and stock quantity payload", async () => {
    fixture.rows[0].location = "";
    await mount();
    await click(button("确认入库", await menu(1)));
    const dialog = host.querySelector('[role="dialog"][aria-label="确认入库"]')!;
    expect(dialog.classList.contains("inbound-modal")).toBe(true);
    await click(button("确认入库", dialog));
    expect(fixture.mutations.receive).not.toHaveBeenCalled();
    await fill(field("入库数量", dialog), "48");
    await fill(field("仓位", dialog), " B-02 ");
    await click(button("确认入库", dialog));
    expect(fixture.mutations.receive).toHaveBeenCalledWith({ id: 1, actualQty: 48, actualInboundDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), location: "B-02", clientRequestId: expect.any(String) });
    expect(fixture.mutations.create).not.toHaveBeenCalled();
  });

  it("keeps the single-entry create payload and unpaid default unchanged", async () => {
    await mount();
    await click(button("新建采购入库"));
    const dialog = host.querySelector('[role="dialog"][aria-label="新建采购入库单"]')!;
    await click(button("保存为在途", dialog));
    expect(fixture.mutations.create).not.toHaveBeenCalled();
    await fill(dialog.querySelector<HTMLInputElement>("#inbound-part-number")!, "stm32f103");
    await fill(field("计划到货数量", dialog), "50");
    await fill(field("供应商名称", dialog), " 原供应商 ");
    expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!.value).toBe("7002");
    expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!.disabled).toBe(true);
    await click(button("保存为在途", dialog));
    expect(fixture.mutations.create).toHaveBeenCalledWith(expect.objectContaining({
      partNumber: "STM32F103", qty: 50, status: "in_transit", supplierName: "原供应商", operator: "采购员甲", buyerUserId: 7002,
      clientRequestId: expect.any(String), payment: { mode: "unpaid", amount: undefined, paymentDate: undefined, note: undefined },
    }));
  });

  it("retains detail fields and immutable received-stock restrictions", async () => {
    await mount();
    const received = host.querySelector<HTMLElement>('tr[aria-label="查看入库单 RK-2"]')!;
    await act(async () => received.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const dialog = host.querySelector('[role="dialog"][aria-label="入库单详情"]')!;
    for (const label of ["计划数量", "入库数量", "录入单价", "含税金额", "税额", "已付金额", "待付金额", "仓库地址", "采购地区", "供应商联系人", "备注"]) expect(dialog.textContent).toContain(label);
    expect(dialog.querySelectorAll(".inbound-numeric").length).toBeGreaterThan(5);
    await click(button("关闭", dialog));
    await click(button("编辑", await menu(2)));
    const edit = host.querySelector('[role="dialog"][aria-label="编辑入库单"]')!;
    expect(edit.textContent).toContain("料号、数量、日期及成本已进入库存台账，不能直接修改。");
    expect(edit.querySelector<HTMLInputElement>("#inbound-part-number")!.disabled).toBe(true);
    expect(field("入库数量", edit).disabled).toBe(true);
    expect(field("供应商名称", edit).disabled).toBe(false);
    expect(field("采购员", edit).disabled).toBe(true);
  });

  it("scopes legacy size fixes to this page without scaling, important rules, or interaction overrides", () => {
    const stylesheet = postcss.parse(css);
    stylesheet.walkRules(rule => {
      for (const selector of rule.selectors) expect(selector).toContain(".aui-page.erp-ui.inbound-management-page");
      rule.walkDecls(decl => {
        expect(decl.important).toBeFalsy();
        expect(decl.prop).not.toMatch(/^(zoom|transform|scale|pointer-events|opacity)$/);
      });
    });
    expect(css).toContain("height: var(--admin-content-control-height, 32px);");
    expect(css).toContain("font-size: var(--admin-content-font-body, 12px);");
    expect(css).toContain("font-size: var(--admin-content-font-caption, 11px);");
    expect(css).toContain("text-align: right;");
    expect(source).toContain('onDirtyChange={setBulkDirty} onBusyChange={setBulkBusy}');
    expect(source).toContain('if (!editingRow && bulkDirty) { setConfirmBulkClose(true); return; }');
    expect(source).toContain('paymentFingerprint: batchCancelPreview.paymentFingerprint');
  });
});

async function chooseBuyer(value: string) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function fillNewInbound() {
  await fill(host.querySelector<HTMLInputElement>("#inbound-part-number")!, "stm32");
  await fill(field("计划到货数量"), "50");
  await fill(field("供应商名称"), "供应商甲");
}

describe("single procurement buyer authorization and immutable history", () => {
  it("leader defaults actor then can select only API options, submitting numeric front ID", async () => {
    (fixture.buyers.data as any).canChooseBuyer = true;
    await mount(); await click(button("新建采购入库")); await fillNewInbound();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!;
    expect(select.disabled).toBe(false); expect(select.value).toBe("7002"); expect(select.textContent).toContain("采购员乙（buyer-b）");
    await chooseBuyer("7003"); await click(button("保存为在途"));
    expect(fixture.mutations.create).toHaveBeenCalledWith(expect.objectContaining({ buyerUserId: 7003, operator: "采购员乙" }));
  });
  it("candidate read error or front actor mismatch refuses creation without free text fallback", async () => {
    fixture.buyers.isError = true;
    await mount(); await click(button("新建采购入库")); await fillNewInbound();
    expect(host.querySelector('input[aria-label="采购员"]')).toBeNull(); expect(button("保存为在途").disabled).toBe(true); expect(host.textContent).toContain("采购员候选读取失败");
    fixture.buyers.isError = false; fixture.actorId = 6001; await mount();
    expect(button("保存为在途").disabled).toBe(true); expect(fixture.mutations.create).not.toHaveBeenCalled();
  });
  it("candidate or permission change invalidates prior selection and never silently picks actor", async () => {
    (fixture.buyers.data as any).canChooseBuyer = true;
    await mount(); await click(button("新建采购入库")); await fillNewInbound(); await chooseBuyer("7003");
    fixture.buyers.data = { ...(fixture.buyers.data as any), options: [{ userId: 7002, name: "采购员甲", username: "buyer-a" }] };
    await mount(); expect(button("保存为在途").disabled).toBe(true); expect(host.querySelector<HTMLSelectElement>('select[aria-label="采购员"]')!.value).toBe("");
    expect(fixture.mutations.create).not.toHaveBeenCalled();
  });
  it("known created buyer ID and original name are preserved even when absent from candidates", async () => {
    fixture.rows = [{ ...row(1), buyerUserId: 7999, operator: "历史采购员" }];
    await mount(); await click(button("编辑", await menu(1)));
    expect(field("采购员").value).toBe("历史采购员"); expect(field("采购员").disabled).toBe(true);
    expect(fixture.buyerQuery.mock.calls.every(([options]) => !options.enabled)).toBe(true);
    await click(button("保存修改"));
    expect(fixture.mutations.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ buyerUserId: 7999, operator: "历史采购员" }) }));
  });
  it("legacy unbound received row keeps exact operator without guessing a candidate ID", async () => {
    fixture.rows = [{ ...row(2, "received"), operator: "采购员甲" }];
    fixture.buyers.data = { ...(fixture.buyers.data as any), options: [{ userId: 7002, name: "新的可信姓名" }] };
    await mount(); await click(button("编辑", await menu(2))); await click(button("保存修改"));
    const payload = fixture.mutations.updateDetails.mock.calls.at(-1)![0];
    expect(payload.operator).toBe("采购员甲"); expect(payload).not.toHaveProperty("buyerUserId");
  });
});
