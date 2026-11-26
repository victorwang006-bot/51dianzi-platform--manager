# 采购入库前端 v2（仅采购模块补丁）

目标是以原始线上 `~/work/fe/live.js` 为输入，取代上一版“列表加列 + 独立改单·费用弹窗”。本版替换整个新建/编辑呈现，采用 demo 的供应商与单据、物料表、费用表、收起的照片备注/附件、固定右侧成本汇总。未触碰生产、数据库或 `~/work/impl` 后端代码。

## 产物与使用

```bash
node ~/work/fe/inb2/patch_inbound_v2.cjs ~/work/fe/live.js out.js
node --check out.js
cp out.js /tmp/out.mjs && node --check /tmp/out.mjs
node ~/work/fe/inb2/test_precision.cjs
```

脚本读取同目录 `original_module.js`、`inbound_v2.jsx`、`inbound_v2.css`、`inbound_list_v2.css`；使用已存在的 `~/work/fe/node_modules` 中 prettier 和 Babel parser/traverse/types/generator，不安装 UI 库或从仓库重建。只有 `__d51_procurement_inbound_get` 内被修改，原模块和所有内部锚点必须唯一，否则失败即停、不写输出。再次对已打补丁输入运行会拒绝；销售叶子模块可先后叠加，采购模块外字节保持原样。

`out.js` 是本任务最终候选 bundle，`component.runtime.js` 与 `compiled_module.js` 是可检查的编译产物。`verify_ui.py`、`verify_e2e.py`、`verify_edges.py` 为独立 Firefox + pw_helper 验证脚本；测试只使用预发布与本任务的 INB2 单据。

## 保存流程与精度

单物料使用原 `inbound.create` 字段，包括状态、供应商资料、封装/批次/仓位、照片 refs、documents、buyerUserId/operator、初始付款及 clientRequestId，另加可选 costs。多物料使用 `inbound.bulkCreate`，最多后端原上限 200 行，费用最多20行，所有有费用的物料要求单价 > 0。原批量缺价标记与 Excel/粘贴高级导入仍保留。

在途编辑根据实际部署契约用一次 `inbound.update({id,data,costs?})` 原子保存；费用不变省略 costs、删除全部传 costs=[]。已入库先 `inbound.revise` 校验库存下限、版本和成本，再 `inbound.updateDetails` 保存资料。这样修订被拒绝时资料不会先发生变化；第二步失败会显示哪一步已成功、哪一步未保存，并禁止重复修订，要求重新打开仅补未保存资料。

金额、税率转换、逐行货款、费用累加、供应商应付、单位成本与变化量均用字符串/BigInt 缩放整数计算，不用浮点累加；API 中旧 numeric 字段仅在最终构造时 Number 转换。创建全额付款仅含货款，供应商费用另计，汇总与提示如实显示待付。网络结果不明或后端“已创建但费用未保存”会保留冻结表单，使用完全相同的 clientRequestId/payload 重试。

## 验收三栏（诚实记录）

