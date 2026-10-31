export type ConversationGroupMemberSource = "manual" | "inquiry_auto" | "legacy";

export interface ConversationGroupMemberStats {
  source: ConversationGroupMemberSource;
  firstInquiryMessageId: number | null;
  lastInquiryMessageId: number | null;
  inquiryCount: number;
}

const SOURCE_PRIORITY: Record<ConversationGroupMemberSource, number> = {
  legacy: 0,
  manual: 1,
  inquiry_auto: 2,
};

function firstMessageId(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function lastMessageId(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

/** 合并同一会话在两个分组中的元数据；分组事务负责保证每一来源成员只合并一次。 */
export function mergeConversationGroupMemberStats(
  target: ConversationGroupMemberStats,
  source: ConversationGroupMemberStats,
): ConversationGroupMemberStats {
  return {
    source: SOURCE_PRIORITY[source.source] > SOURCE_PRIORITY[target.source]
      ? source.source
      : target.source,
    firstInquiryMessageId: firstMessageId(
      target.firstInquiryMessageId,
      source.firstInquiryMessageId,
    ),
    lastInquiryMessageId: lastMessageId(
      target.lastInquiryMessageId,
      source.lastInquiryMessageId,
    ),
    inquiryCount: Math.max(0, target.inquiryCount) + Math.max(0, source.inquiryCount),
  };
}
