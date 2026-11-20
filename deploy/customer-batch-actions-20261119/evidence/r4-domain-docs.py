from pathlib import Path
import hashlib
root = Path(__file__).absolute().parent.parent
sha = hashlib.sha256((root/'release.py').read_bytes()).hexdigest()
old = '8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0'
path = root/'README.md'
text = path.read_text()
assert text.startswith('# 客户批次发布控制器：R4 外部推荐服务最小离线保护\n')
current = f'''# 客户批次发布控制器：R4 JSON-domain 与零写发布 pre-gate

## 当前状态：NOT_APPROVED（2026-11-20）

当前 controller SHA256 **`{sha}`**，preparer 固定 `CONTROLLER_SHA` 已同步。准确增量基线为 **`{old}`**，六文件先保存到 `evidence/r4-domain-baseline-8dc/`，基线哈希见 `evidence/r4-domain-baseline-sha256.txt`。OWNER `6Lfttf6oVWJ8YS69o5FkXQ`、SCOPE `customer-batch-actions-20261120-6Lfttf6o-R4` 不变；R4 从未 remote/stage/capture/attempt，本增量只静态更新 pin，不迭代 scope，不重用旧 pin capture。

本增量仅六个许可 Python/测试/README 文件及 `evidence/r4-domain-*`。没有 Git/MCP/SSH/server/业务/TS/JS builder、真实 Node/模块执行、实际 capture、CLI 或 reload。测试中 capture/preflight/apply/恢复/锁/CAS 均为唯一 TemporaryDirectory 与 mock，诊断 capture 不写 capture 文件，不能视为 actual witness。

## 递归 clone JSON 域：拒绝，不清洗

已读 `/home/ubuntu/work/customer-batch/review-fclone-offline.md`、`.json` 及实际本地 `fclone-resolved-once/fclone.js`；源码 1239 bytes，SHA `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。源码用普通 `{{}}` 的 `copy[key] = ...`，自有 `__proto__` 值为对象/null/string 的三个合法 JSON 反例已由独立离线审确认会丢 key 或改变副本 prototype。Utility.clone 根 null→`{{}}` 的差异不适用已要求 dict 的 model.pm2_env；不忽略该边界。

新增纯 `pm2_json_domain` 在 `pm2_raw_binding` forecast 前分别检查**完整 model.pm2_env e** 与**完整 actual serialized value**。递归拒绝任何 `__proto__` key、非标准 dict/list/JSON 叶类型、非字符串 key、非有限 float、`abs(int) >= 2**53`、非树的 Python cycle/shared container 与不支持的递归深度。字符串/key 使用 strict UTF-8，lone surrogate 报 `ReleaseError`，绝不替换字符。有限 Python float 本身是 binary64（含 1e20/最大有限值），不将它们误限为 PM2 生成安全整数；整数跨语言精确保留则只接受 JS safe integer。

guard 不改 decoder 的合法字符串政策；JS UTF-16 可含孤 surrogate，原 forecast strict UTF-8 已阻断，本检查只将该有限证明域提前显式拒绝。普通 `constructor`、`prototype`、`toString` 数据 key 和含 `__proto__` 文本的 opaque string 不被泛化禁用。没有删字段、递归 env 清洗、canonicalization、字节重写或新增生命周期例外；原 app retained bytes、metadata 五字段与 token/escape/order 规则保持。

**JSON 投影不能反推 original daemon 的 prototypes/functions/special/accessors/undefined/symbols/cycles/shared identity**。guard 不是 typed/fullSourceShape witness；unknown typed/full witness 仍需 actual 新核验。原独立 fclone 15 样本结论仍只是限定 clone 证据；本轮 15 个 finite/UTF-8 Python guard/deepcopy 样本不是重新执行 Node/fclone，也不是实际六槽预测通过。

## 正式 preflight/apply：已知 false 在任何写入及发布 snapshot RPC 前拒绝

固定 R3 离线审 `review-r3-offline.md:69–86` 指出旧行为是 late-gate/controlled-failure，并非成功绕过：合法 false 可以在 attempt/open/assets/API CAS 之后才由单槽 reload gate 拒绝，front-ready/admin-false 甚至可能先滚 front。本增量不重写恢复协议，只在 **baseline_guard 最前面**新增 `pm2_publish_ready`：identity-bound **六 own 槽** `pm2ReloadReady is True` 必须全部成立，否则 `PM2_SIX_OWN_NOT_ALL_READY_NO_ATTEMPT_NO_PUBLISH`。

baseline_guard 实际仅被 preflight/apply 调用，均在 receipt mkdir / attempt 之前；先检 sealed capture six readiness，再由既有 exact snapshot guard 拒绝 true→false 或任何其它漂移。six ID 在 actual fresh capture 必须为 190/191/192/193/194/200；测试也用这些 ID，但代码依既有 name/script/identity 得到 b.ids，不新造固定 ID/CLI 例外。unowned/外部辅助 readiness 不纳入该门槛。capture/identity 与 candidate not-approved 的合法 false 诊断不变；原单槽 intent 前 `...UNPROVEN_NO_RELOAD` 保留。rollback/restore/guard/state/journal/receipt 全不改，必要恢复不受新发布前 gate 阻断。

## 限定回归与精确差量

修改前 **121/34/6** 基线重新通过；新增后 **136/136 controller、36/36 preparer、6/6 finite JSON** 通过。原全部测试方法保留，仅一个旧 __proto__ override 预期接受更早 domain 拒绝；原 late direct reload 测试仍手工开 mock window 并验证单槽 guard。新增 root/env/nested opaque/list 的 model/raw __proto__ 反例证明 input/env 不清洗、forecast 未执行；有限域/UTF-8/safe JSON、普通 constructor、all-false/mixed pub 拒绝全覆盖。四个 pub 反例逐项断言 attempt/exclusive/new receipt/window/immutable assets/API CAS/intent/adapter/RPC 全 0、整个临时树 bytes/full META 完全不变；mock capture 返回 false/identity 接受和手工恢复 false journal 也通过。

完整日志 `evidence/r4-domain-release-tests.txt`、`r4-domain-prepare-tests.txt`、`r4-domain-finite-tests.txt`；首轮测试 fixture 重复 opaque key 的错误日志保留为 `r4-domain-release-tests-initial.txt`，只改测试新增键为 domainWitness，没有放宽 duplicate-key 或生产政策。source SHA、日志 SHA、准确 AST/逐函数全文 bytes 比较、完整六文件 diff 与报告见 `evidence/r4-domain-source-and-safety.json`、`r4-domain-ast-diff.json`、`r4-domain-controller.diff`、`r4-domain-allowed-files.diff`、`r4-domain-report.md`。

对 8dc：仅新增 `pm2_json_domain` / `pm2_publish_ready` 两纯 helper，改 `pm2_raw_binding` 两行调用及 `Controller.baseline_guard` 一行；不是修改全部 Controller。原 OWNER/SCOPE/extraProtect、九 generation pins、RPC、外部辅助 protection/transport/root 以及其它 Controller 方法全文 bytes/AST 不变。preparer 源码仅固定 pin 一项 AST 改动。

## 剩余 hold：必要门槛不是实际 true，更不是批准

**controllerApproved=false；releaseApproved=false；finalDeployApproval=false；reloadApproved=false；NOT_APPROVED。** 仍待主任务真实 fresh14proc、**六 Ready 全部 True 的 actual hash-bound 证据**、typed/fullSourceShape/actualfield/fullRetained/complete-byte witness、fresh full protected trees/fullMETA、fresh new full package/manifest/source/tool/owner/nonce/TTL/正逆字节及独立 fullpackage 审查与明确部署许可。all-ready 新代码不能描述为实际 all true，也不能替代任何 witness 或 approve。R4 无实际 capture/stage/attempt/approval/window/reload。

---

## R4 8dc 外部保护历史（以下不是当前 pin 或本增量差量）

'''
path.write_text(current + text.replace('# 客户批次发布控制器：R4 外部推荐服务最小离线保护\n', '# R4 8dc 外部推荐服务离线保护记录\n', 1).replace('当前 controller SHA256 为', '8dc 阶段 controller SHA256 为', 1).replace('`prepare-local.py` 固定 pin 同步。', '当时 `prepare-local.py` 固定 pin 同步；现已更新到上方新 pin。', 1))
path = root/'prepare-local.README.md'
text = path.read_text(); assert text.count(old) == 1
text = text.replace(old, sha)
text = text.replace('R3/bf7 基线仅用于差异审计', 'R3/bf7/8dc 基线仅用于差异审计')
text = text.replace('`README.md`、`evidence/r4-controller.diff` 和 `evidence/r4-report.md`', '`README.md`、`evidence/r4-domain-controller.diff` 和 `evidence/r4-domain-report.md`')
text += '''
## R4 domain 增量（2026-11-20，仍 NOT_APPROVED）

准确 8dc 基线六文件先存于 `evidence/r4-domain-baseline-8dc/`。controller 新增 pure recursive JSON-domain guard：完整 monitor e 与 actual serialized value 分别拒绝 `__proto__`/非 JSON/非有限数/unsafe integer/strict UTF-8 编码不支持的 lone surrogate，不删 key、不清洗 env、不 canonicalize。普通 constructor/prototype key 保留；不从 JSON 投影反推 original daemon typed shape。原 decoder 与业务合法字符串政策不改，模型根 dict 已排除 Utility.clone 根 null 的差异。

正式 pub 的 baseline_guard 在任何 receipt/attempt/write 和发布 snapshot RPC 前要求 identity-bound six-own 全部 `pm2ReloadReady is True`，保留原单槽 gate；不覆盖 unowned/外部辅助，不修改 rollback/restore/state/receipt。**本 preparer 输入与 candidate seal 的合法 false 诊断仍接受，不新增审批或封印策略**。prepare/seal 结果仍 not-approved；不能把 pub 必要前条件当实际六槽 all true 或独立审批。

本增量基线 121/34/6 已重跑，现 controller **136/136**、preparer **36/36**、finite JSON **6/6** 通过，日志 `evidence/r4-domain-release-tests.txt`、`r4-domain-prepare-tests.txt`、`r4-domain-finite-tests.txt`。原 34 preparer 方法全部保留，新增旧8dc capture pin拒绝与合法false输入仍只诊断。真实 builders/CLI/生产/actual capture/reload 均未执行。准确 AST/source/log SHA 见 `evidence/r4-domain-ast-diff.json` 与 `r4-domain-source-and-safety.json`。

真实 fresh14proc、six Ready all True typed/retained witness/freshMeta/new fullpackage 及独立全包审查全部仍待主任务。**controllerApproved=false；releaseApproved=false；finalDeployApproval=false；reloadApproved=false；NOT_APPROVED。** R4 从未 remote/stage/capture/attempt，SCOPE 不迭代，仅静态 pin 更新。
'''
path.write_text(text)
