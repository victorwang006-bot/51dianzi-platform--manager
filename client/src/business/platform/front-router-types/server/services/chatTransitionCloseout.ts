type IdentityLike = Readonly<{ enterpriseId: number | null; companyId: number | null }>;
type RecordLike = Record<string, unknown>;
import { sql } from "drizzle-orm";

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nullableId(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveId(value);
}

function sameNullableId(left: unknown, right: unknown): boolean {
  return nullableId(left) === nullableId(right);
}

function pairMatches(
  conversation: RecordLike,
  leftUserId: number,
  leftIdentity: IdentityLike,
  rightUserId: number,
  rightIdentity: IdentityLike,
): boolean {
  const firstIsLeft = positiveId(conversation.user1Id) === leftUserId
    && positiveId(conversation.user2Id) === rightUserId;
  const secondIsLeft = positiveId(conversation.user1Id) === rightUserId
    && positiveId(conversation.user2Id) === leftUserId;
  if (!firstIsLeft && !secondIsLeft) return false;
  const user1Identity = firstIsLeft ? leftIdentity : rightIdentity;
  const user2Identity = firstIsLeft ? rightIdentity : leftIdentity;
  return sameNullableId(conversation.user1EnterpriseId, user1Identity.enterpriseId)
    && sameNullableId(conversation.user1CompanyId, user1Identity.companyId)
    && sameNullableId(conversation.user2EnterpriseId, user2Identity.enterpriseId)
    && sameNullableId(conversation.user2CompanyId, user2Identity.companyId);
}

export function frozenIdentityContextKey(userId: unknown, identity: Partial<IdentityLike> | undefined): string | null {
  const validUserId = positiveId(userId);
  if (!validUserId) return null;
  return `v1:u${validUserId}:e${nullableId(identity?.enterpriseId) ?? 0}:c${nullableId(identity?.companyId) ?? 0}`;
}

export function frozenConversationContextKey(
  leftUserId: unknown,
  leftIdentity: Partial<IdentityLike> | undefined,
  rightUserId: unknown,
  rightIdentity: Partial<IdentityLike> | undefined,
): string | null {
  const left = positiveId(leftUserId);
  const right = positiveId(rightUserId);
  if (!left || !right || left === right) return null;
  const token = (userId: number, identity: Partial<IdentityLike> | undefined) =>
    `u${userId}:e${nullableId(identity?.enterpriseId) ?? 0}:c${nullableId(identity?.companyId) ?? 0}`;
  return left < right
    ? `v1:${token(left, leftIdentity)}|${token(right, rightIdentity)}`
    : `v1:${token(right, rightIdentity)}|${token(left, leftIdentity)}`;
}

export function lockedTransitionAliasIds(transition: RecordLike): number[] {
  const legacyConversationId = positiveId(transition.legacyConversationId);
  const pendingConversationId = positiveId(transition.pendingConversationId);
  const finalConversationId = positiveId(transition.finalConversationId);
  if (!legacyConversationId || !pendingConversationId || !finalConversationId) return [];
  if (legacyConversationId === pendingConversationId
    || legacyConversationId === finalConversationId
    || pendingConversationId === finalConversationId) return [];
  return [legacyConversationId, pendingConversationId];
}

export type LockedTransitionCandidate = Readonly<{
  transition: RecordLike;
  legacy: RecordLike;
  pending: RecordLike;
  final: RecordLike;
  readValidated?: boolean;
}>;

