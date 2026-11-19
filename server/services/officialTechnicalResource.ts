import { createHash } from "node:crypto";
import { z } from "zod";
import type { OfficialMaterialResource, OfficialMaterialDictionary } from "./officialTechnicalTypes";
import { officialMaterialBrandMatches, officialMaterialPackageMatches, officialMaterialSafeText, officialMaterialDatasheetUrl, projectOfficialMaterialResource } from "./officialTechnicalSafety";
import { isReviewedW25N04KVZEIRSupplement, isReviewedW25N04KVZEIRExistingSource } from "./officialTechnicalSupplement";

export const OFFICIAL_TECHNICAL_PROJECTION_VERSION = "official-safe-technical-v1";
export const OFFICIAL_TECHNICAL_PARAMETER_LIMIT = 1000;
const safeText = (max: number) => z.string().max(max).refine(value => value === "" || officialMaterialSafeText(value, max) === value);
// Exact canonical names only: technical channel counts are not inventory quantities.
const FINANCIAL_PARAMETER_NAMES = new Set([
  "price", "unitprice", "saleprice", "purchaseprice", "cost", "unitcost",
  "quote", "quoteprice", "quotation", "stock", "stockqty", "stockquantity", "inventory", "inventoryqty",
  "inventoryquantity", "quantity", "qty", "availablequantity", "价格", "单价", "售价", "采购价", "成本",
  "报价", "报价金额", "库存", "库存量", "库存数量", "数量",
  "moq", "spq", "minimumorderquantity", "minorderquantity", "minorder", "minimumorder", "起订", "起订量", "最小起订量", "最小订购量",
  "qtystock", "qtyorder", "qtyonsale",
]);
const officialTechnicalParameterSchema = z.object({ name: safeText(128).refine(Boolean), value: safeText(2048).refine(Boolean) }).strict().refine(value => {
  const name = value.name.normalize("NFKC").trim().toLowerCase().replace(/[\s_.-]+/g, "");
  return !FINANCIAL_PARAMETER_NAMES.has(name)
    || name === "数量" && /^(?:[1-9]|[1-5][0-9]|6[0-4])个(?:N沟道|P沟道|NPN|PNP)$/.test(value.value.normalize("NFKC").trim());
}, "Financial parameters are not technical resource data");
export const officialTechnicalIdentitySchema = z.object({
  publicId: z.string().regex(/^OM_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  revision: z.number().int().min(1).max(2147483647),
  partNumber: safeText(128).refine(Boolean), brand: safeText(128).refine(Boolean), pkg: safeText(128),
}).strict();
export type OfficialTechnicalIdentity = z.infer<typeof officialTechnicalIdentitySchema>;
export type OfficialTechnicalResource = {
  state: "ready" | "missing" | "unavailable";
  parameterVersion: string | null;
  resource: OfficialMaterialResource | null;
};
export const officialTechnicalResourceSchema = z.object({
  ...officialTechnicalIdentitySchema.shape,
  category: safeText(256).nullable(), description: safeText(4096).nullable(),
  parameters: z.array(officialTechnicalParameterSchema).max(OFFICIAL_TECHNICAL_PARAMETER_LIMIT).refine(rows => new Set(rows.map(row => row.name)).size === rows.length, "Ambiguous cleaned parameter names"),
  datasheetUrl: z.string().max(2048).refine(value => officialMaterialDatasheetUrl(value) === value).nullable(),
}).strict();
export const officialTechnicalResponseSchema = z.object({
  state: z.enum(["ready", "missing", "unavailable"]),
  parameterVersion: z.string().regex(/^tp1_[0-9a-f]{64}$/).nullable(),
  resource: officialTechnicalResourceSchema.nullable(),
}).strict().superRefine((item, ctx) => {
  if (item.state === "unavailable" ? item.resource !== null || item.parameterVersion !== null
    : !item.resource || !item.parameterVersion || (item.state === "ready" ? item.resource.parameters.length === 0 : item.resource.parameters.length !== 0)) {
    ctx.addIssue({ code: "custom", message: "Invalid technical state" });
  }
});
export const unavailableOfficialTechnicalResource = (): OfficialTechnicalResource => ({ state: "unavailable", parameterVersion: null, resource: null });
export function sameOfficialTechnicalIdentity(a: OfficialTechnicalIdentity, b: OfficialTechnicalIdentity): boolean {
  return a.publicId === b.publicId && a.revision === b.revision && a.partNumber === b.partNumber && a.brand === b.brand && a.pkg === b.pkg;
}
/** Stable content version; no database identifiers/timestamps/URLs are exposed in the version. */
export function officialTechnicalDigest(value: unknown): string {
  function stable(input: any): any {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object" && !(input instanceof Date)) return Object.fromEntries(Object.keys(input).sort().map(key => [key, stable(input[key])]));
    return input instanceof Date ? input.toISOString() : input;
  }
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export const officialTechnicalSourceKey = (partNumber: string) => officialTechnicalDigest(partNumber.normalize("NFKC").trim().toUpperCase());
export type OfficialTechnicalDictionaryRead = { sourceVersion: string; state: "matched"; dictionary: NonNullable<OfficialMaterialDictionary> }
  | { sourceVersion: string; state: "missing" }
  | { sourceVersion: string; state: "unavailable" };
export type OfficialTechnicalDictionaryReader = (identities: readonly OfficialTechnicalIdentity[]) => Promise<OfficialTechnicalDictionaryRead[]>;

/** Missing is a proven exact miss or genuinely empty parameter object, never a projection error. */
export function projectPreparedOfficialTechnical(identity: OfficialTechnicalIdentity, read: OfficialTechnicalDictionaryRead): OfficialTechnicalResource {
  officialTechnicalIdentitySchema.parse(identity);
  if (!/^[0-9a-f]{64}$/.test(read.sourceVersion) || read.state === "unavailable") return unavailableOfficialTechnicalResource();
  let resource: OfficialMaterialResource;
  if (read.state === "missing") resource = projectOfficialMaterialResource(identity, null);
  else {
    const dictionary = read.dictionary;
    const reviewedSupplement = isReviewedW25N04KVZEIRSupplement(identity, dictionary) || isReviewedW25N04KVZEIRExistingSource(identity, dictionary);
    if (identity.partNumber.normalize("NFKC").trim().toUpperCase() !== dictionary.partNumber.normalize("NFKC").trim().toUpperCase()
      || !reviewedSupplement && !officialMaterialBrandMatches(identity.brand, dictionary.brand)
      || (!!identity.pkg.trim() !== !!dictionary.package.trim())
      || !officialMaterialPackageMatches(identity.pkg, dictionary.package)) return unavailableOfficialTechnicalResource();
    if (!dictionary.specs || typeof dictionary.specs !== "object" || Array.isArray(dictionary.specs)) return unavailableOfficialTechnicalResource();
    // A present but unsafe URL is a source error, not an absent PDF to hide or replace.
    if (dictionary.datasheetUrl != null && dictionary.datasheetUrl !== ""
      && officialMaterialDatasheetUrl(dictionary.datasheetUrl) !== dictionary.datasheetUrl) return unavailableOfficialTechnicalResource();
    // Canonicalize only the authenticated supplement's manufacturer while passing through
    // the ORIGINAL sanitizer; then restore the complete live public identity before digest/schema.
    resource = reviewedSupplement
      ? { ...projectOfficialMaterialResource({ ...identity, brand: "WINBOND" }, { ...dictionary, brand: "WINBOND" }, OFFICIAL_TECHNICAL_PARAMETER_LIMIT), ...identity }
      : projectOfficialMaterialResource(identity, dictionary, OFFICIAL_TECHNICAL_PARAMETER_LIMIT);
    // Never truncate and claim completeness; all safe entries must survive the projection.
    if (Object.keys(dictionary.specs).length > OFFICIAL_TECHNICAL_PARAMETER_LIMIT || resource.parameters.length !== Object.keys(dictionary.specs).length) return unavailableOfficialTechnicalResource();
  }
  if (!officialTechnicalResourceSchema.safeParse(resource).success) return unavailableOfficialTechnicalResource();
  return {
    state: resource.parameters.length ? "ready" : "missing",
    parameterVersion: `tp1_${officialTechnicalDigest({ identity, sourceVersion: read.sourceVersion, projectionVersion: OFFICIAL_TECHNICAL_PROJECTION_VERSION, resource })}`,
    resource,
  };
}
