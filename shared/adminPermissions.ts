/**
 * 后台角色枚举。
 *
 * 生产库实际仅使用两档：super_admin（1 个）与 merchant_mgr（5 个）；
 * 其余五个角色为历史遗留、零使用。此处有意保留它们：
 * 删除枚举属于语义变更而非功能还原，且会打破现有权限体系测试；
 * 而 hasAdminPermission 对未定义角色返回 false，保留也不会造成误授权。
 */
export const ADMIN_ROLES = [
  "super_admin",
  "operation",
  "merchant_mgr",
  "customer_svc",
  "risk_control",
  "finance",
  "auditor",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "materials.read",
  "materials.write",
  "merchants.read",
  "merchants.write",
  "messages.read",
  "messages.write",
  "orders.read",
  /** 维护本人个人信息与登录密码（「个人信息」菜单的准入依据） */
  "profile.manage",
  "admins.manage",
  /**
   * 查看异常日志（服务器错误、攻击探测、认证异常）。
   * 仅授予 super_admin：日志含访客 IP、UserAgent、错误堆栈等敏感信息，
   * 按最小权限原则不下放给销售角色（merchant_mgr）。
   */
  "logs.read",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  operation: [
    "materials.read",
    "materials.write",
    "merchants.read",
    "merchants.write",
    "messages.read",
    "messages.write",
    "orders.read",
    "profile.manage",
  ],
  // 普通用户：仅商户管理、订单中心，并按销售权限限制可见数据范围
  merchant_mgr: ["merchants.read", "merchants.write", "orders.read", "profile.manage"],
  customer_svc: ["merchants.read", "messages.read", "messages.write", "orders.read", "profile.manage"],
  risk_control: ["merchants.read", "merchants.write", "orders.read", "profile.manage"],
  finance: ["merchants.read", "orders.read", "profile.manage"],
  auditor: ["materials.read", "merchants.read", "messages.read", "orders.read", "profile.manage"],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function hasAdminPermission(
  role: AdminRole | string | null | undefined,
  permission: AdminPermission
): boolean {
  if (!isAdminRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
