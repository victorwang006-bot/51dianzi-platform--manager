# 默认客户首页与销售来源 callback 交接

## 已完成的源码变更

项目：`/home/ubuntu/work/51dianzi-platform--manager`。本分工仅修改如下源码：

- `client/src/lib/adminRoutes.ts`：单一 `DEFAULT_ADMIN_PATH` 从 `/workbench/channel-inventory` 改为 `/workbench/customers`。现有 normalize fail-closed 条件不变；显式合法站内 next 的 query/hash、重复 merchant 候选和原始编码均不重写。
- `client/src/components/DashboardLayout.tsx`：真实顶部 Logo href 与正常点击落点引用同一 `DEFAULT_ADMIN_PATH`，可访问标签改为客户列表，Ctrl/Meta/辅助点击保留原生行为。`navigateToItem(item, channelTab?, channelView?, orderSource?)` 追加第四可选 `SalesOrderSource`，保留前三参及原 notification/preload/merchant target 计算。先确保 `visibleMenuItems.includes(item)` 是当前父过滤的原引用，再计算原 navigationTarget；仅在原 target 非 null 且 source 提供时调用 `salesOrderSourceTarget(navigationTarget, source, '/workbench/orders')`。无 source 时原 URL 原样使用。
- `client/src/components/admin/adminWorkspaceNavigationModel.ts`：依父 21:26 补充授权，只把裸 `/workbench` 关闭入口目标改客户。旧 `/workbench/inventory`、`/workbench/publish`、`/workbench/publish/:id/edit` 仍转库存 canonical；原单一合法 merchant 候选验证和其它关闭入口不变。

`App.tsx` 与 `pages/Login.tsx` **无需改生产代码**：根路由、无 next 的登录、submit 后 auth.me 刷新已共享上述默认常量/returnPath。没有重写 auth/roles、新增 grant、role fallback 或 BFF scope。无客户权限仍由既有 `BusinessWorkbenchRouteGate` 明确显示“当前商户未获该业务模块访问范围”。

本分工没有修改 AdminWorkspaceNavigation/CSS、SalesOrderWorkspace 或其业务页标题，没有执行 Git、部署、SSH、DB、浏览器、真实业务调用。新增登录和 merchant 测试数据均为离线虚构 fixture。

## 与导航 agent 的接线契约

销售来源叶子调用 `(originalAuthorizedItem, undefined, undefined, source)`。商城原对象为父 filtered `/workbench/outbound` + `marketplace.seller`；业务原对象为父 filtered `/workbench/orders` + `crm.sales_orders`。不把 seller 原对象换成 fake `/orders` 或 CRM capability。原目标先计算/验证，canonical 转换只改变其结果；raw target query/hash 和 merchant 候选保持给 BFF 核验。

本源码比旧 callback 多一个原对象 identity guard：`if (!visibleMenuItems.includes(item)) return;`。clone fake/orders、非当前可见引用、撤权对象不会触发 builder 或通知。**没有增加 caller wrong-source 权限 gate**；导航只发两个常量来源，真实 route wrapper 继续用原 gate 拒绝非法或无权来源。

当前源码及读取的 baseline 没有名为 `getDashboardNavigationTarget` 的 helper，因此没有臆造、删除或绕过它。父 production 若存在该 helper/action eligibility，必须先原样验证 original object/目标，非 null 后才变换结果。

## production 精确补丁定位（重要）

### 1. 主 entry DEFAULT

实际资源：

`/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-demand-navigation-bb20946d992bbfe5.js`

精确 `const $f="/workbench/channel-inventory"` 是默认后台 const。改为 customers 即覆盖默认根入口/普通无 next 登录/submit 的统一 returnPath；保留 `k0/U2/L2` normalize/login URL/returnPath 逻辑。

### 2. **不要改 Dashboard 顶层 te**

baseline Dashboard 的真实片段为：

```js
const te="/workbench/channel-inventory",Ne=[/* channel tabs */];
function yo(tab,relativeToWorkbench=!1,view){
  // ...
  return `${relativeToWorkbench?"/channel-inventory":te}?ciTab=${tab}...`;
}
```

此 `te` 是**渠道库存 helper 的基路径，不是 DEFAULT_ADMIN_PATH**。为了默认客户首页替换它会让既有 `(channelItem, 'materials', 'flat')` 导航错误进入 `/workbench/customers?ciTab=materials&ciView=flat`。必须保持 channel-inventory。cap 内另一个 `te` 是 navmodel function，也不要按名字替换。若另有真正 default const，应按作用域绑定与引用证明，而不是名称。

### 3. 真实 Dashboard root Logo 与 callback

读取的 baseline 资源：

