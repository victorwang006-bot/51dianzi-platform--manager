#!/usr/bin/env python3
"""Read-only source audit; writes only evidence/r4-auxfix-*; no code execution."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).absolute().parent.parent
E = ROOT/'evidence'
BASE = E/'r4-auxfix-baseline-52908c'
FILES = ('release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py', 'README.md', 'prepare-local.README.md')
BASE_SHA = '52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f'
FINAL_SHA = '4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121'
ALLOWED_HELPERS = ['external_proc_sample', 'external_protection_sample']


def H(data):
    return hashlib.sha256(data).hexdigest()


def rec(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': H(data)}


def put(name, value):
    assert name.startswith('r4-auxfix-')
    (E/name).write_text(json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2)+'\n')


def nodes(text):
    out = {}
    for index, node in enumerate(ast.parse(text).body):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            key = node.name
        elif isinstance(node, ast.Assign):
            key = ','.join(ast.unparse(x) for x in node.targets)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            key = 'import:'+ast.unparse(node)
        elif isinstance(node, ast.If):
            key = 'If:'+ast.unparse(node.test)
        else:
            key = type(node).__name__+':'+str(index)
        assert key not in out, key
        out[key] = node
    return out


def dump(node):
    return ast.dump(node, include_attributes=False).encode()


def segment(text, node):
    lines = text.splitlines(keepends=True)
    start = min([node.lineno, *[d.lineno for d in getattr(node, 'decorator_list', [])]])
    return ''.join(lines[start-1:node.end_lineno]).encode('utf8')


def comparison(before, after, oldnodes, newnodes):
    added = sorted(set(newnodes)-set(oldnodes))
    removed = sorted(set(oldnodes)-set(newnodes))
    changed, unchanged, records = [], [], {}
    for name in sorted(set(oldnodes)&set(newnodes)):
        a, b = oldnodes[name], newnodes[name]
        ast_equal = dump(a) == dump(b)
        byte_equal = segment(before, a) == segment(after, b)
        (unchanged if ast_equal else changed).append(name)
        records[name] = {'astEqual': ast_equal, 'fullSourceBytesEqual': byte_equal,
            'beforeSourceSha256': H(segment(before,a)), 'afterSourceSha256': H(segment(after,b)),
            'beforeAstSha256': H(dump(a)), 'afterAstSha256': H(dump(b)),
            'beforeLines': [a.lineno,a.end_lineno], 'afterLines': [b.lineno,b.end_lineno]}
    return {'added':added, 'removed':removed, 'changed':changed, 'unchanged':unchanged, 'sourceRecords':records}


def assert_unchanged(check):
    assert all(check['sourceRecords'][name]['astEqual'] and
               check['sourceRecords'][name]['fullSourceBytesEqual'] for name in check['unchanged'])


def methods(node, test_only=False):
    return {x.name:x for x in node.body if isinstance(x, ast.FunctionDef)
            and (not test_only or x.name.startswith('test_'))}


def test_methods(text):
    return {node.name+'.'+name:method for node in ast.parse(text).body if isinstance(node, ast.ClassDef)
            for name,method in methods(node, True).items()}


# Verify every saved baseline file against the first-operation manifest.
manifest = {}
for line in (BASE/'SHA256SUMS').read_text().splitlines():
    digest, name = line.split('  ', 1)
    manifest[name] = digest
assert set(manifest) == set(FILES)
assert all(rec(BASE/name)['sha256'] == manifest[name] for name in FILES)
assert manifest['release.py'] == BASE_SHA

before = (BASE/'release.py').read_text()
after = (ROOT/'release.py').read_text()
assert H(before.encode()) == BASE_SHA and H(after.encode()) == FINAL_SHA
a, b = nodes(before), nodes(after)
top = comparison(before, after, a, b)
assert top['changed'] == ALLOWED_HELPERS and not top['added'] and not top['removed']
assert_unchanged(top)
restored = after.encode()
for name in ALLOWED_HELPERS:
    old, new = segment(before, a[name]), segment(after, b[name])
    assert restored.count(new) == 1
    restored = restored.replace(new, old, 1)
assert restored == before.encode()  # includes ALL inter-node bytes/comments, not just AST

controller = comparison(before, after, methods(a['Controller']), methods(b['Controller']))
assert len(controller['unchanged']) == 30 and not controller['added'] and not controller['removed'] and not controller['changed']
assert_unchanged(controller)
assert top['sourceRecords']['Controller']['fullSourceBytesEqual']
assert ast.unparse(methods(b['Controller'])['baseline_guard'].body[0]) == "pm2_publish_ready(b['c']['processes'], b['ids'])"
callers = sorted(name for name, node in methods(b['Controller']).items() if any(
    isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and x.func.attr == 'baseline_guard'
    for x in ast.walk(node)))
assert callers == ['apply', 'preflight']

pb = (BASE/'prepare-local.py').read_text()
pa = (ROOT/'prepare-local.py').read_text()
prepare = comparison(pb, pa, nodes(pb), nodes(pa))
assert prepare['changed'] == ['CONTROLLER_SHA'] and not prepare['added'] and not prepare['removed']
assert_unchanged(prepare)
assert ast.literal_eval(nodes(pa)['CONTROLLER_SHA'].value) == FINAL_SHA
assert pa.replace(FINAL_SHA, BASE_SHA, 1) == pb

unit = {}
for name,oldcount,newcount in [('test_release.py',136,142),('test_prepare_local.py',36,36)]:
    old, new = (BASE/name).read_text(), (ROOT/name).read_text()
    check = comparison(old, new, test_methods(old), test_methods(new))
    assert len(test_methods(old)) == oldcount and len(test_methods(new)) == newcount
    assert not check['removed'] and not check['changed']
    assert_unchanged(check)
    if name == 'test_release.py':
        assert len(check['added']) == 6 and all(x.startswith('R4AuxFixTests.') for x in check['added'])
        testtop = comparison(old, new, nodes(old), nodes(new))
        assert testtop['added'] == ['R4AuxFixTests'] and not testtop['removed'] and not testtop['changed']
        assert_unchanged(testtop)
        added_segment = segment(new, nodes(new)['R4AuxFixTests']) + b'\n'
        assert new.encode().replace(added_segment, b'', 1) == old.encode()
    else:
        assert not check['added'] and old.encode() == new.encode()
    unit[name] = {'baselineCount':oldcount, 'currentCount':newcount, **check}

pins_before = ast.literal_eval(a['PM2_GENERATION_PINS'].value)
pins_after = ast.literal_eval(b['PM2_GENERATION_PINS'].value)
assert pins_before == pins_after and len(pins_after) == 9
assert 'package.json' in pins_after
assert pins_after['modules/fclone.js'] == '9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6'
rpc = ast.literal_eval(b['RPC'].value).encode()
assert rpc == ast.literal_eval(a['RPC'].value).encode()
for name in (*FILES[:4], 'test_finite_json.py'):
    compile((ROOT/name).read_bytes(), str(ROOT/name), 'exec')  # memory only; no module run/pycache
finite = rec(ROOT/'test_finite_json.py')
old_domain = json.loads((E/'r4-domain-source-and-safety.json').read_text())
assert finite['sha256'] == old_domain['unmodifiedFiniteJsonTests']['sha256']
for name in ('README.md','prepare-local.README.md'):
    assert (ROOT/name).read_text().count(FINAL_SHA) == 1

logs = {}
for name,count in [('r4-auxfix-baseline-release-tests.txt',136), ('r4-auxfix-baseline-prepare-tests.txt',36),
                   ('r4-auxfix-baseline-finite-tests.txt',6), ('r4-auxfix-release-tests.txt',142),
                   ('r4-auxfix-prepare-tests.txt',36), ('r4-auxfix-finite-tests.txt',6),
                   ('r4-auxfix-new-tests.txt',6), ('r4-auxfix-new-tests-initial.txt',6)]:
    path = E/name
    text = path.read_text()
    assert f'Ran {count} tests ' in text and text.rstrip().endswith('OK')
    logs[name] = dict(rec(path), tests=count, passed=True)

replay = json.loads((E/'r4-auxfix-counterexamples.json').read_text())
assert replay['status'] == 'NOT_APPROVED'
assert len(replay['modes']['baseline52908c']) == len(replay['modes']['fixed']) == 9
assert all(x['collectorReturned'] and x['storedParentEqualsLiveAtReturn'] is False for x in replay['modes']['baseline52908c'])
assert all(not x['collectorReturned'] and x['error'] in ('EXTERNAL_PROC_IDENTITY_READ_RACE', 'EXTERNAL_PROC_PAIR_READ_RACE') for x in replay['modes']['fixed'])

# All historical evidence and the two independent review inputs are read only.
# This inventory binds preserved artifacts at audit time; it is not a claim
# that a before-task checksum inventory was taken for every historical file.
historical = {str(p.relative_to(ROOT)):rec(p) for p in sorted(E.rglob('*'))
              if p.is_file() and not p.relative_to(E).parts[0].startswith('r4-auxfix-')}
inputs = {str(p):rec(p) for p in [Path('/home/ubuntu/work/customer-batch/review-r4-aux-offline.md'),
                                Path('/home/ubuntu/work/customer-batch/review-r4-aux-offline.json')]}
static = {'schema':'r4-auxfix-ast-byte-audit-v1', 'status':'NOT_APPROVED',
    'baselineControllerSha256':BASE_SHA, 'currentControllerSha256':FINAL_SHA,
    'releaseTopLevel':top, 'controllerWholeClass':top['sourceRecords']['Controller'],
    'controllerMethods':controller, 'baselineGuardFirstStatement':ast.unparse(methods(b['Controller'])['baseline_guard'].body[0]),
    'baselineGuardCallers':callers, 'preparer':prepare, 'testMethods':unit,
    'testReleaseTopLevel':testtop, 'releaseAllBytesOutsideTwoHelpersEqual':True,
    'preparerAllBytesExceptSinglePinEqual':True, 'testPrepareLocalWholeBytesEqual':True,
    'testReleaseOnlyAddedClassAllOtherBytesEqual':True, 'original136ControllerMethodsRetained':True,
    'original36PreparerMethodsRetained':True, 'memoryCompileOnly':True,
    'generationPins':pins_after, 'allNinePinsExactEqual':True, 'originalEightPlusNinthPreserved':True,
    'rpcFullLiteralUtf8Sha256':H(rpc), 'rpcAssignmentAndFunctionAstBytesEqual':True,
    'owner':ast.literal_eval(b['OWNER'].value), 'scope':ast.literal_eval(b['SCOPE'].value),
    'parentCwdShallowOnly':True, 'knownFourSourceRolesAndDeduplicatedPathsUnchanged':True,
    'exactTwoRootsUnchanged':True, 'procSourceRootAtomicGuarantee':False,
    'samplingLoopOrSearchAdded':False}
put('r4-auxfix-ast-diff.json', static)
controller_diff = ''.join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
    fromfile='52908c/release.py', tofile='auxfix/release.py'))
(E/'r4-auxfix-controller.diff').write_text(controller_diff)
all_diff = ''.join(''.join(difflib.unified_diff((BASE/name).read_text().splitlines(keepends=True),
    (ROOT/name).read_text().splitlines(keepends=True),fromfile='52908c/'+name,tofile='auxfix/'+name)) for name in FILES)
(E/'r4-auxfix-allowed-files.diff').write_text(all_diff)
proofs = {name:rec(E/name) for name in ['r4-auxfix-ast-diff.json','r4-auxfix-controller.diff',
    'r4-auxfix-allowed-files.diff','r4-auxfix-counterexamples.json','r4-auxfix-replay.py',
    'r4-auxfix-replay-output.txt','r4-auxfix-audit.py']}
source = {'schema':'r4-auxfix-source-and-safety-v1', 'status':'NOT_APPROVED',
    'controllerApproved':False, 'releaseApproved':False, 'finalApprove':False,
    'finalDeployApproval':False, 'reloadApproved':False,
    'before':{name:rec(BASE/name) for name in FILES}, 'after':{name:rec(ROOT/name) for name in FILES},
    'baselineManifest':rec(BASE/'SHA256SUMS'), 'proofs':proofs, 'logs':logs,
    'reviewInputs':inputs, 'preservedHistoricalEvidence':historical,
    'unmodifiedFiniteJsonTests':finite, 'baselineStaleAcceptedPureMockProbes':9,
    'fixedRejectedPureMockProbes':9, 'newControllerTestMethods':6,
    'secondPairCwdTimeSubcases':3, 'sourceAndRootParentDriftSubcases':8,
    'finalProcSourceAndRootMetaDriftSubcases':2, 'stableCompleteRecordCase':1,
    'scopeUnchangedFromNeverRemoteR4':True, 'fullOwnerUnchanged':True,
    'gitExecuted':False, 'sshExecuted':False, 'mcpExecuted':False,
    'serverOperationPerformed':False, 'realProcRead':False, 'actualNodeExecuted':False,
    'productionModuleImported':False, 'actualRpcExecuted':False, 'productionCliExecuted':False,
    'actualCaptureExecuted':False, 'remoteStageExecuted':False, 'actualAttemptExecuted':False,
    'actualReloadExecuted':False, 'actualWindowOpened':False, 'productionWrites':0,
    'businessOrJsBuilderModifiedOrExecuted':False, 'unknownParentCwdEnumerated':False,
    'procSearchOrScanExpanded':False, 'budgetsChanged':False, 'policiesChanged':False,
    'existingTempMockDiagnosticCaptureMethodRanInFullSuite':True,
    'actualCaptureFileCreated':False, 'procSourceRootAtomicGuarantee':False,
    'frontListDetailClosed':False, 'actualFresh14ProcVerified':False,
    'currentFullSourcesMetaVerified':False, 'cloneTypedRetainedWitnessVerified':False,
    'sixActualReadyAllTrueVerified':False, 'independentFullPackageApproved':False,
    'stillRequired':['actual fresh14proc/current full sources META', 'cloneTypedRetainedWitness',
        'six actual Ready all literal true', 'fresh full protected tree/fullMETA and actual flock identity/dependency closure',
        'fresh fullpkg/manifest/source/tool/owner/nonce/TTL/complete forward-inverse bytes and independent approval',
        'front list+detail priority remains not closed', 'explicit deployment authorization']}
put('r4-auxfix-source-and-safety.json', source)
summary = {'status':'NOT_APPROVED','controllerSha256':FINAL_SHA,'changedReleaseTopLevel':top['changed'],
    'unchangedReleaseTopLevelCount':len(top['unchanged']),'controllerWholeClassAstBytesEqual':True,
    'controllerMethodsAstBytesEqual':len(controller['unchanged']), 'preparerChanged':prepare['changed'],
    'testPrepareLocalUnchanged':True,'baselineTests':[136,36,6], 'finalTests':[142,36,6],
    'newAuxMethodsSeparatelyPassed':6,'baselineStaleAcceptedPureMockProbes':9,'fixedRejectedPureMockProbes':9,
    'controllerAstSha256':top['sourceRecords']['Controller']['afterAstSha256'],
    'controllerSourceSha256':top['sourceRecords']['Controller']['afterSourceSha256'],
    'rpcLiteralSha256':H(rpc),'proofs':proofs,
    'logs':{name:{k:v for k,v in value.items() if k in ('tests','passed','sha256','bytes')} for name,value in logs.items()}}
print(json.dumps(summary, ensure_ascii=True, sort_keys=True, indent=2))

source_table = '\n'.join(f"| `{name}` | {value['bytes']} | `{value['sha256']}` |" for name,value in source['after'].items())
log_table = '\n'.join(f"| `{name}` | {value['tests']}/{value['tests']} | {value['bytes']} | `{value['sha256']}` |" for name,value in logs.items())
proof_table = '\n'.join(f"| `{name}` | {value['bytes']} | `{value['sha256']}` |" for name,value in proofs.items())
input_table = '\n'.join(f"| `{name}` | `{value['sha256']}` |" for name,value in inputs.items())
controller_record = top['sourceRecords']['Controller']
report = f'''# R4-AUX-01 最窄离线采样修复与完整保留证明

**NOT_APPROVED。controllerApproved=false / releaseApproved=false / finalApprove=false / finalDeployApproval=false / reloadApproved=false。**

当前 controller **`{FINAL_SHA}`**，preparer `CONTROLLER_SHA` 精确相同。修改前首先保存 **52908c** 当前六文件到 `evidence/r4-auxfix-baseline-52908c/`，含 `test_prepare_local.py`；六文件与初始 SHA256SUMS 逐项核对成功。基线 controller `52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f`；该基线已有 domain guard、baseline_guard 首句 six-own all literal True 零写门槛，全部保留。

完整 OWNER `{static['owner']}`、SCOPE `{static['scope']}` 不变。R4 未 remote/stage/capture/attempt 是本次交接边界；本任务没有服务器验证或服务器操作。前台列表+详情优先仍未 closed。本报告仅离线修复自检，不是独立 final approval。

## 1. 输入与 accepted 反例的直接复现

只读指定独立本地 `review-r4-aux-offline.md/.json`。原审对象是 8dc，不把它误称为 current 审查；本任务另外对保存的 52908c 原 helpers 作纯 TempDirectory/mock replay，确认缺口仍存在。

| 独立审查输入 | SHA-256 |
|---|---|
{input_table}

`r4-auxfix-replay.py` 复用现有 `r4_external_fixture`、实际 `external_proc_sample` / pair / collector；不替换整个 proc sample，不读真实 proc、不执行源、不作 Linux 实际时序实验。第一探针在**第二 pair 的早 parent cmdline 读取阶段**改变 shallow parent cwd mtime/ctime，基线两次记录仍等于旧 META，live 与记录不同。第二类在第二 pair 最后 source/root 收尾处，让 parent 的 startTicks / whole rawenv / cmdline / permissions 各自漂移，early records 已读完且 known source/root 不变。基线 **1 + 2×4 = 9 个 stale accepted 实例全部直接复现**；新 helper 对相同九个实例全部 rejected。完整结果见 `r4-auxfix-counterexamples.json`，只有 synthetic 时间/身份及 SHA 证据，无 env/cmd 私值。

## 2. 仅两个 helper 的最窄修正

`external_proc_sample` 末端既有 identity/proc/link equality 后追加 `describe(current_cwd) == cwd_record`；m/ctime 不忽略。parent cwd 只浅 META，不递归未知目录，不猜 parent executable/cwd，不扩大域。

`external_protection_sample` 保留 early parent/child、关系验证、原四 known source fullMETA、原 exact Ops+childcwd rootMETA 收尾。其后对同一固定两个 PID、同一 expected exe/script/cwd 再**完整** `external_proc_sample`，两条 final record 分别与 early record **exact equality**；不缩成 identity 或挑字段比。final proc 读取后再查同一四 known source fullMETA equality 及同一两 rootMETA equality。返回仍为原 schema 与 early records，不 rebaseline、不 normalization。

成功的每 pair 固定 early parent/child + final parent/child 四次完整 proc helper，两个 pair 合计八次；每 pair 同一 known source 集合 early + final 各一次，原四类 source 角色按路径去重规则保持。两个 pair 合计 `4 × len(files)` 次 source helper，本 mock 四独立路径为十六次，实际最多十六次；提前拒绝可更少。只有有限既定 phase 复查，没有无限 loop、PID 搜索、扫描域或预算扩展。whole raw env/argv 哈希、PPID/startTicks/permission/proc/link/cwd META/source、exact child argv/cwd 与 full node SHA 规则均不放宽。

**有限读取不是内核原子冻结、proc/source/root 同时刻快照、零 TOCTOU、返回后持续不变或连续监控。只拒绝在这些既定复查阶段已观测到的混合记录；无法证明未观测时段不变。** 首次 flock 信任来源、未知 loader/native/dependency 语义仍待 actual 审，不用新保护策略掩盖 unknown。

## 3. 完整 AST + byte 保留，不靠报告布尔值代替计算

标准库 AST 去位置属性与逐 node 原 source bytes 独立重算：顶层无新增/删除，**仅 `{', '.join(top['changed'])}` 改变**；其余 **{len(top['unchanged'])} 项顶层 AST/源码全文 bytes 相同**。把两个 changed helper 的 source bytes 换回保存基线后，release **整文件全部 bytes** 与基线相等，含 node 间注释/空白。

Controller **全类 + 30 方法 AST/源码 bytes 均相同**，包括 baseline_guard 新 gate 与其它 29 方法；domain guard、raw binding、原 eight+ninth pins、Config/exact roots、transport、RPC、budgets、journal、schema、identity、owner/scope 及所有其它原函数/常量均由上述完整比较覆盖。

- Controller 全类 AST SHA：`{controller_record['afterAstSha256']}`。
- Controller 全类源码 SHA：`{controller_record['afterSourceSha256']}`。
- baseline_guard 首句：`{static['baselineGuardFirstStatement']}`；调用者仅 apply/preflight。
- RPC full literal UTF-8 SHA：`{H(rpc)}`；RPC assignment/function AST 与源码 bytes 完全相同。
- 原九 generation pins 对象、顺序/原源码全文均相同，含原 package.json 与唯一第九 modules/fclone.js `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。
- preparer 唯一 AST 与整文件 byte 差量为固定 `CONTROLLER_SHA`；把 pin 换回即整文件相同。
- test_prepare_local.py **整文件 bytes 不变**；无 fixture pin 变更需要。
- test_release.py 只增加 R4AuxFixTests 一个 class；移除该 class 后整文件 bytes 精确相同。原 136 test 方法、原 classes/helpers/fixtures AST 和全文 bytes 均不改；preparer 原 36 test 方法不改；finite 原六方法/文件 SHA 与旧 domain evidence 相同。

逐方法/顶层 AST/source SHA、前后 byte ranges 和全部 equality 见 `r4-auxfix-ast-diff.json`；只两个 helpers 的精确源码补丁见 `r4-auxfix-controller.diff`；五实际修改文件及未改第六文件的完整 diff 见 `r4-auxfix-allowed-files.diff`。

## 4. 纯本地完整回归与计数

修改前重跑 **136/36/6** 全通过；修复后完整 **142/36/6** 全通过（原 136 + 新 aux 六方法），另独立 aux 六方法 **6/6**。首轮新增六方法也一次通过，日志保留，不覆写历史初轮失败/审查证据。

新增六方法包含：stable 完整记录与固定 PID/参数/有限调用计数；第二 pair parentcmd shallow cwd mtime、ctime 各单独及一起三反例；source/root 最后阶段 × parent 四 drift 字段八反例；final proc 读取期 source 同 bytes/fullMETA 与 root fullMETA 两反例。新局部 fixture 的计数明确区分 pair early/final，第二 pair 的 old 第二 parentcmd 在修复版是第三 parentcmd，不把它偷换成第一 pair final；pair末端 drift 则观察第四完整 parentcmd 后 equality 拒绝。无需改变任何旧 test 预期或省略原 cases。

原 domain/zero-write gate 等原方法本次完整重跑；这些测试的锁、CAS、apply/reload adapters 与 diagnostic capture() 均只在 TempDirectory/mock，后者不生成 capture 文件。没有 actual capture/CLI/RPC/生产动作。

| 完整保存日志 | 通过 | bytes | SHA-256 |
|---|---:|---:|---|
{log_table}

## 5. 当前六文件和证据 SHA

| 文件 | bytes | SHA-256 |
|---|---:|---|
{source_table}

| 精确证据 | bytes | SHA-256 |
|---|---:|---|
{proof_table}

`r4-auxfix-source-and-safety.json` 含 baseline/current 六文件 SHA、pin binding、所有日志/审查/证明 SHA、历史 evidence 的只读 SHA 清单、明确未执行 flags。历史清单是审计时现存对象校验，不假称所有历史文件在任务开始前已另拍 checksum。全 auxfix 文件（含报告、audit-output、基线副本）SHA 见 `r4-auxfix-SHA256SUMS.txt`；清单不包含自身以避免自引用。原中间日志与独立审查文件均保留。

## 6. 全部 hold 不变

只改授权 release.py/test_release.py/prepare-local.py/README.md/prepare-local.README.md 和 evidence/r4-auxfix-*；第六 baseline 文件 test_prepare_local.py 未改。无 Git/SSH/MCP/server/Node/RPC/生产模块/prod CLI/JSbuilder/业务修改或执行；无 actual capture/stage/attempt/window/reload，productionWrites=0。未新增保护特性或修改 policy。

**actual fresh14proc/current full sources META、cloneTypedRetainedWitness、six actual Ready all literal true、fresh fullpkg/manifest/source/tool/owner/nonce/TTL/完整正逆字节、fresh protected tree/fullMETA 与 actual identity/dependency closure、独立 fullpkg 审批及明确部署许可全部待主任务。前台列表+详情仍未 closed。** 原 domain/newbaselinegate 和 mock allready 正常通过不代表 actual all true 或 approved。

**最终仍 NOT_APPROVED，所有 approval 值 false。**
'''
(E/'r4-auxfix-report.md').write_text(report)
# No earlier non-auxfix evidence or independent review input changed while auditing.
assert all(rec(Path(value['path'])) == value for value in historical.values())
assert all(rec(Path(value['path'])) == value for value in inputs.values())
