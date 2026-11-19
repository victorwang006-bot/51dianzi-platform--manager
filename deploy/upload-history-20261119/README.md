# 上传历史 · 2026-11-19

## 实施结果

后台“解析历史”已改为只读“上传历史”：文件名称、上传时间、上传人、大小及查看/下载。支持当前账号授权范围内的文件名/上传人搜索、日期过滤和分页。搜索在读取全部游标页后进行，不仅搜索首屏；不扩大原 `mine` / 客户权限。

查看为右侧只读预览，保留原工作表与行号，按100行分页；已有原单元格证据中的格式化文本与公式文字只读展示，不执行公式。存在真实整理结果时提供“整理内容”标签，没有知识点数据源就不制造知识点入口。无预览数据时仍可尝试下载原文件。

单文件使用原私有授权下载接口；批量逐个以原 history/file tuple 读取后，在浏览器打包纯原文件ZIP，重名加序号，不附带任务清单，不公开文件链接。每次最多20份且累计10MiB。原解析状态和未知批次不会阻断只读查看；现有上传核对/导入流程、持久恢复草稿、原文件、库存均不改动。

## 真实上线证据

北京时间2026-11-19 21:09:04完成单次apply，发布回执 `status=verified`，共享协调窗口已关闭。`evidence/receipt.json` 保存真实回执，`evidence/final-pins.txt` 保存远端最终哈希。

| 项目 | 结果 |
| --- | --- |
| 原后台HTML SHA256 | `533bd5cd663536d8e20bad24d1bbfeabc9f2f50b2efd9fa676165c489e989623` |
| 新后台HTML SHA256 | `60f7adcce23397a9a9333ed9b54546930ed808215dd19d1d6ad8b0fbdfb2aae5` |
| Manifest SHA256 | `efcc032057084898347d5095ef0b250a6803373b762d8f262ff6b1d52077f73c` |
| 独立审核 SHA256 | `e216f1e98a224c1965bd78ab439e8c5620f21ddd884ce723568e730153d51557` |
| Controller SHA256 | `79309d87fbe33350eff637a13f6ed7f1a3451fa39505ddaddce2019e091119ac` |
| 闭窗 COORD SHA256 | `b4be72ebad9f14a2eb946f71c3c3005705d3df1acc68fdb4051c0013d3de9b32` |
| 定向源码回归 | 受影响183项 + 未改动上传/文件服务116项通过 |
| 原生候选交互 | 两份模块共8场景通过，真实网络及业务写入为0 |
| 控制器安全回归 | 42项通过 |
| 类型检查 | `tsc --noEmit`通过 |
| 生产保护 | 原18220文件记录中除后台HTML外全部不变；12进程与配置/raw环境指纹不变；processReloads/API/DB/env/frontHTML写入均为0 |

新增资源均在 `https://admin.51dianzi.com/assets/` 下：

- `BusinessWorkbenchPage-upload-history-50b4bb692f995bbf.js`（SHA256 `50b4bb692f995bbf4fdc6d25f1e76240e769f9c115949986ac9472cb12a704d3`）
- `BusinessWorkbenchPage-upload-history-ae2fa10c659cd37b.js`（SHA256 `ae2fa10c659cd37bbdbbe2adbc617d30dc9a783a0f1a4e3a41d6a837f6e2d07c`）
- `customer-upload-history-3cddbfc1c80d3769.css`

## 不与另一任务冲突

已与同项目任务 `4GJ2toNWchKZvE77eLiWZ1` 明确边界。本任务只替换当前线上两份客户工厂内 `z3/HistorySession`、Supply历史按钮和ParseUpload提示的两个字符串。T6、uk、B3及所有其他factory字节不变。后台HTML仅32+53个完整带引号资源引用替换及1条独立CSS链接。CSS仅`.customer-upload-history`范围，不覆盖`.customer-parse-upload`或其他页面。

没有发布全量dist、没有删除旧资产，不改另一任务的主站搜索、技术参数、API/runtime/私有存储。双方沿用既有双锁、COORD和完整字节CAS；任何版本漂移或外来活跃窗口均拒绝发布，而不是覆盖他方成果。

## 工具与恢复原则

`build-native.mjs`进行语义AST定位、宿主ABI校验、完整字节inverse验证和独立fflate zipSync-only IIFE注入；不复制React/tRPC。`freeze-package.py`绑定真实fresh capture、源码/原生测试及完整候选哈希；不会生成虚假审核。`test-native.mjs`禁止真实网络与业务写，`test_release.py`验证锁/CAS/回放和回滚保护。

`release.py`精确复用旧静态控制器，仅更换OWNER、SCOPE、独立stage和capture schema。该任务既有成功receipt禁止再次apply。后续改版必须新建任务stage、重新捕获900秒有效的生产指纹、构建新包并独立审核。任何失败只允许在仍拥有自己的完整HTML前像和协调窗口时回滚自己的后台HTML；绝不回滚另一任务、API或前台。传输超时曾发生在私有暂存步骤，校验已有文件前缀后补传完成，线上apply未重放。

本轮未创建生产测试库存或执行真实物料上传；业务路径依赖既有接口，已以匿名离线回归验证。
