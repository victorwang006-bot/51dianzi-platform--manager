#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const W='/home/ubuntu/work/admin-polish-release-20261121-2257', R='/home/ubuntu/work/channel-release-20261121-1837/manager', O=W+'/pages-candidate';
const require=createRequire(R+'/package.json'),ts=require('typescript'),esbuild=require('esbuild');
const H=x=>crypto.createHash('sha256').update(x).digest('hex'),read=x=>fs.readFileSync(x,'utf8');
const parse=(s,file='native.js')=>{const a=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0,'syntax '+file);return a;};
const nodes=(a,p)=>{const out=[];function v(n){if(p(n))out.push(n);ts.forEachChild(n,v);}v(a);return out;};
const one=(xs,label)=>{assert.equal(xs.length,1,'unique AST '+label);return xs[0];};
const prop=(o,key)=>o.properties.find(p=>ts.isPropertyAssignment(p)&&(p.name.text===key));
const vars=f=>nodes(f,n=>ts.isVariableDeclaration(n));
const named=(a,f,key)=>one(vars(f).filter(n=>n.name.getText(a)===key),'declaration '+key);
const expr=s=>{const n=parse('const __expr=('+s+');').statements[0].declarationList.declarations[0].initializer.expression;function synth(x){ts.setTextRange(x,{pos:-1,end:-1});ts.forEachChild(x,synth);}synth(n);return n;};
const printer=ts.createPrinter({removeComments:true});
function mapped(node,a,map){
 const result=ts.transform(node,[context=>root=>{const visit=n=>{
  if(ts.isShorthandPropertyAssignment(n)&&map[n.name.text])return ts.factory.createPropertyAssignment(n.name,expr(map[n.name.text]));
  if(ts.isIdentifier(n)&&map[n.text]){
   const p=n.parent;
   if((ts.isPropertyAccessExpression(p)&&p.name===n)||((ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p))&&p.name===n))return n;
   return expr(map[n.text]);
  }
  return ts.visitEachChild(n,visit,context);
 };return ts.visitNode(root,visit);}]);
 const out=printer.printNode(ts.EmitHint.Unspecified,result.transformed[0],a);result.dispose();return out;
}
function freeNames(code){
 const name='/__admin_polish_virtual__.js',options={allowJs:true,noEmit:true,target:ts.ScriptTarget.ES2022},host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
 host.getSourceFile=(f,l,e,n)=>f===name?ts.createSourceFile(f,code,l,true,ts.ScriptKind.JS):original(f,l,e,n);
 const program=ts.createProgram([name],options,host),a=program.getSourceFile(name),checker=program.getTypeChecker();
 return new Set(nodes(a,n=>ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!((ts.isPropertyAssignment(n.parent)||ts.isMethodDeclaration(n.parent))&&n.parent.name===n)&&!checker.getSymbolAtLocation(n)).map(n=>n.text));
}
function apply(before,patches){
 patches.sort((a,b)=>a.start-b.start||a.end-b.end);let end=-1,shift=0;
 for(const p of patches){assert(p.start>=end,'no overlapping source slots');end=p.end;assert.equal(before.slice(p.start,p.end),p.before);assert.notEqual(p.before,p.after);p.afterStart=p.start+shift;p.afterEnd=p.afterStart+p.after.length;shift+=p.after.length-p.before.length;}
 let after=before;for(const p of [...patches].reverse())after=after.slice(0,p.start)+p.after+after.slice(p.end);
 let inverse=after;for(const p of [...patches].reverse()){assert.equal(inverse.slice(p.afterStart,p.afterEnd),p.after);inverse=inverse.slice(0,p.afterStart)+p.before+inverse.slice(p.afterEnd);}
 assert(Buffer.from(inverse).equals(Buffer.from(before)),'whole file inverse exact UTF8 bytes');parse(after);return after;
}
const files=JSON.parse(read(W+'/capture/effective-files.json'));
const sourceFiles={CustomerList:R+'/client/src/business/platform/client/src/pages/CustomerList.tsx',CustomerDetail:R+'/client/src/business/platform/client/src/pages/CustomerDetail.tsx',NewInformation:R+'/client/src/lib/adminNewInformation.tsx',Badge:R+'/client/src/components/admin/AdminNewInformationBadge.tsx'};
const sourcePins=Object.fromEntries(Object.values(sourceFiles).map(f=>[f,H(fs.readFileSync(f))]));
const sources={};
for(const key of ['CustomerList','CustomerDetail']){const {code}=await esbuild.transform(read(sourceFiles[key]),{loader:'tsx',jsx:'automatic',format:'esm',target:'es2020',minify:false,legalComments:'none'});sources[key]={a:parse(code,key+'.js'),code};}
const listSource=sources.CustomerList,detailSource=sources.CustomerDetail;
const sl=one(nodes(listSource.a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CustomerList'),'source list'),sd=one(nodes(detailSource.a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CustomerDetailPage'),'source detail');
function sourceDeclaration(s,f,name,map){const d=named(s.a,f,name);return 'const '+mapped(d,s.a,map)+';\n';}
function sourceCondition(s,f,pattern){return one(nodes(f,n=>ts.isConditionalExpression(n)&&pattern.test(n.condition.getText(s.a))),'source condition '+pattern);}
function sourceCall(s,f,className){return one(nodes(f,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'className')?.initializer.text===className),'source renderer '+className);}
const sharedListMap={businessScope:'__niBusiness',unreadOnly:'__apUnreadOnly',setUnreadOnly:'__apSetUnreadOnly',unreadAuthorityReady:'__apUnreadAuthorityReady',unreadCustomers:'__apUnreadCustomers',unreadEmpty:'__apUnreadEmpty',unreadCanQuery:'__apUnreadCanQuery',unreadNarrowingFailed:'__apUnreadNarrowingFailed',pageRows:'__niPageRows',newInformationListReady:'__niListReady',newInformationRows:'__niRows',displayedCustomerRows:'__niDisplayed',useBusinessScope:'__NIUseBusinessScope',useAdminNewInformationContextUnreadRefs:'__NI.useAdminNewInformationContextUnreadRefs',useAdminNewInformationContextRows:'__NI.useAdminNewInformationContextRows',AdminNewInformationRowBadge:'__NI.AdminNewInformationRowBadge'};
const nativeMaps=[
 {...sharedListMap,d51Ready:'s',contextQuery:'r',contactScope:'l',rangeIdentityReady:'true',useRememberedState:'ps',setPage:'_',page:'X',appliedFilters:'U',listQuery:'F',canQueryList:'__apCanQueryList',result:'ue',CustomerSupplyAction:'Ba',ErrorPanel:'Ap',errorMessage:'Ht',jsx:'e.jsx',jsxs:'e.jsxs'},
 {...sharedListMap,d51Ready:'l',contextQuery:'s',contactScope:'i',rangeIdentityReady:'P',useRememberedState:'O',setPage:'U',page:'D',appliedFilters:'r',listQuery:'u',canQueryList:'be',result:'C',CustomerSupplyAction:'B',ErrorPanel:'Gt',errorMessage:'Me',jsx:'t',jsxs:'n'}
];
const detailMap={businessScope:'__apDetailBusiness',customer:'v',validId:'a',authorityReady:'g',detailQuery:'m',contextQuery:'c',contactScope:'d',id:'n',newInformationDetailReady:'__apDetailReady',newInformationRows:'__apDetailRows',newInformationRow:'__apDetailRow',inspectedCustomer:'__apInspectedCustomer',readAcknowledged:'__apReadAcknowledged',newInformationError:'__apInformationError',useBusinessScope:'__NIUseBusinessScope',useAdminNewInformationContextRows:'__NI.useAdminNewInformationContextRows',jsx:'l',jsxs:'p'};
const fixtures=[],modules=[],assets=[];
fs.mkdirSync(O+'/evidence',{recursive:true});
const json=(f,x)=>fs.writeFileSync(O+'/'+f,JSON.stringify(x,null,2)+'\n');
for(let index=0;index<2;index++){
 const rec=files['workbench-'+index+'.js'],before=read(rec.local);assert.equal(H(before),rec.sha256,'real effective immutable baseline');assert.equal(Buffer.byteLength(before),rec.size);
 const a=parse(before,rec.url),patches=[],patch=(start,end,after,reason)=>patches.push({start,end,before:before.slice(start,end),after,reason});
 const allFunctions=nodes(a,n=>ts.isFunctionDeclaration(n)&&n.body),list=one(allFunctions.filter(n=>n.name?.text===(index?'vt':'Jw')&&n.getStart(a)===(index?3898970:2246703)),'real list exact location'),detail=one(allFunctions.filter(n=>n.name?.text==='IM'&&n.getStart(a)===(index?6296680:5400279)),'latest detail module');
 assert(list.getText(a).includes('customer.list.useQuery'));assert(detail.getText(a).includes('isFetchedAfterMount')&&detail.getText(a).includes('customer-profile-tight'));
 if(index){let p=list.parent,owner;while(p){if(ts.isFunctionDeclaration(p)&&p.name?.text==='__CW_CUSTOMER_LIST_UPDATED_20261116_GET')owner=p;p=p.parent;}assert(owner,'vt inside exact current getter');}
 const map=nativeMaps[index];
 // Bring the exact existing BusinessScope singleton hook before the query input.
 patch(list.body.getStart(a)+1,list.body.getStart(a)+1,'const __niBusiness=__NIUseBusinessScope();'+sourceDeclaration(listSource,sl,'[unreadOnly, setUnreadOnly]',map),'source UI-only unread view slot and existing scope hook');
 const input=named(a,list,index?'ne':'be'),memo=input.initializer;assert(ts.isCallExpression(memo));
 const inputArrow=memo.arguments[0],inputReturn=one(nodes(inputArrow,n=>ts.isReturnStatement(n)),'native input return'),inputObject=inputReturn.expression;assert(ts.isObjectLiteralExpression(inputObject));
 const sourceInput=named(listSource.a,sl,'listInput'),sourceObject=one(nodes(sourceInput.initializer,n=>ts.isReturnStatement(n)),'source list input return').expression;
 const unreadSpread=one(sourceObject.properties.filter(n=>ts.isSpreadAssignment(n)&&n.getText(listSource.a).includes('unreadOnly')),'source customerIds pre-pagination spread');
 patch(inputObject.end-1,inputObject.end-1,','+mapped(unreadSpread,listSource.a,map),'global unread refs -> customerIds before server filters/star sorting/pagination');
 const deps=memo.arguments[1];assert(ts.isArrayLiteralExpression(deps));patch(deps.end-1,deps.end-1,',__apUnreadOnly,__apUnreadCustomers.customerIds','query input tracks authoritative global unread refs');
 const preInput=['unreadAuthorityReady','unreadCustomers','unreadEmpty','unreadCanQuery'].map(n=>sourceDeclaration(listSource,sl,n,map)).join('');
 const inputStatement=input.parent.parent;assert(ts.isVariableStatement(inputStatement));
 // Input may share its declaration statement with eligibility/query/result. Insert before the statement, not inside the comma chain.
 patch(inputStatement.getStart(a),inputStatement.getStart(a),preInput,'source global unread authorization and unavailable/empty gates');
 const query=named(a,list,index?'u':'F'),queryOptions=query.initializer.arguments[1].arguments[0];assert(ts.isObjectLiteralExpression(queryOptions));
 const enabled=prop(queryOptions,'enabled').initializer;
 if(index){const eligibility=named(a,list,'be');patch(eligibility.initializer.getStart(a),eligibility.initializer.end,'__apUnreadCanQuery&&('+eligibility.initializer.getText(a)+')','native original query eligibility intersects global unread capability');}
 else{const gate=enabled.getText(a);patch(enabled.getStart(a),enabled.end,'__apCanQueryList','retain original list gate plus unread capability');patch(inputStatement.getStart(a),inputStatement.getStart(a),'const __apCanQueryList=__apUnreadCanQuery&&('+gate+');\n','expose exact WB0 native gate, no widening');}
 const result=named(a,list,index?'C':'ue');
 patch(result.getStart(a),result.getStart(a),mapped(named(listSource.a,sl,'unreadNarrowingFailed'),listSource.a,map)+',','source fail-closed check if server ignores customerIds narrowing');
 patch(result.initializer.getStart(a),result.initializer.end,'__apUnreadCanQuery&&!__apUnreadNarrowingFailed&&('+result.initializer.getText(a)+')','no cached/unread out-of-set rows or totals');
 const oldNI=named(a,list,'__niBusiness').parent.parent;assert(ts.isVariableStatement(oldNI));
 const rows=['pageRows','newInformationListReady','newInformationRows','displayedCustomerRows'].map(n=>sourceDeclaration(listSource,sl,n,map)).join('');
 patch(oldNI.getStart(a),oldNI.end,rows,'source list inspect-only options and original server star order, never local unread sorting');
 // The native reset retains every existing range/team/date/star reset statement.
 const reset=named(a,list,index?'Jt':'Pe').initializer;assert(ts.isArrowFunction(reset)&&ts.isBlock(reset.body));patch(reset.body.getStart(a)+1,reset.body.getStart(a)+1,'__apSetUnreadOnly(false);','reset UI-only unread view without changing original filters');
 const canReset=named(a,list,index?'Xt':'Ae');patch(canReset.initializer.getStart(a),canReset.initializer.end,'(__apUnreadOnly||'+canReset.initializer.getText(a)+')','reset available while unread-only');
 const empty=named(a,list,index?'es':'B');patch(empty.initializer.getStart(a),empty.initializer.end,mapped(named(listSource.a,sl,'emptyMessage').initializer,listSource.a,map),'source truthful empty-unread text');
 const root=one(nodes(list,n=>ts.isObjectLiteralExpression(n)&&prop(n,'className')?.initializer.text==='customer-list-page'),'real list root'),children=prop(root,'children').initializer;assert(ts.isArrayLiteralExpression(children));
 const controls=mapped(sourceCall(listSource,sl,'customer-list-unread-controls'),listSource.a,map),inspectError=mapped(sourceCondition(listSource,sl,/newInformationRows\.query\.isError/),listSource.a,map);
 patch(children.getStart(a)+1,children.getStart(a)+1,controls+','+inspectError+',','source unread view control and inspection failure explicit retry');
 const errorBranch=one(nodes(list,n=>ts.isConditionalExpression(n)&&n.condition.getText(a)===(index?'s.isError':'r.isError')&&n.whenTrue.getText(a).includes(index?'Gt':'Ap')),'native context error branch');
 const srcUnreadError=sourceCondition(listSource,sl,/unreadOnly && \(unreadCustomers\.error/);
 patch(errorBranch.whenFalse.getStart(a),errorBranch.whenFalse.getStart(a),mapped(srcUnreadError.condition,listSource.a,map)+'?'+mapped(srcUnreadError.whenTrue,listSource.a,map)+':','source unavailable/failed/unsupported narrowing error and explicit retry');
 const loading=one(nodes(list,n=>ts.isConditionalExpression(n)&&n.condition.getText(a)===(index?'u.isPending':'F.isPending')&&n.whenTrue.getText(a).includes('animate-spin')),'native list loading branch');
 const unavailable=sourceCondition(listSource,sl,/^unreadOnly && !unreadCustomers\.available$/),emptyUnread=one(nodes(sl,n=>ts.isConditionalExpression(n)&&n.condition.getText(listSource.a)==='unreadEmpty'&&ts.isCallExpression(n.whenTrue)),'source rendered empty unread');
 patch(loading.getStart(a),loading.getStart(a),mapped(unavailable.condition,listSource.a,map)+'?'+mapped(unavailable.whenTrue,listSource.a,map)+':'+mapped(emptyUnread.condition,listSource.a,map)+'?'+mapped(emptyUnread.whenTrue,listSource.a,map)+':','source unavailable/real-empty UI bypasses disabled list pending state');
 const rowMap=one(nodes(list,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.getText(a)==='__niDisplayed.map'),'actual original row renderer'),row=rowMap.arguments[0],rowId=row.parameters[0].name.text;
 const rowObj=one(nodes(row,n=>ts.isObjectLiteralExpression(n)&&prop(n,'data-page-memory-row')),'actual row root');
 patch(rowObj.getStart(a)+1,rowObj.getStart(a)+1,'"data-customer-unread":__niRows.getRow("customer:"+'+rowId+'.id).isNew?"true":void 0,','unread-only real row background CSS attribute');
 const badge=one(nodes(row,n=>ts.isCallExpression(n)&&n.arguments[0]?.getText(a)==='__NI.AdminNewInformationRowBadge'),'existing real native badge');
 const sourceBadge=one(nodes(sl,n=>ts.isCallExpression(n)&&n.arguments[0]?.getText(listSource.a)==='AdminNewInformationRowBadge'),'source explicit unread badge');
 const badgeMap={...map,newInformationRow:'__niRows.getRow("customer:"+'+rowId+'.id)'};
 patch(badge.getStart(a),badge.end,mapped(sourceBadge,listSource.a,badgeMap),'source unread label and accessible description, existing position preserved');
 // Detail keeps its exact successful mount/context/id/enterprise barriers and all existing child modules.
 patch(detail.body.getStart(a)+1,detail.body.getStart(a)+1,'const __apDetailBusiness=__NIUseBusinessScope();','detail existing singleton scope hook');
 const customer=named(a,detail,'v');
 const detailSlots=['newInformationDetailReady','newInformationRows','newInformationRow','inspectedCustomer','readAcknowledged','newInformationError'];
 patch(customer.end,customer.end,','+detailSlots.map(n=>mapped(named(detailSource.a,sd,n),detailSource.a,detailMap)).join(','),'source successful current detail single-ref acknowledgement and state slots');
 const main=one(nodes(detail,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='main'&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'className')?.initializer.text?.includes('customer-profile-tight')),'successful real detail main only');
 assert(!prop(main.arguments[1],'ref'));patch(main.arguments[1].getStart(a)+1,main.arguments[1].getStart(a)+1,'ref:__apDetailRow.ref,','mark only after successful real main is attached and visibly rendered');
 const status=sourceCondition(detailSource,sd,/^newInformationDetailReady && newInformationError$/);
 const titleBox=one(nodes(detail,n=>ts.isObjectLiteralExpression(n)&&prop(n,'className')?.initializer.text==='min-w-0'&&prop(n,'children')?.initializer.getText(a).includes('customer-detail-name')),'detail actual title status host');
 const titleChildren=prop(titleBox,'children').initializer;assert(ts.isArrayLiteralExpression(titleChildren));
 patch(titleChildren.end-1,titleChildren.end-1,','+mapped(status,detailSource.a,detailMap),'source read/pending/failure states and fresh inspection retry');
 const after=apply(before,patches),aa=parse(after);
 const changedFunctions=[{kind:'list',before:list,after:one(nodes(aa,n=>ts.isFunctionDeclaration(n)&&n.name?.text===list.name.text&&n.getText(aa).includes('__apUnreadOnly')),'changed list')},{kind:'detail',before:detail,after:one(nodes(aa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='IM'&&n.getText(aa).includes('__apDetailRows')),'changed detail')}];
 const abi=[];
 for(const pair of changedFunctions){const oldFree=freeNames(pair.before.getText(a)),newFree=freeNames(pair.after.getText(aa));const allowed=new Set([...oldFree,'__NI','__NIJSX','__NIUseBusinessScope']);assert.deepEqual([...newFree].filter(n=>!allowed.has(n)),[],'no new free ABI identifiers in '+pair.kind);abi.push({kind:pair.kind,beforeFree:[...oldFree].sort(),afterFree:[...newFree].sort(),noNewUnmappedFreeSymbols:true});}
 // Every unchanged function including historical list/detail/invoice/helper implementations retains exact bytes.
 const protectedFunctions=[];
 for(const f of allFunctions){if(patches.some(p=>p.start>=f.getStart(a)&&p.start<=f.end||p.end>f.getStart(a)&&p.end<=f.end))continue;const shift=patches.filter(p=>p.end<=f.getStart(a)).reduce((x,p)=>x+p.after.length-p.before.length,0),text=before.slice(f.getStart(a),f.end);assert.equal(after.slice(f.getStart(a)+shift,f.end+shift),text,'protected native function bytes '+f.name?.text);protectedFunctions.push({name:f.name?.text??null,start:f.getStart(a),sha256:H(text)});}
 assert(patches.every(p=>[list,detail].some(f=>p.start>=f.getStart(a)&&p.end<=f.end)),'all changes confined to two real authorized customer functions');
 const hash=H(after),url='/assets/BusinessWorkbenchPage-admin-polish-'+hash.slice(0,16)+'.js',local=O+'/assets/'+path.basename(url);
 if(process.argv.includes('--build')){fs.mkdirSync(O+'/assets',{recursive:true});fs.writeFileSync(local,after);}
 const evidence={url:rec.url,beforeSHA:H(before),afterURL:url,afterSHA:hash,patches:patches.map(p=>({reason:p.reason,start:p.start,end:p.end,afterStart:p.afterStart,afterEnd:p.afterEnd,beforeSHA:H(p.before),afterSHA:H(p.after),beforeBase64:Buffer.from(p.before).toString('base64'),afterBase64:Buffer.from(p.after).toString('base64')})),protectedFunctions,abi,checks:{inverseExact:true,allOutsideSlotsBytesPreserved:true,onlyRealListAndLatestDetailFunctions:true,noNativeFullRebuild:true,noNewReact:true,noNewQuery:true,noNewTRPC:true,noNewBusinessScope:true,serverStarOrderPreserved:true}};
 json('evidence/workbench-'+index+'.json',evidence);
 modules.push({url:rec.url,beforeSHA:H(before),afterURL:url,afterSHA:hash,patches:evidence.patches.map(({beforeBase64,afterBase64,...x})=>x),protected:{functionCount:protectedFunctions.length,sha256:H(JSON.stringify(protectedFunctions)),evidence:O+'/evidence/workbench-'+index+'.json'},inverseExact:true});assets.push({url,local,sha256:hash,size:Buffer.byteLength(after)});
 fixtures.push({index,map,listInput:mapped(inputArrow,a,{}),patchedListInput:after.slice(inputArrow.getStart(a)+patches.filter(p=>p.end<=inputArrow.getStart(a)).reduce((x,p)=>x+p.after.length-p.before.length,0),inputArrow.end+patches.filter(p=>p.end<=inputArrow.end).reduce((x,p)=>x+p.after.length-p.before.length,0)),listSlots:preInput+rows,detailSlots:detailSlots.map(n=>sourceDeclaration(detailSource,sd,n,detailMap)).join(''),controls,detailStatus:mapped(status,detailSource.a,detailMap)});
 console.log('WB'+index+' '+list.name.text+' + IM: '+patches.length+' exact slots; '+protectedFunctions.length+' protected functions; '+Buffer.byteLength(after)+' bytes');
}
for(const [f,h]of Object.entries(sourcePins))assert.equal(H(fs.readFileSync(f)),h,'source snapshot stable '+f);
json('fixtures.json',fixtures);
const built=process.argv.includes('--build');
json('manifest.json',{kind:'admin-native-customer-polish-slots',status:built?'BUILT':'PREPARED_NOT_PUBLISHED',assets,modules,sourcePins,builderSHA:H(fs.readFileSync(W+'/pages-native.mjs')),checks:{wholeNativeInverseExact:true,allOutsideAuthorizedSlotsBytesPreserved:true,protectedFunctionsByteExact:true,noFullNativeRebuild:true,noNewReact:true,noNewQueryClient:true,noNewTRPC:true,noNewBusinessScope:true,sourceSnapshotStable:true,globalUnreadRefsBeforeServerPagination:true,emptyUnreadDisablesList:true,unsupportedUnreadIsFailureNotEmpty:true,listInspectOnly:true,detailSuccessfulMainRefSingleCustomer:true,detailFailureFreshInspectionRetry:true,serverStarOrderingAndPaginationPreserved:true,allOriginalContactsTeamsDatesUploadsCreateInventoryInvoicesPreserved:true,noHTMLWrites:true,noProductionWrites:true,noBrowser:true},navImportmapRequirement:{keepLiteral:files['nav.js'].url,parentMustRedirectToNewSharedNav:true},tests:{status:'PENDING_OFFLINE_FIXTURE'}});
console.log(JSON.stringify({status:built?'BUILT':'PREPARED',assets:assets.length,output:O,sourcePins},null,2));
