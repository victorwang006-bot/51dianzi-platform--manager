// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, Route, Router, useLocation } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBusinessLocation } from "../../../../../api/business-wouter";
import { useCustomerNavigationGuard, type CustomerNavigationMode } from "./useCustomerNavigationGuard";
import * as memory from "../../lib/pageMemory";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const nativeReplace = History.prototype.replaceState;
const nativeBack = History.prototype.back;
const nativeForward = History.prototype.forward;
const nativeGo = History.prototype.go;
const nativePush = History.prototype.pushState;
let root: Root;
let host: HTMLDivElement;
let serial = 0;
const runtime = { mode: "clean" as CustomerNavigationMode, blocked: vi.fn(), unmounts: 0,
  identity: "", mountedGuard: true, navigate: null as null | ((url: string, options?: any) => void) };
const pause = (ms = 40) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
function Owner() {
  const [draft] = useState("PRIVATE UNSAVED CUSTOMER DRAFT");
  useCustomerNavigationGuard({ getMode: () => runtime.mode, onBlocked: runtime.blocked, identityKey: runtime.identity });
  useEffect(() => () => { runtime.unmounts++; }, []);
  return React.createElement("p", { "data-customer-draft": true }, draft);
}
function Navigator() { const [, navigate] = useLocation(); runtime.navigate = navigate; return null; }
function App() {
  return React.createElement(Router, { base: "/workbench", hook: useBusinessLocation },
    React.createElement(Navigator),
    React.createElement(Link, { href: "/orders" }, "REAL SIDEBAR LINK"),
    React.createElement(Route, { path: "/customers/801" }, runtime.mountedGuard ? React.createElement(Owner) : null),
    React.createElement(Route, { path: "/orders" }, React.createElement("p", null, "ORDERS ROUTE")));
}
async function render() { await act(async () => { root.render(React.createElement(App)); }); }
function currentUrl() { return window.location.pathname + window.location.search + window.location.hash; }
async function program(url = "/orders", options?: any) { await act(async () => { runtime.navigate?.(url, options); await pause(1); }); }
async function sidebar() { await act(async () => { host.querySelector<HTMLAnchorElement>("a")!.click(); await pause(1); }); }
async function browserBack() { await act(async () => { nativeBack.call(history); await pause(); }); }
async function browserForward() { await act(async () => { nativeForward.call(history); await pause(); }); }
function assertRetained(url: string, state: unknown) {
  expect(currentUrl()).toBe(url); expect(history.state).toEqual(state);
  expect(host.querySelector("[data-customer-draft]")?.textContent).toBe("PRIVATE UNSAVED CUSTOMER DRAFT"); expect(runtime.unmounts).toBe(0);
}
async function prepare(options: { forward?: boolean } = {}) {
  memory.setPageMemoryScope(null);
  nativeReplace.call(history, { sourceToken: "DO NOT LOSE" }, "", "/workbench/customers?merchantId=30061&keyword=synthetic&page=4");
  memory.setPageMemoryScope(runtime.identity);
  memory.writePageSlot("page", 4); memory.writePageSlot("appliedFilters", { keyword: "synthetic", starredOnly: true });
  const source = { url: currentUrl(), state: history.state };
  history.pushState({ customerToken: "ORIGINAL CUSTOMER STATE", nested: { keep: true } }, "", "/workbench/customers/801?merchantId=30061&tab=company");
  if (options.forward) {
    history.pushState({ nextToken: "ORIGINAL NEXT STATE" }, "", "/workbench/orders?merchantId=30061&status=all");
    await act(async () => { nativeBack.call(history); await pause(); });
  }
  await render(); return source;
}
let baseline: Pick<History, "pushState" | "replaceState" | "back" | "forward" | "go">;
beforeEach(() => {
  runtime.mode = "clean"; runtime.blocked.mockReset(); runtime.unmounts = 0; runtime.identity = `synthetic-guard-session-${++serial}`; runtime.mountedGuard = true;
  vi.spyOn(window, "confirm").mockReturnValue(false); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  baseline = { pushState: history.pushState, replaceState: history.replaceState, back: history.back, forward: history.forward, go: history.go };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); memory.setPageMemoryScope(null);
  // Only a test-owned concurrent wrapper may remain; return it to the fixture's owner.
  Object.assign(history, baseline); vi.restoreAllMocks();
});

