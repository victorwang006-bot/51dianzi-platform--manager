# R4 externalProtection 独立只读离线增量审查

**结论：NOT_APPROVED。controllerApproved=false；releaseApproved=false；finalApprove=false；finalDeployApproval=false。**

审查对象仅为 SHA256 `8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0` 的 R4 aux 增量。发现 **1 项采样闭合缺口（两个纯内存反例）**；flock 首次可信身份和 actual dependency/source closure 另列为未完成的实际证据条件，不把它们混称为已经证明的生产故障。没有审查或批准正在变化的 current。

## 1. 稳定源与边界

指定候选 `evidence/r4-domain-baseline/release.py`、`evidence/r4-domain-baseline-8dc23eb/release.py` 均不存在。`evidence/r4-source-and-safety.json` 没有 currentSnapshot 字段。因此使用该项目 `evidence/r4-baseline-bf7ec85b/release.py`（准确 bf7）与 `evidence/r4-controller.diff`，逐 hunk 检验旧上下文，在**纯内存**重建 121483 bytes 的 8dc，SHA 命中。bf7 为 114655 bytes，SHA `bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab`。`r4-report.md:7` 也明确记录这套基线的项目内实际目录；未使用另一个名字的域快照作为捷径。

基线六文件全部独立核 SHA；从 `r4-allowed-files.diff` 在内存重建六文件，逐项命中 `r4-source-and-safety.json` 的 8dc 时点哈希；其中 release 的结果还与指定 controller diff 的重建逐字节相等。这里的“currentSha256”只是旧证据字段名，不是读取当前工作树。

只读本地 evidence，执行标准库 AST/哈希计算与抽取 helper 的纯内存 fixture；仅写本报告和同名 JSON。没有 Git、MCP、SSH、server、锁、生产 CLI、真实 `/proc`、Node、RPC、业务或生产模块 import、测试整套重跑、capture/stage/attempt/window/reload；没有更改 code/tests/evidence artefact。环境与 cmdline 私值未导出。

## 2. 发现：R4-AUX-01 — 浅层 cwd META 与 pair 末端未闭合

**级别：Medium；8dc aux 的一致性保证需补闭合后复核。** 所有行号均指重建的 8dc `release.py`，不是变动 current。

### 2.1 可直接复现的 cwd META 漏检

`external_proc_sample:642` 只读一次 `cwd_record = describe(current_cwd)`；`664–668` 的末端检查重读 identity、proc 根 META、exe/cwd 链接路径及链接自身 META，**没有重新 describe cwd 目标目录**。父 cwd 不在两个精确保护根里，因此 `external_protection_sample:684–685` 的 root 检查不会补上这一项。`706–708` 两次结果相等也不能排除“第二次读取 cwd 后、第二次采样尚未结束时”的变化。

纯内存反例运行的是实际抽取的 `external_proc_sample`、`external_protection_sample`、`external_protection`，仅 IO/identity/link/source 接口用内存 fixture：第一次 parent cwd META 时间为 `(1,1)`；第二次 parent 读取 cmdline 时将该目录 META 时间变为 `(2,2)`，proc identity、link META、路径、sources、Ops 与 childcwd 两根不变。**collector 正常返回，记录仍为 `(1,1)`，返回时内存 live META 已为 `(2,2)`。** 此处没有靠替换整个 sample helper 制造接受结果，也未读取真实 proc。

**最小建议：** 在 `664–668` 的同一 fail-closed 条件中追加 `describe(current_cwd) == cwd_record`。只重读已观测的精确 cwd 路径，不递归 parent cwd、不新增搜索/根、不忽略 mtime/ctime。增加上述“第二次 parent cmdline 读时改变 cwd META”的必要 mock 反例，期望 `EXTERNAL_PROC_IDENTITY_READ_RACE`。

### 2.2 pair 阶段的同类末端窗口

`external_protection_sample:675–676` 顺序取 parent、child；`680–685` 随后取 source META 并重查两个 root，返回前不再验证两个 proc 记录。一个阶段 fixture 在第二次 child leaf 读取阶段让已读完的 parent exec/opaque cmd/cwd META 改变，child PPID/startTicks 与旧 source 文件/两个 root 保持不变：两次返回记录仍相等，记录 parent 与返回时 live parent 不同。这个探针使用实际 pair/collector helper、内存 leaf sampler；它证明采样拓扑的窗口，**不是实际 Linux exec/PID 时序实测**。

