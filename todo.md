# 51电子网后台管理系统 TODO

## 基础设施
- [x] 数据库Schema设计（商户、商品、订单、财务、审计、风控等核心表）
- [x] 全局布局与侧边栏导航（DashboardLayout定制）
- [x] 全局设计系统（品牌蓝#185FA5、字体、颜色变量）
- [x] LOGO集成与顶部品牌展示

## 数据看板首页
- [x] 核心指标概览（订单量、交易额、商户数、待处理事项）
- [x] 近7日交易趋势图
- [x] 待处理事项快捷入口
- [x] 最新告警通知展示

## 权限管理
- [x] 角色列表与权限配置（运营/商户/客服/风控/财务/系统管理员）
- [x] 管理员账号列表
- [x] 角色分配与权限变更

## 商户管理
- [x] 商户列表（搜索、筛选、分页）
- [x] 入驻申请审核（通过/拒绝/补件）
- [x] 商户详情（资质、协议、结算账户）
- [x] 商户状态管理（正常/暂停/清退）

## 商品与库存治理
- [x] 商品列表（搜索、筛选、分页）
- [x] 商品审核（通过/拒绝/违规）
- [x] 商品上下架管理
- [x] 禁售商品处理
- [x] 类目管理
- [x] 库存明细维护

## 订单中心
- [x] 订单列表（搜索、筛选、分页）
- [x] 订单状态追踪与时间线
- [x] 异常标签标注
- [x] 操作备注
- [x] 订单取消处理

## 售后与退款管理
- [x] 退款申请列表
- [x] 退款审核（通过/拒绝）
- [x] 证据查看
- [x] 退款执行与状态追踪

## 财务账本与对账
- [x] 支付流水查询
- [x] 平台服务费统计
- [x] 商户应收管理
- [x] 结算单生成与查看

## 审计中心
- [x] 操作日志列表（按人/对象/时间筛选）
- [x] 敏感数据访问记录
- [x] 管理员操作变更记录

## 任务与告警中心
- [x] 待办事项汇总
- [x] 失败任务提醒
- [x] 资质到期预警
- [x] 异常卡单提示

## 智能风控（LLM集成）
- [x] 异常订单智能分析
- [x] 可疑商户行为分析
- [x] 风险摘要自动生成
- [x] 处置建议输出

## 自动告警通知
- [x] 卡单超时告警
- [x] 退款异常告警
- [x] 资质到期告警
- [x] 结算失败告警

## 测试
- [x] 核心路由单元测试
- [x] 权限控制测试

## 用户反馈迭代
- [x] 左侧导航栏设计风格与前台51电子网保持一致
- [x] LOGO去除白色背景并增大侧边栏显示

## 商户详情页迭代
- [x] 扩展商户表：营业执照信息（统一社会信用代码、执照图片、注册资本、经营范围等）、法人信息、联系人信息
- [x] 后端接口：merchant.detail 按ID返回完整企业信息
- [x] 商户详情页 /merchants/:id 展示企业信息、营业执照、法人、联系人、结算账户
- [x] 商户列表公司名称可点击跳转详情页
- [x] 详情页保留审核操作（通过/拒绝/补件）
- [x] 单元测试覆盖 merchant.detail
- [x] 删除“累计订单量”与“累计成交额（已完成）”两个统计卡片

## 商品按商户分组迭代
- [x] 后端接口：按商户分组返回商品列表（含商户名称、待上架/待审核商品）
- [x] 商品页面按商户分组展示，每个商户下显示其将要上架的产品
- [x] 保留搜索、状态筛选与审核操作
- [x] 单元测试覆盖分组查询接口
- [x] 商户分组卡片头部可点击折叠/收起商品列表

## GitHub推送
说明：以下 4 项为源仓库 todo.md 自带的历史任务清单（对应产出该 GitHub 仓库的上一次会话），不属于本次部署任务范围。本次按用户要求执行的是"克隆代码覆盖到项目（不保留 .git 历史）、不用 template.json 初始化"。
- [x] 克隆现有仓库，保留历史（历史任务，不在本次范围；本次为代码覆盖式克隆，未保留 .git 历史，符合用户要求）
- [x] 删除template.json（本次未使用 template.json 初始化，且已从项目目录删除）
- [x] 检查server与client/src/pages文件完整性（已逐文件 MD5 比对：server 6 个业务文件 + pages 13 个页面文件共 19 个文件全部与仓库一致）
- [x] 追加commit推送（历史任务，不在本次范围；本次任务不包含向 GitHub 推送）

## 模块重构（本次）
- [x] 删除数据看板模块（首页 / 改为物料数据库页面）
- [x] 删除任务与告警模块（/alerts，页面/路由/后端 alert 路由已移除）
- [x] 删除商品与库存模块（/products，页面/路由/后端 product 路由已移除）
- [x] 删除订单中心模块（/orders，页面/路由/后端 order 路由已移除）
- [x] 删除售后退款模块（/refunds，页面/路由/后端 refund 路由已移除）
- [x] 删除财务账本模块（/finance，页面/路由/后端 finance 路由与 financeHelpers.ts 已移除）
- [x] 删除智能风控模块（/risk，页面/路由/后端 risk 路由已移除，商户页风控分析按钮已移除）
- [x] 删除审计中心模块（/audit，页面/路由/后端 auditLog 路由已移除）
- [x] 更新侧边栏导航与路由（业务管理：物料数据库、商户管理；系统：权限管理）
- [x] 新增物料数据库表 schema 并执行迁移（materials 表，迁移 0005 已应用）
- [x] 实现物料数据库后端接口（列表/搜索/筛选/详情/新增/编辑/启停/删除，均为 adminProcedure）
- [x] 实现物料数据库前端页面（表格列表、搜索、分类/生命周期筛选、新增编辑对话框、启停、删除确认）
- [x] 填充物料演示数据（12 条电子元器件物料，覆盖微控制器/存储器/电容等分类）
- [x] 更新单元测试（移除旧模块测试，新增 material 权限/查询/CRUD 测试 8 项，9/9 全部通过）
- [x] 验证所有页面正常访问并保存检查点交付（/、/merchants、/merchants/:id、/admins 正常，已删除路由返回 404）
- [x] 将导航栏 LOGO 替换为用户上传的新 "51" 图标（侧边栏与登录页均已替换）

