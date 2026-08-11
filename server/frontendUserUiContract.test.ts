import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const layout = read("../client/src/components/DashboardLayout.tsx");
const app = read("../client/src/App.tsx");
const page = read("../client/src/pages/PortalUsers.tsx");
const router = read("./routers.ts");

describe("后台前台用户管理界面契约", () => {
  it("用户管理与消息中心同级并使用同一读取权限", () => {
    const messageIndex = layout.indexOf('label: "消息中心"');
    const userIndex = layout.indexOf('label: "用户管理"');
    expect(messageIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeGreaterThan(messageIndex);
    expect(layout).toContain('path: "/portal-users", permission: "messages.read" as AdminPermission, nested: false');
  });

  it("应用路由和服务端接口均使用消息读取权限", () => {
    expect(app).toContain('<PermissionGate permission="messages.read"><PortalUsers /></PermissionGate>');
    expect(app).toContain('<Route path={"/portal-users"} component={PortalUsersRoute} />');
    expect(router).toContain("frontendUser: router({");
    expect(router).toContain("stats: messageReadProcedure.query");
    expect(router).toContain("list: messageReadProcedure");
  });

  it("页面以紧凑摘要展示五项统计并保留搜索、刷新和用户标签", () => {
    for (const text of ["注册用户", "普通用户", "ERP用户", "今日注册", "近7日活跃"]) {
      expect(page).toContain(text);
    }
    expect(page).toContain('aria-label="用户统计摘要"');
    expect(page).toContain("gap-x-7 gap-y-2 border-y py-2");
    expect(page).not.toContain("grid gap-4 sm:grid-cols-2 xl:grid-cols-5");
    expect(page).not.toContain("rounded-full bg-blue-50");
    expect(page).toContain("query.refetch()");
    expect(page).toContain("statsQuery.refetch()");
    expect(page).toContain("用户名、姓名、手机号、邮箱或企业名称");
    expect(page).toContain('user.userType === "erp"');
  });

  it("顶部横向滚动栏与真实表格双向同步并提供左右移动按钮", () => {
    expect(page).toContain("portal-user-top-scroll");
    expect(page).toContain('data-slot="table-container"');
    expect(page).toContain("new ResizeObserver(measure)");
    expect(page).toContain('addEventListener("scroll", syncTopScroll');
    expect(page).toContain('addEventListener("scroll", syncTableScroll');
    expect(page).toContain('aria-label="向左移动用户表格"');
    expect(page).toContain('aria-label="向右移动用户表格"');
    expect(page).toContain('scrollBy({ left: distance, behavior: "smooth" })');
    expect(page).toContain("scrollbar-width: none");
  });
});
