import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const D = path.dirname(fileURLToPath(import.meta.url));
const AR = '/home/ubuntu/work/channel-release-20261121-1837/manager';
const FR = '/home/ubuntu/work/channel-release-20261121-1837/platform';
const req = createRequire(AR + '/package.json'), ts = req('typescript'), esbuild = req('esbuild');
const O = D + '/backend-candidate', C = D + '/capture';
const sourceHashes = {}, compiled = {}, dependencies = {};
// Pure static-core helpers reused with this authorized source root's installed ABI.
const H = b => createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(p,'utf8');
const assert = (v,m) => { if (!v) throw Error(m); };
const one = (xs,m) => { assert(xs.length===1,m+': '+xs.length); return xs[0]; };
function parse(s,n='actual.js') { const a=ts.createSourceFile(n,s,99,true,n.endsWith('.tsx')?4:n.endsWith('.ts')?3:1); assert(!a.parseDiagnostics.length,'Syntax '+n); return a; }
function nodes(a,p) { const r=[]; function w(n){if(p(n))r.push(n);n.forEachChild(w);} w(a); return r; }
function delta(original,patches) {
  const ps=[...patches].sort((a,b)=>a.start-b.start||a.end-b.end); let next=original;
  ps.forEach((p,i)=>{assert(original.slice(p.start,p.end)===p.before,'preimage '+p.reason);if(i)assert(ps[i-1].end<=p.start,'overlap');});
  for(const p of [...ps].reverse())next=next.slice(0,p.start)+p.after+next.slice(p.end);
  let reverse=next,offset=0;
  const records=ps.map(p=>{const afterStart=p.start+offset;offset+=p.after.length-p.before.length;return {...p,afterStart,afterEnd:afterStart+p.after.length,beforeSha256:H(p.before),afterSha256:H(p.after),beforeByteStart:Buffer.byteLength(original.slice(0,p.start)),beforeByteEnd:Buffer.byteLength(original.slice(0,p.end))};});
  for(const p of [...records].reverse()){assert(reverse.slice(p.afterStart,p.afterEnd)===p.after,'inverse preimage');reverse=reverse.slice(0,p.afterStart)+p.before+reverse.slice(p.afterEnd);}
  assert(reverse===original,'inverse bytes');parse(next);return {next,patches:records,beforeSha256:H(original),afterSha256:H(next),inverseVerified:true};
}
const pin = p => { const s = read(p); sourceHashes[p] = H(s); return s; };
const allowedPackages = new Set(['node:crypto', 'crypto', '@trpc/server', 'zod', 'drizzle-orm', 'drizzle-orm/mysql-core']);
const fixed = {'customer.newInformationFacts':'customers','channelInventory.newInformationFacts':'inventory','enterprise.inquiryNewInformationFacts':'inquiries','customerDemand.procurementNewInformationFacts':'procurement','inbound.newInformationFacts':'inventory','crmSalesOrder.newInformationFacts':'orders','order.sellerNewInformationFacts':'orders'};
const decl = (a, name) => one(nodes(a, n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.text === name), 'actual declaration ' + name);
const transpile = s => ts.transpileModule(s, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const bridge = (map, file, names) => map.set(file, 'export const {'+names.join(',')+'}=native;');
const printer = ts.createPrinter({removeComments:true});
const print = n => printer.printNode(ts.EmitHint.Unspecified, n, n.getSourceFile());

// Reused compileModule architecture from the old owner; no import or execution of its build entry.
async function compileModule(label, entry, repo, bridges = new Map(), virtual = new Map(), factory = false, returns = '{}') {
  const result = await esbuild.build({stdin:{contents:entry,resolveDir:repo,sourcefile:label+'.ts',loader:'ts'},bundle:true,write:false,platform:'node',target:'node20',format:'esm',packages:'external',metafile:true,legalComments:'none',plugins:[{name:'bounded-native-abi',setup(b){
    b.onResolve({filter:/.*/}, arg => {
      if (arg.path === './'+compiled.contracts.name) return {path:arg.path,external:true};
      let p = arg.path.startsWith('@shared/') ? path.join(repo,'shared',arg.path.slice(8))+'.ts' : arg.path.startsWith('.') ? path.resolve(arg.resolveDir,arg.path) : null;
      if (p && !path.extname(p)) p += '.ts';
      if (p === FR+'/shared/adminNewInformationFacts.ts' || p === AR+'/shared/adminNewInformationFacts.ts') return {path:'./'+compiled.contracts.name,external:true};
      if (p && bridges.has(p)) return {path:p,namespace:'native-bridge'};
      if (p && virtual.has(p)) return {path:p,namespace:'narrow-source'};
      if (p) return {path:p};
    });
    b.onLoad({filter:/.*/,namespace:'native-bridge'}, a => ({contents:bridges.get(a.path),loader:'ts',resolveDir:path.dirname(a.path)}));
    b.onLoad({filter:/.*/,namespace:'narrow-source'}, a => ({contents:virtual.get(a.path),loader:'ts',resolveDir:path.dirname(a.path)}));
  }}]});
  let text = result.outputFiles[0].text, a = parse(text), imports = a.statements.filter(ts.isImportDeclaration), exports = a.statements.filter(ts.isExportDeclaration);
  fs.writeFileSync(O+'/compile-metafile.json',JSON.stringify(result.metafile,null,2));
  fs.writeFileSync(O+'/compile-unwrapped.reference.mjs',text);
  for (const i of imports) assert(allowedPackages.has(i.moduleSpecifier.text) || i.moduleSpecifier.text === './'+compiled.contracts.name, 'unknown runtime external '+i.moduleSpecifier.text);
  if (factory) {
    const patches = [...exports,...imports].map(n => ({start:n.getStart(a),end:n.end,before:n.getText(a),after:'',reason:'factory module imports/exports'}));
    text = imports.map(n => n.getText(a)).join('\n')+'\nexport function createNativeNewInformationRuntime(native) {\n'+delta(text,patches).next+'\nreturn '+returns+';\n}\n';
  }
  parse(text);
  for (const p of Object.keys(result.metafile.inputs)) {
    const f = p.replace(/^(native-bridge|narrow-source):/,'');
    if (path.isAbsolute(f) && fs.existsSync(f) && !f.includes('/node_modules/')) pin(f);
    else if (fs.existsSync(path.resolve(f)) && !f.includes('/node_modules/')) pin(path.resolve(f));
  }
  return {text, inputs:Object.keys(result.metafile.inputs)};
}

function section(s, suffix) {
  const re = /^\/\/ [^\n]*$/gm;
  const starts = [...s.matchAll(re)].filter(m => m[0].endsWith(suffix));
  const start = one(starts, 'one compiled module '+suffix).index;
  const remainder = s.slice(start + starts[0][0].length);
  // esbuild's next standalone module header, not an indented explanatory comment.
  const next = /^\/\/ (?:native-bridge:|narrow-source:|[^\n]*\.(?:ts|mjs)$)/m.exec(remainder);
  assert(next, 'next compiled module '+suffix);
  const end = start + starts[0][0].length + next.index;
  return {start,end,before:s.slice(start,end)};
}
function schemaObject(a) {
  let i = decl(a, 'customerListSchema').initializer;
  while (ts.isCallExpression(i) && ts.isPropertyAccessExpression(i.expression) && i.expression.name.text === 'refine') i = i.expression.expression;
  assert(ts.isCallExpression(i) && ts.isObjectLiteralExpression(i.arguments[0]), 'actual customer list schema literal');
  return {object:i.arguments[0], z:i.expression.expression.getText(a)};
}
function saveDelta(role, original, patches, slots) {
  const d = delta(original, patches);
  const next = d.next;
  let bAt = 0, aAt = 0;
  const outside = [];
  for (const p of d.patches) {
    const before = original.slice(bAt,p.start), after = next.slice(aAt,p.afterStart);
    assert(before === after, role+' outside hunk changed');
    outside.push({beforeStart:bAt, beforeEnd:p.start, afterStart:aAt, afterEnd:p.afterStart, sha256:H(before)});
    bAt = p.end; aAt = p.afterEnd;
  }
  assert(original.slice(bAt) === next.slice(aAt), role+' final outside hunk changed');
  outside.push({beforeStart:bAt,beforeEnd:original.length,afterStart:aAt,afterEnd:next.length,sha256:H(original.slice(bAt))});
  const file = role === 'runtime' ? 'runtime-delta.json' : role+'-delta.json';
  fs.writeFileSync(O+'/'+file, JSON.stringify({...d,next:undefined,slots,outside,astExact:true,outsideHunksVerified:true},null,2)+'\n');
  if (role !== 'runtime') fs.writeFileSync(O+'/'+role+'-api.js',next);
  return {text:next,sha256:H(next),beforeSha256:H(original),bytes:Buffer.byteLength(next),delta:O+'/'+file,slots,hunks:d.patches.length};
}

async function buildAdmin() {
  const s = pin(C+'/admin-api.js'), a = parse(s), oldRuntime = pin(C+'/new-information-admin.runtime.mjs');
  const imports = a.statements.filter(ts.isImportDeclaration);
  const runtimeImport = one(imports.filter(n=>n.moduleSpecifier.text.includes('/newInformation.admin.')), 'one actual admin notification import');
  assert(path.basename(runtimeImport.moduleSpecifier.text) === 'newInformation.admin.'+H(oldRuntime)+'.runtime.mjs', 'captured runtime equals actual API URL');
  const bridges = new Map(), virtual = new Map();
  const dbNames = ['getDb','withBusinessAuthorizationFence','getAdminUserById','getAdminUserPermissions','getActiveBusinessStaffBinding','getActiveBusinessMerchantScope','getBusinessWorkbenchMerchantById','getAdminUserSalesScopeCodes'];
  bridge(bridges,AR+'/server/db.ts',dbNames);
  bridge(bridges,AR+'/server/_core/trpc.ts',['router','adminProcedure']);
  bridge(bridges,AR+'/server/businessAccess.ts',['businessEnterpriseBindingFromMerchant','businessScopeAllows','getBusinessWorkbenchMerchantIds']);
  bridge(bridges,AR+'/server/services/officialChannelAccess.ts',['loadOfficialAccess','assertOfficialRecordAction','officialTeamPredicate','officialActorFromContext']);
  bridge(bridges,AR+'/drizzle/schema.ts',['adminStaffArchives','materials']);
  bridge(bridges,AR+'/drizzle/officialChannelSchema.ts',['officialChannelTeams']);
  virtual.set(AR+'/server/businessRouter.ts',`import {createHash,randomUUID} from 'node:crypto';import {TRPCError} from '@trpc/server';import {newInformationFactsInputSchema,newInformationFactsResultSchema} from './new-native-contract';const db=native;const withCurrentBusinessAuthorization=native.withCurrentBusinessAuthorization,businessAuditActor=native.businessAuditActor,businessEnterpriseBindingFromMerchant=native.businessEnterpriseBindingFromMerchant,callPlatformBusinessCommand=native.callPlatformBusinessCommand;\nexport const BUSINESS_NEW_INFORMATION_READS=${JSON.stringify(fixed)};\n${transpile(decl(parse(pin(AR+'/server/businessRouter.ts'),AR+'/server/businessRouter.ts'),'readBusinessNewInformationFacts').getText()).replace(/^export\s+/,'')}\nexport {readBusinessNewInformationFacts};`);
  bridges.set(AR+'/server/new-native-contract.ts',`export {newInformationFactsInputSchema,newInformationFactsResultSchema} from './${compiled.contracts.name}';`);
  const pf = pin(AR+'/server/platformOrderApi.ts');
  virtual.set(AR+'/server/platformOrderApi.ts','const callPlatformOrder=native.callPlatformOrder;\n'+transpile(decl(parse(pf,AR+'/server/platformOrderApi.ts'),'getPlatformOrderNewInformationFacts').getText()));
  const entry = `import {createAdminNewInformationRouterForSource,createAdminNewInformationRouter} from './server/routers/adminNewInformation';import {createAdminNewInformationService} from './server/services/adminNewInformation';export {createAdminNewInformationRouterForSource,createAdminNewInformationRouter,createAdminNewInformationService};`;
  const result = await compileModule('admin-core',entry,AR,bridges,virtual,true,'{createAdminNewInformationRouterForSource,createAdminNewInformationRouter,createAdminNewInformationService}');
  fs.writeFileSync(O+'/compiled-admin.reference.mjs', result.text);
  const ca = parse(result.text), oa = parse(oldRuntime);
  const moduleNames = ['adminNewInformationUnreadRefsSchema + ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS','createAdminNewInformationService','createAdminNewInformationRouter'];
  const oldRouter = decl(oa,'createAdminNewInformationRouter'), compiledRouter = decl(ca,'createAdminNewInformationRouter');
  const newError = one(nodes(compiledRouter,n=>ts.isNewExpression(n)&&ts.isIdentifier(n.expression)), 'compiled router error class').expression.text;
  const oldError = one(nodes(oldRouter,n=>ts.isNewExpression(n)&&ts.isIdentifier(n.expression)), 'captured router error class').expression.text;
  const patches = ['createAdminNewInformationService','createAdminNewInformationRouter'].map(name => {
    const previous = decl(oa,name), current = decl(ca,name);
    let code = current.getText(ca);
    if (name === 'createAdminNewInformationRouter' && newError !== oldError) {
      const changes = nodes(current,n=>ts.isIdentifier(n)&&n.text===newError).map(n=>({start:n.getStart(ca)-current.getStart(ca),end:n.end-current.getStart(ca),before:n.text,after:oldError,reason:'same captured native TRPCError import binding'}));
      code=delta(code,changes).next;
    }
    return {start:previous.getStart(oa),end:previous.end,before:previous.getText(oa),after:code,reason:'exact freshly compiled core declaration '+name};
  });
  const inspectSchema = decl(oa,'adminNewInformationInspectSchema').parent.parent;
  const schemaVars = ['ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS','adminNewInformationUnreadRefsSchema'].map(name=>'var '+decl(ca,name).getText(ca)+';').join('\n')+'\n';
  assert(decl(ca,'adminNewInformationUnreadRefsSchema').getText(ca).includes('z.object'), 'schema z uses identical captured imported z binding');
  patches.push({start:inspectSchema.getStart(oa),end:inspectSchema.getStart(oa),before:'',after:schemaVars,reason:'compiled complete unread refs schema/constants, existing schemas unchanged'});
  const runtime = saveDelta('runtime',oldRuntime,patches,moduleNames);
  const name = 'newInformation.admin.'+runtime.sha256+'.runtime.mjs';
  fs.mkdirSync(O+'/runtime',{recursive:true}); fs.writeFileSync(O+'/runtime/'+name,runtime.text);
  const ra = parse(runtime.text);
  assert(decl(ra,'createAdminNewInformationService').getText(ra).includes('async unreadRefs(viewer, input)'), 'compiled complete unread query exists');
  assert(decl(ra,'createAdminNewInformationRouter').getText(ra).includes('unreadRefs:'), 'compiled router registration exists');
  const oldFactory = decl(oa,'createNativeNewInformationRuntime'), newFactory = decl(ra,'createNativeNewInformationRuntime');
  const nativeBindings = n => [
    ...nodes(n,x=>ts.isPropertyAccessExpression(x)&&x.expression.text==='native').map(x=>x.name.text),
    ...nodes(n,x=>ts.isBinaryExpression(x)&&x.right.text==='native'&&ts.isObjectLiteralExpression(x.left)).flatMap(x=>x.left.properties.map(p=>p.name.text)),
    ...nodes(n,x=>ts.isVariableDeclaration(x)&&x.initializer?.text==='native'&&ts.isObjectBindingPattern(x.name)).flatMap(x=>x.name.elements.map(p=>p.propertyName?.text??p.name.text)),
  ].sort();
  assert(JSON.stringify(nativeBindings(oldFactory))===JSON.stringify(nativeBindings(newFactory)), 'native property ABI unchanged');
  dependencies.admin = [...new Set(nativeBindings(newFactory))];
  const nativeCall = one(nodes(a,n=>ts.isCallExpression(n)&&n.expression.text==='__createNewInformationAdmin'), 'actual native factory call');
  const provided = nativeCall.arguments[0].properties.map(p=>p.name.text);
  for (const key of dependencies.admin) assert(provided.includes(key), 'actual API native binding missing '+key);
  const apiPatches = [{start:runtimeImport.moduleSpecifier.getStart(a)+1,end:runtimeImport.moduleSpecifier.end-1,before:runtimeImport.moduleSpecifier.text,after:'../runtime/'+name,reason:'only actual admin notification runtime import URL'}];
  const {object,z} = schemaObject(a);
  apiPatches.push({start:object.getStart(a)+1,end:object.getStart(a)+1,before:'',after:`\n  customerIds: ${z}.array(${z}.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(2000).optional(),`,reason:'actual embedded customer list schema IDs narrowing contract'});
  assert(nodes(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='listCustomers').length===0, 'admin has no customer list SQL service slot, BFF only');
  const api = saveDelta('admin',s,apiPatches,['newInformation.admin import URL','customerListSchema.customerIds']);
  compiled.admin = {...runtime,text:undefined,name,file:O+'/runtime/'+name,compiledSourceInputs:result.inputs};
  return {...api,text:undefined,candidate:O+'/admin-api.js',adminCustomerService:'absent: native customer.list forwards to platform; schema slot only',nativeFactoryBindingUnchanged:true};
}

function buildFront() {
  const s = pin(C+'/front-api.js'), a = parse(s), {object,z} = schemaObject(a);
  const f = decl(a,'listCustomers');
  const where = one(nodes(f,n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.text==='where')), 'customer list shared WHERE before COUNT');
  const condition = one(nodes(f,n=>ts.isVariableDeclaration(n)&&n.name.text==='conditions'), 'list original conditions');
  const readFn = one(nodes(f,n=>ts.isVariableDeclaration(n)&&n.name.text==='read'), 'original authorized read callback');
  assert(condition.getStart(a)>readFn.getStart(a) && where.getStart(a)>condition.getStart(a), 'IDs predicate stays in authorized callback');
  const sqlName = where.declarationList.declarations[0].initializer.expression.expression.getText(a);
  const starMode = one(f.body.statements.filter(n=>ts.isIfStatement(n)&&n.getText(a).startsWith('if (input.starMode')), 'direct-call validation insertion before original star check');
  const errorClass = one(nodes(starMode,n=>ts.isNewExpression(n)&&ts.isIdentifier(n.expression)), 'native list error ABI').expression.text;
  const declaration = 'const __cwCustomerUnread20261121Ids';
  assert(!s.includes(declaration), 'fresh unique private validation variable');
  const predicate = `    if (__cwCustomerUnread20261121Ids.data !== undefined) {\n      const ids = Array.from(new Set(__cwCustomerUnread20261121Ids.data));\n      conditions.push(ids.length ? ${sqlName}\`c.id IN (\${${sqlName}.join(ids.map(id => ${sqlName}\`\${id}\`), ${sqlName}\`, \`)})\` : ${sqlName}\`FALSE\`);\n    }\n`;
  const patches = [
    {start:object.getStart(a)+1,end:object.getStart(a)+1,before:'',after:`\n  customerIds: ${z}.array(${z}.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(2000).optional(),`,reason:'actual platform customer list schema IDs narrowing contract'},
    {start:starMode.getStart(a),end:starMode.getStart(a),before:'',after:`${declaration} = customerListSchema.shape.customerIds.safeParse(input.customerIds);\n  if (!__cwCustomerUnread20261121Ids.success) throw new ${errorClass}({code:"BAD_REQUEST",message:"客户ID筛选无效",cause:__cwCustomerUnread20261121Ids.error});\n  `,reason:'direct native list strict IDs validation, existing identity guards unchanged'},
    {start:where.getStart(a),end:where.getStart(a),before:'',after:predicate,reason:'IDs AND predicate in original authorized conditions BEFORE identical COUNT/pagination/sort WHERE'}
  ];
  const api = saveDelta('front',s,patches,['customerListSchema.customerIds','listCustomers direct input validation','listCustomers.conditions before shared WHERE/COUNT']);
  const na = parse(api.text), nf = decl(na,'listCustomers');
  const oldBranches = nodes(f,n=>ts.isIfStatement(n)).map(print);
  const newBranches = nodes(nf,n=>ts.isIfStatement(n)).filter(n=>!n.getText(na).includes('__cwCustomerUnread20261121Ids')).map(print);
  assert(JSON.stringify(oldBranches)===JSON.stringify(newBranches), 'every existing native list permission/filter branch unchanged');
  dependencies.front = {z,sql:sqlName,ErrorClass:errorClass,authorization:'existing withCustomerStarAccess / withCustomerAssigneeStarAccess untouched'};
  return {...api,text:undefined,candidate:O+'/front-api.js',originalBranchesUnchanged:true};
}

