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
});
