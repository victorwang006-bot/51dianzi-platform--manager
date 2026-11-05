# 20261105-admin-navigation-priority-v1 构建路径选择

选择：**冻结完整当前源码的 production frontend-only build**，而不是旧 bundle 正则删 UI 或客户组件单点移植。只准备离线工具，不 SSH、不发布、不提交/push、不修改其他 agent 源码、plan/TODO。

仓库实际 HEAD（2026-11-05 本轮开始只读核验）：`b29c118d17fd2cb09ebfb0baffdb2b4070186301`，分支 `main`，不是猜测的 869 开头提交。包含 `d921f31` 渠道浏览/软删除/回收站/批次与 `b29c118` 四顶部导航源码；工作树另有本轮并行修改，最终构建必须记录完整源码 SHA 清单，不能只用 HEAD 冒充已提交来源。

## 优先路径评估

现网 DashboardLayout 有可单点换的 `__hierarchy_navigation_v1` 工厂，渠道 Host 有 `__ci_channel_topnav_overlay_v1` 工厂。现网业务 chunk AST 无解析错误，客户函数是 `Ew`，UTF-16 范围 `[1417239,1446559)`，约 30KB；其函数之外存在共享 hook/组件/状态。客户最新改动不止该函数：`useCustomerStars`、创建表单/草稿、联系人/供应/需求组件及 CSS 都参与。

CustomerList 依赖 `usePageMemory/useRememberedState`、`useCustomerCreateDraft/Identity`、`useBusinessScope`、tRPC、Wouter、Portal、Radix UI；`pageMemory.ts` 的 books/listeners 和 `customerCreateDraftStore.ts` 的 entries/listeners 是模块级单例，客户创建/详情/导航身份清理共同消费。仅桥接 React/tRPC/scope 后重编其余依赖会产生第二份 store 与事件监听；要可靠移植必须识别及桥接许多压缩闭包并覆盖跨页行为，超出本轮最小安全范围。因此不提交自称“其他字节保留”的不可靠客户移植。

## 保留原覆盖功能

完整源码当前已有 ChannelInventoryHost URL `ciTab`、权限验证、渠道管理、批次上传/历史管理、软删除确认与回收站恢复；已有层级导航和 DashboardLayout 接入。构建器必须冻结 client/shared/server（server 仅用于实际全仓 tsc 类型关系与来源哈希，不产出/发布 server bundle），执行 pnpm exec tsc 与相关客户/渠道/导航测试，检查 Vite manifest 的渠道 Host/管理/导航源模块到新 chunk 的关联，记录 SHA 与日志。

## 发布边界

新前端图整体放到唯一 `/assets/20261105-admin-navigation-priority-v1-<sourceTreeDigest前12位>/` 命名空间，所有旧资产保留。后台 HTML 只解除旧 importmap/CSS 覆盖并换入口/生成 CSS/preload 标签，其他 HTML 字节原样保留。不复制覆盖 root favicon；发布前按 source public 文件哈希验证现有 root public 资源相同。不构建 server，不更改 API/DB/env/NGINX/前台/worker，不重启。

发布脚本使用旧脚本全局锁 `/var/lock/dianzi51-public-deploy.lock`、coord `/opt/ops/51-project-release-coordination-20261027.json`、实际 admin/front serving-root 检查、现行 tombstone-aware admin backend 脚本路径、PM2 只读状态/摘要与保护文件 SHA。仅 admin HTML 原子切换；出现失败只在 HTML 仍为本轮 hash 时回退 HTML，绝不回滚 backend/assets/data。回退保留全部新增资产。

工具先就绪，最终 build 必须在父级声明源码冻结后运行；任何冻结后改动使旧候选过期，必须重冻/重建。真实类型检查/构建/测试的 exit code 与原始日志保留，失败绝不标为通过或形成可发布 manifest。隔离授权状态交互 QA 与当前生产基线重新只读验证由父级掌管。
