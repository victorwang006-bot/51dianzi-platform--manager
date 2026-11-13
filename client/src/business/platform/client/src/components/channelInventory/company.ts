export type InventoryCompanyProjection = { company?: { id: number; name: string } | null };
/** Only the current server-authorized Company projection; never source name/brand/customer-demand guesses. */
export function inventoryCompanyLabel(row: InventoryCompanyProjection): string {
  const company = row.company;
  return company && Number.isSafeInteger(company.id) && company.id > 0 && typeof company.name === "string" && company.name.trim()
    ? company.name : "未确认或不可查看";
}
