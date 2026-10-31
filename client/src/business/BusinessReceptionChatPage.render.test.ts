import { createRequire } from "node:module";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  type QueryCall = { path: string; enabled: boolean | undefined };
  type MutationCall = { path: string; input: unknown };
  const queryCalls: QueryCall[] = [];
  const mutationCalls: MutationCall[] = [];
  const forumEnabled: boolean[] = [];
  let search = "";

  const conversation = {
    id: 8422001,
    otherUserId: 8420104,
    otherUserName: "询价买方",
    otherUserOriginalName: "询价买方",
    otherCompanyProfileSupplierId: null,
    otherUserAvatar: null,
    isService: false,
    remarkName: null,
    lastMessageAt: new Date("2026-10-29T12:00:00.000Z"),
    lastMessagePreview: "可接待询价",
    currentRound: 1,
    endedAt: null,
    endedByUserId: null,
    pinned: false,
    groupName: "已证明接待组",
    groupIds: [8424001],
    unreadCount: 1,
  };

  const resultFor = (path: string): unknown => {
    if (path === "chat.listConversations") return [conversation];
    if (path === "chat.listGroups") {
      return [{ id: 8424001, groupName: "已证明接待组", groupType: "manual", autoAssign: false, memberCount: 1, unreadCount: 1, partNumbers: [] }];
    }
    if (path === "chat.listTrashedGroups") return [];
    if (path === "chat.getMessages") {
      return {
        messages: [
          {
            id: 8423001,
            conversationId: 8422001,
            senderId: 8420104,
            clientMessageId: "chat-ui-evidence-message",
            msgType: "erp_invite",
            content: JSON.stringify({ invitationId: 8425001, enterpriseName: "接待企业", inviterName: "企业管理员", permissions: [{ key: "inquiry.receive" }] }),
            replyToMessageId: null,
            replyTo: null,
            recalledAt: null,
            recalledByUserId: null,
            createdAt: new Date("2026-10-29T12:00:00.000Z"),
          },
        ],
        nextCursor: null,
        peerLastReadMessageId: 0,
      };
    }
    if (path === "publicReview.state") return { status: "not_eligible" };
    if (path === "enterprise.me") return { isOwner: false, permissionKeys: ["inquiry.receive"] };
    if (path === "cart.count") return 0;
    if (path === "chat.getTotalUnread") return { total: 1 };
    if (path === "chat.sendMessage") {
      return {
        ok: true,
        message: {
          id: 8423999,
          conversationId: 8422001,
          senderId: 8420103,
          clientMessageId: "chat-ui-evidence-send",
          msgType: "text",
          content: "接待回复",
          createdAt: new Date("2026-10-29T12:01:00.000Z"),
        },
      };
    }
    return undefined;
  };

  const createProcedure = (path: string): object => new Proxy(Object.create(null), {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property === "useQuery") {
        return (_input?: unknown, options?: { enabled?: boolean }) => {
          queryCalls.push({ path, enabled: options?.enabled });
          return {
            data: resultFor(path),
            isLoading: false,
            isError: false,
            isPending: false,
            refetch: async () => resultFor(path),
          };
        };
      }
      if (property === "useMutation") {
        return () => ({
          isPending: false,
          mutate(input: unknown, callbacks?: { onSuccess?: (value: unknown) => void }) {
            mutationCalls.push({ path, input });
            callbacks?.onSuccess?.(resultFor(path));
          },
          async mutateAsync(input: unknown) {
            mutationCalls.push({ path, input });
            return resultFor(path);
          },
        });
      }
      if (property === "fetch") return async () => resultFor(path);
      if (property === "invalidate" || property === "cancel" || property === "setData") return async () => undefined;
      if (property === "getData") return () => resultFor(path);
      return createProcedure(path ? `${path}.${property}` : property);
    },
  });

  const trpc = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "useUtils") return () => createProcedure("");
      return typeof property === "string" ? createProcedure(property) : undefined;
    },
  });

  return {
    trpc,
    queryCalls,
    mutationCalls,
    forumEnabled,
    get search() { return search; },
    set search(value: string) { search = value; },
    reset() {
      queryCalls.splice(0);
      mutationCalls.splice(0);
      forumEnabled.splice(0);
      search = "";
    },
  };
});

vi.mock("./api/business-trpc", () => ({ trpc: testState.trpc }));
vi.mock("./api/business-auth", () => ({
  useAuth: () => ({
    user: { id: 8420103, name: "接待真实员工", crmAccess: true },
    loading: false,
    logout: async () => undefined,
  }),
}));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: unknown }) => children ?? null,
  useLocation: () => ["/chat", () => undefined],
  useSearch: () => testState.search,
}));
vi.mock("./platform/client/src/components/ForumUnreadBadge", () => ({
  default: () => null,
  useForumUnreadTotal: (enabled: boolean) => {
    testState.forumEnabled.push(enabled);
    return { total: 0 };
  },
}));
vi.mock("./platform/client/src/components/MallLoginDialog", () => ({
  default: () => null,
}));

