import { sql } from "drizzle-orm";
import type { ChatSqlExecutor } from "./actorBusinessIdentity";

const LEGACY_CHAT_PREACTIVATION_COMPAT_ENV = "LEGACY_CHAT_PREACTIVATION_COMPAT";

const REQUIRED_OLD_UNIQUE_INDEXES: readonly Readonly<{
  tableName: string;
  indexName: string;
  columns: readonly string[];
}>[] = [
  { tableName: "companies", indexName: "companies_userId_unique", columns: ["userId"] },
  { tableName: "enterprise_members", indexName: "enterprise_members_user_unique", columns: ["userId"] },
  { tableName: "stock_ledger", indexName: "stock_ledger_user_part_unique", columns: ["userId", "partNumber"] },
  { tableName: "inbound_payment_entries", indexName: "inbound_payment_entries_owner_request_unique", columns: ["ownerUserId", "requestId"] },
  { tableName: "inbound_request_keys", indexName: "inbound_request_keys_owner_request_unique", columns: ["ownerUserId", "requestId"] },
  { tableName: "inbound_bulk_requests", indexName: "inbound_bulk_requests_owner_request_unique", columns: ["ownerUserId", "requestId"] },
  { tableName: "outbound_request_keys", indexName: "outbound_request_keys_owner_request_unique", columns: ["ownerUserId", "requestId"] },
  { tableName: "conversations", indexName: "conversations_user_pair_unique", columns: ["user1Id", "user2Id"] },
  { tableName: "messages", indexName: "messages_sender_client_message_unique", columns: ["senderId", "clientMessageId"] },
  { tableName: "inventory_inquiries", indexName: "inventory_inquiries_buyer_client_unique", columns: ["buyerUserId", "clientMessageId"] },
];

type LegacyConversationRow = Readonly<{ id: unknown }>;
type ControlTableRow = Readonly<{ tableName: unknown }>;
type ActiveEpochRow = Readonly<{ activeEpochCount: unknown }>;
type CutoverRow = Readonly<{ phase: unknown }>;
type IndexShapeRow = Readonly<{
  tableName: unknown;
  indexName: unknown;
  nonUnique: unknown;
  seqInIndex: unknown;
  columnName: unknown;
  subPart: unknown;
  indexType: unknown;
  isVisible: unknown;
}>;
type MembershipRow = Readonly<{
  userId: unknown;
  loginDisabled: unknown;
  activeEnterpriseCount: unknown;
  declaredActiveEnterpriseCount: unknown;
  unmatchedOwnedCompanyCount: unknown;
}>;

export type LegacyDirectConversationResult =
  | Readonly<{ state: "invalid" }>
  | Readonly<{ state: "none" }>
  | Readonly<{ state: "found"; conversationId: number }>;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function dbFalse(value: unknown): boolean {
  return value === false || value === 0 || value === "0" || value === BigInt(0);
}

function completeRequiredIndexShape(rows: readonly IndexShapeRow[]): boolean {
  const requiredColumnCount = REQUIRED_OLD_UNIQUE_INDEXES.reduce(
    (count, index) => count + index.columns.length,
    0,
  );
  if (rows.length !== requiredColumnCount) return false;
  for (const required of REQUIRED_OLD_UNIQUE_INDEXES) {
    const actual = rows
      .filter((row) => String(row.tableName) === required.tableName && String(row.indexName) === required.indexName)
      .sort((left, right) => Number(left.seqInIndex) - Number(right.seqInIndex));
    if (actual.length !== required.columns.length) return false;
    for (let index = 0; index < required.columns.length; index += 1) {
      const row = actual[index];
      if (
        !dbFalse(row.nonUnique)
        || Number(row.seqInIndex) !== index + 1
        || String(row.columnName) !== required.columns[index]
        || row.subPart !== null
        || String(row.indexType).toUpperCase() !== "BTREE"
        || String(row.isVisible).toUpperCase() !== "YES"
      ) {
        return false;
      }
    }
  }
  return true;
}

export function isLegacyChatPreactivationCompatibilityEnabled(): boolean {
  return process.env[LEGACY_CHAT_PREACTIVATION_COMPAT_ENV] === "1";
}

export async function findExistingLegacyDirectConversation(
  executor: ChatSqlExecutor,
  leftUserId: unknown,
  rightUserId: unknown,
): Promise<LegacyDirectConversationResult> {
  const left = positiveId(leftUserId);
  const right = positiveId(rightUserId);
  if (!left || !right || left === right) return { state: "invalid" };
  const user1Id = Math.min(left, right);
  const user2Id = Math.max(left, right);
  try {
    const rows = rowsOf<LegacyConversationRow>(await executor.execute(sql`
      SELECT id, identityContextKey
        FROM conversations
       WHERE user1Id = ${user1Id}
         AND user2Id = ${user2Id}
         AND (identityContextKey = 'legacy' OR identityContextKey IS NULL)
       LIMIT 2
    `));
    if (rows.length === 0) return { state: "none" };
    const conversationId = positiveId(rows[0]?.id);
    if (rows.length !== 1 || !conversationId) return { state: "invalid" };
    return { state: "found", conversationId };
  } catch {
    return { state: "invalid" };
  }
}

/**
 * This compatibility path is disabled by default and only opens before cutover,
 * when every required legacy uniqueness shape and both participants are verified.
 */
