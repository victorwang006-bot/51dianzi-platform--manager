import type { AdminUser } from "../drizzle/schema";

/**
 * Deliberately allow-listed administrative account shape for browser responses.
 * Keep credential fields out of this type: adding a sensitive database column
 * cannot expose it accidentally through `...row` in a router.
 */
export type AdminUserDto = Pick<
  AdminUser,
  | "id"
  | "userId"
  | "username"
  | "displayName"
  | "email"
  | "phone"
  | "adminRole"
  | "status"
  | "mfaEnabled"
  | "lastLoginAt"
  | "createdAt"
  | "updatedAt"
>;

export function toAdminUserDto(user: AdminUser): AdminUserDto {
  return {
    id: user.id,
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    adminRole: user.adminRole,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
