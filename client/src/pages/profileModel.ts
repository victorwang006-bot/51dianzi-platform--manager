export const PROFILE_QUERY_ROOT = "personal-center-self";

export function personalCenterIdentity(user: {
  id: number;
  username?: string | null;
  openId?: string | null;
  hasNativeAdminAccount?: boolean;
}): string {
  return JSON.stringify([
    user.hasNativeAdminAccount ? "native-admin" : "session",
    user.id,
    user.username ?? null,
    user.openId ?? null,
  ]);
}

export function personalCenterQueryPrefix(identity: string, epoch: number) {
  return [PROFILE_QUERY_ROOT, identity, epoch] as const;
}

export function currentShanghaiMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}`;
}

export function validMonth(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function passwordError(password: {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}): string | null {
  if (!password.oldPassword) return "请输入原密码";
  if (password.newPassword.length < 8) return "新密码至少8个字符";
  if (password.newPassword.length > 128) return "新密码不能超过128个字符";
  if (password.oldPassword === password.newPassword) return "新密码不能与原密码相同";
  if (password.newPassword !== password.confirmPassword) return "两次输入的新密码不一致";
  return null;
}

export function normalizeMainlandPhone(value: string): string | null {
  const phone = value.trim().replace(/^(?:\+86|0086)/, "");
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}

export function roleLabel(role: string | null | undefined): string {
  const labels: Record<string, string> = {
    super_admin: "超级管理员",
    merchant_mgr: "普通用户",
    operation: "平台运营",
    customer_svc: "客服/售后",
    risk_control: "风控审核",
    finance: "财务结算",
    auditor: "审计人员",
  };
  return role ? labels[role] ?? role : "未设置";
}

export function presentValue(value: string | null | undefined): string {
  return value?.trim() || "未设置";
}

/** Keep authoritative decimal precision; never turn unavailable values into zero. */
export function decimalAmount(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return "暂无数据";
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function messageOf(error: unknown, fallback = "请求失败，请稍后重试"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
