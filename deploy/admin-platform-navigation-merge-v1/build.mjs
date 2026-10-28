import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname);
const sourceRoot = path.resolve(root, '../../client/src');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const assert = (value, message) => { if (!value) throw new Error(message); };
const main = '/assets/51-ordering-information-a40a0c1191ff8253/index-BOdW8NbX.js';
const key = '/assets/51-ordering-information-a40a0c1191ff8253/DashboardLayout-D56MNqM7.js';
const oldTarget = '/assets/DashboardLayout-workbench-navigation-092c0021d3342d8e.js';
const oldRuntime = '/assets/AdminWorkbenchNavigation-5a444a56f1ed1e9c.js';
const stylesheet = '/assets/AdminWorkbenchNavigation-03bc84b6de5c6901.css';
const html = fs.readFileSync(path.join(root, 'baseline/index.html'), 'utf8');
const original = fs.readFileSync(path.join(root, 'baseline/DashboardLayout-live.js'), 'utf8');
assert(hash(original) === '092c0021d3342d8eeccf030115a8932ff1d1e9f43e7093346821179f90970ce0', 'Unknown live layout');
assert(hash(fs.readFileSync(path.join(root, 'baseline', path.basename(oldRuntime)))) === '5a444a56f1ed1e9c6faf0b4654aec4d2b3cb205b66c537ca030a7ee0a34d1180', 'Unknown live nav');
assert(hash(fs.readFileSync(path.join(root, 'baseline', path.basename(stylesheet)))) === '03bc84b6de5c6901bab300bd20c0682afb1e12e2d6c1c21961d2429c6214a94a', 'Unknown stylesheet');
const maps = [...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)];
assert(maps.length === 1, 'Expected one importmap');
const imports = JSON.parse(maps[0][1]).imports;
assert(imports[key] === oldTarget && html.split(oldTarget).length === 2, 'Unknown live map');
assert(html.includes(stylesheet) && html.includes('data-admin-workbench-navigation="v1"'), 'Existing navigation CSS missing');
const files = [];
function save(prefix, bytes) {
  const sha256 = hash(bytes);
  const name = `${prefix}-${sha256.slice(0,16)}.js`;
  fs.writeFileSync(path.join(out,name),bytes);
  files.push({name,sha256,bytes:Buffer.byteLength(bytes)});
  return '/assets/'+name;
}
const bridges = {
  react: `import{r as R}from${JSON.stringify(main)};export const{useState,useEffect,useMemo,useRef,useCallback,useLayoutEffect}=R;export default R;`,
  'react/jsx-runtime': `import{j as J}from${JSON.stringify(main)};export const{jsx,jsxs,Fragment}=J;`,
};
const result = await build({
  entryPoints:[path.join(sourceRoot,'components/admin/AdminWorkbenchNavigation.tsx')],
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',minify:true,jsx:'automatic',
  plugins:[{name:'actual-admin-react',setup(b){
    b.onResolve({filter:/^(react|react\/jsx-runtime)$/},x=>({path:x.path,namespace:'live'}));
    b.onLoad({filter:/.*/,namespace:'live'},x=>({contents:bridges[x.path],loader:'js'}));
    b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
  }}],external:[main],
});
assert(result.outputFiles.length === 1,'Only one navigation module');
const runtime = save('AdminWorkbenchNavigation-platform',result.outputFiles[0].contents);
const literal = JSON.stringify(oldRuntime);
assert(original.split(literal).length === 2,'Expected one navigation dependency literal');
const candidate = original.replace(literal,JSON.stringify(runtime));
assert(candidate.replace(JSON.stringify(runtime),literal) === original,'Layout outside dependency changed');
const parsed = ts.createSourceFile('candidate.js',candidate,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert(parsed.parseDiagnostics.length === 0,'Invalid candidate JS');
const layout = save('DashboardLayout-platform-navigation',candidate);
const after = html.replace(oldTarget,layout);
assert(after.replace(layout,oldTarget) === html,'HTML outside one pointer changed');
const afterMap = JSON.parse([...after.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)][0][1]);
assert(JSON.stringify(afterMap.imports) === JSON.stringify({...imports,[key]:layout}),'Other mappings changed');
fs.writeFileSync(path.join(out,'index.html'),after);
const manifest = {
  schema:'admin-platform-navigation-merge-v1',files,key,oldTarget,layout,runtime,oldRuntime,stylesheet,
  oldHtmlSha256:hash(html),newHtmlSha256:hash(after),oldLayoutSha256:hash(original),
  oldRuntimeSha256:'5a444a56f1ed1e9c6faf0b4654aec4d2b3cb205b66c537ca030a7ee0a34d1180',
  stylesheetSha256:'03bc84b6de5c6901bab300bd20c0682afb1e12e2d6c1c21961d2429c6214a94a',
  exactHtmlOneLiteral:true,exactLayoutOneDependencyLiteral:true,
  unchangedLayoutBytes:Buffer.byteLength(original)-Buffer.byteLength(literal),
  scope:'admin left navigation only; merge platform groups; seven platform and three system items preserved; no stock page/API/DB/www/worker/Nginx/service changes',
};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
