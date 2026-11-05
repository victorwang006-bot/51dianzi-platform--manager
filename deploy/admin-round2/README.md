# 后台第二轮离线构建 / combined API 发布工具

版本：`20261105-admin-compact-priority-v2`。本目录为独占工具目录；`build-service.mjs` 是父级既有文件，未修改。工具开发阶段没有冻结共享源码、执行最终业务构建、访问生产、执行迁移或提交/push。

## 1. 父级收口后离线构建

四位功能 agents 完成并由父级收口/提交后才执行（`--agents-complete` 是明确确认门槛）：

```bash
cd /home/ubuntu/51dianzi-manager
node deploy/admin-round2/build.mjs --freeze --agents-complete
node deploy/admin-round2/build.mjs --build --freeze-record /absolute/run/freeze.json
python3 deploy/admin-round2/publish.py --package /absolute/run/package --verify-local
python3 deploy/admin-round2/publish.py --package /absolute/run/package --plan
```

`run/front` 和 `run/admin` 同级，主站 `.tsx` 中 `../../admin/client/...` 映射到真实冻结后台，不删除测试、不修改 tsconfig。冻结两端 client/shared/server/drizzle/scripts/tests、根级 configs、lockfiles、依赖 manifest 与全部工具，拒绝源 symlink/秘密文件名。复用各端现有 node_modules；子进程使用隔离 HOME、净化 ENV，不载入 `.env`。源、HEAD、依赖或工具摘要漂移即 STOP。失败保存 build-state/log/result，**不产生 manifest**，不能盲目重跑旧 build 目录。

根目录配置扫描只排除工具自身生成的两个严格名称 `.round2-vitest.config.mjs` / `.round2-test-isolation.mjs`，避免工具运行时使 frozen snapshot 自漂移；普通配置、近似名称以及 source 子目录内同名文件仍受冻结比较保护。此处 `build.mjs` 小修已由父级单独授权，`build-service.mjs` 不变。不执行本轮最终源码 freeze。

真实执行两端 `tsc --noEmit --incremental false`、两端相关 Vitest、仅 manager frontend Vite、调用未改的父级 esbuild helper 构建两端 API，共七项 command/log 摘要绑定最终 manifest。Vitest 使用独立 include，包含 `.tsx`、原导航/渠道/客户、memory、Staff、archive、父级 `channelInventoryListBusinessInput.test.ts` / `customerStarsBusinessHook.spec.ts` 与 strict BFF；未出现 archive 回归测试会 STOP。DB/直接连接测试明确记录缺隔离连接 skip；nonDB suite 禁止网络/DB连接，不继承 production ENV。skip 不等于 DB QA passed。

新后台 assets 使用版本 + **双端完整 source SHA** namespace；保留旧 assets。基线已无 importmap，只替换实际 module tag、styles、preloads 三个范围，按 UTF-16 offsets 逆向还原为 SHA `331750...`，其它 inline runtime 字节原样保留。前台 UI 不构建、不替换。

## 2. 父级 QA 与独立 schema 阶段

参考 `qa-approval.expected.json`，由父级将真正完成的审查/授权结果写成包内 `qa-approval.json` 并绑定 manifest SHA、两个 DDL artifact SHA 和证据。模板所有审批字段为 null，不能用于审批。授权 React fixture QA 必须标为 `authorized-react-fixture`，不得冒充生产 browser 已验证。

包内 `admin/scripts/20261105-admin-staff-archives.sql` 和 `apply-admin-staff-archives.mjs` 来自冻结源。独立 `--migrate` 阶段先于两端 API activation；只允许父级审过的 `CREATE admin_staff_archives` + schema 形状读取，不执行员工业务 DML/历史迁移。迁移 helper 只在显式授权调用时从当前 PM2 后台两实例 **内存** 取一致的 DATABASE_URL，转交净化 childenv；不读 `.env`、不打印/落盘连接，不复制 worker ENV。是否最终授权该阶段由父级决定。

