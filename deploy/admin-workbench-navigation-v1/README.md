# 后台工作台式导航 · 已上线

2026-10-28 按用户批准方案，仅更新 admin.51dianzi.com 左侧导航。四组为“用户与商户、交易与服务、数据与运营、系统管理”，原10项菜单的名称、地址、权限、通知/已读操作、预加载和页面记忆保持。智捷业务未恢复。

新导航使用白底、深蓝分组标题、右侧折叠箭头、缩进文字菜单与浅蓝选中态。展开状态按后台账号隔离保存，页面/详情导航会自动打开所属组；整体图标栏模式继续提供原图标及提示。默认宽220px，但已有用户保存的拖拽宽度不覆盖。分组14px、子菜单13px、行高40px；顶部Logo和底部账号沿用原实现。

## 实际发布

部署目录 `/opt/ops/20261028-admin-workbench-navigation-v1`。实际静态根为 `/opt/releases/20261018-multi-enterprise-v1/admin/dist/public`，注意它与PM2运行代码的release不同，不能只保护PM2的dist。`operations.py`显式同时保护两者。

只增加三份内容寻址文件：

| 资源 | 完整 SHA-256 |
| --- | --- |
| AdminWorkbenchNavigation-5a444a56f1ed1e9c.js | 5a444a56f1ed1e9c6faf0b4654aec4d2b3cb205b66c537ca030a7ee0a34d1180 |
| AdminWorkbenchNavigation-03bc84b6de5c6901.css | 03bc84b6de5c6901bab300bd20c0682afb1e12e2d6c1c21961d2429c6214a94a |
| DashboardLayout-workbench-navigation-092c0021d3342d8e.js | 092c0021d3342d8eeccf030115a8932ff1d1e9f43e7093346821179f90970ce0 |

HTML由 `34cfd20e664cce248fcd8a68467ade6cfb28c2348d63b23506a2ed6d88e1bb0f` 更新为 `4cb496f0a168d25c1746ca679cdbe0db5154069f5da65da660f8bc31e7696e14`。只替换原布局importmap单键，并追加一条带 `data-admin-workbench-navigation="v1"` 的CSS引用；其余HTML字节、全部其他映射和审核/通知/商户页更新均保留。

原菜单逐项渲染回调全文保持，其SHA-256为 `20f3593c49636bf6bdc8f7376170c3e6278deb4ab55d373943930f694bac81ed`，原权限过滤表达式仍为 `x=>me(D,x.permission,_)`。布局其余内容仅在默认宽度240→220处改动。未改前台库存、清空修复、API、数据库、Nginx、服务和worker许可；没有重启/重载任何进程。

## 复现与门禁

已有授权的同一仓库安装环境下执行 `node deploy/admin-workbench-navigation-v1/build.mjs` 构建固定三资产；输入必须为本轮实际baseline，未知新布局或HTML会拒绝。`build-qa.mjs` 与 `run-qa.py` 运行编译运行时的隔离交互验证。`prepare-payload.py`只把清单与指定三资产和必要脚本/证据装配为root-only包，禁止额外资产。生产capture/apply/verify必须显式传入同一 `--manifest-sha256 45f730619378cb1168f276c00a66dc8f3250ebc1a3d4d72f1c9ba89657be496d`，并与预检回执匹配；不能预检后换清单。

所有生产操作使用非阻塞 `/var/lock/dianzi51-public-deploy.lock`。预检和应用对实时全文件、文件集合、根/祖先/内部软链、全部业务进程PID/启动时间/重启计数和原worker许可做保护。成功回执 `applied.json` 验证46,980项原文件（仅后台HTML获准变化）、全部进程及原许可保持，0数据库写入、0重载。

## 验证与边界

全项目TypeScript检查通过；8项单元/路由预加载回归、14项最终编译导航的隔离Chromium布局与交互验证、7项发布保护回归通过。包含分组真实收起、账号隔离与记忆、详情路由自动展开、空权限组隐藏、低高度菜单不压缩不重叠、最后菜单可滚动点击、整体图标栏和移动宽度。

隔离浏览器使用实际最终导航运行时及现网CSS，React桥和菜单回调为测试替身，不冒充真实账号登录验收。线上浏览器确认原登录页可用、新布局与导航模块可实际导入且限定样式已加载；公网HTML和三个资源完整摘要一致。无伪造登录、无生产业务写测试。智捷旧路径404、专用服务inactive/disabled及3019无监听保持。

若未来需要回退，只在共享锁内读取最新HTML，精确恢复本布局键及移除本CSS标签；保留内容寻址资产供已打开页面使用，绝不恢复旧整页覆盖后续改动。未知指针时停止，不能强制覆盖。历史部署文件只作审计，不应运行旧智捷apply。
