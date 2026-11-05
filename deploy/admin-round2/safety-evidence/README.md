# Boot-resurrect / publisher 修正交付报告

本报告与日志仅证明本地 **synthetic 工具安全测试**；不是生产 QA、应用最终 QA 或发布结果。完成时间及最终全部工具 SHA 以 [verification.json](./verification.json) 为准。原 `/home/ubuntu/backend-optimization/round2/tool-evidence` 的旧工具 hashes 不再适用于本版。

## 修改范围与具体 patch

只修改 `deploy/admin-round2/persist-targets.mjs`、`publish.py`、相关 `safety.test.mjs` / `test_publish.py` / `README.md` / `qa-approval.expected.json`，并按父级后续明确授权，在 `build.mjs` 中最小排除两个根目录 tool-owned 临时名称 `.round2-vitest.config.mjs` / `.round2-test-isolation.mjs`。新增的本目录内容仅为相关 safety evidence。

`persist-targets.mjs` 删除 static ecosystem 求值/字面量替换假设，不再使用 vm、require 或任何配置写入。三份实际配置 SHA 硬绑定父级只读 boot 基线，使用 no-atime/no-follow fd hash；bytes、所有记录 metadata 和 realpath 保持不变。生态 receipt 为 fingerprints + combinedHash + 空 configs，没有 scripts。动态 admin 配置不会加载，ENV 不打印/落盘。

Boot authority 改为 `pm2-root.service → /usr/local/lib/node_modules/pm2/bin/pm2 resurrect → /root/.pm2/dump.pm2`。systemctl cat / show 在内存捕获，仅输出 hashes 与确认过的非秘密字段；同时核验 on-disk/effective 指令，拒绝 pending 未重载的旧启动、wrapper、非 root/未 enabled、另一 PM2_HOME、EnvironmentFile/pre/post 覆盖。全部 unit/config hashes 跨阶段保持稳定。

Activation 先 `--boot-check` 纯验证，确认 dump 与 live 的启动/ENV projection 未漂移，然后执行已存在、未改的 exact-ID reload helper；publisher 记录 `lastProcesses` 后才 `--save`。旧 `--config` 兼容为同样的 no-op 验证，不修改 cfg。`saveFreshDump` 用实际当前 sanitized PM2 snapshot 与 state 全量匹配、验证 approved side/online/exact IDs，保存后检查完整 fresh dump contents hash（不是受 JSON 缩进影响的原始 bytes hash）和 semantic hash，再确认实时进程未漂移。完整非目标配置/ENV和未知 launch 字段不放宽，指定 API 只允许合法旧→新 entry 和必要 PID/counter bookkeeping；front 阶段 admin 的两条路径仍旧。PM2 dump 的 daemon ID/instances 删除及 module omission 用保存 projection 处理，不伪造 dump IDs，以 live exact IDs + unique instance identities/counts/完整内容对应确认。

`publish.py` 的 API/DDL guard 强制 regular file、拒绝 symlink 祖先，即使内容 hash 相同也不能换成 symlink。runtime links 保留原始 link 字符串/realpath、源 bytes/metadata、依赖 manifest、所有旧 dist companions，并拒绝秘密文件和别名。修复旧 publisher 的另一必停问题：admin public fingerprint 原本把新 namespace 资产和受控 HTML 切换也算漂移；现在仅排除这两个本轮已单独保护的范围，其余旧资源仍严格保护。

所有资产 HTTP 校验维持切换前本机全量、切换后本机+公网全量，不抽样、不删检查；加 nonce/no-cache/identity 并对完整内容 SHA 校验，所有 origins 的 bounded concurrency 总上限为 8。任何失败仍 STOP；已 reload 的新 APIs 留存，coordination active 留存，只有本轮 candidate HTML 可以回退，不自动回旧 API。

`build.mjs` 精确临时名排除测试还证明普通配置、近似根配置及 source 子目录中的同名文件仍属于冻结范围。本任务没有执行最终源码 freeze。

