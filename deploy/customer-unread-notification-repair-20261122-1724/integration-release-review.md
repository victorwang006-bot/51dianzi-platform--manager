# 独立只读集成发布审查

**结论：PASS。** 对本轮冻结候选、实际路由链、原生依赖接线和发布器进行只读离线审查，未发现确切发布阻碍。此结论仅适用于下列完整字节，不表示已经上线、真实 SQL 已验收或历史 503 根因已闭合。

工作目录：`/home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724`。本审查仅写入本文件和 `integration-release-review.json`；没有修改源码、候选、manifest、Git 或生产，没有 SSH、浏览器、网络、真实 DB、API 启动或全站测试。

## 冻结身份

| 文件 | 完整字节 SHA-256 |
|---|---|
| `final/manifest.json` | `e516479d16ffbbf2492bb788ec2f86831b3ad08f23b2eafd41ed4828917b23d3` |
| `release-remote.py` | `40fb503ad5fdb018619b82c570f6eb9a58c73f30396ce54fb235fd78a31c6ff9` |
| `release-client.py` | `06f5db9e5ce6be67bc08ca08c8df0a05f36941d6d24171ae2d99c25ae5222285` |
| `prepare-release-driver.py` | `40f050ef91c34943e36c8cbbe2e388a73d3ce7d40187dd7064f1d958c9c505c0` |

最终 42 个 sourcePins、客户 sourceSHAs/artifactSHAs、诊断 sourceHashes、后端 capturePins 以及四个最终 API/runtime 的 SHA/size 均匹配。双方最终提交固定为 front `bac021ca40e9670bb790229600dbedf968846538`、admin `6d1ca122516ae4ed6b3dc910465dec19a1f7ab07`；HEAD 已推送且干净沿用委派确认，未在本审查运行 Git。实现说明里的旧 HEAD 是实施基线记录，不作为最终提交漂移判断。

## 1. 客户真实路由与授权 SQL 交集

实际 front 候选 `customerRouter.list` 仍用 `__customerPicker20261117.customerListInputSchema`，并调用同 factory 的 `listCustomers(scopeFor(ctx), input)`；`scopeFor` 保留可信企业、`ctx.user.id` 与 staffDelegation。`appRouter.customer`、`buildCallers.customer` 与固定 `executeInternalBusinessMethod` 最终仍进入该真实 procedure。窄 `internalBusiness.customerList` 的 filters schema 及 `listInternalBusinessCustomers` reader 也引用同 picker，没有切换到 dormant 函数。关键位置为 front 候选第 103618–103628、124375–124386、131479–131603、131685–131688 和 133535 行。

客户 runtime `3e3b275e…` 的 IDs schema 为 optional 正安全整数数组，上限 2000；reader 独立校验非法 IDs。省略/undefined 兼容原行为，去重后追加绑定参数的 `c.id IN`，空数组追加 `FALSE`。该谓词在原企业、actor、团队、委托、负责人、星标、日期、搜索等授权/列表条件之后、共同 `where`、count 和分页之前。count 与 items 共用 where，total 不取请求长度或页长度；空数组不绕开原 native 授权。

独立按四处 UTF-8 插入位置重建完整候选，再移除对应区间，均精确恢复 `7d357530…` 基线。两处 API 的 forward/inverse 与 outside spans 亦完整匹配，因此没有误切外侧函数或覆盖其它已上线功能。

## 2. 安全诊断与专用订单 transport

实际 admin runtime `1239d4b9…` 中只有一份 diagnostics 初始化、一个请求 trace storage；独立 sink ALS 不是第二 trace 模块。core、source、prove 与私有订单 helper 使用同安全模块/trace。安全输出为闭合字段及错误白名单和有界数值，不序列化任意原 message/stack/cause、SQL、refs、业务 ID 或密钥。160 条阶段缓冲、分钟限频、关闭后拒绝追加、结束时清空与 sinkthrow 不改变结果的处理保持。

`getPlatformOrderNewInformationFacts` 实际调用新 `callPlatformOrderNewInformation`。原 `native.callPlatformOrder` 仅保留旧 ABI 桥接赋值，不被 getFacts 调用；公开订单 stats/list/detail 的原主 API transport 字节未变。专用错误保留安全 `upstreamTrpcCode`，不置 `.code=FORBIDDEN`，因此上游 403/FORBIDDEN 不会变成 source 可忽略 denial。原 10 秒 timeout 与 salesStaffCodes 的 undefined/[] 三态传递保持。

