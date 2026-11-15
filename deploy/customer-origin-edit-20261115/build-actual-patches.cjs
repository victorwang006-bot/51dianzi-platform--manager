'use strict';
// OFFLINE ONLY. Never import, execute or rebuild an acquired runtime bundle.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const repo = '/home/ubuntu/work/51dianzi-platform--manager';
const ts = require(repo + '/node_modules/typescript');
const out = __dirname;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const parse = (s, kind = ts.ScriptKind.JS) => ts.createSourceFile('isolated', s, ts.ScriptTarget.Latest, true, kind);
const one = (a, label) => { assert.equal(a.length, 1, label); return a[0]; };
const func = (sf, name) => one(sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name), 'unique function ' + name);
const compile = text => ts.transpileModule(text.replace(/\bexport\s+/g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const method = (sf, owner, name) => {
  const found = []; const walk = n => { if (ts.isMethodDeclaration(n) && n.name.getText(sf) === name) found.push(n); ts.forEachChild(n, walk); };
  walk(func(sf, owner)); return one(found, 'unique method ' + owner + '.' + name);
};
const compileMethod = (sf, owner, name) => {
  const js = parse(compile('function __isolated() { return {' + method(sf, owner, name).getText(sf) + '}; }'));
  return method(js, '__isolated', name).getText(js);
};
const mirror = p => parse(fs.readFileSync(repo + '/' + p, 'utf8'), ts.ScriptKind.TS);
const serviceDir = 'client/src/business/platform/front-router-types/server/services/';
const manageSf = mirror(serviceDir + 'channelMaterialManagement.ts');
const contractSf = mirror('shared/internalBusinessOfficialInventory.ts');
const managementDecl = one(contractSf.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(contractSf) === 'channelMaterialManagementSchema')), 'management schema').getText(contractSf);
const schemaCode = compile(managementDecl);

