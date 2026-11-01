import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  adminUserPermissionAudits,
  adminUserPermissions,
  adminUsers,
} from "../../drizzle/schema";
import {
  officialChannelAudits,
  officialChannelTeamMembers,
  officialChannelTeams,
} from "../../drizzle/officialChannelSchema";
import {
  normalizeAssignedAdminPermissions,
  resolveAdminPermissions,
  type AdminPermission,
  type AdminRole,
} from "../../shared/adminPermissions";
import { getDb } from "../db";
import {
  loadOfficialAccess,
  OFFICIAL_INVENTORY_PERMISSIONS,
  type OfficialAccess,
  type OfficialActor,
  type OfficialDbExecutor,
  type OfficialInventoryPermission,
} from "./officialChannelAccess";

const OFFICIAL_PERMISSION_SET = new Set<string>(OFFICIAL_INVENTORY_PERMISSIONS);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type TeamRow = typeof officialChannelTeams.$inferSelect;
type MemberRow = typeof officialChannelTeamMembers.$inferSelect;
type AuditAction =
  | "official.team.create"
  | "official.team.update"
  | "official.team.archive"
  | "official.team-member.set";

export type OfficialTeamDto = {
  id: number;
  name: string;
  status: "active" | "archived";
  revision: number;
  createdByAdminUserId: number;
  createdAt: Date;
  updatedAt: Date;
};

/** DTO deliberately uses admin_users.id, never users.id or any front/ERP identity. */
export type OfficialTeamMemberDto = {
  adminUserId: number;
  displayName: string;
  teamId: number;
  teamName: string;
  role: "member" | "leader";
  revision: number;
  /** Current effective values among the four assignable official inventory keys. */
  officialPermissions: OfficialInventoryPermission[];
};

export type OfficialCurrentAccessDto = {
  adminUserId: number;
  isSuperAdmin: boolean;
  teamId: number | null;
  teamRole: "member" | "leader" | null;
  permissions: readonly AdminPermission[];
};

export type OfficialTeamsOverview = {
  teams: OfficialTeamDto[];
  members: OfficialTeamMemberDto[];
  currentAccess: OfficialCurrentAccessDto;
};

export type CreateOfficialTeamInput = {
  name: string;
  requestId: string;
};

export type UpdateOfficialTeamInput = {
  id: number;
  name: string;
  expectedRevision: number;
  requestId: string;
};

export type ArchiveOfficialTeamInput = {
  id: number;
  expectedRevision: number;
  requestId: string;
};

export type SetOfficialTeamMemberInput = {
  /** Real admin_users.id, not users.id/frontUserId. */
  adminUserId: number;
  /** null removes the current official-team membership; it never changes old stocks/sources. */
  teamId: number | null;
  role: "member" | "leader" | null;
  /** Current member revision; use 0 when assigning an account with no membership. */
  expectedRevision: number;
  requestId: string;
  /** Complete desired set of only four official module keys; omitted means do not edit grants. */
  officialPermissions?: OfficialInventoryPermission[];
};

export type OfficialTeamMutation = {
  team: OfficialTeamDto;
  requestId: string;
  idempotent: boolean;
};

export type OfficialTeamMemberMutation = {
  member: OfficialTeamMemberDto | null;
  officialPermissions: OfficialInventoryPermission[];
  revision: number;
  requestId: string;
  idempotent: boolean;
};

function toTeamDto(row: TeamRow): OfficialTeamDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    createdByAdminUserId: row.createdByAdminUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertPositiveInteger(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
}

function assertRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("OFFICIAL_TEAM_REVISION_INVALID");
  }
}

function assertRequestId(value: string) {
  if (!REQUEST_ID_PATTERN.test(value))
    throw new Error("OFFICIAL_TEAM_REQUEST_ID_INVALID");
}

function assertTeamName(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new Error("OFFICIAL_TEAM_NAME_INVALID");
  }
  return value.trim();
}

/** Stable JSON avoids accidental idempotency divergence from object-key insertion order. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function officialPayloadHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isOfficialInventoryPermission(
  value: string
): value is OfficialInventoryPermission {
  return OFFICIAL_PERMISSION_SET.has(value);
}

function currentOfficialPermissions(
  role: AdminRole | string,
  storedPermissions: readonly string[]
): OfficialInventoryPermission[] {
  return Array.from(resolveAdminPermissions(role, storedPermissions))
    .filter(isOfficialInventoryPermission)
    .sort();
}

/**
 * Updating the four official checkboxes must not erase old native grants. If a legacy
 * user has no explicit rows, their role-default effective grants are materialized before
 * adding official grants, otherwise resolveAdminPermissions would suppress that fallback.
 */
