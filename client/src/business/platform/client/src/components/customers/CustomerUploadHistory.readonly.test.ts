// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import type { History, HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  download: vi.fn(),
  forbidden: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  auth: vi.fn(),
  network: vi.fn(),
  current: true,
}));
// No server implementation, authenticated client, upload queue, or fake Dialog.
vi.mock("../../../../front-router-types/server/db", () => ({
  getDb: () => {
    throw new Error("REAL_DATABASE_FORBIDDEN");
  },
}));
vi.mock("../channelInventory/BatchUpload", () => ({
  batchUploadDialogStyle: {},
}));
vi.mock("../../../../../api/business-trpc", () => {
  const denied =
    (name: string) =>
    (...args: unknown[]) => {
      rt.forbidden(name, ...args);
      throw new Error(`READONLY_RPC_FORBIDDEN: ${name}`);
    };
  const routes = new Proxy(
    {
      customerUploadHistoryList: { query: rt.list },
      customerUploadHistoryGet: { query: rt.get },
      customerUploadDownload: { mutate: rt.download },
      ...Object.fromEntries(
        [
          "customerUploadReconcileBatch",
          "customerUploadManageMark",
          "customerUploadResult",
          "customerUploadOriginal",
          "customerUploadPrepareConfirmation",
          "createCustomerMaterial",
          "createCustomerUploadBatch",
        ].map(name => [name, { query: denied(name), mutate: denied(name) }])
      ),
    },
    {
      get(target, key) {
        if (typeof key === "string" && Object.hasOwn(target, key))
          return target[key as keyof typeof target];
        return denied(String(key))();
      },
    }
  );
  return {
    trpc: { useUtils: () => ({ client: { channelInventory: routes } }) },
  };
});
import { CustomerUploadHistoryDialog } from "./CustomerUploadHistoryDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "verified-readonly" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = uuid(1);
const fileId = uuid(1001);
function history(n = 1, changes: Partial<History> = {}): History {
  return {
    historyId: uuid(n),
    customerId: 801,
    customerName: "禁止冗余客户名称",
    mode: "parse",
    state: "pending_parse",
    revision: 4,
    uploadedBy: {
      frontUserId: 7,
      adminAccountId: 1,
      displayName: "真实上传人",
    },
    createdAt: "2026-11-15T12:00:00+08:00",
    originalFile: {
      fileId: uuid(1000 + n),
      kind: "original",
      fileName: `原表-${n}.csv`,
      mimeType: "text/csv",
      byteSize: 3,
      sha256: "a".repeat(64),
      createdAt: "2026-11-15T12:00:00+08:00",
    },
    latestVersionId: null,
    latestVersionNo: 0,
    access: "self",
    stats: {
      sourceRowCount: 101,
      resultRowCount: 0,
      pendingCount: 0,
      excludedCount: 0,
      successCount: 0,
      unknownCount: 0,
      failedCount: 0,
      remainingMaterialCount: 0,
    },
    // Download-only fixture: management hints cannot manufacture canConfirm.
    capabilities: {
      canDownload: true,
      canManage: true,
      canUploadResult: true,
      canConfirm: false,
      canCancel: true,
    },
    ...changes,
  };
}
function originalRow(rowNumber: number, cells: (string | number | null)[]) {
  return {
    rowNumber,
    cells,
    originalRowHash: "b".repeat(64),
    originalContent: cells.join(","),
  };
}
function detail(h = history()): HistoryDetail {
  return {
    history: h,
    versions: [],
    selectedVersion: null,
    confirmation: null,
    originalSheets: [
      {
        sheetIndex: 0,
        sheetName: "原工作表",
        rows: [
          originalRow(1, ["型号", "品牌"]),
          originalRow(8, ["ORIGINAL-ONE", "TI"]),
        ],
      },
    ],
  };
}
function version(rows = 1): NonNullable<HistoryDetail["selectedVersion"]> {
  return {
    versionId: uuid(2001),
    versionNo: 1,
    parentVersionId: null,
    createdAt: history().createdAt,
    normalizedFile: null,
    issuesFile: null,
    issues: [],
    rows: Array.from({ length: rows }, (_, i) => ({
      rowId: uuid(3000 + i),
      logicalRowId: uuid(4000 + i),
      sourceRefs: [
        {
          sheetIndex: 0,
          sheetName: "原工作表",
          rowNumber: 8,
          originalRowHash: "b".repeat(64),
        },
      ],
      candidate: {
        partNumber: `整理-${i + 1}`,
        brand: "TI",
        qty: 2,
        price: "1.25",
        currency: "CNY",
        taxIncluded: null,
        dateCode: null,
        leadTime: null,
        note: "只读备注",
      },
      disposition: "pending",
      excludeReason: null,
      issues: [],
    })),
  };
}
function downloadData(
  fileName = "私有原件.csv",
  bytes = new Uint8Array([97, 98, 99])
) {
  return {
    fileName,
    mimeType: "text/csv",
    byteSize: bytes.length,
    base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root | undefined;
let host: HTMLDivElement;
let savedFiles: File[];
let anchors: { href: string; download: string }[];
let storageBefore: Record<string, string>;
let storageGuards: ReturnType<typeof vi.spyOn>[];
const storageGet = Storage.prototype.getItem;
const storageSet = Storage.prototype.setItem;
const storageRemove = Storage.prototype.removeItem;
function storageSnapshot() {
  return Object.fromEntries(
    Array.from(
      { length: sessionStorage.length },
      (_, i) => sessionStorage.key(i)!
    ).map(key => [key, storageGet.call(sessionStorage, key)!])
  );
}
function render(customerId = 801, scope = identity) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      React.createElement(CustomerUploadHistoryDialog, {
        customerId,
        identity: scope,
        isCurrent: () => rt.current,
        onClose: rt.close,
        onComplete: rt.complete,
        onAuthorizationError: rt.auth,
      })
    )
  );
}
async function settle(ms = 15) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}
function element<T extends Element = HTMLElement>(
  selector: string,
  scope: ParentNode = document.body
): T {
  const found = scope.querySelector<T>(selector);
  if (!found)
    throw new Error(`Missing ${selector}: ${document.body.textContent}`);
  return found;
}
function button(
  text: string,
  scope: ParentNode = document.body
): HTMLButtonElement {
  const found = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => item.textContent?.trim() === text);
  if (!found)
    throw new Error(`Missing button ${text}: ${document.body.textContent}`);
  return found;
}
function click(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function change(target: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(target),
      "value"
    )!.set!.call(target, value);
    target.dispatchEvent(
      new Event(target instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function search(value: string) {
  change(element<HTMLInputElement>('[aria-label="搜索文件名或上传人"]'), value);
}
function row(n = 1) {
  return element(`[aria-label="选择文件${uuid(n)}"]`).closest("tr")!;
}
function select(n = 1) {
  click(element(`[aria-label="选择文件${uuid(n)}"]`));
}
function preview() {
  return element<HTMLElement>('[aria-label="文件预览"]');
}
function escape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  });
}
function assertScopeCalls() {
  for (const [input, options] of rt.list.mock.calls) {
    expect(input).toMatchObject({
      ...expected,
      customerId: 801,
      view: "mine",
      pageSize: 50,
    });
    expect(input).not.toHaveProperty("uploadedByFrontUserId");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  }
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
  rt.download.mockResolvedValue(downloadData());
  savedFiles = [];
  anchors = [];
  storageBefore = storageSnapshot();
  storageGuards = ["getItem", "setItem", "removeItem", "clear"].map(method =>
    vi.spyOn(Storage.prototype, method as "getItem")
  );
  const noNetwork = (...args: unknown[]) => {
    rt.network(...args);
    throw new Error("REAL_NETWORK_FORBIDDEN");
  };
  vi.stubGlobal("fetch", vi.fn(noNetwork));
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(noNetwork);
  // jsdom 26's File/Blob lacks arrayBuffer. Read its real bytes, not fixture bytes.
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: function (this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    anchors.push({ href: this.href, download: this.download });
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn((file: File) => {
        savedFiles.push(file);
        return `blob:private-${savedFiles.length}`;
      });
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  try {
    expect(
      rt.forbidden,
      "reconcile/mark/result/prepare/create/batch and unknown RPCs are forbidden"
    ).not.toHaveBeenCalled();
    expect(rt.network, "no real network/DB/ECS").not.toHaveBeenCalled();
    expect(rt.complete).not.toHaveBeenCalled();
    expect(
      storageSnapshot(),
      "recovery storage must remain byte-for-byte unchanged"
    ).toEqual(storageBefore);
    storageGuards.forEach(guard =>
      expect(
        guard,
        "history must not even read recovery storage"
      ).not.toHaveBeenCalled()
    );
  } finally {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (File.prototype as { arrayBuffer?: unknown }).arrayBuffer;
  }
});

