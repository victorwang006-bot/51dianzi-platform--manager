export type UploadedMaterialIdentity = {
  partNumber: string;
  brand: string;
  searchAliases: readonly string[];
};

export const uploadedMaterialText = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();

/** Keep every orderable suffix and punctuation; only reviewed filename separators normalize. */
export const uploadedMaterialModel = (value: string) =>
  uploadedMaterialText(value).replace(/[\s_]/g, "").replaceAll("/", "-");

/** Brand components/aliases are evidence from the owner-approved manifest, not fuzzy guesses. */
export function uploadedMaterialBrandTerms(row: Pick<UploadedMaterialIdentity, "brand"> & { searchAliases?: readonly string[] }): string[] {
  const raw = uploadedMaterialText(row.brand);
  const terms = new Set([raw, ...raw.split(/[/(（)）]/).map(uploadedMaterialText),
    ...(row.searchAliases ?? []).filter(alias => !/\d/.test(alias)).map(uploadedMaterialText)]);
  const ti = ["TI", "TEXAS INSTRUMENTS", "德州仪器"];
  if (ti.some(term => terms.has(term))) ti.forEach(term => terms.add(term));
  return Array.from(terms).filter(Boolean).sort((a, b) => b.length - a.length);
}

export function uploadedMaterialModelNames(row: UploadedMaterialIdentity): string[] {
  const terms = uploadedMaterialBrandTerms(row);
  return [row.partNumber, ...row.searchAliases.filter(alias => /\d/.test(alias))].map(value => {
    let name = uploadedMaterialText(value);
    for (const term of terms) {
      if (name.startsWith(`${term} `)) name = name.slice(term.length).trim();
      if (name.endsWith(` ${term}`)) name = name.slice(0, -term.length).trim();
    }
    return uploadedMaterialModel(name);
  });
}

/** Only the already-verified own HTTPS WebP upload source; no proxy/fetch or arbitrary host. */
export function isApprovedUploadedMaterialImageUrl(value: string): boolean {
  return value.length <= 320
    && /^https:\/\/admin\.51dianzi\.com\/uploads\/material-images\/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/.test(value)
    && !/\s/.test(value)
    && !value.includes("..");
}