export function mergeOfficialInventoryPermissions(
  role: AdminRole | string,
  existingStoredPermissions: readonly string[],
  requestedOfficialPermissions: readonly OfficialInventoryPermission[]
) {
  const baseline =
    existingStoredPermissions.length > 0
      ? [...existingStoredPermissions]
      : [...resolveAdminPermissions(role, existingStoredPermissions)];
  const retained = baseline.filter(
    permission => !OFFICIAL_PERMISSION_SET.has(permission)
  );
  const requested = normalizeAssignedAdminPermissions(
    requestedOfficialPermissions
  ).filter(isOfficialInventoryPermission);
  const merged = normalizeAssignedAdminPermissions([...retained, ...requested]);
  return {
    permissions: merged,
    officialPermissions: merged.filter(isOfficialInventoryPermission).sort(),
  };
}

function samePermissions(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

async function dbTransaction<T>(
  callback: (tx: OfficialDbExecutor) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("OFFICIAL_DATABASE_NOT_AVAILABLE");
  return db.transaction(callback);
}

async function lockAuditReplay(
  tx: OfficialDbExecutor,
  input: {
    action: AuditAction;
    targetId?: string;
    actor: OfficialActor;
    requestId: string;
    payloadHash: string;
  }
) {
  const [replayed] = await tx
    .select()
    .from(officialChannelAudits)
    .where(eq(officialChannelAudits.requestId, input.requestId))
    .limit(1)
    .for("update");
  if (!replayed) return null;
  if (
    replayed.action !== input.action ||
    replayed.actorAdminUserId !== input.actor.adminUserId ||
    replayed.payloadHash !== input.payloadHash ||
    (input.targetId !== undefined && replayed.targetId !== input.targetId)
  ) {
    throw new Error("OFFICIAL_TEAM_REQUEST_ID_REUSED");
  }
  return replayed;
}

function requireReplayData<T>(audit: { afterData: unknown }): T {
  const after = parseJsonObject(audit.afterData);
  const result = after?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("OFFICIAL_TEAM_AUDIT_REPLAY_INVALID");
  }
  return result as T;
}

async function appendAudit(
  tx: OfficialDbExecutor,
  input: {
    action: AuditAction;
    targetId: string;
    actor: OfficialActor;
    requestId: string;
    payloadHash: string;
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown>;
  }
) {
  await tx.insert(officialChannelAudits).values({
    action: input.action,
    targetId: input.targetId,
    actorAdminUserId: input.actor.adminUserId,
    requestId: input.requestId,
    payloadHash: input.payloadHash,
    beforeData: input.beforeData,
    afterData: input.afterData,
  });
}

async function lockedActorName(tx: OfficialDbExecutor, actor: OfficialActor) {
  const [row] = await tx
    .select({
      displayName: adminUsers.displayName,
      username: adminUsers.username,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, actor.adminUserId))
    .limit(1)
    .for("update");
  return row?.displayName?.trim() || row?.username || null;
}

async function lockStoredPermissions(
  tx: OfficialDbExecutor,
  adminUserId: number
) {
  const rows = await tx
    .select({ permission: adminUserPermissions.permission })
    .from(adminUserPermissions)
    .where(eq(adminUserPermissions.adminUserId, adminUserId))
    .orderBy(asc(adminUserPermissions.id))
    .for("update");
  return rows.map((row: { permission: string }) => row.permission);
}

async function replaceStoredPermissions(
  tx: OfficialDbExecutor,
  adminUserId: number,
  permissions: readonly string[]
) {
  await tx
    .delete(adminUserPermissions)
    .where(eq(adminUserPermissions.adminUserId, adminUserId));
  if (permissions.length > 0) {
    await tx
      .insert(adminUserPermissions)
      .values(permissions.map(permission => ({ adminUserId, permission })));
  }
}

function mysqlErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? mysqlErrorCode(error.cause) : null;
}

function mysqlErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  if ("sqlMessage" in error && typeof error.sqlMessage === "string")
    return error.sqlMessage;
  if ("message" in error && typeof error.message === "string")
    return error.message;
  return "cause" in error ? mysqlErrorMessage(error.cause) : "";
}

function remapTeamUniqueError(error: unknown): never {
  const message = mysqlErrorMessage(error);
  if (mysqlErrorCode(error) === "ER_DUP_ENTRY") {
    if (message.includes("official_channel_team_members_leader_team_unique")) {
      throw new Error("OFFICIAL_TEAM_LEADER_EXISTS");
    }
    if (message.includes("official_channel_team_members_admin_user_unique")) {
      throw new Error("OFFICIAL_TEAM_MEMBER_CONFLICT");
    }
    if (message.includes("official_channel_audits_request_unique")) {
      throw new Error("OFFICIAL_TEAM_REQUEST_ID_REUSED");
    }
  }
  throw error;
}

/** Team setting overview is itself an admin configuration surface, so it is super-admin only. */
export async function getOfficialTeamsOverview(
  actor: OfficialActor
): Promise<OfficialTeamsOverview> {
  return dbTransaction(async tx => {
    const access = await loadOfficialAccess(tx, actor, "officialTeams.manage");
    const teams = await tx
      .select()
      .from(officialChannelTeams)
      .orderBy(
        asc(officialChannelTeams.status),
        asc(officialChannelTeams.name),
        asc(officialChannelTeams.id)
      );
    const rows = await tx
      .select({
        adminUserId: officialChannelTeamMembers.adminUserId,
        teamId: officialChannelTeamMembers.teamId,
        role: officialChannelTeamMembers.role,
        revision: officialChannelTeamMembers.revision,
        displayName: adminUsers.displayName,
        username: adminUsers.username,
        teamName: officialChannelTeams.name,
        adminRole: adminUsers.adminRole,
      })
      .from(officialChannelTeamMembers)
      .innerJoin(
        adminUsers,
        eq(adminUsers.id, officialChannelTeamMembers.adminUserId)
      )
      .innerJoin(
        officialChannelTeams,
        eq(officialChannelTeams.id, officialChannelTeamMembers.teamId)
      )
      .orderBy(asc(officialChannelTeams.name), asc(adminUsers.username));
    const ids = rows.map((row: { adminUserId: number }) => row.adminUserId);
    const permissionRows =
      ids.length === 0
        ? []
        : await tx
            .select({
              adminUserId: adminUserPermissions.adminUserId,
              permission: adminUserPermissions.permission,
            })
            .from(adminUserPermissions)
            .where(inArray(adminUserPermissions.adminUserId, ids))
            .orderBy(
              asc(adminUserPermissions.adminUserId),
              asc(adminUserPermissions.id)
            );
    const permissionsByAdminId = new Map<number, string[]>();
    for (const row of permissionRows) {
      const values = permissionsByAdminId.get(row.adminUserId) ?? [];
      values.push(row.permission);
      permissionsByAdminId.set(row.adminUserId, values);
    }

    return {
      teams: teams.map(toTeamDto),
      members: rows.map(
        (row: {
          adminUserId: number;
          teamId: number;
          role: "member" | "leader";
          revision: number;
          displayName: string | null;
          username: string;
          teamName: string;
          adminRole: AdminRole;
        }) => ({
          adminUserId: row.adminUserId,
          displayName: row.displayName?.trim() || row.username,
          teamId: row.teamId,
          teamName: row.teamName,
          role: row.role,
          revision: row.revision,
          officialPermissions: currentOfficialPermissions(
            row.adminRole,
            permissionsByAdminId.get(row.adminUserId) ?? []
          ),
        })
      ),
      currentAccess: {
        adminUserId: access.adminUserId,
        isSuperAdmin: access.isSuperAdmin,
        teamId: access.teamId,
        teamRole: access.teamRole,
        permissions: access.permissions,
      },
    };
  });
}

