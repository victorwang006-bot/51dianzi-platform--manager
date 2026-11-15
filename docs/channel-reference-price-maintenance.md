# 渠道参考价格补充与日常维护

## 最新实际状态：2026-11-15 11:27:50，已发布但外站手动取价未启用

本次v3精准增量已成功发布到原后台 https://admin.51dianzi.com/ 。最终294组完整型号/品牌、588份来源中，有效参考报价189份：立创137、云汉52；新增5份，原184份成功报价和证据保留。新增资料是恢复的历史公开读取事实，不是本次ECS重新实时取价。STE145N65M5和TL432IDBZT等缺口已写入应用及实际运行快照；前面的186份待发布描述属于09:40历史稿。

来源时间轻量入口、当前页主动重查的授权和取消保护、来源适用品牌规则、默认禁用的文件配置实现均已上线。外站手动重查仍禁用：真实供应商链存在访问限制/未取得完整目标DOM，未预置配置或缓存，不声称按钮已有可靠实时取价能力。普通刷新和翻页仍只读保存结果。

运行ROOT为`/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3`，功能与控制源码提交`9a5c55bd02396ab3cfc13f903e87ecd69b24532e`，快照SHA256为`e21df84339d5265f9358be54c1935157ebe90e1088e67e6b05c0550a9e3af8dc`。真实唯一v3 apply成功，发布窗口已关闭，独立verify确认12个实例online、仅两个后台实例滚动重载、其他10个PID与环境等字段不变。后台HTML、两份工作台JS、局部CSS和主站HTML的5个公网HTTP200内容哈希均匹配预期。0业务写测、0数据库迁移。详见同目录`channel-reference-remediation-20261115-handoff.md`和本批次私有验收资料。

原71组补查仅恢复到9组完整双来源结果；剩余62组有独立输入与待确认的续接草案，不重做已完成9组，不把历史调度状态无法恢复写成“已完成”或“未开始”。本文不会开启定时任务或自动采集。

本文用于重复开展渠道参考价的人工核查、补充、验收和交接，不是定时任务、自动抓取授权或新的操作技能。参考一为立创商城，参考二为云汉芯城；外部参考不得覆盖业务库存、原报价、可供数量、渠道来源、客户绑定或订单，不自动形成真实报价或采购动作。

## 1. 先确认实际状态，不把研究结果当成上线

**本稿状态截止：2026-11-15 09:40（北京时间，UTC+08:00）。** 项目最新工作状态见 [渠道参考 TODO](../TODO-navigation-channel-reference-20261114.md)，以最新实际发布回执为准，不能仅看历史勾选或源码是否存在。

上一轮真实上线的是批量网页采集快照、简洁单价与渠道库存、平铺同宽、页码直达及完整原始料号轻复制。历史范围为299条授权库存、294个原始料号/品牌组合、588份来源记录，其中184份有效参考报价；这是当时样本，不是以后每轮必须达到的数量。线上快照的浏览器刷新或库存刷新只是重读保存数据，不会重新访问供应商网站。

本轮仓库源码已补齐来源适用的显式品牌规则，增加当前页主动“重查未匹配”、来源与时间查看、私有参考缓存及默认禁用的文件配置入口。更新后的受影响前端离线检查已通过；后端有实际解析、权限与临时文件系统检查。这些均不等于生产已部署、手动重查已启用或当前 ECS 公开取价链已可靠。STE145N65M5、TL432IDBZT 的两条历史真实证据已在仓库外暂存并通过实际 TS 校验：候选有效报价为186份、旧184份及证据不变，但该候选尚未写入应用快照或发布。另有71项独立补查工作流在进行，当前不能写为已完成，也不能预报新增报价数。

最终发布负责人应在文末补记实际释放状态、版本和回执。**研究完成、暂存通过、源码完成、生产发布、功能启用是五个不同状态。**

## 2. 每轮人工维护步骤

