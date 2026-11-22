# Manager 新增信息通知：最小脱敏诊断实施

实施基线：真实 manager `/home/ubuntu/work/channel-release-20261121-1837/manager`，HEAD `d7111416a8699c81edb6f15617a595e54664378d`。本子任务只修改 manager 通知服务源、通知专用订单 transport、新诊断模块与合成 tests；没有 SSH、数据库连接、真实 RPC、生产操作、发布、重启、Git 提交、schema/客户端/构建发布脚本修改。工作区中的 `TODO.md`、`plan.md` 属父任务并发修改，本子任务未读写或提交它们。

**本改动是诊断补强，不是历史 sales.inspect 503 底层根因修复或归因证明。** 没有猜测 SQL/schema 故障，没有加大 timeout，没有改变权限、成功空集、回执、mark 或计数规则。

## 1. 已修改源

- `server/services/adminNewInformationDiagnostics.ts`：仅依赖 `node:async_hooks` 与 `node:crypto`；请求随机 UUID + ALS。公开闭合字段为 `event/traceId/procedure/module/sourceKind/method/phase/coreStage/outcome/durationMs`，可选请求内 entry 序号、安全错误字典和 `truncated`。不存或输出 actor、账号/商户/客户/订单 ID、refs、scope、回执、token、secret、SQL、参数、任意 message/stack/cause/name。
- `server/services/adminNewInformation.ts`：summary/unreadRefs/inspect/markDisplayed 外层诊断，原 viewer/secret/输入门禁与原事务行为不变；source list/lookup、事实校验、首次真实 establish、回执、store/post-callback commit、fence callback operation 与 post-callback cleanup 的真实区间记录。
- `server/services/adminNewInformationSources.ts`：每 entry 添加固定 method/sourceKind 与请求内序号，不修改 identity/authority/prefix/read 的授权来源。`prove`记录 begin/error/denied、validFacts 以及 allSettled rejection；仍最多四 worker，仍等待全部已发 reader 完成后才 fail。原 `explicitlyDenied(error)` `.code === "FORBIDDEN"` 未改；固定选择/所有合法入口/空 refs 重核/最终 scope 过滤未放宽。
- `server/platformOrderApi.ts`：新增私有 `PlatformOrderNewInformationError`、`callPlatformOrderNewInformation`；仅 `getPlatformOrderNewInformationFacts` 改调专用 helper。错误只有固定 `kind/httpStatus/upstreamTrpcCode/timing`，**不设置 `.code`，不保留上游 message/cause**。portal `UNAUTHORIZED`、transport 保留的 `upstreamTrpcCode=FORBIDDEN` 均不会变成 source 可忽略 denial。超时仍为原 `10_000ms`，undefined/[]/codes 及 refs 原样下传。
- `server/businessAuthorizationFence.ts`：仅可选第三参数 hooks 和固定义类属性；原 lease count/wait timeout、GET_LOCK 顺序、reverse RELEASE_LOCK、connection.end、releaseLease 与 error 优先级不变。其他两参数 caller 默认没有 hooks、原行为不变。该源的细分 hook 测试不意味着生产旧 native fence 已替换。
- 新 tests：`server/services/adminNewInformationDiagnostics.test.ts`、`server/businessAuthorizationFence.diagnostics.test.ts`。

固定 sourceKind 为 `nativeOrders/crmSales/sellerOrders/business/nativeMall`，普通核心为 `core`。订单/业务 method 为实际固定 RPC；mall 是内部 reader 的固定 `nativeMall.read` 标签，**不是虚构上游 RPC**。

## 2. 有界、防噪音与安全处理

每请求最多缓冲 160 条安全阶段记录，结束时释放；成功只输出一条结束记录，不输出内部成功阶段。失败输出结束与最多 160 条阶段，超过上限保留 late error 的有限尾部，标记 `truncated`。无 trace 全局 registry、无结果/身份缓存。ALS 后代在请求关闭后无法追加记录。

每进程每分钟最多 60 条成功结束、1200 条失败诊断；计数器固定数量，时间窗重置，没有按账号/trace 无界 Map。异常 sink 不替换返回值或原错误。错误取值逐字段 allowlist，不枚举或序列化原 Error；mysql code/sqlState/tRPC code/transport kind/固定 fence 类都在闭合集合内，errno/HTTP/timing 只接受有界数字。任意 message/stack/cause/SQL getter 都不会读取。

`coreStage` 保留实际 core list/lookup 等上下文，在并发 entry reader/validFacts 中不被覆盖为 reader 的 stage；trace 与 entry label 使用 ALS 支路隔离。

## 3. 父级生产组装必须处理的接线

已 discover 并读取两个入口：

1. manager `deploy/admin-new-information-v1/build-native.mjs`。
2. 所给 `/home/ubuntu/work/admin-polish-release-20261121-2257/build-backend-native.mjs` **不存在**，实际文件为同目录 `backend-native.mjs`，已读取。

当前 production admin 通知为 `df1b13f2...` runtime。原两个构建在 `platformOrderApi.ts` 的 virtual module 中只保留 `const callPlatformOrder=native.callPlatformOrder` 与导出函数；直接沿用会绕过本次专用 transport。

