#!/usr/bin/env python3
"""Offline documentation only."""
from pathlib import Path
ROOT = Path(__file__).absolute().parent.parent
header = '''# 客户批次 R6：精确 io_uring kernel anonymous mapping（NOT_APPROVED）

当前全新 SCOPE 为 **`customer-batch-actions-20261120-6Lfttf6o-R6`**，OWNER 仍为 `6Lfttf6oVWJ8YS69o5FkXQ`。当前 release SHA256 为 **`fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`**，preparer 固 pin 同步；派生 stage 为 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R6`，本离线任务未创建或访问真实 stage，不覆盖旧 R5 stage/source。

修改前准确保存 stable `36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14` 六文件到 `evidence/r6-baseline-36706f/`，逐字节/哈希核对，原 **212/38/6** 全通过。当前 **246/40/6** 全通过，新增 **34 controller＋2 preparer** 方法独立通过，原 212/38 方法定义全部保留，仅 current scope/stage 断言同步。完整本轮事实见 **[R6 报告](evidence/r6-report.md)**；静态 AST/字节/9pins/Controller30 核验见 `evidence/r6-ast-diff.json`；current source/log SHA 见 `evidence/r6-source-and-safety.json`；六文件差异见 `evidence/r6-six-files.patch`。

## R6 必要最小类型支持

`dynamic_maps` 的原 absolute file-backed fullpath/H/fullMETA/multiplicity/perms/offset/dev/inode 分支完全保持。原 perline format AST 原样提取为 pure `dynamic_map_fields`。relative branch 仅精确 `b'anon_inode:[io_uring]'` 经非执行共享权限、合法 device 字段、positive inode、正映射长度验证后作为 kernel anonymous SQ/CQ 数据映射；不泛化其它 anon_inode、unknown/lookalike/deleted/exec/private/inode0。绝对 io_uring-looking 路径仍走原 file source 保护而非匿名豁免；原 heap/stack/vdso/named bracket 政策不重写。

pure `dynamic_kernel_mappings(rawmaps)` 记录 `[exactName, permissions, offset, device, inode, mappedLength]`，完整排序列表保留 multiplicity、不 dedup；`mappedLength = end-start`，绝对 ASLR 位置不入指纹。kernel anon 不是 ELF/FS source，不 require_read_regular、不加 kernel source H，也不读 FD/log/queue 内容。`dynamic_proc.kernelAnonymousMappings` 在第二 maps 读取精确比较并进入所有 foreign 全 transport equality；new/drop/multiplicity/permissions/offset/dev/inode/length 漂移仍 guard reject，包括 main/extra God、unowned 六槽和 parent graph。

six-owned stableSlots **ONLY execution-source graph** 保持原 AST/字节，不纳入运行期新 ring inode/meta；合法 roll 新 inode 不干扰 transport，每次样本仍先严格 typed validation、原 own proof 和完整进程复核。所有 **9pins、Controller30、Config extraProtect/fullTree、transport/RPC/domain、6 own raw、Root/meta/CAS/budget** 未改。mutable API 仍由原 inventory/CAS 保护，不能借匿名类型逃逸。unknown Node 始终 fresh 动态枚举、birth/death/reuse guard，不固定实际 count；捕获不代表 unknown-codegraph semantic approval。

Linux 类型依据由父任务已 search/fetch：[`io_uring_get_file`](https://raw.githubusercontent.com/torvalds/linux/master/io_uring/io_uring.c) 用 `anon_inode_create_getfile("[io_uring]", &io_uring_fops, ..., O_RDWR|O_CLOEXEC)`，kernel 注释为用户 mmap SQ/CQ details；[io_uring(7)](https://man7.org/linux/man-pages/man7/io_uring.7.html) 描述 `PROT_READ|PROT_WRITE`、`MAP_SHARED` ring data；[proc_pid_maps(5)](https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html) 定义各 fields。本任务不再联网，不新增系统源码运行时依赖。

## 实际状态来源与未审批边界

父任务传达：R5 11:55 首次 privatecontroller 上传后的 READONLY capture 因 `DYNAMIC_UNSUPPORTED_MAPPING` 拒绝，未生成 capture/attempt/window/activewrite/reload；11:56 单有界纯只读 diagnostic 已完成，当前 20 Node+parent，17 Node PID 的 110 个 unsupported path 全精确 io_uring、rw-s、00:0f、positive inodes。`/home/ubuntu/work/customer-batch/r5-mapping-diagnostic-once.json` **不是源码文件**，本轮未读取、更未按 source 路径读入 H/META。新增 unknown Node 2064149/2064150 必须由父任务后续 fresh 集合与 unknown-codegraph 审覆盖，不能用 diagnostic 静态 count 代替。

**R6 仍 NOT_APPROVED。** 本轮纯离线，没有 Git/MCP/SSH/prodCLI/Node/实际proc/server/DB/reload/capture，没有真实 capture/fullMETA/完整 sourcegraph/新包审批或 publication。父任务传达 actual six Readiness 已 once 6 literal True，但不是 typed semantics/fullMETA/整个包审批。父任务负责协调 fresh 窗口和原全套 H/META、6 own raw/readiness、unknown graph、byteWitness/CAS/budget、准确 R6 source/scope/pin 与完整新包独立审；旧 stage/source/capture/review 不复用。

## 以下 R5 及更早内容为历史，不是当前 pin、capture 状态或部署许可

旧段落中“最新/当前”只指当时 R5/R4 快照；R6 一律以上方与 `evidence/r6-report.md` 为准。历史“未上传/无capture”记录不能覆盖上方父任务传达的 11:55 R5 真实拒绝事实。历史源码/测试证据保留，未改旧 evidence。

---

'''
path = ROOT/'README.md'
text = path.read_text()
assert text.startswith('# 客户批次 R5：')
path.write_text(header + text)

