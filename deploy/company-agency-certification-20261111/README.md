# 后台代理认证审核承接：2026-11-11

本轮只扩展 merchant 的代理认证适配器/路由及代理tab，不改已上线库存、导航或其他商户tab。新增 `merchant.reviewAgencyCertification` 桥接平台代理认证权威服务，审批或驳回仅 pending，驳回原因必填，版本及requestId幂等；操作人由后台会话生成，不接受浏览器owner/key/operator。

所有五入口保持 `assertMerchantInSalesScope` / `getOwnedMerchantById`，列表用 merchants.read，审核/撤销/原件用 merchants.write。HK专用强身份 `registrationRegion:HK` 与 HK:8位BRN，CN原信用码字段兼容；不删owner约束。manual变更接收主站新记录ID，待审审核独立；私有材料短链按点击发，身份/权限/路由变更关闭窗口并拒绝晚回。

限定6文件40项离线mock/source测试及pnpm check通过；没有真实审核、DB/原件访问或上传。工具只构建主服务本地源码前后态，不碰worker或运行配置。

生产尚未发布：SSH banner前超时，后台真实编译模块未完成新tab绑定，本地后端before摘要也不等原生产产物。必须恢复连接、取得当前后端和MerchantDetail的真实模块、完成精确增量及完整新候选，再与主站schema/服务配套独立确认发布。不可直接全量重建覆盖、不可复用库存候选审批或解除全局冻结。
