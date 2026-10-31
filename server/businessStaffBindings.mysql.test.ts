import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import {
  adminBusinessStaffBindingAudits,
  adminBusinessStaffBindings,
  adminUsers,
  auditLogs,
} from "../drizzle/schema";

const TEST_DATABASE_URL = "mysql://root@127.0.0.1:13307/migration_admin_test";
const FIXTURE_PREFIX = "db_phase3_business_binding";
const FRONT_USERS = {
  primary: 710001,
  replacement: 710002,
  shared: 710003,
  race: 710004,
} as const;

let dbModule: typeof import("./db");
let connection: Awaited<ReturnType<(typeof import("./db"))["getDb"]>>;
let operatorId = 0;
let targetAId = 0;
let targetBId = 0;
let targetCId = 0;
let disabledTargetId = 0;

function actor() {
  return {
    operatorId,
    operatorName: "绑定测试真实操作者",
    operatorRole: "super_admin",
    ipAddress: "127.0.0.1",
    userAgent: "business-staff-bindings-mysql-test",
  };
}

function requestId(suffix: string) {
  return `dbphase3bind_${suffix}`;
}

async function cleanupFixtures() {
  if (!connection) return;
  const rows = await connection
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(like(adminUsers.username, `${FIXTURE_PREFIX}%`));
  const ids = rows.map(row => row.id);
  if (ids.length === 0) return;
  await connection
    .delete(adminBusinessStaffBindingAudits)
    .where(inArray(adminBusinessStaffBindingAudits.adminUserId, ids));
  await connection
    .delete(adminBusinessStaffBindings)
    .where(inArray(adminBusinessStaffBindings.adminUserId, ids));
  await connection.delete(auditLogs).where(inArray(auditLogs.operatorId, ids));
  await connection.delete(adminUsers).where(inArray(adminUsers.id, ids));
}

async function createAdmin(input: {
  suffix: string;
  status?: "active" | "disabled";
  role?: "super_admin" | "operation";
}) {
  if (!connection) throw new Error("TEST_DATABASE_UNAVAILABLE");
  const username = `${FIXTURE_PREFIX}_${input.suffix}`;
  const [created] = await connection
    .insert(adminUsers)
    .values({
      userId: 980000 + input.suffix.length,
      username,
      usernameCanonical: username,
      displayName: username,
      adminRole: input.role ?? "operation",
      status: input.status ?? "active",
      passwordHash: null,
    })
    .$returningId();
  if (!created || !Number.isSafeInteger(created.id) || created.id <= 0) {
    throw new Error("TEST_ADMIN_CREATE_FAILED");
  }
  return created.id;
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.PLATFORM_DB_NAME = "migration_platform_test";
  dbModule = await import("./db");
  connection = await dbModule.getDb();
  if (!connection) throw new Error("TEST_DATABASE_UNAVAILABLE");
  await cleanupFixtures();
});

beforeEach(async () => {
  await cleanupFixtures();
  operatorId = await createAdmin({ suffix: "operator", role: "super_admin" });
  targetAId = await createAdmin({ suffix: "target_a" });
  targetBId = await createAdmin({ suffix: "target_b" });
  targetCId = await createAdmin({ suffix: "target_c" });
  disabledTargetId = await createAdmin({
    suffix: "target_disabled",
    status: "disabled",
  });
});

afterAll(async () => {
  await cleanupFixtures();
  delete process.env.DATABASE_URL;
  delete process.env.PLATFORM_DB_NAME;
});

