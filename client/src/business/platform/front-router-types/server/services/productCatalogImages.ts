import {
  materialThumbnailUrls,
  warmupMaterialThumbnailIndex,
} from "../adminDb";
import {
  approvedMaterialGeneratedImageItemMap,
} from "./materialGeneratedImages";

export type ProductCatalogImage = {
  /** Catalog art only; supplier photos remain in the existing `photos` field. */
  thumbnailUrl: string | null;
  thumbnailSource: "dictionary" | "generated" | null;
};

type ProductCatalogImageCandidate = {
  partNumber: string;
  brand?: string | null;
  displayPartNumber?: string;
  /** Used only to avoid delaying a real supplier-photo card while the index is cold. */
  photos?: unknown;
};

const THUMBNAIL_WARMUP_WAIT_MS = 800;
let coldIndexWaitAttempted = false;

function hasSupplierPhotos(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "string") return Boolean(value);
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]" || trimmed === "null") return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    // Legacy rows may store a single URL rather than JSON.
    return true;
  }
}

/**
 * Wait briefly for the existing read-only dictionary cover index. The warmup promise
 * is always observed, including when the timeout wins, so a failed admin DB request
 * cannot surface as an unhandled rejection.
 */
async function waitForThumbnailIndex(maxWaitMs = THUMBNAIL_WARMUP_WAIT_MS): Promise<void> {
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, maxWaitMs);
    void Promise.resolve(warmupMaterialThumbnailIndex()).then(finish, finish);
  });
}

function safeDictionaryThumbnails(partNumbers: string[]): Record<string, string> {
  try {
    return materialThumbnailUrls(partNumbers);
  } catch {
    // The catalog image path is an enhancement. Inventory detail must remain readable.
    return {};
  }
}

/**
 * Adds a lightweight catalog thumbnail to inventory rows without fetching the full
 * material/specification document. Dictionary covers win; the approved generated
 * image service verifies exact part, brand and the actual dictionary identity.
 *
 * Supplier photos are deliberately never copied into `thumbnailUrl`: callers keep
 * those as independent real-photo evidence. Their presence only permits a fast path
 * while a cold catalog index is rebuilding.
 */
async function attachProductCatalogImagesWithinBudget<T extends ProductCatalogImageCandidate>(
  items: T[],
): Promise<Array<T & ProductCatalogImage>> {
  if (items.length === 0) return [];

  const partNumbers = Array.from(new Set(items.map(item => item.partNumber).filter(Boolean)));
  let dictionary = safeDictionaryThumbnails(partNumbers);
  const hasDictionaryHit = partNumbers.some(partNumber => Boolean(dictionary[partNumber]));
  const missing = items.filter(item => !dictionary[item.partNumber]);
  let generated = new Map<T, { url: string }>();

  // Keep item association; supplier photos and ordinary dictionary lookup remain unchanged.
  const generatedPromise: Promise<Map<T, { url: string }>> = missing.length > 0
    ? approvedMaterialGeneratedImageItemMap(missing).catch(() => new Map())
    : Promise.resolve(generated);

  // `materialThumbnailUrls` triggers its normal refresh asynchronously. On a cold
  // worker, give that same coalesced warmup a bounded chance only once per process
  // and only if the UI has no supplier photo to render immediately. Subsequent
  // requests retain the adminDb TTL-driven background warmup rather than forcing a
  // reload for every genuinely absent model.
  if (
    !hasDictionaryHit
    && !coldIndexWaitAttempted
    && items.some(item => !hasSupplierPhotos(item.photos))
  ) {
    coldIndexWaitAttempted = true;
    const warmupPromise = waitForThumbnailIndex();
    const first = await Promise.race([
      generatedPromise.then(map => ({ kind: "generated" as const, map })),
      warmupPromise.then(() => ({ kind: "warmup" as const })),
    ]);
    if (first.kind === "generated") {
      generated = first.map;
      // A fast approved fallback is useful immediately; do not hold first paint
      // for an empty dictionary index. If generated art is also absent, use the
      // remainder of the bounded wait for a possible dictionary result.
      if (generated.size === 0) {
        await warmupPromise;
        dictionary = safeDictionaryThumbnails(partNumbers);
      }
    } else {
      dictionary = safeDictionaryThumbnails(partNumbers);
      generated = await generatedPromise;
    }
  } else {
    generated = await generatedPromise;
  }

  return items.map(item => {
    const dictionaryUrl = dictionary[item.partNumber];
    if (dictionaryUrl) {
      return {
        ...item,
        thumbnailUrl: dictionaryUrl,
        thumbnailSource: "dictionary" as const,
      };
    }
    const generatedUrl = generated.get(item)?.url;
    if (generatedUrl) {
      return {
        ...item,
        thumbnailUrl: generatedUrl,
        thumbnailSource: "generated" as const,
      };
    }
    return {
      ...item,
      thumbnailUrl: null,
      thumbnailSource: null,
    };
  });
}

/** Bound the whole optional image enhancement, including generated-image DB reads. */
export async function attachProductCatalogImages<T extends ProductCatalogImageCandidate>(
  items: T[],
): Promise<Array<T & ProductCatalogImage>> {
  if (!items.length) return [];
  return new Promise(resolve => {
    let settled = false;
    const finish = (rows: Array<T & ProductCatalogImage>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(rows);
    };
    const fallback = () => items.map(item => ({ ...item, thumbnailUrl: null, thumbnailSource: null }));
    const timer = setTimeout(() => finish(fallback()), THUMBNAIL_WARMUP_WAIT_MS);
    // Always observe completion/rejection even after the budget has elapsed.
    void attachProductCatalogImagesWithinBudget(items).then(finish, () => finish(fallback()));
  });
}
