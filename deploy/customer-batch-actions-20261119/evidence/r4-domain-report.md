# R4 domain：最小纯 JSON guard 与零写 pub pre-gate

**NOT_APPROVED。controllerApproved=false / releaseApproved=false / finalDeployApproval=false / reloadApproved=false。**

本轮精确基线 `8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0`，已在任何修改前保存六文件到 `r4-domain-baseline-8dc/`。当前 controller **`52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f`**，preparer 固定 pin 准确一致。OWNER/SCOPE 不变；R4 从未 remote/stage/capture/attempt，因此仅静态更新 pin，不再迭代 scope。

## 1. 来源与最窄修正

仅读取本地固定 review-fclone-offline.md/json、review-r3-offline.md、实际 fclone.js/read-record。fclone 1239 bytes，SHA `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`；离线审 comparisonLogCanonical 实际 hash `055bfcf52ea5f201f52477dcdf9aece847e4ca56f015a2f9cc0d78e3c1cbf018` 与记录匹配。原离线 15 条限定 clone 样本和三条合法 JSON __proto__ 反例仍只是局部源审，不是新的 daemon witness，也未重跑 Node/fclone。

`pm2_json_domain` 是 pure recursive guard，完整检查 model.pm2_env e 与 actual serialized value，且在 deepcopy/forecast 前。拒绝任意层 __proto__ key、非标准 JSON 类型/key、非 finite float、abs(int)>=2**53、cycle/shared Python container、lone surrogate 的 strict UTF-8 编码失败和不支持的递归深度。有限 float 为 Python binary64，允许 max finite/subnormal/1e20；不误套 PM2 生成整数政策。root e 已要求 dict，故 Utility.clone 根 null→{} 的边界不适用 e，但没有隐去该事实。

不删、不洗、不重编码、不 canonicalize；普通 constructor/prototype/toString 数据 key 保持，opaque JSON-looking string 不递归 parse。原 decoder 合法 JS UTF-16 字符串政策未改；孤 surrogate 原 forecast 已 strict 编码失败，现有限证明域提前以 ReleaseError 拒绝，绝不替换。

**不能从 JSON 投影反推 original daemon prototypes/functions/special/accessors/undefined/symbol/graph shape**；pure JSON guard 不代替 actual typed/fullSourceShape/fullRetained/complete-byte witness。unknown typed/full witness 仍需新的 actual 核验。

## 2. 零写 pub gate，不变恢复协议

R3 固定审 `review-r3-offline.md:69–86` 调查旧流程：合法 false 可在 attempt/open/assets/API CAS 后才由单槽 reload gate 拒绝，mixed front-ready/admin-false 可先滚前台。这是 controlled failure，不是成功绕过。本轮新增入口 precondition，不改 state/rollback/receipt/成功定义。

`baseline_guard` 第一条语句为 `pm2_publish_ready(b['c']['processes'], b['ids'])`，拒绝六 own 非全 literal True：`PM2_SIX_OWN_NOT_ALL_READY_NO_ATTEMPT_NO_PUBLISH`。AST 调用图精确仅 `preflight` 和 `apply`，故早于 receipt mkdir / attempt / window / immutable / API / intent / RPC；恢复方法不调用它。先查已封包 capture 的 six readiness，再由既有 exact snapshot equality 拒绝 true→false/其它漂移。依原 identity 返回 b.ids，只检查 six own；不检查 unowned/外部辅助 readiness，不硬造新身份政策。合成 fixture 使用 actual six ID 190/191/192/193/194/200。

capture/identity 可记录并接受合法 false；candidate/preparer 不增加审批或封印策略；单槽 `PM2_MODEL_FORK_RETAINED_BYTES_UNPROVEN_NO_RELOAD` 原全文保持。全部 rollback/restore/guard/state/journal/receipt 方法全文不变，必要恢复不被 pub gate 阻断。

## 3. 测试与差量证据

修改前 **121/34/6** 重跑全部通过；最终 **136/36/6** 全部通过，原测试方法全部保留。controller 新增 15 方法、preparer 新增 2 方法，finite 六方法未修改；一个旧 __proto__ override 用例预期补充更早 domain 拒绝。旧 late direct 单 reload 方法全文保持，仍仅手工开临时 window 与 API fixture，验证无新 intent/adapter；不是端到端实际先写。

新域反例涵盖 model/raw 两侧 × root/env/nested opaque/list × 三 __proto__ value，均检查完整 source/env/value/raw 未被清洗、forecast 未调用；15 个 finite/UTF-8 Python guard/deepcopy 样本非 Node clone 新验证。safe整数边界、finite float、non-JSON、surrogate key/value、constructor 普通 key、opaque string、cycle/shared 均覆盖。

