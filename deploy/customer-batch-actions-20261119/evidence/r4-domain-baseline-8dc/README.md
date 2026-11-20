# 客户批次发布控制器：R4 外部推荐服务最小离线保护

## 当前状态：NOT_APPROVED（2026-11-20）

OWNER 保持 `6Lfttf6oVWJ8YS69o5FkXQ`；新 SCOPE 为 **`customer-batch-actions-20261120-6Lfttf6o-R4`**，默认 stage 仅为派生路径，未创建或访问真实 stage。当前 controller SHA256 为 `8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0`；`prepare-local.py` 固定 pin 同步。准确 bf7 基线六文件位于 `evidence/r4-baseline-bf7ec85b/`，全部哈希核对。R3 从未执行 remote stage/capture/attempt，本轮不重用 R3 scope/pin/capture。

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

# 客户批次发布控制器：R3 限定源码与隔离反例

## 状态：NOT_APPROVED（2026-11-20）

R2 `d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec` 已被独立审确认不可发布：固定保护图遗漏 `/var/lib/dianzi51-private`；真实 PM2 cluster fork 将必变顶部 `pm_uptime` 放入 serialized `pm2_env`，R2 只准 outer `NODE_UNIQUE_ID` 的算法必然误判正常 reload。R2 审计在 `/home/ubuntu/work/customer-batch/review-r2-independent.md` 和 `.json`，不是 R3 批准。

