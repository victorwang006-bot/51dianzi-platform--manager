'use strict';
// Read-only reuse of shared native architecture. Never call an old workspace runner.
const C=require('../demand-personal-backend-20261114/core.cjs');
const S=require('../demand-personal-backend-20261114/source.cjs');
const N=require('../demand-personal-backend-20261114/native-bundle.cjs');
const {fs,ts,path,sha,assert,read,parse,walk,uniqueNode}=C;
const REVISION='5abd9a35cc4ff53d008f49bff88f54a1f47c1d0c';
const W='/home/ubuntu/work/profile-staff-20261114';
const PINNED={admin:'d2756c5ff98b459cad79c3ff11643680c92f773ceeeb4469e88302a863369539',front:'db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9'};
// The sole additional equivalence over shared canonical is esbuild's lowering
// of local shorthand {id} to {id: id4} when a bundled local is renamed.
// Keys remain literal; values remain checker-symbol normalized. No body tokens
// or namespace owners are ignored.
function canonical(p,node){
 const locals=new Map(),start=node.getStart(p.sf),end=node.end;
 walk(node,n=>{if(!ts.isIdentifier(n))return;const s=p.symbolAt(n);if(!s||p.symbols.has(s))return;const ds=s.declarations||[];if(ds.length&&ds.every(d=>(ts.isVariableDeclaration(d)||ts.isParameter(d)||ts.isBindingElement(d)||ts.isFunctionDeclaration(d)||ts.isFunctionExpression(d)||ts.isClassDeclaration(d))&&d.getStart(p.sf)>=start&&d.end<=end)&&!locals.has(s))locals.set(s,'L'+locals.size);});
 function visit(n){
  if(ts.isShorthandPropertyAssignment(n)&&!n.objectAssignmentInitializer)return ['PropertyAssignment',['Identifier',n.name.text],visit(n.name)];
  if(ts.isBindingElement(n)&&ts.isObjectBindingPattern(n.parent)&&!n.dotDotDotToken&&ts.isIdentifier(n.name)){const out=['BindingElement',n.propertyName?visit(n.propertyName):['Identifier',n.name.text],visit(n.name)];if(n.initializer)out.push(visit(n.initializer));return out;}
  if(ts.isIdentifier(n)){const s=p.symbolAt(n);if(locals.has(s)&&(S.isReference(n)||((ts.isVariableDeclaration(n.parent)||ts.isParameter(n.parent)||ts.isBindingElement(n.parent)||ts.isFunctionExpression(n.parent))&&n.parent.name===n)))return ['Identifier',locals.get(s)];return ['Identifier',n.text];}
  if(ts.isStringLiteral(n)||ts.isNumericLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n)||ts.isRegularExpressionLiteral(n))return [ts.SyntaxKind[n.kind],n.text];
  const children=[];ts.forEachChild(n,c=>{children.push(visit(c));});return [ts.SyntaxKind[n.kind],...children];
 }
 return JSON.stringify(visit(node));
}
function variableStatement(n){while(n&&!ts.isVariableStatement(n))n=n.parent;assert(n,'VARIABLE_STATEMENT');return n;}
function appObject(p){const d=p.byName('appRouter');assert(d.module==='server/routers.ts'&&ts.isVariableDeclaration(d.node),'APP_ROUTER_NATIVE_OWNER');const obj=d.node.initializer?.arguments?.find(ts.isObjectLiteralExpression);assert(obj,'APP_ROUTER_OBJECT');return obj;}
function route(p,name){const group=appObject(p).properties.find(n=>n.name?.text==='adminUser');assert(group,'ADMIN_USER_ROUTER');const obj=group.initializer?.arguments?.find(ts.isObjectLiteralExpression);assert(obj,'ADMIN_USER_ROUTER_OBJECT');const a=obj.properties.filter(n=>n.name?.text===name);assert(a.length===1,'ADMIN_ROUTE_NONUNIQUE '+name);return a[0];}
function handler(p,name){const n=route(p,name).initializer;assert(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='mutation'&&n.arguments.length===1&&ts.isArrowFunction(n.arguments[0]),'DIRECT_MUTATION_HANDLER '+name);return n.arguments[0];}
function input(p,name){const n=route(p,name).initializer.expression.expression;assert(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='input'&&n.arguments.length===1,'DIRECT_INPUT '+name);return n.arguments[0];}
function guard(old,base,sourceName,repo,context=[]){
 const source=base.p.byName(sourceName),m=S.nativeMapper(old,base.p,repo,[],context),binding=m.resolve(source),target=binding.target;assert(target&&target.module===base.p.module,'BASELINE_OWNER_MODULE '+sourceName);
 const e=m.extract(source.node,{renameDeclaration:true}),isolated=parse('baseline-native.js',ts.isVariableDeclaration(source.node)?'var '+e.text+';':e.text,target.module),fresh=isolated.byName(binding.runtimeName);
 const actual=canonical(old,target.node),expected=canonical(isolated,fresh.node);assert(actual===expected,'BASELINE_SOURCE_DIVERGENCE '+sourceName+' '+sha(actual)+' != '+sha(expected));
 return {oldNode:target.node,runtimeName:target.name,proof:{gitRevision:REVISION,source:base.meta,sourceName,runtimeName:target.name,module:target.module,oldDeclarationSha256:sha(target.node.getText(old.sf)),oldDeclarationBytes:Buffer.byteLength(target.node.getText(old.sf)),canonicalSha256:sha(actual),baselineSourceReproducesRuntimeAST:true,canonicalNormalization:'checker-local-symbols-and-esbuild-local-shorthand-lowering-only',nativeBindings:e.bindings}};
}
function slotGuard(old,base,name,kind,repo){const select=kind==='handler'?handler:input,source=select(base.p,name),target=select(old,name),e=S.nativeMapper(old,base.p,repo,[],['appRouter']).extract(source),isolated=parse('baseline-slot.js','var __slot='+e.text+';');const a=canonical(old,target),b=canonical(isolated,isolated.byName('__slot').node.initializer);assert(a===b,'BASELINE_ROUTE_SLOT_DIVERGENCE '+name+'.'+kind);return {oldNode:target,proof:{gitRevision:REVISION,source:base.meta,sourceName:'adminUser.'+name+'.'+kind,slotKind:kind+'-only',oldDeclarationSha256:sha(target.getText(old.sf)),canonicalSha256:sha(a),baselineSourceReproducesRuntimeAST:true,nativeBindings:e.bindings}};}
function routeAudit(base,current){
 const old=appObject(base),fresh=appObject(current);assert(old.properties.length===fresh.properties.length,'SOURCE_ROUTER_PROPERTY_COUNT');const protectedRoutes=[];
 for(const p of old.properties){const q=fresh.properties.find(n=>n.name?.text===p.name?.text);assert(q,'SOURCE_ROUTER_REMOVED');if(p.name.text!=='adminUser'){assert(p.getText(base.sf)===q.getText(current.sf),'SOURCE_OTHER_ROUTE_CHANGED '+p.name.text);protectedRoutes.push(p.name.text);continue;}const po=p.initializer.arguments.find(ts.isObjectLiteralExpression),qo=q.initializer.arguments.find(ts.isObjectLiteralExpression);assert(po.properties.length===qo.properties.length,'SOURCE_ADMIN_ROUTE_COUNT');for(const a of po.properties){const b=qo.properties.find(n=>n.name?.text===a.name?.text);assert(b,'SOURCE_ADMIN_ROUTE_REMOVED');if(!['update','toggleStatus'].includes(a.name.text)){assert(a.getText(base.sf)===b.getText(current.sf),'SOURCE_OTHER_ADMIN_ROUTE_CHANGED '+a.name.text);protectedRoutes.push('adminUser.'+a.name.text);continue;}const ai=input(base,a.name.text),bi=input(current,a.name.text),ah=handler(base,a.name.text),bh=handler(current,a.name.text);assert(base.text.slice(a.getStart(base.sf),ai.getStart(base.sf))===current.text.slice(b.getStart(current.sf),bi.getStart(current.sf))&&base.text.slice(ai.end,ah.getStart(base.sf))===current.text.slice(bi.end,bh.getStart(current.sf))&&base.text.slice(ah.end,a.end)===current.text.slice(bh.end,b.end),'SOURCE_ROUTE_OUTER_CHANGED '+a.name.text);}}
 return {protectedSourceProperties:protectedRoutes,changedSlots:['adminUser.update.input','adminUser.update.handler','adminUser.toggleStatus.input','adminUser.toggleStatus.handler'],noRouterOrAuthReplacement:true};
}
function assertBindingsInitialized(candidate,records,patches){const checks=[];for(const r of records){const patch=patches.find(p=>p.name===r.name),bindings=r.extracted?.bindings||[];for(const b of bindings){const d=candidate.byName(b.runtimeName);if(ts.isFunctionDeclaration(d.node)||d.import)continue;const refAt=patch.newStart+(r.prefixLength||0);assert(d.node.end<refAt,'NATIVE_TDZ_OR_UNINITIALIZED '+r.name+' '+b.runtimeName);}checks.push({slot:r.name,bindings:bindings.length,initializedOrHoistedBeforeUse:true});}return checks;}
module.exports={C,S,N,fs,ts,path,sha,assert,read,parse,walk,uniqueNode,REVISION,W,PINNED,canonical,variableStatement,appObject,route,handler,input,guard,slotGuard,routeAudit,assertBindingsInitialized};
