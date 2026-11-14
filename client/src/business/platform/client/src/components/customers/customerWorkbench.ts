export const CUSTOMER_WORKBENCH_TABS = [
  { id: "company", label: "客户档案" },
  { id: "demands", label: "需求与报价" },
  { id: "orders", label: "客户订单" },
  { id: "inventory", label: "渠道库存" },
] as const;
// Legacy callers (including the customer list) may still create old bookmarks.
// Only the four canonical ids above are rendered; the parser maps old ids below.
export type CustomerWorkbenchTab = typeof CUSTOMER_WORKBENCH_TABS[number]["id"] | "overview" | "followups";
export type CustomerDemandOrderLink = { demandId: number; demandNo: string };

export function customerWorkbenchTab(search: string): CustomerWorkbenchTab {
  const params = new URLSearchParams(search);
  const value = params.get("tab");
  // Old bookmarks point to replacement panels, not to deleted data.
  if (value === "materials") return "inventory";
  if (value === "overview" || value === "followups") return "company";
  return CUSTOMER_WORKBENCH_TABS.some(tab => tab.id === value) ? value as CustomerWorkbenchTab : "company";
}

/** Replace tab-only state so returning still reaches the original list entry. */
export function customerWorkbenchLocation(customerId: number, tab: CustomerWorkbenchTab, search = "") {
  const params = new URLSearchParams(search);
  const followLink = params.get("follow") === "1" && (params.get("tab") === null || params.get("tab") === "company" || params.get("tab") === "followups");
  params.set("tab", tab);
  if (tab !== "followups" && (tab !== "company" || !followLink)) params.delete("follow");
  return `/customers/${customerId}?${params}`;
}
