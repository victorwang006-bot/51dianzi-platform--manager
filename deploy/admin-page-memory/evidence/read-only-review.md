# 后台商户跨页记忆 — 增量只读复核（问题闭环）

**复核时间：** 2026-10-24  
**复核方式：** 仅静态读取、仅更新本报告。未修改任何源码或部署文件，未执行脚本，未启动浏览器，未访问生产、DB、凭据或秘密。  
**本次限定范围：**

- `/home/ubuntu/admin-page-memory/deploy.py`
- `/home/ubuntu/51dianzi-manager/client/src/hooks/useAdminPageMemory.ts`（仅 `adminScope`）
- `/home/ubuntu/51dianzi-manager/client/src/components/admin/MerchantNavigation.tsx`（仅 `sourceInput`）

本报告是对先前已发现问题的**定点复核**，不是对既有功能路径、构建产物或生产状态的全量重新审查。

## 结论

**静态放行结论：NO_BLOCKERS。**

此前的 JavaScript `/assets/` 发布 404 阻断已在当前 `deploy.py` 中明确消除；`adminRole` 缺失不再产生或回退为 `super_admin` scope；`sourceInput` 的非法 `page` 已收敛至安全的已验证页码或第 1 页。就本次限定的三个源码问题而言，没有剩余发布阻断。

下述父代理的最终浏览器验收仍应按既定计划完成：从 `241` 点“下一家”到第 13 页的 `242`，确认其持久化行为。该项是运行时验收步骤，**不是**本次已复核源码问题的静态阻断。

## 1. 新 JavaScript 的 `dist-root -> OPS/payload/assets -> live/assets` 映射

### 结论：已解决，先前的 `/assets/` 404 阻断不再成立

当前部署脚本形成完整且一致的目录链：

1. `prepare` 从 `dist/manifest.json` 构造 `changed`，对每个新 JS 使用键 `assets/<file-name>`（`deploy.py:67`）。因此发布计划的目标 URL/相对 live 路径已是 `/assets/<file-name>`，而不是 `dist/` 根目录。
2. `stage` 显式创建 `${OPS}/payload/assets`（第 70 行），并将本地 `dist/<file-name>` 上传至 `${OPS}/payload/assets/<file-name>`（第 71 行）。`dist/index.html` 则单独上传至 `${OPS}/payload/index.html`（第 70 行）。
3. `apply` 遍历 `changed` 中除 `index.html` 外的项目，强制要求名称以 `assets/` 开头，并断言目标父目录恰为 `live/assets`（第 37–40 行）。新 JS 的实际落点为 `live/assets/<file-name>`（第 39–42 行）。
4. HTML 在四个 JS 均已写入、且其 SHA-256 已由 payload 计划校验后，才通过 `.admin-page-memory-next.html` 与 `os.replace` 原子替换至 `live/index.html`（第 43–44 行）。
5. `apply` 在切换后逐一请求 `/<name>`（第 45–46 行）；对 JS 而言 `name` 为 `assets/<file-name>`，故核验的正是 `/assets/<file-name>` 的内容和 SHA-256，而非错误的根目录 URL。

所以当前脚本实现的发布映射是：

```text
本地 dist/<4 个新 JS>
  -> /opt/ops/20261024-admin-page-memory/payload/assets/<4 个新 JS>
  -> /opt/releases/20261018-multi-enterprise-v1/admin/dist/public/assets/<4 个新 JS>
  -> HTTPS /assets/<4 个新 JS>
```

`index.html` 对应：

```text
本地 dist/index.html
  -> /opt/ops/20261024-admin-page-memory/payload/index.html
  -> <live>/index.html（原子 os.replace）
```

因此，先前“新 JS 留在 `dist/` 根目录、HTML/import map 却请求 `/assets/`”的布局缺口，已被 `stage` 的 payload 子目录和 `apply` 的强制 `assets/` destination 双重消除。**在当前脚本所表达的发布流程被实际执行且其 post-check 通过的前提下，不存在该 404 阻断。**

## 2. 保护面、原子性与非业务写入边界

当前脚本静态上保持题述的受保护发布模型：

