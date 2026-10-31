/**
 * 微信小程序客户端识别（服务端与小程序端共用）
 *
 * ## 为什么需要这个模块
 *
 * 反爬 UA 守卫（server/antiScrape.ts）规定「空 UA 直接拦截」，
 * 且黑名单含 okhttp —— 而微信小程序 wx.request 在部分环境下 UA 为空，
 * Android 端底层网络库正是 okhttp。两条规则任一命中，
 * 小程序对 /api/ 的全部请求都会返回 403。
 *
 * 团队踩过同类坑：微信支付回调因「微信服务器不带浏览器 UA」被拦，
 * 解决方式是把回调路由注册在反爬中间件之前
 * （见 server/_core/index.ts 的注释）。
 *
 * ## 为什么不照抄回调的做法
 *
 * 支付回调是**单一固定路径**，整条前置没有副作用；
 * 而小程序要访问 /api/trpc 下的**全部接口**，
 * 整条前置等于对所有接口关闭反爬，
 * 把此前专门做的防爬工作全部作废。
 *
 * 因此改为：在 UA 守卫内部识别小程序专属请求头后放行，
 * 反爬对其他客户端依然生效。
 *
 * ## 安全边界（重要，不要误解此模块的作用）
 *
 * 这个请求头**不是身份凭证**，只是「声明我是小程序」的标识。
 * 它可被任何人伪造，因此：
 *
 * - 它只用于跳过 **UA 黑名单**这一层
 * - **不跳过** IP 限流（rateLimitMiddleware 照常生效）
 * - **不跳过** 匿名浏览频控与每日配额
 * - **不赋予**任何数据权限，鉴权仍走 Bearer token
 *
 * 换言之最坏情况是爬虫带上这个头绕过 UA 黑名单，
 * 但仍被限流、配额、鉴权三道防线拦住。
 * UA 黑名单本身也只是「拦掉零成本拓取」的第一道门，
 * 从来不是主要防线。
 */

/** 小程序请求必带的头名（小写，Node 端 req.headers 已统一为小写） */
export const MINI_PROGRAM_HEADER = "x-51dianzi-client";

/** 头的期望取值 */
export const MINI_PROGRAM_CLIENT_ID = "weapp";

/**
 * 判断请求头是否来自小程序客户端。
 *
 * 只接受精确匹配（去空白、忽略大小写），不做模糊包含判断：
 * 模糊匹配会让 "weapp-scraper" 这类取值也被放行。
 */
export function isMiniProgramClient(
  headerValue: string | string[] | undefined,
): boolean {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === MINI_PROGRAM_CLIENT_ID;
}
