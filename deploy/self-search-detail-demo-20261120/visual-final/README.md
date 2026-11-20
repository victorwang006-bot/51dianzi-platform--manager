# 数量框与小字对比度：新版离线复验

**本次结论：`blockingDefects: false`；50/50 状态；失败记录 0 条（按DOM状态逐条保留，不等于独立缺陷数）。** 本次所测数量完整可见、AA目标小字、几何及隔离检查均通过。 结果完全取自实际 rect、input value/clientWidth/scrollWidth、computed color 与独立上下文回执；没有强制忽略失败。旧 `visual-check` 的 nonpass（7 个数量裁切）完整保留，绝不以新结果覆盖旧证据。

## 固定 SHA 与边界

运行前 pin 时间：2026-11-20T03:17:36.961564+00:00。Search SHA：`b2129e9517bee32b3edd96f0d41b06ee24297f8054708bb37497ef837f851e3e`。先读/hash固定，再离线重bundle；build前后和run结束均与pin核对：true。相比旧报告仅 1 个输入SHA变化：`OfficialMallSearchResults.tsx`。Resources源保持原SHA。

本次只读平台源码，写入仅本 `visual-final` 目录。无Git操作、无生产/ECS/API/DB请求、无依赖安装，未碰nativebuilder、controller或旧证据。主agent另跑146tests/types，本证据不替代也不声称重跑这些测试。商户 `ProductDetail.tsx` **仅hash前后比对，不执行body、不称full native回归**。

## 方法与合成标识

沿用原 `README.md/build.cjs/run.cjs/finalize.cjs` 复现链，入口、mocks、measure和资产均复制到新目录，output通过`__dirname`只指向本目录。新副本增补：固定SHA校验、动态实测汇总、全部目标小字AA计算、quantity内部/跨卡片重叠与图片计数。没有添加或覆盖被测源CSS。沿用已纠正的browser-level null session清理接口，本轮独立context的实际清理以回执为准；旧工具失败记录保留在visual-recheck/attempt-1，不作为本轮输出。

真实源组件为Search、Resources、SearchImage、OfficialProductDetail；真实金额helper和资源/PDF防护仍参与。公共list/detail仅由本地合成callback提供数据；favorite回调抛错并记录禁止mutation，cart-checkout一直disabled且无mutation callback；实际 forbiddenMutations=[]。仅点参数/tiers disclosure与本地tier选数量，不点购买、收藏、PDF或联系。合成MOQ=10、SPQ=10、可售2147483647，longqty=2147483640（合法）；20参数、10梯度、128字符长型号、stale quote均沿用原seed。dummy PDF从未请求。账户cookie/local/session storage均为空。

所有主截图顶部均直接来自harness的“**内部合成 · 非生产 / 非完整 native**”黄色说明条；不是生产截图或完整native运行。host index.css仅在测试编译输入中移除远程Google Fonts import；源不变，使用本地fallback，不称生产字体像素一致。

## 新截图

- [final-source-list-desktop.png](/home/ubuntu/work/self-row-redesign/visual-final/final-source-list-desktop.png)
- [details-desktop.png](/home/ubuntu/work/self-row-redesign/visual-final/details-desktop.png)
- [list-mobile.png](/home/ubuntu/work/self-row-redesign/visual-final/list-mobile.png)
- [details-mobile.png](/home/ubuntu/work/self-row-redesign/visual-final/details-mobile.png)
- [list-desktop-expanded.png](/home/ubuntu/work/self-row-redesign/visual-final/list-desktop-expanded.png)
- [details-desktop-expanded-long-quantity.png](/home/ubuntu/work/self-row-redesign/visual-final/details-desktop-expanded-long-quantity.png)
- [list-mobile-expanded-long-quantity.png](/home/ubuntu/work/self-row-redesign/visual-final/list-mobile-expanded-long-quantity.png)
- [detail-mobile-expanded-long-quantity.png](/home/ubuntu/work/self-row-redesign/visual-final/detail-mobile-expanded-long-quantity.png)
- [list-320-expanded-long-quantity.png](/home/ubuntu/work/self-row-redesign/visual-final/list-320-expanded-long-quantity.png)
- [detail-320-expanded-long-quantity.png](/home/ubuntu/work/self-row-redesign/visual-final/detail-320-expanded-long-quantity.png)

