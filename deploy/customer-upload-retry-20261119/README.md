# 客户上传修复：受控 release driver 接口

本目录仅交付 driver、合成离线测试与 binding 接口；**没有生成、修改或授权父任务的真实 manifest，没有执行发布**。任务 owner 固定为 `lRq82a3bSHrvLgTrLggfSY`。不得修改常量绕过范围，也不得删除 attempt 目录后重放。

## 1. 可执行接口

要求 Linux、Python 3.9+、Node.js、已有且运行中的 PM2，以及读取相关文件所需的权限。文件和目录以 `O_NOATIME` 读取，文件 `O_NOFOLLOW`，读取前后检查 metadata；不支持 `O_NOATIME` 或无权限时直接失败，不降级为会改 atime 的读取。生产须由正确的 PM2 owner 执行；不允许利用缺失 daemon 的 `pm2 jlist` 自动启动 PM2。

以下命令仅为接口示例，本轮没有执行：

```sh
python3 release.py preflight \
  --package /absolute/reviewed/package \
  --manifest-sha256 <manifest.json-full-bytes-sha256> \
  --review-sha256 <review.json-full-bytes-sha256> \
  --baseline-sha256 <baseline.json-full-bytes-sha256> \
  --coord-sha256 <latest-coordination-full-bytes-sha256>

# 仅在用户明确授权、父任务确认后台2 verified、独立审核通过后才能调用：
python3 release.py apply \
  --package /absolute/reviewed/package \
  --manifest-sha256 <same-pinned-manifest-sha256> \
  --review-sha256 <same-pinned-review-sha256> \
  --baseline-sha256 <same-pinned-baseline-sha256> \
  --coord-sha256 <same-pinned-coordination-sha256> \
  --allow-reviewed-apply

# 完成后使用原始四个 pins；verify 不要求旧 baseline 仍在 1800 秒时限内：
python3 release.py verify \
  --package /absolute/reviewed/package \
  --manifest-sha256 <same-pinned-manifest-sha256> \
  --review-sha256 <same-pinned-review-sha256> \
  --baseline-sha256 <same-pinned-baseline-sha256> \
  --coord-sha256 <same-pinned-coordination-sha256>
```

`preflight` 和 `verify` 只读取文件与进程快照、调用 Node syntax parser，输出 JSON 到 stdout；不打开发布锁，不创建 receipt/attempt，不写 package 或 live 文件。`--allow-reviewed-apply` 只允许用于 `apply`。`verify` 还要求本 task 的成功 receipt 与当前 closed window 的 owner/nonce/manifest 完整绑定；有新窗口接管后不会错误宣称旧窗口仍当前有效。

返回码 `0` 仅表示 `preflight-passed` 或 `verified`；成功恢复的 `rolled-back` 仍返回 `1`，`recovery-required` 和入口校验失败同样返回 `1`。入口异常只输出 `failed-closed/detailsSuppressed`，不输出 stderr、环境变量或生产内容。

## 2. Package 与 manifest schema

所有 `source`、`beforeSource` 是 package 内相对路径；不接受绝对路径、`..`、符号链接。所有 SHA 是完整文件字节的 SHA-256、小写 64 hex；JSON 的空白变化也改变 pin。`manifest.json` 和 `review.json` 文件名固定；另外两个证据文件通过 descriptor 指定。机器可读逻辑 bundle schema 见 `binding.schema.json`；实际仍是四个独立 JSON 文件，不要求创建 bundle 文件。

