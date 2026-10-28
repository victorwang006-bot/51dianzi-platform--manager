import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {BASES,BLOCK_REASON,sha256,patchBackend,patchFrontend,patchHtml} from './patch-cn-review-readable-detail.mjs';
const backend=readFileSync(process.env.CN_REVIEW_BACKEND || new URL('../deploy/evidence/cn-review-20261028/review-functions.date-fixed.js',import.meta.url),'utf8');
const frontend=readFileSync(process.env.CN_REVIEW_FRONTEND || new URL('../deploy/evidence/cn-review-20261028/review-component.before.js',import.meta.url),'utf8');
const html=readFileSync(process.env.CN_REVIEW_HTML || new URL('../deploy/evidence/cn-review-20261028/import-map.before.html',import.meta.url),'utf8');
const patched=patchBackend(backend);
const patchedUi=patchFrontend(frontend);
const effective={companyName:'测试企业',creditCode:'91440300MA12345678',companyType:'有限责任公司',legalPerson:'原法人',companyRole:null,bankAccountName:'测试企业',bankAccountNumber:'1234567890123456',bankName:'测试银行',regAddress:'测试地址',establishedAt:'2020-01-02',salesOwner:null,salesOwnerCode:null};
const merchant={id:30780,registrationRegion:'CN',businessLicense:effective.creditCode,crmOwnerPortalUserId:'42',status:'approved',crmStatus:'enabled'};
function makeRow(changes={}) {return {...effective,companyRegistrationRegion:'CN',enterpriseRegistrationRegion:'CN',enterpriseCreditCode:effective.creditCode,companyUserId:'42',dataOwnerUserId:'42',superAdminUserId:'42',memberStatus:'active',memberRole:'super_admin',ownerLoginDisabled:0,reviewStatus:'pending',pendingDraft:{...effective},pendingDraftJsonValid:1,expectedVersion:'a'.repeat(64),submittedAt:'2026-10-28T07:44:58Z',...changes};}
function snippet(code,name,next) {return code.slice(code.indexOf('function '+name+'('),code.indexOf('\n'+next,code.indexOf('function '+name+'(')));}
function backendContext(row) {
  const sql4=(...args)=>args;sql4.raw=v=>v;
  const executor={select:()=>({from:()=>({where:()=>({limit:async()=>[merchant]})})}),execute:async()=>[ [row] ]};
  const context=vm.createContext({sql4,PLATFORM_DB:'test',CN_REVIEW_VERSION_PREFIX:'cn-registration-review-v1',getDb:async()=>executor,merchants:{id:30780},eq:()=>null});
  const helpers=[snippet(patched,'decodeJsonValue','function normalizeMaterialJson'),snippet(patched,'normalizeCreditCode','function normalizePortalUserId'),snippet(patched,'normalizeCrmPortalUserId','function decideMerchantCrmGrant'),snippet(patched,'merchantRegistrationIdentity','var CRM_COMPANY_ALREADY_ENABLED_MESSAGE')].join('\n');
  const pure=patched.slice(patched.indexOf('var CN_REVIEW_DRAFT_KEYS ='),patched.indexOf('function cnReviewCompanyGuard('));
  const detail=patched.slice(patched.indexOf('async function getCnRegistrationReviewDetail('),patched.indexOf('async function reviewCnRegistrationDraft('));
  vm.runInContext(helpers+'\n'+pure+'\n'+detail,context);return context;
}
test('all full production baseline hashes match',{skip:!(process.env.CN_REVIEW_BACKEND&&process.env.CN_REVIEW_FRONTEND&&process.env.CN_REVIEW_HTML)},()=>{for(const [k,v] of Object.entries({backend,frontend,html}))assert.equal(sha256(v),BASES[k]);});
test('keeps entire approval/rejection mutation byte-for-byte unchanged',()=>assert.equal(patched.slice(patched.indexOf('async function reviewCnRegistrationDraft(')),backend.slice(backend.indexOf('async function reviewCnRegistrationDraft('))));
test('keeps subject/owner/legal guard byte-for-byte unchanged',()=>assert.equal(patched.slice(patched.indexOf('function cnReviewAssertSubject('),patched.indexOf('function cnReviewCompanyGuard(')),backend.slice(backend.indexOf('function cnReviewAssertSubject('),backend.indexOf('function cnReviewCompanyGuard('))));
test('legal-person changes are readable but not reviewable',async()=>{const row=makeRow({pendingDraft:{...effective,legalPerson:'新法人'}}),ctx=backendContext(row);const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.canReview,false);assert.equal(d.reviewBlockedReason,BLOCK_REASON);assert.ok(d.effective&&d.candidate);assert.ok(d.differences.some(x=>x.field==='legalPerson'));});
test('company-name changes are readable but not reviewable',async()=>{const ctx=backendContext(makeRow({pendingDraft:{...effective,companyName:'新企业名称'}}));const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.canReview,false);assert.equal(d.reviewBlockedReason,BLOCK_REASON);});
test('normal non-legal resubmissions remain reviewable',async()=>{const ctx=backendContext(makeRow({pendingDraft:{...effective,bankName:'新开户行'}}));const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.canReview,true);assert.equal(d.reviewBlockedReason,null);assert.ok(d.differences.some(x=>x.field==='bankName'));});
test('owner/member validation still rejects unsafe detail reads',async()=>{const ctx=backendContext(makeRow({memberRole:'member'}));await assert.rejects(()=>ctx.getCnRegistrationReviewDetail(30780),/CN_REVIEW_OWNER_OR_SUBJECT_INVALID/);});
test('subject binding validation still rejects unsafe detail reads',async()=>{const ctx=backendContext(makeRow({enterpriseCreditCode:'91440300MA87654321'}));await assert.rejects(()=>ctx.getCnRegistrationReviewDetail(30780),/CN_REVIEW_SUBJECT_MISMATCH/);});
test('protected mutation guard still rejects legal changes',()=>{const row=makeRow({pendingDraft:{...effective,legalPerson:'新法人'}}),ctx=backendContext(row);assert.throws(()=>ctx.cnReviewAssertSubject(merchant,row,row.pendingDraft,true),/CN_REVIEW_LEGAL_CHANGE_REQUIRED/);});
test('no pending candidate is not fabricated from old data',async()=>{const ctx=backendContext(makeRow({reviewStatus:'approved',pendingDraft:null}));const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.canReview,false);assert.equal(d.candidate,null);});
function render(data,mayApprove=true,stateOverrides=[]){
  let stateIndex=0;
  const updates=[];
  const r={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState:v=>[stateOverrides[stateIndex++]??v,n=>updates.push(n)],useEffect:()=>{}};
  const context=vm.createContext({r,T:'button',oa:()=>false,la:()=>true,ut:()=>'',ct:()=>'',it:'summary',xa:'differences',ha:'documents',me:()=>{},ze:e=>e.message,ca:()=>{throw Error('must not mutate');}});
  const oe=patchedUi.slice(patchedUi.indexOf('function Oe('),patchedUi.indexOf('function oa('));
  const start=patchedUi.indexOf('function fa('),end=patchedUi.indexOf('}function ',start)+1;
  vm.runInContext(oe+'\n'+patchedUi.slice(start,end),context);
  const tree=context.fa({merchantId:30780,detailQuery:{data,isLoading:false,isError:false},mutation:{isPending:false,mutate:()=>{throw Error('must not mutate');}},mayApprove,onClose:()=>{}});
  const nodes=[];function visit(x){if(x&&typeof x==='object'){nodes.push(x);for(const child of x.children||[])Array.isArray(child)?child.forEach(visit):visit(child);}}visit(tree);
  return {nodes,updates,context};
}
test('frontend shows protected detail and reason, disables both decisions',()=>{const d={region:'CN',canReview:false,candidate:{expectedVersion:'a'.repeat(64),summary:{}},effective:{},reviewKind:'resubmission',reviewBlockedReason:BLOCK_REASON,reviewBlockedCode:'CN_REVIEW_LEGAL_CHANGE_REQUIRED'};const {nodes,updates}=render(d);assert.ok(nodes.some(n=>n.props['data-review-blocked']===true&&n.children.includes(BLOCK_REASON)));for(const key of ['data-review-approve','data-review-reject']){const button=nodes.find(n=>n.props[key]);assert.ok(button);assert.equal(button.props.disabled,true);button.props.onClick();}assert.equal(updates.length,0);});
test('frontend normal authorized decisions remain enabled',()=>{const {nodes}=render({region:'CN',canReview:true,candidate:{expectedVersion:'a'.repeat(64),summary:{}},reviewKind:'resubmission'});for(const key of ['data-review-approve','data-review-reject'])assert.equal(nodes.find(n=>n.props[key]).props.disabled,false);});
test('frontend read-only account cannot make normal decisions',()=>{const {nodes}=render({region:'CN',canReview:true,candidate:{expectedVersion:'a'.repeat(64),summary:{}},reviewKind:'resubmission'},false);for(const key of ['data-review-approve','data-review-reject'])assert.equal(nodes.find(n=>n.props[key]).props.disabled,true);});
test('only one import-map destination changes; original assets untouched',()=>{const url='/assets/Merchants-review-readable-'+sha256(patchedUi).slice(0,16)+'.js';assert.equal(patchHtml(html,url),html.replace('"/assets/Merchants-review-ui-8bbfe0e38a230e0b.js"',JSON.stringify(url)));});
test('all transformations refuse a second application',()=>{assert.throws(()=>patchBackend(patched));assert.throws(()=>patchFrontend(patchedUi));assert.throws(()=>patchHtml(patchHtml(html,'/assets/Merchants-review-readable-1234567890abcdef.js'),'/assets/Merchants-review-readable-1234567890abcdef.js'));});