prepare_header = '''# 客户批次 R6：仅本地准备器（NOT_APPROVED）

当前 **CONTROLLER_SHA = `fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`**，全新 SCOPE **`customer-batch-actions-20261120-6Lfttf6o-R6`** 直接取 `release.SCOPE`；OWNER `6Lfttf6oVWJ8YS69o5FkXQ` 不变。本轮 preparer 所有函数 AST/字节完全不变，仅固定 controller pin 更新。不得复用旧 R5 stage/source、capture/seed/review 或准确 36706f 历史 source pin。

准确 stable36706f 六文件先保存在 `evidence/r6-baseline-36706f/`，原 **212/38/6** 全通过；当前 **246/40/6** 全通过。新增 **2** preparer TempDir mock 方法独立通过：旧 R5 scope 拒绝，旧准确 36706f source bytes 在 pin 检查处拒绝且不 import，同时旧 capture controllerSha 拒绝；原 **38** 方法定义全部保留，仅当前 scope/stage 断言同步。新增 controller **34** typed mapping/foreign transport/owned roll/unknown guard 方法也独立通过。

R6 只为精确 Linux `anon_inode:[io_uring]` 的非执行共享、positive inode、合法 device、正长度映射加类型支持；不是 FS/ELF source，不读 FD/log/queue，不将匿名条目伪装 sourcePaths。foreign record 完整进入 transport equality；six own execution-source stableSlots 不含运行期 ring inode，原 own proof/snapshot、所有 9pins/Controller30/Config extraProtect/fullTree/RPC/domain/Root/META/CAS/budget 不变。完整依据、字段及拒绝策略见 **[R6 报告](evidence/r6-report.md)** 和 `README.md`，精确差异/静态审计/source与日志SHA见 `evidence/r6-six-files.patch`、`evidence/r6-ast-diff.json`、`evidence/r6-source-and-safety.json`。

**仍 NOT_APPROVED。** 本任务只离线 Python mock 与文本/AST/哈希工程，无真实 capture/fullMETA/sourcegraph/包审批，无 Git/MCP/SSH/prodCLI/Node/实际 proc/server/DB/reload。父任务传达 R5 11:55 READONLY capture 因 mapping 拒绝且未产出 capture/attempt/window/activewrite/reload，11:56 diagnostic 仅为类型诊断并非 source/capture approval；本轮没有读取 diagnostic 文件。actual six Readiness once6True 不是 fullMETA/typed semantics/unknown sourcegraph 或全新包审批。后续必须由父任务 fresh 完整动态集合（包括新 unknown）及所有原门槛，绑定准确新 R6 pin/scope，不复用旧 R5 输入。

## 以下 R5 及更早内容仅为历史，非 R6 当前 pin/scope/approval

历史“当前/最新/未上传”按当时快照理解；本轮以以上 R6 段落、`README.md` 和 `evidence/r6-report.md` 为准。旧证据不覆盖上方真实 R5 capture 拒绝事实，不挪用历史 source/witness/review。

---

'''
path = ROOT/'prepare-local.README.md'
text = path.read_text()
assert text.startswith('# 客户批次：R5')
path.write_text(prepare_header + text)
