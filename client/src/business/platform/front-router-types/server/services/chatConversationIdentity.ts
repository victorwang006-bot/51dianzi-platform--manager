import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import {
  actorIdentityContextKey,
  conversationIdentityContextKey,
  conversationIdentityScopeSql,
  orderedConversationParties,
  resolveActorBusinessIdentity,
  type BusinessIdentity,
  type ChatSqlExecutor,
  type ConversationParty,
} from "./actorBusinessIdentity";
import { getOrCreateBusinessConversation } from "./businessConversation";
import * as customerService from "./customerService";
import {
  canWriteLegacyDirectConversationPreactivation,
  isLegacyChatPreactivationCompatibilityEnabled,
} from "./legacyChatPreactivationCompatibility";

const { getServiceUserId } = customerService;
import {
  getEnterpriseRequestContextForActor,
  runWithEnterpriseRequestContext,
} from "./enterpriseRequestContext";
import {
  activePendingTransitionScopeSql,
  isLockedTransitionCanonicalSafe,
  transitionClaimsCurrentActorIdentity,
  type LockedTransitionCandidate,
} from "./chatTransitionCloseout";

type TransactionExecutor = ChatSqlExecutor &
  Partial<Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "transaction">>;

type ConversationIdentityRow = {
  id: unknown;
  user1Id: unknown;
  user2Id: unknown;
  user1EnterpriseId: unknown;
  user2EnterpriseId: unknown;
  user1CompanyId: unknown;
  user2CompanyId: unknown;
  identityContextKey: unknown;
  currentRound?: unknown;
  endedAt?: unknown;
  lastMessageAt?: unknown;
  lastMessagePreview?: unknown;
  createdAt?: unknown;
};

type TransitionRow = {
  id: unknown;
  legacyConversationId: unknown;
  initiatorUserId: unknown;
  initiatorIdentityKey: unknown;
  initiatorEnterpriseId: unknown;
  initiatorCompanyId: unknown;
  initiatorCompanyName: unknown;
  recipientUserId: unknown;
  recipientConfirmedIdentityKey: unknown;
  recipientConfirmedEnterpriseId: unknown;
  recipientConfirmedCompanyId: unknown;
  recipientConfirmedCompanyName: unknown;
  pendingConversationId: unknown;
  finalConversationId: unknown;
  status: unknown;
};

type TransitionIdentity = BusinessIdentity & { identityKey: string };

type LegalIdentityRow = {
  loginDisabled: unknown;
  userName: unknown;
  username: unknown;
  activeEnterpriseMembershipCount: unknown;
  enterpriseId: unknown;
  memberStatus: unknown;
  enterpriseName: unknown;
  companyId: unknown;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nullableId(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveId(value);
}

function truthyDbBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function transactionRows(result: unknown): Record<string, unknown>[] {
  return rowsOf<Record<string, unknown>>(result);
}

function sameIdentity(
  left: Pick<BusinessIdentity, "enterpriseId" | "companyId">,
  right: Pick<BusinessIdentity, "enterpriseId" | "companyId">
): boolean {
  return (
    left.enterpriseId === right.enterpriseId &&
    left.companyId === right.companyId
  );
}

function partySnapshot(
  userId: number,
  identity: BusinessIdentity
): ConversationParty {
  return {
    userId,
    enterpriseId: identity.enterpriseId,
    companyId: identity.companyId,
    companyName: identity.companyName,
    displayName: identity.displayName,
  };
}

function storedParty(
  conversation: ConversationIdentityRow,
  side: 1 | 2
): ConversationParty | null {
  const userId = positiveId(conversation[`user${side}Id`]);
  const enterpriseId = nullableId(conversation[`user${side}EnterpriseId`]);
  const companyId = nullableId(conversation[`user${side}CompanyId`]);
  if (
    !userId ||
    (conversation[`user${side}EnterpriseId`] != null &&
      enterpriseId === null) ||
    (conversation[`user${side}CompanyId`] != null && companyId === null)
  )
    return null;
  return {
    userId,
    enterpriseId,
    companyId,
    companyName: null,
    displayName: `用户#${userId}`,
  };
}

function partyForUser(
  conversation: ConversationIdentityRow,
  userId: number
): ConversationParty | null {
  if (Number(conversation.user1Id) === userId)
    return storedParty(conversation, 1);
  if (Number(conversation.user2Id) === userId)
    return storedParty(conversation, 2);
  return null;
}

/**
 * The ordinary handler guard. It accepts a service conversation as a narrow
 * exception, but otherwise proves the actor's current identity against the
 * frozen actor-side tuple. No header can supply the tuple.
 */
type ScopedConversationOptions = Readonly<{
  forUpdate?: boolean;
  write?: boolean;
  allowPreactivationLegacyWrite?: boolean;
}>;

/**
 * The ordinary handler guard. It accepts a service conversation as a narrow
 * exception, but otherwise proves the actor's current identity against the
 * frozen actor-side tuple. No header can supply the tuple.
 */
export async function requireScopedConversation(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationId: number,
  options: ScopedConversationOptions = {}
): Promise<{
  conversation: ConversationIdentityRow;
  identity: BusinessIdentity;
  otherUserId: number;
  legacyWriteCompatibility: boolean;
}> {
  const serviceUserId = await getServiceUserId();
  const requestedContext = getEnterpriseRequestContextForActor(actorUserId);
  const supportRows = rowsOf<
    ConversationIdentityRow & {
      actorName: unknown;
      actorUsername: unknown;
      actorLoginDisabled: unknown;
    }
  >(
    await executor.execute(sql`
    SELECT c.id, c.user1Id, c.user2Id, c.user1EnterpriseId, c.user2EnterpriseId,
           c.user1CompanyId, c.user2CompanyId, c.identityContextKey,
           c.currentRound, c.endedAt, c.lastMessageAt, c.lastMessagePreview, c.createdAt,
           u.name AS actorName, u.username AS actorUsername, u.loginDisabled AS actorLoginDisabled
      FROM conversations c
      INNER JOIN users u ON u.id = ${actorUserId}
     WHERE c.id = ${conversationId}
       AND ((c.user1Id = ${actorUserId} AND c.user2Id = ${serviceUserId})
         OR (c.user2Id = ${actorUserId} AND c.user1Id = ${serviceUserId}))
     LIMIT 1 ${options.forUpdate ? sql`FOR UPDATE` : sql``}
  `)
  );
  const supportConversation = supportRows[0];
  if (supportConversation && requestedContext?.enterpriseId == null) {
    if (truthyDbBoolean(supportConversation.actorLoginDisabled)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
    }
    const name =
      typeof supportConversation.actorName === "string"
        ? supportConversation.actorName.trim()
        : "";
    const username =
      typeof supportConversation.actorUsername === "string"
        ? supportConversation.actorUsername.trim()
        : "";
    return {
      conversation: supportConversation,
      identity: {
        enterpriseId: null,
        companyId: null,
        companyName: null,
        displayName: name || username || `用户#${actorUserId}`,
      },
      otherUserId: serviceUserId,
      legacyWriteCompatibility: false,
    };
  }

  const identity = await resolveActorBusinessIdentity(executor, actorUserId);
  const rows = rowsOf<ConversationIdentityRow>(
    await executor.execute(sql`
    SELECT id, user1Id, user2Id, user1EnterpriseId, user2EnterpriseId,
           user1CompanyId, user2CompanyId, identityContextKey,
           currentRound, endedAt, lastMessageAt, lastMessagePreview, createdAt
      FROM conversations
     WHERE id = ${conversationId}
       AND (user1Id = ${actorUserId} OR user2Id = ${actorUserId})
       AND (${conversationIdentityScopeSql("conversations", actorUserId, identity)}
            OR (user1Id = ${actorUserId} AND user2Id = ${serviceUserId})
            OR (user2Id = ${actorUserId} AND user1Id = ${serviceUserId}))
     LIMIT 1 ${options.forUpdate ? sql`FOR UPDATE` : sql``}
  `)
  );
  const conversation = rows[0];
  if (!conversation)
    throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
  const otherUserId =
    Number(conversation.user1Id) === actorUserId
      ? Number(conversation.user2Id)
      : Number(conversation.user1Id);
  const legacy =
    conversation.identityContextKey === "legacy" ||
    conversation.identityContextKey == null;
  const official =
    Number(conversation.user1Id) === serviceUserId ||
    Number(conversation.user2Id) === serviceUserId;
  let legacyWriteCompatibility = false;
  if (options.write && legacy && !official) {
    if (identity.enterpriseId !== null) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前企业身份不能写入未绑定的历史会话",
      });
    }
    if (isLegacyChatPreactivationCompatibilityEnabled()) {
      legacyWriteCompatibility =
        Boolean(options.allowPreactivationLegacyWrite) &&
        (await canWriteLegacyDirectConversationPreactivation(
          executor,
          actorUserId,
          otherUserId
        ));
    }
    if (
      isLegacyChatPreactivationCompatibilityEnabled() &&
      !legacyWriteCompatibility
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "历史个人会话只读，请从当前企业身份重新发起会话",
      });
    }
  }
  return { conversation, identity, otherUserId, legacyWriteCompatibility };
}

