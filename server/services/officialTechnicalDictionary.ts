import { containsCompetitorDisplayName } from "../../shared/competitorDisplayPolicy";
import { officialMaterialBrandMatches, officialMaterialPackageMatches } from "./officialTechnicalSafety";
import { officialTechnicalDigest, type OfficialTechnicalIdentity, type OfficialTechnicalDictionaryRead } from "./officialTechnicalResource";
import { supplementOfficialTechnicalRead, matchesW25N04KVZEIRSourceIdentity } from "./officialTechnicalSupplement";
export type OfficialTechnicalDictionaryRow = {
  id: number; partNumber: string; name: string; brand: string | null; package: string | null;
  category: string | null; description: string | null; specs: unknown; datasheetUrl: string | null; updatedAt: Date | string | null;
};
const normalized = (value: string) => value.normalize("NFKC").trim().toUpperCase();
export const OFFICIAL_TECHNICAL_DICTIONARY_COLUMNS = "id, partNumber, name, brand, category, `package`, description, specs, datasheetUrl, updatedAt";
export function readOfficialTechnicalDictionaryRows(identities: readonly OfficialTechnicalIdentity[], rows: readonly OfficialTechnicalDictionaryRow[]): OfficialTechnicalDictionaryRead[] {
  const reads: OfficialTechnicalDictionaryRead[] = identities.map(identity => {
    const candidates = rows.filter(row => normalized(row.partNumber) === normalized(identity.partNumber)
      && ![row.name, row.brand, row.category, row.description].some(containsCompetitorDisplayName));
    const sourceVersion = officialTechnicalDigest(candidates.map(row => ({ ...row })).sort((a, b) => a.id - b.id));
    const matching = candidates.filter(row => officialMaterialBrandMatches(identity.brand, row.brand ?? "")
      && !!identity.pkg.trim() === !!(row.package ?? "").trim()
      && officialMaterialPackageMatches(identity.pkg, row.package ?? "")
      || matchesW25N04KVZEIRSourceIdentity(identity, row));
    if (!matching.length) return { state: "missing", sourceVersion };
    if (matching.length !== 1) return { state: "unavailable", sourceVersion };
    const row = matching[0]; let specs: unknown = row.specs;
    if (typeof specs === "string") { try { specs = JSON.parse(specs); } catch { return { state: "unavailable", sourceVersion }; } }
    // SQL NULL is genuine empty parameters; invalid JSON/scalars/arrays are data errors.
    if (specs === null) specs = {};
    if (!specs || typeof specs !== "object" || Array.isArray(specs) || Object.values(specs).some(value => typeof value !== "string")) return { state: "unavailable", sourceVersion };
    return { state: "matched", sourceVersion, dictionary: {
      partNumber: row.partNumber, brand: row.brand ?? "", package: row.package ?? "", name: row.name,
      category: row.category ?? "", description: row.description ?? "", specs: specs as Record<string, string>, datasheetUrl: row.datasheetUrl ?? undefined,
    } };
  });
  return reads.map((read, index) => supplementOfficialTechnicalRead(identities[index], read));
}
