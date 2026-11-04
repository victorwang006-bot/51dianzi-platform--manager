// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDataPanel, AdminFilterBar, AdminPage, AdminPageHeader, AdminPageTabs } from "./UnifiedAdminPage";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (node: React.ReactNode) => act(() => root.render(node));

describe("channel-reference admin primitives", () => {
  it("preserves a single semantic heading and original action handler", () => {
    const onClick = vi.fn();
    render(createElement(AdminPageHeader, { title: "我的库存", description: "仅供当前授权范围", actions: createElement("button", { onClick }, "表格上传") }));
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("我的库存");
    act(() => host.querySelector("button")!.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("does not render empty description/action regions", () => {
    render(createElement(AdminPageHeader, { title: "采购需求" }));
    expect(host.querySelector(".aui-page-description")).toBeNull();
    expect(host.querySelector(".aui-page-actions")).toBeNull();
  });
  it("keeps genuine navigation href and current-page semantics", () => {
    render(createElement(AdminPageTabs, { ariaLabel: "采购工作台功能" }, createElement("a", { href: "/workbench/procurement/demands?merchantId=30061", "aria-current": "page" }, "内部需求")));
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe("采购工作台功能");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/workbench/procurement/demands?merchantId=30061");
    expect(host.querySelector("a")?.getAttribute("aria-current")).toBe("page");
  });
  it("keeps disabled controls disabled and preserves accessible field names", () => {
    const onClick = vi.fn();
    render(createElement(AdminFilterBar, { "aria-label": "库存筛选", className: "existing-filter" }, createElement("input", { "aria-label": "搜索型号", defaultValue: "TLV3202AIDR" }), createElement("button", { disabled: true, onClick }, "刷新")));
    expect(host.querySelector(".aui-filterbar.existing-filter")).not.toBeNull();
    expect(host.querySelector("input")?.getAttribute("aria-label")).toBe("搜索型号");
    act(() => host.querySelector("button")!.click());
    expect(onClick).not.toHaveBeenCalled();
  });
  it("does not lose table headings, operation buttons or pagination", () => {
    render(createElement(AdminPage, { "aria-label": "订单" }, createElement(AdminDataPanel, null, createElement("table", null, createElement("thead", null, createElement("tr", null, createElement("th", null, "订单编号"))), createElement("tbody", null, createElement("tr", null, createElement("td", null, "SO0001")))), createElement("footer", null, "共1条"))));
    expect(host.querySelector('[data-admin-ui-system="channel-inventory"]')).not.toBeNull();
    expect(host.querySelector("th")?.textContent).toBe("订单编号");
    expect(host.querySelector("footer")?.textContent).toBe("共1条");
  });
});

describe("content-only reference theme boundaries", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../styles/AdminUnifiedSystem.css"), "utf8");
  const layout = readFileSync(resolve(import.meta.dirname, "../DashboardLayout.tsx"), "utf8");
  const primitives = readFileSync(resolve(import.meta.dirname, "UnifiedAdminPage.tsx"), "utf8");
  it("sets compact role tokens instead of page scaling", () => {
    for (const token of ["--admin-font-body: 13px", "--admin-font-table-heading: 12px", "--admin-font-caption: 12px", "--admin-control-height: 34px", "--admin-dialog-title-size: 18px"]) expect(css).toContain(token);
    expect(css).not.toMatch(/(?:^|[;{\s])(?:zoom|transform)\s*:/);
    expect(css).not.toMatch(/!important\s*[;}]/);
  });
  it("does not restyle the outer header or reference channel host", () => {
    expect(css).toContain(".admin-unified-content:not(:has(.ci-host, .ci-host-state))");
    expect(css).not.toMatch(/\.admin-workspace-shell__(?:header|brand|account|navigation)\s*[{,]/);
    expect(layout).toContain('className="admin-workspace-shell__main admin-unified-content" data-admin-ui-system="channel-inventory"');
  });
  it("covers body-mounted form controls, sheets and native channel dialogs", () => {
    expect(css).toContain('[data-slot="select-content"]');
    expect(css).toContain('[data-slot="dialog-content"]');
    expect(css).toContain('[role="dialog"]');
    expect(css).toContain('[data-slot="sheet-content"]');
  });
  it("contains no data, permission or router side effects in primitives", () => {
    expect(primitives).not.toMatch(/useQuery|useMutation|useEffect|useState|fetch\(|trpc|useLocation|permissionKeys/);
  });
});
