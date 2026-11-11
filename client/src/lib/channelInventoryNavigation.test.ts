import { describe, expect, it } from "vitest";
import {
  CHANNEL_INVENTORY_ROUTE,
  CHANNEL_INVENTORY_TABS,
  channelInventoryTabLocation,
  channelInventoryViewLocation,
  getChannelInventoryNavigationTab,
  getChannelInventoryNavigationView,
  type ChannelInventoryNavigationView,
} from "./channelInventoryNavigation";

const views = ["flat", "channels"] as const;

describe("库存导航共享 ciTab/ciView URL 合约", () => {
  it.each(views)("materials 的 %s 视图支持绝对与工作台相对 URL", view => {
    expect(channelInventoryViewLocation(view)).toBe(`${CHANNEL_INVENTORY_ROUTE}?ciTab=materials&ciView=${view}`);
    expect(channelInventoryViewLocation(view, true)).toBe(`/channel-inventory?ciTab=materials&ciView=${view}`);
    expect(channelInventoryTabLocation("materials", false, view)).toBe(channelInventoryViewLocation(view));
    expect(channelInventoryTabLocation("materials", true, view)).toBe(channelInventoryViewLocation(view, true));
    expect(getChannelInventoryNavigationView(`?ciTab=materials&ciView=${view}`)).toBe(view);
  });

  it.each(["", "?ciTab=materials", "?ciView=invalid", "?ciView=", "?ciView=flat", "?ciView=Channels", "?supplyChannelId=22&supplyTab=materials"])("%s 无值或非法视图默认平铺", search => {
    expect(getChannelInventoryNavigationView(search)).toBe("flat");
  });

  it.each([null, undefined, "", "materials", "trash", "../channels", "flat&supplyChannelId=22", 1, {}, ["channels"]])("拒绝非白名单 view %j", view => {
    expect(channelInventoryViewLocation(view)).toBeNull();
    expect(channelInventoryViewLocation(view, true)).toBeNull();
  });

  it.each(CHANNEL_INVENTORY_TABS)("未传 view 的旧 $id URL 保持逐字兼容", tab => {
    expect(channelInventoryTabLocation(tab.id)).toBe(`${CHANNEL_INVENTORY_ROUTE}?ciTab=${tab.id}`);
    expect(channelInventoryTabLocation(tab.id, true)).toBe(`/channel-inventory?ciTab=${tab.id}`);
    expect(getChannelInventoryNavigationTab(`?ciTab=${tab.id}`)).toBe(tab.id);
  });

  it.each(["channels", "batches", "trash"] as const)("旧 %s 深链不夹带材料视图", tab => {
    for (const view of views) {
      expect(channelInventoryTabLocation(tab, false, view)).toBe(`${CHANNEL_INVENTORY_ROUTE}?ciTab=${tab}`);
    }
  });

  it("非法 tab/view 不可拼接 URL 或额外参数", () => {
    expect(channelInventoryTabLocation("materials&supplyChannelId=22")).toBeNull();
    expect(channelInventoryTabLocation("materials", false, "invalid" as ChannelInventoryNavigationView)).toBeNull();
  });

  it.each(views)("正常 %s 入口不继承旧客户、渠道、批次及返回定位", view => {
    const oldSearch = "?merchantId=31&supplyChannelId=22&supplyTab=details&ciBatchId=8&ciBatchReturn=%2Forders&ciBatchFocusId=3&returnTo=%2Forders&ciView=channels";
    const location = channelInventoryViewLocation(getChannelInventoryNavigationView(oldSearch.replace("ciView=channels", `ciView=${view}`)))!;
    const params = new URLSearchParams(location.split("?")[1]);
    expect(Array.from(params.entries())).toEqual([["ciTab", "materials"], ["ciView", view]]);
  });
});
