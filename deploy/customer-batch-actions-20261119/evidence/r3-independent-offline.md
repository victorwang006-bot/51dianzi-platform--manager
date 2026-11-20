# 客户批次 R3：独立只读离线差量审查

**结论：`currentNOT_APPROVED`。`controllerApproved:false`、`releaseApproved:false`、`finalDeployApproval:false`。**

审查对象为 `release.py` 最终 SHA `ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5`，准确基线为 `evidence/r3-baseline-release.py` 的 `d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec`。2026-11-20 北京时间 09:52 起审，09:56 完成源码、证据及六文件收尾复核。本报告仅记录增量判断，不是正式 controller/release reviewer approval，也不授权准备、封印、预检、开窗、发布或回滚。

## 1. 审查边界和当前 hold

已读取 `review-seed-independent.md` 和 `review-r2-independent.md`，继承其原业务/UI、固定 22 API 槽、两 UI 七槽及内嵌第八叶、真实 symbol identity、正逆字节与未变业务语义结论；本次没有重复业务全审。HEAD `fad1856` 的前台 doc-only 性质及 R3 六文件尚未提交是任务交接事实，**本次没有运行 Git，未独立查询 HEAD/工作区状态**。

用户目前暂停 ECS 备份失败/服务器任务查因调整，前台取消自营徽标和方案 B pure 静态新需求也暂停。后台保持**不新 ECS 连接、不 capture、不 stage/write/reload，只离线**。前台旧 `8a130…` 闭窗及 `f893…` receipt 只属于原轮次，不是未来新需求或后台 R3 的新审批。按当前交接，R3 远程 stage、capture、payload、attempt、receipt、发布 window 均不存在；本审查没有连接或探测远端以改变这一状态。

本次只读本地给定输入，只写本 `.md` 及配套 `.json`。源码/tools/Git/SSH/MCP/生产、锁、capture 均未修改或执行；无网络、控制器/preparer CLI、服务启动、Node/vendor/God/RPC 执行或数据库访问。active writes、reload、DB writes、env writes 均为 0。没有生成任何 approval/approvefile、nonce、capture、封印包、attempt、receipt 或 window。

## 2. 实物与 AST 差量独立复核

没有以证据中的布尔声明代替计算。本次用内存 AST 比较、真实文件 SHA/size、literal require 清单及图可达性复核以下结果：

| 项目 | 独立结果 |
|---|---|
| 当前/基线 controller SHA | 均准确匹配上列 ec2/d6 完整 SHA |
| 既有顶层 AST | 恰 7 项改变：`SCOPE`、`Config`、`raw_semantics`、`transport`、`snapshot_rows`、`identity`、`Controller`；79 项不变、无删除 |
| 新增顶层 | 两常量及 `raw_values`、`pm2_top_tokens`、`pm2_project`、`pm2_raw_binding`、`pm2_meta_transition`，与 r3-ast-diff 一致 |
| Config 内差量 | 只改 `extra_protected`；原两个 runtime.env 的 AST 逐项保持，准确追加 `/var/lib/dianzi51-private` |
| Controller 内差量 | 仅 `reload_one`、`state_invariants`；其它方法 AST 不变 |
| preparer 内差量 | 仅 `CONTROLLER_SHA`，准确等于 ec2 最终 controller SHA |
| 原 RPC 字符串 | 原字节保持，SHA `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3` |
| 六指定文件当前 SHA | 全部匹配 `r3-source-and-safety.json.after`，收尾再次检查无漂移 |
| 生成 source records | 31 项本地实物 SHA/size 全匹配，八硬 PIN 全匹配 |
| RPC literal closure | 31 文件实物 SHA/size 匹配；源码 62 条 literal require 与 62 edges 多重集合一致；两固定入口可达全部 31 文件，所有记录在准确 PM2 base 内 |
| 已有测试日志 | controller 89/89、preparer 32/32 最终 `OK`，日志 SHA 均匹配；未重跑整套 |

证据文件 SHA：

- `pm2-live-source/source-records.json`：`f6c211ac662ecac437aa2034dec47e16a418a429ac9345f20cf16db6900d0f32`。
- `pm2-relations-readonly.json`：`8c0f9b1ec60401e452ef31413442f5fb35655edfd9b7e7b3238d6afdce73bed8`。
- `pm2-dependency-closure/closure.json`：`917f632e0ab4fa0a2b705d5ad8bd1c6b4d80d68c3f3a8bb8fd2aac2665ba507e`。
- `r3-release-tests.txt`：`e8f05671687c5be3967f04313d557bb4c6197c3430ec311e13d6c8ca8daf22d8`。
- `r3-prepare-tests.txt`：`0a818c470cce0b92da935dbe8419a79f32b6447282715c2d7c01b6574605630a`。

