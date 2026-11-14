# Phase1 纯静态发布交接

本次只实现新目录内 `static-release.py`、`prepare-static.py`、`test_static_release.py` 与本文。未运行真实 prepare/capture/apply/verify，未访问生产、SSH、浏览器、供应商、API/BFF、数据库；未做 Git 写操作。父负责产品 UI、静态 candidate 重建、真实 QA/review/typecheck/affected、文档/TODO、main commit 和经批准的上传/发布。

## 固定边界

TASK 为 `CKSZQ7sVc7tADM21c3LWpu`，OPS ROOT 为 `/opt/ops/20261114-navigation-reference-ui-CKSZQ7s`。唯一业务写目标是 `/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public` 下的 `index.html` 与四个直接位于 `assets/` 的新 SHA 命名资产（3 JS、1 CSS）；四个资产必须 additive，旧 114 资产逐个保持 SHA。其他写入仅限 OPS 回执/协调窗。无 API 激活步骤、PM2 reload、DB、browser、supplier 网络。

固定前 HTML SHA：`83500e995e5cdeebeba90b8cc59be93e8e45ff2dadd933e27fdb4671b154eb51`。
固定 admin API SHA：`0f2bc286a3a1d6643544cc5270c113214795de3531e66123164b296a857a8ad8`。
固定 front API SHA：`db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9`。
API 路径固定为 `/opt/releases/20261110-customer-workbench-b7f3a2a7e317/{admin,front}/dist/index.js`，仅读文件 SHA，不请求 API。

使用两个**已存在**的锁 inode：`/var/lock/dianzi51-public-deploy.lock`、`/var/lock/dianzi51-production-code.lock`。capture/apply/verify 都以只读打开文件并取非阻塞独占 flock，不创建锁文件。coord 的真实字段为 `shared_release_active/window/window_history`，窗内 `owner_task/openedAtUtc`，另绑定随机唯一 `attempt` 和外部固定 `manifestSha256`。所有 coordinator 替换前均做完整文件 SHA CAS，保留其他字段。

## 父需要提供的真实输入

默认 W 仍为 `/home/ubuntu/work/navigation-channel-reference-20261114`，candidate 为 `W/frontend-candidate`；旧 automatic 候选不得代用。

1. `source-pins.json` 使用实际 builder 格：`{sourceHashes:{repoRelative:sha256}, freeze:{pins:{intentionalFrontendPath:sha256}, ...}, sourceBase:...}`。它不是单纯文件数组。`sourceHashes` 全部必须对应当前 main commit Git blob，并与当前 frontend 工作文件一致。
2. prior 为 `W/baseline/previous-source-receipt.json` 的实际 `sourceHashes` 格，恰好100项，当前 HTML/API SHA 均吻合。snapshot 是 prior100 ∪ 新 frontend pins ∪ package.json/pnpm-lock.yaml/tsconfig.json，从**新 commit 的 Git blob**构建。prior-only backend 不比较实验中的未提交工作区文件，避免把未批准 backend 捎入；其新 commit blob SHA 必须等于旧 pin。只有 freeze 指明且在批准白名单中的前端 UI 文件能覆盖旧 pin：ChannelInventoryHost.tsx/css、channelInventoryColumns.ts、ChannelReferenceCell.tsx、channelReferenceModel.ts、AdminWorkspaceNavigation.tsx（模型不需要强制保留）。旧 source-snapshot 无需 fallback，因为 Git blob 是更强的来源，任何 fallback 都不应绕过这个匹配。
3. `frontend-proof.json` 保留已有真实 frontend 字节保护/navigation/noquote/HTML flags，新增父约定的 `phase:"ui-only"`、`referenceFetchDisabled:true`、`noNewReferenceTransport:true`、`typeOnlyDependencies:{}`。**不要求** live quote、供应商解析、shared/channelReference.ts、API activation 或 browser 证据。
4. `native-tests.json` 必须真实 9 PASS、0 failed，`zeroIO` network/database/nativeMutations 为0、browser/ssh 为false；其原始文件 SHA 要匹配 frontend proof 的 `actualCandidateQA.reportSha256`。
5. workbench 两份 `*-build-proof.json` 必须 `oldLivePropertiesByteUnchanged:true`、`readonlyScopeBridgeAdded:false`、`originalGlobalDelegateByteUnchanged:true`。prepare 从真实旧 JS/new JS 重新校验所有 interval、nonpatch 和逆向重建，不只信 flags。
6. `--review`、`--typecheck`、`--affected` 是父的真实 JSON 报告，不要求 review 重复完整验收。每份必须 `status:"PASS"`，并满足以下**源绑定二选一**：`sourcePinsSha256` 等于当前 candidate/source-pins.json 的原始文件 SHA；或 `sourceHashes` 为与当前 frontend sourceHashes 完全同键、同 SHA 的映射。若报告提供 `sourceCommit` 则必须等于 `--source-commit`。

   review 另需 `htmlSha256` 等于当前 candidate index.html SHA。typecheck 另需 `sourceSnapshotStable:true`。affected 另需真实 `passed > 0, failed:0` 整数，也接受 Vitest 的 `numPassedTests/numFailedTests`；若含 `numTotalTests`，必须等于 passed。仅有 PASS 而没有 hash 绑定或计数会 fail-closed；请在真实测试/检查运行时记录绑定，不要把旧自动报价报告包装成 PASS。

   最小结构（数值取真实结果）：

   ```json
   {"status":"PASS","sourcePinsSha256":"<raw source-pins file SHA>","htmlSha256":"<candidate HTML SHA>"}
   {"status":"PASS","sourcePinsSha256":"<raw source-pins file SHA>","sourceSnapshotStable":true}
   {"status":"PASS","sourcePinsSha256":"<raw source-pins file SHA>","passed":123,"failed":0}
   ```

