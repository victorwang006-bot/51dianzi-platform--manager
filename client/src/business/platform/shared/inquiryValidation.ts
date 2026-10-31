export const QUICK_INQUIRY_PART_NUMBER_MAX_LENGTH = 64;
export const QUICK_INQUIRY_COMPANY_NAME_MAX_LENGTH = 100;
export const QUICK_INQUIRY_QUANTITY_MAX_LENGTH = 12;
export const QUICK_INQUIRY_QUANTITY_PATTERN = /^[1-9]\d{0,11}$/;

/**
 * 完整型号允许字母、数字及行业常见分隔符：- _ . / +
 * 服务端使用不区分大小写校验；前端录入时统一转为大写。
 */
export const QUICK_INQUIRY_PART_NUMBER_PATTERN = /^[A-Z0-9._+/\-]+$/i;

export function normalizeQuickInquiryPartNumber(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9._+/\-]/g, "")
    .slice(0, QUICK_INQUIRY_PART_NUMBER_MAX_LENGTH);
}

export function normalizeQuickInquiryQuantity(value: string): string {
  return value
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, QUICK_INQUIRY_QUANTITY_MAX_LENGTH);
}
