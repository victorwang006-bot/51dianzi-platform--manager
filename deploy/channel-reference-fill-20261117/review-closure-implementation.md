# 两处 P1 最小关闭：源码、受影响回归与真实静态候选

**状态：`PASS_OFFLINE_SOURCE_AND_STATIC_CLOSURE`。** P1-01、P1-02 的最小源码修复、受影响测试与真实静态四节点候选已完成。**未编译 runtime、未重写 runtime source-lock，不能将旧 service 产物称为已修复；父须等待并行 brand/finaldata 完成后统一冻结源码、构建一次 runtime 并执行最终数据检查。**

日期：2026-11-17。源码根目录 `/home/ubuntu/work/51dianzi-platform--manager`，证据目录 `/home/ubuntu/work/channel-reference-fill-20261117`。本报告是 `software-review.md` 两处 P1 的实施闭环，不覆盖型号事实、最终数据或生产发布审核。

## 1. 本次边界与实际变更

全程未使用 browser、SSH、生产、网络或 Git；未重新研究型号，未重跑 1209 通用测试，未执行 worker、producer、默认 loader、整站构建或 runtime 构建。没有修改数据、厂牌规则、入库、通知、商城、当前页授权或账号错误清理代码。并行 reducer 的 shared brand 与数据工作不由本任务冻结或验证。

应用生产源码只改两行：

1. `server/channelReference/snapshot.ts`：在最后的 stock await 之后、返回来源选择之前，读取 binding 时增加 revision 门禁。
2. 内嵌 `client/src/business/platform/client/src/pages/ChannelInventoryHost.referenceRefresh.ts`：旧成功保留条件由当前来源 `status !== "ok"` 收紧为 `status === "pending"`。

新增回归只在 `identityBindings.test.ts` 与内嵌 `ChannelInventoryHost.referenceRefresh.test.ts`。既有 `stockEvidence.test.ts` 原字节不变但受影响范围重新运行；Cell/model/七项 Cell DOM 测试源码原样复用。本任务没有再次改 Cell 或 model 的生产源码。

静态构建仍使用现有 `static-build/build-channel-cell.mjs` 与 `check-channel-cell.mjs`，只增加唯一 `keepSuccessfulReferences → h2` 精确 AST 函数替换及对应 fixture/证据，不引入第二套整站框架。

## 2. P1-01：最后 await 后 binding 不复活

修改后的唯一来源选择行：

```ts
const stored = current.get(key), binding = revision === lookupRevision ? bindings.get(key) : undefined;
```

该行位于最后 `await readStockEvidence()` 之后。在同一 singleton 的更新 lookup 已开始并看到 mapping 删除、损坏或 stale 后，旧 lookup 的局部 binding 不再授权 canonical 选择。旧 lookup 仍返回自己的原 raw quote/status clone，不把 stock proof 贴回失效 canonical。

原 snapshot validator、价格字符串、tiers、fetchedAt、raw 原成功优先、binding 接纳时 revision、stock 接纳/返回 revision 与 clone 逻辑均未变。`review-closure-verify.py` 对修复前备份作完整字符串等式检查：整个 `snapshot.ts` 恰好只有这一处条件变更。

### 组合交错回归（3 个实例）

`identityBindings.test.ts` 新增参数化 `deleted / corrupt / stale`：

- 同一 fixture 包含 raw negative → canonical 的合法有限 binding，canonical 原价成功且 stock 为 null；另含原 raw 成功、stock 为 null 的行。
- 先通过独立正对照证明该 fixture 的 canonical 选择和两份 stock proof 均确实可被当前真实服务接纳，库存均可补为 7。
- A 接纳 mapping 后停在 stock 读取 Promise；测试等到 `readStockEvidence` 确实被调用才启动 B。
- B 看到 mapping 的 null / 非法 JSON / 完整 snapshot SHA stale，并完成返回原 raw 状态。
- A 随后取得同一合法 stock sidecar；必须返回原 raw negative，另一原 raw 成功价保持原 quote、tiers/time，两个库存证明均不能复活。原 document 不变，修改返回 clone 的 tier 不影响后续读取。

这覆盖了审核指出的“已接纳 mapping → 等待 stock → 更新 mapping 失效 → 旧 A 返回”的组合窗口，而非仅延迟 mapping 自己的旧用例。

