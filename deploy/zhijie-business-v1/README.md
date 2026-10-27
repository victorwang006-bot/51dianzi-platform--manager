# 智捷业务第一阶段（真实 Admin）

> 2026-10-28：用户已明确批准撤下本模块，现由 `deploy/admin-remove-zhijie-v1/` 进行定向撤回。本文及原发布脚本仅保留为历史审计资料，不再是当前部署入口，禁止直接重跑旧 apply 恢复模块。业务数据、专用授权和审计表保留，不删除。

本功能位于真实后台仓库，不是独立 Demo。新增业务菜单、统一前台字体字号、真实管理员登录下的成员映射及三级岗位模块授权。业务数据尚未接入：records 返回 connected:false 和 total:null，禁止业务写入。没有业务总览、部门表、角色模拟切换或本地虚构客户。

## 构建

先获取实际线上 index.html、启动主模块、当前 importmap 的 DashboardLayout 分片并存入 baseline；本次源站静态根 /opt/releases/20261018-multi-enterprise-v1/admin/dist/public。不能以仓库旧HTML替代。已有导航、页面记忆、消息和商户补丁必须保留。

`node deploy/zhijie-business-v1/build.mjs` 构建新增页面/导航JS和CSS，AST精准插入现有主包的受保护路由和现有布局侧栏，生成 manifest，保持旧 main 的 React/tRPC/Auth/Wouter 单例。所有未修改的 importmap 条目原样保留。基线未进Git，但构建输入哈希在manifest及发布证据中，服务器ops保存原件，后续基线需重新冻结而不是复用旧快照。

`pnpm exec esbuild server/zhijie/standalone.ts --bundle --platform=node --packages=external --format=esm --outfile=deploy/zhijie-business-v1/dist/service.mjs` 构建独立本机边车。运行复用当前后台的依赖与权威runtime.env，PORT固定3019，HOST固定127.0.0.1。不重启或替换原后台/前台进程。不使用独立Demo server。

## 发布入口

本次使用 remote-operations.py capture→stage→apply→verify，而非旧 deploy/deploy-admin.sh 全量覆盖。capture只读冻结全部静态、Nginx和原PM2进程；stage核验输入与实时生产指纹。apply只新增2空授权/审计表、安装dianzi51-zhijie-access服务、增加 /api/zhijie/ 命名空间转发、追加哈希资产并原子切换HTML。原表/客户/订单/附件/前台入口不变。

scripts/apply-zhijie-access-schema.mjs只允许dianzi51_admin后台库，锁保护、结构索引门禁及幂等执行；原企业组织只读取enterpriseId=1的固定表，来源无效或不可用关闭权限。任何授权配置需真实超级管理员登录并选择精确来源成员ID；不自动创建人员、授予现有普通账号权限，也不允许自己给自己授权。

发布失败恢复原HTML与Nginx并关闭新服务，不删授权表、审计或任何业务事实。已上线后的显式回滚需先比较当前HTML和Nginx仍是本版本，不能从旧基线覆盖后续并发改动。新服务资料保存在/opt/ops/20261027-zhijie-business-v1，源站原件、manifest、schema-verification和applied证据留存。

## 当前阶段与后续

本轮只建立功能入口与真实权限配置基础。原工作台业务尚未读取、迁移或删除，采购/销售状态机未改；未接入状态不是0条数据。下一阶段对全部智捷业务盘点、配置账号映射与必要操作授权、隔离验证原业务服务适配、只读对账、灰度接入后切入口，不同时维护两份可写客户库。敏感模板、章、批量导出不自动随岗位获得。

上线匿名API拒绝、资产哈希验证与单元策略通过不能替代真实管理员登录验收；生产不得造测试客户、订单、员工或伪造登录Token。实际授权配置及第一条业务数据接入须经真实身份核验。

## 发布兼容修复
首次发布在空授权表结构校验阶段被 MySQL prepared SHOW TABLE STATUS LIKE ? 拒绝，未切换HTML、未启动服务。已改为information_schema参数化查询，回退原HTML/Nginx保留，两个空授权表留存而不删除。重新发布必须先确认实时保护基线和新服务尚未启动，再保留失败暂存目录并重新执行幂等校验。

## 增量主包加载修复
正式入口加载验证发现React lazy初始化插入点过早；已立即回退旧HTML。构建现将lazy常量置于实际路由声明之前（React模块初始化之后），并将全部原动态import相对路径规范到原命名空间，不能仅处理静态import。后续切换前先进行匿名隔离加载验证；不清除业务记录或新授权表。

## 2026-10-27 ECS直接验收

用户明确要求利用已有ECS访问权限继续，不再以导出浏览器会话为服务器开发部署的前置条件。readonly-acceptance.ts直接只读调用实际授权存储和原智捷组织；岗位候选仅在内存中用于校验，不创建会话、账号或授权。真实企业9成员、1有效团队，后台9有效账号，当前智捷业务授权仍0条。12项服务器检查通过；真实浏览器登录后交互不属于此方法，不能伪称通过。

实际MySQL 8/mysql2的二进制LIMIT参数类型被拒绝，listAudits已改用安全query参数格式、保留1至100分页范围，并补充3项隔离回归。apply-audit-fix.py用新的当前保护快照仅替换智捷服务制品并重启该服务一次，17个当前相关文件及全部原PM2进程不变，失败时只回退自身服务。

原前台web/dist/index.js在第一阶段发布后已被其他更新改变，旧248项快照的全站verify不再通过属于并发变更信号，不能据此回退他人更新。当前前台更新被完整保留；最新智捷服务制品以audit-fix-applied.json为准，而非旧payload/service.mjs哈希。服务器业务表和授权审计数据未修改，业务桥接仍未启用。后续按当前实际版本冻结新的保护基线，不复用旧快照覆盖线上。
