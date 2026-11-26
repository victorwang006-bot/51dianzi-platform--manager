# 销售订单 > 业务订单 v2

本补丁针对 `/workbench/sales-orders?orderSource=business`，以 `/home/ubuntu/work/fe/live.js` 为唯一基线，真正替换列表、新建、已有订单的查看/编辑页面。新版只有一个订单页面：数量、单价、费用、交期、确认说明在原弹窗就地编辑，保存前再弹差异确认；没有独立“销售订单改单”弹窗。

**这不是全部要求无缺口的完成声明。** 当前后端契约有若干实际缺口，页面采用明确锁定/隐藏/限域汇总而不伪造能力，详见下文。

## 产物与使用

```bash
cd /home/ubuntu/work/fe/sal2
node patch_sales_v2.cjs /home/ubuntu/work/fe/live.js out.js
node --check out.js
```

`patch_sales_v2.cjs` 与 `sales_v2.runtime.js` 是运行补丁的必要文件。可读组件源在 `sales_v2.tsx`；`build_components.cjs` 使用已存在的 esbuild 编译运行时，不引入 UI 库。补丁以 AST 唯一定位 `__cs_crm_sN_get`、`__cs_crm_GB_get` 内的销售叶子，仅在叶子内部注入组件并将业务页入口 `dn` 包装。原模块局部哈希校验防止盲补，但不依赖整文件哈希，允许与采购补丁叠加。幂等时完整验证已注入运行时及恢复后的原模块，断言失败不写输出。输入/输出不可相同，禁止写原始 live.js。

候选：`/home/ubuntu/work/fe/sal2/out.js`。最终哈希见 `patch-evidence.json` / `deployed-name.txt`。部署仅在 `/opt/stg/adm_sal` 与端口 3103；未访问生产发布目录、生产数据库，未修改 `/home/ubuntu/work/impl` 后端文件。

## 已验证 / 未验证 / 已知差距（三栏）

