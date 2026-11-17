#!/usr/bin/env python3
"""Local-only controller fault simulation. No SSH, PM2 or production filesystem access."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hotfix_controller', Path(__file__).with_name('controller.py'))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
sha = lambda b: hashlib.sha256(b).hexdigest()

class FaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.api = '/opt/releases/simulated/front/dist/index.js'
        self.html = '/opt/releases/simulated/admin/dist/public/index.html'
        self.add = '/opt/releases/simulated/front/runtime/new.' + sha(b'runtime')[:16] + '.runtime.mjs'
        self.virtual = {self.api: b'old-api', self.html: b'old-html'}
        self.events = []; self.reload_error = False; self.foreign_on_reload = False
        self.cas_drift = False
        (self.root / 'api').write_bytes(b'new-api'); (self.root / 'html').write_bytes(b'new-html')
        (self.root / 'runtime').write_bytes(b'runtime')
        manifest = dict(reloadNames=['dianzi51'], add=[dict(target=self.add, source='runtime', sha256=sha(b'runtime'))],
            replace=[dict(target=self.api, source='api', sha256=sha(b'new-api'), beforeSha256=sha(b'old-api'), kind='api'),
                dict(target=self.html, source='html', sha256=sha(b'new-html'), beforeSha256=sha(b'old-html'), kind='html')])
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        (self.root / 'protection.json').write_text('{}')
        c = mod.Controller(self.root); self.c = c
        c.validate = lambda audit=False: self.events.append(('audit', audit))
        c.check = lambda after=False: self.events.append(('check', after))
        c.health = lambda: self.events.append(('health', True))
        c.verify_served = lambda: self.events.append(('served', True))
        (self.root / 'preflight-result.json').write_text(json.dumps(dict(status='preflight-passed', manifestSha256=sha((self.root/'manifest.json').read_bytes()))))
        original_exists = Path.exists
        def exists(p):
            if str(p).startswith('/opt/releases/simulated/'):
                return str(p) in self.virtual or str(p).endswith('/runtime')
            return original_exists(p)
        def H(p):
            s = str(p)
            if self.cas_drift and s == self.api: return sha(b'foreign-api')
            return sha(self.virtual[s]) if s in self.virtual else sha(Path(p).read_bytes())
        def atomic(src, dest):
            b = self.virtual.get(str(src)) if str(src) in self.virtual else Path(src).read_bytes()
            if str(dest).startswith('/opt/releases/simulated/'):
                self.virtual[str(dest)] = b; self.events.append(('write', str(dest)))
            else: Path(dest).write_bytes(b)
        def run(args, timeout=90):
            self.events.append(('run', tuple(args)))
            if self.foreign_on_reload:
                self.virtual[self.api] = b'other-task-api'; self.foreign_on_reload = False
                raise RuntimeError('simulated reload failure with foreign drift')
            if self.reload_error:
                self.reload_error = False; raise RuntimeError('simulated reload failure')
            return b''
        self.patches = [patch.object(Path, 'exists', exists), patch.object(mod, 'H', H), patch.object(mod, 'atomic', atomic), patch.object(mod, 'run', run)]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()
    def test_api_reload_precedes_html_and_single_marker(self):
        r = self.c.apply(True); self.assertEqual(r['status'], 'applied')
        self.assertEqual(self.virtual[self.api], b'new-api'); self.assertEqual(self.virtual[self.html], b'new-html')
        reload_at = next(i for i,e in enumerate(self.events) if e[0] == 'run')
        html_at = self.events.index(('write', self.html)); self.assertLess(reload_at, html_at)
        with self.assertRaises(FileExistsError): self.c.apply(True)
    def test_unapproved_does_not_consume_attempt(self):
        with self.assertRaises(RuntimeError): self.c.apply(False)
        self.assertFalse((self.root/'apply-attempt.json').exists())
        self.assertEqual(self.virtual[self.api], b'old-api')
    def test_preflight_mismatch_stops_all_writes(self):
        (self.root/'preflight-result.json').write_text(json.dumps(dict(status='preflight-passed',manifestSha256='wrong')))
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertFalse(any(e[0]=='write' for e in self.events))
        self.assertEqual(json.loads((self.root/'apply-attempt.json').read_text())['status'], 'failed')
    def test_cas_drift_does_not_replace_foreign_api(self):
        self.cas_drift = True
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.virtual[self.api], b'old-api'); self.assertEqual(self.virtual[self.html], b'old-html')
    def test_reload_failure_restores_own_api_and_keeps_additions(self):
        self.reload_error = True
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.virtual[self.api], b'old-api'); self.assertEqual(self.virtual[self.html], b'old-html')
        self.assertEqual(self.virtual[self.add], b'runtime')
        result=json.loads((self.root/'apply-result.json').read_text())
        self.assertTrue(result['rollbackReloadHealthy']); self.assertTrue(result['retryForbidden'])
    def test_foreign_postwrite_api_never_overwritten_or_blindly_reloaded(self):
        self.foreign_on_reload = True
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.virtual[self.api], b'other-task-api')
        result=json.loads((self.root/'apply-result.json').read_text())
        self.assertEqual(result['foreignFilesNotTouched'], [self.api]); self.assertFalse(result['rollbackReloadHealthy'])
        self.assertEqual(len([e for e in self.events if e[0]=='run']),1)

if __name__ == '__main__': unittest.main()
