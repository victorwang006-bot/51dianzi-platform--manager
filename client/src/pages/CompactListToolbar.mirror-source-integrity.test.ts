import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const canonicalRoot = process.env.COMPACT_PLATFORM_ROOT ?? path.resolve(import.meta.dirname, "../../../../51dianzi-platform");
const evidenceRoot = process.env.COMPACT_MIRROR_EVIDENCE_ROOT ?? path.join(tmpdir(), "51-compact-list-mirror-verification");
const baselinePath = path.join(import.meta.dirname, "compact-list-test-fixtures/CustomerList.before-20261113.txt");
const pagePath = path.join(root, "client/src/business/platform/client/src/pages/CustomerList.tsx");
const componentRoot = path.join(root, "client/src/business/platform/client/src/components/ui");
const expectedBaselineSha256 = "bf701f1b449029e16fa8c8aca8e6a8805f24ddb107638f475d94ec1bf439c8ad";
const expectedComponentSha256 = {
  tsx: "37ea5b4ffc35a8d3603ea58d84eb3eba0b562e931a3a459ba40f7da9b111c21e",
  css: "f52a1e2467f48bf29cdc11ffae9912f78c96f5fcc04fd717a2393e3664d10007",
};
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const before = readFileSync(baselinePath, "utf8");
const after = readFileSync(pagePath, "utf8");
const parse = (text: string, name: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const beforeAST = parse(before, "before.tsx");
const afterAST = parse(after, "after.tsx");
const diagnostics = (source: ts.SourceFile) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
function nodes(source: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return result;
}
function mainReturn(source: ts.SourceFile) {
  const page = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CustomerList") as ts.FunctionDeclaration;
  const render = page.body!.statements.find(ts.isReturnStatement)!;
  return { page, render };
}
function attr(element: ts.JsxElement, name: string) {
  return element.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name) as ts.JsxAttribute | undefined;
}
function elements(source: ts.SourceFile, tag: string) {
  return nodes(source, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === tag) as ts.JsxElement[];
}
function select(source: ts.SourceFile, value: string) {
  const found = elements(source, "Select").filter(node => attr(node, "value")?.initializer?.getText(source) === value);
  if (found.length !== 1) throw new Error(`Expected exactly one Select with ${value}`);
  return found[0];
}
function expression(source: ts.SourceFile, condition: string, needle: string) {
  const found = nodes(source, node => ts.isConditionalExpression(node) && node.condition.getText(source) === condition && node.getText(source).includes(needle));
  if (found.length !== 1) throw new Error(`Expected exactly one conditional ${condition}: ${needle}`);
  return found[0];
}
function tokens(text: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const values: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) values.push(`${token}:${scanner.getTokenText()}`);
  return values.join("\n");
}
// Exclude only explicitly replaced presentational wrappers. Every other original
// JSX prop (except className) and every conditional/logical guard is compared.
const removedLayoutTags = new Set(["AdminPageHeader", "AdminFilterBar", "CompactListToolbar"]);
function snapshot(source: ts.SourceFile) {
  const props: string[] = [], guards: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const basicLayoutGroup = tag === "div" && node.attributes.properties.some(item => ts.isJsxAttribute(item) && item.name.getText(source) === "className" && item.initializer?.getText(source) === '"customer-list-filter-row customer-list-basic-filters"');
      if (!removedLayoutTags.has(tag) && !basicLayoutGroup) for (const property of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(property)) props.push(`${tag}:spread:${tokens(property.expression.getText(source))}`);
        else if (property.name.getText(source) !== "className") props.push(`${tag}:${property.name.getText(source)}:${tokens(property.initializer?.getText(source) ?? "")}`);
      }
    }
    if (ts.isConditionalExpression(node)) guards.push(tokens(node.condition.getText(source)));
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) guards.push(`${node.operatorToken.kind}:${tokens(node.left.getText(source))}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { props: props.sort(), guards: guards.sort() };
}
function equality(name: string, left: string, right: string) {
  return { name, beforeBytes: Buffer.byteLength(left), afterBytes: Buffer.byteLength(right), beforeSha256: sha256(left), afterSha256: sha256(right), byteExact: left === right };
}
const oldImport = 'import { AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";';
const newImport = 'import { AdminPage, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";\nimport { CompactListToolbar } from "@/business/platform/client/src/components/ui/CompactListToolbar";';
const beforeMain = mainReturn(beforeAST), afterMain = mainReturn(afterAST);
const prefix = equality("beforeMainReturnWithOnlyApprovedImportReplacement", before.slice(0, beforeMain.render.getStart(beforeAST)).replace(oldImport, newImport), after.slice(0, afterMain.render.getStart(afterAST)));
const businessPreamble = equality("functionBusinessPreamble", before.slice(beforeMain.page.body!.getStart(beforeAST), beforeMain.render.getStart(beforeAST)), after.slice(afterMain.page.body!.getStart(afterAST), afterMain.render.getStart(afterAST)));
const suffix = equality("afterMainReturn", before.slice(beforeMain.render.end), after.slice(afterMain.render.end));
const noticesStart = "      {appliedFilters.starredOnly === true && !stars.ready";
const notices = equality("independentStarredPermissionAndNoticeSiblings", before.slice(before.indexOf(noticesStart), before.indexOf('      <AdminFilterBar')), after.slice(after.indexOf(noticesStart), after.indexOf('      <CompactListToolbar')));
const businessTail = equality("createPanelAndAllFollowingBusinessJSX", before.slice(before.indexOf("      {createOpen && ("), beforeMain.render.end), after.slice(after.indexOf("      {createOpen && ("), afterMain.render.end));
const searchGroup = (source: ts.SourceFile) => elements(source, "div").find(node => attr(node, "className")?.initializer?.getText(source).includes("customer-list-search-group"))!;
const createButton = (source: ts.SourceFile) => elements(source, "Button").find(node => attr(node, "ref")?.initializer?.getText(source) === "{createButtonRef}")!;
const filterActions = (source: ts.SourceFile) => elements(source, "div").find(node => attr(node, "className")?.initializer?.getText(source) === '"customer-list-filter-actions"')!;
const fragmentSpecs = [
  ["completeScopeConditional", expression(beforeAST, "canReadAll", 'aria-label="客户范围"'), expression(afterAST, "canReadAll", 'aria-label="客户范围"')],
  ["completeCreateButton", createButton(beforeAST), createButton(afterAST)],
  ["completeGradeSelect", select(beforeAST, '{draftFilters.grade || "all"}'), select(afterAST, '{draftFilters.grade || "all"}')],
  ["completeDueSelect", select(beforeAST, "{draftFilters.due}"), select(afterAST, "{draftFilters.due}")],
  ["completeThreeFilterActionsIncludingSearchCaption", filterActions(beforeAST), filterActions(afterAST)],
  ["completeMoreFiltersConditional", expression(beforeAST, "moreFiltersOpen", 'id="customer-list-more-filters"'), expression(afterAST, "moreFiltersOpen", 'id="customer-list-more-filters"')],
] as const;
const fragments = fragmentSpecs.map(([name, left, right]) => equality(name, left.getText(beforeAST), right.getText(afterAST)));
fragments.push(equality("searchAndStarGroupWithOnlyApprovedClassAddition", searchGroup(beforeAST).getText(beforeAST).replace('className="customer-list-search-group"', 'className="d51-compact-list-search-group customer-list-search-group"'), searchGroup(afterAST).getText(afterAST)));
const original = snapshot(beforeAST), current = snapshot(afterAST);
const componentProof = (extension: "tsx" | "css") => {
  const canonicalPath = path.join(canonicalRoot, `client/src/components/ui/CompactListToolbar.${extension}`);
  const mirrorPath = path.join(componentRoot, `CompactListToolbar.${extension}`);
  const canonical = readFileSync(canonicalPath), mirror = readFileSync(mirrorPath);
  return { canonicalPath, mirrorPath, canonicalSha256: sha256(canonical), mirrorSha256: sha256(mirror), byteExact: canonical.equals(mirror), expectedSha256: expectedComponentSha256[extension] };
};
const tsxProof = componentProof("tsx"), cssProof = componentProof("css");
const toolbar = elements(afterAST, "CompactListToolbar")[0];
const toolbarChildren = toolbar?.children.map(child => child.getText(afterAST)).join("\n") ?? "";
const proof = {
  status: "PASS",
  scope: "manager tracked business-platform mirror only; no canonical CustomerList replacement",
  baselinePath, pagePath, baselineSha256: sha256(before), afterSha256: sha256(after),
  tsParseDiagnostics: { baseline: diagnostics(beforeAST).length, mirror: diagnostics(afterAST).length, component: diagnostics(parse(readFileSync(tsxProof.mirrorPath, "utf8"), "CompactListToolbar.tsx")).length },
  unchangedPartitions: [prefix, businessPreamble, suffix, notices, businessTail],
  relocatedFragments: fragments,
  props: { beforeCount: original.props.length, afterCount: current.props.length, beforeSha256: sha256(JSON.stringify(original.props)), afterSha256: sha256(JSON.stringify(current.props)), equal: JSON.stringify(original.props) === JSON.stringify(current.props) },
  guards: { beforeCount: original.guards.length, afterCount: current.guards.length, beforeSha256: sha256(JSON.stringify(original.guards)), afterSha256: sha256(JSON.stringify(current.guards)), equal: JSON.stringify(original.guards) === JSON.stringify(current.guards) },
  layoutExceptions: ["replace AdminPageHeader and AdminFilterBar with CompactListToolbar", "remove obsolete basic div role=group aria-label=基础筛选 and header flex wrapper", "add only d51-compact-list-search-group to original search/收藏 group"],
  components: { tsx: tsxProof, css: cssProof },
  moduleResolution: { importedSpecifier: "@/business/platform/client/src/components/ui/CompactListToolbar", ordinaryManagerAliasAt: path.join(root, "client/src"), resolvedPath: tsxProof.mirrorPath, externalCanonicalAliasNeeded: false },
  runtimeReference: path.join(evidenceRoot, "proofs/customers.json"),
  validationBoundary: "read-only source integrity plus separate limited local Vitest suites; not browser, production or final ordinary tsc acceptance",
};

describe("manager compact list mirror source integrity", () => {
  it("preserves frozen actual mirror baseline and every byte outside the approved import/main JSX patch", () => {
    expect(sha256(before)).toBe(expectedBaselineSha256);
    expect(proof.tsParseDiagnostics).toEqual({ baseline: 0, mirror: 0, component: 0 });
    for (const partition of proof.unchangedPartitions) expect(partition.byteExact, partition.name).toBe(true);
  });
  it("relocates complete original scope/create/search-star/grade/due/actions/more fragments without changing non-layout props or guards", () => {
    for (const fragment of fragments) expect(fragment.byteExact, fragment.name).toBe(true);
    expect(current.props).toEqual(original.props);
    expect(current.guards).toEqual(original.guards);
  });
  it("places scope before original search and keeps create actions/complete extra, notices and data independently unchanged", () => {
    expect(elements(afterAST, "CompactListToolbar")).toHaveLength(1);
    expect(elements(afterAST, "AdminFilterBar")).toHaveLength(0);
    expect(nodes(afterAST, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(afterAST) === "AdminPageHeader")).toHaveLength(0);
    expect(attr(toolbar, "title")?.initializer?.getText(afterAST)).toBe('"客户列表"');
    expect(toolbarChildren.indexOf('aria-label="客户范围"')).toBeGreaterThanOrEqual(0);
    expect(toolbarChildren.indexOf('aria-label="客户范围"')).toBeLessThan(toolbarChildren.indexOf('placeholder="搜索客户名称'));
    expect(toolbarChildren).toContain('aria-label="仅看重点客户"');
    expect(toolbarChildren).toContain("搜索");
    expect(attr(toolbar, "actions")?.initializer?.getText(afterAST)).toContain("ref={createButtonRef}");
    expect(attr(toolbar, "extra")?.initializer?.getText(afterAST)).toContain("moreFiltersOpen ? (");
    expect(after.indexOf(noticesStart)).toBeLessThan(toolbar.getStart(afterAST));
    expect(after.indexOf("      {createOpen && (")).toBeGreaterThan(toolbar.end);
    expect(after).toContain('from "@/business/platform/client/src/components/ui/CompactListToolbar"');
  });
  it("uses locally resolvable manager component files byte-identical to current canonical and emits a verified proof", () => {
    for (const component of [tsxProof, cssProof]) {
      expect(component.byteExact).toBe(true);
      expect(component.mirrorSha256).toBe(component.expectedSha256);
    }
    expect(proof.unchangedPartitions.every(item => item.byteExact)).toBe(true);
    expect(fragments.every(item => item.byteExact)).toBe(true);
    expect(proof.props.equal && proof.guards.equal).toBe(true);
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(path.join(evidenceRoot, "mirror-source-integrity.json"), JSON.stringify(proof, null, 2) + "\n");
  });
});
