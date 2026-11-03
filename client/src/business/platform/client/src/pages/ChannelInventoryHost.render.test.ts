// @vitest-environment jsdom
import React, { act } from "react";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostStyles = readFileSync(
  resolve(process.cwd(), "client/src/business/platform/client/src/pages/ChannelInventoryHost.css"),
  "utf8",
);

const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    channelInputs: [] as unknown[],
    materialInputs: [] as unknown[],
    sharedInputs: [] as unknown[],
    optionInputs: [] as unknown[],
    getChannelInputs: [] as unknown[],
    notesInputs: [] as unknown[],
    createChannel: vi.fn().mockResolvedValue({ idempotent: false }),
    updateChannel: vi.fn().mockResolvedValue({}),
    setChannelActive: vi.fn().mockResolvedValue({}),
    createMaterial: vi.fn().mockResolvedValue({ idempotent: false }),
    updateMaterial: vi.fn().mockResolvedValue({}),
    setMaterialShare: vi.fn().mockResolvedValue({}),
    enterpriseMe: null as unknown,
    channelQuery: null as unknown,
    getChannelQuery: null as unknown,
    materialQuery: null as unknown,
    sharedQuery: null as unknown,
    notesQuery: null as unknown,
    utils: {
      channelInventory: {
        listChannels: { invalidate },
        listSharedMaterials: { invalidate },
        listMaterials: { invalidate },
        notesList: { invalidate },
      },
    },
  };
});

vi.mock("../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: {
      me: { useQuery: () => runtime.enterpriseMe },
    },
    channelInventory: {
      listChannels: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) {
            const pageSize = (input as { pageSize?: number }).pageSize;
            (pageSize === 100 ? runtime.optionInputs : runtime.channelInputs).push(input);
          }
          return runtime.channelQuery;
        },
      },
      getChannel: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.getChannelInputs.push(input);
          return runtime.getChannelQuery;
        },
      },
      listSharedMaterials: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.sharedInputs.push(input);
          return runtime.sharedQuery;
        },
      },
      listMaterials: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.materialInputs.push(input);
          return runtime.materialQuery;
        },
      },
      createChannel: { useMutation: () => ({ isPending: false, mutateAsync: runtime.createChannel }) },
      updateChannel: { useMutation: () => ({ isPending: false, mutateAsync: runtime.updateChannel }) },
      setChannelActive: { useMutation: () => ({ isPending: false, mutateAsync: runtime.setChannelActive }) },
      createMaterial: { useMutation: () => ({ isPending: false, mutateAsync: runtime.createMaterial }) },
      updateMaterial: { useMutation: () => ({ isPending: false, mutateAsync: runtime.updateMaterial }) },
      setMaterialShare: { useMutation: () => ({ isPending: false, mutateAsync: runtime.setMaterialShare }) },
      notesList: {
        useQuery: (input: unknown) => {
          runtime.notesInputs.push(input);
          return runtime.notesQuery;
        },
      },
      notesAdd: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      notesEdit: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  },
}));

import ChannelInventoryHost from "./ChannelInventoryHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function query<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: new Error("fixture query error"),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function button(name: string) {
  return required(
    Array.from(document.body.querySelectorAll("button")).find(
      item => item.textContent?.trim() === name,
    ),
    `missing button: ${name}`,
  );
}

function control(container: Element, label: string) {
  return required(
    Array.from(container.querySelectorAll("input, select, textarea")).find(item =>
      item.closest("label")?.textContent?.includes(label),
    ),
    `missing control: ${label}`,
  ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    );
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let hostStyleElement: HTMLStyleElement | null = null;

function renderHost() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(React.createElement(ChannelInventoryHost)));
}

