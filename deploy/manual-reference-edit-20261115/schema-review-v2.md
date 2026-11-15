# 单表维护 v2：IR-SCHEMA-01 独立只读复核

**判定：PASS。原 P1 blocker IR-SCHEMA-01 对下列受审 v2 SHA 已关闭。** 本结论来自新执行的全内存正负例，不是把旧报告的 FAIL 当作新 approval，也不代表真实 CREATE 已执行或部署完成。

复核时间：2026-11-15 18:21–18:24（北京时间）。仅本地读取代码与材料、执行隔离 fixture，并写本报告和 [机器可读完整结果](/home/ubuntu/work/manual-reference-edit-20261115/schema-review-v2.json)。未修改实现、旧报告、旧维护目录；未 SSH、连接真实 DB、调用真实 PM2、stage 或执行真实 DDL，未重跑完整应用 tests。

## 修复前后 SHA-256

| 工件 | SHA-256 |
| --- | --- |
| 修复前 `manual-schema.cjs` | `622106d4e8b6c28fbb3dcd168be388fd6f5ed177e64f6ede81687a06ebf86de4` |
| 修复后 `manual-schema-v2.cjs` | `a2fb64929aabddef823abf2d4527da53a8668474a2cee445bdf89fb9069147ae` |
| 修复前 `run-schema.py` | `206244cf1a08e0b94e09d623e0ad470e76af494619526573b056ff6935a51f1f` |
| 修复后 `run-schema-v2.py` | `0972ed251b718c94df6f63b8b6caf0902c4b6d11cd8166c99cd3f446a95ca2b2` |
| 不变 `schema.sql` | `9330afcdf24e1cc69eba70f8a382b3f4215a5c41a6ac50d7e5380da6ccc70793` |

以上实现、SQL、旧报告及旧 `schema-maintenance` 两文件的首尾指纹均一致；旧目录仍只有 intent 和 plan，未出现本审查写入或 apply 回执。

## 关闭证据

`manual-schema-v2.cjs:94–101` 使 apply 和 verify 都读取固定计划，先核对计划字节 `planHash`，再核对 `status`、独立 `root`、请求 UUID、`intentHash` 和 `sqlSha256`。`run-schema-v2.py:30–31` 向两种模式都传计划 SHA。

`manual-schema-v2.cjs:57–60,101,112–114` 对四表完整 `{count, sha256}` 和新表 0 行建立强制后置条件。apply 必须通过后才创建成功回执；verify 必须对比原 plan 基线且新表为空才能返回成功。因此 `protectedUnchanged:false` 或 `manualRows:1` 不再只是写进一个成功对象。

四张保护表是 `channel_inventory_materials`、`channel_inventory_channels`、`crm_customers`、`crm_customer_supply_channels`。hash 负例保持行数不变、仅改变内容；count 负例增加行；另有保持实际行 hash 不变、只改变 plan count 的负例，确认 count 也参与严格比较。

apply 成功对象本身未新增 `planHash` 字段；该绑定存在于实际执行门禁及 durable create-intent，verify 成功对象则显式包含它。此字段差异不构成本次旧 blocker 的绕过。

## 实际执行：48 个不同用例，48/48 符合预期

直接将实际旧版/v2 CJS 放入 Node VM，**只在内存追加主函数访问口，不改源文件**。FS 的 read/open/write/fsync、PM2 jlist、mysql connection 和所有 query 全部为内存桩；模块加载白名单禁止其他执行源。