```json
{
  "schemaVersion": 1,
  "ownerTask": "lRq82a3bSHrvLgTrLggfSY",
  "scope": "customer-upload-retry-20261119",
  "driverSha256": "<release.py-sha256>",
  "baseline": {"source": "baseline.json", "sha256": "<baseline-sha256>"},
  "backend2Verified": {
    "source": "backend2-verified.json",
    "sha256": "<backend2-verified-proof-sha256>",
    "ownerTask": "<actual-backend2-task>"
  },
  "replace": [
    {
      "kind": "front-api",
      "target": "/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js",
      "beforeSource": "baseline/front-index.js",
      "beforeSha256": "<latest-front-before-sha256>",
      "source": "candidate/front-index.js",
      "sha256": "<front-after-sha256>"
    },
    {
      "kind": "admin-html",
      "target": "<baseline.adminPublic>/index.html",
      "beforeSource": "baseline/admin-index.html",
      "beforeSha256": "<latest-admin-html-before-sha256>",
      "source": "candidate/admin-index.html",
      "sha256": "<admin-html-after-sha256>"
    }
  ],
  "frontEdits": [
    {
      "kind": "check-zip-flag", "start": 0, "end": 1,
      "beforeSha256": "<old-node-utf8-bytes-sha256>",
      "source": "candidate/check-zip-flag.fragment", "sha256": "<new-node-sha256>"
    },
    {
      "kind": "appendFile-guard", "start": 2, "end": 3,
      "beforeSha256": "<old-node-utf8-bytes-sha256>",
      "source": "candidate/appendFile-guard.fragment", "sha256": "<new-node-sha256>"
    }
  ],
  "add": [
    {
      "relative": "assets/BusinessWorkbenchPage-upload-retry-<sha256-first16>.js",
      "oldURL": "/assets/BusinessWorkbenchPage-<real-old-first>.js",
      "source": "candidate/first.js", "sha256": "<first-full-sha256>"
    },
    {
      "relative": "assets/BusinessWorkbenchPage-upload-retry-<sha256-first16>.js",
      "oldURL": "/assets/BusinessWorkbenchPage-<real-old-second>.js",
      "source": "candidate/second.js", "sha256": "<second-full-sha256>"
    }
  ],
  "reloadPmIds": ["<capture-int-1>", "<capture-int-2>", "<capture-int-3>", "<capture-int-4>"]
}
```

上例含占位符，不能直接执行：`start/end` 必须换成真实 **UTF-8 字节 offset**，不是 UTF-16 code unit，也不是行号；`reloadPmIds` 必须换成真实整数。`frontEdits` 按两个完整 owner 的 UTF-8 字节区间绑定，分别标记 `check-zip-flag` 与 `appendFile-guard`。本 driver 要求两个不重叠、非空旧区间，旧片段 SHA 匹配，按两个新片段重建后与 front candidate 全字节相等；两个区间外的所有 front 字节必须完全保留。完整 owner 区间内部的非目标源码语义保持证据由父任务 `api-proof` 与独立 AST/源码审核提供；driver 不假装以标签或字节区间验证替代语义审核。

`add` 必须恰好两个不同新文件、两个不同旧 BusinessWorkbenchPage URL。新文件名必须匹配 `assets/BusinessWorkbenchPage-[A-Za-z0-9_-]*<sha256-first16>.js`，目标预先存在即拒绝，即便内容相同也不复用。旧文件不覆盖、不删除。front JS 与两个新 JS 都使用 `node --input-type=module --check` 从 stdin 做静态语法检查；不 import/执行任何生产 bundle。

admin HTML 仅允许在唯一 `type="importmap"` 的 `imports` 或原有 `scopes` table 内，把恰好这两种旧 URL 的字符串 **value** 替换为对应新 URL；同一旧 URL 的全部 value 出现位置一起切换。保留所有旧 key、旧 scope key、格式、标签与 HTML 外部字节。仅另允许在 `scopes` 对象末尾按 `add` 顺序插入恰好两个 compact JSON exact-scope clone：各旧 URL 必须已有一个恰好 44 项且全部为字符串 value 的 scope，以对应新 URL 为 key，完整复制 values-only 替换后的该旧 table。禁止第三 scope、修改 clone/旧 table 的其他依赖、缺少 clone、其他格式或结构变更；候选必须与 driver 重建结果全字节相等，与 native build 的 `finishHTML` 输出一致。

## 3. 最新 baseline schema

```json
{
  "capturedAtUnix": 0,
  "coordSha256": "<latest-raw-coord-sha256>",
  "adminPublic": "<actual-resolved-absolute-admin-PUBLIC>",
  "frontPublic": "<actual-resolved-absolute-front-PUBLIC>",
  "files": {"<absolute-protected-file>": "<sha256>"},
  "assets": {"assets/<all-old-files-including-nested>": "<sha256>"},
  "processes": [
    {
      "id": 0, "pid": 1, "name": "<actual-name>", "status": "online",
      "script": "<actual-pm_exec_path>", "cwd": "<actual-pm_cwd>",
      "rawEnvSha": "<sha256-of-/proc/PID/environ-raw-bytes>",
      "configuredEnvSha": "<sha256-of-release.encode(pm2_env.env-or-empty-object)>"
    }
  ]
}
```

