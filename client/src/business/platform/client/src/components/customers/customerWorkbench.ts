export const CUSTOMER_WORKBENCH_TABS = [
  { id: "overview", label: "概览" },
  { id: "company", label: "公司与联系人" },
  { id: "demands", label: "需求与报价" },
  { id: "orders", label: "订单与出货" },
  { id: "materials", label: "关联物料" },
  { id: "followups", label: "跟进记录" },
] as const;
export type CustomerWorkbenchTab = typeof CUSTOMER_WORKBENCH_TABS[number]["id"];
export type CustomerDemandOrderLink = { demandId: number; demandNo: string };

export function customerWorkbenchTab(search: string): CustomerWorkbenchTab {
  const params = new URLSearchParams(search);
  const value = params.get("tab");
  if (value !== null) return CUSTOMER_WORKBENCH_TABS.some(tab => tab.id === value) ? value as CustomerWorkbenchTab : "overview";
  return params.get("follow") === "1" ? "followups" : "overview";
}

/** Replace tab-only state so returning still reaches the original list entry. */
export function customerWorkbenchLocation(customerId: number, tab: CustomerWorkbenchTab, search = "") {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  if (tab !== "followups") params.delete("follow");
  return `/customers/${customerId}?${params}`;
}
