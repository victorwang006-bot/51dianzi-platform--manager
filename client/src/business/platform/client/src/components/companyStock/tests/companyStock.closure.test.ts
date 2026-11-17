// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  scope: "A",
  current: "A",
  actor: 7,
  principalActor: 7,
  verificationIdentity: "A",
  verified: true,
  authVersion: "v1",
  authenticated: true,
  authLoading: false,
  loginDisabled: false,
  principalStatus: "ready",
  reads: {} as Record<string, any>,
  inputs: [] as Array<{ name: string; input: any; enabled: boolean }>,
  mutations: {} as Record<
    string,
    { mutate: ReturnType<typeof vi.fn>; options: any; pending: boolean }
  >,
}));
vi.mock("../../../../../../BusinessScope", () => ({
  businessStorageScope: () => runtime.current,
  useBusinessScope: () => ({
    storageScope: runtime.scope,
    merchantId: 1,
    frontUser: { id: runtime.actor },
    staffPrincipal: {
      status: runtime.principalStatus,
      frontendUserId: runtime.principalActor,
    },
    contextVerification: {
      state: runtime.verified ? "verified" : "revalidating",
      identity: runtime.verificationIdentity,
      authorizationVersion: runtime.authVersion,
    },
  }),
}));
vi.mock("../../../../../../api/business-auth", () => ({
  useAuth: () => ({
    user: { id: runtime.actor, loginDisabled: runtime.loginDisabled },
    loading: runtime.authLoading,
    isAuthenticated: runtime.authenticated,
  }),
}));
vi.mock("../../../../../../api/business-trpc", () => {
  const query = (name: string) => ({
    useQuery: (input: any, options: any = {}) => {
      runtime.inputs.push({ name, input, enabled: options.enabled !== false });
      return {
        isSuccess: true,
        isFetching: false,
        isLoading: false,
        isError: false,
        isFetchedAfterMount: true,
        isPlaceholderData: false,
        refetch: vi.fn(),
        ...runtime.reads[name],
      };
    },
  });
  const mutation = (name: string) => ({
    useMutation: (options: any) => {
      runtime.mutations[name] ??= {
        mutate: vi.fn(),
        options: null,
        pending: false,
      };
      runtime.mutations[name].options = options;
      return {
        mutate: runtime.mutations[name].mutate,
        isPending: runtime.mutations[name].pending,
      };
    },
  });
  return {
    trpc: {
      crmSalesOrder: {
        companyStockCandidates: query("lots"),
        previewCompanyStock: query("preview"),
        createCompanyStock: mutation("create"),
        allocateCompanyStock: mutation("allocate"),
        shipCompanyStock: mutation("ship"),
        updateSalesExpenses: mutation("expenses"),
      },
      inbound: {
        companyStockReconciliationCandidates: query("reconciliation"),
        reconcileCompanyStock: mutation("reconcile"),
      },
      customer: { context: query("context"), list: query("customers") },
    },
  };
});
import { CompanyStockOrderForm } from "../CompanyStockOrderForm";
import { CompanyStockAllocationForm } from "../CompanyStockAllocationForm";
import { CompanyStockShipmentForm } from "../CompanyStockShipmentForm";
import { CompanyStockReconciliationForm } from "../CompanyStockReconciliationForm";
import { CompanyStockReconciliationAction } from "../CompanyStockReconciliationAction";
import { SalesExpensesEditor } from "../SalesExpensesEditor";
import { SalesProfitSummary } from "../SalesProfitSummary";
import { SalesCustomerPicker } from "../SalesCustomerPicker";
import {
  companyOrderItems,
  companyStockAllocationItems,
  expenseInput,
  serverMoney,
} from "../companyStockSales";

let root: Root;
let container: HTMLDivElement;
const saved = vi.fn(),
  dirty = vi.fn(),
  busy = vi.fn();
