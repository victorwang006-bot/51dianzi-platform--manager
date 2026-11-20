#!/usr/bin/env python3
"""Run an allowlisted offline test file with a synthetic environment mapping.
No OS environment values are read by this runner; actual subprocess/RPC/HTTP
remain blocked or replaced by the original test harness. Does not invoke CLI.
"""
import os
import runpy
import sys
from pathlib import Path

os.environ = {'PATH': '/usr/bin:/bin', 'HOME': '/synthetic-offline-home'}
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parent.parent
name = sys.argv[1]
if name not in ('test_release.py', 'test_prepare_local.py', 'evidence/r8-finite-tests.py'):
    raise SystemExit('OFFLINE_TEST_ALLOWLIST_ONLY')
sys.argv = [str(root / name), *sys.argv[2:]]
runpy.run_path(root / name, run_name='__main__')
