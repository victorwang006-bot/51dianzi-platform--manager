# R5 最小动态 foreignproc 保护：离线实现报告

**NOT_APPROVED。controllerApproved=false；releaseApproved=false；finalDeployApproval=false；reloadApproved=false。** 当前前台列表＋详情优先事项仍未 closed；实际 fresh all-Node、six Ready literal True、typed-byte/retained witness、fullMETA 和新 fullpackage 独立审批仍待主任务。本轮服务器执行、生产读取/写入、实际 Node/RPC/probe/CLI/SSH/MCP/Git/app-module/DB/reload/stage/capture/attempt 均为 **0**。

## 准确基线与当次范围

先完整复制六文件至 `evidence/r5-baseline-4fe/`，随后重跑基线 **142/36/6** 全通过。六文件准确 SHA 在 `evidence/r5-baseline-sha256.txt` 与 `r5-source-and-safety.json`；release 基线为 `4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121`。

OWNER 始终为 `6Lfttf6oVWJ8YS69o5FkXQ`。全新 SCOPE 为 `customer-batch-actions-20261120-6Lfttf6o-R5`，默认 stage 仅由常量派生，没有创建 stage。R4 从未远程 stage/capture/attempt；历史 code/capture/pin 不 approvable、不重用。

当前 release SHA：`f544c1663d84350df0ff036b7e1b330a8cfcb016e64d705027ff86411a26ed5d`；preparer 只把 CONTROLLER_SHA 更新为此值，所有方法与原字节不变。preparer 当前 SHA：`60ca8e9e922b72b52cd446dd16f35e5cdfeafb0ccb2f71707e6800b08196a59d`。

## 新事实的正确使用

11:12 的旧 `/proc/2060125/stat` ENOENT 和不完整 six 结果，不是完整 capture。11:17 的前台双锁动态只读 exit0 结果，按已协调提供的事实，当时 15 个 Node 为主 12 PM2＋主 God1279＋extra God491174/493698，只有 parentClosure1279，没有匹配 known recommendation bootstrap 的 active Node，旧两 PID 均缺席。这不能证明退休或 owner，更不是审批。

仅只读以下归档 **SOURCE 与 README**：`/home/ubuntu/51-manager/deploy/self-search-detail-demo-20261120/read-only/probe-live-runtime.py`，SHA `64df69ac84db1a4a662eabc70b91b06f46130f0675d29a1798ebedf0bd440782`。没有 import/run 其 top-level main，没有复制其 Node/RPC/双锁执行或 FD/log 内容采样。该 reference 是 source discovery，不是 formal capture 或 approval；没有读取真实 runtime JSON 或生产 proc。

## 最小修改面与逐字节证明

release 既有定义只有 **Config、external_protection** 的 AST 改动；既有常量只改 SCOPE，并新增 `time` 标准库 import、有界常量和 **12 个 dynamic_* 纯读取 helpers**。`external_protection` 的生产路由只调用动态 collector；旧固定 PID helpers、固定 source 事实常量和纯 fixture 测试全部保留，生产不调用 fixed-pair sample。没有 CLI PID/fallback/override。

**Controller 全部 30 个方法 AST 与精确原方法字节全部相同**；整个 Controller 类、原 transport、RPC literal/function、snapshot_rows、identity、pm2_raw_binding/pm2_project/raw_semantics、JSON domain、six-ready pregate、inventory、config_binding、API/UI inverse、CAS/env、budget、journal/receipt/approval/recovery 协议不改。原 8 个 measured generation source pin＋第 9 个 fclone pin、全部 9-pin 字典 AST/字节和值均相同。证据逐项在 `r5-ast-diff.json`，源码差异在 `r5-release.diff`。

Config 所有原字段的 AST/字节保持，包括两个 env、private、Ops 与 recommendation childcwd 两棵完整保护树、PM2 base、原 aliases/links/node/home。只新增 `execution_sources=(EXTERNAL_SCRIPT,)` 对应准确 known bootstrap 和 `execution_roots=(/root/enterprise-shadow-20261017-r2,)`：后者只 shallow directory META，绝不递归 `/root` 或 50GiB shadow。`inventory` 不扩写；动态 source 逐 path 的 H/fullMETA 由 transport full equality 保护。已知 Ops/childcwd 原 fullinventory 不删、不以 shallow 替代。

## 动态 collector 与非干涉

只枚举 proc 的实际 exe basename 以 `node` 开头或 cmdline 以 `PM2 ` 开头的候选，包括 unknown Node；取得整个父 closure，完整记录 PID/start/PPID、opaque comm、raw env/cmd SHA、原权限字段字节 SHA、exe/cwd/kernel-link/proc META、shallow cwd META、绝对 `.js/.mjs/.cjs` argv source paths，以及 file-backed maps 的完整最后 path 字段。空格路径不会被 split 丢失；maps inode/dev 与 source fullMETA 逐一匹配。所有 exe/script/mapped sources 均 bounded full-byte SHA＋fullMETA 前后保护，无模块加载、递归 dependency 发现或 FD/log 内容 SHA。匿名堆/ASLR 地址、VmRSS 等 status 计数不是执行源身份；file-backed map path/permission/offset/dev/inode 仍受精确保护。

父链有深度/数量界限并拒 cycle、unknown-chain/非 pid1 的 ppid0、父 start 晚于子 start、消失/复用、dead/zombie、deleted exe/maps、非 canonical/unsupported/symlink/hardlink/special sources。pid1 被完整记录且只有 pid1 的 ppid0 可作为显式根。候选身份已被识别后 ENOENT/incomplete 必拒；只有过滤阶段尚未分类的无关 transient ENOENT 可忽略。两遍完整结果 equality，每遍还有完整候选集合复查、fullproc 重读、source/root fullMETA 收尾及最后候选集合复查。此为**有限阶段采样，不是内核原子冻结，也不是持续稳定保证**。