test('unknown non-reviewable reasons do not gain read-only display',()=>{const {nodes}=render({region:'CN',canReview:false,candidate:{expectedVersion:'a'.repeat(64),summary:{}},reviewBlockedCode:'OTHER',reviewBlockedReason:'Other reason'});assert.ok(!nodes.some(n=>n.props['data-review-approve']));});
test('existing confirmation cannot submit a newly protected candidate',()=>{const {nodes,updates}=render({region:'CN',canReview:false,candidate:{expectedVersion:'a'.repeat(64),summary:{}},reviewKind:'resubmission',reviewBlockedReason:BLOCK_REASON,reviewBlockedCode:'CN_REVIEW_LEGAL_CHANGE_REQUIRED'},true,['approved','a'.repeat(64),true,'']);const button=nodes.find(n=>n.props['data-review-submit']);assert.ok(button);assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(updates.length,0);});
test('normal initial registrations remain readable and reviewable',async()=>{const ctx=backendContext(makeRow({pendingDraft:null}));const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.reviewKind,'initial');assert.equal(d.canReview,true);assert.equal(d.reviewBlockedReason,null);});
test('date-only resubmission compares established dates correctly',async()=>{const ctx=backendContext(makeRow({pendingDraft:{...effective,establishedAt:'2020-02-03'}}));const d=await ctx.getCnRegistrationReviewDetail(30780);assert.equal(d.canReview,true);assert.ok(d.differences.some(x=>x.field==='establishedAt'&&x.before==='2020-01-02'&&x.after==='2020-02-03'));});
