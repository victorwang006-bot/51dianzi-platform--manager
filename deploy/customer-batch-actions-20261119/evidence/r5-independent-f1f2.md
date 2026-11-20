# R5-F1/F2 最窄修独立离线短审

## 结论

**PASS（仅本次 F1/F2 最窄增量）。没有发现新的实质 bug；两个原 accepted 反例均被有效修复，正常 own roll 非干涉保持。** 本结论不是完整包或上线审批：`allApprove=false`，`controllerApproved=false`、`releaseApproved=false`、`finalDeployApproval=false`、`finalApprove=false`、`reloadApproved=false`、`reloadTrue=false`。

本审仅本地只读源码、baseline、原独立报告及所给证据；独立计算 SHA256、AST 和原字节，再从 AST 摘取 pure helpers，在纯 `TemporaryDirectory` fixture 中对照旧版 accepted 与新版拒绝。未 import/run whole Controller、tests、实际 Node/God/业务 modules；未使用真实 `/proc`、RPC、production CLI、服务器、SSH、MCP、Git、网络、锁或 DB；stage/capture/window/attempt/reload/server write 均为 0。没有修改 source/tests，也没有执行提供的 `audit.py` 或重跑完整测试套件。只生成本 Markdown 与配套 JSON。

## 1. 独立准确对象与不变性

| 对象 | 独立 SHA256 |
|---|---|
| current `/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119/release.py` | `36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14` |
| baseline `evidence/r5-f1f2-baseline-f544/release.py` | `f544c1663d84350df0ff036b7e1b330a8cfcb016e64d705027ff86411a26ed5d` |
| current `prepare-local.py` | `1768a83b391e3cb05d75a23ac91c426039eb4610575cc95a369f1821c312f862` |
| current `test_release.py` | `bff0446a2c86964330ae0702b461fc220a5f12952219e45f69e5eaebee8b0d0e` |

两个 release SHA 均符合指定 stablecurrent/baseline。逐顶层节点 AST 与原字节核对，只有 **`dynamic_maps`、`dynamic_owned`** 改变；独立重建 unified diff 与保存 diff 精确一致。

`Controller` 整类及其 **30 方法**原 AST/字节完全不变。其它所有既有顶层定义、所有顶层常量、全部 **9 个 PM2 source pins**、RPC function/literal、transport、snapshot/identity、inventory/config binding、roots/domain/pregate 保持不变。这里只核对 pin literal 不变，没有运行或读取实际 PM2 模块来重新认证其运行时来源。

preparer 当前 SHA 替换回 baseline SHA 后，**整文件与 baseline 精确相同**，只改一个 controller pin。旧 test_release 全部顶层节点原 AST/字节保持，覆盖全部 **204 旧 test 定义**；仅增加 8 个测试成为 **212**。`test_prepare_local.py` 整文件字节不变。探针结束再次读取 release/preparer，仍与审查起点相同。

## 2. F1：malformed own 豁免已窄修

current `release.py:956–958` 在 own claim/slot 校验之后、own 分类返回之前，要求 serialized `env` 是 `dict`，并要求 outer `NODE_UNIQUE_ID` 存在且 `re.fullmatch(rb'[0-9]+', ...)`。没有把合法 own PID、raw、startTicks 或权限加入 stable transport；没有搬入 forecast/RPC/Ready 整套协议。

独立完整 collector TempDir 对照保持同一 own PID **10000** 与其其它绑定：`env=[]`、`"scalar"`、`null`，另有 bool、integer、缺失，共六种；baseline 均 accepted 且结果不变，current 全部以 `DYNAMIC_OWN_ENV_OBJECT_REQUIRED` 拒绝。outer unique 的 `not-decimal`、空串、`-1`、`1.0`、`+1`、缺失六种，baseline 同样 accepted 且结果不变，current 全部以 `DYNAMIC_OWN_NODE_UNIQUE_ID_DECIMAL_REQUIRED` 拒绝。原报告中的核心反例不再获得 own 稳定豁免。

**风险限定保留：** 原 F1 证明的是新 collector 的 own 分类/transport 漏拒，不是完整 publication 绕过；旧 `pm2_raw_binding`、`raw_semantics`、snapshot/identity/sixReady 与 Controller 发布协议未改。env-object/decimal shape 修复不等于 Ready、完整归一化 env 证明、retained typed witness 或发布批准。

