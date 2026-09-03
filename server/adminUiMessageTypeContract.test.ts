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
  it("管理页面展示快速询价、在线客服和举报投诉，不再提供普通留言", () => {
    expect(messagesSource).toContain('<SelectItem value="inquiry">快速询价</SelectItem>');
    expect(messagesSource).toContain('<SelectItem value="service">在线客服</SelectItem>');
    expect(messagesSource).toContain('<SelectItem value="complaint">举报投诉</SelectItem>');
    expect(messagesSource).not.toContain('<SelectItem value="general">');
    expect(messagesSource).not.toContain("普通留言");
  });

  it("历史general会话按业务主题归入现有两类，CRM申请继续排除", () => {
    expect(resolvePortalMessageThreadType({ threadType: "inquiry", subject: "任意" })).toBe("inquiry");
    expect(resolvePortalMessageThreadType({ threadType: "service", subject: "任意" })).toBe("service");
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
    expect(routerSource).toContain('threadType: z.enum(["inquiry", "service", "complaint"]).optional()');
  });

  it("举报投诉详情展示双方联系方式，禁止直接回复并同步处理状态", () => {
    expect(messagesSource).toContain("举报投诉详情");
    expect(messagesSource).toContain("被举报人");
    expect(messagesSource).toContain("标记已处理");
    expect(messagesSource).toContain("举报投诉不向用户直接回复");
    expect(dbSource).toContain("report.messageThreadId");
    expect(dbSource).toContain("举报投诉不支持直接回复，请处理后关闭");
    expect(dbSource).toContain("UPDATE chat_user_reports");
  });
});