describe("业务员工真实主体绑定（隔离MySQL）", () => {
  it("拒绝无效前台主体、缺失后台账号和停用后台账号，且不创建绑定", async () => {
    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetAId,
        frontUserId: 0,
        expectedVersion: 0,
        requestId: requestId("invalid_front"),
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_FRONT_USER_INVALID");
    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: 987654321,
        frontUserId: FRONT_USERS.primary,
        expectedVersion: 0,
        requestId: requestId("missing_admin"),
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_ADMIN_NOT_FOUND");
    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: disabledTargetId,
        frontUserId: FRONT_USERS.primary,
        expectedVersion: 0,
        requestId: requestId("disabled_admin"),
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_ADMIN_INACTIVE");
    expect(await dbModule.getActiveBusinessStaffBinding(targetAId)).toBeNull();
  });

  it("以真实操作者写入一对一绑定、CAS重放审计、撤销和重绑", async () => {
    const initialRequest = requestId("initial");
    const bound = await dbModule.bindBusinessStaffPrincipal({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.primary,
      expectedVersion: 0,
      requestId: initialRequest,
      actor: actor(),
    });
    expect(bound).toMatchObject({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.primary,
      status: "active",
      bindingVersion: 1,
      action: "bound",
      idempotent: false,
    });
    expect(
      await dbModule.getActiveBusinessStaffBinding(targetAId)
    ).toMatchObject({
      id: bound.bindingId,
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.primary,
      bindingVersion: 1,
    });

    const replay = await dbModule.bindBusinessStaffPrincipal({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.primary,
      expectedVersion: 0,
      requestId: initialRequest,
      actor: actor(),
    });
    expect(replay).toMatchObject({
      bindingId: bound.bindingId,
      idempotent: true,
      bindingVersion: 1,
    });

    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetAId,
        frontUserId: FRONT_USERS.replacement,
        expectedVersion: 0,
        requestId: requestId("stale_cas"),
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_VERSION_CONFLICT");

    const rebound = await dbModule.bindBusinessStaffPrincipal({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.replacement,
      expectedVersion: 1,
      requestId: requestId("rebound"),
      actor: actor(),
    });
    expect(rebound).toMatchObject({
      action: "rebound",
      bindingVersion: 2,
      idempotent: false,
    });

    const revoked = await dbModule.revokeBusinessStaffPrincipal({
      adminUserId: targetAId,
      expectedVersion: 2,
      requestId: requestId("revoke"),
      actor: actor(),
    });
    expect(revoked).toMatchObject({
      frontUserId: null,
      status: "revoked",
      action: "revoked",
      bindingVersion: 3,
      idempotent: false,
    });
    expect(await dbModule.getActiveBusinessStaffBinding(targetAId)).toBeNull();

    const reboundAfterRevoke = await dbModule.bindBusinessStaffPrincipal({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.primary,
      expectedVersion: 3,
      requestId: requestId("rebind_after_revoke"),
      actor: actor(),
    });
    expect(reboundAfterRevoke).toMatchObject({
      action: "bound",
      bindingVersion: 4,
    });

    const bindingAudits = await connection!
      .select()
      .from(adminBusinessStaffBindingAudits)
      .where(eq(adminBusinessStaffBindingAudits.adminUserId, targetAId));
    expect(bindingAudits).toHaveLength(4);
    expect(bindingAudits.map(entry => entry.action)).toEqual([
      "bound",
      "rebound",
      "revoked",
      "bound",
    ]);
    expect(
      bindingAudits.every(entry => entry.operatorAdminUserId === operatorId)
    ).toBe(true);
    expect(
      bindingAudits.every(entry => entry.operatorName === actor().operatorName)
    ).toBe(true);
    expect(
      bindingAudits.filter(entry => entry.requestId === initialRequest)
    ).toHaveLength(1);

    await dbModule.recordBusinessContextAccess(501, actor());
    await dbModule.recordBusinessCommandAccess({
      merchantId: 501,
      staffUserId: FRONT_USERS.primary,
      bindingVersion: reboundAfterRevoke.bindingVersion,
      method: "inventory.manage.publish",
      requestId: requestId("command_audit"),
      actor: actor(),
    });
    const commandAudits = await connection!
      .select()
      .from(auditLogs)
      .where(like(auditLogs.action, "business.%"));
    expect(commandAudits).toHaveLength(6);
    expect(commandAudits.every(entry => entry.operatorId === operatorId)).toBe(
      true
    );
    expect(
      commandAudits.some(entry => entry.action === "business.context.view")
    ).toBe(true);
    expect(
      commandAudits.some(
        entry => entry.action === "business.command.inventory.manage.publish"
      )
    ).toBe(true);
  });

  it("拒绝两个后台账号占用同一真实前台主体，并将requestId全局唯一审计为重放冲突", async () => {
    const sharedRequest = requestId("shared_first");
    await dbModule.bindBusinessStaffPrincipal({
      adminUserId: targetAId,
      frontUserId: FRONT_USERS.shared,
      expectedVersion: 0,
      requestId: sharedRequest,
      actor: actor(),
    });
    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetBId,
        frontUserId: FRONT_USERS.shared,
        expectedVersion: 0,
        requestId: requestId("shared_second"),
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_FRONT_USER_ALREADY_BOUND");
    await expect(
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetBId,
        frontUserId: FRONT_USERS.replacement,
        expectedVersion: 0,
        requestId: sharedRequest,
        actor: actor(),
      })
    ).rejects.toThrow("BUSINESS_BINDING_REQUEST_ID_REUSED");
  });

  it("并发争用同一前台主体时仅一个绑定提交，另一个不会覆盖或产生第二个当前主体", async () => {
    const outcomes = await Promise.allSettled([
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetAId,
        frontUserId: FRONT_USERS.race,
        expectedVersion: 0,
        requestId: requestId("race_a"),
        actor: actor(),
      }),
      dbModule.bindBusinessStaffPrincipal({
        adminUserId: targetCId,
        frontUserId: FRONT_USERS.race,
        expectedVersion: 0,
        requestId: requestId("race_c"),
        actor: actor(),
      }),
    ]);
    const fulfilled = outcomes.filter(
      (
        outcome
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof dbModule.bindBusinessStaffPrincipal>>
      > => outcome.status === "fulfilled"
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(
      /BUSINESS_BINDING_FRONT_USER_ALREADY_BOUND|ER_LOCK_DEADLOCK/
    );

    const bindings = await connection!
      .select()
      .from(adminBusinessStaffBindings)
      .where(eq(adminBusinessStaffBindings.frontUserId, FRONT_USERS.race));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      status: "active",
      frontUserId: FRONT_USERS.race,
    });
  });
});