1. **确定范围与预算。** 从当前用户真实有权读取的库存列表取得完整原始料号和品牌，保留当前页/客户企业作用域和权限边界；不直接导出无授权全库，不把客户、联系人、内部渠道和原业务报价发送外站。按原始 `partNumber + brand` 去重，同一组合的授权行共享公开结果；同料号不同品牌不得合并，原始大小写、符号、括号与包装后缀仍保留。记录本轮实际行数、组合数、已知成功、待查范围、截止时间和剩余预算。
2. **生成去重候选。** 优先取读取失败、未取得公开价、已证实来源适用别名规则差异及明确用户反馈的并集，保留每条入选原因。历史一次为28组 `unavailable`、16组 `price_unavailable` 与44组品牌风险的并集74组，不能直接相加，也不能认定74组全部漏报价；以后重新按当前数据计算。保留已有可靠结果，只补缺口。
3. **逐项正常公开核查。** 先准确搜索完整型号和品牌，再从身份已确认的主商品行进入对应详情。采集完整梯度、实际库存、币种、单位、税务、包装及读取时间，保留公开页面原文/HTML/截图、实际访问 URL 和 SHA256。不要只凭搜索摘要、推荐区或一段价格文本填价。
4. **保存部分结果与真实状态。** 独立物料研究达到5项时，通过获准的工作流为每项安排一个专属研究单元；10项及以上必须按项展开，不用一个大任务循环猜结论。启动前重新确认当前授权、工具、并发/时限与工作流门禁。接续先刷新当前任务状态、复用已有结果，不复制暂停或已终止任务，不为了静默盲目重开。每项完成即落盘，临近当前截止时间及时汇总已完成、受阻和未开始项；不照搬“固定冻结两小时”或无限等候。
5. **离线暂存与核验。** 在独立工作目录保存新证据及候选，不直接改生产快照。逐来源列出身份、状态、价格与证据的前后差异，用当前真实 TS 验证器及实际默认快照加载器检查全部来源，证明未改目标和旧成功价完整保留。失败结果不能冲掉旧 `ok`。
6. **有发布授权才发布。** 把通过核验的候选、源代码与受影响检查回执交给发布负责人，按第6节 fresh 基线精准增量。未发布的结果在日志中明确标为“暂存”；本轮未完成项连同真实阻断留给下次，不虚构无结果或零价。日后需要再维护时重新人工启动，不由本文自动创建 cron、轮询监控或周期作业。

## 3. 身份、价格和失败状态的判定口径

### 完整型号与来源定向品牌白名单

型号必须完整匹配，保留封装/包装/环保等后缀。`LM1117MPX-3.3` 与 `LM1117MPX-3.3/NOPB` 是不同输入，不能删除 `/NOPB` 接价；其他原始后缀同理。品牌只接受准确厂牌或有可靠公开依据、适用于该来源的**有方向整词映射**。不要删除括号、用子串/前缀、反向或传递推断、自动修正疑似错拼品牌。

品牌规则应在立创搜索与详情、云汉、缓存校验及快照读取中一致使用来源适用的白名单，而不是无条件复制所有别名。当前源码将原66组历史定向别名用于立创与快照，其中62组适用于云汉；4组 Murata 特定立创文字仍受来源限定。`ST → ST(意法半导体)` 可接受，`ST → ST(先科)` 必须拒绝。修改映射时保留公开依据，并以同一真实页面分别输入简称/全名验证结果一致；不是为了提高命中数而放宽身份。

### 采用哪个价格

立创参考一只取准确商品**自营主价格行的普通公开梯度**，不取合作库存、海外代购、会员、优惠券、补贴或活动最低价。云汉须确认准确型号、品牌及货源/批次；同款多条不同供应商无法唯一选择时保留 `ambiguous`，不默认第一条，也不跨货源取最低价。

选价规则是同一准确商品公开阶梯中**数量门槛最大一档的单价**，不是价格最低的一档、当前可买数量对应档或页面任何最低数字。保留所有 `tiers` 与原小数精度，校验 `tierQuantity`/`unitPrice` 等于末档；最大门槛与可供现货分开记录。价格须辨明“元/个”还是“整盘/整管总价”，包装数量不是库存也不是阶梯门槛；只有公开依据能确认换算时才记录换算及原值，否则保持未确认。

