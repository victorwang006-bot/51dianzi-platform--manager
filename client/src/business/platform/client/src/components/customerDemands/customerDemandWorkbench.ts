export type CustomerDemandCustomer = { id: number; name: string; archivedAt?: string | null };
export type CustomerDemandOrderIntent = { demandId: number; demandNo: string };
export type CustomerDemandOpenIntent = {
  demandId: number;
  mode?: "view" | "edit";
  section?: "materials" | "quotes";
  token: string | number;
};

/** IDs, not customer names or client-side keywords, bind a detail to its workbench. */
export function matchesCustomerDemand(detail: { id: number; customerId: number } | null | undefined, customerId: number, demandId?: number): boolean {
  return Boolean(detail && demandId && detail.id === demandId && detail.customerId === customerId);
}

/** Legacy standalone routes remain unchanged; embedded consumers receive the exact demand ID too. */
export function customerDemandOrderPath(intent: CustomerDemandOrderIntent, action: "create" | "view"): string {
  return `/sales-orders?${action === "create" ? "demandNo" : "keyword"}=${encodeURIComponent(intent.demandNo)}`;
}