function build(kind, filename, pin) {
  const inputPath = '/home/ubuntu/work/customer-origin-edit-20261115/previous-runtime/' + filename;
  const baseline = fs.readFileSync(inputPath), text = baseline.toString('utf8');
  assert.equal(sha(baseline), pin, 'whole actual baseline SHA');
  assert.deepEqual(Buffer.from(text), baseline);
  const sf = parse(text); assert.equal(sf.parseDiagnostics.length, 0);
  const edits = [];
  const add = (id, owner, start, end, inserted, source) => {
    const node = func(sf, owner);
    assert(start >= node.getStart(sf) && end <= node.end, 'owner bounds ' + id);
    edits.push({ id, owner, start, end, inserted, source, ownerBeforeSha256: sha(node.getText(sf)) });
  };
  const replace = (id, owner, needle, inserted, source) => {
    const n = func(sf, owner), own = n.getText(sf), p = own.indexOf(needle);
    assert(p >= 0 && own.indexOf(needle, p + 1) < 0, 'unique exact anchor ' + id);
    add(id, owner, n.getStart(sf) + p, n.getStart(sf) + p + needle.length, inserted, source);
  };
  const replaceMethodAnchor = (id, owner, name, needle, inserted, source) => {
    const node = method(sf, owner, name), own = node.getText(sf), p = own.indexOf(needle);
    assert(p >= 0 && own.indexOf(needle, p + 1) < 0, 'unique exact method anchor ' + id);
    add(id, owner, node.getStart(sf) + p, node.getStart(sf) + p + needle.length, inserted, source);
  };
  if (kind === 'front') {
    const schema = one(sf.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(sf) === 'officialInventoryPermissionsSchema')), 'actual grant schema');
    const schemaText = schema.getText(sf), needle = 'customerScopeRead: z55.boolean().optional(),';
    const p = schemaText.indexOf(needle); assert(p >= 0 && schemaText.indexOf(needle,p+1)<0);
    edits.push({ id: 'strict-paired-management-schema', owner: 'officialInventoryPermissionsSchema', start: schema.getStart(sf), end: schema.getStart(sf), inserted: schemaCode.replace(/\bz\b/g,'z55')+'\n', source: 'shared/internalBusinessOfficialInventory.ts', ownerBeforeSha256: sha(schemaText) });
    edits.push({ id: 'signed-write-and-management-fields', owner: 'officialInventoryPermissionsSchema', start: schema.getStart(sf)+p+needle.length, end: schema.getStart(sf)+p+needle.length, inserted: '\n    inventoryScopeWrite: z55.boolean().optional(),\n    channelMaterialManagement: channelMaterialManagementSchema.optional(),\n    materialBusinessTeamLeaderWrite: z55.object({ adminAccountId: z55.number().int().safe().positive(), staffUserId: z55.number().int().safe().positive() }).strict().optional(),', source: 'shared/internalBusinessOfficialInventory.ts', ownerBeforeSha256: sha(schemaText) });
    const helperCode = ['officialMaterialRecorderStaffUserId','teamMaterialManagementEligibility','materialManagementProjection','channelCustomerMaterialReadGate'].map(n => compile(func(manageSf,n).getText(manageSf))).join('\n').replace(/\bsql\b/g, 'sql83');
    const sourceNode = func(sf,'teamMaterialSourceEligibility');
    add('shared-management-functions','teamMaterialSourceEligibility',sourceNode.getStart(sf),sourceNode.getStart(sf),helperCode+'\n',serviceDir+'channelMaterialManagement.ts');
    replace('preserve-public-read-add-strict-management','resolveTeamInventoryVisibility','${scope.officialActor && member ? teamMaterialSourceEligibility(scope, options.lock === true) : sql81 `FALSE`}', '${scope.officialActor && member ? continued20261112_channelSourceReadEligibility(scope, options.lock === true) : sql81 `FALSE`} OR ${scope.officialActor && access.write && member ? teamMaterialManagementEligibility(scope, options.lock === true) : sql81 `FALSE`}', serviceDir+'channelTeamInventoryAccess.ts');
    const inventorySf = mirror(serviceDir+'channelInventory.ts');
    const inventorySymbols = code => code.replace(/\bsql\b/g,'sql83').replace(/\brows\b/g,'rows11').replace(/\bbool\b/g,'bool3').replace(/\bgetDb\b/g,'getDb2');
    const findNode = func(sf,'findMaterial');
    add('B1-official-legacy-find-live-write-management-crm','findMaterial',findNode.getStart(sf),findNode.end,
      inventorySymbols(['projectOfficialMaterialManagement','findMaterial'].map(name => compile(func(inventorySf,name).getText(inventorySf))).join('\n')),serviceDir+'channelInventory.ts');
    for (const name of ['listMaterials','getMaterial']) {
      const node = method(sf,'createChannelInventoryService',name);
      add('B1-official-legacy-'+name+'-unified-projection','createChannelInventoryService',node.getStart(sf),node.end,
        inventorySymbols(compileMethod(inventorySf,'createChannelInventoryService',name)),serviceDir+'channelInventory.ts');
    }
    add('material-source-all-scopes-same-management','teamMaterialSourceEligibility',sourceNode.getStart(sf),sourceNode.end,compile(func(mirror(serviceDir+'channelInventorySource.ts'),'teamMaterialSourceEligibility').getText()).replace(/\bsql\b/g,'sql82'),serviceDir+'channelInventorySource.ts');
    replace('list-management-select','createChannelTeamInventoryService','${teamMaterialSourceEligibility(scope, true)} AS canViewSource,','${teamMaterialSourceEligibility(scope, true)} AS canViewSource,\n        ${teamMaterialManagementEligibility(scope, true)} AS canManageMaterial,',serviceDir+'channelTeamInventory.ts');
    replace('list-management-project','createChannelTeamInventoryService','...teamMaterialFrom(row, access2.write, leader),','...teamMaterialFrom(row, access2.write, leader),\n            ...materialManagementProjection(row, access2.write, company2),',serviceDir+'channelTeamInventory.ts');
    replace('legacy-source-dto-all-scopes-same-write-boundary','createChannelTeamInventoryService','const company2 = await linkedCompany(tx, scope, Number(row.companyChannelId));','const company2 = await linkedCompany(tx, scope, Number(row.companyChannelId));\n          row.canViewSource = materialManagementProjection(row, access2.write, company2).canEditMaterial;',serviceDir+'channelTeamInventory.ts');
    replaceMethodAnchor('list-no-channel-name-fallback','createChannelTeamInventoryService','listTeamMaterials','row.authorizedChannelName = bool6(row.canViewSource) ? (company2.linked ? company2.customer?.name ?? null : row.authorizedChannelName) : null;', 'row.authorizedChannelName = materialManagementProjection(row, access2.write, company2).customerSource?.name ?? null;',serviceDir+'channelTeamInventory.ts');
    const optionsNode = method(sf,'createChannelTeamInventoryService','listTeamSourceOptions');
    const optionsCode = compileMethod(mirror(serviceDir+'channelTeamInventory.ts'),'createChannelTeamInventoryService','listTeamSourceOptions').replace(/\bsql\b/g,'sql87').replace(/\bexpected\b/g,'expected4').replace(/\bdatabase\b/g,'database3').replace(/\bvisible\b/g,'resolveTeamInventoryVisibility').replace(/\brows\b/g,'rows13').replace(/\bfail\b/g,'fail13').replace(/\bFROM\b/g,'TEAM_MATERIAL_FROM');
    add('source-options-material-management-only-no-profile-fallback','createChannelTeamInventoryService',optionsNode.getStart(sf),optionsNode.end,optionsCode,serviceDir+'channelTeamInventory.ts');
    replaceMethodAnchor('legacy-official-update-delegates-strict-cas-uuid','createChannelInventoryService','updateMaterial','async updateMaterial(scope, input) {','async updateMaterial(scope, input) {\n      if (scope.officialActor) {\n        const receipt = await createChannelInventoryCollaborationService({ getDb: getDb2 }).updateTeamMaterial(scope, { ...input, requestId: scope.officialActor.requestId });\n        return receipt.item;\n      }',serviceDir+'channelInventory.ts');
    replaceMethodAnchor('legacy-native-update-common-management-before-any-dml','createChannelInventoryService','updateMaterial','return transactional(scope, async (tx) => {','return transactional(scope, async (tx) => {\n        await authorizedMaterial(tx, scope, input.id, true);',serviceDir+'channelInventory.ts');
    for (const [name,executor] of [['listChannels','db'],['getChannel','tx']]) replaceMethodAnchor('host-'+name+'-crm-material-gate','createChannelInventoryService',name,'const predicates = channelProfileReadPredicates(scope, access2);','const predicates = channelProfileReadPredicates(scope, access2);\n          predicates.push(await channelCustomerMaterialReadGate('+executor+', scope));',serviceDir+'channelInventory.ts');
    replace('list-no-owner-edit-inference','teamMaterialFrom','const canEdit = (isMine || leader) && canWrite;','const canEdit = canWrite && bool6(row.canManageMaterial);',serviceDir+'channelTeamInventory.ts');
    replace('edit-no-current-channel-owner-fence','authorizedMaterial','if (write2 && scope.officialActor) visibility.predicates.push(continued20261112_channelSourceReadEligibility(scope, true));','// Original-recorder identity is independent of the current channel owner.\n  if (write2) visibility.predicates.push(teamMaterialManagementEligibility(scope, true));',serviceDir+'channelInventoryCollaboration.ts');
    replace('edit-common-management-select','authorizedMaterial','${teamMaterialSourceEligibility(scope, true)} AS canViewSource','${teamMaterialSourceEligibility(scope, true)} AS canViewSource,\n    ${teamMaterialManagementEligibility(scope, true)} AS canManageMaterial',serviceDir+'channelInventoryCollaboration.ts');
    replace('edit-common-management-denial','authorizedMaterial','!visibility.access.write || !bool5(row.isMine) && !visibility.leader','!materialManagementProjection(row, visibility.access.write, company2).canEditMaterial',serviceDir+'channelInventoryCollaboration.ts');
    const authorizedNode = func(sf,'authorizedMaterial');
    replace('editor-source-mask-all-scopes-no-channel-fallback','authorizedMaterial','return row;','row.canViewSource = materialManagementProjection(row, visibility.access.write, company2).canEditMaterial;\n  row.channelName = materialManagementProjection(row, visibility.access.write, company2).customerSource?.name ?? null;\n  return row;',serviceDir+'channelInventoryCollaboration.ts');
    replace('editor-contract','teamMaterialPublicFrom','canEdit: true,','canEdit: true,\n    canEditMaterial: true,',serviceDir+'channelInventoryCollaboration.ts');
    replaceMethodAnchor('editor-replay-current-name-no-raw-fallback','createChannelInventoryCollaborationService','updateTeamMaterial','return { ...receipt, item: await projectMaterialCompany(tx, scope, receipt.item) };','receipt.item.channelName = current.channelName == null ? null : String(current.channelName);\n          return { ...receipt, item: await projectMaterialCompany(tx, scope, receipt.item) };',serviceDir+'channelInventoryCollaboration.ts');
    replaceMethodAnchor('editor-update-current-name-no-raw-fallback','createChannelInventoryCollaborationService','updateTeamMaterial','if (!updated) notFound();','if (!updated) notFound();\n        updated.channelName = current.channelName;',serviceDir+'channelInventoryCollaboration.ts');
    replace('freeze-management-proof','verifyOfficialInventoryGrant','Object.freeze(grant.permissions);','if (grant.permissions.channelMaterialManagement) {\n    for (const binding of grant.permissions.channelMaterialManagement.recorderBindings) Object.freeze(binding);\n    Object.freeze(grant.permissions.channelMaterialManagement.recorderBindings);\n    Object.freeze(grant.permissions.channelMaterialManagement);\n  }\nif (grant.permissions.materialBusinessTeamLeaderWrite) Object.freeze(grant.permissions.materialBusinessTeamLeaderWrite);\nObject.freeze(grant.permissions);',serviceDir+'internalBusinessOfficialGrant.ts');
    const getter = method(sf,'createChannelInventorySourceService','getTeamMaterialSource');
    const getterCode = compileMethod(mirror(serviceDir+'channelInventorySource.ts'),'createChannelInventorySourceService','getTeamMaterialSource').replace(/\bsql\b/g,'sql82').replace(/\bgetDb\b/g,'getDb2').replace(/\bTRPCError\b/g,'TRPCError71');
    add('source-getter-all-scopes-write-management-crm-no-fallback','createChannelInventorySourceService',getter.getStart(sf),getter.end,getterCode,serviceDir+'channelInventorySource.ts');
  } else {
    const helperSf = mirror('server/services/officialChannelProfileRead.ts');
    const helper = func(sf,'withOfficialChannelProfileRead');
    const helperCode = compile(func(helperSf,'withOfficialChannelProfileRead').getText(helperSf)).replace(/\bsql\b/g,'sql7').replace(/\bTRPCError\b/g,'TRPCError7');
    // The original actual helper uses sql7/TRPCError7; assert rather than guess.
    assert(helper.getText(sf).includes('sql7') && helper.getText(sf).includes('TRPCError7'));
    add('official-live-leader-recorder-map','withOfficialChannelProfileRead',helper.getStart(sf),helper.end,schemaCode.replace(/\bz\b/g,'__ir_admin_d67f0938_import_z')+'\n'+helperCode,'server/services/officialChannelProfileRead.ts + shared/internalBusinessOfficialInventory.ts');
    replace('forward-paired-proof','withCurrentBusinessAuthorization','return withProfileRead(async (channelProfileTeamRead) => {','return withProfileRead(async (channelProfileTeamRead, channelMaterialManagement) => {','server/businessRouter.ts');
    replace('merchant-write-intersection','withCurrentBusinessAuthorization','customerScopeRead: businessScopeAllows(scope, "customers", "read"),','customerScopeRead: businessScopeAllows(scope, "customers", "read"),\n                inventoryScopeWrite: officialInventoryPermissions.write === true && businessScopeAllows(scope, "inventory", "write"),\n                ...(channel && officialInventoryPermissions.write === true && businessScopeAllows(scope, "inventory", "write") ? { materialBusinessTeamLeaderWrite: { adminAccountId: account.id, staffUserId: staffBinding.frontUserId } } : {}),\n                ...(channelMaterialManagement && officialInventoryPermissions.write === true && businessScopeAllows(scope, "inventory", "write") ? { channelMaterialManagement } : {}),','server/businessRouter.ts');
  }
  edits.sort((a,b)=>a.start-b.start || a.end-b.end);
  const spans=edits.map(e=>({...e, offset:Buffer.byteLength(text.slice(0,e.start)), removed:text.slice(e.start,e.end), removedByteLength:Buffer.byteLength(text.slice(e.start,e.end)), insertedByteLength:Buffer.byteLength(e.inserted),beforeSha256:sha(text.slice(e.start,e.end)),insertedSha256:sha(e.inserted)}));
  let cursor=0, shift=0; const parts=[];
  for(const e of spans){assert(e.offset>=cursor);assert.equal(sha(baseline.subarray(e.offset,e.offset+e.removedByteLength)),e.beforeSha256);e.afterOffset=e.offset+shift;parts.push(baseline.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;shift+=e.insertedByteLength-e.removedByteLength;}
  parts.push(baseline.subarray(cursor));const patched=Buffer.concat(parts);
  const inverse=spans.map(e=>({id:e.id,owner:e.owner,offset:e.afterOffset,removedByteLength:e.insertedByteLength,removed:e.inserted,inserted:e.removed,beforeSha256:e.insertedSha256}));
  cursor=0;const recovered=[];for(const e of inverse){assert.equal(sha(patched.subarray(e.offset,e.offset+e.removedByteLength)),e.beforeSha256);recovered.push(patched.subarray(cursor,e.offset),Buffer.from(e.inserted));cursor=e.offset+e.removedByteLength;}recovered.push(patched.subarray(cursor));assert.deepEqual(Buffer.concat(recovered),baseline,'full inverse equality');
  const afterSf=parse(patched.toString());assert.equal(afterSf.parseDiagnostics.length,0,'whole bundle syntax');
  // Security evidence and price service are protected by untouched byte intervals.
  const protectedOwners = kind==='front' ? [...new Set(['originalActorClaims','officialMaterialCreator','officialMaterialRecorderAdminAccountId','continued20261112_channelSourceReadEligibility', ...sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&/price|reference/i.test(n.name?.text)).map(n=>n.name.text)])] : [];
  for(const name of protectedOwners) assert.equal(func(sf,name).getText(sf),func(afterSf,name).getText(afterSf),'protected '+name);
  assert.equal(sha(fs.readFileSync(inputPath)),pin,'second actual disk SHA pin');
  fs.writeFileSync(path.join(out,'baseline-'+kind+'-index.js'),baseline);fs.writeFileSync(path.join(out,'patched-'+kind+'-index.js'),patched);
  fs.writeFileSync(path.join(out,kind+'-patchproof.json'),JSON.stringify({schemaVersion:1,kind,inputPath,beforeSha256:pin,afterSha256:sha(patched),spans,inverse,protectedOwners:protectedOwners.map(name=>({name,sha256:sha(func(sf,name).getText(sf)),byteIdentical:true})),verification:{baselineDoublePinned:true,uniqueAstOwners:true,wholeBundleSyntax:true,fullInverseRecovered:true,untouchedBytesPreserved:true},scope:'Offline only; no whole-bundle rebuild/import, DB, SSH, deployment or UI edits'},null,2)+'\n');
  console.log(JSON.stringify({kind,beforeSha256:pin,afterSha256:sha(patched),spans:spans.length}));
}
build('front','candidate/api/front-index.js','6c217218ed880f3c5ba9f1086a12bd20bdc517615184d6a6fef023b87c59b995');
build('admin','baseline/admin-index.js','dd81abecde638e62d544ada3add7e3b48d29219a4848e8f00b22896a99a3c900');
