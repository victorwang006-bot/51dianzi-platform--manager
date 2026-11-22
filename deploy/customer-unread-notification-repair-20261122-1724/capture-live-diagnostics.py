#!/usr/bin/env python3
import hashlib,json,re,sys
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/channel-ssh-lib')
import paramiko
W=Path(__file__).resolve().parent
source=Path('/home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationDiagnostics.ts').read_text()
sets={}
for name in ['PROCEDURES','MODULES','SOURCE_KINDS','METHODS','PHASES','OUTCOMES','TRPC_CODES','MYSQL_CODES','SQL_STATES','TRANSPORT_KINDS','TIMINGS','FENCE_CLASSES']:
 m=re.search(r'const '+name+r' = (?:new Set\()?\[([^\]]+)\]',source);assert m,name
 sets[name]=re.findall(r'"([A-Za-z0-9_.-]+)"',m.group(1))
code='''import json,os,re,stat,subprocess
allow=%r
rows=json.loads(subprocess.run(['pm2','jlist'],capture_output=True,check=True,timeout=25).stdout)
paths=sorted({r['pm2_env']['pm_out_log_path']for r in rows if r.get('name')=='dianzi51-admin'})
logs=[];records=[];discarded=0
assert paths==['/root/enterprise-shadow-20261017-r2/activation-restore-20261018/minimal-release/dianzi51-admin.out-191.log','/root/enterprise-shadow-20261017-r2/activation-restore-20261018/minimal-release/dianzi51-admin.out-192.log']
choices={'procedure':'PROCEDURES','module':'MODULES','sourceKind':'SOURCE_KINDS','method':'METHODS','phase':'PHASES','coreStage':'PHASES','outcome':'OUTCOMES'}
errorChoices={'trpcCode':'TRPC_CODES','mysqlCode':'MYSQL_CODES','sqlState':'SQL_STATES','kind':'TRANSPORT_KINDS','upstreamTrpcCode':'TRPC_CODES','fenceClass':'FENCE_CLASSES'}
def number(v,a,b):return type(v)in(int,float)and a<=v<=b
def sanitize(x):
 if type(x)is not dict or x.get('event')!='adminNewInformationDiagnostic':return None
 if not isinstance(x.get('traceId'),str)or re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',x['traceId'])is None:return None
 result={'event':'adminNewInformationDiagnostic','traceId':x['traceId']}
 for key,kind in choices.items():
  if x.get(key)not in allow[kind]:return None
  result[key]=x[key]
 if not number(x.get('durationMs'),0,3600000):return None
 result['durationMs']=x['durationMs']
 if type(x.get('entry'))is int and 0<=x['entry']<=96:result['entry']=x['entry']
 if type(x.get('truncated'))is bool:result['truncated']=x['truncated']
 if type(x.get('error'))is dict:
  e=x['error'];safe={}
  for key,kind in errorChoices.items():
   if e.get(key)in allow[kind]:safe[key]=e[key]
  if type(e.get('errno'))is int and 1<=e['errno']<=65535:safe['errno']=e['errno']
  if type(e.get('httpStatus'))is int and 100<=e['httpStatus']<=599:safe['httpStatus']=e['httpStatus']
  timing=e.get('timing')
  if type(timing)is str and timing in allow['TIMINGS']:safe['timing']=timing
  elif number(timing,0,3600000):safe['timing']=timing
  elif type(timing)is dict:
   stages={k:timing[k]for k in ('configMs','requestMs','decodeMs')if number(timing.get(k),0,3600000)}
   if stages:safe['timing']=stages
  result['error']=safe
 return result
for p in paths:
 assert os.path.realpath(p)==p
 try:fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 except FileNotFoundError:continue
 with os.fdopen(fd,'rb')as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode)
  f.seek(max(0,s.st_size-262144));tail=f.read(262144)
 logs.append({'path':p,'sampleBytes':len(tail)})
 for raw in tail.decode('utf-8','replace').splitlines():
  marker=raw.find('{"event":"adminNewInformationDiagnostic"')
  if marker<0:continue
  try:x=json.JSONDecoder().raw_decode(raw[marker:])[0]
  except ValueError:discarded+=1;continue
  safe=sanitize(x)
  if safe is not None:records.append(safe)
  else:discarded+=1
records=records[-600:]
print(json.dumps({'status':'READ_ONLY_SANITIZED_DIAGNOSTICS_SAMPLE','logs':logs,'records':records,'discardedRecords':discarded,'businessRequestsSent':0,'rawMessagesReturned':False}))
'''%sets
C=paramiko.SSHClient();C.load_host_keys('/home/ubuntu/work/channel-release-20261121-1837/known_hosts');C.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 C.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.secrets/channel-deploy-0.pem',allow_agent=False,look_for_keys=False,timeout=15,compress=True)
 i,o,e=C.exec_command("python3 - <<'PY'\n"+code+'\nPY\n',timeout=90);i.close();b=o.read();err=e.read();rc=o.channel.recv_exit_status();assert rc==0,'READ_ONLY_SAMPLE_FAILED'
 result=json.loads(b);(W/'live-diagnostics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 sales=[r for r in result['records']if r['module']=='sales'and r['outcome']in('error','temporary')]
 print(json.dumps({'status':result['status'],'records':len(result['records']),'salesFailureStageRecords':len(sales),'salesFailureTraces':len({r['traceId']for r in sales}),'businessRequestsSent':0,'rawMessagesReturned':False}))
finally:C.close();print('SSH_CLOSED')
