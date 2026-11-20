from pathlib import Path
import json
import hashlib
base=Path('/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119')
ev=base/'evidence'
a=json.loads((ev/'r4-ast-diff.json').read_text())
s=json.loads((ev/'r4-source-and-safety.json').read_text())
l=json.loads((ev/'r4-test-log-hashes.json').read_text())
rows='\n'.join('| '+name+' | '+v['currentSha256']+' |' for name,v in s['sourceFiles'].items())
logs='\n'.join('| '+name+' | '+v['sha256']+' | '+str(v['bytes'])+' |' for name,v in l.items())
changed=', '.join('`'+v['name']+'`' for v in a['release.py']['changed'])
added=', '.join('`'+v['name']+'`' for v in a['release.py']['added'])
byteblocks='\n'.join('| '+v['operation']+' | ['+str(v['beforeByteStart'])+','+str(v['beforeByteEnd'])+') | ['+str(v['afterByteStart'])+','+str(v['afterByteEnd'])+') |' for v in a['releaseByteDiffBlocks'])
report=f'''# R4 最小离线保护实现报告

**状态：NOT_APPROVED；controllerApproved=false；finalDeployApproval=false。**

## 交付边界

准确 bf7 release 基线 `bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab` 及当时六文件已在 `evidence/r4-baseline-bf7ec85b/` 逐字节保存/哈希核对。只改授权六文件和 evidence/r4-*；OWNER `6Lfttf6oVWJ8YS69o5FkXQ` 不变，新 scope `customer-batch-actions-20261120-6Lfttf6o-R4`。没有业务/UI/TS/JS builder/Git/MCP/SSH/prod/真实Node或模块执行、生产CLI、capture/attempt/stage/reload；现有测试内的 lock/CAS/journal/receipt 全临时 fixture/mock，非真实生产操作。

## 最小实现

1. Config.extra_protected 原两 env + varprivate 不变，追加完整推荐 Ops 和精确 childcwd 两树；原 union/inventory 逐字节不变负责 fullMETA/hash/所有目录空目录/精确集合。
2. 新 pure readonly helper 固定两个 PID，flock 父 + node-22 子，绑定 PPID/startTicks/known exact bootstrap/cwd。实际 exe 从内核 readlink 读取不猜路径，full SHA 验 cfg.node；exe/script 单链接非symlink regular、deleted/unsupported links 拒绝。proc virtual stat/env/cmd 使用既有 read_bytes 而非 st_size=0 regular 文件校验；每个 proc 读前后身份/meta/link 稳定，再两次完整 proc pair + sources + rootMETA sample 必须相等。
3. whole opaque env/cmd SHA 无 normalization，无私值输出；permissions/meta/parent cwd shallow META 记录比较，不递归未知 parentcwd。异常缺PID/复用/父当Node/错误PPID/异常argv/loader/exe/script/cwd/source等无fallback、不启动杀进程、不reload。fixture路径仅 cfg.mock=True 可定向，默认mock skip明确 fixtureOnly；没有生产或CLI override。
4. transport 外部记录与实际 exe/script fullSourceMeta/sources/rootMeta 固定；sources 合并进原固定source pins。原 Controller 全 transport equality 自动保护，不改变12 PM2 schema/六 own rolling/NodeUnique/五 metadata/loopback budget/env/CAS/forecast/journal/receipt。
5. 仅新增已获准精确交接 `modules/fclone.js` SHA `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`（1239 bytes），原八source pins全保留；无extra require/loader改动/扫描。主任务负责actual生成语义与完整 retainedWitness。

## 精确 AST 与字节保留

release 旧有顶层 AST 改动仅：{changed}。Config 除 extra_protected AST 以外完全不变。新增：{added}。没有删除原 AST。

整个 Controller 类及全部 **{a['controllerProof']['methodCount']}** 方法 AST 与源码字节相同；capture/bundle/snapshot/guard/reload/state/receipt/health等均未改。所有旧 helper 除 transport 外 AST+源码字节均相同，含 identity/schema、config_binding、union/inventory、permissions、raw/model/meta/forecast 等。preparer 唯一 AST 和字节差量是 CONTROLLER_SHA；所有方法/原schema/流程字节不变，SCOPE直接引用release.SCOPE不另添pin。

RPC payload 逐字节未改，SHA256 **`{a['rpcProof']['rpcPayloadSha256']}`**；RPC literal与rpc函数两者源码byte H/前后range在 r4-ast-diff.json。sourcePolicy原8项逐项相同，唯一新增fclone准确sourceMap项证明同文件。

controller diff 的字节区间（0-based，半开；每块精确原/新SHA在JSON）：

| 操作 | bf7字节区间 | R4字节区间 |
|---|---|---|
{byteblocks}

详细证据：`r4-ast-diff.json`（每个顶层/方法字节范围、AST H、source H，所有未改项），`r4-controller.diff`，`r4-transport.diff`，`r4-allowed-files.diff`，可重复的 `r4-audit.py` 与实际stdout `r4-audit-output.txt`。

## 离线验证

原 **89/32/6** 测试方法全部保留。实际运行 **121 controller + 34 preparer + 6 JSON** 全通过。32个新增controller方法覆盖固定非PM2关系、双采样及sample内身份竞态、PID缺失/复用、父Node/argv0/PPID循环/子启动早于父、whole cmd/env/permissions、actual exe path与fullSHA、exactbootstrap/cwd、file/proc/source/root META、deleted/link/hardlink、精确根缺失/祖先假覆盖、full-tree嵌套新增集合、原guard拒绝、transport探针期间漂移及fclone缺失/漂移。全部新fixture来自TempDirectory，不执行真实adapter。

首轮仅测试预期错误：root直接新增先触发transport rootMETA拒绝，已只改测试为嵌套空目录新增验证既有inventory集合，生产逻辑未放宽。首轮日志保留 `r4-release-tests-initial.txt`、`r4-prepare-tests-initial.txt`、`r4-finite-tests-initial.txt`。

当前源文件 SHA256：

| 文件 | SHA256 |
|---|---|
{rows}

最终测试日志实际 SHA256/bytes：

| 文件 | SHA256 | bytes |
|---|---|---:|
{logs}

## 尚需主任务

fresh14proc 完整实际 identity/env/cmd/permissions/source/root/fullMETA 与当前全Ops+childcwd保护树内容和未知loader/dependency语义审查；fclone 实际源码独立生成语义、完整 retainedWitness/fullforecast；真实新 fullpackage/manifest/packageFiles/owner/nonce/source/tool/全部正逆字节；independent fullpackage审批和当次正式部署授权。源pin和mock通过不是freshmeta、不是批准，unknown semantics 不伪称closed。没有真实capture/stage/attempt/window/reload，**仍NOT_APPROVED**。
'''
(ev/'r4-report.md').write_text(report)
manifest=[]
for p in sorted(ev.glob('r4-*')):
    if p.is_dir():
        files=sorted(p.rglob('*'))
    else:
        files=[p]
    for f in files:
        if f.is_file() and f.name!='r4-SHA256SUMS.txt':
            manifest.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+str(f.relative_to(base)))
for name in s['sourceFiles']:
    f=base/name;manifest.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+name)
(ev/'r4-SHA256SUMS.txt').write_text('\n'.join(manifest)+'\n')
print('R4 report and SHA256 manifest written')