## 3. F2：真实映射 multiplicity 已保留，ASLR 不纳入

current `release.py:897–902` 对每条保护的 file-backed maps identity 无条件 append，最后排序，不再去重。身份仍为 permission/offset/device/inode；绝对 address 仍不进入稳定指纹。

独立 TempDir 给 foreign PID **11000** 增加同文件、同 permission/offset/dev/inode、不同真实地址 **`9000-a000`** 的一条 mapping：file-backed 行数 **2→3**，目标 library 的保留 multiplicity **1→2**。baseline 完整结果仍不变，current 完整保护结果改变；删除新增条目后恢复原保护结果。单条映射只迁移 ASLR address、两条映射颠倒输入顺序，投影均不变。

仅在第一遍 complete sample 返回后向虚拟 maps 注入重复映射，分别验证 foreign PID **11000** 和 own PID **10000**；两者均由 `DYNAMIC_TWO_COMPLETE_SAMPLE_DRIFT` 拒绝。因此新增/删除的计数信息既保留在 foreign exact，也保留在 own stable map 身份内。

**风险限定保留：** 这是 projected file-backed mapping multiplicity 保护，不是绝对地址拓扑、anonymous heap/VmRSS 保护，更不是已加载 JS dependencies 的语义 closure。没有因此要求新扫描、FD 内容或 ASLR 地址遥测。

## 4. 正常 roll 非干涉

独立 fixture 将 slot190 的 PID **10000→25000**、startTicks **5000→8000**，outer decimal unique/raw 随之改变，另改其合法权限 status bytes；完整 collector 与 roll 前 **完全相同**。新门禁不重新固定 PID/raw/start/权限。

同目录 local replace mutable own API 后结果仍相同；实际 own argv 引用的 fixture `ProcessContainer.js` 仍在 `fullSourceMeta`，不是移除执行源来换取发布便利。这是 pure helper/local fixture 结果，不是实际 transport/Node/Controller 发布运行证明；其外层 transport 与协议不变性由静态 AST/原字节对照确认。

## 5. 日志与提供证据：核验而非伪称重跑

| 日志 | count / 逐项 ok / 最终结果 | 独立日志 SHA256 |
|---|---|---|
| `r5-f1f2-eight-tests.txt` | 8 / 8 / OK | `ec440e28c37ee5bff7531e7aef077865b1a8dcefdc63a4f7d5571d1794fd88eb` |
| `r5-f1f2-release-tests.txt` | 212 / 212 / OK | `040618c8b79a70afaa160d8f5e6370a931c2cdb1f4b7a91259f843e82bba54e3` |
| `r5-f1f2-prepare-tests.txt` | 38 / 38 / OK | `2e51f99fff4b6f5659d1aeac004cfe5e2a60c1e0a505f0e896bf83c2b11134e0` |
| `r5-f1f2-finite-tests.txt` | 6 / 6 / OK | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |

以上日志 SHA/byte size 均匹配 `r5-f1f2-source-and-safety.json`。审计输出与 safety JSON 内容相同，二者 SHA 均为 `dbcf6bc81d47d7f29082fcf855e4a27e10e7e762630326593b4ee80ed4492f1c`；保存 diff SHA 为 `1e0d230011b2a540b38e693f7ca01f3a34c0507d705193c81ba77c3e4833b633`。本审未重新运行这 8/212/38/6 套件，仅另行执行了上述 bounded pure-helper 反例与非干涉探针。

## 6. 仍待 parent，不在本审授批

six actual Ready（六个 literal True）、retained raw/typed witness 与 typed bytes、current fullMETA、新 API/HTML fullpackage、fresh all-active 动态 baseline、当次完整包独立 sourcegraph review，以及前台 new static closed/actual list-detail closed，均未在本短审验证或批准。未知能力仍须真实独立 sourcegraph 审查，既非自动可信，也非永久不可批准。

两遍完整相等的有限采样与末端复读**不是内核原子冻结或持续监控**；maps/argv 不能证明全部 loaded JS dependencies closure。本次 PASS 只关闭所列两项最窄缺陷，不代替上述证据和总审批。用户已有上线授权无需重问。

配套结构化结果：[review-r5-f1f2-offline.json](/home/ubuntu/work/customer-batch/review-r5-f1f2-offline.json)。
