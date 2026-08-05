# CRM 重复企业申请前端对接说明

**作者：Manus AI**  
**日期：2026-07-31**  
**适用模块：** 前台网站企业 CRM 开通申请、CRM 入口权限检查

## 一、变更目的

后端已将**统一社会信用代码**作为企业唯一标识，并将首次被接受的 CRM 申请与稳定的前台用户 ID 绑定。不同用户即使填写同一营业执照，也不能重复创建企业、覆盖联系人资料或获得该企业的 CRM 权限；同一用户重复提交则返回幂等业务结果。[1] [2]

> 前端预检只能改善用户体验，最终必须以 `submitCrmApplication` 的返回结果为准。数据库唯一索引和后端条件写入会处理两个用户同时提交的竞争场景。[3]

## 二、前端必须完成的修改

前台必须在用户登录后调用 CRM 申请和访问接口，并传入当前登录用户的**稳定、不可变用户 ID**。建议使用用户表主键或全局 UUID，不要使用昵称、手机号、邮箱或可修改的展示字段。

| 接口 | 新增/调整字段 | 要求 |
|---|---|---|
| `portal.submitCrmApplication` | `portalUserId` | 必须传当前登录用户稳定 ID；缺失时不会创建申请 |
| `portal.getCrmAccess` | `portalUserId` | 必须传当前登录用户稳定 ID；只有绑定账号且状态为 `enabled` 才允许进入 CRM |
| 两个接口 | `creditCode` | 前端可先 `trim` 并转大写；后端仍会再次规范化 |

如果旧版前端暂时未传 `portalUserId`，后端不会抛出业务异常，而是返回 `CRM_ACCOUNT_REQUIRED`。前端应引导登录，不能继续显示“申请成功”。[1] [2]

## 三、申请接口

### 3.1 请求示例

```ts
const result = await trpc.portal.submitCrmApplication.mutate({
  companyName: form.companyName,
  creditCode: form.creditCode.trim().toUpperCase(),
  portalUserId: currentUser.id,
  contactName: form.contactName,
  contactPhone: form.contactPhone,
  contactEmail: form.contactEmail || null,
  legalPersonName: form.legalPersonName || null,
  registeredAddress: form.registeredAddress || null,
  businessScope: form.businessScope || null,
  licenseImageUrl: uploadedLicenseUrl || null,
  note: form.note || null,
});
```

### 3.2 返回结构

```ts
type CrmApplicationResult = {
  success: true;
  accepted: boolean;
  created: boolean;
  code: CrmApplicationCode;
  crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected";
  message: string;
  merchantId?: number;
  merchantNo?: string;
};
```

`accepted` 表示本次请求是否被后端接受并发生业务状态写入；`created` 仅表示是否新建了商户记录。重复申请通常是 HTTP/tRPC 成功但 `accepted: false`，前端必须依据 `code` 分支处理，不能仅依据 Promise 是否成功。[1]

### 3.3 状态码与建议交互

| `code` | 含义 | 建议提示文案 | 前端动作 |
|---|---|---|---|
| `CRM_APPLICATION_ACCEPTED` | 首次申请已受理 | CRM 申请已提交，请等待平台审核 | 显示成功状态，禁用重复提交 |
| `CRM_APPLICATION_REAPPLIED` | 原申请被拒绝后，同一账号重新提交 | CRM 申请已重新提交，请等待平台审核 | 显示成功状态，进入审核进度页 |
| `CRM_APPLICATION_PENDING` | 同一账号的申请正在审核 | 您的 CRM 开通申请正在审核中，请勿重复提交 | 显示审核中，不再提交 |
| `CRM_ALREADY_ENABLED` | 同一账号对应企业已开通 | 该企业已开通 CRM，请直接进入 CRM | 显示“进入 CRM”按钮 |
| `CRM_ACCESS_DISABLED` | 同一账号对应 CRM 已暂停 | 该企业 CRM 已暂停，请联系平台客服 | 显示客服入口 |
| `CRM_COMPANY_APPLICATION_PENDING` | 其他账号已为该企业提交申请 | 该企业已提交 CRM 申请，正在审核中，请勿重复提交 | 终止提交；可显示“联系企业管理员” |
| `CRM_COMPANY_ALREADY_ENABLED` | 该企业已由其他账号开通 CRM | 该企业已开通 CRM，请使用已绑定账号登录或联系企业管理员 | 终止提交；显示登录切换与企业管理员指引 |
| `CRM_COMPANY_ALREADY_BOUND` | 该企业已绑定其他账号，但当前不属于可直接进入状态 | 该企业已绑定其他账号，请联系企业管理员或平台客服 | 终止提交；显示申诉/客服入口 |
| `CRM_BINDING_REQUIRED` | 存量企业缺少可确认的账号归属 | 该企业 CRM 归属需平台确认，请联系平台客服 | 终止提交；显示客服入口 |
| `CRM_ACCOUNT_REQUIRED` | 未传有效登录账号 ID | 请先登录后再提交 CRM 申请 | 跳转登录，并保存返回地址 |

前端可以直接显示后端 `message`，但建议仍以 `code` 控制按钮、路由和埋点，避免将展示文案当作程序判断条件。

## 四、CRM 访问校验接口

前端进入 CRM 页面前，应同时传入信用代码与当前用户 ID：

