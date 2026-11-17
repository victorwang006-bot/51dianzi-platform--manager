# 当前渠道参考独立 runtime 构建与离线默认 loader 检查

## 结论与交付范围

已完成一次当前源码的独立 code build，产物在 `runtime-build/runtime/` 同一目录，只有标准 service 与所需 sibling worker。后续云汉复核改变数据时，**不需要重编代码**；父代理重新生成最终 snapshot/sidecar 后，使用现有 checker 做数据哈希与真正固定 sibling 默认读取检查即可。

本任务没有修改应用源码、应用 JSON、Cell、model、MainAPI 或 adminAPI，没有生产、SSH、浏览器、Git、登录资料读取或外站请求，没有执行 worker/原 PM2，没有安装/启用 manual config 或缓存。未重跑已通过的全 1209 渠道测试。应用 snapshot 的只读核对仍为采集 baseline SHA：`a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436`。

可复用入口为 [build-runtime.cjs](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/build-runtime.cjs)。发布所需两个文件是 [channel-reference-service.mjs](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/runtime/channel-reference-service.mjs) 和 [channel-reference-worker.mjs](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/runtime/channel-reference-worker.mjs)。完整元数据见 [manifest.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/manifest.json)，源与编译器精确冻结见 [runtime-source-lock.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/runtime-source-lock.json) 和 [source-freeze-proof.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/source-freeze-proof.json)。

## 实际完整依赖图与编译契约

先用当前 `server/channelReference/service.ts` 和 `worker.ts` 做 esbuild metafile 图发现，再冻结精确文件集和字节 SHA。没有从整 MainAPI、应用 index 或业务包开始编译，也没有从源码中截取函数来替代默认 service。

| 独立图 | 实际加载文件数 | 图 SHA-256 |
|---|---:|---|
| service | 16 | `516ec279cf35d3145474765e7fc866b21764467f66eb35628709980027f94831` |
| worker | 9 | `82096bceeeb9fa5fd40dc447cedb985d94f2947bfdf146d39ed821a3424a03e3` |

图 SHA 是按路径排序的 `sourceHashes` 对象，以两空格 JSON 加结尾 LF 序列化后的 SHA，不混称为 metafile SHA。发现与实际编译图分别保存为 `service.discovered-metafile.json` / `service.metafile.json`、`worker.discovered-metafile.json` / `worker.metafile.json`；每次构建均验证精确 inputs 和 exact external builtins，不允许新增、遗漏或未使用的 pin。

service 图为以下逐文件名单，没有通配 owner 授权：

```text
server/channelReference/browserPage.ts
server/channelReference/ickeyPage.ts
server/channelReference/identityBindings.ts
server/channelReference/lcscPage.ts
server/channelReference/lcscSearchPage.ts
server/channelReference/manualRefresh.ts
server/channelReference/manualRefreshConfig.ts
server/channelReference/nativeWorker.ts
server/channelReference/publicPage.ts
server/channelReference/quoteValidation.ts
server/channelReference/referenceStore.ts
server/channelReference/requestPacing.ts
server/channelReference/service.ts
server/channelReference/snapshot.ts
server/channelReference/worker.ts
shared/channelReferenceBrand.ts
```

worker 图为 service 图中的 `browserPage.ts`、`ickeyPage.ts`、`lcscPage.ts`、`lcscSearchPage.ts`、`publicPage.ts`、`quoteValidation.ts`、`requestPacing.ts`、`worker.ts` 与 `shared/channelReferenceBrand.ts`。另冻结 `shared/channelReference.ts` 和 `shared/channelReferenceRefresh.ts` 两个被 esbuild 擦除的 type-only 依赖；因此 eligible/sourceHashes 共 **18** 个文件，不把这两个文件虚报为实际 metafile inputs。

调用未修改的成熟 `runtime-scoped.cjs` 中原 `compileRuntime`，契约仍为：

```text
contractVersion: channel-remediation-disabled-runtime-build-v1
mode: manual-default-disabled
serviceEntry: server/channelReference/service.ts
workerEntry: server/channelReference/worker.ts
workerBasename: channel-reference-worker.mjs
effectiveServiceExport: lookupChannelReferences
configProvisioned/cacheProvisioned/activeProducerAccepted: false
```