export async function canWriteLegacyDirectConversationPreactivation(
  executor: ChatSqlExecutor,
  actorUserId: unknown,
  otherUserId: unknown,
): Promise<boolean> {
  if (!isLegacyChatPreactivationCompatibilityEnabled()) return false;
  const actorId = positiveId(actorUserId);
  const otherId = positiveId(otherUserId);
  if (!actorId || !otherId || actorId === otherId) return false;
  try {
    const controlTableRows = rowsOf<ControlTableRow>(await executor.execute(sql`
      SELECT TABLE_NAME AS tableName
        FROM information_schema.tables
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('enterprise_preserved_audit_epochs', 'enterprise_multi_enterprise_cutover')
    `));
    const controlTables = new Set(controlTableRows.map((row) => String(row.tableName)));
    if (!controlTables.has("enterprise_multi_enterprise_cutover")) return false;
    if (controlTables.has("enterprise_preserved_audit_epochs")) {
      const epochRows = rowsOf<ActiveEpochRow>(await executor.execute(sql`
        SELECT COUNT(*) AS activeEpochCount
          FROM enterprise_preserved_audit_epochs
         WHERE phase = 'active'
      `));
      if (epochRows.length !== 1 || !dbFalse(epochRows[0]?.activeEpochCount)) return false;
    }
    const legacyControlRows = rowsOf<CutoverRow>(await executor.execute(sql`
      SELECT phase
        FROM enterprise_multi_enterprise_cutover
       LIMIT 3
    `));
    if (legacyControlRows.length !== 1 || legacyControlRows[0]?.phase !== "prepare") return false;
    const indexRows = rowsOf<IndexShapeRow>(await executor.execute(sql`
      SELECT TABLE_NAME AS tableName,
             INDEX_NAME AS indexName,
             NON_UNIQUE AS nonUnique,
             SEQ_IN_INDEX AS seqInIndex,
             COLUMN_NAME AS columnName,
             SUB_PART AS subPart,
             INDEX_TYPE AS indexType,
             IS_VISIBLE AS isVisible
        FROM information_schema.statistics
       WHERE TABLE_SCHEMA = DATABASE()
         AND (
           (TABLE_NAME = 'companies' AND INDEX_NAME = 'companies_userId_unique')
           OR (TABLE_NAME = 'enterprise_members' AND INDEX_NAME = 'enterprise_members_user_unique')
           OR (TABLE_NAME = 'stock_ledger' AND INDEX_NAME = 'stock_ledger_user_part_unique')
           OR (TABLE_NAME = 'inbound_payment_entries' AND INDEX_NAME = 'inbound_payment_entries_owner_request_unique')
           OR (TABLE_NAME = 'inbound_request_keys' AND INDEX_NAME = 'inbound_request_keys_owner_request_unique')
           OR (TABLE_NAME = 'inbound_bulk_requests' AND INDEX_NAME = 'inbound_bulk_requests_owner_request_unique')
           OR (TABLE_NAME = 'outbound_request_keys' AND INDEX_NAME = 'outbound_request_keys_owner_request_unique')
           OR (TABLE_NAME = 'conversations' AND INDEX_NAME = 'conversations_user_pair_unique')
           OR (TABLE_NAME = 'messages' AND INDEX_NAME = 'messages_sender_client_message_unique')
           OR (TABLE_NAME = 'inventory_inquiries' AND INDEX_NAME = 'inventory_inquiries_buyer_client_unique')
         )
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `));
    if (!completeRequiredIndexShape(indexRows)) return false;
    const membershipRows = rowsOf<MembershipRow>(await executor.execute(sql`
      SELECT u.id AS userId,
             u.loginDisabled AS loginDisabled,
             COUNT(DISTINCT e.id) AS activeEnterpriseCount,
             COUNT(DISTINCT em.enterpriseId) AS declaredActiveEnterpriseCount,
             COUNT(DISTINCT CASE
               WHEN owned.id IS NOT NULL
                AND NOT (e.id IS NOT NULL
                  AND owned.enterpriseId <=> e.id
                  AND e.crmDataOwnerUserId <=> u.id)
               THEN owned.id ELSE NULL
             END) AS unmatchedOwnedCompanyCount
        FROM users u
        LEFT JOIN enterprise_members em
          ON em.userId = u.id
         AND em.status = 'active'
        LEFT JOIN enterprises e ON e.id = em.enterpriseId
        LEFT JOIN companies owned ON owned.userId = u.id
       WHERE u.id IN (${actorId}, ${otherId})
       GROUP BY u.id, u.loginDisabled
       ORDER BY u.id ASC
    `));
    if (membershipRows.length !== 2) return false;
    const participants = new Map<number | null, MembershipRow>(
      membershipRows.map((row) => [positiveId(row.userId), row]),
    );
    for (const userId of [actorId, otherId]) {
      const participant = participants.get(userId);
      const activeCount = Number(participant?.activeEnterpriseCount);
      const declaredCount = Number(participant?.declaredActiveEnterpriseCount);
      const unmatchedOwnedCount = Number(participant?.unmatchedOwnedCompanyCount);
      if (
        !participant
        || !dbFalse(participant.loginDisabled)
        || participant.activeEnterpriseCount == null
        || participant.declaredActiveEnterpriseCount == null
        || participant.unmatchedOwnedCompanyCount == null
        || !Number.isSafeInteger(activeCount)
        || !Number.isSafeInteger(declaredCount)
        || !Number.isSafeInteger(unmatchedOwnedCount)
        || declaredCount !== activeCount
        || unmatchedOwnedCount < 0
        || activeCount < 0
        || activeCount + unmatchedOwnedCount > 1
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
