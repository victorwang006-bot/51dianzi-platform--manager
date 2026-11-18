# 库存来源只读修复：离线构建与定向验收

仅这五个工具文件属于本交付。工具不会修改应用源码或 Git，不会上传、发布、连接真实数据库、调用网络或浏览器。旧源码默认通过 `git show HEAD:<固定路径>` **只读**获取；当前源码来自 fixrepo 中已冻结的 manager front-router-types 镜像。也可用 `--old-root` 提供不需要 Git 的已审阅 HEAD 快照。

全部候选、原生片段、逆补丁及报告写到私有目录 `/home/ubuntu/diagnosis/inventory-source-candidate`，不写入公开仓库。产物路径限制在此根目录内。

## 运行

在 `/home/ubuntu/diagnosis/fixrepo` 中：

```bash
node deploy/inventory-source-read-20261118/build-api.mjs
node deploy/inventory-source-read-20261118/check-api.mjs
node deploy/inventory-source-read-20261118/build-ui.cjs
node deploy/inventory-source-read-20261118/check-ui.cjs \
  --latest-html /home/ubuntu/diagnosis/inventory-baseline/index.html
```

`build-api.mjs` 的默认 API 前像是 `/home/ubuntu/diagnosis/baseline/front-index.js`，其 SHA-256 必须为：

```text
41934b73fb135a4e49b4179f8596c3ec39f9d33de680bd8584455c6967ee0f58
```

`build-ui.cjs` 的默认 stage2 前像为 `/home/ubuntu/diagnosis/inventory-baseline`，不是 stage1 之前的 `/home/ubuntu/diagnosis/baseline`。默认 HTML SHA-256：

```text
9921b0dee2b2e6b9ef331ae80143ddfaea146935a49dc9ee6ee5eceae9316b6f
```

默认两份 stage1 资产完整 SHA-256：

```text
e579c5cb94dded57f52dfcc324cc732651b36d36040f7e62b46b97cc3c38219b
8a77d44db99db37ff9fc89617a4a7750b86b1540678f4d2b0c5e261cd791fd4d
```

若其他任务先更新 API 或静态资产，先由主任务重新捕获并审阅最新前像，再显式传入新哈希。工具不从文件自动推断新锁，也不自动覆盖旧锁：

```bash
node deploy/inventory-source-read-20261118/build-api.mjs \
  --baseline /absolute/reviewed/latest/front-index.js \
  --baseline-sha256 REVIEWED_FULL_SHA256 \
  --out /home/ubuntu/diagnosis/inventory-source-candidate/api-rebased
node deploy/inventory-source-read-20261118/check-api.mjs \
  --out /home/ubuntu/diagnosis/inventory-source-candidate/api-rebased

node deploy/inventory-source-read-20261118/build-ui.cjs \
  --baseline /absolute/reviewed/latest-static-capture \
  --html-sha256 REVIEWED_FULL_HTML_SHA256 \
  --asset-sha256s FIRST_REVIEWED_FULL_SHA256,SECOND_REVIEWED_FULL_SHA256 \
  --out /home/ubuntu/diagnosis/inventory-source-candidate/ui-rebased
node deploy/inventory-source-read-20261118/check-ui.cjs \
  --out /home/ubuntu/diagnosis/inventory-source-candidate/ui-rebased \
  --latest-html /absolute/newly-captured/latest/index.html
```

两个 builder 还支持 `--repo`（仅用于读取 HEAD）、`--old-root` 与 `--source-root`。这些目录必须保留固定相对源码路径。`--out` 必须是上述私有产物根目录的子目录。API 更新若改变实际受限节点数量/别名/语义，构建失败并要求单独审阅适配，不能整函数兜底。

## API 原生增量边界

