import { readFileSync } from "node:fs";
import postcss, { type Root } from "postcss";
import { describe, expect, it } from "vitest";
const css = (name: string) => readFileSync(`client/src/${name}`, "utf8");
const unified = postcss.parse(css("styles/AdminUnifiedSystem.css"));
const legacy = postcss.parse(css("styles/AdminReadability.css"));
const native = postcss.parse(css("business/BusinessNativeTypography.css"));
const tokens: Record<string, string> = {};
unified.walkRules(rule => {
  if (rule.selectors.includes(".admin-unified-content")) rule.walkDecls(decl => {
    if (decl.prop.startsWith("--")) tokens[decl.prop] = decl.value;
  });
});
function resolveRole(value: string): string {
  const variable = /^var\((--[\w-]+)(?:,\s*(.*))?\)$/.exec(value);
  return variable ? resolveRole(tokens[variable[1]] ?? variable[2] ?? "missing-token") : value;
}
function declarations(root: Root, selector: string, property: string) {
  const values: string[] = [];
  root.walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, decl => values.push(decl.value));
  });
  return values;
}
const platform = "business/platform/client/src/";
const cases: Array<[string, string, string, string, string]> = [
  ["native channel body", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-table td", "font-size", "13px"],
  ["native channel field", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-field", "font-size", "13px"],
  ["native channel text action", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-inline-link", "font-size", "13px"],
  ["native channel table heading", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-table th", "font-size", "12px"],
  ["native channel update time", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-table :is(.ci-lead-time, .ci-row-index, .ci-date, .ci-channel-type-tag)", "font-size", "12px"],
  ["native channel page tabs", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-tabs button", "font-size", "16px"],
  ["native channel dialog title", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-host-dialog h2", "font-size", "18px"],
  ["native channel ordinary button", `${platform}pages/ChannelInventoryHost.css`, ".ci-page.ci-host .ci-button", "min-height", "34px"],
  ["customer action remains unboxed", `${platform}pages/CustomerList.css`, ".customer-list-page .customer-list-text-action", "font-size", "13px"],
  ["customer table heading", `${platform}pages/CustomerList.css`, ".customer-list-page .customer-list-table th", "font-size", "12px"],
  ["customer regular control", `${platform}pages/CustomerList.css`, ".customer-list-page .customer-list-control", "height", "34px"],
  ["customer table leading", `${platform}pages/CustomerList.css`, ".customer-list-page .customer-list-table td", "line-height", "20px"],
  ["customer detail ordinary button", `${platform}pages/CustomerDetailReadability.css`, ".erp-ui.customer-detail-compact.customer-detail-readable .crm-btn", "height", "34px"],
  ["chat waiting auxiliary text", `${platform}components/ChatEntryWait.css`, ".d51-chat-entry-wait__enterprise-copy", "font-size", "12px"],
  ["procurement form", `${platform}pages/ProcurementOrders.css`, ".procurement-orders-page .procurement-order-control", "font-size", "13px"],
  ["procurement page tab", `${platform}pages/ProcurementOrders.css`, ".procurement-orders-page .procurement-order-tab", "font-size", "16px"],
  ["procurement dialog", `${platform}pages/ProcurementOrders.css`, ".procurement-orders-page .procurement-order-dialog-title", "font-size", "18px"],
  ["CRM sales form", `${platform}pages/CrmSalesOrders.css`, ".crm-sales-orders-control", "font-size", "13px"],
  ["CRM sales dialog", `${platform}pages/CrmSalesOrders.css`, '.crm-sales-orders-dialog [data-slot="dialog-title"]', "font-size", "18px"],
  ["inbound modal table heading", `${platform}pages/InboundManagement.css`, ".aui-page.erp-ui.inbound-management-page .inbound-modal .crm-table th", "font-size", "12px"],
  ["inventory control", `${platform}pages/MyInventory.css`, ".my-inventory-page .inventory-control", "height", "34px"],
  ["organization section", "pages/Organization.css", "[data-organization-page] h2", "font-size", "16px"],
  ["staff list body", "pages/Staff.css", "[data-staff-page] .staff-management-table", "font-size", "13px"],
  ["staff real sheet title", "components/admin/StaffPermissionSheet.css", '[data-staff-permission-sheet] [data-slot="sheet-title"]', "font-size", "18px"],
  ["staff real section title", "components/admin/StaffPermissionSheet.css", 'body[data-admin-readability="true"] [data-staff-permission-sheet] .staff-permission-panel h3', "font-size", "16px"],
  ["staff identity caption", "components/admin/StaffPermissionSheet.css", "[data-staff-permission-sheet] .staff-permission-identity", "font-size", "12px"],
  ["staff sheet save button", "components/admin/StaffPermissionSheet.css", '[data-staff-permission-sheet] .staff-permission-footer [data-slot="button"]', "height", "34px"],
  ["official team form label", "components/admin/OfficialTeamPermissionSection.css", ".official-team-settings__assignment-fields label", "font-size", "13px"],
  ["shared batch table heading", `${platform}components/channelInventory/batch.css`, ".ci-batch-preview th", "font-size", "12px"],
  ["shared batch body", `${platform}components/channelInventory/batch.css`, ".ci-batch-preview table", "font-size", "13px"],
  ["shared notes update time", `${platform}components/channelInventory/notes.css`, ".ci-note-entry-meta", "font-size", "12px"],
];
describe("v18 admin content font role contract (not browser measurements)", () => {
  it.each(cases)("%s", (_role, file, selector, property, expected) => {
    const values = declarations(postcss.parse(css(file)), selector, property);
    expect(values.length, `${file} ${selector}`).toBeGreaterThan(0);
    expect(values.every(value => value.startsWith("var(--admin-content-"))).toBe(true);
    expect(values.map(resolveRole)).toEqual(values.map(() => expected));
  });
  it("defines 13/12/16/18 roles and exact 20px leading, only in admin content/body portals", () => {
    for (const [name, expected] of Object.entries({
      "--admin-font-body": "13px", "--admin-font-label": "13px", "--admin-font-caption": "12px",
      "--admin-font-table-heading": "12px", "--admin-page-title-size": "16px", "--admin-section-title-size": "16px",
      "--admin-dialog-title-size": "18px", "--admin-control-height": "34px", "--admin-table-head-height": "34px",
      "--admin-content-line-height": "20px", "--admin-content-caption-line-height": "18px",
    })) expect(tokens[name], name).toBe(expected);
    unified.walkRules(rule => {
      rule.walkDecls(/^--admin-content-/, () => {
        expect(rule.selectors.every(selector => selector === ".admin-unified-content" || selector.startsWith('body[data-admin-readability="true"]'))).toBe(true);
        expect(rule.selector).not.toContain(":root");
      });
    });
    const text = unified.toString();
    for (const slot of ["dialog-content", "alert-dialog-content", "sheet-content", "select-content", "dropdown-menu-content", "popover-content", "tooltip-content"])
      expect(text).toContain(`[data-slot="${slot}"]`);
    expect(text).toContain('[role="dialog"]');
    expect(text).toContain('[role="alertdialog"]');
    expect(text).toContain('#business-native-portals');
  });
  it("preserves shell/chrome root tokens and existing caption bridge semantics", () => {
    const expected = { "--admin-font-body": "15px", "--admin-font-label": "14px", "--admin-font-caption": "13px", "--admin-control-height": "40px" };
    for (const [name, value] of Object.entries(expected)) expect(declarations(legacy, ":root", name)).toEqual([value]);
    const bridge = legacy.nodes.filter(node => node.type === "rule" && node.selector.includes(".text-xs, .text-"));
    expect(bridge).toHaveLength(1);
    expect(bridge[0].toString()).not.toContain("text-\\[12px\\]");
    expect(bridge[0].toString()).toContain("var(--admin-font-caption)");
    expect(css("styles/AdminUnifiedSystem.css")).not.toMatch(/\.admin-workspace-shell__(?:header|brand|account|navigation)\s*[{,]/);
  });
  it("keeps existing local inline-control role bridges and excludes real native dialog titles from the h2 default", () => {
    const text = legacy.toString();
    expect(text).toContain('.admin-unified-content button:is([style*="font-size: 12px"]');
    expect(text).toContain('.admin-unified-content input:is([style*="font-size: 12px"]');
    expect(text).toContain('.admin-unified-content select:is([style*="font-size: 12px"]');
    expect(unified.toString()).toContain(':not(:where([role="dialog"] h2, [role="alertdialog"] h2))');
  });
  it("does not add important/scaling or resize icons and compact text-action hit areas", () => {
    for (const root of [unified, native]) root.walkDecls(decl => {
      expect(decl.important).toBeFalsy();
      expect(decl.prop).not.toMatch(/^(zoom|transform|scale)$/);
    });
    const host = postcss.parse(css(`${platform}pages/ChannelInventoryHost.css`));
    expect(declarations(host, ".ci-page.ci-host .ci-icon-close", "width")).toEqual(["28px"]);
    expect(declarations(host, ".ci-page.ci-host .ci-sort-arrow", "font-size")).toEqual(["11px"]);
    expect(declarations(host, ".ci-page.ci-host .ci-row-actions .ci-inline-link", "min-height")).toEqual(["28px"]);
    expect(declarations(host, ".ci-page.ci-host .ci-host-dialog > header > div", "min-width")).toEqual(["0"]);
    expect(declarations(host, ".ci-page.ci-host .ci-host-dialog > header > div", "overflow-wrap")).toEqual(["anywhere"]);
    const customer = postcss.parse(css(`${platform}pages/CustomerList.css`));
    expect(declarations(customer, ".customer-list-page .customer-list-text-action", "background")).toEqual(["transparent"]);
    expect(declarations(customer, ".customer-list-page .customer-list-text-action", "border")).toEqual(["0"]);
    expect(declarations(customer, ".customer-list-page .customer-list-table", "min-width")).toEqual(["1480px"]);
    expect(declarations(customer, ".customer-list-page .customer-list-table-scroll", "overflow-x")).toEqual(["auto"]);
    expect(declarations(customer, ".customer-list-page .customer-list-table .customer-list-demand-column", "right")).toEqual(["var(--customer-list-actions-width)"]);
  });
  it("keeps caption table cells outside both important body bridges", () => {
    const host = postcss.parse(css(`${platform}pages/ChannelInventoryHost.css`));
    const bridges: string[] = [];
    for (const root of [legacy, host]) root.walkRules(rule => {
      rule.walkDecls("font-size", decl => {
        if (decl.important && decl.value.includes("font-body") && rule.selector.includes(" td")) bridges.push(rule.selector);
      });
    });
    expect(bridges).toHaveLength(2);
    for (const selector of bridges) {
      expect(selector).toContain("td:not(:where(");
      for (const role of [".ci-row-index", ".ci-date", ".ci-lead-time", ".ci-channel-type-tag"]) expect(selector).toContain(role);
    }
  });
  it("retains shared platform fallbacks so absent admin scope cannot enable v18", () => {
    const customer = postcss.parse(css(`${platform}pages/CustomerList.css`));
    expect(declarations(customer, ".customer-list-page .customer-list-text-action", "font-size")).toEqual(["var(--admin-content-font-body, 12px)"]);
    const batch = postcss.parse(css(`${platform}components/channelInventory/batch.css`));
    expect(declarations(batch, ".ci-batch-steps b", "font-size")).toEqual(["10px"]);
    expect(declarations(batch, ".ci-batch-summary b", "font-size")).toEqual(["22px", "19px"]);
    expect(css("business/BusinessNativeTypography.css")).toContain('body[data-admin-readability="true"]');
  });
});
