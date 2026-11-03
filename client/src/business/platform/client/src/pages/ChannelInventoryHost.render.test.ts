// @vitest-environment jsdom
import React, { act } from "react";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("xlsx", async importOriginal => ({ ...await importOriginal<typeof import("xlsx")>(), writeFile: vi.fn() }));

const hostStyles = readFileSync(
  resolve(process.cwd(), "client/src/business/platform/client/src/pages/ChannelInventoryHost.css"),
  "utf8",
);

const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const getMaterial = vi.fn();
  const getTeamMaterialForEdit = vi.fn();
  const collaborationAdd = vi.fn();
  const collaborationEdit = vi.fn();
  const exportChannelMaterials = vi.fn();
  const getTeamMaterialSource = vi.fn();
  const listTeamSourceOptions = vi.fn();
  return {
    getMaterial, getTeamMaterialSource, listTeamSourceOptions,
    toastError: vi.fn(),
    scope: { storageScope: "test-bound-scope", frontUser: { role: "user" }, contextVerification: { state: "verified", identity: "test-bound-scope" } },
    getTeamMaterialForEdit, collaborationAdd, collaborationEdit,
    collaborationQuery: null as unknown,
    collaborationInputs: [] as unknown[],
    exportChannelMaterials,
    teamQuery: null as unknown,
    sourceQuery: null as unknown,
    sourceInputs: [] as unknown[],
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
      client: { channelInventory: { getTeamMaterialSource: { query: getTeamMaterialSource }, listTeamSourceOptions: { query: listTeamSourceOptions }, exportChannelMaterials: { query: exportChannelMaterials }, getTeamMaterialForEdit: { query: getTeamMaterialForEdit }, collaborationNotesAdd: { mutate: collaborationAdd }, collaborationNotesEdit: { mutate: collaborationEdit } } },
      channelInventory: {
        getMaterial: { fetch: getMaterial },
        listTeamMaterials: { invalidate },
        listTeamSourceOptions: { invalidate },
        listChannels: { invalidate },
        listSharedMaterials: { invalidate },
        listMaterials: { invalidate },
        notesList: { invalidate },
        collaborationNotesList: { invalidate },
      },
    },
  };
});

vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("sonner", () => ({ toast: { error: runtime.toastError } }));

