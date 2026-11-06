import type { RankedInventoryRow } from "../db";

type SearchInventory = Omit<RankedInventoryRow, "rankingScore" | "rankingComponents">;

/** Existing authenticated card fields only. Future/private DB fields must opt in explicitly. */
export function authenticatedSearchItem(item: SearchInventory) {
  return {
    id: item.id,
    partNumber: item.partNumber,
    brand: item.brand,
    category: item.category,
    pkg: item.pkg,
    prodYear: item.prodYear,
    dateCode: item.dateCode,
    qtyOnSale: item.qtyOnSale,
    qtyOrder: item.qtyOrder,
    priceEx: item.priceEx,
    taxIncluded: item.taxIncluded,
    ladderPrices: item.ladderPrices,
    moq: item.moq,
    source: item.source,
    grade: item.grade,
    leadTime: item.leadTime,
    note: item.note,
    photos: item.photos?.map(photo => ({ key: photo.key, url: photo.url, name: photo.name, mimeType: photo.mimeType, size: photo.size })) ?? null,
    publishedAt: item.publishedAt,
    refreshedAt: item.refreshedAt,
    spotVerifiedAt: item.spotVerifiedAt,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    supplierAvatarUrl: item.supplierAvatarUrl,
    supplierAvatarDisplayMode: item.supplierAvatarDisplayMode,
    supplierAvatarCropZoom: item.supplierAvatarCropZoom,
    supplierAvatarCropX: item.supplierAvatarCropX,
    supplierAvatarCropY: item.supplierAvatarCropY,
    supplierCertified: item.supplierCertified,
    merchantSinceAt: item.merchantSinceAt,
    publicReviewCount: item.publicReviewCount,
    completedTradeCount: item.completedTradeCount,
    merchantTenureDays: item.merchantTenureDays,
    relevanceTier: item.relevanceTier,
    suspiciousPrice: item.suspiciousPrice,
    recommendationReasons: item.recommendationReasons,
  };
}
