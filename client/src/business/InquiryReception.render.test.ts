// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const mutations: { path: string; input: any }[] = [];
  const reads: { path: string; input: any; options: any }[] = [];
  const conversation = { id: 11, otherUserId: 22, otherUserName: "采购客户", otherUserOriginalName: "采购客户", otherCompanyProfileSupplierId: null, otherUserAvatar: null, isService: false, remarkName: null, lastMessageAt: new Date("2026-11-13T00:00:00Z"), lastMessagePreview: "请确认交期", currentRound: 1, endedAt: null, endedByUserId: null, pinned: false, groupName: null, groupIds: [], unreadCount: 2 };
  const rows = [{ id: 1, inventoryId: null, conversationId: 11, buyerName: "采购客户", buyerCompanyName: "真实客户企业", partNumber: "LM358", brand: "TI", quantity: null, status: "open", createdAt: new Date("2026-11-13T00:00:00Z"), lastActivityAt: new Date("2026-11-13T00:00:00Z"), sourceFactoryName: "来源工厂标签", assigneeName: "真实接待员工" }, { id: 2, conversationId: 99, inventoryId: 123, buyerName: "他人采购客户", partNumber: "NE555", brand: "TI", quantity: 100, status: "replied", createdAt: new Date(), lastActivityAt: new Date() }];
  const scope = { storageScope: "staff:33:enterprise:44:merchant:30061:binding:1", frontUser: { id: 33 }, staffPrincipal: { enterpriseId: 44 }, contextVerification: { authorizationVersion: "a1" }, sessionCapabilities: { receptionReady: true }, onAuthorizationError: vi.fn() };
  let search = "", permission = true, owner = false, messagesError = false, conversationsError = false;
  let overrideRows: any[] | undefined, overrideConversations: any[] | undefined;
  const result = (path: string, input?: any): any => {
    if (path === "enterprise.me") return { isOwner: owner, permissionKeys: permission ? ["inquiry.receive"] : ["inventory.edit"] };
    if (path === "enterprise.inquiryInbox") return { rows: overrideRows ?? (input?.page > 1 ? [{ ...rows[0], id: 101, conversationId: 11, partNumber: "第二页型号", buyerName: "第二页客户" }] : rows), total: overrideRows?.length ?? 101, page: input?.page ?? 1, pageSize: 100 };
    if (path === "chat.listConversations") return overrideConversations ?? [conversation];
    if (path === "chat.listGroups" || path === "chat.listTrashedGroups") return [];
    if (path === "chat.getMessages") return { messages: [{ id: 55, conversationId: 11, senderId: 22, msgType: "inquiry", content: JSON.stringify({ partNumber: "LM358", brand: "TI", qty: null }), createdAt: new Date("2026-11-13T00:00:00Z") }, { id: 56, conversationId: 11, senderId: 22, msgType: "text", content: "原会话买方消息", createdAt: new Date("2026-11-13T00:01:00Z") }], peerLastReadMessageId: 0 };
    if (path === "publicReview.state") return { status: "not_eligible" };
    if (path === "chat.getTotalUnread") return { total: 2 };
    if (path === "chat.markRead") return { totalUnread: 0 };
    if (path === "chat.sendMessage") return { ok: true, message: { id: 77, conversationId: input.conversationId, senderId: 33, msgType: input.msgType, content: input.content, clientMessageId: input.clientMessageId, createdAt: new Date() } };
    if (path === "chat.uploadAttachment") return { id: 66, kind: "file", originalName: "inquiry.pdf", mimeType: "application/pdf", byteSize: 3, url: null };
    return undefined;
  };
  const procedure = (path: string): any => new Proxy(Object.create(null), { get(_target, key) {
    if (typeof key !== "string") return undefined;
    if (key === "client") return procedure("");
    if (key === "useQuery") return (input?: any, options?: any) => {
      reads.push({ path, input, options });
      const error = path === "chat.getMessages" && messagesError || path === "chat.listConversations" && conversationsError;
      return { data: error ? undefined : result(path, input), isLoading: false, isPending: false, isSuccess: !error, isError: error, error: error ? new Error("denied messages") : null, refetch: async () => result(path, input) };
    };
    if (key === "useMutation") return () => ({ isPending: false, mutate(input: any, callbacks?: any) { mutations.push({ path, input }); callbacks?.onSuccess?.(result(path, input)); }, async mutateAsync(input: any) { mutations.push({ path, input }); return result(path, input); } });
    if (key === "query" || key === "fetch") return async (input?: any, options?: any) => { reads.push({ path, input, options }); return result(path, input); };
    if (key === "getData") return () => result(path);
    if (["setData", "invalidate", "cancel"].includes(key)) return async () => undefined;
    return procedure(path ? `${path}.${key}` : key);
  } });
  const trpc = new Proxy(Object.create(null), { get(_target, key) { return key === "useUtils" ? () => procedure("") : typeof key === "string" ? procedure(key) : undefined; } });
  return { scope, trpc, conversation, mutations, reads, set overrideRows(value: any[] | undefined) { overrideRows = value; }, set overrideConversations(value: any[] | undefined) { overrideConversations = value; }, get search() { return search; }, set search(value: string) { search = value; }, get owner() { return owner; }, set owner(value: boolean) { owner = value; }, get permission() { return permission; }, set permission(value: boolean) { permission = value; }, get messagesError() { return messagesError; }, set messagesError(value: boolean) { messagesError = value; }, get conversationsError() { return conversationsError; }, set conversationsError(value: boolean) { conversationsError = value; }, reset() { mutations.length = 0; reads.length = 0; search = ""; permission = true; owner = false; messagesError = false; conversationsError = false; overrideRows = undefined; overrideConversations = undefined; scope.contextVerification.authorizationVersion = "a1"; scope.sessionCapabilities.receptionReady = true; scope.storageScope = "staff:33:enterprise:44:merchant:30061:binding:1"; } };
});
vi.mock("./api/business-trpc", () => ({ trpc: state.trpc }));
vi.mock("./BusinessScope", () => ({ useBusinessScope: () => state.scope }));
vi.mock("./api/business-auth", () => ({ useAuth: () => ({ user: { id: 33, name: "真实接待员工", crmAccess: true }, loading: false, logout: async () => undefined }) }));
vi.mock("wouter", () => ({ Link: ({ children }: any) => children, useLocation: () => ["/inquiries", (value: string) => { state.search = value.split("?")[1] ?? ""; }], useSearch: () => state.search }));
vi.mock("./platform/client/src/components/ForumUnreadBadge", () => ({ default: () => null, useForumUnreadTotal: () => ({ total: 0 }) }));
vi.mock("./platform/client/src/components/MallLoginDialog", () => ({ default: () => null }));

