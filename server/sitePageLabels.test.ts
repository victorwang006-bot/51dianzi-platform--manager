import { describe, expect, it } from "vitest";
import { SITE_PAGE_LABELS, sitePathLabel } from "../client/src/lib/sitePageLabels";

describe("网站热门页面中文名称", () => {
  it("使用与前台网站一致的主要导航和ERP页面名称", () => {
    expect(sitePathLabel("/")).toBe("首页");
    expect(sitePathLabel("/search")).toBe("搜索结果");
    expect(sitePathLabel("/publish")).toBe("发布库存");
    expect(sitePathLabel("/orders")).toBe("订单中心");
    expect(sitePathLabel("/inventory")).toBe("我的库存");
    expect(sitePathLabel("/demand-center")).toBe("需求中心");
    expect(sitePathLabel("/forum")).toBe("51论坛");
    expect(sitePathLabel("/data-hub")).toBe("数据通");
    expect(sitePathLabel("/recommendations")).toBe("今日推荐");
    expect(sitePathLabel("/account")).toBe("个人中心");
  });

  it("识别详情路由、查询参数和末尾斜杠", () => {
    expect(sitePathLabel("/product/123?from=search")).toBe("商品详情");
    expect(sitePathLabel("/company/:id")).toBe("公司详情");
    expect(sitePathLabel("/orders/20260907")).toBe("订单详情");
    expect(sitePathLabel("/inventory/")).toBe("我的库存");
    expect(sitePathLabel("/forum?notice=1")).toBe("51论坛");
  });

  it("覆盖前台全部公开和ERP路由，未知页面保留原路径", () => {
    for (const path of [
      "/model-alternative", "/auth", "/cart", "/crm-apply", "/company", "/profile",
      "/add-user", "/inbound", "/outbound", "/stock-board", "/chat", "/demand-publish",
      "/demand-quotes", "/data-tong", "/bom", "/register-agreement", "/privacy-policy",
      "/contract-template", "/404",
    ]) {
      expect(SITE_PAGE_LABELS[path], path).toBeTruthy();
      expect(sitePathLabel(path), path).not.toBe(path);
    }
    expect(sitePathLabel("/new-page")).toBe("/new-page");
    expect(sitePathLabel("")).toBe("未知页面");
  });
});

console.log("site page labels passed");