| 已验证（真实浏览器及证据） | 未验证 | 已知差距 / 原因 |
|---|---|---|
| 使用独立 Python Playwright/Firefox 和 `pw_helper.open_page(3103, ...)`；demo 三视图已截图并读图：`screenshots/demo-list.png`、`demo-edit.png`、`demo-new.png`。新版总宽1100px、290px右栏、白色卡片、原平台控件样式、弹窗内滚动与固定底栏。 | 小屏触控/移动端、Safari及真实低权限账号。 | 本任务仅业务订单工作台入口改版；客户页面嵌入式订单模块仍沿用原逻辑，避免无授权扩展改版范围。 |
| 列表十列顺序、五页签、金额/待收/净利润当前页真实汇总；`screenshots/final-list.png`、`stg-completed-tab.png`、`stg-cancelled-tab.png`。 | 超过一页的真实大数据全库汇总。 | list 不返回物料、利润或全库汇总，也没有待收/待出过滤入参。因此页签仅筛选当前页，汇总明确注明“当前页·当前页签（非全库）”，净利润注明已核算n/N；未返回成本时隐藏利润汇总与列。 |
| 已有部分出货且已有收款 XS20261126-8 新版打开：客户/负责人锁定、已出行身份锁定、确认说明默认折叠、利润/收款/出货卡、审计时间线：`screenshots/final-order-8.png`、`stg-history.png`。 | 后端未来返回 completed 独立状态的兼容实测。 | 后端状态枚举仅 confirmed/cancelled。前端按“足额已登记收款（含月结）且全量已出货”派生已完成，整页只读。 |
| 自建 XS20261126-13 真实登记全额收款和两批次出货，已完成整页只读；自建 XS20261126-14 真实取消并释放预留，已取消整页只读：`screenshots/final-order-13.png`、`final-order-14.png`、`stg-payment-success.png`、`browser-states.json`。 | 收款/出货网络结果不确定时所有切换方式的端到端测试。 | 已完成/已取消不显示保存或登记按钮。已有收款或出货的取消按钮提前禁用。取消原因与确认使用现有 cancel 接口。 |
| 自建 XS20261126-13/15 真实同时改单数量/单价/费用，差异确认列出应收/待收/净利润/提成与追加预留影响，原因必填；`screenshots/stg-review.png`、`final-review.png`、`stg-edit-saved.png`，`browser-flow.json`。 | 多用户并发CAS冲突的真实双账号测试。 | 原物料行的身份、增删与换批次不在 revise schema 中，所有已有物料身份只读，操作列以提示说明，不伪造保存。 |
| 数量低于已出货、金额低于已收款均前端提前提示：`stg-qty-validation.png`、`stg-paid-validation.png`。通过请求拦截仅修改测试请求内容模拟状态漂移，让真实后端拒绝，错误显示中文：`stg-backend-qty-reject.png`、`stg-backend-paid-reject.png`、`browser-edges.json`。原 XS20261126-8 未成功修改。 | 真实库存被其他用户抢占、超大金额数据库边界。 | 后端当前固定税率13%，无税率/下单日期入参；这两个字段显示但禁用并有说明。交付日期、税务含税/未税口径可改（历史未确认需求税口径不能改）。 |
| 真实新建两行库存物料、两行费用、必填确认说明、自动带出品牌/DC，批次预留：`stg-new-filled.png`、`stg-create-success.png`、`browser-flow.json`。字段支持4位小数。 | 单物料跨两个真实同身份批次新建（种子无对应组合）；需求采购创建端到端（种子没有可转单的已接受报价需求）。 | 创建接口已经支持 `items[]` 和每行 `allocations[]`，没有费用字段。新版保留每行多批次分配编辑和总量校验，实际 payload 不改变接口能力；单元验证多批次形状通过。需求新建沿用 candidates → create，保留 demandRevision 与可转数量；已有需求订单交付复用原 tn（批次分配/预留/出货）组件，未实测可转需求。 |
| 创建网络失败后“重试原请求”发送完全相同 requestId/payload；费用第二步模拟 BAD_REQUEST/zod JSON 失败后，明确“订单已创建，但销售费用未保存，请打开订单补录”，弹窗转为编辑并保留费用；补录成功，没有第二次创建：`stg-create-network.png`、`stg-created-expenses-failed.png`、`stg-expenses-recovered.png`，`browser-failure.json`。 | 浏览器不允许 sessionStorage 的恢复路径、长期关闭标签页后的恢复。跨刷新恢复的最新结果见 `browser-reload.log`（若无完成JSON，不计为已验证）。 | 已加入按身份 storageScope 隔离的冻结创建请求恢复与已创建收据（只在 sessionStorage，不存 token）；正常弹窗内重试已真实验证。403会由原工作区安全机制关闭清理页面并提示“业务请求安全核验未通过”，不是绕过权限继续编辑；创建收据用于重新核验后的补录恢复。 |
| 无成本字段降级：拦截仅响应，递归删除 profitBreakdown/commissionPreview/cost字段，列表利润列/汇总和弹窗成本/利润/标尺全部消失，只保留销售额/费用/收款/出货。`screenshots/stg-no-cost-list.png`、`stg-no-cost-editor.png`，`verify_edges.py`。 | 后端逐行成本字段有权限时实际展示（接口目前未提供）。 | get/candidates 不返回每行单件成本；companyStockAllocations.unitCost恒null；profitBreakdown也不返回货款/采购费用拆分。前端不推算、不按0显示；只有确实返回单价成本字段才显示单件成本/差价。采购成本仅显示真实总成本并注明拆分待后端提供。 |
| 金额全用 BigInt微单位；乘法/费用累计/税扣/净利润/佣金独立精确舍入，整单档位用精确分子；单元及后端核对：销售172.0368、费用4.5678、净利润66.804216、提成10.02；`money-result.json`、`test_money.cjs`、`get-13.json`。 | 不同佣金策略配置的实测；当前只使用已确认整单15/18/20策略。 | 未税口径按现有后端不重复扣13%，成本用服务器按口径预估返回；数量变化时成本不由前端猜测，调用现有preview接口。有出货且可用批次不足时preview可能失败，前端注明最终以保存后服务器结果为准，不用零成本估算。 |
| 语法检查 .js/.mjs、完整AST解析、局部唯一锚点、幂等逐字相同、销售模块外/采购模块逐字不变；no-undef基线115/候选115，新增0：`patch-evidence.json`、`idempotent.json`、`lint-diff.json`。 | 与另一子任务最终采购补丁实际先后叠加文件测试（各自外部字节保护已验证）。 | 未从仓库重建；新页面未接入原服务器 orderDraft 普通自动草稿API，仅保留本次不确定创建请求/创建收据恢复。 |

