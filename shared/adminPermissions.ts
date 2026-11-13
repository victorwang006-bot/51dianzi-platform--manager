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
  "portalUsers.read",
  "portalUsers.manage",
  "messages.read",
  "messages.write",
  "orders.read",
  "analytics.read",
  /**
   * 官方渠道库存是后台自有域：不读取、不映射商户 ERP 权限。除 super_admin 外，
   * 只有员工级显式授权才可获得；团队成员/组长身份绝不自动附带这些模块权限。
   */
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
  /** 官方团队配置是系统权限，只由真实 super_admin 在服务端认可，不能下放。 */
  "officialTeams.manage",
  /**
   * 后台业务网关权限。它们只允许经受控 BFF 访问主站企业领域服务，
   * 不等同于前台企业成员权限，且绝不能由角色默认权限自动取得。
   */
  "business.context.read",
  "business.inventory.read",
  "business.inventory.write",
  "business.inquiries.read",
  "business.inquiries.write",
  "business.customers.read",
  "business.customers.write",
  "business.procurement.read",
  "business.procurement.write",
  "business.users.read",
  "business.users.write",
  "business.orders.read",
  "business.orders.write",
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

/** 超级管理员可分配给普通用户的业务模块权限；系统权限不可下放。 */
export const ASSIGNABLE_ADMIN_PERMISSIONS = [
  "materials.read",
  "materials.write",
  "merchants.read",
  "merchants.write",
  "portalUsers.read",
  "portalUsers.manage",
  "messages.read",
  "messages.write",
  "orders.read",
  "analytics.read",
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
  "business.context.read",
  "business.inventory.read",
  "business.inventory.write",
  "business.inquiries.read",
  "business.inquiries.write",
  "business.customers.read",
  "business.customers.write",
  "business.procurement.read",
  "business.procurement.write",
  "business.users.read",
  "business.users.write",
  "business.orders.read",
  "business.orders.write",
] as const satisfies readonly AdminPermission[];

export type AssignableAdminPermission =
  (typeof ASSIGNABLE_ADMIN_PERMISSIONS)[number];

export function isAssignableAdminPermission(
  value: unknown
): value is AssignableAdminPermission {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_ADMIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

/** 写权限自动补齐对应读权限；个人信息权限对所有普通后台用户固定保留。 */
export function normalizeAssignedAdminPermissions(
  values: readonly string[]
): AdminPermission[] {
  const next = new Set<AdminPermission>(
    values.filter(isAssignableAdminPermission)
  );
  if (next.has("materials.write")) next.add("materials.read");
  if (next.has("merchants.write")) next.add("merchants.read");
  if (next.has("portalUsers.manage")) next.add("portalUsers.read");
  if (next.has("messages.write")) next.add("messages.read");
  if (next.has("officialInventory.write")) next.add("officialInventory.read");
  if (next.has("officialInventory.publish")) next.add("officialInventory.read");
  if (next.has("officialInventory.note")) next.add("officialInventory.read");
  if (next.has("business.inventory.write")) next.add("business.inventory.read");
  if (next.has("business.inquiries.write")) next.add("business.inquiries.read");
  if (next.has("business.customers.write")) next.add("business.customers.read");
  if (next.has("business.procurement.write"))
    next.add("business.procurement.read");
  if (next.has("business.users.write")) next.add("business.users.read");
  if (next.has("business.orders.write")) next.add("business.orders.read");
  next.add("profile.manage");
  return Array.from(next);
}

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  operation: [
    "materials.read",
    "materials.write",
    "merchants.read",
    "merchants.write",
    "portalUsers.read",
    "portalUsers.manage",
    "messages.read",
    "messages.write",
    "orders.read",
    "analytics.read",
    "profile.manage",
  ],
  // 普通用户：仅商户管理、订单中心，并按销售权限限制可见数据范围
  merchant_mgr: [
    "merchants.read",
    "merchants.write",
    "orders.read",
    "profile.manage",
  ],
  customer_svc: [
    "merchants.read",
    "portalUsers.read",
    "portalUsers.manage",
    "messages.read",
    "messages.write",
    "orders.read",
    "profile.manage",
  ],
  risk_control: [
    "merchants.read",
    "merchants.write",
    "portalUsers.read",
    "portalUsers.manage",
    "orders.read",
    "profile.manage",
  ],
  finance: ["merchants.read", "orders.read", "profile.manage"],
  auditor: [
    "materials.read",
    "merchants.read",
    "portalUsers.read",
    "messages.read",
    "orders.read",
    "profile.manage",
  ],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" &&
    (ADMIN_ROLES as readonly string[]).includes(value)
  );
}

export function getAdminRolePermissions(
  role: AdminRole | string | null | undefined
): readonly AdminPermission[] {
  if (!isAdminRole(role)) return [];
  return ROLE_PERMISSIONS[role];
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return (
    typeof value === "string" &&
    (ADMIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * 解析用户最终权限。
 *
 * 超级管理员始终拥有全部权限；普通后台用户优先使用数据库中的用户级授权，
 * 无授权记录时回退到角色默认权限，保证旧账号升级后不会突然失去访问能力。
 */
export function resolveAdminPermissions(
  role: AdminRole | string | null | undefined,
  userPermissions?: readonly string[] | null
): readonly AdminPermission[] {
  if (role === "super_admin") return ADMIN_PERMISSIONS;
  if (userPermissions && userPermissions.length > 0) {
    // officialTeams.manage is a non-delegable system capability.  Keep this
    // defensive filter even though it is not assignable, so a stale/manual DB
    // row can never make an ordinary account a team-configuration principal.
    return userPermissions.filter(
      (permission): permission is AdminPermission =>
        permission !== "officialTeams.manage" && isAdminPermission(permission)
    );
  }
  return getAdminRolePermissions(role);
}

export function hasAdminPermission(
  role: AdminRole | string | null | undefined,
  permission: AdminPermission,
  userPermissions?: readonly string[] | null
): boolean {
  return resolveAdminPermissions(role, userPermissions).includes(permission);
}
