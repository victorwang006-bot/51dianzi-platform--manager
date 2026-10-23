/* Browser-only UI memory. Business records and form bodies never enter this store. */
export type PageScope = string | null;
type ScrollSnapshot = {
  x: number; y: number; row?: string; offset?: number;
  containers?: { path: number[]; x: number; y: number }[];
};
type Entry = {
  id: string; scope: PageScope; url: string; from: string | null;
  state: Record<string, unknown>; scroll?: ScrollSnapshot; at: number;
};
type Book = { entries: Record<string, Entry>; latest: Record<string, string> };
const PREFIX = "51dianzi:admin-page-memory:v1:";
const META = "__d51AdminPageMemory";
const MAX_ENTRIES = 60;
const MAX_BYTES = 180000;
const TTL = 12 * 60 * 60 * 1000;
const UI_SLOTS = new Set([
  "draftFilters", "appliedFilters", "moreFiltersOpen", "page", "statusFilter",
  "pnInput", "brandInput", "catInput", "applied", "draftKeyword", "keyword",
  "stage", "scope", "assignedUserId", "due", "keywordInput", "view",
  "paymentFilter", "shippingFilter", "invoiceFilter", "lifecycle", "selectedOrderId",
  "detailTab", "status", "selectedId", "tab", "draftPage", "listing",
  "materialDraft", "materialFilters", "channelDraft", "channelFilters", "channelPage", "channelId",
  "filters", "sort", "search", "searchInput", "salesOwnerFilter", "createdAtFilter", "pageSize", "activeTab", "navigationPage",
]);
const UI_FIELDS = new Set([
  "page", "filters", "sort", "search", "searchInput", "salesOwnerFilter", "createdAtFilter", "pageSize", "activeTab", "navigationPage", "status", "owner", "keyword", "grade", "stage", "scope", "assignedUserId",
  "due", "archived", "preset", "from", "to", "salesOwnerCode", "pn", "brand", "cat", "partNumber", "type", "name", "active",
]);
function uiValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length <= 1000 ? value : undefined;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!UI_FIELDS.has(key)) continue;
    const clean = uiValue(v, depth + 1);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}