旧 `source-contract.cjs` 仅对新增 `identityBindings.ts` 不 eligible，本地 wrapper 在私有 CommonJS 加载器中为 eligibility 提供上面的严格逐文件 Set。原 release 工具、源契约、scoped core 均未改动、未改 `require.cache`。原编译器的默认真实 source binding、全 entry 编译、exact graph pin、原编译前后字节核对全部保留。manifest 的 `sourceDefaultBinding` 同时保留 `fullActualEntryCompiled:true` 并明确 `fullActualCompiled:true`，没有 synthetic 默认 service 替代。

每个 source 的 import/export/动态 import/require 同时静态检查；非字面或非内置 package/alias 拒绝，相对 import 只允许固定 eligible 文件。没有编入 ENV、DB、应用 index、权限或 MainAPI 业务函数。所有输入/输出模块 imports 逐项核验：外部模块只能来自以下 Node 内置逐字名单，不接受第三方包，裸 `fs` 等未批准写法也不接受：

```text
node:child_process
node:crypto
node:dns/promises
node:fs
node:fs/promises
node:http
node:https
node:net
node:os
node:path
node:url
```

worker 外部名单为上述名单去掉 `node:fs`。这些模块对应原有 reference producer 能力的**编译依赖**，不代表已执行/启用 producer。尤其新 snapshot/identity 用到的 `node:fs`、`node:fs/promises`、`node:crypto` 已准确纳入 service 图。

## 工具冻结与产物哈希

锁定 esbuild **0.25.10**、TypeScript **5.9.3**、实际 `@esbuild/linux-arm64` package 与本机 executable，编译 target 为 `node22`，检查运行环境为 Node **v22.23.4**。共 12 个工具/编译上下文文件被精确 pin，包括 compiler package.json/main、原 runtime/source-contract/scoped-core、项目 package.json、pnpm-lock.yaml、tsconfig.json。项目这些文件仅作只读编译上下文冻结，绝不捆绑到 runtime。拒绝 `ESBUILD_BINARY_PATH` 未冻结替代。

最终 source lock SHA：

`7787fd020431374ba0996df9d8dc726bb9b455121d4350a718b6917f444dc2ca`

关键源 SHA 如下；全部 18 项在 source lock 和 freeze proof 中逐路径保存，并在构建及离线检查后复核未漂移。

| 源文件 | SHA-256 |
|---|---|
| `server/channelReference/service.ts` | `9cb5b05302922a757d541a310cece1cd741f5b88ea4319a7ada2ad3845ec7def` |
| `server/channelReference/worker.ts` | `9172503e24d51759609e5bbb6df296fcc92d11c1ede2408ae3bb1b4d50680b2b` |
| `server/channelReference/snapshot.ts` | `cfe3bdf08304215ee3c668fc55254a65d365041c0b57a61c1fb58941809ac783` |
| `server/channelReference/identityBindings.ts` | `3dd91189b8582d9e8c6228fc737bd30d0519103beaf25fc428e6cf858729cba8` |

| 构建产物 | 大小（字节） | SHA-256 |
|---|---:|---|
| service | 144880 | `a47e324f5ef6978ddb4305ca6abff701fbde68a26c0796a608a812165372b553` |
| sibling worker | 85458 | `b98ee88584bc240c0a9df06983577cb38d1504e689a656d817b6a08ef06c1e42` |

两个标准产物均通过 `node --check`。worker 只编译和语法检查，从未运行或 import。manifest 默认 binding 的 `executed:false` 表示构建阶段没有执行 service/producer；随后独立离线回执明确记录真实默认 export 的测试调用，二者不是生产执行证明。

## 既有 strict validator、有限绑定与原价保留

没有调用旧 `runtime-scoped.validateSnapshot` 的“294 identity same”限制来检查新获准扩展。离线私有 audit artifact 只导出当前 unchanged strict snapshot validator 与 finite identity parser，且仅编译冻结图中的 snapshot/identity/brand 三文件；它不放进发布 `runtime/`，不是 production 默认 service 替代。该 audit 文件同样有源 pin、产物 hash 和语法检查。

