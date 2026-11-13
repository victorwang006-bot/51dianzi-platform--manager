# src 导航 / 销售订单交接

完成于 2026-11-13 21:34（北京时间）。项目：`/home/ubuntu/work/51dianzi-platform--manager`。

## 已完成与边界

销售订单一级已从 direct 入口改为与采购管理一致的统一 workspace dropdown，仍位于客户列表 / 库存列表 / 询价接待之后、库存管理之前。二级按商城订单 / 业务订单稳定排序，只有父 `filtered` 中相应原授权对象存在才显示。商城仅复用 `/workbench/outbound` 原对象，业务仅复用 `/workbench/orders` 原对象；原对象、权限字段、chunk、商户上下文引用不被改写或合成。

wrapper 只移除页内来源 nav 及其常量 import；source selection、Gate、useEffects、explicit URL、alias/deep links、query/hash、identity 隔离记忆全部保留，无权 / 非法来源依然 failclosed。`OutboundManagement` 和 `CrmSalesOrders` 各仅改一个 `AdminPageHeader.title` 为商城订单 / 业务订单，原 actions、描述和订单 flows 不变。

未使用 Git、部署、SSH、数据库或浏览器；未改 App.tsx、默认首页、DashboardLayout 源码或任何 nav models 业务接口。新增 fixtures 为明确虚构的导航对象，不含订单 No 或客户信息。

## 父 callback 接线：保持前三参，新增第 4 optional source

```ts
onNavigate: (
  item: T,
  channelTab?: ChannelInventoryNavigationTab,
  channelView?: ChannelInventoryNavigationView,
  salesOrderSource?: SalesOrderSource,
) => void
```

`SalesOrderSource = "mall" | "business"`。

| 操作 | 精确原 callback arguments |
| --- | --- |
| 一级销售订单 | 只展开统一 dropdown，不调用 onNavigate |
| 商城订单 leaf | `onNavigate(originalFilteredOutboundItem, undefined, undefined, "mall")` |
| 业务订单 leaf | `onNavigate(originalFilteredOrdersItem, undefined, undefined, "business")` |
| 库存列表 | `onNavigate(originalChannelItem, "materials", "flat")`，不变 |
| 其他模块 leaf / 客户列表 / 询价接待 | `onNavigate(originalItem)`，不变 |

父实际 Dashboard callback 在原 target qualification 之后处理第 4 参数：调用既有 `salesOrderSourceTarget(qualifiedTargetOrCurrentLocation, salesOrderSource, "/workbench/orders")`，明确 canonical route/source，保留原商户候选、过滤和 hash。不要把商城 item 替换成 CRM item，不要使用 synthesize item/capabilities；仍由既有 BFF/Gate 核权。本实现没有偏离约定 schema/签名。

层同步隐藏、aria-expanded 清理发生在 leaf callback 之前。打开菜单不冒充路由选中态；source active、leaf labels、当前位置来源显示均来自现有 helper。销售 leaf 显示 helper 的来源 label（不沿用原 renderItem 的“出库管理/销售订单”文本）；其他 leaf 的 renderItem 不变，所有原 renderBadge / preload / onItemIntent 原对象保留。父一级 sales preload/badge 仍使用既有 context.item 语义，默认优先原 orders 对象，否则原 outbound 对象。

## exports / 新增 runtime helper

### 导航组件 exports

`client/src/components/admin/AdminWorkspaceNavigation.tsx` 保留既有 `WorkspaceTabs`、`AdminWorkspaceTabs`、`ModuleTabs`、`AdminModuleTabs`、`AdminWorkspaceLocation`、`AdminWorkspaceNavigation`、`ADMIN_SYSTEM_RELEASE` exports；只扩展 onNavigate 第 4 optional 参数。父已确认 sourceWorkspaceTabs→原 production capsule `Ee`、Location→`Ve`，可按该实际映射做 AST transfer。

组件没有新增 top-level 来源函数，减少 production bridge 的函数映射。

### 唯一新增 runtime helper 名

模块：`client/src/lib/adminWorkspaceDropdownWidth.ts`

```ts
export function getAdminWorkspaceDropdownWidth(
  workspaceId: string,
  level: 2 | 3 = 2,
): number
```

无 imports、无副作用，可独立编译后接入父 runtime map。不能只复制组件 AST 却漏掉该独立 import。已有可直接桥接的 ESM 编译产物：

- `/home/ubuntu/work/navigation-compact/source-helper-modules/adminWorkspaceDropdownWidth.mjs`
- `/home/ubuntu/work/navigation-compact/source-helper-modules/salesOrderWorkspace.mjs`

父既有 saleslib 动态 exports 编译为 `__NC_SO` 的方式可保留；width 模块另编译桥接即可，无需为桥接重构源码。

### 既有 saleslib helper 扩展

`client/src/lib/salesOrderWorkspace.ts` 没有新增来源 helper 名。扩展既有 `getSalesOrderNavigationContext(items, location)`：原 `item/active/label` 语义不变，新增：

```ts
entries: { source: SalesOrderSource; label: string; item: T }[]
source: SalesOrderSource | null
```

entries 稳定商城 / 业务排序，item 严格为父 filtered 原引用；非销售位置、无权或非法来源 `source = null`。无权 / 非法来源 `active = false`、`label = null`，不会借另一来源授权。

saleslib 全部运行时 exports：`SALES_ORDER_SOURCES`、`getSalesOrderNavigationContext`、`isSalesOrderSource`、`readRememberedSalesOrderSource`、`rememberSalesOrderSource`、`resolveSalesOrderSource`、`salesOrderSourceStorageKey`、`salesOrderSourceTarget`。

## 宽度 / 定位 / CSS 摘取

