import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
// No real database, network, production identity or fixture is ever used.
vi.mock("../db", () => ({ getDb: mockGetDb }));

import { officialTeamsRouter } from "../routers/officialTeams";
import {
  getOfficialTeamsOverview,
  officialPayloadHash,
  setOfficialTeamMember,
  type SetOfficialTeamMemberInput,
} from "./officialTeams";

const actor = { adminUserId: 91001, sessionVersion: 5 };
const activeActor = {
  id: actor.adminUserId,
  adminRole: "super_admin",
  status: "active",
  sessionVersion: actor.sessionVersion,
};
const target = {
  id: 92002,
  username: "synthetic-staff",
  displayName: "合成员工",
  adminRole: "operation",
  status: "active",
  sessionVersion: 12,
};
const input: SetOfficialTeamMemberInput = {
  adminUserId: target.id,
  teamId: null,
  role: null,
  expectedRevision: 0,
  expectedAccountVersion: 12,
  officialPermissions: ["officialInventory.read"],
  requestId: "synthetic_save_v13",
};
const stored = [
  { permission: "materials.read" },
  { permission: "orders.read" },
  { permission: "profile.manage" },
];
const actorAccess = () => [[activeActor], [], []];

/** Ordered Drizzle-shaped reads plus recorded writes, all in memory. */
function database(results: unknown[][]) {
  const queue = [...results];
  const reads: Array<{ table?: string; where?: any; projection?: unknown }> =
    [];
  const writes: Array<{
    kind: string;
    table: string;
    value?: any;
    where?: any;
  }> = [];
  const tx: any = {
    select: vi.fn((projection?: unknown) => {
      const read: (typeof reads)[number] = { projection };
      reads.push(read);
      const next = () => {
        if (!queue.length) throw new Error(`unexpected select: ${read.table}`);
        return queue.shift();
      };
      const query: any = {
        from: (table: any) => {
          read.table = getTableName(table);
          return query;
        },
        innerJoin: () => query,
        where: (where: any) => {
          read.where = where;
          return query;
        },
        limit: () => query,
        orderBy: () => query,
        for: async () => next(),
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(next).then(resolve, reject),
      };
      return query;
    }),
    insert: vi.fn((table: any) => ({
      values: async (value: unknown) => {
        writes.push({ kind: "insert", table: getTableName(table), value });
        return [{ insertId: 1 }];
      },
    })),
    update: vi.fn((table: any) => ({
      set: (value: unknown) => ({
        where: async (where: any) => {
          writes.push({
            kind: "update",
            table: getTableName(table),
            value,
            where,
          });
          return [{ affectedRows: 1 }];
        },
      }),
    })),
    delete: vi.fn((table: any) => ({
      where: async (where: any) => {
        writes.push({ kind: "delete", table: getTableName(table), where });
        return [{ affectedRows: 1 }];
      },
    })),
  };
  mockGetDb.mockResolvedValue({
    transaction: async (callback: any) => callback(tx),
  });
  return { reads, writes, queue };
}

function noMemberSaveResults(
  options: {
    permissions?: typeof stored;
    target?: typeof target;
    actorName?: boolean;
  } = {}
) {
  return [
    ...actorAccess(),
    [], // request replay
    [options.target ?? target],
    [], // no official membership
    options.permissions ?? stored,
    ...(options.actorName === false
      ? []
      : [[{ displayName: "合成管理员", username: "synthetic-admin" }]]),
  ];
}

