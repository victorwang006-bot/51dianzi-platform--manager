import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./platform/front-router-types/server/routers";

export const INQUIRY_RECEPTION_REFRESH_MS = 15_000;
export const INQUIRY_RECEPTION_CONVERSATION_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
  refetchOnReconnect: "always" as const,
  refetchInterval: INQUIRY_RECEPTION_REFRESH_MS,
  refetchIntervalInBackground: false,
  retry: false,
};
export type ReceptionConversation = inferRouterOutputs<AppRouter>["chat"]["listConversations"][number];
export type InquiryReceptionRow = inferRouterOutputs<AppRouter>["enterprise"]["inquiryInbox"]["rows"][number] & {
  /** Optional server-owned source/assignment snapshots. Never infer from a name or numeric ID. */
  sourceFactoryName?: string | null;
  sourceLabel?: string | null;
  assigneeName?: string | null;
  buyerCompanyName?: string | null;
  /** Buyer-requested quantity; legacy quantity may mean seller stock. */
  requestedQty?: number | null;
};
export type InquiryReceptionFilter = "all" | "unread" | "open" | "replied" | "closed";
export const INQUIRY_RECEPTION_FILTER_LABELS: Record<InquiryReceptionFilter, string> = {
  all: "全部", unread: "未读", open: "待回复", replied: "已回复", closed: "已关闭",
};
export function receptionUnreadTotal(conversations: readonly Pick<ReceptionConversation, "id" | "unreadCount">[]) {
  // BFF listConversations is an inquiry-only, assignee + participant projection.
  // Never substitute the root admin inbox or a personal/global chat total.
  return conversations.reduce((total, item) => total + Math.max(0, Number(item.unreadCount) || 0), 0);
}
export function filterReceptionQueue(
  rows: readonly InquiryReceptionRow[],
  conversations: readonly ReceptionConversation[],
  filter: InquiryReceptionFilter,
  search: string,
) {
  const byId = new Map(conversations.map(item => [item.id, item]));
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter(row => {
    const conversation = byId.get(row.conversationId);
    if (filter === "unread" && !(Number(conversation?.unreadCount) > 0)) return false;
    if (filter !== "all" && filter !== "unread" && row.status !== filter) return false;
    return !needle || [row.buyerName, row.buyerCompanyName, row.partNumber, row.brand,
      conversation?.otherUserName, conversation?.otherUserOriginalName]
      .some(value => String(value ?? "").toLocaleLowerCase().includes(needle));
  });
}
export function receptionConversationId(search: string): number | null {
  const values = new URLSearchParams(search).getAll("conversationId");
  const id = values.length === 1 ? Number(values[0]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function receptionInquiryId(search: string): number | null {
  const values = new URLSearchParams(search).getAll("inquiryId");
  const id = values.length === 1 ? Number(values[0]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function receptionRequestedQuantity(row: InquiryReceptionRow): number | null {
  const value = Number(row.requestedQty);
  return Number.isFinite(value) && value > 0 ? value : null;
}
