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
  "admins.manage",
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
  ],
  merchant_mgr: ["merchants.read", "merchants.write"],
  customer_svc: ["merchants.read", "messages.read", "messages.write"],
  risk_control: ["merchants.read", "merchants.write"],
  finance: ["merchants.read"],
  auditor: ["materials.read", "merchants.read", "messages.read"],
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