`capturedAtUnix` 为真实 Unix epoch 秒；preflight/apply 在检查时必须不晚于当前时间且不超过 1800 秒。apply 在持有双锁后再次检查 fresh capture、协调 SHA、全部 before hashes 和全部进程完整快照；任何 drift 都先停止，不自动 recapture、不改父 manifest、不自动更换 SHA。

`adminPublic` 必须由父任务从真实 baseline 的解析路径传入，在 `/opt/releases` 下，整个路径无符号链接，不与 front/dist 子树重叠。driver 不猜 admin release 名、不假定 `/admin/dist/public` 后缀，不访问 admin PUBLIC symlink 别名。

`frontPublic` 同样是必需的真实解析后绝对目录，在 `/opt/releases` 下且与 `adminPublic` 不重叠。后台2主站 HTML 固定保护项为 `<baseline.frontPublic>/index.html` 的 realpath，不再假定旧 `front/dist/public/index.html` 别名是普通目录；旧 alias 若为 symlink，driver 不读取它，也不允许把 alias 当作 `frontPublic`。真实 HTML 完整 hash 必须同时列入 `files` 并绑定后台2 verified 证明。

`processes` 必须恰好 12 个唯一 id，四个 `name=dianzi51` 且 script 精确等于固定 front API；它们的 id 集合必须恰好等于 `reloadPmIds`。其他八个完全按 baseline 快照保护。reload 后仅这四个 pid 允许改变；id/name/status/script/cwd、configured env hash 和 `/proc` env hash 仍必须相同。禁止原始 env 写入任何 binding/receipt；`configuredEnvSha` 的算法要与本 driver 的 `encode()` 完全一致（sorted keys、ensure_ascii=False、indent=2、尾换行），不能混用另一种 JSON canonicalization。

`files` 必须包含两个 replace 的 before hashes、**所有旧 admin assets**（不只是两个 Workbench）、全部 12 进程的 executable/worker 文件，及以下最低必需保护项：

- `<baseline.frontPublic>/index.html`（后台2真实主站 HTML，不是旧 symlink alias）。
- `/root/.pm2/dump.pm2`、`/etc/nginx/nginx.conf`。
- `/opt/config/dianzi51/runtime.env`、`/opt/config/dianzi51-admin/runtime.env`。
- baseline 中 `dianzi51-admin` 真实 script 路径；admin API 完全不写。

父任务必须把真实 capture 中其他 nginx include、env 文件、worker 依赖等保护项一并列入 `files`；所有列入项都强制检查。`assets` 必须完整递归枚举真实 admin PUBLIC/assets 下所有普通文件，包括 CSS/嵌套资产；driver 比较全量 inventory，漏列、旧文件修改、外来新增或 symlink 都失败。不备份 env/nginx/dump/worker 原始内容；只保留其 hash。

## 4. 后台2 verified 与独立 review

`backend2Verified.source` 对应一个无 secret 的、由父任务审核的最新 verified 证明/摘要：

```json
{
  "status": "verified",
  "ownerTask": "<actual-backend2-task>",
  "frontHtmlSha256": "<baseline-files-current-front-main-html-sha256>"
}
```

其 SHA 同时固定在 manifest 与 independent review，owner 必须等于 descriptor.ownerTask 且不是本 task；frontHtmlSha256 必须与 baseline 主站 HTML 完整 hash 一致。父任务不能在后台2 pending/未 verified 时加 apply 授权旗标。

`review.json` schema：

```json
{
  "status": "passed", "independent": true,
  "reviewerTask": "<real-independent-reviewer-task-not-this-owner>",
  "manifestSha256": "<manifest-full-bytes-sha256>",
  "driverSha256": "<release.py-sha256>",
  "baselineSha256": "<latest-baseline-full-bytes-sha256>",
  "backend2VerifiedSha256": "<verified-proof-full-bytes-sha256>",
  "frontNodesVerified": ["check-zip-flag", "appendFile-guard"]
}
```

顺序：先冻结 driver 与 candidates → 后台2 verified → fresh baseline/coord/process env capture → 写最终 manifest → 独立审核全部绑定及两节点 AST 语义 → 固定 review SHA → 只读 preflight → 用户授权后 single apply。时限超出或任何变化必须停下重新绑定/审核，不重放已创建 attempt 的本 task。

## 5. apply 状态机与失败恢复

只有 apply 使用固定两把已有锁（顺序不变、exclusive/nonblocking，不创建锁文件）：

```
/var/lock/dianzi51-public-deploy.lock
/var/lock/dianzi51-production-code.lock
```

