# 业务订单 undefined-data 独立回归检查

## 交付与运行

独立脚本：`/home/ubuntu/work/orders-undefined-fix-20261117/check-orders.mjs`。它不导入会运行构建或改写 manifest 的旧测试脚本，只使用仓库现有 TypeScript AST 库、Node.js `vm` 和显式 mock ABI。

```bash
cd /home/ubuntu/work/orders-undefined-fix-20261117
# 当前旧版：预期非零退出，复现真实回归。
node check-orders.mjs --baseline
# 父代理候选 ready 后：默认读取修复目录根 manifest.json。
node check-orders.mjs
# 也可显式指定其他候选 manifest。
node check-orders.mjs --manifest /absolute/path/to/manifest.json
```

候选文件只由 manifest 的 `modules[].newLocal` 读取，并验证 `newUrl` 的 basename 相符。脚本不写 candidate、manifest、业务源码、构建目录、生产或 Git。自身输出写 `tests/baseline/` 或 `tests/candidate/`，包括结构化 `results.json` 和 AST 安全提取的完整函数副本；候选检查亦输出根目录 `checks.json`。所有订单/客户均是本地构造的合成 fixture，不接触真实业务数据、浏览器或外站。

## 实际执行对象

当前两份冻结真实模块及其 SHA-256 来自只读 `current-inputs.json`：

| 模块前缀 | 完整 CRM 函数 | 类型 |
| --- | --- | --- |
| `9abf862b36be9602` | `op`、`GB` | 主列表、嵌入客户子页 |
| `4c5a285662dc9c88` | `sN`、`GB` | 主列表、嵌入客户子页 |

解析器从真实模块 AST 寻找同时包含原 `crmSalesOrder.list.useQuery` 和 `crm-sales-orders-order-link` 的函数声明，要求每份模块恰好两处且函数名在明确集合内。函数代码由 AST 的 `getStart()` 至 `end` 整段截取，在隔离 VM 内完整执行；并保存提取位置、完整函数字节长度和 SHA-256。不会执行模块顶层、import、factory、启动代码或后台逻辑。没有把单独 `data?.items` 表达式或 mini prelude 冒充完整渲染。

`GB` 的 `Gu`、`yv`、`OC` 和 `sN` 的 `Qi`、`Ud`、`G_` 按函数最近词法 owner 的直接 statements 精确提取并执行，防止碰到模块内同名的其他厂商代码。主列表 `op` 的 `ua`、`sc`、`tb` 同样精确抽取。原函数里的 embedded fetching/error/unfetched 主动 clear 和 customerId mismatch clear 都由原完整函数自身执行，未用 mock 直接改写那些结果。

## 覆盖状态

每个完整函数独立验证初始 pending、disabled、401、普通 error、placeholder、unfetched 时的 **真实 `data: undefined`**，而非先保留 data 再只改状态。验证成功空页、成功非空页、失效之后同一 VM/持久化 hook slots 下恢复成功；亦验证 fetching/placeholder/unfetched 保留原始 data、identity 或 staff 失效、disabled 保留 data 时通知 refs 必须为空。

对三个支持 embedded 的完整函数（两个 `GB` 和 `sN`）额外传入原始非空查询页，然后通过真实原过滤 guard 验证 embedded fetching、error、unfetched 和切换客户导致的清数据。原非空 fixture 始终属于客户 81，客户 mismatch 用客户 82，原 guard 必须自行过滤为 undefined，返回树中没有订单行。还覆盖客户读权限撤销后的无数据状态；原权限、写入约束均未移除。

账号 scope 失效场景在查询 ABI 注入 `data: undefined`、pending/fetching 和新 storageScope/未核验 identity。此场景验证页面能安全接受真实查询清数据结果；**不声称已执行完整 BusinessScope/TanStack 查询缓存失效链路**。

成功非空页检查原当前页 refs `crm-sales:11` / `crm-sales:12`、页内新优先排序 `[12, 11]`、真实编译 JSX 根行 ref 和原 order-link 字段中的一个动态 row badge。空页无 row badge、无通知操作资格。不可读取状态检查 `listReady`、空 refs、无 inspect/markDisplayed 操作资格以及不显示假新信息 badge。