export async function requireConversationContact(
  executor: ChatSqlExecutor,
  viewerUserId: number,
  conversationId: number,
  contactUserId: number,
  options: Readonly<{ forUpdate?: boolean; write?: boolean }> = {}
): Promise<void> {
  if (viewerUserId === contactUserId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "联系人不能是当前用户",
    });
  }
  const scoped = await requireScopedConversation(
    executor,
    viewerUserId,
    conversationId,
    options
  );
  if (scoped.otherUserId !== contactUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该联系人" });
  }
}

export type FormalConversationScope =
  | { kind: "not-participant" }
  | { kind: "disabled" }
  | { kind: "account" }
  | {
      kind: "ready";
      enterpriseId: number;
      companyId: number;
      identityKey: string;
    }
  | { kind: "unsupported"; reason: string };

async function transitionRowsForConversation(
  executor: ChatSqlExecutor,
  conversationId: number
): Promise<TransitionRow[]> {
  return rowsOf<TransitionRow>(
    await executor.execute(sql`
    SELECT t.id, t.legacyConversationId, t.pendingConversationId, t.finalConversationId,
           t.initiatorUserId, t.initiatorIdentityKey, t.initiatorEnterpriseId, t.initiatorCompanyId,
           t.recipientUserId, t.recipientConfirmedIdentityKey,
           t.recipientConfirmedEnterpriseId, t.recipientConfirmedCompanyId, t.status
      FROM chat_conversation_identity_transitions t
     WHERE t.legacyConversationId = ${conversationId}
        OR t.pendingConversationId = ${conversationId}
        OR t.finalConversationId = ${conversationId}
     ORDER BY t.id ASC
  `)
  );
}

function transitionTouchesAlias(
  row: TransitionRow,
  conversationId: number
): boolean {
  return (
    Number(row.legacyConversationId) === conversationId ||
    Number(row.pendingConversationId) === conversationId
  );
}

function lockedFinalFrozenTupleMatches(
  conversation: ConversationIdentityRow,
  row: TransitionRow
): boolean {
  const initiatorUserId = positiveId(row.initiatorUserId);
  const recipientUserId = positiveId(row.recipientUserId);
  if (
    !initiatorUserId ||
    !recipientUserId ||
    initiatorUserId === recipientUserId
  )
    return false;
  const initiator = partyForUser(conversation, initiatorUserId);
  const recipient = partyForUser(conversation, recipientUserId);
  if (!initiator || !recipient) return false;
  const initiatorIdentity = {
    enterpriseId: nullableId(row.initiatorEnterpriseId),
    companyId: nullableId(row.initiatorCompanyId),
  };
  const recipientIdentity = {
    enterpriseId: nullableId(row.recipientConfirmedEnterpriseId),
    companyId: nullableId(row.recipientConfirmedCompanyId),
  };
  if (
    (row.initiatorEnterpriseId != null &&
      initiatorIdentity.enterpriseId === null) ||
    (row.initiatorCompanyId != null && initiatorIdentity.companyId === null) ||
    (row.recipientConfirmedEnterpriseId != null &&
      recipientIdentity.enterpriseId === null) ||
    (row.recipientConfirmedCompanyId != null &&
      recipientIdentity.companyId === null)
  )
    return false;
  return (
    initiator.enterpriseId === initiatorIdentity.enterpriseId &&
    initiator.companyId === initiatorIdentity.companyId &&
    recipient.enterpriseId === recipientIdentity.enterpriseId &&
    recipient.companyId === recipientIdentity.companyId &&
    row.initiatorIdentityKey ===
      actorIdentityContextKey(initiatorUserId, initiatorIdentity) &&
    row.recipientConfirmedIdentityKey ===
      actorIdentityContextKey(recipientUserId, recipientIdentity)
  );
}

/** Read-only entry proof. It deliberately discovers the service account by SELECT, never by a mutable helper. */
export async function resolveFormalConversationScope(
  executor: ChatSqlExecutor,
  actorUserId: number,
  requestedConversationId: number
): Promise<FormalConversationScope> {
  const actorId = positiveId(actorUserId);
  const conversationId = positiveId(requestedConversationId);
  if (!actorId || !conversationId)
    return { kind: "unsupported", reason: "invalid-request" };
  const rows = rowsOf<
    ConversationIdentityRow & {
      actorLoginDisabled: unknown;
      accountConversation: unknown;
    }
  >(
    await executor.execute(sql`
    SELECT c.id, c.user1Id, c.user2Id, c.user1EnterpriseId, c.user2EnterpriseId,
           c.user1CompanyId, c.user2CompanyId, c.identityContextKey,
           actor.loginDisabled AS actorLoginDisabled,
           CASE WHEN service.id IS NOT NULL AND (c.user1Id = service.id OR c.user2Id = service.id)
                THEN 1 ELSE 0 END AS accountConversation
      FROM conversations c
      INNER JOIN users actor ON actor.id = ${actorId}
      LEFT JOIN users service ON service.username = 'service_51dianzi'
     WHERE c.id = ${conversationId}
       AND (c.user1Id = ${actorId} OR c.user2Id = ${actorId})
     LIMIT 1
  `)
  );
  const conversation = rows[0];
  if (!conversation) return { kind: "not-participant" };
  if (truthyDbBoolean(conversation.actorLoginDisabled))
    return { kind: "disabled" };
  if (truthyDbBoolean(conversation.accountConversation))
    return { kind: "account" };

  const transitions = await transitionRowsForConversation(
    executor,
    conversationId
  );
  if (transitions.length) {
    if (
      transitions.some(
        row =>
          Number(row.initiatorUserId) !== actorId &&
          Number(row.recipientUserId) !== actorId
      )
    ) {
      return { kind: "unsupported", reason: "transition-not-owned" };
    }
    if (transitions.some(row => transitionTouchesAlias(row, conversationId))) {
      return { kind: "unsupported", reason: "original-identity-flow-required" };
    }
    if (
      transitions.some(
        row =>
          row.status !== "locked" ||
          Number(row.finalConversationId) !== conversationId
      )
    ) {
      return { kind: "unsupported", reason: "original-identity-flow-required" };
    }
  }
  if (
    conversation.identityContextKey === "legacy" ||
    conversation.identityContextKey == null
  ) {
    return {
      kind: "unsupported",
      reason: transitions.length
        ? "locked-final-freeze-mismatch"
        : "original-identity-flow-required",
    };
  }

  const first = storedParty(conversation, 1);
  const second = storedParty(conversation, 2);
  const actorParty = partyForUser(conversation, actorId);
  if (!first || !second || !actorParty || first.userId === second.userId) {
    return { kind: "unsupported", reason: "frozen-tuple-invalid" };
  }
  const expectedIdentityKey = conversationIdentityContextKey(first, second);
  if (conversation.identityContextKey !== expectedIdentityKey) {
    return { kind: "unsupported", reason: "frozen-identity-key-mismatch" };
  }
  if (
    transitions.length &&
    transitions.some(row => !lockedFinalFrozenTupleMatches(conversation, row))
  ) {
    return { kind: "unsupported", reason: "locked-final-freeze-mismatch" };
  }
  if (!actorParty.enterpriseId || !actorParty.companyId) {
    return { kind: "unsupported", reason: "original-identity-flow-required" };
  }

  let identity: BusinessIdentity;
  try {
    const existing = getEnterpriseRequestContextForActor(actorId);
    identity = await runWithEnterpriseRequestContext(
      {
        enterpriseId: actorParty.enterpriseId,
        applicationId: existing?.applicationId ?? null,
        newApplication: existing?.newApplication ?? false,
        actorUserId: actorId,
      },
      () => resolveActorBusinessIdentity(executor, actorId)
    );
  } catch {
    return { kind: "unsupported", reason: "current-identity-not-verified" };
  }
  if (!sameIdentity(identity, actorParty))
    return { kind: "unsupported", reason: "frozen-tuple-not-current" };
  const ownerRows = rowsOf<{ ownerLoginDisabled: unknown }>(
    await executor.execute(sql`
    SELECT owner.loginDisabled AS ownerLoginDisabled
      FROM enterprises e
      INNER JOIN users owner ON owner.id = e.crmDataOwnerUserId
     WHERE e.id = ${actorParty.enterpriseId}
     LIMIT 1
  `)
  );
  if (!ownerRows[0] || truthyDbBoolean(ownerRows[0].ownerLoginDisabled)) {
    return { kind: "unsupported", reason: "frozen-owner-disabled" };
  }
  const scopeRows = rowsOf<{ id: unknown }>(
    await executor.execute(sql`
    SELECT c.id FROM conversations c
     WHERE c.id = ${conversationId}
       AND c.identityContextKey = ${expectedIdentityKey}
       AND ${conversationIdentityScopeSql("c", actorId, identity)}
     LIMIT 1
  `)
  );
  if (!scopeRows[0])
    return { kind: "unsupported", reason: "original-scope-guard-denied" };
  return {
    kind: "ready",
    enterpriseId: actorParty.enterpriseId,
    companyId: actorParty.companyId,
    identityKey: expectedIdentityKey,
  };
}

