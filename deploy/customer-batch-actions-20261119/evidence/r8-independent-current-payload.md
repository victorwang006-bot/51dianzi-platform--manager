# R8 current candidate-unsealed payload 独立内容审查

## 结论

**PAYLOAD_CONTENT_BLOCKED_CURRENT_PROTECTION_PIN_MISMATCH**

本次候选的客户批次业务/API/UI增量、正逆字节、R8最窄控制器差异未发现新实质内容缺陷；但给定保护基线的技术库 H 与当前 capture 中同一文件的实际 H 不一致，尚不能真实宣称全部交接保护精确保持。因此本报告不写 `PAYLOAD_CONTENT_PASSED_READY_TO_BIND_MANIFEST`。这是一个具体、有限、可澄清的保护绑定项，不要求重跑功能测试、重新研究或第二轮全量语义审查。

```text
reviewType=candidate-unsealed-payload-content
releaseApproved=false
finalDeployApproval=false
reloadApproved=false
manifestBindingApproved=false
sealedManifestSha256=null
productionWritesByReviewer=0
productionReadsByReviewer=0
```

报告由本独立审查过程实际生成，不是 builder/self-attestation/DTO 批准。本审只读本地真实文件；没有 SSH/MCP/HTTP、Node/API entrypoint/数据库执行、capture/preparer/release/build CLI、生产锁、开窗、reload、源码修改或 Git 写入。开始时曾只读 `git status --short` 定位工作区差量，不将 Git 状态作为批准依据。没有重跑既有通过的功能测试。工具返回时间发生延迟；不把旧 capture 的 TTL 称为已经续期。

## 唯一具体阻塞：技术库保护 H 口径未闭合

任务交接及此前 `review-r2-independent.md:62` 指定技术库保护 H：

`87910d282ec0a2a1b76235bbc4462ef98049d8228b7400de66a8bb6091ef4faf`

当前实际 capture 的准确记录为：

- 路径：`/var/lib/dianzi51-private/official-technical/prepared-v1.json`
- `kind=file`，size `22071742`，nlink `1`，dev `66309`，ino `9794929`；九项 META 均存在。
- 实际文件 `sha256=37ddd23b13b10aa009f06234ee49e115a197457c372aa2024a417e110a6e4e71`。

两个 H 不相等。当前 capture 内没有发现 `87910d282…` 的另一已绑定记录；已有本地 R2 JSON 把该 H 记作 `frontendHandoff/technicalStore`。本审不能凭交接口头描述，把文件 SHA 与可能的内容/canonical/其它时点 H 自动混为同一口径；也不声称已定位技术库遭修改、服务故障或数据丢失。

**最小处理：** 父任务提供已经存在的准确来源证据，证明 `87910…` 的具体对象/口径及其与当前 `37ddd…` 文件记录的关系，或核实确有合法最新保护基线并明确采用其 actual full-file H。若两者确应为同一未变文件全 SHA，则必须按真实漂移处理，不能删守卫或覆盖该技术库。只需闭合本项，不重做本报告已完成的内容语义审查。本报告本身保持原字节；通过补充证据结论后再讨论 seal/binding。

## 当前包与 capture 的实际绑定

审查根：`/home/ubuntu/work/customer-batch/backend-prepare-r8-current-002`；仓库：`/home/ubuntu/51-manager`。

- capture 文件实际 SHA：`a4217a3047b95d66baf815d4458aaec1f1951e91c8fb8291543368b4360c3a7f`。
- capture schema：`customer-batch-capture-v1`；时间：`2026-11-20T05:31:38.474193+00:00`；TTL：900秒。本审不自行延长 TTL，未来 live freshness 由原控制器门槛处理。
- scope：`customer-batch-actions-20261120-6Lfttf6o-R8`；ownerTask 与候选规格一致，未输出 ownerNonce 原值或环境值。
- 当前 controller 实际 SHA：`586166f7ddf48235b6a28e2237d7b1f64cbf3709d1af484388a67b086f0ecaef`；preparer：`44c7328ead7bcfb4ba27a70d04a3af90a2801c5aff5bd09cfacd33c537c51334`。包内 source snapshots 与实际源码字节相同。
- 33项规格 source 的实际文件 H 全部与 `local-preparation.json.sourceHashes` 一致；16项 API业务源全部与已独立审种子的 `build-evidence.json.sourceSha256s` 相同；9项UI/CSS源全部与已审种子 source hashes 相同。
- capture 共12 PM2 rows、83054 protected records。准确 own IDs `190/191/192/193/194/200` 六行 `pm2ReloadReady is True`；`pm2RawMeta` 恰保留五生成字段。capture 记 `productionWrites=0`、`environmentValuesExported=false`。这些是已保存 capture 的事实，不是本审新增 live 采样。
- 准备记录及实际 VM证据均标明 API entrypoint 未执行、实际 DB access=false；本审没有重新执行 VM。现有 native-source/ABI/assert结果只是既有证据，不把其 true 字段当成独立批准。

