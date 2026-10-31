import {
  and as qqProfileAnd,
  asc as qqSharedAsc,
  eq as qqProfileEq,
  inArray as qqSharedInArray,
  sql as qqSharedSql,
} from "drizzle-orm";
import { getDb } from "../db";
import { userQqProfiles, users } from "../../drizzle/schema";

export type UserQqProfileView = {
  numbers: string[];
  defaultQq: string | null;
  isPublic: boolean;
  version: number;
  scope?: string;
};

export type UserQqProfileInput = UserQqProfileView;

export class UserQqProfileError extends Error {
  constructor(public readonly kind: "bad_request" | "conflict" | "forbidden", message: string) {
    super(message);
    this.name = "UserQqProfileError";
  }
}

/** Existing single-QQ data predates the launchable QQ 5–12 digit rule. */
const LEGACY_QQ_RE = /^\d{5,20}$/;
/** Keep this launchable QQ format in lockstep with shared/qqContact.ts. */
const NEW_QQ_RE = /^[1-9]\d{4,11}$/;

type QqSharedScope = {
  enterpriseId: number;
  dataOwnerUserId: number;
  status: "active" | "suspended";
};

type QqSharedExecutor = {
  execute?: (query: ReturnType<typeof qqSharedBuildScopeQuery>) => Promise<unknown>;
};

type QqSharedScopeRow = {
  enterpriseId?: unknown;
  memberStatus?: unknown;
  dataOwnerUserId?: unknown;
  canonicalCompanyId?: unknown;
};

/**
 * The company condition is deliberately part of the membership lookup: a member
 * is not allowed to borrow an arbitrary data owner's QQ when its canonical legacy
 * company mapping is absent or ambiguous.
 */
export function qqSharedBuildScopeQuery(userId: number, lock = false) {
  const qqSharedLockClause = lock ? qqSharedSql.raw(" FOR UPDATE") : qqSharedSql.raw("");
  return qqSharedSql`
    SELECT
      em.enterpriseId AS enterpriseId,
      em.status AS memberStatus,
      e.crmDataOwnerUserId AS dataOwnerUserId,
      c.id AS canonicalCompanyId
    FROM enterprise_members AS em
    INNER JOIN enterprises AS e ON e.id = em.enterpriseId
    LEFT JOIN companies AS c
      ON c.userId = e.crmDataOwnerUserId
      AND c.enterpriseId = e.id
    WHERE em.userId = ${userId}${qqSharedLockClause}
  `;
}

function qqSharedScopeToken(scope: QqSharedScope): string {
  return `enterprise:${scope.enterpriseId}:qq:${scope.dataOwnerUserId}`;
}

function qqSharedRows(result: unknown): QqSharedScopeRow[] {
  const qqSharedMaybeRows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(qqSharedMaybeRows) || qqSharedMaybeRows.some(row => !row || typeof row !== "object")) {
    throw new UserQqProfileError("conflict", "QQ资料归属查询异常，请稍后重试");
  }
  return qqSharedMaybeRows as QqSharedScopeRow[];
}

function qqSharedPositiveId(value: unknown): number | null {
  const qqSharedId = Number(value);
  return Number.isSafeInteger(qqSharedId) && qqSharedId > 0 ? qqSharedId : null;
}

async function qqSharedResolveScope(executor: QqSharedExecutor, userId: number, lock = false): Promise<QqSharedScope | null> {
  if (typeof executor.execute !== "function") throw new Error("Database not available");
  const qqSharedRowsFound = qqSharedRows(await executor.execute(qqSharedBuildScopeQuery(userId, lock)));
  if (qqSharedRowsFound.length === 0) return null;
  if (qqSharedRowsFound.length !== 1) {
    throw new UserQqProfileError("conflict", "企业QQ归属存在歧义，请刷新后重试");
  }
  const qqSharedRow = qqSharedRowsFound[0];
  const qqSharedEnterpriseId = qqSharedPositiveId(qqSharedRow.enterpriseId);
  const qqSharedDataOwnerUserId = qqSharedPositiveId(qqSharedRow.dataOwnerUserId);
  if (!qqSharedEnterpriseId || !qqSharedDataOwnerUserId || !qqSharedPositiveId(qqSharedRow.canonicalCompanyId)) {
    throw new UserQqProfileError("conflict", "企业QQ归属资料不完整，请联系企业管理员处理");
  }
  if (qqSharedRow.memberStatus !== "active" && qqSharedRow.memberStatus !== "suspended") {
    throw new UserQqProfileError("conflict", "企业成员状态存在歧义，请刷新后重试");
  }
  return {
    enterpriseId: qqSharedEnterpriseId,
    dataOwnerUserId: qqSharedDataOwnerUserId,
    status: qqSharedRow.memberStatus,
  };
}

