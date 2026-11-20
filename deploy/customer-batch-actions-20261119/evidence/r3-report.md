# R3 限定实现与隔离反例阶段报告

**结论：NOT_APPROVED；controllerApproved=false；finalDeployApproval=false。**

阶段时间：2026-11-20 北京时间 09:24–09:39。只修改 `/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119` 中许可的 `release.py`、`test_release.py`、`prepare-local.py`、`test_prepare_local.py`、`README.md`、`prepare-local.README.md` 及 `evidence/r3-*`。未修改业务/UI/JS builder，未重跑业务测试，Git/SSH/MCP/生产访问、实际 capture/prepare/seal/preflight/apply/verify/rollback CLI 均为 0。测试中的公开 Controller 操作只执行 temp synthetic fixtures 与 mock adapters。

## 1. 准确来源与新版本

已实读 R2 独立审计 `.md/.json`。已先保存实际 d6 controller 和六文件基线，而不是从文档重构旧源码：`r3-baseline-release.py` 的 SHA 为 `d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec`；六文件旧 SHA 在 `r3-before.json`。

当前 controller：

```text
ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5
```

完整 OWNER 不变：`6Lfttf6oVWJ8YS69o5FkXQ`。SCOPE 为 `customer-batch-actions-20261120-6Lfttf6o-R3`，stage 随 scope 派生；其它原 Config 路径不泛化。preparer `CONTROLLER_SHA` 准确同步；其余 preparer AST 不变。六文件完整当前 SHA 见 `r3-source-and-safety.json` 的 `after`。

## 2. 固定保护图修正

唯一 Config 成员变化是 `extra_protected`：保留两个原 runtime.env，然后追加准确 `Path('/var/lib/dianzi51-private')`。没有扩大 `/var/lib`，没有只 pin 一个 store SHA，没有削弱或删除主任务 handoff/mainstore guard。原 `union` 和 `inventory` AST 完全不变；新根继承全 files/dirs/emptydirs/links/完整 META/set 保护。原七 aliases、PM2 base 全树、Node、runtime/env、flags 等保持。

已读取 actual closed coord 的本地副本并独立核算 SHA `8a130860aefec8087cebfab27d2bc7782f30a6790a300a75546fb48436f0af89`。其 integer protectedFiles 计数不能作为新根保护证据；本轮没有真实 R3 inventory/capture，不能宣称实际私有树已被新 capture 完整绑定。

## 3. 生成源与只读结构证据

已实读 God.js、ClusterMode.js、Reload.js、Utility.js、God/Methods.js、ProcessContainer.js、constants.js 的实际交接源码。Methods.js:272–275 明确定义 resetState：created_at=Date.now、unstable_restarts=0、prev_restart_delay=0；Reload.js:117–121 clone old model、restart_time+=1、resetState；God.js:178 后合并 env，:181 无条件 pm_uptime=Date.now；created_at 是合并后 falsy 才写，故不能按名字放过 env override。ClusterMode.js:41–48 固定 PM2 version 后 JSON.stringify(env_copy) fork。ProcessContainer.js:19–31 解析顶部并回填 process.env 后删除运行时 pm2_env，不意味着内核 exec 初始 environ 的序列化字节可忽略。

八项硬 source pins：

| PM2 base 内源 | 固定 SHA |
|---|---|
| lib/God.js | f598e5113890418827e31dd52fc3538e8f19287fad212cafd9388b0216fe500d |
| lib/God/ClusterMode.js | b4a9304e12f468f87a039c174c6ea4a1001f21d9dd1f5317121ed217bc389119 |
| lib/God/Reload.js | 5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e |
| lib/God/Methods.js | 577a8505074225dfe73ce2c955c844662c6bc9d76c31d8102f809a1691262044 |
| lib/Utility.js | 66cd15711be69f40f6ee3c3f60adcf07e58d0bcdec9552ec5104530b22ba28f1 |
| lib/ProcessContainer.js | 712b414f248a460f58d4365898fa7b27d39bf7f571ac889359e3a7b6a32419d1 |
| constants.js | 5a4adce0c3c277d4974c0ebdefb22d62ffcad74edcf910bfeeff287dacb8a853 |
| package.json | f2819cffb2aae16bb813596575410877570a253be11949260caa33c8038788d6 |

