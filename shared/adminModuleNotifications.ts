export const ADMIN_NOTIFICATION_MODULES = [
  "merchants",
  "orders",
  "reviews",
  "portalUsers",
] as const;

export type AdminNotificationModule = (typeof ADMIN_NOTIFICATION_MODULES)[number];

export const ADMIN_NOTIFICATION_MODULE_BY_PATH: Record<string, AdminNotificationModule> = {
  "/merchants": "merchants",
  "/orders": "orders",
  "/reviews": "reviews",
  "/portal-users": "portalUsers",
};
