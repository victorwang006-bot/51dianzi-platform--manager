export type RawBrandCount = {
  brand: string | null;
  count: number;
};

export type BrandFacet = {
  brand: string;
  count: number;
  rawBrands: string[];
};

const CANONICAL_BRANDS = new Map<string, string>([
  ["TI", "TI"],
  ["TEXAS INSTRUMENTS", "TI"],
  ["德州仪器", "TI"],
  ["MURATA", "Murata"],
  ["村田", "Murata"],
  ["ONSEMI", "onsemi"],
  ["ON", "onsemi"],
  ["ON SEMICONDUCTOR", "onsemi"],
  ["安森美", "onsemi"],
  ["ST", "ST"],
  ["STM", "ST"],
  ["STMICROELECTRONICS", "ST"],
  ["意法", "ST"],
  ["意法半导体", "ST"],
  ["ADI", "ADI"],
  ["ANALOG DEVICES", "ADI"],
  ["亚德诺", "ADI"],
  ["INFINEON", "Infineon"],
  ["英飞凌", "Infineon"],
  ["NXP", "NXP"],
  ["恩智浦", "NXP"],
  ["MICROCHIP", "Microchip"],
  ["MCHP", "Microchip"],
  ["微芯", "Microchip"],
  ["VISHAY", "Vishay"],
  ["威世", "Vishay"],
  ["PANASONIC", "Panasonic"],
  ["松下", "Panasonic"],
  ["SAMSUNG", "Samsung"],
  ["三星", "Samsung"],
  ["YAGEO", "YAGEO"],
  ["国巨", "YAGEO"],
  ["TOSHIBA", "Toshiba"],
  ["东芝", "Toshiba"],
  ["RENESAS", "Renesas"],
  ["瑞萨", "Renesas"],
  ["ROHM", "ROHM"],
  ["罗姆", "ROHM"],
  ["WINBOND", "Winbond"],
  ["华邦", "Winbond"],
  ["GIGADEVICE", "GigaDevice"],
  ["GD", "GigaDevice"],
  ["兆易创新", "GigaDevice"],
  ["NEXPERIA", "Nexperia"],
  ["安世", "Nexperia"],
  ["PUYA", "PUYA"],
  ["普冉", "PUYA"],
  ["SGMICRO", "SGMICRO"],
  ["圣邦微", "SGMICRO"],
  ["CJ", "CJ"],
  ["长晶", "CJ"],
  ["FH", "FH"],
  ["风华", "FH"],
  ["AISHI", "AISHI"],
  ["艾华", "AISHI"],
  ["MICRON", "Micron"],
  ["美光", "Micron"],
]);

const NON_BRAND_SUFFIX = /(?:\/?(?:给钱就卖|刚到货|原\s*标原盘|底裤亏光价|专做军工|大佬|全线)|(?:产品部|市场部))[)）]*$/i;
const PACKAGE_AS_BRAND = /^(?:DIP|SOP|SOD|SOT|TSOP|TO)[-_]?\d+(?:[-_]\d+)?[A-Z]?$/i;

function removeNonBrandSuffix(value: string): string {
  let result = value.trim();
  while (NON_BRAND_SUFFIX.test(result)) {
    result = result.replace(NON_BRAND_SUFFIX, "").trim();
  }
  return result;
}

/**
 * 把公开品牌筛选参数收敛为稳定名称。
 *
 * 仅处理能够从文本结构确定的情况：Unicode/空白、营销后缀、括号或斜杠中文名、
 * 已确认的常见品牌别名。未知品牌保留首段原文，不做相似度猜测。
 */
export function normalizeBrandFacet(raw: string | null | undefined): string {
  let text = String(raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = removeNonBrandSuffix(text);
  if (!text) return "";

  // “ST”也被先科使用，不能与意法半导体 ST 合并。
  if (/^ST\s*[/(]\s*先科/i.test(text)) return "ST（先科）";

  const primary = removeNonBrandSuffix(text.split(/[/(]/)[0] ?? "");
  if (!primary || PACKAGE_AS_BRAND.test(primary)) return "";
  const canonical = CANONICAL_BRANDS.get(primary.toLocaleUpperCase("en-US"));
  return canonical ?? primary;
}

/** 合并规范品牌，并保留全部原始写法供服务端筛选使用。 */
export function groupBrandFacets(rows: RawBrandCount[]): BrandFacet[] {
  const groups = new Map<
    string,
    { brand: string; count: number; variants: Array<{ brand: string; count: number }> }
  >();

  for (const row of rows) {
    const rawBrand = String(row.brand ?? "").trim();
    const normalized = normalizeBrandFacet(rawBrand);
    const count = Number(row.count ?? 0);
    if (!rawBrand || !normalized || !Number.isFinite(count) || count <= 0) continue;

    const key = normalized.toLocaleUpperCase("en-US");
    const current = groups.get(key) ?? { brand: normalized, count: 0, variants: [] };
    current.count += count;
    current.variants.push({ brand: rawBrand, count });
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map(group => ({
      brand: group.brand,
      count: group.count,
      rawBrands: group.variants
        .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, "zh-CN"))
        .map(item => item.brand),
    }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, "zh-CN"));
}