| 用例组 | 数量 | 实际结果 |
| --- | ---: | --- |
| 旧 apply：业务 hash 变化且新表 1 行 | 1 | 重现错误成功 `CREATED_ONE_MANUAL_REFERENCE_TABLE`，写成功回执；作为修复前对照，不是批准 |
| 旧 verify：业务变化、新表 1 行、错误 planHash | 1 | 重现 `VERIFIED_MANUAL_REFERENCE_SCHEMA` 绕过 |
| v2 plan / apply / verify 正例 | 3 | 分别计划成功、CREATE 成功、只读验证成功；apply 回执 file+dir fsync，verify 返回 planHash |
| v2 每张保护表单独 hash/count 变化 × apply/verify | 16 | 全部 `PROTECTED_BUSINESS_DATA_CHANGED_NO_SUCCESS_RECEIPT`；无成功回执/成功返回 |
| v2 新表 1 行 × apply/verify | 2 | 全部 `NEW_MANUAL_TABLE_NOT_EMPTY_NO_SUCCESS_RECEIPT` |
| v2 业务变化且新表 1 行 × apply/verify | 2 | 全部拒绝成功 |
| v2 错误/缺失 planHash × apply/verify | 4 | 全部 `PLAN_PIN_MISMATCH`；apply 零 DDL、零意图写入 |
| v2 错误 plan root / UUID / intentHash / SQL SHA / status × apply/verify | 10 | 即使提供该错误 plan 的正确字节 SHA，也全部 `EXACT_PLAN_REQUIRED`；apply 零 DDL |
| v2 apply 前业务基线变化 | 1 | `BUSINESS_BASELINE_CHANGED_REPLAN_REQUIRED`，零 DDL |
| v2 仅 plan count 不符 × apply/verify | 2 | 全部拒绝，证明 count 独立参与比较 |
| v2 已有 durable intent / 已有表 | 2 | 分别 EEXIST / `TABLE_ALREADY_EXISTS_NO_APPLY_REPLAY`，零 DDL，不重放 |
| 实际 Python runner 主分支：apply/verify 的模拟成功/非零退出 | 4 | 两模式均传 planHash、保留双 flock；失败零本地 result 写入、零后续回执上传调用 |

CJS 44 个用例中的所有 v2 负例均没有成功返回或成功回执。凡 apply 已模拟执行一次 CREATE 后才失败，都保留 CREATE 前已 file+dir fsync 的 intent。所有 fixture 都没有 DROP、业务表 DML、删除意图或自动重放；连接锁释放及关闭也被核对。

完整 CJS harness 和实际输出见 [内存执行原始证据](/home/ubuntu/terminal_full_output/2026-11-15_10-22-31_962494_1152.txt)。runner 四例的实际输出见 [runner 内存边界证据](/home/ubuntu/terminal_full_output/2026-11-15_10-23-26_852192_1152.txt)。JSON 逐例记录状态、错误、是否写成功回执、DDL 数量及 durable intent 状态。

## 保持不变的边界

只读 diff 确认 SQL guard、table/columns/types/PK/collation 校验、四表 snapshot、同连接 GET_LOCK/RELEASE_LOCK、双非阻塞 flock、wx + file fsync + directory fsync 均保持原实现。协调文件仍按完整 SHA `7137531cdad59bb3484117fd33f88a82c85ef2f83ab7104a7106c2602fee4e61` 校验；仅 CREATE，不自动 DROP、不清意图、不盲重放。额外执行了 Node 语法检查和 Python AST 解析。

v2 使用独立 ROOT `/opt/ops/20261115-manual-reference-schema-v2-JfFQcJM` 和本地 `schema-maintenance-v2`，没有改旧 ROOT 的受审配置或旧本地 attempt。

**并行状态说明：** 开始复核时 v2 本地目录不存在；18:23 末尾发现父任务并行产生了 v2 本地 intent/plan，只读查看的 plan 为 `PLANNED_ONE_CREATE_TABLE`、`ddlStatements:0`，UUID `1fa93d87-1d02-4af7-98b6-b51cd76059b5`，runner SHA/SQL SHA 与本审查一致。报告准确保留此变化，不再声称“复核结束仍未 stage”；这些是已有本地材料，远端状态未经本审查独立核验。本审查自身没有执行 stage/plan/DDL。

## 适用范围

本 PASS 仅关闭固定 v2 SHA 的 IR-SCHEMA-01，可作为此定向代码审查结论；仍须在后续维护中使用原固定 intent/plan、新独立 ROOT 和这些 SHA。未知 CREATE 结果必须保留现场，只读人工核查，不自动 DROP/删除 intent/重放。

本地 fixture 不是 MySQL 真实锁并发或 fsync 掉电证明，也不是已上线证明。606 frontend +437 backend pass 是父提供的既有结果，本审查未重跑。旧 `independent-review.json/.md` 保持旧版 application PASS / maintenance FAIL；新 v2 结论只以本报告为准。
