import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

export type BusinessConversationScope = Readonly<{
  enterpriseId: number;
  staffUserId: number;
}>;

type ConversationRow = { conversationId: number };

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return [];
}

function assertScope(scope: BusinessConversationScope) {
  if (!Number.isSafeInteger(scope.enterpriseId) || scope.enterpriseId <= 0
    || !Number.isSafeInteger(scope.staffUserId) || scope.staffUserId <= 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "聊天企业员工上下文无效" });
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

/**
 * A business-chat conversation is an assigned inventory inquiry conversation.
 * The inquiry row is the authoritative enterprise link; merely sharing a staff
 * member or a counterpart with an enterprise never qualifies a private chat.
 */
async function scopedConversationRows(scope: BusinessConversationScope, extra: ReturnType<typeof sql> = sql`1 = 1`) {
  assertScope(scope);
  const db = await requireDb();
  const result = await db.execute(sql`
    SELECT DISTINCT iq.conversationId AS conversationId
      FROM inventory_inquiries iq
      INNER JOIN conversations c ON c.id = iq.conversationId
     WHERE iq.enterpriseId = ${scope.enterpriseId}
       AND iq.assigneeUserId = ${scope.staffUserId}
       AND (c.user1Id = ${scope.staffUserId} OR c.user2Id = ${scope.staffUserId})
       AND ${extra}
     ORDER BY iq.conversationId ASC
  `);
  return rowsOf<ConversationRow>(result)
    .map(row => Number(row.conversationId))
    .filter(id => Number.isSafeInteger(id) && id > 0);
}

/** Returns only conversation IDs whose enterprise and recipient scope can be proved. */
export async function listBusinessConversationIds(scope: BusinessConversationScope) {
  return scopedConversationRows(scope);
}

/** Fail closed before a delegated original chat procedure can read or mutate a conversation. */
export async function requireBusinessConversation(scope: BusinessConversationScope, conversationId: number) {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "聊天会话标识无效" });
  }
  const ids = await scopedConversationRows(scope, sql`iq.conversationId = ${conversationId}`);
  if (!ids.includes(conversationId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "该会话不属于当前企业的已分配询价" });
  }
}

/** Message-only operations must derive their conversation server-side, never from a browser sender field. */
export async function requireBusinessConversationForMessage(scope: BusinessConversationScope, messageId: number) {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "聊天消息标识无效" });
  }
  const ids = await scopedConversationRows(scope, sql`EXISTS (
    SELECT 1 FROM messages m
     WHERE m.id = ${messageId} AND m.conversationId = iq.conversationId
  )`);
  if (ids.length !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "该消息不属于当前企业的已分配询价会话" });
  }
  return ids[0]!;
}

/** Attachment URLs are equally scoped because attachment IDs alone are otherwise cross-conversation capabilities. */
export async function requireBusinessConversationForAttachment(scope: BusinessConversationScope, attachmentId: number) {
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "聊天附件标识无效" });
  }
  const ids = await scopedConversationRows(scope, sql`EXISTS (
    SELECT 1 FROM chat_attachments a
     WHERE a.id = ${attachmentId} AND a.conversationId = iq.conversationId
  )`);
  if (ids.length !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "该附件不属于当前企业的已分配询价会话" });
  }
  return ids[0]!;
}

/** Exposed for deterministic unit tests without a database. */
export const businessConversationScopeTestUtils = {
  isValidScope(scope: BusinessConversationScope) {
    return Number.isSafeInteger(scope.enterpriseId) && scope.enterpriseId > 0
      && Number.isSafeInteger(scope.staffUserId) && scope.staffUserId > 0;
  },
};
