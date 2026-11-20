import os, sys, json, stat, hashlib, subprocess, fcntl
from pathlib import Path

NODE='/usr/bin/node-22'
PM2='/usr/local/lib/node_modules/pm2'
LOCKS=('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
SHADOW=Path('/root/enterprise-shadow-20261017-r2')
FIELDS=('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns','st_nlink')
SOURCES={}


def H(b): return hashlib.sha256(b).hexdigest()
def encode(x): return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def meta(p): return {k:getattr(os.lstat(p),k) for k in FIELDS}
def regular(p):
    p=Path(p); before=meta(p)
    if not stat.S_ISREG(before['st_mode']): raise RuntimeError('NONREGULAR_SOURCE:'+str(p))
    fd=os.open(p,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|os.O_NOATIME)
    try:
        parts=[]
        while True:
            b=os.read(fd,1048576)
            if not b: break
            parts.append(b)
        if before!=meta(p): raise RuntimeError('SOURCE_DRIFT:'+str(p))
        b=b''.join(parts);return b,dict(before,sha256=H(b))
    finally: os.close(fd)
def pin(p):
    p=str(p); b,r=regular(p)
    if p in SOURCES and SOURCES[p]!=r:raise RuntimeError('SOURCE_CHANGED:'+p)
    SOURCES[p]=r;return r['sha256']
def procbytes(root,name):return (root/name).read_bytes()
def record(pid):
    root=Path('/proc')/str(pid);rawstat=procbytes(root,'stat');fields=rawstat.split(b') ',1)[1].split()
    rawenv=procbytes(root,'environ');cmd=procbytes(root,'cmdline');exe=os.readlink(root/'exe');cwd=os.readlink(root/'cwd')
    if exe.endswith(' (deleted)'):raise RuntimeError('DELETED_EXE')
    rec={'pid':pid,'parentPid':int(fields[1]),'startTicks':fields[19].decode(),'exe':exe,'cwd':cwd,'cmdlineSha256':H(cmd),'rawProcEnvironSha256':H(rawenv),'scriptPaths':[],'openPathFDs':{},'mappedExecutionFiles':{}}
    for x in cmd.split(b'\0'):
        if x.startswith(b'/') and x.endswith((b'.js',b'.mjs',b'.cjs')):
            p=os.fsdecode(x);pin(p);rec['scriptPaths'].append(p)
    rec['exeSha256']=pin(exe)
    for line in procbytes(root,'maps').splitlines():
        parts=line.split(None,5)
        if len(parts)==6 and parts[5].startswith(b'/'):
            p=os.fsdecode(parts[5])
            if p.endswith(' (deleted)'):raise RuntimeError('DELETED_MAPPING')
            rec['mappedExecutionFiles'][p]=pin(p)
    status=procbytes(root,'status');perms={}
    for line in status.splitlines():
        key,_,value=line.partition(b':')
        if key in (b'Uid',b'Gid',b'Groups',b'Umask'):perms[key.decode()]=value.decode().split()
    if set(perms)!={'Uid','Gid','Groups','Umask'}:raise RuntimeError('PROC_PERMISSIONS_REQUIRED')
    rec['permissions']=perms
    for q in sorted((root/'fd').iterdir(),key=lambda p:int(p.name)):
        target=os.readlink(q)
        if target.startswith('/'):
            st=q.stat();flags=procbytes(root,'fdinfo/'+q.name).split(b'flags:\t',1)[1].splitlines()[0].decode()
            rec['openPathFDs'][q.name]={'target':target,'st_dev':st.st_dev,'st_ino':st.st_ino,'st_mode':st.st_mode,'st_uid':st.st_uid,'st_gid':st.st_gid,'st_nlink':st.st_nlink,'flags':flags}
    if procbytes(root,'stat').split(b') ',1)[1].split()[19]!=fields[19] or procbytes(root,'environ')!=rawenv or procbytes(root,'cmdline')!=cmd or os.readlink(root/'exe')!=exe or os.readlink(root/'cwd')!=cwd:raise RuntimeError('PROCESS_READ_DRIFT')
    return rec

JS=r'''
const fs=require('fs'),Module=require('module'),crypto=require('crypto');
const q=JSON.parse(fs.readFileSync(0,'utf8')),seen=new Set(),orig=Module._load;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
Module._load=function(id,parent,isMain){const p=Module._resolveFilename(id,parent,isMain);if(!Module.builtinModules.includes(p)&&!p.startsWith('node:')){if(q.pins[p]!==H(fs.readFileSync(p)))throw Error('sourcepin');seen.add(p)}return orig.apply(this,arguments)};
let req,done=false;function fail(){if(done)return;done=true;process.stderr.write('EXISTING_RPC_PROBE_FAILED');process.exit(2)}
try{const mapped=[...new Set(fs.readFileSync('/proc/self/maps','utf8').trim().split('\n').map(l=>l.split(/\s+/).slice(5).join(' ')).filter(p=>p.startsWith('/')))].sort();
const axon=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon/index.js'),rpc=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc/index.js');
if(!fs.statSync('/root/.pm2/rpc.sock').isSocket())throw Error('socket');req=axon.socket('req');req.on('error',fail);req.connect('/root/.pm2/rpc.sock');new rpc.Client(req).call('getMonitorData',{},(err,rows)=>{if(err||!Array.isArray(rows))return fail();done=true;process.stdout.write(JSON.stringify({rows,closure:[...seen].sort(),nodeLoaderClosure:mapped}),()=>{req.close();process.exit(0)})});setTimeout(fail,12000)}catch(_){fail()}
'''


def main():
    payload=json.loads(sys.stdin.buffer.readline());locks=[]
    try:
        for p in LOCKS:
            fd=os.open(p,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BaseException:os.close(fd);raise
            locks.append(fd)
        if pin(NODE)!=payload['nodeSha256']:raise RuntimeError('NODE_PIN_MISMATCH')
        if os.environ.get('NODE_OPTIONS') or os.environ.get('NODE_PATH'):raise RuntimeError('PROBE_PARENT_LOADER_OPTIONS_PRESENT')
        rr=subprocess.run([NODE,'--no-addons','-e',JS],input=encode({'pins':payload['pm2Pins']}),stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'},timeout=16)
        if rr.returncode:raise RuntimeError('RPC_FAILED_NO_FALLBACK')
        rpc=json.loads(rr.stdout);rows=rpc['rows']
        if len(rows)!=12 or {r['pm_id'] for r in rows}!={0,190,191,192,193,194,200,201,202,203,204,205}:raise RuntimeError('EXACT_12_MAIN_PM2_IDS_REQUIRED')
        pm2=[]
        for r in rows:
            e=dict(r['pm2_env']);telemetry=e.pop('axm_monitor',None);pid=r['pid']
            top={k:v for k,v in r.items() if k not in ('monit','pm2_env')}
            if type(pid) is not int or pid<=0 or e.get('status')!='online':raise RuntimeError('PM2_ONLINE_IDENTITY_REQUIRED')
            pin(e['pm_exec_path'])
            pm2.append({'id':r['pm_id'],'pid':pid,'name':r['name'],'script':e['pm_exec_path'],'cwd':e['pm_cwd'],'configSha256':H(encode(e)),'applicationEnvSha256':H(encode(e.get('env',{}))),'identitySha256':H(encode(top)),'configFields':sorted(e),'telemetryFieldsObserved':['monit','pm2_env.axm_monitor'],'logPathFields':{k:v for k,v in e.items() if k in ('pm_out_log_path','pm_err_log_path','pm_log_path')},'proc':record(pid)})
        nodes={}
        for root in Path('/proc').iterdir():
            if not root.name.isdigit() or int(root.name)==os.getpid():continue
            try:exe=os.readlink(root/'exe');cmd=(root/'cmdline').read_bytes()
            except (FileNotFoundError,ProcessLookupError):continue
            if Path(exe.removesuffix(' (deleted)')).name.startswith('node') or cmd.startswith(b'PM2 '):nodes[root.name]=record(int(root.name))
        if not all(str(r['pid']) in nodes for r in pm2):raise RuntimeError('PM2_LIVE_ENUMERATION_MISMATCH')
        parents={}
        for rec in nodes.values():
            p=rec['parentPid'];seen=set()
            while p>1 and p not in seen:
                seen.add(p)
                if str(p) not in parents:parents[str(p)]=record(p)
                p=parents[str(p)]['parentPid']
        for p in rpc['nodeLoaderClosure']:pin(p)
        for p in rpc['closure']:
            if pin(p)!=payload['pm2Pins'][p]:raise RuntimeError('RPC_CLOSURE_PIN_MISMATCH')
        immediate={}
        for p in sorted(SHADOW.iterdir()):
            immediate[str(p)]=dict(meta(p),kind='dir' if p.is_dir() and not p.is_symlink() else 'link' if p.is_symlink() else 'file' if p.is_file() else 'special')
        coord='/opt/ops/51-project-release-coordination-20261027.json';pin(coord)
        out={'kind':'dynamic-readonly-runtime-probe-not-capture-not-approval','productionWrites':0,'pm2':sorted(pm2,key=lambda x:x['id']),'allLiveNodeAndPM2':nodes,'parentClosure':parents,'nodeLoaderClosure':rpc['nodeLoaderClosure'],'rpcExecutedClosure':rpc['closure'],'executionSourcePins':SOURCES,'shadowRoot':meta(SHADOW),'shadowImmediateChildren':immediate,'legacyRecommendationPidObservation':{'2060125Exists':Path('/proc/2060125').exists(),'2060126Exists':Path('/proc/2060126').exists()},'dynamicDiscoveryNoPidGuess':True,'rawEnvironmentValuesExported':False,'lifecycleFieldsStripped':False}
        print(json.dumps(out,sort_keys=True,separators=(',',':')))
    finally:
        for fd in reversed(locks):fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)


if __name__=='__main__':main()
