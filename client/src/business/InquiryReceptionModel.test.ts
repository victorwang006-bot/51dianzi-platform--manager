import { describe, expect, it } from "vitest";
import { filterReceptionQueue, receptionConversationId, receptionUnreadTotal, INQUIRY_RECEPTION_CONVERSATION_OPTIONS, type InquiryReceptionRow, type ReceptionConversation } from "./InquiryReceptionModel";
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
