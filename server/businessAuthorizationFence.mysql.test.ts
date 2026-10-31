import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import {
  adminBusinessMerchantScopeAudits,
  adminBusinessMerchantScopes,
  adminUsers,
  auditLogs,
  merchants,
} from "../drizzle/schema";
import { assertGuardedTestDatabase } from "../tests/frozenTestEnvironment";

const execFileAsync = promisify(execFile);
const TEST_DATABASE_URL = "mysql://root@127.0.0.1:13307/migration_admin_test";
const FIXTURE_PREFIX = "company1merchant30061fencev12";
const frozenMode = process.env.MIGRATION_FROZEN_MODE === "frozen-full";

let dbModule: typeof import("./db");
let connection: Awaited<ReturnType<(typeof import("./db"))["getDb"]>>;
let testDatabaseUrl = "";
let originalDatabaseUrl: string | undefined;
let operatorId = 0;
let targetAId = 0;
let targetBId = 0;
let merchantAId = 0;
let merchantBId = 0;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function actor() {
  return {
    operatorId,
    operatorName: "业务撤销栅栏真实操作者",
    operatorRole: "super_admin",
    ipAddress: "127.0.0.1",
    userAgent: "business-authorization-fence-mysql-test",
  };
}

function requestId(suffix: string) {
  return `${FIXTURE_PREFIX}_${suffix}`;
}

function chosenDatabaseUrl() {
  if (!frozenMode) return TEST_DATABASE_URL;
  if (!process.env.ADMIN_DB_URL) throw new Error("BUSINESS_FENCE_FROZEN_ADMIN_DB_URL_REQUIRED");
  return process.env.ADMIN_DB_URL;
}

async function fixtureAdminIds() {
  return (await connection!
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(like(adminUsers.username, `${FIXTURE_PREFIX}%`)))
    .map(row => row.id);
}

async function fixtureMerchantIds() {
  return (await connection!
    .select({ id: merchants.id })
    .from(merchants)
    .where(like(merchants.merchantNo, `${FIXTURE_PREFIX}%`)))
    .map(row => row.id);
}

async function cleanupFixtures() {
  if (!connection) return;
  const [adminIds, merchantIds] = await Promise.all([fixtureAdminIds(), fixtureMerchantIds()]);
  if (adminIds.length > 0) {
    await connection.delete(adminBusinessMerchantScopeAudits)
      .where(inArray(adminBusinessMerchantScopeAudits.adminUserId, adminIds));
    await connection.delete(adminBusinessMerchantScopes)
      .where(inArray(adminBusinessMerchantScopes.adminUserId, adminIds));
    await connection.delete(auditLogs).where(inArray(auditLogs.operatorId, adminIds));
    await connection.delete(adminUsers).where(inArray(adminUsers.id, adminIds));
  }
  if (merchantIds.length > 0) {
    await connection.delete(merchants).where(inArray(merchants.id, merchantIds));
  }
}

async function createAdmin(suffix: string, userId: number) {
  const username = `${FIXTURE_PREFIX}_${suffix}`;
  const [created] = await connection!.insert(adminUsers).values({
    userId,
    username,
    usernameCanonical: username,
    displayName: username,
    adminRole: "operation",
    status: "active",
    passwordHash: null,
  }).$returningId();
  if (!created?.id) throw new Error("BUSINESS_FENCE_TEST_ADMIN_CREATE_FAILED");
  return created.id;
}

async function createMerchant(suffix: string) {
  const [created] = await connection!.insert(merchants).values({
    merchantNo: `${FIXTURE_PREFIX}${suffix}`,
    companyName: `${FIXTURE_PREFIX}-${suffix}`,
  }).$returningId();
  if (!created?.id) throw new Error("BUSINESS_FENCE_TEST_MERCHANT_CREATE_FAILED");
  return created.id;
}

async function grantContextScope(adminUserId: number, merchantId: number, suffix: string) {
  return dbModule.grantBusinessMerchantScope({
    adminUserId,
    merchantId,
    modulePermissions: ["business.context.read", "business.inventory.read"],
    expectedVersion: 0,
    requestId: requestId(`grant_${suffix}`),
    actor: actor(),
  });
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  testDatabaseUrl = assertGuardedTestDatabase(chosenDatabaseUrl(), /^\/migration_admin_test$/);
  if (!frozenMode) {
    await execFileAsync(process.execPath, [
      resolve(process.cwd(), "scripts/apply-business-merchant-scope-schema.mjs"),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" },
    });
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  dbModule = await import("./db");
  connection = await dbModule.getDb();
  if (!connection) throw new Error("BUSINESS_FENCE_TEST_DATABASE_UNAVAILABLE");
  await cleanupFixtures();
});

