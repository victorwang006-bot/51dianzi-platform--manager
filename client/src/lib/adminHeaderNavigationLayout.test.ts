import { describe, expect, it } from "vitest";
import { getAdminHeaderNavigationLayout } from "./adminHeaderNavigationLayout";

const input = { businessCount: 7, utilityCount: 3, accountWidth: 100 };
describe("顶部统一布局预算", () => {
  it("宽屏保留全部业务与独立右侧功能组", () => {
    expect(getAdminHeaderNavigationLayout({ ...input, width: 1700 })).toEqual({ visibleBusinessCount: 7, collapseUtilities: false });
  });
  it("中屏只把业务溢出收进更多，不挤压右侧", () => {
    const result = getAdminHeaderNavigationLayout({ ...input, width: 1050 });
    expect(result.collapseUtilities).toBe(false);
    expect(result.visibleBusinessCount).toBeLessThan(7);
    expect(result.visibleBusinessCount).toBeGreaterThan(0);
  });
  it("窄屏更多同时承载业务和功能入口，账号仍固定", () => {
    expect(getAdminHeaderNavigationLayout({ ...input, width: 300, accountWidth: 28 })).toEqual({ visibleBusinessCount: 1, collapseUtilities: true });
  });
  it("极窄宽度仍有更多，不产生负数入口数", () => {
    expect(getAdminHeaderNavigationLayout({ ...input, width: 120, accountWidth: 28 })).toEqual({ visibleBusinessCount: 0, collapseUtilities: true });
  });
  it("无业务权限时独立功能组仍可收纳", () => {
    expect(getAdminHeaderNavigationLayout({ ...input, businessCount: 0, width: 200 })).toEqual({ visibleBusinessCount: 0, collapseUtilities: true });
  });
  it("零尺寸/SSR保持原授权列表，不预先隐藏路由", () => {
    for (const width of [0, NaN, Infinity]) expect(getAdminHeaderNavigationLayout({ ...input, width })).toEqual({ visibleBusinessCount: 7, collapseUtilities: false });
  });
  it("无右侧功能时充分利用空间，更多只在不足时出现", () => {
    expect(getAdminHeaderNavigationLayout({ width: 388, businessCount: 3, utilityCount: 0 })).toEqual({ visibleBusinessCount: 3, collapseUtilities: false });
    expect(getAdminHeaderNavigationLayout({ width: 300, businessCount: 3, utilityCount: 0 })).toEqual({ visibleBusinessCount: 1, collapseUtilities: false });
  });
  it("布局只读，传入预算对象不修改", () => {
    const frozen = Object.freeze({ ...input, width: 390 });
    getAdminHeaderNavigationLayout(frozen);
    expect(frozen).toEqual({ ...input, width: 390 });
  });
});
