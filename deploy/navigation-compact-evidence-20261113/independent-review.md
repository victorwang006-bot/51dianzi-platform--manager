# 独立审查：导航紧凑化与默认客户首页

**结论：PASS — 在本次授权的源码、最新候选产物和 driver 静态审查范围内，未发现确凿阻塞缺陷。**

审查时间：2026-11-13 21:43（北京时间）。项目 `/home/ubuntu/work/51dianzi-platform--manager`；候选 `/home/ubuntu/work/navigation-compact/candidate`。依据 TODO、runtime-facts 及两份源码 handoff；以父代理最后补入 Logo 可访问标签后重新构建的候选为准。

本审查未修改源码、测试、Git、候选资产或部署脚本，未使用 SSH、数据库、业务 API、浏览器，未执行 build、activation、全仓测试或重复父代理 actual suite。仅执行只读 diff、AST 解析、内存 helper 编译和独立正逆差异/依赖检查；本文件是唯一指定输出。

## 1. ROOT entry、importmap 与依赖：PASS

- HTML 的唯一 module entry `src` 已直接替换为 `index-customer-home-7a350b978fbf40eba4228bf3fe325fc620469d7792f2af6f59cd640a4d14fd74.js`，不是仅修改 importmap。主 entry 仍在原目录，relative imports 不漂移。
- 独立于 patch core 的 resolver，按标准 URL 归一化、scope 匹配及回退重新检查：原 36 项顶层 imports 保留，原 22 scopes 的全部 597 个映射键保留，只将四个已批准的目标 URL 重定位。四个候选 module 各有对应的新 scope；最新 HTML 共 26 scopes。
- 四份 JS 的 132 处直接 import 表达式重新解析后，候选解析结果均等于原结果或其已批准 relocation；原 scope 的映射语义也逐项检查通过。JS import/export 接口未因注入而被改写。
- 独立重放全部 patch 的 forward/inverse，并校验 HTML inverse：entry 2 个范围、layout 10 个范围、两份 workbench 各 3 个范围，均精确恢复 baseline；没有依赖 builder proof 的布尔标志作为唯一证据。

## 2. 默认首页、关闭入口与资格链：PASS

真实 main 顶层 `$f` initializer 是 `/workbench/customers`。原登录/return-path/根路由与权限函数保留；layout 顶层 `te="/workbench/channel-inventory"` 是 channel BASE，未被当作默认首页修改，`yo`、`bo` 原函数字节一致。

两份 `__columnsMenuClosedEntryTarget` 仅在原 destination initializer 前增加裸 `/workbench` 的 customers 分支，没有提前 return。原 merchant 单一候选、数字/安全整数/正数验证及返回逻辑完整保留；legacy inventory/publish/edit 的渠道库存目标不变。

layout 的真实 Dashboard callback 保留前三参 `(x,N,__inventoryView)`，第四参仅追加 source intent。`if(!I.includes(x))return;` 位于 notification 之前；`I` 是原父过滤后的 menu 对象列表，不是 JSX 同名变量。反向去除这两处批准的 callback 扩展后，callback 与 baseline 精确一致：原 notification、channel `yo` 和一般 `bo` 资格链不动，只有原 `_!==null` 后才调用 source target。clone/撤权对象不能借 source 参数恢复资格。

Logo 的 href、主点击和可访问标签均已指向/描述客户列表；原 Ctrl/Meta/Shift/Alt/辅助点击行为保留。审查期间早期候选仍有旧库存标签，但父代理已自行修复；最新 10-range layout 已重新核验，不构成未解决问题。

## 3. 销售下拉、宽度与交互：PASS

`__NC_SO` 与独立 `__NC_WIDTHS` 工厂均与当前源码的全新内存编译输出一致，且确实注入并接线到 nav capsule。width helper 的五处调用覆盖父定位、子定位及两层实际 inline width：销售/库存管理/采购管理 160px、运营父 168px/子 176px、组织 176px。CSS 同步 border-box 尺寸、40px 行高/12px 水平留白；移动端 360px `!important` 覆盖桌面 inline width。