## API两真实baseline：客户范围精确与非干涉

本审逐 patch 核算 actual old/new byte spans、SHA、完整 forward、完整 reverse 和每段槽外字节相同，而非只信 inverse 标志。

| 对象 | 当前真实 before SHA | 当前 after SHA | 固定patch数 |
|---|---|---|---:|
| front API | `51cd26a93c1d64fb0e6de6e13c2d19f8453b442cd702a6f5890e860cc451f017` | `5d27aec6afac090aa0b700dde24e8cc7f9a70a2f47df52dbae9f48333826f60a` | 15 |
| admin API | `a7a3f52a4fb21d7b6f73379b17b965d531d39b5e60d9ae873ce976683bb8b60d` | `9179501cc71f5caa96445eb7552ef6b88f11be1a4d9a59b12a062da992a4b020` | 7 |

实际名称集合与种子独立审的固定22槽完全相同，没有新增通用selector或额外入口。Front 60条、admin 7条 native binding/facade 的原声明准确 UTF-16 span及完整 declaration SHA，均在当前真实 before 中独立核算匹配；原语义/symbol证明可按这些未变源及声明复用，不宣称此次重跑了 TypeScript checker。记录的未目标顶层声明数为4906/1354，独立字节逆向证明所有槽外保持。

除两个 controlled history initializer 外，各 patch `newText` 与已审种子逐字相同。initializer 的可见差异为 local freeze source 绝对/相对路径注释随当前工作目录改变；业务源 H未变，native facade声明绑定已当前核对。API before 新增的前台内容位于本次槽外且完整保留，不用旧 seed API整体覆盖真实 current API。

批次失败Excel闭环继续复用已独立审且此次 H未变的真实业务源结论：编辑期以当前 draft映射值导出、原列/原行/sourceRefs不猜测；已冻结结果仅导出真正 failed/skipped问题、unknown进入核实而不冒充失败；server ExportProblems固定只读原 failed rows和可信原manifest/version/hash，formula使用文本cell、缺可信表头明确fallback；repair确认/版本/ACL/CAS及原 supply writeFence保持。删除批次既有确认流程未扩大改动。普通上传/channel-material非客户功能仅在固定 formal lock锚点插入必要客户历史约束，其余原字节保持，不宣称这些被允许客户槽本身全部未改。

## UI、CSS、HTML

两真实旧 immutable资产 H与已审种子完全相同。独立校验两份 delta 中七个准确函数槽、old/new实际文本 H、槽间字节以及完整正逆重构；第八 failures leaf仍内嵌 HistorySession，不扩大独立全局槽。

- `BusinessWorkbenchPage-customer-batch-9e0625dd796f1d58.js`：实际 H `9e0625dd796f1d58e8024bbb2652a847fc4aa9e66c60cc659a07ebd2e4ed4479`。
- `BusinessWorkbenchPage-customer-batch-96ff81525a3f2e13.js`：实际 H `96ff81525a3f2e1301ab1c3684eed0c8d8e0d0c25fae262858f5c160c149f82d`。
- 七槽恰 `T6/B3/z3/V3/H3/mk/bk`；两个actual after H均与种子独立审相同，宿主/alias/symbol语义据相同actual资产复用。初次自写逆向检查误用Python codepoint索引造成assert；改按证据真实JS UTF-16坐标后全量正逆字节成立，是审查器坐标修正而非产品失败。
- scoped CSS实际内容与已审种子及9项未变源绑定，H `0abf3e1aacf580cfda4a0f9f45db055a549ed5cb4e59d2c09b96b8e22c23fb97`；不增加全局规则、外部资源或通用style替换。
- HTML before与当前baseline/admin-index逐字相同，H `71aca2bb6483befa1f3a4bf09a8aaf73f619bac3299d9bec9f4ea9d67878efa3`。两完整quoted URL映射分别53/32处，恰一个scoped CSS link；独立删除link和逆映射得到全部原字节。after H `891672cae359b9c4c22426a4f3c6c9f4cc17950cea13be9dd101ce0b50be1c55`。

## R8最窄实际diff及既有保护语义

直接独立比较准确a555 baseline与当前AST/逐节点source：release仅新增 `dynamic_proc_virtual_meta`，既有节点只改SCOPE/dynamic_proc；preparer仅CONTROLLER_SHA。Controller整个类/30方法、九pins、RPC、domain/finite decoder、CAS及其它顶层helpers字节不变。将dynamic_proc四个新virtual-meta调用在内存还原为原meta调用后，整个函数AST与基线完全相同。

