import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("前后台 CRM 企业与银行字段同步契约", () => {
  const router = readFileSync("server/routers.ts", "utf8");
  const db = readFileSync("server/db.ts", "utf8");
  const schema = readFileSync("drizzle/schema.ts", "utf8");

  it("portal 路由强制企业、法人、地址与银行三字段必填", () => {
    for (const field of [
      "companyType",
      "companyRole",
      "legalPersonName",
      "registeredAddress",
      "settlementAccountName",
      "settlementAccount",
      "settlementBank",
    ]) {
      expect(router).toMatch(new RegExp(`${field}: z\\.string\\(\\)\\.trim\\(\\)\\.min\\(1`));
    }
    expect(router).toContain("assertPortalKey(ctx.req)");
  });

  it("商户表分别保存企业类型、角色和一栏一个数据的银行字段", () => {
    expect(schema).toContain('companyType: varchar("companyType"');
    expect(schema).toContain('companyRole: varchar("companyRole"');
    expect(schema).toContain('settlementAccountName: varchar("settlementAccountName"');
    expect(schema).toContain('settlementAccount: varchar("settlementAccount"');
    expect(schema).toContain('settlementBank: varchar("settlementBank"');
  });

  it("创建、认领、重申请和同账号重复提交都复用统一 profileFields 同步", () => {
    expect(db).toContain("const profileFields = {");
    expect(db.match(/\.\.\.profileFields/g)?.length).toBeGreaterThanOrEqual(3);
    expect(db).toContain("set(profileFields)");
    expect(db).toContain("settlementAccountName: input.settlementAccountName");
    expect(db).toContain("settlementAccount: input.settlementAccount");
    expect(db).toContain("settlementBank: input.settlementBank");
  });

  it("商户详情分别展示企业与银行字段，不再合并银行数据", () => {
    const page = readFileSync("client/src/pages/MerchantDetail.tsx", "utf8");
    expect(page).toContain('label="企业类型" value={merchant.companyType}');
    expect(page).toContain('label="企业角色" value={merchant.companyRole}');
    expect(page).toContain('label="账户名称" value={merchant.settlementAccountName}');
    expect(page).toContain('label="账户号码" value={merchant.settlementAccount}');
    expect(page).toContain('label="开户行" value={merchant.settlementBank}');
    expect(page).not.toContain('label="开户银行 / 账号"');
  });
});
