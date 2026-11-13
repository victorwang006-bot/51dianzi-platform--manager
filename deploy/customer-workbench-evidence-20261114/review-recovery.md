# R1 恢复链路独立定向复审

**结论：PASS；R1Closed=true。** 原 `review.json/md` 的唯一阻塞 R1 已关闭；本结论只覆盖所列冻结版本的部署恢复链路。前后端业务结论沿用原 review，未重跑完整业务验收、未重建、未部署，也不声明生产恢复已实际执行。

复审时间：2026-11-13T17:20:22Z（北京时间 2026-11-14）。仓库：`/home/ubuntu/work/51dianzi-platform--manager`。

## R1 关闭依据

| 定向项目 | 结论及源码位置 |
| --- | --- |
| 持久化 reload intent | Python 94–108、261–262、290–296：每次原生调用前，经原子保存及 fsync 持久化列表中的 `ownerTask/id/name/apiHash/atUtc`；要求本任务、原 id/name、限定 API path、对应 candidate hash，拒绝重复 id。 |
| 仅 owned id 放宽 liveness | Python 78–91、134–158；Node 25–59：正常路径仍严格 online/pid>0。rollback 仅持合法 intent 的原 id 可暂时不健康；其他 API 仍须健康，id/name/script/CWD/environmentHash/execMode 始终冻结，独立 worker 的完整投影不变。 |
| 精确原字节恢复 | Python 139–157：首次恢复写前验证全部两个 API 的 candidate/original CAS 及原备份；每个目标写前再次核验，不覆盖 foreign bytes。只恢复持 intent 的原实例，最后全 API 严格 online/pid>0、原文件哈希确认。异常处理覆盖 atomic install 完成但 bookkeeping 未完成的情况（343–349）。 |
| empty-env、单 id 分派 | Node 61–83：正常和 owned-online rollback 调用 `reloadProcessId`；owned-offline 或 pid 缺失调用 `restartProcessId`，均只传 `{id, env:{}}`。不传 current_conf/shell env/updateEnv，不执行全局 restart/save。VM 直接执行取回的真实 God `reloadProcessId/restartProcessId` 和 Utility `extend/extendExtraConfig` 槽，断言 cached env 引用、内容、path/CWD/mode 不变。 |
| 不完整恢复不释放共享窗口 | Python 329–382：未确认 HTML/API 恢复或失去 window ownership 时，保持 `shared_release_active=true`，记录 `recovery-required` 和明确 manual exact recovery 要求；不写关闭时间。finally 仅释放 advisory locks。受阻 apply 不覆盖既有待恢复 receipt。foreign HTML/API 字节及 foreign window 本身不被覆盖。 |
| 人工恢复入口 | Python 211–240：`--rollback` 允许进入本任务已占用的 recovery-required 窗口，兼容 HTML 已恢复的情况；仅确认全部原字节和全 API online/pid>0 后关闭窗口。 |

## 真实 Client/API 入口契约：pending 已关闭

已独立读取完整真实 `pm2-native-client-contract.txt`。`pingDaemon` 在 reconnect attempt 回调 `cb(false)`，连接并关闭 socket 后回调 `cb(true)`；`launchRPC` 连接成功回调 `cb(null)`，socket error 回调 `cb(error)`。这两段定义均不调用 daemon start。对应 helper 67、69 行的回调形状一致，无 Clientsource 契约不匹配阻塞。

已补读真实 `pm2-native-api-contract.txt`（3442 bytes）：`list(opts, cb)` 支持直接传 callback，经 `Client.executeRemote('getMonitorData', {}, ...)` 返回 `cb(null, list)`；`disconnect(cb)` 使用 `Client.close`，不要求先调用 `pm2.connect`。取回的 executeRemote 定义显示仅缺少 `client/call` 时会进入 `start` fallback；helper 在 list、单 id dispatch、第二次 list 前均检查现有 `client.call`，与该契约一致。Client/API 本次是源码核验，未连接或运行真实 daemon；连接行为在现有 VM 中仍使用 inert 桩，不伪称真实入口在生产执行过。

真实当前 12 个进程环境指纹 proof 已读取：12/12 的 Python hash 与 Node hash 相同。该证据关闭原 review 对当前环境形状未认证的 pending，不能推广为任意 JSON 键／浮点形状都一致。

## 定向验证及冻结契约

已读父任务两份恢复测试 trace，并独立仅复跑现有两个恢复 fixture 文件：Python **28/28 PASS**（原 9 + 新 19，unittest 方法数，subtests 不另计）；inert Node VM **43/43 PASS**（原 7 + 新 36）。真实 PM2、HTTP、数据库及锁均未被测试触达；Python 只在临时目录使用惰性 IO 桩，VM 不加载安装的 PM2。

`stage/manifest.json` 的 owner、精确 4 frontend + 2 backend allowlist、relative/API path、proof flags、验证前置 flags 已按 driver 契约静态核验。29/29 evidenceHashes 匹配；stage 与仓库 driver/helper 一致；四个修复文件哈希均与 recovery-fix 一致；4+2 candidate 实际字节哈希匹配。前后端 proof hash 与原 review 冻结值完全相同，因此沿用原业务 review，不重跑业务 tests。

`manifest.reviewPassed=false` 是本复审完成前的正常门禁状态，**不是阻塞**；本任务未修改它。父任务可用本报告的 PASS、R1Closed 和精确 driver/helper 哈希完成后续 prepare-stage 门禁。

| 冻结项目 | SHA256 |
| --- | --- |
| reviewedDriverSha256 | `2c63f3788ea7114246dcf6f591cefd5e0b8804802accfcc166dc2e331c9788d7` |
| reviewedReloaderSha256 | `db6af00f740e7a9145a109a2123ba62de058516b69d9c305f509238546410843` |
| frontend candidate-proof.json | `9b46df524548ed62891f602bcd246044d6043ee69c6d1c7e68da9c1d8e86f970` |
| backend candidate-proof.json | `23b8ab84dd5176ff8380a8ae375cf493262864b4cfc1b93c6e322845536aaaa1` |
| reviewed stage manifest（reviewPassed=false） | `71e8c71b5a7a5571081a044a74e6a72fe0380c6161b58eb4ce50399710dfe54a` |

## 边界

本次 SSH／外部网络／DB／真实 PM2／浏览器／Git／源码修改／manifest 修改／生产写入／候选重建／业务测试重跑均为 0。只写本复审的两个交付文件。原 review 的其他非阻塞限制继续保留，尤其不替代部署前授权、真实启动与部署后生产验收；未把旧 current_conf payload 宣称为已证实环境污染。若 driver/helper 或业务 proof 变更，本复审冻结结论不能直接沿用。
