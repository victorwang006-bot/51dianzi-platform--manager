# 后台独立官方商城：独立只读审核

**审核快照：2026-11-17 00:34（Asia/Shanghai）。状态：本轮源与真实 native / 后台 static 候选审核完成；尚待父任务最终 rebuild/freeze、前台 static 与 release controller 闭合。当前不能作无阻断放行。**

## 边界与方法

本审核仅阅读 approved `plan.md`、两仓库相关源、已有离线测试及日志、冻结 manifest、真实候选 JS/CSS 与增量 hunks，并在内存作哈希及逆向字节比对。未改源或构建产物；唯一写入是本报告。未使用 SSH、浏览器、Git、凭据、真实 SQL、生产操作、真实商品/账号/订单业务测试；未重新执行已通过的大套检查，也未启动旧 bundle。

## P0 / P1 阻断

未发现 P0。当前有以下 P1，需要最小修复后冻结闭合。

### P1-1：同一 native QueryClient 的私有缓存没有账号／团队作用域隔离

证据：manager `client/src/business/MallMaterials.tsx:74–87` 的 status query 使用固定 `undefined`，list query key 只含筛选与分页；`rows = canRead ? list.data?.items ?? [] : []` 未检查数据所属作用域、获取中/失败状态。`scopeKey` 变化的 effect（104–109）清除表单/选择但不隔离或清空 list/suggest 缓存。suggest（103）同样只用型号/品牌 key，并有 10 秒 staleTime。实际 native root 的 QueryClient 长期共享；baseline `useAuth` 的换账号 effect 只使 customer draft 失效。`clearSessionQueryCache` / listener 在原 bundle 中虽有定义，但 native root没有安装调用；目前独立 OfficialMall 不挂载带该 listener 的 ChatPage/BusinessScope。

后果：同一挂载会话换团队，或同一 SPA 换号后重新确认 status，可能显示上一个后台作用域的旧物料、价格、内部备注与官方 metadata。`placeholderData: undefined` 不会清除相同 query key 的已有缓存；服务端权限正确不代表旧客户端缓存可直接展示。换团队时 auth id 不变，现有 ID 比较尤其不能阻断。

最小修复：仅对本模块私有读取做 account/team/权限世代隔离；可使用原 utils.client 配合明确包含 scopeKey 的本地 read query key，或取消/清空本模块私有缓存并要求本作用域新的成功请求后才显示。旧未完成请求还须取消或对结果加世代终门，不能仅在 effect 里清缓存后马上信任旧 observer。建议增加一个小型离线真实 QueryClient 回归：保留 A 缓存，切 B/换团队且 B 请求 pending/rejected，A 的 notes/价格/suggest 不应出现。无需真实账号测试、无需修改原 auth/ERP。

### P1-2：未知 mutation hold 按 actor:team 存放，换团队会直接解锁

证据：manager `client/src/lib/officialMallImport.ts:265–278` 的持久化 key 是 scopeKey；`MallMaterials.tsx:79,104–108` scopeKey 为 `adminId:teamId`，scope 变化读取新 key 并把 holdRef/hold 置为新值（通常 null）。runWrite 结果在世代变化时返回 unknown（137、144），但旧 UUID 只留在旧团队 key；finally 会解除 busy（155）。实际账本的唯一主体是 actor+requestId，不是 team（`officialMallSchema.ts:135–138`）。

后果：未知创建/导入/发布后，同一后台账号被移到另一有效官方团队，即可丢失可见 hold 并获得新的提交入口。旧 UUID 尚未核对，却能人工再次创建/导入，违背“未知结果停止提交并核对原 UUID”，且普通用户不必切换账号。旧 scope 记录没有被删除不等于当前 UI 仍被保护。

最小修复：未知请求锁按后台 actor 持久化，原团队作为回执元数据保留，而非解锁分区。当前账号团队改变后仍显示同一个原 UUID，允许 current actor 的只读 requestStatus 核对；不能自动重发，也不能因团队变化清除锁。切到不同后台账号不要展示前一账号的 UUID/内容；重新回到同一账号仍恢复 hold。补一个离线 scope 3→4 的未知请求回归即可。

### P1-3：批量／导入“完整回执”判定未核对本批覆盖总数，残缺结果会解除未知锁

