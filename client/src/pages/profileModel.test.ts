import { describe, expect, it } from "vitest";
import {
  currentShanghaiMonth, decimalAmount, normalizeMainlandPhone, passwordError,
  personalCenterIdentity, personalCenterQueryPrefix, presentValue, roleLabel, validMonth,
} from "./profileModel";

describe("personal center self-scoped model", () => {
  it("partitions subjects and new session generations without exposing IDs as API inputs", () => {
    const first = personalCenterIdentity({ id: 21, username: "alice", hasNativeAdminAccount: true });
    const second = personalCenterIdentity({ id: 22, username: "bob", hasNativeAdminAccount: true });
    expect(first).not.toBe(second);
    expect(personalCenterQueryPrefix(first, 0)).not.toEqual(personalCenterQueryPrefix(first, 1));
    expect(first).not.toBe(personalCenterIdentity({ id: 21, username: "alice", hasNativeAdminAccount: false }));
  });
  it("uses Shanghai calendar month across UTC month boundaries", () => {
    expect(currentShanghaiMonth(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11");
    expect(validMonth("2026-11")).toBe(true);
    expect(validMonth("2026-13")).toBe(false);
  });
  it("validates original/new/confirmed password with minimum eight characters", () => {
    expect(passwordError({ oldPassword: "", newPassword: "abc12345", confirmPassword: "abc12345" })).toContain("原密码");
    expect(passwordError({ oldPassword: "old-pass", newPassword: "short", confirmPassword: "short" })).toContain("8");
    expect(passwordError({ oldPassword: "old-pass", newPassword: "old-pass", confirmPassword: "old-pass" })).toContain("相同");
    expect(passwordError({ oldPassword: "old-pass", newPassword: "new-pass", confirmPassword: "other-pass" })).toContain("不一致");
    expect(passwordError({ oldPassword: "old-pass", newPassword: "new-pass", confirmPassword: "new-pass" })).toBeNull();
  });
  it("normalizes only valid mainland phone numbers", () => {
    expect(normalizeMainlandPhone(" +8613800138000 ")).toBe("13800138000");
    expect(normalizeMainlandPhone("008613800138000")).toBe("13800138000");
    expect(normalizeMainlandPhone("12800138000")).toBeNull();
    expect(normalizeMainlandPhone("138001380001")).toBeNull();
  });
  it("never formats unavailable money as zero or loses server decimal precision", () => {
    expect(decimalAmount(null)).toBe("暂无数据");
    expect(decimalAmount(undefined)).toBe("暂无数据");
    expect(decimalAmount("0.0000")).toBe("0.0000");
    expect(decimalAmount("12345678901234567890.1234")).toBe("12,345,678,901,234,567,890.1234");
    expect(decimalAmount("NaN")).toBe("暂无数据");
    expect(presentValue(null)).toBe("未设置");
    expect(roleLabel("auditor")).toBe("审计人员");
    expect(roleLabel("future-role")).toBe("future-role");
  });
});
