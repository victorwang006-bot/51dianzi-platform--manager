import { describe, expect, it } from "vitest";
import type {
  StaffRow,
  StaffBusinessContext,
} from "@/lib/staffPermissionModel";
import { readOfficialTeamsOverview } from "@/lib/officialChannelInventoryUi";
import type { StaffOrganizationOverview } from "@shared/staffOrganization";
import { readCachedStaffBusinessTeams, readStaffBusinessTeams, staffTeamLabels } from "./StaffTeamSummary";
const context: StaffBusinessContext = {
  merchantId: 30061,
  enterpriseId: 1,
  frontendUserId: 397751,
  capabilities: [],
  writeCapabilities: [],
};
const rawBusiness = {
  enterprise: { id: 1, name: "智捷" },
  actorUserId: 397751,
  canManage: true,
  teams: [{ id: 1, name: "业务团队", status: "active" }],
  members: [{ userId: 409506, teamId: 1, teamRole: "leader" }],
};
const row = {
  admin: { id: 30009, displayName: "Ocean" },
  bindingState: "bound",
  binding: { adminUserId: 30009, frontUserId: 409506, bindingVersion: 1 },
} as StaffRow;
const operations = {
  canManage: true,
  actorAdminUserId: 30004,
  teams: [{ id: 1, name: "平台运营团队", status: "active" }],
  members: [{ adminUserId: 30009, teamId: 1, teamRole: "leader" }],
} as StaffOrganizationOverview;
const official = readOfficialTeamsOverview({
  teams: [{ id: 1, name: "旧官方团队", status: "active", revision: 1 }],
  members: [
    {
      adminUserId: 30009,
      teamId: 1,
      teamName: "旧官方团队",
      role: "member",
      revision: 1,
    },
  ],
  currentAccess: { adminUserId: 30004, isSuperAdmin: true, permissions: [] },
});
const props = {
  row,
  operations,
  official,
  business: readStaffBusinessTeams(rawBusiness, context),
  operationsState: "",
  officialState: "",
  businessState: "",
};
describe("staff team domain display", () => {
  it("shows real operations, official and bound business teams without combining identical IDs", () => {
    expect(staffTeamLabels(props)).toEqual([
      "运营 · 平台运营团队 · 组长",
      "官方渠道 · 旧官方团队 · 队员",
      "业务 · 业务团队 · 组长",
    ]);
  });
  it("does not guess a business identity by matching names", () => {
    expect(
      staffTeamLabels({
        ...props,
        row: { ...row, binding: null, bindingState: "unbound" },
      })[2]
    ).toBe("业务 · 待关联");
  });
  it("does not present failed, hidden or missing data as ungrouped", () => {
    expect(
      staffTeamLabels({
        ...props,
        operationsState: "不可用",
        officialState: "不可用",
        businessState: "不可用",
      })
    ).toEqual(["运营 · 不可用", "官方渠道 · 不可用", "业务 · 不可用"]);
    expect(
      staffTeamLabels({
        ...props,
        operations: { ...operations, members: [] },
        business: { ...props.business, members: [] },
      })
    ).toEqual([
      "运营 · 范围内无记录",
      "官方渠道 · 旧官方团队 · 队员",
      "业务 · 范围内无记录",
    ]);
  });
  it("only reports ungrouped when a real returned member has no team", () => {
    expect(
      staffTeamLabels({
        ...props,
        operations: {
          ...operations,
          members: [{ ...operations.members[0], teamId: null, teamRole: null }],
        },
      })[0]
    ).toBe("运营 · 未分组");
  });
  it("revalidates cached A against the current context, even for the same admin and merchant", () => {
    const cachedA = readStaffBusinessTeams(rawBusiness, context);
    expect(readCachedStaffBusinessTeams(cachedA, context)).toEqual(cachedA);
    for (const current of [
      { ...context, frontendUserId: context.frontendUserId + 1 },
      { ...context, enterpriseId: context.enterpriseId + 1 },
      null,
    ]) {
      const business = readCachedStaffBusinessTeams(cachedA, current);
      expect(business).toBeUndefined();
      expect(staffTeamLabels({ ...props, business, businessState: "不可用" })[2])
        .toBe("业务 · 不可用");
    }
    expect(readCachedStaffBusinessTeams(undefined, context)).toBeUndefined();
  });
  it("rejects overview from another enterprise or business actor", () => {
    expect(() =>
      readStaffBusinessTeams(
        { ...rawBusiness, enterprise: { id: 2, name: "Other" } },
        context
      )
    ).toThrow("业务团队与当前企业不一致");
    expect(() =>
      readStaffBusinessTeams({ ...rawBusiness, actorUserId: 22 }, context)
    ).toThrow("业务团队与当前企业不一致");
    expect(() => readStaffBusinessTeams(rawBusiness, null)).toThrow();
  });
});
