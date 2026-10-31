export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RESERVED_EXACT = new Set(["admin", "administrator", "root", "system", "support"]);
const RESERVED_PREFIXES = ["service_", "system_", "admin_"];

/**
 * 登录用户名采用 NFKC 归一化并去除首尾空格。
 * 只允许稳定的 ASCII 字符，避免全角字符、不可见字符和同形字符造成登录混淆。
 */
export function normalizeLoginUsername(value: string): string {
  return String(value || "").normalize("NFKC").trim();
}

export function usernameValidationMessage(value: string): string | null {
  const username = normalizeLoginUsername(value);
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return `用户名需为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 位`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "用户名仅支持字母、数字、下划线、点和短横线";
  }
  const normalized = username.toLowerCase();
  if (RESERVED_EXACT.has(normalized) || RESERVED_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return "该用户名为系统保留名称，请更换";
  }
  return null;
}

export function assertValidLoginUsername(value: string): string {
  const username = normalizeLoginUsername(value);
  const message = usernameValidationMessage(username);
  if (message) throw new Error(message);
  return username;
}
