// @vitest-environment jsdom
import React, { act } from "react";
import * as XLSX from "xlsx";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectHostTab, selectHostView, hostNavigate } from "./ChannelInventoryHost.router-test-helper";
import { getChannelInventoryNavigationTab } from "../../../../../lib/channelInventoryNavigation";
import { BUSINESS_INDUSTRY_OPTIONS } from "../../../shared/businessIndustry";
import { DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnsStorageKey, channelInventoryColumnLayout } from "./channelInventoryColumns";

vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));

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
  const listTeamMaterials = vi.fn();
  const getChannel = vi.fn();
  return {
    getMaterial, getChannel, getTeamMaterialSource, listTeamSourceOptions, listTeamMaterials,
    toastError: vi.fn(),
    scope: { officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: "native-v1" }, storageScope: "test-bound-scope", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 }, contextVerification: { state: "verified", identity: "test-bound-scope", authorizationVersion: "auth-v1", readVersion: "auth-v1" }, onAuthorizationError: vi.fn() },
    getTeamMaterialForEdit, collaborationAdd, collaborationEdit,
    collaborationQuery: null as unknown,
    collaborationInputs: [] as unknown[],
    exportChannelMaterials,
    teamQuery: null as unknown,
    exactTeamQuery: null as unknown,
    sourceQuery: null as unknown,
    sourceInputs: [] as unknown[],
    channelInputs: [] as unknown[],
    materialInputs: [] as unknown[],
    exactStockInputs: [] as unknown[],
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
    notesAdd: vi.fn().mockResolvedValue({}),
    notesEdit: vi.fn().mockResolvedValue({}),
    deleteMaterials: vi.fn().mockResolvedValue({}),
    enterpriseMe: null as unknown,
    channelQuery: null as unknown,
    uploadOptionsQuery: null as unknown,
    getChannelQuery: null as unknown,
    materialQuery: null as unknown,
    sharedQuery: null as unknown,
    notesQuery: null as unknown,
    utils: {
      client: { channelInventory: { createUploadBatch: { mutate: vi.fn().mockResolvedValue({ id: 501, batchCode: "TEST-BATCH", revision: 1 }) }, getChannel: { query: getChannel }, listTeamMaterials: { query: listTeamMaterials }, getTeamMaterialSource: { query: getTeamMaterialSource }, listTeamSourceOptions: { query: listTeamSourceOptions }, exportChannelMaterials: { query: exportChannelMaterials }, getTeamMaterialForEdit: { query: getTeamMaterialForEdit }, collaborationNotesAdd: { mutate: collaborationAdd }, collaborationNotesEdit: { mutate: collaborationEdit } } },
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
          return (input as { channelId?: number }).channelId && runtime.exactTeamQuery ? runtime.exactTeamQuery : runtime.teamQuery;
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
          return (input as { pageSize?: number }).pageSize === 100 && runtime.uploadOptionsQuery ? runtime.uploadOptionsQuery : runtime.channelQuery;
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
      notesAdd: { useMutation: () => ({ isPending: false, mutateAsync: runtime.notesAdd }) },
      notesEdit: { useMutation: () => ({ isPending: false, mutateAsync: runtime.notesEdit }) },
    },
  },
}));

import ChannelInventoryHost, { channelInventoryUpdatedAt } from "./ChannelInventoryHost";

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
    [...Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')), ...Array.from(document.body.querySelectorAll("button"))].find(
      item => item.textContent?.trim() === name,
    ),
    `missing button: ${name}`,
  );
}

function expectNoGlobalUpload() {
  const toolbar = document.querySelector('.ci-toolbar[aria-label="材料筛选"]');
  expect(document.querySelector(".ci-tabbar,.ci-heading-actions")).toBeNull();
  expect(Array.from(toolbar?.querySelectorAll("button") ?? []).find(item => item.textContent === "单条上传" || item.textContent === "上传库存")).toBeUndefined();
}

async function openLegacyBatch() {
  selectHostTab("channels");
  click(required(document.querySelector(".ci-channel-table .ci-row-actions button"), "missing legacy row upload"));
  await settle();
  expect(document.querySelector('[aria-label="上传库存表格"]')).not.toBeNull();
}

function openMore(index = 0) {
  const trigger = required(document.querySelectorAll<HTMLButtonElement>('.ci-channel-table [data-slot="dropdown-menu-trigger"]')[index], "missing more trigger");
  act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  return required(document.querySelector<HTMLElement>('.ci-channel-actions-menu[role="menu"]'), "missing portalled menu");
}

function menuItem(name: string) {
  if (!document.querySelector('.ci-channel-actions-menu[role="menu"]')) openMore();
  return required(Array.from(document.querySelectorAll<HTMLElement>('.ci-channel-actions-menu [role="menuitem"]')).find(item => item.textContent?.trim() === name), `missing menu item: ${name}`);
}

