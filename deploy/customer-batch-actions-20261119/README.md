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
