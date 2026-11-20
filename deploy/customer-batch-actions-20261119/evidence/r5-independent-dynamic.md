# R5 dynamic foreignproc 独立离线增量审查

## 结论与边界

**NOT_APPROVED。本次动态 collector 增量尚不能判定为满足全部既定安全约束：发现两项纯本地可复现的 accepted 缺陷，均有窄修位置。** fixed PID 退出现行生产路由本身合理；其余所列动态保护大体成立。这里不是完整 package 审批，也没有发现或声称 Controller 发布链已被绕过。

`controllerApproved=false`、`releaseApproved=false`、`finalDeployApproval=false`、`reloadApproved=false`。前台 list/detail 当前尚未 actual closed；backend stage/capture/window/attempt/write/reload 均为 0。用户已有扩容后上线授权不需要重复确认，但不能代替本审查之外的 fresh 证据及完整包独立审批。

审查只读取本地稳定源码、baseline、R5 report/ASTdiff/source-safety 和日志。独立计算 SHA/AST/原字节；没有 import 或运行 release/tests/reference 模块，也没有全量重跑测试。额外仅从 AST 选取 pure helpers，在 `TemporaryDirectory(prefix='review-r5-dynamic-offline-')` 中构造虚拟 proc/源文件进行最小探针。没有真实 `/proc`、Node、应用模块、RPC、prodCLI、MCP、SSH、网络、Git、服务器、DB、锁、capture、reload 或生产读写。审查脚本自身先后有 AST 字节切片及 helper 依赖遗漏的本地装配错误，补齐后探针完整成功；不涉及源码/tests 修改。

## 准确对象与独立不变性核验

- 当前 `release.py`：`f544c1663d84350df0ff036b7e1b330a8cfcb016e64d705027ff86411a26ed5d`。
- baseline `evidence/r5-baseline-4fe/release.py`：`4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121`。
- sourceDiscovery reference：`/home/ubuntu/51-manager/deploy/self-search-detail-demo-20261120/read-only/probe-live-runtime.py`，SHA `64df69ac84db1a4a662eabc70b91b06f46130f0675d29a1798ebedf0bd440782`。仅阅读；其 Node/RPC、锁、FD 等 unsafe 部分没有执行或照抄。
- 新 SCOPE：`customer-batch-actions-20261120-6Lfttf6o-R5`；OWNER 未变。

独立 AST 与精确原字节对照确认：既有定义只改变 `Config`、`external_protection`；既有顶层常量只改变 `SCOPE`。`Controller` 全类及全部 **30 个方法**不变，`transport`、`rpc`/RPC literal、`snapshot_rows`、`identity`、`inventory`、`config_binding` 以及全部 **9 个 PM2 source pins** 不变。原 Config 全部字段 AST/字节不变，仅增加 `execution_sources`、`execution_roots`；preparer 全部既有定义 AST/字节不变。未重审原业务/UI/PM2 metadata/domain/forecast/CAS/journal/receipt 协议。

新增 known bootstrap source 为明确路径 H/fullMETA；shadow 仅 shallow root META。Ops 与 recommendation childcwd 仍在原 `extra_protected` 的完整 inventory 树中，未用 shallow 替换或删掉保护。没有递归 shadow 或 `/root` 的新扫描。

## 真正缺陷

### R5-F1：malformed owned env 仍享有 transport 豁免

**位置：`release.py:944–973`，特别是 948–955 的解析后至 963–968 的绑定条件。** `dynamic_owned` 校验 outer 无重复、serialized 顶层 object、六 literal ID/name/script/cluster、kernel exe、actual/serialized cwd、父 God 及 Node H；但未要求 serialized `env` 为 object，也未要求 outer `NODE_UNIQUE_ID` 存在且为 decimal。随后 `1030–1034` 将这些进程加入 own set，`1063` 从 foreign full records 排除它们。

纯 TempDir 完整 `dynamic_protection` 探针保持同一 PID、父、源码、argv、cwd 及六槽，只将 slot190 的 serialized `env` 分别改为 `[]`、`"scalar"`、`null`。**三者均被 collector 接受，slot190 PID 仍被排除在 `processes` 外，整个 collector 返回值与修改前完全相同。** 另将 outer `NODE_UNIQUE_ID` 改成 `not-decimal` 或删除，同样接受且 transport 外部保护对象不变。这不是合法 roll 所需的 PID/raw 例外，而是题设明确禁止的 wrong envshape/type 仍 own 豁免。

**影响严格限于新 collector 的 own 分类/transport 漏拒。** 原 `pm2_raw_binding` 对上述三种 env 形状仍返回 `PM2_ENV_OBJECT_REQUIRED`（`519–520`），原 `raw_semantics(..., own=True)` 仍要求 decimal `NODE_UNIQUE_ID`（`423–424`）；原 snapshot/identity/sixReady 链未被修改。因此不能把这项描述成已实现的完整 Controller 发布绕过。

**最窄修复建议：** 在 `dynamic_owned` 返回 own 之前补上现有协议已经要求的 serialized env-object 与 outer NODE_UNIQUE_ID 存在/decimal 的形状门禁。无须将整个 forecast、RPC model 或原协议复制进 collector；不得为了弥补形状门禁而把合法 own PID/raw/start/权限重新放进 stable transport。增加同 PID malformed shape/type 拒绝的纯 fixture 回归即可。此次未修改源码/tests。

