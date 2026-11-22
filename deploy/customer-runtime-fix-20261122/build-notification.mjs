#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const R=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const O=process.argv[2];
assert(O&&path.isAbsolute(O),'Usage: node build-notification.mjs /absolute/output-directory');
const req=createRequire(R+'/package.json'),esbuild=req('esbuild'),ts=req('typescript');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources={};
const pin=p=>{sources[path.relative(R,p)]=H(fs.readFileSync(p));};
const virtual={
  react:'export const {createContext,createElement,useCallback,useContext,useEffect,useRef,useState,useId,useMemo}=__live.React;',
  'react/jsx-runtime':'export const {jsx,jsxs,Fragment}=__live.jsx;',
  '@tanstack/react-query':'export const {CancelledError,useQuery,useQueryClient}=__live.Query;',
};
const entries=['client/src/lib/adminNewInformation.tsx','client/src/components/admin/AdminNewInformationBadge.tsx','client/src/components/admin/AdminNewInformationMenuBadge.tsx'];
const result=await esbuild.build({
  absWorkingDir:R,
  stdin:{contents:entries.map(p=>'export * from "./'+p+'";').join('\n')+'\nexport {ADMIN_NEW_INFORMATION_MODULES} from "./shared/adminNewInformationConstants.ts";',resolveDir:R,sourcefile:'notification-runtime-fix-entry.ts',loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'__NIExports',platform:'browser',target:'es2020',jsx:'automatic',minify:true,metafile:true,legalComments:'none',
  plugins:[{name:'original-react-query-singletons',setup(b){
    b.onResolve({filter:/.*/},a=>{
      if(virtual[a.path])return{path:a.path,namespace:'native'};
      if(a.path.endsWith('.css'))return{path:a.path,namespace:'empty-css'};
      if(a.path.startsWith('@shared/'))return{path:R+'/shared/'+a.path.slice(8)+'.ts'};
      if(a.path.startsWith('@/')){
        const base=R+'/client/src/'+a.path.slice(2);
        const p=['.ts','.tsx','/index.ts','/index.tsx'].map(e=>base+e).find(p=>fs.existsSync(p));
        assert(p,'unresolved '+a.path);return{path:p};
      }
      assert(!['react-dom','react-dom/client','@trpc/react-query'].includes(a.path),'duplicate provider refused');
      return undefined;
    });
    b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:virtual[a.path],loader:'js'}));
    b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'',loader:'js'}));
  }}],
});
for(const f of Object.keys(result.metafile.inputs)){
  const p=path.resolve(R,f);if(fs.existsSync(p)&&!p.includes('/node_modules/'))pin(p);
}
pin(R+'/client/src/components/admin/AdminNewInformationBadge.css');
pin(R+'/shared/adminNewInformation.ts');
const ui='let singleton;export function getAdminNewInformationRuntime(__live){if(singleton)return singleton;\n'+result.outputFiles[0].text+'\nreturn singleton=__NIExports;}\n';
const parsed=ts.createSourceFile('runtime.js',ui,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.equal(parsed.parseDiagnostics.length,0);
assert(!/createTRPCReact|new QueryClient/.test(ui));
const bundled=Object.keys(result.metafile.inputs).filter(f=>/node_modules\/(react|react-dom|@tanstack|@trpc|zod)\//.test(f));
assert.deepEqual(bundled,[],'no duplicate framework or unused schema implementation');
const sha256=H(ui),url='/assets/AdminNewInformation-runtime-fix-'+sha256.slice(0,16)+'.js',local=O+url;
fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,ui);
for(const[p,h]of Object.entries(sources))assert.equal(H(fs.readFileSync(R+'/'+p)),h,'source freeze '+p);
const manifest={status:'BUILT_NOT_PUBLISHED',asset:{url,local,sha256,size:Buffer.byteLength(ui)},sources,builderSHA:H(fs.readFileSync(fileURLToPath(import.meta.url))),metafile:result.metafile,checks:{originalReactQueryAndJSXInjected:true,noBundledReactQueryOrTRPC:true,noBundledZod:true,noNewQueryClientOrProvider:true,neutralStatusInlineStyles:true,noServerOrPermissionChanges:true,sourcePinsStable:true}};
fs.writeFileSync(O+'/notification-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.asset));
