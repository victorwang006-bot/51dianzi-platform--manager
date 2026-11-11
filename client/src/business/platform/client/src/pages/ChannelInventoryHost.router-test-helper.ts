import { act, useSyncExternalStore } from "react";
import { vi } from "vitest";
import { channelInventoryTabLocation, channelInventoryViewLocation, type ChannelInventoryNavigationView, type ChannelInventoryNavigationTab } from "../../../../../lib/channelInventoryNavigation";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

/** Mirrors the /workbench NestedRouter bridge without a production router/network. */
export const hostNavigate = vi.fn((location: string) => {
  const target = location.startsWith("/channel-inventory") ? `/workbench${location}` : location;
  window.history.pushState(null, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
});

export const hostWouterHooks = {
  useSearch: () => useSyncExternalStore(subscribe, () => window.location.search.replace(/^\?/, "")),
  useLocation: () => [useSyncExternalStore(subscribe, () => window.location.pathname.replace(/^\/workbench/, "") || "/"), hostNavigate] as const,
};

/** Simulates top-level menu selection or a browser history notification. */
export function setHostTestLocation(location: string, historyMode: "push" | "replace" = "push") {
  act(() => {
    if (historyMode === "push") window.history.pushState(null, "", location);
    else window.history.replaceState(null, "", location);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

export function selectHostView(view: ChannelInventoryNavigationView) {
  setHostTestLocation(channelInventoryViewLocation(view)!);
}

export function selectHostTab(tab: ChannelInventoryNavigationTab) {
  setHostTestLocation(channelInventoryTabLocation(tab)!);
}
