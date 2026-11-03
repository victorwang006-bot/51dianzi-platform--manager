import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_PATH, createAdminLoginPath, normalizeAdminReturnPath, readAdminLoginReturnPath } from "./adminRoutes";

describe("后台登录路由", () => {
  it("无目标或根入口默认进入渠道库存", () => {
    expect(DEFAULT_ADMIN_PATH).toBe("/workbench/channel-inventory");
    for (const search of ["", "?next=", "?next=%2F", "?next=%2F%3Ftab%3Dold"]) expect(readAdminLoginReturnPath(search)).toBe(DEFAULT_ADMIN_PATH);
    expect(createAdminLoginPath("/")).toBe("/login?next=%2Fworkbench%2Fchannel-inventory");
  });
  it("未登录访问合法显式深链时保留目标页和参数", () => {
    expect(createAdminLoginPath("/merchants/12", "?tab=materials")).toBe("/login?next=%2Fmerchants%2F12%3Ftab%3Dmaterials");
    expect(readAdminLoginReturnPath("?next=%2Fmessages%3Fstatus%3Dopen")).toBe("/messages?status=open");
    expect(readAdminLoginReturnPath("?next=%2Fmaterials")).toBe("/materials");
  });
  it("拒绝外部地址、反斜线、控制字符及登录循环", () => {
    for (const value of ["https://example.com/admin", "//example.com/admin", "/login?next=/admins", "/\\example.com", "/foo\nbar"]) expect(normalizeAdminReturnPath(value)).toBe(DEFAULT_ADMIN_PATH);
  });
});
