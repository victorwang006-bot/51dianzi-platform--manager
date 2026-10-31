/**
 * 运单号 → 快递公司推断规则。
 *
 * 面单 OCR 接口只返回运单号，不返回快递公司；而快递100 的「智能单号识别」
 * 接口需单独付费开通，当前账号未开通（调用返回 601）。因此这里用本地规则
 * 从单号特征推断候选快递公司。
 *
 * 设计取向：**宁可多给候选，也不要给出唯一的错误答案**。
 * 规则命中多家时全部返回，由用户在界面上确认，这与快递100 官方
 * 「无法保证 100% 准确识别，请务必检查识别的数据是否正确」的要求一致。
 *
 * 规则来源为各快递公司公开的单号编码规范与实际单号样本，
 * 不覆盖的单号会返回空数组，此时界面要求用户手工选择。
 */
import { EXPRESS_COMPANIES, expressNameOf } from "./expressCompanies";

export type WaybillGuess = {
  /** 快递100 编码 */
  code: string;
  /** 中文名 */
  name: string;
  /**
   * 置信度 0-1。
   * 0.9 以上表示前缀特征唯一（如 SF、JD）；
   * 0.5 左右表示仅靠长度匹配，同长度的公司较多。
   */
  confidence: number;
  /** 命中依据，用于界面展示"依据：SF 前缀" */
  reason: string;
};

type Rule = {
  code: string;
  /** 单号需匹配的正则 */
  pattern: RegExp;
  confidence: number;
  reason: string;
};

/**
 * 规则表。顺序不影响结果（全部规则都会尝试），但 confidence 决定排序。
 *
 * 注意：字母前缀类规则置信度高，因为前缀几乎是各家专属；
 * 纯数字类规则只能靠长度与首位数字，重合度高，因此置信度低。
 */
const RULES: readonly Rule[] = Object.freeze([
  // ── 字母前缀特征明确的 ──
  {
    code: "shunfeng",
    pattern: /^SF\d{10,16}$/i,
    confidence: 0.96,
    reason: "SF 前缀为顺丰专属",
  },
  {
    code: "shunfengkuaiyun",
    pattern: /^SF\d{10,16}$/i,
    confidence: 0.4,
    reason: "顺丰快运与顺丰速运共用 SF 前缀，需人工区分",
  },
  {
    code: "jd",
    pattern: /^JD[A-Z0-9]{9,20}$/i,
    confidence: 0.95,
    reason: "JD 前缀为京东物流专属",
  },
  {
    code: "jtexpress",
    pattern: /^JT\d{10,16}$/i,
    confidence: 0.94,
    reason: "JT 前缀为极兔专属",
  },
  {
    code: "yuantong",
    pattern: /^YT\d{10,16}$/i,
    confidence: 0.93,
    reason: "YT 前缀为圆通专属",
  },
  {
    code: "debangkuaidi",
    pattern: /^DP[A-Z0-9]{8,18}$/i,
    confidence: 0.85,
    reason: "DP 前缀常见于德邦",
  },
  {
    code: "kuayue",
    pattern: /^KY\d{8,16}$/i,
    confidence: 0.9,
    reason: "KY 前缀为跨越速运专属",
  },
  {
    code: "zhaijisong",
    pattern: /^(ZJS|A)\d{8,14}$/i,
    confidence: 0.82,
    reason: "ZJS 前缀为宅急送专属",
  },
  {
    code: "ems",
    // EMS 国内特快：两位字母 + 9 位数字 + 两位国别码
    pattern: /^[A-Z]{2}\d{9}[A-Z]{2}$/i,
    confidence: 0.9,
    reason: "符合万国邮联 13 位邮政单号格式",
  },
  {
    code: "youzhengguonei",
    pattern: /^[A-Z]{2}\d{9}[A-Z]{2}$/i,
    confidence: 0.6,
    reason: "邮政快递包裹与 EMS 共用 13 位邮政格式",
  },
  {
    code: "cainiao",
    pattern: /^(CN|LP)\d{10,20}$/i,
    confidence: 0.86,
    reason: "CN/LP 前缀常见于菜鸟",
  },

  // ── 纯数字类：只能靠长度与首位，置信度低 ──
  {
    code: "zhongtong",
    // 中通：12 位数字，多以 7、6、5 开头；也有 75/78 开头的 14 位
    pattern: /^(7|6|5)\d{11}$/,
    confidence: 0.62,
    reason: "12 位数字且首位为 5/6/7，符合中通特征",
  },
  {
    code: "zhongtong",
    pattern: /^7\d{13}$/,
    confidence: 0.6,
    reason: "14 位数字且以 7 开头，符合中通特征",
  },
  {
    code: "yuantong",
    // 圆通：常见 YT 前缀，纯数字形式多为 12 位以 8、D 开头
    pattern: /^8\d{11}$/,
    confidence: 0.5,
    reason: "12 位数字且以 8 开头，可能为圆通",
  },
  {
    code: "yunda",
    // 韵达：13 位或 15 位数字，多以 3、4、5 开头
    pattern: /^(3|4|5)\d{12}$/,
    confidence: 0.58,
    reason: "13 位数字且首位为 3/4/5，符合韵达特征",
  },
  {
    code: "yunda",
    pattern: /^(3|4)\d{14}$/,
    confidence: 0.55,
    reason: "15 位数字且首位为 3/4，符合韵达特征",
  },
  {
    code: "shentong",
    // 申通：12 位或 13 位数字，多以 77、88、66、268 开头
    pattern: /^(77|88|66|55|33|46|47|48|55|56|58|68|69|77|78)\d{10}$/,
    confidence: 0.55,
    reason: "12 位数字且前缀符合申通号段",
  },
  {
    code: "huitongkuaidi",
    // 百世：多为 A/B 开头或 12 位数字以 5、6 开头
    pattern: /^[AB]\d{11,13}$/i,
    confidence: 0.7,
    reason: "A/B 前缀常见于百世快递",
  },
  {
    code: "tiantian",
    pattern: /^(1|2|5|6|7|8)\d{11,12}$/,
    confidence: 0.32,
    reason: "长度与号段与天天快递部分重合",
  },
  {
    code: "jd",
    // 京东纯数字形式
    pattern: /^\d{13,15}$/,
    confidence: 0.3,
    reason: "13-15 位纯数字，京东部分单号为此形式",
  },
]);