桌面 border-box widths：销售 / 库存管理 / 采购管理 160px，运营父层 168px、子层 176px，组织权限 176px。JS 计算位置与实际 inline style 宽度都读取同一个 helper；CSS fallback 同步这些数值。行高保留 40px、水平 padding 12px。

二级菜单根据独立 parentWidth / childWidth 定位：

```ts
parentRight = parentLeft + min(parentWidth, viewportWidth - 16)
childWidth = min(getAdminWorkspaceDropdownWidth(open.id, 3), viewportWidth - 16)
side = parentRight + childWidth <= viewportWidth - 8 ? "right" : "left"
childLeft = side === "right" ? parentRight : max(8, parentLeft - childWidth)
```

因此窄运营父层右展开精确贴 `parentRight`，右侧不足时 176px 子层左展开。测试覆盖旧 212px 算法会误判的右侧可容场景和贴边左展开。

全部新增/变更 compact CSS 位于 `AdminWorkspaceNavigation.css` 的 `Unified dropdown selections override` 注释之后；父按这个 scoped 尾块摘取/追加即可，不需要摘取其前方原 header / brand / 业务菜单 CSS。手机统一 workspace panel 规则为 `width: 360px !important`，抵消 desktop inline style；原 767px 断点、max-width、右侧抽屉、返回、遮罩、滚动行为保持。原 legacy business drawer CSS 未修改。

hover / keyboard / 180ms timer / items+location permission snapshots / 焦点 / 单一开放层 / 同步关闭 / 消息中心 badge 的原交互保留。

## 修改文件

生产源码：

- `client/src/components/admin/AdminWorkspaceNavigation.tsx`
- `client/src/components/admin/AdminWorkspaceNavigation.css`
- `client/src/business/SalesOrderWorkspace.tsx`
- `client/src/business/platform/client/src/pages/OutboundManagement.tsx`（仅 PageHeader title）
- `client/src/business/platform/client/src/pages/CrmSalesOrders.tsx`（仅 PageHeader title）
- `client/src/lib/salesOrderWorkspace.ts`
- `client/src/lib/adminWorkspaceDropdownWidth.ts`（新增）

新增 tests：`AdminWorkspaceNavigation.sales-dropdown.test.ts`、`AdminWorkspaceNavigation.compact-width.test.ts`、`adminWorkspaceDropdownWidth.test.ts`。更新受影响已有 tests：`AdminWorkspaceNavigation.primary-entries.test.ts`、`AdminWorkspaceNavigation.business-dropdown.test.ts`、`adminWorkspaceNavigation.render.test.ts`、`SalesOrderWorkspace.render.test.ts`、`salesOrderWorkspace.test.ts`、`BusinessOutboundNativeStyles.test.ts`。primary-entries 不再越界断言另 agent 负责的 DEFAULT 首页。

## 源码测试结果

### 最终分工回归：12 文件 / 226 tests 全通过

```bash
pnpm exec vitest run \
  client/src/components/admin/AdminWorkspaceNavigation.primary-entries.test.ts \
  client/src/components/admin/AdminWorkspaceNavigation.unified-dropdown.test.ts \
  client/src/components/admin/AdminWorkspaceNavigation.sales-dropdown.test.ts \
  client/src/components/admin/AdminWorkspaceNavigation.compact-width.test.ts \
  client/src/components/admin/AdminWorkspaceNavigation.business-dropdown.test.ts \
  client/src/components/admin/adminWorkspaceNavigation.render.test.ts \
  client/src/components/admin/AdminWorkspaceNavigation.location-layout.source.test.ts \
  client/src/business/SalesOrderWorkspace.render.test.ts \
  client/src/lib/salesOrderWorkspace.test.ts \
  client/src/lib/adminWorkspaceDropdownWidth.test.ts \
  client/src/business/BusinessOutboundNativeStyles.test.ts \
  client/src/business/platform/client/src/pages/CrmSalesOrders.customer.test.ts
```

结果：`Test Files 12 passed (12)`，`Tests 226 passed (226)`。日志：`/home/ubuntu/work/navigation-compact/source-tests-final.log`。

另单独执行销售相关只读位置断言：

```bash
pnpm exec vitest run client/src/components/admin/AdminWorkspaceNavigation.location.test.ts \
  -t 'workbench/(sales-orders|outbound)'
```

结果：2 passed / 52 skipped。日志：`/home/ubuntu/work/navigation-compact/source-location-sales-tests.log`。

### 定向 TypeScript 与独立编译

7 个受影响文件（导航、wrapper、saleslib、width helper 与三个新增 tests）逐文件 syntactic/semantic diagnostics：0。没有做全仓广测或改变 TS 配置。脚本：`/home/ubuntu/work/navigation-compact/source-typecheck.mjs`；日志：`/home/ubuntu/work/navigation-compact/source-typecheck.log`。

两个纯 helper ESM esbuild 编译成功；对编译输出运行原 item 引用、failclosed source、运营 parent168 / child176 runtime smoke：PASS。

### 并发默认首页旧断言，交首页 agent

21:31 曾把完整 `AdminWorkspaceNavigation.location.test.ts` 也纳入一次定向检查，出现 3 条 `/workbench` 缺省位置仍期待库存列表的旧断言失败；实际位置已被首页 agent 改为客户列表。具体约在 lines69/100，包含 `/workbench`、`/workbench/?ciTab=materials&ciView=flat`。该文件未由本分工修改；不能把这些旧渠道/default 断言当成销售改动回归。完整初查日志：`/home/ubuntu/work/navigation-compact/source-tests.log`。请首页 agent 同步其负责的默认位置断言。其余本分工测试已在最终 run 中全部通过。
