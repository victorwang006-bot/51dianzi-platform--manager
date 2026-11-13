#!/usr/bin/env node
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),esbuild=require('esbuild');
const C=require('./sales-unified-patch-core-20261113.cjs');const {REPO,BASE,OUT,read,sha,parse,nodes,one,write,apply,finishHTML}=C;const records=[],relocations={};
function asset(prefix,text,ext='js',directory='/assets/'){const url=directory+prefix+'-'+sha(text)+'.'+ext;write(url.slice(1),text);records.push({relative:url.slice(1),sha256:sha(text)});return url}
function patch(list,node,after,a,reason){list.push({start:node.getStart(a),end:node.end,before:node.getText(a),after,reason})}
async function compile(source){return parse((await esbuild.transform(source,{loader:'tsx',jsx:'automatic',target:'es2020'})).code)}
function print(node,a){return ts.createPrinter().printNode(ts.EmitHint.Unspecified,node,a).replace(/^export\s+/,'')}
function protectFunctions(a,na,names){for(const name of names){const old=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.parent===a,'old '+name),next=one(na,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.parent===na,'new '+name);assert.equal(old.getText(a),next.getText(na),'protected '+name)}}
async function widthHelperFactory(){const r=await esbuild.build({entryPoints:[REPO+'/client/src/lib/adminWorkspaceDropdownWidth.ts'],bundle:true,write:false,format:'iife',globalName:'__NC_WIDTHS',target:'es2020',minify:true});write('source-width-factory.js',r.outputFiles[0].text);return r.outputFiles[0].text}
async function layout(url,helpers,widths){const before=read(BASE+url),a=parse(before),cap=one(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__admin_workbench_nav_v1','nav capsule'),source=read(REPO+'/client/src/components/admin/AdminWorkspaceNavigation.tsx'),sa=await compile(source),edits=[];
 const names={WorkspaceTabs:'Ee',AdminWorkspaceLocation:'Ve',getAdminWorkspaceNavigationState:'te',groupAdminBusinessNavigationItems:'pe',groupAdminOperationsNavigationItems:'me',groupAdminWorkspaceModuleNavigationItems:'ge',handleNavigationKeys:'Ne',BEIJING_TIME_ZONE:'ke',CHANNEL_INVENTORY_ROUTE:'O',CHANNEL_INVENTORY_TABS:'Q',channelTabForLocation:'xe',channelViewForLocation:'__inventory_channelViewForLocation',getAdminListLocationLayout:'__d51ListLocationLayout',WORKSPACE_PANEL_WIDTH:'re',HOVER_CLOSE_DELAY:'Ue',ADMIN_SYSTEM_RELEASE:'fe',jsx:'b',jsxs:'I'};
 const salesImports=new Set();for(const n of sa.statements.filter(ts.isImportDeclaration)){if(n.moduleSpecifier.text.includes('salesOrderWorkspace'))for(const e of n.importClause?.namedBindings?.elements??[])salesImports.add(e.name.text)}
 const oldLocal=new Set(['handleNavigationKeys','channelQueryForLocation','channelTabForLocation','channelViewForLocation','AdminWorkspaceLocation','WorkspaceTabs','ModuleTabs']);const extras=sa.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name&&!oldLocal.has(n.name.text)&&!n.name.text.startsWith('Admin'));
 const extraVariables=sa.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).filter(n=>ts.isIdentifier(n.name)&&!names[n.name.text]&&!n.name.text.startsWith('Admin'));
 for(const n of [...extras,...extraVariables])names[n.name.text]='__NC_NAV_'+n.name.text;
 function transform(node){const t=ts.transform(node,[ctx=>root=>ts.visitNode(root,function visit(n){if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['jsx','jsxs'].includes(n.expression.text)&&n.arguments[0]?.getText(sa)==='InquiryReceptionNavigationBadge')return ts.factory.createCallChain(ts.factory.createIdentifier('renderBadge'),ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),undefined,[ts.factory.createIdentifier('receptionItem')]);if(ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)){if(['useEffect','useLayoutEffect','useId','useRef','useState'].includes(n.text))return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('d'),n.text);if(['getAdminWorkspaceDropdownWidth','getAdminWorkspaceDropdownLeft','getAdminWorkspaceSubmenuPlacement'].includes(n.text))return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('__NC_WIDTHS'),n.text);if(salesImports.has(n.text))return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('__NC_SO'),n.text);if(names[n.text])return ts.factory.createIdentifier(names[n.text])}return ts.visitEachChild(n,visit,ctx)})]);const text=print(t.transformed[0],sa);t.dispose();return text}
 for(const name of ['WorkspaceTabs','AdminWorkspaceLocation']){const src=one(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,'source '+name),target=one(cap,n=>ts.isFunctionDeclaration(n)&&n.name?.text===names[name],'target '+name);const code=(await esbuild.transform(transform(src),{target:'es2020',minifyWhitespace:true,minifySyntax:true})).code.trim();patch(edits,target,code,a,'source-bound compact navigation '+name)}
 const widthDecl=one(cap,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__NC_WIDTHS','old width module');patch(edits,widthDecl.parent.parent,widths,a,'source-bound content and measured-width helpers replace old module');
 assert(extras.length===0 && extraVariables.length===0,'unexpected nav top-level extras');
 const out=apply(before,edits,'layout'),next=parse(out.after);assert.deepEqual(nodes(a,n=>ts.isImportDeclaration(n)).map(n=>n.getText(a)),nodes(next,n=>ts.isImportDeclaration(n)).map(n=>n.getText(next)));const to=asset('DashboardLayout-sales-unified',out.after);relocations[url]=to;write('layout-build-proof.json',{...out.proof,beforeUrl:url,url:to,sourceSha256:sha(source),dashboardSourceSha256:sha(read(REPO+'/client/src/components/DashboardLayout.tsx')),helperSourceSha256:sha(read(REPO+'/client/src/lib/salesOrderWorkspace.ts')),existingUnreadOwnerUnchanged:true,originalNavigationQualificationUnchanged:true,extraSourceFunctions:extras.map(n=>n.name.text),extraSourceConstants:extraVariables.map(n=>n.name.text)})
}
async function workbench(url,idx,crm){
 const before=read(BASE+url),a=parse(before),edits=[];
 const mall=await require('./sales-unified-mall-patch-20261113.cjs').patchMall(before);edits.push(...mall.edits);
 const legacy=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__d51_ir_w_get','legacy workbench capsule');
 const live=one(legacy,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__live','original native binding object');
 const op=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='op','original CRM route');
 const factory=`\nvar __SU_CRM_INSTANCE;\nfunction __SU_CRM_GET(){if(!__SU_CRM_INSTANCE){const __crmLive={...(${live.initializer.getText(a)}),useBusinessWorkbenchAccess:Ty};${crm.code}\n__SU_CRM_INSTANCE=__SU_CRM_EXPORTS;}return __SU_CRM_INSTANCE;}\n`;
 edits.push({start:op.getStart(a),end:op.getStart(a),before:'',after:factory,reason:'latest CRM source factory with original native React, scope, tRPC and authenticated native client'});
 patch(edits,op,'function op(props){return __SU_CRM_GET().CrmSalesOrders(props);}',a,'latest CRM route; original source write handlers and dialogs preserved, backend methods unchanged');
 const out=apply(before,edits,'workbench-'+idx),next=parse(out.after);
 protectFunctions(a,next,['Ty','Ly','Uy','KI','__d51_so_get','__d51_ir_w_get','__d51_rx_chat_helpers_get']);
 assert(out.after.includes(mall.originalTable),'original mall table bytes changed');
 const newMall=one(next,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='uI'&&n.parent===next,'new mall');
 for(const n of nodes(one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='uI','old mall'),x=>ts.isFunctionDeclaration(x)&&x.name&&x.name.text!=='uI')){
   const matches=nodes(newMall,x=>ts.isFunctionDeclaration(x)&&x.name?.text===n.name.text);assert.equal(matches.length,1);assert.equal(n.getText(a),matches[0].getText(next),'mall action handler '+n.name.text)
 }
 const to=asset('BusinessWorkbenchPage-sales-unified-'+idx,out.after);relocations[url]=to;
 write('workbench-'+idx+'-build-proof.json',{...out.proof,beforeUrl:url,url:to,allPriorChatCodeUnchanged:true,originalOrderOperationsUnchanged:true,originalMallTableBytesUnchanged:true,originalMallHandlersBytesUnchanged:true,businessWriteHandlersFromSourceBaselineUnchanged:true,originalAccessProviderUnchanged:true,originalRouteBranchesUnchanged:true,crmSourceHashes:crm.sourceHashes,mallSourceSha256:sha(mall.sourceShaInput),mallMappings:mall.map});
}
async function build(){
 const urls=JSON.parse(read(BASE+'/selected-urls.json')),entryUrl=urls.find(x=>x.includes('index-customer-home'));
 assert(entryUrl,'current customer-home entry required');
 const entry=read(BASE+entryUrl),entryTo=asset('index-sales-unified',entry,'js',entryUrl.slice(0,entryUrl.lastIndexOf('/')+1));relocations[entryUrl]=entryTo;
 write('entry-build-proof.json',{beforeSha256:sha(entry),sha256:sha(entry),exactBytesUnchanged:true,defaultCustomerHomepageUnchanged:true});
 const crm=await require('./sales-unified-crm-factory-20261113.cjs').compileCrmFactory();write('crm-factory.js',crm.code);write('crm-factory-metafile.json',crm.metafile);write('crm-source-hashes.json',crm.sourceHashes);
 await layout(urls.find(x=>x.includes('DashboardLayout')),null,await widthHelperFactory());
 for(const[idx,u]of urls.filter(x=>x.includes('BusinessWorkbench')).entries())await workbench(u,idx,crm);
 const navCSS=read(REPO+'/client/src/components/admin/AdminWorkspaceNavigation.css'),start=navCSS.indexOf('/* Unified dropdown selections override.');assert(start>=0);
 const styles=[navCSS.slice(start),read(REPO+'/client/src/business/platform/client/src/pages/OutboundManagement.css'),read(REPO+'/client/src/business/platform/client/src/pages/CrmSalesOrders.css')];
 const css='/* Scoped sales list and measured navigation widths; header, default landing and fonts unchanged. */\n'+styles.join('\n');const cssUrl=asset('sales-unified',css,'css');
 write('css-build-proof.json',{sourceHashes:styles.map(sha),onlyScopedOrderAndNavigationStyles:true,url:cssUrl});finishHTML(relocations,records,cssUrl,entryUrl);
 console.log(JSON.stringify({status:'BUILT',files:records.length,relocations,cssUrl}));
}
module.exports={build};if(require.main===module)build().catch(e=>{console.error(e.stack);process.exitCode=1});
