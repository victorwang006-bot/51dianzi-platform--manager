from pathlib import Path
import hashlib
base=Path('/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119')
pin=hashlib.sha256((base/'release.py').read_bytes()).hexdigest()
p=base/'README.md'
history=p.read_text()
header=f'''# 客户批次发布控制器：R4 外部推荐服务最小离线保护

## 当前状态：NOT_APPROVED（2026-11-20）

OWNER 保持 `6Lfttf6oVWJ8YS69o5FkXQ`；新 SCOPE 为 **`customer-batch-actions-20261120-6Lfttf6o-R4`**，默认 stage 仅为派生路径，未创建或访问真实 stage。当前 controller SHA256 为 `{pin}`；`prepare-local.py` 固定 pin 同步。准确 bf7 基线六文件位于 `evidence/r4-baseline-bf7ec85b/`，全部哈希核对。R3 从未执行 remote stage/capture/attempt，本轮不重用 R3 scope/pin/capture。

只修改 release/test_release/prepare-local/test_prepare_local/两 README 六文件和 `evidence/r4-*`。不改业务/UI/TS/JS builder，不执行 Git/MCP/SSH、生产 CLI、真实 Node/模块 import/RPC/capture/lock/reload。所有新 fixture 位于 TemporaryDirectory；现有锁、CAS、journal、receipt、reload 测试仅使用既有临时目录/mock，不能视为生产操作或发布证明。

## 两个原 PM2 模型之外的固定进程

只读 helper 固定 parent PID **2060125**，实际 executable basename **flock**，child PID **2060126**，basename **node-22**。父不是另一个 Node，不将二者塞入原 12 槽或六 own 集合。child PPID 必须精确指向 parent，parent PPID 必须有效且无自身/子循环，child startTicks 不得早于 parent。

child bootstrap 精确为 `/opt/ops/dianzi51-recommendation/releases/20261112-forum12-1255b7b84aa3adac09cb8c05/worker-runtime-bootstrap.mjs`；child cwd 精确为 `/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform`。当前 helper 仅支持 child 的 plain executable + exact bootstrap 两参数 argv；任何额外/未知 loader flags、错误脚本、错误 cwd、缺失 PID、复用或不稳定身份立即 fail closed，不搜索 fallback，不启动/杀进程。

`/proc/<pid>/stat` 使用现有虚拟文件 read_bytes 语义（不拿 procfs 的 st_size=0 当 regular 文件长度）。每次完整采样记录 startTicks/PPID/内核路径、whole opaque environ SHA、whole cmdline SHA、permissions SHA、proc 根 META、exe/cwd link META、cwd META，单 proc 前后 identity/link/root 稳定后再作两次完整 pair+source+root 采样 equality。ENV/cmdline 原字节不输出，无 normalization，无 NodeUnique/五元 metadata/PM2 例外。exe `readlink` 的实际路径 fresh 固定，`flock` 不猜 `/usr/bin` 替代路径；child executable **完整文件 SHA** 必须等于 cfg.node。deleted、非规范、未被既有 no-link/single-regular 规则支持的实际 exe/script links/hardlinks 拒绝，不宽放 regular。

Parent cwd 未获准确值：仅 fresh 路径/目录 META 记录比较，不猜等于 child，不递归 `/root` 或 `/`。观察稳定不是未知 loader/dependency 语义 closure；仍需后续 actual 源码和完整保护树审查。

## 精确完整保护根与 transport 绑定

`Config.extra_protected` 保留两个原 env 与 `/var/lib/dianzi51-private`，追加 **完整 `/opt/ops/dianzi51-recommendation` 树**与**完整 childcwd 树**。原 union/inventory AST 与字节不变，负责根、所有文件、目录、空目录、links/targets 的全 META/hash 与精确路径集合。精确根缺少任何一项即拒绝；不能用祖先根假装覆盖。

`transport.externalProtection` 位于原 processes 之外，含二 proc、actual exe + known bootstrap + cfg.node 的 fullSourceMeta/sources 与两个 rootMeta。外部 file hashes 合并进既有固定 `transport.sources`（因此原 RPC 会同样核对）；碰撞不一致拒绝。既有 adapter probes 前后的 collector equality 防漂移，原 Controller snapshot/guard/health/rolling equality 原样覆盖全部 transport，任何 start/env/cmd/permissions/exe/script/cwd/META/source/root 变更拒绝，不重基线。cfg.mock=True 默认明确返回 fixtureOnly 空外部记录以兼容旧临时 fixture；显式 fixture 参数只能在 mock 使用，没有 CLI 参数或生产 override/skip。

## fclone 精确源绑定，而非语义批准

主任务一次获准只读 resolve/SFTP 已交接实际 `/usr/local/lib/node_modules/pm2/modules/fclone.js`，本地副本 `/home/ubuntu/work/customer-batch/fclone-resolved-once/fclone.js`，1239 bytes，SHA256 `9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6`。本轮只将准确 **modules/fclone.js** 追加到 PM2_GENERATION_PINS：原八项逐项保留，无新 require、loader 行为或 dependency 扫描。全 pm2_base META 保护不变。测试仅复制这些已读源字节到临时 fixture 验 pin，缺失或漂移拒绝；没有执行任何源或把 pin 当 retainedWitness/clone 语义证明。

## 离线验证与精确保留

原 89 controller + 32 preparer + 6 JSON 方法全部保留；本轮 **121/121 controller、34/34 preparer、6/6 JSON** 通过。日志为 `evidence/r4-release-tests.txt`、`evidence/r4-prepare-tests.txt`、`evidence/r4-finite-tests.txt`，实际 SHA/bytes 在 `evidence/r4-test-log-hashes.json`。首轮唯一反例预期错误日志保留在 `r4-release-tests-initial.txt`：新增根项更早触发 rootMETA/transport 拒绝；只调整测试为嵌套新增以单独验证 inventory set，不放宽生产代码。

精确 AST 与 byte ranges/hashes 见 `evidence/r4-ast-diff.json`；controller 全差异 `evidence/r4-controller.diff`、transport 最小差异 `evidence/r4-transport.diff`、六文件 diff `evidence/r4-allowed-files.diff`，六文件实际源 SHA `evidence/r4-source-and-safety.json`。release 只改 SCOPE、Config.extra_protected、PM2_GENERATION_PINS 新增一项、transport 并新增纯只读 helpers/固定事实常量；全部 Controller 方法、capture/schema、config_binding、identity、原 12slot/六 own、RPC literal/function、raw semantics/NodeUnique/五 metadata/forecast、loopback budget、CAS/env/source/journal/receipt 协议 AST 与字节均不改。preparer 唯一 AST 改动为 CONTROLLER_SHA，其 scope 已引用 release.SCOPE，不扩大。

## 仍待主任务，不能批准

**controllerApproved=false；finalDeployApproval=false；NOT_APPROVED。** 尚需当次实际 fresh14proc（12 PM2 + 2 外部）完整 identity/env/cmd/permissions/source/root fullMETA、完整 Ops 与 childcwd protected tree review、fclone 完整 retainedWitness/actual clone semantics/forecast、真实新 full package/manifest/source/tool/owner/nonce/完整正逆字节、independent fullpackage 审查及部署许可。本轮没有实际 capture、stage、attempt、approval、window 或 reload。

---

## R3 历史说明（以下非 R4 当前 pin、schema 改动或批准）

'''
p.write_text(header+history)
p=base/'prepare-local.README.md'
s=p.read_text().replace('R3','R4').replace('current-r3','current-r4')
s=s.replace('bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab',pin)
s=s.replace('Config 原路径保持，仅追加准确 `/var/lib/dianzi51-private` 保护根；preparer 的对象-only union 检查不能漏掉新根。R4 process rows 新增', 'Config 保留两个 env 和 `/var/lib/dianzi51-private`，R4 追加准确 `/opt/ops/dianzi51-recommendation` 与 `/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform` 完整保护树；对象-only union 检查不能漏掉任一精确根。R3 原 process rows 的')
s=s.replace('由当前 controller 的严格 schema/identity 验证；', '原样由当前 controller 的严格 schema/identity 验证，外部两进程只在 transport 之外的 PM2 模型外部记录中保护；')
s=s.replace('evidence/r3-controller.diff','evidence/r4-controller.diff').replace('evidence/r3-report.md','evidence/r4-report.md')
s=s.replace('原 30 项测试方法保留，新增 R2 scope/d6 pin 拒绝和 R4 private union 漏根拒绝，共 **32/32** 通过。', '原 32 项 preparer 测试方法全部保留，新增 R3 scope/bf7 pin 拒绝与 R4 两外部精确根漏根拒绝，共 **34/34** 通过。')
s=s.replace('evidence/r3-prepare-tests.txt','evidence/r4-prepare-tests.txt').replace('**89/89**','**121/121**').replace('evidence/r3-release-tests.txt','evidence/r4-release-tests.txt').replace('evidence/r3-static-checks.json','evidence/r4-source-and-safety.json').replace('evidence/r3-ast-diff.json','evidence/r4-ast-diff.json')
s=s.replace('尚缺实际 R4 fresh capture/private tree fullMETA/前台保护集合绑定、retained raw/model 完整 forecast 与 clone 语义证据', '尚缺实际 R4 fresh14proc/full protected trees/fullMETA/前台保护集合绑定、fclone 完整 retainedWitness/实际 clone 语义与 retained raw/model 完整 forecast')
s=s.replace('仅接受 **', 'R3/bf7 基线仅用于差异审计，不重用其 capture。只有 pin 改动，preparer 所有方法/schema AST 与原字节不变；scope 直接引用 release.SCOPE。仅接受 **',1)
s=s.replace('外部两进程只在 transport 之外的 PM2 模型外部记录中保护', '外部两进程只在 transport.externalProtection 中保护，不放入 PM2 processes')
p.write_text(s)
print('R4 documentation written; current SHA',pin)