vi.mock("../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: {
      me: { useQuery: () => runtime.enterpriseMe },
    },
    channelInventory: {
      listTeamMaterials: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.materialInputs.push(input);
          return runtime.teamQuery;
        },
      },
      listTeamSourceOptions: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.sourceInputs.push(input);
          return runtime.sourceQuery;
        },
      },
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
      updateTeamMaterial: { useMutation: () => ({ isPending: false, mutateAsync: runtime.updateMaterial }) },
      setMaterialShare: { useMutation: () => ({ isPending: false, mutateAsync: runtime.setMaterialShare }) },
      collaborationNotesList: { useQuery: (input: unknown) => { runtime.collaborationInputs.push(input); return runtime.collaborationQuery; } },
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
  vi.mocked(XLSX.writeFile).mockClear();
  runtime.toastError.mockClear();
  runtime.scope = { storageScope: "test-bound-scope", frontUser: { role: "user" }, contextVerification: { state: "verified", identity: "test-bound-scope" } };
  runtime.getTeamMaterialSource.mockReset().mockResolvedValue({ name: "实时核验来源" });
  runtime.listTeamSourceOptions.mockReset().mockImplementation((input: unknown) => { runtime.sourceInputs.push(input); return Promise.resolve((runtime.sourceQuery as { data: unknown }).data); });
  runtime.exportChannelMaterials.mockReset().mockResolvedValue(exportFixture());
  runtime.channelInputs = [];
  runtime.sourceInputs = [];
  runtime.materialInputs = [];
  runtime.sharedInputs = [];
  runtime.optionInputs = [];
  runtime.getChannelInputs = [];
  runtime.notesInputs = [];
  runtime.collaborationInputs = [];
  runtime.collaborationAdd.mockReset().mockResolvedValue({});
  runtime.collaborationEdit.mockReset().mockResolvedValue({});
  runtime.collaborationQuery = query({ items: [], total: 0, page: 1, pageSize: 20, canAdd: true });
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
  (runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn>; data: unknown }).refetch.mockResolvedValue(runtime.enterpriseMe);
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
  const own = (runtime.materialQuery as { data: { items: Record<string, unknown>[] } }).data.items[0];
  runtime.getMaterial.mockReset().mockResolvedValue({ ...own, revision: 9 });
  runtime.getTeamMaterialForEdit.mockReset().mockResolvedValue({ id: 101, channelId: 11, channelName: "深圳代理", partNumber: "LM358DR", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY", taxIncluded: null, leadTime: null, revision: 9, canEdit: true, readOnly: false });
  runtime.sourceQuery = query({ canFilterSource: false, items: [] });
  runtime.teamQuery = query({
    items: [
      { id: 101, partNumber: "LM358DR", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY", taxIncluded: null, leadTime: null, revision: 6, updatedAt: "2026-10-03T01:00:00.000Z", createdAt: "2026-10-03T01:00:00.000Z", noteCount: 1, canAddNote: true, isMine: true, canEdit: true, readOnly: false, canViewSource: true },
      { id: 202, partNumber: "TEAM-SN74", brand: "NXP", qty: 100, dateCode: "2601", price: "1.20", currency: "CNY", taxIncluded: true, leadTime: "3天", revision: 2, updatedAt: "2026-10-03T01:00:00.000Z", createdAt: "2026-10-03T01:00:00.000Z", noteCount: 0, canAddNote: true, isMine: false, canEdit: false, readOnly: true, canViewSource: false },
    ], total: 40, page: 1, pageSize: 20, pageCount: 2, canWrite: true, canFilterSource: false,
  });
  runtime.notesQuery = query({
    material: {
      id: 101,
      partNumber: "LM358DR",
      brand: "TI",
      channelType: "agent",
      updatedAt: "2026-10-03T01:00:00.000Z",
    },
    canEdit: true, readOnly: false,
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
  it("defaults to unified inventory without old tabs, share buttons or private row DOM", () => {
    renderHost();
    const tabs = document.querySelector('[aria-label="渠道库存内容"]');
    expect(Array.from(tabs!.querySelectorAll('[role="tab"]')).map(item => item.textContent)).toEqual(["渠道库存", "渠道档案"]);
    expect(tabs!.querySelector('[aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(document.querySelector('[aria-label="库存可见范围"]')).toBeNull();
    expect(document.body.textContent).toContain("LM358DR");
    expect(document.body.textContent).toContain("TEAM-SN74");
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector(".ci-heading-actions")?.textContent).toContain("表格上传单条上传");
    expect(document.body.textContent).not.toContain("共享给同队");
    expect(document.body.textContent).not.toContain("撤销共享");
    expect(document.body.innerHTML).not.toContain("已核对交期");
    expect(document.body.innerHTML).not.toContain("历史库存备注");
    expect(document.body.innerHTML).not.toContain("渠道联系人");
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1 });
    expect(runtime.sharedInputs).toHaveLength(0);
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("查看来源");
    expect(rows[1].textContent).toContain("查看来源");
    expect(document.body.innerHTML).not.toContain("深圳代理");
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled();
    expect(runtime.sourceInputs).toHaveLength(0);
    expect(runtime.optionInputs).toHaveLength(0);
    expect(Array.from(rows[1].querySelectorAll("button")).map(item => item.textContent)).toEqual(["查看来源", "新增备注", "备注（0）"]);
    expect(rows[1].querySelector("[title], [hidden], input")).toBeNull();
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
  });

  it("denies source filtering without exposing own upload options", () => {
    renderHost();
    const filter = required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter");
    expect(filter.disabled).toBe(true);
    expect(filter.textContent).toBe("无权查看");
    expect(filter.innerHTML).not.toContain("深圳代理");
    expect(filter.querySelectorAll("option")).toHaveLength(1);
    click(button("单条上传"));
    const upload = required(document.querySelector<HTMLSelectElement>('[aria-label="关联渠道"]'), "missing upload channel");
    expect(upload.textContent).toContain("深圳代理");
    expect(filter.innerHTML).not.toContain("深圳代理");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined });
  });

  it("reads leader peer source only on click but never peer editor or private detail", async () => {
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...result.data, canFilterSource: true, items: result.data.items.map(row => row.id === 202 ? { ...row, channelSource: { id: 22, name: "团队来源" }, canViewSource: true } : row) });
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "团队来源" }] });
    renderHost();
    const peer = document.querySelectorAll("tbody tr")[1];
    expect(peer.textContent).not.toContain("团队来源");
    expect(Array.from(peer.querySelectorAll("button")).map(item => item.textContent)).toEqual(["查看来源", "新增备注", "备注（0）"]);
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "团队来源" });
    click(required(peer.querySelector(".ci-source-link"), "missing source link"));
    await settle();
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("团队来源");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(peer.querySelector("[title], [hidden], input")).toBeNull();
    expect(runtime.getMaterial).not.toHaveBeenCalled();
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
    change(control(dialog, "所属行业"), "electronic_components");
    click(button("保存渠道"));
    await settle();
    expect(runtime.createChannel).toHaveBeenCalledTimes(1);
    expect(runtime.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31,
      expectedActorUserId: 7,
      name: "华南原厂",
      industryCode: "electronic_components",
      type: "factory",
      active: true,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));

    click(button("编辑"));
    const editDialog = required(document.querySelector('[role="dialog"]'), "missing channel edit dialog");
    change(control(editDialog, "渠道名称") as HTMLInputElement, "深圳代理更新");
    change(control(editDialog, "所属行业"), "communications");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, name: "深圳代理更新", industryCode: "communications",
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

  it("uses dedicated leader source options and fails closed when source permission changes", async () => {
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "团队来源" }] });
    const result = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...result.data, canFilterSource: true });
    renderHost();
    const filter = required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter");
    expect(filter.disabled).toBe(false);
    expect(filter.textContent).not.toContain("深圳代理");
    expect(runtime.sourceInputs).toHaveLength(0);
    act(() => filter.focus()); await settle();
    change(filter, "22");
    await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 22, page: 1 });
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 22, page: 2 });
    runtime.sourceQuery = query({ canFilterSource: false, items: [] });
    runtime.teamQuery = query({ ...result.data, canFilterSource: false });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(filter.disabled).toBe(true);
    expect(filter.value).toBe("");
    expect(filter.textContent).toBe("无权查看");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined, page: 1 });
    expect(runtime.sharedInputs).toHaveLength(0);
    expect(runtime.getChannelInputs).toHaveLength(0);
  });

  it("cycles server sort none asc desc none, resets page and preserves server ordering/page count", async () => {
    renderHost();
    const qty = required(document.querySelector<HTMLButtonElement>('[aria-label="按可供数量排序"]'), "missing qty sort");
    const dc = required(document.querySelector<HTMLButtonElement>('[aria-label="按 Date Code 排序"]'), "missing date sort");
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("none");
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ page: 2 });
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "asc", page: 1 });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    // Null quantity stays first exactly as the server returned, not a client-page sort.
    expect(document.querySelector("tbody tr")?.textContent).toContain("LM358DR");
    expect(document.querySelectorAll(".ci-sort-arrow")).toHaveLength(1);
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "desc", page: 1 });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: undefined, sortDirection: undefined });
    expect(document.querySelectorAll(".ci-sort-arrow")).toHaveLength(0);
    click(dc);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "dateCode", sortDirection: "asc" });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(dc.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(document.body.textContent).toContain("第 1 / 2 页");
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "dateCode", sortDirection: "asc", page: 2 });
  });

  it("retains selected source and authoritative totals while a new server page is loading", async () => {
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "团队来源" }] });
    const previous = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...previous.data, canFilterSource: true, total: 100, pageCount: 5 });
    renderHost();
    const source = required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter");
    act(() => source.focus()); await settle();
    change(source, "22");
    runtime.teamQuery = query(undefined, { isLoading: true, isFetching: true });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(source.disabled).toBe(false);
    expect(source.value).toBe("22");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 22 });
    expect(document.body.textContent).toContain("共 100 条，第 1 / 5 页");
    expect(document.querySelector("tbody")?.textContent).toContain("正在加载渠道库存");
    expect(document.querySelector("tbody")?.textContent).not.toContain("LM358DR");
  });

  it("does not show stale peer source when source permission is revoked", async () => {
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "团队来源" }] });
    runtime.teamQuery = query({ ...previous.data, canFilterSource: true, items: previous.data.items.map(row => row.id === 202 ? { ...row, canViewSource: true, channelSource: { id: 22, name: "团队来源" } } : row) });
    renderHost();
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "团队来源" });
    click(required(document.querySelectorAll("tbody tr")[1].querySelector(".ci-source-link"), "missing peer source")); await settle();
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("团队来源");
    runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => ({ ...row, canViewSource: false })), canFilterSource: false });
    runtime.sourceQuery = query({ canFilterSource: false, items: [] });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(document.body.innerHTML).not.toContain("团队来源");
    expect(document.querySelectorAll("tbody tr")[1].textContent).toContain("查看来源");
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
  });

  it("does not open an public detail response arriving after permission revocation", async () => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(button("编辑"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const previous = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...previous.data, canWrite: false });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await act(async () => { finish(detail); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("历史库存备注");
  });

  it.each([false, true])("invalidates pending public detail on archive navigation (return=%s)", async returnToInventory => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(button("编辑"));
    expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledTimes(1);
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    click(button("渠道档案"));
    if (returnToInventory) click(button("渠道库存"));
    await act(async () => { finish(detail); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("历史库存备注");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(returnToInventory ? "渠道库存" : "渠道档案");
  });

  it("preserves the new upload title and typed model when old public detail resolves", async () => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(button("编辑"));
    click(button("单条上传"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing new upload");
    change(control(dialog, "型号"), "NEW-DRAFT-MODEL");
    await act(async () => { finish(detail); await Promise.resolve(); });
    expect(dialog.querySelector("h2")?.textContent).toBe("单条上传");
    expect(control(dialog, "型号").value).toBe("NEW-DRAFT-MODEL");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain("历史库存备注");
    expect(button("上传库存")).toBeTruthy();
    expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });

  it("suppresses a late detail error after opening and closing a new upload", async () => {
    let reject!: (error: Error) => void;
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    renderHost();
    click(button("编辑"));
    click(button("单条上传"));
    click(required(document.querySelector('[aria-label="关闭库存编辑"]'), "missing close"));
    await act(async () => { reject(new Error("STALE-DETAIL-ERROR")); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("STALE-DETAIL-ERROR");
  });

  it("keeps batch upload active when an older public detail resolves", async () => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(button("编辑"));
    click(button("表格上传"));
    await act(async () => { finish(detail); await Promise.resolve(); });
    expect(document.querySelector('[aria-label="上传库存表格"]')).not.toBeNull();
    expect(document.querySelector('#ci-material-editor-title')).toBeNull();
    expect(document.body.innerHTML).not.toContain("历史库存备注");
  });

  it("fails closed on unified query errors without falling back to legacy lists", () => {
    runtime.teamQuery = query(undefined, { isError: true, isSuccess: false });
    renderHost();
    expect(document.body.textContent).not.toContain("TEAM-SN74");
    expect(document.body.textContent).not.toContain("LM358DR");
    expect(runtime.sharedInputs).toHaveLength(0);
    expect(button("单条上传").disabled).toBe(true);
    expect(runtime.getMaterial).not.toHaveBeenCalled();
  });

  it("clears filters, sort and editors when the authenticated context changes", async () => {
    renderHost();
    change(required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存型号"]'), "missing part filter"), "FILTER");
    click(required(document.querySelector('[aria-label="按可供数量排序"]'), "missing sort"));
    click(button("单条上传"));
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ expectedEnterpriseId: 32, expectedActorUserId: 8, partNumber: undefined, channelId: undefined, sortBy: undefined, page: 1 });
  });

  it("applies readable archive table constraints to native th and td elements", async () => {
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

    expect(tableStyle.minWidth).toBe("960px");
    expect(tableStyle.tableLayout).toBe("fixed");
    expect(getComputedStyle(required(stockTable.querySelector("th.ci-col-actions"), "missing fixed actions")).width).toBe("216px");
    expect(headerStyle.paddingTop).toBe("6px");
    expect(headerStyle.paddingRight).toBe("10px");
    expect(headerStyle.lineHeight).toBe("18px");
    expect(cellStyle.paddingTop).toBe("10px");
    expect(cellStyle.paddingRight).toBe("10px");
    // The first cell is an auxiliary ordinal, not the main model text.
    expect(cellStyle.lineHeight).toBe("18px");
    expect(getComputedStyle(required(
      stockTable.querySelector(".ci-cell-title"),
      "missing primary model text",
    )).lineHeight).toBe("18px");
  });

  it("creates with the original DTO and keeps public editing separate from the independent owner private history", async () => {
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

    click(button("编辑"));
    await settle();
    expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 101 }, { signal: expect.any(AbortSignal) });
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
    click(button("本人备注历史（私有）"));
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

  it.each(["enterprise", "permission", "channel", "write"])("stops the next batch write after %s access changes during a request", async kind => {
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
    if (kind === "write") {
      const previous = runtime.teamQuery as { data: object };
      runtime.teamQuery = query({ ...previous.data, canWrite: false });
    }
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
    await settle();
    dialog = required(document.querySelector('[role="dialog"]'), "missing edit inventory");
    expect(dialog.querySelector("h2")?.textContent).toBe("编辑渠道库存");
    expect((control(dialog, "关联渠道") as HTMLSelectElement).disabled).toBe(true);
    change(control(dialog, "型号"), "EDITED");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 101, expectedRevision: 9, partNumber: "EDITED", expectedEnterpriseId: 31, expectedActorUserId: 7 }));
  });
});

