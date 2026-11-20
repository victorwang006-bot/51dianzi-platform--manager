# 最终纯构建补证｜不构成上线批准

**`final-build-report.json`：`INDEPENDENT_REVIEW_PASSED` 仅适用于已授权列表＋详情静态构建。** 严格采用 `production-package-final/pack.py:REPORT_KEYS/report_check` 与 `static-production/controller.py` 候选末尾的11字段；`productionWrites=0`，不生成生产review，不改变旧报告状态。

### 1．精确绑定与继承

当前 `detail-native-null-fields/candidate-visual-final` 实际文件SHA256：

- manifest：`91863042689520a9f8b0cdf5f88d0575a96416f32b43482cb88044a589547c7e`
- HTML：`349cbe260fe908ceb17fe4d04517f6c3ad043ec69d1cf8fe8324935c44a5c19f`
- 90条importGraph（规范JSON＋末尾换行）：`8725fea6c31856e61065a50f205c048666b09773b252e58a3d953d5dde56a565`

报告精确绑定 `production-package-final/build-evidence-material.json` 的97个依赖URL→fullH、exact4 sourceScope及新5有序assetSHAs。本次核对新5实际H/size、4源H，按封存manifest导入项与当前importmap重算90图及HTML所需97项集合，均匹配。

继承 `native-full-review/report.json` 独立 `PASS_CONDITIONAL` 的19源/774 source依赖/3187边、4源5资产、8原事件、金融、9商户、whole-bytes inverse、HTML20及身份/路由既审边界；由 `null-fields-independent-review/report.json` 的 `LOCAL_FIX_PASS` 与 `independent-evidence.json` 将旧5d561候选精确连接到当前9186：仅空字段展示过滤/hashchain，非目标字节、8事件、金融/9商户、12+1+1+35+20补丁及fullRebuildParity均已有绑定PASS。本次不重复这些审查或重建。六个true仅据上述展示范围、非目标字节、重建及精确静态闭包；`apiStoreFlagsEnvUntouched` 不代表生产运行时审计。

### 2．两项原生构建未决的解除

**实际binary：** `existing-binary-dependencies/existing-binary-read.json` 的51URL均有HTTP200、JavaScript MIME及实际全量bytes；本次逐一复算fullH/size并与材料匹配。另核 `native-final-1305/cache-pins.json` 74项缓存bytes/H/size，材料60项本地依赖全部匹配。准确披露：旧 `native-full-review/binary-evidence.json` 为零字节，不采信为成功证据；`binary-review.mjs` 的存在不等于成功执行，本次未执行。实际51字节证据及核H已补齐原缺失，不伪造该空文件的结论。

**实际native：** 采信 `native-final-1305/report.json`、`cache-pins.json`、`process-cleanup-receipt.json`、`README.md`；before/after封存相等且绑定当前manifest/HTML/新5。W25/ST列表＋详情1280/375必需8/8，另有参数展开2例；真实标题Link进入独立详情，参数/PDF href与同次DTO一致，新5全加载，nativePageErrors=0，实际非GET=0，自有进程/profile清理完毕。PDF未点击/下载，交易未执行；围栏导致的下方商户结果失败和关闭竞争保留，不扩大为整站/商户浏览器PASS。

### 3．37项expected与独立生产gate

97项＝60项本地bytes＋37项仅原HTML不变refs。本次确认37项均在旧/新HTML、均非新代码直接依赖；全部51个新代码既有直接依赖均有实际bytes。因此37项只需材料所绑定先前真实r2 fullcapture fullH/size作为**expected**，不必为纯构建再抓取其他页面；旧capture绝非CURRENT fresh或发布批准。材料中旧capture H为 `f2a542459f399594c7677741d363b3d83bbc9c25ec58ab4cafdbe539c6388ad7`。

未来必须以CURRENT真实fresh fullcapture逐项重绑全部97个current protectedFiles的文件种类/fullH/size：已有bytes与fresh H/size匹配，37项fresh fullH与本报告expected逐一匹配、size取真实fresh记录；任何不匹配不得沿用本报告放行。`pack.py` 仅消费capture/report，不创建审批。`staticImportClosureExact` 仅指本包90图＋HTML所需97依赖集合，不宣称重审全站传递路由图。

**runtimepolicy、生产fresh protected META/别名、窗口/锁、releaseReview和部署审批均未审、未批准、未执行，仍由独立生产release gate处理。** 它们不阻断纯构建报告，也绝不能由build-pass替代。本次无浏览器/网络/SSH/Git、未跑已有tests/build、未改source/candidate/guards/controller/policy/旧报告；仅新增本说明和构建报告。
