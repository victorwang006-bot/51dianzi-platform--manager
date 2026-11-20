# R4-AUX-01 最窄离线采样修复与完整保留证明

**NOT_APPROVED。controllerApproved=false / releaseApproved=false / finalApprove=false / finalDeployApproval=false / reloadApproved=false。**

当前 controller **`4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121`**，preparer `CONTROLLER_SHA` 精确相同。修改前首先保存 **52908c** 当前六文件到 `evidence/r4-auxfix-baseline-52908c/`，含 `test_prepare_local.py`；六文件与初始 SHA256SUMS 逐项核对成功。基线 controller `52908c3719ef8f00b974b432af10c889c01397094778be812cea69ae828ae72f`；该基线已有 domain guard、baseline_guard 首句 six-own all literal True 零写门槛，全部保留。

完整 OWNER `6Lfttf6oVWJ8YS69o5FkXQ`、SCOPE `customer-batch-actions-20261120-6Lfttf6o-R4` 不变。R4 未 remote/stage/capture/attempt 是本次交接边界；本任务没有服务器验证或服务器操作。前台列表+详情优先仍未 closed。本报告仅离线修复自检，不是独立 final approval。

## 1. 输入与 accepted 反例的直接复现

只读指定独立本地 `review-r4-aux-offline.md/.json`。原审对象是 8dc，不把它误称为 current 审查；本任务另外对保存的 52908c 原 helpers 作纯 TempDirectory/mock replay，确认缺口仍存在。

| 独立审查输入 | SHA-256 |
|---|---|
| `/home/ubuntu/work/customer-batch/review-r4-aux-offline.md` | `025a5eb57996fcfca9c906e92c122609f5ef96d02c46bfe0c1095ddc4201de03` |
| `/home/ubuntu/work/customer-batch/review-r4-aux-offline.json` | `b7901ff3846e9e4538205188313ad3263838de3d628d0dc6d61ba43cf4046d3c` |

`r4-auxfix-replay.py` 复用现有 `r4_external_fixture`、实际 `external_proc_sample` / pair / collector；不替换整个 proc sample，不读真实 proc、不执行源、不作 Linux 实际时序实验。第一探针在**第二 pair 的早 parent cmdline 读取阶段**改变 shallow parent cwd mtime/ctime，基线两次记录仍等于旧 META，live 与记录不同。第二类在第二 pair 最后 source/root 收尾处，让 parent 的 startTicks / whole rawenv / cmdline / permissions 各自漂移，early records 已读完且 known source/root 不变。基线 **1 + 2×4 = 9 个 stale accepted 实例全部直接复现**；新 helper 对相同九个实例全部 rejected。完整结果见 `r4-auxfix-counterexamples.json`，只有 synthetic 时间/身份及 SHA 证据，无 env/cmd 私值。

## 2. 仅两个 helper 的最窄修正

`external_proc_sample` 末端既有 identity/proc/link equality 后追加 `describe(current_cwd) == cwd_record`；m/ctime 不忽略。parent cwd 只浅 META，不递归未知目录，不猜 parent executable/cwd，不扩大域。

`external_protection_sample` 保留 early parent/child、关系验证、原四 known source fullMETA、原 exact Ops+childcwd rootMETA 收尾。其后对同一固定两个 PID、同一 expected exe/script/cwd 再**完整** `external_proc_sample`，两条 final record 分别与 early record **exact equality**；不缩成 identity 或挑字段比。final proc 读取后再查同一四 known source fullMETA equality 及同一两 rootMETA equality。返回仍为原 schema 与 early records，不 rebaseline、不 normalization。

成功的每 pair 固定 early parent/child + final parent/child 四次完整 proc helper，两个 pair 合计八次；每 pair 同一 known source 集合 early + final 各一次，原四类 source 角色按路径去重规则保持。两个 pair 合计 `4 × len(files)` 次 source helper，本 mock 四独立路径为十六次，实际最多十六次；提前拒绝可更少。只有有限既定 phase 复查，没有无限 loop、PID 搜索、扫描域或预算扩展。whole raw env/argv 哈希、PPID/startTicks/permission/proc/link/cwd META/source、exact child argv/cwd 与 full node SHA 规则均不放宽。

**有限读取不是内核原子冻结、proc/source/root 同时刻快照、零 TOCTOU、返回后持续不变或连续监控。只拒绝在这些既定复查阶段已观测到的混合记录；无法证明未观测时段不变。** 首次 flock 信任来源、未知 loader/native/dependency 语义仍待 actual 审，不用新保护策略掩盖 unknown。

