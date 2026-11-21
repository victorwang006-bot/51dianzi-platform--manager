# 最终局部只读 QA

时间：北京时间 2026-11-22 01:04。真实源码 R=`/home/ubuntu/work/channel-release-20261121-1837/manager`；工作目录 W=`/home/ubuntu/work/customer-consistency-release-20261122-0034`。

## 总结：BLOCKED

**通知局部静态审阅 PASS；完整当前 CSS 链的六个既有几何场景全部 FAIL，不能签发最终发布 PASS。** 已具体定位原有源码 CSS 与真实静态产物缺口。没有修改应用源码、Git、SSH、生产数据、布局候选、manifest 或发布；仅修改/生成 QA 脚本、QA 夹具和证据。父必须先评估并修复相关静态产物一致性，随后仅重跑受影响几何。

### 完整当前 CSS 链的实质布局阻塞

本轮使用父提供的完整当前 **51 条** CSS，逐条本地文件 SHA 核验成功；在原 index **50** `/assets/customer-unread-hotfix-0cd15c6df7928beb.css` 链位替换为最终 `/assets/customer-consistency-e98ef07fb5b6c01c.css`，没有额外 append。几何脚本还逐条断言实际有效 stylesheet 链顺序等于最终 candidate HTML 的全部 link 顺序。六场景均在 `one outer horizontal scroller` 断言失败：实际 Table 内层 `overflow-x` 为 `auto` 而非 `visible`。

真实源码 `components/ui/table.tsx` 17–20 行生成 `data-slot="table-container"`，含默认 `overflow-x-auto`。源码 `CustomerList.css` 119–122 行本来使用 `.customer-list-page .customer-list-table-inner[data-slot="table-container"] { overflow: visible; }` 局部覆盖；但此 selector 在完整当前 51 样式及新候选 CSS 中均不存在。此前降级夹具额外直接加载整份源码 CustomerList.css，因此没有暴露此缺口。当前 layout 构建把此次源码 suffix 追加到此前 unread CSS，未携带源码原有局部列表基础规则。

失败首屏数据还证实需求/跟进列都为 `position: static`，而非保留的 sticky；WB0 1920px 下八列宽为 `[224,112,244,132,96,232,128,224]`，WB0 390px 为 `[184,112,244,132,96,232,128,184]`。表宽本身分别达到 1392/1312px、页面未溢出，但公司列尚未达到计划的 280–360px，最后两列也未取得声明的稳定预算。不能忽略这些原有列/操作保留风险，只认可新增 min/max 规则。

| 场景 | 本轮最终结论 |
| --- | --- |
| WB0 1920 | FAIL：内层仍为横向 auto scroller |
| WB0 1560 | FAIL：同上 |
| WB0 1280 | FAIL：同上 |
| WB0 390 | FAIL：同上 |
| WB1 1560 | FAIL：同上 |
| WB1 390 | FAIL：同上 |

失败发生在后续可达性、翻页和返回 memory 断言之前，**未据此证明修正别名后的 WB1 390 memory 已通过**。所有原断言保留，未删断言、未绕过失败。结果：`layout/evidence/geometry.json`；日志：`evidence/final-geometry.log`。单独阻塞说明：`evidence/final-readonly-blocker.md`。

## WB1 离线记忆别名修复：有真实导入与调用依据

已在当前真实 WB1 `__CW_CUSTOMER_LIST_UPDATED_20261116_GET` 中核对桥接：`qe` 为 `hooks/usePageMemory#useListPositionRestore`，`we` 为 `lib/pageMemory#confirmCustomerFilters`。当前 `vt` 有一次 `qe(u,!!C&&l&&i.ready&&!s.isPending&&!s.isError)` 与两次 `we()`，与真实源码 CustomerList.tsx 1–2 行导入、310 行恢复、483/500 行确认筛选调用一致。

因此仅修离线夹具为 `vm.tb=vm.qe=useListPositionRestore`、`vm.we=memory.confirmCustomerFilters`。未改真实 pageMemory、应用 native 代码或布局 manifest。构建脚本新增两个显式绝对 WB 输入，只覆盖 QA native-input。最终几何测试采用将发布的完整 WB0 `d2d15dd34c5cdf0df1644318ddf499d38e3ea6656656b2d6e70ff4d27655e339`、WB1 `a24dc29e7d929523007e9f701a970e25c75e63bfcb2b7bbe43db9d48c3e7746c`，而非 detail 演练产物或旧布局候选。

