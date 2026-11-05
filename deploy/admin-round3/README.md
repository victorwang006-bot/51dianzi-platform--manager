# 渠道库存确认搜索、按需选择与工厂库存发布

版本 `20261105-channel-factory-publish-v3`，生产基线为已完成的 `20261105-admin-compact-priority-v2`。本目录复用上一轮成功发布工具；业务代码、正式冻结八项检查与真实生产阶段分别记录，工具测试不代表已经上线。

## 业务与迁移

后台材料“确定”应用草稿搜索；默认隐藏复选框，“选择”后进入原批量操作。编辑移到更多，原位置发布。发布必须满足真实官方 read/publish、当前商户库存写范围及本材料负责人/合法组长边界，不能靠 edit/read/write推测。首点只展示型号、品牌、数量和有效正价格，确认后提交原UUID/CAS与预期身份。发布不修改原材料版本，成功回执严格等于expectedRevision；本地回执不能覆盖新版本或新服务器结果。

主站给原渠道材料增加安全公开投影，不复制库存、不假映射官方库存身份，不修改官方publicationApproved审核规则。前台沿用原/factory-inventory；无价整个价格区域不渲染，“渠道经理”仅提示“敬请上线”。不代发280条存量、不真实测试发布库存、不创建会话。

DDL只CREATE主站两张空sidecar：`channel_material_publications`、`channel_material_publication_requests`。SQL为`drizzle/migrations/20261105_channel_material_publications.sql`，runner为`scripts/apply-channel-factory-publications.mjs`，仅从已核实front PM2内存的DATABASE_URL透传，参数`--apply`，输出JSON `{ok,tables,sqlSha256,businessDataWrites:false,existingTablesChanged:false}`。不加载.env/ecosystem，不运行员工归档迁移；旧动态配置runner未使用。

独立临时MariaDB真实19项事务测试及新ENV-only首次CREATE/重放/check均通过，其他合成业务表dump前后字节相同，数据库已停止、临时目录删除。证据位于`/home/ubuntu/backend-optimization/round3/env-migration-fixture/`。生产迁移仍须独立schema阶段，不把fixture当生产证明。

## 冻结与实际检查

在所有源码收口后执行：

```bash
node deploy/admin-round3/build.mjs --freeze --agents-complete
node deploy/admin-round3/build.mjs --build --freeze-record /absolute/run/freeze.json
python3 deploy/admin-round3/publish.py --package /absolute/run/package --verify-local
```

两端精确源码/typed镜像、依赖、Git版本、工具和最新线上基线摘要绑定。除FactoryChannelPage.tsx/CSS/测试外，全部已有前台client源文件按上一轮真实冻结字节保护。快照front/admin为同级，跨仓测试和@别名依据importer正确解析。构建前后源码、HEAD、依赖或工具漂移即停止。

八项真实检查为两端tsc、两端相关Vitest、两端full Vite、两端API esbuild。ENV净化、空envDir、网络阻断；直接DB测试明确skipped并用独立fixture证明，不伪造passed。新工作台publish白名单、BFFscope、发布确认、实际路由及原客户/员工/导航/记忆/共享回归必须被纳入。

## 静态与生产安全

双独立不可变namespace。两个HTML只替换确切主module/style/preload范围，完整逆向还原基线，保留front module-load-fallback及非目标HTML。原logo/favicon/app manifest、root public、旧assets不覆盖或删除；built root public只作为证据，不一致先写差异并停止。

只必要主站IDs190/193/194/200和后台191/192重载，保持原20261031 cwd、ENV、worker/非目标进程/NGINX及原执行文件。三opaqueecosystem不加载、不修改；root PM2 resurrect真实dump持久化。只六API顶层动态axm_monitor遥测排除，ENV/非目标同名字段仍严格保护。

生产在同一个全局锁和共同协调窗口下，prepare → 本轮schema-only → front API → admin API → admin根HTML → front工厂页根HTML最后。只有manifest绑定的source/tests/API/DDL及授权React fixture审核；不冒称生产登录浏览器验收。中断保存真实partial状态，schema/API不回旧，不盲目重播；完全成功后才释放窗口。

所有静态资产、两个根HTML做本机及公网200/SHA全量验证，bounded concurrency≤8，不抽样；最终verified证明启动持久化、非目标保护与阶段static_active。实际来源提交、构建结果和生产完成时间以独立发布回执为准。

离线工具测试：`node --test deploy/admin-round3/safety.test.mjs`、`PYTHONDONTWRITEBYTECODE=1 python3 deploy/admin-round3/test_publish.py`。首次准备38 Node/21 Python通过；改工具后最终重跑日志另存，不复用旧通过数作新证明。
