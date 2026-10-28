# 真实后台平台导航合并

2026-10-28 用户确认直接修改 admin.51dianzi.com 后，于北京时间11:58:56完成切换。左侧“用户与商户 / 交易与服务 / 数据与运营”合并为一个可展开、收起的“平台管理”。七个子项依次为商户管理、用户管理、订单管理、消息中心、评价管理、物料数据库、运营数据；系统管理及后台用户管理、异常日志、个人信息保持独立。

模型只变更分组定义。原菜单对象、地址、权限过滤、通知/已读操作、预加载、页面状态保持；现有CSS、整体图标栏、账号隔离折叠存储继续使用。旧三组存储键兼容读取，新平台组默认展开，旧系统组状态保留。

## 实际上线

私有OPS：`/opt/ops/20261028-admin-platform-navigation-merge-v1`，固定清单SHA-256为`0d108e9865f2e369dd2b84f35805902fa10d93fe1d06ba6c5f119d2bc8e1d1e1`。只新增以下两个JS：

- `AdminWorkbenchNavigation-platform-2d8efc8b9299b4eb.js`，完整SHA-256 `2d8efc8b9299b4ebc652105c61997a39eedda8d9d47b2332f14ba87f2445d3d4`。
- `DashboardLayout-platform-navigation-7f6d6fc75a8bf675.js`，完整SHA-256 `7f6d6fc75a8bf67581d0c90d9ff688204f70ae0a788521e92e91f38679b4f687`。

最新后台HTML仅替换布局importmap的一处literal；`4cb496f0a168d25c1746ca679cdbe0db5154069f5da65da660f8bc31e7696e14` → `60161797a246a0b5b84d1eeb1ea16bd526709816aef5a70ccd8a8522b9c5304b`。实际布局仅替换一次导航模块import依赖，剩余51,357字节原样保留。现有CSS `03bc84b6de5c6901bab300bd20c0682afb1e12e2d6c1c21961d2429c6214a94a` 完全不变，不重新编译或发布主包。

`applied.json`确认46,983项原文件除批准HTML外内容/集合不变；所有原PM2进程PID、启动时间、重启计数、根及软链接、worker许可保持。无API/数据库/库存页面/主站/Nginx变更，没有服务reload或重启，没有业务写测。已退役智捷模块仍inactive/disabled、3019无监听且页面/API为404。

## 验证和维护

全项目TypeScript检查、10项导航模型及预加载测试、7项既有后台权限测试、18项实际编译导航隔离Chromium检查及10项发布安全回归通过。只读审查发现的悬空软链接覆盖风险已修复，capture/apply都拒绝已有文件或链接；新增真实悬空symlink测试通过并只读复核闭合。

交互验证使用实际最终导航模块及现有CSS，React桥和菜单回调为隔离测试夹具，不冒充真实管理员登录或生产业务写测。公网只读结果与完整资源SHA见`evidence/public-verification.json`；服务器原文件/服务保护及关闭窗口见`evidence/applied.json`、`evidence/closed.json`。

构建器基于已上线工作台布局固定SHA，产物与清单见`artifacts/`。原私有生产基线和凭据不进入仓库。历史发布脚本用于审计，禁止重复apply；后续任何导航变更必须重新冻结现场。回退只在共享锁内读取最新HTML精确恢复本布局键，保留immutable新资源，不恢复旧整页覆盖其他任务。
