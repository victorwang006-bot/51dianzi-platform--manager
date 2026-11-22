#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const W=path.dirname(new URL(import.meta.url).pathname),R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const req=createRequire(R+'/package.json'),esbuild=req('esbuild'),ts=req('typescript'),H=x=>crypto.createHash('sha256').update(x).digest('hex');
const implementation=JSON.parse(fs.readFileSync(R+'/deploy/header-notification-removal-20261122-1902/manifest.json'));
for(const [p,h] of Object.entries(implementation.protectedSourcePins))assert.equal(H(fs.readFileSync(R+'/'+p)),h,'PROTECTED_SOURCE '+p);
for(const p of implementation.deleted)assert(!fs.existsSync(R+'/'+p),'STATUS_SOURCE_NOT_DELETED '+p);
const sources={};
const virtual={react:'export const {createContext,createElement,useCallback,useContext,useEffect,useRef,useState,useId,useMemo}=__live.React;', 'react/jsx-runtime':'export const {jsx,jsxs,Fragment}=__live.jsx;', '@tanstack/react-query':'export const {CancelledError,useQuery,useQueryClient}=__live.Query;'};
const entries=['client/src/lib/adminNewInformation.tsx','client/src/components/admin/AdminNewInformationBadge.tsx','client/src/components/admin/AdminNewInformationMenuBadge.tsx'];
const result=await esbuild.build({absWorkingDir:R,stdin:{contents:entries.map(p=>'export * from "./'+p+'";').join('\n')+'\nexport {ADMIN_NEW_INFORMATION_MODULES} from "./shared/adminNewInformation.ts";',resolveDir:R,sourcefile:'notification-ui-removal-entry.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'__NIExports',platform:'browser',target:'es2020',jsx:'automatic',minify:true,metafile:true,legalComments:'none',plugins:[{name:'original-singletons',setup(b){b.onResolve({filter:/.*/},a=>{if(virtual[a.path])return{path:a.path,namespace:'native'};if(a.path.endsWith('.css'))return{path:a.path,namespace:'empty-css'};if(a.path.startsWith('@shared/'))return{path:R+'/shared/'+a.path.slice(8)+'.ts'};if(a.path.startsWith('@/')){const base=R+'/client/src/'+a.path.slice(2);const p=['.ts','.tsx','/index.ts','/index.tsx'].map(e=>base+e).find(p=>fs.existsSync(p));assert(p,'unresolved '+a.path);return{path:p};}assert(!['react-dom','react-dom/client','@trpc/react-query'].includes(a.path),'duplicate provider refused');return undefined;});b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:virtual[a.path],loader:'js'}));b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'',loader:'js'}));}}]});
for(const f of Object.keys(result.metafile.inputs)){const p=path.resolve(R,f);if(fs.existsSync(p)&&!p.includes('/node_modules/'))sources[p]=H(fs.readFileSync(p));}
const runtime='let singleton;export function getAdminNewInformationRuntime(__live){if(singleton)return singleton;\n'+result.outputFiles[0].text+'\nreturn singleton=__NIExports;}\n';
const ast=ts.createSourceFile('notification-runtime.js',runtime,99,true,1);assert.equal(ast.parseDiagnostics.length,0);
assert(!/new QueryClient|createTRPCReact|AdminNewInformationStatus|admin-new-information-status__panel/.test(runtime));
assert.deepEqual(Object.keys(result.metafile.inputs).filter(f=>/node_modules\/(react|react-dom|@tanstack|@trpc)\//.test(f)),[]);
for(const[p,h]of Object.entries(sources))assert.equal(H(fs.readFileSync(p)),h,'source remained frozen '+p);
const sha=H(runtime),url='/assets/AdminNewInformation-ui-removal-'+sha.slice(0,16)+'.js',local=W+'/notification-candidate'+url;
fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,runtime);
const asset={url,local,sha256:sha,size:Buffer.byteLength(runtime)};
const manifest={scope:'header-ui-release-20261122-1928',assets:[asset],replacements:{'/assets/AdminNewInformation-notification-redesign-8a0443b2848920b4.js':url},sourcePins:sources,checks:{statusCodeAndExportRemoved:true,coreSourcePinsUnchanged:true,existingReactJSXQuerySingletons:true,noBundledReactQuery:true,noNewTRPC:true,noWholeSiteBuild:true},tests:{syntax:true,protectedCore:true,statusAbsent:true},metafile:result.metafile};
fs.writeFileSync(W+'/notification-candidate/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'NOTIFICATION_STATUS_REMOVED_CANDIDATE',asset,sourceFiles:Object.keys(sources).length}));
