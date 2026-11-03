import type {
  StaffBusinessContext,
  StaffRow,
} from "@/lib/staffPermissionModel";
import type { OfficialTeamsOverview } from "@/lib/officialChannelInventoryUi";
import type { StaffOrganizationOverview } from "@shared/staffOrganization";
import React from "react";
import { z } from "zod";

const businessTeamsSchema = z.object({
  enterprise: z.object({ id: z.number().int().positive(), name: z.string() }),
  actorUserId: z.number().int().positive(),
  canManage: z.boolean(),
  teams: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      status: z.string(),
    })
  ),
  members: z.array(
    z.object({
      userId: z.number().int().positive(),
      teamId: z.number().int().positive().nullable(),
      teamRole: z.enum(["member", "leader"]).nullable(),
    })
  ),
});
export type StaffBusinessTeams = z.infer<typeof businessTeamsSchema>;
export function readStaffBusinessTeams(
  value: unknown,
  context: StaffBusinessContext | null
): StaffBusinessTeams {
  const result = businessTeamsSchema.parse(value);
  if (
    !context ||
    result.enterprise.id !== context.enterpriseId ||
    result.actorUserId !== context.frontendUserId
  )
    throw new Error("业务团队与当前企业不一致");
  return result;
}
/** Cached data is untrusted after an identity/context transition. */
export function readCachedStaffBusinessTeams(
  value: unknown,
  context: StaffBusinessContext | null
): StaffBusinessTeams | undefined {
  try {
    return readStaffBusinessTeams(value, context);
  } catch {
    return undefined;
  }
}
const roleLabel = (role: string | null) =>
  role === "leader" ? "组长" : "队员";
export function staffTeamLabels({
  row,
  operations,
  official,
  business,
  operationsState,
  officialState,
  businessState,
}: {
  row: StaffRow;
  operations?: StaffOrganizationOverview;
  official: OfficialTeamsOverview;
  business?: StaffBusinessTeams;
  operationsState: string;
  officialState: string;
  businessState: string;
}): string[] {
  const labels: string[] = [];
  if (row.admin) {
    const native = operations?.members.find(
      member => member.adminUserId === row.admin!.id
    );
    const nativeTeam = operations?.teams.find(
      team => team.id === native?.teamId
    );
    labels.push(
      `运营 · ${operationsState || (native ? (native.teamId ? (nativeTeam ? `${nativeTeam.name} · ${roleLabel(native.teamRole)}` : "团队不可见") : "未分组") : "范围内无记录")}`
    );
    const member = official.members.find(
      member => member.adminUserId === row.admin!.id
    );
    if (member || officialState) {
      labels.push(
        `历史官方团队（不参与渠道共享） · ${officialState || (member?.teamName ? `${member.teamName} · ${roleLabel(member.role)}` : "未分组")}`
      );
    }
  }
  // A current binding is the only link from an admin account to a business user.
  const frontId = row.admin
    ? row.bindingState === "bound"
      ? row.binding?.frontUserId
      : null
    : row.member?.userId;
  let businessLabel: string;
  if (row.admin && !frontId)
    businessLabel = row.bindingState === "unbound" ? "待关联" : "关联未核验";
  else if (businessState) businessLabel = businessState;
  else {
    const member = business?.members.find(member => member.userId === frontId);
    const team = business?.teams.find(team => team.id === member?.teamId);
    businessLabel = member
      ? member.teamId
        ? team
          ? `${team.name} · ${roleLabel(member.teamRole)}`
          : "团队不可见"
        : "未分组"
      : "范围内无记录";
  }
  labels.push(`渠道库存 / 业务 · ${businessLabel}`);
  return labels;
}
export default function StaffTeamSummary(
  props: Parameters<typeof staffTeamLabels>[0]
) {
  return (
    <div className="space-y-0.5 text-sm">
      {staffTeamLabels(props).map(label => (
        <span
          key={label}
          className="block truncate text-muted-foreground"
          title={label}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
