# ECS 线上快照：采购入库改版 + 销售订单改单（2026-11-26，后台）

本目录是已发布到 ECS 的**线上实际文件**及补丁源码。后端/前台部分见仓库 `51dianzi-platform` 的同名目录。

## 与 ECS 的对应关系（哈希见 MANIFEST.sha256，已与线上逐个核对一致）
| 本目录 | ECS 路径 |
|---|---|
| admin/index.js | /opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js（pm2 dianzi51-admin） |
| admin-ui/BusinessWorkbenchPage-v3-20261126-*.js | /opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/assets/，由 index.html 的 importmap 引用 |
| base/BusinessWorkbenchPage-unread-flicker-20261124-*.js | 改版前的原线上页面文件，补丁的输入 |

## 页面文件如何生成
`node frontend-patches/sales/patch_sales_v2.cjs base/<原文件> s.js`，再 `node frontend-patches/inbound/patch_inbound_v2.cjs s.js out.js`，得到 admin-ui 下的文件。补丁只改采购入库和销售订单两个页面模块，模块外字节保持不变。

## 重要说明（如实）
- 线上后台页面是 6MB+ 的整页打包文件，仓库 client 源码落后于线上，**不能**用仓库源码重建；因此采用“原文件 + 补丁脚本”方式。
- 页面可读源码：frontend-patches/inbound/inbound_v2.jsx、frontend-patches/sales/sales_v2.tsx。
- 验证情况：在预发布环境用真实浏览器验证过主要流程；未验证项见 frontend-patches/*/README.md 和 BACKEND_GAPS.md（低权限真实账号、需求转订单、附件上传、Excel 导入等）。
- 下一步：把页面源码并入仓库正式源码并可重建（尚未做）。
