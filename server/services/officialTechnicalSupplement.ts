import { officialTechnicalDigest, projectPreparedOfficialTechnical, type OfficialTechnicalDictionaryRead, type OfficialTechnicalIdentity } from "./officialTechnicalResource";
import { officialMaterialPackageMatches } from "./officialTechnicalSafety";
import type { OfficialMaterialDictionary } from "./officialTechnicalTypes";

/** Reviewed exact ordering code only. Sources were verified by the task owner; no network/market scraping here.
 * Winbond Rev. C, 2022-02-07: Features p.7; ordering p.71–72 resolves ZE/I/R and fixed BUF=1.
 * TechDesign is a secondary exact-model cross-check, NEVER a price, MOQ or stock source.
 * Do not generalize to W25N04KV, xxIRU, another suffix/package/temperature/BUF variant. */
export const W25N04KVZEIR_TECHNICAL_SOURCE = Object.freeze({
  version: "winbond-w25n04kvzeir-revc-20220207-v3",
  partNumber: "W25N04KVZEIR",
  datasheetUrl: "https://www.winbond.com/resource-files/W25N04KVxxIRU_Datasheet_20220207_RevC.pdf",
  datasheetSha256: "050c3a3c22a8eb8b055307abf930b739860d9f726edd4b69ac607ddb5c8d9976",
  datasheetPages: Object.freeze([7, 71, 72]),
  crossCheckUrl: "https://www.techdesign.com/market/winbond/product-detail/wec000372/w25n04kvzeir",
  package: "WSON-8(8x6mm)",
  specs: Object.freeze({
    "存储类型": "SLC NAND Flash",
    "存储容量": "4G-bit / 512M-Byte",
    "接口": "SPI / Dual SPI / Quad SPI",
    "工作电压": "2.7–3.6 V",
    "最大时钟频率": "104 MHz",
    "温度等级": "工业级",
    "工作温度": "-40 至 +85 °C",
    "封装": "WSON-8",
    "封装尺寸": "8 × 6 mm",
    "块大小": "128K-Byte",
    "页大小": "2K-Byte",
    "ECC": "8-bit ECC",
    "编程/擦除循环": "60,000 次",
    "数据保持": "10 年",
    "绿色封装": "R（绿色封装）",
    "BUF": "1（固定）",
  }),
  // Read-only live-source verification supplied by the task owner; preserve these 13
  // existing values verbatim. They authenticate ONLY the exact composite-brand path.
  preservedSpecs: Object.freeze({
    "ECC": "有",
    "功能特性": "硬件写保护功能；读缓存功能；OTP区域写保护与锁定功能；ECC纠错功能；软件复位功能；写使能锁存；软件写保护功能",
    "存储容量": "4Gbit", "工作温度": "-40℃~+85℃", "工作电压": "2.7V~3.6V",
    "待机电流": "20uA", "接口类型": "SPI", "擦写寿命": "6万次", "时钟频率(fc)": "104MHz",
    "写周期时间(Tw)": "-", "块擦除时间(tBE)": "10ms", "页写入时间(Tpp)": "250us", "数据保留 - TDR(年)": "10年",
  }),
});
/** ST official product page lists this COMPLETE orderable code and links DS7147 Rev 10.
 * PDF p.98: F=20 pins, P=TSSOP, 6=-40..85 C ambient, TR=tape/reel.
 * p.49 Table 19: junction -40..105 C is NOT the ambient operating-temperature rating.
 * This source supplies only a missing PDF, NEVER parameters or commercial fields. */
export const STM8S003F3P6TR_DATASHEET_SOURCE = Object.freeze({
  version: "st-stm8s003f3p6tr-ds7147-rev10-201808-v1",
  partNumber: "STM8S003F3P6TR",
  productUrl: "https://www.st.com/en/microcontrollers-microprocessors/stm8s003f3.html",
  datasheetUrl: "https://www.st.com/resource/en/datasheet/stm8s003f3.pdf",
  datasheetPages: Object.freeze([49, 91, 98]),
  document: "DS7147 Rev 10",
  // Hash of the saved official-PDF extracted Markdown, not raw PDF bytes (curl transport failed).
  officialPdfExtractSha256: "1ed02dbfae0be8c0bffefaa9383fcca8667d3e064592cdcc8c11673985cb390e",
  package: "TSSOP-20",
  ambientTemperature: "-40 to +85 °C",
  ordering: "F=20 pins; P=TSSOP; 6=-40 to +85 °C; TR=Tape and reel",
});
const normalize = (value: string) => value.normalize("NFKC").trim().toUpperCase();
// Exact reviewed spellings, local to this single part; no global brand matcher relaxation.
const WINBOND_BRANDS = new Set(["WINBOND", "华邦", "华邦电子", "WINBOND/华邦", "WINBOND(华邦)", "华邦(WINBOND)"]);
function eligible(identity: OfficialTechnicalIdentity): boolean {
  if (normalize(identity.partNumber) !== W25N04KVZEIR_TECHNICAL_SOURCE.partNumber || !WINBOND_BRANDS.has(normalize(identity.brand)) || !identity.pkg.trim()) return false;
  // The task owner's read-only live identity is WSON-8(6x8). 6x8 and official 8x6 are
  // rotation-equivalent ONLY within this exact reviewed supplement, never globally.
  return officialMaterialPackageMatches(identity.pkg, W25N04KVZEIR_TECHNICAL_SOURCE.package)
    || /^WSON-?8\(6(?:\.0+)?[X×]8(?:\.0+)?(?:MM)?\)$/.test(normalize(identity.pkg).replace(/\s/g, ""));
}
function dictionaryFor(identity: OfficialTechnicalIdentity): NonNullable<OfficialMaterialDictionary> {
  return {
    partNumber: W25N04KVZEIR_TECHNICAL_SOURCE.partNumber,
    brand: identity.brand, package: identity.pkg,
    name: "Winbond W25N04KVZEIR SLC NAND Flash",
    category: "SLC NAND Flash",
    description: "Winbond 官方数据手册 Rev. C（2022-02-07），完整订购型号 W25N04KVZEIR。",
    specs: { ...W25N04KVZEIR_TECHNICAL_SOURCE.specs },
    datasheetUrl: W25N04KVZEIR_TECHNICAL_SOURCE.datasheetUrl,
  };
}
/** Authenticate the WHOLE locally reviewed dictionary, not merely a brand/model/URL marker.
 * Enables a local canonical-brand projection through the existing sanitizer for this source only.
 * Any tampered/extra/missing parameter or metadata fails and goes through original strict gates. */
