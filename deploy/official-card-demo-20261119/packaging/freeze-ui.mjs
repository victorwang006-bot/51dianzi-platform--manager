import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {W,P,FR,H,ts,parse,assert,read,save,resolveFile,pin} from './core.mjs';
import {KNOWN,OLD_CARD,OLD_SEARCH} from './pack-ui.mjs';
const req=createRequire(FR+'/package.json');
const approved=JSON.parse(read(W+'/validation/final-source-freeze.json'));
const old=JSON.parse(read('/home/ubuntu/work/self-first-20261118/packaging/source-freeze.json'));
const sourceFiles={},typeOnlySourceFiles={},dependencyHashes={};
const virtual=new Set(['react','react/jsx-runtime','@/lib/trpc','wouter','@tanstack/react-query','lucide-react']);
function visit(file,typeOnly=false){file=fs.realpathSync(file);const hashes=typeOnly?typeOnlySourceFiles:sourceFiles;if(hashes[file])return;assert(!/OfficialCheckoutDialog|officialCheckout\.|\/server\//.test(file)||typeOnly,'forbidden runtime source '+file);const text=read(file);if(approved[file])pin(file,approved[file]);hashes[file]=H(text);if(typeOnly)return;const ast=parse(text,file);for(const node of ast.statements){if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;if(!node.moduleSpecifier)continue;const spec=node.moduleSpecifier.text;if(virtual.has(spec))continue;const only=node.importClause?.isTypeOnly===true||node.isTypeOnly===true;let p;if(spec.startsWith('@/'))p=FR+'/client/src/'+spec.slice(2);else if(spec.startsWith('@shared/'))p=FR+'/shared/'+spec.slice(8);else if(spec.startsWith('.'))p=path.resolve(path.dirname(file),spec);else throw Error('unexpected source dependency '+spec);visit(resolveFile(p),only);}}
function hashTree(root){root=fs.realpathSync(root);for(const n of fs.readdirSync(root)){const p=path.join(root,n),s=fs.lstatSync(p);if(s.isDirectory())hashTree(p);else if(s.isFile())dependencyHashes[p]=H(fs.readFileSync(p));else throw Error('unexpected dependency symlink '+p);}}
const entry=FR+'/client/src/components/OfficialMallSearchResults.tsx';assert(approved[entry]==='dc907af9230be42ca61890ef2581311e69fde6f4a5fe1228f012d315954f64bc','parent final entry freeze');visit(entry);
for(const[p,h]of Object.entries(typeOnlySourceFiles))sourceFiles[p]=h;
const lucideRoot=fs.realpathSync(FR+'/node_modules/lucide-react');const lucidePackage=JSON.parse(read(lucideRoot+'/package.json'));assert(lucidePackage.version==='0.453.0','installed locked lucide version');hashTree(lucideRoot);
for(const name of ['esbuild','typescript']){let p=path.dirname(req.resolve(name));while(!fs.existsSync(p+'/package.json'))p=path.dirname(p);hashTree(p);}
const esbuildBin=fs.realpathSync(createRequire(req.resolve('esbuild')).resolve('@esbuild/'+process.platform+'-'+process.arch+'/bin/esbuild'));dependencyHashes[esbuildBin]=H(fs.readFileSync(esbuildBin));dependencyHashes[fs.realpathSync(process.execPath)]=H(fs.readFileSync(process.execPath));
for(const p of [FR+'/package.json',FR+'/pnpm-lock.yaml'])dependencyHashes[p]=H(fs.readFileSync(p));
const inputs={};for(const name of ['root','catalog','ui','merchantCSS'])inputs[name]=old.inputs[name];
for(const[name,local,url]of [['html',W+'/live/index.before.html','/index.html'],['search',W+'/live/search.before.js',OLD_SEARCH],['card',W+'/live/card.before.js',OLD_CARD]])inputs[name]={local,url,sha256:KNOWN[name]};
for(const[name,x]of Object.entries(inputs)){assert(x.sha256===KNOWN[name],'known '+name);pin(x.local,x.sha256);}
const toolHashes=Object.fromEntries(['core.mjs','pack-ui.mjs','front-images.mjs'].map(n=>[P+'/'+n,H(fs.readFileSync(P+'/'+n))]));
const c={phase:'source-frozen',roles:['ui'],approvedSourceFreeze:true,parentVerifiedInputs:true,freezeApproval:'parent-demo-layout-20261118-235500',checkoutApproved:false,ui:{entry,propsType:'OfficialMallSearchResultsProps',callbacksApproved:false,lucideRoot,lucideEntry:resolveFile(lucideRoot+'/'+lucidePackage.module)},sourceFiles,typeOnlySourceFiles,dependencyHashes,toolHashes,inputs};save(P+'/ui-freeze.json',c);save(P+'/ui-freeze-hash.json',{configLocal:P+'/ui-freeze.json',sha256:H(read(P+'/ui-freeze.json')),runtimeSourceCount:Object.keys(sourceFiles).length-Object.keys(typeOnlySourceFiles).length,typeOnlySourceCount:Object.keys(typeOnlySourceFiles).length,dependencyCount:Object.keys(dependencyHashes).length,freezeApproval:c.freezeApproval});console.log(JSON.stringify({config:P+'/ui-freeze.json',sha256:H(read(P+'/ui-freeze.json')),sourceFiles,lucideRoot,dependencyCount:Object.keys(dependencyHashes).length},null,2));