## 测试边界

这里的“完整函数渲染”准确指完整真实编译 CRM 函数返回 DOM-shaped JSX tree。React hooks 使用显式持久化 useState/useRef slots；useMemo 重算；effect 只注册、不 mount；UI primitives 只做惰性 type label，格式化常量/函数只注入展示 ABI。未执行真实 React reconciliation、浏览器 DOM、布局/可见性观察器、实际 shared notification hook 或服务端。

通知接口是明确的 spy ABI：仅当真实函数传入 `listReady: true` 且非空 refs 时记录 inspect eligibility；真实行 ref 接受 DOM-shaped witness 后，仅对可读取 refs 记录 markDisplayed eligibility。因此结果中的 `spyInspectEligible` / `spyMarkDisplayedEligible` 是离线调用资格断言，**不是实际 RPC 次数或已读写库证据**。所有 mutation、invalidate、network 均为抛错函数，若误调用则检查失败。不会执行报价、订单修改或其他写入。

候选还做模块级逆变换验证：每个 CRM 函数仅允许 `__niPageRows` initializer 的 `data?.items??[]` 及 refs initializer 增加 `__niListReady` 条件这两处变化。用 AST 边界回填对应旧 initializer 后，要求整份模块与冻结旧版完全一致；不是仅断言函数之外没变化。

## 旧版复现结果（2026-11-17）

旧版最终运行 `node check-orders.mjs --baseline`：**16 PASS、67 FAIL，退出码 1**。其中 47 次准确复现 `Cannot read properties of undefined (reading 'items')`；另外 20 次不可读取却仍向通知接口提供非空 refs。没有未定义展示 ABI、harness setup 或其他意外失败。

四个完整函数的成功空页、成功非空页、恢复成功共 12 项全部 PASS，4 项完整函数 ABI setup 全部 PASS。这证明 harness 能执行完整既有成功路径并观测原 refs / inline badge，失败不是把所有函数都简化为同一个表达式得出的结果。明细在 `tests/baseline/results.json`，日志在 `tests/baseline-run.log`。

## 候选状态

2026-11-17 17:24（UTC+8）运行默认 `node check-orders.mjs` 完成：**85 PASS、0 FAIL，退出码 0**。包括 79 项完整真实函数状态检查、4 项严格完整函数 ABI setup 和 2 项整模块独立逆变换检查。不是仅执行通知 prelude。

检查的是父代理根目录 `manifest.json` 所列候选：

| 候选 | 检查文件 SHA-256 | 完整函数 |
| --- | --- | --- |
| `BusinessWorkbenchPage-orders-empty-safe-276ab4fbef7d739b.js` | `276ab4fbef7d739ba311fe6b95acd1e514616a4d8ab22d94d24a3bdb2fcc7d4e` | `op`、`GB` |
| `BusinessWorkbenchPage-orders-empty-safe-22029b840cf9ffe5.js` | `22029b840cf9ffe517b401982cb3a89479096b8571c5a99bff751422ee840072` | `sN`、`GB` |

四个完整函数的初始 undefined、错误/disabled/unfetched/placeholder undefined、账号失效 undefined 均返回安全 JSX tree。三个支持 embedded 的完整函数在原始非空 data 下，由实际旧 guard 主动 clear 或客户 mismatch clear，亦全部安全返回且无订单行。所有不可读取场景传入空 refs，spy inspect/markDisplayed eligibility 均为零；成功空/非空/恢复场景保留原成功呈现。两份模块将四个 AST initializer（每函数两个）回填旧值后与冻结旧版完全一致。

详细结果：`/home/ubuntu/work/orders-undefined-fix-20261117/checks.json`（同时保存在 `tests/candidate/results.json`）；运行日志：`tests/candidate-run.log`。上述通知操作结论严格限于显式 mock ABI 的资格断言，真实浏览器、shared notification hook 与服务端 RPC 未执行，账号缓存清数据链路仍为查询 ABI 输入边界。
