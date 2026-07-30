# 第44轮生产验证记录（2026-07-30）

## 变更内容
新增通用组件 `client/src/components/admin/CollapsibleCard.tsx`（点击标题折叠/展开，带旋转箭头，支持键盘操作与 aria-expanded）。商户详情页四张卡片全部改为 CollapsibleCard：物料管理移至左列顶部且默认展开（defaultOpen），企业工商信息、最近审核备注、联系人信息、结算账户默认折叠。MerchantMaterialPanel 内部由 Card 改为 CollapsibleCard 并保留描述行。

## 生产验证
GitHub 推送 commit c56e622（gh-sync → main）；`VITE_BASE_PATH=/admin/ pnpm build` 后 dist 上传 ECS /opt/apps/dianzi51-admin，pm2 6 进程 online，/admin/ 返回 200。浏览器实测商户 30004（深圳市智捷创芯）：默认物料管理展开、其余三卡折叠；点击"企业工商信息"标题成功展开显示全部字段（含营业执照链接、签署协议、法人信息），再次点击可折叠。测试 67/67 通过。
