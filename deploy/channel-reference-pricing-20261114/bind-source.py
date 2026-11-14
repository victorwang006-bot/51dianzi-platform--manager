#!/usr/bin/env python3
"""Metadata binding only; no Git, HTTP, reload, DB or account operations."""
import argparse
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import re
import types

ROOT = Path('/opt/ops/20261114-channel-reference-pricing-CKSZQ7s')
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK = 'CKSZQ7sVc7tADM21c3LWpu'
LOCK_PATHS = ('/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock')


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def require(value, message):
    if not value:
        raise RuntimeError(message)


def load_driver(manifest):
    driver_path = ROOT / 'activate-channel-reference-pricing.py'
    driver_bytes = driver_path.read_bytes()
    require(hashlib.sha256(driver_bytes).hexdigest() == manifest['driverSha256'], 'DRIVER_DRIFT')
    driver = types.ModuleType('verified_navigation_channel_reference_driver')
    driver.__file__ = str(driver_path)
    exec(compile(driver_bytes, str(driver_path), 'exec'), driver.__dict__)
    return driver


def validate_request(request, manifest):
    require(request['ownerTask'] == manifest['ownerTask'] == TASK, 'SOURCE_OWNER_CHANGED')
    require(re.fullmatch('[0-9a-f]{40}', request['gitCommit']) and re.fullmatch('[0-9a-f]{40}', request['sourceCommit']), 'INVALID_GIT_COMMIT')
    require(request['githubMainVerified'] is True and request['gitCurrentAllNewGraphVerified'] is True, 'GIT_CURRENT_GRAPH_NOT_VERIFIED')
    require(request['sourceHashes'] == request['sourceHashSnapshot'] == manifest['sourceHashes'] == manifest['sourceHashSnapshot'], 'GIT_SOURCE_PINS_NOT_VERIFIED')
    require(request['newSourceGraphPaths'] == manifest['newSourceGraphPaths'] and request['priorSourceHashes'] == manifest['priorSourceHashes'], 'GIT_GRAPH_UNION_MISMATCH')
    require(request['standaloneHelpers'] == manifest['standaloneHelpers'] == manifest['runtimeHelpers']
        and request['snapshotBinding'] == manifest['snapshotBinding'], 'RUNTIME_HELPER_METADATA_MISMATCH')
    require(request['manifestSha256'] == sha(ROOT / 'manifest.json') and request['driverSha256'] == manifest['driverSha256'], 'MANIFEST_BOUND_METADATA_REQUIRED')