- 实际 live root 固定为 `/opt/releases/20261018-multi-enterprise-v1/admin/dist/public`（第 8、59 行）。
- `prepare` 对 live root 的全部文件和 Nginx `.conf`/`.inc` 建立 SHA-256 快照，并记录完整 `pm2 jlist` 的 name、id、pid、cwd、状态、启动时间和重启次数，以及 `/opt/apps` 下匹配的 `dianzi51*` symlink pointers（第 56–68 行）。
- `apply` 在写入前执行 `check(p['before'])`；写入后执行 `check(p['after'])`（第 36、44–45 行）。`check` 对受保护文件 hash、完整 PM2 process snapshot 和 pointers 做严格相等断言（REMOTE 第 20–24 行）。这与题述 `before=6115`、`after=6119` 的快照计数和原有 web、current Nginx、backend PID/pointer 保持约束相符。
- 互斥锁为原有 `/var/lock/dianzi51-public-deploy.lock`，采用 `LOCK_EX | LOCK_NB`（REMOTE 第 35–36 行）；`applied.json` 也阻止重复 apply。
- 唯一新增 static payload 是 4 个 JS，随后原子替换 HTML。脚本不含数据库连接、SQL、业务 API 写入、PM2 reload/restart 或 Nginx reload/restart 调用；Nginx 配置仅被读取并纳入 hash 保护。

本次未执行任何远端命令，故本报告不把这些静态保障表述为一次已实际发生的生产验证；它们说明当前源码已具备所需约束。

## 3. `adminScope`：role 缺失时不会赋予 `super_admin`

### 结论：已解决

`adminScope()` 现要求以下条件同时成立才返回非空 scope（`useAdminPageMemory.ts:9–14`）：

- `auth` 不在 loading、无 error、且已经认证；
- `user.id` 是大于 0 的安全整数；
- `user.adminRole` 是非空字符串。

其中 role 条件在第 11 行直接返回 `null`：

```ts
... || typeof user.adminRole !== "string" || !user.adminRole) return null;
```

代码中不存在 `super_admin` 字符串、`adminRole ?? "super_admin"`、或 role 缺失的等价默认提升。也就是说，role 缺失/空值时页面记忆 scope 尚未就绪，不能以高权限角色 scope 读写或恢复内容。

permissions 仅接受字符串数组成员并排序；非数组权限值归为 `[]`（第 12 行）。这不会制造角色权限或隐式赋予 `super_admin`，并且返回 scope 始终显式包含通过校验的实际 role 与规范化 permissions（第 13 行）。

## 4. `sourceInput`：非法 `page` 的安全 fallback

### 结论：已解决

`sourceInput()` 对 URL `page` 已进行受限数字格式和安全整数检查（`MerchantNavigation.tsx:41–55`）：

```ts
const raw = p.get("page");
const n = raw && /^\d{1,7}$/.test(raw) ? Number(raw) : Number(state.page || 1);
return Number.isSafeInteger(n) && n > 0 ? n : 1;
```

因此：

- URL 中合法的 `1` 至最多 7 位十进制正整数会被采纳；
- `page=abc`、负数、小数、指数形式、空值或超出格式边界不会直接进入 query；
- URL 值不合法时，只会使用经 `Number.isSafeInteger(n) && n > 0` 再次校验的保存 state 页码；
- 保存 state 也不合格时，最终确定回退为第 `1` 页。

`pageSize` 同时白名单限制为 `20`、`50` 或 `100`，否则回退 `20`（第 44、49 行）。故连续“上一家/下一家”的 list query 不会因非法 page/pageSize 而得到 `NaN`、负页或任意 pageSize。

## 5. 已提供的运行时证据与待验收项

依照本次任务给定的真实 compiled fixture 结果，以下已通过，未在本轮重复执行：

```text
page 12 / merchant 240
-> 下一家 241
-> 返回相同 page 12
-> y=1571
-> rowOffset=898.828125
-> 同一 source id
PASS
```

父代理保留的最终运行时验收为：`navbar 241 -> 242` 进入第 13 页后，继续验证页面记忆持久化。由于本报告严格只读且未启动浏览器，这一项未在此声称执行；但它不推翻以上三项确定源码问题的闭环结论。

## 最终结论

**NO_BLOCKERS（仅限本次定点静态复核范围）。**

- 新 JS `dist-root -> OPS/payload/assets -> live/assets` 映射完整，且 post-apply 针对 `/assets/...` 做 SHA-256 HTTP 校验；先前发布 404 阻断已解决。
- 缺失 role 返回 `null`，不会默认或赋予 `super_admin`。
- 非法 `page` 只能落到已验证的 state 页码，或安全回退第 1 页。
- 原锁、先 JS 后原子 HTML、仅新增 4 JS、无数据库写入、以及 `before=6115`/`after=6119` 的保护约束均保持在当前部署源码中。

除父代理尚待完成的 `241 -> 242` 第 13 页浏览器验收外，本次未发现可阻止发布的确定源码问题。
