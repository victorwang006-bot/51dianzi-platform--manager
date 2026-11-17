import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
export const FR='/home/ubuntu/work/sales-20261117/platform',AR='/home/ubuntu/work/sales-20261117/manager';
const req=createRequire(FR+'/package.json');
export const ts=req('typescript'),esbuild=req('esbuild');
export const assert=(v,m)=>{if(!v)throw Error(m);};
export const one=(xs,m)=>{assert(xs.length===1,m+': '+xs.length);return xs[0];};
export function parse(s,n='actual.js'){const a=ts.createSourceFile(n,s,99,true,n.endsWith('.tsx')?4:n.endsWith('.ts')?3:1);assert(!a.parseDiagnostics.length,'Syntax '+n);return a;}
export function nodes(a,p){const r=[];function walk(n){if(p(n))r.push(n);n.forEachChild(walk);}walk(a);return r;}
// Hash executable dependency closure rather than trusting a mutable imported static builder.
export function executionClosure(){
 const roots=new Set(),seen=new Set();
 function pkg(name,from=req){if(seen.has(name))return;seen.add(name);let p;try{p=fs.realpathSync(from.resolve(name));}catch{return;}
  let d=path.dirname(p);while(d!==path.dirname(d)){const f=d+'/package.json';if(fs.existsSync(f)&&JSON.parse(fs.readFileSync(f)).name===name){roots.add(d);const m=JSON.parse(fs.readFileSync(f));const r=createRequire(f);for(const dep of Object.keys({...m.dependencies,...m.optionalDependencies,...m.peerDependencies}))pkg(dep,r);return;}d=path.dirname(d);}throw Error('package root '+name);}
 for(const p of ['typescript','esbuild','drizzle-orm','@trpc/server','zod'])pkg(p);
 // esbuild's actual platform executable is an execution input, not just its JS API.
 const es=path.dirname(fs.realpathSync(req.resolve('esbuild')));const platform=path.resolve(es,'../../@esbuild');
 if(fs.existsSync(platform))for(const d of fs.readdirSync(platform))roots.add(fs.realpathSync(platform+'/'+d));
 const files={[fs.realpathSync(process.execPath)]:H(fs.readFileSync(process.execPath))};
 function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.name==='node_modules')continue;if(e.isDirectory())walk(p);else if(e.isFile()){const f=fs.realpathSync(p);files[f]=H(fs.readFileSync(f));}}}
 for(const p of [...roots].sort())walk(p);
 return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function assertExecutionClosure(lock){assert(lock.executionClosure,'missing executable closure: explicit archive/review/freeze required');assert(JSON.stringify(executionClosure())===JSON.stringify(lock.executionClosure),'EXECUTABLE_DEPENDENCY_DRIFT_NO_AUTO_RELOCK');for(const[p,h]of Object.entries(lock.toolHashes))assert(H(fs.readFileSync(p))===h,'TOOL_DRIFT_NO_AUTO_RELOCK '+p);}

