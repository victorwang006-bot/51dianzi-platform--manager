# 最终渠道参考离线聚合（未写应用、未发布）

仅复用已完成的158项独立研究、28份云汉登录后复核及保存的脱敏目标DOM；没有网页/search/browser/SSH/生产/Git操作，也未重新查证型号事实。当前授权范围为 **446行 / 441 raw物料组**。最终数据不是线上状态，不代表生产或员工E2E完成。

## 精确 before / after

| 口径 | 原应用基线 | 初次聚合 | 最终数据 |
|---|---:|---:|---:|
| 完整snapshot records | 294 | 529 | **532** |
| 完整snapshot ok来源份数 | 213 | 301 | **308** |
| 当前441 raw组lookup ok来源份数 | 213 | 301 | **308** |
| 当前441 raw组有任一ok的组数 | 169 | 257 | **260** |
| 新价来源份数（较原基线） | — | 88 | **95** |
| 新价覆盖raw组（较原基线） | — | 88 | **91** |
| 有限bindings / 允许sources | — | 88 / 88 | **91 / 95** |
| 旧价独立stock-only补证 | — | 7 | **8** |
| 价已知、库存未知来源（实际补证后） | 12 | 5 | **4** |

**newPositiveBySource：lcsc=88，ickey=7。** 95份新价均自带明确库存；其中本次登录新价为7份，7份均自带库存，**不计入旧价stock-only 8份**。新增任一参考raw组为91而非95，登录复核真正新增覆盖的3组为N048/N062/N106；N085/N120/N124/N138已有初次立创参考。按446授权行实际lookup共有312份ok（立创251、云汉61）；去重441组是308份ok（立创247、云汉61）。

原 **213份成功quote/evidence深比较全部不变**，原价、tiers、fetchedAt、包装、税务、productCode及raw字段完整保留；原新增88份立创quote/evidence也逐项不变，原七条stock records含各真实采集时间精确不变。证明见 [original-preservation.final.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/original-preservation.final.json)。

## 28份云汉复核与库存

28份完整source_result全部以原merge-results.py受限patch机制合并：**8 ok / 18 ambiguous / 1 not_found / 1 price_unavailable**。其中7份ok成为新价，S002只补旧价库存；歧义18份中16份明确多货源，N131/S003为身份阻断，不因单详情页有价库存而升格。没有挑低价、合库存、采用优惠券、猜计价单位或去MPN后缀。七份新云汉价的unit全为null。

旧价库存8份：立创6、云汉2。新增S002云汉 **库存1000**，独立采集时间 **2026-11-17T07:22:23.777Z**；原价3.5721及原价读取2026-11-14T09:26:05.371Z不变，3000档库存不足=true，旧productCode/packaging仍null。真实DOM原文货期为 **内地7-15工作日、授权代理**，不是即时现货。保存targetDOM精确hash为9456dea8aee52b1ac65306518da8936349e2f2d43b578569deb704741d615c22；stock摘录由其标题/厂牌/#proStock/货期/供应商/整包节点离线抽取，独立摘录SHA见 [S002-dom-extraction-review.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/S002-dom-extraction-review.json)。原七份继续读取原data/research-original，不改时间或摘录。

四份旧价库存仍unknown：S001停售/未明确库存、S003 identity unconfirmed且quote/evidence仍null、S006的32597与32595库存口径冲突、S010未取得明确库存。S003保存可见10000不等于已获授权stock证据，仍阻断；S006不擅自选一个数或变0。

## 必要同厂家字面别名与来源规则

已逐项核对原identity_evidence的制造商完整订货码、参数及同一商品页厂牌，新增直接双向完整字面边仅以下五对；不扩品类、RoyalOhm等厂家族、子串、MPN或传递闭包：

