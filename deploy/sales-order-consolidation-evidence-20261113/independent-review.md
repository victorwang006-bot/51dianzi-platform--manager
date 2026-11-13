# 销售订单整合独立只读审查

审查时间：2026-11-13 20:38（UTC+8）左右。审查目录：`/home/ubuntu/work/51dianzi-platform--manager`。依据：`TODO-sales-order-consolidation-20261113.md` 与 `/home/ubuntu/work/order-consolidation/source-handoff.md`。

## 结论：PASS（源码与实际生产候选静态结构审查）

本次范围内未发现可确证的阻塞项。已审查新源码、实际生产构建器及 patch core，并直接检查 `/home/ubuntu/work/orders-baseline` 的三份生产基线资源与 `/home/ubuntu/work/orders-candidate` 的实际候选，而非仅信任交接报告或构建 proof 的布尔标记。

本结论不替代主 agent 正在执行的隔离 JSDOM 实际候选路由、页签与门禁交互验证，不代表已发布或生产浏览器验收通过。不重复全仓测试，不启动浏览器、不访问业务服务、无 SSH、无 Git 操作、无业务 mutation；唯一主动写入为本审查报告。

## 核验结果

### 1. source/runtime 桥接正确，没有新建授权来源

`SalesOrderWorkspace.tsx:16–59` 从原 `useBusinessScope` 与 `useBusinessWorkbenchAccess` 读取当前核验身份和原 readCapabilities；商城/业务分别使用 `marketplace.seller` 与 `crm.sales_orders` Gate，页面仍为原 `OutboundManagement readOnly={false}` 与 `CrmSalesOrders`。

实际构建器 `deploy/build-sales-order-consolidation-20261113.cjs:7,28–34` 完整编译 wrapper 模块及私有 `OutboundRedirect`、库中的 `locationParts`，没有只抽取导出函数体。候选 `wrapper-factory.js` 中存在两个实际导出及其私有依赖。

两份生产包的 `__d51_so_get` 都桥接模块作用域的原 `React=c`、`jsx=e`、`useLocation=on`、`useSearch=ec`、`scope=Qa`、`access=Ty`、`gate=Uy`、`CRM=op`、`商城=KI`。已核对标识符的实际作用域：包内虽有其他胶囊的同名 `Qa`，但注入点位于模块作用域，绑定的是原 BusinessScope Hook，而非其他内部同名函数。原 `KI()` 实际返回 `uI` 且 `readOnly: false`。

原询价胶囊内部 `Ss=__live.useLocation`、`As=__live.BusinessWorkbenchRouteGate`、`Os=__live.useBusinessScope`、`lr=__live.CrmSalesOrders` 也接回同一套原实现。原 `tn/VerifiedBusinessWorkbench` 保持 TRPC Provider、QueryClient、BusinessScope Provider、Access Provider、原 Router 包裹顺序及 `x-business-merchant-id`、credentials、取消机制，不把新容器移到核验边界外。

第二份生产包的 `op(props)` 仍委托 `__customer_workbench_manager_v1.CrmSalesOrders`；该导出对应 `GP()`，再渲染实际 `sN` CRM 页面。其 wouter、Scope、TRPC 桥接同样为原 `on/ec/Qa/H`，没有漏接实际订单组件。

### 2. 内部 Routes early branch 位于旧 CRM-only requirement 之前

源码 `BusinessWorkbenchPage.tsx:482–489` 与两份候选实际询价胶囊的内部 `xr` 一致：读取当前 location 后，先对精确 `/orders`、`/sales-orders` 返回新容器，对 `/outbound` 返回 seller Gate 下的兼容入口，再调用旧 `Pi(r)` requirement。

因此 seller-only `/orders` 不会先被旧 CRM Gate 拒绝。early branch 没有改动外层后台平台 `/orders`，也没有改变非销售 Switch、真正入库/仓库/库存接口。原 Provider 树及询价入口仍保留。

### 3. 来源解析、身份记忆与撤权保持 fail closed

`lib/salesOrderWorkspace.ts:29–50` 对唯一合法显式 `orderSource=mall|business` 按当前来源能力判定；显式无权不借另一来源，空值、未知值、重复参数返回无来源且拒绝。最近来源仅为 UI 偏好，缺省只在当前允许来源中选择。

记忆键包含原 Scope 提供的 staff/admin/enterprise/merchant/binding 全维度 identity；库不创造独立身份或企业授权。原 Gate 在每次渲染仍检查能力，权限撤销不能靠旧记忆或旧来源页面绕过。

旧 `/outbound` 在执行跳转 effect 前受 `marketplace.seller` Gate 保护。URL helper 只替换来源意图，保留其他查询字段的原编码/顺序、重复 merchantId 候选、订单详情/筛选字段及 hash；不自动选一个重复商户候选。已对候选实际编译 helper 做少量纯函数断言，验证旧链接保留及两来源无借权；未执行订单组件或业务请求。

### 4. 原导航对象、回调和权限不扩大