实际库存为0就记0，未披露/未读到就记 `null`，不取原业务可供数量补空。税务未披露不能猜含税；原证据缺失可记录 `null`，现有报价契约对应 `taxStatus: "unknown"`，只有公开文字证明时用 `included`/`excluded`。币种、计价单位未证实也不能补默认值。现货不足最大档时内部 `stockInsufficientForTier` 为真，不能据最大档参考价宣称当前可以买到该数量。

表格继续简洁显示例如“184.21，库存44”；真实0显示0，未知库存显示“库存未披露”，无有效价显示“暂未匹配”。币种、最大档门槛、税口径和失败原因保留在维护证据/诊断中，不为本流程额外扩宽表格或恢复大块重复料号悬浮窗。

### 等待和负状态

公开页加载时等待明确的目标主商品 DOM、明确无结果或明确访问限制；先看到标题、空 DOM、零条 SSR、无关价格或推荐详情不算“目标不存在”。正常读取允许一次有限跟进：等待后仅沿身份已确认的候选详情核验，仍不完整就保留失败，不重复翻无关商品。遇登录、验证码、限流、robots 禁止等立即停止，不换 IP/代理、不调用私有或第三方平台 API、不绕登录或反爬。需要用户介入时记录准确阻断并请求新的授权。

| 内部状态 | 使用条件 |
|---|---|
| `ok` | 完整型号/品牌及来源范围已确认，有可验证普通公开梯度和最大档单价。 |
| `unavailable` | 页面/传输/工具失败、空 DOM、等待超时、目标内容未完整取得；没有证明无商品。 |
| `not_found` | 正常完成目标搜索与必要筛选后有明确无准确匹配结果证据。 |
| `price_unavailable` | 准确商品身份已确认，但停售、询价或无可确认普通公开价格；若只是页面读取未完成，应记读取失败。 |
| `ambiguous` | 型号、品牌或同款多个货源/批次不能唯一选定。 |
| `access_restricted` | 明确登录、验证码、限流或访问限制；停止该来源后续尝试。 |
| `pending` | 当前显式手动会话确实已排队/运行，不用于假装常规刷新正在外查。 |

无成功价时空价格/库存保持 `null`、梯度为空，不造0。表格可以统一“暂未匹配”，但日志和诊断必须区分上述原因。旧快照不存在某身份的回退 `not_found` 也不是本轮真实外站搜索证明；是否访问过须另记。

### 补充更多来源，但不混进自营价

按完整型号及品牌查询已核验的制造商官网、授权分销商、合作库存和海外公开页面。制造商页可用于身份/生命周期/授权依据，未公开价格就只提供链接。分销商“授权”须有可核验依据，不能因网站自称或料号相近即认可。每个补充条目独立记录厂商/供应商、来源类别、完整型号/品牌、准确 URL、读取时间、价格梯度、币种/单位/税口径、库存、MOQ/包装、交期及优惠条件；不隐式汇率换算、不把条件价合成统一最低价。

