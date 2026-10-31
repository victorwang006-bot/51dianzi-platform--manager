/** Normalize pasted/OCR credit codes without silently truncating non-space characters. */
export function normalizeCompanyCreditCode(value: string): string {
  return value.normalize("NFKC").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();
}
