from pathlib import Path
import json,datetime,shutil,subprocess,os,csv
D=Path(__file__).resolve().parent;V=Path('/home/ubuntu/work/inbound-documents-fix-v2-20261117');F=Path('/home/ubuntu/work/51dianzi-platform');A=Path('/home/ubuntu/work/51dianzi-platform--manager');J=lambda p:json.loads(Path(p).read_text())
r=J(D/'apply-result.json');p=J(D/'production-verification.json');u=J(D/'public-verification.json');assert r['status']=='applied' and p['status']=='verified' and u['status']=='passed'and len(u['checks'])==13;assert len(p['processes'])==12
stamp=datetime.datetime.fromtimestamp(r['finishedAt'],datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S');source=J(D/'source-commits.json');M=J(D/'release-manifest.json');rows=J(D/'data-final/accepted-new-quotes.json');assert len(rows)==95
report=f'''# 渠道参考补齐及采购入库附件修正 · 联合上线回执

**状态：已上线并完成只读验收。** 正式切换时间：{stamp}（北京时间）。本轮只发送一次正式切换；此前私有上传的SSH回包超时，已用同一暂存包的20份文件哈希和实际预检回执确认成功，没有重发正式发布。

## 一、渠道参考一、二的实际补齐

| 指标 | 上线前 | 本轮上线后 |
|---|---:|---:|
| 当前授权物料行 / 去重型号品牌组 | 446 / 441 | 446 / 441，业务库存不变 |
| 有可采纳价格的参考来源份数（按组去重） | 213 | 308 |
| 至少一渠道有可采纳参考的物料组 | 169 | 260 |

本轮新增 **95份真实报价**：渠道一立创 **88份**、渠道二云汉芯城 **7份**，新增覆盖 **91组物料**。这些新价均有明确外站库存；另为 **8份原有报价**补充了独立库存证据（立创6份、云汉2份），原12份已知价但库存未披露的来源降至4份。95与8口径不同，不重复统计。

保留原213份成功报价及其原始读取证据，原价、全部梯度、报价采集时间、税口径、包装和商品编号不变。参考取准确完整商品的普通公开梯度中数量门槛最大档，不采用促销/优惠券或凑相近型号。原业务物料型号、品牌/品类、可供量和原采购报价不改。

新增有限身份映射仅连接已证据确认的完整MPN与厂牌，不将“电阻/二极管”等品类当作厂家别名。旧成功逐来源优先；库存0仍为0，未知仍为空。补库存沿用真实库存采集时间，来源提示分别说明报价时间和库存时间，不能以发布时刻冒充采集时刻。库存低于报价梯度门槛仍显示不足，不伪造成可立即购买。保存参考不是实时价格，未启用自动采价、后台定时任务或私有供应商接口。

[本轮95份新价与库存明细（CSV）]({D}/本轮渠道参考补齐明细.csv)含原型号/品类、已确认完整型号和厂牌、来源、单价、货币、单位、档位、库存、税口径、实际采集时间、商品链接及完整梯度。单位未披露则留空，不凭数量猜单位。

**仍有181组两渠道均无可采纳参考**，不能说446条已经全部补齐。本轮优先核查147组新增物料和11组旧价库存，另完成28项云汉登录后复核。部分原缺价来源未在本轮重查，其他存在厂家/完整型号无法唯一确认、同型号多货源、访问受限、没有正常公开价或证据不满足原规则等问题。这些情况未填猜测值、未挑最低价供应商，也没有把旧失败状态当成本轮新查证结论。原缺价来源中仍有250组涉及的375个来源未重新查证（含已经有另一渠道价格的组，不能把这个数与181直接相加）。

## 二、采购入库合同/银行水单上传修正

部分历史入库单真实存在，但没有后加的采购归属记录；旧附件接口错误复用财务编辑锁，把这类单据误判为不存在。现在按当前真实旧单阅读权限、单据归属、企业与可见范围及无现代采购归属标志，单独允许附件元资料操作；现代单据继续完整原财务锁。不删除权限围栏、不补造采购归属、不让旧单因补附件而可改金额、付款或库存。

已精简附件区重复说明和空状态指导文案，保留合同/银行水单分类、上传、文件名和必要错误/重试/删除。服务端仍限制PDF/JPEG/PNG/WEBP，每份5MiB、每类5份，不因删除说明放宽校验。

已上传待保存文件和已关联文件都有“预览”“下载”入口。PDF/图片通过当前鉴权的短期私有URL在线查看，下载由服务端指定原文件名；预览/下载每次重新鉴权，访问前核实OSS文件类型、大小和private ACL，签名300秒。公共图片代理仍拒绝合同/水单私有目录，包含编码路径及重定向；没有公开URL或公共缓存兜底。取消、删除、切换账号/企业/采购员后，不允许异步旧URL复活。

**上传成功后仍需保存，才关联到实际入库单。** 旧只读单据只保存附件元资料；水单上传不自动标记付款、不执行转账、不改原金额/税率/采购员/入库数量和库存。保留原单条、批量与未知请求核对/不重复建单逻辑。

## 三、实际验收与保护边界

两原仓库全量TypeScript检查、UI定向类型检查通过；六个最终UI文件86项回归与14项实际静态工厂检查通过。独立只读审核无有证据的P0/P1，实际两API逆向与参考唯一导入补丁、91有限绑定/95来源、8库存及旧213报价/evidence保真已核验。新增云汉厂牌字面兼容已在价格和库存验证时限定实际云汉来源，不用于立创证明。

生产新附件模块用原已安装依赖加载成功，两个公开已确认型号的实际固定参考读取成功，未运行采价worker。正式上线更新两API、后台HTML与对应静态/必要runtime、参考siblings；因附件新增固定接口，按原4前台+2后台拓扑滚动重载6个API实例，其他6个进程与worker保持。没有数据库连接、DDL、业务数据迁移、付款/库存DML、PM2环境/启动目录/配置保存或Nginx修改，1384份既有保护文件及12在线进程核对通过。前台HTML、全局导航、新数字提示和独立后台商城保持不变。

公网13项验收通过：后台HTML与两份实际业务工厂/CSS哈希，以及两端附件读取、预览、下载、保存的匿名权限拒绝和公共图片代理私有目录拒绝。参数错误的验收请求已按真实preview/download枚举修正，只补失败断点，未重发上线。

**未使用真实员工账号上传合同/银行水单、创建采购单、修改付款或入库记录，因此不声称真实金融业务E2E已通过。** 本回执区分源码/候选、生产只读状态和业务写测，没有上传生产演示文件或采购订单。

## 四、源码保存

实际应用源码冻结在两个原GitHub仓库：前台 `{source['front']}`，后台 `{source['admin']}`。后续收尾提交仅任务完成状态、可复用工具与本脱敏回执，不改变正式应用文件。没有提交私有包、SSH私钥、Cookie/验证码、数据库URL、服务器配置或金融文件。
'''
(D/'联合上线回执.md').write_text(report)
pth=A/'TODO.md';text=pth.read_text();start=text.index('## 2026-11-17 渠道参考一、二补齐');end=text.index('## 2026-11-17 13:21 采购入库合同与银行付款水单',start);section=text[start:end].replace('- [ ]','- [x]');section=section.replace('仅重载原两个后台实例，保留其它10进程、API/HTML/旧资源和Nginx/PM2配置','参考本身仅需后台重载；依用户追加附件v2修复，联合滚动重载原4前台+2后台API，保留其它6进程、前台HTML/旧资源和Nginx/PM2配置');section+=f'完成本轮：{stamp}联合一次上线；95份新价（88/7）、91新覆盖组、8份独立旧价库存补证，原213份完整保留。仍181组无任一可采纳价，部分旧缺价来源未重查，不冒充全量补齐。13公网断点、1384保护文件/12进程通过。详见deploy/channel-reference-fill-20261117/联合上线回执.md。\n\n';text=text[:start]+section+text[end:];start=text.index('## 2026-11-17 15:33 入库附件上传修正、精简文案、在线预览下载');text=text[:start]+text[start:].replace('- [ ]','- [x]');text+=f'\n完成：{stamp}联合一次上线；历史附件专用当前权限、预览/原名下载及精简界面已上线。现代原financial lock/付款库存不改，无DB/DDL或真实金融业务写测。详见deploy/channel-reference-fill-20261117/联合上线回执.md。\n';pth.write_text(text)
T=A/'deploy/channel-reference-fill-20261117';T.mkdir(exist_ok=True,parents=True)
for name in ['apply-once.py','verify-public.py','check-production-runtime.py','finalize-delivery.py','联合上线回执.md']:
 shutil.copyfile(D/name,T/name)
U=F/'deploy/inbound-documents-fix-v2-20261117';U.mkdir(exist_ok=True,parents=True);shutil.copyfile(D/'联合上线回执.md',U/'联合上线回执.md');(U/'static-build').mkdir(exist_ok=True)
for name in ['build-inbound-v2.mjs','check-inbound-v2.mjs']:shutil.copyfile(V/'static-build'/name,U/'static-build'/name)
(F/'TODO.md').write_text((F/'TODO.md').read_text()+f'\n## 2026-11-17 入库附件v2联合渠道补齐收尾\n- [x] {stamp}已按用户要求修正历史单据附件误报、精简文案并支持私有预览/原名下载。现代完整财务锁、金额付款库存原逻辑不改，固定saveDocuments仅元资料。95新价/8库存补证与原213完整保留，13公网/12进程/1384保护验证通过；仍181物料组无可采纳参考，未做真实金融写测。回执deploy/inbound-documents-fix-v2-20261117/联合上线回执.md。\n')
E=dict(os.environ,GIT_ASKPASS='/home/ubuntu/work/recovery-current/git-askpass.py',GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_NAME='Manus',GIT_AUTHOR_EMAIL='dev-agent@manus.ai',GIT_COMMITTER_NAME='Manus',GIT_COMMITTER_EMAIL='dev-agent@manus.ai');final={}
for role,root,paths in [('front',F,['TODO.md','deploy/inbound-documents-fix-v2-20261117']),('admin',A,['TODO.md','deploy/channel-reference-fill-20261117'])]:
 def git(*args):return subprocess.check_output(['git',*args],cwd=root,env=E,stderr=subprocess.STDOUT).decode().strip()
 git('diff','--check');git('fetch','origin','main');assert git('rev-parse','HEAD')==git('rev-parse','origin/main');assert not git('diff','--cached','--name-only');git('add','--',*paths);git('commit','-m','docs: record combined verified price-stock fill and legacy attachment deployment\n\nCo-authored-by: Manus <dev-agent@manus.ai>');sha=git('rev-parse','HEAD');git('push','origin','HEAD:main');assert git('ls-remote','origin','refs/heads/main').split()[0]==sha;assert not git('status','--porcelain');final[role]=sha
(D/'final-source-commits.json').write_text(json.dumps(final,indent=2)+'\n');assert (D/'联合上线回执.md').is_file()and (D/'联合上线回执.md').stat().st_size>3000
with(D/'本轮渠道参考补齐明细.csv').open(encoding='utf-8-sig',newline='')as f:assert len(list(csv.reader(f)))==96
print('VERIFIED_FINAL_DELIVERY_EXISTS',D/'联合上线回执.md',D/'本轮渠道参考补齐明细.csv','TWO_REPOS_CLEAN')
