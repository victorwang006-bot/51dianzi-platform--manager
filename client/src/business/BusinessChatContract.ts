import type { ErpPermissionKey } from "../../../shared/erpPermissions";

/**
 * UI/BFF hand-off contract for the enterprise reception page. The BFF remains
 * the only authority; this file merely prevents the workbench route from
 * treating a ready staff principal as an owner or a personal consumer session.
 */
export const BUSINESS_CHAT_REQUIRED_PERMISSION = "inquiry.receive" satisfies ErpPermissionKey;

export const BUSINESS_CHAT_RECEPTION_METHODS = [
  "cart.count",
  "chat.listConversations", "chat.getMessages", "chat.getAttachmentUrl", "chat.getTotalUnread",
  "chat.uploadAttachment", "chat.sendMessage", "chat.recallMessage", "chat.deleteMessageForMe",
  "chat.markRead", "chat.pinConversation", "chat.setRemarkName", "chat.deleteConversation",
  "chat.listGroups", "chat.listTrashedGroups", "chat.createGroup", "chat.setGroupMembership",
  "chat.dissolveGroup", "chat.renameGroup", "chat.mergeGroups", "chat.trashGroup", "chat.restoreGroup",
  "chat.contactProfile", "chat.contactInventory", "chat.blockContact", "chat.unblockContact", "chat.reportContact",
  "publicReview.state", "publicReview.create",
] as const;

/** The reception header may show only the real bound staff user's own cart count. */
export const BUSINESS_CHAT_CART_PROJECTION = {
  method: "cart.count",
  actor: "bound-real-staff",
  forbiddenActors: ["enterprise-owner", "crm-data-owner", "admin-account"] as const,
} as const;

/** Paths intentionally not projected into an enterprise reception session. */
export const BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES: Readonly<Record<string, string>> = {
  "chat.getServiceUser": "官方客服会话属于员工个人支持渠道，请在前台个人会话中处理。",
  "chat.getOrCreateConversation": "企业接待只能处理已分配询价会话，不能在后台发起私人会话。",
  "chat.startInventoryInquiry": "询价由买方发起；企业接待不能代替买方创建询价。",
  "enterprise.myInvitations": "企业成员邀请属于员工个人成员关系，请在前台个人会话中处理。",
  "enterprise.acceptInvitation": "企业成员邀请属于员工个人成员关系，请在前台个人会话中处理。",
  "enterprise.rejectInvitation": "企业成员邀请属于员工个人成员关系，请在前台个人会话中处理。",
  "forum.unreadState": "论坛未读属于员工个人论坛状态，未投影到企业接待工作台。",
};

export function isBusinessChatReceptionMethod(value: string) {
  return (BUSINESS_CHAT_RECEPTION_METHODS as readonly string[]).includes(value);
}
