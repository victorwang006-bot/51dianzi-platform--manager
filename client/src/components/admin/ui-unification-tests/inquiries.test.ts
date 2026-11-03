// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  enterprise: {
    data: { isOwner: false, permissionKeys: ["inquiry.receive"] },
    isLoading: false,
    isError: false,
    error: { message: "permission error" },
  },
  inbox: {
    data: {
      total: 41,
      rows: [{ id: 1, partNumber: "STM32F103", brand: "ST", quantity: 1200, buyerName: "采购企业", status: "open", conversationId: 8422001, lastActivityAt: "2026-11-03T08:00:00Z", createdAt: "2026-11-01T08:00:00Z" }],
    },
    isLoading: false,
    isError: false,
    error: { message: "inbox error" },
  },
  inboxCalls: [] as { input: { status: string; page: number; pageSize: number }; options: { enabled: boolean; retry: boolean; refetchOnWindowFocus: boolean } }[],
}));

vi.mock("@/business/BusinessContentFrame", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/business/api/business-trpc", () => ({
  trpc: { enterprise: {
    me: { useQuery: () => runtime.enterprise },
    inquiryInbox: { useQuery: (input: (typeof runtime.inboxCalls)[number]["input"], options: (typeof runtime.inboxCalls)[number]["options"]) => {
      runtime.inboxCalls.push({ input, options });
      return runtime.inbox;
    } },
  } },
}));
vi.mock("@/business/platform/client/src/hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: <T,>(_key: string, initial: T) => useState(initial),
    freshListOptions: (options: unknown) => options,
    useRestoringListQuery: (query: unknown) => query,
    returnToPageSource: vi.fn(),
  };
});
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props, children),
}));

import EnterpriseInquiryInbox from "@/business/platform/client/src/pages/EnterpriseInquiryInbox";

// The repository Vitest config uses classic JSX; production Vite supplies the automatic runtime.
vi.stubGlobal("React", React);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  runtime.enterprise.data = { isOwner: false, permissionKeys: ["inquiry.receive"] };
  runtime.enterprise.isLoading = false;
  runtime.enterprise.isError = false;
  runtime.inbox.data = {
    total: 41,
    rows: [{ id: 1, partNumber: "STM32F103", brand: "ST", quantity: 1200, buyerName: "采购企业", status: "open", conversationId: 8422001, lastActivityAt: "2026-11-03T08:00:00Z", createdAt: "2026-11-01T08:00:00Z" }],
  };
  runtime.inbox.isLoading = false;
  runtime.inbox.isError = false;
  runtime.inboxCalls.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(createElement(EnterpriseInquiryInbox)));
}

async function click(element: Element | undefined | null) {
  if (!element) throw new Error("Missing control");
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(item => item.textContent?.includes(label));
}

const lastCall = () => runtime.inboxCalls[runtime.inboxCalls.length - 1];

