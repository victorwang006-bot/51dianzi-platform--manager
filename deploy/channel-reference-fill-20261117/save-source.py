from pathlib import Path
import subprocess,os,shutil,json
D=Path(__file__).resolve().parent;V=Path('/home/ubuntu/work/inbound-documents-fix-v2-20261117');F=Path('/home/ubuntu/work/51dianzi-platform');A=Path('/home/ubuntu/work/51dianzi-platform--manager');T=A/'deploy/channel-reference-fill-20261117';U=F/'deploy/inbound-documents-fix-v2-20261117';T.mkdir(parents=True,exist_ok=True);U.mkdir(parents=True,exist_ok=True)
for name in ['prepare-controller.py','release.py','prepare-package.py','stamp-package-freeze.py','stage-preflight.py','apply-once.py','check-production-runtime.py','verify-public.py','save-source.py','finalize-source-inputs.py','build-admin-api.mjs','identity-bindings-implementation.md','review-closure-implementation.md','source-profile-closure.md','final-aggregation.md']:
 p=D/name
 if p.exists():shutil.copyfile(p,T/name)
for sub,names in [('runtime-build',['build-runtime.cjs','default-loader-check.mjs','implementation.md']),('static-build',['build-reference-stock-times.mjs','implementation.md'])]:
 (T/sub).mkdir(exist_ok=True)
 for name in names:
  p=D/sub/name
  if p.exists():shutil.copyfile(p,T/sub/name)
for name in ['protocol-v2.md','backend-v2-implementation.md','independent-review-v2.md','independent-review-v2.json','fix-sdk-imports.mjs']:
 p=V/name
 if p.exists():shutil.copyfile(p,U/name)
for p in ['build-native.mjs','check-native.mjs']:
 src=V/p
 if src.exists():shutil.copyfile(src,U/p)
(T/'usage.md').write_text('''# 渠道参考补齐与入库附件v2联合修正

有限原型号/品类身份只连接实际证据确认的完整MPN/厂牌参考，不修改业务库存身份。原213份成功价格与证据保留，本轮95新价（立创88、云汉7）和8份独立库存观察（立创6、云汉2）。报价普通阶梯最大门槛、全梯度/税口径/真实读取时间保留，未知库存为null、0为0。来源提示分别显示报价和库存采集时间；非实时，普通刷新只读保存参考，未启用后台自动采价或外站API。

附件v2保存原financial lock：历史归属缺失单据由当前legacy阅读范围、真实owner、可见性及IPO=0标志限定为附件元资料，不补财务记录或改金额付款库存。原现代单据继续完整原财务锁。上传不是保存关联；预览、下载每次重新鉴权，严格PDF/JPEG/PNG/WEBP，OSS HEAD/私有ACL，300s签名，inline或attachment/RFC5987原文件名，禁止公共图片代理。去除多余说明、保持简洁组件，网络未知及跨scope禁止晚到URL/结果复活。

工具依赖本次冻结工作目录/真实前映像/只读保护清单，不可裸执行。先准备原核验数据与SDK类型闭合，再prepare-controller/prepare-package/stamp-package-freeze、私有stage-preflight、生产runtime-only检查与源码冻结，最后仅一次apply-once。当前生产是否完成以最终脱敏联合上线回执为准。无DB/DDL/财务业务DML、无PM2环境/启动目录/配置保存或Nginx变化；保留所有旧资源和其余进程；网络不确定只读查看回执，不重发apply。

密钥、Cookie、验证码、客户/金融文件、数据库URL、服务器配置和保护清单、私有包/编译API不入Git。完整研究证据保存在授权工作目录；源码保存真实三份参考JSON和明确来源链接，不上传金融业务附件。
''')
front={'server/inboundDocumentStorage.test.ts','server/inboundProcurementAccess.test.ts','server/routers/inbound.ts','server/services/inboundDocuments.ts','server/services/internalBusinessDelegation.ts','server/storage.ts','shared/inboundDocuments.ts'}
admin={'TODO.md','server/businessRouter.ts','server/inboundDocumentsBff.test.ts','shared/channelReference.ts','shared/channelReferenceBrand.ts','shared/channelReferenceBrand.test.ts'}
E=dict(os.environ,GIT_ASKPASS='/home/ubuntu/work/recovery-current/git-askpass.py',GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_NAME='Manus',GIT_AUTHOR_EMAIL='dev-agent@manus.ai',GIT_COMMITTER_NAME='Manus',GIT_COMMITTER_EMAIL='dev-agent@manus.ai');commits={}
for role,r in [('front',F),('admin',A)]:
 def git(*args):return subprocess.check_output(['git',*args],cwd=r,env=E,stderr=subprocess.STDOUT).decode().strip()
 git('diff','--check');git('fetch','origin','main');assert git('rev-parse','HEAD')==git('rev-parse','origin/main'),'REMOTE_CHANGED_NO_FORCE';assert not git('diff','--cached','--name-only'),'UNKNOWN_INDEX'
 changes=set(git('diff','--name-only').splitlines()+git('ls-files','--others','--exclude-standard').splitlines());selected={p for p in changes if (role=='front'and(p in front or p.startswith('deploy/inbound-documents-fix-v2-20261117/')))or(role=='admin'and(p in admin or p.startswith('server/channelReference/')or p.startswith('client/src/business/platform/')or p.startswith('deploy/channel-reference-fill-20261117/')))}
 assert selected
 for p in selected:assert not any(x in p for x in ['package-private','protection-current','before-snapshot','private.json','stage-location','source-commits'])
 git('add','--',*sorted(selected));git('commit','-m','fix(inbound,references): scoped legacy attachments preview/download and verified channel price stock fill\n\nCo-authored-by: Manus <dev-agent@manus.ai>');sha=git('rev-parse','HEAD');git('push','origin','HEAD:main');assert git('ls-remote','origin','refs/heads/main').split()[0]==sha;commits[role]=sha;print('SOURCE_FROZEN',role,sha,flush=True)
(D/'source-commits.json').write_text(json.dumps(commits,indent=2)+'\n');print('TWO_ORIGINAL_REPOS_SAVED_NO_FORCE_NO_PRIVATE_PAYLOADS')