固定协调文件 `/opt/ops/51-project-release-coordination-20261027.json` 使用原始全字节比较，并在 rename 前再次 CAS。拒绝重复 JSON 字段以防静默丢字段。保留未知 top-level 字段；旧 window 原样放入 window_history，不把旧 owner 的 window 冒充本 window。仅 `shared_release_active=false` 才以本 owner、新 UUID nonce、manifest SHA 新 claim。

固定一次性目录：`/opt/ops/customer-upload-retry-20261119-lRq82a3bSHrvLgTrLggfSY`。目录独占创建；一旦存在，无论成功失败都禁止此 task replay。保存 manifest/review/baseline/后台2证明原始字节、coord before/claim 原始字节，以及两个本 scope 文件的 before 和候选；不复制保护文件的秘密内容。

切换顺序：新加两个 assets → 精确 front before/after CAS → 四个指定 pm_id 逐个 `pm2 reload <id>` → admin importmap value-only HTML CAS → 全 hash/全 inventory/全进程环境与保护验证。每个 reload 前后再次检查 window ownership、全部保护文件与其他八进程。无 `--update-env`、无 `pm2 save`，无环境/nginx/DB/SQL/DDL/worker 或其他进程写操作。

成功验证后才以本 window 全字节 CAS 写 `status=closed,outcome=verified,shared_release_active=false`。如果切换失败，在仍拥有完全相同协调 token 时，逐个仅以 **当前内容完整等于本 candidate** 的 hash/bytes 执行自身 backup CAS 恢复；已经是 baseline 不再写，外来内容不覆盖。旧资产及已新增资产都保留，绝不删除或覆盖其他发布的文件。

自身文件精确恢复、所有保护项吻合、必要时四 pm_id 回滚滚动成功、健康确认后，才写 `closed/outcome=rolled-back/shared_release_active=false`。否则 receipt 为 `recovery-required`；若仍持有 window，只把该 window CAS 标为 `recovery-required`、保持 shared=true；ownership lost 时不写协调或 live 文件、不 reload、不借机关闭外来 window。OS flock 在进程结束时释放，但**协调 shared=true 不清除**，必须人工受控恢复，不能删目录重放。

本 driver 的无网络健康确认是：12 进程 online/PID>0、四 front 身份与 env hashes 稳定、八其他进程完整快照未变、全部保护文件与资产 hash/内容吻合。它不访问 HTTP、用户数据或 DB，不把 PM2 online 冒称为业务端到端测试；父任务的独立审核应另外评估已有离线功能/服务证明。本轮没有生产健康结论。

## 6. 离线测试

```sh
python3 -m unittest discover -s deploy/customer-upload-retry-20261119 -p test_release.py -v
python3 -m py_compile deploy/customer-upload-retry-20261119/release.py deploy/customer-upload-retry-20261119/test_release.py
python3 deploy/customer-upload-retry-20261119/release.py --help
```

测试仅在系统临时目录搭建合成 production-like tree，patch 本 module 常量，不触碰父 manifest；所有 PM2/Node subprocess 都 mock，且断言 PM2 只允许 manifest 指定的四个精确 id 的 reload。覆盖成功/只读/CAS 字节漂移及最后时刻 race/双锁 busy/foreign owner/后台2 gate/最新 baseline/env hash/独立 pins/单 front 和目标角色绑定/HTML key 与外部字节保护/全部旧资产/唯一 hash 命名/one apply/精准 own-hash 回滚/外来文件保持/ownership lost/恢复 reload 失败与不健康 shared=true/metadata 与 O_NOATIME/secret 仅 hash。

完整输出见 `tests-result.txt`；测试中的 `verified`、`rolled-back` 等均为 **mock 结果，不是生产 receipt**。

收据保护：成功或精确回滚后必须先保存、fsync、回读收据，再关闭共享窗口。收据写入、文件/目录同步或回读失败时，即使原代码已健康恢复，也保留 shared_release_active=true/recovery-required，禁止自动重放。当前纯内存发布测试66项全部通过。

协调目录持续fsync失败的补偿：在文件写入/文件fsync/原子rename仍可用时，先以完整自有字节CAS恢复可见shared=true，再报告coordReopenDurabilityUnconfirmed并保留recovery-required。绝不覆盖外来协调字节；不声称故障文件系统下的断电持久化保证，需人工恢复存储。当前69项离线测试通过。
