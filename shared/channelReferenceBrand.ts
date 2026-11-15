/** Pure, finite whole-brand matching. No model/MPN or quote-condition changes.
 * Historical directed edges retain their profiles; explicit curated family IDs
 * independently permit bidirectional matching of complete approved literals.
 * No substring search, decoration removal, typo repair or inferred graph closure.
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
// Approved historical whole literals, not inferred manufacturer families. The
// first four Murata directions remain LCSC/snapshot-only; ICKey must not inherit
// LCSC's old family normalizer. All other explicit literals apply to both sources.
export const VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS = [
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

export type ChannelReferenceBrandFamily = {
  /** Stable curated identity, never inferred from a shared substring/edge target. */
  familyId: string;
  /** Complete literals; parenthetical descriptions/company names stay significant. */
  variants: readonly string[];
  /** Defaults to all profiles. Keep historical Murata away from ICKey. */
  profiles?: readonly ChannelReferenceBrandProfile[];
};

/** Approved complete literals only. The first section uses existing approved
 * endpoints. The second uses existing mall bilingual labels explicitly authorized
 * by the parent reassessment on 2026-11-15; it is not a claim of new official research.
 * Corporate/product-line edges (ADI/LINEAR, IXYS/Littelfuse, Intel/Altera), Murata's
 * legacy source restriction, and bare CJ/JSCJ/JCET are not promoted by inference.
 */
export const VERIFIED_CHANNEL_REFERENCE_BRAND_FAMILIES: readonly ChannelReferenceBrandFamily[] = [
  { familyId: "texas-instruments", variants: ["TI", "德州仪器", "Texas Instruments", "TI(德州仪器)", "德州仪器(TI)", "Texas Instruments(德州仪器)", "德州仪器(Texas Instruments)"] },
  { familyId: "st-microelectronics", variants: ["ST", "ST(意法半导体)", "ST MICROELECTRONICS", "STMicroelectronics"] },
  { familyId: "historical-xianke-not-stmicro", variants: ["先科", "ST(先科)"] },
  { familyId: "onsemi", variants: ["ON", "ON(安森美)", "onsemi", "ON Semiconductor", "onsemi(安森美)"] },
  { familyId: "te-connectivity", variants: ["TE", "TE Connectivity", "TE Connectivity(泰科电子)"] },
  { familyId: "sunlord", variants: ["顺络", "SUNLORD", "SUNLORD(顺络)"] },
  { familyId: "infineon", variants: ["INFINEON", "英飞凌", "INFINEON(英飞凌)"] },
  { familyId: "vishay", variants: ["VISHAY", "VISHAY(威世)", "VISHAY/威世", "威世", "Vishay Intertechnologies"] },
  // Existing mall filter/product bilingual labels, approved in the completed reassessment.
  { familyId: "jing-extension", variants: ["精拓金", "Jing extension/精拓金", "Jing extension/深圳精拓金电子"] },
  // AMASS uses 艾迈斯 as actually captured, not an automatic 阿迈斯 correction.
  { familyId: "amass", variants: ["AMASS", "AMASS(艾迈斯)"] },
  { familyId: "panjit", variants: ["PANJIT", "PANJIT(强茂)", "台湾强茂", "PANJIT/台湾强茂"] },
  { familyId: "littelfuse", variants: ["Littelfuse", "Littelfuse(美国力特)"] },
  { familyId: "yxc", variants: ["YXC", "YXC(扬兴晶振)"] },
  { familyId: "geehy", variants: ["Geehy(珠海极海)", "Geehy(极海半导体)"] },
  { familyId: "chipanalog", variants: ["CHIPANALOG", "Chipanalog(川土微)"] },
  { familyId: "historical-changdian-cj-literals-not-jcet", variants: ["长电", "CJ(江苏长电/长晶)", "CJ/江苏长晶(长电)"] },
];

/** Width/case/whitespace plus bounded brand-label separator glyphs. Separators
 * are retained, not deleted; hyphen, underscore, ampersand and accents remain
 * significant. Never applied to complete MPNs or raw snapshot identity keys.
 */
export const normalizeChannelReferenceBrandFamilyLiteral = (value: string): string =>
  normalizeChannelReferenceBrand(value).replace(/[\\|·•、]/g, "/");

