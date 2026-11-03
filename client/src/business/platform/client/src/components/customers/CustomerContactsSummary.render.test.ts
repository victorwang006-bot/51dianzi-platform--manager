// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postcss from "postcss";

const runtime = vi.hoisted(() => ({
  query: null as any,
  calls: [] as Array<{ input: unknown; options: { enabled: boolean; retry: boolean; staleTime: number } }>,
  reset: vi.fn().mockResolvedValue(undefined),
  utils: null as any,
}));
vi.mock("../../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    customer: { contactsList: { useQuery: (input: unknown, options: any) => {
      runtime.calls.push({ input, options });
      return runtime.query;
    } } },
  },
}));

import { CustomerContactsSummary, type CustomerContactsSummaryProps } from "./CustomerContactsSummary";

const props: CustomerContactsSummaryProps = {
  customerId: 9701, contactName: "合成主联系人", primaryMethod: "手机：19900000001",
  contactCount: 8, scope: { actorUserId: 9007, enterpriseId: 9031, canManageAll: false },
  scopeReady: true, identityKey: "9007:9031:ready",
};
const activeContacts = Array.from({ length: 8 }, (_, index) => ({
  id: `synthetic-${index}`, name: `合成联系人${index + 1}`, department: "合成部门", position: "",
  methods: [{ type: "wechat", value: `synthetic-only-${index + 1}` }], isPrimary: index === 0,
  stoppedAt: null,
}));
let root: Root | null = null;
let host: HTMLDivElement;
function render(next: Partial<CustomerContactsSummaryProps> = {}) {
  act(() => root!.render(createElement(CustomerContactsSummary, { ...props, ...next })));
}
function clickMore() {
  const button = host.querySelector<HTMLButtonElement>("button")!;
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return button;
}
function enabledCalls() { return runtime.calls.filter(call => call.options.enabled); }

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.calls = [];
  runtime.reset.mockClear();
  runtime.utils = { customer: { contactsList: { reset: runtime.reset } } };
  runtime.query = {
    data: { contacts: [...activeContacts, { ...activeContacts[0], id: "stopped", name: "合成停用联系人", stoppedAt: "2026-10-01" }] },
    isPending: false, isLoading: false, isError: false, error: new Error("合成读取错误"),
    refetch: vi.fn().mockResolvedValue({}),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  root = null;
});

describe("compact customer contacts actual DOM behavior", () => {
  it("renders a single contact as adjacent complete name/method siblings, with no per-row fetch", () => {
    render({ contactCount: 1 });
    const summary = host.querySelector(".customer-contacts-summary")!;
    expect(Array.from(summary.children).map(child => child.textContent)).toEqual([props.contactName, props.primaryMethod]);
    expect(summary.querySelector("button")).toBeNull();
    expect(enabledCalls()).toHaveLength(0);
    expect(runtime.calls.at(-1)?.options).toEqual({ enabled: false, retry: false, staleTime: 0 });
  });

  it("opens the real lazy popover from 更多, shows loading then all eight names and total", () => {
    runtime.query = { ...runtime.query, data: undefined, isPending: true, isLoading: true };
    render();
    expect(host.querySelector("button")?.textContent).toBe("更多");
    expect(host.textContent).not.toMatch(/其他|共.*位/);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(enabledCalls()).toHaveLength(0);
    clickMore();
    expect(document.body.textContent).toContain("正在加载联系人");
    expect(enabledCalls().at(-1)?.input).toEqual({ customerId: 9701, expectedActorUserId: 9007, expectedEnterpriseId: 9031 });
    expect(enabledCalls().every(call => !call.options.retry && call.options.staleTime === 0)).toBe(true);
    runtime.query = { ...runtime.query, data: { contacts: activeContacts }, isPending: false, isLoading: false };
    render();
    expect(document.body.textContent).toContain("共 8 位");
    expect(Array.from(document.querySelectorAll("article strong")).map(node => node.textContent)).toEqual(activeContacts.map(contact => contact.name));
  });

  it.each(["座机：010-00000001 转 123", "微信：synthetic_only_wechat", "邮箱：synthetic@example.invalid"])("keeps the existing formatted non-mobile method: %s", primaryMethod => {
    render({ primaryMethod, contactCount: 1 });
    expect(host.querySelector(".customer-contacts-summary__method")?.textContent).toBe(primaryMethod);
    expect(enabledCalls()).toHaveLength(0);
  });

  it("blocks a null scope even when scopeReady is true, and guards the query input", () => {
    render({ scope: null });
    expect(clickMore().disabled).toBe(true);
    expect(enabledCalls()).toHaveLength(0);
    expect(runtime.calls.at(-1)?.input).toEqual({ customerId: 9701, expectedActorUserId: 0, expectedEnterpriseId: 0 });
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it("closes the real popover and resets cached contacts on context switch before old data can remain visible", () => {
    render();
    clickMore();
    expect(document.body.textContent).toContain("合成联系人8");
    expect(document.body.textContent).not.toContain("合成停用联系人");
    const callsBeforeSwitch = enabledCalls().length;
    render({ scope: { ...props.scope!, enterpriseId: 9032 }, identityKey: "9007:9032:ready" });
    expect(runtime.reset).toHaveBeenCalledTimes(1);
    expect(enabledCalls()).toHaveLength(callsBeforeSwitch);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(document.body.textContent).not.toContain("合成联系人8");
    runtime.query = { ...runtime.query, data: undefined, isPending: true };
    clickMore();
    expect(document.body.textContent).toContain("正在加载联系人");
    expect(document.body.textContent).not.toContain("合成联系人8");
    expect(enabledCalls().at(-1)?.input).toEqual({ customerId: 9701, expectedActorUserId: 9007, expectedEnterpriseId: 9032 });
  });

  it("keeps explicit manual retry without enabling automatic retries", () => {
    runtime.query = { ...runtime.query, isError: true };
    render();
    clickMore();
    expect(document.body.textContent).toContain("读取失败：合成读取错误");
    const retry = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "重试")!;
    act(() => retry.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(runtime.query.refetch).toHaveBeenCalledTimes(1);
    expect(enabledCalls().every(call => call.options.retry === false)).toBe(true);
  });

  it("owns scoped wrap-safe styles rather than truncating names or complete phone numbers", () => {
    const css = readFileSync("client/src/business/platform/client/src/components/customers/CustomerContactsSummary.css", "utf8");
    const sheet = postcss.parse(css);
    sheet.walkRules(rule => expect(rule.selector).toMatch(/^\.customer-contacts-summary/));
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("var(--admin-font-body, 15px)");
    expect(css).toContain("var(--admin-font-label, 14px)");
    expect(css).toContain("var(--admin-row-action-height, 34px)");
    expect(css).not.toMatch(/text-overflow|overflow:\s*hidden|truncate|fonts\.googleapis|scale\(/);
    render({ contactName: "合成较长联系人姓名不省略", primaryMethod: "座机：010-00000001 转 123456" });
    expect(host.querySelector(".customer-contacts-summary__name")?.textContent).toBe("合成较长联系人姓名不省略");
    expect(host.querySelector(".customer-contacts-summary__method")?.textContent).toBe("座机：010-00000001 转 123456");
  });
});
