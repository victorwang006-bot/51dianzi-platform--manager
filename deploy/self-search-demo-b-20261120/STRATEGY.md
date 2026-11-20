# 方案 B：原生前端 seed-only 最小增量构建策略

状态：`NOT_APPROVED`。仅本地分析；若日后通过所有门禁生成候选，状态只能为 `BUILT_NOT_DEPLOYED`，不含 fresh 生产批准。

## 授权与硬边界

只写本目录 `/home/ubuntu/work/self-row-redesign/native-builder/`。不修改 platform 源码、组件测试或 Git；不连接服务器、不下载远端文件、不 capture/stage/write/reload、不访问生产浏览器，不执行全站构建或导入 API/DB 入口。其他 agent 正在修改的两个工作树组件不能充当 before；before 必须用 `git show HEAD:<path>` 获取并绑定 HEAD commit。after 必须为显式 `--inputSourceDir` 与逐文件 SHA 清单的不可变快照，不可偷偷读取活动工作树。

用户批准的是无自营视觉徽标的搜索列表方案 B；布局、库存、参数和采购依批准静态稿，金融与行为逻辑不变。批准静态稿并不等于批准未来生产字节。

## 首选路线：叶内 AST 定点替换

从确切生产 leaf bytes 解析 `createOfficialMaterialUIFactory(live)` 内 `__MaterialUI` IIFE。定位并证明 `OfficialSearchCard` 与 `createOfficialMaterialResources` 内部资源呈现函数的源到 compiled 绑定。优先只替换最终 JSX return 对应 expression 和两个样式常量 initializer，资源函数允许新增可选 search layout 参数及必要的纯呈现派生值；默认不传参数的资源场景须保持原结果。购物车/收藏/资料点击等既有 callback 逐 AST/逐字保持。

绑定不依赖模糊字符串全叶替换。应先从 HEAD 源编译 isolated before，再使用作用域 symbol / free identifier 双射及 minify 等价证明定位 compiled target。每个匹配必须唯一；源哈希、compiled parity 或作用域映射缺失即拒绝。不以样式锚点或中文文案单独作为可信绑定。金融 helper、hook、guest/auth、收藏、CardImage、Lightbox、singletons、非目标声明、factory 宿主桥与 guest import 都须逐字 exact。

从 before/after AST 比较，允许范围外源 bytes、statement 与 callback 不变。目标重编译不得 bundle runtime/import 或新增 provider/client/singleton；编译的所有 free identifiers 必须映射到生产同作用域已有符号，新增仅限局部呈现变量与批准的可选参数。内外同名标识符须以 checker symbol 区分，不允许全局名字替换。

## 输出 ABI 与封包

`createOfficialMaterialUIFactory(live)` 的导出名称、参数、返回 `__MaterialUI` ABI 逐字保留；同一 host React、jsx runtime、trpc、useQuery/useQueryClient、useAuth、Link、Dialog、MallLoginDialog 桥保持原有 bytes。guest 的唯一 import 指向已发布 sharedGuest 模块，不能重新编译 guest 或复制私有队列。不得改变原叶中公开导出键。

cart wrapper 只改指向新 leaf 的一个 ImportDeclaration.moduleSpecifier quoted token。privateCart factory 全部 financial bytes 逐字保留。搜索 wrapper 只改指向新 cart wrapper 的一个 moduleSpecifier quoted token；其他 import、函数、transport/options、guest 委托完全不变。保持搜索资产实际原目录（本次为 `/assets/` 根目录），不能把相对 imports 意外迁移到其他目录。

HTML 仅由本地已发布 postimage `/home/ubuntu/work/resume-frontend/r2-package/postimages/main-html.bin` 派生，不能由 preimage 或 client/index.html 派生。AST 识别 importmap JSON：imports 和每个 scope 内旧 logical alias **key 保留**，只改 physical target value；scopes 的旧 physical module URL key 应迁移到新 physical module URL，scope 内映射内容保持不变。现存 preload/src/href 只允许 exact quoted 引用迁移。不能全局 replace URL，因为逻辑 alias key 与 physical value 含义不同。每个改动记录 byte offset、before/after Base64，正向复现和反向还原 SHA 均通过，并单独校验 importmap 解析与碰撞。

## 已校正的种子路径事实

parent 于 2026-11-20 09:57 明确校正先前 nested 提示错误：搜索种子本地位于 `/home/ubuntu/work/resume-frontend/r2-package/assets/search-official-material-fast-136d44f0e6f8fcf28e02f526c78f8af63cb830b4af6a1350718547d54225ee35.js`，HTML 中准确物理 URL 也在 `/assets/` 根目录。此文件及其新候选应保持根目录，不对搜索使用 nested 门禁。只有 sharedGuest 与 Home 等原 logical/physical alias 属于 20261107-v24 nested。此校正不授权任何服务器访问或下载。

## 全叶重建不是最小路线