export type ResolveEntryResult = Readonly<{
  userId: number;
  requestedConversationId: number;
  conversationId: number;
  scopeKey: string;
  status: "account" | "ready" | "unsupported";
  enterpriseId: number | null;
  companyId: number | null;
  reason?: string;
}>;

function entryResult(
  userId: number,
  conversationId: number,
  status: ResolveEntryResult["status"],
  enterpriseId: number | null,
  companyId: number | null,
  reason?: string
): ResolveEntryResult {
  return {
    userId,
    requestedConversationId: conversationId,
    conversationId,
    scopeKey: `${userId}:${status === "ready" ? (enterpriseId ?? 0) : 0}`,
    status,
    enterpriseId: status === "ready" ? enterpriseId : null,
    companyId: status === "ready" ? companyId : null,
    ...(reason ? { reason } : {}),
  };
}

export async function resolveChatEntry(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationId: number
): Promise<ResolveEntryResult> {
  const proof = await resolveFormalConversationScope(
    executor,
    actorUserId,
    conversationId
  );
  if (proof.kind === "not-participant")
    throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
  if (proof.kind === "disabled")
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  if (proof.kind === "account")
    return entryResult(actorUserId, conversationId, "account", null, null);
  if (proof.kind === "ready")
    return entryResult(
      actorUserId,
      conversationId,
      "ready",
      proof.enterpriseId,
      proof.companyId
    );
  return entryResult(
    actorUserId,
    conversationId,
    "unsupported",
    null,
    null,
    proof.reason
  );
}

export function isExactWeappWithoutExplicitScope(
  headers: Record<string, unknown> | undefined
): boolean {
  if (headers?.["x-51dianzi-client"] !== "weapp") return false;
  return (
    !Object.prototype.hasOwnProperty.call(
      headers,
      "x-51dianzi-enterprise-id"
    ) &&
    !Object.prototype.hasOwnProperty.call(
      headers,
      "x-51dianzi-application-id"
    ) &&
    !Object.prototype.hasOwnProperty.call(headers, "x-51dianzi-new-enterprise")
  );
}

export async function attachmentConversationForActor(
  executor: ChatSqlExecutor,
  actorUserId: number,
  attachmentId: unknown
): Promise<number | null> {
  const id = positiveId(attachmentId);
  if (!id) return null;
  const rows = rowsOf<{ conversationId: unknown }>(
    await executor.execute(sql`
    SELECT a.conversationId
      FROM chat_attachments a
      INNER JOIN conversations c ON c.id = a.conversationId
     WHERE a.id = ${id}
       AND (c.user1Id = ${actorUserId} OR c.user2Id = ${actorUserId})
     LIMIT 1
  `)
  );
  return positiveId(rows[0]?.conversationId);
}

/** Applies only a formally-proved frozen selection, retaining all other ALS fields. */
export async function runWithReadyWeappConversationScope<T>(
  input: Readonly<{
    executor: ChatSqlExecutor;
    actorUserId: number;
    conversationId: number | null;
    headers: Record<string, unknown> | undefined;
    action: () => T;
  }>
): Promise<T> {
  if (!isExactWeappWithoutExplicitScope(input.headers) || !input.conversationId)
    return input.action();
  const proof = await resolveFormalConversationScope(
    input.executor,
    input.actorUserId,
    input.conversationId
  );
  if (proof.kind !== "ready") return input.action();
  const originalScope = getEnterpriseRequestContextForActor(input.actorUserId);
  if (
    !originalScope ||
    originalScope.enterpriseId !== null ||
    originalScope.applicationId !== null ||
    originalScope.newApplication
  ) {
    return input.action();
  }
  return runWithEnterpriseRequestContext(
    {
      ...originalScope,
      actorUserId: input.actorUserId,
      enterpriseId: proof.enterpriseId,
    },
    input.action
  );
}

function transitionIdentityFromRow(
  userId: number,
  row: LegalIdentityRow
): TransitionIdentity | null {
  const enterpriseId = positiveId(row.enterpriseId);
  if (!enterpriseId || row.memberStatus !== "active") return null;
  const companyName =
    typeof row.enterpriseName === "string" ? row.enterpriseName.trim() : "";
  if (!companyName) return null;
  const identity: BusinessIdentity = {
    enterpriseId,
    companyId: positiveId(row.companyId),
    companyName,
    displayName: companyName,
  };
  return {
    ...identity,
    identityKey: actorIdentityContextKey(userId, identity),
  };
}

function transitionPersonalIdentity(
  userId: number,
  row: LegalIdentityRow
): TransitionIdentity {
  const name = typeof row.userName === "string" ? row.userName.trim() : "";
  const username = typeof row.username === "string" ? row.username.trim() : "";
  const identity: BusinessIdentity = {
    enterpriseId: null,
    companyId: null,
    companyName: null,
    displayName: name || username || `用户#${userId}`,
  };
  return {
    ...identity,
    identityKey: actorIdentityContextKey(userId, identity),
  };
}

function transitionIdentityOption(identity: TransitionIdentity): Readonly<{
  enterpriseId: number | null;
  companyId: number | null;
  companyName: string;
  label: string;
}> {
  return {
    enterpriseId: identity.enterpriseId,
    companyId: identity.companyId,
    companyName: identity.companyName || "",
    label:
      identity.enterpriseId === null
        ? "个人身份"
        : identity.companyName || identity.displayName,
  };
}

async function chatTransitionListLegalIdentities(
  executor: ChatSqlExecutor,
  userId: number
): Promise<TransitionIdentity[]> {
  const rows = rowsOf<LegalIdentityRow>(
    await executor.execute(sql`
    SELECT u.loginDisabled, u.name AS userName, u.username AS username,
           (SELECT COUNT(*) FROM enterprise_members active_member
             WHERE active_member.userId = u.id AND active_member.status = 'active') AS activeEnterpriseMembershipCount,
           em.enterpriseId, em.status AS memberStatus, e.companyName AS enterpriseName,
           (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(c.id) ELSE NULL END FROM companies c
             WHERE c.enterpriseId = em.enterpriseId AND c.userId = e.crmDataOwnerUserId) AS companyId
      FROM users u
      LEFT JOIN enterprise_members em ON em.userId = u.id AND em.status = 'active'
      LEFT JOIN enterprises e ON e.id = em.enterpriseId
     WHERE u.id = ${userId}
     ORDER BY em.enterpriseId ASC
  `)
  );
  if (!rows.length)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "登录账号不存在" });
  if (truthyDbBoolean(rows[0].loginDisabled))
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  const identities = rows.flatMap(row => {
    const identity = transitionIdentityFromRow(userId, row);
    return identity ? [identity] : [];
  });
  if (Number(rows[0].activeEnterpriseMembershipCount ?? 0) > 0) {
    if (!identities.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: "企业身份资料异常，暂不能确认会话身份",
      });
    return identities;
  }
  return [transitionPersonalIdentity(userId, rows[0])];
}

