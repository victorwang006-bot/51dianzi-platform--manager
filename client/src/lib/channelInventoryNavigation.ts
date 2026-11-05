export const CHANNEL_INVENTORY_ROUTE = "/workbench/channel-inventory";
export const CHANNEL_INVENTORY_TABS = [
  { id: "materials", label: "渠道库存" },
  { id: "channels", label: "渠道档案" },
  { id: "batches", label: "上传批次" },
  { id: "trash", label: "回收站" },
] as const;
export type ChannelInventoryNavigationTab = typeof CHANNEL_INVENTORY_TABS[number]["id"];

export function readChannelInventoryTabIntent(search: string): ChannelInventoryNavigationTab | null {
  const raw = new URLSearchParams(search.replace(/^\?/, "")).get("ciTab");
  return CHANNEL_INVENTORY_TABS.some(tab => tab.id === raw)
    ? raw as ChannelInventoryNavigationTab : null;
}

/** Display state only; source identity and access still require original BFF proof. */
export function getChannelInventoryNavigationTab(search: string): ChannelInventoryNavigationTab {
  const intent = readChannelInventoryTabIntent(search);
  if (intent) return intent;
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  if (params.has("supplyChannelId") || params.has("supplyTab")) {
    const raw = params.get("supplyChannelId") ?? "";
    const id = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(id) && id > 0 && params.get("supplyTab") === "materials"
      ? "materials" : "channels";
  }
  return "materials";
}

/** Generic tab selection intentionally clears old exact-customer target parameters. */
export function channelInventoryTabLocation(tab: unknown, relativeToWorkbench = false): string | null {
  if (!CHANNEL_INVENTORY_TABS.some(item => item.id === tab)) return null;
  const path = relativeToWorkbench ? "/channel-inventory" : CHANNEL_INVENTORY_ROUTE;
  return `${path}?ciTab=${tab}`;
}
