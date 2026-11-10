import { useLayoutEffect, useRef } from "react";

export type CustomerNavigationMode = "clean" | "dirty" | "busy";
export type CustomerNavigationGuardOptions = {
  getMode: () => CustomerNavigationMode;
  onBlocked?: (mode: "dirty" | "busy") => void;
  /** Change/unmount this guard with the real authorization/customer session. */
  identityKey?: string;
};

const discardMessage = "客户工作台有未保存的修改。确定放弃修改并离开吗？";
const pageMemoryKey = "__d51PageMemory";
type Entry = { href: string; state: unknown; id?: string; previous?: string | null };
function entry(): Entry {
  const state: unknown = window.history.state;
  const meta = state && typeof state === "object"
    ? (state as Record<string, unknown>)[pageMemoryKey] as { id?: unknown; previous?: unknown } | undefined
    : undefined;
  return { href: window.location.href, state,
    ...(typeof meta?.id === "string" ? { id: meta.id } : {}),
    ...(typeof meta?.previous === "string" || meta?.previous === null ? { previous: meta.previous } : {}),
  };
}

/**
 * One customer-session owner, not a router/authorization change. History writers
 * are wrapped BEFORE wouter's own writer so a refusal produces no router event.
 * Capture-phase popstate refuses BEFORE wouter/pageMemory subscribers can unmount.
 * No sentinels, history-state envelopes, request cancellation or draft persistence.
 */
