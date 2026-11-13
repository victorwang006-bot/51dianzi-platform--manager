# metadata 写授权传播复核收口

**结论：PASS——旧报告唯一 BLOCKED（默认 metadata UI 写授权传播）已关闭。**

复核时间：2026-11-13，22:58–22:59（Asia/Shanghai）。项目根目录：`/home/ubuntu/work/51dianzi-platform--manager`。本结论仅针对 `/home/ubuntu/work/sales-unified/metadata-independent-review.md` 第 15–34 行及其收口所述单一传播缺口，不是重新全面审查，也不替代生产验收。

## 只读 trace 与关闭理由

以下源码路径均相对上述项目根目录，行号为本次读取版本。

1. **精确当前商户授权交集：PASS。** `client/src/business/platform/client/src/lib/businessSalesOrderMetadataAccess.ts:9–20` 只有在 `verified === true`、`pageWritable === true`、当前 merchantId 为正安全整数、`access.merchantId === merchantId`、`access.canWrite === true`，且 readCapabilities **与** writeCapabilities 均包含精确 `crm.sales_orders` 时返回 true。独立页可写、其他模块写能力、另一个商户的能力均不能单独赋予 metadata 写权限。

2. **默认页面至 Provider 的真实接线：PASS。** `client/src/business/platform/client/src/pages/CrmSalesOrders.tsx:27–28,255–258` 使用 native `useBusinessWorkbenchAccess()` 和新 helper；`:429–430` 将当前 verified/read-ready 状态、`business.merchantId`、`session.isWritable()` 与 `metadataAccess` 交给 helper，结果为 `metadataCanWrite`。`:953–962` 的 boundary context 明确使用 `canWrite: metadataCanWrite`，不再直接使用页级 session writable。`client/src/business/platform/client/src/components/businessSalesOrderRows.tsx:36–45` 将 `{ ...context, children }` 原样交给 `wrapList`；页面 `:433–434` 的默认 `wrapList` 再以 `{...context}` 原样传给 `BusinessSalesOrderMetadataProvider`。该默认链条没有后续覆盖回原页级写权限；`rowSlots` 是既有显式扩展点，本结论仅覆盖默认 wrapList。

3. **嵌入只读、归档及身份限制保留：PASS。** 页面 `:278–294` 仍要求嵌入 `canRead === true`、`canWrite === true`、非 `readOnly`、非客户 `archivedAt`，再与 verified 交给 `useSalesOrderSession`；包装 session 还检查当前 identity。`client/src/business/platform/client/src/hooks/useSalesOrderSession.ts:24–40` 的 writable ref 随渲染更新，并在卸载时关闭。helper 取的正是上述 session 结果，新增 capability 不能覆盖嵌入只读或归档限制。页面 `:207–215` 还把嵌入读写、只读、归档状态纳入 keyed customer session。

4. **消费及撤销传播：PASS。** `client/src/business/platform/client/src/components/businessSalesOrderMetadata.tsx:156–175` 再核验 BusinessScope proof 与当前 merchant，并把传入 `props.canWrite` 纳入 MetadataSession key；`:187–203` 的写 guard 使用当下 canWrite，`:310–313` 暴露 `ready && canWrite`。因此能力交集转 false 会触发原有 keyed session 重建，旧对话框不继续作为可写会话存在；`:290–301` 清理旧请求 controllers。该机制仍不宣称客户端取消等于服务端事务回滚。

`client/src/business/BusinessWorkbenchAccessGate.tsx:23–27,60–68,78–83` 确认使用现有 capability 归一与 provider hook：缺失列表归为空、商户不可写时 writeCapabilities 归空，没有 provider 则显式拒绝而非默认授权。

## 纯测试证据及边界

已只读核验 `client/src/business/platform/client/src/lib/businessSalesOrderMetadataAccess.test.ts:7–33` 六例及 `/home/ubuntu/work/sales-unified/metadata-write-access-tests.log:3–10`：**1 文件、6 tests PASS**。覆盖独立页无模块写权限、商户只读、其他模块写权限、跨商户、未核验／pageWritable false、精确授权正例。本次未重新运行测试。该 helper 的 pageWritable false 用例不是实际归档组件测试；归档条件至 session 的真实传播由上述源码 trace 确认。

父任务正在增加的 sourceCustomer Propagation 测试不计作本次已通过证据；本次没有执行或推定其结果。

本次未修改旧 BLOCKED 报告或项目源码，未使用网络、Git、SSH、DB、浏览器，未执行 DDL、activation 或真实 API。原财务 handlers 不在本次扩展审查范围；旧报告 backend/shared/schema 等六点 PASS 按任务要求沿用，不重新读取大套或重跑其测试。

**最终收口：该唯一 UI 写授权传播缺口不再阻塞。生产 UTC 时间处理、DDL 与 activation 仍由父任务负责；这不是浏览器真实字段、生产授权响应、真实 API／DB 或生产部署验收。旧报告并列保留，以本 closure 说明该点的新版本结论。**
