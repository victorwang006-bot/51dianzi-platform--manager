import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const layout = read("../client/src/components/DashboardLayout.tsx");
const app = read("../client/src/App.tsx");
const routeChunks = read("../client/src/lib/adminRouteChunks.ts");
const page = read("../client/src/pages/PortalUsers.tsx");
const router = read("./routers.ts");

describe("后台前台用户管理界面契约", () => {
  it("用户管理与消息中心同级，但使用独立的用户管理读取权限", () => {
    const messageIndex = layout.indexOf('label: "消息中心"');
    const userIndex = layout.indexOf('label: "用户管理"');
    expect(messageIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeGreaterThan(messageIndex);
    expect(layout).toContain('path: "/portal-users",');
    expect(layout).toContain('permission: "portalUsers.read" as AdminPermission,');
    expect(layout).toContain('chunk: "portalUsers" as AdminNavigationChunk,');
    expect(layout).toContain('nested: false,');
  });

  it("应用路由和服务端接口均使用独立的用户管理读取权限", () => {
    expect(routeChunks).toContain('portalUsers: () => import("@/pages/PortalUsers")');
    expect(routeChunks).toContain("export const LazyPortalUsers = lazy(pageLoaders.portalUsers)");
    expect(app).toContain("const PortalUsersRoute = () => (");
    expect(app).toContain('<PermissionGate permission="portalUsers.read">');
    expect(app).toContain("<LazyPortalUsers />");
    expect(app).not.toContain('from "./pages/PortalUsers"');
    expect(app).toContain('<Route path={"/portal-users"} component={PortalUsersRoute} />');
    expect(router).toContain("frontendUser: router({");
    expect(router).toContain("stats: portalUserReadProcedure.query");
    expect(router).toContain("list: portalUserReadProcedure");
  });

  it("页面以紧凑摘要展示五项统计并保留搜索、刷新和用户标签", () => {
    for (const text of ["注册用户", "普通用户", "ERP用户", "今日注册", "近7日登录用户"]) {
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
    expect(page).toContain("todayWebsiteRegistered");
    expect(page).toContain("todayMiniProgramRegistered");
    expect(page).toContain("erpBindingMismatch.total");
    expect(page).toContain("isSuperAdmin && stats?.erpBindingMismatch");
  });

  it("将纯图标操作菜单放在用户名后，并删除最右操作列和重复用户名", () => {
    expect(page).toContain('title="用户操作"');
    expect(page).toContain('aria-label={`管理 ${target.label}`}');
    expect(page).toContain('className="h-7 w-7 shrink-0');
    expect(page).toContain('align="start"');
    expect(page).not.toContain('<TableHead className="sticky right-0 bg-background text-right">操作</TableHead>');
    expect(page).not.toContain('<MoreHorizontal className="mr-1 h-4 w-4" />操作');
    expect(page).toContain('user.name !== user.username');
  });

  it("合并注册与登录时间列以减少横向滚动", () => {
    expect(page).toContain("<TableHead>时间</TableHead>");
    expect(page).not.toContain("<TableHead>注册时间</TableHead>");
    expect(page).not.toContain("<TableHead>最近登录</TableHead>");
    expect(page).toContain("注册</span> {dateTime(user.createdAt)}");
    expect(page).toContain("登录</span> {dateTime(user.lastSignedIn)}");
    expect(page).toContain('Table className="portal-user-responsive-table table-fixed"');
    expect(page).toContain("<colgroup>");
    expect(page).toContain('<col style={{ width: "22%" }} />');
    expect(page).not.toContain('min-w-[1450px]');
  });

  it("将用户类型与中文注册渠道合并为紧凑列", () => {
    expect(page).toContain("<TableHead>类型/渠道</TableHead>");
    expect(page).toContain('["local", "password"].includes(normalized)');
    expect(page).toContain('return "网站注册"');
    expect(page).toContain('"wechat_miniprogram"');
    expect(page).toContain('return "微信小程序"');
    expect(page).toContain('return "微信渠道"');
    expect(page).toContain("registrationChannel(user.loginMethod)");
    expect(page).not.toContain("<TableHead>登录方式</TableHead>");
    expect(page).not.toContain('{user.loginMethod || "—"}');
  });

  it("表格使用六列固定比例布局并完全移除横向滑块", () => {
    expect((page.match(/<col style=/g) ?? [])).toHaveLength(6);
    expect(page).toContain("<TableHead>状态</TableHead>");
    expect(page).not.toContain("portal-user-top-scroll");
    expect(page).not.toContain("左右拖动查看全部字段");
    expect(page).not.toContain("scrollTableBy");
    expect(page).not.toContain("hasHorizontalOverflow");
    expect(page).not.toContain("ChevronLeft");
    expect(page).not.toContain("ChevronRight");
    expect(page).toContain("@media (max-width: 900px)");
    expect(page).toContain('overflow-x: visible');
    expect(page).toContain('content: attr(data-label)');
    for (const label of ["用户", "联系方式", "企业", "类型/渠道", "状态", "时间"]) {
      expect(page).toContain(`data-label="${label}"`);
    }
  });
});
