# 渠道库存定向 frontend overlay（离线构建器）

本目录包含离线构建、校验与服务器本地定向发布工具。构建器不修改源文件、线上产物或生产数据；发布工具默认仅展示计划，必须显式指定阶段和 `--apply`。

## 最终源码冻结后的操作

在 manager 仓库根目录执行：

```bash
node deploy/channel-inventory-management-v1/build-overlay.mjs
node deploy/channel-inventory-management-v1/verify-overlay.mjs
```

构建器读取 `/home/ubuntu/inventory-implementation/deploy-review/` 已核验基线，读取当时的 `ChannelInventoryHost.tsx` 和实际局部依赖，所有生成物写入 `/home/ubuntu/inventory-implementation/overlay-build/`。重复运行不会覆盖原线上哈希资产；源文件与 CSS 未变化时 JS/CSS 内容哈希一致。构建期间源文件发生变化会停止并要求重跑。独立复核器也会检查构建后源码是否发生变化。

必须仅使用当前 `manifest.json` 指向的生成物；目录可能保留较早候选资产。任何构建或复核失败都不应使用候选。输出不等于发布授权。

## 原产物单例与精确改动范围

TypeScript JS AST 在固定基线哈希下唯一定位原顶层 `function r1`，UTF-16 字符串区间 `[496433,556550)`，而非 UTF-8 字节偏移。只替换这个函数，并在相同位置插入封装后的 IIFE factory。新的 `r1` 仅使用原 React `createElement()` 包装新宿主组件。所有新的 minified 声明均位于 factory 内，唯一外部绑定名做全 AST 碰撞检查。

实际原入口 import/export 别名在每次构建中核实，不凭猜测：

| 依赖 | 原 chunk 词法绑定 | 原入口 export |
|---|---|---|
| React | `c` | `r` |
| JSX runtime | `e` | `j` |
| 业务域 tRPC | `B` | `F` |
| useBusinessScope | `La`（本地 `useContext(Kx)`） | 不另导入 |
| useLocation | `tn` | `l` |
| useSearch | `Lr` | `o` |

`business/api/business-trpc` 的 **domain `trpc`** 直接引用原 `B`，并使用原宿主所在 Provider 的 `useUtils().client`。不打包 `createTRPCReact`、不建立新 HTTP transport、不换成主站 raw client、不创建 BusinessScope 或路由 Context。

原 dropdown 通过唯一 JSX `data-slot` 与原 source `data-loc` 定位，复用 `xo/fo/bo/ea/Vg`。批量上传的原 Dialog/Button 同样通过 AST 定位，复用 `Vs/Gs/vt/Fa/Ft/Xs/X`，保留原 Dialog IME composition 和 BusinessPortal Context；不会重建 Radix/ReactDOM。原 XLSX 动态引用 `./xlsx-DGuHH-KN.js` 继续使用，不新增 XLSX bundle。业务纯函数的 zod schema 可以作为局部依赖打包，它不创建 React/tRPC/路由 Provider。

新版 Host 与其新版 BatchUpload 都包含于 factory；原 chunk 中其他宿主仍引用原 BatchUpload，完全不改这些函数。原其余页面、顶层 imports/exports 和全部其他字节保持原样。构建器和独立复核器均通过“删除插入并恢复原 `r1`”验证整个 chunk 与基线完全同字节。

## CSS 与 HTML

原所有 Host/layout/batch/notes CSS import 在局部 bundle 中丢弃，但线上原 CSS 原封不动保留。只将当前 `management.css` 同字节输出为内容哈希 CSS；也包含 UI agent 在该文件新增的按渠道样式。新增规则要求 `.ci-page.ci-host` 局部 scope。禁止覆盖 CSS 变量、全局 selector、字体/字号；若有排版声明，只接受继承或原 `--admin-content-*` 变量。构建器不会修改 CSS 来规避检查。

`candidate-index.html` 以原 HTML 为唯一基线，在第一个 module script 之前新增：