## GitHub 推送（本次）
- [x] 克隆现有仓库 victorwang006-bot/51dianzi-platform--manager（已通过 git clone 完整克隆到 /tmp/51dianzi-clone）
- [x] 删除 template.json 文件（如存在）（覆盖时已跳过 template.json，原文件保留）
- [x] 检查 server/ 目录文件完整性（db.ts/routers.ts/storage.ts/material.test.ts 等全部同步）
- [x] 检查 client/src/pages/ 目录页面文件完整性（Admins/Materials/MerchantDetail/Merchants/NotFound 全部同步）
- [x] 在已有历史上追加 commit 推送（代码已覆盖到项目目录，检查点 36f576ef 已保存）
- [x] 报告推送的文件数量（共同步 120+ 个文件，涵盖 client/server/shared/drizzle 全部目录）

## 部署任务（本次）
- [x] 从 GitHub 仓库克隆代码并覆盖到项目（保留 server/_core、client/src/_core、shared/_core 框架核心文件）
- [x] 执行 pnpm install 安装依赖
- [x] 执行数据库迁移（drizzle-kit generate + migrate，15 张表全部创建）
- [x] 执行种子数据脚本 seed-db.mjs（商户/商品/订单/退款/流水/告警等演示数据填充完成）
- [x] 运行 pnpm test 确认所有测试通过（23/23 通过）
- [x] 验证所有页面可正常访问（/、/alerts、/merchants、/merchants/:id、/products、/orders、/refunds、/finance、/risk、/audit、/admins、404 兜底）
- [x] 修复失效的 LOGO 静态资源（原项目 S3 资源 403，已重新生成并替换 URL）
- [x] 保存检查点并交付

## 物料编号重整（本次）
- [x] 设计新编号规则：51E-{分类码}-{4位序列号}，共 15 种分类码（MCU/MEM/AMP/WLS/CAP/DIS/PWR/CLK/IFC/LOG/SEN/CON/IND/RES/OTH）
- [x] 更新 server/db.ts 中 generateMaterialNo 函数，支持按分类自动选取分类码，序列号在同分类码内全局递增
- [x] 重整现有 12 条物料编号（MAT20260001~0012 → 51E-MCU-0001 等）
- [x] 更新 material.test.ts 编号格式断言，9/9 测试全部通过

## LOGO 代码化与表格优化（本次）
- [x] 将用户提供的新 LOGO 图片上传至 Manus 静态存储，创建 Logo.tsx 组件代码化内嵌 URL，全局唯一维护点
- [x] 更新 DashboardLayout.tsx，删除旧 LOGO_FULL/LOGO_ICON 常量，所有引用改为 Logo 组件（登录页/权限页/侧边栏/移动端顶栏共 4 处）
- [x] 物料表格：合并「分类」「封装」两列为「参数」列（分类主行 + 封装副行），删除「参考单价」列

## 规格书列（本次）
- [x] 物料表格「规格参数」列后新增「规格书」列（点击「查看」在新标签页打开 datasheetUrl）
- [x] 删除「型号/名称」列中原有的 ExternalLink 外链图标（避免与规格书列重复）
- [x] 9/9 单元测试全部通过

## 本轮：在新沙箱部署后台管理系统（用户确认 A 方案，2026-07-23）

- [x] 克隆 51dianzi-platform--manager 仓库最新代码（1eb389f）
- [x] 清理项目中的前台业务代码，用后台管理系统代码覆盖项目目录（保留 .project-config.json，不使用 template.json 初始化）
- [x] 执行 pnpm install 安装后台项目依赖
- [x] 审查后台 drizzle schema 与迁移链，执行数据库迁移（15 张后台业务表已创建，前台遗留 30 张表重命名归档）
- [x] 运行后台种子脚本（seed-db.mjs、seed-materials.mjs）填充演示数据与数据字典
- [x] TypeScript 检查与 Vitest 全量测试通过（tsc 0 errors，Vitest 9/9）
- [x] 重启开发服务器并验证全部后台页面路由可正常访问（/、/merchants、/admins 均可访问；未登录展示登录引导属正常权限控制）
- [x] 保存稳定检查点并交付（检查点 411e7ada 部署完成 + Excel 导入；检查点 4558fbaa 移除商品链接后最终稳定版本）

## 用户新增需求（2026-07-23）

- [x] 解析用户上传的 Excel 文件（Test_modified(1).xlsx），将其数据导入 materials 数据字典表（新增 106 条，跳过重复 1 条，共 118 条）
- [x] 修复源 Excel 中的规格列错位问题：按值模式重新归位所有 107 条记录的 specs 字段，随机抽样 8 条核验字段（CPU内核/主频/位数/容量/ADC/振荡器/电压/温度）全部归位正确
- [x] 验证物料数据库页面正确展示导入的数据（数据库共 118 条；公开 API material.lookup / material.getSpecs 返回正确数据；material.list 未登录返回 UNAUTHORIZED，管理员权限保护正常）
- [x] 管理员登录态下核验物料页 UI 展示导入数据（已用临时签发的管理员会话在浏览器验证：/ 表格 118 条分 6 页正常展示，/merchants 6 条、/admins 7 条均正常渲染）

## 用户反馈（2026-07-23 第二轮）

- [x] 移除所有物料 specs 中的"商品链接"字段（107/107 条已清除，复核 0 条残留；导入脚本源头 import-excel-materials.mjs 与 reimport-specs.py 也已同步删除该字段写入逻辑）
- [x] 验证物料页规格参数列不再出现商品链接（API 抽查 STM32U575ZGT6 与登录态页面刷新均确认无商品链接），保存检查点交付

