import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const pagePath = resolve(
  process.cwd(),
  "client/src/business/platform/client/src/pages/MyInventory.tsx",
);
const source = readFileSync(pagePath, "utf8");
const styles = readFileSync(pagePath.replace(/\.tsx$/, ".css"), "utf8");
const ast = ts.createSourceFile(
  pagePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const printer = ts.createPrinter({ removeComments: true });
const print = (node: ts.Node) =>
  printer.printNode(ts.EmitHint.Unspecified, node, ast);
const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const page = ast.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "MyInventory",
)!;

function collect<T extends ts.Node>(
  predicate: (node: ts.Node) => node is T,
): T[] {
  const nodes: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(page);
  return nodes;
}

const elements = () =>
  collect(
    (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
      ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node),
  );
const classValue = (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
) => {
  const attribute = node.attributes.properties.find(
    (item): item is ts.JsxAttribute =>
      ts.isJsxAttribute(item) && item.name.getText(ast) === "className",
  );
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : "";
};

// Baselines were captured from the approved pre-unification page using the same
// TypeScript printer. Comments/formatting do not affect the business fingerprint.
describe("my-inventory UI unification", () => {
  it("uses shared presentational wrappers without changing the business frame", () => {
    const tags = elements().map(node => node.tagName.getText(ast));
    for (const tag of [
      "PlatformLayout",
      "AdminPage",
      "AdminPageHeader",
      "AdminFilterBar",
      "AdminDataPanel",
    ]) {
      expect(tags.filter(name => name === tag)).toHaveLength(1);
    }
    expect(tags).not.toContain("Card");
    expect(source).toContain('title="我的库存"');
    expect(source).toContain('data-testid="inventory-refresh-hint"');
    expect(source).not.toContain('className="admin-page-title"');
  });

  it("preserves every hook, query, mutation, permission and remembered-state statement", () => {
    const body = page.body!.statements
      .filter(node => !ts.isReturnStatement(node))
      .map(print)
      .join("\n");
    expect(fingerprint(body)).toBe(
      "9d3cdf754d4678778aae88cf300db174ad36928031262f31a083ff3b749f0b2b",
    );
  });

  it("preserves all 58 handlers, navigation targets, selected values and availability bindings", () => {
    const bindings = collect(ts.isJsxAttribute)
      .filter(node =>
        /^(on[A-Z]|href$|disabled$|checked$|value$|aria-pressed$)/.test(
          node.name.getText(ast),
        ),
      )
      .map(print);
    expect(bindings).toHaveLength(58);
    expect(fingerprint(bindings.join("\n"))).toBe(
      "6398201fd50e0281ea3868f753e4124091249a57b8c3128dae4de2cad0afd0e8",
    );
  });

  it("right-aligns quantity and price headers and cells while retaining the action column", () => {
    const numeric = elements().filter(node =>
      classValue(node).split(/\s+/).includes("inventory-numeric-cell"),
    );
    expect(numeric.map(node => node.tagName.getText(ast))).toEqual([
      "TableHead", "TableHead", "TableHead",
      "TableCell", "TableCell", "TableCell",
    ]);
    expect(styles).toMatch(
      /\.inventory-numeric-cell\s*\{[^}]*text-align:\s*right/,
    );
    expect(styles).toMatch(
      /\.inventory-actions-cell\s*\{[^}]*text-align:\s*right/,
    );
    expect(source).toContain("inventory-table-scroll");
    expect(styles).toContain("overflow-x: auto");
    expect(source).toContain("sticky right-0");
  });

  it("uses compact control and text fallbacks without scaling or broad important overrides", () => {
    expect(styles).toContain("var(--admin-control-height, 32px)");
    expect(styles).toContain("var(--admin-font-body, 12px)");
    expect(styles).toContain("var(--admin-font-caption, 11px)");
    expect(styles).toContain("border-radius: 6px");
    expect(styles).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:/);
  });
});
