# 前台"联系客服"消息 API 对接说明

> 交付对象：51电子网前台（dianzi51）开发
> 出具方：51电子网后台管理系统（dianzi51-admin）
> 日期：2026-07-28（本次更新：submitMessage 新增 threadType / companyProfile 参数；新增企业开通 CRM 申请接口 portal.submitCrmApplication）

## 一、功能概述

前台客户点击"联系客服"按钮后，可向平台客服发送消息；消息实时进入后台管理系统的"消息"页面，由客服人员查看并回复；前台再通过拉取接口获取客服回复，形成完整的双向对话。整条链路基于**会话编号（threadNo）**维系：客户首次发送消息时后台创建会话并返回 threadNo，前台将其保存在浏览器 localStorage（或绑定到登录用户），后续追加消息、拉取回复、查询未读均凭此编号。

涉及四个公开接口，均已在后台实现并通过单元测试与端到端验证：

| 接口 | 方法 | 用途 |
|---|---|---|
| `portal.submitMessage` | POST | 提交留言（首次创建会话 / 带 threadNo 追加消息） |
| `portal.getMessages` | GET | 按会话编号拉取全部消息（含客服回复），拉取后前台未读清零 |
| `portal.getUnread` | GET | 查询会话未读回复数（不清零），供"联系客服"按钮红点角标轮询 |
| `portal.submitCrmApplication` | POST | 企业开通 CRM 申请（按统一社会信用代码幂等落入后台商户管理） |

## 二、接口地址与鉴权

| 项目 | 值 |
|---|---|
| 生产基础地址 | `https://47.97.108.147/admin/api/trpc`（自签证书，需跳过证书校验；查询类小请求 HTTP 亦可） |
| 鉴权方式 | 请求头 `x-portal-key: <密钥>`（与商户入驻、物料图片上传接口共用同一密钥） |
| Content-Type | `application/json` |

密钥获取方式：生产 ECS `/opt/apps/dianzi51-admin/ecosystem.config.cjs` 中的 `PORTAL_API_KEY` 环境变量。前台应将其配置在**服务端**环境变量中，由前台服务端代理调用本接口，切勿暴露到浏览器端代码。

## 三、接口定义

### 3.1 提交留言 portal.submitMessage

`POST {BASE}/portal.submitMessage`

请求体（JSON，业务参数放在 `json` 字段内）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| content | string | 是 | 消息内容，1–5000 字 |
| threadNo | string | 否 | 会话编号。首次发送不传（创建新会话）；追加消息时必传 |
| subject | string | 否 | 会话主题，仅新会话生效；不传则取消息前 100 字 |
| contactName | string | 否 | 联系人姓名（建议登录用户自动带入） |
| contactPhone | string | 否 | 联系电话 |
| contactEmail | string | 否 | 联系邮箱（需为合法邮箱格式） |
| portalUserId | string | 否 | 前台用户 ID（登录用户建议传入，便于后台关联客户） |
| threadType | string | 否 | 会话类型，仅新会话生效：`inquiry`=快速询价、`service`=在线客服、`general`=普通留言（默认）。后台消息列表与详情按此显示彩色类型标签并支持筛选。注意：**企业开通申请不要创建会话**（`crm_apply` 类型会话不会在后台消息中心展示），请直接调用 `portal.submitCrmApplication` |
| companyProfile | object | 否 | 客户公司资料快照（已提交公司资料的用户建议附带）。后台会话详情"客户信息"卡片将展示。字段见下表 |

`companyProfile` 对象字段（均为可选 string）：

| 字段 | 说明 |
|---|---|
| companyName | 企业名称 |
| creditCode | 统一社会信用代码 |
| companyType | 企业类型（如"有限责任公司"） |
| legalPerson | 法定代表人 |
| companyRole | 企业角色（如"采购商"/"供应商"） |
| regAddress | 注册地址 |
| certLevel | 认证等级（如 certified），详情页以徽标展示 |

成功返回：

```json
{"result":{"data":{"json":{"threadNo":"MT202607281344","threadId":120006}}}}
```

curl 示例（首次发送，快速询价场景，附带公司资料）：

```bash
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.submitMessage" \
  -H "content-type: application/json" -H "x-portal-key: $PORTAL_KEY" \
  -d '{"json":{"subject":"快速询价 - STM32F103C8T6","threadType":"inquiry","contactName":"张三","contactPhone":"13800000000","portalUserId":"30001","content":"【快速询价】料号：STM32F103C8T6 品牌：ST 数量：10000","companyProfile":{"companyName":"深圳市某某电子有限公司","creditCode":"91440300XXXXXXXXXX","companyType":"有限责任公司","legalPerson":"张三","companyRole":"采购商","regAddress":"深圳市福田区XX路X号","certLevel":"certified"}}}'
```

追加消息（同一会话继续对话）时带上 threadNo：

```bash
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.submitMessage" \
  -H "content-type: application/json" -H "x-portal-key: $PORTAL_KEY" \
  -d '{"json":{"threadNo":"MT202607281344","content":"好的，价格能优惠吗？"}}'
```