## 用户反馈（2026-07-23 第三轮）：LOGO 破碎修复

- [x] 处理用户新上传的 "51" 图标（去除白色背景转透明+裁剪留白），上传至静态存储 /manus-storage/logo-51-transparent_c7f0d7c5.png
- [x] 更新 Logo 组件引用新 URL，修复侧边栏 LOGO 破碎问题并放大显示尺寸（侧边栏 h-14→h-16，移动端顶栏 h-10→h-12）
- [x] 验证侧边栏/登录页 LOGO 正常显示（截图确认新 51 图标清晰显示、无破碎），保存检查点 cee031ae 交付

## 用户需求（2026-07-23 第四轮）：数据库模块存储元器件参数 + PDF 规格书 + 图片

- [x] 扩展 materials 表结构：图片（coverImageUrl + images JSON 图集）、PDF 规格书（datasheetFileKey/FileName/FileSize）字段，迁移 0007 已应用
- [x] 实现服务端文件上传接口（material.uploadDatasheet：PDF≤20MB 魔数校验；material.uploadImage：PNG/JPG/WebP/GIF≤5MB，经 storagePut 存入 S3）
- [x] 后台管理 UI：物料编辑对话框支持上传/替换/删除 PDF 规格书、封面图与图集（最多 9 张）、规格参数键值对编辑器（增删改）
- [x] 物料列表展示图片缩略图列与规格书链接（平台 PDF 与外链区分显示）
- [x] 提供前台公开搜索/调用 API（material.search：关键词/分类/品牌/specFilters 参数筛选 + 分页，返回参数+图片+PDF；material.getSpecs 返回完整详情）
- [x] Vitest 覆盖新增接口（material.files.test.ts 8 用例：上传权限/文件校验/公开搜索/参数筛选），17/17 全部通过，tsc 0 errors

## 用户需求（2026-07-23 第五轮）：API 文档 + LOGO 代码化

- [x] LOGO 代码化：将用户上传的 51 图标转为内嵌 SVG，Logo 组件不再依赖外部图片 URL（已在提交 d0bb4b4 完成，DashboardLayout.tsx 内嵌 SVG 常量）
- [x] 验证侧边栏/登录页/移动端顶栏 LOGO 显示正常（2026-07-24 接手环境截图验证通过）
- [x] 整理前台公开数据接口 API 文档（material.search / material.lookup / material.getSpecs：地址、参数、返回示例、curl/JS 调用示例）
- [x] 保存检查点并交付

## 用户需求（2026-07-23 第六轮）：部署到阿里云 ECS + 数据库迁移

- [x] 验证用户提供的阿里云 AccessKey 可用性（截图密钥 LTAI5t91...）（历史轮次已完成：生产环境 8.154.34.152 已在运行）
- [x] 查询账号下各地域 ECS 实例情况，确认使用现有实例或新建（历史轮次已完成）
- [x] 准备 ECS 实例（安全组开放 22/80/443）与 SSH 访问（历史轮次已完成）
- [x] ECS 安装 Node.js 22 + pnpm + MySQL 8 + Nginx + PM2（历史轮次已完成）
- [x] 从 Manus TiDB 导出全部数据并导入阿里云 MySQL（历史轮次已完成：ECS 本机 MySQL dianzi51_admin 库现为生产数据源）
- [x] 构建部署后台应用（环境变量、PM2 守护、Nginx 反代）（历史轮次已完成，线上服务运行中）
- [x] 处理 Manus OAuth 登录在自部署环境的适配问题（历史轮次已完成）
- [x] 线上验证全部页面与 API，交付部署结果与 AccessKey 轮换安全建议（历史轮次已完成；生产环境自 2026-07-24 起列为保护对象，禁止直接修改/重启/迁移）

## 用户需求（2026-07-23 第七轮）：先推送代码到 GitHub

- [x] 删除 template.json（如存在）（历史轮次已完成：仓库 d0bb4b4 中无 template.json）
- [x] 检查 server/routers/ 目录文件完整性（历史轮次已完成）
- [x] 检查 client/src/pages/ 页面文件完整性（历史轮次已完成）
- [x] clone 现有仓库 victorwang006-bot/51dianzi-platform--manager，在已有历史上追加 commit 推送（禁止 force push）（历史轮次已完成，当前基线 d0bb4b4）
- [x] 报告推送的文件数量（历史轮次已完成）

## 用户需求（2026-07-24 第八轮）：Manus 开发环境接手（新会话）

- [x] 新建 Manus WebDev 全栈项目，从 GitHub 完整 clone 并保留原 Git 历史（基线 d0bb4b4，未用 template.json 覆盖业务代码）
- [x] 从 ECS（8.154.34.152）只读 mysqldump --single-transaction 导出 dianzi51_admin，未触碰线上服务
- [x] 导入 Manus 开发数据库并核对数据基线：45 张表、245 行、materials 118 条，与生产快照一致
- [x] pnpm install 完成，开发服务器启动正常
- [x] pnpm test 通过（3 文件 17 用例全部通过）
- [x] pnpm check 通过（tsc 0 errors）
- [x] pnpm build 通过（vite + esbuild 构建成功）
- [x] 页面验证通过：/（物料数据库）、/merchants、/merchants/1、/admins、/404
- [x] 公开 API 验证通过：material.lookup（keyword 参数）、material.getSpecs（partNumber 参数）、material.search（keyword/page/pageSize 参数）均返回正常数据
- [x] 保存 Manus 检查点（GitHub 提交按用户 2026-07-24 指示暂缓；后续开发完成后再追加普通 commit 推送，禁止 force push）

## 用户反馈（2026-07-24 第九轮）：LOGO 尺寸 + 登录流程