**最小建议：** 在 source/root 收尾后，对同一固定两个 PID、同一脚本/cwd 再作 readonly proc 复核，与本次 stored parent/child **完整记录**相等才返回；同时保持既有双 pair/source/root equality。source 漂移也应保持已有 fullMETA 比较，不能只比 H、重基线或忽略异常。新增“第二次 child/source 阶段 parent 漂移”反例。这会封闭已识别的采样阶段窗口；有限只读采样仍不等于原子冻结或返回后的持续不变保证，不能宣称零 TOCTOU。

这项发现不涉及 known 待补的 pre-ready/domain guard，也不要求修改原 Controller、RPC 或扩大扫描。

## 3. 首次 flock 身份与 unknown：必须保持未批准

`641` 和 `649–650` 的 basename 检验 **不足以证明真实 flock 的可信软件身份**：任何其他路径下命名为 `flock` 的 regular 文件，若固定 proc 的稳定记录满足约束，就会在 `680–687` 被 fresh 记录 H/fullMETA。这里没有独立已批准的 parent executable SHA 比较。纯内存 pair/source fixture 确认可以初次记录未审查的同名文件，后续 full transport equality 则会固定该实际路径/H/META。这是“首次取证然后防漂移”，不是“basename 已完成身份批准”。

**必要条件而非猜路径补丁：** 后续获单独授权的 fresh actual 证据应从内核 exe 链接取得真实 parent 路径，独立审该文件完整 H/META 与身份来源，并将审查结论绑定同一当次记录；之后只接受原记录 equality。不得猜 `/usr/bin/flock`、换 fallback、搜索 PID 或替换/启动/杀掉该进程。当前没有这个 actual 身份闭合证据，故不得批准。

同理，`654–655` 的 child 两参数 argv 能排除 argv loader flags，但 opaque environ 哈希 **不是** `NODE_OPTIONS`/`NODE_PATH` 或其他注入/依赖语义的空值证明。actual bootstrap 内容、全部 executable/source/fullMETA 和 Ops+childcwd 内实际依赖/链接目标仍需当次独立审；parent cwd 仅浅层记录，不能推断未知依赖都在那里或被覆盖。依赖跳出既定已审域、native/动态加载或源语义不明，都应 flag unknown、不批准；本审不读取私值、不扩大扫描，不再重审 rawmetadata/clone。

## 4. 已核实的 aux 保留与 fail-closed 行为

| 项目 | 独立结论 |
|---|---|
| `/proc/stat` parsing，604–616 | 使用虚拟文件 `read_bytes`，不把 st_size=0 当空文件；末个 `) ` 分界支持含括号/换行的 comm；field4 PPID 与 field22 startTicks 索引正确。PID 前缀、数字、非零 ticks、Z/X/x 拒绝；comm 只存 H。 |
| PID reuse 与单 proc，634–668 | identity（PID/PPID/startTicks/name H）读前后 equality，proc 根 META 与 exe/cwd kernel-link META/路径 equality；通常跨读、跨 sample 的 ticks 变化 fail closed。不是已批准历史 startTicks pin；也不能超出第 2 节闭合边界宣称全 pair 原子。 |
| raw env/cmd 与 permissions，646–663 | whole environ/cmdline SHA，无 NodeUnique/PM2 normalization；不输出原值。permissions 沿用原 helper:543–551，hash 的是 Uid/Gid/Groups/Umask canonical fields，**不是 whole `/proc/status` raw SHA**，没有把其余易变 status 字段引入 equality。 |
| readlink/source，618–631，680–683 | 只用 kernel 实际路径；absolute/canonical、deleted、symlink ancestor、单 regular/nlink=1 和 source 双 describe 限制保留；记录实际 parent exe、child exe、cfg.node、exact bootstrap 的 H/fullSourceMeta；child actual node 完整 H 与 cfg.node 比较，不是 basename-only。 |
| 两完整 samples 与 transport，706–708，712/733–748 | 正常 proc/source/root 跨 sample 差异全部拒绝；source 碰撞拒绝，合入旧 sources；adapter/Node probes 前后再取 external 全相等。存在第 2 节指出的最后阶段漏闭合，不能把 equality 说成连续监控。 |
| whole Ops+childcwd，215–219，704–705 | 原两 env 与 varprivate 保留，追加精确完整推荐 Ops 与 childcwd；两根必须 exact 出现在 cfg.extra_protected，祖先根不能替代。原 union/inventory fullMETA/hash/全部目录含空目录/精确集合与链接处理源码不变。 |
| mock/CLI，695–703，2038–2074 | skip 仅 cfg.mock 且 fixture=None，并显式 fixtureOnly；fixture 非 mock 拒绝，生产 proc 必须 `/proc`；CLI 无 mock、PID、startTicks、argv、proc、roots override，默认 Config.mock=False。缺 PID、IO 异常、错误 argv/cwd/source/links 无 fallback。 |
| 两外部进程 | 不塞进 12 PM2 schema/六 own；新增 helpers 无 lifecycle、fallback、search、kill、reload、unlock。旧 transport 的 PM2 daemon signal-0 是基线行为，本审未执行。 |

