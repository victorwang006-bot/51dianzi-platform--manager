# 业务销售订单 metadata 独立只读审查

**最终结论：BLOCKED（仅默认 UI 可写授权传播；后端与共享契约／schema 源码审查 PASS）。**

审查时间：2026-11-13，约 22:36–22:40（Asia/Shanghai）。根目录：`/home/ubuntu/work/51dianzi-platform--manager`。判断采用常规生产 QA 标准，不将静态源码与纯 fixture 测试等同于浏览器、生产 API 或真实 DB 验收。

## 范围及执行边界

独立阅读了 `shared/businessSalesOrderMetadata.ts`、`server/services/businessSalesOrderMetadata.ts`、`server/businessRouter.ts` 的授权链和四个新增方法、`drizzle/businessSalesOrderMetadataSchema.ts` 及对应四组测试；补读 metadata UI 组件、父任务正在整合的默认 CRM 插槽、既有业务授权 fence／UI capability 契约，以及本地 `front-router-types` 中原 CRM get、客户可见性及固定委派契约源码。

未修改源码、脚本、Git、SSH 或 DB；未读私钥、凭据文件或真实订单清单；未启动浏览器、调用真实 API、运行 DDL／migration／backfill／factory 脚本。唯一业务测试为现有纯 fixture/mock 测试，命令显式移除了 `DATABASE_URL`；唯一主动写入的交付物为本报告。未向新表写入任何 fake factory records。

授权解释严格限于独立收货记录、售后意向与跟进记录，不要求新增 CRM／售后状态机。`return_request`／`refund_request` 不产生支付动作，`closed` 是记录已结案，不表示退款、退货入库完成。

## 唯一阻塞：默认 metadata UI 没有交集精确写 capability

**级别：P2，阻塞默认 UI 完整验收，不阻塞后端权限边界判定。不是服务端授权绕过，也没有发现未授权数据写入。**

定位（相对根目录，以下行号为读取时版本）：

- `client/src/business/platform/client/src/pages/CrmSalesOrders.tsx:275–281`：`canWrite = !embedded || (...)`。独立 CRM 路由无 `embedded` 时，始终把页面认作可写，只与 verified 状态组合为 `useSalesOrderSession(canWrite && verified)`。
- 同文件 `:429–430`：新默认 `wrapList` 直接将页级 context 传给 `BusinessSalesOrderMetadataProvider`。
- 同文件 `:949–957`：传入 metadata context 的 `canWrite` 是 `session.isWritable()`，并未读取当前商户精确的 `crm.sales_orders` 写 capability。
- `client/src/business/SalesOrderWorkspace.tsx:24–25,46–47`：业务订单允许通过只读 `crm.sales_orders` source gate 进入；这是正确的读入口，不能当成写授权。
- `client/src/business/BusinessWorkbenchAccessGate.tsx:55–68,105–130`：现有 UI 明确提供当前商户的独立 `writeCapabilities`，缺失／部分响应必须只读；默认 route gate 不要求 write。
- `client/src/business/platform/client/src/components/businessSalesOrderMetadata.tsx:170–175,183–203,310–312,463–488,513–527,568–586`：provider/session 和编辑器信任上游 `canWrite`。因此，只有 orders.read／没有 orders.write 的已 verified 独立 CRM 页面仍会显示保存、登记、更新按钮，而不是“（查看）”及只读表单。

**为何需要修复：**新增 metadata UI 已有完整只读模式，但默认整合没有正确传入该模式。读用户可提交必然被 BFF 拒绝的写请求，不能声称默认 metadata 管理 UI 已按精确授权验收通过。`server/businessRouter.ts:526–528,732–740` 仍会严格拒绝此类请求，故本发现不升级成越权漏洞。

**最小修复：**仅对新增 metadata provider 的 write grant 做交集：当前商户已核验的 `crm.sales_orders` 写 capability（使用既有 `useBusinessWorkbenchAccess()`／等价 verified page prop，确保 merchant 匹配）**且**页级 session writable；继续保留客户嵌入页的 `canRead/canWrite/readOnly/archivedAt` 条件。不要仅采用全局 `merchant.canWrite` 或任意模块 write capability。无需改原 CRM CRUD 状态机、财务 API、原 DB 或售后流转规则。

若利用现有 context capability 判断 readReady，注意 metadata BFF 还要求本地 customers.read；现有 CRM read capability 不能被当作额外客户授权的合成器，实际 BFF 与原 get 仍是最终门禁。

**最小回归证据：**增加默认独立 CRM 插槽用例：read capability 有 `crm.sales_orders`、write capability 无该项时，metadata 只显示“（查看）”、无提交按钮及 mutation；只有其他模块可写也不应启用；当前 CRM 写 grant 变化时重新隐藏旧对话框／取消待处理结果。现有组件测试直接赋予 `props.canWrite=false`，因此不能覆盖上述默认页级传播缺口。

