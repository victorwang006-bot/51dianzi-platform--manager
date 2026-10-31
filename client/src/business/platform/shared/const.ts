export const COOKIE_NAME = "app_session_v2";
export const LEGACY_COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
/** 匿名高频浏览触发登录要求的错误消息（前端据此弹出登录窗口） */
export const ANON_LIMIT_ERR_MSG = 'Login required: view limit (10003)';
/**
 * 账号每日查询配额超限提示（搜索 + BOM 配单合计）。
 *
 * 用中文而非错误码：这是正常用户也可能碰到的限制，
 * 文案会直接展示给他，必须能看懂发生了什么。
 * 放在 shared 是为了让前端能按同一常量识别，避免两处硬编码漂移。
 */
export const DAILY_QUOTA_ERR_MSG = '今日查询次数已达上限，请明日再试。如需更高额度请联系客服。';

// One-time nonce cookie that binds an OAuth login to the browser that started
// it. The `__Host-` prefix forces the cookie host-only (Secure, Path=/, no
// Domain), so a sibling *.manus.space site cannot plant a matching value in a
// victim's browser.
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";

// `state` carries the callback redirect URI (used at token exchange) plus the
// CSRF nonce. Defined here so the client encoder and server decoder never drift.
export type OAuthState = { redirectUri: string; nonce?: string };

export const encodeOAuthState = (state: OAuthState): string =>
  btoa(JSON.stringify(state));

export const decodeOAuthState = (state: string): OAuthState => {
  let decoded: string;
  try {
    decoded = atob(state);
  } catch {
    // Malformed base64 (e.g. attacker-supplied garbage). Return no nonce so the
    // callback's CSRF guard rejects it with 403 — never throw, since the caller
    // runs outside the request handler's try/catch.
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
    // Legacy links: `state` was a bare base64(redirectUri) with no nonce.
  }
  return { redirectUri: decoded };
};
