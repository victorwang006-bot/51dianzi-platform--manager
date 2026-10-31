/**
 * 快递公司编码映射。
 *
 * 快递100 的 `com` 参数要求传全小写拼音编码，而界面上需要展示中文名，
 * 因此这里统一维护双向映射。前后端共用，避免两处各写一份导致漂移。
 *
 * 编码取自快递100 官方编码表（api.kuaidi100.com/manager/openapi/download/kdbm.do）。
 * 若需新增快递公司，只需在此追加一项，下单表单与查询逻辑会自动生效。
 */

export type ExpressCompany = {
  /** 快递100 编码，全小写 */
  code: string;
  /** 中文名称，用于界面展示与 Excel 导出 */
  name: string;
  /**
   * 查询时是否必须提供收/寄件人电话。
   * 顺丰系与中通对此有强制要求，不传会返回 408 验证码错误。
   */
  phoneRequired?: boolean;
};

export const EXPRESS_COMPANIES: readonly ExpressCompany[] = Object.freeze([
  { code: "shunfeng", name: "顺丰速运", phoneRequired: true },
  { code: "shunfengkuaiyun", name: "顺丰快运", phoneRequired: true },
  { code: "zhongtong", name: "中通快递", phoneRequired: true },
  { code: "jd", name: "京东物流" },
  { code: "yuantong", name: "圆通速递" },
  { code: "yunda", name: "韵达速递" },
  { code: "shentong", name: "申通快递" },
  { code: "debangkuaidi", name: "德邦快递" },
  { code: "debangwuliu", name: "德邦物流" },
  { code: "jtexpress", name: "极兔速递" },
  { code: "huitongkuaidi", name: "百世快递" },
  { code: "ems", name: "EMS" },
  { code: "youzhengguonei", name: "邮政快递包裹" },
  { code: "zhongtongkuaiyun", name: "中通快运" },
  { code: "jingdongkuaiyun", name: "京东快运" },
  { code: "kuayue", name: "跨越速运" },
  { code: "annengwuliu", name: "安能物流" },
  { code: "zhaijisong", name: "宅急送" },
  { code: "tiantian", name: "天天快递" },
  { code: "cainiao", name: "菜鸟速递" },
]);

const BY_NAME = new Map(EXPRESS_COMPANIES.map(c => [c.name, c]));
const BY_CODE = new Map(EXPRESS_COMPANIES.map(c => [c.code, c]));

/** 中文名 → 快递100 编码；未收录时返回 null，调用方需自行处理 */
export function expressCodeOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  const hit = BY_NAME.get(trimmed);
  if (hit) return hit.code;
  // 兼容历史数据里可能直接存了编码的情况
  if (BY_CODE.has(trimmed.toLowerCase())) return trimmed.toLowerCase();
  return null;
}

/** 快递100 编码 → 中文名；未收录时回落为原始编码，保证界面不出现空白 */
export function expressNameOf(code: string | null | undefined): string {
  if (!code) return "";
  return BY_CODE.get(code.trim().toLowerCase())?.name ?? code;
}

/** 该快递公司查询时是否必须带电话 */
export function expressPhoneRequired(nameOrCode: string | null | undefined): boolean {
  if (!nameOrCode) return false;
  const key = nameOrCode.trim();
  const hit = BY_NAME.get(key) ?? BY_CODE.get(key.toLowerCase());
  return hit?.phoneRequired === true;
}

/** 供下单表单使用的中文名列表 */
export const EXPRESS_COMPANY_NAMES: readonly string[] = Object.freeze(
  EXPRESS_COMPANIES.map(c => c.name),
);

/**
 * 快递100 基础物流状态映射。
 *
 * 接口返回的 `state` 是字符串数字，这里给出中文名与展示用的语义分组，
 * 便于前端用统一的颜色体系呈现，而不必在组件里散落 switch。
 */
export const LOGISTICS_STATE_META: Record<
  string,
  { label: string; tone: "transit" | "pickup" | "delivering" | "signed" | "problem" }
> = Object.freeze({
  "0": { label: "在途", tone: "transit" },
  "1": { label: "揽收", tone: "pickup" },
  "2": { label: "疑难", tone: "problem" },
  "3": { label: "已签收", tone: "signed" },
  "4": { label: "退签", tone: "problem" },
  "5": { label: "派件中", tone: "delivering" },
  "6": { label: "退回", tone: "problem" },
  "7": { label: "转投", tone: "transit" },
  "8": { label: "清关", tone: "transit" },
  "10": { label: "待清关", tone: "transit" },
  "11": { label: "清关中", tone: "transit" },
  "12": { label: "已清关", tone: "transit" },
  "13": { label: "清关异常", tone: "problem" },
  "14": { label: "拒签", tone: "problem" },
});

export function logisticsStateLabel(state: string | null | undefined): string {
  if (!state) return "暂无信息";
  return LOGISTICS_STATE_META[state]?.label ?? "运输中";
}

/** 已签收或已退签等终态：可长期缓存，不必再向快递100 发起查询 */
export function isFinalLogisticsState(state: string | null | undefined): boolean {
  return state === "3" || state === "4" || state === "14";
}
