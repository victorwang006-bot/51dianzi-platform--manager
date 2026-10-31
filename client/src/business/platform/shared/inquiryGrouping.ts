/**
 * 询价型号的稳定精确键。
 *
 * 只统一全角/半角、大小写、首尾空格和连续空格；连字符、斜杠、点号等
 * 电子料号语义字符必须保留，避免把不同包装或出货形态错误合并。
 */
export function normalizeInquiryPartNumber(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 128);
}

/** 用户可读的型号快照，保留原始大小写但清理输入噪声。 */
export function displayInquiryPartNumber(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 128);
}
