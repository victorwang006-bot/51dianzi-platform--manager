# 客户上传与库存管理 · 2026-11-19

## 已上线

北京时间 **2026-11-19 22:34:37** 单次原子 apply 完成，真实发布回执 `status=verified`，共享协调窗口已关闭。仅后台静态增量；未上传全量 dist，不删除旧资产，不 reload 进程。

客户表格上传取消逐行排除原因，允许导入正常行，明确显示问题/跳过数量、移除与撤销；保留原行证据、CNY确认、列歧义、多工作表范围、批次/行UUID与未知回执恢复。成功结果停留页面，明确点击“查看物料”后定位真实成功批次。

客户已入库物料使用紧凑行内编辑及单条/当前页所选删除，一次简短确认。复用既有更新和软删除接口，不改变负责人、客户绑定、渠道和原文件。删除独立检查 `canDelete`、原客户/渠道、真实详情 revision，完整校验部分成功回执；未知结果冻结原 UUID/payload，不重复写入。

## 最终指纹

| 项目 | SHA256 |
| --- | --- |
| 原后台 HTML | `60f7adcce23397a9a9333ed9b54546930ed808215dd19d1d6ad8b0fbdfb2aae5` |
| 新后台 HTML | `71aca2bb6483befa1f3a4bf09a8aaf73f619bac3299d9bec9f4ea9d67878efa3` |
| 最终 manifest | `b78f622ad01f430b61df50f7add4812f7ffaa5dcc4712cb2889602b5e16850b4` |
| 独立审核 | `46ff6d86ad4b6612e9dbe9dbfe2011ae3726c31d848a732a9e90124012659043` |
| 真实 fresh capture | `0bee64f65bb31c4a4cd7b8b795e3379eae9a566e50b4f7ce37aa430da950c0cd` |
| 控制器 | `dbde2033e6e30f736349f4cca8083582597b06ca124f55fe796681cae121d775` |
| 闭窗 COORD | `f873c20dadfa9c517b36064c21a39ba10472b6a8832a83633ab4316f5878ee98` |
| 远端 receipt 原字节 | `a07c7630ac7e92981f1824b7725a59d429b2a52b0e0b66f96fe7eb9beb243626` |

新增资源均在 `https://admin.51dianzi.com/assets/`：

- `BusinessWorkbenchPage-upload-manage-99cc4404a021690b.js`，SHA `99cc4404a021690bb308faf04f021df7063e6d6043c1209e700fa5927a314778`。
- `BusinessWorkbenchPage-upload-manage-6dfd25aea7e621cd.js`，SHA `6dfd25aea7e621cde3e883c6c23d78c3b8bc8b8ded86e6bc4a08c0e13cf08f82`。
- `customer-upload-manage-3b83db4061a4088e.css`，SHA `3b83db4061a4088ea88d1a192377024f93b026913c730c41d044c71ea0978ea3`。

`evidence/receipt.json` 是成功 apply 输出的脱敏副本，不冒充远端 receipt 的原始字节；`evidence/final-pins.txt` 记录实际远端哈希。

## 保护与验证

两个当前客户原生工厂各只改 **T6/BatchUploadSession、B3/CustomerSupplyUploadSession、mk/CustomerChannelInventory** 三个 AST span。完整 UTF8 forward/inverse 验证三段外全部原字节，`z3/HistorySession`、`uk`、`bk`、`ok/CustomerParseUpload`、`Z3/CustomerInventoryMore`、legacy tm 和所有其他 factory 均保持。HTML 只替换32+53个完整 quoted URL及增加一条独立 CSS link；新 CSS 全部限定 `.customer-channel-inventory`。

真实回执证明18223个原保护记录中除后台HTML外全部不变；12个在线进程及配置/raw环境指纹不变，`processReloads/apiWrites/databaseWrites/envWrites/frontHtmlWrites=0`。保留两个 API、前台技术参数/搜索任务和已上线只读上传历史，不使用旧 dist 覆盖。

源码全回归378项、兼容修复后5文件217项、只读历史/文件111项均通过；类型检查 exit 0。两原生候选各4完整 mock-only 场景通过，其中直接 instrument 真正 B3，验证已读同 File 不重复提交原件、原 WeakSet 错误品牌被未改动 ok 正确识别。控制器42项、结构14项、freeze7项通过。没有创建生产测试库存或调用真实上传/编辑/删除来验收。

## 修复与暂存过程

首候选独立审核 BLOCK 了错误品牌、已读附件缓存及 CSS 外域三项，未 apply。全部修复后生成新 source pins、原生候选、fresh capture、manifest和独立审核，旧审批未复用。原文件保留同 File Promise、严格存储读回、own snapshot CAS清锁；只有服务器明确未保存且自己的锁确已安全释放才品牌化，未知或外来锁不释放。纯源码 `customerUploadOriginalRetry.ts` 与解析源码同步旧原生语义，native B3绑定既有函数，不复制另一 WeakSet/provider/module。

整包私有传输曾超时，仅影响本任务 stage。随后用已校验私有原候选和小字节差分重建最终文件，逐个完整 SHA 核验；没有差分写生产文件。控制器要求唯一 package 路径，因此旧 partial 包保留到 `package-blocked-v1`，已审核新包移到 canonical package。路径预检拒绝发生在生产切换之前；成功预检后只执行一次 apply。

## 脚本复现边界

`release.py` 只相对上轮更换scope、stage、schema共四个字节span，双原 inode 锁、完整前像/metadata CAS、900秒TTL、durable no-replay、外来窗口和回滚保护均保留；`controller-adaptation.json` 记录双向证明。CAS基于合作方遵守共享 advisory locks，不声称是对非合作写者的kernel CAS。

本 scope 已有成功 receipt，**禁止再 apply**。后续版本必须建立新 scope/stage、重新捕获生产当前实际、生成 fresh OUT 和 source pins，按真实新版 SHA 独立审核，再单次发布。示例构建需使用新文件名，不能覆盖现有冻结证据：

```bash
python3 -B pin-sources.py --confirm-frozen --supply-native-safety-reviewed \
  --retry-native-alias __customerUploadRetry20261119_originalNotSavedAfterRelease \
  --output "$PWD/evidence/source-pins-new.json"
SOURCE_PINS="$PWD/evidence/source-pins-new.json" OUT="$PWD/build-new" node build-native.mjs
UPLOAD_MANAGE_DIR="$PWD/build-new" node test-native.mjs
```

输入基线、私有 capture、候选包、完整原生提取和日志保留在本地忽略目录，不提交生产大文件或密钥。最终闭窗指纹已交接给并行前台任务，要求它重新全量 fresh capture，而非复用本次快照。