export const H=b=>crypto.createHash('sha256').update(b).digest('hex');
export const read=p=>fs.readFileSync(p,'utf8');
export const json=p=>JSON.parse(read(p));
export const saveJSON=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const indexes=new WeakMap();
export function declaration(a,name){let m=indexes.get(a);if(!m){m=new Map();for(const n of nodes(a,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.text))m.set(n.name.text,[...(m.get(n.name.text)??[]),n]);indexes.set(a,m);}const found=m.get(name)??[],top=found.filter(n=>n.parent===a||n.parent?.parent?.parent===a);return one(top.length?top:found,'declaration '+name);}
export function routerObject(a,name){const n=declaration(a,name);assert(ts.isCallExpression(n.initializer)&&ts.isObjectLiteralExpression(n.initializer.arguments[0]),'router '+name);return n.initializer.arguments[0];}
export const property=(o,name)=>one(o.properties.filter(p=>p.name?.text===name),'property '+name);
export const patch=(a,n,after,reason)=>({start:n.getStart(a),end:n.end,before:n.getText(a),after,reason});
export const insert=(at,after,reason)=>({start:at,end:at,before:'',after,reason});
export function bytesDelta(original,patches){
 const input=Buffer.isBuffer(original)?original:Buffer.from(original,'utf8');const text=input.toString('utf8');assert(Buffer.from(text).equals(input),'baseline must round-trip UTF-8 exactly');
 const ps=[...patches].sort((a,b)=>a.start-b.start||a.end-b.end);let offset=0;
 const records=ps.map((p,i)=>{assert(text.slice(p.start,p.end)===p.before,'preimage '+p.reason);if(i)assert(ps[i-1].end<=p.start,'overlapping hunks');const byteStart=Buffer.byteLength(text.slice(0,p.start),'utf8');const byteEnd=Buffer.byteLength(text.slice(0,p.end),'utf8');const old=Buffer.from(p.before),next=Buffer.from(p.after);assert(input.subarray(byteStart,byteEnd).equals(old),'UTF8 old byte alignment');const newByteStart=byteStart+offset;offset+=next.length-old.length;return{byteStart,byteEnd,newByteStart,newByteEnd:newByteStart+next.length,oldBase64:old.toString('base64'),newBase64:next.toString('base64'),oldSha256:H(old),newSha256:H(next),reason:p.reason};});
 let candidate=input;for(const p of [...records].reverse())candidate=Buffer.concat([candidate.subarray(0,p.byteStart),Buffer.from(p.newBase64,'base64'),candidate.subarray(p.byteEnd)]);
 let reversed=candidate;for(const p of [...records].reverse()){const next=Buffer.from(p.newBase64,'base64');assert(reversed.subarray(p.newByteStart,p.newByteEnd).equals(next),'reverse actual candidate preimage');reversed=Buffer.concat([reversed.subarray(0,p.newByteStart),Buffer.from(p.oldBase64,'base64'),reversed.subarray(p.newByteEnd)]);}
 assert(reversed.equals(input),'actual API byte inverse');parse(candidate.toString('utf8'));return{candidate,records,beforeSha256:H(input),afterSha256:H(candidate),inverseVerified:true};
}
export function transpile(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export\s+/,'');}
export function adapt(s,map){const a=parse(s,'adapt.ts');const ps=nodes(a,ts.isIdentifier).filter(n=>map[n.text]&&map[n.text]!==n.text&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)).map(n=>{const v=map[n.text];return patch(a,n,ts.isShorthandPropertyAssignment(n.parent)?n.text+':'+v:v,'explicit ABI '+n.text);});return bytesDelta(s,ps).candidate.toString('utf8');}
function unwrap(n){while(ts.isParenthesizedExpression(n))n=n.expression;return n;}
export function semantic(n){n=unwrap(n);if(ts.isStringLiteralLike(n))return['string',n.text];if([ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(n.kind))return['template-token',n.kind,n.text];if(ts.isRegularExpressionLiteral(n))return['regexp',n.text];if(ts.isPrefixUnaryExpression(n)||ts.isPostfixUnaryExpression(n))return[n.kind,n.operator,semantic(n.operand)];if(ts.isNumericLiteral(n))return['number',Number(n.text)];if(ts.isIdentifier(n))return['id',n.text];if(ts.isVoidExpression(n)&&ts.isNumericLiteral(n.expression)&&Number(n.expression.text)===0)return['id','undefined'];const c=[];n.forEachChild(x=>{c.push(semantic(x));});return[n.kind,...c];}
const equal=(a,b)=>JSON.stringify(semantic(a))===JSON.stringify(semantic(b));
const children=n=>{const out=[];unwrap(n).forEachChild(x=>{out.push(x);});return out;};
function lcs(a,b){const table=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i][j]=equal(a[i],b[j])?1+table[i+1][j+1]:Math.max(table[i+1][j],table[i][j+1]);const pairs=[];let i=0,j=0;while(i<a.length&&j<b.length){if(equal(a[i],b[j])){pairs.push([i++,j++]);}else if(table[i+1][j]>=table[i][j+1])i++;else j++;}return pairs;}
/** Apply only source-preimage -> final-source edits to matching REAL deployed AST nodes. Never reprint unchanged children. */
export function minimalTreeDelta(oldNode,newNode,nativeNode,oldAst,newAst,nativeAst,reason){
 const out=[];
 function walk(o,n,v){const nr=n,vr=v;o=unwrap(o);n=unwrap(n);v=unwrap(v);if(equal(o,n))return;if(ts.isParenthesizedExpression(nr)){assert(equal(o,v),'changed grouped old/native subtree mismatch: '+reason);out.push(patch(nativeAst,vr,nr.getText(newAst),reason+' preserve explicit grouped expression boundary'));return;}
  if(ts.isFunctionLike(o)&&ts.isFunctionLike(n)&&ts.isFunctionLike(v)&&o.body&&n.body&&v.body){const before=JSON.stringify(o.parameters.map(semantic)),after=JSON.stringify(n.parameters.map(semantic));if(before!==after){assert(JSON.stringify(v.parameters.map(semantic))===before,'actual native parameter preimage '+reason);const start=v.parameters.pos,end=v.parameters.end;out.push({start,end,before:nativeAst.text.slice(start,end),after:n.parameters.map(x=>x.getText(newAst)).join(', '),reason:reason+' only necessary transaction hook signature'});}walk(o.body,n.body,v.body);return;}
  if(ts.isBlock(o)&&ts.isBlock(n)&&ts.isBlock(v)){list(o.statements,n.statements,v.statements,v.getStart(nativeAst)+1,v.end-1,'\n');return;}
  if(ts.isObjectLiteralExpression(o)&&ts.isObjectLiteralExpression(n)&&ts.isObjectLiteralExpression(v)){const oldNames=o.properties.map(x=>x.name?.text),newNames=n.properties.map(x=>x.name?.text);if(oldNames.every(x=>x!==undefined)&&newNames.every(x=>x!==undefined)){for(let i=0;i<o.properties.length;i++){const j=newNames.indexOf(oldNames[i]);assert(j>=0,'property removal needs explicit adapter');const native=property(v,oldNames[i]);walk(o.properties[i],n.properties[j],native);}for(let j=0;j<n.properties.length;j++)if(!oldNames.includes(newNames[j]))out.push(insert(v.getStart(nativeAst)+1,'\n'+n.properties[j].getText(newAst)+',\n',reason+' added property '+newNames[j]));return;}}
  const oc=children(o),nc=children(n),vc=children(v);
  if(o.kind===n.kind&&oc.length===nc.length&&oc.length===vc.length&&oc.length){for(let i=0;i<oc.length;i++)walk(oc[i],nc[i],vc[i]);return;}
  assert(equal(o,v),'changed old/native subtree mismatch; explicit reviewed adapter required: '+reason);
  const code=n.getText(newAst),after=ts.isExpression(n)&&!ts.isIdentifier(n)&&!ts.isLiteralExpression(n)?'('+code+')':code;out.push(patch(nativeAst,v,after,reason+' smallest changed AST subtree with expression grouping'));
 }
 function list(os,ns,vs,start,end,separator){assert(os.length===vs.length,'native statement array mismatch');const matches=lcs(os,ns),bounds=[[-1,-1],...matches,[os.length,ns.length]];for(let k=1;k<bounds.length;k++){const[oi,nj]=bounds[k-1],[oe,ne]=bounds[k];const oldSeg=os.slice(oi+1,oe),newSeg=ns.slice(nj+1,ne);if(oldSeg.length===newSeg.length){for(let i=0;i<oldSeg.length;i++)walk(oldSeg[i],newSeg[i],vs[oi+1+i]);}else{if(oi>=0)assert(equal(os[oi],vs[oi]),'insert previous native anchor mismatch: '+reason);if(oe<os.length)assert(equal(os[oe],vs[oe]),'insert next native anchor mismatch: '+reason);const at=oi<0?start:vs[oi].end;const stop=oe===os.length?end:vs[oe].getStart(nativeAst);assert(!oldSeg.length||newSeg.length===0,'changed statement-count segment requires explicit review: '+reason);const after=newSeg.length?separator+newSeg.map(x=>x.getText(newAst)).join(separator)+separator:'';out.push({start:at,end:oldSeg.length?stop:at,before:nativeAst.text.slice(at,oldSeg.length?stop:at),after,reason:reason+' bounded statement insertion/removal'});}}}
 walk(oldNode,newNode,nativeNode);return out;
}
export function moduleAliases(actual,source,extra={}){
 const marker='// '+source;const parts=[];let at=actual.indexOf(marker);while(at>=0){const end=actual.indexOf('\n// ',at+marker.length);parts.push([at,end<0?actual.length:end]);at=actual.indexOf(marker,at+marker.length);}
 assert(parts.length,'actual module marker '+source);const map={...extra},a=parse(actual);for(const n of a.statements){if(!parts.some(([start,end])=>n.getStart(a)>=start&&n.getStart(a)<end))continue;if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings))for(const p of n.importClause.namedBindings.elements)map[p.propertyName?.text??p.name.text]=p.name.text;for(const d of ts.isVariableStatement(n)?n.declarationList.declarations:ts.isFunctionDeclaration(n)?[n]:[]){if(!d.name||!ts.isIdentifier(d.name))continue;const name=d.name.text,base=name.replace(/^__ir_(?:front|admin)_[a-f0-9]+_(?:import_)?/,'').replace(/\d+$/,'');if(map[base]&&map[base]!==name)continue;map[base]=name;map[name]??=name;}}return map;
}

