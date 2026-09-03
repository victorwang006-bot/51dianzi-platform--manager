import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const ordersPageSource = readSource("../client/src/pages/Orders.tsx");
const proxySource = readSource("./platformOrderApi.ts");

describe("后台订单物料码与批次展示契约", () => {
  it("商品项优先显示接口返回的平台物料码", () => {
    expect(ordersPageSource).toContain('item.materialCode || "无平台物料码"');
    expect(proxySource).toContain("materialCode: string | null");
  });

  it("无支付批次订单显示为独立订单，不再误标历史订单", () => {
    expect(ordersPageSource).toContain("独立 DZ 订单");
    expect(ordersPageSource).toContain("独立 DZ 订单（无支付批次）");
    expect(ordersPageSource).not.toContain("历史 DZ 订单");
    expect(ordersPageSource).not.toContain("无父批次");
  });

  it("有批次订单展示支付批次编号和子单序号", () => {
    expect(ordersPageSource).toContain("支付批次 ${order.batchNo}");
    expect(ordersPageSource).toContain("String(order.batchSeq).padStart");
  });
});
