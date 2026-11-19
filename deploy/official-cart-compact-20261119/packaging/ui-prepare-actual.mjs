import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {P,W,FR,H,ts,parse,declaration,selectedSource,resolveLocal,resolveFile,REQUIRED_EXECUTION_FILES,save,write,assert} from './core.mjs';
const req=createRequire(FR+'/package.json'), symbols=JSON.parse(fs.readFileSync(P+'/capture-ui-symbols.json')), files=JSON.parse(fs.readFileSync(P+'/capture-file-hashes.json')).files;
const B=P+'/ui-bridge'; fs.mkdirSync(B,{recursive:true});
const src=n=>FR+'/client/src/'+n;
const selections={
 [src('hooks/useOfficialCart.ts')]:['createOfficialCartHooks'],
 [src('components/OfficialMallCheckoutResults.tsx')]:['createOfficialMallCheckoutResults'],
 [src('components/OfficialCartSection.tsx')]:['selectedSubtotal','createOfficialCartSection'],
 [src('components/OfficialCartCheckoutPanel.tsx')]:['officialCartSignature','createOfficialCartCheckoutPanel'],
};
write(B+'/entry.ts',`import {createOfficialCartHooks} from ${JSON.stringify(src('hooks/useOfficialCart.ts'))};
import {createOfficialMallCheckoutResults} from ${JSON.stringify(src('components/OfficialMallCheckoutResults.tsx'))};
import {createOfficialCartSection} from ${JSON.stringify(src('components/OfficialCartSection.tsx'))};
import {createOfficialCartCheckoutPanel} from ${JSON.stringify(src('components/OfficialCartCheckoutPanel.tsx'))};
import {OfficialMallSearchResults} from ${JSON.stringify(src('components/OfficialMallSearchResults.tsx'))};
import {showOfficialCartNotice} from ${JSON.stringify(src('components/OfficialCartNotice.tsx'))};
import {combinedCartKinds} from ${JSON.stringify(src('lib/officialCartClient.ts'))};
import PaymentQrDialog from ${JSON.stringify(src('components/PaymentQrDialog.tsx'))};
export function instantiate(live:any){
 const hooks=createOfficialCartHooks(live);
 const panel=createOfficialCartCheckoutPanel({...live,...hooks,PaymentQrDialog});
 const section=createOfficialCartSection({...live,...hooks,OfficialCartCheckoutPanel:panel});
 const wrapper=createOfficialMallCheckoutResults({...live,...hooks,OfficialMallSearchResults,notice:showOfficialCartNotice,error:(message:string)=>live.toast.error(message)});
 function useCombinedCartCount(ordinary:any){const official=hooks.useOfficialCartCount();return {...ordinary,data:combinedCartKinds(ordinary.data,official.count)};}
 return {...hooks,OfficialCartSection:section,OfficialMallSearchResults:wrapper,useCombinedCartCount};
}
`);
const lucideRoot=path.dirname(req.resolve('lucide-react/package.json'))+'/dist/esm', iconNames=['ShoppingCart','Zap','Maximize2','Minus','Plus','RotateCcw','RotateCw','X','AlertTriangle','Check','Copy','LoaderCircle','ShieldCheck'];
const barrel=fs.readFileSync(lucideRoot+'/lucide-react.js','utf8');
const iconLines=iconNames.map(name=>{const a=parse(barrel), stmt=a.statements.find(n=>ts.isExportDeclaration(n)&&n.exportClause&&ts.isNamedExports(n.exportClause)&&n.exportClause.elements.some(e=>e.name.text===name));assert(stmt,'EXACT_LUCIDE_ICON '+name);const e=stmt.exportClause.elements.find(e=>e.name.text===name);return 'export {'+(e.propertyName?.text||name)+' as '+name+'} from '+JSON.stringify(path.resolve(lucideRoot,stmt.moduleSpecifier.text))+';';});
write(B+'/lucide.ts',iconLines.join('\n')+'\n');
const qrRoot=path.dirname(req.resolve('qrcode.react'));
const qr=fs.existsSync(qrRoot+'/index.mjs')?qrRoot+'/index.mjs':qrRoot+'/esm/index.js';assert(fs.existsSync(qr),'QR_ESM_ENTRY');
const rootInput='routeRoot', rootAst=parse(fs.readFileSync(symbols.routeRoot.local,'utf8'));
const proof=name=>({input:rootInput,declaration:name,nodeSha256:H(declaration(rootAst,name).getText(rootAst))});
const productionReactNames=JSON.parse(fs.readFileSync(W+'/validation/native-production-react-slots.json','utf8'));
const reactNames=Object.keys(req('react')).filter(n=>/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)&&productionReactNames.includes(n));
assert(!reactNames.includes('act')&&reactNames.includes('useState')&&reactNames.includes('useSyncExternalStore'),'PRODUCTION_REACT_SLOTS_ONLY');
const bridge=(key,exports,p=proof('_'))=>({key,exports,proof:p});
const bridges=[
 bridge('react',Object.fromEntries([['default','React'],...reactNames.map(k=>[k,'React.'+k])])),
 bridge('react/jsx-runtime',{jsx:'jsx.jsx',jsxs:'jsx.jsxs',Fragment:'jsx.Fragment'}),
 bridge('react-dom',{createPortal:'ReactDOM.createPortal'},proof('gw')),
 bridge('@/lib/trpc',{trpc:'trpc'},proof('zn')),
 bridge('wouter',{Link:'Link',useLocation:'useLocation'},proof('Hi')),
 bridge('sonner',{toast:'toast'},proof('Uw')),
 bridge('@tanstack/react-query',{useQuery:'useQuery',useQueryClient:'useQueryClient'},proof('D1')),
 bridge('@/_core/hooks/useAuth',{useAuth:'useAuth'},proof('TT')),
 bridge('@/components/ui/dialog',{Dialog:'Dialog.Dialog',DialogContent:'Dialog.DialogContent',DialogHeader:'Dialog.DialogHeader',DialogTitle:'Dialog.DialogTitle',DialogDescription:'Dialog.DialogDescription',DialogFooter:'Dialog.DialogFooter'}),
 bridge(src('components/PaymentMethodIcon.tsx'),{default:'PaymentMethodIcon'}),
 bridge('@/components/PaymentMethodIcon',{default:'PaymentMethodIcon'}),
 bridge(src('components/MallLoginDialog.tsx'),{default:'MallLoginDialog'})
];
const packages={'lucide-react':B+'/lucide.ts','qrcode.react':qr};
const sourceFiles={},dependencyHashes={},inputs={};
for(const[k,x]of Object.entries(symbols))inputs[k]={local:x.local,sha256:x.sha256,url:x.serverPath.slice(x.serverPath.indexOf('/assets/'))};
const h=JSON.parse(fs.readFileSync(P+'/capture-html-refs.json'));inputs.frontHtml={local:h.local,sha256:h.sha256};
for(const [i,x] of files.entries())inputs['capture'+i]={local:x.local,sha256:x.sha256};
const bridgeKeys=new Set(bridges.map(b=>b.key));
function collect(file){file=fs.realpathSync(file);if(sourceFiles[file]||dependencyHashes[file])return;const text=fs.readFileSync(file,'utf8');(file.includes('/node_modules/')?dependencyHashes:sourceFiles)[file]=H(text);const selected=selections[file]?selectedSource(file,text,selections[file]):text;const js=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;const a=parse(js);for(const n of a.statements){if(!(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))||!n.moduleSpecifier)continue;const spec=n.moduleSpecifier.text;let local=resolveLocal(spec,path.dirname(file));if(bridgeKeys.has(spec)||local&&bridgeKeys.has(local))continue;if(!local)local=packages[spec];assert(local,'CLOSED_PREP_IMPORT '+spec+' in '+file);collect(local);}}
collect(B+'/entry.ts');for(const b of bridges)if(path.isAbsolute(b.key)&&fs.existsSync(b.key))sourceFiles[b.key]=H(fs.readFileSync(b.key));
for(const freezeFile of [W+'/validation/frontend-owned.sha256',FR+'/W/visual-source-freeze.sha256']){const text=fs.readFileSync(freezeFile,'utf8');dependencyHashes[freezeFile]=H(text);for(const line of text.trim().split('\n')){const m=line.match(/^([a-f0-9]{64})\s+(.+)$/);assert(m,'SOURCE_HASH_LINE');const p=path.resolve(FR,m[2]);assert(H(fs.readFileSync(p))===m[1],'SOURCE_FINAL_FREEZE_DRIFT '+p);sourceFiles[p]=m[1];}}
for(const p of [...REQUIRED_EXECUTION_FILES,W+'/validation/native-production-react-slots.json'])dependencyHashes[p]=H(fs.readFileSync(p));
for(const p of [P+'/capture-ui-symbols.json',P+'/capture-ui-slots.json',P+'/capture-html-refs.json',P+'/capture-file-hashes.json',lucideRoot+'/lucide-react.js',path.dirname(req.resolve('lucide-react/package.json'))+'/package.json'])dependencyHashes[p]=H(fs.readFileSync(p));
const sourcePreimages={};for(const n of ['CartPage.tsx','SearchPage.tsx','MallNav.tsx'])sourcePreimages[W+'/frontend-baseline/'+n]=H(fs.readFileSync(W+'/frontend-baseline/'+n));
const toolHashes={};for(const n of ['core.mjs','compile-closed.mjs','build-cart-api.mjs','build-cart-ui.mjs','ui-prepare-actual.mjs','ui-actual-build.mjs'])toolHashes[P+'/'+n]=H(fs.readFileSync(P+'/'+n));
const c={schema:'cart-compact-freeze-v1',phase:'source-frozen',approvedSourceFreeze:true,parentVerifiedInputs:true,freezeApproval:'root-approved-offline-ui-same-host-20261119',roles:['ui'],sourceBinding:{commit:'3cbcfdca1985c858919f933db9784cc49b7e5865',managerCommit:'aadc4afcbac4264af357f0e0eb01c4886302fa99',verification:'parent-authorized fixed baseline plus frozen owned changes; offline only'},sourceFiles,sourcePreimages,dependencyHashes,toolHashes,inputs,ui:{actualCaptureBuild:true,hostIdentityApproved:true,countStrategy:'frontend-sum',rootExports:{React:'r',jsx:'j',trpc:'a',toast:'d',ReactDOM:'al',useLocation:'u',useAuth:'g',useQuery:'ac',useQueryClient:'b',Link:'L'},module:{id:'cartUI',artifactPrefix:'official-cart-ui',entryFile:B+'/entry.ts',exports:['instantiate'],factoryExport:'createOfficialCartUIFactory',selectedDeclarations:selections,packageEntries:packages,bridges},outputName:'ui-candidate/candidate-ui'}};
save(P+'/ui-final-freeze.json',c);console.log('FROZEN',Object.keys(sourceFiles).length,'source;',Object.keys(dependencyHashes).length,'deps;',Object.keys(inputs).length,'capture records');
