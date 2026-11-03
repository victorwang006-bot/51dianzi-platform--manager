import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adminUserPermissionAudits,
  adminUserPermissions,
  adminUsers,
} from "../../drizzle/schema";
import {
  staffOrganizationAudits as audits,
  staffOrganizationMembers as members,
  staffOrganizationTeams as teams,
} from "../../drizzle/staffOrganizationSchema";
import { resolveAdminPermissions } from "../../shared/adminPermissions";
import {
  STAFF_OPERATIONS_PERMISSIONS,
  STAFF_OPERATIONS_TEMPLATES,
  STAFF_OPERATIONS_TEMPLATE_VERSION,
  mergeStaffOperationsTemplate,
  staffOrganizationApplyTemplateInput,
  staffOrganizationAuditInput,
  staffOrganizationCreateTeamInput,
  staffOrganizationSetMemberInput,
  staffOrganizationUpdateTeamInput,
  type ApplyStaffTemplateInput,
  type CreateStaffTeamInput,
  type SetStaffMemberInput,
  type StaffOrganizationOverview,
  type StaffTeamDto,
  type UpdateStaffTeamInput,
} from "../../shared/staffOrganization";
import { getDb } from "../db";

export type StaffOrganizationActor = {
  adminUserId: number;
  sessionVersion: number;
};
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type StaffOrganizationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type Team = typeof teams.$inferSelect;
type MutationResult = {
  revision: number;
  targetId: number;
  requestId: string;
  idempotent: boolean;
};
function fail(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}
async function transaction<T>(
  run: (tx: StaffOrganizationTransaction) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) fail("SERVICE_UNAVAILABLE", "运营组织数据库暂不可用");
  return db.transaction(run);
}
/** The signed session version is independently rechecked against a locked, current DB row. */
export async function loadStaffOrganizationActor(
  tx: StaffOrganizationTransaction,
  actor: StaffOrganizationActor,
  manage = false
) {
  if (
    !Number.isSafeInteger(actor.adminUserId) ||
    actor.adminUserId < 1 ||
    !Number.isSafeInteger(actor.sessionVersion) ||
    actor.sessionVersion < 1
  )
    fail("UNAUTHORIZED", "运营身份无效");
  const [account] = await tx
    .select({
      id: adminUsers.id,
      displayName: adminUsers.displayName,
      username: adminUsers.username,
      adminRole: adminUsers.adminRole,
      status: adminUsers.status,
      sessionVersion: adminUsers.sessionVersion,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, actor.adminUserId))
    .limit(1)
    .for("update");
  if (
    !account ||
    account.status !== "active" ||
    account.sessionVersion !== actor.sessionVersion
  )
    fail("UNAUTHORIZED", "后台账号状态或会话已变化，请重新登录");
  if (manage && account.adminRole !== "super_admin")
    fail("FORBIDDEN", "只有真实后台超级管理员可以配置运营组织");
  return account;
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
export function staffOrganizationPayloadHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
function auditObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const decoded: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    fail("INTERNAL_SERVER_ERROR", "审计数据格式无效");
  return decoded as Record<string, unknown>;
}
function teamDto(row: Team): StaffTeamDto {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    status: row.status,
    revision: row.revision,
  };
}
function affected(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object")
    return 0;
  return Number((result[0] as { affectedRows?: number }).affectedRows ?? 0);
}
function assertCas(result: unknown) {
  if (affected(result) !== 1)
    fail("CONFLICT", "配置已变化，请刷新后重新预览并保存");
}
async function storedPermissions(
  tx: StaffOrganizationTransaction,
  adminUserId: number
) {
  return (
    await tx
      .select({ permission: adminUserPermissions.permission })
      .from(adminUserPermissions)
      .where(eq(adminUserPermissions.adminUserId, adminUserId))
      .orderBy(asc(adminUserPermissions.id))
      .for("update")
  ).map(row => row.permission);
}
async function currentMember(
  tx: StaffOrganizationTransaction,
  adminUserId: number
) {
  const [row] = await tx
    .select()
    .from(members)
    .where(eq(members.adminUserId, adminUserId))
    .limit(1)
    .for("update");
  return row ?? null;
}
async function memberRevision(
  tx: StaffOrganizationTransaction,
  adminUserId: number,
  expectedRevision: number
) {
  const current = await currentMember(tx, adminUserId);
  if ((current?.revision ?? 0) !== expectedRevision)
    fail("CONFLICT", "员工配置版本已变化，请刷新后重新预览");
  return current;
}
async function saveMember(
  tx: StaffOrganizationTransaction,
  actor: StaffOrganizationActor,
  adminUserId: number,
  current: Awaited<ReturnType<typeof currentMember>>,
  teamId: number | null,
  role: "member" | "leader" | null
) {
  const revision = (current?.revision ?? 0) + 1;
  if (current)
    assertCas(
      await tx
        .update(members)
        .set({
          teamId,
          role,
          revision,
          updatedByAdminUserId: actor.adminUserId,
        })
        .where(
          and(
            eq(members.adminUserId, adminUserId),
            eq(members.revision, current.revision)
          )
        )
    );
  else
    await tx.insert(members).values({
      adminUserId,
      teamId,
      role,
      revision,
      updatedByAdminUserId: actor.adminUserId,
    });
  return revision;
}
async function lockTarget(
  tx: StaffOrganizationTransaction,
  adminUserId: number
) {
  const [account] = await tx
    .select({
      id: adminUsers.id,
      adminRole: adminUsers.adminRole,
      status: adminUsers.status,
      sessionVersion: adminUsers.sessionVersion,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId))
    .limit(1)
    .for("update");
  if (!account) fail("NOT_FOUND", "后台员工不存在");
  if (account.status !== "active")
    fail("PRECONDITION_FAILED", "员工已停用或锁定，不能配置");
  return account;
}
async function lockTeams(tx: StaffOrganizationTransaction, ids: number[]) {
  if (!ids.length) return [];
  return tx
    .select()
    .from(teams)
    .where(
      inArray(
        teams.id,
        Array.from(new Set(ids)).sort((a, b) => a - b)
      )
    )
    .orderBy(asc(teams.id))
    .for("update");
}
/** Actor-row locking serializes request replay for the same actor; global unique requestId rejects cross-actor collisions. */
async function mutate(
  actor: StaffOrganizationActor,
  action: string,
  targetType: "team" | "member",
  input: { requestId: string },
  payload: unknown,
  run: (tx: StaffOrganizationTransaction) => Promise<{
    targetId: number;
    revision: number;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }>
): Promise<MutationResult> {
  return transaction(async tx => {
    await loadStaffOrganizationActor(tx, actor, true);
    const payloadHash = staffOrganizationPayloadHash({ action, payload });
    const [replay] = await tx
      .select()
      .from(audits)
      .where(eq(audits.requestId, input.requestId))
      .limit(1)
      .for("update");
    if (replay) {
      if (
        replay.actorAdminUserId !== actor.adminUserId ||
        replay.action !== action ||
        replay.targetType !== targetType ||
        replay.payloadHash !== payloadHash
      )
        fail("CONFLICT", "请求号已用于其他操作");
      const after = auditObject(replay.afterData);
      const revision = Number(after?.revision);
      if (!Number.isSafeInteger(revision))
        fail("INTERNAL_SERVER_ERROR", "审计重放数据无效");
      return {
        targetId: replay.targetId,
        revision,
        requestId: input.requestId,
        idempotent: true,
      };
    }
    const outcome = await run(tx);
    await tx.insert(audits).values({
      action,
      targetType,
      targetId: outcome.targetId,
      actorAdminUserId: actor.adminUserId,
      requestId: input.requestId,
      payloadHash,
      beforeData: outcome.before,
      afterData: { ...outcome.after, revision: outcome.revision },
    });
    return {
      targetId: outcome.targetId,
      revision: outcome.revision,
      requestId: input.requestId,
      idempotent: false,
    };
  });
}

