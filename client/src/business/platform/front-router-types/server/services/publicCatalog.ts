import { and, asc, eq, like, sql } from "drizzle-orm";
import { inventories } from "../../drizzle/schema";
import { getDb } from "../db";
import { companyCatalogVisibleCondition, searchDiscoverableCondition } from "./inventoryVisibility";

/**
 * Anonymous catalog responses deliberately expose no inventory-row identity,
 * price, quantity, supplier, count, or ranking data. Keep this service separate
 * from the authenticated quotation search so those projections cannot drift
 * into an anonymous endpoint by accident.
 */
export type PublicCatalogItem = {
  partNumber: string;
  brand: string;
  availability: "in_stock" | "unknown";
};

export type PublicCatalogPage = {
  items: PublicCatalogItem[];
  hasMore: boolean;
};

/** LIKE metacharacters are rejected at the router boundary and escaped here as defense in depth. */
export const PUBLIC_CATALOG_LIKE_METACHARACTERS = /[\\%_]/;

export function hasPublicCatalogLikeMetacharacters(value: string): boolean {
  return PUBLIC_CATALOG_LIKE_METACHARACTERS.test(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function normalizeKeyword(keyword?: string): string | undefined {
  const normalized = keyword?.normalize("NFKC").trim();
  if (!normalized) return undefined;
  if (hasPublicCatalogLikeMetacharacters(normalized)) {
    throw new Error(
      "Public catalog keywords cannot contain SQL LIKE metacharacters"
    );
  }
  return normalized;
}

function normalizeBrand(brand?: string): string | undefined {
  const normalized = brand?.normalize("NFKC").trim();
  if (!normalized) return undefined;
  if (hasPublicCatalogLikeMetacharacters(normalized)) {
    throw new Error(
      "Public catalog brands cannot contain SQL LIKE metacharacters"
    );
  }
  return normalized;
}

function publicCatalogConditions(keyword?: string, brand?: string) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const normalizedBrand = normalizeBrand(brand);
  return and(
    eq(inventories.status, "published" as const),
    // Search-only listings remain discoverable by complete model match, not browsing.
    searchDiscoverableCondition(normalizedKeyword),
    normalizedKeyword
      ? like(
          inventories.partNumberNormalized,
          `%${escapeLike(normalizedKeyword.toUpperCase())}%`
        )
      : undefined,
    normalizedBrand ? eq(inventories.brand, normalizedBrand) : undefined
  );
}

const publicCatalogProjection = {
  // Group by normalized model and brand; seller-row multiplicity stays hidden.
  partNumber: sql<string>`MIN(${inventories.partNumber})`,
  brand: inventories.brand,
  availability: sql<"in_stock" | "unknown">`
    CASE WHEN MAX(CASE WHEN ${inventories.qtyOnSale} > 0 THEN 1 ELSE 0 END) = 1
      THEN 'in_stock' ELSE 'unknown' END`,
};

/**
 * Read one bounded, alphabetically ordered page of public models. `hasMore` is
 * intentionally the only pagination metadata: total and page count are not
 * calculated because they are inventory-volume side channels.
 */
export async function listPublicCatalogPreviews(input: {
  keyword?: string;
  brand?: string;
  page: number;
  pageSize: number;
}): Promise<PublicCatalogPage> {
  const db = await getDb();
  if (!db) return { items: [], hasMore: false };

  const page = Math.max(1, Math.trunc(input.page));
  const pageSize = Math.min(20, Math.max(1, Math.trunc(input.pageSize)));
  const rows = await db
    .select(publicCatalogProjection)
    .from(inventories)
    .where(publicCatalogConditions(input.keyword, input.brand))
    .groupBy(inventories.partNumberNormalized, inventories.brand)
    // Never order by price, quantity, seller, freshness, or a relevance score.
    .orderBy(
      asc(inventories.partNumberNormalized),
      asc(inventories.brand)
    )
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  return {
    items: rows.slice(0, pageSize).map(row => ({
      partNumber: row.partNumber,
      brand: row.brand,
      availability: row.availability === "in_stock" ? "in_stock" : "unknown",
    })),
    hasMore: rows.length > pageSize,
  };
}

/** Anonymous type-ahead uses the same aggregate-only projection as catalog preview. */
export async function suggestPublicCatalog(
  keyword: string,
  limit: number
): Promise<PublicCatalogItem[]> {
  return (
    await listPublicCatalogPreviews({ keyword, page: 1, pageSize: limit })
  ).items;
}

/**
 * Resolve an opaque legacy inventory id to a public model summary. The id is
 * only a lookup input and is never returned. Off-shelf and catalog-hidden rows
 * resolve to null, exactly like nonexistent rows.
 */
export async function getPublicCatalogPreviewDetail(
  id: number
): Promise<PublicCatalogItem | null> {
  const db = await getDb();
  if (!db) return null;

  const matched = await db
    .select({ partNumberNormalized: inventories.partNumberNormalized, brand: inventories.brand })
    .from(inventories)
    .where(
      and(
        eq(inventories.id, id),
        eq(inventories.status, "published" as const),
        companyCatalogVisibleCondition()
      )
    )
    .limit(1);
  const partNumberNormalized = matched[0]?.partNumberNormalized;
  if (!partNumberNormalized) return null;

  const rows = await db
    .select(publicCatalogProjection)
    .from(inventories)
    .where(
      and(
        publicCatalogConditions(),
        eq(inventories.partNumberNormalized, partNumberNormalized),
        eq(inventories.brand, matched[0].brand)
      )
    )
    .groupBy(inventories.partNumberNormalized, inventories.brand)
    .limit(1);
  const item = rows[0];
  if (!item) return null;
  return {
    partNumber: item.partNumber,
    brand: item.brand,
    availability: item.availability === "in_stock" ? "in_stock" : "unknown",
  };
}
