import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const merchants = readFileSync(resolve(root, "client/src/pages/Merchants.tsx"), "utf8");
const queue = readFileSync(resolve(root, "client/src/components/merchant/CnRegistrationReviewQueue.tsx"), "utf8");
const detail = readFileSync(resolve(root, "client/src/components/merchant/CnRegistrationReviewDetail.tsx"), "utf8");

describe("MGR-CN-UI-001 source recovery contract", () => {
  it("restores the existing queue consumer without a new route", () => {
    expect(merchants).toContain('import CnRegistrationReviewQueue from "@/components/merchant/CnRegistrationReviewQueue"');
    expect(merchants).toContain("<CnRegistrationReviewQueue onOpenDetail={setCnReviewMerchantId} />");
    expect(merchants).toContain("<CnRegistrationReviewDetail");
    expect(merchants).not.toContain('href="/cn-registration-review');
    expect(queue).toContain("trpc.merchant.listCnRegistrationReviewQueue.useQuery");
    expect(queue).toContain('{ page: 1, pageSize: 100 }');
    expect(queue).toContain("待审企业");
    expect(queue).toContain("条待审");
  });

  it("uses the original read freshness and snapshot-absence contract", () => {
    expect(detail).toContain("trpc.merchant.getCnRegistrationReviewDetail.useQuery");
    expect(detail).toContain("staleTime: 0");
    expect(detail).toContain('refetchOnMount: "always"');
    expect(detail).toContain("refetchOnWindowFocus: true");
    expect(detail).toContain("资料加载失败，请刷新后重试。");
    expect(detail).toContain("资料加载不完整，请刷新后重试。");
    expect(detail).toContain("data-review-refresh");
  });

  it("keeps existing permission, canReview, confirmation, and expectedVersion CAS gates", () => {
    expect(detail).toContain('hasAdminPermission(adminRole, "merchants.write", adminPermissions)');
    expect(detail).toContain("!detail?.canReview || !mayApprove || !readableCandidate");
    expect(detail).toContain("candidate.expectedVersion !== expectedVersion");
    expect(detail).toContain("setExpectedVersion(candidate.expectedVersion)");
    expect(detail).toContain("expectedVersion,");
    expect(detail).toContain('confirmed: decision === "approved" ? identityConfirmed : undefined');
    expect(detail).toContain('decision === "approved" && !identityConfirmed');
    expect(detail).toContain('decision === "rejected" && !note.trim()');
    expect(detail).toContain("data-review-approve");
    expect(detail).toContain("data-review-reject");
    expect(detail).toContain("data-review-submit");
  });

  it("shows only DTO summaries/differences and never moves document storage keys into the browser", () => {
    expect(detail).toContain("data-review-summary");
    expect(detail).toContain("data-review-differences");
    expect(detail).toContain("BUSINESS_LICENSE");
    expect(detail).toContain("BANK_LICENSE");
    expect(detail).not.toContain("objectKey");
    expect(detail).not.toContain("licenseObjectKey");
    expect(detail).not.toContain("bankLicenseObjectKey");
  });
});
