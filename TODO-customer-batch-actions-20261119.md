# 客户库存批次与失败处理（2026-11-19）

沿用现有后台、蓝色样式和原客户/账号授权。用户批准原方案，不创建新站点。与“前台任务”分工：本任务只改客户库存/上传处理，不改首页与芯片参数；独立工作目录，Git同步保留并发提交；正式发布用共享双锁与最新字节CAS，不全量dist，不覆盖前台API/资产。

前列已勾选项表示源码实现与隔离验证完成，不代表生产已上线。上线与实际现网核验继续以最后未勾选项为准。

- [x] 库存工具栏新增“全部批次”，选项“11-19 14:30 · 库存.xlsx”。服务器按真实uploadBatchId及customerId同时筛选，型号/品牌继续配合，数量随批次更新。历史无批次记录不猜时间关联。
- [x] 保留勾选物料“删除所选（N）”，未勾选隐藏；确认“删除选中的 N 条物料？”、按钮“取消｜删除”、成功“已删除”。只移除真实成功回执记录，权限/版本冲突记录保留，未知按原请求核实。
- [x] 上传历史显示上传时间、文件名、上传人、成功/失败及“查看物料｜处理失败｜删除整批”。查看物料回库存自动选择原批次，无失败隐藏处理入口。删除整批确认明确成功物料与待处理记录，关闭该批次后不可继续导入，不误删已转交/变更或上传前记录；保留原文件证据。
- [x] 失败编辑使用90vw/85vh大弹窗并支持全屏，固定表头/底部按钮，独立横纵滚动；表格直接编辑，错误字段标红，全部失败行可达。
- [x] “导出失败”下载Excel原字段顺序+失败原因，包含当前修改值，名称“库存_失败记录_YYYYMMDD_HHMM.xlsx”。无法解析时提供下载原文件，不能显示无效编辑入口，上传忽略失败原因列。旧恢复记录无原列证据时只用明确的标准模板，不伪称原顺序。2026-11-20已补齐历史编辑入口：保留单一客户端真实Excel导出，保存原表列/附注和当前修改；多表精确sourceRefs、1000行末页、原UUID冻结恢复均已测。非编辑历史导出另附授权原manifest的问题原行，不猜缺失字段。
- [x] “重新提交”只处理可修正的未提交问题行，归属原批次，不重复成功行；unknown沿用原请求核实，不覆盖冻结payload。全部成功反馈“全部提交成功”；未知结果显示“待确认”，不冒充确定失败。身份、客户、版本、权限变化立即阻断。原准备已提交但丢失回执时，完整匹配服务端canonical集合后沿用原UUID恢复；部分问题行补发后仍可处理余下问题行。
- [x] 本地隔离测试/类型检查；UI 15文件364项及实际失败编辑器10项通过，后端相关308项及原生API 16项VM验证通过。没有生产物料写测、DDL、环境改写或重启其他任务服务。
- [ ] 保存最终源码并定向发布，核验实际URL新字节与共享前台保护。发布前重新捕获现网，以最新API/HTML字节CAS封印；双方排队开窗，保留前台新参数/手册等全部非本任务字节。未发布不声称上线。

## 当前状态

2026-11-20 09:56接续：业务最终源码已保存于manager 422b545，完整类型检查exit0；5测试文件77项通过，最小Array.from兼容修正受影响45项通过，额外原行为8文件238项通过（范围有交集，不重复加总）。真实只读旧种子的两API/两原生UI定向候选经独立源码/AST symbol/正逆字节审查通过，但不是新鲜捕获或发布批准。已自然合并前台两轮doc-only归档，当前共同main基线fad1856，保留双方历史。

本地最终控制器scope为customer-batch-actions-20261120-6Lfttf6o-R3，SHA ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5；89项控制器、32项准备器隔离mock测试通过。保持原RPC入口和完整vendor/PM2/Node/source/env/raw/权限/CAS保护，显式纳入/var/lib/dianzi51-private全树；只对实际来源限定的nested PM2顶部五项数字metadata验证准确转换，完整app环境/其它nested/opaque/未滚动槽raw不变。真实RPC加载闭包31文件62引用均在原PM2根，无动态/缺失/外部路径；真实clone语义与六槽完整retained forecast、R3 fresh fullMETA、完整包/独立审批仍未齐，明确NOT_APPROVED。R3远程目录/捕获/封包/attempt/receipt均未创建，未进行业务active写、重载、DDL、物料写测或环境修改。

用户随后修正前台为移除自营徽标、其他方案B纯展示，后台在无占窗状态明确先释放窗口，但服务器任务WwTU7ZyBdUOxjBfGFQ00WN报告ECS备份失败、根分区约99%且仅2.48GiB余，尚无新成功备份；部分enterprise-shadow目录存在现役日志FD，禁止整删/整迁。前台没有使用该窗口，前后台共同hold。后台必须保持离线，不新增ECS连接/capture/stage/write/reload/env，不接管清理或重复排查。此限制不等于批准恢复发布。

接续条件：服务器任务先明确容量/备份/路径及调整互斥的安全边界；再由前台完成其最新静态scope并给实际verified durableclosed与明确释放窗口；后台然后以新的完整现网META/两API/HTML/依赖重新构建、封印、独立全包审批、窄scope一次性apply与verified closed。旧8a130协调哈希/f893前台技术回执、旧种子/R1/R2拒绝阶段均不得当新审批或重放。不得削弱前台参数/PDF/store/sourceflags/runtime或客户权限边界。

