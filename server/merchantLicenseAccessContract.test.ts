import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const schema = read("drizzle/schema.ts");
const database = read("server/db.ts");
const routers = read("server/routers.ts");
const detailPage = read("client/src/pages/MerchantDetail.tsx");
const migration = read("scripts/apply-merchant-license-access-schema.mjs");
const deployment = read("deploy/deploy-admin.sh");
const packageJson = read("package.json");

describe("商户营业执照安全访问", () => {
  it("后台只持久化稳定对象键，客户端列表与详情不返回对象键或历史URL", () => {
    expect(schema).toContain('licenseObjectKey: varchar("licenseObjectKey", { length: 512 })');
    expect(database).toContain("export function toMerchantReadDto");
    expect(database).toContain("const { licenseObjectKey, licenseImageUrl, ...merchant } = row");
    expect(database).toContain("hasLicenseDocument: Boolean(licenseObjectKey || licenseImageUrl)");
    expect(database).toContain("...toMerchantReadDto(row)");
    expect(routers).toContain("...db.toMerchantReadDto(merchant)");
    expect(routers).toContain("canManage,");
    expect(routers).toContain('regex(/^licenses\\/[A-Za-z0-9._/-]+$/, "营业执照对象标识无效")');
  });

  it("查看接口复用商户读范围、实时签发15分钟URL且不向客户端暴露对象键", () => {
    const start = routers.indexOf("licenseAccess: merchantReadProcedure");
    const end = routers.indexOf("/** 当前销售范围内商户的公司信息墙", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = routers.slice(start, end);
    expect(block).toContain("db.getMerchantById(input.id, await getAdminSalesStaffCodes(ctx))");
    expect(block).toContain("await db.getMerchantLicenseSource(merchant)");
    expect(block).toContain('source.objectKey.startsWith("licenses/")');
    expect(block).toContain("await storageGetOssSignedUrl(source.objectKey, 15 * 60)");
    expect(block).toContain("Date.now() + 15 * 60_000");
    expect(block).toContain("await db.recordMerchantLicenseView");
    expect(block).toContain("return { url, expiresAt, fileName: source.fileName }");
    expect(block).not.toMatch(/return\s*\{[^}]*objectKey/s);
  });

  it("对象键必须同时按前台账号和信用代码匹配，敏感访问审计不记录键或URL", () => {
    const lookupStart = database.indexOf("export async function getMerchantLicenseSource");
    const auditStart = database.indexOf("export async function recordMerchantLicenseView", lookupStart);
    const lookup = database.slice(lookupStart, auditStart);
    const auditEnd = database.indexOf("/**", auditStart + 4);
    const audit = database.slice(auditStart, auditEnd);
    expect(lookup).toContain("CAST(userId AS CHAR)");
    expect(lookup).toContain("crmOwnerPortalUserId");
    expect(lookup).toContain("UPPER(REPLACE(creditCode, ' ', ''))");
    expect(lookup).toContain("LIMIT 2");
    expect(lookup).toContain('throw new Error("PLATFORM_COMPANY_DUPLICATE")');
    expect(lookup).toContain('if (portalUserId && !company) throw new Error("PLATFORM_COMPANY_NOT_FOUND")');
    expect(audit).toContain('action: "merchant.license.view"');
    expect(audit).toContain('afterValue: { source }');
    expect(audit).not.toContain("objectKey");
    expect(audit).not.toContain("legacyUrl");
  });

  it("商户详情点击时请求新链接，不再直接打开数据库中的过期地址", () => {
    expect(detailPage).toContain("trpc.merchant.licenseAccess.useMutation()");
    expect(detailPage).toContain("await licenseAccess.mutateAsync({ id })");
    expect(detailPage).toContain("preview.location.replace(result.url)");
    expect(detailPage).toContain("merchant.hasLicenseDocument");
    expect(detailPage).not.toContain("href={merchant.licenseImageUrl}");
    expect(detailPage).toContain("正在获取安全链接…");
  });

  it("生产迁移幂等补列、按强绑定回填、清除临时URL并在切换前执行", () => {
    expect(migration).toContain("GET_LOCK");
    expect(migration).toContain("ADD COLUMN `licenseObjectKey` varchar(512) NULL");
    expect(migration).toContain("CAST(c.userId AS CHAR) = m.crmOwnerPortalUserId");
    expect(migration).toContain("c.licenseObjectKey");
    expect(migration).toContain("m.licenseObjectKey <> c.licenseObjectKey");
    expect(migration).toContain("m.licenseImageUrl = NULL");
    expect(migration).toContain("HAVING COUNT(*) = 1");
    expect(migration).toContain("SUM(CASE WHEN licenseObjectKey IS NOT NULL");
    expect(migration).toContain("invalidPrefixRows");
    expect(migration).toContain("inconsistentRows");
    expect(migration).toContain("ambiguousUnboundRows");
    expect(deployment).toContain("apply-merchant-license-access-schema.mjs");
    expect(deployment.indexOf("apply-merchant-license-access-schema.mjs")).toBeLessThan(
      deployment.indexOf("=== 5. 原子切换软链"),
    );
    expect(packageJson).toContain('"db:merchant-license-access"');
  });
});