function configureFixtures() {
  runtime.channelInputs = [];
  runtime.materialInputs = [];
  runtime.sharedInputs = [];
  runtime.optionInputs = [];
  runtime.getChannelInputs = [];
  runtime.notesInputs = [];
  runtime.createChannel.mockClear();
  runtime.updateChannel.mockClear();
  runtime.setChannelActive.mockClear();
  runtime.createMaterial.mockClear();
  runtime.updateMaterial.mockClear();
  runtime.setMaterialShare.mockClear();
  runtime.sharedQuery = query({
    items: [{ id: 202, partNumber: "TEAM-SN74", brand: "NXP", qty: 100, dateCode: "2601", price: "1.20", currency: "CNY", taxIncluded: true, leadTime: "3天", revision: 2, updatedAt: "2026-10-03T01:00:00.000Z", canEdit: false, readOnly: true }],
    total: 1, page: 1, pageSize: 20,
  });
  runtime.enterpriseMe = query({
    currentUserId: 7,
    isOwner: false,
    permissionKeys: ["inventory.manage"],
    enterprise: { id: 31, companyName: "真实测试企业", creditCode: "913100001" },
    member: { inventoryDataScope: "enterprise" },
    permissions: { manageMembers: false, inviteAdmins: false },
  });
  runtime.channelQuery = query({
    items: [
      {
        id: 11,
        enterpriseId: 31,
        dataOwnerUserId: 7,
        responsibleUserId: 7,
        name: "深圳代理",
        type: "agent",
        contactName: "渠道联系人",
        phone: "13800138000",
        wechat: "agent-wechat",
        qq: null,
        notes: "原渠道备注",
        active: true,
        revision: 4,
        canEdit: true,
        readOnly: false,
        createdAt: "2026-10-01T01:00:00.000Z",
        updatedAt: "2026-10-02T01:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    pageCount: 2,
    canWrite: true,
  });
  runtime.getChannelQuery = query({
    id: 11,
    enterpriseId: 31,
    dataOwnerUserId: 7,
    responsibleUserId: 7,
    name: "深圳代理",
    type: "agent",
    contactName: "渠道联系人",
    phone: "13800138000",
    wechat: "agent-wechat",
    qq: null,
    notes: "原渠道备注",
    active: true,
    revision: 4,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-02T01:00:00.000Z",
  });
  runtime.materialQuery = query({
    items: [
      {
        id: 101,
        partNumber: "LM358DR",
        brand: "TI",
        qty: null,
        dateCode: null,
        price: null,
        currency: "CNY",
        taxIncluded: null,
        leadTime: null,
        revision: 6,
        updatedAt: "2026-10-03T01:00:00.000Z",
        channelType: "agent",
        channelActive: true,
        channelId: 11,
        canEdit: true,
        readOnly: false,
        shareEnabled: false,
        note: "历史库存备注",
        noteCount: 1,
        latestNote: {
          id: 901,
          content: "已核对交期",
          authorName: "当前负责人",
          updatedAt: "2026-10-04T01:00:00.000Z",
        },
      },
    ],
    total: 40,
    page: 1,
    pageSize: 20,
    canWrite: true,
  });
  runtime.notesQuery = query({
    material: {
      id: 101,
      partNumber: "LM358DR",
      brand: "TI",
      channelType: "agent",
      updatedAt: "2026-10-03T01:00:00.000Z",
    },
    legacyNote: "历史库存备注",
    items: [
      {
        id: 901,
        authorUserId: 7,
        authorName: "当前负责人",
        content: "已核对交期",
        revision: 1,
        createdAt: "2026-10-04T01:00:00.000Z",
        updatedAt: "2026-10-04T01:00:00.000Z",
        canEdit: true,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
  });
}

beforeEach(() => {
  configureFixtures();
  sessionStorage.clear();
  runtime.createMaterial.mockReset().mockResolvedValue({ idempotent: false });
  vi.stubGlobal("confirm", vi.fn(() => true));
  hostStyleElement = document.createElement("style");
  hostStyleElement.textContent = hostStyles;
  document.head.append(hostStyleElement);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  hostStyleElement?.remove();
  root = null;
  container = null;
  hostStyleElement = null;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("ChannelInventoryHost new equivalent reconstruction", () => {
  it("defaults to own inventory with inventory before archives and removes persistent policy prose", () => {
    renderHost();
    const tabs = document.querySelector('[aria-label="渠道库存内容"]');
    expect(Array.from(tabs!.querySelectorAll('[role="tab"]')).map(item => item.textContent)).toEqual(["渠道库存", "渠道档案"]);
    expect(tabs!.querySelector('[aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(document.querySelector('[aria-label="库存可见范围"] [aria-selected="true"]')?.textContent).toBe("本人库存");
    expect(document.body.textContent).toContain("LM358DR");
    expect(document.querySelector(".ci-heading")).toBeNull();
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector(".ci-tabbar .ci-heading-actions")?.textContent).toContain("表格上传单条上传");
    expect(Array.from(document.querySelectorAll("th")).some(item => item.textContent === "可见范围")).toBe(false);
    expect(document.body.textContent).not.toContain("渠道档案仅当前负责人可见");
    expect(document.body.textContent).not.toContain("本人负责的库存；默认不共享");
    expect(runtime.channelInputs).toHaveLength(0);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1 });
    expect(runtime.sharedInputs).toHaveLength(0);
    click(button("团队共享（只读）"));
    expect(document.body.textContent).toContain("TEAM-SN74");
    expect(document.querySelector(".ci-shared-stock-table")).not.toBeNull();
    expect(Array.from(document.querySelectorAll("th")).map(item => item.textContent)).not.toContain("本人私有备注");
    expect(document.querySelectorAll(".ci-shared-stock-table th")).toHaveLength(7);
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(runtime.updateMaterial).not.toHaveBeenCalled();
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("LM358DR");
    expect(document.body.textContent).not.toContain("深圳代理");
    expect(document.body.textContent).not.toContain("已核对交期");
    expect(document.body.textContent).not.toContain("仅展示同队负责人显式共享且当前仍有效的库存");
    expect(document.querySelector('[aria-label="筛选库存渠道范围"]')).toBeNull();
    expect(document.querySelector('[aria-label="打开库存 101 的备注"]')).toBeNull();
    expect(runtime.sharedInputs.at(-1)).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, partNumber: undefined, brand: undefined, page: 1, pageSize: 20 });
    expect(Array.from(document.querySelectorAll("button")).some(item => ["编辑", "单条上传", "表格上传", "共享给同队"].includes(item.textContent ?? ""))).toBe(false);
  });

  it("keeps explicit sharing confirmation and the original mutation DTO", async () => {
    renderHost();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click(button("共享给同队"));
    await settle();
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
    click(button("共享给同队"));
    await settle();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("不包含渠道来源和任何备注"));
    expect(runtime.setMaterialShare).toHaveBeenCalledWith({ materialId: 101, enabled: true, expectedRevision: 6, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
  });

  it("shows channel timestamps in Beijing even when the visitor timezone is UTC", () => {
    const previous = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      renderHost();
      expect(document.body.textContent).toContain("2026-10-03 09:00");
      expect(document.body.textContent).not.toContain("2026-10-03 01:00");
      click(button("渠道档案"));
      expect(document.body.textContent).toContain("2026-10-02 09:00");
      expect(document.body.textContent).not.toContain("2026-10-02 01:00");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("renders the authoritative channel table, resets filters, creates a channel and keeps CAS on enable/disable", async () => {
    renderHost();
    click(button("渠道档案"));
    expect(document.body.textContent).toContain("渠道库存");
    expect(document.body.textContent).toContain("深圳代理");
    expect(document.body.textContent).not.toContain("负责人由服务器按当前业务分工审计");

    const typeFilter = required(
      document.querySelector('select[aria-label="筛选渠道类型"]'),
      "missing channel type filter",
    ) as HTMLSelectElement;
    expect(typeFilter.querySelector('option[value="factory"]')?.textContent).toBe("工厂");
    expect(typeFilter.querySelector('option[value="agent"]')?.textContent).toBe("代理商");
    expect(typeFilter.querySelector('option[value="trade"]')?.textContent).toBe("贸易商");
    expect(typeFilter.querySelector('option[value="other"]')?.textContent).toBe("其他");
    change(typeFilter, "agent");
    await settle();
    expect(runtime.channelInputs.at(-1)).toMatchObject({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      type: "agent",
      page: 1,
      pageSize: 20,
    });

    click(button("重置"));
    await settle();
    expect(runtime.channelInputs.at(-1)).toMatchObject({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      type: undefined,
      active: undefined,
      page: 1,
    });

    click(button("+ 新增渠道"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing channel editor");
    expect(dialog.querySelector('option[value="factory"]')?.textContent).toBe("工厂");
    change(control(dialog, "渠道名称") as HTMLInputElement, "华南原厂");
    click(button("保存渠道"));
    await settle();
    expect(runtime.createChannel).toHaveBeenCalledTimes(1);
    expect(runtime.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      name: "华南原厂",
      type: "factory",
      active: true,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));

    click(button("编辑"));
    const editDialog = required(document.querySelector('[role="dialog"]'), "missing channel edit dialog");
    change(control(editDialog, "渠道名称") as HTMLInputElement, "深圳代理更新");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, name: "深圳代理更新",
    }));

    click(button("停用"));
    await settle();
    expect(runtime.setChannelActive).toHaveBeenCalledWith({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      id: 11,
      active: false,
      expectedRevision: 4,
    });
  });

  it("validates the channel range before querying materials and returns to page one through the channel-table inventory action", async () => {
    renderHost();
    click(button("渠道库存"));
    await settle();
    expect(document.body.textContent).toContain("LM358DR");
    expect(document.body.textContent).toContain("待确认");
    expect(document.body.textContent).toContain("面议");
    expect(runtime.materialInputs.at(-1)).toMatchObject({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      page: 1,
      pageSize: 20,
    });

    const rangeFilter = required(
      document.querySelector('select[aria-label="筛选库存渠道范围"]'),
      "missing material channel range filter",
    ) as HTMLSelectElement;
    change(rangeFilter, "11");
    await settle();
    expect(runtime.getChannelInputs.at(-1)).toMatchObject({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      id: 11,
    });
    expect(runtime.materialInputs.at(-1)).toMatchObject({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      channelId: 11,
      page: 1,
      pageSize: 20,
    });

    click(button("下一页"));
    await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 11, page: 2 });

    click(button("渠道档案"));
    await settle();
    click(button("查看库存"));
    await settle();
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(runtime.getChannelInputs.at(-1)).toMatchObject({ id: 11 });
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 11, page: 1, pageSize: 20 });
  });

  it("applies the compact archive table constraints to native th and td elements", async () => {
    renderHost();
    click(button("渠道库存"));
    await settle();

    const stockTable = required(
      document.querySelector("table.ci-compact-stock-table"),
      "missing compact stock table",
    );
    const partHeader = required(
      stockTable.querySelector("th.ci-material-part-col"),
      "missing compact part column",
    );
    const firstCell = required(
      stockTable.querySelector("tbody tr td"),
      "missing compact stock cell",
    );
    const tableStyle = getComputedStyle(stockTable);
    const headerStyle = getComputedStyle(partHeader);
    const cellStyle = getComputedStyle(firstCell);

    expect(tableStyle.minWidth).toBe("860px");
    expect(tableStyle.tableLayout).toBe("fixed");
    expect(headerStyle.width).toBe("24%");
    expect(headerStyle.paddingTop).toBe("10px");
    expect(headerStyle.paddingRight).toBe("10px");
    expect(headerStyle.lineHeight).toBe("18px");
    expect(cellStyle.paddingTop).toBe("10px");
    expect(cellStyle.paddingRight).toBe("10px");
    expect(cellStyle.lineHeight).toBe("18px");
  });

  it("renders materials with explicit unknown quantity/tax/price, submits a real create DTO and opens the existing shared-notes panel", async () => {
    renderHost();
    click(button("渠道库存"));
    await settle();

    click(button("单条上传"));
    await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing material editor");
    const channelSelect = required(
      dialog.querySelector('select[aria-label="关联渠道"]'),
      "missing material channel select",
    ) as HTMLSelectElement;
    change(channelSelect, "11");
    change(control(dialog, "型号") as HTMLInputElement, "SN74HC00");
    change(control(dialog, "品牌") as HTMLInputElement, "TI");
    click(button("上传库存"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      channelId: 11,
      partNumber: "SN74HC00",
      brand: "TI",
      qty: null,
      price: null,
      currency: "CNY",
      taxIncluded: null,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));

    const notesButton = required(
      document.querySelector('button[aria-label="打开库存 101 的备注"]'),
      "missing shared notes summary",
    );
    click(notesButton);
    await settle();
    expect(document.body.textContent).toContain("库存备注");
    expect(document.body.textContent).toContain("已核对交期");
    expect(runtime.notesInputs.at(-1)).toMatchObject({
      materialId: 101,
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      page: 1,
      pageSize: 50,
    });
  });
});