## 六项审查证据

### 1. 顺序、原始授权与 scope 撤销：PASS

`server/businessRouter.ts:292–360` 中 `withCurrentBusinessAuthorization` 先要求具体有效后台员工账号，取得既有 account→merchant authorization fence，重新读取 active staff binding 和当前商户 scope，校验 merchant 与 orders 读／写范围。metadata 路径未获得 inventory 官方授权特殊旁路。

`server/businessRouter.ts:519–557` 的新增 wrapper 在 fence 内额外要求 `customers.read`，使用本地 range-checked merchant 的企业绑定及当前 staff，固定执行原 `crmSalesOrder.get`，只转发订单 id 和可选 customerId。原 get 成功后，才 derive provenance 并调用 native metadata operation。四个声明 `:732–740` 分别是 orders.read 的 query、三个 orders.write 的 mutation；浏览器不能选择 remote method、actor、merchant provenance。

`server/businessAccess.ts:80–91,152–184,190–211` 没有超级管理员跳过 scope 或企业绑定的分支。`server/businessAuthorizationFence.ts:37–48,107–149` 在 account→scope 同一锁顺序内保持整个 callback，metadata native transaction 完成之后才释放。`server/db.ts:2489,2684,2951,3072` 的既有 binding／scope 改动入口使用相应同一 fence。

原源码契约亦保留：`front-router-types/server/services/internalBusinessDelegation.ts:190–194,378–425` 以真实绑定 staff 构造原 procedure caller；`front-router-types/server/routers/crmSalesOrder.ts:26–36` 使用 `sales.business_orders` 及真实 `ctx.user.id`，不是 legacy effective owner。原 get 服务 `front-router-types/server/services/crmSalesOrders.ts:150–158,266–267,601–619` 每次检查有效成员、业务订单权限和当前客户／需求策略；`services/customerDemands.ts:33–47` 是两套原策略交集，不用列表或 metadata 本地记录替代可见性检查。

对应 router tests `server/businessSalesOrderMetadataRouter.test.ts:76–185` 覆盖顺序、只读禁止三个写入、binding/scope 缺失、客户 scope 缺失、商户不允许、anonymous/OAuth、super-admin 撤销 scope、原 get 拒绝／失败、伪造字段、当前重新绑定 actor、幂等 replay 仍重新验证原 get。源码确认同样不能以 super-admin 绕过缺失 binding。

### 2. 参数绑定、单连接事务、CAS／幂等与 rollback：PASS

`server/services/businessSalesOrderMetadata.ts:113–129` 使用 `getDb().transaction(tx => ...)`，全部 metadata SQL 使用 callback 的 `tx.execute`。没有 pooled execute 的手工 BEGIN／COMMIT，没有 `$client` 绕过 Drizzle transaction。authorization fence 的单独 advisory-lock connection 是既有授权设施，不是 metadata DML 的第二连接。

`sql` 模板中的用户文本、数字 tuple、requestId、action、hash 和 JSON 均为绑定参数。动态片段仅是固定的 `FOR UPDATE`、`closedAt`／`CURRENT_TIMESTAMP(3)`／`NULL`，不是用户拼接。

`service:130–150,195–246` 以独立 orders registry 的 `(merchantId,orderId)`／`(merchantId,orderNumber)` 唯一键作为订单级写串行点，duplicate 不更新 provenance；随后 exact tuple 比较，碰撞不会覆盖历史归属。requests 的唯一 key 是 `(merchantId,orderId,actorAdminId,requestId)`；hash 包含 action、完整 server-derived provenance 和规范化 input payload。重用不同 payload／action 会 conflict；原样 replay 返回原 result，仍先经历 wrapper 的当次原 get。

`service:249–278,298–321` 先读版本并校验，UPDATE 还要求精确 merchant/order/orderNumber/customer 和 version，校验 affectedRows 及重新读取的新版本。新增售后、audit、request result completion 与 receiver/case 全部处于同一个事务。`service:232–244` audit 或 request completion 失败会抛错并触发整体 rollback；无业务动作 delete。

服务 fixtures `server/services/businessSalesOrderMetadata.test.ts:90–148,159–175,200–227` 检验 hostile 文本参数化、同 key replay／变 payload conflict、并发与 stale CAS、tuple collision、audit/request-completion failure、坏 result fail closed。真实已安装 Drizzle 的 inert-driver 测试 `server/businessSalesOrderMetadataSchema.test.ts:64–105` 检验 callback-Pool 和 PromisePool 都只租一个连接，绑定 SQL、commit/rollback/release。此证据不冒充真实 MySQL 并发验收。

