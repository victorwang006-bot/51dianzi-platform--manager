# 渠道参考 Cell：独立库存采集日期窄候选

> 历史三 target 说明，已由 2026-11-17 P1 最小关闭候选取代。原文和原候选证据已原字节保存在 `pre-review/`。当前有效结果为本目录 `manifest.json`（四 target，含 `keepSuccessfulReferences/h2`）和 [`review-closure-implementation.md`](/home/ubuntu/work/channel-reference-fill-20261117/review-closure-implementation.md)；下面的旧 asset/hash/函数计数仅作历史记录，不用于发布。

状态：`PASS_OFFLINE_CANDIDATE`。仅在共享 checkout 修改 Cell、导出既有日期 helper，并新增七项专项 DOM 测试。未 stage、未发布；未访问浏览器、生产、SSH、Git 或网络；未修改入库附件、库存/通知业务、snapshot、身份绑定或七份补证数据。

## 源码变更

`client/src/business/platform/client/src/pages/ChannelReferenceCell.tsx` 只在既有 Popover 增加价格采集与库存采集行。价格仍使用 `quote.fetchedAt`；库存仅在原严格 `priced` gate 成立且 `stockQuantity !== null` 时使用 `quote.stockFetchedAt ?? quote.fetchedAt`。日期先通过既有严格 UTC ISO helper，后以 `zh-CN`、`Asia/Shanghai` 显示并明确标注“北京时间”。非法日期不渲染，不从显式非法库存日期回退原日期，不调用不安全 HTML/string 渲染。

库存来源复用原 `channelReferencePageUrl` 安全验证。仅在库存日期有效、库存来源 URL 安全且其规范化 URL 与商品页实际不同时增加小链接；同一商品页不重复。链接继承原 `_blank`、`noopener noreferrer`、`no-referrer`。

`channelReferenceModel.ts` 相对本次开始时共享 checkout 仅把既有 `validDate` 改为 `export function validDate`。父已添加的独立库存字段严格 `isQuote` 校验未改变。原厂牌/来源/币种/正价格/最大阶梯 gate、手填优先、原价字符串、zero 与 null、商品页和完整搜索链接均保留。没有新按钮、CSS 或展开功能。

## 唯一有效静态输入

仅以下指定“入库附件最终静态候选”的 manifest、assets、index.html 为有效前映像，没有读取或回退 older 前台 factory：

- `/home/ubuntu/work/inbound-documents-20261117/static-build/manifest.json`：`3079185c26c725975ad34c3a3997d72d49a6c1b409411cb8ab25fb158c305679`
- 原 HTML：`8272d35a4b56f7b0013027a1a820b9201628f8f753b00ae5774d629a731f4d2a`
- 原模块 A：`3244a3a5171146ec0a603ab38c7301e84d578d648b3c2b555ca2c7e80a10fabd`
- 原模块 B：`55db880a65b331f0f4e6531483faffedba8a7db95c93dcdecff93931e85d0c95`

复用静态工具仅用于 AST/精确 delta/依赖映射辅助，不作为旧主站业务基线，也没有调用其整站或旧业务构建函数。

## 真实候选

输出目录：`/home/ubuntu/work/channel-reference-fill-20261117/static-build/`。

| 文件 | SHA-256 |
|---|---|
| `index.html` | `f48afe397dbad4e78608f675d95b6b74445b5c0f6d029baab58b0b72852752bc` |
| `BusinessWorkbenchPage-channel-stock-dates-3ec490843823c957.js` | `3ec490843823c957bb898f38c4ad6609fe5a6304acc2433af3e04f8432250118` |
| `BusinessWorkbenchPage-channel-stock-dates-4cc854bdec72d996.js` | `4cc854bdec72d9967268dc545f73a2753ca959934af73f1e84d473734071d259` |
| `manifest.json` | `d67f170bb4d26ece20baad3e8bfa86f812ce4791b9099d74eac97dc15fa4b830` |

既有 `InboundDocuments-d80a681824741319.css` 原样继承，SHA-256 `d80a6818247413192d472fb73fc1c06b325dcaa9dc85def89e62293bbd248366`。

两份模块各仅改既有渠道 factory `__NAV_CHANNEL_REFERENCE_HOST_GET` 中的：

1. `ChannelReferenceCell → bi`。
2. `isQuote → Ov`：旧编译版本没有日期或独立库存字段验证，本次从父已更新的严格源码精确编译替换。
3. 新 `validDate → __crValidDate_v1`：唯一新增函数。

源码函数使用 TypeScript function-only transpile；导入名由原编译 Cell/quote AST 提取 exactmap，不引入 bundle 或新运行框架。保留原 `m=__customerLive.jsx.jsx`、`_=__customerLive.jsx.jsxs` 及原 `xi/Xo/yi` Popover 变量。每份模块所有 patch 外字节保持；分别对 5399、5937 个不包含目标 patch 的原函数逐个进行字节相同断言。现有入库叶、通知 context、scope/React/JSX 单例及菜单等保留原字节。

HTML 只变更受影响两模块的 importmap 值及必要的原 scope 继承；其余 HTML 字节精确相同。所有原 imports/scopes 均按仅两目标 URL 的映射规则断言，全部静态/dynamic import 依赖仍解析到原地址或本次对应替换地址。未回退入库叶、通知数字、独立商城菜单或原前台 header。

## 检查

- 新增 `ChannelReferenceCell.stockDates.test.ts`：仅七项 jsdom 专项，全部通过。
- 两份真实编译候选中抽取并执行实际 `bi/Ov/__crValidDate_v1`，使用原保留的价格、阶梯、零库存、URL、手填 helpers。开放 Popover 的 mock 仅属于离线测试，不进入交付资产。
- 受影响 fixtures：两日期不同、旧报价库存同时间、unknown 无库存日期、zero、非法日期安全、手填优先和 unsafe 来源；另检查非 ok、缺厂牌、错 source、零价格无伪日期。
- 去掉仅新增采集行/库存来源链接后，与原真实 Cell 渲染 DOM 全量相同。
- 独立字段严格类型/date/source fixtures 与 Cell/model 必要语义型检查通过。
- 共 20 项编译/保留/逆向/窄类型检查通过；没有重跑 1209 通用渠道检查。

`manifest.json` 包含 assets 的 local/url/sha256、HTML before/after、sourceHashes、changedOnly 原 Cell/quote 节点、原生 ABI、依赖和映射记录。`delta.json`、`inverse.json` 含精确字符串与正逆坐标；原 JS 和 HTML 前映像已有本目录冻结副本。`test-results.json`、`source-dom-test.log` 和 `candidate-summary.json` 给出通过结果与摘要。

## 父发布边界

本任务没有验证生产前映像（访问生产被明确禁止）。父须先确认入库最终候选已上线，且实际 HTML 和两个模块的 SHA-256 与以上 **原 HTML/原模块** 完全一致，才可 stage 本次静态候选。若入库候选后续变动，应基于新的最终 manifest/assets/index.html 重新执行本目录 `build-channel-cell.mjs` 和 `check-channel-cell.mjs`，不能以此候选覆盖不同线上前映像。

父负责最终 snapshot 合并、后端 service 独立图 compile 和唯一发布；本候选不声称已验证或修改 213 原价及七份库存补证的数据，只保证没有写入相关数据并保持 UI 展示规则。