R2 的 83 AST 保持证明属于 d6 前一阶段；本次 ec2 对 d6 的 79 保持证明已独立确认。没有据此重新审原 2000 行协议，也没有将 AST 不变当作新的生产证明。

## 3. 保护图、实际源连通与类型/覆盖边界

### 3.1 私有根和 source/META

`release.py:209–211` 的准确新根通过原 `union:289–329` 进入 `inventory:331–375`；根自身、后代目录/空目录、普通文件的 SHA 和 dev/ino/statmode/uid/gid/nlink/size/mtimeNs/ctimeNs 均采用原记录语义，集合及 META 后续完整比较。原两 env、七 aliases、全 PM2 base、Node/runtime/flags 保护不变。原 inventory 会记录 symlink 本身并遍历目标，记录 nlink；**不把它误称为 vendor helper 那种一概拒绝 symlink/hardlink 的规则**。vendor 两树依然使用原更严的 links/special/file/dir/枚举竞态拒绝。

这已修正 d6 固定保护图漏根的源码缺口，但没有实际 R3 capture，不能宣称前台私有技术库当前实物/full META 或原前台全部保护集合已完成绑定。原合作双锁和多次只读采样边界不变，不宣称内核原子全树快照。

`transport:596–618` 保留 Node/Daemon 和 vendor 全 source/META，并硬核对八实际生成/reset源。`598–599` 在任何 Node 探针前拒绝当前 Python 进程继承的非空 `NODE_OPTIONS/NODE_PATH`；没有 unset、env 改写或 fallback。RPC/transport 和后续 full inventory 的前后绑定未削弱。

### 3.2 两类闭包不可混为一谈

RPC 两固定入口→vendor libs→debug/amp-message/amp 及后代的 literal closure 实物连通已核对；给定 closure 的 dynamic/outside/unresolved 均为空。全 PM2 base inventory 仍是当次 package/source/META 保护前提，不由 31 个 JS records 取代。

生成链实际定义也连通：`Reload.js:218–232` 固定 `env:{}` 不引入应用更新；`:117–121` clone 旧 model、restart+1、resetState；`Methods.js:272–275` 准确 reset created_at/unstable_restarts/prev_restart_delay；`God.js:175–190` 再 clone→extend 完整 env→无条件 uptime/status/axm 生成；`ClusterMode.js:41–48` 固定版本后 stringify/fork。`ProcessContainer.js:19–31` 运行态解析、回填及删除 pm2_env 不赋予忽略 exec 初始 raw 的权限。

但 `Utility.js:11,92–95` 实际调用的是 `../modules/fclone`。**其源码未交接，也不在生成 31 records 或 RPC 31/62 closure 内。** 因而 Python deepcopy 不是实际 clone 正确性的证明；八文件 PIN、RPC闭包或 full-tree inventory 都不能自动关闭这个语义阻碍。本次没有为此新增 ECS 读取。

### 3.3 来源限定投影的安全事实

`pm2_top_tokens:421–449` 定位顶部 value token；`pm2_project:451–462` 仅替换五个准确、非负、JS safe integer 的规范十进制数字 token。所有其它 key/order/whitespace/value 字节保留，UTF-8 文本切片重回字节不对未知子树重编码。完整 `env`、任意 nested/opaque JSON、同名应用值及其转义原 bytes、其它 outer raw 均保持。外层 raw 的原排列规范化仍属旧设计；非滚动槽另外要求 raw 全 SHA，故不豁免其原顺序或任何字节变化。

`pm2_raw_binding:474–503` 绑定 name/pm_id/script/cwd/cluster_mode/版本、monitor关系及完整 env。稳定 `pm_id` 没有被投影；`:484–487` 拒绝身份、五生成字段、status/axm、autostart/wait_ready/container 等 env override；`:508–511` 拒绝 object/list merge coercion 歧义。没有采用全 LIFECYCLE 删名或递归 env 清洗。未知顶部字段若改变仍改变 retained SHA，不获得生命周期例外。

六槽布尔证据 IDs 为 190/191/192/193/194/200：五 identity 关系、pm_uptime/created_at/restart_time/pm_id/unstable_restarts 数字整数与 monitor 对应、无相应 env override，以及 root/六槽 loader flags empty 均核对为真。**它不含 prev_restart_delay、完整 source shape、retained raw/model 字节或实际六槽 readiness 值**，不得推断现役六槽全 true 或全 false。

## 4. 重点：readiness 何时拒绝，是否可以 fully-approved

