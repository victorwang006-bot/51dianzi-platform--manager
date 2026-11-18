# 自营 20,000 物料导入器（离线交付）

本目录仅提供离线源码、SQL 迁移、standalone ESM 编译产物与测试证据。未连接数据库、未执行任何线上写入、未 SSH、未修改账号或 JWT、未提交或推送 Git。部署/迁移/执行由主代理复核后另行实施。主代理单独更新生产 runtime 的 `assertPublishable`；这里的导入器直接调用同一原生 source service，不承担发布 controller。

## 文件与接口

`runner.ts` 是 CLI，`input.ts` 是纯离线输入适配，`engine.ts` 是原生批次/回执/恢复协议，`native.ts` 是 mysql2/promise + Drizzle 适配器，直接导入原生 `officialChannelAccess.ts` helper，并使用真实 schema 的 `adminUsers/adminUserPermissions`（局部别名 `adminPerms`）、`materials`、官方团队及自营三表。`build.mjs` 将原 service、helper、原始 schema 必要声明与私有 adapter 编译成 `dist/runner.mjs`；原账号时间/表声明保持原字节，不包含 server/db、router、前端、CRM 或 worker。运行仅依赖线上既有外部 `node_modules` 的 `mysql2`、`drizzle-orm`、`zod`、`@trpc/server`，Node 20+；不需要线上 tsx/esbuild/typescript。

正式输入为 `/home/ubuntu/materials/internal/adjusted_products.json`：顶层数组，每条 `original_fields` 与 `adjusted_tiers`。也支持 JSONL 每行同一结构、`{"products":[...]}` 包装，或适配器明确的 canonical 对象：`partNumber, brand, pkg, mallStock, moq, unit, sourceProductCode, ladderPrices[{minQty,price}]`。未知数量、缺失真实单位、不合规价格均失败，不进行默认猜测。读取原价汇总仅保留私有，不用作新价。

库存映射：`qtyOnSale = qtyStock = 原商城库存`；`qtyOrder = null`；`leadTime/dateCode/note = ''`；`taxIncluded = true`；`priceEx = 第一梯度新价格`；`moq = 原起订量`；`spq = null`（不把整包装数当采购倍数）；保留所有原梯度 `minQty + 新price`。价格只将已经为整数分的值格式化为两位，不在导入器重新调整/舍入价格。原销售单位、仓库存、参数、数量上限及其它原字段保留于私有完整 payload；不加任何用户文案。

## 私有 sidecar 协议

唯一迁移文件为 `001-official-mall-source-data.sql`，仅在 canonical **后台库 `dianzi51_admin`** 创建 `official_mall_source_data`：`materialId INT PK`、`unit VARCHAR(8)`、`sourcePayload JSON`、`importKey VARCHAR(64) UNIQUE`。其 payload 是完整输入条目的原业务数据及 adjusted tiers，没有新增说明/标注。公开 service whitelist 不变，没有 sidecar 字段、原 source 信息或原私有备注进入 note/公开 DTO。

每批原生 `importRows` 完成后，立即在独立事务中重新使用原生账号/权限/团队 helper，校验真实新物料与库存，然后写 sidecar。没有扩展原 service hook；物料和 sidecar **不是同一个事务**，因此侧表失败会停止，物料 IDs 已持久化，可安全恢复侧表而不再次 new 物料。`importKey = SHA256(datasetHash + 原行号 + 源商品编号的 canonical 对象)`，固定原 SKU/行身份，允许源同 SKU 多条真实记录，不会错误跳过。采用原生主体锁 + PK/unique key + 原 payload 精确比较，存在则仅验证，不 UPDATE/覆盖；比不受约束的 ON DUP UPDATE 更保守。最终复核全部 20,000 个 sidecar 和单位/原 payload。

## 本地离线命令（已执行）

在项目根目录运行：

```bash
node deploy/official-material-import-20261118/build.mjs
pnpm exec vitest run server/services/officialMall.test.ts server/services/officialChannelAccess.test.ts
pnpm exec vitest run --config deploy/official-material-import-20261118/vitest.config.ts
node deploy/official-material-import-20261118/typecheck.mjs
node deploy/official-material-import-20261118/dist/runner.mjs --validate \
  --input /home/ubuntu/materials/internal/adjusted_products.json \
  --output deploy/official-material-import-20261118/offline-validation
```

默认不带执行标志也只是离线全量 validate：先完成 20,000 条 material schema、原 service validator、40 个 import schema 批次预检，再决定是否创建 DB pool。离线产生输入 manifest 和 0600 字节原样私有源文件备份。整个输出目录为 0700，**勿公开发布该目录/回执/原源文件**。

## 部署后的人工入口（本任务未运行）

