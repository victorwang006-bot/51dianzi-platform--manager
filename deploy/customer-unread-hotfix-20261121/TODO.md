# 客户未读筛选热修

用户2026-11-21 23:52反馈勾选“只看未读”出现异常，并要求放在功能栏。

- [x] 修复当前真实原生WB1 vt及WB0 Jw未读筛选gatefalse导致result变false、旧result?.items.map读取undefined.map的崩溃。result不可用时保持undefined，不假空、不放宽权限，不改后端已读/客户查询合同。
- [x] 将“只看未读”放入搜索、重置、更多筛选同一功能栏，长提示收为title/aria帮助；取消顶部单独占行。
- [x] 对截图对应真实原生gate/依赖map作回归并最小静态增量发布。保23:35已上线后台紧凑、真实个人未读后端、渠道库存、订单和前台搜索卡。前台HTML/API及后台API全部原bytes/inode不替换，不做PM2reload、不测试清真实未读。正常同步源码，双锁/CAS/备份/失败精确回退/持久closed并核验公网。
- [x] 用户23:54追加“公司名字跨行显示，功能显示补全。都要一起修复”：公司名称单行完整显示，保留星标/未读标；窄视口表格可以横向滚动，不吞文字。
- [x] 供需列标题、上传物料表、查看库存，以及需求录入、跟进等功能完整显示，不改按钮行为。

根因已确认：当前WB1 asset BusinessWorkbenchPage-admin-polish-53fe6b444a4b6775.js 第810行1933列附近为 `let k=K(()=>C?.items.map(...))`。上轮原生delta构造 `C=__apUnreadCanQuery&&!__apUnreadNarrowingFailed&&(oldcond?data:undefined)`；gatefalse时C=false并非undefined，optional chain仅短路nullish，因此items为undefined而.map抛错。源CustomerList.tsx完整condition ?data:undefined正确，修正原生映射而不乱改服务端。

正式结果：2026-11-22 00:10:23北京时间，VERIFIED。后台HTML与3个新静态assets公网完整hash匹配；前台HTML、双API原bytes/inode不变；runtime不改、PM2不reload，closed及双锁释放再次核验通过。源18项和完整原生32状态通过，真实业务写测试0。
