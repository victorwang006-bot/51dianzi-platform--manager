# 2026-11-11 后台库存入口整合

本轮源码提交为 `01799f4c3dce0611037901d19ba1734018cf4431`，真实源码前态为 `fdc9da77bb7c1db09a8f8c5e73c419391e5a53eb`。后续工具归档提交不改变应用源码哈希。前台不修改；后台只新增两个内容寻址 JS 模块、一个局部可访问标题 CSS，并切换后台首页的精确 importmap。旧入口 JS、所有旧样式和无关资源保持原字节。

## 实现与验证

顶部改为“库存列表｜渠道库存｜业务工作台｜平台运营｜组织与权限”。库存列表平铺全部已授权可见库存；渠道库存使用原按渠道浏览能力。库存页删除重复标题、全局上传与视图按钮，客户列表保留原录入，客户详情补接同一上传组件与供货设置。历史上传、集中回收站和未关联客户的历史渠道整理收进“更多”，不删底层实体、记录、授权与恢复能力。

直接源码测试：导航 288、库存 357、客户 265，共 910 项通过；全仓 TypeScript 检查退出 0。实际运行叶回放：导航/库存 12、客户 22、上传完成回跳 3，共 37 项通过。发布事务 10 项安全测试通过。候选独立验证了 73 条模块依赖解析、每个变更的完整逆向还原、工厂参数/返回/调用桥接字节和原入口字节保持。

运行回放发现的只读菜单条件已修正：实际库存工厂中权限列表 `y` 不是布尔值，历史整理与已提交源码一致，使用布尔管理资格 `j`。外层导航第三参数也按原函数合同传为 `yo(tab, false, view)`。

这些是隔离合成回放，不是真实浏览器布局、hydration、生产 API 或数据库写入测试。客户工厂的最终字节与通过 22 项测试的实际工厂完整一致；上传组件仅改回跳的 `channels` 为 `materials`，关闭与回执核验其余字节不变。

## 离线工具

脚本的独立工作区路径为 `/home/ubuntu/51-inspection`，只使用该目录中的源码、真实前态和静态基线。复现时按固定发布归档恢复 `runtime-baseline`、源码归档及工具，并使用仓库锁定依赖；不要把工作区或输出目录指向生产。

```sh
node deployment-tools/inventory-customer-patch.mjs
node deployment-tools/verify-inventory-nav-synthetic.mjs
node deployment-tools/build-inventory-candidate.mjs --build
node deployment-tools/verify-inventory-admin.mjs
node deployment-tools/inventory-runtime-factories.mjs --candidate --final
node deployment-tools/verify-inventory-runtime.mjs
python3 deployment-tools/test-inventory-publisher.py
```

`--build` 要求候选输出目录尚无 manifest；不要覆盖已获审批的候选。初步准备器与检查摘录不等于完整候选，不能据此上线。

## 发布边界

`prepare-inventory-release.py` 要求源码已提交、最终 runtime-test 和独立 verification 通过，然后绑定资源、源码、测试、真实静态前态与发布程序哈希。`publish-inventory-navigation.py` 默认只读核验；只有 `--apply` 且存在用户对精确发布清单的新审批才允许发布。

沿用现有双锁、现网版本 CAS、七个受保护文件和全部进程快照。不开数据库、不改 API、Nginx、PM2、环境或全局冻结；前台首页列为受保护文件。失败会按 CAS 回滚首页，可能保留未引用的新不可变资源。生产页面尚未切换，须在固定候选确认后单独执行。