describe("询价接待统一界面", () => {
  it("uses shared page, heading, filters and data panels without losing business columns or reception targets", async () => {
    await render();
    expect(container.querySelector("[data-enterprise-inquiry-inbox]")?.classList.contains("aui-page")).toBe(true);
    expect(container.querySelector(".aui-page-title")?.textContent).toBe("企业询价");
    expect(container.querySelector(".aui-filterbar[role=tablist]")?.getAttribute("aria-label")).toBe("询价状态筛选");
    expect(container.querySelector(".aui-data-panel[role=region]")?.getAttribute("aria-labelledby")).toBe("enterprise-inquiry-list-title");
    expect(Array.from(container.querySelectorAll("thead th")).map(th => th.textContent)).toEqual(["型号 / 品牌", "数量", "采购方", "状态", "更新时间", "操作"]);
    const row = container.querySelector("tbody tr")!;
    for (const text of ["STM32F103", "ST", "1200", "采购企业", "待回复", "2026-11-03"]) expect(row.textContent).toContain(text);
    expect(row.children[1].classList.contains("text-right")).toBe(true);
    expect(row.children[5].classList.contains("text-right")).toBe(true);
    const receptionLinks = container.querySelectorAll("a");
    expect(receptionLinks).toHaveLength(2);
    for (const link of receptionLinks) {
      expect(link.getAttribute("href")).toBe("/chat?conversationId=8422001");
      expect(link.textContent).toBe("接待询价");
    }
    expect(lastCall()).toEqual({ input: { status: "all", page: 1, pageSize: 20 }, options: { enabled: true, retry: false, refetchOnWindowFocus: true } });
  });

  it("preserves status selection, pagination limits and page reset on status changes", async () => {
    await render();
    expect(button("上一页")?.disabled).toBe(true);
    await click(button("下一页"));
    expect(lastCall().input).toEqual({ status: "all", page: 2, pageSize: 20 });
    await click(button("下一页"));
    expect(button("下一页")?.disabled).toBe(true);
    expect(container.querySelector("[aria-label=询价分页]")?.textContent).toContain("第 3/3 页");
    await click(button("已回复"));
    expect(lastCall().input).toEqual({ status: "replied", page: 1, pageSize: 20 });
    expect(button("已回复")?.getAttribute("aria-selected")).toBe("true");
    expect(button("全部")?.getAttribute("aria-selected")).toBe("false");
    await click(button("待回复"));
    expect(lastCall().input.status).toBe("open");
    await click(button("已关闭"));
    expect(lastCall().input.status).toBe("closed");
    await click(button("全部"));
    expect(lastCall().input.status).toBe("all");
  });

  it("keeps permission denial fail-closed and does not expose reception links", async () => {
    runtime.enterprise.data.permissionKeys = [];
    await render();
    expect(lastCall().options.enabled).toBe(false);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("您没有询价接待权限");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).not.toContain("我的接待询价");
  });

  it("keeps owner visibility distinct from assigned employee visibility", async () => {
    runtime.enterprise.data = { isOwner: true, permissionKeys: [] };
    await render();
    expect(lastCall().options.enabled).toBe(true);
    expect(container.textContent).toContain("企业管理视图");
    expect(container.textContent).toContain("查看企业当前分配给您的询价接待业务。");
    runtime.enterprise.data = { isOwner: false, permissionKeys: ["inquiry.receive"] };
    await render();
    expect(container.textContent).toContain("我的接待询价");
    expect(container.textContent).toContain("仅展示后端分配给您接待的询价。");
  });

  it("keeps permission loading and permission errors ahead of inbox data", async () => {
    runtime.enterprise.isLoading = true;
    await render();
    expect(container.querySelector(".aui-data-panel")?.textContent).toContain("正在确认询价接待权限…");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    runtime.enterprise.isLoading = false;
    runtime.enterprise.isError = true;
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("企业权限加载失败：permission error");
  });

  it("preserves inbox loading, errors, empty state and single-page pagination visibility", async () => {
    runtime.inbox.isLoading = true;
    await render();
    expect(container.querySelector(".aui-data-panel")?.textContent).toContain("正在加载询价…");
    runtime.inbox.isLoading = false;
    runtime.inbox.isError = true;
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("询价列表加载失败：inbox error");
    runtime.inbox.isError = false;
    runtime.inbox.data.rows = [];
    await render();
    expect(container.querySelector(".aui-data-panel")?.textContent).toContain("暂无符合条件的询价");
    expect(container.querySelector("[aria-label=询价分页]")).toBeNull();
    runtime.inbox.data = { total: 1, rows: [{ id: 1, partNumber: "STM32F103", brand: "", quantity: 1200, buyerName: "", status: "unknown", conversationId: 8422001, lastActivityAt: "", createdAt: "2026-11-01T08:00:00Z" }] };
    await render();
    expect(container.querySelector("[aria-label=询价分页]")).toBeNull();
    expect(container.querySelector("tbody tr")?.textContent).toContain("待回复");
    expect(container.querySelector("tbody tr")?.textContent).toContain("2026-11-01");
    expect(container.querySelector("tbody tr")?.textContent).toContain("—");
  });

  it("keeps existing memory and query hooks without introducing reception or quote request paths", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/business/platform/client/src/pages/EnterpriseInquiryInbox.tsx"), "utf8");
    expect(source).toContain('useRememberedState<InboxStatus>("status", "all")');
    expect(source).toContain('useRememberedState("page", 1)');
    expect(source).toContain("useRestoringListQuery(trpc.enterprise.inquiryInbox.useQuery");
    expect(source).toContain("}, d51Ready)))");
    expect(source).toContain("onClick={() => setStatus(value)}");
    expect(source).not.toMatch(/useMutation|AbortController|fetch\(/);
    expect(source).not.toMatch(/text-\[(18|22)px\]|zoom:|!important/);
  });
});
