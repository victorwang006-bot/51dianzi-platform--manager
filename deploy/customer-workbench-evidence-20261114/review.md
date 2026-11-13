# 客户 BOM / 渠道库存 / 客户订单独立只读审查

**结论：NEEDS_FIX。** 功能源码与正式候选未发现本次新增的阻塞；发布失败恢复存在一项具体安全缺陷，当前不能把 `reviewPassed` 设为 true。尚未部署。

审查对象为 `/home/ubuntu/work/51dianzi-platform--manager` 当前实现及正式 `candidate` / `backend-candidate` 产物。按委派的标准 effort，重点追踪真实路由、来源绑定、原生实例桥接和发布契约；未重复整套验收。仅读取本地代码、既有脱敏快照及日志，进行了少量纯合成内存计算和现有 reloader VM 测试；未执行网络、浏览器、SSH、数据库、部署或 Git 命令，未修改源文件。本报告是本次唯一业务工作成果写入之一，不含密钥或真实业务数据。

## 阻塞 R1：失去 online 状态会先阻断自身恢复，却仍释放协调窗口

**位置：** `deploy/activate-customer-workbench-20261114.py:78–85,111–127,280–291`；`deploy/reload-customer-inventory-api-20261114.cjs:25–27`。

正常激活在 API 文件被替换后逐实例重载。若本任务候选启动失败、重载超时或返回异常，某个原目标实例可能进入 `errored`、`stopped`，或暂时处于 `launching`。异常处理会调用 `restore_backends`，但该函数在任何 API 候选哈希 CAS / 备份恢复之前先执行 `compatible(before, processes())`。`compatible` 要求当前状态与原 `online` 状态完全相等且 pid 大于零，因此这类**本任务自身重载失败**会直接抛出 `API_PATH_OR_ENVIRONMENT_CHANGED`，既不恢复原 API 字节，也不重载。独立 Node reloader 在 rollback 模式同样仍要求 `online`，仅改 Python 检查不足以关闭问题。

异常路径虽然记录 `EXACT_API_RECOVERY_NOT_CONFIRMED`，仍在 289 行设置 `shared_release_active=False`，最终释放两把锁。于是可能留下原 HTML / 候选 API 的混合状态或不健康目标进程，同时共享协调窗口却不再阻止下一次任务进入。这不满足已批准的“失败恢复本任务 HTML/API、保留原环境精确目标重载”边界。

**独立合成复验：** 执行原 `restore_backends` 函数，只替换 `processes`、hash、atomic 和 reload IO 为内存桩。原目标的 id/name/script/CWD/execMode/environmentHash 完全不变，文件哈希仍为本任务 candidate，仅改变该目标状态。`errored`、`stopped`、`launching` 三种输入均得到 `API_PATH_OR_ENVIRONMENT_CHANGED`，atomic 调用 0 次、reload 调用 0 次。未使用真实 PM2 / API / 文件系统目标。现有 9 个 activation fixtures 没有覆盖目标进程失去 online 的恢复路径；现有 7 个 reloader VM fixtures 均通过，但 rollback fixture 也只使用 online 目标。

**最小修复建议：** 将“进程身份 / 路径 / CWD / 环境 / 非目标 worker 不变”与“目标健康 online”拆开。正常激活、完成验证继续严格要求 online；恢复时只对有本任务安装/重载意图记录的原目标允许自身 liveness 状态变化，仍严格检查身份、环境、候选/原字节 CAS 和备份哈希，再恢复原字节并进行原环境、原 id 的精确恢复操作。Node rollback 门禁需同步；不扩大到 worker 或全局 restart/save。若精确恢复未确认，应保留本任务失败/需人工恢复的协调占用，不把窗口宣告可用。新增一个候选重载导致原目标 errored/stopped 的离线 fixture，并验证原 API / HTML 恢复、worker 不动；新增恢复仍不健康时的窗口保留 fixture即可。修复不要求重建已验证的前端/后端业务候选，只需更新发布器、reloader 和相应 evidence hash，定向复验。

## 已通过的真实连接与范围核查

