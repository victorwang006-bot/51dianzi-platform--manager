import { createRequire } from "node:module";
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  BusinessWorkbenchAccessProvider,
  BusinessWorkbenchRouteGate,
  businessContextMatchesMerchant,
} from "./BusinessWorkbenchAccessGate";
import type { BusinessWorkbenchCapability } from "../lib/businessWorkbenchCapabilities";

const requireAdmin = createRequire(import.meta.url);
const { JSDOM } = requireAdmin("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => {
    window: Window & typeof globalThis;
  };
};

type Fixture = {
  merchantId: number;
  merchantCanWrite: boolean;
  workbenchCapabilities: readonly BusinessWorkbenchCapability[];
  writeCapabilities: readonly BusinessWorkbenchCapability[];
};

type MountedGate = {
  container: HTMLElement;
  unmount(): Promise<void>;
};

async function mountGate(
  fixture: Fixture,
  capability: BusinessWorkbenchCapability,
  requiresWrite = false,
): Promise<MountedGate> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://127.0.0.1:3000/workbench/inventory?merchantId=30061",
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    localStorage: dom.window.localStorage,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("WORKBENCH_ACCESS_GATE_TEST_ROOT_MISSING");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        BusinessWorkbenchAccessProvider,
        fixture,
        createElement(
          BusinessWorkbenchRouteGate,
          { capability, requiresWrite },
          createElement("span", { "data-workbench-route": "rendered" }, "允许工作台路径"),
        ),
      ),
    );
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

describe("BusinessWorkbenchAccessGate rendered BFF scope behavior", () => {
  let mounted: MountedGate | undefined;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
  });

  it("allows an authorized merchant_mgr without any native business key when the current BFF scope and source capability permit the route", async () => {
    // The fixture intentionally contains no auth.me/native role permission. The
    // real gate receives only the BFF current-merchant context projection.
    mounted = await mountGate({
      merchantId: 30061,
      merchantCanWrite: true,
      workbenchCapabilities: ["inventory.read", "inventory.publish"],
      writeCapabilities: ["inventory.publish"],
    }, "inventory.publish", true);

    expect(mounted.container.querySelector("[data-workbench-route=rendered]")?.textContent)
      .toBe("允许工作台路径");
  });

  it("rejects a native superadmin-shaped session when BFF supplies no independent merchant scope", async () => {
    // A native super_admin is deliberately irrelevant here: no BFF capability
    // projection means no workbench route, rather than a role bypass.
    mounted = await mountGate({
      merchantId: 30061,
      merchantCanWrite: false,
      workbenchCapabilities: [],
      writeCapabilities: [],
    }, "inventory.read");

    expect(mounted.container.textContent).toContain("当前商户未获该业务模块访问范围");
    expect(mounted.container.querySelector("[data-workbench-route=rendered]")).toBeNull();
  });

  it("keeps read-only scope on the list route but does not render a publish/write route", async () => {
    mounted = await mountGate({
      merchantId: 30061,
      merchantCanWrite: false,
      workbenchCapabilities: ["inventory.read", "inventory.publish"],
      writeCapabilities: ["inventory.publish"],
    }, "inventory.read");
    expect(mounted.container.querySelector("[data-workbench-route=rendered]")).not.toBeNull();

    await mounted.unmount();
    mounted = await mountGate({
      merchantId: 30061,
      merchantCanWrite: false,
      workbenchCapabilities: ["inventory.read", "inventory.publish"],
      writeCapabilities: ["inventory.publish"],
    }, "inventory.publish", true);
    expect(mounted.container.textContent).toContain("当前商户仅可查看该业务范围");
    expect(mounted.container.querySelector("[data-workbench-route=rendered]")).toBeNull();
  });

  it("does not accept a context projection for another selected merchant", () => {
    expect(businessContextMatchesMerchant(30061, { id: 30061, canWrite: true })).toBe(true);
    expect(businessContextMatchesMerchant(30061, { id: 30062, canWrite: true })).toBe(false);
    expect(businessContextMatchesMerchant(30061, { id: "30061", canWrite: true })).toBe(false);
    expect(businessContextMatchesMerchant(30061, null)).toBe(false);
  });
});
