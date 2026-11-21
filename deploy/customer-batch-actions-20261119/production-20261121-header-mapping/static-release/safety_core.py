"""Self-contained production primitives; never imports/executes legacy release.
Pure helper ancestry: R2 safe_helpers SHA recorded in README. File atime is exact;
reads require O_NOATIME (no fallback). Directory/alias atime is read telemetry only.
"""
import base64, copy, datetime as dt, fcntl, hashlib, json, os, re, stat, time, uuid
from pathlib import Path
class ReleaseError(RuntimeError):pass
class HoldRequired(ReleaseError):pass
def need(ok,msg):
    if not ok:raise ReleaseError(msg)
def H(b):return hashlib.sha256(b).hexdigest()
def encode(x):return (json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
def decode(b):
    def pairs(xs):
        d={}
        for k,v in xs:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
        return d
    try:return json.loads(b,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
    except (ValueError,UnicodeError):raise ReleaseError('INVALID_JSON') from None
def exact(x,keys,label):need(isinstance(x,dict) and set(x)==set(keys),'EXACT_FIELDS:'+label);return x
def pin(x):need(isinstance(x,str) and re.fullmatch('[0-9a-f]{64}',x),'FULL_SHA_REQUIRED');return x
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def timestamp(x):
    try:
        d=dt.datetime.fromisoformat(x);need(d.tzinfo is not None,'TIMEZONE_REQUIRED');return d.timestamp()
    except (ValueError,TypeError):raise ReleaseError('INVALID_TIMESTAMP') from None
def b64(b):return base64.b64encode(b).decode()
def unb64(s):
    try:return base64.b64decode(s,validate=True)
    except (ValueError,TypeError):raise ReleaseError('INVALID_BASE64') from None
def no_symlink(p):
    p=Path(p);need(p.is_absolute(),'ABSOLUTE_REQUIRED')
    for q in (p,*p.parents):need(not q.is_symlink(),'SYMLINK_REFUSED:'+str(q))
    return p
def metadata(p):
    return stat_metadata(Path(p).lstat())
def stat_metadata(st):
    d=dict(size=st.st_size,statmode=st.st_mode,uid=st.st_uid,gid=st.st_gid,dev=st.st_dev,ino=st.st_ino,nlink=st.st_nlink,atimeNs=st.st_atime_ns,mtimeNs=st.st_mtime_ns,ctimeNs=st.st_ctime_ns)
    if stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode):d.pop('atimeNs')
    return d
def regular(p,proc=False):
    p=no_symlink(p);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|(0 if proc else os.O_NOATIME))
    try:
        st=os.fstat(fd);need(stat.S_ISREG(st.st_mode),'REGULAR_REQUIRED:'+str(p))
        a=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_atime_ns)
        chunks=[]
        while True:
            c=os.read(fd,1024*1024)
            if not c:break
            chunks.append(c)
        st=os.fstat(fd);z=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_atime_ns)
        need(a==z or (proc and a[:5]==z[:5]),'READ_DRIFT:'+str(p));return b''.join(chunks)
    finally:os.close(fd)
def describe(p):
    p=Path(p);a=metadata(p);b=regular(p);need(metadata(p)==a,'RECORD_READ_DRIFT');return dict(a,kind='file',sha256=H(b))