describe("上传历史：真正 portal 与只读列表", () => {
  it("uses one real portal, compact columns, and no writes without canConfirm despite management hints", async () => {
    render();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(element('[role="dialog"] h2').textContent).toBe("上传历史");
    expect(
      Array.from(document.querySelectorAll(".history-list thead th")).map(
        th => th.textContent
      )
    ).toEqual(["", "文件名称", "上传时间", "上传人", "成功 / 失败", "操作"]);
    expect(
      Array.from(row().querySelectorAll("button")).map(b => b.textContent)
    ).toEqual(["原表-1.csv", "查看物料"]);
    expect(row().querySelector(".history-size")?.textContent).toBe("—");
    expect(document.body.textContent).not.toMatch(
      /禁止冗余客户名称|解析管理|独立历史|任务UUID|待解析|v0|成功0|待确认0|标记解析|回传|继续导入|继续处理|筛选/
    );
    expect(document.body.textContent).not.toContain(id);
    expect(document.querySelector('[aria-label="管理客户ID"]')).toBeNull();
    expect(
      document.querySelector('input[type="file"], textarea, .history-technical')
    ).toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(rt.get).not.toHaveBeenCalled();
    expect(rt.download).not.toHaveBeenCalled();
    assertScopeCalls();
  });

  it("reads every cursor before showing data, deduplicates, then searches filename/uploader across server pages without another RPC", async () => {
    const last = deferred<{ items: History[]; nextCursor: null }>();
    const filename = history(51, {
      originalFile: {
        ...history(51).originalFile,
        fileName: "LAST-Needle.csv",
      },
    });
    const uploader = history(52, {
      uploadedBy: { ...history().uploadedBy, displayName: "跨页上传人" },
    });
    rt.list
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, i) => history(i + 1)),
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        items: [history(1), filename],
        nextCursor: "cursor-3",
      })
      .mockImplementationOnce(() => last.promise);
    render();
    await settle();
    expect(rt.list).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(0);
    expect(element('[role="status"]').textContent).toContain("加载中");
    await act(async () => {
      last.resolve({ items: [uploader], nextCursor: null });
    });
    expect(document.body.textContent).toContain("共 52 条");
    search("  last-needle  ");
    await settle();
    expect(document.body.textContent).toContain("LAST-Needle.csv");
    expect(document.body.textContent).toContain("共 1 条");
    search("跨页上传人");
    await settle();
    expect(document.body.textContent).toContain("原表-52.csv");
    search("not-present");
    await settle();
    expect(document.body.textContent).toContain("无匹配文件");
    expect(rt.list.mock.calls.map(([input]) => input.cursor)).toEqual([
      undefined,
      "cursor-2",
      "cursor-3",
    ]);
    expect(rt.list).toHaveBeenCalledTimes(3);
    assertScopeCalls();
  });

  it("paginates at 20 rows, preserves cross-page selection and resets selection/page on keyword changes", async () => {
    const items = Array.from({ length: 41 }, (_, i) => history(i + 1));
    // Explicit chronological sort makes the expected page membership deterministic.
    items.forEach((h, i) => {
      h.createdAt = new Date(
        Date.UTC(2026, 10, 15, 0, 0, 41 - i)
      ).toISOString();
    });
    rt.list.mockResolvedValue({ items: items.reverse(), nextCursor: null });
    render();
    await settle();
    expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(
      20
    );
    expect(element<HTMLButtonElement>('[aria-label="上一页"]').disabled).toBe(
      true
    );
    select(1);
    click(element('[aria-label="下一页"]'));
    expect(row(21)).toBeTruthy();
    expect(document.body.textContent).toContain("2 / 3");
    select(21);
    expect(document.body.textContent).toContain("已选 2 项");
    click(element('[aria-label="下一页"]'));
    expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(1);
    expect(element<HTMLButtonElement>('[aria-label="下一页"]').disabled).toBe(
      true
    );
    search("原表-1.csv");
    await settle();
    expect(document.body.textContent).toContain("1 / 1");
    expect(document.body.textContent).not.toContain("已选");
    expect(rt.list).toHaveBeenCalledTimes(1);
  });

  it("debounces dates and sends the exact customer/enterprise/actor/date scope on every cursor and refresh", async () => {
    render();
    await settle();
    rt.list
      .mockResolvedValueOnce({ items: [history()], nextCursor: "date-page-2" })
      .mockResolvedValueOnce({ items: [history(2)], nextCursor: null });
    select();
    click(button("原表-1.csv"));
    await settle();
    change(
      element<HTMLInputElement>('[aria-label="上传起始日期"]'),
      "2026-11-01"
    );
    change(
      element<HTMLInputElement>('[aria-label="上传结束日期"]'),
      "2026-11-19"
    );
    expect(document.querySelector('[aria-label="文件预览"]')).toBeNull();
    expect(document.body.textContent).not.toContain("已选");
    await settle(100);
    expect(rt.list).toHaveBeenCalledTimes(1);
    await settle(180);
    expect(rt.list).toHaveBeenCalledTimes(3);
    const scope = {
      ...expected,
      customerId: 801,
      view: "mine",
      pageSize: 50,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-19",
    };
    expect(rt.list.mock.calls[1][0]).toEqual(scope);
    expect(rt.list.mock.calls[2][0]).toEqual({
      ...scope,
      cursor: "date-page-2",
    });
    expect(element<HTMLInputElement>('[aria-label="上传起始日期"]').max).toBe(
      "2026-11-19"
    );
    expect(element<HTMLInputElement>('[aria-label="上传结束日期"]').min).toBe(
      "2026-11-01"
    );
    click(button("刷新"));
    await settle(280);
    expect(rt.list.mock.calls.at(-1)![0]).toEqual(scope);
    assertScopeCalls();
  });

  it("fails closed on a repeating cursor rather than silently showing an incomplete searchable list", async () => {
    rt.list.mockResolvedValue({ items: [history()], nextCursor: "repeated" });
    render();
    await settle();
    expect(rt.list).toHaveBeenCalledTimes(2);
    expect(element('[role="alert"]').textContent).toContain("读取未完成");
    expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(0);
  });
});

