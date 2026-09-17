import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const routers = read("server/routers.ts");
const database = read("server/db.ts");
const mediaProxy = read("server/platformCompanyMediaApi.ts");

function merchantRouterBlock() {
  const start = routers.indexOf("  merchant: router({");
  const end = routers.indexOf("\n  // ───", start + 20);
  expect(start, "缺少 merchant 路由").toBeGreaterThan(-1);
  return routers.slice(start, end === -1 ? undefined : end);
}

function procedureBody(name: string) {
  const block = merchantRouterBlock();
  const start = block.indexOf(`    ${name}:`);
  expect(start, `缺少 ${name} 接口`).toBeGreaterThan(-1);
  const rest = block.slice(start);
  const next = rest.slice(1).search(/\n    [a-zA-Z][a-zA-Z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("商户首页精选代理", () => {
  it("查询使用既有商户只读权限，写入使用既有商户写权限而非超级管理员限制", () => {
    const status = procedureBody("homepageFeatureStatus");
    const set = procedureBody("setHomepageFeatured");
    expect(status).toContain("homepageFeatureStatus: merchantReadProcedure");
    expect(set).toContain("setHomepageFeatured: merchantWriteProcedure");
    expect(set).not.toContain("crmRebindProcedure");
    expect(set).not.toContain("salesOwnerAssignProcedure");
  });

  it("浏览器仅能提交 merchantId 与 featured，绑定和操作人均由已授权服务端上下文派生", () => {
    const status = procedureBody("homepageFeatureStatus");
    const set = procedureBody("setHomepageFeatured");
    expect(status).toContain("merchantId: z.number().int().positive()");
    expect(status).not.toContain("creditCode:");
    expect(status).not.toContain("ownerUserId:");
    expect(set).toContain("merchantId: z.number().int().positive()");
    expect(set).toContain("featured: z.boolean()");
    expect(set).not.toContain("creditCode: z.");
    expect(set).not.toContain("ownerUserId: z.");
    expect(set).not.toContain("operator: z.");
    expect(set).toContain("getPlatformCompanyMediaBinding(ctx, input.merchantId)");
    expect(set).toContain("operator: platformUserOperatorFromContext(ctx)");
    expect(routers).toContain("await assertMerchantInSalesScope(ctx, merchantId)");
    expect(routers).toContain("merchant.businessLicense");
    expect(routers).toContain("merchant.crmOwnerPortalUserId");
  });

  it("查询和写入均返回主站权威的完整资格状态及缺失原因", () => {
    const status = procedureBody("homepageFeatureStatus");
    const set = procedureBody("setHomepageFeatured");
    expect(status).toContain("return getPlatformHomepageFeatureStatus(binding)");
    expect(set).toContain("const result = await setPlatformHomepageFeatured");
    expect(set).toContain("return result");
    for (const field of [
      "featured",
      "eligible",
      "approvedPhotoCount",
      "hasPublishedInventory",
      "missingReasons",
    ]) {
      expect(mediaProxy).toContain(field);
    }
  });

  it("复用既有 PORTAL_API_KEY 的主站内部 company-media 代理，并禁止密钥泄露", () => {
    expect(mediaProxy).toContain("process.env.PORTAL_API_KEY?.trim()");
    expect(mediaProxy).toContain('"x-portal-key": key');
    expect(mediaProxy).not.toContain("INTERNAL_SERVICE_KEY");
    expect(mediaProxy).toContain("internalCompanyMedia.${procedure}");
    expect(mediaProxy).toContain("homepageFeatureStatus");
    expect(mediaProxy).toContain("setHomepageFeatured");
    expect(mediaProxy).toContain("raw.split(key).join(\"[REDACTED]\")");
  });

  it("成功设置或取消后写入商户级不可变审计，action 可区分两种操作", () => {
    const set = procedureBody("setHomepageFeatured");
    expect(set).toContain("await db.recordMerchantHomepageFeatureAudit");
    expect(database).toContain("db.insert(auditLogs).values");
    expect(database).toContain('"merchant.homepage_feature.set"');
    expect(database).toContain('"merchant.homepage_feature.unset"');
    expect(database).toContain('module: "merchants"');
    expect(database).toContain('targetType: "merchant"');
    expect(database).toContain("targetId: String(input.merchantId)");
  });
});
