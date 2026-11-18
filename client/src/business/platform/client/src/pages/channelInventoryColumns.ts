export const CHANNEL_INVENTORY_COLUMNS = [
  { id: "index", label: "序号", width: 36, defaultVisible: false },
  { id: "partNumber", label: "型号", width: 220, defaultVisible: true, fixed: true },
  { id: "brand", label: "品牌", width: 90, defaultVisible: true },
  { id: "recorder", label: "负责人", width: 86, defaultVisible: true },
  { id: "source", label: "来源客户", width: 140, defaultVisible: true },
  { id: "industry", label: "所属行业", width: 110, defaultVisible: false },
  { id: "qty", label: "数量", width: 90, defaultVisible: true },
  { id: "price", label: "报价", width: 110, defaultVisible: true },
  { id: "refLcsc", label: "渠道参考一", width: 160, defaultVisible: true },
  { id: "refIckey", label: "渠道参考二", width: 160, defaultVisible: true },
  { id: "leadTime", label: "交期", width: 112, defaultVisible: false },
  { id: "dateCode", label: "DC", width: 100, defaultVisible: false },
  { id: "updatedAt", label: "更新时间", width: 148, defaultVisible: false },
  { id: "actions", label: "操作", width: 112, defaultVisible: true, fixed: true },
] as const;
export type ChannelInventoryColumnId = typeof CHANNEL_INVENTORY_COLUMNS[number]["id"];
export const DEFAULT_CHANNEL_INVENTORY_COLUMNS: readonly ChannelInventoryColumnId[] =
  CHANNEL_INVENTORY_COLUMNS.filter(column => column.defaultVisible).map(column => column.id);

export type ChannelInventoryMaterialGrant = {
  canEditMaterial?: unknown;
  canEdit?: unknown;
  readOnly?: unknown;
  canViewSource?: unknown;
  canViewCustomerSource?: unknown;
  customerSourceState?: unknown;
  channelSource?: unknown;
  company?: unknown;
};

/** Explicit backend evidence only. A returned canEditMaterial supersedes the legacy
 * canEdit field even when false/malformed; never derive a grant from id/name/role. */
export function channelInventoryMaterialEditGranted(row: ChannelInventoryMaterialGrant): boolean {
  const grant = Object.prototype.hasOwnProperty.call(row, "canEditMaterial") ? row.canEditMaterial : row.canEdit;
  return grant === true && row.readOnly === false;
}

/** Existing edit gate stays unchanged. Source-read capability never grants editing.
 * Global/context checks may deny, never grant. The backend owns original actor/team scope. */
export function channelInventoryMaterialAccess(row: ChannelInventoryMaterialGrant, contextVerified = true): boolean {
  return contextVerified && channelInventoryMaterialEditGranted(row) && row.canViewSource === true;
}

/** New read DTOs have explicit source state; edit/readOnly do not authorize them.
 * Old DTOs retain the narrower existing gate, never infer an unlinked historical
 * channel from company=null or from a name alone. Malformed new states deny. */
export function channelInventoryMaterialSourceAccess(row: ChannelInventoryMaterialGrant, contextVerified = true): boolean {
  if (!contextVerified || row.canViewSource !== true) return false;
  if (!Object.prototype.hasOwnProperty.call(row, "customerSourceState")) return channelInventoryMaterialAccess(row, contextVerified);
  return row.customerSourceState === "unlinked" || (row.customerSourceState === "matched" && row.canViewCustomerSource === true);
}

/** company is confirmed CRM data. Only explicit authorized unlinked state may
 * render a historical channel; a matched/restricted source NEVER falls back. */
export function channelInventorySourceLabel(row: ChannelInventoryMaterialGrant, contextVerified = true): string {
  if (!channelInventoryMaterialSourceAccess(row, contextVerified)) return "客户不可查看";
  if (row.customerSourceState === "unlinked") {
    if (row.company !== null || !row.channelSource || typeof row.channelSource !== "object") return "客户不可查看";
    const channel = row.channelSource as { id?: unknown; name?: unknown };
    return typeof channel.id === "number" && Number.isSafeInteger(channel.id) && channel.id > 0
      && typeof channel.name === "string" && channel.name.trim()
      ? `历史渠道：${channel.name}（未关联CRM客户）` : "客户不可查看";
  }
  if (row.company === null) return Object.prototype.hasOwnProperty.call(row, "customerSourceState") ? "客户不可查看" : "未关联客户";
  if (!row.company || typeof row.company !== "object") return "客户不可查看";
  const customer = row.company as { id?: unknown; name?: unknown };
  return typeof customer.id === "number" && Number.isSafeInteger(customer.id) && customer.id > 0
    && typeof customer.name === "string" && customer.name.trim() ? customer.name : "客户不可查看";
}

/** Only BFF-verified actor + enterprise, never URL/admin/placeholder identities. */
export function channelInventoryColumnsStorageKey(actorUserId: number | undefined, enterpriseId: number | undefined) {
  return Number.isSafeInteger(actorUserId) && actorUserId! > 0 && Number.isSafeInteger(enterpriseId) && enterpriseId! > 0
    ? `d51:inventory-columns:v3:user:${actorUserId}:enterprise:${enterpriseId}:page:channel-inventory` : null;
}

export function normalizeChannelInventoryColumns(value: unknown): ChannelInventoryColumnId[] {
  if (!Array.isArray(value) || !value.every(id => typeof id === "string")) return [...DEFAULT_CHANNEL_INVENTORY_COLUMNS];
  return CHANNEL_INVENTORY_COLUMNS.filter(column => ("fixed" in column && column.fixed) || value.includes(column.id)).map(column => column.id);
}

const LEGACY_DEFAULT_COLUMNS = ["partNumber", "brand", "recorder", "qty", "price", "refLcsc", "refIckey", "leadTime", "updatedAt", "source", "actions"];

// Reading window.localStorage itself can throw (blocked cookies/private mode).
export function readChannelInventoryColumns(key: string): ChannelInventoryColumnId[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return normalizeChannelInventoryColumns(JSON.parse(stored));
    if (key.includes("inventory-columns:v3:")) {
      const v2 = window.localStorage.getItem(key.replace("inventory-columns:v3:", "inventory-columns:v2:"));
      const v1 = v2 === null ? window.localStorage.getItem(key.replace("inventory-columns:v3:", "inventory-columns:v1:")) : null;
      if (v2 !== null || v1 !== null) {
        const value: unknown = JSON.parse((v2 ?? v1)!);
        // Only the exact old default rebases. Any custom positive/negative selection
        // remains explicit, including hidden customer/reference columns and extra fields.
        const oldDefault = v2 !== null && JSON.stringify(value) === JSON.stringify(LEGACY_DEFAULT_COLUMNS);
        const migrated = oldDefault ? [...DEFAULT_CHANNEL_INVENTORY_COLUMNS]
          : normalizeChannelInventoryColumns(v1 !== null && Array.isArray(value) && value.every(id => typeof id === "string") ? [...value, "refLcsc", "refIckey"] : value);
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
