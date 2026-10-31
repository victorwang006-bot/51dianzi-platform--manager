/** 库存表单选项常量（来自原型 51dianzi_publish_inventory.html） */
export const TAX_RATE = 0.13;

export const CATEGORIES = [
  "芯片IC", "电容", "MLCC", "电阻", "二极管", "三极管", "IGBT",
  "MOSFET", "晶振", "连接器", "电感", "模组", "传感器", "其他",
] as const;

export const PACKAGES = [
  "0201", "0402", "0603", "0805", "1206", "SOT-23", "SOP-8", "SOIC-16",
  "QFN-32", "LQFP-48", "QFP-64", "BGA", "TO-220", "TO-247", "DIP-8", "其他",
] as const;

/** 认证等级中文映射 */
export const CERT_LEVEL_LABELS: Record<string, string> = {
  pending: "待审核",
  certified: "已认证",
  premium: "高级认证",
};

/** 库存状态中文映射 */
export const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  offshelf: "已下架",
};

/** Mock 万能短信验证码 */
export const MOCK_SMS_CODE = "000000";