说明：向已关闭（closed）的会话追加消息会自动重开该会话；后台未读数 +1，客服侧边栏角标实时（30 秒轮询）更新。

### 3.2 拉取会话消息 portal.getMessages

`GET {BASE}/portal.getMessages?input={URL 编码的 {"json":{"threadNo":"MT202607281344"}}}`

成功返回：

```json
{"result":{"data":{"json":{
  "threadNo": "MT202607281344",
  "subject": "咨询供货",
  "status": "open",
  "messages": [
    {"id": 1, "senderType": "portal", "senderName": "张三", "content": "您好，请问 STM32F103C8 有现货吗？", "createdAt": "2026-07-28T08:08:00.000Z"},
    {"id": 2, "senderType": "admin", "senderName": "平台客服", "content": "您好，有现货，欢迎下单。", "createdAt": "2026-07-28T08:10:00.000Z"}
  ]
}}}}
```

`senderType` 取值：`portal`=客户消息、`admin`=客服回复，前台据此左右分栏渲染聊天气泡。**调用本接口后该会话的前台未读数自动清零**，因此应在客户打开对话窗口时调用。

curl 示例：

```bash
curl -k -G "https://47.97.108.147/admin/api/trpc/portal.getMessages" \
  -H "x-portal-key: $PORTAL_KEY" \
  --data-urlencode 'input={"json":{"threadNo":"MT202607281344"}}'
```

### 3.3 查询未读角标 portal.getUnread

`GET {BASE}/portal.getUnread?input={URL 编码的 {"json":{"threadNo":"MT202607281344"}}}`

成功返回：

```json
{"result":{"data":{"json":{
  "threadNo": "MT202607281344",
  "unreadCount": 2,
  "status": "open",
  "lastMessageAt": "2026-07-28T08:10:00.000Z"
}}}}
```

本接口**只读不清零**，专用于"联系客服"按钮的红点角标轮询（建议 30–60 秒一次）。`unreadCount` 为客服回复后客户尚未拉取的消息条数；客户打开对话窗口调用 `getMessages` 后自动归零。

### 3.4 企业开通 CRM 申请 portal.submitCrmApplication

`POST {BASE}/portal.submitCrmApplication`

前台"企业开通"表单提交后调用本接口，申请将**直接落入后台"商户管理"页面**（CRM 状态显示为"待开通"），由运营人员审核并开通。以**统一社会信用代码（creditCode）幂等**：同一信用代码重复提交不会创建重复商户，只会更新联系信息并刷新申请时间；已开通（enabled）的商户重复申请不会被降级。

请求体（JSON，业务参数放在 `json` 字段内）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| companyName | string | 是 | 企业名称，2–256 字 |
| creditCode | string | 是 | 统一社会信用代码，5–64 字，幂等键 |
| contactName | string | 否 | 联系人姓名 |
| contactPhone | string | 否 | 联系电话 |
| contactEmail | string | 否 | 联系邮箱（需为合法邮箱格式） |
| legalPersonName | string | 否 | 法定代表人 |
| registeredAddress | string | 否 | 注册地址 |
| businessScope | string | 否 | 经营范围 |
| licenseImageUrl | string | 否 | 营业执照图片 URL（需为合法 URL） |
| portalUserId | string | 否 | 前台用户 ID |
| note | string | 否 | 申请备注（后台以 CRM 备注展示） |

成功返回：

```json
{"result":{"data":{"json":{"merchantId":123,"merchantNo":"M2026071234","created":true,"crmStatus":"pending"}}}}
```

| 返回字段 | 说明 |
|---|---|
| merchantId / merchantNo | 后台商户 ID / 商户编号 |
| created | `true`=新建商户；`false`=信用代码已存在，更新原商户 |
| crmStatus | 申请后的 CRM 状态：`pending`=待开通；若商户已是 `enabled` 则保持不变 |

curl 示例：

```bash
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.submitCrmApplication" \
  -H "content-type: application/json" -H "x-portal-key: $PORTAL_KEY" \
  -d '{"json":{"companyName":"深圳市某某电子有限公司","creditCode":"91440300XXXXXXXXXX","contactName":"张三","contactPhone":"13800000000","contactEmail":"zhangsan@example.com","legalPersonName":"张三","registeredAddress":"深圳市福田区XX路X号","note":"希望开通CRM进行供应链管理"}}'
```

注意：企业开通申请**只需调用本接口**，申请信息直接落入后台"商户管理"页面，由运营人员跟进；请勿再为企业开通申请调用 `portal.submitMessage` 创建会话（后台消息中心不展示企业开通类会话）。

### 3.5 校验 CRM 访问权限 portal.getCrmAccess

`GET {BASE}/portal.getCrmAccess?input={"json":{"creditCode":"统一社会信用代码"}}`

用户点击进入 CRM 页面前调用本接口校验权限。后台运营对 CRM 申请有三种处理：**通过**（enabled）、**拒绝**（rejected）、以及对已开通客户的**暂停**（disabled）。前台按返回的 `allowed` 与 `message` 处理：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| creditCode | string | 是 | 企业统一社会信用代码（与申请时一致） |

成功返回：

