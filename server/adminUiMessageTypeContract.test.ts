import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePortalMessageThreadType } from "./db";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const layoutSource = read("../client/src/components/DashboardLayout.tsx");
const adminsSource = read("../client/src/pages/Admins.tsx");
const messagesSource = read("../client/src/pages/Messages.tsx");
const dbSource = read("./db.ts");
const routerSource = read("./routers.ts");
const schemaSource = read("../drizzle/schema.ts");
const deploySource = read("../deploy/deploy-admin.sh");
const migrationSource = read("../scripts/apply-complaint-message-schema.mjs");
const onboardingMigrationSource = read("../scripts/apply-onboarding-message-schema.mjs");
const deployReadmeSource = read("../deploy/README.md");
const rollbackSource = read("../scripts/rollback-admin.sh");

describe("后台导航与用户管理交互", () => {
  it("订单管理与商户管理同级展示", () => {
    expect(layoutSource).toMatch(/label:\s*"订单管理"[\s\S]{0,160}nested:\s*false/);
    expect(layoutSource).not.toMatch(/label:\s*"订单管理"[\s\S]{0,160}nested:\s*true/);
  });

  it("用户管理提供有加载状态的刷新按钮", () => {
    expect(adminsSource).toContain("RefreshCw");
    expect(adminsSource).toContain("isFetching");
    expect(adminsSource).toContain("onClick={() => void refetch()}");
    expect(adminsSource).toContain("刷新");
  });
});

describe("消息中心有效分类", () => {
  it("管理页面独立展示快速询价、在线客服、开通消息和举报投诉", () => {
    expect(messagesSource).toContain('<SelectItem value="inquiry">快速询价</SelectItem>');
    expect(messagesSource).toContain('<SelectItem value="service">在线客服</SelectItem>');
    expect(messagesSource).toContain('<SelectItem value="onboarding">开通消息</SelectItem>');
    expect(messagesSource).toContain('<SelectItem value="complaint">举报投诉</SelectItem>');
    expect(messagesSource).not.toContain('<SelectItem value="general">');
    expect(messagesSource).not.toContain("普通留言");
  });

  it("历史general会话按业务主题归入现有两类，CRM申请继续排除", () => {
    expect(resolvePortalMessageThreadType({ threadType: "inquiry", subject: "任意" })).toBe("inquiry");
    expect(resolvePortalMessageThreadType({ threadType: "service", subject: "任意" })).toBe("service");
    expect(resolvePortalMessageThreadType({ threadType: "onboarding", subject: "任意" })).toBe("onboarding");
    expect(resolvePortalMessageThreadType({ threadType: "complaint", subject: "任意" })).toBe("complaint");
    expect(resolvePortalMessageThreadType({ threadType: "general", subject: "快速询价 - STM32" })).toBe("inquiry");
    expect(resolvePortalMessageThreadType({ threadType: "general", subject: "BOM询价 - 24项" })).toBe("inquiry");
    expect(resolvePortalMessageThreadType({ threadType: "general", subject: "在线客服咨询 - 用户" })).toBe("service");
    expect(resolvePortalMessageThreadType({ threadType: "general", subject: "企业开通申请 - 示例公司" })).toBe("crm_apply");
    expect(resolvePortalMessageThreadType({ subject: null })).toBe("service");
  });

  it("列表筛选和未读统计统一使用有效类型表达式", () => {
    expect(dbSource).toContain("effectiveMessageThreadTypeSql");
    expect(dbSource).toContain("threadType: resolvePortalMessageThreadType(row)");
    expect(routerSource).toContain('threadType: z.enum(["inquiry", "service", "onboarding", "complaint"]).optional()');
  });

  it("首页入驻点击由后台权威库原子创建开通消息并在24小时内去重", () => {
    expect(routerSource).toContain("capabilities: publicProcedure.query");
    expect(routerSource).toContain('authority: "admin_transaction"');
    expect(routerSource).toContain("submitOnboardingLead: publicProcedure");
    expect(routerSource).toContain("return db.createPortalOnboardingLead(input)");
    expect(dbSource).toContain("createPortalOnboardingLead");
    expect(dbSource).toContain('row.crmStatus === "enabled"');
    expect(dbSource).toContain('threadType: "onboarding"');
    expect(dbSource).toContain("recentThreshold");
    expect(dbSource).toContain("onboardingLeadGuards");
    expect(dbSource).toContain("lastOnboardingLeadAt");
    expect(dbSource).toContain('like(messages.clientMessageId, "onboarding-%")');
    expect(dbSource).toContain("onDuplicateKeyUpdate");
    expect(dbSource).not.toContain("d51_onboarding_");
    expect(schemaSource).toContain('"service", "onboarding", "crm_apply"');
    expect(onboardingMigrationSource).toContain("ENUM('general', 'inquiry', 'service', 'onboarding', 'crm_apply', 'complaint')");
    expect(onboardingMigrationSource).toContain("CREATE TABLE IF NOT EXISTS onboarding_lead_guards");
    expect(onboardingMigrationSource).toContain("lastOnboardingLeadAt TIMESTAMP NULL");
    expect(onboardingMigrationSource).toContain("后台消息基础表未建立，请先恢复基线数据库");
    expect(onboardingMigrationSource).toContain("hasUniqueColumnIndex");
    expect(deploySource).toContain("apply-onboarding-message-schema.mjs");
    expect(deploySource).toContain("rollback-admin.sh");
    expect(deployReadmeSource).toContain("pnpm-lock.yaml patches drizzle shared scripts");
    expect(deployReadmeSource).toContain("唯一正式增量迁移入口");
    expect(deployReadmeSource).toContain("空库必须先按基线备份/基础建库流程恢复");
    expect(deployReadmeSource).toContain("禁止手工改软链回滚");
    expect(deploySource).toContain("rollback_on_error");
    expect(deploySource).toContain('[[ "$CODE" == "200" ]]');
    expect(deploySource).toContain('[[ "$ROOT" == "200" ]]');
    expect(rollbackSource).toContain("PLATFORM_REQUIRES_ONBOARDING");
    expect(rollbackSource).toContain("请先回滚主站");
    expect(rollbackSource).toContain("preflight-onboarding-admin.mjs");
  });

  it("举报投诉详情展示双方联系方式，禁止直接回复并同步处理状态", () => {
    expect(messagesSource).toContain("举报投诉详情");
    expect(messagesSource).toContain("被举报人");
    expect(messagesSource).toContain("标记已处理");
    expect(messagesSource).toContain("举报投诉不向用户直接回复");
    expect(dbSource).toContain("createPortalComplaint");
    expect(dbSource).toContain("complaintContext");
    expect(dbSource).toContain("举报投诉不支持直接回复，请处理后关闭");
    expect(routerSource).toContain("submitComplaint: publicProcedure");
    expect(routerSource).toContain("assertPortalKey(ctx.req)");
    expect(schemaSource).toContain('complaintContext: json("complaintContext")');
    expect(migrationSource).toContain("complaintMessageType");
    expect(migrationSource).toContain("complaintContextColumn");
    expect(deploySource).toContain("apply-complaint-message-schema.mjs");
  });
});
