// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: true, user: null }),
}));
import DashboardLayout from "@/components/DashboardLayout";

const css = readFileSync("client/src/styles/AdminReadability.css", "utf8");
const stylesheet = postcss.parse(css);
const nativeTypography = readFileSync(
  "client/src/business/BusinessNativeTypography.css",
  "utf8"
);
const mounted: Array<{ unmount: () => void; host: HTMLElement }> = [];

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  delete document.body.dataset.adminReadability;
});
afterEach(async () => {
  for (const { unmount, host } of mounted.splice(0).reverse()) {
    await act(async () => unmount());
    host.remove();
  }
  delete document.body.dataset.adminReadability;
});

async function mountLayout(strict = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const layout = createElement(DashboardLayout, null, "fixture");
  await act(async () => root.render(strict ? createElement(React.StrictMode, null, layout) : layout));
  const entry = { host, unmount: () => root.unmount() };
  mounted.push(entry);
  return async () => {
    mounted.splice(mounted.indexOf(entry), 1);
    await act(async () => root.unmount());
    host.remove();
  };
}

describe("admin readability visual foundation", () => {
  it("defines the approved tokens exactly once", () => {
    const expected = {
      "--admin-font-body": "15px",
      "--admin-font-label": "14px",
      "--admin-font-caption": "13px",
      "--admin-control-height": "40px",
      "--admin-row-action-height": "34px",
      "--admin-color-text": "#1F2937",
      "--admin-color-secondary": "#475569",
      "--admin-color-muted": "#64748B",
      "--admin-color-border": "#E2E8F0",
    };
    for (const [name, value] of Object.entries(expected)) {
      const declarations: string[] = [];
      stylesheet.walkDecls(name, decl => { declarations.push(decl.value); });
      expect(declarations, name).toEqual([value]);
    }
    for (const name of ["admin-cell-primary", "admin-cell-secondary", "admin-row-action", "admin-table-readable", "admin-page-title", "admin-section-title"]) {
      expect(css).toContain(`.${name}`);
    }
  });

  it("has no Google font import, scaling, unscoped visual selector or disabled-opacity reset", () => {
    expect(nativeTypography).not.toMatch(/fonts\.googleapis|Noto Sans|@import/);
    stylesheet.walkRules(rule => {
      if (rule.selector === ":root") {
        rule.walkDecls(decl => expect(decl.prop.startsWith("--")).toBe(true));
      } else {
        for (const selector of rule.selectors) {
          expect(selector).toMatch(/admin-readability|admin-workspace-shell|business-native-content|business-native-portals/);
        }
      }
      rule.walkDecls(decl => {
        expect(decl.prop).not.toMatch(/^(zoom|scale|opacity)$/);
        expect(decl.value).not.toMatch(/scale\(/);
      });
    });
    expect(css).not.toContain("svg {\n");
  });

  it("keeps real button size roles, icon sizing and disabled attributes intact", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(Button, { disabled: true }, "disabled"),
      createElement(Button, { size: "sm", className: "admin-row-action" }, "row action"),
      createElement(Button, { size: "icon" }, createElement("svg", { width: 16, height: 16 }))
    ));
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector('[data-admin-button-size="default"]')?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector('[data-admin-button-size="sm"]')?.className).toContain("admin-row-action");
    expect(host.querySelector('[data-admin-button-size="icon"]')?.className).toContain("size-9");
    expect(host.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  it("preserves a horizontal-scroll wrapper for the readable table", () => {
    const html = renderToStaticMarkup(createElement(Table, { className: "admin-table-readable" }));
    expect(html).toContain('data-slot="table-container"');
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("overflow-hidden");
  });

  it("sets and removes the portal scope even through StrictMode effect replay", async () => {
    expect(document.body.dataset.adminReadability).toBeUndefined();
    const unmount = await mountLayout(true);
    expect(document.body.dataset.adminReadability).toBe("true");
    await unmount();
    expect(document.body.dataset.adminReadability).toBeUndefined();
  });

  it("does not release an overlapping layout's portal scope and restores the previous marker", async () => {
    document.body.dataset.adminReadability = "previous-owner";
    const first = await mountLayout();
    const second = await mountLayout();
    await first();
    expect(document.body.dataset.adminReadability).toBe("true");
    await second();
    expect(document.body.dataset.adminReadability).toBe("previous-owner");
  });
});
