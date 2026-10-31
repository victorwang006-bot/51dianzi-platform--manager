type AccountIdentity = {
  username?: string | null;
  name?: string | null;
} | null | undefined;

/** 展示账号身份时优先使用可修改的登录用户名，真实姓名仍保留其独立用途。 */
export function accountDisplayName(user: AccountIdentity, fallback = "用户"): string {
  return user?.username?.trim() || user?.name?.trim() || fallback;
}
