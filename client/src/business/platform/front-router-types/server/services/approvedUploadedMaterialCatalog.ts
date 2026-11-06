import approvedCatalog from "../../../shared/approvedUploadedMaterialCatalog.json";
import { z } from "zod";
import { normalizePartNumber } from "../../../shared/partNumber";
import { materialMetadataContainsCompetitor } from "../../../shared/competitorDisplayPolicy";
import { isApprovedUploadedMaterialImageUrl, uploadedMaterialBrandTerms, uploadedMaterialModel, uploadedMaterialModelNames, uploadedMaterialText } from "../../../shared/uploadedMaterialIdentity";
export { isApprovedUploadedMaterialImageUrl } from "../../../shared/uploadedMaterialIdentity";

/** Public, user-approved material documentation only; never an inventory/offer DTO. */
export type UploadedMaterial = {
  id: string;
  materialId: number;
  materialNo: string;
  partNumber: string;
  brand: string;
  name: string;
  category: string;
  package: string;
  description: string;
  specs: Record<string, string>;
  imageUrl: string;
  searchAliases: string[];
  parametersComplete: boolean;
};

const publicText = (max: number) => z.string().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const materialSchema = z.object({
  id: publicText(96).min(1),
  materialId: z.number().int().positive(),
  materialNo: publicText(96),
  partNumber: publicText(128).trim().min(2),
  brand: publicText(128).trim().min(1),
  name: publicText(256),
  category: publicText(128),
  package: publicText(128),
  description: publicText(2000),
  specs: z.record(publicText(128).min(1), publicText(2000)),
  imageUrl: z.string().refine(isApprovedUploadedMaterialImageUrl),
  searchAliases: z.array(publicText(256).trim().min(1)).max(24),
  parametersComplete: z.boolean(),
});

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Fail closed on oversized manifests or duplicate public identities; strip unknown fields. */
export const MAX_APPROVED_UPLOADED_MATERIALS = 268;
export function readApprovedUploadedMaterialCatalog(value: unknown = approvedCatalog): UploadedMaterial[] {
  if (!Array.isArray(value) || value.length > MAX_APPROVED_UPLOADED_MATERIALS) return [];
  const parsed = value.map(row => materialSchema.safeParse(row));
  const rows = parsed.flatMap(row => row.success && !materialMetadataContainsCompetitor(row.data) ? [row.data] : []);
  const ids = new Map<string, number>();
  const materialIds = new Map<number, number>();
  const identities = new Map<string, number>();
  const identity = (row: UploadedMaterial) => `${normalizeText(row.partNumber)}\u0000${normalizeText(row.brand)}`;
  for (const row of rows) {
    ids.set(row.id, (ids.get(row.id) ?? 0) + 1);
    materialIds.set(row.materialId, (materialIds.get(row.materialId) ?? 0) + 1);
    identities.set(identity(row), (identities.get(identity(row)) ?? 0) + 1);
  }
  return rows.filter(row => ids.get(row.id) === 1 && materialIds.get(row.materialId) === 1 && identities.get(identity(row)) === 1);
}

const brandTerms = uploadedMaterialBrandTerms;

/** Enrichment of existing rows only, on every page. Never uses keyword or packaging equivalents. */
export function approvedUploadedMaterialImageItemMap<T extends { partNumber: string; brand?: string | null }>(
  items: readonly T[], catalog: unknown = approvedCatalog,
): Map<T, string> {
  const rows = readApprovedUploadedMaterialCatalog(catalog);
  const result = new Map<T, string>();
  for (const item of items) {
    const model = uploadedMaterialModel(item.partNumber);
    const brand = uploadedMaterialText(item.brand ?? "");
    if (!model || !brand) continue;
    const matches = rows.filter(row => brandTerms(row).includes(brand) && uploadedMaterialModelNames(row).includes(model));
    if (matches.length === 1) result.set(item, matches[0].imageUrl);
  }
  return result;
}

function activeFilter(value: string | undefined): string {
  const text = normalizeText(value ?? "");
  return text === "ALL" ? "" : text;
}