原失败完整保留于 `evidence/finalqa-before-geometry.json`/`.log`：当时 WB1 390 horizontal memory 恢复 FAIL，其余五项 PASS，且 CSS 模式明确不是完整部署链。原失败未被隐藏或改写为成功。

## 通知静态审阅：PASS

只读检查了当前 Git diff 的八个改动文件：计划/TODO 两份记录、CustomerList.tsx/CSS、CustomerDetail.tsx、AdminNewInformationBadge/MenuBadge、adminNewInformation.tsx。没有扩查或修改其他模块。

同页注册按类型敏感账号 token、当前 generation/valid、业务 module/商户 scope 筛选，并按原 QC 去重；顶部只 summary，业务只同模块/商户 inspect/unreadRefs。disabled 与旧身份注册不会参与；受 accepted 的迟到回执仍经过 access.valid、controller 和当前 rowIdentity 围栏，不会通知新边界。失效 epoch 在取消旧查询前同步推进，summary 另有单调请求 sequence；即使 mock transport 忽略 AbortSignal，迟到 summary/unreadRefs 仍受 signal/valid/epoch/sequence 检查。

`rejectedMark` 正合同保留：非负安全整数 marked、accepted 等于完整去重 receipts 数量；只有通过合同和当前边界检查才记 seen、解 latch 并触发失效。没有 accepted 前客户端清读，没有本地减数。最新合格服务器 temporary/lastKnown/count 可替换旧数值；unknown temporary 0 不冒充清零；撤权或身份代际变化清除此前证明。广播接收路径只刷新，不 postMessage；本地同步不依赖 BroadcastChannel。

详情原成功 `<main ref={newInformationRow.ref}>` witness 与加载/错误无 ref 分支未改。mark 失败不自动重试；原 `retryDisplayed` 重新 inspect 取 fresh receipt，保持当前 mount、身份/商户、listReady、可见性、query、rowIdentity 和 accepted 守卫。顶部重查只走 summary.refetch，不重放 inspect/mark。readAcknowledged 由当前 row verification confirmed 给出，不能靠独立缓存 false 绕过通知账号门禁。

`layout/tests/final-static-review.mjs` 已 PASS，证据 `evidence/final-static-review.json`/`.log`：布局原生每 WB 两槽、完整 inverse 精确恢复原包、旧 CSS 前缀及源码 suffix 一致、正确 WB1 别名桥接/调用、成功 main witness、加载错误不 ack、accepted 正合同、freshreceipt retry 字节保持、广播不递归。这里的 CSS suffix/source 一致只证明增量构建，不等价于完整真实链包含全部源码已有基础规则；本次全链几何正是发现了此边界。

通知 runtime `cff8bad8c4d94617` 的源码 pins 和资产 SHA 校验 PASS。信任并复用原通知 agent 19 场景及原两 WB 各 16 个列表场景（共 32），不重复全套测试；父 01:03 通知最终完整 WB 的 19 场景再次 PASS。

## 类型诊断

`evidence/typescript-standard.log` 显示原标准 `pnpm check` 只有既有 `server/services/adminNewInformation.ts(819,33)` 在 ES5 target 下的 MapIterator TS2802。**这是既有服务器诊断，不代表本次前端类型失败；不能把标准项目 check 写成全通过。** 父 01:03 通知 fresh ES2020、nonincremental 的全库 tsc 通过；此前改变 target 却复用 incremental 的旧诊断已在 fresh 检查消除。本 QA 仅读取现有诊断，不修改 tsconfig 或后端，不重跑全项目检查。

## 证据边界与未做事项

几何使用本地 `/usr/bin/chromium` + Playwright、从最终完整 WB 精确提取的原生列表函数、实际 React Table/CompactListToolbar/Contacts/Supply/Badge 与未修改 pageMemory。客户/TRPC、供应、联系人、身份及未读接口为显式内存 mock；没有生产访问、真实业务 RPC 或业务 mutation。六场景没有浏览器 runtime 错误；没有生产页面截图交付。

离线证据不证明真实账号授权、签名 receipt、RPC 合同、数据库 seen 持久化或生产实际客户访问。没有服务端 revision/asOf，不能把客户端最新完成响应顺序称为服务端任意历史时间线可比较。父负责最终详情补丁、HTML/引用集成、源码提交与发布；本 QA 只交付明确阻塞，未执行任何发布或真实账号验收。