function balancedBrandParentheses(value: string): boolean {
  let depth = 0;
  for (const c of value) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

// Refusal domains, NOT equivalence groups. Bare ST is ambiguous within a
// composite: only its whole literal or explicit 意法 name identifies STMicro.
// A valid historical ST(先科) is therefore not self-conflicting.
const CONFLICT_DOMAINS = [
  { whole: ["ST", "ST(意法半导体)", "ST MICROELECTRONICS", "STMicroelectronics"], tokens: ["意法半导体", "ST MICROELECTRONICS", "STMicroelectronics"] },
  { whole: ["先科", "ST(先科)"], tokens: ["先科"] },
  { whole: ["TI", "德州仪器", "Texas Instruments"], tokens: ["TI", "德州仪器", "Texas Instruments"] },
  { whole: ["Microchip", "MICROCHIP(美国微芯)"], tokens: ["Microchip", "美国微芯"] },
  { whole: ["XKB"], tokens: ["XKB", "XKB Connection", "XKB Connectivity", "中国星坤"] },
  { whole: ["XFCN", "XFCN(兴飞)"], tokens: ["XFCN", "兴飞"] },
  { whole: ["JCET"], tokens: ["JCET"] },
  { whole: ["CJ", "JSCJ"], tokens: ["CJ", "JSCJ", "江苏长晶"] },
].map(domain => ({
  whole: new Set(domain.whole.map(normalizeChannelReferenceBrandFamilyLiteral)),
  tokens: new Set(domain.tokens.map(normalizeChannelReferenceBrandFamilyLiteral)),
}));
const CONFLICT_DOMAIN_PAIRS = [[0, 1], [2, 3], [4, 5], [6, 7]] as const;
function hasExplicitBrandConflict(wanted: string, seen: string): boolean {
  const literals = [wanted, seen];
  const tokens = literals.flatMap(literal => literal.split(/[()/]/).filter(Boolean));
  const present = CONFLICT_DOMAINS.map(domain =>
    literals.some(literal => domain.whole.has(literal)) || tokens.some(token => domain.tokens.has(token)));
  return CONFLICT_DOMAIN_PAIRS.some(([a, b]) => present[a] && present[b]);
}

type BrandMatchOptions = {
  profile?: ChannelReferenceBrandProfile;
  normalize?: (value: string) => string;
};

/** Compile explicit family IDs once. Duplicate normalized literals belonging to
 * different IDs fail closed per profile, including exact. No transitive union.
 * Isolated candidate-table tests need not enable candidates in the default matcher.
 * Tables are copied: later mutation cannot alter the compiled identity index.
 */
export function createChannelReferenceBrandMatcher(families: readonly ChannelReferenceBrandFamily[]) {
  const profiles: readonly ChannelReferenceBrandProfile[] = ["snapshot", "lcsc", "ickey"];
  const indices = new Map(profiles.map(profile => [profile, new Map<string, string | null>()]));
  for (const family of families) {
    if (!family.familyId.trim() || !family.variants.length) throw new Error("Invalid explicit brand family");
    for (const variant of family.variants) {
      const literal = normalizeChannelReferenceBrandFamilyLiteral(variant);
      if (!literal || !balancedBrandParentheses(literal)) throw new Error("Invalid whole-brand family literal");
      for (const profile of family.profiles ?? profiles) {
        const index = indices.get(profile);
        if (!index) throw new Error("Invalid explicit brand family profile");
        if (!index.has(literal)) index.set(literal, family.familyId);
        else if (index.get(literal) !== family.familyId) index.set(literal, null);
      }
    }
  }
  return (expected: string, observed: string, options: BrandMatchOptions = {}): ChannelReferenceBrandMatch | null => {
    const rawWanted = normalizeChannelReferenceBrandFamilyLiteral(expected);
    const rawSeen = normalizeChannelReferenceBrandFamilyLiteral(observed);
    if (!rawWanted || !rawSeen || !balancedBrandParentheses(rawWanted) || !balancedBrandParentheses(rawSeen)
      || hasExplicitBrandConflict(rawWanted, rawSeen)) return null;
    const profile = options.profile ?? "snapshot";
    const index = indices.get(profile)!;
    const wantedFamily = index.get(rawWanted), seenFamily = index.get(rawSeen);
    // An unlisted composite that explicitly names two known distinct families is
    // contradictory even when expected === observed. Registered complete labels
    // take precedence over token diagnostics (notably the ambiguous ST(先科)).
    const conflictingComposite = (literal: string) => {
      if (index.has(literal)) return false;
      const ids = literal.split(/[()/]/).map(token => index.get(token)).filter((id): id is string => typeof id === "string");
      return new Set(ids).size > 1;
    };
    if (conflictingComposite(rawWanted) || conflictingComposite(rawSeen)) return null;
    if (wantedFamily === null || seenFamily === null) return null;
    if (wantedFamily !== undefined && seenFamily !== undefined && wantedFamily !== seenFamily) return null;
    const normalize = options.normalize ?? normalizeChannelReferenceBrand;
    const wanted = normalize(expected), seen = normalize(observed);
    if (!wanted || !seen) return null;
    if (wanted === seen) return "exact";
    if (wantedFamily !== undefined && wantedFamily === seenFamily) return "explicit_alias";
    const direct = (pairs: readonly (readonly [string, string])[]) => pairs.some(
      ([input, literal]) => wanted === normalize(input) && seen === normalize(literal));
    if (direct(VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS)) return "explicit_alias";
    const historical = profile === "ickey"
      ? VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS.slice(4)
      : VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS;
    return direct(historical) ? "explicit_alias" : null;
  };
}

export const matchChannelReferenceBrand = createChannelReferenceBrandMatcher(VERIFIED_CHANNEL_REFERENCE_BRAND_FAMILIES);
