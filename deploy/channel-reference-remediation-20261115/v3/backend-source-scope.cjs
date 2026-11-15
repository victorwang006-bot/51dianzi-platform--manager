'use strict';
const C=require('./scoped-core.cjs');
const {assert,ts,parse,sha,delta,offset,one}=C;
const SHARED='shared/channelReferenceBrand.ts';
const APPROVED={
 [SHARED]:{hash:'9a292f13f6d4c5155bfc727e0684aad531662337f409ec4416775b70ee4a4011',added:['ChannelReferenceBrandProfile','ChannelReferenceBrandMatch','normalizeChannelReferenceBrand','normalizeLegacyLcscBrandLiteral','LEGACY_SNAPSHOT_ALIASES','VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS','matchChannelReferenceBrand']},
 'server/channelReference/snapshot.ts':{hash:'ae4057336e956e2bd11c557060833df77685b47e70c98376a8377332c05a272f',changed:['brandProof'],removed:['brand','ALIAS_LITERALS'],added:['import:../../shared/channelReferenceBrand','validateChannelReferenceSnapshot']},
 'server/channelReference/service.ts':{hash:'c2a301a0267b03235db7351752c380c67adc78007d436e969015ad6c4c3013ea',changed:['import:./lcscPage','matchesReferenceIdentity'],added:['import:../../shared/channelReferenceBrand']},
 'server/channelReference/lcscPage.ts':{hash:'4fdb4818201db469da7eea7c0218e6a1e3f857241469d4fa9fd010d01526cf48',changed:['normalizeLcscBrand','parseLcscProductPage'],added:['import:../../shared/channelReferenceBrand','matchesLcscBrand']},
 'server/channelReference/lcscSearchPage.ts':{hash:'0db8ae00bbd92c377cf15fa2241db91a1587217e7d78720b8b2e490be3857b1b',changed:['import:./lcscPage','parseLcscSearchPage']},
 'server/channelReference/ickeyPage.ts':{hash:'1e94cf41f3d99de9283a9a5ffa9cb849c24c17511511120b2c24e18aec3c9f2d',changed:['parseIckeySearchPage'],added:['import:../../shared/channelReferenceBrand']}
};
function key(s,a){return ts.isImportDeclaration(s)?'import:'+s.moduleSpecifier.text:s.name?.text||(ts.isVariableStatement(s)?s.declarationList.declarations.map(d=>d.name.getText(a)).join(','):'kind:'+s.kind);}
function finiteArray(bytes,name){const a=parse(bytes.toString('utf8'),name,ts.ScriptKind.TS),d=one(a,x=>ts.isVariableDeclaration(x)&&x.name.getText(a)===name,'finite literal '+name);let v=d.initializer;while(ts.isAsExpression(v)||ts.isParenthesizedExpression(v))v=v.expression;assert(ts.isArrayLiteralExpression(v));return v.elements.map(r=>{assert(ts.isArrayLiteralExpression(r)&&r.elements.length===2&&r.elements.every(ts.isStringLiteral));return r.elements.map(s=>s.text);});}
function validate(n,before,after,scope){
 const rule=APPROVED[n];assert(rule,'EXACT_APPROVED_BACKEND_FILE');assert.equal(sha(after),rule.hash,'INDEPENDENT_REVIEW_COMPLETE_BODY_PIN');assert.equal(scope.kind,n===SHARED?'new-pure-shared-module':'exact-reviewed-backend-ast-migration');
 const texts=[before.toString('utf8'),after.toString('utf8')],trees=texts.map(t=>parse(t,n,ts.ScriptKind.TS)),maps=trees.map(a=>new Map(a.statements.map(s=>[key(s,a),s]))),owners=[];
 for(const k of new Set([...maps[0].keys(),...maps[1].keys()])){const x=maps[0].get(k),y=maps[1].get(k);if(x&&y&&x.getFullText(trees[0])===y.getFullText(trees[1]))continue;const kind=!x?'added':!y?'removed':'changed';
 // Trivia on the following unchanged statement is neutralized separately by precise byte partitions.
 if(x&&y&&x.getText(trees[0])===y.getText(trees[1]))continue;
 assert((rule[kind]||[]).includes(k),'CHANGE_OUTSIDE_FINITE_AST_OWNER '+n+' '+k);owners.push({owner:k,kind,beforeSha256:x?sha(x.getText(trees[0])):null,afterSha256:y?sha(y.getText(trees[1])):null});}
 const neutral=(i)=>{const edits=[];for(const k of [...(rule.changed||[]),...(rule.added||[]),...(rule.removed||[])]){const s=maps[i].get(k);if(s){let end=s.end;let replacement=(rule.changed||[]).includes(k)?Buffer.from('/* AST_OWNER:'+k+' */'):Buffer.alloc(0);if(i===1&&['server/channelReference/lcscPage.ts','server/channelReference/ickeyPage.ts'].includes(n)&&k==='import:../../shared/channelReferenceBrand'){const header=texts[0].slice(0,trees[0].statements[0].getStart(trees[0]));assert.equal(texts[1].slice(0,s.getStart(trees[1])),header,'EXACT_MOVED_HEADER_BYTES');const following=trees[1].statements[1],gap=texts[1].slice(s.end,following.getStart(trees[1]));assert.equal(gap,'\n\n');end+=gap.length;replacement=Buffer.from(header);}edits.push({start:offset(texts[i],s.getFullStart()),end:offset(texts[i],end),before:Buffer.from(texts[i].slice(s.getFullStart(),end)),after:replacement,reason:'exact independently reviewed AST owner; preserve existing header trivia'});}}return delta(i?after:before,edits).after;};
 if(n!==SHARED)assert(neutral(0).equals(neutral(1)),'UNMODIFIED_SOURCE_PARTITIONS_BYTE_DRIFT '+n);else{assert.equal(before.length,0);assert(trees[1].statements.every(s=>!ts.isImportDeclaration(s)),'PURE_SHARED_NO_IMPORTS');}
 return {relative:n,kind:scope.kind,beforeSha256:before.length?sha(before):null,afterSha256:sha(after),independentReviewBodySha256:rule.hash,astOwners:owners,unmodifiedBytesPreserved:n!==SHARED,pureNewModule:n===SHARED};
}
module.exports={SHARED,APPROVED,validate,finiteArray};
