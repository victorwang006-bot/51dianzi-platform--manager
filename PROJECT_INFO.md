# 51电子网后台管理系统 (Admin Backend)

51电子网电子元器件交易平台的后台管理系统，为平台运营团队提供商户、商品、订单、财务、风控与审计管理能力。

## 技术栈

- 前端：React 19 + Tailwind CSS 4 + shadcn/ui + wouter + tRPC React Query
- 后端：Express 4 + tRPC 11 + Drizzle ORM (MySQL/TiDB)
- 认证：Manus OAuth（会话Cookie + JWT）
- 测试：Vitest（23项单元测试）

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 数据看板 | / | 核心指标概览、待办与最新告警 |
| 任务与告警 | /alerts | 待办汇总、一键巡检（卡单超时/资质到期） |
| 商户管理 | /merchants | 入驻审核、资质、协议、结算账户 |
| 商户详情 | /merchants/:id | 营业执照、法人、联系人、结算账户 |
| 商品与库存 | /products | 按商户分组展示，审核/上下架/禁售，分组可折叠 |
| 订单中心 | /orders | 列表查询、状态时间线、异常标签、备注/取消 |
| 售后退款 | /refunds | 退款审核、证据查看、执行与追踪 |
| 财务账本 | /finance | 支付流水、服务费统计、结算单生成 |
| 智能风控 | /risk | LLM分析异常订单与可疑商户，生成处置建议 |
| 审计中心 | /audit | 全量操作日志与变更记录 |
| 权限管理 | /admins | RBAC 7角色职责矩阵与管理员账户 |

## 关键实现位置（重要信息编码）

- 数据库Schema：`drizzle/schema.ts`（users, adminUsers, merchants, products, orders, refunds, paymentFlows, settlementBills, alerts, riskAnalyses, auditLogs）
- 后端接口：`server/routers.ts`（tRPC路由：merchant/product/order/refund/finance/alert/risk/audit/admin）
- 数据查询：`server/db.ts` 与 `server/financeHelpers.ts`
- 单元测试：`server/admin.test.ts`、`server/auth.logout.test.ts`
- 全局样式与品牌色：`client/src/index.css`（品牌蓝 #185FA5，背景 #f5f6fa，字体 PingFang SC / Microsoft YaHei）
- 侧边栏布局：`client/src/components/DashboardLayout.tsx`
- 共享UI组件：`client/src/components/admin/shared.tsx`

## 静态资源（外部URL，防丢失备份说明）

LOGO资源存储于Manus WebDev静态资源服务（与项目同生命周期）：
- 透明底图标LOGO：`client/src/components/DashboardLayout.tsx` 中 LOGO_ICON 常量
- 透明底横版LOGO：同文件 LOGO_FULL 常量
- 演示营业执照图片：数据库 merchants.licenseImageUrl 字段

## 环境变量（部署必需，值不入库）

DATABASE_URL, JWT_SECRET, VITE_APP_ID, OAUTH_SERVER_URL, VITE_OAUTH_PORTAL_URL, OWNER_OPEN_ID, OWNER_NAME, BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY, VITE_FRONTEND_FORGE_API_URL, VITE_FRONTEND_FORGE_API_KEY

## 本地开发

```bash
pnpm install
pnpm dev        # 开发服务器
pnpm test       # 运行单元测试
pnpm check      # TypeScript检查
node seed-db.mjs  # 填充演示数据
```
