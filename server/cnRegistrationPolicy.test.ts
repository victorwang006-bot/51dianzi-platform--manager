import { describe, expect, it } from "vitest";
import {
  cnReviewMerchantStateEligible,
  cnReviewOwnerInScope,
  platformDatabaseIdentifier,
} from "./cnRegistrationPolicy";

describe("CN 注册审核共享策略", () => {
  it("M-05：仅接受保守 MySQL identifier，空白、引号和标点配置均失败关闭", () => {
    expect(platformDatabaseIdentifier(undefined)).toBe("dianzi51");
    expect(platformDatabaseIdentifier("unit_platform_2")).toBe("unit_platform_2");
    for (const value of ["", " ", "dianzi51 test", "dianzi51`", "dianzi51'", "dianzi51;DROP", "9platform", "platform-name"]) {
      expect(() => platformDatabaseIdentifier(value)).toThrow("PLATFORM_DB_NAME_INVALID");
    }
  });

  it("初审仅允许 pending，复审仅允许 approved", () => {
    expect(cnReviewMerchantStateEligible("pending", "initial")).toBe(true);
    expect(cnReviewMerchantStateEligible("approved", "resubmission")).toBe(true);
    expect(cnReviewMerchantStateEligible("approved", "initial")).toBe(false);
    expect(cnReviewMerchantStateEligible("pending", "resubmission")).toBe(false);
  });

  it("具体范围只接受当前正式 owner，协作者或无 owner 不会获得写权限", () => {
    expect(cnReviewOwnerInScope("sales-a", undefined)).toBe(true);
    expect(cnReviewOwnerInScope("sales-a", ["sales-a"])).toBe(true);
    expect(cnReviewOwnerInScope("sales-b", ["sales-a"])).toBe(false);
    expect(cnReviewOwnerInScope(null, ["sales-a"])).toBe(false);
  });
});
