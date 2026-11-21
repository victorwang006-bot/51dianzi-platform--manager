# admin-polish 安全发布协议（仅准备，未执行）

本目录的 `release-remote.py` 是供另行授权的远端发布会话使用的脚本。本次准备工作没有执行 SSH、生产命令、PM2、远端 Node、业务接口验证或 Git，也没有修改现网文件。只交付本脚本与本协议；不创建或调用 SSH 上层工具。

固定 scope：`admin-polish-20261121-2257`。固定 owner：`ebvPYDkJVIW0yJK27DsOEU`。协调文件与两把锁沿用旧发布脚本。

## 1. 输入：SFTP 完成后再执行，不读 stdin

远端调用形态为 `python3 <已核验的远端脚本绝对路径> /opt/ops/.admin-polish-input-<nonce>.json`。必须只有一个参数。`nonce` 是 32 位小写十六进制，与 manifest 中完全相同。

输入必须已由上层通过 SFTP 完整 staged，位于绝对路径 `/opt/ops/.admin-polish-input-<nonce>.json`，root:root、精确 `0600`、普通文件、单硬链接，不允许任何路径组件为 symlink，不允许别名或 `..`。脚本使用 `O_NOFOLLOW | O_NOATIME`，对读取前后的完整 metadata 与路径 inode 作一致性检查。输入大小上限 256 MiB，拒绝重复 JSON key。脚本不会等 stdin EOF、不会自己连接 SSH，也不删除输入文件。

上层应在开始远端执行之前完成 SFTP 关闭、权限/归属设置和完整 SHA 校验。不要直接在公开目录上传未完成脚本、HTML、JS、CSS 或 runtime。输入和脚本应保持私有；不得将凭据、会话 cookie 或鉴权 token 放入 payload。

## 2. Payload 契约

延续旧脚本的 base64 `targets/assets` 与 manifest 结构，新增单独 `runtimes`。顶层字段**必须恰好**为：

```text
manifest: {
  scope: "admin-polish-20261121-2257",
  owner: "ebvPYDkJVIW0yJK27DsOEU",
  nonce: <32hex，与输入文件名一致>,
  coordBeforeSHA: <本次 fresh coordination 原始 bytes 的完整 64hex SHA-256>,
  targets: [四个 target，见下],
  assets: [{side, url, sha256, size}, ...],
  runtimes: [{path, sha256, size}],
  existingFiles: [{path, sha256}, ...]
}
targets: {<固定目标绝对路径>: <原生候选完整 bytes 的 base64>, ...}
assets: {<side + url>: <完整文件 bytes 的 base64>, ...}
runtimes: {<runtime 绝对路径>: <完整文件 bytes 的 base64>}
```

每个 target 必须含 `path`、`side`、`kind`、`beforeSHA`、`afterSHA`、`size` 和 `beforeStat`。`size` 是候选 bytes 长度；SHA 字段均是完整、64 位小写十六进制 SHA-256，不能是截断 hash。

`beforeStat` 必须直接来自本次初始 capture 的 `records.json -> files -> 对应目标 -> stat`，含且只含以下十个整数键：

```text
st_dev, st_ino, st_mode, st_uid, st_gid, st_nlink, st_size,
st_atime_ns, st_mtime_ns, st_ctime_ns
```

`beforeSHA` 必须来自同一初始 capture 原始 bytes 的 SHA。不得把执行时后来读出的 stat 倒填为 initial stat，以绕过 baseline 漂移。不能仅使用 SFTP 秒级 `mtime` 或只记录文件尺寸。

初始 capture 对比同时核验 SHA、inode 与 metadata；仅初始 capture 的 `atime` 允许被后续正常公网 GET/服务读取推进。**实际写入之前，使用双锁内读到的完整十项 stat + 完整原始 bytes 做 CAS，包括 atime；在私有临时 inode 完成写入/fsync 后，rename 前再次完整 CAS。** 正常读取若推进了 atime，写前 CAS 也会保守拒绝，而不是放宽它。恢复归属核验只豁免 atime，绝不豁免 inode、mtime 或 ctime。

### 固定四目标

| side/kind | 唯一允许的目标路径 |
| --- | --- |
| front/html | `/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html` |
| admin/html | `/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html` |
| front/api | `/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js` |
| admin/api | `/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js` |

四目标必须全部包含，即使某个目标不变也必须提供原始相同 bytes、相同 before/after SHA 与 beforeStat。不变的 front HTML **绝不调用 replace，不替换 inode，不重新序列化 HTML**。相同 bytes 的其他目标也跳过替换。只重载发生实际 API inode 替换的组：front 为 `dianzi51`，admin 为 `dianzi51-admin`。仅改 admin 时不能顺便重载 front。

### Immutable public assets

