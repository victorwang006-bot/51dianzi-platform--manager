import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(
  path.resolve(__dirname, "../client/src/pages/Merchants.tsx"),
  "utf8",
);

describe("后台商户管理顶部横向滚动契约", () => {
  it("在表格上方提供与用户管理一致的加粗滚动轨道和左右按钮", () => {
    expect(page).toContain("merchant-table-region");
    expect(page).toContain("merchant-top-scroll");
    expect(page).toContain("左右拖动查看全部商户字段");
    expect(page).toContain('aria-label="向左移动商户表格"');
    expect(page).toContain('aria-label="向右移动商户表格"');
    expect(page).toContain('aria-label="商户表格横向滚动"');
    expect(page).toContain("scrollbar-color: #6f8fa8 #dce7ef");
    expect(page).toContain("min-width: 72px");
  });

  it("顶部滚动轨道与真实商户表格双向同步并响应尺寸变化", () => {
    expect(page).toContain("useLayoutEffect");
    expect(page).toContain("merchantTableScrollRef");
    expect(page).toContain("merchantTopScrollRef");
    expect(page).toContain("new ResizeObserver(measure)");
    expect(page).toContain('addEventListener("scroll", syncTopScroll');
    expect(page).toContain('addEventListener("scroll", syncTableScroll');
    expect(page).toContain('scrollBy({ left: distance, behavior: "smooth" })');
    expect(page).toContain("setHasHorizontalOverflow(nextWidth > tableScrollElement.clientWidth + 1)");
  });

  it("隐藏原底部滚动条但保留真实表格横向滚动能力", () => {
    expect(page).toContain('className="merchant-table-scroll overflow-x-auto"');
    expect(page).toContain(".merchant-table-scroll");
    expect(page).toContain("scrollbar-width: none");
    expect(page).toContain(".merchant-table-scroll::-webkit-scrollbar");
    expect(page).toContain("display: none");
    expect(page).not.toContain('<div className="overflow-x-auto">');
  });

  it("保留商户搜索、ERP操作、发信、详情和分页功能", () => {
    for (const text of [
      "搜索公司名称 / 商户编号",
      "通过（开通 ERP）",
      "暂停 ERP",
      "发信给客户",
      "商户详情",
      "Pagination",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("trpc.merchant.setCrmStatus.useMutation");
    expect(page).toContain("trpc.merchant.sendMessage.useMutation");
  });

  /*
   * 入驻审核（merchants.status）已于 2026-08-20 下线。
   *
   * 下线依据：该字段在服务端仅用于列表筛选（server/db.ts:608），
   * 无任何业务逻辑读取；ERP 权限判定（getCrmAccessByCreditCode）
   * 只看 crmStatus。线上 29 家商户中 23 家停在「待审核」，
   * 但 ERP 均已开通且正常经营 —— 说明该状态不构成任何准入约束，
   * 摆在界面上反而让人误以为这些商户未通过审核、不能用。
   *
   * 本用例锁定下线结果。若日后需重启入驻审核，应先明确它与
   * ERP 开通的先后关系及真实约束力，再同步修改本用例，
   * 不要直接删除断言了事。
   *
   * 服务端 merchant.review 接口、merchants.status 字段与筛选入参均保留，
   * 本次仅下线界面展示。
   */
  it("入驻审核已下线：不再展示状态列、状态筛选与审核入口", () => {
    expect(page).not.toContain("merchantStatusMap");
    expect(page).not.toContain("trpc.merchant.review.useMutation");
    expect(page).not.toContain("全部状态");
    expect(page).not.toContain('<SelectItem value="pending">待审核</SelectItem>');
    expect(page).not.toContain("<th>状态</th>");
  });
});