使用捕获的 `data/before-snapshot.exact.json`，不复制应用 source snapshot。旧 **294** raw identities 均保留，原 **213** 份成功来源的整 quote 与整 evidence 都做逐项 `assert.deepEqual`；unitPrice decimal strings、全部 tiers、币种、税、包装、库存与原 fetchedAt 没有变动。

新 data 部分使用原 strict validator 加有限审核授权名单 [binding-authorization.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/binding-authorization.json)，不是泛化品牌推断或允许任意 identity。名单保存当前获审 staged 的 529 个 exact identity keys、88 条完整 binding（含原确认 basis）；当前 binding 必须逐项等于名单记录，canonical source 必须通过原 strict validator 且为 `ok`。名单 hash：`d3515b01c26513c2d129e9feb0fdde7568aefc122753df649d6443bfafb1b05d`。这只是当前 staged 有限 scope 的冻结，最终数据授权仍归父代理；如后续获准新绑定/新 identity，父需审查并显式更新此数据名单，**不用改代码或重编 runtime**。

当前 staged 数据结果：**529 records / 1058 sources 全部 strict-valid，301 份成功价格；88 raw bindings / 88 sources 默认 loader 实际返回 ok，外层 raw 身份保持原文**。

## 真正默认 sibling loader 的少量调用

[default-loader-check.mjs](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/default-loader-check.mjs) 导入真实编译 `channel-reference-service.mjs` 并调用其 `lookupChannelReferences`，没有用 DI snapshot service 代替 production 默认 export。实际读取同目录固定 `channel-reference-snapshot.json`、`channel-reference-identity-bindings.json`、`channel-reference-stock-evidence.json`；worker 的固定 sibling 默认仍为 `channel-reference-worker.mjs`。

仅查 **97** 个去重材料样本，产生 **97 items / 194 source outputs**：88 个 bindings、stock7、两项仍未知库存及既有明确零库存样本（有重合）。主体 5 次最多20材料的调用，另 4 次单材料检查 clone 隔离、合成零库存、sidecar 删除 fail-closed 与恢复，合计 **9 次 lookup**。另用 existingRuntimeDir 只读模式验证同份 sibling，5 次调用通过，未修改该 runtime 中任何文件。

默认测试前确认固定 manual config 未安装；期间拦截 DNS、HTTP(S)、net、TLS、fetch、所有 child launch 以及 runtime 目录/缓存写操作，**禁止操作尝试数为0**。没有获取登录状态/资料，没有读取外站，不启用 config/cache。

实际新库存补证为 **7 份：立创6、云汉1**：

| 型号 / raw 品牌 | 来源 | 实际库存 | 原价格读取时间 UTC | 独立库存采集时间 UTC |
|---|---|---:|---|---|
| X5511FV-25-C70D30-1000 / XKB | lcsc | 120 | 2026-11-14T09:25:09.540Z | 2026-11-17T05:53:27.065Z |
| X6511WR-25H-C60D30R2 / XKB | lcsc | 1407 | 2026-11-14T09:25:03.406Z | 2026-11-17T05:54:00.888Z |
| DB2EKM-3.81-2P-GN-S / 地博 | lcsc | 5395 | 2026-11-14T09:27:00.381Z | 2026-11-17T05:54:04.641Z |
| nSMD010 / TECHFUSE台湾陆海 | lcsc | 940000 | 2026-11-14T09:37:19.570Z | 2026-11-17T05:54:13.856Z |
| AT2659S / 中科微 | lcsc | 11415 | 2026-11-14T09:38:40.645Z | 2026-11-17T05:53:43.035Z |
| LM2596DSADJG / ON | lcsc | 281 | 2026-11-14T09:41:45.344Z | 2026-11-17T05:54:35.176Z |
| LM2903DR2G / ON | ickey | 150000 | 2026-11-14T10:07:30.390Z | 2026-11-17T05:55:03.392Z |

