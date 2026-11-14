#!/usr/bin/env python3
"""Offline release-health contract tests; no network, database, process, or account IO."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
WORK = Path('/home/ubuntu/work/demand-personal-center')
DRIVER = ROOT / 'deploy/activate-demand-personal-20261114.py'
RELOAD = ROOT / 'deploy/reload-demand-personal-api-20261114.cjs'
spec = importlib.util.spec_from_file_location('driver', DRIVER)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

class Response:
    def __init__(self, status, body):
        self.status, self.body = status, body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return self.body

results = []
original = driver.urllib.request.urlopen
try:
    for name, process, status, payload, succeeds in [
        ('front real unauthorized accepted', 'dianzi51', 401, {'error': {'json': {'data': {'code': 'UNAUTHORIZED'}}}}, True),
        ('admin real forbidden accepted', 'dianzi51-admin', 403, {'error': {'json': {'data': {'code': 'FORBIDDEN'}}}}, True),
        ('old UA guard generic 403 never counts as registration', 'dianzi51', 403, {'error': 'Forbidden'}, False),
        ('missing route 404 rejected', 'dianzi51', 404, {'error': {'data': {'code': 'NOT_FOUND'}}}, False),
        ('anonymous success 200 rejected', 'dianzi51-admin', 200, {'result': {}}, False),
        ('server failure rejected', 'dianzi51', 500, {'error': {'data': {'code': 'UNAUTHORIZED'}}}, False),
        ('non-JSON auth response rejected', 'dianzi51', 401, None, False),
    ]:
        def fake(request, timeout, status=status, payload=payload):
            assert request.get_header('User-agent') == 'Mozilla/5.0'
            assert timeout == 30 and request.get_header('Accept') == 'application/json'
            assert request.get_header('Cookie') is None and request.get_header('Authorization') is None
            return Response(status, b'<!doctype html>' if payload is None else json.dumps(payload).encode())
        driver.urllib.request.urlopen = fake
        accepted = False
        try:
            driver.protected_api_health(process)
            accepted = True
        except (RuntimeError, json.JSONDecodeError):
            pass
        assert accepted == succeeds, name
        results.append({'name': name, 'status': 'PASS'})
finally:
    driver.urllib.request.urlopen = original

base = '54da35b3114d0b099b07946e65a46f4bf7328c63'
old = subprocess.check_output(['git', 'show', base + ':deploy/activate-demand-personal-20261114.py'], cwd=ROOT).decode()
expected = old.replace('/opt/ops/20261114-demand-personal-center-CKSZQ7s"', '/opt/ops/20261114-demand-personal-center-CKSZQ7s-r2"').replace(
    'headers={"Cache-Control": "no-cache", "Accept": "application/json"}',
    'headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache", "Accept": "application/json"}')
assert DRIVER.read_text() == expected
old_reload = subprocess.check_output(['git', 'show', base + ':deploy/reload-demand-personal-api-20261114.cjs'], cwd=ROOT).decode()
assert RELOAD.read_text() == old_reload.replace('/opt/ops/20261114-demand-personal-center-CKSZQ7s\'', '/opt/ops/20261114-demand-personal-center-CKSZQ7s-r2\'')
results.append({'name': 'only UA and new private attempt namespace changed; all lock/CAS/rollback/PM2 safeguards identical', 'status': 'PASS'})
report = {'status': 'PASS', 'passed': len(results), 'failed': 0, 'results': results,
          'driverSha256': hashlib.sha256(DRIVER.read_bytes()).hexdigest(),
          'reloadHelperSha256': hashlib.sha256(RELOAD.read_bytes()).hexdigest(),
          'actualNetworkIO': 0, 'productionRecordWrites': 0, 'protectionRequirementsRelaxed': False}
(WORK / 'retry-health-tests.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'passed': len(results), 'failed': 0}))
