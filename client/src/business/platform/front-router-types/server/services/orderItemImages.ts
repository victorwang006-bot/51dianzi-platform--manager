import { materialThumbnailUrls } from "../adminDb";
import { approvedMaterialGeneratedImageItemMap } from "./materialGeneratedImages";

/** 调用者必须先按当前用户查出订单；只丰富图片，不改订单快照或交易字段。 */
export async function withOrderItemImages<T extends { partNumber: string; brand?: string | null }>(items: T[]) {
  const partNumbers = Array.from(new Set(items.map(item => item.partNumber).filter(Boolean)));
  const dictionary = materialThumbnailUrls(partNumbers);
  const generated = new Map<T, string>();
  const missing = items.filter(item => !dictionary[item.partNumber]);
  // Keep existing serial batching; inventoryId/orderItem.id are never dictionary IDs.
  for (let offset = 0; offset < missing.length; offset += 100) {
    try {
      const batch = await approvedMaterialGeneratedImageItemMap(missing.slice(offset, offset + 100));
      for (const [item, image] of Array.from(batch.entries())) generated.set(item, image.url);
    } catch { break; }
  }
  return items.map(item => ({ ...item, thumbnailUrl: dictionary[item.partNumber] || generated.get(item) || null }));
}
