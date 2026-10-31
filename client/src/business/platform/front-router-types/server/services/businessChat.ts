import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";
import {
  listBusinessConversationIds,
  requireBusinessConversation,
  requireBusinessConversationForAttachment,
  requireBusinessConversationForMessage,
  type BusinessConversationScope,
} from "./businessConversationScope";
import {
  BUSINESS_CHAT_METHOD_POLICIES,
  isBusinessChatMethodId,
  type BusinessChatMethodId,
} from "../../../shared/businessChat";

export type BusinessChatScope = BusinessConversationScope;
type SqlExecutor = Awaited<ReturnType<typeof getDb>> extends infer T ? NonNullable<T> : never;
type OriginalChatCall = (method: string, params: unknown) => Promise<unknown>;

type GroupRow = {
  id: number;
  groupName: string;
  groupType: "manual" | "inquiry";
  status: "active" | "trashed";
  autoAssign: number | boolean;
  trashedAt: Date | null;
  createdAt: Date;
  memberCount: number | string;
  unreadCount: number | string;
  partNumbers: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}无效` });
  }
  return value as number;
}

function propertyId(params: unknown, key: string, label: string) {
  return positiveInteger(
    params && typeof params === "object" ? (params as Record<string, unknown>)[key] : undefined,
    label,
  );
}

function groupName(params: unknown) {
  const raw = params && typeof params === "object" ? (params as Record<string, unknown>).groupName : undefined;
  if (typeof raw !== "string") throw new TRPCError({ code: "BAD_REQUEST", message: "分组名无效" });
  const value = raw.trim();
  if (!value || value.length > 64) throw new TRPCError({ code: "BAD_REQUEST", message: "分组名无效" });
  return value;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

/**
 * This table is intentionally separate from conversation_groups.  The legacy
 * group table only has a user ID and cannot prove an enterprise relationship.
 * It is created by the migration handed to the parent; historical groups are
 * never guessed or backfilled.
 */
async function requireBusinessGroupSchema(db: SqlExecutor) {
  try {
    await db.execute(sql`SELECT groupId FROM business_chat_groups LIMIT 1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/business_chat_groups|ER_NO_SUCH_TABLE|doesn't exist/i.test(message)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "企业接待分组映射尚未迁移，不能读取或修改历史个人分组",
      });
    }
    throw error;
  }
}

/** Browser requests cannot synthesize this record: only internalBusiness.execute creates it. */
export function requireBusinessChatScope(ctx: TrpcContext): BusinessChatScope {
  const delegation = ctx.staffDelegation;
  if (!delegation || delegation.kind !== "business_bff" || !ctx.user) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业接待聊天只能由受信任业务委派调用" });
  }
  if (
    ctx.user.id !== delegation.staffUserId
    || ctx.effectiveUserId !== delegation.staffUserId
    || !Number.isSafeInteger(delegation.enterpriseId)
    || delegation.enterpriseId <= 0
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业接待员工上下文不一致" });
  }
  return { enterpriseId: delegation.enterpriseId, staffUserId: delegation.staffUserId };
}

/**
 * A group may be used in the business workbench only when its explicit mapping
 * matches the current scope and every existing member remains a proven inquiry
 * conversation.  A mixed legacy group is rejected rather than partially shown
 * or silently split.
 */
export async function requireBusinessChatGroup(input: {
  scope: BusinessChatScope;
  groupId: number;
  includeTrashed?: boolean;
}) {
  const groupId = positiveInteger(input.groupId, "聊天分组标识");
  const db = await requireDb();
  await requireBusinessGroupSchema(db);
  const groupResult = await db.execute(sql`
    SELECT g.id, g.status
      FROM conversation_groups g
      INNER JOIN business_chat_groups bg ON bg.groupId = g.id
     WHERE g.id = ${groupId}
       AND g.userId = ${input.scope.staffUserId}
       AND bg.enterpriseId = ${input.scope.enterpriseId}
       AND bg.staffUserId = ${input.scope.staffUserId}
       AND (${input.includeTrashed ? sql`1 = 1` : sql`g.status = 'active'`})
     LIMIT 1
  `);
  const group = rowsOf<{ id: number; status: "active" | "trashed" }>(groupResult)[0];
  if (!group) {
    throw new TRPCError({ code: "FORBIDDEN", message: "该分组不属于当前企业接待范围" });
  }
  const unscopedResult = await db.execute(sql`
    SELECT gm.id
      FROM conversation_group_members gm
     WHERE gm.groupId = ${groupId}
       AND (
         gm.userId <> ${input.scope.staffUserId}
         OR NOT EXISTS (
           SELECT 1
             FROM inventory_inquiries iq
             INNER JOIN conversations c ON c.id = iq.conversationId
            WHERE iq.conversationId = gm.conversationId
              AND iq.enterpriseId = ${input.scope.enterpriseId}
              AND iq.assigneeUserId = ${input.scope.staffUserId}
              AND (c.user1Id = ${input.scope.staffUserId} OR c.user2Id = ${input.scope.staffUserId})
         )
       )
     LIMIT 1
  `);
  if (rowsOf<{ id: number }>(unscopedResult)[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该分组含有无法证明企业归属的历史会话，已拒绝接待端访问",
    });
  }
  return { id: Number(group.id), status: group.status };
}

