import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
let real: any;
vi.mock("./db", () => ({ getDb: async () => real.getDb(), lockActiveSuperAdmins: (tx: any) => real.lockActiveSuperAdmins(tx) }));
import { startStaffArchive, findStaffArchive, staffBindingHistory, markStaffArchiveAttempt, completeStaffArchive, failStaffArchive, type ArchiveProof } from "./staffArchiveDb";
import { isCurrentLocalAdminSession } from "./_core/context";
const DSN = process.env.STAF_ARCHIVE_FIXTURE_DB;
const DB = "staff_archive_fixture_20261105";
let pool: Pool;
async function q(sql: string, values: any[] = []) { const [r] = await pool.query(sql, values); return r as RowDataPacket[]; }
function input(id = 20, more: any = {}) { return { id, merchantId: null, expectedSessionVersion: 4, expectedBindingVersion: 0, expectedRevision: null, requestId: `fixture_archive_${id}`, ...more }; }
function proof(more: Partial<ArchiveProof> = {}): ArchiveProof { return { actorId: 10, actorSessionVersion: 8, actorFrontUserId: null, actorBindingVersion: null, frontUserId: null, enterpriseId: null, binding: null, actorName: "Fixture actor", actorRole: "super_admin", ...more }; }
function enterprise() { return { input: input(20, { merchantId: 61, expectedBindingVersion: 3, expectedRevision: "a".repeat(64), nextOwnerUserId: 303 }), proof: proof({ actorFrontUserId: 101, actorBindingVersion: 2, frontUserId: 202, enterpriseId: 701, binding: { creditCode: "FIXTURE", expectedOwnerUserId: 900 } }) }; }
async function bind() {
  await q("INSERT INTO admin_business_staff_bindings(adminUserId,frontUserId,status,bindingVersion,createdByAdminUserId,updatedByAdminUserId) VALUES (10,101,'active',2,10,10),(20,202,'active',3,10,10)");
  await q("INSERT INTO admin_business_staff_binding_audits(bindingId,adminUserId,frontUserId,action,expectedVersion,resultingVersion,requestId,operatorAdminUserId,operatorName,operatorRole) VALUES (2,20,202,'bound',2,3,'fixture_binding_history',10,'Fixture','super_admin')");
  await q("INSERT INTO admin_business_merchant_scopes(adminUserId,merchantId,status,scopeVersion,modulePermissions,createdByAdminUserId,updatedByAdminUserId) VALUES(20,61,'active',2,'[\"business.users.write\"]',10,10)");
}
describe.runIf(Boolean(DSN))("staff archive / isolated actual MariaDB", () => {
  beforeAll(async () => {
    if (!DSN || !/^mysql:\/\/staff_fixture:[^@]+@127\.0\.0\.1:33407\/staff_archive_fixture_20261105$/.test(DSN)) throw new Error("Explicit local STAF_ARCHIVE_FIXTURE_DB required");
    if (process.env.DATABASE_URL) throw new Error("Fixture must not use project DATABASE_URL");
    pool = mysql.createPool({ uri: DSN, connectionLimit: 8 });
    expect((await q("SELECT DATABASE() AS db"))[0].db).toBe(DB);
    real = await import(/* @vite-ignore */ "/home/ubuntu/backend-optimization/round2/staff-fixture/generated-db.mjs");
  });
  beforeEach(async () => {
    await q("SET FOREIGN_KEY_CHECKS=0");
    for (const table of ["authored_history","admin_staff_archives","audit_logs","admin_user_permissions","admin_user_sales_scopes","admin_business_staff_bindings","admin_business_staff_binding_audits","admin_business_merchant_scopes","sales_staff","merchants","admin_users"]) await q(`TRUNCATE TABLE ${table}`);
    await q("SET FOREIGN_KEY_CHECKS=1");
    await q("INSERT INTO admin_users(id,userId,username,usernameCanonical,displayName,passwordHash,adminRole,status,sessionVersion) VALUES(10,10010,'actor','actor','Fixture actor','preserve-actor','super_admin','active',8),(20,10020,'target','target','Fixture target','preserve-target','operation','active',4),(30,10030,'other','other','Fixture other','preserve-other','operation','active',4)");
    await q("INSERT INTO admin_user_permissions(adminUserId,permission) VALUES(20,'materials.read')");
    await q("INSERT INTO sales_staff(adminUserId,staffCode,displayName) VALUES(20,'fixture-target','Fixture target')");
    await q("INSERT INTO admin_user_sales_scopes(adminUserId,staffCode) VALUES(20,'fixture-target')");
    await q("INSERT INTO authored_history(id,adminUserId,frontUserId,body) VALUES(1,20,202,'original authored history preserved')");
    await q("INSERT INTO audit_logs(operatorId,action,targetId,note) VALUES(20,'historical_author','1','original immutable audit')");
  });
  afterAll(async () => { if (real) await (await real.getDb()).$client.end(); if (pool) await pool.end(); });
  it("commits genuine admin-only retirement, disables session, hides current and exposes deleted with history intact", async () => {
    const result = await startStaffArchive(input(), proof()); expect(result.state).toBe("completed"); expect(result.frontUserId).toBeNull();
    const user = await real.getAdminUserById(20); expect(user.status).toBe("disabled"); expect(user.sessionVersion).toBe(5); expect(user.passwordHash).toBe("preserve-target");
    expect(isCurrentLocalAdminSession(user, { sessionVersion: 4 })).toBe(false); expect(isCurrentLocalAdminSession(user, { sessionVersion: 5 })).toBe(false);
    expect((await q("SELECT * FROM admin_user_permissions WHERE adminUserId=20"))).toHaveLength(1);
    expect((await q("SELECT * FROM admin_user_sales_scopes WHERE adminUserId=20"))).toHaveLength(1);
    expect((await q("SELECT * FROM sales_staff WHERE adminUserId=20"))[0]).toMatchObject({ status: "inactive", staffCode: "fixture-target", adminUserId: 20 });
    expect((await q("SELECT * FROM authored_history"))[0]).toMatchObject({ adminUserId: 20, frontUserId: 202, body: "original authored history preserved" });
    expect((await q("SELECT * FROM audit_logs WHERE action='historical_author'"))).toHaveLength(1);
    const current = await real.getAdminUsers({ archiveStatus: "current" }); const deleted = await real.getAdminUsers({ archiveStatus: "deleted" });
    expect(current.data.map((r: any) => r.id)).not.toContain(20); expect(deleted.data.map((r: any) => r.id)).toEqual([20]);
    expect(deleted.data[0]).not.toHaveProperty("passwordHash"); expect(deleted.data[0].archive.state).toBe("completed");
  });
  it("fails target/actor CAS and creates no sidecar or access mutation", async () => {
    await expect(startStaffArchive(input(20, { expectedSessionVersion: 3 }), proof())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(startStaffArchive(input(), proof({ actorSessionVersion: 7 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startStaffArchive(input(20, { merchantId: 61 }), proof())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(startStaffArchive(input(), proof({ enterpriseId: 701, binding: { creditCode: "forged", expectedOwnerUserId: 900 } }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await findStaffArchive(20)).toBeNull(); expect((await q("SELECT status,sessionVersion FROM admin_users WHERE id=20"))[0]).toMatchObject({ status: "active", sessionVersion: 4 });
  });
  it("enforces unique request/target and closes once under concurrent duplicate starts", async () => {
    const results = await Promise.allSettled([startStaffArchive(input(), proof()), startStaffArchive(input(), proof())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await q("SELECT sessionVersion FROM admin_users WHERE id=20"))[0].sessionVersion).toBe(5);
    expect(await q("SELECT * FROM admin_staff_archives")).toHaveLength(1);
    await expect(startStaffArchive(input(30, { requestId: input().requestId }), proof())).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await q("SELECT status FROM admin_users WHERE id=30"))[0].status).toBe("active");
  });
  it("rolls back archive/access/scopes/sales identity when post-close audit insert fails", async () => {
    await bind(); const e = enterprise();
    await q("CREATE TRIGGER fail_archive_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected fixture rollback'");
    try { await expect(startStaffArchive(e.input, e.proof)).rejects.toBeTruthy(); } finally { await q("DROP TRIGGER fail_archive_audit"); }
    expect(await findStaffArchive(20)).toBeNull(); expect((await q("SELECT status,sessionVersion FROM admin_users WHERE id=20"))[0]).toMatchObject({ status: "active", sessionVersion: 4 });
    expect((await q("SELECT status,scopeVersion FROM admin_business_merchant_scopes"))[0]).toMatchObject({ status: "active", scopeVersion: 2 });
    expect((await q("SELECT status FROM sales_staff"))[0].status).toBe("active"); expect(await q("SELECT * FROM authored_history")).toHaveLength(1);
  });
  it("blocks self, same front identity, enterprise owner and a last effective super", async () => {
    await expect(startStaffArchive(input(10, { expectedSessionVersion: 8 }), proof())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await bind(); const e = enterprise();
    await expect(startStaffArchive(e.input, { ...e.proof, actorFrontUserId: 202 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startStaffArchive(e.input, { ...e.proof, binding: { creditCode: "FIXTURE", expectedOwnerUserId: 202 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await q("UPDATE admin_users SET adminRole='operation' WHERE id=10"); await q("INSERT INTO admin_user_permissions(adminUserId,permission) VALUES(10,'admins.manage')");
    await q("UPDATE admin_users SET adminRole='super_admin' WHERE id=20");
    await expect(startStaffArchive(e.input, proof({ ...e.proof, actorRole: "operation" }))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(await findStaffArchive(20)).toBeNull();
  });
  it("excludes stale active-but-archived super admins from continuity in the real lock query", async () => {
    await startStaffArchive(input(), proof()); await q("UPDATE admin_users SET status='active',adminRole='super_admin' WHERE id=20");
    await q("INSERT INTO admin_user_permissions(adminUserId,permission) VALUES(30,'admins.manage')");
    await expect(startStaffArchive(input(10, { expectedSessionVersion: 8 }), proof({ actorId: 30, actorSessionVersion: 4, actorRole: "operation" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await q("SELECT status FROM admin_users WHERE id=10"))[0].status).toBe("active");
  });
  it("serializes simultaneous remove-one-of-two and leaves exactly one effective super", async () => {
    await q("UPDATE admin_users SET adminRole='super_admin' WHERE id IN(20,30)"); await q("UPDATE admin_users SET adminRole='operation' WHERE id=10");
    await q("INSERT INTO admin_user_permissions(adminUserId,permission) VALUES(10,'admins.manage')");
    const results = await Promise.allSettled([startStaffArchive(input(20), proof({ actorRole: "operation" })), startStaffArchive(input(30), proof({ actorRole: "operation" }))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("FORBIDDEN");
    expect((await q("SELECT COUNT(*) AS n FROM admin_users u WHERE adminRole='super_admin' AND status='active' AND NOT EXISTS(SELECT 1 FROM admin_staff_archives a WHERE a.adminUserId=u.id)"))[0].n).toBe(1);
  });
  it("keeps enterprise pending ledger/bindings/payload intact and never overwrites completed with fail", async () => {
    await bind(); const e = enterprise(); const r = await startStaffArchive(e.input, e.proof); expect(r.state).toBe("access_closed");
    await markStaffArchiveAttempt(r); await failStaffArchive(r, "企业离职待处理");
    const pending = await findStaffArchive(20); expect(pending).toMatchObject({ state: "retryable", requestId: e.input.requestId, nextOwnerUserId: 303, expectedRevision: e.input.expectedRevision, actorFrontUserId: 101, frontUserId: 202, attemptCount: 1 });
    expect((await q("SELECT * FROM admin_business_staff_bindings WHERE adminUserId=20"))[0]).toMatchObject({ status: "active", frontUserId: 202, bindingVersion: 3 });
    expect(await q("SELECT * FROM admin_business_staff_binding_audits")).toHaveLength(1);
    expect((await q("SELECT * FROM admin_business_merchant_scopes"))[0]).toMatchObject({ status: "revoked", scopeVersion: 3 });
    await expect(completeStaffArchive({ ...r, requestId: "fixture_other_request" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await findStaffArchive(20))?.state).toBe("retryable");
    await completeStaffArchive(r); await completeStaffArchive(r); await failStaffArchive(r, "late error"); await markStaffArchiveAttempt(r); expect((await findStaffArchive(20))?.state).toBe("completed");
    expect(await q("SELECT * FROM audit_logs WHERE action='staff_archive_completed' AND targetId='20'")).toHaveLength(1);
  });
  it("prevents update/toggle/bind/revoke reactivation even for corrupt active archived status", async () => {
    await startStaffArchive(input(), proof()); await q("UPDATE admin_users SET status='active' WHERE id=20");
    await expect(real.updateAdminUser(20, { displayName: "bypass", status: "active", actorAdminUserId: 10 })).rejects.toThrow("ADMIN_USER_ARCHIVED");
    await expect(real.toggleAdminUserStatus(20, "active", 10)).rejects.toThrow("ADMIN_USER_ARCHIVED");
    const actor = { operatorId: 10, operatorName: "Fixture", operatorRole: "super_admin" };
    await expect(real.bindBusinessStaffPrincipal({ adminUserId: 20, frontUserId: 202, expectedVersion: 0, requestId: "fixture_rebind_bypass", actor })).rejects.toThrow("ADMIN_USER_ARCHIVED");
    await expect(real.revokeBusinessStaffPrincipal({ adminUserId: 20, expectedVersion: 0, requestId: "fixture_revoke_bypass", actor })).rejects.toThrow("ADMIN_USER_ARCHIVED");
    expect((await q("SELECT displayName FROM admin_users WHERE id=20"))[0].displayName).toBe("Fixture target");
  });
  it("fails closed for former bindings, changed bindings and unsupported local sales ownership", async () => {
    await bind(); await q("UPDATE admin_business_staff_bindings SET status='revoked',frontUserId=NULL WHERE adminUserId=20");
    expect((await staffBindingHistory(20)).kind).toBe("unresolved"); await expect(startStaffArchive(input(), proof())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await q("UPDATE admin_business_staff_bindings SET status='active',frontUserId=202,bindingVersion=4 WHERE adminUserId=20"); const e = enterprise();
    await expect(startStaffArchive(e.input, e.proof)).rejects.toMatchObject({ code: "CONFLICT" });
    await q("UPDATE admin_business_staff_bindings SET bindingVersion=3 WHERE adminUserId=20"); await q("INSERT INTO merchants(salesOwnerCode) VALUES('fixture-target')");
    await expect(startStaffArchive(e.input, e.proof)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(await findStaffArchive(20)).toBeNull();
    expect((await q("SELECT salesOwnerCode FROM merchants"))[0].salesOwnerCode).toBe("fixture-target");
  });
});
