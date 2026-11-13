import {
  filterReceptionQueue,
  type InquiryReceptionFilter, type InquiryReceptionRow, type ReceptionConversation,
} from "./InquiryReceptionModel";

export type InquiryReceptionQueueMode = "material" | "customer";
export type InquiryReceptionMaterialGroup = {
  key: string;
  partNumber: string;
  brand: string;
  sourceSummary: string;
  rows: InquiryReceptionRow[];
  unreadCount: number;
  customerCount: number;
  conversationCount: number;
  recentAt: Date | string | null;
  lastMessagePreview: string;
};

const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();
const positiveId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const timestamp = (value: unknown) => {
  const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};
function rowRecentAt(row: InquiryReceptionRow, conversation?: ReceptionConversation) {
  return conversation?.lastMessageAt || row.lastActivityAt || row.createdAt || null;
}

/** A label/model/message is not an identity. Factory IDs occupy separate namespaces;
 * an absent factory public ID must never fall back to an inventory sentinel. */
export function receptionMaterialKey(row: InquiryReceptionRow): string {
  const kind = row.sourceKind;
  const publicId = typeof row.sourcePublicId === "string" ? row.sourcePublicId.trim() : "";
  let identity: [string, string | number];
  if ((kind === "channel_material" || kind === "official_admin_inventory") && publicId) {
    identity = [kind, publicId];
  } else if ((kind === "inventory" || kind == null) && positiveId(row.inventoryId)) {
    identity = ["inventory", row.inventoryId!];
  } else {
    identity = ["inquiry", `${row.conversationId}:${row.id}`];
  }
  return JSON.stringify([...identity, normalized(row.partNumber), normalized(row.brand)]);
}

export function receptionSourceSummary(row: InquiryReceptionRow): string {
  const kind = row.sourceKind;
  if (kind === "channel_material" || kind === "official_admin_inventory") {
    const label = kind === "channel_material" ? "工厂渠道" : "官方工厂库存";
    const snapshot = row.sourceFactoryName || row.sourceLabel;
    const id = typeof row.sourcePublicId === "string" ? row.sourcePublicId.trim() : "";
    return `${label}${snapshot && snapshot !== label ? ` · ${snapshot}` : ""} · ${id || "来源ID待确认"}`;
  }
  if ((kind === "inventory" || kind == null) && positiveId(row.inventoryId)) return `普通库存 · #${row.inventoryId}`;
  return `${row.sourceFactoryName || row.sourceLabel || "来源待确认"} · 独立询价`;
}

export function sortReceptionQueue(rows: readonly InquiryReceptionRow[], conversations: readonly ReceptionConversation[]) {
  const byId = new Map(conversations.map(item => [item.id, item]));
  return [...rows].sort((a, b) => {
    const aConversation = byId.get(a.conversationId), bConversation = byId.get(b.conversationId);
    return Number(Number(bConversation?.unreadCount) > 0) - Number(Number(aConversation?.unreadCount) > 0) ||
      timestamp(rowRecentAt(b, bConversation)) - timestamp(rowRecentAt(a, aConversation)) || b.id - a.id;
  });
}

/** Filter the authorized rows/status first. A material search reveals the matching
 * group's remaining rows; a buyer search reveals only that buyer's original rows. */
export function groupReceptionQueue(
  rows: readonly InquiryReceptionRow[], conversations: readonly ReceptionConversation[],
  filter: InquiryReceptionFilter, search: string,
): InquiryReceptionMaterialGroup[] {
  const byId = new Map(conversations.map(item => [item.id, item]));
  const buckets = new Map<string, InquiryReceptionRow[]>();
  for (const row of filterReceptionQueue(rows, conversations, filter, "")) {
    const key = receptionMaterialKey(row);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row); buckets.set(key, bucket);
  }
  const needle = normalized(search);
  const groups: InquiryReceptionMaterialGroup[] = [];
  for (const [key, bucket] of Array.from(buckets.entries())) {
    const materialMatch = !needle || bucket.some(row => [row.partNumber, row.brand].some(value => normalized(value).includes(needle)));
    const matching = materialMatch ? bucket : filterReceptionQueue(bucket, conversations, "all", search);
    if (!matching.length) continue;
    const sorted = sortReceptionQueue(matching, conversations);
    const first = sorted[0];
    const conversationIds = new Set(sorted.map(row => row.conversationId));
    const customers = new Set(sorted.map(row => {
      const buyerId = byId.get(row.conversationId)?.otherUserId;
      // Never merge customers merely because their display names match.
      return positiveId(buyerId) ? `buyer:${buyerId}` : `conversation:${row.conversationId}`;
    }));
    const latest = [...sorted].sort((a, b) => timestamp(rowRecentAt(b, byId.get(b.conversationId))) - timestamp(rowRecentAt(a, byId.get(a.conversationId))) || b.id - a.id)[0];
    const latestConversation = byId.get(latest.conversationId);
    groups.push({ key, partNumber: first.partNumber, brand: first.brand || "品牌待确认", sourceSummary: receptionSourceSummary(first), rows: sorted,
      unreadCount: Array.from(conversationIds).reduce((total, id) => total + Math.max(0, Number(byId.get(id)?.unreadCount) || 0), 0),
      customerCount: customers.size, conversationCount: conversationIds.size,
      recentAt: rowRecentAt(latest, latestConversation),
      lastMessagePreview: latestConversation?.lastMessagePreview || (latestConversation ? "暂无消息摘要" : "监督记录 · 非本人参与会话"),
    });
  }
  return groups.sort((a, b) => Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || timestamp(b.recentAt) - timestamp(a.recentAt) || a.key.localeCompare(b.key));
}
