#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const LIVE='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/live';
const OUT='/home/ubuntu/task-recovery/inquiry-reception-release-20261113/admin-static';
const REPO='/home/ubuntu/work/manager';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const assert=(v,m)=>{if(!v)throw new Error(m)};
const write=(f,o)=>{const p=path.join(OUT,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof o==='string'?o:JSON.stringify(o,null,2)+'\n')};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);
const html=fs.readFileSync(LIVE+'/admin-index.html','utf8');
const maps=[...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)];
assert(maps.length===1,'SINGLE_IMPORTMAP');
const map=JSON.parse(maps[0][1]);
const files=walk(LIVE+'/admin-static').map(f=>({file:f,url:f.slice((LIVE+'/admin-static').length),sha256:sha(fs.readFileSync(f))}));
const byURL=new Map(files.map(f=>[f.url,f]));
const sections=[['imports',map.imports],...Object.entries(map.scopes??{})];
const targets=sections.flatMap(([scope,imports])=>Object.entries(imports).filter(([key,target])=>/BusinessWorkbenchPage|DashboardLayout/.test(key+target)).map(([key,target])=>({scope,key,target})));
const selected=[...new Set(targets.map(x=>x.target))];
assert(selected.filter(x=>x.includes('BusinessWorkbenchPage')).length===2,'TWO_ACTUAL_WORKBENCH_TARGETS');
assert(selected.filter(x=>x.includes('DashboardLayout')).length===1,'SINGLE_ACTUAL_LAYOUT_TARGET');
function parse(s,f='asset.js'){const a=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert(!a.parseDiagnostics.length,'PARSE:'+f);return a}
function nodes(a,p){let r=[];function visit(n){if(p(n))r.push(n);n.forEachChild(visit)}visit(a);return r}
function prop(n,name){return n.arguments?.[1]?.properties?.find(p=>ts.isPropertyAssignment(p)&&p.name.getText().replace(/^['"]|['"]$/g,'')===name)?.initializer}
const runtime=[];
for(const url of selected){const f=byURL.get(url);assert(f,'CAPTURE_MISSING:'+url);const text=fs.readFileSync(f.file,'utf8'),ast=parse(text,url);const funcs=ast.statements.filter(ts.isFunctionDeclaration);const fn=n=>{const x=funcs.find(x=>x.name?.text===n);return x?{name:n,start:x.getStart(ast),end:x.end,sha256:sha(x.getText(ast)),text:x.getText(ast)}:null};
 if(url.includes('BusinessWorkbench')){
  const scope=fn('Oy'),hook=fn('Qa'),chat=fn('Av'),content=fn('Po');
  const routes=fn('VI');const entries=nodes(ast,n=>ts.isCallExpression(n)&&prop(n,'path')).filter(n=>n.getStart(ast)>=routes.start&&n.end<=routes.end).map(n=>({path:prop(n,'path').text,component:prop(n,'component')?.getText(ast)}));
  runtime.push({url,file:f.file,sha256:f.sha256,reactBinding:'c',jsxBinding:'e',domainTrpcBinding:'H',bootstrapTrpcBinding:'oi',queryClientProviderBinding:'li',businessScopeHook:hook,scopeProvider:scope,chatWrapper:chat,chatContent:content&&{name:content.name,start:content.start,end:content.end,sha256:content.sha256,hasReceptionConversation:content.text.includes('receptionConversation'),hasEmbeddedReceptionClass:content.text.includes('inquiry-reception__embedded-chat'),hasScopedReadOnlyMessage:content.text.includes('当前企业范围仅可查看接待'),hasMarkRead:content.text.includes('.markRead.useMutation'),hasMessageQuery:content.text.includes('.getMessages.useQuery')},routes:entries,scopeHasStorageOwner:scope.text.includes('storageOwner'),scopeHasOwnerMap:scope.text.includes('storageScopeOwners'),unmounts:funcs.filter(n=>/BusinessWorkbenchPage.tsx/.test(n.getText(ast))&&/cancelQueries/.test(n.getText(ast))).map(n=>({name:n.name.text,sha256:sha(n.getText(ast)),unconditionalCleanup:/useEffect\(\(\)=>\(\)=>\{\w+\.cancelQueries\(\)\}/.test(n.getText(ast))})),hasReceptionObserver:text.includes('receptionObserver'),hasReceptionNavBadgeExport:ast.statements.filter(ts.isExportDeclaration).some(n=>n.getText(ast).includes('BusinessReceptionNavigationBadge')),compactToolbarPreserved:text.includes('CompactListToolbar-compact-'),originalImports:ast.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ast)),originalExports:ast.statements.filter(ts.isExportDeclaration).map(n=>n.getText(ast))});
 }else runtime.push({url,file:f.file,sha256:f.sha256,hasInventoryNavFactory:text.includes('__admin_workbench_nav_v1'),hasLocationPatch:text.includes('__d51ListLocationLayout'),hasReceptionPrimaryRoute:text.includes('/workbench/inquiries'),imports:ast.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ast))});
}
const origin='https://offline.invalid';
const canonical=(s,ref)=>{try{const u=new URL(s,origin+ref);return u.origin===origin?u.pathname+u.search:u.href}catch{return s}};
function mapped(spec,ref){const key=spec.startsWith('.')||spec.startsWith('/')?canonical(spec,ref):spec;const sections=Object.keys(map.scopes??{}).filter(scope=>ref.startsWith(scope)).sort((a,b)=>b.length-a.length).map(s=>map.scopes[s]);sections.push(map.imports??{});for(const section of sections){if(Object.hasOwn(section,key))return section[key];for(const p of Object.keys(section).filter(k=>k.endsWith('/')&&key.startsWith(k)).sort((a,b)=>b.length-a.length))return section[p]+key.slice(p.length)}return key}
const rootSpecs=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)].map(m=>m[1]);
const roots=rootSpecs.map(s=>mapped(s,'/index.html')).filter(s=>s.startsWith('/'));
const queue=[...roots],visited=new Set(),edges=[],missing=[],unknown=[];
while(queue.length){const url=queue.shift();if(visited.has(url))continue;visited.add(url);const f=byURL.get(url);if(!f){missing.push({url,reason:'root or import missing captured file'});continue}if(!url.endsWith('.js'))continue;const a=parse(fs.readFileSync(f.file,'utf8'),url);
 for(const n of nodes(a,n=>(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier||ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)){const s=n.moduleSpecifier??n.arguments[0];if(!s||!ts.isStringLiteral(s)){unknown.push({ref:url,start:n.getStart(a),expression:n.getText(a).slice(0,200)});continue}const target=mapped(s.text,url);edges.push({ref:url,spec:s.text,target});if(target.startsWith('/'))queue.push(target);else if(!/^https?:/.test(target))unknown.push({ref:url,spec:s.text,target})}
}
const closure={status:missing.length||unknown.length?'BLOCKED':'PASS',roots,visitedCount:visited.size,edges,missing,unknown};
closure.proofScope='Root-driven AST literal static import/export and literal dynamic import resolution only; this is the unchanged baseline, not a candidate proof. CSS url(), Vite preload strings, DOM-inserted resource strings and actual browser/runtime behavior are not certified.';
const sources=['client/src/business/BusinessScope.tsx','client/src/business/BusinessWorkbenchSession.ts','client/src/business/BusinessWorkbenchPage.tsx','client/src/business/InquiryReception.tsx','client/src/business/useInquiryReception.ts','client/src/business/platform/client/src/pages/ChatPage.tsx','client/src/components/OfficialInventoryReception.tsx','client/src/pages/OfficialChannelInventory.tsx','client/src/components/DashboardLayout.tsx'].map(p=>({file:REPO+'/'+p,sha256:sha(fs.readFileSync(REPO+'/'+p))}));
const official=[];
for(const f of files.filter(f=>f.url.endsWith('.js'))){const text=fs.readFileSync(f.file,'utf8');if(!text.includes('client/src/pages/OfficialChannelInventory.tsx'))continue;const a=parse(text,f.url);official.push({url:f.url,sha256:f.sha256,functions:a.statements.filter(ts.isFunctionDeclaration).filter(n=>n.getText(a).includes('client/src/pages/OfficialChannelInventory.tsx')).map(n=>({name:n.name.text,start:n.getStart(a),end:n.end,sha256:sha(n.getText(a))})),hasReceptionConfiguration:text.includes('工厂库存询价接待配置'),hasReceptionPreview:text.includes('getReception'),hasConfigureReception:text.includes('configureReception'),reactImport: a.statements.filter(ts.isImportDeclaration).map(n=>n.getText(a)).filter(s=>/index-/.test(s)).slice(0,2)})}
const blockers=[
 '两个现网工作台的原 ChatPageContent 都未落实 receptionConversation 三栏嵌入/范围只读改造。仅将新版 InquiryReception 包装在旧 ChatPage 上不能满足原会话、只读回复、readmark 语义证明；必须精确编译/补丁该函数及依赖，再运行实际 compiled renderer。',
 '现网 ScopeProvider 仍无 storageOwner/owner-map/proof-generation，且工作台多个 consumer 的 useEffect 仍无条件 cancelQueries；新导航 observer 若直接挂载会发布/清空全局草稿 identity，并取消同一 QueryClient 的页面读取。不能只补新组件或通过源码 DI 将其宣称落地。',
 '尚未完成两个工作台词法镜像与官方模块的全部 singleton bridge binding 审计；不得跨镜像复用主站或第二份 React/tRPC/Context/QueryClient。',
 '尚未构造并验证 primary inquiry nav、badge、官方 reception 配置和 publish preview 的精确局部补丁；原函数反向全 bytes、非补丁 partition、导入映射重定位 resolution 及实际 compiled renderer/readmark 权限测试均未完成。'
];
blockers.push('已定位真实官方模块 /assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/OfficialChannelInventory-BFbCN9vt.js，其 La/Nn 函数仍没有 getReception/configureReception 或配置 UI。需要在原 La 内增加接待配置与发布预览的局部补丁，而不是重建整个官方频道页面。');
if(closure.status!=='PASS')blockers.push('现网捕获静态闭包自身存在 missing/unknown；见 baseline-static-closure.json。');
write('files.admin-static.json',[]);
write('baseline-static-closure.json',closure);
write('baseline-runtime-audit.json',{offlineOnly:true,publishable:false,beforeHtmlSha256:sha(html),capturedAssetCount:files.length,selectedTargets:targets,runtime,official,sources,blockers,scopeLimits:{ssh:false,database:false,browser:false,git:false,deployment:false,sourceModified:false}});
write('baseline-files.sha256.json',files);
write('admin-static-build-report.md',`# Admin static 精确增量：BLOCKED（不可发布）\n\n本任务仅进行了离线取证与静态检查，没有运行 SSH、数据库、浏览器、Git 或真实部署，没有改动 app 源码，也没有以标准 Vite 整包覆盖现网。\n\n## 实际基线\n\nHTML SHA-256：\`${sha(html)}\`。已捕获 ${files.length} 个后台静态文件。以现网 HTML importmap 实际值选取 1 个 DashboardLayout 和 2 个并存 BusinessWorkbenchPage，保留它们 compact/location 原工厂取证。\n\n${selected.map(u=>'- `'+u+'`').join('\n')}\n\n基线静态闭包结果：**${closure.status}**，追踪 ${visited.size} 个模块，${edges.length} 条依赖边，缺失 ${missing.length}，未知动态 import ${unknown.length}。此结果只是未改动基线的闭包检查，不是新版候选 PASS。\n\n## 明确阻断\n\n${blockers.map((s,i)=>`${i+1}. ${s}`).join('\n\n')}\n\n## 发布清单\n\n\`files.admin-static.json\` 为 **空数组**。不存在获准发布的新 asset 或 HTML，不得上传本目录中的审计 JSON/Markdown 作为静态业务增量，不得使用它们推导上线批准。\n\n## 下一步的严格证明门槛\n\n必须针对两个实际镜像分别保留 React c、JSX e、domain tRPC H、bootstrap tRPC oi、原 QueryClientProvider li、原 BusinessScope Context/hook/provider、session store 与原聊天模块的词法绑定，并针对官方模块使用其自身后台 runtime；验证全部绑定来自真实 AST，而不是猜导出名。\n\n每个原函数补丁需要保存 before bytes、CAS forward/inverse、完整反向恢复、非补丁 partition 哈希；原 import/export 共享 binding 正确且无重复 singleton。HTML 所有旧 keys/scopes/order 保留，仅定向改值并复制精确 relocation scopes，验证旧 resolution 在新 referrer 下相等。最终新闭包必须 PASS，实际 compiled renderer 必须检查三栏、原 conversation、只读回复、监督不 markRead、导航 badge 同缓存及最后 consumer 才取消 query。\n\n旧 Customers/Merchants/Staff、商城导航、频道页及旧 route 不能以新版入口替换，compact/location 补丁必须保留。本次未生成候选，所以其原字节未发生改动；不能把这种“未改动”误述为候选保留证明。\n\n详尽证据：\`baseline-runtime-audit.json\`、\`baseline-static-closure.json\`、\`baseline-files.sha256.json\`。\n`);
console.log(JSON.stringify({status:'BLOCKED',publishable:false,output:OUT,assets:files.length,selected: selected.length,baselineClosure:closure.status,missing:missing.length,unknown:unknown.length}));