销售 entries 来自父 filtered 的原 outbound/orders 对象，稳定商城/业务排序；不存在 synthesize item、改 path/capability 或新增授权。叶子传原对象及第四 source 参数，先同步关闭层再通知父；原 preload、badge、hover timer、permission/location snapshot、focus 消费与取消逻辑保留。子层按独立 parent/child width 贴边定位并在右侧不足时左展开。

## 4. Workbench 隔离：PASS

两份 workbench 都只有原 `__d51_so_get` wrapper 工厂与两个 PageHeader title literal 三处补丁。独立 AST/字节核对原 access/provider、RouteGate、聊天 helper、询价/业务 route capsule 和商城/CRM 页面函数：除批准的标题文本外一致。未重写订单动作、聊天、原 gate 或 legacy deep-link 路由。

wrapper 源码仅移除重复来源 nav/import；selection、显式来源、identity 隔离记忆和原 gate 保留。显式撤权/非法来源不得回退另一来源；legacy outbound 仍先通过 seller gate。父代理最新 actual 报告的 46 个结果为 PASS，所有记录 input 的 relative path/SHA 与当前六文件 manifest 一致；本审查没有重新执行这组 suite。

## 5. Driver 边界与证据：PASS（静态）

Python AST 解析通过。driver 强制六个唯一 allowlist 文件（HTML + 4 JS + 1 CSS）、安全路径、candidate/evidence/driver hash；assets 采用 additive install，已存在不同内容拒绝覆盖。HTML 有 baseline、窗口及 final 精确 CAS，自动失败回滚仅在当前 HTML 仍等于本次候选且备份 hash 正确时恢复；显式 rollback 同样有精确 CAS。

静态确认没有 DB/API mutation、旧 asset 删除/覆盖或业务进程 restart/reload 指令；唯一 subprocess 操作是读取 `pm2 jlist`。原 assets、protected 文件及进程快照在切换后检查。线上 protectedPaths 的最终覆盖和当前归档 backend 固定 SHA 应由父代理生产 preflight 核验；本审查没有连接生产，不能替代该步骤。

公开路由返回新 HTML 的 hash 只能证明资源切换/健康，不是登录后的真实浏览器点击验收。最新 actual 证据也明确使用 inert 原页面/transport mocks，不宣称真实订单操作验收。

## 最新审查版本

| 对象 | SHA-256 |
|---|---|
| baseline HTML | `df539e3e8b1c70cea82e26c9214c1b171dad66257fb836b481912db546a26e5d` |
| candidate HTML | `70e4a39af39169e8216843d8bb6e39b1e452841d3817a552b9ce4e6f8fb9dec1` |
| main entry | `7a350b978fbf40eba4228bf3fe325fc620469d7792f2af6f59cd640a4d14fd74` |
| latest layout（含 Logo 标签） | `60945cbc9ed151e4812f28d176fd5a654b9211cca0ce51b10d8ae9b1a5699e17` |
| workbench 0 | `94bca8b34c590c9c85278927bd791f8da669187decc5c7b3ea48f198171950fb` |
| workbench 1 | `8cc6ab47734cb88585a468fc3dccb6dbc779d985a1391c22d65a9c6411770552` |
| scoped CSS | `967d4546ae9c41417f7305e2e56fb6003e96f0651865310996400121cf034c35` |

最终只读检查：六文件实际 hash 全部匹配 manifest，HTML/四 JS 正逆差异与 132 处直接 import 解析通过，最新 actual inputs 匹配。父代理报告合并定向源码测试 20 文件/405 tests PASS、`pnpm check` exit 0、完整 location 54 tests PASS；本审查未重跑。旧 `/workbench` 缺省库存断言已同步客户，不视为真实回归。

**未解决阻塞项：无。此 PASS 不等同于 production 已部署或真实浏览器/业务操作已验收。**
