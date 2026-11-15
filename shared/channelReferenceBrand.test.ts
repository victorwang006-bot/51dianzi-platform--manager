import { describe, expect, it } from "vitest";
import { createChannelReferenceBrandMatcher, matchChannelReferenceBrand, normalizeChannelReferenceBrand, normalizeChannelReferenceBrandFamilyLiteral, VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS, VERIFIED_CHANNEL_REFERENCE_BRAND_FAMILIES } from "./channelReferenceBrand";

const profiles = ["snapshot", "lcsc", "ickey"] as const;
describe("approved directed literals plus explicit whole-brand equivalence families", () => {
  it.each(VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS)("retains approved %s => entire observed %s", (input, observed) => {
    for (const profile of profiles) {
      expect(matchChannelReferenceBrand(input, observed, { profile })).toBe("explicit_alias");
      expect(matchChannelReferenceBrand(input.toUpperCase(), observed.toLowerCase(), { profile })).toBe("explicit_alias");
      for (const suffix of ["/Other", "(Other)", " Extra"]) expect(matchChannelReferenceBrand(input, observed + suffix, { profile })).toBeNull();
    }
  });
  it.each([
    ["德州仪器", "Texas Instruments"], ["TI(德州仪器)", "德州仪器(Texas Instruments)"],
    ["顺络", "SUNLORD"], ["SUNLORD(顺络)", "顺络"], ["TE Connectivity", "TE"],
    ["ON(安森美)", "onsemi(安森美)"], ["英飞凌", "INFINEON"],
    ["AMASS", "AMASS(艾迈斯)"], ["台湾强茂", "PANJIT(强茂)"],
    ["PANJIT", "PANJIT(强茂)"], ["Littelfuse", "Littelfuse(美国力特)"],
    ["YXC", "YXC(扬兴晶振)"], ["Geehy(珠海极海)", "Geehy(极海半导体)"],
    ["CHIPANALOG", "Chipanalog(川土微)"], ["长电", "CJ(江苏长电/长晶)"],
    ["CJ/江苏长晶(长电)", "CJ(江苏长电/长晶)"],
    ["VISHAY", "Vishay Intertechnologies"], ["VISHAY/威世", "威世"],
    ["VISHAY(威世)", "VISHAY/威世"], ["威世", "Vishay Intertechnologies"],
    ["精拓金", "Jing extension/深圳精拓金电子"], ["Jing extension/精拓金", "Jing extension/深圳精拓金电子"],
  ])("accepts both directions of explicit family %s <=> %s", (a, b) => {
    for (const profile of profiles) {
      expect(matchChannelReferenceBrand(a, b, { profile })).toBe("explicit_alias");
      expect(matchChannelReferenceBrand(b, a, { profile })).toBe("explicit_alias");
      for (const suffix of ["/Other", "(Other)", " Extra"]) {
        expect(matchChannelReferenceBrand(a, b + suffix, { profile })).toBeNull();
        expect(matchChannelReferenceBrand(a + suffix, b, { profile })).toBeNull();
      }
    }
  });
  it.each([
    ["ST", "ST(先科)"], ["先科", "ST MICROELECTRONICS"], ["ST(先科)", "STMicroelectronics"],
    ["TI", "MICROCHIP(美国微芯)"], ["MICROCHIP(美国微芯)", "德州仪器"],
    ["XKB", "XFCN(兴飞)"], ["XFCN", "XKB Connection(中国星坤)"],
    ["JSCJ", "JCET"], ["JSCJ", "长电"], ["JSCJ", "CJ/江苏长晶(长电)"], ["JCET", "CJ(江苏长电/长晶)"],
    ["CJ", "CJ/江苏长晶(长电)"], ["长电", "JSCJ(江苏长晶)"], ["JCET", "长电"],
    ["ORMOM", "OMRON(欧姆龙)"], ["ORMON", "OMRON(欧姆龙)"], ["INRINEON", "Infineon(英飞凌)"], ["WINBOD", "WINBOND(华邦)"],
    ["AMASS", "AMASS(阿迈斯)"], ["CHIPANALOG", "CHIPANALOG(Other)"], ["Geehy", "Geehy(极海半导体)"],
    ["XKB", "XKB Other/中国星坤"], ["XKB", "XKB Connection"], ["XKB", "中国星坤"],
    ["Taiyo", "TAIYO YUDEN"], ["长江", "cjiang(长江微电)"], ["TAE(雅晶鑫)", "YJX(雅晶鑫)"],
    ["ON", "MOTOROLA"], ["ON", "HGC(深圳汉芯)"],
    ["TE", "TE Connectivity/POTTER&BRUMFIELD"], ["TI", "Texas Instruments Other"],
    ["VISHAY", "Vishay Semiconductor"], ["精拓金", "Jing extension"], ["TWGMC", "迪嘉"],
  ])("rejects conflict/unlisted complete brand %s => %s", (input, observed) => {
    expect(matchChannelReferenceBrand(input, observed)).toBeNull();
    expect(matchChannelReferenceBrand(observed, input)).toBeNull();
  });
  it("refuses explicit conflicting composites before exact equality and curated aliases", () => {
    for (const literal of ["TI(Microchip)", "TI(Infineon)", "TE/ON", "XKB/XFCN", "ST(意法半导体/先科)", "JCET/JSCJ"]) expect(matchChannelReferenceBrand(literal, literal)).toBeNull();
    const badTable = createChannelReferenceBrandMatcher([{ familyId: "bad", variants: ["TI", "Microchip"] }]);
    expect(badTable("TI", "Microchip")).toBeNull();
    expect(matchChannelReferenceBrand("先科", "ST(先科)")).toBe("explicit_alias");
  });
  it("does not infer reverse/transitive corporate edges or unknown typo repair", () => {
    for (const [a, b] of [["LINEAR", "ADI(亚德诺)/LINEAR"], ["Littelfuse", "LITTELFUSE/IXYS"], ["ALTERA", "Intel/Altera"], ["DORABO(地博电气)", "地博"]]) expect(matchChannelReferenceBrand(a, b)).toBeNull();
    expect(matchChannelReferenceBrand("Unknown(中文)", "Unknown")).toBeNull();
    expect(matchChannelReferenceBrand("ORMON", "ORMON")).toBe("exact"); // no identity correction
  });
  it("normalizes width/case/space and balanced bracket glyphs without dropping content", () => {
    expect(normalizeChannelReferenceBrand(" ＸＫＢ ")).toBe("XKB");
    expect(normalizeChannelReferenceBrandFamilyLiteral(" ＰＡＮＪＩＴ ｜ 台湾强茂 ")).toBe("PANJIT/台湾强茂");
    expect(matchChannelReferenceBrand("台湾强茂", " ｐａｎｊｉｔ（强茂） ")).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("PANJIT（强茂)", "台湾强茂")).toBe("explicit_alias");
    for (const sep of ["/", "／", "|", "｜", "\\", "·", "•", "、"]) expect(matchChannelReferenceBrand("PANJIT(强茂)", "PANJIT" + sep + "台湾强茂")).toBe("explicit_alias");
    for (const literal of ["PANJIT(Other)", "PANJIT台湾强茂", "PANJIT-台湾强茂", "PANJIT_台湾强茂", "PANJIT(强茂", "PANJIT)强茂("]) expect(matchChannelReferenceBrand("台湾强茂", literal)).toBeNull();
    expect(matchChannelReferenceBrand("ＫＯＡ", " k o a ")).toBe("exact");
    expect(matchChannelReferenceBrand("KOA", "ⓀⓄⒶ")).toBeNull();
    const exact = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
    expect(matchChannelReferenceBrand("KOA", "K O A", { profile: "ickey", normalize: exact })).toBeNull();
    expect(matchChannelReferenceBrand("XKB", "XKB CONNECTION/中国星坤", { profile: "ickey", normalize: exact })).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("德州仪器", "Ｔｅｘａｓ　Ｉｎｓｔｒｕｍｅｎｔｓ", { profile: "ickey", normalize: exact })).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("Murata", "Murata(村田)", { profile: "ickey", normalize: exact })).toBeNull();
  });
  it("copies explicit tables and fails closed on collisions, rather than graph union", () => {
    const variants = ["TESTCO", "测试厂(说明一)", "测试厂(说明二)"];
    const match = createChannelReferenceBrandMatcher([{ familyId: "test-only", variants, profiles: ["snapshot", "lcsc"] }]);
    variants.push("OTHERCO");
    expect(match("测试厂(说明二)", "TESTCO")).toBe("explicit_alias");
    expect(match("测试厂(说明二)", "TESTCO", { profile: "ickey" })).toBeNull();
    expect(match("TESTCO", "OTHERCO")).toBeNull();
    const collide = createChannelReferenceBrandMatcher([{ familyId: "a", variants: ["A", "SHARED"] }, { familyId: "b", variants: ["B", "ＳＨＡＲＥＤ"] }]);
    expect(collide("A", "B")).toBeNull(); expect(collide("SHARED", "SHARED")).toBeNull(); expect(collide("A", "SHARED")).toBeNull();
    expect(VERIFIED_CHANNEL_REFERENCE_BRAND_FAMILIES.some(f => f.variants.some(v => /murata/i.test(v)))).toBe(false);
  });
});