/** 已收录的快递编码集合，用于防止规则表写入未收录编码 */
const KNOWN_CODES = new Set(EXPRESS_COMPANIES.map(item => item.code));

/**
 * 从运单号推断可能的快递公司。
 *
 * @returns 按置信度降序排列的候选列表；无法推断时返回空数组
 */
export function guessExpressCompanies(waybill: string | null | undefined): WaybillGuess[] {
  const num = (waybill ?? "").trim();
  if (num.length < 6 || num.length > 32) return [];

  // 用数组而非 Map 展开：项目编译目标较低，展开迭代器需要 downlevelIteration
  const matched: WaybillGuess[] = [];
  for (const rule of RULES) {
    if (!KNOWN_CODES.has(rule.code)) continue;
    if (!rule.pattern.test(num)) continue;
    const index = matched.findIndex(item => item.code === rule.code);
    // 同一家公司命中多条规则时保留置信度最高的那条依据
    if (index >= 0 && matched[index].confidence >= rule.confidence) continue;
    const guess: WaybillGuess = {
      code: rule.code,
      name: expressNameOf(rule.code),
      confidence: rule.confidence,
      reason: rule.reason,
    };
    if (index >= 0) matched[index] = guess;
    else matched.push(guess);
  }

  return matched.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

/**
 * 取置信度最高的单一推断结果。
 *
 * 仅在置信度足够高（≥ 0.8）且与第二名有明显差距时才返回，
 * 否则返回 null 表示"无法确定，需人工选择"。
 * 这样可以避免在纯数字单号这类高度重合的场景下给出误导性的默认值。
 */
export function bestExpressGuess(waybill: string | null | undefined): WaybillGuess | null {
  const guesses = guessExpressCompanies(waybill);
  if (!guesses.length) return null;
  const [first, second] = guesses;
  if (first.confidence < 0.8) return null;
  if (second && first.confidence - second.confidence < 0.15) return null;
  return first;
}
