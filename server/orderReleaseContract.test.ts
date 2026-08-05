import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  fileURLToPath(new URL("../release/deploy-admin-order-readonly.sh", import.meta.url)),
  "utf8",
);

describe("后台订单只读原子发布契约", () => {
  it("冻结当前前后台生产基线并只重载后台双实例", () => {
    expect(script).toContain("20260805T090253Z-admin-crm-secret-free-v2");
    expect(script).toContain("20260805T153128Z-order-readonly-v1");
    expect(script).toContain("EXPECTED_OLD_PIDS='234797,234810'");
    expect(script).toContain("EXPECTED_FRONT_PIDS='239984,239985,240010,240011'");
    expect(script).toContain("pm2 reload dianzi51-admin");
    expect(script).not.toContain("pm2 reload dianzi51\n");
  });

  it("发布包仅允许订单只读所需源码、测试与锁文件", () => {
    for (const path of [
      "client/src/pages/Orders.tsx",
      "server/platformOrderApi.ts",
      "server/routers.ts",
      "shared/adminPermissions.ts",
      "server/orderProxy.test.ts",
      "server/orderReadOnlyContract.test.ts",
      "server/adminPermissions.test.ts",
      "package.json",
      "pnpm-lock.yaml",
    ]) {
      expect(script).toContain(path);
    }
    expect(script).toContain("archive file list is not exact");
    expect(script).toContain("sensitive, database, runtime, or audit path found in archive");
    expect(script).not.toContain("DROP TABLE");
    expect(script).not.toContain("TRUNCATE TABLE");
    expect(script).not.toContain("DELETE FROM");
  });

  it("切换前后执行只读订单烟测并在失败时原子回滚", () => {
    expect(script.match(/smoke_order_proxy/g)?.length).toBeGreaterThanOrEqual(3);
    expect(script).toContain("listPlatformOrders({ page: 1, pageSize: 1 })");
    expect(script).toContain("atomic_link \"$SOURCE\"");
    expect(script).toContain("atomic_link \"$OLD_TARGET\"");
    expect(script).toContain("nginx -t");
    expect(script).toContain("nginx -s reload");
    expect(script).toContain("trap rollback_on_error ERR");
  });

  it("生产构建使用源码契约、UI 标记与真实烟测，拒绝脆弱的 bundle 字面量判断", () => {
    expect(script).toContain('procedure: \"list\" | \"detail\"');
    expect(script).toContain("list: orderReadProcedure");
    expect(script).toContain("detail: orderReadProcedure");
    expect(script).toContain('"orders.read"');
    expect(script).toContain("只读访问商城唯一订单事实源");
    expect(script).toContain("transitionPlatformOrder");
    expect(script).toContain("order write capability remains in source contract or production UI bundle");
    expect(script).not.toContain("grep -Fq 'internalOrder.list' dist/index.js");
    expect(script).not.toContain("grep -Fq 'internalOrder.detail' dist/index.js");
  });
});