import InquiryReception from "./InquiryReception";
let host: HTMLDivElement, root: Root, client: QueryClient;
async function render(canReply = true) { await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(InquiryReception, { canReply }))); await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function click(label: string) { const b = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, "")); expect(b, label).toBeTruthy(); await act(async () => b!.click()); }
async function clickSelector(selector: string) { const button = host.querySelector<HTMLButtonElement>(selector); expect(button, selector).not.toBeNull(); await act(async () => button!.click()); }
async function setInput(node: HTMLInputElement | HTMLTextAreaElement, value: string) { const proto = node instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, value); await act(async () => node.dispatchEvent(new Event("input", { bubbles: true }))); }
async function search(value: string) { await setInput(host.querySelector<HTMLInputElement>('[aria-label="搜索客户或型号"]')!, value); }
async function changeView(view: "mine" | "team") { const select = host.querySelector<HTMLSelectElement>('[aria-label="接待查看范围"]')!; await act(async () => { select.value = view; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
beforeEach(() => {
  state.reset(); Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: any) => clearTimeout(id));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

function materialFixture() {
  const date = new Date("2026-11-13T00:00:00Z");
  const base = { inventoryId: 501, sourceKind: "inventory", partNumber: "LM358", brand: "TI", quantity: 500, requestedQty: 10, status: "open", createdAt: date, lastActivityAt: date };
  state.overrideRows = [
    { ...base, id: 1, conversationId: 11, buyerName: "采购A", buyerCompanyName: "客户企业A" },
    { ...base, id: 2, conversationId: 11, buyerName: "采购A", buyerCompanyName: "客户企业A", status: "replied" },
    { ...base, id: 3, conversationId: 12, buyerName: "采购B", buyerCompanyName: "客户企业B" },
    { ...base, id: 4, conversationId: 13, inventoryId: 502, buyerName: "采购C", status: "closed" },
    { ...base, id: 5, conversationId: 14, inventoryId: null, buyerName: "无来源甲" },
    { ...base, id: 6, conversationId: 14, inventoryId: null, buyerName: "无来源乙" },
  ];
  state.overrideConversations = [state.conversation, { ...state.conversation, id: 12, otherUserId: 23, otherUserName: "采购B", unreadCount: 3, pinned: true },
    { ...state.conversation, id: 13, otherUserId: 24, otherUserName: "采购C", unreadCount: 0, lastMessageAt: new Date("2026-11-14T00:00:00Z") },
    { ...state.conversation, id: 14, otherUserId: 25, otherUserName: "无来源客户", unreadCount: 0 }];
}

describe("真实接待三栏与原conversation渲染DI", () => {
  it("三栏默认全部会话：左栏不嵌客户、中栏读全部页，右空态无重复标题且不读消息", async () => {
    await render(); await render();
    expect(host.querySelectorAll(".inquiry-reception__sidebar")).toHaveLength(1);
    expect(host.querySelectorAll(".inquiry-reception__group-item")).toHaveLength(2);
    expect(host.querySelectorAll('.inquiry-reception__group-item[aria-pressed="true"]')).toHaveLength(0);
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(2);
    expect(host.querySelector(".inquiry-reception__sidebar .inquiry-reception__item")).toBeNull();
    expect(host.querySelector(".inquiry-reception__sidebar")?.textContent).not.toContain("真实客户企业");
    expect(host.querySelector(".inquiry-reception__queue-header h2")?.textContent).toBe("会话");
    expect(host.querySelector<HTMLInputElement>(".inquiry-reception__search input")?.placeholder).toBe("搜索联系人...");
    expect(host.querySelector(".inquiry-reception__detail-bar")).toBeNull();
    expect(host.querySelector(".inquiry-reception__empty-state p")?.textContent).toBe("选择一个会话开始聊天");
    expect(host.querySelector(".inquiry-reception__empty-icon")).not.toBeNull();
    expect(host.querySelector(".inquiry-reception__toolbar")).toBeNull();
    expect(host.querySelector('.inquiry-reception__sidebar-footer [aria-label="刷新询价"]')).not.toBeNull();
    expect(host.textContent).toContain("真实客户企业"); expect(host.textContent).not.toContain("他人采购客户");
    expect(host.querySelector<HTMLButtonElement>(".inquiry-reception__item")?.title).toContain("数量待确认"); expect(state.search).toBe(""); expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelectorAll(".inquiry-reception__item-body > span")).toHaveLength(4);
    expect(host.querySelector(".inquiry-reception__part")).toBeNull();
    expect(state.mutations).toEqual([]); expect(state.reads.some(item => item.path === "chat.getMessages")).toBe(false);
    expect(state.reads.some(item => item.path === "enterprise.inquiryInbox" && item.input.page === 2)).toBe(true);
    await search("第二页型号"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>(".inquiry-reception__item")?.title).toContain("第二页型号");
    expect(host.querySelector("h1")).toBeNull(); expect(host.querySelector('[aria-label="前台导航"]')).toBeNull();
  });
  it("同会话具体询价通过inquiryId选择，摘要不混来源；返回保留merchant URL", async () => {
    await render(); await render(); state.search = "merchantId=30061&enterpriseId=44"; await render();
    await clickSelector('[data-inquiry-id="101"]'); await render();
    const params = new URLSearchParams(state.search);
    expect(params.get("conversationId")).toBe("11"); expect(params.get("inquiryId")).toBe("101");
    expect(params.get("merchantId")).toBe("30061"); expect(params.get("enterpriseId")).toBe("44");
    expect(host.querySelector(".inquiry-reception__summary-content")).toBeNull();
    await click("业务摘要"); expect(host.querySelectorAll(".inquiry-reception__summary-content")).toHaveLength(1);
    expect(host.querySelector("dialog")?.textContent).toContain("第二页型号");
    expect(host.querySelector('[data-inquiry-id="101"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-inquiry-id="1"]')?.getAttribute("aria-pressed")).toBe("false");
    await click("关闭摘要"); expect(host.querySelector("dialog")).toBeNull();
    await clickSelector(".inquiry-reception__back"); await render();
    expect(state.search).toBe("merchantId=30061&enterpriseId=44");
    expect(host.querySelector('[data-inquiry-reception]')?.getAttribute("data-detail")).toBe("false");
  });
  it("不同conversation的inquiryId不误用于摘要", async () => {
    state.search = "conversationId=11&inquiryId=2"; await render(); await render();
    expect(host.querySelector(".inquiry-reception__summary-trigger")).toBeNull();
    expect(host.querySelector('[data-reception-conversation="11"]')).not.toBeNull();
  });
  it("真实查看成功消息才原markRead，回复及附件仍用原会话，无个人采购入口", async () => {
    state.search = "conversationId=11"; await render(); await render();
    expect(host.querySelector('[data-reception-conversation="11"]')).not.toBeNull();
    expect(host.textContent).toContain("原会话买方消息");
    await click("业务摘要"); expect(host.textContent).toContain("来源工厂标签"); expect(host.textContent).toContain("真实接待员工");
    await click("关闭摘要");
    expect(state.mutations.some(item => item.path === "chat.markRead" && item.input.conversationId === 11)).toBe(true);
    const editor = host.querySelector("textarea")!; expect(editor.disabled).toBe(false);
    await setInput(editor, "接待同一会话回复"); await click("发送");
    expect(state.mutations.some(item => item.path === "chat.sendMessage" && item.input.conversationId === 11 && item.input.content === "接待同一会话回复")).toBe(true);
    expect(host.textContent).not.toContain("发报价单"); expect(host.textContent).not.toContain("新建分组");
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"][accept^=".pdf"]')!;
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["PDF"], "inquiry.pdf", { type: "application/pdf" })] });
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(state.mutations.some(item => item.path === "chat.uploadAttachment" && item.input.conversationId === 11)).toBe(true);
    expect(state.mutations.some(item => item.path === "chat.sendMessage" && item.input.msgType === "file" && item.input.conversationId === 11)).toBe(true);
    expect(state.reads.some(item => ["chat.getServiceUser", "forum.unreadState", "enterprise.myInvitations"].includes(item.path) && item.options?.enabled)).toBe(false);
    expect(state.mutations.some(item => ["chat.getOrCreateConversation", "chat.startInventoryInquiry"].includes(item.path))).toBe(false);
  });
  it("已授权只读保留原消息而回复/附件不可操作", async () => {
    state.search = "conversationId=11"; await render(false); await render(false);
    expect(host.textContent).toContain("原会话买方消息"); expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(host.textContent).toContain("当前企业范围仅可查看接待");
    expect(state.mutations.some(item => item.path === "chat.sendMessage" || item.path === "chat.uploadAttachment")).toBe(false);
  });
  it("监督队列仅摘要，连owner本人会话也不挂载ChatPage", async () => {
    state.owner = true; await render(); await render(); await changeView("team");
    expect(host.textContent).toContain("他人采购客户"); expect(host.textContent).toContain("监督查看不会成为参与人");
    await clickSelector('[data-inquiry-id="1"]'); await render(); await click("业务摘要");
    expect(host.querySelector("dialog")?.textContent).toContain("来源工厂标签");
    expect(host.querySelector("textarea")).toBeNull(); expect(host.querySelector('[data-reception-conversation="11"]')).toBeNull();
    expect(state.reads.some(item => item.path === "chat.getMessages")).toBe(false); expect(state.mutations).toEqual([]);
    await click("关闭摘要"); await clickSelector('[data-inquiry-id="2"]'); await render(); await click("业务摘要");
    expect(host.querySelector("dialog")?.textContent).toContain("NE555");
    expect(state.reads.some(item => item.path === "chat.getMessages" && item.input?.conversationId === 99)).toBe(false);
  });
  it("库存权限不能代替接待权限，消息失败不markRead", async () => {
    state.permission = false; await render(); expect(host.textContent).toContain("库存权限不能代替"); expect(host.querySelector("textarea")).toBeNull();
    state.permission = true; state.messagesError = true; state.search = "conversationId=11&merchantId=30061";
    await render(); await render(); expect(host.textContent).toContain("消息加载失败"); expect(state.mutations).toEqual([]);
    await clickSelector(".inquiry-reception__back"); await render(); expect(state.search).toBe("merchantId=30061");
  });
});

