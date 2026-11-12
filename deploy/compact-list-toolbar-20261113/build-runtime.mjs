import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ts,require,assert,nodes,prop,props,children,one,parse} from './layout-ast.mjs';
import {htmlInventory,resolver,canon,relocateMap,validateMapPreservation,inspectStatic} from '/home/ubuntu/task-recovery/continued-20261112/static-candidate-tools/composition-stage/static-closure.mjs';
const esbuild=require('esbuild');
const R='/home/ubuntu/task-recovery/compact-list-20261113',B='/home/ubuntu/task-recovery/continued-20261112/static-candidate-tools/composition-stage';
const P='/home/ubuntu/work/51dianzi-platform';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(name,data)=>{const p=R+'/'+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');};
function patch(text,ps){ps.sort((a,b)=>a.start-b.start||a.end-b.end);let last=0;const partition=[];for(const p of ps){assert(p.start>=last&&text.slice(p.start,p.end)===p.before,'PATCH_CAS:'+p.label);partition.push({beforeStart:last,beforeEnd:p.start,bytes:p.start-last,sha256:sha(text.slice(last,p.start))});last=p.end;}partition.push({beforeStart:last,beforeEnd:text.length,bytes:text.length-last,sha256:sha(text.slice(last))});let result=text;for(const p of [...ps].reverse())result=result.slice(0,p.start)+p.after+result.slice(p.end);let delta=0;const inverse=ps.map(p=>{let start=p.start+delta;delta+=p.after.length-p.before.length;return{label:p.label,start,end:start+p.after.length,before:p.after,after:p.before};});let restored=result;for(const p of [...inverse].reverse()){assert(restored.slice(p.start,p.end)===p.before,'REVERSE_CAS');restored=restored.slice(0,p.start)+p.after+restored.slice(p.end);}assert(restored===text,'REVERSE_FULL_BYTES');let beforePos=0,afterPos=0;for(let i=0;i<ps.length;i++){const p=ps[i],len=p.start-beforePos;assert(result.slice(afterPos,afterPos+len)===text.slice(beforePos,p.start),'UNTOUCHED_PARTITION');afterPos+=len+p.after.length;beforePos=p.end;}assert(result.slice(afterPos)===text.slice(beforePos),'UNTOUCHED_TAIL');return{result,inverse,partition};}
function array(expr,msg){assert(expr&&ts.isArrayLiteralExpression(expr),msg);return expr.elements;}
function text(node,ast){assert(node,'MISSING_NODE');return node.getText(ast);}
function classSearchGroup(node,ast){const value=prop(props(node),'className');assert(value&&ts.isStringLiteral(value),'SEARCH_GROUP_CLASS');const original=text(node,ast);const at=value.getStart(ast)-node.getStart(ast);const cls='d51-compact-list-search-group'+(value.text.includes('customer-list-search-group')?' customer-list-search-group':'');const result=original.slice(0,at)+JSON.stringify(cls)+original.slice(at+text(value,ast).length);const oldAst=parse('const x='+original),newAst=parse('const x='+result);const norm=a=>a.text.replace(/className:\s*"[^"]*"/,'className:"__LAYOUT_ONLY__"');assert(norm(oldAst)===norm(newAst),'ONLY_SEARCH_GROUP_CLASS_CHANGED');return{original,result,change:{before:value.text,after:cls}};}
// Compile only the new pure shared component. Never bundle or execute a page/provider.
const sourceFile=P+'/client/src/components/ui/CompactListToolbar.tsx',cssFile=P+'/client/src/components/ui/CompactListToolbar.css';
const source=fs.readFileSync(sourceFile,'utf8'),css=fs.readFileSync(cssFile,'utf8');
const compiled=await esbuild.transform(source,{loader:'tsx',jsx:'automatic',target:'es2022',format:'esm',minify:false,legalComments:'none'});
const compAst=parse(compiled.code,'CompactListToolbar.js'),componentPatches=[];let runtimeNames=[];
for(const imp of compAst.statements.filter(ts.isImportDeclaration)){
 const spec=imp.moduleSpecifier.text;
 if(spec==='react/jsx-runtime'){
  assert(imp.importClause?.namedBindings&&ts.isNamedImports(imp.importClause.namedBindings),'JSX_NAMED_IMPORTS');
  runtimeNames=imp.importClause.namedBindings.elements.map(x=>({imported:x.propertyName?.text??x.name.text,local:x.name.text}));
  componentPatches.push({label:'bind existing actual JSX runtime',start:imp.getStart(compAst),end:imp.end,before:imp.getText(compAst),after:'import {j as __d51CompactJsx} from "/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-8jluR_FO.js";\nconst {'+runtimeNames.map(x=>x.imported+(x.local!==x.imported?':'+x.local:'')).join(',')+'}=__d51CompactJsx;'});
 }else if(spec==='./CompactListToolbar.css')componentPatches.push({label:'CSS separately linked with exact source bytes',start:imp.getStart(compAst),end:imp.end,before:imp.getText(compAst),after:''});
 else throw Error('PURE_COMPONENT_UNEXPECTED_IMPORT:'+spec);
}
assert(runtimeNames.length>0,'JSX_RUNTIME_IMPORT_REQUIRED');
const helperProof=patch(compiled.code,componentPatches),helper=helperProof.result;parse(helper);
assert(!/useEffect|useState|useQuery|fetch\(/.test(helper),'PURE_HELPER_NO_SIDE_EFFECTS');
const helperURL='/assets/CompactListToolbar-compact-'+sha(helper)+'.js',cssURL='/assets/compact-list-toolbar-'+sha(css)+'.css';
write('candidate'+helperURL,helper);write('candidate'+cssURL,css);
const rows=JSON.parse(fs.readFileSync(B+'/candidate-files.full.json','utf8'));
const selected=JSON.parse(fs.readFileSync(R+'/selected-runtime-locations.json','utf8'));
const files=rows.filter(x=>x.kind==='asset').map(x=>({url:'/'+x.targetRelative,text:fs.readFileSync(x.file,'utf8')}));
const replacements=new Map(),proofs=[],publishFiles=[{file:R+'/candidate'+helperURL,targetRelative:helperURL.slice(1),kind:'asset',sha256:sha(helper)},{file:R+'/candidate'+cssURL,targetRelative:cssURL.slice(1),kind:'asset',sha256:sha(css)}];
for(const row of selected){
 const title=row.url.includes('Staff-')?'员工与权限':row.url.includes('Merchants-')?'商户管理':'客户列表';
 const before=fs.readFileSync(row.file,'utf8'),ast=parse(before,row.url);
 const header=one(nodes(ast,n=>ts.isCallExpression(n)&&prop(props(n),'title')?.text===title),'HEADER_CALL:'+title);
 let parentArray=header.parent;while(parentArray&&!ts.isArrayLiteralExpression(parentArray))parentArray=parentArray.parent;
 assert(parentArray,'HEADER_TOP_CHILD_ARRAY');
 const moved=[],classChanges=[];let filter,filterChildren,actions,extra;
 if(title==='客户列表'){
  const actionArray=array(children(prop(props(header),'actions')),'CUSTOMER_HEADER_ACTIONS_ARRAY');assert(actionArray.length===2,'CUSTOMER_SCOPE_AND_CREATE_BUTTON');
  const scope=actionArray[0],create=actionArray[1];assert(ts.isConditionalExpression(scope),'CUSTOMER_SCOPE_ORIGINAL_CONDITIONAL');
  moved.push(scope,create);actions=text(create,ast);
  filter=one(parentArray.elements.filter(x=>ts.isCallExpression(x)&&prop(props(x),'className')?.text?.includes('customer-list-filters')),'CUSTOMER_FILTER');
  const groups=array(children(filter),'CUSTOMER_FILTER_GROUPS');assert(groups.length===2,'CUSTOMER_BASIC_AND_MORE');
  const basic=array(children(groups[0]),'CUSTOMER_BASIC_ELEMENTS');assert(basic.length===4,'CUSTOMER_SEARCH_GRADE_DUE_ACTIONS');
  const searchGroup=classSearchGroup(basic[0],ast);classChanges.push(searchGroup.change);
  filterChildren='['+[text(scope,ast),searchGroup.result,...basic.slice(1).map(x=>text(x,ast))].join(',')+']';
  extra=text(groups[1],ast);moved.push(...basic,...groups.slice(1));
 }else if(title==='商户管理'){
  filter=one(parentArray.elements.filter(x=>ts.isCallExpression(x)&&prop(props(x),'className')?.text==='mb-4'),'MERCHANT_FILTER_CARD');
  const content=children(filter),controls=array(children(content),'MERCHANT_FILTER_CONTROLS');assert(controls.length===5,'MERCHANT_SEARCH_DATE_OWNER_LOOKUP_RESET');
  const searchGroup=classSearchGroup(controls[0],ast);classChanges.push(searchGroup.change);
  actions=text(controls[3],ast);filterChildren='['+[searchGroup.result,text(controls[1],ast),text(controls[2],ast),text(controls[4],ast)].join(',')+']';moved.push(...controls);
 }else{
  filter=one(parentArray.elements.filter(x=>ts.isCallExpression(x)&&prop(props(x),'aria-label')?.text==='员工筛选'),'STAFF_FILTER_BAR');
  const controls=array(children(filter),'STAFF_INPUT_STATUS_ROLE');assert(controls.length===3,'STAFF_THREE_FILTERS');
  const originalActions=prop(props(header),'actions');actions=text(originalActions,ast);filterChildren=text(children(filter),ast);moved.push(originalActions,...controls);
 }
 const jsx=filter.expression.expression?.getText(ast);assert(jsx,'ACTUAL_JSX_ALIAS');
 const newFilter=jsx+'.jsx(__d51CompactListToolbar,{title:'+JSON.stringify(title)+',children:'+filterChildren+',actions:'+actions+(extra?',extra:'+extra:'')+'})';
 const importLine='import {CompactListToolbar as __d51CompactListToolbar} from '+JSON.stringify(helperURL)+';\n';
 assert(!nodes(ast,n=>ts.isIdentifier(n)&&n.text==='__d51CompactListToolbar').length,'NEW_IMPORT_ALIAS_COLLISION');
 const ps=[{label:'new shared pure toolbar import',start:0,end:0,before:'',after:importLine},{label:'remove redundant header row',start:header.getStart(ast),end:header.end,before:text(header,ast),after:'null'},{label:'merge original filters and actions in shared toolbar',start:filter.getStart(ast),end:filter.end,before:text(filter,ast),after:newFilter}];
 const result=patch(before,ps);const afterAst=parse(result.result,row.url);
 // All moved controls/conditions remain verbatim except the two explicit layout class strings.
 for(const node of moved){const fragment=text(node,ast);if(classChanges.length&&node===moved.find(x=>text(x,ast).includes('customer-list-search-group')||text(x,ast).includes('min-w-[240px]')))continue;assert(result.result.includes(fragment),'ORIGINAL_CONTROL_FRAGMENT_LOST:'+title);}
 const newToolbar=one(nodes(afterAst,n=>ts.isCallExpression(n)&&n.arguments[0]?.getText(afterAst)==='__d51CompactListToolbar'),'SINGLE_NEW_TOOLBAR');
 assert(prop(props(newToolbar),'title')?.text===title,'TOOLBAR_TITLE');
 const parentFunction=n=>{let p=n.parent;while(p&&!ts.isFunctionDeclaration(p))p=p.parent;return p;};
 const oldFunction=parentFunction(header),newFunction=parentFunction(newToolbar);assert(oldFunction?.name?.text===newFunction?.name?.text,'MOVED_WITHIN_SAME_FUNCTION');
 assert(before.slice(oldFunction.getStart(ast),header.getStart(ast))===result.result.slice(newFunction.getStart(afterAst),newFunction.getStart(afterAst)+(header.getStart(ast)-oldFunction.getStart(ast))),'FUNCTION_PREAMBLE_BYTE_EXACT');
 const newURL=row.url.replace(/\.js$/,'-compact-'+sha(result.result)+'.js');write('candidate'+newURL,result.result);replacements.set(row.url,newURL);files.push({url:newURL,text:result.result});publishFiles.push({file:R+'/candidate'+newURL,targetRelative:newURL.slice(1),kind:'asset',sha256:sha(result.result)});
 const proof={title,beforeURL:row.url,afterURL:newURL,beforeSha256:sha(before),afterSha256:sha(result.result),patches:ps,inverse:result.inverse,unaffectedPartitions:result.partition,forwardReverseFullBytes:true,allOriginalControlsAndConditionsRetained:true,searchGroupClassChanges:classChanges,onlySameFunctionReturnJSXRelocated:true,noBusinessPreambleChanged:true,newImportAliasAbsentEverywhereInOriginalAST:true,oldImportsExportsAndAllOtherFunctionsUnchanged:true,movedFragments:moved.map(x=>({start:x.getStart(ast),end:x.end,sha256:sha(text(x,ast))}))};proofs.push(proof);write('proofs/'+(title==='客户列表'?'customers':title==='商户管理'?'merchants':'staff')+'.json',proof);
}
files.push({url:helperURL,text:helper},{url:cssURL,text:css});
const html=fs.readFileSync(B+'/candidate/index.html','utf8'),inventory=htmlInventory(html);const relocated=relocateMap(inventory.map,replacements),mapProof=validateMapPreservation(inventory.map,relocated.map,replacements);
const mapText=JSON.stringify(relocated.map);const htmlPatches=[{label:'redirect only the three changed modules; preserve old keys and scopes',start:inventory.importmap.contentStart,end:inventory.importmap.contentStart+inventory.importmap.content.length,before:inventory.importmap.content,after:mapText}];
const head=html.indexOf('</head>');assert(head>=0&&html.indexOf('</head>',head+1)<0,'SINGLE_HEAD_END');htmlPatches.push({label:'append only new scoped CSS',start:head,end:head,before:'',after:'    <link rel="stylesheet" href="'+cssURL+'" data-compact-list-toolbar="20261113">\n'});
const htmlProof=patch(html,htmlPatches),newHTML=htmlProof.result,newInventory=htmlInventory(newHTML);
assert(newInventory.cssLinks.length===inventory.cssLinks.length+1,'ONE_CSS_LINK_ADDED');for(let i=0;i<inventory.cssLinks.length;i++)assert(inventory.cssLinks[i].text===newInventory.cssLinks[i].text,'ALL_PRIOR_CSS_LINK_BYTES_ORDER');
for(const item of selected){const parsed=parse(fs.readFileSync(item.file,'utf8'));for(const n of nodes(parsed,x=>(ts.isImportDeclaration(x)||ts.isExportDeclaration(x))&&x.moduleSpecifier||ts.isCallExpression(x)&&x.expression.kind===ts.SyntaxKind.ImportKeyword)){const spec=n.moduleSpecifier??n.arguments[0];if(spec&&ts.isStringLiteral(spec))mapProof.relocatedResolverCheck(spec.text,item.url,replacements.get(item.url));}}
write('candidate/index.html',newHTML);const closure=inspectStatic(newHTML,files);assert(closure.status==='PASS','STATIC_CLOSURE:'+JSON.stringify({missing:closure.missing,unknown:closure.unknownDynamicOrUnmapped}));
publishFiles.push({file:R+'/candidate/index.html',targetRelative:'index.html',kind:'html',sha256:sha(newHTML)});
write('files.static.json',publishFiles);write('static-closure.json',closure);write('html-proof.json',{beforeSha256:sha(html),afterSha256:sha(newHTML),patches:htmlPatches,inverse:htmlProof.inverse,unaffectedPartitions:htmlProof.partition,forwardReverseFullBytes:true,allPriorCSSLinksBytesAndOrderPreserved:true,importmapChanges:relocated.changes,relocatedScopes:relocated.relocatedScopes});
write('helper-proof.json',{sourceFile,sourceSha256:sha(source),cssFile,cssSourceSha256:sha(css),compilerOptions:{loader:'tsx',jsx:'automatic',target:'es2022',format:'esm',minify:false},compiledSha256:sha(compiled.code),runtimeSha256:sha(helper),runtimeBindings:runtimeNames,sourceCompiledBodyUnchanged:true,onlyActualJSXRuntimeAndCSSLinkAdapted:true});
write('build-summary.json',{status:'PASS-COMPACT-LIST-STATIC-INCREMENT',htmlBeforeSha256:sha(html),htmlAfterSha256:sha(newHTML),moduleCount:3,sharedHelper:helperURL,scopedCSS:cssURL,publishFileCount:publishFiles.length,allPreviousStaticFilesKept:true,onlyReturnLayoutChanged:true,apiOrWorkerChanged:false,productionModified:false,proofs:proofs.map(x=>({title:x.title,beforeURL:x.beforeURL,afterURL:x.afterURL,beforeSha256:x.beforeSha256,afterSha256:x.afterSha256}))});
console.log(JSON.stringify({status:'PASS-COMPACT-LIST-STATIC-INCREMENT',htmlSha256:sha(newHTML),publishFiles:publishFiles.length,closureFiles:files.length}));
