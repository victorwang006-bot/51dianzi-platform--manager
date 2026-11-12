import { createHash } from "node:crypto";
import * as ts from "typescript";

const layoutTags = new Set(["PageHeader", "AdminPageHeader", "AdminFilterBar", "CompactListToolbar"]);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function tokens(text: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const values: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    values.push(`${token}:${scanner.getTokenText()}`);
  }
  return values.join("\n");
}

/** Read-only AST inspection: never imports/mounts business pages or calls their hooks. */
export function compactListSourceSnapshot(text: string, name: string) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = source.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)) as ts.FunctionDeclaration;
  const render = page.body?.statements.find(ts.isReturnStatement);
  if (!render || source.parseDiagnostics.length) throw new Error(`Invalid page source: ${name}`);
  const excluded = [...source.statements.filter(ts.isImportDeclaration), render].sort((a, b) => b.getStart(source) - a.getStart(source));
  let business = text;
  for (const node of excluded) business = business.slice(0, node.getStart(source)) + business.slice(node.end);
  const props: string[] = [], guards: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (!layoutTags.has(tag)) for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) props.push(`${tag}:spread:${tokens(attr.expression.getText(source))}`);
        else if (attr.name.getText(source) !== "className") props.push(`${tag}:${attr.name.getText(source)}:${tokens(attr.initializer?.getText(source) ?? "")}`);
      }
    }
    if (ts.isConditionalExpression(node)) guards.push(tokens(node.condition.getText(source)));
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) guards.push(`${node.operatorToken.kind}:${tokens(node.left.getText(source))}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { businessTokensSha256: hash(tokens(business)), props: props.sort(), guards: guards.sort() };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Fixed fingerprints captured before this layout-only patch (platform 9d044f6; manager f78d161).
// Layout wrapper/title/className are intentionally excluded; all business props and conditions are included.
const approvedBaseline = {
  "CustomerList": {
    "businessTokensSha256": "9a0e6d407cbd59f13415e1eb4ab57a506a2831f3475d6a7efc5565dc3c6de030",
    "propsSha256": "29e99d276ead7ab749db5a5d9fd1a87ca2923e71f9da3ecb2427386194a173cb",
    "propsCount": 130,
    "guardsSha256": "58d64113784ecf0db4f640ca5e1dbec2de12b8cda9663e060c5d11d86cee0618",
    "guardsCount": 83
  },
  "Merchants": {
    "businessTokensSha256": "9d7c0f014c41cfc275e133874386c9bd64df143ce0d5433334caee4403d7660f",
    "propsSha256": "c28206d080d3f6e6e7df98aaba8818a6216f9a7dbe182525430b38bc147b8519",
    "propsCount": 114,
    "guardsSha256": "826ece7a374abb08111b392c02e64eb43ee0f6091354216a090c9bebef8e35e0",
    "guardsCount": 70
  },
  "Staff": {
    "businessTokensSha256": "4cd383a5a16c02ba5b71e1c822fa35278f854392ea0a3ea68e5d193e698ca305",
    "propsSha256": "e5ca143ac2f069c905be89801437d7251d535ac6ba8823575e26b7a3c2d2d3cf",
    "propsCount": 100,
    "guardsSha256": "56dccb32530c862496fd6623fd2a92630b7b3d5d7de8072aa722dc545df6c134",
    "guardsCount": 160
  }
};
const platformRoot = process.env.COMPACT_PLATFORM_ROOT ?? resolve(import.meta.dirname, "../../../../51dianzi-platform");
const pagePaths = {
  CustomerList: resolve(platformRoot, "client/src/pages/CustomerList.tsx"),
  Merchants: resolve(import.meta.dirname, "Merchants.tsx"),
  Staff: resolve(import.meta.dirname, "Staff.tsx"),
};
const titles = { CustomerList: "客户列表", Merchants: "商户管理", Staff: "员工与权限" };
function nodes(source: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(source); return found;
}
function attribute(node: ts.JsxElement, name: string) {
  return node.openingElement.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name) as ts.JsxAttribute | undefined;
}

describe("approved compact list source-only relocation", () => {
  for (const name of ["CustomerList", "Merchants", "Staff"] as const) {
    it(name + " preserves every non-render business token, original interaction prop and guard", () => {
      const current = compactListSourceSnapshot(readFileSync(pagePaths[name], "utf8"), name);
      const baseline = approvedBaseline[name];
      expect(current.businessTokensSha256).toBe(baseline.businessTokensSha256);
      expect(current.props).toHaveLength(baseline.propsCount);
      expect(hash(JSON.stringify(current.props))).toBe(baseline.propsSha256);
      expect(current.guards).toHaveLength(baseline.guardsCount);
      expect(hash(JSON.stringify(current.guards))).toBe(baseline.guardsSha256);
    });
    it(name + " uses only the shared hidden title and keeps all original controls in the proper slots", () => {
      const text = readFileSync(pagePaths[name], "utf8");
      const source = ts.createSourceFile(name + ".tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const toolbars = nodes(source, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "CompactListToolbar") as ts.JsxElement[];
      expect(toolbars).toHaveLength(1);
      const toolbar = toolbars[0];
      expect(attribute(toolbar, "title")?.initializer?.getText(source)).toBe(JSON.stringify(titles[name]));
      expect(nodes(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ["h1", "PageHeader", "AdminPageHeader", "AdminFilterBar"].includes(node.tagName.getText(source)))).toHaveLength(0);
      const children = toolbar.children.map(child => child.getText(source)).join(" ");
      const actions = attribute(toolbar, "actions")?.initializer?.getText(source) ?? "";
      if (name === "CustomerList") {
        expect(children.indexOf("客户范围")).toBeLessThan(children.indexOf("搜索客户名称"));
        expect(children).toContain("canManageAll ?");
        expect(children).toContain("更多筛选");
        expect(children).toContain("筛选");
        expect(actions).toContain("ref={createButtonRef}");
        expect(actions).toContain('"收起录入" : "录入客户"');
        expect(attribute(toolbar, "extra")?.initializer?.getText(source)).toContain("moreFiltersOpen ?");
        expect(text).toContain('id="customer-entry-panel"');
      } else if (name === "Merchants") {
        expect(children).toContain("MerchantCreatedAtFilter");
        expect(children).toContain("SalesOwnerFilterCombobox");
        expect(children).toContain("hasFilters &&");
        expect(children).not.toContain("客户归属查询");
        expect(actions).toContain("setOwnershipLookupOpen(true)");
        expect(text.indexOf("<CnRegistrationReviewQueue")).toBeLessThan(text.indexOf("<CompactListToolbar"));
        expect(text).toContain('className="d51-compact-list-search-group"');
      } else {
        expect(children).toContain('aria-label="搜索员工"');
        expect(children).toContain('value={status}');
        expect(children).toContain('value={role}');
        expect(actions).toContain("canManageAdmin ?");
        expect(actions).toContain("adminUsersQuery.isFetching || navigationQuery.isFetching");
        expect(actions).toContain('"animate-spin"');
        expect(text.indexOf("{businessNotice ?")).toBeLessThan(text.indexOf("<CompactListToolbar"));
        expect(text.indexOf("{officialTeamsQuery.isError ?")).toBeLessThan(text.indexOf("<CompactListToolbar"));
      }
      expect(text).toContain(name === "CustomerList" ? 'from "@/components/ui/CompactListToolbar"' : 'from "@/business/platform/client/src/components/ui/CompactListToolbar"');
    });
  }
  it("keeps the shared component pure, accessible and the CSS confined to its list scope", () => {
    const component = readFileSync(resolve(platformRoot, "client/src/components/ui/CompactListToolbar.tsx"), "utf8");
    const css = readFileSync(resolve(platformRoot, "client/src/components/ui/CompactListToolbar.css"), "utf8");
    expect(component).not.toMatch(/use[A-Z]\w*|fetch\(|trpc|provider|data-slot/);
    expect(component).toContain('<h1 className="d51-compact-list-title">{title}</h1>');
    expect(component).toContain('role="search"');
    expect(component).toContain('aria-label={`${title}筛选和操作`}');
    expect(css).toContain("position: absolute;");
    expect(css).toContain("clip-path: inset(50%);");
    expect(css).toContain("height: 36px;");
    expect(css).toContain("height: 40px;");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("gap: 8px;");
    expect(css).toContain("margin-bottom: 12px !important;");
    expect(css).toContain(".d51-compact-list-toolbar:is(.customer-list-page > *)");
    expect(css).toContain("margin-bottom: 0 !important;");
    expect(css).toContain("margin-inline-start: auto;");
    expect(css).toContain("max-width: 320px;");
    expect(css).toContain("flex: 0 1 320px;");
    expect(css).toContain("--admin-control-height: 36px;");
    expect(css).toContain("--admin-control-height: 40px;");
    expect(css).toContain(".d51-compact-list-toolbar .d51-compact-list-toolbar__filters .d51-compact-list-search-group");
    expect(css).toContain("flex-basis: 100%;");
    expect(css).toContain("max-width: none;");
    expect(css).toContain(".d51-compact-list-title + .d51-compact-list-toolbar,");
    expect(css).toContain(".d51-compact-list-toolbar + * {\n  margin-top: 0 !important;\n}");
    expect(css.match(/!important/g)).toHaveLength(3);
    expect(css).not.toMatch(/display: none|table|dialog|overflow-x: auto/);
    for (const selector of Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g))) {
      if (selector[1].trim().startsWith("@media")) continue;
      expect(selector[1].trim()).toMatch(/^\.d51-/);
    }
  });
});
