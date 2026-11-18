import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {spawnSync} from 'node:child_process';
const dir=path.dirname(new URL(import.meta.url).pathname),root=path.resolve(dir,'../..'),out=path.join(dir,'typecheck-workspace');
const files=['drizzle/officialMallSchema.ts','shared/officialMall.ts','shared/adminPermissions.ts','shared/officialMallSuggestPolicy.ts','server/services/officialMall.ts','server/services/officialChannelAccess.ts',...['input.ts','engine.ts','native.ts','runner.ts'].map(name=>'deploy/official-material-import-20261118/'+name)];
function save(relative,source){const file=path.join(out,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}
for(const file of files)save(file,fs.readFileSync(path.join(root,file),'utf8'));
for(const [file,names] of [
 ['drizzle/schema.ts',['beijingTime','timestamp','DEFAULT_NOW','materials','adminUsers','adminUserPermissions']],
 ['drizzle/officialChannelSchema.ts',['beijingTime','timestamp','DEFAULT_NOW','officialChannelTeams','officialChannelTeamMembers']],
]){
 const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const imports=ast.statements.filter(ts.isImportDeclaration).map(node=>node.getText(ast));
 const selected=names.map(name=>{
  const found=ast.statements.filter(ts.isVariableStatement).filter(node=>node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name));
  if(found.length!==1)throw Error('EXACT_DECLARATION_'+name);
  return found[0].getText(ast);
 });
 save(file,imports.join('\n')+'\n'+selected.join('\n')+'\n');
}
// The service/native CLI uses OfficialActor, never the tRPC context. This type-only boundary
// prevents unrelated giant CRM/frontend router types from affecting the scoped strict check.
save('server/_core/context.ts','export type TrpcContext = { user: { role: string } | null; adminAccount: { id: number; status: string; sessionVersion: number } | null };\n');
save('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',strict:true,skipLibCheck:true,esModuleInterop:true,noEmit:true,types:['node'],lib:['esnext','dom']},include:['**/*.ts']},null,2)+'\n');
const result=spawnSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(out,'tsconfig.json')],{encoding:'utf8',cwd:root});
fs.writeFileSync(path.join(dir,'typescript-scoped.log'),(result.stdout??'')+(result.stderr??'')+(result.status===0?'SCOPED_STRICT_TYPESCRIPT_PASS\n':''));
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
console.log(JSON.stringify({scopedStrictCheck:result.status===0,exactRuntimeSourceCopies:true,exactNativeSchemaSubsets:true,typeOnlyContextBoundary:true}));
process.exitCode=result.status??1;
