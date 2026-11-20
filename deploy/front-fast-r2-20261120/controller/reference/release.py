#!/usr/bin/env python3
"""New-scope incremental release controller, stdlib only. No legacy execution.
CLI capture/preflight are readonly; apply is one-shot and refuses unready boundaries.
No SSH, browser, PM2 CLI/connect/start/update-env, worker/env/DB business writes.
Failure after attempt retains own open hold and new leaves; never pretends rollback.
Advisory-lock full-META CAS cannot defeat uncooperative writers outside those locks.
"""
import argparse
import base64
import copy
import datetime as dt
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unicodedata
import uuid
from urllib.parse import urlsplit

HERE = Path(__file__).absolute().parent
HELPERS_SHA = '655bc995a61aa6252e836a128eadf9a7f3ec18ea452846bc11e92f4e9543b882'
def _local_source(path):
    for p in (path, *path.parents):
        if p.is_symlink(): raise RuntimeError('SOURCE_SYMLINK_REFUSED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode): raise RuntimeError('SOURCE_REGULAR_REQUIRED')
        with os.fdopen(fd, 'rb', closefd=False) as f: return f.read()
    finally: os.close(fd)
if hashlib.sha256(_local_source(HERE/'safe_helpers.py')).hexdigest() != HELPERS_SHA:
    raise RuntimeError('PINNED_HELPERS_SHA_MISMATCH')
import safe_helpers as h
import scope as s

# Only PM2-owned lifecycle containers are canonicalized, not arbitrary application JSON.
LIFECYCLE = frozenset({'status','pid','pm_id','pm_uptime','created_at','restart_time',
 'unstable_restarts','axm_actions','axm_monitor','axm_dynamic','monit','vizion_running',
 'prev_restart_delay','exit_code'})
PROCESS_HASH_FIELDS = ('configenvHash','topConfigSha256','childConfigSha256',
 'rawProcEnvironSha256','rawStableSha256','permissionsSha256')
TARGET_KEYS = ('front-api', 'admin-api', 'main-html')
MANIFEST_KEYS = {'schema','ownerTask','scope','ttlSeconds','sourceFiles','controllerSha256',
 'captureSha256','fullMetaSha256','coordSha256','targets','html','newFiles','newDirectories','packageFiles',
 'reloadIds','mutableTechnicalPath','sourceVerification','forbiddenBusinessChanges'}
REVIEW_KEYS = {'schema','ownerTask','scope','status','independent','releaseApproved','reviewer',
 'reviewedAtUtc','manifestSha256','controllerSha256','sourceFiles','captureSha256','fullMetaSha256',
 'coordSha256','packageFiles','targets','html','newFiles','newDirectories','reloadIds',
 'mutableTechnicalPath','sourceVerification','forbiddenBusinessChanges'}
FORBIDDEN = {'priceInventoryCache': False, 'businessDatabaseWrites': False,
 'environmentWrites': False, 'workerReloads': False, 'adminHtmlWrites': False}
SELF_SEARCH_PATTERN = r'/assets/search-official-material-[0-9a-f]{64}\.js'
FINANCIAL_PARAMETER_NAMES = frozenset({'price','unitprice','saleprice','purchaseprice','cost','unitcost',
 'quote','quoteprice','quotation','stock','stockqty','stockquantity','inventory','inventoryqty',
 'inventoryquantity','quantity','qty','availablequantity','价格','单价','售价','采购价','成本',
 '报价','报价金额','库存','库存量','库存数量','数量'})


def exact(value, keys, label):
    h.need(isinstance(value, dict) and set(value) == set(keys), 'EXACT_' + label + '_FIELDS')
    return value


def source_files():
    return {n: h.H(h.regular(HERE/n)) for n in ('release.py','safe_helpers.py','scope.py')}


def controller_sha(files=None): return h.H(h.encode(files or source_files()))


def js_digest(value):
    return h.H(__import__('json').dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())


def technical_store(data,evidence,fixture=False):
    h.need(len(data)<=32*1024*1024,'STORE_MAX_BYTES')
    doc=exact(h.decode(data),{'schemaVersion','generation','sources','entries'},'TECH_STORE')
    h.need(type(doc['schemaVersion']) is int and doc['schemaVersion']==1 and type(doc['generation']) is int and doc['generation']>=0
       and isinstance(doc['sources'],dict) and isinstance(doc['entries'],list) and len(doc['entries'])<=50000,
       'TECH_STORE_SCHEMA_REQUIRED')
    proof=exact(h.decode(evidence),{'schema','storeSha256','method','sourceVersions','databaseWrites',
                'identityRevisions','environmentWrites','synthetic','verifiedAtUtc'},'STORE_SOURCE_VERIFICATION')
    h.need(proof['schema']=='inline-store-source-verification-v1' and proof['storeSha256']==h.H(data)
       and proof['method']=='readonly-current-source-version-and-restart' and type(proof['databaseWrites']) is int and proof['databaseWrites']==0
       and type(proof['environmentWrites']) is int and proof['environmentWrites']==0 and proof['synthetic'] is fixture and isinstance(proof['sourceVersions'],dict),
       'REAL_SOURCE_VERSION_VERIFICATION_REQUIRED')
    h.timestamp(proof['verifiedAtUtc'])
    versions={}
    for key,value in doc['sources'].items():
        h.pin(key)
        h.need(isinstance(value,dict) and set(value) in ({'ticket','version'},
          {'ticket','version','pendingWriterTickets'}),'EXACT_STORE_SOURCE_FIELDS')
        h.need(isinstance(value['ticket'],str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',value['ticket']),
               'SOURCE_TICKET_UUID_REQUIRED')
        pending=value.get('pendingWriterTickets',[])
        h.need(isinstance(pending,list) and all(isinstance(ticket,str) and
          re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',ticket) for ticket in pending)
          and len(pending)==len(set(pending)),
          'SOURCE_PENDING_WRITER_TICKETS_UUID_ARRAY_REQUIRED')
        h.need(not pending,'SOURCE_WRITERS_OUTSTANDING_NOT_FINAL_VERIFIED')
        if value['version'] is not None:h.pin(value['version'])
        versions[key]=value['version']
    h.need(proof['sourceVersions']==versions,'STORE_VERIFIED_CURRENT_SOURCE_VERSIONS_REQUIRED')
    identities=set()
    def text(value,maxlen,nonempty=False):
        h.need(isinstance(value,str) and len(value)<=maxlen and (bool(value) or not nonempty)
          and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',value)
          and not re.search(r'<\s*/?\s*[a-z][^<>]*>|<!--|<!doctype\b|<\?',value,re.I),'SAFE_TECH_TEXT_REQUIRED')
    def identity(value):
        exact(value,{'publicId','revision','partNumber','brand','pkg'},'STORE_IDENTITY')
        h.need(isinstance(value['publicId'],str) and re.fullmatch(r'OM_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',value['publicId'])
          and type(value['revision']) is int and 1<=value['revision']<=2147483647,'STORE_IDENTITY_REQUIRED')
        for key in ('partNumber','brand','pkg'):text(value[key],128,key!='pkg')
    for e in doc['entries']:
        exact(e,{'identity','sourceKey','sourceVersion','projectionVersion','preparedAt','technicalResource'},'STORE_ENTRY')
        identity(e['identity']);id_=e['identity'];h.need(id_['publicId'] not in identities,'STORE_PUBLIC_ID_DUPLICATE');identities.add(id_['publicId'])
        key=js_digest(unicodedata.normalize('NFKC',id_['partNumber']).strip().upper())
        h.pin(e['sourceVersion'])
        h.need(e['sourceKey']==key and versions.get(key)==e['sourceVersion'] and e['projectionVersion']=='official-safe-technical-v1',
               'STORE_IDENTITY_SOURCE_VERSION_BINDING')
        h.timestamp(e['preparedAt']);response=exact(e['technicalResource'],{'state','parameterVersion','resource'},'TECH_RESPONSE')
        resource=response['resource'];state=response['state']
        if state=='unavailable':
            h.need(resource is None and response['parameterVersion'] is None,'UNAVAILABLE_NOT_READY');continue
        h.need(state in ('ready','missing'),'TECH_STATE_REQUIRED')
        exact(resource,{'publicId','revision','partNumber','brand','pkg','category','description','parameters','datasheetUrl'},'TECH_RESOURCE')
        h.need({k:resource[k] for k in id_}==id_,'RESOURCE_IDENTITY_BINDING')
        for key,maxlen in [('category',256),('description',4096)]:
            if resource[key] is not None:text(resource[key],maxlen)
        params=resource['parameters'];h.need(isinstance(params,list) and len(params)<=1000 and (bool(params) if state=='ready' else not params),'READY_MISSING_EXACT_PARAMETERS')
        parameter_names=set()
        for p in params:
            exact(p,{'name','value'},'TECH_PARAMETER');text(p['name'],128,True);text(p['value'],2048,True)
            h.need(p['name'] not in parameter_names,'AMBIGUOUS_CLEANED_PARAMETER_NAMES');parameter_names.add(p['name'])
            canonical=re.sub(r'[\s_.-]+','',unicodedata.normalize('NFKC',p['name']).strip().casefold())
            # Whole-value intrinsic MOSFET/BJT composition, never a low-stock-number exemption.
            intrinsic_count=(canonical=='数量' and re.fullmatch(r'(?:[1-9]|[1-5][0-9]|6[0-4])个(?:N沟道|P沟道|NPN|PNP)',
                             unicodedata.normalize('NFKC',p['value']).strip()) is not None)
            h.need(canonical not in FINANCIAL_PARAMETER_NAMES or intrinsic_count,'NO_PRICE_INVENTORY_PARAMETERS')
        url=resource['datasheetUrl']
        if url is not None:
            text(url,2048,True);parsed=urlsplit(url)
            h.need(not re.search(r'[<>]',url) and parsed.scheme=='https' and bool(parsed.hostname)
              and not parsed.username and not parsed.password,'SAFE_DATASHEET_HTTPS_REQUIRED')
        digest=js_digest({'identity':id_,'sourceVersion':e['sourceVersion'],'projectionVersion':e['projectionVersion'],'resource':resource})
        h.need(response['parameterVersion']=='tp1_'+digest,'TECH_RESOURCE_CONTENT_VERSION_BINDING')
    h.need(proof['identityRevisions']=={e['identity']['publicId']:e['identity']['revision'] for e in doc['entries']},
           'STORE_CURRENT_PUBLICATION_REVISIONS_BINDING')
    return doc


def b64(value):
    h.need(isinstance(value, str), 'BASE64_STRING_REQUIRED')
    try: return base64.b64decode(value, validate=True)
    except (ValueError, TypeError): raise h.ReleaseError('INVALID_BASE64') from None


def pm2_config(value):
    h.need(isinstance(value, dict), 'PM2_CONFIG_OBJECT_REQUIRED')
    out = {k:v for k,v in value.items() if k not in LIFECYCLE and k != 'env'}
    if 'env' in value:
        h.need(isinstance(value['env'], dict), 'PM2_CHILD_ENV_OBJECT_REQUIRED')
        out['env'] = {k:v for k,v in value['env'].items() if k not in LIFECYCLE}
    return out


def raw_stable(raw, own):
    h.need(raw.endswith(b'\0'), 'RAW_ENV_NUL_REQUIRED')
    values = {}
    for part in raw[:-1].split(b'\0'):
        h.need(b'=' in part, 'RAW_ENV_ENTRY_INVALID')
        key, value = part.split(b'=', 1)
        h.need(key and key not in values, 'RAW_ENV_DUPLICATE_OR_EMPTY')
        values[key] = value
    # The actual whole raw bytes are ALWAYS separately pinned. Unrolled slots compare exact.
    if own:
        h.need(re.fullmatch(rb'[0-9]+', values.get(b'NODE_UNIQUE_ID', b'')) is not None,
               'EXACT_OUTER_NODE_UNIQUE_ID_INTEGER_REQUIRED')
        values[b'NODE_UNIQUE_ID'] = b'0'
        for key in list(values):
            if key in {name.encode('ascii') for name in LIFECYCLE}: del values[key]
        if b'pm2_env' in values: values[b'pm2_env'] = h.encode(pm2_config(h.decode(values[b'pm2_env'])))
    # All opaque application strings and nested NODE_UNIQUE_ID remain byte-exact.
    return h.H(h.encode({base64.b64encode(k).decode():base64.b64encode(v).decode()
                        for k,v in values.items()}))


def permissions(cfg, pid):
    data = h.regular(cfg.proc/str(pid)/'status')
    fields = {}
    for line in data.splitlines():
        key, _, value = line.partition(b':')
        if key in (b'Uid',b'Gid',b'Groups',b'Umask'):
            h.need(key not in fields, 'PROC_PERMISSION_DUPLICATE')
            fields[key] = value.split()
    h.need(set(fields) == {b'Uid',b'Gid',b'Groups',b'Umask'}, 'PROC_PERMISSION_REQUIRED')
    return h.H(h.encode({k.decode():[v.decode('ascii') for v in vs] for k,vs in fields.items()}))


PM2_RPC = r'''
const fs=require('fs'); const socket='/root/.pm2/rpc.sock',pidfile='/root/.pm2/pm2.pid';
let done=false,req;function fail(){if(done)return;done=true;process.stderr.write('EXISTING_RPC_FAILED');process.exit(2)}
try{const pid=Number(fs.readFileSync(pidfile,'utf8').trim());
 if(!Number.isInteger(pid)||pid<=0||!fs.statSync(socket).isSocket())throw Error('daemon');process.kill(pid,0);
 const axon=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon');
 const rpc=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc');
 req=axon.socket('req');req.on('error',fail);req.connect(socket);const client=new rpc.Client(req);
 client.call('getMonitorData',{},(err,rows)=>{if(err||!Array.isArray(rows))return fail();
 done=true;process.stdout.write(JSON.stringify(rows),()=>{req.close();process.exit(0)});});setTimeout(fail,12000);
}catch(_){fail()}
'''


def node(): return '/usr/bin/node-22' if Path('/usr/bin/node-22').is_file() else '/usr/bin/node'


def process_snapshot(cfg):
    result = subprocess.run([node(),'-e',PM2_RPC],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=16)
    h.need(result.returncode == 0, 'EXISTING_DAEMON_RPC_FAILED_NO_FALLBACK')
    rows = h.decode(result.stdout)
    h.need(isinstance(rows, list), 'PROCESS_ROWS_REQUIRED')
    out = []
    for row in rows:
        e, pid, id_ = row['pm2_env'], row['pid'], row['pm_id']
        h.need(type(pid) is int and pid > 0 and e.get('status') == 'online', 'ALL_ONLINE_REQUIRED')
        raw = h.regular(cfg.proc/str(pid)/'environ')
        child = e.get('env', {})
        h.need(isinstance(child,dict), 'CHILD_ENV_REQUIRED')
        filtered = pm2_config(e)
        top = {k:v for k,v in filtered.items() if k != 'env'}
        child = {k:v for k,v in child.items() if k not in LIFECYCLE}
        out.append(dict(id=id_, name=row['name'],pid=pid,status=e['status'],script=e['pm_exec_path'],
            cwd=e['pm_cwd'],execMode=e['exec_mode'],restarts=e.get('restart_time'),
            configenvHash=h.H(h.encode({'env':child,'topEnv':top})),
            topConfigSha256=h.H(h.encode(top)),childConfigSha256=h.H(h.encode(child)),
            rawProcEnvironSha256=h.H(raw),rawStableSha256=raw_stable(raw,id_ in s.RELOAD_IDS),
            permissionsSha256=permissions(cfg,pid)))
    out.sort(key=lambda r:r['id'])
    validate_processes(cfg,out)
    return out


def validate_processes(cfg, rows):
    h.need(isinstance(rows,list) and len(rows)==12 and {r['id'] for r in rows}==set(s.ALL_IDS)
           and len({r['pid'] for r in rows})==12, 'EXACT_ACTUAL_12_IDS_REQUIRED')
    for row in rows:
        h.need(type(row['id']) is int and type(row['pid']) is int and row['pid']>0
               and row['status']=='online' and type(row['restarts']) is int and row['restarts']>=0
               and all(isinstance(row.get(k),str) and h.HEX.fullmatch(row[k]) for k in PROCESS_HASH_FIELDS),
               'PROCESS_SNAPSHOT_INVALID')
        if row['id'] in s.RELOAD_IDS:
            front = row['id'] in s.FRONT_IDS
            h.need(row['name']==('dianzi51' if front else 'dianzi51-admin')
             and row['script']==str(cfg.api if front else cfg.admin_api)
             and row['cwd']==str(cfg.path(s.FRONT_CWD if front else s.ADMIN_CWD))
             and row['execMode']=='cluster_mode', 'FIXED_SIX_IDENTITY_REQUIRED')


def reversible_delta(before, after, delta, path):
    exact(delta, {'schema','path','beforeSha256','afterSha256','patches'}, 'BYTE_DELTA')
    h.need(delta['schema']=='inline-byte-delta-v1' and delta['path']==str(path)
     and delta['beforeSha256']==h.H(before) and delta['afterSha256']==h.H(after) and before!=after,
     'DELTA_BINDING')
    patches = delta['patches']
    h.need(isinstance(patches,list) and 1<=len(patches)<=32, 'BOUNDED_PATCH_LIST_REQUIRED')
    pieces, reverse, previous, growth, touched = [], [], 0, 0, 0
    for p in patches:
        exact(p, {'kind','offset','beforeBase64','afterBase64'}, 'PATCH')
        h.need(p['kind'] in ('authorized-technical-parameters','search-attachment-readonly','technical-store-hook'),
               'PATCH_TECHNICAL_SCOPE_ONLY')
        offset, old, new = p['offset'],b64(p['beforeBase64']),b64(p['afterBase64'])
        h.need(type(offset) is int and 0<offset and previous<=offset and offset+len(old)<len(before)
         and len(old)<=65536 and len(new)<=65536 and (old or new) and old!=new
         and before[offset:offset+len(old)]==old, 'PATCH_ORIGINAL_INTERIOR_BYTES_REQUIRED')
        # Explicit insertion is allowed, but duplicate insertion offsets are not.
        h.need(not reverse or offset>reverse[-1]['originalOffset'], 'DISTINCT_PATCH_OFFSETS_REQUIRED')
        pieces += [before[previous:offset],new]
        reverse.append(dict(originalOffset=offset,offset=offset+growth,before=new,after=old))
        previous=offset+len(old);growth+=len(new)-len(old);touched+=len(old)+len(new)
    pieces.append(before[previous:]); reconstructed=b''.join(pieces)
    h.need(touched<=262144 and reconstructed==after, 'FULL_FORWARD_DELTA_RECONSTRUCTION_REQUIRED')
    h.need(sum(len(b64(p['beforeBase64'])) for p in patches)<len(before)//4,
           'API_WHOLE_BUNDLE_REPLACEMENT_REFUSED')
    inverse=after
    for p in reversed(reverse):
        pos=p['offset'];h.need(inverse[pos:pos+len(p['before'])]==p['before'], 'INVERSE_SPAN_MISMATCH')
        inverse=inverse[:pos]+p['after']+inverse[pos+len(p['before']):]
    h.need(inverse==before, 'FULL_INVERSE_PREIMAGE_REQUIRED')
    return reverse


RELOAD_RPC = r'''
const fs=require('fs'),crypto=require('crypto');const q=JSON.parse(process.argv[1]);
const socket='/root/.pm2/rpc.sock',pidfile='/root/.pm2/pm2.pid';let done=false,req;
function fail(){if(done)return;done=true;process.stderr.write('PINNED_EXISTING_RELOAD_FAILED');process.exit(2)}
function hashes(){for(const [p,h] of Object.entries(q.pins)){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{if(!fs.fstatSync(fd).isFile()||crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')!==h)throw Error('hash')}finally{fs.closeSync(fd)}}}
function target(rows){if(!Array.isArray(rows))throw Error('rows');const m=rows.filter(r=>r.pm_id===q.id);
 if(m.length!==1)throw Error('id');const r=m[0],e=r.pm2_env;
 if(!e||r.name!==q.name||e.status!=='online'||e.pm_exec_path!==q.script||e.pm_cwd!==q.cwd||e.exec_mode!=='cluster_mode'||e.wait_ready||
 !Number.isInteger(r.pid)||r.pid<=0||!Number.isInteger(e.restart_time)||e.restart_time<0)throw Error('identity');
 return {pid:r.pid,restarts:e.restart_time};}
try{if(![190,193,194,200,191,192].includes(q.id))throw Error('scope');hashes();
 const pid=Number(fs.readFileSync(pidfile,'utf8').trim());if(!Number.isInteger(pid)||pid<=0||!fs.statSync(socket).isSocket())throw Error('daemon');process.kill(pid,0);
 const axon=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon'),rpc=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc');
 req=axon.socket('req');req.on('error',fail);req.connect(socket);const client=new rpc.Client(req);setTimeout(fail,44000);
 client.call('getMonitorData',{},(err,rows)=>{try{if(err)throw Error('monitor');const before=target(rows);hashes();
 client.call('reloadProcessId',{id:q.id,env:{}},(err)=>{if(err)return fail();client.call('getMonitorData',{},(err,rows)=>{
 try{if(err)throw Error('monitor');const after=target(rows);hashes();if(after.pid===before.pid||after.restarts!==before.restarts+1)throw Error('transition');
 done=true;process.stdout.write(JSON.stringify({id:q.id,beforePid:before.pid,afterPid:after.pid}),()=>{req.close();process.exit(0)})}catch(_){fail()}})})}catch(_){fail()}})
}catch(_){fail()}
'''


def verified_reload(cfg,id_,api_sha):
    h.need(cfg.fixture_root is None and type(id_) is int and id_ in s.RELOAD_IDS,'FIXED_PRODUCTION_RELOAD_REQUIRED')
    front=id_ in s.FRONT_IDS;api=cfg.api if front else cfg.admin_api
    pins=dict(s.PM2_PINS);pins[str(api)]=h.pin(api_sha)
    for path,digest in pins.items():h.need(h.H(h.regular(Path(path)))==digest,'PM2_OR_API_SOURCE_PIN_MISMATCH')
    q=dict(id=id_,name='dianzi51' if front else 'dianzi51-admin',script=str(api),
           cwd=str(cfg.path(s.FRONT_CWD if front else s.ADMIN_CWD)),pins=pins)
    result=subprocess.run([node(),'-e',RELOAD_RPC,h.encode(q).decode()],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
    h.need(result.returncode==0,'EXISTING_RELOAD_FAILED_NO_FALLBACK')
    return h.decode(result.stdout)


def unverified_health(cfg, sha_by_role):
    raise h.ReleaseError('READONLY_HEALTH_ADAPTER_UNVERIFIED_FAIL_CLOSED')


def unverified_source(cfg, store_sha):
    raise h.ReleaseError('REAL_READONLY_SOURCE_REVISION_VERIFIER_UNVERIFIED_FAIL_CLOSED')


def verified_source(cfg,store_sha):
    h.need(cfg.fixture_root is None and s.SOURCE_VERIFIER_SHA is not None,'FIXED_SOURCE_VERIFIER_UNCONFIRMED_FAIL_CLOSED')
    script=cfg.package/s.SOURCE_VERIFIER_FILE
    h.need(h.H(h.regular(script))==h.pin(s.SOURCE_VERIFIER_SHA),'FIXED_SOURCE_VERIFIER_SHA_MISMATCH')
    path=cfg.technical_paths['technical-store'];record=h.describe(path);data=h.regular(path)
    h.need(record['sha256']==store_sha,'STORE_CHANGED_BEFORE_REAL_SOURCE_VERIFY')
    # No env=, .env sourcing, updater or --apply. Only existing inherited ADMIN_DB_URL.
    result=subprocess.run([node(),str(script),'--verify'],cwd=str(cfg.path(s.FRONT_CWD)),
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=240)
    h.need(result.returncode==0,'REAL_CURRENT_SOURCE_AND_REVISION_VERIFY_FAILED_NO_REPAIR')
    lines=result.stdout.splitlines();h.need(bool(lines),'REAL_VERIFIER_NO_RESULT')
    summaries=[]
    for line in lines:
        value=h.decode(line)
        if isinstance(value,dict) and value.get('status')=='RECOVERY_AND_SOURCE_VERIFIED':summaries.append(value)
    h.need(len(summaries)==1,'REAL_VERIFIER_EXACT_ONE_SUCCESS_RESULT_REQUIRED')
    summary=summaries[0]
    h.need(type(summary.get('total')) is int and type(summary.get('ready')) is int and type(summary.get('missing')) is int
      and summary.get('unavailable')==0 and summary['total']==summary['ready']+summary['missing'],
      'REAL_VERIFIER_COMPLETE_CURRENT_PUBLICATION_COVERAGE_REQUIRED')
    h.need(h.describe(path)==record and h.regular(path)==data,'STORE_CHANGED_DURING_REAL_SOURCE_VERIFY')
    doc=h.decode(data)
    h.need(len(doc['entries'])==summary['total'],'STORE_ENTRIES_CURRENT_PUBLICATION_EXACT_COVERAGE_REQUIRED')
    return h.encode(dict(schema='inline-store-source-verification-v1',storeSha256=store_sha,
      method='readonly-current-source-version-and-restart',sourceVersions={k:v['version'] for k,v in doc['sources'].items()},
      identityRevisions={e['identity']['publicId']:e['identity']['revision'] for e in doc['entries']},
      databaseWrites=0,environmentWrites=0,synthetic=False,verifiedAtUtc=h.now()))


def verified_listener_health(cfg,sha_by_role):
    h.need(cfg.fixture_root is None,'FIXED_PRODUCTION_LISTENER_HEALTH_ONLY')
    result=subprocess.run([node(),'-e',PM2_RPC],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=16)
    h.need(result.returncode==0,'EXISTING_DAEMON_HEALTH_IDENTITY_READ_FAILED')
    rows=h.decode(result.stdout)
    for role,sha in sha_by_role.items():
        front=role=='front-api';api=cfg.api if front else cfg.admin_api
        ids=s.FRONT_IDS if front else s.ADMIN_IDS;name='dianzi51' if front else 'dianzi51-admin'
        group=[row for row in rows if row['pm_id'] in ids]
        h.need({row['pm_id'] for row in group}==set(ids),'HEALTH_FIXED_GROUP_REQUIRED')
        ports=set()
        for row in group:
            e=row['pm2_env'];h.need(row['name']==name and e['pm_exec_path']==str(api)
             and e['status']=='online' and e['exec_mode']=='cluster_mode','HEALTH_ACTUAL_IDENTITY_DRIFT')
            value=e.get('PORT',e.get('env',{}).get('PORT'))
            h.need(isinstance(value,(int,str)) and not isinstance(value,bool) and re.fullmatch(r'[0-9]{1,5}',str(value))
             and 1<=int(value)<=65535,'HEALTH_ACTUAL_DAEMON_PORT_REQUIRED')
            if 'PORT' in e.get('env',{}):h.need(str(e['env']['PORT'])==str(value),'HEALTH_TOP_CHILD_PORT_DISAGREEMENT')
            ports.add(int(value))
        h.need(len(ports)==1 and h.H(h.regular(api))==h.pin(sha),'HEALTH_ACTUAL_PORT_OR_API_PIN_DRIFT')
        html=cfg.html if front else cfg.public/'index.html';record=h.describe(html)
        answer=subprocess.run(['curl','--fail','--silent','--show-error','--noproxy','*','--proto','=http',
         '--max-time','15','--request','GET','http://127.0.0.1:'+str(next(iter(ports)))+'/'],
         stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=18)
        h.need(answer.returncode==0 and h.H(answer.stdout)==record['sha256'] and h.describe(html)==record
         and h.H(h.regular(api))==sha,'READONLY_ACTUAL_LISTENER_ROOT_BODY_HASH_FAILED')
    return True


def retired_process_absent(cfg,pid): return not (cfg.proc/str(pid)).exists()


class Controller:
    def __init__(self,cfg=None,process_reader=None,get_reader=None,reload_adapter=None,health_reader=None,
                 source_verifier=None,retired_reader=None):
        self.cfg=cfg or s.Config()
        self.process_reader=process_reader or process_snapshot
        self.get_reader=get_reader or h.http_get
        self.reload_adapter=reload_adapter or verified_reload
        self.health_reader=health_reader or verified_listener_health
        self.source_verifier=source_verifier or verified_source
        self.retired_reader=retired_reader or retired_process_absent
        self.mutable_store_enabled=False;self.verified_store_record=None;self.store_observations=[]
        self.sources=source_files();self.controller_hash=controller_sha(self.sources)
        self.owned_records={};self.new_records={};self.new_dir_records={};self.rolls={};self.pids={};self.events=[]

    def private(self,path):
        st=h.no_symlink(path).stat()
        h.need(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)&0o077==0,
               'PRIVATE_OWNED_DIRECTORY_REQUIRED')

    def fresh(self,capture):
        age=dt.datetime.now(dt.timezone.utc).timestamp()-h.timestamp(capture['capturedAtUtc'])
        h.need(0<=age<=s.TTL,'CAPTURE_EXPIRED_OR_FUTURE')

    def coord_closed(self,data):
        c=h.decode(data);h.need(isinstance(c,dict) and c.get('shared_release_active') is False,'COORD_BUSY')
        w=c.get('window');h.need(isinstance(w,dict) and w.get('status') in ('closed','verified')
          and w.get('needsOperatorRecovery') is False and c.get('needsOperatorRecovery',False) is False
          and isinstance(w.get('closedAtUtc'),str) and w['closedAtUtc'],'COORD_NOT_VERIFIED_CLOSED')
        h.timestamp(w['closedAtUtc']);h.need(isinstance(c.get('window_history',[]),list),'COORD_HISTORY_INVALID')
        return c

    def snapshot(self):
        h.check_lock_inodes();h.need(source_files()==self.sources,'SOURCE_FILES_CHANGED')
        rows=self.process_reader(self.cfg);validate_processes(self.cfg,rows)
        # Seven links are checked as exact identities; their full current META is fresh, never stale approval.
        for alias,target in self.cfg.extra_links:
            h.need(alias.is_symlink() and os.readlink(alias)==str(target)
                   and alias.resolve(strict=True)==h.no_symlink(target),'FIXED_SEVEN_LINK_IDENTITY_DRIFT')
        # Protect actual cwd configuration files, not dynamic logs or broad /opt trees.
        class InventoryConfig:
            def __getattr__(proxy,name): return getattr(self.cfg,name)
            @property
            def extra_protected(proxy):
                configs=set()
                for row in rows:
                    cwd=Path(row['cwd'])
                    configs.update(p for pattern in ('.env*','ecosystem*.config.*','package.json')
                                   for p in cwd.glob(pattern) if p.is_file())
                return self.cfg.extra_protected + tuple(sorted(configs))
        inv=h.inventory(InventoryConfig(),rows)
        # Preserve directory permissions too; omit only changing mtime/ctime/link count, which are lifecycle of creation.
        roots={self.cfg.front,self.cfg.public,self.cfg.nginx,self.cfg.path('/opt/config/dianzi51'),
               self.cfg.path('/opt/config/dianzi51-admin'),self.cfg.path('/var/lib')}
        roots.update(p for p in self.cfg.technical_directories if p.exists())
        roots.update(p.parent for role,p in self.cfg.technical_paths.items() if role!='technical-store' and p.parent.exists())
        roots.update(Path(r['script']).parent for r in rows)
        for alias,target in self.cfg.extra_links:
            if target.is_dir(): roots.add(target)
        for path in list(inv):
            p=Path(path)
            if p.parent.is_dir() and not p.parent.is_symlink(): roots.add(p.parent)
        dirs={str(p):{k:v for k,v in h.metadata(h.no_symlink(p)).items()
                     if k in ('statmode','uid','gid','dev','ino')} for p in sorted(roots)}
        return dict(processes=rows,servingRoots=h.serving_roots(self.cfg,rows),protectedFiles=inv,protectedDirectories=dirs)

    def capture(self):
        with h.locked(self.cfg):
            at=h.now();coord=h.regular(self.cfg.coord);self.coord_closed(coord)
            cr=h.describe(self.cfg.coord);first=self.snapshot()
            for host,path in [('51dianzi.com',self.cfg.html),('admin.51dianzi.com',self.cfg.public/'index.html')]:
                h.need(h.H(self.get_reader(host,''))==h.H(h.regular(path)),'HTTPS_ROOT_BINDING_FAILED')
            h.need(self.snapshot()==first and h.regular(self.cfg.coord)==coord and h.describe(self.cfg.coord)==cr,
                   'CAPTURE_CONCURRENT_DRIFT')
            targets={role:h.describe(path) for role,path in self.targets().items()}
            c=dict(schema='inline-capture-v1',ownerTask=s.OWNER,scope=s.SCOPE,capturedAtUtc=at,ttlSeconds=s.TTL,
                controllerSha256=self.controller_hash,sourceFiles=self.sources,coordSha256=h.H(coord),coordRecord=cr,
                coordBase64=base64.b64encode(coord).decode(),roots=self.roots(),targets=targets,
                absentPaths=[str(p) for p in (*self.cfg.technical_directories,*self.cfg.technical_paths.values())
                             if not p.exists() and not p.is_symlink()],
                fullMetaSha256=h.H(h.encode(first)),environmentValuesExported=False,productionWrites=0,**first)
            self.fresh(c);return c

    def targets(self):return {'front-api':self.cfg.api,'admin-api':self.cfg.admin_api,'main-html':self.cfg.html}
    def roots(self):return dict(front=str(self.cfg.front),admin=str(self.cfg.public),stage=str(self.cfg.stage),coord=str(self.cfg.coord))

    def no_replay(self):
        p=self.cfg.receipt
        if p.exists() or p.is_symlink():
            self.private(p);h.need(not any(p.iterdir()),'PERMANENT_ATTEMPT_OR_FAILURE_NO_REPLAY')

    def package_data(self,manifest_sha,review_sha=None):
        self.private(self.cfg.stage);self.private(self.cfg.package)
        mb=h.regular(self.cfg.package/'manifest.json');h.need(h.H(mb)==h.pin(manifest_sha),'MANIFEST_SHA_MISMATCH')
        m=exact(h.decode(mb),MANIFEST_KEYS,'MANIFEST')
        h.need(m['schema']=='inline-manifest-v1' and m['ownerTask']==s.OWNER and m['scope']==s.SCOPE
         and m['ttlSeconds']==s.TTL and m['sourceFiles']==self.sources and m['controllerSha256']==self.controller_hash
         and m['forbiddenBusinessChanges']==FORBIDDEN,'MANIFEST_FIXED_SCOPE_OR_SOURCE_MISMATCH')
        h.need(m['mutableTechnicalPath']==str(self.cfg.technical_paths['technical-store']) and
          m['sourceVerification']=={'method':'readonly-current-source-version-and-restart',
           'afterAllManagerReloadsBeforeFront':True,'againBeforeClose':True,'noStoreRepair':True},
           'FIXED_MUTABLE_STORE_REAL_SOURCE_SEQUENCE_REQUIRED')
        pf=m['packageFiles'];h.need(isinstance(pf,dict),'PACKAGE_FILES_REQUIRED')
        names=set();dirs=set()
        for base,children,files in os.walk(self.cfg.package,followlinks=False):
            for n in children+files:h.need(not (Path(base)/n).is_symlink(),'PACKAGE_SYMLINK_REFUSED')
            dirs.update((Path(base)/n).relative_to(self.cfg.package).as_posix() for n in children)
            names.update((Path(base)/n).relative_to(self.cfg.package).as_posix() for n in files)
        h.need(names==set(pf)|{'manifest.json'}|({'review.json'} if 'review.json' in names else set()),'EXACT_PACKAGE_CONTENTS_REQUIRED')
        expected_dirs={p.as_posix() for n in pf for p in Path(n).parents if p.as_posix()!='.'}
        h.need(dirs==expected_dirs,'EXACT_PACKAGE_DIRECTORIES_REQUIRED')
        data={}
        for n,digest in pf.items():
            h.relative(n);h.need(n=='capture.json' or n.startswith(('preimages/','postimages/','deltas/','assets/','leaves/','evidence/')),
                                'PACKAGE_NAMESPACE_REFUSED')
            data[n]=h.regular(self.cfg.package/n);h.need(h.H(data[n])==h.pin(digest),'PACKAGE_FILE_DRIFT')
        if self.cfg.fixture_root is None:
            h.need(s.SOURCE_VERIFIER_SHA is not None and s.SOURCE_VERIFIER_FILE in data
              and h.H(data[s.SOURCE_VERIFIER_FILE])==h.pin(s.SOURCE_VERIFIER_SHA),'FIXED_SOURCE_VERIFIER_PACKAGE_UNCONFIRMED_FAIL_CLOSED')
        h.need('capture.json' in data and any(n.startswith('evidence/') for n in data),'CAPTURE_AND_EVIDENCE_REQUIRED')
        c=h.decode(data['capture.json']);h.need(h.H(data['capture.json'])==h.pin(m['captureSha256']),'CAPTURE_SHA_MISMATCH')
        h.need(c['schema']=='inline-capture-v1' and c['ownerTask']==s.OWNER and c['scope']==s.SCOPE
         and c['sourceFiles']==self.sources and c['controllerSha256']==self.controller_hash and c['ttlSeconds']==s.TTL
         and c['roots']==self.roots(),'CAPTURE_FIXED_IDENTITY_MISMATCH')
        self.fresh(c);validate_processes(self.cfg,c['processes'])
        full={k:c[k] for k in ('processes','servingRoots','protectedFiles','protectedDirectories')}
        h.need(c['fullMetaSha256']==m['fullMetaSha256']==h.H(h.encode(full)),'FULL_META_SHA_MISMATCH')
        coord=b64(c['coordBase64']);h.need(h.H(coord)==c['coordSha256']==m['coordSha256'],'COORD_SHA_MISMATCH');self.coord_closed(coord)
        h.need(c['coordRecord']['sha256']==h.H(coord),'COORD_RECORD_MISMATCH')
        newdirs=m['newDirectories'];h.need(isinstance(newdirs,list),'NEW_DIRECTORIES_LIST_REQUIRED')
        expected_dirs=[str(p) for p in self.cfg.technical_directories if str(p) in c['absentPaths']]
        h.need([d.get('path') for d in newdirs]==expected_dirs,'ONLY_TWO_FIXED_ABSENT_PRIVATE_DIRECTORIES_REQUIRED')
        private_owner=(0,0) if self.cfg.fixture_root is None else (os.geteuid(),os.getegid())
        for d in newdirs:
            exact(d,{'path','mode','uid','gid'},'NEW_DIRECTORY')
            p=Path(d['path']);h.no_symlink(p)
            h.need(d['mode']==0o700 and (d['uid'],d['gid'])==private_owner and not p.exists(),
                   'FIXED_PRIVATE_DIRECTORY_ABSENCE_MODE_OWNER_REQUIRED')
        changes={};used={'capture.json'}|{n for n in data if n.startswith('evidence/')}
        ts=m['targets'];h.need(isinstance(ts,list) and 1<=len(ts)<=2,'ONE_OR_TWO_API_DELTAS_REQUIRED')
        for t in ts:
            exact(t,{'role','path','beforeFile','afterFile','deltaFile','beforeSha256','afterSha256'},'TARGET')
            role=t['role'];h.need(role in ('front-api','admin-api') and role not in changes
             and t['path']==str(self.targets()[role]),'FIXED_API_TARGET_REQUIRED')
            for key,prefix in [('beforeFile','preimages/'),('afterFile','postimages/'),('deltaFile','deltas/')]:
                h.need(t[key] in data and t[key].startswith(prefix),'TARGET_PAYLOAD_NAMESPACE_REQUIRED');used.add(t[key])
            before,after=data[t['beforeFile']],data[t['afterFile']]
            record=c['protectedFiles'].get(t['path']);h.need(record==c['targets'][role] and record['sha256']==t['beforeSha256']==h.H(before)
             and t['afterSha256']==h.H(after) and record['kind']=='file' and record['nlink']==1,'TARGET_FULL_PREIMAGE_BINDING')
            inverse=reversible_delta(before,after,h.decode(data[t['deltaFile']]),self.targets()[role])
            changes[role]=dict(path=self.targets()[role],before=before,after=after,inverse=inverse,record=record)
        h.need('admin-api' in changes and 'front-api' in changes,'MANAGER_SOURCE_HOOKS_AND_FRONT_API_REQUIRED')
        html=exact(m['html'],{'beforeFile','afterFile','beforeSha256','afterSha256','searchBefore','searchAfter','preloads'},'HTML')
        for k,prefix in [('beforeFile','preimages/'),('afterFile','postimages/')]:
            h.need(html[k] in data and html[k].startswith(prefix),'HTML_NAMESPACE_REQUIRED');used.add(html[k])
        before,after=data[html['beforeFile']],data[html['afterFile']]
        record=c['protectedFiles'].get(str(self.cfg.html))
        h.need(record==c['targets']['main-html'] and record['sha256']==html['beforeSha256']==h.H(before)
         and html['afterSha256']==h.H(after) and record['kind']=='file' and record['nlink']==1,'HTML_FULL_PREIMAGE_BINDING')
        newfiles=m['newFiles'];h.need(isinstance(newfiles,list) and len(newfiles)==7,'EXACT_THREE_JS_THREE_RUNTIME_STORE_REQUIRED')
        additions={};roles=[];js=set()
        for a in newfiles:
            exact(a,{'role','path','packageFile','sha256','size','mode','uid','gid'},'NEW_FILE')
            role,path,n=a['role'],Path(a['path']),a['packageFile'];h.need(n in data,'NEW_FILE_PAYLOAD_REQUIRED');used.add(n)
            h.need(type(a['size']) is int and a['size']==len(data[n]) and h.H(data[n])==h.pin(a['sha256'])
              and type(a['mode']) is int and type(a['uid']) is int and type(a['gid']) is int,'NEW_FILE_PINS_REQUIRED')
            h.need(str(path) not in additions and str(path) not in c['protectedFiles']
             and not path.exists() and not path.is_symlink(),'NEW_FILE_MUST_NOT_EXIST')
            h.no_symlink(path.parent)
            if path.parent.is_dir():
                parent=path.parent.stat();owner=(parent.st_uid,parent.st_gid)
            else:
                h.need(role=='technical-store' and str(path.parent) in expected_dirs,'NEW_LEAF_PARENT_MUST_PREEXIST')
                owner=private_owner
            h.need((a['uid'],a['gid'])==owner,'NEW_LEAF_PARENT_UID_GID_REQUIRED')
            if role=='js':
                h.need(path.parent==self.cfg.front/'assets' and n=='assets/'+path.name and path.suffix=='.js'
                 and re.fullmatch(r'[A-Za-z0-9_.-]+-[0-9a-f]{16,64}\.js',path.name)
                 and a['sha256'].startswith(re.search(r'-([0-9a-f]{16,64})\.js$',path.name).group(1))
                 and a['mode']==0o644,'NEW_HASHED_JS_ONLY');js.add('/assets/'+path.name)
            else:
                h.need(self.cfg.technical_ready,'TECHNICAL_PATH_SCOPE_UNCONFIRMED_FAIL_CLOSED')
                h.need(role in self.cfg.technical_paths and path==self.cfg.technical_paths[role]
                 and n.startswith('leaves/') and a['mode']==(0o600 if role=='technical-store' else 0o644),'FIXED_TECHNICAL_LEAF_ONLY')
                h.need(role not in roles,'DUPLICATE_TECH_LEAF');roles.append(role)
                if role=='technical-store':
                    # Candidate is real preparer output, not generated by this controller.
                    proof='evidence/store-source-verification.json'
                    h.need(proof in data,'REAL_STORE_SOURCE_VERIFICATION_EVIDENCE_REQUIRED')
                    technical_store(data[n],data[proof],self.cfg.fixture_root is not None)
            additions[str(path)]=dict(spec=a,data=data[n])
        h.need(len(js)==3 and set(roles)=={'front-runtime','admin-runtime','technical-helper','technical-store'},
               'EXACT_NEW_ROLE_SET_REQUIRED')
        old,new=html['searchBefore'],html['searchAfter']
        h.need(isinstance(old,str) and re.fullmatch(SELF_SEARCH_PATTERN,old)
         and new in js and old!=new,'ONLY_SELF_SEARCH_URL_REQUIRED')
        ob,nb=old.encode(),new.encode();h.need(before.count(ob)==14 and nb not in before,'UNIQUE_ORIGINAL_SEARCH_ALIAS_SET_REQUIRED')
        for occurrence in re.finditer(re.escape(ob),before):
            pos=occurrence.start();h.need(pos>0 and before[pos-1:pos] in (b'"',b"'")
             and before[pos+len(ob):pos+len(ob)+1]==before[pos-1:pos],'ENTIRE_QUOTED_SEARCH_REFERENCE_REQUIRED')
        h.need(str(self.cfg.front/old.lstrip('/')) in c['protectedFiles'],'OLD_SEARCH_ASSET_CAPTURE_REQUIRED')
        h.need(isinstance(html['preloads'],list) and len(html['preloads'])==3 and set(html['preloads'])==js
         and before.count(b'</head>')==1,'EXACT_THREE_MODULEPRELOADS_REQUIRED')
        preload=b''.join(('<link rel="modulepreload" href="'+url+'" />\n').encode() for url in html['preloads'])
        patched=before.replace(ob,nb).replace(b'</head>',preload+b'</head>')
        h.need(patched==after,'ONLY_SEARCH_AND_THREE_PRELOAD_HTML_DELTA_REQUIRED')
        changes['main-html']=dict(path=self.cfg.html,before=before,after=after,record=record)
        h.need('admin-api' in changes and 'front-api' in changes and 'admin-runtime' in roles,
               'MANAGER_SOURCE_HOOKS_AND_FRONT_API_REQUIRED')
        expected_reload=list(s.RELOAD_IDS)
        h.need(m['reloadIds']==expected_reload,'EXACT_CHANGED_API_RELOAD_SCOPE_REQUIRED')
        h.need(used==set(data),'UNUSED_OR_EXTRA_PACKAGE_PAYLOAD_REFUSED')
        if review_sha is not None:
            rb=h.regular(self.cfg.package/'review.json');h.need(h.H(rb)==h.pin(review_sha),'REVIEW_SHA_MISMATCH')
            rv=exact(h.decode(rb),REVIEW_KEYS,'REVIEW')
            h.need(rv['schema']=='inline-independent-review-v1' and rv['status']=='passed' and rv['independent'] is True
              and rv['releaseApproved'] is True and isinstance(rv['reviewer'],str) and bool(rv['reviewer'].strip()),'INDEPENDENT_REVIEW_REQUIRED')
            h.timestamp(rv['reviewedAtUtc'])
            h.need(rv['manifestSha256']==h.H(mb) and all(rv[k]==m[k] for k in
              ('ownerTask','scope','controllerSha256','sourceFiles','captureSha256','fullMetaSha256','coordSha256',
               'packageFiles','targets','html','newFiles','newDirectories','reloadIds','mutableTechnicalPath',
               'sourceVerification','forbiddenBusinessChanges')),'REVIEW_ALL_FILES_FULL_META_BINDING_REQUIRED')
        return dict(m=m,manifestSha=h.H(mb),data=data,capture=c,coord=coord,changes=changes,additions=additions,
                    newDirectories=newdirs,reviewSha=review_sha)

    def process_guard(self,before,current):
        validate_processes(self.cfg,current);old={r['id']:r for r in before}
        for row in current:
            baseline=old[row['id']];count=self.rolls.get(row['id'],0)
            if count:
                h.need(row['id'] in s.RELOAD_IDS and row['pid']==self.pids[row['id']] and row['pid']!=baseline['pid']
                 and row['restarts']==baseline['restarts']+count,'EXACT_OWN_RELOAD_PID_RESTART_REQUIRED')
                allowed={'pid','restarts','rawProcEnvironSha256'}
                h.need({k:v for k,v in row.items() if k not in allowed}=={k:v for k,v in baseline.items() if k not in allowed},
                       'OWN_RAW_STABLE_CONFIG_PERMISSION_DRIFT')
            else:h.need(row==baseline,'UNRELOADED_PROCESS_RAW_EXACT_DRIFT')

    def guard(self,b,owned_coord=None):
        self.fresh(b['capture']);snap=self.snapshot();self.process_guard(b['capture']['processes'],snap['processes'])
        expected=dict(b['capture']['protectedFiles']);expected.update(self.owned_records);expected.update(self.new_records)
        store=b['m']['mutableTechnicalPath']
        if self.mutable_store_enabled:
            h.need(not Path(store+'.lock').exists() and not Path(store+'.lock').is_symlink(),
                   'TECHNICAL_STORE_ACTIVE_OR_STALE_WRITE_LOCK_HOLD')
            current=snap['protectedFiles'].get(store);baseline=self.new_records.get(store)
            h.need(current is not None and baseline is not None and current['kind']=='file' and current['nlink']==1
              and all(current[k]==baseline[k] for k in ('statmode','uid','gid','dev')),'MUTABLE_STORE_PERMISSION_OR_LINK_DRIFT')
            # The only mutable exception is explicit. Content/source correctness is checked
            # by the mandatory independent real-source adapter, NOT by a rawhash self comparison.
            expected[store]=current
            if not self.store_observations or self.store_observations[-1]!=current:
                self.store_observations.append(copy.deepcopy(current))
        h.need(snap['protectedFiles']==expected,'FULL_INVENTORY_FULL_META_DRIFT')
        directories=dict(b['capture']['protectedDirectories']);directories.update(self.new_dir_records)
        h.need(snap['servingRoots']==b['capture']['servingRoots'] and snap['protectedDirectories']==directories,
               'ROOT_ALIAS_OR_DIRECTORY_PERMISSION_DRIFT')
        coord=b['coord'] if owned_coord is None else owned_coord
        h.need(h.regular(self.cfg.coord)==coord and h.describe(self.cfg.coord)==self.coord_record,'OWN_COORD_FULL_BYTES_META_LOST')
        for n,digest in b['m']['packageFiles'].items():h.need(h.H(h.regular(self.cfg.package/n))==digest,'PACKAGE_DRIFT_DURING_ATTEMPT')
        h.need(h.H(h.regular(self.cfg.package/'manifest.json'))==b['manifestSha'],'MANIFEST_DRIFT_DURING_ATTEMPT')
        if b['reviewSha'] is not None:h.need(h.H(h.regular(self.cfg.package/'review.json'))==b['reviewSha'],'REVIEW_DRIFT_DURING_ATTEMPT')
        return snap

    def preflight(self,package,manifest_sha):
        h.need(Path(package).absolute()==self.cfg.package,'FIXED_PACKAGE_PATH_REQUIRED')
        with h.locked(self.cfg):
            b=self.package_data(manifest_sha);self.no_replay();self.coord_record=b['capture']['coordRecord']
            self.guard(b);self.same_fs(b);self.guard(b)
            return dict(status='preflight-passed',productionWrites=0,reviewRequiredForApply=True,
                manifestSha256=b['manifestSha'],controllerSha256=self.controller_hash,reloadIds=b['m']['reloadIds'],
                technicalScopeReady=self.cfg.technical_ready,healthAdapterReady=self.health_reader is not unverified_health,
                realSourceVerifierReady=self.source_verifier is not unverified_source and
                  (self.source_verifier is not verified_source or s.SOURCE_VERIFIER_SHA is not None))

    def same_fs(self,b):
        dev=self.cfg.stage.stat().st_dev
        parents=[]
        for n in b['additions']:
            p=Path(n).parent
            while not p.exists():p=p.parent
            parents.append(p)
        h.need(all(p.stat().st_dev==dev for p in [self.cfg.coord,*[c['path'] for c in b['changes'].values()],
                  *parents]),'ATOMIC_SAME_FILESYSTEM_REQUIRED')

    def replace(self,path,before,after):
        def remember(record):
            self.owned_records[str(path)]=record
            h.need(record['sha256']==h.H(after),'OWN_POST_RENAME_BYTE_DRIFT')
        h.atomic_cas(path,before,after,self.cfg.stage,on_replace=remember,
                     expected_record=self.owned_records.get(str(path)))

    def coord_replace(self,before,after):
        def remember(record):
            self.coord_record=record;self.current_coord=after
            h.need(record['sha256']==h.H(after),'OWN_COORD_POST_RENAME_BYTE_DRIFT')
        h.atomic_cas(self.cfg.coord,before,after,self.cfg.stage,on_replace=remember,expected_record=self.coord_record)

    def reload_one(self,b,id_,owned):
        before=next(r for r in self.guard(b,owned)['processes'] if r['id']==id_)
        role='front-api' if id_ in s.FRONT_IDS else 'admin-api';sha=h.H(b['changes'][role]['after'])
        failure=None
        try:self.reload_adapter(self.cfg,id_,sha)
        except BaseException as exc:failure=exc
        # Never take RPC transport return as process/environment proof.
        current=self.process_reader(self.cfg);validate_processes(self.cfg,current)
        after=next(r for r in current if r['id']==id_)
        changed=after['pid']!=before['pid']
        self.events.append(dict(id=id_,beforePid=before['pid'],afterPid=after['pid'],
          beforeRestart=before['restarts'],afterRestart=after['restarts'],apiSha256=sha,
          beforeRawSha256=before['rawProcEnvironSha256'],afterRawSha256=after['rawProcEnvironSha256'],
          rawStableSha256=after['rawStableSha256'],transportPassed=failure is None,observedPidChange=changed))
        if changed:self.rolls[id_]=self.rolls.get(id_,0)+1;self.pids[id_]=after['pid']
        self.process_guard(b['capture']['processes'],current);self.guard(b,owned)
        h.need(changed,'RELOAD_NO_OBSERVED_PID_CHANGE')
        if failure is not None:raise failure
        h.need(self.retired_reader(self.cfg,before['pid']) is True,'RETIRED_OWN_PID_NOT_CONFIRMED_GONE')

    def verify_current_store(self,b,owned):
        self.guard(b,owned);path=Path(b['m']['mutableTechnicalPath'])
        record=h.describe(path);data=h.regular(path)
        proof=self.source_verifier(self.cfg,record['sha256'])
        h.need(isinstance(proof,bytes),'REAL_SOURCE_VERIFIER_EXACT_JSON_BYTES_REQUIRED')
        technical_store(data,proof,self.cfg.fixture_root is not None)
        h.need(h.describe(path)==record and h.regular(path)==data,'SOURCE_OR_STORE_CHANGED_DURING_REAL_VERIFY')
        self.guard(b,owned);self.verified_store_record=record
        return {'storeSha256':record['sha256'],'proofSha256':h.H(proof),'verifiedAtUtc':h.now()}

    def apply(self,package,manifest_sha,review_sha):
        h.need(Path(package).absolute()==self.cfg.package,'FIXED_PACKAGE_PATH_REQUIRED');h.pin(review_sha)
        h.need(self.health_reader is not unverified_health,'READONLY_HEALTH_ADAPTER_UNVERIFIED_FAIL_CLOSED')
        h.need(self.source_verifier is not unverified_source,'REAL_READONLY_SOURCE_REVISION_VERIFIER_UNVERIFIED_FAIL_CLOSED')
        h.need(self.source_verifier is not verified_source or s.SOURCE_VERIFIER_SHA is not None,
               'FIXED_SOURCE_VERIFIER_UNCONFIRMED_FAIL_CLOSED')
        with h.locked(self.cfg):
            b=self.package_data(manifest_sha,review_sha);self.no_replay();self.coord_record=b['capture']['coordRecord']
            self.current_coord=b['coord'];self.guard(b);self.same_fs(b)
            state=self.coord_closed(b['coord']);nonce=uuid.uuid4().hex
            window=dict(owner_task=s.OWNER,scope=s.SCOPE,nonce=nonce,status='open',needsOperatorRecovery=True,
             openedAtUtc=h.now(),manifestSha256=b['manifestSha'],reviewSha256=review_sha,
             controllerSha256=self.controller_hash,captureSha256=b['m']['captureSha256'],reloadScope=b['m']['reloadIds'])
            # Preserve ALL previous history and foreign flags. Only append our closed outcome once on success.
            opened=copy.deepcopy(state);opened['shared_release_active']=True;opened['window']=window
            # Preserve a prior current window even if an older tool omitted it from history.
            # Do not alter the existing history array to "repair" that foreign omission.
            window['previousWindow']=copy.deepcopy(state['window'])
            opened['updated_at']=h.now();owned=h.encode(opened)
            self.owned_records={};self.new_records={};self.new_dir_records={};self.rolls={};self.pids={};self.events=[]
            self.mutable_store_enabled=False;self.verified_store_record=None;self.store_observations=[];source_checks=[]
            if not self.cfg.receipt.exists():self.cfg.receipt.mkdir(mode=0o700);h.fsync_dir(self.cfg.stage)
            h.exclusive(self.cfg.receipt/'attempt.json',h.encode(dict(window,permanentNoReplay=True,sourceFiles=self.sources)))
            closed_bytes=None;prepared_receipt=None
            try:
                self.guard(b);self.coord_replace(b['coord'],owned);self.guard(b,owned)
                for d in b['newDirectories']:
                    self.guard(b,owned);p=h.no_symlink(Path(d['path']));p.mkdir(mode=0o700)
                    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                    try:os.fchown(fd,d['uid'],d['gid']);os.fchmod(fd,0o700);os.fsync(fd)
                    finally:os.close(fd)
                    h.fsync_dir(p.parent)
                    self.new_dir_records[str(p)]={k:v for k,v in h.metadata(p).items() if k in ('statmode','uid','gid','dev','ino')}
                    self.guard(b,owned)
                for path,a in b['additions'].items():
                    self.guard(b,owned);p=Path(path);sp=a['spec']
                    h.exclusive(p,a['data'],sp['mode'])
                    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
                    try:os.fchown(fd,sp['uid'],sp['gid']);os.fchmod(fd,sp['mode']);os.fsync(fd)
                    finally:os.close(fd)
                    h.fsync_dir(p.parent);record=h.describe(p)
                    h.need(record['sha256']==sp['sha256'] and record['nlink']==1,'NEW_LEAF_POSTIMAGE_OR_HARDLINK_DRIFT')
                    self.new_records[path]=record;self.guard(b,owned)
                for role in ('admin-api','front-api'):
                    if role not in b['changes']:continue
                    self.guard(b,owned);c=b['changes'][role];self.owned_records[str(c['path'])]=c['record']
                    self.replace(c['path'],c['before'],c['after'])
                    if role=='admin-api':self.mutable_store_enabled=True
                    self.guard(b,owned)
                    for id_ in b['m']['reloadIds']:
                        if (id_ in s.FRONT_IDS)==(role=='front-api'):self.reload_one(b,id_,owned)
                    if role=='admin-api':source_checks.append(self.verify_current_store(b,owned))
                c=b['changes']['main-html'];self.guard(b,owned);self.owned_records[str(c['path'])]=c['record']
                self.replace(c['path'],c['before'],c['after']);self.guard(b,owned)
                h.need(h.H(self.get_reader('51dianzi.com',''))==h.H(c['after']),'PUBLIC_MAIN_HTML_HASH_FAILED')
                admin_record=b['capture']['protectedFiles'][str(self.cfg.public/'index.html')]
                h.need(h.H(self.get_reader('admin.51dianzi.com',''))==admin_record['sha256'],'PROTECTED_ADMIN_HTML_HASH_FAILED')
                for a in b['additions'].values():
                    sp=a['spec']
                    if sp['role']=='js':h.need(h.H(self.get_reader('51dianzi.com','assets/'+Path(sp['path']).name))==sp['sha256'],'PUBLIC_ASSET_HASH_FAILED')
                sha_by_role={k:h.H(v['after']) for k,v in b['changes'].items() if k!='main-html'}
                h.need(self.health_reader(self.cfg,sha_by_role) is True,'READONLY_GET_HEALTH_FAILED')
                source_checks.append(self.verify_current_store(b,owned))
                final=self.guard(b,owned)
                h.need(h.describe(Path(b['m']['mutableTechnicalPath']))==self.verified_store_record,
                       'STORE_CHANGED_SINCE_FINAL_REAL_SOURCE_VERIFY')
                closed=dict(window,status='closed',outcome='verified',needsOperatorRecovery=False,closedAtUtc=h.now(),
                            processReloadEvents=copy.deepcopy(self.events))
                complete=copy.deepcopy(opened);complete['window']=closed;complete['shared_release_active']=False
                complete.setdefault('window_history',[]).append(copy.deepcopy(closed));complete['updated_at']=h.now()
                closed_bytes=h.encode(complete)
                prepared_receipt=dict(status='verified',ownerTask=s.OWNER,scope=s.SCOPE,nonce=nonce,
                 manifestSha256=b['manifestSha'],reviewSha256=review_sha,controllerSha256=self.controller_hash,
                 captureSha256=b['m']['captureSha256'],coordSha256=h.H(closed_bytes),
                 verificationRequiresClosedCoordSha256=True,processReloadEvents=self.events,processesAfter=final['processes'],
                 otherSixProcessesRawExact=True,unreloadedOwnSlotsRawExact=True,ownRawStableConfigPermissionsExact=True,
                 allImmutableOldNewInventoryProtected=True,mutableTechnicalPath=b['m']['mutableTechnicalPath'],
                 sourceVerificationEvents=source_checks,mutableStoreObservedRecords=self.store_observations,
                 adminHtmlWrites=0,databaseWrites=0,environmentWrites=0,
                 inversePreimagesRetained=True,automaticRollbackPerformed=False)
                # Durable prepared receipt before close; failure.json always supersedes it.
                h.exclusive(self.cfg.receipt/'receipt.json',h.encode(prepared_receipt));self.guard(b,owned)
                h.need(h.describe(Path(b['m']['mutableTechnicalPath']))==self.verified_store_record,
                       'STORE_CHANGED_BEFORE_CLOSE')
                self.coord_replace(owned,closed_bytes)
                h.need(h.regular(self.cfg.coord)==closed_bytes and h.describe(self.cfg.coord)==self.coord_record,
                       'CLOSED_COORD_CONFIRMATION_FAILED')
                return prepared_receipt
            except BaseException as exc:
                # No unverified automatic inverse reload. Keep hold; inverse complete bytes remain in pinned package.
                reopened=False
                if closed_bytes is not None and self.current_coord==closed_bytes:
                    try:self.coord_replace(closed_bytes,owned);reopened=True
                    except BaseException:pass
                status='recovery-required-owned-hold-no-retry'
                try:
                    observed=h.regular(self.cfg.coord)
                    ownership=observed==owned and h.describe(self.cfg.coord)==self.coord_record
                    coord_sha=h.H(observed)
                    if not ownership:status='recovery-required-coordination-ownership-unconfirmed'
                except BaseException:ownership=False;coord_sha=None
                failure=dict(status=status,ownerTask=s.OWNER,scope=s.SCOPE,nonce=nonce,manifestSha256=b['manifestSha'],
                 reviewSha256=review_sha,controllerSha256=self.controller_hash,captureSha256=b['m']['captureSha256'],
                 error=type(exc).__name__+(': '+str(exc) if isinstance(exc,h.ReleaseError) else ''),
                 needsOperatorRecovery=True,permanentNoReplay=True,ownedHoldConfirmed=ownership,
                 ownClosedWindowReopened=reopened,observedCoordSha256=coord_sha,assetsAndLeavesRetained=True,
                 inversePreimagesRetained=True,automaticRollbackPerformed=False,processReloadEvents=self.events,
                 databaseWrites=0,environmentWrites=0,adminHtmlWrites=0,failedAtUtc=h.now())
                try:h.exclusive(self.cfg.receipt/'failure.json',h.encode(failure))
                except BaseException:pass
                raise h.ReleaseError(status+': '+failure['error']) from exc


def main():
    p=argparse.ArgumentParser(description=__doc__)
    ops=p.add_mutually_exclusive_group(required=True)
    for name in ('capture','preflight','apply'):ops.add_argument('--'+name,action='store_true')
    p.add_argument('--controller-sha256',required=True);p.add_argument('--package')
    p.add_argument('--manifest-sha256');p.add_argument('--review-sha256')
    args=p.parse_args();c=Controller();h.need(args.controller_sha256==c.controller_hash,'EXPLICIT_SOURCE_BUNDLE_SHA_REQUIRED')
    if args.capture:
        h.need(not any((args.package,args.manifest_sha256,args.review_sha256)),'CAPTURE_NO_APPROVAL_ARGS')
        result=c.capture()
    else:
        h.need(args.package and args.manifest_sha256,'PACKAGE_AND_MANIFEST_PINS_REQUIRED')
        if args.apply:
            h.need(args.review_sha256,'INDEPENDENT_REVIEW_SHA_REQUIRED');result=c.apply(args.package,args.manifest_sha256,args.review_sha256)
        else:
            h.need(not args.review_sha256,'PREFLIGHT_NOT_APPROVAL');result=c.preflight(args.package,args.manifest_sha256)
    sys.stdout.buffer.write(h.encode(result))

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as exc:
        print('INLINE_RELEASE_ABORT: '+(str(exc) if isinstance(exc,h.ReleaseError) else type(exc).__name__),file=sys.stderr)
        sys.exit(1)
