# R4-AUX-01 修复：独立只读快速增量复核

**限定修复段静态 PASS；未发现本次增量的新实质 bug，无源码修正建议。整体仍 NOT_APPROVED：controllerApproved=false、releaseApproved=false、finalApprove=false、finalDeployApproval=false、reloadApproved=false。**

## 固定对象与范围

实算 current `release.py` 为 123904 bytes，SHA256 **`4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121`**；保存基线 `evidence/r4-auxfix-baseline-52908c/release.py` 为 123290 bytes，SHA256 **`52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f`**。末次复算仍命中。

原 `review-r4-aux-offline.md/.json` 审的是 prior8dc，其 R4-AUX-01 是本次修复输入；不将旧审称为 current 审。529 的 domain/all-ready pre-gate 已由 `review-r4-domain-offline.md` 独立审过，本次只证明保持，不重审 raw/业务或另提架构。

## 修复与反例：通过

- **current:700–706**：原单 proc 收尾 equality 后追加 `describe(current_cwd) == cwd_record`，比较完整目录 META，包含 mtimeNs/ctimeNs。父 cwd 仍只浅读，不递归、不扩根、不忽略时间字段。
- **current:721–731**：保留原 source/root 收尾，随后对同一固定 parent/child PID、原 `flock`/`node-22`、同一 script/cwd 调用完整 `external_proc_sample`；final parent/child 分别与 early **完整记录 exact equality**，不是 identity-only 或挑字段比较。再对原去重 known source 集合用 `external_source` 比 fullMETA，对原 Ops/childcwd 两根比同一 rootMETA。返回原 schema/early records，无重基线或 normalization。
- **保存反例逐项核对**：529 的第二 pair parent cmdline 阶段 cwd 时间漂移 1 项，以及 source/root 收尾 × parent startTicks/rawenv/cmdline/permissions 共 8 项，全部 stale accepted；current 同名同阶段 **9/9 fail closed**。cwd 报 `EXTERNAL_PROC_IDENTITY_READ_RACE`；其余 8 项报 `EXTERNAL_PROC_PAIR_READ_RACE`。第二 pair 对齐未被新 final read 偷换：current cwd 拒绝时累计 parentCmdReads=3，pair 拒绝时=4。replay 使用实际完整 proc helper，未替换整个 sampler；本复核只读 replay 源和保存结果，**没有执行 replay 或测试**。

新增六方法源码/保存日志还覆盖 mtime、ctime 单独及同时漂移，final proc 读取期间 source **同 bytes/fullMETA 漂移**与 root fullMETA 漂移，以及固定参数/有限计数/原 schema。成功时每 pair 四次完整 proc helper；两 pair 共八次，source helper 共 `4 × len(files)` 次。原双 pair equality 不变。

**结论仅限既定读取阶段已观察到的差异被拒绝。有限双 samples 不是内核原子快照、连续冻结、零 TOCTOU 或返回后持续不变保证；不把新增 final 收尾之后的未观察时段说成已证明稳定。**

## 独立保持性及证据

独立 `ast.parse` 去位置属性并比较每个顶层原 bytes：仅两个上述 helper 改变，无增删；其余 **105 顶层项 AST/bytes 相同**。在内存换回两 helper 后，**整个 release 文件 bytes 精确等于529**，包括节点间空白/注释。

**Controller 全类及30方法 AST/bytes 相同**；九 generation pins（含 package.json 与第九 fclone）、RPC、Config/exact roots、transport、domain guard、baseline_guard 首句六 own literal-True pre-gate、owner/scope 等全部保持。Controller AST SHA 为 `74c4a37dc21b8feeaeee0bf37b36c906710ee049bcfb1d6903d533071060e3e8`，完整行 source SHA 为 `64592b06f7ff5f41c42e9e80ecc20ab166e6d023e3231ff8f4078b0783d75b64`；保存全类及逐方法前后指纹均独立命中。RPC literal SHA 保持 `089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`。

preparer 唯一 AST/整文件 byte 差量是精确 pin current 的 `CONTROLLER_SHA`。test_release 只插入六方法 class/block，删除完整插入块后恢复全部基线 bytes；原136方法不改，test_prepare_local 全 bytes/36方法不变。

独立生成 controller diff 与保存 diff 逐字节一致；source-and-safety 的 before/after/logs/proofs/reviewInputs 共29记录 SHA/bytes 均命中，总清单33项均命中。**日志仅核保存内容、计数及末尾 OK，不代表当下生产条件，也未整套重跑。**

| 保存日志 | 数量 / 结果 | 实算 SHA256 |
|---|---:|---|
| r4-auxfix-release-tests.txt | 142 / OK | `7ce89ba5af37cb4a693c2c775ed293f2432cbaf7d85f070207c4750339936a88` |
| r4-auxfix-prepare-tests.txt | 36 / OK | `7f530093e7b3a54cae0db4c89508c30aa7b36ae3404eccb19342620454de3cb6` |
| r4-auxfix-finite-tests.txt | 6 / OK | `edec8cf160371d77ec8d26ff409bcd0cb40ce127c71d474f0ab01c24e17e9f67` |
| r4-auxfix-new-tests.txt | 6 / OK | `76b618049720efca32e75a6d564d839c62c1a86bfb0b562cd9e1dce13df67beb` |

基线136/36/6及初轮新增六方法日志也核 SHA/bytes、数量与 OK 通过。

## 安全与批准边界

仅本地只读、标准库 AST/哈希/保存记录校验；没有 source/module 执行、应用模块 import、真实 proc、Node、network/SSH/MCP/Git、生产 CLI/RPC、锁、capture、stage、window、attempt、reload 或源码/测试/evidence 修改。仅主动写本报告及同名 JSON。

后台扩容结束可上线的用户授权**已收到，不撤销、不重复索要**；但 current fresh14proc、six actual Ready 全 literal True、typed source/fullRetained/complete-byte witness、fresh fullMETA/完整保护树、fresh new fullpackage 与独立全包审批仍未齐。首次实际 parent 身份来源及实际依赖 unknown 也未由此采样补齐。前台列表/详情优先仍未 closed，不占 pub；backend 无 stage/capture/window/attempt 是交接前提，非本次生产实测。**局部静态 PASS 不等于任何最终发布批准，全部 approval 保持 false。**
