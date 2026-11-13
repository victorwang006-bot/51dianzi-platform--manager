# 询价接待上线记录

## 2026-11-13 12:43 正式上线回执

用户于 12:31:52 明确确认固定版本 `7ceb983487579165`。清单 SHA-256 `afce045c3be44cef99f63c4b5728d3a0df703c975829c1de637b2fef532275a4`。原固定 15 项文件全部核验上线：两 API、11 新资源、两 HTML。两库全预检和私有备份先行（当时主站 1439 条历史询价，后台发布 0 条），14 项追加结构迁移完成，businessDataUpdates=false。

初次匿名 Python-urllib 探针被既有主站 UA 反爬返回裸403，故在 HTML 切换前停止；两个兼容API与已迁移结构保留。以正常浏览器UA验证实际 tRPC：公开来源坏ID400，工厂 mutation GET405、无Cookie无效POST401，后台接待无权限403。严格确认原生SQL显式保存10个工厂字段，不受旧DSL列枚举影响；未修改API字节或已批准操作脚本。使用 `resume-approved-static.py` 持原双锁/freshCAS仅完成原批准两HTML，无再迁移、无再API重载、无权限或消息写测。最终所有15文件hash、31保护文件、其他进程/worker、API原路径/cwd/env核验通过；两站HTTPS新HTML及11资源实际返回200且内容hash匹配。

真实业务边界：已核验的公开型号RM3216-N373所属员工缺询价接待权限，receptionStatus=ready:false，明确“接待待配置”；不自动补授权限或修改已有库存责任。普通实际业务继续，未生成测试工厂询价/消息。未结工厂询价交接仍未完成，不以此次发布勾销此项。

生产证据在私有 `/opt/ops/20261113-inquiry-reception-7ceb983487579165/verified.json`、`migration-result.json`、原备份和失败/续执行历史中；敏感备份不进入Git或公开下载。