新helper仅接受canonical `cfg.proc/PID`目录及准确 `exe/cwd`链接，校验完整九字段整数schema、directory/symlink类型；只排除虚拟cache实例 `ino/mtimeNs/ctimeNs`，保留dev/statmode/uid/gid/nlink/size以及exact path/parent/kind。PID/PPID/startTicks/comm、whole cmd/env、permissions、真实link target、exe/CWD/source/映射真实文件完整H/META、终末复读和集合保护不改。实际PID1诊断及官方proc生成机制仅复用已保存 `r8-proc-virtual-source.md`，不宣称运行内核整源码H。现有304/44/28+2/finite6 PASS作为既有有限证据引用，未重跑。

当前transport的真实生成source pins，已与本地actual God/ClusterMode/Reload/Methods/Utility/ProcessContainer/constants/package八项实物及1239B fclone实物逐H绑定；fclone H `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。引用既有真实getter/生成链/JSONdomain审查事实，不以PM2 package声明或单纯monitor JSON自动声称任意original对象typed语义。当前forecast是whole serialized object（除准确五个来源限定generator numeric tokens）的retained原字节equality gate；原nested NODE_UNIQUE_ID、完整env及opaque值无递归删名/重编码豁免。六Ready全true是本次必要实际witness事实，不等价于尝试reload成功或任意JS对象域证明。未新增serverProbe、完整modules研究或臆想APIfn政策。

## 当前保护及精确timer维护窗

当前记录实际front HTML H `a174dc6c908eef704570696a08366c5238e5c55c88f0f83cfabec75dfca9c308`、admin HTML H `71aca2bb…`、flags H `c22d7575…`/`429534c3…`与交接一致。七aliases均存在并保留准确symlink target/META；extraProtected五根包括两runtime.env、`/var/lib/dianzi51-private`及两个既定execution根，均实际在protected records中。external fullSourceMeta/rootMeta/proc记录存在；`sourceGraphReviewRequired=true`、`semanticsClosed=false`如实保留，不由本审改成万能语义批准。

只读审查了 `hold_supplier_timer_window.py`：准确literal timer `dianzi51-supplier-forum-recommendation.timer`、unit SHA pin `a17e2c9b…`，保存active/enabled状态，双锁/closed coord前置，只stop精确timer的新触发，短worker等其自然结束，不stop服务/PM2/API、其它timer/cron或改unit。finally校验原unit H后恢复同timer、原active/enabled并写恢复记录；hold timeout1800秒，receiver1900秒。未执行此程序；actual三stage工件与当前pause状态为父交接事实，不伪称本审独立现网观测。capture的known-worker absence只属于维护窗当次观察，不叫retired；未来正常worker恢复仍归原严格dynamic Node guard。保护技术库H差异见上方唯一阻塞。

## seal后的唯一必要继续项

现阶段没有sealed manifest，不存在可被本报告批准的manifest H。解决上述具体保护口径项后，父任务将本报告原字节及必要补充独立证据加入candidate spec的evidence，再用已固定current controller的本地candidate/seal路径生成全新sealed目录。不得覆盖旧输出、伪造approvefile或用payload DTO/hash当批准。其后仅核对sealed manifest/文件清单确实绑定本次33 source、capture、两API/两JS/CSS/HTML及报告原字节，明确生成准确manifest-binding结论；不第二轮全量语义重审。live freshness、双锁、coord、保护漂移、六Ready及no-replay继续走原发布门槛，不能由本报告绕过。

## 最后交接补记（非新增测试）

两history initializer已经通过精确字符串替换核验：只将旧freeze路径换为当前freeze路径后，全部initializer文本完全一致；改变行均为 `//` 注释，front38行、admin5行，无正文差异。

父在13:47交接确认：Controller.guard(forward=True)每步重新校验capture TTL900；真实83054记录capture约216秒、prepare约50秒，本次05:31:38 frame的TTL已不足以安全完成开窗后全过程。因此旧frame不应进行明知会过期的apply。该operational阻塞与本报告内容审查分开；不得伪造capture时间、自动扩大TTL或删fullCAS/source/双锁/byte/permissions门槛。后续新fresh frame及合理时间预算处理只需绑定准确source/预算变更、capture H/ownerNonce/manifest，不重跑这里已经通过的业务/API/UI语义。父read-only取证remoteexit与双锁释放、0pubwrite/reload为父确认事实，本审没有另行操作。timer14:00固定finally恢复未延长。
