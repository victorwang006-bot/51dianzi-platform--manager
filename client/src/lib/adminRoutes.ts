export const DEFAULT_ADMIN_PATH = "/workbench/channel-inventory";

/** 仅允许站内绝对路径，阻止外部地址与登录页循环回跳。 */
export function normalizeAdminReturnPath(rawPath: string | null | undefined): string {
  const value = (rawPath ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return DEFAULT_ADMIN_PATH;
  const pathname = value.split(/[?#]/)[0];
  if (pathname === "/login" || pathname === "/") return DEFAULT_ADMIN_PATH;
  return value;
}

export function createAdminLoginPath(pathname: string, search = ""): string {
  const target = normalizeAdminReturnPath(`${pathname}${search}`);
  return `/login?next=${encodeURIComponent(target)}`;
}

export function readAdminLoginReturnPath(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return normalizeAdminReturnPath(params.get("next"));
}
