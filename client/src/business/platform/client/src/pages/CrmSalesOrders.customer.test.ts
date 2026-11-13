// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  customerMatches,
  customerPageMatches,
} from "../hooks/useSalesOrderSession";

const runtime = vi.hoisted(() => ({
  inputs: [] as {
    name: string;
    input: Record<string, unknown>;
    enabled: boolean;
  }[],
  memory: {} as Record<string, unknown>,
  memoryCalls: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  list: { items: [] as any[], total: 0 },
  candidates: { items: [] as any[], total: 0 },
  detail: null as any,
  fetching: false,
  fetched: true,
  mutations: {} as Record<
    string,
    { mutate: ReturnType<typeof vi.fn>; options: any; pending: boolean }
  >,
}));
vi.mock("../hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return {
    usePageMemory: () => {
      runtime.memoryCalls("page");
      return true;
    },
    useRememberedState: (name: string, initial: unknown) => {
      runtime.memoryCalls(name);
      return useState(name in runtime.memory ? runtime.memory[name] : initial);
    },
    freshListOptions: (_: unknown, ready: boolean) => ({ enabled: ready }),
    useRestoringListQuery: (query: unknown) => query,
  };
});
vi.mock("wouter", () => ({
  useLocation: () => ["/customers/1", runtime.navigate],
  useSearch: () => "?demandNo=UNRELATED-ROUTE&keyword=OTHER-CUSTOMER",
}));
vi.mock("../../../../BusinessContentFrame", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-platform-layout": true }, children),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../api/business-trpc", () => {
  const query = (name: string) => ({
    useQuery: (
      input: Record<string, unknown>,
      options: { enabled?: boolean } = {}
    ) => {
      runtime.inputs.push({ name, input, enabled: options.enabled !== false });
      return {
        data:
          name === "list"
            ? runtime.list
            : name === "candidates"
              ? runtime.candidates
              : runtime.detail,
        isLoading: false,
        isFetching: runtime.fetching,
        isFetchedAfterMount: runtime.fetched,
        isError: false,
        error: null,
        refetch: vi.fn(),
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
      useUtils: () => ({
        crmSalesOrder: {
          list: { invalidate: runtime.invalidate },
          get: { invalidate: runtime.invalidate },
          candidates: { invalidate: runtime.invalidate },
        },
      }),
      crmSalesOrder: {
        list: query("list"),
        get: query("get"),
        candidates: query("candidates"),
        create: mutation("create"),
        cancel: mutation("cancel"),
        recordPayment: mutation("payment"),
        ship: mutation("ship"),
      },
    },
  };
});
vi.mock("../components/ui/dialog", async importOriginal => ({
  ...(await importOriginal<typeof import("../components/ui/dialog")>()),
  Dialog: ({ open, children }: any) => (open ? children : null),
  DialogContent: ({ children, className }: any) =>
    React.createElement("div", { className, "data-dialog": true }, children),
  DialogHeader: ({ children }: any) =>
    React.createElement("header", null, children),
  DialogTitle: ({ children }: any) => React.createElement("h2", null, children),
  DialogFooter: ({ children }: any) =>
    React.createElement("footer", null, children),
}));
vi.mock("../components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    React.createElement("div", { "data-value": value }, children),
  SelectTrigger: ({ children }: any) =>
    React.createElement("button", null, children),
  SelectValue: () => "全部状态",
  SelectContent: () => null,
  SelectItem: () => null,
}));
vi.mock("../components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, disabled }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      disabled,
      onChange: (event: any) => onCheckedChange(event.target.checked),
    }),
}));
vi.mock("../components/customers/ConfirmDialog", () => ({
  ConfirmDialog: ({ children, onCancel, onConfirm, busy, error }: any) =>
    React.createElement(
      "div",
      { "data-confirm": true },
      children,
      error,
      React.createElement(
        "button",
        { onClick: onCancel, disabled: busy },
        "返回"
      ),
      React.createElement(
        "button",
        { onClick: onConfirm, disabled: busy },
        "确认取消订单"
      )
    ),
}));
import CrmSalesOrders, {
  CustomerSalesOrders,
  type CustomerSalesOrdersProps,
} from "./CrmSalesOrders";
import { toast } from "sonner";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let props: CustomerSalesOrdersProps;
const order = (customerId = 1) => ({
  id: 11,
  customerId,
  orderNumber: "SO-11",
  customerName: "客户甲",
  demandNo: "D-21",
  demandId: 21,
  status: "confirmed",
  projectName: "项目",
  totalAmount: "120.0000",
  paymentStatus: "unpaid",
  shipmentStatus: "partial",
  createdAt: "2026-11-10",
  paidAmount: "0",
  monthlyAmount: "0",
  version: 7,
  orderedQty: 10,
  shippedQty: 0,
  dueDate: null,
  confirmationNote: "原确认依据",
  payments: [],
  shipments: [],
  items: [
    {
      id: 31,
      partNumber: "LM358",
      orderedQty: 10,
      shippedQty: 2,
      qtyUnit: "个",
      unitPrice: "12.0000",
      lineAmount: "120.0000",
    },
  ],
  stockCandidates: [
    {
      inventoryId: 41,
      orderItemId: 31,
      partNumber: "LM358",
      ownerName: "授权库存",
      availableQty: 9,
    },
  ],
});
const demand = (customerId = 1) => ({
  id: 21,
  customerId,
  demandNo: "D-21",
  demandRevision: 4,
  customerName: "客户甲",
  status: "processing",
  projectName: "项目",
  items: [
    {
      id: 22,
      partNumber: "LM358",
      brand: "TI",
      pkg: "SOIC",
      demandQty: 10,
      remainingQty: 8,
      qtyUnit: "个",
    },
  ],
});
function render(change: Partial<CustomerSalesOrdersProps> = {}) {
  props = { ...props, ...change };
  act(() => root.render(React.createElement(CustomerSalesOrders, props)));
}
function button(text: string, scope: ParentNode = document.body) {
  const result = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => item.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function click(el: Element) {
  act(() =>
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
  );
}
function input(selector: string, value: string) {
  const el = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(selector);
  if (!el) throw new Error(`Missing input: ${selector}`);
  act(() => {
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype,
      "value"
    )?.set?.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function selectDemand() {
  click(button("成交确认 / 生成订单"));
  click(button("选择"));
}
function fillOrder() {
  selectDemand();
  input('[aria-label="LM358 确认数量"]', "3");
  input('[aria-label="LM358 含税单价"]', "12.3456");
  input("#sales-order-due-date", "2026-12-01");
  input("#sales-order-confirmation", "客户电话确认数量、含税价格和交期");
  click(document.querySelector('input[type="checkbox"]')!);
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.invalidate.mockResolvedValue(undefined);
  runtime.inputs = [];
  runtime.memory = {
    keyword: "OTHER",
    draftKeyword: "OTHER",
    page: 3,
    selectedId: 99,
  };
  runtime.mutations = {};
  runtime.fetching = false;
  runtime.fetched = true;
  runtime.list = { items: [order()], total: 41 };
  runtime.candidates = { items: [demand()], total: 1 };
  runtime.detail = order();
  props = {
    customer: { id: 1, name: "客户甲", archivedAt: null },
    contextIdentityKey: "enterprise:1:actor:7",
    canRead: true,
    canWrite: true,
    onDirtyChange: vi.fn(),
    onOrderChanged: vi.fn(),
  };
  vi.stubGlobal("React", React);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No production network or DB allowed");
    })
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
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

describe("customer-embedded sales orders (real component, mocked transport only)", () => {
  it("requires explicit business-order read access and valid identity before mounting query hooks", () => {
    render({ canRead: false });
    expect(container.textContent).toContain("客户查看权限不包含销售订单权限");
    expect(runtime.inputs).toEqual([]);
    render({ canRead: true, contextIdentityKey: null });
    expect(runtime.inputs).toEqual([]);
  });
  it("is compact without layout/header or independent remembered filters and route intents", () => {
    render();
    expect(container.querySelector("[data-platform-layout]")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(
      container.querySelector(".crm-sales-orders-embedded")
    ).not.toBeNull();
    expect(runtime.memoryCalls).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.inputs.find(item => item.name === "list")?.input).toEqual({
      customerId: 1,
      keyword: "",
      page: 1,
      pageSize: 20,
    });
  });
  it("passes exact customerId to every list, detail and demand query, independent of names/keywords", () => {
    render();
    click(button("查看"));
    click(button("关闭"));
    click(button("成交确认 / 生成订单"));
    for (const item of runtime.inputs) expect(item.input.customerId).toBe(1);
    expect(
      runtime.inputs.some(
        item => item.name === "get" && item.enabled && item.input.id === 11
      )
    ).toBe(true);
    expect(
      runtime.inputs.some(
        item =>
          item.name === "candidates" &&
          item.enabled &&
          item.input.keyword === ""
      )
    ).toBe(true);
  });
  it("refuses the entire mixed-customer list, including count, without locally filtering", () => {
    runtime.list = {
      items: [order(), { ...order(2), orderNumber: "FOREIGN-ORDER" }],
      total: 901,
    };
    render();
    expect(container.textContent).toContain("响应与当前客户或订单不一致");
    expect(container.textContent).not.toContain("SO-11");
    expect(container.textContent).not.toContain("FOREIGN-ORDER");
    expect(container.textContent).not.toContain("901");
  });
  it("refuses foreign demand candidates and foreign or mismatched-order details before writes", () => {
    runtime.candidates = { items: [demand(2)], total: 1 };
    render();
    click(button("成交确认 / 生成订单"));
    expect(document.body.textContent).toContain("响应与当前客户或订单不一致");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        el => el.textContent === "选择"
      )
    ).toBe(false);
    click(button("取消"));
    runtime.detail = { ...order(2), confirmationNote: "FOREIGN-NOTE" };
    click(button("查看"));
    expect(document.body.textContent).not.toContain("FOREIGN-NOTE");
    expect(document.body.textContent).toContain("响应与当前客户或订单不一致");
    click(button("关闭"));
    runtime.detail = { ...order(), id: 99 };
    click(button("收款"));
    expect(button("确认收款").disabled).toBe(true);
    click(button("确认收款"));
    expect(runtime.mutations.payment.mutate).not.toHaveBeenCalled();
  });
  it.each([
    { readOnly: true },
    { canWrite: false },
    { customer: { id: 1, name: "客户甲", archivedAt: "2026-11-10" } },
  ])(
    "keeps archived/readOnly/insufficient-write sessions read-only: %j",
    restriction => {
      render(restriction);
      expect(container.textContent).toMatch(/只读|仅供查看/);
      expect(
        Array.from(container.querySelectorAll("button")).some(el =>
          el.textContent?.includes("生成订单")
        )
      ).toBe(false);
      expect(
        Array.from(container.querySelectorAll("button")).some(
          el => el.textContent === "收款" || el.textContent === "出货"
        )
      ).toBe(false);
      click(button("查看"));
      expect(
        Array.from(document.querySelectorAll("button")).some(
          el => el.textContent === "登记收款" || el.textContent === "取消订单"
        )
      ).toBe(false);
      expect(
        runtime.inputs.filter(
          item => item.name === "candidates" && item.enabled
        )
      ).toEqual([]);
    }
  );
  it("handles one demand intent nonce in place and matches both demandNo and demandId", () => {
    const onIntentHandled = vi.fn();
    render({
      intent: { demandNo: "D-21", demandId: 21, nonce: "one" },
      onIntentHandled,
    });
    expect(document.body.textContent).toContain("客户成交报价与确认");
    expect(
      document.querySelector('[aria-label="LM358 含税单价"]')
    ).not.toBeNull();
    expect(onIntentHandled).toHaveBeenCalledWith("one");
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "采购报价 / 销售采用不等于客户确认"
    );
    render();
    expect(onIntentHandled).toHaveBeenCalledTimes(1);
  });
  it("views demand-linked orders in-place under read-only permission without opening create", () => {
    const onIntentHandled = vi.fn();
    render({
      readOnly: true,
      intent: {
        mode: "view",
        demandNo: "D-21",
        demandId: 21,
        nonce: "view-one",
      },
      onIntentHandled,
    });
    expect(
      runtime.inputs.filter(item => item.name === "list").at(-1)?.input
    ).toMatchObject({ customerId: 1, keyword: "D-21", page: 1 });
    expect(document.querySelector("[data-dialog]")).toBeNull();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(onIntentHandled).toHaveBeenCalledWith("view-one");
    expect(
      runtime.inputs.filter(item => item.name === "candidates" && item.enabled)
    ).toEqual([]);
  });
  it("blocks a second demand intent and ordinary navigation while a draft is not discarded", () => {
    render();
    selectDemand();
    render({
      intent: { mode: "view", demandNo: "D-OTHER", nonce: "blocked" },
      onIntentHandled: vi.fn(),
    });
    expect(
      document.querySelector('[aria-label="LM358 含税单价"]')
    ).not.toBeNull();
    expect(
      runtime.inputs.filter(item => item.name === "list").at(-1)?.input.keyword
    ).toBe("");
    const link = document.createElement("a");
    link.href = "/customers";
    document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    link.remove();
  });
  it("does not silently auto-select a same-number demand with a different demandId", () => {
    render({ intent: { demandNo: "D-21", demandId: 999, nonce: "mismatch" } });
    expect(document.querySelector('[aria-label="LM358 含税单价"]')).toBeNull();
    expect(toast.error).toHaveBeenCalled();
    expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
  });
  it("preserves true create payload, precision, demand revision, customer confirmation and idempotent retry", () => {
    render();
    fillOrder();
    expect(document.body.textContent).toContain("¥37.0368");
    click(button("保存订单"));
    const first = runtime.mutations.create.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      demandId: 21,
      demandRevision: 4,
      items: [{ demandItemId: 22, qty: 3, agreedUnitPrice: "12.3456" }],
      dueDate: "2026-12-01",
      customerConfirmed: true,
      confirmationNote: "客户电话确认数量、含税价格和交期",
    });
    expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    act(() => {
      runtime.mutations.create.options.onError({
        message: "timeout",
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      runtime.mutations.create.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="LM358 含税单价"]')
        ?.disabled
    ).toBe(true);
    click(button("确认保存结果"));
    expect(runtime.mutations.create.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("requires explicit customer confirmation instead of adopting procurement prices", () => {
    render();
    selectDemand();
    input('[aria-label="LM358 确认数量"]', "3");
    input('[aria-label="LM358 含税单价"]', "12");
    click(button("保存订单"));
    expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("请确认已与客户确认订单");
  });
  it("preserves payment/monthly semantics and order version without requiring payment for partial shipment", () => {
    render();
    click(button("收款"));
    input(".crm-sales-orders-dialog select", "monthly");
    input('.crm-sales-orders-dialog input[placeholder="含税金额"]', "12.3456");
    click(button("确认收款"));
    expect(runtime.mutations.payment.mutate.mock.calls[0][0]).toMatchObject({
      id: 11,
      version: 7,
      method: "monthly",
      amount: "12.3456",
    });
    act(() => runtime.mutations.payment.options.onSuccess({ replayed: false }));
    click(button("关闭"));
    click(button("出货"));
    input(".crm-sales-orders-shipment-table input", "3");
    input(".crm-sales-orders-dialog select", "pickup");
    click(button("确认出货"));
    expect(runtime.mutations.ship.mutate.mock.calls[0][0]).toMatchObject({
      id: 11,
      version: 7,
      deliveryMethod: "pickup",
      items: [{ orderItemId: 31, inventoryId: 41, qty: 3 }],
    });
    expect(props.onOrderChanged).toHaveBeenCalledTimes(1);
  });
  it("keeps cancelled-order business guard and exact cancellation version/reason", () => {
    render();
    click(button("查看"));
    click(button("取消订单"));
    input(".crm-sales-orders-cancel-reason textarea", "客户撤回订单");
    click(button("确认取消订单"));
    expect(runtime.mutations.cancel.mutate).toHaveBeenCalledWith({
      id: 11,
      version: 7,
      reason: "客户撤回订单",
    });
  });
  it.each([{ paidAmount: "1" }, { monthlyAmount: "1" }, { shippedQty: 1 }])(
    "cannot cancel an already paid/monthly/shipped order: %j",
    change => {
      runtime.detail = { ...order(), shippedQty: 0, ...change };
      render();
      click(button("查看"));
      expect(button("取消订单").disabled).toBe(true);
    }
  );
  it("protects unsaved order/payment/shipment drafts on close and page unload and reports dirty state", () => {
    render();
    selectDemand();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    click(button("取消"));
    expect(document.body.textContent).toContain("放弃本次录入");
    click(button("继续编辑"));
    expect(
      document.querySelector('[aria-label="LM358 确认数量"]')
    ).not.toBeNull();
    click(button("取消"));
    click(button("放弃录入"));
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    click(button("收款"));
    input('.crm-sales-orders-dialog input[placeholder="含税金额"]', "2");
    click(button("取消"));
    expect(window.confirm).toHaveBeenCalled();
    expect(document.body.textContent).toContain("确认收款");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("guards shipment and cancellation draft close and resets them only on confirmed abandonment", () => {
    render();
    click(button("出货"));
    input(".crm-sales-orders-shipment-table input", "3");
    click(button("取消"));
    expect(document.body.textContent).toContain("确认出货");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    click(button("取消"));
    expect(document.body.textContent).not.toContain("确认出货");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    click(button("取消订单"));
    input(".crm-sales-orders-cancel-reason textarea", "草稿");
    vi.mocked(window.confirm).mockReturnValue(false);
    click(button("返回"));
    expect(document.querySelector("[data-confirm]")).not.toBeNull();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("clears all drafts/selection/filters on customer or same-customer identity changes and ignores old async completions", () => {
    render();
    fillOrder();
    click(button("保存订单"));
    const old = runtime.mutations.create.options;
    runtime.list = { items: [order(2)], total: 1 };
    runtime.candidates = { items: [demand(2)], total: 1 };
    render({
      customer: { id: 2, name: "客户乙" },
      contextIdentityKey: "enterprise:2:actor:8",
    });
    expect(document.querySelector('[aria-label="LM358 含税单价"]')).toBeNull();
    expect(runtime.inputs.at(-3)?.input).toMatchObject({
      customerId: 2,
      page: 1,
      keyword: "",
    });
    act(() => {
      old.onSuccess({ id: 11, orderNumber: "OLD", replayed: false });
      old.onError({ message: "OLD-ERROR" });
    });
    expect(props.onOrderChanged).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(runtime.invalidate).not.toHaveBeenCalled();
    click(button("成交确认 / 生成订单"));
    click(button("选择"));
    render({ contextIdentityKey: "enterprise:2:actor:9" });
    expect(document.querySelector('[aria-label="LM358 含税单价"]')).toBeNull();
  });
  it.each(["create", "payment", "ship", "cancel"])(
    "ignores stale %s completions on same-customer authorization identity replacement",
    name => {
      render();
      const stale = runtime.mutations[name].options;
      render({
        contextIdentityKey: "enterprise:1:actor:7:auth-v2",
        readOnly: true,
      });
      act(() => {
        stale.onSuccess({ id: 11, orderNumber: "OLD", replayed: false });
        stale.onError({ message: "OLD" });
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(props.onOrderChanged).not.toHaveBeenCalled();
      expect(runtime.invalidate).not.toHaveBeenCalled();
    }
  );
  it("reports executing transactions as dirty and cannot discard entry during pending save", () => {
    render();
    fillOrder();
    click(button("保存订单"));
    runtime.mutations.create.pending = true;
    render();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(button("取消").disabled).toBe(true);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
  });
  it("fails closed on permission loss and on cached data not yet proven fresh after mounting", () => {
    render();
    selectDemand();
    const old = runtime.mutations.create.options;
    render({ canRead: false });
    act(() => old.onSuccess({ id: 11 }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(container.textContent).toContain("客户查看权限不包含");
    runtime.fetched = false;
    render({ canRead: true });
    expect(container.textContent).not.toContain("SO-11");
  });
});

describe("customer response boundary", () => {
  it("accepts standalone unscoped results only while rejecting missing/wrong customer binding", () => {
    expect(customerMatches({}, undefined)).toBe(true);
    expect(customerMatches({}, 1)).toBe(false);
    expect(customerPageMatches({ items: [order(1), order(2)] }, 1)).toBe(false);
    expect(customerPageMatches({ items: [order(1)] }, 1)).toBe(true);
  });
});
