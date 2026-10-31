import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import { getEnterpriseRequestContextForActor } from "./enterpriseRequestContext";

export type ChatSqlExecutor = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">;

export type BusinessIdentity = Readonly<{
  enterpriseId: number | null;
  companyId: number | null;
  companyName: string | null;
  displayName: string;
}>;

export type ConversationParty = Readonly<BusinessIdentity & { userId: number }>;

type IdentityRow = {
  enterpriseId: unknown;
  memberStatus: unknown;
  loginDisabled: unknown;
  enterpriseName: unknown;
  companyId: unknown;
  userName: unknown;
  username: unknown;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function truthyDbBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function accountDisplayName(row: IdentityRow, actorUserId: number): string {
  const name = typeof row.userName === "string" ? row.userName.trim() : "";
  const username = typeof row.username === "string" ? row.username.trim() : "";
  return name || username || `用户#${actorUserId}`;
}

function identityQuery(actorUserId: number, enterpriseId: number | undefined) {
  const selected = enterpriseId === undefined ? sql`` : sql` AND em.enterpriseId = ${enterpriseId}`;
  return sql`
    SELECT em.enterpriseId AS enterpriseId,
           em.status AS memberStatus,
           u.loginDisabled AS loginDisabled,
           e.companyName AS enterpriseName,
           (
             SELECT CASE WHEN COUNT(*) = 1 THEN MIN(c.id) ELSE NULL END
               FROM companies c
              WHERE c.enterpriseId = em.enterpriseId
                AND c.userId = e.crmDataOwnerUserId
           ) AS companyId,
           u.name AS userName,
           u.username AS username
      FROM users u
      LEFT JOIN enterprise_members em ON em.userId = u.id
      LEFT JOIN enterprises e ON e.id = em.enterpriseId
     WHERE u.id = ${actorUserId}${selected}
     ORDER BY em.enterpriseId ASC
     LIMIT 3
  `;
}

/** Resolves only an authenticated actor's active, selected business identity. */
export async function resolveActorBusinessIdentity(
  executor: ChatSqlExecutor,
  actorUserId: number,
): Promise<BusinessIdentity> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "登录身份无效" });
  }
  const context = getEnterpriseRequestContextForActor(actorUserId);
  const selectedEnterpriseId = context?.enterpriseId ?? undefined;
  const found = rowsOf<IdentityRow>(await executor.execute(identityQuery(actorUserId, selectedEnterpriseId)));
  if (found.length === 0) {
    if (selectedEnterpriseId !== undefined) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是所选企业成员" });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: "登录账号不存在" });
  }
  if (truthyDbBoolean(found[0].loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  }
  if (selectedEnterpriseId === undefined && found.length > 1) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "您管理多家企业，请先选择企业" });
  }

  const row = found[0];
  const enterpriseId = positiveId(row.enterpriseId);
  if (!enterpriseId) {
    return {
      enterpriseId: null,
      companyId: null,
      companyName: null,
      displayName: accountDisplayName(row, actorUserId),
    };
  }
  if (row.memberStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业成员身份已暂停" });
  }
  if (selectedEnterpriseId !== undefined && enterpriseId !== selectedEnterpriseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是所选企业成员" });
  }
  const enterpriseName = typeof row.enterpriseName === "string" ? row.enterpriseName.trim() : "";
  if (!enterpriseName) {
    throw new TRPCError({ code: "CONFLICT", message: "企业规范名称异常，请联系平台处理" });
  }
  return {
    enterpriseId,
    companyId: positiveId(row.companyId),
    companyName: enterpriseName,
    displayName: enterpriseName,
  };
}

/** Resolves a contact's identity from server-side membership, never from a supplied company name. */
export async function resolveConversationCounterpartyIdentity(
  executor: ChatSqlExecutor,
  userId: number,
  targetEnterpriseId?: number,
): Promise<BusinessIdentity> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "联系人身份无效" });
  }
  const found = rowsOf<IdentityRow>(await executor.execute(identityQuery(userId, targetEnterpriseId)));
  if (!found.length) {
    if (targetEnterpriseId !== undefined) {
      throw new TRPCError({ code: "FORBIDDEN", message: "联系人不是目标企业的有效成员" });
    }
    throw new TRPCError({ code: "NOT_FOUND", message: "联系人不存在" });
  }
  if (truthyDbBoolean(found[0].loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "联系人账号已停用" });
  }
  if (targetEnterpriseId === undefined && found.length > 1) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "联系人管理多家企业，请从具体企业或库存入口发起会话",
    });
  }
  const row = found[0];
  const enterpriseId = positiveId(row.enterpriseId);
  if (!enterpriseId) {
    return {
      enterpriseId: null,
      companyId: null,
      companyName: null,
      displayName: accountDisplayName(row, userId),
    };
  }
  if (row.memberStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "联系人企业成员身份已暂停" });
  }
  const enterpriseName = typeof row.enterpriseName === "string" ? row.enterpriseName.trim() : "";
  if (!enterpriseName) {
    throw new TRPCError({ code: "CONFLICT", message: "联系人企业规范名称异常" });
  }
  return {
    enterpriseId,
    companyId: positiveId(row.companyId),
    companyName: enterpriseName,
    displayName: enterpriseName,
  };
}

export function actorIdentityContextKey(userId: number, identity: Pick<BusinessIdentity, "enterpriseId" | "companyId">): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "登录身份无效" });
  }
  return `v1:u${userId}:e${identity.enterpriseId ?? 0}:c${identity.companyId ?? 0}`;
}

export function orderedConversationParties<T extends ConversationParty>(left: T, right: T): [T, T] {
  if (left.userId === right.userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "联系人不能是当前用户" });
  }
  return left.userId < right.userId ? [left, right] : [right, left];
}

export function conversationIdentityContextKey(
  left: ConversationParty,
  right: ConversationParty,
): string {
  const [first, second] = orderedConversationParties(left, right);
  const token = (party: ConversationParty) => `u${party.userId}:e${party.enterpriseId ?? 0}:c${party.companyId ?? 0}`;
  return `v1:${token(first)}|${token(second)}`;
}

/** Exact actor-side frozen tuple predicate; legacy rows remain explicit historical rows only. */
export function conversationIdentityScopeSql(
  alias: string,
  actorUserId: number,
  identity: Pick<BusinessIdentity, "enterpriseId" | "companyId">,
) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("unsafe conversation SQL alias");
  const table = sql.raw(alias);
  return sql`(
    (
      (${table}.identityContextKey = 'legacy' OR ${table}.identityContextKey IS NULL)
      AND (${table}.user1Id = ${actorUserId} OR ${table}.user2Id = ${actorUserId})
    )
    OR (
      ${table}.user1Id = ${actorUserId}
      AND ${table}.user1EnterpriseId <=> ${identity.enterpriseId}
      AND ${table}.user1CompanyId <=> ${identity.companyId}
    )
    OR (
      ${table}.user2Id = ${actorUserId}
      AND ${table}.user2EnterpriseId <=> ${identity.enterpriseId}
      AND ${table}.user2CompanyId <=> ${identity.companyId}
    )
  )`;
}
