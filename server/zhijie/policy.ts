import {
  ZHIJIE_CAPABILITIES,
  ZHIJIE_MODULES,
  type ZhijieCapability,
  type ZhijieGrants,
  type ZhijieModuleId,
  type ZhijieRole,
  type ZhijieSourceMember,
  type ZhijieStaffAccess,
  type ZhijieTeam,
} from "@shared/zhijieBusiness";

export type ZhijieScope =
  | { kind: "self"; ownerUserId: number; teamIds: []; label: string }
  | { kind: "team"; ownerUserId: null; teamIds: [number]; label: string }
  | { kind: "teams"; ownerUserId: null; teamIds: number[]; label: string };

export type AccessCandidate = Pick<
  ZhijieStaffAccess,
  "sourceUserId" | "role" | "teamIds" | "grants" | "status"
>;

export interface AccessValidationResult {
  ok: boolean;
  issues: string[];
}

const VALID_ROLES = new Set<ZhijieRole>([
  "employee",
  "team_manager",
  "department_manager",
]);
const VALID_CAPABILITIES = new Set<string>(ZHIJIE_CAPABILITIES);
const moduleById = new Map<ZhijieModuleId, (typeof ZHIJIE_MODULES)[number]>(
  ZHIJIE_MODULES.map(module => [module.id, module])
);

function isIntegerId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasSourcePermission(
  member: ZhijieSourceMember | null | undefined,
  permission: string
): boolean {
  return Boolean(
    member &&
      member.status === "active" &&
      (member.isOwner || member.sourcePermissions.includes(permission))
  );
}

function normalizedTeamIds(teamIds: unknown): number[] | null {
  if (!Array.isArray(teamIds) || !teamIds.every(isIntegerId)) return null;
  const ids = teamIds.map(Number);
  return new Set(ids).size === ids.length ? ids : null;
}

/**
 * The source organization controls whether a mapped person and module are
 * eligible.  This function deliberately never infers permission from a name,
 * platform role, or an empty grant.  It is pure so policy changes are testable
 * without a database connection.
 */