实际 `source-records.json` 的 31 项源码 SHA/size 全核对。原 Node/Daemon pin、两个 vendor 全 source/META/dirs/set、原绝对 RPC specifiers 和整个 PM2 base inventory 不变。RPC 字符串原字节 SHA 保持 `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`。

主任务明确结束交接后，读取并核验六槽 `pm2-relations-readonly.json`：identity 五关系均真、顶部 pm_uptime/created_at/restart_time/pm_id/unstable_restarts 均 numeric integer/matchesMonitor、五字段无 app.env override、app.pm2_env override absent、root 与六槽 NODE_OPTIONS/NODE_PATH 空。没有输出秘密环境值，没有为取得资料连接生产。

主任务结束交接的 RPC `pm2-dependency-closure/closure.json`：31 source records、62 edges；记录的本地文件 SHA/size 全匹配，literal require actual resolved entries 均在原 PM2 base，dynamic/outside/unresolved 均空。记录内没有 JSON package source 全集，不能据此宣称其 full META/所有 package 语义也已单独复审；未来当次 capture 的原 PM2 base 全树 inventory 仍须完整绑定。此闭包不是 God/Utility 全生成链依赖闭包。

transport 新增 Python 只读 loader gate，在任何 Node -e 之前拒绝 root NODE_OPTIONS/NODE_PATH 非空。不 unset、不清洗或替换生产环境、不 fallback。mock 测试的本地 patch 会恢复 sandbox 原环境；首次扩展测试正确拒绝本地非空 NODE_OPTIONS 的日志原样保留。

## 4. 最窄 raw 转换及精确事件

`pm2_top_tokens` 先严格完整 JSON 解析，拒绝任意深度 duplicate/非 finite/错误类型，再定位顶部 tokens；保留原 key/order/whitespace 和其它 value 字节。`pm2_project` 只以规范安全整数 token 标记五字段：pm_uptime、restart_time、created_at、unstable_restarts、prev_restart_delay。没有删整个字段、没有全 LIFECYCLE 删名、没有递归 canonicalize。

`pm2_raw_binding` 限实际 own cluster 的 PM2 serialized 容器，严格 name/id/script/cwd/mode/version、monitor 与当前 raw metadata 关系、完整 env 对象；稳定 pm_id exact，generated/identity/container/env override 和类型/coercion/source shape 歧义拒绝。完整 env、nested 同名应用值、nested NODE_UNIQUE_ID、其它 nested/opaque 字符串及所有其它 outer raw 原字节保持；仅 outer Node unique 为原特例。

read current 模型新增 `pm2RawMeta` 和保守 `pm2ReloadReady`。预测 JSON 仅作 byte-equality **拒绝门槛**，从不替代实际 retained 字节；未证 monitor 后加字段、缺 reset 字段、key/order/escape 差异不获得 raw 例外，并在单槽 intent/adapter 之前阻断。该 forecast 不是实际六槽已通过或 Python deepcopy 与实际 fclone 等价的声明。

接受事件须当前持久 attempt + 持久准确单槽 intent、PID 改变、restart old+1、Node unique 增加不碰撞、created_at 与 pm_uptime 在意图/观测时间范围内且顺序合法、unstable=0、prev_delay=0、其它十一槽 raw exact、source/permissions/full inventory/META/set exact。事件带前后 metadata、attempt SHA、intent SHA/sequence 与时间；state invariants 读回意图并绑定完整十二槽 before rows、前序 events/loaded 链和 API payload。source/META 完整 snapshot 在事件记入前再次证明。

