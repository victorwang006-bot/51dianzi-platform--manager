export const HK_ENTERPRISE_REGISTRATION_IDENTIFIER_PATTERN = /^HK:\d{8}$/;

/**
 * HK enterprise identity is a stable namespaced BRN, not a credit code.  The
 * eight digits are intentionally retained verbatim so a leading zero cannot be
 * lost through numeric coercion.
 */
export function normalizeHkEnterpriseRegistrationIdentifier(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!HK_ENTERPRISE_REGISTRATION_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error("香港企业标识必须为 HK: 加 8 位商业登记号码 BRN");
  }
  return normalized;
}

export function isHkEnterpriseRegistrationIdentifier(value: unknown): value is string {
  return typeof value === "string" && HK_ENTERPRISE_REGISTRATION_IDENTIFIER_PATTERN.test(value.trim().toUpperCase());
}

export type EnterpriseRegistrationIdentity =
  | { kind: "CN"; creditCode: string }
  | { kind: "HK"; registrationIdentifier: string };
