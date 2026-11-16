import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { inventories } from "../../drizzle/schema";
import { canonicalOfficialInventoryJson } from "../../../shared/internalBusinessOfficialInventory";

/** All public/confirmation content; native publishing state and audit clocks are deliberately excluded. */
export const MALL_INVENTORY_CONTENT_FIELDS = ["id", "userId", "enterpriseId", "ownerUserId", "ownershipVersion", "partNumber", "brand", "category", "pkg", "dateCode", "prodYear", "qtyOnSale", "qtyStock", "qtyOrder", "priceEx", "priceIncl", "taxIncluded", "invoice", "ladderPrices", "moq", "spq", "source", "grade", "leadTime", "warehouseAddress", "rohs", "note", "photos", "companyCatalogVisible"] as const;
export function mallInventoryFingerprint(inventory: Record<string, unknown>): string {
  const content = Object.fromEntries(MALL_INVENTORY_CONTENT_FIELDS.map(field => [field, inventory[field] ?? null]));
  return createHash("sha256").update(canonicalOfficialInventoryJson(content)).digest("hex");
}
/** Compute AND compare in SQL, using identical column types/serialization. Stock reservation/restoration
 * changes qtyOnSale, not confirmed trading terms. Manual quantity/content changes invalidate the sidecar.
 * This persisted proof is deliberately separate from the full client CAS fingerprint. */
export function mallInventoryContentProofSql(): SQL {
  const fields = MALL_INVENTORY_CONTENT_FIELDS.filter(field => field !== "qtyOnSale" && field !== "qtyStock");
  const pairs = fields.flatMap(field => [sql`${field}`, sql`${inventories[field]}`]);
  return sql`SHA2(CAST(JSON_OBJECT(${sql.join(pairs, sql`, `)}) AS CHAR), 256)`;
}
