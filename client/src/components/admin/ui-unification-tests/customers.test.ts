// @vitest-environment jsdom
// Reuse the existing real customer-list/contact/draft regression suite through
// this focused .test.ts entry; the root Vitest include does not match .test.tsx.
import "../../../business/platform/client/src/components/customers/CustomerContacts.restore.test";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import ts from "typescript";

const pagePath = "client/src/business/platform/client/src/pages/CustomerList.tsx";
const source = readFileSync(pagePath, "utf8");
const css = readFileSync(pagePath.replace(/\.tsx$/, ".css"), "utf8");
const page = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const stylesheet = postcss.parse(css);

function elements(tag: string) {
  const result: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(page) === tag) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(page);
  return result;
}

function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  const entry = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(page) === name);
  return entry?.getText(page) ?? "";
}

function declaration(selector: string, property: string) {
  const values: string[] = [];
  stylesheet.walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, item => { values.push(item.value); });
  });
  return values;
}

describe("customer list unified presentation contract", () => {
  it("uses the presentational page, compact header, filter bar and data panels", () => {
    expect(elements("AdminPage")).toHaveLength(1);
    expect(elements("AdminPageHeader")).toHaveLength(1);
    expect(attribute(elements("AdminPageHeader")[0], "title")).toBe('title="客户列表"');
    expect(attribute(elements("AdminPageHeader")[0], "actions")).toContain("createButtonRef");
    expect(elements("AdminFilterBar")).toHaveLength(1);
    expect(attribute(elements("AdminFilterBar")[0], "aria-label")).toContain("客户筛选");
    expect(elements("AdminDataPanel")).toHaveLength(2);
    expect(elements("Card")).toHaveLength(0);
    expect(elements("h1")).toHaveLength(0);
  });

  it("keeps genuine customer fields and makes only the final action column right-aligned", () => {
    const headers = elements("TableHead");
    expect(headers).toHaveLength(8);
    for (const label of ["客户名称", "所属行业", "联系人 / 电话", "等级 / 阶段", "负责人", "供应库存", "需求录入", "跟进"]) {
      expect(source).toContain(label);
    }
    for (const tag of ["TableHead", "TableCell"]) {
      const action = elements(tag).find(node => attribute(node, "data-testid").includes(tag === "TableHead" ? "actions-header" : "actions-cell"));
      expect(action).toBeDefined();
      expect(attribute(action!, "className")).toContain("text-right");
    }
    expect(source).toContain("flex items-center justify-end gap-1 whitespace-nowrap");
    expect(declaration(".customer-list-page .customer-list-table :is(.customer-list-demand-column, .customer-list-actions-column)", "position")).toEqual(["sticky"]);
    expect(source).toContain('containerClassName="customer-list-table-inner"');
    expect(source).toContain('className="customer-list-table-scroll"');
    expect(elements("col")).toHaveLength(8);
    expect(source).not.toContain('data-testid="followup-header"');
  });

  it("retains contact privacy scope and current-page-only summary requests", () => {
    const summary = elements("CustomerContactsSummary")[0];
    expect(attribute(summary, "scope")).toBe("scope={contactScope.scope}");
    expect(attribute(summary, "scopeReady")).toBe("scopeReady={contactScope.ready}");
    expect(attribute(summary, "identityKey")).toBe("identityKey={contactScope.identityKey}");
    expect(source).toContain("withCustomerContactScope(contactScope.scope, { customerIds: pageCustomerIds })");
    expect(source).toContain("enabled: contactScope.ready && Boolean(contactScope.scope) && pageCustomerIds.length > 0");
    expect(source).toContain('const scope = canReadAll ? appliedFilters.scope : "mine"');
    expect(source).toMatch(/canReadAll\s*&&\s*scope === "all"\s*&&\s*Number\.isInteger\(assignedUserId\)\s*&&\s*assignedUserId > 0/);
    expect(source).toContain('starMode: "assignee" as const');
    expect(source).toContain('customer.starUserId === customer.assignedUserId');
  });

  it("retains customer navigation, archived restrictions, creation draft and pagination handlers", () => {
    expect(source).toContain('navigate(customerWorkbenchLocation(customer.id, "overview"))');
    expect(source).toContain('navigate(customerWorkbenchLocation(customer.id, "followups", "follow=1"))');
    expect(source).toContain('disabledReason={customer.archivedAt ? "该客户已归档，不能新增跟进" : undefined}');
    expect(source).toContain('disabledReason={customer.archivedAt ? "该客户已归档，不能录入需求" : undefined}');
    expect(source).toContain("onClick={() => createOpen ? collapseCreate() : setCreateOpen(true)}");
    expect(attribute(elements("CustomerCreateForm")[0], "draftIdentity")).toBe("draftIdentity={createDraftIdentity}");
    expect(source).toContain("onClick={() => setPage(value => Math.max(1, value - 1))}");
    expect(source).toContain("setPage(value => Math.min(totalPages, value + 1))");
    expect(source).toContain("onClick={applyFilters}");
    expect(source).toContain("onClick={resetFilters}");
    expect(source).toContain("disabled={!canResetFilters}");
  });

  it("uses compact tokens without fixed row height, forced overrides or scaling", () => {
    expect(declaration(".customer-list-page .customer-list-control", "height")).toEqual(["var(--admin-content-control-height, 32px)"]);
    expect(declaration(".customer-list-page .customer-list-control", "font-size")).toEqual(["var(--admin-content-font-body, 12px)"]);
    expect(declaration(".customer-list-page .customer-list-control", "border-radius")).toEqual(["6px"]);
    expect(declaration(".customer-list-page .customer-list-table th", "font-size")).toEqual(["var(--admin-content-font-caption, 11px)"]);
    expect(declaration(".customer-list-page .customer-list-table td", "font-size")).toEqual(["var(--admin-content-font-body, 12px)"]);
    expect(declaration(".customer-list-page .customer-list-table tbody tr", "height")).toEqual([]);
    stylesheet.walkDecls(item => {
      expect(item.important).toBeFalsy();
      expect(item.prop).not.toMatch(/^(zoom|transform|scale)$/);
    });
    stylesheet.walkRules(rule => {
      for (const selector of rule.selectors) {
        const customerScoped = selector.startsWith(".customer-list-page ") || selector === ".customer-list-page";
        const compactLocationScoped = selector.startsWith(".admin-workspace-shell__main:has(")
          && selector.includes(".customer-list-page")
          && selector.includes('[data-admin-navigation="current-location"]');
        expect(customerScoped || compactLocationScoped).toBe(true);
      }
    });
  });
});
