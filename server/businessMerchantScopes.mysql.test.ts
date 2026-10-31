import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import {
  adminBusinessMerchantScopeAudits,
  adminBusinessMerchantScopes,
  adminUserPermissions,
  adminUsers,
  adminUserSalesScopes,
  auditLogs,
  merchants,
} from "../drizzle/schema";
import { assertGuardedTestDatabase } from "../tests/frozenTestEnvironment";

const execFileAsync = promisify(execFile);
const TEST_DATABASE_URL = "mysql://root@127.0.0.1:13307/migration_admin_test";
const FIXTURE_PREFIX = "company1merchant30061scopev12";
const frozenMode = process.env.MIGRATION_FROZEN_MODE === "frozen-full";

let dbModule: typeof import("./db");
let connection: Awaited<ReturnType<(typeof import("./db"))["getDb"]>>;
let testDatabaseUrl = "";
let originalDatabaseUrl: string | undefined;
let originalPlatformDbName: string | undefined;
let operatorId = 0;
let targetAId = 0;
let targetBId = 0;
let disabledTargetId = 0;
let merchantAId = 0;
let merchantBId = 0;
let nativeAuthorizationBeforeHash = "";

function actor() {
  return {
    operatorId,
    operatorName: "业务商户范围真实操作者",
    operatorRole: "super_admin",
    ipAddress: "127.0.0.1",
    userAgent: "business-merchant-scopes-mysql-test",
  };
}

function requestId(suffix: string) {
  return `${FIXTURE_PREFIX}_${suffix}`;
}

function chosenDatabaseUrl() {
  if (!frozenMode) return TEST_DATABASE_URL;
  if (!process.env.ADMIN_DB_URL) {
    throw new Error("BUSINESS_SCOPE_FROZEN_ADMIN_DB_URL_REQUIRED");
  }
  return process.env.ADMIN_DB_URL;
}

function exactFixtureCondition(column: typeof adminUsers.username) {
  return like(column, `${FIXTURE_PREFIX}%`);
}

function arrayJson(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return JSON.parse(value) as string[];
  return [];
}

function rejectionDetail(reason: unknown) {
  if (reason instanceof Error && reason.cause) {
    return `${String(reason)}\nCAUSE: ${String(reason.cause)}`;
  }
  return String(reason);
}

async function fixtureAdminIds() {
  const rows = await connection!
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(exactFixtureCondition(adminUsers.username));
  return rows.map(row => row.id);
}

async function fixtureMerchantIds() {
  const rows = await connection!
    .select({ id: merchants.id })
    .from(merchants)
    .where(like(merchants.merchantNo, `${FIXTURE_PREFIX}%`));
  return rows.map(row => row.id);
}