保留旧结构：`side` 只能为 `front/admin`，`url` 仅允许 `/assets/[A-Za-z0-9_.-]+.(js|css|png)`，对应固定 public root；`p.assets` 的 key 是 `side + url`，例如 `admin/assets/<文件名>.js`。列表与 map 必须准确对应，不能重复或夹带未声明文件。已有同名文件必须完整 SHA 相同，只复用，绝不覆盖；不同 SHA 为 collision，直接拒绝。

### 新 immutable admin runtime

`m.runtimes` 必须包含恰好一个 runtime，路径严格为：

```text
/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/runtime/newInformation.admin.<64hex>.runtime.mjs
```

文件名内 64hex 必须等于其完整 bytes 的 SHA。bytes 只放在 `p.runtimes[path]`，不混入四目标或 public assets。候选 admin API 必须引用 `../runtime/<该文件名>`。runtime 仅增、不覆盖；已有同名且同 SHA 时复用。候选 runtime 在私有 stage 执行 `node --check`，安装后对最终 runtime 再执行远端 `node --check`。仅做语法检查，不通过 `import` 运行 runtime 来测试。

### 既有依赖与 fresh coordination

`coordBeforeSHA` 必须来自本次 fresh、明确 closed 的协调文件原始 bytes，不可沿用旧发布包。`existingFiles` 必须包含当前实际引用且需保持的依赖完整路径与完整 SHA，至少一个条目；允许固定 public roots 下的 `/assets/` 依赖，以及本次 API release 的 front/admin `/runtime/` 下 `.mjs` 依赖。不要只列新文件：当前 runtime、其 contracts、原前台与后台实际生效的资产/importmap 引用等应按候选与回退依赖完整列出。列表禁止重复路径、目标路径、symlink/alias 或 `..`。脚本核验这些实际文件 SHA，并在 opening 前、安装依赖后及最终/回退验证时重新核验。脚本不扫描数据库，不尝试修复漂移依赖。

## 3. 安全发布顺序

1. 非阻塞、按旧顺序获取 `/var/lock/dianzi51-public-deploy.lock` 与 `/var/lock/dianzi51-production-code.lock`，核验两把锁仍指向持有的 inode。
2. 核验 fresh coord SHA、closed/非 active/无 recovery flag，核验 PM2 front 4 个/admin 2 个进程 online、固定 entry，并核验所有初始目标 SHA+stat、候选、既有依赖与 immutable collision。
3. 原 `factoryChannel.list` 只读 GET preflight。
4. 创建 root 私有 `0700` stage `/opt/ops/admin-polish-20261121-2257`，拒绝复用已有 stage。持久化 manifest、输入记录、原协调 bytes、四目标原 bytes、锁内 stat+SHA、候选。远端 `node --check` 仅检查候选 API/runtime 语法。
5. 检查私有 stage 与所有目标父目录处于同一设备，确保可使用真正 atomic rename/link。若分属设备则拒绝，不退化为公开目录中的临时文件。opening 前再次 full target CAS、依赖 SHA 和 coordinator CAS。
6. 持久 opening；私有 stage 中完整写入/fsync immutable 文件后使用“不覆盖”的 hard link 发布最终文件名，再 fsync 源/目标目录。不会出现公开的未完成候选或临时文件。
7. 仅替换变化的 API，rename 前完整 CAS，替换后立即记录/witness 新 inode，再 fsync 并核对实际 bytes。仅 reload 对应变化组；成功发布时只要求这些组观察到 PID 更新，不要求无变化组换 PID。
8. 跳过相同 bytes 的 HTML，尤其保留 front HTML 的原始 bytes 与 inode；变化 HTML 也用完整 CAS/atomic/fsync。
9. 完成只读 full-hash 验证后，在持有双锁时持久化并复核 owned coordinator 的 closed 状态，再持久化并读取确认 `receipt.json`，最后释放双锁并输出 `RECEIPT <json>`。

备份、候选和临时 inode 均在私有 stage。目标替换保留原 mode、uid、gid、atime、mtime；rename 产生新的 inode/ctime 是预期现象，原 inode 身份写入备份 metadata 供归属核验，不声称回退能恢复被替换的旧 inode 号码。

## 4. 验证边界：只读、无业务测试写

成功发布核验四目标远端完整 SHA 与精确 bytes、unchanged 目标 inode、既有依赖完整 SHA、进程数量/status/entry；公网验证：

- `https://admin.51dianzi.com/` 完整 HTML hash 与精确候选 bytes。
- `https://51dianzi.com/` 和 `/search` 完整 HTML hash 与精确候选 bytes；front HTML 不变时仍与原始 bytes 精确相同。
- 每个 manifest public asset 在对应公网 origin 上完整 SHA、完整长度与精确 bytes。
- 原 `factoryChannel.list` GET：`STM32`、非 priced-only、recent、limit 1、offset 0，保持旧只读请求。
- `https://admin.51dianzi.com/api/trpc/newInformation.unreadRefs?input=<编码的 {"json":{}}>`：只发无 cookie/token 的未鉴权 GET，要求 401/403 且 tRPC `UNAUTHORIZED/FORBIDDEN`、path 对应此路由，不接受 404/重定向/意外成功。