export async function createOfficialTeam(
  actor: OfficialActor,
  input: CreateOfficialTeamInput
): Promise<OfficialTeamMutation> {
  const name = assertTeamName(input.name);
  assertRequestId(input.requestId);
  const payloadHash = officialPayloadHash({ action: "create", name });
  try {
    return await dbTransaction(async tx => {
      await loadOfficialAccess(tx, actor, "officialTeams.manage");
      const replay = await lockAuditReplay(tx, {
        action: "official.team.create",
        actor,
        requestId: input.requestId,
        payloadHash,
      });
      if (replay)
        return {
          ...requireReplayData<OfficialTeamMutation>(replay),
          idempotent: true,
        };

      const result = await tx.insert(officialChannelTeams).values({
        name,
        status: "active",
        revision: 1,
        createdByAdminUserId: actor.adminUserId,
      });
      const teamId = Number(
        (result as unknown as [{ insertId?: number }])[0]?.insertId ?? 0
      );
      if (!Number.isSafeInteger(teamId) || teamId <= 0)
        throw new Error("OFFICIAL_TEAM_CREATE_FAILED");
      const [created] = await tx
        .select()
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, teamId))
        .limit(1)
        .for("update");
      if (!created) throw new Error("OFFICIAL_TEAM_CREATE_FAILED");
      const mutation: OfficialTeamMutation = {
        team: toTeamDto(created),
        requestId: input.requestId,
        idempotent: false,
      };
      await appendAudit(tx, {
        action: "official.team.create",
        targetId: String(teamId),
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: null,
        afterData: { result: mutation, reason: "official-team-created" },
      });
      return mutation;
    });
  } catch (error) {
    return remapTeamUniqueError(error);
  }
}

export async function updateOfficialTeam(
  actor: OfficialActor,
  input: UpdateOfficialTeamInput
): Promise<OfficialTeamMutation> {
  assertPositiveInteger(input.id, "OFFICIAL_TEAM_ID_INVALID");
  const name = assertTeamName(input.name);
  assertRevision(input.expectedRevision);
  assertRequestId(input.requestId);
  const payloadHash = officialPayloadHash({
    action: "update",
    id: input.id,
    name,
    expectedRevision: input.expectedRevision,
  });
  try {
    return await dbTransaction(async tx => {
      await loadOfficialAccess(tx, actor, "officialTeams.manage");
      const replay = await lockAuditReplay(tx, {
        action: "official.team.update",
        targetId: String(input.id),
        actor,
        requestId: input.requestId,
        payloadHash,
      });
      if (replay)
        return {
          ...requireReplayData<OfficialTeamMutation>(replay),
          idempotent: true,
        };
      const [current] = await tx
        .select()
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, input.id))
        .limit(1)
        .for("update");
      if (!current) throw new Error("OFFICIAL_TEAM_NOT_FOUND");
      if (current.revision !== input.expectedRevision)
        throw new Error("OFFICIAL_TEAM_REVISION_CONFLICT");
      if (current.status !== "active")
        throw new Error("OFFICIAL_TEAM_ARCHIVED");

      const nextRevision = current.revision + 1;
      await tx
        .update(officialChannelTeams)
        .set({ name, revision: nextRevision })
        .where(
          and(
            eq(officialChannelTeams.id, current.id),
            eq(officialChannelTeams.revision, current.revision)
          )
        );
      const [updated] = await tx
        .select()
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, current.id))
        .limit(1)
        .for("update");
      if (!updated) throw new Error("OFFICIAL_TEAM_UPDATE_FAILED");
      const mutation: OfficialTeamMutation = {
        team: toTeamDto(updated),
        requestId: input.requestId,
        idempotent: false,
      };
      await appendAudit(tx, {
        action: "official.team.update",
        targetId: String(current.id),
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: { team: toTeamDto(current) },
        afterData: { result: mutation, reason: "official-team-updated" },
      });
      return mutation;
    });
  } catch (error) {
    return remapTeamUniqueError(error);
  }
}

/**
 * Archive only an empty team. The caller must explicitly move/remove members first;
 * neither this operation nor setMember ever rewrites official stocks/sources history.
 */