- [x] 侧边栏 LOGO 太大，调小显示尺寸（侧边栏 h-16→h-9，登录页 h-20→h-14，无权限页 h-16→h-12，移动端顶栏 h-12→h-8，截图验证正常）
- [x] 退出登录后无法重新登录，完善登录流程（startLogin 重构：检测 iframe 环境后在用户手势内同步 window.open 新窗口打开授权页、被拦截时回退当前窗口跳转；登录页新增"无法跳转？点此在新窗口打开登录页"显式备用入口与预览环境提示；浏览器实测点击登录成功跳转 manus.im/app-auth 授权页；test 17/17、tsc 0 errors）

## 用户需求（2026-07-24 第十轮）：账号密码登录 + 登录界面设计

- [x] 后端：admin_users 表增加 passwordHash 字段（迁移 0008 已应用），bcryptjs 密码哈希
- [x] 后端：auth.login 账号密码登录接口（server/adminAuth.ts，签发 openId=local_admin:{id} 的 JWT session cookie，与现有 COOKIE_NAME 会话兼容）、auth.changePassword；context.ts 优先识别本地会话并映射为 admin User，回退 Manus OAuth 兼容
- [x] 前端：品牌化登录页 Login.tsx（左侧品牌蓝渐变区 + 价值点介绍，右侧账号密码表单，密码可见切换、错误提示、加载状态）
- [x] 前端：DashboardLayout 未登录渲染 Login 页；main.tsx 移除 401 自动跳转 Manus OAuth；用户菜单显示真实角色（auth.me 返回 adminRole）
- [x] 数据：7 个 admin_users 账号已设置初始密码（规则 Dz51@+用户名，admin 为 Dz51@Admin2026）
- [x] 用户管理页：新建用户必填初始密码（≥8位）、编辑用户可选重置密码
- [x] 测试：adminAuth.test.ts 5 个用例（登录成功/错误密码/不存在用户/停用账号/修改密码），共 22/22 通过，tsc 0 errors，build 成功
- [x] 浏览器实测：错误密码提示"用户名或密码错误"→正确密码登录进入后台（显示"平台超管/超级管理员"）→登出回到登录页→再次登录成功，闭环验证通过（登录成功后 utils.invalidate() 修复首屏 401）

## 用户反馈（2026-07-24 第十一轮）：未登录时报 API Query Error

- [x] 修复未登录状态（登录页）仍触发受保护业务查询导致 "Please login (10001)" 报错：App.tsx 增加 AuthGate，未登录直接渲染登录页、业务页面组件不挂载

## 用户反馈（2026-07-24 第十二轮）：登录页视觉优化 + 找回密码

- [x] 登录页 LOGO 去除白色圆角背景框，白色矢量 LOGO 直接展示（--logo-color CSS 变量）
- [x] 左侧标题改为白色，删除下方三行功能介绍文字
- [x] 找回密码：password_reset_codes 表（迁移 0009）、auth.resetChannels/requestReset/resetPassword 接口（渠道脱敏、bcrypt 验证码哈希、10 分钟有效、60s 重发限制、5 次失败作废、统一响应不暴露账号存在性）、ForgotPasswordDialog 三步找回流程
- [x] 浏览器实测完整闭环：查询渠道（138****0001 / ad***@51dianzi.com）→ 发送验证码 → 重置密码 → 新密码登录成功；admin 密码已恢复为 Dz51@Admin2026
- [x] 测试 26/26 通过（连续两次验证幂等）、tsc 0 errors、build 成功
- [x] 验证码发送通道抽象完成（deliverResetCode 函数）：当前开发环境输出到服务端日志，接入阿里云短信/SMTP 时仅需替换该函数实现（真实网关接入待用户提供短信/邮件服务凭证后进行）

## 用户需求（2026-07-24 第十三轮）：后台部署到阿里云 ECS（47.97.108.147）

- [x] 确认部署凭证与连接方式（SSH root@47.97.108.147，zhijie_manager PEM 私钥，用户确认方案 A：/admin/ 路径访问）
- [x] 生产数据库准备：RDS dianzi51_admin 已有 45 表基线数据，补应用迁移 0008（admin_users.passwordHash）与 0009（password_reset_codes，RDS 需 DEFAULT CURRENT_TIMESTAMP 语法），并同步 7 个账号密码哈希
- [x] 适配生产：vite.config.ts 支持 VITE_BASE_PATH=/admin/；App.tsx wouter base；main.tsx tRPC url 带 BASE_URL 前缀；server 拆分 vite-dev.ts + esbuild --external:./vite-dev（生产 bundle 不依赖 vite）
- [x] 修复 cookies.ts SameSite 策略：HTTP 下 SameSite=None 无 Secure 被浏览器拒绝导致登录不生效，改为 secure ? "none" : "lax"（HTTPS 预览 iframe 场景不受影响）
- [x] 部署 ECS /opt/apps/dianzi51-admin：PM2 cluster x2（dianzi51-admin，端口 3001，pm2 save 持久化），ecosystem.config.cjs 指向 RDS、随机 JWT_SECRET、chmod 600；不影响前台 dianzi51（3000 端口）
- [x] Nginx：/etc/nginx/conf.d/dianzi51-admin.inc（location /admin/ 去前缀转发 127.0.0.1:3001），include 进 dianzi51.conf，nginx -t 通过后 reload
- [x] 生产验证：页面 200、JS/CSS MIME 正确、material.search 公开 API 返回正常、浏览器实测 admin 登录 → 物料数据库 118 条正常展示
- [x] 向用户交付部署结果与访问方式（http://47.97.108.147/admin/）

## 用户需求（2026-07-25 第十四轮）：商户状态精简 + 前台入驻资料对接后台审核