### 3. source 结果严格 scope／provenance：PASS

`service:16–22,48–72` provenance/actor schema 均 strict，numeric ID 不作字符串／enterprise／owner alias 强制转换。merchant 来自已准入的 native merchant；orderId/orderNumber/customerId 来自当前原 get。requested id、可选 customerId 必须相符；原 DTO 若携带 merchantId，也必须一致。

`service:130–181` 每个读都有 merchant+order 范围；registry collision、receiver/case tuple、case id、重复 case、孤儿 metadata、时间／状态格式不合法时 fail closed，不输出混合 scope 或伪造空成功。`service:207–225` replay row 必须当前 tuple、actor/key/action/hash 均一致并经过 DTO schema。

UI `components/businessSalesOrderMetadata.tsx:84–104,214–224,249–254,601–625` 同时验证当前原 get 的 id/orderNumber/customerId，以及 metadata 的 merchantId/orderId/orderNumber/customerId。导出不使用可见页缓存；batch 任一错误整批拒绝，兄弟请求 abort，未生成部分结果（`:630–675`）。

### 4. 无原 financial／front DB 写入、无联系人冒充 receiver：PASS

三个 metadata 写路径向 front 固定调用的只有 `crmSalesOrder.get`；不会调用 create/cancel/recordPayment/ship/order.refund 等原业务 mutation。fixed bridge transport 本身采用 mutation 形态，但原 target 是 get query，不等于财务写入；原 dispatcher `internalBusinessDelegation.ts:378–425` 和原 get `crmSalesOrders.ts:601–666` 未出现该 get 的原订单／付款／库存 DML。

metadata service 所有 SELECT/INSERT/UPDATE 仅涉及 `business_sales_order_` 五表。没有金额、付款、refundEvidence、stock 字段；不存在原订单 FK、订单写入／payment／inventory 逻辑或联系人查询／回填。`components/businessSalesOrderMetadata.tsx:440–447` receiver draft 只来自独立 metadata.receiver，否则空值；cells 与 export 按独立保存字段／明确未录入显示，不把客户联系人当收货人。

`shared/businessSalesOrderMetadata.ts:3–10,24–37` 和 UI `:31–45,336,505,511,553` 明确意向／登记语义，`return_request` 为退货申请、`refund_request` 为退款申请、open 为登记、closed 为已结案。UI 对旧 `return` 仅 label 兼容，新的共享输入 enum 和 schema 已统一 `return_request`；没有声称已支付、已退款或已退库。

### 5. schema／DDL 类型与精度：源码 PASS，独立 DDL 激活未验收

五表均在 `drizzle/businessSalesOrderMetadataSchema.ts:5–63`，统一 `business_sales_order_` 前缀，无原表外键，registry 仅在 metadata 新写入时建立，不做 backfill。空 metadataGet 仅 SELECT，不初始化表记录（`service:169–183`，service test `:57–63`）。

共享输入／DTO ID 与 server provenance/actor 的上限为 **2,147,483,647**（`shared:12–13`，`service:16–22`）。相关存储列均为 `INT UNSIGNED`，可容纳该接受范围；version 输入最多 2,147,483,646，版本加一仍符合 DTO 上限。售后 insertId 不符合该 ID schema 时事务失败而非截断。audit 自增 id 是 unsigned bigint，不外发为 metadata DTO；driver resultHeader 仍要求 safe integer，极远期超过 JS 安全范围会 fail closed，不是静默近似成功。

orderNumber≤128、receiver≤64、phone≤40、address/note/reason/resolution≤500、requestId≤80、hash=64 与 varchar 对齐；JSON 使用 native JSON；timestamp 统一 fsp3。未发现新增 monetary decimal 或类型精度降级／历史字段截断。

本审查范围内的交付是 schema 声明，没有运行或证明某份生产 DDL 已按此激活，也不把“尚未激活／无真实记录”视为要求写 fake records 的理由。独立激活应只创建这五表并保持字段、唯一索引、存储引擎及字符集满足本 schema，禁止原表 ALTER／迁移／回填。源代码与 unsigned 容量足以判定当前 bounded ID 不截断；现有测试没有专门断言 ID=上限与上限+1 的边界，这属于可补的小型纯契约测试，不构成当前源代码阻塞。

### 6. UI requestId／retry／cancel／身份重新验证：组件 PASS，默认页 write grant BLOCKED

组件以 secure crypto 生成 requestId（`:106–113`），按 payload 复用（`:406–438`）；网络失败原样重试不变 key，改 payload 新 key；CAS 冲突保留表单，显式刷新版本后核对重试，不自动覆盖。新增／更新成功只刷新 metadata，更新版本取实际重新读取结果，不盲增。

