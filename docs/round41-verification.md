# 第41轮生产验证记录（2026-07-30）

## 变更内容
- 移除侧边栏"客户物料管理"独立入口与 /merchant-materials 路由（删除 MerchantMaterials.tsx）
- 新增组件 client/src/components/admin/MerchantMaterialPanel.tsx，嵌入商户详情页
- 展示条件：merchant.crmStatus === "enabled" 且有 businessLicense（统一社会信用代码）
- 关联方式：后台 merchants.businessLicense = 前台 dianzi51.companies.creditCode，JOIN inventories（userId）

## 生产验证结果
- GitHub 推送：commit 69e5d26（gh-sync → main）
- ECS 部署：/opt/apps/dianzi51-admin/dist 更新，pm2 restart 成功（2 实例 online）
- API 验证：auth.login 200；platformMaterial.list 带 creditCode=91440300MA5EXAMPLE2 返回 464 条该企业物料
- 浏览器验证：商户 id=30004（深圳市智捷创芯信息科技有限公司，crmStatus=enabled，信用代码 91440300MAKJT4Q80C）
  详情页正常显示"物料管理"面板；该企业前台无物料（userId=390005，0 条），显示"该商户暂无物料数据"空态，符合预期
- 生产数据说明：拥有 464 条物料的企业（91440300MA5EXAMPLE2 强芯半导体）在后台无对应商户记录，
  故其物料需等该企业入驻并开通 CRM 后才能在商户详情页看到——与"已通过 CRM 的商户"需求一致