旧冻结记录若真实原行证据缺失、重叠或歧义，明确拒绝补发，不猜来源、不更换成功/未知请求的UUID。删除保留原上传文件和历史证据；批次关闭后不可继续入库。

## 10:12最终离线收尾（未上线）

上文ec2是R3初版历史；当前实际控制器SHA为 **bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab**，scope仍是从未remote stage/capture/attempt的R3。独立审查发现F1：未知nested普通指数1e400/-1e400解析溢出为inf。主任务只增加6行checked parse_float/math.isfinite并同步preparer pin；所有其它PM2/审批/恢复AST不变，原token不重编码。89 controller、32 preparer再次通过，新增6 pure JSON测试通过，独立F1只读验证6/6通过。完整证据与独立报告在deploy/customer-batch-actions-20261119/evidence/r3-f1-*，整体仍NOT_APPROVED。

原R3 late pm2ReloadReady守卫是受控失败设计，不能称为全阶段零写阻断；未来正式审批前，六own实际Ready必须全部True，并与capture/manifest绑定，还要实证fclone、完整retained byte/source-shape、fresh fullMETA/前台新集合/全包正式审批。现在缺口未齐，不开发布窗。

服务器已识别外部300GiB盘，但分区/根文件系统仍旧约197G99%；快照仅极速可用、OSS尚未全量完成，尚无新成功文件备份，未执行实际文件系统扩容。所有容量/快照/备份及互斥安全条件必须由服务器任务明确，前台B静态105测试/tsc0和seed包也不是现网部署。后台继续不连接ECS、不capture/stage/write/reload/env，不清理/迁移shadow或回退目录。服务器安全解除后先等前台新actualverifiedclosed交接，再后台fresh全审，不重用旧8a130/f893/旧seed/旧pin。

## 11:12 R4恢复上线准备（仍未上线）

用户10:31明确‘扩容结束，可以上线’。容量阻碍已由服务器任务确认解除，但前台用户同时增加列表+详情合包，按不冲突要求前台静态优先，后台仍未创建远程R4stage/capture/attempt/window、未业务active写或reload。一次获准的pure fclone resolve+exact source读取已完成断开：实际 /usr/local/lib/node_modules/pm2/modules/fclone.js，1239B SHA9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6。明确目录候选ENOENT未做fallback，真实路径随后才由纯resolve确定。

R4完整OWNER不变，SCOPE customer-batch-actions-20261120-6Lfttf6o-R4；当前controller **4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121**，preparerpin同步。完整保护新增非PM2推荐服务：PID2060125 flock父、2060126 node-22子、实际bootstrap、精确/opt/ops/dianzi51-recommendation全树及childcwd全树；全opaque环境/argv哈希、PPID/startTicks/exec/cwd/权限/source/rootMETA双读，末端完整复核，不修改/重载它们。原12PM2/六own/9生成源码pins/全部应用值保留。

独立fclone域审15限定JSON样本通过但3自有__proto__样本真实不等价，已增加递归域明确拒绝，不删env字段或洗bytes。preflight/apply前增加sixown Ready全部True零写gate，合法false仍可作capture诊断；正式审批仍须实际sixReady真、typed/fullretained byte witness，不拿域guard或纯样本反推daemon对象类型。domain段独立静态通过；aux采样末端两缺口已最小修复并9原stale接受反例全部拒绝，最终142 controller/36 preparer/6 JSON测试通过。全部历史与准确AST/source日志在evidence/r4-*，不重写业务。辅助采样是有限读，不声称内核原子或连续冻结。

下一步在前台未占窗阶段只许可一次≤30s定向readiness/安全身份见证（无stage/capture/fullMETA/锁/写/reload/DB、只布尔/哈希/差异keyname），不可当审批；前台新的actualverifiedclosed+明确交接后才后台fresh14proc/fullMETA/两API/adminHTML/当前源字节重建、独立全pkg审和窄scope发布。source/mocked tests不是actualReady，全approve仍False；旧8a130/f893/旧seed/旧bf7或529pin不复用。

## 11:13实际只读见证结果与当前等待边界

前台明确许可一次≤30s只读六own准备形态与辅助身份probe，给实际Node fullSHA2684ed77513bdbfc63c92848877a4c43a8e50dd7df0f9896c1e0daf0d204c939。11:12:44 probe实际exit1并断开：Node/9生成源/31RPC源哈希门禁通过；随后/proc/2060125/stat返回ENOENT。六槽模型与env仅在内存读取，尚未输出见证结果，因此不能声称sixReady通过或失败；没有stage/capture/fullMETA/锁/API/写/reload/DB，私有环境未落盘/输出。2060126未继续读，不寻找替代PID或重试。

此结果只说明旧PID2060125已不存，不能推断推荐worker故障或合法retired。当前R4固定旧PID保护不得用于发布；推荐Ops与childcwd全树保护继续保留，不删历史代码/目录。前台正向服务器任务询已有生命周期/owner来源记录、将在其static adapter中fresh核对动态actualnode/flockparent与knownbootstrap/cwd；不让服务器重scan或接管。明确暂不追加六RPC许可、不新增ECS连接，后台只离线等待新actual身份及前台列表+详情actualverifiedclosed/明确交接，再做必要护图调整和fresh全审。

auxfix独立增量复核已静态PASS，原105top/Controller30/九pins/domain/pregate全字节保持，142/36/6日志一致；报告evidence/r4-independent-auxfix.md/.json。段静态PASS不是实际META/Ready见证或整体审批，所有审批仍False。
