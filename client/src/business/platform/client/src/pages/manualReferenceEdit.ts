export type ManualReferenceValues = {
  manualReferenceLcsc?: string | null;
  manualReferenceIckey?: string | null;
};
export type ManualReferenceField = keyof ManualReferenceValues;
export type ManualReferenceDraft = Record<ManualReferenceField, { value: string; edited: boolean }>;

export const MANUAL_REFERENCE_FIELDS = [
  { field: "manualReferenceLcsc", source: "lcsc", label: "渠道参考价一", provider: "立创商城" },
  { field: "manualReferenceIckey", source: "ickey", label: "渠道参考价二", provider: "云汉芯城" },
] as const;

/** Same nonnegative exact-decimal limits as the original inventory price; zero is valid. */
export function manualReferencePriceValid(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(value);
}

export function manualReferenceDraftFrom(values: ManualReferenceValues): ManualReferenceDraft {
  return {
    manualReferenceLcsc: { value: values.manualReferenceLcsc ?? "", edited: false },
    manualReferenceIckey: { value: values.manualReferenceIckey ?? "", edited: false },
  };
}

export function manualReferenceValidation(draft: ManualReferenceDraft): string[] {
  return MANUAL_REFERENCE_FIELDS.flatMap(({ field, label }) => {
    const value = draft[field].value.trim();
    return value && !manualReferencePriceValid(value)
      ? [`${label}须为非负十进制（最多15位整数、12位小数）；留空恢复自动价`] : [];
  });
}

/** Omission preserves the saved override. An explicitly edited empty value restores auto via null. */
export function manualReferencePatch(original: ManualReferenceValues, draft: ManualReferenceDraft): ManualReferenceValues {
  const patch: ManualReferenceValues = {};
  for (const { field } of MANUAL_REFERENCE_FIELDS) {
    const value = draft[field].value.trim();
    if (draft[field].edited && (!value || value !== (original[field] ?? ""))) patch[field] = value || null;
  }
  return patch;
}

/** Confirmation applies only to already saved overrides that survive an actual model/brand change. */
export function manualReferenceRetentionKey(original: ManualReferenceValues & { partNumber: string; brand: string },
  current: { partNumber: string; brand: string }, draft: ManualReferenceDraft): string {
  const partNumber = current.partNumber.normalize("NFKC").trim(), brand = current.brand.trim();
  if (partNumber === original.partNumber && brand === original.brand) return "";
  const retained = MANUAL_REFERENCE_FIELDS.filter(({ field }) => manualReferencePriceValid(original[field])
    && draft[field].value.trim() === original[field]);
  return retained.length ? JSON.stringify([partNumber, brand, retained.map(({ field }) => [field, draft[field].value.trim()])]) : "";
}