迁移必须先由主代理只执行唯一 CREATE TABLE 并复核真实表；生产 gate 更新之后，才可执行 runner。通过已有后台 server runtime 的环境注入 `DATABASE_URL`，不读取/猜测 `.env`，不打印连接值。下面仅是命令模板，严禁在未完成主代理部署复核前运行：

```bash
# 仅 DB/账号/权限/团队预检，没有领域写入（包含原生 helper 行锁事务）。
node /approved/path/runner.mjs --preflight-only \
  --input /approved/path/adjusted_products.json \
  --output /approved/private/persistent-receipts \
  --expected-session-version 3

# 真正执行：需要 execute + 完整 scope 确认，使用同一持久输出目录。
node /approved/path/runner.mjs --execute \
  --confirm-live-write official-material-import-20261118 \
  --input /approved/path/adjusted_products.json \
  --output /approved/private/persistent-receipts \
  --expected-session-version 3
```

账号固定既有 active `super_admin` 30004，team 固定既有 active team 1；当前 sessionVersion 从真实账号读取校验，主代理可指定预期值 3，每个原生 service/sidecar 事务仍按原 helper 重查。不设置 JWT，不修改账号或 grant。fresh run 必须只有原有 1 物料；保存完整 baseline 并在恢复/最终核对，所有写目标只能来自这次新原生 IDs。真实库必须为 `dianzi51_admin`，必须存在必需九表、必需列、InnoDB，以及原 request ledger 和 sidecar 的唯一键，不自动迁移/修复。

## 幂等与失败约束

顺序 `importRows <=500`，全部导入后顺序 `bulkAction <=100`。正常 40 个导入批次、200 个发布批次，每批打印条数进度。每个 requestId 为固定 64 位 SHA256，绑定 scope/全量数据 hash/主体/team/阶段/批号/原 payload；原 `duplicatePolicy = new`，不改原 source service request/hash/role/grant/audit/revision/public whitelist，不按 SKU 去重或跳过原有同型号记录。

调用前 fsync `attempting` 原 ID/body，成功或部分结果后 fsync 完整 native receipt，再进行下一批。`receipt.json/final-receipt.json` 包含全部 20,000 新 IDs、所有导入/发布结果及侧表结果。部分成功/行错误立即保存并停止，后续执行拒绝盲目补跑已失败批次。原生 SQL/网络异常仅保存安全 code，无驱动消息/连接值。

恢复使用同一源哈希、同一目录、同一 requestIds：已经完成的本地回执先和原生 `requestStatus` 比较，不再 new；sidecar 验证已有记录，仅补缺少的固定键；库存/报价/归属/真实 revision 变化失败，不伪造 revision 或库存。`attempting` 的原生 completed 仅精确幂等重放原 ID/body以核验原 service hash/当前权限；pending 绝不重发；not_found 默认停住。只有人工独立核对该单个事务未提交后，才可显式加 `--retry-confirmed-not-found <该原始64位requestId>`，且仍保持完全相同 ID/body。不是每批错误后自动重跑整个流程。崩溃残留 `execution.lock` 不自动删除；确认旧执行进程已停止/事务已判定后由操作人处理。不要删除回执目录或更换数据/哈希来规避失败。

## 已验证证据

离线全量 PASS：20,000 产品 / 77,881 梯度 / 12,004 零库存。真实单位：个 19,998、米 2。首源 SKU C8257，首新价 6.72，4 梯度。输入 69,165,439 字节。

- source SHA256：`b294fac6e95c556e485b591134f72910b4eac019616ee0c9fcd2879b93487eb9`
- dataset SHA256：`57c3696b687469a5126b215eef3cb80a229631d978167d02014a1006da1b312b`
- service + native access：58 tests PASS（service 53、access 5）。
- adapter + checkpoint/恢复及非零毫秒/北京时间回归：16 tests PASS。
- 限定范围 strict TypeScript PASS；harness 使用原 runtime 源码与原 schema 必要声明，仅未用到的 tRPC context 是 type-only stub。项目 `tsc --noEmit --incremental false` 亦无诊断输出。
- `dist/build-manifest.json` 保存最终 compiled artifact 和 12 个原 source 哈希及窄 schema 原字节证明。

最终 snapshot 校验保留原服务 ISO 毫秒，严格验证合法且 canonical ISO，再按秒比较 snapshot/数据库 publication/数据库 material 三处时间；用已验证的原 snapshot ISO 重建白名单并全字段 canonical 比较，不因 SQL 秒精度丢掉 snapshot 校验。

零库存/空货期上架直接和 bulk 都通过；未知/部分未知库存无真实订货仍失败；正订货 + 真实货期原规则保留；缺报价、伪现货、库存关系错误仍失败；真实库存 100→0 必须显式下架/edit/再发布且 audit 前后保存原值。没有 UI 修改或新增用户文案。