/** Guest wildcard protection: only an exact approved filename alias may replace '_'. */
export function approvedUploadedMaterialFilenameModel(
  value: string,
  catalog: unknown = approvedCatalog,
): string | null {
  const query = normalizeText(value);
  if (!query.includes("_") || !/^[A-Z0-9][A-Z0-9._/+,-]*$/.test(query) || !/\d/.test(query)) return null;
  const parts = readApprovedUploadedMaterialCatalog(catalog)
    .filter(row => row.searchAliases.some(alias => normalizeText(alias) === query))
    .map(row => row.partNumber);
  const unique = Array.from(new Set(parts));
  return unique.length === 1 && !unique[0].includes("_") ? unique[0] : null;
}

export type UploadedMaterialSearchContext = {
  keyword?: string;
  brand?: string;
  /** Optional helper-only plural selector; existing routers retain their singular brand contract. */
  brands?: string[];
  category?: string;
  pkg?: string;
  followedOnly?: boolean;
  page?: number;
};

function modelMatch(query: string, row: UploadedMaterial): "exact" | "prefix" | null {
  // Some capacitor MPNs contain a literal dimension '*'. Never treat it as a wildcard.
  // This branch also binds the owner's exact underscore filename to that one complete MPN.
  if (query.includes("*") || row.partNumber.includes("*")) {
    const exactNames = [row.partNumber, ...row.searchAliases.filter(alias => /\d/.test(alias))].map(normalizeText);
    return exactNames.includes(query) ? "exact" : null;
  }
  // Separator normalization preserves the ENTIRE orderable suffix. Never strip packaging suffixes.
  if (!/^[A-Z0-9][A-Z0-9 ._/+,()-]*$/.test(query) || !/\d/.test(query)) return null;
  const compact = normalizePartNumber(query);
  if (compact.length < 2) return null;
  const models = [row.partNumber, ...row.searchAliases.filter(alias => /\d/.test(alias))]
    .map(normalizeText)
    .filter(alias => /^[A-Z0-9][A-Z0-9 ._/+,()-]*$/.test(alias))
    .map(normalizePartNumber);
  if (models.includes(compact)) return "exact";
  // Same prefix direction as inventory input: display each longer complete model explicitly.
  // Approved marking/filename aliases are exact identities, never shorter model prefixes.
  return normalizePartNumber(row.partNumber).startsWith(compact) ? "prefix" : null;
}

/** First-page read-only addition inside existing authorized search handlers; no DB/network access. */
export function searchApprovedUploadedMaterials(
  context: UploadedMaterialSearchContext,
  catalog: unknown = approvedCatalog,
): UploadedMaterial[] {
  if ((context.page ?? 1) !== 1 || context.followedOnly) return [];
  const rawQuery = context.keyword ?? "";
  if (rawQuery.length > 256 || /[\u0000-\u001f\u007f\\%]/.test(rawQuery)) return [];
  const query = normalizeText(rawQuery);
  const brand = activeFilter(context.brand);
  const brands = (context.brands ?? []).map(activeFilter).filter(Boolean);
  const category = activeFilter(context.category);
  const pkg = activeFilter(context.pkg);
  if (!query && !brand && !brands.length) return [];
  const matches: Array<{ row: UploadedMaterial; exact: boolean }> = [];
  for (const row of readApprovedUploadedMaterialCatalog(catalog)) {
    const terms = brandTerms(row);
    if (brand && !terms.includes(brand)) continue;
    if (brands.length && !brands.some(value => terms.includes(value))) continue;
    if (category && normalizeText(row.category) !== category) continue;
    if (pkg && normalizeText(row.package) !== pkg) continue;
    if (!query || terms.includes(query) || row.searchAliases.some(alias => normalizeText(alias) === query)) {
      matches.push({ row, exact: true });
      continue;
    }
    // Remove ONLY a confirmed brand at a whitespace boundary, from either end.
    // This retains BAW56 A1 and /NOPB and does not guess unknown brands.
    const modelQueries = [query];
    for (const term of terms) {
      if (query.endsWith(` ${term}`)) modelQueries.push(query.slice(0, -term.length).trim());
      if (query.startsWith(`${term} `)) modelQueries.push(query.slice(term.length).trim());
    }
    const tiers = modelQueries.map(value => modelMatch(value, row));
    if (tiers.includes("exact")) matches.push({ row, exact: true });
    else if (tiers.includes("prefix")) matches.push({ row, exact: false });
  }
  // Exact full identities/aliases win over longer lookalikes; same-model brands remain separate.
  const exact = matches.filter(match => match.exact);
  return (exact.length ? exact : matches).map(match => match.row);
}