记录：[summary.json](/home/ubuntu/work/self-row-redesign/visual-final/summary.json)、[geometry.json](/home/ubuntu/work/self-row-redesign/visual-final/geometry.json)、[source-sha256.json](/home/ubuntu/work/self-row-redesign/visual-final/source-sha256.json)、[source-pin.json](/home/ubuntu/work/self-row-redesign/visual-final/source-pin.json)、[process-receipt.json](/home/ubuntu/work/self-row-redesign/visual-final/process-receipt.json)、[request-log.json](/home/ubuntu/work/self-row-redesign/visual-final/request-log.json)。旧nonpass仅作只读对照：[旧报告](/home/ubuntu/work/self-row-redesign/visual-check/README.md)。

## 50状态与数量完整可见

五宽1280/960/768/375/320 × list/detail × baseline/expanded/expanded-long-quantity/long-model/stale-read-only，共50独立状态采样。viewport height=1000，deviceScaleFactor=1；375/320 mobile emulation。详情桌面竖向滚动条使content比viewport少15px，不是横向滚动。full-page screenshot不缩放重绘。

准确selector：SearchStyles末尾第364行 `.omr-root .omr-card .omr-quantity{flex-wrap:wrap}`；counter width/max/flex=144px；`.omr-root .omr-card .omr-counter input` width/min-width=94px；DetailStyles第400行 `.omr-root.omr-detail .omr-card .omr-counter`=154px。以下数据只测第一个实际输入长数量的卡片（第二卡片仍保留用于下行遮挡检查）。

| 页面 | 宽度 | DOM完整value | aria-invalid | input rect宽 | client/scroll | counter宽 | quantity高 | 同时完整可见 | 下一卡片间距 |
|---|---:|---|---|---:|---|---:|---:|---|---:|
| list | 1280 | 2147483640 | false | 94 | 92/92 | 144 | 53.19 | 完整 | 8 |
| list | 960 | 2147483640 | false | 94 | 92/92 | 144 | 53.19 | 完整 | 8 |
| list | 768 | 2147483640 | false | 94 | 92/92 | 144 | 28 | 完整 | 8 |
| list | 375 | 2147483640 | false | 98 | 96/96 | 144 | 51.19 | 完整 | 8 |
| list | 320 | 2147483640 | false | 98 | 96/96 | 144 | 28 | 完整 | 8 |
| detail | 1280 | 2147483640 | false | 96 | 94/94 | 154 | 32 | 完整 | — |
| detail | 960 | 2147483640 | false | 96 | 94/94 | 154 | 32 | 完整 | — |
| detail | 768 | 2147483640 | false | 96 | 94/94 | 154 | 32 | 完整 | — |
| detail | 375 | 2147483640 | false | 96 | 94/94 | 154 | 32 | 完整 | — |
| detail | 320 | 2147483640 | false | 96 | 94/94 | 154 | 32 | 完整 | — |

数量完整可见判定同时要求value准确、aria-invalid=false且scrollWidth≤clientWidth+1；既不以root无横向滚动代替input内部裁切检查，也不将DOM完整value单独当作可见。

## quantity换行不遮采购、下卡片/规格

下表按baseline与旧证据比较高度；差值/间距由实际DOM rect计算。geometry另含所有expanded/longqty状态的qty/cart/price/subtotal/specs区域rect、内部/跨卡片overlap与quantityContained。

| 页面 | 宽度 | quantity高度旧→新 | flexWrap | 单价top−quantity bottom | cart top−quantity bottom | 内部overlap | 跨卡片overlap |
|---|---:|---|---|---:|---:|---:|---:|
| list | 1280 | 28→53.19 | wrap | 6 | 54 | 0 | 0 |
| list | 960 | 28→53.19 | wrap | 6 | 54 | 0 | 0 |
| list | 768 | 28→28 | wrap | 6 | 54 | 0 | 0 |
| list | 375 | 28→51.19 | wrap | 6 | 54.00000000000006 | 0 | 0 |
| list | 320 | 28→28 | wrap | 6 | 54 | 0 | 0 |
| detail | 1280 | 32→32 | wrap | 10 | 66 | 0 | 0 |
| detail | 960 | 32→32 | wrap | 10 | 66 | 0 | 0 |
| detail | 768 | 32→32 | wrap | 10 | 66 | 0 | 0 |
| detail | 375 | 32→32 | wrap | 10 | 66 | 0 | 0 |
| detail | 320 | 32→32 | wrap | 10 | 66 | 0 | 0 |

