// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/usePageIdentity", () => ({ usePageIdentity: () => null }));
type Memory = typeof import("./pageMemory");
let memory: Memory;
let useListPositionRestore: typeof import("../hooks/usePageMemory")["useListPositionRestore"];
const nativeReplace = History.prototype.replaceState;
const PREFIX = "51dianzi:page-memory:v1:";
const META = "__d51PageMemory";
const defaults = { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false, starredOnly: false };
const applied = { ...defaults, keyword: "ui-keyword", grade: "A", stage: "following", scope: "all", assignedUserId: "8", due: "overdue", archived: true, starredOnly: true };
let scope: string;
let serial = 0;
let viewport = { x: 0, y: 0 };
let frames = new Map<number, FrameRequestCallback>();
let frameSerial = 0;
let root: Root | null = null;
const id = () => history.state[META].id as string;
const url = () => window.location.pathname + window.location.search + window.location.hash;
const book = () => JSON.parse(sessionStorage.getItem(PREFIX + scope)!);
const pop = () => new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true }));
function drain(count = 4) {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(i * 16));
  }
}
function navigate(target: string, options?: { replace?: boolean }) {
  expect(options).toEqual({ replace: true });
  const absolute = target.startsWith("~") ? target.slice(1) : window.location.pathname.startsWith("/workbench/") ? "/workbench" + target : target;
  history.replaceState({}, "", absolute);
}
function listDom(prefix = false) {
  document.body.innerHTML = `${prefix ? '<section data-unrelated="true"></section>' : ""}<main><div data-page-memory-scroll="customer-list-table"><table><tbody><tr data-customer-id="801"><td><button>customer</button></td></tr></tbody></table></div></main>`;
  const scroller = document.querySelector<HTMLElement>("[data-page-memory-scroll]")!;
  const row = document.querySelector<HTMLElement>("[data-customer-id]")!;
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => ({ top: 820 - viewport.y, bottom: 860 - viewport.y, height: 40, left: 0, right: 0, width: 0, x: 0, y: 820 - viewport.y, toJSON() {} }));
  return { row, scroller };
}
function writeList() {
  memory.writePageSlot("appliedFilters", applied);
  memory.writePageSlot("draftFilters", { ...applied, keyword: "unapplied-ui-draft", grade: "B" });
  memory.writePageSlot("page", 4);
  memory.writePageSlot("moreFiltersOpen", true);
}
function expectList() {
  expect(memory.readPageSlot("appliedFilters", defaults)).toEqual(applied);
  expect(memory.readPageSlot("draftFilters", defaults)).toEqual({ ...applied, keyword: "unapplied-ui-draft", grade: "B" });
  expect(memory.readPageSlot("page", 1)).toBe(4);
  expect(memory.readPageSlot("moreFiltersOpen", false)).toBe(true);
}

beforeAll(async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); nativeReplace.call(history, {}, "", "/workbench/customers?merchantId=30061");
  memory = await import("./pageMemory");
  ({ useListPositionRestore } = await import("../hooks/usePageMemory"));
});
beforeEach(() => {
  scope = `business-domain:v1:staff:7:admin:101:enterprise:31:merchant:30061:binding:${++serial}`;
  viewport = { x: 0, y: 0 }; frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameSerial, callback); return frameSerial; });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
  Object.defineProperties(window, {
    scrollX: { configurable: true, get: () => viewport.x }, scrollY: { configurable: true, get: () => viewport.y },
    scrollTo: { configurable: true, value: vi.fn((options: ScrollToOptions) => { viewport = { x: options.left ?? viewport.x, y: options.top ?? viewport.y }; }) },
  });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
  memory.setPageMemoryScope(null);
  nativeReplace.call(history, {}, "", "/workbench/customers?merchantId=30061&view=source");
  memory.setPageMemoryScope(scope);
});
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  frames.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
afterAll(() => memory.setPageMemoryScope(null));