async function chatTransitionResolveSelectedIdentity(
  executor: ChatSqlExecutor,
  userId: number,
  enterpriseId: number | null
): Promise<{ selected: TransitionIdentity; identities: TransitionIdentity[] }> {
  const identities = await chatTransitionListLegalIdentities(executor, userId);
  const selected = identities.find(
    identity => identity.enterpriseId === enterpriseId
  );
  if (!selected)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只能确认本人当前合法的企业身份",
    });
  return { selected, identities };
}

function transitionRowIdentity(
  row: TransitionRow,
  side: "initiator" | "recipient"
): TransitionIdentity | null {
  const enterpriseId =
    side === "initiator"
      ? row.initiatorEnterpriseId
      : row.recipientConfirmedEnterpriseId;
  const companyId =
    side === "initiator"
      ? row.initiatorCompanyId
      : row.recipientConfirmedCompanyId;
  const companyName =
    side === "initiator"
      ? row.initiatorCompanyName
      : row.recipientConfirmedCompanyName;
  const identityKey =
    side === "initiator"
      ? row.initiatorIdentityKey
      : row.recipientConfirmedIdentityKey;
  if (typeof identityKey !== "string" || !identityKey) return null;
  const normalizedEnterpriseId = nullableId(enterpriseId);
  const normalizedCompanyId = nullableId(companyId);
  if (
    (enterpriseId != null && normalizedEnterpriseId === null) ||
    (companyId != null && normalizedCompanyId === null)
  )
    return null;
  const normalizedCompanyName =
    typeof companyName === "string" && companyName.trim()
      ? companyName.trim()
      : null;
  return {
    enterpriseId: normalizedEnterpriseId,
    companyId: normalizedCompanyId,
    companyName: normalizedCompanyName,
    displayName:
      normalizedCompanyName ||
      (normalizedEnterpriseId === null ? "个人身份" : "企业身份"),
    identityKey,
  };
}

function chatTransitionOtherUserId(row: TransitionRow, userId: number): number {
  const initiatorUserId = positiveId(row.initiatorUserId);
  const recipientUserId = positiveId(row.recipientUserId);
  if (initiatorUserId === userId && recipientUserId) return recipientUserId;
  if (recipientUserId === userId && initiatorUserId) return initiatorUserId;
  throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该身份过渡" });
}

function chatTransitionAssertId(value: unknown, field: string): number {
  const id = positiveId(value);
  if (!id)
    throw new TRPCError({ code: "CONFLICT", message: `身份过渡${field}异常` });
  return id;
}

type LegacyConversationOptions = Readonly<{
  forUpdate?: boolean;
  requireVisible?: boolean;
}>;

async function chatTransitionRequireLegacyConversation(
  executor: ChatSqlExecutor,
  actorUserId: number,
  legacyConversationId: number,
  serviceUserId: number,
  options: LegacyConversationOptions = {}
): Promise<ConversationIdentityRow> {
  const rows = rowsOf<ConversationIdentityRow & { deleted: unknown }>(
    await executor.execute(sql`
    SELECT c.id, c.user1Id, c.user2Id, c.identityContextKey, mine.deleted
      FROM conversations c
      ${
        options.requireVisible
          ? sql`INNER JOIN conversation_user_settings mine
        ON mine.conversationId = c.id AND mine.userId = ${actorUserId}`
          : sql`LEFT JOIN conversation_user_settings mine
        ON mine.conversationId = c.id AND mine.userId = ${actorUserId}`
      }
     WHERE c.id = ${legacyConversationId}
       AND (c.user1Id = ${actorUserId} OR c.user2Id = ${actorUserId})
       AND (c.identityContextKey = 'legacy' OR c.identityContextKey IS NULL)
       AND c.user1Id <> ${serviceUserId}
       AND c.user2Id <> ${serviceUserId}
       ${options.requireVisible ? sql`AND mine.deleted = 0` : sql``}
     LIMIT 1 ${options.forUpdate ? sql`FOR UPDATE` : sql``}
  `)
  );
  const conversation = rows[0];
  if (!conversation)
    throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该历史会话" });
  return conversation;
}

