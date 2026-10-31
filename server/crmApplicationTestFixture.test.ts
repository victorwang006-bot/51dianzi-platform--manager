import { afterEach, describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ getDb }));

import {
  assertCrmApplicationFixtureEnvironment,
  cleanupApprovedCnCrmEnablement,
  prepareApprovedCnCrmEnablement,
} from "./crmApplicationTestFixture";

const guardedTestEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "mysql://root@127.0.0.1:13307/migration_v2_testinfra_admin_test",
  PLATFORM_DB_NAME: "migration_v2_testinfra_platform_test",
  LD_PRELOAD: "/home/ubuntu/51_migration_20261029/tests/local-network-only.so",
} as const;

const assumeGuardReadable = () => true;

afterEach(() => {
  getDb.mockReset();
});

describe("CRM application fixture loopback guard", () => {
  it("接受专属 testinfra admin/platform 双库，但未经父 manifest 验证的冻结库与猜测库均拒绝", () => {
    expect(() => assertCrmApplicationFixtureEnvironment(
      guardedTestEnvironment,
      assumeGuardReadable,
    )).not.toThrow();
    expect(() => assertCrmApplicationFixtureEnvironment({
      ...guardedTestEnvironment,
      DATABASE_URL: "mysql://root@127.0.0.1:13307/migration_frozen_platform_test",
    }, assumeGuardReadable)).toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
    expect(() => assertCrmApplicationFixtureEnvironment({
      ...guardedTestEnvironment,
      DATABASE_URL: "mysql://root@127.0.0.1:13307/migration_frozen_other_test",
    }, assumeGuardReadable)).toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
  });

  it.each([
    "mysql://root@localhost:13307/migration_v2_testinfra_admin_test",
    "mysql://other@127.0.0.1:13307/migration_v2_testinfra_admin_test",
    "mysql://root:password@127.0.0.1:13307/migration_v2_testinfra_admin_test",
  ])("拒绝不精确的本机/用户/密码连接且零DB调用：%s", databaseUrl => {
    expect(() => assertCrmApplicationFixtureEnvironment({ ...guardedTestEnvironment, DATABASE_URL: databaseUrl }, assumeGuardReadable)).toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("任意同名so路径不能以可读性注入绕过指定守卫", () => {
    expect(() => assertCrmApplicationFixtureEnvironment({ ...guardedTestEnvironment, LD_PRELOAD: "/isolated/local-network-only.so" }, assumeGuardReadable)).toThrow("CRM_FIXTURE_REQUIRES_LOCAL_NETWORK_GUARD");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("拒绝把 admin 库回退成平台库，或缺失 platform schema 配置，且零 DB 调用", () => {
    expect(() => assertCrmApplicationFixtureEnvironment({
      ...guardedTestEnvironment,
      DATABASE_URL: "mysql://root@127.0.0.1:13307/migration_v2_testinfra_platform_test",
    }, assumeGuardReadable)).toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
    expect(() => assertCrmApplicationFixtureEnvironment({
      ...guardedTestEnvironment,
      PLATFORM_DB_NAME: "",
    }, assumeGuardReadable)).toThrow("CRM_FIXTURE_PLATFORM_DATABASE_INVALID");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a production-looking schema before prepare can obtain a database or write", async () => {
    const writes = vi.fn();
    getDb.mockResolvedValue({ execute: writes, update: writes });
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPreload = process.env.LD_PRELOAD;
    process.env.NODE_ENV = "test";
    process.env.LD_PRELOAD = "/home/ubuntu/51_migration_20261029/tests/local-network-only.so";
    process.env.DATABASE_URL = "mysql://root@127.0.0.1:13307/dianzi51";

    try {
      await expect(prepareApprovedCnCrmEnablement({
        merchantId: 1,
        creditCode: "91310100CRMZERO001",
        portalUserId: "7101",
      })).rejects.toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
      await expect(cleanupApprovedCnCrmEnablement({
        creditCode: "91310100CRMZERO001",
        enterpriseId: 7101,
        portalUserId: "7101",
      })).rejects.toThrow("CRM_FIXTURE_REQUIRES_ADMIN_ERP_LOOPBACK_SCHEMA");
      expect(getDb).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalPreload === undefined) delete process.env.LD_PRELOAD;
      else process.env.LD_PRELOAD = originalPreload;
    }
  });
});
