#!/usr/bin/env node
'use strict';
// Executes actual candidate ChatPageContent and additive helper bytes in a temporary native-source DI adapter.
// No app source writes, server/browser/SSH/git/secret access, or real transport calls.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const OUT = process.env.RECEPTION_CANDIDATE_DIR || '/home/ubuntu/work/reception-candidate';
const TMP = '/tmp/reception-native-candidate', CONFIG = '/tmp/reception-chat-subagent/vitest.config.ts';
const SOURCE = path.join(REPO, 'client/src/business/platform/client/src/pages/ChatPage.tsx');
const SOURCE_TEST = path.join(REPO, 'client/src/business/platform/client/src/components/chat/ChatPageDrafts.test.ts');
function packageRequire(name) {
  try { return require(name); } catch {
    const base = path.join(REPO, 'node_modules/.pnpm');
    const entries = fs.readdirSync(base).filter(x => x.startsWith(name.replace('/', '+') + '@'));
    assert(entries.length, `missing dependency ${name}`);
    return require(path.join(base, entries[0], 'node_modules', name));
  }
}
const parser = packageRequire('@babel/parser'), traverse = packageRequire('@babel/traverse').default;
const read = f => fs.readFileSync(f, 'utf8'), sha = text => crypto.createHash('sha256').update(text).digest('hex');
const parse = text => parser.parse(text, {sourceType:'module', plugins:['jsx','typescript']});
const json = f => JSON.parse(read(f));
const write = (f, text) => { fs.mkdirSync(path.dirname(f), {recursive:true}); fs.writeFileSync(f, text); };
const writeJson = (f, obj) => write(f, JSON.stringify(obj, null, 2) + '\n');
function applyEdits(text, edits) {
  const unique = [...new Map(edits.map(e => [`${e.start}:${e.end}`, e])).values()].sort((a,b) => b.start-a.start);
  let last = Infinity;
  for (const e of unique) { assert(e.end <= last, 'overlapping rewrite'); text = text.slice(0,e.start)+e.text+text.slice(e.end); last=e.start; }
  return text;
}
function inside(node, container) { return node.start >= container.start && node.end <= container.end; }
function liveField(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (node.object.type === 'Identifier' && node.object.name === '__live') return node.computed ? node.property.value : node.property.name;
  return null;
}
function extract(index) {
  const proofPath = path.join(OUT, `workbench-${index}-build-proof.json`), proof=json(proofPath);
  const file=path.join(OUT, proof.url), text=read(file); assert.equal(sha(text),proof.sha256,'candidate hash differs from build proof');
  const ast=parse(text); let getter, ps, helper;
  traverse(ast, {FunctionDeclaration(p) {
    if(p.node.id.name==='__d51_ir_w_get' && p.parentPath.isProgram()) { assert(!getter); getter=p; }
    if(p.node.id.name==='__d51_rx_chat_helpers_get' && p.parentPath.isProgram()) { assert(!helper); helper=p; }
  }});
  assert(getter && helper, 'actual top-level getters missing');
  getter.traverse({FunctionDeclaration(p) { if(p.node.id.name==='ps') {assert(!ps,'multiple ps within private getter'); ps=p;} }});
  assert(ps, 'private getter ps not found');
  const map=new Map();
  getter.traverse({VariableDeclarator(p) {
    if(inside(p.node,ps.node)) return;
    const field=liveField(p.node.init); if(!field) return;
    if(p.node.id.type==='Identifier') map.set(p.node.id.name,{target:field,field,kind:'live-field',binding:p.scope.getBinding(p.node.id.name)});
    if(p.node.id.type==='ObjectPattern') for(const prop of p.node.id.properties) {
      if(prop.type!=='ObjectProperty' || prop.value.type!=='Identifier') continue;
      const key=prop.key.name || prop.key.value;
      const target=field==='React'?key:field==='jsx'?`__live.jsx.${key}`:null;
      assert(target,`unsupported destructuring ${field}`);
      map.set(prop.value.name,{target,field:`${field}.${key}`,kind:'live-destructure',binding:p.scope.getBinding(prop.value.name)});
    }
  }});
  const constant=getter.scope.getBinding('it') || ps.scope.getBinding('it');
  if(constant) map.set('it',{target:'INQUIRY_RECEPTION_CONVERSATION_OPTIONS',field:'pure reception query options',kind:'source-constant',binding:constant});
  const edits=[], used={}, unbound=new Set(), unmapped=new Set(), localPreserved={};
  ps.traverse({ReferencedIdentifier(p) {
    const name=p.node.name, binding=p.scope.getBinding(name);
    if(binding && inside(binding.path.node,ps.node)) { localPreserved[name]=(localPreserved[name]||0)+1; return; }
    if(name==='__d51_rx_chat_helpers_get' || name==='__live') return;
    if(!binding) { unbound.add(name); return; }
    const entry=map.get(name);
    if(!entry || entry.binding!==binding) {unmapped.add(name);return;}
    let replacement=entry.target;
    // Mapping to a source name must not capture an unrelated minified local (e.g. X is also menu state).
    const targetBinding=/^[A-Za-z_$][\w$]*$/.test(replacement)?p.scope.getBinding(replacement):null;
    const captureAvoided=targetBinding && inside(targetBinding.path.node,ps.node);
    if(captureAvoided) replacement=`__d51_native_source_captures.${replacement}`;
    if(p.parentPath.isObjectProperty() && p.parent.shorthand && p.key==='value') replacement=`${name}: ${replacement}`;
    edits.push({start:p.node.start-ps.node.start,end:p.node.end-ps.node.start,text:replacement});
    used[name]={target:entry.target,field:entry.field,kind:entry.kind,references:(used[name]?.references||0)+1,...(captureAvoided?{captureAvoided:true,adapterReference:`__d51_native_source_captures.${entry.target}`}:{})};
  }});
  assert.equal(unmapped.size,0,`unmapped captured aliases: ${[...unmapped]}`);
  // Only host/browser ECMAScript globals may remain unresolved. __rx bindings stay local.
  const globals=new Set(['document','window','URL','URLSearchParams','Number','String','Boolean','Math','Date','Set','Map','Promise','Error','Array','Object','JSON','console','navigator','localStorage','requestAnimationFrame','cancelAnimationFrame','FileReader','File','undefined','NaN','Infinity']);
  assert.deepEqual([...unbound].filter(x=>!globals.has(x)), [], 'unexpected unresolved captured reference');
  const actualPs=text.slice(ps.node.start,ps.node.end);
  edits.push({start:ps.node.id.start-ps.node.start,end:ps.node.id.end-ps.node.start,text:'ChatPageContent'});
  const rewritten=applyEdits(actualPs,edits);
  const instance=ast.program.body.find(n=>n.type==='VariableDeclaration' && n.declarations.some(d=>d.id.name==='__d51_rx_chat_helpers_instance'));
  assert(instance,'actual helper instance declaration missing');
  const actualHelper=text.slice(instance.start,instance.end)+'\n'+text.slice(helper.node.start,helper.node.end);
  const additive=json(path.join(OUT,`chat-extra-${index}.json`)).find(p=>p.reason==='additive-chat-helpers-original-React-no-new-context');
  assert(additive,'additive helper proof missing');
  // Build serialization may normalize string escape/newline spellings, so compare token-equivalent ASTs.
  const normalize=n=>JSON.stringify(n,(k,v)=>['start','end','loc','extra','comments','leadingComments','trailingComments','innerComments'].includes(k)?undefined:v);
  assert.equal(normalize(parse(actualHelper).program.body),normalize(parse(additive.after).program.body),'actual helper not same AST as additive proof');
  return {file,proofPath,text,actualPs,rewritten,actualHelper,used,unbound:[...unbound],localPreserved,rewrites:edits.length,
    inputs:{relative:path.relative(OUT,file),sha256:sha(text),actualPsSha256:sha(actualPs),actualHelpersSha256:sha(actualHelper),buildProofSha256:sha(read(proofPath)),chatExtraSha256:sha(read(path.join(OUT,`chat-extra-${index}.json`)))}};
}
function absoluteImports(text, originalFile) {
  const ast=parse(text), edits=[];
  traverse(ast,{StringLiteral(p) {
    const isImport=p.parentPath.isImportDeclaration() || (p.parentPath.isCallExpression() && p.parent.callee.type==='MemberExpression' && p.parent.callee.object.name==='vi' && p.parent.callee.property.name==='mock' && p.key===0);
    if(isImport && p.node.value.startsWith('.')) edits.push({start:p.node.start,end:p.node.end,text:JSON.stringify(path.resolve(path.dirname(originalFile),p.node.value))});
  }});
  return applyEdits(text,edits);
}
function generate() {
  const zero=extract(0), one=extract(1);
  assert.equal(sha(zero.actualPs),sha(one.actualPs),'workbench ps differs');
  assert.equal(sha(zero.actualHelper),sha(one.actualHelper),'workbench actual helpers differ');
  let source=read(SOURCE), content;
  traverse(parse(source),{FunctionDeclaration(p){if(p.node.id.name==='ChatPageContent'){assert(!content);content=p.node;}}});
  assert(content);
  source=source.slice(0,content.start)+zero.rewritten+source.slice(content.end);
  source=absoluteImports(source,SOURCE);
  const collisionTargets=[...new Set(Object.values(zero.used).filter(e=>e.captureAvoided).map(e=>e.target))];
  const adapter='// Generated temporary adapter. Actual private-getter ps and outer additive helper, with captured-alias-only rewrites.\nimport * as c from "react";\nimport * as e from "react/jsx-runtime";\nconst __live = { React:c, jsx:e };\n'+zero.actualHelper+'\nexport const ActualChatStickerImage = __d51_rx_chat_helpers_get().ChatStickerImage;\n'+source+'\nconst __d51_native_source_captures = {'+collisionTargets.join(',')+'};\n';
  write(path.join(TMP,'ActualChatPage.tsx'),adapter);
  let test=absoluteImports(read(SOURCE_TEST),SOURCE_TEST);
  const absoluteChat=path.resolve(path.dirname(SOURCE_TEST),'../../pages/ChatPage');
  assert(test.includes(JSON.stringify(absoluteChat)));
  test=test.replace(JSON.stringify(absoluteChat),JSON.stringify(path.join(TMP,'ActualChatPage')));
  test=test.replace('import React, { act, createElement }','import React, { act, createElement, useLayoutEffect }');
  // Observe the committed DOM in layout, before the old effect-based selection could repair it.
  test=test.replace('const render = async', 'const layoutSnapshots: Array<{ conversationId: number; text: string; draft: string | null }> = [];\nconst Snapshot = ({ conversationId, children }: {conversationId:number;children:React.ReactNode}) => {\n  useLayoutEffect(() => { layoutSnapshots.push({ conversationId, text:host.textContent || "", draft:host.querySelector<HTMLTextAreaElement>("textarea")?.value ?? null }); });\n  return children;\n};\nconst render = async');
  test=test.replace('children: createElement(ChatPage, { businessReception: config, receptionConversation: { conversationId, canReply, onBack: () => undefined } }),','children: createElement(Snapshot, { conversationId, children: createElement(ChatPage, { businessReception: config, receptionConversation: { conversationId, canReply, onBack: () => undefined } }) }),');
  test=test.replace('fixture.reset(); host =', 'fixture.reset(); layoutSnapshots.length = 0; host =');
  test += '\n'+extraTests();
  write(path.join(TMP,'ActualChatPageDrafts.test.ts'),test);
  write(CONFIG,`export default { root:${JSON.stringify(TMP)}, server:{fs:{allow:[${JSON.stringify(TMP)},${JSON.stringify(REPO)}]}}, esbuild:{jsx:"automatic"}, resolve:{alias:{"@":${JSON.stringify(REPO+'/client/src')},"@client":${JSON.stringify(REPO+'/client/src')},"@shared":${JSON.stringify(REPO+'/shared')},"@assets":${JSON.stringify(REPO+'/attached_assets')}}}, test:{environment:"jsdom",fileParallelism:false,include:[${JSON.stringify(TMP+'/*.test.ts')}]} };\n`);
  // Resolve runtime packages for /tmp adapters without putting any adapter in app source.
  const modules=path.join(TMP,'node_modules'); if(!fs.existsSync(modules)) fs.symlinkSync(path.join(REPO,'node_modules'),modules,'dir');
  const meta={status:'PREPARED',inputs:[zero.inputs,one.inputs],sourceAdapterDIInput:{path:SOURCE,sha256:sha(read(SOURCE))},sourceTestDIInput:{path:SOURCE_TEST,sha256:sha(read(SOURCE_TEST))},actualCandidatePatchBytesExecuted:false,identicalActualPsAcrossBothWorkbenches:true,identicalActualHelperAcrossBothWorkbenches:true,capturedAliasMapping:zero.used,rewrittenCapturedReferences:zero.rewrites-1,localBindingReferenceNamesPreserved:Object.keys(zero.localPreserved),unresolvedHostGlobals:zero.unbound,adapterPath:path.join(TMP,'ActualChatPage.tsx'),adapterSha256:sha(adapter),testPath:path.join(TMP,'ActualChatPageDrafts.test.ts'),testSha256:sha(test),configPath:CONFIG,DIboundary:'Actual candidate private-getter ps and outer additive __d51_rx_chat_helpers_get are executed. Only free captured lexical aliases are mapped back to source imported/globals; all local bindings including __rx remain intact. The source ChatPage outer wrapper, useAuth, BusinessScopeProvider and original non-additive source helpers are retained. The existing test mocks business-trpc queries/mutations/utilities, wouter and two unrelated display components. This is a native React/jsdom DI integration test, not execution of the complete production ES module, remote transport, browser or E2E; real messages/database operations are zero.'};
  writeJson(path.join(TMP,'extraction-proof.json'),meta); return meta;
}
function extraTests(){return `
import { ActualChatStickerImage } from "./ActualChatPage";
describe("actual candidate commit and cross-conversation isolation", () => {
  it("commits the selected conversation and its independent draft synchronously before passive effects", async () => {
    await render(11); type("甲同步草稿"); await render(22); type("乙同步草稿");
    layoutSnapshots.length=0; await render(11);
    expect(layoutSnapshots[0].conversationId).toBe(11); expect(layoutSnapshots[0].draft).toBe("甲同步草稿");
    expect(layoutSnapshots[0].text).toContain("客户11询价原文"); expect(layoutSnapshots[0].text).not.toContain("客户22询价原文");
    layoutSnapshots.length=0; await render(22);
    expect(layoutSnapshots[0].draft).toBe("乙同步草稿"); expect(layoutSnapshots[0].text).toContain("客户22询价原文"); expect(layoutSnapshots[0].text).not.toContain("客户11询价原文");
  });
  it("a failed A message cannot appear/retry in B; retrying A preserves both later drafts and original transport identity", async () => {
    await render(11); type("甲失败原文"); fixture.state.mode="failure"; click(button("发送"));
    expect(sends()).toHaveLength(1); expect(sends()[0].input.conversationId).toBe(11);
    await render(22); type("乙保留草稿"); expect(host.textContent).not.toContain("发送失败，点击重试"); expect(host.textContent).not.toContain("甲失败原文");
    await render(11); type("甲重试后新草稿");
    const retry=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(x=>x.textContent?.includes("发送失败，点击重试"))!;
    fixture.state.mode="success"; click(retry); expect(sends()).toHaveLength(2); expect(sends()[1].input).toEqual(sends()[0].input);
    expect(editor().value).toBe("甲重试后新草稿"); await render(22); expect(editor().value).toBe("乙保留草稿");
  });
  it("auth-session event and storage revocation clear the actual helper's drafts", async () => {
    await render(11); type("旧认证草稿"); act(()=>window.dispatchEvent(new Event("51dianzi:auth-session-cleared")));
    expect(editor().value).toBe(""); type("旧存储认证草稿");
    act(()=>window.dispatchEvent(new StorageEvent("storage",{key:"51dianzi:auth-session-cleared:v1",newValue:"cleared"})));
    expect(editor().value).toBe(""); await render(22); expect(editor().value).toBe("");
  });
  it("actual additive sticker component falls back on image error and resets on a different resource", async () => {
    await act(async()=>root.render(createElement(ActualChatStickerImage,{src:"/broken-a.png",alt:"测试表情",className:"original-class"})));
    const image=host.querySelector("img")!; expect(image).not.toBeNull(); act(()=>image.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull(); expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("测试表情：表情暂不可用");
    expect(host.querySelector('[role="img"]')?.className).toBe("original-class");
    await act(async()=>root.render(createElement(ActualChatStickerImage,{src:"/new-b.png",alt:"新表情"})));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/new-b.png"); expect(host.querySelector('[role="img"]')).toBeNull();
  });
});
`;}
try {
  const meta=generate();
  if(process.argv.includes('--prepare-only')) {console.log(JSON.stringify({status:'PREPARED',inputs:meta.inputs,adapterPath:meta.adapterPath}));process.exit(0);}
  const result=spawnSync('pnpm',['exec','vitest','run','--config',CONFIG,'--reporter=verbose','--reporter=json',`--outputFile.json=${TMP}/vitest-results.json`],{cwd:REPO,encoding:'utf8',maxBuffer:16*1024*1024,timeout:180000});
  const log=(result.stdout||'')+(result.stderr||'')+(result.error?String(result.error):'');
  write('/tmp/reception-chat-subagent/final-related-tests.log',log); write(path.join(TMP,'actual-chat-tests.log'),log); process.stdout.write(log);
  const raw=fs.existsSync(path.join(TMP,'vitest-results.json'))?json(path.join(TMP,'vitest-results.json')):{};
  const tests=(raw.testResults||[]).flatMap(x=>(x.assertionResults||[]).map(t=>({name:t.fullName,status:t.status==='passed'?'PASS':'FAIL',durationMs:t.duration,failureMessages:t.failureMessages})));
  const status=result.status===0 && raw.numPassedTests>0 && raw.numFailedTests===0?'PASS':'FAIL';
  const report={...meta,status,actualCandidatePatchBytesExecuted:true,tests:{passed:raw.numPassedTests||0,failed:raw.numFailedTests||0,total:raw.numTotalTests||0,results:tests},logPath:'/tmp/reception-chat-subagent/final-related-tests.log',vitestResultsPath:path.join(TMP,'vitest-results.json'),realMessagesSent:0,databaseOperations:0,generatedBy:path.join(REPO,'deploy/test-reception-native-chat-20261113.cjs'),generatorSha256:sha(read(__filename)),inputFilesUnchangedAfterRun:meta.inputs.every(i=>fs.existsSync(path.join(OUT,i.relative)) && sha(read(path.join(OUT,i.relative)))===i.sha256),reportedAt:new Date().toISOString()};
  writeJson(path.join(OUT,'actual-chat-tests.json'),report); console.log(JSON.stringify({status,tests:report.tests.total,inputs:meta.inputs})); if(status!=='PASS')process.exitCode=1;
} catch(error) {console.error(error.stack);process.exitCode=1;}