`prove` 继续最多四 worker 并等待 `allSettled` 后才失败，全部已发 reader settle 后才释放外层 fence。scope selector 仍只过滤最终 items，全部合法 source 的 facts 与完整 union 仍先验证，allowed refs 过滤保留。

**历史 `sales.inspect` 503 底层 cause 仍 OPEN。** 本轮只上线安全 stage trace，不能据此宣称根因修复或真实 503 已恢复。

## 3. 原生 ABI、contract 与增量边界

后端 candidate 原 native db/router/adminProcedure/helper/fence 注入及六个 factory 返回键保持；原 Zod/SQL/TRPC imports 与 `e9f76fbc…` 单例 facts contract 不重编译。对两个实际 runtime 做独立 TypeScript AST 自由名绑定静态检查，均为零未定义自由名、零 parse errors，未执行候选业务代码。

admin runtime 仅六个指定 hunk：新增 ALS import、单份真实诊断模块、私有 facts transport 区块及三处真实源码函数替换。两个主 API 各仅一个内容寻址 import URL 替换；完整正向、逆向与所有 outside span SHA 均精确相等。

新 `businessAuthorizationFence.ts` 源细分 hooks **不部署**。候选无新 fence 实现、`createConnection` 或 `MAX_FENCE_LEASES` 第二池，继续注入原 native fence。core 仅能观察 callback operation 和成功 callback 后的 cleanup；原 native 吞掉的 cleanup 错误不可宣称可见，也不能宣称本轮具备 lease/connect/lock/unlock 细分证据。

## 4. 发布器与客户端

以成熟 `demand-redesign-release-20261122-1523-retry/release-remote.py` 为基准，AST 定位后逐函数比较：双方 37 个函数，**34 个未改函数逐字相同**；仅 `load_payload`、`run_release` 和采购匿名 gate 重命名为客户匿名 gate 有范围内差异。原禁止 runtime 的约束仅扩为指定 front `customerPicker.3e3b…` 与 admin `newInformation.admin.1239…` 两文件，不允许任意 runtime。

发布脚本保留固定双锁顺序、closed/non-recovery coord fresh guard、全字节与 inode/metadata CAS、完整备份、不可变 runtime 安装、owned-inode 精确回滚、歧义 failurehold、durable close/receipt 和随后解锁。runtime allowlist、side、路径、文件名 hash、size 及对应 API 单次引用均固定。只 reload `dianzi51` 和 `dianzi51-admin`；其它进程 PID、所有 config/environment 指纹及 nginx/dump 文件受保护。guard 常量与 fresh runtime-guard 捕获相同。

两个 HTML 均强制 NOOP、保留原 inode，assets 为空；front `e83a1ca0…` 新渠道静态与 admin `eb21e460…` 采购 Demo 不回滚。旧 API front `a16d691a…` / admin `de4e92fa…` 是本轮捕获基线；29 个带 local 的捕获文件无 SHA 漂移，捕获 coord 为 inactive/closed。顶部静默通知也不在本轮改动范围。

客户端先要求本审查 PASS 且 manifest/driver/client 完整 SHA 匹配。它从最终产物重新生成 fullpayload，以 nonce 私有 gzip 和脚本 `wx/0600` 上传；完整 SHA/size/metadata 校验后解压，校验 raw 完整 SHA/size，再 `O_EXCL/fsync` 写入。没有旧 payloadseed 或旧 staging 复用，driver 拒绝已存在 stage。客户端核对 durable receipt、精确 reload/targets/runtimes，并独立检查 coord closed 和双锁已释放。

## 验收证据与限制

接受已有 18 个客户真实 router 离线 case、112 个源码/兼容 case、6 个最终候选原字节 factory mock case，不重跑。接受 ES2020 `tsc` exit 0；standard 仅保留原 MapIterator TS2802 从第 819 行移至 873 行，config 未改。

这些证据包含合成身份、native 权限 gate、store、SELECT executor 和上游 transport mock，不是生产 MySQL 或真实账号通知功能验收。匿名 customer/auth gate、admin 缺商户 header gate 和 `newInformation.unreadRefs` auth gate只证明入口门禁；客户端终端成功标签也不得解释为真实 customerIds SQL、unread 或 markDisplayed 功能验证。

没有 DB migration 或业务写测试；`businessTestWrites=0` **不等于**应用 startup/reload 数据库写入为零。fresh 捕获不是本审查重新访问生产的结果，发布前及锁内 fresh guards/CAS 必须由冻结脚本实际通过。该 PASS 不是发布执行授权的替代，也不是线上成功收据。

机器可读结论见同目录 `integration-release-review.json`。确切阻碍发现数为 0；本审查未修复任何源码或发布文件。