7. `--baseline` 必须是新的 driver `--capture` 输出，不是上午 `live-baseline-current.json`。保留原真实 capture 字段：capturedAtUtc/beforeHtmlSha256/api/apiPaths/publicRoot/processes/baselineAssets/protectedFiles/...，新增 `coordSha256` 与 `homepage`。prepare 与 apply 的 baseline 允许年龄最多1800秒，未来容差30秒；过期或 coordination SHA 变动请重新 capture 并重新 prepare，不改 manifest 欺骗 CAS。

现有 evidence 必须具备：frontend-proof、native-tests、frontend-parts、host-factory-metafile、source-dependency-pins、html-build-proof、html-patches、css-selector-proof、dependency-resolution-proof、static-dependencies、两份 workbench-build-proof、layout-build-proof（均 `.json`）。源码图允许已有 customer-native 虚拟模块 guard，不把 guard 当作新增运行期 API；真实 graph input 禁止 server/shared quote runtime 类型。builder/native 工具作为 `tools/` 副本按包 SHA 绑定，**不要求这些文件或 evidence 已 Git committed**；产品 source pins 和配置 blob 则必须绑定当前 main commit。

## 精确命令

### 1. 离线测试（本次已运行）

```bash
cd /home/ubuntu/work/51dianzi-platform--manager
PYTHONDONTWRITEBYTECODE=1 python3 -B deploy/navigation-reference-ui-20261114/test_static_release.py
```

### 2. 生产只读 fresh capture（仅父按已有授权执行）

把此 driver 和旧 baseline contract 放到生产 OPS 或批准的运维目录，直接在生产运行；本工具本身不管理 SSH：

```bash
python3 /opt/ops/20261114-navigation-reference-ui-CKSZQ7s/static-release.py \
  --capture \
  --baseline-contract /path/to/copied-live-baseline-current.json \
  --output /path/to/fresh-baseline-ui.json
```

contract 可以用旧 `W/live-baseline-current.json`：其中114资产、protected、12 PID/envHash/script/cwd 是预期值。capture 在双锁内全部只读核对，不导出任何 env 值，要求原12全online以及管理员191/192完全匹配。返回生成的新 JSON 给本地 prepare。output 不允许 PUBLIC 目录或 coord 文件。

### 3. 父完成 main commit 后离线 prepare

main 和 HEAD 必须恰好等于 `<真实40位SOURCE_COMMIT>`；无需 origin/main 先等于它，也无需为 receipt 再循环 commit。不要将旧自动报价 backend/tooling 纳入本次 main source。

