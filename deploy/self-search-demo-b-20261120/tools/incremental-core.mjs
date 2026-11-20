import crypto from 'node:crypto';import {ts,eb,need,program,walk,explicitKeys,alphaEqual} from './parity-core.mjs';
export const H=b=>crypto.createHash('sha256').update(b).digest('hex');
export function single(v,m){need(v.length===1,m+' expected 1 got '+v.length);return v[0]}
export function parseSource(text,file='source.tsx'){const a=ts.createSourceFile(file,text,99,true,ts.ScriptKind.TSX);need(!a.parseDiagnostics.length,'SOURCE_PARSE');return a}
export function findFn(a,name){const v=[];walk(a,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)v.push(n)});return single(v,'EXACT_FN '+name)}
export function lastReturn(fn){return single(fn.body.statements.filter(ts.isReturnStatement),'ONE_TOP_RETURN')}
export function style(a,name){const v=[];walk(a,n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(a)===name)v.push(n)});const n=single(v,'STYLE '+name);need(ts.isStringLiteralLike(n.initializer),'STYLE_LITERAL');return n.initializer}
export function patch(text,edits){
 const original=Buffer.from(text),ordered=[...edits].sort((a,b)=>a.start-b.start),parts=[],rows=[];let last=0,delta=0;
 for(const e of ordered){const start=Buffer.byteLength(text.slice(0,e.start)),end=Buffer.byteLength(text.slice(0,e.end)),after=Buffer.from(e.after);need(start>=last&&end>=start,'PATCH_OVERLAP');parts.push(original.subarray(last,start),after);rows.push({start,end,outputStart:start+delta,beforeBase64:original.subarray(start,end).toString('base64'),afterBase64:after.toString('base64'),reason:e.reason});delta+=after.length-(end-start);last=end}
 parts.push(original.subarray(last));const bytes=Buffer.concat(parts);need(reverse(bytes,rows).equals(original),'EXACT_INVERSE');return{bytes,proof:{beforeSha256:H(original),afterSha256:H(bytes),inverseVerified:true,patches:rows}};
}
export function reverse(bytes,rows){let out=bytes;for(const r of [...rows].reverse()){const after=Buffer.from(r.afterBase64,'base64');need(out.subarray(r.outputStart,r.outputStart+after.length).equals(after),'REVERSE_RANGE');out=Buffer.concat([out.subarray(0,r.outputStart),Buffer.from(r.beforeBase64,'base64'),out.subarray(r.outputStart+after.length)])}return out}
export function importEdit(text,from,to){const{file}=program(text);const n=single(file.statements.filter(ts.isImportDeclaration).filter(n=>n.moduleSpecifier.text===from),'ONLY_TARGET_IMPORT').moduleSpecifier;return{start:n.getStart(file),end:n.end,after:JSON.stringify(to),reason:'Only dependency ImportDeclaration.moduleSpecifier quoted token'}}
export async function compileRender(expression,additional=[],card=false){
 const contents=`export function __Render(){${additional.join('\n')}return ${expression};}`;
 const result=await eb.build({stdin:{contents,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',jsx:'automatic',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,metafile:true,treeShaking:true,logLevel:'silent',define:card?{Zap:'__SEED_LUCIDE.Zap',ShoppingCart:'__SEED_LUCIDE.ShoppingCart'}:{},plugins:[{name:'only-existing-jsx-bridge',setup(build){build.onResolve({filter:/.*/},args=>{need(args.path==='react/jsx-runtime','RENDER_IMPORT_REJECT '+args.path);return{path:'jsx-host',namespace:'seed-host'}});build.onLoad({filter:/.*/,namespace:'seed-host'},()=>({contents:'export const jsx=__SEED_JSX,jsxs=__SEED_JSXS,Fragment=__SEED_FRAGMENT;',loader:'js'}))}}]});
 need(Object.keys(result.metafile.inputs).every(k=>k==='<stdin>'||k==='seed-host:jsx-host'),'RENDER_INPUTS');const{file}=program(result.outputFiles[0].text);const fn=single(file.statements.filter(ts.isFunctionDeclaration),'ONE_RENDER_FN');return{code:explicitKeys(fn.getText(file)),metafile:result.metafile,virtualBridge:'export const jsx=__SEED_JSX,jsxs=__SEED_JSXS,Fragment=__SEED_FRAGMENT;'};
}
export function renderBinding(compiled,oldExpr){return alphaEqual(compiled,`function __Render(){return ${oldExpr};}`)}
function keyIdentifier(n){const p=n.parent;return(ts.isPropertyAccessExpression(p)&&p.name===n)||(ts.isPropertyAssignment(p)&&p.name===n)||(ts.isBindingElement(p)&&p.propertyName===n)||(ts.isMethodDeclaration(p)&&p.name===n)}
export function transplant(render,binding,extraFree={},allowedLocals=[]){
 const normalized=explicitKeys(render),p=program(normalized),maps=new Map(),byName=new Map(),free={...binding.freeIdentifiers,...extraFree};
 for(const row of binding.localSymbols){if(row.source==='__Render')continue;if(byName.has(row.source))need(byName.get(row.source)===row.compiled,'AMBIGUOUS_SYMBOL_NAME '+row.source);byName.set(row.source,row.compiled)}
 const seenLocal=new Set(),edits=[];walk(p.file,n=>{if(!ts.isIdentifier(n)||keyIdentifier(n))return;const symbol=p.checker.getSymbolAtLocation(n);let target;
  if(symbol?.declarations?.length){if(symbol.declarations.some(d=>ts.isFunctionDeclaration(d)&&d.name?.text==='__Render'))return;
   if(!maps.has(symbol)){target=byName.get(n.text);if(!target){need(allowedLocals.includes(n.text),'UNAPPROVED_NEW_LOCAL '+n.text);target='__demoB_'+n.text;need(!seenLocal.has(target),'NEW_LOCAL_COLLISION '+n.text);seenLocal.add(target)}maps.set(symbol,target)}target=maps.get(symbol);
  }else{target=free[n.text];need(target,'UNBOUND_FREE_IDENTIFIER '+n.text)}
  if(target!==n.text)edits.push({start:n.getStart(p.file),end:n.end,after:target,reason:'scope-symbol transplant'});
 });
 const out=patch(normalized,edits).bytes.toString(),a=program(out).file,fn=single(a.statements.filter(ts.isFunctionDeclaration),'TRANSPLANT_FN');return{expression:fn.body.statements.length===1?lastReturn(fn).expression.getText(a):`(()=>${fn.body.getText(a)})()`,symbolProof:{freeIdentifiers:free,newLocals:[...seenLocal],renamedReferences:edits.length}};
}
export function htmlMigration(text,migrations){
 const edits=[],mapRanges=[],logicalKeys=[],scopes=[],classified=[];
 for(const m of text.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)){
  const json=m[1],offset=m.index+m[0].indexOf('>')+1,a=ts.parseJsonText('importmap.json',json);need(!a.parseDiagnostics.length,'IMPORTMAP_PARSE');JSON.parse(json);mapRanges.push([offset,offset+json.length]);const root=a.statements[0].expression;need(ts.isObjectLiteralExpression(root),'IMPORTMAP_ROOT');
  const props=obj=>{need(ts.isObjectLiteralExpression(obj),'IMPORTMAP_OBJECT');const names=new Set();for(const p of obj.properties){need(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.name),'IMPORTMAP_PROPERTY');need(!names.has(p.name.text),'IMPORTMAP_DUPLICATE_KEY');names.add(p.name.text)}return obj.properties};
  const token=(n,to,reason)=>{edits.push({start:offset+n.getStart(a),end:offset+n.end,after:JSON.stringify(to),reason});classified.push({role:reason,before:n.text,after:to})};
  for(const p of props(root)){
   if(p.name.text==='imports'){for(const q of props(p.initializer)){need(ts.isStringLiteral(q.initializer),'IMPORTMAP_TARGET_STRING');logicalKeys.push(q.name.text);if(migrations[q.initializer.text])token(q.initializer,migrations[q.initializer.text],'importmap physical target value; logical alias key unchanged')}}
   else if(p.name.text==='scopes'){for(const scope of props(p.initializer)){const from=scope.name.text,to=migrations[from]||from;need(!p.initializer.properties.some(q=>q!==scope&&q.name.text===to),'SCOPE_MIGRATION_COLLISION');if(to!==from){token(scope.name,to,'importmap scopes physical module key migration');scopes.push({before:from,after:to,mappingsUnchangedExceptPhysicalTargetValues:true})}for(const q of props(scope.initializer)){need(ts.isStringLiteral(q.initializer),'SCOPE_TARGET_STRING');logicalKeys.push(q.name.text);if(migrations[q.initializer.text])token(q.initializer,migrations[q.initializer.text],'scoped physical target value; old logical alias key unchanged')}}}
   else need(false,'UNEXPECTED_IMPORTMAP_TOP_KEY '+p.name.text);
  }
 }
 need(mapRanges.length===1,'EXACT_ONE_IMPORTMAP');
 for(const m of text.matchAll(/\b(?:src|href)\s*=\s*(["'])([^"']+)\1/g)){const value=m[2];if(!migrations[value])continue;const start=m.index+m[0].indexOf(m[1]);need(!mapRanges.some(([a,b])=>start>=a&&start<b),'ATTR_IN_MAP');edits.push({start,end:start+value.length+2,after:m[1]+migrations[value]+m[1],reason:'HTML exact quoted src/href physical reference'});classified.push({role:'HTML attribute',before:value,after:migrations[value]})}
 for(const [from]of Object.entries(migrations)){
  for(let i=text.indexOf(from);i>=0;i=text.indexOf(from,i+from.length)){
   if(edits.some(e=>i>=e.start&&i+from.length<=e.end))continue;
   need(mapRanges.some(([a,b])=>i>=a&&i+from.length<=b)&&logicalKeys.includes(from),'UNCLASSIFIED_HTML_REFERENCE '+from+' @'+i);
  }
 }
 need(edits.length>0,'HTML_HAS_TARGET_REFERENCES');const result=patch(text,edits),afterMap=JSON.parse([...result.bytes.toString().matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)][0][1]);
 return{...result,importmapProof:{logicalKeysPreserved:logicalKeys,scopeMigrations:scopes,classifiedQuotedReferences:classified,afterImportmapSha256:H(JSON.stringify(afterMap))}};
}
