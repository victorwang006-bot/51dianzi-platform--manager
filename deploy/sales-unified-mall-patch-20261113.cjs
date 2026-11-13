const ts=require('typescript'),esbuild=require('esbuild'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const REPO=path.resolve(__dirname,'..');
function parse(s,kind=ts.ScriptKind.JS){const a=ts.createSourceFile('source.js',s,99,true,kind);assert.equal(a.parseDiagnostics.length,0);return a}
function nodes(root,p){const r=[];(function v(n){if(p(n))r.push(n);n.forEachChild(v)})(root);return r}
function one(root,p,label){const r=nodes(root,p);assert.equal(r.length,1,label+' found='+r.length);return r[0]}
function decls(f){return f.body.statements.filter(ts.isVariableStatement).flatMap(n=>Array.from(n.declarationList.declarations))}
function bound(n){if(ts.isIdentifier(n))return[n.text];return n.elements.filter(x=>ts.isBindingElement(x)).flatMap(x=>bound(x.name))}
function prop(n,key){return n.properties.find(x=>ts.isPropertyAssignment(x)&&x.name.text===key)}
function jsx(root,cls){return one(root,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'className')?.initializer.text?.includes(cls),cls)}
function print(n,a){return ts.createPrinter().printNode(ts.EmitHint.Unspecified,n,a)}
async function patchMall(before){
 const a=parse(before),old=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='uI','native mall page');
 const source=fs.readFileSync(REPO+'/client/src/business/platform/client/src/pages/OutboundManagement.tsx','utf8');
 const sa=parse((await esbuild.transform(source,{loader:'tsx',jsx:'automatic',target:'es2020'})).code);
 const src=one(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='OutboundManagement','source mall page');
 const sd=decls(src),td=decls(old),map={readOnly:'s',PAGE_SIZE:10,hasAdvancedFilterInput:'ee',hasAnyFilterInput:'Ce'};
 const advancedFlag=td.find(n=>n.name.text==='ee'),anyFlag=td.find(n=>n.name.text==='Ce');assert(advancedFlag&&anyFlag,'original filter flags missing');assert(advancedFlag.initializer.getText(a).includes('.receiver'),'advanced filter flag shape');assert(anyFlag.initializer.getText(a).includes('Object.entries'),'any filter flag shape');
 for(const hook of ['useState','useMemo','useCallback','useRef']){
  const ss=sd.filter(n=>n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(sa)===hook&&!bound(n.name).some(x=>['exporting','setExporting','exportEpoch'].includes(x)));
  const tt=td.filter(n=>n.initializer&&ts.isCallExpression(n.initializer)&&ts.isPropertyAccessExpression(n.initializer.expression)&&n.initializer.expression.name.text===hook);
  assert.equal(ss.length,tt.length,'unchanged original '+hook+' hook count');
  ss.forEach((n,i)=>{const b1=bound(n.name),b2=bound(tt[i].name);assert.equal(b1.length,b2.length);b1.forEach((v,j)=>map[v]=b2[j]);if(hook==='useState'&&ts.isCallExpression(n.initializer.arguments[0])&&ts.isCallExpression(tt[i].initializer.arguments[0]))map[n.initializer.arguments[0].expression.getText(sa)]=tt[i].initializer.arguments[0].expression.getText(a)})
 }
 for(const end of ['order.sellerOrders.useQuery','order.expressCos.useQuery','order.tracks.useQuery']){
  const s=sd.find(n=>n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(sa).endsWith(end)),t=td.find(n=>n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(a).endsWith(end));assert(s&&t,end);
  for(const e of s.name.elements){const key=e.propertyName?.text??e.name.text;const match=t.name.elements.find(x=>(x.propertyName?.text??x.name.text)===key);assert(match,key);map[e.name.text]=match.name.text}
 }
 for(const hook of ['useState','useMemo','useCallback','useRef','useEffect'])map[hook]='c.'+hook;
 map.jsx='e.jsx';map.jsxs='e.jsxs';map.sumMallOrderAmounts='__SU_MALL_AMOUNTS.sumMallOrderAmounts';
 const oldToolbar=jsx(old,'sales-order-toolbar'),oldPanel=jsx(old,'sales-order-table-card'),oldFooter=jsx(old,'sales-order-pagination');
 const header=one(old,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'title')?.initializer.text==='商城订单','original header');
 const action=prop(header.arguments[1],'actions').initializer;
 const oldExportClick=prop(action.arguments[1],'onClick').initializer;
 const exportCall=one(oldExportClick,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression),'original export call');
 const exportName=exportCall.expression.text;map.exportToExcel=exportName;
 const oldExport=one(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text===exportName,'original XLSX export');
 const chevron=one(oldToolbar,n=>ts.isCallExpression(n)&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])&&prop(n.arguments[1],'className')?.initializer.getText(a).includes('transition-transform'),'original chevron');
 const download=one(action,n=>ts.isCallExpression(n)&&ts.isIdentifier(n.arguments[0])&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1]),'original download icon');
 map.ChevronDown=chevron.arguments[0].getText(a);map.Download=download.arguments[0].getText(a);map.AdminFilterBar=oldToolbar.arguments[0].getText(a);
 function rename(node,table=map){const tr=ts.transform(node,[ctx=>root=>ts.visitNode(root,function visit(n){if(ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)){
    const v=table[n.text];if(v!==undefined){if(typeof v==='number')return ts.factory.createNumericLiteral(v);let e=ts.factory.createIdentifier(v.split('.')[0]);for(const part of v.split('.').slice(1))e=ts.factory.createPropertyAccessExpression(e,part);return e}
   }return ts.visitEachChild(n,visit,ctx)})]);const result=print(tr.transformed[0],sa);tr.dispose();return result}
 const nativePageTotal=td.find(n=>n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(a)==='Math.max'&&n.initializer.getText(a).includes('Math.ceil'));assert(nativePageTotal);const divider=nativePageTotal.initializer.arguments[1].arguments[0].right;map.PAGE_SIZE=ts.isNumericLiteral(divider)?Number(divider.text):divider.getText(a);
 const canonical=s=>s.replace(/\s+/g,'').replace(/;$/,'');
 for(const name of ['totalPages','safePage']){const s=sd.find(n=>n.name.getText(sa)===name);const wanted=canonical(rename(s.initializer));const matches=td.filter(n=>n.initializer&&canonical(n.initializer.getText(a))===wanted);assert.equal(matches.length,1,name+' initializer '+wanted);map[name]=matches[0].name.getText(a)}
 const calls=(n,ast)=>nodes(n,x=>ts.isCallExpression(x)&&ts.isIdentifier(x.expression)).map(x=>x.expression.text);
 for(const name of ['applyFilters','resetFilters','selectStatus']){
  const s=sd.find(n=>n.name.getText(sa)===name),want=calls(s.initializer,sa).map(x=>map[x]??x);
  const matches=td.filter(n=>n.initializer&&ts.isArrowFunction(n.initializer)&&JSON.stringify(calls(n.initializer,a))===JSON.stringify(want));assert.equal(matches.length,1,'original handler '+name+': '+want);map[name]=matches[0].name.getText(a)
 }
 const exportSource=one(sa,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='exportToExcel','source export helper');
 const oldToast=one(oldExport,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='warning','original toast');
 const oldDate=one(oldExport,n=>ts.isPropertyAssignment(n)&&n.name.text==='下单时间','original export date');
 const oldStatus=one(oldExport,n=>ts.isPropertyAssignment(n)&&n.name.text==='状态','original export status');
 const meta=one(oldStatus,n=>ts.isElementAccessExpression(n),'status metadata');
 const oldCompact=one(oldExport,n=>ts.isCallExpression(n)&&n.arguments[0]&&ts.isNewExpression(n.arguments[0])&&n.arguments[0].expression.getText(a)==='Date','original filename date');
 const oldLoader=one(oldExport,n=>ts.isAwaitExpression(n),'original XLSX loader');
 const exportMap={exportToExcel:exportName,toast:oldToast.expression.expression.getText(a),fmtDate:oldDate.initializer.expression.getText(a),ORDER_STATUS_META:meta.expression.getText(a),formatBeijingDateCompact:oldCompact.expression.getText(a)};
 let newExport=rename(exportSource,exportMap).replace(/await import\("xlsx"\)/, 'await ('+oldLoader.expression.getText(a)+')');assert(!newExport.includes('import("xlsx")'));
 const srcToolbar=jsx(src,'sales-order-list-toolbar'),srcFooter=jsx(src,'sales-order-pagination');
 const rootReturn=old.body.statements.find(ts.isReturnStatement);assert(rootReturn);
 const page=jsx(rootReturn,'erp-ui sales-order-page');const oldChildren=prop(page.arguments[1],'children');assert(ts.isArrayLiteralExpression(oldChildren.initializer));
 const children=Array.from(oldChildren.initializer.elements);assert.equal(children[0],header);assert.equal(children[2],oldToolbar);assert.equal(children[3],oldPanel);
 const nativeTabs=children[1];map.SALES_ORDER_STATUS_TABS=prop(nativeTabs.arguments[1],'children').initializer.expression.expression.getText(a);
 const panelProps=oldPanel.arguments[1];const panelChildren=prop(panelProps,'children').initializer;assert(ts.isArrayLiteralExpression(panelChildren));
 const panelText=oldPanel.getText(a);const panelEdits=[];
 const inside=(node,text)=>panelEdits.push({start:node.getStart(a)-oldPanel.getStart(a),end:node.end-oldPanel.getStart(a),text});
 inside(panelChildren,'['+rename(srcToolbar)+','+panelChildren.elements.map(n=>n===oldFooter?rename(srcFooter):n.getText(a)).join(',')+']');
 for(const key of ['role','aria-labelledby']){const p=prop(panelProps,key);if(p){const start=p.getStart(a)-oldPanel.getStart(a);let end=p.end-oldPanel.getStart(a);if(panelText[end]===',')end++;panelEdits.push({start,end,text:''})}}
 let newPanel=panelText;for(const e of panelEdits.sort((x,y)=>y.start-x.start))newPanel=newPanel.slice(0,e.start)+e.text+newPanel.slice(e.end);
 const srcHeading=one(src,n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='h1','accessible heading');
 const srcReadonly=one(src,n=>ts.isBinaryExpression(n)&&n.left.getText(sa)==='readOnly'&&ts.isCallExpression(n.right)&&n.right.arguments[0]?.text==='p','readonly notice');
 const mainChildren='['+rename(srcHeading)+','+rename(srcReadonly)+','+newPanel+','+children.slice(4).map(n=>n.getText(a)).join(',')+']';
 const extraStates=src.body.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>bound(d.name).some(x=>['exporting','exportEpoch'].includes(x))));
 const effect=one(src,n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(sa)==='useEffect'&&n.getText(sa).includes('exportEpoch'),'export cancellation effect');
 const amounts=await esbuild.build({entryPoints:[REPO+'/client/src/business/platform/client/src/lib/mallOrderListAmounts.ts'],bundle:true,write:false,format:'iife',globalName:'__SU_MALL_AMOUNTS',minify:true,target:'es2020'});
 const edits=[{node:oldChildren.initializer,text:mainChildren,reason:'only title/tabs/list toolbar/footer JSX; original table and dialogs retained'},{node:oldExport,text:newExport,reason:'source-bound filter/selected XLSX with current-request guard and exact strings'},{start:old.getStart(a),end:old.getStart(a),text:'\n'+amounts.outputFiles[0].text+'\n',reason:'pure exact amount aggregation'},{start:rootReturn.getStart(a),end:rootReturn.getStart(a),text:'\n'+extraStates.map(n=>rename(n)).join('\n')+'\n'+rename(effect)+'\n',reason:'export state and cancellation only'}];
 return {edits:edits.map(e=>({start:e.node?e.node.getStart(a):e.start,end:e.node?e.node.end:e.end,before:e.node?e.node.getText(a):'',after:e.text,reason:e.reason})),map,sourceShaInput:source,originalTable:panelChildren.elements[0].getText(a),originalHandlers:['requestCancelOrder','openConfirmPay','openShip','submitShip']};
}
module.exports={patchMall};
