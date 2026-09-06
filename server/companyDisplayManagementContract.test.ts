import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");
const routers = read("server/routers.ts");
const database = read("server/db.ts");
const detailPage = read("client/src/pages/MerchantDetail.tsx");
const wallPanel = read(
  "client/src/components/admin/MerchantCompanyWallPanel.tsx"
);

describe("后台首页图与搜索图设置", () => {
  it("写接口先校验销售范围并限制照片为本企业已公开素材", () => {
    const start = routers.indexOf(
      "setCompanyWallDisplay: merchantWriteProcedure"
    );
    const end = routers.indexOf("uploadCompanyWallPhoto:", start);
    const route = routers.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(route).toContain("await assertMerchantInSalesScope(ctx, input.id)");
    expect(route).toContain('kind: z.enum(["home", "search"])');
    expect(route).toContain("expectedPhotoId");
    expect(database).toContain("AND status = 'approved' AND deletedAt IS NULL");
    expect(database).toContain("COMPANY_DISPLAY_PHOTO_INVALID");
  });

  it("首页图和搜索图分别保存，搜索图保持4比3裁切参数", () => {
    expect(database).toContain("SET homeCoverPhotoId = ${input.photoId}");
    expect(database).toContain("SET avatarPhotoId = ${input.photoId}");
    expect(database).toContain("avatarDisplayMode =");
    expect(database).toContain("avatarCropZoom =");
    expect(database).toContain("avatarCropX =");
    expect(database).toContain("avatarCropY =");
    expect(wallPanel).toContain('className="aspect-[16/9]');
    expect(wallPanel).toContain('className="aspect-[4/3]');
  });

  it("并发修改被拒绝，两个用途分别写不可变审计", () => {
    expect(database).toContain("currentPhotoId !== input.expectedPhotoId");
    expect(database).toContain("COMPANY_DISPLAY_PHOTO_CHANGED");
    expect(routers).toContain("展示图已被其他员工修改，请刷新后重试");
    expect(database).toContain('"merchant.company_wall.home_cover"');
    expect(database).toContain('"merchant.company_wall.search_display"');
    expect(database).toContain("tx.insert(auditLogs)");
  });

  it("照片墙位于商户详情主栅格之外的全宽区域", () => {
    const gridEnd = detailPage.indexOf(
      "      </div>\n\n      {/* 公司照片墙：全宽展示"
    );
    const wall = detailPage.indexOf(
      "<MerchantCompanyWallPanel merchantId={merchant.id} />"
    );
    expect(gridEnd).toBeGreaterThan(-1);
    expect(wall).toBeGreaterThan(gridEnd);
    expect(detailPage).toContain('className="mt-6"');
  });
});
