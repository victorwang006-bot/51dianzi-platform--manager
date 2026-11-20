# 客户批次发布控制器：离线恢复与安全单测

## 结论

已从优先私有原版 `release-07188c50996a3b6b.py` 恢复 `release.py`，适配完整 OWNER `6Lfttf6oVWJ8YS69o5FkXQ` 和新 SCOPE `customer-batch-actions-20261120-6Lfttf6o`。默认 stage 因而为全新 `/opt/ops/customer-batch-actions-20261120-6Lfttf6o`，**本次没有创建或操作此远程目录，也没有复用任何旧 stage**。

**43 项隔离安全单测通过**，离线 `compile()` 通过且未生成 pycache。测试只使用独立 `TemporaryDirectory` 的合成数据；不会调用 `capture()`，生产 subprocess / HTTP / reload 适配器被阻断，RPC 被合成 monitor 数据替代。未运行 SSH、生产 CLI、生产写入/reload/capture/锁操作、MCP、Git commit/push。不能把这些单测当作新真实发布全流程或生产发布批准。

提供的现网上下文仍是前台 `recovery-required`、`shared_release_active=true`、旧 owner `XM2KNK1v`。本次没有读取或改变现网。**不得凭本报告解除该暂停；必须由前台责任方独立恢复并形成完整关闭证明，再另行获得操作授权。**

## 恢复依据及 SHA

原代码只读保留在 `/home/ubuntu/work/customer-batch/original-controllers/release-07188c50996a3b6b.py`，SHA 已核对：

```text
原版 07188:
07188c50996a3b6b90c0f255c054a34e72de815706910d6395ac7ef6eb8cc0ae
仅替换 OWNER/SCOPE 两行的内存中间版本:
7ced926b88f3e9bb09fb2c892ec6d55a95b4b288685117d5be35b47294d8a8cb
最终 release.py:
7fc9ec42ce21f6d0167b36ffbbe7642865a16f70fc31f8b99bf0da4862598423
```

`evidence/source-and-safety.json` 记录完整来源、测试 SHA 和静态边界核对；`evidence/adaptation.diff` 是相对 07188 的差异；`evidence/offline-tests.txt` 保存测试结果。历史比较保留了 07188 的历史 `protectedFiles` 非负计数兼容，以及确切的 PM2 adapter package 元数据 pin；没有退回 3edd/e0d。

## 保留的固定协议

固定生产路径没有泛化，CLI 不能指定 mock/替换生产配置。原 `Config`、CAS、固定 RPC、transport、完整 inventory、12 槽 identity、manifest/source/review payload 校验与 patch scope 的 AST 均与 07188 相同。继续要求 fresh 完整 META、12 个唯一在线进程、7 个固定链接、两 API/后台 HTML/两新 JS/scoped CSS 的限定内容边界，只允许 4 front + 2 admin 捕获槽逐一滚动，源码和 manifest/review 封印、现有双锁、完整字节与 META CAS。

任何 `receipt` 目录（空目录、失败尝试或 symlink 也包括）都会拒绝再次 apply/preflight。恢复 journal 必须显式 pin 当前 attempt 和最新连续 hashchain state；不能使用过期 state、篡改历史、猜测 ownership 或自动重放。

## 本次重点补强