/** Deletes only rows identified by this source-owned test prefix and their exact IDs. */
async function cleanupFixtures() {
  if (!connection) return;
  const adminIds = await fixtureAdminIds();
  const merchantIds = await fixtureMerchantIds();
  const scopeAuditFilters = [
    adminIds.length > 0 ? inArray(adminBusinessMerchantScopeAudits.adminUserId, adminIds) : undefined,
    merchantIds.length > 0 ? inArray(adminBusinessMerchantScopeAudits.merchantId, merchantIds) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (scopeAuditFilters.length > 0) {
    await connection.delete(adminBusinessMerchantScopeAudits).where(or(...scopeAuditFilters));
  }
  const scopeFilters = [
    adminIds.length > 0 ? inArray(adminBusinessMerchantScopes.adminUserId, adminIds) : undefined,
    merchantIds.length > 0 ? inArray(adminBusinessMerchantScopes.merchantId, merchantIds) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (scopeFilters.length > 0) {
    await connection.delete(adminBusinessMerchantScopes).where(or(...scopeFilters));
  }
  if (adminIds.length > 0) {
    await connection.delete(auditLogs).where(inArray(auditLogs.operatorId, adminIds));
    await connection.delete(adminUserPermissions).where(inArray(adminUserPermissions.adminUserId, adminIds));
    await connection.delete(adminUserSalesScopes).where(inArray(adminUserSalesScopes.adminUserId, adminIds));
    await connection.delete(adminUsers).where(inArray(adminUsers.id, adminIds));
  }
  if (merchantIds.length > 0) {
    await connection.delete(merchants).where(inArray(merchants.id, merchantIds));
  }
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
      userId: 98130000 + input.suffix.length,
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

async function createMerchant(suffix: string) {
  if (!connection) throw new Error("TEST_DATABASE_UNAVAILABLE");
  const merchantNo = `${FIXTURE_PREFIX}${suffix}`;
  const [created] = await connection
    .insert(merchants)
    .values({
      merchantNo,
      companyName: `${FIXTURE_PREFIX}-${suffix}`,
    })
    .$returningId();
  if (!created || !Number.isSafeInteger(created.id) || created.id <= 0) {
    throw new Error("TEST_MERCHANT_CREATE_FAILED");
  }
  return created.id;
}

async function nativeAuthorizationHash() {
  const ids = [operatorId, targetAId, targetBId, disabledTargetId];
  const [accounts, permissions, salesScopes] = await Promise.all([
    connection!
      .select({
        id: adminUsers.id,
        userId: adminUsers.userId,
        username: adminUsers.username,
        adminRole: adminUsers.adminRole,
        status: adminUsers.status,
      })
      .from(adminUsers)
      .where(inArray(adminUsers.id, ids))
      .orderBy(asc(adminUsers.id)),
    connection!
      .select({ adminUserId: adminUserPermissions.adminUserId, permission: adminUserPermissions.permission })
      .from(adminUserPermissions)
      .where(inArray(adminUserPermissions.adminUserId, ids))
      .orderBy(asc(adminUserPermissions.adminUserId), asc(adminUserPermissions.permission)),
    connection!
      .select({ adminUserId: adminUserSalesScopes.adminUserId, staffCode: adminUserSalesScopes.staffCode })
      .from(adminUserSalesScopes)
      .where(inArray(adminUserSalesScopes.adminUserId, ids))
      .orderBy(asc(adminUserSalesScopes.adminUserId), asc(adminUserSalesScopes.staffCode)),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ accounts, permissions, salesScopes }))
    .digest("hex");
}

async function scopeAuditsFor(adminUserId: number, merchantId: number) {
  return connection!
    .select()
    .from(adminBusinessMerchantScopeAudits)
    .where(and(
      eq(adminBusinessMerchantScopeAudits.adminUserId, adminUserId),
      eq(adminBusinessMerchantScopeAudits.merchantId, merchantId),
    ))
    .orderBy(asc(adminBusinessMerchantScopeAudits.id));
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  originalPlatformDbName = process.env.PLATFORM_DB_NAME;
  testDatabaseUrl = assertGuardedTestDatabase(
    chosenDatabaseUrl(),
    /^\/migration_admin_test$/,
  );

  // Frozen runs use the manifest-approved ADMIN_DB_URL and must already contain
  // the frozen, hash-reviewed DDL. Only the exact disposable local test schema
  // receives bootstrap DDL from this writer.
  if (!frozenMode) {
    await execFileAsync(process.execPath, [
      resolve(process.cwd(), "scripts/apply-business-merchant-scope-schema.mjs"),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" },
    });
  }

  process.env.DATABASE_URL = testDatabaseUrl;
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
  disabledTargetId = await createAdmin({ suffix: "target_disabled", status: "disabled" });
  merchantAId = await createMerchant("ma");
  merchantBId = await createMerchant("mb");

  // These are deliberately pre-existing native authorization fixtures. Scope
  // mutations must leave the original role, explicit permissions and sales
  // visibility rows byte-for-byte equivalent under this stable projection.
  await connection!.insert(adminUserPermissions).values([
    { adminUserId: targetAId, permission: "merchant.view" },
    { adminUserId: targetBId, permission: "orders.view" },
  ]);
  await connection!.insert(adminUserSalesScopes).values([
    { adminUserId: targetAId, staffCode: `${FIXTURE_PREFIX}-sales-a` },
    { adminUserId: targetBId, staffCode: `${FIXTURE_PREFIX}-sales-b` },
  ]);
  nativeAuthorizationBeforeHash = await nativeAuthorizationHash();
});

afterEach(async () => {
  expect(nativeAuthorizationBeforeHash).not.toBe("");
  expect(await nativeAuthorizationHash()).toBe(nativeAuthorizationBeforeHash);
});

afterAll(async () => {
  try {
    await cleanupFixtures();
  } finally {
    if (connection) await connection.$client.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPlatformDbName === undefined) delete process.env.PLATFORM_DB_NAME;
    else process.env.PLATFORM_DB_NAME = originalPlatformDbName;
  }
});