`AdminWorkspaceNavigation.tsx:121–147,177–205,494–506` 仅从父已过滤的 objects 选取销售一级对象。有原 `/workbench/orders` 时复用该对象，否则 seller-only 复用原 `/workbench/outbound` 对象；没有合成 CRM menu item，没有改对象 path/capability。

一级点击与 preload 分别继续调用 `onNavigate(salesItem)` 与 `(onPreload ?? onItemIntent)?.(salesItem)`；过滤库存里的 outbound 重复项仍保留其他原授权项。高亮与面包屑只对 `/workbench/orders|sales-orders|outbound` 生效，显式未授权来源不显示假授权面包屑。

实际布局 AST transfer 的 `Ee/WorkspaceTabs` 与 `Ve/AdminWorkspaceLocation` 仍在原胶囊中，依赖原 `te/pe/me/ge` 和原回调。独立比较旧、新 `Ee` 的全部九个具名内部导航函数（包括 closeWorkspace、openWorkspaceMenu、openModuleGroup、renderLeaf、键盘处理）：规范化后全部一致。询价 badge 在生产 transfer 中继续交给原 `renderBadge(receptionItem)` owner，没有新增请求组件；运营提醒分组原闭包保留。布局胶囊以外的父过滤、导航目标/商户逻辑及 preload 未被 patch。

### 5. CRM 三处链接/消费不会被商城缺省抢占

源码三处已覆盖：`CustomerDemands.tsx:120,124` 两个 demandNo/keyword 入口；`customerDemandWorkbench.ts:17` 独立路径 helper；`CrmSalesOrders.tsx:386–414` 参数消费 effect。新链接明确 `orderSource=business`，消费后也明确保留 business 与 hash；demandNo/keyword 对应原流程不交换，嵌入精确 demand ID 回调不被本 patch 重写。

实际生产补丁与上述运行位置相符：第一份包有四个 CRM URL 表达式（原 `op` 的两处消费、原 `uw` 的两处创建/搜索入口）；第二份包有五个（原 `uw` 两处、`E_` 独立 helper、实际 `sN` 两处消费）。独立读取了 AST 所在函数，而不是仅按字符串计数。两份候选都只替换这些 URL 表达式；订单创建、收款、发货、取消的函数体未被整段替换。

旧 `/sales-orders`，以及旧 `/orders?demandNo=…`、`/orders?keyword=…` 无显式来源时，解析器均先认定 business，不受 mall 默认或 mall 记忆影响；没有 CRM grant 时拒绝，不回退商城。容器缺省规范化 effect 比较浏览器最新 search，原子页先消费参数后不会写回过期 query。该 effect 顺序的实际交互确认仍由主 agent 的隔离 JSDOM 验证负责。

### 6. 实际候选是精确增量，不是完整重建包

独立逐条核对 patch 的 baseline slice、candidate slice，并正向重新拼接及反向恢复：布局三处、工作台第一份六处、第二份七处均与实际文件完全相等。不是仅接受 `exactInverse: true` 报告字段；未经 patch 的全部字节确实不变。

另独立对两份包的原 `Ty/Ly/Uy/KI/uI/__d51_rx_chat_helpers_get` 做函数文本比较，全部保持字节一致。原询价胶囊 `ps/fr/tn/_r` 不在修改范围，结合精确 inverse 已确认保留。HTML 将候选 importmap 还原成旧内容并移除唯一新增 CSS link 后，与 baseline HTML 完全相等。

patch core 对旧 imports/scopes 保留、对应 scope 克隆、所有直接 import specifier 不变及实际解析目标作断言；本次检查其实现和实际依赖 proof，未发现资源重定位结构漏洞。wrapper 不引入第二套 React、wouter、Scope、Gate 或订单接口。

候选记录中的源码 hashes 与当前 wrapper、helper、navigation 源码 hashes 一致。`files.json` 所列五个文件的 SHA-256 已独立复算匹配。

## 本次审查锁定的候选

| 文件 | SHA-256 |
|---|---|
| `index.html` | `df539e3e8b1c70cea82e26c9214c1b171dad66257fb836b481912db546a26e5d` |
| `DashboardLayout-sales-order-consolidation-*.js` | `6b5a0600d9d285087c2da864f8fbe97ad92c5fd63ea81bcb52d3414822a9041d` |
| `BusinessWorkbenchPage-sales-order-consolidation-0-*.js` | `06fa3cc974fb8c85a5b0b224ef7e5ee19de12b524b64dd25b30ffbb3f89d1c3e` |
| `BusinessWorkbenchPage-sales-order-consolidation-1-*.js` | `f02389cc83655743c8f5db8b039280765922854fef5e30860d7f6a93784f024c` |
| `sales-order-consolidation-*.css` | `025e4489de338468e2eca53ce7eebf15edcb1c4b9b7afd3a36c8a8cf137c32e7` |

如之后重新构建产生不同 hash，本报告不自动覆盖新候选。现有 TypeScript/Vitest 验证仅参考交接，不在本报告冒称重新执行；未确认的实验订单删除不属于本次实现/审查，仍需独立准确清单与用户删除授权。
