import { describe, expect, it } from "vitest";
import { filterReceptionQueue, groupReceptionQueue, receptionMaterialKey, sortReceptionQueue, receptionConversationId, receptionUnreadTotal, INQUIRY_RECEPTION_CONVERSATION_OPTIONS, type InquiryReceptionRow, type ReceptionConversation } from "./InquiryReceptionModel";
const rows = [
  { id: 1, conversationId: 11, buyerName: "采购A", buyerCompanyName: "客户企业", partNumber: "LM358", brand: "TI", quantity: null, status: "open" },
  { id: 2, conversationId: 12, buyerName: "采购B", partNumber: "NE555", brand: "TI", quantity: 200, status: "replied" },
  { id: 3, conversationId: 13, buyerName: "采购C", partNumber: "TPS5430", quantity: 300, status: "closed" },
] as unknown as InquiryReceptionRow[];
const conversations = [{ id: 11, unreadCount: 2, otherUserName: "采购A" }, { id: 12, unreadCount: 0, otherUserName: "采购B" }] as ReceptionConversation[];
describe("询价接待统一数据模型", () => {
  it("只汇总受权接待会话未读，不读取个人/管理消息总数", () => {
    expect(receptionUnreadTotal(conversations)).toBe(2);
    expect(receptionUnreadTotal([{ id: 4, unreadCount: -4 }, { id: 5, unreadCount: NaN }])).toBe(0);
    expect(INQUIRY_RECEPTION_CONVERSATION_OPTIONS).toMatchObject({ refetchOnMount: "always", refetchOnReconnect: "always", refetchInterval: 15000, refetchIntervalInBackground: false });
  });
  it("客户/企业/型号大小写搜索和状态/未读交集不增补参与权限", () => {
    expect(filterReceptionQueue(rows, conversations, "all", "lm358").map(row => row.id)).toEqual([1]);
    expect(filterReceptionQueue(rows, conversations, "all", "客户企业").map(row => row.id)).toEqual([1]);
    expect(filterReceptionQueue(rows, conversations, "unread", "TI").map(row => row.id)).toEqual([1]);
    expect(filterReceptionQueue(rows, conversations, "replied", "").map(row => row.id)).toEqual([2]);
    expect(filterReceptionQueue(rows, conversations, "closed", "").map(row => row.id)).toEqual([3]);
    expect(filterReceptionQueue(rows, conversations, "unread", "TPS")).toEqual([]);
  });
  it.each(["conversationId=11", "?conversationId=11&merchantId=30061"])("保留真实深链接%s", value => expect(receptionConversationId(value)).toBe(11));
  it.each(["conversationId=0", "conversationId=-1", "conversationId=11&conversationId=12", "conversationId=x", "userId=11", "conversationId=1.5"])("拒绝不合法或私聊深链接%s", value => expect(receptionConversationId(value)).toBeNull());
});