function exportFixture() {
  return {
    channel: { id: 11, name: "深圳代理", type: "agent" as const, active: true },
    enterpriseId: 31, actorUserId: 7, exportedAt: "2026-11-03T04:15:16.000Z", total: 23,
    items: Array.from({ length: 23 }, (_, n) => ({
      partNumber: n === 0 ? "000123456789012345678901234567890" : n === 1 ? "  =HYPERLINK(\"https://invalid.test\")" : `PART-${n}`,
      brand: n === 1 ? "\t+CMD" : "TI", qty: n === 0 ? null : 0,
      dateCode: n === 1 ? "@SUM(1,2)" : "002601000000000000000000000001",
      price: n === 0 ? null : n === 1 ? "0" : "123456789012345.123456789012",
      currency: "CNY" as const, taxIncluded: n === 0 ? null : n === 1, leadTime: n === 1 ? "-EVIL" : null,
      updatedAt: "2026-11-03T04:00:01.000Z",
      note: "SECRET-NEVER-EXPORT", contactName: "SECRET-CONTACT", // adversarial extra keys must be ignored
    })),
  };
}
async function settleExport() {
  await act(async () => { await vi.dynamicImportSettled(); await Promise.resolve(); });
}
function exportedBook() {
  const book = vi.mocked(XLSX.writeFile).mock.calls[0]?.[0];
  if (!book) throw new Error("missing exported workbook");
  // Serialize and read an actual XLSX archive, not only an object shape assertion.
  return XLSX.read(XLSX.write(book, { type: "array", bookType: "xlsx" }), { type: "array", cellStyles: true });
}

