import type { ErpPermissionKey } from "./erpPermissions";

/**
 * The backend workbench is a reception surface, not the staff member's whole
 * consumer chat account.  This allow-list intentionally contains only actions
 * whose resource can be tied to an assigned inventory inquiry.
 */
export const BUSINESS_CHAT_METHOD_IDS = [
  "chat.listConversations",
  "chat.getMessages",
  "chat.getAttachmentUrl",
  "chat.getTotalUnread",
  "chat.uploadAttachment",
  "chat.sendMessage",
  "chat.recallMessage",
  "chat.deleteMessageForMe",
  "chat.markRead",
  "chat.pinConversation",
  "chat.setRemarkName",
  "chat.deleteConversation",
  "chat.listGroups",
  "chat.listTrashedGroups",
  "chat.createGroup",
  "chat.setGroupMembership",
  "chat.dissolveGroup",
  "chat.renameGroup",
  "chat.mergeGroups",
  "chat.trashGroup",
  "chat.restoreGroup",
  "chat.contactProfile",
  "chat.contactInventory",
  "chat.blockContact",
  "chat.unblockContact",
  "chat.reportContact",
] as const;

export type BusinessChatMethodId = (typeof BUSINESS_CHAT_METHOD_IDS)[number];

export type BusinessChatResourceKind =
  | "conversation"
  | "message"
  | "attachment"
  | "group"
  | "list";

export type BusinessChatMethodPolicy = Readonly<{
  resource: BusinessChatResourceKind;
  mode: "read" | "write";
  /** This is the authoritative ERP grant; owner status is not a substitute. */
  permission: ErpPermissionKey;
}>;

const receiveRead: BusinessChatMethodPolicy = {
  resource: "list",
  mode: "read",
  permission: "inquiry.receive",
};
const receiveWrite = (resource: Exclude<BusinessChatResourceKind, "list">): BusinessChatMethodPolicy => ({
  resource,
  mode: "write",
  permission: "inquiry.receive",
});

/**
 * Source-controlled contract used by the internal BFF dispatcher.  Do not add
 * `getOrCreateConversation`, `startInventoryInquiry`, service chat, cart,
 * invitations or public-review methods here: those are personal/buyer flows
 * rather than an enterprise's assigned reception conversation.
 */
export const BUSINESS_CHAT_METHOD_POLICIES: Readonly<Record<BusinessChatMethodId, BusinessChatMethodPolicy>> = {
  "chat.listConversations": receiveRead,
  "chat.getTotalUnread": receiveRead,
  "chat.listGroups": receiveRead,
  "chat.listTrashedGroups": receiveRead,
  "chat.getMessages": { ...receiveRead, resource: "conversation" },
  "chat.getAttachmentUrl": { ...receiveRead, resource: "attachment" },
  "chat.uploadAttachment": receiveWrite("conversation"),
  "chat.sendMessage": receiveWrite("conversation"),
  "chat.recallMessage": receiveWrite("message"),
  "chat.deleteMessageForMe": receiveWrite("message"),
  "chat.markRead": receiveWrite("conversation"),
  "chat.pinConversation": receiveWrite("conversation"),
  "chat.setRemarkName": receiveWrite("conversation"),
  "chat.deleteConversation": receiveWrite("conversation"),
  "chat.createGroup": receiveWrite("group"),
  "chat.setGroupMembership": receiveWrite("group"),
  "chat.dissolveGroup": receiveWrite("group"),
  "chat.renameGroup": receiveWrite("group"),
  "chat.mergeGroups": receiveWrite("group"),
  "chat.trashGroup": receiveWrite("group"),
  "chat.restoreGroup": receiveWrite("group"),
  "chat.contactProfile": { ...receiveRead, resource: "conversation" },
  "chat.contactInventory": { ...receiveRead, resource: "conversation" },
  "chat.blockContact": receiveWrite("conversation"),
  "chat.unblockContact": receiveWrite("conversation"),
  "chat.reportContact": receiveWrite("conversation"),
};

export function isBusinessChatMethodId(value: string): value is BusinessChatMethodId {
  return (BUSINESS_CHAT_METHOD_IDS as readonly string[]).includes(value);
}
