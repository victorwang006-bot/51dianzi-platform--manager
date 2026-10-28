import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const sha256=s=>createHash('sha256').update(s).digest('hex');
function once(s,a,b){if(s.split(a).length!==2)throw Error('Unexpected anchor: '+a.slice(0,100));return s.replace(a,b);}
export const LEGAL_GUARD='  // A legal-subject or responsible-person change may only use the existing\n  // verified legal-change workflow. A normal profile draft cannot overwrite it.\n  if (isResubmission && (candidate.companyName !== cnReviewText(row.companyName, 128, true) || candidate.legalPerson !== cnReviewText(row.legalPerson, 64, true))) {\n    throw new Error("CN_REVIEW_LEGAL_CHANGE_REQUIRED");\n  }';
export const CHANGE_NOTICE_FN='function cnReviewChangeNotice(row, candidate, isResubmission) {\n  if (!candidate || !isResubmission) return null;\n  const nameChanged = candidate.companyName !== cnReviewText(row.companyName, 128, true);\n  const personChanged = candidate.legalPerson !== cnReviewText(row.legalPerson, 64, true);\n  if (nameChanged && personChanged) return "企业名称和法人信息有变更，请核对资料后审核。";\n  if (nameChanged) return "企业名称有变更，请核对资料后审核。";\n  if (personChanged) return "法人信息有变更，请核对资料后审核。";\n  return null;\n}\n';
export function patchBackend(source){
 let s=once(source,LEGAL_GUARD,'  // Authorized profile reviews may update companyName/legalPerson.\n  // Credit-code identity, owner/member binding and account guards above remain mandatory.');
 s=once(s,'async function getCnRegistrationReviewDetail(',CHANGE_NOTICE_FN+'async function getCnRegistrationReviewDetail(');
 const start=s.indexOf('async function getCnRegistrationReviewDetail('),end=s.indexOf('async function reviewCnRegistrationDraft(',start);
 let block=s.slice(start,end);
 const catchStart=block.indexOf('  let reviewBlockedReason = null;'),catchEnd=block.indexOf('  const effectiveSummary =',catchStart);
 if(catchStart<0||catchEnd<catchStart||!block.slice(catchStart,catchEnd).includes('CN_REVIEW_LEGAL_CHANGE_REQUIRED'))throw Error('Unexpected detail-read guard');
 block=block.slice(0,catchStart)+'  if (state.candidate) cnReviewAssertSubject(merchant, row, state.candidate, state.reviewKind === "resubmission");\n'+block.slice(catchEnd);
 block=once(block,'    reviewBlockedReason,\n    reviewBlockedCode: reviewBlockedReason ? "CN_REVIEW_LEGAL_CHANGE_REQUIRED" : null,\n    canReview: Boolean(state.candidate) && !reviewBlockedReason','    reviewBlockedReason: null,\n    reviewBlockedCode: null,\n    reviewNotice: cnReviewChangeNotice(row, state.candidate, state.reviewKind === "resubmission"),\n    canReview: Boolean(state.candidate)');
 let result=s.slice(0,start)+block+s.slice(end);
 const mutationStart=result.indexOf('async function reviewCnRegistrationDraft('),mutationEnd=result.indexOf('function cnPendingReviewMerchantCondition(',mutationStart);
 let mutation=result.slice(mutationStart,mutationEnd);
 mutation=once(mutation,'      await tx.execute(sql4`\n        UPDATE ${sql4.raw(PLATFORM_DB)}.enterprises AS enterprise','      const enterpriseUpdate = await tx.execute(sql4`\n        UPDATE ${sql4.raw(PLATFORM_DB)}.enterprises AS enterprise');
 mutation=once(mutation,'           AND CAST(enterprise.superAdminUserId AS CHAR) = CAST(enterprise.crmDataOwnerUserId AS CHAR)\n      `);\n      const merchantUpdate','           AND CAST(enterprise.superAdminUserId AS CHAR) = CAST(enterprise.crmDataOwnerUserId AS CHAR)\n      `);\n      if (candidate.companyName !== cnReviewText(row.companyName, 128, true) && Number(enterpriseUpdate[0]?.affectedRows ?? 0) !== 1) throw new Error("CN_REVIEW_VERSION_CHANGED");\n      const merchantUpdate');
 mutation=once(mutation,'        companyName: candidate.companyName,\n        companyType: candidate.companyType,','        companyName: candidate.companyName,\n        legalPersonName: candidate.legalPerson,\n        companyType: candidate.companyType,');
 return result.slice(0,mutationStart)+mutation+result.slice(mutationEnd);
}
const OLD_DEFAULT='该申请仍待处理，但当前不能直接审核。请核对变更原因并按相应流程处理；不会使用旧生效资料代替候选资料。';
export const SIMPLE_DEFAULT='当前资料暂不能审核，请刷新后重试。';
export function patchMerchant(source){
 let s=once(source,'!Oe(d)?r.createElement("p",{role:"alert",className:"d51-review-v2__detail-error","data-review-blocked":!0},d.reviewBlockedReason||'+JSON.stringify(OLD_DEFAULT)+'):null,','d.reviewNotice||!Oe(d)?r.createElement("p",{role:d.reviewNotice?"status":"alert",className:"d51-review-v2__detail-error","data-review-notice":!!d.reviewNotice,"data-review-blocked":!Oe(d)},d.reviewNotice||d.reviewBlockedReason||'+JSON.stringify(SIMPLE_DEFAULT)+'):null,');
 s=once(s,'Oe(d)?"可普通审核":"需专门处理"','"审核操作"');
 s=once(s,'E&&d51ReadableCandidate(te.data)?r.createElement("span",{className:"d51-review-v2__queue-meta","data-review-queue-status":!0},Oe(te.data)?"可普通审核":"需专门处理"):null,','');
 s=s.replaceAll(JSON.stringify(OLD_DEFAULT),JSON.stringify(SIMPLE_DEFAULT));
 s=s.replaceAll('条待处理','条待审').replaceAll('待处理企业','待审企业').replaceAll('全部待处理','全部待审').replaceAll('待处理列表','待审列表').replaceAll('待处理 ${l}','待审 ${l}');
 s=once(s,'"尚未读取到该待处理申请的详情，请刷新资料后重试。"','"资料加载失败，请刷新后重试。"');
 s=once(s,'"该申请仍在待审列表，但候选资料快照暂不可用。请刷新资料；系统不会用旧生效资料构造审核操作。"','"资料加载不完整，请刷新后重试。"');
 return s;
}
export function patchMessages(s){s=once(s,'"待处理 ",','"待审核 ",');return once(s,'" 条。待处理包含可普通审核及需专门流程的申请；查看详情以按钮和原因提示为准。查看通知仅标已读，不会自动审批或移除申请。"','" 条。点击记录查看资料并审核。"');}
export function patchDashboard(s){s=once(s,'"有新的企业资料待处理"','"有新的企业资料待审核"');return once(s,'"首次申请或资料变更已提交。待处理不等于可直接审批，具体操作及专门流程要求请查看详情。"','"有新资料提交，请核对后审核。"');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [backendPath,merchantPath,messagePath,dashboardPath,htmlPath,out]=process.argv.slice(2);if(!out)throw Error('Expected five verified input files and new output directory');
 const src={backend:readFileSync(backendPath,'utf8'),merchant:readFileSync(merchantPath,'utf8'),messages:readFileSync(messagePath,'utf8'),dashboard:readFileSync(dashboardPath,'utf8'),html:readFileSync(htmlPath,'utf8')};
 const baselines={backend:'236ea7579bae39126dcb3ab27dcad8a90348e13fc59a5cf2083985a40ba5e369',merchant:'adc6198c54ccaa09c96288f1350da7a2debe106310b68d264265e850903e42e4',messages:'fd62d9eb834a9f60ee3184e2b8b626920baaf74d58b4fa9a3b670c90b24c9923',dashboard:'f47b71280a7dfdff408798597ba545f1fc6aa8525481ca2cfeeca5a8ee4ff024',html:'3c722250846fe8bf7411f3ba59440f3c1c8e875f123b8adcb5e6a2f9fbbe2c2a'};
 for(const[k,v]of Object.entries(src))if(sha256(v)!==baselines[k])throw Error('Baseline drift: '+k);
 const patched={backend:patchBackend(src.backend),merchant:patchMerchant(src.merchant),messages:patchMessages(src.messages),dashboard:patchDashboard(src.dashboard)};
 const names={backend:'index.backend.js',merchant:'Merchants-review-standard-'+sha256(patched.merchant).slice(0,16)+'.js',messages:'Messages-review-standard-'+sha256(patched.messages).slice(0,16)+'.js',dashboard:'DashboardLayout-review-standard-'+sha256(patched.dashboard).slice(0,16)+'.js'};
 const mapping={'/assets/Merchants-review-display-adc6198c54ccaa09.js':'/assets/'+names.merchant,'/assets/Messages-review-display-fd62d9eb834a9f60.js':'/assets/'+names.messages,'/assets/DashboardLayout-review-display-f47b71280a7dfdff.js':'/assets/'+names.dashboard};
 let html=src.html;for(const[a,b]of Object.entries(mapping))html=once(html,JSON.stringify(a),JSON.stringify(b));patched.html=html;mkdirSync(out,{recursive:false});for(const[k,v]of Object.entries(patched))writeFileSync(resolve(out,k==='html'?'index.html':names[k]),v,{flag:'wx'});
 const manifest={before:baselines,after:Object.fromEntries(Object.entries(patched).map(([k,v])=>[k,sha256(v)])),names,mapping,policy:'name/legalPerson resubmissions use existing manual approve/reject; credit, owner, transaction, permissions and audit guards retained'};writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}
