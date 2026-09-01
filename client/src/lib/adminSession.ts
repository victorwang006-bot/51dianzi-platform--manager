import type { AdminPermission, AdminRole } from "@shared/adminPermissions";

export type LoginAccount = {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  adminRole: AdminRole;
  permissions?: AdminPermission[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

/**
 * 登录接口已经完成密码校验并签发 Cookie，可直接用返回账号构造 auth.me 缓存。
 * 这样路由能立即离开登录页，不必等待所有历史查询逐个失效和重新请求。
 */
export function buildAdminAuthUser(account: LoginAccount) {
  return {
    id: account.id,
    openId: `local_admin:${account.id}`,
    name: account.displayName || account.username,
    email: account.email,
    loginMethod: "password",
    role: "admin" as const,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastSignedIn: account.lastLoginAt ?? account.createdAt,
    adminRole: account.adminRole,
    permissions: account.permissions,
    username: account.username,
  };
}
