import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as esbuild from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] || "/home/ubuntu/work/merge-validation/equivalence.json";
const archive = path.join(root, "deploy/ecs-20261126-purchase-sales-revise");
const livePath = path.join(archive, "admin-ui", fs.readdirSync(path.join(archive, "admin-ui")).find(x => x.startsWith("BusinessWorkbenchPage-v3-") && x.endsWith(".js")));
const live = fs.readFileSync(livePath, "utf8");
const parse = text => ts.createSourceFile("module.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const ast = parse(live);
function nodes(source, predicate) { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); } visit(source); return result; }
const unique = values => [...new Set(values)].sort();
const normalize = text => text.replace(/\s+/g, " ").trim();
function metrics(text) {
  const source = parse(text);
  const literals = nodes(source, n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)).map(n => n.text);
  const props = nodes(source, ts.isPropertyAssignment);
  const propertyName = p => ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(source);
  const stringsIn = n => nodes(n, x => ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)).map(x => normalize(x.text)).filter(Boolean);
  const aria = props.filter(p => propertyName(p) === "aria-label").flatMap(p => stringsIn(p.initializer));
  const classes = props.filter(p => propertyName(p) === "className").flatMap(p => stringsIn(p.initializer)).flatMap(x => x.split(/\s+/)).filter(Boolean);
  // 编译后的所有 button 以及封装 Button 控件保留其直接 children 名称（含动态名称片段）。
  const buttons = nodes(source, ts.isCallExpression).filter(n => n.arguments.length && ((ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "button") || /Button$|__sv2_Button$/.test(n.arguments[0].getText(source)))).flatMap(n => n.arguments.slice(1).flatMap(stringsIn));
  const procedures = unique([...text.matchAll(/\b(?:Ue|nt|trpc|typedTrpc|utils)\.(inbound|crmSalesOrder)\.(\w+)/g)].map(m => `${m[1]}.${m[2]}`).concat([...text.matchAll(/\bapi\.(\w+)\.(?:useQuery|useMutation)/g)].map(m => `inbound.${m[1]}`)));
  return { chinese: unique(literals.filter(x => /[\u4e00-\u9fff]/.test(x)).map(normalize)), aria: unique(aria), buttons: unique(buttons.filter(x => /[\u4e00-\u9fff]/.test(x))), procedures, classes: unique(classes) };
}
async function compile(files) { const texts = []; for (const file of files) { const result = await esbuild.transform(fs.readFileSync(path.join(root, file), "utf8"), { loader: "tsx", target: "es2020", jsxFactory: "React.createElement", jsxFragment: "React.Fragment" }); texts.push(result.code); } return texts.join("\n"); }
function onlineFunctions(prefix) { const functions = nodes(ast, ts.isFunctionDeclaration).filter(n => n.name?.text.startsWith(prefix) && n.name.text !== "__sv2_LegacyDn"); const constants = nodes(ast, ts.isVariableDeclaration).filter(n => ts.isIdentifier(n.name) && n.name.text.startsWith(prefix) && n.initializer && !n.name.text.toLowerCase().includes("css")); return functions.map(n => n.getText(ast)).concat(constants.map(n => "const " + n.getText(ast) + ";")).join("\n"); }
const base = "client/src/business/platform/client/src";
const configs = [
  { name: "采购编辑器及金额函数", prefix: "__i2_", files: [`${base}/components/inbound/InboundOrderEditor.tsx`, `${base}/lib/inboundOrderMoney.ts`], cssFiles: [`${base}/components/inbound/InboundOrderEditor.css`], cssName: "__i2_CSS" },
  { name: "销售新版列表、编辑器及金额函数", prefix: "__sv2_", files: [`${base}/pages/BusinessSalesOrdersPage.tsx`, `${base}/lib/businessSalesOrderMoney.ts`], cssFiles: [`${base}/pages/BusinessSalesOrdersPage.css`], cssName: "__sv2_css" },
];
const reports = [];
for (const config of configs) {
  const compiled = await compile(config.files);
  const online = onlineFunctions(config.prefix);
  const sourceMetrics = metrics(compiled), liveMetrics = metrics(online);
  const differences = Object.fromEntries(Object.keys(sourceMetrics).map(key => [key, { sourceOnly: sourceMetrics[key].filter(x => !liveMetrics[key].includes(x)), liveOnly: liveMetrics[key].filter(x => !sourceMetrics[key].includes(x)) }]));
  const variable = nodes(ast, ts.isVariableDeclaration).find(n => ts.isIdentifier(n.name) && n.name.text === config.cssName);
  if (!variable) throw Error(`线上 CSS 锚点缺失 ${config.cssName}`);
  const liveCss = new Function("return " + variable.initializer.getText(ast))();
  const sourceCss = config.cssFiles.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const cssCompile = async text => (await esbuild.transform(text, { loader: "css", minify: true })).code.replace(/@media ([^{]+)\{/g, m => m.replace(/:\s+/g, ":"));
  const cssClasses = text => unique([...text.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(m => m[1]));
  reports.push({ name: config.name, onlineFunctions: nodes(parse(online), ts.isFunctionDeclaration).map(n => n.name.text), files: config.files, counts: Object.fromEntries(Object.keys(sourceMetrics).map(key => [key, { source: sourceMetrics[key].length, online: liveMetrics[key].length }])), differences, css: { normalizedEqual: await cssCompile(sourceCss) === await cssCompile(liveCss), sourceClasses: cssClasses(sourceCss).length, onlineClasses: cssClasses(liveCss).length, sourceOnly: cssClasses(sourceCss).filter(x => !cssClasses(liveCss).includes(x)), liveOnly: cssClasses(liveCss).filter(x => !cssClasses(sourceCss).includes(x)) } });
}
// 采购列表通过上线补丁列出的独立锚点逐项验证；存档仅只读。
const inboundPage = fs.readFileSync(path.join(root, `${base}/pages/InboundManagement.tsx`), "utf8");
const inboundListCss = fs.readFileSync(path.join(root, `${base}/pages/InboundManagement.v2.css`), "utf8");
const onlineListCss = nodes(ast, ts.isVariableDeclaration).find(n => ts.isIdentifier(n.name) && n.name.text === "__i2_LIST_CSS").initializer.text;
const listChecks = { quantityPriceHeader: inboundPage.includes("数量 / 单价"), totalCostHeader: inboundPage.includes("采购总成本"), feeSubline: inboundPage.includes("含费用 "), statusTabs: ["all", "in_transit", "received", "cancelled"].every(x => inboundPage.includes(`"${x}"`)), ariaTablist: inboundPage.includes('aria-label="入库状态"'), editorWired: inboundPage.includes("<InboundOrderEditor"), allRowsQuery: inboundPage.includes('useQuery({ status: "all" })') || inboundPage.includes('useQuery({status: "all"})'), cancelledDocumentsSkipped: /row.status === "cancelled"\s*\? Promise.resolve\(\[\]\)/.test(inboundPage), normalizedCssEqual: (await esbuild.transform(inboundListCss, {loader:"css", minify:true})).code.replace(/:\s+/g, ":") === (await esbuild.transform(onlineListCss, {loader:"css", minify:true})).code.replace(/:\s+/g, ":") };
const beforePath = path.join(archive, "base", fs.readdirSync(path.join(archive, "base")).find(x => x.endsWith(".js")));
const beforeAst = parse(fs.readFileSync(beforePath, "utf8"));
const beforeInbound = nodes(beforeAst, ts.isFunctionDeclaration).find(n => n.name?.text === "__d51_procurement_inbound_get").getText(beforeAst);
const originalChinese = metrics(beforeInbound).chinese;
const sourcePaths = [`${base}/pages/InboundManagement.tsx`, `${base}/components/inbound/InboundDocuments.tsx`, `${base}/components/inbound/inboundDocumentDraft.ts`, `${base}/components/inbound/BulkInboundForm.tsx`, `${base}/components/inbound/procurementBuyerSelection.ts`, `${base}/lib/inboundOrderEditorModel.ts`];
const allMainPaths = child.execFileSync("git", ["ls-tree", "-r", "main", "--name-only"], {cwd:root, encoding:"utf8"}).split("\n").filter(p => p.startsWith("client/src/business/") && /\.tsx?$/.test(p) && !/test\.|spec\.|test-helper/.test(p));
const mainTexts = allMainPaths.map(p => { try { return requireGit(p); } catch { return ""; } });
function requireGit(file) { return child.execFileSync("git", ["show", "main:" + file], {cwd:root, encoding:"utf8", maxBuffer:20*1024*1024}); }
import * as child from "node:child_process";
// 只核对线上原模块文案是否在 main 对应源文件中存在，模板拼接差异单列。
const mainChinese = metrics((await Promise.all(mainTexts.map((t, i) => esbuild.transform(t, {loader: allMainPaths[i].endsWith(".tsx") ? "tsx" : "ts", target:"es2020"})))).map(r=>r.code).join("\n")).chinese;
const result = { livePath, sourceCompiler: "esbuild transform, ES2020, classic JSX（类型擦除后）", reports, listChecks, beforeMergeSourceDrift: { originalChinese: originalChinese.length, mainChinese: mainChinese.length, onlineOriginalOnly: originalChinese.filter(x => !mainChinese.includes(x)), coverage: "main 的全部业务前端 TS/TSX（不含测试），仅文案存在性检查，不代表所有行为一致" }, limitations: ["集合核对不证明所有交互与数据库语义等价。", "按钮集合含封装控件与动态标签片段；样式从 inline 移至正式 CSS 导入。", "全工作台其他叶子模块的历史补丁不在本任务迁移范围。"] };
fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ reports: reports.map(r => ({name:r.name, counts:r.counts, differences:r.differences, css:r.css})), listChecks, output },null,2));