export async function archiveOfficialTeam(
  actor: OfficialActor,
  input: ArchiveOfficialTeamInput
): Promise<OfficialTeamMutation> {
  assertPositiveInteger(input.id, "OFFICIAL_TEAM_ID_INVALID");
  assertRevision(input.expectedRevision);
  assertRequestId(input.requestId);
  const payloadHash = officialPayloadHash({
    action: "archive",
    id: input.id,
    expectedRevision: input.expectedRevision,
  });
  try {
    return await dbTransaction(async tx => {
      await loadOfficialAccess(tx, actor, "officialTeams.manage");
      const replay = await lockAuditReplay(tx, {
        action: "official.team.archive",
        targetId: String(input.id),
        actor,
        requestId: input.requestId,
        payloadHash,
      });
      if (replay)
        return {
          ...requireReplayData<OfficialTeamMutation>(replay),
          idempotent: true,
        };
      const [current] = await tx
        .select()
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, input.id))
        .limit(1)
        .for("update");
      if (!current) throw new Error("OFFICIAL_TEAM_NOT_FOUND");
      if (current.revision !== input.expectedRevision)
        throw new Error("OFFICIAL_TEAM_REVISION_CONFLICT");
      if (current.status !== "active")
        throw new Error("OFFICIAL_TEAM_ARCHIVED");
      const members = await tx
        .select({ id: officialChannelTeamMembers.id })
        .from(officialChannelTeamMembers)
        .where(eq(officialChannelTeamMembers.teamId, current.id))
        .for("update");
      if (members.length > 0)
        throw new Error("OFFICIAL_TEAM_ARCHIVE_MEMBERS_EXIST");

      await tx
        .update(officialChannelTeams)
        .set({ status: "archived", revision: current.revision + 1 })
        .where(
          and(
            eq(officialChannelTeams.id, current.id),
            eq(officialChannelTeams.revision, current.revision)
          )
        );
      const [archived] = await tx
        .select()
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, current.id))
        .limit(1)
        .for("update");
      if (!archived) throw new Error("OFFICIAL_TEAM_ARCHIVE_FAILED");
      const mutation: OfficialTeamMutation = {
        team: toTeamDto(archived),
        requestId: input.requestId,
        idempotent: false,
      };
      await appendAudit(tx, {
        action: "official.team.archive",
        targetId: String(current.id),
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: { team: toTeamDto(current) },
        afterData: {
          result: mutation,
          reason: "official-team-archived-empty-only",
        },
      });
      return mutation;
    });
  } catch (error) {
    return remapTeamUniqueError(error);
  }
}

function validateSetMemberInput(input: SetOfficialTeamMemberInput) {
  assertPositiveInteger(
    input.adminUserId,
    "OFFICIAL_TEAM_MEMBER_ADMIN_INVALID"
  );
  assertRevision(input.expectedRevision);
  assertRequestId(input.requestId);
  if (input.teamId === null) {
    if (input.role !== null)
      throw new Error("OFFICIAL_TEAM_MEMBER_ROLE_INVALID");
  } else {
    assertPositiveInteger(input.teamId, "OFFICIAL_TEAM_ID_INVALID");
    if (input.role !== "member" && input.role !== "leader") {
      throw new Error("OFFICIAL_TEAM_MEMBER_ROLE_INVALID");
    }
  }
  if (input.officialPermissions) {
    const invalid = input.officialPermissions.some(
      permission => !isOfficialInventoryPermission(permission)
    );
    if (
      invalid ||
      new Set(input.officialPermissions).size !==
        input.officialPermissions.length
    ) {
      throw new Error("OFFICIAL_TEAM_PERMISSION_INVALID");
    }
  }
}

async function lockTeamForAssignment(tx: OfficialDbExecutor, teamId: number) {
  const [team] = await tx
    .select()
    .from(officialChannelTeams)
    .where(eq(officialChannelTeams.id, teamId))
    .limit(1)
    .for("update");
  if (!team) throw new Error("OFFICIAL_TEAM_NOT_FOUND");
  if (team.status !== "active") throw new Error("OFFICIAL_TEAM_ARCHIVED");
  return team;
}

function memberDto(input: {
  member: MemberRow;
  displayName: string;
  teamName: string;
  officialPermissions: OfficialInventoryPermission[];
}): OfficialTeamMemberDto {
  return {
    adminUserId: input.member.adminUserId,
    displayName: input.displayName,
    teamId: input.member.teamId,
    teamName: input.teamName,
    role: input.member.role,
    revision: input.member.revision,
    officialPermissions: input.officialPermissions,
  };
}

/**
 * The only team-membership writer. It locks both the authenticated super-admin and
 * target admin_users row, checks target activity, preserves non-official native grants,
 * bumps target sessionVersion for either scope/grant change, and writes two audit trails.
 */
