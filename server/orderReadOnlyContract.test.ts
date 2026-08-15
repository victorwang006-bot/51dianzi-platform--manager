import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const routerSource = readSource("./routers.ts");
const proxySource = readSource("./platformOrderApi.ts");
const permissionSource = readSource("../shared/adminPermissions.ts");
const ordersPageSource = readSource("../client/src/pages/Orders.tsx");
const dashboardSource = readSource("../client/src/components/DashboardLayout.tsx");

describe("后台商城订单严格只读契约", () => {
  it("服务端代理与 tRPC 路由只暴露统计、列表和详情 query", () => {
    const orderRouterStart = routerSource.indexOf("order: router({");
    const orderRouterEnd = routerSource.indexOf("// ─── 物料数据库", orderRouterStart);
    const orderRouter = routerSource.slice(orderRouterStart, orderRouterEnd);

    expect(orderRouter).toContain("stats: orderReadProcedure.query");
    expect(orderRouter).toContain("list: orderReadProcedure");
    expect(orderRouter).toContain("detail: orderReadProcedure");
    expect(orderRouter).not.toContain("transition:");
    expect(orderRouter).not.toContain(".mutation(");
    expect(proxySource).not.toContain("transitionPlatformOrder");
    expect(proxySource).toContain('procedure: "stats" | "list" | "detail"');
    expect(proxySource).not.toContain('procedure: "stats" | "list" | "detail" | "transition"');
  });

  it("权限模型不再定义或授予 orders.write", () => {
    expect(permissionSource).toContain('"orders.read"');
    expect(permissionSource).not.toContain('"orders.write"');
  });

  it("订单页面显示统一统计、列表、显式订单编号链接和完整详情入口", () => {
    expect(ordersPageSource).toContain("trpc.order.stats.useQuery");
    expect(ordersPageSource).toContain("trpc.order.list.useQuery");
    expect(ordersPageSource).toContain("trpc.order.detail.useQuery");
    expect(ordersPageSource).toContain("订单总数");
    expect(ordersPageSource).toContain("订单总额");
    expect(ordersPageSource).toContain("近7日订单");
    expect(ordersPageSource).toContain("交易用户");
    expect(ordersPageSource).toContain('href={`/orders/${order.id}`}');
    expect(ordersPageSource).toContain("查看详情");
    expect(ordersPageSource).not.toContain("trpc.order.transition");
    expect(ordersPageSource).not.toContain("履约操作");
    expect(ordersPageSource).not.toContain("确认收款");
    expect(ordersPageSource).not.toContain("取消订单");
    expect(ordersPageSource).not.toContain("登记发货");
    expect(ordersPageSource).not.toContain("确认订单完成");
  });

  it("订单管理位于商户管理之后且订单详情路由保持高亮", () => {
    const merchantIndex = dashboardSource.indexOf('label: "商户管理"');
    const orderIndex = dashboardSource.indexOf('label: "订单管理"');
    const messageIndex = dashboardSource.indexOf('label: "消息中心"');
    expect(merchantIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(merchantIndex);
    expect(orderIndex).toBeLessThan(messageIndex);
    /**
     * nested 仅控制侧边栏菜单的缩进样式（true = 向右缩进并带竖线，
     * 显示为上一项的子菜单），不影响任何功能、权限或菜单顺序。
     *
     * 历史说明：2026-08-11 那次提交中，本文件曾断言 nested: true，
     * 但同一份源码的 DashboardLayout.tsx 实际写的是 false，
     * 两者自相矛盾，该断言自引入起就从未通过。
     * 生产产物实测也为 nested:!1（false），即订单管理一直是平级展示。
     * 经确认后以生产实际为准，修正断言为 false，避免为了让测试变绿
     * 而改动 UI（那将引入用户未要求的界面变更）。
     *
     * 若将来确定要把订单管理改为商户管理的子菜单，应同时修改
     * DashboardLayout.tsx 与本断言，且作为一次明确的 UI 调整上线。
     */
    expect(dashboardSource.slice(orderIndex, orderIndex + 180)).toContain('nested: false');
    expect(dashboardSource).not.toContain('label: "商城订单"');
    expect(dashboardSource).toContain('location.startsWith(`${path}/`)');
  });
});
