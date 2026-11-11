# 需求导航与采购页面精简（2026-11-11）

## 授权范围

仅修改 `/home/ubuntu/51-inspection/manager-github` 的 `client/` 源代码、相关合成 mock 测试与本新增 TODO，不覆盖旧 `TODO.md`。禁止 ECS、浏览器、数据库、部署、Git 提交/推送及读取密钥；父任务负责发布。不变更数据库、权限键、接口、默认排序或查询逻辑。不将 ECS 项目迁移 Manus。

## 已完成

- [x] ProcurementDemands 移除 ProcurementWorkspaceNav 三个 tabs 与引用；后台面包屑机制保持原样。
- [x] 交期与销售之间加入录入时间，列表和详情基本信息均使用接口已有 `createdAt` 与 `formatBeijingDateTime`（北京时间、现有分钟精度），不使用 updatedAt/submittedAt，无 DB 改动。
- [x] 列宽重新分配为固定业务列与弹性型号列；最小表宽 1320px 时型号剩余 260px，增宽时吸收剩余空间。操作列仍 sticky right:0，独立横向滚动容器，不缩小字号。
- [x] 详情副标题替换为 sr-only 可访问描述；没有有效需求说明（null/空串/空白）时不显示说明区；新增供应商报价仅保留报价区右上角，底部仅保留关闭。
- [x] 列表需求编号不再附加项目/通用“采购需求”第二行，真实项目名称在详情保留。
- [x] DemandQuoteList 移除采购区长段常驻说明和默认“修改报价将生成下一轮”状态提示；新一轮/重新确认操作保留 title 提醒。已撤回、旧版待重新确认、已采用及撤回确认不删；家数、轮次、总份数保持不变。
- [x] Dashboard 总菜单、旧侧栏分组模型、统一顶部工作区/客户与销售分组均移除独立客户需求入口。旧 `/workbench/customer-demands` 仍由原 route/API/组件/权限处理，导航以 `/workbench/customers` 作为 context alias，不重定向或删除旧页面。
- [x] 客户详情的录入、草稿、提交采购、采用/生成销售订单功能未变更；既有客户需求权限键未变更。
- [x] DemandQuotes 移除三个 tabs 与引用，旧公开报价 route 保留，没有新增前台外跳按钮。
- [x] 更新导航与采购页面合成测试；同步直接相关测试中既有 retired 库存/角色模板入口及旧侧栏预取的过期 expectation，不改变这些功能源代码。

## 修改文件

源代码 7 个：

| 路径（仓库相对路径） | 修改内容 |
| --- | --- |
| client/src/business/platform/client/src/pages/ProcurementDemands.tsx | 去 tabs、createdAt 列和详情字段、详情精简、列布局 |
| client/src/business/platform/client/src/pages/ProcurementDemands.css | 横向滚动与最小表宽 |
| client/src/business/platform/client/src/pages/DemandQuotes.tsx | 去三 tabs |
| client/src/business/platform/client/src/components/customerDemands/DemandQuoteList.tsx | 精简常驻说明、保留修改 title |
| client/src/components/DashboardLayout.tsx | 去总菜单独立客户需求 |
| client/src/components/admin/adminWorkbenchNavigationModel.ts | 去可见客户需求、保留旧链接 alias |
| client/src/components/admin/adminWorkspaceNavigationModel.ts | 去两层顶部导航独立客户需求 |

测试修改 10 个：`CustomerDemandWorkbench.test.ts`、`DashboardLayout.navigation.test.ts`、`AdminWorkspaceNavigation.business-dropdown.test.ts`、`AdminWorkspaceNavigation.unified-dropdown.test.ts`、`adminWorkbenchNavigationModel.test.ts`、`adminWorkspaceNavigation.render.test.ts`、`adminWorkspaceNavigationModel.test.ts`、`ui-unification-tests/procurement-demands.test.ts`、`ui-unification-tests/demand-quotes.test.ts`、`client/src/lib/adminRouteChunks.test.ts`。其余路径均沿对应原目录。

## 验证

`pnpm check` 退出码 0；`git diff --check` 通过。最终直接相关 `pnpm test` 运行 13 个 client 测试文件，329 项测试全部通过（退出码 0）。除上述修改测试，还运行 `DemandNativeSafety.test.ts`、`BusinessWorkbenchPage.contract.test.ts` 和 `businessNavigation.test.ts`。测试只读取本地源码或使用合成 mock，没有连接数据库。

验证日志保留在 `client/.demand-verified-tests-20261111.log` 与 `client/.demand-verified-check-20261111.log`（被现有 Git ignore 规则忽略，不属于提交源码）。测试中原 Dashboard Logo Ctrl-click 用例产生 jsdom 不支持完整 navigation 的非失败提示；最终测试全部通过。

依赖使用 `pnpm install --frozen-lockfile`，未使用 `--ignore-scripts`，未修改 package.json、pnpm-lock.yaml、pnpm-workspace.yaml。由于根包管理器版本的 ignored-builds 提示，使用已安装 pnpm 10.18 按现有 workspace 白名单定向 rebuild `@tailwindcss/oxide esbuild sharp`；esbuild TypeScript transform 和 pnpm 实际依赖路径的 oxide Scanner 消费者验证均成功。未运行 `approve-builds`，未放宽脚本许可。

## 剩余事项

没有已知本次代码/测试阻塞。根据授权限制未做浏览器、ECS、数据库或部署验证；小屏实际像素效果由父任务发布后按需验证。父任务负责最新基线复核、构建、提交/推送与发布。本子任务没有 Git 提交/推送或部署操作；本地 HEAD 仍为 f9703e5。