## 3. P1-02：只为来源 pending 保留旧成功

修改后的唯一合并条件：

```ts
if (old.references[source].status === "ok" && channelReferenceHasPrice(old.references[source])
  && row.references[source].status === "pending") references[source] = old.references[source];
```

最小行为保留原 pending 用例，不要求新增 sourceAllowed/厂牌规则，也不把全局 loading 或其他来源 queued/running 推断成该来源 pending。合法最终 `not_found / ambiguous / price_unavailable / access_restricted / unavailable` 原样使用最新服务 quote，不能以旧 canonical 成功及旧 stock/date/url 覆盖。

原 213 成功价格的保护仍由服务 snapshot 的 raw 成功优先及数据聚合负责，UI 不自己猜厂牌或将明确失败伪装为排队。`channelReferenceProgress`、`startChannelReferenceRefresh` 的 lookup/onError、取消、90 秒截止、当前页/账号有效性及 Host 清理连接未修改。

### 受影响 Host 回归

原 pending 保留用例继续通过；新增五种同页服务 raw negative 用例，其 previousItems 为 canonical mapped 成功并含独立库存字段。即使 incoming 带全局 loading 与另一 source queued，`onData` 也必须等于最新 incoming、无旧库存字段，不能复活旧 quote。

另覆盖双行倒序、逐 materialId 与 source 保留、transport reject 只进入 `onError` 且不重发旧成功、foreign-page 与非法 stock 扩展只走 binding error。既有切页/身份变化后的晚到错误/成功拒绝用例与计时器清理继续通过。

## 4. 原候选归档与唯一真实静态前映像

在任何重建前，原三节点候选和证据共 23 个文件已原字节复制到 `static-build/pre-review/`；`pre-review/archive-index.json` 记录文件名、bytes、SHA。独立核验确认所有归档文件仍相同。归档 manifest/delta 内的原绝对路径是历史证据，不重写；读取旧证据应使用归档实体文件。最新结果使用顶层 `static-build/manifest.json` 与本报告，不混用归档候选。

唯一输入仍为父已证实于 15:15 上线的 inbound 附件候选；本任务只读取本地文件，未再访问公网：

| 输入 | SHA-256 |
|---|---|
| `/home/ubuntu/work/inbound-documents-20261117/static-build/manifest.json` | `3079185c26c725975ad34c3a3997d72d49a6c1b409411cb8ab25fb158c305679` |
| 前映像 HTML | `8272d35a4b56f7b0013027a1a820b9201628f8f753b00ae5774d629a731f4d2a` |
| 前映像模块 A | `3244a3a5171146ec0a603ab38c7301e84d578d648b3c2b555ca2c7e80a10fabd` |
| 前映像模块 B | `55db880a65b331f0f4e6531483faffedba8a7db95c93dcdecff93931e85d0c95` |

每份模块恰好四个 target：`ChannelReferenceCell/bi`、`isQuote/Ov`、既有新日期 helper `validDate/__crValidDate_v1`、`keepSuccessfulReferences/h2`。`changedOnly.compiledTargetCount=4`，不再 claim 三节点。新增 h2 由当前真实 referenceRefresh 源函数单独 transpile，函数名及 `channelReferenceHasPrice/hs` 来自原 factory AST，同一 lexical singleton 桥；不改 `Il` 调用。

| 模块 | 原函数数 | 新函数数 | 非目标原函数逐字节相同 |
|---|---:|---:|---:|
| A，原 3244… | 5403 | 5404 | 5398 |
| B，原 55db… | 5941 | 5942 | 5936 |

计数严格 pin 原前映像。唯一新增函数仍为日期 helper；h2 是替换，不新增函数。仅目标及包含目标的两个祖先函数不计入逐函数 immutable 断言；其他函数，包括渠道 factory 内实际 `Il`、入库、通知、商城及导航，保持原字节。两份 `Il` SHA 均为 `bd103e4c0d0ab935b69a720bc72d7f661552b04a9dcbc430287c7a63862cd216`。

