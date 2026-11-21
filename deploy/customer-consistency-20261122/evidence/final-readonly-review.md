# 最终局部只读 QA：PASS（foundation 修复后）

审查时间：北京时间 2026-11-22 01:11。W=`/home/ubuntu/work/customer-consistency-release-20261122-0034`；真实源码 R=`/home/ubuntu/work/channel-release-20261121-1837/manager`。

**独立离线只读核验 PASS，原 CSS foundation 缺失阻塞已解除。** 本结论不是生产发布 VERIFIED，也不是生产账号已读落库验收。审查时 `candidate/manifest.json` 的 `tests.status` 仍为 `PENDING_FINAL_TARGETED_CHECKS`；当前 sourcePins 字节核验相符，但父仍须完成最终 freeze 和 tests PASS 收口。发布客户端在连接 SSH 前要求上述 tests 为 PASS；本 QA 未修改或绕过门禁。

旧 BLOCKED 报告已按“不存在才保存”归档为 [final-readonly-review-before-foundation.md](/home/ubuntu/work/customer-consistency-release-20261122-0034/evidence/final-readonly-review-before-foundation.md)。其失败结论及旧夹具边界不被追溯改写。本轮仅归档和写报告；未改应用、candidate manifest、测试脚本、生产或 Git，未执行 SSH、发布、六场景重跑或全站测试。

## 实际 CSS 组合与部署链：PASS

独立按 bytes 重新核对最终候选 CSS，精确等于：旧 `0cd15c6df7928beb` CSS 全部 13,416 bytes 前缀，加明确分隔注释，加真实源码开头至 `/* Workbench release: geometry only, retain existing typography and eight columns. */` 之前的 8,351 bytes 客户局部 foundation，再加本次 4,204 bytes suffix。不是只验证 suffix 存在，也不是补载整份源码 CSS。foundation 本体未包含 `.aui-page-header`、`current-location` 或 `subgrid`；历史 header/subgrid 段没有新搬入，原旧 CSS 已有 bytes 则完整保留。

实际最终 CSS SHA256 为 `cf40aaf6c37f2fa53c09fb2844dfd8e221c6330b50c7eb8a4af2a77c96d09b76`，26,054 bytes。最终 HTML SHA256 为 `319ed68fdf73704daefd944ca28fce11a970ca4e041dc56f5ef171670600b22f`。独立逐条重算现有几何证据全部 **51 条**有效 CSS 文件 SHA，并核对其 URL 顺序恰等于最终 HTML stylesheet link 顺序；只有 index **50** 原 unread CSS 被最终 CSS 原位替换，没有另行 append 或源码旁路。

foundation 的外层 `.customer-list-table-scroll` 为横滚 owner，内层 `[data-slot="table-container"]` 显式 `overflow: visible`；表格为 `table-layout: fixed`，demand/actions colgroup 通过局部变量固定预算，两个操作列的 sticky 位置与 right 偏移相符。最后 suffix root 显式 `demand=128px / actions=88px`，覆盖 foundation 旧 demand112。最新普通列预算为行业112、联系人244、阶段132、负责人96、供应232、需求128、动作88；公司列只吸收280–360px，整表有限1312–1392px。公司名 nowrap/ellipsis 并保留 title；star/unread 不缩没。供应双动作可同排，异常内容允许增高或换行，未使用固定 tr 高度、隐藏动作或截断动作文字。

父修后的 [静态日志](/home/ubuntu/work/customer-consistency-release-20261122-0034/evidence/final-static-after-foundation.log) 与 [静态结果](/home/ubuntu/work/customer-consistency-release-20261122-0034/evidence/final-static-review.json) 均为 PASS。已读取更新后的脚本，确有 old+foundation+suffix 的 exact assert，同时保留每 WB 两个布局槽、全包 inverse、真实 WB1 alias、成功 main witness、accepted 正合同和原 fresh-receipt retry guards。本 QA 未运行或修改该脚本。

## 既有六组几何原始断言与数值：PASS

读取 [geometry.json](/home/ubuntu/work/customer-consistency-release-20261122-0034/layout/evidence/geometry.json) 和 [修后运行日志](/home/ubuntu/work/customer-consistency-release-20261122-0034/evidence/final-geometry-after-foundation.log)，确认六组都 PASS：WB0 的1920、1560、1280和390px，以及 WB1 的1560和390px。未发现 JSON、日志、最终资产或原断言之间的不一致，因此不重复运行。

WB0 1920/1560 与 WB1 1560 的短名页和长名页整表均1392px，八列为 `[360,112,244,132,96,232,128,88]`。WB0 1280及两个 WB 390的两页均1312px，八列为 `[280,112,244,132,96,232,128,88]`。所有 pageWidth 都等于 viewport，innerOverflow 都为 visible；需求列和跟进动作列均 sticky，right 分别88px和0px。原脚本继续检查翻页前后各列表头位置和宽度稳定、表头/单元格对齐、公司单行及完整 title、star/unread 在预算内，以及供应动作不越出所属单元格。普通一动作/双动作行都是49px，长公司名没有使普通行增高。

390px 下 toolbar 主动作 y=21，过滤区域 y=63，主动作在独立首行；桌面主动作和过滤区顶部均 y=25。供应两个按钮各自通过唯一横滚层移到 sticky 覆盖之外，且原 `elementFromPoint` hit 断言成功：两个 WB 的上传按钮 scrollLeft=879，x≈33.39、right≈98.39；查看库存按钮 scrollLeft=952，x≈33.39、right≈133.09。它们不必在390px下同时可见，但都能分别完整到达，未以裁切或隐藏取得通过。