旧 build-native.mjs 使用旧 P/B/R 硬编码且 native-entry.tsx 不在 sandbox，不能执行。frontend-manifest.json 只有 entry SHA 与 source list/nativeABI，不足以证明缺失 entry 的准确内容。全叶重建只有在明确源/宿主桥全集、可信 entry bytes、独立 source+minify+parity 证据全部齐备后才可另行批准，不能称其为本次最小增量，也不能采用当前依赖解析从而引入运行时服务器模块。

## 交付门禁

基线验证先用 git HEAD；后续候选要求不可变 after SHA。任何 target/source/compiled parity 不匹配应退出非零，不放宽条件，不输出可被当作生产候选的 HTML/JS。正证明：两个目标呈现输出和批准布局发生变化。反证明：所有非目标叶 bytes、金融 callbacks、宿主桥、guest import、wrapper/search 非 import bytes 和 HTML 非引用 bytes完全相同；未新增 runtime dependency。候选需 server 恢复、安全准入、fresh META 与主 agent 重封后才能进入审批，本目录不做该步骤。

后续本地实测结果见本目录生成的 baseline report 与绑定清单；本文会据实追加结论，不把 manifest 声明当作已完成等价证明。

## 2026-11-20 本地实测结论

基线 HEAD 为 `6589eb2653eb30714845c77f7336ed0cf23e3afb`。生产清单的 13 个非 entry 源文件全部由 `git show HEAD` 取得，SHA 逐一相等。两函数使用 esbuild 0.25.10 isolated bundle/minify（不依赖平台模块解析），仅 JSX 虚拟桥；完整 AST + checker symbol 双射通过：`OfficialSearchCard → ux`（2484 节点），`createOfficialMaterialResources → nx`（1019 节点）。无损展开 object shorthand 只把逻辑属性 key 和 lexical value 明确区分；未放松 token/operation/literal/符号双射等价规则。明确 lucide 原 namespace `ef.Zap/ef.ShoppingCart`，没有 bundle 新 lucide 或 React。

准确 compiled 字符范围：`ux` 完整函数 `[552157,557899)`，`nx` 完整函数 `[535811,538010)`；styles `Mx` initializer `[557906,565194)`，`Pv` initializer `[538035,540327)`。构建不是替换完整函数：最终叶改动严格为两处 final JSX expression、两个样式 initializer、资源 inner 参数的零长度可选 prop 插入，总计 5 处。现存非呈现 declarations、tax 派生值（即使 after 源不再使用，也在 seed 内保留）、tierRow、hook/useEffect、financial/helper bytes 都不重编。

已实现 `build-native-demo-b.mjs` 与真正只读的 `verify-native-demo-b.mjs`。基线模式先通过；after 仅接受显式 immutable source dir、两文件 SHA 清单及清单自身 SHA，拒绝活动 workingtree 输入。旧工程 smoke 快照的编译计划通过：card 原有 8 个 compiled callback、资源原有 4 个 callback 全部复制原始精确 bytes；default 480 个场景（省略/显式 default）与 search 240 个场景的 normalized compiled host DOM/hook callback 顺序通过。该测试未实例化 React/TRPC/guest，也不是 browser 几何或生产验证。

parent 于 10:04 要求修正主次按钮 CSS 并暂停最终 after 封印/重建。旧 smoke 快照仅为工程自测，不是最终 after 源，未输出任何 candidate JS/HTML。最终 sourceSha 必须以 parent 完成 CSS/断言校正后的文件为准。当前交付状态仍为 `NOT_APPROVED`；脚本最终可产生 `BUILT_NOT_DEPLOYED`，但绝不 fresh-approved。

## 主任务10:17最终本地封印

前述10:04 CSS hold已结束，仅本地：最终Search SHA `d7d49321b0d45b9322464bc5af086e864fd282e6afe1020c05f76798d728df9a`、Resources SHA `031f1a991aab21105bd617e46c033dd8eae86c6faf935201b293ed23499cd3aa`。源清单SHA `8b297ce41027a1c907ddd253134a1c326b5eacd9be1d85242d94b579150c74a5`，输入为本目录 `input-final_b`。`candidate-final-b/manifest.json`及3JS/index.html已实际生成；旧smoke-input不可使用。

最终只读verifier实际退出0：完整重算一致、5叶呈现范围/两个单一import/17HTML引用补丁正反通过，非目标字节及财务callback冻结，默认480/搜索240规范化host场景通过，金融AST修改/未分类HTML引用负测拒绝。最终输出见 `verify-final.json`，不是浏览器几何验证。状态仍为 `BUILT_NOT_DEPLOYED`、`NOT_APPROVED`、`deployable:false`，没有ECS写、窗口或审批。

为使正常保存新源码后仍能复现，主任务把before读取从漂移的git HEAD改为固定历史Git对象 `6589eb2653eb30714845c77f7336ed0cf23e3afb`：`git show <该固定SHA>:<path>`，并校验 `<SHA>^{commit}`存在；13源哈希、生产种子/HTML哈希、作用域/AST与其余门禁保持。快照工具同样校验固定历史对象，不强求活动分支停在旧HEAD。该历史对象不是新生产capture；服务器最终安全交接后仍须fresh核对HTML/immutable/META/全保护并重新审批。
