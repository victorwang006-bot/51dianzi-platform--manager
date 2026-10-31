const HIDDEN_DEMAND_CATEGORY_LABELS = new Set([
  "平台在用",
  "555",
  "555定时器/计时器",
]);

export function normalizeDemandCategoryLabel(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").replaceAll("／", "/").trim();
}

/**
 * 隐藏仅用于内部说明或明显错误的品类文案；其余真实品类继续保留。
 */
export function isVisibleDemandCategory(value: string) {
  const normalized = normalizeDemandCategoryLabel(value);
  return Boolean(normalized) && !HIDDEN_DEMAND_CATEGORY_LABELS.has(normalized);
}