界限：proc 枚举 8192 条、Node/PM2 候选 128、父图 256、深度 64、sources 512、单 proc 文件 1MiB、单 source 文件 256MiB、单次 collector 累计读字节 2GiB、monotonic 总预算 120 秒。超过任何界限拒绝，不截断后继续成功。Node 总数是 fresh 动态结果，不固定 14 或 15。

六 owned 仅对 **190/191/192/193/194/200** 精确单槽识别；191/192 必为 admin，其余必为 front；实际 kernel exe 路径与 cfg.node 完整 H 绑定，原 outer `pm2_env` 严格 decode，name/script/cluster_mode 固定，serialized `pm_cwd` 必与实际 kernel cwd 精确相等，父必须为 cfg.pm2_home/pm2.pid 当次 fullMETA/H/PM2 God title 绑定的 main God。不是猜测 `script.parent`。缺槽、错槽、重复、malformed/spoof 不得享受 own 豁免；owned 不能成为其它进程的隐藏祖先。

transport 的 `ownedSlotsStable` 只有 requiredCount=6、精确 slot/name/id/script/cwd/daemonPpid/execH 与稳定 execution source/mapping；不含这六个 PID/start/raw/permissions/proc/cwd META。它们仍经每次完整采样与身份检查，但稳定 transport 不被合法单槽 roll 的这些变化污染。六 own 的 mutable API 文件只经原 inventory/full-CAS 链保护（正常 cluster container 的 actual argv/maps 仍逐 source fullMETA 保护），不由 serialized pm_exec_path 重复加入不可变 transport source pins。若实际 argv/maps 映射 mutable API 等不支持 execution graph，不能删掉 source 保护或伪称可发布，须独立审查。六 own 的 PID/raw/permissions/config/reload 证据链仍完整由原 snapshot_rows/identity/reload_one/state/receipt 保护；allSixOwnfound 只是路由前置，不能替代 pregate。原 RPC 的 exact12/6own 行为和 Ready false 诊断/Ready all literal True 发布要求均不变。

主 12 PM2 中未 owned 的六个、main God、extra God 和所有 ancestors 均是 full opaque foreign 记录。任何外国 birth/death/restart/PIDreuse/env/cmd/permission/source/map/root 漂移都会改变 transport equality 或当场拒绝。Node probe/RPC 从不在枚举中运行；原 transport 在 pure collector 完成后才执行其既有 Node 调用，结束后再 pure collector 对照，本轮这些调用全部 mock。

known recommendation bootstrap 的 H/fullMETA 及原 Ops/childcwd 完整树始终保护。当前没有精确 absolute argv 匹配，可记录 `observed-absent-not-retired`；未来 matching known 或 unknown Node 的出现改变记录，guard 精确拒绝。当前匹配已知 worker 时绑定当次实际 Node/父 flock/PID/start/PPID/cwd/script，不强求旧 PID，不找替代旧 PID，不 reload recommendation；父非 flock 或 unsupported argv 直接拒绝。

unknown Node 可成为待审 capture 指纹，但不是可信/approved。结果明确 `sourceGraphReviewRequired=true`、`semanticsClosed=false`；不能由 maps/argv 猜测所有 JS loaded dependencies，不能由稳定 opaque SHA 伪称 semantic closure。任何 genuine 独立审批必须覆盖当次所有 known/unknown Node 与父图、actual execution libraries/argv/source fullMETA/H、未被 maps 揭示的实际 loaded deps 和原全部 protected trees，与 fresh capture/new package/source/tool/owner/nonce/正逆字节完整绑定。没有 collector 自动批准，也没有永久禁止 unknown 经完整实际 source-graph 审查后批准的替代政策。

## 测试与准确 SHA

保留原 **142 controller、36 preparer、6 finite JSON** 的所有测试方法；只有两个 controller 原 scope/stage 断言、一个 preparer 原 scope/stage 断言同步 R5。新增 **62** TempDir mock 动态/transport 方法与 **2** preparer 旧 R4 scope/4fe capture-pin 拒绝方法。最终 **204/38/6 全通过**，新 mock 单独 **62/62** 通过。所有测试只使用临时 fixture，所有真实 Node/RPC/probe/subprocess/network/kill 等外部执行 mock/拒绝；旧测试的临时目录锁不是生产锁。

当前 test_release SHA `155cdb754af78971284bcf7cc4769e5c9af21012ed7a94f7c38a2112dcfa88f7`；test_prepare_local SHA `8e59403a2483d43d9372b08b82ccf80a1dff48babfd55bd439c9267ce5ebfe57`。完整最终日志与各自准确 SHA 在 `r5-source-and-safety.json`；日志为 `r5-release-tests.txt`、`r5-prepare-tests.txt`、`r5-finite-tests.txt`、`r5-new-tests.txt`。中间 fixture 替换误改 script 的测试错误、遗漏一处旧 stage assertion 的失败保留在 initial/second 日志；两者均是新增 fixture/范围断言修正，没有隐藏测试失败、删测试或 production 执行。

审计脚本 `r5-audit.py` 只读 AST/源码/SHA/log，内存 compile 四个 Python 文件，不 import controller/reference，不产生 pycache。全部 deliverable 仅指定六文件与 `evidence/r5-*`；test_finite_json.py、业务/UI/TS/JS builders 均不改。