beforeEach(async () => {
  await cleanupFixtures();
  operatorId = await createAdmin("operator", 98531001);
  targetAId = await createAdmin("target_a", 98531002);
  targetBId = await createAdmin("target_b", 98531003);
  merchantAId = await createMerchant("ma");
  merchantBId = await createMerchant("mb");
});

afterAll(async () => {
  try {
    await cleanupFixtures();
  } finally {
    if (connection) await connection.$client.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("业务 BFF authorization fence（真实 MySQL）", () => {
  it("真实 MySQL fence 线性化在途命令与 revoke；revoke 成功后旧 scope 不会再启动", async () => {
    const granted = await grantContextScope(targetAId, merchantAId, "linearized");
    const commandEntered = deferred<void>();
    const releaseCommand = deferred<void>();

    // This callback represents the in-flight front RPC interval. The named
    // MySQL lock is real; no timer or mocked database is used to hold it.
    const inFlightCommand = dbModule.withBusinessAuthorizationFence(
      { adminUserId: targetAId, merchantId: merchantAId },
      async () => {
        await dbModule.recordBusinessCommandAccess({
          merchantId: merchantAId,
          staffUserId: 715001,
          bindingVersion: 1,
          scopeVersion: granted.scopeVersion,
          method: "inventory.list",
          requestId: requestId("inflight_command"),
          actor: actor(),
        });
        commandEntered.resolve();
        await releaseCommand.promise;
      },
    );
    await commandEntered.promise;

    let revokeResolved = false;
    const revocation = dbModule.revokeBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      expectedVersion: granted.scopeVersion,
      requestId: requestId("revoke_after_command"),
      actor: actor(),
    }).then(value => {
      revokeResolved = true;
      return value;
    });

    // The live scope remains active while the first connection owns the actual
    // advisory lock; the revoke cannot commit through the held command fence.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(revokeResolved).toBe(false);
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId)).toMatchObject({
      scopeVersion: granted.scopeVersion,
    });

    releaseCommand.resolve();
    await inFlightCommand;
    const revoked = await revocation;
    expect(revoked).toMatchObject({ status: "revoked", scopeVersion: granted.scopeVersion + 1 });
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId)).toBeNull();

    const audits = await connection!
      .select({ id: auditLogs.id, action: auditLogs.action, afterValue: auditLogs.afterValue })
      .from(auditLogs)
      .where(eq(auditLogs.operatorId, operatorId))
      .orderBy(asc(auditLogs.id));
    const commandAudit = audits.find(audit => audit.action === "business.command.inventory.list");
    const revokeAudit = audits.find(audit => audit.action === "business.merchant-scope.revoked");
    expect(commandAudit).toBeDefined();
    expect(revokeAudit).toBeDefined();
    expect(commandAudit!.id).toBeLessThan(revokeAudit!.id);
    expect(commandAudit!.afterValue).toMatchObject({
      requestId: requestId("inflight_command"),
      bindingVersion: 1,
      scopeVersion: granted.scopeVersion,
      authorizationFence: "held",
    });

    let remoteWouldStart = false;
    await expect(dbModule.withBusinessAuthorizationFence(
      { adminUserId: targetAId, merchantId: merchantAId },
      async () => {
        const current = await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId);
        if (!current) throw new Error("BUSINESS_SCOPE_REVOKED_BEFORE_REMOTE_START");
        remoteWouldStart = true;
      },
    )).rejects.toThrow("BUSINESS_SCOPE_REVOKED_BEFORE_REMOTE_START");
    expect(remoteWouldStart).toBe(false);
  });

  it("不同后台账号使用不同 fence，不因另一个账号的 in-flight RPC 串行", async () => {
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondEntered = deferred<void>();
    const first = dbModule.withBusinessAuthorizationFence(
      { adminUserId: targetAId, merchantId: merchantAId },
      async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
      },
    );
    await firstEntered.promise;
    const second = dbModule.withBusinessAuthorizationFence(
      { adminUserId: targetBId, merchantId: merchantBId },
      async () => secondEntered.resolve(),
    );

    await expect(Promise.race([
      secondEntered.promise,
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error("BUSINESS_FENCE_DIFFERENT_ADMIN_SERIALIZED")),
        1_000,
      )),
    ])).resolves.toBeUndefined();
    releaseFirst.resolve();
    await Promise.all([first, second]);
  });

  it("停用目标账号后仍可按同一 account fence 撤销已存在 scope", async () => {
    const granted = await grantContextScope(targetAId, merchantAId, "disabled_revoke");
    await connection!.update(adminUsers).set({ status: "disabled" }).where(eq(adminUsers.id, targetAId));

    await expect(dbModule.revokeBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      expectedVersion: granted.scopeVersion,
      requestId: requestId("disabled_revoke"),
      actor: actor(),
    })).resolves.toMatchObject({ status: "revoked", scopeVersion: granted.scopeVersion + 1 });
  });
});