const inquiry = (id: number, extra: Record<string, unknown> = {}) => ({
  id, conversationId: id + 10, inventoryId: 51, sourceKind: "inventory", partNumber: "LM358", brand: "TI",
  buyerName: `采购${id}`, status: "open", createdAt: "2026-11-01T00:00:00Z", lastActivityAt: "2026-11-01T00:00:00Z", ...extra,
}) as unknown as InquiryReceptionRow;
const conversation = (id: number, extra: Record<string, unknown> = {}) => ({ id, otherUserId: id + 100, unreadCount: 0, lastMessageAt: "2026-11-02T00:00:00Z", lastMessagePreview: `消息${id}`, ...extra }) as unknown as ReceptionConversation;
describe("真实来源物料组", () => {
  it("只按可信库存ID和型号品牌合组，不变更原inquiry/conversation", () => {
    const input = [inquiry(1), inquiry(2), inquiry(3, { inventoryId: 52 }), inquiry(4, { brand: "ST" }), inquiry(5, { partNumber: "NE555" })];
    const groups = groupReceptionQueue(input, [], "all", "");
    expect(groups).toHaveLength(4);
    expect(groups.find(group => group.rows.length === 2)?.rows.map(row => [row.id, row.conversationId])).toEqual([[2, 12], [1, 11]]);
    expect(input[0]).toEqual(inquiry(1));
  });
  it("同一publicId的工厂渠道与官方库存及普通库存不混组，工厂内部sentinel不被当作身份", () => {
    const input = [inquiry(1, { sourceKind: "channel_material", sourcePublicId: "mat-a" }), inquiry(2, { sourceKind: "channel_material", sourcePublicId: "mat-a" }),
      inquiry(3, { sourceKind: "official_admin_inventory", sourcePublicId: "mat-a" }), inquiry(4, { sourceKind: "channel_material", sourcePublicId: "mat-b" }), inquiry(5)];
    expect(groupReceptionQueue(input, [], "all", "")).toHaveLength(4);
    expect(receptionMaterialKey(input[0])).toBe(receptionMaterialKey(input[1]));
    expect(groupReceptionQueue([inquiry(6, { sourceKind: "channel_material", sourcePublicId: null }), inquiry(7, { sourceKind: "channel_material", sourcePublicId: " " })], [], "all", "")).toHaveLength(2);
  });
  it("缺失或非法身份及未知sourceKind不按同型号/同名合并，兼容有真实inventoryId的旧投影", () => {
    for (const inventoryId of [null, 0, -1, 1.5, "51", Number.MAX_SAFE_INTEGER + 1]) {
      expect(groupReceptionQueue([inquiry(1, { inventoryId }), inquiry(2, { inventoryId })], [], "all", "")).toHaveLength(2);
    }
    expect(groupReceptionQueue([inquiry(1, { sourceKind: "unknown", sourceLabel: "同厂" }), inquiry(2, { sourceKind: "unknown", sourceLabel: "同厂" })], [], "all", "")).toHaveLength(2);
    expect(groupReceptionQueue([inquiry(1, { sourceKind: undefined }), inquiry(2, { sourceKind: undefined })], [], "all", "")).toHaveLength(1);
  });
  it("同组同conversation未读只算一次，真实用户ID去重客户但不合并两条询价", () => {
    const groups = groupReceptionQueue([inquiry(1), inquiry(2, { conversationId: 11 }), inquiry(3)],
      [conversation(11, { unreadCount: 4, otherUserId: 101 }), conversation(13, { unreadCount: 2, otherUserId: 101 })], "all", "");
    expect(groups[0]).toMatchObject({ unreadCount: 6, customerCount: 1, conversationCount: 2 });
    expect(groups[0].rows).toHaveLength(3);
  });
  it("先状态/未读过滤，型号命中保留整组、客户/企业命中仅保留其原会话", () => {
    const input = [inquiry(1, { buyerCompanyName: "客户企业A" }), inquiry(2, { status: "replied" }), inquiry(3, { conversationId: 11 })];
    const chats = [conversation(11, { unreadCount: 3 }), conversation(12)];
    expect(groupReceptionQueue(input, chats, "all", "lm358")[0].rows).toHaveLength(3);
    expect(groupReceptionQueue(input, chats, "replied", "lm358")[0].rows.map(row => row.id)).toEqual([2]);
    expect(groupReceptionQueue(input, chats, "all", "客户企业A")[0].rows.map(row => row.id)).toEqual([1]);
    expect(groupReceptionQueue(input, chats, "unread", "lm358")[0].rows.map(row => row.id)).toEqual([3, 1]);
    expect(groupReceptionQueue(input, chats, "replied", "客户企业A")).toEqual([]);
  });
  it("未读组优先再按真实最近消息，不按未读条数优先，组内同样排序", () => {
    const input = [inquiry(1), inquiry(2), inquiry(3, { inventoryId: 52 }), inquiry(4, { inventoryId: 53 })];
    const chats = [conversation(11, { unreadCount: 99, lastMessageAt: "2026-11-03T00:00:00Z" }), conversation(12, { lastMessageAt: "2026-11-05T00:00:00Z", lastMessagePreview: "组内最新" }),
      conversation(13, { unreadCount: 1, lastMessageAt: "2026-11-06T00:00:00Z" }), conversation(14, { lastMessageAt: "2026-11-10T00:00:00Z" })];
    const groups = groupReceptionQueue(input, chats, "all", "");
    expect(groups.map(group => group.rows[0].inventoryId)).toEqual([52, 51, 53]);
    expect(groups[1].lastMessagePreview).toBe("组内最新");
    expect(groups[1].rows.map(row => row.id)).toEqual([1, 2]);
    expect(sortReceptionQueue(input, chats).map(row => row.id)).toEqual([3, 1, 4, 2]);
  });
  it("监督记录不虚构未读，最近活动和来源快照有安全降级", () => {
    const group = groupReceptionQueue([inquiry(1, { sourceKind: "channel_material", sourcePublicId: "factory-a", sourceFactoryName: "真实工厂" })], [], "all", "")[0];
    expect(group.unreadCount).toBe(0); expect(group.conversationCount).toBe(1);
    expect(group.sourceSummary).toContain("真实工厂"); expect(group.sourceSummary).toContain("factory-a");
    expect(group.lastMessagePreview).toContain("非本人参与会话");
  });
});