| 阶段 | 对结构合法但 `pm2ReloadReady=false` 的当前行为 |
|---|---|
| snapshot/capture | `snapshot_rows:658–663` 记录 false；`identity:685–689` 只要求 bool，允许 false。错身份/override/非法生成类型等另由 helper 直接拒绝 |
| 本地 prepare / candidate seal | preparer `185`、controller `1046` 用相同 identity；没有 all-ready 阻断。候选状态本来就是 not-approved |
| 正式 review 验证 | `validate_review:924–936` 验 schema/独立性/manifest及报告 hash；没有自动检验 six ready all true。这是外部 reviewer 责任，不是本报告批准 |
| preflight | `1257–1266` 的 bundle/baseline/health 没有额外 all-ready need，因此此类稳定输入可返回 preflight-passed |
| apply attempt / open / assets / API CAS | `1694–1725` 仍可先创建持久 attempt、开 own window、加 immutable assets、写 front API。若 front 全 ready 但 admin not-ready，还可能先完成部分 front reload |
| 当前单槽 reload | **仅 `1605` 在 `1609` intent 和 adapter/RPC 之前拒绝目标槽 false** |

这是确切的 **late-gate / controlled-failure 设计事实**，不是“false readiness 在审批/attempt/API CAS 前被代码统一封堵”。`test_release.py:1227–1234` 明确先开窗、CAS front API 再测试 not-ready 的无新 intent/无 reload；本次纯 identity 探针也证实六个合法 false 被 schema 接受。没有执行实际 preflight/apply 来证明此表，判断来自不变调用顺序和现有隔离测试。

**本审查不将这一已受控失败分支泛化为 raw 接收绕过或自动成功 bug，也不要求重写整个协议。** 失败依既有设计保留 own recovery hold，不能伪称 zero-write preflight 阻断。若将“全批准包必须可安全推进”作为批准条件，则已知 false 包当然不可 fully-approved；必须在任何正式审批前核证当次准确六 own 槽 `pm2ReloadReady is True` **全部成立**，并将完整证据与 capture/manifest hash 绑定。approve 后 `baseline_guard` 的全行精确比较可拒绝 true→false 漂移，但无法弥补审批时就容许 false 的错误。

all true **必要而非充分**：还须实际 clone 语义闭合、真实完整 retained-byte/source-shape witness、fullMETA/前台保护集合及当次 fresh package/nonce/TTL/审批齐备。`507–519` 的 Python forecast 只是拒绝门槛，不能单凭它制造真实 model→fork 兼容性证明。当前这些条件未齐，故维持全部批准字段 false。

如以后另获最小修改授权且要让 controller 自身保证“known false 在任何 attempt/open/API CAS 前零写拒绝”，可只加一个入口层 six-all-ready 条件（preflight/apply 写前），保留 capture 的 diagnostic false 及现有单槽 intent 前守卫；无需扩大 lifecycle 例外、改恢复协议或重写 identity。**本次不实施，也不把该可选强化当成已发生的修复。**

## 5. 已确认的窄缺陷 F1：数值指数溢出未被 strict-JSON 门槛拒绝

**位置：`release.py:53–64`，尤其 `61–62`；R3 新调用处 `423` 及 `451–462`。** `decode` 的 `parse_constant` 能拒绝字面 NaN/Infinity，却没有检查普通浮点 token 的溢出。内存中仅提取新增纯 helper 及其依赖，实际得到：

```text
pm2_top_tokens(b'{"opaque":{"n":1e400}}')  -> n 为 +inf，未拒绝
pm2_top_tokens(b'{"opaque":[-1e400]}')      -> 元素为 -inf，未拒绝
pm2_project(以上 raw)                     -> 原 bytes 保持
```

再将 `opaque:{n:1e400}` 放到合法 synthetic PM2 容器的**未知顶部子树**，`pm2_raw_binding` 能返回 semantic/metadata，且 forecast 比较为 false。若该值放在完整 env 中，则 `encode(...allow_nan=False)` 后续抛 ValueError。这些反例说明“任意深度非 finite 在 strict JSON 入口统一拒绝”的声明不完整；已有日志的非finite用例只涵盖字面 NaN 等，未涵盖 `1e400`。

**风险限定：这是已证验证契约缺陷，不是已证生产漏洞或合法 reload 接收绕过。** 上述顶部反例 not-ready，原 bytes 未被洗掉，生成五数字仍有严格类型/范围/token检查；未发现它产生成功事件、绕过 raw exact 或执行 reload。`decode` 本身 AST 未改，但 R3 新 helper 将它用于所声明的全 JSON 有限值来源门槛，因此在这次增量范围内报告。