证据：manager `MallMaterials.tsx:30–45` 的 importResult 只验证计数为非负整数、errors/ids 为数组；bulkResult 连 successful 整数/非负性都未检查。它们不核对发送行/ID、错误行唯一性与范围、计数守恒、success 与 errors 一致、ids 长度与有效性。runWrite（138–140）及 inspectRequest（175–185）通过即 clearRequest。settleImport（157–165）把本批所有未列 errors 的行视为成功/跳过，进度按发送行数全量增加。

只读反例：100 行请求收到 `{success:true,imported:0,updated:0,skipped:0,errors:[],ids:[]}`，当前判定为完整、清 UUID、100 行标成功并继续后续批次。批量 `{success:true,successful:-1,errors:[]}` 也可通过。当前真实服务正常路径会产出守恒结果，但这个终门旨在保护不完整/未知响应和回执，不能依赖结果恰好永远完整。

最小修复：hold 只保存非业务敏感的 expected rowNumbers / bulk IDs（已有 rowNumbers 可复用）；对响应与 requestStatus 同样校验：`imported+updated+skipped+uniqueErrors == sentRows.length`、错误集合为本批子集、`ids.length == imported+updated` 且正整数唯一、success 与 errors 相符；bulk 检查 successful 非负安全整数且 `successful+uniqueErrors == sentIDs.length`。不满足继续原 UUID hold，停批、不误标成功。补少量 malformed/count-mismatch 离线回归，不重跑大套。

### P1-4：明确数量／货期的上架门槛只在 UI，没有进入 native 发布终门

证据：manager `client/src/lib/officialMallImport.ts:71–76` 要求上架可售数量或订货数量大于 0、非空货期，UI submit 在 219 调用。服务 `server/services/officialMall.ts:160–195` 允许全 null 数量和空 leadTime；`changePublication:566–593` 仅 inputFromRow、revision/status 门槛，然后写公开 snapshot。bulk 预检（977–982）也没有正数量／明确货期的 publish gate。draft 默认空值合法是正确的，不应因此让 publish 也空值合法。

后果：合法 publish grant 的调用者直接 native RPC 可把全未知/零供应且无货期的草稿发布成“在售官方目录”，绕过已承诺的上架确认规则。现货虚报正则虽有，但对空货期无效。

最小修复：新增仅 publish 使用的服务端检查（不能收紧 draft 保存，也不能禁止 null/未知税或 MOQ 非 SPQ 倍数），要求真实正可售或正订货数量与非空人工确认货期。single 与 bulk 预检使用同一个 gate；offshelf 不受新 publish gate 阻碍。补 single/bulk 不完整 publish 拒绝及有效 unknown-tax quote 保留的小型离线用例，然后重新 freeze native runtime。

## 已确认通过的关键边界

