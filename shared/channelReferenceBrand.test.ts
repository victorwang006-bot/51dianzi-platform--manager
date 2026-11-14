import { describe, expect, it } from "vitest";
import { matchChannelReferenceBrand, normalizeChannelReferenceBrand, VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS } from "./channelReferenceBrand";

describe("finite approved whole-brand directed matching", () => {
  it.each(VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS)("permits approved input %s => entire observed %s", (input, observed) => {
    for (const profile of ["snapshot", "lcsc", "ickey"] as const) {
      expect(matchChannelReferenceBrand(input, observed, { profile })).toBe("explicit_alias");
      expect(matchChannelReferenceBrand(input.toUpperCase(), observed.toLowerCase(), { profile })).toBe("explicit_alias");
      for (const suffix of ["/Other", "(Other)", " Extra"]) expect(matchChannelReferenceBrand(input, observed + suffix, { profile })).toBeNull();
    }
  });
  it.each([
    ["ST", "ST(先科)"], ["先科", "ST MICROELECTRONICS"], ["ST(先科)", "STMicroelectronics"],
    ["JSCJ", "JCET"], ["JSCJ", "长电"], ["JSCJ", "CJ/江苏长晶(长电)"], ["JCET", "CJ/江苏长晶(长电)"],
    ["CJ", "CJ/江苏长晶(长电)"], ["长电", "JSCJ(江苏长晶)"],
    ["ORMOM", "OMRON(欧姆龙)"], ["ORMON", "OMRON(欧姆龙)"], ["INRINEON", "Infineon(英飞凌)"], ["WINBOD", "WINBOND(华邦)"],
    ["XKB", "XKB Other/中国星坤"], ["XKB", "XKB Connection"], ["XKB", "中国星坤"],
    ["Taiyo", "TAIYO YUDEN"], ["长江", "cjiang(长江微电)"], ["TAE(雅晶鑫)", "YJX(雅晶鑫)"],
    ["ON", "MOTOROLA"], ["ON", "HGC(深圳汉芯)"],
    ["TE", "TE Connectivity/POTTER&BRUMFIELD"], ["TI", "Texas Instruments Other"],
  ])("rejects unverified/other-brand whole direction %s => %s", (input, observed) => {
    expect(matchChannelReferenceBrand(input, observed)).toBeNull();
  });
  it("does not create reverse or transitive edges even with shared observed targets", () => {
    expect(matchChannelReferenceBrand("顺络", "SUNLORD(顺络)")).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("SUNLORD", "SUNLORD(顺络)")).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("顺络", "SUNLORD")).toBeNull();
    expect(matchChannelReferenceBrand("SUNLORD(顺络)", "顺络")).toBeNull();
    expect(matchChannelReferenceBrand("TE Connectivity", "TE")).toBeNull();
  });
  it("keeps snapshot width/whitespace semantics but allows provider-specific exact normalizers", () => {
    expect(normalizeChannelReferenceBrand(" ＸＫＢ ")).toBe("XKB");
    expect(matchChannelReferenceBrand("ＫＯＡ", " k o a ")).toBe("exact");
    expect(matchChannelReferenceBrand("KOA", "ⓀⓄⒶ")).toBeNull();
    const exact = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
    expect(matchChannelReferenceBrand("KOA", "K O A", { profile: "ickey", normalize: exact })).toBeNull();
    expect(matchChannelReferenceBrand("XKB", "XKB CONNECTION/中国星坤", { profile: "ickey", normalize: exact })).toBe("explicit_alias");
    expect(matchChannelReferenceBrand("Murata", "Murata(村田)", { profile: "ickey", normalize: exact })).toBeNull();
  });
});
