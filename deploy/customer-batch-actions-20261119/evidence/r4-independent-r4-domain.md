# R4 domain / all-ready pre-gate 独立离线增量审

**限定代码段静态审：通过。未发现本增量的实质 bug，无源码修正建议。整体状态仍为 NOT_APPROVED；controllerApproved=false、releaseApproved=false、finalDeployApproval=false、reloadApproved=false。**

## 1. 固定目标与执行边界

本审目标严格为 `52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f`，**不是 auxfix 正在修改的 current，也不评价其后续两处 aux helper 修正**。

从固定 `evidence/r4-domain-baseline-8dc/release.py`（121483 bytes，SHA `8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0`）与 `evidence/r4-domain-controller.diff` 逐 hunk、逐 context/删除行校验，纯内存重建 123290 bytes 的 controller，实算 SHA 精确为上述 **529**。另从固定六文件基线与 `r4-domain-allowed-files.diff` 在内存重建六文件，全部与保存的 after SHA 一致；两种 diff 重建出的 controller 完全相同。

没有读取 repo current 六文件，没有落盘重建源码，没有修改任何代码/source/evidence，没有网络、MCP、SSH、Git、server/prodCLI、Node、应用模块或完整生产模块导入/执行，没有取得锁、capture、实际 preflight/apply、reload 或任何生产访问。仅读固定本地证据、内存 AST/compile 与少量提取 helper 的合成探针；仅写本报告及同名 JSON 两个指定输出。不重审业务、aux 实现或重新执行 fclone。

## 2. 精确差量：通过

对 8dc 独立计算 AST 与逐节点完整 source bytes：仅新增 `pm2_json_domain`、`pm2_publish_ready`；既有顶层仅 `pm2_raw_binding` 与 `Controller` 有差量，**103 项既有顶层 AST/source bytes 相同**。Controller 仅 `baseline_guard` 改变，**其余 29 方法 AST 与完整 source bytes 相同**。

`pm2_raw_binding` 的全部差量恰为 `pm2_json_domain(e)`、`pm2_json_domain(value)` 两行调用；移除后与 8dc 单函数全文完全相同。`baseline_guard` 的全部差量恰为第一条 `pm2_publish_ready(b['c']['processes'], b['ids'])`；移除后同样全文完全相同。preparer 全文件除固定 `CONTROLLER_SHA` 从 8dc 换为 529 外字节完全相同，其 SHA 为 `5e5fac10ad7d762ed9002dad8847af2071d48d44ff4b9c28edda74b63c51ab9c`。

OWNER/SCOPE、Config/extraProtected/roots、九项 `PM2_GENERATION_PINS`、外部 aux/source/protection/transport helper、RPC、raw-retained/project、恢复/state/journal/receipt 方法均未改。这是**对基线的保持性核验**，不是重新批准 aux，也不是新 actual 九源采样。RPC literal UTF-8 SHA 实算保持 `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`。

## 3. recursive JSON-tree guard：通过，但不构成 original typed witness

两次 guard 覆盖完整 monitor 模型 `model.pm2_env` 与完整 decoded serialized `value`，位于 forecast/deepcopy 前。普通 dict/list 的全部 key/value 均递归检查，不只 env 或顶层。任何层的自有 `__proto__` 数据 key 均拒绝，不依赖其值为 object/null/string；cycle 与 shared container 均由全程 `seen` 身份集合拒绝。精确 `type` 限制排除自定义容器/数值子类与 non-JSON 类型，所有 key 必须为普通 str；int 必须满足 `-(2**53) < v < 2**53`，float 必须 finite。有限 binary64 float（含 1e20、最大有限值、subnormal）仍允许，未误套 PM2 生成整数 token 政策。

字符串及 key 用 strict UTF-8 编码验证；lone surrogate 与不支持的递归深度在该 helper 中转为明确 ReleaseError，绝不字符替换。原 decoder 不变：JS UTF-16 合法孤 surrogate 仍可被 decode，但不属于当前 strict UTF-8 forecast 可证明域，提前拒绝不是改写业务字符串或 normalization。raw 侧既有 duplicate/nonfinite/invalid UTF-8 拒绝可更早发生，未被新 guard 放宽。

helper 不赋值/删除原 tree，不洗 application env，不递归 parse/canonicalize opaque 字符串；普通 `constructor`、`prototype`、`toString` 数据键保留。这些名字不是执行键，不能泛化禁用。含 `{"__proto__":...}` 文本的 opaque str 是叶值，不被当对象执行/解析。应用生命周期-looking 值与原 token/escape/order 字节门槛保持。Utility.clone 根 null→{} 的边界仍存在，但 binding 已要求 e/env 为 dict，不适用其根。

独立 fclone 已保存比较日志 canonical SHA 实算为 `055bfcf52ea5f201f52477dcdf9aece847e4ca56f015a2f9cc0d78e3c1cbf018`，与其记录一致。其限定 clone 证据仅支持被明确限定的普通 JSON 树；**RPC JSON 投影会丢失 prototype、函数/undefined/symbol、accessor/toJSON 身份、特殊内部槽、共享/图身份等，不能反推 original daemon typed shape**。新增 guard 只筛选已观察 JSON 域，不能补出 original typed/fullSourceShape/actualfield 证据，不能代替 actual fullRetained/complete-byte witness。Python/JS 的数字拼写、键序与 Unicode escaping 差异仍只能使原 byte forecast 不 ready，不能用 canonicalization 接受。审批依赖实际 full witness，不因 guard 新增而简化。

