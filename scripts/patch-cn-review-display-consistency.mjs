import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const sha256=s=>createHash('sha256').update(s).digest('hex');
function once(s,a,b){if(s.split(a).length!==2)throw Error('Unexpected patch anchor: '+a.slice(0,90));return s.replace(a,b);}
export const READABLE_FN='function d51ReadableCandidate(e){return!!(e&&e.region==="CN"&&e.candidate&&typeof e.candidate.expectedVersion==="string"&&e.candidate.expectedVersion.trim())}';
export const BLOCKED_DEFAULT='该申请仍待处理，但当前不能直接审核。请核对变更原因并按相应流程处理；不会使用旧生效资料代替候选资料。';
export function patchMerchant(s){
  s=once(s,'function Oe(e){',READABLE_FN+'function Oe(e){');
  s=once(s,'if(!Oe(d)&&!(d.reviewBlockedCode==="CN_REVIEW_LEGAL_CHANGE_REQUIRED"&&typeof d.reviewBlockedReason==="string"&&Oe({...d,canReview:!0})))return','if(!d51ReadableCandidate(d))return');
  const helper='function d51ReviewEmpty(message,query,onClose,pending){return r.createElement("div",{className:"d51-review-v2__detail"},r.createElement("p",{role:"status",className:"d51-review-v2__status"},message),r.createElement("footer",{className:"d51-review-v2__actions"},r.createElement(T,{type:"button",variant:"outline",disabled:!!pending,onClick:()=>query.refetch?.(),"data-review-refresh":!0},"刷新资料"),r.createElement(T,{type:"button",variant:"outline",disabled:!!pending,onClick:onClose},"关闭")))}';
  s=once(s,'function fa({',helper+'function fa({');
  s=once(s,'if(!d||d.region!=="CN")return r.createElement("div",{role:"status",className:"d51-review-v2__status"},"\\u8BE5\\u5F85\\u5BA1\\u8BB0\\u5F55\\u5DF2\\u4E0D\\u518D\\u53EF\\u7528\\uFF1B\\u6CA1\\u6709\\u4FDD\\u7559\\u65E7\\u8D44\\u6599\\u5FEB\\u7167\\u3002");', 'if(!d||d.region!=="CN")return d51ReviewEmpty("尚未读取到该待处理申请的详情，请刷新资料后重试。",n,o,C);');
  s=once(s,'if(!d51ReadableCandidate(d))return r.createElement("div",{role:"status",className:"d51-review-v2__status"},"\\u5F53\\u524D\\u6CA1\\u6709\\u53EF\\u5BA1\\u6838\\u7684\\u4F01\\u4E1A\\u8D44\\u6599\\u3002\\u7CFB\\u7EDF\\u4E0D\\u4F1A\\u4F7F\\u7528\\u65E7\\u6709\\u6548\\u8D44\\u6599\\u6784\\u9020\\u5BA1\\u6838\\u64CD\\u4F5C\\u3002");','if(!d51ReadableCandidate(d))return d51ReviewEmpty("该申请仍在待处理列表，但候选资料快照暂不可用。请刷新资料；系统不会用旧生效资料构造审核操作。",n,o,C);');
  s=once(s,'d.reviewBlockedReason?r.createElement("p",{role:"alert",className:"d51-review-v2__detail-error","data-review-blocked":!0},d.reviewBlockedReason):null,','!Oe(d)?r.createElement("p",{role:"alert",className:"d51-review-v2__detail-error","data-review-blocked":!0},d.reviewBlockedReason||'+JSON.stringify(BLOCKED_DEFAULT)+'):null,');
  s=once(s,'r.createElement("span",{className:"d51-review-v2__actions-label"},"\\u5BA1\\u6838\\u51B3\\u5B9A"),','r.createElement(T,{type:"button",variant:"outline",size:"sm",disabled:C||n.isFetching,onClick:()=>n.refetch?.(),"data-review-refresh":!0},n.isFetching?"刷新中…":"刷新资料"),r.createElement("span",{className:"d51-review-v2__actions-label"},Oe(d)?"可普通审核":"需专门处理"),');
  s=once(s,'disabled:C||!s||!Oe(d),onClick:()=>z("approved"),','disabled:C||!s||!Oe(d),title:!s?"当前账号无审核权限":!Oe(d)?(d.reviewBlockedReason||'+JSON.stringify(BLOCKED_DEFAULT)+'):"审核通过",onClick:()=>z("approved"),');
  s=once(s,'disabled:C||!s||!Oe(d),onClick:()=>z("rejected"),','disabled:C||!s||!Oe(d),title:!s?"当前账号无审核权限":!Oe(d)?(d.reviewBlockedReason||'+JSON.stringify(BLOCKED_DEFAULT)+'):"退回候选资料",onClick:()=>z("rejected"),');
  s=once(s,'{enabled:v&&u&&!!K,retry:!1,refetchOnWindowFocus:!0}','{enabled:v&&u&&!!K,retry:!1,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:!0}');
  s=once(s,'r.createElement("span",{className:"d51-review-v2__queue-meta"},ct(m.reviewKind)),','r.createElement("span",{className:"d51-review-v2__queue-meta"},ct(m.reviewKind)),E&&d51ReadableCandidate(te.data)?r.createElement("span",{className:"d51-review-v2__queue-meta","data-review-queue-status":!0},Oe(te.data)?"可普通审核":"需专门处理"):null,');
  s=s.replaceAll('\\u6761\\u5F85\\u5BA1','条待处理').replaceAll('\\u5F85\\u5BA1\\u4F01\\u4E1A','待处理企业').replaceAll('\\u5168\\u90E8\\u5F85\\u5BA1','全部待处理').replaceAll('\\u5F85\\u5BA1\\u5217\\u8868','待处理列表').replaceAll('\\u5F85\\u5BA1 ${l}','待处理 ${l}');
  return s;
}
export function patchMessages(s){
  s=once(s,'"\\u5F85\\u5BA1\\u6838 ",','"待处理 ",');
  s=once(s,'" \\u6761\\u3002\\u67E5\\u770B\\u901A\\u77E5\\u53EA\\u6807\\u8BB0\\u5F53\\u524D\\u63D0\\u4EA4\\u7248\\u672C\\u5DF2\\u8BFB\\uFF0C\\u4E0D\\u4F1A\\u51CF\\u5C11\\u5F85\\u5BA1\\u6570\\u91CF\\u3002"','" 条。待处理包含可普通审核及需专门流程的申请；查看详情以按钮和原因提示为准。查看通知仅标已读，不会自动审批或移除申请。"');
  return s;
}
export function patchDashboard(s){
  s=once(s,'"\\u6709\\u65B0\\u7684\\u4F01\\u4E1A\\u8D44\\u6599\\u5F85\\u5BA1\\u6838"','"有新的企业资料待处理"');
  s=once(s,'"\\u9996\\u6B21\\u7533\\u8BF7\\u6216\\u8D44\\u6599\\u53D8\\u66F4\\u5DF2\\u6B63\\u5F0F\\u63D0\\u4EA4\\uFF0C\\u5F85\\u5BA1\\u4E0E\\u672A\\u8BFB\\u6D88\\u606F\\u5206\\u522B\\u8BA1\\u6570\\u3002"','"首次申请或资料变更已提交。待处理不等于可直接审批，具体操作及专门流程要求请查看详情。"');
  return s;
}
export function patchImportMap(html,mapping){let s=html;for(const [oldUrl,newUrl] of Object.entries(mapping))s=once(s,JSON.stringify(oldUrl),JSON.stringify(newUrl));return s;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [merchantPath,messagePath,dashboardPath,htmlPath,out]=process.argv.slice(2);if(!out)throw Error('Expected four verified input files and new output directory');
  const src={merchant:readFileSync(merchantPath,'utf8'),messages:readFileSync(messagePath,'utf8'),dashboard:readFileSync(dashboardPath,'utf8'),html:readFileSync(htmlPath,'utf8')};
  if(sha256(src.merchant)!=='148b184dd7bdde0f6ef08184a40df03d9363a5333f952c4aaf5d40a9d28d9de0'||sha256(src.html)!=='9381eca8adefa5d320efb15ca370fe73762a2c26856ef1c4fb67cab25bbd53aa')throw Error('Merchant or HTML baseline drifted');
  const patched={merchant:patchMerchant(src.merchant),messages:patchMessages(src.messages),dashboard:patchDashboard(src.dashboard)};
  const names={merchant:'Merchants-review-display-'+sha256(patched.merchant).slice(0,16)+'.js',messages:'Messages-review-display-'+sha256(patched.messages).slice(0,16)+'.js',dashboard:'DashboardLayout-review-display-'+sha256(patched.dashboard).slice(0,16)+'.js'};
  const mapping={'/assets/Merchants-review-readable-148b184dd7bdde0f.js':'/assets/'+names.merchant,'/assets/Messages-review-dialog-notice-e0e10f0fd8ffa44a.js':'/assets/'+names.messages,'/assets/DashboardLayout-platform-navigation-7f6d6fc75a8bf675.js':'/assets/'+names.dashboard};
  const html=patchImportMap(src.html,mapping);mkdirSync(out,{recursive:false});for(const k of Object.keys(patched))writeFileSync(resolve(out,names[k]),patched[k],{flag:'wx'});writeFileSync(resolve(out,'index.html'),html,{flag:'wx'});
  const manifest={before:Object.fromEntries(Object.entries(src).map(([k,v])=>[k,sha256(v)])),after:{...Object.fromEntries(Object.entries(patched).map(([k,v])=>[k,sha256(v)])),html:sha256(html)},names,mapping,unchangedBackendSha256:'236ea7579bae39126dcb3ab27dcad8a90348e13fc59a5cf2083985a40ba5e369'};writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}