describe.sequential("business page-memory actual store and history", () => {
  it("restores complete starredOnly=true filter objects without resetting page 4 or unapplied drafts", () => {
    writeList(); history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    history.replaceState({}, "", "/workbench/customers?merchantId=30061&view=source");
    expectList(); expect(book().entries[id()].state.appliedFilters.starredOnly).toBe(true);
  });

  it("migrates only the known old missing starredOnly to false while preserving other filters and page", () => {
    const legacyScope = scope + "-legacy", legacyId = "legacy-record";
    const { starredOnly: _lost, ...oldFilters } = applied;
    sessionStorage.setItem(PREFIX + legacyScope, JSON.stringify({ entries: { [legacyId]: { id: legacyId, scope: legacyScope, url: url(), from: null, at: Date.now(), state: { appliedFilters: oldFilters, draftFilters: oldFilters, page: 4 } } }, latest: { [url()]: legacyId } }));
    memory.setPageMemoryScope(null); nativeReplace.call(history, { [META]: { id: legacyId, scope: legacyScope } }, "", url());
    memory.setPageMemoryScope(legacyScope);
    expect(memory.readPageSlot("appliedFilters", defaults)).toEqual({ ...oldFilters, starredOnly: false });
    expect(memory.readPageSlot("draftFilters", defaults)).toEqual({ ...oldFilters, starredOnly: false });
    expect(memory.readPageSlot("page", 1)).toBe(4);
    expect(JSON.parse(sessionStorage.getItem(PREFIX + legacyScope)!).entries[legacyId].state.appliedFilters.starredOnly).toBe(false);
  });

  it("does not blanket-default corrupt/unknown partial filter schemas", () => {
    const { starredOnly: _lost, grade: _corrupt, ...partial } = applied;
    memory.writePageSlot("appliedFilters", partial);
    expect(memory.readPageSlot("appliedFilters", defaults)).toEqual(defaults);
    memory.writePageSlot("appliedFilters", { ...applied, starredOnly: "true" });
    expect(memory.readPageSlot("appliedFilters", defaults)).toEqual(defaults);
    memory.writePageSlot("appliedFilters", applied);
    expect(memory.readPageSlot("appliedFilters", { ...defaults, unapprovedFilter: false })).toEqual({ ...defaults, unapprovedFilter: false });
  });

  it.each(["button", "browser"])("list → detail → %s back restores the exact source visit and page 4", async method => {
    writeList(); const source = id();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    const done = pop(), navigateSpy = vi.fn();
    if (method === "browser") history.back(); else memory.returnToPageSource(navigateSpy, "/customers");
    await done; expect(navigateSpy).not.toHaveBeenCalled(); expect(id()).toBe(source); expectList();
    expect(url()).toBe("/workbench/customers?merchantId=30061&view=source");
  });

  it("retains adjacency across detail replace and uses history.back only with matching history proof", async () => {
    writeList(); const source = id();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    history.replaceState({}, "", "/workbench/customers/802?merchantId=30061");
    const done = pop(), back = vi.spyOn(history, "back"); memory.returnToPageSource(vi.fn(), "/customers"); await done;
    expect(back).toHaveBeenCalledOnce(); expect(id()).toBe(source); expectList();
  });

  it("unreliable nonadjacent logical source uses its exact URL+snapshot, not latest list or page 1", () => {
    writeList(); const source = id(), original = url();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    // Another actual browser entry was interposed; retain the logical source,
    // but the old adjacency proof cannot authorize back to it.
    const entry = book().entries[id()];
    nativeReplace.call(history, { [META]: { id: entry.id, scope, previous: "interposed-entry" } }, "", url());
    const back = vi.spyOn(history, "back"), navigation = vi.fn(navigate);
    memory.returnToPageSource(navigation, "/customers");
    expect(back).not.toHaveBeenCalled(); expect(navigation).toHaveBeenCalledWith("/customers?merchantId=30061&view=source", { replace: true });
    expect(url()).toBe(original); expect(id()).not.toBe(source); expectList();
  });

  it("direct orphan detail recovers previously browsed source URL and snapshot including merchant bridge", () => {
    writeList(); const original = url();
    memory.setPageMemoryScope(null);
    nativeReplace.call(history, { [META]: { id: "missing-detail", scope } }, "", "/workbench/customers/801?merchantId=30061");
    memory.setPageMemoryScope(scope);
    const back = vi.spyOn(history, "back"), navigation = vi.fn(navigate);
    memory.returnToPageSource(navigation, "/customers");
    expect(back).not.toHaveBeenCalled(); expect(url()).toBe(original); expectList();
  });

  it("unknown source falls back safely within the current workbench merchant", () => {
    memory.setPageMemoryScope(null);
    nativeReplace.call(history, {}, "", "/workbench/customers/801?merchantId=30061");
    memory.setPageMemoryScope(scope + "-no-source");
    const back = vi.spyOn(history, "back"), navigation = vi.fn(navigate);
    memory.returnToPageSource(navigation, "/customers");
    expect(back).not.toHaveBeenCalled(); expect(navigation).toHaveBeenCalledWith("/customers?merchantId=30061", { replace: true });
    expect(url()).toBe("/workbench/customers?merchantId=30061");
  });

  it("never restores another staff/admin/enterprise/merchant/binding namespace", () => {
    writeList();
    for (const other of [scope.replace("staff:7", "staff:8"), scope.replace("admin:101", "admin:102"), scope.replace("enterprise:31", "enterprise:32"), scope.replace("merchant:30061", "merchant:30062"), scope + "-changed-binding"]) {
      memory.setPageMemoryScope(other);
      expect(memory.readPageSlot("appliedFilters", defaults)).toEqual(defaults); expect(memory.readPageSlot("page", 1)).toBe(1);
    }
    memory.setPageMemoryScope(null); expect(memory.readPageSlot("appliedFilters", defaults)).toEqual(defaults);
  });

  it("stores bounded UI only, strips private name/contacts/record bodies and unknown slots", () => {
    memory.writePageSlot("listing", { page: 4, keyword: "ui-keyword", name: "PRIVATE NAME", contacts: { name: "PRIVATE CONTACT", phone: "PRIVATE PHONE" }, records: { name: "PRIVATE RECORD" } });
    memory.writePageSlot("form", { name: "PRIVATE FORM" });
    expect(book().entries[id()].state.listing).toEqual({ page: 4, keyword: "ui-keyword" });
    expect(sessionStorage.getItem(PREFIX + scope)).not.toContain("PRIVATE");
    for (let n = 0; n < 75; n++) history.pushState({}, "", `/workbench/customers/${n + 1}?merchantId=30061`);
    expect(Object.keys(book().entries).length).toBeLessThanOrEqual(60);
    expect(sessionStorage.getItem(PREFIX + scope)!.length).toBeLessThanOrEqual(180000);
  });

  it("bounds remembered identity namespaces without deleting unrelated application storage", () => {
    sessionStorage.setItem("unrelated-application", "keep");
    for (let n = 0; n < 12; n++) { memory.setPageMemoryScope(scope + `-namespace-${n}`); memory.writePageSlot("page", 4); }
    const keys = Array.from({ length: sessionStorage.length }, (_, n) => sessionStorage.key(n));
    expect(keys.filter(key => key?.startsWith(PREFIX)).length).toBeLessThanOrEqual(8);
    expect(sessionStorage.getItem("unrelated-application")).toBe("keep");
  });

  it("restores window x/y and keyed table x/y despite inserted DOM siblings, then briefly highlights the row", async () => {
    vi.useFakeTimers(); const original = listDom(); viewport = { x: 18, y: 700 }; original.scroller.scrollLeft = 432; original.scroller.scrollTop = 12;
    original.row.querySelector("button")!.click(); const source = id();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    document.body.replaceChildren(); viewport = { x: 0, y: 0 };
    const done = pop(); history.back(); await vi.advanceTimersByTimeAsync(20); await done;
    memory.flushPagePosition(); expect(book().entries[source].scroll).toMatchObject({ x: 18, y: 700, row: "801", containers: [{ key: "customer-list-table", x: 432, y: 12 }] });
    const current = listDom(true); memory.restorePagePosition(); drain();
    expect(viewport).toEqual({ x: 18, y: 700 }); expect(current.scroller.scrollLeft).toBe(432); expect(current.scroller.scrollTop).toBe(12);
    expect(current.row.dataset.pageMemoryHighlight).toBe("true"); vi.advanceTimersByTime(1600); expect(current.row.dataset.pageMemoryHighlight).toBeUndefined(); expect(current.row.style.outline).toBe("");
  });

  it("does not apply keyed scroll to a wrong path when the old table no longer exists", async () => {
    const original = listDom(); original.scroller.scrollLeft = 432; memory.flushPagePosition();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061"); const done = pop(); history.back(); await done;
    const other = listDom(); other.scroller.dataset.pageMemoryScroll = "unrelated-table";
    memory.restorePagePosition(); drain(); expect(other.scroller.scrollLeft).toBe(0);
  });

  it("explicit keyed zero scroll resets a retained table rather than inheriting another visit", async () => {
    listDom(); memory.flushPagePosition();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061");
    const done = pop(); history.back(); await done;
    const current = listDom(true); current.scroller.scrollLeft = 432; current.scroller.scrollTop = 12;
    memory.restorePagePosition(); drain(); expect(current.scroller.scrollLeft).toBe(0); expect(current.scroller.scrollTop).toBe(0);
  });
});