## 列表性能方案与实测

list 的返回确实不含物料或利润，完全删掉 get 将无法按 demo 展示这些信息。因此采用 **IntersectionObserver仅可见行 + 全页最多3个在途get过程 + 60秒局部缓存（identity/id/version） + 宿主tRPC查询缓存**。刷新或保存后清缓存并读list，版本变化后重新获取；旧任务响应离开作用域即丢弃，缓存最多100个键。没有每行挂 useQuery，不预取全页；切换页签对命中缓存不新增 get。

真实3行数据首屏：1个list HTTP + 1个get HTTP批次（3个get过程）；切换全部五页签额外get=0。最终5行数据的实际首屏计数见 `browser-edges.json`。20行仅响应拦截压力样本：首屏可见10行，10个get过程分4个HTTP请求（3、3、3、1），最大批次3；切换页签新增0；滚到底部总计20个唯一get过程，没有重复。证据 `performance.json`、`verify_performance.py`、`screenshots/stg-visible-performance.png`。压力样本不调用虚构ID的真实后端，也不是生产性能压测。

## 刻意偏离 demo

demo 元数据卡横跨顶部，本任务明确要求客户与交付在左栏，因此新版将该卡移入左栏，货源放其标题栏，右栏利润从顶部开始。添加了“重新读取”按钮用于CAS与网络核对；页签/真实当前页汇总遵循文字要求（原截图未包含它们）。多批次分配明细作为每行附属控件，保留现有items+allocations能力，因后端禁止修改已存在行身份而不提供虚假的移除按钮。无权限不显示“成本待核/利润0”，而完全隐藏敏感块。需求交付复用原批次分配组件是为避免破坏已有流程，视觉细节未完全换成右卡内表单。

## 预发布部署环境修复说明

执行过要求的 `stg_deploy.sh sal 3103 out.js`。共享 `up.sh` 的本机/远端 `/tmp/upc` 被并行上传竞争，脚本又未失败即停，导致压缩文件损坏；另外 `/opt/stg/adm_sal/dist/index.js` 原为指向 `/opt/stg/admin/dist/index.js` 的软链，import.meta.dirname让3103实际服务共享admin静态目录，部署后看到的还是上一版。只将销售专用运行文件按原内容复制为本地实际文件，使用允许的 `fuser -k 3103/tcp` 重启3103，未修改共享/生产运行文件。之后使用 `deploy_safe.sh` 唯一临时文件、完整sha256确认，再更新专用index；最终页面和浏览器截图均为实际3103新版。

## 后端缺口汇总（未擅自修改）

1. revise没有下单日期/税率/物料身份/新增或删除行入参。
2. get/candidates不返回行单位成本与采购货款/费用拆分；仅有聚合采购成本与利润。
3. list没有利润/物料/全库汇总和待收款/待出货过滤入参。
4. completed不是后端独立状态，需前端按实际收款/出货派生。
5. createCompanyStock/create均无创建费用字段，必须创建后revise；两步非原子，本前端已处理第二步失败并禁止重复创建。