const callbacks = {
  enabled: true,
  onSaved: saved,
  onCreated: saved,
  onAllocated: saved,
  onCancel: vi.fn(),
  onDirtyChange: dirty,
  onBusyChange: busy,
};
const lot = (lotId: number, change: any = {}) => ({
  lotId,
  inboundOrderId: 500 + lotId,
  partNumber: "LM358",
  brand: "TI",
  pkg: "SOIC",
  dc: "24+",
  lotNumber: `L${lotId}`,
  location: "A-1",
  availableQty: 8,
  version: 1,
  ...change,
});
const order = (change: any = {}) => ({
  id: 11,
  customerId: 1,
  version: 7,
  status: "confirmed",
  sourceType: "company_stock",
  items: [
    {
      id: 31,
      partNumber: "LM358",
      brand: "TI",
      pkg: "SOIC",
      dc: "24+",
      orderedQty: 8,
      shippedQty: 0,
    },
  ],
  companyStockAllocations: [
    { orderId: 11, orderItemId: 31, lotId: 41, reservedQty: 4 },
    { orderId: 11, orderItemId: 31, lotId: 42, reservedQty: 4 },
  ],
  ...change,
});
const candidate = {
  id: 51,
  slipNo: "RK-51",
  partNumber: "LM358",
  brand: "TI",
  pkg: "SOIC",
  dc: "24+",
  lotNumber: "old",
  location: "A-1",
  currentQty: 900,
  assignedRemainingQty: 4,
  expectedMovementVersion: 7,
  hasProcurementOwnership: true,
  status: "pending_reconciliation" as const,
};
const profit = (change: any = {}) => ({
  status: "ready",
  salesTaxMode: "tax_included",
  salesAmount: "120.000000",
  costAmount: "80.000000",
  grossProfit: "40.000000",
  taxDeductionAmount: "5.200000",
  expenseAmount: "4.000000",
  netProfit: "30.800000",
  ...change,
});
const commission = (change: any = {}) => ({
  estimatedAmount: "4.62",
  earnedAmount: "0.00",
  configPending: false,
  collectionStatus: "partial",
  reason: null,
  ...change,
});
function render(component: React.ReactElement) {
  act(() => root.render(component));
  const picker = container.querySelector<HTMLButtonElement>(".company-lot-trigger");
  if (picker && !picker.disabled && picker.getAttribute("aria-expanded") === "false") click(picker);
}
function button(text: string) {
  const value = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(node => node.textContent?.trim() === text);
  if (!value) throw new Error(`Missing button ${text}`);
  return value;
}
function click(node: Element) {
  act(() =>
    node.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
  );
}
function fill(label: string, value: string) {
  const node = container.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(`[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing input ${label}`);
  act(() => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : node instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function fail(name: string, code = "INTERNAL_SERVER_ERROR") {
  act(() => {
    runtime.mutations[name].options.onError({
      message: "offline timeout",
      data: { code },
    });
    runtime.mutations[name].options.onSettled?.();
  });
}
function fillCreate() {
  render(
    React.createElement(CompanyStockOrderForm, {
      ...callbacks,
      customer: { id: 1, name: "客户甲" },
    })
  );
  click(container.querySelector('[data-company-lot="41"] button')!);
  click(container.querySelector('[data-company-lot="42"] button')!);
  fill("批次 41 销售数量", "3");
  fill("批次 41 销售单价", "12.3456");
  fill("批次 42 销售数量", "2");
  fill("批次 42 销售单价", "0.0001");
  fill("公司订单客户确认说明", "电话确认两个真实批次及交期");
  click(container.querySelector('input[type="checkbox"]')!);
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(runtime, {
    scope: "A",
    current: "A",
    actor: 7,
    principalActor: 7,
    verificationIdentity: "A",
    verified: true,
    authVersion: "v1",
    authenticated: true,
    authLoading: false,
    loginDisabled: false,
    principalStatus: "ready",
    inputs: [],
    mutations: {},
  });
  runtime.reads = {
    lots: { data: { items: [lot(41), lot(42)], total: 2 } },
    preview: {
      data: {
        totalAmount: "37.0370",
        currencyLabel: "人民币（含税）",
        profitBreakdown: profit(),
        commissionPreview: commission(),
      },
    },
    reconciliation: { data: [candidate] },
    context: { data: { actorUserId: 7, canManageAll: false, salesOrderPicker: { scope: "mine" } } },
    customers: { data: { items: [{ id: 1, name: "客户甲" }], total: 1 } },
  };
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No real network/DB permitted");
    })
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("company stock UI closure with genuine forms and offline transport", () => {
  it("new create submits multiple real lots with exact string unit prices and no fabricated demand/inventory fields", () => {
    fillCreate();
    expect(container.textContent).toContain("¥37.037");
    expect(container.querySelector('[aria-label="搜索型号"]')).not.toBeNull();
    expect(
      container.querySelector('[placeholder="型号、品牌、DC、仓位"]')
    ).toBeNull();
    expect(container.textContent).toContain("TI");
    expect(container.textContent).toContain("24+");
    expect(container.textContent).toContain("A-1");
    click(button("保存订单"));
    const payload = runtime.mutations.create.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      customerId: 1,
      salesTaxMode: "tax_included",
      customerConfirmed: true,
      items: [
        {
          partNumber: "LM358",
          qty: 3,
          agreedUnitPrice: "12.3456",
          allocations: [{ lotId: 41, qty: 3 }],
        },
        {
          partNumber: "LM358",
          qty: 2,
          agreedUnitPrice: "0.0001",
          allocations: [{ lotId: 42, qty: 2 }],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /demandItemId|inventoryId|ownerUserId|commission|profit/
    );
    expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it("requires explicit customer confirmation and preserves the original create payload/id after unknown timeout and version/candidate changes", () => {
    fillCreate();
    click(container.querySelector('input[type="checkbox"]')!);
    click(button("保存订单"));
    expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
    click(container.querySelector('input[type="checkbox"]')!);
    click(button("保存订单"));
    const first = runtime.mutations.create.mutate.mock.calls[0][0];
    fail("create");
    runtime.reads.lots = {
      isError: true,
      data: { items: [lot(99)], total: 1 },
    };
    render(
      React.createElement(CompanyStockOrderForm, {
        ...callbacks,
        customer: { id: 1, name: "客户甲" },
      })
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售数量"]'
      )!.disabled
    ).toBe(true);
    click(button("确认保存结果"));
    expect(runtime.mutations.create.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("allocates one line across two lots once, rejects an incomplete total, and freezes uncertain request version", () => {
    const value = order({ sourceType: "demand", companyStockAllocations: [] });
    render(
      React.createElement(CompanyStockAllocationForm, {
        ...callbacks,
        order: value,
      })
    );
    click(container.querySelector('[data-company-lot="41"] button')!);
    click(container.querySelector('[data-company-lot="42"] button')!);
    fill("批次 41 分配数量", "3");
    fill("批次 42 分配数量", "4");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    fill("批次 41 分配数量", "4");
    click(button("确认分配并预留"));
    const first = runtime.mutations.allocate.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 11,
      version: 7,
      items: [
        {
          orderItemId: 31,
          allocations: [
            { lotId: 41, qty: 4 },
            { lotId: 42, qty: 4 },
          ],
        },
      ],
    });
    fail("allocate");
    render(
      React.createElement(CompanyStockAllocationForm, {
        ...callbacks,
        order: { ...value, version: 99 },
      })
    );
    click(button("确认分配结果"));
    expect(runtime.mutations.allocate.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("ships partial quantities from multiple reserved lots, rejects excess, and replays the exact unknown request", () => {
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order(),
      })
    );
    fill("公司出货交付方式", "pickup");
    fill("批次 41 本次出货", "5");
    click(button("确认出货"));
    expect(runtime.mutations.ship.mutate).not.toHaveBeenCalled();
    fill("批次 41 本次出货", "2");
    fill("批次 42 本次出货", "1");
    click(button("确认出货"));
    const first = runtime.mutations.ship.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 11,
      version: 7,
      deliveryMethod: "pickup",
      items: [
        { orderItemId: 31, lotId: 41, qty: 2 },
        { orderItemId: 31, lotId: 42, qty: 1 },
      ],
    });
    fail("ship");
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order({ version: 99 }),
      })
    );
    click(button("确认出货结果"));
    expect(runtime.mutations.ship.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("validates nonnegative exact expense and mandatory note; unknown retry does not adopt a new amount/version", () => {
    render(
      React.createElement(SalesExpensesEditor, {
        ...callbacks,
        orderId: 11,
        version: 7,
        amount: "0",
      })
    );
    click(button("填写 / 修改费用"));
    fill("本单销售费用金额", "-1");
    fill("本单销售费用说明", "费用");
    click(button("保存费用"));
    expect(runtime.mutations.expenses.mutate).not.toHaveBeenCalled();
    fill("本单销售费用金额", "123.4567");
    fill("本单销售费用说明", "");
    click(button("保存费用"));
    expect(runtime.mutations.expenses.mutate).not.toHaveBeenCalled();
    fill("本单销售费用说明", "运输费用，覆盖本单费用总额");
    click(button("保存费用"));
    const first = runtime.mutations.expenses.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 11,
      version: 7,
      amount: "123.4567",
      note: "运输费用，覆盖本单费用总额",
    });
    expect(Object.keys(first).sort()).toEqual([
      "amount",
      "id",
      "note",
      "requestId",
      "version",
    ]);
    fail("expenses");
    render(
      React.createElement(SalesExpensesEditor, {
        ...callbacks,
        orderId: 11,
        version: 88,
        amount: "99",
      })
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="本单销售费用金额"]'
      )!.disabled
    ).toBe(true);
    click(button("确认保存结果"));
    expect(runtime.mutations.expenses.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("reconciliation starts blank despite large ledger/raw quantities; explicit zero and confirmation are required, with frozen retry", () => {
    render(
      React.createElement(CompanyStockReconciliationForm, {
        ...callbacks,
        candidate: candidate,
      })
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="真实盘点剩余数量"]'
      )!.value
    ).toBe("");
    fill("盘点与归属说明", "实物盘点剩余为零，确认公司归属");
    click(container.querySelector('input[type="checkbox"]')!);
    click(button("确认核对库存"));
    expect(runtime.mutations.reconcile.mutate).not.toHaveBeenCalled();
    fill("真实盘点剩余数量", "0");
    click(container.querySelector('input[type="checkbox"]')!);
    click(button("确认核对库存"));
    expect(runtime.mutations.reconcile.mutate).not.toHaveBeenCalled();
    click(container.querySelector('input[type="checkbox"]')!);
    click(button("确认核对库存"));
    const first = runtime.mutations.reconcile.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 51,
      remainingQty: 0,
      expectedMovementVersion: 7,
      ownershipConfirmed: true,
    });
    fail("reconcile");
    render(
      React.createElement(CompanyStockReconciliationForm, {
        ...callbacks,
        candidate: { ...candidate, expectedMovementVersion: 98 },
      })
    );
    click(button("确认核对结果"));
    expect(runtime.mutations.reconcile.mutate.mock.calls[1][0]).toEqual(first);
  });
  it.each([
    "isFetching",
    "isError",
    "isPlaceholderData",
    "notFetched",
    "disabled",
  ])(
    "does not expose reconciliation action on %s despite cached candidates",
    state => {
      runtime.reads.reconciliation[
        state === "notFetched" ? "isFetchedAfterMount" : state
      ] = state === "notFetched" ? false : true;
      render(
        React.createElement(CompanyStockReconciliationAction, {
          row: { id: 51, partNumber: "LM358", status: "received" },
          enabled: state !== "disabled",
          onSelect: saved,
        })
      );
      expect(container.querySelector("button")).toBeNull();
      expect(saved).not.toHaveBeenCalled();
    }
  );
  it.each([
    "verified",
    "current",
    "verificationIdentity",
    "principalActor",
    "principalStatus",
    "authenticated",
    "authLoading",
    "loginDisabled",
  ])(
    "fails closed for %s even with successful cached queries and enabled prop",
    field => {
      (runtime as any)[field] =
        field === "current" || field === "verificationIdentity"
          ? "B"
          : field === "principalActor"
            ? 99
            : field === "principalStatus"
              ? "required"
              : field === "authLoading" || field === "loginDisabled"
                ? true
                : false;
      render(
        React.createElement(CompanyStockOrderForm, {
          ...callbacks,
          customer: { id: 1, name: "客户甲" },
        })
      );
      expect(runtime.inputs.filter(row => row.enabled)).toEqual([]);
      expect(container.querySelector("[data-company-lot]")).toBeNull();
      expect(button("保存订单").disabled).toBe(true);
      click(button("保存订单"));
      expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("¥30.8");
    }
  );
  it("does not revive lot/cost drafts across A -> B -> A, and ignores late create completion after logout", () => {
    fillCreate();
    click(button("保存订单"));
    const stale = runtime.mutations.create.options;
    Object.assign(runtime, {
      scope: "B",
      current: "B",
      verificationIdentity: "B",
    });
    runtime.reads.lots.isFetching = true;
    render(
      React.createElement(CompanyStockOrderForm, {
        ...callbacks,
        customer: { id: 1, name: "客户甲" },
      })
    );
    expect(
      container.querySelector('[aria-label="批次 41 销售数量"]')
    ).toBeNull();
    expect(container.textContent).not.toContain("¥30.8");
    Object.assign(runtime, {
      scope: "A",
      current: "A",
      verificationIdentity: "A",
    });
    render(
      React.createElement(CompanyStockOrderForm, {
        ...callbacks,
        customer: { id: 1, name: "客户甲" },
      })
    );
    expect(
      container.querySelector('[aria-label="批次 41 销售数量"]')
    ).toBeNull();
    runtime.authenticated = false;
    render(
      React.createElement(CompanyStockOrderForm, {
        ...callbacks,
        customer: { id: 1, name: "客户甲" },
      })
    );
    act(() => stale.onSuccess({ id: 11, orderNumber: "OLD" }));
    expect(saved).not.toHaveBeenCalled();
  });
  it("keeps same-scope shipment draft read-only through revalidation and destroys it on actual order replacement", () => {
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order(),
      })
    );
    fill("批次 41 本次出货", "2");
    runtime.verified = false;
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order(),
      })
    );
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="批次 41 本次出货"]'
    )!;
    expect(input.value).toBe("2");
    expect(input.disabled).toBe(true);
    runtime.verified = true;
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order(),
      })
    );
    expect(input.value).toBe("2");
    render(
      React.createElement(CompanyStockShipmentForm, {
        ...callbacks,
        order: order({
          id: 12,
          companyStockAllocations: [
            { orderId: 12, orderItemId: 31, lotId: 41, reservedQty: 4 },
          ],
        }),
      })
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 本次出货"]'
      )!.value
    ).toBe("");
  });
  it("discards expenses on identity/logout and rejects the unmounted callback", () => {
    render(
      React.createElement(SalesExpensesEditor, {
        ...callbacks,
        orderId: 11,
        version: 7,
        amount: "0",
      })
    );
    click(button("填写 / 修改费用"));
    fill("本单销售费用金额", "1.2345");
    fill("本单销售费用说明", "费用");
    click(button("保存费用"));
    const stale = runtime.mutations.expenses.options;
    runtime.authenticated = false;
    render(
      React.createElement(SalesExpensesEditor, {
        ...callbacks,
        orderId: 11,
        version: 7,
        amount: "0",
      })
    );
    act(() => stale.onSuccess());
    expect(saved).not.toHaveBeenCalled();
    runtime.authenticated = true;
    render(
      React.createElement(SalesExpensesEditor, {
        ...callbacks,
        orderId: 11,
        version: 7,
        amount: "0",
      })
    );
    click(button("填写 / 修改费用"));
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="本单销售费用金额"]'
      )!.value
    ).toBe("0");
  });
  it("customer picker reuses native mine/all scope and never selects cached rows while disabled or fetching", () => {
    render(
      React.createElement(SalesCustomerPicker, {
        enabled: true,
        onSelect: saved,
      })
    );
    expect(
      runtime.inputs.find(row => row.name === "customers")!.input
    ).toMatchObject({ scope: "mine", archived: false, due: "all" });
    fill("搜索有权限客户", "客户甲");
    click(button("搜索"));
    click(button("选择客户"));
    expect(saved).toHaveBeenCalledWith({ id: 1, name: "客户甲" });
    runtime.reads.customers.isFetching = true;
    render(
      React.createElement(SalesCustomerPicker, {
        enabled: true,
        onSelect: saved,
      })
    );
    expect(container.textContent).not.toContain("客户甲");
    runtime.reads.customers.isFetching = false;
    render(
      React.createElement(SalesCustomerPicker, {
        enabled: false,
        onSelect: saved,
      })
    );
    expect(container.textContent).not.toContain("客户甲");
  });
});