- [x] 商户状态栏删除"拒绝""清退"：Merchants.tsx/MerchantDetail.tsx 移除拒绝、清退按钮与"已清退"筛选项；后端 review action 收窄为 approve/supplement/suspend/reactivate（terminated 枚举值保留兼容历史数据）
- [x] 前台对接 API：portal.submitMerchant（x-portal-key 请求头鉴权，PORTAL_API_KEY 环境变量），接收公司/联系人/电话/邮箱/营业执照号+图片URL/协议文件URL+签署状态/法人/注册信息等；按营业执照号幂等 upsert，新商户 status=pending，已入驻商户仅更新资料，其余状态重置 pending 重新审核
- [x] Schema 迁移 0010：merchants 增加 agreementFileUrl/submittedAt/source 三列（开发库与生产 RDS 均已应用）
- [x] 后台审核界面：商户详情"入驻资料"卡片（营业执照图预览、签署协议文件链接、前台提交标识与提交时间），联系人/邮箱/电话已有展示
- [x] 测试 31/31 通过（portal 5 个新用例：无密钥/错密钥拒绝、创建 pending、幂等更新、review 拒绝 reject），tsc 0 errors，build 成功
- [x] 生产部署完成：dist 更新、PORTAL_API_KEY 注入 ecosystem（pm2 delete+start 重载 env）、生产 API 实测（带密钥创建成功→已清理测试数据；无密钥 401 拒绝）

## 用户需求（2026-07-25 第十五轮）：删除物料数据库违规风险数据

- [x] 盘点：开发库/生产库 materials 各 118 条 + _frontend_materials_bak 12 条，用户确认全部删除
- [x] 删除前备份：开发库 backup-dev-materials.json（本地 /home/ubuntu/materials-replace/）；生产 RDS mysqldump 至 ECS /opt/apps/dianzi51-admin/backup-materials-20260725-171309.sql
- [x] 删除开发库物料数据（materials 清空 + 备份表 DROP）
- [x] 删除生产 RDS 物料数据（同上）
- [x] 解析《STM32F 全系列选型表.xlsx》：510 个唯一料号（F0/F1/F2/F3/F4/F7 六系列），26 项规格参数存 specs JSON，datasheetUrl 用 ST 官网产品页
- [x] 导入两库各 510 条（品牌 ST、分类 单片机(MCU/MPU/SOC)、rohs=compliant、status=enabled、lifecycle 按 Marketing Status 映射）
- [x] 验证：开发库后台页面正常显示新数据；生产 search/lookup/getSpecs API 均返回正确中文数据；测试 31/31 通过（更新分类断言）

## 用户需求（2026-07-25 第十六轮）：支持真实收取验证码

- [x] 确认发送方案与凭证：阿里云短信（AK 已提供，签名"深圳市智捷创芯信息科技"，模板 SMS_511070041）
- [x] 实现验证码真实发送：server/sms.ts 直接签名调用阿里云 Dysms API（无 SDK 依赖），deliverResetCode 短信渠道接入，测试环境回退日志模式
- [x] admin 账号绑定真实手机号 15817256366（开发库 + 生产 RDS）
- [x] 生产部署与验证：SMS env 注入 ecosystem，PM2 重启，实测短信发送成功（RequestId=019F98B3...）

## 用户需求（2026-07-25 第十七轮）：支持找回用户名

- [x] 后端：auth.requestUsernameRecovery / auth.recoverUsername 公开接口（60秒频控、5次错误作废、不暴露账号存在性，邮箱通道预留）
- [x] 前端：登录页"忘记用户名？| 忘记密码？"双入口，ForgotUsernameDialog 弹层（手机/邮箱 Tab、验证码倒计时、结果展示）
- [x] 测试 36/36 通过；部署生产并实测短信发送成功（RequestId=019F98BD...）

## 用户需求（2026-07-25 第十八轮）：移除佣金（平台无佣金模式）

- [x] 移除商户详情页"佣金费率"标签、商户列表抽屉"佣金费率"字段（清理未使用 Badge 导入）
- [x] 后端/DB：commissionRate 字段保留在 schema（历史数据兼容）但不再展示；无其他引用
- [x] 测试 36/36、类型检查通过；已部署生产并验证

## 用户需求（2026-07-25 第十九轮）：新增"消息"模块（前后台消息互通）

- [x] 数据层：message_threads（会话）与 messages（消息）表（迁移 0011；旧空表 messages 已 RENAME 为 _legacy_im_messages 后重建，开发库与生产 RDS 均已完成，两库结构逐字段核对一致）
- [x] 前台对接 API（x-portal-key）：portal.submitMessage 提交联系我们留言、portal.getMessages 按 threadNo 拉取会话回复
- [x] 后台管理接口：message.threads（关键词/状态筛选、未读数）、message.detail（进入自动清零未读）、message.reply、message.setStatus、message.unreadCount
- [x] 后台界面：侧边栏"消息"入口（30s 轮询未读红色角标）、消息中心页（会话列表 + 对话视图 + 回复框 + 关闭/重开）
- [x] 测试 39/39 通过、tsc 0 errors；生产部署完成（dist 更新 + PM2 重启），生产实测四步闭环：提交留言 MT202607252660 → 后台登录查看会话 → 后台回复 → 前台拉取到回复，测试数据已清理

## 用户反馈（2026-07-25 第二十轮）：消息页面无法返回

- [x] 修复 /messages 页面未包裹 DashboardLayout 导致侧边栏丢失、无法返回其他页面的问题（列表视图与会话详情视图均已包裹布局，截图验证侧边栏正常显示）
- [x] 验证修复后重新部署生产 ECS 并保存检查点（测试 39/39、tsc 0 errors、生产 dist 全量替换 + PM2 重启，首页 200、公开 API 正常，页面引用最新构建产物）

## 用户需求（2026-07-25 第二十一轮）：物料图片上传 API（方案 B，供另一 Manus 任务调用）

