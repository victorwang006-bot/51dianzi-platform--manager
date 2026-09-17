import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const detail = read("client/src/pages/MerchantDetail.tsx");
const materials = read("client/src/components/admin/MerchantMaterialPanel.tsx");
const users = read("client/src/components/admin/MerchantEnterpriseUsersPanel.tsx");
const records = read("client/src/components/admin/MerchantOperationRecordsPanel.tsx");
const router = read("server/routers.ts");
const database = read("server/db.ts");

describe("商户详情简洁标签页布局", () => {
  it("使用紧凑摘要、统计条和五个固定标签，默认物料库存", () => {
    expect(detail).toContain('useState<MerchantTab>("materials")');
    for (const label of ["物料库存", "企业用户", "企业资料", "图片资料", "操作记录"]) {
      expect(detail).toContain(`label: "${label}"`);
    }
    expect(detail).toContain("data-merchant-summary-header");
    expect(detail).toContain("data-merchant-stat-strip");
    expect(detail).toContain("text-[13px]");
    expect(detail).toContain("text-[16px]");
  });

  it("标签横向滚动，首次按需挂载，切回时保留已访问页面状态", () => {
    expect(detail).toContain("data-responsive-tab-scroll");
    expect(detail).toContain("overflow-x-auto");
    expect(detail).toContain("min-w-max");
    expect(detail).toContain("visitedTabs");
    expect(detail).toContain("forceMount");
    expect(detail).toContain('? "mt-0" : "hidden"');
  });

  it("保留营业执照临时安全链接、用户名 CAS 和照片墙组件", () => {
    expect(detail).toContain("trpc.merchant.licenseAccess.useMutation()");
    expect(detail).toContain("expectedInternalContactName");
    expect(detail).toContain("merchant.canManage");
    expect(detail).toContain("<MerchantCompanyWallPanel merchantId={merchant.id} />");
    expect(detail).not.toContain("href={merchant.licenseImageUrl}");
  });
});

describe("物料批量操作", () => {
  it("支持当前页全选、固定批量入口、发布人整批下架与导出选中", () => {
    expect(materials).toContain('aria-label="全选当前页物料"');
    expect(materials).toContain("publisherUserId:");
    expect(materials).toContain("data-material-bulk-menu");
    expect(materials).toContain("data-material-bulk-actions");
    expect(materials).toContain("bulkOffshelfMutation.mutateAsync");
    expect(materials).toContain("publisherOffshelfPreview.useQuery");
    expect(materials).toContain("bulkOffshelfByPublisher.useMutation");
    expect(materials).toContain("下架该发布人的全部库存");
    expect(materials).toContain('aria-label="批量下架发布人"');
    expect(materials).toContain('placeholder="请选择发布人"');
    expect(materials).toContain("请选择发布人，系统将先核对其已发布库存数量");
    expect(materials).toContain("setPublisherBulkUserId");
    expect(materials).not.toContain('disabled={publisherId === "all"} variant="destructive"');
    expect(materials).toContain("已下架、草稿和其他用户库存不受影响");
    expect(materials).toContain("utils.platformMaterial.exportSelected.fetch");
    expect(materials).toContain("失败项将保留勾选");
    expect(materials).not.toContain("批量恢复");
    expect(materials).not.toContain("恢复为待发布");
  });

  it("服务端限制最多 50 个不重复正整数并保留现有下架状态语义", () => {
    const start = router.indexOf("platformMaterial: router");
    const block = router.slice(start, router.indexOf("// ─── 管理员管理", start));
    expect(block).toContain(".min(1).max(50)");
    expect(block).toContain("new Set(ids).size === ids.length");
    expect(database).toContain("FOR UPDATE");
    expect(database).toContain("SET status = 'offshelf', publishedAt = NULL");
    expect(database).toContain("bulkOffshelfPublisherInventories");
    expect(database).toContain('action: "platform_material.publisher_bulk_offshelf"');
    expect(database).toContain('targetType: "merchant"');
    expect(router).toContain("assertMerchantInSalesScope(ctx, input.merchantId)");
    expect(database).not.toContain("restoreSelectedToDraft");
  });
});

describe("企业用户与操作记录响应式视图", () => {
  it("桌面表格和窄屏卡片均可管理成员，所有者企业权限只读但登录可独立管控", () => {
    expect(users).toContain("data-responsive-member-table");
    expect(users).toContain("data-responsive-member-cards");
    expect(users).toContain("data-member-management-sheet");
    expect(users).toContain("data-owner-protection");
    expect(users).toContain("canOverrideOwnerLogin");
    expect(users).toContain("平台超级管理员仍可独立管控网站登录");
  });

  it("操作记录仅显示脱敏字段并提供桌面表格与移动时间线", () => {
    expect(records).toContain("data-responsive-record-table");
    expect(records).toContain("data-responsive-record-timeline");
    expect(records).toContain("row.time");
    expect(database).toContain('eq(auditLogs.targetType, "merchant")');
    expect(database).not.toMatch(/listMerchantOperationRecords[\s\S]{0,1400}beforeValue:/);
    expect(database).not.toMatch(/listMerchantOperationRecords[\s\S]{0,1400}ipAddress:/);
  });
});