unreadRefs 验证仅证明未鉴权访问被拒绝和路由可达，**不证明登录用户的未读筛选/持久化/跨页授权交集在真实业务数据上已完整验证**。回退到旧 API 时不要求新 unreadRefs 路由存在，只验证旧四目标、公网 HTML、进程与原只读 list。

禁止登录、auth cookie/token、POST/PUT/PATCH/DELETE、`markDisplayed`、清真实未读、业务 stage 变更、创建询价/订单、上架/下架测试、库存/上传测试或任何数据库测试写。脚本不包含 SQL、DB 客户端或业务 mutation 调用。

receipt 和事件使用 `businessTestWrites: 0`，receipt 另有 `zeroBusinessTestWrites: true`。含义是“本脚本没有发起业务测试写”，**绝不是保证 PM2 reload/Node 启动、现有后台任务、迁移/初始化逻辑或真实用户请求不会产生数据库写**。不得把此字段改写成 `databaseWrites: 0` 或对全部数据库活动作零写承诺。

## 5. 精确回退与 failurehold

失败若已尝试 opening，按实际尝试的目标逆序回退。每个回退目标要求当前 bytes 恰为本次候选或原 bytes，且 metadata/inode 属于本次 witnessed 新 inode，或确为初始 inode。仅正常读取造成的 atime 推进可豁免。外来变更、inode/ctime 漂移或 full CAS 失败均不强行覆盖。

恢复原 bytes 仍使用私有预写、模板 metadata、写前 full CAS、atomic replace 和 fsync。只 reload 实际变化过的 API 组。回退要求进程 online/count/固定 entry 和原目标、公网 HTML、只读 list 校验；**不强求全部六个 PID 都变化**。已新增 immutable asset/runtime 留存，不删除，也不覆盖旧文件，避免破坏别人已经引用的 immutable 依赖。

无法精确恢复、丢失 coordinator ownership、关闭失败或 receipt 持久化失败，进入 `FAILUREHOLD`。仍持有双锁，若协调文件确属本会话则持久 `shared_release_active: true`、`needsOperatorRecovery: true`、window `failurehold` 及私有 failurehold 文件；遇到外来 coordinator 不覆盖。每 60 秒输出 hold 事件，直到人工接管。断连/中断不得静默解锁；SIGKILL/主机故障不可能由进程保证保锁，必须由上层与操作员追踪 durable coordinator。不得自动强杀 hold 进程或“清锁后重试”。

## 6. SSH 上层必须保留 finally（本次不执行/不另建文件）

上层须沿用原有 known_hosts 严格校验、批准的主机/身份/凭据、SFTP staged 文件流程、输出监控和 failurehold 接管方式。禁止根据 stdout 一时安静就重跑发布。不能用 `stdin.read()`/等待 EOF 来传 payload，也不能在远端 pipeline 中拼接 base64。

不论成功、验证失败、超时或异常，上层的资源关闭必须在 `finally` 中执行：关闭已打开的 SFTP 与 channel、本地 stdin handle（如客户端库提供）、SSH client，并输出连接已关闭的记录。此处“finally 关闭 SSH 资源”**不等于取消远端发布或释放远端双锁**。如果输出失联、命令超时或出现 failurehold，应保留可追踪的远端进程/监督方式并进行只读状态核对，不能盲目重试或把 transport timeout 当作已回退。

输出 `RECEIPT` 只是传输副本；权威证据是私有 stage 中 durable `receipt.json` 与 coordinator closed 的对应完整 SHA。上层成功条件：退出码 0、receipt scope/owner/result `VERIFIED`、`closed: true`、`businessTestWrites: 0`、最终协调 SHA/closed 状态相符。`ROLLED_BACK_VERIFIED` 退出码 1，不当成发布成功。只有只读确认持久 receipt/coord 后才可按原工具流程清理 staged 输入；不删备份、失败证据或 immutable 文件。

## 7. 对旧脚本的主要差异

输入由 stdin EOF 改为固定私有 SFTP staged 文件参数；固定新身份；新增 initial `beforeStat`+SHA 检查、精确 side/kind/map 验证；新增独立内容寻址 runtime 与远端语法检查；原始 bytes 相同则不换 inode；按实际 API 变化选择 reload；回退不要求全部 PID 变化；所有未完成候选移入私有同设备 stage；保留并强化双锁、写前完整 CAS、原始 bytes 备份、替换 inode witness、fsync、精确回退与 durable closed receipt/failurehold；公网 full hash 与原只读 list 保留；仅增加 unreadRefs 未鉴权只读 gate 验证；输出只声称零业务测试写，不承诺启动全局数据库零写。