assert(!fs.existsSync(O), 'fresh backend candidate output required'); fs.mkdirSync(O,{recursive:true});
const effective = JSON.parse(pin(C+'/effective-files.json'));
const contractEntry = one(Object.entries(effective).filter(([k])=>k.startsWith('newInformation.contracts.')), 'captured existing facts contract');
const contractText = pin(contractEntry[1].local);
assert(H(contractText)===contractEntry[1].sha256 && path.basename(contractEntry[1].path)==='newInformation.contracts.'+H(contractText)+'.runtime.mjs','captured facts contract hash/name unchanged');
compiled.contracts = {name:path.basename(contractEntry[1].path),sha256:H(contractText),bytes:Buffer.byteLength(contractText),existing:true,target:contractEntry[1].path};
fs.mkdirSync(O+'/runtime',{recursive:true}); fs.copyFileSync(contractEntry[1].local,O+'/runtime/'+compiled.contracts.name);
const admin = await buildAdmin(), front = buildFront();
const sourceChanges = [
  [AR+'/server/services/adminNewInformation.ts',['AdminNewInformationService.unreadRefs','createAdminNewInformationService.unreadRefs','createAdminNewInformationService.markDisplayed']],
  [AR+'/server/routers/adminNewInformation.ts',['createAdminNewInformationRouter.unreadRefs']],
  [AR+'/shared/adminNewInformation.ts',['ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS','adminNewInformationUnreadRefsSchema','AdminNewInformationUnreadRefs']],
  [AR+'/server/services/adminNewInformation.test.ts',['complete unread refs and authoritative display summaries']],
  [AR+'/server/services/adminNewInformationSources.test.ts',['complete unread refs real authorized merchant source integration']],
  [AR+'/server/customerStarsBusinessHook.spec.ts',['customerIds narrowing list BFF contract']],
  [AR+'/client/src/business/platform/shared/crmCustomers.ts',['customerListIdsSchema','customerListSchema.customerIds']],
  [AR+'/client/src/business/platform/front-router-types/server/services/crmCustomers.ts',['listCustomers input validation and conditions before shared WHERE']],
  [FR+'/shared/crmCustomers.ts',['customerListIdsSchema','customerListSchema.customerIds']],
  [FR+'/server/services/crmCustomers.ts',['listCustomers input validation and conditions before shared WHERE']],
  [FR+'/server/customerStarFilter.test.ts',['SQL mock selected predicate','customerIds complete server-side intersection']],
].map(([file,slots])=>{pin(file);return {file,sha256:sourceHashes[file],slots};});
for (const [p,h] of Object.entries(sourceHashes)) assert(H(fs.readFileSync(p))===h, 'source/capture drift '+p);
const records = JSON.parse(read(C+'/records.json'));
const apiTarget = role => {const r=records.files[role+'-api'];assert(r&&H(read(C+'/'+role+'-api.js'))===r.sha256,'actual captured API target hash '+role);return r;};
const manifest = {scope:'admin compact unread backend-only offline candidate',sourceRoots:{manager:AR,platform:FR},
  api:{admin:{...admin,path:apiTarget('admin').path,local:admin.candidate,beforeSHA:admin.beforeSha256,afterSHA:admin.sha256,size:admin.bytes},front:{...front,path:apiTarget('front').path,local:front.candidate,beforeSHA:front.beforeSha256,afterSHA:front.sha256,size:front.bytes}},
  runtimes:[{path:path.dirname(effective['new-information-admin.runtime.mjs'].path)+'/'+compiled.admin.name,local:compiled.admin.file,sha256:compiled.admin.sha256,size:compiled.admin.bytes}],
  existingFiles:[{path:contractEntry[1].path,sha256:compiled.contracts.sha256}],sourceChanges,sourcePins:sourceHashes,compiled,dependencies,sourceHashes,
  targets:{adminApi:apiTarget('admin'),frontApi:apiTarget('front'),adminRuntimeDirectory:path.dirname(effective['new-information-admin.runtime.mjs'].path),oldAdminRuntime:effective['new-information-admin.runtime.mjs'].path,existingFactsContract:contractEntry[1].path},
  checks:{syntax:true,astExactSlots:true,inverseVerified:true,outsideHunksVerified:true,originalPermissionBranchesUnchanged:true,nativeDepsABIUnchanged:true,noApiStartup:true,noDatabase:true,noSSH:true,noGit:true,noProductionWrites:true,noOldGeneratorExecution:true,noMigration:true,unchangedFactsContract:true},
  tests:{manager:{files:3,passed:96,log:'/home/ubuntu/admin-backend-target-tests.log'},platform:{files:4,passed:87,log:'/home/ubuntu/platform-customerids-target-tests.log'}},
  runtimePolicy:'Isolated bridge compile supplies only two core functions and two additive schema/constants; AST error import mapping preserves native ABI. Every other captured runtime byte and native branch is retained exactly.'};
fs.writeFileSync(O+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({adminRuntime:compiled.admin.name,adminHunks:admin.hunks,frontHunks:front.hunks,runtimeHunks:compiled.admin.hunks,manifest:O+'/manifest.json'},null,2));
