/** 唯一平台物料码：固定前缀 + 8 位无业务语义全局流水。 */
export const PLATFORM_MATERIAL_CODE_PATTERN = /^51E-\d{8}$/;
export const PLATFORM_MATERIAL_SEQUENCE_KEY = "platform_material";
export const PLATFORM_MATERIAL_SEQUENCE_MAX = 99_999_999;

export function formatMaterialNo(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > PLATFORM_MATERIAL_SEQUENCE_MAX) {
    throw new Error("MATERIAL_SEQUENCE_OUT_OF_RANGE");
  }
  return `51E-${String(sequence).padStart(8, "0")}`;
}
