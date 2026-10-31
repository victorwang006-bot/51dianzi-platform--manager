import {
  dictReferencePriceBatchMeta,
  dictReferencePriceForBatch,
} from "../adminDb";

/**
 * BOM参考价固定使用已人工确认的第6批。
 * 不跟随最新active批次自动切换，避免未经审核的新价格表改变BOM口径。
 */
export const BOM_REFERENCE_PRICE_BATCH_ID = 6;

export type BomReferencePriceResult = {
  ok: boolean;
  partNumber: string | null;
  matchedPartNumber: string | null;
  price: string | null;
  quantityThreshold: number | null;
  matchedBy: "exact" | "compact" | "alias" | "material_alias" | null;
  batchId: number;
  priceUpdatedAt: string | null;
  reason: string | null;
};

function isoTimestamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function failure(
  partNumber: string | null,
  reason: string
): BomReferencePriceResult {
  return {
    ok: false,
    partNumber,
    matchedPartNumber: null,
    price: null,
    quantityThreshold: null,
    matchedBy: null,
    batchId: BOM_REFERENCE_PRICE_BATCH_ID,
    priceUpdatedAt: null,
    reason,
  };
}

/**
 * 查询BOM价格库参考价。
 *
 * 仅返回型号、价格、数量档、批次号和更新时间；不返回价格表中的品牌、名称、
 * 图片、来源文件或外部链接，避免第三方标识进入BOM页面。
 */
export async function queryBomReferencePrice(
  partNumber: string
): Promise<BomReferencePriceResult> {
  const normalized = partNumber.normalize("NFKC").trim().toUpperCase();
  if (!normalized) return failure(null, "型号不能为空");

  try {
    const [price, meta] = await Promise.all([
      dictReferencePriceForBatch(normalized, BOM_REFERENCE_PRICE_BATCH_ID),
      dictReferencePriceBatchMeta(BOM_REFERENCE_PRICE_BATCH_ID),
    ]);

    if (!meta || !["active", "archived"].includes(meta.status)) {
      return failure(normalized, "价格库批次暂不可用");
    }
    if (!price || !Number.isFinite(price.basePrice) || price.basePrice <= 0) {
      return failure(normalized, "第6批价格库暂无可靠参考价");
    }

    return {
      ok: true,
      partNumber: normalized,
      matchedPartNumber: price.partNumber,
      price: price.basePrice.toFixed(2),
      quantityThreshold: Math.max(1, Number(price.quantityThreshold || 1)),
      matchedBy: price.matchedBy,
      batchId: BOM_REFERENCE_PRICE_BATCH_ID,
      priceUpdatedAt: isoTimestamp(meta.activatedAt),
      reason: null,
    };
  } catch (error) {
    console.error("[bomReferencePrice] 第6批价格查询失败:", error);
    return failure(normalized, "价格库暂时不可用，请直接询价");
  }
}
