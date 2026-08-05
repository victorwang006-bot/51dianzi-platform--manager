import { describe, expect, it } from "vitest";
import {
  assertMerchantCrmStatusTransition,
  crmStatusAction,
  decideMerchantCrmGrant,
  isEquivalentEnabledBinding,
} from "./crmGrantPolicy";

describe("后台商户 CRM 唯一用户绑定策略", () => {
  it("存量 owner 为空时必须填写前台用户 ID", () => {
    expect(() => decideMerchantCrmGrant(
      { crmStatus: "enabled", crmOwnerPortalUserId: null },
      { crmStatus: "enabled" },
    )).toThrow("前台用户 ID");
  });

  it("存量 owner 为空时规范化并绑定指定前台用户", () => {
    expect(decideMerchantCrmGrant(
      { crmStatus: "enabled", crmOwnerPortalUserId: null },
      { crmStatus: "enabled", portalUserId: " 390005 " },
    )).toEqual({
      kind: "enable",
      ownerToBind: "390005",
      expectedExistingOwner: null,
    });
  });

  it("同一账号重复开通保持幂等", () => {
    expect(decideMerchantCrmGrant(
      { crmStatus: "disabled", crmOwnerPortalUserId: "390005" },
      { crmStatus: "enabled", portalUserId: "390005" },
    )).toEqual({
      kind: "enable",
      ownerToBind: "390005",
      expectedExistingOwner: "390005",
    });
  });

  it("已绑定商户拒绝通过开通操作静默换绑", () => {
    expect(() => decideMerchantCrmGrant(
      { crmStatus: "enabled", crmOwnerPortalUserId: "390005" },
      { crmStatus: "enabled", portalUserId: "396297" },
    )).toThrow("不能通过开通操作直接换绑");
  });

  it("暂停和拒绝保留现有 owner", () => {
    expect(decideMerchantCrmGrant(
      { crmStatus: "enabled", crmOwnerPortalUserId: "390005" },
      { crmStatus: "disabled" },
    )).toEqual({ kind: "status-only", existingOwner: "390005" });
  });

  it("并发更新返回零行时只接受已形成的同账号启用状态", () => {
    expect(isEquivalentEnabledBinding(
      { crmStatus: "enabled", crmOwnerPortalUserId: "390005" },
      "390005",
    )).toBe(true);
    expect(isEquivalentEnabledBinding(
      { crmStatus: "enabled", crmOwnerPortalUserId: "396297" },
      "390005",
    )).toBe(false);
    expect(isEquivalentEnabledBinding(
      { crmStatus: "disabled", crmOwnerPortalUserId: "390005" },
      "390005",
    )).toBe(false);
  });

  it.each([
    ["none", "pending"],
    ["none", "enabled"],
    ["pending", "enabled"],
    ["pending", "rejected"],
    ["enabled", "disabled"],
    ["disabled", "enabled"],
    ["rejected", "pending"],
    ["rejected", "enabled"],
  ] as const)("允许 CRM 状态从 %s 迁移到 %s", (fromStatus, toStatus) => {
    expect(() => assertMerchantCrmStatusTransition(fromStatus, toStatus)).not.toThrow();
  });

  it.each([
    ["none", "disabled"],
    ["none", "rejected"],
    ["pending", "disabled"],
    ["enabled", "pending"],
    ["enabled", "rejected"],
    ["disabled", "pending"],
    ["disabled", "rejected"],
    ["rejected", "disabled"],
  ] as const)("拒绝 CRM 状态从 %s 非法跳转到 %s", (fromStatus, toStatus) => {
    expect(() => assertMerchantCrmStatusTransition(fromStatus, toStatus)).toThrow("不能从");
  });

  it("区分开通、暂停、恢复、拒绝和幂等动作", () => {
    expect(crmStatusAction("pending", "enabled")).toBe("enable");
    expect(crmStatusAction("enabled", "disabled")).toBe("suspend");
    expect(crmStatusAction("disabled", "enabled")).toBe("resume");
    expect(crmStatusAction("pending", "rejected")).toBe("reject");
    expect(crmStatusAction("enabled", "enabled")).toBe("noop");
  });
});