独立核验还将新的四节点 delta 与归档原三节点 delta 对照，确认 **Cell、isQuote、日期 helper 的 before/after 字节完全相同**；本次静态候选相对原候选的函数语义增量只有 h2。两份模块正向仅重放四个 patch 可精确得到新模块，inverse 精确恢复原 inbound 模块；HTML 仅必要 importmap/scopes 改动，其他字节不变，inbound CSS 原样继承。

## 5. 当前交付与 hash

当前 manifest：`/home/ubuntu/work/channel-reference-fill-20261117/static-build/manifest.json`，状态 `PASS_OFFLINE_CANDIDATE`。

| 最新产物（相对 static-build） | SHA-256 |
|---|---|
| `manifest.json` | `f98b6e6904ba51700e971cd43e5073024125f4034869dc52547aeaf8becdedb0` |
| `index.html` | `f95e5cd8e1bd306adcb19724c40dcbd48787aafc4551f29b9258d5cb5edde94f` |
| `BusinessWorkbenchPage-channel-stock-dates-9c15e1ec3a11e508.js` | `9c15e1ec3a11e50857a4dba30d0420a025d4dd07408f6e676a125b3957b88179` |
| `BusinessWorkbenchPage-channel-stock-dates-0683ec2e22d502bb.js` | `0683ec2e22d502bbd173b7ac764d55051d36baba74881803713573280089c275` |
| `delta.json` | `f6e6caaff834b73afb949c860020a2a785a3ecd073069b5f1a65ac0566023ea4` |
| `inverse.json` | `505ca8feafbca789b2e33e7c7eb382f1bf87e149d23924fd3abdf928cda185df` |
| `test-results.json` | `288a6bc70e5a703b319db20c0135bc3472768888b00d30065268c9b4d6b23643` |
| `build-channel-cell.mjs` | `a46ebc01afd5794b54ddc228dcf540d957354286848375a0094965c324e72586` |
| `check-channel-cell.mjs` | `ced34def478dfd1d84f31e990ed2c2bc5039a7ce9f4a66742d1a516486374535` |

核心 source hash（源码根目录相对路径；完整 source/input/hash 在 manifest 与 `review-closure-evidence.json`）：

| 源文件 | SHA-256 |
|---|---|
| `server/channelReference/snapshot.ts` | `b265bfbb1c5ec913894559f70b3159b98911a3f506c86e4a93573eee5e59ca29` |
| `server/channelReference/identityBindings.test.ts` | `775e04b5de76fb8036f8b88b5c81e908b2981fcb074a32519ec46fbbbcaa2f60` |
| 内嵌 `ChannelInventoryHost.referenceRefresh.ts` | `c5db88b0d1035bc135346f183e4745e0286865d6f33db2c34dfa1b1b02862cf9` |
| 内嵌 `ChannelInventoryHost.referenceRefresh.test.ts` | `2c78ddbd743250d68fe6ec098110b25f0b4f9a90f48fedcd3caf410ef7eb6fcc` |
| 内嵌 `ChannelReferenceCell.tsx` | `ef5ae28f869be1457ab9ba1dcf21ed1a69265453c6a5fe61a9d6407dc448ba6e` |
| 内嵌 `channelReferenceModel.ts` | `aca8739c3711d2d3c99238e8d508f9b90bae76d87ee3eed9e986472bc8c0fe47` |

## 6. Exact checks 与真实回执

### 源测试：3 文件，66 PASS

在源码根目录执行：

```sh
pnpm exec vitest run server/channelReference/identityBindings.test.ts \
  server/channelReference/stockEvidence.test.ts \
  client/src/business/platform/client/src/pages/ChannelInventoryHost.referenceRefresh.test.ts
```

真实结果：identity **24 PASS**；stock **8 PASS**；referenceRefresh **34 PASS**。日志 `review-closure-source-test.log`。只运行受影响文件，未运行 1209 套件。

```sh
pnpm exec vitest run client/src/business/platform/client/src/pages/ChannelReferenceCell.stockDates.test.ts
```

真实结果：**7 PASS**，日志 `static-build/source-dom-test.log`。Popover mock 仅属于离线测试，不进入资产。

### 同一静态 checker：24 PASS

在 `static-build/` 执行 `node build-channel-cell.mjs`、`node check-channel-cell.mjs`。构建只从上述唯一 inbound 输入重放四目标；checker 在同一既有 VM/React/jsdom 框架执行真实 emitted 函数。