最小建议是 checked `parse_float` 或解析后的有限浮点验证，使任何深度普通指数溢出也抛 `ReleaseError`；只检查有限性，不改原 token、不 canonicalize retained 子树、不把任意业务数字一律限制为 PM2 safe integer。补正/反例应限于正负指数溢出、顶层/未知 nested/env，并保留有限小数/指数的原 bytes 测试。**没有修改被审源码。**

本次探针中一次中途失败是审查器把追加的 opaque 字段误插到 env 内，实际触发了预期的下游 ValueError；随后单独顶部子树探针确认上述有限值入口缺陷。该中途结果未算作产品 reload 失败，未隐藏或外推为生产实测。

## 6. observed / uncertain journal 与完整链

`reload_one:1598` 写意图前先全 guard；合法转换须当前 durable attempt+single intent。`:1625–1636` 校验 PID变化、restart old+1、Node unique 递增且 identity 无碰撞、时间落在 intent/observed 区间且 created_at≤uptime、新旧时间严格递增、reset两值归零，以及其它十一槽完整行精确。未滚动 own 和 unowned 六槽 raw 全 SHA 均不豁免。

`:1639–1641` 在 event 入内存/loaded 前再采完整 snapshot，要求 source/transport、十二槽、权限及 protectedFiles 全 META/set 精确；因此非法 raw/source/META 观测只留下 intent，不登记成合法观察或 loaded。其后健康失败仍不能推出发布成功。

若 adapter 报错但上述实际合法观测全部通过，`:1642–1663` 可持久记录 `observedPidChange` 与 `transportPassed=false`，更新 loaded 的含义仅为**证明实际已加载该版本**，随后抛错进入 recovery，而非把 transport intent 伪成 success。若 observed checkpoint 写/fsync 不确定，内存保留已经证明的实际变化，`checkpoint:1429–1444` 标 journal_uncertain，`guard:1414` 禁止继续；持久 intent/latest state 不能冒充 durable success。现有相应隔离测试的源码及最终日志均覆盖这些分支。

`state_invariants:1335–1397` 对每个事件读回准确 `state-N.json`，绑定 intent hash/sequence、attempt、common字段、operation、全部十二 before rows、前序 events/loaded、transport 和准确 API target/payload；metadata 与 PID/restart/raw/unique 链均从 capture 反推。它不是凭事件里几个 true 字段接受变化。**完整 previousSha256/连续 journal 链遍历由未变 `restore_journal:1761–1785` 完成**，逐文件验证 schema/common/attempt、连续序号/previous SHA并执行 invariants，末尾要求准确 latest pin，不能把单独 `state_invariants` 误称为遍历所有未引用记录。当前差量未发现 intent→success、sourcefullMETA漏检或完整链反读的新实质缺陷。

## 7. 剩余阻碍与下一步（不扩大当前 scope）

1. **当前 ECS hold 不变。** 不为补证去连接、capture、stage、写、reload，也不推进被暂停的前台新需求或服务器查因调整。旧前台 closed receipt 不得作为下一轮审批。
2. **F1 可做最窄离线修正/反例，须另获源码修改许可。** 只处理非finite指数溢出和相应 helper 单测，不重跑原业务全审，不改变五字段或 env/outer raw政策。
3. **明确 late-gate 的批准责任。** 必要补测是入口层的 false/mixed readiness 调用顺序与副作用断言；若保留当前 controlled-failure 设计，则 reviewer 必须先拒绝已知 false 包；若另获入口 guard 修改许可，则验证 attempt/open/assets/API CAS/intent/adapter 全部在 false 情况为零。不要求重写 protocol。
4. **缺少真实 fclone 和六槽完整 byte witness 时继续 blocked。** 不能用 deepcopy、六槽关系布尔或 89 mock代替。只在合法交接了已有本地源码/安全证据后继续相应差量；当前不请求新 ECS 读取，也不试生产 reload。
5. **未来如用户明确解除 hold并单独授权新阶段**，才谈当次 R3 fresh full inventory/private root/前台集合、真实 source/tool pins、API/UI必要 fresh 正逆字节、packageFiles/nonce/TTL/currentcoord和正式独立审批。沿用原种子未变语义，变哪里审哪里；旧 capture/旧候选/旧 receipt 不移植。

**最终：R3 的保护根、硬源 PIN、窄 token 投影、override拒绝及合法 observed/journal 差量可记录为已核证的静态安全事实；F1 和发布证据/readiness/clone门槛未闭合，整体仍 `currentNOT_APPROVED`。这两份审查文件不执行、也不授予任何发布权限。**
