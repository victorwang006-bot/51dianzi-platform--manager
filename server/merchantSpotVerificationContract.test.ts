import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("商户现货核验后台入口", () => {
  it("商户详情增加现货核验标签，浏览器只传 merchantId", () => {
    const detail = read("client/src/pages/MerchantDetail.tsx");
    const panel = read("client/src/components/admin/MerchantSpotVerificationPanel.tsx");
    const routers = read("server/routers.ts");
    expect(detail).toContain('label: "现货核验"');
    expect(detail).toContain("<MerchantSpotVerificationPanel");
    expect(panel).toContain("通过");
    expect(panel).toContain("拒绝");
    expect(panel).toContain("取消");
    expect(routers).toContain("spotVerificationReviews: merchantReadProcedure");
    expect(routers).toContain("approveSpotVerification: merchantWriteProcedure");
    expect(routers).toContain("rejectSpotVerification: merchantWriteProcedure");
    expect(routers).toContain("cancelSpotVerification: merchantWriteProcedure");
    expect(routers).toContain("approveSpotVerification: merchantWriteProcedure");
    expect(routers).toContain("getPlatformCompanyMediaBinding(ctx, input.merchantId)");
  });
});