## 3. 父级单独批准后的服务器本地步骤（本任务不执行）

父级负责将完整 package 放到 `/opt/ops/20261105-admin-compact-priority-v2`，再运行包内冻结工具。所有 mutation 必须显式 `--authorize-production`，共用 `/var/lock/dianzi51-public-deploy.lock` 与既有 coordination 文件。

```bash
P=/opt/ops/20261105-admin-compact-priority-v2
python3 "$P/tools/publish.py" --package "$P" --plan
python3 "$P/tools/publish.py" --package "$P" --prepare --authorize-production
python3 "$P/tools/publish.py" --package "$P" --migrate --authorize-production
python3 "$P/tools/publish.py" --package "$P" --activate --target front --authorize-production
python3 "$P/tools/publish.py" --package "$P" --activate --target admin --authorize-production
python3 "$P/tools/publish.py" --package "$P" --static --authorize-production
```

`--plan` / `--verify-local` 只读本地 package，不调用 PM2/HTTP/DB，不做生产 baseline 或 browser 验证。`--prepare` 进行新鲜脱敏 baseline 比较并冻结保护摘要，新增独立 API 路径 `/opt/releases/<version>/{front,admin}/dist/index.js`，package/node_modules/public 与旧 dist 辅助资源沿当前旧 links 保留。后台及主站 static realpath 必须保持原路径。

新 API/DDL 必须是无 symlink 祖先的 regular files，即使重定向后的内容 SHA 相同也不接受。runtime links 的原始 link 字符串、realpath、旧源 bytes/metadata 与依赖 manifest 受保护，保留所有旧 dist 伴随文件/目录。不读取秘密伴随文件或指向秘密文件的别名。后台 public 指纹只排除本轮唯一 namespace 和单独受控的 `index.html`；否则 staging 新资产或合法 HTML 切换会错误触发 guard。所有旧资产 bytes/metadata、其它 public resources 和主站 public 保持不变。

`--activate` 强制 front 4 实例 `[190,193,194,200]` 后 admin 2 实例 `[191,192]`，每实例使用已确认 `reloadProcessId/current_conf` 定向契约，不 reload 整个 app/worker。每步检查非目标 PID/restarts/source/env/config/hash 完全不变；目标仅接受新 script/SHA、PID 和一次 restart 必要变化，launch config /应用 ENV 不变。ENV bookkeeping 排除规则与旧 helper 一致。

### Boot authority / persistence 修正

父级最新只读基线 `boot-proof.txt` / `boot-target-configs.json` 已证明实际启动为 `pm2-root.service` 的 `/usr/local/lib/node_modules/pm2/bin/pm2 resurrect`，权威数据是 `/root/.pm2/dump.pm2`。旧 `/opt/config/dianzi51/ecosystem.config.cjs` 只有 front + 两 workers，script 是 `dist/index.js`，并不含 admin；另两份 admin 配置含动态 require/process/env，因此不能加载、执行或补写。

工具把以上三份配置当作 opaque protected files，按父级捕获的三份 SHA 验证并保留 bytes、mode/uid/gid、inode、atime/mtime/ctime/birthtime、realpath；用 Linux no-atime/no-follow fd 只 hash 原始 bytes，不执行配置或导出应用 ENV。`ecosystem` receipt 仅为 `{sha256: fingerprints, semanticSha256: combinedHash, configs: []}`，**没有 ecosystem.scripts 假设**。systemctl cat 和 show 全部输出只在内存中捕获并 hash，不打印或落盘 unit/ENV；同时验证 on-disk 与 effective ExecStart 都是 root exact resurrect、enabled、PM2_HOME 指向 `/root/.pm2`（或 root 缺省），拒绝未 daemon-reload 的不同启动指令、wrapper、EnvironmentFile、pre/post boot 命令和其它覆盖。unit 与 effective 属性 hash 全阶段不变。

