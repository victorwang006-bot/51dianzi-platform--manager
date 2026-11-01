import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const scope =
  ":where(.business-native-content, #business-native-portals) .erp-ui.sales-order-page";

const styles = source("./BusinessOutboundNativeStyles.css");
const normalizedStyles = styles.replace(/\s+/g, " ").trim();
const frame = source("./BusinessContentFrame.tsx");
const portal = source("./BusinessPortal.ts");
const outbound = source("./platform/client/src/pages/OutboundManagement.tsx");

function styleSelectors(css: string) {
  return Array.from(
    css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|})\s*([^{}]+?)\s*\{/gm),
    match => match[1].replace(/\s+/g, " ").trim()
  ).filter(selector => !selector.startsWith("@"));
}

describe("BusinessOutboundNativeStyles", () => {
  it("loads the isolated outbound stylesheet from the business content frame", () => {
    expect(frame).toContain('import "./BusinessOutboundNativeStyles.css";');
    expect(frame).toContain(
      'className="business-native-content min-h-full w-full bg-background text-foreground"'
    );
    expect(frame).toContain(
      '<div id={BUSINESS_PORTAL_ROOT_ID} className="business-native-portals" />'
    );
  });

  it("constrains every stylesheet selector to the native content or real portal root and sales-order page", () => {
    const selectors = styleSelectors(styles);
    expect(selectors.length).toBeGreaterThan(40);
    expect(selectors.every(selector => selector.startsWith(scope))).toBe(true);
    expect(styles).not.toMatch(
      /^\s*(?:@import|@theme|@layer|html|body|:root)\b/m
    );
  });

  it("restores the status strip, compact filter controls, and order table geometry", () => {
    for (const selector of [
      ".sales-order-status-tabs",
      ".sales-order-status-tab",
      ".sales-order-toolbar .crm-input",
      ".sales-order-compact-button",
      ".sales-order-table",
      ".sales-order-table th",
      ".sales-order-table td",
      ".sales-order-table-viewport",
    ])
      expect(normalizedStyles).toContain(`${scope} ${selector}`);

    for (const declaration of [
      "gap: 20px;",
      "height: 36px;",
      "height: 32px;",
      "height: 56px;",
      "padding: 6px 8px;",
      "border-bottom-color: #e2e8f0;",
      "overscroll-behavior-x: contain;",
      "accent-color: #185fa5;",
    ])
      expect(styles).toContain(declaration);
  });

  it("covers the CRM details, logistics/amount table text, action menu, and pagination used by OutboundManagement", () => {
    for (const selector of [
      ".crm-badge",
      ".crm-link",
      ".crm-detail-table",
      ".crm-detail-table .label-cell",
      ".inbound-row-menu",
      ".erp-menu-item",
      ".erp-menu-item-danger",
      ".sales-order-pagination",
    ])
      expect(normalizedStyles).toContain(`${scope} ${selector}`);

    for (const declaration of [
      "font-variant-numeric: tabular-nums;",
      "min-height: 40px;",
      "min-height: 48px;",
      "padding: 8px 16px;",
      "flex-direction: column;",
    ])
      expect(styles).toContain(declaration);

    for (const className of [
      "sales-order-status-tabs",
      "sales-order-toolbar",
      "sales-order-table",
      "sales-order-pagination",
      "crm-detail-table",
      "inbound-row-menu",
      "erp-menu-item",
    ])
      expect(outbound).toContain(className);
  });

  it("uses the portal root that business UI primitives actually resolve while outbound itself remains in its page root", () => {
    expect(portal).toContain(
      'const BUSINESS_PORTAL_ROOT_ID = "business-native-portals"'
    );
    expect(portal).toContain(
      "return document.getElementById(BUSINESS_PORTAL_ROOT_ID) ?? undefined;"
    );
    expect(outbound).toContain('className="erp-ui sales-order-page"');
    expect(outbound).not.toContain("createPortal");
    expect(styles).toContain("#business-native-portals");
  });
});