export async function getStaffOrganizationOverview(
  actor: StaffOrganizationActor
): Promise<StaffOrganizationOverview> {
  return transaction(async tx => {
    const account = await loadStaffOrganizationActor(tx, actor);
    const canManage = account.adminRole === "super_admin";
    const ownMembership = canManage
      ? null
      : await currentMember(tx, account.id);
    // Non-super users only receive their own identity/configuration, not their teammates' private grants.
    const accounts = await tx
      .select({
        id: adminUsers.id,
        displayName: adminUsers.displayName,
        username: adminUsers.username,
        status: adminUsers.status,
        adminRole: adminUsers.adminRole,
        sessionVersion: adminUsers.sessionVersion,
        teamId: members.teamId,
        teamRole: members.role,
        revision: members.revision,
      })
      .from(adminUsers)
      .leftJoin(members, eq(members.adminUserId, adminUsers.id))
      .where(canManage ? undefined : eq(adminUsers.id, account.id))
      .orderBy(asc(adminUsers.id));
    const visibleTeams = canManage
      ? await tx.select().from(teams).orderBy(asc(teams.id))
      : ownMembership?.teamId
        ? await tx
            .select()
            .from(teams)
            .where(eq(teams.id, ownMembership.teamId))
        : [];
    const ids = accounts.map(row => row.id);
    const grants = ids.length
      ? await tx
          .select({
            adminUserId: adminUserPermissions.adminUserId,
            permission: adminUserPermissions.permission,
          })
          .from(adminUserPermissions)
          .where(inArray(adminUserPermissions.adminUserId, ids))
      : [];
    return {
      teams: visibleTeams.map(teamDto),
      canManage,
      actorAdminUserId: account.id,
      templates: STAFF_OPERATIONS_TEMPLATES,
      members: accounts.map(row => {
        const permissions = resolveAdminPermissions(
          row.adminRole,
          grants
            .filter(grant => grant.adminUserId === row.id)
            .map(grant => grant.permission)
        );
        return {
          adminUserId: row.id,
          displayName: row.displayName?.trim() || row.username,
          username: row.username,
          status: row.status,
          adminRole: row.adminRole,
          teamId: row.teamId ?? null,
          teamRole: row.teamRole ?? null,
          revision: row.revision ?? 0,
          sessionVersion: row.sessionVersion,
          permissions,
          operationsPermissions: STAFF_OPERATIONS_PERMISSIONS.filter(key =>
            permissions.includes(key)
          ),
        };
      }),
    };
  });
}
export async function createStaffOrganizationTeam(
  actor: StaffOrganizationActor,
  raw: CreateStaffTeamInput
) {
  const input = staffOrganizationCreateTeamInput.parse(raw);
  return mutate(
    actor,
    "staff.team.create",
    "team",
    input,
    { name: input.name, notes: input.notes ?? "" },
    async tx => {
      const result = await tx.insert(teams).values({
        name: input.name,
        notes: input.notes || null,
        createdByAdminUserId: actor.adminUserId,
        revision: 1,
        status: "active",
      });
      const targetId = Number(result[0].insertId);
      if (!Number.isSafeInteger(targetId) || targetId < 1)
        fail("INTERNAL_SERVER_ERROR", "团队创建失败");
      return {
        targetId,
        revision: 1,
        before: null,
        after: {
          name: input.name,
          notes: input.notes || null,
          status: "active",
        },
      };
    }
  );
}
export async function updateStaffOrganizationTeam(
  actor: StaffOrganizationActor,
  raw: UpdateStaffTeamInput
) {
  const input = staffOrganizationUpdateTeamInput.parse(raw);
  return mutate(
    actor,
    "staff.team.update",
    "team",
    input,
    {
      id: input.id,
      name: input.name,
      notes: input.notes ?? "",
      status: input.status,
      expectedRevision: input.expectedRevision,
    },
    async tx => {
      const [current] = await lockTeams(tx, [input.id]);
      if (!current) fail("NOT_FOUND", "运营团队不存在");
      if (current.revision !== input.expectedRevision)
        fail("CONFLICT", "团队版本已变化，请刷新后重新预览");
      if (input.status === "archived") {
        const [member] = await tx
          .select({ id: members.adminUserId })
          .from(members)
          .where(eq(members.teamId, current.id))
          .limit(1)
          .for("update");
        if (member)
          fail("PRECONDITION_FAILED", "团队仍有成员，请先显式调组或移出");
      }
      const revision = current.revision + 1;
      assertCas(
        await tx
          .update(teams)
          .set({
            name: input.name,
            notes: input.notes || null,
            status: input.status,
            revision,
          })
          .where(
            and(eq(teams.id, current.id), eq(teams.revision, current.revision))
          )
      );
      return {
        targetId: current.id,
        revision,
        before: teamDto(current),
        after: {
          name: input.name,
          notes: input.notes || null,
          status: input.status,
        },
      };
    }
  );
}
export async function setStaffOrganizationMember(
  actor: StaffOrganizationActor,
  raw: SetStaffMemberInput
) {
  const input = staffOrganizationSetMemberInput.parse(raw);
  return mutate(
    actor,
    "staff.member.set",
    "member",
    input,
    {
      adminUserId: input.adminUserId,
      teamId: input.teamId,
      role: input.role,
      expectedRevision: input.expectedRevision,
    },
    async tx => {
      await lockTarget(tx, input.adminUserId);
      const current = await memberRevision(
        tx,
        input.adminUserId,
        input.expectedRevision
      );
      const teamIds = [current?.teamId, input.teamId].filter(
        (id): id is number => id != null
      );
      const selected = await lockTeams(tx, teamIds);
      if (
        input.teamId !== null &&
        !selected.some(
          team => team.id === input.teamId && team.status === "active"
        )
      )
        fail("PRECONDITION_FAILED", "只能加入已启用的运营团队");
      // There is deliberately no unique leader index or implicit permission write.
      const revision = await saveMember(
        tx,
        actor,
        input.adminUserId,
        current,
        input.teamId,
        input.role
      );
      for (const team of selected)
        assertCas(
          await tx
            .update(teams)
            .set({ revision: team.revision + 1 })
            .where(
              and(eq(teams.id, team.id), eq(teams.revision, team.revision))
            )
        );
      // Membership does not confer any authority. Do not revoke the super-admin's own session merely for a team label.
      return {
        targetId: input.adminUserId,
        revision,
        before: {
          teamId: current?.teamId ?? null,
          role: current?.role ?? null,
          revision: current?.revision ?? 0,
        },
        after: {
          teamId: input.teamId,
          role: input.role,
          permissionsChanged: false,
        },
      };
    }
  );
}
export async function applyStaffOrganizationTemplate(
  actor: StaffOrganizationActor,
  raw: ApplyStaffTemplateInput
) {
  const input = staffOrganizationApplyTemplateInput.parse(raw);
  return mutate(
    actor,
    "staff.template.apply",
    "member",
    input,
    {
      adminUserId: input.adminUserId,
      templateId: input.templateId,
      expectedRevision: input.expectedRevision,
      expectedSessionVersion: input.expectedSessionVersion,
    },
    async tx => {
      const target = await lockTarget(tx, input.adminUserId);
      if (target.adminRole === "super_admin")
        fail("FORBIDDEN", "超级管理员的账号级别与模块权利不可通过运营模板修改");
      if (target.id === actor.adminUserId)
        fail("FORBIDDEN", "不可修改自身系统权限身份");
      // Legacy adminUser.update changes native grants/role/status and bumps this
      // version without touching organization membership. Lock + compare both.
      if (target.sessionVersion !== input.expectedSessionVersion)
        fail("CONFLICT", "员工权限或会话版本已变化，请刷新后重新预览");
      const current = await memberRevision(
        tx,
        target.id,
        input.expectedRevision
      );
      const template = STAFF_OPERATIONS_TEMPLATES.find(
        item => item.id === input.templateId
      );
      if (!template) fail("BAD_REQUEST", "运营模板不存在");
      const before = await storedPermissions(tx, target.id);
      const after = mergeStaffOperationsTemplate(
        target.adminRole,
        before,
        template.permissions
      );
      await tx
        .delete(adminUserPermissions)
        .where(eq(adminUserPermissions.adminUserId, target.id));
      await tx
        .insert(adminUserPermissions)
        .values(
          after.map(permission => ({ adminUserId: target.id, permission }))
        );
      await tx.insert(adminUserPermissionAudits).values({
        adminUserId: target.id,
        operatorAdminUserId: actor.adminUserId,
        beforePermissions: before,
        afterPermissions: after,
      });
      await tx
        .update(adminUsers)
        .set({ sessionVersion: sql`${adminUsers.sessionVersion} + 1` })
        .where(eq(adminUsers.id, target.id));
      const revision = await saveMember(
        tx,
        actor,
        target.id,
        current,
        current?.teamId ?? null,
        current?.role ?? null
      );
      return {
        targetId: target.id,
        revision,
        before: {
          permissions: before,
          effectivePermissions: resolveAdminPermissions(
            target.adminRole,
            before
          ),
          revision: current?.revision ?? 0,
        },
        after: {
          permissions: after,
          templateId: template.id,
          templateVersion: STAFF_OPERATIONS_TEMPLATE_VERSION,
          businessAuthorizationChanged: false,
        },
      };
    }
  );
}
export async function getStaffOrganizationAudit(
  actor: StaffOrganizationActor,
  raw: { page: number; pageSize: number }
) {
  const input = staffOrganizationAuditInput.parse(raw);
  return transaction(async tx => {
    const account = await loadStaffOrganizationActor(tx, actor);
    const canManage = account.adminRole === "super_admin";
    const predicate = canManage
      ? undefined
      : and(eq(audits.targetType, "member"), eq(audits.targetId, account.id));
    const [total] = await tx
      .select({ value: count() })
      .from(audits)
      .where(predicate);
    const data = await tx
      .select()
      .from(audits)
      .where(predicate)
      .orderBy(desc(audits.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return {
      actorAdminUserId: account.id,
      page: input.page,
      pageSize: input.pageSize,
      total: total.value,
      data: data.map(row => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        actorAdminUserId: canManage ? row.actorAdminUserId : null,
        requestId: canManage ? row.requestId : null,
        payloadHash: canManage ? row.payloadHash : null,
        beforeData: auditObject(row.beforeData),
        afterData: auditObject(row.afterData),
        createdAt: row.createdAt,
      })),
    };
  });
}
