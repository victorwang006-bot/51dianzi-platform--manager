# 客户通知与详情一致性实现交接

完成时间：北京时间2026-11-22 00:55。用户00:33已授权按照自查建议修改并上线；本子任务仅生成通知/详情源码及后台静态候选，不执行Git、SSH、数据库或生产业务操作。父代理负责集成、最终检查与发布。

## 修改范围

仅修改真实源码根 `/home/ubuntu/work/channel-release-20261121-1837/manager` 的四份授权文件：

- `client/src/lib/adminNewInformation.tsx`
- `client/src/components/admin/AdminNewInformationBadge.tsx`
- `client/src/components/admin/AdminNewInformationMenuBadge.tsx`
- `client/src/business/platform/client/src/pages/CustomerDetail.tsx`

没有修改DashboardLayout、List或CSS；没有新建QueryClient、Provider或TRPC client。原服务器df1runtime、shared合同、数据库、商户/权限/业务写入逻辑不变。计划和TODO由父维护，未覆盖。

## 同页同步及账号边界

在原通知模块中增加显式的同页当前访问注册。每条注册仅包含原QueryClient、类型敏感账号token、模块/商户scope和当前generation的valid函数。服务器接受单客户receipt后，同步选中当前账号、匹配业务域的注册；同一QC去重，顶部只失效summary，业务只失效相同module/scope的inspect和unreadRefs。不同商户、模块、账号及canRead disabled注册不参与。

同页路径不依赖BroadcastChannel。整个通知runtime只保有一个跨tab channel，收到广播只失效、绝不再广播，避免双QC互相回声。关闭/切换身份会使旧valid函数立即失效；先前pending receipt的迟到回执不能通知新账号或disabled边界。隐藏页面可被标记为摘要待同步，但disabled查询不会在隐藏状态fetch，原可见性门禁仍生效。

## 摘要取值与迟到结果

每个现有QC内按summary或业务module/scope分别维护内存查询失效世代，summary另有单调请求序号。接受回执时同步推进世代，先cancel旧通知查询，再invalidate重查；即使mock transport完全忽略AbortSignal，旧请求成功结果也会被signal、current-generation、epoch和summary顺序检查拒绝。这样也处理了React Query对“无数据的首个in-flight请求”不一定通过单独invalidate取消的情况。

在同账号、权限未被撤销的当前边界内，最新完成且通过以上检查的服务器 `temporary + lastKnown:true + 非负安全整数count` 替换旧hook成功缓存。因此91后取得90会显示90（含children）；不是客户端减一。`temporary + lastKnown:false + count:0` 不压掉旧91；权限撤销、模块拒绝或身份变化会清除旧证明，temporary回复不能重新恢复此前权限的数据。未增加后端合同。

静态前端能证明的是“当前边界内、失效后发出的最新服务器查询响应”；没有服务端revision/asOf，因此不宣称可比较服务器内部任意历史时间线，也不把上述顺序检查冒称真实seen持久化证明。

## 可见状态与重试

详情成功main仍是原function RefCallback witness；加载/错误main仍无ack ref。readAcknowledged现在由当前通知row核验状态给出，而非独立缓存false字段绕过通知账号门禁。成功页明确显示：未读状态核验中、当前页面/身份未就绪、账号或权限阻断、当前客户未返回完整凭证、正在确认、确认失败、已读已确认，以及已确认但顶部待同步/顶部更新失败。

确认失败的原“重试确认”仍重新inspect、获取fresh receipt，再通过原可见性/当前mount/snapshot/accepted守卫提交。已确认但顶部待同步的“重查顶部摘要”仅调用原管理员summary.refetch，不重复inspect或mark。顶部徽章保留现有数值并可见“待更新/更新失败”，新增提示全用inline style，不依赖尚未生成的Tailwind类或新增CSS，不改变顶栏总布局；权限disabled的菜单徽章仍不显示。

列表依然只inspect，不ack。返回列表的未读筛选读取完整服务器unreadRefs而非一页本地过滤。禁用未读筛选可以保有React Query创建的空observer，但没有结果数据、available=false、不会读取接口，更不会把空observer当作已核验空集合。

## 原生运行时与详情补丁

最终通知资产以 `runtime-manifest.json` / `manifest.json` 为准：

`/assets/AdminNewInformation-customer-consistency-runtime-cff8bad8c4d94617.js`