这些条目作为独立补充证据保存，不向现有严格两来源 `references` 添键，也不改为立创自营 `ok`。搜索链接明确标为“完整型号公开搜索（非匹配商品）”，未确认详情不能称已匹配报价。历史材料中 UWX1C101MCL1GB / NICHICON 曾正常读取云汉[海外现货详情](https://www.ickey.cn/detail/1003001439141511/UWX1C101MCL1GB.html)与 [element14 货源详情](https://www.ickey.cn/detail/100340149120569/UWX1C101MCL1GB.html)，记录时间为 `2026-11-14T09:15:24.808Z`（北京时间17:15:24.808）；不同货源报价且询价/库存0仍保留歧义。这证明“有更多可核验链接”不等于“可合并为唯一报价”，也不是本稿进行了新读取。

## 4. 三个正式案例：采用、带条件采用与排除

| 完整型号 / 原品牌 | 历史公开证据与读取时间 | 维护结论 |
|---|---|---|
| STE145N65M5 / ST | [自营详情 C2970194](https://item.szlcsc.com/3362658.html)，[搜索主行](https://so.szlcsc.com/global.html?k=STE145N65M5)为 ST(意法半导体)，1+191.09、30+184.21 CNY/个、含税，库存44。实际 DOM 读取 `2026-11-14T16:46:27.438Z` / 北京时间2026-11-15 00:46:27.438。 | 已确认漏匹配。最大档单价184.21、门槛30、库存44，补价同时修复来源适用品牌规则。保留原 HTML 哈希；后来报告生成时间不替代 DOM 读取时间。本轮固定 HTML 重放不是新实时抓取。 |
| TL432IDBZT / TI | [自营详情 C1848456](https://item.szlcsc.com/1939269.html)，[正常可见搜索行](https://so.szlcsc.com/global.html?k=TL432IDBZT)为 TI(德州仪器)，1+5.23、10+4.24、30+3.75，库存15。读取区间 `2026-11-14T16:51:02.000Z` 至 `16:51:23.000Z` / 北京时间2026-11-15 00:51:02至00:51:23；暂存使用已获确认的区间终点。 | 已确认漏价；最大档3.75，库存15小于门槛30，内部不足档量为真。证据来自历史独立报告，详情价格面板当时仍加载；本地未保留 TL 原始 DOM，包装/币种/单位/税口径依据已确认交接，不伪造截图、HTML 哈希或新读取。 |
| LM1117MPX-3.3 / TI | [准确自营详情 C2866035](https://item.szlcsc.com/3070712.html)，[搜索页](https://so.szlcsc.com/global.html?k=LM1117MPX-3.3)；历史读取北京时间2026-11-15 00:52:21（UTC `2026-11-14T16:52:21.000Z`），自营停售。 | 不是已确认自营漏价，不能把 `/NOPB` 变体接到原型号。搜索页合作/海外价格仅能独立记录条件和供应商；保留自营无公开价，不借此改为自营成功。 |

原调查还曾跟进 WRB1212S-3WR2 / MORNSUN 时读到 TWRB1212S-3WR2L / TDPOWER 的详情。型号与品牌都不同，必须排除；既不能用其价格补目标，也不能据此判定目标不存在。

## 5. 现有数据契约、管线与手动入口

### 使用现有结构，不新建业务写入流程

代码入口为 [service.ts](../server/channelReference/service.ts) 的实际导出 `lookupChannelReferences`，当前源码使用快照优先的文件配置手动协调器。普通构造、默认查询及翻页不启动外站取数；不要把同文件仍存在的旧工厂当成当前生产入口。授权 BFF 为 [channelReferenceRouter.ts](../server/channelReferenceRouter.ts)，输入仍为当前 `listInput`、最多20个当前授权 `materialIds` 和可选 `refresh`，客户端不提交品牌、型号或任意 URL。

批量快照为 [channel-reference-snapshot.json](../server/channelReference/channel-reference-snapshot.json)，严格结构由 [snapshot.ts](../server/channelReference/snapshot.ts) 和 [shared/channelReference.ts](../shared/channelReference.ts) 定义：

- 根：`schemaVersion: 1`、`collectionMode: "public-web-batch"`、`generatedAt`、`records`；每个 record 恰为 `partNumber`、`brand`、`references`、`evidence`，两来源恰为 `lcsc`、`ickey`。
- quote：`source/status/matchedPartNumber/matchedBrand/productCode/pageUrl/stockQuantity/unitPrice/tierQuantity/tiers/currency/unit/taxStatus/packaging/fetchedAt/expiresAt/stockInsufficientForTier/message`。单价为字符串；梯度为递增的 `{minQuantity, unitPrice}`。批量记录不保存 `pending`，`expiresAt/message` 为 `null`；负状态 `evidence` 为 `null`，价格、库存等保持干净空值。
- 成功 evidence：`expectedPartNumber/observedPartNumber/expectedBrand/observedBrand/brandMatch/literalReason/pageUrl/collectedAt/observedMaxQuantity/observedMaxUnitPrice/maxTierConfirmed`。匹配、URL、读取时间及最大档必须与 quote 一致；`maxTierConfirmed` 为真，定向别名的 `literalReason` 保留观察到的厂牌整词。

时间用实际读取的毫秒 UTC ISO 字符串，`generatedAt` 不得早于记录读取时间；旧记录的读取时间不随重打包改成“现在”。文档/日志可另列北京时间，不能把报告生成或解析重放时间写进 `fetchedAt`。

当前一次性数据工作目录是 `/home/ubuntu/work/channel-reference-remediation-20261115/data/`：`confirmed-two-facts.json` 为历史证据事实，`stage-confirmed-two.py` 只离线暂存指定两条，输出 `channel-reference-snapshot.staged-two.json`；它有本次固定身份/数量/哈希门禁，**不是以后直接重跑的通用采集脚本**。`validate-current-ts.mjs` 从当时真实源码编译并调用 `validateChannelReferenceSnapshot` 和 `createChannelReferenceSnapshotService()` 的默认 sibling 文件读取，产出前后实际执行记录、全部来源比较及源码哈希。`data-summary.json`、`full-changed-key-list.json`、`all-588-source-comparison.json`、`old-184-success-preservation.json`、`raw-evidence-manifest.json` 说明本轮真实边界。历史批量/合并脚本只能经新基线、新授权和来源核验后复用，不能套用旧成功数字或跳过实际 TS。

发布前检查本轮**实际所有来源**的身份、结构、URL、时间、最大档和库存语义；旧成功 quote/evidence 以及非目标来源须内容相等，并保留原始字节/哈希和证据。源码/输入前后哈希须一致，校验器不能用宽松自写替代品。当前脚本的合成编号只用于离线比较，不是库存权限证明；真实接口还必须逐次授权。失败采集不可覆写成功参考，但损坏或身份不符的数据亦不能为了保留旧价而绕过验证。

### 默认禁用；只有明确人工请求才启动

早期交接中的三项 `CHANNEL_REFERENCE_MANUAL_*` ENV 方案已被当前**文件配置**集成取代，不能照着修改 PM2 ENV。控制定义见 [manualRefreshConfig.ts](../server/channelReference/manualRefreshConfig.ts)：固定描述文件 `/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json`，严格四键为 `version`、`enabled`、`cacheDirectory`、`workerSha256`。配置缺失、无效、关闭、权限或 worker 哈希不符均禁用。

启用前由获准发布负责人预置独立私有目录，服务 UID 所有、目录0700、普通单链接非符号链接文件0600，路径及祖先安全、缓存位于 `/var/lib/` 且在不可变 `/opt/ops` 发布 ROOT 之外。配置绑定实际编译入口的固定 sibling `channel-reference-worker.mjs` 哈希；不接受可配置 worker URL/路径。**先独立证明真实 worker、浏览器二进制完整性、执行 UID 的可读/可执行权限和正常公开取价链，再配置启用，保持原 PM2 ENV 不变。** 旧浏览器存在或 `--version` 成功只证明能力，不证明完整网页取价；不能 chmod 整个发布包/旧 ROOT 来绕过权限。

实际主动会话只对当前授权行尚无成功价的来源：点击一次 `refresh:true`，随后同页 `refresh:false` 查询进度，不反复 true。当前前端每4秒查询、最多90秒，翻页/筛选/权限/身份/卸载变化即取消并拒绝迟到结果；队列最多20个来源身份，不是20条库存（两来源可达40），冷却/满队列/受限/禁用均如实显示。当前后端每来源/身份20分钟冷却、来源启动间隔60秒，全局单浏览器，正常 DOM 等待55秒、浏览器墙钟58秒、native 子进程75秒上限；以当轮生效源码为准，不能擅自延长或循环重试。会话超时不宣称完成，false 查询不重新启动遗留工作；明确受限会在专用状态中阻断该供应商，需新授权处理，不能清标记继续冲击。

[manualRefresh.ts](../server/channelReference/manualRefresh.ts) 的私有 `state.json` 根为 `schemaVersion/providers/records`；provider 仅保存 `nextAllowedAt/blocked`，record 仅保存公开身份、排队/开始/结束时间、attempt、quote、`sourceSha256/sourcePageUrl/version`。worker `--evidence` 输出 `{quote, sourceSha256, sourcePageUrl}`，成功必须是当前真实捕获 HTML 哈希与实际来源 URL，并通过当前身份/梯度/时间校验。版本摘要绑定 quote 和证据；[referenceStore.ts](../server/channelReference/referenceStore.ts) 用共享锁、0600临时文件、fsync及原子 rename 保存。不得手工伪造 `state.json`、把 fixture 输出当实时 worker 成功或加入客户/租户/内部库存数据。

成功缓存过冷却期仍可作为带原读取时间的历史参考读取，不自动外查，也不覆盖已有成功来源。诊断是顶层可选 [refreshDiagnostics](../shared/channelReferenceRefresh.ts)，其中当前 `materialId` 只用于已重新授权响应，**不持久化业务身份**；旧价、最近尝试时间、来源版本和本轮完成状态分开解释。

## 6. 发布与验收：只沿用当前真实基线

这是外部私有 ECS 的精准增量维护，不是新建站点或整个网站重构。每轮由发布负责人使用新获准的工具与授权，重新只读捕获**当前** ROOT、manifest、实际 Git 来源回执、源码图及 HTML/API/helper/data 运行字节；所有12个实例的 PID、ENV、CWD、script、配置须在前后实际核对。基线漂移就停，不用上一轮 commit/hash/PID、旧 namespace 或旧保护清单推测现在。

历史本轮前置 ROOT 是2026-11-14 adjustments 发布，源码绑定 `c4b48ba…`；当时仅后台 PM2 ID 191/192 顺序重载，其余10实例保持。这些仅是历史证明，**不保证未来仍由同一 ID/PID 承担角色**。以后先以 fresh 捕获确认当前两个 owned 后台实例及其角色，再按已批准包执行仅 owned 重载、空 ENV 覆盖，不能 `reload all`。

保留现有双锁、共享协调窗口、fresh HTML/API CAS、不可变 manifest、新独立 attempt 和 owned 精确回滚。失败包、原日志、状态/恢复回执留存，不重放失败 apply、不改 immutable ROOT 加未知文件。私有缓存配置/状态的所有权标识、包/哈希绑定与回滚保留/移除范围必须提前声明；只处理本次 owned 内容。旧 ROOT/资产、主站 API/HTML、其他进程、Nginx、启动 dump 及保护资源保持原字节。全程0业务写测、0数据库迁移，不做账号停用/SMS/改密来验收。

只跑现有受影响检查及当前协调的一次必要整体类型检查，不增加重复测试框架或固定数百条“全站门禁”。记录真实命令、时间、退出码、源码哈希与失败修复回执。实机发布后独立核对实际 HTTP 字节、运行 helper/data、全部实例和来源 Git 绑定；HTTP200本身不等于数据/源码一致。

**启用手动重查另需当前实际生产链证明**：在授权范围内通过真实当前入口产生一个完整准确公开 quote，附实际读取时间、来源 URL、捕获哈希；观察它进入正确私有版本、正常 false 查询读回、权限/页变化不泄露、旧成功不被失败覆盖。固定 STE HTML 重放、离线 fixture、fakeFS/PM2、浏览器安装能力或过去另一个环境的成功均不能替代。当前链受限或未完成，就保留禁用和快照功能，报告阻断；不要把前端按钮存在写成生产功能已启用。

## 7. 最小维护日志与交接

每个完整型号/品牌/来源保留一条日志，公开证据与发布回执放在获准的私有工作目录。下面是维护日志模板，**不是应用快照或缓存 JSON**；未知字段保持 `null`，税口径另写明确的 unknown，不填写内部客户信息或凭证。

```json
{
  "batch": "本轮标识",
  "partNumber": "完整原始料号（含后缀）",
  "brand": "原始品牌",
  "observedBrand": null,
  "source": "lcsc | ickey | 补充来源名称",
  "sourceType": "自营 | 制造商 | 已证授权分销 | 合作 | 海外",
  "readAtUtc": null,
  "readAtLocal": null,
  "actualWebRead": false,
  "status": "未开始",
  "selectedMaxQuantity": null,
  "unitPrice": null,
  "currency": null,
  "unit": null,
  "taxStatus": "unknown",
  "stockQuantity": null,
  "stockInsufficientForTier": null,
  "priceConditions": null,
  "sourceUrl": null,
  "evidencePath": null,
  "evidenceSha256": null,
  "evidenceLimit": null,
  "oldVsNew": null,
  "releaseActualState": "研究中 | 已暂存 | 未发布 | 已发布但未启用 | 已启用",
  "releaseReceipt": null,
  "nextAction": null
}
```

批次交接再简记：实际授权范围/行数/去重组合数、各来源状态和成功计数、已完成/未开始/受阻、全部变更键、旧成功保留证明、检查实际命令/退出码、候选及证据哈希、实际部署 commit/ROOT/时间/实例回执与开关状态。报价份数不当成独立库存行数，多来源重复命中不重复计行。没有新读取写“复用历史证据”，没有原 DOM 明确写证据限制，没有发布写“未发布”。

### 本轮最终实际释放状态（由发布负责人后补）

实际截止为2026-11-15 11:27:50。v3已发布且独立核验通过；实际开关为manual-default-disabled，配置及缓存未预置。原失败v1/v2包与日志保留，v2自动回滚后单独核验关闭，并将3个只属于本次且未被原HTML引用的新增静态资源按原哈希精确保存到私有隔离目录，未删除或改动旧资源。

本次发布工具发现的根因是冻结清单同时包括本次允许切换的协调文件、后台API和后台HTML。三者必须保留原采集行并按准确owned阶段验证完整前/后字节；其余文件继续完全静态冻结。不能为绕报错删保护行、接受任意新hash或重放失败apply。最终31个driver及25个attached案例通过且0跳过，包括三行同时存在的完整正向/两种失败回滚流程。涉及历史回滚仅两个owned PID和协调关闭记录变化时，也应另存真实只读新基线和精确差异，不改原采集证据。

XKB/中国星坤的字面关联可参考[制造商官网](https://www.helloxkb.com/)及[LCSC品牌页](https://www.lcsc.com/brand-detail/11722.html)，但不能据此忽略完整型号或无方向传递放行。

## 资料依据

项目内可从本页相对链接进入 TODO、实际类型/验证器、入口和缓存实现。以下为本次私有工作交接材料的位置，供获准维护人员定位；复制本文到项目 `docs/` 后，不要求这些沙箱工作目录长期存在，应将所需证据按本轮私有归档规则交接：

- 调查：`/home/ubuntu/work/channel-reference-investigation-STE145N65M5-20261115/漏匹配原因与修复建议.md`，以及 `additional-public-checks.json`。
- 上轮实际部署：`/home/ubuntu/work/channel-reference-adjustments-20261114/FINAL-DEPLOYED-HANDOFF.md`。
- 本轮实现：`/home/ubuntu/work/channel-reference-remediation-20261115/backend/backend-handoff.md`、较新的 `backend/config-file-integration.md`、`frontend/frontend-handoff.md` 与 `frontend/updated-reference-tests-handoff.md`。旧 ENV/前端失败状态已由较新交接限定或替代，原记录仍保留。
- 本轮数据与发布准备：同工作目录的 `data/data-summary.json`、证据/保留/实际 TS 回执，以及 `deploy-prep/DEPLOY-PREP-HANDOFF.md`、`CAPTURE-READY.md`。准备交接不是最终生产发布回执，必须与新返回的实际 capture 和最新状态核对。