describe("业务商户 BFF 精确范围（受守卫真实 MySQL）", () => {
  it("拒绝非法 ID、模块、requestId、缺失账号和停用目标，且不创建范围", async () => {
    const valid = {
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.context.read"],
      expectedVersion: 0,
      requestId: requestId("invalid_base"),
      actor: actor(),
    };
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, adminUserId: 0 }))
      .rejects.toThrow("BUSINESS_SCOPE_ADMIN_INVALID");
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, merchantId: 0 }))
      .rejects.toThrow("BUSINESS_SCOPE_MERCHANT_INVALID");
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, modulePermissions: ["business.admin.read"] }))
      .rejects.toThrow("BUSINESS_SCOPE_MODULES_INVALID");
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, requestId: "short" }))
      .rejects.toThrow("BUSINESS_SCOPE_REQUEST_ID_INVALID");
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, adminUserId: 987654321 }))
      .rejects.toThrow("BUSINESS_SCOPE_ADMIN_NOT_FOUND");
    await expect(dbModule.grantBusinessMerchantScope({ ...valid, adminUserId: disabledTargetId }))
      .rejects.toThrow("BUSINESS_SCOPE_ADMIN_INACTIVE");
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId)).toBeNull();
    expect(await dbModule.listActiveBusinessMerchantScopes(targetAId)).toEqual([]);
  });

  it("只读取精确 admin+merchant 的 active scope，按商户和账号严格隔离", async () => {
    const grantedA = await dbModule.grantBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.inventory.write", "business.context.read"],
      expectedVersion: 0,
      requestId: requestId("exact_a"),
      actor: actor(),
    });
    const grantedB = await dbModule.grantBusinessMerchantScope({
      adminUserId: targetBId,
      merchantId: merchantAId,
      modulePermissions: ["business.users.read"],
      expectedVersion: 0,
      requestId: requestId("exact_b"),
      actor: actor(),
    });

    expect(grantedA).toMatchObject({
      adminUserId: targetAId,
      merchantId: merchantAId,
      status: "active",
      scopeVersion: 1,
      modulePermissions: ["business.context.read", "business.inventory.write"],
      action: "granted",
      idempotent: false,
    });
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId)).toMatchObject({
      id: grantedA.scopeId,
      modulePermissions: ["business.context.read", "business.inventory.write"],
    });
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantBId)).toBeNull();
    expect(await dbModule.getActiveBusinessMerchantScope(targetBId, merchantAId)).toMatchObject({
      id: grantedB.scopeId,
      modulePermissions: ["business.users.read"],
    });
    expect(await dbModule.listActiveBusinessMerchantScopes(targetAId)).toEqual([
      expect.objectContaining({ id: grantedA.scopeId, merchantId: merchantAId }),
    ]);
  });

  it("同 requestId 仅重放同 payload 一次审计；变更 payload 或主体时全局拒绝", async () => {
    const initialRequestId = requestId("replay_once");
    const input = {
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.context.read"],
      expectedVersion: 0,
      requestId: initialRequestId,
      actor: actor(),
    };
    const granted = await dbModule.grantBusinessMerchantScope(input);
    const replayed = await dbModule.grantBusinessMerchantScope(input);
    expect(replayed).toMatchObject({
      scopeId: granted.scopeId,
      action: "granted",
      scopeVersion: 1,
      idempotent: true,
    });
    await expect(dbModule.grantBusinessMerchantScope({
      ...input,
      modulePermissions: ["business.orders.read"],
    })).rejects.toThrow("BUSINESS_SCOPE_REQUEST_ID_REUSED");
    await expect(dbModule.grantBusinessMerchantScope({
      ...input,
      adminUserId: targetBId,
    })).rejects.toThrow("BUSINESS_SCOPE_REQUEST_ID_REUSED");

    const audits = await scopeAuditsFor(targetAId, merchantAId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      scopeId: granted.scopeId,
      adminUserId: targetAId,
      merchantId: merchantAId,
      action: "granted",
      expectedVersion: 0,
      resultingVersion: 1,
      requestId: initialRequestId,
      operatorAdminUserId: operatorId,
      operatorName: actor().operatorName,
      operatorRole: actor().operatorRole,
    });
    expect(arrayJson(audits[0].beforeModulePermissions)).toEqual([]);
    expect(arrayJson(audits[0].afterModulePermissions)).toEqual(["business.context.read"]);
  });

  it("拒绝 stale CAS；撤销后读与列表均失效，并以连续版本重新授权", async () => {
    const initialModules = ["business.context.read"];
    const first = await dbModule.grantBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: initialModules,
      expectedVersion: 0,
      requestId: requestId("lifecycle_grant"),
      actor: actor(),
    });
    await expect(dbModule.grantBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.orders.read"],
      expectedVersion: 0,
      requestId: requestId("lifecycle_stale"),
      actor: actor(),
    })).rejects.toThrow("BUSINESS_SCOPE_VERSION_CONFLICT");
    const revoked = await dbModule.revokeBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      expectedVersion: 1,
      requestId: requestId("lifecycle_revoke"),
      actor: actor(),
    });
    expect(revoked).toMatchObject({
      scopeId: first.scopeId,
      status: "revoked",
      scopeVersion: 2,
      modulePermissions: [],
      action: "revoked",
      idempotent: false,
    });
    expect(await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId)).toBeNull();
    expect(await dbModule.listActiveBusinessMerchantScopes(targetAId)).toEqual([]);

    const regranted = await dbModule.grantBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.orders.read"],
      expectedVersion: 2,
      requestId: requestId("lifecycle_regrant"),
      actor: actor(),
    });
    expect(regranted).toMatchObject({
      scopeId: first.scopeId,
      status: "active",
      scopeVersion: 3,
      modulePermissions: ["business.orders.read"],
      action: "granted",
    });

    const audits = await scopeAuditsFor(targetAId, merchantAId);
    expect(audits.map(audit => audit.action)).toEqual(["granted", "revoked", "granted"]);
    expect(audits.map(audit => audit.expectedVersion)).toEqual([0, 1, 2]);
    expect(audits.map(audit => audit.resultingVersion)).toEqual([1, 2, 3]);
    expect(audits.map(audit => audit.requestId)).toEqual([
      requestId("lifecycle_grant"),
      requestId("lifecycle_revoke"),
      requestId("lifecycle_regrant"),
    ]);
    expect(new Set(audits.map(audit => audit.requestId)).size).toBe(audits.length);
    expect(audits.every(audit => audit.operatorAdminUserId === operatorId)).toBe(true);
    expect(arrayJson(audits[1].beforeModulePermissions)).toEqual(initialModules);
    expect(arrayJson(audits[1].afterModulePermissions)).toEqual([]);
    expect(arrayJson(audits[2].beforeModulePermissions)).toEqual([]);
    expect(arrayJson(audits[2].afterModulePermissions)).toEqual(["business.orders.read"]);
  });

  it("并发两个相同版本的 grant 只提交一个；另一请求必须报告真实 CAS 冲突", async () => {
    const outcomes = await Promise.allSettled([
      dbModule.grantBusinessMerchantScope({
        adminUserId: targetAId,
        merchantId: merchantAId,
        modulePermissions: ["business.context.read"],
        expectedVersion: 0,
        requestId: requestId("race_grant_a"),
        actor: actor(),
      }),
      dbModule.grantBusinessMerchantScope({
        adminUserId: targetAId,
        merchantId: merchantAId,
        modulePermissions: ["business.orders.read"],
        expectedVersion: 0,
        requestId: requestId("race_grant_b"),
        actor: actor(),
      }),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof dbModule.grantBusinessMerchantScope>>
      > => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Do not normalize or accept deadlocks here: one would expose a genuine
    // source concurrency gap instead of an expected optimistic CAS result.
    expect(rejectionDetail(rejected[0].reason)).toContain("BUSINESS_SCOPE_VERSION_CONFLICT");

    const current = await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId);
    expect(current).toMatchObject({
      scopeVersion: 1,
      modulePermissions: fulfilled[0].value.modulePermissions,
    });
    const audits = await scopeAuditsFor(targetAId, merchantAId);
    expect(audits).toHaveLength(1);
    expect(audits[0].requestId).toBe(fulfilled[0].value.modulePermissions[0] === "business.context.read"
      ? requestId("race_grant_a")
      : requestId("race_grant_b"));
  });

  it("并发 grant/revoke 使用同版本时只有一个提交，失败方不会覆盖最终范围", async () => {
    await dbModule.grantBusinessMerchantScope({
      adminUserId: targetAId,
      merchantId: merchantAId,
      modulePermissions: ["business.context.read"],
      expectedVersion: 0,
      requestId: requestId("race_lifecycle_seed"),
      actor: actor(),
    });
    const outcomes = await Promise.allSettled([
      dbModule.grantBusinessMerchantScope({
        adminUserId: targetAId,
        merchantId: merchantAId,
        modulePermissions: ["business.users.read"],
        expectedVersion: 1,
        requestId: requestId("race_lifecycle_grant"),
        actor: actor(),
      }),
      dbModule.revokeBusinessMerchantScope({
        adminUserId: targetAId,
        merchantId: merchantAId,
        expectedVersion: 1,
        requestId: requestId("race_lifecycle_revoke"),
        actor: actor(),
      }),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<
        | Awaited<ReturnType<typeof dbModule.grantBusinessMerchantScope>>
        | Awaited<ReturnType<typeof dbModule.revokeBusinessMerchantScope>>
      > => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejectionDetail(rejected[0].reason)).toContain("BUSINESS_SCOPE_VERSION_CONFLICT");

    const winner = fulfilled[0].value;
    const current = await dbModule.getActiveBusinessMerchantScope(targetAId, merchantAId);
    if (winner.status === "revoked") {
      expect(current).toBeNull();
    } else {
      expect(current).toMatchObject({
        scopeVersion: 2,
        modulePermissions: winner.modulePermissions,
      });
    }
    const audits = await scopeAuditsFor(targetAId, merchantAId);
    expect(audits).toHaveLength(2);
    expect(audits.map(audit => audit.resultingVersion)).toEqual([1, 2]);
  });
});
