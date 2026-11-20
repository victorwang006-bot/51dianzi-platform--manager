# 自营详情源码 / 原生桥接口（实施中）

已定位 `client/src/components/OfficialMallCheckoutResults.tsx` 的 `createOfficialMallCheckoutResults`：已有 `useOfficialCartCount` scope、`officialCart.add` 保存与 revision 校验、登录弹窗、购物车通知和失效栅栏。**不需要新增金融实现，不改该文件。**

将新增 `OfficialMallSearchResultsProps.detailPublicId?: string` 和 `presentation?: "search" | "detail"`。存在 detailPublicId 时只调用 `utils.client.officialMall.detail.query({publicId}, {signal, context:{skipBatch:true}})`，不回落 list。卡片报价和购物车按钮复用原实现。`OfficialMallCheckoutResults` 原 factory 的 Props 为 ComponentProps，自动接纳这些 props。

将新增 `OfficialProductDetail` 与 `createOfficialProductDetail`，默认源码入口用既有 `OfficialMallCheckoutResults`；纯呈现入口可注入 `onAddOfficialDraft(material: OfficialMallPublicMaterial, quantity:number):void` + `officialCheckoutReady:boolean`，传给既有 `OfficialMallSearchResults`，没有新 provider/client。

主 agent 原生构建应继续用已有官方 cart factory/host hooks。若发布工厂不含最新 scope，就将其 `OfficialMallSearchResults` 依赖换成新源码导出，并向详情呈现注入同样 callback/ready，不可调用 merchant `cart.add`，不可把 OM_UUID 转 number。最终文件/测试与 SHA 待完成后补充。

## 10:48 源码接口已落地（测试中）

`client/src/pages/OfficialProductDetail.tsx` 导出 `createOfficialProductDetail(deps)` 与默认组件。deps = `{React, MallNav, Link, OfficialMallCheckoutResults, OfficialMallSearchResults}`；Props = `{publicId:string, onAddOfficialDraft?, officialCheckoutReady?}`。默认不传 callback 时，使用 deps.OfficialMallCheckoutResults（既有真实购物车包装）；显式 callback 时使用 deps.OfficialMallSearchResults。原生可将 `boundUI.OfficialMallSearchResults` 同时传给这两个依赖，它本身已经 cart-bound；或纯结果+现有callback模式。

`OfficialMallSearchResults` 新 props `detailPublicId?:string`、`presentation?:"search"|"detail"`；`OfficialSearchCard` 也新增纯 `presentation` 并具名导出，数量/金额/canAdd/8处交互保持原金融逻辑。详情请求存在时只 officialMall.detail，不走 merchant 或 list；ID同步remount清旧scope；同ID刷新沿用旧 verified card 但strict readonly。

`ProductDetail` 默认仅外层 useRoute + `/^\d+$/` 选原 MerchantProductDetail，非数字进入 OfficialProductDetail 并验证 publicId。原merchant body 尚未改变任何行，测试将附逐字bodySHA。

## 10:53 纯呈现复用细节

Card 的采购区（tier、qty、unit/subtotal、cart、chat）始终单份 JSX；资料区同样收敛为 `const materialResources = <OfficialMaterialResources presentation={detail ? "detail" : "search"} ... onFavorite={原回调}/>`，搜索/详情互斥引用，favorite callback只有一份。新增 `detailAttributes.map` 和底部基本规格 `.map` 都是纯 JSX 行呈现；若 native 旧 `freezeCallbacks` 无差别冻结每个箭头，需区别这两个新增纯render map，原8个事件回调不可变。不要求改金融helpers。

TypeScript 已两次通过；首轮新增详情32条通过。当前修正两个test-only路径/断言适配（既有静态扫描须从原search分支开始扫描，新增body SHA test需用项目相对路径而非jsdom URL），即将全部重跑。
