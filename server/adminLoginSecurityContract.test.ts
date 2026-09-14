import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { parseAdminDevice, trustedAdminClientIp } from "./adminLoginSecurity";

const read = (relative: string) => readFileSync(resolve(__dirname, relative), "utf8");
const page = read("../client/src/pages/Admins.tsx");
const schema = read("../drizzle/schema.ts");
const auth = read("./adminAuth.ts");
const router = read("./routers.ts");
const deploy = read("../deploy/deploy-admin.sh");
const migration = read("../scripts/apply-admin-login-security-schema.mjs");

describe("后台内部员工登录安全", () => {
  it("最近登录仅在真实认证成功后写入，并对成功和失败保留安全事件", () => {
    expect(auth).toContain("recordAdminLoginEventSafely");
    expect(auth).toContain("success: true");
    expect(auth).toContain("success: false");
    expect(auth).not.toContain("await db.touchAdminUserLogin(account.id)");
    expect(schema).toContain('mysqlTable("admin_login_events"');
    expect(schema).toContain('lastLoginIpAddress: varchar("lastLoginIpAddress"');
    expect(schema).toContain('securityRiskLevel: varchar("securityRiskLevel"');
  });

  it("只信任内网反向代理转发的客户端IP，拒绝公网客户端伪造转发头", () => {
    const trusted = {
      headers: { "x-forwarded-for": "198.51.100.8, 203.0.113.9" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    const untrusted = {
      headers: { "x-forwarded-for": "198.51.100.8" },
      socket: { remoteAddress: "203.0.113.10" },
    } as unknown as Request;
    expect(trustedAdminClientIp(trusted)).toBe("203.0.113.9");
    expect(trustedAdminClientIp(untrusted)).toBe("203.0.113.10");
  });

  it("识别常见操作系统、浏览器与设备类别", () => {
    expect(parseAdminDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"))
      .toMatchObject({ operatingSystem: "Windows", browser: "Chrome", deviceType: "电脑" });
    expect(parseAdminDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1"))
      .toMatchObject({ operatingSystem: "iOS", browser: "Safari", deviceType: "手机" });
  });

  it("部署切换前执行幂等迁移，并验证索引与安全字段", () => {
    expect(migration).toContain("SELECT GET_LOCK(?, 30)");
    expect(migration).toContain("admin_login_events_user_occurred_idx");
    expect(migration).toContain("lastLoginIpAddress");
    expect(deploy).toContain('test -f "$REL/scripts/apply-admin-login-security-schema.mjs"');
    expect(deploy.indexOf("apply-admin-login-security-schema.mjs")).toBeLessThan(
      deploy.indexOf('echo "=== 5. 原子切换软链 ==="'),
    );
  });

  it("用户管理页使用六列响应式布局，显示安全摘要且彻底取消横向滑块", () => {
    expect((page.match(/<col style=/g) ?? [])).toHaveLength(6);
    for (const label of ["账号", "权限范围", "联系方式", "状态 / 登录安全", "时间", "操作"]) {
      expect(page).toContain(`data-label="${label}"`);
    }
    expect(page).toContain("admin-user-responsive-table table-fixed");
    expect(page).not.toContain('<div className="overflow-x-auto">');
    expect(page).toContain("强制退出全部设备");
    expect(page).toContain("IP归属地为网络出口的粗略位置");
    expect(page).toContain('label: "安全基线未建立"');
    expect(page).not.toContain('label: "待建立"');
    expect(page).toContain("loginHistoryQuery.data.map");
    expect(router).toContain("loginHistory: adminManageProcedure");
    expect(router).toContain("revokeSessions: adminManageProcedure");
  });
});
