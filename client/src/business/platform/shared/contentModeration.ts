/**
 * 用户自由文本的合规过滤（公共模块）。
 *
 * ── 为何独立成模块 ────────────────────────────────────────────────
 * 平台有多个自由文本入口：库存备注说明、需求发布备注、入库备注、
 * 聊天消息、企业简介。若只在某一处加过滤，商户换个入口就能发布
 * 同样的违规内容。本模块与调用点解耦，新入口接入只需一行调用。
 *
 * ── 双层防护（用户确认的 A+B 方案）────────────────────────────────
 * A. 写入时拦截：`assertTextCompliant` 命中即抛错，明确告知违规词，
 *    让商户当场修改。备注一旦上线即构成对外宣传，事后补救成本高。
 * B. 展示时兜底：`maskForbiddenWords` 对已入库文本打码。
 *    必要性在于词库会增补——新增词条后，此前合规入库的存量数据
 *    会变成违规，若只有 A 层则这些内容仍会在前台露出。
 *
 * ── 词库维护须知 ──────────────────────────────────────────────────
 * 极限词依据《广告法》第九条（绝对化用语），违者处 20 万元以上罚款。
 * 新增词条前请确认不会误伤电子元器件的正常技术表述，
 * 例如「最大值」「最小封装」「顶层走线」「第一脚」都是合法技术用语，
 * 不可直接把「最大」「顶」「第一」作为独立词条加入。
 */

/** 违规类别 */
export type ForbiddenCategory =
  | "superlative"   // 极限词（《广告法》第九条）
  | "insult"        // 侮辱性词汇
  | "contact"       // 联系方式引流（绕过平台私下成交）
  | "illegal";      // 政治敏感 / 涉黄赌毒

export const FORBIDDEN_CATEGORY_LABELS: Record<ForbiddenCategory, string> = {
  superlative: "极限词（违反广告法）",
  insult: "侮辱性词汇",
  contact: "联系方式（请通过平台沟通）",
  illegal: "违法违规内容",
};

/**
 * 极限词。
 *
 * 取词原则：必须是「完整的绝对化表述」，不能是可能出现在技术参数里的片段。
 * 反例说明：不收录单独的「最大」「最小」「第一」「顶」，
 * 因为「最大耐压」「最小封装」「第一脚」「顶层」均为正常技术用语。
 */
const SUPERLATIVE_WORDS: readonly string[] = [
  // 国家级/权威类
  "国家级", "国家免检", "国家指定", "宇宙级", "世界级",
  // 最高级类
  "最高级", "最高档", "最佳", "最好", "最优秀", "最优质", "最强",
  "最先进", "最专业", "最权威", "最便宜", "最低价", "最实惠",
  "最划算", "最省钱", "史上最", "全网最低", "全国最低", "行业最低",
  // 第一/唯一类
  "第一品牌", "全国第一", "世界第一", "行业第一", "销量第一",
  "独一无二", "绝无仅有", "举世无双", "无与伦比",
  // 绝对承诺类
  "百分百", "百分之百", "100%正品", "绝对正品", "绝对保证",
  "永久保证", "永久有效", "终身保证",
  // 领导地位类
  "领导品牌", "领先品牌", "王牌产品", "冠军产品", "顶级品牌",
  "极品", "极致完美", "完美无缺",
  // 虚假宣传类
  // 「抢购」「秒杀」属常规促销用语，并非绝对化用语，故不收录
  "包治百病", "疗效最佳", "点击有惊喜",
];

/**
 * 侮辱性词汇。
 *
 * 仅收录明确的辱骂用语。此处不追求穷尽，而是覆盖高频表达；
 * 更完整的治理应结合人工审核（见 `ModerationResult.needsReview`）。
 */
const INSULT_WORDS: readonly string[] = [
  "傻逼", "傻B", "沙比", "煞笔", "白痴", "智障", "脑残", "废物",
  "垃圾货", "骗子", "黑心", "无赖", "混蛋", "王八", "畜生",
  "去死", "找死", "滚蛋", "神经病", "有病吧", "蠢货", "笨蛋",
  "贱人", "婊子", "妈的", "他妈", "尼玛", "草泥马", "操你",
  "fuck", "shit", "bitch", "asshole", "idiot", "stupid",
];