describe.sequential("current customer SPA navigation guard using REAL wouter browser location + pageMemory", () => {
  it.each(["program", "replace", "sidebar", "browser-back", "history-back", "history-go"])("dirty cancel %s keeps exact URL/state/draft without route unmount", async action => {
    await prepare(); runtime.mode = "dirty"; const url = currentUrl(), state = history.state, length = history.length;
    if (action === "program") await program();
    else if (action === "replace") await program("/orders?filter=open&page=7", { replace: true, state: { target: "KEEP" } });
    else if (action === "sidebar") await sidebar();
    else if (action === "browser-back") await browserBack();
    else await act(async () => { action === "history-back" ? history.back() : history.go(-1); await pause(); });
    assertRetained(url, state); expect(history.length).toBe(length); expect(window.confirm).toHaveBeenCalledTimes(1); expect(runtime.blocked).toHaveBeenCalledWith("dirty");
  });
  it.each(["program", "sidebar", "browser-back", "history-back"])("dirty confirm %s runs the original target once, including exact source/filter/page", async action => {
    const source = await prepare(); runtime.mode = "dirty"; vi.mocked(window.confirm).mockReturnValue(true); const length = history.length;
    if (action === "program") await program("/orders?filter=open&page=7", { state: { target: "KEEP" } });
    else if (action === "sidebar") await sidebar();
    else if (action === "browser-back") await browserBack();
    else await act(async () => { history.back(); await pause(); });
    expect(runtime.unmounts).toBe(1); expect(host.querySelector("[data-customer-draft]")).toBeNull(); expect(window.confirm).toHaveBeenCalledTimes(1);
    if (action.endsWith("back")) {
      expect(currentUrl()).toBe(source.url); expect(history.state).toEqual(source.state); expect(history.length).toBe(length);
      expect(memory.readPageSlot("page", 1)).toBe(4); expect(memory.readPageSlot("appliedFilters", { keyword: "", starredOnly: false })).toEqual({ keyword: "synthetic", starredOnly: true });
    } else {
      expect(currentUrl()).toContain("/workbench/orders"); expect(currentUrl()).toContain("merchantId=30061");
      if (action === "program") { expect(currentUrl()).toContain("filter=open&page=7"); expect(history.state.target).toBe("KEEP"); }
    }
  });
  it.each(["program", "replace", "sidebar", "browser-back", "history-back"])("busy/pending/unknown %s refuses without confirming or losing request owner", async action => {
    await prepare(); runtime.mode = "busy"; const url = currentUrl(), state = history.state;
    vi.mocked(window.confirm).mockReturnValue(true);
    if (action === "program") await program(); else if (action === "replace") await program("/orders", { replace: true });
    else if (action === "sidebar") await sidebar(); else if (action === "browser-back") await browserBack();
    else await act(async () => { history.back(); await pause(); });
    assertRetained(url, state); expect(window.confirm).not.toHaveBeenCalled(); expect(runtime.blocked).toHaveBeenCalledWith("busy");
  });
  it("dirty native browser forward cancel restores exact original customer and preserves the future entry", async () => {
    await prepare({ forward: true }); runtime.mode = "dirty"; const url = currentUrl(), state = history.state;
    await browserForward(); assertRetained(url, state);
    vi.mocked(window.confirm).mockReturnValue(true); await browserForward();
    expect(currentUrl()).toBe("/workbench/orders?merchantId=30061&status=all"); expect(history.state.nextToken).toBe("ORIGINAL NEXT STATE"); expect(runtime.unmounts).toBe(1);
  });
  it("busy native browser forward and programmatic forward remain mounted", async () => {
    await prepare({ forward: true }); runtime.mode = "busy"; const url = currentUrl(), state = history.state;
    await browserForward(); assertRetained(url, state);
    await act(async () => { history.forward(); await pause(); }); assertRetained(url, state); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("multi-step native popstate returns to the original entry, not a newly pushed substitute", async () => {
    memory.setPageMemoryScope(null); nativeReplace.call(history, {}, "", "/workbench/first"); memory.setPageMemoryScope(runtime.identity);
    history.pushState({ a: 1 }, "", "/workbench/second");
    history.pushState({ b: 2 }, "", "/workbench/customers/801?merchantId=30061"); await render();
    runtime.mode = "dirty"; const url = currentUrl(), state = history.state, length = history.length;
    await act(async () => { nativeGo.call(history, -2); await pause(); }); assertRetained(url, state); expect(history.length).toBe(length);
    vi.mocked(window.confirm).mockReturnValue(true); await act(async () => { nativeGo.call(history, -2); await pause(); });
    expect(currentUrl()).toBe("/workbench/first"); expect(history.length).toBe(length);
  });
  it.each(["back", "forward"])("legacy untracked same-document native %s restores without state replacement or a sentinel entry", async direction => {
    memory.setPageMemoryScope(null);
    nativeReplace.call(history, { oldEntry: serial }, "", `/workbench/legacy-source?case=${serial}`);
    const url = `/workbench/customers/801?legacy=${serial}`;
    const state = { original: serial, nested: { keep: true }, page: 4 };
    nativePush.call(history, state, "", url);
    if (direction === "forward") {
      nativePush.call(history, { nextEntry: serial }, "", `/workbench/legacy-next?case=${serial}`);
      await act(async () => { nativeBack.call(history); await pause(); });
      nativeReplace.call(history, state, "", url);
    }
    await render(); runtime.mode = "busy"; const length = history.length;
    await act(async () => { direction === "back" ? nativeBack.call(history) : nativeForward.call(history); await pause(600); });
    assertRetained(url, state); expect(history.length).toBe(length); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("clean ordinary navigation/history are not confirmed or interfered with", async () => {
    const source = await prepare(); await browserBack(); expect(currentUrl()).toBe(source.url); expect(history.state).toEqual(source.state);
    expect(window.confirm).not.toHaveBeenCalled(); expect(runtime.blocked).not.toHaveBeenCalled(); expect(runtime.unmounts).toBe(1);
  });
  it("same-URL history state writes preserve caller data without a leave prompt", async () => {
    await prepare(); runtime.mode = "busy"; const url = currentUrl();
    await act(async () => history.replaceState({ keep: "UPDATED IN PLACE", nested: { value: 7 } }, "", window.location.href));
    expect(currentUrl()).toBe(url); expect(history.state).toMatchObject({ keep: "UPDATED IN PLACE", nested: { value: 7 } }); expect(window.confirm).not.toHaveBeenCalled(); expect(runtime.unmounts).toBe(0);
  });
  it("unmount restores original history methods and removes capture/unload listeners", async () => {
    await prepare(); runtime.mode = "busy";
    runtime.mountedGuard = false; await render();
    for (const name of ["pushState", "replaceState", "back", "forward", "go"] as const) expect(history[name]).toBe(baseline[name]);
    await program(); expect(currentUrl()).toContain("/workbench/orders"); expect(runtime.blocked).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
  });
  it("cleanup does not overwrite a concurrent writer; retained wrapper becomes inactive pass-through", async () => {
    await prepare(); runtime.mode = "busy";
    const guardedPush = history.pushState;
    const concurrent: History["pushState"] = function (data, title, url) { return guardedPush.call(this, data, title, url); };
    history.pushState = concurrent; runtime.mountedGuard = false; await render(); expect(history.pushState).toBe(concurrent);
    await program(); expect(currentUrl()).toContain("/workbench/orders"); expect(runtime.blocked).not.toHaveBeenCalled();
  });
  it("identity cleanup/reinstall uses current callbacks and does not veto invalidation", async () => {
    await prepare(); runtime.mode = "busy"; runtime.identity += "-new-actor"; await render(); expect(runtime.blocked).not.toHaveBeenCalled();
    runtime.mode = "clean"; await program(); expect(currentUrl()).toContain("/workbench/orders"); expect(window.confirm).not.toHaveBeenCalled();
  });
});
