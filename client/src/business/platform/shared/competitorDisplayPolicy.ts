const COMPETITOR_DISPLAY_MARKERS = [
  "立创",
  "SZLCSC",
  "LCSC",
  "JLCPCB",
  "JLCSMT",
  "JLC3DP",
  "JLCMC",
  "JLCEDA",
] as const;

function normalizeCompetitorText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._\-/\\]+/g, "");
}

export function containsCompetitorDisplayName(value: unknown): boolean {
  const normalized = normalizeCompetitorText(value);
  return normalized.length > 0 && COMPETITOR_DISPLAY_MARKERS.some(marker => normalized.includes(marker));
}

export function sanitizeCompetitorDisplayText(value: unknown): string {
  const text = String(value ?? "").trim();
  return containsCompetitorDisplayName(text) ? "" : text;
}

export function materialMetadataContainsCompetitor(value: {
  name?: unknown;
  brand?: unknown;
  category?: unknown;
  description?: unknown;
}): boolean {
  return [value.name, value.brand, value.category, value.description].some(containsCompetitorDisplayName);
}

export const COMPETITOR_DISPLAY_VALIDATION_MESSAGE = "该内容包含平台不展示的第三方平台名称，请改用通用品类或制造商品牌";