`/home/ubuntu/work/navigation-compact/baseline/assets/DashboardLayout-sales-order-consolidation-6b5a0600d9d285087c2da864f8fbe97ad92c5fd63ea81bcb52d3414822a9041d.js`

真实 root 为 `function To`。只将其 Logo 硬编码 `href:"/workbench/channel-inventory"`、正常 click 的 `s("/workbench/channel-inventory")` 改 customers，并改其可访问标签。

callback 原来位于同一 To：

```js
const S=(x,N,__inventoryView)=>{
  x.notificationModule&&(A.current=x.notificationModule,L.mutate({module:x.notificationModule}));
  const _=x.path==="/workbench/channel-inventory"
    ?yo(N,!1,__inventoryView)??x.path
    :bo(`${window.location.pathname}${window.location.search}`,x.path);
  _!==null&&s(_)
},q=x=>{x.chunk&&Ae(x.chunk)};
```

建议改 formal 为 `(x,N,__inventoryView,__orderSource)`。To 中当前可见 original menu list 是 `I`，源码 identity guard 的生产等价为 `if(!I.includes(x))return;`（置于 notification 之前）。保留原 notification/bo/channel/action eligibility；最后只在 `_!==null` 时 `s(__orderSource===undefined ? _ : sourceTarget(_,__orderSource,'/workbench/orders'))`。来源 helper可用父 bridge 的 `__NC_SO.salesOrderSourceTarget`。`q` preload 原字节不变。

### 4. 两份 closed-entry helper

`__columnsMenuClosedEntryTarget` 在 main/layout 都有一份。仅 destination 新增裸 `/workbench` -> customers 分支；后续 inventory/publish/edit 仍 channel。原候选 merchant 校验原样留在同一函数，不能以先 return customers 的方式绕过其候选校验/恢复逻辑。

## 专属测试与检查

下列检查均仅离线前端 fixture，不跑全仓测试：

| 文件 | 结果 |
|---|---:|
| `client/src/lib/adminRoutes.test.ts` | 8/8 |
| `client/src/App.landing.test.ts` | 21/21 |
| `client/src/App.workbenchPersistence.test.ts` | 2/2 |
| `client/src/components/DashboardLayout.sourceNavigation.test.ts`（新增） | 10/10 |
| `client/src/components/DashboardLayout.navigation.test.ts` | 42/42 |
| `client/src/components/DashboardLayout.messages.test.ts`（不改文件） | 3/3 |
| `client/src/App.closedEntries.test.ts` | 39/39 |
| **合计** | **125/125，无跳过** |

核心六文件命令：

```sh
pnpm exec vitest run client/src/lib/adminRoutes.test.ts client/src/App.landing.test.ts client/src/App.workbenchPersistence.test.ts client/src/components/DashboardLayout.sourceNavigation.test.ts client/src/components/DashboardLayout.navigation.test.ts client/src/components/DashboardLayout.messages.test.ts
```

完整关闭入口专属文件：`pnpm exec vitest run client/src/App.closedEntries.test.ts`。

新增覆盖默认 root/裸 workbench/无 next 登录、真实 Login submit 后统一目标、深链接 query/hash/merchant 候选、刷新原具体页面、真实客户 BFF gate 拒绝、Logo 原生辅助点击语义、seller/business 常量来源叶子集成、原目标非 null 前置、raw target query/hash 保留、原对象 clone/撤权拒绝、前三参渠道 tab/view、无 source 原 URL 不改、原 preload 和业务 scopes 不扩大。

现有消息测试与业务 menu 原对象测试保留。旧销售按钮 active 断言同步为 dropdown 的 `aria-current=location`；旧 App 关闭入口菜单用例同步为库存/销售当前 dropdown。连续挂载用例只移除了已由 App.closedEntries 专门覆盖的退休/默认重定向入口，保留所有具体仍开放业务路由的单 mount 保护。

TypeScript：`pnpm exec tsc --noEmit --incremental false --pretty false` 修改前、修改后均 **exit 0**。修改后 check 完成时全部生产源码已写入；后续只有排除在项目 tsc 之外的测试断言调整。只有现有 pnpm 配置 warning，无 TS diagnostics。

日志：

- `/home/ubuntu/work/navigation-compact/source-home-tests.log`
- `/home/ubuntu/work/navigation-compact/source-home-closed-tests.log`
- `/home/ubuntu/work/navigation-compact/source-home-typecheck-before.log`
- `/home/ubuntu/work/navigation-compact/source-home-typecheck-after.log`

专属原文件备份：`/home/ubuntu/work/navigation-compact/source-home-before/`；Dashboard 与默认常量 diff 分别为 `source-home-dashboard.diff`、`source-home-default.diff`。这些是本地源码检查辅助，未生成/上传 production 补丁。