| 显式字面对 | 已审item / 完整MPN | 原已有公开依据与同页观察 |
|---|---|---|
| UNI-ROYAL(厚声) ↔ UNI-ROYAL | N048 0603WAF1002T5E；N062 0603WAF750JT5E | item.szlcsc.com/26547.html、/4682.html所附实际读取厂家规格书及完整14位订货规则；各本次准确ickey详情DOM |
| FH(风华) ↔ FH/广东风华高科 | N085 1206B333K251NT；N106 0402B104K160NT | 原风华厂家规格书记录、www.fhcomp.com/en/product_info/?prod_code=0402B104K160NT、item.szlcsc.com/984530.html及/42839.html；各本次准确ickey详情DOM |
| Sunlord(顺络) ↔ Sunlord/深圳顺络电子 | N120 PZ1608U301-1R2TF | item.szlcsc.com/288532.html所附顺络专用原厂SPEC PZ1401250365（含完整MPN、Shenzhen Sunlord公司、规格）及本次准确ickey详情DOM |
| NOVOSENSE(纳芯微) ↔ NOVOSENSE/苏州纳芯微电子 | N138 NSD5604NE-DHTSTR | 原已读NOVOSENSE版权完整订货表PDF公开副本、www.novosns.com/company-profile、item.szlcsc.com/35694203.html及本次准确ickey详情DOM |
| XKB ↔ XKB CONNECTION/中国星坤 | S002 X5511FV-25-C70D30-1000 | 原输入已确认完整身份、item.szlcsc.com/3094013.html及旧云汉quote/evidence与本次同商品原厂牌完全相符；正向已有规则，仅新补snapshot/ickey反向 |

逐边全部公开原URL、exactMPN、实际observed字符串、source和规格依据完整保存在 [same-manufacturer-alias-evidence.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/same-manufacturer-alias-evidence.json)，不是本轮新访问。原66历史方向 / 云汉62历史方向、23既有direct entries与16个品牌族保持。N124 TEXAS INSTRUMENTS使用原已批准TI别名，没有新开边；N126韩国韩荣/HRO未在允许范围，仍blocked。

**来源机制限制如实披露：** 新表限 `ickey` 来源profile及 `snapshot` 证据profile，沿用历史LCSC/snapshot约定，不适用lcsc adapter。当前snapshot brandProof没有source上下文，不能声称该validator对所有未来立创quote具备来源隔离。没有越权改snapshot.ts；本次实际新接纳仅7个ickey，原88 lcsc没有新增或改价。精确最终授权仅枚举实际532身份、91完整bindings/95 sources，不授任意future绑定。详见 [source-profile-limitation.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/source-profile-limitation.json)。

所有8份成功保存目标DOM均重新核对精确SHA、完整MPN、厂牌、全部普通阶梯；DOM都是目标片段而非整页。S002摘录SHA与DOM SHA独立。空#只是浏览器UI无内容fragment，不参与HTTP商品资源请求；N120原source.page_url保留#但quote/evidence无#，补丁只在已披露同资源条件下将source.page_url规范为同一无空片段URL，原result文件不变；其余原实际URL与无空片段理由见 [empty-fragment-url-normalization.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/empty-fragment-url-normalization.json)。没有去除任何查询参数或伪造无参访问。

## 剩余工作：组与来源份数不得混用

当前 **unmatchedBothGroups=181**，即441组两来源均无ok；完整逐组逐来源原状态/已研究/登录复核/未重新研究/当前lookup保存在 [scope-source-coverage.final.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/scope-source-coverage.final.json)。原缺口输入实际为397个唯一raw组 / 669份来源缺口。首次研究147个新raw组 / 294个缺口来源，加11个旧价库存组 / 12个库存来源观察，共158 items / 306 source_results；28复核是其中28个ickey来源的替换，不是新增28物料组或来源授权。

原报告244单位经实际列表重核：**244个完全未纳入研究的缺口组 / 369个缺口来源**。另S001/S005/S006/S007/S008/S009虽研究了旧价库存，但其另一个ickey缺价来源没有研究。因此全部未重新研究的原缺价来源是 **375份 / 250个含未研究来源的组**，不是244份、369组或把这6组算作已完成补价。这些旧状态不当成本轮新读取结论。

当前441组remaining来源状态：

| 来源 | ok | ambiguous | access_restricted | price_unavailable | not_found | unavailable |
|---|---:|---:|---:|---:|---:|---:|
| lcsc | 247 | 32 | 11 | 13 | 104 | 34 |
| ickey | 61 | 167 | 90 | 2 | 96 | 25 |

