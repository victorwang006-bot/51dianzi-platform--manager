const DEFAULT_ADMIN_PATH = "/";

/** 仅允许站内绝对路径，阻止 //host 与登录页循环回跳。 */
export function normalizeAdminReturnPath(rawPath: string | null | undefined): string {
  const value = (rawPath ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_ADMIN_PATH;
  const pathname = value.split("?")[0];
  if (pathname === "/login") return DEFAULT_ADMIN_PATH;
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