只插入源码中的 `teamMaterialSourceReadEligibility`、`teamMaterialSourceReadProjection`，并改动三个固定读方法：`listTeamMaterials`、`getTeamMaterialSource`、`listTeamSourceOptions`。新 helper 单独 TS transpile，SQL 使用现有 `sql82`，签名 proof schema 使用现有 `officialInventoryPermissionsSchema`，channel-current read 使用现有 `continued20261112_channelSourceReadEligibility`。方法继续使用原生 `sql87`/`TRPCError71` 等 ABI，不复制 Drizzle、Zod 或 tRPC realm。

Getter/options 使用 manager HEAD 到冻结源码的 AST 差分，绑定到 actual native 的改变节点。`listTeamMaterials` 因实际 production 有额外 current-channel 分支、customerId 绑定筛选、manual-reference 与 publication 逻辑，采用显式 actual scoped-slot adapter：六处 read callee、只读 DTO local、两个 read RHS、CRM identity guard 和 write spread 后新增 read spread。**不整方法重打印，不删除 production 的额外逻辑。**

这些函数原始文本逐字保留并在验收中哈希核验：

- `teamMaterialSourceEligibility`（共享/写路径）
- `teamMaterialManagementEligibility`
- `materialManagementProjection`（写资格投影）
- `continued20261112_channelSourceReadEligibility`
- `teamMaterialFrom`
- `channelCustomerMaterialReadGate`

所有 hunk 必须位于新增 helper 插入点或三个固定读方法。其余 bundle 字节逐区间相等。每个 hunk 含原像/新像 Base64、字节坐标与哈希，逆序还原必须精确等于前像。

验收只提取固定函数进入无 IO 的 VM，与 mock SQL/mock DB 搭配。mock DB 仅接受 SELECT；不初始化真实 bundle，不动态执行实际整个 API，不连接真实 DB。覆盖 readonly source getter/list/options、CRM denial 禁止 channel fallback、显式历史未关联来源、上下文/可见性拒绝、无写资格变化及 proof SQL fence。**这些是控制流和 SQL 文本验证，不是实际 SQL 引擎/ERP 当前成员事实的集成验证。**

## UI 原生增量边界

现网没有独立库存 Host 资产；不依赖空的 `inventory-hosts.json`。直接读取 `active-workbenches.json` 两份 BusinessWorkbenchPage 资产，使用 TS AST 解码的 `string.text` 定位 `客户不可查看` helper，而不是以 literal grep 匹配 Unicode 逃逸源码。

确认 label 位于现有 `__CHANNEL_REFERENCE_HOST_EXPORTS` capsule、`__CW_CUSTOMER_GET` 使用该 capsule。每份资产恰好四个 hunk：新增 source-access 纯 helper、替换 source-label 纯 helper、Host source component 的 `contextVerified` 从 edit/write local 改为原生 `columnsContextVerified && sourceContextVerified` 对应的两个 operand、源码中一处误导 disabledReason 字面量。现有 edit helper、edit binding、source component 和 React ABI 原字节不变。未改 customer view 的其他文案或上下文。

新资产名包含自身 SHA-256 前 16 位。HTML 只把 stage1 最新前像中的旧资产路径逐次替换为新路径；这份冻结 HTML 有 85 个路径映射 hunk，其余字节精确保留。真正 apply 前，主任务必须重新读取 live latest HTML 并检查它等于 manifest 的 `latestHtmlCAS`。新 immutable 资产先上传，后对最新 HTML 做 CAS；CAS 不符必须重新捕获/审阅/rebuild，禁止把旧 HTML 重放。工具本身没有 apply/upload 操作。

UI check 使用固定实际 pure helpers 与原有 source component，在 mock element factory 中执行；每份资产 14 组断言。没有重新编译 shared、React 或 provider，没有浏览器/DOM 验收。

## 本次离线验收结果

API：17 个 native hunks，7 次 mock SELECT，exact inverse 与所有 untouched-byte 区间检查通过。候选 SHA-256：

```text
8fcdd4f8506f9ec72c59906b4c953edf9e672ff0f169397527913fdbbf319497
```

UI：每份 4 个 native hunks，14 组定向断言；exact inverse、原有 edit gate、edit binding、source component 均通过。候选 SHA-256：

