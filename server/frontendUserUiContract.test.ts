import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const layout = read("../client/src/components/DashboardLayout.tsx");
const app = read("../client/src/App.tsx");
const page = read("../client/src/pages/PortalUsers.tsx");
const router = read("./routers.ts");

describe("后台前台用户管理界面契约", () => {
  it("用户管理位于消息中心下方并使用同一读取权限", () => {
    const messageIndex = layout.indexOf('label: "消息中心"');
    const userIndex = layout.indexOf('label: "用户管理"');
    expect(messageIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeGreaterThan(messageIndex);
    expect(layout).toContain('path: "/portal-users", permission: "messages.read" as AdminPermission, nested: true');
  });

  it("应用路由和服务端接口均使用消息读取权限", () => {
    expect(app).toContain('<PermissionGate permission="messages.read"><PortalUsers /></PermissionGate>');
    expect(app).toContain('<Route path={"/portal-users"} component={PortalUsersRoute} />');
    expect(router).toContain("frontendUser: router({");
    expect(router).toContain("stats: messageReadProcedure.query");
    expect(router).toContain("list: messageReadProcedure");
  });

  it("页面展示五项统计、搜索、刷新和两类用户标签", () => {
    for (const text of ["注册用户", "普通用户", "ERP用户", "今日注册", "近7日活跃"]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("query.refetch()");
    expect(page).toContain("statsQuery.refetch()");
    expect(page).toContain("用户名、姓名、手机号、邮箱或企业名称");
    expect(page).toContain('user.userType === "erp"');
  });
});
