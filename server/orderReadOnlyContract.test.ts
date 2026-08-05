import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const routerSource = readSource("./routers.ts");
const proxySource = readSource("./platformOrderApi.ts");
const permissionSource = readSource("../shared/adminPermissions.ts");
const ordersPageSource = readSource("../client/src/pages/Orders.tsx");

describe("后台商城订单严格只读契约", () => {
  it("服务端代理与 tRPC 路由只暴露列表和详情 query", () => {
    const orderRouterStart = routerSource.indexOf("order: router({");
    const orderRouterEnd = routerSource.indexOf("// ─── 物料数据库", orderRouterStart);
    const orderRouter = routerSource.slice(orderRouterStart, orderRouterEnd);

    expect(orderRouter).toContain("list: orderReadProcedure");
    expect(orderRouter).toContain("detail: orderReadProcedure");
    expect(orderRouter).not.toContain("transition:");
    expect(orderRouter).not.toContain(".mutation(");
    expect(proxySource).not.toContain("transitionPlatformOrder");
    expect(proxySource).not.toContain('procedure: "list" | "detail" | "transition"');
  });

  it("权限模型不再定义或授予 orders.write", () => {
    expect(permissionSource).toContain('"orders.read"');
    expect(permissionSource).not.toContain('"orders.write"');
  });

  it("订单页面保留只读查看且不出现履约状态变更控件", () => {
    expect(ordersPageSource).toContain("trpc.order.list.useQuery");
    expect(ordersPageSource).toContain("trpc.order.detail.useQuery");
    expect(ordersPageSource).not.toContain("trpc.order.transition");
    expect(ordersPageSource).not.toContain("履约操作");
    expect(ordersPageSource).not.toContain("确认收款");
    expect(ordersPageSource).not.toContain("取消订单");
    expect(ordersPageSource).not.toContain("登记发货");
    expect(ordersPageSource).not.toContain("确认订单完成");
  });
});
