# R6 精确 io_uring kernel anonymous mapping 支持：NOT_APPROVED

## 本轮范围与准确基线

本轮仅离线修改 `release.py`、`test_release.py`、`prepare-local.py`、`test_prepare_local.py`、`README.md`、`prepare-local.README.md` 及新增 `evidence/r6-*`。没有 Git、MCP、SSH、prodCLI、Node、实际 `/proc`、真实服务/数据库、reload 或 capture 操作；没有读取 FD、log、队列内容，没有新增系统源码依赖。没有访问或覆盖旧 R5 stage/source。Python 测试只导入控制器定义并使用既有 TempDir/mock，未执行应用入口或生产源码。

修改前先保存六文件到 `evidence/r6-baseline-36706f/`，`cmp` 逐字节核对，固定基线 SHA 在该目录 `SHA256SUMS` 与 `r6-ast-diff.json`。准确 controller 基线为 `36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14`。保存后、修改前重跑原 **212/38/6** 全通过。

当前 controller SHA256：**`fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348`**。`prepare-local.py` 的 `CONTROLLER_SHA` 同步固定该值。OWNER 仍为 `6Lfttf6oVWJ8YS69o5FkXQ`；SCOPE 全新为 **`customer-batch-actions-20261120-6Lfttf6o-R6`**，默认 stage 派生为 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R6`，本轮没有创建或访问该真实目录。

## 必要最小实现

只改两个既有函数：`dynamic_maps`、`dynamic_proc`。新增两个 helper：`dynamic_map_fields` 逐行纯格式验证、`dynamic_kernel_mappings` 纯类型记录。原 maps 格式验证 AST 原样提取；file-backed absolute/fullpath 分支 AST 和字节完全相同，原全 H/fullMETA、mapping permissions/offset/device/inode/multiplicity、源码读保护和 FS dev/inode 验证不变。

relative branch 在完成 per-line address/perms/offset/dev/inode 格式验证之后，仅精确 **`b'anon_inode:[io_uring]'`** 进入新类型支持。要求权限非执行且共享（`parts[1][2:] == b'-s'`）、inode 正整数、地址区间长度正值；设备仍须符合原十六进制 major:minor 格式。不泛化其它 `anon_inode:*`，不支持 unknown name、io_uring name lookalike、deleted suffix、exec、private mapping、inode 0 或非法字段。看起来像 io_uring 的绝对路径不走匿名类型例外，仍是原 file-backed 全源码保护；deleted absolute path 仍拒绝。原 `[heap]`、`[stack]`、`[vdso]`、named bracket mapping 政策未重写。

`dynamic_kernel_mappings(rawmaps)` 的记录为排序列表，单条字段固定为：

```text
[exactName, permissions, offset, device, inode, mappedLength]
```

其中名称、权限、offset/dev/inode 保留 maps 原字段字符串；`mappedLength = addrEnd - addrStart`，不记录绝对 ASLR 位置。完整列表不 dedup，重复数保留。该 helper 不进行任何 FS/proc/FD 读取。

`dynamic_proc` 新增 `kernelAnonymousMappings` 字段，并对原复核末尾的第二 maps 读取同时精确比较 file-backed 图和 kernel anonymous 图。每个 foreign 的 record 原样进入 `processes`，因此全 transport equality 保护 kernel 新增/消失、重复数、权限、offset、device、inode、长度变化，main God、extra God、unowned 六槽及父 closure 同样 exact。原 final full-proc 复核与 two-complete-sample/equality guard 未改。

six-owned 的 `dynamic_owned` 整个函数 AST/字节不变：stableSlots 仍只保留 execution-source graph 和原 slot/kernel-exe/serialized binding，不把运行期 ring inode/meta 或地址位置纳入 stable slot。合法 roll 可重新分配 ring inode，不影响 transport；但每次采样仍先严格验证类型且完整进程复核，不存在 kernel 类型带来的源码弱化。原 six raw/PID/start/snapshot/identity/reload 证据链保护全部不变。mutable API 仍由原 inventory/CAS 保护，不是 anonymous mapping 例外。

## 类型依据与实际观察的来源界限

父任务已完成 Linux 依据的 search/fetch；本子任务不联网重复研究，也不读取任何真实 diagnostic：

- Linux `io_uring/io_uring.c`：<https://raw.githubusercontent.com/torvalds/linux/master/io_uring/io_uring.c>。`io_uring_get_file` 用 `anon_inode_create_getfile("[io_uring]", &io_uring_fops, ..., O_RDWR | O_CLOEXEC)`，注释说明应用 mmap 此 anonymous FD 访问 SQ/CQ details。
- `io_uring(7)`：<https://man7.org/linux/man-pages/man7/io_uring.7.html>。ring 是 user/kernel shared data，经 `PROT_READ | PROT_WRITE`、`MAP_SHARED` 映射，而非 ELF/code source。
- `proc_pid_maps(5)`：<https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html>。定义 address/perms/offset/dev/inode/path fields。

父任务传达的实际事实（不是本轮重新生成或独立复核）：11:55 R5 首次 private controller 上传后 READONLY capture 因 `DYNAMIC_UNSUPPORTED_MAPPING` 拒绝，没有生成 capture/attempt/window/active write/reload。11:56 单有界纯只读 diagnostic 完成，当前 20 Node 加 parent graph，17 Node PID 上合计 110 个 unsupported 条目都为精确 `anon_inode:[io_uring]`，权限 `rw-s`、dev `00:0f`、nonzero inode。diagnostic 文件 `/home/ubuntu/work/customer-batch/r5-mapping-diagnostic-once.json` 不是源码文件，未被读作 source，也不进入源码 H/META 或任何新增依赖。

父任务同时传达新增 unknown Node（2064149/2064150）必须 fresh 动态集合保护和后续 unknown-code-graph 审核。实现未固定实际 Node 总数或这些 PID，unknown birth 继续 equality guard 拒绝；typed mapping 合法不是 unknown graph semantic approval。

## 回归与静态审计

- 保存前 stable 原 suite：**212 controller / 38 preparer / 6 JSON** 全通过，日志 `r6-baseline-*.log`。
- 当前全部 suite：**246 controller / 40 preparer / 6 JSON** 全通过，日志 `r6-controller.log`、`r6-preparer.log`、`r6-json.log`。
- 单独新方法：**34 controller / 2 preparer** 全通过，日志 `r6-new-controller.log`、`r6-new-preparer.log`。
- 34 新 controller 方法覆盖 exact type、非执行共享、unknown/lookalike/deleted/exec/private/inode0/格式/非正长度拒绝，绝对路径不匿名豁免，kernel record 不伪装 filesystem source，God/unowned6/parent 保留，foreign new/drop/multiplicity/length/offset/device/inode/perms guard，ASLR 同长移动非干涉，第二 maps 与 final source phase 复核，owned 新 ring inode 合法 roll、owned exec/source 弱化拒绝、unknown birth 和 fresh 非固定动态集合、whole transport equality。
- 2 新 preparer 方法拒绝旧 R5 scope、准确 36706f capture pin，且精确旧 source bytes 在 loader pin 检查时拒绝，未 import 旧 controller。
- 原 **212/38** 方法全部定义保留，仅 3 个 current scope/stage 断言同步 R6；原 R5 F1/F2 的 8 个方法保留。

静态审计 `r6-audit.py` 只使用 AST、文本和哈希，不 import project。`r6-ast-diff.json` 证明 Controller 整体 AST/字节相同、**30 methods**；**全部 9 PM2_GENERATION_PINS** 相同；Config 全体（extraProtect/fullTree）、所有其它未涉 helper、RPC、transport、domain、inventory/CAS、原 owned/source-root/final-budget 等 AST/字节不变；preparer 全部函数定义相同，仅 fixed pin 更新。六文件统一差异见 `r6-six-files.patch`，所有 current source/log SHA 在 `r6-source-and-safety.json`。

## 未审批门槛

**R6 仍 NOT_APPROVED。** 本轮不是 capture、META、完整 sourcegraph 或包审批，没有生成真实 capture、attempt、window、witness、receipt、approval、release package，没有 active write/reload。父任务负责协调 fresh 窗口；不能复用旧 R5 stage/source/capture 或历史 review。

父任务传达 actual six readiness 已 once 六个 literal True，但这不是 fullMETA、typed semantics、unknown sourcegraph 或整个新包审批。R6 源码的后续实际阶段仍须 fresh 完整动态 Node+parent 图（包括新增 unknown）、fresh 6-own raw/snapshot/readiness、full H/META、transport/sourcegraph 独立审、byte witness/CAS/预算及准确新 scope/pin 包绑定，完成原全部门槛后由父任务独立判断；本轮没有授权或执行真实 publication。
