#!/usr/bin/env python3
"""Readonly comparison of the six allowlisted sources; writes only r8 evidence."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E = ROOT/'evidence'
BASE = E/'r8-baseline-a555'
FILES = ('release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py', 'README.md', 'prepare-local.README.md')
OLD_SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R7'
NEW_SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R8'
OLD_H = 'a555022329eed9c2b72efa2aa0668b9a84d33148da4bee5cc9ba5bd579866e5b'

def H(data): return hashlib.sha256(data).hexdigest()
def save(name, obj): (E/name).write_text(json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2)+'\n')
def indexed(text):
    tree = ast.parse(text); out = {}
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)): key = n.name
        elif isinstance(n, ast.Assign): key = 'assign:'+','.join(ast.unparse(x) for x in n.targets)
        elif isinstance(n, ast.AnnAssign): key = 'assign:'+ast.unparse(n.target)
        else:
            prefix = type(n).__name__+':'
            key = prefix+str(sum(k.startswith(prefix) for k in out))
        assert key not in out; out[key] = n
    return tree, out

def compare(name, allowed_changed, allowed_added):
    old = (BASE/name).read_text(); new = (ROOT/name).read_text()
    ot, oi = indexed(old); nt, ni = indexed(new)
    changed_ast = [k for k in oi.keys() & ni.keys() if ast.dump(oi[k]) != ast.dump(ni[k])]
    changed_bytes = [k for k in oi.keys() & ni.keys() if ast.get_source_segment(old, oi[k]) != ast.get_source_segment(new, ni[k])]
    added = sorted(ni.keys()-oi.keys()); removed = sorted(oi.keys()-ni.keys())
    assert set(changed_ast) == set(allowed_changed), (name, changed_ast)
    assert set(changed_bytes) == set(allowed_changed), (name, changed_bytes)
    assert set(added) == set(allowed_added) and not removed
    return {'changedAST': sorted(changed_ast), 'changedExactSourceSegments': sorted(changed_bytes),
            'added': added, 'removed': removed, 'unchangedTopLevelNodes': sorted(oi.keys() & ni.keys() - set(changed_ast))}, (old, new, ot, nt, oi, ni)

r, context = compare('release.py', ['assign:SCOPE', 'dynamic_proc'], ['dynamic_proc_virtual_meta'])
p, pc = compare('prepare-local.py', ['assign:CONTROLLER_SHA'], [])
old, new, ot, nt, oi, ni = context
assert H((BASE/'release.py').read_bytes()) == OLD_H
new_h = H((ROOT/'release.py').read_bytes())
assert ast.literal_eval(ni['assign:SCOPE'].value) == NEW_SCOPE
assert ast.literal_eval(pc[5]['assign:CONTROLLER_SHA'].value) == new_h
assert ast.get_source_segment(old, oi['Controller']) == ast.get_source_segment(new, ni['Controller'])
controller_methods = [n.name for n in oi['Controller'].body if isinstance(n, ast.FunctionDef)]
assert len(controller_methods) == 30

class OnlyVirtualCalls(ast.NodeTransformer):
    def visit_Call(self, node):
        node = self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == 'dynamic_proc_virtual_meta':
            assert len(node.args) == 3 and not node.keywords
            assert isinstance(node.args[0], ast.Name) and node.args[0].id == 'cfg'
            assert isinstance(node.args[1], ast.Name) and node.args[1].id == 'pid'
            node.func = ast.Name(id='meta', ctx=ast.Load()); node.args = [node.args[2]]
        return node
normalized = OnlyVirtualCalls().visit(ast.parse(ast.get_source_segment(new, ni['dynamic_proc'])).body[0])
assert ast.dump(normalized) == ast.dump(oi['dynamic_proc'])

labels = ('CONTROLLER_PIN', 'MANIFEST_PIN', 'REVIEW_PIN', 'ATTEMPT_PIN',
          'LATEST_STATE_EXPLICIT_PIN_NO_STALE_REPLAY', 'RECEIPT_PIN',
          'EXPLICIT_FAILURE_OR_RECEIPT_PIN', 'ROLLBACK_REVIEW_PIN', 'RPC_API_PIN')
for label in labels: assert old.count("'"+label+"'") == new.count("'"+label+"'") > 0

def methods(text):
    result = {}
    for cls in ast.parse(text).body:
        if isinstance(cls, ast.ClassDef):
            for method in cls.body:
                if isinstance(method, ast.FunctionDef) and method.name.startswith('test_'):
                    result[cls.name+'.'+method.name] = ast.get_source_segment(text, method)
    return result

test_results = {}
for filename, expected_old, expected_added, permitted in [
    ('test_release.py', 276, 28, {'SafetyTests.test_production_scope_owner_and_no_runtime_overrides', 'R4ProtectedGraphTests.test_owner_scope_and_all_original_roots_preserved'}),
    ('test_prepare_local.py', 42, 2, {'LocalTests.test_r3_current_controller_sha_and_scope_fixed'})]:
    a = methods((BASE/filename).read_text()); b = methods((ROOT/filename).read_text())
    assert len(a) == expected_old and len(b) == expected_old+expected_added
    assert set(a) <= set(b)
    changes = []
    for key in a:
        if a[key] != b[key]:
            assert a[key].replace(OLD_SCOPE, NEW_SCOPE) == b[key], key
            changes.append(key)
    # The first two method names are discovered exactly rather than guessed.
    if filename == 'test_release.py': assert len(changes) == 2
    else: assert set(changes) == permitted
    test_results[filename] = {'oldMethodsPreserved': len(a), 'newMethods': len(b)-len(a),
                             'changedExistingMethodsScopeAssertionsOnly': changes,
                             'unchangedExistingMethods': sorted(set(a)-set(changes)),
                             'addedMethods': sorted(set(b)-set(a))}

unchanged_groups = {
    'Controller30': controller_methods,
    'Config': ['Config', 'config_binding'],
    'ordinaryRealFS': ['meta', 'regular', 'describe', 'no_link', 'external_source'],
    'scanIdentityPermissionsMappings': ['dynamic_scan', 'dynamic_identity', 'dynamic_permissions', 'dynamic_maps', 'dynamic_kernel_mappings', 'dynamic_map_fields'],
    'nativeProtectionBudgetSource': ['dynamic_native_stat_meta', 'dynamic_native_source_meta', 'dynamic_read', 'dynamic_source', 'dynamic_budget', 'dynamic_check', 'assign:DYNAMIC_FIXED_NATIVE_SOURCE_PINS'],
    'dynamicGraphFinalPhasesOwnedStable': ['dynamic_protection_sample', 'dynamic_protection', 'dynamic_owned'],
    'historicalExternalHelpers': ['external_proc_identity', 'external_proc_link', 'external_proc_sample', 'external_protection_sample', 'external_protection'],
    'RPC': ['assign:RPC', 'rpc', 'production_reload'],
}
for group, keys in unchanged_groups.items():
    if group == 'Controller30': continue
    for key in keys:
        assert key in oi and key in ni, key
        assert ast.dump(oi[key]) == ast.dump(ni[key])
        assert ast.get_source_segment(old, oi[key]) == ast.get_source_segment(new, ni[key])

patch = []
for filename in FILES:
    patch.extend(difflib.unified_diff((BASE/filename).read_text().splitlines(True),
                                    (ROOT/filename).read_text().splitlines(True),
                                    fromfile='r8-baseline-a555/'+filename, tofile='current/'+filename))
(E/'r8-six-files.patch').write_text(''.join(patch))
report = {'status': 'PASS', 'baselineControllerSha256': OLD_H, 'currentControllerSha256': new_h,
          'currentScope': NEW_SCOPE, 'release': r, 'preparer': p,
          'ControllerMethodCount': len(controller_methods), 'ControllerASTAndExactSourceUnchanged': True,
          'nineExistingPinLabelsUnchanged': list(labels), 'unchangedExactSourceGroups': unchanged_groups,
          'allOtherTopLevelReleaseNodesUnchangedASTAndExactBytes': True,
          'dynamicProcASTExactlyBaselineAfterOnlyFourVirtualCallReplacements': True,
          'allPreparerFunctionsASTAndExactSourceUnchanged': True,
          'outerSchemaAndConfigUnchanged': True, 'finiteDecodeASTAndExactSourceUnchanged': True,
          'tests': test_results}
save('r8-ast-diff.json', report)
logs = ['r8-baseline-release-tests.txt', 'r8-baseline-prepare-tests.txt', 'r8-release-tests.txt', 'r8-prepare-tests.txt', 'r8-finite-tests.txt', 'r8-new-release-tests.txt', 'r8-new-prepare-tests.txt']
safety = {'status': 'PROC_VIRTUAL_META_FIX_NOT_APPROVED', 'scope': NEW_SCOPE, 'owner': ast.literal_eval(ni['assign:OWNER'].value),
          'controllerSha256': new_h, 'preparerFixedPinMatches': True,
          'sixFiles': {f: {'baselineSha256': H((BASE/f).read_bytes()), 'currentSha256': H((ROOT/f).read_bytes())} for f in FILES},
          'logs': {f: H((E/f).read_bytes()) for f in logs},
          'parentProcSourceReportSha256': H((E/'r8-proc-virtual-source.md').read_bytes()),
          'ASTAuditSha256': H((E/'r8-ast-diff.json').read_bytes()), 'directDiffSha256': H((E/'r8-six-files.patch').read_bytes()),
          'testCounts': {'baselineRelease':276, 'baselinePreparer':42, 'currentRelease':304, 'currentPreparer':44, 'newRelease':28, 'newPreparer':2, 'finiteRevalidationMethodsOnBaselineAndCurrent':6},
          'finiteCaveat': 'Separate historical seventh test_finite_json.py was not accessed; six finite methods in allowlisted r8 evidence revalidated exact baseline/current decoder. This is not a claim that that separate historical suite was executed.',
          'controllerApproved': False, 'releaseApproved': False, 'finalDeployApproval': False, 'reloadApproved': False,
          'typedSemanticsApproved': False, 'sourceGraphApproved': False, 'fullPackageApproved': False,
          'productionWrites': 0, 'productionCaptureInvoked': False, 'actualProcRead': False,
          'actualProcEnvRead': False, 'actualFDContentRead': False, 'NodeExecuted': False,
          'GitUsed': False, 'MCPUsed': False, 'SSHUsed': False, 'serverInvoked': False, 'reloadInvoked': False}
save('r8-source-and-safety.json', safety)
print(json.dumps({'status': 'PASS', 'controllerSha256': new_h, 'scope': NEW_SCOPE, 'tests': safety['testCounts']}, sort_keys=True))