1. **rename 记忆顺序**：保留原 CAS 中 `os.replace` 后立即调用 `remember(describe(p))`，在目标目录 fsync 前更新内存。测试验证目标目录 fsync 故障后仍持有新字节/META，可在临时目录内用新的完整 CAS 恢复；file/coord 的 checkpoint 故障也必须保留 rename 后内存，而不能误以为旧目标仍在。
2. **raw 环境只准一项例外**：只对固定 own 槽的 semantic hash 去除唯一、十进制的外层 `NODE_UNIQUE_ID`。非重载槽仍要求 `rawSha256` 完全一致；只有被 journal 证明的 own 单槽重载事件才能接受对应 lifecycle raw 变化。保留 `NODE_APP_INSTANCE`、`NODE_CHANNEL_FD`、nested `pm2_env` 原值以及全部其他 raw key/value，连看似 lifecycle 的环境名也不剥离。权限 hash 独立保留；其他 11 槽逐次精确比较。
3. **恢复批准独立且 fresh**：rollback 不受原 capture 过期阻碍，但批准必须包含 `approvedAtUtc`（带时区、非未来、900 秒内）和 `ttlSeconds=900`，并绑定 common pins、attempt、最新 state、outcome、packageFiles、targets、仅已加载槽和保留资产。每次 recovery guard 都再次检查时间、批准原始文件 SHA、批准对象与 reviewer report SHA。缺字段、过期、自审、漂移均拒绝。
4. **成功证明不能靠 status**：`durable_success()` 在 receipt 文件与目录 fsync、读回之后，再核对实际完整关闭 coordinator raw SHA、owner/attempt/review/capture/manifest 绑定、完整 history 末项、durable 最新 state 和 attempt，以及目标与 loaded slots 完整性。公开 verify 也重新证明；仅见 `status=verified/closed`、错 raw SHA、错 journal 或错误健康均不能成功。
5. **失败只保持 own hold**：失败不会自动 rollback，也不删资产、不清外部锁、不改外部 coord。只有本进程已持正确双锁、窗口属于完整当前 attempt，且实际 coord 字节/META 与最后内存精确匹配时，才允许窄 CAS 标记 own `recovery-required` hold。关闭后 receipt 证明失败也不放行；若无法证明 hold，failure 明示 `successProven=false`、`holdProofError` 和须人工恢复。failure receipt 本身写失败则公开方法明确返回 `*_RECOVERY_REQUIRED_FAILURE_RECEIPT_UNPROVEN`。
6. **日志不确定性封闭**：checkpoint 创建或目录 fsync 失败会标记 `journalDurabilityUncertain` 和 pending SHA，阻断同对象后续 guard/checkpoint/retry；失败报告保留该事实。不会把已存在的半成功日志覆盖为“重试成功”。

## 离线复核

仅运行以下本地单测，不执行 release CLI：

```bash
cd /home/ubuntu/51-manager/deploy/customer-batch-actions-20261119
PYTHONDONTWRITEBYTECODE=1 python3 -B test_release.py -v
```

测试实际调用 public `bundle/preflight/apply/verify/rollback` 与相应 guard/CAS/journal 方法，覆盖源码/manifest/review 封印、raw 唯一例外及其它环境/权限漂移拒绝、完整 coord 关闭/外部 fields/历史保留、preflight 零写、foreign recovery busy 和外部双锁 busy 拒绝、不可重放、rename/fsync/journal CAS 故障、fresh 恢复批准、关闭后回执失败与实际 raw 绑定。合成 apply/reload 只是本地控制器协议测试；合成恢复成功案例仅为 baseline-only own 恢复，不等于真实六槽发布/恢复验收。

## 缺失与阻碍

未运行真实三个 JS 构建器，未验证真实客户源码编译/AST/ABI 或独立 reviewer 的判断，也没有新真实 release package、生产 PM2/Node/RPC、实际监听器/HTTPS、真实 UID/GID 的全链路证据。严格 raw 语义可能在真实 PM2 序列化环境有其它漂移时阻断；这是刻意 fail-closed，不能借部署时机扩大例外。日志或目录 fsync 不确定可能需要独立授权的人工取证恢复，不能通过重放、rebase、强制解锁或旧 stage 接管绕过。

**共享目录变化需主任务核对**：本子任务未写入或执行任何 JS；`backend-builder.cjs` 与 `backend-test.cjs` 前后 SHA 一致。但观察到 `build-native.mjs` 从 `d5afe1fb…` 变为 `99dfe488…`，且 Git 显示其外部变化。本子任务没有回退该文件。前后完整 SHA 在 evidence 中，主任务需确认其它共享执行的变更归属，不能据本报告宣称三个构建器整体未变。

## 主任务接续补充

`build-native.mjs` 的变化由主任务有意新增 `--verify-sources`：只编译既有七个客户叶并检查嵌入失败编辑器，没有生产读取、捕获或写入。2026-11-20已实际运行并通过，无未绑定新标识符或新运行时导入；结果另存 `evidence/source-abi.json`。这只证明源码/native绑定可编译，不代替真实现网ABI、全量META、候选逆向证据及最终独立发布审核。

后台历史失败编辑入口已补齐原列/附注和当前编辑值导出，删除及批次查看沿用原实现。最终五个修改测试文件77项通过；其它原行为八文件238项通过（有交集不加总）。所有测试使用隔离fixture且不连接生产数据库。原控制器安全测试证据保持原样，不能将其子任务的零SSH声明误读为整个主任务：主任务曾仅定向只读取回原三个控制器源码，服务器写入/重载/捕获/锁操作仍为0。

保存源码与生产上线分开。前台任务当前优先持有恢复/发布流程；未收到前台最终verified closed实际回执和明确交接，本任务不得运行capture/preflight/apply。后续必须新鲜现网重建、复审并定向发布，不重放旧stage，不全量覆盖dist，不触生产物料或DDL。