非法校验只保留 intent，不把 PID 已变等同成功或重基线 loaded，不自动解锁。若 adapter 报错但完整合法观测已证明，仍按原流程持久记录观测、transportPassed=false，再抛错转 recovery；若观测 checkpoint 写/fsync 不确定，内存保留已证明实际转换但 durable state 仍不能冒充成功，阻断继续。新增专门反例验证这两条分支。

## 5. 精确 AST 边界

`r3-ast-diff.json` 与 `r3-controller.diff` 是实际 AST/字节 diff，而非手写差量声称：

- 已有顶层仅 `SCOPE`、`Config`、`raw_semantics`、`transport`、`snapshot_rows`、`identity`、`Controller` 改动；79 个其它顶层节点不变，无删除。
- Config 内只 `extra_protected` 改，原两项 AST 保留且准确追加新根。
- Controller 内仅 `reload_one` 与 `state_invariants` 改，所有其它方法 AST 不变。
- preparer 顶层仅 `CONTROLLER_SHA` 改，无新增/删除。
- 原 RPC、LIFECYCLE、shallow_pm2、union/inventory、CAS/dual locks、权限、TTL/fresh、encode/decode、manifest/review/source/patch校验、健康、snapshot/capture、preflight/apply/verify/rollback、uncertain journal/恢复/receipt闭窗等其余协议 AST 完全不变。

精确六许可文件总 diff 为 `r3-allowed-files.diff`；旧 `r2-*` 和更旧证据保留未修改。

## 6. 完整隔离测试

controller **89/89**、preparer **32/32** 通过；原 60/30 测试方法保留并同步 R3 schema/fixtures/pin，额外反例覆盖来源限定转换、outer 同名 app/env 内 life-looking 值、其它 nested/opaque/其转义字节、wrong identity/container、任意深度 duplicate、类型/规范整数 token、未证 top 字段、model relation 错配、override/coercion、精确 restart/reset/time、multi slot/未滚动 raw、source 漂移、partial journal、private root dirs/fullMETA/set、root loader 拒绝以及 uncertain reload/journal 分支。没有实际 Node/vendor/God/RPC 执行。

完整最终输出在 `r3-release-tests.txt` / `r3-prepare-tests.txt`；日志 SHA 在 `r3-source-and-safety.json`。四个 Python 源内存 compile 通过，无 pycache；证据 `r3-static-checks.json`。历史失败/中间日志未隐藏，也不替代最终日志。

## 7. 明确剩余阻碍

1. **没有实际 R3 fresh capture。** 私有根真实 full files/dirs/META/set 与前台原保护集合仍需准确绑定；coord protectedFiles 计数、旧 store hash 或旧 capture 不够。
2. **没有实际六槽完整 retained-byte forecast/source-shape witness。** 新交接布尔关系只覆盖 identity/五数字/loader/override，不涵盖 prev_restart_delay、autostart/status/axm/所有其它 monitor 后加字段与完整 raw/model retained bytes。不能用 mock 或尝试实际 reload 补证；未证差异必须阻断，不能新增泛化 whitelist。
3. **Utility.clone 的 modules/fclone 源语义未交接。** 它不在 31 生成 records 或两 vendor RPC 闭包；Python deepcopy 不能充当实际 fclone/source-defined model→fork 必然兼容性证明。全 PM2 base inventory 保护内容不等于已审核该依赖语义。
4. **没有新完整 package/manifest/packageFiles/current source/tool pins 与独立 R3 差量审批。** fresh API/UI 正逆字节、nonce/TTL/前台集合等不得移植旧种子/R2 结论。没有创建正式 approval、真实 receipt/window 或实际 reload。

本报告只完成限定工程与离线反例，**不批准控制器或发布**。必须维持 `NOT_APPROVED`，交由独立审按当前准确 SHA 与当次 fresh 实物继续，不为了限期造批准。
