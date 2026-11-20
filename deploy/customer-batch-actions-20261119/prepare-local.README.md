# 客户批次：仅本地准备器（R3，NOT_APPROVED）

`prepare-local.py` 只把**已交接到本地的 fresh capture 与当前 baseline**交给现有两个限定构建器，收集可复审的真实来源/编译/逆向证据，生成 `release.py seal_candidate` 的公开 candidate spec。默认不封印，不审核，不批准，不部署。

本轮 preparer 的唯一源码 AST 差量为固定 `CONTROLLER_SHA` 更新；其它 AST 不变。当前固定 SHA 为：

```text
ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5
```

仅接受 **`customer-batch-actions-20261120-6Lfttf6o-R3`**、完整 OWNER `6Lfttf6oVWJ8YS69o5FkXQ`、当前 controller SHA 与完整 Config 的当次 fresh capture。R2 scope/d6 capture、历史旧 scope/7fc capture、丢失 JSON 均不可重用。Config 原路径保持，仅追加准确 `/var/lib/dianzi51-private` 保护根；preparer 的对象-only union 检查不能漏掉新根。R3 process rows 新增 `pm2RawMeta` 和 `pm2ReloadReady`，由当前 controller 的严格 schema/identity 验证；不从布尔 ready 或 mock 通过制造发布批准。

R2 已由独立审确认不能上线，R3 仍 **NOT_APPROVED**。本轮只执行本地隔离测试、内存编译与 AST/SHA 核对；不修改/执行 JS builder、业务或 UI，不运行本脚本的真实 prepare，不用 Git/SSH/MCP，不访问生产，不执行 capture/preflight/apply/verify/rollback CLI。控制器 R3 的源码限定转换、source/loader pins 与剩余证据阻碍详见 `README.md`、`evidence/r3-controller.diff` 和 `evidence/r3-report.md`。

## 输入和路径约束

输入必须已经位于 `/home/ubuntu/work/customer-batch` 下，且路径绝对、规范、无 symlink；文件为单链接普通文件。`--base` 目录需要：

```text
capture.json
admin-index.html
front-api.js
admin-api.js
assets/BusinessWorkbenchPage-upload-manage-<当前hash一>.js
assets/BusinessWorkbenchPage-upload-manage-<当前hash二>.js
```

仅复制后台 HTML 当前实际引用的两份 JS，不复制全 dist、不接受历史 upload-history 模块。脚本检查 capture 固定 OWNER/SCOPE/controller/config、时间与 TTL=900、完整协调对象已关闭且 scope 不重放、保护 union、12 槽 identity、metadata digest，以及 HTML/两 API/两 baseline JS 的 capture SHA/size/nlink 与 immutable 文件名。生产路径仅用于比对 JSON 对象；`Config.front`、生产 alias resolve、inventory 和任何生产适配器均不调用。

`--owner-nonce-file` 是 WORK 下当前用户所有的 `0600` UTF-8 文件，存放主任务提供的 raw owner nonce（16–4096 字符，可带末尾换行）。不是 capture nonce；不在命令行直接传 secret，不在终端输出 nonce/capture 正文。

## 默认只准备，不封印

下列是**当次完整证据齐备且另获授权后**的示例，本轮没有执行：

```bash
cd /home/ubuntu/51-manager/deploy/customer-batch-actions-20261119
PYTHONDONTWRITEBYTECODE=1 python3 -B prepare-local.py \
  --base /home/ubuntu/work/customer-batch/handoff-current-r3 \
  --owner-nonce-file /home/ubuntu/work/customer-batch/owner-nonce-current-r3.txt \
  --out /home/ubuntu/work/customer-batch/backend-prepare-current-r3-001
```

输出必须为 WORK 的**全新直接子目录**，名字匹配 `backend-prepare-[A-Za-z0-9][A-Za-z0-9_-]{0,79}`；没有 `/opt/ops` override、任意 repo/node/mock 参数或输出泛化。WORK 根目录应已存在。

新目录为 `0700`，文件为 `0600`，使用 `umask 077` 与 exclusive 写入。已存在文件、目录、symlink、半失败输出一律拒绝；不删除、覆写、恢复、续跑或重放。失败保留私有取证输出，需新输出名和重新核对的 fresh 输入。构建超过 capture TTL 时拒绝 spec/封印；发布 freshness 由控制器另行检查。

