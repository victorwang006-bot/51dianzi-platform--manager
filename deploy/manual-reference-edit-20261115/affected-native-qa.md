# 手填参考两价：最终实际 native candidate 独立 QA

**状态：PASS（仅代码范围）；当前未发现未关闭 blocking。**

范围为 **code-only actual native artifact mapping + source behavioral regressions**。本回执仅供父代码发布审批，schema 由独立 verified 回执控制。没有真实账号保存、数据库写测试、整 acquired bundle 执行或生产发布。

## 最终包绑定与只读性

- Candidate：`/home/ubuntu/work/manual-reference-edit-20261115/deploy/candidate`
- Manifest SHA-256（检查前、映射检查后、全部复核后相同）：`f7e5c57fe2dcd3916c848da69e0da93cd7f7f9610a06e29fa1a25519730f1623`
- Input SHA-256：`8a6c6c15a8cda4f740cbe6a62ee0eb9a954f053f055464a500cd1846a3ef5bc5`
- Source-final pins SHA-256：`ae2d898dae880bec075b80c30adefa03862908116f02be70b016e3b59d2cf943`
- 全包 384 个实际文件（含 manifest；清单 packageHashes 383 个）完整 SHA/shape 全部验证；前后三份哈希表完全一致。178 个 source-final 文件与实际仓库、候选 source-snapshot 完整 SHA 对应。

完整机器回执：[affected-native-qa.json](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa.json)。完整文件哈希见 [final-candidate-after-all-review-sha256.json](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa-evidence/final-candidate-after-all-review-sha256.json)。

## 实际补丁与源码映射

Front `f13e9335870a50a1ca1cde8de56faff8203457adac3a72d33b209a37bf0c92b4`，admin `4aa7750025df07ea292ebe235f62b32fb0f8ce0b9e69a4e8f66f450a16f99831`，与最终候选内实际 API 字节一致。Front 9、admin 1 个 span 全为纯插入，removedByteLength 全部 0；forward 全字节 partition 与 inverse 全字节恢复均通过。Front 仅 6 个既有 owner enrich 与 3 个准确新增 SQL helper；admin 仅共享 schema 1 owner，无新增 helper。全部原有 owner 顺序、imports 与不受影响 owner 保持，原成熟 runtime 权限、sourceReader、official/batch 限定、CAS/UUID/replay/audit/retry 防护没有被源码镜像整函数覆盖。

已在独立 QA 目录从 source-final 真正重新执行 TS AST owner 选取和 esbuild transform。六件 API 产物（含 raw proofs）与既有产物逐字节相同；25 份 maps/transforms/fragments/source-snapshot/来源链证据逐字节一致。候选每个 span 对应真实 fragment、source SHA、transform SHA。实际包 symbol 静态绑定通过：front Zod `z59`、admin `z6`、SQL `sql86`、既有 `ChannelInventoryError` 与各插片局部变量均绑定实际 AST 声明；原 imports 未新增或重写。

Host27 从 source-final 重新编译，compiled-host、metafile、live bindings、dependency pins 和最终两 Host 都完整字节一致。仅唯一既有 getter body 替换；原 live 表、静态/动态 imports 及其余字节冻结，inverse 通过。运行图严格 prior25+准确2新增 UI 模块，无测试/server 图。CSS 仅准确6个新增 scoped overlay rule，原 CSS source 全前缀保留。HTML 增量与 effective dependencies 重新核对通过。原3个 reference runtime/snapshot helper 与基线字节相同，未执行 worker。

实际映射明细：[actual-candidate-mapping.json](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa-evidence/actual-candidate-mapping.json)。

## 受影响行为检查

本轮仅执行 **35/35 当前实际后端源码事务 fixtures + 33/33 受影响前端行为 = 68/68 PASS**；另 **62/62 新生成 fragment 隔离检查 PASS**。没有重跑全部606 UI /437后端套件。覆盖精确小数、0/null/遗漏、授权scope/ids、CRM/write gates、CAS后同事务upsert、reselect后reread/audit、回滚与UUID replay、服务端actor元数据、手填优先/自动回退及身份变化保留确认。

[源码受影响测试](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa-evidence/source-affected-tests.json) 使用实际源码但离线SQL fixture/jsdom；[isolated-fragment-qa.json](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa-evidence/isolated-fragment-qa.json) 严格保留 `fixtureOnly:true`。这不是生产E2E。

## Host25 driver 修复前阻塞：已关闭

旧 manifest `3abc489c…` 的 `load_package` 要求 Host25，而实际 Host27，因此旧包不可 PASS。父已保留旧包并仅改 driver 一行：最终27、集合==prior25 union准确2模块、sorted==input.expectedHostSourcePaths。本复核进一步核对 manifest/input/parent review 三方路径相等、prior25仍冻结，旧新包仅 driver/input/parent-review 三件改变（manifest随之改变），API/Host/CSS完全不变。

实际最终候选 `release-driver.py` SHA为 `8d4c1fc45164f83c180b20ac2395f39ce2aa243175b8fbdadf80832bb69aae19`。调用其 **实际 `load_package(require_final=False)`**，仅映射到真实本地candidate，所有写操作和候选外访问拒绝，结果 PASS；不执行 Engine、locks、RPC、reload 或 activation。[闭环回执](/home/ubuntu/work/manual-reference-edit-20261115/affected-native-qa-evidence/driver-load-package-readonly.json)。

## 不可越过的限制

顶层 `fixtureOnly:false` 仅指绑定真实候选，不代表生产E2E；nested isolated/source fixtures 均明确 true。`productionAccountE2E:false`、`productionDatabaseWriteTests:false`、`wholeAcquiredBundleExecuted:false`。没有登录真实账号、没有验证真实账号保存、没有真实MySQL并发/锁行为、没有完整原生浏览器运行验证。只读package loader使用内存nonfinal查询envelope，不代表外部最终审批或schema回执已经验证。

本代理没有改candidate/app、SSH、DB、reload、commit；所有新增文件限定review/QA证据。父仍须单独完成schema verified绑定、最终批准、生产drift guards及授权发布。
