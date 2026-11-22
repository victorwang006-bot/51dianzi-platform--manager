# 重试联合发布：有限补充核对 PASS

本次结论绑定新 `final/manifest.json` SHA256：`3205d0392343fbef250d527d97f6c1c8756f953c57b0282841162e86fe2d15b3`。前次评审为 `/home/ubuntu/work/demand-redesign-release-20261122-1455/integration-release-review.json`，该评审文件 SHA256 为 `f2eee6854729ebab1ba5b90afc53dc3dced1ed73ebfbc6b6492382cde4ca81c5`，前次清单 SHA256 为 `0786e09ac96e74c95b50755404a3a262e656c3f515de98707a8ba86cdb0544c6`。

新旧最终清单仅 `scope/retryAfter` 不同；6 assets、2 API及HTML实际完整SHA/size一致。此次没有重跑旧98 resolutions、source tests、构建或其他冻结测试，也没有网络、SSH、DB、Git或生产操作；未修改候选或发布器。

更正后 **front仍要求401/403及UNAUTHORIZED/FORBIDDEN；admin要求400、BAD_REQUEST及精确缺商户message「请在请求头提供有效的业务商户标识」**。两者均校验httpStatus与精确procurementList path，不提供merchantID、身份或业务商户头。admin仅是 **missing-merchant输入门禁，不是完整鉴权或业务SQL测试**；也不证明已授权采购列表或通知unread/markDisplayed功能。发布器ledger和receipt限制说明明确保留该边界。

传输修正仅上传新manifest gzip和新publisher。旧输入路径、完整SHA及28082112-byte size与原持久receipt精确一致；旧输入只读且要求regular、root:root、0600、singlelink、NOFOLLOW/NOATIME、读前后metadata稳定及完整H/size。新manifest整体替换旧manifest，不复用旧scope/nonce/stat/coord/runtimeGuard。重构完整payload必须full SHA/size同时等于本地独立完整payload，之后才EXCL建立新input并fsync。旧本地payload.gz已只读核验为原receipt输入pin，其候选体与当前本地候选精确相同；内存替换manifest及独立重构也完整相等。

新scope/nonce私有上传、新input EXCL及独立stage保留；旧nonce发布器不执行、不覆盖。新remote除scope、asset set展示顺序、fresh guard常量外，只有门禁和限制说明差异；双锁、full bytes/stat CAS、备份、owned-inode回滚、failurehold、耐久闭窗与独立解锁检查全部不变。12进程、ENV/config、非目标PID及2受保护文件保护逻辑原样保留，producer仍从currentguard生成并要求payload guard精确相等。

本PASS是有限静态核对，不是实际发布成功证明；未另读新capture rows。实际运行仍必须通过fresh基线、currentguard、完整payload H/size及全部锁/CAS/回滚保护。`businessTestWrites=0`不承诺应用startup/reload或全部数据库写入为0。脚本SHA和详细检查见同目录 `integration-release-review.json`。
