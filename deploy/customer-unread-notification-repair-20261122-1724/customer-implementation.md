# 客户未读交集：customerPicker 独立实现交付

实施窗口：2026-11-22 17:24 批准修复上线；本分支于 17:31 完成候选模块与离线验收。**状态：本地实现完成，未由本分支上线。** Git、SSH、生产核验和联合发布均由父级负责。

## 1. 已实施范围

真实仓库为 `/home/ubuntu/work/channel-release-20261121-1837/platform`，接手时 HEAD 为 `165ab49e612550d34ca023c0b1d7c4371b4eef9d`。仅修改原有的 `deploy/company-stock-sales-v1/customer-picker-fix/customer-picker.runtime.mjs`；同目录新增本次增量规范、构建器、测试、正逆补丁、manifest 和实现记录。

`shared/crmCustomers.ts` 与 `server/services/crmCustomers.ts` 本来已有 `customerIds`，仅读取并作为新增片段的派生参考，未重复编辑。未改 router、旧 dormant 主函数、BFF、静态资产、通知引用/已读回执、数据库或并发渠道功能。未运行原 `build-runtime.mjs`，未重提取最新服务 closure，未做 Git 提交或任何生产/网络访问。

## 2. 冻结基线与内容寻址候选

| 项目 | SHA-256 | 字节数 |
|---|---|---:|
| 原活跃 sidecar / 完整冻结基线 | `7d357530812b8e15ff08abd418aa247cc50c1276821285272631d1215ccea53d` | 24,979 |
| 本次候选 | `3e3b275ecf6462f74e4943053ecc34fefc27df323a83accf1653d2e9a0a2fb25` | 25,572 |

候选文件：[customerPicker 新 runtime](/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/customer/runtime/customerPicker.3e3b275ecf6462f74e4943053ecc34fefc27df323a83accf1653d2e9a0a2fb25.runtime.mjs)。同目录保留完整冻结基线用于离线对照与逆向核验。

真实仓库中的 runtime 与上述候选完整字节相同。源码变更为 **4 处插入、8 行新增、无删改旧行**：

1. 定义 `customerListIdsSchema`：`z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(2000).optional()`。
2. 将其加入活跃 `customerListSchema` 的 `customerIds` 字段，从而实际导出的 `customerListInputSchema` 不再剥离该字段。
3. 活跃 `listCustomers` 独立执行 `safeParse(input.customerIds)`，直接调用也拒绝非法值；沿用原身份校验顺序，错误为 `BAD_REQUEST`。
4. 在原 `conditions` 已建立全部权限/列表交集后、`const where` 与 count/page 查询之前去重，追加绑定参数的 `c.id IN (...)`；`[]` 追加 `FALSE`；省略或显式 `undefined` 不追加任何谓词。

count 与 items 仍使用同一个 `where`，total 仍从实际授权交集 count 得出，而不是请求 ID 数量或当前页行数。没有页后过滤，没有空数组短路绕过权限，没有空 `IN ()`。

## 3. 源派生与 outside-patch-exact 证据

新构建器 `build-customer-unread-runtime.mjs` 不执行旧 closure 构建器，也不导入业务服务。它使用 TypeScript AST **仅选择**共享源码的 ID schema/property、服务中的独立 ID 校验与 ID intersection 语句，以 esbuild 规范化比较这四个有限片段与候选插入内容。四项均一致，原始片段、片段 SHA 与文件 `sourceSHAs` 已写入 [manifest](/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/customer/manifest.json)。不从最新 `getCustomerContext` 或完整 `listCustomers` 生成模块。

`customer-unread-increment.json` 保存每处插入在原基线与候选中的 UTF-8 字节位置、完整新增内容及两端完整 SHA。移除这四个精确候选字节区间后，整文件恢复 `7d357530…`；向恢复基线重新插入后，整文件再次等于 `3e3b275e…`。因此新增片段以外的字节全部精确保留。policy/team/select/map/context 辅助函数另有直接字节相等断言。

完整 [逆补丁](/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/customer/customer-unread-inverse.patch) 同时嵌入 manifest，不是省略版。另用 GNU `patch --batch -p1` 在临时隔离目录独立应用逆补丁后核验完整基线 SHA，再应用正补丁核验完整候选 SHA，结果见 [正逆补丁 roundtrip](/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/customer/patch-roundtrip.json)。

## 4. 定向验收：18 组全部通过