describe("上传历史：原表与整理内容只读预览", () => {
  it("keeps all sheets, true source row numbers and A..AA headers, and pages original rows at exactly 100", async () => {
    const d = detail();
    d.originalSheets = [
      {
        sheetIndex: 3,
        sheetName: "第一原表",
        rows: Array.from({ length: 101 }, (_, i) =>
          originalRow(
            7 + i * 2,
            i === 100
              ? Array.from({ length: 27 }, (_, c) =>
                  c === 0 ? "TAIL-101" : `COL-${c}`
                )
              : [`ROW-${i + 1}`, i]
          )
        ),
      },
      {
        sheetIndex: 8,
        sheetName: "第二原表",
        rows: [originalRow(901, ["SECOND-SHEET", null, 0])],
      },
    ];
    rt.get.mockResolvedValue(d);
    render();
    await settle();
    click(button("原表-1.csv"));
    await settle();
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: id });
    expect(rt.get.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(document.querySelectorAll(".history-sheet tbody tr")).toHaveLength(
      100
    );
    expect(element(".history-sheet tbody tr th").textContent).toBe("7");
    expect(document.querySelectorAll(".history-sheet thead th")).toHaveLength(
      28
    );
    expect(
      document.querySelector(".history-sheet thead th:last-child")?.textContent
    ).toBe("AA");
    expect(preview().textContent).not.toContain("TAIL-101");
    click(element('[aria-label="预览下一页"]'));
    expect(document.querySelectorAll(".history-sheet tbody tr")).toHaveLength(
      1
    );
    expect(element(".history-sheet tbody tr th").textContent).toBe("207");
    expect(preview().textContent).toContain("TAIL-101");
    expect(
      element<HTMLButtonElement>('[aria-label="预览下一页"]').disabled
    ).toBe(true);
    change(element<HTMLSelectElement>('[aria-label="预览工作表"]'), "1");
    expect(element(".history-sheet tbody tr th").textContent).toBe("901");
    expect(preview().textContent).toContain("SECOND-SHEET");
    expect(
      Array.from(element(".history-sheet tbody tr").querySelectorAll("td")).map(
        td => td.textContent
      )
    ).toEqual(["SECOND-SHEET", "", "0"]);
    expect(document.querySelector('[aria-label="预览下一页"]')).toBeNull();
    change(element<HTMLSelectElement>('[aria-label="预览工作表"]'), "0");
    expect(element(".history-sheet tbody tr th").textContent).toBe("7");
    expect(rt.get).toHaveBeenCalledTimes(1);
  });

  it("displays original formulas and formatted numeric evidence as inert text, with CSV/old manifest fallback", async () => {
    const d = detail();
    const evidenceRow = originalRow(8, [2, 1234.5, "cached", "old-value"]);
    evidenceRow.originalContent = JSON.stringify({
      rowNumber: 8,
      evidence: [
        {
          cell: "A8",
          formulaPresent: true,
          formula:
            'HYPERLINK("https://forbidden.invalid","<img src=x onerror=alert(1)>")',
          formattedText: "cached-result",
        },
        { cell: "B8", formulaPresent: false, formattedText: "001,234.50" },
        {
          cell: "C8",
          formulaPresent: false,
          formattedText: "<script>forbidden()</script>",
        },
        { cell: "D999", formulaPresent: false, formattedText: "WRONG-CELL" },
      ],
    });
    const wrongRow = originalRow(9, ["ROW-NUMBER-FALLBACK"]);
    wrongRow.originalContent = JSON.stringify({
      rowNumber: 8,
      evidence: [
        { cell: "A9", formulaPresent: false, formattedText: "WRONG-ROW" },
      ],
    });
    d.originalSheets[0].rows = [
      evidenceRow,
      wrongRow,
      originalRow(12, ["CSV-TEXT", 0]),
    ];
    rt.get.mockResolvedValue(d);
    render();
    await settle();
    click(button("原表-1.csv"));
    await settle();
    const rows = Array.from(
      document.querySelectorAll(".history-sheet tbody tr")
    );
    expect(
      Array.from(rows[0].querySelectorAll("td")).map(td => td.textContent)
    ).toEqual([
      '=HYPERLINK("https://forbidden.invalid","<img src=x onerror=alert(1)>")',
      "001,234.50",
      "<script>forbidden()</script>",
      "old-value",
    ]);
    expect(rows[1].textContent).toContain("ROW-NUMBER-FALLBACK");
    expect(rows[2].textContent).toContain("CSV-TEXT");
    expect(preview().querySelector("a, img, script")).toBeNull();
    expect(preview().textContent).not.toMatch(
      /cached-result|WRONG-CELL|WRONG-ROW/
    );
  });

  it.each(["none", "empty"])(
    "does not render tabs when整理结果 is %s",
    async kind => {
      const d = detail();
      if (kind === "empty") d.selectedVersion = version(0);
      rt.get.mockResolvedValue(d);
      render();
      await settle();
      click(button("原表-1.csv"));
      await settle();
      expect(preview().textContent).toContain("ORIGINAL-ONE");
      expect(preview().querySelector('[role="tablist"]')).toBeNull();
      expect(preview().textContent).not.toContain("整理内容");
    }
  );

  it("shows existing整理内容 as a plain read-only 100-row paginated table without reconciliation or editors", async () => {
    const d = detail();
    d.selectedVersion = version(101);
    // A confirmed record still cannot trigger reconcile, resume, or confirmation writes.
    d.confirmation = {
      confirmationId: uuid(6001),
      batchRequestId: uuid(6002),
      versionId: uuid(2001),
      createdAt: d.history.createdAt,
      batch: {
        id: 501,
        batchCode: uuid(6003),
        revision: 1,
        channelId: 411,
        customerId: 801,
      },
      entries: [],
      excludedRows: [],
    };
    rt.get.mockResolvedValue(d);
    render();
    await settle();
    click(button("原表-1.csv"));
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(button("原文件").getAttribute("aria-selected")).toBe("true");
    click(button("整理内容"));
    expect(button("整理内容").getAttribute("aria-selected")).toBe("true");
    expect(
      Array.from(document.querySelectorAll(".history-sheet thead th")).map(
        th => th.textContent
      )
    ).toEqual(["型号", "品牌", "数量", "价格", "币种", "备注"]);
    expect(document.querySelectorAll(".history-sheet tbody tr")).toHaveLength(
      100
    );
    click(element('[aria-label="预览下一页"]'));
    expect(preview().textContent).toContain("整理-101");
    expect(document.querySelectorAll(".history-sheet tbody tr")).toHaveLength(
      1
    );
    expect(
      preview().querySelector('input, textarea, [contenteditable="true"]')
    ).toBeNull();
    expect(preview().querySelector('[aria-label="预览工作表"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /继续导入|继续处理|核对|回传|标记|确认导入/
    );
    click(button("原文件"));
    expect(preview().textContent).toContain("ORIGINAL-ONE");
    expect(rt.get).toHaveBeenCalledTimes(1);
  });
});

