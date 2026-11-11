export const CHANNEL_INVENTORY_ROUTE = "/workbench/channel-inventory";
export const CHANNEL_INVENTORY_TABS = [
  { id: "materials", label: "渠道库存" },
  { id: "channels", label: "渠道档案" },
  { id: "batches", label: "上传批次" },
  { id: "trash", label: "回收站" },
] as const;
export type ChannelInventoryNavigationTab = typeof CHANNEL_INVENTORY_TABS[number]["id"];
export type ChannelInventoryNavigationView = "flat" | "channels";
export type ChannelInventoryBatchListState = { channelId: string; archived: "all" | "active" | "archived"; page: number };
export const DEFAULT_BATCH_LIST_STATE: ChannelInventoryBatchListState = { channelId: "", archived: "active", page: 1 };
const paramsFrom = (search: string) => new URLSearchParams(search.replace(/^\?/, ""));
export function positiveInventoryId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function readChannelInventoryTabIntent(search: string): ChannelInventoryNavigationTab | null {
  const raw = paramsFrom(search).get("ciTab");
  return CHANNEL_INVENTORY_TABS.some(tab => tab.id === raw)
    ? raw as ChannelInventoryNavigationTab : null;
}

/** Display state only; source identity and access still require original BFF proof. */
export function getChannelInventoryNavigationTab(search: string): ChannelInventoryNavigationTab {
  const intent = readChannelInventoryTabIntent(search);
  if (intent) return intent;
  const params = paramsFrom(search);
  if (params.has("supplyChannelId") || params.has("supplyTab")) {
    const id = positiveInventoryId(params.get("supplyChannelId"));
    return id && params.get("supplyTab") === "materials" ? "materials" : "channels";
  }
  return "materials";
}

/** Display state only; missing or invalid views use the flat inventory list. */
export function getChannelInventoryNavigationView(search: string): ChannelInventoryNavigationView {
  return paramsFrom(search).get("ciView") === "channels" ? "channels" : "flat";
}

/** Generic tab selection intentionally clears old exact-customer target parameters. */
export function channelInventoryTabLocation(tab: unknown, relativeToWorkbench = false, view?: ChannelInventoryNavigationView): string | null {
  if (!CHANNEL_INVENTORY_TABS.some(item => item.id === tab)) return null;
  if (tab === "materials" && view !== undefined && view !== "flat" && view !== "channels") return null;
  const path = relativeToWorkbench ? "/channel-inventory" : CHANNEL_INVENTORY_ROUTE;
  return `${path}?ciTab=${tab}${tab === "materials" && view !== undefined ? `&ciView=${view}` : ""}`;
}

/** Top-level view selection rebuilds the route without any old supply target. */
export function channelInventoryViewLocation(view: unknown, relativeToWorkbench = false): string | null {
  if (view !== "flat" && view !== "channels") return null;
  return channelInventoryTabLocation("materials", relativeToWorkbench, view);
}

/** UI-only list state; never accepts enterprise, actor, scope or permission parameters. */
export function readChannelInventoryBatchListState(search: string): ChannelInventoryBatchListState {
  const params = paramsFrom(search);
  const channel = params.get("ciBatchChannelId");
  const page = positiveInventoryId(params.get("ciBatchPage"));
  const archived = params.get("ciBatchArchived");
  return {
    channelId: channel && positiveInventoryId(channel) ? String(positiveInventoryId(channel)) : "",
    page: page && page <= 1_000_000 ? page : 1,
    archived: archived === "all" || archived === "archived" || archived === "active" ? archived : "active",
  };
}
export function channelInventoryBatchListLocation(state: ChannelInventoryBatchListState = DEFAULT_BATCH_LIST_STATE, relativeToWorkbench = false, focusId?: number): string {
  const params = new URLSearchParams({ ciTab: "batches" });
  if (positiveInventoryId(state.channelId)) params.set("ciBatchChannelId", String(positiveInventoryId(state.channelId)));
  if (state.archived === "all" || state.archived === "archived") params.set("ciBatchArchived", state.archived);
  if (Number.isSafeInteger(state.page) && state.page > 1 && state.page <= 1_000_000) params.set("ciBatchPage", String(state.page));
  if (Number.isSafeInteger(focusId) && focusId! > 0) params.set("ciBatchFocusId", String(focusId));
  return `${relativeToWorkbench ? "/channel-inventory" : CHANNEL_INVENTORY_ROUTE}?${params}`;
}

/** Rebuild an allow-listed local route, never navigate to an arbitrary return URL. */
export function trustedChannelInventoryBatchReturn(raw: string | null, relativeToWorkbench = false): string {
  const fallback = channelInventoryBatchListLocation(DEFAULT_BATCH_LIST_STATE, relativeToWorkbench);
  if (!raw || raw.length > 2048 || raw.includes("\\") || raw.includes("#")) return fallback;
  const index = raw.indexOf("?");
  const path = index < 0 ? raw : raw.slice(0, index);
  if (path !== CHANNEL_INVENTORY_ROUTE && path !== "/channel-inventory") return fallback;
  const params = paramsFrom(index < 0 ? "" : raw.slice(index + 1));
  const allowed = ["ciTab", "ciBatchChannelId", "ciBatchArchived", "ciBatchPage", "ciBatchFocusId"];
  let invalidKey = false;
  params.forEach((_value, key) => { if (!allowed.includes(key) || params.getAll(key).length !== 1) invalidKey = true; });
  if (params.get("ciTab") !== "batches" || invalidKey) return fallback;
  if (params.has("ciBatchChannelId") && !positiveInventoryId(params.get("ciBatchChannelId"))) return fallback;
  const page = params.get("ciBatchPage");
  if (page !== null && (!positiveInventoryId(page) || positiveInventoryId(page)! > 1_000_000)) return fallback;
  if (params.has("ciBatchArchived") && !["all", "active", "archived"].includes(params.get("ciBatchArchived")!)) return fallback;
  const focus = params.get("ciBatchFocusId");
  if (focus !== null && !positiveInventoryId(focus)) return fallback;
  return channelInventoryBatchListLocation(readChannelInventoryBatchListState(params.toString()), relativeToWorkbench, positiveInventoryId(focus) ?? undefined);
}
export function readChannelInventoryBatchMaterialIntent(search: string): { rawId: string; id: number | null; returnLocation: string } | null {
  const params = paramsFrom(search);
  if (params.get("ciTab") !== "materials" || !params.has("ciBatchId")) return null;
  const rawId = params.get("ciBatchId") ?? "";
  return { rawId, id: params.getAll("ciBatchId").length === 1 ? positiveInventoryId(rawId) : null,
    returnLocation: trustedChannelInventoryBatchReturn(params.get("ciBatchReturn"), true) };
}
export function channelInventoryBatchMaterialLocation(id: number, returnLocation?: string, relativeToWorkbench = false): string | null {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const params = new URLSearchParams({ ciTab: "materials", ciBatchId: String(id),
    ciBatchReturn: trustedChannelInventoryBatchReturn(returnLocation ?? null) });
  return `${relativeToWorkbench ? "/channel-inventory" : CHANNEL_INVENTORY_ROUTE}?${params}`;
}
