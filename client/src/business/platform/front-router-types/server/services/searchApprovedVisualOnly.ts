import { dictLookup } from "../adminDb";
import {
  approvedMaterialGeneratedImagesForItems,
  normalizeGeneratedImagePartNumber,
} from "./materialGeneratedImages";

export type ApprovedVisualOnlyMaterial = {
  partNumber: string;
  brand: string;
  category: string;
  package: string;
  imageUrl: string;
};

type SearchContext = {
  keyword?: string;
  brand?: string;
  category?: string;
  pkg?: string;
  followedOnly?: boolean;
  page?: number;
  total: number;
};

type Lookup = typeof dictLookup;
type ApprovedLookup = typeof approvedMaterialGeneratedImagesForItems;

/**
 * A verified material is not an offer: no inventory ID, quantity, supplier or
 * price is returned. Dictionary status/safety and image approval are checked
 * on every request. Exact matching avoids reusing an adjacent package's image.
 */
export async function searchApprovedVisualOnly(
  context: SearchContext,
  deps: { lookup?: Lookup; approved?: ApprovedLookup } = {},
): Promise<ApprovedVisualOnlyMaterial | null> {
  const {
    keyword, brand, category, pkg, followedOnly, page = 1, total,
  } = context;
  const part = normalizeGeneratedImagePartNumber(keyword ?? "");
  if (total !== 0 || page !== 1 || brand && brand !== "all"
      || category && category !== "all" || pkg && pkg !== "all"
      || followedOnly || !/^[A-Z0-9][A-Z0-9._/+,-]{4,127}$/.test(part)) {
    return null;
  }
  try {
    const matches = await (deps.lookup ?? dictLookup)(part, 12);
    const exactMatches = matches.filter(item => normalizeGeneratedImagePartNumber(item.partNumber) === part);
    if (matches.length >= 12 || exactMatches.length !== 1) return null;
    const exact = exactMatches[0];
    const [image] = await (deps.approved ?? approvedMaterialGeneratedImagesForItems)([{ partNumber: part, brand: exact.brand, dictionaryMaterialId: exact.id }]);
    if (!image || image.partNumber !== part) return null;
    return {
      partNumber: exact.partNumber,
      brand: exact.brand,
      category: exact.category,
      package: exact.package,
      imageUrl: image.url,
    };
  } catch {
    // Image-only enhancement must not turn the ordinary search into a 500.
    return null;
  }
}