describe("上传历史：私有原件与客户端纯文件 ZIP", () => {
  it("downloads a parse_failed original through the single-file private API and revokes its blob URL", async () => {
    rt.list.mockResolvedValue({
      items: [history(1, { state: "parse_failed" })],
      nextCursor: null,
    });
    render();
    await settle();
    click(button("原表-1.csv", row()));
    await settle();
    click(button("下载", preview()));
    await settle();
    expect(rt.download).toHaveBeenCalledTimes(1);
    expect(rt.download.mock.calls[0][0]).toEqual({
      ...expected,
      files: [{ historyId: id, fileId }],
      includeManifest: false,
    });
    expect(rt.download.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(rt.get).toHaveBeenCalledTimes(1);
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: id });
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0]).toBeInstanceOf(File);
    expect(savedFiles[0].name).toBe("私有原件.csv");
    expect(
      Array.from(new Uint8Array(await savedFiles[0].arrayBuffer()))
    ).toEqual([97, 98, 99]);
    expect(anchors).toEqual([
      { href: "blob:private-1", download: "私有原件.csv" },
    ]);
    expect(
      document.querySelector('a[href^="http"], a[href^="blob:"]')
    ).toBeNull();
    await settle(1020);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
  });

  it("disables original and batch download when the server denies canDownload", async () => {
    const h = history();
    h.capabilities.canDownload = false;
    rt.list.mockResolvedValue({ items: [h], nextCursor: null });
    rt.get.mockResolvedValue(detail(h));
    render();
    await settle();
    expect(element<HTMLInputElement>(`[aria-label="选择文件${id}"]`).disabled).toBe(true);
    expect(
      element<HTMLInputElement>(`[aria-label="选择文件${id}"]`).disabled
    ).toBe(true);
    click(button("原表-1.csv"));
    await settle();
    expect(button("下载", preview()).disabled).toBe(true);
    click(button("下载", preview()));
    expect(rt.download).not.toHaveBeenCalled();
  });

  it("marks a missing original unavailable and blocks later row/preview/batch downloads", async () => {
    rt.get.mockRejectedValue(new Error("NoSuchKey"));
    render();
    await settle();
    select();
    click(button("原表-1.csv"));
    await settle();
    expect(preview().textContent).toContain("原文件不可用");
    expect(element<HTMLInputElement>(`[aria-label="选择文件${id}"]`).disabled).toBe(true);
    expect(button("下载", preview()).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("已选");
    expect(rt.download).not.toHaveBeenCalled();
  });

  it("accepts exactly 20 files and sends 20 sequential one-file calls, never a server ZIP or manifest request", async () => {
    const first = deferred<ReturnType<typeof downloadData>>();
    rt.list.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => history(i + 1)),
      nextCursor: null,
    });
    rt.download
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async input =>
        downloadData(`${input.files[0].historyId}.csv`)
      );
    render();
    await settle();
    click(element('[aria-label="选择本页文件"]'));
    click(button("下载所选"));
    await settle();
    expect(rt.download).toHaveBeenCalledTimes(1);
    expect(savedFiles).toHaveLength(0);
    expect(button("下载所选").disabled).toBe(true);
    await act(async () => {
      first.resolve(downloadData("first.csv"));
    });
    await settle(100);
    expect(rt.download).toHaveBeenCalledTimes(20);
    for (const [input, options] of rt.download.mock.calls) {
      expect(input).toMatchObject({ ...expected, includeManifest: false });
      expect(input.files).toHaveLength(1);
      expect(options.signal).toBe(rt.download.mock.calls[0][1].signal);
    }
    expect(savedFiles).toHaveLength(1);
    expect(
      Object.keys(unzipSync(new Uint8Array(await savedFiles[0].arrayBuffer())))
    ).toHaveLength(20);
  });

  it("rejects 21 selected files across UI pages without any download RPC", async () => {
    rt.list.mockResolvedValue({
      items: Array.from({ length: 21 }, (_, i) => history(i + 1)),
      nextCursor: null,
    });
    render();
    await settle();
    click(element('[aria-label="选择本页文件"]'));
    click(element('[aria-label="下一页"]'));
    click(element('[aria-label="选择本页文件"]'));
    expect(document.body.textContent).toContain("已选 21 项");
    click(button("下载所选"));
    await settle();
    expect(element('[role="alert"]').textContent).toContain(
      "每次最多下载20个文件，合计不超过10MB"
    );
    expect(rt.download).not.toHaveBeenCalled();
    expect(savedFiles).toHaveLength(0);
  });

  it.each([10485760, 10485761])(
    "enforces cumulative original size at the 10MiB boundary (%i bytes)",
    async total => {
      const a = history(1);
      const b = history(2);
      a.originalFile.byteSize = 5242880;
      b.originalFile.byteSize = total - 5242880;
      rt.list.mockResolvedValue({ items: [a, b], nextCursor: null });
      rt.download.mockImplementation(async input =>
        downloadData(`${input.files[0].historyId}.csv`)
      );
      render();
      await settle();
      click(element('[aria-label="选择本页文件"]'));
      click(button("下载所选"));
      await settle(50);
      expect(rt.download).toHaveBeenCalledTimes(total === 10485760 ? 2 : 0);
      if (total > 10485760)
        expect(element('[role="alert"]').textContent).toContain("不超过10MB");
      else expect(savedFiles).toHaveLength(1);
    }
  );

  it("builds a client ZIP of raw original bytes only, suffixing duplicate names and existing suffix collisions", async () => {
    const names = [
      "同名.csv",
      "同名.csv",
      "同名 (2).csv",
      "同名.csv",
      "README",
      "README",
    ];
    const contents = names.map(
      (_, i) => new Uint8Array([i, 0, 255, 10, 97 + i])
    );
    const items = names.map((_, i) => history(i + 1));
    items.forEach((h, i) => {
      h.createdAt = new Date(Date.UTC(2026, 10, 15, 0, 0, 6 - i)).toISOString();
    });
    rt.list.mockResolvedValue({ items, nextCursor: null });
    rt.download.mockImplementation(async input => {
      const i = items.findIndex(h => h.historyId === input.files[0].historyId);
      return downloadData(names[i], contents[i]);
    });
    render();
    await settle();
    click(element('[aria-label="选择本页文件"]'));
    click(button("下载所选"));
    await settle(80);
    expect(rt.download).toHaveBeenCalledTimes(6);
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0].name).toBe("上传文件.zip");
    expect(savedFiles[0].type).toBe("application/zip");
    const zip = unzipSync(new Uint8Array(await savedFiles[0].arrayBuffer()));
    const archiveNames = [
      "同名.csv",
      "同名 (2).csv",
      "同名 (2) (2).csv",
      "同名 (3).csv",
      "README",
      "README (2)",
    ];
    expect(Object.keys(zip)).toEqual(archiveNames);
    archiveNames.forEach((name, i) =>
      expect(Array.from(zip[name])).toEqual(Array.from(contents[i]))
    );
    expect(
      Object.keys(zip).some(name => /manifest|清单|说明|\.json$/i.test(name))
    ).toBe(false);
    rt.download.mock.calls.forEach(([input]) =>
      expect(input.files).toHaveLength(1)
    );
    rt.download.mock.calls.forEach(([input]) =>
      expect(input.includeManifest).toBe(false)
    );
    expect(anchors).toEqual([
      { href: "blob:private-1", download: "上传文件.zip" },
    ]);
  });
});