function qqSharedRequireActive(scope: QqSharedScope | null) {
  if (scope?.status === "suspended") {
    throw new UserQqProfileError("forbidden", "企业成员已停用，不能读取或修改企业QQ");
  }
}

function normalizeNewProfileQq(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const qq = value.trim();
  return NEW_QQ_RE.test(qq) ? qq : null;
}

export function validateUserQqProfile(input: UserQqProfileInput): UserQqProfileInput {
  if (!input || typeof input !== "object") {
    throw new UserQqProfileError("bad_request", "QQ资料无效");
  }
  if (!Array.isArray(input.numbers) || input.numbers.length > 3) {
    throw new UserQqProfileError("bad_request", "QQ号最多只能设置3个");
  }
  const normalizedNumbers = input.numbers.map(value => normalizeNewProfileQq(value));
  if (normalizedNumbers.some((value): value is null => value === null)) {
    throw new UserQqProfileError("bad_request", "QQ号需为5-12位数字，且不能以0开头");
  }
  const numbers = normalizedNumbers as string[];
  if (new Set(numbers).size !== numbers.length) {
    throw new UserQqProfileError("bad_request", "QQ号不能重复");
  }
  if (numbers.length === 0 && input.defaultQq !== null) {
    throw new UserQqProfileError("bad_request", "空列表不能设置默认QQ");
  }
  if (numbers.length > 0 && typeof input.defaultQq !== "string") {
    throw new UserQqProfileError("bad_request", "必须设置一个默认QQ");
  }
  const defaultQq = normalizeNewProfileQq(input.defaultQq);
  if (numbers.length > 0 && !defaultQq) {
    throw new UserQqProfileError("bad_request", "QQ号需为5-12位数字，且不能以0开头");
  }
  if (defaultQq !== null && !numbers.includes(defaultQq)) {
    throw new UserQqProfileError("bad_request", "默认QQ必须在QQ列表中");
  }
  if (typeof input.isPublic !== "boolean") {
    throw new UserQqProfileError("bad_request", "QQ公开状态无效");
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new UserQqProfileError("bad_request", "QQ资料版本无效");
  }
  if (input.scope !== undefined && typeof input.scope !== "string") {
    throw new UserQqProfileError("bad_request", "QQ资料归属无效");
  }
  // Product policy: valid QQ contacts are always visible to authorized logged-in viewers.
  // Keep the legacy field/type compatible, but old clients can no longer hide contacts.
  return {
    numbers,
    defaultQq,
    isPublic: true,
    version: input.version,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
  };
}

