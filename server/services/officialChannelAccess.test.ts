import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { officialChannelStocks } from "../../drizzle/officialChannelSchema";
import {
  assertOfficialRecordAction,
  officialTeamPredicate,
  requireOfficialAdminAccount,
  type OfficialAccess,
} from "./officialChannelAccess";
import type { TrpcContext } from "../_core/context";

const baseAccess: OfficialAccess = {
  adminUserId: 71,
  isSuperAdmin: false,
  teamId: 11,
  teamRole: "member",
  permissions: [
    "officialInventory.read",
    "officialInventory.write",
    "officialInventory.publish",
    "officialInventory.note",
  ],
};
const sameTeamOtherOwner = { teamId: 11, ownerAdminUserId: 72 };

function codeOf(run: () => void) {
  try {
    run();
  } catch (error) {
    return error instanceof TRPCError ? error.code : "OTHER";
  }
  return "NONE";
}

describe("官方渠道访问边界（隔离）", () => {
  it("队员可读同组并只追加内部备注，不能凭团队身份编辑或发布他人记录", () => {
    expect(() =>
      assertOfficialRecordAction(baseAccess, sameTeamOtherOwner, "read")
    ).not.toThrow();
    expect(() =>
      assertOfficialRecordAction(baseAccess, sameTeamOtherOwner, "note")
    ).not.toThrow();
    expect(
      codeOf(() =>
        assertOfficialRecordAction(baseAccess, sameTeamOtherOwner, "manage")
      )
    ).toBe("FORBIDDEN");
    expect(
      codeOf(() =>
        assertOfficialRecordAction(baseAccess, sameTeamOtherOwner, "publish")
      )
    ).toBe("FORBIDDEN");
  });

  it("组长仍须有原生模块权限，不能仅因 role=leader 放行", () => {
    const leaderWithoutPublish: OfficialAccess = {
      ...baseAccess,
      teamRole: "leader",
      permissions: ["officialInventory.read", "officialInventory.write"],
    };
    expect(() =>
      assertOfficialRecordAction(
        leaderWithoutPublish,
        sameTeamOtherOwner,
        "manage"
      )
    ).not.toThrow();
    expect(
      codeOf(() =>
        assertOfficialRecordAction(
          leaderWithoutPublish,
          sameTeamOtherOwner,
          "publish"
        )
      )
    ).toBe("FORBIDDEN");
  });

  it("不同团队、无团队和 legacy 未归属记录对普通员工均为非枚举式拒绝", () => {
    expect(
      codeOf(() =>
        assertOfficialRecordAction(
          baseAccess,
          { teamId: 12, ownerAdminUserId: 71 },
          "read"
        )
      )
    ).toBe("FORBIDDEN");
    expect(
      codeOf(() =>
        assertOfficialRecordAction(
          baseAccess,
          { teamId: null, ownerAdminUserId: 71 },
          "read"
        )
      )
    ).toBe("FORBIDDEN");
    expect(
      codeOf(() =>
        officialTeamPredicate(
          { ...baseAccess, teamId: null },
          officialChannelStocks
        )
      )
    ).toBe("FORBIDDEN");
  });

  it("真实 super_admin 仅在官方域拥有全团队范围，普通表对象谓词仍通过 SQL 层生成", () => {
    const superAdmin: OfficialAccess = {
      ...baseAccess,
      isSuperAdmin: true,
      teamId: null,
      teamRole: null,
      permissions: ["officialInventory.read"],
    };
    expect(() =>
      assertOfficialRecordAction(
        superAdmin,
        { teamId: null, ownerAdminUserId: null },
        "read"
      )
    ).not.toThrow();
    expect(() =>
      officialTeamPredicate(baseAccess, officialChannelStocks)
    ).not.toThrow();
    expect(() =>
      officialTeamPredicate(baseAccess, "stock_scope", "teamId")
    ).not.toThrow();
  });

  it("OAuth 兼容管理员不能构造官方主体", () => {
    const oauthContext = {
      user: { role: "admin" },
      adminAccount: null,
    } as unknown as TrpcContext;
    expect(() => requireOfficialAdminAccount(oauthContext)).toThrow(TRPCError);
  });
});