export function useCustomerNavigationGuard(options: CustomerNavigationGuardOptions): void {
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const history = window.history;
    const originals = { pushState: history.pushState, replaceState: history.replaceState,
      back: history.back, forward: history.forward, go: history.go };
    let alive = true;
    let accepted = entry();
    let restoring = false;
    let approvedLink: URL | null = null;
    const predecessors = new Map<string, string | null>();
    const remember = (value: Entry) => {
      if (value.id && value.previous !== undefined) predecessors.set(value.id, value.previous);
    };
    remember(accepted);
    // The existing page-memory book contains UI-only source/filter/page entries.
    // Read its predecessor links; never alter its state, slots or scope.
    const loadPredecessors = () => {
      const state = accepted.state;
      const meta = state && typeof state === "object"
        ? (state as Record<string, unknown>)[pageMemoryKey] as { scope?: unknown } | undefined : undefined;
      if (typeof meta?.scope !== "string") return;
      try {
        const book = JSON.parse(sessionStorage.getItem("51dianzi:page-memory:v1:" + meta.scope) ?? "null");
        for (const value of Object.values(book?.entries ?? {}) as { id?: unknown; previous?: unknown }[]) {
          if (typeof value.id === "string" && (typeof value.previous === "string" || value.previous === null)) {
            predecessors.set(value.id, value.previous);
          }
        }
      } catch { /* Disabled UI memory is not a reason to clear a draft. */ }
    };
    const distance = (from: string, to: string): number | null => {
      const visited = new Set<string>();
      let current: string | null | undefined = from;
      let steps = 0;
      while (current && !visited.has(current)) {
        if (current === to) return steps;
        visited.add(current); current = predecessors.get(current); steps++;
      }
      return null;
    };
    const navigation = (window as unknown as { navigation?: {
      currentEntry?: { index: number }; entries?: () => { index: number; url: string; key: string }[];
    } }).navigation;
    let acceptedIndex = navigation?.currentEntry?.index;
    const traversalDelta = (target: Entry): number | null => {
      const currentIndex = navigation?.currentEntry?.index;
      if (acceptedIndex !== undefined && currentIndex !== undefined) return currentIndex - acceptedIndex;
      loadPredecessors(); remember(target);
      if (accepted.id && target.id) {
        const back = distance(accepted.id, target.id);
        if (back !== null) return -back;
        const forward = distance(target.id, accepted.id);
        if (forward !== null) return forward;
      }
      return null;
    };
    const allow = (): boolean => {
      if (!alive) return true;
      if (restoring) return false;
      const mode = latest.current.getMode();
      if (mode === "clean") return true;
      if (mode === "dirty" && window.confirm(discardMessage)) {
        // Confirmation may synchronously invalidate identity or start a write.
        if (latest.current.getMode() !== "busy") return true;
      }
      if (latest.current.getMode() === "clean") return true;
      latest.current.onBlocked?.(latest.current.getMode() === "busy" ? "busy" : "dirty");
      return false;
    };
    const changed = (url?: string | URL | null) => {
      if (url == null || url === "") return false;
      try { return new URL(String(url), window.location.href).href !== window.location.href; }
      catch { return false; } // Leave native validation/throw behavior unchanged.
    };
    const snapshot = () => {
      accepted = entry(); remember(accepted); acceptedIndex = navigation?.currentEntry?.index;
    };
    const matchesLink = (url?: string | URL | null) => {
      if (!approvedLink || url == null) return false;
      const destination = new URL(String(url), window.location.href);
      // The real business adapter may add the current merchantId to a Link.
      const expected = new URL(approvedLink.href);
      if (!expected.searchParams.has("merchantId")) {
        const current = new URL(window.location.href).searchParams.get("merchantId");
        if (current) expected.searchParams.set("merchantId", current);
      }
      return destination.href === approvedLink.href || destination.href === expected.href;
    };
    const pushState: History["pushState"] = function (this: History, state, title, url) {
      if (!alive) return originals.pushState.call(this, state, title, url);
      const linkApproved = matchesLink(url);
      approvedLink = null;
      if (changed(url) && !(linkApproved && latest.current.getMode() !== "busy") && !allow()) return;
      const result = originals.pushState.call(this, state, title, url);
      snapshot(); return result;
    };
    const replaceState: History["replaceState"] = function (this: History, state, title, url) {
      if (!alive) return originals.replaceState.call(this, state, title, url);
      const linkApproved = matchesLink(url);
      approvedLink = null;
      if (changed(url) && !(linkApproved && latest.current.getMode() !== "busy") && !allow()) return;
      const result = originals.replaceState.call(this, state, title, url);
      snapshot(); return result;
    };
    const traverse = (action: () => void) => {
      if (!alive) { action(); return; }
      // Busy refuses before the URL moves. Dirty is decided at the actual
      // popstate, not via a timed approval that could leak to a later gesture
      // when back/forward hit a history boundary and produced no event.
      if (restoring) return;
      if (latest.current.getMode() === "busy") { latest.current.onBlocked?.("busy"); return; }
      action();
    };
    const back: History["back"] = function (this: History) { traverse(() => originals.back.call(this)); };
    const forward: History["forward"] = function (this: History) { traverse(() => originals.forward.call(this)); };
    const go: History["go"] = function (this: History, delta = 0) {
      if (!delta) { if (allow()) originals.go.call(this, delta); return; }
      traverse(() => originals.go.call(this, delta));
    };
    history.pushState = pushState; history.replaceState = replaceState;
    history.back = back; history.forward = forward; history.go = go;
    const onPopState = (event: PopStateEvent) => {
      if (!alive) return;
      const target = entry();
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        // The real original entry/state is back; no replacement of the source.
        snapshot(); return;
      }
      if (target.href === accepted.href || allow()) {
        snapshot(); return;
      }
      event.stopImmediatePropagation();
      const delta = traversalDelta(target);
      if (delta !== null && delta !== 0) {
        restoring = true;
        originals.go.call(history, -delta);
      } else {
        // Untracked native entries have no direction in the legacy History API.
        // Keep both original states and use a reversible one-step probe rather
        // than overwriting a source/filter/page entry with the customer's URL.
        restoring = true;
        restoreUnknown(target);
      }
    };
    // Legacy browsers expose no traversal index for untracked entries. Search
    // same-document history without replacing/deleting any entry. The Navigation
    // API or application's page-memory predecessor chain avoids this slow path.
    let probe: { target: Entry; phase: "back" | "forward" } | null = null;
    let probeTimer: number | undefined;
    const probeStep = () => {
      if (!probe || !alive) return;
      window.clearTimeout(probeTimer);
      originals.go.call(history, probe.phase === "back" ? -1 : 1);
      // No popstate means the backward end was reached; try the other direction.
      probeTimer = window.setTimeout(() => {
        if (probe?.phase === "back") { probe.phase = "forward"; probeStep(); }
      }, 100);
    };
    const restoreUnknown = (target: Entry) => {
      probe = { target, phase: "back" };
      probeStep();
    };
    const onProbe = (event: PopStateEvent) => {
      if (!probe || !alive) return;
      event.stopImmediatePropagation();
      const target = entry();
      if (target.href === accepted.href && (accepted.id ? target.id === accepted.id : true)) {
        window.clearTimeout(probeTimer);
        probe = null; restoring = false; snapshot(); return;
      }
      probeStep();
    };
    // Probe capture comes first; ordinary capture never exposes a rejected route.
    window.addEventListener("popstate", onProbe, true);
    window.addEventListener("popstate", onPopState, true);
    const onClick = (event: MouseEvent) => {
      if (!alive || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
      const destination = new URL(anchor.href, window.location.href);
      if (!/^https?:$/.test(destination.protocol) || destination.href === window.location.href) return;
      if (!allow()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      // Let the real Link handler choose its exact destination/state, once.
      approvedLink = destination;
      queueMicrotask(() => { approvedLink = null; });
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!alive || latest.current.getMode() === "clean") return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      alive = false;
      window.clearTimeout(probeTimer);
      window.removeEventListener("popstate", onProbe, true);
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
      // A later/concurrent wrapper belongs to its owner. Never overwrite it;
      // our captured wrapper becomes a transparent pass-through after cleanup.
      if (history.pushState === pushState) history.pushState = originals.pushState;
      if (history.replaceState === replaceState) history.replaceState = originals.replaceState;
      if (history.back === back) history.back = originals.back;
      if (history.forward === forward) history.forward = originals.forward;
      if (history.go === go) history.go = originals.go;
    };
  }, [options.identityKey]);
}
