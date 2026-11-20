# 客户库存批次与失败处理（2026-11-19）

沿用现有后台、蓝色样式和原客户/账号授权。用户批准原方案，不创建新站点。与“前台任务”分工：本任务只改客户库存/上传处理，不改首页与芯片参数；独立工作目录，Git同步保留并发提交；正式发布用共享双锁与最新字节CAS，不全量dist，不覆盖前台API/资产。

前列功能勾选项表示源码实现与隔离验证；最后发布项现已完成。**最新终态：2026-11-20 19:00:19真实发布／六槽reload／verified闭窗，19:08:00附加adapted只读核验，19:08:54恢复／双锁释放证明齐备。**下方较早“未上线／blocked”记录属于历史，原失败不删除。

- [x] 库存工具栏新增“全部批次”，选项“11-19 14:30 · 库存.xlsx”。服务器按真实uploadBatchId及customerId同时筛选，型号/品牌继续配合，数量随批次更新。历史无批次记录不猜时间关联。
- [x] 保留勾选物料“删除所选（N）”，未勾选隐藏；确认“删除选中的 N 条物料？”、按钮“取消｜删除”、成功“已删除”。只移除真实成功回执记录，权限/版本冲突记录保留，未知按原请求核实。
- [x] 上传历史显示上传时间、文件名、上传人、成功/失败及“查看物料｜处理失败｜删除整批”。查看物料回库存自动选择原批次，无失败隐藏处理入口。删除整批确认明确成功物料与待处理记录，关闭该批次后不可继续导入，不误删已转交/变更或上传前记录；保留原文件证据。
- [x] 失败编辑使用90vw/85vh大弹窗并支持全屏，固定表头/底部按钮，独立横纵滚动；表格直接编辑，错误字段标红，全部失败行可达。
- [x] “导出失败”下载Excel原字段顺序+失败原因，包含当前修改值，名称“库存_失败记录_YYYYMMDD_HHMM.xlsx”。无法解析时提供下载原文件，不能显示无效编辑入口，上传忽略失败原因列。旧恢复记录无原列证据时只用明确的标准模板，不伪称原顺序。2026-11-20已补齐历史编辑入口：保留单一客户端真实Excel导出，保存原表列/附注和当前修改；多表精确sourceRefs、1000行末页、原UUID冻结恢复均已测。非编辑历史导出另附授权原manifest的问题原行，不猜缺失字段。
- [x] “重新提交”只处理可修正的未提交问题行，归属原批次，不重复成功行；unknown沿用原请求核实，不覆盖冻结payload。全部成功反馈“全部提交成功”；未知结果显示“待确认”，不冒充确定失败。身份、客户、版本、权限变化立即阻断。原准备已提交但丢失回执时，完整匹配服务端canonical集合后沿用原UUID恢复；部分问题行补发后仍可处理余下问题行。
- [x] 本地隔离测试/类型检查；UI 15文件364项及实际失败编辑器10项通过，后端相关308项及原生API 16项VM验证通过。没有生产物料写测、DDL、环境改写或重启其他任务服务。
- [x] 保存最终源码并定向发布，核验实际URL新字节与共享前台保护。发布前重新捕获现网，以最新API/HTML字节CAS封印；双方排队开窗，保留前台新参数/手册等全部非本任务字节。未发布不声称上线。

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

## 11:43 R5动态保护最终准备（未上线）

已自然ff前台01043d6及去敏动态source64df，后仅离线改R5。旧固定PIDpair不再生产mandatory，原全部purefixedhelpers/historytests保留；currentactualallNode+完整父closure有限双sample保护foreignopaque/env/cmd/start/权限/exe/maps/script/sourcefullH/META，严格六ownstable slot映射不把合法rollPID/raw/start塞foreign记录，原30个Controller/transport/RPC/9pins/6ownraw/appenv/CAS/receipt/Readygate全部bytes保持。knownbootstrap当次absence仅not-retired，完整推荐Ops/cwd保护不删。unknownactualsourcegraph须新完整独立审，不自动approve。

当前controller **36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14**，SCOPE customer-batch-actions-20261120-6Lfttf6o-R5，完整OWNER不变；preparerpin同步。独立发现F1非objectserializedenv/缺失或非decimalNodeUnique仍享新collectorown分类（原raw链仍阻断非pub绕过），F2重复同identity执行map去重丢multiplicity，已只两helper最窄修；212controller/38preparer/6JSON及八新反例全部实际puremock通过，原204测试定义ASTbyte不动、原全部协议不动，准确evidence/r5-f1f2-*。窄修独立复核完成后另归档，不用它代fresh全包approve。

