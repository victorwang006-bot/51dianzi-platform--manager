export const ADMIN_ROLES = ["super_admin", "merchant_mgr"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "materials.read",
  "materials.write",
  "merchants.read",
  "merchants.write",
  "messages.read",
  "messages.write",
  "orders.read",
  "admins.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  /** 普通用户只管理自己销售范围内的商户，并查看关联订单。 */
  merchant_mgr: ["merchants.read", "merchants.write", "orders.read"],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function hasAdminPermission(
  role: AdminRole | string | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!isAdminRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