function parseContacts(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Owners must never save a sanitized/truncated version of a damaged row. */
function persistedProfile(row: {
  contacts: string;
  defaultQq: string | null;
  isPublic: boolean;
  version: number;
}): UserQqProfileView {
  try {
    const raw: unknown = JSON.parse(row.contacts);
    if (!Array.isArray(raw) || raw.some(value => typeof value !== "string" || normalizeNewProfileQq(value) !== value)) {
      throw new Error("invalid persisted contacts");
    }
    return validateUserQqProfile({
      numbers: raw,
      defaultQq: row.defaultQq,
      isPublic: row.isPublic,
      version: row.version,
    });
  } catch {
    throw new UserQqProfileError("bad_request", "QQ资料读取异常，请联系客服处理；原资料未更改");
  }
}

function legacyDefault(qqId: string | null | undefined): string | null {
  const value = qqId?.trim() || null;
  return value && LEGACY_QQ_RE.test(value) ? value : null;
}

/** Read only the profile for an authenticated owner; absent rows intentionally fall back to old users.qqId. */
export async function getUserQqProfile(userId: number): Promise<UserQqProfileView> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const qqSharedScope = await qqSharedResolveScope(db, userId);
  qqSharedRequireActive(qqSharedScope);
  const qqSharedCanonicalUserId = qqSharedScope?.dataOwnerUserId ?? userId;
  const [row] = await db
    .select({
      contacts: userQqProfiles.contacts,
      defaultQq: userQqProfiles.defaultQq,
      isPublic: userQqProfiles.isPublic,
      version: userQqProfiles.version,
    })
    .from(userQqProfiles)
    .where(qqProfileEq(userQqProfiles.userId, qqSharedCanonicalUserId))
    .limit(1);
  if (row) {
    const qqSharedProfile = persistedProfile(row);
    return qqSharedScope ? { ...qqSharedProfile, scope: qqSharedScopeToken(qqSharedScope) } : qqSharedProfile;
  }
  const [user] = await db
    .select({ qqId: users.qqId })
    .from(users)
    .where(qqProfileEq(users.id, qqSharedCanonicalUserId))
    .limit(1);
  const qq = legacyDefault(user?.qqId);
  return {
    numbers: qq ? [qq] : [],
    defaultQq: qq,
    isPublic: true,
    version: 1,
    ...(qqSharedScope ? { scope: qqSharedScopeToken(qqSharedScope) } : {}),
  };
}

/** Public projection for already-authorized queries. No caller can use this to bypass eligibility. */
export async function getPublicUserQqProfile(userId: number): Promise<string[]> {
  const profile = await getUserQqProfile(userId);
  return profile.defaultQq ? profile.numbers : [];
}

export type UpdateUserProfileWithQqInput = {
  name?: string;
  email?: string | null;
  jobTitle?: string;
  wechatId?: string | null;
  qqId?: string | null;
  qqProfile?: UserQqProfileInput;
};

