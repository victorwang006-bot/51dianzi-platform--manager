import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./OutboundManagement.css", import.meta.url), "utf8");
const normalized = css.replace(/\s+/g, " ");
const scope = ".aui-page.erp-ui.sales-order-page";

function rule(selector: string) {
  const start = normalized.indexOf(`${scope} ${selector} {`);
  expect(start, `Missing mall-only selector: ${selector}`).toBeGreaterThanOrEqual(0);
  return normalized.slice(start, normalized.indexOf("}", start) + 1);
}

describe("mall list style contract", () => {
  it("constrains all rules to the mall root without imports, global selectors or business-order selectors", () => {
    const selectors = Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|})\s*([^{}]+?)\s*\{/gm))
      .flatMap(match => match[1].split(",").map(selector => selector.replace(/\s+/g, " ").trim()));
    expect(selectors.length).toBeGreaterThan(15);
    expect(selectors.every(selector => selector.startsWith(scope))).toBe(true);
    expect(css).not.toMatch(/@import|@theme|@layer|!important|crm-sales-orders-page/);
  });

  it("keeps the independent white rounded filter card and list export toolbar", () => {
    expect(rule(".sales-order-filter-card")).toContain("margin: 0 0 12px;");
    expect(rule(".sales-order-filter-card")).toContain("border-radius: 8px;");
    expect(rule(".sales-order-filter-card")).toContain("background: #fff;");
    expect(rule(".sales-order-list-toolbar")).toContain("display: flex;");
    expect(rule(".sales-order-list-toolbar")).toContain("border-bottom: 1px solid var(--admin-color-border, #e2e8f0);");
  });

  it("uses the original business table padding, font roles, status dots, text actions and paging controls", () => {
    expect(rule(".sales-order-table th")).toContain("padding: 6px 10px;");
    expect(rule(".sales-order-table th")).toContain("background: #f8fafc;");
    expect(rule(".sales-order-table th")).toContain("var(--admin-content-font-caption, 11px)");
    expect(rule(".sales-order-table td")).toContain("padding: 8px 10px;");
    expect(rule(".sales-order-table td")).toContain("var(--admin-content-font-body, 12px)");
    expect(rule(".sales-order-table tbody tr")).toContain("height: 56px;");
    expect(rule(".sales-order-status-dot")).toContain("background: transparent;");
    expect(rule(".inbound-row-menu")).toContain("border: 0;");
    expect(rule(".inbound-row-menu")).toContain("background: transparent;");
    expect(rule(".sales-order-pagination")).toContain("var(--admin-content-font-caption, 11px)");
    expect(css).toContain("height: var(--admin-content-control-height, 32px);");
  });
});