本地位于本工作目录 `assets/`。`build-runtime.mjs`复用既有ui-native脚本的虚拟 `__live.React`、`__live.jsx`、`__live.Query`，工厂返回同一单例，不打包另一份React/ReactDOM/Query/TRPC，也不修改nav原bytes。父通过importmap将所有旧通知runtime引用统一映射至该新资产；当前nav仍保持 `/assets/DashboardLayout-admin-polish-6614aeb7b2a8f529.js` 原bytes。

### 布局候选完成后串行调用

```bash
node /home/ubuntu/work/customer-consistency-release-20261122-0034/notification/patch-detail.mjs \
  /absolute/full-layout-candidate-WB0.js \
  /absolute/final-output-directory
node /home/ubuntu/work/customer-consistency-release-20261122-0034/notification/patch-detail.mjs \
  /absolute/full-layout-candidate-WB1.js \
  /absolute/final-output-directory
```

**两个参数都必须是绝对路径**。输入是完整真实WB，而非IM片段。每次输出contenthash命名的WB、精确提取的新 `native-IM-*.js` 及 `detail-patch-*.json` 证明。工具按AST唯一定位真实最终 `IM` 与 `__apDetailRow`，仅源派生替换两个槽位：`__apReadAcknowledged`初始化和既有详情状态JSX根条件。完整包做exact inverse并断言UTF-8 bytes完全回到输入；槽位外bytes、联系人差量、成功main ref和加载/错误不ack原样保持。新旧IM自由ABI名称完全一致，不整页替换函数。基线真实Hv/Iw/FM工厂/调用路径与其余包bytes保持。

本子任务对旧真实WB0 `792e2858756474bb` / WB1 `6ffe72a5d81423ea` 的演练结果位于 `evidence/wb0/` 与 `evidence/wb1/`，**只是详情单独候选，不要拿它覆盖布局agent最终候选**。

### 对父集成后的实际WB再次定向跑

```bash
node /home/ubuntu/work/customer-consistency-release-20261122-0034/notification/offline-dom-probe.cjs \
  --runtime /absolute/new-notification-runtime.js \
  --wb0 /absolute/final-WB0.js \
  --wb1 /absolute/final-WB1.js \
  --out /absolute/final-probe-output-directory
```

探针直接从这两个完整WB提取同一真实最终IM，复用原审计探针环境，不重造“看起来类似”的详情函数。成功/失败都会写 `offline-dom-results.json` 并终止，不残留自有probe进程。

## 测试结果

`evidence/probe/offline-dom-results.json`：**19/19 PASS**。原9项缺陷预期已改为正确修复预期，并扩展为：

1. 两个真实WB的精确IM，同QCaccepted后顶部90、返回列表无未读。
2. 双QC广播正常、无广播、广播构造抛错三条路径均立即summary90，无focus/15秒轮询依赖。
3. 缺当前item、缺receipt、number/string账号故意不匹配均有可见状态且0 mark。
4. mark失败不自动重试；原按钮重试fresh receipt后accepted。
5. 隐藏tab不mark，回可见列表后仍未读。
6. 最新temporary lastKnown90胜过旧91；unknown temporary0不能伪造清零。
7. 摘要失败可见“更新失败”，摘要恢复按钮不重复inspect/mark。
8. cancel/invalidate迟到summary91不反弹，迟到unreadRefs不回弹。
9. 旧pending回执在切换账号或canRead disabled后不通知新边界。
10. 同页不同账号、商户scope、模块及disabledQC均不被互刷；summary/inspect调用数量有界，广播只有accepted发送一次，无递归echo。
11. disabled未读筛选不读接口、不提供空集合证明；accepted后返回列表/未读筛选得到mock服务器最新完整集合。

原项目 `pnpm check` 已运行；修改前端全部无诊断，标准项目命令仅剩既有 `server/services/adminNewInformation.ts(819,33)` MapIterator在ES5 target下的TS2802（严格按授权未改后端）。后续一行状态优先级修正已由原生runtime和19场景重新验证，父执行最终check即可，不需重复全站验收。

**边界声明：** 这是真实React/ReactDOM/React Query和精确IM的JSDOM运行，不是生产浏览器。业务子组件保持惰性占位；context/get、summary、inspect、markDisplayed及unreadRefs全部内存mock；geometry/IO/Broadcast均受控mock。全部真实网络调用和业务mutation为0。它不涵盖真实账号授权、签名receipt、RPC、数据库seen持久化或实际生产客户访问，不能据19 PASS宣称那些生产事项已通过。