provider keyed session 包含当前 merchant、customer、read/write、身份／授权／read version 和可见订单 tuple（`:156–177`），范围或 tuple 改变同步丢弃旧 session，对 pending reads/writes abort（`:200–204,263–301`）；切换／关闭对话框也取消旧 pending write 结果（`:303–324`）。每次 load 和 write 都调用 live get；write 提交前再次校验 active tuple/write grant；post-write `load(order,false)` 不额外重复客户端原 get，但 metadataGet 服务端本身仍重新执行原 get。不是拿 metadataGet 替代原 visibility check。

UI tests 覆盖 secure requestId、网络重试、scope/identity 变化、write grant 变化、对话框切换、冲突保留草稿、scope mismatch 和 batch export 全失败，无真实 fetch。但测试只单独驱动 provider props，未覆盖新增默认页的真实 write capability 传播，故阻塞项不被 96 个绿灯消除。

## 实际测试记录

执行现有测试命令：

```sh
env -u DATABASE_URL pnpm exec vitest run \
  server/services/businessSalesOrderMetadata.test.ts \
  server/businessSalesOrderMetadataSchema.test.ts \
  server/businessSalesOrderMetadataRouter.test.ts \
  client/src/business/platform/client/src/components/businessSalesOrderMetadata.test.ts \
  --reporter=verbose
```

| 文件 | 用例 | 结果 |
|---|---:|---|
| `server/services/businessSalesOrderMetadata.test.ts` | 38 | PASS |
| `server/businessSalesOrderMetadataSchema.test.ts` | 9 | PASS |
| `server/businessSalesOrderMetadataRouter.test.ts` | 31 | PASS |
| `client/src/business/platform/client/src/components/businessSalesOrderMetadata.test.ts` | 18 | PASS |
| **合计** | **96** | **4 文件全部通过** |

运行于 22:37:31（Asia/Shanghai），耗时工具输出为 10.32s。服务／router DB 与 upstream 均被 mock；schema driver 是 inert client；UI mock native client 并断言真实 fetch 未调用。

## 残余风险／未验收项（不泛化为新需求）

1. **浏览器、真实 API／DB、生产 DDL 均未验收。**真实部署兼容性、实际索引／事务引擎、SQL 模式／时区／字符集、生产授权响应及运行容量属于独立激活／部署 QA，不要求本审查等待真实读写，更不要求工厂假数据。
2. **取消不等于服务器回滚。**AbortSignal 防止客户端应用过期结果，无法保证已提交 mutation 没有 commit。组件对未确认结果提示核对记录；同一挂载表单原样 retry 复用 key。若关闭／重挂载后再登记，requestId 内存会消失，必须先重新核对记录，不能宣传 cancel 为业务撤销。
3. **幂等 replay 返回原保存结果，不是当前版本。**这是设计内行为，UI 后续 live metadata read 取得现状；若保存成功但 refresh 失败，保留未确认错误而非伪成功。只读查询与每订单售后记录总量尚无独立分页，规模增长时需容量评估，但不作为当前授权／有限记录功能阻塞。
4. **授权依赖既有 fence 与原 CRM 的当前服务契约。**本地 binding/scope 撤销与 metadata callback 被同一 fence 串行化；远端原 CRM 的业务授权仍按原 get 的当次检查，未新增跨服务原业务权限事务／状态机要求。
5. 父任务同时整合 `CrmSalesOrders.tsx`，该文件审查中发生修改。阻塞描述针对 22:38–22:39 读取到的默认 provider 接线；后续若父任务已做最小交集修复，应重新只读核对该处与对应纯回归，不以旧报告否定新版本。五个核心文件在开始／结尾核对时保持相同摘要。

## 核心文件 SHA-256（22:39:42 核对）

```text
a62b17b64f1855e59ec64c8896f99c802629be87e00107ce11360388a1e4b7b1  shared/businessSalesOrderMetadata.ts
a7ebd3c288cd596b82466e154a29f2472b1e80ec390d53d807eb3aeec2ccc2f2  server/services/businessSalesOrderMetadata.ts
4ab641f464d3da2e8b7958e4f8aa7ac53f4a9d33821afa9154973db546cd4e4d  server/businessRouter.ts
6c6862f571384bb892527c08dfb65997ab78c565a5179780606dbb662f8b0f30  drizzle/businessSalesOrderMetadataSchema.ts
73aa2545dbd46aa9f7c84281489f849f3a9547229b392b8b81c56d0182365bc7  client/src/business/platform/client/src/components/businessSalesOrderMetadata.tsx
```

**收口：后端可以按独立 metadata 服务继续编译／独立 schema 激活准备，不需要调用真实数据作本次审查证明。默认 metadata UI 的单一授权传播项修复及纯回归完成前，本报告整体保持 BLOCKED。**
