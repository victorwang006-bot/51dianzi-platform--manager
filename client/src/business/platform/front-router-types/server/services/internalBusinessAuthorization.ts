import { createHash } from "node:crypto";
import type { EnterprisePermissionScope } from "./enterprisePermissions";
import type { BusinessModuleAccess } from "../../../shared/businessOrganization";

/** No inferred admin ID, no first-row fallback on missing/ambiguous team identity. */
export function effectiveBusinessTeam(rows: readonly Record<string, unknown>[]) {
  if (rows.length !== 1) return { teamId: null, teamRole: null };
  const teamId = Number(rows[0].teamId);
  const teamRole = rows[0].teamRole;
  if (!Number.isSafeInteger(teamId) || teamId <= 0 || (teamRole !== "leader" && teamRole !== "member")) {
    return { teamId: null, teamRole: null };
  }
  return { teamId, teamRole };
}

/** Opaque authorization state only: excludes clocks, profiles and browser fields. */
export function internalBusinessAuthorizationVersion(input: {
  scope: EnterprisePermissionScope;
  team: ReturnType<typeof effectiveBusinessTeam>;
  modules: readonly { module: string; access: BusinessModuleAccess }[];
}) {
  const { scope, team } = input;
  const state = {
    schemaVersion: 1,
    enterpriseId: scope.enterprise.id,
    dataOwnerUserId: scope.dataOwnerUserId,
    portalOwnerUserId: scope.portalOwnerUserId,
    memberId: scope.member.id,
    userId: scope.member.userId,
    role: scope.member.role,
    status: scope.member.status,
    inventoryDataScope: scope.member.inventoryDataScope,
    permissionVersion: scope.member.permissionVersion,
    isOwner: scope.isOwner,
    teamId: team.teamId,
    teamRole: team.teamRole,
    permissionKeys: Array.from(new Set(scope.permissionKeys)).sort(),
    modules: input.modules.map(({ module, access }) => ({
      module, read: access.read, write: access.write, scope: access.scope,
    })).sort((a, b) => a.module.localeCompare(b.module)),
  };
  return `business-auth-v1:${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
}
