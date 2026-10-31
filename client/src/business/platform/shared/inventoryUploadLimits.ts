export const INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH = 5;
export const INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH = 255;
/* 备注上限与存储层 NOTE_MAX_LENGTH(50) 保持一致：此前 12 字符过严，
 * 商户常见的「类型_型号/参数」式备注普遍超过 12 字，导致导入整行被跳过。 */
export const INVENTORY_UPLOAD_NOTE_MAX_LENGTH = 50;

export type InventoryFlexibleImportFieldKey =
  | "leadTime"
  | "warehouseAddress"
  | "note";

export type InventoryImportFixedValues = Partial<
  Record<InventoryFlexibleImportFieldKey, string>
>;