```bash
cd /home/ubuntu/work/51dianzi-platform--manager
python3 -B deploy/navigation-reference-ui-20261114/prepare-static.py \
  --candidate /home/ubuntu/work/navigation-channel-reference-20261114/frontend-candidate \
  --source-pins /home/ubuntu/work/navigation-channel-reference-20261114/frontend-candidate/source-pins.json \
  --baseline /path/to/returned/fresh-baseline-ui.json \
  --baseline-dir /home/ubuntu/work/navigation-channel-reference-20261114/baseline \
  --previous-receipt /home/ubuntu/work/navigation-channel-reference-20261114/baseline/previous-source-receipt.json \
  --source-commit <真实40位SOURCE_COMMIT> \
  --review /path/to/real-ui-review.json \
  --typecheck /home/ubuntu/work/navigation-channel-reference-20261114/ui-phase-typecheck.json \
  --affected /path/to/real-ui-affected-tests.json \
  --output /home/ubuntu/work/navigation-channel-reference-20261114/static-release-package-<unique-suffix>
```

output 必须是不存在的新目录、在 repo 之外且不在 `/opt`；archive 同名 `.tar.gz` 也不得存在。stdout 返回 `manifestSha256/archiveSha256/sourceCommit`；请把两个 SHA 留在父独立 evidence 中。candidate/输入发生任何变化，请使用新 output 重包。

### 4. 本地 plan（零生产读取、零生产写）

```bash
python3 -B deploy/navigation-reference-ui-20261114/static-release.py \
  --package /home/ubuntu/work/navigation-channel-reference-20261114/static-release-package-<unique-suffix> \
  --manifest-sha <prepare输出的MANIFEST_SHA>
```

### 5. 父核对 archive SHA、上传/解包至固定 OPS 后 apply

archive 路径以 package 根为相对根，包含 manifest、candidate、source snapshot、source pins、Git receipt、evidence、driver/prepare/tools；不会写入 PUBLIC。请先通过现有获批流程核对 SHA 和安全解包，不使用全功能 driver。

```bash
python3 /opt/ops/20261114-navigation-reference-ui-CKSZQ7s/static-release.py \
  --manifest-sha <prepare输出并独立固定的MANIFEST_SHA> --apply
```

apply 在双锁内再验整个 package 和 fresh CAS，先只加4资产且逐个 HTTP200/精确SHA/非HTML，最后 atomic 切 index；之后9条管理员 HTML routes、主站、114旧资产、protected、两API、原12全部PID/envHash/script/cwd核对。read-only PM2 命令只有 `pm2 jlist`，运行前要求 `/root/.pm2/pm2.pid` 与既有 rpc socket，并以 signal 0 只读检查 daemon 存在，CLI 固定 PM2_HOME 避免误起另一个 daemon。新 receipt 已在包内、整个 snapshot 对应 main commit；成功后保存 OPS `verified.json`，coord verified SHA 原子关闭，并绑定 source receipt SHA。两文件不是跨文件事务：若 receipt 成功但关闭窗失败，保守按 owned-window 条件恢复 HTML；不把半完成认作 verified。

### 6. 发布后独立只读 verify

```bash
python3 /opt/ops/20261114-navigation-reference-ui-CKSZQ7s/static-release.py \
  --manifest-sha <同一MANIFEST_SHA> --verify
```

verify 在双锁内检查包/sourcepins/receipt/final-state，并重验公开静态资源、routes、主站、全部文件与12进程。**没有 save、coord 修改、reload 或另需 API 激活**。coord 必须还是本 attempt verified 最终状态，外国窗口/新的 release 不能借本包验证。

## 回滚/并发行为

不提供可绕过窗口的独立 `--rollback`。apply 失败时，仅在当前窗同时符合 `owner_task + attempt + manifestSha256 + openedAtUtc` 且 live HTML SHA 精确等于 candidate HTML SHA、before HTML SHA 也精确吻合时恢复 beforeHTML。其他 task、同task另attempt、coord失去ownership或foreign HTML，都不恢复/关闭/覆盖外国状态。新增最终资产始终保留，不删旧/新资产。若 coordination 外来修改导致拒绝自动回滚，交由父人工分析，不自动重跑。

## 验证状态

本次 offline unittest 最终14项通过，Python AST语法检查通过；prepare 282行，driver 449行（不包含父 builder），没有另造全功能 prepare。已用真实本地 baseline/candidate 验证 HTML 补丁重建和 importmap（三条 direct relocation alias + 三条新 scope）通过。真实 production apply/capture 未执行。未宣称用户登录浏览器验收或自动报价能力已上线。
