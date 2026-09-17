import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../shared/enterpriseServiceAgreementSummary";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const routers = read("server/routers.ts");
const db = read("server/db.ts");
const sharedUi = read("client/src/components/admin/shared.tsx");
const backfill = read("scripts/backfill-enterprise-agreement-status.mjs");

function portalCrmRoute() {
  const start = routers.indexOf("submitCrmApplication: publicProcedure");
  const end = routers.indexOf("getMessages: publicProcedure", start);
  return routers.slice(start, end);
}

describe("前台企业服务协议状态同步", () => {
  it("只接受当前固定版本与内容哈希，并要求同意为显式 true", () => {
    expect(ENTERPRISE_SERVICE_AGREEMENT_VERSION).toBe("V1.0");
    expect(ENTERPRISE_SERVICE_AGREEMENT_HASH).toMatch(/^[a-f0-9]{64}$/);
    const route = portalCrmRoute();
    expect(route).toContain("agreementAccepted: z.literal(true)");
    expect(route).toContain("z.literal(ENTERPRISE_SERVICE_AGREEMENT_VERSION)");
    expect(route).toContain("z.literal(ENTERPRISE_SERVICE_AGREEMENT_HASH)");
    expect(route).not.toContain("agreementAccepted: z.literal(true).optional()");
    expect(route).not.toContain("z.literal(ENTERPRISE_SERVICE_AGREEMENT_VERSION).optional()");
    expect(route).not.toContain("z.literal(ENTERPRISE_SERVICE_AGREEMENT_HASH).optional()");
  });

  it("仅在收到明确协议凭据时把后台摘要更新为已同意", () => {
    expect(db).toContain('input.agreementAccepted ? { agreementStatus: "signed" as const } : {}');
    expect(db).not.toContain('agreementStatus: "signed" as const,');
  });

  it("后台界面使用带协议主语的明确签署状态", () => {
    expect(sharedUi).toContain('unsigned: { label: "协议未签署"');
    expect(sharedUi).toContain('signed: { label: "协议已签署"');
    expect(sharedUi).toContain('expired: { label: "协议已过期"');
    expect(sharedUi).not.toContain('label: "未同意"');
    expect(sharedUi).not.toContain('label: "已同意"');
  });

  it("历史回填默认只预览，且仅按用户与信用代码精确匹配当前版本存证", () => {
    expect(backfill).toContain('const apply = process.argv.includes("--apply")');
    expect(backfill).toContain("enterprise_service_agreement_acceptances");
    expect(backfill).toContain("agreementVersion = ? AND agreementHash = ?");
    expect(backfill).toContain("crmOwnerPortalUserId");
    expect(backfill).toContain("normalizedCreditCode(row.businessLicense)");
    expect(backfill).toContain("WHERE agreementStatus = 'unsigned'");
    expect(backfill).toContain("await admin.beginTransaction()");
    expect(backfill).toContain("await admin.rollback()");
  });
});