| 已验证 | 未验证 | 已知差距 / 后端缺口 |
|---|---|---|
| 已完整读 BRIEF、采购 plan、demo HTML，并用独立 Python Playwright 截图/读图编辑、新建、列表三屏。demo 图在 `/tmp/inb2/demo-edit.png`、`demo-new.png`、`demo-list.png`。 | 生产发布未做，且未授权本任务发布生产。 | 后台导航保留原线上 admin 导航，不改为 demo 的前台导航。 |
| 新建单条 + 供应商/采购员/封装/批次/仓位 + 两行费用 + 全额货款付款真实成功；单号 RK202611260016。截图 `/tmp/inb2/new-single-filled.png`、`list-single-saved.png`。货款1234、费用30.75、总成本1264.75、供应商待付10.25，符合实际后端付款契约。 | 单条部分付款“比例/自定义金额”入参保留，尚未分别真实保存。 | 已入库 revise.strict() 未支持 taxRate/unitCostBasis；税率/口径锁定并提示，不假装可改。 |
| 三物料 + 两行费用真实 bulkCreate 成功：RK202611260017/18/19。货款1393.26、费用70.03、总成本1463.29；成本按后端分摊，列表显示含费用。截图 `/tmp/inb2/new-bulk3-filled.png`、`list-bulk-saved.png`。 | 200物料与20费用的边界由按钮/前置校验实现，未真实创建200张单据。 | 已入库 updateDetails 无 inboundDate/prodYear；日期/DC 锁定并提示。 |
| 已入库单修改数量100→120、单价12.34→13.21、运费10.25→12.50、联系人真实成功。请求顺序 revise → updateDetails。截图 `/tmp/inb2/edit-received-before.png`、`edit-received-changed.png`、`confirm-received.png`、`list-after-revision.png`。 | 真实出库/预留下限回归尚未做；前端有返回数据时校验，缺数据时按后端友好错误展示。 | 料号/品牌在已入库单锁定提示“需作废后重录”；在途可改，采购员创建后始终锁定。 |
| 修改记录真实读取，包含时间、操作人、字段前后值、原因，倒序显示。截图 `/tmp/inb2/history-received.png`。 | 缺价已入库单补价由现有 revise 拒绝，尚未有可用后端补录流程。 | 在途 update 当前契约不接收 reason，确认框明确提示原因暂不留存；需后端扩展并审计。 |
| 在途改单 qty100→110、price12.34→13.33、运费及供应商资料一次 update 成功；成本1521.78、费用55.48。截图 `/tmp/inb2/edit-transit-before.png`、`confirm-transit.png`、`list-transit-after.png`。 | 多物料照片/封装/批次/联系方式等通过批量完成后的逐单安全保存保留；异常重试实现已写，尚未真实覆盖每种字段。 | 多物料原 bulkCreate 无初始 payment，提交前明确拒绝非未付款并提示创建后逐单登记；没有静默丢失付款。 |
| 列表“数量 / 单价”“采购总成本”及“含费用 ¥xx”、唯一菜单编辑入口、新状态页签、顶部统计保留。截图 `/tmp/inb2/list-transit-after.png`。 | Excel/粘贴高级导入保留旧能力；尚未重新上传真实 Excel。 | 已作废 documents API 409：“当前入库单状态不允许保存或读取附件”；前端跳过禁止读取的附件以打开同版只读布局，基础资料保存需后端允许 cancelled updateDetails。 |
| node --check（.js/.mjs）、精度/税率/大数/友好错误单测通过，模块外字节不变，eslint no-undef 比基线新增0。证据 `/tmp/inb2/final-checks.json`、`lint-final.txt`。 | 低权限成本隐藏尚未用真实低权限账号回归；渲染按响应是否包含成本字段隐藏整块，不填0/不估算。 | list 未返回已出库/已预留/当前库存字段；只显示服务端已返回数据，不伪造库存。 |

真实请求与测试数据见 `/tmp/inb2/e2e-result.json`。补充异常/附件测试仍在进行，结果完成后更新本说明，未完成不会写成已验证。

## 预发布环境修复（仅本任务 3102）

已按要求运行原 `~/work/fe/stg_deploy.sh inb 3102 out.js`。但原预发布 `adm_inb/dist/index.js` 符号链接指向共享 admin，Node 的 import.meta.dirname 导致始终读取共享旧索引。已把本任务入口复制为独立的同内容文件，使 3102 使用自己的 dist/public；没有改共享后台内容。以后后端主任务升级 admin 转发时，需同步此独立副本（或以 Node --preserve-symlinks-main 启动）。

原 `up.sh` 本地/远端共享 `/tmp/upc`，并行部署发生竞争后会上传0字节且原部署脚本仍继续。本目录 `deploy_safe.sh` 使用唯一临时目录、逐分片重试与严格 SHA 校验，失败不切索引，只动 inb/3102。现在预发布已用该安全脚本部署并用浏览器验证。生产未触碰。
