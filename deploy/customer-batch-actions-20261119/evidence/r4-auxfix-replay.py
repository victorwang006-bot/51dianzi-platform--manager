#!/usr/bin/env python3
"""Pure TemporaryDirectory/mock replay of observed-phase gaps, no real proc/CLI."""
import importlib.util
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).absolute().parent.parent
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True
import test_release as tests
CURRENT = tests.r
spec = importlib.util.spec_from_file_location('auxfix_baseline_52908c', ROOT/'evidence/r4-auxfix-baseline-52908c/release.py')
BASELINE = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = BASELINE
spec.loader.exec_module(BASELINE)


def replay(module, kind, field=None, stage=None):
    tests.r = module
    case = tests.R4ExternalTests('test_fixed_two_nonpm2_identities_whole_opaque_hashes_and_full_file_meta')
    case.setUp()
    try:
        r = module
        parent = case.cfg.proc/'2060125'
        parentcwd = case.root/'external-parent-cwd'
        real_pair, real_source = r.external_protection_sample, r.external_source
        real_describe, real_read = r.describe, Path.read_bytes
        before_cwd = real_describe(parentcwd)
        state = dict(pair=0, sourceReads=0, parentCmdReads=0, drift=False)

        def pair(*args):
            state['pair'] += 1
            state['sourceReads'] = 0
            return real_pair(*args)

        def source(path):
            value = real_source(path)
            state['sourceReads'] += 1
            if kind == 'pair' and stage == 'source' and state['pair'] == 2 and state['sourceReads'] == 4:
                state['drift'] = True
            return value

        def describe(path):
            value = real_describe(path)
            if kind == 'pair' and stage == 'root' and state['pair'] == 2 and state['sourceReads'] == 4 and Path(path) == case.fixture['cwd']:
                state['drift'] = True
            if kind == 'cwd' and Path(path) == parentcwd and state['drift']:
                value = dict(value, mtimeNs=value['mtimeNs'] + 1, ctimeNs=value['ctimeNs'] + 1)
            return value

        def read(path):
            data = real_read(path)
            if path == parent/'cmdline':
                state['parentCmdReads'] += 1
                if kind == 'cwd' and state['pair'] == 2:
                    state['drift'] = True
            if kind == 'pair' and state['drift']:
                if field == 'startTicks' and path == parent/'stat':
                    data = tests.r4_stat(2060125, 1234, 51002, 'flock')
                elif field == 'rawenv' and path == parent/'environ':
                    data = data.replace(b'NODE_UNIQUE_ID=17', b'NODE_UNIQUE_ID=19')
                elif field == 'cmdline' and path == parent/'cmdline':
                    data = data.replace(b'parent-arg', b'parent-drift')
                elif field == 'permissions' and path == parent/'status':
                    data = data.replace(b'0022', b'0077')
            return data

        with patch.object(r, 'external_protection_sample', side_effect=pair), \
             patch.object(r, 'external_source', side_effect=source), \
             patch.object(r, 'describe', side_effect=describe), patch.object(Path, 'read_bytes', read):
            record, error = None, None
            try:
                record = r.external_protection(case.cfg, case.fixture)
            except r.ReleaseError as exc:
                error = str(exc)
            # Freeze phase counts before diagnostic live reads; those reads are
            # not part of the collector or production evidence.
            phase_state = dict(state)
            live_cwd = describe(parentcwd)
            live_parent = r.external_proc_sample(case.cfg, 2060125, 'flock')
            out = dict(kind=kind, stage=stage, field=field, collectorReturned=record is not None,
                       error=error, stateAtCollectorReturn=phase_state,
                       storedParentEqualsLiveAtReturn=None if record is None else record['processes'][0] == live_parent,
                       completeProcSamplerExecuted=True, temporaryFixtureOnly=True,
                       productionTimingExperiment=False, atomicGuarantee=False)
            if kind == 'cwd':
                out['storedParentCwdTimeMatchesBefore'] = None if record is None else all(
                    record['processes'][0]['cwdMeta'][k] == before_cwd[k] for k in ('mtimeNs', 'ctimeNs'))
                out['liveParentCwdTimeDiffersFromBefore'] = all(live_cwd[k] != before_cwd[k] for k in ('mtimeNs', 'ctimeNs'))
            expected_error = 'EXTERNAL_PROC_IDENTITY_READ_RACE' if kind == 'cwd' else 'EXTERNAL_PROC_PAIR_READ_RACE'
            if module is BASELINE:
                assert record is not None and error is None and out['storedParentEqualsLiveAtReturn'] is False
            else:
                assert record is None and error == expected_error
            assert phase_state['pair'] == 2 and phase_state['drift']
            return out
    finally:
        case.doCleanups()
        tests.r = CURRENT

result = {'status': 'NOT_APPROVED', 'modes': {}}
for name, module in [('baseline52908c', BASELINE), ('fixed', CURRENT)]:
    probes = [replay(module, 'cwd')]
    probes.extend(replay(module, 'pair', field, stage) for stage in ('source', 'root')
                  for field in ('startTicks', 'rawenv', 'cmdline', 'permissions'))
    result['modes'][name] = probes
out = ROOT/'evidence/r4-auxfix-counterexamples.json'
out.write_text(json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'pureMockProbesPerMode': 9,
                  'baselineAllNineStaleAccepted': all(p['collectorReturned'] and p['storedParentEqualsLiveAtReturn'] is False for p in result['modes']['baseline52908c']),
                  'fixedAllNineRejected': all(not p['collectorReturned'] and p['error'] for p in result['modes']['fixed']),
                  'output': str(out)}, sort_keys=True, indent=2))
