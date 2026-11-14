import type { StaffAdminAccount } from "./staffPermissionModel";

export type StaffStatus = "active" | "disabled" | "locked";
export type StaffStatusTarget = {
  id: number;
  username: string;
  name: string;
  expectedStatus: StaffStatus;
  status: "active" | "disabled";
};
export type StaffStatusInput = {
  id: number;
  status: "active" | "disabled";
  expectedStatus: StaffStatus;
  reason: string;
};

/** Conservative client hint only; the server locks the full effective-super set. */
export function staffStatusAction(
  account: StaffAdminAccount | undefined,
  actorId: number | null,
  canManage: boolean,
  knownActiveSuperCount: number | null
): { label: "停用" | "启用"; allowed: boolean; reason: string | null; target: StaffStatusTarget | null } | null {
  if (!account || !canManage) return null;
  const label = account.status === "active" ? "停用" : "启用";
  let reason: string | null = null;
  if (account.archive) reason = "离职归档账号不能启用或修改";
  else if (account.status === "locked") reason = "锁定账号不能通过普通启用解锁";
  else if (account.status !== "active" && account.status !== "disabled") reason = "账号状态未知，请刷新核验";
  else if (!actorId) reason = "请重新登录核验操作者";
  else if (account.id === actorId && account.status === "active") reason = "不能停用当前登录的账号";
  else if (account.adminRole === "super_admin" && account.status === "active" && (knownActiveSuperCount === null || knownActiveSuperCount <= 1))
    reason = "尚未核验另一个有效超级管理员，不能停用";
  return {
    label,
    allowed: reason === null,
    reason,
    target: reason === null ? {
      id: account.id,
      username: account.username,
      name: account.displayName || account.username,
      expectedStatus: account.status as StaffStatus,
      status: account.status === "active" ? "disabled" : "active",
    } : null,
  };
}