describe("物料导航和中栏筛选", () => {
  it("左栏只显示型号/家数/去重未读，点击仅本地筛中栏不选会话、不标读", async () => {
    materialFixture(); state.search = "merchantId=30061&enterpriseId=44"; await render(); await render();
    const groups = host.querySelectorAll<HTMLButtonElement>(".inquiry-reception__group-item");
    expect(groups).toHaveLength(4); expect(groups[0].textContent).toContain("LM358"); expect(groups[0].textContent).toContain("2家");
    expect(groups[0].textContent).not.toContain("TI"); expect(groups[0].textContent).not.toContain("普通库存");
    expect(groups[0].title).toContain("普通库存 · #501");
    expect(groups[0].querySelector('[aria-label="5 条会话未读（已去重）"]')).not.toBeNull();
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
    await act(async () => groups[0].click()); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(3);
    expect(host.querySelector('.inquiry-reception__queue-material')?.textContent).toContain("LM358 · 2家");
    await act(async () => groups[1].click()); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="4"]')).not.toBeNull();
    expect(state.search).toBe("merchantId=30061&enterpriseId=44"); expect(state.mutations).toEqual([]);
    expect(state.reads.some(item => item.path === "chat.getMessages")).toBe(false);
    await click("全部会话"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
  });
  it("搜索型号/客户与状态保留，不合并同conversation原询价；caps支持全部/未读/真实置顶", async () => {
    materialFixture(); await render(); await render();
    await search("lm358"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
    await search("客户企业B"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="3"]')).not.toBeNull();
    await click("已回复"); expect(host.textContent).toContain("暂无符合条件");
    await search("lm358"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="2"]')).not.toBeNull();
    await click("待回复"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(4);
    await click("已关闭"); expect(host.querySelector('[data-inquiry-id="4"]')).not.toBeNull();
    await click("全部"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
    await click("未读"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(3);
    await click("置顶"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="3"]')).not.toBeNull();
    expect(state.mutations).toEqual([]); expect(state.search).toBe("");
  });
  it("不支持pinned的DTO为空列表，不伪造置顶或请求pin", async () => {
    materialFixture(); state.overrideConversations = [11, 12, 13, 14].map(id => { const { pinned: _pinned, ...rest } = state.conversation; return { ...rest, id }; });
    await render(); await render(); await click("已置顶");
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(0); expect(host.textContent).toContain("暂无符合条件");
    expect(host.querySelector('[aria-label="置顶会话"]')).toBeNull(); expect(state.mutations).toEqual([]);
  });
  it("同source原询价选择不混，同型号不同source物料筛选隔离", async () => {
    materialFixture(); await render(); await render();
    await clickSelector('[data-inquiry-id="2"]'); await render();
    expect(new URLSearchParams(state.search).get("inquiryId")).toBe("2");
    expect(host.querySelector('[data-inquiry-id="2"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-inquiry-id="1"]')?.getAttribute("aria-pressed")).toBe("false");
    await click("业务摘要"); expect(host.querySelector("dialog")?.textContent).toContain("已回复");
    await act(async () => host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: true }))); expect(host.querySelector("dialog")).toBeNull();
    await clickSelector('.inquiry-reception__group-item[title*="#502"]');
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="4"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(new URLSearchParams(state.search).get("inquiryId")).toBe("2");
  });
  it("移动导航默认queue可见，返回消息/会话是本地操作，客户点击才data-detail", async () => {
    materialFixture(); await render(); await render();
    const section = host.querySelector('[data-inquiry-reception]')!;
    expect(section.getAttribute("data-navigation")).toBe("queue"); expect(section.getAttribute("data-detail")).toBe("false");
    expect(section.getAttribute("data-sidebar-open")).toBe("false");
    await clickSelector(".inquiry-reception__sidebar-toggle"); expect(section.getAttribute("data-navigation")).toBe("messages");
    expect(section.getAttribute("data-sidebar-open")).toBe("true");
    await clickSelector(".inquiry-reception__mobile-back"); expect(section.getAttribute("data-navigation")).toBe("queue");
    expect(section.getAttribute("data-sidebar-open")).toBe("false");
    await clickSelector(".inquiry-reception__sidebar-toggle"); await clickSelector('.inquiry-reception__group-item[title*="#501"]');
    expect(section.getAttribute("data-sidebar-open")).toBe("false"); expect(section.getAttribute("data-detail")).toBe("false");
    expect(state.search).toBe(""); expect(state.mutations).toEqual([]);
    await clickSelector('[data-inquiry-id="2"]'); await render(); expect(section.getAttribute("data-detail")).toBe("true");
  });
});

describe("真实头像与接待授权生命周期", () => {
  it("真实section几何高度随visualViewport/resize及导航ResizeObserver变化，卸载清监听", async () => {
    let top = 100;
    const viewport = { height: 600, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("visualViewport", viewport);
    const observe = vi.fn(), disconnect = vi.fn(); let changed: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { changed = callback; } observe = observe; disconnect = disconnect; });
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }));
    const nav = document.createElement("nav"); document.body.append(nav);
    try {
      await render(); await render();
      const section = host.querySelector<HTMLElement>('[data-inquiry-reception]')!;
      expect(section.style.getPropertyValue("--reception-height")).toBe("500px"); expect(observe).toHaveBeenCalledWith(nav);
      viewport.height = 400; window.dispatchEvent(new Event("resize")); expect(section.style.getPropertyValue("--reception-height")).toBe("300px");
      top = 150; changed!(); expect(section.style.getPropertyValue("--reception-height")).toBe("250px");
      await act(async () => root.render(null)); expect(disconnect).toHaveBeenCalled();
      expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function)); expect(viewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    } finally { geometry.mockRestore(); nav.remove(); }
  });
  it("五gradient按真实otherUserId稳定取色，同客户重复询价同色；未知身份首字无假色", async () => {
    materialFixture(); await render(); await render();
    const avatar = (id: number) => host.querySelector(`[data-inquiry-id="${id}"] .inquiry-reception__avatar`)!;
    expect(avatar(1).className).toBe(avatar(2).className); expect(avatar(1).getAttribute("data-avatar-user-id")).toBe("22");
    expect(avatar(1).className).toContain("from-[#f0893a]"); expect(avatar(3).className).toContain("from-[#9b59b6]");
    expect(avatar(4).className).toContain("from-[#17a2b8]"); expect(avatar(5).className).toContain("from-[#2B7AE8]");
    state.overrideConversations = [{ ...state.conversation, otherUserId: 21 }, { ...state.conversation, id: 12, otherUserId: null }]; await render();
    expect(avatar(1).className).toContain("from-[#43a867]"); expect(avatar(3).className).not.toContain("bg-gradient"); expect(avatar(3).textContent).toBe("客");
    expect(host.querySelectorAll(".inquiry-reception__avatar img")).toHaveLength(0);
  });
  it("仅真实DTO头像使用UserAvatar，真实buyerId优先；图片失败回退五色首字", async () => {
    const date = new Date(); state.overrideRows = [{ id: 1, inventoryId: null, conversationId: 11, buyerId: 21, buyerName: "采购A", partNumber: "LM358", brand: "TI", status: "open", createdAt: date, lastActivityAt: date }];
    state.overrideConversations = [{ ...state.conversation, otherUserAvatar: "https://example.invalid/real-buyer.png" }];
    await render(); await render();
    const avatar = host.querySelector(".inquiry-reception__avatar")!; expect(avatar.getAttribute("data-avatar-user-id")).toBe("21");
    const image = avatar.querySelector("img")!; expect(image.getAttribute("src")).toBe("https://example.invalid/real-buyer.png");
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(avatar.textContent).toBe("采"); expect(avatar.querySelector("div")?.className).toContain("from-[#43a867]");
  });
  it.each(["authorization", "identity", "permission", "read-error", "scope-ready"])("%s变化清本地物料/搜索/摘要，失败期间撤下旧私人内容", async kind => {
    materialFixture(); await render(); await render(); await clickSelector('.inquiry-reception__group-item[title*="#501"]'); await search("客户企业A");
    await clickSelector('[data-inquiry-id="2"]'); await render(); await click("业务摘要"); expect(host.querySelector("dialog")).not.toBeNull();
    if (kind === "authorization") state.scope.contextVerification.authorizationVersion = "a2";
    if (kind === "identity") state.scope.storageScope = "staff:34:enterprise:45:merchant:40000:binding:2";
    if (kind === "permission") state.permission = false;
    if (kind === "read-error") state.conversationsError = true;
    if (kind === "scope-ready") state.scope.sessionCapabilities.receptionReady = false;
    await render(); expect(host.querySelector("dialog")).toBeNull();
    if (["permission", "read-error", "scope-ready"].includes(kind)) {
      expect(host.querySelector(".inquiry-reception__queue")).toBeNull(); expect(host.textContent).not.toContain("客户企业A"); expect(host.querySelector("textarea")).toBeNull();
      state.permission = true; state.conversationsError = false; state.scope.sessionCapabilities.receptionReady = true;
    }
    await render(); await render();
    expect(host.querySelectorAll('.inquiry-reception__group-item[aria-pressed="true"]')).toHaveLength(0);
    expect(host.querySelector<HTMLInputElement>('[aria-label="搜索客户或型号"]')?.value).toBe(""); expect(host.querySelector("dialog")).toBeNull();
  });
  it("view变化清摘要与物料；卸载重进默认全部不自动选会话", async () => {
    materialFixture(); state.owner = true; await render(); await render();
    await clickSelector('.inquiry-reception__group-item[title*="#501"]'); await clickSelector('[data-inquiry-id="2"]'); await render(); await click("业务摘要");
    await changeView("team"); expect(host.querySelector("dialog")).toBeNull(); expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelectorAll('.inquiry-reception__group-item[aria-pressed="true"]')).toHaveLength(0);
    state.search = ""; await act(async () => root.render(null)); await render(); await render();
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6); expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelectorAll('.inquiry-reception__group-item[aria-pressed="true"]')).toHaveLength(0);
  });
});
