#!/usr/bin/env python3
"""Readonly supplement, NOT capture/approval. stdin one credentialless JSON payload.
No writes; source and static base64 are PRIVATE. All production execution is by parent.
"""
import sys
sys.dont_write_bytecode = True
import base64, contextlib, fcntl, hashlib, json, os, re, signal, stat, subprocess, time
from pathlib import Path

NODE = '/usr/bin/node-22'
NODE_SHA = '2684ed77513bdbfc63c92848877a4c43a8e50dd7df0f9896c1e0daf0d204c939'
PM2 = '/usr/local/lib/node_modules/pm2'
SHADOW = '/root/enterprise-shadow-20261017-r2'
LOCKS = ('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
ALL_IDS = {0,190,191,192,193,194,200,201,202,203,204,205}
PUBLIC = '/opt/releases/20261031-homepage-banner-v39/front/dist/public'
RETENTION = '/opt/ops/dianzi51-recommendation'
FIELDS = ('dev','ino','statmode','uid','gid','size','mtimeNs','ctimeNs','nlink')
STFIELDS = ('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns','st_nlink')
IDENTITY = ('dev','ino','statmode','uid','gid','nlink')
MAX_PAYLOAD = 8*1024*1024
MAX_PROC = 4096
MAX_ENTRIES = 100000
MAX_FILE = 64*1024*1024
MAX_CODE = 256*1024*1024
# Loader binaries are not script closure; real pinned libnode is 81,666,912 bytes.
MAX_LOADER_FILE = 128*1024*1024
MAX_LOADER = 256*1024*1024
JS = "'use strict';\n// Adapted from probe-live-runtime.py JS and adapters.py RPC_JS; no PM2 API/God import.\nconst fs = require('node:fs'), Module = require('node:module'), crypto = require('node:crypto'), path = require('node:path');\nconst read0 = fs.readFileSync.bind(fs), q = JSON.parse(read0(0, 'utf8'));\nconst H = b => crypto.createHash('sha256').update(b).digest('hex');\nconst fields = ['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs','nlink'];\nconst meta = s => fields.map(k => String(s[k])).join(':');\nconst seen = new Set(), packages = new Set(), reads = new Set(), discoveredPackagePins = {}, packageAliasReads = [];\nfunction clean(p) {\n  if (typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p) throw Error('UNSAFE_PATH');\n  for (let x = p;; x = path.dirname(x)) { if (fs.lstatSync(x).isSymbolicLink()) throw Error('ALIAS_NOT_PREBOUND'); if (x === '/') break; }\n  return p;\n}\nfunction regular(p) {\n  if (q.mode === 'resolve' && path.basename(p) === 'package.json') {\n    const logical=p, physical=fs.realpathSync(p);\n    if (!['/opt/releases/','/root/.pm2/modules/','/usr/local/lib/node_modules/pm2/','/usr/share/nodejs/'].some(root=>physical.startsWith(root))) throw Error('PACKAGE_BOUNDARY');\n    if (logical!==physical) packageAliasReads.push({logical,physical});\n    p=physical;\n  }\n  clean(p);\n  const flags = fs.constants.O_RDONLY | fs.constants.O_CLOEXEC | fs.constants.O_NOFOLLOW | fs.constants.O_NOATIME;\n  if (!fs.constants.O_NOATIME || !fs.constants.O_NOFOLLOW) throw Error('NOATIME_UNAVAILABLE');\n  const fd = fs.openSync(p, flags);\n  try {\n    const a = fs.fstatSync(fd, {bigint:true});\n    if (!a.isFile() || a.size > 268435456n) throw Error('REGULAR_LIMIT');\n    const b = read0(fd);\n    if (meta(a) !== meta(fs.fstatSync(fd,{bigint:true})) || meta(a) !== meta(fs.lstatSync(p,{bigint:true}))) throw Error('READ_DRIFT');\n    const hash=H(b), discovering=q.mode==='resolve' && path.basename(p)==='package.json';\n    if (q.pins[p] ? hash!==q.pins[p] : !discovering) throw Error('SOURCE_PIN');\n    if (discovering) {if(discoveredPackagePins[p] && discoveredPackagePins[p]!==hash)throw Error('PACKAGE_DRIFT');discoveredPackagePins[p]=hash;}\n    reads.add(p); return b;\n  } finally { fs.closeSync(fd); }\n}\n// Public filesystem reads by the executed transport all use the same pinned fd read.\nfs.readFileSync = function(p, options) {\n  if (typeof p === 'number') { if (p !== 0) throw Error('UNBOUND_FD_READ'); return read0(p, options); }\n  if (p === '/proc/self/maps') return read0(p, options);\n  const b = regular(p), enc = typeof options === 'string' ? options : options && options.encoding;\n  return enc ? b.toString(enc) : b;\n};\n// Actual CJS package-reader hook. Native export/import resolution can bypass it;\n// such resolution remains a locator, NEVER a complete transitive proof.\nif (!Object.getOwnPropertyDescriptor(Module, '_readPackage')?.set) throw Error('PACKAGE_READER_HOOK_UNAVAILABLE');\nModule._readPackage = function(dir) {\n  const p = path.join(dir,'package.json');\n  if (!fs.existsSync(p)) return {exists:false,pjsonPath:p};\n  const d = JSON.parse(regular(p).toString('utf8')); packages.add(p);\n  return {exists:true,pjsonPath:p,name:d.name,main:d.main,type:d.type,imports:d.imports,exports:d.exports};\n};\nconst originalLoad = Module._load;\nModule._load = function(id, parent, isMain) {\n  const p = Module._resolveFilename(id,parent,isMain);\n  if (!Module.isBuiltin(p)) {\n    if (q.mode !== 'rpc' || !p.startsWith('/usr/local/lib/node_modules/pm2/') || /\\/(?:God(?:\\/|\\.js)|Daemon\\.js)$/.test(p)) throw Error('APPLICATION_EXECUTION_REFUSED');\n    regular(p); seen.add(p);\n  }\n  return originalLoad.apply(this,arguments);\n};\nModule._extensions['.js'] = (m,p) => m._compile(regular(p).toString('utf8'),p);\nModule._extensions['.json'] = (m,p) => { m.exports = JSON.parse(regular(p).toString('utf8').replace(/^\\uFEFF/,'')); };\nModule._extensions['.node'] = () => { throw Error('ADDON_EXECUTION_REFUSED'); };\nconst mapped = [...new Set(read0('/proc/self/maps','utf8').trim().split('\\n').map(l => l.split(/\\s+/).slice(5).join(' ')).filter(p => p.startsWith('/')))].sort();\nif (JSON.stringify(mapped) !== JSON.stringify([...q.nodeLoaderClosure].sort())) throw Error('LOADER_EXACT_SET');\nfor (const p of mapped) regular(p);\nif (q.mode === 'resolve') {\n  const locators = [];\n  for (const r of q.requests) {\n    try {\n      regular(r.from);\n      const requireFrom = Module.createRequire(r.from);\n      const resolved = requireFrom.resolve(r.specifier);\n      locators.push({...r,resolved,builtin:Module.isBuiltin(resolved),resolutionKind:'actual-createRequire.resolve-CJS-locator-not-ESM-proof'});\n    } catch (_) { locators.push({...r,resolved:null,builtin:false,unresolved:true}); }\n  }\n  process.stdout.write(JSON.stringify({locators,closure:[],packageReads:[...packages].sort(),discoveredPackagePins,packageAliasReads,readFiles:[...reads].sort(),nodeLoaderClosure:mapped}));\n} else if (q.mode === 'rpc') {\n  let req, done = false;\n  function fail() { if(done)return;done=true;process.stderr.write('EXISTING_RPC_FAILED_NO_FALLBACK');process.exit(2); }\n  try {\n    if (q.socket !== '/root/.pm2/rpc.sock' || !fs.lstatSync(q.socket).isSocket()) throw Error('SOCKET');\n    const axon = require('/usr/local/lib/node_modules/pm2/modules/pm2-axon/index.js');\n    const rpc = require('/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc/index.js');\n    req = axon.socket('req'); req.on('error', fail); req.connect(q.socket);\n    new rpc.Client(req).call('getMonitorData', {}, (err, rows) => {\n      if (err || !Array.isArray(rows)) return fail();\n      try {\n        for (const p of reads) regular(p);\n        done = true;\n        process.stdout.write(JSON.stringify({rows,closure:[...seen].sort(),packageReads:[...packages].sort(),readFiles:[...reads].sort(),nodeLoaderClosure:mapped}), () => {req.close();process.exit(0);});\n      } catch (_) {fail();}\n    }); setTimeout(fail,12000);\n  } catch (_) {fail();}\n} else {throw Error('MODE');}\n"
STATIC_ALLOW = {'/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/AgencyCertification-certification-6c504279f1916ad5-copy-cleanup-5f5c26e4eadda930.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/AgencyCertification-certification-6c504279f1916ad5-copy-cleanup-5f5c26e4eadda930.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/CompanySwitcher-nav-compact-b902faf82fda4c14.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/CompanySwitcher-nav-compact-b902faf82fda4c14.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForgotPasswordFlow-Bcc_TRum.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForgotPasswordFlow-Bcc_TRum.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForumUnreadBadge-DZQ_ajKF.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForumUnreadBadge-DZQ_ajKF.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/InquiryEnterpriseChooserDialog-f_IbLRLR.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/InquiryEnterpriseChooserDialog-f_IbLRLR.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallLoginDialog-B9eOYLSy.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallLoginDialog-B9eOYLSy.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallNav-D1XEA1HK.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/nav-official-cart-1f53d1e32d6b5bc0f0247aa46d0b5039819e811a0e6227d6101577d337735a94.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallNavSharedControls-Dana3P5f.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallNavSharedControls-Dana3P5f.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/PaymentMethodIcon-D3E3ZhcR.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/PaymentMethodIcon-D3E3ZhcR.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/SupplierProfileLink-supplier-name-65679bcd61e4-certification-4b28137458bc6324.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/SupplierProfileLink-supplier-name-65679bcd61e4-certification-4b28137458bc6324.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-left-C72QXCm_.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-left-C72QXCm_.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-right-CvVqph_X.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-right-CvVqph_X.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/beijingTime-DBueo7Bu.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/beijingTime-DBueo7Bu.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/button-BESZT5BD.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/button-BESZT5BD.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/check-CMoptOOy.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/check-CMoptOOy.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/chevron-right-BVswar93.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/chevron-right-BVswar93.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/circle-check-D0KwB7pU.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/circle-check-D0KwB7pU.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/clientMessageId-Dp81u44N.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/clientMessageId-Dp81u44N.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/companyEstablishedAt-CTPBnfmb.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/companyEstablishedAt-CTPBnfmb.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/contentModeration-D1y4uz5X.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/contentModeration-D1y4uz5X.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/copy-DZfsLvJx.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/copy-DZfsLvJx.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/dialog-D3PLn_aD.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/dialog-D3PLn_aD.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-BFfyu1m-.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-BFfyu1m-.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-DnsGKsJR.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-DnsGKsJR.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/input-DUE8KHi9.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/input-DUE8KHi9.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryLeadTime-DMSGt-tn.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryLeadTime-DMSGt-tn.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryPriceDisplay-rgSHamc3.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryPriceDisplay-rgSHamc3.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryQuantityDisplay-BqqFZ35u.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryQuantityDisplay-BqqFZ35u.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/label-C6LfxTIW.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/label-C6LfxTIW.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/loader-circle-DY4ypc03.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/loader-circle-DY4ypc03.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/logos-r9QRYmTp.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/logos-r9QRYmTp.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/main-D3xcYX4O.js': '/assets/main-nav-without-self-1e7f3c8fd3e382b0.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/map-pin-DEkXahg-.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/map-pin-DEkXahg-.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/nav-official-cart-1f53d1e32d6b5bc0f0247aa46d0b5039819e811a0e6227d6101577d337735a94.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/nav-official-cart-1f53d1e32d6b5bc0f0247aa46d0b5039819e811a0e6227d6101577d337735a94.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/openInNewTab-N0hj7ScK.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/openInNewTab-N0hj7ScK.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/package-search-B7bcCxv5.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/package-search-B7bcCxv5.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/partImages-DjqhGfUN.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/partImages-DjqhGfUN.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchHistory-f1qBhbj2.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchHistory-f1qBhbj2.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchInput-efgGFg9b.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchInput-efgGFg9b.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierDisplayName-CAtMUZO1.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierDisplayName-CAtMUZO1.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierPhotoWatermark-_Ts00DZi.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierPhotoWatermark-_Ts00DZi.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/tabs-Bi1lISVz.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/tabs-Bi1lISVz.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useComposition-BcMWJMD3.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useComposition-BcMWJMD3.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useEnterpriseInquiryLauncher-o7fpsHZf.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useEnterpriseInquiryLauncher-o7fpsHZf.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useGuestQuery-fast-f50acd02a27d3b9f296b309943791c28197bdeefd756be7c8d972945a16fff2f.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useGuestQuery-fast-f50acd02a27d3b9f296b309943791c28197bdeefd756be7c8d972945a16fff2f.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useLoginScope-zDu11UcI.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useLoginScope-zDu11UcI.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useMaterialExposure-Bvy4wQUG.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useMaterialExposure-Bvy4wQUG.js', '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/user-round-Cao51Zew.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/user-round-Cao51Zew.js', '/assets/AgencyCertification-certification-6c504279f1916ad5.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/AgencyCertification-certification-6c504279f1916ad5-copy-cleanup-5f5c26e4eadda930.js', '/assets/ChatActionButton-B0cj8A-6.js': '/assets/ChatActionButton-daily-cleanup-eb5fc1113426e3a0.js', '/assets/ChatActionButton-daily-cleanup-eb5fc1113426e3a0.js': '/assets/ChatActionButton-daily-cleanup-eb5fc1113426e3a0.js', '/assets/CompanySwitcher-O8ucxiwL.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/CompanySwitcher-nav-compact-b902faf82fda4c14.js', '/assets/ForgotPasswordFlow-Bcc_TRum.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForgotPasswordFlow-Bcc_TRum.js', '/assets/ForumUnreadBadge-DZQ_ajKF.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/ForumUnreadBadge-DZQ_ajKF.js', '/assets/InquiryEnterpriseChooserDialog-f_IbLRLR.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/InquiryEnterpriseChooserDialog-f_IbLRLR.js', '/assets/MallLoginDialog-B9eOYLSy.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallLoginDialog-B9eOYLSy.js', '/assets/MallNavSharedControls-Dana3P5f.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/MallNavSharedControls-Dana3P5f.js', '/assets/OfficialMall-public-native-v10-0950ab04107ec94e.js': '/assets/OfficialMall-public-native-v10-0950ab04107ec94e.js', '/assets/SelfOperatedMall-ui-v7-ef99355486670c45.js': '/assets/SelfOperatedMall-ui-v7-ef99355486670c45.js', '/assets/SupplierProfileLink-UBWFIMhi.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/SupplierProfileLink-supplier-name-65679bcd61e4-certification-4b28137458bc6324.js', '/assets/arrow-left-C72QXCm_.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-left-C72QXCm_.js', '/assets/arrow-right-CvVqph_X.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/arrow-right-CvVqph_X.js', '/assets/beijingTime-DBueo7Bu.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/beijingTime-DBueo7Bu.js', '/assets/button-BESZT5BD.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/button-BESZT5BD.js', '/assets/check-CMoptOOy.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/check-CMoptOOy.js', '/assets/chevron-right-BVswar93.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/chevron-right-BVswar93.js', '/assets/circle-check-D0KwB7pU.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/circle-check-D0KwB7pU.js', '/assets/clientMessageId-Dp81u44N.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/clientMessageId-Dp81u44N.js', '/assets/companyEstablishedAt-CTPBnfmb.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/companyEstablishedAt-CTPBnfmb.js', '/assets/contentModeration-D1y4uz5X.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/contentModeration-D1y4uz5X.js', '/assets/copy-DZfsLvJx.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/copy-DZfsLvJx.js', '/assets/dialog-D3PLn_aD.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/dialog-D3PLn_aD.js', '/assets/index-BFfyu1m-.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-BFfyu1m-.js', '/assets/index-DnsGKsJR.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/index-DnsGKsJR.js', '/assets/input-DUE8KHi9.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/input-DUE8KHi9.js', '/assets/inventoryLeadTime-DMSGt-tn.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryLeadTime-DMSGt-tn.js', '/assets/inventoryPriceDisplay-rgSHamc3.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryPriceDisplay-rgSHamc3.js', '/assets/inventoryQuantityDisplay-BqqFZ35u.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/inventoryQuantityDisplay-BqqFZ35u.js', '/assets/label-C6LfxTIW.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/label-C6LfxTIW.js', '/assets/loader-circle-DY4ypc03.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/loader-circle-DY4ypc03.js', '/assets/logos-r9QRYmTp.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/logos-r9QRYmTp.js', '/assets/main-D3xcYX4O.js': '/assets/main-nav-without-self-1e7f3c8fd3e382b0.js', '/assets/main-nav-without-self-1e7f3c8fd3e382b0.js': '/assets/main-nav-without-self-1e7f3c8fd3e382b0.js', '/assets/map-pin-DEkXahg-.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/map-pin-DEkXahg-.js', '/assets/official-cart-ui-0caa44f169956249d49c314660e96dccd14e5e8e8fa098c37a5c496c94393b4d.js': '/assets/official-cart-ui-0caa44f169956249d49c314660e96dccd14e5e8e8fa098c37a5c496c94393b4d.js', '/assets/openInNewTab-N0hj7ScK.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/openInNewTab-N0hj7ScK.js', '/assets/package-search-B7bcCxv5.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/package-search-B7bcCxv5.js', '/assets/partImages-DjqhGfUN.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/partImages-DjqhGfUN.js', '/assets/searchHistory-f1qBhbj2.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchHistory-f1qBhbj2.js', '/assets/searchInput-efgGFg9b.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/searchInput-efgGFg9b.js', '/assets/supplierDisplayName-CAtMUZO1.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierDisplayName-CAtMUZO1.js', '/assets/supplierPhotoWatermark-_Ts00DZi.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/supplierPhotoWatermark-_Ts00DZi.js', '/assets/tabs-Bi1lISVz.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/tabs-Bi1lISVz.js', '/assets/useComposition-BcMWJMD3.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useComposition-BcMWJMD3.js', '/assets/useEnterpriseInquiryLauncher-o7fpsHZf.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useEnterpriseInquiryLauncher-o7fpsHZf.js', '/assets/useLoginScope-zDu11UcI.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useLoginScope-zDu11UcI.js', '/assets/useMaterialExposure-Bvy4wQUG.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/useMaterialExposure-Bvy4wQUG.js', '/assets/user-round-Cao51Zew.js': '/assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/user-round-Cao51Zew.js'}

class Reject(RuntimeError): pass
def need(x, code):
    if not x: raise Reject(code)
def H(b): return hashlib.sha256(b).hexdigest()
def encode(x): return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def decode(b):
    def pairs(xs):
        d={}
        for k,v in xs:
            need(k not in d,'DUPLICATE_JSON_KEY'); d[k]=v
        return d
    try: return json.loads(b,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError,UnicodeError): raise Reject('INVALID_JSON') from None
def exactpath(x):
    need(isinstance(x,str) and x.startswith('/') and x==str(Path(x)) and not any(c in x for c in ('\0','\n','\r')) and all(c not in ('.','..') for c in x.split('/')),'SAFE_ABSOLUTE_PATH'); return x
def sha(x): need(isinstance(x,str) and re.fullmatch('[0-9a-f]{64}',x),'FULL_SHA_REQUIRED'); return x
def within(p,root): return p==root or p.startswith(root+'/')
def noalias(p):
    exactpath(str(p))
    for x in reversed((Path(p),*Path(p).parents)):
        need(not stat.S_ISLNK(os.lstat(x).st_mode),'ANCESTOR_SYMLINK_REFUSED')
    return Path(p)
def metadata(p): return dict(zip(FIELDS,(getattr(os.lstat(p),k) for k in STFIELDS)))
def kind(mode):
    return 'dir' if stat.S_ISDIR(mode) else 'file' if stat.S_ISREG(mode) else 'link' if stat.S_ISLNK(mode) else 'socket' if stat.S_ISSOCK(mode) else 'special'
def identity(p):
    a=metadata(p); k=kind(a['statmode']); link=os.readlink(p) if k=='link' else None
    need(metadata(p)==a,'IDENTITY_READ_DRIFT')
    return dict({n:a[n] for n in IDENTITY},kind=k,link=link)
def namespace(p):
    p=noalias(p); a=identity(p); need(a['kind']=='dir','NAMESPACE_DIRECTORY_REQUIRED')
    names=sorted(os.listdir(p)); need(len(names)<=MAX_ENTRIES,'NAMESPACE_LIMIT')
    out={str(p/n):identity(p/n) for n in names}
    need(sorted(os.listdir(p))==names and identity(p)==a,'NAMESPACE_READ_DRIFT')
    return {'identity':a,'children':out}
def secret(p):
    n=Path(p).name.lower()
    return n.startswith('.env') or n.endswith(('.pem','.key','.p12','.pfx','.crt')) or n in ('credentials','id_rsa','id_ed25519')
def phase(name, **stats): print(json.dumps(dict(phase=name,**stats),sort_keys=True),file=sys.stderr,flush=True)
def collector_source_hash():
    if sys.argv[0]=='-c':
        parts=proc_read(Path('/proc/self'),'cmdline').split(b'\0')
        loc=[i for i,x in enumerate(parts) if x==b'-c']
        need(len(loc)==1 and loc[0]+1<len(parts),'ACTUAL_MEMORY_COLLECTOR_SOURCE_REQUIRED')
        return H(parts[loc[0]+1])
    fd=os.open(__file__,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|os.O_NOATIME)
    try:
        d=hashlib.sha256()
        while True:
            b=os.read(fd,1024*1024)
            if not b: return d.hexdigest()
            d.update(b)
    finally: os.close(fd)

class Reader:
    def __init__(self):
        self.pins={}; self.aliases={}; self.codeBytes=0; self.loaderBytes=0; self.codeElapsed=0; self._codeStarted=None
    @property
    def codeStarted(self): return self._codeStarted
    @codeStarted.setter
    def codeStarted(self,value):
        if self._codeStarted is not None: self.codeElapsed+=time.monotonic()-self._codeStarted
        self._codeStarted=value
    def start_code(self): self.codeStarted=time.monotonic()
    def tick(self):
        elapsed=self.codeElapsed+(time.monotonic()-self.codeStarted if self.codeStarted is not None else 0)
        need(elapsed<=40,'CODE_TIME_LIMIT_40_SECONDS')
    def regular(self,p,*,loader=False,export=False,expected=None,refresh=False):
        p=exactpath(str(p)); noalias(p); self.tick()
        fd=os.open(p,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            a=dict(zip(FIELDS,(getattr(os.fstat(fd),k) for k in STFIELDS)))
            need(stat.S_ISREG(a['statmode']),'REGULAR_REQUIRED')
            need(a==metadata(p),'OPEN_INODE_MISMATCH')
            need(a['size']<=(MAX_LOADER_FILE if loader else MAX_FILE),'FILE_BYTE_LIMIT')
            if p not in self.pins:
                need(len(self.pins)<MAX_ENTRIES,'FILE_COUNT_LIMIT')
                if loader: self.loaderBytes+=a['size']; need(self.loaderBytes<=MAX_LOADER,'LOADER_BYTE_LIMIT')
                else: self.codeBytes+=a['size']; need(self.codeBytes<=MAX_CODE,'CODE_BYTE_LIMIT')
            d=hashlib.sha256(); chunks=[]; total=0
            while True:
                self.tick(); b=os.read(fd,1024*1024)
                if not b: break
                total+=len(b); need(total<=a['size'],'READ_SIZE_DRIFT'); d.update(b)
                if export: chunks.append(b)
            z=dict(zip(FIELDS,(getattr(os.fstat(fd),k) for k in STFIELDS)))
            need(a==z==metadata(p) and total==a['size'],'REGULAR_READ_DRIFT')
            r=dict(a,kind='file',sha256=d.hexdigest())
            if expected is not None: need(r['sha256']==sha(expected),'FULL_SOURCE_PIN_MISMATCH')
            if p in self.pins: need(self.pins[p]==r,'SOURCE_REPEATED_READ_DRIFT')
            self.pins[p]=r
            return (b''.join(chunks) if export else None),r
        finally: os.close(fd)
    def resolve_alias(self,p,roots):
        p=exactpath(str(p)); seen=set(); aliases=[]
        for _ in range(40):
            need(p not in seen,'ALIAS_CYCLE'); seen.add(p); changed=False
            for part in reversed((Path(p),*Path(p).parents)):
                a=metadata(part)
                if stat.S_ISLNK(a['statmode']):
                    link=os.readlink(part); need(metadata(part)==a,'ALIAS_DRIFT')
                    target=os.path.normpath(os.path.join(str(part.parent),link))
                    rest=Path(p).relative_to(part); p=str(Path(target)/rest)
                    need(any(within(p,r) for r in roots),'ALIAS_TARGET_OUTSIDE_KNOWN_ROOT')
                    row={'metadata':a,'link':link,'target':target}
                    if str(part) in self.aliases: need(self.aliases[str(part)]==row,'ALIAS_CHANGED')
                    self.aliases[str(part)]=row; aliases.append(str(part)); changed=True; break
            if not changed: return p,aliases
        raise Reject('ALIAS_DEPTH_LIMIT')
    def tree(self,root):
        root=exactpath(str(root)); need(not within(root,SHADOW),'SHADOW_BYTES_REFUSED'); noalias(root)
        out={}; stack=[root]
        while stack:
            self.tick(); p=stack.pop(); need(len(out)<MAX_ENTRIES,'TREE_ENTRY_LIMIT')
            a=metadata(p); k=kind(a['statmode'])
            if k=='dir':
                names=sorted(os.listdir(p)); out[p]=dict(a,kind=k,children=names)
                stack.extend(str(Path(p)/n) for n in reversed(names))
                need(metadata(p)==a and sorted(os.listdir(p))==names,'TREE_NAMESPACE_DRIFT')
            elif k=='file': _,out[p]=self.regular(p)
            elif k=='link': out[p]=dict(a,kind=k,link=os.readlink(p)); need(metadata(p)==a,'TREE_LINK_DRIFT')
            else: raise Reject('CODE_TREE_SPECIAL_OBJECT')
        return out
    def verify(self):
        for p,r in list(self.pins.items()): self.regular(p,loader=r['size']>MAX_FILE,expected=r['sha256'],refresh=True)
        for p,r in self.aliases.items(): need(metadata(p)==r['metadata'] and os.readlink(p)==r['link'],'ALIAS_FINAL_DRIFT')

class Locks:
    def __init__(self,paths=LOCKS): self.paths=paths; self.held=[]
    def __enter__(self):
        try:
            for p in self.paths:
                leaf=Path(p); need(not leaf.is_symlink(),'LOCK_FILE_SYMLINK')
                real=noalias(leaf.resolve(strict=True))
                fd=os.open(real,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
                try:
                    a=os.fstat(fd); need(stat.S_ISREG(a.st_mode),'LOCK_NOT_REGULAR')
                    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BaseException: os.close(fd); raise
                self.held.append((p,real,fd,(a.st_dev,a.st_ino)))
            self.check(); return self
        except BaseException: self.__exit__(None,None,None); raise
    def check(self):
        need(len(self.held)==2,'TWO_LOCKS_REQUIRED')
        for p,real,fd,old in self.held:
            a=os.lstat(p); b=os.fstat(fd)
            need(not stat.S_ISLNK(a.st_mode) and Path(p).resolve(strict=True)==real and
                 (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)==old,'LOCK_INODE_CHANGED')
    def __exit__(self,*args):
        for _,_,fd,_ in reversed(self.held):
            try: fcntl.flock(fd,fcntl.LOCK_UN)
            finally: os.close(fd)
        self.held=[]

def proc_read(root,n):
    fd=os.open(root/n,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
    try:
        b=bytearray()
        while True:
            c=os.read(fd,65536)
            if not c: return bytes(b)
            b.extend(c); need(len(b)<=8*1024*1024,'PROC_FIELD_LIMIT')
    finally: os.close(fd)
def home_fields(raw):
    out={}
    for name in ('HOME','PM2_HOME'):
        values=[x.split(b'=',1)[1] for x in raw.split(b'\0') if x.startswith(name.encode()+b'=')]
        need(len(values)<=1,'DUPLICATE_HOME_FIELD')
        if values:
            v=os.fsdecode(values[0]); exactpath(v); out[name]={'present':True,'sha256':H(values[0]),'_memoryPath':v}
        else: out[name]={'present':False,'sha256':None,'_memoryPath':None}
    return out

def proc_record(pid,reader,pin_execution=True):
    root=Path('/proc')/str(pid); s=proc_read(root,'stat').split(b') ',1)[1].split()
    env=proc_read(root,'environ'); cmd=proc_read(root,'cmdline'); cwd=os.readlink(root/'cwd'); exe=os.readlink(root/'exe')
    need(not exe.endswith(' (deleted)'),'DELETED_PROCESS_EXE'); exactpath(cwd); exactpath(exe)
    fds={}
    for f in sorted((root/'fd').iterdir(),key=lambda f:int(f.name)):
        target=os.readlink(f)
        if target.startswith('/'):
            need(not target.endswith(' (deleted)'),'DELETED_OPEN_PATH_FD'); exactpath(target)
            st=f.stat(); flags=proc_read(root,'fdinfo/'+f.name).split(b'flags:\t',1)[1].splitlines()[0].decode('ascii')
            fds[f.name]=dict(target=target,dev=st.st_dev,ino=st.st_ino,statmode=st.st_mode,uid=st.st_uid,gid=st.st_gid,nlink=st.st_nlink,flags=flags)
    mapped={}
    if pin_execution:
        for line in proc_read(root,'maps').splitlines():
            parts=line.split(None,5)
            if len(parts)==6 and parts[5].startswith(b'/'):
                p=os.fsdecode(parts[5]); need(not p.endswith(' (deleted)'),'DELETED_EXECUTION_MAPPING')
                physical,_=reader.resolve_alias(p,('/usr','/lib','/lib64','/opt/releases',PM2))
                _,r=reader.regular(physical,loader=True); mapped[physical]=r['sha256']
        physical,_=reader.resolve_alias(exe,('/usr','/lib','/lib64','/opt/releases',PM2)); _,ex=reader.regular(physical,loader=True)
    else: ex=None
    scripts=[os.fsdecode(x) for x in cmd.split(b'\0') if x.startswith(b'/') and x.endswith((b'.js',b'.mjs',b'.cjs',b'.py',b'.sh'))]
    argv_paths=[os.fsdecode(x) for x in cmd.split(b'\0') if re.fullmatch(rb'/[A-Za-z0-9_./@+ -]+',x) and len(x)<=4096]
    for p in scripts+argv_paths: exactpath(p)
    fields=home_fields(env)
    need(proc_read(root,'stat').split(b') ',1)[1].split()[19]==s[19] and proc_read(root,'environ')==env and proc_read(root,'cmdline')==cmd and os.readlink(root/'exe')==exe and os.readlink(root/'cwd')==cwd,'PROCESS_READ_DRIFT')
    perms={}
    for line in proc_read(root,'status').splitlines():
        k,_,v=line.partition(b':')
        if k in (b'Uid',b'Gid',b'Groups',b'Umask'): perms[k.decode()]=v.decode().split()
    need(set(perms)=={'Uid','Gid','Groups','Umask'},'PROCESS_PERMISSIONS_FIELDS_REQUIRED')
    return {'pid':pid,'parentPid':int(s[1]),'startTicks':s[19].decode(),'exe':exe,'exeSha256':ex['sha256'] if ex else None,'cwd':cwd,'cmdlineSha256':H(cmd),'rawProcEnvironSha256':H(env),'environmentIdentityHashes':{k:v['sha256'] for k,v in fields.items()},'environmentFieldPresence':{k:v['present'] for k,v in fields.items()},'scriptPaths':scripts,'absoluteArgvPaths':argv_paths,'isPM2GodDaemon':cmd.startswith(b'PM2 ') and b'God Daemon' in cmd,'permissions':perms,'openPathFDs':fds,'mappedExecutionFiles':mapped},fields

def enumerate_proc(reader):
    started=time.monotonic(); pids=sorted(int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit())
    need(len(pids)<=MAX_PROC,'PROC_ENUMERATION_LIMIT'); nodes={}; nonnodes={}; homes={}; disappeared=[]
    for pid in pids:
        need(time.monotonic()-started<=150,'PROC_ENUMERATION_TIMEOUT')
        if pid==os.getpid(): continue
        root=Path('/proc')/str(pid)
        try:
            exe=os.readlink(root/'exe'); cmd=proc_read(root,'cmdline')
            isn=Path(exe.removesuffix(' (deleted)')).name.startswith('node') or cmd.startswith(b'PM2 ')
            rec,fields=proc_record(pid,reader,pin_execution=isn)
        except (FileNotFoundError,ProcessLookupError): disappeared.append(pid); continue
        (nodes if isn else nonnodes)[str(pid)]=rec
        if isn: homes[str(pid)]=fields
    # Kernel threads without exe are explicitly transient/uninspectable observations;
    # permissions or any other field failure aborts, never marks an unseen process safe.
    return nodes,nonnodes,homes,{'enumerated':len(pids),'disappearedOrKernelNoExe':disappeared,'processLimit':MAX_PROC,'timeoutSeconds':150,'completeStableSnapshotClaimed':False}

def node_child(q,mode,requests=()):
    for key in ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH'):
        need(not os.environ.get(key),'INHERITED_ROOT_LOADER_OPTIONS_PRESENT')
    payload={'pins':q['pm2Pins']|q['runtimePins'],'nodeLoaderClosure':q['nodeLoaderClosure'],'mode':mode,'socket':'/root/.pm2/rpc.sock','requests':list(requests)}
    rr=subprocess.run([NODE,'--no-addons','-e',JS],input=encode(payload),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=16,env=dict(os.environ))
    need(rr.returncode==0,'NODE_CHILD_FAILED_NO_FALLBACK'); need(len(rr.stdout)<=32*1024*1024,'NODE_RESULT_LIMIT')
    return decode(rr.stdout)

def bind_daemons(q,nodes,homes,reader,main_pid):
    out={}; used=set()
    for role,template in q['daemonRoles'].items():
        sel=template['selector']; matches=[]
        for rec in nodes.values():
            if not rec['isPM2GodDaemon']: continue
            if any(rec[k]!=sel[k] for k in ('exe','cwd','cmdlineSha256','rawProcEnvironSha256')): continue
            if not all(rec['openPathFDs'].get(fd,{}).get('target')==p for fd,p in sel['requiredFDPaths'].items()): continue
            matches.append(rec)
        need(len(matches)==1,'DAEMON_EXACT_SELECTOR_NOT_UNIQUE'); rec=matches[0]
        need(rec['pid'] not in used and (rec['pid']==main_pid)==sel['isMain'],'DAEMON_MAIN_PID_FILE_BINDING'); used.add(rec['pid'])
        fields=homes[str(rec['pid'])]; hf=fields['HOME']; pf=fields['PM2_HOME']; source={}
        for p in (PM2+'/constants.js',PM2+'/paths.js',PM2+'/lib/Daemon.js',PM2+'/lib/God.js'):
            _,r=reader.regular(p,expected=q['pm2Pins'][p]); source[p]=r['sha256']
        if pf['present']:
            home=pf['_memoryPath']; field='PM2_HOME'; basis={'fieldAbsent':False,'field':'PM2_HOME','valueSHA':pf['sha256'],'joinSHA':None}
        else:
            need(hf['present'],'ABSENT_PM2_HOME_REQUIRES_SAFE_HOME'); home=str(Path(hf['_memoryPath'])/'.pm2'); field='HOME_DEFAULT_PM2'
            basis={'fieldAbsent':True,'field':'PM2_HOME','HOMEpresent':True,'HOMEsha256':hf['sha256'],'joinSHA':H(home.encode()),'sourcePath':PM2+'/paths.js','sourceSHA':source[PM2+'/paths.js'],'constantsPath':PM2+'/constants.js','constantsSHA':source[PM2+'/constants.js'],'semanticDefaultChoiceConfirmed':False,'basis':'candidate-HOME-dot-pm2-join-await-actual-paths-js-OVER_HOME-argv-launch-review-not-guess-truth'}
            reviewed=q.get('homeDefaultProofs',{}).get(role)
            if reviewed is not None:
                need(reviewed.get('selector')==sel and reviewed.get('sourceProofs')==source and reviewed.get('joinSHA')==basis['joinSHA'] and reviewed.get('status')=='INDEPENDENT_SOURCE_DEFAULT_REVIEW_NOT_APPROVAL','DEFAULT_HOME_EXACT_INDEPENDENT_SOURCE_PROOF')
                basis.update(semanticDefaultChoiceConfirmed=True,independentDefaultProofSHA=H(encode(reviewed)))
        need(home=='/root/.pm2' or any(within(home,p) for p in q['identityOnlyNamespaces'] if p!=SHADOW),'SAFE_HOME_ALLOWLIST')
        states={}; details={}
        home_id=identity(noalias(home))
        for n in ('dump.pm2','pm2.pid','rpc.sock','pub.sock'):
            p=home+'/'+n
            try: ident=identity(p)
            except FileNotFoundError: states[p]=None; details[p]={'present':False,'absenceObserved':True}; continue
            states[p]=ident; d={'present':True,'identity':ident,'metadata':metadata(p)}
            if ident['kind']=='file':
                b,r=reader.regular(p,export=n=='pm2.pid'); d['sha256']=r['sha256']
                if n=='pm2.pid': d['matchesBoundDaemonPid']=b.strip()==str(rec['pid']).encode(); d['matchesMainDaemonPid']=b.strip()==str(main_pid).encode()
            elif ident['kind']=='socket': d['socketBytesRead']=False
            else: raise Reject('DAEMON_STATE_UNEXPECTED_KIND')
            details[p]=d
        out[role]={'selector':sel,'boundPid':rec['pid'],'boundStartTicks':rec['startTicks'],'observedFDPaths':{fd:r['target'] for fd,r in rec['openPathFDs'].items()},'home':{'path':home,'environmentField':field,'identity':home_id,'sourceChoiceBasis':basis,'environmentFieldPresence':{k:v['present'] for k,v in fields.items()},'environmentIdentityHashes':{k:v['sha256'] for k,v in fields.items()},'relationHash':H(encode({'HOME':hf['sha256'],'PM2_HOME':pf['sha256'],'selectedPathSHA':H(home.encode())}))},'stateIdentities':states,'stateDetails':details,'sourceProofs':source,'proofEvidenceSHA':None,'launchSemantics':'PENDING_INDEPENDENT_REVIEW'}
    need(used=={r['pid'] for r in nodes.values() if r['isPM2GodDaemon']},'UNBOUND_GOD_DAEMON')
    return out

# Locator hints only. Deliberately NEVER promoted to complete closure: lexical strings
# cannot decide bundled local functions named require, ESM attrs, dynamic data or aliases.
LITERAL = re.compile(r'''(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)(['"])([^'"\r\n\\]+)\1''')
def locator_hints(b):
    try: text=b.decode('utf8')
    except UnicodeError: return []
    return sorted(set(m[1] for m in LITERAL.findall(text)))

def validate_payload(q):
    required=('nodeSha256','pm2Pins','pm2Inventory','runtimePins','nodeLoaderClosure','identityOnlyNamespaces','daemonRoles','pm2Roles','knownCodeRoots','retainedRoots','dependencyRequests','staticDeps')
    need(isinstance(q,dict) and all(k in q for k in required),'PAYLOAD_FIELDS_REQUIRED')
    need(q['nodeSha256']==NODE_SHA,'FIXED_ACTUAL_NODE_SHA')
    need(set(q['pm2Roles'])=={str(x) for x in ALL_IDS},'ALL_12_ROLE_INPUTS')
    for p,d in (q['pm2Pins']|q['runtimePins']).items(): exactpath(p); sha(d)
    need(all(within(p,PM2) for p in q['pm2Pins']),'PM2_FIXED_ROOT')
    for p in q['identityOnlyNamespaces']: exactpath(p); need(within(p,SHADOW),'NAMESPACE_POLICY_PATH_ONLY')
    need(SHADOW in q['identityOnlyNamespaces'],'SHADOW_ROOT_NAMESPACE')
    need(q['retainedRoots']==[RETENTION],'RECOMMENDATION_RETENTION_FIXED')
    for p in q['knownCodeRoots']: exactpath(p); need(within(p,'/opt/releases') or within(p,'/root/.pm2/modules') or p==RETENTION,'KNOWN_CODE_ROOT_BOUNDARY')
    for r in q['pm2Roles'].values():
        for k in ('script','cwd'): exactpath(r[k]); need(within(r[k],'/opt/releases') or within(r[k],'/root/.pm2/modules'),'ROLE_CODE_PATH_BOUNDARY')
    for d in q['staticDeps']:
        need(set(d)=={'logical','httpSha256'},'STATIC_DEP_EXACT_FIELDS'); need(d['logical'] in STATIC_ALLOW,'STATIC_EXACT_TRACE_ALLOWLIST'); sha(d['httpSha256'])
    need(len(q['dependencyRequests'])<=100000,'RESOLVER_REQUEST_LIMIT')
    return q

def collect(q):
    validate_payload(q); reader=Reader(); blocked=[]
    phase('acquire-existing-two-locks')
    with Locks() as locks:
        reader.regular(NODE,loader=True,expected=q['nodeSha256'])
        for p in q['nodeLoaderClosure']:
            physical,_=reader.resolve_alias(p,('/usr','/lib','/lib64'))
            need(physical==p,'LOADER_INPUT_PHYSICAL_PATH_REQUIRED'); reader.regular(p,loader=True,expected=q['runtimePins'][p])
        phase('full-pm2-source-inventory'); reader.start_code(); pm2tree=reader.tree(PM2)
        need(set(pm2tree)==set(q['pm2Inventory']),'PM2_FULL_3328_NAMESPACE_CHANGED')
        for p,r in pm2tree.items():
            old=q['pm2Inventory'][p]
            need(r['kind']==old['kind'] and all(r[k]==old[sk] for k,sk in zip(FIELDS,STFIELDS)),'PM2_FULL_METADATA_CHANGED')
            if r['kind']=='file': need(r['sha256']==q['pm2Pins'][p],'PM2_FULL_BYTES_CHANGED')
            elif r['kind']=='link': need(r['link']==old['target'],'PM2_ALIAS_CHANGED')
        reader.codeStarted=None; locks.check(); phase('existing-getMonitorData-only')
        rpc=node_child(q,'rpc'); rows=rpc['rows']; need(len(rows)==12 and {r['pm_id'] for r in rows}==ALL_IDS,'EXACT_12_RPC_ROWS')
        phase('bounded-whole-proc-safe-hashes'); nodes,nonnodes,homes,procstats=enumerate_proc(reader)
        need(len(nodes)==15,'ACTUAL_15_NODE_SET_REQUIRED')
        if procstats['disappearedOrKernelNoExe']: blocked.append('WHOLE_PROC_DISAPPEARED_OR_KERNEL_NOEXE_REQUIRES_REVIEW_NOT_LIVE_ABSENCE_PROOF')
        pidbytes,pidrec=reader.regular('/root/.pm2/pm2.pid',export=True)
        need(re.fullmatch(rb'[1-9][0-9]*\s*',pidbytes) is not None,'MAIN_DAEMON_PID_FILE_INVALID'); main_pid=int(pidbytes.strip())
        daemons=bind_daemons(q,nodes,homes,reader,main_pid); apps=[]
        for row in sorted(rows,key=lambda x:x['pm_id']):
            e=row['pm2_env']; expected=q['pm2Roles'][str(row['pm_id'])]
            need(row['name']==expected['name'] and e['pm_exec_path']==expected['script'] and e['pm_cwd']==expected['cwd'] and e['status']=='online' and type(row['pid']) is int,'MAIN_PM2_ACTUAL_ROLE_DRIFT')
            need(str(row['pid']) in nodes,'MAIN_PM2_PROC_BINDING')
            # Whole original rows and config/env are opaque; no lifecycle stripping.
            apps.append({'id':row['pm_id'],'pid':row['pid'],'name':row['name'],'script':e['pm_exec_path'],'cwd':e['pm_cwd'],'wholeRpcRowSHA':H(encode(row)),'configSha256':H(encode(e)),'applicationEnvSha256':H(encode(e.get('env',{}))),'configKeys':sorted(e),'environmentKeys':sorted(e.get('env',{})),'online':e['status']=='online','logPathFields':{k:exactpath(v) for k,v in e.items() if k in ('pm_out_log_path','pm_err_log_path','pm_log_path') and isinstance(v,str) and v.startswith('/')}})
        locks.check(); phase('exact-shadow-namespace-identity-only')
        namespaces={p:namespace(p) for p in sorted(q['identityOnlyNamespaces'])}
        refs=[]
        for rec in [*nodes.values(),*nonnodes.values()]:
            for field,paths in [('cwd',[rec['cwd']]),('exe',[rec['exe']]),('argv',rec['absoluteArgvPaths']),('script',rec['scriptPaths']),('fd',[v['target'] for v in rec['openPathFDs'].values()])]:
                for p in paths:
                    if within(p,SHADOW): refs.append({'pid':rec['pid'],'startTicks':rec['startTicks'],'field':field,'path':p,'cmdlineSha256':rec['cmdlineSha256'],'rawProcEnvironSha256':rec['rawProcEnvironSha256']})
        declared_logs={r['path'] for r in q.get('liveLogs',[])}
        for ref in refs:
            p=ref['path']
            if p not in declared_logs and p not in q.get('shadowLiveFiles',[]) and not any(within(p,r) for r in q.get('shadowLiveRoots',[])):
                blocked.append('LIVE_SHADOW_CODE_CWD_OR_USERDATA_REQUIRES_EXACT_CLASSIFICATION_GUARD_BLOCK_NO_BYTE_READ')
        phase('script-cwd-retained-closure',distinctScripts=len({a['script'] for a in apps})); reader.start_code()
        trees={}; scripts={}; cwd_files={}; requests=[]; source_bytes={}
        for rel in ('constants.js','paths.js','lib/Daemon.js','lib/God.js','lib/God/ClusterMode.js','lib/God/ForkMode.js','lib/ProcessContainer.js','lib/ProcessContainerFork.js','package.json'):
            p=PM2+'/'+rel; b,r=reader.regular(p,export=True,expected=q['pm2Pins'][p]); source_bytes[p]={'record':r,'base64':base64.b64encode(b).decode(),'privateSourceNotPublic':True}
        for p in sorted({str(Path(a['script']).parent) for a in apps}|set(q['knownCodeRoots'])|set(q['retainedRoots'])): trees[p]=reader.tree(p)
        for p in sorted({a['script'] for a in apps}):
            b,r=reader.regular(p,export=True); scripts[p]={'record':r,'base64':base64.b64encode(b).decode(),'locatorHints':locator_hints(b),'closureComplete':False,'hintParser':'regex-incomplete-not-AST-not-runtime-require-proof'}
        for cwd in sorted({a['cwd'] for a in apps}):
            noalias(cwd); cwd_files[cwd]={'metadata':metadata(cwd),'files':{}}
            for p in sorted(Path(cwd).iterdir()):
                if p.name.startswith(('.env','ecosystem','package')) or p.name in ('pnpm-lock.yaml','yarn.lock','package-lock.json','npm-shrinkwrap.json'):
                    if stat.S_ISLNK(os.lstat(p).st_mode): cwd_files[cwd]['files'][str(p)]={'identity':identity(p),'aliasNotFollowed':True}; blocked.append('CWD_CONFIG_ALIAS_REQUIRES_REVIEW')
                    elif p.is_file(): _,r=reader.regular(p); cwd_files[cwd]['files'][str(p)]=r
                    if p.name.startswith('package') and p.name.endswith('.json') and not p.is_symlink():
                        b,r=reader.regular(p,export=True); source_bytes[str(p)]={'record':r,'base64':base64.b64encode(b).decode(),'privateSourceNotPublic':True}
            # Locate actual ancestors/node_modules aliases but do not invent imports.
            cwd_files[cwd]['nodeModulesLocators']={str(x/'node_modules'):identity(x/'node_modules') for x in (Path(cwd),*Path(cwd).parents) if (x/'node_modules').exists() or (x/'node_modules').is_symlink()}
        for req in q['dependencyRequests']:
            need(set(req)>={'from','specifier','fromSHA'},'AST_RESOLVER_INPUT_FIELDS'); need(req['from'] in reader.pins and reader.pins[req['from']]['sha256']==req['fromSHA'],'AST_FROM_EXACT_SOURCE_PIN')
            need(isinstance(req['specifier'],str) and '\0' not in req['specifier'] and len(req['specifier'])<=4096,'DEPENDENCY_SPECIFIER_REQUIRED')
            requests.append({'from':req['from'],'specifier':req['specifier'],'fromSHA':req['fromSHA']})
        reader.codeStarted=None
        # Hints are NOT executed or auto-resolved; parent AST/source expert supplies
        # actual literal requests to avoid fake commonjs bundle-local require markers.
        resolve_payload=q|{'runtimePins':q['runtimePins']|{p:r['sha256'] for p,r in reader.pins.items()}}
        resolution=node_child(resolve_payload,'resolve',requests) if requests else {'locators':[],'packageReads':[],'readFiles':[],'closure':[]}
        reader.start_code()
        for alias in resolution.get('packageAliasReads',[]):
            physical,_=reader.resolve_alias(alias['logical'],('/opt/releases','/root/.pm2/modules',PM2,'/usr/share/nodejs'))
            need(physical==alias['physical'],'RESOLVER_PACKAGE_ALIAS_DRIFT')
        for p,digest in resolution.get('discoveredPackagePins',{}).items():
            b,r=reader.regular(p,export=True,expected=digest); source_bytes[p]={'record':r,'base64':base64.b64encode(b).decode(),'privateSourceNotPublic':True}
        for row in resolution['locators']:
            if row.get('unresolved'): blocked.append('UNRESOLVED_ACTUAL_PACKAGE:'+row['specifier']); continue
            if not row['builtin']:
                physical,_=reader.resolve_alias(row['resolved'],('/opt/releases','/root/.pm2/modules',PM2,'/usr/share/nodejs'))
                reader.regular(physical)
                if physical.endswith(('.js','.mjs','.cjs','.json')) and not secret(physical):
                    b,r=reader.regular(physical,export=True); source_bytes[physical]={'record':r,'base64':base64.b64encode(b).decode(),'privateSourceNotPublic':True}
                parent=str(Path(physical).parent)
                if parent not in trees: trees[parent]=reader.tree(parent)
        static={}
        for row in q['staticDeps']:
            physical_url=STATIC_ALLOW[row['logical']]
            p=PUBLIC+physical_url; physical,aliases=reader.resolve_alias(p,(PUBLIC,))
            need(not secret(physical),'SECRET_STATIC_EXPORT_REFUSED'); _,r=reader.regular(physical,expected=row['httpSha256'])
            static[row['logical']]={'logical':row['logical'],'physical':physical_url,'file':physical,'record':r,'httpSha256':row['httpSha256'],'httpBytesMatch':True,'filesystemAliases':aliases,'binaryBytesExported':False,'mappingBasis':'parent-exact-5d5611-trace-URL-map-await-fresh-HTML-importmap-verification'}
        retained_ops=namespace('/opt/ops')
        if not requests: blocked.append('PARENT_AST_LITERAL_DYNAMIC_AND_TRANSITIVE_REQUESTS_NOT_SUPPLIED')
        blocked.extend(['INDEPENDENT_SOURCE_LAUNCH_LOG_NAMESPACE_REVIEW_NOT_SUPPLIED','TRANSITIVE_ESM_ATTRS_DYNAMIC_IMPORTS_AND_BUNDLED_LOCALS_NOT_PROVEN','OLD_RECOMMENDATION_ABSENCE_NOT_ORDERLY_RETIREMENT','FRESH_CONTROLLER_CAPTURE_STATIC_COMPARE_AND_GUARD_NOT_PERFORMED'])
        phase('source-second-full-bytes-and-namespace-recheck',files=len(reader.pins),codeBytes=reader.codeBytes,loaderBytes=reader.loaderBytes)
        reader.verify()
        for root,tree in trees.items(): need(reader.tree(root)==tree,'SCRIPT_FULL_TREE_SECOND_READ_DRIFT')
        need(reader.tree(PM2)==pm2tree,'PM2_SECOND_FULL_SOURCE_DRIFT')
        for p,n in namespaces.items(): need(namespace(p)==n,'SHADOW_NAMESPACE_SECOND_READ_DRIFT')
        reader.codeStarted=None; locks.check()
        # Recheck every observed live node's identity/FD/env, not just HOME hashes.
        for pid,old in nodes.items():
            new,_=proc_record(int(pid),reader); need(new==old,'FINAL_LIVE_NODE_PROC_OR_FD_DRIFT')
        for pid,old in nonnodes.items():
            new,_=proc_record(int(pid),reader,pin_execution=False); need(new==old,'FINAL_NON_NODE_PROC_OR_FD_DRIFT')
        out={'schema':'runtime-completion-readonly-proof-v1','kind':'readonly-supplement-not-capture-not-approval','status':'PENDING_INDEPENDENT_REVIEW','productionWrites':0,'rawEnvironmentValuesExported':False,'rawArgvExported':False,'lifecycleFieldsStripped':False,'payloadSha256':H(encode(q)),'wholeMonitorDataSha256':H(encode(rows)),'pm2':apps,'mainDaemonPid':main_pid,'allLiveNodeAndPM2':nodes,'allNonNodeProcesses':nonnodes,'procEnumeration':procstats,'daemonObservations':daemons,'identityOnlyNamespaces':namespaces,'shadowReferences':refs,'scriptSources':scripts,'scriptTrees':trees,'cwdProofs':cwd_files,'retainedOpsNamespace':retained_ops,'recommendationRetainedRoot':RETENTION,'rpcExecutedClosure':rpc['closure'],'rpcReadFiles':rpc['readFiles'],'nodeLoaderClosure':rpc['nodeLoaderClosure'],'dependencyResolution':resolution,'closureComplete':False,'staticDeps':static,'sourcePins':reader.pins,'aliases':reader.aliases,'reviewRequirements':sorted(set(blocked)),'independentSemanticReview':None,'bounds':{'proc':MAX_PROC,'entries':MAX_ENTRIES,'scriptFileBytes':MAX_FILE,'scriptTotalBytes':MAX_CODE,'scriptReadSeconds':40,'loaderFileBytes':MAX_LOADER_FILE,'loaderTotalBytes':MAX_LOADER,'wholeProbeSeconds':150},'statistics':{'sourceFiles':len(reader.pins),'codeBytes':reader.codeBytes,'loaderBytes':reader.loaderBytes,'shadowNamespaces':len(namespaces),'staticDependencies':len(static)},'collectorSourceSHA':collector_source_hash(),'embeddedNodeHelperSHA':H(JS.encode())}
        out['sourceEvidenceBytes']=source_bytes
        locks.check(); phase('completed-pending',**out['statistics']); return out

def main():
    phase('read-credentialless-stdin-payload')
    def timeout(*_): raise Reject('WHOLE_PROBE_TIMEOUT_150_SECONDS')
    signal.signal(signal.SIGALRM,timeout); signal.alarm(150)
    try:
        raw=sys.stdin.buffer.read(MAX_PAYLOAD+1); need(len(raw)<=MAX_PAYLOAD,'PAYLOAD_SIZE_LIMIT')
        out=collect(decode(raw)); signal.alarm(0); sys.stdout.buffer.write(encode(out)+b'\n'); return 0
    except Exception as e:
        signal.alarm(0)
        # Never echo exception messages (may contain secrets), raw child stderr or payload.
        code=str(e).split(':',1)[0] if isinstance(e,Reject) else 'EXCEPTION_'+type(e).__name__.upper()
        code=code if re.fullmatch(r'[A-Z0-9_]{1,128}',code) else 'READONLY_PROBE_REJECTED'
        out={'schema':'runtime-completion-readonly-proof-v1','status':'ABORTED_NO_APPROVAL','productionWrites':0,'errorCode':code,'factsComplete':False,'independentSemanticReview':None}
        sys.stdout.buffer.write(encode(out)+b'\n'); phase('aborted',errorCode=code); return 2
if __name__=='__main__': sys.exit(main())