实际未改 pageMemory 的返回证据为 WB0 1280 `saved70 → restored70`（目标80受到最大滚距钳制），两个 WB 390均 `saved450 → restored450`，且仍为第2页、返回后两个末列保持 sticky。六场景 `fixtureErrors=[]`、`forbiddenNetwork=[]`，总 `errors=[]`。WB1 fixture 的 `qe=useListPositionRestore / we=confirmCustomerFilters` 与真实模块导入和调用一致，仅属离线 alias 纠错，不改 native。

## 通知及原列表回归：复用 PASS，未重跑

[最终通知 DOM 证据](/home/ubuntu/work/customer-consistency-release-20261122-0034/evidence/final-dom/offline-dom-results.json) 为 PASS、19场景，记录的两个完整 WB 与当前候选一致：`d2d15dd34c5cdf0df1644318ddf499d38e3ea6656656b2d6e70ff4d27655e339` 和 `a24dc29e7d929523007e9f701a970e25c75e63bfcb2b7bbe43db9d48c3e7746c`。浏览器通知 JS runtime `cff8bad8c4d94617cb9b77e0280ab4713cee5a844bec551dc3c1d1a7b4ebc9fd` 及其 sourcePins 当前精确相符，foundation 修复未改变这三项资产。

复用既有19场景和 [32个列表原生交互结果](/home/ubuntu/work/customer-consistency-release-20261122-0034/layout/evidence/native-regressions.log)，未重复。通知证据包含同页双 QC 在 BroadcastChannel 可用、缺失或构造抛错时 accepted 后刷新；新合格 temporary lastKnown90替换旧91、unknown temporary0不冒充清零；缺凭证、账号类型不匹配或 mark 失败显示未清除状态；显式 retry 获取 fresh receipt；顶部摘要失败可见，顶部重查不重复 mark。原静态审查的账号/代际/权限/module/商户边界、epoch/sequence 迟到防护以及广播不递归结论继续保留，不将客户端响应顺序解释成服务端任意历史时间线。

标准 `pnpm check` 记录仍有既有服务器 `adminNewInformation.ts(819,33)` 的 ES5 MapIterator TS2802，不能写成标准全项目 check 全通过。父的 fresh ES2020/nonincremental 通过结论沿用；本轮未修改 target、后端或重跑类型检查。

## 发布脚本只读边界：PASS

只读逐段审查 `release-remote.py` 和 `release-client.py`，并与前次 `customer-unread-hotfix-20261121-2353` 脚本 diff。前次本地 receipt 为 `VERIFIED / closed=true / apiReloadGroups=[] / runtimes=[]`，且仅 adminHTML changed；前次 post-check 记录 durable closed 和双锁释放。当前远端脚本确实仅改 SCOPE 与 INPUT_PATTERN，恢复流程未改。客户端除 scope、input/script 名称外另有一处 `beforeStat: fresh[label]['stat'] → rec['stat']`。两者此前已逐字段比较除 atime 外相同，远端再次核对 capture 非 atime 字段，并以锁内读取的完整 stat 做即时 CAS，因此这处变化未扩大范围或减弱锁内 CAS；如需宣称“客户端也仅改名称”，必须保留这一事实例外。

本候选恰有4项全是 admin immutable assets：两个融合 WB、浏览器通知 JS 和一个 CSS，SHA及size全部当前核验相符；客户端仅打包这些 admin资产，runtimes始终空。四 target 中仅 adminHTML 带替换 bytes；frontHTML和两 API payload 为 None，远端从锁内原文件取得 no-op bytes，禁止这些目标 before/after SHA不同，并检查其原 inode/非atime metadata保留。**浏览器通知 JS 名字含 runtime，但它是 admin静态 asset，不是服务器 runtime 变更。** 原有资产和服务器 runtime 只作为 existingFiles SHA依赖检查。远端保留 PM2 jlist 只读状态检查；reload函数虽仍存在，但本候选 API no-op、api_touched为空，使 apply/rollback reload均不可达，且成功末端再次要求空 reload ledger。

保护保持：两个固定锁非阻塞独占、lock inode核对；fresh协调窗 closed/无恢复标记及完整coordSHA检查；目标bytes+全部锁内metadata即时CAS；root0600 staged输入、nonce绑定、拒绝重复JSON key和路径别名；stage不可复用、备份精确复读、文件及目录fsync；immutable assets只link不replace，碰撞只接受完整相同SHA；adminHTML以私有准备inode原子replace并记录ownership。

失败时仅恢复自身owned target，外来bytes/inode漂移不强行覆盖；恢复核验不完整进入failurehold，持久化恢复标记并持续保留双锁，不自愿解锁。成功或已验证回滚都必须协调窗durably closed、完整receipt写入复读成功，才释放双锁。客户端读取并断言 VERIFIED、closed、仅adminHTML changed、空API reload/runtimes，随后独立核验coord最终SHA和可重新取得双锁；`finally`关闭SFTP/channel/SSH。以上只是源码边界审查，不代表这些动作本轮已在生产执行。

## 明确验收限制

所有几何与通知业务接口均为显式 offline mocks。通知19场景实际渲染 native detail main，但可见性/observer和receipt/transport为mock；`fixtureSeen`不是数据库seen。**本报告不证明生产账号授权、真实签名receipt、生产RPC合同、seen持久化或客户详情访问已在真实账号完成。** 发布脚本仅以匿名 GET 验证公开页/静态assets及 unreadRefs授权阻断，receipt本身明确“非 authenticated unread/markDisplayed功能验证”。没有真实业务mutation、SSH操作或发布，本轮 PASS只解除离线最终QA阻塞；生产发布和真实账号验收必须分别陈述。