async function uploadSheet(rows: unknown[][], configure?: (sheet: XLSX.WorkSheet) => void) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  configure?.(sheet);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "synthetic-inventory.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const input = required(document.querySelector<HTMLInputElement>('input[type="file"][aria-label="上传库存表格"]'), "missing file upload input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  expect(document.querySelector('select[aria-label="匹配型号"]')).not.toBeNull();
}
function chooseBatchChannel() {
  change(required(document.querySelector<HTMLSelectElement>('select[aria-label="批量关联渠道"]'), "missing batch channel"), "11");
}
function previewBatch() {
  click(button("预览并校验"));
  expect(document.querySelector(".ci-batch-preview table")).not.toBeNull();
}

describe("channel inventory upload entrypoints", () => {
  it("reads a real synthetic Excel file, maps/previews then submits only supported authenticated DTO fields", async () => {
    renderHost();
    click(button("表格上传"));
    chooseBatchChannel();
    await uploadSheet([
      ["型号", "品牌", "数量", "报价", "Date Code", "owner", "enterpriseId", "teamId", "备注"],
      ["ZERO", "TI", 0, 0, "002601", 999, 999, 999, "本人私有"],
      [123456789012, "NXP", 4000, 1.23456789, 2601],
      ["EXACT", "ADI", "", "123456789012345.123456789012"],
      ["EMPTY", "TI", "", ""],
    ], sheet => { sheet.C3.z = "#,##0"; sheet.D3.z = "0.00"; sheet.E3.z = "000000"; });
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLSelectElement>('[aria-label="匹配型号"]')?.value).toBe("0");
    expect(document.querySelector<HTMLSelectElement>('[aria-label="匹配品牌"]')?.value).toBe("1");
    previewBatch();
    expect(document.querySelector(".ci-batch-preview")?.textContent).toContain("123456789012");
    expect(document.querySelector(".ci-batch-preview")?.textContent).not.toContain("1.23457E+11");
    expect(document.querySelector(".ci-batch-preview")?.textContent).toContain("4000");
    expect(document.querySelector(".ci-batch-preview")?.textContent).toContain("1.23456789");
    expect(document.querySelector(".ci-batch-preview")?.textContent).toContain("面议");
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    click(button("确认上传 4 条"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(4);
    const dto = runtime.createMaterial.mock.calls.map(call => call[0]);
    expect(dto[0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 11, partNumber: "ZERO", brand: "TI", qty: 0, dateCode: "002601", price: "0", currency: "CNY", taxIncluded: null, leadTime: null, note: "本人私有", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
    expect(dto[1]).toMatchObject({ partNumber: "123456789012", qty: 4000, dateCode: "002601", price: "1.23456789" });
    expect(dto[2]).toMatchObject({ qty: null, price: "123456789012345.123456789012" });
    expect(dto[3]).toMatchObject({ qty: null, price: null, taxIncluded: null });
    for (const input of dto) {
      expect(input).not.toHaveProperty("sourceIssue");
      expect(input).not.toHaveProperty("owner");
      expect(input).not.toHaveProperty("enterpriseId");
      expect(input).not.toHaveProperty("teamId");
      expect(input).not.toHaveProperty("shareEnabled");
    }
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
  });

  it("previews an over-15-digit numeric identifier as an error and never submits it", async () => {
    renderHost();
    click(button("表格上传"));
    chooseBatchChannel();
    await uploadSheet([["型号", "品牌"], [1234567890123456, "TI"]]);
    previewBatch();
    expect(document.querySelector(".ci-batch-preview")?.textContent).toContain("请将型号列设为文本后重新上传");
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(Array.from(document.querySelectorAll("button")).some(item =>
      item.textContent?.includes("确认上传") && !item.disabled,
    )).toBe(false);
  });

  it("restores the original batch and retries only the uncertain row using the original request ID", async () => {
    runtime.createMaterial.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("response lost")).mockResolvedValue({});
    renderHost();
    click(button("表格上传"));
    chooseBatchChannel();
    await uploadSheet([["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"], ["THREE", "TI"]]);
    previewBatch();
    click(button("确认上传 3 条"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(2);
    const unknownDto = runtime.createMaterial.mock.calls[1][0];
    click(button("取消"));
    click(button("表格上传"));
    click(button("恢复原批次"));
    click(button("按原批次继续 / 重试"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(4);
    expect(runtime.createMaterial.mock.calls[2][0]).toEqual(unknownDto);
    expect(runtime.createMaterial.mock.calls.map(call => call[0].partNumber)).toEqual(["ONE", "TWO", "TWO", "THREE"]);
    expect(sessionStorage.getItem("d51-channel-inventory-batch-v1:7:31")).toBeNull();
  });

  it.each(["enterprise", "permission", "channel"])("stops the next batch write after %s access changes during a request", async kind => {
    let finish!: () => void;
    runtime.createMaterial.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    renderHost();
    click(button("表格上传"));
    chooseBatchChannel();
    await uploadSheet([["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"]]);
    previewBatch();
    click(button("确认上传 2 条"));
    expect(runtime.createMaterial).toHaveBeenCalledTimes(1);
    if (kind === "enterprise") runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] });
    if (kind === "permission") runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: [] });
    if (kind === "channel") {
      const previous = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
      runtime.channelQuery = query({ ...previous.data, items: previous.data.items.map(channel => ({ ...channel, active: false })) });
    }
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    await act(async () => { finish(); await Promise.resolve(); });
    expect(runtime.createMaterial).toHaveBeenCalledTimes(1);
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
  });

  it("validates single required fields in the compact dialog and keeps zero/exact price and edit CAS", async () => {
    renderHost();
    click(button("单条上传"));
    let dialog = required(document.querySelector('[role="dialog"]'), "missing single upload");
    expect(dialog.querySelector("h2")?.textContent).toBe("单条上传");
    expect(dialog.querySelector("header p")).toBeNull();
    expect(control(dialog, "可供数量").getAttribute("placeholder")).toBe("待确认");
    expect(control(dialog, "报价 CNY").getAttribute("placeholder")).toBe("面议");
    click(button("上传库存"));
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("请输入型号");
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    change(control(dialog, "型号"), "SINGLE");
    change(control(dialog, "品牌"), "TI");
    change(control(dialog, "可供数量"), "0");
    change(control(dialog, "报价 CNY"), "123456789012345.123456789012");
    click(button("上传库存"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ channelId: 11, qty: 0, price: "123456789012345.123456789012", taxIncluded: null }));
    click(button("编辑"));
    dialog = required(document.querySelector('[role="dialog"]'), "missing edit inventory");
    expect(dialog.querySelector("h2")?.textContent).toBe("编辑渠道库存");
    expect((control(dialog, "关联渠道") as HTMLSelectElement).disabled).toBe(true);
    change(control(dialog, "型号"), "EDITED");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 101, expectedRevision: 6, partNumber: "EDITED", expectedEnterpriseId: 31, expectedActorUserId: 7 }));
  });
});
