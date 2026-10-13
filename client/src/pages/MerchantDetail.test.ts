import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("client/src/pages/MerchantDetail.tsx", "utf8");

describe("商户详情优质商家静态契约", () => {
  it("读取固定状态接口并以 merchantId 查询", () => {
    expect(source).toContain("homepageFeatureStatus: {");
    expect(source).toContain("homepageFeatureProcedures.homepageFeatureStatus.useQuery(");
    expect(source).toContain("{ merchantId: id }");
    expect(source).toContain("homepageFeatureStatus?.featured");
    expect(source).toContain("homepageFeatureStatus.eligible");
    expect(source).toContain("homepageFeatureStatus?.approvedPhotoCount");
    expect(source).toContain("homepageFeatureStatus?.hasPublishedInventory");
    expect(source).toContain("homepageFeatureStatus?.missingReasons[0]");
  });

  it("按写权限显示操作，并提供设为和取消优质商家的简洁确认", () => {
    expect(source).toMatch(/merchant\.canManage\s*&&\s*homepageFeatureStatus/);
    expect(source).toContain('"设为优质商家"');
    expect(source).toContain('"取消优质商家"');
    expect(source).toContain("<AlertDialog");
    expect(source).toContain("data-homepage-feature-dialog");
    expect(source).toContain("设为优质商家？");
    expect(source).toContain("取消优质商家？");
    expect(source).toContain("符合展示条件后，将在首页优质商家中展示。");
    expect(source).not.toContain("资料暂未满足条件时仍可先保存设置");
    expect(source).not.toContain('"未设优质商家"');
    expect(source).toContain("homepageFeatureStatus?.featured ? (");
    expect(source).not.toContain("homepageFeatureReason");
    expect(source).not.toContain("填写原因");
  });

  it("状态加载失败时显示可点击重试，不再用无提示灰色设置按钮代替错误", () => {
    expect(source).toContain("error: homepageFeatureError");
    expect(source).toContain("isLoading: homepageFeatureLoading");
    expect(source).toContain("data-homepage-feature-retry");
    expect(source).toContain("状态加载失败，点击重试");
    expect(source).toContain("data-homepage-feature-loading");
    expect(source).toContain("状态加载中…");
    expect(source).not.toContain("disabled={!homepageFeatureStatus || homepageFeatureMutation.isPending}");
  });

  it("允许未满足条件时保持设置、展示最简缺失提示，并在成功后刷新状态和提示", () => {
    expect(source).toContain('"优质商家 · 待完善"');
    expect(source).toContain('"优质商家"');
    expect(source).toContain("data-homepage-feature-missing");
    expect(source).toContain('"缺公司照片"');
    expect(source).toContain('"缺公开库存"');
    expect(source).toContain("setHomepageFeatured: {");
    expect(source).toContain("homepageFeatureProcedures.setHomepageFeatured.useMutation(");
    expect(source).toContain("homepageFeatureMutation.mutate({ merchantId: id, featured: homepageFeatureDialogTarget })");
    expect(source).toContain("void refetchHomepageFeatureStatus()");
    expect(source).toContain('toast.success(result.featured ? "已设为优质商家" : "已取消优质商家")');
  });

  it("在优质商家旁提供独立的展示商家开关，用于首页入驻商家照片", () => {
    expect(source).toContain('"设为展示商家"');
    expect(source).toContain('"取消展示商家"');
    expect(source).toContain("data-homepage-showcase-toggle");
    expect(source).toContain("data-homepage-showcase-dialog");
    expect(source).toContain("确认后将在首页「入驻商家」中展示该公司照片。");
    expect(source).toContain("homepageShowcaseMutation.mutate({ merchantId: id, showcased: homepageShowcaseDialogTarget })");
  });
});

describe("香港注册资料人工审核静态契约", () => {
  it("将生效资料和仅审核者可见的待审资料分为独立面板", () => {
    expect(source).toContain("const hkRegistrationPending = merchant.hkRegistrationPending");
    expect(source).toContain('SectionCard title="香港企业注册资料"');
    expect(source).toContain('SectionCard title="香港注册资料（待人工审核）"');
    expect(source).toContain('merchant.registrationRegion === "HK" && hkRegistrationPending');
    expect(source).toContain('label="银行账户号码" value={hkRegistrationPending.bankAccountNumber}');
    expect(source).toContain('label="SWIFT（选填）" value={hkRegistrationPending.swift}');
    expect(source).toContain('label="银行代码（选填）" value={hkRegistrationPending.bankCode}');
  });

  it("以 pending source 申请短期原件链接，且浏览器不接触对象键", () => {
    expect(source).toContain('source: "effective" | "pending" = "effective"');
    expect(source).toContain('source === "pending"');
    expect(source).toContain("expectedSubmissionId: hkRegistrationPending.submissionId");
    expect(source).toContain("expectedPayloadHash: hkRegistrationPending.payloadHash");
    expect(source).toContain('openHkDocument(kind, "pending", {');
    expect(source).not.toContain("document.objectKey");
    expect(source).not.toContain("hkRegistrationPending.documentObjectKeys");
  });

  it("要求审核员人工逐份核对三证；OCR 失败不会自动通过", () => {
    expect(source).toContain("OCR 识别成功仅作辅助；识别失败仅表示待人工分类，均不会自动通过。");
    expect(source).toContain("审核者必须逐份打开 BR、CI 和银行证明原件");
    expect(source).toContain("我已逐份查看 BR、CI 与银行证明原件");
    expect(source).toContain("hkReviewDecision === \"approved\" && !hkIdentityConfirmed");
    expect(source).toContain('hkReviewDecision === "rejected" && !hkReviewNote.trim()');
    expect(source).toContain("confirmed: hkReviewDecision === \"approved\" ? hkIdentityConfirmed : undefined");
  });

  it("冻结审核时看到的版本，版本变更后取消确认并提交版本令牌", () => {
    expect(source).toContain("trpc.merchant.reviewHkRegistrationDraft.useMutation");
    expect(source).toContain("decision: hkReviewDecision");
    expect(source).toContain("note: hkReviewNote.trim() || undefined");
    expect(source).toContain("const [hkReviewVersion, setHkReviewVersion]");
    expect(source).toContain("const openHkReviewDialog");
    expect(source).toContain("hkReviewVersionIsStale");
    expect(source).toContain("data-hk-registration-review-version-changed");
    expect(source).toContain("setHkIdentityConfirmed(false)");
    expect(source).toContain("expectedSubmissionId: hkReviewVersion.expectedSubmissionId");
    expect(source).toContain("expectedPayloadHash: hkReviewVersion.expectedPayloadHash");
    expect(source).toContain("await Promise.all([");
    expect(source).toContain("utils.merchant.detail.invalidate({ id })");
    expect(source).toContain("utils.merchant.list.invalidate()");
    expect(source).toContain("ERP 开通仍由原后台流程后续人工处理。");
  });
});