def stable(d):return {k:d[k] for k in ('dev','ino','statmode','uid','gid','nlink')}
def fsync_dir(p):
    fd=os.open(no_symlink(p),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
class Locks:
    """Failurehold retains these descriptors. Never auto-unlock on uncertified error."""
    def __init__(self,cfg):self.cfg=cfg;self.handles=[]
    def acquire(self):
        try:
            for p in self.cfg.locks:
                need(not p.is_symlink(),'LOCK_FILE_SYMLINK')
                real=no_symlink(p.resolve(strict=True));fd=os.open(real,os.O_RDONLY|os.O_NOFOLLOW)
                try:
                    need(stat.S_ISREG(os.fstat(fd).st_mode),'LOCK_REGULAR_REQUIRED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BaseException:os.close(fd);raise
                self.handles.append((p,real,fd,os.fstat(fd)))
            self.check();return self
        except BaseException:self.release();raise
    def check(self):
        need(len(self.handles)==2,'TWO_CONTINUOUS_LOCKS_REQUIRED')
        for p,real,fd,old in self.handles:
            a=p.lstat();b=os.fstat(fd)
            need(not p.is_symlink() and p.resolve(strict=True)==real and (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)==(old.st_dev,old.st_ino),'LOCK_INODE_CHANGED')
    def release(self):
        for _,_,fd,_ in reversed(self.handles):fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
        self.handles=[]
    def hold(self,message):
        print('FAILUREHOLD manualRecoveryRequired; locks retained: '+message,flush=True)
        while True:
            try:time.sleep(30);self.check()
            except BaseException:print('FAILUREHOLD still retained; do not kill/unlock',flush=True)
class Writer:
    """Every change is one approved child delta, not a refreshed whole guard."""
    def __init__(self,cfg,locks,guard,hook=None):
        self.cfg=cfg;self.locks=locks;self.guard=guard;self.hook=hook or (lambda _:None);self.owned={};self.events=[]
    def tick(self,label):self.locks.check();self.hook(label)
    def allowed(self,p):
        p=no_symlink(p)
        need(p in (self.cfg.html,self.cfg.coord) or p.parent in (self.cfg.stage,self.cfg.assets),'WRITE_BOUNDARY')
        return p
    def parent_commit(self,p,old,start):
        end=time.time_ns();new=metadata(p.parent)
        need(stable(new)==stable(old),'PARENT_STABLE_DRIFT')
        # Linux filesystem current_time may use a coarse cached clock tick earlier
        # than userspace CLOCK_REALTIME. Explicit bounded 1-second lower window;
        # no target/file/fullmeta tolerance and no foreign sibling inventory waiver.
        lower=start-1000000000
        need(lower<=new['mtimeNs']<=end and lower<=new['ctimeNs']<=end and new['mtimeNs']>=old['mtimeNs'] and new['ctimeNs']>=old['ctimeNs'],'PARENT_CHANGE_OUTSIDE_OWN_WINDOW')
        self.guard.own_directory(p.parent,old,new)
        self.events.append({'path':str(p),'startNs':start,'filesystemLowerBoundNs':lower,'endNs':end,'parentBefore':old,'parentAfter':new,'record':metadata(p) if p.exists() else None})
    def created_record(self,p,fd,data):
        # Only our held creation FD proves identity; pathname bytes alone do not.
        before=stat_metadata(os.fstat(fd));need(stat.S_ISREG(before['statmode']),'CREATED_REGULAR_REQUIRED')
        os.lseek(fd,0,os.SEEK_SET);chunks=[]
        while True:
            chunk=os.read(fd,1024*1024)
            if not chunk:break
            chunks.append(chunk)
        need(stat_metadata(os.fstat(fd))==before,'CREATED_FD_READ_DRIFT')
        need(b''.join(chunks)==data and before['size']==len(data),'CREATED_REQUEST_BYTES_REQUIRED')
        record=dict(before,kind='file',sha256=H(data))
        need(describe(p)==record and stat_metadata(os.fstat(fd))==before,'CREATED_FD_PATH_REQUIRED')
        return record
    def exclusive(self,p,data,mode=0o600):
        data=bytes(data);p=self.allowed(p);self.guard.check();self.tick('before-ex:'+p.name)
        old=metadata(p.parent);start=time.time_ns();fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NOATIME,mode)
        try:
            os.fchmod(fd,mode)
            view=memoryview(data)
            while view:
                n=os.write(fd,view);need(n>0,'SHORT_WRITE');view=view[n:]
            record=self.created_record(p,fd,data);need(record['nlink']==1,'CREATED_SINGLE_LINK_REQUIRED')
            self.owned[str(p)]=record;self.guard.own_file(p,None,record)
            self.parent_commit(p,old,start);self.tick('after-write:'+p.name)
            self.tick('file-fsync:'+p.name);os.fsync(fd)
            self.tick('dir-fsync:'+p.name);fsync_dir(p.parent);self.guard.check()
        finally:os.close(fd)
        return self.owned[str(p)]
    def scratch(self,data,meta=None):
        p=self.cfg.stage/('.own-'+uuid.uuid4().hex)
        self.exclusive(p,data,stat.S_IMODE(meta['statmode']) if meta else 0o644)
        if meta:
            old=self.owned[str(p)];fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW|os.O_NOATIME)
            try:
                need(self.created_record(p,fd,data)==old,'SCRATCH_NOT_OWNED')
                os.fchown(fd,meta['uid'],meta['gid']);self.created_record(p,fd,data)
                os.fchmod(fd,stat.S_IMODE(meta['statmode']));self.created_record(p,fd,data)
                os.utime(fd,ns=(meta['atimeNs'],meta['mtimeNs']));os.fsync(fd)
                new=self.created_record(p,fd,data)
            finally:os.close(fd)
            self.guard.own_file(p,old,new);self.owned[str(p)]=new
        return p
    def remove_scratch(self,p):
        old=self.owned[str(p)];self.guard.check();need(describe(p)==old,'SCRATCH_NOT_OWNED')
        parent=metadata(p.parent);start=time.time_ns();os.unlink(p)
        self.guard.own_file(p,old,None);self.parent_commit(p,parent,start);self.owned.pop(str(p));fsync_dir(p.parent)
    def publish(self,p,data):
        p=self.allowed(p);need(p.parent==self.cfg.assets,'ASSET_PARENT_ONLY')
        tmp=self.scratch(data);self.guard.check();old=metadata(p.parent);start=time.time_ns()
        prepared=self.owned[str(tmp)]
        need(prepared['sha256']==H(data) and prepared['size']==len(data) and describe(tmp)==prepared,'PUBLISH_REQUEST_PREPARED_REQUIRED')
        self.tick('before-link:'+p.name);os.link(tmp,p,follow_symlinks=False)
        # link is O_EXCL semantics and atomically exposes already fsynced complete bytes.
        oldtmp=self.owned[str(tmp)];newtmp=describe(tmp);self.guard.own_file(tmp,oldtmp,newtmp);self.owned[str(tmp)]=newtmp
        published=describe(p)
        need(all(published[k]==prepared[k] for k in ('dev','ino','sha256','size','statmode','uid','gid','atimeNs','mtimeNs')) and published['nlink']==2,'PUBLISHED_PREPARED_OWN_INODE_REQUIRED')
        self.owned[str(p)]=published;self.guard.own_file(p,None,self.owned[str(p)]);self.parent_commit(p,old,start)
        self.tick('after-link:'+p.name);self.remove_scratch(tmp)
        oldrec=self.owned[str(p)];newrec=describe(p);self.guard.own_file(p,oldrec,newrec);self.owned[str(p)]=newrec
        self.tick('asset-dir-fsync:'+p.name);fsync_dir(p.parent);self.guard.check();return newrec
    def replace(self,p,before,after,expected,preserve=None,on_replace=None):
        p=self.allowed(p);self.guard.check();need(describe(p)==expected and regular(p)==before,'TARGET_FULL_META_CAS')
        need(p.stat().st_dev==self.cfg.stage.stat().st_dev,'SAME_FS_REQUIRED')
        tmp=self.scratch(after,preserve or expected);self.guard.check()
        need(describe(p)==expected and regular(p)==before,'LAST_TARGET_FULL_META_CAS');self.tick('before-replace:'+p.name)
        self.guard.check();parent=metadata(p.parent);stageparent=metadata(tmp.parent);start=time.time_ns()
        prepared=self.owned[str(tmp)]
        os.replace(tmp,p)
        # Witness MUST be the pre-pinned prepared inode, never an arbitrary postrename
        # foreign replacement even if bytes/mode happen to be identical.
        rec=describe(p)
        need(all(rec[k]==prepared[k] for k in ('dev','ino','sha256','size','statmode','uid','gid','nlink','atimeNs','mtimeNs')),'REPLACED_PREPARED_OWN_INODE_REQUIRED')
        self.owned[str(p)]=rec;self.guard.own_file(p,expected,rec)
        self.guard.own_file(tmp,self.owned[str(tmp)],None);self.owned.pop(str(tmp))
        self.parent_commit(p,parent,start);self.parent_commit(tmp,stageparent,start)
        if on_replace:on_replace(rec)
        self.tick('after-replace:'+p.name);self.tick('replace-dir-fsync:'+p.name);fsync_dir(p.parent)
        self.tick('replace-stage-fsync:'+p.name);fsync_dir(self.cfg.stage);self.guard.check();return rec