describe("v6 channel archive complete inventory download", () => {
  it("places download before view and permits read-only channels without leader source privileges", async () => {
    const old = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    runtime.channelQuery = query({ ...old.data, canWrite: false, items: old.data.items.map(item => ({ ...item, canEdit: false, readOnly: true })) });
    renderHost(); click(button("渠道档案"));
    const actions = document.querySelector(".ci-row-actions")!;
    expect(Array.from(actions.querySelectorAll("button")).map(item => item.textContent)).toEqual(["下载库存", "查看库存", "编辑", "停用"]);
    expect(button("下载库存").disabled).toBe(false); expect(button("编辑").disabled).toBe(true);
    click(button("下载库存"));
    expect(button("下载中…").disabled).toBe(true);
    click(button("下载中…"));
    await settleExport();
    expect(runtime.exportChannelMaterials).toHaveBeenCalledTimes(1);
    expect(runtime.exportChannelMaterials).toHaveBeenCalledWith({ channelId: 11, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(XLSX.writeFile).mock.calls[0][1]).toBe("深圳代理_渠道库存_20261103121516_北京时间.xlsx");
    expect(document.body.textContent).toContain("全部 23 条可读库存");
    const sheet = exportedBook().Sheets["渠道库存"];
    expect(XLSX.utils.sheet_to_json(sheet)).toHaveLength(23);
    expect(sheet.A2).toMatchObject({ t: "s", v: "000123456789012345678901234567890", z: "@" });
    expect(sheet.D2).toMatchObject({ t: "s", v: "002601000000000000000000000001", z: "@" });
    expect(sheet.C2.v).toBe("待确认"); expect(sheet.E2.v).toBe("面议"); expect(sheet.G2.v).toBe("待确认");
    expect(sheet.C3).toMatchObject({ t: "n", v: 0 }); expect(sheet.E3).toMatchObject({ t: "s", v: "0" });
    expect(sheet.E4).toMatchObject({ t: "s", v: "123456789012345.123456789012" });
    expect(sheet.G3.v).toBe("含税"); expect(sheet.G4.v).toBe("未税");
    expect(sheet.I2.v).toBe("2026-11-03 12:00:01");
    expect(JSON.stringify(exportedBook())).not.toMatch(/SECRET|contactName|note/);
  });
  it("neutralizes spreadsheet formulas in every text column without converting identifiers to numbers", async () => {
    runtime.exportChannelMaterials.mockResolvedValue({ ...exportFixture(), channel: { id: 11, name: "=EVIL/CHANNEL", type: "agent", active: true } });
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    const book = exportedBook(); const sheet = book.Sheets["渠道库存"];
    for (const address of ["A3", "B3", "D3", "H3"]) {
      expect(sheet[address].t).toBe("s"); expect(sheet[address].f).toBeUndefined(); expect(String(sheet[address].v).startsWith("'")).toBe(true);
    }
    expect(book.Sheets["导出说明"].B1).toMatchObject({ t: "s", v: "'=EVIL/CHANNEL" });
    expect(vi.mocked(XLSX.writeFile).mock.calls[0][1]).not.toContain("/");
  });
  it("exports an empty inactive channel as a header-only workbook", async () => {
    runtime.exportChannelMaterials.mockResolvedValue({ ...exportFixture(), channel: { id: 11, name: "停用", type: "agent", active: false }, total: 0, items: [] });
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    expect(exportedBook().Sheets["渠道库存"]["!ref"]).toBe("A1:I1");
    expect(document.body.textContent).toContain("含表头的空表");
  });
  it.each(["企业", "账号", "权限", "切走再切回"])("drops an old export when %s changes during the request", async kind => {
    let finish!: (value: unknown) => void;
    runtime.exportChannelMaterials.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); click(button("渠道档案")); click(button("下载库存"));
    const original = runtime.enterpriseMe as { data: Record<string, any> };
    const changed = kind === "企业" ? { ...original.data, enterprise: { id: 32 } }
      : kind === "权限" ? { ...original.data, permissionKeys: [] }
      : { ...original.data, currentUserId: 8 };
    runtime.enterpriseMe = query(changed);
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    if (kind === "切走再切回") { runtime.enterpriseMe = original; act(() => root?.render(React.createElement(ChannelInventoryHost))); }
    await act(async () => { finish(exportFixture()); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });
  it("drops a response after unmount", async () => {
    let finish!: (value: unknown) => void;
    runtime.exportChannelMaterials.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); click(button("渠道档案")); click(button("下载库存"));
    await act(async () => { root?.unmount(); }); root = null;
    await act(async () => { finish(exportFixture()); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });
  it("rechecks the authenticated subject before saving even if the page has not rerendered", async () => {
    const me = runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn>; data: object };
    me.refetch.mockResolvedValue(query({ ...me.data, currentUserId: 8 }));
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    expect(me.refetch).toHaveBeenCalledTimes(1); expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("未生成文件");
  });
  it("does not save if the context changes while the final identity recheck is pending", async () => {
    let finish!: (value: unknown) => void;
    const me = runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn>; data: object };
    me.refetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    expect(me.refetch).toHaveBeenCalled();
    runtime.enterpriseMe = query({ ...me.data, currentUserId: 8 }); act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await act(async () => { finish(me); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });
  it("shows a clear server limit error without downloading a partial current page", async () => {
    runtime.exportChannelMaterials.mockRejectedValueOnce(new Error("该渠道库存超过 10,000 条导出上限，未生成文件"));
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    expect(document.body.textContent).toContain("10,000 条导出上限"); expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(button("下载库存").disabled).toBe(false);
  });
  it("rejects a mismatched DTO instead of saving it", async () => {
    runtime.exportChannelMaterials.mockResolvedValueOnce({ ...exportFixture(), actorUserId: 8 });
    renderHost(); click(button("渠道档案")); click(button("下载库存")); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("上下文不匹配");
  });
});


describe("channel industry required integration", () => {
  it("requires an explicit industry and keeps the same complete dictionary in the compact QQ-right slot", async () => {
    renderHost();
    click(button("渠道档案"));
    click(button("+ 新增渠道"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing create dialog");
    change(control(dialog, "渠道名称"), "行业渠道");
    const industry = control(dialog, "所属行业") as HTMLSelectElement;
    expect(industry.value).toBe("");
    expect(industry.required).toBe(true);
    expect(industry.options[0].text).toBe("请选择所属行业");
    expect(Array.from(industry.options).slice(1).map(option => option.value)).toEqual(["semiconductor", "electronic_components", "consumer_electronics", "communications", "computers_servers", "automotive", "industrial_automation", "instrumentation", "medical", "renewable_energy", "power_electronics", "iot_smart_hardware", "security", "lighting", "home_appliances", "aerospace_defense", "rail_transportation", "electronic_manufacturing", "component_distribution", "software_it", "education_research", "other"]);
    expect(industry.closest("label")?.previousElementSibling?.textContent).toBe("QQ");
    expect(industry.closest("label")?.classList.contains("ci-form-wide")).toBe(false);
    click(button("保存渠道"));
    await settle();
    expect(runtime.createChannel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请选择所属行业。");
    change(industry, "automotive");
    click(button("保存渠道"));
    await settle();
    expect(runtime.createChannel).toHaveBeenCalledWith(expect.objectContaining({ industryCode: "automotive", expectedEnterpriseId: 31, expectedActorUserId: 7 }));
  });

  it("requires a missing historical industry for channel editing but not existing inventory uploads", async () => {
    renderHost();
    click(button("渠道档案"));
    click(button("编辑"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing edit dialog");
    expect((control(dialog, "所属行业") as HTMLSelectElement).value).toBe("");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
    change(control(dialog, "所属行业"), "medical");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledWith(expect.objectContaining({ industryCode: "medical", id: 11, expectedRevision: 4 }));
    // A real invalidation returns a fresh query DTO and repopulates upload candidates.
    runtime.channelQuery = query({ ...(runtime.channelQuery as { data: object }).data });
    click(button("渠道库存"));
    click(button("单条上传"));
    const upload = required(document.querySelector('[role="dialog"]'), "missing upload dialog");
    expect(upload.querySelector('[aria-label="所属行业"]')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>('[aria-label="关联渠道"]')?.textContent).toContain("深圳代理");
  });

  it("echoes an existing channel industry and cannot edit a read-only source", async () => {
    const result = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0].industryCode = "renewable_energy";
    renderHost();
    click(button("渠道档案"));
    click(button("编辑"));
    expect(document.querySelector<HTMLSelectElement>('[aria-label="所属行业"]')?.value).toBe("renewable_energy");
    click(button("取消"));
    result.data.items[0].readOnly = true;
    click(button("编辑"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
    click(button("渠道库存"));
    const peer = document.querySelectorAll("tbody tr")[1];
    expect(peer.textContent).toContain("查看来源");
    expect(Array.from(peer.querySelectorAll("button")).map(item => item.textContent)).toEqual(["查看来源", "新增备注", "备注（0）"]);
    expect(peer.querySelector("select")).toBeNull();
    expect(document.querySelector("thead")?.textContent).not.toContain("所属行业");
  });
});


describe("v9 public inventory and collaboration integration", () => {
  it("allows a live team leader to edit peer public fields without private detail or writable channel options", async () => {
    const old = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...old.data, items: old.data.items.map(row => row.id === 202 ? { ...row, canEdit: true, readOnly: false } : row) });
    runtime.channelQuery = query({ items: [], total: 0, page: 1, pageSize: 100, canWrite: false });
    runtime.getTeamMaterialForEdit.mockResolvedValueOnce({ id: 202, channelId: 22, channelName: "团队来源", partNumber: "TEAM-SN74", brand: "NXP", qty: 0, dateCode: "2601", price: "0", currency: "CNY", taxIncluded: false, leadTime: null, revision: 12, canEdit: true, readOnly: false });
    renderHost();
    const peer = document.querySelectorAll("tbody tr")[1];
    click(required(Array.from(peer.querySelectorAll("button")).find(item => item.textContent === "编辑"), "missing leader public edit"));
    await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing public editor");
    expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledWith({ id: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(control(dialog, "关联渠道").value).toBe("关联渠道由服务端保留");
    expect(dialog.innerHTML).not.toContain("团队来源");
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(dialog.textContent).not.toContain("本人备注");
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    expect(runtime.notesInputs).toHaveLength(0);
    change(control(dialog, "型号"), "LEADER-PUBLIC-EDIT");
    click(button("保存修改")); await settle();
    expect(runtime.updateMaterial).toHaveBeenCalledWith({ id: 202, expectedRevision: 12, partNumber: "LEADER-PUBLIC-EDIT", brand: "NXP", qty: 0, dateCode: "2601", price: "0", taxIncluded: false, leadTime: null, expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
    for (const key of ["channelId", "channelName", "currency", "note", "ownerUserId", "responsibleUserId", "teamId"]) expect(runtime.updateMaterial.mock.calls[0][0]).not.toHaveProperty(key);
  });

  it("lets a stocks.read member add collaboration while inventory and upload stay noneditable", async () => {
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: ["stocks.read"] });
    const old = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...old.data, canWrite: false, items: old.data.items.map(row => ({ ...row, canEdit: false, readOnly: true })) });
    renderHost();
    expect(button("单条上传").disabled).toBe(true);
    const peer = document.querySelectorAll("tbody tr")[1];
    expect(peer.textContent).not.toContain("编辑");
    click(required(Array.from(peer.querySelectorAll("button")).find(item => item.textContent === "新增备注"), "missing readonly note add"));
    await settle();
    const textarea = required(document.querySelector<HTMLTextAreaElement>("textarea"), "missing focused collaboration input");
    expect(document.activeElement).toBe(textarea);
    change(textarea, "只读成员核实了交期");
    click(button("保存协作备注")); await settle();
    expect(runtime.collaborationAdd).toHaveBeenCalledWith({ materialId: 202, content: "只读成员核实了交期", expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) }, { signal: expect.any(AbortSignal) });
    expect(runtime.updateMaterial).not.toHaveBeenCalled();
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it("does not discard a collaboration draft or focus when only inventory write or source rights change", async () => {
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "团队来源" }] });
    const old = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...old.data, canFilterSource: true });
    renderHost(); click(button("新增备注")); await settle();
    const textarea = required(document.querySelector<HTMLTextAreaElement>("textarea"), "missing collaboration draft");
    change(textarea, "保持当前草稿与光标"); textarea.setSelectionRange(2, 5);
    runtime.teamQuery = query({ ...old.data, canWrite: false, canFilterSource: false });
    runtime.sourceQuery = query({ canFilterSource: false, items: [] });
    act(() => root?.render(React.createElement(ChannelInventoryHost))); await settle();
    expect(document.querySelector("textarea")).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe("保持当前草稿与光标");
    expect(textarea.selectionStart).toBe(2);
    click(button("保存协作备注")); await settle();
    expect(runtime.collaborationAdd).toHaveBeenCalledTimes(1);
  });

  it("aborts a stale collaboration write and clears its draft on an authenticated context switch", async () => {
    let finish!: () => void;
    runtime.collaborationAdd.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    renderHost(); click(button("新增备注")); await settle();
    change(required(document.querySelector<HTMLTextAreaElement>("textarea"), "missing note draft"), "旧企业备注草稿");
    click(button("保存协作备注"));
    const signal = runtime.collaborationAdd.mock.calls[0][1].signal as AbortSignal;
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["stocks.read"] });
    act(() => root?.render(React.createElement(ChannelInventoryHost))); await settle();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("旧企业备注草稿");
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it("freezes a public inventory request after an unknown response and retries the same CAS payload", async () => {
    runtime.updateMaterial.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({});
    renderHost(); click(button("编辑")); await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing public inventory editor");
    change(control(dialog, "型号"), "FROZEN-PUBLIC");
    click(button("保存修改")); await settle();
    const original = runtime.updateMaterial.mock.calls[0][0];
    expect((dialog.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
    expect(document.querySelector('[aria-label="关闭库存编辑"]')?.hasAttribute("disabled")).toBe(true);
    click(button("按原请求重试")); await settle();
    expect(runtime.updateMaterial.mock.calls[1][0]).toEqual(original);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.getMaterial).not.toHaveBeenCalled();
  });
});


describe("v10 real Host source authorization lifecycle", () => {
  const link = (index = 0) => required(document.querySelectorAll("tbody tr")[index]?.querySelector<HTMLButtonElement>(".ci-source-link"), "missing clickable source link");
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));

  it("keeps negative-hint links clickable and lets the fresh server denial give the exact toast without granting edit or hiding collaboration", async () => {
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    renderHost();
    const denied = link(1);
    expect(denied.disabled).toBe(false);
    expect(denied.classList.contains("ci-source-link-muted")).toBe(true);
    click(denied); await settle();
    expect(runtime.toastError).toHaveBeenCalledWith("暂无权限查看");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    expect(document.querySelectorAll("tbody tr")[1].textContent).toContain("新增备注备注（0）");
    expect(document.querySelectorAll("tbody tr")[1].textContent).not.toContain("编辑");
  });

  it("a stale negative row hint cannot block newly authorized source access and does not grant stock edit", async () => {
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "新授予实时来源" });
    renderHost(); click(link(1)); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("新授予实时来源");
    expect(runtime.toastError).not.toHaveBeenCalled();
    expect(document.querySelectorAll("tbody tr")[1].textContent).not.toContain("编辑");
    expect(document.querySelectorAll("tbody tr")[1].textContent).toContain("新增备注备注（0）");
  });

  it("handles fresh server denial despite an old positive row hint and never displays a stale name", async () => {
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    renderHost(); click(link()); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 101, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    expect(runtime.toastError).toHaveBeenCalledWith("暂无权限查看");
    expect(document.body.innerHTML).not.toContain("实时核验来源");
    expect(runtime.getMaterial).not.toHaveBeenCalled();
  });

  it("uses a fresh source API on each open, and focus rechecks cannot retain a revoked name", async () => {
    renderHost(); click(link()); await settle();
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("实时核验来源");
    click(required(document.querySelector('[aria-label="关闭渠道来源"]'), "missing source close"));
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "再次实时核验" });
    click(link()); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("再次实时核验");
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(3);
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    expect(document.body.innerHTML).not.toContain("再次实时核验");
    expect(runtime.toastError).toHaveBeenCalledWith("暂无权限查看");
  });

  it.each(["actor", "enterprise", "binding", "team", "role", "read", "revalidating", "list-denial", "row-revocation", "archive"])("aborts and clears source on %s, ignoring a late response", async change => {
    let finish!: (value: { name: string }) => void;
    runtime.getTeamMaterialSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); click(link());
    const signal = runtime.getTeamMaterialSource.mock.calls[0][1].signal as AbortSignal;
    const enterprise = runtime.enterpriseMe as { data: Record<string, unknown> };
    const material = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    if (change === "actor") enterprise.data.currentUserId = 8;
    if (change === "enterprise") enterprise.data.enterprise = { id: 32 };
    if (change === "binding") runtime.scope.storageScope = "new-binding";
    if (change === "team") enterprise.data.member = { teamId: 44, teamRole: "member" };
    if (change === "role") runtime.scope.frontUser.role = "changed-role";
    if (change === "read") enterprise.data.permissionKeys = [];
    if (change === "revalidating") runtime.scope.contextVerification.state = "revalidating";
    if (change === "list-denial") runtime.teamQuery = query(undefined, { isError: true });
    if (change === "row-revocation") runtime.teamQuery = query({ ...material.data, items: material.data.items.map(row => ({ ...row, canViewSource: false })) });
    if (change === "archive") click(button("渠道档案")); else rerender();
    await settle();
    expect(signal.aborted).toBe(true);
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    await act(async () => { finish({ name: "LATE-PRIVATE-SOURCE" }); await Promise.resolve(); });
    expect(document.body.innerHTML).not.toContain("LATE-PRIVATE-SOURCE");
  });

  it("does not discard an allowed public edit when only the narrower source filter right changes", async () => {
    const old = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...old.data, canFilterSource: true });
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 22, name: "leader-only-option" }] });
    renderHost();
    act(() => required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing filter").focus()); await settle();
    click(button("编辑")); await settle();
    const editor = required(document.querySelector(".ci-host-material-dialog"), "missing edit dialog");
    change(control(editor, "型号"), "KEEP-PUBLIC-EDIT");
    runtime.teamQuery = query({ ...old.data, canFilterSource: false });
    rerender(); await settle();
    expect(document.querySelector(".ci-host-material-dialog")).toBe(editor);
    expect(control(editor, "型号").value).toBe("KEEP-PUBLIC-EDIT");
    click(button("保存修改")); await settle();
    expect(runtime.updateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 101, partNumber: "KEEP-PUBLIC-EDIT" }));
  });

  it("aborts lazy leader options on binding revocation and never feeds a late option into the filter", async () => {
    let finish!: (value: unknown) => void;
    runtime.listTeamSourceOptions.mockImplementationOnce(input => { runtime.sourceInputs.push(input); return new Promise(resolve => { finish = resolve; }); });
    const old = runtime.teamQuery as { data: object };
    runtime.teamQuery = query({ ...old.data, canFilterSource: true });
    renderHost(); expect(runtime.sourceInputs).toHaveLength(0);
    act(() => required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing filter").focus());
    const signal = runtime.listTeamSourceOptions.mock.calls[0][1].signal as AbortSignal;
    runtime.scope.contextVerification.state = "revalidating"; rerender(); await settle();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ canFilterSource: true, items: [{ id: 888, name: "LATE-OPTION" }] }); await Promise.resolve(); });
    expect(document.body.innerHTML).not.toContain("LATE-OPTION");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined });
  });

  it("retains the original tabs, complete column ordering/type/filter/control contract without demo content", () => {
    renderHost();
    expect(Array.from(document.querySelectorAll("thead th")).map(item => item.textContent)).toEqual(["#", "型号 / 品牌", "可供数量", "报价 CNY", "交期", "Date Code / 更新", "渠道来源", "操作"]);
    expect(document.querySelector("h1,.ci-page-title,.ci-stats")).toBeNull();
    expect(document.body.textContent).not.toMatch(/库存明细|切换示例身份|leader|creator/);
    expect(getComputedStyle(required(document.querySelector(".ci-filter-label"), "missing original a11y label")).position).toBe("absolute");
    expect(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')?.disabled).toBe(true);
    expect(document.querySelector('input[aria-label="筛选库存型号"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="筛选库存品牌"]')).not.toBeNull();
    expect(button("刷新")).toBeTruthy(); expect(button("表格上传")).toBeTruthy(); expect(button("单条上传")).toBeTruthy();
  });
});
