import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import mysql, { type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import type { RowDataPacket } from "mysql2";
let pool: Pool;
let database: ReturnType<typeof drizzle> | null = null;
vi.mock("../db", () => ({ getDb: async () => database }));
import {
  applyStaffOrganizationTemplate,
  createStaffOrganizationTeam,
  getStaffOrganizationAudit,
  getStaffOrganizationOverview,
  setStaffOrganizationMember,
  updateStaffOrganizationTeam,
} from "./staffOrganization";

const enabled = process.env.STAFF_ORG_MYSQL_TEST === "1";
// Fixed parent-owned test database. No env URL, runtime configuration or other database is accepted.
const DB = "admin_org_test_20261103";
const actor = { adminUserId: 30004, sessionVersion: 1 };
const ocean = { adminUserId: 30009, sessionVersion: 1 };
async function rows(sql: string, values: unknown[] = []) {
  const [result] = await pool.query<RowDataPacket[]>(sql, values);
  return result;
}
async function revision(id: number) {
  return Number(
    (
      await rows(
        "SELECT revision FROM admin_organization_members WHERE adminUserId=?",
        [id]
      )
    )[0]?.revision ?? 0
  );
}
async function permissions(id: number) {
  return (
    await rows(
      "SELECT permission FROM admin_user_permissions WHERE adminUserId=? ORDER BY permission",
      [id]
    )
  ).map(row => String(row.permission));
}

describe.runIf(enabled)(
  "staff organization / real local MariaDB transactions",
  () => {
    beforeAll(async () => {
      pool = mysql.createPool({
        host: "127.0.0.1",
        port: 33306,
        user: "root",
        database: DB,
        connectionLimit: 8,
      });
      expect((await rows("SELECT DATABASE() AS db"))[0].db).toBe(DB);
      // All fixtures are exclusively inside the explicitly authorized test DB.
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_users (
      id INT PRIMARY KEY, username VARCHAR(64) NOT NULL, displayName VARCHAR(128),
      adminRole ENUM('super_admin','operation','merchant_mgr','customer_svc','risk_control','finance','auditor') NOT NULL,
      status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active', sessionVersion INT NOT NULL DEFAULT 1,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_user_permissions (
      id INT AUTO_INCREMENT PRIMARY KEY, adminUserId INT NOT NULL, permission VARCHAR(64) NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY admin_user_permissions_admin_permission_unique(adminUserId,permission)
    ) ENGINE=InnoDB`);
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_user_permission_audits (
      id INT AUTO_INCREMENT PRIMARY KEY, adminUserId INT NOT NULL, operatorAdminUserId INT NULL, operatorName VARCHAR(128) NULL,
      beforePermissions JSON NULL, afterPermissions JSON NULL, ipAddress VARCHAR(64), userAgent VARCHAR(255),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
      const { applyAdminOrganizationSchema } = await import(
        "../../scripts/apply-admin-organization-schema.mjs"
      );
      const connection = await pool.getConnection();
      try {
        const result = await applyAdminOrganizationSchema(connection);
        expect(result.grantsCreated).toBe(0);
        expect(result.membersCreated).toBe(0);
        await applyAdminOrganizationSchema(connection); // Pure CREATE is repeatable.
      } finally {
        connection.release();
      }
      database = drizzle(pool);
    }, 30000);
    beforeEach(async () => {
      await pool.query("DROP TRIGGER IF EXISTS staff_org_test_reject_audit");
      for (const table of [
        "admin_organization_audits",
        "admin_organization_members",
        "admin_organization_teams",
        "admin_user_permission_audits",
        "admin_user_permissions",
        "admin_users",
      ])
        await pool.query(`DELETE FROM ${table}`);
      await pool.query(
        "INSERT INTO admin_users (id,username,displayName,adminRole,status,sessionVersion) VALUES (30004,'admin','Victor','super_admin','active',1),(30009,'ocean','Ocean','merchant_mgr','active',1),(30010,'member','Member','merchant_mgr','active',1),(30011,'outsider','Other team','merchant_mgr','active',1)"
      );
      await pool.query(
        "INSERT INTO admin_user_permissions(adminUserId,permission) VALUES (30009,'profile.manage'),(30010,'profile.manage'),(30011,'profile.manage')"
      );
    });
    afterAll(async () => {
      if (pool) {
        await pool.query("DROP TRIGGER IF EXISTS staff_org_test_reject_audit");
        await pool.end();
      }
      database = null;
    });

    it("independent tables permit Victor and Ocean as simultaneous leaders without granting modules", async () => {
      const team = await createStaffOrganizationTeam(actor, {
        name: "运营一组",
        requestId: "real_team_001",
      });
      const before = await permissions(30009);
      await setStaffOrganizationMember(actor, {
        adminUserId: 30004,
        teamId: team.targetId,
        role: "leader",
        expectedRevision: 0,
        requestId: "victor_leader_001",
      });
      await setStaffOrganizationMember(actor, {
        adminUserId: 30009,
        teamId: team.targetId,
        role: "leader",
        expectedRevision: 0,
        requestId: "ocean_leader_001",
      });
      const leaders = await rows(
        "SELECT adminUserId FROM admin_organization_members WHERE teamId=? AND role='leader' ORDER BY adminUserId",
        [team.targetId]
      );
      expect(leaders.map(row => row.adminUserId)).toEqual([30004, 30009]);
      expect(await permissions(30009)).toEqual(before);
      const own = await getStaffOrganizationOverview(ocean);
      expect(own.canManage).toBe(false);
      expect(own.members.map(member => member.adminUserId)).toEqual([30009]);
      expect(own.members[0].operationsPermissions).toEqual([]);
      expect(own.teams.map(value => value.id)).toEqual([team.targetId]);
      const tables = (await rows("SHOW TABLES")).flatMap(row =>
        Object.values(row)
      );
      expect(tables.some(table => String(table).startsWith("official_"))).toBe(
        false
      );
    });
    it("concurrent member CAS has one winner, team revision increments and removal cannot ABA-reset", async () => {
      const team = await createStaffOrganizationTeam(actor, {
        name: "CAS团队",
        requestId: "cas_team_001",
      });
      const outcomes = await Promise.allSettled([
        setStaffOrganizationMember(actor, {
          adminUserId: 30009,
          teamId: team.targetId,
          role: "leader",
          expectedRevision: 0,
          requestId: "cas_member_a",
        }),
        setStaffOrganizationMember(actor, {
          adminUserId: 30009,
          teamId: team.targetId,
          role: "member",
          expectedRevision: 0,
          requestId: "cas_member_b",
        }),
      ]);
      expect(
        outcomes.filter(value => value.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        outcomes.filter(value => value.status === "rejected")
      ).toHaveLength(1);
      expect(await revision(30009)).toBe(1);
      expect(
        Number(
          (
            await rows(
              "SELECT revision FROM admin_organization_teams WHERE id=?",
              [team.targetId]
            )
          )[0].revision
        )
      ).toBe(2);
      await setStaffOrganizationMember(actor, {
        adminUserId: 30009,
        teamId: null,
        role: null,
        expectedRevision: 1,
        requestId: "cas_remove_001",
      });
      expect(await revision(30009)).toBe(2);
      await expect(
        setStaffOrganizationMember(actor, {
          adminUserId: 30009,
          teamId: team.targetId,
          role: "member",
          expectedRevision: 0,
          requestId: "cas_aba_001",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("same request/hash is idempotent even after initial expected revision becomes stale", async () => {
      const team = await createStaffOrganizationTeam(actor, {
        name: "幂等团队",
        requestId: "replay_team_001",
      });
      const input = {
        adminUserId: 30009,
        teamId: team.targetId,
        role: "member" as const,
        expectedRevision: 0,
        requestId: "replay_member_001",
      };
      await setStaffOrganizationMember(actor, input);
      expect((await setStaffOrganizationMember(actor, input)).idempotent).toBe(
        true
      );
      expect(await revision(30009)).toBe(1);
      expect(
        Number(
          (
            await rows(
              "SELECT COUNT(*) AS n FROM admin_organization_audits WHERE requestId=?",
              [input.requestId]
            )
          )[0].n
        )
      ).toBe(1);
      await expect(
        setStaffOrganizationMember(actor, { ...input, role: "leader" })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("template grant, before/after audits and session revocation are committed together without changing ERP/native role", async () => {
      await pool.query(
        "INSERT INTO admin_user_permissions(adminUserId,permission) VALUES (30009,'business.inventory.write'),(30009,'officialInventory.note'),(30009,'merchants.write')"
      );
      const input = {
        adminUserId: 30009,
        templateId: "operations-view" as const,
        expectedRevision: 0,
        expectedSessionVersion: 1,
        requestId: "template_real_001",
      };
      await applyStaffOrganizationTemplate(actor, input);
      const grants = await permissions(30009);
      expect(grants).toContain("business.inventory.write");
      expect(grants).toContain("officialInventory.note");
      expect(grants).not.toContain("merchants.write");
      expect(grants).toContain("merchants.read");
      const account = (
        await rows(
          "SELECT adminRole,sessionVersion FROM admin_users WHERE id=30009"
        )
      )[0];
      expect(account.adminRole).toBe("merchant_mgr");
      expect(account.sessionVersion).toBe(2);
      expect(
        Number(
          (
            await rows(
              "SELECT COUNT(*) AS n FROM admin_user_permission_audits WHERE adminUserId=30009"
            )
          )[0].n
        )
      ).toBe(1);
      const audit = (
        await getStaffOrganizationAudit(actor, { page: 1, pageSize: 20 })
      ).data[0];
      expect(audit.action).toBe("staff.template.apply");
      expect(audit.beforeData).toBeTruthy();
      expect(audit.afterData).toMatchObject({
        businessAuthorizationChanged: false,
        templateId: "operations-view",
      });
      await expect(getStaffOrganizationOverview(ocean)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(
        (await getStaffOrganizationOverview({ ...ocean, sessionVersion: 2 }))
          .members[0].operationsPermissions
      ).toContain("analytics.read");
      expect(
        (await applyStaffOrganizationTemplate(actor, input)).idempotent
      ).toBe(true);
      await expect(applyStaffOrganizationTemplate(actor, { ...input, expectedSessionVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await rows("SELECT COUNT(*) AS n FROM admin_organization_audits WHERE requestId=?", [input.requestId]))[0].n).toBe(1);
      expect((await rows("SELECT COUNT(*) AS n FROM admin_user_permission_audits WHERE adminUserId=30009"))[0].n).toBe(1);
      expect(
        Number(
          (
            await rows("SELECT sessionVersion FROM admin_users WHERE id=30009")
          )[0].sessionVersion
        )
      ).toBe(2);
      await pool.query("UPDATE admin_users SET sessionVersion=sessionVersion+1 WHERE id=30004");
      await expect(applyStaffOrganizationTemplate(actor, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
    it("stale template preview conflicts after legacy native permission revocation; no regrant or new audit", async () => {
      await pool.query("INSERT INTO admin_user_permissions(adminUserId,permission) VALUES (30009,'materials.read'),(30009,'materials.write'),(30009,'business.inventory.write'),(30009,'officialInventory.note')");
      const preview = (await getStaffOrganizationOverview(actor)).members.find(member => member.adminUserId === 30009)!;
      expect(preview.permissions).toContain("materials.write");
      expect(preview.sessionVersion).toBe(1);
      const input = {
        adminUserId: preview.adminUserId,
        templateId: "platform-operations" as const,
        expectedRevision: preview.revision,
        expectedSessionVersion: preview.sessionVersion,
        requestId: "legacy_revoke_stale_001",
      };
      const before = await permissions(30009);
      const legacy = await pool.getConnection();
      try {
        await legacy.beginTransaction();
        // Equivalent security-relevant subset of db.updateAdminUser({permissions}):
        // lock current admin row, write explicit native grants + native audit,
        // increment sessionVersion in the same transaction, but not member revision.
        // Avoid constructing unrelated legacy sales identity/scope business tables.
        await legacy.query("SELECT id FROM admin_users WHERE id=30009 FOR UPDATE");
        await legacy.query("UPDATE admin_users SET sessionVersion=sessionVersion+1 WHERE id=30009");
        await legacy.query("DELETE FROM admin_user_permissions WHERE adminUserId=30009 AND permission='materials.write'");
        await legacy.query("INSERT INTO admin_user_permission_audits(adminUserId,operatorAdminUserId,beforePermissions,afterPermissions) VALUES (30009,30004,?,?)", [JSON.stringify(before), JSON.stringify(before.filter(key => key !== "materials.write"))]);
        await legacy.commit();
      } catch (error) {
        await legacy.rollback();
        throw error;
      } finally {
        legacy.release();
      }
      const revoked = await permissions(30009);
      expect(revoked).not.toContain("materials.write");
      expect(await revision(30009)).toBe(preview.revision);
      const nativeAuditsBefore = (await rows("SELECT COUNT(*) AS n FROM admin_user_permission_audits"))[0].n;
      const organizationAuditsBefore = (await rows("SELECT COUNT(*) AS n FROM admin_organization_audits"))[0].n;
      await expect(applyStaffOrganizationTemplate(actor, input)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await permissions(30009)).toEqual(revoked);
      expect(await revision(30009)).toBe(preview.revision);
      expect((await rows("SELECT COUNT(*) AS n FROM admin_user_permission_audits"))[0].n).toBe(nativeAuditsBefore);
      expect((await rows("SELECT COUNT(*) AS n FROM admin_organization_audits"))[0].n).toBe(organizationAuditsBefore);
      expect((await rows("SELECT adminRole,sessionVersion FROM admin_users WHERE id=30009"))[0]).toMatchObject({ adminRole: "merchant_mgr", sessionVersion: 2 });
      const fresh = (await getStaffOrganizationOverview(actor)).members.find(member => member.adminUserId === 30009)!;
      expect(fresh.sessionVersion).toBe(2);
      expect(fresh.permissions).not.toContain("materials.write");
    });
    it("audit insertion failure rolls back grants, native audit, member version and sessionVersion", async () => {
      await pool.query(
        "CREATE TRIGGER staff_org_test_reject_audit BEFORE INSERT ON admin_organization_audits FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rejects audit'"
      );
      const before = await permissions(30009);
      await expect(
        applyStaffOrganizationTemplate(actor, {
          adminUserId: 30009,
          templateId: "platform-operations",
          expectedRevision: 0,
          expectedSessionVersion: 1,
          requestId: "rollback_template_001",
        })
      ).rejects.toThrow();
      expect(await permissions(30009)).toEqual(before);
      expect(await revision(30009)).toBe(0);
      expect(
        Number(
          (
            await rows("SELECT sessionVersion FROM admin_users WHERE id=30009")
          )[0].sessionVersion
        )
      ).toBe(1);
      expect(
        Number(
          (
            await rows("SELECT COUNT(*) AS n FROM admin_user_permission_audits")
          )[0].n
        )
      ).toBe(0);
      expect(
        Number(
          (await rows("SELECT COUNT(*) AS n FROM admin_organization_audits"))[0]
            .n
        )
      ).toBe(0);
    });
    it("live role/status/session revalidation blocks stale snapshots and super-admin grants are immutable", async () => {
      await pool.query(
        "UPDATE admin_users SET adminRole='operation' WHERE id=30004"
      );
      await expect(
        createStaffOrganizationTeam(actor, {
          name: "拒绝",
          requestId: "role_demote_001",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await pool.query(
        "UPDATE admin_users SET adminRole='super_admin',status='disabled' WHERE id=30004"
      );
      await expect(
        createStaffOrganizationTeam(actor, {
          name: "拒绝",
          requestId: "status_disable_001",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await pool.query(
        "UPDATE admin_users SET status='active',sessionVersion=2 WHERE id=30004"
      );
      await expect(
        createStaffOrganizationTeam(actor, {
          name: "拒绝",
          requestId: "session_stale_001",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        applyStaffOrganizationTemplate(
          { ...actor, sessionVersion: 2 },
          {
            adminUserId: 30004,
            templateId: "operations-view",
            expectedRevision: 0,
            expectedSessionVersion: 2,
            requestId: "self_grants_001",
          }
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await permissions(30004)).toEqual([]);
    });
    it("team metadata CAS detects stale revision after membership change", async () => {
      const team = await createStaffOrganizationTeam(actor, {
        name: "团队",
        requestId: "teamrev_create_001",
      });
      await setStaffOrganizationMember(actor, {
        adminUserId: 30009,
        teamId: team.targetId,
        role: "member",
        expectedRevision: 0,
        requestId: "teamrev_member_001",
      });
      await expect(
        updateStaffOrganizationTeam(actor, {
          id: team.targetId,
          name: "错误覆盖",
          status: "active",
          expectedRevision: 1,
          requestId: "teamrev_stale_001",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        updateStaffOrganizationTeam(actor, {
          id: team.targetId,
          name: "归档",
          status: "archived",
          expectedRevision: 2,
          requestId: "teamrev_archive_001",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  }
);
