# 客户批次：仅本地准备器

`prepare-local.py` 只把**已交接到本地的 fresh capture 与当前 baseline**交给现有两个限定构建器，收集可复审的真实来源/编译/逆向证据，生成 `release.py seal_candidate` 的公开 candidate spec。默认不封印，不审核，不批准，不部署。

本次只新增 `prepare-local.py`、`test_prepare_local.py` 和本说明。没有修改现有 release/JS/tools/业务代码，没有 Git commit/push、SSH、MCP、生产访问、锁操作或 capture。现有控制器 SHA 固定为：

```text
7fc9ec42ce21f6d0167b36ffbbe7642865a16f70fc31f8b99bf0da4862598423
```

## 先决条件：前台交接与当前输入

前台任务 `qp4e5jVmsAp0UHKwymyD5X` 独占恢复与发布。主任务必须先取得其真实最终 verified/closed 证明和明确交接，再在另行授权的流程中取得全新 capture 与当前基线；本脚本不获取这些资料，也不替调用者核实交接授权的真伪。后台源码已保存/push `ac8ae98` 不代表已交接或已批准上线。

**当前尚无交接，真实当前 API/native baseline 仍缺失。本次没有运行整条真实构建、真实 candidate 或真实封印；不能把单测当作该结论。**

输入必须已经位于 `/home/ubuntu/work/customer-batch` 下，且路径绝对、规范、无 symlink；文件为单链接普通文件。`--base` 目录需要以下文件：

```text
capture.json
admin-index.html
front-api.js
admin-api.js
assets/BusinessWorkbenchPage-upload-manage-<当前hash一>.js
assets/BusinessWorkbenchPage-upload-manage-<当前hash二>.js
```

仅复制后台 HTML 当前实际引用的两份 JS，不复制全 dist、不接受历史 upload-history 模块。脚本检查 capture 固定 OWNER/SCOPE/controller/config、时间与 TTL=900、完整协调对象已关闭且 scope 不重放、保护 union、12 槽 identity、metadata digest，以及 HTML/两 API/两 baseline JS 的 capture SHA/size/nlink 与 immutable 文件名。这里的生产路径仅用于比对 JSON 对象；`Config.front`、生产 alias resolve、inventory 和任何生产适配器都不会调用。

`--owner-nonce-file` 是 WORK 下当前用户所有的 `0600` UTF-8 文件，存放主任务提供的 raw owner nonce（16–4096 字符，可带末尾换行）。它不是 capture nonce；不在命令行直接传 secret，也不在终端输出 nonce/capture 正文。

## 默认：只准备，不封印

以下是**交接和输入齐备后**的示例，路径中的名称应替换成当次实际目录。此说明没有执行该命令。

```bash
cd /home/ubuntu/51-manager/deploy/customer-batch-actions-20261119
PYTHONDONTWRITEBYTECODE=1 python3 -B prepare-local.py \
  --base /home/ubuntu/work/customer-batch/handoff-current \
  --owner-nonce-file /home/ubuntu/work/customer-batch/owner-nonce-current.txt \
  --out /home/ubuntu/work/customer-batch/backend-prepare-current-001
```

输出必须是 WORK 的**全新直接子目录**，名字匹配 `backend-prepare-[A-Za-z0-9][A-Za-z0-9_-]{0,79}`。这一较窄命名同时满足 `backend-builder.cjs` 的 WORK/backend- 写路径要求；没有 `/opt/ops` override、任意 repo/node/mock 参数或输出泛化。WORK 根目录应已存在。

所有新输出目录为 `0700`，文件为 `0600`，使用 `umask 077` 与 exclusive 写入。已存在的文件、目录、symlink、半失败输出一律拒绝；不会删除、覆写、恢复、续跑或重放。失败保留私有取证输出，需新输出名和重新核对的 fresh 输入，而不是重跑旧目录。构建超过 capture TTL 时同样拒绝生成 spec/封印；后续发布 freshness 仍由控制器独立检查。

本地顺序如下：

1. 从当前 `backend-builder.cjs FILES` 与 UI 构建器声明源清单取得真实源文件；不执行 JS `eval` 或凭空造 source evidence。
2. 留存原始 UI/CSS 和 builder/support/controller/preparer 源码快照，记录前后源码 hash。
3. 运行现有 `build-native.mjs --verify-sources`，以及使用与后端 `compile` 完全相同 esbuild transform 选项的**原始源码**编译 hash 检查。
4. 使用现有 `backend-builder.cjs freeze/build`。freeze、freeze-inputs、backend-candidate 都在新的 WORK/backend-prepare-* 内；build 自带 Node syntax check 与隔离 native VM tests，不运行捕获的 API 入口或生产数据库。
5. 使用 `CUSTOMER_BATCH_BASE=<输出>/baseline`、`CUSTOMER_BATCH_OUT=<输出>/ui` 运行现有 `build-native.mjs`，仅构建 customer 叶增量与 scoped CSS。
6. 再次检查原始源码编译 hash，与 UI 七叶 evidence、后端 frozen compiled-source 及 API patch compiled hash 逐一绑定；核对源 hash/冻结来源和 builder/core/test SHA，调用现有纯字节 `native_api` 与 `ui_inverse` 校验 helper。任何漂移拒绝。
7. 生成 `candidate-spec.json` 与 `prepare-result.json`，终端只返回状态/路径/no-production 标志。

