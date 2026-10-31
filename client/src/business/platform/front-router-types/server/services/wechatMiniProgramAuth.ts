/**
 * 微信小程序登录：临时 code → openid。
 *
 * ## 与支付凭证的区别（易混淆，务必分清）
 *
 * 支付走商户证书 + 私钥做 API v3 签名；
 * 登录走 AppID + AppSecret 调 jscode2session。
 * 两者是不同凭证，不可互代。生产此前只配了支付凭证，
 * AppSecret 需另行从微信公众平台获取（开发管理 → 开发设置）。
 *
 * ## code 的一次性与时效
 *
 * wx.login 返回的 code **只能用一次且 5 分钟内有效**。
 * 因此这里不做任何重试：同一 code 重试必然收到 40163（code been used），
 * 反而会把「网络抖动」这种可恢复错误变成「凭证失效」这种不可恢复错误，
 * 让用户看到莫名其妙的失败。正确做法是让小程序端重新 wx.login 取新 code。
 */
import { ENV } from "../_core/env";

/** 微信登录不可用时的统一提示（便于前端识别与展示） */
export const WECHAT_LOGIN_UNAVAILABLE = "微信登录暂未开通，请使用手机号登录";

/** jscode2session 成功返回 */
export type WechatSessionResult = {
  openid: string;
  /** 开放平台唯一标识；小程序未绑定开放平台时微信不返回此字段 */
  unionId?: string;
};

/** 微信登录是否已配置齐全 */
export function isWechatMiniProgramLoginConfigured(): boolean {
  return Boolean(ENV.wechatPayMiniProgramAppId && ENV.wechatMiniProgramAppSecret);
}

/**
 * 把微信返回的错误码转成对用户有意义的中文提示。
 *
 * 直接把微信原文抛给用户没有意义（如 "invalid code, rid: 68a3..."），
 * 而这些码的处置方式完全不同：40163 应让用户重试，
 * 40125 是服务端配置错了、重试一万次也不会好。
 */
function describeWechatError(errcode: number, errmsg: string): string {
  switch (errcode) {
    case 40029:
    case 40163:
      // code 无效或已被使用：小程序端需重新 wx.login 取新 code
      return "登录凭证已失效，请重新进入小程序登录";
    case 40125:
    case 40001:
      // AppSecret 错误：配置问题，用户重试无用
      console.error("[WechatLogin] AppSecret 配置错误，请核对环境变量", { errcode, errmsg });
      return WECHAT_LOGIN_UNAVAILABLE;
    case 45011:
      return "登录过于频繁，请稍后再试";
    case -1:
      return "微信服务繁忙，请稍后再试";
    default:
      console.error("[WechatLogin] 未预期的微信错误", { errcode, errmsg });
      return "微信登录失败，请稍后再试或使用手机号登录";
  }
}

/**
 * 用小程序临时 code 换取 openid。
 *
 * @throws 配置缺失或微信返回错误时抛出面向用户的中文错误
 */
export async function exchangeWechatCode(code: string): Promise<WechatSessionResult> {
  if (!isWechatMiniProgramLoginConfigured()) {
    throw new Error(WECHAT_LOGIN_UNAVAILABLE);
  }

  const url = new URL(ENV.wechatMiniProgramLoginEndpoint);
  url.searchParams.set("appid", ENV.wechatPayMiniProgramAppId);
  url.searchParams.set("secret", ENV.wechatMiniProgramAppSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  /*
   * 必须设超时：微信接口偶发长时间无响应，
   * 不设超时会让 tRPC 请求一直挂着，用户界面卡在登录中且无从判断。
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let payload: any;
  try {
    const res = await fetch(url, { signal: controller.signal });
    payload = await res.json();
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.error("[WechatLogin] 调用 jscode2session 失败", error);
    throw new Error(aborted ? "微信登录超时，请重试" : "微信登录失败，请稍后再试");
  } finally {
    clearTimeout(timer);
  }

  /*
   * 微信的失败响应 HTTP 状态码仍是 200，错误只体现在响应体的 errcode 上，
   * 因此不能靠 res.ok 判断成功与否。
   */
  const errcode = Number(payload?.errcode ?? 0);
  if (errcode !== 0) {
    throw new Error(describeWechatError(errcode, String(payload?.errmsg ?? "")));
  }

  const openid = typeof payload?.openid === "string" ? payload.openid.trim() : "";
  if (!openid) {
    console.error("[WechatLogin] 微信返回成功但缺少 openid", payload);
    throw new Error("微信登录失败，请稍后再试");
  }

  const unionId = typeof payload?.unionid === "string" ? payload.unionid.trim() : "";
  return unionId ? { openid, unionId } : { openid };
}