function context() {
  return {
    user: { id: actor.adminUserId, role: "admin" },
    adminAccount: { ...activeActor },
    req: { headers: {} },
    res: {},
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("官方权限保存事务 v13（纯合成）", () => {
  it("未分组真实active账号回读已存官方权限和sessionVersion，不伪造成member", async () => {
    const fake = database([
      ...actorAccess(),
      [], // teams
      [], // members
      [
        {
          adminUserId: target.id,
          displayName: target.displayName,
          username: target.username,
          adminRole: target.adminRole,
          accountVersion: 12,
        },
      ],
      [{ adminUserId: target.id, permission: "officialInventory.read" }],
    ]);
    const result = await getOfficialTeamsOverview(actor);
    expect(result.members).toEqual([]);
    expect(result.targets).toEqual([
      {
        adminUserId: target.id,
        displayName: "合成员工",
        officialPermissions: ["officialInventory.read"],
        accountVersion: 12,
      },
    ]);
    expect(result.currentAccess.isSuperAdmin).toBe(true);
    const targetRead = fake.reads[5];
    expect(targetRead.table).toBe("admin_users");
    expect(new MySqlDialect().sqlToQuery(targetRead.where).params).toContain(
      "active"
    );
    expect(fake.queue).toHaveLength(0);
    expect(fake.writes).toEqual([]);
  });

  it("超级管理员目标仍回显固定四项有效权限，权限写入规则保持只读", async () => {
    database([
      ...actorAccess(),
      [],
      [],
      [
        {
          adminUserId: actor.adminUserId,
          displayName: "合成超管",
          username: "synthetic-admin",
          adminRole: "super_admin",
          accountVersion: actor.sessionVersion,
        },
      ],
      [],
    ]);
    const result = await getOfficialTeamsOverview(actor);
    expect(result.targets[0]).toMatchObject({
      adminUserId: actor.adminUserId,
      accountVersion: actor.sessionVersion,
    });
    expect(result.targets[0].officialPermissions).toEqual([
      "officialInventory.note",
      "officialInventory.publish",
      "officialInventory.read",
      "officialInventory.write",
    ]);
  });

  it("保留既有members并与独立targets共用真实权限回读", async () => {
    database([
      ...actorAccess(),
      [],
      [
        {
          adminUserId: target.id,
          displayName: "",
          username: target.username,
          adminRole: target.adminRole,
          teamId: 99003,
          teamName: "历史官方团队",
          role: "member",
          revision: 4,
        },
      ],
      [
        {
          adminUserId: target.id,
          displayName: "",
          username: target.username,
          adminRole: target.adminRole,
          accountVersion: 12,
        },
      ],
      [
        { adminUserId: target.id, permission: "officialInventory.note" },
        { adminUserId: target.id, permission: "officialInventory.read" },
      ],
    ]);
    const result = await getOfficialTeamsOverview(actor);
    expect(result.members[0]).toMatchObject({
      teamId: 99003,
      revision: 4,
      displayName: target.username,
    });
    expect(result.targets[0].officialPermissions).toEqual([
      "officialInventory.note",
      "officialInventory.read",
    ]);
    expect(result.members[0].officialPermissions).toEqual(
      result.targets[0].officialPermissions
    );
  });

  it.each([
    { adminRole: "operation", status: "active", sessionVersion: 5 },
    { adminRole: "super_admin", status: "disabled", sessionVersion: 5 },
    { adminRole: "super_admin", status: "active", sessionVersion: 6 },
  ])(
    "live角色/状态/会话变化禁止批量读取 $adminRole $status $sessionVersion",
    async change => {
      const fake = database([[{ ...activeActor, ...change }], [], []]);
      await expect(getOfficialTeamsOverview(actor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(fake.reads.length).toBeLessThanOrEqual(3);
      expect(fake.writes).toEqual([]);
    }
  );

  it("无官方成员可以只保存权限，保留其他权限、两份审计并失效一次会话", async () => {
    const fake = database(noMemberSaveResults());
    const result = await setOfficialTeamMember(actor, input);
    expect(result).toEqual({
      member: null,
      officialPermissions: ["officialInventory.read"],
      accountVersion: 13,
      revision: 0,
      requestId: input.requestId,
      idempotent: false,
    });
    expect(
      fake.writes.some(write => write.table === "official_channel_team_members")
    ).toBe(false);
    const grants = fake.writes.find(
      write =>
        write.kind === "insert" && write.table === "admin_user_permissions"
    )!;
    expect(grants.value.map((row: any) => row.permission)).toEqual(
      expect.arrayContaining([
        "materials.read",
        "orders.read",
        "profile.manage",
        "officialInventory.read",
      ])
    );
    const permissionAudit = fake.writes.find(
      write => write.table === "admin_user_permission_audits"
    )!;
    expect(permissionAudit.value.beforePermissions).toEqual(
      stored.map(row => row.permission)
    );
    expect(permissionAudit.value.operatorAdminUserId).toBe(actor.adminUserId);
    expect(
      fake.writes.filter(write => write.table === "admin_users")
    ).toHaveLength(1);
    const audit = fake.writes.find(
      write => write.table === "official_channel_audits"
    )!;
    expect(audit.value.beforeData.accountVersion).toBe(12);
    expect(audit.value.afterData).toMatchObject({
      result,
      memberChanged: false,
      permissionChanged: true,
    });
    expect(fake.queue).toHaveLength(0);
  });

  it("无变化保存返回当前版本，不重写权限或失效会话，但保留请求审计", async () => {
    const fake = database(
      noMemberSaveResults({
        permissions: [...stored, { permission: "officialInventory.read" }],
        actorName: false,
      })
    );
    const result = await setOfficialTeamMember(actor, input);
    expect(result.accountVersion).toBe(12);
    expect(result.revision).toBe(0);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].table).toBe("official_channel_audits");
    expect(fake.queue).toHaveLength(0);
  });

  it("无member的第二个旧版本写请求被账户CAS拒绝，成员revision=0不能覆盖权限", async () => {
    database(noMemberSaveResults());
    const first = await setOfficialTeamMember(actor, input);
    const fake = database([
      ...actorAccess(),
      [],
      [{ ...target, sessionVersion: first.accountVersion }],
    ]);
    await expect(
      setOfficialTeamMember(actor, {
        ...input,
        requestId: "synthetic_second_v13",
        officialPermissions: [],
      })
    ).rejects.toThrow("OFFICIAL_TEAM_ACCOUNT_VERSION_CONFLICT");
    expect(fake.writes).toEqual([]);
    expect(fake.queue).toHaveLength(0);
  });

  it("成员revision的CAS保持独立有效", async () => {
    const fake = database([
      ...actorAccess(),
      [],
      [target],
      [
        {
          id: 1,
          adminUserId: target.id,
          teamId: 99003,
          role: "member",
          revision: 2,
        },
      ],
    ]);
    await expect(setOfficialTeamMember(actor, input)).rejects.toThrow(
      "OFFICIAL_TEAM_MEMBER_REVISION_CONFLICT"
    );
    expect(fake.writes).toEqual([]);
  });

  it("成功回执包含规范化read依赖和新账户版本", async () => {
    database(noMemberSaveResults());
    const result = await setOfficialTeamMember(actor, {
      ...input,
      officialPermissions: ["officialInventory.note"],
    });
    expect(result.officialPermissions).toEqual([
      "officialInventory.note",
      "officialInventory.read",
    ]);
    expect(result.accountVersion).toBe(13);
  });

  it("匹配请求重放返回审计内旧回执，在新版本CAS之前稳定重放且不产生写入", async () => {
    const firstDb = database(noMemberSaveResults());
    const first = await setOfficialTeamMember(actor, input);
    const audit = firstDb.writes.find(
      write => write.table === "official_channel_audits"
    )!.value;
    const fake = database([...actorAccess(), [audit]]);
    expect(await setOfficialTeamMember(actor, input)).toEqual({
      ...first,
      idempotent: true,
    });
    expect(fake.queue).toHaveLength(0);
    expect(fake.writes).toEqual([]);
    expect(fake.reads).toHaveLength(4);
  });

  it("同requestId改expectedAccountVersion拒绝重放", async () => {
    const firstDb = database(noMemberSaveResults());
    await setOfficialTeamMember(actor, input);
    const audit = firstDb.writes.find(
      write => write.table === "official_channel_audits"
    )!.value;
    const fake = database([...actorAccess(), [audit]]);
    await expect(
      setOfficialTeamMember(actor, { ...input, expectedAccountVersion: 13 })
    ).rejects.toThrow("OFFICIAL_TEAM_REQUEST_ID_REUSED");
    expect(fake.writes).toEqual([]);
  });

  it("旧客户端缺失账户版本的新权限写入被明确拒绝", async () => {
    const fake = database([...actorAccess(), []]);
    const { expectedAccountVersion: _, ...legacyInput } = input;
    await expect(
      officialTeamsRouter.createCaller(context()).setMember(legacyInput)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "缺少员工账号版本，请刷新权限配置后重新保存",
    });
    expect(fake.writes).toEqual([]);
    expect(fake.queue).toHaveLength(0);
  });

  it("旧审计的payload hash和无账户版本回执仍可稳定重放，不填造新版本", async () => {
    const { expectedAccountVersion: _, ...legacyInput } = input;
    const legacyResult = {
      member: null,
      officialPermissions: ["officialInventory.read"],
      revision: 0,
      requestId: input.requestId,
      idempotent: false,
    };
    const audit = {
      action: "official.team-member.set",
      actorAdminUserId: actor.adminUserId,
      targetId: String(input.adminUserId),
      payloadHash: officialPayloadHash({
        action: "setMember",
        adminUserId: input.adminUserId,
        teamId: null,
        role: null,
        expectedRevision: 0,
        officialPermissions: ["officialInventory.read"],
      }),
      afterData: { result: legacyResult },
    };
    const fake = database([...actorAccess(), [audit]]);
    expect(await setOfficialTeamMember(actor, legacyInput)).toEqual({
      ...legacyResult,
      idempotent: true,
    });
    expect(fake.writes).toEqual([]);
    expect(fake.queue).toHaveLength(0);
  });

  it("只改团队时审计before权限仍准确，不清空真实官方授权", async () => {
    const fake = database(
      noMemberSaveResults({
        permissions: [...stored, { permission: "officialInventory.read" }],
        actorName: false,
      })
    );
    const { officialPermissions: _, ...membershipOnly } = input;
    const result = await setOfficialTeamMember(actor, membershipOnly);
    expect(result.officialPermissions).toEqual(["officialInventory.read"]);
    expect(result.accountVersion).toBe(12);
    expect(fake.writes[0].value.beforeData.officialPermissions).toEqual([
      "officialInventory.read",
    ]);
  });

  it("既有官方成员只改权限时保留member revision并返回新账户版本", async () => {
    const current = {
      id: 1,
      adminUserId: target.id,
      teamId: 99003,
      role: "member",
      revision: 4,
    };
    const fake = database([
      ...actorAccess(),
      [],
      [target],
      [current],
      [{ id: 99003, name: "历史官方团队", status: "active" }],
      stored,
      [{ displayName: "合成管理员", username: "synthetic-admin" }],
    ]);
    const result = await setOfficialTeamMember(actor, {
      ...input,
      teamId: 99003,
      role: "member",
      expectedRevision: 4,
    });
    expect(result).toMatchObject({
      accountVersion: 13,
      revision: 4,
      member: {
        teamId: 99003,
        role: "member",
        revision: 4,
        officialPermissions: ["officialInventory.read"],
      },
    });
    expect(
      fake.writes.some(write => write.table === "official_channel_team_members")
    ).toBe(false);
    expect(fake.queue).toHaveLength(0);
  });

  it("旧member-only请求可兼容，显式加入官方团队仍走成员CAS并失效会话但不改授权", async () => {
    const current = {
      id: 1,
      adminUserId: target.id,
      teamId: 99003,
      role: "member",
      revision: 1,
    };
    const fake = database([
      ...actorAccess(),
      [],
      [target],
      [],
      [{ id: 99003, name: "历史官方团队", status: "active" }],
      [...stored, { permission: "officialInventory.read" }],
      [current],
    ]);
    const {
      officialPermissions: _,
      expectedAccountVersion: __,
      ...legacyMemberInput
    } = input;
    const result = await setOfficialTeamMember(actor, {
      ...legacyMemberInput,
      teamId: 99003,
      role: "member",
    });
    expect(result).toMatchObject({
      accountVersion: 13,
      revision: 1,
      member: { teamId: 99003, role: "member", revision: 1 },
      officialPermissions: ["officialInventory.read"],
    });
    expect(
      fake.writes.filter(
        write => write.table === "official_channel_team_members"
      )
    ).toHaveLength(1);
    expect(
      fake.writes.some(
        write =>
          write.table === "admin_user_permissions" ||
          write.table === "admin_user_permission_audits"
      )
    ).toBe(false);
    expect(fake.queue).toHaveLength(0);
  });

  it.each([
    {
      status: "disabled",
      adminRole: "operation",
      error: "OFFICIAL_TEAM_TARGET_ADMIN_INACTIVE",
    },
    {
      status: "active",
      adminRole: "super_admin",
      error: "OFFICIAL_TEAM_SUPER_ADMIN_PERMISSIONS_IMMUTABLE",
    },
  ])("目标安全检查保留 $error", async change => {
    const fake = database([
      ...actorAccess(),
      [],
      [{ ...target, status: change.status, adminRole: change.adminRole }],
    ]);
    await expect(setOfficialTeamMember(actor, input)).rejects.toThrow(
      change.error
    );
    expect(fake.writes).toEqual([]);
  });

  it("actor live校验先于审计重放，不允许失效actor取得历史成功", async () => {
    const fake = database([[{ ...activeActor, sessionVersion: 6 }]]);
    await expect(setOfficialTeamMember(actor, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fake.reads).toHaveLength(1);
    expect(fake.writes).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "服务层拒绝非法账户版本 %s",
    async expectedAccountVersion => {
      await expect(
        setOfficialTeamMember(actor, { ...input, expectedAccountVersion })
      ).rejects.toThrow("OFFICIAL_TEAM_ACCOUNT_VERSION_INVALID");
      expect(mockGetDb).not.toHaveBeenCalled();
    }
  );

  it("路由接受新版字段并把账户版本冲突映射为CONFLICT", async () => {
    const fake = database([
      ...actorAccess(),
      [],
      [{ ...target, sessionVersion: 13 }],
    ]);
    await expect(
      officialTeamsRouter.createCaller(context()).setMember(input)
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "员工账号或权限已变化，请刷新后核对再保存",
    });
    expect(fake.writes).toEqual([]);
  });

  it("路由在任何数据库调用前拒绝OAuth兼容主体", async () => {
    await expect(
      officialTeamsRouter
        .createCaller({ ...context(), adminAccount: null })
        .overview()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
