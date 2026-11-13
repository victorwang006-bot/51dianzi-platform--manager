# 接待表情资源补齐（2026-11-13）

## 结果

后台 Vite 在 `vite.config.ts` 明确配置 `root = client`、`publicDir = client/public`。本次仅修改后台 `client/public/chat-stickers`、`client/public/chat-sticker-tabs`，并新增本交付目录；未改 ChatPage、InquiryReception、TODO 或其他 JSX，也没有网络下载、安装、整站构建、SSH 或提交。

从主站现有资源完整复制 **257 个文件，1,826,600 bytes**，全部为新增文件。不同字节冲突 **0**，本地缺失 **0**，SHA-256 不一致 **0**，空文件/HTML/无效图像 **0**。总量小于 20 MB，因此保留完整两棵目录，含现有但当前 catalog 未引用的 `noto-webp`。

| 后台 public 相对目录 | 文件数 | bytes | 说明 |
| --- | ---: | ---: | --- |
| `chat-stickers`（仅直接子文件） | 48 | 717,453 | 小电 32 PNG + 商务新版 8 JPG/8 缩略图 |
| `chat-stickers/noto` | 98 | 574,583 | Noto 96 SVG + Apache 许可证 + NOTICE |
| `chat-stickers/noto-webp` | 96 | 313,286 | 完整保留的已有 WebP 版本，当前 catalog 不引用 |
| `chat-stickers/yayatuan` | 12 | 218,619 | 芽芽团 12 PNG，src/thumb 共用 |
| `chat-sticker-tabs` | 3 | 2,659 | emoji/yayatuan/business 分类 PNG |
| **合计** | **257** | **1,826,600** | |

两个 catalog 的 156 款均覆盖：Noto 96、小电 32、芽芽 12、商务 16。验证了 **156 个 src + 156 个 thumb + 4 个分类图标引用 + 1 个 picker alias**；其中 public URL 去重 **159** 个，Noto 分类图标复用 `noto-grinning.svg`。159 个 public 栅格图用已有 Pillow 完整解码，96 个 SVG 解析 XML 并检查图形元素，2 个许可证/声明为非空文本。

## 清单与增量上传

`manifest.json` 的 `resources[]` 每行含 `sourcePath`、`targetRelative`、`url`、`bytes`、`sha256`、copyStatus 和 catalog 角色。`targetRelative` 是相对后台 Vite public root 的路径，`url` 为站点根绝对路径。父代理可按线上实际缺失只上传相应资源，不需要整站 build；这份结果只验证本地，不宣称线上已经完整。

`conflicts.json` 当前为 `[]`。复制脚本采用独占创建模式，已有不同字节目标不会被覆盖；发生冲突将记录两边哈希和大小，验证返回非零。

商务旧版 8 款的 **16 个 WebP（186,148 bytes）** 是 `index.ts` 中的模块 import，后台嵌入的 `client/src/business/platform/client/src/assets/stickers` 已全部存在且与主站逐字节相同，所以未写入或复制这些源码资产，也不制造无实际引用的 public 镜像。manifest 的 `bundledModuleAssets[]` 和 catalog 引用记录对此单独核验。它们的线上 URL 由 Vite 内容哈希构建生成，**不能从 `received.webp` 等源码文件名推断线上 `/assets/...` URL，也不能把 `/chat-stickers/received.webp` 当作既有 catalog 引用**。若线上缺少这部分旧版资源，需父代理依据实际已部署 bundle 引用另查，不属于本次固定 public 路径的增量复制。

## 验证命令

在后台仓库根目录执行（不 build，不写业务文件）：

```bash
python3 -B deploy/reception-sticker-assets-20261113/verify_sticker_resources.py
python3 -B deploy/reception-sticker-assets-20261113/test_sticker_resources.py
```

第一条默认只读，退出码 0 表示资源覆盖、哈希和格式均通过；可用 `--report /绝对路径/report.json` 保存报告。当前结果另存为 `validation-report.json`。

第二条是 resource-only 测试：实际 manifest/catalog、完整目录覆盖、空/HTML/错误签名拒绝、冲突不覆盖和删除资源后的 missing 检测。写入测试全部发生在一次性临时目录。

如需再次从主站复制缺失文件并重生成清单，可执行：

```bash
python3 -B deploy/reception-sticker-assets-20261113/verify_sticker_resources.py --copy
```

这会重新记录本次 copyStatus；不要为了线上增量上传而覆盖原始首次复制记录。没有 Pillow 的环境仍可做签名与 SVG XML 校验，报告会显示解码数为 0；当前交付环境已有 Pillow，并完成全部栅格图解码，无新增依赖。

## Catalog / fallback 提醒（未改 JSX）

固定 public 引用没有不明确路径，Noto 的 `${id}.svg` 动态路径已按 96 个定义逐一展开核验；`chatStickerPickerIcon` 明确别名到 Noto 分类图标。`noto-webp` 仅为完整目录保留，不能据此声称 JSX 已接入 WebP fallback。

现有 `getChatSticker(stickerId)` 是精确 ID 查找，未知 ID 返回 `null`；旧后台嵌入的 ChatPage 在 `4373–4400` 行将未知表情显示为“表情暂不可用”。其已知 `emoji-*` 直接加载 catalog PNG，未发现 catalog 自身的 unknown-render 路径问题；不过原始 Unicode emoji、URL 字符串或 catalog 外的旧 ID不会自动映射成已知表情，拷贝资源也不能修复此类历史 ID。已知 ID 图像 404 的运行时 `onError` fallback 亦未见于该旧分支。以上仅供负责渲染的父代理判断，不改其他负责人的 JSX。
