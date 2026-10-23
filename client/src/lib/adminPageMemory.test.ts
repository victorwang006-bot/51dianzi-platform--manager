// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PREFIX = "51dianzi:admin-page-memory:v1:";
const META = "__d51AdminPageMemory";
const nativeReplaceState = History.prototype.replaceState;

type AdminPageMemory = typeof import("@client/lib/adminPageMemory");
let memory: AdminPageMemory;

function replaceWithoutPageMemory(state: unknown, url: string) {
  nativeReplaceState.call(history, state, "", url);
}

function url() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function entryId() {
  return (history.state as Record<string, { id: string }>)[META].id;
}

function storedBook(scope: string) {
  const raw = sessionStorage.getItem(PREFIX + scope);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as {
    entries: Record<string, {
      url: string;
      from: string | null;
      state: Record<string, unknown>;
      scroll?: { x: number; y: number };
    }>;
    latest: Record<string, string>;
  };
}

function nextPopstate() {
  return new Promise<PopStateEvent>(resolve => window.addEventListener("popstate", resolve, { once: true }));
}

async function returnToSource(fallback = "/merchants") {
  const popped = nextPopstate();
  const navigate = vi.fn();
  memory.returnToPageSource(navigate, fallback);
  await popped;
  expect(navigate).not.toHaveBeenCalled();
}

beforeAll(async () => {
  sessionStorage.clear();
  replaceWithoutPageMemory({ test: "admin-page-memory" }, "/merchants");
  memory = await import("@client/lib/adminPageMemory");
});

afterAll(() => {
  memory.setPageMemoryScope(null);
  document.body.replaceChildren();
});

