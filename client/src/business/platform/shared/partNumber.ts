/**
 * 元器件型号（Part Number）归一化与撮合工具。
 *
 * 背景：买卖双方撮合的唯一可靠依据是型号，而不是品类。
 * 生产库实测：卖家库存 90%（4927/5454）的品类填「其他」，
 * 且买卖两侧品类词表零交集（需求侧「MCU/处理器」vs 库存侧「微控制器」），
 * 因此品类无法用于撮合，型号才是钥匙。
 *
 * 但型号直接做等号比较会漏单，生产库实测存在：
 * - 198 条型号含小写字母
 * - 3 组同料不同写法：CT4-0805B103K500F3 与 CT40805B103K500F3（差一个横杠）
 *
 * 故撮合分三层，由严到宽：
 * 1. 归一化精确匹配 —— 大写化 + 去分隔符后完全相等，视为同一型号
 * 2. 同料不同包装   —— 基础型号一致，且多出的尾缀在包装白名单内
 * 3. 替代料         —— 交由 material.alternatives，本模块不负责
 */

/** 归一化型号：大写化并去除分隔符（横杠、空格、下划线、斜杠） */
export function normalizePartNumber(input: string): string {
  return input.toUpperCase().replace(/[-\s_/]/g, "");
}

/**
 * 公认的包装/编带后缀白名单。
 *
 * 为什么必须用白名单，而不是「尾部多出 N 位就算同料」：
 * 生产库真实反例证明机械规则会推错料——
 * - M39014/01-1593 → M39014/01-1593V   （V 是军规特性代号，非包装）
 * - TCC0603X7R104K500CT → ...CTS / ...CTM（S/M 是规格代号，非包装）
 * - STM32F103C8T6 vs STM32F103C8T7     （T6/T7 是温度等级，不同规格！）
 * 推错料会导致整批物料报废，代价远高于漏单，故只认明确已知的包装后缀。
 *
 * 维护说明：发现新的包装后缀可直接在此数组追加，无需改动匹配逻辑。
 */
export const PACKAGING_SUFFIXES = [
  "TR",   // Tape & Reel 卷带
  "TR1",
  "TR7",
  "TRPBF",
  "T/R",
  "RL",   // Reel
  "TA",   // Tape
  "TB",
  "TE",
  "TG",
  "AR",   // Ammo Pack / 编带
  "BULK",
  "TUBE",
  "TRAY",
  "Y",    // 部分国产电容用 -Y 表示编带包装（生产库实测 CT4-0805B*-Y）
  "L",    // 部分国产电容用 -L 表示散装/编带（生产库实测 CT4-0805-*-L）
] as const;

/**
 * 明确排除的后缀：形似包装后缀，实为规格/等级标识。
 * 命中这些一律不判为同料，避免推荐错料。
 */
export const NON_PACKAGING_SUFFIXES = [
  // 温度等级 / 封装标识（ST 等 MCU 常见）
  "T6", "T7", "T8", "T3",
  // 军规特性代号
  "V",
  // 规格 / 端头材质代号
  "S", "M", "F", "K", "J",
] as const;

/**
 * 仅用于搜索与已审批外观图的原厂核验对应关系，不参与需求撮合或订单型号改写。
 * NXP TJA1042T/3/1J 的 J 为 13 英寸卷盘；/1 不是包装后缀。
 * 不能把 J 放入全局包装白名单：其它厂商的 J 可能代表不同规格。
 * https://www.nxp.com/part/TJA1042T
 */
const VERIFIED_SEARCH_PACKAGING_EQUIVALENTS = new Map([
  ["TJA1042T/3/1", "TJA1042T/3/1J"],
  ["TJA1042T/3/1J", "TJA1042T/3/1"],
]);

export function verifiedSearchPackagingEquivalent(partNumber: string): string | undefined {
  return VERIFIED_SEARCH_PACKAGING_EQUIVALENTS.get(partNumber.normalize("NFKC").trim().toUpperCase());
}

/**
 * 判断 candidate 是否为 base 的「同料不同包装」。
 *
 * 规则：归一化后 candidate 必须以 base 开头，且多出的尾缀
 * 完整命中包装白名单（不在白名单内一律返回 false）。
 *
 * @returns 命中的包装后缀；不构成同料关系时返回 null
 */
export function matchPackagingVariant(
  base: string,
  candidate: string
): string | null {
  const nb = normalizePartNumber(base);
  const nc = normalizePartNumber(candidate);
  if (!nb || !nc) return null;
  // 完全相同属于精确匹配，不算包装变体
  if (nb === nc) return null;
  if (!nc.startsWith(nb)) return null;

  const suffix = nc.slice(nb.length);
  if (!suffix) return null;

  // 归一化会去掉分隔符，故白名单也要归一化后比较（如 T/R -> TR）
  const normalizedWhitelist = new Set(
    PACKAGING_SUFFIXES.map(s => normalizePartNumber(s))
  );
  const excluded = new Set(NON_PACKAGING_SUFFIXES.map(s => s.toUpperCase()));

  // 明确排除优先：即使碰巧也在白名单里，也不判为同料
  if (excluded.has(suffix)) return null;
  if (normalizedWhitelist.has(suffix)) return suffix;
  return null;
}

