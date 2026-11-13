// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessScopeProvider, type ReadyBusinessStaffPrincipal } from "../../../../../BusinessScope";
import ChatPage from "../../pages/ChatPage";

const fixture = vi.hoisted(() => {
  const makeConversation = (id: number) => ({ id, otherUserId: id + 100, otherUserName: `客户${id}`,
    otherUserOriginalName: `客户${id}`, otherCompanyProfileSupplierId: null, otherUserAvatar: null,
    isService: false, remarkName: null, lastMessageAt: new Date("2026-11-13T08:00:00Z"),
    lastMessagePreview: "询价", pinned: false, groupName: null, groupIds: [], unreadCount: 1,
    currentRound: 1, endedAt: null, endedByUserId: null });
  const makeMessages = (id: number) => ({ messages: [{ id: id * 10, conversationId: id, senderId: id + 100,
    msgType: "text", content: `客户${id}询价原文`, createdAt: new Date("2026-11-13T08:00:00Z") }], peerLastReadMessageId: 0 });
  const state = {
    conversations: [makeConversation(11), makeConversation(22)],
    enterprise: { isOwner: false, permissionKeys: ["inquiry.receive"] },
    messages: { 11: makeMessages(11), 22: makeMessages(22) } as Record<number, ReturnType<typeof makeMessages>>,
    listError: false, messageError: "", mode: "success" as "success" | "failure" | "hold",
    calls: [] as Array<{ path: string; input: any }>,
    held: [] as Array<{ onSuccess?: (result: any) => void; onError?: (error: any) => void }>,
  };
  const results = (path: string, input?: any): any => {
    if (path === "enterprise.me") return state.enterprise;
    if (path === "chat.listConversations") return state.conversations;
    if (path === "chat.getMessages") return state.messageError ? undefined : state.messages[input?.conversationId ?? 11];
    if (path === "chat.listGroups" || path === "chat.listTrashedGroups") return [];
    if (path === "publicReview.state") return { status: "not_eligible" };
    if (path === "cart.count") return 0;
    if (path === "chat.getTotalUnread") return { total: 2 };
    return undefined;
  };
  const procedure = (path: string): any => new Proxy({}, {
    get(_target, property) {
      if (property === "useQuery") return (input?: any) => ({ data: results(path, input), isLoading: false, isPending: false,
        isSuccess: true, isError: path === "chat.listConversations" && state.listError || path === "chat.getMessages" && !!state.messageError,
        error: state.messageError ? { data: { code: state.messageError } } : null });
      if (property === "useMutation") return () => ({ isPending: false, mutate(input: any, callbacks?: any) {
        state.calls.push({ path, input });
        if (path === "chat.sendMessage" && state.mode === "hold") { state.held.push(callbacks); return; }
        if (path === "chat.sendMessage" && state.mode === "failure") { callbacks?.onError?.(new Error("network error")); return; }
        callbacks?.onSuccess?.(path === "chat.sendMessage" ? { message: { ...input, id: 900, senderId: 7, createdAt: new Date() } } : results(path, input));
      }, mutateAsync: async (input: any) => { state.calls.push({ path, input }); return results(path, input); } });
      if (property === "fetch") return async (input: any) => results(path, input);
      if (property === "getData") return (input: any) => results(path, input);
      if (["cancel", "setData", "invalidate"].includes(String(property))) return async () => undefined;
      return procedure(path ? `${path}.${String(property)}` : String(property));
    },
  });
  const trpc = new Proxy({}, { get(_target, property) { return property === "useUtils" ? () => procedure("") : procedure(String(property)); } });
  return { state, trpc, reset() {
    state.conversations = [makeConversation(11), makeConversation(22)]; state.enterprise = { isOwner: false, permissionKeys: ["inquiry.receive"] };
    state.messages = { 11: makeMessages(11), 22: makeMessages(22) }; state.listError = false; state.messageError = "";
    state.mode = "success"; state.calls.length = 0; state.held.length = 0;
  } };
});
vi.mock("../../../../../api/business-trpc", () => ({ trpc: fixture.trpc }));
vi.mock("wouter", () => ({ Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  useSearch: () => "", useLocation: () => ["/inquiry-reception", () => undefined] }));
vi.mock("../ForumUnreadBadge", () => ({ default: () => null, useForumUnreadTotal: () => ({ total: 0 }) }));
vi.mock("../MallLoginDialog", () => ({ default: () => null }));

(globalThis as any).React = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const config = { requiredPermission: "inquiry.receive" as const, personalFlowMessages: {} };
type Domain = { user?: number; admin?: number; enterprise?: number; merchant?: number; binding?: number; authorization?: string; ready?: boolean; verification?: "verified" | "revalidating" };
const render = async (conversationId = 11, canReply = true, domain: Domain = {}) => {
  const user = domain.user ?? 7;
  const principal = { status: "ready", frontendUserId: user, adminAccountId: domain.admin ?? 8,
    enterpriseId: domain.enterprise ?? 9, bindingVersion: domain.binding ?? 1,
    user: { id: user, name: "真实员工", crmAccess: true } } as ReadyBusinessStaffPrincipal;
  await act(async () => root.render(createElement(BusinessScopeProvider, {
    merchantId: domain.merchant ?? 30061, staffPrincipal: principal, contextVerificationState: domain.verification ?? "verified",
    authorizationVersion: domain.authorization ?? "verified-grants-v1", sessionCapabilities: { receptionReady: domain.ready ?? true },
    children: createElement(ChatPage, { businessReception: config, receptionConversation: { conversationId, canReply, onBack: () => undefined } }),
  })));
};
const editor = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
  .find(item => item.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""))!;
