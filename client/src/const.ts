import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
// 构造 Manus OAuth 授权 URL 并写入一次性 nonce cookie（副作用：会覆盖旧 nonce）
export const buildLoginUrl = (): string => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce });
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");
  return url.toString();
};

// 判断当前是否运行在 iframe（如 Manus 预览面板）中
export const isInIframe = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // 跨域访问 window.top 抛错说明必然在 iframe 中
  }
};

export const startLogin = () => {
  const target = buildLoginUrl();
  if (isInIframe()) {
    // iframe 中跨域导航可能被静默拦截，且授权页可能拒绝在 iframe 内渲染。
    // 在用户手势调用栈内同步 window.open，不会被弹窗拦截器阻止。
    const opened = window.open(target, "_blank", "noopener");
    if (opened) return;
    // window.open 被拦截时退回当前窗口跳转
  }
  window.location.href = target;
};
