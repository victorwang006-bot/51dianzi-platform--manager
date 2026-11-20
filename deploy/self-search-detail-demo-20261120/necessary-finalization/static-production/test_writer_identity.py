"""Local Writer regressions: original anonymous Fixture, real Locks/Guard/Writer.
No production paths, process transport, RPC, or release approval is exercised.
"""
import os, unittest
from pathlib import Path
from unittest.mock import patch
import safety_core as h
import adapters as a
from test_production import Fixture

REQUEST=b'APPROVED_REQUESTED_BYTES'
FOREIGN=b'FOREIGN_NOT_REQUESTED_BYTES'

class WriterIdentity(unittest.TestCase):
    def setUp(self):
        self.f=Fixture();self.foreign=self.f.root/'foreign-prepared'
        self.foreign.write_bytes(FOREIGN)
        self.capture=self.f.ctrl.capture();self.locks=h.Locks(self.f.cfg).acquire()
        # Writer uses the post-activation full-stage ledger, as Controller.apply does.
        self.f.ctrl.valid_capture(self.capture)
        self.f.adapter.include_stage=True
        self.guard=a.Guard(self.f.adapter,self.locks,self.f.adapter.snapshot(),
                           self.f.ctrl.src,lambda:self.f.ctrl.valid_capture(self.capture))
        self.writer=h.Writer(self.f.cfg,self.locks,self.guard)
    def tearDown(self):
        self.locks.release();self.f.close()
    def attack_write(self,operation,same=False,mutate=False,wrong_write=False):
        w=self.writer;target=[None];foreign_record=[None];created=[None];real=os.write
        if same:self.foreign.write_bytes(REQUEST)
        def write(fd,data):
            n=real(fd,b'X'*len(data) if wrong_write else data)
            if target[0] is None:
                target[0]=Path(os.readlink('/proc/self/fd/'+str(fd)))
                created[0]=os.fstat(fd).st_ino
                if mutate:os.pwrite(fd,b'X',0)
                elif not wrong_write:os.replace(self.foreign,target[0])
                foreign_record[0]=h.describe(target[0])
            return n
        with patch.object(h.os,'write',side_effect=write):
            with self.assertRaisesRegex(h.ReleaseError,'CREATED_'):operation()
        p=target[0];self.assertIsNotNone(p)
        self.assertNotIn(str(p),w.owned)
        self.assertEqual(h.describe(p),foreign_record[0])
        if not (mutate or wrong_write):self.assertNotEqual(h.metadata(p)['ino'],created[0])
        else:self.assertEqual(h.metadata(p)['ino'],created[0])
    def test_exclusive_foreign_inode_different_bytes_rejected(self):
        self.attack_write(lambda:self.writer.exclusive(self.f.cfg.stage/'attempt.json',REQUEST))
    def test_exclusive_foreign_inode_same_bytes_rejected(self):
        self.attack_write(lambda:self.writer.exclusive(self.f.cfg.stage/'attempt.json',REQUEST),same=True)
    def test_exclusive_same_inode_content_changed_rejected(self):
        self.attack_write(lambda:self.writer.exclusive(self.f.cfg.stage/'attempt.json',REQUEST),mutate=True)
    def test_exclusive_request_bytes_not_written_rejected(self):
        self.attack_write(lambda:self.writer.exclusive(self.f.cfg.stage/'attempt.json',REQUEST),wrong_write=True)
    def test_scratch_creation_foreign_inode_different_bytes_rejected(self):
        self.attack_write(lambda:self.writer.scratch(REQUEST))
    def test_scratch_creation_foreign_inode_same_bytes_rejected(self):
        self.attack_write(lambda:self.writer.scratch(REQUEST),same=True)
    def test_scratch_creation_same_inode_content_changed_rejected(self):
        self.attack_write(lambda:self.writer.scratch(REQUEST),mutate=True)
    def test_scratch_metadata_reopen_foreign_inode_not_modified_or_adopted(self):
        w=self.writer;real=os.open;target=[None];record=[None];old=[None]
        meta=h.describe(self.f.cfg.html)
        def opened(p,flags,*args,**kwargs):
            if Path(p).name.startswith('.own-') and flags & os.O_RDWR and not flags & os.O_CREAT:
                target[0]=Path(p);old[0]=w.owned[str(p)].copy()
                os.replace(self.foreign,p);record[0]=h.describe(p)
            return real(p,flags,*args,**kwargs)
        with patch.object(h.os,'open',side_effect=opened):
            with self.assertRaisesRegex(h.ReleaseError,'CREATED_|SCRATCH_NOT_OWNED'):w.scratch(REQUEST,meta)
        self.assertEqual(h.describe(target[0]),record[0]);self.assertEqual(w.owned[str(target[0])],old[0])
    def test_scratch_metadata_fd_path_foreign_inode_rejected(self):
        w=self.writer;real=os.fchown;target=[None];record=[None];old=[None]
        def chown(fd,uid,gid):
            result=real(fd,uid,gid);p=Path(os.readlink('/proc/self/fd/'+str(fd)))
            target[0]=p;old[0]=w.owned[str(p)].copy();os.replace(self.foreign,p);record[0]=h.describe(p)
            return result
        with patch.object(h.os,'fchown',side_effect=chown):
            with self.assertRaisesRegex(h.ReleaseError,'CREATED_'):w.scratch(REQUEST,h.describe(self.f.cfg.html))
        self.assertEqual(h.describe(target[0]),record[0]);self.assertEqual(w.owned[str(target[0])],old[0])
    def test_scratch_metadata_same_byte_foreign_inode_rejected(self):
        self.foreign.write_bytes(REQUEST)
        self.test_scratch_metadata_fd_path_foreign_inode_rejected()
    def test_scratch_metadata_same_inode_content_changed_rejected(self):
        w=self.writer;real=os.fchown;target=[None];record=[None];old=[None]
        def chown(fd,uid,gid):
            result=real(fd,uid,gid);p=Path(os.readlink('/proc/self/fd/'+str(fd)))
            target[0]=p;old[0]=w.owned[str(p)].copy();os.pwrite(fd,b'X',0);record[0]=h.describe(p)
            return result
        with patch.object(h.os,'fchown',side_effect=chown):
            with self.assertRaisesRegex(h.ReleaseError,'CREATED_REQUEST_BYTES_REQUIRED'):w.scratch(REQUEST,h.describe(self.f.cfg.html))
        self.assertEqual(h.describe(target[0]),record[0]);self.assertEqual(w.owned[str(target[0])],old[0])
    def test_publish_rejects_valid_owned_prepared_with_wrong_request_bytes(self):
        w=self.writer;real=w.scratch;p=self.f.cfg.assets/'new.js';saved=[]
        def wrong(data):
            tmp=real(FOREIGN);saved.append(tmp);return tmp
        with patch.object(w,'scratch',side_effect=wrong):
            with self.assertRaisesRegex(h.ReleaseError,'PUBLISH_REQUEST_PREPARED_REQUIRED'):w.publish(p,REQUEST)
        self.assertFalse(p.exists());self.assertEqual(h.regular(saved[0]),FOREIGN)
        self.assertEqual(w.owned[str(saved[0])],h.describe(saved[0]));self.guard.check()
    def test_exclusive_success_short_writes_and_empty_bytes(self):
        real=os.write
        with patch.object(h.os,'write',side_effect=lambda fd,data:real(fd,data[:3])):
            p=self.f.cfg.stage/'attempt.json';rec=self.writer.exclusive(p,REQUEST)
        self.assertEqual(rec,h.describe(p));self.assertEqual(h.regular(p),REQUEST)
        q=self.f.cfg.stage/'empty';self.assertEqual(self.writer.exclusive(q,b'')['sha256'],h.H(b''));self.guard.check()
    def test_scratch_metadata_success_and_remove(self):
        meta=h.describe(self.f.cfg.html);p=self.writer.scratch(REQUEST,meta);rec=h.describe(p)
        for key in ('uid','gid','statmode','atimeNs','mtimeNs'):self.assertEqual(rec[key],meta[key])
        self.assertEqual(h.regular(p),REQUEST);self.writer.remove_scratch(p);self.assertFalse(p.exists());self.guard.check()
    def test_publish_success_exact_requested_bytes(self):
        p=self.f.cfg.assets/'new.js';rec=self.writer.publish(p,REQUEST)
        self.assertEqual(h.regular(p),REQUEST);self.assertEqual(rec,h.describe(p));self.assertEqual(rec['nlink'],1)
        self.assertFalse(any(p.name.startswith('.own-') for p in self.f.cfg.stage.iterdir()));self.guard.check()

if __name__=='__main__':unittest.main(verbosity=2)
