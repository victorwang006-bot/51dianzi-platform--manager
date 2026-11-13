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
  let search = "", permission = true, owner = false, messagesError = false;
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
      const error = path === "chat.getMessages" && messagesError;
      return { data: error ? undefined : result(path, input), isLoading: false, isPending: false, isSuccess: !error, isError: error, error: error ? new Error("denied messages") : null, refetch: async () => result(path, input) };
    };
    if (key === "useMutation") return () => ({ isPending: false, mutate(input: any, callbacks?: any) { mutations.push({ path, input }); callbacks?.onSuccess?.(result(path, input)); }, async mutateAsync(input: any) { mutations.push({ path, input }); return result(path, input); } });
    if (key === "query" || key === "fetch") return async (input?: any, options?: any) => { reads.push({ path, input, options }); return result(path, input); };
    if (key === "getData") return () => result(path);
    if (["setData", "invalidate", "cancel"].includes(key)) return async () => undefined;
    return procedure(path ? `${path}.${key}` : key);
  } });
  const trpc = new Proxy(Object.create(null), { get(_target, key) { return key === "useUtils" ? () => procedure("") : typeof key === "string" ? procedure(key) : undefined; } });
  return { scope, trpc, conversation, mutations, reads, set overrideRows(value: any[] | undefined) { overrideRows = value; }, set overrideConversations(value: any[] | undefined) { overrideConversations = value; }, get search() { return search; }, set search(value: string) { search = value; }, get owner() { return owner; }, set owner(value: boolean) { owner = value; }, get permission() { return permission; }, set permission(value: boolean) { permission = value; }, get messagesError() { return messagesError; }, set messagesError(value: boolean) { messagesError = value; }, reset() { mutations.length = 0; reads.length = 0; search = ""; permission = true; owner = false; messagesError = false; overrideRows = undefined; overrideConversations = undefined; scope.contextVerification.authorizationVersion = "a1"; scope.sessionCapabilities.receptionReady = true; scope.storageScope = "staff:33:enterprise:44:merchant:30061:binding:1"; } };
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
async function setInput(node: HTMLInputElement | HTMLTextAreaElement, value: string) { const proto = node instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, value); await act(async () => node.dispatchEvent(new Event("input", { bubbles: true }))); }
async function expandAllGroups() { for (const button of Array.from(host.querySelectorAll<HTMLButtonElement>('.inquiry-reception__group-trigger[aria-expanded="false"]'))) await act(async () => button.click()); }
beforeEach(() => {
  state.reset(); Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: any) => clearTimeout(id));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