前台list+detailcandidate NOT_APPROVED，正在自身actualruntime source依赖/HOME/3God/脚本闭包/fullNativeBrowser证据，不追加我forecasthelper，后台不改变其固定收件输入/预算、不新probe或capture。R5未任何remote stage/capture/attempt/window/activewrite/reload。用户10:31‘扩容结束，可以上线’授权仍有效，待前台newactualstaticverifiedclosed+明确交接后自行freshactualsixReady/retainedTypedWitness/allNode sourcegraph/META/新两API+adminHTML/全pkg审，再窄scope发布；不复用旧技术closed或只读partial数据，也不重复要求用户授权。

## 11:45最新独立收尾结论与剩余发布条件

R5 F1/F2独立窄审PASS_NARROW_FIX_ONLY，无新实质bug；AST/bytes仅两helper，原204测试方法不变，8/212/38/6保存日志核对一致，合法own滚动和mutableAPI本地替换非干涉实证成立。报告evidence/r5-independent-f1f2.md/.json；当前controller36706f...、R5scope和完整OWNER不变，所有总approveFalse，不授整体包批准。

源码已成功保存manager8baff，前台已自然保留，sourceinputs/sealedcandidate不变。前台当下仍0newpubstage/fullcapture/window/HTML资产write/reload，独立语义仅PASS_CONDITIONAL；51directdep GET200/fullH已收，但更深transitive闭包/fullNativeBrowser/runtime实际准入未完，故尚无newactualclosed可交接。双方明确不能完成准入时如实未上线，不强行开窗或自动放行后台。后台不重复ECS读取或probe，用户恢复上线授权有效；离线准备完成不等于当前actualsixReady/retainedTypedWitness/sourcegraph/META/新fullpkg审批完成，待新的实际闭窗交接后续核验和窄scope发布。

## 12:33真实接续结果：仍未上线，已停止捕获重试

前台11:50明确本轮未开窗/未改生产、已结束占用，后台已接手；不再等待不存在的newstaticreceipt，用户扩容后上线授权有效。当前已自然ffmanager79c0ef4保留前台sourcefix与本地candidate，但不部署其未审批资产。

11:52六own实际只读JSON字节见证全部Ready literalTrue，绑定/保留值/字段顺序一致（不是fullMETA或原daemon全typed证明）。R6/io_uring窄支持和R7两exact已loaded pnpm native86hardlink H/fullmeta限定已完成、分别独立段PASS，当前R7controller a555022329eed9c2b72efa2aa0668b9a84d33148da4bee5cc9ba5bd579866e5b；276controller/42preparer/6JSON纯本地回归通过，所有原Controller30/RPC/9pins/环境/CAS/Ready/收据保护不改。

真实R7完整捕获多次观测动态Node集合变化而拒绝；一次remoteexit0收件尾截断不当有效capture，client已只修EOF接收，最后一次仍DYNAMIC_NODE_SET_FINAL_DRIFT，已停止capture重试。30秒297身份样本未捕到额外Node，不反推此前漂移不存在，不猜触发者或退休。没有有效新fullMETA/完整包/全批批准，最后上线项保持未勾选；0attempt/window/activeAPIHTMLwrite/assetinstall/reload/DDL/物料写测/env改写，未暂停或kill其他服务。私有R5/R6/R7controller目录取证保留不覆写。

后续须定向确认短生命周期Node来源/受控稳定窗口，fresh自身完整graph/META/六槽完整typed/retained证据，再现役APIHTML新包独立全审和窄发布，不移除集合守卫或用部分稳定样本代替成功capture。当前本轮只读全部结束，不在无稳定基线时强行开窗。详见deploy/customer-batch-actions-20261119/evidence/current-deployment-blocked-20261120.md。

## 13:20恢复推进：不把blocked当任务终点

用户13:02要求解释未上线却停止，后台已认责：停止失败重试不应变为停止查因与上线任务，原授权持续有效。13:04与原采样相同路径诊断已精确定位PID1.kernelLinkMeta.exe/cwd虚拟inode/初始化mtime/ctime重生成，实际两扫描15PID与完整entry identity/exe/cmdlineH一致；不能按错误label称该次Node增减，也不能倒推全部旧拒绝同原因。

R8仅对准确cfg.proc/PID目录和exe/cwd虚拟entry作来源定义：剔除3个内核cache生成字段，保留dev/type/owner/group/size/nlink，目标readlink、PID/PPID/start/comm、整raw/cmdline/permission、真实源/CWD fullMETA全部保持。新pin586166f7ddf48235b6a28e2237d7b1f64cbf3709d1af484388a67b086f0ecaef，新R8scope；304controller/44preparer、28+2新增反例实际通过，不额外重测通过功能，修正留到最终唯一整包审中核验。

