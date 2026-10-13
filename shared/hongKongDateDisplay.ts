// 香港审核页面只使用日期显示，不加载服务端字段schema。
export function normalizeHkDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!iso && !dmy) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(dmy![3]), Number(dmy![2]), Number(dmy![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function displayHkDate(value: unknown): string {
  const iso = normalizeHkDate(value);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}
