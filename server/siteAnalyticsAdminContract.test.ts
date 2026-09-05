import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const app = read("client/src/App.tsx");
const layout = read("client/src/components/DashboardLayout.tsx");
const page = read("client/src/pages/Analytics.tsx");
const api = read("server/platformAnalyticsApi.ts");
const routers = read("server/routers.ts");
const permissions = read("shared/adminPermissions.ts");

describe("独立后台运营数据合同", () => {
  it("运营数据只注册在后台路由和左侧菜单", () => {
    expect(app).toContain('path={"/analytics"}');
    expect(app).toContain('permission="analytics.read"');
    expect(layout).toContain('label: "运营数据"');
    expect(layout).toContain('path: "/analytics"');
    expect(layout).toContain('permission: "analytics.read"');
  });

  it("浏览器只调用后台tRPC，后台服务端再用内部密钥读取商城统计", () => {
    expect(page).toContain("trpc.analytics.overview.useQuery");
    expect(page).not.toContain("51dianzi.com/api/trpc");
    expect(api).toContain("siteAnalytics.internalOverview");
    expect(api).toContain('"x-portal-key": key');
    expect(api).toContain("AbortSignal.timeout(10_000)");
    expect(routers).toContain("overview: analyticsReadProcedure");
  });

  it("运营数据权限可单独授予运营账号，商户管理员默认不可见", () => {
    expect(permissions).toContain('"analytics.read"');
    expect(permissions).toMatch(/operation:[\s\S]*?"analytics\.read"/);
    expect(permissions).not.toMatch(/merchant_mgr:\s*\[[^\]]*"analytics\.read"/);
  });

  it("后台页面覆盖核心运营指标与三档时间范围", () => {
    for (const label of [
      "网站", "小程序", "用户", "页面浏览量 PV", "访客数 UV", "未登录访客",
      "打开次数", "使用设备", "注册用户总数", "今日新增注册",
      "7日登录账号", "30日登录账号", "网站访问趋势", "小程序打开趋势",
      "热门页面", "访问来源", "设备分布",
    ]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("[7, 30, 90]");
    expect(page).toContain('type DataSection = "web" | "miniapp" | "users"');
    expect(page).toContain("可追溯历史");
    expect(page).toContain("1.12.15开发版开始累计");
    expect(page).not.toContain("7日活跃用户");
    expect(page).not.toContain("注册转化参考");
    expect(page).toContain("不包含此前历史");
  });
});