子进程不继承应用环境、`NODE_OPTIONS`、`ESBUILD_BINARY_PATH` 或 `PYTHONPATH`；保留的环境仅为固定本地 PATH/locale/no-pycache 和 UI 构建器所需两项路径。

## 输出与来源映射

主要结构如下：

```text
backend-prepare-.../
  baseline/                      # 本地 capture、HTML、两 API、两 baseline JS
  backend-freeze.json
  backend-freeze-inputs/source/   # backend FILES 的真实 freeze 副本
  backend-candidate/             # 两限定 candidate、patch records、compiled-source/maps、VM/build evidence
  ui/package/                    # 两 customer JS、scoped CSS、前后 HTML、ABI/delta/source evidence
  evidence/source/               # 原始 UI/CSS 与 builders/support/controller/preparer 的真实快照
  evidence/source-provenance.json
  evidence/local-preparation.json
  evidence/*.command.json        # argv / returncode，无环境值导出
  evidence/*.stdout.txt
  evidence/*.stderr.txt
  candidate-spec.json
  prepare-result.json
```

spec 顶层严格为 `schema ownerTask ownerNonce capture ui backend sources evidence`；backend 严格为 front/admin，各含 before/after/records。路径均在当次新输出目录内。

`sources` 使用真实 repo 相对名称：后端指向本次 `backend-freeze-inputs/source/<FILES>`，UI/CSS/support/builder/controller/preparer 指向前构建源码快照，并核对它们仍与当前原 source 一致。source provenance 记录原路径、冻结/快照路径、SHA 与来源。UI `source-files.json sourceHashes` 全集、七叶 `sources.json` 的源 hash、builder SHA 与后端冻结清单均与 spec 来源相绑；不使用空 evidence 或假 source mapping。

spec 的 `evidence` 明确包含两份 `evidence/baseline/assets/<原同名JS>`、freeze、Node/native VM/build records、后端实际编译 JS/maps、原始编译 hash 检查日志和 no-production/no-replay 标志。UI package 自带 html/ABI/delta/source-files/sources evidence。`release.py candidate` 封装时将 `sources` 实际字节放入 `evidence/source/`，无需修改 release.py。

没有 reviewer 时 spec 仅为**待审核输入**，不满足封印所需 reviewer evidence，也没有 manifest、approval、review.json 或生产 receipt。`noReplay` 是准备输出不能复用的本地保证；没有检查或触碰生产 receipt，不代替控制器的 durable-attempt no-replay 协议。

## 外部真实 reviewer 报告与可选 `--seal`

可通过 `--reviewer-report` 输入**已存在、真正独立生成的技术报告**，必须同时提供 `--reviewer-sha256`。脚本只检查非空普通文件、路径与显式 SHA，并逐字节复制；不会生成 reviewer 报告，也不会把 hash 匹配伪称为独立性/内容审核。`externalReviewerAuthenticityVerified=false` 明示该边界。调用者必须保证报告真实独立、覆盖当次当前 source/native inputs/diff，不得挪用旧报告。

仅提供报告仍然不封印。显式加 `--seal` 才允许调用：

```text
python3 -B release.py candidate --controller-sha256 <固定当前SHA> \
  --spec <新输出>/candidate-spec.json --out <新输出>/sealed-candidate
```

这是唯一允许的 release operation。无真实外部报告/明确 SHA 则**构建前即拒绝** `--seal`；封印目标必为当次新输出内的全新目录。配置比对和 protection union 使用只读对象，不访问本地不存在的生产 alias。最终完整 manifest/payload 校验交给未修改的 `release.py seal_candidate`；失败不降级、不强制批准，也不覆写已有输出。

**技术报告不等于控制器正式 hash-bound 独立 review/approval。** 即便候选已封印，返回仍为 `candidate-sealed-not-approved`。正式 reviewerScope、reviewerHash 与最终 manifest/capture/packageFiles bindings 必须在独立后续流程中形成，本脚本不生成这些批准对象、不自动 review/approval，也不执行 capture/preflight/apply/verify/rollback。将来任何发布仍属于前台交接后另行授权的主任务流程。

## 本次离线测试

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -B test_prepare_local.py -v
```

27 项隔离测试通过。全部 capture/baseline/源码 fixture 位于 `TemporaryDirectory`，构建与 candidate 子进程是显式 mock，测试中的 reviewer 文件也只是 temp 合成 fixture，绝非真实报告。覆盖参数拒绝、输入与输出路径界限、source/freeze/builder/编译 hash 绑定和漂移拒绝、spec/baseline evidence 路径、权限、fresh/closed capture 检查、缺报告拒绝封印、报告不隐式封印、仅 candidate 命令白名单、半失败/已有输出 noReplay，以及不解析生产 alias。另用真实纯校验 helper 确认合成空 native records 会拒绝；完整 mock 成功案例不冒充真实 native ABI 验证。

未重跑既有 43 项 release 控制器安全测试，也未重新审核控制器。运行脚本 `--help` 与 Python 内存 `compile()` 通过；未产生 pycache。真实 fresh capture、当前 HTML/两 API/两 JS、owner nonce、交接证明与当次独立报告仍须由授权主任务补齐。

**私有输出含真实 capture/nonce 时绝不进入 Git，也不 commit/push、上传或分享这些资料。**