describe.sequential("admin page-memory return flows", () => {
  it("returns from detail to the exact page-12 merchant source with allowed list filters", async () => {
    const scope = "admin:101:roles:merchant-read";
    const createdAtFilter = { preset: "range", from: "2025-01-01", to: "2025-01-31" };
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "page-twelve-source" }, "", "/merchants?view=active");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("search", "capacitor");
    memory.writePageSlot("searchInput", "capacitor");
    memory.writePageSlot("salesOwnerFilter", "sales-208");
    memory.writePageSlot("createdAtFilter", createdAtFilter);
    memory.writePageSlot("pageSize", 20);
    memory.writePageSlot("activeTab", "active");
    const source = entryId();

    history.pushState({ case: "merchant-detail" }, "", "/merchants/merchant-240");
    expect(memory.sourcePageEntry()).toMatchObject({
      id: source,
      url: "/merchants?view=active",
      state: {
        page: 12,
        search: "capacitor",
        searchInput: "capacitor",
        salesOwnerFilter: "sales-208",
        createdAtFilter,
        pageSize: 20,
        activeTab: "active",
      },
    });

    await returnToSource();
    expect(entryId()).toBe(source);
    expect(url()).toBe("/merchants?view=active");
    expect(memory.readPageSlot("page", 1)).toBe(12);
    expect(memory.readPageSlot("search", "")).toBe("capacitor");
    expect(memory.readPageSlot("searchInput", "")).toBe("capacitor");
    expect(memory.readPageSlot("salesOwnerFilter", "")).toBe("sales-208");
    expect(memory.readPageSlot("createdAtFilter", { preset: "", from: "", to: "" })).toEqual(createdAtFilter);
    expect(memory.readPageSlot("pageSize", 10)).toBe(20);
    expect(memory.readPageSlot("activeTab", "")).toBe("active");
  });

  it("keeps a real source chain while identity is temporarily pending", async () => {
    const scope = "admin:102:roles:merchant-read";
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "pending-identity" }, "", "/merchants?pending=identity");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("search", "pending-source");
    const source = entryId();

    history.pushState({ case: "pending-detail" }, "", "/merchants/merchant-pending");
    const detail = entryId();
    memory.setPageMemoryScope(null);
    expect(history.state).toMatchObject({ [META]: { id: detail, scope } });

    memory.setPageMemoryScope(scope);
    expect(entryId()).toBe(detail);
    expect(memory.sourcePageEntry()).toMatchObject({ id: source, url: "/merchants?pending=identity" });
    await returnToSource();

    expect(entryId()).toBe(source);
    expect(memory.readPageSlot("page", 1)).toBe(12);
    expect(memory.readPageSlot("search", "")).toBe("pending-source");
  });

  it("never shares list memory across real administrator or role-permission scopes", () => {
    const readerScope = "admin:103:roles:merchant-read";
    const otherAccountScope = "admin:104:roles:merchant-read";
    const elevatedRoleScope = "admin:103:roles:merchant-manage";
    memory.setPageMemoryScope(readerScope);
    history.replaceState({ case: "scope-isolation" }, "", "/merchants?scope=isolation");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("search", "reader-only");
    memory.writePageSlot("salesOwnerFilter", "sales-reader");

    memory.setPageMemoryScope(otherAccountScope);
    expect(memory.pageMemoryContext()).toMatch(/^admin:104:roles:merchant-read:/);
    expect(memory.readPageSlot("page", 1)).toBe(1);
    expect(memory.readPageSlot("search", "")).toBe("");
    expect(memory.readPageSlot("salesOwnerFilter", "")).toBe("");

    memory.setPageMemoryScope(elevatedRoleScope);
    expect(memory.pageMemoryContext()).toMatch(/^admin:103:roles:merchant-manage:/);
    expect(memory.readPageSlot("page", 1)).toBe(1);
    expect(memory.readPageSlot("search", "")).toBe("");
    expect(memory.readPageSlot("salesOwnerFilter", "")).toBe("");
  });

  it("preserves the original page-12 source when same-source detail navigation replaces 240 with 241", async () => {
    const scope = "admin:105:roles:merchant-read";
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "replace-source" }, "", "/merchants?replace=source");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("pageSize", 20);
    const source = entryId();

    history.pushState({ case: "detail-240" }, "", "/merchants/merchant-240");
    const detail240 = entryId();
    history.replaceState({ case: "detail-241" }, "", "/merchants/merchant-241");
    const detail241 = entryId();
    expect(detail241).not.toBe(detail240);
    expect(memory.sourcePageEntry()).toMatchObject({ id: source, url: "/merchants?replace=source" });

    await returnToSource();
    expect(entryId()).toBe(source);
    expect(url()).toBe("/merchants?replace=source");
    expect(memory.readPageSlot("page", 1)).toBe(12);
    expect(memory.readPageSlot("pageSize", 10)).toBe(20);
  });

  it("keeps adjacent navigation on page 13 through 240 → 241 → 242 and returns to the original page 12", async () => {
    const scope = "admin:105:roles:merchant-read:adjacent";
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "adjacent-source" }, "", "/merchants?adjacent=source");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("pageSize", 20);
    const source = entryId();

    history.pushState({ case: "detail-240" }, "", "/merchants/240");
    const navigate = vi.fn((target: string, options?: { replace?: boolean }) => {
      expect(options).toEqual({ replace: true });
      history.replaceState({ case: `detail-${target.split("/").at(-1)}` }, "", target);
    });

    memory.navigateAdjacentMerchant(navigate, "/merchants/241", 13);
    expect(url()).toBe("/merchants/241");
    expect(memory.readPageSlot("navigationPage", 1)).toBe(13);
    expect(memory.sourcePageEntry()).toMatchObject({ id: source, url: "/merchants?adjacent=source" });

    memory.navigateAdjacentMerchant(navigate, "/merchants/242", 13);
    expect(url()).toBe("/merchants/242");
    expect(memory.readPageSlot("navigationPage", 1)).toBe(13);
    expect(memory.sourcePageEntry()).toMatchObject({ id: source, url: "/merchants?adjacent=source" });
    expect(navigate).toHaveBeenNthCalledWith(1, "/merchants/241", { replace: true });
    expect(navigate).toHaveBeenNthCalledWith(2, "/merchants/242", { replace: true });

    await returnToSource();
    expect(entryId()).toBe(source);
    expect(url()).toBe("/merchants?adjacent=source");
    expect(memory.readPageSlot("page", 1)).toBe(12);
    expect(memory.readPageSlot("pageSize", 10)).toBe(20);
  });

  it("falls back to the previously browsed real merchant list instead of orphan-detail state", () => {
    const scope = "admin:106:roles:merchant-read";
    const createdAtFilter = { preset: "last30", from: "2025-02-01", to: "2025-03-02" };
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "fallback-list" }, "", "/merchants?fallback=known-list");
    memory.writePageSlot("page", 12);
    memory.writePageSlot("search", "keep-real-list");
    memory.writePageSlot("createdAtFilter", createdAtFilter);
    memory.writePageSlot("pageSize", 20);
    const source = entryId();

    // Simulate a direct/reloaded detail whose original browser source has gone away.
    memory.setPageMemoryScope(null);
    replaceWithoutPageMemory({ [META]: { id: "missing-detail-source", scope } }, "/merchants/merchant-orphan");
    memory.setPageMemoryScope(scope);
    memory.writePageSlot("detailTab", "history");
    const navigate = vi.fn();
    memory.returnToPageSource(navigate, "/merchants");
    expect(navigate).toHaveBeenCalledWith("/merchants", { replace: true });

    // The router performs the requested fallback replacement; route memory selects the known list entry.
    history.replaceState({ case: "fallback-list-route" }, "", "/merchants");
    expect(memory.readPageSlot("page", 1)).toBe(12);
    expect(memory.readPageSlot("search", "")).toBe("keep-real-list");
    expect(memory.readPageSlot("createdAtFilter", { preset: "", from: "", to: "" })).toEqual(createdAtFilter);
    expect(memory.readPageSlot("pageSize", 10)).toBe(20);
    expect(memory.readPageSlot("detailTab", "summary")).toBe("summary");
    expect(storedBook(scope).entries[source].state).toMatchObject({ page: 12, search: "keep-real-list" });
  });

  it("persists UI state only, never an edited form body or enterprise profile", () => {
    const scope = "admin:107:roles:merchant-manage";
    memory.setPageMemoryScope(scope);
    history.replaceState({ case: "privacy" }, "", "/merchants?privacy=ui-only");
    memory.writePageSlot("listing", {
      page: 12,
      search: "ui-search-only",
      activeTab: "active",
      records: [{ merchantId: "merchant-private-240", legalName: "PRIVATE ENTERPRISE NAME" }],
      enterpriseProfile: { taxNumber: "TAX-NUMBER-MUST-NOT-PERSIST", bankAccount: "BANK-MUST-NOT-PERSIST" },
      formBody: { contactName: "FORM-BODY-MUST-NOT-PERSIST", notes: "PRIVATE EDIT NOTE" },
    });
    memory.writePageSlot("merchantProfile", { legalName: "PRIVATE ENTERPRISE NAME" });

    const raw = sessionStorage.getItem(PREFIX + scope)!;
    const active = entryId();
    expect(storedBook(scope).entries[active].state.listing).toEqual({
      page: 12,
      search: "ui-search-only",
      activeTab: "active",
    });
    expect(raw).not.toContain("merchant-private-240");
    expect(raw).not.toContain("PRIVATE ENTERPRISE NAME");
    expect(raw).not.toContain("TAX-NUMBER-MUST-NOT-PERSIST");
    expect(raw).not.toContain("BANK-MUST-NOT-PERSIST");
    expect(raw).not.toContain("FORM-BODY-MUST-NOT-PERSIST");
    expect(raw).not.toContain("PRIVATE EDIT NOTE");
  });

  it("does not overwrite a returned source position with zero while its list is still loading", async () => {
    const original = {
      scrollX: Object.getOwnPropertyDescriptor(window, "scrollX"),
      scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
      scrollTo: Object.getOwnPropertyDescriptor(window, "scrollTo"),
    };
    const viewport = { x: 0, y: 0 };
    Object.defineProperties(window, {
      scrollX: { configurable: true, get: () => viewport.x },
      scrollY: { configurable: true, get: () => viewport.y },
      scrollTo: { configurable: true, value: vi.fn((options: ScrollToOptions) => {
        viewport.x = options.left ?? viewport.x;
        viewport.y = options.top ?? viewport.y;
      }) },
    });
    try {
      // Deliberately tiny DOM fixture: this is browser-position state, not a mounted admin UI test.
      document.body.replaceChildren(document.createElement("main"));
      const scope = "admin:108:roles:merchant-read";
      memory.setPageMemoryScope(scope);
      history.replaceState({ case: "pending-position" }, "", "/merchants?position=pending");
      const source = entryId();
      viewport.x = 18;
      viewport.y = 700;
      history.pushState({ case: "position-detail" }, "", "/merchants/merchant-position");

      // Back occurs before rows have been refetched, so layout/browser scroll is temporarily zero.
      viewport.x = 0;
      viewport.y = 0;
      const popped = nextPopstate();
      history.back();
      await popped;
      memory.flushPagePosition();

      expect(storedBook(scope).entries[source].scroll).toMatchObject({ x: 18, y: 700 });
    } finally {
      const restore = (name: keyof typeof original) => {
        const descriptor = original[name];
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else delete (window as unknown as Record<string, unknown>)[name];
      };
      (Object.keys(original) as (keyof typeof original)[]).forEach(restore);
      document.body.replaceChildren();
    }
  });
});
