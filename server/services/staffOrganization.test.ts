import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
import {
  applyStaffOrganizationTemplate,
  createStaffOrganizationTeam,
  getStaffOrganizationOverview,
  loadStaffOrganizationActor,
  setStaffOrganizationMember,
  staffOrganizationPayloadHash,
  updateStaffOrganizationTeam,
  type StaffOrganizationTransaction,
} from "./staffOrganization";
import {
  STAFF_OPERATIONS_PERMISSIONS,
  STAFF_OPERATIONS_TEMPLATES,
  mergeStaffOperationsTemplate,
  staffOrganizationApplyTemplateInput,
  staffOrganizationSetMemberInput,
} from "../../shared/staffOrganization";

const actor = { adminUserId: 30004, sessionVersion: 5 };
const superAccount = {
  id: actor.adminUserId,
  username: "admin",
  displayName: "Victor",
  status: "active",
  adminRole: "super_admin",
  sessionVersion: 5,
};
const target = { id: 30009, status: "active", adminRole: "merchant_mgr", sessionVersion: 7 };
const team = {
  id: 1,
  name: "运营一组",
  notes: null,
  status: "active",
  revision: 3,
};
type Write = {
  kind: string;
  table: string;
  data?: unknown;
  condition?: unknown;
};
/** Scripted executor: no database, network, credentials or production fixtures. */
function fixture(
  results: unknown[][],
  options: { affectedRows?: number; failAudit?: boolean } = {}
) {
  const writes: Write[] = [];
  let consumed = 0;
  let committed = false;
  let rolledBack = false;
  const tx = {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        for: () => chain,
        orderBy: () => chain,
        leftJoin: () => chain,
        offset: () => chain,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown
        ) => {
          const result = results[consumed++];
          return result === undefined
            ? Promise.reject(new Error(`unexpected select ${consumed}`)).then(
                resolve,
                reject
              )
            : Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
    insert: (tableObject: Parameters<typeof getTableName>[0]) => ({
      values: async (data: unknown) => {
        const table = getTableName(tableObject);
        writes.push({ kind: "insert", table, data });
        if (options.failAudit && table === "admin_organization_audits")
          throw new Error("audit unavailable");
        return [{ insertId: 8, affectedRows: 1 }];
      },
    }),
    update: (tableObject: Parameters<typeof getTableName>[0]) => ({
      set: (data: unknown) => ({
        where: async (condition: unknown) => {
          writes.push({
            kind: "update",
            table: getTableName(tableObject),
            data,
            condition,
          });
          return [{ affectedRows: options.affectedRows ?? 1 }];
        },
      }),
    }),
    delete: (tableObject: Parameters<typeof getTableName>[0]) => ({
      where: async (condition: unknown) => {
        writes.push({
          kind: "delete",
          table: getTableName(tableObject),
          condition,
        });
        return [{ affectedRows: 1 }];
      },
    }),
  };
  mocks.getDb.mockResolvedValue({
    transaction: async (run: (value: unknown) => Promise<unknown>) => {
      try {
        const result = await run(tx);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  });
  return {
    tx: tx as unknown as StaffOrganizationTransaction,
    writes,
    get consumed() {
      return consumed;
    },
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    },
  };
}
beforeEach(() => vi.clearAllMocks());
describe("operations grant boundary", () => {
  it("templates contain only native delegable operations and no system/business/official keys", () => {
    expect(STAFF_OPERATIONS_TEMPLATES.map(item => item.name)).toEqual([
      "平台运营",
      "运营查看",
    ]);
    for (const template of STAFF_OPERATIONS_TEMPLATES)
      for (const key of template.permissions) {
        expect(STAFF_OPERATIONS_PERMISSIONS).toContain(key);
        expect(key).not.toMatch(/^(business\.|official|admins\.|logs\.)/);
      }
  });
  it("replaces operations while preserving business, official and profile exactly", () => {
    const result = mergeStaffOperationsTemplate(
      "merchant_mgr",
      [
        "business.inventory.write",
        "officialInventory.note",
        "merchants.write",
        "profile.manage",
      ],
      STAFF_OPERATIONS_TEMPLATES[1].permissions
    );
    expect(result).toContain("business.inventory.write");
    expect(result).toContain("officialInventory.note");
    expect(result).not.toContain("merchants.write");
    expect(result).toContain("merchants.read");
  });
  it("rejects injected system identity, extra grants, actors and inconsistent team role", () => {
    const input = {
      adminUserId: 30009,
      teamId: 1,
      role: "leader",
      expectedRevision: 0,
      requestId: "request_001",
    };
    expect(
      staffOrganizationSetMemberInput.safeParse({
        ...input,
        adminRole: "super_admin",
      }).success
    ).toBe(false);
    expect(
      staffOrganizationSetMemberInput.safeParse({
        ...input,
        permissions: ["admins.manage"],
      }).success
    ).toBe(false);
    expect(
      staffOrganizationSetMemberInput.safeParse({
        ...input,
        actorAdminUserId: 30004,
      }).success
    ).toBe(false);
    expect(
      staffOrganizationSetMemberInput.safeParse({ ...input, teamId: null })
        .success
    ).toBe(false);
    expect(
      staffOrganizationApplyTemplateInput.safeParse({
        adminUserId: 1,
        templateId: "system-admin",
        expectedRevision: 0,
        expectedSessionVersion: 7,
        requestId: "request_001",
      }).success
    ).toBe(false);
  });
  it("requires an explicit nonnegative integer target session version", () => {
    const input = {
      adminUserId: 30009,
      templateId: "operations-view",
      expectedRevision: 0,
      requestId: "session_schema_001",
    };
    for (const expectedSessionVersion of [undefined, -1, 1.5, "7", null])
      expect(staffOrganizationApplyTemplateInput.safeParse({ ...input, expectedSessionVersion }).success).toBe(false);
    expect(staffOrganizationApplyTemplateInput.safeParse({ ...input, expectedSessionVersion: 0 }).success).toBe(true);
    expect(staffOrganizationApplyTemplateInput.safeParse({ ...input, expectedSessionVersion: 7, permissions: ["admins.manage"] }).success).toBe(false);
  });
});
describe("live authorization", () => {
  it.each([
    { ...superAccount, adminRole: "operation" },
    { ...superAccount, status: "disabled" },
    { ...superAccount, status: "locked" },
    { ...superAccount, sessionVersion: 6 },
  ])(
    "fails closed for current database role/status/session changes %#",
    async account => {
      const f = fixture([[account]]);
      await expect(
        loadStaffOrganizationActor(f.tx, actor, true)
      ).rejects.toThrow();
      expect(f.writes).toHaveLength(0);
    }
  );
  it("only returns own identity, own team, own effective configuration to non-super users", async () => {
    const account = { ...superAccount, id: 30009, adminRole: "merchant_mgr" };
    fixture([
      [account],
      [{ adminUserId: 30009, teamId: 1, role: "leader", revision: 2 }],
      [{ ...account, teamId: 1, teamRole: "leader", revision: 2 }],
      [team],
      [{ adminUserId: 30009, permission: "profile.manage" }],
    ]);
    const result = await getStaffOrganizationOverview({
      adminUserId: 30009,
      sessionVersion: 5,
    });
    expect(result.canManage).toBe(false);
    expect(result.members.map(item => item.adminUserId)).toEqual([30009]);
    expect(result.members[0].operationsPermissions).toEqual([]);
    expect(result.members[0].sessionVersion).toBe(5);
  });
});
describe("CAS, replay and atomic audits", () => {
  it("membership permits another leader and does not touch native grants or official inventory", async () => {
    const f = fixture([[superAccount], [], [target], [], [team]]);
    const result = await setStaffOrganizationMember(actor, {
      adminUserId: 30009,
      teamId: 1,
      role: "leader",
      expectedRevision: 0,
      requestId: "member_001",
    });
    expect(result.revision).toBe(1);
    expect(f.consumed).toBe(5);
    expect(f.writes.map(item => item.table)).toEqual([
      "admin_organization_members",
      "admin_organization_teams",
      "admin_organization_audits",
    ]);
    expect(f.writes[0].data).toMatchObject({
      role: "leader",
      adminUserId: 30009,
    });
    expect(f.committed).toBe(true);
  });
  it("removal keeps a revisioned tombstone; stale revision never resets to zero", async () => {
    const f = fixture([
      [superAccount],
      [],
      [target],
      [{ adminUserId: 30009, teamId: 1, role: "member", revision: 4 }],
      [team],
    ]);
    const result = await setStaffOrganizationMember(actor, {
      adminUserId: 30009,
      teamId: null,
      role: null,
      expectedRevision: 4,
      requestId: "remove_001",
    });
    expect(result.revision).toBe(5);
    expect(f.writes[0]).toMatchObject({
      kind: "update",
      data: { teamId: null, role: null, revision: 5 },
    });
  });
  it("checks revision before any member or grant write", async () => {
    const f = fixture([
      [superAccount],
      [],
      [target],
      [{ adminUserId: 30009, teamId: null, role: null, revision: 4 }],
    ]);
    await expect(
      setStaffOrganizationMember(actor, {
        adminUserId: 30009,
        teamId: 1,
        role: "member",
        expectedRevision: 0,
        requestId: "stale_001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.writes).toHaveLength(0);
  });
  it("replays identical actor/request/hash without writes", async () => {
    const payload = { name: "运营组", notes: "" };
    const f = fixture([
      [superAccount],
      [
        {
          targetId: 8,
          actorAdminUserId: 30004,
          action: "staff.team.create",
          targetType: "team",
          payloadHash: staffOrganizationPayloadHash({
            action: "staff.team.create",
            payload,
          }),
          afterData: { revision: 1 },
        },
      ],
    ]);
    expect(
      (
        await createStaffOrganizationTeam(actor, {
          name: "运营组",
          requestId: "create_001",
        })
      ).idempotent
    ).toBe(true);
    expect(f.writes).toHaveLength(0);
  });
  it("rejects reused requestId with different payload", async () => {
    const f = fixture([
      [superAccount],
      [
        {
          actorAdminUserId: 30004,
          action: "staff.team.create",
          targetType: "team",
          payloadHash: "different",
        },
      ],
    ]);
    await expect(
      createStaffOrganizationTeam(actor, {
        name: "运营组",
        requestId: "create_001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.writes).toHaveLength(0);
  });
  it("applies native template with grant and both audits in one transaction", async () => {
    const f = fixture([
      [superAccount],
      [],
      [target],
      [],
      [
        { permission: "business.inventory.write" },
        { permission: "officialInventory.read" },
        { permission: "profile.manage" },
      ],
    ]);
    await applyStaffOrganizationTemplate(actor, {
      adminUserId: 30009,
      templateId: "operations-view",
      expectedRevision: 0,
      expectedSessionVersion: 7,
      requestId: "template_001",
    });
    const grants = f.writes.find(
      item => item.kind === "insert" && item.table === "admin_user_permissions"
    )?.data as { permission: string }[];
    expect(grants.map(item => item.permission)).toContain(
      "business.inventory.write"
    );
    expect(grants.map(item => item.permission)).toContain(
      "officialInventory.read"
    );
    expect(
      f.writes.some(item => item.table === "admin_user_permission_audits")
    ).toBe(true);
    expect(f.writes.at(-1)?.table).toBe("admin_organization_audits");
    expect(f.committed).toBe(true);
  });
  it("forbids super-admin grant modification, including self", async () => {
    const f = fixture([
      [superAccount],
      [],
      [{ id: 30004, status: "active", adminRole: "super_admin" }],
    ]);
    await expect(
      applyStaffOrganizationTemplate(actor, {
        adminUserId: 30004,
        templateId: "operations-view",
        expectedRevision: 0,
        expectedSessionVersion: 5,
        requestId: "template_001",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.writes).toHaveLength(0);
  });
  it("rejects native grant/session changes before member, grant or audit writes", async () => {
    const f = fixture([[superAccount], [], [{ ...target, sessionVersion: 8 }]]);
    await expect(applyStaffOrganizationTemplate(actor, {
      adminUserId: 30009,
      templateId: "platform-operations",
      expectedRevision: 0,
      expectedSessionVersion: 7,
      requestId: "stale_session_001",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.consumed).toBe(3);
    expect(f.writes).toHaveLength(0);
    expect(f.rolledBack).toBe(true);
  });
  it("replays a successful template before target CAS, but validates actor first and hashes the target session version", async () => {
    const input = {
      adminUserId: 30009,
      templateId: "operations-view" as const,
      expectedRevision: 0,
      expectedSessionVersion: 7,
      requestId: "replay_template_001",
    };
    const { requestId: _requestId, ...payload } = input;
    const receipt = {
      targetId: 30009,
      actorAdminUserId: actor.adminUserId,
      action: "staff.template.apply",
      targetType: "member",
      payloadHash: staffOrganizationPayloadHash({ action: "staff.template.apply", payload }),
      afterData: { revision: 1 },
    };
    const replay = fixture([[superAccount], [receipt]]);
    expect(await applyStaffOrganizationTemplate(actor, input)).toMatchObject({ idempotent: true, revision: 1 });
    expect(replay.consumed).toBe(2);
    expect(replay.writes).toHaveLength(0);
    const changed = fixture([[superAccount], [receipt]]);
    await expect(applyStaffOrganizationTemplate(actor, { ...input, expectedSessionVersion: 8 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(changed.writes).toHaveLength(0);
    const staleActor = fixture([[{ ...superAccount, sessionVersion: 6 }], [receipt]]);
    await expect(applyStaffOrganizationTemplate(actor, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(staleActor.consumed).toBe(1);
    expect(staleActor.writes).toHaveLength(0);
  });
  it("rejects archive when members remain", async () => {
    const f = fixture([[superAccount], [], [team], [{ id: 30009 }]]);
    await expect(
      updateStaffOrganizationTeam(actor, {
        id: 1,
        name: "运营组",
        status: "archived",
        expectedRevision: 3,
        requestId: "archive_001",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.writes).toHaveLength(0);
  });
  it("rolls back when final audit insert fails", async () => {
    const f = fixture([[superAccount], []], { failAudit: true });
    await expect(
      createStaffOrganizationTeam(actor, {
        name: "运营组",
        requestId: "create_001",
      })
    ).rejects.toThrow("audit unavailable");
    expect(f.rolledBack).toBe(true);
    expect(f.committed).toBe(false);
  });
  it("uses stable canonical request hashes", () => {
    expect(staffOrganizationPayloadHash({ a: 1, b: { z: 2, x: 1 } })).toBe(
      staffOrganizationPayloadHash({ b: { x: 1, z: 2 }, a: 1 })
    );
  });
  it("migration is three additive CREATEs, no original table update/truncate/drop or default grants", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/apply-admin-organization-schema.mjs",
        import.meta.url
      ),
      "utf8"
    );
    expect(
      source.match(/CREATE TABLE IF NOT EXISTS admin_organization_[a-z]+ \(/g)
    ).toHaveLength(3);
    expect(source).not.toMatch(
      /\b(?:DROP TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE admin_|INSERT INTO)\b/i
    );
    expect(source).toContain("--from-ecosystem-config");
    expect(source).toContain("0o077");
    expect(source).not.toContain("leader_team_unique");
  });
});