describe("readonly server profit and commission defenses (no policy arithmetic)", () => {
  it.each(["0", "0.000000", "000.0000", "-0.000000", "-1.000001"])(
    "blocks malicious positive estimated/earned commission when net %s",
    netProfit => {
      render(
        React.createElement(SalesProfitSummary, {
          profit: profit({ netProfit }),
          commission: commission({
            estimatedAmount: "999.99",
            earnedAmount: "888.88",
            collectionStatus: "collected",
          }),
        })
      );
      expect(container.textContent).not.toContain("¥999.99");
      expect(container.textContent).not.toContain("¥888.88");
      expect(container.textContent).toContain("待核");
    }
  );
  it.each([
    { status: "unknown_cost", costAmount: null, netProfit: null },
    { status: "ready", costAmount: null },
    { status: "ready", netProfit: "NaN" },
    { status: "ready", expenseAmount: "" },
  ])(
    "blocks positive commission for invalid/unknown server result %j",
    change => {
      render(
        React.createElement(SalesProfitSummary, {
          profit: profit(change),
          commission: commission({
            estimatedAmount: "999.99",
            earnedAmount: "888.88",
            collectionStatus: "collected",
          }),
        })
      );
      expect(container.textContent).not.toContain("¥999.99");
      expect(container.textContent).not.toContain("¥888.88");
    }
  );
  it("shows valid zero commission for zero/loss profit and never adds a pending-policy selector", () => {
    render(
      React.createElement(SalesProfitSummary, {
        profit: profit({ netProfit: "0.000000" }),
        commission: commission({
          estimatedAmount: "0.00",
          earnedAmount: "0.00",
          collectionStatus: "collected",
        }),
      })
    );
    expect(
      container.querySelector('[aria-label="利润与提成"]')!.textContent
    ).toContain("预计提成 ¥0");
    expect(container.querySelector("select,input")).toBeNull();
    expect(container.textContent).not.toContain("规则待确认");
  });
  it.each(["uncollected", "partial", "collected"])(
    "only displays earned result after bank/cash collection: %s",
    collectionStatus => {
      render(
        React.createElement(SalesProfitSummary, {
          profit: profit(),
          commission: commission({ collectionStatus, earnedAmount: "4.62" }),
        })
      );
      const summary = container.querySelector('[aria-label="利润与提成"]')!;
      expect(summary.textContent).toContain("预计提成 ¥4.62");
      expect(summary.textContent).toContain(
        collectionStatus === "collected" ? "已计入 ¥4.62" : "已计入 —"
      );
    }
  );
  it("preserves arbitrary valid server precision and tax/net values without recalculating 13% or converting to floats", () => {
    render(
      React.createElement(SalesProfitSummary, {
        profit: profit({
          netProfit: "9007199254740993.123456",
          grossProfit: "765.432100",
          taxDeductionAmount: "88.123456",
        }),
        commission: commission({
          estimatedAmount: "123.456789",
          earnedAmount: "123.456789",
          collectionStatus: "collected",
        }),
      })
    );
    expect(container.textContent).toContain("¥9,007,199,254,740,993.123456");
    expect(container.textContent).toContain("¥123.456789");
    expect(container.textContent).toContain("税扣 ¥88.123456");
  });
  it("validates helper quantities/decimal expense and exact server display without real financial seeds", () => {
    expect(() =>
      companyOrderItems([{ lot: lot(41), qty: "9", agreedUnitPrice: "1" }])
    ).toThrow();
    expect(() => expenseInput("0.00001", "说明")).toThrow();
    expect(expenseInput("0.0000", "说明")).toEqual({
      amount: "0.0000",
      note: "说明",
    });
    expect(serverMoney("9007199254740993.000001")).toBe(
      "¥9,007,199,254,740,993.000001"
    );
  });
});

