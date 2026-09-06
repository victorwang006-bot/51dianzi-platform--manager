const exactPageLabels: Readonly<Record<string, string>> = {
  "/": "首页",
  "/search": "搜索结果",
  "/model-alternative": "稳定可靠的型号替代推荐",
  "/auth": "登录",
  "/account": "个人中心",
  "/cart": "购物车",
  "/orders": "订单中心",
  "/crm-apply": "开通 ERP 工作台",
  "/publish": "发布库存",
  "/inventory": "我的库存",
  "/company": "企业信息",
  "/profile": "我的信息",
  "/add-user": "用户与权限",
  "/inbound": "入库管理",
  "/outbound": "销售订单",
  "/stock-board": "库存看板",
  "/chat": "聊一聊",
  "/demand-center": "需求中心",
  "/demand-publish": "发布需求",
  "/demand-quotes": "收到的报价",
  "/data-hub": "数据通",
  "/data-tong": "数据通",
  "/recommendations": "今日推荐",
  "/forum": "51论坛",
  "/bom": "BOM快速配单",
  "/register-agreement": "用户协议",
  "/privacy-policy": "隐私政策",
  "/contract-template": "合同模板",
  "/404": "页面不存在",
};

const prefixPageLabels: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ["/product/", "商品详情"],
  ["/company/", "公司详情"],
  ["/publish/", "编辑库存"],
  ["/orders/", "订单详情"],
];

/**
 * 将网站访问统计里的路由转换为前台实际使用的中文页面名。
 * 未知路径仍显示原路径，确保新页面上线后不会被误归类或隐藏。
 */
export function sitePathLabel(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "未知页面";
  const pathname = raw.split(/[?#]/, 1)[0] || "/";
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = exactPageLabels[normalized];
  if (exact) return exact;
  const prefixed = prefixPageLabels.find(([prefix]) => normalized.startsWith(prefix));
  return prefixed?.[1] || raw;
}

export const SITE_PAGE_LABELS = exactPageLabels;
