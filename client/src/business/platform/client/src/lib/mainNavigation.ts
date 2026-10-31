/** 员工后台为独立入口，前台导航和旧业务页面不得跳转到该域名。 */
export const ADMIN_WORKBENCH_PATH = "https://admin.51dianzi.com/workbench";

export const MAIN_NAVIGATION_ITEMS = [
  { key: "home", label: "首页", href: "/", access: "public" },
  { key: "orders", label: "订单中心", href: "/orders", access: "authenticated" },
  { key: "chat", label: "聊一聊", href: "/chat", access: "authenticated" },
  { key: "data-hub", label: "数据通", href: "/data-hub", access: "public" },
  { key: "demand", label: "需求中心", href: "/demand-center", access: "public" },
  { key: "recommendations", label: "今日推荐", href: "/recommendations", access: "public" },
  { key: "forum", label: "51论坛", href: "/forum", access: "public" },
  { key: "crm", label: "企业工作台", href: "/publish", access: "crm" },
  { key: "account", label: "个人中心", href: "/account", access: "authenticated" },
] as const;

export type MainNavigationItem = (typeof MAIN_NAVIGATION_ITEMS)[number];
export type MainNavigationKey = MainNavigationItem["key"];

/** 已移走的旧业务路径只用于确认站内回退，不能再产生员工后台的跳转地址。 */
const LEGACY_ENTERPRISE_WORKBENCH_PATHS = new Set([
  "/company", "/profile", "/inbound", "/stock-board", "/customers", "/customers/new",
  "/customer-demands", "/sales-orders", "/procurement/demands", "/procurement/orders",
  "/procurement/orders/quote", "/procurement/orders/accepted", "/procurement/orders/create",
]);

/**
 * 前台给用户使用：已移走业务的旧书签只回本站保留的企业工作台。
 * 后台员工直接在独立后台登录，不借前台导航或旧路径中转。
 * 不携带任何旧业务查询、身份、租户、会话或凭据参数；原资格/选企/细权仍由目标页校验。
 * 保留功能路径与未登记路径返回 null，不猜测其目的地。
 */
export function resolveLegacyEnterpriseWorkbenchHref(
  pathname: string,
  _search = "",
): string | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (LEGACY_ENTERPRISE_WORKBENCH_PATHS.has(path) || /^\/customers\/[^/]+$/.test(path)) {
    return "/publish";
  }
  return null;
}