1. **正式产物和基线。** 独立重算 64 个前端 source hash、4 个前端文件及 4 个后端 source hash、2 个后端文件，全部匹配 proof。两份业务模块各四个 AST slot 的逆补丁独立验证 byte-exact。最新 `production-baseline-final.json` 的 HTML hash 与候选基线一致：`a895f40bfc395e7fd31c16771d68a32a92519d825c075cb40c652ec0da9be5c1`；两 API baseline 为 `b1169a…` / `aa3b20…`，目标路径与后端清单一致且快照标明非 symlink。该快照有 12 个 online 进程和关闭的并行全局订单协调窗口。此处只证明本地已取回快照，未进行新的生产读取。

2. **真实应用路由与实例。** `customer-workbench-core-20261114.cjs:11–20,26` 精确替换各可达模块的 `Iw`、旧 demand dialog 和原 `I1` route delegate，末端追加 lazy getter，不替换入口/root/provider。候选 HTML 替换原 importmap value 并克隆原有效 scope；88 条 dependency resolution 证据证明有效依赖不变。factory 从原业务模块桥接 React、ReactDOM portal、wouter、tRPC、BusinessScope、身份和 pageMemory；检查 metafile 禁止复制这些实例。实际候选 tests 执行 getter / 导出组件 / 原 `I1` 路由，而非只测未接入的函数。最新全局业务订单、商城、chat/access 函数及旧库存 host capsule 保留原字节。

3. **BOM。** `customerDemandBom.ts` 仅七个物料字段；支持 xlsx/xls、模板、映射、分页修正、公式拒绝、数量正整数和行数/文件预算。确认追加只变本地表单，不调用保存/采购提交、不合并重复型号、不自动导入联系人列。`CustomerDemandDialog.tsx:308–342` 在确认/下载时再次核验 receipt、session token、权限、alive、容量；`save` 阻止 BOM 尚开放时提交，正式提交由共享 schema 要求型号、数量，BOM 不完整草稿由明确 checkbox 授权。归档、只读、成单锁、dirty、身份切换保护仍在真实父 session。

4. **客户库存与真实后端。** 客户 tab 的 `materials` 旧链接映射为 inventory，历史需求和订单物料未删除。`CustomerChannelInventory.tsx:32–55,66–100` 将 exact customerId / enterprise / actor 发给既有 `listTeamMaterials`，不传隐式全局 channel、不先拉全局再客户端过滤；响应核验失败关闭。生命周期 key/generation、AbortController、当前行和 action guard 防止迟到读取/弹层/发布操作继续进入旧客户。真实 BFF 源码 `businessRouter.ts:323–347,399–453` 仅客户模式取消 official inventory read 的 CRM shortcut，要求库存和客户 scope 交集。真实 native service 在事务中以 `crm_customer_supply_channels` 的 enterprise/data owner/customer/channel 精确 EXISTS 加原 stock/team/share、source 与 CRM gate，在 count / 分页前限制范围；不是型号/公司名猜测。actual 后端候选保留原 router 构造位置且新 helper hoisted、boot getDb=0。全局行集合和旧 DTO 字段保留，新增 company 仅取当前受权 linkedCompany，缺 source/CRM 则 null，不回退私有渠道名。bindingCount=0 前端现有文案准确承认无绑定、无活动库存、来源无权均可能，并未声称不存在历史绑定。

5. **订单。** 真正客户页嵌入 `CustomerSalesOrders`，保持九列、客户 header 右上录入和固定 customerId 的 list/detail/candidates/create/action；`CustomerOrdersSession` 的身份 key 包含当前 company、读写/归档边界。全局精简八列、无 header、筛选右侧录入以及商城路径仍采用被 byte-preserve 的最新线上逻辑，不以本地旧版本反向覆盖。

6. **CSS 与 portal。** 22 份原生 stylesheet 的 manifest/hash 证据齐备；其 provenance 是既有 SSH 只读 snapshot，不是成功 GET。本审查没有执行 SSH 或 GET。独立解析最终 CSS，167 个非 keyframe rule 均有 customer scope；未见 import/theme/property 或全局 preflight。增量 utilities 支持容器 self 和 descendants，需求/BOM DialogContent 带 portal scope，BOM reset ConfirmDialog 显式 opt-in；其他 ConfirmDialog 默认 DOM 未变。新增 keyframes 独立命名，未输出全局主题/字体 token。实际视觉和真实原生 portal primitive 未经登录浏览器验收，静态和 jsdom 证据不等于视觉实测。