```json
{"result":{"data":{"json":{"allowed":false,"crmStatus":"disabled","message":"您的CRM权限已经被暂停，请联系客服","merchantNo":"M2026071234","crmThreadNo":"MT202607291234"}}}}
```

| 返回字段 | 说明 |
|---|---|
| allowed | `true`=允许进入 CRM；`false`=禁止进入，弹出 `message` 提示 |
| crmStatus | `enabled`=已开通 / `pending`=待审核 / `rejected`=已拒绝 / `disabled`=已暂停 / `none`=未申请 |
| message | 禁止进入时的提示文案（allowed=true 时为 null）。已暂停时固定为"您的CRM权限已经被暂停，请联系客服" |
| merchantNo | 商户编号（未找到商户时无此字段） |
| crmThreadNo | 后台"发信"使用的客服会话编号，非空时前台应将其纳入"联系客服"红点轮询（见下） |

**前台必须实现**：
1. 用户点击 CRM 入口时调用本接口；`allowed=false` 时阻止进入并弹出 `message`（如"您的CRM权限已经被暂停，请联系客服"）。
2. 已进入 CRM 的页面也建议定期（如每 5 分钟或页面刷新时）复查，防止暂停后继续使用。

curl 示例：

```bash
curl -k -G "https://47.97.108.147/admin/api/trpc/portal.getCrmAccess" \
  -H "x-portal-key: $PORTAL_KEY" \
  --data-urlencode 'input={"json":{"creditCode":"91440300XXXXXXXXXX"}}'
```

### 3.6 后台"发信"与联系客服红点提醒

后台运营在"商户管理"页对未开通/待开通客户可点击**发信**，消息会落入该商户关联的客服会话（`threadType=service`，首次发信自动创建，之后复用同一会话，会话编号即 `getCrmAccess` 返回的 `crmThreadNo`）。

前台对接要求：
1. **红点提示**：前台"联系客服"按钮旁需设计红色信息提示图标。轮询 `portal.getUnread`（传 `crmThreadNo` 或本地保存的 threadNo），`unreadCount > 0` 时显示红点。
2. **会话合并**：若用户本地已有联系客服会话 threadNo，且 `getCrmAccess` 返回了不同的 `crmThreadNo`，两个会话的未读数都应轮询，红点显示任一会话有未读即可；打开客服窗口时可分别调用 `getMessages` 拉取。
3. **回复**：客户在联系客服窗口回复时调用 `submitMessage` 并带上对应 `threadNo`，消息将回到后台同一会话。

## 四、错误码

| HTTP 状态 | code | 场景 | 处理建议 |
|---|---|---|---|
| 401 | UNAUTHORIZED | x-portal-key 缺失或错误 | 检查密钥配置 |
| 404 | NOT_FOUND | threadNo 对应会话不存在 | 清除本地保存的 threadNo，下次发送时重新创建会话 |
| 400 | BAD_REQUEST | 参数校验失败（内容为空/超长、邮箱格式错误等） | 按返回 message 提示用户 |
| 412 | PRECONDITION_FAILED | 服务端未配置 PORTAL_API_KEY | 联系后台负责人 |

## 五、前台"联系客服"组件建议实现流程

1. **入口**：导航栏上方放置"联系客服"按钮，旁挂红点角标（有未读回复时显示数字）。
2. **会话保持**：登录用户以 `portalUserId` 维度在前台数据库存 threadNo；未登录访客存 localStorage（key 如 `kefu_thread_no`）。
3. **发送**：客户在对话窗口输入内容提交 → 前台服务端代理调用 `submitMessage`（无 threadNo 则创建，返回后保存）。
4. **收取**：打开对话窗口时调用 `getMessages` 渲染历史消息并清未读；窗口打开期间可 10–15 秒轮询刷新。
5. **角标**：窗口关闭状态下按 30–60 秒轮询 `getUnread`，`unreadCount > 0` 时按钮显示红点。
6. **安全**：`x-portal-key` 只存于前台服务端环境变量，浏览器请求一律经前台服务端转发。
7. **CRM 权限**：CRM 入口统一走 `getCrmAccess` 校验；被暂停用户点击 CRM 页面时提示"您的CRM权限已经被暂停，请联系客服"。

## 六、验证记录

本链路已于 2026-07-28 在 Manus 开发环境完成验证：单元测试 51/51 通过（含消息链路 5 个用例与本次新增 threadType/companyProfile/CRM 申请 5 个用例）；HTTP 端到端验证提交留言、未读查询、消息拉取均正常；后台"消息"页面正确展示会话类型标签、客户信息卡片（联系方式 + 公司资料）、未读角标与回复功能；"商户管理"页面正确展示 CRM 状态列并支持开通/停用操作。

2026-07-29 更新（第三十三轮）：商户 CRM 操作重构完成——未开通/待开通/已拒绝/已暂停商户操作为"通过 / 发信 / 拒绝"，已开通商户仅保留"暂停"；新增 `portal.getCrmAccess` 权限校验接口与后台"发信"→前台联系客服红点链路；单元测试 56/56 通过（新增 crmActions.test.ts 5 个用例，覆盖申请→发信→未读红点→拒绝→通过→暂停全流程）。