const requireFront = createRequire(new URL("../../../../front/package.json", import.meta.url));
const { JSDOM } = requireFront("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis; };
};

const receptionConfig = {
  requiredPermission: "inquiry.receive" as const,
  personalFlowMessages: {
    "chat.getServiceUser": "客服属于员工个人流程，企业接待不会请求该接口。",
    "chat.getOrCreateConversation": "私聊属于员工个人流程，企业接待不会请求该接口。",
    "chat.startInventoryInquiry": "买方询价属于前台个人流程，企业接待不会请求该接口。",
    "enterprise.myInvitations": "成员邀请属于员工个人流程，企业接待不会请求该接口。",
    "forum.unreadState": "论坛未读属于员工个人流程，企业接待不会请求该接口。",
  },
};

type MountedPage = {
  container: HTMLElement;
  render(search: string, businessReception?: typeof receptionConfig | null): Promise<void>;
  unmount(): Promise<void>;
};

async function mountPage(): Promise<MountedPage> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://127.0.0.1:3000/chat" });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }, pageModule] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./platform/client/src/pages/ChatPage"),
  ]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("CHAT_PAGE_RENDER_ROOT_MISSING");
  const root = createRoot(container);
  return {
    container,
    async render(search, businessReception = receptionConfig) {
      testState.search = search;
      await act(async () => {
        root.render(createElement(pageModule.default, {
          ...(businessReception ? { businessReception } : {}),
          key: search,
        }));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

describe("Business reception ChatPage rendered behavior", () => {
  let mounted: MountedPage | undefined;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    testState.reset();
  });

  it("renders and operates ordinary reception controls while personal service/private/buyer/forum/invitation flows do not request BFF procedures", async () => {
    mounted = await mountPage();
    await mounted.render("?service=1", receptionConfig);

    expect(mounted.container.textContent).toContain("企业接待范围：");
    expect(mounted.container.textContent).toContain("客服属于员工个人流程，企业接待不会请求该接口。");
    expect(mounted.container.textContent).toContain("全部会话");
    expect(mounted.container.textContent).toContain("新建分组");
    expect(testState.queryCalls.some(call => call.path === "chat.getServiceUser" && call.enabled === false)).toBe(true);
    expect(testState.forumEnabled.every(enabled => enabled === false)).toBe(true);

    const conversation = mounted.container.querySelector<HTMLElement>("[draggable=\"true\"]");
    expect(conversation).not.toBeNull();
    await act(async () => {
      conversation?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(mounted.container.textContent).toContain("企业ERP成员邀请");
    expect(mounted.container.textContent).toContain("成员邀请属于员工个人流程，企业接待不会请求该接口。");
    expect(testState.queryCalls.some(call => call.path === "enterprise.myInvitations" && call.enabled === false)).toBe(true);

    const editor = mounted.container.querySelector("textarea");
    expect(editor).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    valueSetter?.call(editor, "接待回复");
    await act(async () => {
      editor?.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const send = Array.from(mounted.container.querySelectorAll("button")).find(button =>
      button.textContent?.replace(/\s/g, "") === "发送",
    );
    expect(send).toBeDefined();
    await act(async () => {
      send?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(testState.mutationCalls.some(call => call.path === "chat.sendMessage")).toBe(true);

    await mounted.render("?userId=8420104", receptionConfig);
    expect(mounted.container.textContent).toContain("私聊属于员工个人流程，企业接待不会请求该接口。");
    await mounted.render("?inventoryId=8429001&inquiryPart=LM358&inquiryBrand=TI&inquiryId=buyer-8429001", receptionConfig);
    expect(mounted.container.textContent).toContain("买方询价属于前台个人流程，企业接待不会请求该接口。");
    expect(testState.mutationCalls.some(call => ["chat.getOrCreateConversation", "chat.startInventoryInquiry", "enterprise.acceptInvitation", "enterprise.rejectInvitation"].includes(call.path))).toBe(false);
  });

  it("keeps the ordinary front ChatPage personal service flow available when businessReception is absent", async () => {
    mounted = await mountPage();
    await mounted.render("?service=1", null);
    expect(testState.queryCalls.some(call => call.path === "chat.getServiceUser" && call.enabled === true)).toBe(true);
    expect(testState.forumEnabled.every(enabled => enabled === true)).toBe(true);
  });
});