脚本既有本地顺序不变：读取 builders 声明的 source inventories；留存原 source/tools/controller/preparer 快照；运行现有 native source-ABI 与 backend 原 source 编译 hash 检查；使用现有 backend freeze/build 和 UI customer-only 增量构建；再核对原/frozen/source/compiled hashes、UI 七叶与内嵌第八叶、native identity/逆向字节及 tool provenance；最后生成待审 spec。它不使用 JS eval 猜 source、不运行 API 入口或生产数据库。

准备器既有本地构建子进程使用固定清洁 PATH/locale/no-pycache 与 UI 两路径环境，不继承应用秘密/`NODE_OPTIONS`/`ESBUILD_BINARY_PATH`/`PYTHONPATH`。此既有 preparer 行为与 R3 生产 controller 的 loader **只读拒绝，不 unset/env replacement**规则不同；本轮未更改任一既有 subprocess 环境协议。

## 输出与证据映射

```text
backend-prepare-.../
  baseline/
  backend-freeze.json
  backend-freeze-inputs/source/
  backend-candidate/
  ui/package/
  evidence/source/
  evidence/source-provenance.json
  evidence/local-preparation.json
  evidence/*.command.json
  evidence/*.stdout.txt
  evidence/*.stderr.txt
  candidate-spec.json
  prepare-result.json
```

spec 顶层严格为 `schema ownerTask ownerNonce capture ui backend sources evidence`；backend 严格为 front/admin，各含 before/after/records。所有路径在当次新输出目录内。`sources` 使用真实 repo 相对名称并指向原始快照或 backend freeze 副本；source provenance 核对原路径、frozen/source SHA 与来源。`evidence` 包含两旧 JS 完整 baseline、freeze、Node/native VM/build records、实际 compiled JS/maps、前后原 source 编译 hash 日志及零生产/noReplay 标志。

没有 reviewer 时只是待审输入：不满足 seal reviewer evidence，没有 manifest、approval、review.json 或生产 receipt。准备器本地 noReplay 不代替控制器 durable attempt/noReplay；脚本不会检查或触碰生产 receipt。

## 外部真实 reviewer 与可选 --seal

`--reviewer-report` 必须为已存在、真正独立生成的报告，并同时给 `--reviewer-sha256`。脚本只核对非空普通文件、路径和显式 SHA，再逐字节复制；不会生成报告或伪称审核真实性，`externalReviewerAuthenticityVerified=false` 明示边界。必须覆盖当次 R3 current source/native inputs/diff，不能挪用旧 R2/种子报告。

仅提供报告仍不封印。显式 `--seal` 才允许当次新输出中的唯一 release 操作：

```text
python3 -B release.py candidate --controller-sha256 <当前固定R3 SHA> \
  --spec <新输出>/candidate-spec.json --out <新输出>/sealed-candidate
```

没有真实外部报告/准确 SHA，构建前即拒绝 `--seal`。失败不降级、不强制批准、不覆写已有输出。候选成功封印也只返回 `candidate-sealed-not-approved`；正式 hash-bound 独立 review/approval 必须在后续独立流程形成。本脚本不生成批准，不执行 capture/preflight/apply/verify/rollback。

## 本轮隔离复核

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -B test_prepare_local.py -v
```

原 30 项测试方法保留，新增 R2 scope/d6 pin 拒绝和 R3 private union 漏根拒绝，共 **32/32** 通过。所有 capture/baseline/source/nonce/reviewer fixture 位于 TemporaryDirectory，build/candidate subprocess 完全 mock；真实 pure helper 仍拒绝合成空 native records。这不是实际构建、真实 RPC 或发布证明。完整日志 `evidence/r3-prepare-tests.txt`；controller **89/89** mock 反例日志 `evidence/r3-release-tests.txt`。内存编译及精确 AST 证据在 `evidence/r3-static-checks.json` 和 `evidence/r3-ast-diff.json`，无 pycache。

尚缺实际 R3 fresh capture/private tree fullMETA/前台保护集合绑定、retained raw/model 完整 forecast 与 clone 语义证据、真实新 package/manifest/source/tool pins、完整正逆字节和独立差量审。**controllerApproved=false；finalDeployApproval=false；NOT_APPROVED。** 私有输出含真实 capture/nonce 时不可进入 Git，不 commit/push、上传或分享这些资料。
