/**
 * 管理端订单接口的权限隔离契约测试。
 *
 * 背景：商户管理早已按销售范围隔离，但订单的 stats/list/detail 三个接口
 * 原先完全没有传范围，任何能进订单页的后台账号都能看到全平台订单
 * （含他人客户的采购明细、收货人与手机号），属于严重越权。
 *
 * 本文件锁定「三个接口都必须传范围」这一约束。任何一处被改回裸调用，
 * 越权就会静默复发——界面看不出异常，只是数据变多，因此必须由测试守住。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const routersSource = readFileSync(join(root, "server/routers.ts"), "utf8");
const apiSource = readFileSync(join(root, "server/platformOrderApi.ts"), "utf8");
const ordersPageSource = readFileSync(join(root, "client/src/pages/Orders.tsx"), "utf8");

/** 截取 order 路由段落：避免匹配到其它路由的同名字段 */
function getOrderRouterBlock(): string {
  const start = routersSource.indexOf("order: router({");
  const end = routersSource.indexOf("material: router({");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routersSource.slice(start, end);
}

describe("订单接口销售范围隔离", () => {
  it("stats / list / detail 三个接口都必须传入销售范围", () => {
    const block = getOrderRouterBlock();
    for (const procedure of ["stats", "list", "detail"]) {
      expect(block).toContain(`${procedure}:`);
    }
    /*
     * 三个接口各出现一次真实调用。
     * 必须带 await 前缀才计数：否则注释里提到的函数名也会被算进去，
     * 使计数虚高——那样即使真的有接口漏传也能蒙混过关。
     */
    const occurrences = block.match(/await getAdminSalesStaffCodes\(ctx\)/g) ?? [];
    expect(occurrences.length).toBe(3);
  });

  it("订单接口不得存在无范围的裸调用", () => {
    const block = getOrderRouterBlock();
    // 例如 getPlatformOrderStats() —— 空参即为不限制，等于全量暴露
    expect(block).not.toMatch(/getPlatformOrderStats\(\)/);
    expect(block).not.toMatch(/listPlatformOrders\(input\)/);
    expect(block).not.toMatch(/getPlatformOrderDetail\(input\.orderId\)/);
  });

  it("API 层必须原样保留三态语义，不得用默认值折叠", () => {
    /*
     * undefined（不限制）与 []（什么都看不到）含义相反。
     * 用 `?? []` 会让超管订单页变空，用 `|| undefined` 则是全量越权。
     * 这里通过条件展开保证 undefined 不进入 JSON、[] 如实传递。
     */
    const spreadPattern = /\.\.\.\(salesStaffCodes === undefined \? \{\} : \{ salesStaffCodes \}\)/g;
    const spreads = apiSource.match(spreadPattern) ?? [];
    expect(spreads.length).toBe(3);
    expect(apiSource).not.toMatch(/salesStaffCodes \?\? \[\]/);
    expect(apiSource).not.toMatch(/salesStaffCodes \|\| undefined/);
  });
});

describe("买家公司名展示", () => {
  it("列表行类型必须包含买家公司名与归属销售字段", () => {
    expect(apiSource).toMatch(/buyerCompanyName: string \| null/);
    expect(apiSource).toMatch(/buyerSalesOwner: string \| null/);
    expect(apiSource).toMatch(/buyerSalesOwnerCode: string \| null/);
  });

  it("买家列必须以公司名优先并回退到联系人", () => {
    /*
     * 个人买家没有企业资料，buyerCompanyName 为 null。
     * 缺少回退链会出现空白单元格，运营无法识别买家是谁。
     */
    expect(ordersPageSource).toMatch(
      /order\.buyerCompanyName[\s\S]{0,120}order\.buyerName[\s\S]{0,80}order\.buyerUsername/,
    );
  });

  it("详情页交易信息也必须优先展示公司名", () => {
    const detailIndex = ordersPageSource.indexOf("交易信息");
    expect(detailIndex).toBeGreaterThan(-1);
    const detailBlock = ordersPageSource.slice(detailIndex, detailIndex + 600);
    expect(detailBlock).toContain("order.buyerCompanyName");
  });
});
