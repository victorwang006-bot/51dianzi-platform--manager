# R6 精确 io_uring 增量：窄源码段 PASS，非整包批准

**结论：`NARROW_SOURCE_SEGMENT_PASS_NOT_PACKAGE_APPROVED`。未发现本次四 helper 增量内的阻断问题，无需提出代码修改；`allApproveFalse=true`，sourceGraph／freshMETA／sixActualReady／typedWitness／fullPayload／package／apply／publish 的 approval 全部为 false。** 本审只判定指定源码增量符合所述类型与保护边界，不批准 actual capture、上线或发布。

## 绑定与独立核对

只读当前 `/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/release.py`，SHA256 为 `fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`；准确基线 `evidence/r6-baseline-36706f/release.py` 为 `36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14`。二者及六文件 current／baseline SHA 均与保存证据匹配。新 SCOPE 固定 `customer-batch-actions-20261120-6Lfttf6o-R6`；preparer 仅 controller pin 改为该当前 SHA，不复用或覆盖 R5 stage。

独立 AST＋函数文本＋去除允许函数区段后的剩余模块字节核对通过：既有函数仅 `dynamic_maps`、`dynamic_proc` 改动；只新增 `dynamic_map_fields`、`dynamic_kernel_mappings`；其余源码字节保持，已有常量仅 SCOPE 改动。Controller 全体 AST／字节一致，仍 30 方法；9 pins、Config（含 root／extraProtect／fullTree）、transport／RPC／domain、six-own／raw／Ready、source／fullMETA／inventory／CAS、所有时间／字节／数量预算均未改变。preparer 除 fixed pin 外逐字节相同。原 212／38 test 方法都保留，只有准确 3 个 scope/stage 方法按 R5→R6 同步，其他方法字节不变。

## 四 helper 与调用链

| 当前 release.py 行号 | 核验结果 |
|---|---|
| 880–887 `dynamic_map_fields` | 原逐行 address／perms／offset／device／inode validator 的前两条语句 AST 原样提取，最后字段仍是包含空格的完整 path。没有降低原格式门禁。 |
| 890–906 `dynamic_kernel_mappings` | 仅字节精确 `anon_inode:[io_uring]` 被记录。权限必须非执行且共享，inode 为正整数，长度必须正。记录完整保留 exactName、permissions、offset、device、inode 的原文本和 `end-start`；排序不去重，保留 multiplicity；只舍弃绝对 ASLR 位置。device 仍是原合法十六进制字段、逐条记录比较，并非把 diagnostic 的 `00:0f` 当硬编码当前证明。helper 不读 FS／proc／FD／队列或 kernel source。 |
| 909–929 `dynamic_maps` | 原 absolute/fullpath 分支 AST／字节相同；新例外只作用于 exact 非绝对 kernel 名。绝对 io-looking path 仍进入 file source；deleted／escaped／非规范文件 path 继续拒绝。旧 bracket／heap／stack 等政策原样保留，未泛化其他 `anon_inode:*`。 |
| 932–970 `dynamic_proc` | 新 `kernelAnonymousMappings` 字段保留在完整 record；967–969 使用同一第二次 maps read 同时比较原 file 图与 kernel 图。raw／cmd 仍仅 hash 进入 record，原 identity／links／cwd／status／环境／cmd 复核保持。 |

foreign 身份未丢失：未改的 1008–1103 完整采样链把所有 candidates 与 parent closure 采成完整 record，1084–1085 再比较 final full-proc，1095 将所有非 own record 原样输出；1106–1120 的两次 complete sample equality 和 1123–1161 的 whole transport equality 未改变。main／extra God、unowned 六槽与父图均没有新增 kernel 豁免，因此 ring 出生／消失、offset／device／inode／permissions／length／multiplicity 变化继续形成 exact 漂移拒绝。

