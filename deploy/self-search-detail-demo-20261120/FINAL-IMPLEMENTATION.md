# 自营详情源码实施结果（仅离线）

## 状态与范围

按现有商户详情风格的最终参考图，在既有外部 ECS 项目的本地源码完成自营详情三栏及底部规格区。**此结果不是上线、生产捕获、批准或部署证据。** 全程未使用 Git、生产浏览器、ECS、capture/stage/reload/env；只修改以下限定文件及本目录说明/日志。

| 文件 | 改动 |
|---|---|
| `client/src/pages/ProductDetail.tsx` | 新增 OfficialProductDetail import 与纯路由外包装；数字ID进入原 merchant 函数，非数字进入官方详情验证；商户函数改名 MerchantProductDetail，完整body逐字不变 |
| `client/src/pages/OfficialProductDetail.tsx` | 新页面，复用 MallNav、面包屑、既有 OfficialMallCheckoutResults；开放 createOfficialProductDetail factory |
| `client/src/components/OfficialMallSearchResults.tsx` | 新 detailPublicId/presentation props；独立 official detail GET scope；复用原 bounded/fence/seed/quantity/cart；合法型号新增 /product/<encoded publicId> Link；详情纯JSX/CSS |
| `client/src/components/OfficialMaterialResources.tsx` | 新 detail 纯呈现完整有效参数；安全PDF、favorite保持现有逻辑；default/search保留 |
| `client/src/pages/OfficialProductDetail.test.tsx` | 新增32条官方详情、真实cart wrapper mock、scope/ID/late/timeout/withdraw/税价/数量/资料测试 |
| `client/src/pages/ProductDetail.route.test.tsx` | 新增9条路由隔离、原merchant行为及完整body SHA测试 |
| `client/src/components/OfficialMaterialResources.SearchPage.test.tsx` | 保留11条测试；静态源码扫描从原search分支开始，不误计新详情分支；新增单份favorite回调断言 |

## 行为与数据真实性

详情仅调用 `utils.client.officialMall.detail.query({publicId}, {signal, context:{skipBatch:true}})`，错误 publicId 不触发 list fallback，也不挂载商户详情、配额、推荐、供应商关注或商户 cart mutation。每个 publicId key 同步卸载旧 scope；同ID刷新保留已验证旧卡片但强制read-only，quoteCurrent即时阻止更新提交前的旧点击；失败、超时、晚响应均不会恢复旧购买资格，成功下架响应清空SKU、报价、参数和购买入口。沿用8秒bounded请求与60秒可见页刷新。

左侧仅复用已有 OfficialSearchImage 现用箱图与lightbox，并明确非商品实拍；图片下和型号旁保留蓝白官方标识（复用现有51 mark，非新图片）。中列真实品牌/封装/Date Code/货期/MOQ/库存，卖方51电子网自营与平台客服；缺字段显示待确认，不添分类、RoHS、发票、13%税、评论、第二芯片图或演示脚注。右列原阶梯价格、数量、单价小计及蓝色加入购物车/描边聊一聊。taxIncluded true/false/null分别只呈现含税/未税/税别待确认，不转换金额，不改变原税资格与数量逻辑。底部真实基本字段与已验证 inline technical seed 的全部有效参数及安全PDF；不推断参数，不回落旧缓存，收藏沿用现有hook。

## 购物车 / 原生桥接口

默认源码页面直接用现有 `OfficialMallCheckoutResults`，它有官方cart scope、revision校验、登录、通知，不新增或复制任何 cart mutation/金额/provider/client。

`createOfficialProductDetail({React, MallNav, Link, OfficialMallCheckoutResults, OfficialMallSearchResults})` 返回 Props `{publicId:string, onAddOfficialDraft?, officialCheckoutReady?}` 的页面。不传callback时用已有checkout-wrapped结果；显式callback时给纯结果同样typed callback/ready。原生 host 可用现有 `boundUI.OfficialMallSearchResults`（已cart-bound）同时提供这两个结果依赖，注入旧详情捕获的MallNav和root Link。新 `OfficialMallSearchResultsProps` = 原props + `detailPublicId?:string` + `presentation?:"search"|"detail"`；包装原第56行Props扩散已可透传。

Card原8个事件callback（tier/favorite/tier disclosure/minus/input/blur/plus/cart）各一份、逐字相同；financial declarations block逐字相同。新增attrs `.map`仅pure render，不是新购买回调；native无差别冻结所有箭头的旧检查需区分这两个pure render map，绝不改变原8回调。资料 JSX 以单份 `materialResources` 根据detail/search分支引用，收藏没有复制。

## 检查与证据

执行：

```sh
pnpm exec vitest run --config /home/ubuntu/work/self-row-redesign/detail-implementation/local-vitest.config.mjs
pnpm check
node /home/ubuntu/work/self-row-redesign/detail-implementation/verify-source.mjs
sha256sum -c /home/ubuntu/work/self-row-redesign/detail-implementation/protected-sha256.txt
```

结果：**6 test files / 146 tests 全通过**，含原105条列表及default/search资料回归 + 新41条详情/路由；`tsc --noEmit` **0错误**。`officialCardPresentation`、CheckoutResults、OfficialSearchImage、useOfficialCart、useOfficialMaterial、App、server公共DTO SHA复验全部OK。

商户完整函数body（从开括号之后直至文件结尾，含callbacks/hooks/render/calculations/styles）before/after SHA均为：

`ecd83655f83f02e4a93152e9761a8311672eab91b8317c3ca182a8e4de78db65`

原Card金融声明SHA：`3f8955e1da35f1891eb29feb5e443da4e51a9033483a4144d9a405667d66c0a1`。

最终源码/受影响test有序hash映射 aggregate SHA：

`13eb6ba9d823a6e580286c204eb8e523239d4f3294258248fe2e3a8a4cc66d82`

每个文件及8回调SHA见 `source-verification.json`；原商户完整备份在 `ProductDetail.before.txt`；日志在 `vitest-final.log`、`typecheck-final.log`、`source-verification.log`。

## 限制

没有生产浏览器/视觉capture；三栏CSS遵循最终参考，DOM与mock测试通过，但这不是生产视觉验收。Native构建和整体验收交由主agent/原生构建agent，当前没有新的source blocker。
