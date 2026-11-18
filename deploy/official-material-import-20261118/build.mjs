import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
const directory=path.dirname(new URL(import.meta.url).pathname),root=path.resolve(directory,'../..');
const out=path.join(directory,'dist');fs.mkdirSync(out,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const subsets=new Map([
  [path.join(root,'drizzle/schema.ts'),['beijingTime','timestamp','DEFAULT_NOW','materials','adminUsers','adminUserPermissions']],
  [path.join(root,'drizzle/officialChannelSchema.ts'),['beijingTime','timestamp','DEFAULT_NOW','officialChannelTeams','officialChannelTeamMembers']],
]);
const subsetProof=[];
function subset(file,names){
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(ast.parseDiagnostics.length)throw Error('SOURCE_SCHEMA_SYNTAX');
 const imports=ast.statements.filter(ts.isImportDeclaration).map(node=>node.getText(ast));
 if(imports.some(text=>!/from ["']drizzle-orm(?:\/mysql-core)?["']/.test(text)))throw Error('SCHEMA_IMPORT_DRIFT');
 const selected=names.map(name=>{
  const found=ast.statements.filter(ts.isVariableStatement).filter(node=>node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name));
  if(found.length!==1)throw Error('EXACT_SCHEMA_DECLARATION_'+name);
  return found[0].getText(ast);
 });
 subsetProof.push({file:path.relative(root,file),sourceSha256:sha(source),declarations:names,exactOriginalDeclarationBytes:true});
 return imports.join('\n')+'\n'+selected.join('\n')+'\n';
}
const plugins=[{name:'exact-native-schema-subset',setup(builder){
 builder.onLoad({filter:/drizzle\/(schema|officialChannelSchema)\.ts$/},args=>subsets.has(args.path)?{contents:subset(args.path,subsets.get(args.path)),loader:'ts'}:undefined);
}}];
const result=await build({entryPoints:[path.join(directory,'runner.ts')],outfile:path.join(out,'runner.mjs'),bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,legalComments:'none',plugins});
const allowed=new Set(['node:crypto','node:fs/promises','node:path','node:url','node:util','mysql2/promise','drizzle-orm','drizzle-orm/mysql-core','drizzle-orm/mysql2','zod','@trpc/server']);
for(const entry of Object.values(result.metafile.outputs))for(const imported of entry.imports)if(imported.external&&!allowed.has(imported.path))throw Error('UNEXPECTED_EXTERNAL_'+imported.path);
for(const file of Object.keys(result.metafile.inputs))if(/server\/(db\.ts|_core\/|routers\/)|client\/|workers?\//.test(file))throw Error('OUT_OF_SCOPE_BUNDLE_INPUT_'+file);
for(const output of result.outputFiles)fs.writeFileSync(output.path,output.contents);
const sources=Object.keys(result.metafile.inputs).map(file=>({file:path.relative(root,path.resolve(file)),sha256:sha(fs.readFileSync(path.resolve(file)))}));
const artifact={file:'dist/runner.mjs',sha256:sha(result.outputFiles[0].contents)};
fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({offlineOnly:true,artifact,sourceSha256:sources,nativeSchemaSubsets:subsetProof,externalPackagesOnly:true,noServerDbImport:true,noRouterOrUIImport:true},null,2)+'\n');
console.log(JSON.stringify({artifact,schemaSubsets:subsetProof.map(proof=>proof.declarations),inputs:sources.length,offlineOnly:true}));