function materialMenuItem(name: string, index = 0) {
  if (!document.querySelector('.ci-channel-actions-menu[role="menu"]')) {
    const row = required(document.querySelectorAll('.ci-compact-stock-table tbody tr')[index], "missing inventory row");
    const trigger = required(row.querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]'), "missing inventory more trigger");
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  }
  const menu = required(document.querySelector<HTMLElement>('.ci-channel-actions-menu[role="menu"]'), "missing portalled inventory menu");
  return required(Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.trim() === name), `missing inventory menu item: ${name}`);
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
    // Radix FocusScope restores focus in a timer after a portalled menu unmounts.
    // Wait for that real lifecycle, not just the React promise microtask.
    await new Promise(resolve => setTimeout(resolve, 0));
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
  runtime.scope = { officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: "native-v1" }, storageScope: "test-bound-scope", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 }, contextVerification: { state: "verified", identity: "test-bound-scope", authorizationVersion: "auth-v1", readVersion: "auth-v1" }, onAuthorizationError: vi.fn() };
  runtime.getTeamMaterialSource.mockReset().mockResolvedValue({ name: "实时核验来源" });
  runtime.listTeamSourceOptions.mockReset().mockImplementation((input: unknown) => { runtime.sourceInputs.push(input); return Promise.resolve((runtime.sourceQuery as { data: unknown }).data); });
  runtime.exactTeamQuery = null;
  runtime.listTeamMaterials.mockReset().mockImplementation((input: unknown) => { runtime.exactStockInputs.push(input); return Promise.resolve(((runtime.exactTeamQuery || runtime.teamQuery) as { data: unknown }).data); });
  runtime.exportChannelMaterials.mockReset().mockResolvedValue(exportFixture());
  runtime.uploadOptionsQuery = null;
  runtime.channelInputs = [];
  runtime.sourceInputs = [];
  runtime.materialInputs = [];
  runtime.exactStockInputs = [];
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
  runtime.notesAdd.mockReset().mockResolvedValue({});
  runtime.notesEdit.mockReset().mockResolvedValue({});
  runtime.deleteMaterials.mockReset().mockResolvedValue({});
  Object.assign(runtime.utils.client.channelInventory, { deleteMaterials: { mutate: runtime.deleteMaterials } });
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
    canEdit: true,
    readOnly: false,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-02T01:00:00.000Z",
  });
  runtime.getChannel.mockReset().mockImplementation((input: unknown) => {
    runtime.getChannelInputs.push(input);
    return Promise.resolve((runtime.getChannelQuery as { data: unknown }).data);
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
  (runtime.notesQuery as { refetch: ReturnType<typeof vi.fn> }).refetch.mockImplementation(async () => runtime.notesQuery);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  hostNavigate.mockClear();
  configureFixtures();
  sessionStorage.clear();
  localStorage.clear();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("ChannelInventoryHost new equivalent reconstruction", () => {
  it("defaults to unified inventory without old tabs, share buttons or private row DOM", () => {
    renderHost();
    const tabs = document.querySelector('[aria-label="渠道库存内容"]');
    expect(tabs).toBeNull();
    expect(document.querySelector('[role="tablist"], .ci-tabs')).toBeNull();
    expect(getChannelInventoryNavigationTab(window.location.search)).toBe("materials");
    expect(document.querySelector('[aria-label="库存可见范围"]')).toBeNull();
    expect(document.body.textContent).toContain("LM358DR");
    expect(document.body.textContent).toContain("TEAM-SN74");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector(".ci-tabbar,.ci-heading-actions,.ci-inventory-view-controls")).toBeNull();
    expect(document.querySelector("h1.ci-sr-only")?.textContent).toBe("库存列表");
    expectNoGlobalUpload();
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
    expect(rows[1].querySelector(".ci-source-link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("深圳代理");
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled();
    expect(runtime.sourceInputs).toHaveLength(0);
    expect(runtime.optionInputs).toHaveLength(0);
    expect(rows[1].querySelector(".ci-part-copy-button")).not.toBeNull();
    expect(Array.from(rows[1].querySelectorAll("button:not(.ci-part-copy-button)")).map(item => item.textContent)).toEqual(["发布", "备注（0）"]);
    expect(Array.from(rows[0].querySelectorAll("button:not(.ci-part-copy-button)")).map(item => item.textContent)).toEqual(["查看来源", "发布", "备注（1）", "本人备注", "更多"]);
    for (const row of rows) {
      const publish = required(row.querySelector<HTMLButtonElement>('[data-factory-publish-action]'), "missing publish action");
      expect(publish.disabled).toBe(true);
      expect(publish.title).toBe("当前账号没有该材料的发布权限");
      click(publish);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(rows[1].querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();
    expect(rows[1].querySelector("[title]:not(.ci-material-recorder-col):not(.ci-material-brand-col):not([data-factory-publish-action]), [hidden], input")).toBeNull();
    expect(rows[1].querySelector(".ci-material-recorder-col")?.getAttribute("title")).toBe(rows[1].querySelector(".ci-material-recorder-col")?.textContent);
    expect(runtime.setMaterialShare).not.toHaveBeenCalled();
    const edit = materialMenuItem("编辑");
    const menu = required(edit.closest('[role="menu"]'), "missing inventory actions menu");
    expect(menu.closest("table,.ci-tablewrap,.ci-host")).toBeNull();
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["编辑"]);
    expect(edit.hasAttribute("data-disabled")).toBe(false);
    expect(runtime.getTeamMaterialForEdit).not.toHaveBeenCalled();
  });

  it("denies source filtering without exposing own upload options", () => {
    renderHost();
    const filter = required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter");
    expect(filter.disabled).toBe(true);
    expect(filter.textContent).toBe("全部可见库存");
    expect(filter.innerHTML).not.toContain("深圳代理");
    expect(filter.querySelectorAll("option")).toHaveLength(1);
    expectNoGlobalUpload();
    expect(document.querySelector('[aria-label="关联渠道"]')).toBeNull();
    expect(runtime.optionInputs).toHaveLength(0);
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
    expect(Array.from(peer.querySelectorAll("button:not(.ci-part-copy-button)")).map(item => item.textContent)).toEqual(["查看来源", "发布", "备注（0）"]);
    const publish = required(peer.querySelector<HTMLButtonElement>('[data-factory-publish-action]'), "missing peer publish");
    expect(publish.disabled).toBe(true);
    expect(publish.title).toBe("当前账号没有该材料的发布权限");
    expect(peer.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "团队来源" });
    click(required(peer.querySelector(".ci-source-link"), "missing source link"));
    await settle();
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("团队来源");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(peer.querySelector("[title]:not(.ci-material-recorder-col):not(.ci-material-brand-col):not([data-factory-publish-action]), [hidden], input")).toBeNull();
    expect(publish.title).toBe("当前账号没有该材料的发布权限");
    expect(peer.querySelector(".ci-material-recorder-col")?.getAttribute("title")).toBe(peer.querySelector(".ci-material-recorder-col")?.textContent);
    expect(runtime.getMaterial).not.toHaveBeenCalled();
  });

  it("shows channel timestamps in Beijing even when the visitor timezone is UTC", () => {
    const previous = process.env.TZ;
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    try {
      renderHost();
      expect(document.querySelector(".ci-updated-at-trigger")?.textContent).toBe("10-03 09:00");
      expect(document.querySelector(".ci-updated-at-trigger")?.getAttribute("aria-label")).toBe("2026-10-03 09:00:00（北京时间）");
      expect(document.body.textContent).not.toContain("2026-10-03 01:00");
      selectHostTab("channels");
      expect(document.body.textContent).toContain("2026-10-02 09:00");
      expect(document.body.textContent).not.toContain("2026-10-02 01:00");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("renders the authoritative channel table, resets filters, creates a channel and keeps CAS on enable/disable", async () => {
    renderHost();
    selectHostTab("channels");
    expect(document.querySelector('[aria-label="渠道管理列表"]')).not.toBeNull();
    expect(getChannelInventoryNavigationTab(window.location.search)).toBe("channels");
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

    click(menuItem("编辑渠道"));
    const editDialog = required(document.querySelector('[role="dialog"]'), "missing channel edit dialog");
    change(control(editDialog, "渠道名称") as HTMLInputElement, "深圳代理更新");
    change(control(editDialog, "所属行业"), "communications");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledWith(expect.objectContaining({
      expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, name: "深圳代理更新", industryCode: "communications",
    }));

    click(menuItem("停用"));
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
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined, page: 1 });
    click(button("搜索"));
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
    expect(filter.textContent).toBe("全部可见库存");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined, page: 1 });
    expect(runtime.sharedInputs).toHaveLength(0);
    expect(runtime.getChannelInputs).toHaveLength(0);
  });

  it("cycles server quantity sort default desc asc default, resets page and preserves server ordering/page count", async () => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "dateCode"]));
    renderHost();
    const qty = required(document.querySelector<HTMLButtonElement>('[aria-label="按可供数量排序"]'), "missing qty sort");
    const dc = required(document.querySelector<HTMLButtonElement>('[aria-label="按 Date Code 排序"]'), "missing date sort");
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(qty.querySelectorAll(".ci-quantity-sort-icon path")).toHaveLength(2);
    expect(qty.querySelectorAll(".ci-sort-active")).toHaveLength(0);
    expect(qty.getAttribute("title")).toBe("数量默认顺序；点击数量从多到少");
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ page: 2 });
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "desc", page: 1 });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(qty.querySelectorAll(".ci-quantity-sort-icon path")).toHaveLength(2);
    expect(qty.querySelectorAll(".ci-sort-active")).toHaveLength(1);
    expect(qty.getAttribute("title")).toBe("数量从多到少；点击数量从少到多");
    expect(document.querySelector(".ci-sort-status")?.textContent).toBe("数量从多到少 · 待确认数量排末尾");
    // Null quantity stays first exactly as the server returned, not a client-page sort.
    expect(document.querySelector("tbody tr")?.textContent).toContain("LM358DR");
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "desc", page: 2 });
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "asc", page: 1 });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(qty.querySelectorAll(".ci-quantity-sort-icon path")).toHaveLength(2);
    expect(qty.querySelectorAll(".ci-sort-active")).toHaveLength(1);
    expect(qty.getAttribute("title")).toBe("数量从少到多；点击恢复默认顺序");
    expect(document.querySelector(".ci-sort-status")?.textContent).toBe("数量从少到多 · 待确认数量排末尾");
    expect(Array.from(document.querySelectorAll("tbody .ci-cell-title")).map(row => row.textContent)).toEqual(["LM358DR", "TEAM-SN74"]);
    click(button("下一页"));
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: "qty", sortDirection: "asc", page: 2 });
    click(qty);
    expect(runtime.materialInputs.at(-1)).toMatchObject({ sortBy: undefined, sortDirection: undefined, page: 1 });
    expect(qty.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(qty.querySelectorAll(".ci-quantity-sort-icon path")).toHaveLength(2);
    expect(qty.querySelectorAll(".ci-sort-active")).toHaveLength(0);
    expect(qty.getAttribute("title")).toBe("数量默认顺序；点击数量从多到少");
    expect(document.querySelector(".ci-sort-status")?.textContent).toBe("数量默认顺序");
    expect(Array.from(document.querySelectorAll("tbody .ci-cell-title")).map(row => row.textContent)).toEqual(["LM358DR", "TEAM-SN74"]);
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
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined, page: 1 });
    click(button("搜索"));
    await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 22, page: 1 });
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
    runtime.scope.contextVerification.readVersion = "source-role-revoked-v2";
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(document.body.innerHTML).not.toContain("团队来源");
    expect(document.querySelectorAll("tbody tr")[1].querySelector(".ci-source-link")).toBeNull();
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
  });

  it("does not open an public detail response arriving after permission revocation", async () => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(materialMenuItem("编辑"));
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
    click(materialMenuItem("编辑"));
    expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledTimes(1);
    expect(runtime.getMaterial).not.toHaveBeenCalled();
    selectHostTab("channels");
    if (returnToInventory) selectHostTab("materials");
    await act(async () => { finish(detail); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("历史库存备注");
    expect(getChannelInventoryNavigationTab(window.location.search)).toBe(returnToInventory ? "materials" : "channels");
  });

  it("does not reopen a late public editor when a top-entry view replaces the retired new-upload entrance", async () => {
    let finish!: (value: unknown) => void;
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); click(materialMenuItem("编辑"));
    expectNoGlobalUpload(); selectHostView("channels");
    await act(async () => finish({ ...(runtime.materialQuery as { data: { items: unknown[] } }).data.items[0], channelId: 11 }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("历史库存备注");
    expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });

  it("suppresses a late detail error after top-entry navigation without any new-upload CTA", async () => {
    let reject!: (error: Error) => void;
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    renderHost(); click(materialMenuItem("编辑")); expectNoGlobalUpload();
    selectHostView("channels"); selectHostView("flat");
    await act(async () => reject(new Error("STALE-DETAIL-ERROR")));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("STALE-DETAIL-ERROR");
  });

  it("keeps batch upload active when an older public detail resolves", async () => {
    let finish!: (value: unknown) => void;
    const detail = (runtime.materialQuery as { data: { items: unknown[] } }).data.items[0];
    runtime.getTeamMaterialForEdit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost();
    click(materialMenuItem("编辑"));
    await openLegacyBatch();
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
    expectNoGlobalUpload();
    expect(runtime.getMaterial).not.toHaveBeenCalled();
  });

  it("clears filters, sort and editors when the authenticated context changes", async () => {
    renderHost();
    change(required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存型号"]'), "missing part filter"), "FILTER");
    click(required(document.querySelector('[aria-label="按可供数量排序"]'), "missing sort"));
    click(materialMenuItem("编辑")); await settle();
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ expectedEnterpriseId: 32, expectedActorUserId: 8, partNumber: undefined, channelId: undefined, sortBy: undefined, page: 1 });
  });

  it("applies readable archive table constraints to native th and td elements", async () => {
    renderHost();
    selectHostTab("materials");
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

    // v20 explicitly widens quote/lead time without shrinking other columns.
    expect((stockTable as HTMLTableElement).style.getPropertyValue("--ci-stock-min-width")).toBe(`${channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false).minWidth}px`);
    expect(tableStyle.tableLayout).toBe("fixed");
    expect((stockTable.querySelector('col[data-column="actions"]') as HTMLTableColElement).style.width).toBe("216px");
    expect(headerStyle.paddingTop).toBe("6px");
    expect(headerStyle.paddingRight).toBe("10px");
    // jsdom preserves var() rather than resolving scoped admin tokens.
    expect(headerStyle.lineHeight).toBe("var(--admin-content-caption-line-height, 18px)");
    expect(cellStyle.paddingTop).toBe("6px");
    expect(cellStyle.paddingRight).toBe("10px");
    // Model is the default first column; ordinal remains optional.
    expect(cellStyle.lineHeight).toBe("var(--admin-content-line-height, 18px)");
    expect(getComputedStyle(required(
      stockTable.querySelector(".ci-cell-title"),
      "missing primary model text",
    )).lineHeight).toBe("var(--admin-content-line-height, 18px)");
  });

  it("separates quote and lead-time headings/values using only local width and padding, leaving actions and all columns intact", () => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "industry"]));
    renderHost();
    const table = required(document.querySelector(".ci-compact-stock-table"), "missing stock table");
    expect(table.querySelectorAll("thead th")).toHaveLength(12);
    for (const row of table.querySelectorAll("tbody tr")) {
      expect(row.querySelectorAll("td")).toHaveLength(12);
      expect(row.querySelector(".ci-col-actions")?.textContent).toContain("备注（");
    }
    for (const selector of ["th.ci-material-price-col", "td.ci-material-price-col"]) {
      const style = getComputedStyle(required(table.querySelector(selector), "missing quote cell"));
      expect((table.querySelector('col[data-column="price"]') as HTMLTableColElement).style.width).toBe("128px"); expect(style.paddingRight).toBe("18px"); expect(style.textAlign).toBe("center");
    }
    for (const selector of ["th.ci-material-lead-col", "td.ci-material-lead-col"]) {
      const style = getComputedStyle(required(table.querySelector(selector), "missing lead cell"));
      expect((table.querySelector('col[data-column="leadTime"]') as HTMLTableColElement).style.width).toBe("112px"); expect(style.paddingLeft).toBe("18px");
    }
    expect(getComputedStyle(required(table.closest(".ci-tablewrap"), "missing stock scroller")).overflowX).toBe("auto");
    expect((table.querySelector('col[data-column="recorder"]') as HTMLTableColElement).style.width).toBe("96px");
    expect((table.querySelector('col[data-column="industry"]') as HTMLTableColElement).style.width).toBe("110px");
    const actions = getComputedStyle(required(table.querySelector("td.ci-col-actions"), "missing actions"));
    expect((table.querySelector('col[data-column="actions"]') as HTMLTableColElement).style.width).toBe("216px"); expect(actions.position).toBe("sticky"); expect(actions.right).toBe("0px");
  });

  it("gives industry and delivery the same regular body role while keeping model and supporting data hierarchy", () => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "industry"]));
    renderHost();
    const table = required(document.querySelector(".ci-compact-stock-table"), "missing stock table");
    const industry = required(table.querySelector("td.ci-material-industry-col"), "missing industry cell");
    const lead = required(table.querySelector("td.ci-material-lead-col"), "missing delivery cell");
    expect(lead.classList.contains("admin-cell-primary")).toBe(true);
    expect(lead.classList.contains("admin-cell-secondary")).toBe(false);
    const industryStyle = getComputedStyle(industry);
    const leadStyle = getComputedStyle(lead);
    expect(leadStyle.fontSize).toBe(industryStyle.fontSize);
    expect(leadStyle.fontWeight).toBe(industryStyle.fontWeight);
    expect(leadStyle.color).toBe(industryStyle.color);
    expect(leadStyle.lineHeight).toBe(industryStyle.lineHeight);
    expect(leadStyle.fontWeight).toBe("400");
    for (const selector of ["td.ci-material-recorder-col", "td.ci-material-qty-col", "td.ci-material-price-col"]) {
      expect(getComputedStyle(required(table.querySelector(selector), "missing regular body cell")).fontWeight).toBe("400");
    }
    expect(getComputedStyle(required(table.querySelector(".ci-cell-title"), "missing model title")).fontWeight).toBe("600");
    expect(table.querySelector(".ci-date .ci-updated-at")?.classList.contains("admin-cell-secondary")).toBe(true);
  });

  it("omits only unknown tax subtext, preserving negotiated/zero/precise prices, known tax flags and real lead-time fallbacks", () => {
    const original = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    const base = original.data.items[0];
    runtime.teamQuery = query({ ...original.data, items: [
      { ...base, id: 101, price: null, taxIncluded: null, leadTime: null },
      { ...base, id: 102, price: "0", taxIncluded: false, leadTime: "现货" },
      { ...base, id: 103, price: "123.450000000001", taxIncluded: true, leadTime: "7-10个工作日" },
      { ...base, id: 104, price: null, taxIncluded: true, leadTime: "" },
    ] });
    renderHost();
    const rows = Array.from(document.querySelectorAll(".ci-compact-stock-table tbody tr"));
    expect(rows.map(row => row.querySelector(".ci-price")?.textContent)).toEqual(["面议", "¥0未税", "¥123.450000000001含税", "面议含税"]);
    expect(rows[0].querySelector(".ci-price small")).toBeNull();
    expect(rows.map(row => row.querySelector(".ci-lead-time")?.textContent)).toEqual(["待确认", "现货", "7-10个工作日", "待确认"]);
    expect(document.body.textContent).not.toContain("税务待确认");
    if (process.env.CHANNEL_PRICING_FIXTURE_PATH) writeFileSync(process.env.CHANNEL_PRICING_FIXTURE_PATH, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual ChannelInventoryHost synthetic v20 pricing render</title></head><body data-admin-readability="true" data-business-native-fonts="true"><main class="admin-workspace-shell__main admin-unified-content" data-admin-ui-system="channel-inventory">${required(container, "missing rendered host").innerHTML}</main></body></html>\n`);
    expect(runtime.createMaterial).not.toHaveBeenCalled(); expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });

  it("removes global creation while keeping public editing separate from owner private history", async () => {
    renderHost(); selectHostTab("materials"); await settle();
    expectNoGlobalUpload(); expect(runtime.createMaterial).not.toHaveBeenCalled();

    click(materialMenuItem("编辑"));
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
    await openLegacyBatch();
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
    expect(dto[0]).toEqual({ uploadBatchId: 501, expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 11, partNumber: "ZERO", brand: "TI", qty: 0, dateCode: "002601", price: "0", currency: "CNY", taxIncluded: null, leadTime: null, note: "本人私有", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
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
    await openLegacyBatch();
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
    await openLegacyBatch();
    chooseBatchChannel();
    await uploadSheet([["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"], ["THREE", "TI"]]);
    previewBatch();
    click(button("确认上传 3 条"));
    await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(2);
    const unknownDto = runtime.createMaterial.mock.calls[1][0];
    click(button("取消"));
    await openLegacyBatch();
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
    await openLegacyBatch();
    chooseBatchChannel();
    await uploadSheet([["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"]]);
    previewBatch();
    click(button("确认上传 2 条"));
    await settle();
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

  it("removes single creation CTA while retaining zero/exact price and edit CAS", async () => {
    renderHost(); expectNoGlobalUpload();
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    click(materialMenuItem("编辑")); await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing edit inventory");
    expect(control(dialog, "可供数量").getAttribute("placeholder")).toBe("待确认");
    expect(control(dialog, "报价 CNY").getAttribute("placeholder")).toBe("面议");
    change(control(dialog, "可供数量"), "0");
    change(control(dialog, "报价 CNY"), "123456789012345.123456789012");
    expect(dialog.querySelector("h2")?.textContent).toBe("编辑渠道库存");
    expect((control(dialog, "关联渠道") as HTMLSelectElement).disabled).toBe(true);
    change(control(dialog, "型号"), "EDITED");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 101, expectedRevision: 9, partNumber: "EDITED", qty: 0, price: "123456789012345.123456789012", expectedEnterpriseId: 31, expectedActorUserId: 7 }));
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
  it("keeps download in the ordered menu and permits read-only channels without leader source privileges", async () => {
    const old = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    // Effective management write is independent of this readable record's edit denial.
    runtime.channelQuery = query({ ...old.data, canWrite: true, items: old.data.items.map(item => ({ ...item, canEdit: false, readOnly: true })) });
    renderHost(); selectHostTab("channels");
    const actions = document.querySelector(".ci-row-actions")!;
    expect(Array.from(actions.querySelectorAll("button")).map(item => item.textContent)).toEqual(["上传库存", "更多操作"]);
    const menu = openMore();
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["查看库存", "下载库存", "编辑渠道", "停用"]);
    expect(menuItem("下载库存").hasAttribute("data-disabled")).toBe(false); expect(menuItem("编辑渠道").hasAttribute("data-disabled")).toBe(true);
    click(menuItem("下载库存"));
    expect(menuItem("下载中…").hasAttribute("data-disabled")).toBe(true);
    click(menuItem("下载中…"));
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
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    const book = exportedBook(); const sheet = book.Sheets["渠道库存"];
    for (const address of ["A3", "B3", "D3", "H3"]) {
      expect(sheet[address].t).toBe("s"); expect(sheet[address].f).toBeUndefined(); expect(String(sheet[address].v).startsWith("'")).toBe(true);
    }
    expect(book.Sheets["导出说明"].B1).toMatchObject({ t: "s", v: "'=EVIL/CHANNEL" });
    expect(vi.mocked(XLSX.writeFile).mock.calls[0][1]).not.toContain("/");
  });
  it("exports an empty inactive channel as a header-only workbook", async () => {
    runtime.exportChannelMaterials.mockResolvedValue({ ...exportFixture(), channel: { id: 11, name: "停用", type: "agent", active: false }, total: 0, items: [] });
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    expect(exportedBook().Sheets["渠道库存"]["!ref"]).toBe("A1:I1");
    expect(document.body.textContent).toContain("含表头的空表");
  });
  it.each(["企业", "账号", "权限", "切走再切回"])("drops an old export when %s changes during the request", async kind => {
    let finish!: (value: unknown) => void;
    runtime.exportChannelMaterials.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存"));
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
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存"));
    await act(async () => { root?.unmount(); }); root = null;
    await act(async () => { finish(exportFixture()); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });
  it("rechecks the authenticated subject before saving even if the page has not rerendered", async () => {
    const me = runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn>; data: object };
    me.refetch.mockResolvedValue(query({ ...me.data, currentUserId: 8 }));
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    expect(me.refetch).toHaveBeenCalledTimes(1); expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("未生成文件");
  });
  it("does not save if the context changes while the final identity recheck is pending", async () => {
    let finish!: (value: unknown) => void;
    const me = runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn>; data: object };
    me.refetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    expect(me.refetch).toHaveBeenCalled();
    runtime.enterpriseMe = query({ ...me.data, currentUserId: 8 }); act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await act(async () => { finish(me); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });
  it("shows a clear server limit error without downloading a partial current page", async () => {
    runtime.exportChannelMaterials.mockRejectedValueOnce(new Error("该渠道库存超过 10,000 条导出上限，未生成文件"));
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    expect(document.body.textContent).toContain("10,000 条导出上限"); expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(menuItem("下载库存").hasAttribute("data-disabled")).toBe(false);
  });
  it("rejects a mismatched DTO instead of saving it", async () => {
    runtime.exportChannelMaterials.mockResolvedValueOnce({ ...exportFixture(), actorUserId: 8 });
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存")); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("上下文不匹配");
  });
});


describe("linked company channel editing", () => {
  function linkedChannel(overrides: Record<string, unknown> = {}) {
    const result = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = {
      ...result.data.items[0], companyReadOnly: true, customerId: 81,
      name: "CRM权威公司", industryCode: "automotive", contactName: "CRM联系人",
      phone: "13900139000", wechat: "crm-wechat", qq: "123456", notes: "CRM公司说明",
      ...overrides,
    };
  }

  it("renders every company field read-only, keeps type editable and links to the real customer", async () => {
    linkedChannel();
    renderHost();
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing linked editor");
    expect(dialog.textContent).toContain("来自客户档案，仅可在客户档案维护；此处只修改供货类型");
    for (const [label, value] of [
      ["渠道名称", "CRM权威公司"], ["联系人", "CRM联系人"], ["联系电话", "13900139000"],
      ["微信", "crm-wechat"], ["QQ", "123456"], ["渠道说明", "CRM公司说明"],
    ]) {
      const field = control(dialog, label) as HTMLInputElement | HTMLTextAreaElement;
      expect(field.value).toBe(value);
      expect(field.disabled).toBe(true);
      expect(field.readOnly).toBe(true);
    }
    const industry = control(dialog, "所属行业") as HTMLSelectElement;
    expect(industry.value).toBe("automotive");
    expect(industry.disabled).toBe(true);
    expect(industry.required).toBe(false);
    expect(control(dialog, "渠道类型").disabled).toBe(false);
    click(button("前往客户档案"));
    await settle();
    expect(window.location.pathname).toBe("/customers/81");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
  });

  it.each(["automotive", undefined, null, "", "unknown-industry"])("saves only type and CAS/context when CRM industry is %s", async industryCode => {
    linkedChannel({ industryCode });
    renderHost();
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing linked editor");
    change(control(dialog, "渠道类型"), "trade");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledTimes(1);
    expect(runtime.updateChannel).toHaveBeenCalledWith({
      expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, type: "trade",
    });
    expect(runtime.createChannel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("请选择所属行业。");
  });

  it.each([undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "81", NaN])("does not enable linked editing or CRM navigation for invalid/missing customer ID %s", async customerId => {
    linkedChannel({ customerId });
    renderHost();
    selectHostTab("channels");
    const edit = menuItem("编辑渠道");
    expect(edit.hasAttribute("data-disabled")).toBe(true);
    expect(edit.getAttribute("title")).toContain("客户档案不可访问");
    click(edit);
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("前往客户档案");
    expect(runtime.updateChannel).not.toHaveBeenCalled();
  });

  it.each([{ canEdit: false }, { readOnly: true }])("keeps server read-only/access denial for linked channels %s", async permission => {
    linkedChannel(permission);
    renderHost();
    selectHostTab("channels");
    const edit = menuItem("编辑渠道");
    expect(edit.hasAttribute("data-disabled")).toBe(true);
    click(edit);
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
  });

  it("keeps the original confirmation/CAS menu for linked channel enable and disable", async () => {
    linkedChannel();
    renderHost();
    selectHostTab("channels");
    click(menuItem("停用"));
    await settle();
    expect(window.confirm).toHaveBeenCalledWith("确认停用渠道“CRM权威公司”吗？停用后不能新增或修改其库存。");
    expect(runtime.setChannelActive).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, active: false });
    const result = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0].active = false;
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    click(menuItem("启用"));
    await settle();
    expect(window.confirm).toHaveBeenLastCalledWith("确认启用渠道“CRM权威公司”吗？");
    expect(runtime.setChannelActive).toHaveBeenLastCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4, active: true });
    expect(runtime.updateChannel).not.toHaveBeenCalled();
  });

  it("does not infer linked status from customerId or bypass standalone industry validation", async () => {
    linkedChannel({ companyReadOnly: false, industryCode: null });
    renderHost();
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
    const dialog = required(document.querySelector('[role="dialog"]'), "missing standalone editor");
    for (const label of ["渠道名称", "所属行业", "联系人", "联系电话", "微信", "QQ", "渠道说明"]) {
      expect(control(dialog, label).disabled).toBe(false);
    }
    expect((control(dialog, "所属行业") as HTMLSelectElement).required).toBe(true);
    expect(dialog.textContent).not.toContain("前往客户档案");
    change(control(dialog, "渠道类型"), "other");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请选择所属行业。");
    change(control(dialog, "所属行业"), "medical");
    change(control(dialog, "渠道名称"), "独立渠道更新");
    change(control(dialog, "渠道说明"), "独立说明更新");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateChannel).toHaveBeenCalledWith({
      expectedEnterpriseId: 31, expectedActorUserId: 7, id: 11, expectedRevision: 4,
      name: "独立渠道更新", industryCode: "medical", type: "other", contactName: "CRM联系人",
      phone: "13900139000", wechat: "crm-wechat", qq: "123456", notes: "独立说明更新",
    });
  });

  it.each([false, true])("ignores a linked save response after real identity change (rejected=%s)", async rejected => {
    linkedChannel();
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    runtime.updateChannel.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    renderHost();
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
    click(button("保存修改"));
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] });
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    await settle();
    click(button("+ 新增渠道"));
    const newDialog = required(document.querySelector('[role="dialog"]'), "missing new identity editor");
    change(control(newDialog, "渠道名称"), "新身份草稿");
    await act(async () => { if (rejected) fail(new Error("STALE-LINKED-ERROR")); else finish({}); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBe(newDialog);
    expect(control(newDialog, "渠道名称").value).toBe("新身份草稿");
    expect(document.body.textContent).not.toContain("STALE-LINKED-ERROR");
  });
});


describe("channel industry required integration", () => {
  it("requires an explicit industry and keeps the same complete dictionary in the compact QQ-right slot", async () => {
    renderHost();
    selectHostTab("channels");
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
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
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
    selectHostTab("materials"); expectNoGlobalUpload();
    await openLegacyBatch();
    expect(document.querySelector('[aria-label="所属行业"]')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>('[aria-label="批量关联渠道"]')?.textContent).toContain("深圳代理");
  });

  it("echoes an existing channel industry and cannot edit a read-only source", async () => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "industry"]));
    const result = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0].industryCode = "renewable_energy";
    renderHost();
    selectHostTab("channels");
    click(menuItem("编辑渠道"));
    expect(document.querySelector<HTMLSelectElement>('[aria-label="所属行业"]')?.value).toBe("renewable_energy");
    click(button("取消"));
    result.data.items[0].readOnly = true;
    act(() => root?.render(React.createElement(ChannelInventoryHost)));
    click(menuItem("编辑渠道"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.updateChannel).not.toHaveBeenCalled();
    selectHostTab("materials");
    const peer = document.querySelectorAll("tbody tr")[1];
    expect(peer.querySelector(".ci-source-link")).toBeNull();
    expect(Array.from(peer.querySelectorAll("button:not(.ci-part-copy-button)")).map(item => item.textContent)).toEqual(["发布", "备注（0）"]);
    expect(required(peer.querySelector<HTMLButtonElement>('[data-factory-publish-action]'), "missing readonly publish").disabled).toBe(true);
    expect(peer.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();
    expect(peer.querySelector("select")).toBeNull();
    expect(document.querySelector("thead")?.textContent).toContain("所属行业");
  });
});


describe("v9 public inventory and collaboration integration", () => {
  it("allows a live team leader to edit peer public fields without private detail or writable channel options", async () => {
    const old = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...old.data, items: old.data.items.map(row => row.id === 202 ? { ...row, canEdit: true, readOnly: false } : row) });
    runtime.channelQuery = query({ items: [], total: 0, page: 1, pageSize: 100, canWrite: false });
    runtime.getTeamMaterialForEdit.mockResolvedValueOnce({ id: 202, channelId: 22, channelName: "团队来源", partNumber: "TEAM-SN74", brand: "NXP", qty: 0, dateCode: "2601", price: "0", currency: "CNY", taxIncluded: false, leadTime: null, revision: 12, canEdit: true, readOnly: false });
    renderHost();
    click(materialMenuItem("编辑", 1));
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
    expectNoGlobalUpload();
    const peer = document.querySelectorAll("tbody tr")[1];
    expect(peer.textContent).not.toContain("编辑");
    click(required(Array.from(peer.querySelectorAll("button")).find(item => item.textContent === "备注（0）"), "missing unified readonly note entry"));
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
    renderHost(); click(button("备注（1）")); await settle();
    const textarea = required(document.querySelector<HTMLTextAreaElement>("textarea"), "missing collaboration draft");
    act(() => textarea.focus());
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
    renderHost(); click(button("备注（1）")); await settle();
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
    renderHost(); click(materialMenuItem("编辑")); await settle();
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


describe("v11 real Host source authorization lifecycle", () => {
  const link = (index = 0) => required(document.querySelectorAll("tbody tr")[index]?.querySelector<HTMLButtonElement>(".ci-source-link"), "missing clickable source link");
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));

  it("keeps the actual dialog and focus through same-identity revalidation, masks old name and reads afresh on resume", async () => {
    renderHost(); click(link()); await settle();
    const dialog = document.querySelector(".ci-source-dialog"); const focused = document.activeElement;
    runtime.scope.contextVerification = { ...runtime.scope.contextVerification, state: "revalidating" };
    rerender(); await settle();
    expect(document.querySelector(".ci-source-dialog")).toBe(dialog);
    expect(document.activeElement).toBe(focused);
    expect(document.querySelector(".ci-source-name")).toBeNull();
    expect(dialog?.textContent).toContain("正在核验来源查看权限");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(1);
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "复核后实时来源" });
    runtime.scope.contextVerification = { ...runtime.scope.contextVerification, state: "verified" };
    rerender(); await settle();
    expect(document.querySelector(".ci-source-dialog")).toBe(dialog);
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("复核后实时来源");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(2);
    expect(runtime.toastError).not.toHaveBeenCalled();
  });

  it("does not use list refresh snapshots, metadata timestamps or negative row hints as source authorization", async () => {
    renderHost(); click(link()); await settle();
    const dialog = document.querySelector(".ci-source-dialog");
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query(undefined, { isLoading: true, isFetching: true });
    rerender(); await settle(); expect(document.querySelector(".ci-source-dialog")).toBe(dialog);
    runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => ({ ...row, canViewSource: false })) });
    (runtime.enterpriseMe as { data: { member: Record<string, unknown> } }).data.member.updatedAt = "2026-11-03T12:00:00Z";
    rerender(); await settle();
    expect(document.querySelector(".ci-source-dialog")).toBe(dialog);
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("实时核验来源");
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(1);
  });

  it.each(["authorizationVersion", "readVersion"] as const)("clears and aborts on a real changed %s even if identity stays the same", async field => {
    let finish!: (value: { name: string }) => void;
    runtime.getTeamMaterialSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); click(link());
    const signal = runtime.getTeamMaterialSource.mock.calls[0][1].signal as AbortSignal;
    runtime.scope.contextVerification[field] = "changed-effective-authorization"; rerender(); await settle();
    expect(signal.aborted).toBe(true); expect(document.querySelector(".ci-source-dialog")).toBeNull();
    await act(async () => finish({ name: "STALE-AUTHORITY-SOURCE" }));
    expect(document.body.textContent).not.toContain("STALE-AUTHORITY-SOURCE");
  });

  it("keeps exactly one denied state after NOT_FOUND and rerenders, then makes a new query on the next legal click", async () => {
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "NOT_FOUND", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    renderHost(); click(link()); await settle();
    const dialog = document.querySelector(".ci-source-dialog");
    rerender(); await settle(); rerender(); await settle();
    expect(document.querySelector(".ci-source-dialog")).toBe(dialog);
    expect(dialog?.textContent?.match(/暂无权限查看/g)).toHaveLength(1);
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(1); expect(runtime.toastError).not.toHaveBeenCalled();
    click(required(document.querySelector('[aria-label="关闭渠道来源"]'), "missing close"));
    click(link()); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("实时核验来源");
  });

  it("coalesces focus bursts, masks the ready value, and rejects a late response from before revalidation", async () => {
    renderHost(); click(link()); await settle();
    let oldFinish!: (value: { name: string }) => void;
    let newFinish!: (value: { name: string }) => void;
    runtime.getTeamMaterialSource.mockReturnValueOnce(new Promise(resolve => { oldFinish = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { newFinish = resolve; }));
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(2); expect(document.querySelector(".ci-source-name")).toBeNull();
    const oldSignal = runtime.getTeamMaterialSource.mock.calls[1][1].signal as AbortSignal;
    runtime.scope.contextVerification.state = "revalidating"; rerender(); await settle(); expect(oldSignal.aborted).toBe(true);
    runtime.scope.contextVerification.state = "verified"; rerender(); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(3);
    await act(async () => newFinish({ name: "NEW-FOCUS-PROOF" }));
    await act(async () => oldFinish({ name: "LATE-OLD-FOCUS-PROOF" }));
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("NEW-FOCUS-PROOF");
  });

  it.each(["AUTH_SESSION_INVALID", "STAFF_BINDING_INVALID", "TENANT_ACCESS_REVOKED"])("reports direct-read %s to the real session boundary and never retains old name", async businessFailure => {
    renderHost(); click(link()); await settle();
    const error = { data: { code: "FORBIDDEN", businessFailure } };
    runtime.getTeamMaterialSource.mockRejectedValueOnce(error);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(runtime.scope.onAuthorizationError).toHaveBeenCalledWith(error);
    expect(document.querySelector(".ci-source-name")).toBeNull();
    expect(document.querySelector(".ci-source-dialog")?.textContent).not.toContain("暂无权限查看");
  });

  it("hides negative-hint source entries without granting edit or hiding collaboration", async () => {
    renderHost();
    expect(document.querySelectorAll("tbody tr")[1].querySelector(".ci-source-link")).toBeNull();
    await settle();
    expect(runtime.toastError).not.toHaveBeenCalled();
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled();
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    expect(document.querySelectorAll("tbody tr")[1].textContent).toContain("备注（0）");
    expect(document.querySelectorAll("tbody tr")[1].textContent).not.toContain("编辑");
  });

  it("a refreshed positive source hint enables a fresh server-authorized source read without granting stock edit", async () => {
    runtime.getTeamMaterialSource.mockResolvedValueOnce({ name: "新授予实时来源" });
    renderHost();
    expect(document.querySelectorAll("tbody tr")[1].querySelector(".ci-source-link")).toBeNull();
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => row.id === 202 ? { ...row, canViewSource: true } : row) });
    rerender(); click(link(1)); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-source-name")?.textContent).toBe("新授予实时来源");
    expect(runtime.toastError).not.toHaveBeenCalled();
    expect(document.querySelectorAll("tbody tr")[1].textContent).not.toContain("编辑");
    expect(document.querySelectorAll("tbody tr")[1].textContent).toContain("备注（0）");
  });

  it("handles fresh server denial despite an old positive row hint and never displays a stale name", async () => {
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    renderHost(); click(link()); await settle();
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledWith({ materialId: 101, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(document.querySelector(".ci-source-dialog")).not.toBeNull();
    expect(runtime.toastError).not.toHaveBeenCalled();
    expect(document.querySelector(".ci-source-dialog")?.textContent).toContain("暂无权限查看");
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
    runtime.getTeamMaterialSource.mockRejectedValueOnce({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(runtime.getTeamMaterialSource).toHaveBeenCalledTimes(3);
    expect(document.querySelector(".ci-source-dialog")).not.toBeNull();
    expect(document.body.innerHTML).not.toContain("再次实时核验");
    expect(runtime.toastError).not.toHaveBeenCalled();
    expect(document.querySelector(".ci-source-dialog")?.textContent).toContain("暂无权限查看");
  });

  it.each(["actor", "enterprise", "binding", "team", "role", "read", "list-denial", "archive"])("aborts and clears source on %s, ignoring a late response", async change => {
    let finish!: (value: { name: string }) => void;
    runtime.getTeamMaterialSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); click(link());
    const signal = runtime.getTeamMaterialSource.mock.calls[0][1].signal as AbortSignal;
    const enterprise = runtime.enterpriseMe as { data: Record<string, unknown> };
    const material = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    if (change === "actor") enterprise.data.currentUserId = 8;
    if (change === "enterprise") enterprise.data.enterprise = { id: 32 };
    if (change === "binding") runtime.scope.storageScope = "new-binding";
    if (change === "team") runtime.scope.contextVerification.readVersion = "team-revoked-v2";
    if (change === "role") runtime.scope.frontUser.role = "changed-role";
    if (change === "read") enterprise.data.permissionKeys = [];
    if (change === "revalidating") runtime.scope.contextVerification.state = "revalidating";
    if (change === "list-denial") runtime.teamQuery = query(undefined, { isError: true });
    if (change === "row-revocation") runtime.teamQuery = query({ ...material.data, items: material.data.items.map(row => ({ ...row, canViewSource: false })) });
    if (change === "archive") selectHostTab("channels"); else rerender();
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
    click(materialMenuItem("编辑")); await settle();
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
    runtime.scope.storageScope = "revoked-binding"; rerender(); await settle();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ canFilterSource: true, items: [{ id: 888, name: "LATE-OPTION" }] }); await Promise.resolve(); });
    expect(document.body.innerHTML).not.toContain("LATE-OPTION");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: undefined });
  });

  it("retains the complete column ordering/type/filter/control contract with the approved compact header and no demo content", () => {
    renderHost();
    expect(Array.from(document.querySelectorAll("thead th")).map(item => item.textContent)).toEqual(["型号", "品牌", "负责人", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]);
    expect(document.querySelectorAll("h1,.ci-page-title")).toHaveLength(1);
    expect(document.querySelector(".ci-tabbar,.ci-heading-actions,.ci-inventory-view-controls")).toBeNull();
    const title = required(document.querySelector("h1.ci-sr-only"), "missing accessible title");
    expect(title.textContent).toBe("库存列表");
    expect(getComputedStyle(title).position).toBe("absolute");
    expect(getComputedStyle(title).height).toBe("1px");
    expectNoGlobalUpload();
    expect(document.querySelector('[aria-label="更多库存管理"]')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/库存明细|切换示例身份|leader|creator/);
    expect(getComputedStyle(required(document.querySelector(".ci-filter-label"), "missing original a11y label")).position).toBe("absolute");
    expect(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')?.disabled).toBe(true);
    expect(document.querySelector('input[aria-label="筛选库存型号"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="筛选库存品牌"]')).not.toBeNull();
    expect(button("刷新")).toBeTruthy(); expectNoGlobalUpload();
  });
});


describe("v13 native channel read and original recorder contract", () => {
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  it("renders only the authoritative original recorder, using 待核实 for null and no actor/editor fallback", () => {
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = { ...result.data.items[0], originalRecorderName: "Jack", responsibleName: "WRONG-RESPONSIBLE", latestEditorName: "WRONG-EDITOR" };
    result.data.items[1] = { ...result.data.items[1], originalRecorderName: null, responsibleName: "WRONG-RESPONSIBLE", latestEditorName: "WRONG-EDITOR" };
    renderHost();
    expect(Array.from(document.querySelectorAll("thead th")).map(cell => cell.textContent)).toEqual(["型号", "品牌", "负责人", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]);
    expect(Array.from(document.querySelectorAll("tbody tr")).map(row => row.querySelectorAll("td").length)).toEqual([11, 11]);
    expect(Array.from(document.querySelectorAll("td.ci-material-recorder-col")).map(cell => cell.textContent)).toEqual(["Jack", "待核实"]);
    expect(Array.from(document.querySelectorAll("td.ci-material-recorder-col")).map(cell => cell.getAttribute("title"))).toEqual(["Jack", "待核实"]);
    expect(getComputedStyle(document.querySelector("td.ci-material-recorder-col")!).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(document.querySelector("td.ci-material-recorder-col")!).textOverflow).toBe("ellipsis");
    expect((document.querySelector('col[data-column="recorder"]') as HTMLTableColElement).style.width).toBe("96px");
    expect(getComputedStyle(document.querySelector("thead th")!).fontSize).toBe("var(--admin-content-font-caption, 11px)");
    expect(getComputedStyle(document.querySelector("tbody .ci-cell-title")!).fontSize).toBe("var(--admin-content-font-body, 12px)");
    expect(document.body.textContent).not.toMatch(/WRONG-RESPONSIBLE|WRONG-EDITOR/);
  });
  it.each(["loading", "error", "empty"])("uses default eleven-column colspan for %s without misaligning existing table", status => {
    runtime.teamQuery = status === "loading" ? query(undefined, { isLoading: true }) : status === "error" ? query(undefined, { isError: true }) : query({ items: [], total: 0, pageCount: 1 });
    renderHost();
    expect(document.querySelector("tbody td")?.getAttribute("colspan")).toBe("11");
    expect(document.querySelectorAll("thead th")).toHaveLength(11);
  });
  it("allows native read with no ERP edit permission, but cannot open uploads, edit or note forms even from stale writable row hints", async () => {
    runtime.scope.officialInventoryPermissions = { read: true, write: false, note: false, authorizationVersion: "native-read-only-v1" };
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: ["stocks.read"], isOwner: false });
    renderHost();
    expect(document.body.textContent).toContain("TEAM-SN74");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expectNoGlobalUpload();
    expectNoGlobalUpload();
    const edit = materialMenuItem("编辑");
    expect(edit.hasAttribute("data-disabled")).toBe(true);
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    expectNoGlobalUpload(); click(edit);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("新增备注");
    act(() => edit.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await settle();
    expect(document.querySelector('.ci-channel-actions-menu[role="menu"]')).toBeNull();
    runtime.collaborationQuery = query({ items: [{ id: 99, authorUserId: 7, authorName: "本人", content: "可读协作历史", canEdit: true, createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z" }], total: 1, canAdd: true });
    click(button("备注（1）")); await settle();
    expect(document.body.textContent).toContain("可读协作历史");
    expect(document.body.textContent).not.toContain("修改我的备注");
    expect(document.querySelector("textarea")).toBeNull();
    expect(runtime.getTeamMaterialForEdit).not.toHaveBeenCalled();
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(runtime.collaborationAdd).not.toHaveBeenCalled();
    expect(runtime.collaborationEdit).not.toHaveBeenCalled();
  });
  it("does not mistake ERP inventory.manage for native read and immediately masks cached rows", () => {
    renderHost();
    expect(document.body.textContent).toContain("LM358DR");
    runtime.materialInputs = [];
    runtime.scope.officialInventoryPermissions = { read: false, write: false, note: false, authorizationVersion: "native-read-revoked-v2" };
    rerender();
    expect(document.body.textContent).toContain("没有渠道库存查看权限");
    expect(document.body.textContent).not.toContain("LM358DR");
    expect(document.querySelector("table")).toBeNull();
    expect(runtime.materialInputs).toHaveLength(0);
  });
  it.each(["read", "write", "note", "authorizationVersion"] as const)("invalidates an in-flight source on a changed native %s proof", async field => {
    let finish!: (value: { name: string }) => void;
    runtime.getTeamMaterialSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); click(required(document.querySelector(".ci-source-link"), "missing source"));
    const signal = runtime.getTeamMaterialSource.mock.calls[0][1].signal as AbortSignal;
    if (field === "authorizationVersion") runtime.scope.officialInventoryPermissions.authorizationVersion = "native-grants-v2";
    else runtime.scope.officialInventoryPermissions[field] = false;
    rerender(); await settle();
    expect(signal.aborted).toBe(true);
    expect(document.querySelector(".ci-source-dialog")).toBeNull();
    await act(async () => finish({ name: "STALE-NATIVE-SOURCE" }));
    expect(document.body.textContent).not.toContain("STALE-NATIVE-SOURCE");
  });
  it("does not open a pending edit response after native write is revoked while read remains", async () => {
    let finish!: (value: unknown) => void;
    runtime.getTeamMaterialForEdit.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); click(materialMenuItem("编辑"));
    runtime.scope.officialInventoryPermissions.write = false; rerender(); await settle();
    await act(async () => finish({ ...(runtime.teamQuery as { data: { items: Record<string, unknown>[] } }).data.items[0], channelId: 11 }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("TEAM-SN74");
    expectNoGlobalUpload();
  });
  it.each(["stocks.read", "inventory.manage"])("denies native read-only export despite ERP %s", async permission => {
    runtime.scope.officialInventoryPermissions = { read: true, write: false, note: false, authorizationVersion: "native-reader-v1" };
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, isOwner: false, permissionKeys: [permission] });
    (runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn> }).refetch.mockResolvedValue(runtime.enterpriseMe);
    renderHost(); selectHostTab("channels");
    expect(menuItem("编辑渠道").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem("下载库存").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem("下载库存").title).toContain("没有库存导出权限");
    click(menuItem("下载库存")); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(runtime.exportChannelMaterials).not.toHaveBeenCalled();
    expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });
});


describe("v14 industry and channel-row stock upload", () => {
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  const archiveUpload = (index = 0) => required(document.querySelectorAll<HTMLButtonElement>(".ci-channel-table .ci-row-actions button")[index * 2], "missing row upload");
  const batchSelect = () => document.querySelector<HTMLSelectElement>('[aria-label="批量关联渠道"]');
  const channelFixture = (overrides: Record<string, unknown> = {}) => ({ ...(runtime.getChannelQuery as { data: Record<string, unknown> }).data, ...overrides });
  const options = (items: unknown[], overrides: Record<string, unknown> = {}) => query({ items, total: items.length, page: 1, pageSize: 100, pageCount: 1, canWrite: true, ...overrides });

  it("keeps five layout contracts: industry after recorder, fixed industry width, typography, scrolling and narrower two-action archive", () => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "industry"]));
    renderHost();
    const table = required(document.querySelector(".ci-compact-stock-table"), "missing stock table");
    expect(Array.from(table.querySelectorAll("th")).map(cell => cell.textContent)).toEqual(["型号", "品牌", "负责人", "所属行业", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]);
    expect((table.querySelector('col[data-column="industry"]') as HTMLTableColElement).style.width).toBe("110px");
    expect(getComputedStyle(table.querySelector("th")!).fontSize).toBe("var(--admin-content-font-caption, 11px)");
    expect(getComputedStyle(table.querySelector(".ci-cell-title")!).fontSize).toBe("var(--admin-content-font-body, 12px)");
    expect(getComputedStyle(table.parentElement!).overflowX).toBe("auto");
    expectNoGlobalUpload();
    selectHostTab("channels");
    const actions = required(document.querySelector(".ci-channel-table td.ci-col-actions"), "missing archive actions");
    expect(getComputedStyle(actions).width).toBe("172px");
    expect(Array.from(actions.querySelectorAll("button")).map(item => item.textContent)).toEqual(["上传库存", "更多操作"]);
  });

  it.each([null, undefined, "", "unknown-internal-code"])("shows an unset label for %s without inferring from a hidden channel/source", industryCode => {
    localStorage.setItem(channelInventoryColumnsStorageKey(7, 31)!, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "industry"]));
    const data = (runtime.teamQuery as { data: { items: Record<string, unknown>[] } }).data;
    data.items[0] = { ...data.items[0], industryCode: "automotive", channelSource: { id: 999, name: "HIDDEN-INDUSTRY-SOURCE" } };
    data.items[1] = { ...data.items[1], industryCode, channelName: "HIDDEN-CHANNEL", channelSource: { id: 888, name: "HIDDEN-SOURCE" } };
    (runtime.channelQuery as { data: { items: Record<string, unknown>[] } }).data.items[0].industryCode = "medical";
    renderHost();
    expect(Array.from(document.querySelectorAll("td.ci-material-industry-col")).map(cell => cell.textContent)).toEqual(["汽车电子", "未设置"]);
    click(required(document.querySelector<HTMLButtonElement>('[aria-label="高级库存筛选"]'), "missing advanced filter trigger"));
    const industryFilter = required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存行业"]'), "missing public industry filter");
    expect(Array.from(industryFilter.options).map(option => ({ value: option.value, label: option.text }))).toEqual([
      { value: "all", label: "全部行业" }, ...BUSINESS_INDUSTRY_OPTIONS, { value: "unset", label: "未设置" },
    ]);
    expect(document.body.innerHTML).not.toMatch(/HIDDEN-|unknown-internal-code|深圳代理|渠道联系人/);
    // Only public selector options may contain medical: never allowlist the data-row DOM or its attributes.
    const rows = document.querySelectorAll(".ci-compact-stock-table tbody tr");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.outerHTML).not.toMatch(/HIDDEN-|unknown-internal-code|医疗电子|medical|深圳代理|渠道联系人/);
    const pageWithoutIndustryOptions = document.body.cloneNode(true) as HTMLElement;
    required(pageWithoutIndustryOptions.querySelector('[aria-label="筛选库存行业"]'), "missing cloned industry filter").replaceChildren();
    expect(pageWithoutIndustryOptions.innerHTML).not.toMatch(/医疗电子|medical/);
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled();
    expect(runtime.sourceInputs).toHaveLength(0); expect(runtime.optionInputs).toHaveLength(0);
  });

  it("uses the actual portalled Radix menu in approved order with separator, danger styling and Escape close", async () => {
    renderHost(); selectHostTab("channels");
    const menu = openMore(); await settle();
    expect(menu.closest("table,.ci-tablewrap,.ci-host")).toBeNull();
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["查看库存", "下载库存", "编辑渠道", "停用"]);
    const danger = menuItem("停用");
    expect(danger.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(danger.dataset.variant).toBe("destructive");
    expect(getComputedStyle(danger).color).toBe("rgb(165, 74, 74)");
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await settle();
    expect(document.querySelector('.ci-channel-actions-menu[role="menu"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("更多操作");
    vi.mocked(confirm).mockReturnValueOnce(false);
    click(menuItem("停用")); await settle();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("停用后不能新增或修改其库存"));
    expect(runtime.setChannelActive).not.toHaveBeenCalled();
    click(menuItem("停用")); await settle();
    expect(runtime.setChannelActive).toHaveBeenCalledWith({ id: 11, active: false, expectedRevision: 4, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    (runtime.channelQuery as { data: { items: Record<string, unknown>[] } }).data.items[0].active = false; rerender();
    expect(menuItem("启用").dataset.variant).toBe("default");
  });

  it("preselects the clicked channel rather than the first option and imports a real workbook through the original batch DTO", async () => {
    const target = channelFixture({ id: 222, name: "目标渠道" });
    runtime.channelQuery = options([channelFixture(), target]);
    runtime.uploadOptionsQuery = options([channelFixture(), target]);
    runtime.getChannel.mockResolvedValueOnce(target);
    renderHost(); selectHostTab("channels"); click(archiveUpload(1)); await settle();
    expect(getChannelInventoryNavigationTab(window.location.search)).toBe("materials");
    expect(batchSelect()?.value).toBe("222");
    expect(runtime.getChannel).toHaveBeenCalledWith({ id: 222, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(runtime.sourceInputs).toHaveLength(0);
    await uploadSheet([["型号", "品牌"], ["TARGET-ONE", "TI"], ["TARGET-TWO", "NXP"]]);
    previewBatch(); click(button("确认上传 2 条")); await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(2);
    for (const [dto] of runtime.createMaterial.mock.calls) expect(dto).toMatchObject({ channelId: 222, expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
  });

  it("retains an exact target outside the first 100 options and after loading the next candidate page", async () => {
    const target = channelFixture({ id: 555, name: "分页目标" });
    runtime.channelQuery = options([target]);
    runtime.uploadOptionsQuery = options([channelFixture()], { total: 201, pageCount: 3 });
    runtime.getChannel.mockResolvedValueOnce(target);
    renderHost(); selectHostTab("channels"); click(archiveUpload()); await settle();
    expect(batchSelect()?.value).toBe("555");
    expect(batchSelect()?.textContent).toContain("分页目标");
    click(button("加载更多渠道"));
    expect(runtime.optionInputs.at(-1)).toMatchObject({ page: 2, pageSize: 100 });
    runtime.uploadOptionsQuery = options([channelFixture({ id: 300, name: "第二页选项" })], { page: 2, total: 201, pageCount: 3 });
    rerender(); await settle();
    expect(batchSelect()?.value).toBe("555");
    expect(batchSelect()?.textContent).toContain("分页目标");
    expect(batchSelect()?.textContent).toContain("第二页选项");
    await uploadSheet([["型号", "品牌"], ["PAGED-TARGET", "TI"]]); previewBatch(); click(button("确认上传 1 条")); await settle();
    expect(runtime.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ channelId: 555, partNumber: "PAGED-TARGET" }));
  });

  it.each(["readonly", "inactive", "native-write", "stock-write"])("disables row upload with a reason for %s without granting permission", async kind => {
    const item = (runtime.channelQuery as { data: { items: Record<string, unknown>[] } }).data.items[0];
    if (kind === "readonly") { item.readOnly = true; item.canEdit = false; }
    if (kind === "inactive") item.active = false;
    if (kind === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (kind === "stock-write") {
      const previous = runtime.teamQuery as { data: object };
      runtime.teamQuery = query({ ...previous.data, canWrite: false });
    }
    renderHost(); selectHostTab("channels");
    const upload = archiveUpload(); expect(upload.disabled).toBe(true); expect(upload.title).not.toBe("");
    click(upload); await settle();
    expect(batchSelect()).toBeNull(); expect(runtime.getChannel).not.toHaveBeenCalled(); expect(runtime.createMaterial).not.toHaveBeenCalled();
  });

  it("waits for both the real stock query and exact channel query rather than trusting channel-write", async () => {
    const stock = runtime.teamQuery as { data: object };
    runtime.teamQuery = query(undefined, { isLoading: true, isFetching: true });
    let finish!: (value: unknown) => void;
    runtime.getChannel.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(archiveUpload());
    expect(batchSelect()).toBeNull();
    runtime.teamQuery = query(stock.data); rerender(); await settle();
    expect(batchSelect()).toBeNull();
    await act(async () => finish(channelFixture()));
    expect(batchSelect()?.value).toBe("11");
    expect(runtime.createMaterial).not.toHaveBeenCalled();
  });

  it.each(["stock-denial", "stock-error", "channel-denial", "channel-inactive", "channel-readonly", "wrong-id", "wrong-enterprise"])("cancels pending upload on %s and cannot open from a later response", async kind => {
    const stock = runtime.teamQuery as { data: object };
    runtime.teamQuery = query(undefined, { isLoading: true, isFetching: true });
    let finish!: (value: unknown) => void;
    runtime.getChannel.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(archiveUpload());
    const signal = runtime.getChannel.mock.calls[0][1].signal as AbortSignal;
    if (kind === "stock-denial") runtime.teamQuery = query({ ...stock.data, canWrite: false });
    else if (kind === "stock-error") runtime.teamQuery = query(undefined, { isError: true });
    else runtime.teamQuery = query(stock.data);
    if (kind === "channel-denial") runtime.uploadOptionsQuery = options([], { canWrite: false });
    rerender(); await settle();
    if (["stock-denial", "stock-error", "channel-denial"].includes(kind)) expect(signal.aborted).toBe(true);
    await act(async () => finish(channelFixture(kind === "channel-inactive" ? { active: false } : kind === "channel-readonly" ? { readOnly: true, canEdit: false } : kind === "wrong-id" ? { id: 999 } : kind === "wrong-enterprise" ? { enterpriseId: 999 } : {})));
    runtime.teamQuery = query(stock.data); runtime.uploadOptionsQuery = options([channelFixture()]); rerender(); await settle();
    expect(batchSelect()).toBeNull(); expect(document.body.textContent).not.toContain("正在核验库存写权限");
    expect(runtime.createMaterial).not.toHaveBeenCalled();
  });

  it.each(["enterprise", "actor", "permission", "native-write", "scope", "tab-return"])("aborts pending and removes the preselection on %s changes", async kind => {
    let finish!: (value: unknown) => void;
    runtime.getChannel.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(archiveUpload());
    const signal = runtime.getChannel.mock.calls[0][1].signal as AbortSignal;
    const me = runtime.enterpriseMe as { data: Record<string, unknown> };
    if (kind === "enterprise") runtime.enterpriseMe = query({ ...me.data, enterprise: { id: 32 } });
    if (kind === "actor") runtime.enterpriseMe = query({ ...me.data, currentUserId: 8 });
    if (kind === "permission") runtime.enterpriseMe = query({ ...me.data, permissionKeys: [] });
    if (kind === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (kind === "scope") runtime.scope.storageScope = "changed-binding";
    if (kind === "tab-return") { selectHostTab("channels"); selectHostTab("materials"); }
    else rerender();
    await settle(); expect(signal.aborted).toBe(true);
    await act(async () => finish(channelFixture()));
    expect(batchSelect()).toBeNull();
    expect(document.body.textContent).not.toContain("正在核验库存写权限");
    if (kind === "tab-return") { expectNoGlobalUpload(); expect(batchSelect()).toBeNull(); }
    expect(runtime.createMaterial).not.toHaveBeenCalled();
  });

  it.each(["enterprise", "actor", "permission", "native-write", "tab"])("closes an open row batch and clears its selected target on %s change", async kind => {
    renderHost(); selectHostTab("channels"); click(archiveUpload()); await settle();
    expect(batchSelect()?.value).toBe("11");
    const me = runtime.enterpriseMe as { data: Record<string, unknown> };
    if (kind === "enterprise") runtime.enterpriseMe = query({ ...me.data, enterprise: { id: 32 } });
    if (kind === "actor") runtime.enterpriseMe = query({ ...me.data, currentUserId: 8 });
    if (kind === "permission") runtime.enterpriseMe = query({ ...me.data, permissionKeys: [] });
    if (kind === "native-write") runtime.scope.officialInventoryPermissions.write = false;
    if (kind === "tab") { selectHostTab("channels"); selectHostTab("materials"); }
    else rerender();
    await settle(); expect(batchSelect()).toBeNull();
    if (kind === "tab") { expectNoGlobalUpload(); expect(batchSelect()).toBeNull(); }
  });

  it("stops the original per-row queue on tab change even after returning to the same identity", async () => {
    let finish!: () => void;
    runtime.createMaterial.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(archiveUpload()); await settle();
    await uploadSheet([["型号", "品牌"], ["ROW-ONE", "TI"], ["ROW-TWO", "TI"]]); previewBatch(); click(button("确认上传 2 条")); await settle();
    expect(runtime.createMaterial).toHaveBeenCalledTimes(1);
    selectHostTab("channels"); selectHostTab("materials");
    await act(async () => finish());
    expect(runtime.createMaterial).toHaveBeenCalledTimes(1);
    expect(batchSelect()).toBeNull();
    expect(sessionStorage.getItem("d51-channel-inventory-batch-v1:7:31")).not.toBeNull();
  });
});


describe("customer supply exact UI deep links", () => {
  function link(tab: "channels" | "materials", id = 999) {
    window.history.replaceState(null, "", `/?supplyChannelId=${id}&supplyTab=${tab}`);
  }
  function exactChannel(overrides: Record<string, unknown> = {}) {
    return { ...(runtime.getChannelQuery as { data: object }).data, id: 999, name: "第100条以外真实渠道", ...overrides };
  }
  it("fetches and highlights only the exact real channel outside the first 100 without name matching", async () => {
    link("channels"); runtime.getChannel.mockResolvedValue(exactChannel()); renderHost(); await settle();
    expect(runtime.getChannel).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 999 }, { signal: expect.any(AbortSignal) });
    expect(runtime.channelInputs).toHaveLength(0); expect(runtime.optionInputs).toHaveLength(0);
    expect(document.querySelectorAll('.ci-channel-table tbody tr')).toHaveLength(1);
    expect(document.querySelector('.ci-supply-target')?.getAttribute("data-channel-id")).toBe("999");
    expect(document.body.textContent).toContain("第100条以外真实渠道"); expect(document.body.textContent).not.toContain("深圳代理");
    expect(getChannelInventoryNavigationTab(window.location.search)).toBe("channels");
    expect(document.querySelector('[role="tablist"], .ci-tabs')).toBeNull();
  });
  it("does not fall back to an unrelated first-page/same-name channel on a failed exact link", async () => {
    link("channels"); runtime.getChannel.mockRejectedValueOnce(new Error("FORBIDDEN exact target")); renderHost(); await settle();
    expect(document.querySelector('.ci-supply-target')).toBeNull(); expect(document.querySelectorAll('.ci-channel-table tbody tr')).toHaveLength(0);
    expect(document.body.textContent).not.toContain("深圳代理"); expect(document.body.textContent).toContain("FORBIDDEN exact target");
    expect(runtime.channelInputs).toHaveLength(0); expect(runtime.optionInputs).toHaveLength(0);
  });
  it("uses real target plus independent backend source permission before any channel-filtered stock request", async () => {
    link("materials"); runtime.getChannel.mockResolvedValue(exactChannel());
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 999, name: "第100条以外真实渠道" }] });
    const data = (runtime.teamQuery as { data: { items: Record<string, unknown>[] } }).data;
    runtime.teamQuery = query({ ...data, items: data.items.map(row => ({ ...row, canViewSource: true })), canFilterSource: true });
    renderHost(); await settle(); await settle();
    expect(runtime.materialInputs.length).toBeGreaterThan(0);
    for (const input of runtime.materialInputs) expect(input).toMatchObject({ channelId: 999, expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1 });
    expect(runtime.getChannel).toHaveBeenCalledTimes(1);
    expect(runtime.listTeamMaterials).toHaveBeenCalledWith({ channelId: 999, expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1, pageSize: 1 }, { signal: expect.any(AbortSignal) });
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    act(() => required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter").focus()); await settle();
    expect(runtime.listTeamSourceOptions).toHaveBeenCalled();
    expect(runtime.optionInputs).toHaveLength(0); expect(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]')?.value).toBe("999");
  });
  it("a write grant cannot bypass denied source-read permission or trigger an unfiltered fallback", async () => {
    link("materials"); runtime.getChannel.mockResolvedValue(exactChannel()); runtime.sourceQuery = query({ canFilterSource: false, items: [] });
    const data = (runtime.teamQuery as { data: { items: Record<string, unknown>[] } }).data;
    runtime.teamQuery = query({ ...data, items: data.items.map(row => ({ ...row, canViewSource: false })) });
    renderHost(); await settle();
    expect(runtime.materialInputs).toHaveLength(0); expect(document.body.textContent).toContain("没有目标渠道库存来源读取权限");
    expect(document.body.textContent).not.toContain("LM358DR"); expect(document.body.textContent).not.toContain("TEAM-SN74");
    expect(runtime.createMaterial).not.toHaveBeenCalled(); expect(runtime.optionInputs).toHaveLength(0);
  });
  it.each(["id", "enterprise", "inactive"])("rejects a server target with wrong %s rather than trusting URL identity", async kind => {
    link("channels"); runtime.getChannel.mockResolvedValue(exactChannel(kind === "id" ? { id: 998 } : kind === "enterprise" ? { enterpriseId: 32 } : { active: false }));
    renderHost(); await settle(); expect(document.querySelector('.ci-supply-target')).toBeNull(); expect(document.body.textContent).toContain("身份不匹配或已停用");
  });
  it("aborts and ignores a late exact response on authorization/identity change", async () => {
    let finish!: (value: unknown) => void; link("channels"); runtime.getChannel.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); const signal = runtime.getChannel.mock.calls[0][1].signal as AbortSignal;
    runtime.scope.contextVerification.authorizationVersion = "revoked-v2";
    act(() => root?.render(React.createElement(ChannelInventoryHost))); await settle(); expect(signal.aborted).toBe(true);
    await act(async () => { finish(exactChannel()); }); await settle(); expect(document.body.textContent).not.toContain("第100条以外真实渠道"); expect(document.querySelector('.ci-supply-target')).toBeNull();
  });
  it("revalidates active status on explicit retry and removes an archived exact target", async () => {
    link("channels"); runtime.getChannel.mockResolvedValueOnce(exactChannel()).mockResolvedValue(exactChannel({ active: false })); renderHost(); await settle();
    expect(document.querySelector('.ci-supply-target')).not.toBeNull(); click(button("重新核验目标")); await settle();
    expect(document.querySelector('.ci-supply-target')).toBeNull(); expect(document.body.textContent).toContain("身份不匹配或已停用");
  });
  it("keeps an exact target channel edit and draft through ordinary focus and 90 seconds idle", async () => {
    link("channels"); runtime.getChannel.mockResolvedValue(exactChannel()); renderHost(); await settle();
    click(menuItem("编辑渠道")); await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing exact channel editor");
    const name = control(dialog, "渠道名称") as HTMLInputElement;
    change(name, "仍在编辑的客户来源");
    const requests = runtime.getChannel.mock.calls.length;
    vi.useFakeTimers();
    try {
      act(() => window.dispatchEvent(new Event("focus")));
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(name.value).toBe("仍在编辑的客户来源");
      expect(runtime.getChannel).toHaveBeenCalledTimes(requests);
      expect(runtime.updateChannel).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe("customer supply independent exact source-readable proof", () => {
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  const sourceFilter = () => required(document.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道来源"]'), "missing source filter");
  function ownSource(leader = false, rowOverrides: Record<string, unknown> = {}) {
    window.history.replaceState(null, "", "/?supplyChannelId=999&supplyTab=materials");
    const channel = { ...(runtime.getChannelQuery as { data: object }).data, id: 999, name: "本人精确目标", companyReadOnly: true, customerId: 81 };
    runtime.getChannel.mockResolvedValue(channel);
    const data = (runtime.teamQuery as { data: { items: Record<string, unknown>[] } }).data;
    const stock = { ...data, items: [{ ...data.items[0], ...rowOverrides }], total: 1, page: 1, pageSize: 20, pageCount: 1, canFilterSource: leader };
    // The generic mock still contains unrelated peer stock. Only an exact cid
    // gets this response; the public Team DTO has no channelId/channelSource.
    runtime.exactTeamQuery = query(stock);
    runtime.listTeamMaterials.mockImplementation(input => {
      runtime.exactStockInputs.push(input);
      return Promise.resolve({ ...stock, pageSize: 1 });
    });
    return { channel, stock };
  }
  function onlyExactRequests() {
    expect(runtime.listTeamMaterials).toHaveBeenCalled();
    for (const [input, options] of runtime.listTeamMaterials.mock.calls) {
      expect(input).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 999, page: 1, pageSize: 1 });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    for (const input of runtime.materialInputs) expect(input).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, channelId: 999, pageSize: 20 });
    expect(runtime.optionInputs).toHaveLength(0);
    expect(runtime.channelInputs).toHaveLength(0);
    expect(runtime.sharedInputs).toHaveLength(0);
  }
  function noOtherStocks() {
    expect(document.querySelector("tbody")?.textContent).not.toMatch(/LM358DR|TEAM-SN74/);
    expect(runtime.materialInputs).toHaveLength(0);
    expect(runtime.createChannel).not.toHaveBeenCalled();
    expect(runtime.createMaterial).not.toHaveBeenCalled();
    expect(runtime.optionInputs).toHaveLength(0);
    expect(runtime.sharedInputs).toHaveLength(0);
  }

  it("allows a member's exact own source with canFilterSource=false and no public row channelId, without opening other customer options", async () => {
    const { stock } = ownSource();
    expect(stock.items[0]).not.toHaveProperty("channelId");
    expect(stock.items[0]).not.toHaveProperty("channelSource");
    renderHost(); await settle(); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    expect(document.querySelector("tbody")?.textContent).not.toContain("TEAM-SN74");
    expect(sourceFilter().disabled).toBe(true);
    expect(sourceFilter().value).toBe("999");
    expect(sourceFilter().options).toHaveLength(1);
    expect(sourceFilter().textContent).toContain("本人精确目标");
    act(() => sourceFilter().focus()); await settle();
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    onlyExactRequests();
  });

  it("does not trust cached channel, write or CRM-profile permission while both fresh read steps are pending", async () => {
    const { channel, stock } = ownSource();
    let finishChannel!: (value: unknown) => void;
    let finishStock!: (value: unknown) => void;
    runtime.getChannel.mockReturnValueOnce(new Promise(resolve => { finishChannel = resolve; }));
    runtime.listTeamMaterials.mockReturnValueOnce(new Promise(resolve => { finishStock = resolve; }));
    renderHost();
    expect(runtime.listTeamMaterials).not.toHaveBeenCalled();
    expectNoGlobalUpload();
    noOtherStocks();
    await act(async () => finishChannel(channel));
    expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(1);
    expect(runtime.materialInputs).toHaveLength(0);
    expectNoGlobalUpload();
    noOtherStocks();
    await act(async () => finishStock({ ...stock, pageSize: 1 })); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    onlyExactRequests();
  });

  it("preserves leader lazy dropdown permissions while keeping every stock query on the deep-link cid", async () => {
    ownSource(true);
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 999, name: "本人精确目标" }, { id: 22, name: "leader合法其他来源" }] });
    renderHost(); await settle();
    expect(sourceFilter().disabled).toBe(false);
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    act(() => sourceFilter().focus()); await settle();
    expect(sourceFilter().value).toBe("999");
    expect(sourceFilter().options).toHaveLength(3);
    change(sourceFilter(), "22"); await settle();
    expect(sourceFilter().value).toBe("22");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999 });
    click(button("搜索")); await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999 });
    change(sourceFilter(), ""); await settle();
    click(button("搜索")); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    onlyExactRequests();
  });

  it("a new canFilterSource=false response clears only group options, not the exact own proof or cid", async () => {
    const { stock } = ownSource(true);
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 999, name: "本人精确目标" }, { id: 22, name: "撤销的其他来源" }] });
    renderHost(); await settle(); act(() => sourceFilter().focus()); await settle();
    expect(sourceFilter().textContent).toContain("撤销的其他来源");
    runtime.exactTeamQuery = query({ ...stock, canFilterSource: false });
    rerender(); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    expect(sourceFilter().disabled).toBe(true);
    expect(sourceFilter().value).toBe("999");
    expect(sourceFilter().textContent).not.toContain("撤销的其他来源");
    expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(1);
    onlyExactRequests();
  });

  it("retains exact own cid through confirmed search, clearing drafts, sorting and a later empty filtered result", async () => {
    const { stock } = ownSource(); renderHost(); await settle();
    const model = required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存型号"]'), "missing model");
    expect(Array.from(document.querySelectorAll("button")).some(item => item.textContent?.trim() === "重置")).toBe(false);
    change(model, "NO-MATCH");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999, partNumber: undefined });
    click(button("搜索")); await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999, partNumber: "NO-MATCH", page: 1 });
    click(required(document.querySelector('[aria-label="按可供数量排序"]'), "missing sort"));
    runtime.exactTeamQuery = query({ ...stock, items: [], total: 0 }); rerender(); await settle();
    expect(document.body.textContent).toContain("暂无目标可读库存");
    expect(document.querySelector("tbody")?.textContent).not.toContain("TEAM-SN74");
    change(model, "");
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999, partNumber: "NO-MATCH", sortBy: "qty" });
    click(button("搜索")); await settle();
    expect(runtime.materialInputs.at(-1)).toMatchObject({ channelId: 999, partNumber: undefined, sortBy: "qty", page: 1 });
    onlyExactRequests();
  });

  it.each([false, undefined, null, "true"])("requires canViewSource===true, not %s, even with a write/profile/leader-options grant", async canViewSource => {
    ownSource(true, { canViewSource });
    runtime.sourceQuery = query({ canFilterSource: true, items: [{ id: 999, name: "未经库存证明的来源" }] });
    renderHost(); await settle();
    expect(document.body.textContent).toContain("没有目标渠道库存来源读取权限");
    expectNoGlobalUpload();
    expectNoGlobalUpload();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    noOtherStocks(); onlyExactRequests();
  });

  it("rejects a mixed readable/unreadable proof response rather than accepting any positive row", async () => {
    const { stock } = ownSource();
    runtime.listTeamMaterials.mockResolvedValueOnce({ ...stock, items: [...stock.items, { ...stock.items[0], id: 202, canViewSource: false }] });
    renderHost(); await settle();
    expect(document.body.textContent).toContain("没有目标渠道库存来源读取权限");
    noOtherStocks(); onlyExactRequests();
  });

  it.each(["empty", "unavailable", "stock-forbidden", "stock-network"])("fails closed with no ALL fallback when exact source proof is %s", async kind => {
    const { stock } = ownSource();
    if (kind === "empty") runtime.listTeamMaterials.mockResolvedValueOnce({ ...stock, items: [], total: 0, pageSize: 1 });
    if (kind === "unavailable") runtime.listTeamMaterials.mockResolvedValueOnce(undefined);
    if (kind === "stock-forbidden") runtime.listTeamMaterials.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    if (kind === "stock-network") runtime.listTeamMaterials.mockRejectedValueOnce(new Error("目标库存服务暂不可用"));
    renderHost(); await settle();
    expect(document.querySelector(".ci-supply-location")?.textContent).toMatch(/暂无目标可读库存|不可用|权限已改变/);
    expect(document.querySelector(".ci-supply-location")?.textContent).not.toContain("已精确定位");
    expect(sourceFilter().disabled).toBe(true);
    expect(sourceFilter().textContent).not.toContain("全部可见库存");
    expectNoGlobalUpload();
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    noOtherStocks(); onlyExactRequests();
  });

  it("does not probe inventory or fetch upload choices when getChannel denies a foreign target", async () => {
    ownSource(); runtime.getChannel.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    renderHost(); await settle();
    expect(runtime.listTeamMaterials).not.toHaveBeenCalled();
    expect(runtime.listTeamSourceOptions).not.toHaveBeenCalled();
    expectNoGlobalUpload();
    noOtherStocks();
  });

  it.each(["error", "source-revoked"])("masks fresh exact stock %s, preserves fail-closed intent, and never retries unfiltered", async kind => {
    const { stock } = ownSource(); renderHost(); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    runtime.exactTeamQuery = kind === "error" ? query(undefined, { isError: true }) : query({ ...stock, items: stock.items.map(row => ({ ...row, canViewSource: false })) });
    runtime.materialInputs = [];
    rerender(); await settle();
    expect(document.querySelector("tbody")?.textContent).not.toMatch(/LM358DR|TEAM-SN74/);
    expect(document.body.textContent).toContain("来源权限已改变");
    expectNoGlobalUpload();
    runtime.exactTeamQuery = query(stock); rerender(); await settle();
    expect(runtime.materialInputs.every(input => (input as { channelId?: number }).channelId === 999)).toBe(true);
    expect(document.querySelector("tbody")?.textContent).not.toMatch(/LM358DR|TEAM-SN74/);
    onlyExactRequests();
  });

  it.each(["actor", "enterprise", "binding", "authorization", "native-grant", "search", "unmount"])("aborts a pending exact stock proof on %s and ignores its late positive result", async kind => {
    const { stock } = ownSource();
    let finish!: (value: unknown) => void;
    runtime.listTeamMaterials.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderHost(); await settle();
    expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(1);
    const signal = runtime.listTeamMaterials.mock.calls[0][1].signal as AbortSignal;
    runtime.getChannel.mockRejectedValue(new Error("新授权目标不可用"));
    if (kind === "actor") (runtime.enterpriseMe as { data: { currentUserId: number } }).data.currentUserId = 8;
    if (kind === "enterprise") (runtime.enterpriseMe as { data: { enterprise: { id: number } } }).data.enterprise.id = 32;
    if (kind === "binding") runtime.scope.storageScope = "new-binding";
    if (kind === "authorization") runtime.scope.contextVerification.authorizationVersion = "changed-v2";
    if (kind === "native-grant") runtime.scope.officialInventoryPermissions.authorizationVersion = "changed-v2";
    if (kind === "search") {
      act(() => { window.history.replaceState(null, "", "/?supplyChannelId=998&supplyTab=materials"); window.dispatchEvent(new PopStateEvent("popstate")); });
    } else if (kind === "unmount") await act(async () => { root?.unmount(); root = null; });
    else rerender();
    await settle(); expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...stock, pageSize: 1 })); await settle();
    expect(document.querySelector("tbody")?.textContent ?? "").not.toMatch(/LM358DR|TEAM-SN74/);
    expect(runtime.materialInputs).toHaveLength(0);
    expect(runtime.optionInputs).toHaveLength(0);
    expect(runtime.createMaterial).not.toHaveBeenCalled();
  });

  it("reprobes both direct reads on explicit retry and removes a now-empty target without an unfiltered request", async () => {
    const { stock } = ownSource(); renderHost(); await settle();
    expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
    runtime.listTeamMaterials.mockResolvedValueOnce({ ...stock, items: [], total: 0, pageSize: 1 });
    click(button("重新核验目标")); await settle();
    expect(runtime.getChannel).toHaveBeenCalledTimes(2);
    expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("暂无目标可读库存");
    expect(document.querySelector("tbody")?.textContent).not.toMatch(/LM358DR|TEAM-SN74/);
    onlyExactRequests();
  });

  it("does not reprove on focus or after 90 seconds, while explicit retry still masks revoked source", async () => {
    vi.useFakeTimers();
    try {
      ownSource(); renderHost();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
      runtime.listTeamMaterials.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
      act(() => window.dispatchEvent(new Event("focus")));
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
      expect(runtime.getChannel).toHaveBeenCalledTimes(1);
      expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(1);
      expect(document.querySelector("tbody")?.textContent).toContain("LM358DR");
      click(button("重新核验目标"));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(runtime.getChannel).toHaveBeenCalledTimes(2);
      expect(runtime.listTeamMaterials).toHaveBeenCalledTimes(2);
      expect(document.querySelector("tbody")?.textContent).not.toMatch(/LM358DR|TEAM-SN74/);
      expect(document.body.textContent).toContain("权限已改变");
      onlyExactRequests();
    } finally { vi.useRealTimers(); }
  });
});


describe("v18 single collaboration-note entry", () => {
  const notes = [
    { id: 501, materialId: 101, authorUserId: 7, authorName: "本人作者", content: "已核实原厂交期与封装，库存状态需要与客户再次确认。", revision: 4, createdAt: "2026-11-03T01:00:00.000Z", updatedAt: "2026-11-03T02:00:00.000Z", canEdit: true },
    { id: 502, materialId: 101, authorUserId: 8, authorName: "协作同事", content: "团队协作历史：已联系供应商核实库存数量、批次和可交付时间；此处仅显示公共协作信息。", revision: 1, createdAt: "2026-11-03T03:00:00.000Z", updatedAt: "2026-11-03T03:00:00.000Z", canEdit: false },
  ];
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  const writeDOM = (fileName: string) => {
    const dir = process.env.NOTES_DOM_FIXTURE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, fileName), `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>真实 ChannelInventoryHost DOM</title></head><body>${required(container, "missing rendered host").innerHTML}</body></html>\n`);
  };

  it("has exactly one native text note button per row and keeps zero clickable", async () => {
    renderHost();
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    for (const row of rows) {
      const entries = Array.from(row.querySelectorAll<HTMLButtonElement>(".ci-col-actions button")).filter(item => item.textContent?.startsWith("备注（"));
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("button");
      expect(entries[0].className).toBe("ci-inline-link");
      expect(entries[0].disabled).toBe(false);
      expect(row.textContent).not.toContain("新增备注");
    }
    click(button("备注（0）")); await settle();
    expect(runtime.collaborationInputs.at(-1)).toMatchObject({ materialId: 202, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(document.activeElement).toBe(document.querySelector("textarea"));
    expect(document.querySelector('[aria-label="协作备注历史"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="新增协作备注"]')).not.toBeNull();
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it.each(["row", "server", "native"])("leaves the unique history entry usable with %s add denial", async denial => {
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    if (denial === "row") runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => ({ ...row, canAddNote: false })) });
    if (denial === "native") runtime.scope.officialInventoryPermissions.note = false;
    runtime.collaborationQuery = query({ items: notes, total: 2, page: 1, pageSize: 20, canAdd: denial !== "server" });
    renderHost(); click(button("备注（0）")); await settle();
    expect(document.querySelector('[aria-label="协作备注历史"]')?.textContent).toContain(notes[1].content);
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector('[aria-label="新增协作备注"]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
    expect(runtime.collaborationAdd).not.toHaveBeenCalled();
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it("keeps a populated notes dialog mounted through save and background list refresh, updating server history and row count", async () => {
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => row.id === 101 ? { ...row, noteCount: 2 } : row) });
    const saved = { ...notes[0], id: 503, content: "本次新增的库存协作核实记录" };
    const listRefetch = vi.fn().mockImplementation(async () => {
      runtime.collaborationQuery = query({ items: [saved, ...notes], total: 3, page: 1, pageSize: 20, canAdd: true });
      rerender();
    });
    runtime.collaborationQuery = query({ items: notes, total: 2, page: 1, pageSize: 20, canAdd: true }, { refetch: listRefetch });
    renderHost(); click(button("备注（2）")); await settle();
    const dialog = required(document.querySelector('[role="dialog"]'), "missing collaboration dialog");
    const input = required(dialog.querySelector<HTMLTextAreaElement>("textarea"), "missing note input");
    expect(document.activeElement).toBe(dialog);
    expect(dialog.querySelectorAll(".ci-note-entry")).toHaveLength(2);
    change(input, saved.content);
    runtime.utils.channelInventory.listTeamMaterials.invalidate.mockImplementationOnce(async () => {
      runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map(row => row.id === 101 ? { ...row, noteCount: 3 } : row) }, { isFetching: true });
      rerender();
    });
    click(button("保存协作备注")); await settle();
    expect(listRefetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("");
    expect(dialog.querySelectorAll(".ci-note-entry")).toHaveLength(3);
    expect(dialog.querySelector('[aria-label="协作备注历史"]')?.textContent).toContain(saved.content);
    expect(button("备注（3）").disabled).toBe(false);
    expect(runtime.collaborationAdd.mock.calls[0][0]).toMatchObject({ materialId: 101, content: saved.content });
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it.each(["actor", "enterprise", "material", "removed", "archive"])("aborts pending notes and fences a late successful write after %s changes", async changeKind => {
    let finish!: () => void;
    runtime.collaborationAdd.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const listRefetch = (runtime.collaborationQuery as { refetch: ReturnType<typeof vi.fn> }).refetch;
    renderHost(); click(button("备注（1）")); await settle();
    change(required(document.querySelector<HTMLTextAreaElement>("textarea"), "missing old input"), "V18-STALE-PREVIOUS-CONTEXT-DRAFT");
    click(button("保存协作备注"));
    const signal = runtime.collaborationAdd.mock.calls[0][1].signal as AbortSignal;
    if (changeKind === "actor" || changeKind === "enterprise") {
      runtime.enterpriseMe = query({ currentUserId: changeKind === "actor" ? 8 : 7, enterprise: { id: changeKind === "enterprise" ? 32 : 31 }, permissionKeys: ["stocks.read"] });
      rerender();
    } else if (changeKind === "material") click(button("备注（0）"));
    else if (changeKind === "archive") selectHostTab("channels");
    else {
      const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
      runtime.teamQuery = query({ ...previous.data, items: previous.data.items.filter(row => row.id !== 101) }); rerender();
    }
    await settle();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(document.body.innerHTML).not.toContain("V18-STALE-PREVIOUS-CONTEXT-DRAFT");
    expect(listRefetch).not.toHaveBeenCalled();
    if (changeKind === "material") {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("TEAM-SN74");
      expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    } else expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.notesInputs).toHaveLength(0);
  });

  it("exports real host inventory, channel descriptions and a populated collaboration dialog for CSS measurements", async () => {
    const previous = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    runtime.teamQuery = query({ ...previous.data, items: previous.data.items.map((row, index) => ({ ...row,
      partNumber: index === 0 ? "TPS7A4701RGWRABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-LONG-ALPHABETIC-MODEL" : "SN74LVC1G125DBVR-ABCDEFGHIJKLMNOPQRSTUVWXYZ-LONG-MODEL",
      brand: index === 0 ? "TEXAS INSTRUMENTS" : "NEXPERIA",
      originalRecorderName: index === 0 ? "JackLongRecorderName" : "协作负责人",
      industryCode: "electronic_components", leadTime: "已核实供应库存，预计三到五个工作日交付", noteCount: index === 0 ? 2 : 0,
    })) });
    const channels = runtime.channelQuery as { data: { items: Record<string, unknown>[] } };
    channels.data.items[0] = { ...channels.data.items[0], industryCode: "electronic_components", notes: "渠道说明：长期合作的电子元器件供应渠道，包含原厂库存、批次核实及可交付时间确认；这是一段用于实际组件换行测量的长说明。" };
    runtime.collaborationQuery = query({ items: notes, total: 2, page: 1, pageSize: 20, canAdd: true });
    renderHost();
    expect(document.querySelectorAll(".ci-compact-stock-table tbody tr")).toHaveLength(2);
    writeDOM("v18-channel-inventory-host.html");
    selectHostTab("channels"); await settle();
    expect(document.querySelector(".ci-channel-table")?.textContent).toContain("深圳代理");
    writeDOM("v18-channel-archive-host.html");
    click(menuItem("编辑渠道")); await settle();
    expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value).toContain("这是一段用于实际组件换行测量的长说明");
    writeDOM("v18-channel-description-editor-host.html");
    click(button("取消"));
    selectHostTab("materials"); click(button("备注（2）")); await settle();
    expect(document.querySelectorAll(".ci-collaboration-dialog .ci-note-entry")).toHaveLength(2);
    expect(document.querySelector('.ci-collaboration-dialog [aria-label="新增协作备注"] textarea')).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(/历史库存备注|已核对交期|原渠道备注/);
    writeDOM("v18-channel-inventory-notes-host.html");
    expect(runtime.collaborationAdd).not.toHaveBeenCalled();
    expect(runtime.collaborationEdit).not.toHaveBeenCalled();
  });
});


describe("approved channel inventory part-number density", () => {
  const longPart = "SYNTHETIC-STM32F429ZIT6-TR/REV-B-INDUSTRIAL-EXTENDED-PACKAGE-2601";
  const partTrigger = () => required(document.querySelector<HTMLSpanElement>(".ci-part-number-text"), "missing part-number text");
  const panel = () => document.querySelector<HTMLElement>(".ci-part-number-popover");
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));

  it.each(["TI", "SYNTHETIC-BRAND-".repeat(12), ""])("separates original full part data from single-line brand %s", brand => {
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = { ...result.data.items[0], partNumber: longPart, brand, uploadBatchId: null };
    renderHost();
    const trigger = partTrigger();
    const row = required(trigger.closest("tr"), "missing inventory row");
    expect(trigger.textContent).toBe(longPart);
    expect(trigger.getAttribute("aria-label")).toBe(longPart);
    expect(trigger.closest("td")?.querySelector("small")).toBeNull();
    expect(row.querySelector("td.ci-material-brand-col")?.textContent).toBe(brand || "—");
    expect(row.querySelector("td.ci-material-brand-col")?.getAttribute("title")).toBe(brand);
    const style = getComputedStyle(trigger);
    expect(style.whiteSpace).toBe("nowrap"); expect(style.textOverflow).toBe("ellipsis"); expect(style.overflow).toBe("hidden");
    const brandStyle = getComputedStyle(required(row.querySelector("td.ci-material-brand-col"), "missing brand"));
    expect(brandStyle.whiteSpace).toBe("nowrap"); expect(brandStyle.textOverflow).toBe("ellipsis");
    expect(row.querySelector("small.ci-batch-source")).toBeNull();
    expect(row.querySelector(".ci-source-link")?.textContent).toBe("查看来源");
    expect(row.querySelectorAll("td")).toHaveLength(11);
    expect(required(row.closest("table"), "missing table").style.getPropertyValue("--ci-stock-min-width")).toBe(`${channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false).minWidth}px`);
  });

  it("offers a lightweight complete-value copy button instead of a large duplicate hover panel", () => {
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = { ...result.data.items[0], partNumber: longPart };
    renderHost();
    const inputs = runtime.materialInputs.length;
    act(() => partTrigger().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const copy = required(document.querySelector<HTMLButtonElement>(".ci-part-copy-button"), "missing copy button");
    expect(copy.getAttribute("aria-label")).toBe(`复制完整型号：${longPart}`);
    expect(copy.type).toBe("button"); expect(partTrigger().hasAttribute("title")).toBe(false);
    act(() => copy.focus()); expect(document.activeElement).toBe(copy);
    expect(panel()).toBeNull(); expect(runtime.materialInputs.length).toBe(inputs);
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled(); expect(runtime.getTeamMaterialForEdit).not.toHaveBeenCalled();
    expect(runtime.createMaterial).not.toHaveBeenCalled(); expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });

  it("keeps no duplicate part panel on data, page, view or identity changes", async () => {
    renderHost(); expect(panel()).toBeNull();
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = { ...result.data.items[0], partNumber: longPart }; rerender(); expect(panel()).toBeNull();
    click(button("下一页")); expect(panel()).toBeNull();
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] }); rerender(); await settle(); expect(panel()).toBeNull();
    selectHostView("channels"); await settle(); expect(panel()).toBeNull();
  });

  it.each([320, 390, 768, 1024, 1560])("keeps copy overlay inside the part cell at a synthetic %spx viewport without changing table budgets", width => {
    vi.stubGlobal("innerWidth", width); Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    renderHost();
    const copy = required(document.querySelector<HTMLButtonElement>(".ci-part-copy-button"), "missing copy button");
    const style = getComputedStyle(copy);
    expect(style.position).toBe("absolute"); expect(style.right).toBe("0px");
    expect(copy.closest("td")).toBe(partTrigger().closest("td")); expect(panel()).toBeNull();
    expect(required(document.querySelector<HTMLTableElement>(".ci-compact-stock-table"), "missing table").style.getPropertyValue("--ci-stock-min-width"))
      .toBe(`${channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false).minWidth}px`);
  });
});

describe("approved inventory compact time presentation", () => {
  const trigger = () => required(document.querySelector<HTMLSpanElement>(".ci-updated-at-trigger"), "missing updated-at trigger");
  const panel = () => document.querySelector<HTMLElement>(".ci-updated-at-popover");
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  const setFirst = (values: Record<string, unknown>) => {
    const result = runtime.teamQuery as { data: { items: Record<string, unknown>[] } };
    result.data.items[0] = { ...result.data.items[0], ...values };
  };

  it.each([
    ["2026-01-01T00:00:01Z", "2026-11-10T00:00:00Z", "01-01 08:00", "2026-01-01 08:00:01（北京时间）"],
    ["2025-12-31T16:00:59Z", "2025-12-31T16:00:00Z", "01-01 00:00", "2026-01-01 00:00:59（北京时间）"],
    ["2025-12-31T15:59:59Z", "2025-12-31T16:00:00Z", "2025-12-31 23:59", "2025-12-31 23:59:59（北京时间）"],
    ["2026-12-31T16:00:01Z", "2026-12-31T15:59:59Z", "2027-01-01 00:00", "2027-01-01 00:00:01（北京时间）"],
    ["2026-12-31T15:59:59Z", "2026-12-31T16:00:00Z", "2026-12-31 23:59", "2026-12-31 23:59:59（北京时间）"],
    ["2026-12-31T16:00:00Z", "2026-12-31T16:00:00Z", "01-01 00:00", "2027-01-01 00:00:00（北京时间）"],
    ["2026-12-31T08:00:00-08:00", "2026-12-31T16:00:00Z", "01-01 00:00", "2027-01-01 00:00:00（北京时间）"],
    ["2026-11-10T12:34+05:30", "2026-11-10T00:00:00Z", "11-10 15:04", "2026-11-10 15:04:00（北京时间）"],
    ["2026-11-10T12:34:56.123Z", "2026-11-10T00:00:00Z", "11-10 20:34", "2026-11-10 20:34:56（北京时间）"],
    ["2024-02-29T23:59:59+08:00", "2024-06-01T00:00:00Z", "02-29 23:59", "2024-02-29 23:59:59（北京时间）"],
  ])("uses Beijing calendar years and full original seconds for %s", (value, now, compact, full) => {
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
      const previous = process.env.TZ;
      process.env.TZ = timezone;
      try {
        expect(channelInventoryUpdatedAt(value, new Date(now))).toEqual({ compact, full });
        expect(channelInventoryUpdatedAt(new Date(value), new Date(now))).toEqual({ compact, full });
      } finally {
        if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
      }
    }
  });

  it.each([
    null, undefined, "", "  ", "not-a-date", new Date(NaN),
    "2026-02-30", " 2026-02-30", "2026/02/30",
    " 2026-11-10T12:00:00Z", "2026-11-10T12:00:00Z ", "2026-11-10T12:00:00Z\n",
    "2026/11/10T12:00:00Z", "2026-11-10", "2026-11-10 12:00:00Z",
    "0000-01-01T00:00:00Z", "10000-01-01T00:00:00Z", "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z", "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-02-30T00:00:00Z", "2026-11-31",
    "2026-01-01T24:00:00Z", "2026-01-01T12:60:00Z", "2026-01-01T12:00:60Z",
    "2026-01-01T12:00:00+24:00", "2026-01-01T12:00:00+08:60", "2026-01-01T12:00:00-24:00",
    "2026-01-01T12:00:00+0800", "2026-01-01T12:00:00+08", "2026-01-01T12:00:00.1234Z",
  ])("never invents an updated time or tooltip in UTC/LA/Shanghai for %s", value => {
    const previous = process.env.TZ;
    try {
      for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
        process.env.TZ = timezone;
        expect(channelInventoryUpdatedAt(value, new Date("2026-12-31T16:00:00Z"))).toBeNull();
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
    setFirst({ updatedAt: value, dateCode: null }); renderHost();
    const cell = required(document.querySelector("td.ci-material-date-col"), "missing date cell");
    expect(cell.textContent).toBe(""); expect(cell.querySelector('[role="button"]')).toBeNull();
    expect(panel()).toBeNull();
  });

  it("renders time independently from optional DC with a semantic complete Beijing timestamp", () => {
    const key = channelInventoryColumnsStorageKey(7, 31)!;
    localStorage.setItem(key, JSON.stringify([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "dateCode"]));
    setFirst({ dateCode: "  2601 / REV-B  " }); renderHost();
    expect(document.querySelector("th.ci-material-date-col")?.textContent).toBe("更新时间");
    expect(document.querySelector("td.ci-material-dc-col")?.textContent).toBe("  2601 / REV-B  ");
    expect(document.querySelector("td.ci-material-date-col")?.textContent).not.toContain("2601");
    expect(trigger().closest("time")?.getAttribute("datetime")).toMatch(/T\d{2}:\d{2}:\d{2}\+08:00$/);
    const layout = channelInventoryColumnLayout([...DEFAULT_CHANNEL_INVENTORY_COLUMNS, "dateCode"], false);
    const table = required(document.querySelector<HTMLTableElement>(".ci-compact-stock-table"), "missing table");
    expect(table.style.getPropertyValue("--ci-stock-min-width")).toBe(`${layout.minWidth}px`);
    expect(table.querySelectorAll("col")).toHaveLength(layout.count);
    expect(hostStyles).not.toMatch(/ci-stock-flex-base|ci-stock-date-width|100cqw/);
  });

  it("keeps a cross-year label single-line/ellipsizable while native tooltip retains every second and timezone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    setFirst({ updatedAt: "2026-12-31T15:59:59Z" }); renderHost();
    const full = "2026-12-31 23:59:59（北京时间）";
    expect(trigger().textContent).toBe("2026-12-31 23:59");
    expect(trigger().getAttribute("aria-label")).toBe(full);
    const style = getComputedStyle(trigger());
    expect(style.display).toBe("block"); expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).toBe("hidden"); expect(style.textOverflow).toBe("ellipsis");
    expect(style.maxWidth).toBe("100%"); expect(style.minHeight).toBe("28px");
    click(trigger()); expect(panel()?.textContent).toBe(full);
    expect(panel()?.parentElement).toBe(document.body);
  });

  it("reuses native Portal for hover, focus, keyboard, phone click and dismissals without business calls", async () => {
    setFirst({ updatedAt: "2026-11-10T12:34:56Z" }); renderHost();
    const inputs = runtime.materialInputs.length;
    const full = "2026-11-10 20:34:56（北京时间）";
    act(() => trigger().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(panel()?.textContent).toBe(full); expect(panel()?.parentElement).toBe(document.body);
    expect(panel()?.closest("table,.ci-tablewrap,.ci-host")).toBeNull();
    act(() => trigger().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); }); expect(panel()).toBeNull();
    act(() => trigger().focus()); expect(panel()?.textContent).toBe(full);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(panel()).toBeNull();
    act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))); expect(panel()).not.toBeNull();
    act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }))); expect(panel()).toBeNull();
    act(() => trigger().blur()); click(trigger()); expect(panel()?.textContent).toBe(full);
    click(trigger()); expect(panel()).toBeNull();
    click(trigger()); act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))); expect(panel()).toBeNull();
    click(trigger()); act(() => required(document.querySelector(".ci-tablewrap"), "missing scroller").dispatchEvent(new Event("scroll"))); expect(panel()).toBeNull();
    click(trigger()); act(() => window.dispatchEvent(new Event("resize"))); expect(panel()).toBeNull();
    expect(runtime.materialInputs.length).toBe(inputs);
    expect(runtime.getTeamMaterialSource).not.toHaveBeenCalled(); expect(runtime.getTeamMaterialForEdit).not.toHaveBeenCalled();
    expect(runtime.createMaterial).not.toHaveBeenCalled(); expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });

  it("dismisses time Portal on source time, page, view and identity changes", async () => {
    renderHost(); click(trigger()); setFirst({ updatedAt: "2026-11-11T00:00:01Z" }); rerender(); expect(panel()).toBeNull();
    click(trigger()); click(button("下一页")); expect(panel()).toBeNull();
    click(trigger()); selectHostView("channels"); await settle(); expect(panel()).toBeNull();
    selectHostView("flat"); await settle(); click(trigger());
    runtime.enterpriseMe = query({ currentUserId: 8, enterprise: { id: 32 }, permissionKeys: ["inventory.manage"] });
    rerender(); await settle(); expect(panel()).toBeNull();
  });
});

// Recovered policy behavior, not a claim of byte identity with the missing final source.
describe("20261112 recovered official Host write, private notes and export policy", () => {
  const rerender = () => act(() => root?.render(React.createElement(ChannelInventoryHost)));
  const ownEntry = () => required(document.querySelector<HTMLButtonElement>('[aria-label="本人备注：LM358DR"]'), "missing independent private entry");
  const ownNotes = () => required(document.querySelector<HTMLElement>(".ci-private-notes-dialog"), "missing private notes dialog");
  const stock = () => (runtime.teamQuery as { data: { items: Record<string, unknown>[]; canWrite: boolean } }).data;
  const notes = () => runtime.notesQuery as { data: Record<string, any>; refetch: ReturnType<typeof vi.fn> };
  const denyStockWrite = () => {
    runtime.scope.officialInventoryPermissions.write = false;
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: ["stocks.read"], isOwner: false });
    runtime.teamQuery = query({ ...stock(), canWrite: false, items: stock().items.map(row => ({ ...row, canEdit: false, canDelete: false, readOnly: true })) });
  };
  const expectNoStockCalls = () => {
    for (const call of [runtime.getTeamMaterialForEdit, runtime.getMaterial, runtime.createMaterial, runtime.updateMaterial, runtime.deleteMaterials, runtime.setMaterialShare, runtime.utils.client.channelInventory.createUploadBatch.mutate]) expect(call).not.toHaveBeenCalled();
    expect(document.querySelector(".ci-host-material-dialog")).toBeNull();
  };
  beforeEach(() => {
    runtime.utils.client.channelInventory.createUploadBatch.mutate.mockClear();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in official Host source regression"); }));
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); });

  it.each([[], ["stocks.read"]])("official write can edit with no ERP inventory.manage or owner: %j", async permissionKeys => {
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys, isOwner: false });
    renderHost(); click(materialMenuItem("编辑")); await settle();
    const editor = required(document.querySelector(".ci-host-material-dialog"), "official writer incorrectly denied by ERP role");
    change(control(editor, "型号"), "OFFICIAL-WRITE-NO-ERP"); click(button("保存修改")); await settle();
    expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledTimes(1);
    expect(runtime.updateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 101, partNumber: "OFFICIAL-WRITE-NO-ERP", expectedRevision: 9, expectedEnterpriseId: 31, expectedActorUserId: 7 }));
    expect(runtime.updateMaterial).toHaveBeenCalledTimes(1);
    expect(runtime.notesInputs).toHaveLength(0); expect(runtime.setMaterialShare).not.toHaveBeenCalled();
  });
  it.each(["official-read", "official-write", "module-write", "row-edit", "row-readOnly", "detail-edit", "detail-readOnly", "source-identity"])("preserves %s inventory denial despite other writable hints", async denial => {
    if (denial === "official-read") runtime.scope.officialInventoryPermissions.read = false;
    if (denial === "official-write") runtime.scope.officialInventoryPermissions.write = false;
    if (denial === "module-write") runtime.teamQuery = query({ ...stock(), canWrite: false });
    if (denial === "row-edit" || denial === "row-readOnly") runtime.teamQuery = query({ ...stock(), items: stock().items.map(row => row.id === 101 ? { ...row, ...(denial === "row-edit" ? { canEdit: false } : { readOnly: true }) } : row) });
    if (denial === "detail-edit" || denial === "detail-readOnly") runtime.getTeamMaterialForEdit.mockResolvedValueOnce({ id: 101, partNumber: "LM358DR", canEdit: denial !== "detail-edit", readOnly: denial === "detail-readOnly" });
    if (denial === "source-identity") runtime.scope.contextVerification.identity = "previous-storage-scope";
    renderHost();
    if (document.querySelector('.ci-stock-edit-table [data-slot="dropdown-menu-trigger"]')) click(materialMenuItem("编辑"));
    await settle(); expect(document.querySelector(".ci-host-material-dialog")).toBeNull();
    expect(runtime.updateMaterial).not.toHaveBeenCalled(); expect(runtime.createMaterial).not.toHaveBeenCalled();
    if (denial.startsWith("detail-")) expect(runtime.getTeamMaterialForEdit).toHaveBeenCalledTimes(1);
    else expect(runtime.getTeamMaterialForEdit).not.toHaveBeenCalled();
  });
  it("read+note without stock write opens an independent row panel and sends only authorized note Add/Edit", async () => {
    denyStockWrite(); renderHost();
    expect(ownEntry().disabled).toBe(false);
    expect(document.querySelector('[aria-label="本人备注：TEAM-SN74"]')).toBeNull();
    expect(document.body.textContent).not.toContain("历史库存备注");
    click(ownEntry()); await settle();
    expect(ownNotes().textContent).toContain("历史库存备注");
    expect(runtime.notesInputs.at(-1)).toEqual({ materialId: 101, expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1, pageSize: 50 });
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing note-only add"), "独立本人备注新增");
    click(button("保存本人备注")); await settle();
    expect(runtime.notesAdd).toHaveBeenCalledWith({ materialId: 101, expectedEnterpriseId: 31, expectedActorUserId: 7, content: "独立本人备注新增", requestId: expect.any(String) });
    click(button("修改我的备注"));
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing note-only edit"), "独立本人备注修改");
    click(button("保存备注修改")); await settle();
    expect(runtime.notesEdit).toHaveBeenCalledWith({ noteId: 901, expectedRevision: 1, expectedEnterpriseId: 31, expectedActorUserId: 7, content: "独立本人备注修改", requestId: expect.any(String) });
    expectNoStockCalls();
  });
  it.each(["canEdit", "readOnly", "material"])("notesList %s denial does not inherit writable stock or official note flags", async denial => {
    notes().data = { ...notes().data, ...(denial === "canEdit" ? { canEdit: false } : denial === "readOnly" ? { readOnly: true } : { material: { id: 999, partNumber: "WRONG-ROW" } }) };
    renderHost(); click(ownEntry()); await settle();
    expect(ownNotes().querySelector("textarea")).toBeNull();
    expect(ownNotes().textContent).not.toContain("修改我的备注");
    expect(runtime.notesAdd).not.toHaveBeenCalled(); expect(runtime.notesEdit).not.toHaveBeenCalled(); expectNoStockCalls();
  });
  it("stock write-only loss leaves a still-authorized note panel independent", async () => {
    renderHost(); click(ownEntry()); await settle();
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing draft"), "NOTE-INDEPENDENT-OF-STOCK");
    runtime.scope.officialInventoryPermissions.write = false;
    runtime.teamQuery = query({ ...stock(), canWrite: false, items: stock().items.map(row => ({ ...row, canEdit: false, readOnly: true })) });
    rerender(); await settle();
    expect(ownNotes().querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("NOTE-INDEPENDENT-OF-STOCK");
    click(button("保存本人备注")); await settle(); expect(runtime.notesAdd).toHaveBeenCalledTimes(1); expectNoStockCalls();
  });
  it.each(["note", "read", "identity", "actor", "enterprise", "row-removed", "row-not-mine", "authorization"])("closes notes and cannot reuse a draft after %s loss", async denial => {
    denyStockWrite(); renderHost(); click(ownEntry()); await settle();
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing draft"), "STALE-NOTE-DRAFT");
    const staleSave = button("保存本人备注");
    if (denial === "note" || denial === "read") runtime.scope.officialInventoryPermissions[denial] = false;
    if (denial === "identity") runtime.scope.contextVerification.identity = "revoked-binding";
    if (denial === "authorization") runtime.scope.contextVerification.authorizationVersion = "changed-authorization";
    if (denial === "actor" || denial === "enterprise") runtime.enterpriseMe = query({ currentUserId: denial === "actor" ? 8 : 7, enterprise: { id: denial === "enterprise" ? 32 : 31 }, permissionKeys: [] });
    if (denial === "row-removed") runtime.teamQuery = query({ ...stock(), items: stock().items.filter(row => row.id !== 101) });
    if (denial === "row-not-mine") runtime.teamQuery = query({ ...stock(), items: stock().items.map(row => ({ ...row, isMine: false })) });
    rerender(); await settle(); click(staleSave);
    expect(document.querySelector(".ci-private-notes-dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("STALE-NOTE-DRAFT");
    expect(runtime.notesAdd).not.toHaveBeenCalled(); expect(runtime.notesEdit).not.toHaveBeenCalled(); expectNoStockCalls();
  });
  it.each(["readonly", "error"])("focus refresh blocks same-tick cached submit and preserves fresh %s denial", async denial => {
    denyStockWrite(); renderHost(); click(ownEntry()); await settle();
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing draft"), "NO-CACHED-SUBMIT");
    const staleSave = button("保存本人备注");
    let finish!: (value: unknown) => void;
    notes().refetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { window.dispatchEvent(new Event("focus")); staleSave.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(runtime.notesAdd).not.toHaveBeenCalled();
    expect(ownNotes().querySelector("textarea")).toBeNull();
    const fresh = denial === "readonly" ? query({ ...notes().data, canEdit: false, readOnly: true }) : query(undefined, { isError: true, error: new Error("撤权后重核验失败") });
    await act(async () => { finish(fresh); await Promise.resolve(); }); await settle();
    expect(notes().refetch).toHaveBeenCalledTimes(1); expect(ownNotes().querySelector("textarea")).toBeNull();
    click(staleSave); expect(runtime.notesAdd).not.toHaveBeenCalled(); expect(runtime.notesEdit).not.toHaveBeenCalled(); expectNoStockCalls();
  });
  it("an unconfirmed note retry never becomes stock authority and is discarded on note revocation", async () => {
    denyStockWrite(); runtime.notesAdd.mockRejectedValueOnce(new Error("unknown note response"));
    renderHost(); click(ownEntry()); await settle();
    change(required(ownNotes().querySelector<HTMLTextAreaElement>("textarea"), "missing draft"), "FROZEN-NOTE-RETRY");
    click(button("保存本人备注")); await settle();
    expect(button("按原请求重试")).not.toBeNull();
    const staleRetry = button("按原请求重试");
    runtime.scope.officialInventoryPermissions.note = false; rerender(); await settle(); click(staleRetry);
    expect(runtime.notesAdd).toHaveBeenCalledTimes(1); expect(document.querySelector(".ci-private-notes-dialog")).toBeNull(); expectNoStockCalls();
  });
  it.each(["official-write", "module-write", "identity", "authorization"])("does not write an export file after %s loss during download", async denial => {
    let finish!: (value: unknown) => void;
    runtime.exportChannelMaterials.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHost(); selectHostTab("channels"); click(menuItem("下载库存"));
    expect(runtime.exportChannelMaterials).toHaveBeenCalledTimes(1);
    if (denial === "official-write") runtime.scope.officialInventoryPermissions.write = false;
    if (denial === "module-write") {
      const old = runtime.channelQuery as { data: object }; runtime.channelQuery = query({ ...old.data, canWrite: false });
    }
    if (denial === "identity") runtime.scope.contextVerification.identity = "previous-scope";
    if (denial === "authorization") runtime.scope.contextVerification.authorizationVersion = "revoked-export-authorization";
    rerender(); await settle();
    await act(async () => { finish(exportFixture()); await Promise.resolve(); }); await settleExport();
    expect(XLSX.writeFile).not.toHaveBeenCalled(); expect(runtime.updateMaterial).not.toHaveBeenCalled();
  });
  it("effective official export works without ERP manage or owner and still rechecks authenticated identity", async () => {
    runtime.enterpriseMe = query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: [], isOwner: false });
    (runtime.enterpriseMe as { refetch: ReturnType<typeof vi.fn> }).refetch.mockResolvedValue(runtime.enterpriseMe);
    renderHost(); selectHostTab("channels"); expect(menuItem("下载库存").hasAttribute("data-disabled")).toBe(false);
    click(menuItem("下载库存")); await settleExport();
    expect(runtime.exportChannelMaterials).toHaveBeenCalledTimes(1); expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    expectNoStockCalls();
  });
});
