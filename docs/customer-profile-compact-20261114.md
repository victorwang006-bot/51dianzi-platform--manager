# 客户档案紧凑布局与资料合并

用户2026-11-14 09:03:59批准实施。基于main37014f0831eae3f1e8099c69366d0947b752de18及HTML0826fd3d36191498fd371a455d28bfcb2fda7f8646e8eb787466488ddbb151a8，保持前轮四文案精简/档案默认与原BOM/订单/库存逻辑。

## 结果

客户档案只保留两主要卡片：客户资料、跟进记录。资料标题左对齐，原编辑资料、管理联系人及展开详情在右侧；基础摘要只保留行业/阶段/下次跟进，联系人不再单独套高卡片，细分隔线下按姓名/主联系人标记/职务/全部联系方式排列，窄屏自然换行。版本和更新信息移入展开详情，资料收起时联系人仍可见。卡片间距12px，页内padding12–16px，资料/跟进标题操作32px，正文15px，无不必要固定空高度。

跟进历史的作者/方式/时间/更正同行、正文下一行，长内容仍支持展开。常驻追加说明删除，实际更正提示保留。客户档案页只保留下方标题新增跟进入口，其他页签原顶部guardAction捷径保留。

原资料/联系人scope及编辑权限、版本/请求幂等、归档只读、dirty/busy/beforeunload/SPA保护、跟进追加更正不覆盖保持。源码前return区25223bytes（除CSSimport）、需求/订单/库存JSX2102bytes、dialogs3732bytes、跟进原编辑保存history4217bytes及原props守卫均逐字相同。原CustomerWorkbenchContacts与旧CSS未修改。

## 验证

7文件213项源码回归与非incremental TypeScript检查通过；两实际工厂35组离线用例通过，网络/保存替身调用0，包含资料合并、联系人持续可见、元数据展开、原新增/更正、订单九列、BOM XLS/XLSX本地解析、精确客户库存拒绝外客户和前轮说明精简保护。独立只读审查PASS，33条新CSS规则全部受本客户详情class约束，除允许的root局部宽度规则外全部限定company面板，不覆盖公共菜单/列表/其他tab。

离线Chromium使用相同两位联系人/一条跟进夹具、原23份样式、新严格scopedCSS、实际候选React DOM；桌面与窄屏无横向溢出、标题左对齐，展开后联系人仍显示、卡片自然增高。高度对比（旧值仅两旧卡片高度之和，不含卡片间隙）：

| 宽度 | 原基础+联系人卡片 | 新合并资料卡片 |
|---|---:|---:|
| 1440px | 334.5px | 200.0px |
| 390px | 515.5px | 340.0px |

离线截图只用于资料/跟进区域检查，native菜单和对话框不是像素验收目标。未登录生产做像素验收，未写生产测试客户/联系人/订单/跟进。

## 发布

Verified UTC：2026-11-14T01:26:42.692476+00:00；北京时间：2026-11-14T09:26:42.692476+08:00。

HTML SHA256：`204e6bcfa2e6096cc17a892bcdbc56c014d3d0588e8987ac5daca3676d8b9618`。OPS：`/opt/ops/20261114-customer-profile-compact-CKSZQ7s`。

仅5静态files（HTML+3JS+1页内CSS）。旧37014工厂逐字重现当前2活动模块，新63sourcepins仅本页面TSX和新CSS变化；每包仅替换lazy customer工厂initializer，原__customerLive依赖桥、其他原生/商城字节不动。入口JSbytes不变，仅换新URL，importmap依赖解析/原scope及HTML精确逆向证明通过。旧23样式及所有旧资产保留。

双锁+关闭协调窗口+freshHTML CAS发布，先核对4新资源公网hash，再原子切HTML；6后台路由/主站健康hash核验通过，原API/主站HTML/nginx/进程pid/path/cwd/env一致，零API/DB/权限/进程/生产测试记录变更。窗口verified关闭，双锁释放。完整脱敏证据在deploy/customer-profile-compact-evidence-20261114，最终commit与63pins绑定回执另存OPS/git-source-receipt.json。
