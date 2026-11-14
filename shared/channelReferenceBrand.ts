/** Pure, finite, directional whole-brand matching. No model/MPN normalization.
 * Snapshot retains its old ASCII-width/case/whitespace semantics; provider callers
 * pass their existing normalizers. No substring, parenthesis removal, typo repair,
 * reverse edge or transitive family construction. Multiple targets are safe because
 * edges are checked against the requested input only (ST/先科, JSCJ/长电 isolated).
 */
export type ChannelReferenceBrandProfile = "snapshot" | "lcsc" | "ickey";
export type ChannelReferenceBrandMatch = "exact" | "explicit_alias";
export const normalizeChannelReferenceBrand = (value: string): string => value
  .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/\s/g, "").toUpperCase();
/** Historical LCSC-only unambiguous family, unchanged; never shared with ICKey. */
export function normalizeLegacyLcscBrandLiteral(normalized: string): string {
  return ["murata", "村田", "murata(村田)", "村田(murata)"].includes(normalized) ? "murata" : normalized;
}
// Preserve all historical snapshot directions. Provider legacy behavior remains
// in the provider's existing normalizer; ICKey does not inherit LCSC's Murata family.
const LEGACY_SNAPSHOT_ALIASES = [
  ["MURATA", "MURATA(村田)"],
  ["MURATA", "村田(MURATA)"],
  ["村田", "MURATA(村田)"],
  ["村田", "村田(MURATA)"],
  ["TI", "TI(德州仪器)"],
  ["TI", "德州仪器(TI)"],
  ["德州仪器", "TI(德州仪器)"],
  ["德州仪器", "德州仪器(TI)"],
  ["TEXASINSTRUMENTS", "TEXASINSTRUMENTS(德州仪器)"],
  ["TEXASINSTRUMENTS", "德州仪器(TEXASINSTRUMENTS)"],
  ["德州仪器", "TEXASINSTRUMENTS(德州仪器)"],
  ["德州仪器", "德州仪器(TEXASINSTRUMENTS)"],
  ["YAGEO", "YAGEO(国巨)"],
  ["康奈特", "CNNT/康奈特"],
  ["伊萨普兰", "ISABELLENHUETTE(伊萨普兰)"],
  ["VISHAY", "VISHAY(威世)"],
  ["FH", "FH(风华)"],
  ["FH", "FH/广东风华高科"],
  ["WALSIN", "WALSIN(华新科)"],
  ["承兴", "CHENGX(承兴)"],
  ["HUAWEI", "HUAWEI(华威集团)"],
  ["云星", "YUNXING(云星)"],
  ["顺络", "SUNLORD(顺络)"],
  ["SUNLORD", "SUNLORD(顺络)"],
  ["CJIANG", "CJIANG(长江微电)"],
  ["MORNSUN", "MORNSUN(金升阳)"],
  ["MORNSUN", "MORNSUN/广州金升阳科技"],
  ["金航标", "KINGHELM(金航标)"],
  ["金航标", "KINGHELM/深圳金航标电子"],
  ["明硕", "MINTRON(明硕)"],
  ["RAINSUN", "RAINSUN(霖昱微)"],
  ["灿科盟", "CKMTW(灿科盟)"],
  ["XFCN", "XFCN(兴飞)"],
  ["兆星", "MEGASTAR(兆星)"],
  ["INFINEON", "INFINEON(英飞凌)"],
  ["ST", "ST(意法半导体)"],
  ["先科", "ST(先科)"],
  ["PRISEMI", "PRISEMI(芯导)"],
  ["PRISEMI", "PRISEMI/上海芯导电子"],
  ["BRIGHTKING", "BRIGHTKING(君耀电子)"],
  ["扬杰", "YANGJIE(扬杰)"],
  ["MDD", "MDD(辰达半导体)"],
  ["FAILONG", "FAILONG/广东惠伦晶体"],
  ["TST", "TST(嘉硕)"],
  ["ON", "ON(安森美)"],
  ["BROADCOM", "BROADCOM(博通)"],
  ["LITEON", "LITEON(光宝)"],
  ["LITEON", "LITEON(台湾光宝)"],
  ["MICRONE", "MICRONE(南京微盟)"],
  ["3PEAK", "3PEAK(思瑞浦)"],
  ["UMW", "UMW(友台半导体)"],
  ["UMW", "UMW/友台半导体"],
  ["英飞凌", "INFINEON(英飞凌)"],
  ["瑞隆源", "RUILON(瑞隆源)"],
  ["成都芯进", "CROSSCHIP(成都芯进)"],
  ["金升阳", "MORNSUN(金升阳)"],
  ["ADI", "ADI(亚德诺)"],
  ["ADI", "ADI(亚德诺)/LINEAR"],
  ["昂宝", "OB(昂宝)"],
  ["台湾强茂", "PANJIT/台湾强茂"],
  ["NXP", "NXP(恩智浦)"],
  ["LEM", "LEM(莱姆)"],
  ["IXYS", "LITTELFUSE/IXYS"],
  ["长电", "CJ/江苏长晶(长电)"],
  ["圣邦微", "SGMICRO(圣邦微)"],
  ["INTEL", "INTEL/ALTERA"],
] as const;
// BEGIN VERIFIED DIRECTED PAIRS (generated only from explicit approved aliases)
export const VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS: readonly (readonly [string, string])[] = [
  [
    "Wurth(伍尔特)",
    "WURTH"
  ],
  [
    "Wurth(伍尔特)",
    "WURTH ELEKTRONIK"
  ],
  [
    "Wurth(伍尔特)",
    "Würth Elektronik"
  ],
  [
    "TE",
    "TE Connectivity"
  ],
  [
    "XKB",
    "XKB Connection(中国星坤)"
  ],
  [
    "XKB",
    "XKB CONNECTION/中国星坤"
  ],
  [
    "XKB",
    "XKB Connection/中国星坤"
  ],
  [
    "ST",
    "ST MICROELECTRONICS"
  ],
  [
    "ST",
    "STMicroelectronics"
  ],
  [
    "ON",
    "onsemi"
  ],
  [
    "ON",
    "ON Semiconductor"
  ],
  [
    "TI",
    "Texas Instruments"
  ],
  [
    "TI",
    "TEXAS INSTRUMENTS"
  ],
  [
    "TE",
    "TE Connectivity(泰科电子)"
  ],
  [
    "XKB",
    "XKB Connectivity/中国星坤"
  ],
  [
    "地博",
    "DORABO(地博电气)"
  ],
  [
    "地博",
    "DORABO/宁波地博电气"
  ],
  [
    "地博",
    "DORABO/慈溪地博电子"
  ],
  [
    "ON",
    "onsemi(安森美)"
  ],
  [
    "TECHFUSE台湾陆海",
    "台湾陆海"
  ],
  [
    "TECHFUSE台湾陆海",
    "SEA & LAND ELECTRONIC/台湾陆海电子"
  ],
  [
    "TECHFUSE台湾陆海",
    "Sea&Land/台湾陆海电子"
  ],
  [
    "中科微",
    "杭州中科微"
  ]
];
// END VERIFIED DIRECTED PAIRS
export function matchChannelReferenceBrand(expected: string, observed: string, options: {
  profile?: ChannelReferenceBrandProfile;
  normalize?: (value: string) => string;
} = {}): ChannelReferenceBrandMatch | null {
  const normalize = options.normalize ?? normalizeChannelReferenceBrand;
  const wanted = normalize(expected), seen = normalize(observed);
  if (!wanted || !seen) return null;
  if (wanted === seen) return "exact";
  if ((observed.includes("(") !== observed.includes(")"))
    || (observed.includes("（") !== observed.includes("）"))) return null;
  const direct = (pairs: readonly (readonly [string, string])[]) => pairs.some(
    ([input, literal]) => wanted === normalize(input) && seen === normalize(literal));
  if (direct(VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS)) return "explicit_alias";
  return (options.profile ?? "snapshot") === "snapshot" && direct(LEGACY_SNAPSHOT_ALIASES)
    ? "explicit_alias" : null;
}