// ISR-001: synthetic order/lot snapshots only; same actual form + original RPC hook.
describe("ISR-001 all-order-items allocation closure", () => {
  const demand = (sameIdentity = true, qty = 4) => {
    const first = { ...order().items[0], orderedQty: qty };
    return order({
      sourceType: "demand",
      companyStockAllocated: false,
      companyStockAllocations: [],
      items: [
        first,
        {
          ...first,
          id: 32,
          ...(sameIdentity
            ? {}
            : { partNumber: "STM32", brand: "ST", pkg: "QFP", dc: "25+" }),
        },
      ],
    });
  };
  const show = (value = demand(), enabled = true) =>
    render(
      React.createElement(CompanyStockAllocationForm, {
        ...callbacks,
        enabled,
        order: value,
      })
    );
  const select = (id: number, qty: string) => {
    click(container.querySelector(`[data-company-lot="${id}"] button`)!);
    expect(
      container.querySelector<HTMLInputElement>(
        `[aria-label="批次 ${id} 分配数量"]`
      )!.value
    ).toBe("");
    fill(`批次 ${id} 分配数量`, qty);
  };
  const switchLine = (id: number) => fill("待分配订单物料", String(id));
  const fillBoth = (value = demand()) => {
    show(value);
    switchLine(31);
    select(41, "2");
    select(42, "2");
    switchLine(32);
    select(41, "2");
    select(42, "2");
  };
  const snapshotDrafts = (sameLot = false, qty = "4") => ({
    31: [{ lot: lot(41), qty }],
    32: [{ lot: lot(sameLot ? 41 : 42), qty }],
  });

  it("submits two complete order items across two lots each, restores switched rows, rejects missing item and retries the exact whole request", () => {
    const value = demand();
    show(value);
    select(41, "2");
    select(42, "2");
    expect(
      container.querySelector('[data-allocation-item="31"]')!.textContent
    ).toContain("已完成");
    expect(
      container.querySelector('[data-allocation-item="32"]')!.textContent
    ).toContain("未完成");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "全部物料"
    );
    switchLine(32);
    expect(
      container.querySelector('[aria-label="批次 41 分配数量"]')
    ).toBeNull();
    select(41, "2");
    select(42, "2");
    switchLine(31);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.value
    ).toBe("2");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 42 分配数量"]'
      )!.value
    ).toBe("2");
    expect(window.confirm).not.toHaveBeenCalled();
    click(button("确认分配并预留"));
    const first = runtime.mutations.allocate.mutate.mock.calls[0][0];
    expect(first).toEqual({
      id: 11,
      version: 7,
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,80}$/),
      items: [31, 32].map(orderItemId => ({
        orderItemId,
        allocations: [
          { lotId: 41, qty: 2 },
          { lotId: 42, qty: 2 },
        ],
      })),
    });
    expect(JSON.stringify(first)).not.toMatch(
      /partNumber|brand|pkg|owner|inventoryId|demandItemId/
    );
    fail("allocate");
    runtime.reads.lots = {
      isFetching: true,
      isError: true,
      data: { items: [], total: 0 },
    };
    show({ ...value, version: 99 });
    expect(
      container.querySelector<HTMLSelectElement>(
        '[aria-label="待分配订单物料"]'
      )!.disabled
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.disabled
    ).toBe(true);
    fill("批次 41 分配数量", "8");
    click(button("确认分配结果"));
    expect(runtime.mutations.allocate.mutate.mock.calls[1][0]).toBe(first);
    expect(runtime.mutations.allocate.mutate).toHaveBeenCalledTimes(2);
  });

  it("keeps each material's candidates exact and its rows isolated across line switches", () => {
    const value = demand(false);
    const second = { partNumber: "STM32", brand: "ST", pkg: "QFP", dc: "25+" };
    runtime.reads.lots.data = {
      items: [
        lot(41),
        lot(42),
        lot(43, second),
        lot(44, second),
        lot(45, { partNumber: "lm358" }),
        lot(46, { brand: "TI " }),
        lot(47, { pkg: "soic" }),
        lot(48, { dc: "24+ " }),
      ],
      total: 8,
    };
    show(value);
    expect(
      Array.from(container.querySelectorAll("[data-company-lot]")).map(node =>
        node.getAttribute("data-company-lot")
      )
    ).toEqual(["41", "42"]);
    select(41, "2");
    select(42, "2");
    switchLine(32);
    expect(
      Array.from(container.querySelectorAll("[data-company-lot]")).map(node =>
        node.getAttribute("data-company-lot")
      )
    ).toEqual(["43", "44"]);
    expect(
      container.querySelector('[aria-label="批次 41 分配数量"]')
    ).toBeNull();
    select(43, "1");
    select(44, "3");
    switchLine(31);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.value
    ).toBe("2");
    switchLine(32);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 43 分配数量"]'
      )!.value
    ).toBe("1");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate.mock.calls[0][0].items).toEqual([
      {
        orderItemId: 31,
        allocations: [
          { lotId: 41, qty: 2 },
          { lotId: 42, qty: 2 },
        ],
      },
      {
        orderItemId: 32,
        allocations: [
          { lotId: 43, qty: 1 },
          { lotId: 44, qty: 3 },
        ],
      },
    ]);
  });

  it("checks same lot availability across both order items before mutation", () => {
    const value = demand(true, 5);
    show(value);
    select(41, "5");
    switchLine(32);
    select(41, "5");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "同批次全单合量"
    );
    fill("批次 41 分配数量", "3");
    select(42, "2");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).toHaveBeenCalledTimes(1);
  });

  it("preserves all same-context drafts through candidate/order re-fetch and uses refreshed version only before the first submit", () => {
    const value = demand();
    fillBoth(value);
    const node = container.querySelector<HTMLInputElement>(
      '[aria-label="批次 41 分配数量"]'
    )!;
    runtime.verified = false;
    runtime.reads.lots.isFetching = true;
    show(value, false);
    expect(node.value).toBe("2");
    expect(node.disabled).toBe(true);
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    runtime.verified = true;
    show(value);
    expect(container.querySelector('[aria-label="批次 41 分配数量"]')).toBe(
      node
    );
    expect(button("确认分配并预留").disabled).toBe(true);
    runtime.reads.lots.isFetching = false;
    show({ ...value, version: 8 });
    switchLine(31);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.value
    ).toBe("2");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate.mock.calls[0][0]).toMatchObject({
      version: 8,
      items: [{ orderItemId: 31 }, { orderItemId: 32 }],
    });
  });

  it("unfreezes a definitively rejected 401 without losing any line draft", () => {
    fillBoth();
    click(button("确认分配并预留"));
    fail("allocate", "UNAUTHORIZED");
    expect(
      container.querySelector<HTMLSelectElement>(
        '[aria-label="待分配订单物料"]'
      )!.disabled
    ).toBe(false);
    switchLine(31);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.value
    ).toBe("2");
    switchLine(32);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 42 分配数量"]'
      )!.value
    ).toBe("2");
    expect(button("确认分配并预留").disabled).toBe(false);
  });

  it("destroys every row on A -> B -> A and ignores unmounted allocation success/error callbacks after scope/logout", () => {
    fillBoth();
    click(button("确认分配并预留"));
    const stale = runtime.mutations.allocate.options;
    Object.assign(runtime, {
      scope: "B",
      current: "B",
      verificationIdentity: "B",
    });
    show();
    expect(
      container.querySelector('[aria-label="批次 41 分配数量"]')
    ).toBeNull();
    Object.assign(runtime, {
      scope: "A",
      current: "A",
      verificationIdentity: "A",
    });
    show();
    switchLine(32);
    expect(
      container.querySelector('[aria-label="批次 41 分配数量"]')
    ).toBeNull();
    act(() => {
      stale.onSuccess();
      stale.onError({ message: "STALE", data: { code: "CONFLICT" } });
      stale.onSettled();
    });
    expect(saved).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("STALE");
    fillBoth();
    click(button("确认分配并预留"));
    const beforeLogout = runtime.mutations.allocate.options;
    runtime.authenticated = false;
    show();
    act(() => beforeLogout.onSuccess());
    expect(saved).not.toHaveBeenCalled();
  });

  it("rejects retained DOM writes if live storage scope changed without a rerender", () => {
    fillBoth();
    runtime.current = "B";
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    fill("批次 41 分配数量", "7");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 分配数量"]'
      )!.value
    ).toBe("2");
  });

  it.each(["", "0", "-1", "1.5", "2e0", "0x2", "9007199254740993"])(
    "rejects non-positive/non-decimal/unsafe UI quantity %s before mutation",
    qty => {
      fillBoth();
      fill("批次 41 分配数量", qty);
      click(button("确认分配并预留"));
      expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    }
  );

  it.each([
    { sourceType: "company_stock" },
    { sourceType: "unknown" },
    { status: "cancelled" },
    { companyStockAllocated: true },
    {
      companyStockAllocations: [
        { orderItemId: 31, lotId: 41, reservedQty: 0, releasedQty: 4 },
      ],
    },
    { items: [{ ...order().items[0], shippedQty: 1 }] },
  ])(
    "rejects wrong source, old shipment or any reservation at the actual form %j",
    change => {
      show(demand());
      select(41, "4");
      show({ ...demand(), ...change });
      expect(
        container.querySelector('[aria-label="待分配订单物料"]')
      ).toBeNull();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    }
  );

  it("rejects a selected snapshot that became a foreign material before the actual submit", () => {
    fillBoth();
    runtime.reads.lots.data.items[0].dc = "foreign";
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
  });

  it("rejects 201 actual UI allocations across two items instead of submitting a partial 200", () => {
    const value = demand();
    value.items[0].orderedQty = 100;
    value.items[1].orderedQty = 101;
    runtime.reads.lots.data = {
      items: Array.from({ length: 201 }, (_, index) =>
        lot(1000 + index, { availableQty: 1 })
      ),
      total: 201,
    };
    show(value);
    for (let index = 0; index < 100; index++) select(1000 + index, "1");
    switchLine(32);
    for (let index = 100; index < 201; index++) select(1000 + index, "1");
    click(button("确认分配并预留"));
    expect(runtime.mutations.allocate.mutate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "200"
    );
  });

  it("uses the same pure builder for complete item coverage, foreign item rejection and exact total rejection", () => {
    expect(companyStockAllocationItems(demand(), snapshotDrafts())).toEqual([
      { orderItemId: 31, allocations: [{ lotId: 41, qty: 4 }] },
      { orderItemId: 32, allocations: [{ lotId: 42, qty: 4 }] },
    ]);
    expect(() =>
      companyStockAllocationItems(demand(), { 31: snapshotDrafts()[31] })
    ).toThrow();
    expect(() =>
      companyStockAllocationItems(demand(), { ...snapshotDrafts(), 999: [] })
    ).toThrow();
    expect(() =>
      companyStockAllocationItems(demand(), snapshotDrafts(false, "3"))
    ).toThrow();
    expect(() =>
      companyStockAllocationItems(demand(), {
        ...snapshotDrafts(),
        31: [
          { lot: lot(41), qty: "2" },
          { lot: lot(41), qty: "2" },
        ],
      })
    ).toThrow();
    expect(() =>
      companyStockAllocationItems(demand(), {
        ...snapshotDrafts(),
        31: [{ lot: lot(41), qty: 4 as any }],
      })
    ).toThrow();
  });

  it.each(["partNumber", "brand", "pkg", "dc"])(
    "rejects byte-mismatched %s in the real pure builder",
    field => {
      const drafts = snapshotDrafts();
      (drafts[31][0].lot as any)[field] += " ";
      expect(() => companyStockAllocationItems(demand(), drafts)).toThrow();
    }
  );

  it("uses the lower same-lot snapshot availability across rows and never rounds the integer boundary", () => {
    const drafts = snapshotDrafts(true);
    drafts[32][0].lot.availableQty = 7;
    expect(() => companyStockAllocationItems(demand(), drafts)).toThrow();
    const value = demand(true, 500000000);
    const huge = {
      31: [{ lot: lot(41, { availableQty: 999999999 }), qty: "500000000" }],
      32: [{ lot: lot(41, { availableQty: 999999999 }), qty: "500000000" }],
    };
    expect(() => companyStockAllocationItems(value, huge)).toThrow();
    value.items[1].orderedQty = 499999999;
    huge[32][0].qty = "499999999";
    expect(companyStockAllocationItems(value, huge)).toHaveLength(2);
  });

  it("accepts exactly 200 allocations globally and rejects 201 with the actual builder", () => {
    const value = demand(true, 100);
    const drafts = {
      31: Array.from({ length: 100 }, (_, i) => ({
        lot: lot(1000 + i),
        qty: "1",
      })),
      32: Array.from({ length: 100 }, (_, i) => ({
        lot: lot(2000 + i),
        qty: "1",
      })),
    };
    expect(
      companyStockAllocationItems(value, drafts).flatMap(
        item => item.allocations
      )
    ).toHaveLength(200);
    drafts[32].push({ lot: lot(2100), qty: "1" });
    value.items[1].orderedQty = 101;
    expect(() => companyStockAllocationItems(value, drafts)).toThrow("200");
  });
});
