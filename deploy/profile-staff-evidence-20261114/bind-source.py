#!/usr/bin/env python3
"""Server-only verified metadata binding; no runtime reload, DB or account operations."""
import argparse
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import re
import types

ROOT = Path('/opt/ops/20261114-profile-staff-CKSZQ7s')
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK = 'CKSZQ7sVc7tADM21c3LWpu'

def sha(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def require(value, message):
    if not value: raise RuntimeError(message)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--request-sha256', required=True); args = parser.parse_args()
    request_file = ROOT / 'git-source-request.json'
    require(sha(request_file) == args.request_sha256, 'SOURCE_REQUEST_CHANGED')
    request = json.loads(request_file.read_text()); manifest = json.loads((ROOT / 'manifest.json').read_text())
    require(request['ownerTask'] == manifest['ownerTask'] == TASK, 'SOURCE_OWNER_CHANGED')
    require(re.fullmatch('[0-9a-f]{40}', request['gitCommit']) and re.fullmatch('[0-9a-f]{40}', request['sourceCommit']), 'INVALID_GIT_COMMIT')
    require(request['githubMainVerified'] is True and request['sourceHashes'] == manifest['sourceHashes'], 'GIT_SOURCE_PINS_NOT_VERIFIED')
    locks = []
    try:
        for file in ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']:
            lock = open(file, 'a+'); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(lock)
        state = json.loads(COORD.read_text()); verified = json.loads((ROOT / 'verified.json').read_text())
        require(not state['shared_release_active'] and state['window']['owner_task'] == TASK and state['window']['status'] == 'verified', 'VERIFIED_WINDOW_REQUIRED')
        require(verified['status'] == 'verified', 'ACTIVATION_NOT_VERIFIED')
        driver_path = ROOT / 'activate-profile-staff-20261114.py'
        driver_bytes = driver_path.read_bytes()
        require(hashlib.sha256(driver_bytes).hexdigest() == manifest['driverSha256'], 'DRIVER_DRIFT')
        driver = types.ModuleType('verified_profile_staff_driver'); driver.__file__ = str(driver_path)
        exec(compile(driver_bytes, str(driver_path), 'exec'), driver.__dict__)
        for item in manifest['files']: require(sha(PUBLIC / item['relative']) == item['sha256'], 'STATIC_RUNTIME_DRIFT')
        for item in manifest['backendFiles']: require(sha(item['path']) == item['sha256'], 'ADMIN_API_RUNTIME_DRIFT')
        for item in manifest['protectedFiles']: require(sha(item['path']) == item['sha256'], 'PROTECTED_RUNTIME_DRIFT')
        for item in manifest['baselineAssets']: require(sha(PUBLIC / item['relative']) == item['sha256'], 'OLD_ASSET_DRIFT')
        for relative, expected in request['sourceHashes'].items():
            file = Path(relative); require(not file.is_absolute() and '..' not in file.parts and file.parts[0] in ['client', 'server', 'shared'], 'UNSAFE_SOURCE_PATH')
            require(sha(ROOT / 'source-snapshot' / file) == expected, 'ECS_GIT_SOURCE_SNAPSHOT_MISMATCH')
        processes = driver.processes(); driver.compatible(json.loads((ROOT / 'process-before.json').read_text()), processes)
        require(len(processes) == 12 and all(row['status'] == 'online' and row['pid'] > 0 for row in processes), 'PROCESS_LIVENESS_NOT_CONFIRMED')
        html = next(item['sha256'] for item in manifest['files'] if item['relative'] == 'index.html')
        receipt = {'status': 'VERIFIED_GITHUB_ECS_SOURCE_MATCH', 'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'deployedAtUtc': verified['atUtc'], 'gitCommit': request['gitCommit'], 'sourceCommit': request['sourceCommit'], 'allGitSourcePinsMatchRuntimeManifest': True, 'ecsSourceSnapshotHashesVerified': True, 'sourceHashes': request['sourceHashes'], 'sourceFiles': len(request['sourceHashes']), 'htmlSha256': html, 'adminApiSha256': manifest['backendFiles'][0]['sha256'], 'frontApiSha256': manifest['untouchedFrontApiSha256'], 'publicAssetsAndOldAssetsVerified': True, 'protectedFilesUnchanged': True, 'originalFrontPIDsAndWorkersUnchanged': True, 'processes': processes, 'allOnline': True, 'sharedReleaseActive': False, 'rollingReloadInstances': 2, 'frontReloadInstances': 0, 'productionRecordWrites': 0, 'databaseMigrations': 0, 'loggedInBrowserAcceptancePerformed': False}
        driver.save(ROOT / 'git-source-receipt.json', receipt)
        state['window'].update(gitCommit=request['gitCommit'], sourceCommit=request['sourceCommit'], gitSourceReceipt=str(ROOT / 'git-source-receipt.json'))
        driver.save(COORD, state)
        print(json.dumps({'status': receipt['status'], 'gitCommit': receipt['gitCommit'], 'sourceFiles': receipt['sourceFiles'], 'atUtc': receipt['atUtc'], 'sharedReleaseActive': False}))
    finally:
        for lock in reversed(locks): fcntl.flock(lock, fcntl.LOCK_UN); lock.close()

if __name__ == '__main__': main()
