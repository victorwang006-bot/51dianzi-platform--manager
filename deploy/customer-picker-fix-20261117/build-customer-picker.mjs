import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const manager = path.resolve(here, "../..");
const require = createRequire(manager + "/package.json");
const ts = require("typescript"), esbuild = require("esbuild");
const H = x => crypto.createHash("sha256").update(x).digest("hex");
const parse = (s, file = "leaf.js") => ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const nodes = (root, test) => { const out = []; const visit = n => { if (test(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const sourcePath = manager + "/client/src/business/platform/client/src/components/companyStock/SalesCustomerPicker.tsx";
const source = fs.readFileSync(sourcePath, "utf8");
const emitted = await esbuild.transform(source, { loader: "tsx", jsx: "automatic", format: "esm", target: "es2020", minify: false });
const sourceAst = parse(emitted.code);
const leaf = nodes(sourceAst, n => ts.isFunctionDeclaration(n) && n.name?.text === "SalesCustomerSession");
assert.equal(leaf.length, 1);
const leafCode = leaf[0].getText(sourceAst);
assert(!/\b(?:createRoot|createTRPC|QueryClient|Provider|fetch|zod)\b/.test(leafCode));
fs.writeFileSync(here + "/compiled-customer-session.js", leafCode + "\n");
export function patchCustomerPicker(input, label = path.basename(input), expectedMatches = 2) {
  const bytes = fs.readFileSync(input), before = bytes.toString("utf8"), a = parse(before, input);
  assert(bytes.equals(Buffer.from(before)), "valid UTF8 baseline required");
  const found = nodes(a, n => ts.isFunctionDeclaration(n) && n.getWidth(a) < 25000
    && nodes(n, v => ts.isStringLiteral(v) && v.text === "搜索有权限客户").length
    && n.getText(a).includes("canManageAll?\"all\":\"mine\""));
  assert.equal(found.length, expectedMatches, "actual current picker instances; never patch outer factory");
  const patches = found.map(n => {
    const old = n.getText(a);
    assert.equal(n.name.text, "Yn", "reviewed original symbol");
    assert(old.includes("N=oe(),Y=Ne(s)"), "original live scope/session ABI");
    assert(old.includes("ma.customer.context.useQuery") && old.includes("pa.useState"), "original trpc/react ABI");
    assert(old.includes('return Te("div"') && old.includes('Q("input"'), "original JSX ABI");
    const replacement = `function ${n.name.text}(props){const useState=pa.useState,trpc=ma,useCompanyStockScope=oe,useCompanyStockSession=Ne,jsx=Q,jsxs=Te;${leafCode}\nreturn SalesCustomerSession(props);}`;
    return { name: n.name.text, start: n.getStart(a), end: n.end, old, replacement,
      beforeSha256: H(old), afterSha256: H(replacement), nativeABI: { react: "pa.useState", trpc: "ma", scope: "oe", session: "Ne", jsx: "Q", jsxs: "Te" } };
  });
  let after = before;
  for (const p of patches.toReversed()) after = after.slice(0, p.start) + p.replacement + after.slice(p.end);
  let inverse = after, shift = 0;
  const records = patches.map(p => {
    const newStart = p.start + shift; shift += p.replacement.length - (p.end - p.start);
    return { ...p, newStart, newEnd: newStart + p.replacement.length,
      oldByteStart: Buffer.byteLength(before.slice(0, p.start)), oldByteEnd: Buffer.byteLength(before.slice(0, p.end)),
      newByteStart: Buffer.byteLength(after.slice(0, newStart)), newByteEnd: Buffer.byteLength(after.slice(0, newStart + p.replacement.length)) };
  });
  for (const p of records.toReversed()) {
    assert.equal(inverse.slice(p.newStart, p.newEnd), p.replacement);
    inverse = inverse.slice(0, p.newStart) + p.old + inverse.slice(p.newEnd);
  }
  assert.equal(inverse, before, "entire baseline inverse and all outside-hunk bytes preserved");
  assert.equal(parse(after).parseDiagnostics.length, 0, "syntactically valid current full module");
  const name = label.replace(/\.js$/, "") + "-customer-picker-" + H(after).slice(0, 16) + ".js";
  const output = path.join(here, name);
  fs.writeFileSync(output, after);
  const manifest = { status: "LOCAL_CANDIDATE_NOT_DEPLOYED", input, output, beforeSha256: H(bytes), afterSha256: H(after),
    sourcePath, sourceSha256: H(source), compiledFunctionSha256: H(leafCode), patches: records,
    checks: { onlyCustomerSessionFunction: true, untouchedPublicFactory: true, inverseVerified: true,
      allOutsidePatchBytesPreserved: true, nativeReactTrpcSessionJsxReused: true, noNewProvider: true,
      noWholeSiteBuild: true, noDB: true, noUpload: true, noGit: true } };
  fs.writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  assert(inputs.length, "usage: node build-customer-picker.mjs <current module...>; never writes online");
  const results = inputs.map(input => patchCustomerPicker(path.resolve(input)));
  fs.writeFileSync(here + "/static-candidates.json", JSON.stringify(results.map(({ patches, ...m }) => ({ ...m, patches: patches.map(({ old, replacement, ...p }) => p) })), null, 2) + "\n");
  console.log(JSON.stringify(results.map(m => ({ output: m.output, beforeSha256: m.beforeSha256, afterSha256: m.afterSha256, patches: m.patches.length })), null, 2));
}