13:14真实capture拒已知active别名逃逸，尚未准许任意跟随；同默认capture路径继续记录精确拒绝字段。13:17唯一诊断原路径109扫描全entry一致、无proc差异，但受临时90秒诊断时限截断；这不是新安全拒绝或正式capture。13:20已经移除仅诊断时限，保留原controller时效/全部守卫，完整原默认capture正在进行；同次失败留准确路径/entry差异，不再做旁路稳定采样或停止整个任务。0apply/业务写/reload，只有真实有效fullMETA与当前增量包最终独立批准后才能窄发布。与前台已重新协调，前台当前只离线处理自己的必要阻塞，不并发ECS管理读/写。

## 14:55 当前接续点：未上线，已明确无开窗释放

R9当前controller `2c7047701591af1ee2c21f93fe84593184ff0e6e3ed3d40ad2ee1d0f87dea0f8`，用户批准TTL3600/精确timer维护最长3600；参数8项和仅3个已审客户媒体包装的2行误拒修正8项通过。现役技术库STF407 revision2→9同参数/PDF变更已由用户明确采用；本任务原样保护37ddd当前wholeH/META，未写库，不伪称sourceVerifier通过。

实际fresh `3c7cc226...`/83054记录/六Ready真，内容审复用；manifest `21b2e77f...`/review `0271f8a2...`完整机械绑定103包/33源已通过。源码已自然merge前台a647并push manager `bfb602c726e6c9250999fd1906e9431c61430f01`。仅私有16,183,338字节归档传输遇到SFTP停滞、scp120s超时、SSH stdin600s超时。**从未进入私有package安装/attempt/apply/pubwindow/生产替换/reload，不是已上线或已回滚。**

14:48唯一精准检查证明服务器同一归档15,740,928字节/完整prefixH匹配，仍缺442,410字节。原所有partial保留，不删除或未经H信任。14:46原维护守护真实RESUME/exit0，supplier.timer恢复active+enabled，unitH不变（暂停未超过获批60m），后台全部SSH/作业/锁退出。既有真实capture/coord/保护图/来源/报告已私有附件交前台及协调任务，不新增扫描，不扩大source语义闭合主张。

14:52明确无开窗释放，14:55总协调要求前台先行，后台保持0ECS连接/不install/apply/不暂停timer/不插队，不把该等待勾为任务完成。已离线备好10个块、每块最大48KiB（末块42B）的剩余字节计划，每块准确offset/before-prefixH/chunkH/after-prefixH，20s每块/180s全程，完整归档最终必须H `a0cc4d7a3797e55b93f012a04bd72a2a01e9ee7aed7e2f550af69d52dfeb71b2`。默认plan不联网；只有前台真实终态退出连接锁并重新协调后才能补这唯一suffix，不重传大包/不重建业务/不重审已过内容。

后续实际当前META/coord/source binding须重新符合现场（原timer窗已结束、前台可能更改受保护静态集合），不得仅凭旧时效/nonce/报告复用为live准入，不能伪改捕获时间。继续既定窄scope流程，实际业务验收与verified持久闭窗/定时器恢复证明全部齐后，才勾选发布完成。


## 19:08真实上线收尾（发布项完成）

用户18:15明确批准本轮M1最小实际后台范围。实际4f32执行器／db8386 policy、cb6f scoped capture／M093d当前119payload及721809原schema独立核对全部绑定；业务payload、33历史source、构建／类型／原生API／正逆字节／页面证据按哈希复用。19:00:19一次原apply exit0，402.286s，六own槽190/193/194/200/191/192逐个reload并verified持久闭窗，receipt ae28cf…、closedcoord 930e78…；DB/env/frontStatic写入0，另六槽raw保持，前台HTML349cbe…及原5assets受保护。

19:01原strict只读verify真实FIRST_JOURNAL_FRESH_CAPTURE_BINDING失败保留；完整首state精确差量只有获批单root mtimeNs/ctimeNs，其余字段一致。原4f/M/capture/journal/receipt不改。唯一协调19:06:43核对独立af3b73 adapter，仅这一首比较调原root_times_equal，其余完整原verify继承。19:08:00实际adapted-read-only-verify通过，originalStrictVerifyPassed=false；生产写／reload／timer操作0，不把原strict失败改称通过。

timer19:01:38实际恢复，19:01:39守护确认退出；19:08:54最后一次只读证明active/enabled/unitH原态、closed930e及receipt ae28原字节一致、双锁非阻塞取得且FD identity匹配，退出后释放、SSH关闭，本任务无遗留执行作业。后台串行占用正式释放，无追加apply/reload/pause/全机扫描。

当前报告与去敏实际证据：`deploy/customer-batch-actions-20261119/production-20261120-1900/上线完成报告.md`及同目录`actual-release-summary.json`。原strict失败、历史capture/review/源码保持原件；不把原whole-machine门槛称通过，不将Git归档当上线。