const click = (target: HTMLElement) => act(() => target.click());
const type = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor(), value);
  editor().dispatchEvent(new Event("input", { bubbles: true }));
});
const sends = () => fixture.state.calls.filter(call => call.path === "chat.sendMessage");
beforeEach(() => {
  fixture.reset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("embedded reception ChatPage draft behavior with the real BusinessScope provider", () => {
  it("switches customers without remounting, restores separate drafts and only fills after phrase selection", async () => {
    await render(); type("客户甲草稿"); await render(22); expect(editor().value).toBe("");
    type("客户乙草稿"); await render(); expect(editor().value).toBe("客户甲草稿");
    click(button("常用语")); expect(sends()).toHaveLength(0);
    click(button("交期多久？")); expect(editor().value).toBe("客户甲草稿\n交期多久？"); expect(sends()).toHaveLength(0);
    await render(22); expect(editor().value).toBe("客户乙草稿");
  });

  it.each([{ user: 17 }, { admin: 18 }, { enterprise: 19 }, { merchant: 30062 }, { binding: 2 }, { authorization: "changed-grants-v2" }])("clears old drafts on a real account/enterprise/business/authorization change: %j", async domain => {
    await render(); type("敏感旧域草稿"); await render(11, true, domain); expect(editor().value).toBe("");
    await render(); expect(editor().value).toBe("");
  });

  it("retains drafts during a same-proof background recheck but clears them after permission withdrawal", async () => {
    await render(); type("重验证不丢草稿"); await render(11, true, { verification: "revalidating" });
    expect(editor().value).toBe("重验证不丢草稿");
    fixture.state.enterprise = { isOwner: false, permissionKeys: [] }; await render();
    expect(editor().value).toBe(""); expect(button("常用语").disabled).toBe(true);
    fixture.state.enterprise = { isOwner: false, permissionKeys: ["inquiry.receive"] }; await render(); expect(editor().value).toBe("");
    type("再次授权草稿"); await render(11, true, { ready: false }); expect(editor().value).toBe("");
    await render(); expect(editor().value).toBe("");
  });

  it("canReply=false immediately clears the composer, disables phrases/text/send and cannot send synthetic Enter", async () => {
    await render(); type("撤销写权限草稿"); click(button("常用语")); await render(11, false);
    expect(editor().value).toBe(""); expect(editor().disabled).toBe(true); expect(button("常用语").disabled).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull(); click(button("发送"));
    act(() => editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(sends()).toHaveLength(0); await render(); expect(editor().value).toBe("");
  });

  it("a removed conversation cannot reveal an old draft and restoring access does not restore withdrawn text", async () => {
    await render(); type("甲草稿"); await render(22); type("乙草稿");
    fixture.state.conversations = fixture.state.conversations.filter(item => item.id !== 11);
    await render(); expect(host.querySelector("textarea")).toBeNull();
    await render(22); expect(editor().value).toBe("乙草稿");
    fixture.reset(); await render(); expect(editor().value).toBe("");
  });

  it("clears only the submitted customer's draft; a later success never clears a different customer's input", async () => {
    await render(); type("甲待发送"); await render(22); type("乙未发送"); await render();
    fixture.state.mode = "hold"; click(button("发送")); expect(editor().value).toBe(""); expect(sends()).toHaveLength(1);
    await render(22); expect(editor().value).toBe("乙未发送");
    act(() => fixture.state.held[0].onSuccess?.({ message: { ...sends()[0].input, id: 900, senderId: 7, createdAt: new Date() } }));
    expect(editor().value).toBe("乙未发送"); await render(); expect(editor().value).toBe("");
  });

  it("keeps replyingTo when appending a phrase and retries failed sending with the original content/reference/idempotency key", async () => {
    await render();
    click(host.querySelector<HTMLElement>('[data-testid="chat-message-action-trigger"]')!); click(button("引用"));
    expect(host.querySelector('[data-testid="chat-reply-composer"]')).not.toBeNull();
    type("原始回复"); click(button("常用语")); click(button("年份是什么？"));
    expect(host.querySelector('[data-testid="chat-reply-composer"]')).not.toBeNull();
    fixture.state.mode = "failure"; click(button("发送"));
    expect(editor().value).toBe(""); expect(sends()[0].input.content).toBe("原始回复\n年份是什么？");
    expect(sends()[0].input.replyToMessageId).toBe(110);
    const retry = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.includes("发送失败，点击重试"))!;
    fixture.state.mode = "success"; click(retry); expect(sends()).toHaveLength(2); expect(sends()[1].input).toEqual(sends()[0].input);
  });

  it("accepts an inquiry-only conversation, while an unauthorized messages result clears old drafts", async () => {
    fixture.state.messages[11].messages[0] = { ...fixture.state.messages[11].messages[0], msgType: "inquiry",
      content: JSON.stringify({ partNumber: "LM358", brand: "TI", qty: 10, unit: "pcs" }) };
    await render(); click(button("常用语")); click(button("你好，这个料询价")); expect(editor().value).toBe("你好，这个料询价");
    expect(sends()).toHaveLength(0); fixture.state.messageError = "FORBIDDEN"; await render();
    expect(editor().value).toBe(""); expect(button("常用语").disabled).toBe(true);
    fixture.state.messageError = ""; await render(); expect(editor().value).toBe("");
  });
});
