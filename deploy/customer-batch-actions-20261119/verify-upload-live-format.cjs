'use strict';
// Read-only acceptance: execute only the pure inspector extracted from the exact live API,
// using its actually resolved XLSX dependency. No API entrypoint, DB or private storage write.
const fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const [api,expectedApiSha,expectedFileSha,expectedManifestSha]=process.argv.slice(2);assert(api&&expectedApiSha&&expectedFileSha&&expectedManifestSha);
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=fs.readFileSync(0),native=fs.readFileSync(api);assert.equal(H(native),expectedApiSha);assert.equal(H(bytes),expectedFileSha);
const requireActual=createRequire(api),resolved=requireActual.resolve('xlsx'),XLSX=requireActual('xlsx');assert.equal(XLSX.version,'0.18.5');
const text=native.toString(),start=text.indexOf('  var ROOT = "/opt/apps/dianzi51-shared/private/customer-inventory-history";'),end=text.indexOf('  function checkedRoot(root)',start);assert(start>=0&&end>start);
const pure=text.slice(start,end);assert(!/\b(?:readFile|writeFile|mkdir|lstat|openRoot|process\.env)\b/.test(pure));
const inspect=vm.runInNewContext(pure+'\ninspectCustomerUploadFile;',{Buffer,TextDecoder,TextEncoder,__backendNativeBinding_016:crypto.createHash,__backendNativeBinding_019:{...path,default:path},__backendNativeBinding_021:zlib.inflateRawSync,__backendNativeBinding_022:XLSX},{timeout:10000});
const r=inspect({fileName:'工作簿1--宝.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:bytes.toString('base64')});
assert.equal(r.sha256,expectedFileSha);assert.equal(r.byteSize,47835);assert.equal(r.manifest.sheets[0].rows.length,319);assert.equal(H(JSON.stringify(r.manifest)),expectedManifestSha);
console.log(JSON.stringify({status:'ACTUAL_LIVE_NATIVE_ORIGINAL_FILE_FORMAT_PASSED',apiSha256:H(native),fileSha256:H(bytes),fileBytes:r.byteSize,sourceRows:r.manifest.sheets[0].rows.length,manifestSha256:H(JSON.stringify(r.manifest)),actualXlsxResolvedPath:resolved,xlsxVersion:XLSX.version,apiEntrypointExecuted:false,databaseWrites:0,productionOriginalFileStorageWrites:0,inventoryWrites:0,notFullLoggedInHTTPUpload:true}));
