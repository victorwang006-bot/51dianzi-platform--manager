import { describe, expect, it } from "vitest";
import {
  createAdminLoginPath,
  normalizeAdminReturnPath,
  readAdminLoginReturnPath,
} from "./adminRoutes";

describe("后台登录路由", () => {
  it("未登录访问受保护页面时生成包含目标页的登录地址", () => {
    expect(createAdminLoginPath("/merchants/12", "?tab=materials")).toBe(
      "/login?next=%2Fmerchants%2F12%3Ftab%3Dmaterials"
    );
  });

  it("登录页可读取并恢复原目标路径", () => {
    expect(readAdminLoginReturnPath("?next=%2Fmessages%3Fstatus%3Dopen")).toBe(
      "/messages?status=open"
    );
  });

  it("拒绝外部地址及登录页循环回跳", () => {
    expect(normalizeAdminReturnPath("https://example.com/admin")).toBe("/");
    expect(normalizeAdminReturnPath("//example.com/admin")).toBe("/");
    expect(normalizeAdminReturnPath("/login?next=/admins")).toBe("/");
  });
});