```ts
const access = await trpc.portal.getCrmAccess.query({
  creditCode: company.creditCode.trim().toUpperCase(),
  portalUserId: currentUser.id,
});

if (access.allowed) {
  navigate("/crm");
} else {
  showCrmState(access.code, access.message);
}
```

| `code` | `allowed` | 建议行为 |
|---|---:|---|
| `CRM_ACCESS_GRANTED` | `true` | 进入 CRM；此时可使用返回的 `merchantNo` 与 `crmThreadNo` |
| `CRM_NOT_APPLIED` | `false` | 展示申请入口 |
| `CRM_APPLICATION_PENDING` | `false` | 展示审核中 |
| `CRM_APPLICATION_REJECTED` | `false` | 展示未通过原因入口与重新申请按钮 |
| `CRM_ACCESS_DISABLED` | `false` | 展示暂停状态与客服入口 |
| `CRM_COMPANY_APPLICATION_PENDING` | `false` | 告知该企业已有申请，禁止重复提交 |
| `CRM_COMPANY_ALREADY_ENABLED` | `false` | 提示使用已绑定账号或联系企业管理员 |
| `CRM_COMPANY_ALREADY_BOUND` | `false` | 提示企业已绑定其他账号 |
| `CRM_BINDING_REQUIRED` | `false` | 引导联系平台完成存量归属确认 |
| `CRM_ACCOUNT_REQUIRED` | `false` | 跳转登录 |

当当前用户不是企业绑定账号时，后端不会返回 `merchantNo`、`crmThreadNo`、原绑定用户 ID、姓名、手机号或邮箱。前端不得尝试通过提示文案或额外接口展示这些信息。[1]

## 五、推荐页面流程

用户打开 CRM 申请页后，前端先确认登录状态，再调用 `getCrmAccess`。若返回 `CRM_NOT_APPLIED`，展示申请表单；若返回审核中、已开通、已暂停、已绑定或待平台确认等状态，则直接展示对应状态页，不必让用户重复填写整张表单。

提交表单时，按钮应进入 loading 状态并防止重复点击。收到结果后按 `code` 更新页面；即使提交前预检显示“未申请”，也必须处理提交瞬间被其他账号抢先绑定后返回的 `CRM_COMPANY_*` 状态。

```ts
switch (result.code) {
  case "CRM_APPLICATION_ACCEPTED":
  case "CRM_APPLICATION_REAPPLIED":
  case "CRM_APPLICATION_PENDING":
    showReviewStatus(result.message);
    break;
  case "CRM_ALREADY_ENABLED":
    showOpenCrmAction(result.message);
    break;
  case "CRM_ACCOUNT_REQUIRED":
    redirectToLoginWithReturnUrl();
    break;
  default:
    showCompanyBindingNotice(result.message);
}
```

## 六、异常处理

业务冲突会以正常 tRPC 返回表达，前端不应弹出通用“系统错误”。只有鉴权密钥错误、网络异常、服务不可用、输入校验失败或不可恢复的数据库异常才会进入请求异常分支。

| 场景 | 处理方式 |
|---|---|
| `success: true` 且 `accepted: false` | 按 `code` 展示业务状态，不重试 |
| tRPC `UNAUTHORIZED` | 检查前后端服务密钥配置；不要向终端用户展示密钥信息 |
| tRPC 输入错误 | 标记对应表单字段，阻止提交 |
| 网络错误/5xx | 展示“暂时无法提交，请稍后重试”，保留用户已填写内容 |

## 七、前端验收清单

| 验收场景 | 预期结果 |
|---|---|
| 未登录提交 | 跳转登录；后端无新增企业 |
| 用户 A 首次提交企业 X | 返回 `CRM_APPLICATION_ACCEPTED`，进入审核中 |
| 用户 A 重复提交企业 X | 返回 `CRM_APPLICATION_PENDING`，不重复创建、不覆盖资料 |
| 用户 B 提交同一企业 X | 返回 `CRM_COMPANY_APPLICATION_PENDING`，看不到用户 A 信息 |
| 企业 X 开通后用户 A 进入 | 返回 `CRM_ACCESS_GRANTED`，进入 CRM |
| 企业 X 开通后用户 B 提交/进入 | 返回 `CRM_COMPANY_ALREADY_ENABLED`，提示切换账号或联系管理员 |
| 用户 A 被拒绝后补充资料 | 返回 `CRM_APPLICATION_REAPPLIED`，重新进入审核 |
| 两个账号同时提交同一企业 | 仅一个账号申请被接受，另一个收到 `CRM_COMPANY_APPLICATION_PENDING` |
| 信用代码含小写或空格 | 仍识别为同一企业 |
| 存量企业无账号归属 | 返回 `CRM_BINDING_REQUIRED`，不能被新账号直接抢占 |

## 八、发布配合

本次后端包含数据库迁移 `drizzle/0015_acoustic_venus.sql`。前端上线前应确认后端迁移和新接口已部署；否则前端新增的账号归属提示无法生效。后端完整测试基线为 **16 个测试文件、81 项通过、1 项因缺少真实短信凭证而条件跳过**，并已通过 TypeScript 检查和 `/admin/` 生产构建自检。[3]

## References

[1]: ../shared/crm.ts "CRM 状态码与返回类型"
[2]: ../server/routers.ts "前台 CRM tRPC 路由"
[3]: ./CRM重复企业申请后端规则.md "CRM 重复企业申请后端规则"
