// @vitest-environment jsdom
// Route-only regression. Page bodies are markers; production authentication is never altered.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { WorkspaceTabs } from "../components/admin/AdminWorkspaceNavigation";
import { SourceSwitch, CompiledSwitch } from "./mallRouteFixture.generated";
let root: Root | undefined;
let host: HTMLDivElement | undefined;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; });
function mount(Screen: React.ComponentType, path: string) {
  const memory = memoryLocation({ path, record: true });
  function Navigation() {
    const [location, navigate] = useLocation();
    return React.createElement(React.Fragment, null,
      React.createElement(WorkspaceTabs, { items: [{ label: "库存列表", path: "/workbench/channel-inventory" }, { label: "商城物料", path: "/workbench/mall-materials" }], location, onNavigate: (item: {path: string}) => navigate(item.path) }),
      React.createElement(Screen));
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(React.createElement(Router, { hook: memory.hook, searchHook: memory.searchHook }, React.createElement(Navigation))));
  return memory;
}
describe("mall real outer and nested route chain", () => {
  for (const [name, Screen] of [["source", SourceSwitch], ["deployed compiled candidate", CompiledSwitch]] as const) {
    it(`${name}: clicking the original primary mall menu reaches the nested MallMaterials route`, () => {
      const memory = mount(Screen, "/workbench/inbound");
      const button = host!.querySelector('button[data-workspace-nav-target="mall-materials"]')!;
      expect(button).not.toBeNull();
      act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(memory.history?.at(-1)).toBe("/workbench/mall-materials");
      expect(host!.querySelector('[data-route-component="MallMaterials"]')).not.toBeNull();
      expect(host!.querySelector('[data-route-component="NotFoundRoute"]')).toBeNull();
    });
    it(`${name}: direct mall deep link resolves the same nested page rather than App404`, () => {
      mount(Screen, "/workbench/mall-materials");
      expect(host!.querySelector('[data-route-component="MallMaterials"]')).not.toBeNull();
      expect(host!.querySelector('[data-route-component="NotFoundRoute"]')).toBeNull();
    });
  }
});