7. **发布清单契约（尚未 stage）。** 正式前端 files.json 为 index.html、两份内容哈希业务 JS、一份内容哈希客户 CSS，满足 driver 的 2..12 文件和 namespace 约束；backend-files.json 的两项正好匹配固定 front/admin path。最新 proof 提供 `latestGlobalOrdersBytesPreserved`，与 driver 的 PROOF_FLAGS 一致。已核对 driver 的锁顺序、HTML/API fresh CAS、只追加资源、原环境精确六目标、旧资源/worker/startup dump/Nginx hash 保护及 foreign candidate 不覆盖。最终 manifest 尚在父准备中，本次不宣称已验证未生成的 manifest，但没有因其未生成单独阻塞。

## 证据计数（不累计重叠测试）

| 证据 | 准确口径 |
| --- | --- |
| customer-final-typecheck.log | tsc --noEmit 通过（既有执行证据） |
| customer-final-frontend-tests.log | 10 files / 284 tests：首轮 277 PASS、7 FAIL；失败都在 compact 的 11 项文件 |
| customer-global-merge-tests.log | 修正 mock import + 客户 table 对照后，该 compact 文件 11/11 PASS；其余九文件合计 273 PASS，按逐文件日志计算；因此合并证据覆盖原 284 项，不伪称一次完整新运行 |
| customer-bom-scope-tests.log | 36 PASS，属于上项 BOM render 文件的定向复验，不重复加总 |
| inventory-final-tests.log | 7 files / 220 PASS |
| inventory-backend-tests-green.log | 7 files / 162 PASS |
| candidate/actual-candidate-tests.json | 正式前端实际候选 23 groups PASS / 0 FAIL |
| backend-candidate/actual-backend-candidate-tests.json | 正式后端实际候选 21 groups PASS |
| customer-activation-tests.log | 9 离线 fixtures PASS，但未覆盖 R1 |
| customer-reload-tests.log / 本次 VM 重读执行 | 7 VM fixtures PASS，不包含 R1 |

## 非阻塞限制与准确披露

- `server/customerSupplyBusinessHook.spec.ts` 的既有 3 fail 在未修改基线 worktree 复现，错误为旧 db mock 无 getDb。不是本次新增回归，不绕过生产权限代码修复 mock，不宣称全库绿。
- **环境指纹并非任意 JSON 的跨语言规范化。** Python `digest` 与 Node `canonical` 在普通 ASCII 环境键、嵌套字符串/整数、中文和控制字符 UTF-8 合成输入上相同；数字形对象键、non-BMP 对象键、浮点值输入会不同（JS 对数字键重新枚举、UTF-16 键排序及数值串行化规则）。最新快照仅提供 fingerprint，未提供原环境结构，所以本次未能认证这些特殊形状在真实环境中不存在；未发现真实环境漂移，不将合成特殊形状单独标为实际上线缺陷。不能把当前函数宣称为“所有 JSON 形状都一致”。若后续环境包含这类值，宜共用一种规范化算法或在 API 文件替换前验证支持的 shape/两端指纹；不得记录原密钥。
- 没有真实登录浏览器、生产 MySQL、真实 API 重载或发布后 health 验收。合成 SQL 执行的是真实候选 drizzle/trpc/权限函数，仅 IO/身份为 fixture；不等同于生产验收。已有 BFF 访问审计等旧行为没有因本次读取功能而被声称绝对零 DML。
- 本审查不认证用户提供的 commit 基线身份：未执行 Git 操作。当前 reviewed source hash 与正式候选 source hash一致，是本次冻结凭据。

## 审查冻结凭据

- frontend candidate proof：`9b46df524548ed62891f602bcd246044d6043ee69c6d1c7e68da9c1d8e86f970`
- backend candidate proof：`23b8ab84dd5176ff8380a8ae375cf493262864b4cfc1b93c6e322845536aaaa1`
- activation driver：`0eeaaeab719948c0b8c15fbb9c18d694d03837470491e47d86d24f673312fda3`
- reloader：`1491ee2abe627b6643e1551dc35fa26b9ad522dc49735fef3adcfcff1623c7ad`
- latest protection snapshot：`920b12571a86e057fdf69a5a8eda3153b255d1278412cf33088f5ffd45ed0016`

**放行边界：** 仅 R1 修复并经定向离线复验后重新决定 PASS；不得把本报告作为当前 driver 的 stage/apply 放行证明。