function validScroll(value: unknown): ScrollSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as ScrollSnapshot;
  const position = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10000000;
  if (!position(s.x) || !position(s.y) || s.x < 0 || s.y < 0) return undefined;
  return {
    x: s.x, y: s.y,
    ...(typeof s.row === "string" && s.row.length < 100 && position(s.offset) ? { row: s.row, offset: s.offset } : {}),
    containers: Array.isArray(s.containers) ? s.containers.slice(0, 8).filter(c => c && position(c.x) && position(c.y) && Array.isArray(c.path) && c.path.length <= 20 && c.path.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10000)) : [],
  };
}
const books = new Map<string, Book>();
const listeners = new Set<() => void>();
let scope: PageScope = null;
let activeId = "";
let epoch = 0;
let installed = false;
let unscoped: Book = { entries: {}, latest: {} };
let selectedRow: HTMLElement | null = null;
let popReturn = false;
let pendingPosition: string | null = null;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const route = (url: string) => url.split(/[?#]/)[0];
const currentUrl = () => window.location.pathname + window.location.search + window.location.hash;
export function safePageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.username || parsed.password) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}
function book(): Book {
  if (!scope) return unscoped;
  if (!books.has(scope)) {
    let parsed: Book = { entries: {}, latest: {} };
    try {
      const raw = sessionStorage.getItem(PREFIX + scope);
      if (raw && raw.length <= MAX_BYTES) {
        const candidate = JSON.parse(raw);
        if (candidate && candidate.entries && candidate.latest) {
          for (const [id, e] of Object.entries(candidate.entries) as [string, Entry][]) {
            if (e && e.id === id && /^[A-Za-z0-9-]{1,100}$/.test(id) && e.scope === scope && safePageUrl(e.url) && typeof e.at === "number" && Date.now() - e.at < TTL && e.state && typeof e.state === "object" && !Array.isArray(e.state)) {
              const state: Record<string, unknown> = {};
              for (const [name, value] of Object.entries(e.state)) if (UI_SLOTS.has(name)) {
                const clean = uiValue(value); if (clean !== undefined) state[name] = clean;
              }
              parsed.entries[id] = { ...e, state, scroll: validScroll(e.scroll) };
            }
          }
          for (const [url, id] of Object.entries(candidate.latest) as [string, string][]) if (safePageUrl(url) && parsed.entries[id]) parsed.latest[url] = id;
        }
      }
    } catch { /* Disabled or corrupt storage is never fatal. */ }
    books.set(scope, parsed);
  }
  return books.get(scope)!;
}
function persist() {
  if (!scope) return;
  const b = book();
  const all = Object.values(b.entries).sort((a, z) => z.at - a.at);
  const keep = new Set(all.filter(e => Date.now() - e.at < TTL).slice(0, MAX_ENTRIES).map(e => e.id));
  if (activeId) keep.add(activeId);
  for (const id of Object.keys(b.entries)) if (!keep.has(id)) delete b.entries[id];
  for (const [url, id] of Object.entries(b.latest)) if (!b.entries[id]) delete b.latest[url];
  try {
    let raw = JSON.stringify(b);
    while (raw.length > MAX_BYTES && all.length > 1) {
      const e = all.pop()!;
      if (e.id === activeId) continue;
      delete b.entries[e.id];
      for (const [url, id] of Object.entries(b.latest)) if (id === e.id) delete b.latest[url];
      raw = JSON.stringify(b);
    }
    if (raw.length <= MAX_BYTES) sessionStorage.setItem(PREFIX + scope, raw);
  } catch { /* Keep this tab's in-memory state if quota is unavailable. */ }
}
function metadata() {
  const m = history.state?.[META];
  return m && typeof m.id === "string" && (m.scope === null || typeof m.scope === "string") ? m : null;
}
function mark(e: Entry, replace: typeof history.replaceState) {
  const old = history.state && typeof history.state === "object" ? history.state : {};
  replace.call(history, { ...old, [META]: { id: e.id, scope: e.scope } }, "", e.url);
}
function notify() { epoch++; listeners.forEach(listener => listener()); }
export const subscribePageMemory = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const pageMemoryEpoch = () => epoch;
export const pageMemoryContext = () => `${scope ?? "unresolved"}:${activeId}`;
export const pageMemoryScope = () => scope;
function newNavigationState(url: string, previous: Record<string, unknown> = {}) {
  const state = { ...previous };
  const parsed = new URL(url, window.location.origin);
  const status = parsed.searchParams.get("status"), tab = parsed.searchParams.get("tab");
  if (parsed.pathname === "/inventory" && status && ["published", "offshelf", "all"].includes(status)) {
    state.statusFilter = status; state.page = 1;
  }
  if (parsed.pathname === "/publish" && tab && ["single", "list", "import"].includes(tab)) {
    state.tab = tab; state.draftPage = 1;
  }
  return state;
}
function previousRouteEntry(url: string): Entry | undefined {
  const b = book();
  const entries = Object.values(b.entries).filter(e => e.id !== activeId && e.scope === scope && route(e.url) === route(url));
  // Prefer an actual browsed list, not a legacy v1 detail fallback renamed to a list.
  entries.sort((a, z) => Number(Object.keys(z.state).length > 0) - Number(Object.keys(a.state).length > 0) || z.at - a.at);
  return entries[0];
}
function seed(url: string, from: string | null = null): Entry {
  const b = book();
  // Each history entry keeps independent state even for repeated visits to one URL.
  const exact = b.entries[b.latest[url]];
  const previous = exact && Object.keys(exact.state).length ? exact : previousRouteEntry(url) ?? exact;
  const state = newNavigationState(url, previous?.state);
  const explicitIntent = JSON.stringify(state) !== JSON.stringify(previous?.state ?? {});
  const e: Entry = { id: uuid(), scope, url, from, state, ...(!explicitIntent && previous?.scroll ? { scroll: validScroll(previous.scroll) } : {}), at: Date.now() };
  b.entries[e.id] = e; b.latest[url] = e.id; activeId = e.id;
  pendingPosition = scope && e.scroll ? pageMemoryContext() : null;
  return e;
}
export function setPageMemoryScope(next: PageScope) {
  if (typeof window === "undefined") return;
  installPageMemory();
  if (scope === next && (activeId || next === null)) return;
  flushPagePosition();
  if (next === null) {
    // Pending is not a new tenant or a new navigation. Keep the real scoped
    // history metadata so this exact source chain can resume after discovery.
    scope = null;
    activeId = "";
    selectedRow = null;
    return;
  }
  const before = scope;
  scope = next;
  const b = book();
  const meta = metadata();
  if (meta?.scope === next && b.entries[meta.id]) activeId = meta.id;
  else if (before === null && next && meta?.scope === null && unscoped.entries[meta.id]) {
    // Bootstrap may have captured an actual same-tab source before identity resolves.
    // Adopt URL/position only; anonymous filters and business data are never adopted.
    const entry = unscoped.entries[meta.id];
    const parent = entry.from ? unscoped.entries[entry.from] : null;
    const trustedParent = entry.from ? b.entries[entry.from] : null;
    if (!trustedParent && parent && safePageUrl(parent.url) && !/^\/(auth|account)(\/|$)/.test(route(parent.url))) {
      b.entries[parent.id] = { ...parent, scope: next, from: null, state: {} };
      b.latest[parent.url] = parent.id;
    }
    const previous = b.entries[b.latest[entry.url]];
    b.entries[entry.id] = { ...entry, scope: next, from: entry.from && b.entries[entry.from]?.scope === next ? entry.from : null, state: newNavigationState(entry.url, previous?.state) };
    b.latest[entry.url] = entry.id;
    activeId = entry.id;
  } else activeId = seed(currentUrl()).id;
  mark(b.entries[activeId], rawReplace!);
  popReturn = false;
  selectedRow = null;
  pendingPosition = b.entries[activeId]?.scroll ? pageMemoryContext() : null;
  persist();
  // No notify during React render: identity/provider changes already rerender the page.
}
export function readPageSlot<T>(name: string, fallback: T): T {
  if (!scope) return fallback;
  const value = book().entries[activeId]?.state[name];
  function valid(v: unknown, template: unknown): boolean {
    if (template === null) return v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0);
    if (typeof template === "number") return typeof v === "number" && Number.isFinite(v) && v >= 1 && Number.isSafeInteger(v);
    if (typeof template === "string") return typeof v === "string" && v.length <= 1000;
    if (typeof template === "boolean") return typeof v === "boolean";
    if (template && typeof template === "object" && !Array.isArray(template)) return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => UI_FIELDS.has(k)) && Object.entries(template).every(([k, x]) => valid((v as Record<string, unknown>)[k], x));
    return false;
  }
  return value !== undefined && valid(value, fallback) ? value as T : fallback;
}
export function writePageSlot(name: string, value: unknown) {
  if (!scope || !UI_SLOTS.has(name)) return;
  const e = book().entries[activeId];
  if (!e) return;
  try {
    const raw = JSON.stringify(uiValue(value));
    if (raw === undefined || raw.length > 16000) return;
    e.state[name] = JSON.parse(raw); e.at = Date.now(); persist();
  } catch { /* Non-JSON values are excluded. */ }
}
function elementPath(element: Element): number[] | null {
  const path: number[] = [];
  let e: Element | null = element;
  while (e && e !== document.body && path.length < 20) {
    const parent: Element | null = e.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, e)); e = parent;
  }
  return e === document.body ? path : null;
}
function elementAt(path: number[]) {
  let e: Element | undefined = document.body;
  for (const index of path) e = e?.children[index];
  return e instanceof HTMLElement ? e : null;
}
export function flushPagePosition() {
  if (!installed || typeof window === "undefined") return;
  // History/React can clamp a long list to zero while fresh data is loading.
  // Do not let that automatic layout scroll overwrite the source snapshot.
  if (pendingPosition === pageMemoryContext()) return;
  const e = book().entries[activeId]; if (!e) return;
  const row = selectedRow?.isConnected ? selectedRow : null;
  const containers: NonNullable<ScrollSnapshot["containers"]> = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-page-memory-scroll], main [class*='overflow-']"))) {
    if (!element.scrollLeft && !element.scrollTop) continue;
    const path = elementPath(element); if (path) containers.push({ path, x: element.scrollLeft, y: element.scrollTop });
    if (containers.length >= 8) break;
  }
  e.scroll = { x: window.scrollX, y: window.scrollY, ...(row?.dataset.pageMemoryRow ? { row: row.dataset.pageMemoryRow, offset: row.getBoundingClientRect().top } : {}), containers };
  e.at = Date.now(); persist();
}
export function restorePagePosition(): () => void {
  const context = pageMemoryContext();
  const snapshot = book().entries[activeId]?.scroll;
  if (!snapshot || !scope) return () => {};
  let stopped = false; let frame = 0; let tries = 0;
  const stop = (release = false) => {
    stopped = true; cancelAnimationFrame(frame); cleanup();
    if (release && pendingPosition === context) { pendingPosition = null; flushPagePosition(); }
  };
  const cancelEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
  const onKey = (event: Event) => {
    if (event instanceof KeyboardEvent && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) return;
    stop(true);
  };
  const cleanup = () => { for (const name of cancelEvents) window.removeEventListener(name, onKey, true); };
  for (const name of cancelEvents) window.addEventListener(name, onKey, { capture: true, passive: true });
  function apply() {
    if (stopped || context !== pageMemoryContext()) { stop(); return; }
    tries++;
    for (const c of snapshot!.containers ?? []) { const element = elementAt(c.path); if (element) { element.scrollLeft = c.x; element.scrollTop = c.y; } }
    const row = snapshot!.row ? Array.from(document.querySelectorAll<HTMLElement>("[data-page-memory-row]")).find(e => e.dataset.pageMemoryRow === snapshot!.row) : null;
    const requested = row ? window.scrollY + row.getBoundingClientRect().top - (snapshot!.offset ?? 0) : snapshot!.y;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ left: snapshot!.x, top: Math.max(0, Math.min(requested, max)), behavior: "instant" as ScrollBehavior });
    // Two layout frames after fresh data; missing/deleted anchors fall back to a clamped offset.
    if (tries < 3 || (!row && max < snapshot!.y && tries < 120)) frame = requestAnimationFrame(apply);
    else {
      if (row && popReturn) {
        const old = row.style.outline; row.style.outline = "2px solid #bfdbfe";
        window.setTimeout(() => { if (row.style.outline === "rgb(191, 219, 254) solid 2px" || row.style.outline === "2px solid rgb(191, 219, 254)") row.style.outline = old; }, 1600);
      }
      selectedRow = row ?? null;
      popReturn = false; stop(true);
    }
  }
  frame = requestAnimationFrame(apply);
  return () => stop();
}
let rawReplace: typeof history.replaceState | null = null;
export function returnToPageSource(navigate: (url: string, options?: { replace?: boolean }) => void, fallback: string) {
  const b = book(), e = b.entries[activeId], parent = e?.from ? b.entries[e.from] : null;
  if (scope && parent?.scope === scope && safePageUrl(parent.url) && parent.id !== e.id) {
    flushPagePosition(); history.back(); return;
  }
  navigate(safePageUrl(fallback) ?? "/merchants", { replace: true });
}
export function installPageMemory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const push = history.pushState;
  rawReplace = history.replaceState;
  const m = metadata(), b = book();
  if (m?.scope === null && b.entries[m.id]) activeId = m.id;
  else if (m?.scope) activeId = "";
  else mark(seed(currentUrl()), rawReplace);
  history.pushState = function (data, title, url) {
    const resolved = url ? new URL(String(url), window.location.href) : new URL(window.location.href);
    if (resolved.origin !== window.location.origin) return push.call(this, data, title, url);
    const target = safePageUrl(resolved.pathname + resolved.search + resolved.hash);
    flushPagePosition();
    if (!target) return push.call(this, data, title, url);
    const pendingOrigin = !scope ? metadata()?.id : null;
    const e = seed(target, activeId || pendingOrigin || null);
    selectedRow = null; popReturn = false;
    const state = data && typeof data === "object" ? data : {};
    push.call(this, { ...state, [META]: { id: e.id, scope: e.scope } }, title, url);
    persist(); notify();
  };
  history.replaceState = function (data, title, url) {
    const target = url ? new URL(String(url), window.location.href) : new URL(window.location.href);
    if (target.origin !== window.location.origin) return rawReplace!.call(this, data, title, url);
    const next = target.pathname + target.search + target.hash;
    let e = book().entries[activeId];
    if (!e || route(e.url) !== route(next)) {
      flushPagePosition();
      e = seed(next, e?.from ?? null);
      selectedRow = null;
    }
    // Same-page URL cleanup (create/follow flags) keeps entry identity and source.
    if (e.url !== next && book().latest[e.url] === e.id) delete book().latest[e.url];
    e.url = next; e.at = Date.now(); book().latest[next] = e.id;
    const state = data && typeof data === "object" ? data : {};
    rawReplace!.call(this, { ...state, [META]: { id: e.id, scope: e.scope } }, title, url);
    persist(); notify();
  };
  window.addEventListener("popstate", () => {
    // The old page's hook already saved states synchronously; preserve its last scroll.
    flushPagePosition();
    const m = metadata(), b = book();
    if (!scope && m?.scope) activeId = "";
    else if (m?.scope === scope && b.entries[m.id]) activeId = m.id;
    else mark(seed(currentUrl()), rawReplace!);
    pendingPosition = scope && b.entries[activeId]?.scroll ? pageMemoryContext() : null;
    selectedRow = null; popReturn = true; notify();
  });
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>("[data-page-memory-row]");
    if (row) { selectedRow = row; pendingPosition = null; }
    flushPagePosition();
  }, true);
  const releaseOnIntent = (event: Event) => {
    if (event instanceof KeyboardEvent && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) return;
    if (pendingPosition === pageMemoryContext()) { pendingPosition = null; flushPagePosition(); }
  };
  for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(name, releaseOnIntent, { capture: true, passive: true });
  window.addEventListener("pagehide", flushPagePosition);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPagePosition(); });
}
installPageMemory();

/** Scoped source summary contains UI state only, never company documents. */
export function sourcePageEntry() {
  if (!scope) return null;
  const b = book(), e = b.entries[activeId];
  const from = e?.from ? b.entries[e.from] : null;
  return from?.scope === scope ? { id: from.id, url: from.url, state: { ...from.state } } : null;
}

export function navigateAdjacentMerchant(navigate: (url: string, options?: { replace?: boolean }) => void, target: string, page: number) {
  if (!scope || !/^\/merchants\/\d+$/.test(target) || !Number.isSafeInteger(page) || page < 1) return;
  navigate(target, { replace: true });
  writePageSlot("navigationPage", page);
  notify();
}
