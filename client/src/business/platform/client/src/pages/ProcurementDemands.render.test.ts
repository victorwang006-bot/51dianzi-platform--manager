// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import type {
  ProcurementDemandDetail,
  ProcurementDemandSummary,
} from "../../../shared/customerDemands";

const runtime = vi.hoisted(() => ({
  list: undefined as
    | {
        items: ProcurementDemandSummary[];
        total: number;
        page: number;
        pageSize: number;
      }
    | undefined,
  detail: undefined as ProcurementDemandDetail | undefined,
  detailError: null as Error | null,
  listQuery: vi.fn(),
  detailQuery: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  quoteList: vi.fn(),
  quoteDialog: vi.fn(),
  rowsHook: vi.fn(),
  newIds: new Set<string>(),
  rowElements: new Map<string, HTMLElement | null>(),
  memoryReady: true,
  queryState: {} as Record<string, any>,
  inputPage: false,
  identity: "mock:actor:7",
  authorization: "grant:1",
  initialState: {} as Record<string, unknown>,
  peek: undefined as any,
  peekState: {} as Record<string, any>,
  peekQuery: vi.fn(),
  peekOptions: vi.fn(),
  peekRefresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../hooks/usePageMemory", async () => {
  const React = await import("react");
  return {
    usePageMemory: () => runtime.memoryReady,
    useRememberedState: (_key: string, initial: unknown) =>
      React.useState(() => runtime.initialState[_key] ?? initial),
    freshListOptions: (options: object) => options,
    useRestoringListQuery: (query: unknown) => query,
    returnToPageSource: vi.fn(),
  };
});
vi.mock("../../../../BusinessScope", () => ({
  useBusinessScope: () => ({
    storageScope: runtime.identity,
    contextVerification: { authorizationVersion: runtime.authorization },
  }),
}));
vi.mock("../../../../BusinessContentFrame", () => ({
  default: ({ children }: React.PropsWithChildren) =>
    h(React.Fragment, null, children),
}));
vi.mock("../../../../api/business-trpc", () => ({
  trpc: {
    customerDemand: {
      procurementList: {
        useQuery: (
          input: {
            pageSize: number;
            page: number;
            newSince?: { id: number } | null;
          },
          options: object
        ) => {
          if (input.pageSize === 1) {
            runtime.peekQuery(input);
            runtime.peekOptions(options);
            return {
              data: runtime.peek && {
                ...runtime.peek,
                ...(input.newSince?.id === runtime.peek.latestSubmission?.id
                  ? { newCount: 0 }
                  : {}),
              },
              dataUpdatedAt: 1,
              isSuccess: true,
              isFetching: false,
              isFetchedAfterMount: true,
              error: null,
              refetch: runtime.peekRefresh,
              ...runtime.peekState,
            };
          }
          runtime.listQuery(input);
          return {
            data:
              runtime.inputPage && runtime.list
                ? { ...runtime.list, page: input.page }
                : runtime.list,
            isLoading: false,
            isFetching: false,
            isSuccess: true,
            isError: false,
            isPlaceholderData: false,
            isFetchedAfterMount: true,
            dataUpdatedAt: 1,
            error: null,
            refetch: runtime.refresh,
            ...runtime.queryState,
          };
        },
      },
      procurementGet: {
        useQuery: (input: object) => {
          runtime.detailQuery(input);
          return {
            data: runtime.detail,
            isLoading: false,
            isSuccess: true,
            isFetchedAfterMount: true,
            error: runtime.detailError,
          };
        },
      },
    },
  },
}));
vi.mock("../../../../../lib/adminNewInformation", () => ({
  useAdminNewInformationContextRows: (options: {
    refs: string[];
    listReady: boolean;
  }) => {
    runtime.rowsHook(options);
    return {
      getRow: (id: string) => ({
        isNew: options.listReady && runtime.newIds.has(id),
        ref: (element: HTMLElement | null) =>
          runtime.rowElements.set(id, element),
      }),
    };
  },
  useAdminNewInformationRowContext: () => undefined,
}));
vi.mock("../components/ui/dialog", () => ({
  Dialog: ({ children }: React.PropsWithChildren) =>
    h(React.Fragment, null, children),
  DialogContent: ({ children }: React.PropsWithChildren) =>
    h("section", { role: "dialog" }, children),
  DialogTitle: ({ children }: React.PropsWithChildren) =>
    h("h2", null, children),
  DialogDescription: ({ children }: React.PropsWithChildren) =>
    h("p", null, children),
  useDialogComposition: () => null,
}));
vi.mock("../components/customerDemands/DemandQuoteList", () => ({
  DemandQuoteList: (props: {
    demandId: number;
    audience: string;
    onCreate: () => void;
    onEdit: (id: number) => void;
  }) => {
    runtime.quoteList(props);
    return h(
      "div",
      null,
      h("button", { onClick: props.onCreate }, "合成新增报价"),
      h("button", { onClick: () => props.onEdit(501) }, "合成编辑报价")
    );
  },
}));
vi.mock("../components/customerDemands/DemandQuoteDialog", () => ({
  DemandQuoteDialog: (props: {
    demandId: number;
    quoteId?: number;
    onSaved: () => void;
    onClose: () => void;
  }) => {
    runtime.quoteDialog(props);
    return h(
      "section",
      { "data-test-quote-dialog": true },
      h("button", { onClick: props.onSaved }, "合成保存报价"),
      h("button", { onClick: props.onClose }, "合成关闭报价")
    );
  },
}));
import ProcurementDemands from "./ProcurementDemands";

function summary(): ProcurementDemandSummary {
  return {
    id: 41,
    demandNo: "SYNTHETIC-XQ-41",
    projectName: "合成项目",
    priority: "normal",
    status: "submitted",
    createdByUserId: 7,
    salesName: "合成销售",
    procurementUserId: null,
    procurementName: "",
    itemCount: 4,
    version: 3,
    revision: 2,
    replyDueAt: "2026-11-16T00:00:00Z",
    submittedAt: "2026-11-14T01:04:00Z",
    createdAt: "2026-11-14T01:04:00Z",
    updatedAt: "2026-11-14T01:04:00Z",
    firstPartNumber: "SYNTHETIC-401",
    firstBrand: "TEST1",
    firstQty: 100,
    firstQtyUnit: "片",
    firstDeliveryRequirement: "2天",
    myActiveQuoteCount: 1,
    mySupplierCount: 1,
    myQuoteRoundCount: 2,
    currentQuoteCount: 1,
  };
}
function detail(): ProcurementDemandDetail {
  return {
    ...summary(),
    note: "合成需求说明第一行\n第二行",
    items: [
      {
        id: 401,
        partNumber: "SYNTHETIC-401",
        brand: "TEST1",
        pkg: "PKG1",
        qty: 100,
        qtyUnit: "片",
        deliveryRequirement: "2天",
        note: "第一项备注",
      },
      {
        id: 402,
        partNumber: "SYNTHETIC-402",
        brand: "TEST2",
        pkg: "PKG2",
        qty: 2500,
        qtyUnit: "个",
        deliveryRequirement: "5天",
        note: "第二项备注\n保留换行",
      },
      {
        id: 403,
        partNumber: "SYNTHETIC-403",
        brand: "TEST3",
        pkg: "PKG3",
        qty: null,
        qtyUnit: "片",
        deliveryRequirement: "待确认",
        note: "第三项备注",
      },
      {
        id: 404,
        partNumber: "SYNTHETIC-404",
        brand: "TEST4",
        pkg: "PKG4",
        qty: 9,
        qtyUnit: "套",
        deliveryRequirement: "一周",
        note: "第四项备注",
      },
    ],
  };
}
let root: Root;
let host: HTMLDivElement;
function render() {
  act(() => root.render(h(ProcurementDemands)));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    node =>
      node.textContent?.trim() === label ||
      node.getAttribute("aria-label") === label
  );
  if (!button) throw new Error(`Missing procurement button ${label}`);
  await act(async () => button.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks();
  runtime.detailError = null;
  runtime.newIds.clear();
  runtime.rowElements.clear();
  runtime.memoryReady = true;
  runtime.queryState = {};
  runtime.identity = "mock:actor:7";
  runtime.authorization = "grant:1";
  runtime.initialState = {};
  runtime.inputPage = false;
  runtime.peek = undefined;
  runtime.peekState = {};
  runtime.list = { items: [summary()], total: 22, page: 2, pageSize: 20 };
  runtime.detail = detail();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "Production network forbidden in synthetic procurement fixtures"
      );
    })
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("采购需求摘要与完整物料详情", () => {
  it("keeps first-item summary, original metadata and actual total/page without N+1 detail reads", () => {
    render();
    expect(runtime.listQuery).toHaveBeenLastCalledWith({
      view: "all",
      sort: "latest",
      keyword: "",
      page: 2,
      pageSize: 20,
    });
    expect(runtime.detailQuery).not.toHaveBeenCalled();
    expect(host.textContent).toContain("共 22 条 · 第 2/2 页");
    for (const value of [
      "SYNTHETIC-401",
      "TEST1",
      "100片",
      "2天",
      "合成销售",
      "1家 · 累计2轮",
      "09:04",
    ])
      expect(host.textContent).toContain(value);
    expect(host.textContent).not.toContain("SYNTHETIC-402");
    expect(host.textContent).toContain("共4项 · 查看全部物料");
  });
  it("opens every persisted material with project, quantities, delivery, package, row notes and demand notes", async () => {
    render();
    await click("共4项 · 查看全部物料");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 41 });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("物料明细（共4项）");
    expect(dialog?.textContent).toContain("合成项目");
    expect(dialog?.textContent).toContain("2026-11-16 08:00");
    const rows = [
      ...(dialog?.querySelectorAll(".procurement-demand-items tbody tr") ?? []),
    ];
    expect(rows).toHaveLength(4);
    for (const [index, item] of detail().items.entries()) {
      const cells = [...rows[index].querySelectorAll("td")].map(
        cell => cell.textContent
      );
      expect(cells).toEqual([
        item.partNumber,
        item.brand,
        item.pkg,
        item.qty == null ? "待确认" : item.qty.toLocaleString("zh-CN"),
        item.qtyUnit,
        item.deliveryRequirement,
        item.note,
      ]);
    }
    expect(
      rows[1]
        .querySelector("td:last-child")
        ?.classList.contains("whitespace-pre-wrap")
    ).toBe(true);
    expect(dialog?.textContent).toContain("合成需求说明第一行\n第二行");
    expect(runtime.quoteList).toHaveBeenCalledWith(
      expect.objectContaining({ demandId: 41, audience: "procurement" })
    );
  });
  it("the demand-number text detail action uses the same full-detail API and closes without mutations", async () => {
    render();
    await click("查看需求 SYNTHETIC-XQ-41 详情");
    expect(
      host.querySelectorAll(".procurement-demand-items tbody tr")
    ).toHaveLength(4);
    await click("关闭");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.refresh).not.toHaveBeenCalled();
    expect(runtime.quoteDialog).not.toHaveBeenCalled();
  });
  it("keeps quote create/edit binding to the selected demand and refreshes the list on save", async () => {
    render();
    await click("共4项 · 查看全部物料");
    await click("合成编辑报价");
    expect(runtime.quoteDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ demandId: 41, quoteId: 501 })
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click("合成保存报价");
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
    await click("合成关闭报价");
    await click("新增报价");
    expect(runtime.quoteDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ demandId: 41 })
    );
    expect(runtime.quoteDialog.mock.calls.at(-1)?.[0].quoteId).toBeUndefined();
  });
  it("does not fabricate full material data from a list summary when the detail read fails", async () => {
    runtime.detail = undefined;
    runtime.detailError = new Error("合成权限拒绝");
    render();
    await click("共4项 · 查看全部物料");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "合成权限拒绝"
    );
    expect(host.querySelector(".procurement-demand-items")).toBeNull();
    expect(runtime.quoteList).not.toHaveBeenCalled();
  });
  it("does not expose multi-material shortcut for a single item and still preserves the demand-number detail entry", async () => {
    runtime.list!.items = [{ ...summary(), itemCount: 1 }];
    render();
    expect(host.textContent).not.toContain("查看全部物料");
    await click("查看需求 SYNTHETIC-XQ-41 详情");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 41 });
  });
  it("binds the canonical demand ref to the actual displayed tr and renders a small 新, never a detail/material witness", async () => {
    runtime.newIds.add("demand:41");
    render();
    expect(runtime.rowsHook).toHaveBeenLastCalledWith({
      module: "procurement",
      refs: ["demand:41"],
      listReady: true,
    });
    const row = runtime.rowElements.get("demand:41");
    expect(row?.tagName).toBe("TR");
    expect(row?.dataset.pageMemoryRow).toBe("41");
    expect(row?.querySelector('[role="status"]')?.textContent).toBe("新");
    await click("查看需求 SYNTHETIC-XQ-41 详情");
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0].refs).toEqual(["demand:41"]);
    expect(runtime.rowElements.has("demand:401")).toBe(false);
  });
  it("preserves server order even when a later page-local row has a new notification badge", () => {
    runtime.list!.items = [
      summary(),
      { ...summary(), id: 42, demandNo: "SYNTHETIC-XQ-42" },
      { ...summary(), id: 43, demandNo: "SYNTHETIC-XQ-43" },
    ];
    runtime.newIds.add("demand:42");
    runtime.newIds.add("demand:999");
    render();
    expect(
      [...host.querySelectorAll("tbody tr[data-page-memory-row]")].map(row =>
        row.getAttribute("data-page-memory-row")
      )
    ).toEqual(["41", "42", "43"]);
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0].refs).toEqual([
      "demand:41",
      "demand:42",
      "demand:43",
    ]);
    expect(host.textContent).toContain("共 22 条 · 第 2/2 页");
    expect(runtime.detailQuery).not.toHaveBeenCalled();
    expect(runtime.refresh).not.toHaveBeenCalled();
  });
  it.each([
    { isSuccess: false },
    { isError: true },
    { isFetching: true },
    { isPlaceholderData: true },
    { isFetchedAfterMount: false },
  ])("supplies no receipts/refs during unready list state %j", queryState => {
    runtime.queryState = queryState;
    runtime.newIds.add("demand:41");
    render();
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0]).toMatchObject({
      refs: [],
      listReady: false,
    });
    expect(host.querySelector('tr [role="status"]')).toBeNull();
  });
  it("supplies no receipts for an inactive current business identity", () => {
    runtime.memoryReady = false;
    render();
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0]).toMatchObject({
      refs: [],
      listReady: false,
    });
  });
});