/** Rejects any alias unless L/P/F records, frozen tuples and current actor identity agree exactly. */
export function isLockedTransitionCanonicalSafe(input: Readonly<{
  transition: RecordLike;
  legacy: RecordLike;
  pending: RecordLike;
  final: RecordLike;
  actorUserId: number;
  currentIdentity: Partial<IdentityLike>;
  serviceUserId: number;
}>): boolean {
  const { transition, legacy, pending, final, actorUserId, currentIdentity, serviceUserId } = input;
  const actorId = positiveId(actorUserId);
  const serviceId = positiveId(serviceUserId);
  const initiatorUserId = positiveId(transition.initiatorUserId);
  const recipientUserId = positiveId(transition.recipientUserId);
  const aliases = lockedTransitionAliasIds(transition);
  const finalConversationId = positiveId(transition.finalConversationId);
  if (!actorId || !serviceId || !initiatorUserId || !recipientUserId
    || initiatorUserId === recipientUserId || !aliases.length || !finalConversationId) return false;
  if (transition.status !== "locked") return false;

  const initiatorIdentity = {
    enterpriseId: nullableId(transition.initiatorEnterpriseId),
    companyId: nullableId(transition.initiatorCompanyId),
  };
  const recipientIdentity = {
    enterpriseId: nullableId(transition.recipientConfirmedEnterpriseId),
    companyId: nullableId(transition.recipientConfirmedCompanyId),
  };
  const initiatorIdentityKey = frozenIdentityContextKey(initiatorUserId, initiatorIdentity);
  const recipientIdentityKey = frozenIdentityContextKey(recipientUserId, recipientIdentity);
  if (!initiatorIdentityKey || !recipientIdentityKey
    || transition.initiatorIdentityKey !== initiatorIdentityKey
    || transition.recipientConfirmedIdentityKey !== recipientIdentityKey) return false;

  const ownIdentity = actorId === initiatorUserId ? initiatorIdentity
    : actorId === recipientUserId ? recipientIdentity : null;
  if (!ownIdentity
    || !sameNullableId(currentIdentity.enterpriseId, ownIdentity.enterpriseId)
    || !sameNullableId(currentIdentity.companyId, ownIdentity.companyId)) return false;
  if (initiatorUserId === serviceId || recipientUserId === serviceId) return false;
  if (positiveId(legacy.id) !== aliases[0]
    || positiveId(pending.id) !== aliases[1]
    || positiveId(final.id) !== finalConversationId) return false;
  if (legacy.identityContextKey !== "legacy" && legacy.identityContextKey !== null && legacy.identityContextKey !== undefined) return false;
  if (!pairMatches(legacy, initiatorUserId, { enterpriseId: null, companyId: null }, recipientUserId, { enterpriseId: null, companyId: null })) return false;
  if (typeof pending.identityContextKey !== "string" || !pending.identityContextKey.startsWith("pending:v1:")) return false;
  if (!pairMatches(pending, initiatorUserId, { enterpriseId: null, companyId: null }, recipientUserId, { enterpriseId: null, companyId: null })) return false;
  const finalKey = frozenConversationContextKey(initiatorUserId, initiatorIdentity, recipientUserId, recipientIdentity);
  return Boolean(finalKey && final.identityContextKey === finalKey
    && pairMatches(final, initiatorUserId, initiatorIdentity, recipientUserId, recipientIdentity));
}

export function transitionClaimsCurrentActorIdentity(
  transition: RecordLike,
  actorUserId: number,
  currentIdentity: Partial<IdentityLike>,
): boolean {
  const actorId = positiveId(actorUserId);
  if (!actorId) return false;
  const initiatorUserId = positiveId(transition.initiatorUserId);
  const recipientUserId = positiveId(transition.recipientUserId);
  const identity = actorId === initiatorUserId ? {
    enterpriseId: nullableId(transition.initiatorEnterpriseId),
    companyId: nullableId(transition.initiatorCompanyId),
  } : actorId === recipientUserId ? {
    enterpriseId: nullableId(transition.recipientConfirmedEnterpriseId),
    companyId: nullableId(transition.recipientConfirmedCompanyId),
  } : null;
  if (!identity) return false;
  return sameNullableId(identity.enterpriseId, currentIdentity.enterpriseId)
    && sameNullableId(identity.companyId, currentIdentity.companyId);
}

/** tRPC middleware factory: only replaces an alias after the caller's resolver has proved it safe. */
export function makeCanonicalConversationInputMiddleware<Context>(input: Readonly<{
  resolveCanonical: (args: { ctx: Context; requestedConversationId: number }) => Promise<{ canonicalConversationId: number } | null>;
}>) {
  return async ({ ctx, input: parsedInput, next }: {
    ctx: Context;
    input: unknown;
    next: (options: { input: unknown }) => unknown;
  }) => {
    const record = parsedInput && typeof parsedInput === "object" ? parsedInput as RecordLike : null;
    const requestedConversationId = positiveId(record?.conversationId);
    if (!requestedConversationId) return next({ input: parsedInput });
    const resolved = await input.resolveCanonical({ ctx, requestedConversationId });
    const canonicalConversationId = positiveId(resolved?.canonicalConversationId);
    if (!canonicalConversationId || canonicalConversationId === requestedConversationId) return next({ input: parsedInput });
    return next({ input: { ...record, conversationId: canonicalConversationId } });
  };
}

export function activePendingTransitionScopeSql(
  conversationAlias: string,
  actorUserId: number,
  identityKey: string,
){
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(conversationAlias)) throw new Error("unsafe conversation SQL alias");
  const conversation = sql.raw(conversationAlias);
  return sql`EXISTS (
    SELECT 1
      FROM chat_conversation_identity_transitions transition_scope
     WHERE transition_scope.pendingConversationId = ${conversation}.id
       AND transition_scope.status = 'pending'
       AND transition_scope.finalConversationId IS NULL
       AND (
         (transition_scope.initiatorUserId = ${actorUserId}
           AND transition_scope.initiatorIdentityKey = ${identityKey})
         OR
         (transition_scope.recipientUserId = ${actorUserId}
           AND (
             transition_scope.recipientConfirmedIdentityKey IS NULL
             OR transition_scope.recipientConfirmedIdentityKey = ${identityKey}
           ))
       )
  )`;
}
