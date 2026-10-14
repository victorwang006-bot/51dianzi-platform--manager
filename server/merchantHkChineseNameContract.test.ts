import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { merchantEffectiveHkChineseNameSql, toMerchantReadDto } from "./db";

const dialect = new MySqlDialect();
const root = join(import.meta.dirname, "..");
const database = readFileSync(join(root, "server/db.ts"), "utf8");

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: 51,
    merchantNo: "M2026101451",
    companyName: "Example Hong Kong Limited",
    registrationRegion: "HK",
    status: "approved",
    crmStatus: "enabled",
    registrationData: {
      registration: {
        chineseName: "  示例香港有限公司  ",
      },
    },
    registrationPendingData: {
      registration: {
        chineseName: "待审草稿名称有限公司",
        bankAccountNumber: "must-not-leak",
      },
    },
    settlementAccount: "must-not-leak",
    licenseObjectKey: "private/br.pdf",
    licenseImageUrl: "https://private.example/br.pdf",
    ciObjectKey: "private/ci.pdf",
    bankDocumentObjectKey: "private/bank.pdf",
    ...overrides,
  } as never;
}

function getMerchantsBlock() {
  const start = database.indexOf("export async function getMerchants");
  const end = database.indexOf("/**\n * 商户页负责人筛选选项", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return database.slice(start, end);
}

describe("HK merchant Chinese display-name contract", () => {
  it("uses the trimmed approved Chinese name as display value while retaining the registered English value", () => {
    const dto = toMerchantReadDto(merchant());

    expect(dto.companyName).toBe("示例香港有限公司");
    expect(dto.registeredCompanyName).toBe("Example Hong Kong Limited");
    expect(JSON.stringify(dto)).not.toContain("registrationData");
    expect(JSON.stringify(dto)).not.toContain("registrationPendingData");
    expect(JSON.stringify(dto)).not.toContain("must-not-leak");
    expect(JSON.stringify(dto)).not.toContain("private/");
  });

  it("does not elevate a pending draft and ignores non-string or invalid approved JSON", () => {
    expect(
      toMerchantReadDto(merchant({ registrationData: null })).companyName
    ).toBe("Example Hong Kong Limited");
    expect(
      toMerchantReadDto(
        merchant({
          registrationData: { registration: { chineseName: 10086 } },
        })
      ).companyName
    ).toBe("Example Hong Kong Limited");
    expect(
      toMerchantReadDto(
        merchant({
          registrationData: "{not valid JSON",
        })
      ).companyName
    ).toBe("Example Hong Kong Limited");
    expect(
      toMerchantReadDto(
        merchant({
          registrationRegion: "CN",
          registrationData: { chineseName: "不应覆盖内地登记名称" },
        })
      ).companyName
    ).toBe("Example Hong Kong Limited");
  });

  it("supports historical top-level effective data but only when its Chinese name is a non-blank string", () => {
    expect(
      toMerchantReadDto(
        merchant({
          registrationData: { chineseName: "  歷史香港有限公司  " },
          registrationPendingData: { chineseName: "待审名称" },
        })
      ).companyName
    ).toBe("歷史香港有限公司");
    expect(
      toMerchantReadDto(
        merchant({
          registrationData: { chineseName: " \n\t " },
        })
      ).companyName
    ).toBe("Example Hong Kong Limited");
  });

  it("不将历史首次pending资料用于通用展示，但复审仍使用旧已审核中文", () => {
    expect(toMerchantReadDto(merchant({status: "pending", crmStatus: "pending"})).companyName).toBe("Example Hong Kong Limited");
    expect(toMerchantReadDto(merchant({status: "rejected", crmStatus: "rejected"})).companyName).toBe("Example Hong Kong Limited");
    expect(toMerchantReadDto(merchant({status: "approved", crmStatus: "enabled", registrationPendingData: {registration:{chineseName:"新未审核名"}}})).companyName).toBe("示例香港有限公司");
    const query = dialect.sqlToQuery(merchantEffectiveHkChineseNameSql());
    expect(query.sql).toContain("`merchants`.`status` = 'approved'");
    expect(query.sql).toContain("`merchants`.`crmStatus` IN ('enabled', 'disabled')");
  });

  it("renders a MySQL 8-compatible guarded SQL expression for effective Chinese-name search", () => {
    const rendered = dialect.sqlToQuery(merchantEffectiveHkChineseNameSql());

    expect(rendered.sql).toContain(
      "JSON_VALID(`merchants`.`registrationData`)"
    );
    expect(rendered.sql).toContain("JSON_OBJECT()");
    expect(rendered.sql).toContain("JSON_EXTRACT");
    expect(rendered.sql).toContain("JSON_TYPE");
    expect(rendered.sql).toContain("JSON_UNQUOTE");
    expect(rendered.sql).toContain("TRIM");
    expect(rendered.sql).not.toMatch(/\bBINARY\b|\bREGEXP\b/i);
    expect(rendered.params).toEqual([]);
  });

  it("adds effective Chinese-name matching to the existing English-name and merchant-number list search without changing the shared where path", () => {
    const list = getMerchantsBlock();

    expect(list).toContain("like(merchants.companyName, keyword)");
    expect(list).toContain(
      "like(merchantEffectiveHkChineseNameSql(), keyword)"
    );
    expect(list).toContain("like(merchants.merchantNo, keyword)");
    expect(list).not.toContain("registrationPendingData");
    expect(list.indexOf("const where =")).toBeLessThan(
      list.indexOf("count(*)")
    );
    expect(list.indexOf("count(*)")).toBeLessThan(
      list.indexOf(".limit(pageSize)")
    );
  });
});