四个 all-false/mixed × preflight/apply 用例逐项断言 exclusive/attempt、新 receipt、window、immutable、API CAS、intent、reload adapter、RPC 全 0，并比较**整个** temporary tree 的 bytes 与 full META before==after。mock diagnostic capture 返回 false（无输出 capture 文件），identity false 接受，preparer 对象-only输入接受 false；手工打开 false journal 能 restore/guard。all-ready mock 成功仍不是 actual all true 或审批。

初轮新增 raw fixture 重用了已有 opaque key，旧 duplicate-key 更早拒绝；保留 `r4-domain-release-tests-initial.txt`，只将测试新增 key 改为 domainWitness，无生产补丁/放宽。最终测试代码与日志 SHA 下表精确绑定。

| 日志 | 通过 | SHA-256 |
|---|---:|---|
| `r4-domain-baseline-release-tests.txt` | 121/121 | `8390ec17c5f930e9cf85a7db72682dfa4a03995cf25482b5ac4faeaea6e06b5e` |
| `r4-domain-baseline-prepare-tests.txt` | 34/34 | `25ec2b0951412bf3c78cc46b73c5b58fe7f68ad18702847bfa0a85b0fd23e1df` |
| `r4-domain-baseline-finite-tests.txt` | 6/6 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |
| `r4-domain-release-tests.txt` | 136/136 | `283e2a4d84cf2740ce1aa89449160c0871c293cd4009a457ff404de128981d5f` |
| `r4-domain-prepare-tests.txt` | 36/36 | `47f4ad810b36c0a957414046dae85c0cf9d659272af6a8ad492657a93f7ab433` |
| `r4-domain-finite-tests.txt` | 6/6 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |

准确 AST 增量：顶层新增 `pm2_json_domain`/`pm2_publish_ready`，既有顶层仅 `pm2_raw_binding`/`Controller` 改变，**103 项既有顶层 AST 与全文 bytes 不变**。Controller 内仅 baseline_guard 改变，**29 方法 AST/全文 bytes 不变**。剔除新增两行 guard 调用后 pm2_raw_binding 的 AST/全文 bytes 与基线精确相等；剔除 baseline_guard 一行后同样精确相等。preparer 仅 CONTROLLER_SHA 改变，其余 AST/全文 bytes 保持。

OWNER/SCOPE/Config(extraProtect)/九 PM2_GENERATION_PINS/RPC/full external aux/source/root/transport/metadata/raw-retained helper 全文保持；RPC literal UTF-8 SHA `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`。详见 `r4-domain-ast-diff.json`、`r4-domain-controller.diff`、`r4-domain-allowed-files.diff`、`r4-domain-source-and-safety.json` 与 `r4-domain-audit-output.txt`；编译只是内存 compile，无 pycache/模块执行。

| 当前六文件 | bytes | SHA-256 |
|---|---:|---|
| `release.py` | 123290 | `52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f` |
| `test_release.py` | 116805 | `dbf69aeacef81a3ba8d815fba6fede789740365274e9fa8b224440ab43a38a7d` |
| `prepare-local.py` | 22260 | `5e5fac10ad7d762ed9002dad8847af2071d48d44ff4b9c28edda74b63c51ab9c` |
| `test_prepare_local.py` | 28905 | `3f588fe155b0c717df3f8b9f00057a803548a4054d8b1c3651b026eea14ccc6f` |
| `README.md` | 22712 | `6e21b9e17c5b4a85ce2556afa3a1ff8b2846900246ed783b23c87842fb4b5454` |
| `prepare-local.README.md` | 10330 | `f5eaaeb278d9421523f2b9e5adbf5dce71baa24745af23116f24cdb830d3b6d7` |

## 4. 未执行与全部剩余 hold

只修改授权六文件及 evidence/r4-domain-*。无 Git/MCP/SSH/server/业务/TS/JS builder 修改或执行、网络/真实 Node/vendor 模块/RPC、实际 capture、生产 CLI/stage/attempt/window/approval/reload。所有测试 mutation 只在 TemporaryDirectory/mock；上面的 mock capture 调用与 actual capture 明确区分。

**actualSixReadyAllTrueVerified=false；actualSixSlotsRetainedForecastVerified=false。** 主任务仍须 actual fresh14proc（12 PM2 + 2 aux）、六 own Ready all literal True 的当次 hash-bound 证据、typed/fullSourceShape/actualfield/fullRetained/complete-byte witness、fresh full protected trees/fullMETA、真实 new fullpackage/manifest/source/tool/owner/nonce/TTL/正逆字节、独立 fullpackage 审查及后续明确部署许可。新 all-ready precondition 只是必要门槛，不能当 actual true 或 approve。

**最终：NOT_APPROVED，所有 approval 值 false。**