**按父级 17:27/17:28 的最小组装决定：不改主 API 原 public callPlatformOrder，仅换内容寻址通知 runtime import。** 必须取消通知的旧 platformOrderApi virtual bridge，或 narrow 提取 `getConfig`、`PlatformOrderNewInformationError`、`callPlatformOrderNewInformation`、`getPlatformOrderNewInformationFacts` 及其 diagnostic import。getFacts 必须调用本次专用 helper，不能重新改回 native.callPlatformOrder。原 native DI 对象中的 `callPlatformOrder` 键可保留但不使用；不要为了删除冗余键改变其他 API 字节。

组装新 core/source/transport 诊断时，诊断模块必须共享一个模块实例/ALS；不要单独再编译一份诊断 singleton 注入其他位置。新增内建 import `node:async_hooks` 需加入原 compile allowedPackages。使用原捕获 native SQL/and/eq、Zod、TRPCError、db/helper、业务/权限/native schema bindings；保留现有共享 facts contract 实例，避免不同 SQL 或 TRPCError realm。禁止把 root `server/db.ts`、root boot、数据库 client 副本或另一份 fence 连接池 bundle 进去。

**Fence 生产接线边界：** db bridge 仍是原 native.withBusinessAuthorizationFence，两参数生产实现会自然忽略可选第三参数。core 外层已用 callback 的真实成功/失败区间区分 operation 与 post-callback cleanup，不需要改原 native fence，也不新增 pool。只有原 callback 成功而 native fence 最终抛错，才记录 `cleanup:error`；callback 失败记录 `operation:error`，原 fence 若同时吞下清理错误，本次不伪造一个未观察到的 cleanup error。源 fence hooks 的 `fenceLease/fenceConnect/fenceLock/cleanupUnlock/cleanupEnd` 详细记录仅在该源 hook 真正接入时存在；**父本轮无需接入这些细项，更不能为它们替换生产锁池**。原 native fixed fence Error 没有安全属性时只记阶段和空安全错误字典，不输出其 message 来补证据。

**Commit 边界：** `commit` 是 store callback 已成功、withModule(s) 尚未 settle 的实际持久化/提交区间；本代码不自己发 COMMIT、不声称获得驱动更细分提交阶段。callback 失败不会记录不存在的 commit。

## 4. 已完成本地测试

最终源码：4 文件 **107/107** Vitest 通过（原 core 44、原 source 41、新 diagnostics/transport 18、source fence mock 4）；5 项隔离 native ABI/原 captured transport 对照通过，总计 112 项。

覆盖并发 trace/entry 隔离、sinkthrow、PII-canary/getter 无输出、160 条缓冲及 late descendant 防追加、每分钟成功/失败限频、已发 reader allSettled 等待、fixed validFacts 错误、原 FORBIDDEN 选择、upstream FORBIDDEN/portal UNAUTHORIZED 不改变 denied、原 503 code/中文文案、source fence operation/cleanup 多错误与 first-error/release/end 顺序、store commit 和旧 native post-callback cleanup、三态 sales scope、专用 transport 安全错误与原 public orders 错误行为。

`native-diagnostics-compatibility.mjs` 使用本次真实 core/source/private transport 源编译离线 factory，注入原项目的 SQL/Zod/TRPC realm 与纯内存 native db/helper；检查只有一个 diagnostic module、没有 root db bundle、没有 MAX_FENCE_LEASES 第二池。新专用 transport 的模拟 503 在相同 trace 下携带安全 HTTP503/UNAUTHORIZED，而对外仍是原 SERVICE_UNAVAILABLE 文案。另从 SHA256 `de4e92fa...` captured admin API 的 AST 只提取原 callPlatformOrder 做 mock（不 import/启动 API），证明原 transport 确实丢安全分类。原 `getConfig/callPlatformOrder/getPlatformOrderStats/listPlatformOrders/getPlatformOrderDetail` 函数与 HEAD 逐字相同。

运行命令：

```bash
cd /home/ubuntu/work/channel-release-20261121-1837/manager
./node_modules/.bin/vitest run --config /home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/manager-diagnostics-vitest.config.mjs --reporter=verbose
node /home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/native-diagnostics-compatibility.mjs
```

全项目 `tsc --noEmit` 仍 exit 2，只有一项基线已有 TS2802：`for (const key of pending.get(module)!.keys())`，原 HEAD 同语句在原第819行；不是本次新增类型错误。esbuild Node20 编译与 107 项 tests 均成功。未修复无关 tsconfig/原语句。`git diff --check` 通过。

## 5. 产物与安全边界

该目录下有 `diagnostics-manifest.json`、`diagnostics-sourcepins.json`、`diagnostics-tests-results.json`、完整测试日志、native 测试源及其 metafile/result。`native-diagnostics-compatibility.runtime.mjs` **只是离线测试 factory，不是发布候选**；父需按捕获主 API 的原 realm/桥接生成自己的真正生产 runtime。

本子任务未运行任何生产测试，也未宣称真实账号或历史503已恢复。父最终 assembly/inverse/outside-hunk/生产发布验收与线上原服务加载确认仍未由本子任务执行。