Activation 顺序为：`persist-targets --boot-check` **只验证，不改任何 cfg/dump** → 指定 side 的 sequential reload → publisher 记录新鲜 `lastProcesses` → `persist-targets --save` → readiness。旧 `--config` 参数只兼容为相同的 validation-only no-op，不再有写配置阶段。

`beforePersistence` 与 `lastPersistence` 同时作为 guard：save 前 dump 必须仍是上阶段记录，boot/config 不得改变，dump 的完整非目标配置/ENV与任意未知 launch 字段不能变化。只有指定 API 的合法旧→本轮新 `pm_exec_path` 及必要 PID/时间/restart counters 在 semantic hash 中归一化；`script`、cwd、status、instance identity 与其余应用 ENV 不放宽。front save 后 admin 的两条 dump 路径必须仍旧，admin save 后才要求两端均新。

Save 先把真实当前 `pm2 jlist` 的脱敏 summary 与 `state.lastProcesses` 全量比较，并确认 front 四个/admin 两个 exact IDs、approved side 路径及 online 状态，再运行 `pm2 save`。按照 PM2 save 的 `pm2_env` projection（排除 pmx modules、daemon-only pm_id/instances/prev_restart_delay）验证 fresh dump 的完整规范内容 hash，兼容 JSON 缩进差异；典型 dump 不保存 pm_id，因此以 live exact IDs + dump unique NODE_APP_INSTANCE、名称、数量及完整配置对应确认，不伪造持久化 IDs。再次读取 PM2 验证 save 期间未漂移。ENV receipt 只有 hash，没有 JSON ENV 文件。

`--static` 切换前本机全部资产检查、切换后本机与公网全部资产检查均保留。每轮使用随机 nonce、no-cache/identity 请求，逐资源验证 status=200 和 SHA，跨 origin bounded concurrency **最多 8**，不抽样、不减少资源、不跳过失败。Nginx、主站 HTML、全部旧 API/worker bytes、既有静态 assets 保护仍严格。

失败仅在 HTML 仍是本轮 candidate 时还原本轮 HTML，**不恢复旧 API、不删除新资产/sidecar、不回旧迁移**；保存 `stopped` / observed 脱敏状态并保留 coordination active 防止其它发布覆盖，父级须审核部分活跃状态及启动路径后手动处置。重复阶段先检查 state；已完成相同阶段只验证返回，不重放，部分失败 STOP。成功 static 后可独立 `--rollback-html --authorize-production`，只回本轮 HTML，新 API/sidecar 保留。

## 4. 工具级离线测试（不是最终应用 QA）

```bash
node --test deploy/admin-round2/safety.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 deploy/admin-round2/test_publish.py
```

本次修正的新证据目录：`deploy/admin-round2/safety-evidence/`，包含两份真实 safety test 日志、当前工具 SHA 绑定 `verification.json` 与修正报告。旧 `/home/ubuntu/backend-optimization/round2/tool-evidence` 的旧工具 hashes 已过期，不得用其证明本版工具。父级必须在本版全部工具收口后重新 freeze/build，使最终 manifest 的 `toolArtifacts` 与 `freeze.toolFiles` 重新绑定；旧 manifest 或旧 QA approval 不可沿用。

测试使用显式 synthetic unit/runtime/package fixture + 只读捕获的静态/boot 元数据基线；临时目录 full publisher 生命周期使用真正 guard，但所有 PM2/HTTP/服务器路径都替换为 fixtures。它们不是 production QA，不执行真实 tsc/Vite/esbuild、React 最终 QA、PM2、HTTP、DB、DDL、生产 browser 或部署。synthetic 包有明确标签且 mutation 拒绝。父级最终 commit/freeze/build/QA/apply 与 DDL phase 仍待实际完成。真实环境若出现未知 dump 字段/启动契约漂移会 fail closed，必须审查，不能扩大忽略范围或自动回旧 API。
