import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { BusinessIdentity, ChatSqlExecutor } from "./actorBusinessIdentity";
import { resolveActorBusinessIdentity } from "./actorBusinessIdentity";
import { accountSupportIdsSql } from "./accountSupportConversation";
import { getEnterpriseRequestContextForActor } from "./enterpriseRequestContext";

export { accountSupportIdsSql };

export type AccountSupportViewKind = "enterprise" | "general";

export type AccountSupportView = Readonly<{
  supportView: AccountSupportViewKind;
  scopeEnterpriseId: number;
  identity: BusinessIdentity;
  supportOnlyWithoutEnterpriseSelection: boolean;
}>;

type WeappRequestContext = Readonly<{
  req: Readonly<{
    headers: Readonly<Record<string, string | string[] | undefined>>;
  }>;
}>;

const noEnterpriseIdentity = (userId: number): BusinessIdentity => ({
  enterpriseId: null,
  companyId: null,
  companyName: null,
  displayName: `用户#${userId}`,
});

function isSelectionRequired(error: unknown): boolean {
  return error instanceof TRPCError
    && error.code === "PRECONDITION_FAILED"
    && error.message === "您管理多家企业，请先选择企业";
}

/** Resolves an account-service view strictly from the verified server-side actor identity. */
export async function resolveAccountSupportView(
  executor: ChatSqlExecutor,
  actorUserId: number,
  requested: AccountSupportViewKind | undefined,
): Promise<AccountSupportView> {
  const context = getEnterpriseRequestContextForActor(actorUserId);
  let identity: BusinessIdentity;
  let supportOnlyWithoutEnterpriseSelection = false;
  try {
    identity = await resolveActorBusinessIdentity(executor, actorUserId);
  } catch (error: unknown) {
    if (isSelectionRequired(error) && context?.enterpriseId == null) {
      identity = noEnterpriseIdentity(actorUserId);
      supportOnlyWithoutEnterpriseSelection = true;
    } else {
      throw error;
    }
  }
  const supportView = requested ?? (identity.enterpriseId !== null ? "enterprise" : "general");
  if (supportView === "enterprise" && identity.enterpriseId === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请选择当前企业后查看企业客服消息",
    });
  }
  return {
    supportView,
    scopeEnterpriseId: supportView === "enterprise" ? Number(identity.enterpriseId) : 0,
    identity,
    supportOnlyWithoutEnterpriseSelection,
  };
}

function safeAlias(alias: string): SQL {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("unsafe support SQL alias");
  return sql.raw(alias);
}

export function supportSourceFrozenEnterpriseSql(conversationAlias: string, accountUserId: number): SQL {
  const conversation = safeAlias(conversationAlias);
  return sql`CASE
    WHEN ${conversation}.user1Id = ${accountUserId} THEN ${conversation}.user1EnterpriseId
    WHEN ${conversation}.user2Id = ${accountUserId} THEN ${conversation}.user2EnterpriseId
    ELSE NULL
  END`;
}

export function accountSupportMessageScopeIdSql(
  messageAlias: string,
  conversationAlias: string,
  accountUserId: number,
  serviceUserId: number,
): SQL {
  const message = safeAlias(messageAlias);
  const frozenEnterprise = supportSourceFrozenEnterpriseSql(conversationAlias, accountUserId);
  const senderEnterprise = sql`${message}.senderEnterpriseId`;
  const recipientEnterprise = sql`${message}.recipientEnterpriseId`;
  const directOrFrozen = (direct: SQL): SQL => sql`CASE
    WHEN ${direct} IS NOT NULL AND ${direct} > 0
      AND (${frozenEnterprise} IS NULL OR ${frozenEnterprise} <= 0 OR ${frozenEnterprise} = ${direct})
      THEN ${direct}
    WHEN (${direct} IS NULL OR ${direct} <= 0)
      AND ${frozenEnterprise} IS NOT NULL AND ${frozenEnterprise} > 0
      THEN ${frozenEnterprise}
    ELSE 0
  END`;
  return sql`CASE
    WHEN ${message}.msgType = 'greeting' THEN 0
    WHEN ${message}.senderId = ${serviceUserId}
      AND ${message}.clientMessageId LIKE 'welcome-v1-user-%' THEN 0
    WHEN ${message}.senderId IN (${accountUserId}, ${serviceUserId})
      AND ${message}.supportScopeEnterpriseId IS NOT NULL
      THEN CASE WHEN ${message}.supportScopeEnterpriseId >= 0 THEN ${message}.supportScopeEnterpriseId ELSE 0 END
    WHEN ${message}.senderId = ${accountUserId} THEN ${directOrFrozen(senderEnterprise)}
    WHEN ${message}.senderId = ${serviceUserId} THEN ${directOrFrozen(recipientEnterprise)}
    ELSE 0
  END`;
}