own 边界同样未改：973–1005 的 `dynamic_owned` AST／字节保持，只输出原执行 source／mapped file 图及原 own kernel-exe／serialized 绑定；不把运行期 ring inode 纳入 stableSlots。因此合法自有 roll 更换 ring inode 不改变稳定 transport，但每次 `dynamic_proc` 仍先校验类型并完整复核，原 six-own exact proof 不被替代。1050–1057 的 full source H／META 和 file device／inode 校验、1086–1092 的 final source/root/set 复核全保持；kernel 记录不会进入 `mappedSourcePaths`、`sources` 或 `fullSourceMeta`，绝对文件定义也不会被忽略。

## 最小离线验证

[同前缀纯本地探针脚本](/home/ubuntu/work/customer-batch/review-r6-kernel-offline-probes.py) 只编译 AST 摘取的 helper／校验定义，无整个项目模块 import、无应用入口或项目 import/constant 执行。完成 **284 项静态核对、53 个合成 helper 探针**；TempDir 只含受控 synthetic-proc、opaque cmd/environ/status 与普通 source 文件，退出后清理。dynamic_proc 的 identity／link／read／meta 等依赖是受控本地 stub，不连接真实 proc 或服务。

探针确认 exact record 无 FS 调用；合法 nonexec/shared 权限；unknown anon／lookalike／deleted／exec／private／zero inode／非法字段／非正长度拒绝；顺序非身份而 multiplicity 保留；同长 ASLR 移动不干扰；第二次 maps 对 birth／drop／multiplicity／length／offset／device／inode／permissions 的漂移逐项拒绝；绝对 io-looking 文件保持 file 图、重复数与 source hash／META，修改内容能被原 source 结果观察，deleted absolute path 拒绝。完整 protection／transport／Controller 没有执行，其调用链由独立字节／AST 一致性和保存测试日志支撑。

只核已有日志的 **SHA＋bytes＋测试数＋末尾 OK**，未全重跑：baseline 212／38／6，current 246／40／6，新增 34／2，原 F1/F2 8 均匹配 `r6-source-and-safety.json`；保存的 `r6-ast-diff.json` 与六文件 patch SHA 也匹配。详细核验在[结构化结果](/home/ubuntu/work/customer-batch/review-r6-kernel-offline.json)。类型来源只读父任务已保存的 `evidence/r6-kernel-mapping-source.md`，未重复 search/fetch，也未宣称运行中内核源码 pin 已核。

## 实际状态与审批边界

按父任务传达，ROOT 授权扩容后的上线结果保留，frontend 11:50 已正式 no-window／no-prod-change 释放协调给 backend；不等待不存在的 frontstaticreceipt。backend 可自主 fresh readonly，但未获 apply／publish 批准。本审不独立验证这些协调事实。

最新父任务传达：12:06 首次 R6 private controller 上传后的 actual readonly capture `exit 1`、`RELEASE_ABORT: FileNotFoundError`，无 capture／attempt／publish／reload；io_uring 门禁已过，具体 filename 尚由父定位。**本审没有访问该次真实捕获、没有重 cap、没有定位其 filename；该事件不被解释为本 kernel 增量的语义失败，更不等于 actual capture 或完整门槛通过。** R5 首次 READONLY 的类型拒绝与 110 条 exact io_uring diagnostic 也只是父传达的历史事实，本审没有重新读取 diagnostic。

仍待父任务逐次 fresh、独立审查：unknown sourceGraph；全 H／META；six actual Ready 每捕获的证据及原 exact own proof；Typed／byte witness；全 payload 与准确 R6 scope／pin／预算／CAS 绑定；原全部包审批门槛。不能复用历史 review／witness／capture 或把 source 段 PASS 变成整包 Approve。

本审未执行 wholemoduleimport、Node、真实 proc、Git、MCP、SSH、server、生产 CLI、队列／FD 内容读写、DB、reload、capture、attempt、apply 或 publish；项目源码未修改，生产写入为 0。所有输出仅指定同前缀 `.md`、`.json` 与离线 probe `.py`。