### R5-F2：file-backed mapping 去重掩盖实际新增映射

**位置：`release.py:880–903`，直接缺陷在 `899–900`。** 每条 file-backed mapping 被投影为 `[permissions, offset, dev, inode]` 后，`if segment not in mapped[path]` 去除重复。地址不作为 ASLR 身份可以接受，但不同实际地址上相同 path/permission/offset/dev/inode 的两条真实映射不能因此被压成一条。

纯 TempDir 完整 collector 探针给 foreign slot11000 增加同一既有 library、同 permissions/offset/dev/inode、**不同地址 `9000-a000`** 的映射。该 fixture 的 file-backed maps 行数由 **2 变 3**，对应 library 保留的 identity 数仍为 **1**，两完整 samples 成功，collector 返回值与修改前完全相同。source path set、H/fullMETA、PID/start/raw 均未变化，所以其它保护不能补回被去重的数据。实际 mmap 同一文件区间两次可以产生这种输入；无需虚构权限或改真实 proc。

这是动态 maps 的 accepted drift，不是要求保护 anonymous heap/VmRSS/ASLR 绝对地址，也不是 loaded JS semantics closure 的替代。**最窄修复建议：** 对所保护的 file-backed mapping identity 保留重复条目的 multiplicity（例如 append 后排序，不去重），使新增/删除同身份映射改变保护结果；至少 foreign exact 路由不能丢失这一信息。无需加入地址遥测、FD 内容或新的服务器扫描。此次未修改源码/tests。

## 本次增量已成立的静态与fixture结果

`external_protection:748–749` 生产只转向 dynamic collector；旧固定 2060125/2060126 helpers 仍留 fixture，不再强求过期 PID。Node basename（含 deleted 标记的候选先识别后拒绝）及 PM2 title 候选、main pidfile/title/PM2_HOME、完整父 closure 至 PID1、missing/cycle/start-order、每槽单例和 own 禁止作为已收集图内其它进程祖先等控制存在。候选身份已识别后的 incomplete/消失不会静默跳过；仅尚未分类的 transient ENOENT 可忽略。

采集有 proc 8192、candidate128、graph256、depth64、source512、单 proc1MiB、单 source256MiB、总2GiB、monotonic120秒上限，超限拒绝。每次 collector 两遍 complete sample equality；每遍包含候选集复查、末端 fullproc、source/root/pidfile fullMETA 重读和最终 candidate set 复查。除上述 mapping multiplicity 漏失外，本次静态审查未发现额外候选/source/root 集合被截断后继续成功的证据。计时检查是阶段式预算，不是内核 I/O 的硬实时抢占保证。

foreign 进程 PID/start/PPID/comm、raw env、raw argv、权限原行摘要、proc/exe/cwd META 均进入 exact equality；main God、extra God、非owned六槽及 ancestors 不享 own raw 规范化。maps 完整末尾 path 保留空格，映射 dev/inode 对实际 source META 绑定，permission/offset 保留；所有收集的 exe/argv/mapped source 全字节 H/fullMETA 双读，deleted/非canonical/symlink/hardlink/special source failclosed。F2 是此处 exact mapping 数据的例外，不能被“全部 exact”措辞掩盖。

known recommendation bootstrap 当前 absent 仅标成 `observed-absent-not-retired`，固定 source 与完整 Ops/cwd 保护仍在；新 known/unknown birth/death/restart 会改变 guard 指纹或直接拒绝。unknown/extra God 可被采入**待审能力指纹**，不是自动可信，也不是永久不可能获批：`sourceGraphReviewRequired=true`、`semanticsClosed=false`。

本次额外 fixture 验证正常单槽 roll 后 dynamic 结果不变；mutable API 在本地同目录 replace 后结果不变；实际 owned argv 的 `ProcessContainer.js` **仍在 fullSourceMeta**，不是将真实 own 程序源移出保护。原 inventory/CAS 链仍保护 six own API。若实际 argv/maps 直接引用 mutable API，它依然由 `1015–1018` 加入 source H/fullMETA；那属于需 failclosed/独立审查的 unsupported execution graph，不能为便利发布删 H。

## 已有日志，不伪称重跑

核对日志末尾与 source-safety 所记录的精确 SHA：baseline **142/36/6**、最终 controller **204**、preparer **38**、finite **6**、新增 mock **62**，均匹配且为最终 `OK`。这些是已提供日志的核验，不是本审查重新执行 204/38/6。62 项新测试未覆盖 F1 malformed env 与 F2 duplicate-mapping multiplicity，不能由全通过推出这两个缺陷不存在。

## 留给后续完整包审批的事实

当前协作时刻的“15 Node”只当已提供事实；本地 fixture 数量不推导 current fresh count。有限读不是内核原子冻结或持续监控。仅 maps/absolute argv 无法证明所有已 loaded JS dependencies 的语义闭包；未来 fresh all-active 动态 baseline 与新 fullpackage 独立 sourcegraph review 必须覆盖当次 known/unknown 及父图、实际执行源和已加载但未被映射揭示的 dependencies，不能用 opaque 指纹或本报告替代。

尚缺 six actual Ready（六个 literal True）、retained typed witness/typed bytes、current fullMETA、API/HTML 新 package 以及前台 actual closed。没有追加 server 扫描，没有生成 controller/release/finalDeploy/reload 的 True 审批，没有创建 stage/capture/window/attempt 或生产写入。