function change(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(
    selector
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      node.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function lastMain() {
  return runtime.listQuery.mock.calls.at(-1)?.[0];
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("采购新排序、条件记忆、授权与增量提醒", () => {
  beforeEach(() => {
    runtime.inputPage = true;
  });
  it("restores urgent/view/applied keyword/page and distinguishes the unsubmitted draft", async () => {
    runtime.initialState = {
      view: "reconfirm",
      sort: "urgent",
      keyword: "OLD",
      keywordInput: "NEW",
      page: 3,
    };
    runtime.list!.page = 3;
    render();
    expect(lastMain()).toEqual({
      view: "reconfirm",
      sort: "urgent",
      keyword: "OLD",
      page: 3,
      pageSize: 20,
    });
    expect(
      host.querySelector('[aria-label="已应用采购条件"]')?.textContent
    ).toContain("搜索“OLD”");
    expect(host.textContent).toContain("输入尚未应用");
    await click("查看最新");
    expect(lastMain()).toMatchObject({
      view: "all",
      sort: "latest",
      keyword: "",
      page: 1,
    });
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
  });
  it.each([
    ["mine", "quoted"],
    ["unassigned", "unquoted"],
  ])(
    "keeps remembered legacy view %s as its authorized quote-state alias",
    (legacy, expected) => {
      runtime.initialState = { view: legacy };
      render();
      expect(lastMain().view).toBe(expected);
    }
  );
  it("sort selection is sent to the server and goes to page 1 without local notification ordering", () => {
    runtime.initialState = { sort: "urgent", page: 2 };
    render();
    change('[aria-label="采购需求排序"]', "latest");
    expect(lastMain()).toMatchObject({ sort: "latest", page: 1 });
  });
  it("renders the second matched item and one-based position while retaining every material in detail", async () => {
    runtime.list!.items = [
      {
        ...summary(),
        matchedItem: {
          index: 2,
          partNumber: "SYNTHETIC-402",
          brand: "TEST2",
          qty: 2500,
          qtyUnit: "个",
          deliveryRequirement: "5天",
        },
      },
    ];
    render();
    expect(host.textContent).toContain("SYNTHETIC-402");
    expect(host.textContent).toContain("2,500个");
    expect(host.textContent).not.toContain("SYNTHETIC-401");
    expect(host.textContent).toContain("命中第2项 / 共4项");
    await click("查看需求 SYNTHETIC-XQ-41 的全部4项物料");
    expect(
      host.querySelectorAll(".procurement-demand-items tbody tr")
    ).toHaveLength(4);
  });
  it("preserves the last successful table on an ordinary refresh failure and detects nonthrowing refetch errors", async () => {
    render();
    runtime.queryState = {
      isSuccess: false,
      isError: true,
      error: new Error("synthetic refresh unavailable"),
    };
    render();
    expect(host.textContent).toContain("暂未更新");
    expect(host.querySelector("tbody")?.textContent).toContain("SYNTHETIC-401");
    await click("重试刷新");
    expect(runtime.refresh).toHaveBeenCalled();
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0].refs).toEqual([]);
  });
  it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"])(
    "immediately hides cached main/detail/quote data on %s",
    code => {
      render();
      runtime.queryState = {
        isSuccess: false,
        isError: true,
        error: Object.assign(new Error("synthetic authorization loss"), {
          data: { code },
        }),
      };
      render();
      expect(host.querySelector("tbody")).toBeNull();
      expect(host.textContent).toContain("授权已失效");
      expect(host.textContent).not.toContain("SYNTHETIC-401");
      expect(runtime.rowsHook.mock.calls.at(-1)?.[0].refs).toEqual([]);
      expect(runtime.peekQuery.mock.calls.at(-1)?.[0]).not.toHaveProperty(
        "newSince"
      );
    }
  );
  it("first peek only sets an empty baseline; null newSince detects the very first authorized arrival by server count", async () => {
    runtime.inputPage = true;
    runtime.peek = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
      latestSubmission: null,
    };
    render();
    await settle();
    expect(runtime.peekQuery.mock.calls[0][0]).toEqual({
      view: "all",
      keyword: "",
      sort: "latest",
      page: 1,
      pageSize: 1,
    });
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0]).toMatchObject({
      newSince: null,
    });
    expect(runtime.peekOptions.mock.calls.at(-1)?.[0]).toMatchObject({
      enabled: true,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    });
    runtime.peek = {
      ...runtime.peek,
      total: 999,
      latestSubmission: { id: 99, submittedAt: "2026-11-22T01:00:00.000Z" },
      newCount: 3,
    };
    render();
    await settle();
    expect(host.textContent).toContain("有 3 条新需求");
    expect(host.textContent).not.toContain("有 999 条新需求");
    expect(runtime.refresh).not.toHaveBeenCalled();
    expect(host.querySelector('[data-page-memory-row="41"]')).not.toBeNull();
    await click("查看最新需求");
    expect(lastMain()).toMatchObject({
      view: "all",
      sort: "latest",
      keyword: "",
      page: 1,
    });
    expect(host.textContent).toContain("有 3 条新需求");
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0].newSince).toBeNull();
    runtime.list = {
      ...runtime.list!, page: 1,
      items: [{ ...summary(), id: 99, demandNo: "SYNTHETIC-XQ-99", submittedAt: runtime.peek.latestSubmission.submittedAt }],
      latestSubmission: runtime.peek.latestSubmission,
    };
    runtime.queryState = { dataUpdatedAt: Date.now() + 1 };
    render();
    await settle();
    expect(host.textContent).not.toContain("有 3 条新需求");
  });
  it("does not acknowledge unseen arrivals on latest click or failed main refresh; only a new successful main cursor advances the baseline", async () => {
    const oldCursor = { id: 41, submittedAt: "2026-11-14T01:04:00.000Z" };
    const newCursor = { id: 99, submittedAt: "2026-11-22T01:00:00.000Z" };
    runtime.list = { ...runtime.list!, page: 1, latestSubmission: oldCursor };
    runtime.peek = { ...runtime.list, pageSize: 1 };
    render();
    await settle();
    runtime.peek = { ...runtime.peek, latestSubmission: newCursor, newCount: 3 };
    render();
    await settle();
    expect(host.textContent).toContain("有 3 条新需求");
    runtime.refresh.mockResolvedValueOnce({ isError: true, error: new Error("synthetic refresh failure") });
    await click("查看最新需求");
    expect(runtime.refresh).toHaveBeenCalled();
    expect(host.textContent).toContain("有 3 条新需求");
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0].newSince).toEqual(oldCursor);
    runtime.queryState = { isSuccess: false, isError: true, error: new Error("synthetic main read failure") };
    render();
    await settle();
    expect(host.textContent).toContain("有 3 条新需求");
    expect(host.querySelector('[data-page-memory-row="41"]')).not.toBeNull();
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0].newSince).toEqual(oldCursor);
    runtime.list = {
      ...runtime.list!, latestSubmission: newCursor,
      items: [{ ...summary(), id: 99, demandNo: "SYNTHETIC-XQ-99", submittedAt: newCursor.submittedAt }],
    };
    runtime.queryState = { dataUpdatedAt: Date.now() + 1 };
    render();
    await settle();
    expect(host.textContent).not.toContain("有 3 条新需求");
    expect(host.querySelector('[data-page-memory-row="99"]')).not.toBeNull();
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0].newSince).toEqual(newCursor);
  });
  it("baseline cursor is not advanced by repeated peeks and identity/authorization generations discard old arrivals and read proof", async () => {
    const cursor = { id: 41, submittedAt: "2026-11-14T01:04:00.000Z" };
    runtime.peek = {
      items: [],
      total: 40,
      page: 1,
      pageSize: 1,
      latestSubmission: cursor,
    };
    render();
    await settle();
    runtime.peek = {
      ...runtime.peek,
      latestSubmission: { ...cursor, id: 42 },
      newCount: 8,
    };
    render();
    await settle();
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0].newSince).toEqual(cursor);
    expect(host.textContent).toContain("有 8 条新需求");
    runtime.authorization = "grant:2";
    runtime.queryState = { isFetching: true, isFetchedAfterMount: false };
    render();
    expect(host.querySelector("tbody")).toBeNull();
    expect(host.textContent).not.toContain("有 8 条新需求");
    expect(runtime.peekQuery.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "newSince"
    );
    runtime.identity = "mock:actor:8";
    render();
    expect(host.querySelector("tbody")).toBeNull();
  });
  it("peek stays disabled while hidden, identity-unready, or main first-read has no current proof", async () => {
    runtime.queryState = { isFetching: true, isFetchedAfterMount: false };
    render();
    expect(runtime.peekOptions.mock.calls.at(-1)?.[0].enabled).toBe(false);
    runtime.queryState = {};
    render();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    expect(runtime.peekOptions.mock.calls.at(-1)?.[0]).toMatchObject({
      enabled: false,
      refetchInterval: false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    runtime.memoryReady = false;
    render();
    expect(runtime.peekOptions.mock.calls.at(-1)?.[0].enabled).toBe(false);
  });
  it("peek authorization failure hides the old main table and new-count evidence", async () => {
    runtime.peek = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
      latestSubmission: null,
    };
    render();
    await settle();
    runtime.peekState = {
      isError: true,
      error: Object.assign(new Error("synthetic denied peek"), {
        data: { code: "FORBIDDEN" },
      }),
    };
    render();
    await settle();
    expect(host.querySelector("tbody")).toBeNull();
    expect(runtime.rowsHook.mock.calls.at(-1)?.[0].refs).toEqual([]);
  });
  it("uses exactly one row-level quote primary action; reconfirm enters controlled detail instead of guessing a quote ID; exports real mock DOM", async () => {
    runtime.list!.items = [
      summary(),
      {
        ...summary(),
        id: 42,
        demandNo: "SYNTHETIC-XQ-42",
        firstPartNumber:
          "LONG-MODEL-SYNTHETIC-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789",
        firstBrand: "合成超长品牌名称用于几何核验",
        myQuoteNeedsReconfirmation: true,
        mySupplierCount: 0,
        myQuoteId: 999,
      },
      {
        ...summary(),
        id: 43,
        demandNo: "SYNTHETIC-XQ-43",
        status: "draft",
        priority: "urgent",
        myActiveQuoteCount: 0,
        mySupplierCount: 0,
        firstQty: null,
      },
      {
        ...summary(),
        id: 44,
        demandNo: "SYNTHETIC-XQ-44",
        matchedItem: {
          index: 2,
          partNumber: "SEARCH-SECOND-MATERIAL",
          brand: "MOCK-BRAND",
          qty: 2500,
          qtyUnit: "个",
          deliveryRequirement: "待确认 · 长交期说明不会裁剪",
        },
      },
    ];
    runtime.newIds.add("demand:41");
    render();
    for (const row of host.querySelectorAll("tbody tr"))
      expect(row.querySelectorAll("td:last-child button")).toHaveLength(1);
    expect(
      host
        .querySelector('[data-page-memory-row="43"] td:last-child button')
        ?.hasAttribute("disabled")
    ).toBe(true);
    expect(host.textContent).toContain("旧版报价待重新确认");
    const output =
      "/home/ubuntu/work/demand-redesign-implementation-20261122-1302/frontend/dom-fixture.html";
    mkdirSync(output.slice(0, output.lastIndexOf("/")), { recursive: true });
    writeFileSync(
      output,
      `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>采购组件隔离DOM fixture</title></head><body>${host.innerHTML}</body></html>\n`
    );
    await click("更新报价");
    expect(runtime.detailQuery).toHaveBeenCalledWith({ id: 42 });
    expect(runtime.quoteDialog).not.toHaveBeenCalled();
    runtime.queryState = { isFetching: true };
    render();
    await click("关闭");
    expect(
      host
        .querySelector('[data-page-memory-row="41"] td:last-child button')
        ?.hasAttribute("disabled")
    ).toBe(true);
  });
});
