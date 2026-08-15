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

  it("保留商户筛选、ERP操作、发信、详情和分页功能", () => {
    for (const text of [
      "搜索公司名称 / 商户编号",
      "全部状态",
      "通过（开通 ERP）",
      "暂停 ERP",
      "发信给客户",
      "商户详情",
      "Pagination",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("trpc.merchant.review.useMutation");
    expect(page).toContain("trpc.merchant.setCrmStatus.useMutation");
    expect(page).toContain("trpc.merchant.sendMessage.useMutation");
  });
});
