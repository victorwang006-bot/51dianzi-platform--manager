# 商户入驻接口 salesOwner（销售负责人）参数对接说明

> 面向：51电子网前台（zhijie ECS）开发
> 日期：2026-07-29

## 1. 变更内容

`portal.submitMerchant`（前台商家入驻资料提交接口）新增**可选**参数 `salesOwner`，写入商户表 `merchants.salesOwner` 列（varchar(64)，可空）。后台"商户管理"列表在"联系人"与"状态"之间新增**销售负责人**列展示该值。

## 2. 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| salesOwner | string | 否 | 销售负责人姓名，最长 64 字符。不传或传 `undefined` 时**保留商户原有值**；传 `null` 或空可清空；重复提交（同营业执照号幂等更新）时传新值可更新 |

其余参数与原 `portal.submitMerchant` 定义一致（companyName、contactName、contactPhone、contactEmail、businessLicense 必填；鉴权仍为请求头 `x-portal-key`）。

## 3. 调用示例

```bash
curl -k -X POST "https://47.97.108.147/admin/api/trpc/portal.submitMerchant" \
  -H "Content-Type: application/json" \
  -H "x-portal-key: <PORTAL_API_KEY>" \
  -d '{
    "companyName": "深圳市示例电子有限公司",
    "contactName": "王先生",
    "contactPhone": "13800000000",
    "contactEmail": "demo@example.com",
    "businessLicense": "91440300MA5EXAMPLE",
    "salesOwner": "李销售"
  }'
```

返回结构不变：`{ merchantId, merchantNo, created, status }`。

## 4. 上生产注意

生产 RDS 需先执行迁移 0014 后再部署新代码：

```sql
ALTER TABLE `merchants` ADD `salesOwner` varchar(64);
```

## 5. 验证记录（开发环境）

- vitest 57/57 通过，含新增用例：salesOwner 写入、不传保留原值、重复提交更新
- 后台商户列表已确认展示"销售负责人"列（无值显示 `-`）
