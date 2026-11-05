import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the exact two pure source functions without loading React, routes or RPC.
const text = readFileSync(new URL("./BusinessWorkbenchPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("BusinessWorkbenchPage.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["isRecord", "contextOfficialInventoryPermissions"];
const declarations = names.map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Required real function missing: ${name}`);
  return node.getText(ast);
});
const javascript = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const decode = vm.runInNewContext(javascript + "\ncontextOfficialInventoryPermissions", {}) as (v: unknown) => { read:boolean; write:boolean; note:boolean; publish?:boolean; authorizationVersion:string };

describe("actual workbench native publish whitelist", () => {
  it("forwards an explicit proven publish grant even when edit is false", () => {
    const out = decode({ officialInventoryPermissions: { read:true, write:false, note:false, publish:true, authorizationVersion:"fixture-v1", secret:"never forward" } });
    expect(out.publish).toBe(true); expect(out.write).toBe(false);
    expect(Object.keys(out).sort()).toEqual(["authorizationVersion", "note", "publish", "read", "write"]);
  });
  it.each([undefined, false, null, 1, "true", {}, []])("does not infer publish from edit or invalid value %s", publish => {
    const out = decode({ officialInventoryPermissions: { read:true, write:true, note:true, publish, authorizationVersion:"fixture-v1" } });
    expect(out.publish).toBe(false); expect(out.write).toBe(true);
  });
  it("read denial defeats a true publication bit", () => {
    expect(decode({ officialInventoryPermissions: { read:false, publish:true, authorizationVersion:"fixture-v1" } }).publish).toBe(false);
  });
  it.each([undefined, null, [], {}, {read:true,publish:true}, {read:true,publish:true,authorizationVersion:1}, {read:true,publish:true,authorizationVersion:""}])("missing stable proof stays unauthorized: %s", raw => {
    const out = decode({ officialInventoryPermissions:raw });
    expect(out.read).toBe(false); expect(out.publish === true).toBe(false);
  });
});
