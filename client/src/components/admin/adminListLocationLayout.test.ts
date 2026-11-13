import { describe, expect, it } from "vitest";
import { CHANNEL_INVENTORY_ROUTE } from "../../lib/channelInventoryNavigation";
import { getAdminListLocationLayout } from "./adminListLocationLayout";

const inventory = Object.freeze(["库存列表"]);

describe("getAdminListLocationLayout 原始 pathname 几何契约", () => {
  it.each([
    "/workbench/customers", "/workbench/customers/", "/workbench/customers///?merchantId=31#entry",
    "/workbench", "/workbench/?ciTab=materials&ciView=flat#entry",
    CHANNEL_INVENTORY_ROUTE, `${CHANNEL_INVENTORY_ROUTE}/?ciTab=materials#entry`,
    "/workbench/inquiries", "/workbench/inquiries/?conversationId=31", "/workbench/chat?conversationId=31",
  ])("%s 根页保留可访问 nav 但脱离标题行", location => {
    expect(getAdminListLocationLayout(location, inventory)).toBe("root-hidden");
  });

  it.each(["/merchants", "/merchants/?page=2#dialog", "/staff", "/staff///#archive", "/admins", "/admins/?status=active"])("%s 真实根页采用紧凑 breadcrumb", location => {
    expect(getAdminListLocationLayout(location, Object.freeze(["组织与权限", "原名称"]))).toBe("list-breadcrumb");
  });

  it.each([
    "/workbench/customers/88", "/workbench/customers/88/?merchantId=31#entry",
    "/workbench/customer-demands", "/workbench/channel-inventory/88", "/workbench/inventory",
    "/workbench/publish", "/workbench/publish/88/edit", "/merchants/88", "/staff/88", "/admins/88",
    "/workbench/add-user", "/unknown", "/profile", "/workbench/company-info", "/workbench/customers-other", "/", "",
  ])("%s 不把 canonical 列表的详情/别名/未知路径标成根页", location => {
    expect(getAdminListLocationLayout(location, inventory)).toBeUndefined();
  });

  it.each([
    ["库存列表", "渠道库存"], ["库存列表", "渠道库存", "渠道档案"],
    ["库存列表", "上传批次"], ["库存列表", "回收站"], ["库存列表", "其他详情上下文"],
  ])("库存多层 labels %j 保留上下文而不隐藏", (...labels) => {
    const frozen = Object.freeze(labels);
    expect(getAdminListLocationLayout(`${CHANNEL_INVENTORY_ROUTE}?ciTab=materials`, frozen)).toBeUndefined();
    expect(getAdminListLocationLayout("/workbench?ciTab=materials", frozen)).toBeUndefined();
    expect(frozen).toEqual(labels);
  });

  it.each(["/workbench/customers", "/workbench", CHANNEL_INVENTORY_ROUTE, "/workbench/inquiries", "/workbench/chat", "/merchants", "/staff", "/admins"])("%s 没有 labels 时不编造展示标记", location => {
    expect(getAdminListLocationLayout(location, Object.freeze([]))).toBeUndefined();
  });
});