## 已执行测试

| 命令 | 结果 | 证据 |
|---|---|---|
| `node --test --test-reporter=spec deploy/admin-round2/safety.test.mjs` | 28/28 passed | [node-safety.log](./node-safety.log) |
| `PYTHONDONTWRITEBYTECODE=1 python3 deploy/admin-round2/test_publish.py` | 26/26 passed | [python-safety.log](./python-safety.log) |
| 所有顶层 `.mjs` 的 `node --check`、两份 `.py` AST | passed | [verification.json](./verification.json) |
| `persist-targets.mjs --help` / `publish.py --help` | offline help 正常 | 未调用 PM2/HTTP/DB |

覆盖真实基线 graph/boot 元数据的离线读取、opaque 动态配置无执行、no-write boot check、磁盘/effective unit 分歧、fresh dump projection、两个 side 的 old/new 递进、实例 identity、未知 launch/ENV/worker 漂移、保存前后失败、新 API 留存、100 assets × 两 origins 全量且并发不超过 8、nonce/body hash、不抽样失败、static runtime 合法范围、API symlink 防护，以及整个临时目录 prepare → front activation → admin activation → static 流程中实际 publisher guard。所有 PM2/systemctl/HTTP/服务器路径均为 fixtures 或 mocks，没有执行真实生产工具。

可重跑证据：`PYTHONDONTWRITEBYTECODE=1 python3 deploy/admin-round2/safety-evidence/revalidate.py`。脚本重新测试、记录当前工具 hashes，并核对七个未授权工具与原 evidence 一致。

`build-service.mjs` 未修改，SHA256 为 `0ba95ffae2f5b52cf722852dd89a0577b4f480463ef41e5a1697e736e7c343b4`；lib / migrate / reload / runtime-contract / test-isolation / vite-worker 也已与原 SHA 比较并确认未改。

## 父级下一阶段 CLI（本任务没有执行）

必须等功能 agents 收口后，使用本版工具重新 `--freeze --agents-complete` / build / verify-local，生成新的 `freeze.toolFiles`、manifest `toolArtifacts` 与 manifest-bound `qa-approval.json`。不要沿用旧 manifest、旧审批或旧工具证据。具体 freeze/build 命令见上级 README。

父级单独授权并完成完整 package staging 后，在服务器本地使用 frozen packaged publisher：

```bash
P=/opt/ops/20261105-admin-compact-priority-v2
python3 "$P/tools/publish.py" --package "$P" --plan
python3 "$P/tools/publish.py" --package "$P" --prepare --authorize-production
python3 "$P/tools/publish.py" --package "$P" --migrate --authorize-production
python3 "$P/tools/publish.py" --package "$P" --activate --target front --authorize-production
python3 "$P/tools/publish.py" --package "$P" --activate --target admin --authorize-production
python3 "$P/tools/publish.py" --package "$P" --static --authorize-production
```

内部每个 activation 调用顺序为 `persist-targets --apply --authorize-production --side SIDE --boot-check` → `reload-target` → publisher 保存 sanitized lastProcesses → `persist-targets ... --save`。只允许 phase 顺序推进；已完成 phase 不重放；partial failure 必须人工检查。

真实环境尚未用新工具核验。若实际 PM2 save schema、未知字段或 systemd 契约与预期不同，新工具 fail closed，不能用扩大忽略范围或自动 rollback old APIs 解决。此 caveat 不影响已经完成的 synthetic tool tests，但它们不能替代父级受保护的真实 baseline/发布核验。

未执行：最终共享源码 freeze、业务 tsc/Vitest/Vite/API esbuild、生产连接/SSH/scp、真实 PM2/systemctl/HTTP、ENV输出、DB/DDL/业务 DML、最终 React/browser QA、任何 commit/push。其它功能/DDL/应用源码与父级 build-service 未改。