async function listBusinessGroups(scope: BusinessChatScope, status: "active" | "trashed") {
  const db = await requireDb();
  await requireBusinessGroupSchema(db);
  const rawResult = await db.execute(sql`
    SELECT g.id, g.groupName, g.groupType, g.status, g.autoAssign, g.trashedAt, g.createdAt,
           (SELECT COUNT(*) FROM conversation_group_members gm WHERE gm.groupId = g.id AND gm.userId = ${scope.staffUserId}) AS memberCount,
           (SELECT COALESCE(SUM(s.unreadCount), 0)
              FROM conversation_group_members gm
              INNER JOIN conversation_user_settings s
                ON s.conversationId = gm.conversationId AND s.userId = ${scope.staffUserId}
             WHERE gm.groupId = g.id AND gm.userId = ${scope.staffUserId}) AS unreadCount,
           (SELECT GROUP_CONCAT(rule_rows.partNumber ORDER BY rule_rows.id SEPARATOR '||')
              FROM conversation_group_part_rules rule_rows
             WHERE rule_rows.groupId = g.id AND rule_rows.userId = ${scope.staffUserId}) AS partNumbers
      FROM conversation_groups g
      INNER JOIN business_chat_groups bg ON bg.groupId = g.id
     WHERE g.userId = ${scope.staffUserId}
       AND bg.enterpriseId = ${scope.enterpriseId}
       AND bg.staffUserId = ${scope.staffUserId}
       AND g.status = ${status}
     ORDER BY ${status === "active" ? sql`g.createdAt ASC, g.id ASC` : sql`g.trashedAt DESC, g.id DESC`}
  `);
  const rows = rowsOf<GroupRow>(rawResult);
  const allowed: Array<{
    id: number; groupName: string; groupType: "manual" | "inquiry"; autoAssign: boolean;
    memberCount: number; unreadCount: number; partNumbers: string[]; trashedAt?: Date | null;
  }> = [];
  for (const row of rows) {
    try {
      await requireBusinessChatGroup({ scope, groupId: Number(row.id), includeTrashed: status === "trashed" });
      allowed.push({
        id: Number(row.id),
        groupName: row.groupName,
        groupType: row.groupType,
        autoAssign: Boolean(row.autoAssign),
        memberCount: Number(row.memberCount ?? 0),
        unreadCount: Number(row.unreadCount ?? 0),
        partNumbers: row.partNumbers ? row.partNumbers.split("||") : [],
        ...(status === "trashed" ? { trashedAt: row.trashedAt } : {}),
      });
    } catch (error) {
      // A formerly-good business group can be contaminated by a later personal
      // membership write.  It must disappear from this BFF list, not leak a
      // personal group name/count or allow a partial mutation.
      if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
    }
  }
  return allowed;
}

export function listBusinessChatGroups(scope: BusinessChatScope) {
  return listBusinessGroups(scope, "active");
}

export function listBusinessChatTrashedGroups(scope: BusinessChatScope) {
  return listBusinessGroups(scope, "trashed");
}

