export type GeneratedImageIdentity = { partNumber: string; brand: string; dictionaryMaterialId: number };
export type GeneratedImageInput = { partNumber?: unknown; displayPartNumber?: unknown; brand?: unknown; dictionaryMaterialId?: unknown };
export type NormalizedGeneratedImageInput = { partNumber: string; brand: string; dictionaryMaterialId: number | null };
export type GeneratedDictionaryIdentityRow = { id: unknown; partNumber: unknown; brand: unknown; status: unknown };

export function normalizeGeneratedImagePartNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return normalized.length <= 128 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : "";
}
export function normalizeGeneratedImageBrand(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length <= 128 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : "";
}
export function generatedDictionaryId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}
export function normalizeGeneratedImageInput(value: unknown): NormalizedGeneratedImageInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as GeneratedImageInput;
  const partNumber = normalizeGeneratedImagePartNumber(input.displayPartNumber != null ? input.displayPartNumber : input.partNumber);
  const brand = normalizeGeneratedImageBrand(input.brand);
  const hasId = input.dictionaryMaterialId != null;
  const dictionaryMaterialId = hasId ? generatedDictionaryId(input.dictionaryMaterialId) : null;
  if (!partNumber || !brand || (hasId && !dictionaryMaterialId)) return null;
  return { partNumber, brand, dictionaryMaterialId };
}
export function generatedImageIdentityKey(identity: GeneratedImageIdentity): string {
  return JSON.stringify([identity.partNumber, identity.brand, identity.dictionaryMaterialId]);
}
/** An absent ID may be resolved only from exactly one current enabled part+brand row. */
export function resolveGeneratedImageIdentitiesFromRows(
  inputs: unknown[], rows: GeneratedDictionaryIdentityRow[],
): Array<GeneratedImageIdentity | null> {
  return inputs.map(value => {
    const input = normalizeGeneratedImageInput(value);
    if (!input) return null;
    const matches = rows.filter(row => row.status === "enabled"
      && generatedDictionaryId(row.id) != null
      && normalizeGeneratedImagePartNumber(row.partNumber) === input.partNumber
      && normalizeGeneratedImageBrand(row.brand) === input.brand
      && (input.dictionaryMaterialId == null || generatedDictionaryId(row.id) === input.dictionaryMaterialId));
    if (matches.length !== 1) return null;
    return { partNumber: input.partNumber, brand: input.brand, dictionaryMaterialId: generatedDictionaryId(matches[0].id)! };
  });
}
