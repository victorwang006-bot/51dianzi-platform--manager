# R8：proc 虚拟 metadata 缓存假漂移的最窄离线修复

## 当前结论

状态 **PROC_VIRTUAL_META_FIX_NOT_APPROVED**。本轮完成必要 source 修复、纯本地合成回归、精确六文件直接差异和 AST/字节核验；不表示实际运行再验证或发布批准。

当前 controller SHA256：

```text
586166f7ddf48235b6a28e2237d7b1f64cbf3709d1af484388a67b086f0ecaef
```

当前 `SCOPE=customer-batch-actions-20261120-6Lfttf6o-R8`，`OWNER=6Lfttf6oVWJ8YS69o5FkXQ` 不变。`prepare-local.py` 固定 pin 与当前 release 字节相同；其余所有准备器顶层节点/函数/CLI/行为完全不变。默认 stage 仅随 scope 派生为 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R8`，本轮未访问或创建真实 stage，不覆盖上传的 R7 source/stage。

六文件修改前的准确 R7 源码已先保存在 `r8-baseline-a555/`，附 `SHA256SUMS`。原 release H 为 `a555022329eed9c2b72efa2aa0668b9a84d33148da4bee5cc9ba5bd579866e5b`。完整六文件当前/基线哈希与 test log H 见 `r8-source-and-safety.json`。

## 已证实实际事实，而非错误标签推测

依据父任务已写且本轮未改字节的 `r8-proc-virtual-source.md`：13:04 R7 pinned 同路径 actual-once 诊断在 `DYNAMIC_FINAL_FULL_PROC_DRIFT` 处拒绝。before/after 15 Node 集合、scan entry identity、comm、cmdline H 一致。唯一差异为 PID1 `kernelLinkMeta` 的 exe/cwd procsymlink cache-generated inode 与初始化 mtime/ctime：exe ino `143596644→143742357`、cwd ino `143480214→143742561`；dev/statmode/uid/gid/nlink/size、实际目标、真实 source/meta 和其余 fullRecord 不变。

因此把该次拒绝仅按 label 概括为 Node 集合漂移不准确。此前其它失败没有保留同样字段差异，**不能将所有旧错误倒推为本次相同原因**。本轮未读取真实诊断文件 `/home/ubuntu/work/customer-batch/r7-samepath-diagnostic-once.json`，未采样任何真实 proc/env 或 FD 内容。

父任务已核实官方 Linux `proc_pid_make_inode` 使用 `new_inode/get_next_ino/simple_inode_init_ts`，proc inode 为缓存前不存在、动态创建的虚拟条目。它们的 ino 和初始时间是 cache instance 元数据，不是持续的 task/exe 身份。打开 proc directory FD 不阻止 PID reuse；exe 实际 pathname 与 deleted 语义仍必须严格保护。官方 refs 保留在原父报告，本轮无重搜索、联网或新 runtime 依赖，也不声称实际运行内核整源码 H 已证实。

## 精确实现面

新增唯一 helper `dynamic_proc_virtual_meta(cfg,pid,path)`。它接受正整数 PID、canonical 绝对 cfg.proc 根与 canonical path；只允许 **准确 `cfg.proc/PID` 目录及准确 `cfg.proc/PID/exe`、`cfg.proc/PID/cwd` 两个链接**。不是通用 metadata filter，不用宽泛 startswith，不允许其它 PID、lookalike/nested/outside/真实 source 或 CWD 路径。原 `no_link` 继续保护 proc parent directory；原 OS `lstat` 通过 `meta()` 获得九字段，schema exact 校验及整数校验后分别要求 `S_ISDIR`/`S_ISLNK`。

canonical 表达只排除 **ino、mtimeNs、ctimeNs** 三项 cache-generated 字段，保留 **dev、statmode、uid、gid、nlink、size**，并明确增加 `schema='proc-virtual-meta-r8'`、exact `path`/`parent`/`kind` 注释。目录也适用，避免只修 symlink 后目录 cache 再生仍假漂移。mock 使用原 test-only cfg.mock 的 TemporaryDirectory/PID 结构；没有新增 cfg/CLI override、fallback、production mock 路由、statfs 属性假设、O_PATH 大量持 FD、跨独立进程 pinned cache、权限提升或系统 runtime 调整。

只在 `dynamic_proc` 中替换四处调用表达：初次 PID 目录 meta、初次 exe/cwd links meta、闭合目录 meta、闭合 links meta。审计将这四处调用还原为原 `meta(path)` 后，`dynamic_proc` **整个 AST 与基线完全相同**。外层 schema 版本不改，避免 Controller/准备器/审批协议额外变更。

实际 exe/cwd 仍由原 `external_proc_link` 解析真实目标，deleted/noncanonical/symlink 真实目标的原 guard 保持，readlink target before/after equality 未改。PID/PPID/startTicks/comm、cmd/env 全 raw equality/H、permissions、mappedSourceIdentity dev/ino、source bytes/fullH/fullMETA、dynamic scan dictionary、native exact-two hardlink pins、io_uring kernel records、six-owned stable routing 与全部阶段/末端 reread 都保持。普通真实 CWD/root/source/API/lock/inventory/transport/meta 的 ino/mtimeNs/ctimeNs **一项都未排除**。历史 fixture-only fixed-pair helpers 没有换用本 helper。

## 精确审计

`r8-ast-diff.json` 与可重复 `r8-audit.py` 验证：release 顶层只改 `SCOPE` 与 `dynamic_proc`，只新增该 helper；其余全部顶层节点 AST 和精确 source 段字节相同。**Controller 30 个方法/整个类、原九 pin guard labels、Config/config_binding、RPC/production_reload、domain/JSON decoder、CAS、Root/inventory/transport、identity/scan/maps、budget/native source read、dynamic sample/final phases/six-owned stable 均完全不变。** 准备器仅 `CONTROLLER_SHA` 常量改变，所有函数和 CLI 字节不变。

原 276 release 和 42 preparer test 方法全部保留；只有三个既有 test 方法中的固定 current scope/stage 断言同步 R8（release 两个方法、preparer 一个方法，共四个文字断言）。新增 28 controller 方法和 2 preparer 方法。所有原 rawenv/opaque/Node birth/drop/PID reuse/native two-pin/io_uring/末端阶段反例仍在并通过。`r8-six-files.patch` 是基线对六文件当前内容的直接 unified diff，不依赖 Git。

## 测试事实

| 检验 | 结果 | 日志 |
|---|---:|---|
| 修改前原 release | 276 PASS | `r8-baseline-release-tests.txt` |
| 修改前原 preparer | 42 PASS | `r8-baseline-prepare-tests.txt` |
| 当前完整 release（原 276＋新 28） | 304 PASS | `r8-release-tests.txt` |
| 当前完整 preparer（原 42＋新 2） | 44 PASS | `r8-prepare-tests.txt` |
| 新 R8 controller 独立 | 28 PASS | `r8-new-release-tests.txt` |
| 新 R8 preparer 独立 | 2 PASS | `r8-new-prepare-tests.txt` |
| 限定 r8 evidence 的 finite decoder 双版本再验证 | 6 PASS | `r8-finite-tests.txt` |

新增测试覆盖三个字段逐读合法再生、fakeproc 实际 symlink 同 target 重建、完整 graph/末端 cache 再生可通过，同时 schema/path/parent/kind 均准确；保留六字段每一项在 directory/exe/cwd 上漂移均拒绝，PID/startTicks/PPID/comm、exe/cwd target、真实 CWD ino/mtime/ctime、真实 source 三字段及 late-final retained meta 漂移仍拒绝。旧 R7 scope 和准确 a555 source/capture pin 在 prepare inputs/import 前拒绝，输出不存在、builder 调用为空。合法缓存再生仍 `semanticsClosed=false`、`sourceGraphReviewRequired=true`，不变成 approval。

**finite caveat：** 用户限制只改/访问六文件及 r8 evidence，本轮未读取或执行独立第七文件 `test_finite_json.py`。为不突破该限制，建立 `r8-finite-tests.py` 六项有限 JSON 测试，分别运行准确 a555 baseline 与当前 decoder，涵盖正负指数 overflow、非 finite constants、嵌套/duplicate、合法有限极值/underflow/integer、opaque string/Unicode roundtrip。其六方法均 PASS；这不是声称该单独历史 suite 已执行。原 decoder AST/字节完全相同。父任务若要求原历史六项日志本身，需在其既有权限范围另跑该原文件，不必改变本修复。

完整当前回归使用 `r8-offline-test-runner.py`，先将本 Python 进程 `os.environ` 替换为纯合成字典，不读取 OS 环境原值；原 subprocess/HTTP/RPC adapter 仍由既有 tests mock/block。所有 mutable fixtures 仍只在 TemporaryDirectory；没有真实 prepare/build/candidate/seal/capture CLI、应用执行或包审批。

## 不批准与后续边界

```text
controllerApproved=false
releaseApproved=false
finalDeployApproval=false
reloadApproved=false
typedSemanticsApproved=false
sourceGraphApproved=false
fullPackageApproved=false
productionWrites=0
```

本轮无 Git/MCP/SSH/Node、真实 proc/proc environ/FD 内容、server/reload、production capture/attempt/window/activewrite 或上传。没有触碰父报告原字节或旧 R7 source/stage。纯离线 bugfix 不是 typed/source/全包审批，不减掉原安全门槛，也不将用户原上线授权变成已经通过审批或已经上线的事实。

父任务仍须按原权限及原门槛，对这个精确 source H、新 scope、新真实 fresh fullMETA/source graph/Typed/retained witness/sixReady/新完整包与独立 review 继续推进；本报告不要求停止或撤销用户原上线授权。
