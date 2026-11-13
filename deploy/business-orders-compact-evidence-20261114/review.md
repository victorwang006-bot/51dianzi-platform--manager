# 全局业务订单精简：静态候选增量审核

**PASS，未发现本轮增量阻断项。** 本结论仅针对当前生产静态候选及四个关键脚本的离线审核，不构成已部署或登录浏览器验收声明。

## 已核对边界

- 两个实际入口均正确覆盖：bundle0 原生 `op` 为 56,988 字符；bundle1 原始 `op` wrapper 为 97 字符且逐字不变，实际变更位于 `__customer_workbench_manager_v1` 内的共享 `sN`，全局与 embedded 调用链均已确认。两包各七处实际 DOM 补丁，独立正向重建与 exact inverse 均与基线逐字相等；补丁外字节不变。
- GLOBAL 实际八列表头/单元格/col；项目仅从列表移除，数据及详情保留；“客户”下需求号保留。完整可见 header/title/description 节点置空，无新增 sr-only 或占位元素；AdminPage 保留 `aria-label="业务订单"`，首个有效子节点为 Filter。原蓝色录入按钮原节点、样式、handler 移至“筛选”右侧；原换行能力保留。22% / 12% / 16% 仅全局 inline。
- embedded 写权限及只读两分支实际九列 table/filter 的离线渲染结果均与基线逐字相等，无 inline col 样式；原成交确认、固定 customerId、权限、query payload 及 handlers 不变。原 status/date/row actions/pagination/dialogs 保留。两个商城 `uI` 完整函数字节相等，未改 CSS。
- 13 项测试从候选 AST 提取实际渲染节点执行，并非重写业务模板；已在内存中移除唯一报告落盘语句后复跑，结果 **13 PASS / 0 FAIL**，且与现有报告完全相等。另独立核对哈希、七处实际补丁、商城/逻辑字节及 HTML/importmap，不仅依赖 proof 中的布尔标记。
- HTML 按原 importmap 文本局部替换、追加 alias 与三个必要 scope 克隆；独立重建 importmap 字节和 HTML 逆向均通过。旧 imports/scopes 的键与非迁移依赖保持，三个 JS 的 **106 条有效依赖解析** 与基线（仅目标迁移）一致；entry JS 全字节不变。`files.json` 唯一允许发布集为 **HTML + 3 JS，共四文件，无 CSS**；候选目录残留旧哈希包未进入该集合。
- 激活驱动静态确认：四文件 allowlist、候选/driver/evidence 哈希校验、验证前置条件、两把非阻塞排他锁、协调窗口所有权、基线/最终 HTML CAS；后端 API 所在 admin/front 服务文件及 nginx、PM2 进程/环境、旧 JS/CSS 资产在前后检查。仅新增隔离静态 JS，拒绝不同字节覆盖旧资产；失败及显式 rollback 均以候选 HTML 哈希 CAS 恢复精确基线 HTML，旧资产保留。无 DB 客户端、DB 写入、API mutation 或进程 reload 路径。未执行该驱动。

## 本次审核绑定

| 对象 | SHA-256 |
|---|---|
| 基线 HTML | `917a7e100fa6e3493a29437b6df23e50d88c4efa71e39906f361a13de954ba03` |
| 候选 HTML | `a895f40bfc395e7fd31c16771d68a32a92519d825c075cb40c652ec0da9be5c1` |
| 候选 entry | `7a350b978fbf40eba4228bf3fe325fc620469d7792f2af6f59cd640a4d14fd74` |
| 候选 bundle0 | `d600e4f28e7152b4ef4849ffa0064f45be310c755f587beb0522fc4753cfce59` |
| 候选 bundle1 | `bd4afc54e076ab0faa331a5844e40f80ff1a7513ed3756bfb5b0e4fae03bcd84` |
| 激活驱动 | `2e1180b13bb679f59431a91f9caabd365fa6afedd91a2711a3e6ad01f91ca21d` |

审核仅进行本地只读检查和无落盘离线执行；唯一主动写入文件为本 `review.md`。未审查并行变更中的 main 源码，未操作 git、浏览器、API、网络或部署。组件以惰性 fixture/stand-in 验证 AST/DOM；不声称生产登录态、真实组件计算样式或像素验收。