export async function chatTransitionFindForConversation(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationId: number,
  transitionId?: number,
  forUpdate = false
): Promise<TransitionRow | null> {
  const rows = rowsOf<TransitionRow>(
    await executor.execute(sql`
    SELECT id, legacyConversationId,
           initiatorUserId, initiatorIdentityKey, initiatorEnterpriseId, initiatorCompanyId, initiatorCompanyName,
           recipientUserId, recipientConfirmedIdentityKey, recipientConfirmedEnterpriseId,
           recipientConfirmedCompanyId, recipientConfirmedCompanyName,
           pendingConversationId, finalConversationId, status
      FROM chat_conversation_identity_transitions
     WHERE (${transitionId == null ? sql`TRUE` : sql`id = ${transitionId}`})
       AND (legacyConversationId = ${conversationId}
         OR pendingConversationId = ${conversationId}
         OR finalConversationId = ${conversationId})
       AND (initiatorUserId = ${actorUserId} OR recipientUserId = ${actorUserId})
     ORDER BY CASE WHEN pendingConversationId = ${conversationId} THEN 0
                   WHEN finalConversationId = ${conversationId} THEN 1 ELSE 2 END, id DESC
     LIMIT 2 ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)
  );
  if (transitionId != null && !rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "身份过渡已失效或不属于当前会话",
    });
  }
  if (transitionId != null) return rows[0] ?? null;
  const direct = rows.filter(
    row =>
      Number(row.pendingConversationId) === conversationId ||
      Number(row.finalConversationId ?? 0) === conversationId
  );
  return direct.length === 1 ? direct[0] : null;
}

export async function chatTransitionFindStateCandidate(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationId: number,
  currentIdentity: Pick<BusinessIdentity, "enterpriseId" | "companyId">
): Promise<TransitionRow | null> {
  const currentIdentityKey = actorIdentityContextKey(
    actorUserId,
    currentIdentity
  );
  const rows = rowsOf<TransitionRow>(
    await executor.execute(sql`
    SELECT id, legacyConversationId,
           initiatorUserId, initiatorIdentityKey, initiatorEnterpriseId, initiatorCompanyId, initiatorCompanyName,
           recipientUserId, recipientConfirmedIdentityKey, recipientConfirmedEnterpriseId,
           recipientConfirmedCompanyId, recipientConfirmedCompanyName,
           pendingConversationId, finalConversationId, status
      FROM chat_conversation_identity_transitions
     WHERE (legacyConversationId = ${conversationId}
         OR pendingConversationId = ${conversationId}
         OR finalConversationId = ${conversationId})
       AND (initiatorUserId = ${actorUserId} OR recipientUserId = ${actorUserId})
     ORDER BY id ASC
  `)
  );
  const direct = rows.filter(
    row =>
      Number(row.pendingConversationId) === conversationId ||
      Number(row.finalConversationId ?? 0) === conversationId
  );
  if (direct.length > 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "该身份会话有多个历史映射，请使用对应过渡标识",
    });
  }
  if (direct[0]) return direct[0];
  const own = rows.filter(
    row =>
      Number(row.initiatorUserId) === actorUserId &&
      row.initiatorIdentityKey === currentIdentityKey
  );
  if (own.length > 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "当前身份有多个过渡记录，请使用对应过渡标识",
    });
  }
  if (own[0]) return own[0];
  const inbound = rows.filter(
    row =>
      Number(row.recipientUserId) === actorUserId &&
      row.status === "pending" &&
      row.recipientConfirmedIdentityKey == null
  );
  if (inbound.length > 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "有多个待确认身份，请从对应待确认会话继续",
    });
  }
  return inbound[0] ?? null;
}

export type ChatTransitionState = Readonly<{
  legacyConversationId: number;
  transitionId: number | null;
  writeConversationId: number | null;
  state: "unconfirmed" | "pending" | "locked";
  requiresIdentityConfirmation: boolean;
  identities: ReadonlyArray<
    Readonly<{
      enterpriseId: number | null;
      companyId: number | null;
      companyName: string;
      label: string;
    }>
  >;
  myIdentity: Readonly<{
    enterpriseId: number | null;
    companyId: number | null;
    label: string;
  }> | null;
  otherConfirmed: boolean;
}>;

function chatTransitionStateDto(
  actorUserId: number,
  legacyConversationId: number,
  identities: TransitionIdentity[],
  row: TransitionRow | null
): ChatTransitionState {
  if (!row) {
    return {
      legacyConversationId,
      transitionId: null,
      writeConversationId: null,
      state: "unconfirmed",
      requiresIdentityConfirmation: true,
      identities: identities.map(transitionIdentityOption),
      myIdentity: null,
      otherConfirmed: false,
    };
  }
  const initiator = Number(row.initiatorUserId) === actorUserId;
  const mine = transitionRowIdentity(
    row,
    initiator ? "initiator" : "recipient"
  );
  const locked =
    row.status === "locked" && positiveId(row.finalConversationId) !== null;
  return {
    legacyConversationId: chatTransitionAssertId(
      row.legacyConversationId,
      "历史会话"
    ),
    transitionId: chatTransitionAssertId(row.id, "记录"),
    writeConversationId: locked
      ? chatTransitionAssertId(row.finalConversationId, "正式会话")
      : chatTransitionAssertId(row.pendingConversationId, "待确认会话"),
    state: locked ? "locked" : "pending",
    requiresIdentityConfirmation: !mine,
    identities: identities.map(transitionIdentityOption),
    myIdentity: mine
      ? {
          enterpriseId: mine.enterpriseId,
          companyId: mine.companyId,
          label:
            mine.enterpriseId === null
              ? "个人身份"
              : mine.companyName || mine.displayName,
        }
      : null,
    otherConfirmed: initiator
      ? Boolean(row.recipientConfirmedIdentityKey)
      : Boolean(row.initiatorIdentityKey),
  };
}

export async function chatTransitionGetState(
  executor: ChatSqlExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    transitionId?: number;
    currentIdentity: BusinessIdentity;
    serviceUserId: number;
  }>
): Promise<ChatTransitionState> {
  const identities = await chatTransitionListLegalIdentities(
    executor,
    input.actorUserId
  );
  const row =
    input.transitionId == null
      ? await chatTransitionFindStateCandidate(
          executor,
          input.actorUserId,
          input.conversationId,
          input.currentIdentity
        )
      : await chatTransitionFindForConversation(
          executor,
          input.actorUserId,
          input.conversationId,
          input.transitionId
        );
  const legacyConversationId = row
    ? chatTransitionAssertId(row.legacyConversationId, "历史会话")
    : input.conversationId;
  await chatTransitionRequireLegacyConversation(
    executor,
    input.actorUserId,
    legacyConversationId,
    input.serviceUserId,
    { requireVisible: !row }
  );
  return chatTransitionStateDto(
    input.actorUserId,
    legacyConversationId,
    identities,
    row
  );
}

async function chatTransitionAssertNotBlocked(
  executor: ChatSqlExecutor,
  leftUserId: number,
  rightUserId: number
): Promise<void> {
  const rows = transactionRows(
    await executor.execute(sql`
    SELECT blockerUserId FROM chat_user_blocks
     WHERE (blockerUserId = ${leftUserId} AND blockedUserId = ${rightUserId})
        OR (blockerUserId = ${rightUserId} AND blockedUserId = ${leftUserId})
     LIMIT 1
  `)
  );
  if (rows.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该会话已被屏蔽，不能确认身份",
    });
}

async function chatTransitionRevalidateFrozenIdentity(
  executor: ChatSqlExecutor,
  userId: number,
  frozen: TransitionIdentity
): Promise<void> {
  const { selected } = await chatTransitionResolveSelectedIdentity(
    executor,
    userId,
    frozen.enterpriseId
  );
  if (selected.identityKey !== frozen.identityKey) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "已确认企业身份已变化，请重新发起会话",
    });
  }
}

function affectedRows(result: unknown): number {
  const first = Array.isArray(result) ? result[0] : null;
  if (!first || typeof first !== "object") return 0;
  const value = (first as Record<string, unknown>).affectedRows;
  const affected = Number(value);
  return Number.isSafeInteger(affected) && affected >= 0 ? affected : 0;
}

export async function chatTransitionConfirmIdentity(
  executor: TransactionExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    enterpriseId: number | null;
    transitionId?: number;
    serviceUserId: number;
  }>
): Promise<ChatTransitionState> {
  const { selected, identities } = await chatTransitionResolveSelectedIdentity(
    executor,
    input.actorUserId,
    input.enterpriseId
  );
  const supplied = await chatTransitionFindForConversation(
    executor,
    input.actorUserId,
    input.conversationId,
    input.transitionId
  );
  const legacyConversationId = supplied
    ? chatTransitionAssertId(supplied.legacyConversationId, "历史会话")
    : input.conversationId;
  const legacy = await chatTransitionRequireLegacyConversation(
    executor,
    input.actorUserId,
    legacyConversationId,
    input.serviceUserId,
    { forUpdate: true, requireVisible: !supplied }
  );
  const firstUserId = chatTransitionAssertId(legacy.user1Id, "历史参与人");
  const secondUserId = chatTransitionAssertId(legacy.user2Id, "历史参与人");
  const initiatorUserId =
    firstUserId === input.actorUserId ? input.actorUserId : secondUserId;
  const recipientUserId =
    firstUserId === input.actorUserId ? secondUserId : firstUserId;
  await chatTransitionAssertNotBlocked(
    executor,
    initiatorUserId,
    recipientUserId
  );
  const rows = rowsOf<TransitionRow>(
    await executor.execute(sql`
    SELECT id, legacyConversationId,
           initiatorUserId, initiatorIdentityKey, initiatorEnterpriseId, initiatorCompanyId, initiatorCompanyName,
           recipientUserId, recipientConfirmedIdentityKey, recipientConfirmedEnterpriseId,
           recipientConfirmedCompanyId, recipientConfirmedCompanyName,
           pendingConversationId, finalConversationId, status
      FROM chat_conversation_identity_transitions
     WHERE legacyConversationId = ${legacyConversationId}
       AND (initiatorUserId = ${input.actorUserId} OR recipientUserId = ${input.actorUserId})
     ORDER BY id ASC FOR UPDATE
  `)
  );
  const existing = supplied
    ? rows.find(row => Number(row.id) === Number(supplied.id))
    : undefined;
  if (input.transitionId != null && !existing) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "身份过渡已失效或不属于当前会话",
    });
  }
  const own = rows.find(
    row =>
      Number(row.initiatorUserId) === input.actorUserId &&
      row.initiatorIdentityKey === selected.identityKey
  );
  if (own) {
    if (
      input.transitionId != null &&
      Number(input.transitionId) !== Number(own.id)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "确认请求已指向另一身份过渡",
      });
    }
    return chatTransitionStateDto(
      input.actorUserId,
      legacyConversationId,
      identities,
      own
    );
  }
  const inboundCandidates = rows.filter(
    row =>
      Number(row.recipientUserId) === input.actorUserId &&
      row.status === "pending" &&
      row.recipientConfirmedIdentityKey == null
  );
  if (!existing && inboundCandidates.length > 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "有多个待确认身份，请从对应待确认会话继续",
    });
  }
  const inbound =
    existing && Number(existing.recipientUserId) === input.actorUserId
      ? existing
      : inboundCandidates[0];
  if (inbound) {
    if (
      input.transitionId != null &&
      Number(input.transitionId) !== Number(inbound.id)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "确认请求已指向另一身份过渡",
      });
    }
    const alreadyConfirmed = transitionRowIdentity(inbound, "recipient");
    if (alreadyConfirmed) {
      if (alreadyConfirmed.identityKey !== selected.identityKey) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "对方身份已固定，不能改为另一企业",
        });
      }
      return chatTransitionStateDto(
        input.actorUserId,
        legacyConversationId,
        identities,
        inbound
      );
    }
    const frozenInitiator = transitionRowIdentity(inbound, "initiator");
    if (!frozenInitiator)
      throw new TRPCError({ code: "CONFLICT", message: "发起方身份异常" });
    await chatTransitionRevalidateFrozenIdentity(
      executor,
      chatTransitionAssertId(inbound.initiatorUserId, "发起方"),
      frozenInitiator
    );
    await chatTransitionRevalidateFrozenIdentity(
      executor,
      input.actorUserId,
      selected
    );
    const inboundRecipientUserId = chatTransitionAssertId(
      inbound.recipientUserId,
      "接收方"
    );
    orderedConversationParties(
      partySnapshot(
        chatTransitionAssertId(inbound.initiatorUserId, "发起方"),
        frozenInitiator
      ),
      partySnapshot(inboundRecipientUserId, selected)
    );
    const finalConversationId = await getOrCreateBusinessConversation(
      executor,
      partySnapshot(
        chatTransitionAssertId(inbound.initiatorUserId, "发起方"),
        frozenInitiator
      ),
      partySnapshot(inboundRecipientUserId, selected)
    );
    const update = await executor.execute(sql`
      UPDATE chat_conversation_identity_transitions
         SET recipientConfirmedIdentityKey = ${selected.identityKey},
             recipientConfirmedEnterpriseId = ${selected.enterpriseId},
             recipientConfirmedCompanyId = ${selected.companyId},
             recipientConfirmedCompanyName = ${selected.companyName},
             finalConversationId = ${finalConversationId},
             status = 'locked',
             updatedAt = NOW()
       WHERE id = ${inbound.id}
         AND status = 'pending'
         AND recipientConfirmedIdentityKey IS NULL
    `);
    if (affectedRows(update) !== 1) {
      const reloaded =
        rowsOf<TransitionRow>(
          await executor.execute(sql`
        SELECT id, legacyConversationId,
               initiatorUserId, initiatorIdentityKey, initiatorEnterpriseId, initiatorCompanyId, initiatorCompanyName,
               recipientUserId, recipientConfirmedIdentityKey, recipientConfirmedEnterpriseId,
               recipientConfirmedCompanyId, recipientConfirmedCompanyName,
               pendingConversationId, finalConversationId, status
          FROM chat_conversation_identity_transitions
         WHERE id = ${inbound.id}
         LIMIT 1 FOR UPDATE
      `)
        )[0] ?? null;
      const lockedRecipient = reloaded
        ? transitionRowIdentity(reloaded, "recipient")
        : null;
      if (
        !reloaded ||
        !lockedRecipient ||
        lockedRecipient.identityKey !== selected.identityKey
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "对方身份已由另一请求确认",
        });
      }
      return chatTransitionStateDto(
        input.actorUserId,
        legacyConversationId,
        identities,
        reloaded
      );
    }
    return chatTransitionStateDto(
      input.actorUserId,
      legacyConversationId,
      identities,
      {
        ...inbound,
        recipientConfirmedIdentityKey: selected.identityKey,
        recipientConfirmedEnterpriseId: selected.enterpriseId,
        recipientConfirmedCompanyId: selected.companyId,
        recipientConfirmedCompanyName: selected.companyName,
        finalConversationId,
        status: "locked",
      }
    );
  }
  if (input.transitionId != null) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "确认请求已过期，请刷新后重试",
    });
  }
  const pendingContextKey = `pending:v1:${randomUUID()}`;
  await executor.execute(sql`
    INSERT INTO conversations
      (user1Id, user2Id,
       user1EnterpriseId, user2EnterpriseId, user1CompanyId, user2CompanyId,
       user1CompanyNameSnapshot, user2CompanyNameSnapshot, identityContextKey, lastMessagePreview)
    VALUES
      (${initiatorUserId}, ${recipientUserId}, NULL, NULL, NULL, NULL, NULL, NULL, ${pendingContextKey}, '')
  `);
  const pendingConversationId = chatTransitionAssertId(
    rowsOf<{ id: unknown }>(
      await executor.execute(sql`SELECT LAST_INSERT_ID() AS id`)
    )[0]?.id,
    "待确认会话"
  );
  await executor.execute(sql`
    INSERT INTO conversation_user_settings (conversationId, userId, deleted)
    VALUES (${pendingConversationId}, ${initiatorUserId}, 0), (${pendingConversationId}, ${recipientUserId}, 0)
  `);
  await executor.execute(sql`
    INSERT INTO chat_conversation_identity_transitions
      (legacyConversationId,
       initiatorUserId, initiatorIdentityKey, initiatorEnterpriseId, initiatorCompanyId, initiatorCompanyName,
       recipientUserId, pendingConversationId, status)
    VALUES
      (${legacyConversationId},
       ${initiatorUserId}, ${selected.identityKey}, ${selected.enterpriseId}, ${selected.companyId}, ${selected.companyName},
       ${recipientUserId}, ${pendingConversationId}, 'pending')
  `);
  const transitionId = chatTransitionAssertId(
    rowsOf<{ id: unknown }>(
      await executor.execute(sql`SELECT LAST_INSERT_ID() AS id`)
    )[0]?.id,
    "记录"
  );
  return chatTransitionStateDto(
    input.actorUserId,
    legacyConversationId,
    identities,
    {
      id: transitionId,
      legacyConversationId,
      initiatorUserId,
      initiatorIdentityKey: selected.identityKey,
      initiatorEnterpriseId: selected.enterpriseId,
      initiatorCompanyId: selected.companyId,
      initiatorCompanyName: selected.companyName,
      recipientUserId,
      recipientConfirmedIdentityKey: null,
      recipientConfirmedEnterpriseId: null,
      recipientConfirmedCompanyId: null,
      recipientConfirmedCompanyName: null,
      pendingConversationId,
      finalConversationId: null,
      status: "pending",
    }
  );
}

function chatTransitionCurrentIdentityMatches(
  current: Pick<BusinessIdentity, "enterpriseId" | "companyId">,
  frozen: Pick<TransitionIdentity, "enterpriseId" | "companyId">
): boolean {
  return (
    current.enterpriseId === frozen.enterpriseId &&
    current.companyId === frozen.companyId
  );
}

async function chatTransitionResolveMapped(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationId: number,
  serviceUserId: number
): Promise<TransitionRow | null> {
  const row = await chatTransitionFindForConversation(
    executor,
    actorUserId,
    conversationId
  );
  if (!row) return null;
  await chatTransitionRequireLegacyConversation(
    executor,
    actorUserId,
    chatTransitionAssertId(row.legacyConversationId, "历史会话"),
    serviceUserId
  );
  return row;
}

export type ChatTransitionReadResolution = Readonly<{
  transition: TransitionRow;
  legacyConversationId: number;
  otherUserId: number;
  canonicalConversationId: number;
  sourceConversationIds: number[];
}>;

export async function chatTransitionResolveRead(
  executor: ChatSqlExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    currentIdentity: BusinessIdentity;
    serviceUserId: number;
  }>
): Promise<ChatTransitionReadResolution | null> {
  const row = await chatTransitionResolveMapped(
    executor,
    input.actorUserId,
    input.conversationId,
    input.serviceUserId
  );
  if (!row) return null;
  const initiator = Number(row.initiatorUserId) === input.actorUserId;
  const mine = transitionRowIdentity(
    row,
    initiator ? "initiator" : "recipient"
  );
  if (row.status === "locked" || initiator) {
    if (
      !mine ||
      !chatTransitionCurrentIdentityMatches(input.currentIdentity, mine)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前企业身份不是该过渡会话的已确认身份",
      });
    }
  }
  const finalConversationId = positiveId(row.finalConversationId);
  const legacyConversationId = chatTransitionAssertId(
    row.legacyConversationId,
    "历史会话"
  );
  const pendingConversationId = chatTransitionAssertId(
    row.pendingConversationId,
    "待确认会话"
  );
  return {
    transition: row,
    legacyConversationId,
    otherUserId: chatTransitionOtherUserId(row, input.actorUserId),
    canonicalConversationId: finalConversationId ?? pendingConversationId,
    sourceConversationIds: [
      legacyConversationId,
      pendingConversationId,
      ...(finalConversationId === null ? [] : [finalConversationId]),
    ],
  };
}

export type ChatTransitionWriteResolution = Readonly<
  ChatTransitionReadResolution & {
    messageIdentity: TransitionIdentity;
    messageSourceConversationIds: number[];
  }
>;

export async function chatTransitionResolveWrite(
  executor: ChatSqlExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    currentIdentity: BusinessIdentity;
    serviceUserId: number;
  }>
): Promise<ChatTransitionWriteResolution | null> {
  const read = await chatTransitionResolveRead(executor, input);
  if (!read) return null;
  const initiator =
    Number(read.transition.initiatorUserId) === input.actorUserId;
  const mine = transitionRowIdentity(
    read.transition,
    initiator ? "initiator" : "recipient"
  );
  if (!mine) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先确认自己的企业身份后再发送",
    });
  }
  if (!chatTransitionCurrentIdentityMatches(input.currentIdentity, mine)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前企业身份不是该过渡会话的已确认身份",
    });
  }
  if (read.transition.status !== "locked" && !initiator) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先确认自己的企业身份后再回复",
    });
  }
  const finalConversationId = positiveId(read.transition.finalConversationId);
  const pendingConversationId = chatTransitionAssertId(
    read.transition.pendingConversationId,
    "待确认会话"
  );
  return {
    ...read,
    canonicalConversationId: finalConversationId ?? pendingConversationId,
    messageIdentity: mine,
    messageSourceConversationIds: [
      pendingConversationId,
      ...(finalConversationId === null ? [] : [finalConversationId]),
    ],
  };
}

export function chatTransitionPendingListScopeSql(
  conversationAlias: string,
  actorUserId: number,
  identity: Pick<BusinessIdentity, "enterpriseId" | "companyId">
) {
  const identityKey = actorIdentityContextKey(actorUserId, identity);
  return activePendingTransitionScopeSql(
    conversationAlias,
    actorUserId,
    identityKey
  );
}

function chatTransitionConversationIdsSql(ids: readonly number[]) {
  const normalized = Array.from(
    new Set(
      ids
        .map(value => Number(value))
        .filter(value => Number.isSafeInteger(value) && value > 0)
    )
  );
  if (!normalized.length)
    throw new Error("chat transition conversation IDs cannot be empty");
  return sql.join(
    normalized.map(id => sql`${id}`),
    sql`, `
  );
}

function candidateConversation(
  row: Record<string, unknown>,
  prefix: "legacy" | "pending" | "final"
): Record<string, unknown> {
  return {
    id: row[`${prefix}_id`],
    user1Id: row[`${prefix}_user1Id`],
    user2Id: row[`${prefix}_user2Id`],
    user1EnterpriseId: row[`${prefix}_user1EnterpriseId`],
    user2EnterpriseId: row[`${prefix}_user2EnterpriseId`],
    user1CompanyId: row[`${prefix}_user1CompanyId`],
    user2CompanyId: row[`${prefix}_user2CompanyId`],
    identityContextKey: row[`${prefix}_identityContextKey`],
  };
}

function chatTransitionCandidateFromRow(
  row: Record<string, unknown>
): LockedTransitionCandidate {
  return {
    transition: {
      id: row.id,
      legacyConversationId: row.legacyConversationId,
      pendingConversationId: row.pendingConversationId,
      finalConversationId: row.finalConversationId,
      initiatorUserId: row.initiatorUserId,
      initiatorIdentityKey: row.initiatorIdentityKey,
      initiatorEnterpriseId: row.initiatorEnterpriseId,
      initiatorCompanyId: row.initiatorCompanyId,
      recipientUserId: row.recipientUserId,
      recipientConfirmedIdentityKey: row.recipientConfirmedIdentityKey,
      recipientConfirmedEnterpriseId: row.recipientConfirmedEnterpriseId,
      recipientConfirmedCompanyId: row.recipientConfirmedCompanyId,
      status: row.status,
    },
    legacy: candidateConversation(row, "legacy"),
    pending: candidateConversation(row, "pending"),
    final: candidateConversation(row, "final"),
  };
}

export async function chatTransitionLoadLockedCandidates(
  executor: ChatSqlExecutor,
  actorUserId: number,
  conversationIds: readonly number[]
): Promise<LockedTransitionCandidate[]> {
  const ids = Array.from(
    new Set(
      conversationIds
        .map(value => Number(value))
        .filter(value => Number.isSafeInteger(value) && value > 0)
    )
  );
  if (!ids.length) return [];
  const idsSql = chatTransitionConversationIdsSql(ids);
  const rows = rowsOf<Record<string, unknown>>(
    await executor.execute(sql`
    SELECT t.id, t.legacyConversationId, t.pendingConversationId, t.finalConversationId,
           t.initiatorUserId, t.initiatorIdentityKey, t.initiatorEnterpriseId, t.initiatorCompanyId,
           t.recipientUserId, t.recipientConfirmedIdentityKey,
           t.recipientConfirmedEnterpriseId, t.recipientConfirmedCompanyId, t.status,
           legacy.id AS legacy_id, legacy.user1Id AS legacy_user1Id, legacy.user2Id AS legacy_user2Id,
           legacy.user1EnterpriseId AS legacy_user1EnterpriseId, legacy.user2EnterpriseId AS legacy_user2EnterpriseId,
           legacy.user1CompanyId AS legacy_user1CompanyId, legacy.user2CompanyId AS legacy_user2CompanyId,
           legacy.identityContextKey AS legacy_identityContextKey,
           pending.id AS pending_id, pending.user1Id AS pending_user1Id, pending.user2Id AS pending_user2Id,
           pending.user1EnterpriseId AS pending_user1EnterpriseId, pending.user2EnterpriseId AS pending_user2EnterpriseId,
           pending.user1CompanyId AS pending_user1CompanyId, pending.user2CompanyId AS pending_user2CompanyId,
           pending.identityContextKey AS pending_identityContextKey,
           final.id AS final_id, final.user1Id AS final_user1Id, final.user2Id AS final_user2Id,
           final.user1EnterpriseId AS final_user1EnterpriseId, final.user2EnterpriseId AS final_user2EnterpriseId,
           final.user1CompanyId AS final_user1CompanyId, final.user2CompanyId AS final_user2CompanyId,
           final.identityContextKey AS final_identityContextKey
      FROM chat_conversation_identity_transitions t
      INNER JOIN conversations legacy ON legacy.id = t.legacyConversationId
      INNER JOIN conversations pending ON pending.id = t.pendingConversationId
      INNER JOIN conversations final ON final.id = t.finalConversationId
     WHERE t.status = 'locked'
       AND t.finalConversationId IS NOT NULL
       AND (t.initiatorUserId = ${actorUserId} OR t.recipientUserId = ${actorUserId})
       AND (t.legacyConversationId IN (${idsSql})
         OR t.pendingConversationId IN (${idsSql})
         OR t.finalConversationId IN (${idsSql}))
     ORDER BY t.id ASC
  `)
  );
  return rows.map(chatTransitionCandidateFromRow);
}

export async function chatTransitionValidateLockedCandidateRead(
  executor: ChatSqlExecutor,
  actorUserId: number,
  currentIdentity: BusinessIdentity,
  serviceUserId: number,
  candidate: LockedTransitionCandidate
): Promise<boolean> {
  try {
    const read = await chatTransitionResolveRead(executor, {
      actorUserId,
      conversationId: chatTransitionAssertId(
        candidate.transition.pendingConversationId,
        "待确认会话"
      ),
      currentIdentity,
      serviceUserId,
    });
    return Boolean(
      read &&
        Number(read.transition.id) === Number(candidate.transition.id) &&
        Number(read.canonicalConversationId) ===
          Number(candidate.transition.finalConversationId)
    );
  } catch {
    return false;
  }
}

export type ChatTransitionCanonicalAlias = Readonly<{
  canonicalConversationId: number;
  aliasIds: number[];
}>;

export async function chatTransitionResolveCanonicalAlias(
  executor: ChatSqlExecutor,
  actorUserId: number,
  requestedConversationId: number
): Promise<ChatTransitionCanonicalAlias | null> {
  const currentIdentity = await resolveActorBusinessIdentity(
    executor,
    actorUserId
  );
  const serviceUserId = await getServiceUserId();
  const candidates = await chatTransitionLoadLockedCandidates(
    executor,
    actorUserId,
    [requestedConversationId]
  );
  const aliases = candidates.filter(
    candidate =>
      Number(candidate.transition.legacyConversationId) ===
        requestedConversationId ||
      Number(candidate.transition.pendingConversationId) ===
        requestedConversationId
  );
  const currentIdentityAliases = aliases.filter(candidate =>
    transitionClaimsCurrentActorIdentity(
      candidate.transition,
      actorUserId,
      currentIdentity
    )
  );
  if (!currentIdentityAliases.length) return null;
  const finalIds = Array.from(
    new Set(
      currentIdentityAliases
        .map(candidate => positiveId(candidate.transition.finalConversationId))
        .filter((id): id is number => id !== null)
    )
  );
  if (finalIds.length !== 1) return null;
  for (const candidate of currentIdentityAliases) {
    if (
      !isLockedTransitionCanonicalSafe({
        ...candidate,
        actorUserId,
        currentIdentity,
        serviceUserId,
      })
    )
      return null;
    if (
      !(await chatTransitionValidateLockedCandidateRead(
        executor,
        actorUserId,
        currentIdentity,
        serviceUserId,
        candidate
      ))
    )
      return null;
  }
  const aliasIds = Array.from(
    new Set(
      currentIdentityAliases.flatMap(candidate => [
        chatTransitionAssertId(
          candidate.transition.legacyConversationId,
          "历史会话"
        ),
        chatTransitionAssertId(
          candidate.transition.pendingConversationId,
          "待确认会话"
        ),
      ])
    )
  ).sort((left, right) => left - right);
  return { canonicalConversationId: finalIds[0], aliasIds };
}

export type ChatTransitionListEntry = Readonly<Record<string, unknown>> &
  Readonly<{ id: number }>;
export type ChatTransitionCanonicalizedEntry<
  T extends ChatTransitionListEntry,
> = T &
  Readonly<{
    id: number;
    canonicalConversationId: number;
    aliasIds: number[];
  }>;

function canonicalizeLockedConversationListEntries<
  T extends ChatTransitionListEntry,
>(
  entries: readonly T[],
  candidates: readonly LockedTransitionCandidate[],
  context: Readonly<{
    actorUserId: number;
    currentIdentity: BusinessIdentity;
    serviceUserId: number;
  }>
): ChatTransitionCanonicalizedEntry<T>[] {
  const currentIdentityCandidates = candidates.filter(candidate =>
    transitionClaimsCurrentActorIdentity(
      candidate.transition,
      context.actorUserId,
      context.currentIdentity
    )
  );
  const aliasFinalTargets = new Map<number, Set<number>>();
  for (const candidate of currentIdentityCandidates) {
    const finalConversationId = positiveId(
      candidate.transition.finalConversationId
    );
    const legacyConversationId = positiveId(
      candidate.transition.legacyConversationId
    );
    const pendingConversationId = positiveId(
      candidate.transition.pendingConversationId
    );
    for (const aliasId of [legacyConversationId, pendingConversationId]) {
      if (aliasId === null) continue;
      const targets = aliasFinalTargets.get(aliasId) ?? new Set<number>();
      if (finalConversationId !== null) targets.add(finalConversationId);
      aliasFinalTargets.set(aliasId, targets);
    }
  }
  const byId = new Map<number, T>();
  for (const entry of entries) {
    const id = positiveId(entry.id);
    if (id !== null) byId.set(id, entry);
  }
  const suppressedIds = new Set<number>();
  const mergedAliases = new Map<number, Set<number>>();
  for (const candidate of currentIdentityCandidates) {
    const finalConversationId = positiveId(
      candidate.transition.finalConversationId
    );
    const legacyConversationId = positiveId(
      candidate.transition.legacyConversationId
    );
    const pendingConversationId = positiveId(
      candidate.transition.pendingConversationId
    );
    const aliasIds = [legacyConversationId, pendingConversationId];
    if (finalConversationId === null || aliasIds.some(id => id === null))
      continue;
    const exactAliases = aliasIds as [number, number];
    if (
      !candidate.readValidated ||
      exactAliases.some(id => aliasFinalTargets.get(id)?.size !== 1)
    )
      continue;
    if (!byId.has(finalConversationId)) continue;
    if (!isLockedTransitionCanonicalSafe({ ...candidate, ...context }))
      continue;
    const aliases = mergedAliases.get(finalConversationId) ?? new Set<number>();
    for (const aliasId of exactAliases) {
      aliases.add(aliasId);
      if (byId.has(aliasId)) suppressedIds.add(aliasId);
    }
    mergedAliases.set(finalConversationId, aliases);
  }
  return entries
    .filter(entry => {
      const id = positiveId(entry.id);
      return id === null || !suppressedIds.has(id);
    })
    .map(entry => {
      const id = positiveId(entry.id);
      const aliases = id === null ? undefined : mergedAliases.get(id);
      return {
        ...entry,
        id: entry.id,
        canonicalConversationId: entry.id,
        aliasIds: aliases
          ? Array.from(aliases).sort((left, right) => left - right)
          : [],
      };
    });
}

export async function chatTransitionCanonicalizeListEntries<
  T extends ChatTransitionListEntry,
>(
  executor: ChatSqlExecutor,
  actorUserId: number,
  currentIdentity: BusinessIdentity,
  serviceUserId: number,
  entries: readonly T[]
): Promise<ChatTransitionCanonicalizedEntry<T>[]> {
  if (!positiveId(serviceUserId)) {
    return entries.map(entry => {
      return {
        ...entry,
        id: entry.id,
        canonicalConversationId: entry.id,
        aliasIds: [],
      };
    });
  }
  const candidates = await chatTransitionLoadLockedCandidates(
    executor,
    actorUserId,
    entries
      .map(entry => positiveId(entry.id))
      .filter((id): id is number => id !== null)
  );
  const readValidatedCandidates = await Promise.all(
    candidates.map(async candidate => ({
      ...candidate,
      readValidated: await chatTransitionValidateLockedCandidateRead(
        executor,
        actorUserId,
        currentIdentity,
        serviceUserId,
        candidate
      ),
    }))
  );
  return canonicalizeLockedConversationListEntries(
    entries,
    readValidatedCandidates,
    { actorUserId, currentIdentity, serviceUserId }
  );
}

/** Current resolver-compatible alias name; only aliases are redirected. */
export async function resolveLockedTransitionCanonicalAlias(
  executor: ChatSqlExecutor,
  actorUserId: number,
  requestedConversationId: number
): Promise<{ canonicalConversationId: number } | null> {
  const resolved = await chatTransitionResolveCanonicalAlias(
    executor,
    actorUserId,
    requestedConversationId
  );
  return resolved
    ? { canonicalConversationId: resolved.canonicalConversationId }
    : null;
}

/** Current router-compatible state wrapper over the restored historic interface. */
export async function getLegacyTransitionState(
  executor: ChatSqlExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    transitionId?: number;
  }>
): Promise<ChatTransitionState> {
  return chatTransitionGetState(executor, {
    ...input,
    currentIdentity: await resolveActorBusinessIdentity(
      executor,
      input.actorUserId
    ),
    serviceUserId: await getServiceUserId(),
  });
}

/** Current router-compatible confirmation wrapper over the restored historic interface. */
export async function confirmLegacyTransitionIdentity(
  executor: TransactionExecutor,
  input: Readonly<{
    actorUserId: number;
    conversationId: number;
    enterpriseId: number | null;
    transitionId?: number;
  }>
): Promise<ChatTransitionState> {
  return chatTransitionConfirmIdentity(executor, {
    ...input,
    serviceUserId: await getServiceUserId(),
  });
}