/** Save personal fields and canonical enterprise QQ data in one transaction with ordered user locks. */
export async function updateUserProfileWithQq(userId: number, data: UpdateUserProfileWithQqInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const qqSharedHasQqMutation = data.qqProfile !== undefined || data.qqId !== undefined;
  return db.transaction(async tx => {
    // Do not look up enterprise membership for an ordinary account-details save:
    // suspended users retain the ability to change their own non-QQ details.
    const qqSharedScope = qqSharedHasQqMutation
      ? await qqSharedResolveScope(tx, userId, true)
      : null;
    qqSharedRequireActive(qqSharedScope);
    const qqSharedCanonicalUserId = qqSharedScope?.dataOwnerUserId ?? userId;
    const qqSharedLockedUserIds = Array.from(new Set([userId, qqSharedCanonicalUserId]))
      .sort((left, right) => left - right);
    const qqSharedLockedUsers = await tx
      .select({ id: users.id, email: users.email, qqId: users.qqId })
      .from(users)
      .where(qqSharedInArray(users.id, qqSharedLockedUserIds))
      .orderBy(qqSharedAsc(users.id))
      .for("update");
    const current = qqSharedLockedUsers.find(user => user.id === userId);
    if (!current) throw new Error("用户不存在");
    const qqSharedCanonicalUser = qqSharedLockedUsers.find(user => user.id === qqSharedCanonicalUserId);
    if (!qqSharedCanonicalUser) throw new UserQqProfileError("conflict", "企业QQ归属账号不存在，请联系企业管理员处理");
    const [existing] = qqSharedHasQqMutation
      ? await tx
        .select({
          userId: userQqProfiles.userId,
          contacts: userQqProfiles.contacts,
          defaultQq: userQqProfiles.defaultQq,
          isPublic: userQqProfiles.isPublic,
          version: userQqProfiles.version,
        })
        .from(userQqProfiles)
        .where(qqProfileEq(userQqProfiles.userId, qqSharedCanonicalUserId))
        .limit(1)
        .for("update")
      : [];
    let qqSharedCanonicalQqId: string | null | undefined = data.qqId;
    if (data.qqProfile !== undefined) {
      const profile = validateUserQqProfile(data.qqProfile);
      if (qqSharedScope) {
        if (profile.scope !== qqSharedScopeToken(qqSharedScope)) {
          throw new UserQqProfileError("conflict", "企业QQ归属已变化，请刷新后重试");
        }
      } else if (profile.scope !== undefined) {
        throw new UserQqProfileError("conflict", "QQ资料归属已变化，请刷新后重试");
      }
      const currentVersion = existing ? Number(existing.version) : 1;
      if (profile.version !== currentVersion) {
        throw new UserQqProfileError("conflict", "QQ资料已被其他入口更新，请刷新后重试");
      }
      if (existing) {
        const updateResult = await tx
          .update(userQqProfiles)
          .set({
            contacts: JSON.stringify(profile.numbers),
            defaultQq: profile.defaultQq,
            isPublic: profile.isPublic,
            version: currentVersion + 1,
          })
          .where(qqProfileAnd(
            qqProfileEq(userQqProfiles.userId, qqSharedCanonicalUserId),
            qqProfileEq(userQqProfiles.version, currentVersion),
          ));
        const result = Array.isArray(updateResult) ? updateResult[0] : updateResult;
        if (
          result
          && typeof result === "object"
          && "affectedRows" in result
          && Number((result as { affectedRows: unknown }).affectedRows) < 1
        ) {
          throw new UserQqProfileError("conflict", "QQ资料已被其他入口更新，请刷新后重试");
        }
      } else {
        await tx.insert(userQqProfiles).values({
          userId: qqSharedCanonicalUserId,
          contacts: JSON.stringify(profile.numbers),
          defaultQq: profile.defaultQq,
          isPublic: profile.isPublic,
          version: 2,
        });
      }
      // The default projection stays compatible with old authorized contact views.
      qqSharedCanonicalQqId = profile.defaultQq;
    } else if (qqSharedCanonicalQqId !== undefined && existing) {
      const requested = qqSharedCanonicalQqId?.trim() || null;
      if (requested !== (existing.defaultQq?.trim() || null)) {
        throw new UserQqProfileError(
          "conflict",
          qqSharedScope ? "企业QQ已由企业资料管理，请刷新后重试" : "已有多QQ资料，请在QQ资料编辑入口修改",
        );
      }
      // Matching legacy input is a no-op: never overwrite the multi-number list.
      qqSharedCanonicalQqId = undefined;
    } else if (qqSharedCanonicalQqId !== undefined && qqSharedScope) {
      const requested = qqSharedCanonicalQqId?.trim() || null;
      const qqSharedCanonicalDefault = qqSharedCanonicalUser.qqId?.trim() || null;
      if (requested !== qqSharedCanonicalDefault) {
        throw new UserQqProfileError("conflict", "企业QQ已由企业资料管理，请刷新后重试");
      }
      // Legacy qqId from enterprise members may only acknowledge the canonical value.
      qqSharedCanonicalQqId = undefined;
    }
    const qqSharedActorUpdateData: Record<string, unknown> = {};
    for (const field of ["name", "jobTitle", "wechatId"] as const) {
      if (data[field] !== undefined) qqSharedActorUpdateData[field] = data[field];
    }
    if (qqSharedCanonicalQqId !== undefined && qqSharedCanonicalUserId === userId) {
      qqSharedActorUpdateData.qqId = qqSharedCanonicalQqId;
    }
    if (data.email !== undefined) {
      const normalized = data.email?.trim().toLowerCase() || null;
      qqSharedActorUpdateData.email = normalized;
      if (normalized !== (current.email?.trim().toLowerCase() || null)) qqSharedActorUpdateData.emailVerifiedAt = null;
    }
    if (Object.keys(qqSharedActorUpdateData).length) {
      await tx.update(users).set(qqSharedActorUpdateData).where(qqProfileEq(users.id, userId));
    }
    if (qqSharedCanonicalQqId !== undefined && qqSharedCanonicalUserId !== userId) {
      await tx
        .update(users)
        .set({ qqId: qqSharedCanonicalQqId })
        .where(qqProfileEq(users.id, qqSharedCanonicalUserId));
    }
    return { success: true };
  });
}
