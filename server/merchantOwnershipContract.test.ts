import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const schema = read("drizzle/schema.ts");
const migration = read("scripts/apply-merchant-ownership-schema.mjs");
const db = read("server/db.ts");
const router = read("server/routers.ts");
const page = read("client/src/pages/Merchants.tsx");
const lookup = read("client/src/components/MerchantOwnershipLookup.tsx");
const deploy = read("deploy/deploy-admin.sh");

function section(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("商户客户归属查询与申请审批", () => {
  it("独立归属查询跨范围查重但只返回最少信息，并用摘要审计防枚举", () => {
    const search = section(db, "export async function searchMerchantOwnership", "export async function createMerchantOwnershipRequest");
    expect(router).toContain("ownershipSearch: merchantReadProcedure");
    expect(router).toContain('min(2, "至少输入 2 个字符")');
    expect(search).toContain("OWNERSHIP_QUERY_MINUTE_LIMIT");
    expect(search).toContain("OWNERSHIP_QUERY_DAY_LIMIT");
    expect(search).toContain("eq(adminUsers.id, input.localAdminUserId)");
    expect(search).toContain("eq(users.id, input.adminUserId)");
    expect(search).toContain('.for("update")');
    expect(router).toContain("localAdminUserId: ctx.adminAccount?.id");
    expect(search).toContain('input.messageThreadId !== undefined ? `thread:${input.messageThreadId}:${portalUserId ?? ""}:${compact}` : compact');
    expect(search).toContain("merchantOwnershipQueryAudits");
    expect(search).toContain("companyName: row.companyName");
    expect(search).toContain("ownerName: row.salesOwner");
    expect(search).not.toContain("contactEmail: row.contactEmail");
    expect(search).not.toContain("businessLicense: row.businessLicense");
  });

  it("支持公司、信用代码、商户编号、手机号和联系人查重", () => {
    const search = section(db, "export async function searchMerchantOwnership", "export async function createMerchantOwnershipRequest");
    expect(db).toContain('return "merchant_no"');
    expect(db).toContain('return "credit_code"');
    expect(db).toContain('return "phone"');
    expect(search).toContain("${merchants.companyName} LIKE ${pattern} ESCAPE '!'");
    expect(search).toContain("${merchants.contactName} LIKE ${pattern} ESCAPE '!'");
    expect(db).toContain('value.replace(/[!%_]/g, match => `!${match}`)');
    expect(search).toContain("eq(merchants.contactPhone, compact)");
    expect(search).toContain(".limit(10)");
  });

  it("消息中心由服务端绑定开户线程，按用户ID优先并以手机号精确回退", () => {
    const search = section(db, "export async function searchMerchantOwnership", "export async function createMerchantOwnershipRequest");
    expect(router).toContain("ownershipSearch: messageMerchantReadProcedure");
    expect(router).toContain("messageThreadId: input.threadId");
    expect(router).toContain('hasAdminPermission(role, "merchants.read", ctx.adminPermissions)');
    expect(search).toContain("messageThreadId?: number");
    expect(search).toContain("resolvePortalMessageThreadType(thread) !== \"onboarding\"");
    expect(search).toContain("eq(merchants.crmOwnerPortalUserId, portalUserId)");
    expect(search).toContain("if (rows.length === 0 && messagePhone)");
    expect(search).toContain("eq(merchants.contactPhone, compact)");
    expect(search).not.toContain("portalUserId?: string;");
  });

  it("认领、协作和转交均先申请，只有超级管理员可审批", () => {
    expect(schema).toContain('mysqlEnum("requestType", ["claim", "collaborate", "transfer"])');
    expect(router).toContain('requestType: z.enum(["claim", "collaborate", "transfer"])');
    expect(router).toContain("createOwnershipRequest: merchantReadProcedure");
    expect(router).toContain("reviewOwnershipRequest: salesOwnerAssignProcedure");
    expect(db).toContain('eq(merchantOwnershipRequests.status, "pending")');
    expect(db).toContain('throw new Error("SALES_OWNER_CHANGED")');
    expect(db).toContain('throw new Error("PLATFORM_COMPANY_NOT_FOUND")');
    expect(db).toContain('throw new Error("PLATFORM_COMPANY_DUPLICATE")');
    expect(db).toContain("WHERE id = ${platformCompanyId}");
    expect(db).toContain('action: `merchant.ownership-request.${input.decision}`');
  });

  it("创建申请必须携带绑定当前账号与商户的短时查重凭证", () => {
    expect(db).toContain("OWNERSHIP_REQUEST_TOKEN_TTL_MS");
    expect(db).toContain('createHmac("sha256", secret)');
    expect(db).toContain("verifyOwnershipRequestToken(input.verificationToken, input.merchantId, input.requesterAdminUserId)");
    expect(router).toContain("verificationToken: z.string().min(1)");
    expect(lookup).toContain("verificationToken: requestTarget.verificationToken");
  });

  it("协作审批只增加只读范围，写操作仍校验正式负责人", () => {
    const list = section(db, "function merchantReadScopeCondition", "/**\n * 商户分页列表");
    expect(list).toContain("merchant_sales_collaborators");
    expect(list).toContain("collaborator.revokedAt IS NULL");
    expect(db).toContain("export async function getOwnedMerchantById");
    expect(router).toContain("db.getOwnedMerchantById(merchantId, codes)");
    expect(page).toContain("协作只读");
    expect(page).toContain("仅查看");
  });

  it("页面提供明确的查重入口、最小结果、联系负责人和申请记录", () => {
    expect(page).toContain("客户归属查询");
    expect(page).toContain("<MerchantOwnershipLookup");
    expect(lookup).toContain("公司名称 / 信用代码 / 商户编号 / 联系手机号 / 联系人");
    expect(lookup).toContain("范围外客户只展示最少归属信息");
    expect(lookup).toContain("联系负责人");
    expect(lookup).toContain("申请认领");
    expect(lookup).toContain("申请协作");
    expect(lookup).toContain("申请转交");
    expect(lookup).toContain("我的申请");
    expect(lookup).toContain("待审批");
  });

  it("迁移在生产切换前创建三张表及关键索引", () => {
    for (const table of [
      "merchant_sales_collaborators",
      "merchant_ownership_requests",
      "merchant_ownership_query_audits",
    ]) {
      expect(schema).toContain(table);
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain("GET_LOCK");
    expect(migration).toContain("merchant_ownership_query_audits_admin_created_idx");
    expect(migration).toContain("merchants_contact_phone_idx");
    expect(migration).toContain("async function assertColumn");
    expect(migration).toContain("主键结构校验失败");
    expect(deploy).toContain("apply-merchant-ownership-schema.mjs");
    expect(deploy.indexOf("apply-merchant-ownership-schema.mjs")).toBeLessThan(
      deploy.indexOf("=== 5. 原子切换软链 ==="),
    );
  });
});