原 Controller `snapshot:1300`、health 的 pre/post transport equality、baseline_guard、guard、state adapter pin，以及原 RPC 前后 `transport(cfg)==tr` 会比较整个外部记录；RPC pins 也包含外部 sources。未发现只比较 external 子集或偷偷重基线的新增路径。

## 5. AST/源码字节与 pin 的独立复算

不是照抄 audit 的 true 值：对 bf7 与内存 8dc 分别 `ast.parse`，去位置属性比较并提取原 source bytes 算 SHA。

- 旧顶层只有 **Config、PM2_GENERATION_PINS、SCOPE、transport** 的 AST/字节变化；无删除；新增五 EXTERNAL 常量、六 external helpers。Config 除 extra_protected 的 AST 外完全相同。
- **Controller 全类与 30 方法 AST/源码字节相同**；类 AST H `6e835405a0d64ffddb906df433e12b584fc7cf8b38e2cdc93e8afbf0f39a426b`，source H `f07ea5c21eafbc016aa27871a303419fd1006a59c07f79851c25c736c1f54c27`。
- 原 53 个顶层函数中，除 transport 的 **52 个**均 AST/源码字节相同，包含 identity/schema、permissions、union/inventory、config_binding、raw/model/meta/forecast 等；RPC assignment 与 rpc 函数也相同。
- RPC payload H `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`；RPC assignment source H `2dafc2b678e7dd9e1781da22cc516b7c579dde0cf793cbeb0e89870ac82091e1`；rpc function source H `665107a8c6b6b95d1750af874dbeeebe26715f5a006333af9288abbba0adb2e1`。
- preparer 仅 CONTROLLER_SHA AST/字节变化并精确 pin 8dc。
- 原八 PM2 generation pins 全部逐项保留，**原 `package.json` 也是 pin**。唯一准确第九项 `modules/fclone.js` = `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`；本审未执行、重审或宣称关闭 fclone 语义。

## 6. 原日志只核 SHA，不重跑

| 日志 | 结果声明 | bytes | 实际核对 SHA256 |
|---|---:|---:|---|
| r4-release-tests.txt | 121 / OK | 17959 | `67a768651d2e4c7b2bc146571c469b292855ff7f4620bc42a7500c9e847fcd66` |
| r4-prepare-tests.txt | 34 / OK | 4007 | `7473c23bfacf88b188704333dfa6649b381bdf30766be77dbf431c60aa03657f` |
| r4-finite-tests.txt | 6 / OK | 906 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |

日志 SHA/bytes 与给定 JSON、报告吻合；仅证明保存的日志内容，不证明当下生产条件。另执行 9 个窄范围内存探针：statPPID/ticks/特殊comm、dead state、mock skip、生产fixture拒绝、生产proc override拒绝、初次同名flock admission、第二sample sourceMETA漂移拒绝、pair末端parent漂移、实际sample cwdMETA漂移。后两项为接受反例；不是生产实验。

## 7. 后续 actual 采样必要条件（本审不执行）

应先处理第 2 节并用相同稳定源哈希重新离线审。后续只有在另行获准、front list+detail 优先工作未被误称 closed、其他批准条件满足时，才做该次 fresh actual：固定 2060125/2060126、准确 PPID/startTicks、真实 kernel exe 路径、child node 完整 H、exact bootstrap/cwd/plain 两参数；opaque env/cmd 与 permissions 只 hash、不导出私值；proc 根/link META、parent cwd shallow META、四类 source fullMETA、完整 Ops+childcwd 树及精确集合都要绑定同一 approved record。procfs/目录时间若不稳定应拒绝并解释，不可为了通过删字段、normalization、刷新 baseline。

源集合虽覆盖已知四类文件，不代表所有实际 loader/native/dependency roots 已齐。未知语义保持 unknown、不批准、不扩大扫描。正式 fullpackage/review/窗口/生产许可仍属主任务；本 backend 按交接处于无 stage/capture/window/attempt，不进行实际复核动作。另一单元新增 domain/pre-ready guard 不在本报告审查范围，未因 8dc 缺少 known 待改 guard 给负面结论。
