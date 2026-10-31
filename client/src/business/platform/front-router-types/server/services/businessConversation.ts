import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { ChatSqlExecutor, ConversationParty } from "./actorBusinessIdentity";
import { conversationIdentityContextKey, orderedConversationParties } from "./actorBusinessIdentity";

type TransactionExecutor = ChatSqlExecutor & Partial<Pick<NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>, "transaction">>;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}

/** Creates/reuses only the exact bilateral frozen tuple and restores both settings rows. */
export async function getOrCreateBusinessConversation(
  executor: TransactionExecutor,
  left: ConversationParty,
  right: ConversationParty,
): Promise<number> {
  const [first, second] = orderedConversationParties(left, right);
  const identityContextKey = conversationIdentityContextKey(first, second);
  await executor.execute(sql`
    INSERT INTO conversations
      (user1Id, user2Id,
       user1EnterpriseId, user2EnterpriseId, user1CompanyId, user2CompanyId,
       user1CompanyNameSnapshot, user2CompanyNameSnapshot, identityContextKey,
       lastMessagePreview)
    VALUES
      (${first.userId}, ${second.userId},
       ${first.enterpriseId}, ${second.enterpriseId}, ${first.companyId}, ${second.companyId},
       ${first.companyName}, ${second.companyName}, ${identityContextKey}, '')
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updatedAt = updatedAt
  `);
  let conversationId = Number(rowsOf<{ id: unknown }>(await executor.execute(sql`
    SELECT LAST_INSERT_ID() AS id
  `))[0]?.id ?? 0);
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    conversationId = Number(rowsOf<{ id: unknown }>(await executor.execute(sql`
      SELECT id
        FROM conversations
       WHERE user1Id = ${first.userId}
         AND user2Id = ${second.userId}
         AND identityContextKey = ${identityContextKey}
       LIMIT 1
    `))[0]?.id ?? 0);
  }
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "业务会话创建失败" });
  }
  await executor.execute(sql`
    INSERT INTO conversation_user_settings (conversationId, userId, deleted)
    VALUES (${conversationId}, ${first.userId}, 0), (${conversationId}, ${second.userId}, 0)
    ON DUPLICATE KEY UPDATE deleted = 0, updatedAt = updatedAt
  `);
  return conversationId;
}