export function validateAccess(
  access: AccessCandidate,
  sourceMember: ZhijieSourceMember | null | undefined,
  teams: readonly ZhijieTeam[]
): AccessValidationResult {
  const issues: string[] = [];
  const teamIds = normalizedTeamIds(access.teamIds);
  const activeTeams = new Map(
    teams.filter(team => team.status === "active").map(team => [team.id, team])
  );

  if (!sourceMember || sourceMember.status !== "active") {
    issues.push("来源成员不存在或已停用");
  } else if (sourceMember.userId !== access.sourceUserId) {
    issues.push("来源成员与来源用户不一致");
  }
  if (!VALID_ROLES.has(access.role)) issues.push("岗位无效");
  if (access.status !== "active" && access.status !== "disabled")
    issues.push("授权状态无效");
  if (!teamIds) {
    issues.push("团队范围无效或包含重复团队");
  } else if (access.role === "employee" && teamIds.length !== 0) {
    // Employees are owner-only.  Carrying team IDs would silently widen scope.
    issues.push("普通员工不得配置团队范围");
  } else if (access.role === "team_manager") {
    const selected =
      teamIds.length === 1 ? activeTeams.get(teamIds[0]) : undefined;
    if (!selected) issues.push("团队经理必须指定一个有效团队");
    if (
      !sourceMember?.teamId ||
      teamIds.length !== 1 ||
      teamIds[0] !== sourceMember.teamId
    ) {
      issues.push("团队经理必须使用来源中的唯一主团队");
    }
    if (
      selected &&
      sourceMember &&
      selected.leaderUserId !== sourceMember.userId
    ) {
      issues.push("团队经理必须是来源团队负责人");
    }
  } else if (access.role === "department_manager") {
    if (teamIds.length === 0) issues.push("部门经理必须配置至少一个团队");
    for (const id of teamIds)
      if (!activeTeams.has(id)) issues.push("部门经理包含不存在或已归档团队");
  }

  if (!isPlainObject(access.grants)) {
    issues.push("模块授权格式无效");
  } else {
    for (const [moduleId, capabilities] of Object.entries(access.grants)) {
      const module = moduleById.get(moduleId as ZhijieModuleId);
      if (!module) {
        issues.push("包含未知业务模块");
        continue;
      }
      if (
        !Array.isArray(capabilities) ||
        capabilities.length === 0 ||
        !capabilities.every(capability =>
          VALID_CAPABILITIES.has(String(capability))
        )
      ) {
        issues.push(`模块 ${moduleId} 的能力无效`);
        continue;
      }
      if (new Set(capabilities).size !== capabilities.length)
        issues.push(`模块 ${moduleId} 的能力重复`);
      if (!hasSourcePermission(sourceMember, module.sourcePermission)) {
        issues.push(`来源未授予 ${moduleId} 对应 ERP 权限`);
      }
      if (
        capabilities.some(capability => capability !== "read") &&
        !capabilities.includes("read")
      )
        issues.push(`模块 ${moduleId} 的操作能力须包含查看权限`);
      if (capabilities.includes("assign") && access.role === "employee")
        issues.push("普通员工不可分配其他成员业务");
      if (
        capabilities.includes("publish") &&
        !hasSourcePermission(sourceMember, "inventory.publish")
      )
        issues.push("来源没有库存发布权限");
      if (
        capabilities.some(
          capability => capability === "template" || capability === "seal"
        ) &&
        (!sourceMember?.isOwner || moduleId !== "templates")
      )
        issues.push("模板和用章仅可向来源企业所有者在合同模块独立授予");
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Resolves the record-owner boundary without granting any module capability.
 * Callers must separately use canAccessModule/canReadModule.  `null` means an
 * invalid or empty scope and must be treated as deny.
 */
export function scopeOwner(
  access: Pick<
    ZhijieStaffAccess,
    "sourceUserId" | "role" | "teamIds" | "status"
  >,
  teams: readonly ZhijieTeam[] = []
): ZhijieScope | null {
  if (access.status !== "active") return null;
  const teamIds = normalizedTeamIds(access.teamIds);
  if (!teamIds) return null;
  if (access.role === "employee") {
    return teamIds.length === 0
      ? {
          kind: "self",
          ownerUserId: access.sourceUserId,
          teamIds: [],
          label: "本人负责",
        }
      : null;
  }
  if (access.role === "team_manager") {
    if (teamIds.length !== 1) return null;
    const team = teams.find(
      candidate => candidate.id === teamIds[0] && candidate.status === "active"
    );
    return team
      ? {
          kind: "team",
          ownerUserId: null,
          teamIds: [team.id],
          label: `团队：${team.name}`,
        }
      : null;
  }
  if (access.role === "department_manager") {
    const activeTeams = new Map(
      teams
        .filter(team => team.status === "active")
        .map(team => [team.id, team])
    );
    if (teamIds.length === 0 || teamIds.some(id => !activeTeams.has(id)))
      return null;
    return {
      kind: "teams",
      ownerUserId: null,
      teamIds,
      label: `授权团队：${teamIds.map(id => activeTeams.get(id)?.name).join("、")}`,
    };
  }
  return null;
}

export function canAccessModule(
  access: Pick<ZhijieStaffAccess, "grants" | "status"> | null | undefined,
  sourceMember: ZhijieSourceMember | null | undefined,
  moduleId: ZhijieModuleId,
  capability: ZhijieCapability
): boolean {
  if (
    !access ||
    access.status !== "active" ||
    !sourceMember ||
    sourceMember.status !== "active"
  )
    return false;
  const module = moduleById.get(moduleId);
  if (!module || !hasSourcePermission(sourceMember, module.sourcePermission))
    return false;
  const capabilities = (access.grants as ZhijieGrants)[moduleId];
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

export function readableModules(
  access: Pick<ZhijieStaffAccess, "grants" | "status"> | null | undefined,
  sourceMember: ZhijieSourceMember | null | undefined
): ZhijieModuleId[] {
  return ZHIJIE_MODULES.filter(module =>
    canAccessModule(access, sourceMember, module.id, "read")
  ).map(module => module.id);
}

export function isZhijieRole(value: unknown): value is ZhijieRole {
  return typeof value === "string" && VALID_ROLES.has(value as ZhijieRole);
}

export function isZhijieCapability(value: unknown): value is ZhijieCapability {
  return typeof value === "string" && VALID_CAPABILITIES.has(value);
}
