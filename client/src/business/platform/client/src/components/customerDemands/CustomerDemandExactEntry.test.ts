// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CustomerDemandExactEntry,
  customerDemandExactId,
} from "./CustomerDemandExactEntry";
const runtime = vi.hoisted(() => ({
  identity: "mock:actor:7",
  authorization: "grant:1",
  ready: true,
  query: undefined as any,
  get: vi.fn(),
  navigate: vi.fn(),
  dialog: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../../../../BusinessScope", () => ({
  useBusinessScope: () => ({
    storageScope: runtime.identity,
    contextVerification: { authorizationVersion: runtime.authorization },
  }),
}));
vi.mock("../../hooks/usePageMemory", () => ({
  usePageMemory: () => runtime.ready,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/customer-demands", runtime.navigate],
}));
vi.mock("../../../../../api/business-trpc", () => ({
  trpc: {
    customerDemand: {
      get: {
        useQuery: (input: unknown, options: unknown) => {
          runtime.get(input, options);
          return runtime.query;
        },
      },
    },
  },
}));
vi.mock("./CustomerDemandDialog", () => ({
  CustomerDemandDialog: (props: any) => {
    runtime.dialog(props);
    return h(
      "section",
      { role: "dialog", "data-exact-demand-id": props.demandId },
      props.customer.name,
      h("button", { onClick: props.onClose }, "关闭")
    );
  },
}));
let host: HTMLDivElement, root: Root;
function render(id: number | null = 41) {
  act(() => root.render(h(CustomerDemandExactEntry, { id })));
}
function state(extra: any = {}) {
  return {
    data: { id: 41, customerId: 12, customerName: "合成客户" },
    isFetchedAfterMount: true,
    isFetching: false,
    error: null,
    refetch: runtime.retry,
    ...extra,
  };
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  runtime.identity = "mock:actor:7";
  runtime.authorization = "grant:1";
  runtime.ready = true;
  runtime.query = state();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Synthetic exact-entry test forbids network");
    })
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
describe("提交后的唯一需求入口", () => {
  it.each([
    "",
    "demandId=0",
    "demandId=-1",
    "demandId=41&demandId=42",
    "demandId=041",
    "demandId=2147483648",
    "demandId=NaN",
  ])("rejects malformed or ambiguous IDs without widening scope: %s", input => {
    expect(customerDemandExactId(input)).toBeNull();
  });
  it("accepts one unique server-issued ID, not a keyword or another actor/customer", () => {
    expect(customerDemandExactId("keyword=OLD&demandId=41")).toBe(41);
    render();
    expect(runtime.get).toHaveBeenCalledWith(
      { id: 41 },
      expect.objectContaining({
        enabled: true,
        staleTime: 0,
        refetchOnMount: "always",
      })
    );
    expect(runtime.dialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        demandId: 41,
        customer: { id: 12, name: "合成客户" },
        mode: "view",
        readOnly: true,
      })
    );
  });
  it("invalid intent has an explicit error and disabled get, never falls back to a filtered list", () => {
    render(null);
    expect(host.textContent).toContain("需求定位参数无效");
    expect(runtime.dialog).not.toHaveBeenCalled();
    expect(runtime.get.mock.calls.at(-1)?.[1].enabled).toBe(false);
  });
  it.each(["FORBIDDEN", "NOT_FOUND"])(
    "server %s discards cached detail and exposes retry without any client-side identity substitution",
    code => {
      render();
      runtime.query = state({
        error: Object.assign(new Error("合成权限拒绝"), { data: { code } }),
      });
      render();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.textContent).not.toContain("合成客户");
      expect(host.textContent).toContain("合成权限拒绝");
      act(() => host.querySelector<HTMLButtonElement>("button")!.click());
      expect(runtime.retry).toHaveBeenCalledOnce();
    }
  );
  it("new authorization generation requires a new first-read proof even with same cached ID", () => {
    render();
    runtime.authorization = "grant:2";
    runtime.query = state({ isFetchedAfterMount: false, isFetching: true });
    render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("正在核验");
  });
  it("mismatched authorized get response is not used to bind a different demand", () => {
    runtime.query = state({
      data: { id: 42, customerId: 99, customerName: "不能泄露的错误需求" },
    });
    render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain("不能泄露");
  });
});
