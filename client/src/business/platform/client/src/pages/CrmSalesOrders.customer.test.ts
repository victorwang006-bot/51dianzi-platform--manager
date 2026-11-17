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
  detailError: false,
  scope: "test-scope",
  currentScope: "test-scope",
  verified: true,
  authenticated: true,
  loginDisabled: false,
  authLoading: false,
  notices: vi.fn(),
  search: "?demandNo=UNRELATED-ROUTE&keyword=OTHER-CUSTOMER",
  lots: { items: [] as any[], total: 0 },
  preview: {} as any,
  draftServer: null as any,
  draftGet: vi.fn(),
  draftSave: vi.fn(),
  draftDelete: vi.fn(),
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
vi.mock("../../../../BusinessScope", () => ({
  useBusinessScope: () => ({
    merchantId: 1,
    storageScope: runtime.scope,
    frontUser: { id: 7 },
    contextVerification: {
      state: runtime.verified ? "verified" : "revalidating",
      authorizationVersion: 1,
      identity: runtime.scope,
    },
    staffPrincipal: { status: "ready", frontendUserId: 7 },
  }),
  businessStorageScope: () => runtime.currentScope,
}));
vi.mock("../../../../api/business-auth", () => ({
  useAuth: () => ({
    user: { id: 7, loginDisabled: runtime.loginDisabled },
    loading: runtime.authLoading,
    isAuthenticated: runtime.authenticated,
  }),
}));
vi.mock("../../../../../lib/adminNewInformation", () => ({
  useAdminNewInformationContextRows: (options: any) => {
    runtime.notices(options);
    return { getRow: () => ({ ref: () => undefined, isNew: false }) };
  },
  useAdminNewInformationRowContext: () => undefined,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/customers/1", runtime.navigate],
  useSearch: () => runtime.search,
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
          name === "companyStockCandidates"
            ? runtime.lots
            : name === "preview"
              ? runtime.preview
              : name === "context"
                ? {
                    canManageAll: false,
                    actorUserId: 7,
                    salesOrderPicker: { scope: "mine" },
                  }
                : name === "customers"
                  ? { items: [{ id: 1, name: "客户甲" }], total: 1 }
                  : name === "list"
                    ? runtime.list
                    : name === "candidates"
                      ? runtime.candidates
                      : runtime.detail,
        isLoading: false,
        isSuccess: true,
        isFetching: runtime.fetching,
        isPlaceholderData: false,
        isFetchedAfterMount: runtime.fetched,
        isError: name === "get" && runtime.detailError,
        error:
          name === "get" && runtime.detailError
            ? new Error("offline read failure")
            : null,
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
          orderDraftGet: { fetch: runtime.draftGet },
        },
      }),
      crmSalesOrder: {
        orderDraftSave: {
          useMutation: () => ({ mutateAsync: runtime.draftSave }),
        },
        orderDraftDelete: {
          useMutation: () => ({ mutateAsync: runtime.draftDelete }),
        },
        list: query("list"),
        get: query("get"),
        candidates: query("candidates"),
        create: mutation("create"),
        cancel: mutation("cancel"),
        recordPayment: mutation("payment"),
        ship: mutation("legacyShip"),
        shipCompanyStock: mutation("ship"),
        allocateCompanyStock: mutation("allocate"),
        companyStockCandidates: query("companyStockCandidates"),
        previewCompanyStock: query("preview"),
        createCompanyStock: mutation("companyCreate"),
        updateSalesExpenses: mutation("expenses"),
      },
      customer: { context: query("context"), list: query("customers") },
    },
  };
});
vi.mock("../components/ui/dialog", async importOriginal => {
  const { createContext, useContext } = await import("react");
  const Close = createContext<(open: boolean) => void>(() => undefined);
  return {
    ...(await importOriginal<typeof import("../components/ui/dialog")>()),
    Dialog: ({ open, children, onOpenChange }: any) =>
      open
        ? React.createElement(Close.Provider, { value: onOpenChange }, children)
        : null,
    DialogContent: ({ children, className, showCloseButton = true }: any) => {
      const onOpenChange = useContext(Close);
      return React.createElement(
        "div",
        { className, "data-dialog": true },
        children,
        showCloseButton
          ? React.createElement(
              "button",
              {
                onClick: () => onOpenChange(false),
                "aria-label": "关闭对话框",
              },
              "关闭对话框"
            )
          : null
      );
    },
    DialogHeader: ({ children }: any) =>
      React.createElement("header", null, children),
    DialogTitle: ({ children }: any) =>
      React.createElement("h2", null, children),
    DialogFooter: ({ children }: any) =>
      React.createElement("footer", null, children),
  };
});
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
import {
  loadSalesOrderDraft,
  saveSalesOrderDraft,
} from "../lib/salesOrderDraftStore";
import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";

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
  sourceType: "company_stock",
  salesTaxMode: "tax_included",
  salesExpenses: "0",
  companyStockAllocations: [
    {
      id: 51,
      orderId: 11,
      orderItemId: 31,
      lotId: 41,
      qty: 10,
      reservedQty: 9,
      consumedQty: 1,
      releasedQty: 0,
    },
  ],
  salesExpenseHistory: [],
  audits: [],
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
      deliveryRequirement: "",
      note: "",
    },
  ],
});
async function render(change: Partial<CustomerSalesOrdersProps> = {}) {
  props = { ...props, ...change };
  await act(async () => {
    root.render(React.createElement(CustomerSalesOrders, props));
  });
}
function button(text: string, scope: ParentNode = document.body) {
  const result = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => item.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  });
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
async function selectDemand() {
  await click(button("录入销售订单"));
  await click(button("选择"));
}
async function fillOrder() {
  await selectDemand();
  input('[aria-label="LM358 确认数量"]', "3");
  input('[aria-label="LM358 含税单价"]', "12.3456");
  input("#sales-order-due-date", "2026-12-01");
  input("#sales-order-confirmation", "客户电话确认数量、含税价格和交期");
  await click(document.querySelector('input[type="checkbox"]')!);
}
const draftIdentity = () => JSON.stringify([7, "native", runtime.scope]);
async function renderStandalone(reload = false) {
  runtime.search = "";
  runtime.memory = {};
  if (reload)
    await act(async () => {
      root.render(null);
    });
  await act(async () => {
    root.render(React.createElement(CrmSalesOrders));
  });
}
async function fillCompanyOrder() {
  await renderStandalone();
  await click(button("新建业务订单"));
  input('[aria-label="搜索有权限客户"]', "客户甲");
  await click(
    button("搜索", document.querySelector('[aria-label="订单客户"]')!)
  );
  await click(button("选择客户"));
  await click(document.querySelector(".company-lot-trigger")!);
  await click(document.querySelector('[data-company-lot="41"] button')!);
  input('[aria-label="批次 41 销售数量"]', "3");
  input('[aria-label="批次 41 销售单价"]', "12.3456");
  input('[aria-label="公司订单交期"]', "2026-12-01");
  input(
    '[aria-label="公司订单客户确认说明"]',
    "电话确认实物批次与数量价格交期"
  );
  await click(document.querySelector('input[type="checkbox"]')!);
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  runtime.draftServer = null;
  runtime.draftGet.mockImplementation(async () => runtime.draftServer);
  runtime.draftSave.mockImplementation(
    async ({ expectedRevision, payload }) => {
      const revision = runtime.draftServer?.revision ?? 0;
      if (expectedRevision !== revision)
        throw Object.assign(new Error("draft revision conflict"), {
          data: { code: "CONFLICT" },
        });
      runtime.draftServer = {
        draftId: 1,
        revision: revision + 1,
        payload,
        updatedAt: "now",
      };
      return { revision: revision + 1, updatedAt: "now" };
    }
  );
  runtime.draftDelete.mockImplementation(async ({ expectedRevision }) => {
    if (
      !runtime.draftServer?.payload ||
      expectedRevision !== runtime.draftServer.revision
    )
      throw Object.assign(new Error("draft delete conflict"), {
        data: { code: "CONFLICT" },
      });
    runtime.draftServer = {
      ...runtime.draftServer,
      revision: expectedRevision + 1,
      payload: null,
    };
    return { revision: runtime.draftServer.revision, updatedAt: "now" };
  });
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
  Object.assign(runtime, {
    detailError: false,
    scope: "test-scope",
    currentScope: "test-scope",
    verified: true,
    authenticated: true,
    loginDisabled: false,
    authLoading: false,
  });
  runtime.search = "?demandNo=UNRELATED-ROUTE&keyword=OTHER-CUSTOMER";
  runtime.lots = {
    items: [
      {
        lotId: 41,
        inboundOrderId: 51,
        partNumber: "LM358",
        brand: "TI",
        pkg: "SOIC",
        dc: "24+",
        location: "A-1",
        lotNumber: "LOT-41",
        availableQty: 8,
        version: 1,
      },
    ],
    total: 1,
  };
  runtime.preview = {
    totalAmount: "37.0368",
    currencyLabel: "人民币（含税）",
    profitBreakdown: {
      status: "unknown_cost",
      salesTaxMode: "tax_included",
      salesAmount: "37.0368",
      costAmount: null,
      expenseAmount: "0",
      grossProfit: null,
      taxDeductionAmount: null,
      netProfit: null,
    },
    commissionPreview: {
      estimatedAmount: null,
      earnedAmount: null,
      configPending: false,
      collectionStatus: "uncollected",
      reason: "成本待核",
    },
  };
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
  it("standalone compact page has one new-create entry and goes customer -> company lots -> real company create without a fake demand", async () => {
    runtime.search = "";
    runtime.memory = {};
    await act(async () => {
      root.render(React.createElement(CrmSalesOrders));
    });
    expect(container.querySelector("h1")).toBeNull();
    expect(
      Array.from(
        container.querySelectorAll(".crm-sales-orders-table th"),
        node => node.textContent?.trim()
      )
    ).toEqual([
      "订单号 / 日期",
      "客户",
      "物料摘要",
      "金额",
      "收款",
      "出货",
      "负责人",
      "操作",
    ]);
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        node => node.textContent?.trim() === "新建业务订单"
      )
    ).toHaveLength(1);
    await click(button("新建业务订单"));
    input('[aria-label="搜索有权限客户"]', "客户甲");
    await click(
      button("搜索", document.querySelector('[aria-label="订单客户"]')!)
    );
    await click(button("选择客户"));
    await click(document.querySelector(".company-lot-trigger")!);
    await click(document.querySelector('[data-company-lot="41"] button')!);
    input('[aria-label="批次 41 销售数量"]', "3");
    input('[aria-label="批次 41 销售单价"]', "12.3456");
    input(
      '[aria-label="公司订单客户确认说明"]',
      "电话确认实物批次与数量价格交期"
    );
    await click(document.querySelector('input[type="checkbox"]')!);
    await click(button("保存订单"));
    const payload = runtime.mutations.companyCreate.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      customerId: 1,
      items: [
        {
          qty: 3,
          agreedUnitPrice: "12.3456",
          allocations: [{ lotId: 41, qty: 3 }],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /demandItemId|demandId|inventoryId|ownerUserId|salesExpenses/
    );
  });
  it("requires explicit business-order read access and valid identity before mounting query hooks", async () => {
    await render({ canRead: false });
    expect(container.textContent).toContain("客户查看权限不包含销售订单权限");
    expect(runtime.inputs).toEqual([]);
    await render({ canRead: true, contextIdentityKey: null });
    expect(runtime.inputs).toEqual([]);
  });
  it("uses the original nine-column layout with a customer-only header, without independent remembered filters or route intents", async () => {
    await render();
    expect(container.querySelector("[data-platform-layout]")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("客户订单");
    expect(container.textContent).toContain("仅显示 客户甲 的内部业务订单");
    const table = container.querySelector(".crm-sales-orders-table")!;
    expect(
      Array.from(table.querySelectorAll("th"), item => item.textContent?.trim())
    ).toEqual([
      "订单号",
      "客户 / 需求",
      "项目",
      "金额（含税）",
      "状态",
      "收款",
      "出货",
      "录入时间",
      "操作",
    ]);
    expect(
      Array.from(table.querySelectorAll("col"), item => item.className)
    ).toEqual([
      "w-[14%]",
      "w-[18%]",
      "w-[8%]",
      "w-[10%]",
      "w-[9%]",
      "w-[10%]",
      "w-[9%]",
      "w-[8%]",
      "w-[14%]",
    ]);
    expect(table.querySelectorAll("tbody tr:first-child td")).toHaveLength(9);
    expect(
      table.querySelectorAll("tbody tr:first-child td")[1].textContent
    ).toContain("D-21");
    expect(
      table.querySelectorAll("tbody tr:first-child td")[2].textContent
    ).toBe("项目");
    expect(
      container.querySelector(".aui-filterbar")?.textContent
    ).not.toContain("录入销售订单");
    expect(container.textContent).not.toContain("成交确认 / 生成订单");
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
  it("passes exact customerId to every list, detail and demand query, independent of names/keywords", async () => {
    await render();
    await click(button("查看"));
    await click(button("关闭"));
    await click(button("录入销售订单"));
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
  it("refuses the entire mixed-customer list, including count, without locally filtering", async () => {
    runtime.list = {
      items: [order(), { ...order(2), orderNumber: "FOREIGN-ORDER" }],
      total: 901,
    };
    await render();
    expect(container.textContent).toContain("响应与当前客户或订单不一致");
    expect(container.textContent).not.toContain("SO-11");
    expect(container.textContent).not.toContain("FOREIGN-ORDER");
    expect(container.textContent).not.toContain("901");
  });
  it("refuses foreign demand candidates and foreign or mismatched-order details before writes", async () => {
    runtime.candidates = { items: [demand(2)], total: 1 };
    await render();
    await click(button("录入销售订单"));
    expect(document.body.textContent).toContain("响应与当前客户或订单不一致");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        el => el.textContent === "选择"
      )
    ).toBe(false);
    await click(button("收起"));
    runtime.detail = { ...order(2), confirmationNote: "FOREIGN-NOTE" };
    await click(button("查看"));
    expect(document.body.textContent).not.toContain("FOREIGN-NOTE");
    expect(document.body.textContent).toContain("响应与当前客户或订单不一致");
    await click(button("关闭"));
    runtime.detail = { ...order(), id: 99 };
    await click(button("收款"));
    expect(button("确认收款").disabled).toBe(true);
    await click(button("确认收款"));
    expect(runtime.mutations.payment.mutate).not.toHaveBeenCalled();
  });
  it.each([
    { readOnly: true },
    { canWrite: false },
    { customer: { id: 1, name: "客户甲", archivedAt: "2026-11-10" } },
  ])(
    "keeps archived/readOnly/insufficient-write sessions read-only: %j",
    async restriction => {
      await render(restriction);
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
      await click(button("查看"));
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
  it("handles one demand intent nonce in place and matches both demandNo and demandId", async () => {
    const onIntentHandled = vi.fn();
    await render({
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
      "我确认客户已明确同意以上数量、含税价格及约定交期"
    );
    await render();
    expect(onIntentHandled).toHaveBeenCalledTimes(1);
  });
  it("views demand-linked orders in-place under read-only permission without opening create", async () => {
    const onIntentHandled = vi.fn();
    await render({
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
  it("blocks replacing an active demand intent but permits ordinary navigation once its draft is durable", async () => {
    await render();
    await selectDemand();
    await render({
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
    let guarded = false;
    link.addEventListener("click", event => {
      guarded = event.defaultPrevented;
      event.preventDefault(); // Prevent only jsdom navigation, after the real capture guard.
    });
    document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => link.dispatchEvent(event));
    expect(guarded).toBe(false);
    expect(
      loadSalesOrderDraft(JSON.stringify([7, "native", runtime.scope]))?.payload
        .form?.selectedDemand
    ).toMatchObject({ id: 21 });
    link.remove();
  });
  it("does not silently auto-select a same-number demand with a different demandId", async () => {
    await render({
      intent: { demandNo: "D-21", demandId: 999, nonce: "mismatch" },
    });
    expect(document.querySelector('[aria-label="LM358 含税单价"]')).toBeNull();
    expect(toast.error).toHaveBeenCalled();
    expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
  });
  it("preserves true create payload, precision, demand revision, customer confirmation and idempotent retry", async () => {
    await render();
    await fillOrder();
    expect(document.body.textContent).toContain("¥37.0368");
    await click(button("保存订单"));
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
    await click(button("确认保存结果"));
    expect(runtime.mutations.create.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("requires explicit customer confirmation instead of adopting procurement prices", async () => {
    await render();
    await selectDemand();
    input('[aria-label="LM358 确认数量"]', "3");
    input('[aria-label="LM358 含税单价"]', "12");
    await click(button("保存订单"));
    expect(runtime.mutations.create.mutate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "请确认已与客户确认订单"
    );
  });
  it("preserves payment/monthly semantics and order version without requiring payment for partial shipment", async () => {
    await render();
    await click(button("收款"));
    input(".crm-sales-orders-dialog select", "monthly");
    input('.crm-sales-orders-dialog input[placeholder="含税金额"]', "12.3456");
    await click(button("确认收款"));
    expect(runtime.mutations.payment.mutate.mock.calls[0][0]).toMatchObject({
      id: 11,
      version: 7,
      method: "monthly",
      amount: "12.3456",
    });
    act(() => runtime.mutations.payment.options.onSuccess({ replayed: false }));
    await click(button("关闭"));
    await click(button("出货"));
    input(".crm-sales-orders-shipment-table input", "3");
    input(".crm-sales-orders-dialog select", "pickup");
    await click(button("确认出货"));
    expect(runtime.mutations.ship.mutate.mock.calls[0][0]).toMatchObject({
      id: 11,
      version: 7,
      deliveryMethod: "pickup",
      items: [{ orderItemId: 31, lotId: 41, qty: 3 }],
    });
    expect(props.onOrderChanged).toHaveBeenCalledTimes(1);
  });
  it("keeps cancelled-order business guard and exact cancellation version/reason", async () => {
    await render();
    await click(button("查看"));
    await click(button("取消订单"));
    input(".crm-sales-orders-cancel-reason textarea", "客户撤回订单");
    await click(button("确认取消订单"));
    expect(runtime.mutations.cancel.mutate).toHaveBeenCalledWith({
      id: 11,
      version: 7,
      reason: "客户撤回订单",
    });
  });
  it.each([{ paidAmount: "1" }, { monthlyAmount: "1" }, { shippedQty: 1 }])(
    "cannot cancel an already paid/monthly/shipped order: %j",
    async change => {
      runtime.detail = { ...order(), shippedQty: 0, ...change };
      await render();
      await click(button("查看"));
      expect(button("取消订单").disabled).toBe(true);
    }
  );
  it("retains a durable order on close without a discard tutorial, while still guarding unsaved payment drafts", async () => {
    await render();
    await selectDemand();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    const identity = JSON.stringify([7, "native", runtime.scope]);
    const saved = loadSalesOrderDraft(identity)?.payload;
    await click(button("收起"));
    expect(document.body.textContent).not.toContain("放弃本次录入");
    expect(loadSalesOrderDraft(identity)?.payload).toEqual(saved);
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    await click(button("录入销售订单"));
    expect(
      document.querySelector('[aria-label="LM358 确认数量"]')
    ).not.toBeNull();
    await click(button("收起"));
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    await click(button("收款"));
    input('.crm-sales-orders-dialog input[placeholder="含税金额"]', "2");
    await click(button("取消"));
    expect(window.confirm).toHaveBeenCalled();
    expect(document.body.textContent).toContain("确认收款");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("guards shipment and cancellation draft close and resets them only on confirmed abandonment", async () => {
    await render();
    await click(button("出货"));
    input(".crm-sales-orders-shipment-table input", "3");
    await click(button("取消"));
    expect(document.body.textContent).toContain("确认出货");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(button("取消"));
    expect(document.body.textContent).not.toContain("确认出货");
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    await click(button("取消订单"));
    input(".crm-sales-orders-cancel-reason textarea", "草稿");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click(button("返回"));
    expect(document.querySelector("[data-confirm]")).not.toBeNull();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("clears all drafts/selection/filters on customer or same-customer identity changes and ignores old async completions", async () => {
    await render();
    await fillOrder();
    await click(button("保存订单"));
    const old = runtime.mutations.create.options;
    runtime.list = { items: [order(2)], total: 1 };
    runtime.candidates = { items: [demand(2)], total: 1 };
    await render({
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
    await click(button("录入销售订单"));
    await click(button("选择"));
    await render({ contextIdentityKey: "enterprise:2:actor:9" });
    expect(document.querySelector('[aria-label="LM358 含税单价"]')).toBeNull();
  });
  it.each(["create", "payment", "ship", "cancel"])(
    "ignores stale %s completions on same-customer authorization identity replacement",
    async name => {
      await render();
      if (name === "ship") await click(button("出货"));
      const stale = runtime.mutations[name].options;
      await render({
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
  it("reports executing transactions as dirty and cannot discard entry during pending save", async () => {
    await render();
    await fillOrder();
    await click(button("保存订单"));
    runtime.mutations.create.pending = true;
    await render();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(button("收起").disabled).toBe(true);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
  });
  it("fails closed on permission loss and on cached data not yet proven fresh after mounting", async () => {
    await render();
    await selectDemand();
    const old = runtime.mutations.create.options;
    await render({ canRead: false });
    act(() => old.onSuccess({ id: 11 }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(container.textContent).toContain("客户查看权限不包含");
    runtime.fetched = false;
    await render({ canRead: true });
    expect(container.textContent).not.toContain("SO-11");
  });
  it("keeps the real ShipmentForm mounted and draft intact while get refetches, disables writes, and uses the fresh version afterwards", async () => {
    await render();
    await click(button("出货"));
    input('[aria-label="批次 41 本次出货"]', "3");
    const element = document.querySelector<HTMLInputElement>(
      '[aria-label="批次 41 本次出货"]'
    )!;
    runtime.fetching = true;
    await render();
    expect(document.querySelector('[aria-label="批次 41 本次出货"]')).toBe(
      element
    );
    expect(element.value).toBe("3");
    expect(element.disabled).toBe(true);
    await click(button("确认出货"));
    expect(runtime.mutations.ship.mutate).not.toHaveBeenCalled();
    runtime.fetching = false;
    runtime.detail = { ...order(), version: 8 };
    await render();
    expect(element.value).toBe("3");
    expect(element.disabled).toBe(false);
    input('[aria-label="公司出货交付方式"]', "pickup");
    await click(button("确认出货"));
    expect(runtime.mutations.ship.mutate.mock.calls[0][0]).toMatchObject({
      id: 11,
      version: 8,
      items: [{ orderItemId: 31, lotId: 41, qty: 3 }],
    });
  });
  it("keeps the shipment draft mounted after detail read failure, disabled until a fresh successful response", async () => {
    await render();
    await click(button("出货"));
    input('[aria-label="批次 41 本次出货"]', "3");
    const element = document.querySelector<HTMLInputElement>(
      '[aria-label="批次 41 本次出货"]'
    )!;
    runtime.detailError = true;
    await render();
    expect(document.querySelector('[aria-label="批次 41 本次出货"]')).toBe(
      element
    );
    expect(element.value).toBe("3");
    expect(element.disabled).toBe(true);
    expect(document.body.textContent).toContain("offline read failure");
    runtime.detailError = false;
    await render();
    expect(element.disabled).toBe(false);
  });
  it("discards shipment draft on business scope replacement, does not revive A draft on A -> B -> A, and ignores old completion", async () => {
    await render();
    await click(button("出货"));
    input('[aria-label="批次 41 本次出货"]', "3");
    const stale = runtime.mutations.ship.options;
    runtime.scope = "B";
    runtime.currentScope = "B";
    await render();
    expect(
      document.querySelector('[aria-label="批次 41 本次出货"]')
    ).toBeNull();
    runtime.scope = "test-scope";
    runtime.currentScope = "test-scope";
    await render();
    await click(button("出货"));
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 本次出货"]'
      )!.value
    ).toBe("");
    act(() => stale.onSuccess());
    expect(props.onOrderChanged).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("partial cash receipt retries the frozen original amount/requestId/version rather than a refreshed order", async () => {
    await render();
    await click(button("收款"));
    input(".crm-sales-orders-dialog select", "cash");
    input('.crm-sales-orders-dialog input[placeholder="含税金额"]', "2.3456");
    await click(button("确认收款"));
    const first = runtime.mutations.payment.mutate.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 11,
      version: 7,
      method: "cash",
      amount: "2.3456",
    });
    act(() =>
      runtime.mutations.payment.options.onError({
        message: "unknown timeout",
        data: { code: "INTERNAL_SERVER_ERROR" },
      })
    );
    runtime.detail = {
      ...order(),
      version: 99,
      paymentStatus: "partial",
      paidAmount: "2.3456",
    };
    await render();
    expect(
      document.querySelector<HTMLInputElement>('input[placeholder="含税金额"]')!
        .disabled
    ).toBe(true);
    await click(button("确认收款结果"));
    expect(runtime.mutations.payment.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("cancellation retries the unchanged native id/version/reason without fabricating a requestId", async () => {
    await render();
    await click(button("查看"));
    await click(button("取消订单"));
    input(".crm-sales-orders-cancel-reason textarea", "客户撤回订单");
    await click(button("确认取消订单"));
    const first = runtime.mutations.cancel.mutate.mock.calls[0][0];
    act(() => {
      runtime.mutations.cancel.options.onError({ message: "unknown timeout" });
      runtime.mutations.cancel.options.onSettled();
    });
    runtime.detail = { ...order(), version: 99 };
    await render();
    expect(
      document.querySelector<HTMLTextAreaElement>(
        ".crm-sales-orders-cancel-reason textarea"
      )!.disabled
    ).toBe(true);
    await click(button("确认取消订单"));
    expect(runtime.mutations.cancel.mutate.mock.calls[1][0]).toEqual(first);
    expect(first).toEqual({ id: 11, version: 7, reason: "客户撤回订单" });
  });
  it("does not inspect notification refs or allow new writes while identity/login is disabled", async () => {
    runtime.authenticated = false;
    await render();
    expect(runtime.notices.mock.calls.at(-1)?.[0]).toMatchObject({
      refs: [],
      listReady: false,
    });
    expect(
      [...container.querySelectorAll("button")].some(
        node => node.textContent === "收款" || node.textContent === "出货"
      )
    ).toBe(false);
    runtime.authenticated = true;
    runtime.verified = false;
    await render();
    expect(runtime.notices.mock.calls.at(-1)?.[0]).toMatchObject({
      refs: [],
      listReady: false,
    });
  });
});

describe("standalone durable order integration (real outer page and forms)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it.each(["tombstone", "newer draft"])(
    "verifies an original demand request under %s conflict without a draft write or a new request id",
    async kind => {
      await render();
      await fillOrder();
      await click(button("保存订单"));
      const original = runtime.mutations.create.mutate.mock.calls[0][0];
      const frozen = loadSalesOrderDraft(draftIdentity())!.payload;
      runtime.draftServer = {
        draftId: 1,
        revision: 8,
        updatedAt: "now",
        payload:
          kind === "tombstone"
            ? null
            : {
                source: "company_stock",
                customer: null,
                form: { customerSearch: "其他草稿" },
              },
      };
      const remote = runtime.draftServer;
      await renderStandalone(true);
      const saves = runtime.draftSave.mock.calls.length;
      expect(button("确认保存结果").disabled).toBe(false);
      await click(button("确认保存结果"));
      expect(runtime.mutations.create.mutate.mock.calls.at(-1)?.[0]).toEqual(
        original
      );
      expect(runtime.draftSave).toHaveBeenCalledTimes(saves);
      expect(runtime.draftServer).toEqual(remote);
      expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(frozen);
    }
  );
  it("retains an unchecked customer confirmation on close/reload without creating or reserving stock", async () => {
    await fillCompanyOrder();
    await click(document.querySelector('input[type="checkbox"]')!);
    const saved = loadSalesOrderDraft(draftIdentity())!.payload;
    expect(saved.company?.customerConfirmed).toBe(false);
    await click(button("收起"));
    await renderStandalone(true);
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked
    ).toBe(false);
    expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(saved);
    expect(runtime.mutations.companyCreate.mutate).not.toHaveBeenCalled();
    expect(runtime.mutations.allocate).toBeUndefined();
  });
  it("opens a verified tombstone as a usable empty new-order state and saves using its CAS token", async () => {
    runtime.draftServer = {
      draftId: 1,
      revision: 2,
      updatedAt: "now",
      payload: null,
    };
    await fillCompanyOrder();
    expect(button("保存订单").disabled).toBe(false);
    await click(button("保存订单"));
    expect(runtime.draftSave.mock.calls[0][0].expectedRevision).toBe(2);
    expect(runtime.mutations.companyCreate.mutate).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "timeout after commit"])(
    "starts a second same-page order with the returned tombstone revision after delete %s",
    async mode => {
      await fillCompanyOrder();
      await click(button("保存订单"));
      if (mode !== "success")
        runtime.draftDelete.mockImplementationOnce(
          async ({ expectedRevision }) => {
            runtime.draftServer = {
              ...runtime.draftServer,
              revision: expectedRevision + 1,
              payload: null,
            };
            throw new Error("timeout after delete commit");
          }
        );
      await act(async () => {
        runtime.mutations.companyCreate.options.onSuccess({
          id: 11,
          orderNumber: "XS-11",
        });
      });
      const revision = runtime.draftServer.revision;
      expect(runtime.draftServer.payload).toBeNull();
      expect(loadSalesOrderDraft(draftIdentity())).toBeNull();
      await fillCompanyOrder();
      await click(button("保存订单"));
      expect(runtime.draftSave.mock.calls.at(-1)?.[0].expectedRevision).toBe(
        revision
      );
      expect(runtime.mutations.companyCreate.mutate).toHaveBeenCalledTimes(2);
    }
  );
  it.each(["tombstone", "newer draft"])(
    "preserves and verifies the original company request on %s reload without saving over remote work",
    async kind => {
      await fillCompanyOrder();
      await click(button("保存订单"));
      const original = runtime.mutations.companyCreate.mutate.mock.calls[0][0];
      const frozen = loadSalesOrderDraft(draftIdentity())!.payload;
      runtime.draftServer = {
        draftId: 1,
        revision: 8,
        updatedAt: "now",
        payload:
          kind === "tombstone"
            ? null
            : {
                source: "company_stock",
                customer: null,
                form: { customerSearch: "另一页面" },
              },
      };
      const remote = runtime.draftServer;
      await renderStandalone(true);
      expect(document.body.textContent).toContain("本地原请求已保留");
      expect(button("重新读取草稿")).toBeTruthy();
      expect(button("确认保存结果").disabled).toBe(false);
      const saves = runtime.draftSave.mock.calls.length;
      await click(button("确认保存结果"));
      expect(runtime.draftSave).toHaveBeenCalledTimes(saves);
      expect(runtime.draftServer).toEqual(remote);
      expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(frozen);
      expect(
        runtime.mutations.companyCreate.mutate.mock.calls.at(-1)?.[0]
      ).toEqual(original);
      await act(async () => {
        runtime.mutations.companyCreate.options.onSuccess({
          id: 11,
          orderNumber: "XS-11",
        });
      });
      expect(runtime.draftDelete).not.toHaveBeenCalled();
      expect(runtime.draftServer).toEqual(remote);
      if (kind === "tombstone")
        expect(loadSalesOrderDraft(draftIdentity())).toBeNull();
      else
        expect(
          loadSalesOrderDraft(draftIdentity())?.payload.form?.completed
        ).toBe(true);
    }
  );
  it("reloads an old first-save0 draft under a later tombstone as blocked, not silently rebased", async () => {
    await renderStandalone();
    await click(button("新建业务订单"));
    input('[aria-label="搜索有权限客户"]', "旧首次草稿");
    expect(loadSalesOrderDraft(draftIdentity())?.revision).toBe(0);
    runtime.draftServer = {
      draftId: 1,
      revision: 2,
      updatedAt: "now",
      payload: null,
    };
    await renderStandalone(true);
    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="搜索有权限客户"]'
    )!;
    expect(search.value).toBe("旧首次草稿");
    expect(search.matches(":disabled")).toBe(true);
    expect(button("重新读取草稿")).toBeTruthy();
    expect(loadSalesOrderDraft(draftIdentity())?.revision).toBe(0);
    expect(runtime.draftSave).not.toHaveBeenCalled();
    expect(runtime.mutations.companyCreate).toBeUndefined();
  });
  it("persists incomplete customer search across close and a real page remount without auto-searching unproved rows", async () => {
    await renderStandalone();
    await click(button("新建业务订单"));
    input('[aria-label="搜索有权限客户"]', "客户名字填一半");
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.form?.customerSearch
    ).toBe("客户名字填一半");
    await click(button("关闭对话框"));
    expect(document.querySelector('[aria-label="搜索有权限客户"]')).toBeNull();
    await renderStandalone(true);
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="搜索有权限客户"]')
        ?.value
    ).toBe("客户名字填一半");
    expect(
      [...document.querySelectorAll("button")].some(
        el => el.textContent === "选择客户"
      )
    ).toBe(false);
    expect(runtime.mutations.companyCreate).toBeUndefined();
  });
  it("restores precise company lines and confirmation after close/remount before debounce and never creates an order on restore", async () => {
    await fillCompanyOrder();
    const saved = loadSalesOrderDraft(draftIdentity())?.payload;
    await click(button("收起"));
    expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(saved);
    await renderStandalone(true);
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售数量"]'
      )?.value
    ).toBe("3");
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售单价"]'
      )?.value
    ).toBe("12.3456");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="公司订单交期"]')
        ?.value
    ).toBe("2026-12-01");
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked
    ).toBe(true);
    expect(runtime.mutations.companyCreate.mutate).not.toHaveBeenCalled();
    expect(runtime.draftGet).toHaveBeenCalledTimes(2);
  });
  it("freezes the whole exact company request locally and awaits CAS durability before sending create", async () => {
    await fillCompanyOrder();
    const gate = deferred();
    runtime.draftSave.mockImplementationOnce(
      ({ payload, expectedRevision }) => {
        expect(expectedRevision).toBe(0);
        expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(payload);
        expect(payload.company.uncertain).toMatchObject({
          items: [
            {
              qty: 3,
              agreedUnitPrice: "12.3456",
              allocations: [{ lotId: 41, qty: 3 }],
            },
          ],
        });
        return gate.promise;
      }
    );
    await click(button("保存订单"));
    const frozen = loadSalesOrderDraft(draftIdentity())!.payload;
    expect(runtime.mutations.companyCreate.mutate).not.toHaveBeenCalled();
    expect(button("保存中…").disabled).toBe(true);
    expect(button("收起").disabled).toBe(true);
    await act(async () => {
      runtime.draftServer = { revision: 1, payload: frozen };
      gate.resolve({ revision: 1 });
    });
    expect(runtime.mutations.companyCreate.mutate).toHaveBeenCalledWith(
      frozen.company!.uncertain
    );
  });
  it("first definite company CONFLICT unlocks the original fields, retains fingerprint requestId, and permits a corrected quantity", async () => {
    await fillCompanyOrder();
    await click(button("保存订单"));
    const first = runtime.mutations.companyCreate.mutate.mock.calls[0][0];
    await act(async () => {
      runtime.mutations.companyCreate.options.onError({
        message: "批次数量不足",
        data: { code: "CONFLICT" },
      });
      runtime.mutations.companyCreate.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售数量"]'
      )?.disabled
    ).toBe(false);
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.company?.uncertain
    ).toBeNull();
    await click(button("保存订单"));
    expect(runtime.mutations.companyCreate.mutate.mock.calls[1][0]).toEqual(
      first
    );
    await act(async () => {
      runtime.mutations.companyCreate.options.onError({
        message: "仍然不足",
        data: { code: "CONFLICT" },
      });
      runtime.mutations.companyCreate.options.onSettled();
    });
    input('[aria-label="批次 41 销售数量"]', "2");
    await click(button("保存订单"));
    const corrected = runtime.mutations.companyCreate.mutate.mock.calls[2][0];
    expect(corrected.items[0].qty).toBe(2);
    expect(corrected.requestId).not.toBe(first.requestId);
  });
  it("company timeout followed by definite rejection stays locked and replays the identical full original payload", async () => {
    await fillCompanyOrder();
    await click(button("保存订单"));
    const first = runtime.mutations.companyCreate.mutate.mock.calls[0][0];
    await act(async () => {
      runtime.mutations.companyCreate.options.onError({
        message: "timeout",
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      runtime.mutations.companyCreate.options.onSettled();
    });
    await click(button("确认保存结果"));
    await act(async () => {
      runtime.mutations.companyCreate.options.onError({
        message: "拒绝",
        data: { code: "CONFLICT" },
      });
      runtime.mutations.companyCreate.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售数量"]'
      )?.disabled
    ).toBe(true);
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.company?.uncertain
    ).toEqual(first);
    await click(button("确认保存结果"));
    expect(runtime.mutations.companyCreate.mutate.mock.calls[2][0]).toEqual(
      first
    );
  });
  it("recovered company pending remains locked after even a first definite rejection in the new page", async () => {
    await fillCompanyOrder();
    await click(button("保存订单"));
    const first = runtime.mutations.companyCreate.mutate.mock.calls[0][0];
    await renderStandalone(true);
    await click(button("确认保存结果"));
    await act(async () => {
      runtime.mutations.companyCreate.options.onError({
        message: "权限变化",
        data: { code: "FORBIDDEN" },
      });
      runtime.mutations.companyCreate.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="批次 41 销售数量"]'
      )?.disabled
    ).toBe(true);
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.company?.uncertain
    ).toEqual(first);
  });
  it("success with failed draft delete cannot revive pending on remount, but another tab's newer draft survives", async () => {
    await fillCompanyOrder();
    await click(button("保存订单"));
    runtime.draftDelete.mockRejectedValueOnce(new Error("cleanup timeout"));
    await act(async () => {
      runtime.mutations.companyCreate.options.onSuccess({
        id: 11,
        orderNumber: "XS-11",
      });
    });
    expect(loadSalesOrderDraft(draftIdentity())?.payload.form?.completed).toBe(
      true
    );
    await renderStandalone(true);
    expect(document.querySelector("[data-company-stock-form]")).toBeNull();
    await click(button("新建业务订单"));
    expect(
      document.querySelector('[aria-label="搜索有权限客户"]')
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("另一页面草稿已更新");
  });
  it("success cleanup preserves a newer local draft written by another tab while delete is pending", async () => {
    await fillCompanyOrder();
    await click(button("保存订单"));
    const gate = deferred();
    runtime.draftDelete.mockImplementationOnce(() => gate.promise);
    await act(async () => {
      runtime.mutations.companyCreate.options.onSuccess({
        id: 11,
        orderNumber: "XS-11",
      });
    });
    const newer: SalesOrderDraftPayload = {
      source: "company_stock",
      customer: null,
      form: { customerSearch: "别的标签新客户" },
    };
    saveSalesOrderDraft(draftIdentity(), {
      payload: newer,
      revision: 2,
      savedAt: Date.now(),
      dirty: true,
    });
    await act(async () => {
      gate.resolve({ revision: 2 });
    });
    expect(loadSalesOrderDraft(draftIdentity())?.payload).toEqual(newer);
  });
  it("demand first definite BAD_REQUEST unlocks editing without changing the original fingerprint requestId", async () => {
    await render();
    await fillOrder();
    await click(button("保存订单"));
    const first = runtime.mutations.create.mutate.mock.calls[0][0];
    await act(async () => {
      runtime.mutations.create.options.onError({
        message: "需求数量不足",
        data: { code: "BAD_REQUEST" },
      });
      runtime.mutations.create.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="LM358 确认数量"]')
        ?.disabled
    ).toBe(false);
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.form?.pendingRequest
    ).toBeNull();
    await click(button("保存订单"));
    expect(runtime.mutations.create.mutate.mock.calls[1][0]).toEqual(first);
    await act(async () => {
      runtime.mutations.create.options.onError({
        message: "需求数量不足",
        data: { code: "CONFLICT" },
      });
      runtime.mutations.create.options.onSettled();
    });
    input('[aria-label="LM358 确认数量"]', "2");
    await click(button("保存订单"));
    expect(runtime.mutations.create.mutate.mock.calls[2][0].items[0].qty).toBe(
      2
    );
  });
  it("demand timeout then definite CONFLICT never discards the frozen request and survives real outer-page recovery", async () => {
    await render();
    await fillOrder();
    await click(button("保存订单"));
    const first = runtime.mutations.create.mutate.mock.calls[0][0];
    await act(async () => {
      runtime.mutations.create.options.onError({
        message: "timeout",
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      runtime.mutations.create.options.onSettled();
    });
    await click(button("确认保存结果"));
    await act(async () => {
      runtime.mutations.create.options.onError({
        message: "CONFLICT",
        data: { code: "CONFLICT" },
      });
      runtime.mutations.create.options.onSettled();
    });
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="LM358 确认数量"]')
        ?.disabled
    ).toBe(true);
    expect(
      loadSalesOrderDraft(draftIdentity())?.payload.form?.pendingRequest
    ).toEqual(first);
    await renderStandalone(true);
    await click(button("确认保存结果"));
    expect(runtime.mutations.create.mutate.mock.calls[2][0]).toEqual(first);
  });
});

describe("customer response boundary", () => {
  it("accepts standalone unscoped results only while rejecting missing/wrong customer binding", async () => {
    expect(customerMatches({}, undefined)).toBe(true);
    expect(customerMatches({}, 1)).toBe(false);
    expect(customerPageMatches({ items: [order(1), order(2)] }, 1)).toBe(false);
    expect(customerPageMatches({ items: [order(1)] }, 1)).toBe(true);
  });
});
