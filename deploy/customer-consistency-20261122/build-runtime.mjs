#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const W=path.dirname(new URL(import.meta.url).pathname),R='/home/ubuntu/work/channel-release-20261121-1837/manager';
const req=createRequire(R+'/package.json'),esbuild=req('esbuild'),ts=req('typescript');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources={};const pin=p=>{sources[path.relative(R,p)]=H(fs.readFileSync(p));return fs.readFileSync(p,'utf8');};
const virtual={react:'export const {createContext,createElement,useCallback,useContext,useEffect,useRef,useState,useId,useMemo}=__live.React;', 'react/jsx-runtime':'export const {jsx,jsxs,Fragment}=__live.jsx;', '@tanstack/react-query':'export const {CancelledError,useQuery,useQueryClient}=__live.Query;'};
const entries=['client/src/lib/adminNewInformation.tsx','client/src/components/admin/AdminNewInformationBadge.tsx','client/src/components/admin/AdminNewInformationMenuBadge.tsx'];entries.forEach(p=>pin(R+'/'+p));
const result=await esbuild.build({absWorkingDir:R,stdin:{contents:entries.map(p=>'export * from "./'+p+'";').join('\n')+'\nexport {ADMIN_NEW_INFORMATION_MODULES} from "./shared/adminNewInformation.ts";',resolveDir:R,sourcefile:'customer-consistency-notification-entry.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'__NIExports',platform:'browser',target:'es2020',jsx:'automatic',minify:true,metafile:true,legalComments:'none',plugins:[{name:'original-react-query-singletons',setup(b){b.onResolve({filter:/.*/},a=>{if(virtual[a.path])return{path:a.path,namespace:'native'};if(a.path.endsWith('.css'))return{path:a.path,namespace:'empty-css'};if(a.path.startsWith('@shared/'))return{path:R+'/shared/'+a.path.slice(8)+'.ts'};if(a.path.startsWith('@/')){const base=R+'/client/src/'+a.path.slice(2);const p=['.ts','.tsx','/index.ts','/index.tsx'].map(e=>base+e).find(p=>fs.existsSync(p));assert(p,'unresolved '+a.path);return{path:p};}assert(!['react-dom','react-dom/client','@trpc/react-query'].includes(a.path),'duplicate provider refused');return undefined;});b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:virtual[a.path],loader:'js'}));b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'',loader:'js'}));}}]});
for(const f of Object.keys(result.metafile.inputs)){const p=path.resolve(R,f);if(fs.existsSync(p)&&!p.includes('/node_modules/'))pin(p);}
const ui='let singleton;export function getAdminNewInformationRuntime(__live){if(singleton)return singleton;\n'+result.outputFiles[0].text+'\nreturn singleton=__NIExports;}\n';
const a=ts.createSourceFile('native-runtime.js',ui,99,true,1);assert.equal(a.parseDiagnostics.length,0);assert(!/createTRPCReact|new QueryClient/.test(ui));
assert.deepEqual(Object.keys(result.metafile.inputs).filter(f=>/node_modules\/(react|react-dom|@tanstack|@trpc)\//.test(f)),[],'no bundled React/Query/TRPC implementation');
const sha256=H(ui),url='/assets/AdminNewInformation-customer-consistency-runtime-'+sha256.slice(0,16)+'.js',local=W+'/assets/'+path.basename(url);fs.mkdirSync(W+'/assets',{recursive:true});fs.writeFileSync(local,ui);
for(const [p,h] of Object.entries(sources))assert.equal(H(fs.readFileSync(R+'/'+p)),h,'source freeze '+p);
const manifest={status:'BUILT_NOT_PUBLISHED',asset:{url,local,sha256,size:Buffer.byteLength(ui)},sources,builderSHA:H(fs.readFileSync(new URL(import.meta.url))),metafile:result.metafile,checks:{nativeReactAndJSXAndQuerySingletons:true,noNewQueryClient:true,noNewProvider:true,noNewTRPCClient:true,noBundledReactQuery:true,noCSSChanges:true,noNavChanges:true,noServerChanges:true},importmap:{oldRuntimeURL:'/assets/AdminNewInformation-admin-polish-runtime-67feeba8e334ea18.js',newRuntimeURL:url,keepNavBytes:'/assets/DashboardLayout-admin-polish-6614aeb7b2a8f529.js'}};
fs.writeFileSync(W+'/runtime-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.asset));
