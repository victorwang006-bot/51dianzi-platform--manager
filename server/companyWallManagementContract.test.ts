import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const routers = read("server/routers.ts");
const database = read("server/db.ts");
const detailPage = read("client/src/pages/MerchantDetail.tsx");
const wallPanel = read("client/src/components/admin/MerchantCompanyWallPanel.tsx");

function merchantRouterBlock() {
  const start = routers.indexOf("  merchant: router({");
  const end = routers.indexOf("\n  // ───", start + 20);
  return routers.slice(start, end === -1 ? undefined : end);
}

function procedureBody(name: string) {
  const block = merchantRouterBlock();
  const start = block.indexOf(`    ${name}:`);
  expect(start, `缺少 ${name} 接口`).toBeGreaterThan(-1);
  const rest = block.slice(start);
  const next = rest.slice(1).search(/\n    [a-zA-Z][a-zA-Z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("后台公司信息墙销售范围权限", () => {
  for (const name of [
    "companyWall",
    "uploadCompanyWallPhoto",
    "updateCompanyWallPhoto",
    "deleteCompanyWallPhoto",
    "reorderCompanyWallPhotos",
  ]) {
    it(`${name} 必须先校验商户销售范围`, () => {
      expect(procedureBody(name)).toContain("await assertMerchantInSalesScope(ctx, input.id)");
    });
  }

  it("越权校验复用统一三态范围且返回 NOT_FOUND", () => {
    expect(routers).toContain("await getAdminSalesStaffCodes(ctx)");
    expect(routers).toContain('message: "商户不存在或不在您负责的范围内"');
  });
});

describe("前后台共用公司信息墙数据", () => {
  it("后台通过信用代码映射前台 companies，并读写前台 company_profile_photos", () => {
    expect(database).toContain("${sql.raw(PLATFORM_DB)}.companies");
    expect(database).toContain("${sql.raw(PLATFORM_DB)}.company_profile_photos");
    expect(database).toContain("WHERE creditCode = ${normalized}");
  });

  it("上传、编辑、删除和排序均写不可变后台审计日志", () => {
    for (const action of [
      "merchant.company_wall.upload",
      "merchant.company_wall.update",
      "merchant.company_wall.delete",
      "merchant.company_wall.reorder",
    ]) {
      expect(database).toContain(`action: "${action}"`);
    }
    expect(database).toContain("tx.insert(auditLogs)");
  });

  it("删除必须软删除，公开状态只能在 approved 与 rejected 之间切换", () => {
    expect(database).toContain("SET deletedAt = NOW()");
    expect(routers).toContain('status: z.enum(["approved", "rejected"])');
    expect(database).not.toContain("DELETE FROM ${sql.raw(PLATFORM_DB)}.company_profile_photos");
  });
});

describe("商户详情信息墙 UI", () => {
  it("右侧详情栏加载管理组件", () => {
    expect(detailPage).toContain("MerchantCompanyWallPanel");
    expect(detailPage).toContain("merchantId={merchant.id}");
  });

  it("支持上传、编辑、隐藏/公开、排序和删除", () => {
    expect(wallPanel).toContain("uploadCompanyWallPhoto");
    expect(wallPanel).toContain("updateCompanyWallPhoto");
    expect(wallPanel).toContain("reorderCompanyWallPhotos");
    expect(wallPanel).toContain("deleteCompanyWallPhoto");
    expect(wallPanel).toContain("前台展示");
  });
});
