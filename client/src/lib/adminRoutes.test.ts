import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_PATH, createAdminLoginPath, normalizeAdminReturnPath, readAdminLoginReturnPath } from "./adminRoutes";

describe("后台登录路由", () => {
  it("无目标或根入口默认进入客户列表", () => {
    expect(DEFAULT_ADMIN_PATH).toBe("/workbench/customers");
    for (const search of ["", "?next=", "?next=%2F", "?next=%2F%3Ftab%3Dold"]) expect(readAdminLoginReturnPath(search)).toBe(DEFAULT_ADMIN_PATH);
    expect(createAdminLoginPath("/")).toBe("/login?next=%2Fworkbench%2Fcustomers");
    expect(normalizeAdminReturnPath(undefined)).toBe(DEFAULT_ADMIN_PATH);
    expect(normalizeAdminReturnPath(null)).toBe(DEFAULT_ADMIN_PATH);
  });
  it("未登录访问合法显式深链时保留目标页和参数", () => {
    expect(createAdminLoginPath("/merchants/12", "?tab=materials")).toBe("/login?next=%2Fmerchants%2F12%3Ftab%3Dmaterials");
    expect(readAdminLoginReturnPath("?next=%2Fmessages%3Fstatus%3Dopen")).toBe("/messages?status=open");
    expect(readAdminLoginReturnPath("?next=%2Fmaterials")).toBe("/materials");
  });
  it.each([
    "/workbench/customers/12?merchantId=31&returnTo=%2Forders#detail-12",
    "/workbench/orders?merchantId=31&merchantId=32&orderSource=mall&kw=XQ%20%2F%201#detail-9",
    "/workbench/inquiries?conversationId=88&merchantId=31#thread-88",
    "/workbench/channel-inventory?ciTab=batches&ciBatchId=8#batch-8",
    "/workbench/procurement-orders?keyword=fixture%20only#quote-8",
  ])("完整保留合法 next 深链接与未信任 merchant 候选：%s", target => {
    expect(readAdminLoginReturnPath(`?next=${encodeURIComponent(target)}`)).toBe(target);
    expect(normalizeAdminReturnPath(target)).toBe(target);
    expect(createAdminLoginPath(target)).toBe(`/login?next=${encodeURIComponent(target)}`);
  });
  it("拒绝外部地址、反斜线、控制字符及登录循环", () => {
    for (const value of ["https://example.com/admin", "//example.com/admin", "/login?next=/admins", "/login#loop", "/\\example.com", "/foo\nbar", "/foo bar", "/foo\u0000bar"]) expect(normalizeAdminReturnPath(value)).toBe(DEFAULT_ADMIN_PATH);
  });
});
