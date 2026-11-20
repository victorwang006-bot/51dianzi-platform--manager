#!/usr/bin/env python3
"""Pure local AST/bytes/log audit. No import, execution, Git, network or CLI."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).absolute().parent.parent
E = ROOT/'evidence'
BASE = E/'r4-domain-baseline-8dc'
FILES = ('release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py', 'README.md', 'prepare-local.README.md')
def H(data): return hashlib.sha256(data).hexdigest()
def rec(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': H(data)}
def put(name, value):
    (E/name).write_text(json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2)+'\n')
def nodes(text):
    tree = ast.parse(text)
    out = {}
    for index, node in enumerate(tree.body):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)): key = node.name
        elif isinstance(node, ast.Assign): key = ','.join(ast.unparse(x) for x in node.targets)
        elif isinstance(node, ast.Import): key = 'import:'+ast.unparse(node)
        elif isinstance(node, ast.ImportFrom): key = 'import:'+ast.unparse(node)
        elif isinstance(node, ast.If): key = 'If:'+ast.unparse(node.test)
        else: key = type(node).__name__+':'+str(index)
        assert key not in out, key
        out[key] = node
    return out
def dump(node): return ast.dump(node, include_attributes=False)
def segment(text, node):
    lines = text.splitlines(keepends=True)
    start = min([node.lineno, *[d.lineno for d in getattr(node, 'decorator_list', [])]])
    return ''.join(lines[start-1:node.end_lineno]).encode('utf8')
def comparison(before, after, oldnodes, newnodes):
    added = sorted(set(newnodes)-set(oldnodes)); removed = sorted(set(oldnodes)-set(newnodes))
    changed, unchanged, records = [], [], {}
    for name in sorted(set(oldnodes)&set(newnodes)):
        a, b = oldnodes[name], newnodes[name]
        ast_equal = dump(a) == dump(b)
        byte_equal = segment(before, a) == segment(after, b)
        (unchanged if ast_equal else changed).append(name)
        records[name] = {'astEqual': ast_equal, 'fullSourceBytesEqual': byte_equal,
            'beforeSha256': H(segment(before,a)), 'afterSha256': H(segment(after,b)),
            'beforeLines': [a.lineno,a.end_lineno], 'afterLines': [b.lineno,b.end_lineno]}
    return {'added':added, 'removed':removed, 'changed':changed, 'unchanged':unchanged, 'sourceRecords':records}

before = (BASE/'release.py').read_text(); after = (ROOT/'release.py').read_text()
assert H(before.encode()) == '8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0'
a, b = nodes(before), nodes(after)
top = comparison(before,after,a,b)
assert top['added'] == ['pm2_json_domain','pm2_publish_ready']
assert top['removed'] == []
assert top['changed'] == ['Controller','pm2_raw_binding']
assert all(top['sourceRecords'][name]['fullSourceBytesEqual'] for name in top['unchanged'])
methods_a = {node.name:node for node in a['Controller'].body if isinstance(node,ast.FunctionDef)}
methods_b = {node.name:node for node in b['Controller'].body if isinstance(node,ast.FunctionDef)}
methods = comparison(before,after,methods_a,methods_b)
assert methods['changed'] == ['baseline_guard'] and not methods['added'] and not methods['removed']
assert all(methods['sourceRecords'][name]['fullSourceBytesEqual'] for name in methods['unchanged'])
callers = sorted(name for name,node in methods_b.items() if any(isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and x.func.attr=='baseline_guard' for x in ast.walk(node)))
assert callers == ['apply','preflight']
assert ast.unparse(methods_b['baseline_guard'].body[0]) == "pm2_publish_ready(b['c']['processes'], b['ids'])"
oldbinding = a['pm2_raw_binding']; newbinding = b['pm2_raw_binding']
newcalls = [x for x in newbinding.body if isinstance(x,ast.Expr) and isinstance(x.value,ast.Call) and isinstance(x.value.func,ast.Name) and x.value.func.id=='pm2_json_domain']
assert [ast.unparse(x) for x in newcalls] == ['pm2_json_domain(e)','pm2_json_domain(value)']
filtered = ast.FunctionDef(name=newbinding.name,args=newbinding.args,body=[x for x in newbinding.body if x not in newcalls],decorator_list=newbinding.decorator_list,returns=newbinding.returns,type_comment=newbinding.type_comment,type_params=newbinding.type_params)
assert dump(oldbinding) == dump(filtered)
# Confirm the two functions' text differ ONLY by these two lines and one gate line.
oldbinding_bytes = segment(before,oldbinding)
newbinding_bytes = segment(after,newbinding).replace(b'    pm2_json_domain(e)\n',b'').replace(b'    pm2_json_domain(value)\n',b'')
assert oldbinding_bytes == newbinding_bytes
assert segment(before,methods_a['baseline_guard']) == segment(after,methods_b['baseline_guard']).replace(b"        pm2_publish_ready(b['c']['processes'], b['ids'])\n",b'')

pb = (BASE/'prepare-local.py').read_text(); pa = (ROOT/'prepare-local.py').read_text()
prepare = comparison(pb,pa,nodes(pb),nodes(pa))
assert prepare['changed'] == ['CONTROLLER_SHA'] and not prepare['added'] and not prepare['removed']
assert all(prepare['sourceRecords'][name]['fullSourceBytesEqual'] for name in prepare['unchanged'])
assert ast.literal_eval(nodes(pa)['CONTROLLER_SHA'].value) == H(after.encode())

# Retain every preexisting unit-test method; only proto's expected message changes.
def test_methods(text):
    out = {}
    for node in ast.parse(text).body:
        if isinstance(node,ast.ClassDef):
            for method in node.body:
                if isinstance(method,ast.FunctionDef) and method.name.startswith('test_'):
                    out[node.name+'.'+method.name] = method
    return out
unit = {}
for name,oldcount,newcount in [('test_release.py',121,136),('test_prepare_local.py',34,36)]:
    beforetest = (BASE/name).read_text(); aftertest = (ROOT/name).read_text()
    ta,tb = test_methods(beforetest),test_methods(aftertest)
    check = comparison(beforetest,aftertest,ta,tb)
    assert len(ta)==oldcount and len(tb)==newcount and not check['removed']
    expected = ['R3RawTests.test_generation_override_and_container_override_ambiguity_refused'] if name=='test_release.py' else []
    assert check['changed']==expected
    assert all(check['sourceRecords'][x]['fullSourceBytesEqual'] for x in check['unchanged'])
    unit[name] = {'baselineCount':len(ta),'currentCount':len(tb),**check}

# Memory-only compile, no pycache or execution.
for name in (*FILES[:4], 'test_finite_json.py'):
    compile((ROOT/name).read_bytes(),str(ROOT/name),'exec')
logs = {}
for phase, counts in [('baseline',{'release':121,'prepare':34,'finite':6}),('final',{'release':136,'prepare':36,'finite':6})]:
    for kind,count in counts.items():
        name = f'r4-domain-{kind}-tests.txt' if phase=='final' else f'r4-domain-baseline-{kind}-tests.txt'
        path = E/name; text = path.read_text()
        assert f'Ran {count} tests ' in text and text.rstrip().endswith('OK')
        logs[name] = dict(rec(path), tests=count, passed=True)

inputs = {str(p):rec(p) for p in [Path('/home/ubuntu/work/customer-batch/review-fclone-offline.md'),Path('/home/ubuntu/work/customer-batch/review-fclone-offline.json'),Path('/home/ubuntu/work/customer-batch/review-r3-offline.md'),Path('/home/ubuntu/work/customer-batch/fclone-resolved-once/fclone.js'),Path('/home/ubuntu/work/customer-batch/fclone-resolved-once/read-record.json')]}
fclone = inputs['/home/ubuntu/work/customer-batch/fclone-resolved-once/fclone.js']
assert fclone['bytes']==1239 and fclone['sha256']=='9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6'
review = json.loads(Path('/home/ubuntu/work/customer-batch/review-fclone-offline.json').read_text())
assert H(review['comparisonLogCanonical'].encode())==review['comparisonLogSha256']
comparisons = review['comparisonLog']['comparisons']
assert sum(x['group']=='conditional_domain' for x in comparisons)==15
assert sum(x['group']=='legal_json_counterexample' for x in comparisons)==3

rpc = ast.literal_eval(b['RPC'].value).encode()
assert rpc == ast.literal_eval(a['RPC'].value).encode()
pins = ast.literal_eval(b['PM2_GENERATION_PINS'].value)
assert len(pins)==9
aux = [name for name in top['unchanged'] if name.startswith('external_') or name.startswith('EXTERNAL_')]
static = {'status':'OFFLINE_NOT_APPROVED','controller':top,'controllerMethods':methods,'preparer':prepare,'testMethods':unit,
    'baselineGuardCallers':callers,'baselineGuardFirstStatement':ast.unparse(methods_b['baseline_guard'].body[0]),
    'pm2RawBindingOnlyAddedCalls':[ast.unparse(x) for x in newcalls],
    'rpcFullLiteralUtf8Sha256':H(rpc),'rpcFullSourceUnchanged':top['sourceRecords']['RPC']['fullSourceBytesEqual'],
    'generationPins':pins,'unchangedAuxNames':aux,'configWholeSourceUnchanged':top['sourceRecords']['Config']['fullSourceBytesEqual'],
    'ownerScopeUnchanged':all(top['sourceRecords'][x]['fullSourceBytesEqual'] for x in ['OWNER','SCOPE']),
    'memoryCompileOnly':True,'existingUnitTestsAllRetained':True}
put('r4-domain-ast-diff.json',static)
controller_diff = ''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='8dc/release.py',tofile='current/release.py'))
(E/'r4-domain-controller.diff').write_text(controller_diff)
all_diff = ''
for name in FILES:
    all_diff += ''.join(difflib.unified_diff((BASE/name).read_text().splitlines(keepends=True),(ROOT/name).read_text().splitlines(keepends=True),fromfile='8dc/'+name,tofile='current/'+name))
(E/'r4-domain-allowed-files.diff').write_text(all_diff)
source = {'status':'NOT_APPROVED','before':{x:rec(BASE/x) for x in FILES},'after':{x:rec(ROOT/x) for x in FILES},
    'inputs':inputs,'logs':logs,'unmodifiedFiniteJsonTests':rec(ROOT/'test_finite_json.py'),
    'fcloneSourceSha256':fclone['sha256'],'originalFcloneOfflineSamples':15,'originalFcloneLegalJsonProtoCounterexamples':3,
    'newPythonGuardSamples':15,'nodeFcloneExecutedThisTask':False,'mockDiagnosticCaptureExecuted':True,
    'actualCaptureExecuted':False,'remoteStageExecuted':False,'actualAttemptExecuted':False,'actualReloadExecuted':False,
    'controllerApproved':False,'releaseApproved':False,'finalDeployApproval':False,'reloadApproved':False,
    'actualSixSlotsRetainedForecastVerified':False,'actualSixReadyAllTrueVerified':False,
    'scopeUnchangedFromNeverRemoteR4':True,'gitMcpSshServerCliExecuted':False,
    'productionWrites':0,'businessTsJsBuilderChanged':False,
    'stillRequired':['actual fresh14proc','six own actual all-ready true','typed/fullSourceShape/actualfield','fullRetained/complete-byte witness','fresh fullMETA protected trees','new fullpackage/source/tool/owner/nonce/TTL/byte inverse','independent fullpackage approval']}
put('r4-domain-source-and-safety.json',source)
(E/'r4-domain-SHA256SUMS.txt').write_text(''.join(f"{H((ROOT/x).read_bytes())}  {x}\n" for x in FILES))
summary = {'controllerSha256':H(after.encode()),'topAdded':top['added'],'topChanged':top['changed'],'topUnchangedCount':len(top['unchanged']),
    'controllerMethodChanged':methods['changed'],'controllerMethodUnchangedCount':len(methods['unchanged']),
    'preparerChanged':prepare['changed'],'baselineGuardCallers':callers,'rpcSha256':H(rpc),
    'logs':{name:{k:v for k,v in value.items() if k in ('tests','passed','sha256')} for name,value in logs.items()},'status':'NOT_APPROVED'}
print(json.dumps(summary,ensure_ascii=True,sort_keys=True,indent=2))

source_table = '\n'.join(f"| `{name}` | {source['after'][name]['bytes']} | `{source['after'][name]['sha256']}` |" for name in FILES)
log_table = '\n'.join(f"| `{name}` | {value['tests']}/{value['tests']} | `{value['sha256']}` |" for name,value in logs.items())
report = f'''# R4 domain：最小纯 JSON guard 与零写 pub pre-gate

**NOT_APPROVED。controllerApproved=false / releaseApproved=false / finalDeployApproval=false / reloadApproved=false。**

本轮精确基线 `8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0`，已在任何修改前保存六文件到 `r4-domain-baseline-8dc/`。当前 controller **`{H(after.encode())}`**，preparer 固定 pin 准确一致。OWNER/SCOPE 不变；R4 从未 remote/stage/capture/attempt，因此仅静态更新 pin，不再迭代 scope。

## 1. 来源与最窄修正

仅读取本地固定 review-fclone-offline.md/json、review-r3-offline.md、实际 fclone.js/read-record。fclone 1239 bytes，SHA `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`；离线审 comparisonLogCanonical 实际 hash `{review['comparisonLogSha256']}` 与记录匹配。原离线 15 条限定 clone 样本和三条合法 JSON __proto__ 反例仍只是局部源审，不是新的 daemon witness，也未重跑 Node/fclone。

`pm2_json_domain` 是 pure recursive guard，完整检查 model.pm2_env e 与 actual serialized value，且在 deepcopy/forecast 前。拒绝任意层 __proto__ key、非标准 JSON 类型/key、非 finite float、abs(int)>=2**53、cycle/shared Python container、lone surrogate 的 strict UTF-8 编码失败和不支持的递归深度。有限 float 为 Python binary64，允许 max finite/subnormal/1e20；不误套 PM2 生成整数政策。root e 已要求 dict，故 Utility.clone 根 null→{{}} 的边界不适用 e，但没有隐去该事实。

不删、不洗、不重编码、不 canonicalize；普通 constructor/prototype/toString 数据 key 保持，opaque JSON-looking string 不递归 parse。原 decoder 合法 JS UTF-16 字符串政策未改；孤 surrogate 原 forecast 已 strict 编码失败，现有限证明域提前以 ReleaseError 拒绝，绝不替换。

**不能从 JSON 投影反推 original daemon prototypes/functions/special/accessors/undefined/symbol/graph shape**；pure JSON guard 不代替 actual typed/fullSourceShape/fullRetained/complete-byte witness。unknown typed/full witness 仍需新的 actual 核验。

## 2. 零写 pub gate，不变恢复协议

R3 固定审 `review-r3-offline.md:69–86` 调查旧流程：合法 false 可在 attempt/open/assets/API CAS 后才由单槽 reload gate 拒绝，mixed front-ready/admin-false 可先滚前台。这是 controlled failure，不是成功绕过。本轮新增入口 precondition，不改 state/rollback/receipt/成功定义。

`baseline_guard` 第一条语句为 `{ast.unparse(methods_b['baseline_guard'].body[0])}`，拒绝六 own 非全 literal True：`PM2_SIX_OWN_NOT_ALL_READY_NO_ATTEMPT_NO_PUBLISH`。AST 调用图精确仅 `preflight` 和 `apply`，故早于 receipt mkdir / attempt / window / immutable / API / intent / RPC；恢复方法不调用它。先查已封包 capture 的 six readiness，再由既有 exact snapshot equality 拒绝 true→false/其它漂移。依原 identity 返回 b.ids，只检查 six own；不检查 unowned/外部辅助 readiness，不硬造新身份政策。合成 fixture 使用 actual six ID 190/191/192/193/194/200。

capture/identity 可记录并接受合法 false；candidate/preparer 不增加审批或封印策略；单槽 `PM2_MODEL_FORK_RETAINED_BYTES_UNPROVEN_NO_RELOAD` 原全文保持。全部 rollback/restore/guard/state/journal/receipt 方法全文不变，必要恢复不被 pub gate 阻断。

## 3. 测试与差量证据

修改前 **121/34/6** 重跑全部通过；最终 **136/36/6** 全部通过，原测试方法全部保留。controller 新增 15 方法、preparer 新增 2 方法，finite 六方法未修改；一个旧 __proto__ override 用例预期补充更早 domain 拒绝。旧 late direct 单 reload 方法全文保持，仍仅手工开临时 window 与 API fixture，验证无新 intent/adapter；不是端到端实际先写。

新域反例涵盖 model/raw 两侧 × root/env/nested opaque/list × 三 __proto__ value，均检查完整 source/env/value/raw 未被清洗、forecast 未调用；15 个 finite/UTF-8 Python guard/deepcopy 样本非 Node clone 新验证。safe整数边界、finite float、non-JSON、surrogate key/value、constructor 普通 key、opaque string、cycle/shared 均覆盖。

四个 all-false/mixed × preflight/apply 用例逐项断言 exclusive/attempt、新 receipt、window、immutable、API CAS、intent、reload adapter、RPC 全 0，并比较**整个** temporary tree 的 bytes 与 full META before==after。mock diagnostic capture 返回 false（无输出 capture 文件），identity false 接受，preparer 对象-only输入接受 false；手工打开 false journal 能 restore/guard。all-ready mock 成功仍不是 actual all true 或审批。

初轮新增 raw fixture 重用了已有 opaque key，旧 duplicate-key 更早拒绝；保留 `r4-domain-release-tests-initial.txt`，只将测试新增 key 改为 domainWitness，无生产补丁/放宽。最终测试代码与日志 SHA 下表精确绑定。

| 日志 | 通过 | SHA-256 |
|---|---:|---|
{log_table}

准确 AST 增量：顶层新增 `pm2_json_domain`/`pm2_publish_ready`，既有顶层仅 `pm2_raw_binding`/`Controller` 改变，**{len(top['unchanged'])} 项既有顶层 AST 与全文 bytes 不变**。Controller 内仅 baseline_guard 改变，**{len(methods['unchanged'])} 方法 AST/全文 bytes 不变**。剔除新增两行 guard 调用后 pm2_raw_binding 的 AST/全文 bytes 与基线精确相等；剔除 baseline_guard 一行后同样精确相等。preparer 仅 CONTROLLER_SHA 改变，其余 AST/全文 bytes 保持。

OWNER/SCOPE/Config(extraProtect)/九 PM2_GENERATION_PINS/RPC/full external aux/source/root/transport/metadata/raw-retained helper 全文保持；RPC literal UTF-8 SHA `{H(rpc)}`。详见 `r4-domain-ast-diff.json`、`r4-domain-controller.diff`、`r4-domain-allowed-files.diff`、`r4-domain-source-and-safety.json` 与 `r4-domain-audit-output.txt`；编译只是内存 compile，无 pycache/模块执行。

| 当前六文件 | bytes | SHA-256 |
|---|---:|---|
{source_table}

## 4. 未执行与全部剩余 hold

只修改授权六文件及 evidence/r4-domain-*。无 Git/MCP/SSH/server/业务/TS/JS builder 修改或执行、网络/真实 Node/vendor 模块/RPC、实际 capture、生产 CLI/stage/attempt/window/approval/reload。所有测试 mutation 只在 TemporaryDirectory/mock；上面的 mock capture 调用与 actual capture 明确区分。

**actualSixReadyAllTrueVerified=false；actualSixSlotsRetainedForecastVerified=false。** 主任务仍须 actual fresh14proc（12 PM2 + 2 aux）、六 own Ready all literal True 的当次 hash-bound 证据、typed/fullSourceShape/actualfield/fullRetained/complete-byte witness、fresh full protected trees/fullMETA、真实 new fullpackage/manifest/source/tool/owner/nonce/TTL/正逆字节、独立 fullpackage 审查及后续明确部署许可。新 all-ready precondition 只是必要门槛，不能当 actual true 或 approve。

**最终：NOT_APPROVED，所有 approval 值 false。**
'''
(E/'r4-domain-report.md').write_text(report)
