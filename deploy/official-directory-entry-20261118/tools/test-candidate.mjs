import fs from 'node:fs';
import vm from 'node:vm';
import assertNode from 'node:assert/strict';
import {D,I,O,FR,GEN,sourcePaths,oldSearch,rootURL,inputHashes,inputs,currentFreeze,verifySourceOnly,H,assert,one,parse,nodes,declaration,ts,bytesDelta,verifyInverse,saveJSON,importMap,resolveMap} from './candidate-core.mjs';
import {projectSourceRoute} from './source-projection.mjs';

const tests=[],test=(name,fn)=>{fn();tests.push({name,passed:true});console.log('PASS '+name);};
const frozen=currentFreeze(),b=inputs(),manifest=JSON.parse(fs.readFileSync(O+'/manifest.json')),asset=manifest.files[0],candidate=fs.readFileSync(asset.local),nativeDelta=JSON.parse(fs.readFileSync(manifest.deltas.native)),htmlDelta=JSON.parse(fs.readFileSync(manifest.deltas.html));
const source=fs.readFileSync(sourcePaths[0],'utf8'),helper=fs.readFileSync(sourcePaths[1],'utf8'),projected=projectSourceRoute(source,helper);
const ca=parse(candidate.toString()),ba=parse(b['current-search.js'].toString()),route=declaration(ca,'__OfficialSearchRoute').getText(ca),oldRoute=declaration(ba,'__OfficialSearchRoute').getText(ba);
let sourceHelper;
test('source unit: pure helper compiles and has zero TypeScript errors',()=>{
 const program=ts.createProgram([sourcePaths[1]],{noEmit:true,strict:true,skipLibCheck:true,types:[],target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,lib:['lib.es2020.d.ts','lib.dom.d.ts']});
 const diagnostics=ts.getPreEmitDiagnostics(program);assert(diagnostics.length===0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>FR,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
 const context=vm.createContext({URLSearchParams});vm.runInContext(projected.pureHelper,context);sourceHelper=context.createOfficialMallSearchUrl;
});
const cases=[
 [{keyword:'ANON-IC',brand:'SynthBrand'},'/search?q=ANON-IC&brand=SynthBrand&selfOperatedOnly=1'],
 [{keyword:'ANON-IC',brand:'all'},'/search?q=ANON-IC&selfOperatedOnly=1'],
 [{keyword:'ANON-IC',brand:''},'/search?q=ANON-IC&selfOperatedOnly=1'],
 [{keyword:'',brand:'all'},'/search?selfOperatedOnly=1'],
 [{keyword:'',brand:'SynthBrand'},'/search?selfOperatedOnly=1'],
 [{keyword:'  ',brand:' SynthBrand '},'/search?selfOperatedOnly=1'],
 [{keyword:' ANON-IC ',brand:' SynthBrand '},'/search?q=ANON-IC&brand=SynthBrand&selfOperatedOnly=1'],
 [{keyword:'ANON-IC#+/测试',brand:'Synth+/# &牌'},'/search?q=ANON-IC%23%2B%2F%E6%B5%8B%E8%AF%95&brand=Synth%2B%2F%23+%26%E7%89%8C&selfOperatedOnly=1']
];
test('source unit: synthetic URL values and special characters round-trip',()=>{for(const[state,expected]of cases)assertNode.equal(sourceHelper(state),expected);});
test('source unit: inventory context, page, identity, sort, category and view never forwarded',()=>{
 const href=sourceHelper({keyword:'ANON-IC',brand:'SynthBrand',page:7,category:'SyntheticCat',sort:'priceAsc',viewMode:'grid',followedOnly:true,supplierId:91,inventoryId:83,enterpriseId:72,token:'synthetic-token'});
 const keys=[...new URL(href,'https://example.invalid').searchParams.keys()];assertNode.deepEqual(keys,['q','brand','selfOperatedOnly']);
});
test('source merchant and source self expression: exact bytes outside the two source hunks',()=>{verifySourceOnly(b['source-before.tsx'].toString(),source);});
test('source-bound candidate helper is identical to source unit helper',()=>{assertNode.equal(declaration(ca,'createOfficialMallSearchUrl').getText(ca),projected.pureHelper);for(const[state,expected]of cases){const ctx=vm.createContext({URLSearchParams});vm.runInContext(declaration(ca,'createOfficialMallSearchUrl').getText(ca),ctx);assertNode.equal(ctx.createOfficialMallSearchUrl(state),expected);}});
test('existing generator sourceProjection produces the identical ordinary expression and pure helper',()=>{
 const generator=fs.readFileSync(GEN,'utf8'),start=generator.indexOf('// BEGIN OFFICIAL DIRECTORY ENTRY SOURCE PROJECTION'),end=generator.indexOf('// END OFFICIAL DIRECTORY ENTRY SOURCE PROJECTION');assert(start>=0&&end>start,'one generator projection block');
 const ctx=vm.createContext({FR,ts,assert,one,parse,nodes,pin:p=>fs.readFileSync(p,'utf8'),delta:(original,patches)=>({next:bytesDelta(original,patches).candidate.toString()})});
 vm.runInContext(generator.slice(start,end)+'\nthis.generated={helper:entryHelper,normal:entryNormal};',ctx);
 assertNode.equal(ctx.generated.helper,projected.pureHelper);assertNode.equal(ctx.generated.normal,projected.normalExpression);
 // The remaining generator pipeline is not executed: it includes unrelated full v10 build work.
 const oldGen=b['generator-before.mjs'].toString(),prefixOld=one(oldGen.split('\n').filter(l=>l.startsWith('const prefix=')),'old generator prefix');
 const prefixNew=one(generator.split('\n').filter(l=>l.startsWith('const prefix=')),'new generator prefix');
 const recovered=generator.slice(0,start)+generator.slice(generator.indexOf('\n',end)+1);
 assertNode.equal(recovered.replace(prefixNew,prefixOld),oldGen,'generator all bytes outside projection insertion and prefix line exact');
});
const factoryAst=parse(b['current-catalog.js'].toString()),factory=declaration(factoryAst,'createOfficialCatalog').getText(factoryAst).replace(/^export\s+/,'');
const React={useEffect(){throw Error('unexpected React hook');},useState(){throw Error('unexpected React hook');},useMemo(){throw Error('unexpected React hook');},useRef(){throw Error('unexpected React hook');},useCallback(){throw Error('unexpected React hook');}},jsx={Fragment:Symbol('existing Fragment'),jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
const trpc={existingProvider:true},Link=function ExistingLink(){},useLocation=()=>{throw Error('unexpected location hook');},skipToken=Symbol('existing query skipToken');
function runtime(wrapper,extra=''){
 let query='',queryReads=0,creations=0;const nativeInputs=[];
 const context=vm.createContext({URLSearchParams,console,m:React,a:jsx,D:trpc,re:Link,$i:useLocation,__SameSkipToken:skipToken,$a:v=>v,Fi:()=>{queryReads++;return query;},recordNative:n=>{creations++;nativeInputs.push(n);}});
 vm.runInContext(factory+'\nfunction __createOfficialCatalog(native){recordNative(native);return createOfficialCatalog(native);}\nlet __NativeOfficialCatalog;\nfunction K1(){throw Error("old K1 must remain an element, not be invoked by wrapper");}\n'+extra+'\n'+wrapper+'\nthis.run=__OfficialSearchRoute;this.merchant=K1;',context);
 return{context,run:q=>{query=q;return context.run();},get queryReads(){return queryReads;},get creations(){return creations;},nativeInputs,get catalog(){return vm.runInContext('__NativeOfficialCatalog',context);}};
}
const native=runtime(route,projected.pureHelper),oldNative=runtime(oldRoute);
function linkFrom(tree){assertNode.equal(tree.type,jsx.Fragment);assertNode.equal(tree.props.children.length,2);const block=tree.props.children[0];assertNode.equal(block.type,'div');assertNode.equal(block.props.className,'official-mall-search-entry');assert(!('data-is-self' in block.props),'shortcut never creates item-card marker');const link=block.props.children;assertNode.equal(link.type,'a');assertNode.equal(link.props.children,'51自营官方目录');assertNode.equal(link.props['aria-label'],'查看该型号自营商品');assert(!('onClick'in link.props),'plain anchor navigation only');assertNode.equal(tree.props.children[1].type,native.context.merchant);assertNode.deepEqual(Object.keys(tree.props.children[1].props),[]);return link;}
test('native VM: actual __OfficialSearchRoute normal branch adds exactly one plain anchor then original K1',()=>{
 const tree=native.run('q=ANON-IC&brand=SynthBrand&page=9&cat=SyntheticCat&sort=stockDesc&followed=1&view=grid&supplierId=synthetic');
 assertNode.equal(linkFrom(tree).props.href,'/search?q=ANON-IC&brand=SynthBrand&selfOperatedOnly=1');
 const old=oldNative.run('q=ANON-IC&brand=SynthBrand');assertNode.equal(old.type,oldNative.context.merchant);assertNode.deepEqual(Object.keys(old.props),Object.keys(tree.props.children[1].props));
});
test('native VM: submitted same-model brand switch and keyword switch rerender link with fresh URL state',()=>{
 assertNode.equal(linkFrom(native.run('q=ANON-IC&brand=SynthBrandB&page=8')).props.href,'/search?q=ANON-IC&brand=SynthBrandB&selfOperatedOnly=1');
 assertNode.equal(linkFrom(native.run('q=ANON-IC-NEXT&brand=SynthBrandC')).props.href,'/search?q=ANON-IC-NEXT&brand=SynthBrandC&selfOperatedOnly=1');
 assertNode.equal(linkFrom(native.run('brand=SynthBrand')).props.href,'/search?selfOperatedOnly=1');
 assertNode.equal(linkFrom(native.run('q=ANON-IC%23%2B%2F%E6%B5%8B%E8%AF%95&brand=Synth%2B%2F%23+%26%E7%89%8C')).props.href,cases.at(-1)[1]);
});
test('native VM: actual self branch stays independent Catalog; no shortcut, no K1, and old props preserved',()=>{
 const q='q=ANON-IC&brand=SynthBrand&selfOperatedOnly=1';const next=native.run(q),old=oldNative.run(q);
 assertNode.equal(next.type,native.catalog.Catalog);assertNode.equal(old.type,oldNative.catalog.Catalog);assertNode.equal(typeof next.type,'function');assert(next.type!==native.context.merchant,'self branch does not render K1');assertNode.deepEqual(JSON.parse(JSON.stringify(next.props)),JSON.parse(JSON.stringify(old.props)));assert(!('children'in next.props),'no duplicate shortcut in Catalog');
});
test('native VM: factory once only, URL hook each render, and exact host React/trpc/skipToken identities',()=>{
 assertNode.equal(native.creations,1);assertNode.equal(native.queryReads,6);const n=native.nativeInputs[0];assertNode.equal(n.React,React);assertNode.equal(n.jsx,jsx);assertNode.equal(n.trpc,trpc);assertNode.equal(n.Link,Link);assertNode.equal(n.useLocation,useLocation);assertNode.equal(n.skipToken,skipToken);
});
test('native and HTML deltas: exact byte inverses and two/13 limited hunks',()=>{
 verifyInverse(candidate,b['current-search.js'],nativeDelta);verifyInverse(fs.readFileSync(manifest.html.local),b['current-index.html'],htmlDelta);assertNode.equal(nativeDelta.patches.length,2);assertNode.equal(htmlDelta.patches.length,13);
 for(const p of htmlDelta.patches){assertNode.equal(Buffer.from(p.oldBase64,'base64').toString(),oldSearch);assertNode.equal(Buffer.from(p.newBase64,'base64').toString(),asset.url);}
});
test('native preserved bytes: K1, row render, self=true, non-return hooks, every import and default export',()=>{
 for(const name of ['K1','r1'])assertNode.equal(declaration(ca,name).getText(ca),declaration(ba,name).getText(ba));
 const oldFn=declaration(ba,'__OfficialSearchRoute'),nextFn=declaration(ca,'__OfficialSearchRoute');
 const oldRet=one(nodes(oldFn,n=>ts.isReturnStatement(n)),'old native return'),newRet=one(nodes(nextFn,n=>ts.isReturnStatement(n)),'new native return');
 assertNode.equal(oldRet.expression.whenTrue.getText(ba),newRet.expression.whenTrue.getText(ca));
 assertNode.equal(JSON.stringify(oldFn.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>n.getText(ba))),JSON.stringify(nextFn.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>n.getText(ca))));
 assertNode.deepEqual(ca.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ca)),ba.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ba)));
 assertNode.deepEqual(ca.statements.filter(ts.isExportDeclaration).map(n=>n.getText(ca)),ba.statements.filter(ts.isExportDeclaration).map(n=>n.getText(ba)));
});
test('actual public entry proof: unchanged root dynamically resolves Search candidate and keeps same React host',()=>{
 const oldMap=importMap(b['current-index.html'].toString()),newMap=importMap(fs.readFileSync(manifest.html.local,'utf8')),proof=JSON.parse(fs.readFileSync(manifest.scopeProofPath));
 assertNode.equal(resolveMap(proof.actualDynamicSpecifier,rootURL,oldMap),oldSearch);assertNode.equal(resolveMap(proof.actualDynamicSpecifier,rootURL,newMap),asset.url);assertNode.equal(resolveMap('./main-D3xcYX4O.js',asset.url,newMap),rootURL);
 const expectedMap=JSON.stringify(oldMap).split(oldSearch).join(asset.url);assertNode.equal(JSON.stringify(newMap),expectedMap,'all other importmap bytes/values unchanged');
 assertNode.equal(H(b['current-catalog.js']),inputHashes['current-catalog.js']);assertNode.equal(H(b['current-root.js']),inputHashes['current-root.js']);assertNode.equal(H(b['current-merchant.css']),inputHashes['current-merchant.css']);
});
test('manifest/source/tool freeze: exact all hashes, content-addressed filename, one static JS, no CSS/backend file',()=>{
 assertNode.equal(H(candidate),asset.H);assertNode.equal(asset.sha256,asset.H);assertNode.equal(asset.url,'/assets/SearchPage-official-directory-entry-'+asset.H+'.js');assertNode.equal(manifest.files.length,1);assertNode.equal(H(fs.readFileSync(manifest.html.local)),manifest.html.sha256);assertNode.deepEqual(manifest.sourceFreeze,frozen);assertNode.equal(manifest.projection.sourceHashes.SearchPage,H(source));assertNode.equal(manifest.projection.sourceHashes.officialMallNavigation,H(helper));assertNode.equal(manifest.sourceBefore.head,'484ce8e1d78e2b3ed86b74f6c36af64dc9999fd2');
 currentFreeze();inputs();
});
const proof={status:'passed',browser:'not run; reserved for parent actual DOM/click acceptance',count:tests.length,tests,sourceFreezeSha256:H(fs.readFileSync(D+'/source-freeze.json')),candidateManifestSha256:H(fs.readFileSync(O+'/manifest.json')),candidateAssetSha256:H(candidate),candidateHtmlSha256:manifest.html.sha256,inputHashes};
saveJSON(D+'/test-proof.json',proof);console.log(JSON.stringify({status:proof.status,testCount:tests.length,proofPath:D+'/test-proof.json'},null,2));
