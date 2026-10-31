import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { buildBusinessNavigationTarget } from "./businessNavigation";

const selectedInventory = "/workbench/channel-inventory?merchantId=67041005&expectedActor=99&permissions=all";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function functionContainsCall(
  sourceFile: ts.SourceFile,
  functionName: string,
  callName: string,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node))
      && (ts.isFunctionDeclaration(node) ? node.name?.text === functionName : true)
    ) {
      const containsCall = (child: ts.Node): void => {
        if (
          ts.isCallExpression(child)
          && ts.isIdentifier(child.expression)
          && child.expression.text === callName
        ) {
          found = true;
          return;
        }
        ts.forEachChild(child, containsCall);
      };
      ts.forEachChild(node, containsCall);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("buildBusinessNavigationTarget", () => {
  it("retains the selected merchant from channel inventory to stock", () => {
    expect(buildBusinessNavigationTarget(selectedInventory, "/workbench/inventory"))
      .toBe("/workbench/inventory?merchantId=67041005");
  });

  it("retains the selected merchant from stock to customers", () => {
    expect(buildBusinessNavigationTarget(
      "/workbench/inventory?merchantId=67041005",
      "/workbench/customers",
    )).toBe("/workbench/customers?merchantId=67041005");
  });

  it("retains the selected merchant for team management", () => {
    expect(buildBusinessNavigationTarget(
      "/workbench/customers?merchantId=67041005",
      "/workbench/add-user",
    )).toBe("/workbench/add-user?merchantId=67041005");
  });

  it("retains the selected merchant for procurement", () => {
    expect(buildBusinessNavigationTarget(
      "/workbench/inventory?merchantId=67041005",
      "/workbench/procurement-demands",
    )).toBe("/workbench/procurement-demands?merchantId=67041005");
  });

  it("does not inherit zero, negative, unsafe, or multi-value merchant IDs", () => {
    for (const currentLocation of [
      "/workbench/inventory?merchantId=0",
      "/workbench/inventory?merchantId=-1",
      "/workbench/inventory?merchantId=9007199254740992",
      "/workbench/inventory?merchantId=1&merchantId=2",
    ]) {
      expect(buildBusinessNavigationTarget(currentLocation, "/workbench/publish"))
        .toBe("/workbench/publish");
    }
  });

  it("preserves an explicit destination merchant and its query/hash without old override", () => {
    expect(buildBusinessNavigationTarget(
      "/workbench/inventory?merchantId=67041005",
      "/workbench/publish?merchantId=8&tab=bulk#upload",
    )).toBe("/workbench/publish?merchantId=8&tab=bulk#upload");
  });

  it("formats internal Link targets with only merchantId while preserving destination query/hash", () => {
    expect(buildBusinessNavigationTarget(
      selectedInventory,
      "/workbench/publish?tab=bulk#upload",
    )).toBe("/workbench/publish?tab=bulk&merchantId=67041005#upload");
  });

  it("keeps operations and system navigation free of inherited merchant selection", () => {
    expect(buildBusinessNavigationTarget(selectedInventory, "/orders?status=open#results"))
      .toBe("/orders?status=open#results");
    expect(buildBusinessNavigationTarget(selectedInventory, "/system/audit?tab=recent"))
      .toBe("/system/audit?tab=recent");
  });

  it("rejects external targets and does not confuse the /workbench path boundary", () => {
    expect(buildBusinessNavigationTarget(selectedInventory, "https://example.test/workbench/inventory"))
      .toBeNull();
    expect(buildBusinessNavigationTarget(selectedInventory, "/workbenchevil/inventory"))
      .toBe("/workbenchevil/inventory");
  });

  it("connects the Dashboard click and migrated Router Link/setter adapter to the helper", () => {
    const dashboard = source("../components/DashboardLayout.tsx");
    const adapter = source("../business/api/business-wouter.ts");
    const workbench = source("../business/BusinessWorkbenchPage.tsx");
    const dashboardAst = ts.createSourceFile("DashboardLayout.tsx", dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const adapterAst = ts.createSourceFile("business-wouter.ts", adapter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    expect(dashboard).toContain('import { buildBusinessNavigationTarget } from "@/lib/businessNavigation"');
    expect(functionContainsCall(dashboardAst, "", "buildBusinessNavigationTarget")).toBe(true);
    expect(adapter).toContain('import { buildBusinessNavigationTarget } from "@/lib/businessNavigation"');
    expect(functionContainsCall(adapterAst, "useBusinessLocation", "buildBusinessNavigationTarget")).toBe(true);
    expect(functionContainsCall(adapterAst, "businessNavigationHrefs", "buildBusinessNavigationTarget")).toBe(true);
    expect(workbench).toContain('hook={useBusinessLocation}');
    expect(workbench).toContain('hrefs={businessNavigationHrefs}');
  });
});
