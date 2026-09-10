# 第43轮生产验证记录（2026-07-30）

> **历史记录说明：** 本文记录的是 2026-07-30 当时的行为。自 2026-09-10 起，下架库存统一使用 `status='offshelf'` 并进入前台“已下架”列表；下文的 `draft` 回流描述仅用于追溯旧版本，不再代表当前实现。

## 变更内容（按用户提供的技术支持方案）
- 下架接口 `platformMaterial.offshelf` 新增必填参数 `reason`（trim 后 1~255 字）
- 下架 SQL：`SET status='draft', publishedAt=NULL, offshelfBy='admin', offshelfReason=?` 仅对 `status='published'` 生效
- 列表 SQL 补充 `i.photos, i.offshelfBy, i.offshelfReason` 与 `JOIN dianzi51.users u`（userName/userPhone）
- 前端 MerchantMaterialPanel：下架对话框必填"下架原因"Textarea（≤255 字）；表格新增"实拍图"（链接查看）与"发布人（含电话）"列；draft 且 offshelfBy=admin 的行显示红色"平台下架：原因"标记
- 测试 67/67 通过（新增空原因/超长原因被拒用例）

## 生产验证
- GitHub 推送 commit 1f21e84（gh-sync → main）；ECS /opt/apps/dianzi51-admin/dist 更新，pm2 重启（6 进程 online）
- 生产 admin 登录凭据已按当轮要求完成重置（凭据不写入仓库）。
- list 接口：available=true, total=464，样例含 userName="供应商-李强"、userPhone、photos 数组（OSS URL）
- offshelf 接口：id=150464 带原因下架成功 → status=draft, publishedAt=NULL, offshelfBy=admin, offshelfReason 写入正确；随后已恢复 published 并清空 offshelf 字段

## 生产环境运维信息
- ECS: root@47.97.108.147，私钥 /tmp/ecs_key.pem（源自项目共享文件 zhijie_ecs_private_key.pem）
- 后台部署目录 /opt/apps/dianzi51-admin（dist + ecosystem.config.cjs，env 含 DATABASE_URL）；pm2 应用名 dianzi51-admin
- 前台库 dianzi51 与后台库 dianzi51_admin 同 RDS 实例同账号，可跨库查询
- 生产构建命令：`VITE_BASE_PATH=/admin/ pnpm build`，产物 tar 上传解压至 dist
