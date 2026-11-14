export const CHANNEL_INVENTORY_COLUMNS = [
  { id: "index", label: "序号", width: 36, defaultVisible: false },
  { id: "partNumber", label: "型号", width: 220, defaultVisible: true, fixed: true },
  { id: "brand", label: "品牌", width: 100, defaultVisible: true },
  { id: "recorder", label: "负责人", width: 96, defaultVisible: true },
  { id: "industry", label: "所属行业", width: 110, defaultVisible: false },
  { id: "qty", label: "数量", width: 104, defaultVisible: true },
  { id: "price", label: "报价", width: 128, defaultVisible: true },
  { id: "refLcsc", label: "渠道参考一", width: 180, defaultVisible: true },
  { id: "refIckey", label: "渠道参考二", width: 180, defaultVisible: true },
  { id: "leadTime", label: "交期", width: 112, defaultVisible: true },
  { id: "dateCode", label: "DC", width: 100, defaultVisible: false },
  { id: "updatedAt", label: "更新时间", width: 148, defaultVisible: true },
  { id: "source", label: "渠道来源", width: 140, defaultVisible: true },
  { id: "actions", label: "操作", width: 216, defaultVisible: true, fixed: true },
] as const;
export type ChannelInventoryColumnId = typeof CHANNEL_INVENTORY_COLUMNS[number]["id"];
export const DEFAULT_CHANNEL_INVENTORY_COLUMNS: readonly ChannelInventoryColumnId[] =
  CHANNEL_INVENTORY_COLUMNS.filter(column => column.defaultVisible).map(column => column.id);

/** Only BFF-verified actor + enterprise, never URL/admin/placeholder identities. */
export function channelInventoryColumnsStorageKey(actorUserId: number | undefined, enterpriseId: number | undefined) {
  return Number.isSafeInteger(actorUserId) && actorUserId! > 0 && Number.isSafeInteger(enterpriseId) && enterpriseId! > 0
    ? `d51:inventory-columns:v2:user:${actorUserId}:enterprise:${enterpriseId}:page:channel-inventory` : null;
}

export function normalizeChannelInventoryColumns(value: unknown): ChannelInventoryColumnId[] {
  if (!Array.isArray(value) || !value.every(id => typeof id === "string")) return [...DEFAULT_CHANNEL_INVENTORY_COLUMNS];
  return CHANNEL_INVENTORY_COLUMNS.filter(column => ("fixed" in column && column.fixed) || value.includes(column.id)).map(column => column.id);
}

// Reading window.localStorage itself can throw (blocked cookies/private mode).
export function readChannelInventoryColumns(key: string): ChannelInventoryColumnId[] {
  try {
    const stored = window.localStorage.getItem(key);
    // A v2 selection, including deliberately hidden references, always wins.
    if (stored !== null) return normalizeChannelInventoryColumns(JSON.parse(stored));
    if (key.includes("inventory-columns:v2:")) {
      const legacy = window.localStorage.getItem(key.replace("inventory-columns:v2:", "inventory-columns:v1:"));
      if (legacy !== null) {
        const value: unknown = JSON.parse(legacy);
        const migrated = normalizeChannelInventoryColumns(Array.isArray(value) && value.every(id => typeof id === "string") ? [...value, "refLcsc", "refIckey"] : value);
        saveChannelInventoryColumns(key, migrated);
        return migrated;
      }
    }
    return [...DEFAULT_CHANNEL_INVENTORY_COLUMNS];
  } catch { return [...DEFAULT_CHANNEL_INVENTORY_COLUMNS]; }
}
export function saveChannelInventoryColumns(key: string, columns: readonly ChannelInventoryColumnId[]) {
  try { window.localStorage.setItem(key, JSON.stringify(normalizeChannelInventoryColumns(columns))); }
  catch { /* Keep the current in-memory selection; storage never blocks inventory. */ }
}

/** One auto-width model column absorbs all spare space; other colgroup widths are pixels. */
export function channelInventoryColumnLayout(columns: readonly ChannelInventoryColumnId[], selection: boolean) {
  const visible = CHANNEL_INVENTORY_COLUMNS.filter(column => columns.includes(column.id));
  return { visible, count: visible.length + (selection ? 1 : 0),
    minWidth: visible.reduce((width, column) => width + column.width, selection ? 40 : 0) };
}
