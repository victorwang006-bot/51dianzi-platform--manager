import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('/home/ubuntu/51-manager/package.json'),XLSX=require('xlsx');
const [api,file,out]=process.argv.slice(2);assert(api&&file&&out);
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),original=fs.readFileSync(file),native=fs.readFileSync(api),text=native.toString();
assert.equal(H(original),'869c66b352c06b9e2864793a9c005bc812c81f794b84763795b23640f583d001');
const start=text.indexOf('  var ROOT = "/opt/apps/dianzi51-shared/private/customer-inventory-history";'),end=text.indexOf('  function checkedRoot(root)',start);assert(start>=0&&end>start);
const pure=text.slice(start,end);assert(!/\b(?:readFile|writeFile|mkdir|lstat|openRoot|process\.env)\b/.test(pure));
const inspect=vm.runInNewContext(pure+'\ninspectCustomerUploadFile;',{Buffer,TextDecoder,TextEncoder,__backendNativeBinding_016:crypto.createHash,__backendNativeBinding_019:{...path,default:path},__backendNativeBinding_021:inflateRawSync,__backendNativeBinding_022:XLSX},{timeout:10000});
const run=b=>inspect({fileName:'工作簿1--宝.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:b.toString('base64')});
const actual=run(original);assert.equal(actual.sha256,H(original));assert.equal(actual.byteSize,original.length);assert.equal(actual.manifest.sheets[0].rows.length,319);
let endZip=-1;for(let p=original.length-22;p>=Math.max(0,original.length-65557);p--)if(original.readUInt32LE(p)===0x06054b50&&p+22+original.readUInt16LE(p+20)===original.length){endZip=p;break;}assert(endZip>=0);
function flagsCopy(flags){const b=Buffer.from(original);let p=b.readUInt32LE(endZip+16);for(let i=0;i<b.readUInt16LE(endZip+10);i++){assert.equal(b.readUInt32LE(p),0x02014b50);const local=b.readUInt32LE(p+42);b.writeUInt16LE(flags,p+8);b.writeUInt16LE(flags,local+6);p+=46+b.readUInt16LE(p+28)+b.readUInt16LE(p+30)+b.readUInt16LE(p+32);}return b;}
const accepted=[];for(const flags of [0,2,4,6,0x806]){const r=run(flagsCopy(flags));assert.equal(H(JSON.stringify(r.manifest)),H(JSON.stringify(actual.manifest)));accepted.push(flags);}
const rejected=[];for(const flags of [7,0x46,0x2006,0x16]){assert.throws(()=>run(flagsCopy(flags)),/拒绝加密、Zip64 或不支持的 ZIP 条目/);rejected.push(flags);}
assert.equal(H(fs.readFileSync(file)),H(original));
const result={status:'OFFLINE_ACTUAL_NATIVE_CANDIDATE_FORMAT_REGRESSION_PASSED',apiSha256:H(native),fileSha256:H(original),fileBytes:original.length,sourceRows:319,acceptedFlags:accepted,rejectedFlags:rejected,originalFileUnchanged:true,manifestSha256:H(JSON.stringify(actual.manifest)),entrypointExecuted:false,productionConnections:0,databaseWrites:0,privateProductionStorageWrites:0};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
