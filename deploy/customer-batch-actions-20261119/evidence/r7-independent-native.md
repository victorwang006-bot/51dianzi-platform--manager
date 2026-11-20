# R7 native-source-type 增量独立只读审查

**结论：PASS，仅限必要 native-source-type 增量；不是 wholepackage / 上线批准。** 未发现需修复的真实增量缺陷。`allApproveFalse=true`，controller/release/finalDeploy/reload 批准均为 false。

## 绑定与方法

- 当前 release SHA256：`a555022329eed9c2b72efa2aa0668b9a84d33148da4bee5cc9ba5bd579866e5b`；基线：`fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`。开始及探针后均核对当前 H。
- 父 actual-derived 双 pin JSON H：`b8dcc9b80cb2b0e9f873a632f0f48428dbd7121ea69b08cc11d2d319c2a8a9bf`；native manifest H：`a7e0a408b5f512424b199d1012303b0c64748d3a6ff2654cd62f21e2f50e2ad2`。两条 literal pin 的全部字段与父 JSON 精确相同，nlink=86；包 JSON H 仅 provenance，不构成许可。
- 独立解析源码 AST、逐节点源码 bytes 和精确 unified diff；核验全部已列 evidence H/长度及现有最终日志，不 full 重跑。未执行已有 r7-audit.py（其后段会 import test_release）。
- 仅执行 AST 摘出的 11 个定义，在独立 namespace 和清理后的 TemporaryDirectory 运行合成 ELF / 真 os.link；临时 pin 的 nlink=2 与生产86明确区分。共 56 条明确结果；未 import whole controller、加载库或执行 transport。合成成功不是 actual capture 成功。

## 关键判断

1. `release.py:775–782` 只含两条绝对 literal native pin：精确 dev/ino/statmode/uid/gid/nlink=86/size/全 SHA256。无 package.json、generic ELF/hardlink override、mock CLI 或生产常量加载器。`791–795` 精确固定元数据 gate。
2. 普通来源 `823–824` 与 `860–861` 的旧 single-regular gate AST 原样。未知多链接 JS、同 inode 未知 alias path 仍拒绝；known path 即使同字节 nlink=1 clone 或 unlink 到1，也在 known 分支精确拒绝，没有 single fallthrough。
3. `808–852` 最底层 source=True 独立执行 fixed META（含读前 path/fstat exact equality）、完整读预算、九字段前后 fstat、dev/ino rename、读后 path full META、精确 size/full H 和 ELF magic，然后才返回 bytes。不是只上层 gate；`855–864` 上层 full META equality 仍保留。
4. 真 alias 同长度字节、mode、size、linkadd/unlink、读中时间/ctime/rename 漂移明确拒绝。瞬间 linkadd/remove 恢复链接数但 ctime 的完整记录差异仍可检测。mtime/ctime 不是永久固定初始值，而是读前后、final 与两个样本及后续 transport 的 exact 记录约束；不声称持续冻结。
5. `1090–1097` sources 全 H 与 mapped dev/ino 精确绑定保持；`1120–1143` final source 全记录重读和返回 fullSourceMeta 保持；`1157–1159` 双完整样本 exact equality 与 `1198` whole transport equality 保持。maps/kernel 的段 multiplicity 保留算法与字节不动。
6. `cas:184–190` 的 target single-regular nlink=1 不动；adapter 文件 `622`、旧 external source `668`、fresh API及 sealed/state 约束均未降级。两个 native 不是新增 API/CAS 目标，真实库 bytes 未改。
7. 全部其它既有顶层节点 AST+源码 bytes 相同：Controller 30方法、Config（root/stage 仅既有 SCOPE 派生）、RPC/9pins/domain/Ready/Union/CAS/maps/kernel/transport/protection。preparer 仅 CONTROLLER_SHA 同步。旧246/40全部保留，仅3个已有scope断言方法literal同步。
8. sixown 合法 rolling / API replace 非干涉代码不变，现有30项日志明确含六 own rolls+本地API CAS稳定与whole transport roll通过；此次未真实运行六槽或API替换。

## 已有最终日志绑定（仅核 H / 每项 ok / terminal OK）

| 日志 | 项数 | SHA256 |
|---|---:|---|
| r7-release-tests.txt | 276 | `b4338c9c1a7054bcd7ef9b841781e575e31b953083f6b320a40b27dc43ed4dd5` |
| r7-prepare-tests.txt | 42 | `6cbd7259b9523aa1f2ce24392356914152c398822643d7de5652eab24e7aa36f` |
| r7-finite-tests.txt | 6 | `ab36567b74ef88771992c87875e0f9d1f2ce5eaca7f04d0ed132a3f8b2de6f2b` |
| r7-native-tests.txt | 30 | `ff10c5b6b252a35fea70b5a342fedafad3a888ca159f365d79c73c449fed61c8` |
| r7-r6-kernel-tests.txt | 34 | `ce40b4a44fb5bf016bce29989ac92c95d6e9abf84000494f97d3ac951f7cab14` |

## 边界与父任务继续项

未扫描真实86 aliases namespace、未读取真实native full bytes、未联网/SSH/Git/MCP、未访问实际proc/FD/env、未执行Node/模块/库、capture/server/CLI/pub/reload，未改变项目源码或证据。synthetic fstat 漂移探针明确为合成；实际路径/进程失败绝不可转译为 mock PASS。原 cooperative locks/full-CAS 非内核原子CAS、不防不协作root持续并发修改。

实际 JS/source graph、typed/retained、fullMETA、fresh sixReady、新2API/HTML/package审仍归父任务。本审查不干预父只读 R7 private capture。根据任务给定的10:31授权与11:50前台nowindow正式释放信息，后台可继续 currentfresh 协调；不增加不存在的 frontend static receipt 等待条件。这些事实不是本离线审查独立现网观测。

机器详情与全部探针事件见 `/home/ubuntu/work/customer-batch/review-r7-native-offline.json`；可复核脚本为 `/home/ubuntu/work/customer-batch/review-r7-native-offline-localprobe.py`。
