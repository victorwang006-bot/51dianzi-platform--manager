#!/usr/bin/env node
/** Customer batch actions: local-only scoped leaf build against freshly captured native assets. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as esbuild from "esbuild";
import { common, batch, supply, inventory } from "../upload-manage-20261119/native-abi.mjs";
import { H, parse, nodes, one, declarations, noLoads, noFreeIdentifiers, inverseDelta, scopedCss, htmlDelta } from "../upload-manage-20261119/build-support.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASE = process.env.CUSTOMER_BATCH_BASE ?? "/home/ubuntu/work/customer-batch/capture";
const OUT = process.env.CUSTOMER_BATCH_OUT ?? "/home/ubuntu/work/customer-batch/build";
const C = "client/src/business/platform/client/src/components/";
const history = { ...common, trpc: "St", customerUploadDownloadSchema: "Qw", customerUploadHistoryListSchema: "Jw", savePrivateFile: "Wg", downloadedFile: "Zg", CustomerSupplyUploadDialog: "jf", inventoryRequestId: "Dn", definitiveWriteFailure: "Jo" };
const parent = { ...common, useId: "go", useLayoutEffect: "Ev", trpc: "St", businessIndustryCodeSchema: "dn", CustomerSupplyUploadDialog: "jf", CustomerUploadHistoryDialog: "fk", useCustomerSupplyAuthority: "Cv", CustomerChannelInventory: "mk", withCustomerContactScope: "Jg", errorMessage: "Qr" };
const failures = { name: "CustomerUploadFailuresDialog", native: "__customerBatchFailures", file: C + "customers/CustomerUploadFailuresDialog.tsx", bindings: { ...common, trpc: "St", BatchUpload: "du", fields: "on", mapGrid: "Tl", suggestMapping: "vs", toPayload: "dd", inventoryRequestId: "Dn", canonicalConfirmationPayload: "Bf", recoveryEntries: "tl", savePrivateFile: "Wg", supplyReceipt: "hl" } };
const specs = [
  { name: "BatchUploadSession", native: "T6", file: C + "channelInventory/BatchUpload.tsx", bindings: batch },
  { name: "CustomerSupplyUploadSession", native: "B3", file: C + "customers/CustomerSupplyUploadDialog.tsx", bindings: supply },
  { name: "CustomerChannelInventory", native: "mk", file: C + "customers/CustomerChannelInventory.tsx", bindings: inventory },
  { name: "customerInventoryInput", native: "V3", file: C + "customers/CustomerChannelInventory.tsx", bindings: { PAGE_SIZE: "j3" }, helper: true },
  { name: "verifiedCustomerInventory", native: "H3", file: C + "customers/CustomerChannelInventory.tsx", bindings: {}, helper: true },
  { name: "CustomerWorkbenchSupply", native: "bk", file: C + "customers/CustomerWorkbenchSupply.tsx", bindings: parent },
  { name: "HistorySession", native: "z3", file: C + "customers/CustomerUploadHistoryDialog.tsx", bindings: history, zip: true },
];
function put(name, value) { const p = path.join(OUT, name); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, value); }
function json(name, value) { put(name, JSON.stringify(value, null, 2) + "\n"); }
async function compile(spec) {
  const source = fs.readFileSync(path.join(ROOT, spec.file), "utf8");
  const transformed = await esbuild.transform(source, { loader: "tsx", jsx: "automatic", format: "esm", target: "es2020", minify: false });
  const ast = parse(transformed.code, spec.file);
  let leaf = one(ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === spec.name), spec.name).getText(ast).replace(/^export\s+/, "");
  leaf = leaf.replaceAll('import("xlsx")', "Promise.resolve().then(() => (nc(), rc))");
  let prefix = "";
  const bindings = { ...spec.bindings };
  if (spec.native === "B3") bindings.__customerUploadRetry20261119_originalNotSavedAfterRelease = "__customerUploadRetry20261119_originalNotSavedAfterRelease";
  if (spec.native === "T6") Object.assign(bindings, { nc: "nc", rc: "rc" });
  if (spec.native === "z3") {
    const child = await compile(failures);
    prefix += child.wrapper + "\nconst CustomerUploadFailuresDialog=__customerBatchFailures;\n";
    Object.assign(bindings, child.bindings);
  }
  if (spec.zip) {
    const result = await esbuild.build({ stdin: { contents: 'export { zipSync } from "fflate";', resolveDir: ROOT, loader: "js" }, write: false, bundle: true, format: "iife", globalName: "__customerBatchZip", platform: "browser", target: "es2020", minify: true, metafile: true });
    assert(Object.keys(result.metafile.inputs).every(n => n === "<stdin>" || n.includes("fflate")), "zip-only dependency graph");
    prefix += result.outputFiles[0].text + "\nconst zipSync=__customerBatchZip.zipSync;\n";
  }
  const aliases = Object.entries(bindings).filter(([k, v]) => k !== v).map(([k, v]) => `${k}=${v}`).join(",");
  const wrapper = `function ${spec.native}(${spec.helper ? "...args" : "props"}){\n${prefix}${aliases ? "const " + aliases + ";\n" : ""}${leaf}\nreturn ${spec.name}(${spec.helper ? "...args" : "props"});\n}`;
  noLoads(wrapper); noFreeIdentifiers(wrapper, bindings);
  return { ...spec, bindings, wrapper, sourceSha256: H(source), compiledSha256: H(leaf) };
}
function customerScope(ast) {
  const history = one(nodes(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === "z3" && n.getText(ast).includes("customerUploadHistoryGet.query")), "native customer history");
  const scope = history.parent;
  assert(ts.isBlock(scope), "actual customer factory block");
  let parent = scope;
  while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent;
  assert(parent?.name?.getText(ast) === "__CHANNEL_REFERENCE_HOST_EXPORTS", "customer native host only");
  return scope;
}
export async function verifySources() {
  const compiled = await Promise.all(specs.map(compile));
  return { status: "LOCAL_SOURCE_ABI_CHECKED_NO_CAPTURE", productionWrites: 0,
    leaves: compiled.map(({ name, native, sourceSha256, compiledSha256 }) => ({ name, native, sourceSha256, compiledSha256 })),
    embeddedFailuresChecked: true, noUnboundNewIdentifiers: true, noNewImports: true };
}
export async function build() {
  assert(!fs.existsSync(OUT), "fresh output directory required");
  const sourceFiles = [...new Set([...specs.map(spec => spec.file), failures.file,
    C + "customers/CustomerUploadHistory.css", C + "customers/CustomerChannelInventory.css", C + "channelInventory/batch.css"])];
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, H(fs.readFileSync(path.join(ROOT, file)))]));
  const beforeHtml = fs.readFileSync(path.join(BASE, "admin-index.html"));
  const names = [...new Set(beforeHtml.toString().match(/assets\/BusinessWorkbenchPage-upload-manage-[a-f0-9]+\.js/g))].map(n => path.basename(n)).sort();
  assert.equal(names.length, 2, "two currently referenced native modules");
  const compiled = await Promise.all(specs.map(compile));
  const modules = [];
  for (const file of names) {
    const bytes = fs.readFileSync(path.join(BASE, "assets", file));
    assert(H(bytes).startsWith(file.match(/([a-f0-9]+)\.js$/)[1]), "captured immutable filename hash");
    const before = bytes.toString(); assert(Buffer.from(before).equals(bytes), "strict UTF8");
    const ast = parse(before, file), scope = customerScope(ast), decls = declarations(scope);
    const abi = {}, hunks = [];
    for (const item of compiled) {
      const native = one(decls.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === item.native), "native " + item.native);
      for (const [key, name] of Object.entries(item.bindings)) {
        const binding = one(decls.filter(n => n.name?.getText(ast) === name), "ABI " + key + "=" + name);
        abi[key] = { native: name, sha256: H(binding.getText(ast)), head: binding.getText(ast).slice(0, 180) };
      }
      hunks.push({ name: item.native + "/" + item.name, start: native.getStart(ast), end: native.end, old: native.getText(ast), replacement: item.wrapper });
    }
    assert.equal(abi.React.head, "Ct=__customerLive.React");
    assert.equal(abi.trpc.head, "St=__customerLive.bridge_0_trpc");
    const { after, records } = inverseDelta(before, hunks), digest = H(after), relative = `assets/BusinessWorkbenchPage-customer-batch-${digest.slice(0, 16)}.js`;
    put("package/" + relative, after);
    json("package/evidence/" + file + ".delta.json", { input: "assets/" + file, output: relative, beforeSha256: H(bytes), afterSha256: digest, patches: records, inverseVerified: true, allBytesOutsideCustomerFunctionsUnchanged: true });
    json("package/evidence/" + file + ".abi.json", abi);
    modules.push({ before: "assets/" + file, after: relative, sha256: digest, size: Buffer.byteLength(after) });
  }
  const historyCss = fs.readFileSync(path.join(ROOT, C, "customers/CustomerUploadHistory.css"), "utf8");
  const inventoryCss = fs.readFileSync(path.join(ROOT, C, "customers/CustomerChannelInventory.css"), "utf8");
  const batchCss = fs.readFileSync(path.join(ROOT, C, "channelInventory/batch.css"), "utf8").split("/* Customer review stays inside")[1];
  assert(batchCss, "dedicated added review CSS marker");
  const prefixedBatch = batchCss.slice(batchCss.indexOf("*/") + 2).replace(/^\./gm, ".customer-supply-dialog .");
  const css = "/* Customer batch actions: scoped customer-only rules. */\n" + scopedCss(historyCss, ["customer-upload-history"], { extractOnly: true }) + scopedCss(inventoryCss, ["customer-channel-inventory"]) + scopedCss(prefixedBatch, ["customer-supply-dialog"]);
  const cssRelative = `assets/customer-batch-actions-${H(css).slice(0, 16)}.css`;
  put("package/" + cssRelative, css);
  const { after, counts, link } = htmlDelta(beforeHtml, modules, cssRelative);
  put("package/before-index.html", beforeHtml); put("package/after-index.html", after);
  const assets = modules.map(m => ({ relative: m.after, sha256: m.sha256, size: m.size })).concat({ relative: cssRelative, sha256: H(css), size: Buffer.byteLength(css) });
  json("modules.json", modules); json("assets.json", assets);
  json("replacements.json", modules.map(m => ({ before: "/" + m.before, after: "/" + m.after })));
  put("css-relative.txt", cssRelative + "\n");
  for (const [file, digest] of Object.entries(sourceHashes)) assert.equal(H(fs.readFileSync(path.join(ROOT, file))), digest, "source changed during build: " + file);
  json("package/evidence/source-files.json", { sourceHashes, sourceStableDuringBuild: true, embeddedFailuresIncluded: true,
    compiler: "esbuild.transform", esbuildVersion: esbuild.version, builderSha256: H(fs.readFileSync(fileURLToPath(import.meta.url))) });
  json("package/evidence/sources.json", compiled.map(({ file, name, native, sourceSha256, compiledSha256 }) => ({ file, name, native, sourceSha256, compiledSha256 })));
  json("package/evidence/html.json", { beforeSha256: H(beforeHtml), afterSha256: H(after), counts, link, inverseVerified: true });
  console.log(JSON.stringify({ status: "LOCAL_NATIVE_CANDIDATES_NOT_DEPLOYED", modules, assets }, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-sources") console.log(JSON.stringify(await verifySources(), null, 2));
  else if (process.argv.length === 2) await build();
  else throw new Error("Usage: build-native.mjs [--verify-sources]");
}