1. 一个 importmap，映射 `/assets/BusinessWorkbenchPage-DZYOmou-.js` 到新内容哈希 JS。
2. 一个新 CSS link。

原 `/assets/index-CG0lkwm6.js` 入口 src、原 preload/CSS、ResizeObserver 脚本及约 367KB 内联 runtime 均完全不变。删除带标记新增片段后必须同字节恢复原 HTML。

原 Vite preload 清单仍可能预加载旧业务 chunk 和原 CSS；预加载不等于执行。实际动态 import 的绝对 URL 与 importmap key 做静态 canonical resolution 校验。本次没有生产浏览器访问；未来实际启用前仍需在允许的本地浏览器集成环境确认 importmap 动态加载行为、首次加载和缓存策略，不要因 preload 网络请求仍见旧文件而误判。

## 校验与输出

每次构建均核验原 JS、入口 JS、HTML、业务 CSS 四个 SHA-256；任何漂移即停止。`overlay-metafile.json` 记录完整依赖图，`manifest.json` 记录基线/输出哈希、唯一改动函数范围、单例桥接、丢弃 CSS 列表、实际源码哈希与校验结果。

离线 VM 使用真正 React/JSX 和 ReactDOM SSR 渲染编译后的 factory，注入模拟的唯一 scope/tRPC/路由实例，不发起网络：

- 授权库存数据与四个 tab 可渲染；
- 无 native write 时删除入口消失；
- 无 native read 时仅渲染原权限拒绝状态、不泄漏库存 fixture；
- 所有 scope/location/search/useUtils hook 确实调用注入的实例；
- 库存请求保留真实 scope DTO 的 asserted enterprise/actor identity。

这些检查证明 bundle 的桥接派发和静态兼容，不代替最终浏览器交互测试、后端权限/多租户测试或未来发布后的健康检查。请冻结 UI/backend 候选后重新构建和复核，并由主代理处理后续授权发布。

## 本次已发布功能与后续部署

2026-11-04 已完成渠道库存单条及当前页勾选软删除、回收站恢复、持久上传批次/命名/归档/删除预检与整批删除，以及平铺查看和按渠道查看。原 UI、基础字体和字号 CSS 保持不变；渠道浏览仅组合现有 `listChannels` 全分页与服务器允许的团队来源，不新增绕过来源权限的接口。历史无批次库存不按时间伪造上传归属，仍可单条/勾选删除。

新增上传行在同一事务递增批次版本，因此预览后继续上传会使旧删除确认冲突，必须重新预览。零可删批次允许明确确认关闭后续上传。归档仅整理历史，不关闭队列或删除库存。

服务器发布工具为 `deploy-release.py`、`prepare-runtime-config.mjs` 和 `reload-target.mjs`，置于同一目录。只更新主站4个和后台2个实例，其余 worker 不变。常规 PM2 `startOrReload` 不会可靠更新既有实际执行入口；`reload-target.mjs` 按已核实 PM2 的 `reloadProcessId`/`current_conf` 契约逐实例替换 `pm_exec_path`，保留环境、cwd、实例及其他设置。每阶段均核验版本、文件、环境、任务身份；UI 最后启用。

```bash
python3 deploy-release.py --release /opt/releases/<name>-ci-management-v1 --prepare --apply
python3 deploy-release.py --release /opt/releases/<name>-ci-management-v1 --migrate --apply
python3 deploy-release.py --release /opt/releases/<name>-ci-management-v1 --activate --apply --pm2-save
```

需按照脚本头部约定提供严格8项 SHA256 发布清单。迁移只建立4张 sidecar 表，无 ALTER、回填、物理删除或共享授权改动。回滚默认只撤回 UI，保留已支持软删除的后端及 sidecar；不能在生产已使用删除功能后退回忽略 tombstone 的旧后端。

验证记录：渠道库存非数据库回归17文件293测试通过；后台最终7文件242测试通过；前后端类型检查通过；原页面/非目标 bundle 字节保留与 AST 后端白名单通过；独立浏览器实测旧模块预加载后 importmap 仍加载新模块。未用生产库存做删除或恢复测试。