R3 OWNER 完整保持 `6Lfttf6oVWJ8YS69o5FkXQ`；SCOPE 为 **`customer-batch-actions-20261120-6Lfttf6o-R3`**，默认 stage 仅因此派生为 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R3`。没有创建或操作远程 stage。当前F1修正后的准确 controller/preparer/test SHA 见 `evidence/r3-f1-source-and-safety.json`；初版ec2及tool历史保留于 `evidence/r3-source-and-safety.json`。preparer 固 pin 与当前 controller 字节相符，不重用 R2 capture、旧 scope、旧 pin 或丢失的 capture JSON。

本轮只修改六个许可 Python/测试/README 文件及 `evidence/r3-*`。不修改业务、UI、JS builder；不执行真实构建器、Git、SSH、MCP、生产访问或 release CLI。测试里的 apply/preflight/verify/rollback、锁、CAS、receipt 和 reload 全部发生在独立临时目录与 mock adapters 中，不是实际发布流程。

10:06独立审查发现F1：普通指数 `1e400/-1e400` 可被旧JSON decoder解析成非有限浮点。主任务只离线增加 `math.isfinite` 的checked `parse_float`、同步pin并新增纯内存 `test_finite_json.py`，不更改任何原token/五字段/PM2/审批/恢复协议。89 controller、32 preparer、6 JSON边界测试通过；所有其它controller AST不变，详见 `evidence/r3-f1-report.md`。主任务Git保存不是ECS发布；ECS备份/容量及前台最新静态需求共同hold，当前版本仍NOT_APPROVED。

## 最小保护图修正

`Config.extra_protected` 在原两个 `/opt/config/.../runtime.env` 后追加准确 **`Path('/var/lib/dianzi51-private')`**。没有替换原保护，没有扩大整个 `/var/lib`，没有修改或删除主任务的 technical-store handoff guard。

原 `union`、`inventory` 的 AST 不变。新根经既有完整递归 inventory 纳入根、文件、目录、空目录、links/targets、完整 META 与精确路径集合，包含 `official-technical/prepared-v1.json`；任何新增/删除、权限或内容漂移仍由完整 snapshot/guard 阻断。七个原 aliases、全部 runtime/env、Node、整个 PM2 base、nginx/flags、其它脚本与原主存储保护均保留。

## 源码绑定与 Node 启动环境

原绝对 RPC specifiers、RPC 字符串、require.resolve-only 探针、existing socket/daemon 校验、调用参数及 no-fallback 行为保持。原 Node、`lib/Daemon.js` pin 与两个 vendor 全部 source/dirs/fullMETA/set 保留；整个 `cfg.pm2_base` inventory 不削弱。

R3 固定八份已读实际生成/重置源 SHA：`lib/God.js`、`lib/God/ClusterMode.js`、`lib/God/Reload.js`、`lib/God/Methods.js`、`lib/Utility.js`、`lib/ProcessContainer.js`、`constants.js`、PM2 root `package.json`。漂移即拒绝，不重新猜测规则。执行任何 Node `-e` 前，Python 只读断言 root `NODE_OPTIONS` 与 `NODE_PATH` 均缺失或空；非空立即拒绝，不 unset、不替换 subprocess 环境、不 fallback。

主任务交接的实际六槽布尔关系证据为 `/home/ubuntu/work/customer-batch/pm2-relations-readonly.json`：identity 全匹配、五个顶部数字字段与 monitor 匹配、这些字段无 app.env override、app.pm2_env override 不存在、root/六槽 loader flags 空。只读 RPC 依赖闭包 `/home/ubuntu/work/customer-batch/pm2-dependency-closure/closure.json` 的 31 records / 62 edges 已逐文件核对 SHA/size，dynamic/unresolved/outsidePm2Base 均空。它只证明交接时两 vendor RPC 的 literal require 解析闭包，不是实际 R3 capture 或发布批准，也不是 God 生成链所有依赖的语义证明。

## 仅 serialized PM2 顶部的精确转换

`pm2_top_tokens` 先严格解析完整 JSON，拒绝任意深度 duplicate key、非 finite 值、错误容器/类型；随后只定位顶部 value token。`pm2_project` 只替换五个源码定义字段的规范安全整数 token：`pm_uptime`、`restart_time`、`created_at`、`unstable_restarts`、`prev_restart_delay`。不删除 key、不排序、不递归重编码，不忽略新增/删除字段或 whitespace/key-order/escape 差异。

**这不是通用 LIFECYCLE 删名规则。** 只有固定 own cluster 槽、name/id/script/cwd/mode/version 与当前 monitor 精确匹配的 serialized 容器可取得投影。稳定 `pm_id` exact；generated/identity/container override、类型/coercion 歧义、错误身份拒绝。完整 `pm2_env.env`、其它 nested 值与 nested `NODE_UNIQUE_ID`、应用同名字段、其它 outer raw/opaque string 都逐字节保留。outer `NODE_UNIQUE_ID` 仍限唯一十进制 Node 槽 id，六 own unique 不能碰撞。

read-current-model/raw 另存不含环境值的 `pm2RawMeta` 和 `pm2ReloadReady`。五字段当前值必须对应 monitor，才可记录；restart_time 不能由 env 覆盖后假装 +1。缺少非首次启动的 reset 字段、monitor 后加字段、预测输出的任意 retained-byte/order/escape 差异产生 not-ready；reload 在写 intent 和调用 adapter 前即拒绝。Python model→fork serialization 仅作保守的 byte-equality 阻断检查，绝不覆盖实际 retained application bytes，也不声称等价于未经审证的实际 JS clone/stringify。

只有绑定当前持久 attempt/准确单 slot intent，PID 改变、restart_time=old+1、Node unique 合法增加、created_at/pm_uptime 落在意图至观测时间范围且顺序合法、unstable_restarts=0、prev_restart_delay=0，并且其余十一槽、source、permissions、全 inventory/META/set exact 时才接受。未滚动 own 槽与其它六槽仍要求完整 raw SHA exact。

## 持久观测与恢复边界

事件新增前/后 PM2 raw metadata、attempt SHA、intent state SHA/sequence 和观测时间。state invariants 读回持久 intent，验证完整十二槽 before 状态、前序 events/loaded 链、准确 API 版本与 current attempt；部分 journal、错槽、旧意图或只伪造 loadedSlots 不能成为观测证明。写 observed event 之前额外证明实际完整 snapshot/source/META/set exact。

非法观测只留下已经持久写入的 intent，不把意图改成成功、不给 loadedSlots 重基线、不能自动解锁或继续。原 uncertain reload、journal fsync 不确定、人工 recovery/rollback 的安全流程保留；原预算、TTL=900、noReplay、receipt 实际闭窗证明、锁/CAS/权限、health 与所有其它业务发布协议不变。具体 AST 保留证据见 `evidence/r3-ast-diff.json`，逐函数源码差异见 `evidence/r3-controller.diff`。

## 离线复核与证据

```bash
cd /home/ubuntu/51-manager/deploy/customer-batch-actions-20261119
PYTHONDONTWRITEBYTECODE=1 python3 -B test_release.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -B test_prepare_local.py -v
```

本轮 controller **89/89**、preparer **32/32** 隔离 mock 单测通过，完整日志为 `evidence/r3-release-tests.txt` 和 `evidence/r3-prepare-tests.txt`。原 60/30 测试方法全部保留（只同步新 schema/pins/fixture）；新增反例拒绝 outer 同名应用值、env 内 life-looking 值、nested/opaque 或其转义字节变化、错 identity、duplicate key、类型、未证 top 字段、多 slot、未滚动 raw、source 漂移、部分 journal 伪观测及 loader flags。PM2 已读生成源码只复制到临时 fixture 做内容 pin，不运行这些模块。

`evidence/r3-baseline-release.py` 保存准确 d6 基线；六文件基线及前后 SHA、精确 AST 差量、完整测试日志与阶段报告均在 `evidence/r3-*`。历史 `evidence/r2-*` 及更旧证据未修改。首次扩展测试的失败日志也保留：本地 sandbox 的 NODE_OPTIONS 非空被正确拒绝，随后仅纯 mock fixture 使用临时 patch 并完整恢复本地环境；控制器没有清洗环境来放行。

## 剩余阻碍：不能由 mock 成功改成 APPROVED

实际六槽的五数字关系证据并未给出全部 retained raw/model 字节 forecast、`prev_restart_delay`、autostart/status/axm 等全部规则的实际满足证明；不以正常 reload 试错补证。Utility.clone 的 `modules/fclone` 源不在当前生成 records 或两 vendor RPC 闭包，Python deepcopy 不是这项源码语义证据。若任一字段/clone/byte-order 规则仍无法证明，必须 fail closed，而非加白名单或递归 canonicalize。

仍需 R3 当次实际完整 fresh capture/fullMETA/private tree 与前台保护集合绑定、真实 new package/manifest/packageFiles、owner/nonce/source/tool pins、fresh API/UI 正逆字节与独立差量审；不得把旧 R2/种子审计或 mock 通过移植为批准。本轮没有正式 approval、实际 capture、封印、receipt、window、active write 或 reload。**controllerApproved=false；finalDeployApproval=false；NOT_APPROVED。**