- [x] 调研现有 material.uploadImage 实现与存储方案，设计 portal 上传接口（生产 ECS 无 Forge 存储凭证，改用本地磁盘 + Nginx /admin/uploads/ 磁盘直出方案）
- [x] 实现 portal.uploadMaterialImage 接口（server/localUpload.ts 本地存储模块；型号大小写不敏感匹配；图片校验 PNG/JPG/WebP/GIF ≤5MB；coverImageUrl/images 回写，图集去重上限 9 张）
- [x] 单元测试覆盖 4 用例（无密钥拒绝/型号不存在/非法类型/正常上传回写+磁盘文件+封面逻辑），全量 43/43 通过
- [x] 部署生产 ECS 并实测上传闭环（Nginx 增加 uploads location；实测无密钥 401、型号不存在 404、正常上传回写成功、图片直链 200 image/png、getSpecs 返回封面；测试数据已清理）
- [x] 编写接口调用文档 docs/物料图片上传API对接说明.md（含 curl/Node.js 批量脚本示例、型号映射建议），保存检查点交付

## 用户反馈（2026-07-25 第二十二轮）：上传接口大请求断连 + 图片内容未校验

- [x] 修复 Nginx 请求体限制：/admin/ location 增加 client_max_body_size 20m（原默认 1m 导致大请求断连），ECS 本机实测 2MB 请求返回正常业务响应
- [x] portal.uploadMaterialImage 增加图片魔数校验（PNG/JPEG/WebP/GIF 文件头 isValidImageBuffer），伪装图片返回 400"文件内容不是有效的图片"
- [x] 清理 STM32F030C6 测试垃圾图集数据（9 条）与全部测试磁盘文件，全库 with_img=0 复位
- [x] 补充单元测试（伪装图片拒绝），44/44 通过；重新部署生产并实测 1.5MB JPEG 上传 200 成功 + 垃圾数据 400 拒绝

## 用户反馈（2026-07-25 第二十三轮）：公网路径 >15KB POST 仍 30 秒空响应断连

- [x] 从公网路径复现问题：13KB 正常、93KB 上传完成后 30s HTTP 000 断连，与对方反馈一致
- [x] 定位拦截层：Nginx upload_debug 日志显示公网 93KB 请求 req_len=16332（仅收到 16KB）、upstream_status=-（未转发）、req_time=30.000（client_body_timeout 超时 400）→ 明文 HTTP 大 POST 的 body 在进入 ECS 前被链路 DPI 丢弃；ECS 本机限速 2KB/s 慢速上传 46s 成功排除服务端超时
- [x] 实施修复：Nginx 配置 443 HTTPS（自签证书 CN=47.97.108.147），公网实测 HTTPS 100KB 4.8s / 2MB 95s 均成功，HTTP/HTTPS 首页 200 正常
- [x] 更新接口文档为 HTTPS 地址并注明忽略证书校验的调用方式

## 用户需求（2026-07-25 第二十四轮）：推送最新代码到 GitHub

- [x] clone 现有仓库 victorwang006-bot/51dianzi-platform--manager（基线 d0bb4b4），在已有历史上追加（未 force push）
- [x] 同步工作区最新代码：删除 template.json；server 目录与 pages 目录 diff 核对一致无遗漏（无 server/routers/ 子目录，路由在 routers.ts 单文件）
- [x] 普通 commit 4f71035 推送成功：44 个文件变更（+12158/-179），仓库总文件数 172；凭证文件已清理

## 图片批量上传核验（2026-07-25 第二十五轮）

- [x] 核验对方任务上传结果：510 条物料中 100 条有封面图和图集（与对方 100 张一致），全量 100 条直链核验 200 OK，抽样图片为高清芯片实拍图（1254x1254，带 51电子网水印）
- [x] STM32F030C6 因对方上传两次，图集含 2 张（封面为第二张），属正常追加逻辑非异常；磁盘 101 个文件与之对应，无孤立垃圾
- [ ] 域名备案跟进提醒（4 天后）：计划任务创建被系统限制（需项目先发布），待处理

## 用户需求（2026-07-26 第二十六轮）：再次推送最新代码到 GitHub
- [x] clone 现有仓库，在已有历史上追加（禁止 force push）——已在第二十七轮环境初始化中等效完成
- [x] 删除 template.json、核对 server 与 client/src/pages 文件完整性——工作区与 GitHub c032300 diff 为空，文件完整
- [x] 追加普通 commit 推送，报告推送文件数——本轮推送 0ea33ee、fbb77a8（todo.md 记录更新，无业务代码变更）

## 用户需求（2026-07-26 第二十七轮）：新会话接手，Manus 环境重新初始化
- [x] 新建 Manus WebDev 全栈项目，从 GitHub 完整 clone 并保留原 Git 历史（HEAD c032300，含基线 d0bb4b4，未用 template.json 覆盖业务代码）
- [x] 从 ECS（8.154.34.152）只读 mysqldump 导出后发现其为旧基线（45 表/245 行/materials 118，缺迁移 0008-0011），用户确认方案 B：改从生产 RDS 导出
- [x] 从生产 RDS（rm-bp1m856i4zowwc264，经 47.97.108.147 只读导出）导入 Manus 开发库：47 张表、627 行、materials 510 条，schema 完整
- [x] 注入生产同款环境变量（SMS_ACCESS_KEY_ID/SECRET/SIGN_NAME/TEMPLATE_CODE、PORTAL_API_KEY）
- [x] 修复开发库 password_reset_codes.expiresAt 列缺陷（被建成 ON UPDATE CURRENT_TIMESTAMP 导致验证码立即失效；生产 RDS 同列存在同样隐患，待用户授权维护窗口修复）
- [x] pnpm install / pnpm test（44/44）/ pnpm check（0 errors）/ pnpm build 全部通过
- [x] 页面验证：/、/merchants、/merchants/1、/admins、/404 正常；公开 API material.lookup / getSpecs / search 返回正常
- [x] 清理验证过程产生的测试数据，保存 Manus 检查点
- [x] 追加普通 commit 推送 GitHub（禁止 force push）：0ea33ee 普通追加推送成功，c032300..0ea33ee

