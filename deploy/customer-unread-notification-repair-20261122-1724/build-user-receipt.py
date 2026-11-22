#!/usr/bin/env python3
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
W=Path(__file__).resolve().parent;J=lambda p:json.loads(Path(p).read_text())
r=J(W/'receipt.json');f=J(W/'final/manifest.json');p=J(W/'post-release-check.json');d=J(W/'live-diagnostics.json')
assert r['result']=='VERIFIED'and r['closed']is True and r['scope']==W.name and r['businessTestWrites']==0
assert p['status']=='DURABLE_RECEIPT_CLOSED_AND_DUAL_LOCKS_RELEASED'
assert r['apiReloadGroups']==['dianzi51','dianzi51-admin'] and len(r['runtimes'])==2 and r['assets']==[]
time=datetime.fromisoformat(r['finishedAtUtc']).astimezone(ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d %H:%M:%S')
rows='\n'.join('| '+('客户列表实际picker'if x['side']=='front'else'后台通知诊断')+' | `'+x['sha256'][:16]+'` | 已安装并被对应API引用 |'for x in f['runtimes'])
fail=[x for x in d['records']if x['module']=='sales'and x['outcome']in('error','temporary')]
sample=(f"上线后的只读日志采样取得{len(d['records'])}条白名单诊断记录，其中销售失败阶段记录{len(fail)}条。这些是新版本运行证据，不与历史11:35的两次503自动等同。"if d['records']else'上线后的当次只读日志采样没有捕获到新的诊断请求记录，因此没有新的生产失败trace可用于闭合历史503原因。这不表示503已经不存在。')
text=f'''# 客户未读筛选与通知诊断——正式上线回执

**上线状态：VERIFIED，发布窗口已关闭。**  
完成时间：{time}（北京时间）。本次依据用户2026-11-22 17:24的明确批准，发布到原51电子生产环境，未迁移或重建整站。

## 一、客户“只看未读”：确定缺陷已修复并上线

修复的是真正被客户列表路由调用的customerPicker运行模块，而不是主API中未被调用的同名函数。原模块的输入schema会丢弃customerIds，reader也没有ID筛选，两处现在都已补齐。

customerIds只允许最多2000个正安全整数；省略时保持原列表行为，空数组返回零结果，重复ID去重。ID条件与原企业、团队、负责人、搜索、日期和星标权限做交集，在count与分页前应用，列表和总数使用同一WHERE。原销售订单选客、星标和授权围栏保持，前端越界保护没有删除，也没有清除真实未读。

18组离线定向回归使用捕获生产的真实customerRouter.list、真实Zod/Drizzle及实际候选reader，覆盖输入校验、权限交集、总数、跨页和旧行为兼容；身份与SQL executor为mock，不冒称真实账号/生产MySQL的完整业务验收。用户可刷新客户列表后重试“只看未读”。

## 二、销售通知：脱敏阶段诊断已上线

核心、来源聚合和通知专用原生订单transport在同一运行模块内共享随机trace，记录固定阶段、来源、受控错误类别、上游状态与耗时。原订单列表/详情/统计的公开transport保持。上游UNAUTHORIZED或FORBIDDEN不被伪装成可忽略的业务源拒绝；全部已发出的来源读取结束后才释放原围栏。

日志不包含客户/订单ID、refs、回执、SQL、账号商户标识、Cookie、JWT、服务密钥、任意原始message或stack。每请求最多160阶段记录，有每分钟限流；成功通常只有一个结束记录，日志sink失败不改变业务结果。权限、已读、receipt、snapshot与公开响应合同保持。

诊断源码与兼容性112项、最终发布runtime原字节factory的6项离线验证通过。ES2020真实全库类型检查通过；标准配置仍只有此前已存在的MapIterator TS2802，位置从原819行移动至873行，无新增类型错误，也未改配置掩盖它。

本次不复制新的权限锁池。生产继续调用原native fence，可观察operation和操作成功后的cleanup失败；源码新增的lease/connect/lock/unlock细分hooks未接入生产，不声称能看见原函数吞掉的次要cleanup错误。

## 三、历史503：仍未闭合，不冒称已修好

历史两次sales.inspect503尚无同请求的底层异常证据。**本次完成的是诊断能力上线，不是确认历史503底层原因已修复。** 未据此猜改SQL、延长超时或放宽权限。

{sample}

## 四、精确发布与保护结果

只新增两个内容寻址runtime，两API各修改一处真实模块import，并重载对应4个前台API实例与2个后台API实例。API/runtime完整字节哈希和安装后引用核验通过。

| 发布内容 | SHA-256前16位 | 状态 |
| --- | --- | --- |
{rows}

前台HTML保持`{f['unchangedHTML']['front']['sha256'][:16]}`，完整保留本轮之前刚上线的并发渠道页面；后台HTML保持`{f['unchangedHTML']['admin']['sha256'][:16]}`，采购最终Demo和静默通知不重做、不回滚。没有新的静态资产或HTML切换。其余worker进程PID、全部12进程有效环境和启动配置、受保护配置文件保持。

公共锁后代码锁、fresh closed/CAS、精确备份、不可变安装、owned-inode回滚保护均执行。生产持久回执为VERIFIED/closed，并独立确认双锁已释放，部署和采样SSH会话均关闭。备份目录：`{r['backupDirectory']}`。

前台匿名客户接口401、后台缺商户请求400、后台通知匿名请求403等实际门禁检查保持；这些只验证门禁，不等同于生产客户筛选SQL或销售503功能复现。没有数据库迁移、权限变更、真人录入/报价/清读/mark测试。API正常流量与原启动逻辑可能写数据库，因此不作“生产数据库全部零写”的声明。

## 五、源码与证据

平台源码提交：`{f['sourceCommits']['front']}`。  
后台源码提交：`{f['sourceCommits']['admin']}`。两仓库已保存至原GitHub，并保留并发提交；生产仍采用限定字节增量，而非整体部署最新仓库代码。

机器回执、联合清单、独立审查、单元/原生回归及只读日志样本均归档在本次独立发布窗口，未改写此前采购Demo上线回执。
'''
file=W/'客户未读筛选与通知诊断-正式上线回执.md';file.write_text(text)
print(file)