export async function createBusinessChatGroup(scope: BusinessChatScope, params: unknown) {
  const name = groupName(params);
  const db = await requireDb();
  await requireBusinessGroupSchema(db);
  return db.transaction(async tx => {
    const existing = rowsOf<{ id: number }>(await tx.execute(sql`
      SELECT id FROM conversation_groups WHERE userId = ${scope.staffUserId} AND groupName = ${name} LIMIT 1 FOR UPDATE
    `))[0];
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "已存在同名分组" });
    await tx.execute(sql`
      INSERT INTO conversation_groups (userId, groupName, groupType, status, autoAssign)
      VALUES (${scope.staffUserId}, ${name}, 'manual', 'active', 0)
    `);
    const id = Number(rowsOf<{ id: number }>(await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`))[0]?.id ?? 0);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("BUSINESS_CHAT_GROUP_INSERT_ID_MISSING");
    await tx.execute(sql`
      INSERT INTO business_chat_groups (groupId, enterpriseId, staffUserId)
      VALUES (${id}, ${scope.enterpriseId}, ${scope.staffUserId})
    `);
    return { ok: true, groupId: id };
  });
}

function methodInputId(method: BusinessChatMethodId, params: unknown) {
  if (method === "chat.recallMessage" || method === "chat.deleteMessageForMe") {
    return { kind: "message" as const, id: propertyId(params, "messageId", "聊天消息标识") };
  }
  if (method === "chat.getAttachmentUrl") {
    return { kind: "attachment" as const, id: propertyId(params, "attachmentId", "聊天附件标识") };
  }
  return { kind: "conversation" as const, id: propertyId(params, "conversationId", "聊天会话标识") };
}

async function assertMethodScope(method: BusinessChatMethodId, params: unknown, scope: BusinessChatScope) {
  const policy = BUSINESS_CHAT_METHOD_POLICIES[method];
  if (policy.resource === "list") return;
  if (policy.resource === "group") {
    if (method === "chat.createGroup") return;
    if (method === "chat.mergeGroups") {
      await requireBusinessChatGroup({ scope, groupId: propertyId(params, "sourceGroupId", "来源聊天分组标识") });
      await requireBusinessChatGroup({ scope, groupId: propertyId(params, "targetGroupId", "目标聊天分组标识") });
      return;
    }
    await requireBusinessChatGroup({ scope, groupId: propertyId(params, "groupId", "聊天分组标识"), includeTrashed: method === "chat.restoreGroup" });
    if (method === "chat.setGroupMembership") {
      await requireBusinessConversation(scope, propertyId(params, "conversationId", "聊天会话标识"));
    }
    return;
  }
  const resource = methodInputId(method, params);
  if (resource.kind === "conversation") return requireBusinessConversation(scope, resource.id);
  if (resource.kind === "message") return requireBusinessConversationForMessage(scope, resource.id);
  return requireBusinessConversationForAttachment(scope, resource.id);
}

/**
 * Executes only source-controlled business-chat kinds.  The original chat
 * caller still parses zod input and retains its transactions, attachment
 * validation, idempotency, read cursor and message ownership rules.
 */
export async function executeBusinessChatMethod(input: {
  method: BusinessChatMethodId;
  params: unknown;
  scope: BusinessChatScope;
  callOriginal: OriginalChatCall;
}) {
  if (!isBusinessChatMethodId(input.method)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未注册的企业接待聊天方法" });
  }
  if (input.method === "chat.listConversations") {
    const [rows, allowedIds] = await Promise.all([
      input.callOriginal("listConversations", undefined),
      listBusinessConversationIds(input.scope),
    ]);
    if (!Array.isArray(rows)) throw new Error("BUSINESS_CHAT_LIST_RESULT_INVALID");
    const allowed = new Set(allowedIds);
    return rows.filter(row => {
      const id = row && typeof row === "object" ? (row as Record<string, unknown>).id : undefined;
      return typeof id === "number" && allowed.has(id);
    });
  }
  if (input.method === "chat.getTotalUnread") {
    const [rows, allowedIds] = await Promise.all([
      input.callOriginal("listConversations", undefined),
      listBusinessConversationIds(input.scope),
    ]);
    if (!Array.isArray(rows)) throw new Error("BUSINESS_CHAT_LIST_RESULT_INVALID");
    const allowed = new Set(allowedIds);
    return { total: rows.reduce((sum, row) => {
      const value = row && typeof row === "object" ? row as Record<string, unknown> : null;
      return value && typeof value.id === "number" && allowed.has(value.id) && typeof value.unreadCount === "number"
        ? sum + Math.max(0, value.unreadCount)
        : sum;
    }, 0) };
  }
  if (input.method === "chat.listGroups") return listBusinessChatGroups(input.scope);
  if (input.method === "chat.listTrashedGroups") return listBusinessChatTrashedGroups(input.scope);
  if (input.method === "chat.createGroup") return createBusinessChatGroup(input.scope, input.params);

  await assertMethodScope(input.method, input.params, input.scope);
  const procedure = input.method.slice("chat.".length);
  const result = await input.callOriginal(procedure, input.params);
  if (input.method === "chat.mergeGroups") {
    const db = await requireDb();
    await db.execute(sql`
      DELETE FROM business_chat_groups
       WHERE groupId = ${propertyId(input.params, "sourceGroupId", "来源聊天分组标识")}
         AND enterpriseId = ${input.scope.enterpriseId}
         AND staffUserId = ${input.scope.staffUserId}
    `);
  }
  if (input.method === "chat.dissolveGroup") {
    const db = await requireDb();
    await db.execute(sql`
      DELETE FROM business_chat_groups
       WHERE groupId = ${propertyId(input.params, "groupId", "聊天分组标识")}
         AND enterpriseId = ${input.scope.enterpriseId}
         AND staffUserId = ${input.scope.staffUserId}
    `);
  }
  return result;
}

export const businessChatTestUtils = { positiveInteger, groupName };
