import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台 CRM 企业字段迁移契约", () => {
  it("只做由生产预检保护的可空标准加列，不修改或删除存量商户数据", () => {
    const sql = readFileSync("drizzle/0018_nifty_purple_man.sql", "utf8");
    expect(sql).toContain("ADD `companyType` varchar(128)");
    expect(sql).toContain("ADD `companyRole` varchar(64)");
    expect(sql).not.toContain("IF NOT EXISTS");
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|MODIFY|CHANGE|CREATE TABLE)\b/i);
    expect(sql).not.toContain("NOT NULL");
  });
});