研究本身最新结果为122份来源ambiguous（不是122个组），其中99份明确同MPN多供应货源，93份已确认唯一厂家但货源不能唯一指定，另6份同时存在身份歧义；厂家未唯一确认共31组（17 ambiguous、14 unconfirmed）。最新已研究access_restricted仅12份（均lcsc），而当前scope仍101份受限状态（11 lcsc+90继承旧ickey），不伪称90份都已重新受限访问。研究price_unavailable为10份（原N107/N128按既有政策仍校正unavailable）；当前scope为15份。上述原因可能重叠，**不可把来源数相加当181个未覆盖组**。147个新raw组仍56组未接纳任何新价；逐项原因在 [remaining-work.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/remaining-work.json)。

6份研究ok候选仍阻断：N048:lcsc本地解析时间且insufficient=null；N106:lcsc本地核验时间；N049/N092:lcsc真实URL带fromZone、原URLgate拒绝，没有无参访问证明；N100:ickey完整价与原DOM时间不同及最大档缺证；N126:ickey厂家字面证明未被strict matcher接纳。成功的云汉新观察不解除这些独立来源阻断，未修URLvalidator、未用新时间冒充旧读取。

## 真实验证与交付边界

原merge patch机制调用当前真实 `validateChannelReferenceSnapshot`，最终 **532 records / 1064 sources / 308 ok，allValid=true**；全部91有限绑定/95来源真实lookup及最终三sibling DI检查通过，原213 deepEq。数据三sibling都绑定最终完整snapshot精确字节，不手改hash。库存8条门禁与12项少量真实私有文件边界检查通过，含新增S002库存与摘录不一致、URL添未批准查询负例；品牌89项定向回归通过（6新case）。信任已有1209相关回归，不重跑全量。回执：[final-di-validation.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/final-di-validation.json)、[stock-implementation-stats.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/stock-implementation-stats.json)、[brand-final-tests.log](/home/ubuntu/work/channel-reference-fill-20261117/brand-final-tests.log)。

本reducer仅改shared/channelReferenceBrand.ts及其定向test与工作目录脚本/产物，没有改snapshot.ts、identityBindings.ts、UI或应用JSON。当前私有snapshot factory bundle用于真实validator/DI，不是重编最终service/worker运行产物；旧runtime source锁因别名及并发P1源码变化正常过期，本轮未重pin或重建最终锁。父需等所有源码完成后统一code build一次，再用更新有限授权做最终check-data。未完成生产或员工E2E、未安装数据、未启用采集/worker或发布。

### 最终三份数据（父批准后才copy）

| sibling | SHA-256 |
|---|---|
| [channel-reference-snapshot.staged.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/channel-reference-snapshot.staged.json) | `bab621d9ab3178da1ec9f77b38cf588711bfd8401d21bbee363fd151e2147a0c` |
| [channel-reference-identity-bindings.staged.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/channel-reference-identity-bindings.staged.json) | `20af3122bd548251919c439435a1cf52bcdabdeaa4706b52d9f84ee2e8fc112b` |
| [channel-reference-stock-evidence.staged.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/channel-reference-stock-evidence.staged.json) | `e661e40003d19bb018cff32beca5b5d585120c4f92448b50057eefd1a79c7f34` |

完整新价含quote/evidence、身份依据与原source_result：[accepted-new-quotes.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/accepted-new-quotes.json)。精确before/after：[before-after-stats.final.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/before-after-stats.final.json)。三sibling清单：[final-three-siblings-manifest.json](/home/ubuntu/work/channel-reference-fill-20261117/data-final/final-three-siblings-manifest.json)。按原checker格式的新有限授权：[binding-authorization.final.json](/home/ubuntu/work/channel-reference-fill-20261117/runtime-build/binding-authorization.final.json)；未改原checker或旧授权文件。

离线复跑：`python3 /home/ubuntu/work/channel-reference-fill-20261117/prepare-final-inputs.py` → 原`merge-results.py --patch login-followup-patch.final.json --out data-final` → `node generate-stock-evidence.mjs data-final/channel-reference-snapshot.staged.json data-final` → `node validate-final-di.mjs` → `python3 finalize-aggregation.py`。复跑生成stock sidecar的文档生成时间会变化，但八条真实采集时间不变。