- 新迁移只 `CREATE TABLE IF NOT EXISTS` 三个独立空表（materials/publications/requests），无 ALTER、INSERT、原数据复制、自动 grant。独立 `OM_uuid` 不带 front inventory/merchant identity。
- 原 native `ctx.adminAccount` + sessionVersion、账号/role grants/membership/team 锁与 owner/leader 检查被实际 candidate bridge 复用。源码和 baseline ABI一致；actor、grant、team 均在原生 RR 事务内重验。写入与 before/after/result 同事务；actor+requestId 唯一并绑定 canonical action/payload hash；跨内容 UUID replay 被拒绝。没有读取旧 mall ledger 或兼容旧 frontend 身份的路径。
- 更新 published 记录必须先明确 offshelf；单行 revision 锁、团队真实行锁与 SQL revision 终门存在。批量对所有目标 role/scope 预检后才写；状态/revision 失败逐项，SQL失败不被 per-row catch 吞掉。import 按真实 ID/revision 更新、先 draft，越权/跨团队错误抛出并使事务 rollback。
- 后端 exact decimal 使用 bigint 微单位比较，正价不递增、数量/梯度递增、MOQ/SPQ 正整数与现货货期一致性均有终门；MOQ可不是SPQ倍数、tier threshold不是购买量。公开保留 null/未知税及完整真实 tiers，不伪造 purchase资格。
- suggest 只查询当前官方 scope 的 partNumber/brand/pkg，及 enabled 后台 `materials` 产品资料的 partNumber/brand/package；只输出三字段。选 metadata 不改价格、库存、批次、客户、notes；没有前台或渠道库存查询。其跨作用域缓存风险见 P1-1，不是服务端来源越界。
- 公开严格 join materialId/publicId/currentRevision/published；输出 whitelist 无团队/员工/notes/import。front service 固定 HTTPS URL、GET `{json:input}` / `result.data.json` 的实际 superjson协议，无 plain fallback，无 cookies/secret/redirect，5 秒与 1MiB 限制，schema whitelist，无 stale fallback。front新目录完整真实报价，只邮件询价，不触发库存/cart/order mutation，不把 OM id 改造成库存ID。SearchPage selfOnly 只挂新目录，普通旧页面规则原字节保持。
- 实际 API baseline 声明顺序检查：admin factory 注册位于 appRouter 前（baseline line 18675）；router/adminProcedure/publicProcedure、getDb、实际原表及官方access函数都已初始化。front factory只需先已初始化的 router/publicProcedure。未运行原 bundle。
- API候选 admin/front 两组 delta 均在内存反向复原为 baseline **完全相同字节**。变更只有新 runtime import/factory/root、retire后台旧 mallInventory forwarding property、front旧 self marker返回 FALSE；旧 gate/linked及其他订单ERP未改。
- 后台 static真实候选同 root 的 React c / jsx a / trpc me / Auth ct / Layout Go桥接；App的旧 Qt替换为 native PermissionGate + lazy native leaf；没有重复 Provider或BusinessScope。商城 location关闭business.navigation query/display，菜单改官方 native grant + hasNativeAdminAccount。entry/nav增量均反向还原为 baseline完全相同字节；全部冻结源哈希和内容命名 asset hash通过只读复核。
- 已读取 `/tmp/official-mall-native-ui-tests.log`：27 DOM +49 parser =76 passed。未重跑。已有后端final33及front46+4 pass为父任务提供冻结结果，本审核仅阅读其相关源码/用例，不把mock离线测试写成生产验证。

## 次要建议（非独立阻断）

导入 UI 的 skipped/success 单行归类依据 preview 的 duplicates，而非本次提交的 authoritative result（`MallMaterials.tsx:162`）。preview后其它有权员工改变重复身份，默认 skip 可在服务器实际跳过而UI标 success，反之亦然；合计notice是真实，行级标签不是。最小改善是服务/ledger result输出只含 rowNumber + outcome 的安全行级结果（前端不能按preview推断），或先显示“本批已完成”而不猜各行归类。当前 done 行都不再次提交，所以此项单独不导致重复写。

## 本轮冻结锚点与待闭合项

已审核 `native/manifest.json`：admin runtime `da0e06add5bce907ceba3f3b720bebe0369b198c70d62e3d6047f64e26bb8b44`；front runtime `759959d8c853b70aef02457dea86e40c5d8aaeee6ec1ab304b88d3bd9f751227`；legacy self-only runtime `cf346917f6739fcc7cf6d0170fbf515b4222548d1c07407126218b1272729733`。API candidate SHA256：admin `aa522c214d1ad8b37e55fe602136312960b69c5f69dc8a7f45004ade491a702d`，front `827deb8bbd78d35d05868cf5e296934cc01ca251c95a0c56df09e303a6d5154c`。

已审核 `static-admin/manifest.json`：native leaf `3c49c12b3325d91e866ab1c84c70d3835e1d0d6e2aca3b2fd5c2117d88e0cafa`；nav `774f7ad94fcba57279d0f0926ec516bacf86b6034cbf1c95445cf31f3d67985e`；entry `d02f784d842461e6399a78bf6339b183135130531b1cfcd54ef3cb622bb3abda`；CSS `8da2d002881676a1e6eeeffd4ed3f1faceb8f9728e1711e026a6797690da8d12`。

父任务已说明还会修低 target MapIterator并重build native。新hash及本报告P1修复必须再次只读核对源+实际候选hunks；此时尚未收到前台static/compiler最终freeze与原release.py局部三空表controller，**不将未提供产物判成缺陷，也不作发布controller放行结论**。后续仅在同一审核角色补充闭合，不需要再建审核角色或做真实商品上架／订单写测。