def verify_runtime(request, manifest, driver):
    driver.validate_manifest(manifest)  # every source pin/helper/binary SHA before daemon snapshot
    verified = json.loads((ROOT / 'verified.json').read_text())
    state = json.loads(COORD.read_text())
    started = json.loads((ROOT / 'activation-started.json').read_text())
    require(state.get('shared_release_active') is False and state.get('window', {}).get('owner_task') == TASK
        and state['window'].get('task') == TASK and state['window'].get('status') == 'verified'
        and state['window'].get('openedAtUtc') == started.get('openedAtUtc') and started.get('ownerTask') == TASK and started.get('attemptId') == state['window'].get('attemptId')
        and verified.get('attemptId') == started.get('attemptId'), 'VERIFIED_WINDOW_REQUIRED')
    require(verified['status'] == 'verified' and verified['standaloneHelpers'] == manifest['standaloneHelpers']
        and verified['snapshotBinding'] == manifest['snapshotBinding'] and verified['runtimeHelperHashesVerified'] is True
        and verified['sourceHashSnapshot'] == manifest['sourceHashSnapshot'], 'ACTIVATION_BOUND_METADATA_REQUIRED')
    require(verified['manifestSha256'] == started['manifestSha256'] == request['manifestSha256']
        and verified['driverSha256'] == manifest['driverSha256'], 'ACTIVATION_MANIFEST_BINDING_REQUIRED')
    for item in manifest['files']:
        require(sha(driver.inside(PUBLIC, item['relative'], regular=True)) == item['sha256'], 'STATIC_RUNTIME_DRIFT')
    for item in manifest['backendFiles']:
        require(sha(item['path']) == item['sha256'], 'ADMIN_API_RUNTIME_DRIFT')
    driver.verify_frozen(manifest)
    driver.verify_helpers(manifest)
    for relative, expected in request['sourceHashes'].items():
        require(sha(driver.inside(ROOT / 'source-snapshot', relative, regular=True)) == expected, 'ECS_GIT_SOURCE_SNAPSHOT_MISMATCH')
    processes = driver.processes()
    driver.compatible(json.loads((ROOT / 'process-before.json').read_text()), processes)
    require(len(processes) == 12 and all(row['status'] == 'online' and row['pid'] > 0 for row in processes), 'PROCESS_LIVENESS_NOT_CONFIRMED')
    return verified, state, processes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request-sha256', required=True)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(sum((args.verify_only, args.plan, args.apply)) <= 1, 'ONE_ACTION_REQUIRED')
    args.verify_only = not args.apply
    request_file = ROOT / 'git-source-request.json'
    require(re.fullmatch('[0-9a-f]{64}', args.request_sha256) and sha(request_file) == args.request_sha256, 'SOURCE_REQUEST_CHANGED')
    request = json.loads(request_file.read_text())
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    validate_request(request, manifest)
    driver = load_driver(manifest)
    locks = []
    try:
        if not args.verify_only:
            for file in LOCK_PATHS:
                lock = open(file, 'a+')
                locks.append(lock)
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        coord_sha = sha(COORD)
        driver.COORD_PIN = coord_sha
        verified, state, processes = verify_runtime(request, manifest, driver)
        require(sha(COORD) == coord_sha and sha(ROOT / 'manifest.json') == request['manifestSha256']
            and sha(request_file) == args.request_sha256, 'SOURCE_COORDINATION_BYTE_CAS_FAILED')
        receipt = {
            'status': 'VERIFIED_GITHUB_ECS_SOURCE_MATCH', 'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'deployedAtUtc': verified['atUtc'], 'gitCommit': request['gitCommit'], 'sourceCommit': request['sourceCommit'],
            'allGitSourcePinsMatchRuntimeManifest': True, 'gitCurrentAllNewGraphVerified': True,
            'ecsSourceSnapshotHashesVerified': True, 'sourceHashes': request['sourceHashes'],
            'sourceHashSnapshot': request['sourceHashSnapshot'], 'sourceFiles': len(request['sourceHashes']),
            'newSourceGraphPaths': request['newSourceGraphPaths'], 'priorSourceHashes': request['priorSourceHashes'],
            'manifestSha256': request['manifestSha256'], 'driverSha256': manifest['driverSha256'],
            'standaloneHelpers': manifest['standaloneHelpers'], 'runtimeHelperHashesVerified': True,
            'snapshotBinding': manifest['snapshotBinding'], 'snapshotNotGitPrivateInventory': True,
            'htmlSha256': next(item['sha256'] for item in manifest['files'] if item['relative'] == 'index.html'),
            'adminApiSha256': manifest['backendFiles'][0]['sha256'], 'frontApiSha256': manifest['untouchedFrontApiSha256'],
            'publicAssetsAndOldAssetsVerified': True, 'protectedFilesUnchanged': True,
            'originalFrontPIDsAndWorkersUnchanged': True, 'processes': processes, 'allOnline': True,
            'sharedReleaseActive': False, 'rollingReloadInstances': 2, 'frontReloadInstances': 0,
            'productionRecordWrites': 0, 'databaseMigrations': 0, 'loggedInBrowserAcceptancePerformed': False,
        }
        if args.verify_only:
            print(json.dumps({**receipt, 'verifyOnly': True, 'metadataWrites': 0}))
            return
        latest = json.loads(COORD.read_text())
        require(sha(COORD) == coord_sha and latest == state and sha(request_file) == args.request_sha256, 'SOURCE_BIND_CAS_FAILED')
        driver.save(ROOT / 'git-source-receipt.json', receipt)
        latest = json.loads(COORD.read_text())
        require(sha(COORD) == coord_sha and latest == state, 'SOURCE_COORDINATION_CAS_FAILED')
        state['window'].update(gitCommit=request['gitCommit'], sourceCommit=request['sourceCommit'], gitSourceReceipt=str(ROOT / 'git-source-receipt.json'))
        driver.save_coord(state)
        print(json.dumps({'status': receipt['status'], 'gitCommit': receipt['gitCommit'], 'sourceFiles': receipt['sourceFiles'], 'atUtc': receipt['atUtc'], 'sharedReleaseActive': False}))
    finally:
        for lock in reversed(locks):
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()


if __name__ == '__main__':
    main()