export function isReviewedW25N04KVZEIRSupplement(identity: OfficialTechnicalIdentity, dictionary: NonNullable<OfficialMaterialDictionary>): boolean {
  return eligible(identity) && officialTechnicalDigest(dictionary) === officialTechnicalDigest(dictionaryFor(identity));
}
/** Local alias projection for the authenticated, read-only verified 13 existing values.
 * It NEVER changes the stored/global brand matcher or bypasses original text/URL/field gates. */
export function isReviewedW25N04KVZEIRExistingSource(identity: OfficialTechnicalIdentity, dictionary: NonNullable<OfficialMaterialDictionary>): boolean {
  return matchesW25N04KVZEIRSourceIdentity(identity, dictionary)
    && officialTechnicalDigest(dictionary.specs) === officialTechnicalDigest(W25N04KVZEIR_TECHNICAL_SOURCE.preservedSpecs);
}
/** Supplement only a proven miss or genuinely empty dictionary. Errors/ambiguity NEVER become ready.
 * Every identity of the exact part shares the same source digest, including incompatible sibling identities.
 * Digest binds the original DB read AND the complete reviewed source record; no raw provenance URL leaks
 * through parameter values. Store identity/revision/ticket/projection checks remain unchanged. */
export function supplementOfficialTechnicalRead(identity: OfficialTechnicalIdentity, original: OfficialTechnicalDictionaryRead): OfficialTechnicalDictionaryRead {
  if (!/^[0-9a-f]{64}$/.test(original.sourceVersion)) return original;
  if (normalize(identity.partNumber) === STM8S003F3P6TR_DATASHEET_SOURCE.partNumber) {
    // Same digest for all siblings, even rejected brands/packages, preserving source-key protocol.
    const sourceVersion = officialTechnicalDigest({ originalSourceVersion: original.sourceVersion, reviewedSupplement: STM8S003F3P6TR_DATASHEET_SOURCE });
    const unchanged = { ...original, sourceVersion };
    if (original.state !== "matched" || !eligibleST(identity)
      || !eligibleST({ ...identity, partNumber: original.dictionary.partNumber, brand: original.dictionary.brand, pkg: original.dictionary.package })
      || original.dictionary.datasheetUrl != null && original.dictionary.datasheetUrl !== ""
      || projectPreparedOfficialTechnical(identity, original).state !== "ready") return unchanged;
    return { ...original, sourceVersion, dictionary: { ...original.dictionary, datasheetUrl: STM8S003F3P6TR_DATASHEET_SOURCE.datasheetUrl } };
  }
  if (normalize(identity.partNumber) !== W25N04KVZEIR_TECHNICAL_SOURCE.partNumber) return original;
  const sourceVersion = officialTechnicalDigest({ originalSourceVersion: original.sourceVersion, reviewedSupplement: W25N04KVZEIR_TECHNICAL_SOURCE });
  const unchanged = { ...original, sourceVersion };
  if (original.state === "unavailable" || !eligible(identity)) return unchanged;
  if (original.state === "matched") {
    if (!matchesW25N04KVZEIRSourceIdentity(identity, original.dictionary)) return unchanged;
    if (Object.keys(original.dictionary.specs).length > 0) {
      if (original.dictionary.datasheetUrl != null && original.dictionary.datasheetUrl !== ""
        || projectPreparedOfficialTechnical(identity, original).state !== "ready") return unchanged;
      return { ...original, sourceVersion, dictionary: { ...original.dictionary, datasheetUrl: W25N04KVZEIR_TECHNICAL_SOURCE.datasheetUrl } };
    }
    if (original.dictionary.datasheetUrl) return unchanged;
  }
  return { state: "matched", sourceVersion, dictionary: dictionaryFor(identity) };
}

/** Local exact source identity matching for detecting corrupt/ambiguous existing rows.
 * Only this reviewed model/manufacturer/package; other dictionaries use their original matcher. */
export function matchesW25N04KVZEIRSourceIdentity(identity: OfficialTechnicalIdentity, row: {partNumber:string;brand:string|null;package:string|null}): boolean {
  return eligible(identity) && eligible({...identity,partNumber:row.partNumber,brand:row.brand??"",pkg:row.package??""});
}

// Do not change the shared matcher. Bare reviewed package spellings only; no invented dimensions.
const ST_BRANDS = new Set(["ST", "STM", "STMICROELECTRONICS", "意法", "意法半导体", "ST(意法半导体)", "ST/意法半导体"]);
function eligibleST(identity: OfficialTechnicalIdentity): boolean {
  return normalize(identity.partNumber) === STM8S003F3P6TR_DATASHEET_SOURCE.partNumber
    && ST_BRANDS.has(normalize(identity.brand)) && /^TSSOP-?20$/.test(normalize(identity.pkg));
}