export function adaptExpression(s,map){const code=adapt("const __abiExpression=("+s+");",map),a=parse(code);return declaration(a,"__abiExpression").initializer.expression.getText(a);}

// Only the fixed eight front-realm assignments at the ORIGINAL declaration statement.end.
// No string-prefix, wildcard insert, extra expression, or generic boundary authorization.
export const FIXED_STOCK_CAPABILITIES=Object.freeze({
 'inbound.companyStockReconciliationCandidates':'INVENTORY_INBOUND_READ',
 'inbound.reconcileCompanyStock':'INVENTORY_INBOUND',
 'crmSalesOrder.companyStockCandidates':'SALES_ORDER_READ',
 'crmSalesOrder.previewCompanyStock':'SALES_ORDER_READ',
 'crmSalesOrder.createCompanyStock':'SALES_ORDER',
 'crmSalesOrder.allocateCompanyStock':'SALES_ORDER',
 'crmSalesOrder.shipCompanyStock':'SALES_ORDER',
 'crmSalesOrder.updateSalesExpenses':'SALES_ORDER'
});
export function fixedCapabilityInsertion(nativeAst,sourceAst,start,end,payload){
 const caps=declaration(nativeAst,'BUSINESS_METHOD_CAPABILITIES');
 if(start!==end||start!==caps.parent.parent.end)return null;
 const a=parse(payload),statement=one(a.statements,'one fixed capability statement');
 assert(ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression),'fixed capability assignment AST');
 const assignment=statement.expression,left=assignment.left;
 assert(assignment.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isElementAccessExpression(left)&&ts.isIdentifier(left.expression)&&left.expression.text==='BUSINESS_METHOD_CAPABILITIES'&&ts.isStringLiteral(left.argumentExpression),'fixed ORIGINAL capability symbol and literal ID');
 const id=left.argumentExpression.text,constant=FIXED_STOCK_CAPABILITIES[id];
 assert(Object.hasOwn(FIXED_STOCK_CAPABILITIES,id),'only exact eight capability IDs');
 const direct=nodes(sourceAst,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isElementAccessExpression(n.left)&&n.left.expression.text==='BUSINESS_METHOD_CAPABILITIES'&&n.left.argumentExpression.text===id);
 const loops=sourceAst.statements.filter(n=>ts.isForOfStatement(n)&&ts.isArrayLiteralExpression(n.expression)&&n.expression.elements.some(x=>ts.isStringLiteral(x)&&x.text===id));
 const actual=direct.length?one(direct,'source fixed direct capability '+id):one(nodes(one(loops,'source fixed capability loop '+id).statement,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isElementAccessExpression(n.left)&&n.left.expression.text==='BUSINESS_METHOD_CAPABILITIES'),'source fixed loop assignment '+id);
 assert(ts.isIdentifier(actual.right)&&actual.right.text===constant&&equal(assignment.right,actual.right),'exact source AST capability value '+id);
 const sourceValue=declaration(sourceAst,constant).initializer,nativeValue=declaration(nativeAst,constant).initializer;
 assert(ts.isObjectLiteralExpression(sourceValue)&&sourceValue.properties.length===2&&equal(sourceValue,nativeValue),'source and ORIGINAL capability mode/permission AST '+id);
 const mode=property(sourceValue,'mode').initializer,permission=property(sourceValue,'permission').initializer;
 assert(ts.isStringLiteral(mode)&&mode.text===(constant.endsWith('_READ')?'read':'write')&&ts.isStringLiteral(permission)&&permission.text===(id.startsWith('inbound.')?'inventory.inbound':'sales.business_orders'),'fixed real mode/permission '+id);
 return id;
}
export function exactOutboundPackageInsertion(nativeAst,sourceAst,start,end,payload){
 if(start!==end)return null;
 const pins={outboundDataObject:'b257156ca5e15f446cc36565ddb2ef534bae469f806ead5f7aee621751180870',outboundPayloadHash:'277b35d7bf0e8be029c5ce2cf97c25ee0b4b4e55b0f19a2f587f299e604c0980'};
 for(const[name,pin]of Object.entries(pins)){
  const original=declaration(nativeAst,name),object=one(nodes(original,ts.isObjectLiteralExpression),'exact outbound object '+name);
  if(start!==object.getStart(nativeAst)+1)continue;
  assert(H(original.getText(nativeAst))===pin,'original outbound package insertion preimage '+name);
  const a=parse('const __slot={'+payload+'};'),next=declaration(a,'__slot').initializer;
  assert(next.properties.length===1&&next.properties[0].name?.text==='packageType','only one exact outbound packageType property');
  const sourceObject=one(nodes(declaration(sourceAst,name),ts.isObjectLiteralExpression),'source outbound object '+name),sourceProperty=property(sourceObject,'packageType');
  const adapted=parse(adapt('const __slot={'+sourceProperty.getText(sourceAst)+'};',{z:'z28'})),actual=property(declaration(adapted,'__slot').initializer,'packageType');
  assert(equal(next.properties[0],actual),'exact final-source outbound packageType AST '+name);
  const pinnedValue=parse(name==='outboundDataObject'?'const __slot={packageType:z28.string().max(64).optional()};':'const __slot={packageType:input.packageType ?? null};');
  assert(equal(actual,property(declaration(pinnedValue,'__slot').initializer,'packageType')),'only reviewed outbound packageType value '+name);
  return name;
 }
 return null;
}
