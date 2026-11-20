# Null-fields 前端增量独立审查

**结论：LOCAL_FIX_PASS / NOT_DEPLOYED。无实质代码问题；不批准发布。**

本次仅对旧冻结包 `5d5611fe…` 到新包 `91863042689520a9f8b0cdf5f88d0575a96416f32b43482cb88044a589547c7e` 的前端增量及本地重建证据作只读审查。新 source manifest SHA-256 为 `7d5f541f19e97064f9235ccaf9c5f64819030040e69c3fb96a3095d79572c166`。旧包是修复前基线，不可作为发布候选。

独立重算确认：19 个 source 中仅 Search 变化，且把 `detailAttributes` 与 base-specs 两段展示表达式复原后，整个源码逐字节等于旧文件；6 个 test 中仅 detail test 新增两项。空白公共属性与未知数量不再伪造占位，已知零库存仍显示。整个编译 leaf 同样仅两段展示表达式变化；其余三个 JS 与 HTML 仅内容哈希链引用迁移，logo 与源图字节相同。4JS + 1WebP 的真实 SHA、大小、文件集合均匹配 manifest。

独立 AST 重提取全 Card 八个事件回调的属性名、完整表达式字节（包含 price-tier onClick），新旧完全相同且均单份；finance 声明字节与九个 merchant 完整函数不变。对现有生产基线做一次独立正向及逆向字节验证，leaf 12 / wrapper 1 / search 1 / detail 35 / HTML 20 的原位置、范围、before 字节及分类均未扩大。

工具增量仅 snapshot 目录/Search pin、builder 的 `entry` 局部与 Card 专属 option、精准 null-filter 适配。filter 必须是精确 canonical 表达式、父节点 `.filter` 唯一实参、显式允许且恰好 1 次；默认 0。旧 map/IIFE 判定保持原字节。已读 supplied 6 项正负例，另作 11 项隔离适配器检查（1 正、10 负）全部符合预期。这是本地渲染语法适配，不是生产权限控制审计。

已核对当前 manifest/source/tools 绑定的 `verify-nullfields.json`、`readonly-nullfields.json`：full rebuild parity、原 10 项负控、现有 VM cases 均通过；只读 runner 报告零文件写尝试、零网络尝试。本审查不再重跑完整构建。已绑定 supplied 6 suites / 148 pass 与 warning-only tsc 日志；tsc exit 0 是父任务报告，日志本身不是独立退出码收据。

**限制：**未运行或继承为本包批准任何浏览器结果；未进行 capture/apply、Git、网络、SSH/ECS/API/DB、server 或 runtimepolicy 审计；未重做 774 source / 3187 AST edges / transitive closure 等旧全量审查。旧独立审查仅为未变边界的继承依据，不继承生产批准。runtimepolicy 尚未完成，`releaseApproved=false`、`deployable=false`、`captureApplyAuthorized=false`。

详细结论见 [report.json](report.json)，独立重算见 [independent-evidence.json](independent-evidence.json)，精准适配器检查见 [guard-evidence.json](guard-evidence.json)，输入与产物指纹见 [filepinproof.json](filepinproof.json)。所有审查写入仅在本目录。