export function accountSupportMessageInViewSql(
  messageAlias: string,
  conversationAlias: string,
  accountUserId: number,
  serviceUserId: number,
  scopeEnterpriseId: number,
): SQL {
  if (!Number.isSafeInteger(scopeEnterpriseId) || scopeEnterpriseId < 0) {
    throw new Error("invalid account support scope");
  }
  return sql`(${accountSupportMessageScopeIdSql(
    messageAlias,
    conversationAlias,
    accountUserId,
    serviceUserId,
  )}) = ${scopeEnterpriseId}`;
}

export function supportSendIdentity(
  identity: BusinessIdentity,
  supportView: AccountSupportViewKind,
): BusinessIdentity {
  return supportView === "general"
    ? { ...identity, enterpriseId: null, companyId: null, companyName: null }
    : identity;
}

/** Header compatibility is only evaluated after a server-verified official support conversation. */
export function isWeappDefaultAccountSupportCompatibility(
  ctx: WeappRequestContext,
  requestedSupportView: AccountSupportViewKind | undefined,
  verifiedOfficialAccountSupport: unknown,
): boolean {
  return Boolean(verifiedOfficialAccountSupport)
    && requestedSupportView === undefined
    && ctx.req.headers["x-51dianzi-client"] === "weapp";
}

export function accountSupportDisplayedScopeIds(
  supportView: AccountSupportView,
  compatibilityMode: boolean,
): number[] {
  const enterpriseId = Number(supportView.identity.enterpriseId);
  return compatibilityMode && Number.isSafeInteger(enterpriseId) && enterpriseId > 0
    ? [enterpriseId, 0]
    : [supportView.scopeEnterpriseId];
}

export function accountSupportScopeIdsSql(scopeEnterpriseIds: readonly number[]): SQL {
  if (
    !Array.isArray(scopeEnterpriseIds)
    || scopeEnterpriseIds.length < 1
    || scopeEnterpriseIds.length > 2
    || scopeEnterpriseIds.some((id) => !Number.isSafeInteger(id) || id < 0)
  ) {
    throw new Error("invalid account support display scopes");
  }
  return sql.join(scopeEnterpriseIds.map((id) => sql`${id}`), sql`, `);
}

export function accountSupportMessageInDisplayedScopesSql(
  messageAlias: string,
  conversationAlias: string,
  accountUserId: number,
  serviceUserId: number,
  scopeEnterpriseIds: readonly number[],
): SQL {
  if (scopeEnterpriseIds.length === 1) {
    return accountSupportMessageInViewSql(
      messageAlias,
      conversationAlias,
      accountUserId,
      serviceUserId,
      scopeEnterpriseIds[0],
    );
  }
  return sql`(${accountSupportMessageScopeIdSql(
    messageAlias,
    conversationAlias,
    accountUserId,
    serviceUserId,
  )}) IN (${accountSupportScopeIdsSql(scopeEnterpriseIds)})`;
}

export function accountSupportMessageAfterViewDeleteSql(
  messageAlias: string,
  conversationAlias: string,
  accountUserId: number,
  serviceUserId: number,
): SQL {
  const message = safeAlias(messageAlias);
  const messageScopeEnterpriseId = accountSupportMessageScopeIdSql(
    messageAlias,
    conversationAlias,
    accountUserId,
    serviceUserId,
  );
  return sql`${message}.id > COALESCE((
    SELECT support_view_settings.deletedBeforeMessageId
      FROM account_support_view_settings support_view_settings
     WHERE support_view_settings.userId = ${accountUserId}
       AND support_view_settings.scopeEnterpriseId = (${messageScopeEnterpriseId})
     LIMIT 1
  ), 0)`;
}

export function accountSupportAttachmentInDisplayedScopesSql(
  attachmentAlias: string,
  messageAlias: string,
  conversationAlias: string,
  accountUserId: number,
  serviceUserId: number,
  sourceConversationIds: readonly number[],
  scopeEnterpriseIds: readonly number[],
): SQL {
  const attachment = safeAlias(attachmentAlias);
  return sql`(
    ${attachment}.supportEnterpriseId IN (${accountSupportScopeIdsSql(scopeEnterpriseIds)})
    OR (
      ${attachment}.supportEnterpriseId IS NULL
      AND EXISTS (
        SELECT 1
          FROM messages ${safeAlias(messageAlias)}
          INNER JOIN conversations ${safeAlias(conversationAlias)}
            ON ${safeAlias(conversationAlias)}.id = ${safeAlias(messageAlias)}.conversationId
         WHERE ${safeAlias(messageAlias)}.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
           AND JSON_VALID(${safeAlias(messageAlias)}.content)
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(${safeAlias(messageAlias)}.content, '$.attachmentId')) AS UNSIGNED) = ${attachment}.id
           AND ${accountSupportMessageInDisplayedScopesSql(
             messageAlias,
             conversationAlias,
             accountUserId,
             serviceUserId,
             scopeEnterpriseIds,
           )}
      )
    )
  )`;
}
