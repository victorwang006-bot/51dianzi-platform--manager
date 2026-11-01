import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOfficialRecordAction,
  officialTeamPredicate,
} from "./officialChannelAccess";
import {
  OfficialChannelInventoryError,
  buildOfficialChannelPublicProjection,
  createOfficialChannelStocksCsv,
  officialChannelInventoryTestUtils,
} from "./officialChannelInventory";
import { officialChannelInventoryRouter } from "../routers/officialChannelInventory";

const serviceSource = readFileSync(
  resolve(process.cwd(), "server/services/officialChannelInventory.ts"),
  "utf8"
);

function access(overrides: Record<string, unknown> = {}) {
  return {
    adminUserId: 1001,
    isSuperAdmin: false,
    teamId: 11,
    teamRole: "member" as const,
    permissions: [
      "officialInventory.read",
      "officialInventory.write",
      "officialInventory.publish",
      "officialInventory.note",
    ],
    ...overrides,
  } as any;
}

function callerContext() {
  return {
    user: { id: 1001, role: "admin" },
    adminAccount: {
      id: 1001,
      sessionVersion: 7,
      status: "active",
      adminRole: "operation",
    },
    adminPermissions: [],
    req: { headers: {} },
    res: {},
  } as any;
}

describe("官方渠道库存隔离回归（不连接 MySQL、不写 fixture）", () => {
  it("跨团队记录在实际 access 规则下拒绝读取、修改、发布和备注", () => {
    const anotherTeamRecord = { teamId: 12, ownerAdminUserId: 1001 };
    for (const action of ["read", "manage", "publish", "note"] as const) {
      expect(() =>
        assertOfficialRecordAction(access(), anotherTeamRecord, action)
      ).toThrow();
    }
    expect(() =>
      officialTeamPredicate(access(), "official_channel_stocks")
    ).not.toThrow();
    expect(() =>
      officialTeamPredicate(access({ teamId: null }), "official_channel_stocks")
    ).toThrow();
  });

  it("同组非负责人不能因拥有 write/publish 或 member 身份修改和发布", () => {
    const otherOwnerRecord = { teamId: 11, ownerAdminUserId: 2002 };
    expect(() =>
      assertOfficialRecordAction(access(), otherOwnerRecord, "manage")
    ).toThrow();
    expect(() =>
      assertOfficialRecordAction(access(), otherOwnerRecord, "publish")
    ).toThrow();
    // Same native grant, after a live membership reload changing member -> leader, is the only role transition that opens group management.
    expect(() =>
      assertOfficialRecordAction(
        access({ teamRole: "leader" }),
        otherOwnerRecord,
        "manage"
      )
    ).not.toThrow();
    expect(() =>
      assertOfficialRecordAction(
        access({ teamRole: "leader" }),
        otherOwnerRecord,
        "publish"
      )
    ).not.toThrow();
  });

  it("组长身份不会自动授予任何官方模块权限，角色/权限重验后失败关闭", () => {
    const leaderWithoutGrant = access({
      teamRole: "leader",
      permissions: ["officialInventory.read"],
    });
    const record = { teamId: 11, ownerAdminUserId: 2002 };
    expect(() =>
      assertOfficialRecordAction(leaderWithoutGrant, record, "manage")
    ).toThrow();
    expect(() =>
      assertOfficialRecordAction(leaderWithoutGrant, record, "publish")
    ).toThrow();
    expect(() =>
      assertOfficialRecordAction(leaderWithoutGrant, record, "note")
    ).toThrow();
  });

  it("CAS 使用当前 revision，旧 revision 以库存域冲突码拒绝", () => {
    expect(() =>
      officialChannelInventoryTestUtils.assertExpectedRevision(
        9,
        8,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      )
    ).toThrow(OfficialChannelInventoryError);
    expect(() =>
      officialChannelInventoryTestUtils.assertExpectedRevision(
        9,
        9,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      )
    ).not.toThrow();
    expect(serviceSource).toContain(
      "eq(officialChannelStocks.revision, stock.revision)"
    );
    expect(serviceSource).toContain(
      "eq(officialChannelSources.revision, source.revision)"
    );
  });

  it("requestId 幂等哈希绑定动作、真实 admin 主体和规范化 payload，冲突 payload 无法重放", () => {
    const actor = { adminUserId: 1001, sessionVersion: 7 };
    const sameA = officialChannelInventoryTestUtils.requestPayloadHash(
      "official_stock_publish",
      actor,
      { stockId: 9, expectedRevision: 2 }
    );
    const sameB = officialChannelInventoryTestUtils.requestPayloadHash(
      "official_stock_publish",
      actor,
      { expectedRevision: 2, stockId: 9 }
    );
    const differentActor = officialChannelInventoryTestUtils.requestPayloadHash(
      "official_stock_publish",
      { adminUserId: 1002, sessionVersion: 7 },
      { stockId: 9, expectedRevision: 2 }
    );
    const differentPayload =
      officialChannelInventoryTestUtils.requestPayloadHash(
        "official_stock_publish",
        actor,
        { stockId: 9, expectedRevision: 3 }
      );
    expect(sameA).toBe(sameB);
    expect(differentActor).not.toBe(sameA);
    expect(differentPayload).not.toBe(sameA);
    expect(serviceSource).toContain(
      "SELECT GET_LOCK(${lockName}, 10) AS acquired"
    );
    expect(serviceSource).toContain("OFFICIAL_CHANNEL_REQUEST_ID_REUSED");
    expect(serviceSource).toContain("officialChannelAudits.requestId");
  });

  it("公开投影是固定 factory_channel 安全快照，不含联系方式、团队、负责人或 supplierId", () => {
    const snapshot = buildOfficialChannelPublicProjection(
      {
        partNumber: "STM32F103C8T6",
        brand: "ST",
        qty: 1000,
        dateCode: "2436",
        price: "3.2500",
        currency: "CNY",
        taxIncluded: true,
        leadTime: "现货",
        contactPhone: "13800000000",
        adminName: "内部员工",
        teamId: 11,
        supplierId: 88,
      } as any,
      "ocp_test_public_id"
    );
    expect(snapshot).toEqual({
      listingKind: "factory_channel",
      label: "工厂渠道",
      assistanceLabel: "平台协助询价",
      publicId: "ocp_test_public_id",
      partNumber: "STM32F103C8T6",
      brand: "ST",
      qty: 1000,
      dateCode: "2436",
      price: "3.2500",
      currency: "CNY",
      taxIncluded: true,
      leadTime: "现货",
    });
    expect(Object.keys(snapshot)).not.toEqual(
      expect.arrayContaining([
        "contactPhone",
        "contactName",
        "contactWechat",
        "contactQq",
        "teamId",
        "adminName",
        "supplierId",
      ])
    );
    // Offshelf deletes only the dedicated official projection, never a normal inventory record.
    expect(serviceSource).toMatch(
      /tx\s*\.delete\(officialChannelPublications\)/
    );
    expect(serviceSource).toContain('status: "offshelf"');
  });

  it("浏览器无法把字符串/越界 ID、团队、负责人或创建人伪造成 createStock 输入", async () => {
    const caller = officialChannelInventoryRouter.createCaller(callerContext());
    await expect(
      caller.createStock({
        requestId: "official-stock-create-01",
        sourceId: "11",
        partNumber: "LM358",
        brand: "TI",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.createStock({
        requestId: "official-stock-create-02",
        sourceId: 11,
        partNumber: "LM358",
        brand: "TI",
        teamId: 999,
        ownerAdminUserId: 222,
        createdByAdminUserId: 333,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("导出 CSV 防公式注入且不在导出字段中包含私有电话/联系人", () => {
    const csv = createOfficialChannelStocksCsv([
      {
        id: 1,
        sourceName: '=HYPERLINK("https://example.invalid","click")',
        sourceType: "factory",
        partNumber: "+SUM(1,1)",
        brand: "ST",
        qty: 10,
        dateCode: "2436",
        price: "1.2",
        currency: "CNY",
        taxIncluded: true,
        leadTime: "现货",
        status: "draft",
        responsibleName: "负责人",
        createdAt: "2026-11-01T00:00:00.000Z",
        publishedAt: null,
        phone: "13800000000",
        contactName: "私人联系人",
      },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(1,1)");
    expect(csv).not.toContain("13800000000");
    expect(csv).not.toContain("私人联系人");
  });
});