describe("上传历史：取消、旧响应与授权 scope", () => {
  it("closing preview aborts only its GET and ignores a late successful response", async () => {
    const read = deferred<HistoryDetail>();
    rt.get.mockImplementationOnce(() => read.promise);
    render();
    await settle();
    click(button("原表-1.csv"));
    expect(preview()).toBeTruthy();
    const signal = rt.get.mock.calls[0][1].signal;
    click(element('[aria-label="关闭预览"]'));
    expect(signal.aborted).toBe(true);
    expect(rt.close).not.toHaveBeenCalled();
    await act(async () => {
      read.resolve(detail());
    });
    expect(document.querySelector('[aria-label="文件预览"]')).toBeNull();
    expect(document.body.textContent).not.toContain("ORIGINAL-ONE");
    expect(rt.auth).not.toHaveBeenCalled();
  });

  it("Escape closes the preview first and then the dialog through real Radix events", async () => {
    const read = deferred<HistoryDetail>();
    rt.get.mockImplementationOnce(() => read.promise);
    render();
    await settle();
    click(button("原表-1.csv"));
    await settle();
    escape();
    expect(rt.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(rt.close).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="文件预览"]')).toBeNull();
    escape();
    expect(rt.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      read.resolve(detail());
    });
    expect(rt.auth).not.toHaveBeenCalled();
  });

  it.each(["success", "error"])(
    "switching preview aborts the old GET and suppresses its late %s",
    async outcome => {
      const old = deferred<HistoryDetail>();
      const d = detail(history(2));
      d.originalSheets[0].rows = [originalRow(33, ["FRESH-PREVIEW"])];
      rt.list.mockResolvedValue({
        items: [history(), history(2)],
        nextCursor: null,
      });
      rt.get.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(d);
      render();
      await settle();
      click(button("原表-1.csv", row(1)));
      click(button("原表-2.csv", row(2)));
      await settle();
      expect(rt.get.mock.calls[0][1].signal.aborted).toBe(true);
      expect(preview().textContent).toContain("FRESH-PREVIEW");
      await act(async () => {
        if (outcome === "success") old.resolve(detail());
        else old.reject(new Error("OLD-AUTH-ERROR"));
      });
      expect(preview().textContent).toContain("FRESH-PREVIEW");
      expect(preview().textContent).not.toContain("ORIGINAL-ONE");
      expect(document.body.textContent).not.toContain("OLD-AUTH-ERROR");
      expect(rt.auth).not.toHaveBeenCalled();
    }
  );

  it.each(["success", "error"])(
    "refresh aborts an outstanding cursor chain and suppresses old list %s",
    async outcome => {
      const old = deferred<{ items: History[]; nextCursor: string | null }>();
      rt.list
        .mockImplementationOnce(() => old.promise)
        .mockResolvedValueOnce({ items: [history(2)], nextCursor: null });
      render();
      await settle();
      click(button("刷新"));
      await settle();
      expect(rt.list.mock.calls[0][1].signal.aborted).toBe(true);
      expect(row(2)).toBeTruthy();
      await act(async () => {
        if (outcome === "success")
          old.resolve({ items: [history()], nextCursor: "must-not-fetch" });
        else old.reject(new Error("OLD-LIST-ERROR"));
      });
      expect(document.body.textContent).not.toContain("原表-1.csv");
      expect(rt.list).toHaveBeenCalledTimes(2);
      expect(rt.auth).not.toHaveBeenCalled();
    }
  );

  it.each(["success", "error"])(
    "dialog close immediately aborts pending list and ignores its late %s even before parent unmount",
    async outcome => {
      const old = deferred<{ items: History[]; nextCursor: null }>();
      rt.list.mockImplementationOnce(() => old.promise);
      render();
      await settle();
      click(button("Close"));
      expect(rt.close).toHaveBeenCalledTimes(1);
      expect(rt.list.mock.calls[0][1].signal.aborted).toBe(true);
      await act(async () => {
        if (outcome === "success")
          old.resolve({ items: [history()], nextCursor: null });
        else old.reject(new Error("CLOSED-LIST-ERROR"));
      });
      expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(
        0
      );
      expect(rt.auth).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("CLOSED-LIST-ERROR");
    }
  );

  it("dialog close aborts both pending preview and download, prevents the next file call and never saves late bytes", async () => {
    const read = deferred<HistoryDetail>();
    const bytes = deferred<ReturnType<typeof downloadData>>();
    rt.list.mockResolvedValue({
      items: [history(), history(2)],
      nextCursor: null,
    });
    rt.get.mockImplementationOnce(() => read.promise);
    rt.download.mockImplementationOnce(() => bytes.promise);
    render();
    await settle();
    click(element('[aria-label="选择本页文件"]'));
    click(button("下载所选"));
    click(button("原表-1.csv", row(1)));
    click(button("Close"));
    expect(rt.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(rt.download.mock.calls[0][1].signal.aborted).toBe(true);
    expect(rt.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      read.resolve(detail());
      bytes.resolve(downloadData());
    });
    await settle();
    expect(rt.download).toHaveBeenCalledTimes(1);
    expect(savedFiles).toHaveLength(0);
    expect(rt.auth).not.toHaveBeenCalled();
  });

  it("unmount aborts an outstanding GET and ignores a late rejection", async () => {
    const read = deferred<HistoryDetail>();
    rt.get.mockImplementationOnce(() => read.promise);
    render();
    await settle();
    click(button("原表-1.csv"));
    await act(async () => root!.unmount());
    root = undefined;
    expect(rt.get.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => {
      read.reject(new Error("UNMOUNTED-AUTH-ERROR"));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rt.auth).not.toHaveBeenCalled();
  });

  it("a no-longer-current identity suppresses late details and prevents download", async () => {
    const read = deferred<HistoryDetail>();
    rt.get.mockImplementationOnce(() => read.promise);
    render();
    await settle();
    click(button("原表-1.csv"));
    rt.current = false;
    await act(async () => {
      read.resolve(detail());
    });
    expect(document.body.textContent).not.toContain("ORIGINAL-ONE");
    const action = document.querySelector<HTMLButtonElement>(
      ".history-preview .history-link"
    );
    if (action) click(action);
    expect(rt.download).not.toHaveBeenCalled();
    expect(rt.auth).not.toHaveBeenCalled();
  });

  it("rejects a foreign-customer row from any cursor before showing even authorized partial rows", async () => {
    rt.list
      .mockResolvedValueOnce({
        items: [history()],
        nextCursor: "foreign-cursor",
      })
      .mockResolvedValueOnce({
        items: [history(2, { customerId: 802 })],
        nextCursor: null,
      });
    render();
    await settle();
    expect(element('[role="alert"]').textContent).toContain("归属不匹配");
    expect(document.querySelectorAll(".history-list tbody tr")).toHaveLength(0);
    expect(rt.auth).toHaveBeenCalledTimes(1);
    expect(rt.get).not.toHaveBeenCalled();
    expect(rt.download).not.toHaveBeenCalled();
    assertScopeCalls();
  });

  it.each(["customer", "history"])(
    "rejects detail with mismatched %s scope and never exposes foreign sheets/results",
    async mismatch => {
      const d = detail(
        history(mismatch === "history" ? 2 : 1, {
          customerId: mismatch === "customer" ? 802 : 801,
        })
      );
      d.originalSheets[0].rows = [originalRow(1, ["FOREIGN-SECRET"])];
      d.selectedVersion = version();
      rt.get.mockResolvedValue(d);
      render();
      await settle();
      click(button("原表-1.csv"));
      await settle();
      expect(preview().textContent).toContain("归属不匹配");
      expect(document.body.textContent).not.toContain("FOREIGN-SECRET");
      expect(preview().querySelector('[role="tablist"]')).toBeNull();
      expect(rt.auth).toHaveBeenCalledTimes(1);
      expect(rt.download).not.toHaveBeenCalled();
      expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: id });
    }
  );

  it("changing customer/identity remounts the session, aborts old requests and never mixes old data into new scope", async () => {
    const old = deferred<HistoryDetail>();
    rt.get.mockImplementationOnce(() => old.promise);
    render();
    await settle();
    click(button("原表-1.csv"));
    const nextIdentity = {
      enterpriseId: 32,
      actorUserId: 9,
      key: "next-verified-scope",
    };
    rt.list.mockResolvedValueOnce({
      items: [history(2, { customerId: 802 })],
      nextCursor: null,
    });
    render(802, nextIdentity);
    await settle();
    expect(rt.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(rt.list.mock.calls.at(-1)![0]).toEqual({
      expectedEnterpriseId: 32,
      expectedActorUserId: 9,
      customerId: 802,
      view: "mine",
      pageSize: 50,
    });
    await act(async () => {
      old.resolve(detail());
    });
    expect(document.body.textContent).not.toContain("ORIGINAL-ONE");
    expect(document.body.textContent).not.toContain("原表-1.csv");
    expect(row(2)).toBeTruthy();
    expect(document.querySelector('[aria-label="文件预览"]')).toBeNull();
  });

  it("leaves existing uncertain-operation and upload-recovery sessionStorage completely untouched", async () => {
    const suffix = `customer-supply-v15:31:7:801:${encodeURIComponent(identity.key)}`;
    const records = {
      [`customer-upload-history-operation:${suffix}`]:
        '{"kind":"mark","input":{"requestId":"keep-original-uuid","expectedRevision":4}}',
      [`customer-supply:${suffix}`]:
        '{"entries":[{"status":"unknown","requestId":"keep-batch-row"}]}',
    };
    const previous = Object.fromEntries(
      Object.keys(records).map(key => [
        key,
        storageGet.call(sessionStorage, key),
      ])
    );
    try {
      Object.entries(records).forEach(([key, value]) =>
        storageSet.call(sessionStorage, key, value)
      );
      storageBefore = storageSnapshot();
      render();
      await settle();
      click(button("原表-1.csv"));
      await settle();
      click(element('[aria-label="关闭预览"]'));
        await settle();
      click(button("Close"));
      expect(storageSnapshot()).toEqual(storageBefore);
      storageGuards.forEach(guard => expect(guard).not.toHaveBeenCalled());
    } finally {
      Object.entries(previous).forEach(([key, value]) =>
        value === null
          ? storageRemove.call(sessionStorage, key)
          : storageSet.call(sessionStorage, key, value)
      );
      storageBefore = storageSnapshot();
    }
  });
});