## 4. all-ready 发布 pre-gate：通过，恢复与诊断不变

`pm2_publish_ready` 仅检查由原 identity 得到的六 own IDs：ids 数、唯一数、所选 rows 数均为六，所选 row ID 集合精确匹配，且每行 `pm2ReloadReady is True`。`1`、`"true"` 等 truthy 不接受；重复/缺失 ID 或 own row 拒绝。unowned/aux 的 None 不被要求变 True，不新造身份/固定 ID 政策。

`baseline_guard` 第一条语句即该检查；独立 AST 调用图仅有 **preflight、apply**。入口先做原有双锁、no-replay、stage/package 的只读封包、schema/identity/TTL/review 校验，随后才调用 baseline_guard。对于封包内合法 all-false 或 mixed，新的首句在任何 live snapshot/transport/Node probe/health probe 之前拒绝，更早于 receipt mkdir、attempt/exclusive、协调窗口 open、immutable asset、API/CAS、intent/adapter/RPC。**这里的 open 指发布窗口 open；不声称消除了先前只读文件 open 或既有双锁流程。** 本审未实际运行它们。

封包 all-true 也只满足必要前条件；之后原有 snapshot 全量精确 equality 仍会拒绝 true→false 和其它 drift。snapshot equality、单槽 intent 前原 `PM2_MODEL_FORK_RETAINED_BYTES_UNPROVEN_NO_RELOAD` 政策保持；新 gate 不是成功定义、审批或绕过依据。

capture/snapshot_rows/identity/preparer 输入策略未改：合法 bool false 仍可用于诊断，不能当发布批准。rollback、restore_journal、guard 和 state/recovery 方法全文未改，调用图中不经 baseline_guard/new publish helper，因而**不会被新六槽入口 pre-gate 阻断必要恢复**；原单槽恢复/安全门槛仍保留。

## 5. 日志 SHA 与最小纯探针

未重跑 136/36/6 全套或四个零效果 fixture。逐字节 SHA、`Ran N tests` 与结尾 `OK` 均与保存记录匹配：

| 保存日志 | 数量 | 实算 SHA-256 |
|---|---:|---|
| r4-domain-baseline-release-tests.txt | 121 | `8390ec17c5f930e9cf85a7db72682dfa4a03995cf25482b5ac4faeaea6e06b5e` |
| r4-domain-baseline-prepare-tests.txt | 34 | `25ec2b0951412bf3c78cc46b73c5b58fe7f68ad18702847bfa0a85b0fd23e1df` |
| r4-domain-baseline-finite-tests.txt | 6 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |
| r4-domain-release-tests.txt | 136 | `283e2a4d84cf2740ce1aa89449160c0871c293cd4009a457ff404de128981d5f` |
| r4-domain-prepare-tests.txt | 36 | `47f4ad810b36c0a957414046dae85c0cf9d659272af6a8ad492657a93f7ab433` |
| r4-domain-finite-tests.txt | 6 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |

四个保存的 allfalse/mixed × preflight/apply 用例均为 `ok`；由固定 diff 内存重建的测试文本确认其断言 exclusive/CAS/window/asset/API/intent/adapter/RPC 八类调用为 0、receipt 不存在、reload 空、sequence=0/state=None，且整个 temporary tree bytes/full META before==after。其对应 test_release.py SHA 已重建核对为 `dbf69aeacef81a3ba8d815fba6fede789740365274e9fa8b224440ab43a38a7d`。这只是已保存合成测试与 source 的绑定，不是 actual 生产零效果证明。

本审额外仅 AST 提取 `ReleaseError`/`need`/两纯 helper 与 baseline_guard 函数定义到隔离内存 namespace，不执行整个模块。**26 个记录探针全部通过**：proto root/env/nested、正负 unsafe 边界、NaN/±Inf、nonstring key、bytes/tuple/set/子类、surrogate key/value、cycle/shared/depth、合法 env/constructor/prototype/opaque/UTF-8/有限数原值及编码不变；allfalse/mixed/truthy-integer/string-true 在故意缺少 protectionUnion 的 fixture 中即报正确 new gate 错误，snapshot spy 调用为 0；重复/缺失 ID、重复 own row 拒绝。另 all-ready 六 own + unowned None 的 helper 接受 sanity check 成立。没有全入口、文件系统 mutation、实际 snapshot 或生产模块执行。

## 6. 仍不得发布批准

本增量是已有明确 source 开发授权内的必要 fail-closed 强化，不需要重新向用户确认源码修正授权。用户已有 backend 扩容后可上线授权，不由本审撤销或重复征询；但前台列表/详情优先事项尚未 closed，且尚待 fresh14proc（12 PM2 + 2 aux）、six actual Ready 全 literal True、typed/fullSourceShape/actualfield/fullRetained/complete-byteWitness、current full META/完整保护树、fresh new fullpackage/manifest/source/tool/owner/nonce/TTL/正逆字节与独立 fullpackage 审批。不能把局部静态通过当最终批准或去生产。

**actualSixReadyAllTrueVerified=false；actualSixSlotsRetainedForecastVerified=false；controller/release/finalDeploy/reload approval 全 false。** 本审只认可精确 529 的 domain+发布入口 pre-gate 代码段，不能为 auxfix 后新 source/pin 或实际全包代签。