```text
590bd5b997e31a090f00dc3e99fa7ea8b645cacb4a34f2c928aadabf3f7d92b7
64fbe16f1df802a0aff03df729dae0710a265ce4fd94287e0b7406656044b769
```

组合后的 HTML SHA-256：

```text
6bc906475e60fac2d397849469e29f333c6a916acf27262a6b75686a60c45cb7
```

私有当前产物：`api/front-index.js`、`api/manifest.json`、`api/check.json`；`ui/assets/BusinessWorkbenchPage-inventory-source-read-590bd5b997e31a09.js`、`ui/assets/BusinessWorkbenchPage-inventory-source-read-64fbe16f1df802a0.js`、`ui/index.html`、`ui/active-workbenches.json`、`ui/manifest.json`、`ui/check.json`。此前试构建的旧 hash 资产可能仍在私有 ui/assets 目录；**仅 manifest/active-workbenches 中的两个文件是最终 intended assets**，不要上传目录全量。

## 主任务后续发布与验收（2026-11-18）

上文“五个工具”及其候选哈希描述原始离线工具子阶段，不是最终线上版本。主任务随后新增 `release.py`、`hydrate.py`、`health-readonly.cjs`、`test-release.py`，使用更新的统计前像重新构建并于 17:45 发布。

最终 API 前像为 `fbe745adcd6927b41dd953ddf22b6e6a1bc85ec9a611c21210bd9205ae5cb0cf`，限定 17 个读取节点增量后的线上版本为 `00fc0697ba47fb9e547137795619c2d3c2a5caf2c31b0150c156d247332ae6b0`。HTML 前像为 `27be3cffd7f400469902c8da16c8b83d495cfc2736f2f49481c6cf89555df37f`，限定工作台映射后的版本为 `490acea37ec380048e289eb1ab5f29558b5aee2222f735f595cdad285559066f`。两份 JS 资产仍为上文 `590bd...` 与 `64fbe...`；它们只对客户补全模块增加四处库存来源节点，保留补全修复。

载入器只在私有非活动目录从已核验前像重建静态候选。控制器使用两个发布锁、完整字节 CAS、131 个旧文件保护指纹和 12 个进程前像；只滚动四个 `dianzi51` 前台 API 实例，后台 API 和其他 worker 不动。新增旧资料从不补造，数据库写入为零。控制器精确恢复成功前像、健康、保护文件及非目标进程后才能报 `rolled-back`；恢复失败或第三方 CAS 漂移时保留 `recovery-required` 阻塞窗口，不覆盖第三方版本。

现网 loopback tRPC 需要既有服务端传输认证。`health-readonly.cjs` 只通过原服务凭据 GET 既有健康端点，凭据仅在内存，日志只有 HTTP 状态/布尔结果，无浏览器 cookie、会话或普通 ERP context。不得为健康验证关掉认证或请求普通 context。

最终控制器十项合成安全测试通过；最终原生 API/UI 定向验收、线上预检、四实例滚动和 HTTPS 入口/两个资产完整 SHA 校验通过。统计任务的两个个人摘要通过其原授权只读探针回归，均 HTTP 200、`available`，业务记录前后未变。私人财务、业务真实 ID/联系方式、实际保护清单及发布载荷留在仓库外，没有提交到公开源码仓库。

工具默认从 Git HEAD 获取旧源，因此在修复提交之后复建旧增量，必须显式提供修复前源码快照 `--old-root`，不能把新源 HEAD 当旧源。此轮四个相关源码前像已固定在修复前提交 `3b0cf7b0c019acf40443a9c35d931e444489192e`；可只导出 `channelInventorySource.ts`、`channelTeamInventory.ts`、`channelInventoryColumns.ts`、`ChannelInventoryHost.tsx` 的对应固定相对路径，保留现有目录结构。任何后续 API、HTML、源节点或 ABI 变化必须重新捕获和审阅明确前像后重建，禁止复用旧包重放。
