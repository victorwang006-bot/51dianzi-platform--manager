import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const page = read("../client/src/pages/PortalUsers.tsx");
const admins = read("../client/src/pages/Admins.tsx");
const layout = read("../client/src/components/DashboardLayout.tsx");
const router = read("./routers.ts");
const platformUserApi = read("./platformUserApi.ts");

describe("前台用户管控 UI 与路由契约", () => {
  it("权限编辑器提供用户管理查看/管理两级授权且管理依赖查看", () => {
    expect(admins).toContain('{ label: "查看", value: "portalUsers.read" }');
    expect(admins).toContain('{ label: "管理", value: "portalUsers.manage", requires: "portalUsers.read" }');
    expect((layout.match(/label: "用户管理"/g) ?? [])).toHaveLength(1);
  });

  it("页面通过 auth.me permissions 进入只读模式，不以前端角色推断", () => {
    expect(page).toContain('authUser?.permissions?.includes("portalUsers.manage")');
    expect(page).toContain(': <span className="text-xs text-muted-foreground">只读</span>');
    expect(page).not.toContain('adminRole === "super_admin"');
  });

  it("表格展示账号、论坛状态和操作列，并保留响应式横向滚动", () => {
    for (const heading of ["账号状态", "论坛状态", "操作"]) {
      expect(page).toContain(`<TableHead${heading === "操作" ? ' className="sticky right-0 bg-background text-right"' : ""}>${heading}</TableHead>`);
    }
    expect(page).toContain("user.loginDisabledReason");
    expect(page).toContain("user.forumMutedUntil");
    expect(page).toContain("user.forumMuteReason");
    expect(page).toContain("portal-user-top-scroll");
    expect(page).toContain('scrollBy({ left: distance, behavior: "smooth" })');
    expect(page).toContain('className="min-w-[1780px]"');
  });

  it("操作菜单覆盖全部登录、禁言和记录动作", () => {
    for (const text of [
      "禁止登录", "恢复登录", "禁言3小时", "禁言6小时", "禁言1天", "禁言3天", "禁言7天",
      "解除禁言", "查看管理记录", "查看论坛发言记录",
    ]) expect(page).toContain(text);
    expect(page).toContain("trpc.frontendUser.setLoginDisabled.useMutation");
    expect(page).toContain("trpc.frontendUser.setForumMute.useMutation");
    expect(page).toContain("trpc.frontendUser.hideForumMessage.useMutation");
  });

  it("危险操作显示目标、动作、原因并在成功后刷新；记录展示操作人与消息撤回", () => {
    expect(page).toContain("目标用户：");
    expect(page).toContain("具体动作：");
    expect(page).toContain("操作原因");
    expect(page).toContain("toast.success");
    expect(page).toContain("utils.frontendUser.list.invalidate()");
    expect(page).toContain("操作人：");
    expect(page).toContain("撤回原因：");
    expect(page).toContain("hideMessageMutation.mutate");
    expect(page).toContain("message.isHidden || message.hiddenAt");
    expect(platformUserApi).toContain("isHidden: boolean");
  });

  it("服务端为五项管理 procedure 统一使用 portalUsers.manage", () => {
    expect(router).toContain('const portalUserManageProcedure = adminPermissionProcedure("portalUsers.manage")');
    for (const procedure of ["setLoginDisabled", "setForumMute", "moderationHistory", "forumMessages", "hideForumMessage"]) {
      expect(router).toContain(`${procedure}: portalUserManageProcedure`);
    }
    expect(router).toContain("operator: platformUserOperatorFromContext(ctx)");
  });
});
