// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BatchUpload } from "../channelInventory/BatchUpload";
import type { History, HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  download: vi.fn(),
  reconcile: vi.fn(),
  mark: vi.fn(),
  result: vi.fn(),
  original: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
  batch: vi.fn(),
  context: vi.fn(),
  upload: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  auth: vi.fn(),
  current: true,
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()] }));
vi.mock("../../../../../BusinessScope", () => ({
  useBusinessScope: () => ({
    storageScope: "compact-history",
    officialInventoryPermissions: { read: true, write: true, note: true },
  }),
}));
vi.mock("../../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => ({
      channelInventory: {
        listTeamMaterials: { invalidate: vi.fn() },
        listChannels: { invalidate: vi.fn() },
        listUploadBatches: { invalidate: vi.fn() },
      },
      client: {
        channelInventory: {
          customerUploadHistoryList: { query: rt.list },
          customerUploadHistoryGet: { query: rt.get },
          customerUploadDownload: { mutate: rt.download },
          customerUploadReconcileBatch: { mutate: rt.reconcile },
          customerUploadManageMark: { mutate: rt.mark },
          customerUploadResult: { mutate: rt.result },
          customerUploadOriginal: { mutate: rt.original },
          customerUploadPrepareConfirmation: { mutate: rt.prepare },
          createCustomerMaterial: { mutate: rt.create },
          createCustomerUploadBatch: { mutate: rt.batch },
          customerSupplyContext: { query: rt.context },
        },
      },
    }),
    customerDemand: {
      suggestPartNumbers: {
        useQuery: () => ({ data: [], isFetching: false, isError: false }),
      },
    },
  },
}));
// Keep the actual Supply wrapper and the actual Radix portal; only capture its upload queue contract.
vi.mock("../channelInventory/BatchUpload", async () => {
  const { createElement } = await import("react");
  return {
    batchUploadDialogStyle: {},
    BatchUpload: (props: unknown) => {
      rt.upload(props);
      return createElement(
        "div",
        { "data-testid": "resumed-upload" },
        "原记录导入"
      );
    },
  };
});
import { CustomerUploadHistoryDialog } from "./CustomerUploadHistoryDialog";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "verified-compact" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const id = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
function history(changes: Partial<History> = {}): History {
  return {
    historyId: id,
    customerId: 801,
    customerName: "当前客户",
    mode: "standard",
    state: "awaiting_confirmation",
    revision: 4,
    uploadedBy: {
      frontUserId: 7,
      adminAccountId: 1,
      displayName: "真实上传人",
    },
    createdAt: "2026-11-15T12:00:00+08:00",
    originalFile: {
      fileId,
      kind: "original",
      fileName: "原库存.csv",
      mimeType: "text/csv",
      byteSize: 3,
      sha256: "a".repeat(64),
      createdAt: "2026-11-15T12:00:00+08:00",
    },
    latestVersionId: null,
    latestVersionNo: 0,
    access: "self",
    stats: {
      sourceRowCount: 6,
      resultRowCount: 0,
      pendingCount: 0,
      excludedCount: 0,
      successCount: 0,
      unknownCount: 0,
      failedCount: 0,
      remainingMaterialCount: 0,
    },
    capabilities: {
      canDownload: true,
      canManage: true,
      canUploadResult: true,
      canConfirm: true,
      canCancel: true,
    },
    ...changes,
  };
}
function detail(h = history()): HistoryDetail {
  return {
    history: h,
    selectedVersion: null,
    versions: [],
    confirmation: null,
    originalSheets: [
      {
        sheetIndex: 0,
        sheetName: "库存",
        rows: Array.from({ length: 6 }, (_, i) => ({
          rowNumber: i + 1,
          originalRowHash: "b".repeat(64),
          originalContent: i ? "ONE,TI" : "型号,品牌",
          cells: i ? ["ONE", "TI"] : ["型号", "品牌"],
        })),
      },
    ],
  };
}
let root: Root | undefined;
let host: HTMLDivElement;
function render(element?: React.ReactElement) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      element ??
        React.createElement(CustomerUploadHistoryDialog, {
          customerId: 801,
          identity,
          isCurrent: () => rt.current,
          onClose: rt.close,
          onComplete: rt.complete,
          onAuthorizationError: rt.auth,
        })
    )
  );
}
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 15));
  });
}
function buttons(text: string) {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button")
  ).filter(button => button.textContent?.trim() === text);
}
function button(text: string) {
  const b = buttons(text)[0];
  if (!b) throw new Error(`Missing ${text}: ${document.body.textContent}`);
  return b;
}
function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function uploadProps(): ComponentProps<typeof BatchUpload> {
  return rt.upload.mock.calls.at(-1)![0];
}
function assertNoWrites() {
  for (const method of [
    rt.reconcile,
    rt.mark,
    rt.result,
    rt.original,
    rt.batch,
    rt.prepare,
    rt.create,
  ])
    expect(method).not.toHaveBeenCalled();
}
beforeEach(() => {
  Object.values(rt).forEach(value => {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  });
  rt.current = true;
  rt.list.mockResolvedValue({
    items: [history()],
    nextCursor: null,
    canManage: true,
  });
  rt.get.mockResolvedValue(detail());
  rt.download.mockResolvedValue({
    fileName: "原库存.csv",
    mimeType: "text/csv",
    byteSize: 3,
    base64: btoa("abc"),
  });
  rt.context.mockResolvedValue({
    customer: {
      id: 801,
      name: "当前客户",
      version: 4,
      industryCode: "electronic_components",
      archivedAt: null,
    },
    channel: null,
    canUpload: true,
    disabledReason: null,
  });
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  assertNoWrites();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compact read-only upload history", () => {
  it("has the compact title and exactly filename/time/uploader/size/actions columns without technical or duplicate metadata", async () => {
    render();
    await settle();
    expect(document.querySelector("h2")?.textContent).toBe("上传历史");
    expect(
      Array.from(document.querySelectorAll(".history-list thead th")).map(
        th => th.textContent
      )
    ).toEqual(["", "文件名称", "上传时间", "上传人", "大小", "操作"]);
    const row = document.querySelector(".history-list tbody tr")!;
    expect(row.children[1].textContent).toBe("原库存.csv");
    expect(row.children[3].textContent).toBe("真实上传人");
    expect(row.children[4].textContent).toBe("3 B");
    expect(row.textContent).not.toMatch(
      /当前客户|#7|#801|成功0|待确认0|v0|独立历史|待核对/
    );
    expect(row.textContent).not.toContain(id);
    expect(document.querySelector(".history-technical")).toBeNull();
  });
  it("never reinstates parse management, resume, mark or result-upload actions even for server managers", async () => {
    render();
    await settle();
    expect(rt.list.mock.calls[0][0]).toEqual({
      ...expected,
      customerId: 801,
      view: "mine",
      pageSize: 50,
    });
    expect(document.body.textContent).not.toMatch(
      /解析管理|继续导入|继续处理|标记解析|回传|恢复原批次|筛选/
    );
    click(button("查看"));
    await settle();
    expect(document.querySelector("input[type=file], textarea")).toBeNull();
    expect(rt.upload).not.toHaveBeenCalled();
    expect(rt.context).not.toHaveBeenCalled();
    assertNoWrites();
  });
  it.each([
    "pending_parse",
    "parse_failed",
    "cancelled",
    "partially_imported",
  ] as const)(
    "keeps %s as a plain original file row, not a workflow/status dashboard",
    async state => {
      rt.list.mockResolvedValue({
        items: [history({ state })],
        nextCursor: null,
      });
      render();
      await settle();
      expect(
        Array.from(
          document.querySelectorAll(".history-list tbody tr button")
        ).map(b => b.textContent)
      ).toEqual(["原库存.csv", "查看", "下载"]);
      expect(button("下载").disabled).toBe(false);
      expect(document.body.textContent).not.toMatch(
        /解析失败|已取消|待解析|待核实|继续导入|继续处理/
      );
    }
  );
  it("opens filename and 查看 in the same side preview, never another portal or technical details", async () => {
    render();
    await settle();
    click(button("原库存.csv"));
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll(".history-sheet tbody tr")).toHaveLength(
      6
    );
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    click(document.querySelector('[aria-label="关闭预览"]')!);
    expect(document.querySelector(".history-preview")).toBeNull();
    click(button("查看"));
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(rt.get).toHaveBeenCalledTimes(2);
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: id });
  });
  it("keeps the footer minimal until files are selected and retains the original single-file IDs", async () => {
    render();
    await settle();
    expect(buttons("下载所选")).toHaveLength(0);
    expect(document.body.textContent).toContain("共 1 条");
    click(document.querySelector('[aria-label="选择本页文件"]')!);
    expect(document.body.textContent).toContain("已选 1 项");
    expect(button("下载所选").disabled).toBe(false);
    click(document.querySelector('[aria-label="选择本页文件"]')!);
    expect(buttons("下载所选")).toHaveLength(0);
    expect(rt.download).not.toHaveBeenCalled();
  });
  it("leaves 查看 enabled but disables selection/download when original-file capability is denied", async () => {
    const h = history();
    h.capabilities.canDownload = false;
    rt.list.mockResolvedValue({ items: [h], nextCursor: null });
    rt.get.mockResolvedValue(detail(h));
    render();
    await settle();
    expect(button("查看").disabled).toBe(false);
    expect(button("下载").disabled).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(`[aria-label="选择文件${id}"]`)!
        .disabled
    ).toBe(true);
    click(button("查看"));
    await settle();
    expect(buttons("下载")).toHaveLength(2);
    buttons("下载").forEach(b => expect(b.disabled).toBe(true));
    expect(rt.download).not.toHaveBeenCalled();
  });
  it("keeps the list scoped even when the server hides management permission", async () => {
    rt.list.mockResolvedValue({
      items: [history()],
      nextCursor: null,
      canManage: false,
    });
    render();
    await settle();
    expect(document.body.textContent).not.toContain("解析管理");
    expect(button("查看")).toBeTruthy();
    expect(rt.list.mock.calls[0][0]).toMatchObject({
      ...expected,
      customerId: 801,
      view: "mine",
    });
  });
  it("normal upload stays in Supply and never opens the history list", async () => {
    render(
      React.createElement(CustomerSupplyUploadDialog, {
        customerId: 801,
        identity,
        isCurrent: () => rt.current,
        onClose: rt.close,
        onComplete: rt.complete,
        onAuthorizationError: rt.auth,
      })
    );
    await settle();
    expect(rt.upload).toHaveBeenCalled();
    expect(rt.list).not.toHaveBeenCalled();
    expect(rt.get).not.toHaveBeenCalled();
    expect(uploadProps().initialFile).toBeUndefined();
  });
});