无区域重叠=true；无跨卡片遮挡=true；数量保留卡片内=true。列表额外15参数与10tier真实展开=true；详情完整20参数=true；库存不裁切=true；stale真实alert、input readonly、cart disabled=true。Enter展开=true；控件命名和aria-controls目标存在=true。

## 保持当前左图box scale与only1img

每卡片产品图片与trigger均为1=true；产品图片不包含详情自营品牌logo。75个卡片状态的实际产品image rect与旧对应状态严格相等=true。原inline 96×80仍在，computed CSS放大来自真实source，而非更换图片/新增高清资产。

| 宽度 | 列表产品图rect | 详情产品图rect | 列表body scroll/client | 详情body scroll/client |
|---:|---|---|---|---|
| 1280 | 88×88 | 270×270 | 1280/1280 | 1265/1265 |
| 960 | 72×72 | 330×330 | 960/960 | 945/945 |
| 768 | 72×72 | 330×330 | 768/768 | 753/753 |
| 375 | 72×72 | 321×321 | 375/375 | 375/375 |
| 320 | 72×72 | 266×266 | 320/320 | 320/320 |

## AA computed小字对比度

SearchStyles第365行scoped omr卡片label，DetailStyles第401行detail-only labels，修复color=`#596675`。使用浏览器computed foreground与最近非透明computed背景，按sRGB相对亮度精确算比值；普通小字门槛4.5:1，rounded ratio仅展示，**未使用四舍五入值判通过**。检测2640条DOM颜色记录，全部目标小字AA=true，失败组数=0。不称full WCAG audit，不把disabled购买按钮算普通文本。

| 页面 | 准确selector | computed color | 背景RGB | 最低contrast | fontSize | AA |
|---|---|---|---|---:|---|---|
| list | `.omr-image-note` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 10px | 通过 |
| list | `.omr-meta` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| list | `.omr-facts` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| list | `.omr-core-parameters dt` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| list | `.omr-core-parameters dd` | `rgb(57, 67, 78)` | 255,255,255 | 10.06:1 | 12px | 通过 |
| list | `.omr-price-heading` | `rgb(105, 118, 132)` | 255,255,255 | 4.64:1 | 12px | 通过 |
| list | `.omr-stock` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| list | `.omr-tier>span` | `rgb(89, 102, 117)` | 255,242,230 | 5.33:1 | 12px | 通过 |
| list | `.omr-tier>span` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| list | `.omr-unit-price>span:first-child` | `rgb(67, 77, 89)` | 255,255,255 | 8.59:1 | 12px | 通过 |
| list | `.omr-extra-parameters dt` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 11px | 通过 |
| list | `.omr-extra-parameters dd` | `rgb(57, 67, 78)` | 255,255,255 | 10.06:1 | 11px | 通过 |
| list | `.omr-tier>span` | `rgb(89, 102, 117)` | 241,246,252 | 5.4:1 | 12px | 通过 |
| detail | `.omr-image-note` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 11px | 通过 |
| detail | `.omr-meta` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| detail | `.omr-detail-attrs dt` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12.5px | 通过 |
| detail | `.omr-detail-attrs dd` | `rgb(26, 26, 26)` | 255,255,255 | 17.4:1 | 12.5px | 通过 |
| detail | `.omr-detail-seller>span` | `rgb(89, 102, 117)` | 248,250,253 | 5.61:1 | 12px | 通过 |
| detail | `.omr-price-heading` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12px | 通过 |
| detail | `.omr-tier>span` | `rgb(89, 102, 117)` | 232,240,254 | 5.12:1 | 13px | 通过 |
| detail | `.omr-tier>span` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 13px | 通过 |
| detail | `.omr-unit-price>span:first-child` | `rgb(67, 77, 89)` | 255,255,255 | 8.59:1 | 13px | 通过 |
| detail | `.omr-detail-quote-note` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 10.5px | 通过 |
| detail | `.omr-detail-base-specs dt` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12.5px | 通过 |
| detail | `.omr-detail-parameters dt` | `rgb(89, 102, 117)` | 255,255,255 | 5.86:1 | 12.5px | 通过 |
| detail | `.omr-tier>span` | `rgb(89, 102, 117)` | 241,246,252 | 5.4:1 | 13px | 通过 |

## 缺陷与判定

`defects: []`。原7处longqty内部裁切本次均消除；无脚本豁免。 展开参数标签现按同一自营作用域覆盖色复验，其结果只根据本轮computed color判定，不使用旧报告的通过状态。 汇总检查任一false、matrix缺失、runtime异常、SHA变化、AA不达标、network attempt、清理失败都会形成真实blocking defect。run和finalize对blocking结果返回非0。