## 3. 完整 AST + byte 保留，不靠报告布尔值代替计算

标准库 AST 去位置属性与逐 node 原 source bytes 独立重算：顶层无新增/删除，**仅 `external_proc_sample, external_protection_sample` 改变**；其余 **105 项顶层 AST/源码全文 bytes 相同**。把两个 changed helper 的 source bytes 换回保存基线后，release **整文件全部 bytes** 与基线相等，含 node 间注释/空白。

Controller **全类 + 30 方法 AST/源码 bytes 均相同**，包括 baseline_guard 新 gate 与其它 29 方法；domain guard、raw binding、原 eight+ninth pins、Config/exact roots、transport、RPC、budgets、journal、schema、identity、owner/scope 及所有其它原函数/常量均由上述完整比较覆盖。

- Controller 全类 AST SHA：`74c4a37dc21b8feeaeee0bf37b36c906710ee049bcfb1d6903d533071060e3e8`。
- Controller 全类源码 SHA：`64592b06f7ff5f41c42e9e80ecc20ab166e6d023e3231ff8f4078b0783d75b64`。
- baseline_guard 首句：`pm2_publish_ready(b['c']['processes'], b['ids'])`；调用者仅 apply/preflight。
- RPC full literal UTF-8 SHA：`089d6af98a983ecc11e6feb1c0cd909c5aafba627fd7856eadd9935fec5da0c3`；RPC assignment/function AST 与源码 bytes 完全相同。
- 原九 generation pins 对象、顺序/原源码全文均相同，含原 package.json 与唯一第九 modules/fclone.js `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。
- preparer 唯一 AST 与整文件 byte 差量为固定 `CONTROLLER_SHA`；把 pin 换回即整文件相同。
- test_prepare_local.py **整文件 bytes 不变**；无 fixture pin 变更需要。
- test_release.py 只增加 R4AuxFixTests 一个 class；移除该 class 后整文件 bytes 精确相同。原 136 test 方法、原 classes/helpers/fixtures AST 和全文 bytes 均不改；preparer 原 36 test 方法不改；finite 原六方法/文件 SHA 与旧 domain evidence 相同。

逐方法/顶层 AST/source SHA、前后 byte ranges 和全部 equality 见 `r4-auxfix-ast-diff.json`；只两个 helpers 的精确源码补丁见 `r4-auxfix-controller.diff`；五实际修改文件及未改第六文件的完整 diff 见 `r4-auxfix-allowed-files.diff`。

## 4. 纯本地完整回归与计数

修改前重跑 **136/36/6** 全通过；修复后完整 **142/36/6** 全通过（原 136 + 新 aux 六方法），另独立 aux 六方法 **6/6**。首轮新增六方法也一次通过，日志保留，不覆写历史初轮失败/审查证据。

新增六方法包含：stable 完整记录与固定 PID/参数/有限调用计数；第二 pair parentcmd shallow cwd mtime、ctime 各单独及一起三反例；source/root 最后阶段 × parent 四 drift 字段八反例；final proc 读取期 source 同 bytes/fullMETA 与 root fullMETA 两反例。新局部 fixture 的计数明确区分 pair early/final，第二 pair 的 old 第二 parentcmd 在修复版是第三 parentcmd，不把它偷换成第一 pair final；pair末端 drift 则观察第四完整 parentcmd 后 equality 拒绝。无需改变任何旧 test 预期或省略原 cases。

原 domain/zero-write gate 等原方法本次完整重跑；这些测试的锁、CAS、apply/reload adapters 与 diagnostic capture() 均只在 TempDirectory/mock，后者不生成 capture 文件。没有 actual capture/CLI/RPC/生产动作。

| 完整保存日志 | 通过 | bytes | SHA-256 |
|---|---:|---:|---|
| `r4-auxfix-baseline-release-tests.txt` | 136/136 | 21101 | `19da5f88f971c62b5e8b8e9ef95ce52768c9a64eaf4807bce5fc5cd9ef959aee` |
| `r4-auxfix-baseline-prepare-tests.txt` | 36/36 | 4669 | `b03d9d52e594a416a845b46a1a2713acf026432033cf98da63df0b2f0325596c` |
| `r4-auxfix-baseline-finite-tests.txt` | 6/6 | 954 | `edec8cf160371d77ec8d26ff409bcd0cb40ce127c71d474f0ab01c24e17e9f67` |
| `r4-auxfix-release-tests.txt` | 142/142 | 22133 | `7ce89ba5af37cb4a693c2c775ed293f2432cbaf7d85f070207c4750339936a88` |
| `r4-auxfix-prepare-tests.txt` | 36/36 | 4669 | `7f530093e7b3a54cae0db4c89508c30aa7b36ae3404eccb19342620454de3cb6` |
| `r4-auxfix-finite-tests.txt` | 6/6 | 954 | `edec8cf160371d77ec8d26ff409bcd0cb40ce127c71d474f0ab01c24e17e9f67` |
| `r4-auxfix-new-tests.txt` | 6/6 | 1130 | `76b618049720efca32e75a6d564d839c62c1a86bfb0b562cd9e1dce13df67beb` |
| `r4-auxfix-new-tests-initial.txt` | 6/6 | 1130 | `ceb8bac21ba5dedf4c0e1d2e31154711223c400132c1ceb736e0641e13286dde` |

## 5. 当前六文件和证据 SHA

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `release.py` | 123904 | `4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121` |
| `test_release.py` | 124701 | `3cee69ea36fd3d5a1755788887f20485f40483146538a21e0ad647c3b5261790` |
| `prepare-local.py` | 22260 | `47013f3e2ab1c56936475c15e2e64743153f951b2adfa48fa6afe419187c0973` |
| `test_prepare_local.py` | 28905 | `3f588fe155b0c717df3f8b9f00057a803548a4054d8b1c3651b026eea14ccc6f` |
| `README.md` | 26174 | `7b1bef7dfecec3b10fef9df5e9a52a133c7d4dd41bc83d832f30575d4dcd4943` |
| `prepare-local.README.md` | 11514 | `6fbbc18c5ba48f07f37e9a1119a91c8b6bd9f8ba4cf38e7a0344948747e7d793` |

| 精确证据 | bytes | SHA-256 |
|---|---:|---|
| `r4-auxfix-ast-diff.json` | 271227 | `52d680b244fae3a65d88c21447da3c1fdb7ae99297ef602c527ba533b5414632` |
| `r4-auxfix-controller.diff` | 1485 | `4958f983f826caefee36ccb82126b6a8ef5bcaa226fb07309211d0dd79af2607` |
| `r4-auxfix-allowed-files.diff` | 22480 | `d613dac7098fc99577333c32ab978d7c19629ae8b11964f1b9a60ea7bc47f693` |
| `r4-auxfix-counterexamples.json` | 9799 | `647c0d9a52e8d60a4bc7e37b2549863d7d8881bdacc2440682d23f45fc8d8f6b` |
| `r4-auxfix-replay.py` | 5938 | `8a211ca15a924e03d66b83088bd0c503566d72938a797ae47b1080d3b3313e6a` |
| `r4-auxfix-replay-output.txt` | 251 | `3faac8dc2ff1e2911c0e7e0b6bbf209927c461076d1759192e9931d5405365f8` |
| `r4-auxfix-audit.py` | 23879 | `11d9a69475c8fa88ce5dc1d5a34980f067001715c9309715f3a4196ddaf48ee1` |

`r4-auxfix-source-and-safety.json` 含 baseline/current 六文件 SHA、pin binding、所有日志/审查/证明 SHA、历史 evidence 的只读 SHA 清单、明确未执行 flags。历史清单是审计时现存对象校验，不假称所有历史文件在任务开始前已另拍 checksum。全 auxfix 文件（含报告、audit-output、基线副本）SHA 见 `r4-auxfix-SHA256SUMS.txt`；清单不包含自身以避免自引用。原中间日志与独立审查文件均保留。

## 6. 全部 hold 不变

只改授权 release.py/test_release.py/prepare-local.py/README.md/prepare-local.README.md 和 evidence/r4-auxfix-*；第六 baseline 文件 test_prepare_local.py 未改。无 Git/SSH/MCP/server/Node/RPC/生产模块/prod CLI/JSbuilder/业务修改或执行；无 actual capture/stage/attempt/window/reload，productionWrites=0。未新增保护特性或修改 policy。

**actual fresh14proc/current full sources META、cloneTypedRetainedWitness、six actual Ready all literal true、fresh fullpkg/manifest/source/tool/owner/nonce/TTL/完整正逆字节、fresh protected tree/fullMETA 与 actual identity/dependency closure、独立 fullpkg 审批及明确部署许可全部待主任务。前台列表+详情仍未 closed。** 原 domain/newbaselinegate 和 mock allready 正常通过不代表 actual all true 或 approved。

**最终仍 NOT_APPROVED，所有 approval 值 false。**