/** 撮合层级 */
export type MatchTier = "exact" | "packaging" | "none";

/**
 * 判定两个型号的撮合层级。
 * 供搜索、需求撮合、推荐等场景统一调用，避免各处自行实现导致规则漂移。
 */
export function classifyMatch(query: string, candidate: string): MatchTier {
  const nq = normalizePartNumber(query);
  const nc = normalizePartNumber(candidate);
  if (!nq || !nc) return "none";
  if (nq === nc) return "exact";
  // 双向判断：查询型号带包装后缀、库存型号带包装后缀，两种情况都要覆盖
  if (matchPackagingVariant(nq, nc) || matchPackagingVariant(nc, nq)) {
    return "packaging";
  }
  return "none";
}

/**
 * 外观图查找键：精确完整型号 + 包装白名单变体。
 *
 * 例如 STM32L071CZT6TR 可共用 STM32L071CZT6 的外观图。
 * 不得回退到更短基础型号（STM32L071CZT6 不能用 STM32L071CZ）。
 * 温度等级 T6/T7 等排除后缀不得进入查找键。
 */
export function packagingAppearanceLookupKeys(partNumber: string): string[] {
  const exact = partNumber.normalize("NFKC").trim().toUpperCase();
  if (!exact) return [];
  const keys = [exact];
  const compact = normalizePartNumber(exact);
  const seen = new Set([exact, compact]);
  const suffixes = [...PACKAGING_SUFFIXES]
    .map(suffix => normalizePartNumber(suffix))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (compact.length <= suffix.length || !compact.endsWith(suffix)) continue;
    const baseCompact = compact.slice(0, -suffix.length);
    if (!baseCompact || matchPackagingVariant(baseCompact, compact) !== suffix) continue;
    if (!seen.has(baseCompact)) keys.push(baseCompact);
    break;
  }
  const equivalent = verifiedSearchPackagingEquivalent(exact);
  if (equivalent && !keys.includes(equivalent)) keys.push(equivalent);
  return keys;
}

/**
 * 完整料号搜索的包装变体键（去分隔符大写）。
 * 搜 STM32L071CZT6TR 时同时查找 STM32L071CZT6；反向亦然。
 */
export function packagingSearchLookupKeys(partNumber: string): string[] {
  const exact = partNumber.normalize("NFKC").trim().toUpperCase();
  if (!exact) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const next = value.normalize("NFKC").trim().toUpperCase();
    if (!next || seen.has(next)) return;
    seen.add(next);
    keys.push(next);
    const compact = normalizePartNumber(next);
    if (compact && !seen.has(compact)) {
      seen.add(compact);
      keys.push(compact);
    }
  };
  add(exact);
  const appearanceKeys = packagingAppearanceLookupKeys(exact);
  for (const key of appearanceKeys) add(key);
  // 搜基础订货型号时，也要带出白名单包装后缀库存（…T6 与 …T6TR 同层）。
  // 特定核验别名不是基础包装后缀：增加别名时不得丢失原有的 TR 等扩展。
  const verifiedEquivalent = verifiedSearchPackagingEquivalent(exact);
  if (!appearanceKeys.some(key => key !== exact && key !== verifiedEquivalent)) {
    const compact = normalizePartNumber(exact);
    for (const suffix of PACKAGING_SUFFIXES) {
      const normalizedSuffix = normalizePartNumber(suffix);
      if (!normalizedSuffix) continue;
      add(compact + normalizedSuffix);
      add(`${exact}${normalizedSuffix}`);
      add(`${exact}-${suffix.toUpperCase()}`);
      add(`${exact} ${suffix.toUpperCase()}`);
    }
  }
  return keys;
}

/**
 * 识别可能残缺的型号（用于数据质量巡检，不用于撮合）。
 *
 * 生产库存在 STM32F103C4 这类残缺型号（真实料号应为 STM32F103C4T6），
 * 系用户确认的历史妥协数据。此函数仅用于生成清理建议清单，
 * 不参与任何自动删除或过滤，避免误伤真实短型号（如 1N4148）。
 */
export function looksTruncated(partNumber: string): boolean {
  const n = normalizePartNumber(partNumber);
  /**
   * 仅对命名规范明确的 STM32 系列做提示。
   * 完整料号形如 STM32F103C8T6（13 位）：系列(9) + 封装(1) + 温度等级(2)。
   * 缺少尾部封装/温度位的（如 STM32F103C4，11 位）视为残缺。
   * 刻意只覆盖这一个系列：判据宁可漏报也不能误报，
   * 否则会把 1N4148 这类真实短型号错标为脏数据。
   */
  if (/^STM32/.test(n) && n.length < 13) return true;
  return false;
}
