import { sql, type SQL } from "drizzle-orm";
import type { getDb } from "../db";
import type { ChatSqlExecutor } from "./actorBusinessIdentity";
import { getOrCreateBusinessConversation } from "./businessConversation";

type TransactionExecutor = ChatSqlExecutor & Partial<Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "transaction">>;
type ConversationIdRow = Readonly<{ id: unknown }>;

export type AccountSupportConversation = Readonly<{
  canonicalId: number;
  sourceIds: number[];
}>;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}

/** All historical account-service source rows are one logical support conversation. */
export async function accountSupportConversationIds(
  executor: ChatSqlExecutor,
  accountUserId: number,
  serviceUserId: number,
): Promise<number[]> {
  const result = await executor.execute(sql`
    SELECT c.id
      FROM conversations c
     WHERE (c.user1Id = ${accountUserId} AND c.user2Id = ${serviceUserId})
        OR (c.user2Id = ${accountUserId} AND c.user1Id = ${serviceUserId})
     ORDER BY c.id ASC
  `);
  return rowsOf<ConversationIdRow>(result)
    .map((row) => Number(row.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export async function resolveAccountSupportConversation(
  executor: ChatSqlExecutor,
  accountUserId: number,
  serviceUserId: number,
  requestedConversationId: number,
): Promise<AccountSupportConversation | null> {
  const sourceIds = await accountSupportConversationIds(executor, accountUserId, serviceUserId);
  if (!sourceIds.includes(requestedConversationId)) return null;
  return { canonicalId: sourceIds[0], sourceIds };
}

/**
 * Serializes creation on the account row, reuses the oldest support source row,
 * and restores both participants' settings exactly as the legacy implementation.
 */
export async function getOrCreateAccountSupportConversation(
  executor: TransactionExecutor,
  accountUserId: number,
  serviceUserId: number,
): Promise<AccountSupportConversation> {
  const run = async (tx: ChatSqlExecutor): Promise<AccountSupportConversation> => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${accountUserId} LIMIT 1 FOR UPDATE`);
    const existing = await accountSupportConversationIds(tx, accountUserId, serviceUserId);
    if (existing.length > 0) {
      await tx.execute(sql`
        INSERT INTO conversation_user_settings (conversationId, userId, deleted)
        VALUES (${existing[0]}, ${accountUserId}, 0), (${existing[0]}, ${serviceUserId}, 0)
        ON DUPLICATE KEY UPDATE deleted = 0, updatedAt = NOW()
      `);
      return { canonicalId: existing[0], sourceIds: existing };
    }
    const canonicalId = await getOrCreateBusinessConversation(
      tx,
      { userId: accountUserId, enterpriseId: null, companyId: null, companyName: null, displayName: "" },
      { userId: serviceUserId, enterpriseId: null, companyId: null, companyName: null, displayName: "" },
    );
    return { canonicalId, sourceIds: [canonicalId] };
  };
  return executor.transaction ? executor.transaction(run) : run(executor);
}

export function accountSupportIdsSql(ids: readonly number[]): SQL {
  if (ids.length === 0) throw new Error("account support source IDs cannot be empty");
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}
