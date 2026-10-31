export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "qwerty123",
  "qwertyuiop",
  "abc12345",
  "11111111",
  "00000000",
  "88888888",
  "iloveyou",
  "admin123",
]);

/**
 * 统一密码策略：优先长度与可记忆性，不强制字符种类组合。
 * 返回 null 表示通过，否则返回可直接展示给用户的原因。
 */
export function passwordPolicyError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return `密码至少需要 ${PASSWORD_MIN_LENGTH} 位`;
  if (length > PASSWORD_MAX_LENGTH) return `密码最多 ${PASSWORD_MAX_LENGTH} 位`;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "该密码过于常见，请换一个更安全的密码";
  if (/^(.)\1+$/.test(password)) return "密码不能全部使用相同字符";
  return null;
}

export function assertPasswordPolicy(password: string): void {
  const error = passwordPolicyError(password);
  if (error) throw new Error(error);
}
