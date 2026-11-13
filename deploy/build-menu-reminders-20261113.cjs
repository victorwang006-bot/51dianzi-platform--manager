const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const ts=require('typescript'),esbuild=require('esbuild');
const REPO='/home/ubuntu/work/51dianzi-platform--manager',BASE='/home/ubuntu/work/menu-production-baseline',OUT='/home/ubuntu/work/menu-candidate';
fs.mkdirSync(OUT,{recursive:true});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const parse=(s,name='x.js')=>{const a=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,name);return a;};
function nodes(a,p){let o=[];function v(n){if(p(n))o.push(n);n.forEachChild(v)}v(a);return o;}
function one(a,p,label){const n=nodes(a,p);assert.equal(n.length,1,label);return n[0];}
(async()=>{
 const urls=JSON.parse(fs.readFileSync(BASE+'/selected-urls.json'));const url=urls.find(x=>x.includes('DashboardLayout'));assert(url);
 const before=fs.readFileSync(BASE+url,'utf8'),a=parse(before);const cap=one(a,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='__admin_workbench_nav_v1','nav capsule');
 const sourcePath=REPO+'/client/src/components/admin/AdminWorkspaceNavigation.tsx',source=fs.readFileSync(sourcePath,'utf8');
 const compiled=(await esbuild.transform(source,{loader:'tsx',jsx:'automatic',target:'es2020'})).code,sa=parse(compiled);
 const names={WorkspaceTabs:'Ee',AdminWorkspaceLocation:'Ve',getAdminWorkspaceNavigationState:'te',groupAdminBusinessNavigationItems:'pe',groupAdminOperationsNavigationItems:'me',groupAdminWorkspaceModuleNavigationItems:'ge',handleNavigationKeys:'Ne',BEIJING_TIME_ZONE:'ke',CHANNEL_INVENTORY_ROUTE:'O',CHANNEL_INVENTORY_TABS:'Q',channelTabForLocation:'xe',channelViewForLocation:'__inventory_channelViewForLocation',getAdminListLocationLayout:'__d51ListLocationLayout',WORKSPACE_PANEL_WIDTH:'re',HOVER_CLOSE_DELAY:'Ue',ADMIN_SYSTEM_RELEASE:'fe',jsx:'b',jsxs:'I'};
 for(const n of Object.values(names).filter(x=>!['b','I','ke','O','Q','re','Ue','fe','__d51ListLocationLayout'].includes(x)))assert(nodes(cap,x=>ts.isFunctionDeclaration(x)&&x.name?.text===n).length>=1,'captured helper '+n);
 const patches=[];
 function patch(node,after,reason){patches.push({start:node.getStart(a),end:node.end,before:node.getText(a),after,reason,sourceSha256:sha(source)});}
 for(const name of ['WorkspaceTabs','AdminWorkspaceLocation']){
  const src=one(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,'source '+name);const target=one(cap,n=>ts.isFunctionDeclaration(n)&&n.name?.text===names[name],'target '+name);
  const transform=ts.transform(src,[ctx=>root=>ts.visitNode(root,function visit(n){
   // The actual production Layout already owns the lazy scoped inquiry badge;
   // retain that exact parent renderBadge path instead of introducing a second cache.
   if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['jsx','jsxs'].includes(n.expression.text)&&n.arguments[0]?.getText(sa)==='InquiryReceptionNavigationBadge')return ts.factory.createCallChain(ts.factory.createIdentifier('renderBadge'),ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),undefined,[ts.factory.createIdentifier('receptionItem')]);
   if(ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)){
    if(['useEffect','useId','useRef','useState'].includes(n.text))return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('d'),n.text);
    if(names[n.text])return ts.factory.createIdentifier(names[n.text]);
   }
   return ts.visitEachChild(n,visit,ctx);
  })]);
  const generated=ts.createPrinter().printNode(ts.EmitHint.Unspecified,transform.transformed[0],sa).replace(/^export\s+/,'');transform.dispose();
  const minified=(await esbuild.transform(generated,{loader:'js',target:'es2020',minifyWhitespace:true,minifySyntax:true})).code.trim();assert(!minified.includes('InquiryReceptionNavigationBadge'));patch(target,minified,'source-bound navigation '+name);
 }
 const release=one(cap,n=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='fe','release');assert.equal(release.initializer.text,'20261103-channel-permission-owner-v13-a2');patch(release.initializer,JSON.stringify('20261113-primary-menu-reminders-v1'),'navigation release');
 // Notification owner fields are patched separately, never recompile DashboardLayout.
 const extraFile=OUT+'/layout-extra-patches.json';if(fs.existsSync(extraFile)){
  const extra=JSON.parse(fs.readFileSync(extraFile));for(const p of extra){assert.equal(before.slice(p.start,p.end),p.before,p.reason);patches.push(p);}
 }
 patches.sort((x,y)=>x.start-y.start);for(let i=1;i<patches.length;i++)assert(patches[i].start>=patches[i-1].end,'non-overlap');
 let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);parse(after,'candidate.js');
 let offset=0;for(const p of patches){p.afterStart=p.start+offset;p.afterEnd=p.afterStart+p.after.length;offset+=p.after.length-p.before.length;}
 let inverse=after;for(const p of [...patches].reverse())inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);assert.equal(inverse,before,'exact inverse and untouched partitions');
 const newUrl='/assets/DashboardLayout-primary-menu-reminders-'+sha(after)+'.js';fs.mkdirSync(OUT+'/assets',{recursive:true});fs.writeFileSync(OUT+newUrl,after);fs.writeFileSync(OUT+'/layout-patches.json',JSON.stringify(patches,null,2)+'\n');
 const css='/* approved primary-menu-reminders-20261113: navigation only */\n[data-admin-navigation="unified-dropdown"].admin-workspace-nav__tabs--workspaces{gap:clamp(8px,1vw,14px)}\n@media(max-width:700px){[data-admin-navigation="unified-dropdown"].admin-workspace-nav__tabs--workspaces{gap:10px}}\n';
 assert(fs.readFileSync(REPO+'/client/src/components/admin/AdminWorkspaceNavigation.css','utf8').includes('gap: clamp(8px, 1vw, 14px)'));
 const cssUrl='/assets/admin-primary-menu-reminders-'+sha(css)+'.css';fs.writeFileSync(OUT+cssUrl,css);
 const result={beforeUrl:url,url:newUrl,beforeSha256:sha(before),sha256:sha(after),cssUrl,cssSha256:sha(css),patches:patches.length,exactInverse:true,allNonpatchBytesUnchanged:true,sourcePath,sourceSha256:sha(source)};
 fs.writeFileSync(OUT+'/layout-build-proof.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});