新 stock 只在返回 clone 中填 `stockQuantity`、按原 tier 计算 `stockInsufficientForTier`、加入独立 `stockFetchedAt/stockPageUrl`。逐项验证所有非stock字段完全相同，特别 quote 的 `fetchedAt` 没被库存时刻替换。原 snapshot 中 null 仍是 null、未知库存不推断为0；既有明确stock/0不覆盖。合成 qty0 只暂时写在私有 copied sidecar，匹配的合成 excerpt/hash 只用于边界测试，绝非真实证据或发布数据。测试结束三份 sibling 全部恢复为输入精确字节，保存的 lookups 也恢复为真实值。

完整回执见 [offline-test/default-loader-report.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/offline-test/default-loader-report.json)，真实返回样本见 [default-loader-lookups.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/offline-test/default-loader-lookups.json)，只读复查回执见 [offline-test-readonly/default-loader-report.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/offline-test-readonly/default-loader-report.json)。

## 当前输入哈希与后续数据复查

| 当前 staged 输入（未作最终发布认定） | SHA-256 |
|---|---|
| snapshot | `995692a0dcc3e3c9715edb1bb96e475229e3876d1603a7c66a0631c882125d29` |
| identity bindings | `a823c5bb6a0e37f60731903ac7e00eaa6444dc4099d7e520b31b733567563278` |
| stock evidence | `97dec6453747e9916fd13cf2427c21ac162cf0a208242ebcfb6d72cf16a0f681` |

本构建脚本/回执没有用当前时间、文件mtime、解析时间或复查时间替代采集时间。stock 原采集时间逐项来自已审 sidecar，snapshot 与 sidecar 自身 generatedAt 也保留原文件值。

后续最终 snapshot 变化后，父必须先重新生成 bindings/stock evidence 的完整 snapshot hash 绑定，并重新核对 stock 的原 quote SHA；不能只手改 sidecar hash。runtime 不嵌入任何 staged JSON 或数据hash。父只需运行：

```sh
node /home/ubuntu/work/channel-reference-fill-20261117/runtime-build/build-runtime.cjs \
  check-data /absolute/work/path/finaldata \
  /home/ubuntu/work/channel-reference-fill-20261117/runtime-build/offline-test-final
```

输入目录每种文件接受标准 `.json` 或 `.staged.json` 任一形式；若同时两份则拒绝歧义。checker 将两个已构建 runtime 和三份输入精确复制到私有检查目录，真正调用默认 export，不重编代码。它检查三份数据哈希、strict validator、原213深比较、有限授权和默认 sibling 行为。成功后父按 manifest `buildOutput` 使用两个 standard mjs，并将最终三份数据以标准 sibling 文件名置于同一隔离 reference root。

如父已把三份 finals 放到某个本地工作 runtime 目录，模块接口还支持**仅只读**该 existing sibling，不复制/修改任何数据、不做合成边界 fixture：

```js
const B = require('/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/build-runtime.cjs');
await B.checkData('/absolute/work/path/finaldata',
  '/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/offline-test-final-readonly',
  { existingRuntimeDir: '/absolute/local/work/reference-root' });
```

上述检查只允许本地 `/home/ubuntu/work/` existing runtime，不碰 `/opt/ops` 或生产。`build` 命令可在同样冻结源码/工具上复用；`freeze` 在锁已存在时拒绝自动重pin。当前 finaldata 流程无需再调用 `build`。

## 父负责的唯一当前 adminAPI 路径 patch

manifest 的 `productionCurrentScope.referenceRuntimeImports/runtime` 已逐字保存真实采集 scope，当前旧 runtime import 为：

`/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4/channel-reference-service.mjs`

对应旧 service SHA 为 `a1a6d7c1ae48443c5f1208674fa6d611c8e2306bd107b80e6c9c68076e244034`。这不是猜测的历史路径。父后续只 patch 当前 adminAPI 既有 import 的 module string 到其批准的新隔离 reference root；保留原 reference BFF 调用、`__channelReferenceLookup` 命名绑定和原权限绑定，MainAPI 不编译、不重生成。我没有生成或修改该 string node、adminAPI 或 MainAPI。本任务没有声称最终 snapshot、云汉28复核、UI时间弹层、生产发布或 producer 已完成。
