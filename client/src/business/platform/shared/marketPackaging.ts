export const MARKET_PACKAGING_RULE_VERSION = "st-p6-c8t6-tr-v3-shared-market";
export type MarketPackagingGroup = {
  basePartNumber: string;
  brand: string;
  package: string;
  variants: Array<{ partNumber: string; packaging: string }>;
};
export function normalizeMarketPartNumber(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}
// Explicit, verified orderable parts only. Do not strip arbitrary suffixes.
// ST STM8S003F3P6: same TSSOP-20 / -40..85°C, Tube versus Tape and Reel.
// https://www.st.com/en/microcontrollers-microprocessors/stm8s003f3.html
const ST_P6: MarketPackagingGroup = {
  basePartNumber: "STM8S003F3P6",
  brand: "ST",
  package: "TSSOP-20",
  variants: [
    { partNumber: "STM8S003F3P6", packaging: "管装" },
    { partNumber: "STM8S003F3P6TR", packaging: "编带卷盘" },
  ],
};
// ST STM32F103C8T6: same LQFP-48 / -40..85°C, Tray versus Tape and Reel.
// https://www.st.com/en/microcontrollers-microprocessors/stm32f103c8.html
// https://www.digikey.com/en/products/detail/stmicroelectronics/STM32F103C8T6/1646338
const ST_C8T6: MarketPackagingGroup = {
  basePartNumber: "STM32F103C8T6",
  brand: "ST",
  package: "LQFP-48",
  variants: [
    { partNumber: "STM32F103C8T6", packaging: "托盘装" },
    { partNumber: "STM32F103C8T6TR", packaging: "编带卷盘" },
  ],
};
const VERIFIED_GROUPS: readonly MarketPackagingGroup[] = [ST_P6, ST_C8T6];
export function resolveMarketPackagingGroup(
  partNumber: string
): MarketPackagingGroup | null {
  const part = normalizeMarketPartNumber(partNumber);
  return (
    VERIFIED_GROUPS.find(group =>
      group.variants.some(variant => variant.partNumber === part)
    ) ?? null
  );
}
export function marketPackagingLookupKeys(partNumber: string): string[] {
  const exact = normalizeMarketPartNumber(partNumber);
  if (!exact) return [];
  const group = resolveMarketPackagingGroup(exact);
  return group
    ? [exact, ...group.variants.map(v => v.partNumber).filter(p => p !== exact)]
    : [exact];
}
/** 行情主价与历史采用固定顺序；库存和订货精确查找仍沿用原函数。 */
export function marketPackagingReferenceKeys(partNumber: string): string[] {
  const group = resolveMarketPackagingGroup(partNumber);
  return group
    ? [
        group.basePartNumber,
        ...group.variants
          .map(v => v.partNumber)
          .filter(p => p !== group.basePartNumber),
      ]
    : marketPackagingLookupKeys(partNumber);
}
export function isMarketPackagingBrandCompatible(
  partNumber: string,
  brand: string
): boolean {
  if (!resolveMarketPackagingGroup(partNumber)) return true;
  const name = normalizeMarketPartNumber(brand).replace(/[\s()（）._/\-]/g, "");
  return [
    "ST",
    "STMICROELECTRONICS",
    "意法半导体",
    "ST意法半导体",
    "意法半导体ST",
    "ST意法",
    "STM",
    "意法",
  ].includes(name);
}
export function marketPackagingLabel(partNumber: string): string {
  return (
    resolveMarketPackagingGroup(partNumber)?.variants.find(
      v => v.partNumber === normalizeMarketPartNumber(partNumber)
    )?.packaging ?? "包装待确认"
  );
}
export function isMarketPackagingPackageCompatible(
  partNumber: string,
  pkg: string | null | undefined
): boolean {
  const group = resolveMarketPackagingGroup(partNumber);
  if (
    !group ||
    !pkg?.trim() ||
    ["NA", "N/A", "/", "-", "未知"].includes(pkg.trim().toUpperCase())
  )
    return true;
  const normalizedPackage = (value: string) =>
    value.toUpperCase().replace(/[\s_-]/g, "");
  return normalizedPackage(pkg) === normalizedPackage(group.package);
}