/**
 * 违法违规内容。
 *
 * 电子元器件平台的实际风险主要是走私料、翻新料冒充原装等；
 * 政治与黄赌毒类为合规底线，一并纳入。
 */
const ILLEGAL_WORDS: readonly string[] = [
  /*
   * 注意：此处**不收录**「水货」。
   * 商户常写「非水货」「保证不是水货」作正面承诺，本模块不做语境分析，
   * 收录会把这类合规表述一并拦下，反而阻碍正常经营。
   * 走私料的治理应依靠资质审核与人工介入，而非关键词。
   */
  "走私", "偷渡", "洗钱", "发票代开", "代开发票", "虚开发票",
  "赌博", "博彩", "彩票投注", "毒品", "冰毒", "大麻",
  "色情", "裸聊", "援交", "枪支", "弹药", "军火",
  "翻新充新", "旧货冒充", "假冒原装",
];

/**
 * 联系方式识别。
 *
 * B2B 平台的核心风险：买卖双方在备注里留联系方式，绕过平台私下成交，
 * 平台既拿不到佣金，也无法提供交易保障。
 *
 * ⚠ 电子元器件料号常含长串数字与字母（如 GRM155R62A104KE14D），
 * 因此正则必须足够精确，避免把料号误判为 QQ 号或手机号。
 */
