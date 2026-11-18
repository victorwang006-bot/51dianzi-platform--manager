# 普通入驻商户搜索卡片定向恢复

本轮不是整包回滚。只在当前实际 SearchPage 的三个 JSX 节点中，用后端显式 `isSelfOperated === true` 保留当前自营表达式，其余分支恢复已核验旧商户表达式。字段缺失／false 不按供应商名称或管理员身份猜成自营。最新 Official Catalog wrapper、导入、providers、native aliases、原内联 CSS 和其他页面字节保持；不重编整个页面。

## 恢复范围

普通列表恢复原数量栏购物车和右侧聊天／真实 QQ 联系方式，缺价格时不追加灰交易按钮或伪造价格。未税、无现货沿用原询价限制；原数量、阶梯价、聊天与购物车使用既有处理器和权限。普通网格恢复原有价显示、无价聊天及阻止跳转冒泡行为，不套用自营三按钮。

指定真实旧商户资产的右侧购买位置是空 Fragment，没有“立即购买”按钮。不得凭空补造该按钮；现有购买处理器与自营立即购买功能完整保留。若需另一版本的设计，先核对那个版本的真实旧节点。

新增宽列表样式只匹配 `.item-card:has(> .self-operated-media)`。宽网格使用浏览器合法、无嵌套 `:has()` 的判定：

```css
.result-grid:has(> .grid-card > .self-operated-badge):not(:has(> .grid-card > :first-child:not(.self-operated-badge)))
```

实际自营 badge 是 true 分支首个 DOM 元素；普通卡片首个元素不是 badge。实际浏览器 `CSS.supports` 已证明旧嵌套选择器无效、新选择器有效；内存文档与自动回归核对全部自营为 true，混合／全部商户／参考物料为 false，不访问业务接口、不修改当前页面。混合网格保留旧共享列，避免单个自营条目扩大全部商户；独立 Official Catalog 不动。

## 固定基线与候选

| 内容 | SHA-256 |
|---|---|
| 当前实际 SearchPage JS | `0a68c4c2b545c6d6b08cbbc795b538a003e69dc2fb1d5ae0799146f8204afc65` |
| 改版前实际商户 JS | `a095fae8f8a06b3601176d9132891619d137f296db8b5c2f941d3cac0ca1d6dc` |
| 当前附加自营 CSS | `9890c0b19003a01cac0f379fd7ca781112b19ee71a68d0f717ca8032f17ceca1` |
| 输入前台 HTML | `a02a6cb6a770aec14680930766f76b054ede00e3b3a4e2473fb0534c24993e00` |
| 恢复后源码 SearchPage.tsx | `86451e5f9e5254d721555ff52c576db5c8e6d76d446b65a2a8469d168ddaaa9d` |
| 新搜索 JS | `cf0bda2b1bae007337d4ccd10a7b4f722bda6365a3b9b9a075e746c39d31b607` |
| 合法限定样式 CSS | `0629f82af4c805834baf68a9ce183dc20e42d9c96f88d3d913395d15efd8da47` |

源码增量在 `source-increment.patch`，原生只修改列表数量栏、列表操作栏、网格卡片。私有清单记录精确范围、完整 before／after、候选 SHA 及逆转。HTML 只迁移实际搜索 URL 的 13 处引用（含 scope 别名键）及 1 处 CSS 引用，其他映射和字节保持。旧资产不被覆盖。已被拒绝的嵌套 CSS 候选不得再次应用。

## 离线构建与验证

```bash
TOOLS=/home/ubuntu/diagnosis/fixrepo/deploy/merchant-search-restore-20261118
PRIVATE=/home/ubuntu/diagnosis/merchant-restore-20261118
SOURCE=/home/ubuntu/diagnosis/frontrepo/client/src/pages/SearchPage.tsx
node "$TOOLS/build-native.cjs" "$PRIVATE/assets" "$PRIVATE/current-index.html" "$SOURCE" "$PRIVATE/candidate"
node "$TOOLS/test-offline.cjs" "$PRIVATE/assets" "$SOURCE" "$PRIVATE/candidate"
cd /home/ubuntu/diagnosis/frontrepo
/home/ubuntu/diagnosis/fixrepo/node_modules/.bin/vitest run --config "$TOOLS/vitest.merchant.config.mts"
python3 "$TOOLS/test-release.py"
```

修正后原生／AST／CSS 回归 13 项、源码回归 8 项、静态控制器安全回归 8 项通过。隔离 VM 使用合成 props，真实组件叶子不执行；六组旧／候选 DOM 描述树一致。该证据不等于像素截图或真实订单端到端成功，不要扩大声称。

## 正式静态发布约束

`release.py` 只接受冻结清单和完整 SHA，使用项目两把锁、共享窗口、当前完整 HTML CAS、全部既有资产／API／后台 HTML／新 worker／许可／runtime 保护和 12 个进程环境快照。只新增两份搜索资产及精确前台映射，不调用数据库、API 变更或 PM2 重启，不修改后台 Profile。公开资产保持 0644，替换 HTML 保持原权限，私有回执使用 0700／0600。

先默认无写预检，再显式 `--apply` 单次应用；任一前像漂移即拒绝，不沿用旧 HTML。失败只逆转本任务仍持有的 HTML 字节，第三方版本不覆盖；恢复未验证时保留阻塞窗口。`verify-cas.cjs` 仅只读检查，不提供锁、联网或应用授权。私有清单、完整生产 JS／HTML、源码快照、真实业务及审阅证据不得提交公开仓库。
