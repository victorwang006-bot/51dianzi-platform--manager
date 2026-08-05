# CRM 重复企业申请后端规则

**作者：Manus AI**  
**日期：2026-07-31**

## 一、问题定义

当前 CRM 申请仅按统一社会信用代码查找商户，但没有持久化前台申请账号。不同账号提交相同证照时，后一次请求可能覆盖已有商户的联系人资料；访问校验也只依赖信用代码，无法判断当前用户是否为企业绑定账号。

本次修复采用以下原则：**统一社会信用代码确定企业唯一性，前台用户 ID 确定 CRM 账号归属，后端结果是唯一可信判定，前端预检只用于改善体验。**

## 二、数据规则

统一社会信用代码在进入业务逻辑前执行 `trim`、去除空白并转换为大写。商户表对非空 `businessLicense` 建立唯一索引，同时新增可空字段 `crmOwnerPortalUserId`，用于记录首次被接受的 CRM 申请账号。

存量记录不会被自动分配给新账号。对于已经处于 `pending`、`enabled` 或 `disabled` 状态但尚无账号归属的旧记录，后端返回 `CRM_BINDING_REQUIRED`，由平台人工确认后完成绑定，避免任意新用户抢占既有企业。

| 企业记录状态 | 账号关系 | 提交结果 | 是否修改商户资料 |
|---|---|---|---|
| 不存在 | 已提供账号 | `CRM_APPLICATION_ACCEPTED` | 创建企业并绑定账号 |
| `none` | 尚未绑定 | `CRM_APPLICATION_ACCEPTED` | 以条件更新方式绑定并进入审核 |
| `rejected` | 同一账号 | `CRM_APPLICATION_REAPPLIED` | 允许补充材料后重新进入审核 |
| `pending` | 同一账号 | `CRM_APPLICATION_PENDING` | 否，幂等返回 |
| `enabled` | 同一账号 | `CRM_ALREADY_ENABLED` | 否，直接提示进入 CRM |
| `disabled` | 同一账号 | `CRM_ACCESS_DISABLED` | 否，提示联系平台 |
| 任意状态 | 其他账号已绑定 | 按状态返回 `CRM_COMPANY_ALREADY_ENABLED`、`CRM_COMPANY_APPLICATION_PENDING` 或 `CRM_COMPANY_ALREADY_BOUND` | 否 |
| `pending`/`enabled`/`disabled` | 存量记录未绑定 | `CRM_BINDING_REQUIRED` | 否 |
| 任意状态 | 未提供前台用户 ID | `CRM_ACCOUNT_REQUIRED` | 否 |

## 三、接口响应契约

`portal.submitCrmApplication` 保留原有 `created` 与 `crmStatus` 字段，并新增 `success`、`accepted`、`code` 和 `message`，使旧客户端能够继续解析基础字段，新客户端可基于稳定业务码展示准确交互。

```ts
type CrmApplicationResult = {
  success: boolean;
  accepted: boolean;
  created: boolean;
  code: CrmApplicationCode;
  crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected";
  message: string;
  merchantId?: number;
  merchantNo?: string;
};
```

当请求账号不是企业绑定账号时，响应不得包含原绑定人的姓名、手机号、邮箱、用户 ID、客服会话编号或其他可识别信息，也不返回企业内部 `merchantId`。允许返回企业是否已开通或是否正在审核，以便给用户提供正确下一步指引。

## 四、并发规则

数据库唯一索引负责阻止并发创建重复企业。两个请求同时创建相同信用代码时，只允许一个插入成功；失败请求捕获唯一键冲突后重新读取企业并按账号归属返回幂等或冲突结果。

对存量未绑定企业的首次申请使用条件更新：仅当 `crmOwnerPortalUserId IS NULL` 且 CRM 状态允许申请时写入账号。若受影响行数为零，表示已有并发请求先完成绑定，当前请求必须重新读取并按真实归属返回结果，不能覆盖。

## 五、访问校验

`portal.getCrmAccess` 同时接收规范化信用代码与 `portalUserId`。只有账号与 `crmOwnerPortalUserId` 一致且 CRM 状态为 `enabled` 时返回 `allowed: true`。其他账号即使掌握同一营业执照号码，也不能获得商户编号、客服会话编号或 CRM 访问权。