export async function setOfficialTeamMember(
  actor: OfficialActor,
  input: SetOfficialTeamMemberInput
): Promise<OfficialTeamMemberMutation> {
  validateSetMemberInput(input);
  const requestedOfficialPermissions = input.officialPermissions
    ? [...input.officialPermissions].sort()
    : undefined;
  const payloadHash = officialPayloadHash({
    action: "setMember",
    adminUserId: input.adminUserId,
    teamId: input.teamId,
    role: input.role,
    expectedRevision: input.expectedRevision,
    officialPermissions: requestedOfficialPermissions ?? null,
  });
  try {
    return await dbTransaction(async tx => {
      // This both locks and live-rechecks that the caller is a real super_admin.
      await loadOfficialAccess(tx, actor, "officialTeams.manage");
      const replay = await lockAuditReplay(tx, {
        action: "official.team-member.set",
        targetId: String(input.adminUserId),
        actor,
        requestId: input.requestId,
        payloadHash,
      });
      if (replay) {
        return {
          ...requireReplayData<OfficialTeamMemberMutation>(replay),
          idempotent: true,
        };
      }

      const [target] = await tx
        .select({
          id: adminUsers.id,
          username: adminUsers.username,
          displayName: adminUsers.displayName,
          adminRole: adminUsers.adminRole,
          status: adminUsers.status,
        })
        .from(adminUsers)
        .where(eq(adminUsers.id, input.adminUserId))
        .limit(1)
        .for("update");
      if (!target) throw new Error("OFFICIAL_TEAM_TARGET_ADMIN_NOT_FOUND");
      if (target.status !== "active")
        throw new Error("OFFICIAL_TEAM_TARGET_ADMIN_INACTIVE");
      if (
        target.adminRole === "super_admin" &&
        requestedOfficialPermissions !== undefined
      ) {
        throw new Error("OFFICIAL_TEAM_SUPER_ADMIN_PERMISSIONS_IMMUTABLE");
      }

      const [current] = await tx
        .select()
        .from(officialChannelTeamMembers)
        .where(eq(officialChannelTeamMembers.adminUserId, target.id))
        .limit(1)
        .for("update");
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new Error("OFFICIAL_TEAM_MEMBER_REVISION_CONFLICT");
      }

      const selectedTeam =
        input.teamId === null
          ? null
          : await lockTeamForAssignment(tx, input.teamId);
      if (input.teamId !== null && input.role === "leader") {
        const leaderConditions = [
          eq(officialChannelTeamMembers.teamId, input.teamId),
          eq(officialChannelTeamMembers.role, "leader"),
        ];
        if (current)
          leaderConditions.push(ne(officialChannelTeamMembers.id, current.id));
        const [existingLeader] = await tx
          .select({ id: officialChannelTeamMembers.id })
          .from(officialChannelTeamMembers)
          .where(and(...leaderConditions))
          .limit(1)
          .for("update");
        if (existingLeader) throw new Error("OFFICIAL_TEAM_LEADER_EXISTS");
      }

      const existingStoredPermissions =
        requestedOfficialPermissions === undefined
          ? []
          : await lockStoredPermissions(tx, target.id);
      const permissionPlan =
        requestedOfficialPermissions === undefined
          ? null
          : mergeOfficialInventoryPermissions(
              target.adminRole,
              existingStoredPermissions,
              requestedOfficialPermissions
            );
      const permissionChanged =
        permissionPlan !== null &&
        !samePermissions(existingStoredPermissions, permissionPlan.permissions);
      const memberChanged = Boolean(current)
        ? input.teamId === null ||
          current.teamId !== input.teamId ||
          current.role !== input.role
        : input.teamId !== null;

      let nextMember: MemberRow | null = current ?? null;
      if (memberChanged && input.teamId === null && current) {
        await tx
          .delete(officialChannelTeamMembers)
          .where(
            and(
              eq(officialChannelTeamMembers.id, current.id),
              eq(officialChannelTeamMembers.revision, current.revision)
            )
          );
        nextMember = null;
      } else if (memberChanged && input.teamId !== null && input.role) {
        if (!current) {
          const result = await tx.insert(officialChannelTeamMembers).values({
            adminUserId: target.id,
            teamId: input.teamId,
            role: input.role,
            revision: 1,
            updatedByAdminUserId: actor.adminUserId,
          });
          const memberId = Number(
            (result as unknown as [{ insertId?: number }])[0]?.insertId ?? 0
          );
          if (!Number.isSafeInteger(memberId) || memberId <= 0)
            throw new Error("OFFICIAL_TEAM_MEMBER_CREATE_FAILED");
          const [created] = await tx
            .select()
            .from(officialChannelTeamMembers)
            .where(eq(officialChannelTeamMembers.id, memberId))
            .limit(1)
            .for("update");
          if (!created) throw new Error("OFFICIAL_TEAM_MEMBER_CREATE_FAILED");
          nextMember = created;
        } else {
          await tx
            .update(officialChannelTeamMembers)
            .set({
              teamId: input.teamId,
              role: input.role,
              revision: current.revision + 1,
              updatedByAdminUserId: actor.adminUserId,
            })
            .where(
              and(
                eq(officialChannelTeamMembers.id, current.id),
                eq(officialChannelTeamMembers.revision, current.revision)
              )
            );
          const [updated] = await tx
            .select()
            .from(officialChannelTeamMembers)
            .where(eq(officialChannelTeamMembers.id, current.id))
            .limit(1)
            .for("update");
          if (!updated) throw new Error("OFFICIAL_TEAM_MEMBER_UPDATE_FAILED");
          nextMember = updated;
        }
      }

      if (permissionChanged && permissionPlan) {
        await replaceStoredPermissions(
          tx,
          target.id,
          permissionPlan.permissions
        );
        await tx.insert(adminUserPermissionAudits).values({
          adminUserId: target.id,
          operatorAdminUserId: actor.adminUserId,
          operatorName: await lockedActorName(tx, actor),
          beforePermissions: existingStoredPermissions,
          afterPermissions: permissionPlan.permissions,
          ipAddress: null,
          userAgent: null,
        });
      }
      if (memberChanged || permissionChanged) {
        await tx
          .update(adminUsers)
          .set({ sessionVersion: sql`${adminUsers.sessionVersion} + 1` })
          .where(eq(adminUsers.id, target.id));
      }

      const resultingOfficialPermissions = permissionPlan
        ? permissionPlan.officialPermissions
        : currentOfficialPermissions(
            target.adminRole,
            await lockStoredPermissions(tx, target.id)
          );
      const displayName = target.displayName?.trim() || target.username;
      const member =
        nextMember && selectedTeam
          ? memberDto({
              member: nextMember,
              displayName,
              teamName: selectedTeam.name,
              officialPermissions: resultingOfficialPermissions,
            })
          : nextMember
            ? (() => {
                // Unchanged membership can leave selectedTeam null; derive its team name safely.
                return null;
              })()
            : null;
      let finalMember = member;
      if (nextMember && !finalMember) {
        const [team] = await tx
          .select({ name: officialChannelTeams.name })
          .from(officialChannelTeams)
          .where(eq(officialChannelTeams.id, nextMember.teamId))
          .limit(1)
          .for("update");
        if (!team) throw new Error("OFFICIAL_TEAM_NOT_FOUND");
        finalMember = memberDto({
          member: nextMember,
          displayName,
          teamName: team.name,
          officialPermissions: resultingOfficialPermissions,
        });
      }
      const mutation: OfficialTeamMemberMutation = {
        member: finalMember,
        officialPermissions: resultingOfficialPermissions,
        revision: nextMember?.revision ?? 0,
        requestId: input.requestId,
        idempotent: false,
      };
      await appendAudit(tx, {
        action: "official.team-member.set",
        targetId: String(target.id),
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: {
          member: current
            ? {
                adminUserId: current.adminUserId,
                teamId: current.teamId,
                role: current.role,
                revision: current.revision,
              }
            : null,
          officialPermissions: currentOfficialPermissions(
            target.adminRole,
            existingStoredPermissions
          ),
        },
        afterData: {
          result: mutation,
          memberChanged,
          permissionChanged,
          reason:
            "official-team-membership-or-native-official-permissions-updated",
        },
      });
      return mutation;
    });
  } catch (error) {
    return remapTeamUniqueError(error);
  }
}

export const officialTeamsTestUtils = {
  currentOfficialPermissions,
  mergeOfficialInventoryPermissions,
  officialPayloadHash,
};
