import fs from 'node:fs';
import {FR,P,H,ts,assert,parse,declaration,freeze,write,save} from './core.mjs';
// Offline generated adapters only. Source-bound shims are subsequently frozen before compilation.
export const FORWARD=['getPaymentBatchByNo','getPaymentBatchForBuyer','getPaymentBatchForOrder','markPaymentBatchPaid','markPaymentBatchClosed','serializePaymentBatch','updatePaymentBatchFailure','updatePaymentProviderStatus','claimPaymentBatchQuery','claimNextExpiredPaymentBatch','restorePaymentBatchForRetry'];
const shimForward=names=>names.map(n=>'export const '+n+'=(...args)=>__live.'+n+'(...args);').join('\n');
export function bridgeContents(load){
  const sourceFile=FR+'/server/services/paymentRepository.ts',a=parse(load(sourceFile),sourceFile),names=['activatePaymentBatch','remainingSecondsExpression','withRemainingSeconds'];
  const declarations=names.map(name=>{const n=declaration(a,name);return{name,sha256:H(n.getText(a)),text:(ts.isVariableDeclaration(n)?n.parent.parent:n).getText(a)};});
  const repository="import {eq,sql} from 'drizzle-orm';\nconst getDb=(...args)=>__live.getDb(...args);\nconst paymentBatches=__live.paymentBatches;\n"+shimForward(FORWARD)+"\nexport const createAlipayCheckout=()=>{throw Error('Official checkout factory required');};\nexport const createWechatCheckout=()=>{throw Error('Official checkout factory required');};\n"+declarations.map(x=>x.text).join('\n')+'\n';
  const alipay=shimForward(['getAlipayGateway','safeAlipayError','isAlipaySuccessStatus'])+'\nexport const ALIPAY_PAYMENT_TIMEOUT_MINUTES=__live.ALIPAY_PAYMENT_TIMEOUT_MINUTES;\n';
  const wechat=shimForward(['getWechatGateway','safeWechatError'])+'\nexport const WECHAT_PAYMENT_TIMEOUT_MINUTES=__live.WECHAT_PAYMENT_TIMEOUT_MINUTES;\n';
  const entry='import {createOfficialCartPackage as createSourceOfficialCartPackage} from '+JSON.stringify(FR+'/newserver/services/officialCartRuntime')+';\nimport {startAlipayCheckout} from '+JSON.stringify(FR+'/server/services/paymentService')+';\nimport {startWechatCheckout} from '+JSON.stringify(FR+'/server/services/wechatPaymentService')+';\nexport function instantiate(native){return createSourceOfficialCartPackage({...native,startAlipayCheckout,startWechatCheckout});}\n';
  return {sourceFile,declarations,contents:{'paymentRepository.ts':repository,'alipayGateway.ts':alipay,'wechatGateway.ts':wechat,'entry.ts':entry}};
}
export function prepare(file){
  const lock=freeze(file,'api-bridge-preparation'),{c,load}=lock;
  assert(c.apiBridgePreparation?.approval&&c.apiBridgePreparation?.sourceEntry===FR+'/newserver/services/officialCartRuntime.ts','EXACT_PARENT_BRIDGE_PREPARATION_REQUIRED');
  const {sourceFile,declarations,contents}=bridgeContents(load),out=P+'/api-bridge-adapters';assert(!fs.existsSync(out),'FRESH_PREPARATION_OUTPUT_ONLY');lock.verify();
  for(const[n,v]of Object.entries(contents)){parse(v,n);write(out+'/'+n,v);}
  const manifest={status:'prepared-offline-requires-new-parent-freeze-not-built',configSha256:lock.configSha256,sourceFile,sourceFileSha256:c.sourceFiles[sourceFile],declarations:declarations.map(({text,...x})=>x),sourceFiles:Object.fromEntries(Object.entries(contents).map(([n,v])=>[out+'/'+n,H(v)])),sourceOverrides:{[sourceFile]:out+'/paymentRepository.ts',[FR+'/server/services/alipayGateway.ts']:out+'/alipayGateway.ts',[FR+'/server/services/wechatGateway.ts']:out+'/wechatGateway.ts'},entryFile:out+'/entry.ts',exports:['instantiate'],instantiateExport:'instantiate',factoryExport:'createOfficialCartPackage',legacyStockHooksRequired:true,old2fdRecompiled:false,ordinaryProviderFallbackHardReject:true};
  save(out+'/manifest.json',manifest);return manifest;
}
if(process.argv[1]===new URL(import.meta.url).pathname){assert(process.argv[2],'EXPLICIT_PARENT_FROZEN_CONFIG_REQUIRED');console.log(JSON.stringify(prepare(process.argv[2]),null,2));}
