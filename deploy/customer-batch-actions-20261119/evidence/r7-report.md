# R7 最窄只读 native hardlink 源类型适配

**状态：SOURCE_TYPE_FIX_NOT_APPROVED。** controllerApproved=false；releaseApproved=false；finalDeployApproval=false；reloadApproved=false。

## 基线与当前绑定

在任何源码改动前，六文件原样保存于 `r7-baseline/`，各自长度与 SHA256 留存在 `r7-baseline/manifest.json`。准确 R6 release 基线为 `fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`。owner 仍为 `6Lfttf6oVWJ8YS69o5FkXQ`；新 scope 为 `customer-batch-actions-20261120-6Lfttf6o-R7`。

当前 release SHA256：`a555022329eed9c2b72efa2aa0668b9a84d33148da4bee5cc9ba5bd579866e5b`。prepare-local 的固定 CONTROLLER_SHA 同步，除这一常量外其所有顶层 AST/函数源码保持；Config 与 Controller 全 class bytes 保持，Controller 30 methods 不变。新默认 stage 仅由既有 `Path('/opt/ops/' + SCOPE)` 派生，未创建或检查任何实际 stage，已有 R6 stage 未触碰。

## 实现的唯一源类型变化

新增 `DYNAMIC_FIXED_NATIVE_SOURCE_PINS`，只含两个已映射 native ELF 的绝对 literal 路径；固定值全部从父已完成的 `/home/ubuntu/work/customer-batch/native-hardlink-source-pins-once.json` 机器 JSON 生成，并验证 full SHA256 的 64hex 格式。精确 source pins 与 package provenance 留在 `r7-native-source-pin-manifest.json`；没有复制或上传 native full bytes。

两个源分别为 libvips-cpp.so.8.18.6 与 sharp-linux-x64-0.35.4.node，仅这两个路径允许准确 nlink=86，且要求准确 dev/ino、size、mode、uid/gid。不使用 package.json 名称或 ELF 外观作通用放行依据，package.json 的名称/版本/hash 仅来源说明，不是 source exemption。机器观测的来源解释与父已查询 pnpm 官方引用位于 `r7-native-shared-source.md`；本子任务没有另行网络请求。

`dynamic_source` 在 known 分支检查 exact 固定元数据；`dynamic_read(..., source=True)` 在最底层也独立检查 exact 固定元数据、读取前路径完整 META 与 fstat 一致、所有九字段前后 fstat 相同、读取后路径完整 META 相同、原 dev/ino rename guard、整文件 length/full SHA256 和 ELF header `7f454c46`，全部完成后才返回 bytes。上层完整 META equality 保留。普通单链接 source 两个原 gate 的 AST 不变；unknown multi-link source 仍拒绝，known path 变为 nlink=1 clone 也不能走普通分支。

CAS 目标仍是 single regular file，没有拆 hardlink、修改库、加载 ELF、添加 CLI/mock 权限或 generic hardlink fallback。原时间/读取预算、读竞态、mapped dev/ino/multiplicity、root/proc/IO record、RPC/9pins、所有环境/完整树保护、CAS、shared locks、发布前六槽 Ready gate 和 Controller 收据/恢复协议保持。

## 离线测试结果

| 测试组 | 结果 | 完整日志 |
|---|---:|---|
| release 全部原 246 + 新 30 | 276/276 PASS | `r7-release-tests.txt` |
| preparer 原 40 + 新 2 | 42/42 PASS | `r7-prepare-tests.txt` |
| finite JSON 原 6 | 6/6 PASS | `r7-finite-tests.txt` |
| R6 kernel 独立重跑 | 34/34 PASS | `r7-r6-kernel-tests.txt` |
| R7 source/transport 独立重跑 | 30/30 PASS | `r7-native-tests.txt` |

添加双已知路径的真 `os.link` fixture，两个 synthetic ELF inode 均 exact nlink=2；仅在 TemporaryDirectory 替换固定常量，绝不在 production paths 造测试。验证 direct source read 与上层 dynamic_source 都拒绝 alias full-bytes/size/mode、linkadd/unlink、pin/header、固定 owner/dev/ino/mode/size mismatch、known 单链接 clone、unknown 两链接 JS/alias、symlink 与 parent symlink；验证九字段 fstat race、rename、path META、timestamp/ctime、最终源重读和 whole transport 的旧 inode pointer record 拒绝。`r7-synthetic-source-json.json` 为临时合成的 fullSourceMeta/H 机器记录，不是实际 capture。

映射 dev/ino mismatch 与重复 multiplicity 继续拒绝；全部六 own 合法 roll 与本地 API 文件替换不改变稳定 transport；真实 native 库不作为 API/CAS target。新增 preparer 两项测试拒绝旧 R6 scope、旧 fbb530 source import/capture pin。246/40 原方法全部保留，除三个现有 identity/scope 断言方法的 R6→R7 literal 同步外，其旧方法源码逐字节保持。

`r7-ast-diff.json` 精确断言 release 只有 SCOPE、dynamic_read、dynamic_source 的既有顶层节点改变，新增仅 pin 常量和两个必要 helpers；Config/Controller/cas/inventory/union/RPC/9pins/dynamic_maps/kernel/protection sample/transport 等源码 bytes 相同。`r7-source-safety.json` 含六文件前后 SHA/长度、日志 SHA/计数与边界标志。`r7-release.diff` 与 `r7-diff.patch` 为精确源码/六文件差量。`r7-audit.py` 可纯离线重现审计；其一次 AST 节点定位错误已修正并留 `r7-audit-log-initial.txt`，最终 `r7-audit-log.txt` 为 PASS，不影响源码或测试结果。

## 不做及待父任务事项

本子任务没有 Git、MCP、SSH、server、实际 /proc/FD/env 读取、actual capture、实际 Node/模块/库加载、DB、生产 pub/attempt/write/reload、kill 或网络操作。所有测试的 proc、环境和变化均为 TemporaryDirectory 的标准 Python mock。

此变化**不声称扫描整个文件系统 86 aliases namespace**，也不声称所有 aliases 已全文审查。共享 inode bytes/meta/nlink/ctime 漂移由 fixed pins、full META/完整采样记录检测；只能证明有限当前观测，保留原 cooperative shared-lock/full-CAS 协议，不是内核原子 CAS、不防不协作 root 的持续并发更改，也不是持续冻结。

实际 R7 fresh/fullMETA、未知 JS/source graph 的完整审查、Typed/retained witness/当前 sixReady、真实新 fullpackage/manifest/source/tool pins 和正式独立批准全部待父任务。历史 R6 kernel PASS 与本次 mock PASS 不能转换成 APPROVED；若新图遇到其它多链接 JS/native 来源，仍 fail closed 并另审，不增加通用豁免。
