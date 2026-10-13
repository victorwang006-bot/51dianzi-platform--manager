import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("server/routers.ts", "utf8");

describe("HK registration router contract", () => {
  it("returns pending registration data only to a scoped merchant writer", () => {
    expect(source).toContain("const isHkRegistrationReviewer = canManage");
    expect(source).toContain('hasAdminPermission(role, "merchants.write", ctx.adminPermissions)');
    expect(source).toContain("db.toMerchantHkRegistrationPendingDetail(merchant)");
    expect(source).toContain("hkRegistrationPending,");
    expect(source).toContain("hasPendingHkRegistration: isHkRegistrationReviewer && Boolean(hkRegistrationPending)");
    expect(source).toContain("hkRegistration: db.toMerchantHkRegistrationDetail(merchant)");
  });

  it("keeps effective documents compatible but gates pending originals to the scoped writer", () => {
    expect(source).toContain('source: z.enum(["effective", "pending"]).default("effective")');
    expect(source).toContain('if (input.source === "pending")');
    expect(source).toContain('expectedSubmissionId: z.string().uuid("香港提交号无效").optional()');
    expect(source).toContain('expectedPayloadHash: z.string().trim().regex(/^[a-f0-9]{64}$/i, "香港提交版本校验值无效").optional()');
    expect(source).toContain('查看待审核香港原件必须提供提交版本');
    expect(source).toContain('查看待审核香港原件必须提供资料版本');
    expect(source).toContain('当前角色无权查看待审核的香港注册原件');
    expect(source).toContain("expectedSubmissionId: input.expectedSubmissionId!");
    expect(source).toContain("expectedPayloadHash: input.expectedPayloadHash!");
    expect(source).toContain("HK_REVIEW_VERSION_CHANGED");
    expect(source).toContain("storageGetOssSignedUrl(source.objectKey, 15 * 60)");
  });

  it("does not let generic merchant approval or reactivation bypass HK registration review", () => {
    expect(source).toContain('merchant.registrationRegion === "HK" && (input.action === "approve" || input.action === "reactivate")');
    expect(source).toContain("不能通过通用商户审核直接通过或恢复");
    expect(source).toContain("reviewHkRegistrationDraft: merchantWriteProcedure");
    expect(source).toContain('decision: z.enum(["approved", "rejected"])');
  });

  it("rejects a review route request without the inspected version even when the decision is rejected", () => {
    const reviewRoute = source.slice(
      source.indexOf("reviewHkRegistrationDraft: merchantWriteProcedure"),
      source.indexOf("rebindCrmOwner: crmRebindProcedure"),
    );
    expect(reviewRoute).toContain('expectedSubmissionId: z.string().uuid("香港提交号无效")');
    expect(reviewRoute).toContain('expectedPayloadHash: z.string().trim().regex(/^[a-f0-9]{64}$/i, "香港提交版本校验值无效")');
    expect(reviewRoute).not.toContain('expectedSubmissionId: z.string().uuid("香港提交号无效").optional()');
    expect(reviewRoute).toContain('value.decision === "approved" && value.confirmed !== true');
    expect(reviewRoute).toContain("confirmed: input.confirmed");
  });

  it("requires submission replay identifiers and complete constrained three-document verification records", () => {
    expect(source).toContain('submissionId: z.string().uuid("香港提交号无效")');
    expect(source).toContain('payloadHash: z.string().trim().regex(/^[a-f0-9]{64}$/i');
    expect(source).toContain("documentVerification: z.object({");
    for (const kind of ["BR", "CI", "BANK"]) {
      expect(source).toContain(`${kind}: z.object({`);
    }
    expect(source).toContain('documentId: z.string().uuid(');
    expect(source).toContain('ocrStatus: z.enum(["recognized", "failed"])');
    expect(source).toContain('recognizedType: z.enum(["BR", "CI", "BANK"]).nullable()');
    expect(source).toContain('classification: z.enum(["ocr-assisted", "manual-classification-required"])');
    expect(source).not.toContain('z.enum(["recognized", "failed", "unknown"])');
    expect(source).not.toContain("documentRole: z.string()");
  });

  it("advertises version 1 only when the explicit switch and private signing backend are ready", () => {
    expect(source).toContain('process.env.HK_REGISTRATION_ENABLED === "1" && hkPrivateStorageReady');
    expect(source).toContain('hkStorageEnv.ossAccessKeyId.trim() && hkStorageEnv.ossAccessKeySecret.trim() && hkStorageEnv.ossBucket.trim() && hkStorageEnv.ossRegion.trim()');
    expect(source).toContain('hkStorageEnv.forgeApiUrl.trim() && hkStorageEnv.forgeApiKey.trim()');
    expect(source).toContain("? { version: 1, enabled: true } as const");
    expect(source).toContain(": { version: 0, enabled: false } as const");
    expect(source).toContain("capability discovery must never run DDL");
  });
});
