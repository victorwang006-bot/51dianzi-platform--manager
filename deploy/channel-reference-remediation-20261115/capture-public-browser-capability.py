#!/usr/bin/env python3
"""Parent-run capability report only: versions, UID65534 access, robots.txt.
No browser page crawl, cache writes, proxy override, install or permission changes.
Import is inert: no subprocess, HTTP or cache access occurs outside main().
"""
import argparse, datetime, hashlib, json, os, pathlib, shutil, stat, subprocess, sys, urllib.request
ALLOWED_ROBOTS = {'https://www.lcsc.com/robots.txt','https://www.ickey.cn/robots.txt'}
def version(argv):
    try:
        r=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        return {'argv':argv,'exitCode':r.returncode,'stdout':r.stdout.decode('utf8','replace')[:4000],'stderr':r.stderr.decode('utf8','replace')[:4000]}
    except Exception as e: return {'argv':argv,'error':str(e)}
def metadata(p):
    p=pathlib.Path(p);out=[]
    for q in reversed([p,*p.parents]):
        try:
            s=q.lstat();out.append({'path':str(q),'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid,'symlink':q.is_symlink(),'resolved':str(q.resolve()) if q.is_symlink() else None})
        except OSError as e: out.append({'path':str(q),'error':str(e)})
    return out
def uid_access(p):
    # No Chrome session: access checks and --version only under the actual worker uid.
    if os.geteuid()!=0:
        return {'checked':False,'reason':'parent must run as root to drop UID/GID to 65534'}
    def drop(): os.setgroups([]);os.setgid(65534);os.setuid(65534)
    code='import json,os,pathlib,sys; p=pathlib.Path(sys.argv[1]); print(json.dumps({"uid":os.geteuid(),"gid":os.getegid(),"binaryReadable":os.access(p,os.R_OK),"binaryExecutable":os.access(p,os.X_OK),"parentsTraversable":all(os.access(x,os.X_OK) for x in p.parents)}))'
    r=subprocess.run([sys.executable,'-c',code,p],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,preexec_fn=drop)
    access={'checked':True,'exitCode':r.returncode,'stderr':r.stderr.decode('utf8','replace')[:2000]}
    if r.returncode==0: access.update(json.loads(r.stdout))
    try:
        v=subprocess.run([p,'--version'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,preexec_fn=drop)
        access['versionAs65534']={'exitCode':v.returncode,'stdout':v.stdout.decode('utf8','replace')[:4000],'stderr':v.stderr.decode('utf8','replace')[:4000]}
    except Exception as e: access['versionAs65534']={'error':str(e)}
    return access

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',action='append',default=[]);parser.add_argument('--robots-url',action='append',default=[]);a=parser.parse_args()
    if any(u not in ALLOWED_ROBOTS for u in a.robots_url): raise RuntimeError('ONLY_PUBLIC_SUPPLIER_ROBOTS_TXT_ALLOWED')
    binaries=a.binary or [p for n in ('chromium','chromium-browser','google-chrome','google-chrome-stable') if (p:=shutil.which(n))]
    if any(not pathlib.Path(p).is_absolute() for p in binaries): raise RuntimeError('ABSOLUTE_BINARY_REQUIRED')
    report={'contractVersion':'channel-remediation-public-browser-capability-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'executingUid':os.geteuid(),'versions':{'node':version(['node','--version']),'python':sys.version},'binaries':[],'robots':[],'businessWrites':0,'browserPagesOpened':0,'cacheWrites':0,'proxyBypass':False,'networkScope':'only explicitly requested allowlisted normal robots.txt GET; standard proxy environment respected'}
    for p in dict.fromkeys(binaries):
        report['binaries'].append({'binary':p,'pathPermissions':metadata(p),'version':version([p,'--version']),'uid65534Access':uid_access(p)})
    for u in dict.fromkeys(a.robots_url):
        try:
            # Standard urllib proxy behavior; forbid redirects to arbitrary page/network targets.
            class RobotsRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self,req,fp,code,msg,headers,newurl):
                    if newurl not in ALLOWED_ROBOTS: raise RuntimeError('ROBOTS_REDIRECT_OUTSIDE_ALLOWLIST')
                    return super().redirect_request(req,fp,code,msg,headers,newurl)
            opener=urllib.request.build_opener(RobotsRedirect())
            with opener.open(urllib.request.Request(u,headers={'User-Agent':'channel-reference-remediation-capability/1.0','Accept':'text/plain'}),timeout=20) as r:
                body=r.read(256001)
                if len(body)>256000: raise RuntimeError('ROBOTS_BODY_TOO_LARGE')
                report['robots'].append({'url':u,'finalUrl':r.geturl(),'status':r.status,'contentType':r.headers.get('Content-Type'),'bodySha256':hashlib.sha256(body).hexdigest(),'body':body.decode('utf8','replace')})
        except Exception as e: report['robots'].append({'url':u,'error':str(e)})
    print(json.dumps(report,indent=2))
if __name__=='__main__':
    try: main()
    except Exception as e: print('CAPABILITY_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