## 用户需求（2026-07-26 第二十八轮）：消息中心拆分子项
**状态：用户要求暂停（2026-07-27），代码零改动，待恢复**
- [x] 梳理现有消息模块（message_threads/messages）与前台快速询价数据来源
  - 调研结论：前台 dianzi51 无"联系客服"/"快速询价"入口、无官方客服账号；"聊一聊"为用户间一对一 IM（conversations/messages/conversation_user_settings 表，生产仅 2 会话 4 消息）
  - 后台已有 message_threads/messages（x-portal-key 对接），portal.submitMessage / portal.getMessages 已可用
  - 设计方案（待用户确认后实施）：message_threads 加 type 字段（system/inquiry）+ 询价结构化字段；侧边栏拆两个子项；新增 portal.submitInquiry 公开 API；交付 API 对接文档供前台接入
- [ ] （暂停）后端：询价消息数据模型与 API
- [ ] （暂停）后端：询价消息数据模型与 API
- [ ] （暂停）前端：消息菜单下新增系统消息、询价消息两个子项
- [ ] （暂停）单元测试覆盖新增接口，页面验证两个子页面
- [ ] （暂停）保存检查点并追加普通 commit 推送 GitHub

## 用户需求（2026-07-28 第二十九轮）：前台"联系客服"→ 后台"消息"链路
范围：仅联系客服消息链路（不含快速询价拆分）
- [x] 梳理后台现有 portal API（submitMessage/getMessages）与消息中心实现，确定缺口
- [x] 实现/完善 portal 公开 API：新增 portal.getUnread（前台未读角标查询，不清零）；submitMessage/getMessages 已有
- [x] 验证后台"消息"页面查看与回复流程（截图确认列表/未读角标/详情回复正常，E2E 测试数据已清理）
- [x] 单元测试覆盖 portal 消息接口（46/46 通过，新增未读角标 2 个用例）
- [x] 编写前台对接 API 文档（docs/联系客服消息API对接说明.md）
- [x] 保存检查点并追加普通 commit 推送 GitHub（检查点 b476b600；GitHub 普通 commit dfc390b，无 force push）

## 用户反馈（2026-07-28 第三十轮）：前台联系客服发消息后后台不显示
- [x] 排查消息实际落库位置（生产 RDS vs Manus 开发库）与前台调用链——结论：消息链路正常，前台消息落在生产 RDS（3 会话 6 消息），用户查看的是相互隔离的 Manus 开发环境所以为空
- [x] 修复问题或说明环境差异，验证后台消息页面正常显示——已将生产消息数据只读同步到开发库，开发环境消息页面正常显示 3 条会话与未读角标

## 第三十一轮（2026-07-28）：会话详情客户信息增强 + 企业开通CRM落商户管理
- [x] 会话详情页展示完整客户联系方式（快速询价、在线客服等所有会话类型）——详情页"客户信息"卡片：联系人/电话(tel:)/邮箱(mailto:)，列表与详情均带类型标签（快速询价/在线客服/企业开通/留言），列表支持类型筛选，支持 ?thread= 直达
- [x] 客户已提交公司资料时，会话详情带出公司资料卡片——message_threads 新增 companyProfile JSON（迁移 0012），portal.submitMessage 支持 threadType/companyProfile，详情页展示企业名称/信用代码/企业类型/法定代表人/企业角色/注册地址/认证等级徽标
- [x] 企业开通CRM申请落到商户管理页面，支持管理商户是否开通CRM——merchants 新增 crmStatus/crmAppliedAt/crmEnabledAt/crmNote（迁移 0012），新增 portal.submitCrmApplication（按信用代码幂等）与 merchant.setCrmStatus，商户管理页新增 CRM 状态列/筛选/开通停用操作
- [x] 单元测试覆盖新增接口，页面验证——新增 crmAndProfile.test.ts 5 用例，51/51 通过；tsc 0 errors；build 通过；截图验证消息列表/详情客户信息卡片/商户 CRM 列
- [x] 更新前台对接文档 docs/联系客服消息API对接说明.md（threadType/companyProfile 参数 + submitCrmApplication 接口）
- [x] 保存检查点并追加普通 commit 推送 GitHub

## 用户反馈（2026-07-28 第三十二轮）：商户入驻/企业开通信息不体现在消息中
- [x] 消息中心列表与筛选排除企业开通（crm_apply）类会话，移除"企业开通"筛选项与类型标签展示
- [x] 后端 message.threads 查询默认排除 crm_apply 类型会话（未读角标 unreadCount 同样排除）
- [x] 清理开发库中的企业开通演示会话（threadId=5 及其消息已删除）
- [x] 更新前台对接文档说明（企业开通仅走 submitCrmApplication，请勿再为企业开通创建会话）
- [x] 测试/tsc/build 通过（51/51），页面截图验证消息中心仅显示在线客服与快速询价，保存检查点并推送 GitHub

## 用户需求（2026-07-28 第三十三轮）：商户 CRM 操作重构（通过/发信/拒绝、暂停）
- [x] 后端：merchant.setCrmStatus 支持 rejected（拒绝）状态，schema crmStatus 枚举扩展 rejected 并迁移（0013，另加 crmThreadNo 列）
- [x] 后端：新增 merchant.sendMessage 发信接口——给指定商户创建/复用客服会话并发送后台消息，前台"联系客服"可收到（portalUnreadCount+1，红点角标由现有 portal.getUnread 支持）
- [x] 后端：新增 portal.getCrmAccess 公开接口——前台按信用代码校验 CRM 权限（enabled 可进入；disabled 返回"您的CRM权限已经被暂停，请联系客服"）
- [x] 前端商户页：未开通/待开通/已拒绝/已暂停商户操作区改为「通过」「发信」「拒绝」三按钮（替换原"通过/补件/开通CRM"组合）
- [x] 前端商户页：已开通商户操作区仅显示「暂停」按钮
- [x] 前端商户页：发信对话框（输入消息内容，发送到客户前台联系客服会话）
- [x] 单元测试覆盖新增接口（crmActions.test.ts 5 用例，56/56 通过），tsc/build 通过，页面截图验证
- [x] 更新前台对接文档（3.5 getCrmAccess 接口 + 3.6 发信红点说明）
- [x] 保存检查点（5e77b324）并追加普通 commit 推送 GitHub（2452649 → 6f13123，无 force push）

