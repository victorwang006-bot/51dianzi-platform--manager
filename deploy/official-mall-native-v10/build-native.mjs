import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AR,FR,H,read,assert,one,parse,nodes,ts,esbuild,delta} from '../self-operated-mall-plan-20261116/static-build/core.mjs';
const D=path.dirname(fileURLToPath(import.meta.url)),O=D+'/native';
assert(!fs.existsSync(O),'fresh native output required');fs.mkdirSync(O,{recursive:true});
const sourceHashes={},pin=p=>{sourceHashes[p]=H(fs.readFileSync(p));return read(p)};
const allowedPackages=new Set(['node:crypto','crypto','@trpc/server','zod','drizzle-orm','drizzle-orm/mysql-core']);
async function compile(role){
 const repo=role==='admin'?AR:FR;
 const entry=repo+'/server/routers/'+(role==='admin'?'officialMall.ts':'officialMallPublic.ts');
 const nativeCore=AR+'/server/_core/trpc.ts',nativeDb=AR+'/server/db.ts',nativeAccess=AR+'/server/services/officialChannelAccess.ts';
 const nativeSchema=AR+'/drizzle/schema.ts',nativeTeams=AR+'/drizzle/officialChannelSchema.ts';
 const bridges=new Map([[nativeCore,'export const {router,adminProcedure,publicProcedure}=native;'],[nativeDb,'export const {getDb}=native;'],[nativeAccess,'export const {loadOfficialAccess,assertOfficialRecordAction,officialTeamPredicate,officialActorFromContext}=native;'],[nativeSchema,'export const {adminUsers,adminUserPermissions,materials}=native;'],[nativeTeams,'export const {officialChannelTeams,officialChannelTeamMembers}=native;']]);
 const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,legalComments:'none',plugins:[{name:'current-production-native-abi',setup(b){b.onResolve({filter:/.*/},a=>{if(a.path.startsWith('@shared/'))return {path:path.join(repo,'shared',a.path.slice(8))+'.ts'};if(a.path.startsWith('.')){let p=path.resolve(a.resolveDir,a.path);if(!path.extname(p))p+='.ts';if(bridges.has(p))return{path:p,namespace:'native'};}return undefined});b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:bridges.get(a.path),loader:'ts'}));}}]});
 const text=result.outputFiles[0].text,a=parse(text),imports=a.statements.filter(ts.isImportDeclaration),exports=a.statements.filter(ts.isExportDeclaration);
 for(const i of imports)assert(allowedPackages.has(i.moduleSpecifier.text),'unknown runtime external '+i.moduleSpecifier.text);
 const remove=[...imports,...exports].map(n=>({start:n.getStart(a),end:n.end,before:text.slice(n.getStart(a),n.end),after:'',reason:'move module syntax outside native factory'}));
 const body=delta(text,remove).next;
 const ret=role==='admin'?'{officialMall:officialMallRouter,officialMallPublic:officialMallPublicRouter,createService:createOfficialMallService}':'{officialMall:createOfficialMallPublicRouter(native)}';
 const module=imports.map(n=>n.getText(a)).join('\n')+'\nexport function createOfficialMallRuntime(native){\n'+body+'\nreturn '+ret+';\n}\n';parse(module);
 const h=H(module),name='officialMall.'+role+'.'+h+'.runtime.mjs';fs.writeFileSync(O+'/'+name,module);
 for(const f of Object.keys(result.metafile.inputs)){const p=path.resolve(f);if(fs.existsSync(p)&&!p.includes('/node_modules/'))pin(p);}
 pin(entry);
 return{name,sha256:h,module,metafile:result.metafile};
}
const compiled={},extraRuntime=[];for(const role of ['admin','front']){
 const r=await compile(role);compiled[role]={name:r.name,sha256:r.sha256};
 const original=read(D+'/baseline/'+role+'.js'),a=parse(original);
 const root=one(a.statements.flatMap(n=>ts.isVariableStatement(n)?[...n.declarationList.declarations]:[]).filter(n=>n.name?.text==='appRouter'),'native root '+role);
 assert(ts.isCallExpression(root.initializer)&&ts.isObjectLiteralExpression(root.initializer.arguments[0]),'native root object');
 const object=root.initializer.arguments[0],props=object.properties;
 assert(!props.some(p=>p.name?.text==='officialMall'||p.name?.text==='officialMallPublic'),'new root names already present');
 const deps=role==='admin'?'router,adminProcedure,publicProcedure,getDb,loadOfficialAccess,assertOfficialRecordAction,officialTeamPredicate,officialActorFromContext,officialChannelTeams,officialChannelTeamMembers,adminUsers,adminUserPermissions,materials':'router,publicProcedure';
 const prefix='import {createOfficialMallRuntime as __createOfficialMallNativeV10} from "../runtime/'+r.name+'";\n';
 const reg='const __officialMallNativeV10=__createOfficialMallNativeV10({'+deps+'});\n';
 const start=root.parent.parent.getStart(a);
 const patches=[{start:0,end:0,before:'',after:prefix,reason:'one additive isolated runtime'}, {start,end:start,before:'',after:reg,reason:'native factory after current schema/core definitions'}, {start:object.getStart(a)+1,end:object.getStart(a)+1,before:'',after:role==='admin'?'\n officialMall:__officialMallNativeV10.officialMall, officialMallPublic:__officialMallNativeV10.officialMallPublic,\n':'\n officialMall:__officialMallNativeV10.officialMall,\n',reason:'new independent native root routes'}];
 if(role==='admin'){
  const br=one(a.statements.flatMap(n=>ts.isVariableStatement(n)?[...n.declarationList.declarations]:[]).filter(n=>n.name?.text==='businessRouter'),'old business root');
  const ob=br.initializer.arguments[0],old=one(ob.properties.filter(p=>p.name?.text==='mallInventory'),'legacy wrong inventory router');
  const st=old.getStart(a);let end=old.end;while(/\s/.test(original[end]))end++;assert(original[end]===',','legacy comma');end++;
  patches.push({start:st,end,before:original.slice(st,end),after:'',reason:'retire old front-workbench mall-stock forwarding only'});
 }else{
  // Keep every ordinary-inventory visibility/order gate; no old owner-company auto self badge.
  const old=JSON.parse(read(D+'/previous-release-manifest.json')).add.find(x=>x.kind==='runtime'&&x.source.includes('.front.'));
  const legacyPath='/home/ubuntu/work/self-operated-mall-v9-conflict-20261116/package/'+old.source;
  const legacy=pin(legacyPath);assert(H(legacy)===old.sha256,'frozen old public gate runtime');
  const la=parse(legacy),f=one(nodes(la,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mallPublicPolicy'),'actual legacy policy');
  const field=one(nodes(f,n=>ts.isShorthandPropertyAssignment(n)&&n.name?.text==='self'),'only actual self return');
  const early=one(nodes(f,n=>ts.isPropertyAssignment(n)&&n.name?.text==='self'&&ts.isTaggedTemplateExpression(n.initializer)),'false fallback SQL ABI');
  const patched=delta(legacy,[{start:field.getStart(la),end:field.end,before:field.getText(la),after:'self:'+early.initializer.getText(la),reason:'retain legacy gate predicate; ordinary inventory is never native official source'}]);
  const h=H(patched.next),name='mallNative.front.officialOnly.'+h+'.runtime.mjs';fs.writeFileSync(O+'/'+name,patched.next);
  extraRuntime.push({name,sha256:h,oldName:path.basename(old.source),inverseVerified:patched.inverseVerified});
  const imported=one(a.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text.endsWith(path.basename(old.source))),'exact legacy runtime import');
  patches.push({start:imported.moduleSpecifier.getStart(a),end:imported.moduleSpecifier.end,before:imported.moduleSpecifier.getText(a),after:JSON.stringify('../runtime/'+name),reason:'point ordinary public policy at sole self-marker correction'});
 }
 const d=delta(original,patches);parse(d.next);fs.writeFileSync(O+'/'+role+'.js',d.next);
 fs.writeFileSync(O+'/'+role+'-delta.json',JSON.stringify({inverseVerified:d.inverseVerified,patches:d.patches,beforeSha256:H(original),afterSha256:H(d.next)},null,2)+'\n');
 assert(d.inverseVerified,'native outside delta exact');
}
for(const[p,h]of Object.entries(sourceHashes))assert(H(fs.readFileSync(p))===h,'native source drift '+p);
fs.writeFileSync(O+'/manifest.json',JSON.stringify({scope:'official-mall-native-v10',compiled,extraRuntime,sourceHashes,checks:{syntax:true,inverseOutsideHunks:true,noOldInventoryCopy:true,noWorkerChanges:true,noNativeAuthRebuild:true,legacyMallForwardingRetired:true}},null,2)+'\n');console.log(JSON.stringify({compiled,checks:'bounded native runtime/registration only'}));