const CONTACT_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // 手机号：要求 11 位且前后不能紧邻其它数字，避免截取料号中的数字段
  { name: "手机号", re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // QQ：必须有 qq/扣扣 等前缀，否则 5-12 位数字极易命中料号
  { name: "QQ号", re: /(?:qq|QQ|Q Q|扣扣|企鹅)\s*[:：=]?\s*\d{5,12}/g },
  // 微信：需前缀，且账号允许字母数字下划线连字符
  { name: "微信号", re: /(?:微信|威信|徽信|wx|WX|weixin|WeChat)\s*[:：=]?\s*[A-Za-z][A-Za-z0-9_-]{4,}/g },
  { name: "邮箱", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { name: "网址", re: /(?:https?:\/\/|www\.)[\w.-]+\.\w+/g },
  // 固话：区号-号码格式
  { name: "固定电话", re: /(?<!\d)0\d{2,3}-?\d{7,8}(?!\d)/g },
];

/** 单条命中记录 */
export interface ForbiddenHit {
  category: ForbiddenCategory;
  /** 命中的原文片段 */
  word: string;
}

/** 检测结果 */
export interface ModerationResult {
  /** 是否合规（无任何命中） */
  ok: boolean;
  /** 全部命中项 */
  hits: ForbiddenHit[];
  /** 面向用户的中文提示（合规时为空字符串） */
  message: string;
}

export interface ModerationMaskOptions {
  /**
   * 明确保留、不执行打码的类别。
   *
   * 仅供已经确定业务边界的展示/写入场景使用；未传时维持原有全量打码行为。
   */
  preserveCategories?: readonly ForbiddenCategory[];
}

/** 词库表：类别 → 词条 */
const WORD_LIBRARY: ReadonlyArray<{ category: ForbiddenCategory; words: readonly string[] }> = [
  { category: "superlative", words: SUPERLATIVE_WORDS },
  { category: "insult", words: INSULT_WORDS },
  { category: "illegal", words: ILLEGAL_WORDS },
];

/**
 * 归一化文本，防止用分隔符绕过检测。
 *
 * 例如「最・好」「最 好」「最-好」都应被识别为「最好」。
 * 仅用于检测，不改变实际存储内容。
 */
function normalizeForDetection(text: string): string {
  return text
    .toLowerCase()
    // 去除常见分隔字符（空格、点、星号、下划线、连字符、全角符号等）
    .replace(/[\s.．·・*＊_\-—~～|｜/／\\]+/g, "");
}

/**
 * 检测文本是否含违禁内容。
 *
 * @param text 待检测文本；空值视为合规（备注为选填字段）
 */
export function detectForbiddenContent(text: string | null | undefined): ModerationResult {
  const raw = (text ?? "").trim();
  if (!raw) return { ok: true, hits: [], message: "" };

  const hits: ForbiddenHit[] = [];
  const normalized = normalizeForDetection(raw);

  // 词库匹配：同时在原文与归一化文本中查找，覆盖分隔符绕过
  for (const { category, words } of WORD_LIBRARY) {
    for (const word of words) {
      const target = normalizeForDetection(word);
      if (raw.toLowerCase().includes(word.toLowerCase()) || normalized.includes(target)) {
        hits.push({ category, word });
      }
    }
  }

  // 正则匹配：联系方式
  for (const { name, re } of CONTACT_PATTERNS) {
    // 正则带 g 标志，复用前需重置 lastIndex，否则多次调用会漏匹配
    re.lastIndex = 0;
    const matched = raw.match(re);
    if (matched && matched.length > 0) {
      hits.push({ category: "contact", word: `${name}（${matched[0]}）` });
    }
  }

  if (hits.length === 0) return { ok: true, hits: [], message: "" };

  /*
   * 按类别归并，生成可读提示。
   *
   * 用普通对象而非 Map：项目 tsconfig 的 target 较低，
   * 直接迭代 Map 需要 downlevelIteration，不值得为此改全局编译选项。
   */
  const grouped: Partial<Record<ForbiddenCategory, string[]>> = {};
  for (const hit of hits) {
    const list = grouped[hit.category] ?? [];
    if (!list.includes(hit.word)) list.push(hit.word);
    grouped[hit.category] = list;
  }
  const parts: string[] = [];
  for (const category of Object.keys(grouped) as ForbiddenCategory[]) {
    const words = grouped[category];
    if (!words || words.length === 0) continue;
    parts.push(`${FORBIDDEN_CATEGORY_LABELS[category]}：${words.join("、")}`);
  }

  return {
    ok: false,
    hits,
    message: `内容包含不合规表述，请修改后再提交。${parts.join("；")}`,
  };
}

/**
 * 写入前的硬拦截（A 层）。命中即抛错，由调用方转为接口错误返回。
 *
 * @param fieldLabel 字段中文名，用于错误提示，如「备注说明」
 */
export function assertTextCompliant(
  text: string | null | undefined,
  fieldLabel: string,
): void {
  const result = detectForbiddenContent(text);
  if (!result.ok) {
    throw new Error(`${fieldLabel}${result.message}`);
  }
}

/**
 * 展示前的兜底打码（B 层）。
 *
 * 为何需要：词库增补后，此前合规入库的存量数据会变成违规。
 * 若仅有 A 层，这些内容仍会在前台露出。
 *
 * 打码而非整段隐藏，是为了保留备注中合规的技术信息
 * （如「NRND物料 100nF ±10% 100V」中的电气参数）。
 */
export function maskForbiddenWords(
  text: string | null | undefined,
  options: ModerationMaskOptions = {},
): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";

  let masked = raw;
  const preservedCategories = new Set(options.preserveCategories ?? []);

  for (const { category, words } of WORD_LIBRARY) {
    if (preservedCategories.has(category)) continue;
    for (const word of words) {
      if (!word) continue;
      // 统一替换为固定 3 个 *，不按原词长度，避免从星号个数反推被屏蔽的词
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      masked = masked.replace(re, "***");
    }
  }

  if (!preservedCategories.has("contact")) {
    for (const { re } of CONTACT_PATTERNS) {
      re.lastIndex = 0;
      masked = masked.replace(re, "***");
    }
  }

  return masked;
}

/**
 * 备注说明的最大字数。
 *
 * 定为 50：生产实测 4,954 条备注最长 40 字、平均 13.7 字，
 * 50 字可覆盖全部现有数据，不会让任何存量备注因新规则而失效；
 * 同时足够写下「NRND物料(将要停产) 原厂不接订单 100nF ±10% 100V」
 * 这类完整的技术说明。
 */
export const NOTE_MAX_LENGTH = 50;

/**
 * 前台列表展示的折叠阈值（用户指定 15 字）。
 *
 * 仅用于搜索结果卡片：超过则截断并加省略号，避免占据版面。
 * 商品详情页不折叠——用户进入详情本就是为了看完整信息。
 */
export const NOTE_COLLAPSE_LENGTH = 15;

/** 按折叠阈值截断展示文本 */
export function truncateNote(
  text: string | null | undefined,
  limit: number = NOTE_COLLAPSE_LENGTH,
): { text: string; truncated: boolean } {
  const raw = (text ?? "").trim();
  if (!raw) return { text: "", truncated: false };
  if (raw.length <= limit) return { text: raw, truncated: false };
  return { text: `${raw.slice(0, limit)}…`, truncated: true };
}
