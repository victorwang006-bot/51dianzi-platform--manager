import fs from 'node:fs';
import {D,I,O,FR,GEN,sourcePaths,oldSearch,rootURL,inputHashes,inputs,currentFreeze,verifySourceOnly,H,assert,one,parse,nodes,declaration,ts,bytesDelta,saveJSON,importMap,resolveMap} from './candidate-core.mjs';
import {projectSourceRoute} from './source-projection.mjs';

const frozen=currentFreeze(),b=inputs(),source=fs.readFileSync(sourcePaths[0],'utf8'),helper=fs.readFileSync(sourcePaths[1],'utf8');
const sourceChecks=verifySourceOnly(b['source-before.tsx'].toString(),source);
const projection=projectSourceRoute(source,helper),original=b['current-search.js'],text=original.toString(),a=parse(text);
assert(!nodes(a,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.text==='createOfficialMallSearchUrl').length,'new helper identifier has no collision');
const route=declaration(a,'__OfficialSearchRoute'),ret=one(nodes(route,n=>ts.isReturnStatement(n)),'native wrapper return');
assert(ts.isConditionalExpression(ret.expression),'native conditional route');
const oldNormal=ret.expression.whenFalse.getText(a);assert(oldNormal==='a.jsx(K1,{})','exact native normal baseline');
const start=route.getStart(a);
const native=bytesDelta(original,[
 {start,end:start,before:'',after:projection.pureHelper+'\n',reason:'one source-bound pure URL helper; no import/provider/data query'},
 {start:ret.expression.whenFalse.getStart(a),end:ret.expression.whenFalse.end,before:oldNormal,after:projection.normalExpression,reason:'normal branch only: Fragment [one plain link block, original K1]'}
]);
const candidate=native.candidate.toString(),ca=parse(candidate),cr=declaration(ca,'__OfficialSearchRoute');
const cret=one(nodes(cr,n=>ts.isReturnStatement(n)),'candidate route return');
const originalImports=a.statements.filter(ts.isImportDeclaration).map(n=>n.getText(a)),candidateImports=ca.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ca));
assert(JSON.stringify(originalImports)===JSON.stringify(candidateImports),'all existing native imports exact');
assert(ret.expression.whenTrue.getText(a)===cret.expression.whenTrue.getText(ca),'native self=true expression exact');
assert(JSON.stringify(route.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>n.getText(a)))===JSON.stringify(cr.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>n.getText(ca))),'native non-return hooks and parser exact');
const merchantHashes=Object.fromEntries(['K1','r1'].map(name=>{const before=declaration(a,name).getText(a),after=declaration(ca,name).getText(ca);assert(before===after,'native old merchant render '+name);return[name,H(before)];}));
const jsName='SearchPage-official-directory-entry-'+H(native.candidate)+'.js',newSearch='/assets/'+jsName;
const html=b['current-index.html'].toString(),occurrences=[...html.matchAll(new RegExp(oldSearch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))];
assert(occurrences.length===13,'exact current Search references 13');
const htmlDelta=bytesDelta(Buffer.from(html),occurrences.map(m=>({start:m.index,end:m.index+oldSearch.length,before:oldSearch,after:newSearch,reason:'existing actual Search entry reference only'})),{javascript:false});
const nextHTML=htmlDelta.candidate.toString(),oldMap=importMap(html),newMap=importMap(nextHTML);
const root=parse(b['current-root.js'].toString()),dynamic=one(nodes(root,n=>ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]?.text?.includes('SearchPage')),'actual root Search dynamic import');
const dynamicSpecifier=dynamic.arguments[0].text;
assert(resolveMap(dynamicSpecifier,rootURL,oldMap)===oldSearch,'current actual root maps to frozen Search');
assert(resolveMap(dynamicSpecifier,rootURL,newMap)===newSearch,'actual root maps to candidate Search');
const nativeHostSpecifier=one(a.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./main-D3xcYX4O.js'&&n.importClause?.namedBindings?.elements.some(e=>e.name.text==='m')),'live native React/trpc host').moduleSpecifier.text;
assert(resolveMap(nativeHostSpecifier,oldSearch,oldMap)===rootURL,'baseline React singleton host');
assert(resolveMap(nativeHostSpecifier,newSearch,newMap)===rootURL,'candidate React singleton host exact');
const scriptTag=one([...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/g)].filter(m=>m[1]===rootURL),'actual public root script');
assert(nextHTML.includes(scriptTag[0]),'actual root HTML tag exact');
assert(!nextHTML.includes(oldSearch),'all old Search refs substituted');
assert(nextHTML.includes('/assets/SearchPage-merchant-scope-0629f82af4c80583.css'),'old merchant CSS preserved');
fs.mkdirSync(O+'/assets',{recursive:true,mode:0o700});
fs.writeFileSync(O+'/assets/'+jsName,native.candidate,{mode:0o600});fs.writeFileSync(O+'/index.html',htmlDelta.candidate,{mode:0o600});
saveJSON(O+'/native-delta.json',{beforeSha256:native.beforeSha256,afterSha256:native.afterSha256,patches:native.records,inverseVerified:native.inverseVerified});
saveJSON(O+'/html-delta.json',{beforeSha256:htmlDelta.beforeSha256,afterSha256:htmlDelta.afterSha256,patches:htmlDelta.records,inverseVerified:htmlDelta.inverseVerified});
const scopeProof={actualRootURL:rootURL,actualRootSha256:inputHashes['current-root.js'],actualRootScriptTag:scriptTag[0],actualDynamicImport:dynamic.getText(root),actualDynamicSpecifier:dynamicSpecifier,resolvedBefore:oldSearch,resolvedAfter:newSearch,nativeHostSpecifier,resolvedHostBefore:rootURL,resolvedHostAfter:rootURL,matchingReferenceCount:13};
saveJSON(O+'/scope-proof.json',scopeProof);
const checks={...sourceChecks,syntax:true,nativeInverse:true,htmlInverse:true,nativeOnlyTwoHunks:true,htmlOnlyThirteenExistingSearchReferences:true,noAddedCSS:true,merchantCSSExact:true,oldCatalogImportExact:true,allNativeImportsExact:true,selfTrueExpressionExact:true,nonReturnHooksAndParseHelpersExact:true,K1AndR1Exact:true,actualEntryScopeProof:true,hostReactSingletonExact:true,noProductionWrite:true};
const manifest={schema:'official-directory-entry-offline-candidate-v1',scope:'frontend navigation only; ordinary /search entry to existing independent Catalog',status:'offline candidate; not uploaded or applied; browser not run',sourceBefore:{head:'484ce8e1d78e2b3ed86b74f6c36af64dc9999fd2',SearchPage:inputHashes['source-before.tsx']},publicRoot:'/opt/releases/20261031-homepage-banner-v39/front/dist/public',inputs:Object.fromEntries(Object.entries(inputHashes).map(([name,h])=>[name,{local:I+'/'+name,sha256:h}])),sourceFreeze:frozen,projection:{sourceHashes:projection.sourceHashes,helperSha256:projection.helperSha256,ordinarySha256:projection.ordinarySha256},files:[{local:O+'/assets/'+jsName,url:newSearch,H:H(native.candidate),sha256:H(native.candidate)}],html:{local:O+'/index.html',beforeSha256:H(b['current-index.html']),sha256:H(htmlDelta.candidate),replacementCount:13},deltas:{native:O+'/native-delta.json',html:O+'/html-delta.json'},frozenNative:{merchantFunctions:merchantHashes,importsSha256:H(originalImports.join('\n')),selfTrueExpressionSha256:H(ret.expression.whenTrue.getText(a)),nonReturnStatementsSha256:H(route.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>n.getText(a)).join('\n'))},scopeProofPath:O+'/scope-proof.json',checks,excluded:['no server, API, DB, worker, auth, quota, finance, inventory query, SQL, paging changes','no official cart/order implementation and no publicId-as-inventoryId','no admin HTML, Profile, root JS, Catalog JS, UI library or existing CSS changes','no production upload/apply, PM2, credentials, cookie mint or Git commit'],testProofPath:D+'/test-proof.json',queriesBoundary:'Only nonempty committed keyword and non-all brand, plus selfOperatedOnly=1. Empty keyword leads to complete Catalog. All inventory/merchant context discarded.'};
saveJSON(O+'/manifest.json',manifest);
console.log(JSON.stringify({manifestPath:O+'/manifest.json',files:manifest.files,html:manifest.html,checks},null,2));
