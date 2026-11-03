import { describe, expect, it } from "vitest";
import {
  readOfficialPermissionTarget,
  readOfficialTeamMemberMutation,
  readOfficialTeamsOverview,
} from "./officialChannelInventoryUi";

const target = {
  adminUserId: 92002,
  displayName: "合成员工",
  officialPermissions: ["officialInventory.read"],
  accountVersion: 12,
};
const overview = {
  teams: [],
  members: [],
  targets: [target],
  currentAccess: {
    adminUserId: 91001,
    isSuperAdmin: true,
    teamId: null,
    teamRole: null,
    permissions: ["officialTeams.manage"],
  },
};
const receipt = {
  member: null,
  officialPermissions: ["officialInventory.read"],
  revision: 0,
  accountVersion: 13,
  requestId: "synthetic_save_v13",
  idempotent: false,
};

describe("官方授权目标与保存回执解码 v13", () => {
  it("未分组账号回显真实权限和版本，不构造成官方成员", () => {
    const parsed = readOfficialTeamsOverview(overview);
    expect(parsed.available).toBe(true);
    expect(parsed.members).toEqual([]);
    expect(parsed.targets).toEqual([target]);
  });

  it("旧概览没有targets时保持members兼容但不制造可信版本", () => {
    const { targets: _, ...legacy } = overview;
    const parsed = readOfficialTeamsOverview({
      ...legacy,
      members: [
        {
          adminUserId: target.adminUserId,
          displayName: target.displayName,
          teamId: 99003,
          teamName: "历史官方团队",
          role: "member",
          revision: 4,
          officialPermissions: target.officialPermissions,
        },
      ],
    });
    expect(parsed.available).toBe(true);
    expect(parsed.members).toHaveLength(1);
    expect(parsed.targets).toEqual([]);
  });

  it.each([
    undefined,
    null,
    -1,
    1.5,
    "12",
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])("非法/缺失版本 %s 不被当成0", accountVersion => {
    const invalid = { ...target, accountVersion };
    expect(readOfficialPermissionTarget(invalid)).toBeNull();
    expect(
      readOfficialTeamsOverview({ ...overview, targets: [invalid] }).targets
    ).toEqual([]);
    expect(
      readOfficialTeamMemberMutation({ ...receipt, accountVersion })
    ).toBeNull();
  });

  it("显式有效版本0被保留而不是与缺失版本混淆", () => {
    expect(
      readOfficialPermissionTarget({ ...target, accountVersion: 0 })
        ?.accountVersion
    ).toBe(0);
    expect(
      readOfficialTeamMemberMutation({ ...receipt, accountVersion: 0 })
        ?.accountVersion
    ).toBe(0);
  });

  it.each([
    { adminUserId: -1 },
    { officialPermissions: undefined },
    { officialPermissions: ["orders.read"] },
    { officialPermissions: [null] },
  ])("目标身份或正式权限数组不完整时拒绝 %j", invalid => {
    expect(readOfficialPermissionTarget({ ...target, ...invalid })).toBeNull();
  });

  it("无可信server scope或非superadmin时不暴露批量targets", () => {
    expect(
      readOfficialTeamsOverview({ ...overview, currentAccess: undefined })
        .targets
    ).toEqual([]);
    expect(
      readOfficialTeamsOverview({
        ...overview,
        currentAccess: { ...overview.currentAccess, isSuperAdmin: false },
      }).targets
    ).toEqual([]);
    expect(readOfficialTeamsOverview(null).targets).toEqual([]);
  });

  it("合法无成员回执保留正式权限、账户版本及成员revision", () => {
    expect(readOfficialTeamMemberMutation(receipt)).toEqual(receipt);
    expect(
      readOfficialTeamMemberMutation({ ...receipt, idempotent: true })
    ).toEqual({ ...receipt, idempotent: true });
  });

  it("合法成员回执保留真实成员和双方revision", () => {
    const member = {
      adminUserId: target.adminUserId,
      displayName: target.displayName,
      teamId: 99003,
      teamName: "历史官方团队",
      role: "member",
      revision: 4,
      officialPermissions: ["officialInventory.read"],
    };
    const withMember = { ...receipt, member, revision: 4 };
    expect(readOfficialTeamMemberMutation(withMember)).toEqual(withMember);
  });

  it.each([
    { member: undefined },
    { revision: undefined },
    { revision: -1 },
    { revision: 4 },
    { requestId: "bad" },
    { idempotent: undefined },
    { officialPermissions: undefined },
    { officialPermissions: ["profile.manage"] },
  ])("不完整/矛盾回执不能被当成成功基线 %j", invalid => {
    expect(
      readOfficialTeamMemberMutation({ ...receipt, ...invalid })
    ).toBeNull();
  });

  it("成员版本或正式权限与顶层回执不一致则拒绝", () => {
    const member = {
      adminUserId: target.adminUserId,
      displayName: target.displayName,
      teamId: 99003,
      teamName: "历史官方团队",
      role: "member",
      revision: 4,
      officialPermissions: ["officialInventory.read"],
    };
    expect(
      readOfficialTeamMemberMutation({ ...receipt, member, revision: 5 })
    ).toBeNull();
    expect(
      readOfficialTeamMemberMutation({
        ...receipt,
        member,
        revision: 4,
        officialPermissions: [],
      })
    ).toBeNull();
    expect(
      readOfficialTeamMemberMutation({
        ...receipt,
        member: { ...member, teamId: null },
        revision: 4,
      })
    ).toBeNull();
  });

  it("合法回执规范化官方能力依赖但不混入其他平台授权", () => {
    expect(
      readOfficialTeamMemberMutation({
        ...receipt,
        officialPermissions: ["officialInventory.note"],
      })?.officialPermissions
    ).toEqual(["officialInventory.read", "officialInventory.note"]);
  });
});
