import { eq, or } from "drizzle-orm";
import { inventories } from "../../drizzle/schema";
import { packagingSearchLookupKeys } from "../../../shared/partNumber";

/** 完整型号搜索沿用公开查价口径：NFKC、去首尾空格、忽略大小写但保留订购后缀。 */
export function normalizeExactInventoryKeyword(value?: string) {
  return value?.normalize("NFKC").trim().toUpperCase() ?? "";
}

/** 公司主页、推荐、联想等可批量浏览入口统一使用的展示范围条件。 */
export function companyCatalogVisibleCondition() {
  return eq(inventories.companyCatalogVisible, true);
}

/**
 * 全局搜索可发现条件：普通浏览只看公司页展示库存；输入完整型号时额外放行
 * “仅搜索可见”库存。状态和库存数量由调用方继续统一约束。
 */
export function searchDiscoverableCondition(keyword?: string) {
  const normalized = normalizeExactInventoryKeyword(keyword);
  if (!normalized) return companyCatalogVisibleCondition();
  const packagingKeys = packagingSearchLookupKeys(normalized);
  return or(
    companyCatalogVisibleCondition(),
    eq(inventories.partNumberNormalized, normalized),
    ...(packagingKeys.length > 1
      ? packagingKeys
          .filter(key => key !== normalized)
          .map(key => eq(inventories.partNumberNormalized, key))
      : []),
  )!;
}