## 网络0与退出

Chromium `Chrome/156.0.8078.73`：独立空context=true、context dispose=true；stdio CDP pipe无监听端口；未启动HTTP服务=true。`http://127.0.0.1:1/harness`与两种既有资产在Fetch request阶段内存fulfill，无实际HTTP传输；非白名单全部failRequest。CSP connect/font/frame/object-src none；DNS MAP * NOTFOUND、transport proxy指向拒绝的loopback端口作第二道防护。

renderer请求共3条；external尝试=0，external transport放行=0；request-log保留所有决策；dummy PDF未请求。仅内存fulfill本地文档/资产，favicon拦截；不是“启动了HTTP服务再阻外网”。browserErrors=0；fatal=null。Chromium PID 20461已退出=true，/proc PID不存在=true，没有本次HTTP服务需结束。独立核对listener/process快照见回执：新监听地址0、profile进程匹配0、PID和profile目录均不存在；未启动本次HTTP服务。全量源SHA前后不变=true；旧evidence字节不变=true。

## 源SHA

SHA指文件内容，不是Git commit。merchantbody只hash。

| 源文件 | SHA-256 |
|---|---|
| `client/src/lib/utils.ts` | `d1f1e0d62cb8d8d1e04c26e14de842d8a151f75812d81b046c65b5d1fe8e4b27` |
| `client/src/components/ui/dialog.tsx` | `3ffd83bd2940c1191fde091bc47311aebc2b79d78824965a5c446115e58190aa` |
| `client/src/components/ImageLightbox.tsx` | `ab4f11e5c5fc5e48ff4550cb71f89680e57e7662ee2f7ca0e3fd4bd3cdfc6293` |
| `client/src/components/OfficialSearchImage.tsx` | `181e7bcbee0880e29c2586b247a0cdcf6b3229dbccfe76a69d0c214b0279d6b4` |
| `client/src/lib/officialMaterialClient.ts` | `5477ac5fb98f49c80b0a5979e9b6c8f06945f8e71c9d909364a22d51906c2513` |
| `client/src/components/OfficialMaterialResources.tsx` | `0f4911e8b95ee3a643a3ee9ec7d17a1619a14f93677292467310590496785d57` |
| `client/src/assets/brand/logo-header-mark.webp` | `dac23a53c00c75e4b36d1ade7fb3c3fe1a2797d619dbb154c13b10eb3dc61a5c` |
| `client/src/assets/brand/logo-home-wordmark.webp` | `5e8c12caaa7c388f9bb2d371fe2e13ed550dbd23553e6959c92e5b8faf3cd3b1` |
| `client/src/assets/homeLogo.ts` | `065f08d79b0db77cd954c917a92d051c96673135b39fa7081f4918f27fa6bd77` |
| `client/src/lib/searchResultCommit.ts` | `97c4b2d43d5c3e9703c817b8db49d97462c34bded1014ed6afc9d3f3c916c8a3` |
| `client/lib/officialCardPresentation.ts` | `a3191134b70ef758c0a33b1f5bc9f06021a330edc81314bc44ec43167c0d07a1` |
| `client/src/components/OfficialMallSearchResults.tsx` | `b2129e9517bee32b3edd96f0d41b06ee24297f8054708bb37497ef837f851e3e` |
| `client/src/pages/OfficialProductDetail.tsx` | `26af704d416bc8442038f6caaa30b6a8b82dc1e4cbd7ea537daf1e3520af76cc` |
| `client/src/index.css` | `4235cc782144393738c8c40bf90f7a15b7dcc2b2bf66b6d4b486fe0b846a5973` |
| `client/src/pages/ProductDetail.tsx` | `f0c2a4f6930f62f7bfa63f8a45585f1b05107cac7ccc30c774c2fa98868235d2` |

## 复现入口

```bash
cd /home/ubuntu/work/self-row-redesign/visual-final
node build.cjs > build.log 2>&1
node run.cjs > run.log 2>&1
node check-cleanup.cjs > cleanup-check.log 2>&1
node finalize.cjs > finalize.log 2>&1
```

`source-pin.json`是本次固定输入；source与pin不一致脚本拒绝运行，禁止静默改pin或复用旧bundle。`prepare-tools.cjs`只记录从原工具副本加测量的准备动作，已执行，不需再次运行（严格fragment匹配，二次执行拒绝）。产物路径全部本目录，旧nonpass始终独立保留。
