# 第46轮需求笔记（2026-07-30）

用户反馈（截图）：商户"深圳市智捷创芯信息科技有限公司"（编号 M202607579444，生产 id=30004）已入驻公司/已开通 CRM，但详情页右上角仍显示"通过 / 补件"审核按钮，状态徽章为"待审核 / 未签署"。要求：已入驻公司不应显示审核按钮。

现状代码逻辑（client/src/pages/MerchantDetail.tsx）：
`(merchant.status === "pending" || merchant.status === "supplement")` 时显示"通过/补件"；`approved` 显示"暂停"；`suspended` 显示"恢复"。未考虑 crmStatus。

修复方向：crmStatus === "enabled"（已开通 CRM，即已入驻）时隐藏"通过/补件"审核按钮。同时排查生产数据：该商户 crmStatus=enabled 但 status=pending 的状态一致性（可能需要将其 status 同步为 approved）。

生产运维信息：ECS root@47.97.108.147，私钥 /tmp/ecs_key.pem；部署目录 /opt/apps/dianzi51-admin；pm2 应用名 dianzi51-admin；构建 `VITE_BASE_PATH=/admin/ pnpm build`；GitHub 推送流程：gh-sync 分支 checkout main 文件后 commit 并 push github gh-sync:main。后台 admin 密码 Admin@2026#51dz。
