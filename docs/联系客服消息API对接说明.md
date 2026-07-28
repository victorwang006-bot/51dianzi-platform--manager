# 前台"联系客服"消息 API 对接说明

> 交付对象：51电子网前台（dianzi51）开发
> 出具方：51电子网后台管理系统（dianzi51-admin）
> 日期：2026-07-28

## 一、功能概述

前台客户点击"联系客服"按钮后，可向平台客服发送消息；消息实时进入后台管理系统的"消息"页面，由客服人员查看并回复；前台再通过拉取接口获取客服回复，形成完整的双向对话。整条链路基于**会话编号（threadNo）**维系：客户首次发送消息时后台创建会话并返回 threadNo，前台将其保存在浏览器 localStorage（或绑定到登录用户），后续追加消息、拉取回复、查询未读均凭此编号。

涉及三个公开接口，均已在后台实现并通过单元测试与端到端验证：

| 接口 | 方法 | 用途 |
|---|---|---|
| `portal.submitMessage` | POST | 提交留言（首次创建会话 / 带 threadNo 追加消息） |
| `portal.getMessages` | GET | 按会话编号拉取全部消息（含客服回复），拉取后前台未读清零 |
| `portal.getUnread` | GET | 查询会话未读回复数（不清零），供"联系客服"按钮红点角标轮询 |

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

成功返回：

```json
{"result":{"data":{"json":{"threadNo":"MT202607281344","threadId":120006}}}}
```

curl 示例（首次发送）：

```bash
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.submitMessage" \
  -H "content-type: application/json" -H "x-portal-key: $PORTAL_KEY" \
  -d '{"json":{"subject":"咨询供货","contactName":"张三","contactPhone":"13800000000","portalUserId":"30001","content":"您好，请问 STM32F103C8 有现货吗？"}}'
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

## 六、验证记录

本链路已于 2026-07-28 在 Manus 开发环境完成验证：单元测试 46/46 通过（含本链路 5 个用例：无 key 拒绝、提交→列表→回复→拉取闭环、NOT_FOUND、未读角标不清零/拉取清零、getUnread 鉴权）；HTTP 端到端验证提交留言、未读查询、消息拉取均正常；后台"消息"页面正确展示会话、未读角标与回复功能。