[tests.json](/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/customer/tests.json) 状态为 `PASS_OFFLINE_RUNTIME_ROUTER_READER`。测试不是仅对主服务或 schema 做单测：从完整 SHA 固定的捕获生产 `front-api.js` 中提取**真正活跃的 `customerRouter.list` 表达式**与 `scopeFor`，把它们放入真实 `@trpc/server` router 并以 `createCaller` 调用。其 input 为候选 sidecar schema，reader 为候选 sidecar `listCustomers`，Zod、Drizzle 和 MySqlDialect 使用真实库。

| 验收点 | 结果 |
|---|---|
| 旧活跃 router 与新候选对照 | 旧模块忽略 `[41]` 且 total=65；新模块仅返回 41 且 total=1 |
| 正安全 int / optional / max safe / 2000 | 合法值保留；2000 个 ID 通过真实 router 与 reader |
| 非法数组/元素、0、负数、浮点、字符串、null、NaN/Infinity、unsafe、2001 | schema 和真实 router 拒绝；reader 不执行 |
| 绕过 schema 直接调用 service | 非法 IDs 独立拒绝，未进入 native reader |
| 30 条交集跨页 | page1=20、page2=10、page3=0，各页 total=30，无漏行/重复 |
| count/items predicate | 每组查询的完整外层 WHERE 与绑定参数严格相等 |
| 重复 IDs | schema 兼容保留；reader 去重构造 SQL；total 不按原数组长度计算 |
| `[]` | 第1/后续页均 total=0/items=[]，原 native 授权仍发生 |
| omitted / undefined | 与旧基线的结果、全部 SQL 与绑定参数逐项相同 |
| 企业/个人/团队/委托 owner/星标/date/search/grade/stage/archive/due | ID 集合内的12类单条件不符合成行仍被排除；非法 scope/身份被拒绝 |
| assignee 星标 | 原 native assignee predicate 仍出现在 SQL，starUserId/canSetStar 语义保留 |
| 销售 order picker | 当前团队、可信创建来源、字面 `%_=` escaping、企业资格、空关键词、排序、provenance 均保留 |
| getCustomerContext | 与基线结果及全部 SQL 完全相等 |
| 可信身份范围 | 捕获 `scopeFor` 使用 ctx.user.id/企业可信绑定，保留 staffDelegation；请求伪身份不能替代它 |

所有输入、身份、客户、团队和 executor 均为合成数据；没有真实 DB、HTTP、网络、ECS 或真实业务身份。网络 socket/fetch 被阻断，SELECT executor 拒绝非 SELECT。**native star-access 授权 gate 为注入 mock，而非真实权限集成验收**；其生产实现与调用方式保持原字节，离线差分支持非回归，不替代父级生产最小核验。

runtime、增量构建器与测试均通过 `node --check`。

## 5. 重放命令与源码记录

在真实 platform 仓库执行：

```bash
node deploy/company-stock-sales-v1/customer-picker-fix/build-customer-unread-runtime.mjs \
  /home/ubuntu/work/procurement-demo-restore-release-20261122-1610/capture/dependency-151.mjs
node deploy/company-stock-sales-v1/customer-picker-fix/customer-unread-runtime.test.mjs
```

构建器拒绝候选/runtime 并发变化或基线完整 SHA 不符，不会覆盖未知修改。构建只将核验过的冻结基线增量复制到输出路径并记录证据。新源码文件位于原 runtime 同目录，不修改旧 builder/README/runtime-manifest 的历史内容。

## 6. 父级接线与发布边界

本分支未改 API import。父级可对已有活跃 factory import 进行精确内容寻址替换：

```text
customerPicker.7d357530812b8e15ff08abd418aa247cc50c1276821285272631d1215ccea53d.runtime.mjs
→ customerPicker.3e3b275ecf6462f74e4943053ecc34fefc27df323a83accf1653d2e9a0a2fb25.runtime.mjs
```

factory 名与原 native 注入、活跃 router 的 input/reader 接线无需更换；不要改回 dormant 主函数，也不要原位覆盖旧 SHA 文件。父级应按自身发布计划核验相关 direct route / fixed dispatch / narrow internal list 均仍引用该活跃 override，执行完整 SHA/CAS、服务装载与回滚核验。本候选无需 DB migration，也没有要求发布/restart admin、NGINX、worker 或全站；历史 sales/inspect 503 不是本修复的关闭对象。
