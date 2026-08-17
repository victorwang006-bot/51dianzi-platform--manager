import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 订单状态覆盖契约。
 *
 * 故障现场：admin.51dianzi.com/orders 整页白屏，
 * 报 `TypeError: Cannot read properties of undefined (reading 'className')`。
 *
 * 根因：前台订单状态枚举有 7 个值，后台只认 6 个（漏了 refunded），
 * `statusMeta[status]` 取不到 → 读 `.className` 抛错 → 整页崩。
 *
 * refunded 是前台后加的「退款完成」终态（与 refund 退款申请中必须区分，
 * 前台 schema 注释记录了合并二者曾导致长期卡单）。
 * 也就是说这个崩溃是随平台第一笔退款走完流程才被触发的。
 *
 * 本测试锁两件事：
 *   1. 后台三处状态定义必须覆盖前台全集
 *   2. 未知状态必须降级渲染，不得让整页不可用
 *
 * 第 2 条比第 1 条更重要：前后台是独立仓库、各自部署，枚举天然会漂移，
 * 只靠「记得同步」必然复发。
 */

const readSource = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const ordersPageSource = readSource("../client/src/pages/Orders.tsx");
const proxySource = readSource("./platformOrderApi.ts");
const routerSource = readSource("./routers.ts");

/**
 * 前台 `drizzle/schema.ts` 的 ORDER_STATUSES 全集。
 *
 * 后台是独立仓库，读不到前台源码，因此在此登记一份。
 * 前台新增状态时，这里与被测的三处必须一起补。
 */
const PORTAL_ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "done",
  "refund",
  "cancel",
  "refunded",
] as const;

describe("后台订单状态必须覆盖商城全集", () => {
  it("页面状态映射 statusMeta 覆盖每一个状态", () => {
    const start = ordersPageSource.indexOf("const statusMeta = {");
    const end = ordersPageSource.indexOf("} as const;", start);
    expect(start).toBeGreaterThan(-1);
    const block = ordersPageSource.slice(start, end);

    const missing = PORTAL_ORDER_STATUSES.filter(
      status => !new RegExp(`\\b${status}:`).test(block),
    );
    /*
     * 缺任何一个值，只要列表当前页出现该状态的订单，整页就白屏。
     * 这不是显示瑕疵，是订单管理功能完全不可用。
     */
    expect(missing).toEqual([]);
  });

  it("服务端状态类型 PlatformOrderStatus 覆盖每一个状态", () => {
    const start = proxySource.indexOf("export type PlatformOrderStatus");
    const end = proxySource.indexOf(";", start);
    const block = proxySource.slice(start, end);

    const missing = PORTAL_ORDER_STATUSES.filter(
      status => !block.includes(`"${status}"`),
    );
    expect(missing).toEqual([]);
  });

  it("列表筛选入参枚举覆盖每一个状态", () => {
    const start = routerSource.indexOf("order: router({");
    const end = routerSource.indexOf("// ─── 物料数据库", start);
    const block = routerSource.slice(start, end);

    const missing = PORTAL_ORDER_STATUSES.filter(
      status => !block.includes(`"${status}"`),
    );
    /* 漏值时 zod 会把该状态判为非法入参，用户按「已退款」筛选直接报错 */
    expect(missing).toEqual([]);
  });

  it("refunded 与 refund 必须是两个独立状态，不得合并", () => {
    /*
     * 前台 schema 明确：两者共用一个状态会导致订单停在 refund 后没有出口，
     * 既无法判断是等审核还是已退完，财务也无法按状态对账，
     * 生产曾因此产生长期卡单。
     */
    expect(ordersPageSource).toMatch(/\brefund:\s*\{/);
    expect(ordersPageSource).toMatch(/\brefunded:\s*\{/);

    const refundLabel = ordersPageSource.match(/\brefund:\s*\{\s*label:\s*"([^"]+)"/)?.[1];
    const refundedLabel = ordersPageSource.match(/\brefunded:\s*\{\s*label:\s*"([^"]+)"/)?.[1];
    expect(refundLabel).toBeTruthy();
    expect(refundedLabel).toBeTruthy();
    /* 两个状态的中文标签不能相同，否则运营在界面上无法区分 */
    expect(refundedLabel).not.toBe(refundLabel);
  });
});

describe("未知订单状态不得让整页崩溃", () => {
  it("状态徽章组件对取不到映射的状态有兜底分支", () => {
    const start = ordersPageSource.indexOf("function OrderStatus(");
    const end = ordersPageSource.indexOf("function OrderList(", start);
    expect(start).toBeGreaterThan(-1);
    const block = ordersPageSource.slice(start, end);

    /*
     * 必须存在「取不到就降级」的分支。
     * 原实现直接 `meta.className`，前台每新增一个状态就会在此处白屏一次。
     * 显示一个不认识的状态名，与整个订单管理页打不开，
     * 严重程度完全不在一个量级。
     */
    expect(block).toMatch(/if\s*\(\s*!meta\s*\)/);
    /* 兜底分支必须真的返回可渲染内容，而不是 return null 造成空白单元格 */
    expect(block).toMatch(/if\s*\(\s*!meta\s*\)\s*\{[\s\S]*?return\s*</);
  });

  it("状态徽章入参不再被收窄为已知键，否则兜底分支永远走不到", () => {
    const start = ordersPageSource.indexOf("function OrderStatus(");
    const signature = ordersPageSource.slice(start, ordersPageSource.indexOf(")", start));
    /*
     * 若签名仍写 `status: keyof typeof statusMeta`，
     * tsc 会认为不可能出现未知值，兜底代码看似存在实则是死代码，
     * 且后续重构极易被当作冗余删除。
     */
    expect(signature).not.toContain("keyof typeof statusMeta");
    expect(signature).toContain("status: string");
  });

  it("统计接口的状态计数按可选键声明，避免取值得到 NaN", () => {
    /*
     * 商城只返回存在订单的状态键，不会把零订单状态补齐。
     * 声明为完整 Record 时 tsc 认为每个键都在，
     * 直接参与运算会得到 NaN 而不报错。
     */
    expect(proxySource).toContain("statusCounts: Partial<Record<PlatformOrderStatus, number>>");
    expect(proxySource).toContain("statusAmounts: Partial<Record<PlatformOrderStatus, string>>");
  });
});