原 20 项检查全部复用，类型检查扩至必要 referenceRefresh：

| 检查组 | 实例数 | 结果 |
|---|---:|---|
| 唯一 inbound 前映像 / HTML inverse / 仅受影响映射 / 原 header、通知、独立商城 | 1 | PASS |
| 两模块实际 `isQuote` 与严格 UTC helper / 旧响应 / zero / 非法独立库存字段 | 2 | PASS |
| 两模块实际 Cell：价格库存日期分离、旧日期回退、unknown、zero、非法日期安全、手填优先、unsafe URL/string | 14 | PASS |
| 两模块原 strict source/manufacturer/non-ok/正价 gate 与手填 zero | 2 | PASS |
| Cell/model/referenceRefresh 三个必要源文件 TypeScript syntactic + semantic diagnostics，无 error；非整站 check | 1 | PASS |

新增真实 compiled h2 检查，每模块两项，共四项：

1. **`h2 + 原保留 Bv` pending/行绑定**：双行倒序与两 source，只有精确 materialId/partNumber/brand/source 的 pending 可保持其原成功；无成功的来源继续 pending，不串行，不串源，不改 incoming。
2. **`h2` 明确 negative 不复活**：五种合法 clean raw negative 逐一替换旧 mapped 成功，移除 stock/date/url；全局 loading/另一 source queued 不扩大保留。实际原 h2 对同一 fixture 会重新选旧 canonical，真实新 h2 不会。随后用真实新 Cell 渲染最新 negative quote 输入，保持既有“暂未匹配”占位、无旧价格库存/采集日期/库存链接；不新增负状态 UI 文案或品牌推断。原保留 `Bv` 拒绝 foreign materialId/错 source，h2 拒绝前后 outer brand 不一致的旧成功。

逐模块 inverse、四 target 及函数计数、原 `Il` 与原 React/JSX/Popover singleton/helper 字节校验均与这些 fixture 同一入口执行。结果写入 `static-build/test-results.json` 与当前 manifest。

### 独立 evidence verifier：8 PASS

执行 `python3 review-closure-verify.py`，回执 `review-closure-verify.log`，完整证据 `review-closure-evidence.json`：

1. 两个生产源文件恰好两处单条件变化，其他全部原字节相同。
2. stock 测试源码原样，仅复用受影响套件。
3. 当前静态 manifest/source/input/script SHA 全相同，compiled target 数严格为 4。
4. 唯一 inbound manifest/HTML 前映像 hash pin 相同。
5. 原 pre-review 23 个文件 hash/bytes 全相同。
6. 两模块仅四个 patch 节点及 exact inverse；原三目标编译字节不变；计数与原 Il 证明一致。
7. 当前 HTML、两个 JS、继承 CSS 均匹配 manifest。
8. 旧 runtime service/worker/source-lock 仍为审核报告原 hash，未重建或冻结。

独立 verifier 按 JS/TypeScript UTF-16 源坐标重放并最终对 UTF-8 真实文件字节等式断言；不将 Python code-point 坐标当成 patch 坐标。

## 7. Runtime 与后续父工作

本次结束时旧 runtime 仍为：service `a47e324f5ef6978ddb4305ca6abff701fbde68a26c0796a608a812165372b553`；worker `b98ee88584bc240c0a9df06983577cb38d1504e689a656d817b6a08ef06c1e42`；source-lock `7787fd020431374ba0996df9d8dc726bb9b455121d4350a718b6917f444dc2ca`。这些 hash 与审核报告一致，**只是未改写证明，不是修复产物或当前冻结证明**。

父应在并行 brand/finaldata 完成后统一冻结当前源码并执行原窄 runtime 构建一次；最终 snapshot/两个 sidecar 的完整 SHA 与旧 quote SHA 由父/数据 reducer 重生成及检查。不能复用旧 service 声称 P1-01 已关闭，不能把本报告当作 finaldata 或生产验证。本任务未 stage、未发布，也未代父再次确认生产前映像。

本交付的有效范围是：两处 P1 在当前源码与离线受影响回归中已最小关闭，真实静态候选包含 h2 修复且与唯一 inbound 前映像保持严格四节点边界；runtime/finaldata/最终生产发布仍明确待父完成。
