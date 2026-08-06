import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("release/deploy-admin-crm-bank-fields.sh", "utf8");

describe("后台 CRM 企业/银行字段原子发布契约", () => {
  it("冻结当前前后台活动 release、构建哈希与实例", () => {
    expect(script).toContain("20260805T154206Z-admin-order-readonly-v2");
    expect(script).toContain("20260805T153128Z-order-readonly-v1");
    expect(script).toContain("241291,241304");
    expect(script).toContain("239984,239985,240010,240011");
    expect(script).toContain("7277679456ef2dad892851bec3c4231647e0f1626f24008f631493e0e2cf1199");
    expect(script).toContain("897d67d906c5cd3a7b1fd33f7e0dc30c16f6004ec6ceb3608640157a192a76cf");
  });

  it("发布包只含本任务必要源码、迁移、测试和锁文件", () => {
    expect(script).toContain("drizzle/0018_nifty_purple_man.sql");
    expect(script).toContain("server/crmBankFieldsContract.test.ts");
    expect(script).toContain("server/crmBankMigrationContract.test.ts");
    expect(script).toContain("archive file list is not exact");
    expect(script).toContain("sensitive, database, runtime, or audit path found in archive");
  });

  it("标准加列由列、迁移账本和商户行数前后核验保护", () => {
    expect(script).toContain("EXPECTED_OLD_MIGRATION_MAX='1785906253930'");
    expect(script).toContain("EXPECTED_NEW_MIGRATION_MAX='1785976729575'");
    expect(script).toContain("target merchant columns already exist before migration");
    expect(script).toContain("pnpm drizzle-kit migrate");
    expect(script).toContain("merchant row count changed during migration");
    expect(script).toContain("additive nullable columns are retained; old code remains compatible");
    expect(script).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE\s+TABLE/i);
  });

  it("远端重跑相关测试、TypeScript、构建并原子切换双实例", () => {
    expect(script).toContain("pnpm check");
    expect(script).toContain("pnpm build:admin");
    expect(script).toContain("pnpm verify:admin-build");
    expect(script).toContain('atomic_link "$SOURCE"');
    expect(script).toContain("pm2 reload dianzi51-admin");
    expect(script).toContain("front release changed after admin reload");
  });
});