describe("真实接待双栏与原conversation渲染DI", () => {
  it("队列读取全部页，默认只看我的接待，不标全读；客户型号搜索覆盖第二页", async () => {
    await render(); await render();
    expect(host.querySelectorAll(".inquiry-reception__group-trigger")).toHaveLength(2);
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(1);
    expect(state.search).toBe(""); expect(host.querySelector("textarea")).toBeNull();
    await click("按客户");
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(2);
    expect(host.textContent).toContain("真实客户企业"); expect(host.textContent).not.toContain("他人采购客户");
    expect(host.textContent).toContain("数量待确认");
    expect(state.mutations).toEqual([]);
    expect(state.reads.some(item => item.path === "enterprise.inquiryInbox" && item.input.page === 2)).toBe(true);
    await setInput(host.querySelector<HTMLInputElement>('[aria-label="搜索客户或型号"]')!, "第二页型号");
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector(".inquiry-reception__item")?.textContent).toContain("第二页型号");
    expect(host.querySelector("h1")).toBeNull(); expect(host.querySelector('[aria-label="前台导航"]')).toBeNull();
  });
  it("选择同会话中的具体另一条询价，摘要按inquiryId而不是该会话第一条", async () => {
    await render(); await render();
    await click("按客户");
    const second = host.querySelector<HTMLButtonElement>('[data-inquiry-id="101"]')!;
    await act(async () => second.click()); await render();
    expect(state.search).toContain("conversationId=11"); expect(state.search).toContain("inquiryId=101");
    expect(host.querySelector('.inquiry-reception__summary-content')).toBeNull();
    expect(host.querySelector('.inquiry-reception__summary')).toBeNull();
    await click("业务摘要");
    expect(host.querySelectorAll('.inquiry-reception__summary-content')).toHaveLength(1);
    expect(host.querySelector('dialog')?.textContent).toContain("第二页型号");
    expect(host.querySelector('[data-inquiry-id="101"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-inquiry-id="1"]')?.getAttribute("aria-pressed")).toBe("false");
    await click("关闭摘要"); expect(host.querySelector('dialog')).toBeNull();
    await click("返回队列"); await render(); expect(state.search).not.toContain("inquiryId");
  });
  it("不把不同conversation的inquiryId误用于摘要", async () => {
    state.search = "conversationId=11&inquiryId=2"; await render(); await render();
    expect(host.querySelector('.inquiry-reception__summary-content')).toBeNull();
    expect(host.querySelector('.inquiry-reception__summary-trigger')).toBeNull();
    expect(host.querySelector('[data-reception-conversation="11"]')).not.toBeNull();
  });
  it("真实查看成功消息才原markRead，同一conversation可回复并上传原附件，无报价采购/个人聊天入口", async () => {
    state.search = "conversationId=11"; await render(); await render();
    expect(host.querySelector('[data-reception-conversation="11"]')).not.toBeNull();
    expect(host.textContent).toContain("原会话买方消息");
    await click("业务摘要");
    expect(host.textContent).toContain("来源工厂标签"); expect(host.textContent).toContain("真实接待员工");
    await click("关闭摘要");
    expect(host.querySelectorAll(".inquiry-reception__queue")).toHaveLength(1);
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
  it("已授权只读范围保留消息但回复/附件不可操作", async () => {
    state.search = "conversationId=11"; await render(false); await render(false);
    expect(host.textContent).toContain("原会话买方消息"); expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(host.textContent).toContain("当前企业范围仅可查看接待");
    expect(state.mutations.some(item => item.path === "chat.sendMessage" || item.path === "chat.uploadAttachment")).toBe(false);
  });
  it("监督队列不假冒参与人、不请求他人消息、不标他人读", async () => {
    state.owner = true; state.search = "conversationId=99"; await render(); await render();
    const select = host.querySelector<HTMLSelectElement>('[aria-label="接待查看范围"]')!;
    await act(async () => { select.value = "team"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(0);
    await expandAllGroups();
    expect(host.textContent).toContain("他人采购客户"); expect(host.textContent).toContain("监督查看不会成为参与人");
    expect(host.querySelector("textarea")).toBeNull();
    expect(state.reads.some(item => item.path === "chat.getMessages" && item.input?.conversationId === 99)).toBe(false);
    expect(state.mutations).toEqual([]);
  });
  it("库存权限不能代替接待权限，消息失败不markRead，手机返回保持scope查询", async () => {
    state.permission = false; await render(); expect(host.textContent).toContain("库存权限不能代替"); expect(host.querySelector("textarea")).toBeNull();
    state.permission = true; state.messagesError = true; state.search = "conversationId=11&merchantId=30061";
    await render(); await render(); expect(host.textContent).toContain("消息加载失败"); expect(state.mutations).toEqual([]);
    await click("返回队列"); await render();
    expect(state.search).toBe("merchantId=30061"); expect(host.querySelector('[data-inquiry-reception]')?.getAttribute("data-detail")).toBe("false");
  });
});

function materialFixture() {
  const date = new Date("2026-11-13T00:00:00Z");
  const base = { inventoryId: 501, sourceKind: "inventory", partNumber: "LM358", brand: "TI", quantity: 500, requestedQty: 10, status: "open", createdAt: date, lastActivityAt: date };
  state.overrideRows = [
    { ...base, id: 1, conversationId: 11, buyerName: "采购A", buyerCompanyName: "客户企业A" },
    { ...base, id: 2, conversationId: 11, buyerName: "采购A", buyerCompanyName: "客户企业A", status: "replied" },
    { ...base, id: 3, conversationId: 12, buyerName: "采购B", buyerCompanyName: "客户企业B" },
    { ...base, id: 4, conversationId: 13, inventoryId: 502, buyerName: "采购C" },
    { ...base, id: 5, conversationId: 14, inventoryId: null, buyerName: "无来源甲" },
    { ...base, id: 6, conversationId: 14, inventoryId: null, buyerName: "无来源乙" },
  ];
  state.overrideConversations = [state.conversation, { ...state.conversation, id: 12, otherUserId: 23, otherUserName: "采购B", unreadCount: 3 },
    { ...state.conversation, id: 13, otherUserId: 24, otherUserName: "采购C", unreadCount: 0, lastMessageAt: new Date("2026-11-14T00:00:00Z") },
    { ...state.conversation, id: 14, otherUserId: 25, otherUserName: "无来源客户", unreadCount: 0 }];
}
describe("物料组实际DOM交互", () => {
  it("默认仅展开首个未读组，显示真实来源、去重统计；展开/关闭绝不读或自动选会话", async () => {
    materialFixture(); state.search = "merchantId=30061&enterpriseId=44";
    await render(); await render();
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("全部");
    const groups = host.querySelectorAll<HTMLButtonElement>(".inquiry-reception__group-trigger");
    expect(groups).toHaveLength(4); expect(groups[0].getAttribute("aria-expanded")).toBe("true");
    expect(groups[0].textContent).toContain("LM358"); expect(groups[0].textContent).toContain("TI · 普通库存 · #501");
    expect(groups[0].textContent).toContain("2 客户 / 2 会话");
    expect(groups[0].querySelector('[aria-label="5 条会话未读（已去重）"]')).not.toBeNull();
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(3);
    expect(host.querySelector("textarea")).toBeNull(); expect(state.mutations).toEqual([]);
    await act(async () => groups[0].click()); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(0);
    await act(async () => groups[1].click());
    expect(state.search).toBe("merchantId=30061&enterpriseId=44"); expect(state.mutations).toEqual([]);
    expect(state.reads.some(item => item.path === "chat.getMessages")).toBe(false);
  });
  it("按客户切换不合并原询价，搜索型号展示整组、客户仅匹配行，状态先过滤", async () => {
    materialFixture(); await render(); await render();
    await click("按客户"); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
    await click("按物料"); expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(1);
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索客户或型号"]')!;
    await setInput(input, "lm358"); await expandAllGroups();
    expect(host.querySelectorAll(".inquiry-reception__material-group")).toHaveLength(4);
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(6);
    await setInput(input, "客户企业B");
    expect(host.querySelectorAll(".inquiry-reception__material-group")).toHaveLength(1);
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="3"]')).not.toBeNull();
    await click("已回复"); expect(host.textContent).toContain("暂无符合条件");
    await setInput(input, "lm358");
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(host.querySelector('[data-inquiry-id="2"]')).not.toBeNull();
    expect(state.mutations).toEqual([]); expect(state.search).toBe("");
  });
  it("点具体原询价保留scope参数，同conversation不同inquiry摘要不混且仅按需渲染", async () => {
    materialFixture(); state.search = "merchantId=30061&enterpriseId=44";
    await render(); await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-inquiry-id="2"]')!.click()); await render();
    const params = new URLSearchParams(state.search);
    expect(params.get("conversationId")).toBe("11"); expect(params.get("inquiryId")).toBe("2");
    expect(params.get("merchantId")).toBe("30061"); expect(params.get("enterpriseId")).toBe("44");
    expect(host.querySelector('[data-inquiry-id="2"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-inquiry-id="1"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector(".inquiry-reception__summary-content")).toBeNull();
    await click("业务摘要"); expect(host.querySelectorAll(".inquiry-reception__summary-content")).toHaveLength(1);
    expect(host.querySelector("dialog")?.textContent).toContain("已回复");
    await act(async () => host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: true })));
    expect(host.querySelector("dialog")).toBeNull();
  });
  it("展开只保存在组件内：过滤/切模式保留，授权域变关闭，卸载重进按初始规则", async () => {
    materialFixture(); await render(); await render(); await expandAllGroups();
    await click("按客户"); await click("按物料");
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(4);
    state.scope.contextVerification.authorizationVersion = "a2"; await render();
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(0);
    await expandAllGroups();
    state.scope.storageScope = "staff:33:enterprise:45:merchant:40000:binding:2"; await render(); await render();
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(0);
    await act(async () => root.render(null)); await render(); await render();
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(1);
    expect(state.mutations).toEqual([]); expect(state.search).toBe("");
  });
});

describe("接待初始授权与摘要生命周期", () => {
  it("权限异步就绪且没有未读时展开首组、不选会话；授权版本变化立即撤下摘要", async () => {
    materialFixture();
    state.overrideConversations = [11, 12, 13, 14].map(id => ({ ...state.conversation, id, otherUserId: id + 100, unreadCount: 0 }));
    state.permission = false; await render();
    expect(host.querySelector(".inquiry-reception__queue")).toBeNull();
    state.permission = true; await render(); await render();
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(1);
    expect(host.querySelector("textarea")).toBeNull(); expect(state.mutations).toEqual([]);
    await click("按客户");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-inquiry-id="1"]')!.click()); await render();
    await click("业务摘要"); expect(host.querySelector("dialog")).not.toBeNull();
    state.scope.contextVerification.authorizationVersion = "a2"; await render();
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.querySelectorAll('.inquiry-reception__group-trigger[aria-expanded="true"]')).toHaveLength(0);
  });
});
