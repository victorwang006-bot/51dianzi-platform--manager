#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='/home/ubuntu/nav-hierarchy/baseline',out='/home/ubuntu/nav-hierarchy/navigation-overlay';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const baseline={
 'index.html':'78fe54166ee7fab2ebfd9b5e5b6115836153d69ec2d06828dbe6443e13d30486',
 'DashboardLayout-workbench-dropdown-669cfca6147567e8.js':'669cfca6147567e82ad3e8a3758d576dbbcd72637cc2d35e51c5cb273a815998',
 'workbench-dropdown-db9a38c798c52dd6.css':'db9a38c798c52dd6c905db76fb7224eb36db221339db4a4dfb610b2dd3d9e96e',
 'index-CG0lkwm6.js':'602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
 'index-C0vPar7R.css':'871768387861545514e30d482d34a3cf7a15a0f783bde72c998ab89e2863b5d2',
 'DashboardLayout-C5vzw2Fu.css':'a06dc0fa661904578bed190f0b1fe12e98fa6e477c4da4f00cebd393ed2b430c',
};
const texts={};for(const[name,digest]of Object.entries(baseline)){const b=await fs.readFile(path.join(base,name));assert.equal(sha(b),digest,'baseline drift '+name);texts[name]=b.toString('utf8');}
const parse=(name,s)=>{const a=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,'invalid '+name);return a;};
const one=(v,label)=>{assert.equal(v.length,1,'unique '+label);return v[0];};
const walk=(n,fn)=>{fn(n);ts.forEachChild(n,c=>walk(c,fn));};
const liveName='DashboardLayout-workbench-dropdown-669cfca6147567e8.js',live=texts[liveName],ast=parse('live-nav.js',live);
const functions=ast.statements.filter(ts.isFunctionDeclaration);
const wrapper=one(functions.filter(n=>n.name?.text==='uo'),'existing workspace wrapper');
const shell=one(functions.filter(n=>n.name?.text==='ko'),'actual layout');
const factoryStatement=one(ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__workbench_dropdown_navigation_v1')),'old factory');
assert.equal(live.slice(factoryStatement.end,wrapper.getStart(ast)),'\n','factory and wrapper adjacency');
const entryImport=one(ast.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./index-CG0lkwm6.js'),'entry import');
const imports=Object.fromEntries(entryImport.importClause.namedBindings.elements.map(n=>[(n.propertyName??n.name).text,n.name.text]));
const aliases={React:imports.r,jsx:imports.j,state:imports.ae,target:imports.af,groups:imports.ag};assert.deepEqual(aliases,{React:'c',jsx:'o',state:'Ze',target:'Xt',groups:'Qt'});
const entry=parse('entry.js',texts['index-CG0lkwm6.js']);assert.equal(one(entry.statements.filter(ts.isExportDeclaration).flatMap(n=>n.exportClause?.elements??[]).filter(n=>n.name.text==='o'),'real useSearch export').propertyName.text,'yT');
const headerCalls=[],rows=[],callbacks=[];walk(shell,n=>{
 if(ts.isCallExpression(n)&&n.expression.getText(ast)==='o.jsx'&&n.arguments[0]?.getText(ast)==='uo')headerCalls.push(n);
 if(ts.isConditionalExpression(n)&&n.getText(ast).includes('o.jsx(lo,')&&n.condition.getText(ast).includes('business'))rows.push(n);
 if(ts.isArrowFunction(n)&&n.body.getText(ast).includes('h.path==="/workbench/channel-inventory"'))callbacks.push(n);
});
const header=one(headerCalls,'header workspace call'),row=one(rows,'old second row'),callback=one(callbacks,'original route callback');
assert.equal(callback.parameters.length,1);assert.equal(callback.parameters[0].name.text,'h');
const locationProp=one(header.arguments[1].properties.filter(n=>ts.isPropertyAssignment(n)&&n.name.text==='location'),'header location');assert.equal(locationProp.initializer.getText(ast),'a');
const conditionals=[];walk(callback,n=>{if(ts.isConditionalExpression(n)&&n.condition.getText(ast)==='h.path==="/workbench/channel-inventory"')conditionals.push(n);});const channelConditional=one(conditionals,'original channel route branch');assert.equal(channelConditional.whenTrue.getText(ast),'h.path');
const source=path.join(repo,'client/src/components/admin/AdminWorkspaceNavigation.tsx'),helper=path.join(repo,'client/src/lib/channelInventoryNavigation.ts'),cssSource=path.join(repo,'client/src/components/admin/AdminWorkspaceNavigation.css');
const oldCss=execFileSync('git',['show','5b8cc0cddd5832e45eaf492fea5d37cdd08ce827:client/src/components/admin/AdminWorkspaceNavigation.css'],{cwd:repo,encoding:'utf8'}),currentCss=await fs.readFile(cssSource,'utf8');
assert.ok(currentCss.startsWith(oldCss),'previous navigation CSS must be intact');const css=currentCss.slice(oldCss.length);assert.ok(css.length>200,'new scoped hierarchy CSS missing');
const cssAst=postcss.parse(css);cssAst.walkRules(rule=>assert.ok(rule.selector.split(',').every(s=>s.trim().startsWith('.admin-workspace-nav__')||s.trim().startsWith('[data-admin-navigation="unified-dropdown"] .admin-workspace-nav__')),'unscoped CSS '+rule.selector));cssAst.walkDecls(d=>{assert.ok(!d.prop.startsWith('--')&&d.prop!=='zoom','no global design changes');});
const reactNames=['Children','Component','Fragment','StrictMode','Suspense','act','cloneElement','createContext','createElement','createRef','forwardRef','isValidElement','lazy','memo','startTransition','use','useCallback','useContext','useDebugValue','useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo','useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
const virtual={react:`const R=__nav_live.React;export default R;${reactNames.map(n=>`export const ${n}=R.${n};`).join('\n')}`,jsx:'export const jsx=__nav_live.jsx.jsx;export const jsxs=__nav_live.jsx.jsxs;export const Fragment=__nav_live.jsx.Fragment;',model:'export const getAdminWorkspaceNavigationState=__nav_live.state;export const getAdminWorkspaceNavigationTarget=__nav_live.target;export const groupAdminBusinessNavigationItems=__nav_live.groups;',time:'export const BEIJING_TIME_ZONE=__nav_live.zone;'};
const sources=new Map();const plugin={name:'reuse-current-runtime',setup(build){build.onResolve({filter:/.*/},args=>{if(args.path==='react')return{path:'react',namespace:'nav-live'};if(args.path==='react/jsx-runtime')return{path:'jsx',namespace:'nav-live'};if(args.path==='./adminWorkspaceNavigationModel')return{path:'model',namespace:'nav-live'};if(args.path==='@shared/beijingTime')return{path:'time',namespace:'nav-live'};if(/\.css$/.test(args.path))return{path:'css',namespace:'nav-empty'};if(args.path.startsWith('react-dom')||args.path.startsWith('@tanstack')||args.path.startsWith('@trpc')||args.path==='wouter')throw Error('unbridged runtime '+args.path);});build.onLoad({filter:/.*/,namespace:'nav-live'},args=>({contents:virtual[args.path],loader:'js'}));build.onLoad({filter:/.*/,namespace:'nav-empty'},()=>({contents:'',loader:'js'}));build.onLoad({filter:/\.[jt]sx?$/,namespace:'file'},async args=>{const contents=await fs.readFile(args.path,'utf8');sources.set(args.path,sha(contents));return{contents,loader:args.path.endsWith('.tsx')?'tsx':args.path.endsWith('.ts')?'ts':'js'};});}};
const result=await esbuild.build({absWorkingDir:repo,stdin:{contents:`export {WorkspaceTabs} from ${JSON.stringify(source)};export {channelInventoryTabLocation} from ${JSON.stringify(helper)};`,resolveDir:repo,sourcefile:'hierarchy-approved.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'__nav_exports',target:'es2020',platform:'browser',minify:true,legalComments:'none',metafile:true,plugins:[plugin],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
assert.equal(result.outputFiles.length,1);assert.ok(Object.keys(result.metafile.inputs).every(s=>!s.includes('node_modules')&&!s.includes('/server/')),'bundled runtime/server');
const factory=`(function(__nav_live){${result.outputFiles[0].text}\nreturn __nav_exports;})`,binding='__hierarchy_navigation_v1';assert.ok(!live.includes(binding),'binding collision');
const args=`{React:c,jsx:o,state:Ze,target:Xt,groups:Qt,zone:ce}`;
const addedImport='import{o as __navHierarchyUseSearch}from"./index-CG0lkwm6.js";\n';
const changes=[
 {start:0,end:0,replacement:addedImport,reason:'reuse existing exported useSearch'},
 {start:factoryStatement.getStart(ast),end:wrapper.end,replacement:`const ${binding}=${factory}(${args});\nfunction uo(props){return c.createElement(${binding}.WorkspaceTabs,props);}`,reason:'four dropdowns and staged menus'},
 {start:shell.body.getStart(ast)+1,end:shell.body.getStart(ast)+1,replacement:'const __navHierarchySearch=__navHierarchyUseSearch();',reason:'observe real query changes'},
 {start:callback.parameters[0].getStart(ast),end:callback.equalsGreaterThanToken.getStart(ast),replacement:'(h,__navHierarchyTab)',reason:'original item + optional whitelisted channel tab'},
 {start:channelConditional.whenTrue.getStart(ast),end:channelConditional.whenTrue.end,replacement:`(${binding}.channelInventoryTabLocation(__navHierarchyTab)??h.path)`,reason:'preserve original navigation context for all other routes'},
 {start:locationProp.initializer.getStart(ast),end:locationProp.initializer.end,replacement:'(a.includes("?")?a:a+(__navHierarchySearch?"?"+__navHierarchySearch.replace(/^\\?/,""):""))',reason:'exact current subpage display'},
 {start:header.arguments[1].end-1,end:header.arguments[1].end-1,replacement:',renderBadge:b',reason:'preserve original unread badges'},
 {start:row.getStart(ast),end:row.end,replacement:'null',reason:'all module navigation moved to top dropdown'},
].sort((a,b)=>a.start-b.start);
let cursor=0,candidate='';for(const c of changes){assert.ok(c.start>=cursor,'overlapping edits');c.old=live.slice(c.start,c.end);candidate+=live.slice(cursor,c.start)+c.replacement;c.newStart=candidate.length-c.replacement.length;c.newEnd=candidate.length;cursor=c.end;}candidate+=live.slice(cursor);
const candidateAst=parse('candidate.js',candidate);let restored=candidate;for(const c of [...changes].reverse())restored=restored.slice(0,c.newStart)+c.old+restored.slice(c.newEnd);assert.equal(restored,live,'other navigation chunk bytes changed');
const importExports=tree=>tree.statements.filter(n=>ts.isImportDeclaration(n)||ts.isExportDeclaration(n)).filter(n=>!n.getText(tree).includes('__navHierarchyUseSearch')).map(n=>n.getText(tree));assert.deepEqual(importExports(ast),importExports(candidateAst),'original import/export drift');
for(const[name,hash]of sources)assert.equal(sha(await fs.readFile(name)),hash,'source drift during compile');assert.equal(await fs.readFile(cssSource,'utf8'),currentCss,'CSS drift during compile');
const jsHash=sha(candidate),cssHash=sha(css),jsName=`DashboardLayout-hierarchy-${jsHash.slice(0,16)}.js`,cssName=`workspace-hierarchy-${cssHash.slice(0,16)}.css`;
await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,jsName),candidate);await fs.writeFile(path.join(out,cssName),css);await fs.writeFile(path.join(out,'factory-expression.js'),factory);await fs.writeFile(path.join(out,'metafile.json'),JSON.stringify(result.metafile,null,2)+'\n');
const manifest={schemaVersion:1,baseline,sourceBase:'5b8cc0cddd5832e45eaf492fea5d37cdd08ce827',outputs:{js:{name:jsName,sha256:jsHash,bytes:Buffer.byteLength(candidate)},css:{name:cssName,sha256:cssHash,bytes:Buffer.byteLength(css)}},changes:changes.map(({start,end,newStart,newEnd,old,replacement,reason})=>({start,end,newStart,newEnd,oldSha256:sha(old),replacementSha256:sha(replacement),reason})),aliases,originalImportsExportsPreserved:true,allowedAdditionalImports:[{source:'./index-CG0lkwm6.js',export:'o',local:'__navHierarchyUseSearch'}],allOtherChunkBytesPreserved:true,oldCssBytesPreserved:true,noRuntimeOrServerDependencies:true,sourceFiles:[...sources].map(([name,sha256])=>({name,sha256})),cssSource:{name:cssSource,sha256:sha(currentCss)}};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({ok:true,outputs:manifest.outputs,changes:changes.length,originalImportsExportsPreserved:true}));
