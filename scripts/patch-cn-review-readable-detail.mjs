import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const BASES = {
  backend:'e5719e5cacdabad4f5bf945d84a40d1ae768590b0bfdf9a0a354f765bfb3172f',
  frontend:'8bbfe0e38a230e0b2d70a04c70c5683ca7fe7b4bc91a4ce9e9e18c97059c0357',
  html:'60161797a246a0b5b84d1eeb1ea16bd526709816aef5a70ccd8a8522b9c5304b'
};
export const BLOCK_REASON = '本次提交涉及企业名称或法定代表人变更，可查看新旧资料对比，但不能在普通资料审核中直接通过或退回。请使用既有合法主体变更流程处理；已生效资料保持不变。';
function replaceOnce(text, before, after) {
  if(text.split(before).length !== 2) throw Error('Unexpected or duplicate patch anchor: '+before.slice(0,80));
  return text.replace(before,after);
}
export function patchBackend(source) {
  const start=source.indexOf('async function getCnRegistrationReviewDetail(');
  const end=source.indexOf('async function reviewCnRegistrationDraft(',start);
  if(start<0||end<=start) throw Error('Missing exact read-only detail function');
  let block=source.slice(start,end);
  block=replaceOnce(block,
    '  if (state.candidate) cnReviewAssertSubject(merchant, row, state.candidate, state.reviewKind === "resubmission");',
    `  let reviewBlockedReason = null;\n  if (state.candidate) {\n    try {\n      cnReviewAssertSubject(merchant, row, state.candidate, state.reviewKind === "resubmission");\n    } catch (error) {\n      // Read permission is not approval permission. Keep all subject/owner guards.\n      if (!(error instanceof Error) || error.message !== "CN_REVIEW_LEGAL_CHANGE_REQUIRED") throw error;\n      reviewBlockedReason = ${JSON.stringify(BLOCK_REASON)};\n    }\n  }`);
  block=replaceOnce(block,'    canReview: Boolean(state.candidate)','    reviewBlockedReason,\n    reviewBlockedCode: reviewBlockedReason ? "CN_REVIEW_LEGAL_CHANGE_REQUIRED" : null,\n    canReview: Boolean(state.candidate) && !reviewBlockedReason');
  return source.slice(0,start)+block+source.slice(end);
}
export function patchFrontend(source) {
  let result=replaceOnce(source,'if(!Oe(d))return','if(!Oe(d)&&!(d.reviewBlockedCode==="CN_REVIEW_LEGAL_CHANGE_REQUIRED"&&typeof d.reviewBlockedReason==="string"&&Oe({...d,canReview:!0})))return');
  result=replaceOnce(result,'H=()=>{if(!(!s||C)){','H=()=>{if(!(!s||C||!Oe(d))){');
  if(result.split('disabled:C||!s,').length !== 3) throw Error('Expected exactly two approval/rejection buttons');
  result=result.replaceAll('disabled:C||!s,','disabled:C||!s||!Oe(d),');
  result=replaceOnce(result,'disabled:!s||!la(','disabled:!s||!Oe(d)||!la(');
  result=replaceOnce(result,
    'r.createElement("div",{className:"d51-review-v2__detail-scroll","data-review-detail-scroll":!0},S?',
    'd.reviewBlockedReason?r.createElement("p",{role:"alert",className:"d51-review-v2__detail-error","data-review-blocked":!0},d.reviewBlockedReason):null,r.createElement("div",{className:"d51-review-v2__detail-scroll","data-review-detail-scroll":!0},S?');
  return result;
}
export function patchHtml(source,newUrl) {
  if(!/^\/assets\/Merchants-review-readable-[a-f0-9]{16}\.js$/.test(newUrl)) throw Error('Unsafe new module URL');
  return replaceOnce(source,'"/assets/Merchants-review-ui-8bbfe0e38a230e0b.js"',JSON.stringify(newUrl));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [backendPath,frontendPath,htmlPath,outDir]=process.argv.slice(2);
  if(!outDir) throw Error('Usage: node patch-cn-review-readable-detail.mjs <backend> <frontend> <html> <new-output-directory>');
  const inputs={backend:readFileSync(backendPath,'utf8'),frontend:readFileSync(frontendPath,'utf8'),html:readFileSync(htmlPath,'utf8')};
  for(const key of Object.keys(inputs)) if(sha256(inputs[key])!==BASES[key]) throw Error('Inspected '+key+' baseline drifted');
  const backend=patchBackend(inputs.backend),frontend=patchFrontend(inputs.frontend);
  const frontendName='Merchants-review-readable-'+sha256(frontend).slice(0,16)+'.js';
  const html=patchHtml(inputs.html,'/assets/'+frontendName);
  const outputs={backend:'index.backend.js',frontend:frontendName,html:'index.html'};
  const texts={backend,frontend,html};
  mkdirSync(outDir,{recursive:false});
  for(const key of Object.keys(outputs)) writeFileSync(resolve(outDir,outputs[key]),texts[key],{flag:'wx',mode:0o644});
  const manifest={before:BASES,after:Object.fromEntries(Object.entries(texts).map(([k,v])=>[k,sha256(v)])),outputs,frontendUrl:'/assets/'+frontendName};
  writeFileSync(resolve(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(manifest));
}
