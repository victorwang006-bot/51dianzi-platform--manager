import { describe, expect, it } from "vitest";
import { businessSalesOrderMetadataCanWrite } from "./businessSalesOrderMetadataAccess";

const fixture = () => ({ verified: true, merchantId: 7, pageWritable: true, access: {
  merchantId: 7, canWrite: true, readCapabilities: ["crm.sales_orders"], writeCapabilities: ["crm.sales_orders"],
} });
describe("默认业务页面元数据记录的模块写权限", () => {
  it("独立页面可写不等于业务模块可写", () => {
    const input = fixture(); input.access.writeCapabilities = [];
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
  });
  it("只读商户即使有能力字符串也不可写", () => {
    const input = fixture(); input.access.canWrite = false;
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
  });
  it("其他模块写权限不能借用", () => {
    const input = fixture(); input.access.writeCapabilities = ["marketplace.seller"];
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
  });
  it("其他商户的业务能力不能借用", () => {
    const input = fixture(); input.access.merchantId = 8;
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
  });
  it("未核验、嵌入只读或归档客户不可写", () => {
    const input = fixture(); input.verified = false;
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
    input.verified = true; input.pageWritable = false;
    expect(businessSalesOrderMetadataCanWrite(input)).toBe(false);
  });
  it("精确已核验商户和模块均允许才可写", () => {
    expect(businessSalesOrderMetadataCanWrite(fixture())).toBe(true);
  });
});