describe.sequential("actual React list-position restore lifecycle", () => {
  function Probe({ query, active }: { query: any; active: boolean }) { useListPositionRestore(query, active); return React.createElement("div", { "data-rendered-authorized": active }, "UI"); }
  async function render(query: any, active = true) {
    if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
    await act(async () => root!.render(React.createElement(Probe, { query, active })));
  }
  async function prepare() {
    viewport.y = 700; memory.flushPagePosition();
    history.pushState({}, "", "/workbench/customers/801?merchantId=30061"); viewport.y = 0;
    const done = pop(); history.back(); await done;
  }
  const success = () => ({ data: { items: [], total: 80 }, dataUpdatedAt: 1, isFetching: false, isPending: false, isError: false, isFetchedAfterMount: true });

  it("loading/cached/not-rendered data cannot consume the pending restore; authorized success restores once", async () => {
    await prepare();
    await render({ ...success(), isFetching: true, isFetchedAfterMount: false }); drain(); expect(viewport.y).toBe(0);
    await render(success(), false); drain(); expect(viewport.y).toBe(0);
    memory.flushPagePosition(); expect(book().entries[id()].scroll.y).toBe(700);
    await render(success()); await act(async () => drain()); expect(viewport.y).toBe(700);
    viewport.y = 222;
    await render({ ...success(), dataUpdatedAt: 2, isFetching: true });
    await render({ ...success(), dataUpdatedAt: 3 }); await act(async () => drain());
    expect(viewport.y).toBe(222); // completed restores never rerun on refetch
  });

  it("query loading mid-frame cancels without swallowing restore and successful retry completes", async () => {
    await prepare(); await render(success());
    await render({ ...success(), isFetching: true }); await act(async () => drain()); expect(viewport.y).toBe(0);
    await render({ ...success(), dataUpdatedAt: 2 }); await act(async () => drain()); expect(viewport.y).toBe(700);
  });

  it("identity change or revoke/error before a scheduled frame never restores old positions", async () => {
    await prepare(); await render(success());
    memory.setPageMemoryScope(scope + "-other-identity"); await act(async () => drain()); expect(viewport.y).toBe(0);
    await render({ ...success(), isError: true }, false); await act(async () => drain()); expect(viewport.y).toBe(0);
  });
});