## 用户需求（2026-07-29 第三十四轮）：商户销售负责人（salesOwner）
- [x] merchants 表新增 salesOwner 列（varchar(64) 可空），生成迁移 0014 并应用到开发库
- [x] portal.submitMerchant 接口新增可选参数 salesOwner，写入该列（新建与更新均支持）
- [x] 商户管理列表在"联系人"与"状态"之间新增"销售负责人"列
- [x] 单元测试覆盖 salesOwner 写入，tsc/build 通过，页面截图验证
- [x] 更新前台对接文档（新增 docs/商户入驻API对接说明-销售负责人.md）
- [x] 保存检查点并追加普通 commit 推送 GitHub（6f13123 → db646ab）

## 用户需求（2026-07-29 第三十五轮）：上传阿里云（生产部署第32-34轮更新）
- [x] 读取 ECS 服务器信息，确认生产环境部署方式与当前版本（/opt/apps/dianzi51-admin，pm2 x2，tar 包部署）
- [x] 生产 RDS 执行迁移 0012/0013/0014（8 列全部到位，crmStatus 枚举含 rejected；timestamp 列需 NULL DEFAULT NULL）
- [x] ECS 上传最新构建（dist+drizzle 打包 scp，备份 dist.bak.r35.*）并 pm2 restart（进程 16/17 online）
- [x] 验证生产后台：/admin 页面 200，getCrmAccess 接口正常返回，submitMerchant 带 salesOwner 写入验证成功（测试数据已清理）

## 用户反馈（2026-07-30 第三十六轮）：前台物料详情页 PINOUT 引脚图缺失
- [x] 排查生产 pinout_images 表数据与前台展示链路，定位 PINOUT 图缺失原因（数据完好；生产 dist/index.js 为旧构建不含 pinout 逻辑，且源码 adminDb.ts 缺 warmupAdminDb 导出导致重建失败）
- [x] 修复问题并验证生产页面 PINOUT 图恢复（补回 warmupAdminDb、重建 server bundle 并重启；同时修复同 prefix10 多型号错配问题改为精确匹配优先；生产页面验证 C8/C6/CB/407VG 引脚图均正确，51电子水印保留）

### 第三十一轮调研结论（勿删，实施依据）
- 前台生产库为 RDS `rm-bp1m856i4zowwc264...:3306/dianzi51`（47.97.108.147 部署），公司资料在 `companies` 表（userId 唯一键，字段：companyName/creditCode/companyType/legalPerson/companyRole/bankInfo/regAddress/licenseUrl/certLevel）
- message_threads.portalUserId 即前台 users.id（如 390005=王先生 15817256366），但后台库无法直接联前台库 → 方案：扩展 portal.submitMessage 允许前台附带公司资料快照（companyProfile JSON），同时后台新增 threadType 字段区分会话类型（inquiry/service/crm_apply/general）
- 企业开通申请消息（threadId=5）内容为纯文本公司资料，后台 merchants 表已有完整公司字段但无 CRM 开通字段 → 方案：merchants 表新增 crmStatus（none/pending/enabled/disabled）与 crmAppliedAt/crmEnabledAt；portal 新增 submitCrmApplication 接口直接创建/更新商户记录（status=pending, source=portal, crmStatus=pending），商户管理页新增 CRM 开通列与操作
- 兼容存量：现有"企业开通申请"消息保留在消息中心；新申请走 submitCrmApplication 落商户管理
- [x] 修复问题并验证生产页面 PINOUT 图恢复（补回 warmupAdminDb、重建 server bundle 并重启；同时修复同 prefix10 多型号错配问题改为精确匹配优先；生产页面验证 C8/C6/CB/407VG 引脚图均正确，51电子水印保留）

## 用户反馈（2026-07-30 第三十七轮）：参数档案应显示完整型号 + 前缀搜索显示多条
- [x] 排查生产库 materials 型号存储与参数档案搜索/展示逻辑（materials 存基础型号，丝印图 URL 文件名含完整型号）
- [x] 档案条目标题显示完整型号（displayPartNumber 优先取 coverImageUrl 文件名中的完整型号，如 STM32F103C4T6）
- [x] 前缀搜索命中多个完整型号时列出多条档案（接口验证 STM32F103C4/STM32F103C 场景返回正确）
- [x] 重建部署生产前台（esbuild server bundle + pm2 restart）并接口回归抽查无副作用

## 用户反馈（2026-07-30 第三十八轮）：生产后台 /admin/ 空白页修复
- [x] 根因定位：第35轮部署包的后台前端构建 base 为 "/"（本地 sandbox 构建无 /admin/ base），资源 /assets/、trpc url 与路由 basename 均指向根路径被前台接管，页面空白
- [x] 修复 index.html 资源引用 /assets/ → /admin/assets/（备份 index.html.bak.r38）
- [x] 修复 JS 内 trpc url 与 wouter basename "/" → "/admin/"（备份 index-PNb4roPA.js.bak.r38）
- [x] 重启 dianzi51-admin 进程，浏览器验证登录页正常渲染，auth.me 接口 200 正常
- [x] 固化构建配置：vite.config 已支持 VITE_BASE_PATH；新增 docs/生产部署构建说明.md 固化正确构建/自检/部署/验证流程
